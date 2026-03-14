import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebInboundMsg } from "../types.js";

const mocks = vi.hoisted(() => ({
  hasControlCommand: vi.fn<(text?: string) => boolean>(),
  buildCollectPrompt:
    vi.fn<
      (params: {
        title: string;
        items: WebInboundMsg[];
        renderItem: (item: WebInboundMsg, index: number) => string;
      }) => string
    >(),
}));

vi.mock("../../../auto-reply/command-detection.js", () => ({
  hasControlCommand: mocks.hasControlCommand,
}));

vi.mock("../../../utils/queue-helpers.js", () => ({
  buildCollectPrompt: mocks.buildCollectPrompt,
}));

import { createWebCoalesceQueue } from "./coalesce-queue.js";

function makeMsg(
  overrides: Partial<WebInboundMsg> & { body: string; from: string },
): WebInboundMsg {
  return {
    ...overrides,
    from: overrides.from,
    conversationId: overrides.conversationId ?? overrides.from,
    to: overrides.to ?? "+10000000001",
    accountId: overrides.accountId ?? "default",
    body: overrides.body,
    chatType: overrides.chatType ?? "direct",
    chatId: overrides.chatId ?? overrides.from,
    sendComposing: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    sendMedia: vi.fn().mockResolvedValue(undefined),
  } as WebInboundMsg;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Flush all pending microtasks and one macrotask tick. */
async function flush() {
  await new Promise<void>((r) => setTimeout(r, 0));
}

describe("createWebCoalesceQueue", () => {
  let processOne: ReturnType<typeof vi.fn<(msg: WebInboundMsg) => Promise<void>>>;
  const cfg = { messages: {} } as unknown as ReturnType<
    typeof import("../../../../../src/config/config.js").loadConfig
  >;

  beforeEach(() => {
    processOne = vi.fn().mockResolvedValue(undefined);
    mocks.hasControlCommand.mockReset().mockReturnValue(false);
    mocks.buildCollectPrompt.mockReset().mockReturnValue("COALESCED_PROMPT");
  });

  describe("single message", () => {
    it("processes the message immediately without queuing overhead", async () => {
      const queue = createWebCoalesceQueue({ cfg, processOne });
      const msg = makeMsg({ body: "hello", from: "+1234567890" });

      queue.enqueue(msg);

      expect(processOne).toHaveBeenCalledTimes(1);
      expect(processOne).toHaveBeenCalledWith(msg);

      await flush();
    });

    it("processes a single queued message directly (no coalescing)", async () => {
      const d = deferred();
      processOne.mockReturnValueOnce(d.promise);
      processOne.mockResolvedValue(undefined);

      const queue = createWebCoalesceQueue({ cfg, processOne });
      const msg1 = makeMsg({ body: "first", from: "+1111111111" });
      const msg2 = makeMsg({ body: "second", from: "+1111111111" });

      queue.enqueue(msg1);
      queue.enqueue(msg2);

      // Only msg1 has started; msg2 is queued.
      expect(processOne).toHaveBeenCalledTimes(1);

      d.resolve();
      await flush();

      // msg2 is the only queued item → processed directly, no buildCollectPrompt.
      expect(mocks.buildCollectPrompt).not.toHaveBeenCalled();
      expect(processOne).toHaveBeenCalledTimes(2);
      expect(processOne).toHaveBeenNthCalledWith(2, msg2);
    });
  });

  describe("multiple messages while busy", () => {
    it("coalesces multiple queued regular messages into a single synthetic turn", async () => {
      const d = deferred();
      processOne.mockReturnValueOnce(d.promise);
      processOne.mockResolvedValue(undefined);
      mocks.buildCollectPrompt.mockReturnValue("BATCH_PROMPT");

      const queue = createWebCoalesceQueue({ cfg, processOne });
      const msg1 = makeMsg({ body: "first", from: "+1111111111" });
      const msg2 = makeMsg({ body: "second", from: "+1111111111" });
      const msg3 = makeMsg({ body: "third", from: "+1111111111" });

      queue.enqueue(msg1);
      queue.enqueue(msg2);
      queue.enqueue(msg3);

      expect(processOne).toHaveBeenCalledTimes(1);

      d.resolve();
      await flush();

      // msg1 processed, then msg2+msg3 coalesced into one call.
      expect(mocks.buildCollectPrompt).toHaveBeenCalledTimes(1);
      expect(processOne).toHaveBeenCalledTimes(2);

      const syntheticMsg = processOne.mock.calls[1]?.[0];
      expect(syntheticMsg.body).toBe("BATCH_PROMPT");
      // Synthetic message should carry metadata from the last regular message.
      expect(syntheticMsg.from).toBe(msg3.from);
    });

    it("passes the queued messages to buildCollectPrompt in order", async () => {
      const d = deferred();
      processOne.mockReturnValueOnce(d.promise);
      processOne.mockResolvedValue(undefined);

      const queue = createWebCoalesceQueue({ cfg, processOne });
      const msg1 = makeMsg({ body: "first", from: "+1111111111" });
      const msg2 = makeMsg({ body: "second", from: "+1111111111", timestamp: 1000 });
      const msg3 = makeMsg({ body: "third", from: "+1111111111", timestamp: 2000 });

      queue.enqueue(msg1);
      queue.enqueue(msg2);
      queue.enqueue(msg3);

      d.resolve();
      await flush();

      expect(mocks.buildCollectPrompt).toHaveBeenCalledTimes(1);
      const callArgs = mocks.buildCollectPrompt.mock.calls[0]?.[0];
      expect(callArgs?.items).toEqual([msg2, msg3]);
      expect(callArgs?.title).toBe("[Queued messages while agent was busy]");
    });

    it("merges mentionedJids from all coalesced messages", async () => {
      const d = deferred();
      processOne.mockReturnValueOnce(d.promise);
      processOne.mockResolvedValue(undefined);
      mocks.buildCollectPrompt.mockReturnValue("MERGED");

      const queue = createWebCoalesceQueue({ cfg, processOne });
      const msg1 = makeMsg({ body: "first", from: "+1111111111" });
      const msg2 = makeMsg({
        body: "second",
        from: "+1111111111",
        mentionedJids: ["jid1@s.whatsapp.net", "jid2@s.whatsapp.net"],
      });
      const msg3 = makeMsg({
        body: "third",
        from: "+1111111111",
        mentionedJids: ["jid2@s.whatsapp.net", "jid3@s.whatsapp.net"],
      });

      queue.enqueue(msg1);
      queue.enqueue(msg2);
      queue.enqueue(msg3);

      d.resolve();
      await flush();

      const syntheticMsg = processOne.mock.calls[1]?.[0];
      expect(syntheticMsg.mentionedJids).toEqual([
        "jid1@s.whatsapp.net",
        "jid2@s.whatsapp.net",
        "jid3@s.whatsapp.net",
      ]);
    });
  });

  describe("command fast-laning", () => {
    it("processes command messages individually before the regular batch", async () => {
      const d = deferred();
      processOne.mockReturnValueOnce(d.promise);
      processOne.mockResolvedValue(undefined);

      mocks.hasControlCommand.mockImplementation((text) => text === "/reset");
      mocks.buildCollectPrompt.mockReturnValue("BATCH");

      const queue = createWebCoalesceQueue({ cfg, processOne });
      const msg1 = makeMsg({ body: "first", from: "+1111111111" });
      const cmdMsg = makeMsg({ body: "/reset", from: "+1111111111" });
      const msg2 = makeMsg({ body: "regular", from: "+1111111111" });
      const msg3 = makeMsg({ body: "regular2", from: "+1111111111" });

      queue.enqueue(msg1);
      queue.enqueue(cmdMsg);
      queue.enqueue(msg2);
      queue.enqueue(msg3);

      d.resolve();
      await flush();

      // msg1, then command (individually), then synthetic(msg2+msg3).
      expect(processOne).toHaveBeenCalledTimes(3);
      expect(processOne).toHaveBeenNthCalledWith(2, cmdMsg);

      const syntheticMsg = processOne.mock.calls[2]?.[0];
      expect(syntheticMsg.body).toBe("BATCH");
    });

    it("processes only-command batch without calling buildCollectPrompt", async () => {
      const d = deferred();
      processOne.mockReturnValueOnce(d.promise);
      processOne.mockResolvedValue(undefined);

      mocks.hasControlCommand.mockImplementation((text) => text === "/reset");

      const queue = createWebCoalesceQueue({ cfg, processOne });
      const msg1 = makeMsg({ body: "first", from: "+1111111111" });
      const cmd1 = makeMsg({ body: "/reset", from: "+1111111111" });
      const cmd2 = makeMsg({ body: "/reset", from: "+1111111111" });

      queue.enqueue(msg1);
      queue.enqueue(cmd1);
      queue.enqueue(cmd2);

      d.resolve();
      await flush();

      // msg1, cmd1, cmd2 — each individually; no coalescing.
      expect(mocks.buildCollectPrompt).not.toHaveBeenCalled();
      expect(processOne).toHaveBeenCalledTimes(3);
      expect(processOne).toHaveBeenNthCalledWith(2, cmd1);
      expect(processOne).toHaveBeenNthCalledWith(3, cmd2);
    });
  });

  describe("different conversations", () => {
    it("maintains independent queues per conversation — no cross-contamination", async () => {
      const dA = deferred();
      const dB = deferred();

      // The first two calls will be the "start" calls for each conversation.
      processOne.mockReturnValueOnce(dA.promise); // conv A msg1
      processOne.mockReturnValueOnce(dB.promise); // conv B msg1
      processOne.mockResolvedValue(undefined);

      const queue = createWebCoalesceQueue({ cfg, processOne });

      const msgA1 = makeMsg({ body: "A1", from: "+1111111111" });
      const msgA2 = makeMsg({ body: "A2", from: "+1111111111" });
      const msgB1 = makeMsg({ body: "B1", from: "+2222222222" });
      const msgB2 = makeMsg({ body: "B2", from: "+2222222222" });

      queue.enqueue(msgA1); // starts conv A
      queue.enqueue(msgB1); // starts conv B (independent)
      queue.enqueue(msgA2); // queued in conv A
      queue.enqueue(msgB2); // queued in conv B

      expect(processOne).toHaveBeenCalledTimes(2);

      dA.resolve();
      dB.resolve();
      await flush();

      // Total: A1, B1 (starts) + A2, B2 (drained individually — only 1 each).
      expect(processOne).toHaveBeenCalledTimes(4);
      // buildCollectPrompt not called — only 1 message in each queue.
      expect(mocks.buildCollectPrompt).not.toHaveBeenCalled();
    });

    it("does not let conv B queue block conv A from processing", async () => {
      const dA = deferred();
      processOne.mockReturnValueOnce(dA.promise); // conv A msg1
      processOne.mockResolvedValue(undefined);

      const queue = createWebCoalesceQueue({ cfg, processOne });

      const msgA = makeMsg({ body: "A", from: "+1111111111" });
      const msgB = makeMsg({ body: "B", from: "+2222222222" });

      queue.enqueue(msgA); // blocks
      queue.enqueue(msgB); // conv B starts immediately (different conversation)

      // msgA and msgB both start immediately (different keys).
      expect(processOne).toHaveBeenCalledTimes(2);

      dA.resolve();
      await flush();

      expect(processOne).toHaveBeenCalledTimes(2); // no extra calls
    });
  });

  describe("group messages from different senders", () => {
    it("batches messages from different senders in the same group conversation", async () => {
      const d = deferred();
      processOne.mockReturnValueOnce(d.promise);
      processOne.mockResolvedValue(undefined);
      mocks.buildCollectPrompt.mockReturnValue("GROUP_BATCH");

      const groupJid = "123456789@g.us";
      const queue = createWebCoalesceQueue({ cfg, processOne });

      const msgFromAlice = makeMsg({
        body: "hi from alice",
        from: groupJid,
        conversationId: groupJid,
        chatType: "group",
        chatId: groupJid,
        senderJid: "alice@s.whatsapp.net",
        senderName: "Alice",
      });
      const msgFromBob = makeMsg({
        body: "hi from bob",
        from: groupJid,
        conversationId: groupJid,
        chatType: "group",
        chatId: groupJid,
        senderJid: "bob@s.whatsapp.net",
        senderName: "Bob",
      });
      const msgFromCarol = makeMsg({
        body: "hi from carol",
        from: groupJid,
        conversationId: groupJid,
        chatType: "group",
        chatId: groupJid,
        senderJid: "carol@s.whatsapp.net",
        senderName: "Carol",
      });

      queue.enqueue(msgFromAlice); // starts processing
      queue.enqueue(msgFromBob); // queued
      queue.enqueue(msgFromCarol); // queued

      expect(processOne).toHaveBeenCalledTimes(1);

      d.resolve();
      await flush();

      // Alice processed, then Bob+Carol coalesced into one synthetic turn.
      expect(mocks.buildCollectPrompt).toHaveBeenCalledTimes(1);
      expect(processOne).toHaveBeenCalledTimes(2);

      const syntheticMsg = processOne.mock.calls[1]?.[0];
      expect(syntheticMsg.body).toBe("GROUP_BATCH");
      expect(syntheticMsg.from).toBe(groupJid);
    });
  });

  describe("renderItem label in buildCollectPrompt", () => {
    it("uses senderName when available", async () => {
      const d = deferred();
      processOne.mockReturnValueOnce(d.promise);
      processOne.mockResolvedValue(undefined);
      mocks.buildCollectPrompt.mockImplementation(
        (p: { renderItem: (item: WebInboundMsg, idx: number) => string; items: WebInboundMsg[] }) =>
          p.renderItem(p.items[0], 0),
      );

      const queue = createWebCoalesceQueue({ cfg, processOne });
      const msg1 = makeMsg({ body: "first", from: "+1111111111" });
      const msg2 = makeMsg({
        body: "hello",
        from: "+1111111111",
        senderName: "Alice",
        timestamp: 1000,
      });
      const msg3 = makeMsg({
        body: "world",
        from: "+1111111111",
        senderName: "Alice",
        timestamp: 2000,
      });

      queue.enqueue(msg1);
      queue.enqueue(msg2);
      queue.enqueue(msg3);

      d.resolve();
      await flush();

      const rendered = processOne.mock.calls[1]?.[0];
      // rendered.body = renderItem(msg2, 0) = "Queued #1 (Alice @ ...)\nhello"
      expect(rendered.body).toMatch(/Queued #1 \(Alice @ /);
      expect(rendered.body).toMatch(/hello/);
    });

    it("falls back to from when no sender fields are present", async () => {
      const d = deferred();
      processOne.mockReturnValueOnce(d.promise);
      processOne.mockResolvedValue(undefined);
      mocks.buildCollectPrompt.mockImplementation(
        (p: { renderItem: (item: WebInboundMsg, idx: number) => string; items: WebInboundMsg[] }) =>
          p.renderItem(p.items[0], 0),
      );

      const queue = createWebCoalesceQueue({ cfg, processOne });
      const from = "+1111111111";
      const msg1 = makeMsg({ body: "first", from });
      const msg2 = makeMsg({ body: "hello", from });
      const msg3 = makeMsg({ body: "world", from });

      queue.enqueue(msg1);
      queue.enqueue(msg2);
      queue.enqueue(msg3);

      d.resolve();
      await flush();

      const rendered = processOne.mock.calls[1]?.[0];
      expect(rendered.body).toMatch(new RegExp(`Queued #1 \\(${from.replace("+", "\\+")} @`));
    });
  });

  describe("error resilience", () => {
    it("continues draining the queue after firstMsg processOne throws", async () => {
      // msg1 rejects immediately; msg2+msg3 are enqueued synchronously before the
      // rejection resolves (next microtask), so they're both in the queue when the
      // loop drains — they get coalesced into one synthetic call.
      processOne.mockRejectedValueOnce(new Error("boom")); // msg1 throws
      processOne.mockResolvedValue(undefined); // coalesced(msg2+msg3) succeeds

      const queue = createWebCoalesceQueue({ cfg, processOne });
      const msg1 = makeMsg({ body: "first", from: "+1111111111" });
      const msg2 = makeMsg({ body: "second", from: "+1111111111" });
      const msg3 = makeMsg({ body: "third", from: "+1111111111" });

      queue.enqueue(msg1);
      queue.enqueue(msg2);
      queue.enqueue(msg3);

      await flush();

      // msg1 (threw) + synthetic(msg2+msg3) = 2 total calls.
      expect(processOne).toHaveBeenCalledTimes(2);
    });

    it("accepts new messages after the loop completes", async () => {
      processOne.mockResolvedValue(undefined);

      const queue = createWebCoalesceQueue({ cfg, processOne });
      const msg1 = makeMsg({ body: "first", from: "+1111111111" });
      const msg2 = makeMsg({ body: "second", from: "+1111111111" });

      queue.enqueue(msg1);
      await flush(); // msg1 fully processed

      queue.enqueue(msg2);
      await flush();

      expect(processOne).toHaveBeenCalledTimes(2);
      expect(processOne).toHaveBeenNthCalledWith(1, msg1);
      expect(processOne).toHaveBeenNthCalledWith(2, msg2);
    });
  });
});
