import { readErrorName } from "../infra/errors.js";
import {
  classifyFailoverReason,
  classifyFailoverReasonFromHttpStatus,
  isTimeoutErrorMessage,
  type FailoverReason,
} from "./pi-embedded-helpers.js";

const ABORT_TIMEOUT_RE = /request was aborted|request aborted/i;

export type RateLimitSeverity = "soft" | "hard";

export type ParsedRateLimitHint = {
  retryAfterMs?: number;
  availableAtMs?: number;
  severity?: RateLimitSeverity;
};

const RETRY_AFTER_SECONDS_RE = /retry\s+after\s+(\d+)\s*(?:s|sec|secs|second|seconds)\b/i;
const RETRY_AFTER_MINUTES_RE = /retry\s+after\s+(\d+)\s*(?:m|min|mins|minute|minutes)\b/i;
const AVAILABLE_AT_RE = /available\s+at\s+([^\n.;]+)/i;

function parseRetryAfterMs(message: string): number | undefined {
  const secMatch = message.match(RETRY_AFTER_SECONDS_RE);
  if (secMatch?.[1]) {
    const seconds = Number(secMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }
  const minMatch = message.match(RETRY_AFTER_MINUTES_RE);
  if (minMatch?.[1]) {
    const minutes = Number(minMatch[1]);
    if (Number.isFinite(minutes) && minutes > 0) {
      return minutes * 60 * 1000;
    }
  }
  return undefined;
}

function parseAvailableAtMs(message: string): number | undefined {
  const match = message.match(AVAILABLE_AT_RE);
  const raw = match?.[1]?.trim();
  if (!raw) {
    return undefined;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

/**
 * Extract rate limit hints from HTTP response headers on an error object.
 * Works with Anthropic SDK errors (APIError) which carry `.headers`.
 * Returns undefined if no usable headers found.
 */
export function extractRateLimitFromHeaders(err: unknown):
  | {
      retryAfterMs?: number;
      retryAfterHeader?: string;
    }
  | undefined {
  if (!err || typeof err !== "object") {
    return undefined;
  }
  const headers = (err as { headers?: unknown }).headers;
  if (!headers || typeof headers !== "object") {
    return undefined;
  }

  // Headers can be a standard Headers object (with .get()) or a plain object
  const getHeader = (name: string): string | undefined => {
    if (typeof (headers as { get?: unknown }).get === "function") {
      const val = (headers as Headers).get(name);
      return val ?? undefined;
    }
    // Plain object fallback
    const val = (headers as Record<string, unknown>)[name];
    return typeof val === "string" ? val : undefined;
  };

  const retryAfterRaw = getHeader("retry-after");
  if (retryAfterRaw) {
    const seconds = Number(retryAfterRaw);
    if (Number.isFinite(seconds) && seconds > 0) {
      return { retryAfterMs: seconds * 1000, retryAfterHeader: retryAfterRaw };
    }
    // Could be an HTTP-date; try parsing
    const parsed = Date.parse(retryAfterRaw);
    if (Number.isFinite(parsed) && parsed > Date.now()) {
      return { retryAfterMs: parsed - Date.now(), retryAfterHeader: retryAfterRaw };
    }
  }

  // Check x-ratelimit-reset-tokens / x-ratelimit-reset-requests (absolute ISO timestamps or seconds)
  for (const hdr of ["x-ratelimit-reset-tokens", "x-ratelimit-reset-requests"]) {
    const val = getHeader(hdr);
    if (!val) {
      continue;
    }
    // Anthropic uses durations like "1s", "30s", "5m0s"
    const durMatch = val.match(/^(?:(\d+)m)?(\d+)s$/);
    if (durMatch) {
      const mins = Number(durMatch[1] || 0);
      const secs = Number(durMatch[2] || 0);
      const ms = (mins * 60 + secs) * 1000;
      if (ms > 0) {
        return { retryAfterMs: ms, retryAfterHeader: `${hdr}: ${val}` };
      }
    }
    // Try as seconds
    const num = Number(val);
    if (Number.isFinite(num) && num > 0) {
      return { retryAfterMs: num * 1000, retryAfterHeader: `${hdr}: ${val}` };
    }
    // Try as ISO date
    const parsed = Date.parse(val);
    if (Number.isFinite(parsed) && parsed > Date.now()) {
      return { retryAfterMs: parsed - Date.now(), retryAfterHeader: `${hdr}: ${val}` };
    }
  }

  return undefined;
}

export function parseAnthropicRateLimitHint(params: {
  message?: string;
  status?: number;
  error?: unknown;
}): ParsedRateLimitHint | null {
  const message = params.message?.trim() ?? "";

  // First, try to extract from HTTP response headers on the error object.
  // This is the most reliable source (actual retry-after from Anthropic).
  const headerHint = params.error ? extractRateLimitFromHeaders(params.error) : undefined;
  if (headerHint?.retryAfterMs) {
    const severity: RateLimitSeverity = headerHint.retryAfterMs >= 10 * 60 * 1000 ? "hard" : "soft";
    return {
      retryAfterMs: headerHint.retryAfterMs,
      severity,
    };
  }

  // Fall back to parsing the error message text
  if (!message) {
    return null;
  }

  // Keep this parser scoped to Anthropic's response style to avoid
  // over-classifying other providers.
  const lower = message.toLowerCase();
  const looksAnthropic =
    lower.includes("anthropic") ||
    lower.includes("request_id") ||
    lower.includes("rate_limit_error") ||
    params.status === 429 ||
    params.status === 529;
  if (!looksAnthropic) {
    return null;
  }

  const retryAfterMs = parseRetryAfterMs(message);
  const availableAtMs = parseAvailableAtMs(message);

  if (retryAfterMs === undefined && availableAtMs === undefined) {
    return null;
  }

  const now = Date.now();
  const availableDeltaMs =
    typeof availableAtMs === "number" && availableAtMs > now ? availableAtMs - now : undefined;
  const effectiveRetryMs = availableDeltaMs ?? retryAfterMs;

  const severity: RateLimitSeverity | undefined =
    typeof effectiveRetryMs === "number" && effectiveRetryMs >= 10 * 60 * 1000 ? "hard" : "soft";

  return {
    retryAfterMs,
    availableAtMs,
    severity,
  };
}

export class FailoverError extends Error {
  readonly reason: FailoverReason;
  readonly provider?: string;
  readonly model?: string;
  readonly profileId?: string;
  readonly status?: number;
  readonly code?: string;
  readonly retryAfterMs?: number;
  readonly availableAtMs?: number;
  readonly rateLimitSeverity?: RateLimitSeverity;

  constructor(
    message: string,
    params: {
      reason: FailoverReason;
      provider?: string;
      model?: string;
      profileId?: string;
      status?: number;
      code?: string;
      retryAfterMs?: number;
      availableAtMs?: number;
      rateLimitSeverity?: RateLimitSeverity;
      cause?: unknown;
    },
  ) {
    super(message, { cause: params.cause });
    this.name = "FailoverError";
    this.reason = params.reason;
    this.provider = params.provider;
    this.model = params.model;
    this.profileId = params.profileId;
    this.status = params.status;
    this.code = params.code;
    this.retryAfterMs = params.retryAfterMs;
    this.availableAtMs = params.availableAtMs;
    this.rateLimitSeverity = params.rateLimitSeverity;
  }
}

export function isFailoverError(err: unknown): err is FailoverError {
  return err instanceof FailoverError;
}

export function resolveFailoverStatus(reason: FailoverReason): number | undefined {
  switch (reason) {
    case "billing":
      return 402;
    case "rate_limit":
      return 429;
    case "overloaded":
      return 503;
    case "auth":
      return 401;
    case "auth_permanent":
      return 403;
    case "timeout":
      return 408;
    case "format":
      return 400;
    case "model_not_found":
      return 404;
    case "session_expired":
      return 410; // Gone - session no longer exists
    default:
      return undefined;
  }
}

function findErrorProperty<T>(
  err: unknown,
  reader: (candidate: unknown) => T | undefined,
  seen: Set<object> = new Set(),
): T | undefined {
  const direct = reader(err);
  if (direct !== undefined) {
    return direct;
  }
  if (!err || typeof err !== "object") {
    return undefined;
  }
  if (seen.has(err)) {
    return undefined;
  }
  seen.add(err);
  const candidate = err as { error?: unknown; cause?: unknown };
  return (
    findErrorProperty(candidate.error, reader, seen) ??
    findErrorProperty(candidate.cause, reader, seen)
  );
}

function readDirectStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== "object") {
    return undefined;
  }
  const candidate =
    (err as { status?: unknown; statusCode?: unknown }).status ??
    (err as { statusCode?: unknown }).statusCode;
  if (typeof candidate === "number") {
    return candidate;
  }
  if (typeof candidate === "string" && /^\d+$/.test(candidate)) {
    return Number(candidate);
  }
  return undefined;
}

function getStatusCode(err: unknown): number | undefined {
  return findErrorProperty(err, readDirectStatusCode);
}

function readDirectErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") {
    return undefined;
  }
  const directCode = (err as { code?: unknown }).code;
  if (typeof directCode === "string") {
    const trimmed = directCode.trim();
    return trimmed ? trimmed : undefined;
  }
  const status = (err as { status?: unknown }).status;
  if (typeof status !== "string" || /^\d+$/.test(status)) {
    return undefined;
  }
  const trimmed = status.trim();
  return trimmed ? trimmed : undefined;
}

