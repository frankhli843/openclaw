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

  it("drops exec completion events that embed the heartbeat prompt", async () => {
    const sessionKey = "agent:main:discord:channel:123";
    enqueueSystemEvent(
      "Exec completed: bash scripts/do-something.sh\nRead HEARTBEAT.md if it exists (workspace context). Follow it strictly.",
      { sessionKey },
    );

    const result = await drainFormattedSystemEvents({
      cfg: {} as never,
      sessionKey,
      isMainSession: false,
      isNewSession: false,
    });

    expect(result).toBeUndefined();
  });
});
