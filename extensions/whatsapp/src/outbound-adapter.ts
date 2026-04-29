import { type ChannelOutboundAdapter } from "openclaw/plugin-sdk/channel-send-result";
import { chunkText } from "openclaw/plugin-sdk/reply-chunking";
import { createSubsystemLogger, shouldLogVerbose } from "openclaw/plugin-sdk/runtime-env";
import {
  enforceWhatsAppDnrWindow,
  WhatsAppDnrSuppressedError,
} from "../../../src/infra/outbound/discord-dnr.js";
import { createWhatsAppOutboundBase } from "./outbound-base.js";
import { normalizeWhatsAppPayloadText } from "./outbound-media-contract.js";
import { resolveWhatsAppOutboundTarget } from "./resolve-outbound-target.js";

const dnrLog = createSubsystemLogger("whatsapp-dnr");

type WhatsAppSendModule = typeof import("./send.js");

let whatsAppSendModulePromise: Promise<WhatsAppSendModule> | undefined;

function loadWhatsAppSendModule(): Promise<WhatsAppSendModule> {
  whatsAppSendModulePromise ??= import("./send.js");
  return whatsAppSendModulePromise;
}

function normalizeOutboundText(text: string | undefined): string {
  return normalizeWhatsAppPayloadText(text);
}

// frankclaw: enforce WhatsApp DNR quiet hours before sending
function enforceWhatsAppDnr(to: string): boolean {
  try {
    enforceWhatsAppDnrWindow(to);
  } catch (err) {
    if (err instanceof WhatsAppDnrSuppressedError) {
      dnrLog.info(
        `WhatsApp DNR: suppressed message to ${to} (quiet until ${new Date(err.nextEligibleAtMs).toISOString()})`,
      );
      return true;
    }
    throw err;
  }
  return false;
}

export const whatsappOutbound: ChannelOutboundAdapter = createWhatsAppOutboundBase({
  chunker: chunkText,
  sendMessageWhatsApp: async (to, text, options) => {
    if (enforceWhatsAppDnr(to)) {
      return { messageId: "", toJid: "" };
    }
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
