import { Routes } from "discord-api-types/v10";
import { describe, expect, it, vi } from "vitest";
import { reactMessageDiscord } from "./send.reactions.js";

describe("reactMessageDiscord archived thread retry", () => {
  it("unarchives thread and retries when reaction fails with archived thread error", async () => {
    const put = vi
      .fn()
      .mockRejectedValueOnce(new Error("Thread is archived"))
      .mockResolvedValueOnce({});
    const patch = vi.fn().mockResolvedValueOnce({});

    const rest = { put, patch };

    await expect(
      reactMessageDiscord("thread-1", "msg-1", "👀", {
        rest: rest as never,
        token: "test-token",
        accountId: "default",
        cfg: { channels: { discord: { enabled: true } } } as never,
      }),
    ).resolves.toEqual({ ok: true });

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(Routes.channel("thread-1"), {
      body: { archived: false },
    });
    expect(put).toHaveBeenCalledTimes(2);
  });
});
