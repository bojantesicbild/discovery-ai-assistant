#!/bin/bash

# Unified AI Assistant - Complete Installer
# Supports all 3 domains: Coding, Tech Stories, QA Testing
# This script handles the complete installation including:
# - Agent system files
# - Claude Code CLI verification
# - MCP server installation and configuration
# - Full system verification
# Usage: curl -sSL https://raw.githubusercontent.com/user/crnogorchi-assistants/main/install.sh | bash

set -e

# Load cross-platform utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.claude/scripts/os-utils.sh" ]; then
    source "$SCRIPT_DIR/.claude/scripts/os-utils.sh"
elif [ -f ".claude/scripts/os-utils.sh" ]; then
    source ".claude/scripts/os-utils.sh"
else
    echo "Warning: Cross-platform utilities not found. Some features may not work on all platforms."
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Progress indicators
TOTAL_STEPS=11
CURRENT_STEP=0

# Installation modes
MODE="install"  # install, update, repair, verify

show_progress() {
    CURRENT_STEP=$((CURRENT_STEP + 1))
    echo ""
    echo -e "${BLUE}[Step $CURRENT_STEP/$TOTAL_STEPS] $1${NC}"
    echo "----------------------------------------"
}

show_banner() {
    echo -e "${BLUE}========================================================${NC}"
    echo -e "${BLUE}     Unified AI Assistant - Multi-Domain System        ${NC}"
    echo -e "${BLUE}     Complete Installation & Setup Wizard              ${NC}"
    echo -e "${BLUE}========================================================${NC}"
    echo ""
    echo "This system supports three assistant domains:"
    echo ""
    echo "  Coding:       Code generation, refactoring, debugging, PR reviews"
    echo "  Tech Stories: Jira story breakdown, sprint planning, dashboards"
    echo "  QA Testing:   Requirements analysis, test planning, automation,"
    echo "                reporting, defect management (5-phase workflow)"
    echo ""
    echo "Shared capabilities:"
    echo "  - Persistent memory bank with cross-domain knowledge"
    echo "  - MCP integrations (Atlassian, Figma, Chrome DevTools, Context7)"
    echo "  - Domain-aware agent routing"
    echo ""
}

# Function to check if a command exists
check_command() {
    if ! command -v "$1" &> /dev/null; then
        return 1
    else
        return 0
    fi
}

# Function to check Claude Code CLI
check_claude_code() {
    show_progress "Checking Claude Code CLI"

    if ! check_command "claude"; then
        echo -e "${RED}[FAIL] Claude Code CLI not found${NC}"
        echo ""
        echo "Claude Code is required for this system to work."
        echo ""
        echo -e "${YELLOW}Installation instructions:${NC}"
        echo "1. Visit: https://claude.ai/code"
        echo "2. Download and install Claude Code for your platform"
        echo "3. Verify installation with: claude --version"
        echo "4. Re-run this installer"
        echo ""
        read -p "Would you like to open the download page? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            if command -v open_url &> /dev/null; then
                open_url "https://claude.ai/code"
            else
                # Fallback if os-utils.sh not available
                if check_command "open"; then
                    open "https://claude.ai/code"
                elif check_command "xdg-open"; then
                    xdg-open "https://claude.ai/code"
                elif check_command "start"; then
                    start "https://claude.ai/code"
                else
                    echo "Please visit https://claude.ai/code to download Claude Code"
                fi
            fi
        fi
        exit 1
    fi

    # Test Claude Code is working
    if ! claude --version &> /dev/null; then
        echo -e "${RED}[FAIL] Claude Code CLI found but not working properly${NC}"
        echo "Please check your Claude Code installation"
        exit 1
    fi

    echo -e "${GREEN}[OK] Claude Code CLI is installed and working${NC}"
}

# Function to check required tools
check_prerequisites() {
    show_progress "Checking system prerequisites"

    local missing_tools=()

    echo "Checking required tools..."

    # Check each required tool
    if ! check_command "git"; then
        missing_tools+=("git")
        echo -e "${RED}[FAIL] git not found${NC}"
    else
        echo -e "${GREEN}[OK] git${NC}"
    fi

    if ! check_command "node"; then
        missing_tools+=("Node.js")
        echo -e "${RED}[FAIL] Node.js not found${NC}"
    else
        echo -e "${GREEN}[OK] Node.js $(node --version 2>/dev/null)${NC}"
    fi

    if ! check_command "npm"; then
        missing_tools+=("npm")
        echo -e "${RED}[FAIL] npm not found${NC}"
    else
        echo -e "${GREEN}[OK] npm $(npm --version 2>/dev/null)${NC}"
    fi

    if ! check_command "uv"; then
        missing_tools+=("uv")
        echo -e "${RED}[FAIL] uv not found${NC}"
    else
        echo -e "${GREEN}[OK] uv${NC}"
    fi

    # If tools are missing, provide installation instructions
    if [ ${#missing_tools[@]} -gt 0 ]; then
        echo ""
        echo -e "${RED}Missing required tools: ${missing_tools[*]}${NC}"
        echo ""
        echo "Installation instructions:"

        for tool in "${missing_tools[@]}"; do
            case $tool in
                "git")
                    echo "  Git: https://git-scm.com/downloads"
                    ;;
                "Node.js")
                    echo "  Node.js: https://nodejs.org/"
                    ;;
                "npm")
                    echo "  npm: Comes with Node.js"
                    ;;
                "uv")
                    echo "  uv: curl -LsSf https://astral.sh/uv/install.sh | sh"
                    ;;
            esac
        done

        echo ""
        read -p "Install missing tools and run installer again. Exit now? (Y/n): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            exit 1
        fi
    fi

    echo -e "${GREEN}[OK] All prerequisites met${NC}"
}

