#!/usr/bin/env bash
# build-guard.sh — Prevents in-place `pnpm build` while the gateway is running.
#
# The gateway loads dist/ modules with content-hashed filenames. Rebuilding
# changes those hashes and instantly breaks all lazy imports (MODULE_NOT_FOUND).
#
# Usage:
#   source scripts/build-guard.sh   # exits 1 if gateway is live
#   bash scripts/build-guard.sh     # same, standalone check
#
# To bypass (e.g. in a worktree where no gateway runs):
#   OPENCLAW_BUILD_SKIP_GUARD=1 pnpm build

set -euo pipefail

if [[ "${OPENCLAW_BUILD_SKIP_GUARD:-}" == "1" ]]; then
  exit 0
fi

# Check if the openclaw gateway systemd service is active
if systemctl --user is-active openclaw >/dev/null 2>&1; then
  echo "ERROR: openclaw gateway is running (systemctl --user status openclaw)." >&2
  echo "" >&2
  echo "Building in-place while the gateway runs replaces content-hashed dist/" >&2
  echo "files and breaks all lazy imports (MODULE_NOT_FOUND). Options:" >&2
  echo "" >&2
  echo "  1. Build in a git worktree instead:" >&2
  echo "     git worktree add /tmp/fc-build HEAD" >&2
  echo "     cd /tmp/fc-build && OPENCLAW_BUILD_SKIP_GUARD=1 pnpm install && pnpm build" >&2
  echo "" >&2
  echo "  2. Stop the gateway first, then build and restart:" >&2
  echo "     systemctl --user stop openclaw" >&2
  echo "     pnpm build" >&2
  echo "     systemctl --user start openclaw" >&2
  echo "" >&2
  echo "  3. Bypass (only if you know what you're doing):" >&2
  echo "     OPENCLAW_BUILD_SKIP_GUARD=1 pnpm build" >&2
  exit 1
fi

# Also check for bare openclaw/node processes serving the gateway
if pgrep -f "node.*dist/entry\.js.*--daemon" >/dev/null 2>&1; then
  echo "ERROR: openclaw gateway daemon process detected (pgrep)." >&2
  echo "Stop it before building in-place, or use a worktree." >&2
  exit 1
fi
