import { describe, expect, it, vi } from "vitest";
import * as queueModule from "./inbound-durable-queue.js";

describe("DurableDiscordInboundWorker batch hook wiring", () => {
  it("passes a processBatch callback into the durable queue", async () => {
    const start = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(queueModule, "createDiscordInboundDurableQueue").mockReturnValue({
      start,
      stop: vi.fn().mockResolvedValue(undefined),
      enqueue: vi.fn().mockResolvedValue({ enqueued: true, dedupeKey: "x" }),
      recoverExpiredLeases: vi.fn().mockResolvedValue(0),
      getStats: vi.fn().mockResolvedValue({ queued: 0, processing: 0, dead: 0 }),
      listLiveJobsForTest: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof queueModule.createDiscordInboundDurableQueue>);

    const { createDurableDiscordInboundWorker } =
      await import("./inbound-worker.durable.frankclaw.js");

    const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };

    const worker = createDurableDiscordInboundWorker({
      accountId: "test",
      runtime,
      resolveRuntime: () =>
        ({
          runtime,
          abortSignal: undefined,
          guildHistories: new Map(),
          client: {},
          threadBindings: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
          discordRestFetch: vi.fn(),
        }) as unknown as ReturnType<
          Parameters<typeof createDurableDiscordInboundWorker>[0]["resolveRuntime"]
        >,
    });

    await worker.start();

    expect(start).toHaveBeenCalledTimes(1);
    const arg = start.mock.calls[0]?.[0] as { process?: unknown; processBatch?: unknown };
    expect(typeof arg.process).toBe("function");
    expect(typeof arg.processBatch).toBe("function");
  });
});
