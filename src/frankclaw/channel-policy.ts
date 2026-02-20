/**
 * [frankclaw] Channel Policy Gate
 *
 * Controls which channels/chats the agent is allowed to respond to.
 * Unknown channels are blocked by default and a notification is sent
 * to the configured control channel for the owner to approve/block.
 */

import fs from "node:fs";
import path from "node:path";
import { defaultRuntime } from "../runtime.js";

export interface ChannelEntry {
  name?: string;
  policy: "allow" | "block" | "mention-only" | "view-only";
  /** Optional note about why this policy was set */
  note?: string;
  /** ISO timestamp of when this entry was added */
  addedAt?: string;
}

export interface ChannelPolicyConfig {
  /** Default policy for unknown channels. Default: "ask" */
  defaultPolicy: "ask" | "block";
  /** Channel to send notifications about unknown channels */
  notifyChannel?: string;
  /** WhatsApp group/chat ID for notifications */
  notifyTo?: string;
  /** Known channels and their policies */
  channels: Record<string, ChannelEntry>;
}

const DEFAULT_CONFIG: ChannelPolicyConfig = {
  defaultPolicy: "ask",
  channels: {},
};

let cachedConfig: ChannelPolicyConfig | null = null;
let cachedConfigMtime: number = 0;

function getConfigPath(): string {
  const workspace = process.env.OPENCLAW_WORKSPACE ?? process.env.HOME + "/.openclaw/workspace";
  return path.join(workspace, "channel-policy.json");
}

export function loadChannelPolicy(): ChannelPolicyConfig {
  const configPath = getConfigPath();
  try {
    const stat = fs.statSync(configPath);
    if (cachedConfig && stat.mtimeMs === cachedConfigMtime) {
      return cachedConfig;
    }
    const raw = fs.readFileSync(configPath, "utf-8");
    cachedConfig = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    cachedConfigMtime = stat.mtimeMs;
    return cachedConfig!;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveChannelPolicy(config: ChannelPolicyConfig): void {
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  cachedConfig = config;
  cachedConfigMtime = Date.now();
}

/**
 * Build a canonical channel key from surface/provider + chat ID.
 * Examples: "whatsapp:120363405743307729@g.us", "telegram:7918451151"
 */
export function buildChannelKey(surface: string, chatId: string): string {
  return `${surface.toLowerCase()}:${chatId}`;
}

export type PolicyDecision =
  | { action: "allow" }
  | { action: "mention-only" }
  | { action: "view-only" }
  | { action: "block"; reason: string }
  | { action: "ask"; channelKey: string };

/**
 * Check whether a message from the given channel should be processed.
 */
export function checkChannelPolicy(
  surface: string,
  chatId: string,
  wasMentioned?: boolean,
  options?: { aliases?: string[] },
): PolicyDecision {
  const config = loadChannelPolicy();
  const channelKey = buildChannelKey(surface, chatId);
  const aliasKeys = (options?.aliases ?? []).map((entry) => String(entry).trim()).filter(Boolean);
  const lookupOrder = [channelKey, ...aliasKeys];

  const matchedKey = lookupOrder.find((key) => Boolean(config.channels[key]));
  const entry = matchedKey ? config.channels[matchedKey] : undefined;
  if (entry) {
    switch (entry.policy) {
      case "allow":
        return { action: "allow" };
      case "block":
        return {
          action: "block",
          reason: `Channel explicitly blocked: ${matchedKey ?? channelKey}`,
        };
      case "mention-only":
        if (wasMentioned) {
          return { action: "allow" };
        }
        return { action: "mention-only" };
      case "view-only":
        return { action: "view-only" };
    }
  }

  // Unknown channel
  if (config.defaultPolicy === "block") {
    return { action: "block", reason: `Unknown channel blocked by default: ${channelKey}` };
  }

  return { action: "ask", channelKey };
}

/**
 * Add a new channel entry to the policy config.
 */
export function addChannelPolicy(
  channelKey: string,
  policy: "allow" | "block" | "mention-only" | "view-only",
  name?: string,
  note?: string,
): void {
  const config = loadChannelPolicy();
  config.channels[channelKey] = {
    name,
    policy,
    note,
    addedAt: new Date().toISOString(),
  };
  saveChannelPolicy(config);
  defaultRuntime.log(`[frankclaw] Channel policy updated: ${channelKey} → ${policy}`);
}

/**
 * Track that we've already notified about an unknown channel to avoid spamming.
 */
const pendingNotifications = new Set<string>();

export function hasPendingNotification(channelKey: string): boolean {
  return pendingNotifications.has(channelKey);
}

export function markNotified(channelKey: string): void {
  pendingNotifications.add(channelKey);
}

export function clearNotified(channelKey: string): void {
  pendingNotifications.delete(channelKey);
}
