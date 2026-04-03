# Unified AI Assistant - PowerShell Installer
# Supports all 3 domains: Coding, Tech Stories, QA Testing
# This script handles the complete installation on Windows including:
# - Agent system files
# - Claude Code CLI verification
# - MCP server installation and configuration
# - Full system verification
# Usage: iex ((New-Object System.Net.WebClient).DownloadString('https://raw.githubusercontent.com/user/crnogorchi-assistants/main/install.ps1'))

param(
    [switch]$Update,
    [switch]$Repair,
    [switch]$Verify,
    [switch]$Help
)

# Set strict mode and error handling
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Colors for output
$Colors = @{
    Red = "Red"
    Green = "Green"
    Yellow = "Yellow"
    Blue = "Blue"
    NC = "White"
}

# Progress indicators
$TotalSteps = 11
$CurrentStep = 0

# Installation modes
$Mode = "install"  # install, update, repair, verify

function Show-Progress {
    param([string]$Message)

    $script:CurrentStep++
    Write-Host ""
    Write-Host "[Step $CurrentStep/$TotalSteps] $Message" -ForegroundColor $Colors.Blue
    Write-Host "----------------------------------------" -ForegroundColor $Colors.Blue
}

function Show-Banner {
    Write-Host "========================================================" -ForegroundColor $Colors.Blue
    Write-Host "     Unified AI Assistant - Multi-Domain System        " -ForegroundColor $Colors.Blue
    Write-Host "     Complete Installation & Setup Wizard              " -ForegroundColor $Colors.Blue
    Write-Host "========================================================" -ForegroundColor $Colors.Blue
    Write-Host ""
    Write-Host "This system supports three assistant domains:"
    Write-Host ""
    Write-Host "  Coding:       Code generation, refactoring, debugging, PR reviews"
    Write-Host "  Tech Stories: Jira story breakdown, sprint planning, dashboards"
    Write-Host "  QA Testing:   Requirements analysis, test planning, automation,"
    Write-Host "                reporting, defect management (5-phase workflow)"
    Write-Host ""
    Write-Host "Shared capabilities:"
    Write-Host "  - Persistent memory bank with cross-domain knowledge"
    Write-Host "  - MCP integrations (Atlassian, Figma, Chrome DevTools, Context7)"
    Write-Host "  - Domain-aware agent routing"
    Write-Host ""
}

function Test-Command {
    param([string]$Command)

    try {
        Get-Command $Command -ErrorAction Stop | Out-Null
        return $true
    }
    catch {
        return $false
    }
}

function Test-ClaudeCode {
    Show-Progress "Checking Claude Code CLI"

    if (-not (Test-Command "claude")) {
        Write-Host "[FAIL] Claude Code CLI not found" -ForegroundColor $Colors.Red
        Write-Host ""
        Write-Host "Claude Code is required for this system to work."
        Write-Host ""
        Write-Host "Installation instructions:" -ForegroundColor $Colors.Yellow
        Write-Host "1. Visit: https://claude.ai/code"
        Write-Host "2. Download and install Claude Code for Windows"
        Write-Host "3. Verify installation with: claude --version"
        Write-Host "4. Re-run this installer"
        Write-Host ""
        $response = Read-Host "Would you like to open the download page? (y/N)"
        if ($response -match "^[Yy]$") {
            Start-Process "https://claude.ai/code"
        }
        exit 1
    }

    # Test Claude Code is working
    try {
        claude --version | Out-Null
    }
    catch {
        Write-Host "[FAIL] Claude Code CLI found but not working properly" -ForegroundColor $Colors.Red
        Write-Host "Please check your Claude Code installation"
        exit 1
    }

    Write-Host "[OK] Claude Code CLI is installed and working" -ForegroundColor $Colors.Green
}

function Test-Prerequisites {
    Show-Progress "Checking system prerequisites"

    $MissingTools = @()

    Write-Host "Checking required tools..."

    # Check each required tool
    if (-not (Test-Command "git")) {
        $MissingTools += "git"
        Write-Host "[FAIL] git not found" -ForegroundColor $Colors.Red
    } else {
        Write-Host "[OK] git" -ForegroundColor $Colors.Green
    }

    if (-not (Test-Command "node")) {
        $MissingTools += "Node.js"
        Write-Host "[FAIL] Node.js not found" -ForegroundColor $Colors.Red
    } else {
        $NodeVersion = node --version 2>$null
        Write-Host "[OK] Node.js $NodeVersion" -ForegroundColor $Colors.Green
    }

    if (-not (Test-Command "npm")) {
        $MissingTools += "npm"
        Write-Host "[FAIL] npm not found" -ForegroundColor $Colors.Red
    } else {
        $NpmVersion = npm --version 2>$null
        Write-Host "[OK] npm $NpmVersion" -ForegroundColor $Colors.Green
    }

    if (-not (Test-Command "uv")) {
        $MissingTools += "uv"
        Write-Host "[FAIL] uv not found" -ForegroundColor $Colors.Red
    } else {
        Write-Host "[OK] uv" -ForegroundColor $Colors.Green
    }

    # If tools are missing, provide installation instructions
    if ($MissingTools.Count -gt 0) {
        Write-Host ""
        Write-Host "Missing required tools: $($MissingTools -join ', ')" -ForegroundColor $Colors.Red
        Write-Host ""
        Write-Host "Installation instructions:"

        foreach ($tool in $MissingTools) {
            switch ($tool) {
                "git" { Write-Host "  Git: https://git-scm.com/downloads" }
                "Node.js" { Write-Host "  Node.js: https://nodejs.org/" }
                "npm" { Write-Host "  npm: Comes with Node.js" }
                "uv" { Write-Host "  uv: https://docs.astral.sh/uv/getting-started/installation/" }
            }
        }

        Write-Host ""
        $response = Read-Host "Install missing tools and run installer again. Exit now? (Y/n)"
        if ($response -notmatch "^[Nn]$") {
            exit 1
        }
    }

    Write-Host "[OK] All prerequisites met" -ForegroundColor $Colors.Green
}

