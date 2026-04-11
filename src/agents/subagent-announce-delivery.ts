import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import type { ConversationRef } from "../infra/outbound/session-binding-service.js";
import { normalizeAccountId } from "../routing/session-key.js";
import { defaultRuntime } from "../runtime.js";
import { isCronSessionKey } from "../sessions/session-key-utils.js";
import { normalizeOptionalLowercaseString } from "../shared/string-coerce.js";
import {
  mergeDeliveryContext,
  normalizeDeliveryContext,
  resolveConversationDeliveryTarget,
} from "../utils/delivery-context.js";
import {
  INTERNAL_MESSAGE_CHANNEL,
  isGatewayMessageChannel,
  isInternalMessageChannel,
  normalizeMessageChannel,
} from "../utils/message-channel.js";
import { buildAnnounceIdempotencyKey, resolveQueueAnnounceId } from "./announce-idempotency.js";
import type { AgentInternalEvent } from "./internal-events.js";
import {
  hasInternalRuntimeContext,
  stripInternalRuntimeContext,
} from "./internal-runtime-context.js";
import {
  callGateway,
  createBoundDeliveryRouter,
  getGlobalHookRunner,
  isEmbeddedPiRunActive,
  loadConfig,
  loadSessionStore,
  queueEmbeddedPiMessage,
  resolveAgentIdFromSessionKey,
  resolveConversationIdFromTargets,
  resolveExternalBestEffortDeliveryTarget,
  resolveQueueSettings,
  resolveStorePath,
} from "./subagent-announce-delivery.runtime.js";
import {
  runSubagentAnnounceDispatch,
  type SubagentAnnounceDeliveryResult,
} from "./subagent-announce-dispatch.js";
import { resolveAnnounceOrigin, type DeliveryContext } from "./subagent-announce-origin.js";
import { type AnnounceQueueItem, enqueueAnnounce } from "./subagent-announce-queue.js";
import { getSubagentDepthFromSessionStore } from "./subagent-depth.js";
import { resolveRequesterStoreKey } from "./subagent-requester-store-key.js";
import type { SpawnSubagentMode } from "./subagent-spawn.types.js";
import { isAnnounceSkip } from "./tools/sessions-send-tokens.js";

export { resolveAnnounceOrigin } from "./subagent-announce-origin.js";

const DEFAULT_SUBAGENT_ANNOUNCE_TIMEOUT_MS = 300_000;
const MAX_TIMER_SAFE_TIMEOUT_MS = 2_147_000_000;

type SubagentAnnounceDeliveryDeps = {
  callGateway: typeof callGateway;
  loadConfig: typeof loadConfig;
};

const defaultSubagentAnnounceDeliveryDeps: SubagentAnnounceDeliveryDeps = {
  callGateway,
  loadConfig,
};

let subagentAnnounceDeliveryDeps: SubagentAnnounceDeliveryDeps =
  defaultSubagentAnnounceDeliveryDeps;

function resolveDirectAnnounceTransientRetryDelaysMs() {
  return process.env.OPENCLAW_TEST_FAST === "1"
    ? ([8, 16, 32] as const)
    : ([5_000, 10_000, 20_000] as const);
}

export function resolveSubagentAnnounceTimeoutMs(cfg: ReturnType<typeof loadConfig>): number {
  const configured = cfg.agents?.defaults?.subagents?.announceTimeoutMs;
  if (typeof configured !== "number" || !Number.isFinite(configured)) {
    return DEFAULT_SUBAGENT_ANNOUNCE_TIMEOUT_MS;
  }
  return Math.min(Math.max(1, Math.floor(configured)), MAX_TIMER_SAFE_TIMEOUT_MS);
}

export function isInternalAnnounceRequesterSession(sessionKey: string | undefined): boolean {
  return getSubagentDepthFromSessionStore(sessionKey) >= 1 || isCronSessionKey(sessionKey);
}

function summarizeDeliveryError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || "error";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error === undefined || error === null) {
    return "unknown error";
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "error";
  }
}

