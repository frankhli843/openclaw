/**
 * [frankclaw] Patch channel config schemas to allow custom properties
 * (gateMode, requireMention, autoThread, autoThreadName, autoArchiveDuration, allow)
 * that frankclaw adds to WhatsApp groups, Discord guilds/channels, and Telegram groups.
 *
 * Upstream schemas use additionalProperties: false, which rejects our custom props.
 * This patch walks each schema tree and sets additionalProperties: true on object nodes.
 */
import type { ChannelConfigSchema } from "../channels/plugins/types.plugin.js";

export function relaxAdditionalProperties(node: unknown): void {
  if (!node || typeof node !== "object") {
    return;
  }
  const obj = node as Record<string, unknown>;
  if (obj.type === "object" && obj.additionalProperties === false) {
    obj.additionalProperties = true;
  }
  // Recurse into properties
  if (obj.properties && typeof obj.properties === "object") {
    for (const val of Object.values(obj.properties as Record<string, unknown>)) {
      relaxAdditionalProperties(val);
    }
  }
  // Recurse into additionalProperties if it's a schema
  if (obj.additionalProperties && typeof obj.additionalProperties === "object") {
    relaxAdditionalProperties(obj.additionalProperties);
  }
  // Recurse into patternProperties
  if (obj.patternProperties && typeof obj.patternProperties === "object") {
    for (const val of Object.values(obj.patternProperties as Record<string, unknown>)) {
      relaxAdditionalProperties(val);
    }
  }
  // Recurse into items (arrays)
  if (obj.items) {
    relaxAdditionalProperties(obj.items);
  }
  // Recurse into allOf/anyOf/oneOf
  for (const combiner of ["allOf", "anyOf", "oneOf"] as const) {
    if (Array.isArray(obj[combiner])) {
      for (const item of obj[combiner] as unknown[]) {
        relaxAdditionalProperties(item);
      }
    }
  }
}

/**
 * Patch a channel config schema map to allow additional properties.
 * Called after the upstream schemas are built.
 */
export function patchChannelConfigSchemasForFrankclaw(
  schemaMap: ReadonlyMap<string, ChannelConfigSchema>,
): void {
  // Only patch channels we use custom properties on
  const channelsToRelax = ["whatsapp", "discord", "telegram"];
  for (const channelId of channelsToRelax) {
    const schema = schemaMap.get(channelId);
    if (schema?.schema) {
      relaxAdditionalProperties(schema.schema);
    }
  }
}

/**
 * Patch a raw schema record (from plugin registry channelConfigs) to allow additional properties.
 * Used by the validation flow which reads schemas from registry metadata, not from getBundledChannelConfigSchemaMap().
 */
export function relaxChannelSchemaFromRegistry(schema: Record<string, unknown> | undefined): void {
  if (schema) {
    relaxAdditionalProperties(schema);
  }
}
