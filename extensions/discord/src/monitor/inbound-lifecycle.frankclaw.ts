import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../../../src/config/paths.js";

export type DiscordInboundLifecycleStage =
  | "claimed"
  | "session_init"
  | "session_metadata_persisted"
  | "handler_returned"
  | "run_started"
  | "reply_delivered"
  | "dropped_intentionally";

export type DiscordInboundLifecycleProgress = {
  sessionId?: string;
  sessionFile?: string;
  updatedAt?: number;
  status?: string;
  transcriptExists: boolean;
  transcriptSize: number;
  transcriptMtimeMs: number;
};

export type DiscordInboundLifecycleEventRef = {
  accountId: string;
  orderingKey: string;
  channelId?: string;
  messageId?: string;
};

export type DiscordInboundLifecycleHistoryEntry = {
  stage: DiscordInboundLifecycleStage;
  at: number;
  note?: string;
};

export type DiscordInboundLifecycleRecord = {
  id: string;
  accountId: string;
  orderingKey: string;
  channelId?: string;
  messageId?: string;
  stage: DiscordInboundLifecycleStage;
  createdAt: number;
  updatedAt: number;
  note?: string;
  lastError?: string;
  progress?: DiscordInboundLifecycleProgress;
  history: DiscordInboundLifecycleHistoryEntry[];
};

export type DiscordInboundLifecycleTracker = {
  filePath: string;
  mark: (params: {
    stage: DiscordInboundLifecycleStage;
    note?: string;
    error?: string;
    progress?: DiscordInboundLifecycleProgress;
  }) => Promise<DiscordInboundLifecycleRecord>;
  annotateError: (error: string) => Promise<DiscordInboundLifecycleRecord | null>;
  load: () => Promise<DiscordInboundLifecycleRecord | null>;
  clear: () => Promise<void>;
};

export type RecoverStaleDiscordInboundLifecycleStatesParams = {
  accountId: string;
  stateDir?: string;
  log?: (message: string) => void;
  captureSessionProgress?: (
    orderingKey: string,
  ) => Promise<DiscordInboundLifecycleProgress> | DiscordInboundLifecycleProgress;
};

export type RecoverStaleDiscordInboundLifecycleStatesResult = {
  recoveredCount: number;
  missingTranscriptCount: number;
};

const TERMINAL_STAGES = new Set<DiscordInboundLifecycleStage>([
  "run_started",
  "reply_delivered",
  "dropped_intentionally",
]);

const PRE_START_STAGES = new Set<DiscordInboundLifecycleStage>([
  "claimed",
  "session_init",
  "session_metadata_persisted",
  "handler_returned",
]);

function resolveLifecycleRoot(params: { stateDir?: string; accountId: string }): string {
  return path.join(
    params.stateDir ?? resolveStateDir(),
    "discord-inbound-lifecycle",
    params.accountId,
  );
}

function createLifecycleId(event: DiscordInboundLifecycleEventRef): string {
  return crypto
    .createHash("sha1")
    .update(`${event.orderingKey}\n${event.channelId ?? "-"}\n${event.messageId ?? "-"}`)
    .digest("hex");
}

function resolveLifecycleFilePath(params: {
  stateDir?: string;
  accountId?: string;
  event: DiscordInboundLifecycleEventRef;
}): string {
  const accountId = params.accountId ?? params.event.accountId ?? "";
  return path.join(resolveLifecycleRoot({ stateDir: params.stateDir, accountId }), `${createLifecycleId(params.event)}.json`);
}

async function ensureLifecycleRoot(root: string): Promise<void> {
  await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  await fs.promises.rename(tmp, filePath);
}

async function readRecord(filePath: string): Promise<DiscordInboundLifecycleRecord | null> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(raw) as DiscordInboundLifecycleRecord;
  } catch {
    return null;
  }
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

export function isDiscordInboundLifecycleTerminal(stage: DiscordInboundLifecycleStage): boolean {
  return TERMINAL_STAGES.has(stage);
}

export function isDiscordInboundLifecyclePreStartStage(
  stage: DiscordInboundLifecycleStage,
): boolean {
  return PRE_START_STAGES.has(stage);
}

