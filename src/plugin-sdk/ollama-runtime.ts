import type { OpenClawConfig } from "../config/types.js";

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function isSafeIntegerBigInt(value: bigint) {
  return value <= MAX_SAFE_INTEGER_BIGINT && value >= -MAX_SAFE_INTEGER_BIGINT;
}

function quoteUnsafeIntegersInJson(input: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  let escaped = false;

  while (i < input.length) {
    const ch = input[i];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const start = i;
      let j = i;
      if (input[j] === "-") {
        j += 1;
      }
      const digitsStart = j;
      while (j < input.length) {
        const digit = input[j];
        if (digit >= "0" && digit <= "9") {
          j += 1;
          continue;
        }
        break;
      }
      const hasDigits = j > digitsStart;
      const next = j < input.length ? input[j] : "";
      const isPlainInteger = hasDigits && next !== "." && next !== "e" && next !== "E";
      const token = input.slice(start, j);

      if (isPlainInteger) {
        try {
          const big = BigInt(token);
          if (!isSafeIntegerBigInt(big)) {
            out += `"${token}"`;
            i = j;
            continue;
          }
        } catch {
          // Fall through to append raw token.
        }
      }

      out += token;
      i = j;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

function parseJsonLosslessUnsafeIntegers(text: string): unknown {
  const normalized = quoteUnsafeIntegersInJson(text);
  return JSON.parse(normalized) as unknown;
}

export function isOllamaCompatProvider(params: {
  provider: string;
  api?: string;
  baseUrl?: string;
}): boolean {
  if (params.provider === "ollama") {
    return true;
  }
  if (params.api !== "openai-completions") {
    return false;
  }

  const baseUrl = params.baseUrl ?? "";
  let url: URL | null = null;
  try {
    url = new URL(baseUrl);
  } catch {
    url = null;
  }

  if (!url) {
    return params.provider.toLowerCase().includes("ollama");
  }

  if (url.port !== "11434") {
    return false;
  }

  // WHATWG URL.hostname keeps IPv6 literals bracketed (e.g. "[::1]"), so strip the
  // brackets before comparing against the bare "::1" loopback form.
  const host = url.hostname;
  const normalizedHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const isLoopback =
    normalizedHost === "127.0.0.1" || normalizedHost === "localhost" || normalizedHost === "::1";
  if (isLoopback) {
    return true;
  }

  return params.provider.toLowerCase().includes("ollama");
}

export function resolveOllamaCompatNumCtxEnabled(params: {
  config?: OpenClawConfig;
  providerId: string;
}): boolean {
  const flag = params.config?.models?.providers?.[params.providerId]?.injectNumCtxForOpenAICompat;
  return flag !== false;
}

export function shouldInjectOllamaCompatNumCtx(params: {
  model: {
    provider: string;
    api?: string;
    baseUrl?: string;
  };
  config?: OpenClawConfig;
  providerId?: string;
}): boolean {
  if (params.model.api !== "openai-completions") {
    return false;
  }
  if (
    !isOllamaCompatProvider({
      provider: params.model.provider,
      api: params.model.api,
      baseUrl: params.model.baseUrl,
    })
  ) {
    return false;
  }
  const providerId = params.providerId ?? params.model.provider;
  return resolveOllamaCompatNumCtxEnabled({ config: params.config, providerId });
}

type OllamaCompatOnPayload = (payload: Record<string, unknown>, payloadModel: unknown) => void;
type OllamaCompatStreamFn = (
  model: unknown,
  context: unknown,
  options?: { onPayload?: OllamaCompatOnPayload },
) => unknown;

export function wrapOllamaCompatNumCtx(baseFn: OllamaCompatStreamFn, numCtx: number) {
  const wrapped: OllamaCompatStreamFn = (model, context, options) => {
    const downstream = options?.onPayload;
    return baseFn(model, context, {
      ...options,
      onPayload: (payload, payloadModel) => {
        const opts = (payload.options ?? {}) as Record<string, unknown>;
        opts.num_ctx = numCtx;
        payload.options = opts;

        const messages = payload.messages as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(messages)) {
          for (const message of messages) {
            if (!message || message.role !== "assistant") {
              continue;
            }
            const toolCalls = message.tool_calls as Array<Record<string, unknown>> | undefined;
            if (Array.isArray(toolCalls)) {
              for (const toolCall of toolCalls) {
                const fn = toolCall?.function as Record<string, unknown> | undefined;
                const args = fn?.arguments;
                if (fn && typeof args === "string") {
                  try {
                    fn.arguments = parseJsonLosslessUnsafeIntegers(args);
                  } catch {
                    // Keep original string.
                  }
                }
              }
            }

            const functionCall = message.function_call as Record<string, unknown> | undefined;
            const args = functionCall?.arguments;
            if (functionCall && typeof args === "string") {
              try {
                functionCall.arguments = parseJsonLosslessUnsafeIntegers(args);
              } catch {
                // Keep original string.
              }
            }
          }
        }

        downstream?.(payload, payloadModel);
      },
    });
  };

  return wrapped;
}
