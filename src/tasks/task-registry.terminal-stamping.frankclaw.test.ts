import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTaskRecord,
  markTaskTerminalById,
  maybeDeliverTaskTerminalUpdate,
  resetTaskRegistryDeliveryRuntimeForTests,
  resetTaskRegistryForTests,
  setTaskRegistryDeliveryRuntimeForTests,
} from "./task-registry.js";
import { configureTaskRegistryRuntime } from "./task-registry.store.js";

vi.mock("../utils/message-channel.js", () => ({
  isDeliverableMessageChannel: (channel: string) =>
    channel === "notifychat" || channel === "guildchat",
}));

type DeliveryStateCall = {
  task: { taskId: string };
  deliveryState?: { taskId?: string; lastNotifiedEventAt?: number };
};

describe("task-registry terminal delivery stamping (frankclaw regression)", () => {
  afterEach(() => {
    resetTaskRegistryForTests();
    resetTaskRegistryDeliveryRuntimeForTests();
  });

  it("stamps lastNotifiedEventAt after a successful terminal delivery", async () => {
    const upsertTaskWithDeliveryState = vi.fn();
    configureTaskRegistryRuntime({
      store: {
        loadSnapshot: () => ({ tasks: new Map(), deliveryStates: new Map() }),
        saveSnapshot: vi.fn(),
        upsertTaskWithDeliveryState,
        deleteTaskWithDeliveryState: vi.fn(),
      },
    });
    const sendMessage = vi.fn(async () => ({
      channel: "notifychat",
      to: "notifychat:room-1",
      via: "direct" as const,
      mediaUrl: null,
    }));
    setTaskRegistryDeliveryRuntimeForTests({ sendMessage });

    const created = createTaskRecord({
      runtime: "acp",
      ownerKey: "agent:main:main",
      scopeKind: "session",
      requesterOrigin: { channel: "notifychat", to: "notifychat:room-1" },
      childSessionKey: "agent:claude:acp:terminal",
      runId: "run-terminal-stamp",
      task: "Terminal stamp regression",
      status: "running",
      notifyPolicy: "done_only",
      deliveryStatus: "pending",
    });

    markTaskTerminalById({ taskId: created.taskId, status: "succeeded", endedAt: Date.now() });
    await maybeDeliverTaskTerminalUpdate(created.taskId);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const stampedFor = upsertTaskWithDeliveryState.mock.calls
      .map((call) => call[0] as DeliveryStateCall)
      .filter((p) => typeof p.deliveryState?.lastNotifiedEventAt === "number");
    expect(stampedFor.length).toBeGreaterThan(0);
  });

  it("stamps lastNotifiedEventAt when terminal update is queued via session events", async () => {
    const upsertTaskWithDeliveryState = vi.fn();
    configureTaskRegistryRuntime({
      store: {
        loadSnapshot: () => ({ tasks: new Map(), deliveryStates: new Map() }),
        saveSnapshot: vi.fn(),
        upsertTaskWithDeliveryState,
        deleteTaskWithDeliveryState: vi.fn(),
      },
    });
    setTaskRegistryDeliveryRuntimeForTests({ sendMessage: vi.fn() });

    // No requesterOrigin -> canDeliverTaskToRequesterOrigin returns false ->
    // terminal update queues a system event and stamps via the session_queued path.
    // Use cli runtime: subagent runtime skips auto-delivery in shouldAutoDeliverTaskTerminalUpdate.
    const created = createTaskRecord({
      runtime: "cli",
      ownerKey: "agent:main:main",
      scopeKind: "session",
      childSessionKey: "agent:main:workspace:channel:test-channel",
      runId: "run-terminal-stamp-queued",
      task: "Terminal stamp regression queued",
      status: "running",
      notifyPolicy: "done_only",
      deliveryStatus: "pending",
    });

    markTaskTerminalById({ taskId: created.taskId, status: "failed", endedAt: Date.now() });
    await maybeDeliverTaskTerminalUpdate(created.taskId);

    const stampedFor = upsertTaskWithDeliveryState.mock.calls
      .map((call) => call[0] as DeliveryStateCall)
      .filter((p) => typeof p.deliveryState?.lastNotifiedEventAt === "number");
    expect(stampedFor.length).toBeGreaterThan(0);
  });

  // Regression scenario for the 2026-04-28 doramon-inbox-dfcx-1777207164-642a6a
  // recurrence: separate ACP terminal deliveries each must stamp the dedup
  // timestamp, so a later sweep does not re-emit a "Background task lost" note
  // for already-notified tasks. The pre-fix bug left
  // task_delivery_state.lastNotifiedEventAt as NULL even after
  // deliveryStatus=delivered.
  it("stamps deliveries for two independent ACP terminal updates", async () => {
    const upsertTaskWithDeliveryState = vi.fn();
    configureTaskRegistryRuntime({
      store: {
        loadSnapshot: () => ({ tasks: new Map(), deliveryStates: new Map() }),
        saveSnapshot: vi.fn(),
        upsertTaskWithDeliveryState,
        deleteTaskWithDeliveryState: vi.fn(),
      },
    });
    const sendMessage = vi.fn(async () => ({
      channel: "notifychat",
      to: "notifychat:room-1",
      via: "direct" as const,
      mediaUrl: null,
    }));
    setTaskRegistryDeliveryRuntimeForTests({ sendMessage });

    const first = createTaskRecord({
      runtime: "acp",
      ownerKey: "agent:main:main",
      scopeKind: "session",
      requesterOrigin: { channel: "notifychat", to: "notifychat:doramon-inbox-thread" },
      childSessionKey: "agent:claude:acp:dfcx-research",
      runId: "run-doramon-inbox-dfcx-first",
      task: "doramon-inbox-dfcx first",
      status: "running",
      notifyPolicy: "done_only",
      deliveryStatus: "pending",
    });
    const second = createTaskRecord({
      runtime: "acp",
      ownerKey: "agent:other:main",
      scopeKind: "session",
      requesterOrigin: { channel: "guildchat", to: "guildchat:logs-channel" },
      childSessionKey: "agent:claude:acp:dfcx-followup",
      runId: "run-doramon-inbox-dfcx-second",
      task: "doramon-inbox-dfcx second",
      status: "running",
      notifyPolicy: "done_only",
      deliveryStatus: "pending",
    });

    markTaskTerminalById({ taskId: first.taskId, status: "failed", endedAt: Date.now() });
    markTaskTerminalById({ taskId: second.taskId, status: "succeeded", endedAt: Date.now() });
    await maybeDeliverTaskTerminalUpdate(first.taskId);
    await maybeDeliverTaskTerminalUpdate(second.taskId);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    const stampedTaskIds = new Set<string>();
    for (const call of upsertTaskWithDeliveryState.mock.calls) {
      const params = call[0] as DeliveryStateCall;
      if (typeof params.deliveryState?.lastNotifiedEventAt === "number") {
        stampedTaskIds.add(params.task.taskId);
      }
    }
    expect(stampedTaskIds.has(first.taskId)).toBe(true);
    expect(stampedTaskIds.has(second.taskId)).toBe(true);
  });
});
