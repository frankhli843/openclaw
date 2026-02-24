import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../infra/restart-sentinel.js", () => ({
  consumeRestartSentinel: vi.fn(),
  formatRestartSentinelMessage: vi.fn(() => "Gateway restarted"),
  summarizeRestartSentinel: vi.fn(() => "Gateway restart"),
}));

vi.mock("../infra/scheduled-agent.js", () => ({
  enqueueScheduledAgent: vi.fn(),
}));

vi.mock("../infra/outbound/deliver.js", () => ({
  deliverOutboundPayloads: vi.fn(),
}));

vi.mock("../infra/outbound/targets.js", () => ({
  resolveOutboundTarget: vi.fn(() => ({ ok: true, to: "channel:1474343755153932394" })),
}));

vi.mock("./session-utils.js", () => ({
  loadSessionEntry: vi.fn(() => ({ cfg: {}, entry: {} })),
}));

vi.mock("../config/sessions/delivery-info.js", () => ({
  parseSessionThreadInfo: vi.fn((sessionKey: string) => ({
    baseSessionKey: sessionKey,
    threadId: undefined,
  })),
}));

vi.mock("../agents/tools/sessions-send-helpers.js", () => ({
  resolveAnnounceTargetFromKey: vi.fn(() => null),
}));

vi.mock("../channels/plugins/index.js", () => ({
  normalizeChannelId: vi.fn((channel: string) => channel),
}));

vi.mock("../utils/delivery-context.js", () => ({
  deliveryContextFromSession: vi.fn(() => undefined),
  mergeDeliveryContext: vi.fn((primary: unknown, fallback: unknown) => primary ?? fallback),
}));

vi.mock("../infra/system-events.js", () => ({
  enqueueSystemEvent: vi.fn(),
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveSessionAgentId: vi.fn(() => "main"),
}));

vi.mock("../config/sessions.js", () => ({
  resolveMainSessionKeyFromConfig: vi.fn(() => "agent:main"),
}));

import { resolveMainSessionKeyFromConfig } from "../config/sessions.js";
import { deliverOutboundPayloads } from "../infra/outbound/deliver.js";
import { consumeRestartSentinel } from "../infra/restart-sentinel.js";
import { enqueueScheduledAgent } from "../infra/scheduled-agent.js";
import { scheduleRestartSentinelWake, enqueuePostRestartWake } from "./server-restart-sentinel.js";

const mockConsumeRestartSentinel = vi.mocked(consumeRestartSentinel);
const mockEnqueueScheduledAgent = vi.mocked(enqueueScheduledAgent);
const mockDeliverOutboundPayloads = vi.mocked(deliverOutboundPayloads);
const mockResolveMainSessionKey = vi.mocked(resolveMainSessionKeyFromConfig);

describe("enqueuePostRestartWake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues a wake message for the main session on startup", async () => {
    mockResolveMainSessionKey.mockReturnValue("agent:main");
    mockEnqueueScheduledAgent.mockResolvedValue({ id: "wake-1" });

    await enqueuePostRestartWake({ deps: {} as never }, { _skipEnvCheck: true });

    expect(mockEnqueueScheduledAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main",
        deliver: true,
        group: "restart",
      }),
    );
  });

  it("includes continuation instructions in the message", async () => {
    mockResolveMainSessionKey.mockReturnValue("agent:main");
    mockEnqueueScheduledAgent.mockResolvedValue({ id: "wake-1" });

    await enqueuePostRestartWake({ deps: {} as never }, { _skipEnvCheck: true });

    const call = mockEnqueueScheduledAgent.mock.calls[0][0];
    expect(call.message).toContain("restart completed");
    expect(call.message).toContain("continue where you left off");
  });

  it("defaults to Discord #general when no delivery context exists", async () => {
    mockResolveMainSessionKey.mockReturnValue("agent:main");
    mockEnqueueScheduledAgent.mockResolvedValue({ id: "wake-1" });

    await enqueuePostRestartWake({ deps: {} as never }, { _skipEnvCheck: true });

    expect(mockEnqueueScheduledAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        replyChannel: "discord",
        replyTo: "channel:1474343755153932394",
      }),
    );
  });

  it("uses group 'restart' for dedup across rapid restarts", async () => {
    mockResolveMainSessionKey.mockReturnValue("agent:main");
    mockEnqueueScheduledAgent.mockResolvedValue({ id: "wake-1" });

    await enqueuePostRestartWake({ deps: {} as never }, { _skipEnvCheck: true });

    expect(mockEnqueueScheduledAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        group: "restart",
      }),
    );
  });

  it("sets a 30s delay for channels to reconnect", async () => {
    mockResolveMainSessionKey.mockReturnValue("agent:main");
    mockEnqueueScheduledAgent.mockResolvedValue({ id: "wake-1" });

    const before = Date.now();
    await enqueuePostRestartWake({ deps: {} as never }, { _skipEnvCheck: true });

    const call = mockEnqueueScheduledAgent.mock.calls[0][0];
    expect(call.canReadBy).toBeGreaterThanOrEqual(before + 29_000);
    expect(call.canReadBy).toBeLessThanOrEqual(before + 31_000);
  });

  it("does nothing when no main session key is configured", async () => {
    mockResolveMainSessionKey.mockReturnValue(undefined as never);

    await enqueuePostRestartWake({ deps: {} as never }, { _skipEnvCheck: true });

    expect(mockEnqueueScheduledAgent).not.toHaveBeenCalled();
  });
});

describe("scheduleRestartSentinelWake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the triggering channel when deliveryContext is present", async () => {
    mockConsumeRestartSentinel.mockResolvedValue({
      version: 1,
      payload: {
        kind: "restart",
        status: "ok",
        ts: Date.now(),
        sessionKey: "agent:main:telegram:group:abc",
        deliveryContext: {
          channel: "telegram",
          to: "7918451151",
        },
      },
    });
    mockEnqueueScheduledAgent.mockResolvedValue({ id: "id-1" });

    await scheduleRestartSentinelWake({ deps: {} as never });

    expect(mockEnqueueScheduledAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main:telegram:group:abc",
        replyChannel: "telegram",
        replyTo: "7918451151",
        group: "restart",
      }),
    );
  });

  it("defaults to Discord #general when no delivery context is known", async () => {
    mockConsumeRestartSentinel.mockResolvedValue({
      version: 1,
      payload: {
        kind: "restart",
        status: "ok",
        ts: Date.now(),
        sessionKey: "agent:main",
      },
    });
    mockEnqueueScheduledAgent.mockResolvedValue({ id: "id-1" });

    await scheduleRestartSentinelWake({ deps: {} as never });

    expect(mockEnqueueScheduledAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main",
        replyChannel: "discord",
        replyTo: "channel:1474343755153932394",
        group: "restart",
      }),
    );
  });

  it("falls back to legacy outbound delivery when enqueue fails", async () => {
    mockConsumeRestartSentinel.mockResolvedValue({
      version: 1,
      payload: {
        kind: "restart",
        status: "ok",
        ts: Date.now(),
        sessionKey: "agent:main",
      },
    });
    mockEnqueueScheduledAgent.mockRejectedValue(new Error("queue down"));

    await scheduleRestartSentinelWake({ deps: {} as never });

    expect(mockDeliverOutboundPayloads).toHaveBeenCalled();
  });
});