function Find-ExistingInstallation {
    Show-Progress "Detecting existing installation"

    # If mode was set via CLI args, skip interactive menu
    if ($Mode -eq "update" -or $Mode -eq "repair") {
        if ((Test-Path ".claude") -or (Test-Path ".memory-bank") -or (Test-Path "CLAUDE.md")) {
            Write-Host "Existing installation detected, proceeding with $Mode" -ForegroundColor $Colors.Green
        } else {
            Write-Host "No existing installation found. Switching to fresh install." -ForegroundColor $Colors.Yellow
            $script:Mode = "install"
        }
        return
    }

    $HasClaude = Test-Path ".claude"
    $HasMemory = Test-Path ".memory-bank"
    $HasClaudeMd = Test-Path "CLAUDE.md"

    if ($HasClaude -or $HasMemory -or $HasClaudeMd) {
        Write-Host "Existing agent system files detected:" -ForegroundColor $Colors.Yellow
        if ($HasClaude) { Write-Host "  * .claude/" }
        if ($HasMemory) { Write-Host "  * .memory-bank/" }
        if ($HasClaudeMd) { Write-Host "  * CLAUDE.md" }
        Write-Host ""
        Write-Host "What would you like to do?"
        Write-Host "  1. Update existing installation"
        Write-Host "  2. Backup and reinstall"
        Write-Host "  3. Repair installation"
        Write-Host "  4. Cancel"

        $choice = Read-Host "Choose (1-4)"

        switch ($choice) {
            "1" {
                $script:Mode = "update"
                Write-Host "Update mode selected" -ForegroundColor $Colors.Blue
            }
            "2" {
                Write-Host "Creating backup..." -ForegroundColor $Colors.Yellow
                $BackupDir = "agent-backup-$(Get-Date -Format 'yyyyMMdd_HHmmss')"
                New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

                if ($HasClaude) { Move-Item ".claude" "$BackupDir/" }
                if ($HasMemory) { Move-Item ".memory-bank" "$BackupDir/" }
                if ($HasClaudeMd) { Move-Item "CLAUDE.md" "$BackupDir/" }

                Write-Host "[OK] Files backed up to: $BackupDir" -ForegroundColor $Colors.Green
                $script:Mode = "install"
            }
            "3" {
                $script:Mode = "repair"
                Write-Host "Repair mode selected" -ForegroundColor $Colors.Blue
            }
            "4" {
                Write-Host "Installation cancelled."
                exit 0
            }
            default {
                Write-Host "Invalid choice. Installation cancelled."
                exit 1
            }
        }
    } else {
        Write-Host "[OK] No existing installation detected" -ForegroundColor $Colors.Green
        $script:Mode = "install"
    }
}

function Ensure-MemoryBankStructure {
    Write-Host "Ensuring complete unified memory bank structure..."

    # Create unified docs subdirectories (NO qa-research, test-suites, test-data, test-strategy, figma-exports)
    $UnifiedDirs = @(
        "completed-tasks",
        "research-sessions",
        "best-practices",
        "decisions",
        "errors",
        "system-architecture",
        "tech-docs",
        "test-cases",
        "qa-analysis-reports",
        "reports",
        "defects"
    )

    $DocsPath = ".memory-bank\docs"
    if (-not (Test-Path $DocsPath)) {
        New-Item -ItemType Directory -Path $DocsPath -Force | Out-Null
    }

    foreach ($Dir in $UnifiedDirs) {
        $FullPath = "$DocsPath\$Dir"
        if (-not (Test-Path $FullPath)) {
            New-Item -ItemType Directory -Path $FullPath -Force | Out-Null
        }
    }

    # Create logging directory for session tracking
    $LogsPath = ".memory-bank\.logs"
    if (-not (Test-Path $LogsPath)) {
        New-Item -ItemType Directory -Path $LogsPath -Force | Out-Null
    }
    if (-not (Test-Path "$LogsPath\.gitkeep")) {
        New-Item -ItemType File -Path "$LogsPath\.gitkeep" -Force | Out-Null
    }

    # Create active-tasks directory with domain files from templates
    $ActiveTasksPath = ".memory-bank\active-tasks"
    if (-not (Test-Path $ActiveTasksPath)) {
        New-Item -ItemType Directory -Path $ActiveTasksPath -Force | Out-Null
    }

    # Copy coding active task template
    if (-not (Test-Path "$ActiveTasksPath\coding.md")) {
        if (Test-Path ".claude\templates\active-task-coding.template.md") {
            Copy-Item ".claude\templates\active-task-coding.template.md" "$ActiveTasksPath\coding.md"
            Write-Host "[OK] Created active-tasks/coding.md from template" -ForegroundColor $Colors.Green
        } else {
            Write-Host "[!] active-task-coding.template.md not found" -ForegroundColor $Colors.Yellow
        }
    }

    # Copy tech-stories active task template
    if (-not (Test-Path "$ActiveTasksPath\tech-stories.md")) {
        if (Test-Path ".claude\templates\active-task-stories.template.md") {
            Copy-Item ".claude\templates\active-task-stories.template.md" "$ActiveTasksPath\tech-stories.md"
            Write-Host "[OK] Created active-tasks/tech-stories.md from template" -ForegroundColor $Colors.Green
        } else {
            Write-Host "[!] active-task-stories.template.md not found" -ForegroundColor $Colors.Yellow
        }
    }

    # Copy QA active task template
    if (-not (Test-Path "$ActiveTasksPath\qa.md")) {
        if (Test-Path ".claude\templates\active-task-qa.template.md") {
            Copy-Item ".claude\templates\active-task-qa.template.md" "$ActiveTasksPath\qa.md"
            Write-Host "[OK] Created active-tasks/qa.md from template" -ForegroundColor $Colors.Green
        } else {
            Write-Host "[!] active-task-qa.template.md not found" -ForegroundColor $Colors.Yellow
        }
    }

    # Create active-task.md router file
    if (-not (Test-Path ".memory-bank\active-task.md")) {
        if (Test-Path ".claude\templates\active-task-router.template.md") {
            Copy-Item ".claude\templates\active-task-router.template.md" ".memory-bank\active-task.md"
            Write-Host "[OK] Created active-task.md router from template" -ForegroundColor $Colors.Green
        } else {
            Write-Host "[!] active-task-router.template.md not found" -ForegroundColor $Colors.Yellow
        }
    }

    # Create session start log
    if (-not (Test-Path "$LogsPath\.session-start")) {
        Get-Date -Format "yyyy-MM-dd HH:mm:ss" | Set-Content "$LogsPath\.session-start"
        Write-Host "[OK] Created .logs/.session-start" -ForegroundColor $Colors.Green
    }

    Write-Host "[OK] Unified memory bank directory structure verified" -ForegroundColor $Colors.Green

    # Initialize memory bank with all index files and proper content
    if (Test-Path ".claude\scripts\update-archive-stats.sh") {
        Write-Host "Initializing memory bank index files..."
        try {
            $BashPath = Get-Command "bash" -ErrorAction SilentlyContinue
            if ($BashPath) {
                bash ".claude/scripts/update-archive-stats.sh" *> $null
                Write-Host "[OK] Memory bank index files initialized" -ForegroundColor $Colors.Green
            } else {
                Write-Host "[!] Warning: bash not found, cannot run archive stats script" -ForegroundColor $Colors.Yellow
            }
        }
        catch {
            Write-Host "[!] Warning: Could not initialize some index files" -ForegroundColor $Colors.Yellow
        }
    }
    else {
        Write-Host "[!] Warning: Archive stats script not found, index files may be incomplete" -ForegroundColor $Colors.Yellow
    }
}

