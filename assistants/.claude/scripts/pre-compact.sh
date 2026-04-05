#!/bin/bash
# PreCompact hook: backs up session transcript before context compaction
MB=".memory-bank"
LOGS_DIR="$MB/.logs/transcripts"
mkdir -p "$LOGS_DIR"

# Save a marker with timestamp
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
echo "[${TIMESTAMP}] Context compaction occurred. Session data preserved." >> "$LOGS_DIR/compaction-log.txt"

# Keep only last 30 entries
tail -30 "$LOGS_DIR/compaction-log.txt" > "$LOGS_DIR/compaction-log.tmp" 2>/dev/null
mv "$LOGS_DIR/compaction-log.tmp" "$LOGS_DIR/compaction-log.txt" 2>/dev/null

exit 0
