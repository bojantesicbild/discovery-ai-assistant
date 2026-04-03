#!/bin/bash

# Archive Statistics Update Script (Unified Assistant)
# Updates archive-index.md with current file counts and recent activity
# Supports all domains: coding, tech-stories, QA
# Usage: ./update-archive-stats.sh [config-file]

set -e

# Load cross-platform utilities
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/os-utils.sh" ]; then
    source "$SCRIPT_DIR/os-utils.sh"
else
    echo "Warning: Cross-platform utilities not found at $SCRIPT_DIR/os-utils.sh"
fi

# Configuration
RECENT_COUNT=10
MEMORY_BANK_DIR="$SCRIPT_DIR/../../.memory-bank"
DOCS_DIR="$MEMORY_BANK_DIR/docs"
ARCHIVE_INDEX="$MEMORY_BANK_DIR/archive-index.md"
DATE_FORMAT="+%Y-%m-%d %H:%M"
TITLE_FORMAT="capitalize"

# Resolve paths
if [ ! -d "$MEMORY_BANK_DIR" ]; then
    echo "Error: Memory bank directory not found at $MEMORY_BANK_DIR"
    exit 1
fi

MEMORY_BANK_DIR="$(cd "$MEMORY_BANK_DIR" && pwd)"
DOCS_DIR="$(cd "$DOCS_DIR" 2>/dev/null && pwd || echo "$DOCS_DIR")"

echo "Updating archive stats for unified assistant..."
echo "  Memory Bank: $MEMORY_BANK_DIR"
echo "  Docs Dir: $DOCS_DIR"

# Count files in each category (excluding index files)
count_dir() {
    local dir="$1"
    local ext="${2:-*.md}"
    find "$dir" -name "$ext" -not -name "*-index.md" -type f 2>/dev/null | wc -l | tr -d ' '
}

# Shared directories
COMPLETED_TASKS=$(count_dir "$DOCS_DIR/completed-tasks")
RESEARCH_SESSIONS=$(count_dir "$DOCS_DIR/research-sessions")
ARCHITECTURE_PATTERNS=$(count_dir "$DOCS_DIR/system-architecture")
BEST_PRACTICES=$(count_dir "$DOCS_DIR/best-practices")
ERROR_SOLUTIONS=$(count_dir "$DOCS_DIR/errors")
DECISIONS=$(count_dir "$DOCS_DIR/decisions")

# Story domain
TECH_DOCS=$(count_dir "$DOCS_DIR/tech-docs")

# QA domain
TEST_CASES=$(count_dir "$DOCS_DIR/test-cases" "*.csv")
QA_REPORTS=$(count_dir "$DOCS_DIR/qa-analysis-reports")
EXEC_REPORTS=$(count_dir "$DOCS_DIR/reports")
DEFECTS=$(count_dir "$DOCS_DIR/defects")

# Totals
TOTAL_ITEMS=$((COMPLETED_TASKS + RESEARCH_SESSIONS))
TOTAL_KNOWLEDGE=$((ARCHITECTURE_PATTERNS + BEST_PRACTICES + ERROR_SOLUTIONS + DECISIONS))
TOTAL_STORY=$((TECH_DOCS))
TOTAL_QA=$((TEST_CASES + QA_REPORTS + EXEC_REPORTS + DEFECTS))

# Generate timestamp
TIMESTAMP=$(date "$DATE_FORMAT" 2>/dev/null || date)

# Function to format titles
format_title() {
    local title="$1"
    echo "$title" | tr '_-' ' ' | awk '{for(i=1;i<=NF;i++){$i=toupper(substr($i,1,1)) substr($i,2)}} 1'
}

# Get recent files across all directories
echo "Gathering recent $RECENT_COUNT files..."
RECENT_FILES=""
if [ -d "$DOCS_DIR" ]; then
    temp_file=$(mktemp 2>/dev/null || echo "/tmp/archive_temp_$$")

    if [[ "$OSTYPE" == "darwin"* ]]; then
        find "$DOCS_DIR" -name "*.md" -not -name "*-index.md" -type f -exec stat -f "%m %N" {} \; 2>/dev/null | sort -nr | head -"$RECENT_COUNT" | cut -d' ' -f2- > "$temp_file"
    else
        find "$DOCS_DIR" -name "*.md" -not -name "*-index.md" -type f -exec stat -c "%Y %n" {} \; 2>/dev/null | sort -nr | head -"$RECENT_COUNT" | cut -d' ' -f2- > "$temp_file"
    fi

    while IFS= read -r file; do
        if [ -n "$file" ]; then
            filename=$(basename "$file" .md)
            if [[ $filename =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2})_(.+)$ ]]; then
                date_part="${BASH_REMATCH[1]}"
                title_part="${BASH_REMATCH[2]}"
                display_title=$(format_title "$title_part")
                relative_path="docs/${file#$DOCS_DIR/}"
                RECENT_FILES="$RECENT_FILES\n- $date_part: [$display_title]($relative_path)"
            else
                display_title=$(format_title "$filename")
                relative_path="docs/${file#$DOCS_DIR/}"
                RECENT_FILES="$RECENT_FILES\n- [$display_title]($relative_path)"
            fi
        fi
    done < "$temp_file"
    rm -f "$temp_file"
fi

