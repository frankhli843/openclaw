import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../gateway/call.js", () => ({
  callGateway: vi.fn(),
}));

vi.mock("../runtime.js", () => ({
  defaultRuntime: { log: vi.fn() },
}));

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("../config/sessions.js", () => ({
  loadSessionStore: vi.fn(() => ({})),
  resolveAgentIdFromSessionKey: vi.fn(() => "main"),
  resolveStorePath: vi.fn(() => "/tmp/test-store"),
  updateSessionStore: vi.fn(),
}));

import { callGateway } from "../gateway/call.js";
import {
  logAnnounceGiveUp,
  resolveAnnounceRetryDelayMs,
  MAX_ANNOUNCE_RETRY_COUNT,
} from "./subagent-registry-helpers.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

const mockCallGateway = vi.mocked(callGateway);

afterEach(() => {
  mockCallGateway.mockReset();
});

describe("subagent announce dead-letter alert", () => {
  const baseEntry: SubagentRunRecord = {
    runId: "run-abc",
    childSessionKey: "agent:main:subagent:child-1",
    requesterSessionKey: "agent:main:session:req-1",
    requesterDisplayKey: "req-1",
    task: "test task",
    cleanup: "delete",
    createdAt: Date.now() - 120_000,
    label: "test-task",
    announceRetryCount: MAX_ANNOUNCE_RETRY_COUNT,
    endedAt: Date.now() - 60_000,
    startedAt: Date.now() - 120_000,
  };

  it("fires dead-letter alert via callGateway on retry-limit give up", () => {
    logAnnounceGiveUp(baseEntry, "retry-limit");

    expect(mockCallGateway).toHaveBeenCalledOnce();
    const call = mockCallGateway.mock.calls[0][0] as Record<string, any>;
    expect(call.method).toBe("send");
    expect(call.params.channel).toBe("discord");
    expect(call.params.message).toContain("dead-letter");
    expect(call.params.message).toContain("reason=retry-limit");
    expect(call.params.message).toContain("run=run-abc");
  });

  it("fires dead-letter alert on expiry give up", () => {
    logAnnounceGiveUp(baseEntry, "expiry");

    expect(mockCallGateway).toHaveBeenCalledOnce();
    const call = mockCallGateway.mock.calls[0][0] as Record<string, any>;
    expect(call.params.message).toContain("reason=expiry");
  });

  it("includes label in the dead-letter message when present", () => {
    logAnnounceGiveUp(baseEntry, "retry-limit");

    const call = mockCallGateway.mock.calls[0][0] as Record<string, any>;
    expect(call.params.message).toContain("label=test-task");
  });

  it("omits label from the dead-letter message when empty", () => {
    logAnnounceGiveUp({ ...baseEntry, label: "" }, "retry-limit");

    const call = mockCallGateway.mock.calls[0][0] as Record<string, any>;
    expect(call.params.message).not.toContain("label=");
  });

  it("does not throw when callGateway rejects (best-effort)", async () => {
    mockCallGateway.mockRejectedValue(new Error("network error"));

    // logAnnounceGiveUp calls sendAnnounceDeadLetterAlert fire-and-forget
    // with .catch(() => {}), so this should not throw
    expect(() => logAnnounceGiveUp(baseEntry, "retry-limit")).not.toThrow();
  });

  it("sends to the correct Discord channel for dead-letter alerts", () => {
    logAnnounceGiveUp(baseEntry, "retry-limit");

    const call = mockCallGateway.mock.calls[0][0] as Record<string, any>;
    expect(call.params.to).toBe("1481643321922420787");
  });
});

describe("announce retry delay calculation", () => {
  it("returns increasing delays with exponential backoff", () => {
    const d0 = resolveAnnounceRetryDelayMs(0);
    const d1 = resolveAnnounceRetryDelayMs(1);
    const d2 = resolveAnnounceRetryDelayMs(2);
    expect(d1).toBeGreaterThanOrEqual(d0);
    expect(d2).toBeGreaterThanOrEqual(d1);
  });

  it("caps at MAX_ANNOUNCE_RETRY_DELAY_MS for high retry counts", () => {
    const delay = resolveAnnounceRetryDelayMs(100);
    expect(delay).toBeLessThanOrEqual(8_000);
  });
});
