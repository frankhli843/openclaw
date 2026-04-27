import type { SkillSnapshot } from "../../agents/skills.js";
import type { ThinkLevel, VerboseLevel } from "../../auto-reply/thinking.js";
import type { AgentDefaultsConfig } from "../../config/types.agent-defaults.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { CronJob } from "../types.js";
import {
  resolveCronChannelOutputPolicy,
  resolveCurrentChannelTarget,
} from "./channel-output-policy.js";
import { resolveCronPayloadOutcome } from "./helpers.js";
import {
  getCliSessionId,
  isCliProvider,
  LiveSessionModelSwitchError,
  logWarn,
  normalizeVerboseLevel,
  registerAgentRunContext,
  resolveBootstrapWarningSignaturesSeen,
  resolveSessionTranscriptPath,
  runCliAgent,
  runWithModelFallback,
} from "./run-execution.runtime.js";
import { resolveCronFallbacksOverride } from "./run-fallback-policy.js";
import type {
  CronLiveSelection,
  MutableCronSession,
  PersistCronSessionEntry,
} from "./run-session-state.js";
import { syncCronSessionLiveSelection } from "./run-session-state.js";
// frankclaw: multi-turn orchestration for cron sessions that spawn ACP workers
import type { OrchestrationContext } from "./run-subagent-orchestration.frankclaw.js";
import { isLikelyInterimCronMessage } from "./subagent-followup-hints.js";

let cronOrchestrationRuntimePromise:
  | Promise<typeof import("./run-subagent-orchestration.frankclaw.js")>
  | undefined;

async function loadCronOrchestrationRuntime() {
  cronOrchestrationRuntimePromise ??= import("./run-subagent-orchestration.frankclaw.js");
  return await cronOrchestrationRuntimePromise;
}

type AgentTurnPayload = Extract<CronJob["payload"], { kind: "agentTurn" }> | null;
type CronPromptRunResult = Awaited<ReturnType<typeof runCliAgent>>;
type CronEmbeddedRuntime = typeof import("./run-embedded.runtime.js");
let cronEmbeddedRuntimePromise: Promise<CronEmbeddedRuntime> | undefined;

async function loadCronEmbeddedRuntime() {
  cronEmbeddedRuntimePromise ??= import("./run-embedded.runtime.js");
  return await cronEmbeddedRuntimePromise;
}

export type CronExecutionResult = {
  runResult: CronPromptRunResult;
  fallbackProvider: string;
  fallbackModel: string;
  runStartedAt: number;
  runEndedAt: number;
  liveSelection: CronLiveSelection;
};

