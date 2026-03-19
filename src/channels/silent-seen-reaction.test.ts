import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  markSilentSeen,
  clearSilentSeen,
  _getTrackedMessageId,
  _clearAllTracking,
  _disablePersistence,
  _enablePersistence,
  type SilentSeenAdapter,
} from "./silent-seen-reaction.js";

function makeAdapter(): SilentSeenAdapter & {
  added: Array<{ messageId: string; emoji: string }>;
  removed: Array<{ messageId: string; emoji: string }>;
} {
  const added: Array<{ messageId: string; emoji: string }> = [];
  const removed: Array<{ messageId: string; emoji: string }> = [];
  return {
    added,
    removed,
    addReaction: async (messageId, emoji) => {
      added.push({ messageId, emoji });
    },
    removeReaction: async (messageId, emoji) => {
      removed.push({ messageId, emoji });
    },
  };
}

const noop = () => {};

describe("silent-seen-reaction", () => {
  beforeEach(() => {
    _disablePersistence();
    _clearAllTracking();
  });

  afterEach(() => {
    _enablePersistence();
  });

  it("adds reaction to first message", async () => {
    const adapter = makeAdapter();
    await markSilentSeen({
      conversationId: "conv1",
      messageId: "msg1",
      adapter,
      log: noop,
    });
    expect(adapter.added).toEqual([{ messageId: "msg1", emoji: "👀" }]);
    expect(adapter.removed).toEqual([]);
    expect(_getTrackedMessageId("conv1")).toBe("msg1");
  });

  it("removes previous reaction when adding to new message", async () => {
    const adapter = makeAdapter();
    await markSilentSeen({
      conversationId: "conv1",
      messageId: "msg1",
      adapter,
      log: noop,
    });
    await markSilentSeen({
      conversationId: "conv1",
      messageId: "msg2",
      adapter,
      log: noop,
    });
    expect(adapter.removed).toEqual([{ messageId: "msg1", emoji: "👀" }]);
    expect(adapter.added).toHaveLength(2);
    expect(_getTrackedMessageId("conv1")).toBe("msg2");
  });

  it("does not remove when same message is marked again", async () => {
    const adapter = makeAdapter();
    await markSilentSeen({
      conversationId: "conv1",
      messageId: "msg1",
      adapter,
      log: noop,
    });
    await markSilentSeen({
      conversationId: "conv1",
      messageId: "msg1",
      adapter,
      log: noop,
    });
    expect(adapter.removed).toEqual([]);
    expect(adapter.added).toHaveLength(2);
  });

  it("tracks conversations independently", async () => {
    const adapter = makeAdapter();
    await markSilentSeen({
      conversationId: "conv1",
      messageId: "msg1",
      adapter,
      log: noop,
    });
    await markSilentSeen({
      conversationId: "conv2",
      messageId: "msg2",
      adapter,
      log: noop,
    });
    expect(adapter.removed).toEqual([]);
    expect(_getTrackedMessageId("conv1")).toBe("msg1");
    expect(_getTrackedMessageId("conv2")).toBe("msg2");
  });

  it("clearSilentSeen removes reaction and stops tracking", async () => {
    const adapter = makeAdapter();
    await markSilentSeen({
      conversationId: "conv1",
      messageId: "msg1",
      adapter,
      log: noop,
    });
    await clearSilentSeen({
      conversationId: "conv1",
      adapter,
      log: noop,
    });
    expect(adapter.removed).toEqual([{ messageId: "msg1", emoji: "👀" }]);
    expect(_getTrackedMessageId("conv1")).toBeUndefined();
  });

  it("clearSilentSeen is a no-op when nothing tracked", async () => {
    const adapter = makeAdapter();
    await clearSilentSeen({
      conversationId: "conv1",
      adapter,
      log: noop,
    });
    expect(adapter.removed).toEqual([]);
  });

  it("handles addReaction failure gracefully", async () => {
    const adapter = makeAdapter();
    adapter.addReaction = async () => {
      throw new Error("network error");
    };
    const logs: string[] = [];
    await markSilentSeen({
      conversationId: "conv1",
      messageId: "msg1",
      adapter,
      log: (m) => logs.push(m),
    });
    // Should not throw, should not track the failed message
    expect(_getTrackedMessageId("conv1")).toBeUndefined();
    expect(logs.some((l) => l.includes("failed to add"))).toBe(true);
  });

  it("handles removeReaction failure gracefully and still adds new", async () => {
    const adapter = makeAdapter();
    await markSilentSeen({
      conversationId: "conv1",
      messageId: "msg1",
      adapter,
      log: noop,
    });

    // Make remove fail
    adapter.removeReaction = async () => {
      throw new Error("remove failed");
    };
    const logs: string[] = [];
    await markSilentSeen({
      conversationId: "conv1",
      messageId: "msg2",
      adapter,
      log: (m) => logs.push(m),
    });
    // Should still track the new message
    expect(_getTrackedMessageId("conv1")).toBe("msg2");
    expect(logs.some((l) => l.includes("failed to remove"))).toBe(true);
  });

  it("supports custom emoji", async () => {
    const adapter = makeAdapter();
    await markSilentSeen({
      conversationId: "conv1",
      messageId: "msg1",
      adapter,
      emoji: "✅",
      log: noop,
    });
    expect(adapter.added).toEqual([{ messageId: "msg1", emoji: "✅" }]);
  });
});