function getErrorCode(err: unknown): string | undefined {
  return findErrorProperty(err, readDirectErrorCode);
}

function readDirectErrorMessage(err: unknown): string | undefined {
  if (err instanceof Error) {
    return err.message || undefined;
  }
  if (typeof err === "string") {
    return err || undefined;
  }
  if (typeof err === "number" || typeof err === "boolean" || typeof err === "bigint") {
    return String(err);
  }
  if (typeof err === "symbol") {
    return err.description ?? undefined;
  }
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") {
      return message || undefined;
    }
  }
  return undefined;
}

function getErrorMessage(err: unknown): string {
  return findErrorProperty(err, readDirectErrorMessage) ?? "";
}

function getErrorCause(err: unknown): unknown {
  if (!err || typeof err !== "object" || !("cause" in err)) {
    return undefined;
  }
  return (err as { cause?: unknown }).cause;
}

/** Classify rate-limit / overloaded from symbolic error codes like RESOURCE_EXHAUSTED. */
function classifyFailoverReasonFromSymbolicCode(raw: string | undefined): FailoverReason | null {
  const normalized = raw?.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  switch (normalized) {
    case "RESOURCE_EXHAUSTED":
    case "RATE_LIMIT":
    case "RATE_LIMITED":
    case "RATE_LIMIT_EXCEEDED":
    case "TOO_MANY_REQUESTS":
    case "THROTTLED":
    case "THROTTLING":
    case "THROTTLINGEXCEPTION":
    case "THROTTLING_EXCEPTION":
      return "rate_limit";
    case "OVERLOADED":
    case "OVERLOADED_ERROR":
      return "overloaded";
    default:
      return null;
  }
}

