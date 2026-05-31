import {
  normalizeAtHashSlug,
  normalizeHyphenSlug,
} from "@openclaw/normalization-core/string-normalization";
import { inspectSlackAccount } from "../../../extensions/slack/src/account-inspect.js";
import type { OpenClawConfig } from "../../config/config.js";
import {
  resolveChannelGroupGateMode,
  resolveChannelGroupRequireMention,
  resolveChannelGroupToolsPolicy,
  resolveToolsBySender,
  type ChannelGroupGateModeResult,
} from "../../config/group-policy.js";
import type { GateMode } from "../../config/types.base.js";
import type { DiscordConfig } from "../../config/types.js";
import type {
  GroupToolPolicyBySenderConfig,
  GroupToolPolicyConfig,
} from "../../config/types.tools.js";
import type { ChannelGroupContext } from "./types.js";

type GroupMentionParams = ChannelGroupContext;

function normalizeDiscordSlug(value?: string | null) {
  return normalizeAtHashSlug(value);
}

function parseTelegramGroupId(value?: string | null) {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return { chatId: undefined, topicId: undefined };
  }
  const parts = raw.split(":").filter(Boolean);
  if (
    parts.length >= 3 &&
    parts[1] === "topic" &&
    /^-?\d+$/.test(parts[0]) &&
    /^\d+$/.test(parts[2])
  ) {
    return { chatId: parts[0], topicId: parts[2] };
  }
  if (parts.length >= 2 && /^-?\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    return { chatId: parts[0], topicId: parts[1] };
  }
  return { chatId: raw, topicId: undefined };
}

function resolveTelegramRequireMention(params: {
  cfg: OpenClawConfig;
  chatId?: string;
  topicId?: string;
}): boolean | undefined {
  const { cfg, chatId, topicId } = params;
  if (!chatId) {
    return undefined;
  }
  const groupConfig = cfg.channels?.telegram?.groups?.[chatId];
  const groupDefault = cfg.channels?.telegram?.groups?.["*"];
  const topicConfig = topicId && groupConfig?.topics ? groupConfig.topics[topicId] : undefined;
  const defaultTopicConfig =
    topicId && groupDefault?.topics ? groupDefault.topics[topicId] : undefined;
  if (typeof topicConfig?.requireMention === "boolean") {
    return topicConfig.requireMention;
  }
  if (typeof defaultTopicConfig?.requireMention === "boolean") {
    return defaultTopicConfig.requireMention;
  }
  if (typeof groupConfig?.requireMention === "boolean") {
    return groupConfig.requireMention;
  }
  if (typeof groupDefault?.requireMention === "boolean") {
    return groupDefault.requireMention;
  }
  return undefined;
}

function resolveTelegramGateModeInternal(params: {
  cfg: OpenClawConfig;
  chatId?: string;
  topicId?: string;
}): ChannelGroupGateModeResult {
  const { cfg, chatId, topicId } = params;
  if (!chatId) {
    return { gateMode: undefined, allowedSenders: [] };
  }
  const groupConfig = cfg.channels?.telegram?.groups?.[chatId];
  const groupDefault = cfg.channels?.telegram?.groups?.["*"];
  const topicConfig = topicId && groupConfig?.topics ? groupConfig.topics[topicId] : undefined;
  const defaultTopicConfig =
    topicId && groupDefault?.topics ? groupDefault.topics[topicId] : undefined;
  // Topic config takes priority, then group config, then wildcard
  const resolved = topicConfig ?? defaultTopicConfig ?? groupConfig ?? groupDefault;
  const gateMode = resolved?.gateMode;
  const rawSenders = resolved?.allowFrom ?? [];
  return { gateMode, allowedSenders: rawSenders.map((s) => String(s)) };
}

function resolveDiscordGuildEntry(guilds: DiscordConfig["guilds"], groupSpace?: string | null) {
  if (!guilds || Object.keys(guilds).length === 0) {
    return null;
  }
  const space = groupSpace?.trim() ?? "";
  if (space && guilds[space]) {
    return guilds[space];
  }
  const normalized = normalizeDiscordSlug(space);
  if (normalized && guilds[normalized]) {
    return guilds[normalized];
  }
  if (normalized) {
    const match = Object.values(guilds).find(
      (entry) => normalizeDiscordSlug(entry?.slug ?? undefined) === normalized,
    );
    if (match) {
      return match;
    }
  }
  return guilds["*"] ?? null;
}

