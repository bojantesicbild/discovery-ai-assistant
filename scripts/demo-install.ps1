# Demo install — Windows laptop, end-to-end.
#
# Idempotent. Re-running is safe; each step checks state first.
# What this does, in order:
#   1. Verify winget is available (App Installer).
#   2. Install Git, Node.js LTS, Python 3.12, jq, Docker Desktop via winget.
#   3. Install uv (Astral, Python pkg manager) via PowerShell installer.
#   4. Install Claude Code CLI via npm.
#   5. Wait for Docker Desktop to be running.
#   6. Capture ANTHROPIC_API_KEY (prompts if not in env).
#   7. Write .env at repo root (preserves existing).
#   8. Verify frontend\.env.local.
#   9. Backend uv venv + uv sync.
#  10. Frontend npm install + npm run build.
#  11. Stop conflicting local Postgres service if present.
#  12. scripts\dev-up.ps1 — postgres + redis containers + alembic upgrade head.
#
# Run from PowerShell. If you hit "running scripts is disabled" first run:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
# Then:
#   .\scripts\demo-install.ps1
#
# Some winget installs (Docker Desktop) require Administrator. Best to
# launch the PowerShell window as Administrator before running.

#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Say  { param($m) Write-Host "==> $m" -ForegroundColor Green }
function Warn { param($m) Write-Host "==> $m" -ForegroundColor Yellow }
function Die  { param($m) Write-Host "==> $m" -ForegroundColor Red; exit 1 }
function Skip { param($m) Write-Host "==> $m" -ForegroundColor DarkGray }

function Refresh-Path {
    # winget puts new binaries on the system/user PATH at install time
    # but the running PowerShell session's $env:Path is a snapshot from
    # process start. Re-read both scopes so subsequent commands find
    # the just-installed binaries (node, python, docker, jq, git).
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
}

# ── 1. winget ─────────────────────────────────────────────────────
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Die "winget not found. Install 'App Installer' from the Microsoft Store, then re-run."
}
Skip "winget available."

# ── 2. winget packages ────────────────────────────────────────────
function Install-Winget {
    param([string]$Id, [string]$Label = $Id)
    $listed = winget list --id $Id --exact --source winget 2>$null | Out-String
    if ($LASTEXITCODE -eq 0 -and $listed -match [regex]::Escape($Id)) {
        Skip "$Label already installed."
    } else {
        Say "Installing $Label..."
        winget install --id $Id --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { Warn "winget exit $LASTEXITCODE on $Id (likely already installed via another source — continuing)." }
    }
}

Install-Winget -Id Git.Git                  -Label Git
Install-Winget -Id OpenJS.NodeJS.LTS        -Label "Node.js LTS"
Install-Winget -Id Python.Python.3.12       -Label "Python 3.12"
Install-Winget -Id jqlang.jq                -Label jq
Install-Winget -Id Docker.DockerDesktop     -Label "Docker Desktop"

Refresh-Path

# ── 3. uv ─────────────────────────────────────────────────────────
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Say "Installing uv..."
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    # uv installs to %USERPROFILE%\.local\bin; surface it for this session.
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
} else {
    Skip "uv already installed."
}

# ── 4. Claude Code CLI ────────────────────────────────────────────
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Say "Installing Claude Code CLI..."
    npm install -g "@anthropic-ai/claude-code"
    Refresh-Path
} else {
    Skip "Claude Code CLI already installed: $(claude --version 2>&1 | Select-Object -First 1)"
}

# ── 5. Wait for Docker Desktop ────────────────────────────────────
docker info *>$null
if ($LASTEXITCODE -ne 0) {
    Warn "Docker Desktop is installed but not running."
    Warn "Open 'Docker Desktop' from the Start menu, wait until the tray icon says 'Engine running'."
    Read-Host "Press Enter once Docker is running"
    for ($i = 0; $i -lt 30; $i++) {
        docker info *>$null
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep -Seconds 2
    }
    docker info *>$null
    if ($LASTEXITCODE -ne 0) { Die "Docker still not responding. Aborting." }
}
Skip "Docker daemon responding."