function Set-ArchiveCount {
    Write-Host ""
    Write-Host "Configure Archive Display" -ForegroundColor $Colors.Blue
    Write-Host "How many recent items should be displayed in the archive index?"
    Write-Host "Default: 20 items" -ForegroundColor $Colors.Yellow
    Write-Host ""

    $ArchiveCount = Read-Host "Enter count (5-100) or press Enter for default [20]"

    # Validate input
    if ([string]::IsNullOrWhiteSpace($ArchiveCount)) {
        $ArchiveCount = 20
    }
    elseif (-not ($ArchiveCount -match '^\d+$') -or [int]$ArchiveCount -lt 5 -or [int]$ArchiveCount -gt 100) {
        Write-Host "Invalid input. Using default: 20" -ForegroundColor $Colors.Yellow
        $ArchiveCount = 20
    }

    # Update JSON file
    $ConfigPath = ".claude\archive-config.json"
    if (Test-Path $ConfigPath) {
        try {
            $Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
            $Config.recentItems.count = [int]$ArchiveCount
            $Config | ConvertTo-Json -Depth 10 | Set-Content $ConfigPath
            Write-Host "[OK] Archive count set to: $ArchiveCount" -ForegroundColor $Colors.Green
        }
        catch {
            Write-Host "[!] Could not update archive count. Manually edit $ConfigPath" -ForegroundColor $Colors.Yellow
        }
    } else {
        Write-Host "[!] archive-config.json not found, skipping archive count configuration" -ForegroundColor $Colors.Yellow
    }
}

