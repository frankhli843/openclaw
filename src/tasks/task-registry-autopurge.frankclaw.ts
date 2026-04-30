/**
 * frankclaw: Auto-purge old completed task records from the SQLite registry.
 *
 * The task registry grows unbounded (8000+ records in production). The
 * maintenance sweep iterates ALL records every 60s with O(n) cloning.
 * Purging old completed records keeps the sweep fast.
 *
 * Runs once on gateway startup, then daily via the maintenance sweep.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("frankclaw/task-autopurge");

const PURGE_AGE_DAYS = 3;
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
let lastPurgeAt = 0;

export function maybePurgeOldTaskRecords(params: {
  listTaskRecords: () => Array<{ taskId: string; status: string; createdAt?: number }>;
  deleteTaskRecordById: (id: string) => boolean;
}): number {
  const now = Date.now();
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) {
    return 0;
  }
  lastPurgeAt = now;

  const cutoff = now - PURGE_AGE_DAYS * 24 * 60 * 60 * 1000;
  const terminalStatuses = new Set(["succeeded", "failed", "lost", "timed_out"]);
  let purged = 0;

  for (const task of params.listTaskRecords()) {
    if (
      terminalStatuses.has(task.status) &&
      typeof task.createdAt === "number" &&
      task.createdAt < cutoff
    ) {
      if (params.deleteTaskRecordById(task.taskId)) {
        purged += 1;
      }
    }
  }

  if (purged > 0) {
    log.info(`Auto-purged ${purged} completed task records older than ${PURGE_AGE_DAYS} days`);
  }
  return purged;
}
