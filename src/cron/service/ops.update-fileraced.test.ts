// frankclaw: regression test for the silent jobs.json corruption class-of-bug
// (2026-05-02). When the cron service has an in-memory store loaded and a
// concurrent writer adds jobs to jobs.json on disk, the next cron.update
// call would persist the stale in-memory snapshot and drop the on-disk
// additions. This file pins the safe behavior: update/add/remove must read
// from disk before write so external additions survive a mutation.
import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { setupCronServiceSuite } from "../service.test-harness.js";
import type { CronJob } from "../types.js";
import { add, remove, update } from "./ops.js";
import { createCronServiceState } from "./state.js";
import { ensureLoaded } from "./store.js";

const { logger, makeStorePath } = setupCronServiceSuite({
  prefix: "cron-service-ops-fileraced-",
});

const STORE_TEST_NOW = Date.parse("2026-05-02T12:00:00.000Z");

function createState(storePath: string) {
  return createCronServiceState({
    storePath,
    cronEnabled: true,
    log: logger,
    nowMs: () => STORE_TEST_NOW,
    enqueueSystemEvent: vi.fn(),
    requestHeartbeatNow: vi.fn(),
    runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
  });
}

function makeJob(id: string, overrides: Partial<CronJob> = {}): CronJob {
  return {
    id,
    name: `job ${id}`,
    enabled: true,
    createdAtMs: STORE_TEST_NOW - 60_000,
    updatedAtMs: STORE_TEST_NOW - 60_000,
    schedule: { kind: "every", everyMs: 60_000, anchorMs: STORE_TEST_NOW - 60_000 },
    sessionTarget: "main",
    wakeMode: "now",
    payload: { kind: "systemEvent", text: `tick-${id}` },
    state: {},
    ...overrides,
  };
}

async function writeJobsFile(storePath: string, jobs: CronJob[]) {
  await fs.mkdir(storePath.replace(/[/\\][^/\\]+$/, ""), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify({ version: 1, jobs }, null, 2), "utf8");
}

async function readJobIds(storePath: string): Promise<string[]> {
  const raw = JSON.parse(await fs.readFile(storePath, "utf8")) as {
    jobs: Array<{ id?: string }>;
  };
  return (raw.jobs ?? []).map((j) => String(j.id));
}

describe("cron service jobs.json file-race regression", () => {
  it("update preserves jobs added to jobs.json by a concurrent writer", async () => {
    const { storePath } = await makeStorePath();
    const original = [makeJob("alpha"), makeJob("beta"), makeJob("gamma")];
    await writeJobsFile(storePath, original);

    const state = createState(storePath);
    // Hydrate the in-memory store from disk (this is the path normally taken
    // when the gateway boots and a WS client later issues cron.update).
    await ensureLoaded(state, { skipRecompute: true });

    // Concurrent writer (e.g. another gateway, manual file-edit workaround,
    // or a sub-agent script) adds two more jobs to disk. The current
    // gateway has not been told to reload.
    const externalAdds = [makeJob("delta"), makeJob("epsilon")];
    await writeJobsFile(storePath, [...original, ...externalAdds]);

    // Now apply a benign update to one of the original jobs through the
    // service. The ops layer must merge with current disk state, NOT
    // overwrite the file with the stale in-memory snapshot.
    await update(state, "alpha", { description: "post-edit" });

    const idsAfter = await readJobIds(storePath);
    expect(idsAfter).toEqual(
      expect.arrayContaining(["alpha", "beta", "gamma", "delta", "epsilon"]),
    );
    expect(idsAfter).toHaveLength(5);
  });

  it("add preserves jobs added to jobs.json by a concurrent writer", async () => {
    const { storePath } = await makeStorePath();
    const original = [makeJob("alpha"), makeJob("beta")];
    await writeJobsFile(storePath, original);

    const state = createState(storePath);
    await ensureLoaded(state, { skipRecompute: true });

    await writeJobsFile(storePath, [...original, makeJob("delta")]);

    await add(state, {
      name: "added via service",
      enabled: true,
      schedule: { kind: "every", everyMs: 60_000, anchorMs: STORE_TEST_NOW - 60_000 },
      sessionTarget: "main",
      wakeMode: "now",
      payload: { kind: "systemEvent", text: "tick" },
    });

    const idsAfter = await readJobIds(storePath);
    expect(idsAfter).toEqual(expect.arrayContaining(["alpha", "beta", "delta"]));
    expect(idsAfter).toHaveLength(4);
  });

  it("remove preserves jobs added to jobs.json by a concurrent writer", async () => {
    const { storePath } = await makeStorePath();
    const original = [makeJob("alpha"), makeJob("beta"), makeJob("gamma")];
    await writeJobsFile(storePath, original);

    const state = createState(storePath);
    await ensureLoaded(state, { skipRecompute: true });

    await writeJobsFile(storePath, [...original, makeJob("delta")]);

    await remove(state, "beta");

    const idsAfter = await readJobIds(storePath);
    // beta deliberately removed via the service.
    // alpha + gamma + delta survive (3 entries).
    expect(idsAfter.sort()).toEqual(["alpha", "delta", "gamma"]);
  });
});
