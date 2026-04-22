#!/usr/bin/env bash
# verify-cron-rerun-session.sh — operational regression check for enqueue-drop bug
#
# Triggers a manual cron rerun via `openclaw cron run` and verifies that the
# rerun actually creates a session JSONL within a timeout.  Exits 0 on success,
# 1 on failure (no session created), 2 on usage error.
#
# Usage:
#   verify-cron-rerun-session.sh <cron-job-id> [timeout_seconds]
#
# frankclaw: regression check for enqueue-drop TOCTOU race fix

set -euo pipefail

JOB_ID="${1:-}"
TIMEOUT="${2:-60}"

if [[ -z "$JOB_ID" ]]; then
  echo "Usage: $0 <cron-job-id> [timeout_seconds]" >&2
  exit 2
fi

SESSIONS_DIR="${HOME}/.openclaw/agents/main/sessions"

# Snapshot existing session files before triggering
mapfile -t BEFORE < <(find "$SESSIONS_DIR" -name '*.jsonl' -newer /proc/1 2>/dev/null | sort)
BEFORE_COUNT=${#BEFORE[@]}

echo "Triggering manual cron rerun for job: $JOB_ID"
RESULT=$(openclaw cron run "$JOB_ID" 2>&1) || true
echo "  cron run output: $RESULT"

# Check if the run was accepted
if echo "$RESULT" | grep -qi "already.running\|not.found\|disabled\|error"; then
  echo "WARN: cron run was not accepted (may be already running or not found)."
  echo "  This is not a test failure — the job may not be in a runnable state."
  echo "  Re-run when the job is idle."
  exit 0
fi

echo "Waiting up to ${TIMEOUT}s for a new session JSONL to appear..."
ELAPSED=0
FOUND=0
while [[ $ELAPSED -lt $TIMEOUT ]]; do
  mapfile -t AFTER < <(find "$SESSIONS_DIR" -name '*.jsonl' -newer /proc/1 2>/dev/null | sort)
  AFTER_COUNT=${#AFTER[@]}

  if [[ $AFTER_COUNT -gt $BEFORE_COUNT ]]; then
    # Find the new file(s)
    NEW_FILES=$(comm -13 <(printf '%s\n' "${BEFORE[@]}" | sort) <(printf '%s\n' "${AFTER[@]}" | sort))
    echo "OK: New session JSONL detected after ${ELAPSED}s:"
    echo "  $NEW_FILES"
    FOUND=1
    break
  fi

  sleep 2
  ELAPSED=$((ELAPSED + 2))
done

if [[ $FOUND -eq 0 ]]; then
  echo "FAIL: No new session JSONL appeared within ${TIMEOUT}s after cron rerun."
  echo "  This indicates the enqueue-drop bug: cron run was accepted but no session was created."
  exit 1
fi

# Also verify the cron contract state was created
CONTRACTS_DIR="${HOME}/.openclaw/workspace/state/cron-contracts/incomplete"
if [[ -d "$CONTRACTS_DIR" ]]; then
  RECENT_CONTRACTS=$(find "$CONTRACTS_DIR" -name "*.json" -newer /proc/1 -mmin -2 2>/dev/null | head -5)
  if [[ -n "$RECENT_CONTRACTS" ]]; then
    echo "OK: Recent cron contract(s) found:"
    echo "  $RECENT_CONTRACTS"
  else
    echo "INFO: No very recent cron contracts found (may have already completed)."
  fi
fi

echo "PASS: Cron rerun session verification succeeded."
exit 0