/**
 * [frankclaw] Build a user-facing fallback message from internal events.
 *
 * The fallback delivery path previously sent `params.triggerMessage` (the raw
 * <<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>> block) directly to external channels
 * like WhatsApp.  This leaked internal session keys, stats, and untrusted
 * child result text to the user and, worse, to any downstream ACP session
 * that intercepted the message (2026-04-10 regression: completion context
 * injected into an unrelated Claude Code session).
 *
 * Instead, extract a short user-facing summary from the structured
 * `internalEvents` array.  If no events are available, strip the internal
 * runtime context from the trigger message and use whatever remains.
 */
function buildSanitizedFallbackMessage(
  triggerMessage: string,
  internalEvents?: AgentInternalEvent[],
): string {
  // Prefer structured events — they carry task label + status without leaking
  // session keys or raw child output.
  if (internalEvents && internalEvents.length > 0) {
    const summaries: string[] = [];
    for (const event of internalEvents) {
      if (event.type === "task_completion") {
        const label = event.taskLabel?.trim() || "background task";
        const status = event.statusLabel?.trim() || event.status || "done";
        summaries.push(`${label}: ${status}`);
      }
    }
    if (summaries.length > 0) {
      return summaries.join("\n");
    }
  }

  // Fallback: strip internal context markers.  If nothing meaningful remains,
  // return a generic placeholder so we never send an empty or all-fence message.
  const stripped = stripInternalRuntimeContext(triggerMessage).trim();
  if (stripped && !hasInternalRuntimeContext(stripped)) {
    return stripped;
  }
  return "A background task completed.";
}

function normalizeCompletionReplyText(text: string): string {
  const stripped = stripInternalRuntimeContext(text).trim();
  if (!stripped) {
    return "";
  }
  if (isAnnounceSkip(stripped) || isSilentReplyText(stripped, SILENT_REPLY_TOKEN)) {
    return "";
  }
  return stripped;
}

function collectCompletionReplySignals(
  value: unknown,
  state: { texts: string[]; hasMedia: boolean },
  depth = 0,
): void {
  if (value == null || depth > 5) {
    return;
  }
  if (typeof value === "string") {
    const normalized = normalizeCompletionReplyText(value);
    if (normalized) {
      state.texts.push(normalized);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectCompletionReplySignals(item, state, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.mediaUrl === "string" || typeof record.mediaPath === "string") {
    state.hasMedia = true;
  }

  const content = record.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const typedBlock = block as Record<string, unknown>;
      const type = typeof typedBlock.type === "string" ? typedBlock.type : "";
      if (type === "image" || type === "audio" || type === "video" || type === "file") {
        state.hasMedia = true;
      }
      if (typeof typedBlock.text === "string") {
        const normalized = normalizeCompletionReplyText(typedBlock.text);
        if (normalized) {
          state.texts.push(normalized);
        }
      }
    }
  }

  for (const key of ["text", "reply", "payloads", "message", "messages", "final", "finalReply"]) {
    if (key in record) {
      collectCompletionReplySignals(record[key], state, depth + 1);
    }
  }
}

function hasDeliverableCompletionFinalResult(result: unknown): boolean {
  const state = { texts: [] as string[], hasMedia: false };
  collectCompletionReplySignals(result, state);
  return state.hasMedia || state.texts.length > 0;
}

