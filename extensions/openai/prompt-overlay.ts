import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  GPT5_BEHAVIOR_CONTRACT,
  GPT5_FRIENDLY_CHAT_PROMPT_OVERLAY,
  GPT5_HEARTBEAT_PROMPT_OVERLAY,
  isGpt5ModelId,
  resolveGpt5PromptOverlayMode,
  resolveGpt5SystemPromptContribution,
  type Gpt5PromptOverlayMode,
} from "openclaw/plugin-sdk/provider-model-shared";

const OPENAI_PROVIDER_IDS = new Set(["openai"]);

export const OPENAI_FRIENDLY_PROMPT_OVERLAY = GPT5_FRIENDLY_CHAT_PROMPT_OVERLAY;
export const OPENAI_HEARTBEAT_PROMPT_OVERLAY = GPT5_HEARTBEAT_PROMPT_OVERLAY;
export const OPENAI_GPT5_BEHAVIOR_CONTRACT = GPT5_BEHAVIOR_CONTRACT;

// --- VOICE.md runtime loading (frankclaw) ---

const VOICE_FILENAME = "VOICE.md";
let voiceFileCache: { content: string; mtimeMs: number } | undefined;

export function loadVoiceFile(workspaceDir: string): string | undefined {
  const filePath = join(workspaceDir, VOICE_FILENAME);
  try {
    const { mtimeMs } = statSync(filePath);
    if (voiceFileCache && voiceFileCache.mtimeMs === mtimeMs) {
      return voiceFileCache.content;
    }
    const content = readFileSync(filePath, "utf-8").trim();
    if (content) {
      voiceFileCache = { content, mtimeMs };
      return content;
    }
  } catch {
    // File doesn't exist or unreadable, fall through
  }
  return undefined;
}

// --- End frankclaw ---

type OpenAIPromptOverlayMode = Gpt5PromptOverlayMode;

export function resolveOpenAIPromptOverlayMode(
  pluginConfig?: Record<string, unknown>,
): OpenAIPromptOverlayMode {
  return resolveGpt5PromptOverlayMode(undefined, pluginConfig);
}

export function shouldApplyOpenAIPromptOverlay(params: {
  modelProviderId?: string;
  modelId?: string;
}): boolean {
  return OPENAI_PROVIDER_IDS.has(params.modelProviderId ?? "") && isGpt5ModelId(params.modelId);
}

export function resolveOpenAISystemPromptContribution(params: {
  config?: Parameters<typeof resolveGpt5SystemPromptContribution>[0]["config"];
  legacyPluginConfig?: Record<string, unknown>;
  mode?: OpenAIPromptOverlayMode;
  modelProviderId?: string;
  modelId?: string;
  workspaceDir?: string;
  trigger?: Parameters<typeof resolveGpt5SystemPromptContribution>[0]["trigger"];
}) {
  let result = resolveGpt5SystemPromptContribution({
    config: params.config,
    legacyPluginConfig:
      params.mode === undefined ? params.legacyPluginConfig : { personality: params.mode },
    modelId: params.modelId,
    trigger: params.trigger,
    enabled: shouldApplyOpenAIPromptOverlay({
      modelProviderId: params.modelProviderId,
      modelId: params.modelId,
    }),
  });
  // frankclaw addition: inject VOICE.md content into the contribution
  if (result && params.workspaceDir) {
    const voiceContent = loadVoiceFile(params.workspaceDir);
    if (voiceContent) {
      result = {
        ...result,
        stablePrefix: [result.stablePrefix, `## Writing Style\n\n${voiceContent}`]
          .filter(Boolean)
          .join("\n\n"),
      };
    }
  }
  return result;
}