# Function to detect existing installation
detect_existing_installation() {
    show_progress "Detecting existing installation"

    # If mode was set via CLI args, skip interactive menu
    if [ "$MODE" = "update" ] || [ "$MODE" = "repair" ]; then
        if [ -d ".claude" ] || [ -d ".memory-bank" ] || [ -f "CLAUDE.md" ]; then
            echo -e "${GREEN}[OK] Existing installation detected, proceeding with $MODE${NC}"
        else
            echo -e "${YELLOW}No existing installation found. Switching to fresh install.${NC}"
            MODE="install"
        fi
        return
    fi

    local has_claude=false
    local has_memory=false
    local has_claudemd=false

    [ -d ".claude" ] && has_claude=true
    [ -d ".memory-bank" ] && has_memory=true
    [ -f "CLAUDE.md" ] && has_claudemd=true

    if $has_claude || $has_memory || $has_claudemd; then
        echo -e "${YELLOW}Existing agent system files detected:${NC}"
        $has_claude && echo "  * .claude/"
        $has_memory && echo "  * .memory-bank/"
        $has_claudemd && echo "  * CLAUDE.md"
        echo ""
        echo "What would you like to do?"
        echo "  1. Update existing installation"
        echo "  2. Backup and reinstall"
        echo "  3. Repair installation"
        echo "  4. Cancel"

        read -p "Choose (1-4): " -n 1 -r
        echo

        case $REPLY in
            1)
                MODE="update"
                echo -e "${BLUE}Update mode selected${NC}"
                ;;
            2)
                echo -e "${YELLOW}Creating backup...${NC}"
                if command -v format_date &> /dev/null; then
                    BACKUP_DIR="agent-backup-$(format_date "+%Y%m%d_%H%M%S")"
                else
                    BACKUP_DIR="agent-backup-$(date +%Y%m%d_%H%M%S 2>/dev/null || echo "$(date | tr ' :' '__')")"
                fi
                mkdir -p "$BACKUP_DIR"

                $has_claude && mv .claude "$BACKUP_DIR/"
                $has_memory && mv .memory-bank "$BACKUP_DIR/"
                $has_claudemd && mv CLAUDE.md "$BACKUP_DIR/"

                echo -e "${GREEN}[OK] Files backed up to: $BACKUP_DIR${NC}"
                MODE="install"
                ;;
            3)
                MODE="repair"
                echo -e "${BLUE}Repair mode selected${NC}"
                ;;
            4)
                echo "Installation cancelled."
                exit 0
                ;;
            *)
                echo "Invalid choice. Installation cancelled."
                exit 1
                ;;
        esac
    else
        echo -e "${GREEN}[OK] No existing installation detected${NC}"
        MODE="install"
    fi
}

# Function to configure archive count
configure_archive_count() {
    echo ""
    echo -e "${BLUE}Configure Archive Display${NC}"
    echo "How many recent items should be displayed in the archive index?"
    echo -e "${YELLOW}Default: 20 items${NC}"
    echo ""
    read -p "Enter count (5-100) or press Enter for default [20]: " ARCHIVE_COUNT

    # Validate input
    if [[ -z "$ARCHIVE_COUNT" ]]; then
        ARCHIVE_COUNT=20
    elif ! [[ "$ARCHIVE_COUNT" =~ ^[0-9]+$ ]] || [ "$ARCHIVE_COUNT" -lt 5 ] || [ "$ARCHIVE_COUNT" -gt 100 ]; then
        echo -e "${YELLOW}Invalid input. Using default: 20${NC}"
        ARCHIVE_COUNT=20
    fi

    # Update JSON file using sed
    if [ -f ".claude/archive-config.json" ]; then
        if command -v sed >/dev/null 2>&1; then
            sed -i.bak "s/\"count\": [0-9]*/\"count\": $ARCHIVE_COUNT/" .claude/archive-config.json
            rm -f .claude/archive-config.json.bak
            echo -e "${GREEN}[OK] Archive count set to: $ARCHIVE_COUNT${NC}"
        else
            echo -e "${YELLOW}[!] Could not update archive count. Manually edit .claude/archive-config.json${NC}"
        fi
    else
        echo -e "${YELLOW}[!] archive-config.json not found, skipping archive count configuration${NC}"
    fi
}

# Function to prompt for MCP installation scope
get_mcp_scope() {
    echo ""
    echo -e "${BLUE}MCP Installation Scope${NC}"
    echo "Where would you like to install MCP servers?"
    echo "  (1) Local -- only for this project (recommended for multi-project setups)"
    echo "  (2) Global -- available across all projects"
    echo ""
    read -p "Choose (1/2) [default: 1]: " -n 1 -r
    echo
    case "${REPLY:-1}" in
        2) MCP_SCOPE="user"; echo -e "${GREEN}[OK] MCP scope set to: global (user)${NC}" ;;
        *) MCP_SCOPE="local"; echo -e "${GREEN}[OK] MCP scope set to: local (this project only)${NC}" ;;
    esac
    export MCP_SCOPE
}

# Function to ensure memory bank structure is complete
ensure_memory_bank_structure() {
    echo "Ensuring complete unified memory bank structure..."

    # Create unified docs subdirectories (NO qa-research, test-suites, test-data, test-strategy, figma-exports)
    mkdir -p .memory-bank/docs/completed-tasks
    mkdir -p .memory-bank/docs/research-sessions
    mkdir -p .memory-bank/docs/best-practices
    mkdir -p .memory-bank/docs/decisions
    mkdir -p .memory-bank/docs/errors
    mkdir -p .memory-bank/docs/system-architecture
    mkdir -p .memory-bank/docs/tech-docs
    mkdir -p .memory-bank/docs/test-cases
    mkdir -p .memory-bank/docs/qa-analysis-reports
    mkdir -p .memory-bank/docs/reports
    mkdir -p .memory-bank/docs/defects

    # Create logging directory for session tracking
    mkdir -p .memory-bank/.logs
    touch .memory-bank/.logs/.gitkeep

    # Create active-tasks directory with domain files from templates
    mkdir -p .memory-bank/active-tasks

    if [ ! -f ".memory-bank/active-tasks/coding.md" ]; then
        if [ -f ".claude/templates/active-task-coding.template.md" ]; then
            cp .claude/templates/active-task-coding.template.md .memory-bank/active-tasks/coding.md
            echo -e "${GREEN}[OK] Created active-tasks/coding.md from template${NC}"
        else
            echo -e "${YELLOW}[!] active-task-coding.template.md not found${NC}"
        fi
    fi

    if [ ! -f ".memory-bank/active-tasks/tech-stories.md" ]; then
        if [ -f ".claude/templates/active-task-stories.template.md" ]; then
            cp .claude/templates/active-task-stories.template.md .memory-bank/active-tasks/tech-stories.md
            echo -e "${GREEN}[OK] Created active-tasks/tech-stories.md from template${NC}"
        else
            echo -e "${YELLOW}[!] active-task-stories.template.md not found${NC}"
        fi
    fi

    if [ ! -f ".memory-bank/active-tasks/qa.md" ]; then
        if [ -f ".claude/templates/active-task-qa.template.md" ]; then
            cp .claude/templates/active-task-qa.template.md .memory-bank/active-tasks/qa.md
            echo -e "${GREEN}[OK] Created active-tasks/qa.md from template${NC}"
        else
            echo -e "${YELLOW}[!] active-task-qa.template.md not found${NC}"
        fi
    fi

    # Create active-task.md router file
    if [ ! -f ".memory-bank/active-task.md" ]; then
        if [ -f ".claude/templates/active-task-router.template.md" ]; then
            cp .claude/templates/active-task-router.template.md .memory-bank/active-task.md
            echo -e "${GREEN}[OK] Created active-task.md router from template${NC}"
        else
            echo -e "${YELLOW}[!] active-task-router.template.md not found${NC}"
        fi
    fi

    # Create session start log
    mkdir -p .memory-bank/.logs
    if [ ! -f ".memory-bank/.logs/.session-start" ]; then
        if command -v format_date &> /dev/null; then
            echo "$(format_date "+%Y-%m-%d %H:%M:%S")" > .memory-bank/.logs/.session-start
        else
            date +"%Y-%m-%d %H:%M:%S" > .memory-bank/.logs/.session-start 2>/dev/null || echo "unknown" > .memory-bank/.logs/.session-start
        fi
        echo -e "${GREEN}[OK] Created .logs/.session-start${NC}"
    fi

    echo -e "${GREEN}[OK] Unified memory bank directory structure verified${NC}"

    # Initialize memory bank with all index files and proper content
    if [ -f ".claude/scripts/update-archive-stats.sh" ]; then
        echo "Initializing memory bank index files..."
        if bash .claude/scripts/update-archive-stats.sh > /dev/null 2>&1; then
            echo -e "${GREEN}[OK] Memory bank index files initialized${NC}"
        else
            echo -e "${YELLOW}[!] Warning: Could not initialize some index files${NC}"
        fi
    else
        echo -e "${YELLOW}[!] Warning: Archive stats script not found, index files may be incomplete${NC}"
    fi
}