const TRANSIENT_ANNOUNCE_DELIVERY_ERROR_PATTERNS: readonly RegExp[] = [
  /\berrorcode=unavailable\b/i,
  /\bstatus\s*[:=]\s*"?unavailable\b/i,
  /\bUNAVAILABLE\b/,
  /no active .* listener/i,
  /gateway not connected/i,
  /gateway closed \(1006/i,
  /gateway timeout/i,
  /\b(econnreset|econnrefused|etimedout|enotfound|ehostunreach|network error)\b/i,
];

const PERMANENT_ANNOUNCE_DELIVERY_ERROR_PATTERNS: readonly RegExp[] = [
  /unsupported channel/i,
  /unknown channel/i,
  /chat not found/i,
  /user not found/i,
  /bot.*not.*member/i,
  /bot was blocked by the user/i,
  /forbidden: bot was kicked/i,
  /recipient is not a valid/i,
  /outbound not configured for channel/i,
];

function isTransientAnnounceDeliveryError(error: unknown): boolean {
  const message = summarizeDeliveryError(error);
  if (!message) {
    return false;
  }
  if (PERMANENT_ANNOUNCE_DELIVERY_ERROR_PATTERNS.some((re) => re.test(message))) {
    return false;
  }
  return TRANSIENT_ANNOUNCE_DELIVERY_ERROR_PATTERNS.some((re) => re.test(message));
}

async function waitForAnnounceRetryDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }
  if (!signal) {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
    return;
  }
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runAnnounceDeliveryWithRetry<T>(params: {
  operation: string;
  signal?: AbortSignal;
  run: () => Promise<T>;
}): Promise<T> {
  const retryDelaysMs = resolveDirectAnnounceTransientRetryDelaysMs();
  let retryIndex = 0;
  for (;;) {
    if (params.signal?.aborted) {
      throw new Error("announce delivery aborted");
    }
    try {
      return await params.run();
    } catch (err) {
      const delayMs = retryDelaysMs[retryIndex];
      if (delayMs == null || !isTransientAnnounceDeliveryError(err) || params.signal?.aborted) {
        throw err;
      }
      const nextAttempt = retryIndex + 2;
      const maxAttempts = retryDelaysMs.length + 1;
      defaultRuntime.log(
        `[warn] Subagent announce ${params.operation} transient failure, retrying ${nextAttempt}/${maxAttempts} in ${Math.round(delayMs / 1000)}s: ${summarizeDeliveryError(err)}`,
      );
      retryIndex += 1;
      await waitForAnnounceRetryDelay(delayMs, params.signal);
    }
  }
}

export async function resolveSubagentCompletionOrigin(params: {
  childSessionKey: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  childRunId?: string;
  spawnMode?: SpawnSubagentMode;
  expectsCompletionMessage: boolean;
}): Promise<DeliveryContext | undefined> {
  const requesterOrigin = normalizeDeliveryContext(params.requesterOrigin);
  const channel = normalizeOptionalLowercaseString(requesterOrigin?.channel);
  const to = requesterOrigin?.to?.trim();
  const accountId = normalizeAccountId(requesterOrigin?.accountId);
  const threadId =
    requesterOrigin?.threadId != null && requesterOrigin.threadId !== ""
      ? String(requesterOrigin.threadId).trim()
      : undefined;
  const conversationId =
    threadId ||
    resolveConversationIdFromTargets({
      targets: [to],
    }) ||
    "";
  const requesterConversation: ConversationRef | undefined =
    channel && conversationId ? { channel, accountId, conversationId } : undefined;

  const route = createBoundDeliveryRouter().resolveDestination({
    eventKind: "task_completion",
    targetSessionKey: params.childSessionKey,
    requester: requesterConversation,
    failClosed: false,
  });
  if (route.mode === "bound" && route.binding) {
    const boundTarget = resolveConversationDeliveryTarget({
      channel: route.binding.conversation.channel,
      conversationId: route.binding.conversation.conversationId,
      parentConversationId: route.binding.conversation.parentConversationId,
    });
    return mergeDeliveryContext(
      {
        channel: route.binding.conversation.channel,
        accountId: route.binding.conversation.accountId,
        to: boundTarget.to,
        threadId:
          boundTarget.threadId ??
          (requesterOrigin?.threadId != null && requesterOrigin.threadId !== ""
            ? String(requesterOrigin.threadId)
            : undefined),
      },
      requesterOrigin,
    );
  }

  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("subagent_delivery_target")) {
    return requesterOrigin;
  }
  try {
    const result = await hookRunner.runSubagentDeliveryTarget(
      {
        childSessionKey: params.childSessionKey,
        requesterSessionKey: params.requesterSessionKey,
        requesterOrigin,
        childRunId: params.childRunId,
        spawnMode: params.spawnMode,
        expectsCompletionMessage: params.expectsCompletionMessage,
      },
      {
        runId: params.childRunId,
        childSessionKey: params.childSessionKey,
        requesterSessionKey: params.requesterSessionKey,
      },
    );
    const hookOrigin = normalizeDeliveryContext(result?.origin);
    if (!hookOrigin) {
      return requesterOrigin;
    }
    if (hookOrigin.channel && isInternalMessageChannel(hookOrigin.channel)) {
      return requesterOrigin;
    }
    return mergeDeliveryContext(hookOrigin, requesterOrigin);
  } catch {
    return requesterOrigin;
  }
}