if [ -z "$RECENT_FILES" ]; then
    RECENT_FILES="\n- No items archived yet - ready for first project work"
fi

# Generate archive-index.md
cat > "$ARCHIVE_INDEX" << EOF
# Archive Index - Knowledge Navigation Hub

<!-- AUTO-GENERATED — do not edit manually -->
## Statistics (Last Updated: $TIMESTAMP)

**Archived Items**: $TOTAL_ITEMS
- Completed Tasks: $COMPLETED_TASKS
- Research Sessions: $RESEARCH_SESSIONS

**Shared Knowledge**: $TOTAL_KNOWLEDGE
- Architecture Patterns: $ARCHITECTURE_PATTERNS
- Best Practices: $BEST_PRACTICES
- Error Solutions: $ERROR_SOLUTIONS
- Technical Decisions: $DECISIONS

**Story Domain**: $TOTAL_STORY
- Tech Docs: $TECH_DOCS

**QA Domain**: $TOTAL_QA
- Test Cases (CSV): $TEST_CASES
- Analysis Reports: $QA_REPORTS
- Execution Reports: $EXEC_REPORTS
- Defects: $DEFECTS

## Recent Activity (Last $RECENT_COUNT Items)$(echo -e "$RECENT_FILES")

## Quick Navigation

### Shared Knowledge
- [docs/completed-tasks/](docs/completed-tasks/) — Implementation records
- [docs/research-sessions/](docs/research-sessions/) — Research findings
- [docs/system-architecture/](docs/system-architecture/) — Architecture patterns
- [docs/best-practices/](docs/best-practices/) — Guidelines
- [docs/decisions/](docs/decisions/) — Technical decisions
- [docs/errors/](docs/errors/) — Error documentation

### Story Domain
- [docs/tech-docs/](docs/tech-docs/) — Technical documentation

### QA Domain
- [docs/test-cases/](docs/test-cases/) — Test case CSVs
- [docs/qa-analysis-reports/](docs/qa-analysis-reports/) — Analysis reports
- [docs/reports/](docs/reports/) — Execution reports
- [docs/defects/](docs/defects/) — Defect records

---
*Auto-generated by update-archive-stats.sh*
EOF

# Update individual category indexes (on-demand — only if directory has content)
update_category_index() {
    local category="$1"
    local title="$2"
    local directory="$3"
    local ext="${4:-*.md}"

    local file_count=$(find "$directory" -name "$ext" -not -name "*-index.md" -type f 2>/dev/null | wc -l | tr -d ' ')

    # Only create/update index if directory has content
    if [ "$file_count" -eq 0 ]; then
        return
    fi

    local index_file="$DOCS_DIR/${category}-index.md"
    echo "Updating $title index ($file_count files)..."

    local recent_entries=""
    local temp_cat=$(mktemp 2>/dev/null || echo "/tmp/cat_temp_$$")

    if [[ "$OSTYPE" == "darwin"* ]]; then
        find "$directory" -name "$ext" -not -name "*-index.md" -type f -exec stat -f "%m %N" {} \; 2>/dev/null | sort -nr | head -5 | cut -d' ' -f2- > "$temp_cat"
    else
        find "$directory" -name "$ext" -not -name "*-index.md" -type f -exec stat -c "%Y %n" {} \; 2>/dev/null | sort -nr | head -5 | cut -d' ' -f2- > "$temp_cat"
    fi

    while IFS= read -r file; do
        if [ -n "$file" ]; then
            filename=$(basename "$file" .md)
            display_title=$(format_title "$filename")
            recent_entries="$recent_entries\n- [$display_title](${category}/${file##*/})"
        fi
    done < "$temp_cat"
    rm -f "$temp_cat"

    if [ -z "$recent_entries" ]; then
        recent_entries="\n- No items yet"
    fi

    cat > "$index_file" << EOF
# $title Index

Total: $file_count items

## Recent$(echo -e "$recent_entries")

---
*Auto-generated by update-archive-stats.sh*
EOF
}

# Shared directories
update_category_index "completed-tasks" "Completed Tasks" "$DOCS_DIR/completed-tasks"
update_category_index "research-sessions" "Research Sessions" "$DOCS_DIR/research-sessions"
update_category_index "system-architecture" "System Architecture" "$DOCS_DIR/system-architecture"
update_category_index "best-practices" "Best Practices" "$DOCS_DIR/best-practices"
update_category_index "errors" "Errors & Solutions" "$DOCS_DIR/errors"
update_category_index "decisions" "Technical Decisions" "$DOCS_DIR/decisions"

# Story domain
update_category_index "tech-docs" "Tech Documentation" "$DOCS_DIR/tech-docs"

# QA domain
update_category_index "test-cases" "Test Cases" "$DOCS_DIR/test-cases" "*.csv"
update_category_index "qa-analysis-reports" "QA Analysis Reports" "$DOCS_DIR/qa-analysis-reports"
update_category_index "reports" "Execution Reports" "$DOCS_DIR/reports"
update_category_index "defects" "Defects" "$DOCS_DIR/defects"

echo ""
echo "[OK] Archive stats updated!"
echo "  Total Items: $TOTAL_ITEMS | Knowledge: $TOTAL_KNOWLEDGE | Story: $TOTAL_STORY | QA: $TOTAL_QA"
