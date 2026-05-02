import { describe, it, expect } from "vitest";
import { shouldSendAckReactionFrankclaw } from "./message-handler.process.ack-gate.frankclaw.js";

describe("shouldSendAckReactionFrankclaw", () => {
  it("returns true when shouldAckReactionResult is true and replies are tool-only", () => {
    expect(
      shouldSendAckReactionFrankclaw({
        shouldAckReactionResult: true,
        sourceRepliesAreToolOnly: true,
      }),
    ).toBe(true);
  });

  it("returns true when shouldAckReactionResult is true and replies are automatic", () => {
    expect(
      shouldSendAckReactionFrankclaw({
        shouldAckReactionResult: true,
        sourceRepliesAreToolOnly: false,
      }),
    ).toBe(true);
  });

  it("returns false when shouldAckReactionResult is false regardless of reply mode", () => {
    expect(
      shouldSendAckReactionFrankclaw({
        shouldAckReactionResult: false,
        sourceRepliesAreToolOnly: true,
      }),
    ).toBe(false);
    expect(
      shouldSendAckReactionFrankclaw({
        shouldAckReactionResult: false,
        sourceRepliesAreToolOnly: false,
      }),
    ).toBe(false);
  });
});