function hasTimeoutHint(err: unknown): boolean {
  if (!err) {
    return false;
  }
  if (readErrorName(err) === "TimeoutError") {
    return true;
  }
  const message = getErrorMessage(err);
  return Boolean(message && isTimeoutErrorMessage(message));
}

export function isTimeoutError(err: unknown): boolean {
  if (hasTimeoutHint(err)) {
    return true;
  }
  if (!err || typeof err !== "object") {
    return false;
  }
  if (readErrorName(err) !== "AbortError") {
    return false;
  }
  const message = getErrorMessage(err);
  if (message && ABORT_TIMEOUT_RE.test(message)) {
    return true;
  }
  const cause = "cause" in err ? (err as { cause?: unknown }).cause : undefined;
  const reason = "reason" in err ? (err as { reason?: unknown }).reason : undefined;
  return hasTimeoutHint(cause) || hasTimeoutHint(reason);
}

export function resolveFailoverReasonFromError(err: unknown): FailoverReason | null {
  if (isFailoverError(err)) {
    return err.reason;
  }

  const status = getStatusCode(err);
  const message = getErrorMessage(err);
  const statusReason = classifyFailoverReasonFromHttpStatus(status, message);
  if (statusReason) {
    return statusReason;
  }

  // Check symbolic error codes (e.g. RESOURCE_EXHAUSTED from Google APIs)
  const symbolicCodeReason = classifyFailoverReasonFromSymbolicCode(getErrorCode(err));
  if (symbolicCodeReason) {
    return symbolicCodeReason;
  }

  const code = (getErrorCode(err) ?? "").toUpperCase();
  if (
    [
      "ETIMEDOUT",
      "ESOCKETTIMEDOUT",
      "ECONNRESET",
      "ECONNABORTED",
      "ECONNREFUSED",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "EHOSTDOWN",
      "ENETRESET",
      "EPIPE",
      "EAI_AGAIN",
    ].includes(code)
  ) {
    return "timeout";
  }
  // Walk into error cause chain *before* timeout heuristics so that a specific
  // cause (e.g. RESOURCE_EXHAUSTED wrapped in AbortError) overrides a parent
  // message-based "timeout" guess from isTimeoutError.
  const cause = getErrorCause(err);
  if (cause && cause !== err) {
    const causeReason = resolveFailoverReasonFromError(cause);
    if (causeReason) {
      return causeReason;
    }
  }
  if (isTimeoutError(err)) {
    return "timeout";
  }
  if (!message) {
    return null;
  }
  return classifyFailoverReason(message);
}

