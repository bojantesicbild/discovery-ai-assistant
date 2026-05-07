# Bring up the local dev DB stack on Windows.
#
# What this does (matches scripts/dev-up.sh on macOS):
#   1. Start docker compose services: postgres, redis
#   2. Wait for postgres to accept connections
#   3. If the DB has tables, pg_dump it to scripts\backups\ as a safety net
#   4. Run `alembic upgrade head`
#
# Flags:
#   -Reset    Drop + recreate the public schema after backing it up.
#             Use only when you want a clean DB. Always makes a
#             timestamped pg_dump first.
#
# What this does NOT do: start uvicorn / arq / next dev. Run those
# yourself in three terminals (see scripts\demo-install.ps1 output).

#Requires -Version 5.1
[CmdletBinding()]
param([switch]$Reset)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Say  { param($m) Write-Host "==> $m" -ForegroundColor Green }
function Warn { param($m) Write-Host "==> $m" -ForegroundColor Yellow }
function Die  { param($m) Write-Host "==> $m" -ForegroundColor Red; exit 1 }

$PgContainer = "discovery-ai-assistant-postgres-1"
$PgUser      = "discovery_user"
$PgDb        = "discovery_db"
$BackupsDir  = Join-Path $RepoRoot "scripts\backups"
New-Item -ItemType Directory -Force -Path $BackupsDir | Out-Null

# ── 1. docker compose up postgres + redis ──
docker info *>$null
if ($LASTEXITCODE -ne 0) { Die "Docker daemon not responding. Open Docker Desktop and retry." }

Say "Starting postgres + redis containers..."
docker compose up -d postgres redis | Out-Null

# ── 2. Wait for postgres ──
Say "Waiting for postgres to accept connections..."
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    docker exec $PgContainer pg_isready -U $PgUser -d $PgDb *>$null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $ready) { Die "Postgres didn't become healthy within 60s." }

# ── 3. Backup if the DB has data ──
$tableCountRaw = docker exec $PgContainer psql -U $PgUser -d $PgDb -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'"
$tableCount = 0
[int]::TryParse(($tableCountRaw -replace '\s', ''), [ref]$tableCount) | Out-Null

if ($tableCount -gt 0) {
    $ts = Get-Date -Format "yyyyMMdd-HHmmss"
    $dump = Join-Path $BackupsDir "$ts.sql"
    Say "DB has $tableCount tables. Dumping to $dump..."
    # Capture pg_dump's stdout and write without BOM so a later psql -f
    # can replay the file cleanly. Out-File / Set-Content with -Encoding
    # utf8 in PS 5.1 prepend a BOM that breaks the SQL header.
    $dumpOutput = docker exec $PgContainer pg_dump -U $PgUser -d $PgDb 2>$null
    [System.IO.File]::WriteAllText($dump, ($dumpOutput -join "`n"), [System.Text.UTF8Encoding]::new($false))
    $sizeKB = [Math]::Round((Get-Item $dump).Length / 1KB, 1)
    Say "Backup saved: $dump (${sizeKB}KB)"
} else {
    Say "DB is empty — no backup needed."
}

# ── 4. Optional reset ──
if ($Reset) {
    Warn "RESET requested. The backup above is your only safety net."
    $confirm = Read-Host "Type 'reset' to confirm dropping the public schema"
    if ($confirm -ne "reset") { Die "Aborted — confirmation did not match." }
    docker exec $PgContainer psql -U $PgUser -d $PgDb -c `
        "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO $PgUser; GRANT ALL ON SCHEMA public TO public;" | Out-Null
    Say "Schema reset."
}

# ── 5. Run migrations ──
Say "Running alembic upgrade head..."
$BackendDir = Join-Path $RepoRoot "backend"
if (-not (Test-Path (Join-Path $BackendDir ".venv"))) {
    Die ".venv not found in backend\. Run scripts\demo-install.ps1 first."
}

Push-Location $BackendDir
try {
    & .\.venv\Scripts\Activate.ps1
    $env:PYTHONPATH = "."
    alembic upgrade head
    if ($LASTEXITCODE -ne 0) { Die "alembic upgrade head failed." }
    deactivate
} finally {
    Pop-Location
}

Say "Dev stack ready. Start the processes yourself:"
Write-Host @"
  backend:   cd backend; . .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --host :: --port 8008 --reload
  worker:    cd backend; . .\.venv\Scripts\Activate.ps1; arq app.pipeline.worker.WorkerSettings
  frontend:  cd frontend; npm run dev
"@