function Install-AgentFiles {
    Show-Progress "Installing agent system files"

    if ($Mode -eq "update" -or $Mode -eq "repair") {
        Write-Host "Updating agent system files..."
    } else {
        Write-Host "Installing fresh agent system..."
    }

    # Create temporary directory
    $TempDir = "agent-install-temp-$(Get-Random)"

    # Clone the repository
    $InstallBranch = if ($env:INSTALL_BRANCH) { $env:INSTALL_BRANCH } else { "main" }
    Write-Host "Downloading latest version (branch: $InstallBranch)..."
    try {
        git clone --quiet --branch $InstallBranch https://github.com/user/crnogorchi-assistants.git $TempDir 2>$null
    }
    catch {
        Write-Host "[FAIL] Failed to download agent system" -ForegroundColor $Colors.Red
        Write-Host "Please check your internet connection and try again."
        exit 1
    }

    # Function to ask for override permission
    function Ask-Override {
        param([string]$DirName)

        if ($script:OverrideAll) {
            return $true
        }

        Write-Host "`nDirectory '$DirName' already exists." -ForegroundColor $Colors.Yellow
        Write-Host "Do you want to override it? (y)es / (n)o / (a)ll remaining"
        $choice = Read-Host "Choice [y/n/a]"

        switch ($choice.ToLower()) {
            { $_ -match '^y' } { return $true }
            { $_ -match '^a' } { $script:OverrideAll = $true; return $true }
            default { return $false }
        }
    }

    # Initialize override flag
    $script:OverrideAll = $false
    if ($Mode -eq "repair") { $script:OverrideAll = $true }

    # Install or update files
    if ($Mode -eq "update" -or $Mode -eq "repair") {
        # Update only agent files, preserve existing memory bank
        Write-Host "Updating agent configurations..."
        if (-not (Test-Path ".claude")) { New-Item -ItemType Directory -Path ".claude" -Force | Out-Null }

        # Check and copy .claude\agents
        if (Test-Path ".claude\agents") {
            if (Ask-Override ".claude\agents") {
                Remove-Item ".\.claude\agents" -Recurse -Force
                Copy-Item "$TempDir\.claude\agents" ".\.claude\" -Recurse -Force
            }
        } else {
            Copy-Item "$TempDir\.claude\agents" ".\.claude\" -Recurse -Force
        }

        # Check and copy .claude\mcp
        if (Test-Path ".claude\mcp") {
            if (Ask-Override ".claude\mcp") {
                Remove-Item ".\.claude\mcp" -Recurse -Force
                if (Test-Path "$TempDir\.claude\mcp") {
                    Copy-Item "$TempDir\.claude\mcp" ".\.claude\" -Recurse -Force
                }
            }
        } else {
            if (Test-Path "$TempDir\.claude\mcp") {
                Copy-Item "$TempDir\.claude\mcp" ".\.claude\" -Recurse -Force
            }
        }

        # Check and copy .claude\skills
        if (Test-Path ".claude\skills") {
            if (Ask-Override ".claude\skills") {
                Remove-Item ".\.claude\skills" -Recurse -Force
                if (Test-Path "$TempDir\.claude\skills") {
                    Copy-Item "$TempDir\.claude\skills" ".\.claude\" -Recurse -Force
                }
            }
        } else {
            if (Test-Path "$TempDir\.claude\skills") {
                Copy-Item "$TempDir\.claude\skills" ".\.claude\" -Recurse -Force
            }
        }

        # Check and copy .claude\templates
        if (Test-Path ".claude\templates") {
            if (Ask-Override ".claude\templates") {
                Remove-Item ".\.claude\templates" -Recurse -Force
                if (Test-Path "$TempDir\.claude\templates") {
                    Copy-Item "$TempDir\.claude\templates" ".\.claude\" -Recurse -Force
                }
            }
        } else {
            if (Test-Path "$TempDir\.claude\templates") {
                Copy-Item "$TempDir\.claude\templates" ".\.claude\" -Recurse -Force
            }
        }

        # Check and copy CLAUDE.md
        if (Test-Path "CLAUDE.md") {
            if (Ask-Override "CLAUDE.md") {
                Copy-Item "$TempDir\CLAUDE.md" ".\" -Force
            }
        } else {
            Copy-Item "$TempDir\CLAUDE.md" ".\" -Force
        }

        # Install memory bank if it doesn't exist
        if (-not (Test-Path ".memory-bank")) {
            Write-Host "Installing missing memory bank..."
            Copy-Item "$TempDir\.memory-bank" ".\" -Recurse -Force
            Ensure-MemoryBankStructure
        }

        # Update scripts but preserve .env
        if (-not (Test-Path ".claude\scripts")) {
            New-Item -ItemType Directory -Path ".claude\scripts" -Force | Out-Null
        }
        if (Test-Path "$TempDir\.claude\scripts\os-utils.sh") {
            Copy-Item "$TempDir\.claude\scripts\os-utils.sh" ".claude\scripts\" -Force
        }
        if (Test-Path "$TempDir\.claude\scripts\update-archive-stats.sh") {
            Copy-Item "$TempDir\.claude\scripts\update-archive-stats.sh" ".claude\scripts\" -Force
        }
        if ((Test-Path ".claude\mcp") -and -not (Test-Path ".claude\mcp\.env") -and (Test-Path "$TempDir\.claude\mcp\.env.template")) {
            Copy-Item "$TempDir\.claude\mcp\.env.template" ".claude\mcp\.env" -Force
        }
        if (Test-Path "$TempDir\.claude\archive-config.json") {
            Copy-Item "$TempDir\.claude\archive-config.json" ".claude\" -Force
        }
        if (Test-Path "$TempDir\.claude\settings.json") {
            Copy-Item "$TempDir\.claude\settings.json" ".claude\" -Force
        }

        Write-Host "[OK] Archive configuration installed" -ForegroundColor $Colors.Green
        Write-Host "[OK] Hooks configured in settings.json (auto-updates, logging)" -ForegroundColor $Colors.Green

        # Configure archive count
        Set-ArchiveCount
    } else {
        # Fresh installation - check existing directories

        # Check and copy .claude
        if (Test-Path ".claude") {
            if (Ask-Override ".claude") {
                Write-Host "Installing agent files..."
                try {
                    Copy-Item "$TempDir\.claude" ".\" -Recurse -Force
                }
                catch {
                    Write-Host "[FAIL] Failed to copy .claude directory" -ForegroundColor $Colors.Red
                    exit 1
                }
            }
        } else {
            Write-Host "Installing agent files..."
            try {
                Copy-Item "$TempDir\.claude" ".\" -Recurse -Force
            }
            catch {
                Write-Host "[FAIL] Failed to copy .claude directory" -ForegroundColor $Colors.Red
                exit 1
            }
        }

        # Check and copy .memory-bank
        if (Test-Path ".memory-bank") {
            if (Ask-Override ".memory-bank") {
                Write-Host "Installing memory bank..."
                try {
                    Copy-Item "$TempDir\.memory-bank" ".\" -Recurse -Force
                }
                catch {
                    Write-Host "[FAIL] Failed to copy .memory-bank directory" -ForegroundColor $Colors.Red
                    exit 1
                }
            }
        } else {
            Write-Host "Installing memory bank..."
            try {
                Copy-Item "$TempDir\.memory-bank" ".\" -Recurse -Force
            }
            catch {
                Write-Host "[FAIL] Failed to copy .memory-bank directory" -ForegroundColor $Colors.Red
                exit 1
            }
        }

        # Ensure complete memory bank structure
        Ensure-MemoryBankStructure

        # Configure archive count
        Set-ArchiveCount

        # Check and copy CLAUDE.md
        if (Test-Path "CLAUDE.md") {
            if (Ask-Override "CLAUDE.md") {
                Write-Host "Installing workflow guide..."
                try {
                    Copy-Item "$TempDir\CLAUDE.md" ".\" -Force
                }
                catch {
                    Write-Host "[FAIL] Failed to copy CLAUDE.md" -ForegroundColor $Colors.Red
                    exit 1
                }
            }
        } else {
            Write-Host "Installing workflow guide..."
            try {
                Copy-Item "$TempDir\CLAUDE.md" ".\" -Force
            }
            catch {
                Write-Host "[FAIL] Failed to copy CLAUDE.md" -ForegroundColor $Colors.Red
                exit 1
            }
        }
    }

    # Verify installation immediately
    Write-Host "Verifying installation..."

    if (-not (Test-Path ".claude")) {
        Write-Host "[FAIL] .claude directory missing after installation" -ForegroundColor $Colors.Red
        exit 1
    }

    if (-not (Test-Path ".memory-bank")) {
        Write-Host "[FAIL] .memory-bank directory missing after installation" -ForegroundColor $Colors.Red
        exit 1
    }

    if (-not (Test-Path "CLAUDE.md")) {
        Write-Host "[FAIL] CLAUDE.md missing after installation" -ForegroundColor $Colors.Red
        exit 1
    }

    # Clean up temp directory
    if (Test-Path $TempDir) {
        try {
            if (Test-Path "$TempDir\.git") {
                Remove-Item "$TempDir\.git" -Recurse -Force -ErrorAction SilentlyContinue
            }
            Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
            if (Test-Path $TempDir) {
                Write-Host "Note: Temp directory $TempDir could not be fully removed (safe to ignore)" -ForegroundColor $Colors.Yellow
            }
        } catch {
            Write-Host "Note: Temp directory cleanup encountered an issue (safe to ignore)" -ForegroundColor $Colors.Yellow
        }
    }

    # Clean up any accidentally created repo folders
    $UnwantedDirs = @("crnogorchi-assistants", "installer-temp")
    foreach ($Dir in $UnwantedDirs) {
        if ((Test-Path $Dir) -and (Test-Path "$Dir\.git")) {
            Write-Host ""
            Write-Host "Found '$Dir' folder (appears to be a cloned repo)." -ForegroundColor $Colors.Yellow
            Write-Host "This folder is not needed - the agent files have been installed to your project root."
            $response = Read-Host "Remove '$Dir' folder? (Y/n)"
            if ($response -notmatch "^[Nn]$") {
                Write-Host "Removing $Dir folder..."
                Remove-Item $Dir -Recurse -Force
                Write-Host "[OK] Cleaned up $Dir" -ForegroundColor $Colors.Green
            } else {
                Write-Host "Keeping $Dir (you can delete it manually later)" -ForegroundColor $Colors.Yellow
            }
        }
    }

    # Offer to update .gitignore
    $GitignoreEntries = @(".claude/", ".memory-bank/", "installer-temp/", "node_modules/")
    $MissingEntries = @()

    if (Test-Path ".gitignore") {
        $GitignoreContent = Get-Content ".gitignore" -ErrorAction SilentlyContinue
        foreach ($entry in $GitignoreEntries) {
            if ($GitignoreContent -notcontains $entry) {
                $MissingEntries += $entry
            }
        }

        if ($MissingEntries.Count -gt 0) {
            Write-Host ""
            Write-Host "The following entries are not in your .gitignore:" -ForegroundColor $Colors.Yellow
            $MissingEntries | ForEach-Object { Write-Host "  $_" }
            $response = Read-Host "Add these to .gitignore? (Y/n)"
            if ($response -notmatch "^[Nn]$") {
                Add-Content ".gitignore" "`n# Unified AI Assistant"
                foreach ($entry in $MissingEntries) {
                    Add-Content ".gitignore" $entry
                }
                Write-Host "[OK] Updated .gitignore" -ForegroundColor $Colors.Green
            }
        }
    } else {
        Write-Host ""
        $response = Read-Host "Create .gitignore with Unified Assistant entries? (Y/n)"
        if ($response -notmatch "^[Nn]$") {
            @"
# Unified AI Assistant
.claude/
.memory-bank/
installer-temp/
node_modules/
.env
"@ | Set-Content ".gitignore"
            Write-Host "[OK] Created .gitignore" -ForegroundColor $Colors.Green
        }
    }

    Write-Host "[OK] Agent system files installed and verified" -ForegroundColor $Colors.Green
}

