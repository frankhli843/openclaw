import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  deliverSubagentAnnouncement,
  loadSessionEntryByKey,
  loadRequesterSessionEntry,
  callGateway,
} = vi.hoisted(() => ({
  deliverSubagentAnnouncement: vi.fn(),
  loadSessionEntryByKey: vi.fn(() => ({ sessionId: "child-session-id" })),
  loadRequesterSessionEntry: vi.fn(() => ({ entry: { sessionId: "parent-session-id" } })),
  callGateway: vi.fn(),
}));

vi.mock("./subagent-announce-delivery.js", () => ({
  deliverSubagentAnnouncement,
  loadRequesterSessionEntry,
  loadSessionEntryByKey,
  resolveAnnounceOrigin: vi.fn((_entry: unknown, origin: unknown) => origin),
  runAnnounceDeliveryWithRetry: vi.fn(
    async ({ run }: { run: () => Promise<unknown> }) => await run(),
  ),
  resolveSubagentAnnounceTimeoutMs: vi.fn(() => 90_000),
  resolveSubagentCompletionOrigin: vi.fn(async () => undefined),
}));

vi.mock("./subagent-announce.runtime.js", () => ({
  callGateway,
  isEmbeddedPiRunActive: vi.fn(() => false),
  loadConfig: vi.fn(() => ({})),
  waitForEmbeddedPiRunEnd: vi.fn(async () => true),
}));

vi.mock("./subagent-announce-output.js", () => ({
  waitForSubagentRunOutcome: vi.fn(async () => ({ status: "timeout" })),
  applySubagentWaitOutcome: vi.fn(
    ({
      wait,
      outcome,
      startedAt,
      endedAt,
    }: {
      wait?: { status?: string } | null;
      outcome?: unknown;
      startedAt?: unknown;
      endedAt?: unknown;
    }) => ({
      outcome:
        wait?.status === "timeout" ? { status: "timeout" } : (outcome ?? { status: "unknown" }),
      startedAt,
      endedAt,
    }),
  ),
  buildChildCompletionFindings: vi.fn(() => undefined),
  buildCompactAnnounceStatsLine: vi.fn(async () => "Stats: runtime 1s"),
  dedupeLatestChildCompletionRows: vi.fn((children: unknown) => children),
  filterCurrentDirectChildCompletionRows: vi.fn((children: unknown) => children),
  readLatestSubagentOutputWithRetry: vi.fn(async () => "ANNOUNCE_SKIP"),
  readSubagentOutput: vi.fn(async () => "ANNOUNCE_SKIP"),
}));

vi.mock("./subagent-announce.registry.runtime.js", () => ({
  shouldIgnorePostCompletionAnnounceForSession: vi.fn(() => false),
  countPendingDescendantRuns: vi.fn(() => 0),
  listSubagentRunsForRequester: vi.fn(() => []),
  getLatestSubagentRunByChildSessionKey: vi.fn(() => null),
  isSubagentSessionRunActive: vi.fn(() => true),
  resolveRequesterForChildSession: vi.fn(() => undefined),
  replaceSubagentRunAfterSteer: vi.fn(() => true),
}));

import { runSubagentAnnounceFlow } from "./subagent-announce.js";

describe("runSubagentAnnounceFlow completion fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deliverSubagentAnnouncement.mockResolvedValue({ delivered: true, path: "direct" });
    loadSessionEntryByKey.mockReturnValue({ sessionId: "child-session-id" });
  });

  it("keeps completion delivery visible when the child ended with ANNOUNCE_SKIP", async () => {
    const announced = await runSubagentAnnounceFlow({
      childSessionKey: "agent:main:subagent:child",
      childRunId: "run-1",
      requesterSessionKey: "agent:main:discord:channel:123",
      requesterOrigin: { channel: "discord", to: "channel:123" },
      requesterDisplayKey: "agent:main:discord:channel:123",
      task: "rebuild cache",
      timeoutMs: 1_000,
      cleanup: "keep",
      roundOneReply: "ANNOUNCE_SKIP",
      outcome: { status: "timeout" },
      expectsCompletionMessage: true,
    });

    expect(announced).toBe(true);
    expect(deliverSubagentAnnouncement).toHaveBeenCalledTimes(1);
    const params = deliverSubagentAnnouncement.mock.calls[0]?.[0] as {
      internalEvents?: Array<{ result?: string }>;
    };
    expect(params.internalEvents?.[0]?.result).toContain(
      "rebuild cache timed out before the worker returned a usable summary.",
    );
  });

  it("keeps completion delivery visible when the child ended with NO_REPLY", async () => {
    const announced = await runSubagentAnnounceFlow({
      childSessionKey: "agent:main:subagent:child",
      childRunId: "run-2",
      requesterSessionKey: "agent:main:discord:channel:123",
      requesterOrigin: { channel: "discord", to: "channel:123" },
      requesterDisplayKey: "agent:main:discord:channel:123",
      task: "rebuild cache",
      timeoutMs: 1_000,
      cleanup: "keep",
      roundOneReply: "NO_REPLY",
      outcome: { status: "ok" },
      expectsCompletionMessage: true,
    });

    expect(announced).toBe(true);
    expect(deliverSubagentAnnouncement).toHaveBeenCalledTimes(1);
    const params = deliverSubagentAnnouncement.mock.calls[0]?.[0] as {
      internalEvents?: Array<{ result?: string }>;
    };
    expect(params.internalEvents?.[0]?.result).toContain(
      "rebuild cache completed, but the worker did not return a usable summary.",
    );
  });
});