export function describeFailoverError(err: unknown): {
  message: string;
  reason?: FailoverReason;
  status?: number;
  code?: string;
  retryAfterMs?: number;
  availableAtMs?: number;
  rateLimitSeverity?: RateLimitSeverity;
} {
  if (isFailoverError(err)) {
    return {
      message: err.message,
      reason: err.reason,
      status: err.status,
      code: err.code,
      retryAfterMs: err.retryAfterMs,
      availableAtMs: err.availableAtMs,
      rateLimitSeverity: err.rateLimitSeverity,
    };
  }
  const message = getErrorMessage(err) || String(err);
  return {
    message,
    reason: resolveFailoverReasonFromError(err) ?? undefined,
    status: getStatusCode(err),
    code: getErrorCode(err),
  };
}

export function coerceToFailoverError(
  err: unknown,
  context?: {
    provider?: string;
    model?: string;
    profileId?: string;
  },
): FailoverError | null {
  if (isFailoverError(err)) {
    return err;
  }
  const reason = resolveFailoverReasonFromError(err);
  if (!reason) {
    return null;
  }

  const message = getErrorMessage(err) || String(err);
  const status = getStatusCode(err) ?? resolveFailoverStatus(reason);
  const code = getErrorCode(err);
  const anthropicRateLimitHint =
    reason === "rate_limit" && context?.provider === "anthropic"
      ? parseAnthropicRateLimitHint({ message, status })
      : null;

  return new FailoverError(message, {
    reason,
    provider: context?.provider,
    model: context?.model,
    profileId: context?.profileId,
    status,
    code,
    retryAfterMs: anthropicRateLimitHint?.retryAfterMs,
    availableAtMs: anthropicRateLimitHint?.availableAtMs,
    rateLimitSeverity: anthropicRateLimitHint?.severity,
    cause: err instanceof Error ? err : undefined,
  });
}
