import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { callGateway } from "../gateway/call.js";

export type ScheduledAgentMessage = {
  id: string;
  sessionKey: string;
  message: string;
  deliver: boolean;
  canReadBy: number;
  createdAt: number;
  status: "pending" | "dispatched" | "failed";
  group?: string;
  replyChannel?: string;
  replyTo?: string;
  replyAccountId?: string;
  threadId?: string;
  lastError?: string;
};

function getQueueDir(stateDir?: string): string {
  return path.join(stateDir ?? resolveStateDir(), "scheduled-agent");
}

/**
 * Returns the path to the scheduled agent queue directory.
 * Named DbPath for API consistency with the feature spec.
 */
export function getScheduledAgentDbPath(stateDir?: string): string {
  return getQueueDir(stateDir);
}

async function ensureQueueDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
}

function resolveMessagePath(dir: string, id: string): string {
  return path.join(dir, `${id}.json`);
}

async function writeMessageAtomically(filePath: string, msg: ScheduledAgentMessage): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(msg, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  await fs.promises.rename(tmp, filePath);
}

async function readMessage(filePath: string): Promise<ScheduledAgentMessage | null> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(raw) as ScheduledAgentMessage;
  } catch {
    return null;
  }
}

async function listMessageFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(dir);
    return entries.filter((e) => e.endsWith(".json")).map((e) => path.join(dir, e));
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : null;
    if (code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function listAllMessages(dir: string): Promise<ScheduledAgentMessage[]> {
  const files = await listMessageFiles(dir);
  const messages: ScheduledAgentMessage[] = [];
  for (const filePath of files) {
    const msg = await readMessage(filePath);
    if (msg) {
      messages.push(msg);
    }
  }
  return messages;
}

/**
 * Add a message to the queue. If `group` is set, any existing pending
 * messages with the same group are deleted first (only the latest survives).
 */
export async function enqueueScheduledAgent(params: {
  sessionKey: string;
  message: string;
  deliver: boolean;
  canReadBy: number;
  group?: string;
  replyChannel?: string;
  replyTo?: string;
  replyAccountId?: string;
  threadId?: string;
  stateDir?: string;
}): Promise<{ id: string }> {
  const dir = getQueueDir(params.stateDir);
  await ensureQueueDir(dir);

  if (params.group) {
    const existing = await listAllMessages(dir);
    for (const msg of existing) {
      if (msg.group === params.group && msg.status === "pending") {
        try {
          await fs.promises.unlink(resolveMessagePath(dir, msg.id));
        } catch {
          // Best effort: ignore if already gone
        }
      }
    }
  }

  const id = crypto.randomUUID();
  const msg: ScheduledAgentMessage = {
    id,
    sessionKey: params.sessionKey,
    message: params.message,
    deliver: params.deliver,
    canReadBy: params.canReadBy,
    createdAt: Date.now(),
    status: "pending",
    ...(params.group !== undefined ? { group: params.group } : {}),
    ...(params.replyChannel ? { replyChannel: params.replyChannel } : {}),
    ...(params.replyTo ? { replyTo: params.replyTo } : {}),
    ...(params.replyAccountId ? { replyAccountId: params.replyAccountId } : {}),
    ...(params.threadId ? { threadId: params.threadId } : {}),
  };

  await writeMessageAtomically(resolveMessagePath(dir, id), msg);
  return { id };
}

/**
 * Return all messages where canReadBy <= now AND status = "pending",
 * sorted by canReadBy ascending.
 */
export async function pollReadyMessages(
  now: number,
  stateDir?: string,
): Promise<ScheduledAgentMessage[]> {
  const dir = getQueueDir(stateDir);
  const messages = await listAllMessages(dir);
  return messages
    .filter((msg) => msg.canReadBy <= now && msg.status === "pending")
    .toSorted((a, b) => a.canReadBy - b.canReadBy);
}

/** Mark a message as dispatched (prevents re-dispatch on future polls). */
export async function markDispatched(id: string, stateDir?: string): Promise<void> {
  const dir = getQueueDir(stateDir);
  const filePath = resolveMessagePath(dir, id);
  const msg = await readMessage(filePath);
  if (!msg) {
    return;
  }
  const updated: ScheduledAgentMessage = { ...msg, status: "dispatched" };
  await writeMessageAtomically(filePath, updated);
}

/** Mark a message as failed with the error string. */
export async function markFailed(id: string, error: string, stateDir?: string): Promise<void> {
  const dir = getQueueDir(stateDir);
  const filePath = resolveMessagePath(dir, id);
  const msg = await readMessage(filePath);
  if (!msg) {
    return;
  }
  const updated: ScheduledAgentMessage = { ...msg, status: "failed", lastError: error };
  await writeMessageAtomically(filePath, updated);
}

async function pollAndDispatch(stateDir?: string): Promise<void> {
  let messages: ScheduledAgentMessage[];
  try {
    messages = await pollReadyMessages(Date.now(), stateDir);
  } catch {
    return;
  }
  if (messages.length > 0) {
    console.info(`[scheduled-agent] poller found ${messages.length} ready message(s)`);
  }
  for (const msg of messages) {
    try {
      console.info(
        `[scheduled-agent] dispatching: id=${msg.id} session=${msg.sessionKey} channel=${msg.replyChannel ?? "last"}`,
      );
      // Mark dispatched first so concurrent polls skip this message
      await markDispatched(msg.id, stateDir);
      await callGateway({
        method: "agent",
        params: {
          sessionKey: msg.sessionKey,
          message: msg.message,
          deliver: msg.deliver,
          channel: msg.replyChannel ?? "last",
          replyChannel: msg.replyChannel,
          replyTo: msg.replyTo,
          replyAccountId: msg.replyAccountId,
          threadId: msg.threadId,
          idempotencyKey: msg.id,
        },
      });
    } catch (err) {
      try {
        await markFailed(msg.id, String(err), stateDir);
      } catch {
        // Best effort
      }
    }
  }
}

let pollerInterval: NodeJS.Timeout | null = null;

/**
 * Start a recurring poller (every 5s by default) that dispatches ready messages
 * via callGateway. Also dispatches immediately on start.
 *
 * @param params.intervalMs - Override poll interval (default 5000). Useful in tests.
 */
export function startScheduledAgentPoller(
  params: { stateDir?: string; intervalMs?: number } = {},
): void {
  if (pollerInterval) {
    return;
  }
  const ms = params.intervalMs ?? 5_000;
  // Dispatch immediately so any pending messages are handled on startup
  void pollAndDispatch(params.stateDir);
  pollerInterval = setInterval(() => {
    void pollAndDispatch(params.stateDir);
  }, ms);
  pollerInterval.unref?.();
}

/** Stop the scheduled agent poller. */
export function stopScheduledAgentPoller(): void {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
  }
}
