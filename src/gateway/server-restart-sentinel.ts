import { resolveSessionAgentId } from "../agents/agent-scope.js";
import { resolveAnnounceTargetFromKey } from "../agents/tools/sessions-send-helpers.js";
import { normalizeChannelId } from "../channels/plugins/index.js";
import type { CliDeps } from "../cli/deps.js";
import { resolveMainSessionKeyFromConfig } from "../config/sessions.js";
import { parseSessionThreadInfo } from "../config/sessions/delivery-info.js";
import { deliverOutboundPayloads } from "../infra/outbound/deliver.js";
import { resolveOutboundTarget } from "../infra/outbound/targets.js";
import {
  consumeRestartSentinel,
  formatRestartSentinelMessage,
  summarizeRestartSentinel,
} from "../infra/restart-sentinel.js";
import { enqueueScheduledAgent } from "../infra/scheduled-agent.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { deliveryContextFromSession, mergeDeliveryContext } from "../utils/delivery-context.js";
import { loadSessionEntry } from "./session-utils.js";

export async function scheduleRestartSentinelWake(_params: { deps: CliDeps }) {
  const sentinel = await consumeRestartSentinel();
  if (!sentinel) {
    return;
  }
  const payload = sentinel.payload;
  const sessionKey = payload.sessionKey?.trim();
  const message = formatRestartSentinelMessage(payload);
  const summary = summarizeRestartSentinel(payload);

  if (!sessionKey) {
    const mainSessionKey = resolveMainSessionKeyFromConfig();
    enqueueSystemEvent(message, { sessionKey: mainSessionKey });
    return;
  }

  // Resolve delivery context first so the queued agent turn can explicitly reply
  // to the same channel that triggered the restart. If nothing is known, default
  // to Discord #general (1474343755153932394).
  const { baseSessionKey, threadId: sessionThreadId } = parseSessionThreadInfo(sessionKey);

  const { cfg, entry } = loadSessionEntry(sessionKey);
  const parsedTarget = resolveAnnounceTargetFromKey(baseSessionKey ?? sessionKey);

  // Prefer delivery context from sentinel (captured at restart) over session store
  // Handles race condition where store wasn't flushed before restart
  const sentinelContext = payload.deliveryContext;
  let sessionDeliveryContext = deliveryContextFromSession(entry);
  if (!sessionDeliveryContext && baseSessionKey && baseSessionKey !== sessionKey) {
    const { entry: baseEntry } = loadSessionEntry(baseSessionKey);
    sessionDeliveryContext = deliveryContextFromSession(baseEntry);
  }

  const origin = mergeDeliveryContext(
    sentinelContext,
    mergeDeliveryContext(sessionDeliveryContext, parsedTarget ?? undefined),
  );

  const channelRaw = origin?.channel;
  const normalizedOriginChannel = channelRaw ? normalizeChannelId(channelRaw) : null;
  const defaultChannel = "discord";
  const defaultTo = "channel:1474343755153932394";

  const threadId =
    payload.threadId ??
    parsedTarget?.threadId ?? // From resolveAnnounceTargetFromKey (extracts :topic:N)
    sessionThreadId ??
    (origin?.threadId != null ? String(origin.threadId) : undefined);

  // Primary: enqueue a delayed agent turn (30s delay for channels to reconnect)
  try {
    const enqueueParams = {
      sessionKey,
      message,
      deliver: true,
      canReadBy: Date.now() + 30_000,
      group: "restart",
      replyChannel: normalizedOriginChannel ?? defaultChannel,
      replyTo: origin?.to ?? defaultTo,
      replyAccountId: origin?.accountId,
      threadId,
    };
    console.info(
      `[restart-sentinel] enqueuing scheduled agent wake:`,
      JSON.stringify(enqueueParams),
    );
    const result = await enqueueScheduledAgent(enqueueParams);
    console.info(`[restart-sentinel] enqueued OK: id=${result.id}`);
    return;
  } catch (err) {
    console.error(`[restart-sentinel] enqueue failed, falling back to legacy:`, err);
    // Fall through to legacy outbound delivery as fallback
  }

  // Legacy fallback: resolve delivery context and deliver static text
  const channel = normalizedOriginChannel ?? defaultChannel;
  const to = origin?.to ?? defaultTo;

  const resolved = resolveOutboundTarget({
    channel,
    to,
    cfg,
    accountId: origin?.accountId,
    mode: "implicit",
  });
  if (!resolved.ok) {
    enqueueSystemEvent(message, { sessionKey });
    return;
  }

  try {
    await deliverOutboundPayloads({
      cfg,
      channel,
      to: resolved.to,
      accountId: origin?.accountId,
      threadId,
      payloads: [{ text: message }],
      agentId: resolveSessionAgentId({ sessionKey, config: cfg }),
      bestEffort: true,
    });
  } catch (err) {
    enqueueSystemEvent(`${summary}\n${String(err)}`, { sessionKey });
  }
}

export function shouldWakeFromRestartSentinel() {
  return !process.env.VITEST && process.env.NODE_ENV !== "test";
}

const POST_RESTART_DELAY_MS = 30_000;
const POST_RESTART_MESSAGE = [
  "[System] Gateway restart completed successfully.",
  "If you were mid-task before the restart, continue where you left off.",
  "If all tasks were already complete, verify and briefly confirm to the user that everything is good.",
  "Check your recent conversation history for context on what you were doing.",
].join(" ");

/**
 * Enqueue a delayed agent wake on every gateway startup. This works regardless of
 * how the restart was triggered (CLI, systemd, crash, internal SIGUSR1).
 *
 * Uses `channel: "last"` so the gateway's agent handler resolves delivery context
 * at dispatch time (not enqueue time), using the most current session state.
 * This avoids stale/mixed channel+target combinations.
 */
export async function enqueuePostRestartWake(
  _params: { deps: CliDeps },
  _opts?: { _skipEnvCheck?: boolean },
) {
  if (!_opts?._skipEnvCheck && (process.env.VITEST || process.env.NODE_ENV === "test")) {
    return;
  }

  const mainSessionKey = resolveMainSessionKeyFromConfig();
  if (!mainSessionKey) {
    return;
  }

  const enqueueParams = {
    sessionKey: mainSessionKey,
    message: POST_RESTART_MESSAGE,
    deliver: true,
    canReadBy: Date.now() + POST_RESTART_DELAY_MS,
    group: "restart",
    // Use "last" so delivery resolves at dispatch time from the session's
    // current lastRoute, not from a potentially stale snapshot at enqueue time.
    replyChannel: "last",
  };

  console.info(
    `[post-restart-wake] enqueuing:`,
    JSON.stringify({
      sessionKey: enqueueParams.sessionKey,
      replyChannel: enqueueParams.replyChannel,
      canReadBy: new Date(enqueueParams.canReadBy).toISOString(),
    }),
  );

  const result = await enqueueScheduledAgent(enqueueParams);
  console.info(`[post-restart-wake] enqueued OK: id=${result.id}`);
}
