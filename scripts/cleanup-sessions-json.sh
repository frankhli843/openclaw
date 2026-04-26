#!/usr/bin/env bash
# One-time cleanup script for sessions.json bloat.
#
# Strips skillsSnapshot, systemPromptReport, and compactionCheckpoints from
# session entries that are in a terminal state (done/failed/killed/timeout).
# These fields account for ~97% of the file size but are not needed for
# completed sessions.
#
# Safe to run while the gateway is running (operates on a copy and does an
# atomic rename). However, if the gateway writes to sessions.json between
# the read and the rename, those writes will be lost. For best results,
# run during a quiet period or when the gateway is stopped.
#
# Usage: bash scripts/cleanup-sessions-json.sh [path-to-sessions.json]

set -euo pipefail

SESSIONS_FILE="${1:-$HOME/.openclaw/agents/main/sessions/sessions.json}"
BACKUP_FILE="${SESSIONS_FILE}.backup-$(date +%Y%m%d-%H%M%S)"
TEMP_FILE="${SESSIONS_FILE}.cleanup-tmp"

if [ ! -f "$SESSIONS_FILE" ]; then
  echo "ERROR: sessions.json not found at $SESSIONS_FILE"
  exit 1
fi

BEFORE_SIZE=$(stat -c%s "$SESSIONS_FILE")
echo "Before: $(numfmt --to=iec $BEFORE_SIZE) ($BEFORE_SIZE bytes)"
echo "Backing up to $BACKUP_FILE"
cp "$SESSIONS_FILE" "$BACKUP_FILE"

python3 -c "
import json, sys

with open('$SESSIONS_FILE') as f:
    store = json.load(f)

terminal = {'done', 'failed', 'killed', 'timeout'}
bloat_fields = ['skillsSnapshot', 'systemPromptReport', 'compactionCheckpoints']
slimmed = 0
bytes_saved = 0

for key, entry in store.items():
    if not entry:
        continue
    status = entry.get('status', '')
    is_terminal = status in terminal
    is_reaped = '_reaped_by' in entry
    if is_terminal or is_reaped:
        for field in bloat_fields:
            if field in entry:
                bytes_saved += len(json.dumps(entry[field]))
                del entry[field]
                slimmed += 1

with open('$TEMP_FILE', 'w') as f:
    json.dump(store, f, indent=2)
    f.write('\n')

print(f'Slimmed {slimmed} fields from terminal/reaped entries')
print(f'Estimated bytes saved: {bytes_saved:,}')
"

if [ -f "$TEMP_FILE" ]; then
  AFTER_SIZE=$(stat -c%s "$TEMP_FILE")
  echo "After:  $(numfmt --to=iec $AFTER_SIZE) ($AFTER_SIZE bytes)"
  echo "Reduction: $(numfmt --to=iec $((BEFORE_SIZE - AFTER_SIZE)))"
  mv "$TEMP_FILE" "$SESSIONS_FILE"
  echo "Done. Backup at $BACKUP_FILE"
else
  echo "ERROR: Cleanup failed, no temp file created"
  exit 1
fi
