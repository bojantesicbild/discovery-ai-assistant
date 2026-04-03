#!/bin/bash

# OS Detection and Cross-Platform Utilities
# Shared utilities for cross-platform compatibility across install.sh, update-archive-stats.sh, and setup-mcps.sh

# Detect operating system
detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "linux"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        echo "windows_bash"
    elif [[ "$OS" == "Windows_NT" ]]; then
        echo "windows"
    else
        echo "unknown"
    fi
}

# Cross-platform URL opener
open_url() {
    local url="$1"
    local os_type=$(detect_os)
    
    case "$os_type" in
        "macos")
            open "$url"
            ;;
        "linux")
            xdg-open "$url"
            ;;
        "windows_bash"|"windows")
            if command -v start &> /dev/null; then
                start "$url"
            elif command -v cmd.exe &> /dev/null; then
                cmd.exe /c start "$url"
            else
                echo "Please open: $url"
            fi
            ;;
        *)
            echo "Please open: $url"
            ;;
    esac
}

# Cross-platform sed in-place editing
sed_inplace() {
    local pattern="$1"
    local file="$2"
    local os_type=$(detect_os)
    
    case "$os_type" in
        "macos")
            sed -i.bak "$pattern" "$file"
            rm -f "$file.bak"
            ;;
        "linux"|"windows_bash")
            sed -i "$pattern" "$file"
            ;;
        *)
            # Fallback: create temp file
            local temp_file=$(mktemp_cross_platform)
            sed "$pattern" "$file" > "$temp_file"
            mv "$temp_file" "$file"
            ;;
    esac
}

# Cross-platform temporary file creation
mktemp_cross_platform() {
    local os_type=$(detect_os)
    
    case "$os_type" in
        "macos"|"linux")
            mktemp
            ;;
        "windows_bash")
            mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/temp_$$_$(date +%s)"
            ;;
        "windows")
            echo "${TEMP:-/tmp}/temp_$$_$(date +%s)"
            ;;
        *)
            echo "/tmp/temp_$$_$(date +%s)"
            ;;
    esac
}

# Cross-platform file modification time
get_file_mtime() {
    local file="$1"
    local os_type=$(detect_os)
    
    case "$os_type" in
        "macos")
            stat -f "%m" "$file" 2>/dev/null
            ;;
        "linux"|"windows_bash")
            stat -c "%Y" "$file" 2>/dev/null
            ;;
        *)
            # Fallback using ls (less precise)
            ls -la "$file" 2>/dev/null | awk '{print $6 " " $7 " " $8}'
            ;;
    esac
}

# Cross-platform file modification time with filename
get_file_mtime_and_name() {
    local file="$1"
    local os_type=$(detect_os)
    
    case "$os_type" in
        "macos")
            stat -f "%m %N" "$file" 2>/dev/null
            ;;
        "linux"|"windows_bash")
            stat -c "%Y %n" "$file" 2>/dev/null
            ;;
        *)
            # Fallback
            local mtime=$(get_file_mtime "$file")
            echo "$mtime $file"
            ;;
    esac
}

# Cross-platform date formatting
format_date() {
    local format="$1"
    local os_type=$(detect_os)
    
    case "$os_type" in
        "macos"|"linux"|"windows_bash")
            date "$format"
            ;;
        "windows")
            # PowerShell fallback for Windows
            if command -v powershell.exe &> /dev/null; then
                powershell.exe -Command "Get-Date -Format 'yyyy-MM-dd HH:mm'"
            else
                date "$format" 2>/dev/null || echo "$(date)"
            fi
            ;;
        *)
            date "$format" 2>/dev/null || echo "$(date)"
            ;;
    esac
}

# Cross-platform word count for lines
count_lines() {
    local input="$1"
    local os_type=$(detect_os)
    
    case "$os_type" in
        "macos"|"linux"|"windows_bash")
            echo "$input" | wc -l | tr -d ' '
            ;;
        *)
            # Fallback without tr
            echo "$input" | wc -l | sed 's/^[[:space:]]*//'
            ;;
    esac
}

# Cross-platform path handling
normalize_path() {
    local path="$1"
    local os_type=$(detect_os)
    
    case "$os_type" in
        "windows")
            # Convert forward slashes to backslashes for Windows
            echo "$path" | sed 's|/|\\|g'
            ;;
        *)
            echo "$path"
            ;;
    esac
}

# Get default MCP servers directory
get_mcp_servers_dir() {
    local os_type=$(detect_os)
    
    case "$os_type" in
        "windows")
            echo "${USERPROFILE}/projects/mcp-servers"
            ;;
        *)
            echo "${HOME}/projects/mcp-servers"
            ;;
    esac
}

# Check if running in Windows environment
is_windows() {
    local os_type=$(detect_os)
    [[ "$os_type" == "windows"* ]]
}

# Check if running in Unix-like environment
is_unix_like() {
    local os_type=$(detect_os)
    [[ "$os_type" == "macos" ]] || [[ "$os_type" == "linux" ]] || [[ "$os_type" == "windows_bash" ]]
}

# Get appropriate shell extension
get_shell_extension() {
    local os_type=$(detect_os)

    case "$os_type" in
        "windows")
            echo "ps1"  # PowerShell
            ;;
        *)
            echo "sh"   # Shell script
            ;;
    esac
}

# Get appropriate archive statistics script for current platform
get_archive_script() {
    local script_dir="${1:-$(dirname "${BASH_SOURCE[0]}")}"
    local os_type=$(detect_os)

    case "$os_type" in
        "windows")
            # Native Windows - use PowerShell
            echo "$script_dir/update-archive-stats.ps1"
            ;;
        "macos"|"linux"|"windows_bash")
            # Unix-like environments - use bash
            echo "$script_dir/update-archive-stats.sh"
            ;;
        *)
            # Unknown OS - default to bash
            echo "$script_dir/update-archive-stats.sh"
            ;;
    esac
}

# Print OS information
print_os_info() {
    local os_type=$(detect_os)
    echo "Detected OS: $os_type"
    echo "OSTYPE: ${OSTYPE:-not set}"
    echo "OS env var: ${OS:-not set}"
    echo "Shell: $0"
    echo "Unix-like: $(is_unix_like && echo "yes" || echo "no")"
    echo "Windows: $(is_windows && echo "yes" || echo "no")"
}

# Export functions for sourcing
export -f detect_os
export -f open_url
export -f sed_inplace
export -f mktemp_cross_platform
export -f get_file_mtime
export -f get_file_mtime_and_name
export -f format_date
export -f count_lines
export -f normalize_path
export -f get_mcp_servers_dir
export -f is_windows
export -f is_unix_like
export -f get_shell_extension
export -f get_archive_script
export -f print_os_info