# Function to install agent system files
install_agent_files() {
    show_progress "Installing agent system files"

    if [ "$MODE" = "update" ] || [ "$MODE" = "repair" ]; then
        echo "Updating agent system files..."
    else
        echo "Installing fresh agent system..."
    fi

    # Create temporary directory
    TEMP_DIR="agent-install-temp-$$"

    # Clone the repository
    INSTALL_BRANCH="${INSTALL_BRANCH:-main}"
    echo "Downloading latest version (branch: $INSTALL_BRANCH)..."
    if ! git clone --quiet --branch "$INSTALL_BRANCH" https://github.com/user/crnogorchi-assistants.git "$TEMP_DIR" 2>/dev/null; then
        echo -e "${RED}[FAIL] Failed to download agent system${NC}"
        echo "Please check your internet connection and try again."
        exit 1
    fi

    # Function to ask for override permission
    ask_override() {
        local dir_name="$1"
        if [ "$OVERRIDE_ALL" = "true" ]; then
            return 0  # Skip asking, just override
        fi

        echo -e "\n${YELLOW}Directory '$dir_name' already exists.${NC}"
        echo "Do you want to override it? (y)es / (n)o / (a)ll remaining"
        read -p "Choice [y/n/a]: " -r choice
        case "$choice" in
            [Yy]*) return 0 ;;
            [Aa]*) OVERRIDE_ALL="true"; return 0 ;;
            *) return 1 ;;
        esac
    }

    # Initialize override flag
    OVERRIDE_ALL="false"
    [ "$MODE" = "repair" ] && OVERRIDE_ALL="true"

    # Install or update files
    if [ "$MODE" = "update" ] || [ "$MODE" = "repair" ]; then
        # Update only agent files, preserve existing memory bank
        echo "Updating agent configurations..."
        mkdir -p .claude

        # Check and copy .claude/agents
        if [ -d ".claude/agents" ]; then
            if ask_override ".claude/agents"; then
                rm -rf "./.claude/agents"
                cp -r "$TEMP_DIR/.claude/agents" ./.claude/
            fi
        else
            cp -r "$TEMP_DIR/.claude/agents" ./.claude/
        fi

        # Check and copy .claude/mcp
        if [ -d ".claude/mcp" ]; then
            if ask_override ".claude/mcp"; then
                rm -rf "./.claude/mcp"
                cp -r "$TEMP_DIR/.claude/mcp" ./.claude/
            fi
        else
            [ -d "$TEMP_DIR/.claude/mcp" ] && cp -r "$TEMP_DIR/.claude/mcp" ./.claude/
        fi

        # Check and copy .claude/skills
        if [ -d ".claude/skills" ]; then
            if ask_override ".claude/skills"; then
                rm -rf "./.claude/skills"
                cp -r "$TEMP_DIR/.claude/skills" ./.claude/
            fi
        else
            [ -d "$TEMP_DIR/.claude/skills" ] && cp -r "$TEMP_DIR/.claude/skills" ./.claude/
        fi

        # Check and copy .claude/templates
        if [ -d ".claude/templates" ]; then
            if ask_override ".claude/templates"; then
                rm -rf "./.claude/templates"
                cp -r "$TEMP_DIR/.claude/templates" ./.claude/
            fi
        else
            [ -d "$TEMP_DIR/.claude/templates" ] && cp -r "$TEMP_DIR/.claude/templates" ./.claude/
        fi

        # Check and copy CLAUDE.md
        if [ -f "CLAUDE.md" ]; then
            if ask_override "CLAUDE.md"; then
                cp "$TEMP_DIR/CLAUDE.md" ./
            fi
        else
            cp "$TEMP_DIR/CLAUDE.md" ./
        fi

        # Install memory bank if it doesn't exist
        if [ ! -d ".memory-bank" ]; then
            echo "Installing missing memory bank..."
            cp -r "$TEMP_DIR/.memory-bank" ./
            ensure_memory_bank_structure
        fi

        # Update scripts but preserve .env
        mkdir -p .claude/scripts
        [ -f "$TEMP_DIR/.claude/scripts/os-utils.sh" ] && cp "$TEMP_DIR/.claude/scripts/os-utils.sh" ./.claude/scripts/
        [ -f "$TEMP_DIR/.claude/scripts/update-archive-stats.sh" ] && cp "$TEMP_DIR/.claude/scripts/update-archive-stats.sh" ./.claude/scripts/
        [ -d ".claude/mcp" ] && [ ! -f ".claude/mcp/.env" ] && [ -f "$TEMP_DIR/.claude/mcp/.env.template" ] && cp "$TEMP_DIR/.claude/mcp/.env.template" ./.claude/mcp/.env
        [ -f "$TEMP_DIR/.claude/archive-config.json" ] && cp "$TEMP_DIR/.claude/archive-config.json" ./.claude/
        [ -f "$TEMP_DIR/.claude/settings.json" ] && cp "$TEMP_DIR/.claude/settings.json" ./.claude/

        echo -e "${GREEN}[OK] Archive configuration installed${NC}"
        echo -e "${GREEN}[OK] Hooks configured in settings.json (auto-updates, logging)${NC}"

        # Configure archive count
        configure_archive_count
    else
        # Fresh installation - check existing directories

        # Check and copy .claude
        if [ -d ".claude" ]; then
            if ask_override ".claude"; then
                echo "Installing agent files..."
                if ! cp -r "$TEMP_DIR/.claude" ./; then
                    echo -e "${RED}[FAIL] Failed to copy .claude directory${NC}"
                    exit 1
                fi
            fi
        else
            echo "Installing agent files..."
            if ! cp -r "$TEMP_DIR/.claude" ./; then
                echo -e "${RED}[FAIL] Failed to copy .claude directory${NC}"
                exit 1
            fi
        fi

        # Check and copy .memory-bank
        if [ -d ".memory-bank" ]; then
            if ask_override ".memory-bank"; then
                echo "Installing memory bank..."
                if ! cp -r "$TEMP_DIR/.memory-bank" ./; then
                    echo -e "${RED}[FAIL] Failed to copy .memory-bank directory${NC}"
                    exit 1
                fi
                ensure_memory_bank_structure
            fi
        else
            echo "Installing memory bank..."
            if ! cp -r "$TEMP_DIR/.memory-bank" ./; then
                echo -e "${RED}[FAIL] Failed to copy .memory-bank directory${NC}"
                exit 1
            fi
            ensure_memory_bank_structure
        fi

        # Check and copy CLAUDE.md
        if [ -f "CLAUDE.md" ]; then
            if ask_override "CLAUDE.md"; then
                echo "Installing workflow guide..."
                if ! cp "$TEMP_DIR/CLAUDE.md" ./; then
                    echo -e "${RED}[FAIL] Failed to copy CLAUDE.md${NC}"
                    exit 1
                fi
            fi
        else
            echo "Installing workflow guide..."
            if ! cp "$TEMP_DIR/CLAUDE.md" ./; then
                echo -e "${RED}[FAIL] Failed to copy CLAUDE.md${NC}"
                exit 1
            fi
        fi

        # Configure archive count
        configure_archive_count
    fi

    # Copy os-utils.sh to scripts directory
    mkdir -p .claude/scripts
    if [ -f "$TEMP_DIR/.claude/scripts/os-utils.sh" ]; then
        cp "$TEMP_DIR/.claude/scripts/os-utils.sh" ./.claude/scripts/
        chmod +x .claude/scripts/os-utils.sh
        echo -e "${GREEN}[OK] os-utils.sh copied to .claude/scripts/${NC}"
    fi

    # Make scripts executable
    if [ -f ".claude/scripts/update-archive-stats.sh" ]; then
        chmod +x .claude/scripts/update-archive-stats.sh
    fi

    # Verify installation immediately
    echo "Verifying installation..."

    if [ ! -d ".claude" ]; then
        echo -e "${RED}[FAIL] .claude directory missing after installation${NC}"
        exit 1
    fi

    if [ ! -d ".memory-bank" ]; then
        echo -e "${RED}[FAIL] .memory-bank directory missing after installation${NC}"
        exit 1
    fi

    if [ ! -f "CLAUDE.md" ]; then
        echo -e "${RED}[FAIL] CLAUDE.md missing after installation${NC}"
        exit 1
    fi

    # Clean up temp directory
    if [ -d "$TEMP_DIR" ]; then
        rm -rf "$TEMP_DIR/.git" 2>/dev/null || true
        rm -rf "$TEMP_DIR" 2>/dev/null || true
        if [ -d "$TEMP_DIR" ]; then
            echo -e "${YELLOW}Note: Temp directory $TEMP_DIR could not be fully removed (safe to ignore)${NC}"
        fi
    fi

    # Clean up any accidentally created repo folders
    for unwanted_dir in "crnogorchi-assistants" "installer-temp"; do
        if [ -d "$unwanted_dir" ] && [ -d "$unwanted_dir/.git" ]; then
            echo ""
            echo -e "${YELLOW}Found '$unwanted_dir' folder (appears to be a cloned repo).${NC}"
            echo "This folder is not needed - the agent files have been installed to your project root."
            read -p "Remove '$unwanted_dir' folder? (Y/n): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                echo "Removing $unwanted_dir folder..."
                rm -rf "$unwanted_dir"
                echo -e "${GREEN}[OK] Cleaned up $unwanted_dir${NC}"
            else
                echo -e "${YELLOW}Keeping $unwanted_dir (you can delete it manually later)${NC}"
            fi
        fi
    done

    # Offer to update .gitignore
    if [ -f ".gitignore" ]; then
        MISSING_ENTRIES=""
        for entry in ".claude/" ".memory-bank/" "installer-temp/" "node_modules/"; do
            if ! grep -q "^${entry}$" .gitignore 2>/dev/null; then
                MISSING_ENTRIES="$MISSING_ENTRIES  $entry\n"
            fi
        done

        if [ -n "$MISSING_ENTRIES" ]; then
            echo ""
            echo -e "${YELLOW}The following entries are not in your .gitignore:${NC}"
            echo -e "$MISSING_ENTRIES"
            read -p "Add these to .gitignore? (Y/n): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                echo "" >> .gitignore
                echo "# Unified AI Assistant" >> .gitignore
                for entry in ".claude/" ".memory-bank/" "installer-temp/" "node_modules/"; do
                    if ! grep -q "^${entry}$" .gitignore 2>/dev/null; then
                        echo "$entry" >> .gitignore
                    fi
                done
                echo -e "${GREEN}[OK] Updated .gitignore${NC}"
            fi
        fi
    else
        echo ""
        read -p "Create .gitignore with Unified Assistant entries? (Y/n): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            cat > .gitignore <<EOF