function resolveDiscordChannelEntry<TEntry>(
  channelEntries: Record<string, TEntry> | undefined,
  params: { groupId?: string | null; groupChannel?: string | null },
): TEntry | undefined {
  if (!channelEntries || Object.keys(channelEntries).length === 0) {
    return undefined;
  }
  const groupChannel = params.groupChannel;
  const channelSlug = normalizeDiscordSlug(groupChannel);
  return (
    (params.groupId ? channelEntries[params.groupId] : undefined) ??
    (channelSlug
      ? (channelEntries[channelSlug] ?? channelEntries[`#${channelSlug}`])
      : undefined) ??
    (groupChannel ? channelEntries[normalizeDiscordSlug(groupChannel)] : undefined)
  );
}

type SlackChannelPolicyEntry = {
  requireMention?: boolean;
  gateMode?: GateMode;
  allowFrom?: Array<string | number>;
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig;
};

type SenderScopedToolsEntry = {
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig;
};

type ChannelGroupPolicyChannel =
  | "telegram"
  | "whatsapp"
  | "imessage"
  | "googlechat"
  | "bluebubbles"
  | "line";

function resolveSlackChannelPolicyEntry(
  params: GroupMentionParams,
): SlackChannelPolicyEntry | undefined {
  const account = inspectSlackAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  const channels = (account.channels ?? {}) as Record<string, SlackChannelPolicyEntry>;
  if (Object.keys(channels).length === 0) {
    return undefined;
  }
  const channelId = params.groupId?.trim();
  const groupChannel = params.groupChannel;
  const channelName = groupChannel?.replace(/^#/, "");
  const normalizedName = normalizeHyphenSlug(channelName);
  const candidates = [
    channelId ?? "",
    channelName ? `#${channelName}` : "",
    channelName ?? "",
    normalizedName,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate && channels[candidate]) {
      return channels[candidate];
    }
  }
  return channels["*"];
}

function resolveChannelRequireMention(
  params: GroupMentionParams,
  channel: ChannelGroupPolicyChannel,
  groupId: string | null | undefined = params.groupId,
): boolean {
  return resolveChannelGroupRequireMention({
    cfg: params.cfg,
    channel,
    groupId,
    accountId: params.accountId,
  });
}

function resolveChannelToolPolicyForSender(
  params: GroupMentionParams,
  channel: ChannelGroupPolicyChannel,
  groupId: string | null | undefined = params.groupId,
): GroupToolPolicyConfig | undefined {
  return resolveChannelGroupToolsPolicy({
    cfg: params.cfg,
    channel,
    groupId,
    accountId: params.accountId,
    senderId: params.senderId,
    senderName: params.senderName,
    senderUsername: params.senderUsername,
    senderE164: params.senderE164,
  });
}

function resolveSenderToolsEntry(
  entry: SenderScopedToolsEntry | undefined | null,
  params: GroupMentionParams,
): GroupToolPolicyConfig | undefined {
  if (!entry) {
    return undefined;
  }
  const senderPolicy = resolveToolsBySender({
    toolsBySender: entry.toolsBySender,
    senderId: params.senderId,
    senderName: params.senderName,
    senderUsername: params.senderUsername,
    senderE164: params.senderE164,
  });
  if (senderPolicy) {
    return senderPolicy;
  }
  return entry.tools;
}

function resolveDiscordPolicyContext(params: GroupMentionParams) {
  const guildEntry = resolveDiscordGuildEntry(
    params.cfg.channels?.discord?.guilds,
    params.groupSpace,
  );
  const channelEntries = guildEntry?.channels;
  const channelEntry =
    channelEntries && Object.keys(channelEntries).length > 0
      ? resolveDiscordChannelEntry(channelEntries, params)
      : undefined;
  return { guildEntry, channelEntry };
}

export function resolveTelegramGroupRequireMention(
  params: GroupMentionParams,
): boolean | undefined {
  const { chatId, topicId } = parseTelegramGroupId(params.groupId);
  const requireMention = resolveTelegramRequireMention({
    cfg: params.cfg,
    chatId,
    topicId,
  });
  if (typeof requireMention === "boolean") {
    return requireMention;
  }
  return resolveChannelGroupRequireMention({
    cfg: params.cfg,
    channel: "telegram",
    groupId: chatId ?? params.groupId,
    accountId: params.accountId,
  });
}

