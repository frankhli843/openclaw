#!/usr/bin/env bash
# frankclaw: Dead-letter recovery script
# Moves dead-lettered Discord inbound queue jobs back to the active queue,
# preserving ordering by enqueuedAt timestamp.
#
# Usage:
#   deadletter-recover.sh [--dry-run] [--account ACCOUNT] [--max N]
#
# Options:
#   --dry-run    Show what would be recovered without moving files
#   --account    Queue account (default: "default")
#   --max N      Maximum number of jobs to recover (default: all)

set -euo pipefail

DRY_RUN=false
ACCOUNT="default"
MAX_JOBS=0  # 0 = unlimited

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --account) ACCOUNT="$2"; shift 2 ;;
    --max) MAX_JOBS="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

QUEUE_DIR="$HOME/.openclaw/discord-inbound-queue/$ACCOUNT"
DEAD_DIR="$QUEUE_DIR/dead"

if [[ ! -d "$DEAD_DIR" ]]; then
  echo "No dead-letter directory found at $DEAD_DIR"
  exit 0
fi

DEAD_COUNT=$(find "$DEAD_DIR" -name '*.json' -type f 2>/dev/null | wc -l)
if [[ "$DEAD_COUNT" -eq 0 ]]; then
  echo "No dead-lettered jobs to recover"
  exit 0
fi

echo "Found $DEAD_COUNT dead-lettered jobs in $DEAD_DIR"

# Sort by enqueuedAt to preserve message ordering
SORTED_FILES=$(python3 -c "
import json, os, sys
dead_dir = '$DEAD_DIR'
jobs = []
for f in os.listdir(dead_dir):
    if not f.endswith('.json'):
        continue
    path = os.path.join(dead_dir, f)
    try:
        with open(path) as fh:
            d = json.load(fh)
        jobs.append((d.get('enqueuedAt', 0), f, path))
    except:
        pass
jobs.sort(key=lambda x: x[0])
for _, f, path in jobs:
    print(path)
")

RECOVERED=0
while IFS= read -r dead_file; do
  if [[ "$MAX_JOBS" -gt 0 && "$RECOVERED" -ge "$MAX_JOBS" ]]; then
    break
  fi

  BASENAME=$(basename "$dead_file")
  ACTIVE_FILE="$QUEUE_DIR/$BASENAME"

  # Read job info for logging
  INFO=$(python3 -c "
import json, sys
with open('$dead_file') as f:
    d = json.load(f)
evt = d.get('event', {})
ch = evt.get('channelId', '?')
msg = evt.get('messageId', '?')
attempts = d.get('attempts', '?')
err = d.get('lastError', '')[:100]
print(f'channel={ch} msg={msg} attempts={attempts} error={err}')
" 2>&1)

  if $DRY_RUN; then
    echo "  [dry-run] would recover: $BASENAME ($INFO)"
  else
    # Reset attempts and state, move back to active queue
    python3 -c "
import json, time
with open('$dead_file') as f:
    d = json.load(f)
d['attempts'] = 0
d['state'] = 'queued'
d['updatedAt'] = int(time.time() * 1000)
d['leaseUntil'] = None
d['nextAttemptAt'] = int(time.time() * 1000)
d['lastError'] = None
with open('$ACTIVE_FILE', 'w') as f:
    json.dump(d, f, indent=2)
" && rm "$dead_file"
    echo "  recovered: $BASENAME ($INFO)"
  fi
  RECOVERED=$((RECOVERED + 1))
done <<< "$SORTED_FILES"

echo ""
if $DRY_RUN; then
  echo "Dry run complete. Would recover $RECOVERED jobs."
else
  echo "Recovered $RECOVERED dead-lettered jobs back to active queue."
  echo "The gateway's durable queue will pick them up on the next poll cycle."
fi
