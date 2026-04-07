import { describe, expect, it } from "vitest";
/**
 * Tests that delivery context forwarding works correctly for sessions.send.
 *
 * When sessions.send dispatches a message, the delivery context from the
 * originating session must be forwarded so replies route back to the
 * correct channel/target.
 */
import { normalizeDeliveryContext, mergeDeliveryContext } from "./delivery-context.js";

describe("sessions.send delivery context forwarding", () => {
  it("mergeDeliveryContext uses primary over fallback", () => {
    const primary = normalizeDeliveryContext({
      channel: "whatsapp",
      to: "group@g.us",
      accountId: "work",
    });
    const fallback = normalizeDeliveryContext({
      channel: "discord",
      to: "channel-1",
    });

    // primary wins
    const merged = mergeDeliveryContext(primary, fallback);
    expect(merged?.channel).toBe("whatsapp");
    expect(merged?.to).toBe("group@g.us");
    expect(merged?.accountId).toBe("work");
  });

  it("mergeDeliveryContext uses fallback when primary is undefined", () => {
    const fallback = normalizeDeliveryContext({
      channel: "telegram",
      to: "chat-123",
    });

    const merged = mergeDeliveryContext(undefined, fallback);
    expect(merged?.channel).toBe("telegram");
    expect(merged?.to).toBe("chat-123");
  });

  it("mergeDeliveryContext returns primary when fallback is undefined", () => {
    const primary = normalizeDeliveryContext({
      channel: "discord",
      to: "456",
    });

    const merged = mergeDeliveryContext(primary, undefined);
    expect(merged?.channel).toBe("discord");
    expect(merged?.to).toBe("456");
  });

  it("preserves threadId in forwarded context", () => {
    const ctx = normalizeDeliveryContext({
      channel: "discord",
      to: "ch-1",
      threadId: "thread-abc",
    });
    const merged = mergeDeliveryContext(ctx, undefined);
    expect(merged?.threadId).toBe("thread-abc");
  });

  it("forwarded context survives round-trip through normalize", () => {
    const original = {
      channel: "whatsapp",
      to: "group@g.us",
      accountId: "personal",
    };

    const normalized = normalizeDeliveryContext(original);
    const renormalized = normalizeDeliveryContext(normalized);

    expect(renormalized?.channel).toBe(original.channel);
    expect(renormalized?.to).toBe(original.to);
    expect(renormalized?.accountId).toBe(original.accountId);
  });

  it("mergeDeliveryContext returns undefined when both are undefined", () => {
    const merged = mergeDeliveryContext(undefined, undefined);
    expect(merged).toBeUndefined();
  });
});