export function resolveWhatsAppGroupRequireMention(params: GroupMentionParams): boolean {
  return resolveChannelRequireMention(params, "whatsapp");
}

export function resolveIMessageGroupRequireMention(params: GroupMentionParams): boolean {
  return resolveChannelRequireMention(params, "imessage");
}

export function resolveDiscordGroupRequireMention(params: GroupMentionParams): boolean {
  const context = resolveDiscordPolicyContext(params);
  if (typeof context.channelEntry?.requireMention === "boolean") {
    return context.channelEntry.requireMention;
  }
  if (typeof context.guildEntry?.requireMention === "boolean") {
    return context.guildEntry.requireMention;
  }
  return true;
}

export function resolveGoogleChatGroupRequireMention(params: GroupMentionParams): boolean {
  return resolveChannelRequireMention(params, "googlechat");
}

export function resolveGoogleChatGroupToolPolicy(
  params: GroupMentionParams,
): GroupToolPolicyConfig | undefined {
  return resolveChannelToolPolicyForSender(params, "googlechat");
}

export function resolveSlackGroupRequireMention(params: GroupMentionParams): boolean {
  const resolved = resolveSlackChannelPolicyEntry(params);
  if (typeof resolved?.requireMention === "boolean") {
    return resolved.requireMention;
  }
  return true;
}

export function resolveBlueBubblesGroupRequireMention(params: GroupMentionParams): boolean {
  return resolveChannelRequireMention(params, "bluebubbles");
}

export function resolveTelegramGroupToolPolicy(
  params: GroupMentionParams,
): GroupToolPolicyConfig | undefined {
  const { chatId } = parseTelegramGroupId(params.groupId);
  return resolveChannelToolPolicyForSender(params, "telegram", chatId ?? params.groupId);
}

export function resolveWhatsAppGroupToolPolicy(
  params: GroupMentionParams,
): GroupToolPolicyConfig | undefined {
  return resolveChannelToolPolicyForSender(params, "whatsapp");
}

export function resolveIMessageGroupToolPolicy(
  params: GroupMentionParams,
): GroupToolPolicyConfig | undefined {
  return resolveChannelToolPolicyForSender(params, "imessage");
}

export function resolveDiscordGroupToolPolicy(
  params: GroupMentionParams,
): GroupToolPolicyConfig | undefined {
  const context = resolveDiscordPolicyContext(params);
  const channelPolicy = resolveSenderToolsEntry(context.channelEntry, params);
  if (channelPolicy) {
    return channelPolicy;
  }
  return resolveSenderToolsEntry(context.guildEntry, params);
}

export function resolveSlackGroupToolPolicy(
  params: GroupMentionParams,
): GroupToolPolicyConfig | undefined {
  const resolved = resolveSlackChannelPolicyEntry(params);
  return resolveSenderToolsEntry(resolved, params);
}

export function resolveBlueBubblesGroupToolPolicy(
  params: GroupMentionParams,
): GroupToolPolicyConfig | undefined {
  return resolveChannelToolPolicyForSender(params, "bluebubbles");
}

// ---- LINE group resolvers ----

/**
 * Expand a LINE groupId into candidate config keys.
 * A bare id like "r123" also matches "group:r123" and "room:r123".
 * A prefixed id like "room:r123" also matches the bare "r123".
 */
function resolveLineGroupLookupIds(groupId?: string | null): string[] {
  const normalized = groupId?.trim();
  if (!normalized) {
    return [];
  }
  if (normalized.startsWith("group:") || normalized.startsWith("room:")) {
    const rawId = normalized.split(":").slice(1).join(":");
    return rawId ? [rawId, normalized] : [normalized];
  }
  return [normalized, `group:${normalized}`, `room:${normalized}`];
}

function resolveLineGroupsConfig(
  cfg: OpenClawConfig,
  accountId?: string | null,
):
  | Record<
      string,
      | {
          requireMention?: boolean;
          tools?: GroupToolPolicyConfig;
          toolsBySender?: GroupToolPolicyBySenderConfig;
        }
      | undefined
    >
  | undefined {
  const lineConfig = cfg.channels?.line as
    | {
        groups?: Record<string, unknown>;
        accounts?: Record<string, { groups?: Record<string, unknown> }>;
      }
    | undefined;
  if (!lineConfig) {
    return undefined;
  }
  const normalizedAccountId = accountId?.trim() || undefined;
  const accountGroups = normalizedAccountId
    ? lineConfig.accounts?.[normalizedAccountId]?.groups
    : undefined;
  // oxlint-disable-next-line typescript/no-explicit-any
  return (accountGroups ?? lineConfig.groups) as any;
}

