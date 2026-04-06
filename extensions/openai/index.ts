import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

type OptionalRegistrationApi = {
  logger?: {
    warn?: (...args: unknown[]) => void;
  };
} & Record<string, unknown>;

function registerOptional(api: OptionalRegistrationApi, methodName: string, value: unknown): void {
  const register = api[methodName];
  if (typeof register !== "function") {
    api.logger?.warn?.(
      `[openai] host plugin API missing ${methodName}, skipping optional registration`,
    );
    return;
  }
  (register as (payload: unknown) => void)(value);
}

export default definePluginEntry({
  id: "openai",
  name: "OpenAI Provider",
  description: "Bundled OpenAI provider plugins",
  async register(api) {
    const {
      buildOpenAICodexCliBackend,
      buildOpenAICodexProviderPlugin,
      buildOpenAIImageGenerationProvider,
      buildOpenAIProvider,
      buildOpenAIRealtimeTranscriptionProvider,
      buildOpenAIRealtimeVoiceProvider,
      buildOpenAISpeechProvider,
      OPENAI_FRIENDLY_PROMPT_OVERLAY,
      openaiCodexMediaUnderstandingProvider,
      openaiMediaUnderstandingProvider,
      resolveOpenAIPromptOverlayMode,
      shouldApplyOpenAIPromptOverlay,
    } = await import("./register.runtime.js");

    const promptOverlayMode = resolveOpenAIPromptOverlayMode(api.pluginConfig);
    registerOptional(api as OptionalRegistrationApi, "registerCliBackend", buildOpenAICodexCliBackend());
    api.registerProvider(buildOpenAIProvider());
    api.registerProvider(buildOpenAICodexProviderPlugin());
    registerOptional(api as OptionalRegistrationApi, "registerSpeechProvider", buildOpenAISpeechProvider());
    registerOptional(
      api as OptionalRegistrationApi,
      "registerRealtimeTranscriptionProvider",
      buildOpenAIRealtimeTranscriptionProvider(),
    );
    registerOptional(
      api as OptionalRegistrationApi,
      "registerRealtimeVoiceProvider",
      buildOpenAIRealtimeVoiceProvider(),
    );
    registerOptional(
      api as OptionalRegistrationApi,
      "registerMediaUnderstandingProvider",
      openaiMediaUnderstandingProvider,
    );
    registerOptional(
      api as OptionalRegistrationApi,
      "registerMediaUnderstandingProvider",
      openaiCodexMediaUnderstandingProvider,
    );
    registerOptional(
      api as OptionalRegistrationApi,
      "registerImageGenerationProvider",
      buildOpenAIImageGenerationProvider(),
    );
    if (promptOverlayMode !== "off") {
      const on = (api as OptionalRegistrationApi).on;
      if (typeof on === "function") {
        (on as OpenClawPluginApi["on"])("before_prompt_build", (_event, ctx) =>
          shouldApplyOpenAIPromptOverlay({
            mode: promptOverlayMode,
            modelProviderId: ctx.modelProviderId,
          })
            ? { appendSystemContext: OPENAI_FRIENDLY_PROMPT_OVERLAY }
            : undefined,
        );
      } else {
        api.logger.warn?.("[openai] host plugin API missing on, skipping prompt overlay hook registration");
      }
    }
  },
});