# Unified AI Assistant
.claude/
.memory-bank/
installer-temp/
node_modules/
.env
EOF
            echo -e "${GREEN}[OK] Created .gitignore${NC}"
        fi
    fi

    echo -e "${GREEN}[OK] Agent system files installed and verified${NC}"
}

# Function to install status line (global Claude Code configuration)
install_statusline() {
    show_progress "Installing Claude Code status line"

    GLOBAL_CLAUDE_DIR="$HOME/.claude"
    GLOBAL_STATUSLINE="$GLOBAL_CLAUDE_DIR/statusline.sh"
    GLOBAL_SETTINGS="$GLOBAL_CLAUDE_DIR/settings.json"
    PROJECT_STATUSLINE=".claude/scripts/statusline.sh"

    # Check if project status line exists
    if [ ! -f "$PROJECT_STATUSLINE" ]; then
        echo -e "${YELLOW}[!] Project status line script not found at $PROJECT_STATUSLINE${NC}"
        echo "Skipping status line installation."
        return
    fi

    # Create global .claude directory if it doesn't exist
    mkdir -p "$GLOBAL_CLAUDE_DIR"

    # Check if status line already exists
    if [ -f "$GLOBAL_STATUSLINE" ]; then
        echo -e "${YELLOW}Global status line already exists at $GLOBAL_STATUSLINE${NC}"
        read -p "Overwrite with unified workflow status line? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Keeping existing status line."
            return
        fi
    fi

    # Copy status line script
    echo "Installing status line script to $GLOBAL_STATUSLINE..."
    if cp "$PROJECT_STATUSLINE" "$GLOBAL_STATUSLINE"; then
        chmod +x "$GLOBAL_STATUSLINE"
        echo -e "${GREEN}[OK] Status line script installed${NC}"
    else
        echo -e "${RED}[FAIL] Failed to copy status line script${NC}"
        return
    fi

    # Update global settings.json
    echo "Configuring Claude Code settings..."

    if [ -f "$GLOBAL_SETTINGS" ]; then
        if grep -q '"statusLine"' "$GLOBAL_SETTINGS" 2>/dev/null; then
            echo -e "${YELLOW}statusLine already configured in settings.json${NC}"
            read -p "Update statusLine configuration? (y/N): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                echo "Keeping existing statusLine configuration."
                return
            fi

            if check_command "jq"; then
                TMP_SETTINGS=$(mktemp)
                jq '.statusLine = {"type": "command", "command": "~/.claude/statusline.sh"}' "$GLOBAL_SETTINGS" > "$TMP_SETTINGS"
                mv "$TMP_SETTINGS" "$GLOBAL_SETTINGS"
                echo -e "${GREEN}[OK] Updated statusLine in settings.json${NC}"
            else
                echo -e "${YELLOW}[!] jq not found. Please update statusLine manually in $GLOBAL_SETTINGS:${NC}"
                echo '  "statusLine": {"type": "command", "command": "~/.claude/statusline.sh"}'
            fi
        else
            if check_command "jq"; then
                TMP_SETTINGS=$(mktemp)
                jq '. + {"statusLine": {"type": "command", "command": "~/.claude/statusline.sh"}}' "$GLOBAL_SETTINGS" > "$TMP_SETTINGS"
                mv "$TMP_SETTINGS" "$GLOBAL_SETTINGS"
                echo -e "${GREEN}[OK] Added statusLine to settings.json${NC}"
            else
                echo -e "${YELLOW}[!] jq not found. Please add statusLine manually to $GLOBAL_SETTINGS:${NC}"
                echo '  "statusLine": {"type": "command", "command": "~/.claude/statusline.sh"}'
            fi
        fi
    else
        cat > "$GLOBAL_SETTINGS" <<EOF
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh"
  }
}
EOF
        echo -e "${GREEN}[OK] Created settings.json with statusLine${NC}"
    fi

    echo ""
    echo -e "${GREEN}[OK] Status line installed successfully!${NC}"
    echo ""
    echo "Status line features:"
    echo "  * Model name (magenta)"
    echo "  * Context window progress bar (green/yellow/red)"
    echo "  * Active domain and task key (cyan)"
    echo ""
    echo -e "${YELLOW}Note: Restart Claude Code to see the status line.${NC}"
}

