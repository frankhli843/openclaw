/**
 * embedded-agent-messaging.frankclaw.ts
 *
 * frankclaw: extends upstream messaging tool identification to include raw_send.
 *
 * raw_send bypasses the message tool's plugin routing but is still an outbound
 * delivery. Without this, the cron orchestration loop sees !didSendViaMessagingTool
 * and fires a follow-up "complete this task" prompt even after raw_send delivered —
 * causing duplicate messages to the same target.
 */
export { isMessageToolSendActionName } from "./embedded-agent-messaging.js";
import {
  isMessagingTool as upstreamIsMessagingTool,
  isMessagingToolSendAction as upstreamIsMessagingToolSendAction,
} from "./embedded-agent-messaging.js";

// raw_send is a frankclaw-only direct delivery tool; treat it as a messaging
// tool so the embedded-agent run result carries delivery evidence and the
// orchestration loop does not re-fire after a successful send.
const RAW_SEND_TOOL_NAME = "raw_send";

/** Return true for core or channel-plugin messaging tool names, including raw_send. */
export function isMessagingTool(toolName: string): boolean {
  if (toolName === RAW_SEND_TOOL_NAME) {
    return true;
  }
  return upstreamIsMessagingTool(toolName);
}

/** Return true when the specific tool invocation is an outbound send. */
export function isMessagingToolSendAction(
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  // raw_send has no action discriminator; every call is an outbound send.
  if (toolName === RAW_SEND_TOOL_NAME) {
    return true;
  }
  return upstreamIsMessagingToolSendAction(toolName, args);
}