async function sendAnnounce(item: AnnounceQueueItem) {
  const cfg = subagentAnnounceDeliveryDeps.loadConfig();
  const announceTimeoutMs = resolveSubagentAnnounceTimeoutMs(cfg);
  const requesterIsSubagent = isInternalAnnounceRequesterSession(item.sessionKey);
  const origin = item.origin;
  const threadId =
    origin?.threadId != null && origin.threadId !== "" ? String(origin.threadId) : undefined;
  const idempotencyKey = buildAnnounceIdempotencyKey(
    resolveQueueAnnounceId({
      announceId: item.announceId,
      sessionKey: item.sessionKey,
      enqueuedAt: item.enqueuedAt,
    }),
  );
  await subagentAnnounceDeliveryDeps.callGateway({
    method: "agent",
    params: {
      sessionKey: item.sessionKey,
      message: item.prompt,
      channel: requesterIsSubagent ? undefined : origin?.channel,
      accountId: requesterIsSubagent ? undefined : origin?.accountId,
      to: requesterIsSubagent ? undefined : origin?.to,
      threadId: requesterIsSubagent ? undefined : threadId,
      deliver: !requesterIsSubagent,
      internalEvents: item.internalEvents,
      inputProvenance: {
        kind: "inter_session",
        sourceSessionKey: item.sourceSessionKey,
        sourceChannel: item.sourceChannel ?? INTERNAL_MESSAGE_CHANNEL,
        sourceTool: item.sourceTool ?? "subagent_announce",
      },
      idempotencyKey,
    },
    timeoutMs: announceTimeoutMs,
  });
}

export function loadRequesterSessionEntry(requesterSessionKey: string) {
  const cfg = subagentAnnounceDeliveryDeps.loadConfig();
  const canonicalKey = resolveRequesterStoreKey(cfg, requesterSessionKey);
  const agentId = resolveAgentIdFromSessionKey(canonicalKey);
  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  const store = loadSessionStore(storePath);
  const entry = store[canonicalKey];
  return { cfg, entry, canonicalKey };
}

export function loadSessionEntryByKey(sessionKey: string) {
  const cfg = subagentAnnounceDeliveryDeps.loadConfig();
  const agentId = resolveAgentIdFromSessionKey(sessionKey);
  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  const store = loadSessionStore(storePath);
  return store[sessionKey];
}

function buildAnnounceQueueKey(sessionKey: string, origin?: DeliveryContext): string {
  const accountId = normalizeAccountId(origin?.accountId);
  if (!accountId) {
    return sessionKey;
  }
  return `${sessionKey}:acct:${accountId}`;
}