# Function to setup environment configuration
setup_environment() {
    show_progress "Configuring environment"

    ENV_FILE=".claude/mcp/.env"

    # Check if MCP directory exists
    if [ ! -d ".claude/mcp" ]; then
        echo -e "${YELLOW}[!] MCP directory not found, skipping environment configuration${NC}"
        return
    fi

    # Check if .env exists
    if [ -f "$ENV_FILE" ]; then
        # Load and check existing configuration
        set -a
        source "$ENV_FILE" 2>/dev/null || true
        set +a

        # Check if it has placeholder values
        if [[ "${JIRA_URL:-}" == *"your-company"* ]] || \
           [[ "${JIRA_USERNAME:-}" == *"your.email"* ]] || \
           [[ "${JIRA_API_TOKEN:-}" == *"your_"*"_here" ]] || \
           [ -z "${JIRA_API_TOKEN:-}" ]; then
            echo -e "${YELLOW}Environment configuration needs setup${NC}"
            NEEDS_CONFIG=true
        else
            echo -e "${GREEN}[OK] Environment already configured${NC}"
            NEEDS_CONFIG=false
        fi
    else
        # Create from template
        if [ -f ".claude/mcp/.env.template" ]; then
            cp .claude/mcp/.env.template "$ENV_FILE"
            echo -e "${YELLOW}Created .env from template${NC}"
            NEEDS_CONFIG=true
        else
            echo -e "${YELLOW}[!] .env.template not found, skipping${NC}"
            return
        fi
    fi

    # Interactive configuration if needed
    if $NEEDS_CONFIG; then
        echo ""
        echo "Atlassian MCP requires API tokens. Other MCPs (context7, chrome-devtools, figma) install without credentials."
        echo ""
        read -p "Would you like to configure Atlassian API tokens now? (y/N): " -n 1 -r
        echo

        if [[ $REPLY =~ ^[Yy]$ ]]; then
            configure_api_tokens
        else
            echo ""
            echo -e "${RED}--------------------------------------------------------${NC}"
            echo -e "${RED}  IMPORTANT: Skipping Atlassian Credentials${NC}"
            echo -e "${RED}--------------------------------------------------------${NC}"
            echo ""
            echo -e "  All MCP servers will be installed regardless."
            echo -e "  Atlassian MCP ${YELLOW}will NOT connect${NC} until you add credentials."
            echo ""
            echo -e "  ${BLUE}To configure credentials later:${NC}"
            echo "    1. Edit: $ENV_FILE"
            echo "    2. Add your Jira/Confluence URL, email, and API token"
            echo "    3. Re-run: .claude/mcp/setup-mcps.sh install --only mcp-atlassian"
            echo -e "    4. ${YELLOW}Restart Claude Code${NC}"
            echo ""
            echo -e "  ${BLUE}Other MCPs (no credentials needed):${NC}"
            echo "    - context7: Works immediately"
            echo "    - chrome-devtools: Works immediately"
            echo "    - figma: Uses OAuth (authenticate via /mcp in Claude Code)"
            echo ""
        fi
    fi
}