function Install-StatusLine {
    Show-Progress "Installing Claude Code status line"

    $GlobalClaudeDir = "$env:USERPROFILE\.claude"
    $GlobalStatusLine = "$GlobalClaudeDir\statusline.sh"
    $GlobalSettings = "$GlobalClaudeDir\settings.json"
    $ProjectStatusLine = ".claude\scripts\statusline.sh"

    # Check if project status line exists
    if (-not (Test-Path $ProjectStatusLine)) {
        Write-Host "[!] Project status line script not found at $ProjectStatusLine" -ForegroundColor $Colors.Yellow
        Write-Host "Skipping status line installation."
        return
    }

    # Create global .claude directory if it doesn't exist
    if (-not (Test-Path $GlobalClaudeDir)) {
        New-Item -ItemType Directory -Path $GlobalClaudeDir -Force | Out-Null
    }

    # Check if status line already exists
    if (Test-Path $GlobalStatusLine) {
        Write-Host "Global status line already exists at $GlobalStatusLine" -ForegroundColor $Colors.Yellow
        $response = Read-Host "Overwrite with unified workflow status line? (y/N)"
        if ($response -notmatch "^[Yy]$") {
            Write-Host "Keeping existing status line."
            return
        }
    }

    # Copy status line script
    Write-Host "Installing status line script to $GlobalStatusLine..."
    try {
        Copy-Item $ProjectStatusLine $GlobalStatusLine -Force
        Write-Host "[OK] Status line script installed" -ForegroundColor $Colors.Green
    } catch {
        Write-Host "[FAIL] Failed to copy status line script" -ForegroundColor $Colors.Red
        return
    }

    # Update global settings.json
    Write-Host "Configuring Claude Code settings..."

    $StatusLineConfig = @{
        type = "command"
        command = "~/.claude/statusline.sh"
    }

    if (Test-Path $GlobalSettings) {
        try {
            $Settings = Get-Content $GlobalSettings -Raw | ConvertFrom-Json

            if ($Settings.PSObject.Properties.Name -contains "statusLine") {
                Write-Host "statusLine already configured in settings.json" -ForegroundColor $Colors.Yellow
                $response = Read-Host "Update statusLine configuration? (y/N)"
                if ($response -notmatch "^[Yy]$") {
                    Write-Host "Keeping existing statusLine configuration."
                    return
                }
            }

            $Settings | Add-Member -NotePropertyName "statusLine" -NotePropertyValue $StatusLineConfig -Force
            $Settings | ConvertTo-Json -Depth 10 | Set-Content $GlobalSettings
            Write-Host "[OK] Updated statusLine in settings.json" -ForegroundColor $Colors.Green
        } catch {
            Write-Host "[!] Could not update settings.json: $_" -ForegroundColor $Colors.Yellow
            Write-Host "Please add statusLine manually to $GlobalSettings" -ForegroundColor $Colors.Yellow
        }
    } else {
        try {
            $Settings = @{
                statusLine = $StatusLineConfig
            }
            $Settings | ConvertTo-Json -Depth 10 | Set-Content $GlobalSettings
            Write-Host "[OK] Created settings.json with statusLine" -ForegroundColor $Colors.Green
        } catch {
            Write-Host "[FAIL] Failed to create settings.json" -ForegroundColor $Colors.Red
            return
        }
    }

    Write-Host ""
    Write-Host "[OK] Status line installed successfully!" -ForegroundColor $Colors.Green
    Write-Host ""
    Write-Host "Status line features:"
    Write-Host "  * Model name (magenta)"
    Write-Host "  * Context window progress bar (green/yellow/red)"
    Write-Host "  * Active domain and task key (cyan)"
    Write-Host ""
    Write-Host "Note: Restart Claude Code to see the status line." -ForegroundColor $Colors.Yellow
}

function Set-Environment {
    Show-Progress "Configuring environment"

    $EnvFile = ".claude\mcp\.env"

    # Check if MCP directory exists
    if (-not (Test-Path ".claude\mcp")) {
        Write-Host "[!] MCP directory not found, skipping environment configuration" -ForegroundColor $Colors.Yellow
        return
    }

    # Check if .env exists
    if (Test-Path $EnvFile) {
        $EnvContent = Get-Content $EnvFile -Raw
        if ($EnvContent -match "your-company" -or $EnvContent -match "your.email" -or $EnvContent -match "your_.*_here" -or -not $EnvContent) {
            Write-Host "Environment configuration needs setup" -ForegroundColor $Colors.Yellow
            $NeedsConfig = $true
        } else {
            Write-Host "[OK] Environment already configured" -ForegroundColor $Colors.Green
            $NeedsConfig = $false
        }
    } else {
        if (Test-Path ".claude\mcp\.env.template") {
            Copy-Item ".claude\mcp\.env.template" $EnvFile
            Write-Host "Created .env from template" -ForegroundColor $Colors.Yellow
            $NeedsConfig = $true
        } else {
            Write-Host "[!] .env.template not found, skipping" -ForegroundColor $Colors.Yellow
            return
        }
    }

    if ($NeedsConfig) {
        Write-Host ""
        Write-Host "Atlassian MCP requires API tokens. Other MCPs (context7, chrome-devtools, figma) install without credentials."
        Write-Host ""
        $response = Read-Host "Would you like to configure Atlassian API tokens now? (y/N)"

        if ($response -match "^[Yy]$") {
            Set-ApiTokens $EnvFile
        } else {
            Write-Host ""
            Write-Host "--------------------------------------------------------" -ForegroundColor $Colors.Red
            Write-Host "  IMPORTANT: Skipping Atlassian Credentials" -ForegroundColor $Colors.Red
            Write-Host "--------------------------------------------------------" -ForegroundColor $Colors.Red
            Write-Host ""
            Write-Host "  All MCP servers will be installed regardless."
            Write-Host "  Atlassian MCP will NOT connect until you add credentials." -ForegroundColor $Colors.Yellow
            Write-Host ""
            Write-Host "  To configure credentials later:" -ForegroundColor $Colors.Blue
            Write-Host "    1. Edit: $EnvFile"
            Write-Host "    2. Add your Jira/Confluence URL, email, and API token"
            Write-Host "    3. Re-run: .claude\mcp\setup-mcps.sh install --only mcp-atlassian"
            Write-Host "    4. Restart Claude Code" -ForegroundColor $Colors.Yellow
            Write-Host ""
            Write-Host "  Other MCPs (no credentials needed):" -ForegroundColor $Colors.Blue
            Write-Host "    - context7: Works immediately"
            Write-Host "    - chrome-devtools: Works immediately"
            Write-Host "    - figma: Uses OAuth (authenticate via /mcp in Claude Code)"
            Write-Host ""
        }
    }
}

