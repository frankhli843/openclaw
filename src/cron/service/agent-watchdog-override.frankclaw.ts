/**
 * frankclaw: Overrides the pre-execution watchdog cap for isolated cron agents.
 *
 * Upstream caps the watchdog at 60 s. On loaded systems (e.g. llama.cpp
 * inference running on the same GPU), the async path from runtime_plugins to
 * the first execution-stage phase (attempt_dispatch) can include plugin hooks,
 * harness dynamic imports, auth loading, model resolution, and context
 * assembly — all of which serialise on the event loop and can collectively
 * exceed 60 s. 180 s gives a comfortable 3× margin while staying well within
 * the default 60-min agentTurn job timeout.
 */
export const FRANKCLAW_CRON_AGENT_PRE_EXECUTION_WATCHDOG_MS = 180_000;