export function createDiscordInboundLifecycleTracker(params: {
  accountId: string;
  stateDir?: string;
  event: DiscordInboundLifecycleEventRef;
  now?: () => number;
}): DiscordInboundLifecycleTracker {
  const root = resolveLifecycleRoot({ stateDir: params.stateDir, accountId: params.accountId });
  const filePath = resolveLifecycleFilePath({
    stateDir: params.stateDir,
    event: {
      ...params.event,
      accountId: params.accountId,
    },
  });
  const now = params.now ?? (() => Date.now());

  return {
    filePath,
    async mark(markParams) {
      await ensureLifecycleRoot(root);
      const existing = await readRecord(filePath);
      const at = now();
      const next: DiscordInboundLifecycleRecord = {
        id: existing?.id ?? createLifecycleId({ ...params.event, accountId: params.accountId }),
        accountId: params.accountId,
        orderingKey: params.event.orderingKey,
        channelId: params.event.channelId,
        messageId: params.event.messageId,
        stage: markParams.stage,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
        note: markParams.note,
        lastError: markParams.error ?? existing?.lastError,
        progress: markParams.progress ?? existing?.progress,
        history: [
          ...(existing?.history ?? []),
          {
            stage: markParams.stage,
            at,
            ...(markParams.note ? { note: markParams.note } : {}),
          },
        ],
      };
      await writeJsonAtomically(filePath, next);
      return next;
    },
    async annotateError(error) {
      await ensureLifecycleRoot(root);
      const existing = await readRecord(filePath);
      if (!existing) {
        return null;
      }
      const next: DiscordInboundLifecycleRecord = {
        ...existing,
        updatedAt: now(),
        lastError: error,
      };
      await writeJsonAtomically(filePath, next);
      return next;
    },
    async load() {
      return await readRecord(filePath);
    },
    async clear() {
      try {
        await fs.promises.unlink(filePath);
      } catch {
        // noop
      }
    },
  };
}

async function defaultCaptureSessionProgress(
  record: DiscordInboundLifecycleRecord,
): Promise<DiscordInboundLifecycleProgress | undefined> {
  const sessionFile = record.progress?.sessionFile?.trim();
  if (!sessionFile) {
    return record.progress;
  }

  let transcriptExists = false;
  let transcriptSize = 0;
  let transcriptMtimeMs = 0;
  try {
    const stat = await fs.promises.stat(sessionFile);
    if (stat.isFile()) {
      transcriptExists = true;
      transcriptSize = stat.size;
      transcriptMtimeMs = stat.mtimeMs;
    }
  } catch {
    // Missing transcript evidence is part of the diagnosis.
  }

  return {
    ...record.progress,
    transcriptExists,
    transcriptSize,
    transcriptMtimeMs,
  };
}

export async function recoverStaleDiscordInboundLifecycleStates(
  params: RecoverStaleDiscordInboundLifecycleStatesParams,
): Promise<RecoverStaleDiscordInboundLifecycleStatesResult> {
  const root = resolveLifecycleRoot({ stateDir: params.stateDir, accountId: params.accountId });
  let entries: string[];
  try {
    entries = await fs.promises.readdir(root);
  } catch {
    return { recoveredCount: 0, missingTranscriptCount: 0 };
  }

  let recoveredCount = 0;
  let missingTranscriptCount = 0;

  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(root, entry);
    const record = await readRecord(filePath);
    if (!record || isDiscordInboundLifecycleTerminal(record.stage)) {
      continue;
    }

    recoveredCount += 1;
    const progress = params.captureSessionProgress
      ? await params.captureSessionProgress(record.orderingKey)
      : await defaultCaptureSessionProgress(record);

    params.log?.(
      `[frankclaw-durable-worker] stale pre-start lifecycle state recovered: ` +
        `stage=${record.stage} orderingKey=${record.orderingKey} channelId=${record.channelId ?? "-"} ` +
        `messageId=${record.messageId ?? "-"} updatedAt=${record.updatedAt}`,
    );

    if (progress?.sessionFile && !progress.transcriptExists) {
      missingTranscriptCount += 1;
      params.log?.(
        `[frankclaw-durable-worker] session metadata exists but transcript missing: ` +
          `stage=${record.stage} orderingKey=${record.orderingKey} sessionId=${progress.sessionId ?? "-"} ` +
          `sessionFile=${progress.sessionFile}`,
      );
    }
  }

  return { recoveredCount, missingTranscriptCount };
}

export const __testing = {
  createLifecycleId,
  normalizeError,
};
