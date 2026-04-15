/**
 * commands.frankclaw.ts
 *
 * frankclaw addition: support instant guild-scoped slash command deployment.
 *
 * Carbon supports `devGuilds` to deploy all non-entry-point commands to a guild
 * for immediate availability (Discord global commands can take minutes).
 */

import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";

export function resolveDiscordDevGuildsFromSlashCommandConfig(raw: unknown): string[] | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const devGuildsRaw = (raw as { devGuilds?: unknown }).devGuilds;
  if (!Array.isArray(devGuildsRaw)) {
    return undefined;
  }
  const guildIds = devGuildsRaw
    .map((entry) => normalizeOptionalString(String(entry)))
    .filter((value): value is string => Boolean(value));
  if (guildIds.length === 0) {
    return undefined;
  }
  return [...new Set(guildIds)];
}
