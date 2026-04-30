import {
  enforceDiscordDnrWindow,
  DiscordDnrSuppressedError,
} from "openclaw/plugin-sdk/infra-runtime";
import { createSubsystemLogger } from "openclaw/plugin-sdk/runtime-env";
import { jsonResult } from "../runtime-api.js";

const actionDnrLog = createSubsystemLogger("discord-action-dnr");

export function isDiscordActionDnrSuppressed(target: string, actionName: string): boolean {
  const dnrCtx = { channel: "discord" as const, to: target };
  try {
    enforceDiscordDnrWindow(dnrCtx);
    return false;
  } catch (err) {
    if (err instanceof DiscordDnrSuppressedError) {
      actionDnrLog.info(
        `[action/${actionName}] suppressed send to ${target} until ${new Date(err.nextEligibleAtMs).toISOString()}`,
      );
      return true;
    }
    throw err;
  }
}

export function dnrSuppressedJsonResult(message: string) {
  return jsonResult({ ok: true, dnrSuppressed: true, message });
}
