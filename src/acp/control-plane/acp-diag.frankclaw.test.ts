/**
 * Regression test for the production-vs-vitest log routing in acpDiag.
 *
 * Background: 2026-04-30/05-01 the heartbeat acp_bootstrap detector flagged
 * BAD because the unit-test suite in src/acp/control-plane/manager.test.ts
 * deliberately throws acpx-exit / NO_SESSION errors. Those throws caused
 * TURN_THROW lines to be appended to state/acp-diag.log, which the production
 * detector then read and reported as bootstrap failures. The fix routes diag
 * output to a tmp path whenever VITEST/VITEST_WORKER_ID is set so test runs
 * cannot pollute production state.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface AcpDiagModule {
  acpDiag: (msg: string) => void;
}

async function loadFresh(): Promise<AcpDiagModule> {
  vi.resetModules();
  return (await import("./acp-diag.frankclaw.js")) as AcpDiagModule;
}

describe("acp-diag.frankclaw routing", () => {
  let workdir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "acp-diag-test-"));
    for (const k of ["OPENCLAW_ACP_DIAG_LOG", "OPENCLAW_WORKSPACE", "VITEST", "VITEST_WORKER_ID"]) {
      savedEnv[k] = process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    rmSync(workdir, { recursive: true, force: true });
  });

  it("never writes to OPENCLAW_WORKSPACE/state/acp-diag.log when VITEST is set", async () => {
    delete process.env.OPENCLAW_ACP_DIAG_LOG;
    process.env.OPENCLAW_WORKSPACE = workdir;
    process.env.VITEST = "true";

    const mod = await loadFresh();
    mod.acpDiag("TURN_THROW session=test code=ACP_TURN_FAILED elapsed=0ms events=1");

    const prodPath = join(workdir, "state", "acp-diag.log");
    expect(existsSync(prodPath)).toBe(false);
  });

  it("respects an explicit OPENCLAW_ACP_DIAG_LOG override", async () => {
    const overridePath = join(workdir, "override-acp-diag.log");
    process.env.OPENCLAW_ACP_DIAG_LOG = overridePath;
    process.env.OPENCLAW_WORKSPACE = workdir;
    process.env.VITEST = "true";

    const mod = await loadFresh();
    mod.acpDiag("TURN_START session=override req=r1 mode=prompt");

    expect(existsSync(overridePath)).toBe(true);
    expect(readFileSync(overridePath, "utf8")).toContain("TURN_START session=override");
    expect(existsSync(join(workdir, "state", "acp-diag.log"))).toBe(false);
  });
});
