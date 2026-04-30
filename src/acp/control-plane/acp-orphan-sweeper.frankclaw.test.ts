import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionStoreTarget } from "../../config/sessions/targets.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";

const hoisted = vi.hoisted(() => ({
  resolveAllTargetsMock: vi.fn(),
  loadSessionStoreMock: vi.fn(),
  resolveSessionTranscriptFileMock: vi.fn(),
  callGatewayMock: vi.fn(),
  acpDiagMock: vi.fn(),
}));

vi.mock("../../config/sessions/targets.js", () => ({
  resolveAllAgentSessionStoreTargets: hoisted.resolveAllTargetsMock,
}));

vi.mock("../../config/sessions/store-load.js", () => ({
  loadSessionStore: hoisted.loadSessionStoreMock,
}));

vi.mock("../../config/sessions/transcript.js", () => ({
  resolveSessionTranscriptFile: hoisted.resolveSessionTranscriptFileMock,
}));

vi.mock("../../config/sessions/paths.js", () => ({
  resolveStorePath: vi.fn((_unused: unknown, opts: { agentId?: string }) => {
    return `/tmp/sessions-${opts?.agentId ?? "main"}.json`;
  }),
}));

vi.mock("../../gateway/call.js", () => ({
  callGateway: hoisted.callGatewayMock,
}));

vi.mock("./acp-diag.frankclaw.js", () => ({
  acpDiag: hoisted.acpDiagMock,
}));

const { findAcpOrphanCandidates, runAcpOrphanSweep } =
  await import("./acp-orphan-sweeper.frankclaw.js");

const NOW = 1_700_000_000_000;
const FIVE_MIN = 5 * 60 * 1000;

function makeConfig(): OpenClawConfig {
  return {
    session: { mainKey: "main", scope: "per-sender" },
    acp: { enabled: true, backend: "acpx" },
  } as OpenClawConfig;
}

function setupTarget(
  targets: SessionStoreTarget[],
  stores: Record<string, Record<string, SessionEntry>>,
): void {
  hoisted.resolveAllTargetsMock.mockResolvedValue(targets);
  hoisted.loadSessionStoreMock.mockImplementation((storePath: string) => {
    return stores[storePath] ?? {};
  });
}

beforeEach(async () => {
  hoisted.resolveAllTargetsMock.mockReset();
  hoisted.loadSessionStoreMock.mockReset();
  hoisted.resolveSessionTranscriptFileMock.mockReset();
  hoisted.callGatewayMock.mockReset();
  hoisted.acpDiagMock.mockReset();
});

afterEach(() => {
  vi.clearAllTimers();
});

describe("findAcpOrphanCandidates", () => {
  it("flags ACP-keyed entries with no acp meta and no transcript", async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "acp-orphan-test-"));
    const transcriptFile = path.join(tmpDir, "missing.jsonl");
    setupTarget([{ agentId: "claude", storePath: "/tmp/sessions-claude.json" }], {
      "/tmp/sessions-claude.json": {
        "agent:claude:acp:abc": {
          sessionId: "session-id-1",
          updatedAt: NOW - FIVE_MIN - 60_000,
        } as SessionEntry,
        "agent:claude:acp:withMeta": {
          sessionId: "session-id-2",
          updatedAt: NOW - FIVE_MIN - 60_000,
          acp: { backend: "acpx", agent: "claude", state: "idle" },
        } as unknown as SessionEntry,
        "agent:claude:not-acp": {
          sessionId: "session-id-3",
          updatedAt: NOW - FIVE_MIN - 60_000,
        } as SessionEntry,
      },
    });
    hoisted.resolveSessionTranscriptFileMock.mockResolvedValue({ sessionFile: transcriptFile });

    const orphans = await findAcpOrphanCandidates({ cfg: makeConfig(), now: NOW });

    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({
      sessionKey: "agent:claude:acp:abc",
      hadAcpMeta: false,
      transcriptExists: false,
      transcriptBytes: 0,
    });
  });

  it("skips ACP entries younger than ORPHAN_MIN_AGE_MS to avoid mid-spawn races", async () => {
    setupTarget([{ agentId: "claude", storePath: "/tmp/sessions-claude.json" }], {
      "/tmp/sessions-claude.json": {
        "agent:claude:acp:fresh": {
          sessionId: "fresh",
          updatedAt: NOW - 60_000,
        } as SessionEntry,
      },
    });
    hoisted.resolveSessionTranscriptFileMock.mockResolvedValue({
      sessionFile: "/tmp/missing.jsonl",
    });

    const orphans = await findAcpOrphanCandidates({ cfg: makeConfig(), now: NOW });
    expect(orphans).toHaveLength(0);
  });

  it("leaves orphans alone when their transcript has bytes (real work was done)", async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "acp-orphan-test-"));
    const transcriptFile = path.join(tmpDir, "real.jsonl");
    await fsp.writeFile(transcriptFile, '{"type":"message"}\n');
    setupTarget([{ agentId: "claude", storePath: "/tmp/sessions-claude.json" }], {
      "/tmp/sessions-claude.json": {
        "agent:claude:acp:hasWork": {
          sessionId: "hasWork",
          updatedAt: NOW - FIVE_MIN - 60_000,
        } as SessionEntry,
      },
    });
    hoisted.resolveSessionTranscriptFileMock.mockResolvedValue({ sessionFile: transcriptFile });

    const orphans = await findAcpOrphanCandidates({ cfg: makeConfig(), now: NOW });
    expect(orphans).toHaveLength(0);
  });
});