# Function to configure API tokens interactively
configure_api_tokens() {
    echo ""
    echo -e "${BLUE}API Token Configuration${NC}"
    echo "========================"
    echo ""
    echo "Leave blank to skip any service you don't use."
    echo ""

    # Atlassian configuration
    echo -e "${YELLOW}Atlassian (Jira/Confluence)${NC}"
    read -p "Jira URL (e.g., https://company.atlassian.net): " jira_url
    if [ -n "$jira_url" ]; then
        read -p "Email: " jira_email
        read -s -p "API Token: " jira_token
        echo

        ENV_FILE=".claude/mcp/.env"
        if command -v sed_inplace &> /dev/null; then
            sed_inplace "s|JIRA_URL=.*|JIRA_URL=\"$jira_url\"|" "$ENV_FILE"
            sed_inplace "s|JIRA_USERNAME=.*|JIRA_USERNAME=\"$jira_email\"|" "$ENV_FILE"
            sed_inplace "s|JIRA_API_TOKEN=.*|JIRA_API_TOKEN=\"$jira_token\"|" "$ENV_FILE"
            sed_inplace "s|CONFLUENCE_URL=.*|CONFLUENCE_URL=\"$jira_url/wiki\"|" "$ENV_FILE"
            sed_inplace "s|CONFLUENCE_USERNAME=.*|CONFLUENCE_USERNAME=\"$jira_email\"|" "$ENV_FILE"
            sed_inplace "s|CONFLUENCE_API_TOKEN=.*|CONFLUENCE_API_TOKEN=\"$jira_token\"|" "$ENV_FILE"
        else
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i.bak "s|JIRA_URL=.*|JIRA_URL=\"$jira_url\"|" "$ENV_FILE"
                sed -i.bak "s|JIRA_USERNAME=.*|JIRA_USERNAME=\"$jira_email\"|" "$ENV_FILE"
                sed -i.bak "s|JIRA_API_TOKEN=.*|JIRA_API_TOKEN=\"$jira_token\"|" "$ENV_FILE"
                sed -i.bak "s|CONFLUENCE_URL=.*|CONFLUENCE_URL=\"$jira_url/wiki\"|" "$ENV_FILE"
                sed -i.bak "s|CONFLUENCE_USERNAME=.*|CONFLUENCE_USERNAME=\"$jira_email\"|" "$ENV_FILE"
                sed -i.bak "s|CONFLUENCE_API_TOKEN=.*|CONFLUENCE_API_TOKEN=\"$jira_token\"|" "$ENV_FILE"
                rm -f "$ENV_FILE.bak"
            else
                sed -i "s|JIRA_URL=.*|JIRA_URL=\"$jira_url\"|" "$ENV_FILE"
                sed -i "s|JIRA_USERNAME=.*|JIRA_USERNAME=\"$jira_email\"|" "$ENV_FILE"
                sed -i "s|JIRA_API_TOKEN=.*|JIRA_API_TOKEN=\"$jira_token\"|" "$ENV_FILE"
                sed -i "s|CONFLUENCE_URL=.*|CONFLUENCE_URL=\"$jira_url/wiki\"|" "$ENV_FILE"
                sed -i "s|CONFLUENCE_USERNAME=.*|CONFLUENCE_USERNAME=\"$jira_email\"|" "$ENV_FILE"
                sed -i "s|CONFLUENCE_API_TOKEN=.*|CONFLUENCE_API_TOKEN=\"$jira_token\"|" "$ENV_FILE"
            fi
        fi
    fi

    echo ""
    echo -e "${YELLOW}Figma${NC}"
    read -s -p "Figma API Key (or press Enter to skip): " figma_key
    echo
    if [ -n "$figma_key" ]; then
        if command -v sed_inplace &> /dev/null; then
            sed_inplace "s|FIGMA_API_KEY=.*|FIGMA_API_KEY=\"$figma_key\"|" "$ENV_FILE"
        else
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i.bak "s|FIGMA_API_KEY=.*|FIGMA_API_KEY=\"$figma_key\"|" "$ENV_FILE"
                rm -f "$ENV_FILE.bak"
            else
                sed -i "s|FIGMA_API_KEY=.*|FIGMA_API_KEY=\"$figma_key\"|" "$ENV_FILE"
            fi
        fi
    fi

    echo ""
    echo -e "${GREEN}[OK] API tokens configured${NC}"
}

# Function to install MCP servers
install_mcp_servers() {
    show_progress "Installing MCP servers"

    # Check if setup script exists
    if [ ! -f ".claude/mcp/setup-mcps.sh" ]; then
        echo -e "${YELLOW}[!] MCP setup script not found, skipping MCP installation${NC}"
        echo "You can install MCP servers manually later."
        return
    fi

    # Make script executable
    chmod +x .claude/mcp/setup-mcps.sh

    echo "Running MCP setup (scope: ${MCP_SCOPE:-local})..."

    # Run the MCP setup script with scope
    if MCP_SCOPE="${MCP_SCOPE:-local}" .claude/mcp/setup-mcps.sh; then
        echo -e "${GREEN}[OK] MCP servers installed${NC}"
    else
        echo -e "${YELLOW}[!] MCP setup completed with warnings${NC}"
        echo "You may need to configure API tokens and re-run .claude/mcp/setup-mcps.sh"
    fi
}

