/**
 * raw-send.frankclaw.ts
 *
 * Frankclaw-specific tool: sends a raw message to any channel without
 * going through a target session's agent. Bypasses the sessions_send
 * A2A flow entirely.
 *
 * Use case: when the main session needs to send a message to a WhatsApp
 * group, Discord channel, or Telegram chat without the target session's
 * agent deciding to NO_REPLY or modifying the message.
 */

import type { OpenClawConfig } from "../../config/config.js";
import { runMessageAction, getToolResult } from "../../infra/outbound/message-action-runner.js";
import { type AnyAgentTool, jsonResult } from "./common.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createRawSendTool(options: {
  cfg?: OpenClawConfig;
  agentSessionKey?: string;
  gateway?: unknown;
}) {
  return {
    name: "raw_send",
    description:
      "Send a raw message directly to a channel (WhatsApp, Discord, Telegram) without going through the target session's agent. " +
      "Use this when sessions_send keeps getting NO_REPLY or when you need to guarantee delivery of a specific message. " +
      "Parameters: channel (whatsapp|discord|telegram), target (group JID, channel ID, or chat ID), message (text to send).",
    parameters: {
      type: "object" as const,
      properties: {
        channel: {
          type: "string" as const,
          description: "Channel: whatsapp, discord, or telegram",
        },
        target: {
          type: "string" as const,
          description: "Target: WhatsApp group JID, Discord channel ID, or Telegram chat ID",
        },
        message: {
          type: "string" as const,
          description: "Message text to send",
        },
      },
      required: ["channel", "target", "message"],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const channel = String(params.channel ?? "");
      const target = String(params.target ?? "");
      const message = String(params.message ?? "");

      if (!channel || !target || !message) {
        return jsonResult({ error: "channel, target, and message are all required" });
      }

      // Retry with backoff for transient "No active WhatsApp Web listener" errors.
      // The WhatsApp Baileys connection cycles through disconnect/reconnect (408 timeouts)
      // and the listener is briefly null during those transitions.
      // No retries — the "No active WhatsApp Web listener" error can be a
      // false negative from the RPC layer while Baileys actually delivers.
      // Retrying causes duplicate messages. (Learned Mar 16 2026)
      const maxAttempts = 1;
      const retryDelays: number[] = [];

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const result = await runMessageAction({
            cfg: options.cfg as OpenClawConfig,
            action: "send",
            params: {
              channel,
              to: target,
              message,
            },
            sessionKey: options.agentSessionKey,
          });

          const toolResult = getToolResult(result);
          if (toolResult) {
            return toolResult;
          }
          return jsonResult({ ok: true, channel, target, delivered: true });
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          const isTransientWaError =
            channel === "whatsapp" && errorMessage.includes("No active WhatsApp Web listener");

          if (isTransientWaError && attempt < maxAttempts) {
            const delay = retryDelays[attempt - 1] ?? 5000;
            await sleep(delay);
            continue;
          }
          return jsonResult({ ok: false, error: errorMessage, attempts: attempt });
        }
      }
      return jsonResult({ ok: false, error: "unreachable" });
    },
  } as unknown as AnyAgentTool;
}
