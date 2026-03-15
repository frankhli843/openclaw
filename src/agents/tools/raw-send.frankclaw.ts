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
        return jsonResult({ ok: false, error: errorMessage });
      }
    },
  } as unknown as AnyAgentTool;
}
