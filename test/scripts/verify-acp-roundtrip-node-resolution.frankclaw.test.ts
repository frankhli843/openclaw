/**
 * frankclaw addition: regression test for scripts/verify-acp-roundtrip.sh.
 *
 * Background (Apr 15 2026 incident):
 * The ACP round-trip post-merge healthcheck was failing with
 *   FAIL: marker file not created. Worker did not execute the tool.
 * after an upstream merge + nvm default flip. The failure shape pointed at
 * an ACP dispatch regression, but the real root cause was that the
 * `openclaw` CLI never started at all: `/usr/bin/openclaw` uses a
 * `#!/usr/bin/env node` shebang, and when the caller shell had an
 * unsupported Node (e.g. nvm's v20) ahead of /usr/bin on PATH, the CLI
 * printed `Node.js v22.12+ is required` and exited before any message was
 * sent to the gateway. The script treated that as an ACP failure.
 *
 * The fix makes the script:
 *   1. Pick a supported Node (>=22.12) explicitly and prepend its directory
 *      to PATH (stripping any nvm node dirs that would shadow it), so that
 *      the openclaw shebang lookup always finds a valid Node regardless of
 *      the caller's PATH.
 *   2. Run `openclaw --version` as an explicit CLI-startup probe and emit a
 *      distinct `FAIL: openclaw CLI failed to start: ...` message, so a CLI
 *      startup regression is never again misreported as an ACP dispatch
 *      failure.
 *
 * This test guards both behaviors by shape-checking the shell source. It is
 * intentionally source-level (not an end-to-end invocation) because running
 * the real script requires a live gateway + ACP worker, which is not
 * available in CI.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCRIPT_PATH = path.join(ROOT, "scripts", "verify-acp-roundtrip.sh");

function readScript(): string {
  return fs.readFileSync(SCRIPT_PATH, "utf8");
}

describe("verify-acp-roundtrip.sh node resolution guard", () => {
  it("script file exists and is executable", () => {
    const stat = fs.statSync(SCRIPT_PATH);
    expect(stat.isFile()).toBe(true);
    // Owner execute bit set.
    expect((stat.mode & 0o100) !== 0).toBe(true);
  });

  it("selects a supported Node (>=22.12) before invoking openclaw", () => {
    const src = readScript();
    // The minimum version check must be present and pinned to the same floor
    // as /usr/bin/openclaw (currently 22.12). If the CLI's minimum ever
    // changes, this test should be updated alongside it.
    expect(src, "find_supported_node helper must exist to pick a valid Node binary").toMatch(
      /find_supported_node\s*\(\)/,
    );
    expect(src, "must enforce a Node >=22.12 floor").toMatch(
      /major\s*==\s*22\s*\)\s*\)\s*&&.*minor\s*>=\s*12/,
    );
    expect(src, "must fail fast when no supported Node is available").toMatch(
      /FAIL: no Node >=22\.12 found on host/,
    );
  });

  it("prepends the chosen Node directory to PATH (not just appends) and strips nvm shadows", () => {
    const src = readScript();
    // Must assign PATH with NODE_DIR at the front.
    expect(
      src,
      "PATH must be rewritten so NODE_DIR appears first, not merely added if missing",
    ).toMatch(/export\s+PATH\s*=\s*["']?\$\{?NODE_DIR\}?:/);
    // Must strip nvm node dirs so they cannot shadow NODE_DIR.
    expect(
      src,
      "nvm node dirs must be stripped from PATH so they cannot shadow the chosen Node",
    ).toMatch(/\.nvm\/versions\/node/);
  });

  it("explicitly probes openclaw CLI startup and reports a distinct failure reason", () => {
    const src = readScript();
    // Step 1b: explicit `openclaw --version` probe with a distinct FAIL message.
    expect(src, "must run `openclaw --version` as a CLI startup probe").toMatch(
      /openclaw\s+--version/,
    );
    expect(
      src,
      "CLI startup failure must have its own FAIL line, not silently fall through to the marker-missing path",
    ).toMatch(/FAIL:\s*openclaw CLI failed to start/);
  });

  it("does not reintroduce the naive `case ... *:$NODE_DIR:* ) ;;` no-op branch", () => {
    const src = readScript();
    // Guard against the earlier mistake: a case-based "if not already in
    // PATH" guard is a no-op when NODE_DIR happens to already be present
    // further down the list (e.g. /usr/bin is always on PATH but can be
    // shadowed by nvm). The fix must unconditionally prepend.
    expect(
      src,
      "must not use the earlier case-based no-op that skipped prepending when NODE_DIR was already somewhere in PATH",
    ).not.toMatch(/case\s+":\$PATH:"\s+in[\s\S]*?\*":\$NODE_DIR:"\*\)\s*;;/);
  });
});
