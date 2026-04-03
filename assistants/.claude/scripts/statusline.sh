#!/bin/bash
# Unified Assistant Statusline
# Shows: Model | Context% | Domain | Progress | Task/Story
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name // .model.id // "Claude"')

# Context window info
CTX_USED_PCT=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

CWD=$(echo "$input" | jq -r '.cwd // empty')
if [ -z "$CWD" ] || [ "$CWD" = "." ]; then
    CWD="$(pwd)"
fi

STATUS_INFO=""
ROUTER="${CWD}/.memory-bank/active-task.md"

if [ -f "$ROUTER" ]; then
    # Detect active domain from router
    DOMAIN=$(grep -E '^## Current Domain:' "$ROUTER" 2>/dev/null | sed 's/^## Current Domain: //' | tr -d '[:space:]')

    if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "none" ]; then
        # Domain label with color
        case "$DOMAIN" in
            coding)       DOMAIN_COLOR="\033[34m" ; LABEL="CODE" ;;
            tech-stories) DOMAIN_COLOR="\033[33m" ; LABEL="STORY" ;;
            qa)           DOMAIN_COLOR="\033[31m" ; LABEL="QA" ;;
            *)            DOMAIN_COLOR="\033[36m" ; LABEL="$DOMAIN" ;;
        esac
        STATUS_INFO+=" | ${DOMAIN_COLOR}${LABEL}\033[0m"

        # Read domain-specific active task
        TASK_FILE="${CWD}/.memory-bank/active-tasks/${DOMAIN}.md"
        if [ -f "$TASK_FILE" ]; then
            # Progress from checkboxes in Workflow State section
            WORKFLOW_SECTION=$(sed -n '/^## .*Workflow/,/^---$/p' "$TASK_FILE" 2>/dev/null)
            if [ -z "$WORKFLOW_SECTION" ]; then
                # Fallback: count all checkboxes in file
                WORKFLOW_SECTION=$(cat "$TASK_FILE" 2>/dev/null)
            fi

            COMPLETED=$(echo "$WORKFLOW_SECTION" | grep -c '\[x\]' 2>/dev/null | tr -d '\n')
            COMPLETED=${COMPLETED:-0}
            TOTAL=$(echo "$WORKFLOW_SECTION" | grep -cE '\[[ x]\]' 2>/dev/null | tr -d '\n')
            TOTAL=${TOTAL:-0}

            if [ "$TOTAL" -gt 0 ] 2>/dev/null; then
                PROGRESS=$((COMPLETED * 100 / TOTAL))
                if [ $PROGRESS -gt 66 ]; then
                    PROG_COLOR="\033[32m"
                elif [ $PROGRESS -gt 33 ]; then
                    PROG_COLOR="\033[33m"
                else
                    PROG_COLOR="\033[31m"
                fi
                STATUS_INFO+=" | ${PROG_COLOR}${COMPLETED}/${TOTAL} (${PROGRESS}%)\033[0m"
            fi

            # Extract task name or story key
            TASK_NAME=$(head -1 "$TASK_FILE" 2>/dev/null | sed 's/^# Active Task: //' | sed 's/ - [0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}.*//' | cut -c1-35)
            # Check for Jira key pattern (QA domain)
            STORY_KEY=$(grep -oE '[A-Z]+-[0-9]+' "$TASK_FILE" 2>/dev/null | head -1)

            if [ -n "$STORY_KEY" ] && [ "$STORY_KEY" != "STORY_KEY" ]; then
                STATUS_INFO+=" | \033[36m${STORY_KEY}\033[0m"
            elif [ -n "$TASK_NAME" ] && [[ ! "$TASK_NAME" =~ \[.*\] ]]; then
                STATUS_INFO+=" | \033[36m${TASK_NAME}\033[0m"
            fi

            # Last completed step
            CURRENT_STEP=$(grep -E '^\- \[x\]' "$TASK_FILE" 2>/dev/null | tail -1 | sed 's/^- \[x\] //' | cut -c1-25)
            if [ -n "$CURRENT_STEP" ] && [[ ! "$CURRENT_STEP" =~ \[.*\] ]]; then
                STATUS_INFO+=" | ${CURRENT_STEP}..."
            fi
        fi

        # QA: show test results if available
        if [ "$DOMAIN" = "qa" ]; then
            TEST_RESULTS="${CWD}/e2e/test-results/.last-run.json"
            if [ -f "$TEST_RESULTS" ]; then
                PASSED=$(jq '[.suites[].specs[] | select(.ok==true)] | length' "$TEST_RESULTS" 2>/dev/null)
                TOTAL_TESTS=$(jq '[.suites[].specs[]] | length' "$TEST_RESULTS" 2>/dev/null)
                if [ -n "$TOTAL_TESTS" ] && [ "$TOTAL_TESTS" -gt 0 ] 2>/dev/null; then
                    if [ "$PASSED" -eq "$TOTAL_TESTS" ]; then
                        STATUS_INFO+=" | \033[32m${PASSED}/${TOTAL_TESTS}\033[0m"
                    else
                        STATUS_INFO+=" | \033[31m${PASSED}/${TOTAL_TESTS}\033[0m"
                    fi
                fi
            fi
        fi
    else
        STATUS_INFO+=" | \033[90mReady\033[0m"
    fi
fi

# --- Build output ---
OUTPUT=""

# Model
OUTPUT+="\033[35m${MODEL}\033[0m"

# Context window usage
if [ -n "$CTX_USED_PCT" ] && [ "$CTX_USED_PCT" != "null" ]; then
    PCT_INT=${CTX_USED_PCT%.*}
    PCT_INT=${PCT_INT:-0}

    if [ "$PCT_INT" -gt 80 ] 2>/dev/null; then
        CTX_COLOR="\033[31m"
    elif [ "$PCT_INT" -gt 50 ] 2>/dev/null; then
        CTX_COLOR="\033[33m"
    else
        CTX_COLOR="\033[32m"
    fi
    OUTPUT+=" | ${CTX_COLOR}Ctx: ${PCT_INT}%\033[0m"
fi

# Domain + task info
[ -n "$STATUS_INFO" ] && OUTPUT+="$STATUS_INFO"

printf "%b" "$OUTPUT"

exit 0