describe("runAcpOrphanSweep", () => {
  it("calls deleteFn for each candidate and accumulates counts", async () => {
    setupTarget([{ agentId: "claude", storePath: "/tmp/sessions-claude.json" }], {
      "/tmp/sessions-claude.json": {
        "agent:claude:acp:abc": {
          sessionId: "abc",
          updatedAt: NOW - FIVE_MIN - 60_000,
        } as SessionEntry,
        "agent:claude:acp:def": {
          sessionId: "def",
          updatedAt: NOW - FIVE_MIN - 60_000,
        } as SessionEntry,
      },
    });
    hoisted.resolveSessionTranscriptFileMock.mockResolvedValue({
      sessionFile: "/tmp/missing.jsonl",
    });

    const deletedKeys: string[] = [];
    const result = await runAcpOrphanSweep({
      cfg: makeConfig(),
      now: NOW,
      deleteFn: async (sessionKey) => {
        deletedKeys.push(sessionKey);
        return { deleted: true };
      },
    });

    expect(result.candidates).toBe(2);
    expect(result.deleted).toBe(2);
    expect(result.failed).toBe(0);
    expect(deletedKeys.sort()).toEqual(["agent:claude:acp:abc", "agent:claude:acp:def"]);
    const lines = hoisted.acpDiagMock.mock.calls.map((c) => String(c?.[0] ?? ""));
    expect(lines.some((l) => l.startsWith("ACP_ORPHAN_SWEEP_START"))).toBe(true);
    expect(lines.some((l) => l.startsWith("ACP_ORPHAN_SWEEP_DONE"))).toBe(true);
    expect(lines.some((l) => l.includes("ACP_ORPHAN_SWEEP_DELETED"))).toBe(true);
  });

  it("counts deleteFn rejections as failed without throwing", async () => {
    setupTarget([{ agentId: "claude", storePath: "/tmp/sessions-claude.json" }], {
      "/tmp/sessions-claude.json": {
        "agent:claude:acp:flaky": {
          sessionId: "flaky",
          updatedAt: NOW - FIVE_MIN - 60_000,
        } as SessionEntry,
      },
    });
    hoisted.resolveSessionTranscriptFileMock.mockResolvedValue({
      sessionFile: "/tmp/missing.jsonl",
    });

    const result = await runAcpOrphanSweep({
      cfg: makeConfig(),
      now: NOW,
      deleteFn: async () => {
        throw new Error("gateway timeout after 30000ms");
      },
    });

    expect(result.candidates).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.failed).toBe(1);
    const lines = hoisted.acpDiagMock.mock.calls.map((c) => String(c?.[0] ?? ""));
    expect(lines.some((l) => l.includes("ACP_ORPHAN_SWEEP_FAIL"))).toBe(true);
  });

  it("returns zero counts and skips logging when no candidates exist", async () => {
    setupTarget([{ agentId: "claude", storePath: "/tmp/sessions-claude.json" }], {
      "/tmp/sessions-claude.json": {},
    });
    const result = await runAcpOrphanSweep({ cfg: makeConfig(), now: NOW });
    expect(result.candidates).toBe(0);
    expect(result.deleted).toBe(0);
    const lines = hoisted.acpDiagMock.mock.calls.map((c) => String(c?.[0] ?? ""));
    expect(lines.every((l) => !l.startsWith("ACP_ORPHAN_SWEEP_START"))).toBe(true);
  });
});