# Function to verify agent availability
verify_agents() {
    show_progress "Verifying agent availability"

    echo "Checking unified agent files..."

    local agents_ok=true

    # Check shared agents
    echo ""
    echo "Shared agents:"
    for agent in setup-agent research-agent; do
        if [ -f ".claude/agents/$agent.md" ]; then
            echo -e "${GREEN}[OK] $agent${NC}"
        else
            echo -e "${RED}[FAIL] $agent not found${NC}"
            agents_ok=false
        fi
    done

    # Check QA domain agents
    echo ""
    echo "QA domain agents:"
    for agent in qa-analysis-planning-agent qa-automation-agent qa-reporting-agent qa-defect-management-agent; do
        if [ -f ".claude/agents/$agent.md" ]; then
            echo -e "${GREEN}[OK] $agent${NC}"
        else
            echo -e "${YELLOW}[!] $agent not found (optional)${NC}"
        fi
    done

    # Check Tech Stories domain agents
    echo ""
    echo "Tech Stories domain agents:"
    for agent in story-story-agent story-tech-agent story-dashboard-agent; do
        if [ -f ".claude/agents/$agent.md" ]; then
            echo -e "${GREEN}[OK] $agent${NC}"
        else
            echo -e "${YELLOW}[!] $agent not found (optional)${NC}"
        fi
    done

    # Check CLAUDE.md
    echo ""
    if [ -f "CLAUDE.md" ]; then
        echo -e "${GREEN}[OK] CLAUDE.md workflow guide${NC}"
    else
        echo -e "${RED}[FAIL] CLAUDE.md not found${NC}"
        agents_ok=false
    fi

    # Check memory bank structure
    if [ -d ".memory-bank" ]; then
        echo -e "${GREEN}[OK] Memory bank structure${NC}"
    else
        echo -e "${RED}[FAIL] Memory bank not found${NC}"
        agents_ok=false
    fi

    # Check active-tasks structure
    if [ -d ".memory-bank/active-tasks" ]; then
        echo -e "${GREEN}[OK] Active tasks directory${NC}"
        for task_file in coding.md tech-stories.md qa.md; do
            if [ -f ".memory-bank/active-tasks/$task_file" ]; then
                echo -e "${GREEN}  [OK] active-tasks/$task_file${NC}"
            else
                echo -e "${YELLOW}  [!] active-tasks/$task_file missing${NC}"
            fi
        done
    else
        echo -e "${YELLOW}[!] Active tasks directory not found${NC}"
    fi

    if [ -f ".memory-bank/active-task.md" ]; then
        echo -e "${GREEN}[OK] Active task router (active-task.md)${NC}"
    else
        echo -e "${YELLOW}[!] Active task router not found${NC}"
    fi

    if ! $agents_ok; then
        echo -e "${RED}Some agent files are missing. Run repair mode to fix.${NC}"
        return 1
    fi

    echo ""
    echo -e "${GREEN}[OK] All agents verified${NC}"
}

