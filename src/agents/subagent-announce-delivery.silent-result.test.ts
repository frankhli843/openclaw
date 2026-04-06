import { describe, expect, it } from "vitest";

import { __testing as deliveryTesting } from "./subagent-announce-delivery.js";

describe("completion result visibility classification", () => {
  it("treats NO_REPLY completion results as non-deliverable", () => {
    expect(
      deliveryTesting.hasDeliverableCompletionFinalResult({ reply: { text: "NO_REPLY" } }),
    ).toBe(false);
  });

  it("treats raw internal-context completion results as non-deliverable", () => {
    expect(
      deliveryTesting.hasDeliverableCompletionFinalResult({
        text: [
          "<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>",
          "OpenClaw runtime context (internal):",
          "[Internal task completion event]",
          "<<<END_OPENCLAW_INTERNAL_CONTEXT>>>",
        ].join("\n"),
      }),
    ).toBe(false);
  });

  it("accepts visible completion text", () => {
    expect(
      deliveryTesting.hasDeliverableCompletionFinalResult({
        reply: { text: "Done, the routing fix is live." },
      }),
    ).toBe(true);
  });
});
