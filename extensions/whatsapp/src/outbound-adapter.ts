import {
  type ChannelOutboundAdapter,
  createAttachedChannelResultAdapter,
  createEmptyChannelResult,
} from "openclaw/plugin-sdk/channel-send-result";
import { resolveOutboundSendDep } from "openclaw/plugin-sdk/outbound-runtime";
import {
  resolveSendableOutboundReplyParts,
  sendTextMediaPayload,
} from "openclaw/plugin-sdk/reply-payload";
import { chunkText } from "openclaw/plugin-sdk/reply-runtime";
import { shouldLogVerbose } from "openclaw/plugin-sdk/runtime-env";
import { createSubsystemLogger } from "openclaw/plugin-sdk/runtime-env";
import {
  enforceWhatsAppDnrWindow,
  WhatsAppDnrSuppressedError,
} from "../../../src/infra/outbound/discord-dnr.js";
import { resolveWhatsAppOutboundTarget } from "./runtime-api.js";
import { sendMessageWhatsApp, sendPollWhatsApp } from "./send.js";

const dnrLog = createSubsystemLogger("whatsapp-dnr");

function trimLeadingWhitespace(text: string | undefined): string {
  return text?.trimStart() ?? "";
}

export const whatsappOutbound: ChannelOutboundAdapter = {
  deliveryMode: "gateway",
  chunker: chunkText,
  chunkerMode: "text",
  textChunkLimit: 4000,
  pollMaxOptions: 12,
  resolveTarget: ({ to, allowFrom, mode }) =>
    resolveWhatsAppOutboundTarget({ to, allowFrom, mode }),
  sendPayload: async (ctx) => {
    const text = trimLeadingWhitespace(ctx.payload.text);
    const hasMedia = resolveSendableOutboundReplyParts(ctx.payload).hasMedia;
    if (!text && !hasMedia) {
      return createEmptyChannelResult("whatsapp");
    }
    // Enforce WhatsApp DNR quiet hours (frankclaw extension)
    try {
      enforceWhatsAppDnrWindow(ctx.to);
    } catch (err) {
      if (err instanceof WhatsAppDnrSuppressedError) {
        dnrLog.info(
          `WhatsApp DNR: suppressed message to ${ctx.to} (quiet until ${new Date(err.nextEligibleAtMs).toISOString()})`,
        );
        return createEmptyChannelResult("whatsapp");
      }
      throw err;
    }
    return await sendTextMediaPayload({
      channel: "whatsapp",
      ctx: {
        ...ctx,
        payload: {
          ...ctx.payload,
          text,
        },
      },
      adapter: whatsappOutbound,
    });
  },
  ...createAttachedChannelResultAdapter({
    channel: "whatsapp",
    sendText: async ({ cfg, to, text, accountId, deps, gifPlayback }) => {
      const normalizedText = trimLeadingWhitespace(text);
      if (!normalizedText) {
        return createEmptyChannelResult("whatsapp");
      }
      const send =
        resolveOutboundSendDep<typeof import("./send.js").sendMessageWhatsApp>(deps, "whatsapp") ??
        (await import("./send.js")).sendMessageWhatsApp;
      return await send(to, normalizedText, {
        verbose: false,
        cfg,
        accountId: accountId ?? undefined,
        gifPlayback,
      });
    },
    sendMedia: async ({
      cfg,
      to,
      text,
      mediaUrl,
      mediaLocalRoots,
      accountId,
      deps,
      gifPlayback,
    }) => {
      const normalizedText = trimLeadingWhitespace(text);
      const send =
        resolveOutboundSendDep<typeof import("./send.js").sendMessageWhatsApp>(deps, "whatsapp") ??
        (await import("./send.js")).sendMessageWhatsApp;
      return await send(to, normalizedText, {
        verbose: false,
        cfg,
        mediaUrl,
        mediaLocalRoots,
        accountId: accountId ?? undefined,
        gifPlayback,
      });
    },
    sendPoll: async ({ cfg, to, poll, accountId }) =>
      await sendPollWhatsApp(to, poll, {
        verbose: shouldLogVerbose(),
        accountId: accountId ?? undefined,
        cfg,
      }),
  }),
};
