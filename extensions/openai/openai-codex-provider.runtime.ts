import {
  getOAuthApiKey as getOAuthApiKeyFromPi,
  refreshOpenAICodexToken as refreshOpenAICodexTokenFromPi,
} from "@mariozechner/pi-ai/oauth";
import { ensureGlobalUndiciEnvProxyDispatcher } from "openclaw/plugin-sdk/runtime-env";

type OpenAICodexTestDelegateGlobal = typeof globalThis & {
  __OPENCLAW_TEST_REFRESH_OPENAI_CODEX_TOKEN__?: (...args: unknown[]) => unknown;
};

function openAICodexTestDelegateGlobal(): OpenAICodexTestDelegateGlobal {
  return globalThis as OpenAICodexTestDelegateGlobal;
}

export async function getOAuthApiKey(
  ...args: Parameters<typeof getOAuthApiKeyFromPi>
): Promise<Awaited<ReturnType<typeof getOAuthApiKeyFromPi>>> {
  ensureGlobalUndiciEnvProxyDispatcher();
  return await getOAuthApiKeyFromPi(...args);
}

export async function refreshOpenAICodexToken(
  ...args: Parameters<typeof refreshOpenAICodexTokenFromPi>
): Promise<Awaited<ReturnType<typeof refreshOpenAICodexTokenFromPi>>> {
  ensureGlobalUndiciEnvProxyDispatcher();
  const delegate = openAICodexTestDelegateGlobal().__OPENCLAW_TEST_REFRESH_OPENAI_CODEX_TOKEN__;
  if (delegate) {
    return (await delegate(...args)) as Awaited<ReturnType<typeof refreshOpenAICodexTokenFromPi>>;
  }
  return await refreshOpenAICodexTokenFromPi(...args);
}