export function createCronPromptExecutor(params: {
  cfg: OpenClawConfig;
  cfgWithAgentDefaults: OpenClawConfig;
  job: CronJob;
  agentId: string;
  agentDir: string;
  agentSessionKey: string;
  runSessionKey: string;
  workspaceDir: string;
  lane?: string;
  resolvedVerboseLevel: VerboseLevel;
  thinkLevel: ThinkLevel | undefined;
  timeoutMs: number;
  messageChannel: string | undefined;
  suppressExecNotifyOnExit: boolean;
  resolvedDelivery: {
    accountId?: string;
    to?: string;
    threadId?: string | number;
  };
  toolPolicy: {
    requireExplicitMessageTarget: boolean;
    disableMessageTool: boolean;
    forceMessageTool: boolean;
  };
  skillsSnapshot: SkillSnapshot;
  agentPayload: AgentTurnPayload;
  liveSelection: CronLiveSelection;
  cronSession: MutableCronSession;
  abortSignal?: AbortSignal;
  abortReason: () => string;
  onExecutionStarted?: () => void;
}) {
  const sessionFile =
    params.cronSession.sessionEntry.sessionFile?.trim() ||
    resolveSessionTranscriptPath(params.cronSession.sessionEntry.sessionId, params.agentId);
  // Fallback for callers that bypass prepareCronRunContext before persisting retries.
  if (!params.cronSession.sessionEntry.sessionFile?.trim()) {
    params.cronSession.sessionEntry.sessionFile = sessionFile;
  }
  const cronFallbacksOverride = resolveCronFallbacksOverride({
    cfg: params.cfg,
    job: params.job,
    agentId: params.agentId,
  });
  let runResult: CronPromptRunResult | undefined;
  let fallbackProvider = params.liveSelection.provider;
  let fallbackModel = params.liveSelection.model;
  let runEndedAt = Date.now();
  let bootstrapPromptWarningSignaturesSeen = resolveBootstrapWarningSignaturesSeen(
    params.cronSession.sessionEntry.systemPromptReport,
  );

  const runPrompt = async (promptText: string) => {
    const fallbackResult = await runWithModelFallback({
      cfg: params.cfgWithAgentDefaults,
      provider: params.liveSelection.provider,
      model: params.liveSelection.model,
      runId: params.cronSession.sessionEntry.sessionId,
      agentDir: params.agentDir,
      fallbacksOverride: cronFallbacksOverride,
      run: async (providerOverride, modelOverride, runOptions) => {
        if (params.abortSignal?.aborted) {
          throw new Error(params.abortReason());
        }
        const bootstrapPromptWarningSignature =
          bootstrapPromptWarningSignaturesSeen[bootstrapPromptWarningSignaturesSeen.length - 1];
        if (isCliProvider(providerOverride, params.cfgWithAgentDefaults)) {
          const cliSessionId = params.cronSession.isNewSession
            ? undefined
            : await getCliSessionId(params.cronSession.sessionEntry, providerOverride);
          const result = await runCliAgent({
            sessionId: params.cronSession.sessionEntry.sessionId,
            sessionKey: params.runSessionKey,
            agentId: params.agentId,
            trigger: "cron",
            jobId: params.job.id,
            sessionFile,
            workspaceDir: params.workspaceDir,
            config: params.cfgWithAgentDefaults,
            prompt: promptText,
            provider: providerOverride,
            model: modelOverride,
            thinkLevel: params.thinkLevel,
            timeoutMs: params.timeoutMs,
            runId: params.cronSession.sessionEntry.sessionId,
            cliSessionId,
            skillsSnapshot: params.skillsSnapshot,
            messageChannel: params.messageChannel,
            abortSignal: params.abortSignal,
            onExecutionStarted: params.onExecutionStarted,
            bootstrapPromptWarningSignaturesSeen,
            bootstrapPromptWarningSignature,
            senderIsOwner: true,
          });
          bootstrapPromptWarningSignaturesSeen = resolveBootstrapWarningSignaturesSeen(
            result.meta?.systemPromptReport,
          );
          return result;
        }
        const { resolveCronAgentLane, resolveFastModeState, runEmbeddedPiAgent } =
          await loadCronEmbeddedRuntime();
        const currentChannelId = await resolveCurrentChannelTarget({
          channel: params.messageChannel,
          to: params.resolvedDelivery.to,
          threadId: params.resolvedDelivery.threadId,
        });
        const result = await runEmbeddedPiAgent({
          sessionId: params.cronSession.sessionEntry.sessionId,
          sessionKey: params.runSessionKey,
          agentId: params.agentId,
          trigger: "cron",
          jobId: params.job.id,
          cleanupBundleMcpOnRunEnd: params.job.sessionTarget === "isolated",
          allowGatewaySubagentBinding: true,
          senderIsOwner: false,
          messageChannel: params.messageChannel,
          agentAccountId: params.resolvedDelivery.accountId,
          messageTo: params.resolvedDelivery.to,
          messageThreadId: params.resolvedDelivery.threadId,
          currentChannelId,
          sessionFile,
          agentDir: params.agentDir,
          workspaceDir: params.workspaceDir,
          config: params.cfgWithAgentDefaults,
          skillsSnapshot: params.skillsSnapshot,
          prompt: promptText,
          lane: resolveCronAgentLane(params.lane),
          provider: providerOverride,
          model: modelOverride,
          authProfileId: params.liveSelection.authProfileId,
          authProfileIdSource: params.liveSelection.authProfileId
            ? params.liveSelection.authProfileIdSource
            : undefined,
          thinkLevel: params.thinkLevel,
          fastMode: resolveFastModeState({
            cfg: params.cfgWithAgentDefaults,
            provider: providerOverride,
            model: modelOverride,
            agentId: params.agentId,
            sessionEntry: params.cronSession.sessionEntry,
          }).enabled,
          verboseLevel: params.resolvedVerboseLevel,
          timeoutMs: params.timeoutMs,
          bootstrapContextMode: params.agentPayload?.lightContext ? "lightweight" : undefined,
          bootstrapContextRunKind: "cron",
          toolsAllow: params.agentPayload?.toolsAllow,
          execOverrides: params.suppressExecNotifyOnExit
            ? {
                notifyOnExit: false,
                notifyOnExitEmptySuccess: false,
              }
            : undefined,
          runId: params.cronSession.sessionEntry.sessionId,
          requireExplicitMessageTarget: params.toolPolicy.requireExplicitMessageTarget,
          disableMessageTool: params.toolPolicy.disableMessageTool,
          forceMessageTool: params.toolPolicy.forceMessageTool,
          allowTransientCooldownProbe: runOptions?.allowTransientCooldownProbe,
          abortSignal: params.abortSignal,
          onExecutionStarted: params.onExecutionStarted,
          bootstrapPromptWarningSignaturesSeen,
          bootstrapPromptWarningSignature,
        });
        bootstrapPromptWarningSignaturesSeen = resolveBootstrapWarningSignaturesSeen(
          result.meta?.systemPromptReport,
        );
        return result;
      },
    });
    runResult = fallbackResult.result;
    fallbackProvider = fallbackResult.provider;
    fallbackModel = fallbackResult.model;
    params.liveSelection.provider = fallbackResult.provider;
    params.liveSelection.model = fallbackResult.model;
    runEndedAt = Date.now();
  };

  return {
    runPrompt,
    getState: () => ({
      runResult,
      fallbackProvider,
      fallbackModel,
      runEndedAt,
      liveSelection: params.liveSelection,
    }),
  };
}

