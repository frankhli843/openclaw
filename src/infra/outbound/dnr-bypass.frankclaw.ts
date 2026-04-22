/**
 * frankclaw: DNR bypass for user-initiated actions.
 *
 * Uses AsyncLocalStorage to propagate a "user-initiated" flag through the async
 * call chain. When a user sends a message, the message handler wraps the dispatch
 * in `runWithDnrBypass`, which makes all outbound sends during that processing
 * skip DNR quiet-hours enforcement.
 *
 * This implements the "direct-action exception" from Frank's directive: quiet hours
 * suppress proactive/unsolicited notifications but NOT actions the user explicitly
 * asked for.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const dnrBypassStorage = new AsyncLocalStorage<boolean>();

/**
 * Execute `fn` with DNR bypass active. All calls to `isDnrBypassActive()` within
 * the async context of `fn` will return true.
 */
export function runWithDnrBypass<T>(fn: () => T): T {
  return dnrBypassStorage.run(true, fn);
}

/**
 * Check if the current async context has DNR bypass active (i.e., we are
 * processing a user-initiated message and outbound sends should not be
 * suppressed by quiet hours).
 */
export function isDnrBypassActive(): boolean {
  return dnrBypassStorage.getStore() === true;
}