async function maybeQueueSubagentAnnounce(params: {
  requesterSessionKey: string;
  announceId?: string;
  triggerMessage: string;
  steerMessage: string;
  summaryLine?: string;
  requesterOrigin?: DeliveryContext;
  sourceSessionKey?: string;
  sourceChannel?: string;
  sourceTool?: string;
  internalEvents?: AgentInternalEvent[];
  signal?: AbortSignal;
}): Promise<"steered" | "queued" | "none" | "dropped"> {
  if (params.signal?.aborted) {
    return "none";
  }
  const { cfg, entry } = loadRequesterSessionEntry(params.requesterSessionKey);
  const canonicalKey = resolveRequesterStoreKey(cfg, params.requesterSessionKey);
  const sessionId = entry?.sessionId;
  if (!sessionId) {
    return "none";
  }

  const queueSettings = resolveQueueSettings({
    cfg,
    channel: entry?.channel ?? entry?.lastChannel ?? entry?.origin?.provider,
    sessionEntry: entry,
  });
  const isActive = isEmbeddedPiRunActive(sessionId);

  const shouldSteer = queueSettings.mode === "steer" || queueSettings.mode === "steer-backlog";
  if (shouldSteer) {
    const steered = queueEmbeddedPiMessage(sessionId, params.steerMessage);
    if (steered) {
      return "steered";
    }
  }

  const shouldFollowup =
    queueSettings.mode === "followup" ||
    queueSettings.mode === "collect" ||
    queueSettings.mode === "steer-backlog" ||
    queueSettings.mode === "interrupt";
  if (isActive && (shouldFollowup || queueSettings.mode === "steer")) {
    const origin = resolveAnnounceOrigin(entry, params.requesterOrigin);
    const didQueue = enqueueAnnounce({
      key: buildAnnounceQueueKey(canonicalKey, origin),
      item: {
        announceId: params.announceId,
        prompt: params.triggerMessage,
        summaryLine: params.summaryLine,
        internalEvents: params.internalEvents,
        enqueuedAt: Date.now(),
        sessionKey: canonicalKey,
        origin,
        sourceSessionKey: params.sourceSessionKey,
        sourceChannel: params.sourceChannel,
        sourceTool: params.sourceTool,
      },
      settings: queueSettings,
      send: sendAnnounce,
    });
    return didQueue ? "queued" : "dropped";
  }

  return "none";
}

