#!/bin/bash
# Session Start Hook — Injects discovery context into every Claude Code session
# Reads from .memory-bank/ and outputs as additionalContext

CWD="${1:-.}"
if [ "$CWD" = "." ]; then CWD="$(pwd)"; fi

MB="$CWD/.memory-bank"
DISC="$MB/docs/discovery"

# Session ID
SESSION_ID="$(date +%s)-$$"
mkdir -p "$MB/.logs"
echo "$SESSION_ID" > "$MB/.logs/.session-start"
echo "[$(date +"%Y-%m-%d %H:%M:%S")] [Session: $SESSION_ID] Session started" >> "$MB/.logs/session-history.log"

OUTPUT=""

# --- Project Brief (first 15 lines) ---
if [ -f "$MB/project-brief.md" ]; then
    BRIEF=$(head -15 "$MB/project-brief.md" 2>/dev/null | grep -v "^---$" | grep -v "^category:" | grep -v "^status:")
    if [ -n "$BRIEF" ]; then
        OUTPUT+="PROJECT: $BRIEF\n"
    fi
fi

# --- Active Task ---
if [ -f "$MB/active-task.md" ]; then
    DOMAIN=$(grep -E '^## Current Domain:' "$MB/active-task.md" 2>/dev/null | sed 's/^## Current Domain: //')
    if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "none" ]; then
        OUTPUT+="ACTIVE DOMAIN: $DOMAIN\n"
        TASK_FILE="$MB/active-tasks/${DOMAIN}.md"
        if [ -f "$TASK_FILE" ]; then
            TASK_NAME=$(head -1 "$TASK_FILE" 2>/dev/null | sed 's/^# Active Task: //')
            OUTPUT+="ACTIVE TASK: $TASK_NAME\n"
        fi
    fi
fi

# --- Readiness Score ---
if [ -f "$DISC/readiness.md" ]; then
    SCORE=$(grep -oE '[0-9]+\.[0-9]+%' "$DISC/readiness.md" 2>/dev/null | head -1)
    if [ -n "$SCORE" ]; then
        OUTPUT+="READINESS: $SCORE\n"
    fi
fi

# --- Gap Count ---
if [ -f "$DISC/requirements.md" ]; then
    TOTAL=$(grep -c '^\|' "$DISC/requirements.md" 2>/dev/null)
    TOTAL=$((TOTAL - 2))  # subtract header + separator
    [ "$TOTAL" -lt 0 ] && TOTAL=0
    OUTPUT+="REQUIREMENTS: $TOTAL total\n"
fi

# --- Contradictions ---
if [ -f "$DISC/contradictions.md" ]; then
    CONTRAS=$(grep -c '^\-' "$DISC/contradictions.md" 2>/dev/null)
    if [ "$CONTRAS" -gt 0 ]; then
        OUTPUT+="CONTRADICTIONS: $CONTRAS unresolved\n"
    fi
fi

# --- Key Decisions (last 3) ---
if [ -f "$MB/key-decisions.md" ]; then
    DECS=$(grep -E '^\-' "$MB/key-decisions.md" 2>/dev/null | tail -3)
    if [ -n "$DECS" ]; then
        OUTPUT+="RECENT DECISIONS:\n$DECS\n"
    fi
fi

# --- Gotchas ---
if [ -f "$MB/gotchas.md" ]; then
    GOTCHAS=$(grep -E '^\-' "$MB/gotchas.md" 2>/dev/null | head -5)
    if [ -n "$GOTCHAS" ]; then
        OUTPUT+="GOTCHAS:\n$GOTCHAS\n"
    fi
fi

# --- Last 3 sessions ---
if [ -f "$MB/.logs/session-history.log" ]; then
    RECENT=$(tail -6 "$MB/.logs/session-history.log" 2>/dev/null | head -3)
    if [ -n "$RECENT" ]; then
        OUTPUT+="RECENT SESSIONS:\n$RECENT\n"
    fi
fi

# Output
if [ -n "$OUTPUT" ]; then
    printf "%b" "$OUTPUT"
fi

exit 0