function resolveLineGroupEntry(
  cfg: OpenClawConfig,
  groupId?: string | null,
  accountId?: string | null,
) {
  const groups = resolveLineGroupsConfig(cfg, accountId);
  if (!groups) {
    return undefined;
  }
  for (const candidate of resolveLineGroupLookupIds(groupId)) {
    const hit = groups[candidate];
    if (hit) {
      return hit;
    }
  }
  return groups["*"];
}

export function resolveLineGroupRequireMention(params: GroupMentionParams): boolean {
  const entry = resolveLineGroupEntry(params.cfg, params.groupId, params.accountId);
  if (typeof entry?.requireMention === "boolean") {
    return entry.requireMention;
  }
  return true;
}

export function resolveLineGroupToolPolicy(
  params: GroupMentionParams,
): GroupToolPolicyConfig | undefined {
  const entry = resolveLineGroupEntry(params.cfg, params.groupId, params.accountId);
  if (!entry) {
    return undefined;
  }
  return resolveSenderToolsEntry(entry, params);
}

// ---- GateMode resolvers ----

export function resolveTelegramGroupGateMode(
  params: GroupMentionParams,
): ChannelGroupGateModeResult {
  const { chatId, topicId } = parseTelegramGroupId(params.groupId);
  return resolveTelegramGateModeInternal({
    cfg: params.cfg,
    chatId,
    topicId,
  });
}

export function resolveWhatsAppGroupGateMode(
  params: GroupMentionParams,
): ChannelGroupGateModeResult {
  return resolveChannelGroupGateMode({
    cfg: params.cfg,
    channel: "whatsapp",
    groupId: params.groupId,
    accountId: params.accountId,
  });
}

export function resolveIMessageGroupGateMode(
  params: GroupMentionParams,
): ChannelGroupGateModeResult {
  return resolveChannelGroupGateMode({
    cfg: params.cfg,
    channel: "imessage",
    groupId: params.groupId,
    accountId: params.accountId,
  });
}

export function resolveDiscordGroupGateMode(
  params: GroupMentionParams,
): ChannelGroupGateModeResult {
  const guildEntry = resolveDiscordGuildEntry(
    params.cfg.channels?.discord?.guilds,
    params.groupSpace,
  );
  const channelEntries = guildEntry?.channels;
  if (channelEntries && Object.keys(channelEntries).length > 0) {
    const entry = resolveDiscordChannelEntry(channelEntries, params);
    if (entry?.gateMode) {
      const rawSenders = (entry.allowFrom ?? []).map((s) => String(s));
      return { gateMode: entry.gateMode, allowedSenders: rawSenders };
    }
  }
  if (guildEntry?.gateMode) {
    const rawSenders = (guildEntry.allowFrom ?? []).map((s) => String(s));
    return { gateMode: guildEntry.gateMode, allowedSenders: rawSenders };
  }
  return { gateMode: undefined, allowedSenders: [] };
}

export function resolveGoogleChatGroupGateMode(
  params: GroupMentionParams,
): ChannelGroupGateModeResult {
  return resolveChannelGroupGateMode({
    cfg: params.cfg,
    channel: "googlechat",
    groupId: params.groupId,
    accountId: params.accountId,
  });
}

export function resolveSlackGroupGateMode(params: GroupMentionParams): ChannelGroupGateModeResult {
  const resolved = resolveSlackChannelPolicyEntry(params);
  const gateMode = resolved?.gateMode;
  const rawSenders = resolved?.allowFrom ?? [];
  return { gateMode, allowedSenders: rawSenders.map((s) => String(s)) };
}

export function resolveBlueBubblesGroupGateMode(
  params: GroupMentionParams,
): ChannelGroupGateModeResult {
  return resolveChannelGroupGateMode({
    cfg: params.cfg,
    channel: "bluebubbles",
    groupId: params.groupId,
    accountId: params.accountId,
  });
}
