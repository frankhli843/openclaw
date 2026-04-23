/**
 * AsyncLocalStorage-based context for "direct action" sends.
 *
 * When an agent is fulfilling an explicit user request during quiet hours
 * (e.g. "post this link to the thread", "send me the file"), the send call
 * can be wrapped in `runWithDirectAction()`. DNR enforcement checks
 * `isDirectActionContext()` and skips suppression when true, logging each
 * bypass for audit.
 *
 * This avoids threading a `directAction` flag through 5+ upstream function
 * signatures (message-tool → runner → send-service → message → deliver → adapter).
 *
 * frankclaw-only. Zero upstream surface.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const directActionStore = new AsyncLocalStorage<{ directAction: true }>();

/**
 * Run `fn` inside a direct-action context. Any DNR enforcement check
 * reached during `fn` will see `isDirectActionContext() === true` and
 * allow the send through (with logging).
 */
export function runWithDirectAction<T>(fn: () => T | Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    directActionStore.run({ directAction: true }, () => {
      try {
        const result = fn();
        if (result instanceof Promise) {
          result.then(resolve, reject);
        } else {
          resolve(result);
        }
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Check whether the current async context is a direct-action send.
 * Called by `enforceDiscordDnrWindow` / `enforceWhatsAppDnrWindow`.
 */
export function isDirectActionContext(): boolean {
  return directActionStore.getStore()?.directAction === true;
}
