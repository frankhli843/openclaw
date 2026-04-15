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

# Step 0: Ensure the `openclaw` CLI can actually start.
#
# `/usr/bin/openclaw` is a `#!/usr/bin/env node` script with a hard minimum
# Node version check (currently >=22.12). When this script is invoked from a
# shell where nvm has put an older Node (e.g. v20) ahead of /usr/bin on PATH,
# `env node` picks up the nvm copy, openclaw prints a version error, and
# exits with non-zero BEFORE any message is ever sent to the gateway. That
# produces the exact same failure shape as a real ACP dispatch regression
# ("marker file not created"), which is extremely misleading.
#
# Pick a supported Node (>=22.12) explicitly and prepend its directory to
# PATH for the rest of this script, so the openclaw shebang lookup finds it
# first regardless of whatever nvm/interactive env the caller had.
find_supported_node() {
    local candidates=()
    # Prefer system node first (stable, not subject to nvm churn).
    candidates+=("/usr/local/bin/node" "/usr/bin/node")
    # Then any installed nvm versions, newest first.
    if [[ -d "${HOME}/.nvm/versions/node" ]]; then
        while IFS= read -r v; do
            candidates+=("${HOME}/.nvm/versions/node/${v}/bin/node")
        done < <(ls -1 "${HOME}/.nvm/versions/node" 2>/dev/null | sort -Vr)
    fi
    for n in "${candidates[@]}"; do
        [[ -x "$n" ]] || continue
        local raw major minor
        raw=$("$n" --version 2>/dev/null | sed 's/^v//')
        [[ -z "$raw" ]] && continue
        major="${raw%%.*}"
        minor="${raw#*.}"; minor="${minor%%.*}"
        if (( major > 22 )) || { (( major == 22 )) && (( minor >= 12 )); }; then
            echo "$n"
            return 0
        fi
    done
    return 1
}

if ! NODE_BIN=$(find_supported_node); then
    log "FAIL: no Node >=22.12 found on host (openclaw CLI cannot start)"
    exit 1
fi
NODE_DIR=$(dirname "$NODE_BIN")
# Strip any existing occurrences of NODE_DIR from PATH, then prepend it,
# so that `env node` in the openclaw shebang resolves to our chosen binary
# even if another Node directory was already ahead of it on the inherited
# PATH (e.g. nvm's ~/.nvm/versions/node/vXX.YY.Z/bin).
_cleaned_path=":$PATH:"
_cleaned_path="${_cleaned_path//:${NODE_DIR}:/:}"
_cleaned_path="${_cleaned_path#:}"
_cleaned_path="${_cleaned_path%:}"
# Also strip any nvm node dirs entirely so they cannot shadow NODE_DIR.
if [[ -d "${HOME}/.nvm/versions/node" ]]; then
    while IFS= read -r _nvm_ver; do
        _nvm_dir="${HOME}/.nvm/versions/node/${_nvm_ver}/bin"
        _cleaned_path=":${_cleaned_path}:"
        _cleaned_path="${_cleaned_path//:${_nvm_dir}:/:}"
        _cleaned_path="${_cleaned_path#:}"
        _cleaned_path="${_cleaned_path%:}"
    done < <(ls -1 "${HOME}/.nvm/versions/node" 2>/dev/null)
fi
export PATH="${NODE_DIR}:${_cleaned_path}"
unset _cleaned_path _nvm_ver _nvm_dir
log "Using Node at $NODE_BIN ($($NODE_BIN --version))"

# Step 1: Gateway up?
if ! curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3001/ | grep -q 200; then
    log "FAIL: gateway not reachable"
    exit 1
fi

# Step 1b: Can the openclaw CLI actually start?
# Distinguishes a CLI startup failure (node version, missing module, broken
# install) from a genuine ACP dispatch failure. Without this, the script
# silently blames ACP when the CLI never even started (e.g. the nvm default
# points at an unsupported Node version).
if ! CLI_VERSION_OUT=$(openclaw --version 2>&1); then
    log "FAIL: openclaw CLI failed to start: $CLI_VERSION_OUT"
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