function Set-ApiTokens {
    param([string]$EnvFile)

    Write-Host ""
    Write-Host "API Token Configuration" -ForegroundColor $Colors.Blue
    Write-Host "========================"
    Write-Host ""
    Write-Host "Leave blank to skip any service you don't use."
    Write-Host ""

    # Atlassian configuration
    Write-Host "Atlassian (Jira/Confluence)" -ForegroundColor $Colors.Yellow
    $JiraUrl = Read-Host "Jira URL (e.g., https://company.atlassian.net)"
    if ($JiraUrl) {
        $JiraEmail = Read-Host "Email"
        $JiraToken = Read-Host "API Token" -AsSecureString
        $JiraTokenPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($JiraToken))

        $Content = Get-Content $EnvFile
        $Content = $Content -replace 'JIRA_URL=.*', "JIRA_URL=`"$JiraUrl`""
        $Content = $Content -replace 'JIRA_USERNAME=.*', "JIRA_USERNAME=`"$JiraEmail`""
        $Content = $Content -replace 'JIRA_API_TOKEN=.*', "JIRA_API_TOKEN=`"$JiraTokenPlain`""
        $Content = $Content -replace 'CONFLUENCE_URL=.*', "CONFLUENCE_URL=`"$JiraUrl/wiki`""
        $Content = $Content -replace 'CONFLUENCE_USERNAME=.*', "CONFLUENCE_USERNAME=`"$JiraEmail`""
        $Content = $Content -replace 'CONFLUENCE_API_TOKEN=.*', "CONFLUENCE_API_TOKEN=`"$JiraTokenPlain`""
        $Content | Set-Content $EnvFile
    }

    Write-Host ""
    Write-Host "Figma" -ForegroundColor $Colors.Yellow
    $FigmaKey = Read-Host "Figma API Key (or press Enter to skip)" -AsSecureString
    $FigmaKeyPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($FigmaKey))
    if ($FigmaKeyPlain) {
        $Content = Get-Content $EnvFile
        $Content = $Content -replace 'FIGMA_API_KEY=.*', "FIGMA_API_KEY=`"$FigmaKeyPlain`""
        $Content | Set-Content $EnvFile
    }

    Write-Host ""
    Write-Host "[OK] API tokens configured" -ForegroundColor $Colors.Green
}

function Install-McpServers {
    Show-Progress "Installing MCP servers"

    $PsScript = ".claude\mcp\setup-mcps.ps1"
    $BashScript = ".claude\mcp\setup-mcps.sh"

    if (Test-Path $PsScript) {
        Write-Host "Running native PowerShell MCP setup..."
        try {
            & $PsScript
            Write-Host "[OK] MCP servers installed" -ForegroundColor $Colors.Green
        }
        catch {
            Write-Host "[!] MCP setup completed with warnings" -ForegroundColor $Colors.Yellow
            Write-Host "You may need to configure API tokens and re-run $PsScript"
        }
    }
    elseif (Test-Path $BashScript) {
        Write-Host "Running MCP setup via bash..." -ForegroundColor $Colors.Yellow
        try {
            $BashPath = Get-Command "bash" -ErrorAction SilentlyContinue
            if ($BashPath) {
                bash ".claude/mcp/setup-mcps.sh"
                Write-Host "[OK] MCP servers installed" -ForegroundColor $Colors.Green
            }
            else {
                Write-Host "[!] Bash not found. Please install Git for Windows or run setup-mcps.sh manually" -ForegroundColor $Colors.Yellow
            }
        }
        catch {
            Write-Host "[!] MCP setup completed with warnings" -ForegroundColor $Colors.Yellow
            Write-Host "You may need to configure API tokens and re-run setup-mcps.sh"
        }
    }
    else {
        Write-Host "[!] MCP setup script not found, skipping MCP installation" -ForegroundColor $Colors.Yellow
        Write-Host "You can install MCP servers manually later."
    }
}

function Test-Agents {
    Show-Progress "Verifying agent availability"

    Write-Host "Checking unified agent files..."

    $AgentsOk = $true

    # Check shared agents
    Write-Host ""
    Write-Host "Shared agents:"
    $SharedAgents = @("setup-agent", "research-agent")
    foreach ($Agent in $SharedAgents) {
        if (Test-Path ".claude\agents\$Agent.md") {
            Write-Host "[OK] $Agent" -ForegroundColor $Colors.Green
        } else {
            Write-Host "[FAIL] $Agent not found" -ForegroundColor $Colors.Red
            $AgentsOk = $false
        }
    }

    # Check QA domain agents
    Write-Host ""
    Write-Host "QA domain agents:"
    $QAAgents = @("qa-analysis-planning-agent", "qa-automation-agent", "qa-reporting-agent", "qa-defect-management-agent")
    foreach ($Agent in $QAAgents) {
        if (Test-Path ".claude\agents\$Agent.md") {
            Write-Host "[OK] $Agent" -ForegroundColor $Colors.Green
        } else {
            Write-Host "[!] $Agent not found (optional)" -ForegroundColor $Colors.Yellow
        }
    }

    # Check Tech Stories domain agents
    Write-Host ""
    Write-Host "Tech Stories domain agents:"
    $StoryAgents = @("story-story-agent", "story-tech-agent", "story-dashboard-agent")
    foreach ($Agent in $StoryAgents) {
        if (Test-Path ".claude\agents\$Agent.md") {
            Write-Host "[OK] $Agent" -ForegroundColor $Colors.Green
        } else {
            Write-Host "[!] $Agent not found (optional)" -ForegroundColor $Colors.Yellow
        }
    }

    # Check CLAUDE.md
    Write-Host ""
    if (Test-Path "CLAUDE.md") {
        Write-Host "[OK] CLAUDE.md workflow guide" -ForegroundColor $Colors.Green
    } else {
        Write-Host "[FAIL] CLAUDE.md not found" -ForegroundColor $Colors.Red
        $AgentsOk = $false
    }

    # Check memory bank structure
    if (Test-Path ".memory-bank") {
        Write-Host "[OK] Memory bank structure" -ForegroundColor $Colors.Green
    } else {
        Write-Host "[FAIL] Memory bank not found" -ForegroundColor $Colors.Red
        $AgentsOk = $false
    }

    # Check active-tasks structure
    if (Test-Path ".memory-bank\active-tasks") {
        Write-Host "[OK] Active tasks directory" -ForegroundColor $Colors.Green
        foreach ($taskFile in @("coding.md", "tech-stories.md", "qa.md")) {
            if (Test-Path ".memory-bank\active-tasks\$taskFile") {
                Write-Host "  [OK] active-tasks/$taskFile" -ForegroundColor $Colors.Green
            } else {
                Write-Host "  [!] active-tasks/$taskFile missing" -ForegroundColor $Colors.Yellow
            }
        }
    } else {
        Write-Host "[!] Active tasks directory not found" -ForegroundColor $Colors.Yellow
    }

    if (Test-Path ".memory-bank\active-task.md") {
        Write-Host "[OK] Active task router (active-task.md)" -ForegroundColor $Colors.Green
    } else {
        Write-Host "[!] Active task router not found" -ForegroundColor $Colors.Yellow
    }

    if (-not $AgentsOk) {
        Write-Host "Some agent files are missing. Run repair mode to fix." -ForegroundColor $Colors.Red
        return $false
    }

    Write-Host ""
    Write-Host "[OK] All agents verified" -ForegroundColor $Colors.Green
    return $true
}

function Test-InstallationValidation {
    Show-Progress "Validating installation completeness"

    $validationFailed = $false
    $report = ""

    # Check core files
    $report += "`nCore Files Validation:`n"
    $coreFiles = @(".claude\agents\setup-agent.md", ".claude\agents\research-agent.md", "CLAUDE.md")
    foreach ($file in $coreFiles) {
        if (Test-Path $file) {
            $report += "  [OK] $file`n"
        } else {
            $report += "  [FAIL] $file - MISSING`n"
            $validationFailed = $true
        }
    }

    # Check cross-platform utilities
    $report += "`nCross-Platform Utilities:`n"
    if (Test-Path ".claude\scripts\os-utils.sh") {
        $report += "  [OK] .claude\scripts\os-utils.sh`n"
    } else {
        $report += "  [FAIL] .claude\scripts\os-utils.sh - MISSING`n"
        $validationFailed = $true
    }

    if (Test-Path ".claude\scripts\update-archive-stats.sh") {
        $report += "  [OK] .claude\scripts\update-archive-stats.sh`n"
    } else {
        $report += "  [!]  .claude\scripts\update-archive-stats.sh - MISSING`n"
    }

    # Check memory bank structure
    $report += "`nMemory Bank Structure:`n"
    $memoryFiles = @(".memory-bank\active-task.md", ".memory-bank\active-tasks\coding.md", ".memory-bank\active-tasks\tech-stories.md", ".memory-bank\active-tasks\qa.md")
    foreach ($file in $memoryFiles) {
        if (Test-Path $file) {
            $report += "  [OK] $file`n"
        } else {
            $report += "  [FAIL] $file - MISSING`n"
            $validationFailed = $true
        }
    }

    $memoryDirs = @(
        ".memory-bank\docs\completed-tasks",
        ".memory-bank\docs\research-sessions",
        ".memory-bank\docs\best-practices",
        ".memory-bank\docs\decisions",
        ".memory-bank\docs\errors",
        ".memory-bank\docs\system-architecture",
        ".memory-bank\docs\tech-docs",
        ".memory-bank\docs\test-cases",
        ".memory-bank\docs\qa-analysis-reports",
        ".memory-bank\docs\reports",
        ".memory-bank\docs\defects"
    )
    foreach ($dir in $memoryDirs) {
        if (Test-Path $dir -PathType Container) {
            $report += "  [OK] $dir\`n"
        } else {
            $report += "  [FAIL] $dir\ - MISSING`n"
            $validationFailed = $true
        }
    }

    # Check session log
    if (Test-Path ".memory-bank\.logs\.session-start") {
        $report += "  [OK] .memory-bank\.logs\.session-start`n"
    } else {
        $report += "  [!]  .memory-bank\.logs\.session-start - MISSING`n"
    }

    # Check MCP configuration
    $report += "`nMCP Configuration:`n"
    if (Test-Path ".claude\mcp" -PathType Container) {
        $report += "  [OK] MCP directory exists`n"
        if (Test-Path ".claude\mcp\setup-mcps.sh") {
            $report += "  [OK] MCP setup script available`n"
        } else {
            $report += "  [!]  MCP setup script not found`n"
        }
        if (Test-Path ".claude\mcp\.env.template") {
            $report += "  [OK] Environment template available`n"
        } else {
            $report += "  [!]  Environment template not found`n"
        }
    } else {
        $report += "  [!]  MCP directory not found`n"
    }

    # Check skills
    $report += "`nDomain Skills:`n"
    if (Test-Path ".claude\skills" -PathType Container) {
        $skillFiles = Get-ChildItem ".claude\skills\*.md" -ErrorAction SilentlyContinue
        foreach ($skillFile in $skillFiles) {
            $report += "  [OK] $($skillFile.FullName)`n"
        }
        if (-not $skillFiles) {
            $report += "  [!]  No skill files found in .claude\skills\`n"
        }
    } else {
        $report += "  [!]  .claude\skills\ directory not found`n"
    }

    # Check security
    $report += "`nSecurity Validation:`n"
    if (Test-Path ".gitignore") {
        $gitignoreContent = Get-Content ".gitignore" -Raw -ErrorAction SilentlyContinue
        if ($gitignoreContent -match "\.env") {
            $report += "  [OK] .gitignore protects .env files`n"
        } else {
            $report += "  [!]  .gitignore missing .env protection`n"
        }
    } else {
        $report += "  [!]  .gitignore not found (recommended for security)`n"
    }

    # Output validation report
    Write-Host $report

    if ($validationFailed) {
        Write-Host "`n[FAIL] Validation failed. Some components are missing." -ForegroundColor $Colors.Red
        Write-Host "Run '.\install.ps1 -Repair' to fix issues" -ForegroundColor $Colors.Yellow
        return $false
    } else {
        Write-Host "`n[OK] Installation validation passed" -ForegroundColor $Colors.Green
        return $true
    }
}