# ── 6. ANTHROPIC_API_KEY ──────────────────────────────────────────
if (-not $env:ANTHROPIC_API_KEY) {
    Warn "ANTHROPIC_API_KEY is not set in this shell."
    $secure = Read-Host "Paste your Anthropic API key (input hidden)" -AsSecureString
    $bstr   = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $env:ANTHROPIC_API_KEY = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    if (-not $env:ANTHROPIC_API_KEY) { Die "No key provided. Aborting." }
}
$preview = $env:ANTHROPIC_API_KEY.Substring(0, [Math]::Min(10, $env:ANTHROPIC_API_KEY.Length))
Say "Using ANTHROPIC_API_KEY $preview... (length=$($env:ANTHROPIC_API_KEY.Length))"

# ── 7. .env at repo root ──────────────────────────────────────────
$EnvFile = Join-Path $RepoRoot ".env"
if (Test-Path $EnvFile) {
    Skip ".env already exists — leaving it alone (delete it first to regenerate)."
} else {
    $jwt = python -c "import secrets; print(secrets.token_urlsafe(32))"
    $envBody = @"
DB_PASSWORD=discovery_pass
ANTHROPIC_API_KEY=$($env:ANTHROPIC_API_KEY)
JWT_SECRET=$jwt
INTEGRATION_SECRET_KEY=
"@
    # Write without BOM — docker compose's env-file reader rejects
    # BOM-prefixed values, you'd see the password literally interpreted
    # as "\ufeffdiscovery_pass" and Postgres would fail auth.
    [System.IO.File]::WriteAllText($EnvFile, $envBody, [System.Text.UTF8Encoding]::new($false))
    Say "Wrote .env (DB_PASSWORD, ANTHROPIC_API_KEY, JWT_SECRET, INTEGRATION_SECRET_KEY)."
}

# ── 8. Frontend env ───────────────────────────────────────────────
$FeEnv = Join-Path $RepoRoot "frontend\.env.local"
if (Test-Path $FeEnv) {
    Skip "frontend\.env.local already exists."
} else {
    [System.IO.File]::WriteAllText($FeEnv, "NEXT_PUBLIC_API_URL=http://localhost:8008`n", [System.Text.UTF8Encoding]::new($false))
    Say "Wrote frontend\.env.local."
}

# ── 9. Backend deps ───────────────────────────────────────────────
Say "Setting up backend Python env..."
Push-Location (Join-Path $RepoRoot "backend")
if (-not (Test-Path ".venv")) { uv venv }
& .\.venv\Scripts\Activate.ps1
uv sync
python -c "import app.main" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    deactivate
    Pop-Location
    Die "Backend imports failed."
}
deactivate
Pop-Location

# ── 10. Frontend deps + build sanity ─────────────────────────────
Say "Setting up frontend node_modules..."
Push-Location (Join-Path $RepoRoot "frontend")
if (-not (Test-Path "node_modules")) {
    npm install
} else {
    Skip "node_modules present — running npm install --no-audit anyway to catch lockfile drift."
    npm install --no-audit --prefer-offline
}
Say "Running 'npm run build' as a TS/strict-mode sanity check..."
npm run build
Pop-Location

# ── 11. Stop local Postgres service if running ───────────────────
$pg = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq "Running" }
if ($pg) {
    Warn "Local Postgres service '$($pg.Name)' is running and will conflict on 5432."
    $ans = Read-Host "Stop it now? [Y/n]"
    if ($ans -notmatch "^[Nn]") {
        try { Stop-Service -Name $pg.Name -Force; Skip "Stopped." }
        catch { Warn "Couldn't stop $($pg.Name) — you may need elevated PowerShell. Port conflict will surface in dev-up." }
    }
}

# ── 12. dev-up — Postgres + Redis + alembic ───────────────────────
Say "Starting Postgres + Redis containers and running alembic upgrade head..."
& (Join-Path $RepoRoot "scripts\dev-up.ps1")

# ── Done ─────────────────────────────────────────────────────────
Write-Host ""
Say "Install complete."
Write-Host @"

Start the app in three PowerShell terminals:

  1) Backend
     cd backend
     . .\.venv\Scripts\Activate.ps1
     uvicorn app.main:app --host :: --port 8008 --reload

  2) Worker (only if you'll upload documents)
     cd backend
     . .\.venv\Scripts\Activate.ps1
     arq app.pipeline.worker.WorkerSettings

  3) Frontend
     cd frontend
     npm run dev

Then open http://localhost:3000 — register a user, create a project,
and follow DEMO_SETUP.md section 10 for the demo flow.

"@