# Comprehensive installation validation
validate_installation() {
    show_progress "Validating installation completeness"

    local validation_failed=false
    local report=""

    # Check core files
    report+="\n${BLUE}Core Files Validation:${NC}\n"
    local core_files=(".claude/agents/setup-agent.md" ".claude/agents/research-agent.md" "CLAUDE.md")
    for file in "${core_files[@]}"; do
        if [ -f "$file" ]; then
            report+="  [OK] $file\n"
        else
            report+="  [FAIL] $file - MISSING\n"
            validation_failed=true
        fi
    done

    # Check cross-platform utilities
    report+="\n${BLUE}Cross-Platform Utilities:${NC}\n"
    if [ -f ".claude/scripts/os-utils.sh" ]; then
        report+="  [OK] .claude/scripts/os-utils.sh\n"
    else
        report+="  [FAIL] .claude/scripts/os-utils.sh - MISSING\n"
        validation_failed=true
    fi

    # Check archive stats script
    if [ -f ".claude/scripts/update-archive-stats.sh" ]; then
        report+="  [OK] .claude/scripts/update-archive-stats.sh\n"
    else
        report+="  [!]  .claude/scripts/update-archive-stats.sh - MISSING\n"
    fi

    # Check memory bank structure
    report+="\n${BLUE}Memory Bank Structure:${NC}\n"
    local memory_files=(".memory-bank/active-task.md" ".memory-bank/active-tasks/coding.md" ".memory-bank/active-tasks/tech-stories.md" ".memory-bank/active-tasks/qa.md")
    local memory_dirs=(".memory-bank/docs/completed-tasks" ".memory-bank/docs/research-sessions" ".memory-bank/docs/best-practices" ".memory-bank/docs/decisions" ".memory-bank/docs/errors" ".memory-bank/docs/system-architecture" ".memory-bank/docs/tech-docs" ".memory-bank/docs/test-cases" ".memory-bank/docs/qa-analysis-reports" ".memory-bank/docs/reports" ".memory-bank/docs/defects")

    for file in "${memory_files[@]}"; do
        if [ -f "$file" ]; then
            report+="  [OK] $file\n"
        else
            report+="  [FAIL] $file - MISSING\n"
            validation_failed=true
        fi
    done

    for dir in "${memory_dirs[@]}"; do
        if [ -d "$dir" ]; then
            report+="  [OK] $dir/\n"
        else
            report+="  [FAIL] $dir/ - MISSING\n"
            validation_failed=true
        fi
    done

    # Check session log
    if [ -f ".memory-bank/.logs/.session-start" ]; then
        report+="  [OK] .memory-bank/.logs/.session-start\n"
    else
        report+="  [!]  .memory-bank/.logs/.session-start - MISSING\n"
    fi

    # Check MCP configuration
    report+="\n${BLUE}MCP Configuration:${NC}\n"
    if [ -d ".claude/mcp" ]; then
        report+="  [OK] MCP directory exists\n"
        if [ -f ".claude/mcp/setup-mcps.sh" ]; then
            report+="  [OK] MCP setup script available\n"
        else
            report+="  [!]  MCP setup script not found\n"
        fi
        if [ -f ".claude/mcp/.env.template" ]; then
            report+="  [OK] Environment template available\n"
        else
            report+="  [!]  Environment template not found\n"
        fi
    else
        report+="  [!]  MCP directory not found\n"
    fi

    # Check skills
    report+="\n${BLUE}Domain Skills:${NC}\n"
    if [ -d ".claude/skills" ]; then
        for skill_file in .claude/skills/*.md; do
            if [ -f "$skill_file" ]; then
                report+="  [OK] $skill_file\n"
            fi
        done
    else
        report+="  [!]  .claude/skills/ directory not found\n"
    fi

    # Check security
    report+="\n${BLUE}Security Validation:${NC}\n"
    if [ -f ".gitignore" ]; then
        if grep -q ".env" .gitignore; then
            report+="  [OK] .gitignore protects .env files\n"
        else
            report+="  [!]  .gitignore missing .env protection\n"
        fi
    else
        report+="  [!]  .gitignore not found (recommended for security)\n"
    fi

    # Output validation report
    echo -e "$report"

    if [ "$validation_failed" = true ]; then
        echo -e "\n${RED}[FAIL] Validation failed. Some components are missing.${NC}"
        echo -e "${YELLOW}Run './install.sh --repair' to fix issues${NC}"
        return 1
    else
        echo -e "\n${GREEN}[OK] Installation validation passed${NC}"
        return 0
    fi
}

# Function to run final health check
run_health_check() {
    show_progress "Running system health check"

    echo "Final verification..."
    echo ""

    # Check Claude Code
    echo -n "Claude Code CLI: "
    if claude --version &> /dev/null; then
        echo -e "${GREEN}[OK]${NC}"
    else
        echo -e "${RED}[FAIL]${NC}"
    fi

    # Check agents
    echo -n "Agent files: "
    if [ -f ".claude/agents/setup-agent.md" ] && \
       [ -f ".claude/agents/research-agent.md" ] && \
       [ -f ]; then
        echo -e "${GREEN}[OK]${NC}"
    else
        echo -e "${RED}[FAIL]${NC}"
    fi

    # Check memory bank
    echo -n "Memory bank: "
    if [ -d ".memory-bank" ] && [ -f ".memory-bank/active-task.md" ]; then
        echo -e "${GREEN}[OK]${NC}"
    else
        echo -e "${RED}[FAIL]${NC}"
    fi

    # Check active tasks
    echo -n "Active tasks: "
    if [ -f ".memory-bank/active-tasks/coding.md" ] && \
       [ -f ".memory-bank/active-tasks/tech-stories.md" ] && \
       [ -f ".memory-bank/active-tasks/qa.md" ]; then
        echo -e "${GREEN}[OK]${NC}"
    else
        echo -e "${YELLOW}[!] Some domain task files missing${NC}"
    fi

    # Check MCP configuration
    echo -n "MCP configuration: "
    if [ -f ".claude/mcp/.env" ]; then
        echo -e "${GREEN}[OK]${NC}"
    else
        echo -e "${YELLOW}[!] Needs configuration${NC}"
    fi

    # List MCP servers
    echo ""
    echo "MCP Servers Status:"
    if check_command "claude"; then
        claude mcp list 2>/dev/null || echo "  Run 'claude mcp list' after restarting Claude Code"
    fi

    echo ""
    echo -e "${GREEN}[OK] Health check complete${NC}"
}

# Function to show next steps
show_next_steps() {
    echo ""
    echo -e "${GREEN}========================================================${NC}"
    echo -e "${GREEN}     Unified AI Assistant Installation Complete!       ${NC}"
    echo -e "${GREEN}========================================================${NC}"
    echo ""
    echo -e "${BLUE}MCP scope: ${MCP_SCOPE:-local}${NC}"
    echo ""
    echo "--------------------------------------------------------"
    echo ""

    # Show Atlassian credential warning if not configured
    local env_file=".claude/mcp/.env"
    local has_atlassian_creds=false
    if [ -f "$env_file" ]; then
        set -a
        source "$env_file" 2>/dev/null || true
        set +a
        if [[ -n "${JIRA_API_TOKEN:-}" ]] && [[ "${JIRA_API_TOKEN:-}" != *"your_"*"_here" ]]; then
            has_atlassian_creds=true
        fi
    fi

    if [ "$has_atlassian_creds" = false ]; then
        echo -e "${RED}--------------------------------------------------------${NC}"
        echo -e "${RED}  IMPORTANT: Atlassian MCP Credentials Missing${NC}"
        echo -e "${RED}--------------------------------------------------------${NC}"
        echo ""
        echo -e "   Atlassian MCP is installed but ${YELLOW}will NOT connect${NC} without credentials."
        echo ""
        echo -e "   ${BLUE}To configure:${NC}"
        echo "     1. Edit: .claude/mcp/.env"
        echo "     2. Add your Jira/Confluence URL, email, and API token"
        echo "     3. Re-run: .claude/mcp/setup-mcps.sh install --only mcp-atlassian"
        echo -e "     4. ${YELLOW}Restart Claude Code${NC}"
        echo ""
        echo -e "${RED}--------------------------------------------------------${NC}"
        echo ""
    fi

    echo -e "${BLUE}Next Steps:${NC}"
    echo ""
    echo "1. Restart Claude Code to recognize MCP servers"
    echo ""
    echo "2. Authenticate Figma (OAuth):"
    echo -e "   ${YELLOW}Run /mcp in Claude Code -> select figma -> Authenticate${NC}"
    echo ""
    echo "3. Chrome DevTools MCP:"
    echo "   Chrome starts automatically when needed -- no manual setup required."
    echo ""
    echo -e "${BLUE}Quick Start Guide (by domain):${NC}"
    echo ""
    echo -e "${YELLOW}  Coding:${NC}"
    echo "    Start coding tasks, refactoring, debugging in your project"
    echo ""
    echo -e "${YELLOW}  Tech Stories:${NC}"
    echo "    Analyze and break down Jira stories into technical tasks"
    echo ""
    echo -e "${YELLOW}  QA Testing (5-phase workflow):${NC}"
    echo "    Phase 1+2: analyze ECOM-1234"
    echo "    Phase 3:   automate ECOM-1234"
    echo "    Phase 4:   report ECOM-1234"
    echo "    Phase 5:   defect"
    echo ""
    echo -e "${BLUE}Management Commands:${NC}"
    echo "  - Check MCP status: claude mcp list"
    echo "  - Repair MCPs: .claude/mcp/setup-mcps.sh repair"
    echo "  - Update MCPs: .claude/mcp/setup-mcps.sh update"
    echo ""
    echo -e "${BLUE}Status Line:${NC}"
    if [ -f "$HOME/.claude/statusline.sh" ]; then
        echo "  Unified workflow status line installed"
        echo "     Shows: Model | Context % | Active Domain | Task Key"
    else
        echo "  Status line not installed (run installer again)"
    fi
    echo ""
    echo -e "  ${YELLOW}Restart Claude Code to see status line and recognize MCP servers${NC}"
    echo ""
    echo "Happy building with your Unified AI Assistant!"
}

# Main installation flow
main() {
    clear
    show_banner

    # Check if running from within the repo itself
    if [ -f "install.sh" ] && [ -d ".git" ] && grep -q "crnogorchi-assistants" ".git/config" 2>/dev/null; then
        echo -e "${YELLOW}Warning: You appear to be running this from within the crnogorchi-assistants repo.${NC}"
        echo "For best results, run from your target project directory."
        echo ""
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 0
        fi
    fi

    # Determine what to do based on arguments
    case "${1:-}" in
        --update)
            MODE="update"
            ;;
        --repair)
            MODE="repair"
            ;;
        --verify)
            MODE="verify"
            ;;
        --help)
            echo "Usage: $0 [--update|--repair|--verify|--help]"
            echo ""
            echo "Options:"
            echo "  --update  Update existing installation"
            echo "  --repair  Repair broken installation"
            echo "  --verify  Verify installation status"
            echo "  --help    Show this help message"
            exit 0
            ;;
    esac

    # Verify mode - just check status
    if [ "$MODE" = "verify" ]; then
        TOTAL_STEPS=3
        check_claude_code
        validate_installation
        run_health_check
        exit 0
    fi

    # Full installation/update/repair flow
    check_prerequisites
    check_claude_code
    detect_existing_installation
    install_agent_files
    install_statusline
    setup_environment
    get_mcp_scope
    install_mcp_servers
    verify_agents
    validate_installation
    run_health_check

    show_next_steps
}

# Run main function
main "$@"