async function sendSubagentAnnounceDirectly(params: {
  targetRequesterSessionKey: string;
  triggerMessage: string;
  internalEvents?: AgentInternalEvent[];
  expectsCompletionMessage: boolean;
  bestEffortDeliver?: boolean;
  directIdempotencyKey: string;
  completionDirectOrigin?: DeliveryContext;
  directOrigin?: DeliveryContext;
  requesterSessionOrigin?: DeliveryContext;
  sourceSessionKey?: string;
  sourceChannel?: string;
  sourceTool?: string;
  requesterIsSubagent: boolean;
  signal?: AbortSignal;
}): Promise<SubagentAnnounceDeliveryResult> {
  if (params.signal?.aborted) {
    return {
      delivered: false,
      path: "none",
    };
  }
  const cfg = subagentAnnounceDeliveryDeps.loadConfig();
  const announceTimeoutMs = resolveSubagentAnnounceTimeoutMs(cfg);
  const canonicalRequesterSessionKey = resolveRequesterStoreKey(
    cfg,
    params.targetRequesterSessionKey,
  );
  try {
    const completionDirectOrigin = normalizeDeliveryContext(params.completionDirectOrigin);
    const directOrigin = normalizeDeliveryContext(params.directOrigin);
    const requesterSessionOrigin = normalizeDeliveryContext(params.requesterSessionOrigin);
    // Merge completionDirectOrigin with directOrigin so that missing fields
    // (channel, to, accountId) fall back to the originating session's
    // lastChannel / lastTo. Without this, a completion origin that carries a
    // channel but not a `to` would prevent external delivery.
    const effectiveDirectOrigin =
      params.expectsCompletionMessage && completionDirectOrigin
        ? mergeDeliveryContext(completionDirectOrigin, directOrigin)
        : directOrigin;
    const sessionOnlyOrigin = effectiveDirectOrigin?.channel
      ? effectiveDirectOrigin
      : requesterSessionOrigin;
    const deliveryTarget = !params.requesterIsSubagent
      ? resolveExternalBestEffortDeliveryTarget({
          channel: effectiveDirectOrigin?.channel,
          to: effectiveDirectOrigin?.to,
          accountId: effectiveDirectOrigin?.accountId,
          threadId: effectiveDirectOrigin?.threadId,
        })
      : { deliver: false };
    const normalizedSessionOnlyOriginChannel = !params.requesterIsSubagent
      ? normalizeMessageChannel(sessionOnlyOrigin?.channel)
      : undefined;
    const sessionOnlyOriginChannel =
      normalizedSessionOnlyOriginChannel &&
      isGatewayMessageChannel(normalizedSessionOnlyOriginChannel)
        ? normalizedSessionOnlyOriginChannel
        : undefined;
    if (params.signal?.aborted) {
      return {
        delivered: false,
        path: "none",
      };
    }
    const agentResult = await runAnnounceDeliveryWithRetry<unknown>({
      operation: params.expectsCompletionMessage
        ? "completion direct announce agent call"
        : "direct announce agent call",
      signal: params.signal,
      run: async () =>
        await subagentAnnounceDeliveryDeps.callGateway({
          method: "agent",
          params: {
            sessionKey: canonicalRequesterSessionKey,
            message: params.triggerMessage,
            deliver: deliveryTarget.deliver,
            bestEffortDeliver: params.bestEffortDeliver,
            internalEvents: params.internalEvents,
            channel: deliveryTarget.deliver ? deliveryTarget.channel : sessionOnlyOriginChannel,
            accountId: deliveryTarget.deliver
              ? deliveryTarget.accountId
              : sessionOnlyOriginChannel
                ? sessionOnlyOrigin?.accountId
                : undefined,
            to: deliveryTarget.deliver
              ? deliveryTarget.to
              : sessionOnlyOriginChannel
                ? sessionOnlyOrigin?.to
                : undefined,
            threadId: deliveryTarget.deliver
              ? deliveryTarget.threadId
              : sessionOnlyOriginChannel
                ? sessionOnlyOrigin?.threadId
                : undefined,
            inputProvenance: {
              kind: "inter_session",
              sourceSessionKey: params.sourceSessionKey,
              sourceChannel: params.sourceChannel ?? INTERNAL_MESSAGE_CHANNEL,
              sourceTool: params.sourceTool ?? "subagent_announce",
            },
            idempotencyKey: params.directIdempotencyKey,
          },
          expectFinal: true,
          timeoutMs: announceTimeoutMs,
        }),
    });

    // [frankclaw] The gateway call succeeded — the parent session received and
    // processed the completion message.  Whether the parent LLM chooses to
    // produce a user-facing reply is the parent's decision (it may have made
    // tool calls, processed internally, or deemed it informational).  Treating
    // "no user-facing reply" as a delivery failure caused futile retries that
    // re-fed the same completion into the parent, always with the same result,
    // until MAX_ANNOUNCE_RETRY_COUNT was hit and the announce was given up.
    //
    // But silently marking as delivered when the parent produces no reply means
    // Frank never hears about the subagent's result (2026-04-09 regression).
    // Fallback: if the parent produced no user-facing reply AND we have a valid
    // external delivery target, push the trigger message (which is the subagent
    // completion summary) directly to the external channel so Frank at least
    // sees something. The parent session's own idle decision is preserved.
    if (
      params.expectsCompletionMessage &&
      !params.requesterIsSubagent &&
      !hasDeliverableCompletionFinalResult(agentResult)
    ) {
      defaultRuntime.log(
        `[warn] Subagent completion announce for ${params.directIdempotencyKey}: completion update produced no user-facing reply (gateway call succeeded) — attempting direct fallback delivery`,
      );
      if (deliveryTarget.deliver && deliveryTarget.channel && deliveryTarget.to) {
        try {
          // [frankclaw] Real gateway method name is "send" (WRITE_SCOPE). The
          // previous "message.send" was a channel tool name from plugin
          // allowlists, not a JSON-RPC method — it fell through
          // authorizeOperatorScopesForMethod's default-deny path and got
          // ADMIN_SCOPE, which the subagent caller scopes don't have, so every
          // fallback delivery silently failed with "missing scope:
          // operator.admin". This meant Frank never saw any CC ACP subagent
          // progress updates while the workers were actually doing real work
          // (regression window: 2026-04-09 afternoon).
          // [frankclaw] Send a sanitized summary, not the raw internal
          // context block.  The previous code sent params.triggerMessage
          // which is the full <<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>> payload
          // — leaking session keys and raw child output to external channels
          // and downstream ACP sessions.
          const fallbackMessage = buildSanitizedFallbackMessage(
            params.triggerMessage,
            params.internalEvents,
          );
          await subagentAnnounceDeliveryDeps.callGateway({
            method: "send",
            params: {
              channel: deliveryTarget.channel,
              accountId: deliveryTarget.accountId,
              to: deliveryTarget.to,
              threadId: deliveryTarget.threadId,
              message: fallbackMessage,
              idempotencyKey: `${params.directIdempotencyKey}:fallback`,
            },
          });
          defaultRuntime.log(
            `[info] Subagent completion announce for ${params.directIdempotencyKey}: delivered via direct fallback to ${deliveryTarget.channel}:${deliveryTarget.to}`,
          );
        } catch (fallbackErr) {
          defaultRuntime.log(
            `[warn] Subagent completion announce for ${params.directIdempotencyKey}: direct fallback delivery also failed: ${summarizeDeliveryError(fallbackErr)} (treating as delivered to avoid retry loop)`,
          );
        }
      } else {
        defaultRuntime.log(
          `[warn] Subagent completion announce for ${params.directIdempotencyKey}: no external delivery target available for fallback (treating as delivered)`,
        );
      }
    }

    return {
      delivered: true,
      path: "direct",
    };
  } catch (err) {
    return {
      delivered: false,
      path: "direct",
      error: summarizeDeliveryError(err),
    };
  }
}

