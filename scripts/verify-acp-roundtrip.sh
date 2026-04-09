#!/usr/bin/env bash
# verify-acp-roundtrip.sh
# Verifies the ACP runtime can dispatch a real Claude Code worker that
# executes a tool and produces a verifiable side effect. Used by the
# post-merge healthcheck to catch ACP regressions after upstream merges.
#
# Exit 0: ACP dispatched a worker that actually ran a tool.
# Exit 1: gateway unreachable, worker didn't run, or side effect missing.

set -uo pipefail
LOG=/tmp/verify-acp-roundtrip.log
STAMP=$(date +%s)
MARKER="/tmp/acp-roundtrip-verify-${STAMP}.txt"
EXPECTED="ACP_ROUNDTRIP_OK_${STAMP}"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG"; }

log "=== verify-acp-roundtrip start ==="

# Step 1: Gateway up?
if ! curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3001/ | grep -q 200; then
    log "FAIL: gateway not reachable"
    exit 1
fi

# Step 2: Ask main agent to run a simple exec that writes a unique file
# The marker contains a timestamp, so the LLM can't fake it
log "Asking main agent to run exec and write marker..."
openclaw agent --agent main --thinking off --message "Run this exec command exactly (no other tools): bash -c 'echo ${EXPECTED} > ${MARKER}'. Reply only with DONE." 2>&1 | tee -a "$LOG" >/dev/null

# Step 3: Verify the side effect (wait up to 30s — openclaw agent blocks until response)
for i in 1 2 3 4 5 6; do
    [[ -f "$MARKER" ]] && break
    sleep 5
done
if [[ ! -f "$MARKER" ]]; then
    log "FAIL: marker file not created. Worker did not execute the tool."
    exit 1
fi

CONTENT=$(cat "$MARKER" 2>/dev/null || true)
if [[ "$CONTENT" != "$EXPECTED" ]]; then
    log "FAIL: marker content mismatch. Expected '$EXPECTED', got '$CONTENT'"
    rm -f "$MARKER"
    exit 1
fi

rm -f "$MARKER"
log "OK: ACP round-trip succeeded. Worker executed tool and produced verifiable side effect."
exit 0
