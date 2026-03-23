/**
 * Frankclaw: deferDelivery function for DNR quiet window support.
 * Defers a queue entry without incrementing retry counters.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import type { QueuedDelivery } from "./delivery-queue-storage.js";

/** Frankclaw-extended queue entry with defer/hold fields */
interface FrankcawQueuedDelivery extends QueuedDelivery {
  deferUntilMs?: number;
  holdReason?: string;
}

const QUEUE_DIRNAME = "delivery-queue";

function resolveQueueDir(stateDir?: string): string {
  return path.join(stateDir ?? resolveStateDir(), QUEUE_DIRNAME);
}

/** Defer a queue entry without incrementing retry counters (suppression/hold behavior). */
export async function deferDelivery(
  id: string,
  deferUntilMs: number,
  reason: string,
  stateDir?: string,
): Promise<void> {
  const filePath = path.join(resolveQueueDir(stateDir), `${id}.json`);
  const raw = await fs.promises.readFile(filePath, "utf-8");
  const entry: FrankcawQueuedDelivery = JSON.parse(raw);
  entry.lastAttemptAt = Date.now();
  entry.deferUntilMs = Math.max(Date.now(), Math.floor(deferUntilMs));
  entry.holdReason = reason;
  entry.lastError = reason;
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(entry, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  const deferFd = await fs.promises.open(tmp, "r");
  await deferFd.sync();
  await deferFd.close();
  await fs.promises.rename(tmp, filePath);
}