export async function deliverSubagentAnnouncement(params: {
  requesterSessionKey: string;
  announceId?: string;
  triggerMessage: string;
  steerMessage: string;
  internalEvents?: AgentInternalEvent[];
  summaryLine?: string;
  requesterSessionOrigin?: DeliveryContext;
  requesterOrigin?: DeliveryContext;
  completionDirectOrigin?: DeliveryContext;
  directOrigin?: DeliveryContext;
  sourceSessionKey?: string;
  sourceChannel?: string;
  sourceTool?: string;
  targetRequesterSessionKey: string;
  requesterIsSubagent: boolean;
  expectsCompletionMessage: boolean;
  bestEffortDeliver?: boolean;
  directIdempotencyKey: string;
  signal?: AbortSignal;
}): Promise<SubagentAnnounceDeliveryResult> {
  return await runSubagentAnnounceDispatch({
    expectsCompletionMessage: params.expectsCompletionMessage,
    signal: params.signal,
    queue: async () =>
      await maybeQueueSubagentAnnounce({
        requesterSessionKey: params.requesterSessionKey,
        announceId: params.announceId,
        triggerMessage: params.triggerMessage,
        steerMessage: params.steerMessage,
        summaryLine: params.summaryLine,
        requesterOrigin: params.requesterOrigin,
        sourceSessionKey: params.sourceSessionKey,
        sourceChannel: params.sourceChannel,
        sourceTool: params.sourceTool,
        internalEvents: params.internalEvents,
        signal: params.signal,
      }),
    direct: async () =>
      await sendSubagentAnnounceDirectly({
        targetRequesterSessionKey: params.targetRequesterSessionKey,
        triggerMessage: params.triggerMessage,
        internalEvents: params.internalEvents,
        directIdempotencyKey: params.directIdempotencyKey,
        completionDirectOrigin: params.completionDirectOrigin,
        directOrigin: params.directOrigin,
        requesterSessionOrigin: params.requesterSessionOrigin,
        sourceSessionKey: params.sourceSessionKey,
        sourceChannel: params.sourceChannel,
        sourceTool: params.sourceTool,
        requesterIsSubagent: params.requesterIsSubagent,
        expectsCompletionMessage: params.expectsCompletionMessage,
        signal: params.signal,
        bestEffortDeliver: params.bestEffortDeliver,
      }),
  });
}

export const __testing = {
  setDepsForTest(overrides?: Partial<SubagentAnnounceDeliveryDeps>) {
    subagentAnnounceDeliveryDeps = overrides
      ? {
          ...defaultSubagentAnnounceDeliveryDeps,
          ...overrides,
        }
      : defaultSubagentAnnounceDeliveryDeps;
  },
  buildSanitizedFallbackMessage,
  hasDeliverableCompletionFinalResult,
  sendSubagentAnnounceDirectly,
};
