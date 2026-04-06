import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../infra/channel-summary.js", () => ({
  buildChannelSummary: vi.fn(async () => []),
}));

import { enqueueSystemEvent, resetSystemEventsForTest } from "../../infra/system-events.js";
import { drainFormattedSystemEvents } from "./session-system-events.js";

describe("drainFormattedSystemEvents heartbeat routing hygiene", () => {
  beforeEach(() => {
    resetSystemEventsForTest();
  });

  it.each([
    "Exec completed: bash scripts/do-something.sh\nRead HEARTBEAT.md if it exists (workspace context). Follow it strictly.",
    "Exec completed: bash scripts/do-something.sh\nok",
    "System: [2026-04-06 11:04:00] Exec completed: bash scripts/do-something.sh",
    "System: [2026-04-06 11:04:00] HEARTBEAT_OK",
  ])("drops wrapped internal system noise: %s", async (eventText) => {
    const sessionKey = "agent:main:discord:channel:123";
    enqueueSystemEvent(eventText, { sessionKey });

    const result = await drainFormattedSystemEvents({
      cfg: {} as never,
      sessionKey,
      isMainSession: false,
      isNewSession: false,
    });

    expect(result).toBeUndefined();
  });

  it("keeps legitimate system events", async () => {
    const sessionKey = "agent:main:discord:channel:123";
    enqueueSystemEvent("Model switched.", { sessionKey });

    const result = await drainFormattedSystemEvents({
      cfg: {} as never,
      sessionKey,
      isMainSession: false,
      isNewSession: false,
    });

    expect(result).toContain("System: [");
    expect(result).toContain("Model switched.");
  });
});