function Test-Health {
    Show-Progress "Running system health check"

    Write-Host "Final verification..."
    Write-Host ""

    # Check Claude Code
    Write-Host -NoNewline "Claude Code CLI: "
    try {
        claude --version | Out-Null
        Write-Host "[OK]" -ForegroundColor $Colors.Green
    }
    catch {
        Write-Host "[FAIL]" -ForegroundColor $Colors.Red
    }

    # Check agents
    Write-Host -NoNewline "Agent files: "
    if ((Test-Path ".claude\agents\setup-agent.md") -and
        (Test-Path ".claude\agents\research-agent.md") -and
        (Test-Path ".claude\agents\research-agent.md")) {
        Write-Host "[OK]" -ForegroundColor $Colors.Green
    } else {
        Write-Host "[FAIL]" -ForegroundColor $Colors.Red
    }

    # Check memory bank
    Write-Host -NoNewline "Memory bank: "
    if ((Test-Path ".memory-bank") -and (Test-Path ".memory-bank\active-task.md")) {
        Write-Host "[OK]" -ForegroundColor $Colors.Green
    } else {
        Write-Host "[FAIL]" -ForegroundColor $Colors.Red
    }

    # Check active tasks
    Write-Host -NoNewline "Active tasks: "
    if ((Test-Path ".memory-bank\active-tasks\coding.md") -and
        (Test-Path ".memory-bank\active-tasks\tech-stories.md") -and
        (Test-Path ".memory-bank\active-tasks\qa.md")) {
        Write-Host "[OK]" -ForegroundColor $Colors.Green
    } else {
        Write-Host "[!] Some domain task files missing" -ForegroundColor $Colors.Yellow
    }

    # Check MCP configuration
    Write-Host -NoNewline "MCP configuration: "
    if (Test-Path ".claude\mcp\.env") {
        Write-Host "[OK]" -ForegroundColor $Colors.Green
    } else {
        Write-Host "[!] Needs configuration" -ForegroundColor $Colors.Yellow
    }

    # List MCP servers
    Write-Host ""
    Write-Host "MCP Servers Status:"
    try {
        claude mcp list 2>$null
    }
    catch {
        Write-Host "  Run 'claude mcp list' after restarting Claude Code"
    }

    Write-Host ""
    Write-Host "[OK] Health check complete" -ForegroundColor $Colors.Green
}

