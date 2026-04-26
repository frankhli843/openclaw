// frankclaw: Fail hard on plugin load errors instead of silently continuing.
// The gateway must not start with missing plugins. Silent failures mask bugs
// (e.g. zod v3/v4 mismatch killing WhatsApp) and cause cascading issues:
// - Messages go unanswered on the failed channel
// - ACP workers crash on startup (CLI mode uses throwOnLoadError: true)
// - Heartbeat/watchdog can't detect the root cause
//
// This module wraps the plugin registry after loading and throws if any
// plugin failed to register. The gateway process will crash, systemd will
// restart it, and the journal will have a clear error for diagnosis.

import type { PluginRegistry } from "../plugins/registry-types.js";

export function enforcePluginLoadSuccess(registry: PluginRegistry): void {
  const failed = registry.plugins.filter((p) => p.status === "error");
  if (failed.length === 0) {
    return;
  }
  const summary = failed.map((p) => `${p.id} (phase: ${p.failurePhase ?? "unknown"})`).join("; ");
  throw new Error(
    `[frankclaw] Plugin load failures are fatal. ${failed.length} plugin(s) failed: ${summary}. ` +
      `Fix the root cause or disable the plugin in openclaw.json (channels.<id>.enabled: false). ` +
      `The gateway will NOT start with broken plugins.`,
  );
}