export async function executeCronRun(params: {
  cfg: OpenClawConfig;
  cfgWithAgentDefaults: OpenClawConfig;
  job: CronJob;
  agentId: string;
  agentDir: string;
  agentSessionKey: string;
  runSessionKey: string;
  workspaceDir: string;
  lane?: string;
  resolvedDelivery: {
    channel?: string;
    accountId?: string;
    to?: string;
    threadId?: string | number;
  };
  toolPolicy: {
    requireExplicitMessageTarget: boolean;
    disableMessageTool: boolean;
    forceMessageTool: boolean;
  };
  skillsSnapshot: SkillSnapshot;
  agentPayload: AgentTurnPayload;
  agentVerboseDefault: AgentDefaultsConfig["verboseDefault"];
  liveSelection: CronLiveSelection;
  cronSession: MutableCronSession;
  commandBody: string;
  persistSessionEntry: PersistCronSessionEntry;
  abortSignal?: AbortSignal;
  abortReason: () => string;
  isAborted: () => boolean;
  onExecutionStarted?: () => void;
  thinkLevel: ThinkLevel | undefined;
  timeoutMs: number;
  suppressExecNotifyOnExit: boolean;
  runStartedAt?: number;
}): Promise<CronExecutionResult> {
  const resolvedVerboseLevel: VerboseLevel =
    normalizeVerboseLevel(params.cronSession.sessionEntry.verboseLevel) ??
    normalizeVerboseLevel(params.agentVerboseDefault) ??
    "off";
  registerAgentRunContext(params.cronSession.sessionEntry.sessionId, {
    sessionKey: params.runSessionKey,
    verboseLevel: resolvedVerboseLevel,
  });
  const executor = createCronPromptExecutor({
    cfg: params.cfg,
    cfgWithAgentDefaults: params.cfgWithAgentDefaults,
    job: params.job,
    agentId: params.agentId,
    agentDir: params.agentDir,
    agentSessionKey: params.agentSessionKey,
    runSessionKey: params.runSessionKey,
    workspaceDir: params.workspaceDir,
    lane: params.lane,
    resolvedVerboseLevel,
    thinkLevel: params.thinkLevel,
    timeoutMs: params.timeoutMs,
    messageChannel: params.resolvedDelivery.channel,
    suppressExecNotifyOnExit: params.suppressExecNotifyOnExit,
    resolvedDelivery: params.resolvedDelivery,
    toolPolicy: params.toolPolicy,
    skillsSnapshot: params.skillsSnapshot,
    agentPayload: params.agentPayload,
    liveSelection: params.liveSelection,
    cronSession: params.cronSession,
    abortSignal: params.abortSignal,
    abortReason: params.abortReason,
    onExecutionStarted: params.onExecutionStarted,
  });

  const runStartedAt = params.runStartedAt ?? Date.now();
  const MAX_MODEL_SWITCH_RETRIES = 2;
  let modelSwitchRetries = 0;
  while (true) {
    try {
      await executor.runPrompt(params.commandBody);
      break;
    } catch (err) {
      if (!(err instanceof LiveSessionModelSwitchError)) {
        throw err;
      }
      modelSwitchRetries += 1;
      if (modelSwitchRetries > MAX_MODEL_SWITCH_RETRIES) {
        logWarn(
          `[cron:${params.job.id}] LiveSessionModelSwitchError retry limit reached (${MAX_MODEL_SWITCH_RETRIES}); aborting`,
        );
        throw err;
      }
      params.liveSelection.provider = err.provider;
      params.liveSelection.model = err.model;
      params.liveSelection.authProfileId = err.authProfileId;
      params.liveSelection.authProfileIdSource = err.authProfileId
        ? err.authProfileIdSource
        : undefined;
      syncCronSessionLiveSelection({
        entry: params.cronSession.sessionEntry,
        liveSelection: params.liveSelection,
      });
      try {
        await params.persistSessionEntry();
      } catch (persistErr) {
        logWarn(
          `[cron:${params.job.id}] Failed to persist model switch session entry: ${String(persistErr)}`,
        );
      }
      continue;
    }
  }

  let { runResult, fallbackProvider, fallbackModel, runEndedAt } = executor.getState();
  if (!runResult) {
    throw new Error("cron isolated run returned no result");
  }

  // frankclaw: multi-turn orchestration loop. Replaces the single-shot
  // interim retry with a loop that waits for spawned descendants, feeds
  // their output back to the model, and lets it spawn the next batch.
  // Fixes the 2026-04-23/24 knowledge-agent failure where the parent cron
  // session died after batch 1 because the orchestration loop never ran
  // (checkInterim was undefined, causing ReferenceError at runtime).
  if (!params.isAborted()) {
    // Cache the channel output policy once for use in the checkInterim closure.
    const channelOutputPolicy = await resolveCronChannelOutputPolicy(
      params.resolvedDelivery.channel,
    );

    // checkInterim: evaluates whether a given run result is an interim
    // acknowledgment (e.g. "On it", "Spawning worker...") rather than a
    // substantive final answer. The orchestration loop calls this after
    // each model turn to decide whether to wait for descendants and
    // feed their output back.
    const checkInterim = (result: unknown): boolean => {
      if (!result || typeof result !== "object") {
        return false;
      }
      const r = result as {
        payloads?: Array<{ text?: string; isError?: boolean }>;
        meta?: { error?: unknown; failureSignal?: { fatalForCron?: boolean }; finalAssistantVisibleText?: string };
        didSendViaMessagingTool?: boolean;
      };
      const payloads = r.payloads ?? [];
      const { deliveryPayloadHasStructuredContent, hasFatalErrorPayload, outputText } = resolveCronPayloadOutcome({
        payloads,
        runLevelError: r.meta?.error,
        failureSignal: r.meta?.failureSignal,
        finalAssistantVisibleText: r.meta?.finalAssistantVisibleText,
        preferFinalAssistantVisibleText: channelOutputPolicy.preferFinalAssistantVisibleText,
      });
      // frankclaw: empty text (e.g. from sessions_yield producing only tool
      // calls with no visible text) is not substantive output. Treat it as
      // interim so the orchestration loop waits for descendants rather than
      // concluding that the model finished.
      const text = outputText?.trim() ?? "";
      const isEmptyOrInterim = !text || isLikelyInterimCronMessage(text);
      return (
        !r.meta?.error &&
        !hasFatalErrorPayload &&
        !r.didSendViaMessagingTool &&
        !deliveryPayloadHasStructuredContent &&
        !payloads.some((payload) => payload?.isError === true) &&
        isEmptyOrInterim
      );
    };

    const sessionFile =
      params.cronSession.sessionEntry.sessionFile?.trim() ||
      resolveSessionTranscriptPath(params.cronSession.sessionEntry.sessionId, params.agentId);

    const orchestration = await loadCronOrchestrationRuntime();
    const orchestrationCtx: OrchestrationContext = {
      agentSessionKey: params.agentSessionKey,
      runStartedAt,
      timeoutMs: params.timeoutMs,
      sessionFilePath: sessionFile,
      isAborted: params.isAborted,
      runPrompt: (prompt: string) => executor.runPrompt(prompt),
      getRunResult: () => {
        const state = executor.getState();
        return { runResult: state.runResult };
      },
    };
    await orchestration.runOrchestrationLoop(orchestrationCtx, checkInterim);
    ({ runResult, fallbackProvider, fallbackModel, runEndedAt } = executor.getState());
  }

  if (!runResult) {
    throw new Error("cron isolated run returned no result");
  }
  return {
    runResult,
    fallbackProvider,
    fallbackModel,
    runStartedAt,
    runEndedAt,
    liveSelection: params.liveSelection,
  };
}