function Show-NextSteps {
    Write-Host ""
    Write-Host "========================================================" -ForegroundColor $Colors.Green
    Write-Host "     Unified AI Assistant Installation Complete!       " -ForegroundColor $Colors.Green
    Write-Host "========================================================" -ForegroundColor $Colors.Green
    Write-Host ""
    Write-Host "--------------------------------------------------------"
    Write-Host ""

    # Check if tokens need configuration
    $EnvFile = ".claude\mcp\.env"
    $NeedsTokens = $false
    if (Test-Path $EnvFile) {
        $EnvContent = Get-Content $EnvFile -Raw
        if ($EnvContent -match "your_.*_here" -or -not ($EnvContent -match "JIRA_API_TOKEN=.+")) {
            $NeedsTokens = $true
        }
    }
    else {
        $NeedsTokens = $true
    }

    if ($NeedsTokens) {
        Write-Host "--------------------------------------------------------" -ForegroundColor $Colors.Red
        Write-Host "  IMPORTANT: Atlassian MCP Credentials Missing" -ForegroundColor $Colors.Red
        Write-Host "--------------------------------------------------------" -ForegroundColor $Colors.Red
        Write-Host ""
        Write-Host "  Atlassian MCP is installed but will NOT connect without credentials." -ForegroundColor $Colors.Yellow
        Write-Host ""
        Write-Host "  To configure:" -ForegroundColor $Colors.Blue
        Write-Host "    1. Edit: .claude\mcp\.env"
        Write-Host "    2. Add your Jira/Confluence URL, email, and API token"
        Write-Host "    3. Re-run: .claude\mcp\setup-mcps.sh install --only mcp-atlassian"
        Write-Host "    4. Restart Claude Code" -ForegroundColor $Colors.Yellow
        Write-Host ""
        Write-Host "--------------------------------------------------------" -ForegroundColor $Colors.Red
        Write-Host ""
    fi

    Write-Host "Next Steps:" -ForegroundColor $Colors.Blue
    Write-Host ""
    Write-Host "1. Restart Claude Code to recognize MCP servers"
    Write-Host ""
    Write-Host "2. Authenticate Figma (OAuth):"
    Write-Host "   Run /mcp in Claude Code -> select figma -> Authenticate" -ForegroundColor $Colors.Yellow
    Write-Host ""
    Write-Host "3. Chrome DevTools MCP:"
    Write-Host "   Chrome starts automatically when needed -- no manual setup required."
    Write-Host ""
    Write-Host "Quick Start Guide (by domain):" -ForegroundColor $Colors.Blue
    Write-Host ""
    Write-Host "  Coding:" -ForegroundColor $Colors.Yellow
    Write-Host "    Start coding tasks, refactoring, debugging in your project"
    Write-Host ""
    Write-Host "  Tech Stories:" -ForegroundColor $Colors.Yellow
    Write-Host "    Analyze and break down Jira stories into technical tasks"
    Write-Host ""
    Write-Host "  QA Testing (5-phase workflow):" -ForegroundColor $Colors.Yellow
    Write-Host "    Phase 1+2: analyze ECOM-1234"
    Write-Host "    Phase 3:   automate ECOM-1234"
    Write-Host "    Phase 4:   report ECOM-1234"
    Write-Host "    Phase 5:   defect"
    Write-Host ""
    Write-Host "Management Commands:" -ForegroundColor $Colors.Blue
    Write-Host "  - Check MCP status: claude mcp list"
    Write-Host "  - Repair MCPs: .claude\mcp\setup-mcps.sh repair"
    Write-Host "  - Update MCPs: .claude\mcp\setup-mcps.sh update"
    Write-Host ""
    Write-Host "Status Line:" -ForegroundColor $Colors.Blue
    if (Test-Path "$env:USERPROFILE\.claude\statusline.sh") {
        Write-Host "  [OK] Unified workflow status line installed"
        Write-Host "     Shows: Model | Context % | Active Domain | Task Key"
    } else {
        Write-Host "  [!]  Status line not installed (run installer again)" -ForegroundColor $Colors.Yellow
    }
    Write-Host ""
    Write-Host "  Restart Claude Code to see status line and recognize MCP servers" -ForegroundColor $Colors.Yellow
    Write-Host ""
    Write-Host "Happy building with your Unified AI Assistant!"
}

function Show-Help {
    Write-Host "Usage: .\install.ps1 [-Update|-Repair|-Verify|-Help]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Update   Update existing installation"
    Write-Host "  -Repair   Repair broken installation"
    Write-Host "  -Verify   Verify installation status"
    Write-Host "  -Help     Show this help message"
}

# Main execution
function Main {
    Clear-Host
    Show-Banner

    # Check if running from within the repo itself
    if ((Test-Path "install.ps1") -and (Test-Path ".git")) {
        $GitConfig = Get-Content ".git\config" -Raw -ErrorAction SilentlyContinue
        if ($GitConfig -match "crnogorchi-assistants") {
            Write-Host "Warning: You appear to be running this from within the crnogorchi-assistants repo." -ForegroundColor $Colors.Yellow
            Write-Host "For best results, run from your target project directory."
            Write-Host ""
            $response = Read-Host "Continue anyway? (y/N)"
            if ($response -notmatch "^[Yy]$") {
                exit 0
            }
        }
    }

    # Handle command line arguments
    if ($Help) {
        Show-Help
        exit 0
    }

    if ($Update) {
        $script:Mode = "update"
    } elseif ($Repair) {
        $script:Mode = "repair"
    } elseif ($Verify) {
        $script:Mode = "verify"
    }

    # Verify mode - just check status
    if ($Mode -eq "verify") {
        $script:TotalSteps = 3
        Test-ClaudeCode
        Test-InstallationValidation
        Test-Health
        exit 0
    }

    # Full installation/update/repair flow
    Test-Prerequisites
    Test-ClaudeCode
    Find-ExistingInstallation
    Install-AgentFiles
    Install-StatusLine
    Set-Environment
    Install-McpServers
    Test-Agents
    Test-InstallationValidation
    Test-Health

    Show-NextSteps
}

# Run main function
Main
