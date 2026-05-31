import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk/channel-send-result";
import { chunkText } from "openclaw/plugin-sdk/reply-chunking";
import { shouldLogVerbose } from "openclaw/plugin-sdk/runtime-env";
import { enforceWhatsAppDnrWindow } from "../../../src/infra/outbound/discord-dnr.js";
import { createWhatsAppOutboundBase } from "./outbound-base.js";
import { normalizeWhatsAppPayloadText } from "./outbound-media-contract.js";
import { resolveWhatsAppOutboundTarget } from "./resolve-outbound-target.js";

type WhatsAppSendModule = typeof import("./send.js");

let whatsAppSendModulePromise: Promise<WhatsAppSendModule> | undefined;

function loadWhatsAppSendModule(): Promise<WhatsAppSendModule> {
  whatsAppSendModulePromise ??= import("./send.js");
  return whatsAppSendModulePromise;
}

function normalizeOutboundText(text: string | undefined): string {
  return normalizeWhatsAppPayloadText(text);
}

export const whatsappOutbound: ChannelOutboundAdapter = createWhatsAppOutboundBase({
  chunker: chunkText,
  sendMessageWhatsApp: async (to, text, options) => {
    // frankclaw: throws WhatsAppDnrSuppressedError when in DNR window; propagates
    // to deliver.ts which calls deferDelivery() so the queue entry is not lost.
    enforceWhatsAppDnrWindow(to);
    return await (
      await loadWhatsAppSendModule()
    ).sendMessageWhatsApp(to, normalizeOutboundText(text), {
      ...options,
    });
  },
  sendPollWhatsApp: async (to, poll, options) =>
    await (await loadWhatsAppSendModule()).sendPollWhatsApp(to, poll, options),
  shouldLogVerbose: () => shouldLogVerbose(),
  resolveTarget: ({ to, allowFrom, mode }) =>
    resolveWhatsAppOutboundTarget({ to, allowFrom, mode }),
  normalizeText: normalizeOutboundText,
  skipEmptyText: true,
});
