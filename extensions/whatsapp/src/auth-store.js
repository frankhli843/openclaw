// extensions/whatsapp/src/auth-store.ts
import fsSync3 from "node:fs";
import fs13 from "node:fs/promises";
import path22 from "node:path";
// src/cli/cli-name.ts
import path from "node:path";
var DEFAULT_CLI_NAME = "openclaw";
var KNOWN_CLI_NAMES = /* @__PURE__ */ new Set([DEFAULT_CLI_NAME]);
var CLI_PREFIX_RE = /^(?:((?:pnpm|npm|bunx|npx)\s+))?(openclaw)\b/;
function resolveCliName(argv = process.argv) {
  const argv1 = argv[1];
  if (!argv1) {
    return DEFAULT_CLI_NAME;
  }
  const base = path.basename(argv1).trim();
  if (KNOWN_CLI_NAMES.has(base)) {
    return base;
  }
  return DEFAULT_CLI_NAME;
}
function replaceCliName(command, cliName = resolveCliName()) {
  if (!command.trim()) {
    return command;
  }
  if (!CLI_PREFIX_RE.test(command)) {
    return command;
  }
  return command.replace(CLI_PREFIX_RE, (_match, runner) => {
    return `${runner ?? ""}${cliName}`;
  });
}

// src/cli/profile-utils.ts
var PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
function isValidProfileName(value) {
  if (!value) {
    return false;
  }
  return PROFILE_NAME_RE.test(value);
}
function normalizeProfileName(raw) {
  const profile = raw?.trim();
  if (!profile) {
    return null;
  }
  if (profile.toLowerCase() === "default") {
    return null;
  }
  if (!isValidProfileName(profile)) {
    return null;
  }
  return profile;
}

// src/cli/command-format.ts
var CLI_PREFIX_RE2 = /^(?:pnpm|npm|bunx|npx)\s+openclaw\b|^openclaw\b/;
var CONTAINER_FLAG_RE = /(?:^|\s)--container(?:\s|=|$)/;
var PROFILE_FLAG_RE = /(?:^|\s)--profile(?:\s|=|$)/;
var DEV_FLAG_RE = /(?:^|\s)--dev(?:\s|$)/;
var UPDATE_COMMAND_RE =
  /^(?:pnpm|npm|bunx|npx)\s+openclaw\b.*(?:^|\s)update(?:\s|$)|^openclaw\b.*(?:^|\s)update(?:\s|$)/;
function formatCliCommand(command, env = process.env) {
  const cliName = resolveCliName();
  const normalizedCommand = replaceCliName(command, cliName);
  const container = env.OPENCLAW_CONTAINER_HINT?.trim();
  const profile = normalizeProfileName(env.OPENCLAW_PROFILE);
  if (!container && !profile) {
    return normalizedCommand;
  }
  if (!CLI_PREFIX_RE2.test(normalizedCommand)) {
    return normalizedCommand;
  }
  const additions = [];
  if (
    container &&
    !CONTAINER_FLAG_RE.test(normalizedCommand) &&
    !UPDATE_COMMAND_RE.test(normalizedCommand)
  ) {
    additions.push(`--container ${container}`);
  }
  if (
    !container &&
    profile &&
    !PROFILE_FLAG_RE.test(normalizedCommand) &&
    !DEV_FLAG_RE.test(normalizedCommand)
  ) {
    additions.push(`--profile ${profile}`);
  }
  if (additions.length === 0) {
    return normalizedCommand;
  }
  return normalizedCommand.replace(CLI_PREFIX_RE2, (match) => `${match} ${additions.join(" ")}`);
}

// src/cli/parse-duration.ts
var DURATION_MULTIPLIERS = {
  ms: 1,
  s: 1e3,
  m: 6e4,
  h: 36e5,
  d: 864e5,
};
function parseDurationMs(raw, opts) {
  const trimmed = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!trimmed) {
    throw new Error("invalid duration (empty)");
  }
  const single = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(trimmed);
  if (single) {
    const value = Number(single[1]);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`invalid duration: ${raw}`);
    }
    const unit = single[2] ?? opts?.defaultUnit ?? "ms";
    const ms2 = Math.round(value * DURATION_MULTIPLIERS[unit]);
    if (!Number.isFinite(ms2)) {
      throw new Error(`invalid duration: ${raw}`);
    }
    return ms2;
  }
  let totalMs = 0;
  let consumed = 0;
  const tokenRe = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/g;
  for (const match of trimmed.matchAll(tokenRe)) {
    const [full, valueRaw, unitRaw] = match;
    const index = match.index ?? -1;
    if (!full || !valueRaw || !unitRaw || index < 0) {
      throw new Error(`invalid duration: ${raw}`);
    }
    if (index !== consumed) {
      throw new Error(`invalid duration: ${raw}`);
    }
    const value = Number(valueRaw);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`invalid duration: ${raw}`);
    }
    const multiplier = DURATION_MULTIPLIERS[unitRaw];
    if (!multiplier) {
      throw new Error(`invalid duration: ${raw}`);
    }
    totalMs += value * multiplier;
    consumed += full.length;
  }
  if (consumed !== trimmed.length || consumed === 0) {
    throw new Error(`invalid duration: ${raw}`);
  }
  const ms = Math.round(totalMs);
  if (!Number.isFinite(ms)) {
    throw new Error(`invalid duration: ${raw}`);
  }
  return ms;
}

// src/terminal/theme.ts
import chalk, { Chalk } from "chalk";

// src/terminal/palette.ts
var LOBSTER_PALETTE = {
  accent: "#FF5A2D",
  accentBright: "#FF7A3D",
  accentDim: "#D14A22",
  info: "#FF8A5B",
  success: "#2FBF71",
  warn: "#FFB020",
  error: "#E23D2D",
  muted: "#8B7F77",
};

// src/terminal/theme.ts
var hasForceColor =
  typeof process.env.FORCE_COLOR === "string" &&
  process.env.FORCE_COLOR.trim().length > 0 &&
  process.env.FORCE_COLOR.trim() !== "0";
var baseChalk = process.env.NO_COLOR && !hasForceColor ? new Chalk({ level: 0 }) : chalk;
var hex = (value) => baseChalk.hex(value);
var theme = {
  accent: hex(LOBSTER_PALETTE.accent),
  accentBright: hex(LOBSTER_PALETTE.accentBright),
  accentDim: hex(LOBSTER_PALETTE.accentDim),
  info: hex(LOBSTER_PALETTE.info),
  success: hex(LOBSTER_PALETTE.success),
  warn: hex(LOBSTER_PALETTE.warn),
  error: hex(LOBSTER_PALETTE.error),
  muted: hex(LOBSTER_PALETTE.muted),
  heading: baseChalk.bold.hex(LOBSTER_PALETTE.accent),
  command: hex(LOBSTER_PALETTE.accentBright),
  option: hex(LOBSTER_PALETTE.warn),
};

// src/version.ts
import { createRequire } from "node:module";
var CORE_PACKAGE_NAME = "openclaw";
var PACKAGE_JSON_CANDIDATES = [
  "../package.json",
  "../../package.json",
  "../../../package.json",
  "./package.json",
];
var BUILD_INFO_CANDIDATES = ["../build-info.json", "../../build-info.json", "./build-info.json"];
function readVersionFromJsonCandidates(moduleUrl, candidates, opts = {}) {
  try {
    const require4 = createRequire(moduleUrl);
    for (const candidate of candidates) {
      try {
        const parsed = require4(candidate);
        const version = parsed.version?.trim();
        if (!version) {
          continue;
        }
        if (opts.requirePackageName && parsed.name !== CORE_PACKAGE_NAME) {
          continue;
        }
        return version;
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
}
function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return void 0;
}
function readVersionFromPackageJsonForModuleUrl(moduleUrl) {
  return readVersionFromJsonCandidates(moduleUrl, PACKAGE_JSON_CANDIDATES, {
    requirePackageName: true,
  });
}
function readVersionFromBuildInfoForModuleUrl(moduleUrl) {
  return readVersionFromJsonCandidates(moduleUrl, BUILD_INFO_CANDIDATES);
}
function resolveVersionFromModuleUrl(moduleUrl) {
  return (
    readVersionFromPackageJsonForModuleUrl(moduleUrl) ||
    readVersionFromBuildInfoForModuleUrl(moduleUrl)
  );
}
function resolveBinaryVersion(params) {
  return (
    firstNonEmpty(params.injectedVersion) ||
    resolveVersionFromModuleUrl(params.moduleUrl) ||
    firstNonEmpty(params.bundledVersion) ||
    params.fallback ||
    "0.0.0"
  );
}
var VERSION = resolveBinaryVersion({
  moduleUrl: import.meta.url,
  injectedVersion: typeof __OPENCLAW_VERSION__ === "string" ? __OPENCLAW_VERSION__ : void 0,
  bundledVersion: process.env.OPENCLAW_BUNDLED_VERSION,
});

// src/config/paths.ts
import fs from "node:fs";
import os2 from "node:os";
// src/infra/home-dir.ts
import os from "node:os";
import path3 from "node:path";
import path2 from "node:path";
function normalize(value) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return void 0;
  }
  if (trimmed === "undefined" || trimmed === "null") {
    return void 0;
  }
  return trimmed;
}
function resolveEffectiveHomeDir(env = process.env, homedir = os.homedir) {
  const raw = resolveRawHomeDir(env, homedir);
  return raw ? path2.resolve(raw) : void 0;
}
function resolveRawHomeDir(env, homedir) {
  const explicitHome = normalize(env.OPENCLAW_HOME);
  if (explicitHome) {
    if (explicitHome === "~" || explicitHome.startsWith("~/") || explicitHome.startsWith("~\\")) {
      const fallbackHome = resolveRawOsHomeDir(env, homedir);
      if (fallbackHome) {
        return explicitHome.replace(/^~(?=$|[\\/])/, fallbackHome);
      }
      return void 0;
    }
    return explicitHome;
  }
  return resolveRawOsHomeDir(env, homedir);
}
function resolveRawOsHomeDir(env, homedir) {
  const envHome = normalize(env.HOME);
  if (envHome) {
    return envHome;
  }
  const userProfile = normalize(env.USERPROFILE);
  if (userProfile) {
    return userProfile;
  }
  return normalizeSafe(homedir);
}
function normalizeSafe(homedir) {
  try {
    return normalize(homedir());
  } catch {
    return void 0;
  }
}
function resolveRequiredHomeDir(env = process.env, homedir = os.homedir) {
  return resolveEffectiveHomeDir(env, homedir) ?? path2.resolve(process.cwd());
}
function expandHomePrefix(input, opts) {
  if (!input.startsWith("~")) {
    return input;
  }
  const home =
    normalize(opts?.home) ??
    resolveEffectiveHomeDir(opts?.env ?? process.env, opts?.homedir ?? os.homedir);
  if (!home) {
    return input;
  }
  return input.replace(/^~(?=$|[\\/])/, home);
}
function resolveHomeRelativePath(input, opts) {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.startsWith("~")) {
    const expanded = expandHomePrefix(trimmed, {
      home: resolveRequiredHomeDir(opts?.env ?? process.env, opts?.homedir ?? os.homedir),
      env: opts?.env,
      homedir: opts?.homedir,
    });
    return path2.resolve(expanded);
  }
  return path2.resolve(trimmed);
}

// src/config/paths.ts
function resolveIsNixMode(env = process.env) {
  return env.OPENCLAW_NIX_MODE === "1";
}
var isNixMode = resolveIsNixMode();
var LEGACY_STATE_DIRNAMES = [".clawdbot"];
var NEW_STATE_DIRNAME = ".openclaw";
var CONFIG_FILENAME = "openclaw.json";
var LEGACY_CONFIG_FILENAMES = ["clawdbot.json"];
function resolveDefaultHomeDir() {
  return resolveRequiredHomeDir(process.env, os2.homedir);
}
function envHomedir(env) {
  return () => resolveRequiredHomeDir(env, os2.homedir);
}
function legacyStateDirs(homedir = resolveDefaultHomeDir) {
  return LEGACY_STATE_DIRNAMES.map((dir) => path3.join(homedir(), dir));
}
function newStateDir(homedir = resolveDefaultHomeDir) {
  return path3.join(homedir(), NEW_STATE_DIRNAME);
}
function resolveStateDir(env = process.env, homedir = envHomedir(env)) {
  const effectiveHomedir = () => resolveRequiredHomeDir(env, homedir);
  const override = env.OPENCLAW_STATE_DIR?.trim();
  if (override) {
    return resolveUserPath(override, env, effectiveHomedir);
  }
  const newDir = newStateDir(effectiveHomedir);
  if (env.OPENCLAW_TEST_FAST === "1") {
    return newDir;
  }
  const legacyDirs = legacyStateDirs(effectiveHomedir);
  const hasNew = fs.existsSync(newDir);
  if (hasNew) {
    return newDir;
  }
  const existingLegacy = legacyDirs.find((dir) => {
    try {
      return fs.existsSync(dir);
    } catch {
      return false;
    }
  });
  if (existingLegacy) {
    return existingLegacy;
  }
  return newDir;
}
function resolveUserPath(input, env = process.env, homedir = envHomedir(env)) {
  return resolveHomeRelativePath(input, { env, homedir });
}
var STATE_DIR = resolveStateDir();
function resolveCanonicalConfigPath(
  env = process.env,
  stateDir = resolveStateDir(env, envHomedir(env)),
) {
  const override = env.OPENCLAW_CONFIG_PATH?.trim();
  if (override) {
    return resolveUserPath(override, env, envHomedir(env));
  }
  return path3.join(stateDir, CONFIG_FILENAME);
}
function resolveConfigPathCandidate(env = process.env, homedir = envHomedir(env)) {
  if (env.OPENCLAW_TEST_FAST === "1") {
    return resolveCanonicalConfigPath(env, resolveStateDir(env, homedir));
  }
  const candidates = resolveDefaultConfigCandidates(env, homedir);
  const existing = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
  if (existing) {
    return existing;
  }
  return resolveCanonicalConfigPath(env, resolveStateDir(env, homedir));
}
var CONFIG_PATH = resolveConfigPathCandidate();
function resolveDefaultConfigCandidates(env = process.env, homedir = envHomedir(env)) {
  const effectiveHomedir = () => resolveRequiredHomeDir(env, homedir);
  const explicit = env.OPENCLAW_CONFIG_PATH?.trim();
  if (explicit) {
    return [resolveUserPath(explicit, env, effectiveHomedir)];
  }
  const candidates = [];
  const openclawStateDir = env.OPENCLAW_STATE_DIR?.trim();
  if (openclawStateDir) {
    const resolved = resolveUserPath(openclawStateDir, env, effectiveHomedir);
    candidates.push(path3.join(resolved, CONFIG_FILENAME));
    candidates.push(...LEGACY_CONFIG_FILENAMES.map((name) => path3.join(resolved, name)));
  }
  const defaultDirs = [newStateDir(effectiveHomedir), ...legacyStateDirs(effectiveHomedir)];
  for (const dir of defaultDirs) {
    candidates.push(path3.join(dir, CONFIG_FILENAME));
    candidates.push(...LEGACY_CONFIG_FILENAMES.map((name) => path3.join(dir, name)));
  }
  return candidates;
}
var DEFAULT_GATEWAY_PORT = 18789;
function resolveOAuthDir(env = process.env, stateDir = resolveStateDir(env, envHomedir(env))) {
  const override = env.OPENCLAW_OAUTH_DIR?.trim();
  if (override) {
    return resolveUserPath(override, env, envHomedir(env));
  }
  return path3.join(stateDir, "credentials");
}

// src/logging/subsystem.ts
import { Chalk as Chalk2 } from "chalk";

// src/global-state.ts
var globalVerbose = false;
function isVerbose() {
  return globalVerbose;
}

// src/terminal/progress-line.ts
var activeStream = null;
function clearActiveProgressLine() {
  if (!activeStream?.isTTY) {
    return;
  }
  activeStream.write("\r\x1B[2K");
}

// src/terminal/restore.ts
var RESET_SEQUENCE = "\x1B[0m\x1B[?25h\x1B[?1000l\x1B[?1002l\x1B[?1003l\x1B[?1006l\x1B[?2004l";
function reportRestoreFailure(scope, err, reason) {
  const suffix = reason ? ` (${reason})` : "";
  const message = `[terminal] restore ${scope} failed${suffix}: ${String(err)}`;
  try {
    process.stderr.write(`${message}
`);
  } catch (writeErr) {
    console.error(`[terminal] restore reporting failed${suffix}: ${String(writeErr)}`);
  }
}
function restoreTerminalState(reason, options = {}) {
  const resumeStdin = options.resumeStdinIfPaused ?? options.resumeStdin ?? false;
  try {
    clearActiveProgressLine();
  } catch (err) {
    reportRestoreFailure("progress line", err, reason);
  }
  const stdin = process.stdin;
  if (stdin.isTTY && typeof stdin.setRawMode === "function") {
    try {
      stdin.setRawMode(false);
    } catch (err) {
      reportRestoreFailure("raw mode", err, reason);
    }
    if (resumeStdin && typeof stdin.isPaused === "function" && stdin.isPaused()) {
      try {
        stdin.resume();
      } catch (err) {
        reportRestoreFailure("stdin resume", err, reason);
      }
    }
  }
  if (process.stdout.isTTY) {
    try {
      process.stdout.write(RESET_SEQUENCE);
    } catch (err) {
      reportRestoreFailure("stdout reset", err, reason);
    }
  }
}

// src/runtime.ts
function shouldEmitRuntimeLog(env = process.env) {
  if (env.VITEST !== "true") {
    return true;
  }
  if (env.OPENCLAW_TEST_RUNTIME_LOG === "1") {
    return true;
  }
  const maybeMockedLog = console.log;
  return typeof maybeMockedLog.mock === "object";
}
function shouldEmitRuntimeStdout(env = process.env) {
  if (env.VITEST !== "true") {
    return true;
  }
  if (env.OPENCLAW_TEST_RUNTIME_LOG === "1") {
    return true;
  }
  const stdout = process.stdout;
  return typeof stdout.write.mock === "object";
}
function isPipeClosedError(err) {
  const code = err?.code;
  return code === "EPIPE" || code === "EIO";
}
function writeStdout(value) {
  if (!shouldEmitRuntimeStdout()) {
    return;
  }
  clearActiveProgressLine();
  const line = value.endsWith("\n")
    ? value
    : `${value}
`;
  try {
    process.stdout.write(line);
  } catch (err) {
    if (isPipeClosedError(err)) {
      return;
    }
    throw err;
  }
}
function createRuntimeIo() {
  return {
    log: (...args) => {
      if (!shouldEmitRuntimeLog()) {
        return;
      }
      clearActiveProgressLine();
      console.log(...args);
    },
    error: (...args) => {
      clearActiveProgressLine();
      console.error(...args);
    },
    writeStdout,
    writeJson: (value, space = 2) => {
      writeStdout(JSON.stringify(value, null, space > 0 ? space : void 0));
    },
  };
}
var defaultRuntime = {
  ...createRuntimeIo(),
  exit: (code) => {
    restoreTerminalState("runtime exit", { resumeStdinIfPaused: false });
    process.exit(code);
    throw new Error("unreachable");
  },
};

// src/terminal/ansi.ts
var ANSI_CSI_PATTERN = "\\x1b\\[[\\x20-\\x3f]*[\\x40-\\x7e]";
var OSC8_PATTERN = "\\x1b\\]8;;.*?\\x1b\\\\|\\x1b\\]8;;\\x1b\\\\";
var ANSI_CSI_REGEX = new RegExp(ANSI_CSI_PATTERN, "g");
var OSC8_REGEX = new RegExp(OSC8_PATTERN, "g");
var graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(void 0, { granularity: "grapheme" })
    : null;

// src/infra/cli-root-options.ts
var FLAG_TERMINATOR = "--";
var ROOT_BOOLEAN_FLAGS = /* @__PURE__ */ new Set(["--dev", "--no-color"]);
var ROOT_VALUE_FLAGS = /* @__PURE__ */ new Set(["--profile", "--log-level", "--container"]);
function isValueToken(arg) {
  if (!arg || arg === FLAG_TERMINATOR) {
    return false;
  }
  if (!arg.startsWith("-")) {
    return true;
  }
  return /^-\d+(?:\.\d+)?$/.test(arg);
}
function consumeRootOptionToken(args, index) {
  const arg = args[index];
  if (!arg) {
    return 0;
  }
  if (ROOT_BOOLEAN_FLAGS.has(arg)) {
    return 1;
  }
  if (
    arg.startsWith("--profile=") ||
    arg.startsWith("--log-level=") ||
    arg.startsWith("--container=")
  ) {
    return 1;
  }
  if (ROOT_VALUE_FLAGS.has(arg)) {
    return isValueToken(args[index + 1]) ? 2 : 1;
  }
  return 0;
}

// src/cli/argv.ts
function getCommandPathWithRootOptions(argv, depth = 2) {
  return getCommandPathInternal(argv, depth, { skipRootOptions: true });
}
function getCommandPathInternal(argv, depth, opts) {
  const args = argv.slice(2);
  const path23 = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) {
      continue;
    }
    if (arg === "--") {
      break;
    }
    if (opts.skipRootOptions) {
      const consumed = consumeRootOptionToken(args, i);
      if (consumed > 0) {
        i += consumed - 1;
        continue;
      }
    }
    if (arg.startsWith("-")) {
      continue;
    }
    path23.push(arg);
    if (path23.length >= depth) {
      break;
    }
  }
  return path23;
}

// src/logging/node-require.ts
function resolveNodeRequireFromMeta(metaUrl) {
  const getBuiltinModule = process.getBuiltinModule;
  if (typeof getBuiltinModule !== "function") {
    return null;
  }
  try {
    const moduleNamespace = getBuiltinModule("module");
    const createRequire4 =
      typeof moduleNamespace.createRequire === "function" ? moduleNamespace.createRequire : null;
    return createRequire4 ? createRequire4(metaUrl) : null;
  } catch {
    return null;
  }
}

// src/logging/config.ts
var requireConfig = resolveNodeRequireFromMeta(import.meta.url);
function shouldSkipMutatingLoggingConfigRead(argv = process.argv) {
  const [primary, secondary] = getCommandPathWithRootOptions(argv, 2);
  return primary === "config" && (secondary === "schema" || secondary === "validate");
}
function readLoggingConfig() {
  if (shouldSkipMutatingLoggingConfigRead()) {
    return void 0;
  }
  try {
    const loaded = requireConfig?.("../config/config.js");
    const parsed = loaded?.loadConfig?.();
    const logging = parsed?.logging;
    if (!logging || typeof logging !== "object" || Array.isArray(logging)) {
      return void 0;
    }
    return logging;
  } catch {
    return void 0;
  }
}

// src/logging/levels.ts
var ALLOWED_LOG_LEVELS = ["silent", "fatal", "error", "warn", "info", "debug", "trace"];
function tryParseLogLevel(level) {
  if (typeof level !== "string") {
    return void 0;
  }
  const candidate = level.trim();
  return ALLOWED_LOG_LEVELS.includes(candidate) ? candidate : void 0;
}
function normalizeLogLevel(level, fallback = "info") {
  return tryParseLogLevel(level) ?? fallback;
}
function levelToMinLevel(level) {
  const map = {
    fatal: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
    trace: 5,
    silent: Number.POSITIVE_INFINITY,
  };
  return map[level];
}

// src/logging/state.ts
var loggingState = {
  cachedLogger: null,
  cachedSettings: null,
  cachedConsoleSettings: null,
  overrideSettings: null,
  invalidEnvLogLevelValue: null,
  consolePatched: false,
  forceConsoleToStderr: false,
  consoleTimestampPrefix: false,
  consoleSubsystemFilter: null,
  resolvingConsoleSettings: false,
  streamErrorHandlersInstalled: false,
  rawConsole: null,
};

// src/logging/env-log-level.ts
function resolveEnvLogLevelOverride() {
  const raw = process.env.OPENCLAW_LOG_LEVEL;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) {
    loggingState.invalidEnvLogLevelValue = null;
    return void 0;
  }
  const parsed = tryParseLogLevel(trimmed);
  if (parsed) {
    loggingState.invalidEnvLogLevelValue = null;
    return parsed;
  }
  if (loggingState.invalidEnvLogLevelValue !== trimmed) {
    loggingState.invalidEnvLogLevelValue = trimmed;
    process.stderr.write(
      `[openclaw] Ignoring invalid OPENCLAW_LOG_LEVEL="${trimmed}" (allowed: ${ALLOWED_LOG_LEVELS.join("|")}).
`,
    );
  }
  return void 0;
}

// src/logging/logger.ts
import fs3 from "node:fs";
// src/infra/tmp-openclaw-dir.ts
import fs2 from "node:fs";
import { tmpdir as getOsTmpDir } from "node:os";
import path5 from "node:path";
import path4 from "node:path";
import { Logger as TsLogger } from "tslog";
var POSIX_OPENCLAW_TMP_DIR = "/tmp/openclaw";
var TMP_DIR_ACCESS_MODE = fs2.constants.W_OK | fs2.constants.X_OK;
function isNodeErrorWithCode(err, code) {
  return typeof err === "object" && err !== null && "code" in err && err.code === code;
}
function resolvePreferredOpenClawTmpDir(options = {}) {
  const accessSync = options.accessSync ?? fs2.accessSync;
  const chmodSync = options.chmodSync ?? fs2.chmodSync;
  const lstatSync = options.lstatSync ?? fs2.lstatSync;
  const mkdirSync = options.mkdirSync ?? fs2.mkdirSync;
  const warn3 = options.warn ?? ((message) => console.warn(message));
  const getuid =
    options.getuid ??
    (() => {
      try {
        return typeof process.getuid === "function" ? process.getuid() : void 0;
      } catch {
        return void 0;
      }
    });
  const tmpdir = typeof options.tmpdir === "function" ? options.tmpdir : getOsTmpDir;
  const uid = getuid();
  const isSecureDirForUser = (st) => {
    if (uid === void 0) {
      return true;
    }
    if (typeof st.uid === "number" && st.uid !== uid) {
      return false;
    }
    if (typeof st.mode === "number" && (st.mode & 18) !== 0) {
      return false;
    }
    return true;
  };
  const fallback = () => {
    const base = tmpdir();
    const suffix = uid === void 0 ? "openclaw" : `openclaw-${uid}`;
    return path4.join(base, suffix);
  };
  const isTrustedTmpDir = (st) => {
    return st.isDirectory() && !st.isSymbolicLink() && isSecureDirForUser(st);
  };
  const resolveDirState = (candidatePath) => {
    try {
      const candidate = lstatSync(candidatePath);
      if (!isTrustedTmpDir(candidate)) {
        return "invalid";
      }
      accessSync(candidatePath, TMP_DIR_ACCESS_MODE);
      return "available";
    } catch (err) {
      if (isNodeErrorWithCode(err, "ENOENT")) {
        return "missing";
      }
      return "invalid";
    }
  };
  const tryRepairWritableBits = (candidatePath) => {
    try {
      const st = lstatSync(candidatePath);
      if (!st.isDirectory() || st.isSymbolicLink()) {
        return false;
      }
      if (uid !== void 0 && typeof st.uid === "number" && st.uid !== uid) {
        return false;
      }
      if (typeof st.mode !== "number" || (st.mode & 18) === 0) {
        return false;
      }
      chmodSync(candidatePath, 448);
      warn3(`[openclaw] tightened permissions on temp dir: ${candidatePath}`);
      return resolveDirState(candidatePath) === "available";
    } catch {
      return false;
    }
  };
  const ensureTrustedFallbackDir = () => {
    const fallbackPath = fallback();
    const state2 = resolveDirState(fallbackPath);
    if (state2 === "available") {
      return fallbackPath;
    }
    if (state2 === "invalid") {
      if (tryRepairWritableBits(fallbackPath)) {
        return fallbackPath;
      }
      throw new Error(`Unsafe fallback OpenClaw temp dir: ${fallbackPath}`);
    }
    try {
      mkdirSync(fallbackPath, { recursive: true, mode: 448 });
      chmodSync(fallbackPath, 448);
    } catch {
      throw new Error(`Unable to create fallback OpenClaw temp dir: ${fallbackPath}`);
    }
    if (resolveDirState(fallbackPath) !== "available" && !tryRepairWritableBits(fallbackPath)) {
      throw new Error(`Unsafe fallback OpenClaw temp dir: ${fallbackPath}`);
    }
    return fallbackPath;
  };
  const existingPreferredState = resolveDirState(POSIX_OPENCLAW_TMP_DIR);
  if (existingPreferredState === "available") {
    return POSIX_OPENCLAW_TMP_DIR;
  }
  if (existingPreferredState === "invalid") {
    if (tryRepairWritableBits(POSIX_OPENCLAW_TMP_DIR)) {
      return POSIX_OPENCLAW_TMP_DIR;
    }
    return ensureTrustedFallbackDir();
  }
  try {
    accessSync("/tmp", TMP_DIR_ACCESS_MODE);
    mkdirSync(POSIX_OPENCLAW_TMP_DIR, { recursive: true, mode: 448 });
    chmodSync(POSIX_OPENCLAW_TMP_DIR, 448);
    if (
      resolveDirState(POSIX_OPENCLAW_TMP_DIR) !== "available" &&
      !tryRepairWritableBits(POSIX_OPENCLAW_TMP_DIR)
    ) {
      return ensureTrustedFallbackDir();
    }
    return POSIX_OPENCLAW_TMP_DIR;
  } catch {
    return ensureTrustedFallbackDir();
  }
}

// src/logging/timestamps.ts
function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
function resolveEffectiveTimeZone(timeZone) {
  const explicit = timeZone ?? process.env.TZ;
  return explicit && isValidTimeZone(explicit)
    ? explicit
    : Intl.DateTimeFormat().resolvedOptions().timeZone;
}
function formatOffset(offsetRaw) {
  return offsetRaw === "GMT" ? "+00:00" : offsetRaw.slice(3);
}
function getTimestampParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en", {
    timeZone: resolveEffectiveTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    fractionalSecondDigits: 3,
    timeZoneName: "longOffset",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    fractionalSecond: parts.fractionalSecond,
    offset: formatOffset(parts.timeZoneName ?? "GMT"),
  };
}
function formatTimestamp(date, options) {
  const style = options?.style ?? "medium";
  const parts = getTimestampParts(date, options?.timeZone);
  switch (style) {
    case "short":
      return `${parts.hour}:${parts.minute}:${parts.second}${parts.offset}`;
    case "medium":
      return `${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}${parts.offset}`;
    case "long":
      return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}${parts.offset}`;
  }
}
function formatLocalIsoWithOffset(now, timeZone) {
  return formatTimestamp(now, { style: "long", timeZone });
}

// src/logging/logger.ts
function canUseNodeFs() {
  const getBuiltinModule = process.getBuiltinModule;
  if (typeof getBuiltinModule !== "function") {
    return false;
  }
  try {
    return getBuiltinModule("fs") !== void 0;
  } catch {
    return false;
  }
}
function resolveDefaultLogDir() {
  return canUseNodeFs() ? resolvePreferredOpenClawTmpDir() : POSIX_OPENCLAW_TMP_DIR;
}
function resolveDefaultLogFile(defaultLogDir) {
  return canUseNodeFs()
    ? path5.join(defaultLogDir, "openclaw.log")
    : `${POSIX_OPENCLAW_TMP_DIR}/openclaw.log`;
}
var DEFAULT_LOG_DIR = resolveDefaultLogDir();
var DEFAULT_LOG_FILE = resolveDefaultLogFile(DEFAULT_LOG_DIR);
var LOG_PREFIX = "openclaw";
var LOG_SUFFIX = ".log";
var MAX_LOG_AGE_MS = 24 * 60 * 60 * 1e3;
var DEFAULT_MAX_LOG_FILE_BYTES = 500 * 1024 * 1024;
var requireConfig2 = resolveNodeRequireFromMeta(import.meta.url);
var externalTransports = /* @__PURE__ */ new Set();
function attachExternalTransport(logger, transport) {
  logger.attachTransport((logObj) => {
    if (!externalTransports.has(transport)) {
      return;
    }
    try {
      transport(logObj);
    } catch {}
  });
}
function canUseSilentVitestFileLogFastPath(envLevel) {
  return (
    process.env.VITEST === "true" &&
    process.env.OPENCLAW_TEST_FILE_LOG !== "1" &&
    !envLevel &&
    !loggingState.overrideSettings
  );
}
function resolveSettings() {
  if (!canUseNodeFs()) {
    return {
      level: "silent",
      file: DEFAULT_LOG_FILE,
      maxFileBytes: DEFAULT_MAX_LOG_FILE_BYTES,
    };
  }
  const envLevel = resolveEnvLogLevelOverride();
  if (canUseSilentVitestFileLogFastPath(envLevel)) {
    return {
      level: "silent",
      file: defaultRollingPathForToday(),
      maxFileBytes: DEFAULT_MAX_LOG_FILE_BYTES,
    };
  }
  let cfg = loggingState.overrideSettings ?? readLoggingConfig();
  if (!cfg && !shouldSkipMutatingLoggingConfigRead()) {
    try {
      const loaded = requireConfig2?.("../config/config.js");
      cfg = loaded?.loadConfig?.().logging;
    } catch {
      cfg = void 0;
    }
  }
  const defaultLevel =
    process.env.VITEST === "true" && process.env.OPENCLAW_TEST_FILE_LOG !== "1" ? "silent" : "info";
  const fromConfig = normalizeLogLevel(cfg?.level, defaultLevel);
  const level = envLevel ?? fromConfig;
  const file = cfg?.file ?? defaultRollingPathForToday();
  const maxFileBytes = resolveMaxLogFileBytes(cfg?.maxFileBytes);
  return { level, file, maxFileBytes };
}
function settingsChanged(a, b) {
  if (!a) {
    return true;
  }
  return a.level !== b.level || a.file !== b.file || a.maxFileBytes !== b.maxFileBytes;
}
function isFileLogLevelEnabled(level) {
  const settings = loggingState.cachedSettings ?? resolveSettings();
  if (!loggingState.cachedSettings) {
    loggingState.cachedSettings = settings;
  }
  if (settings.level === "silent") {
    return false;
  }
  return levelToMinLevel(level) <= levelToMinLevel(settings.level);
}
function buildLogger(settings) {
  const logger = new TsLogger({
    name: "openclaw",
    minLevel: levelToMinLevel(settings.level),
    type: "hidden",
    // no ansi formatting
  });
  if (settings.level === "silent") {
    for (const transport of externalTransports) {
      attachExternalTransport(logger, transport);
    }
    return logger;
  }
  fs3.mkdirSync(path5.dirname(settings.file), { recursive: true });
  if (isRollingPath(settings.file)) {
    pruneOldRollingLogs(path5.dirname(settings.file));
  }
  let currentFileBytes = getCurrentLogFileBytes(settings.file);
  let warnedAboutSizeCap = false;
  logger.attachTransport((logObj) => {
    try {
      const time = formatTimestamp(logObj.date ?? /* @__PURE__ */ new Date(), { style: "long" });
      const line = JSON.stringify({ ...logObj, time });
      const payload = `${line}
`;
      const payloadBytes = Buffer.byteLength(payload, "utf8");
      const nextBytes = currentFileBytes + payloadBytes;
      if (nextBytes > settings.maxFileBytes) {
        if (!warnedAboutSizeCap) {
          warnedAboutSizeCap = true;
          const warningLine = JSON.stringify({
            time: formatTimestamp(/* @__PURE__ */ new Date(), { style: "long" }),
            level: "warn",
            subsystem: "logging",
            message: `log file size cap reached; suppressing writes file=${settings.file} maxFileBytes=${settings.maxFileBytes}`,
          });
          appendLogLine(
            settings.file,
            `${warningLine}
`,
          );
          process.stderr.write(
            `[openclaw] log file size cap reached; suppressing writes file=${settings.file} maxFileBytes=${settings.maxFileBytes}
`,
          );
        }
        return;
      }
      if (appendLogLine(settings.file, payload)) {
        currentFileBytes = nextBytes;
      }
    } catch {}
  });
  for (const transport of externalTransports) {
    attachExternalTransport(logger, transport);
  }
  return logger;
}
function resolveMaxLogFileBytes(raw) {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_MAX_LOG_FILE_BYTES;
}
function getCurrentLogFileBytes(file) {
  try {
    return fs3.statSync(file).size;
  } catch {
    return 0;
  }
}
function appendLogLine(file, line) {
  try {
    fs3.appendFileSync(file, line, { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}
function getLogger() {
  const settings = resolveSettings();
  const cachedLogger = loggingState.cachedLogger;
  const cachedSettings = loggingState.cachedSettings;
  if (!cachedLogger || settingsChanged(cachedSettings, settings)) {
    loggingState.cachedLogger = buildLogger(settings);
    loggingState.cachedSettings = settings;
  }
  return loggingState.cachedLogger;
}
function getChildLogger(bindings, opts) {
  const base = getLogger();
  const minLevel = opts?.level ? levelToMinLevel(opts.level) : void 0;
  const name = bindings ? JSON.stringify(bindings) : void 0;
  return base.getSubLogger({
    name,
    minLevel,
    prefix: bindings ? [name ?? ""] : [],
  });
}
function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function defaultRollingPathForToday() {
  const today = formatLocalDate(/* @__PURE__ */ new Date());
  return path5.join(DEFAULT_LOG_DIR, `${LOG_PREFIX}-${today}${LOG_SUFFIX}`);
}
function isRollingPath(file) {
  const base = path5.basename(file);
  return (
    base.startsWith(`${LOG_PREFIX}-`) &&
    base.endsWith(LOG_SUFFIX) &&
    base.length === `${LOG_PREFIX}-YYYY-MM-DD${LOG_SUFFIX}`.length
  );
}
function pruneOldRollingLogs(dir) {
  try {
    const entries = fs3.readdirSync(dir, { withFileTypes: true });
    const cutoff = Date.now() - MAX_LOG_AGE_MS;
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      if (!entry.name.startsWith(`${LOG_PREFIX}-`) || !entry.name.endsWith(LOG_SUFFIX)) {
        continue;
      }
      const fullPath = path5.join(dir, entry.name);
      try {
        const stat = fs3.statSync(fullPath);
        if (stat.mtimeMs < cutoff) {
          fs3.rmSync(fullPath, { force: true });
        }
      } catch {}
    }
  } catch {}
}

// src/logging/console.ts
var requireConfig3 = resolveNodeRequireFromMeta(import.meta.url);
var loadConfigFallbackDefault = () => {
  try {
    const loaded = requireConfig3?.("../config/config.js");
    return loaded?.loadConfig?.().logging;
  } catch {
    return void 0;
  }
};
var loadConfigFallback = loadConfigFallbackDefault;
function normalizeConsoleLevel(level) {
  if (isVerbose()) {
    return "debug";
  }
  if (!level && process.env.VITEST === "true" && process.env.OPENCLAW_TEST_CONSOLE !== "1") {
    return "silent";
  }
  return normalizeLogLevel(level, "info");
}
function normalizeConsoleStyle(style) {
  if (style === "compact" || style === "json" || style === "pretty") {
    return style;
  }
  if (!process.stdout.isTTY) {
    return "compact";
  }
  return "pretty";
}
function resolveConsoleSettings() {
  const envLevel = resolveEnvLogLevelOverride();
  if (
    process.env.VITEST === "true" &&
    process.env.OPENCLAW_TEST_CONSOLE !== "1" &&
    !isVerbose() &&
    !envLevel &&
    !loggingState.overrideSettings
  ) {
    return { level: "silent", style: normalizeConsoleStyle(void 0) };
  }
  let cfg = loggingState.overrideSettings ?? readLoggingConfig();
  if (!cfg && !shouldSkipMutatingLoggingConfigRead()) {
    if (loggingState.resolvingConsoleSettings) {
      cfg = void 0;
    } else {
      loggingState.resolvingConsoleSettings = true;
      try {
        cfg = loadConfigFallback();
      } finally {
        loggingState.resolvingConsoleSettings = false;
      }
    }
  }
  const level = envLevel ?? normalizeConsoleLevel(cfg?.consoleLevel);
  const style = normalizeConsoleStyle(cfg?.consoleStyle);
  return { level, style };
}
function consoleSettingsChanged(a, b) {
  if (!a) {
    return true;
  }
  return a.level !== b.level || a.style !== b.style;
}
function getConsoleSettings() {
  const settings = resolveConsoleSettings();
  const cached = loggingState.cachedConsoleSettings;
  if (!cached || consoleSettingsChanged(cached, settings)) {
    loggingState.cachedConsoleSettings = settings;
  }
  return loggingState.cachedConsoleSettings;
}
function shouldLogSubsystemToConsole(subsystem) {
  const filter = loggingState.consoleSubsystemFilter;
  if (!filter || filter.length === 0) {
    return true;
  }
  return filter.some((prefix) => subsystem === prefix || subsystem.startsWith(`${prefix}/`));
}
function formatConsoleTimestamp(style) {
  const now = /* @__PURE__ */ new Date();
  if (style === "pretty") {
    return formatTimestamp(now, { style: "short" });
  }
  return formatLocalIsoWithOffset(now);
}

// src/logging/subsystem.ts
function shouldLogToConsole(level, settings) {
  if (settings.level === "silent") {
    return false;
  }
  const current = levelToMinLevel(level);
  const min = levelToMinLevel(settings.level);
  return current <= min;
}
var inspectValue = (() => {
  const getBuiltinModule = process.getBuiltinModule;
  if (typeof getBuiltinModule !== "function") {
    return null;
  }
  try {
    const utilNamespace = getBuiltinModule("util");
    return typeof utilNamespace.inspect === "function" ? utilNamespace.inspect : null;
  } catch {
    return null;
  }
})();
function isRichConsoleEnv() {
  const term = (process.env.TERM ?? "").toLowerCase();
  if (process.env.COLORTERM || process.env.TERM_PROGRAM) {
    return true;
  }
  return term.length > 0 && term !== "dumb";
}
function getColorForConsole() {
  const hasForceColor2 =
    typeof process.env.FORCE_COLOR === "string" &&
    process.env.FORCE_COLOR.trim().length > 0 &&
    process.env.FORCE_COLOR.trim() !== "0";
  if (process.env.NO_COLOR && !hasForceColor2) {
    return new Chalk2({ level: 0 });
  }
  const hasTty = Boolean(process.stdout.isTTY || process.stderr.isTTY);
  return hasTty || isRichConsoleEnv() ? new Chalk2({ level: 1 }) : new Chalk2({ level: 0 });
}
var SUBSYSTEM_COLORS = ["cyan", "green", "yellow", "blue", "magenta", "red"];
var SUBSYSTEM_COLOR_OVERRIDES = {
  "gmail-watcher": "blue",
};
var SUBSYSTEM_PREFIXES_TO_DROP = ["gateway", "channels", "providers"];
var SUBSYSTEM_MAX_SEGMENTS = 2;
var CHANNEL_SUBSYSTEM_PREFIXES = /* @__PURE__ */ new Set([
  "telegram",
  "whatsapp",
  "discord",
  "irc",
  "googlechat",
  "slack",
  "signal",
  "imessage",
]);
function pickSubsystemColor(color, subsystem) {
  const override = SUBSYSTEM_COLOR_OVERRIDES[subsystem];
  if (override) {
    return color[override];
  }
  let hash = 0;
  for (let i = 0; i < subsystem.length; i += 1) {
    hash = (hash * 31 + subsystem.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % SUBSYSTEM_COLORS.length;
  const name = SUBSYSTEM_COLORS[idx];
  return color[name];
}
function formatSubsystemForConsole(subsystem) {
  const parts = subsystem.split("/").filter(Boolean);
  const original = parts.join("/") || subsystem;
  while (parts.length > 0 && SUBSYSTEM_PREFIXES_TO_DROP.includes(parts[0])) {
    parts.shift();
  }
  if (parts.length === 0) {
    return original;
  }
  if (CHANNEL_SUBSYSTEM_PREFIXES.has(parts[0])) {
    return parts[0];
  }
  if (parts.length > SUBSYSTEM_MAX_SEGMENTS) {
    return parts.slice(-SUBSYSTEM_MAX_SEGMENTS).join("/");
  }
  return parts.join("/");
}
function stripRedundantSubsystemPrefixForConsole(message, displaySubsystem) {
  if (!displaySubsystem) {
    return message;
  }
  if (message.startsWith("[")) {
    const closeIdx = message.indexOf("]");
    if (closeIdx > 1) {
      const bracketTag = message.slice(1, closeIdx);
      if (bracketTag.toLowerCase() === displaySubsystem.toLowerCase()) {
        let i2 = closeIdx + 1;
        while (message[i2] === " ") {
          i2 += 1;
        }
        return message.slice(i2);
      }
    }
  }
  const prefix = message.slice(0, displaySubsystem.length);
  if (prefix.toLowerCase() !== displaySubsystem.toLowerCase()) {
    return message;
  }
  const next = message.slice(displaySubsystem.length, displaySubsystem.length + 1);
  if (next !== ":" && next !== " ") {
    return message;
  }
  let i = displaySubsystem.length;
  while (message[i] === " ") {
    i += 1;
  }
  if (message[i] === ":") {
    i += 1;
  }
  while (message[i] === " ") {
    i += 1;
  }
  return message.slice(i);
}
function formatConsoleLine(opts) {
  const displaySubsystem =
    opts.style === "json" ? opts.subsystem : formatSubsystemForConsole(opts.subsystem);
  if (opts.style === "json") {
    return JSON.stringify({
      time: formatConsoleTimestamp("json"),
      level: opts.level,
      subsystem: displaySubsystem,
      message: opts.message,
      ...opts.meta,
    });
  }
  const color = getColorForConsole();
  const prefix = `[${displaySubsystem}]`;
  const prefixColor = pickSubsystemColor(color, displaySubsystem);
  const levelColor =
    opts.level === "error" || opts.level === "fatal"
      ? color.red
      : opts.level === "warn"
        ? color.yellow
        : opts.level === "debug" || opts.level === "trace"
          ? color.gray
          : color.cyan;
  const displayMessage = stripRedundantSubsystemPrefixForConsole(opts.message, displaySubsystem);
  const time = (() => {
    if (opts.style === "pretty") {
      return color.gray(formatConsoleTimestamp("pretty"));
    }
    if (loggingState.consoleTimestampPrefix) {
      return color.gray(formatConsoleTimestamp(opts.style));
    }
    return "";
  })();
  const prefixToken = prefixColor(prefix);
  const head = [time, prefixToken].filter(Boolean).join(" ");
  return `${head} ${levelColor(displayMessage)}`;
}
function writeConsoleLine(level, line) {
  clearActiveProgressLine();
  const sanitized =
    process.platform === "win32" && process.env.GITHUB_ACTIONS === "true"
      ? line.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "?").replace(/[\uD800-\uDFFF]/g, "?")
      : line;
  const sink = loggingState.rawConsole ?? console;
  if (loggingState.forceConsoleToStderr || level === "error" || level === "fatal") {
    (sink.error ?? console.error)(sanitized);
  } else if (level === "warn") {
    (sink.warn ?? console.warn)(sanitized);
  } else {
    (sink.log ?? console.log)(sanitized);
  }
}
function shouldSuppressProbeConsoleLine(params) {
  if (isVerbose()) {
    return false;
  }
  if (params.level === "error" || params.level === "fatal") {
    return false;
  }
  const isProbeSuppressedSubsystem =
    params.subsystem === "agent/embedded" ||
    params.subsystem.startsWith("agent/embedded/") ||
    params.subsystem === "model-fallback" ||
    params.subsystem.startsWith("model-fallback/");
  if (!isProbeSuppressedSubsystem) {
    return false;
  }
  const runLikeId =
    typeof params.meta?.runId === "string"
      ? params.meta.runId
      : typeof params.meta?.sessionId === "string"
        ? params.meta.sessionId
        : void 0;
  if (runLikeId?.startsWith("probe-")) {
    return true;
  }
  return /(sessionId|runId)=probe-/.test(params.message);
}
function logToFile(fileLogger, level, message, meta) {
  if (level === "silent") {
    return;
  }
  const safeLevel = level;
  const method = fileLogger[safeLevel];
  if (typeof method !== "function") {
    return;
  }
  if (meta && Object.keys(meta).length > 0) {
    method.call(fileLogger, meta, message);
  } else {
    method.call(fileLogger, message);
  }
}
function createSubsystemLogger(subsystem) {
  let fileLogger = null;
  const logger = {
    subsystem,
    isEnabled(level, target = "any") {
      const isConsoleEnabled =
        shouldLogToConsole(level, { level: getConsoleSettings().level }) &&
        shouldLogSubsystemToConsole(subsystem);
      const isFileEnabled = isFileLogLevelEnabled(level);
      if (target === "console") {
        return isConsoleEnabled;
      }
      if (target === "file") {
        return isFileEnabled;
      }
      return isConsoleEnabled || isFileEnabled;
    },
    trace(message, meta) {
      const level = "trace";
      const consoleSettings = getConsoleSettings();
      const consoleEnabled =
        shouldLogToConsole(level, { level: consoleSettings.level }) &&
        shouldLogSubsystemToConsole(subsystem);
      const fileEnabled = isFileLogLevelEnabled(level);
      if (!consoleEnabled && !fileEnabled) {
        return;
      }
      let consoleMessageOverride;
      let fileMeta = meta;
      if (meta && Object.keys(meta).length > 0) {
        const { consoleMessage: consoleMessage2, ...rest } = meta;
        if (typeof consoleMessage2 === "string") {
          consoleMessageOverride = consoleMessage2;
        }
        fileMeta = Object.keys(rest).length > 0 ? rest : void 0;
      }
      if (fileEnabled) {
        if (!fileLogger) {
          fileLogger = getChildLogger({ subsystem });
        }
        logToFile(fileLogger, level, message, fileMeta);
      }
      if (!consoleEnabled) {
        return;
      }
      const consoleMessage = consoleMessageOverride ?? message;
      if (
        shouldSuppressProbeConsoleLine({
          level,
          subsystem,
          message: consoleMessage,
          meta: fileMeta,
        })
      ) {
        return;
      }
      writeConsoleLine(
        level,
        formatConsoleLine({
          level,
          subsystem,
          message: consoleSettings.style === "json" ? message : consoleMessage,
          style: consoleSettings.style,
          meta: fileMeta,
        }),
      );
    },
    debug(message, meta) {
      const level = "debug";
      const consoleSettings = getConsoleSettings();
      const consoleEnabled =
        shouldLogToConsole(level, { level: consoleSettings.level }) &&
        shouldLogSubsystemToConsole(subsystem);
      const fileEnabled = isFileLogLevelEnabled(level);
      if (!consoleEnabled && !fileEnabled) {
        return;
      }
      let consoleMessageOverride;
      let fileMeta = meta;
      if (meta && Object.keys(meta).length > 0) {
        const { consoleMessage: consoleMessage2, ...rest } = meta;
        if (typeof consoleMessage2 === "string") {
          consoleMessageOverride = consoleMessage2;
        }
        fileMeta = Object.keys(rest).length > 0 ? rest : void 0;
      }
      if (fileEnabled) {
        if (!fileLogger) {
          fileLogger = getChildLogger({ subsystem });
        }
        logToFile(fileLogger, level, message, fileMeta);
      }
      if (!consoleEnabled) {
        return;
      }
      const consoleMessage = consoleMessageOverride ?? message;
      if (
        shouldSuppressProbeConsoleLine({
          level,
          subsystem,
          message: consoleMessage,
          meta: fileMeta,
        })
      ) {
        return;
      }
      writeConsoleLine(
        level,
        formatConsoleLine({
          level,
          subsystem,
          message: consoleSettings.style === "json" ? message : consoleMessage,
          style: consoleSettings.style,
          meta: fileMeta,
        }),
      );
    },
    info(message, meta) {
      const level = "info";
      const consoleSettings = getConsoleSettings();
      const consoleEnabled =
        shouldLogToConsole(level, { level: consoleSettings.level }) &&
        shouldLogSubsystemToConsole(subsystem);
      const fileEnabled = isFileLogLevelEnabled(level);
      if (!consoleEnabled && !fileEnabled) {
        return;
      }
      let consoleMessageOverride;
      let fileMeta = meta;
      if (meta && Object.keys(meta).length > 0) {
        const { consoleMessage: consoleMessage2, ...rest } = meta;
        if (typeof consoleMessage2 === "string") {
          consoleMessageOverride = consoleMessage2;
        }
        fileMeta = Object.keys(rest).length > 0 ? rest : void 0;
      }
      if (fileEnabled) {
        if (!fileLogger) {
          fileLogger = getChildLogger({ subsystem });
        }
        logToFile(fileLogger, level, message, fileMeta);
      }
      if (!consoleEnabled) {
        return;
      }
      const consoleMessage = consoleMessageOverride ?? message;
      if (
        shouldSuppressProbeConsoleLine({
          level,
          subsystem,
          message: consoleMessage,
          meta: fileMeta,
        })
      ) {
        return;
      }
      writeConsoleLine(
        level,
        formatConsoleLine({
          level,
          subsystem,
          message: consoleSettings.style === "json" ? message : consoleMessage,
          style: consoleSettings.style,
          meta: fileMeta,
        }),
      );
    },
    warn(message, meta) {
      const level = "warn";
      const consoleSettings = getConsoleSettings();
      const consoleEnabled =
        shouldLogToConsole(level, { level: consoleSettings.level }) &&
        shouldLogSubsystemToConsole(subsystem);
      const fileEnabled = isFileLogLevelEnabled(level);
      if (!consoleEnabled && !fileEnabled) {
        return;
      }
      let consoleMessageOverride;
      let fileMeta = meta;
      if (meta && Object.keys(meta).length > 0) {
        const { consoleMessage: consoleMessage2, ...rest } = meta;
        if (typeof consoleMessage2 === "string") {
          consoleMessageOverride = consoleMessage2;
        }
        fileMeta = Object.keys(rest).length > 0 ? rest : void 0;
      }
      if (fileEnabled) {
        if (!fileLogger) {
          fileLogger = getChildLogger({ subsystem });
        }
        logToFile(fileLogger, level, message, fileMeta);
      }
      if (!consoleEnabled) {
        return;
      }
      const consoleMessage = consoleMessageOverride ?? message;
      if (
        shouldSuppressProbeConsoleLine({
          level,
          subsystem,
          message: consoleMessage,
          meta: fileMeta,
        })
      ) {
        return;
      }
      writeConsoleLine(
        level,
        formatConsoleLine({
          level,
          subsystem,
          message: consoleSettings.style === "json" ? message : consoleMessage,
          style: consoleSettings.style,
          meta: fileMeta,
        }),
      );
    },
    error(message, meta) {
      const level = "error";
      const consoleSettings = getConsoleSettings();
      const consoleEnabled =
        shouldLogToConsole(level, { level: consoleSettings.level }) &&
        shouldLogSubsystemToConsole(subsystem);
      const fileEnabled = isFileLogLevelEnabled(level);
      if (!consoleEnabled && !fileEnabled) {
        return;
      }
      let consoleMessageOverride;
      let fileMeta = meta;
      if (meta && Object.keys(meta).length > 0) {
        const { consoleMessage: consoleMessage2, ...rest } = meta;
        if (typeof consoleMessage2 === "string") {
          consoleMessageOverride = consoleMessage2;
        }
        fileMeta = Object.keys(rest).length > 0 ? rest : void 0;
      }
      if (fileEnabled) {
        if (!fileLogger) {
          fileLogger = getChildLogger({ subsystem });
        }
        logToFile(fileLogger, level, message, fileMeta);
      }
      if (!consoleEnabled) {
        return;
      }
      const consoleMessage = consoleMessageOverride ?? message;
      if (
        shouldSuppressProbeConsoleLine({
          level,
          subsystem,
          message: consoleMessage,
          meta: fileMeta,
        })
      ) {
        return;
      }
      writeConsoleLine(
        level,
        formatConsoleLine({
          level,
          subsystem,
          message: consoleSettings.style === "json" ? message : consoleMessage,
          style: consoleSettings.style,
          meta: fileMeta,
        }),
      );
    },
    fatal(message, meta) {
      const level = "fatal";
      const consoleSettings = getConsoleSettings();
      const consoleEnabled =
        shouldLogToConsole(level, { level: consoleSettings.level }) &&
        shouldLogSubsystemToConsole(subsystem);
      const fileEnabled = isFileLogLevelEnabled(level);
      if (!consoleEnabled && !fileEnabled) {
        return;
      }
      let consoleMessageOverride;
      let fileMeta = meta;
      if (meta && Object.keys(meta).length > 0) {
        const { consoleMessage: consoleMessage2, ...rest } = meta;
        if (typeof consoleMessage2 === "string") {
          consoleMessageOverride = consoleMessage2;
        }
        fileMeta = Object.keys(rest).length > 0 ? rest : void 0;
      }
      if (fileEnabled) {
        if (!fileLogger) {
          fileLogger = getChildLogger({ subsystem });
        }
        logToFile(fileLogger, level, message, fileMeta);
      }
      if (!consoleEnabled) {
        return;
      }
      const consoleMessage = consoleMessageOverride ?? message;
      if (
        shouldSuppressProbeConsoleLine({
          level,
          subsystem,
          message: consoleMessage,
          meta: fileMeta,
        })
      ) {
        return;
      }
      writeConsoleLine(
        level,
        formatConsoleLine({
          level,
          subsystem,
          message: consoleSettings.style === "json" ? message : consoleMessage,
          style: consoleSettings.style,
          meta: fileMeta,
        }),
      );
    },
    raw(message) {
      if (isFileLogLevelEnabled("info")) {
        if (!fileLogger) {
          fileLogger = getChildLogger({ subsystem });
        }
        logToFile(fileLogger, "info", message, { raw: true });
      }
      if (
        shouldLogToConsole("info", { level: getConsoleSettings().level }) &&
        shouldLogSubsystemToConsole(subsystem)
      ) {
        if (shouldSuppressProbeConsoleLine({ level: "info", subsystem, message })) {
          return;
        }
        writeConsoleLine("info", message);
      }
    },
    child(name) {
      return createSubsystemLogger(`${subsystem}/${name}`);
    },
  };
  return logger;
}

// src/infra/prototype-keys.ts
var BLOCKED_OBJECT_KEYS = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
function isBlockedObjectKey(key) {
  return BLOCKED_OBJECT_KEYS.has(key);
}

// src/routing/account-id.ts
var DEFAULT_ACCOUNT_ID = "default";

// src/utils.ts
import fs4 from "node:fs";
import os3 from "node:os";
import path6 from "node:path";

// src/globals.ts
function shouldLogVerbose() {
  return isVerbose() || isFileLogLevelEnabled("debug");
}
function logVerbose(message) {
  if (!shouldLogVerbose()) {
    return;
  }
  try {
    getLogger().debug({ message }, "verbose");
  } catch {}
  if (!isVerbose()) {
    return;
  }
  console.log(theme.muted(message));
}
var success = theme.success;
var warn = theme.warn;
var info = theme.info;
var danger = theme.error;

// src/utils.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeE164(number) {
  const withoutPrefix = number.replace(/^whatsapp:/, "").trim();
  const digits = withoutPrefix.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return `+${digits.slice(1)}`;
  }
  return `+${digits}`;
}
function resolveLidMappingDirs(opts) {
  const dirs = /* @__PURE__ */ new Set();
  const addDir = (dir) => {
    if (!dir) {
      return;
    }
    dirs.add(resolveUserPath2(dir));
  };
  addDir(opts?.authDir);
  for (const dir of opts?.lidMappingDirs ?? []) {
    addDir(dir);
  }
  addDir(resolveOAuthDir());
  addDir(path6.join(CONFIG_DIR, "credentials"));
  return [...dirs];
}
function readLidReverseMapping(lid, opts) {
  const mappingFilename = `lid-mapping-${lid}_reverse.json`;
  const mappingDirs = resolveLidMappingDirs(opts);
  for (const dir of mappingDirs) {
    const mappingPath = path6.join(dir, mappingFilename);
    try {
      const data = fs4.readFileSync(mappingPath, "utf8");
      const phone = JSON.parse(data);
      if (phone === null || phone === void 0) {
        continue;
      }
      return normalizeE164(String(phone));
    } catch {}
  }
  return null;
}
function jidToE164(jid, opts) {
  const match = jid.match(/^(\d+)(?::\d+)?@(s\.whatsapp\.net|hosted)$/);
  if (match) {
    const digits = match[1];
    return `+${digits}`;
  }
  const lidMatch = jid.match(/^(\d+)(?::\d+)?@(lid|hosted\.lid)$/);
  if (lidMatch) {
    const lid = lidMatch[1];
    const phone = readLidReverseMapping(lid, opts);
    if (phone) {
      return phone;
    }
    const shouldLog = opts?.logMissing ?? shouldLogVerbose();
    if (shouldLog) {
      logVerbose(`LID mapping not found for ${lid}; skipping inbound message`);
    }
  }
  return null;
}
function resolveUserPath2(input, env = process.env, homedir = os3.homedir) {
  if (!input) {
    return "";
  }
  return resolveHomeRelativePath(input, { env, homedir });
}
function resolveConfigDir(env = process.env, homedir = os3.homedir) {
  const override = env.OPENCLAW_STATE_DIR?.trim();
  if (override) {
    return resolveUserPath2(override, env, homedir);
  }
  const newDir = path6.join(resolveRequiredHomeDir(env, homedir), ".openclaw");
  try {
    const hasNew = fs4.existsSync(newDir);
    if (hasNew) {
      return newDir;
    }
  } catch {}
  return newDir;
}
var CONFIG_DIR = resolveConfigDir();

// src/infra/boundary-file-read.ts
import fs7 from "node:fs";
// src/infra/boundary-path.ts
import fs5 from "node:fs";
// src/agents/workspace.ts
import os5 from "node:os";
import os4 from "node:os";
import path12 from "node:path";
import path9 from "node:path";
import path8 from "node:path";
// src/infra/path-guards.ts
import path7 from "node:path";
var NOT_FOUND_CODES = /* @__PURE__ */ new Set(["ENOENT", "ENOTDIR"]);
function normalizeWindowsPathForComparison(input) {
  let normalized = path7.win32.normalize(input);
  if (normalized.startsWith("\\\\?\\")) {
    normalized = normalized.slice(4);
    if (normalized.toUpperCase().startsWith("UNC\\")) {
      normalized = `\\\\${normalized.slice(4)}`;
    }
  }
  return normalized.replaceAll("/", "\\").toLowerCase();
}
function isNodeError(value) {
  return Boolean(value && typeof value === "object" && "code" in value);
}
function isNotFoundPathError(value) {
  return isNodeError(value) && typeof value.code === "string" && NOT_FOUND_CODES.has(value.code);
}
function isPathInside(root, target) {
  if (process.platform === "win32") {
    const rootForCompare = normalizeWindowsPathForComparison(path7.win32.resolve(root));
    const targetForCompare = normalizeWindowsPathForComparison(path7.win32.resolve(target));
    const relative2 = path7.win32.relative(rootForCompare, targetForCompare);
    return relative2 === "" || (!relative2.startsWith("..") && !path7.win32.isAbsolute(relative2));
  }
  const resolvedRoot = path7.resolve(root);
  const resolvedTarget = path7.resolve(target);
  const relative = path7.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path7.isAbsolute(relative));
}

// src/infra/boundary-path.ts
var BOUNDARY_PATH_ALIAS_POLICIES = {
  strict: Object.freeze({
    allowFinalSymlinkForUnlink: false,
    allowFinalHardlinkForUnlink: false,
  }),
  unlinkTarget: Object.freeze({
    allowFinalSymlinkForUnlink: true,
    allowFinalHardlinkForUnlink: true,
  }),
};
function resolveBoundaryPathSync(params) {
  const rootPath = path8.resolve(params.rootPath);
  const absolutePath = path8.resolve(params.absolutePath);
  const rootCanonicalPath = params.rootCanonicalPath
    ? path8.resolve(params.rootCanonicalPath)
    : resolvePathViaExistingAncestorSync(rootPath);
  const context = createBoundaryResolutionContext({
    resolveParams: params,
    rootPath,
    absolutePath,
    rootCanonicalPath,
    outsideLexicalCanonicalPath: resolveOutsideLexicalCanonicalPathSync({
      rootPath,
      absolutePath,
    }),
  });
  const outsideResult = resolveOutsideBoundaryPathSync({
    boundaryLabel: params.boundaryLabel,
    context,
  });
  if (outsideResult) {
    return outsideResult;
  }
  return resolveBoundaryPathLexicalSync({
    params,
    absolutePath: context.absolutePath,
    rootPath: context.rootPath,
    rootCanonicalPath: context.rootCanonicalPath,
  });
}
function isPromiseLike(value) {
  return Boolean(
    value &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof value.then === "function",
  );
}
function createLexicalTraversalState(params) {
  const relative = path8.relative(params.rootPath, params.absolutePath);
  return {
    segments: relative.split(path8.sep).filter(Boolean),
    allowFinalSymlink: params.params.policy?.allowFinalSymlinkForUnlink === true,
    canonicalCursor: params.rootCanonicalPath,
    lexicalCursor: params.rootPath,
    preserveFinalSymlink: false,
  };
}
function assertLexicalCursorInsideBoundary(params) {
  assertInsideBoundary({
    boundaryLabel: params.params.boundaryLabel,
    rootCanonicalPath: params.rootCanonicalPath,
    candidatePath: params.candidatePath,
    absolutePath: params.absolutePath,
  });
}
function applyMissingSuffixToCanonicalCursor(params) {
  const missingSuffix = params.state.segments.slice(params.missingFromIndex);
  params.state.canonicalCursor = path8.resolve(params.state.canonicalCursor, ...missingSuffix);
  assertLexicalCursorInsideBoundary({
    params: params.params,
    rootCanonicalPath: params.rootCanonicalPath,
    candidatePath: params.state.canonicalCursor,
    absolutePath: params.absolutePath,
  });
}
function advanceCanonicalCursorForSegment(params) {
  params.state.canonicalCursor = path8.resolve(params.state.canonicalCursor, params.segment);
  assertLexicalCursorInsideBoundary({
    params: params.params,
    rootCanonicalPath: params.rootCanonicalPath,
    candidatePath: params.state.canonicalCursor,
    absolutePath: params.absolutePath,
  });
}
function finalizeLexicalResolution(params) {
  assertLexicalCursorInsideBoundary({
    params: params.params,
    rootCanonicalPath: params.rootCanonicalPath,
    candidatePath: params.state.canonicalCursor,
    absolutePath: params.absolutePath,
  });
  return buildResolvedBoundaryPath({
    absolutePath: params.absolutePath,
    canonicalPath: params.state.canonicalCursor,
    rootPath: params.rootPath,
    rootCanonicalPath: params.rootCanonicalPath,
    kind: params.kind,
  });
}
function handleLexicalLstatFailure(params) {
  if (!isNotFoundPathError(params.error)) {
    return false;
  }
  applyMissingSuffixToCanonicalCursor({
    state: params.state,
    missingFromIndex: params.missingFromIndex,
    rootCanonicalPath: params.rootCanonicalPath,
    params: params.resolveParams,
    absolutePath: params.absolutePath,
  });
  return true;
}
function handleLexicalStatReadFailure(params) {
  if (
    handleLexicalLstatFailure({
      error: params.error,
      state: params.state,
      missingFromIndex: params.missingFromIndex,
      rootCanonicalPath: params.rootCanonicalPath,
      resolveParams: params.resolveParams,
      absolutePath: params.absolutePath,
    })
  ) {
    return null;
  }
  throw params.error;
}
function handleLexicalStatDisposition(params) {
  if (!params.isSymbolicLink) {
    advanceCanonicalCursorForSegment({
      state: params.state,
      segment: params.segment,
      rootCanonicalPath: params.rootCanonicalPath,
      params: params.resolveParams,
      absolutePath: params.absolutePath,
    });
    return "continue";
  }
  if (params.state.allowFinalSymlink && params.isLast) {
    params.state.preserveFinalSymlink = true;
    advanceCanonicalCursorForSegment({
      state: params.state,
      segment: params.segment,
      rootCanonicalPath: params.rootCanonicalPath,
      params: params.resolveParams,
      absolutePath: params.absolutePath,
    });
    return "break";
  }
  return "resolve-link";
}
function applyResolvedSymlinkHop(params) {
  if (!isPathInside(params.rootCanonicalPath, params.linkCanonical)) {
    throw symlinkEscapeError({
      boundaryLabel: params.boundaryLabel,
      rootCanonicalPath: params.rootCanonicalPath,
      symlinkPath: params.state.lexicalCursor,
    });
  }
  params.state.canonicalCursor = params.linkCanonical;
  params.state.lexicalCursor = params.linkCanonical;
}
function readLexicalStat(params) {
  try {
    const stat = params.read(params.state.lexicalCursor);
    if (isPromiseLike(stat)) {
      return Promise.resolve(stat).catch((error) =>
        handleLexicalStatReadFailure({ ...params, error }),
      );
    }
    return stat;
  } catch (error) {
    return handleLexicalStatReadFailure({ ...params, error });
  }
}
function resolveAndApplySymlinkHop(params) {
  const linkCanonical = params.resolveLinkCanonical(params.state.lexicalCursor);
  if (isPromiseLike(linkCanonical)) {
    return Promise.resolve(linkCanonical).then((value) =>
      applyResolvedSymlinkHop({
        state: params.state,
        linkCanonical: value,
        rootCanonicalPath: params.rootCanonicalPath,
        boundaryLabel: params.boundaryLabel,
      }),
    );
  }
  applyResolvedSymlinkHop({
    state: params.state,
    linkCanonical,
    rootCanonicalPath: params.rootCanonicalPath,
    boundaryLabel: params.boundaryLabel,
  });
}
function resolveBoundaryPathLexicalSync(params) {
  const state2 = createLexicalTraversalState(params);
  for (let idx = 0; idx < state2.segments.length; idx += 1) {
    const segment = state2.segments[idx] ?? "";
    const isLast = idx === state2.segments.length - 1;
    state2.lexicalCursor = path8.join(state2.lexicalCursor, segment);
    const maybeStat = readLexicalStat({
      state: state2,
      missingFromIndex: idx,
      rootCanonicalPath: params.rootCanonicalPath,
      resolveParams: params.params,
      absolutePath: params.absolutePath,
      read: (cursor) => fs5.lstatSync(cursor),
    });
    if (isPromiseLike(maybeStat)) {
      throw new Error("Unexpected async lexical stat");
    }
    const stat = maybeStat;
    if (!stat) {
      break;
    }
    const disposition = handleLexicalStatDisposition({
      state: state2,
      isSymbolicLink: stat.isSymbolicLink(),
      segment,
      isLast,
      rootCanonicalPath: params.rootCanonicalPath,
      resolveParams: params.params,
      absolutePath: params.absolutePath,
    });
    if (disposition === "continue") {
      continue;
    }
    if (disposition === "break") {
      break;
    }
    const maybeApplied = resolveAndApplySymlinkHop({
      state: state2,
      rootCanonicalPath: params.rootCanonicalPath,
      boundaryLabel: params.params.boundaryLabel,
      resolveLinkCanonical: (cursor) => resolveSymlinkHopPathSync(cursor),
    });
    if (isPromiseLike(maybeApplied)) {
      throw new Error("Unexpected async symlink resolution");
    }
  }
  const kind = getPathKindSync(params.absolutePath, state2.preserveFinalSymlink);
  return finalizeLexicalResolution({
    ...params,
    state: state2,
    kind,
  });
}
function resolveCanonicalOutsideLexicalPath(params) {
  return params.outsideLexicalCanonicalPath ?? params.absolutePath;
}
function createBoundaryResolutionContext(params) {
  const lexicalInside = isPathInside(params.rootPath, params.absolutePath);
  const canonicalOutsideLexicalPath = resolveCanonicalOutsideLexicalPath({
    absolutePath: params.absolutePath,
    outsideLexicalCanonicalPath: params.outsideLexicalCanonicalPath,
  });
  assertLexicalBoundaryOrCanonicalAlias({
    skipLexicalRootCheck: params.resolveParams.skipLexicalRootCheck,
    lexicalInside,
    canonicalOutsideLexicalPath,
    rootCanonicalPath: params.rootCanonicalPath,
    boundaryLabel: params.resolveParams.boundaryLabel,
    rootPath: params.rootPath,
    absolutePath: params.absolutePath,
  });
  return {
    rootPath: params.rootPath,
    absolutePath: params.absolutePath,
    rootCanonicalPath: params.rootCanonicalPath,
    lexicalInside,
    canonicalOutsideLexicalPath,
  };
}
function resolveOutsideBoundaryPathSync(params) {
  if (params.context.lexicalInside) {
    return null;
  }
  const kind = getPathKindSync(params.context.absolutePath, false);
  return buildOutsideBoundaryPathFromContext({
    boundaryLabel: params.boundaryLabel,
    context: params.context,
    kind,
  });
}
function buildOutsideBoundaryPathFromContext(params) {
  return buildOutsideLexicalBoundaryPath({
    boundaryLabel: params.boundaryLabel,
    rootCanonicalPath: params.context.rootCanonicalPath,
    absolutePath: params.context.absolutePath,
    canonicalOutsideLexicalPath: params.context.canonicalOutsideLexicalPath,
    rootPath: params.context.rootPath,
    kind: params.kind,
  });
}
function resolveOutsideLexicalCanonicalPathSync(params) {
  if (isPathInside(params.rootPath, params.absolutePath)) {
    return void 0;
  }
  return resolvePathViaExistingAncestorSync(params.absolutePath);
}
function buildOutsideLexicalBoundaryPath(params) {
  assertInsideBoundary({
    boundaryLabel: params.boundaryLabel,
    rootCanonicalPath: params.rootCanonicalPath,
    candidatePath: params.canonicalOutsideLexicalPath,
    absolutePath: params.absolutePath,
  });
  return buildResolvedBoundaryPath({
    absolutePath: params.absolutePath,
    canonicalPath: params.canonicalOutsideLexicalPath,
    rootPath: params.rootPath,
    rootCanonicalPath: params.rootCanonicalPath,
    kind: params.kind,
  });
}
function assertLexicalBoundaryOrCanonicalAlias(params) {
  if (params.skipLexicalRootCheck || params.lexicalInside) {
    return;
  }
  if (isPathInside(params.rootCanonicalPath, params.canonicalOutsideLexicalPath)) {
    return;
  }
  throw pathEscapeError({
    boundaryLabel: params.boundaryLabel,
    rootPath: params.rootPath,
    absolutePath: params.absolutePath,
  });
}
function buildResolvedBoundaryPath(params) {
  return {
    absolutePath: params.absolutePath,
    canonicalPath: params.canonicalPath,
    rootPath: params.rootPath,
    rootCanonicalPath: params.rootCanonicalPath,
    relativePath: relativeInsideRoot(params.rootCanonicalPath, params.canonicalPath),
    exists: params.kind.exists,
    kind: params.kind.kind,
  };
}
function resolvePathViaExistingAncestorSync(targetPath) {
  const normalized = path8.resolve(targetPath);
  let cursor = normalized;
  const missingSuffix = [];
  while (!isFilesystemRoot(cursor) && !fs5.existsSync(cursor)) {
    missingSuffix.unshift(path8.basename(cursor));
    const parent = path8.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  if (!fs5.existsSync(cursor)) {
    return normalized;
  }
  try {
    const resolvedAncestor = path8.resolve(fs5.realpathSync(cursor));
    if (missingSuffix.length === 0) {
      return resolvedAncestor;
    }
    return path8.resolve(resolvedAncestor, ...missingSuffix);
  } catch {
    return normalized;
  }
}
function getPathKindSync(absolutePath, preserveFinalSymlink) {
  try {
    const stat = preserveFinalSymlink ? fs5.lstatSync(absolutePath) : fs5.statSync(absolutePath);
    return { exists: true, kind: toResolvedKind(stat) };
  } catch (error) {
    if (isNotFoundPathError(error)) {
      return { exists: false, kind: "missing" };
    }
    throw error;
  }
}
function toResolvedKind(stat) {
  if (stat.isFile()) {
    return "file";
  }
  if (stat.isDirectory()) {
    return "directory";
  }
  if (stat.isSymbolicLink()) {
    return "symlink";
  }
  return "other";
}
function relativeInsideRoot(rootPath, targetPath) {
  const relative = path8.relative(path8.resolve(rootPath), path8.resolve(targetPath));
  if (!relative || relative === ".") {
    return "";
  }
  if (relative.startsWith("..") || path8.isAbsolute(relative)) {
    return "";
  }
  return relative;
}
function assertInsideBoundary(params) {
  if (isPathInside(params.rootCanonicalPath, params.candidatePath)) {
    return;
  }
  throw new Error(
    `Path resolves outside ${params.boundaryLabel} (${shortPath(params.rootCanonicalPath)}): ${shortPath(params.absolutePath)}`,
  );
}
function pathEscapeError(params) {
  return new Error(
    `Path escapes ${params.boundaryLabel} (${shortPath(params.rootPath)}): ${shortPath(params.absolutePath)}`,
  );
}
function symlinkEscapeError(params) {
  return new Error(
    `Symlink escapes ${params.boundaryLabel} (${shortPath(params.rootCanonicalPath)}): ${shortPath(params.symlinkPath)}`,
  );
}
function shortPath(value) {
  const home = os4.homedir();
  if (value.startsWith(home)) {
    return `~${value.slice(home.length)}`;
  }
  return value;
}
function isFilesystemRoot(candidate) {
  return path8.parse(candidate).root === candidate;
}
function resolveSymlinkHopPathSync(symlinkPath) {
  try {
    return path8.resolve(fs5.realpathSync(symlinkPath));
  } catch (error) {
    if (!isNotFoundPathError(error)) {
      throw error;
    }
    const linkTarget = fs5.readlinkSync(symlinkPath);
    const linkAbsolute = path8.resolve(path8.dirname(symlinkPath), linkTarget);
    return resolvePathViaExistingAncestorSync(linkAbsolute);
  }
}

// src/infra/safe-open-sync.ts
import fs6 from "node:fs";

// src/infra/file-identity.ts
function isZero(value) {
  return value === 0 || value === 0n;
}
function sameFileIdentity(left, right, platform = process.platform) {
  if (left.ino !== right.ino) {
    return false;
  }
  if (left.dev === right.dev) {
    return true;
  }
  return platform === "win32" && (isZero(left.dev) || isZero(right.dev));
}

// src/infra/safe-open-sync.ts
function isExpectedPathError(error) {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP";
}
function sameFileIdentity2(left, right) {
  return sameFileIdentity(left, right);
}
function openVerifiedFileSync(params) {
  const ioFs = params.ioFs ?? fs6;
  const allowedType = params.allowedType ?? "file";
  const openReadFlags =
    ioFs.constants.O_RDONLY |
    (typeof ioFs.constants.O_NOFOLLOW === "number" ? ioFs.constants.O_NOFOLLOW : 0);
  let fd = null;
  try {
    if (params.rejectPathSymlink) {
      const candidateStat = ioFs.lstatSync(params.filePath);
      if (candidateStat.isSymbolicLink()) {
        return { ok: false, reason: "validation" };
      }
    }
    const realPath = params.resolvedPath ?? ioFs.realpathSync(params.filePath);
    const preOpenStat = ioFs.lstatSync(realPath);
    if (!isAllowedType(preOpenStat, allowedType)) {
      return { ok: false, reason: "validation" };
    }
    if (params.rejectHardlinks && preOpenStat.isFile() && preOpenStat.nlink > 1) {
      return { ok: false, reason: "validation" };
    }
    if (params.maxBytes !== void 0 && preOpenStat.isFile() && preOpenStat.size > params.maxBytes) {
      return { ok: false, reason: "validation" };
    }
    fd = ioFs.openSync(realPath, openReadFlags);
    const openedStat = ioFs.fstatSync(fd);
    if (!isAllowedType(openedStat, allowedType)) {
      return { ok: false, reason: "validation" };
    }
    if (params.rejectHardlinks && openedStat.isFile() && openedStat.nlink > 1) {
      return { ok: false, reason: "validation" };
    }
    if (params.maxBytes !== void 0 && openedStat.isFile() && openedStat.size > params.maxBytes) {
      return { ok: false, reason: "validation" };
    }
    if (!sameFileIdentity2(preOpenStat, openedStat)) {
      return { ok: false, reason: "validation" };
    }
    const opened = { ok: true, path: realPath, fd, stat: openedStat };
    fd = null;
    return opened;
  } catch (error) {
    if (isExpectedPathError(error)) {
      return { ok: false, reason: "path", error };
    }
    return { ok: false, reason: "io", error };
  } finally {
    if (fd !== null) {
      ioFs.closeSync(fd);
    }
  }
}
function isAllowedType(stat, allowedType) {
  if (allowedType === "directory") {
    return stat.isDirectory();
  }
  return stat.isFile();
}

// src/infra/boundary-file-read.ts
function openBoundaryFileSync(params) {
  const ioFs = params.ioFs ?? fs7;
  const resolved = resolveBoundaryFilePathGeneric({
    absolutePath: params.absolutePath,
    resolve: (absolutePath) =>
      resolveBoundaryPathSync({
        absolutePath,
        rootPath: params.rootPath,
        rootCanonicalPath: params.rootRealPath,
        boundaryLabel: params.boundaryLabel,
        skipLexicalRootCheck: params.skipLexicalRootCheck,
      }),
  });
  if (resolved instanceof Promise) {
    return toBoundaryValidationError(new Error("Unexpected async boundary resolution"));
  }
  return finalizeBoundaryFileOpen({
    resolved,
    maxBytes: params.maxBytes,
    rejectHardlinks: params.rejectHardlinks,
    allowedType: params.allowedType,
    ioFs,
  });
}
function matchBoundaryFileOpenFailure(failure, handlers) {
  switch (failure.reason) {
    case "path":
      return handlers.path ? handlers.path(failure) : handlers.fallback(failure);
    case "validation":
      return handlers.validation ? handlers.validation(failure) : handlers.fallback(failure);
    case "io":
      return handlers.io ? handlers.io(failure) : handlers.fallback(failure);
  }
}
function openBoundaryFileResolved(params) {
  const opened = openVerifiedFileSync({
    filePath: params.absolutePath,
    resolvedPath: params.resolvedPath,
    rejectHardlinks: params.rejectHardlinks ?? true,
    maxBytes: params.maxBytes,
    allowedType: params.allowedType,
    ioFs: params.ioFs,
  });
  if (!opened.ok) {
    return opened;
  }
  return {
    ok: true,
    path: opened.path,
    fd: opened.fd,
    stat: opened.stat,
    rootRealPath: params.rootRealPath,
  };
}
function finalizeBoundaryFileOpen(params) {
  if ("ok" in params.resolved) {
    return params.resolved;
  }
  return openBoundaryFileResolved({
    absolutePath: params.resolved.absolutePath,
    resolvedPath: params.resolved.resolvedPath,
    rootRealPath: params.resolved.rootRealPath,
    maxBytes: params.maxBytes,
    rejectHardlinks: params.rejectHardlinks,
    allowedType: params.allowedType,
    ioFs: params.ioFs,
  });
}
function toBoundaryValidationError(error) {
  return { ok: false, reason: "validation", error };
}
function mapResolvedBoundaryPath(absolutePath, resolved) {
  return {
    absolutePath,
    resolvedPath: resolved.canonicalPath,
    rootRealPath: resolved.rootCanonicalPath,
  };
}
function resolveBoundaryFilePathGeneric(params) {
  const absolutePath = path9.resolve(params.absolutePath);
  try {
    const resolved = params.resolve(absolutePath);
    if (resolved instanceof Promise) {
      return resolved
        .then((value) => mapResolvedBoundaryPath(absolutePath, value))
        .catch((error) => toBoundaryValidationError(error));
    }
    return mapResolvedBoundaryPath(absolutePath, resolved);
  } catch (error) {
    return toBoundaryValidationError(error);
  }
}

// src/process/exec.ts
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

// src/logger.ts
var info2 = theme.info;
var warn2 = theme.warn;
var success2 = theme.success;
var danger2 = theme.error;

// src/process/exec.ts
var execFileAsync = promisify(execFile);

// src/infra/openclaw-root.ts
import fsSync from "node:fs";
// src/agents/workspace-templates.ts
import path11 from "node:path";
import path10 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { fileURLToPath } from "node:url";
var CORE_PACKAGE_NAMES = /* @__PURE__ */ new Set(["openclaw"]);
function parsePackageName(raw) {
  const parsed = JSON.parse(raw);
  return typeof parsed.name === "string" ? parsed.name : null;
}
function readPackageNameSync(dir) {
  try {
    return parsePackageName(fsSync.readFileSync(path10.join(dir, "package.json"), "utf-8"));
  } catch {
    return null;
  }
}
function findPackageRootSync(startDir, maxDepth = 12) {
  for (const current of iterAncestorDirs(startDir, maxDepth)) {
    const name = readPackageNameSync(current);
    if (name && CORE_PACKAGE_NAMES.has(name)) {
      return current;
    }
  }
  return null;
}
function* iterAncestorDirs(startDir, maxDepth) {
  let current = path10.resolve(startDir);
  for (let i = 0; i < maxDepth; i += 1) {
    yield current;
    const parent = path10.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
}
function candidateDirsFromArgv1(argv1) {
  const normalized = path10.resolve(argv1);
  const candidates = [path10.dirname(normalized)];
  try {
    const resolved = fsSync.realpathSync(normalized);
    if (resolved !== normalized) {
      candidates.push(path10.dirname(resolved));
    }
  } catch {}
  const parts = normalized.split(path10.sep);
  const binIndex = parts.lastIndexOf(".bin");
  if (binIndex > 0 && parts[binIndex - 1] === "node_modules") {
    const binName = path10.basename(normalized);
    const nodeModulesDir = parts.slice(0, binIndex).join(path10.sep);
    candidates.push(path10.join(nodeModulesDir, binName));
  }
  return candidates;
}
function resolveOpenClawPackageRootSync(opts) {
  for (const candidate of buildCandidates(opts)) {
    const found = findPackageRootSync(candidate);
    if (found) {
      return found;
    }
  }
  return null;
}
function buildCandidates(opts) {
  const candidates = [];
  if (opts.moduleUrl) {
    try {
      candidates.push(path10.dirname(fileURLToPath(opts.moduleUrl)));
    } catch {}
  }
  if (opts.argv1) {
    candidates.push(...candidateDirsFromArgv1(opts.argv1));
  }
  if (opts.cwd) {
    candidates.push(opts.cwd);
  }
  return candidates;
}

// src/agents/workspace-templates.ts
var FALLBACK_TEMPLATE_DIR = path11.resolve(
  path11.dirname(fileURLToPath2(import.meta.url)),
  "../../docs/reference/templates",
);

// src/agents/workspace.ts
function resolveDefaultAgentWorkspaceDir(env = process.env, homedir = os5.homedir) {
  const home = resolveRequiredHomeDir(env, homedir);
  const profile = env.OPENCLAW_PROFILE?.trim();
  if (profile && profile.toLowerCase() !== "default") {
    return path12.join(home, ".openclaw", `workspace-${profile}`);
  }
  return path12.join(home, ".openclaw", "workspace");
}
var DEFAULT_AGENT_WORKSPACE_DIR = resolveDefaultAgentWorkspaceDir();
var MAX_WORKSPACE_BOOTSTRAP_FILE_BYTES = 2 * 1024 * 1024;

// src/plugins/runtime.ts
var REGISTRY_STATE = /* @__PURE__ */ Symbol.for("openclaw.pluginRegistryState");
var state = (() => {
  const globalState = globalThis;
  if (!globalState[REGISTRY_STATE]) {
    globalState[REGISTRY_STATE] = {
      activeRegistry: null,
      activeVersion: 0,
      httpRoute: {
        registry: null,
        pinned: false,
        version: 0,
      },
      channel: {
        registry: null,
        pinned: false,
        version: 0,
      },
      key: null,
      runtimeSubagentMode: "default",
    };
  }
  return globalState[REGISTRY_STATE];
})();

// src/plugins/bundled-plugin-metadata.ts
import fs11 from "node:fs";
import path17 from "node:path";
// src/config/zod-schema.core.ts
import path13 from "node:path";
import { fileURLToPath as fileURLToPath5 } from "node:url";
import { createJiti } from "jiti";
// src/channels/plugins/config-schema.ts
import { z as z4 } from "zod";
import { z as z3 } from "zod";

// src/infra/exec-safety.ts
var SHELL_METACHARS = /[;&|`$<>]/;
var CONTROL_CHARS = /[\r\n]/;
var QUOTE_CHARS = /["']/;
var BARE_NAME_PATTERN = /^[A-Za-z0-9._+-]+$/;
function isLikelyPath(value) {
  if (value.startsWith(".") || value.startsWith("~")) {
    return true;
  }
  if (value.includes("/") || value.includes("\\")) {
    return true;
  }
  return /^[A-Za-z]:[\\/]/.test(value);
}
function isSafeExecutableValue(value) {
  if (!value) {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.includes("\0")) {
    return false;
  }
  if (CONTROL_CHARS.test(trimmed)) {
    return false;
  }
  if (SHELL_METACHARS.test(trimmed)) {
    return false;
  }
  if (QUOTE_CHARS.test(trimmed)) {
    return false;
  }
  if (isLikelyPath(trimmed)) {
    return true;
  }
  if (trimmed.startsWith("-")) {
    return false;
  }
  return BARE_NAME_PATTERN.test(trimmed);
}

// src/config/types.secrets.ts
var DEFAULT_SECRET_PROVIDER_ALIAS = "default";
var ENV_SECRET_TEMPLATE_RE = /^\$\{([A-Z][A-Z0-9_]{0,127})\}$/;
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isSecretRef(value) {
  if (!isRecord2(value)) {
    return false;
  }
  if (Object.keys(value).length !== 3) {
    return false;
  }
  return (
    (value.source === "env" || value.source === "file" || value.source === "exec") &&
    typeof value.provider === "string" &&
    value.provider.trim().length > 0 &&
    typeof value.id === "string" &&
    value.id.trim().length > 0
  );
}
function isLegacySecretRefWithoutProvider(value) {
  if (!isRecord2(value)) {
    return false;
  }
  return (
    (value.source === "env" || value.source === "file" || value.source === "exec") &&
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    value.provider === void 0
  );
}
function parseEnvTemplateSecretRef(value, provider = DEFAULT_SECRET_PROVIDER_ALIAS) {
  if (typeof value !== "string") {
    return null;
  }
  const match = ENV_SECRET_TEMPLATE_RE.exec(value.trim());
  if (!match) {
    return null;
  }
  return {
    source: "env",
    provider: provider.trim() || DEFAULT_SECRET_PROVIDER_ALIAS,
    id: match[1],
  };
}
function coerceSecretRef(value, defaults) {
  if (isSecretRef(value)) {
    return value;
  }
  if (isLegacySecretRefWithoutProvider(value)) {
    const provider =
      value.source === "env"
        ? (defaults?.env ?? DEFAULT_SECRET_PROVIDER_ALIAS)
        : value.source === "file"
          ? (defaults?.file ?? DEFAULT_SECRET_PROVIDER_ALIAS)
          : (defaults?.exec ?? DEFAULT_SECRET_PROVIDER_ALIAS);
    return {
      source: value.source,
      provider,
      id: value.id,
    };
  }
  const envTemplate = parseEnvTemplateSecretRef(value, defaults?.env);
  if (envTemplate) {
    return envTemplate;
  }
  return null;
}
function hasConfiguredSecretInput(value, defaults) {
  if (normalizeSecretInputString(value)) {
    return true;
  }
  return coerceSecretRef(value, defaults) !== null;
}
function normalizeSecretInputString(value) {
  if (typeof value !== "string") {
    return void 0;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : void 0;
}

// src/secrets/ref-contract.ts
var FILE_SECRET_REF_SEGMENT_PATTERN = /^(?:[^~]|~0|~1)*$/;
var EXEC_SECRET_REF_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
var SINGLE_VALUE_FILE_REF_ID = "value";
function isValidFileSecretRefId(value) {
  if (value === SINGLE_VALUE_FILE_REF_ID) {
    return true;
  }
  if (!value.startsWith("/")) {
    return false;
  }
  return value
    .slice(1)
    .split("/")
    .every((segment) => FILE_SECRET_REF_SEGMENT_PATTERN.test(segment));
}
function validateExecSecretRefId(value) {
  if (!EXEC_SECRET_REF_ID_PATTERN.test(value)) {
    return { ok: false, reason: "pattern" };
  }
  for (const segment of value.split("/")) {
    if (segment === "." || segment === "..") {
      return { ok: false, reason: "traversal-segment" };
    }
  }
  return { ok: true };
}
function isValidExecSecretRefId(value) {
  return validateExecSecretRefId(value).ok;
}
function formatExecSecretRefIdValidationMessage() {
  return [
    "Exec secret reference id must match /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/",
    'and must not include "." or ".." path segments',
    '(example: "vault/openai/api-key").',
  ].join(" ");
}

// src/config/types.models.ts
var MODEL_APIS = [
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
  "anthropic-messages",
  "google-generative-ai",
  "github-copilot",
  "bedrock-converse-stream",
  "ollama",
  "azure-openai-responses",
];

// src/config/zod-schema.allowdeny.ts
import { z } from "zod";
var AllowDenyActionSchema = z.union([z.literal("allow"), z.literal("deny")]);
var AllowDenyChatTypeSchema = z
  .union([
    z.literal("direct"),
    z.literal("group"),
    z.literal("channel"),
    /** @deprecated Use `direct` instead. Kept for backward compatibility. */
    z.literal("dm"),
  ])
  .optional();
function createAllowDenyChannelRulesSchema() {
  return z
    .object({
      default: AllowDenyActionSchema.optional(),
      rules: z
        .array(
          z
            .object({
              action: AllowDenyActionSchema,
              match: z
                .object({
                  channel: z.string().optional(),
                  chatType: AllowDenyChatTypeSchema,
                  keyPrefix: z.string().optional(),
                  rawKeyPrefix: z.string().optional(),
                })
                .strict()
                .optional(),
            })
            .strict(),
        )
        .optional(),
    })
    .strict()
    .optional();
}

// src/config/zod-schema.sensitive.ts
import { z as z2 } from "zod";
var sensitive = z2.registry();

// src/config/zod-schema.core.ts
var ENV_SECRET_REF_ID_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
var SECRET_PROVIDER_ALIAS_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
var WINDOWS_ABS_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
var WINDOWS_UNC_PATH_PATTERN = /^\\\\[^\\]+\\[^\\]+/;
function isAbsolutePath(value) {
  return (
    path13.isAbsolute(value) ||
    WINDOWS_ABS_PATH_PATTERN.test(value) ||
    WINDOWS_UNC_PATH_PATTERN.test(value)
  );
}
var EnvSecretRefSchema = z3
  .object({
    source: z3.literal("env"),
    provider: z3
      .string()
      .regex(
        SECRET_PROVIDER_ALIAS_PATTERN,
        'Secret reference provider must match /^[a-z][a-z0-9_-]{0,63}$/ (example: "default").',
      ),
    id: z3
      .string()
      .regex(
        ENV_SECRET_REF_ID_PATTERN,
        'Env secret reference id must match /^[A-Z][A-Z0-9_]{0,127}$/ (example: "OPENAI_API_KEY").',
      ),
  })
  .strict();
var FileSecretRefSchema = z3
  .object({
    source: z3.literal("file"),
    provider: z3
      .string()
      .regex(
        SECRET_PROVIDER_ALIAS_PATTERN,
        'Secret reference provider must match /^[a-z][a-z0-9_-]{0,63}$/ (example: "default").',
      ),
    id: z3
      .string()
      .refine(
        isValidFileSecretRefId,
        'File secret reference id must be an absolute JSON pointer (example: "/providers/openai/apiKey"), or "value" for singleValue mode.',
      ),
  })
  .strict();
var ExecSecretRefSchema = z3
  .object({
    source: z3.literal("exec"),
    provider: z3
      .string()
      .regex(
        SECRET_PROVIDER_ALIAS_PATTERN,
        'Secret reference provider must match /^[a-z][a-z0-9_-]{0,63}$/ (example: "default").',
      ),
    id: z3.string().refine(isValidExecSecretRefId, formatExecSecretRefIdValidationMessage()),
  })
  .strict();
var SecretRefSchema = z3.discriminatedUnion("source", [
  EnvSecretRefSchema,
  FileSecretRefSchema,
  ExecSecretRefSchema,
]);
var SecretInputSchema = z3.union([z3.string(), SecretRefSchema]);
var SecretsEnvProviderSchema = z3
  .object({
    source: z3.literal("env"),
    allowlist: z3.array(z3.string().regex(ENV_SECRET_REF_ID_PATTERN)).max(256).optional(),
  })
  .strict();
var SecretsFileProviderSchema = z3
  .object({
    source: z3.literal("file"),
    path: z3.string().min(1),
    mode: z3.union([z3.literal("singleValue"), z3.literal("json")]).optional(),
    timeoutMs: z3.number().int().positive().max(12e4).optional(),
    maxBytes: z3
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024)
      .optional(),
  })
  .strict();
var SecretsExecProviderSchema = z3
  .object({
    source: z3.literal("exec"),
    command: z3
      .string()
      .min(1)
      .refine((value) => isSafeExecutableValue(value), "secrets.providers.*.command is unsafe.")
      .refine(
        (value) => isAbsolutePath(value),
        "secrets.providers.*.command must be an absolute path.",
      ),
    args: z3.array(z3.string().max(1024)).max(128).optional(),
    timeoutMs: z3.number().int().positive().max(12e4).optional(),
    noOutputTimeoutMs: z3.number().int().positive().max(12e4).optional(),
    maxOutputBytes: z3
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024)
      .optional(),
    jsonOnly: z3.boolean().optional(),
    env: z3.record(z3.string(), z3.string()).optional(),
    passEnv: z3.array(z3.string().regex(ENV_SECRET_REF_ID_PATTERN)).max(128).optional(),
    trustedDirs: z3
      .array(
        z3
          .string()
          .min(1)
          .refine((value) => isAbsolutePath(value), "trustedDirs entries must be absolute paths."),
      )
      .max(64)
      .optional(),
    allowInsecurePath: z3.boolean().optional(),
    allowSymlinkCommand: z3.boolean().optional(),
  })
  .strict();
var SecretProviderSchema = z3.discriminatedUnion("source", [
  SecretsEnvProviderSchema,
  SecretsFileProviderSchema,
  SecretsExecProviderSchema,
]);
var SecretsConfigSchema = z3
  .object({
    providers: z3
      .object({
        // Keep this as a record so users can define multiple providers per source.
      })
      .catchall(SecretProviderSchema)
      .optional(),
    defaults: z3
      .object({
        env: z3.string().regex(SECRET_PROVIDER_ALIAS_PATTERN).optional(),
        file: z3.string().regex(SECRET_PROVIDER_ALIAS_PATTERN).optional(),
        exec: z3.string().regex(SECRET_PROVIDER_ALIAS_PATTERN).optional(),
      })
      .strict()
      .optional(),
    resolution: z3
      .object({
        maxProviderConcurrency: z3.number().int().positive().max(16).optional(),
        maxRefsPerProvider: z3.number().int().positive().max(4096).optional(),
        maxBatchBytes: z3
          .number()
          .int()
          .positive()
          .max(5 * 1024 * 1024)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();
var ModelApiSchema = z3.enum(MODEL_APIS);
var ModelCompatSchema = z3
  .object({
    supportsStore: z3.boolean().optional(),
    supportsDeveloperRole: z3.boolean().optional(),
    supportsReasoningEffort: z3.boolean().optional(),
    supportsUsageInStreaming: z3.boolean().optional(),
    supportsTools: z3.boolean().optional(),
    supportsStrictMode: z3.boolean().optional(),
    maxTokensField: z3
      .union([z3.literal("max_completion_tokens"), z3.literal("max_tokens")])
      .optional(),
    thinkingFormat: z3
      .union([
        z3.literal("openai"),
        z3.literal("openrouter"),
        z3.literal("zai"),
        z3.literal("qwen"),
        z3.literal("qwen-chat-template"),
      ])
      .optional(),
    requiresToolResultName: z3.boolean().optional(),
    requiresAssistantAfterToolResult: z3.boolean().optional(),
    requiresThinkingAsText: z3.boolean().optional(),
    toolSchemaProfile: z3.string().optional(),
    unsupportedToolSchemaKeywords: z3.array(z3.string().min(1)).optional(),
    nativeWebSearchTool: z3.boolean().optional(),
    toolCallArgumentsEncoding: z3.string().optional(),
    requiresMistralToolIds: z3.boolean().optional(),
    requiresOpenAiAnthropicToolPayload: z3.boolean().optional(),
  })
  .strict()
  .optional();
var ModelDefinitionSchema = z3
  .object({
    id: z3.string().min(1),
    name: z3.string().min(1),
    api: ModelApiSchema.optional(),
    reasoning: z3.boolean().optional(),
    input: z3.array(z3.union([z3.literal("text"), z3.literal("image")])).optional(),
    cost: z3
      .object({
        input: z3.number().optional(),
        output: z3.number().optional(),
        cacheRead: z3.number().optional(),
        cacheWrite: z3.number().optional(),
      })
      .strict()
      .optional(),
    contextWindow: z3.number().positive().optional(),
    maxTokens: z3.number().positive().optional(),
    headers: z3.record(z3.string(), z3.string()).optional(),
    compat: ModelCompatSchema,
  })
  .strict();
var ModelProviderSchema = z3
  .object({
    baseUrl: z3.string().min(1),
    apiKey: SecretInputSchema.optional().register(sensitive),
    auth: z3
      .union([
        z3.literal("api-key"),
        z3.literal("aws-sdk"),
        z3.literal("oauth"),
        z3.literal("token"),
      ])
      .optional(),
    api: ModelApiSchema.optional(),
    injectNumCtxForOpenAICompat: z3.boolean().optional(),
    headers: z3.record(z3.string(), SecretInputSchema.register(sensitive)).optional(),
    authHeader: z3.boolean().optional(),
    models: z3.array(ModelDefinitionSchema),
  })
  .strict();
var BedrockDiscoverySchema = z3
  .object({
    enabled: z3.boolean().optional(),
    region: z3.string().optional(),
    providerFilter: z3.array(z3.string()).optional(),
    refreshInterval: z3.number().int().nonnegative().optional(),
    defaultContextWindow: z3.number().int().positive().optional(),
    defaultMaxTokens: z3.number().int().positive().optional(),
  })
  .strict()
  .optional();
var ModelsConfigSchema = z3
  .object({
    mode: z3.union([z3.literal("merge"), z3.literal("replace")]).optional(),
    providers: z3.record(z3.string(), ModelProviderSchema).optional(),
    bedrockDiscovery: BedrockDiscoverySchema,
  })
  .strict()
  .optional();
var GroupChatSchema = z3
  .object({
    mentionPatterns: z3.array(z3.string()).optional(),
    historyLimit: z3.number().int().positive().optional(),
  })
  .strict()
  .optional();
var DmConfigSchema = z3
  .object({
    historyLimit: z3.number().int().min(0).optional(),
  })
  .strict();
var IdentitySchema = z3
  .object({
    name: z3.string().optional(),
    theme: z3.string().optional(),
    emoji: z3.string().optional(),
    avatar: z3.string().optional(),
  })
  .strict()
  .optional();
var QueueModeSchema = z3.union([
  z3.literal("steer"),
  z3.literal("followup"),
  z3.literal("collect"),
  z3.literal("steer-backlog"),
  z3.literal("steer+backlog"),
  z3.literal("queue"),
  z3.literal("interrupt"),
]);
var QueueDropSchema = z3.union([z3.literal("old"), z3.literal("new"), z3.literal("summarize")]);
var ReplyToModeSchema = z3.union([z3.literal("off"), z3.literal("first"), z3.literal("all")]);
var TypingModeSchema = z3.union([
  z3.literal("never"),
  z3.literal("instant"),
  z3.literal("thinking"),
  z3.literal("message"),
]);
var GroupPolicySchema = z3.enum(["open", "disabled", "allowlist"]);
var DmPolicySchema = z3.enum(["pairing", "allowlist", "open", "disabled"]);
var BlockStreamingCoalesceSchema = z3
  .object({
    minChars: z3.number().int().positive().optional(),
    maxChars: z3.number().int().positive().optional(),
    idleMs: z3.number().int().nonnegative().optional(),
  })
  .strict();
var ReplyRuntimeConfigSchemaShape = {
  historyLimit: z3.number().int().min(0).optional(),
  dmHistoryLimit: z3.number().int().min(0).optional(),
  dms: z3.record(z3.string(), DmConfigSchema.optional()).optional(),
  textChunkLimit: z3.number().int().positive().optional(),
  chunkMode: z3.enum(["length", "newline"]).optional(),
  blockStreaming: z3.boolean().optional(),
  blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
  responsePrefix: z3.string().optional(),
  mediaMaxMb: z3.number().positive().optional(),
};
var BlockStreamingChunkSchema = z3
  .object({
    minChars: z3.number().int().positive().optional(),
    maxChars: z3.number().int().positive().optional(),
    breakPreference: z3
      .union([z3.literal("paragraph"), z3.literal("newline"), z3.literal("sentence")])
      .optional(),
  })
  .strict();
var MarkdownTableModeSchema = z3.enum(["off", "bullets", "code", "block"]);
var MarkdownConfigSchema = z3
  .object({
    tables: MarkdownTableModeSchema.optional(),
  })
  .strict()
  .optional();
var TtsProviderSchema = z3.string().min(1);
var TtsModeSchema = z3.enum(["final", "all"]);
var TtsAutoSchema = z3.enum(["off", "always", "inbound", "tagged"]);
var TtsProviderConfigSchema = z3
  .object({
    apiKey: SecretInputSchema.optional().register(sensitive),
  })
  .catchall(
    z3.union([
      z3.string(),
      z3.number(),
      z3.boolean(),
      z3.null(),
      z3.array(z3.unknown()),
      z3.record(z3.string(), z3.unknown()),
    ]),
  );
var TtsConfigSchema = z3
  .object({
    auto: TtsAutoSchema.optional(),
    enabled: z3.boolean().optional(),
    mode: TtsModeSchema.optional(),
    provider: TtsProviderSchema.optional(),
    summaryModel: z3.string().optional(),
    modelOverrides: z3
      .object({
        enabled: z3.boolean().optional(),
        allowText: z3.boolean().optional(),
        allowProvider: z3.boolean().optional(),
        allowVoice: z3.boolean().optional(),
        allowModelId: z3.boolean().optional(),
        allowVoiceSettings: z3.boolean().optional(),
        allowNormalization: z3.boolean().optional(),
        allowSeed: z3.boolean().optional(),
      })
      .strict()
      .optional(),
    providers: z3.record(z3.string(), TtsProviderConfigSchema).optional(),
    prefsPath: z3.string().optional(),
    maxTextLength: z3.number().int().min(1).optional(),
    timeoutMs: z3.number().int().min(1e3).max(12e4).optional(),
  })
  .strict()
  .optional();
var HumanDelaySchema = z3
  .object({
    mode: z3.union([z3.literal("off"), z3.literal("natural"), z3.literal("custom")]).optional(),
    minMs: z3.number().int().nonnegative().optional(),
    maxMs: z3.number().int().nonnegative().optional(),
  })
  .strict();
var CliBackendWatchdogModeSchema = z3
  .object({
    noOutputTimeoutMs: z3.number().int().min(1e3).optional(),
    noOutputTimeoutRatio: z3.number().min(0.05).max(0.95).optional(),
    minMs: z3.number().int().min(1e3).optional(),
    maxMs: z3.number().int().min(1e3).optional(),
  })
  .strict()
  .optional();
var CliBackendSchema = z3
  .object({
    command: z3.string(),
    args: z3.array(z3.string()).optional(),
    output: z3.union([z3.literal("json"), z3.literal("text"), z3.literal("jsonl")]).optional(),
    resumeOutput: z3
      .union([z3.literal("json"), z3.literal("text"), z3.literal("jsonl")])
      .optional(),
    input: z3.union([z3.literal("arg"), z3.literal("stdin")]).optional(),
    maxPromptArgChars: z3.number().int().positive().optional(),
    env: z3.record(z3.string(), z3.string()).optional(),
    clearEnv: z3.array(z3.string()).optional(),
    modelArg: z3.string().optional(),
    modelAliases: z3.record(z3.string(), z3.string()).optional(),
    sessionArg: z3.string().optional(),
    sessionArgs: z3.array(z3.string()).optional(),
    resumeArgs: z3.array(z3.string()).optional(),
    sessionMode: z3
      .union([z3.literal("always"), z3.literal("existing"), z3.literal("none")])
      .optional(),
    sessionIdFields: z3.array(z3.string()).optional(),
    systemPromptArg: z3.string().optional(),
    systemPromptMode: z3.union([z3.literal("append"), z3.literal("replace")]).optional(),
    systemPromptWhen: z3
      .union([z3.literal("first"), z3.literal("always"), z3.literal("never")])
      .optional(),
    imageArg: z3.string().optional(),
    imageMode: z3.union([z3.literal("repeat"), z3.literal("list")]).optional(),
    serialize: z3.boolean().optional(),
    reliability: z3
      .object({
        watchdog: z3
          .object({
            fresh: CliBackendWatchdogModeSchema,
            resume: CliBackendWatchdogModeSchema,
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
var normalizeAllowFrom = (values) => (values ?? []).map((v) => String(v).trim()).filter(Boolean);
var requireOpenAllowFrom = (params) => {
  if (params.policy !== "open") {
    return;
  }
  const allow = normalizeAllowFrom(params.allowFrom);
  if (allow.includes("*")) {
    return;
  }
  params.ctx.addIssue({
    code: z3.ZodIssueCode.custom,
    path: params.path,
    message: params.message,
  });
};
var requireAllowlistAllowFrom = (params) => {
  if (params.policy !== "allowlist") {
    return;
  }
  const allow = normalizeAllowFrom(params.allowFrom);
  if (allow.length > 0) {
    return;
  }
  params.ctx.addIssue({
    code: z3.ZodIssueCode.custom,
    path: params.path,
    message: params.message,
  });
};
var MSTeamsReplyStyleSchema = z3.enum(["thread", "top-level"]);
var RetryConfigSchema = z3
  .object({
    attempts: z3.number().int().min(1).optional(),
    minDelayMs: z3.number().int().min(0).optional(),
    maxDelayMs: z3.number().int().min(0).optional(),
    jitter: z3.number().min(0).max(1).optional(),
  })
  .strict()
  .optional();
var QueueModeBySurfaceSchema = z3
  .object({
    whatsapp: QueueModeSchema.optional(),
    telegram: QueueModeSchema.optional(),
    discord: QueueModeSchema.optional(),
    irc: QueueModeSchema.optional(),
    slack: QueueModeSchema.optional(),
    mattermost: QueueModeSchema.optional(),
    signal: QueueModeSchema.optional(),
    imessage: QueueModeSchema.optional(),
    msteams: QueueModeSchema.optional(),
    webchat: QueueModeSchema.optional(),
  })
  .strict()
  .optional();
var DebounceMsBySurfaceSchema = z3.record(z3.string(), z3.number().int().nonnegative()).optional();
var QueueSchema = z3
  .object({
    mode: QueueModeSchema.optional(),
    byChannel: QueueModeBySurfaceSchema,
    debounceMs: z3.number().int().nonnegative().optional(),
    debounceMsByChannel: DebounceMsBySurfaceSchema,
    cap: z3.number().int().positive().optional(),
    drop: QueueDropSchema.optional(),
  })
  .strict()
  .optional();
var InboundDebounceSchema = z3
  .object({
    debounceMs: z3.number().int().nonnegative().optional(),
    byChannel: DebounceMsBySurfaceSchema,
  })
  .strict()
  .optional();
var TranscribeAudioSchema = z3
  .object({
    command: z3.array(z3.string()).superRefine((value, ctx) => {
      const executable = value[0];
      if (!isSafeExecutableValue(executable)) {
        ctx.addIssue({
          code: z3.ZodIssueCode.custom,
          path: [0],
          message: "expected safe executable name or path",
        });
      }
    }),
    timeoutSeconds: z3.number().int().positive().optional(),
  })
  .strict()
  .optional();
var HexColorSchema = z3.string().regex(/^#?[0-9a-fA-F]{6}$/, "expected hex color (RRGGBB)");
var ExecutableTokenSchema = z3
  .string()
  .refine(isSafeExecutableValue, "expected safe executable name or path");
var MediaUnderstandingScopeSchema = createAllowDenyChannelRulesSchema();
var MediaUnderstandingCapabilitiesSchema = z3
  .array(z3.union([z3.literal("image"), z3.literal("audio"), z3.literal("video")]))
  .optional();
var MediaUnderstandingAttachmentsSchema = z3
  .object({
    mode: z3.union([z3.literal("first"), z3.literal("all")]).optional(),
    maxAttachments: z3.number().int().positive().optional(),
    prefer: z3
      .union([z3.literal("first"), z3.literal("last"), z3.literal("path"), z3.literal("url")])
      .optional(),
  })
  .strict()
  .optional();
var DeepgramAudioSchema = z3
  .object({
    detectLanguage: z3.boolean().optional(),
    punctuate: z3.boolean().optional(),
    smartFormat: z3.boolean().optional(),
  })
  .strict()
  .optional();
var ProviderOptionValueSchema = z3.union([z3.string(), z3.number(), z3.boolean()]);
var ProviderOptionsSchema = z3
  .record(z3.string(), z3.record(z3.string(), ProviderOptionValueSchema))
  .optional();
var MediaUnderstandingRuntimeFields = {
  prompt: z3.string().optional(),
  timeoutSeconds: z3.number().int().positive().optional(),
  language: z3.string().optional(),
  providerOptions: ProviderOptionsSchema,
  deepgram: DeepgramAudioSchema,
  baseUrl: z3.string().optional(),
  headers: z3.record(z3.string(), z3.string()).optional(),
};
var MediaUnderstandingModelSchema = z3
  .object({
    provider: z3.string().optional(),
    model: z3.string().optional(),
    capabilities: MediaUnderstandingCapabilitiesSchema,
    type: z3.union([z3.literal("provider"), z3.literal("cli")]).optional(),
    command: z3.string().optional(),
    args: z3.array(z3.string()).optional(),
    maxChars: z3.number().int().positive().optional(),
    maxBytes: z3.number().int().positive().optional(),
    ...MediaUnderstandingRuntimeFields,
    profile: z3.string().optional(),
    preferredProfile: z3.string().optional(),
  })
  .strict()
  .optional();
var ToolsMediaUnderstandingSchema = z3
  .object({
    enabled: z3.boolean().optional(),
    scope: MediaUnderstandingScopeSchema,
    maxBytes: z3.number().int().positive().optional(),
    maxChars: z3.number().int().positive().optional(),
    ...MediaUnderstandingRuntimeFields,
    attachments: MediaUnderstandingAttachmentsSchema,
    models: z3.array(MediaUnderstandingModelSchema).optional(),
    echoTranscript: z3.boolean().optional(),
    echoFormat: z3.string().optional(),
  })
  .strict()
  .optional();
var ToolsMediaSchema = z3
  .object({
    models: z3.array(MediaUnderstandingModelSchema).optional(),
    concurrency: z3.number().int().positive().optional(),
    image: ToolsMediaUnderstandingSchema.optional(),
    audio: ToolsMediaUnderstandingSchema.optional(),
    video: ToolsMediaUnderstandingSchema.optional(),
  })
  .strict()
  .optional();
var LinkModelSchema = z3
  .object({
    type: z3.literal("cli").optional(),
    command: z3.string().min(1),
    args: z3.array(z3.string()).optional(),
    timeoutSeconds: z3.number().int().positive().optional(),
  })
  .strict();
var ToolsLinksSchema = z3
  .object({
    enabled: z3.boolean().optional(),
    scope: MediaUnderstandingScopeSchema,
    maxLinks: z3.number().int().positive().optional(),
    timeoutSeconds: z3.number().int().positive().optional(),
    models: z3.array(LinkModelSchema).optional(),
  })
  .strict()
  .optional();
var NativeCommandsSettingSchema = z3.union([z3.boolean(), z3.literal("auto")]);
var ProviderCommandsSchema = z3
  .object({
    native: NativeCommandsSettingSchema.optional(),
    nativeSkills: NativeCommandsSettingSchema.optional(),
  })
  .strict()
  .optional();

// src/channels/plugins/config-schema.ts
var AllowFromEntrySchema = z4.union([z4.string(), z4.number()]);
var AllowFromListSchema = z4.array(AllowFromEntrySchema).optional();
function cloneRuntimeIssue(issue) {
  const record = issue && typeof issue === "object" ? issue : {};
  const path23 = Array.isArray(record.path)
    ? record.path.filter((segment) => {
        const kind = typeof segment;
        return kind === "string" || kind === "number";
      })
    : void 0;
  return {
    ...record,
    ...(path23 ? { path: path23 } : {}),
  };
}
function safeParseRuntimeSchema(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }
  return {
    success: false,
    issues: result.error.issues.map((issue) => cloneRuntimeIssue(issue)),
  };
}
function buildChannelConfigSchema(schema, options) {
  const schemaWithJson = schema;
  if (typeof schemaWithJson.toJSONSchema === "function") {
    return {
      schema: schemaWithJson.toJSONSchema({
        target: "draft-07",
        unrepresentable: "any",
      }),
      ...(options?.uiHints ? { uiHints: options.uiHints } : {}),
      runtime: {
        safeParse: (value) => safeParseRuntimeSchema(schema, value),
      },
    };
  }
  return {
    schema: {
      type: "object",
      additionalProperties: true,
    },
    ...(options?.uiHints ? { uiHints: options.uiHints } : {}),
    runtime: {
      safeParse: (value) => safeParseRuntimeSchema(schema, value),
    },
  };
}

// src/plugins/bundled-dir.ts
import fs8 from "node:fs";
import path14 from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
function isSourceCheckoutRoot(packageRoot) {
  return (
    fs8.existsSync(path14.join(packageRoot, ".git")) &&
    fs8.existsSync(path14.join(packageRoot, "src")) &&
    fs8.existsSync(path14.join(packageRoot, "extensions"))
  );
}
function resolveBundledDirFromPackageRoot(packageRoot, preferSourceCheckout) {
  const sourceExtensionsDir = path14.join(packageRoot, "extensions");
  const builtExtensionsDir = path14.join(packageRoot, "dist", "extensions");
  if (
    (preferSourceCheckout || isSourceCheckoutRoot(packageRoot)) &&
    fs8.existsSync(sourceExtensionsDir)
  ) {
    return sourceExtensionsDir;
  }
  const runtimeExtensionsDir = path14.join(packageRoot, "dist-runtime", "extensions");
  if (fs8.existsSync(runtimeExtensionsDir) && fs8.existsSync(builtExtensionsDir)) {
    return runtimeExtensionsDir;
  }
  if (fs8.existsSync(builtExtensionsDir)) {
    return builtExtensionsDir;
  }
  return void 0;
}
function resolveBundledPluginsDir(env = process.env) {
  const override = env.OPENCLAW_BUNDLED_PLUGINS_DIR?.trim();
  if (override) {
    const resolvedOverride = resolveUserPath2(override, env);
    if (fs8.existsSync(resolvedOverride)) {
      return resolvedOverride;
    }
    try {
      const argvPackageRoot = resolveOpenClawPackageRootSync({ argv1: process.argv[1] });
      if (argvPackageRoot && !isSourceCheckoutRoot(argvPackageRoot)) {
        const argvFallback = resolveBundledDirFromPackageRoot(argvPackageRoot, false);
        if (argvFallback) {
          return argvFallback;
        }
      }
    } catch {}
    return resolvedOverride;
  }
  const preferSourceCheckout = Boolean(env.VITEST);
  try {
    const packageRoots = [
      resolveOpenClawPackageRootSync({ argv1: process.argv[1] }),
      resolveOpenClawPackageRootSync({ cwd: process.cwd() }),
      resolveOpenClawPackageRootSync({ moduleUrl: import.meta.url }),
    ].filter((entry, index, all) => Boolean(entry) && all.indexOf(entry) === index);
    for (const packageRoot of packageRoots) {
      const bundledDir = resolveBundledDirFromPackageRoot(packageRoot, preferSourceCheckout);
      if (bundledDir) {
        return bundledDir;
      }
    }
  } catch {}
  try {
    const execDir = path14.dirname(process.execPath);
    const siblingBuilt = path14.join(execDir, "dist", "extensions");
    if (fs8.existsSync(siblingBuilt)) {
      return siblingBuilt;
    }
    const sibling = path14.join(execDir, "extensions");
    if (fs8.existsSync(sibling)) {
      return sibling;
    }
  } catch {}
  try {
    let cursor = path14.dirname(fileURLToPath3(import.meta.url));
    for (let i = 0; i < 6; i += 1) {
      const candidate = path14.join(cursor, "extensions");
      if (fs8.existsSync(candidate)) {
        return candidate;
      }
      const parent = path14.dirname(cursor);
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
  } catch {}
  return void 0;
}

// src/plugins/manifest.ts
import fs9 from "node:fs";
import path15 from "node:path";

// src/compat/legacy-names.ts
var PROJECT_NAME = "openclaw";
var MANIFEST_KEY = PROJECT_NAME;

// src/plugins/manifest.ts
var PLUGIN_MANIFEST_FILENAME = "openclaw.plugin.json";
var PLUGIN_MANIFEST_FILENAMES = [PLUGIN_MANIFEST_FILENAME];
function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}
function normalizeStringListRecord(value) {
  if (!isRecord(value)) {
    return void 0;
  }
  const normalized = {};
  for (const [key, rawValues] of Object.entries(value)) {
    const providerId = typeof key === "string" ? key.trim() : "";
    if (!providerId) {
      continue;
    }
    const values = normalizeStringList(rawValues);
    if (values.length === 0) {
      continue;
    }
    normalized[providerId] = values;
  }
  return Object.keys(normalized).length > 0 ? normalized : void 0;
}
function normalizeManifestContracts(value) {
  if (!isRecord(value)) {
    return void 0;
  }
  const speechProviders = normalizeStringList(value.speechProviders);
  const mediaUnderstandingProviders = normalizeStringList(value.mediaUnderstandingProviders);
  const imageGenerationProviders = normalizeStringList(value.imageGenerationProviders);
  const webSearchProviders = normalizeStringList(value.webSearchProviders);
  const tools = normalizeStringList(value.tools);
  const contracts = {
    ...(speechProviders.length > 0 ? { speechProviders } : {}),
    ...(mediaUnderstandingProviders.length > 0 ? { mediaUnderstandingProviders } : {}),
    ...(imageGenerationProviders.length > 0 ? { imageGenerationProviders } : {}),
    ...(webSearchProviders.length > 0 ? { webSearchProviders } : {}),
    ...(tools.length > 0 ? { tools } : {}),
  };
  return Object.keys(contracts).length > 0 ? contracts : void 0;
}
function normalizeProviderAuthChoices(value) {
  if (!Array.isArray(value)) {
    return void 0;
  }
  const normalized = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const provider = typeof entry.provider === "string" ? entry.provider.trim() : "";
    const method = typeof entry.method === "string" ? entry.method.trim() : "";
    const choiceId = typeof entry.choiceId === "string" ? entry.choiceId.trim() : "";
    if (!provider || !method || !choiceId) {
      continue;
    }
    const choiceLabel = typeof entry.choiceLabel === "string" ? entry.choiceLabel.trim() : "";
    const choiceHint = typeof entry.choiceHint === "string" ? entry.choiceHint.trim() : "";
    const deprecatedChoiceIds = normalizeStringList(entry.deprecatedChoiceIds);
    const groupId = typeof entry.groupId === "string" ? entry.groupId.trim() : "";
    const groupLabel = typeof entry.groupLabel === "string" ? entry.groupLabel.trim() : "";
    const groupHint = typeof entry.groupHint === "string" ? entry.groupHint.trim() : "";
    const optionKey = typeof entry.optionKey === "string" ? entry.optionKey.trim() : "";
    const cliFlag = typeof entry.cliFlag === "string" ? entry.cliFlag.trim() : "";
    const cliOption = typeof entry.cliOption === "string" ? entry.cliOption.trim() : "";
    const cliDescription =
      typeof entry.cliDescription === "string" ? entry.cliDescription.trim() : "";
    const onboardingScopes = normalizeStringList(entry.onboardingScopes).filter(
      (scope) => scope === "text-inference" || scope === "image-generation",
    );
    normalized.push({
      provider,
      method,
      choiceId,
      ...(choiceLabel ? { choiceLabel } : {}),
      ...(choiceHint ? { choiceHint } : {}),
      ...(deprecatedChoiceIds.length > 0 ? { deprecatedChoiceIds } : {}),
      ...(groupId ? { groupId } : {}),
      ...(groupLabel ? { groupLabel } : {}),
      ...(groupHint ? { groupHint } : {}),
      ...(optionKey ? { optionKey } : {}),
      ...(cliFlag ? { cliFlag } : {}),
      ...(cliOption ? { cliOption } : {}),
      ...(cliDescription ? { cliDescription } : {}),
      ...(onboardingScopes.length > 0 ? { onboardingScopes } : {}),
    });
  }
  return normalized.length > 0 ? normalized : void 0;
}
function normalizeChannelConfigs(value) {
  if (!isRecord(value)) {
    return void 0;
  }
  const normalized = {};
  for (const [key, rawEntry] of Object.entries(value)) {
    const channelId = typeof key === "string" ? key.trim() : "";
    if (!channelId || !isRecord(rawEntry)) {
      continue;
    }
    const schema = isRecord(rawEntry.schema) ? rawEntry.schema : null;
    if (!schema) {
      continue;
    }
    const uiHints = isRecord(rawEntry.uiHints) ? rawEntry.uiHints : void 0;
    const label = typeof rawEntry.label === "string" ? rawEntry.label.trim() : "";
    const description = typeof rawEntry.description === "string" ? rawEntry.description.trim() : "";
    const preferOver = normalizeStringList(rawEntry.preferOver);
    normalized[channelId] = {
      schema,
      ...(uiHints ? { uiHints } : {}),
      ...(label ? { label } : {}),
      ...(description ? { description } : {}),
      ...(preferOver.length > 0 ? { preferOver } : {}),
    };
  }
  return Object.keys(normalized).length > 0 ? normalized : void 0;
}
function resolvePluginManifestPath(rootDir) {
  for (const filename of PLUGIN_MANIFEST_FILENAMES) {
    const candidate = path15.join(rootDir, filename);
    if (fs9.existsSync(candidate)) {
      return candidate;
    }
  }
  return path15.join(rootDir, PLUGIN_MANIFEST_FILENAME);
}
function parsePluginKind(raw) {
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw) && raw.length > 0 && raw.every((k) => typeof k === "string")) {
    return raw.length === 1 ? raw[0] : raw;
  }
  return void 0;
}
function loadPluginManifest(rootDir, rejectHardlinks = true) {
  const manifestPath = resolvePluginManifestPath(rootDir);
  const opened = openBoundaryFileSync({
    absolutePath: manifestPath,
    rootPath: rootDir,
    boundaryLabel: "plugin root",
    rejectHardlinks,
  });
  if (!opened.ok) {
    return matchBoundaryFileOpenFailure(opened, {
      path: () => ({
        ok: false,
        error: `plugin manifest not found: ${manifestPath}`,
        manifestPath,
      }),
      fallback: (failure) => ({
        ok: false,
        error: `unsafe plugin manifest path: ${manifestPath} (${failure.reason})`,
        manifestPath,
      }),
    });
  }
  let raw;
  try {
    raw = JSON.parse(fs9.readFileSync(opened.fd, "utf-8"));
  } catch (err) {
    return {
      ok: false,
      error: `failed to parse plugin manifest: ${String(err)}`,
      manifestPath,
    };
  } finally {
    fs9.closeSync(opened.fd);
  }
  if (!isRecord(raw)) {
    return { ok: false, error: "plugin manifest must be an object", manifestPath };
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) {
    return { ok: false, error: "plugin manifest requires id", manifestPath };
  }
  const configSchema = isRecord(raw.configSchema) ? raw.configSchema : null;
  if (!configSchema) {
    return { ok: false, error: "plugin manifest requires configSchema", manifestPath };
  }
  const kind = parsePluginKind(raw.kind);
  const enabledByDefault = raw.enabledByDefault === true;
  const legacyPluginIds = normalizeStringList(raw.legacyPluginIds);
  const autoEnableWhenConfiguredProviders = normalizeStringList(
    raw.autoEnableWhenConfiguredProviders,
  );
  const name = typeof raw.name === "string" ? raw.name.trim() : void 0;
  const description = typeof raw.description === "string" ? raw.description.trim() : void 0;
  const version = typeof raw.version === "string" ? raw.version.trim() : void 0;
  const channels = normalizeStringList(raw.channels);
  const providers = normalizeStringList(raw.providers);
  const cliBackends = normalizeStringList(raw.cliBackends);
  const providerAuthEnvVars = normalizeStringListRecord(raw.providerAuthEnvVars);
  const providerAuthChoices = normalizeProviderAuthChoices(raw.providerAuthChoices);
  const skills = normalizeStringList(raw.skills);
  const contracts = normalizeManifestContracts(raw.contracts);
  const channelConfigs = normalizeChannelConfigs(raw.channelConfigs);
  let uiHints;
  if (isRecord(raw.uiHints)) {
    uiHints = raw.uiHints;
  }
  return {
    ok: true,
    manifest: {
      id,
      configSchema,
      ...(enabledByDefault ? { enabledByDefault } : {}),
      ...(legacyPluginIds.length > 0 ? { legacyPluginIds } : {}),
      ...(autoEnableWhenConfiguredProviders.length > 0
        ? { autoEnableWhenConfiguredProviders }
        : {}),
      kind,
      channels,
      providers,
      cliBackends,
      providerAuthEnvVars,
      providerAuthChoices,
      skills,
      name,
      description,
      version,
      uiHints,
      contracts,
      channelConfigs,
    },
    manifestPath,
  };
}
function getPackageManifestMetadata(manifest) {
  if (!manifest) {
    return void 0;
  }
  return manifest[MANIFEST_KEY];
}

// src/plugins/sdk-alias.ts
import fs10 from "node:fs";
import path16 from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";
var STARTUP_ARGV1 = process.argv[1];
function resolveLoaderModulePath(params = {}) {
  return params.modulePath ?? fileURLToPath4(params.moduleUrl ?? import.meta.url);
}
function readPluginSdkPackageJson(packageRoot) {
  try {
    const pkgRaw = fs10.readFileSync(path16.join(packageRoot, "package.json"), "utf-8");
    return JSON.parse(pkgRaw);
  } catch {
    return null;
  }
}
function isSafePluginSdkSubpathSegment(subpath) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(subpath);
}
function listPluginSdkSubpathsFromPackageJson(pkg) {
  return Object.keys(pkg.exports ?? {})
    .filter((key) => key.startsWith("./plugin-sdk/"))
    .map((key) => key.slice("./plugin-sdk/".length))
    .filter((subpath) => isSafePluginSdkSubpathSegment(subpath))
    .toSorted();
}
function hasTrustedOpenClawRootIndicator(params) {
  const packageExports = params.packageJson.exports ?? {};
  const hasPluginSdkRootExport = Object.prototype.hasOwnProperty.call(
    packageExports,
    "./plugin-sdk",
  );
  if (!hasPluginSdkRootExport) {
    return false;
  }
  const hasCliEntryExport = Object.prototype.hasOwnProperty.call(packageExports, "./cli-entry");
  const hasOpenClawBin =
    (typeof params.packageJson.bin === "string" &&
      params.packageJson.bin.toLowerCase().includes("openclaw")) ||
    (typeof params.packageJson.bin === "object" &&
      params.packageJson.bin !== null &&
      typeof params.packageJson.bin.openclaw === "string");
  const hasOpenClawEntrypoint = fs10.existsSync(path16.join(params.packageRoot, "openclaw.mjs"));
  return hasCliEntryExport || hasOpenClawBin || hasOpenClawEntrypoint;
}
function readPluginSdkSubpathsFromPackageRoot(packageRoot) {
  const pkg = readPluginSdkPackageJson(packageRoot);
  if (!pkg) {
    return null;
  }
  if (!hasTrustedOpenClawRootIndicator({ packageRoot, packageJson: pkg })) {
    return null;
  }
  const subpaths = listPluginSdkSubpathsFromPackageJson(pkg);
  return subpaths.length > 0 ? subpaths : null;
}
function resolveTrustedOpenClawRootFromArgvHint(params) {
  if (!params.argv1) {
    return null;
  }
  const packageRoot = resolveOpenClawPackageRootSync({
    cwd: params.cwd,
    argv1: params.argv1,
  });
  if (!packageRoot) {
    return null;
  }
  const packageJson = readPluginSdkPackageJson(packageRoot);
  if (!packageJson) {
    return null;
  }
  return hasTrustedOpenClawRootIndicator({ packageRoot, packageJson }) ? packageRoot : null;
}
function findNearestPluginSdkPackageRoot(startDir, maxDepth = 12) {
  let cursor = path16.resolve(startDir);
  for (let i = 0; i < maxDepth; i += 1) {
    const subpaths = readPluginSdkSubpathsFromPackageRoot(cursor);
    if (subpaths) {
      return cursor;
    }
    const parent = path16.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  return null;
}
function resolveLoaderPackageRoot(params) {
  const cwd = params.cwd ?? path16.dirname(params.modulePath);
  const fromModulePath = resolveOpenClawPackageRootSync({ cwd });
  if (fromModulePath) {
    return fromModulePath;
  }
  const argv1 = params.argv1 ?? process.argv[1];
  const moduleUrl = params.moduleUrl ?? (params.modulePath ? void 0 : import.meta.url);
  return resolveOpenClawPackageRootSync({
    cwd,
    ...(argv1 ? { argv1 } : {}),
    ...(moduleUrl ? { moduleUrl } : {}),
  });
}
function resolveLoaderPluginSdkPackageRoot(params) {
  const cwd = params.cwd ?? path16.dirname(params.modulePath);
  const fromCwd = resolveOpenClawPackageRootSync({ cwd });
  const fromExplicitHints =
    resolveTrustedOpenClawRootFromArgvHint({ cwd, argv1: params.argv1 }) ??
    (params.moduleUrl
      ? resolveOpenClawPackageRootSync({
          cwd,
          moduleUrl: params.moduleUrl,
        })
      : null);
  return (
    fromCwd ??
    fromExplicitHints ??
    findNearestPluginSdkPackageRoot(path16.dirname(params.modulePath)) ??
    (params.cwd ? findNearestPluginSdkPackageRoot(params.cwd) : null) ??
    findNearestPluginSdkPackageRoot(process.cwd())
  );
}
function resolvePluginSdkAliasCandidateOrder(params) {
  if (params.pluginSdkResolution === "dist") {
    return ["dist", "src"];
  }
  if (params.pluginSdkResolution === "src") {
    return ["src", "dist"];
  }
  const normalizedModulePath = params.modulePath.replace(/\\/g, "/");
  const isDistRuntime = normalizedModulePath.includes("/dist/");
  return isDistRuntime || params.isProduction ? ["dist", "src"] : ["src", "dist"];
}
function listPluginSdkAliasCandidates(params) {
  const orderedKinds = resolvePluginSdkAliasCandidateOrder({
    modulePath: params.modulePath,
    isProduction: process.env.NODE_ENV === "production",
    pluginSdkResolution: params.pluginSdkResolution,
  });
  const packageRoot = resolveLoaderPluginSdkPackageRoot(params);
  if (packageRoot) {
    const candidateMap = {
      src: path16.join(packageRoot, "src", "plugin-sdk", params.srcFile),
      dist: path16.join(packageRoot, "dist", "plugin-sdk", params.distFile),
    };
    return orderedKinds.map((kind) => candidateMap[kind]);
  }
  let cursor = path16.dirname(params.modulePath);
  const candidates = [];
  for (let i = 0; i < 6; i += 1) {
    const candidateMap = {
      src: path16.join(cursor, "src", "plugin-sdk", params.srcFile),
      dist: path16.join(cursor, "dist", "plugin-sdk", params.distFile),
    };
    for (const kind of orderedKinds) {
      candidates.push(candidateMap[kind]);
    }
    const parent = path16.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  return candidates;
}
function resolvePluginSdkAliasFile(params) {
  try {
    const modulePath = resolveLoaderModulePath(params);
    for (const candidate of listPluginSdkAliasCandidates({
      srcFile: params.srcFile,
      distFile: params.distFile,
      modulePath,
      argv1: params.argv1,
      cwd: params.cwd,
      moduleUrl: params.moduleUrl,
      pluginSdkResolution: params.pluginSdkResolution,
    })) {
      if (fs10.existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {}
  return null;
}
var cachedPluginSdkExportedSubpaths = /* @__PURE__ */ new Map();
var cachedPluginSdkScopedAliasMaps = /* @__PURE__ */ new Map();
function listPluginSdkExportedSubpaths(params = {}) {
  const modulePath = params.modulePath ?? fileURLToPath4(import.meta.url);
  const packageRoot = resolveLoaderPluginSdkPackageRoot({
    modulePath,
    argv1: params.argv1,
    moduleUrl: params.moduleUrl,
  });
  if (!packageRoot) {
    return [];
  }
  const cached = cachedPluginSdkExportedSubpaths.get(packageRoot);
  if (cached) {
    return cached;
  }
  const subpaths = readPluginSdkSubpathsFromPackageRoot(packageRoot) ?? [];
  cachedPluginSdkExportedSubpaths.set(packageRoot, subpaths);
  return subpaths;
}
function resolvePluginSdkScopedAliasMap(params = {}) {
  const modulePath = params.modulePath ?? fileURLToPath4(import.meta.url);
  const packageRoot = resolveLoaderPluginSdkPackageRoot({
    modulePath,
    argv1: params.argv1,
    moduleUrl: params.moduleUrl,
  });
  if (!packageRoot) {
    return {};
  }
  const orderedKinds = resolvePluginSdkAliasCandidateOrder({
    modulePath,
    isProduction: process.env.NODE_ENV === "production",
    pluginSdkResolution: params.pluginSdkResolution,
  });
  const cacheKey = `${packageRoot}::${orderedKinds.join(",")}`;
  const cached = cachedPluginSdkScopedAliasMaps.get(cacheKey);
  if (cached) {
    return cached;
  }
  const aliasMap = {};
  for (const subpath of listPluginSdkExportedSubpaths({
    modulePath,
    argv1: params.argv1,
    moduleUrl: params.moduleUrl,
    pluginSdkResolution: params.pluginSdkResolution,
  })) {
    const candidateMap = {
      src: path16.join(packageRoot, "src", "plugin-sdk", `${subpath}.ts`),
      dist: path16.join(packageRoot, "dist", "plugin-sdk", `${subpath}.js`),
    };
    for (const kind of orderedKinds) {
      const candidate = candidateMap[kind];
      if (fs10.existsSync(candidate)) {
        aliasMap[`openclaw/plugin-sdk/${subpath}`] = candidate;
        break;
      }
    }
  }
  cachedPluginSdkScopedAliasMaps.set(cacheKey, aliasMap);
  return aliasMap;
}
function resolveExtensionApiAlias(params = {}) {
  try {
    const modulePath = resolveLoaderModulePath(params);
    const packageRoot = resolveLoaderPackageRoot({ ...params, modulePath });
    if (!packageRoot) {
      return null;
    }
    const orderedKinds = resolvePluginSdkAliasCandidateOrder({
      modulePath,
      isProduction: process.env.NODE_ENV === "production",
      pluginSdkResolution: params.pluginSdkResolution,
    });
    const candidateMap = {
      src: path16.join(packageRoot, "src", "extensionAPI.ts"),
      dist: path16.join(packageRoot, "dist", "extensionAPI.js"),
    };
    for (const kind of orderedKinds) {
      const candidate = candidateMap[kind];
      if (fs10.existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {}
  return null;
}
function buildPluginLoaderAliasMap(
  modulePath,
  argv1 = STARTUP_ARGV1,
  moduleUrl,
  pluginSdkResolution = "auto",
) {
  const pluginSdkAlias = resolvePluginSdkAliasFile({
    srcFile: "root-alias.cjs",
    distFile: "root-alias.cjs",
    modulePath,
    argv1,
    moduleUrl,
    pluginSdkResolution,
  });
  const extensionApiAlias = resolveExtensionApiAlias({ modulePath, pluginSdkResolution });
  return {
    ...(extensionApiAlias ? { "openclaw/extension-api": extensionApiAlias } : {}),
    ...(pluginSdkAlias ? { "openclaw/plugin-sdk": pluginSdkAlias } : {}),
    ...resolvePluginSdkScopedAliasMap({ modulePath, argv1, moduleUrl, pluginSdkResolution }),
  };
}
function buildPluginLoaderJitiOptions(aliasMap) {
  return {
    interopDefault: true,
    // Prefer Node's native sync ESM loader for built dist/*.js modules so
    // bundled plugins and plugin-sdk subpaths stay on the canonical module graph.
    tryNative: true,
    extensions: [".ts", ".tsx", ".mts", ".cts", ".mtsx", ".ctsx", ".js", ".mjs", ".cjs", ".json"],
    ...(Object.keys(aliasMap).length > 0
      ? {
          alias: aliasMap,
        }
      : {}),
  };
}
function shouldPreferNativeJiti(modulePath) {
  const versions = process.versions;
  if (typeof versions.bun === "string") {
    return false;
  }
  switch (path16.extname(modulePath).toLowerCase()) {
    case ".js":
    case ".mjs":
    case ".cjs":
    case ".json":
      return true;
    default:
      return false;
  }
}

// src/plugins/bundled-plugin-metadata.ts
var OPENCLAW_PACKAGE_ROOT =
  resolveLoaderPackageRoot({
    modulePath: fileURLToPath5(import.meta.url),
    moduleUrl: import.meta.url,
  }) ?? fileURLToPath5(new URL("../..", import.meta.url));
var CURRENT_MODULE_PATH = fileURLToPath5(import.meta.url);
var RUNNING_FROM_BUILT_ARTIFACT =
  CURRENT_MODULE_PATH.includes(`${path17.sep}dist${path17.sep}`) ||
  CURRENT_MODULE_PATH.includes(`${path17.sep}dist-runtime${path17.sep}`);
var PUBLIC_SURFACE_SOURCE_EXTENSIONS = [".ts", ".mts", ".js", ".mjs", ".cts", ".cjs"];
var RUNTIME_SIDECAR_ARTIFACTS = /* @__PURE__ */ new Set([
  "helper-api.js",
  "light-runtime-api.js",
  "runtime-api.js",
  "thread-bindings-runtime.js",
]);
var SOURCE_CONFIG_SCHEMA_CANDIDATES = [
  path17.join("src", "config-schema.ts"),
  path17.join("src", "config-schema.js"),
  path17.join("src", "config-schema.mts"),
  path17.join("src", "config-schema.mjs"),
  path17.join("src", "config-schema.cts"),
  path17.join("src", "config-schema.cjs"),
];
var PUBLIC_CONFIG_SURFACE_BASENAMES = ["channel-config-api", "runtime-api", "api"];
var bundledPluginMetadataCache = /* @__PURE__ */ new Map();
var jitiLoaders = /* @__PURE__ */ new Map();
function trimString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : void 0;
}
function normalizeStringList2(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => trimString(entry) ?? "").filter(Boolean);
}
function rewriteEntryToBuiltPath(entry) {
  if (!entry) {
    return void 0;
  }
  const normalized = entry.replace(/^\.\//u, "");
  return normalized.replace(/\.[^.]+$/u, ".js");
}
function readPackageManifest(pluginDir) {
  const packagePath = path17.join(pluginDir, "package.json");
  if (!fs11.existsSync(packagePath)) {
    return void 0;
  }
  try {
    return JSON.parse(fs11.readFileSync(packagePath, "utf-8"));
  } catch {
    return void 0;
  }
}
function deriveIdHint(params) {
  const base = path17.basename(params.entryPath, path17.extname(params.entryPath));
  if (!params.hasMultipleExtensions) {
    return params.manifestId;
  }
  const packageName = trimString(params.packageName);
  if (!packageName) {
    return `${params.manifestId}/${base}`;
  }
  const unscoped = packageName.includes("/")
    ? (packageName.split("/").pop() ?? packageName)
    : packageName;
  return `${unscoped}/${base}`;
}
function isTopLevelPublicSurfaceSource(name) {
  if (!PUBLIC_SURFACE_SOURCE_EXTENSIONS.includes(path17.extname(name))) {
    return false;
  }
  if (name.startsWith(".")) {
    return false;
  }
  if (name.startsWith("test-")) {
    return false;
  }
  if (name.includes(".test-")) {
    return false;
  }
  if (name.endsWith(".d.ts")) {
    return false;
  }
  return !/(\.test|\.spec)(\.[cm]?[jt]s)$/u.test(name);
}
function collectTopLevelPublicSurfaceArtifacts(params) {
  const excluded = new Set(
    [params.sourceEntry, params.setupEntry]
      .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => path17.basename(entry)),
  );
  const artifacts = fs11
    .readdirSync(params.pluginDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(isTopLevelPublicSurfaceSource)
    .filter((entry) => !excluded.has(entry))
    .map((entry) => rewriteEntryToBuiltPath(entry))
    .filter((entry) => typeof entry === "string" && entry.length > 0)
    .toSorted((left, right) => left.localeCompare(right));
  return artifacts.length > 0 ? artifacts : void 0;
}
function collectRuntimeSidecarArtifacts(publicSurfaceArtifacts) {
  if (!publicSurfaceArtifacts) {
    return void 0;
  }
  const artifacts = publicSurfaceArtifacts.filter((artifact) =>
    RUNTIME_SIDECAR_ARTIFACTS.has(artifact),
  );
  return artifacts.length > 0 ? artifacts : void 0;
}
function resolveBundledPluginScanDir(packageRoot) {
  const sourceDir = path17.join(packageRoot, "extensions");
  const runtimeDir = path17.join(packageRoot, "dist-runtime", "extensions");
  const builtDir = path17.join(packageRoot, "dist", "extensions");
  if (RUNNING_FROM_BUILT_ARTIFACT) {
    if (fs11.existsSync(builtDir)) {
      return builtDir;
    }
    if (fs11.existsSync(runtimeDir)) {
      return runtimeDir;
    }
  }
  if (fs11.existsSync(sourceDir)) {
    return sourceDir;
  }
  if (fs11.existsSync(runtimeDir) && fs11.existsSync(builtDir)) {
    return runtimeDir;
  }
  if (fs11.existsSync(builtDir)) {
    return builtDir;
  }
  return void 0;
}
function isBuiltChannelConfigSchema(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value;
  return Boolean(candidate.schema && typeof candidate.schema === "object");
}
function resolveConfigSchemaExport(imported) {
  for (const [name, value] of Object.entries(imported)) {
    if (name.endsWith("ChannelConfigSchema") && isBuiltChannelConfigSchema(value)) {
      return value;
    }
  }
  for (const [name, value] of Object.entries(imported)) {
    if (!name.endsWith("ConfigSchema") || name.endsWith("AccountConfigSchema")) {
      continue;
    }
    if (isBuiltChannelConfigSchema(value)) {
      return value;
    }
    if (value && typeof value === "object") {
      return buildChannelConfigSchema(value);
    }
  }
  for (const value of Object.values(imported)) {
    if (isBuiltChannelConfigSchema(value)) {
      return value;
    }
  }
  return null;
}
function getJiti(modulePath) {
  const tryNative =
    shouldPreferNativeJiti(modulePath) || modulePath.includes(`${path17.sep}dist${path17.sep}`);
  const aliasMap = buildPluginLoaderAliasMap(modulePath, process.argv[1], import.meta.url);
  const cacheKey = JSON.stringify({
    tryNative,
    aliasMap: Object.entries(aliasMap).toSorted(([left], [right]) => left.localeCompare(right)),
  });
  const cached = jitiLoaders.get(cacheKey);
  if (cached) {
    return cached;
  }
  const loader = createJiti(import.meta.url, {
    ...buildPluginLoaderJitiOptions(aliasMap),
    tryNative,
  });
  jitiLoaders.set(cacheKey, loader);
  return loader;
}
function resolveChannelConfigSchemaModulePath(pluginDir) {
  for (const relativePath of SOURCE_CONFIG_SCHEMA_CANDIDATES) {
    const candidate = path17.join(pluginDir, relativePath);
    if (fs11.existsSync(candidate)) {
      return candidate;
    }
  }
  for (const basename of PUBLIC_CONFIG_SURFACE_BASENAMES) {
    for (const extension of PUBLIC_SURFACE_SOURCE_EXTENSIONS) {
      const candidate = path17.join(pluginDir, `${basename}${extension}`);
      if (fs11.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return void 0;
}
function loadChannelConfigSurfaceModuleSync(modulePath) {
  try {
    const imported = getJiti(modulePath)(modulePath);
    return resolveConfigSchemaExport(imported);
  } catch {
    return null;
  }
}
function resolvePackageChannelMeta(packageManifest, channelId) {
  const channelMeta = packageManifest?.channel;
  return channelMeta?.id?.trim() === channelId ? channelMeta : void 0;
}
function collectBundledChannelConfigs(params) {
  const channelIds = normalizeStringList2(params.manifest.channels);
  const existingChannelConfigs =
    params.manifest.channelConfigs && Object.keys(params.manifest.channelConfigs).length > 0
      ? { ...params.manifest.channelConfigs }
      : {};
  if (channelIds.length === 0) {
    return Object.keys(existingChannelConfigs).length > 0 ? existingChannelConfigs : void 0;
  }
  const surfaceModulePath = resolveChannelConfigSchemaModulePath(params.pluginDir);
  const surface = surfaceModulePath ? loadChannelConfigSurfaceModuleSync(surfaceModulePath) : null;
  for (const channelId of channelIds) {
    const existing = existingChannelConfigs[channelId];
    const channelMeta = resolvePackageChannelMeta(params.packageManifest, channelId);
    const preferOver = normalizeStringList2(channelMeta?.preferOver);
    const uiHints =
      surface?.uiHints || existing?.uiHints
        ? {
            ...(surface?.uiHints && Object.keys(surface.uiHints).length > 0 ? surface.uiHints : {}),
            ...(existing?.uiHints && Object.keys(existing.uiHints).length > 0
              ? existing.uiHints
              : {}),
          }
        : void 0;
    if (!surface?.schema && !existing?.schema) {
      continue;
    }
    existingChannelConfigs[channelId] = {
      schema: surface?.schema ?? existing?.schema ?? {},
      ...(uiHints && Object.keys(uiHints).length > 0 ? { uiHints } : {}),
      ...((trimString(existing?.label) ?? trimString(channelMeta?.label))
        ? { label: trimString(existing?.label) ?? trimString(channelMeta?.label) }
        : {}),
      ...((trimString(existing?.description) ?? trimString(channelMeta?.blurb))
        ? {
            description: trimString(existing?.description) ?? trimString(channelMeta?.blurb),
          }
        : {}),
      ...(existing?.preferOver?.length
        ? { preferOver: existing.preferOver }
        : preferOver.length > 0
          ? { preferOver }
          : {}),
    };
  }
  return Object.keys(existingChannelConfigs).length > 0 ? existingChannelConfigs : void 0;
}
function collectBundledPluginMetadataForPackageRoot(
  packageRoot,
  includeChannelConfigs,
  includeSyntheticChannelConfigs,
) {
  const scanDir = resolveBundledPluginScanDir(packageRoot);
  if (!scanDir || !fs11.existsSync(scanDir)) {
    return [];
  }
  const entries = [];
  for (const dirName of fs11
    .readdirSync(scanDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted((left, right) => left.localeCompare(right))) {
    const pluginDir = path17.join(scanDir, dirName);
    const manifestResult = loadPluginManifest(pluginDir, false);
    if (!manifestResult.ok) {
      continue;
    }
    const packageJson = readPackageManifest(pluginDir);
    const packageManifest = getPackageManifestMetadata(packageJson);
    const extensions = normalizeStringList2(packageManifest?.extensions);
    if (extensions.length === 0) {
      continue;
    }
    const sourceEntry = trimString(extensions[0]);
    const builtEntry = rewriteEntryToBuiltPath(sourceEntry);
    if (!sourceEntry || !builtEntry) {
      continue;
    }
    const setupSourcePath = trimString(packageManifest?.setupEntry);
    const setupSource =
      setupSourcePath && rewriteEntryToBuiltPath(setupSourcePath)
        ? {
            source: setupSourcePath,
            built: rewriteEntryToBuiltPath(setupSourcePath),
          }
        : void 0;
    const publicSurfaceArtifacts = collectTopLevelPublicSurfaceArtifacts({
      pluginDir,
      sourceEntry,
      ...(setupSourcePath ? { setupEntry: setupSourcePath } : {}),
    });
    const runtimeSidecarArtifacts = collectRuntimeSidecarArtifacts(publicSurfaceArtifacts);
    const channelConfigs =
      includeChannelConfigs && includeSyntheticChannelConfigs
        ? collectBundledChannelConfigs({
            pluginDir,
            manifest: manifestResult.manifest,
            packageManifest,
          })
        : manifestResult.manifest.channelConfigs;
    entries.push({
      dirName,
      idHint: deriveIdHint({
        entryPath: sourceEntry,
        manifestId: manifestResult.manifest.id,
        packageName: trimString(packageJson?.name),
        hasMultipleExtensions: extensions.length > 1,
      }),
      source: {
        source: sourceEntry,
        built: builtEntry,
      },
      ...(setupSource ? { setupSource } : {}),
      ...(publicSurfaceArtifacts ? { publicSurfaceArtifacts } : {}),
      ...(runtimeSidecarArtifacts ? { runtimeSidecarArtifacts } : {}),
      ...(trimString(packageJson?.name) ? { packageName: trimString(packageJson?.name) } : {}),
      ...(trimString(packageJson?.version)
        ? { packageVersion: trimString(packageJson?.version) }
        : {}),
      ...(trimString(packageJson?.description)
        ? { packageDescription: trimString(packageJson?.description) }
        : {}),
      ...(packageManifest ? { packageManifest } : {}),
      manifest: {
        ...manifestResult.manifest,
        ...(channelConfigs ? { channelConfigs } : {}),
      },
    });
  }
  return entries;
}
function listBundledPluginMetadata(params) {
  const rootDir = path17.resolve(params?.rootDir ?? OPENCLAW_PACKAGE_ROOT);
  const includeChannelConfigs = params?.includeChannelConfigs ?? !RUNNING_FROM_BUILT_ARTIFACT;
  const includeSyntheticChannelConfigs =
    params?.includeSyntheticChannelConfigs ?? includeChannelConfigs;
  const cacheKey = JSON.stringify({
    rootDir,
    includeChannelConfigs,
    includeSyntheticChannelConfigs,
  });
  const cached = bundledPluginMetadataCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const entries = Object.freeze(
    collectBundledPluginMetadataForPackageRoot(
      rootDir,
      includeChannelConfigs,
      includeSyntheticChannelConfigs,
    ),
  );
  bundledPluginMetadataCache.set(cacheKey, entries);
  return entries;
}
function resolveBundledPluginPublicSurfacePath(params) {
  const artifactBasename = params.artifactBasename.replace(/^\.\//u, "");
  if (!artifactBasename) {
    return null;
  }
  const explicitBundledPluginsDir =
    params.bundledPluginsDir ?? resolveBundledPluginsDir(params.env ?? process.env);
  if (explicitBundledPluginsDir) {
    const explicitPluginDir = path17.resolve(explicitBundledPluginsDir, params.dirName);
    const explicitBuiltCandidate = path17.join(explicitPluginDir, artifactBasename);
    if (fs11.existsSync(explicitBuiltCandidate)) {
      return explicitBuiltCandidate;
    }
    const sourceBaseName2 = artifactBasename.replace(/\.js$/u, "");
    for (const ext of PUBLIC_SURFACE_SOURCE_EXTENSIONS) {
      const sourceCandidate = path17.join(explicitPluginDir, `${sourceBaseName2}${ext}`);
      if (fs11.existsSync(sourceCandidate)) {
        return sourceCandidate;
      }
    }
  }
  for (const candidate of [
    path17.resolve(params.rootDir, "dist", "extensions", params.dirName, artifactBasename),
    path17.resolve(params.rootDir, "dist-runtime", "extensions", params.dirName, artifactBasename),
  ]) {
    if (fs11.existsSync(candidate)) {
      return candidate;
    }
  }
  const sourceBaseName = artifactBasename.replace(/\.js$/u, "");
  for (const ext of PUBLIC_SURFACE_SOURCE_EXTENSIONS) {
    const sourceCandidate = path17.resolve(
      params.rootDir,
      "extensions",
      params.dirName,
      `${sourceBaseName}${ext}`,
    );
    if (fs11.existsSync(sourceCandidate)) {
      return sourceCandidate;
    }
  }
  return null;
}

// src/channels/ids.ts
var CHAT_CHANNEL_ORDER = [
  "telegram",
  "whatsapp",
  "discord",
  "irc",
  "googlechat",
  "slack",
  "signal",
  "imessage",
  "line",
];
var CHANNEL_IDS = [...CHAT_CHANNEL_ORDER];

// src/channels/chat-meta.ts
var CHAT_CHANNEL_ID_SET = new Set(CHAT_CHANNEL_ORDER);
function toChatChannelMeta(params) {
  const label = params.channel.label?.trim();
  if (!label) {
    throw new Error(`Missing label for bundled chat channel "${params.id}"`);
  }
  return {
    id: params.id,
    label,
    selectionLabel: params.channel.selectionLabel?.trim() || label,
    docsPath: params.channel.docsPath?.trim() || `/channels/${params.id}`,
    docsLabel: params.channel.docsLabel?.trim() || void 0,
    blurb: params.channel.blurb?.trim() || "",
    ...(params.channel.aliases?.length ? { aliases: params.channel.aliases } : {}),
    ...(params.channel.order !== void 0 ? { order: params.channel.order } : {}),
    ...(params.channel.selectionDocsPrefix !== void 0
      ? { selectionDocsPrefix: params.channel.selectionDocsPrefix }
      : {}),
    ...(params.channel.selectionDocsOmitLabel !== void 0
      ? { selectionDocsOmitLabel: params.channel.selectionDocsOmitLabel }
      : {}),
    ...(params.channel.selectionExtras?.length
      ? { selectionExtras: params.channel.selectionExtras }
      : {}),
    ...(params.channel.detailLabel?.trim()
      ? { detailLabel: params.channel.detailLabel.trim() }
      : {}),
    ...(params.channel.systemImage?.trim()
      ? { systemImage: params.channel.systemImage.trim() }
      : {}),
    ...(params.channel.markdownCapable !== void 0
      ? { markdownCapable: params.channel.markdownCapable }
      : {}),
    ...(params.channel.showConfigured !== void 0
      ? { showConfigured: params.channel.showConfigured }
      : {}),
    ...(params.channel.quickstartAllowFrom !== void 0
      ? { quickstartAllowFrom: params.channel.quickstartAllowFrom }
      : {}),
    ...(params.channel.forceAccountBinding !== void 0
      ? { forceAccountBinding: params.channel.forceAccountBinding }
      : {}),
    ...(params.channel.preferSessionLookupForAnnounceTarget !== void 0
      ? {
          preferSessionLookupForAnnounceTarget: params.channel.preferSessionLookupForAnnounceTarget,
        }
      : {}),
    ...(params.channel.preferOver?.length ? { preferOver: params.channel.preferOver } : {}),
  };
}
function buildChatChannelMetaById() {
  const entries = /* @__PURE__ */ new Map();
  for (const entry of listBundledPluginMetadata({
    includeChannelConfigs: true,
    includeSyntheticChannelConfigs: false,
  })) {
    const channel =
      entry.packageManifest && "channel" in entry.packageManifest
        ? entry.packageManifest.channel
        : void 0;
    if (!channel) {
      continue;
    }
    const rawId = channel?.id?.trim();
    if (!rawId || !CHAT_CHANNEL_ID_SET.has(rawId)) {
      continue;
    }
    const id = rawId;
    entries.set(
      id,
      toChatChannelMeta({
        id,
        channel,
      }),
    );
  }
  const missingIds = CHAT_CHANNEL_ORDER.filter((id) => !entries.has(id));
  if (missingIds.length > 0) {
    throw new Error(`Missing bundled chat channel metadata for: ${missingIds.join(", ")}`);
  }
  return Object.freeze(Object.fromEntries(entries));
}
var CHAT_CHANNEL_META = buildChatChannelMetaById();
var CHAT_CHANNEL_ALIASES = Object.freeze(
  Object.fromEntries(
    Object.values(CHAT_CHANNEL_META)
      .flatMap((meta) => (meta.aliases ?? []).map((alias) => [alias.trim().toLowerCase(), meta.id]))
      .filter(([alias]) => alias.length > 0)
      .toSorted(([left], [right]) => left.localeCompare(right)),
  ),
);

// src/gateway/protocol/client-info.ts
var GATEWAY_CLIENT_IDS = {
  WEBCHAT_UI: "webchat-ui",
  CONTROL_UI: "openclaw-control-ui",
  TUI: "openclaw-tui",
  WEBCHAT: "webchat",
  CLI: "cli",
  GATEWAY_CLIENT: "gateway-client",
  MACOS_APP: "openclaw-macos",
  IOS_APP: "openclaw-ios",
  ANDROID_APP: "openclaw-android",
  NODE_HOST: "node-host",
  TEST: "test",
  FINGERPRINT: "fingerprint",
  PROBE: "openclaw-probe",
};
var GATEWAY_CLIENT_MODES = {
  WEBCHAT: "webchat",
  CLI: "cli",
  UI: "ui",
  BACKEND: "backend",
  NODE: "node",
  PROBE: "probe",
  TEST: "test",
};
var GATEWAY_CLIENT_ID_SET = new Set(Object.values(GATEWAY_CLIENT_IDS));
var GATEWAY_CLIENT_MODE_SET = new Set(Object.values(GATEWAY_CLIENT_MODES));

// src/infra/net/undici-global-dispatcher.ts
import { Agent, EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
var DEFAULT_UNDICI_STREAM_TIMEOUT_MS = 30 * 60 * 1e3;

// src/logging/redact.ts
var requireConfig4 = resolveNodeRequireFromMeta(import.meta.url);
var DEFAULT_REDACT_PATTERNS = [
  // ENV-style assignments.
  String.raw`\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)\b\s*[=:]\s*(["']?)([^\s"'\\]+)\1`,
  // JSON fields.
  String.raw`"(?:apiKey|token|secret|password|passwd|accessToken|refreshToken)"\s*:\s*"([^"]+)"`,
  // CLI flags.
  String.raw`--(?:api[-_]?key|token|secret|password|passwd)\s+(["']?)([^\s"']+)\1`,
  // Authorization headers.
  String.raw`Authorization\s*[:=]\s*Bearer\s+([A-Za-z0-9._\-+=]+)`,
  String.raw`\bBearer\s+([A-Za-z0-9._\-+=]{18,})\b`,
  // PEM blocks.
  String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----`,
  // Common token prefixes.
  String.raw`\b(sk-[A-Za-z0-9_-]{8,})\b`,
  String.raw`\b(ghp_[A-Za-z0-9]{20,})\b`,
  String.raw`\b(github_pat_[A-Za-z0-9_]{20,})\b`,
  String.raw`\b(xox[baprs]-[A-Za-z0-9-]{10,})\b`,
  String.raw`\b(xapp-[A-Za-z0-9-]{10,})\b`,
  String.raw`\b(gsk_[A-Za-z0-9_-]{10,})\b`,
  String.raw`\b(AIza[0-9A-Za-z\-_]{20,})\b`,
  String.raw`\b(pplx-[A-Za-z0-9_-]{10,})\b`,
  String.raw`\b(npm_[A-Za-z0-9]{10,})\b`,
  // Telegram Bot API URLs embed the token as `/bot<token>/...` (no word-boundary before digits).
  String.raw`\bbot(\d{6,}:[A-Za-z0-9_-]{20,})\b`,
  String.raw`\b(\d{6,}:[A-Za-z0-9_-]{20,})\b`,
];

// src/infra/dotenv.ts
import dotenv from "dotenv";
// src/config/io.ts
import JSON52 from "json5";

// src/infra/host-env-security-policy.json
var host_env_security_policy_default = {
  blockedKeys: [
    "NODE_OPTIONS",
    "NODE_PATH",
    "PYTHONHOME",
    "PYTHONPATH",
    "PERL5LIB",
    "PERL5OPT",
    "RUBYLIB",
    "RUBYOPT",
    "BASH_ENV",
    "ENV",
    "BROWSER",
    "GIT_EDITOR",
    "GIT_EXTERNAL_DIFF",
    "GIT_EXEC_PATH",
    "GIT_SEQUENCE_EDITOR",
    "GIT_TEMPLATE_DIR",
    "CC",
    "CXX",
    "CARGO_BUILD_RUSTC",
    "CMAKE_C_COMPILER",
    "CMAKE_CXX_COMPILER",
    "SHELL",
    "SHELLOPTS",
    "PS4",
    "GCONV_PATH",
    "IFS",
    "SSLKEYLOGFILE",
    "JAVA_TOOL_OPTIONS",
    "_JAVA_OPTIONS",
    "JDK_JAVA_OPTIONS",
    "PYTHONBREAKPOINT",
    "DOTNET_STARTUP_HOOKS",
    "DOTNET_ADDITIONAL_DEPS",
    "GLIBC_TUNABLES",
    "MAVEN_OPTS",
    "SBT_OPTS",
    "GRADLE_OPTS",
    "ANT_OPTS",
  ],
  blockedOverrideKeys: [
    "HOME",
    "GRADLE_USER_HOME",
    "ZDOTDIR",
    "GIT_SSH_COMMAND",
    "GIT_SSH",
    "GIT_PROXY_COMMAND",
    "GIT_ASKPASS",
    "SSH_ASKPASS",
    "LESSOPEN",
    "LESSCLOSE",
    "PAGER",
    "MANPAGER",
    "GIT_PAGER",
    "EDITOR",
    "VISUAL",
    "FCEDIT",
    "SUDO_EDITOR",
    "PROMPT_COMMAND",
    "HISTFILE",
    "PERL5DB",
    "PERL5DBCMD",
    "OPENSSL_CONF",
    "OPENSSL_ENGINES",
    "PYTHONSTARTUP",
    "WGETRC",
    "CURL_HOME",
    "CLASSPATH",
    "CGO_CFLAGS",
    "CGO_LDFLAGS",
    "GOFLAGS",
    "CORECLR_PROFILER_PATH",
    "PHPRC",
    "PHP_INI_SCAN_DIR",
    "DENO_DIR",
    "BUN_CONFIG_REGISTRY",
    "PIP_INDEX_URL",
    "PIP_PYPI_URL",
    "PIP_EXTRA_INDEX_URL",
    "UV_INDEX",
    "UV_INDEX_URL",
    "UV_EXTRA_INDEX_URL",
    "UV_DEFAULT_INDEX",
    "LUA_PATH",
    "LUA_CPATH",
    "GEM_HOME",
    "GEM_PATH",
    "BUNDLE_GEMFILE",
    "COMPOSER_HOME",
    "XDG_CONFIG_HOME",
    "AWS_CONFIG_FILE",
  ],
  blockedOverridePrefixes: ["GIT_CONFIG_", "NPM_CONFIG_"],
  blockedPrefixes: ["DYLD_", "LD_", "BASH_FUNC_"],
};

// src/infra/host-env-security.ts
var HOST_ENV_SECURITY_POLICY = host_env_security_policy_default;
var HOST_DANGEROUS_ENV_KEY_VALUES = Object.freeze(
  HOST_ENV_SECURITY_POLICY.blockedKeys.map((key) => key.toUpperCase()),
);
var HOST_DANGEROUS_ENV_PREFIXES = Object.freeze(
  HOST_ENV_SECURITY_POLICY.blockedPrefixes.map((prefix) => prefix.toUpperCase()),
);
var HOST_DANGEROUS_OVERRIDE_ENV_KEY_VALUES = Object.freeze(
  (HOST_ENV_SECURITY_POLICY.blockedOverrideKeys ?? []).map((key) => key.toUpperCase()),
);
var HOST_DANGEROUS_OVERRIDE_ENV_PREFIXES = Object.freeze(
  (HOST_ENV_SECURITY_POLICY.blockedOverridePrefixes ?? []).map((prefix) => prefix.toUpperCase()),
);
var HOST_SHELL_WRAPPER_ALLOWED_OVERRIDE_ENV_KEY_VALUES = Object.freeze([
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
]);
var HOST_DANGEROUS_ENV_KEYS = new Set(HOST_DANGEROUS_ENV_KEY_VALUES);
var HOST_DANGEROUS_OVERRIDE_ENV_KEYS = new Set(HOST_DANGEROUS_OVERRIDE_ENV_KEY_VALUES);
var HOST_SHELL_WRAPPER_ALLOWED_OVERRIDE_ENV_KEYS = new Set(
  HOST_SHELL_WRAPPER_ALLOWED_OVERRIDE_ENV_KEY_VALUES,
);

// src/infra/shell-env.ts
var DEFAULT_MAX_BUFFER_BYTES = 2 * 1024 * 1024;

// src/config/state-dir-dotenv.ts
import dotenv2 from "dotenv";
// src/config/includes.ts
import JSON5 from "json5";
var MAX_INCLUDE_FILE_BYTES = 2 * 1024 * 1024;

// src/config/legacy.shared.ts
var getRecord = (value) => (isRecord(value) ? value : null);
var ensureRecord = (root, key) => {
  const existing = root[key];
  if (isRecord(existing)) {
    return existing;
  }
  const next = {};
  root[key] = next;
  return next;
};
var mergeMissing = (target, source) => {
  for (const [key, value] of Object.entries(source)) {
    if (value === void 0 || isBlockedObjectKey(key)) {
      continue;
    }
    const existing = target[key];
    if (existing === void 0) {
      target[key] = value;
      continue;
    }
    if (isRecord(existing) && isRecord(value)) {
      mergeMissing(existing, value);
    }
  }
};
var mapLegacyAudioTranscription = (value) => {
  const transcriber = getRecord(value);
  const command = Array.isArray(transcriber?.command) ? transcriber?.command : null;
  if (!command || command.length === 0) {
    return null;
  }
  if (typeof command[0] !== "string") {
    return null;
  }
  if (!command.every((part) => typeof part === "string")) {
    return null;
  }
  const rawExecutable = command[0].trim();
  if (!rawExecutable) {
    return null;
  }
  if (!isSafeExecutableValue(rawExecutable)) {
    return null;
  }
  const args = command.slice(1);
  const timeoutSeconds =
    typeof transcriber?.timeoutSeconds === "number" ? transcriber?.timeoutSeconds : void 0;
  const result = { command: rawExecutable, type: "cli" };
  if (args.length > 0) {
    result.args = args;
  }
  if (timeoutSeconds !== void 0) {
    result.timeoutSeconds = timeoutSeconds;
  }
  return result;
};
var defineLegacyConfigMigration = (migration) => migration;

// src/config/legacy.migrations.audio.ts
function applyLegacyAudioTranscriptionModel(params) {
  const mapped = mapLegacyAudioTranscription(params.source);
  if (!mapped) {
    params.changes.push(params.invalidMessage);
    return;
  }
  const tools = ensureRecord(params.raw, "tools");
  const media = ensureRecord(tools, "media");
  const mediaAudio = ensureRecord(media, "audio");
  const models = Array.isArray(mediaAudio.models) ? mediaAudio.models : [];
  if (models.length === 0) {
    mediaAudio.enabled = true;
    mediaAudio.models = [mapped];
    params.changes.push(params.movedMessage);
    return;
  }
  params.changes.push(params.alreadySetMessage);
}
var LEGACY_CONFIG_MIGRATIONS_AUDIO = [
  defineLegacyConfigMigration({
    id: "audio.transcription-v2",
    describe: "Move audio.transcription to tools.media.audio.models",
    apply: (raw, changes) => {
      const audio = getRecord(raw.audio);
      if (audio?.transcription === void 0) {
        return;
      }
      applyLegacyAudioTranscriptionModel({
        raw,
        source: audio.transcription,
        changes,
        movedMessage: "Moved audio.transcription \u2192 tools.media.audio.models.",
        alreadySetMessage: "Removed audio.transcription (tools.media.audio.models already set).",
        invalidMessage: "Removed audio.transcription (invalid or empty command).",
      });
      delete audio.transcription;
      if (Object.keys(audio).length === 0) {
        delete raw.audio;
      } else {
        raw.audio = audio;
      }
    },
  }),
];

// src/config/discord-preview-streaming.ts
function normalizeStreamingMode(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}
function parseStreamingMode(value) {
  const normalized = normalizeStreamingMode(value);
  if (
    normalized === "off" ||
    normalized === "partial" ||
    normalized === "block" ||
    normalized === "progress"
  ) {
    return normalized;
  }
  return null;
}
function parseDiscordPreviewStreamMode(value) {
  const parsed = parseStreamingMode(value);
  if (!parsed) {
    return null;
  }
  return parsed === "progress" ? "partial" : parsed;
}
function parseSlackLegacyDraftStreamMode(value) {
  const normalized = normalizeStreamingMode(value);
  if (normalized === "replace" || normalized === "status_final" || normalized === "append") {
    return normalized;
  }
  return null;
}
function mapSlackLegacyDraftStreamModeToStreaming(mode) {
  if (mode === "append") {
    return "block";
  }
  if (mode === "status_final") {
    return "progress";
  }
  return "partial";
}
function resolveTelegramPreviewStreamMode(params = {}) {
  const parsedStreaming = parseStreamingMode(params.streaming);
  if (parsedStreaming) {
    if (parsedStreaming === "progress") {
      return "partial";
    }
    return parsedStreaming;
  }
  const legacy = parseDiscordPreviewStreamMode(params.streamMode);
  if (legacy) {
    return legacy;
  }
  if (typeof params.streaming === "boolean") {
    return params.streaming ? "partial" : "off";
  }
  return "partial";
}
function resolveDiscordPreviewStreamMode(params = {}) {
  const parsedStreaming = parseDiscordPreviewStreamMode(params.streaming);
  if (parsedStreaming) {
    return parsedStreaming;
  }
  const legacy = parseDiscordPreviewStreamMode(params.streamMode);
  if (legacy) {
    return legacy;
  }
  if (typeof params.streaming === "boolean") {
    return params.streaming ? "partial" : "off";
  }
  return "off";
}
function resolveSlackStreamingMode(params = {}) {
  const parsedStreaming = parseStreamingMode(params.streaming);
  if (parsedStreaming) {
    return parsedStreaming;
  }
  const legacyStreamMode = parseSlackLegacyDraftStreamMode(params.streamMode);
  if (legacyStreamMode) {
    return mapSlackLegacyDraftStreamModeToStreaming(legacyStreamMode);
  }
  if (typeof params.streaming === "boolean") {
    return params.streaming ? "partial" : "off";
  }
  return "partial";
}
function resolveSlackNativeStreaming(params = {}) {
  if (typeof params.nativeStreaming === "boolean") {
    return params.nativeStreaming;
  }
  if (typeof params.streaming === "boolean") {
    return params.streaming;
  }
  return true;
}
function formatSlackStreamModeMigrationMessage(pathPrefix, resolvedStreaming) {
  return `Moved ${pathPrefix}.streamMode \u2192 ${pathPrefix}.streaming (${resolvedStreaming}).`;
}
function formatSlackStreamingBooleanMigrationMessage(pathPrefix, resolvedNativeStreaming) {
  return `Moved ${pathPrefix}.streaming (boolean) \u2192 ${pathPrefix}.nativeStreaming (${resolvedNativeStreaming}).`;
}

// src/config/legacy.migrations.channels.ts
function hasOwnKey(target, key) {
  return Object.prototype.hasOwnProperty.call(target, key);
}
function hasLegacyThreadBindingTtl(value) {
  const threadBindings = getRecord(value);
  return Boolean(threadBindings && hasOwnKey(threadBindings, "ttlHours"));
}
function hasLegacyThreadBindingTtlInAccounts(value) {
  const accounts = getRecord(value);
  if (!accounts) {
    return false;
  }
  return Object.values(accounts).some((entry) =>
    hasLegacyThreadBindingTtl(getRecord(entry)?.threadBindings),
  );
}
function migrateThreadBindingsTtlHoursForPath(params) {
  const threadBindings = getRecord(params.owner.threadBindings);
  if (!threadBindings || !hasOwnKey(threadBindings, "ttlHours")) {
    return false;
  }
  const hadIdleHours = threadBindings.idleHours !== void 0;
  if (!hadIdleHours) {
    threadBindings.idleHours = threadBindings.ttlHours;
  }
  delete threadBindings.ttlHours;
  params.owner.threadBindings = threadBindings;
  if (hadIdleHours) {
    params.changes.push(
      `Removed ${params.pathPrefix}.threadBindings.ttlHours (${params.pathPrefix}.threadBindings.idleHours already set).`,
    );
  } else {
    params.changes.push(
      `Moved ${params.pathPrefix}.threadBindings.ttlHours \u2192 ${params.pathPrefix}.threadBindings.idleHours.`,
    );
  }
  return true;
}
var THREAD_BINDING_RULES = [
  {
    path: ["session", "threadBindings"],
    message:
      "session.threadBindings.ttlHours was renamed to session.threadBindings.idleHours (auto-migrated on load).",
    match: (value) => hasLegacyThreadBindingTtl(value),
  },
  {
    path: ["channels", "discord", "threadBindings"],
    message:
      "channels.discord.threadBindings.ttlHours was renamed to channels.discord.threadBindings.idleHours (auto-migrated on load).",
    match: (value) => hasLegacyThreadBindingTtl(value),
  },
  {
    path: ["channels", "discord", "accounts"],
    message:
      "channels.discord.accounts.<id>.threadBindings.ttlHours was renamed to channels.discord.accounts.<id>.threadBindings.idleHours (auto-migrated on load).",
    match: (value) => hasLegacyThreadBindingTtlInAccounts(value),
  },
];
var LEGACY_CONFIG_MIGRATIONS_CHANNELS = [
  defineLegacyConfigMigration({
    id: "thread-bindings.ttlHours->idleHours",
    describe:
      "Move legacy threadBindings.ttlHours keys to threadBindings.idleHours (session + channels.discord)",
    legacyRules: THREAD_BINDING_RULES,
    apply: (raw, changes) => {
      const session = getRecord(raw.session);
      if (session) {
        migrateThreadBindingsTtlHoursForPath({
          owner: session,
          pathPrefix: "session",
          changes,
        });
        raw.session = session;
      }
      const channels = getRecord(raw.channels);
      const discord = getRecord(channels?.discord);
      if (!channels || !discord) {
        return;
      }
      migrateThreadBindingsTtlHoursForPath({
        owner: discord,
        pathPrefix: "channels.discord",
        changes,
      });
      const accounts = getRecord(discord.accounts);
      if (accounts) {
        for (const [accountId, accountRaw] of Object.entries(accounts)) {
          const account = getRecord(accountRaw);
          if (!account) {
            continue;
          }
          migrateThreadBindingsTtlHoursForPath({
            owner: account,
            pathPrefix: `channels.discord.accounts.${accountId}`,
            changes,
          });
          accounts[accountId] = account;
        }
        discord.accounts = accounts;
      }
      channels.discord = discord;
      raw.channels = channels;
    },
  }),
  defineLegacyConfigMigration({
    id: "channels.streaming-keys->channels.streaming",
    describe:
      "Normalize legacy streaming keys to channels.<provider>.streaming (Telegram/Discord/Slack)",
    apply: (raw, changes) => {
      const channels = getRecord(raw.channels);
      if (!channels) {
        return;
      }
      const migrateProviderEntry = (params) => {
        const migrateCommonStreamingMode = (resolveMode) => {
          const hasLegacyStreamMode2 = params.entry.streamMode !== void 0;
          const legacyStreaming2 = params.entry.streaming;
          if (!hasLegacyStreamMode2 && typeof legacyStreaming2 !== "boolean") {
            return false;
          }
          const resolved = resolveMode(params.entry);
          params.entry.streaming = resolved;
          if (hasLegacyStreamMode2) {
            delete params.entry.streamMode;
            changes.push(
              `Moved ${params.pathPrefix}.streamMode \u2192 ${params.pathPrefix}.streaming (${resolved}).`,
            );
          }
          if (typeof legacyStreaming2 === "boolean") {
            changes.push(
              `Normalized ${params.pathPrefix}.streaming boolean \u2192 enum (${resolved}).`,
            );
          }
          return true;
        };
        const hasLegacyStreamMode = params.entry.streamMode !== void 0;
        const legacyStreaming = params.entry.streaming;
        const legacyNativeStreaming = params.entry.nativeStreaming;
        if (params.provider === "telegram") {
          migrateCommonStreamingMode(resolveTelegramPreviewStreamMode);
          return;
        }
        if (params.provider === "discord") {
          migrateCommonStreamingMode(resolveDiscordPreviewStreamMode);
          return;
        }
        if (!hasLegacyStreamMode && typeof legacyStreaming !== "boolean") {
          return;
        }
        const resolvedStreaming = resolveSlackStreamingMode(params.entry);
        const resolvedNativeStreaming = resolveSlackNativeStreaming(params.entry);
        params.entry.streaming = resolvedStreaming;
        params.entry.nativeStreaming = resolvedNativeStreaming;
        if (hasLegacyStreamMode) {
          delete params.entry.streamMode;
          changes.push(formatSlackStreamModeMigrationMessage(params.pathPrefix, resolvedStreaming));
        }
        if (typeof legacyStreaming === "boolean") {
          changes.push(
            formatSlackStreamingBooleanMigrationMessage(params.pathPrefix, resolvedNativeStreaming),
          );
        } else if (typeof legacyNativeStreaming !== "boolean" && hasLegacyStreamMode) {
          changes.push(
            `Set ${params.pathPrefix}.nativeStreaming \u2192 ${resolvedNativeStreaming}.`,
          );
        }
      };
      const migrateProvider = (provider) => {
        const providerEntry = getRecord(channels[provider]);
        if (!providerEntry) {
          return;
        }
        migrateProviderEntry({
          provider,
          entry: providerEntry,
          pathPrefix: `channels.${provider}`,
        });
        const accounts = getRecord(providerEntry.accounts);
        if (!accounts) {
          return;
        }
        for (const [accountId, accountValue] of Object.entries(accounts)) {
          const account = getRecord(accountValue);
          if (!account) {
            continue;
          }
          migrateProviderEntry({
            provider,
            entry: account,
            pathPrefix: `channels.${provider}.accounts.${accountId}`,
          });
        }
      };
      migrateProvider("telegram");
      migrateProvider("discord");
      migrateProvider("slack");
    },
  }),
];

// src/config/gateway-control-ui-origins.ts
function isGatewayNonLoopbackBindMode(bind) {
  return bind === "lan" || bind === "tailnet" || bind === "custom";
}
function hasConfiguredControlUiAllowedOrigins(params) {
  if (params.dangerouslyAllowHostHeaderOriginFallback === true) {
    return true;
  }
  return (
    Array.isArray(params.allowedOrigins) &&
    params.allowedOrigins.some((origin) => typeof origin === "string" && origin.trim().length > 0)
  );
}
function resolveGatewayPortWithDefault(port, fallback = DEFAULT_GATEWAY_PORT) {
  return typeof port === "number" && port > 0 ? port : fallback;
}
function buildDefaultControlUiAllowedOrigins(params) {
  const origins = /* @__PURE__ */ new Set([
    `http://localhost:${params.port}`,
    `http://127.0.0.1:${params.port}`,
  ]);
  const customBindHost = params.customBindHost?.trim();
  if (params.bind === "custom" && customBindHost) {
    origins.add(`http://${customBindHost}:${params.port}`);
  }
  return [...origins];
}

// src/config/legacy.migrations.runtime.ts
var AGENT_HEARTBEAT_KEYS = /* @__PURE__ */ new Set([
  "every",
  "activeHours",
  "model",
  "session",
  "includeReasoning",
  "target",
  "directPolicy",
  "to",
  "accountId",
  "prompt",
  "ackMaxChars",
  "suppressToolErrorWarnings",
  "lightContext",
  "isolatedSession",
]);
var CHANNEL_HEARTBEAT_KEYS = /* @__PURE__ */ new Set(["showOk", "showAlerts", "useIndicator"]);
var LEGACY_TTS_PROVIDER_KEYS = ["openai", "elevenlabs", "microsoft", "edge"];
var LEGACY_TTS_PLUGIN_IDS = /* @__PURE__ */ new Set(["voice-call"]);
function isLegacyGatewayBindHostAlias(value) {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    normalized === "auto" ||
    normalized === "loopback" ||
    normalized === "lan" ||
    normalized === "tailnet" ||
    normalized === "custom"
  ) {
    return false;
  }
  return (
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "[::]" ||
    normalized === "*" ||
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}
function escapeControlForLog(value) {
  return value.replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}
function splitLegacyHeartbeat(legacyHeartbeat) {
  const agentHeartbeat = {};
  const channelHeartbeat = {};
  for (const [key, value] of Object.entries(legacyHeartbeat)) {
    if (isBlockedObjectKey(key)) {
      continue;
    }
    if (CHANNEL_HEARTBEAT_KEYS.has(key)) {
      channelHeartbeat[key] = value;
      continue;
    }
    if (AGENT_HEARTBEAT_KEYS.has(key)) {
      agentHeartbeat[key] = value;
      continue;
    }
    agentHeartbeat[key] = value;
  }
  return {
    agentHeartbeat: Object.keys(agentHeartbeat).length > 0 ? agentHeartbeat : null,
    channelHeartbeat: Object.keys(channelHeartbeat).length > 0 ? channelHeartbeat : null,
  };
}
function mergeLegacyIntoDefaults(params) {
  const root = ensureRecord(params.raw, params.rootKey);
  const defaults = ensureRecord(root, "defaults");
  const existing = getRecord(defaults[params.fieldKey]);
  if (!existing) {
    defaults[params.fieldKey] = params.legacyValue;
    params.changes.push(params.movedMessage);
  } else {
    const merged = structuredClone(existing);
    mergeMissing(merged, params.legacyValue);
    defaults[params.fieldKey] = merged;
    params.changes.push(params.mergedMessage);
  }
  root.defaults = defaults;
  params.raw[params.rootKey] = root;
}
function hasLegacyTtsProviderKeys(value) {
  const tts = getRecord(value);
  if (!tts) {
    return false;
  }
  return LEGACY_TTS_PROVIDER_KEYS.some((key) => Object.prototype.hasOwnProperty.call(tts, key));
}
function hasLegacyDiscordAccountTtsProviderKeys(value) {
  const accounts = getRecord(value);
  if (!accounts) {
    return false;
  }
  return Object.entries(accounts).some(([accountId, accountValue]) => {
    if (isBlockedObjectKey(accountId)) {
      return false;
    }
    const account = getRecord(accountValue);
    const voice = getRecord(account?.voice);
    return hasLegacyTtsProviderKeys(voice?.tts);
  });
}
function hasLegacyPluginEntryTtsProviderKeys(value) {
  const entries = getRecord(value);
  if (!entries) {
    return false;
  }
  return Object.entries(entries).some(([pluginId, entryValue]) => {
    if (isBlockedObjectKey(pluginId) || !LEGACY_TTS_PLUGIN_IDS.has(pluginId)) {
      return false;
    }
    const entry = getRecord(entryValue);
    const config = getRecord(entry?.config);
    return hasLegacyTtsProviderKeys(config?.tts);
  });
}
function getOrCreateTtsProviders(tts) {
  const providers = getRecord(tts.providers) ?? {};
  tts.providers = providers;
  return providers;
}
function mergeLegacyTtsProviderConfig(tts, legacyKey, providerId) {
  const legacyValue = getRecord(tts[legacyKey]);
  if (!legacyValue) {
    return false;
  }
  const providers = getOrCreateTtsProviders(tts);
  const existing = getRecord(providers[providerId]) ?? {};
  const merged = structuredClone(existing);
  mergeMissing(merged, legacyValue);
  providers[providerId] = merged;
  delete tts[legacyKey];
  return true;
}
function migrateLegacyTtsConfig(tts, pathLabel, changes) {
  if (!tts) {
    return;
  }
  const movedOpenAI = mergeLegacyTtsProviderConfig(tts, "openai", "openai");
  const movedElevenLabs = mergeLegacyTtsProviderConfig(tts, "elevenlabs", "elevenlabs");
  const movedMicrosoft = mergeLegacyTtsProviderConfig(tts, "microsoft", "microsoft");
  const movedEdge = mergeLegacyTtsProviderConfig(tts, "edge", "microsoft");
  if (movedOpenAI) {
    changes.push(`Moved ${pathLabel}.openai \u2192 ${pathLabel}.providers.openai.`);
  }
  if (movedElevenLabs) {
    changes.push(`Moved ${pathLabel}.elevenlabs \u2192 ${pathLabel}.providers.elevenlabs.`);
  }
  if (movedMicrosoft) {
    changes.push(`Moved ${pathLabel}.microsoft \u2192 ${pathLabel}.providers.microsoft.`);
  }
  if (movedEdge) {
    changes.push(`Moved ${pathLabel}.edge \u2192 ${pathLabel}.providers.microsoft.`);
  }
}
var MEMORY_SEARCH_RULE = {
  path: ["memorySearch"],
  message:
    "top-level memorySearch was moved; use agents.defaults.memorySearch instead (auto-migrated on load).",
};
var GATEWAY_BIND_RULE = {
  path: ["gateway", "bind"],
  message:
    "gateway.bind host aliases (for example 0.0.0.0/localhost) are legacy; use bind modes (lan/loopback/custom/tailnet/auto) instead (auto-migrated on load).",
  match: (value) => isLegacyGatewayBindHostAlias(value),
  requireSourceLiteral: true,
};
var HEARTBEAT_RULE = {
  path: ["heartbeat"],
  message:
    "top-level heartbeat is not a valid config path; use agents.defaults.heartbeat (cadence/target/model settings) or channels.defaults.heartbeat (showOk/showAlerts/useIndicator).",
};
var LEGACY_TTS_RULES = [
  {
    path: ["messages", "tts"],
    message:
      "messages.tts.<provider> keys (openai/elevenlabs/microsoft/edge) are legacy; use messages.tts.providers.<provider> (auto-migrated on load).",
    match: (value) => hasLegacyTtsProviderKeys(value),
  },
  {
    path: ["channels", "discord", "voice", "tts"],
    message:
      "channels.discord.voice.tts.<provider> keys (openai/elevenlabs/microsoft/edge) are legacy; use channels.discord.voice.tts.providers.<provider> (auto-migrated on load).",
    match: (value) => hasLegacyTtsProviderKeys(value),
  },
  {
    path: ["channels", "discord", "accounts"],
    message:
      "channels.discord.accounts.<id>.voice.tts.<provider> keys (openai/elevenlabs/microsoft/edge) are legacy; use channels.discord.accounts.<id>.voice.tts.providers.<provider> (auto-migrated on load).",
    match: (value) => hasLegacyDiscordAccountTtsProviderKeys(value),
  },
  {
    path: ["plugins", "entries"],
    message:
      "plugins.entries.voice-call.config.tts.<provider> keys (openai/elevenlabs/microsoft/edge) are legacy; use plugins.entries.voice-call.config.tts.providers.<provider> (auto-migrated on load).",
    match: (value) => hasLegacyPluginEntryTtsProviderKeys(value),
  },
];
var LEGACY_CONFIG_MIGRATIONS_RUNTIME = [
  defineLegacyConfigMigration({
    // v2026.2.26 added a startup guard requiring gateway.controlUi.allowedOrigins (or the
    // host-header fallback flag) for any non-loopback bind. The setup wizard was updated
    // to seed this for new installs, but existing bind=lan/bind=custom installs that upgrade
    // crash-loop immediately on next startup with no recovery path (issue #29385).
    //
    // This migration runs on every gateway start via migrateLegacyConfig → applyLegacyMigrations
    // and writes the seeded origins to disk before the startup guard fires, preventing the loop.
    id: "gateway.controlUi.allowedOrigins-seed-for-non-loopback",
    describe: "Seed gateway.controlUi.allowedOrigins for existing non-loopback gateway installs",
    apply: (raw, changes) => {
      const gateway = getRecord(raw.gateway);
      if (!gateway) {
        return;
      }
      const bind = gateway.bind;
      if (!isGatewayNonLoopbackBindMode(bind)) {
        return;
      }
      const controlUi = getRecord(gateway.controlUi) ?? {};
      if (
        hasConfiguredControlUiAllowedOrigins({
          allowedOrigins: controlUi.allowedOrigins,
          dangerouslyAllowHostHeaderOriginFallback:
            controlUi.dangerouslyAllowHostHeaderOriginFallback,
        })
      ) {
        return;
      }
      const port = resolveGatewayPortWithDefault(gateway.port, DEFAULT_GATEWAY_PORT);
      const origins = buildDefaultControlUiAllowedOrigins({
        port,
        bind,
        customBindHost:
          typeof gateway.customBindHost === "string" ? gateway.customBindHost : void 0,
      });
      gateway.controlUi = { ...controlUi, allowedOrigins: origins };
      raw.gateway = gateway;
      changes.push(
        `Seeded gateway.controlUi.allowedOrigins ${JSON.stringify(origins)} for bind=${String(bind)}. Required since v2026.2.26. Add other machine origins to gateway.controlUi.allowedOrigins if needed.`,
      );
    },
  }),
  defineLegacyConfigMigration({
    id: "memorySearch->agents.defaults.memorySearch",
    describe: "Move top-level memorySearch to agents.defaults.memorySearch",
    legacyRules: [MEMORY_SEARCH_RULE],
    apply: (raw, changes) => {
      const legacyMemorySearch = getRecord(raw.memorySearch);
      if (!legacyMemorySearch) {
        return;
      }
      mergeLegacyIntoDefaults({
        raw,
        rootKey: "agents",
        fieldKey: "memorySearch",
        legacyValue: legacyMemorySearch,
        changes,
        movedMessage: "Moved memorySearch \u2192 agents.defaults.memorySearch.",
        mergedMessage:
          "Merged memorySearch \u2192 agents.defaults.memorySearch (filled missing fields from legacy; kept explicit agents.defaults values).",
      });
      delete raw.memorySearch;
    },
  }),
  defineLegacyConfigMigration({
    id: "gateway.bind.host-alias->bind-mode",
    describe: "Normalize gateway.bind host aliases to supported bind modes",
    legacyRules: [GATEWAY_BIND_RULE],
    apply: (raw, changes) => {
      const gateway = getRecord(raw.gateway);
      if (!gateway) {
        return;
      }
      const bindRaw = gateway.bind;
      if (typeof bindRaw !== "string") {
        return;
      }
      const normalized = bindRaw.trim().toLowerCase();
      let mapped;
      if (
        normalized === "0.0.0.0" ||
        normalized === "::" ||
        normalized === "[::]" ||
        normalized === "*"
      ) {
        mapped = "lan";
      } else if (
        normalized === "127.0.0.1" ||
        normalized === "localhost" ||
        normalized === "::1" ||
        normalized === "[::1]"
      ) {
        mapped = "loopback";
      }
      if (!mapped || normalized === mapped) {
        return;
      }
      gateway.bind = mapped;
      raw.gateway = gateway;
      changes.push(`Normalized gateway.bind "${escapeControlForLog(bindRaw)}" \u2192 "${mapped}".`);
    },
  }),
  defineLegacyConfigMigration({
    id: "tts.providers-generic-shape",
    describe: "Move legacy bundled TTS config keys into messages.tts.providers",
    legacyRules: LEGACY_TTS_RULES,
    apply: (raw, changes) => {
      const messages = getRecord(raw.messages);
      migrateLegacyTtsConfig(getRecord(messages?.tts), "messages.tts", changes);
      const channels = getRecord(raw.channels);
      const discord = getRecord(channels?.discord);
      const discordVoice = getRecord(discord?.voice);
      migrateLegacyTtsConfig(getRecord(discordVoice?.tts), "channels.discord.voice.tts", changes);
      const discordAccounts = getRecord(discord?.accounts);
      if (discordAccounts) {
        for (const [accountId, accountValue] of Object.entries(discordAccounts)) {
          if (isBlockedObjectKey(accountId)) {
            continue;
          }
          const account = getRecord(accountValue);
          const voice = getRecord(account?.voice);
          migrateLegacyTtsConfig(
            getRecord(voice?.tts),
            `channels.discord.accounts.${accountId}.voice.tts`,
            changes,
          );
        }
      }
      const plugins = getRecord(raw.plugins);
      const pluginEntries = getRecord(plugins?.entries);
      if (!pluginEntries) {
        return;
      }
      for (const [pluginId, entryValue] of Object.entries(pluginEntries)) {
        if (isBlockedObjectKey(pluginId) || !LEGACY_TTS_PLUGIN_IDS.has(pluginId)) {
          continue;
        }
        const entry = getRecord(entryValue);
        const config = getRecord(entry?.config);
        migrateLegacyTtsConfig(
          getRecord(config?.tts),
          `plugins.entries.${pluginId}.config.tts`,
          changes,
        );
      }
    },
  }),
  defineLegacyConfigMigration({
    id: "heartbeat->agents.defaults.heartbeat",
    describe: "Move top-level heartbeat to agents.defaults.heartbeat/channels.defaults.heartbeat",
    legacyRules: [HEARTBEAT_RULE],
    apply: (raw, changes) => {
      const legacyHeartbeat = getRecord(raw.heartbeat);
      if (!legacyHeartbeat) {
        return;
      }
      const { agentHeartbeat, channelHeartbeat } = splitLegacyHeartbeat(legacyHeartbeat);
      if (agentHeartbeat) {
        mergeLegacyIntoDefaults({
          raw,
          rootKey: "agents",
          fieldKey: "heartbeat",
          legacyValue: agentHeartbeat,
          changes,
          movedMessage: "Moved heartbeat \u2192 agents.defaults.heartbeat.",
          mergedMessage:
            "Merged heartbeat \u2192 agents.defaults.heartbeat (filled missing fields from legacy; kept explicit agents.defaults values).",
        });
      }
      if (channelHeartbeat) {
        mergeLegacyIntoDefaults({
          raw,
          rootKey: "channels",
          fieldKey: "heartbeat",
          legacyValue: channelHeartbeat,
          changes,
          movedMessage: "Moved heartbeat visibility \u2192 channels.defaults.heartbeat.",
          mergedMessage:
            "Merged heartbeat visibility \u2192 channels.defaults.heartbeat (filled missing fields from legacy; kept explicit channels.defaults values).",
        });
      }
      if (!agentHeartbeat && !channelHeartbeat) {
        changes.push("Removed empty top-level heartbeat.");
      }
      delete raw.heartbeat;
    },
  }),
];

// src/config/legacy.migrations.ts
var LEGACY_CONFIG_MIGRATION_SPECS = [
  ...LEGACY_CONFIG_MIGRATIONS_CHANNELS,
  ...LEGACY_CONFIG_MIGRATIONS_AUDIO,
  ...LEGACY_CONFIG_MIGRATIONS_RUNTIME,
];
var LEGACY_CONFIG_MIGRATIONS = LEGACY_CONFIG_MIGRATION_SPECS.map(
  ({ legacyRules: _legacyRules, ...migration }) => migration,
);
var LEGACY_CONFIG_MIGRATION_RULES = LEGACY_CONFIG_MIGRATION_SPECS.flatMap(
  (migration) => migration.legacyRules ?? [],
);

// src/plugins/bundled-capability-metadata.ts
function uniqueStrings(values) {
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  for (const value of values ?? []) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
var BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS = listBundledPluginMetadata()
  .map(({ manifest }) => ({
    pluginId: manifest.id,
    cliBackendIds: uniqueStrings(manifest.cliBackends),
    providerIds: uniqueStrings(manifest.providers),
    speechProviderIds: uniqueStrings(manifest.contracts?.speechProviders),
    mediaUnderstandingProviderIds: uniqueStrings(manifest.contracts?.mediaUnderstandingProviders),
    imageGenerationProviderIds: uniqueStrings(manifest.contracts?.imageGenerationProviders),
    webSearchProviderIds: uniqueStrings(manifest.contracts?.webSearchProviders),
    toolNames: uniqueStrings(manifest.contracts?.tools),
  }))
  .filter(
    (entry) =>
      entry.cliBackendIds.length > 0 ||
      entry.providerIds.length > 0 ||
      entry.speechProviderIds.length > 0 ||
      entry.mediaUnderstandingProviderIds.length > 0 ||
      entry.imageGenerationProviderIds.length > 0 ||
      entry.webSearchProviderIds.length > 0 ||
      entry.toolNames.length > 0,
  )
  .toSorted((left, right) => left.pluginId.localeCompare(right.pluginId));
function collectPluginIds(pick) {
  return BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS.filter((entry) => pick(entry).length > 0)
    .map((entry) => entry.pluginId)
    .toSorted((left, right) => left.localeCompare(right));
}
var BUNDLED_PROVIDER_PLUGIN_IDS = collectPluginIds((entry) => entry.providerIds);
var BUNDLED_SPEECH_PLUGIN_IDS = collectPluginIds((entry) => entry.speechProviderIds);
var BUNDLED_MEDIA_UNDERSTANDING_PLUGIN_IDS = collectPluginIds(
  (entry) => entry.mediaUnderstandingProviderIds,
);
var BUNDLED_IMAGE_GENERATION_PLUGIN_IDS = collectPluginIds(
  (entry) => entry.imageGenerationProviderIds,
);
var BUNDLED_RUNTIME_CONTRACT_PLUGIN_IDS = [
  ...new Set(
    BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS.filter(
      (entry) =>
        entry.providerIds.length > 0 ||
        entry.speechProviderIds.length > 0 ||
        entry.mediaUnderstandingProviderIds.length > 0 ||
        entry.imageGenerationProviderIds.length > 0 ||
        entry.webSearchProviderIds.length > 0,
    ).map((entry) => entry.pluginId),
  ),
].toSorted((left, right) => left.localeCompare(right));
var BUNDLED_WEB_SEARCH_PLUGIN_IDS = collectPluginIds((entry) => entry.webSearchProviderIds);
var BUNDLED_WEB_SEARCH_PROVIDER_PLUGIN_IDS = Object.fromEntries(
  BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS.flatMap((entry) =>
    entry.webSearchProviderIds.map((providerId) => [providerId, entry.pluginId]),
  ).toSorted(([left], [right]) => left.localeCompare(right)),
);
var BUNDLED_PROVIDER_PLUGIN_ID_ALIASES = Object.fromEntries(
  BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS.flatMap((entry) =>
    entry.providerIds
      .filter((providerId) => providerId !== entry.pluginId)
      .map((providerId) => [providerId, entry.pluginId]),
  ).toSorted(([left], [right]) => left.localeCompare(right)),
);
var BUNDLED_LEGACY_PLUGIN_ID_ALIASES = Object.fromEntries(
  listBundledPluginMetadata()
    .flatMap(({ manifest }) =>
      (manifest.legacyPluginIds ?? []).map((legacyPluginId) => [legacyPluginId, manifest.id]),
    )
    .toSorted(([left], [right]) => left.localeCompare(right)),
);
var BUNDLED_AUTO_ENABLE_PROVIDER_PLUGIN_IDS = Object.fromEntries(
  listBundledPluginMetadata()
    .flatMap(({ manifest }) =>
      (manifest.autoEnableWhenConfiguredProviders ?? []).map((providerId) => [
        providerId,
        manifest.id,
      ]),
    )
    .toSorted(([left], [right]) => left.localeCompare(right)),
);

// src/plugins/schema-validator.ts
import { createRequire as createRequire2 } from "node:module";
var require2 = createRequire2(import.meta.url);

// src/shared/avatar-policy.ts
var AVATAR_MAX_BYTES = 2 * 1024 * 1024;

// src/shared/net/ip.ts
import ipaddr from "ipaddr.js";
var RFC2544_BENCHMARK_PREFIX = [ipaddr.IPv4.parse("198.18.0.0"), 15];

// src/config/bundled-channel-config-metadata.generated.ts
var GENERATED_BUNDLED_CHANNEL_CONFIG_METADATA = [
  {
    pluginId: "bluebubbles",
    channelId: "bluebubbles",
    label: "BlueBubbles",
    description: "iMessage via the BlueBubbles mac app + REST API.",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        name: {
          type: "string",
        },
        enabled: {
          type: "boolean",
        },
        markdown: {
          type: "object",
          properties: {
            tables: {
              type: "string",
              enum: ["off", "bullets", "code"],
            },
          },
          additionalProperties: false,
        },
        serverUrl: {
          type: "string",
        },
        password: {
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
              ],
            },
          ],
        },
        webhookPath: {
          type: "string",
        },
        dmPolicy: {
          type: "string",
          enum: ["pairing", "allowlist", "open", "disabled"],
        },
        allowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        groupAllowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        groupPolicy: {
          type: "string",
          enum: ["open", "disabled", "allowlist"],
        },
        enrichGroupParticipantsFromContacts: {
          default: true,
          type: "boolean",
        },
        historyLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dmHistoryLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        textChunkLimit: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        chunkMode: {
          type: "string",
          enum: ["length", "newline"],
        },
        mediaMaxMb: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        mediaLocalRoots: {
          type: "array",
          items: {
            type: "string",
          },
        },
        sendReadReceipts: {
          type: "boolean",
        },
        allowPrivateNetwork: {
          type: "boolean",
        },
        blockStreaming: {
          type: "boolean",
        },
        groups: {
          type: "object",
          properties: {},
          additionalProperties: {
            type: "object",
            properties: {
              requireMention: {
                type: "boolean",
              },
              tools: {
                type: "object",
                properties: {
                  allow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  alsoAllow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  deny: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
        },
        accounts: {
          type: "object",
          properties: {},
          additionalProperties: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              enabled: {
                type: "boolean",
              },
              markdown: {
                type: "object",
                properties: {
                  tables: {
                    type: "string",
                    enum: ["off", "bullets", "code"],
                  },
                },
                additionalProperties: false,
              },
              serverUrl: {
                type: "string",
              },
              password: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "env",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                            pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "file",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "exec",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                    ],
                  },
                ],
              },
              webhookPath: {
                type: "string",
              },
              dmPolicy: {
                type: "string",
                enum: ["pairing", "allowlist", "open", "disabled"],
              },
              allowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              groupAllowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              groupPolicy: {
                type: "string",
                enum: ["open", "disabled", "allowlist"],
              },
              enrichGroupParticipantsFromContacts: {
                default: true,
                type: "boolean",
              },
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dmHistoryLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              textChunkLimit: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              chunkMode: {
                type: "string",
                enum: ["length", "newline"],
              },
              mediaMaxMb: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              mediaLocalRoots: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              sendReadReceipts: {
                type: "boolean",
              },
              allowPrivateNetwork: {
                type: "boolean",
              },
              blockStreaming: {
                type: "boolean",
              },
              groups: {
                type: "object",
                properties: {},
                additionalProperties: {
                  type: "object",
                  properties: {
                    requireMention: {
                      type: "boolean",
                    },
                    tools: {
                      type: "object",
                      properties: {
                        allow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        alsoAllow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        deny: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                      },
                      additionalProperties: false,
                    },
                  },
                  additionalProperties: false,
                },
              },
            },
            required: ["enrichGroupParticipantsFromContacts"],
            additionalProperties: false,
          },
        },
        defaultAccount: {
          type: "string",
        },
        actions: {
          type: "object",
          properties: {
            reactions: {
              default: true,
              type: "boolean",
            },
            edit: {
              default: true,
              type: "boolean",
            },
            unsend: {
              default: true,
              type: "boolean",
            },
            reply: {
              default: true,
              type: "boolean",
            },
            sendWithEffect: {
              default: true,
              type: "boolean",
            },
            renameGroup: {
              default: true,
              type: "boolean",
            },
            setGroupIcon: {
              default: true,
              type: "boolean",
            },
            addParticipant: {
              default: true,
              type: "boolean",
            },
            removeParticipant: {
              default: true,
              type: "boolean",
            },
            leaveGroup: {
              default: true,
              type: "boolean",
            },
            sendAttachment: {
              default: true,
              type: "boolean",
            },
          },
          required: [
            "reactions",
            "edit",
            "unsend",
            "reply",
            "sendWithEffect",
            "renameGroup",
            "setGroupIcon",
            "addParticipant",
            "removeParticipant",
            "leaveGroup",
            "sendAttachment",
          ],
          additionalProperties: false,
        },
      },
      required: ["enrichGroupParticipantsFromContacts"],
      additionalProperties: false,
    },
    uiHints: {
      "": {
        label: "BlueBubbles",
        help: "BlueBubbles channel provider configuration used for Apple messaging bridge integrations. Keep DM policy aligned with your trusted sender model in shared deployments.",
      },
      dmPolicy: {
        label: "BlueBubbles DM Policy",
        help: 'Direct message access control ("pairing" recommended). "open" requires channels.bluebubbles.allowFrom=["*"].',
      },
    },
  },
  {
    pluginId: "discord",
    channelId: "discord",
    label: "Discord",
    description: "very well supported right now.",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        name: {
          type: "string",
        },
        capabilities: {
          type: "array",
          items: {
            type: "string",
          },
        },
        markdown: {
          type: "object",
          properties: {
            tables: {
              type: "string",
              enum: ["off", "bullets", "code"],
            },
          },
          additionalProperties: true,
        },
        enabled: {
          type: "boolean",
        },
        commands: {
          type: "object",
          properties: {
            native: {
              anyOf: [
                {
                  type: "boolean",
                },
                {
                  type: "string",
                  const: "auto",
                },
              ],
            },
            nativeSkills: {
              anyOf: [
                {
                  type: "boolean",
                },
                {
                  type: "string",
                  const: "auto",
                },
              ],
            },
          },
          additionalProperties: true,
        },
        configWrites: {
          type: "boolean",
        },
        token: {
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: true,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: true,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: true,
                },
              ],
            },
          ],
        },
        proxy: {
          type: "string",
        },
        allowBots: {
          anyOf: [
            {
              type: "boolean",
            },
            {
              type: "string",
              const: "mentions",
            },
          ],
        },
        dangerouslyAllowNameMatching: {
          type: "boolean",
        },
        groupPolicy: {
          default: "allowlist",
          type: "string",
          enum: ["open", "disabled", "allowlist"],
        },
        historyLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dmHistoryLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dms: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
            },
            additionalProperties: true,
          },
        },
        textChunkLimit: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        chunkMode: {
          type: "string",
          enum: ["length", "newline"],
        },
        blockStreaming: {
          type: "boolean",
        },
        blockStreamingCoalesce: {
          type: "object",
          properties: {
            minChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            maxChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            idleMs: {
              type: "integer",
              minimum: 0,
              maximum: 9007199254740991,
            },
          },
          additionalProperties: true,
        },
        streaming: {
          anyOf: [
            {
              type: "boolean",
            },
            {
              type: "string",
              enum: ["off", "partial", "block", "progress"],
            },
          ],
        },
        streamMode: {
          type: "string",
          enum: ["partial", "block", "off"],
        },
        draftChunk: {
          type: "object",
          properties: {
            minChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            maxChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            breakPreference: {
              anyOf: [
                {
                  type: "string",
                  const: "paragraph",
                },
                {
                  type: "string",
                  const: "newline",
                },
                {
                  type: "string",
                  const: "sentence",
                },
              ],
            },
          },
          additionalProperties: true,
        },
        maxLinesPerMessage: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        mediaMaxMb: {
          type: "number",
          exclusiveMinimum: 0,
        },
        retry: {
          type: "object",
          properties: {
            attempts: {
              type: "integer",
              minimum: 1,
              maximum: 9007199254740991,
            },
            minDelayMs: {
              type: "integer",
              minimum: 0,
              maximum: 9007199254740991,
            },
            maxDelayMs: {
              type: "integer",
              minimum: 0,
              maximum: 9007199254740991,
            },
            jitter: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
          additionalProperties: true,
        },
        actions: {
          type: "object",
          properties: {
            reactions: {
              type: "boolean",
            },
            stickers: {
              type: "boolean",
            },
            emojiUploads: {
              type: "boolean",
            },
            stickerUploads: {
              type: "boolean",
            },
            polls: {
              type: "boolean",
            },
            permissions: {
              type: "boolean",
            },
            messages: {
              type: "boolean",
            },
            threads: {
              type: "boolean",
            },
            pins: {
              type: "boolean",
            },
            search: {
              type: "boolean",
            },
            memberInfo: {
              type: "boolean",
            },
            roleInfo: {
              type: "boolean",
            },
            roles: {
              type: "boolean",
            },
            channelInfo: {
              type: "boolean",
            },
            voiceStatus: {
              type: "boolean",
            },
            events: {
              type: "boolean",
            },
            moderation: {
              type: "boolean",
            },
            channels: {
              type: "boolean",
            },
            presence: {
              type: "boolean",
            },
          },
          additionalProperties: true,
        },
        replyToMode: {
          anyOf: [
            {
              type: "string",
              const: "off",
            },
            {
              type: "string",
              const: "first",
            },
            {
              type: "string",
              const: "all",
            },
          ],
        },
        dmPolicy: {
          type: "string",
          enum: ["pairing", "allowlist", "open", "disabled"],
        },
        allowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        defaultTo: {
          type: "string",
        },
        dm: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
            policy: {
              type: "string",
              enum: ["pairing", "allowlist", "open", "disabled"],
            },
            allowFrom: {
              type: "array",
              items: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    type: "number",
                  },
                ],
              },
            },
            groupEnabled: {
              type: "boolean",
            },
            groupChannels: {
              type: "array",
              items: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    type: "number",
                  },
                ],
              },
            },
          },
          additionalProperties: true,
        },
        guilds: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              slug: {
                type: "string",
              },
              requireMention: {
                type: "boolean",
              },
              ignoreOtherMentions: {
                type: "boolean",
              },
              tools: {
                type: "object",
                properties: {
                  allow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  alsoAllow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  deny: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },
                additionalProperties: true,
              },
              toolsBySender: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    allow: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    alsoAllow: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    deny: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                  },
                  additionalProperties: true,
                },
              },
              reactionNotifications: {
                type: "string",
                enum: ["off", "own", "all", "allowlist"],
              },
              users: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              roles: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              channels: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    allow: {
                      type: "boolean",
                    },
                    requireMention: {
                      type: "boolean",
                    },
                    ignoreOtherMentions: {
                      type: "boolean",
                    },
                    tools: {
                      type: "object",
                      properties: {
                        allow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        alsoAllow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        deny: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                      },
                      additionalProperties: true,
                    },
                    toolsBySender: {
                      type: "object",
                      propertyNames: {
                        type: "string",
                      },
                      additionalProperties: {
                        type: "object",
                        properties: {
                          allow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          alsoAllow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          deny: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                        },
                        additionalProperties: true,
                      },
                    },
                    skills: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    enabled: {
                      type: "boolean",
                    },
                    users: {
                      type: "array",
                      items: {
                        anyOf: [
                          {
                            type: "string",
                          },
                          {
                            type: "number",
                          },
                        ],
                      },
                    },
                    roles: {
                      type: "array",
                      items: {
                        anyOf: [
                          {
                            type: "string",
                          },
                          {
                            type: "number",
                          },
                        ],
                      },
                    },
                    systemPrompt: {
                      type: "string",
                    },
                    includeThreadStarter: {
                      type: "boolean",
                    },
                    autoThread: {
                      type: "boolean",
                    },
                    autoThreadName: {
                      type: "string",
                      enum: ["message", "generated"],
                    },
                    autoArchiveDuration: {
                      anyOf: [
                        {
                          type: "string",
                          enum: ["60", "1440", "4320", "10080"],
                        },
                        {
                          type: "number",
                          const: 60,
                        },
                        {
                          type: "number",
                          const: 1440,
                        },
                        {
                          type: "number",
                          const: 4320,
                        },
                        {
                          type: "number",
                          const: 10080,
                        },
                      ],
                    },
                    gateMode: {
                      type: "string",
                      enum: ["blocked", "silent", "frank-only", "allowlist", "mention", "open"],
                    },
                    allowFrom: {
                      type: "array",
                      items: {
                        anyOf: [
                          {
                            type: "string",
                          },
                          {
                            type: "number",
                          },
                        ],
                      },
                    },
                  },
                  additionalProperties: true,
                },
              },
              gateMode: {
                type: "string",
                enum: ["blocked", "silent", "frank-only", "allowlist", "mention", "open"],
              },
              allowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
            },
            additionalProperties: true,
          },
        },
        heartbeat: {
          type: "object",
          properties: {
            showOk: {
              type: "boolean",
            },
            showAlerts: {
              type: "boolean",
            },
            useIndicator: {
              type: "boolean",
            },
          },
          additionalProperties: true,
        },
        healthMonitor: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
          },
          additionalProperties: true,
        },
        execApprovals: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
            approvers: {
              type: "array",
              items: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    type: "number",
                  },
                ],
              },
            },
            agentFilter: {
              type: "array",
              items: {
                type: "string",
              },
            },
            sessionFilter: {
              type: "array",
              items: {
                type: "string",
              },
            },
            cleanupAfterResolve: {
              type: "boolean",
            },
            target: {
              type: "string",
              enum: ["dm", "channel", "both"],
            },
          },
          additionalProperties: true,
        },
        agentComponents: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
          },
          additionalProperties: true,
        },
        ui: {
          type: "object",
          properties: {
            components: {
              type: "object",
              properties: {
                accentColor: {
                  type: "string",
                  pattern: "^#?[0-9a-fA-F]{6}$",
                },
              },
              additionalProperties: true,
            },
          },
          additionalProperties: true,
        },
        slashCommand: {
          type: "object",
          properties: {
            ephemeral: {
              type: "boolean",
            },
          },
          additionalProperties: true,
        },
        threadBindings: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
            idleHours: {
              type: "number",
              minimum: 0,
            },
            maxAgeHours: {
              type: "number",
              minimum: 0,
            },
            spawnSubagentSessions: {
              type: "boolean",
            },
            spawnAcpSessions: {
              type: "boolean",
            },
          },
          additionalProperties: true,
        },
        intents: {
          type: "object",
          properties: {
            presence: {
              type: "boolean",
            },
            guildMembers: {
              type: "boolean",
            },
          },
          additionalProperties: true,
        },
        voice: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
            autoJoin: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  guildId: {
                    type: "string",
                    minLength: 1,
                  },
                  channelId: {
                    type: "string",
                    minLength: 1,
                  },
                },
                required: ["guildId", "channelId"],
                additionalProperties: true,
              },
            },
            daveEncryption: {
              type: "boolean",
            },
            decryptionFailureTolerance: {
              type: "integer",
              minimum: 0,
              maximum: 9007199254740991,
            },
            tts: {
              type: "object",
              properties: {
                auto: {
                  type: "string",
                  enum: ["off", "always", "inbound", "tagged"],
                },
                enabled: {
                  type: "boolean",
                },
                mode: {
                  type: "string",
                  enum: ["final", "all"],
                },
                provider: {
                  type: "string",
                  minLength: 1,
                },
                summaryModel: {
                  type: "string",
                },
                modelOverrides: {
                  type: "object",
                  properties: {
                    enabled: {
                      type: "boolean",
                    },
                    allowText: {
                      type: "boolean",
                    },
                    allowProvider: {
                      type: "boolean",
                    },
                    allowVoice: {
                      type: "boolean",
                    },
                    allowModelId: {
                      type: "boolean",
                    },
                    allowVoiceSettings: {
                      type: "boolean",
                    },
                    allowNormalization: {
                      type: "boolean",
                    },
                    allowSeed: {
                      type: "boolean",
                    },
                  },
                  additionalProperties: true,
                },
                providers: {
                  type: "object",
                  propertyNames: {
                    type: "string",
                  },
                  additionalProperties: {
                    type: "object",
                    properties: {
                      apiKey: {
                        anyOf: [
                          {
                            type: "string",
                          },
                          {
                            oneOf: [
                              {
                                type: "object",
                                properties: {
                                  source: {
                                    type: "string",
                                    const: "env",
                                  },
                                  provider: {
                                    type: "string",
                                    pattern: "^[a-z][a-z0-9_-]{0,63}$",
                                  },
                                  id: {
                                    type: "string",
                                    pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                                  },
                                },
                                required: ["source", "provider", "id"],
                                additionalProperties: true,
                              },
                              {
                                type: "object",
                                properties: {
                                  source: {
                                    type: "string",
                                    const: "file",
                                  },
                                  provider: {
                                    type: "string",
                                    pattern: "^[a-z][a-z0-9_-]{0,63}$",
                                  },
                                  id: {
                                    type: "string",
                                  },
                                },
                                required: ["source", "provider", "id"],
                                additionalProperties: true,
                              },
                              {
                                type: "object",
                                properties: {
                                  source: {
                                    type: "string",
                                    const: "exec",
                                  },
                                  provider: {
                                    type: "string",
                                    pattern: "^[a-z][a-z0-9_-]{0,63}$",
                                  },
                                  id: {
                                    type: "string",
                                  },
                                },
                                required: ["source", "provider", "id"],
                                additionalProperties: true,
                              },
                            ],
                          },
                        ],
                      },
                    },
                    additionalProperties: {
                      anyOf: [
                        {
                          type: "string",
                        },
                        {
                          type: "number",
                        },
                        {
                          type: "boolean",
                        },
                        {
                          type: "null",
                        },
                        {
                          type: "array",
                          items: {},
                        },
                        {
                          type: "object",
                          propertyNames: {
                            type: "string",
                          },
                          additionalProperties: {},
                        },
                      ],
                    },
                  },
                },
                prefsPath: {
                  type: "string",
                },
                maxTextLength: {
                  type: "integer",
                  minimum: 1,
                  maximum: 9007199254740991,
                },
                timeoutMs: {
                  type: "integer",
                  minimum: 1e3,
                  maximum: 12e4,
                },
              },
              additionalProperties: true,
            },
          },
          additionalProperties: true,
        },
        pluralkit: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
            token: {
              anyOf: [
                {
                  type: "string",
                },
                {
                  oneOf: [
                    {
                      type: "object",
                      properties: {
                        source: {
                          type: "string",
                          const: "env",
                        },
                        provider: {
                          type: "string",
                          pattern: "^[a-z][a-z0-9_-]{0,63}$",
                        },
                        id: {
                          type: "string",
                          pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                        },
                      },
                      required: ["source", "provider", "id"],
                      additionalProperties: true,
                    },
                    {
                      type: "object",
                      properties: {
                        source: {
                          type: "string",
                          const: "file",
                        },
                        provider: {
                          type: "string",
                          pattern: "^[a-z][a-z0-9_-]{0,63}$",
                        },
                        id: {
                          type: "string",
                        },
                      },
                      required: ["source", "provider", "id"],
                      additionalProperties: true,
                    },
                    {
                      type: "object",
                      properties: {
                        source: {
                          type: "string",
                          const: "exec",
                        },
                        provider: {
                          type: "string",
                          pattern: "^[a-z][a-z0-9_-]{0,63}$",
                        },
                        id: {
                          type: "string",
                        },
                      },
                      required: ["source", "provider", "id"],
                      additionalProperties: true,
                    },
                  ],
                },
              ],
            },
          },
          additionalProperties: true,
        },
        responsePrefix: {
          type: "string",
        },
        ackReaction: {
          type: "string",
        },
        ackReactionScope: {
          type: "string",
          enum: ["group-mentions", "group-all", "direct", "all", "off", "none"],
        },
        activity: {
          type: "string",
        },
        status: {
          type: "string",
          enum: ["online", "dnd", "idle", "invisible"],
        },
        autoPresence: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
            intervalMs: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            minUpdateIntervalMs: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            healthyText: {
              type: "string",
            },
            degradedText: {
              type: "string",
            },
            exhaustedText: {
              type: "string",
            },
          },
          additionalProperties: true,
        },
        activityType: {
          anyOf: [
            {
              type: "number",
              const: 0,
            },
            {
              type: "number",
              const: 1,
            },
            {
              type: "number",
              const: 2,
            },
            {
              type: "number",
              const: 3,
            },
            {
              type: "number",
              const: 4,
            },
            {
              type: "number",
              const: 5,
            },
          ],
        },
        activityUrl: {
          type: "string",
          format: "uri",
        },
        inboundWorker: {
          type: "object",
          properties: {
            runTimeoutMs: {
              type: "integer",
              minimum: 0,
              maximum: 9007199254740991,
            },
          },
          additionalProperties: true,
        },
        eventQueue: {
          type: "object",
          properties: {
            listenerTimeout: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            maxQueueSize: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            maxConcurrency: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
          },
          additionalProperties: true,
        },
        accounts: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              capabilities: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              markdown: {
                type: "object",
                properties: {
                  tables: {
                    type: "string",
                    enum: ["off", "bullets", "code"],
                  },
                },
                additionalProperties: true,
              },
              enabled: {
                type: "boolean",
              },
              commands: {
                type: "object",
                properties: {
                  native: {
                    anyOf: [
                      {
                        type: "boolean",
                      },
                      {
                        type: "string",
                        const: "auto",
                      },
                    ],
                  },
                  nativeSkills: {
                    anyOf: [
                      {
                        type: "boolean",
                      },
                      {
                        type: "string",
                        const: "auto",
                      },
                    ],
                  },
                },
                additionalProperties: true,
              },
              configWrites: {
                type: "boolean",
              },
              token: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "env",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                            pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: true,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "file",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: true,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "exec",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: true,
                      },
                    ],
                  },
                ],
              },
              proxy: {
                type: "string",
              },
              allowBots: {
                anyOf: [
                  {
                    type: "boolean",
                  },
                  {
                    type: "string",
                    const: "mentions",
                  },
                ],
              },
              dangerouslyAllowNameMatching: {
                type: "boolean",
              },
              groupPolicy: {
                default: "allowlist",
                type: "string",
                enum: ["open", "disabled", "allowlist"],
              },
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dmHistoryLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dms: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    historyLimit: {
                      type: "integer",
                      minimum: 0,
                      maximum: 9007199254740991,
                    },
                  },
                  additionalProperties: true,
                },
              },
              textChunkLimit: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              chunkMode: {
                type: "string",
                enum: ["length", "newline"],
              },
              blockStreaming: {
                type: "boolean",
              },
              blockStreamingCoalesce: {
                type: "object",
                properties: {
                  minChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  maxChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  idleMs: {
                    type: "integer",
                    minimum: 0,
                    maximum: 9007199254740991,
                  },
                },
                additionalProperties: true,
              },
              streaming: {
                anyOf: [
                  {
                    type: "boolean",
                  },
                  {
                    type: "string",
                    enum: ["off", "partial", "block", "progress"],
                  },
                ],
              },
              streamMode: {
                type: "string",
                enum: ["partial", "block", "off"],
              },
              draftChunk: {
                type: "object",
                properties: {
                  minChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  maxChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  breakPreference: {
                    anyOf: [
                      {
                        type: "string",
                        const: "paragraph",
                      },
                      {
                        type: "string",
                        const: "newline",
                      },
                      {
                        type: "string",
                        const: "sentence",
                      },
                    ],
                  },
                },
                additionalProperties: true,
              },
              maxLinesPerMessage: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              mediaMaxMb: {
                type: "number",
                exclusiveMinimum: 0,
              },
              retry: {
                type: "object",
                properties: {
                  attempts: {
                    type: "integer",
                    minimum: 1,
                    maximum: 9007199254740991,
                  },
                  minDelayMs: {
                    type: "integer",
                    minimum: 0,
                    maximum: 9007199254740991,
                  },
                  maxDelayMs: {
                    type: "integer",
                    minimum: 0,
                    maximum: 9007199254740991,
                  },
                  jitter: {
                    type: "number",
                    minimum: 0,
                    maximum: 1,
                  },
                },
                additionalProperties: true,
              },
              actions: {
                type: "object",
                properties: {
                  reactions: {
                    type: "boolean",
                  },
                  stickers: {
                    type: "boolean",
                  },
                  emojiUploads: {
                    type: "boolean",
                  },
                  stickerUploads: {
                    type: "boolean",
                  },
                  polls: {
                    type: "boolean",
                  },
                  permissions: {
                    type: "boolean",
                  },
                  messages: {
                    type: "boolean",
                  },
                  threads: {
                    type: "boolean",
                  },
                  pins: {
                    type: "boolean",
                  },
                  search: {
                    type: "boolean",
                  },
                  memberInfo: {
                    type: "boolean",
                  },
                  roleInfo: {
                    type: "boolean",
                  },
                  roles: {
                    type: "boolean",
                  },
                  channelInfo: {
                    type: "boolean",
                  },
                  voiceStatus: {
                    type: "boolean",
                  },
                  events: {
                    type: "boolean",
                  },
                  moderation: {
                    type: "boolean",
                  },
                  channels: {
                    type: "boolean",
                  },
                  presence: {
                    type: "boolean",
                  },
                },
                additionalProperties: true,
              },
              replyToMode: {
                anyOf: [
                  {
                    type: "string",
                    const: "off",
                  },
                  {
                    type: "string",
                    const: "first",
                  },
                  {
                    type: "string",
                    const: "all",
                  },
                ],
              },
              dmPolicy: {
                type: "string",
                enum: ["pairing", "allowlist", "open", "disabled"],
              },
              allowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              defaultTo: {
                type: "string",
              },
              dm: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                  policy: {
                    type: "string",
                    enum: ["pairing", "allowlist", "open", "disabled"],
                  },
                  allowFrom: {
                    type: "array",
                    items: {
                      anyOf: [
                        {
                          type: "string",
                        },
                        {
                          type: "number",
                        },
                      ],
                    },
                  },
                  groupEnabled: {
                    type: "boolean",
                  },
                  groupChannels: {
                    type: "array",
                    items: {
                      anyOf: [
                        {
                          type: "string",
                        },
                        {
                          type: "number",
                        },
                      ],
                    },
                  },
                },
                additionalProperties: true,
              },
              guilds: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    slug: {
                      type: "string",
                    },
                    requireMention: {
                      type: "boolean",
                    },
                    ignoreOtherMentions: {
                      type: "boolean",
                    },
                    tools: {
                      type: "object",
                      properties: {
                        allow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        alsoAllow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        deny: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                      },
                      additionalProperties: true,
                    },
                    toolsBySender: {
                      type: "object",
                      propertyNames: {
                        type: "string",
                      },
                      additionalProperties: {
                        type: "object",
                        properties: {
                          allow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          alsoAllow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          deny: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                        },
                        additionalProperties: true,
                      },
                    },
                    reactionNotifications: {
                      type: "string",
                      enum: ["off", "own", "all", "allowlist"],
                    },
                    users: {
                      type: "array",
                      items: {
                        anyOf: [
                          {
                            type: "string",
                          },
                          {
                            type: "number",
                          },
                        ],
                      },
                    },
                    roles: {
                      type: "array",
                      items: {
                        anyOf: [
                          {
                            type: "string",
                          },
                          {
                            type: "number",
                          },
                        ],
                      },
                    },
                    channels: {
                      type: "object",
                      propertyNames: {
                        type: "string",
                      },
                      additionalProperties: {
                        type: "object",
                        properties: {
                          allow: {
                            type: "boolean",
                          },
                          requireMention: {
                            type: "boolean",
                          },
                          ignoreOtherMentions: {
                            type: "boolean",
                          },
                          tools: {
                            type: "object",
                            properties: {
                              allow: {
                                type: "array",
                                items: {
                                  type: "string",
                                },
                              },
                              alsoAllow: {
                                type: "array",
                                items: {
                                  type: "string",
                                },
                              },
                              deny: {
                                type: "array",
                                items: {
                                  type: "string",
                                },
                              },
                            },
                            additionalProperties: true,
                          },
                          toolsBySender: {
                            type: "object",
                            propertyNames: {
                              type: "string",
                            },
                            additionalProperties: {
                              type: "object",
                              properties: {
                                allow: {
                                  type: "array",
                                  items: {
                                    type: "string",
                                  },
                                },
                                alsoAllow: {
                                  type: "array",
                                  items: {
                                    type: "string",
                                  },
                                },
                                deny: {
                                  type: "array",
                                  items: {
                                    type: "string",
                                  },
                                },
                              },
                              additionalProperties: true,
                            },
                          },
                          skills: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          enabled: {
                            type: "boolean",
                          },
                          users: {
                            type: "array",
                            items: {
                              anyOf: [
                                {
                                  type: "string",
                                },
                                {
                                  type: "number",
                                },
                              ],
                            },
                          },
                          roles: {
                            type: "array",
                            items: {
                              anyOf: [
                                {
                                  type: "string",
                                },
                                {
                                  type: "number",
                                },
                              ],
                            },
                          },
                          systemPrompt: {
                            type: "string",
                          },
                          includeThreadStarter: {
                            type: "boolean",
                          },
                          autoThread: {
                            type: "boolean",
                          },
                          autoThreadName: {
                            type: "string",
                            enum: ["message", "generated"],
                          },
                          autoArchiveDuration: {
                            anyOf: [
                              {
                                type: "string",
                                enum: ["60", "1440", "4320", "10080"],
                              },
                              {
                                type: "number",
                                const: 60,
                              },
                              {
                                type: "number",
                                const: 1440,
                              },
                              {
                                type: "number",
                                const: 4320,
                              },
                              {
                                type: "number",
                                const: 10080,
                              },
                            ],
                          },
                          gateMode: {
                            type: "string",
                            enum: [
                              "blocked",
                              "silent",
                              "frank-only",
                              "allowlist",
                              "mention",
                              "open",
                            ],
                          },
                          allowFrom: {
                            type: "array",
                            items: {
                              anyOf: [
                                {
                                  type: "string",
                                },
                                {
                                  type: "number",
                                },
                              ],
                            },
                          },
                        },
                        additionalProperties: true,
                      },
                    },
                    gateMode: {
                      type: "string",
                      enum: ["blocked", "silent", "frank-only", "allowlist", "mention", "open"],
                    },
                    allowFrom: {
                      type: "array",
                      items: {
                        anyOf: [
                          {
                            type: "string",
                          },
                          {
                            type: "number",
                          },
                        ],
                      },
                    },
                  },
                  additionalProperties: true,
                },
              },
              heartbeat: {
                type: "object",
                properties: {
                  showOk: {
                    type: "boolean",
                  },
                  showAlerts: {
                    type: "boolean",
                  },
                  useIndicator: {
                    type: "boolean",
                  },
                },
                additionalProperties: true,
              },
              healthMonitor: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                },
                additionalProperties: true,
              },
              execApprovals: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                  approvers: {
                    type: "array",
                    items: {
                      anyOf: [
                        {
                          type: "string",
                        },
                        {
                          type: "number",
                        },
                      ],
                    },
                  },
                  agentFilter: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  sessionFilter: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  cleanupAfterResolve: {
                    type: "boolean",
                  },
                  target: {
                    type: "string",
                    enum: ["dm", "channel", "both"],
                  },
                },
                additionalProperties: true,
              },
              agentComponents: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                },
                additionalProperties: true,
              },
              ui: {
                type: "object",
                properties: {
                  components: {
                    type: "object",
                    properties: {
                      accentColor: {
                        type: "string",
                        pattern: "^#?[0-9a-fA-F]{6}$",
                      },
                    },
                    additionalProperties: true,
                  },
                },
                additionalProperties: true,
              },
              slashCommand: {
                type: "object",
                properties: {
                  ephemeral: {
                    type: "boolean",
                  },
                },
                additionalProperties: true,
              },
              threadBindings: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                  idleHours: {
                    type: "number",
                    minimum: 0,
                  },
                  maxAgeHours: {
                    type: "number",
                    minimum: 0,
                  },
                  spawnSubagentSessions: {
                    type: "boolean",
                  },
                  spawnAcpSessions: {
                    type: "boolean",
                  },
                },
                additionalProperties: true,
              },
              intents: {
                type: "object",
                properties: {
                  presence: {
                    type: "boolean",
                  },
                  guildMembers: {
                    type: "boolean",
                  },
                },
                additionalProperties: true,
              },
              voice: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                  autoJoin: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        guildId: {
                          type: "string",
                          minLength: 1,
                        },
                        channelId: {
                          type: "string",
                          minLength: 1,
                        },
                      },
                      required: ["guildId", "channelId"],
                      additionalProperties: true,
                    },
                  },
                  daveEncryption: {
                    type: "boolean",
                  },
                  decryptionFailureTolerance: {
                    type: "integer",
                    minimum: 0,
                    maximum: 9007199254740991,
                  },
                  tts: {
                    type: "object",
                    properties: {
                      auto: {
                        type: "string",
                        enum: ["off", "always", "inbound", "tagged"],
                      },
                      enabled: {
                        type: "boolean",
                      },
                      mode: {
                        type: "string",
                        enum: ["final", "all"],
                      },
                      provider: {
                        type: "string",
                        minLength: 1,
                      },
                      summaryModel: {
                        type: "string",
                      },
                      modelOverrides: {
                        type: "object",
                        properties: {
                          enabled: {
                            type: "boolean",
                          },
                          allowText: {
                            type: "boolean",
                          },
                          allowProvider: {
                            type: "boolean",
                          },
                          allowVoice: {
                            type: "boolean",
                          },
                          allowModelId: {
                            type: "boolean",
                          },
                          allowVoiceSettings: {
                            type: "boolean",
                          },
                          allowNormalization: {
                            type: "boolean",
                          },
                          allowSeed: {
                            type: "boolean",
                          },
                        },
                        additionalProperties: true,
                      },
                      providers: {
                        type: "object",
                        propertyNames: {
                          type: "string",
                        },
                        additionalProperties: {
                          type: "object",
                          properties: {
                            apiKey: {
                              anyOf: [
                                {
                                  type: "string",
                                },
                                {
                                  oneOf: [
                                    {
                                      type: "object",
                                      properties: {
                                        source: {
                                          type: "string",
                                          const: "env",
                                        },
                                        provider: {
                                          type: "string",
                                          pattern: "^[a-z][a-z0-9_-]{0,63}$",
                                        },
                                        id: {
                                          type: "string",
                                          pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                                        },
                                      },
                                      required: ["source", "provider", "id"],
                                      additionalProperties: true,
                                    },
                                    {
                                      type: "object",
                                      properties: {
                                        source: {
                                          type: "string",
                                          const: "file",
                                        },
                                        provider: {
                                          type: "string",
                                          pattern: "^[a-z][a-z0-9_-]{0,63}$",
                                        },
                                        id: {
                                          type: "string",
                                        },
                                      },
                                      required: ["source", "provider", "id"],
                                      additionalProperties: true,
                                    },
                                    {
                                      type: "object",
                                      properties: {
                                        source: {
                                          type: "string",
                                          const: "exec",
                                        },
                                        provider: {
                                          type: "string",
                                          pattern: "^[a-z][a-z0-9_-]{0,63}$",
                                        },
                                        id: {
                                          type: "string",
                                        },
                                      },
                                      required: ["source", "provider", "id"],
                                      additionalProperties: true,
                                    },
                                  ],
                                },
                              ],
                            },
                          },
                          additionalProperties: {
                            anyOf: [
                              {
                                type: "string",
                              },
                              {
                                type: "number",
                              },
                              {
                                type: "boolean",
                              },
                              {
                                type: "null",
                              },
                              {
                                type: "array",
                                items: {},
                              },
                              {
                                type: "object",
                                propertyNames: {
                                  type: "string",
                                },
                                additionalProperties: {},
                              },
                            ],
                          },
                        },
                      },
                      prefsPath: {
                        type: "string",
                      },
                      maxTextLength: {
                        type: "integer",
                        minimum: 1,
                        maximum: 9007199254740991,
                      },
                      timeoutMs: {
                        type: "integer",
                        minimum: 1e3,
                        maximum: 12e4,
                      },
                    },
                    additionalProperties: true,
                  },
                },
                additionalProperties: true,
              },
              pluralkit: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                  token: {
                    anyOf: [
                      {
                        type: "string",
                      },
                      {
                        oneOf: [
                          {
                            type: "object",
                            properties: {
                              source: {
                                type: "string",
                                const: "env",
                              },
                              provider: {
                                type: "string",
                                pattern: "^[a-z][a-z0-9_-]{0,63}$",
                              },
                              id: {
                                type: "string",
                                pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                              },
                            },
                            required: ["source", "provider", "id"],
                            additionalProperties: true,
                          },
                          {
                            type: "object",
                            properties: {
                              source: {
                                type: "string",
                                const: "file",
                              },
                              provider: {
                                type: "string",
                                pattern: "^[a-z][a-z0-9_-]{0,63}$",
                              },
                              id: {
                                type: "string",
                              },
                            },
                            required: ["source", "provider", "id"],
                            additionalProperties: true,
                          },
                          {
                            type: "object",
                            properties: {
                              source: {
                                type: "string",
                                const: "exec",
                              },
                              provider: {
                                type: "string",
                                pattern: "^[a-z][a-z0-9_-]{0,63}$",
                              },
                              id: {
                                type: "string",
                              },
                            },
                            required: ["source", "provider", "id"],
                            additionalProperties: true,
                          },
                        ],
                      },
                    ],
                  },
                },
                additionalProperties: true,
              },
              responsePrefix: {
                type: "string",
              },
              ackReaction: {
                type: "string",
              },
              ackReactionScope: {
                type: "string",
                enum: ["group-mentions", "group-all", "direct", "all", "off", "none"],
              },
              activity: {
                type: "string",
              },
              status: {
                type: "string",
                enum: ["online", "dnd", "idle", "invisible"],
              },
              autoPresence: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                  intervalMs: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  minUpdateIntervalMs: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  healthyText: {
                    type: "string",
                  },
                  degradedText: {
                    type: "string",
                  },
                  exhaustedText: {
                    type: "string",
                  },
                },
                additionalProperties: true,
              },
              activityType: {
                anyOf: [
                  {
                    type: "number",
                    const: 0,
                  },
                  {
                    type: "number",
                    const: 1,
                  },
                  {
                    type: "number",
                    const: 2,
                  },
                  {
                    type: "number",
                    const: 3,
                  },
                  {
                    type: "number",
                    const: 4,
                  },
                  {
                    type: "number",
                    const: 5,
                  },
                ],
              },
              activityUrl: {
                type: "string",
                format: "uri",
              },
              inboundWorker: {
                type: "object",
                properties: {
                  runTimeoutMs: {
                    type: "integer",
                    minimum: 0,
                    maximum: 9007199254740991,
                  },
                },
                additionalProperties: true,
              },
              eventQueue: {
                type: "object",
                properties: {
                  listenerTimeout: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  maxQueueSize: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  maxConcurrency: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                },
                additionalProperties: true,
              },
            },
            required: ["groupPolicy"],
            additionalProperties: true,
          },
        },
        defaultAccount: {
          type: "string",
        },
      },
      required: ["groupPolicy"],
      additionalProperties: true,
    },
    uiHints: {
      "": {
        label: "Discord",
        help: "Discord channel provider configuration for bot auth, retry policy, streaming, thread bindings, and optional voice capabilities. Keep privileged intents and advanced features disabled unless needed.",
      },
      dmPolicy: {
        label: "Discord DM Policy",
        help: 'Direct message access control ("pairing" recommended). "open" requires channels.discord.allowFrom=["*"].',
      },
      "dm.policy": {
        label: "Discord DM Policy",
        help: 'Direct message access control ("pairing" recommended). "open" requires channels.discord.allowFrom=["*"] (legacy: channels.discord.dm.allowFrom).',
      },
      configWrites: {
        label: "Discord Config Writes",
        help: "Allow Discord to write config in response to channel events/commands (default: true).",
      },
      proxy: {
        label: "Discord Proxy URL",
        help: "Proxy URL for Discord gateway + API requests (app-id lookup and allowlist resolution). Set per account via channels.discord.accounts.<id>.proxy.",
      },
      "commands.native": {
        label: "Discord Native Commands",
        help: 'Override native commands for Discord (bool or "auto").',
      },
      "commands.nativeSkills": {
        label: "Discord Native Skill Commands",
        help: 'Override native skill commands for Discord (bool or "auto").',
      },
      streaming: {
        label: "Discord Streaming Mode",
        help: 'Unified Discord stream preview mode: "off" | "partial" | "block" | "progress". "progress" maps to "partial" on Discord. Legacy boolean/streamMode keys are auto-mapped.',
      },
      streamMode: {
        label: "Discord Stream Mode (Legacy)",
        help: "Legacy Discord preview mode alias (off | partial | block); auto-migrated to channels.discord.streaming.",
      },
      "draftChunk.minChars": {
        label: "Discord Draft Chunk Min Chars",
        help: 'Minimum chars before emitting a Discord stream preview update when channels.discord.streaming="block" (default: 200).',
      },
      "draftChunk.maxChars": {
        label: "Discord Draft Chunk Max Chars",
        help: 'Target max size for a Discord stream preview chunk when channels.discord.streaming="block" (default: 800; clamped to channels.discord.textChunkLimit).',
      },
      "draftChunk.breakPreference": {
        label: "Discord Draft Chunk Break Preference",
        help: "Preferred breakpoints for Discord draft chunks (paragraph | newline | sentence). Default: paragraph.",
      },
      "retry.attempts": {
        label: "Discord Retry Attempts",
        help: "Max retry attempts for outbound Discord API calls (default: 3).",
      },
      "retry.minDelayMs": {
        label: "Discord Retry Min Delay (ms)",
        help: "Minimum retry delay in ms for Discord outbound calls.",
      },
      "retry.maxDelayMs": {
        label: "Discord Retry Max Delay (ms)",
        help: "Maximum retry delay cap in ms for Discord outbound calls.",
      },
      "retry.jitter": {
        label: "Discord Retry Jitter",
        help: "Jitter factor (0-1) applied to Discord retry delays.",
      },
      maxLinesPerMessage: {
        label: "Discord Max Lines Per Message",
        help: "Soft max line count per Discord message (default: 17).",
      },
      "inboundWorker.runTimeoutMs": {
        label: "Discord Inbound Worker Timeout (ms)",
        help: "Optional queued Discord inbound worker timeout in ms. This is separate from Carbon listener timeouts; defaults to 1800000 and can be disabled with 0. Set per account via channels.discord.accounts.<id>.inboundWorker.runTimeoutMs.",
      },
      "eventQueue.listenerTimeout": {
        label: "Discord EventQueue Listener Timeout (ms)",
        help: "Canonical Discord listener timeout control in ms for gateway normalization/enqueue handlers. Default is 120000 in OpenClaw; set per account via channels.discord.accounts.<id>.eventQueue.listenerTimeout.",
      },
      "eventQueue.maxQueueSize": {
        label: "Discord EventQueue Max Queue Size",
        help: "Optional Discord EventQueue capacity override (max queued events before backpressure). Set per account via channels.discord.accounts.<id>.eventQueue.maxQueueSize.",
      },
      "eventQueue.maxConcurrency": {
        label: "Discord EventQueue Max Concurrency",
        help: "Optional Discord EventQueue concurrency override (max concurrent handler executions). Set per account via channels.discord.accounts.<id>.eventQueue.maxConcurrency.",
      },
      "threadBindings.enabled": {
        label: "Discord Thread Binding Enabled",
        help: "Enable Discord thread binding features (/focus, bound-thread routing/delivery, and thread-bound subagent sessions). Overrides session.threadBindings.enabled when set.",
      },
      "threadBindings.idleHours": {
        label: "Discord Thread Binding Idle Timeout (hours)",
        help: "Inactivity window in hours for Discord thread-bound sessions (/focus and spawned thread sessions). Set 0 to disable idle auto-unfocus (default: 24). Overrides session.threadBindings.idleHours when set.",
      },
      "threadBindings.maxAgeHours": {
        label: "Discord Thread Binding Max Age (hours)",
        help: "Optional hard max age in hours for Discord thread-bound sessions. Set 0 to disable hard cap (default: 0). Overrides session.threadBindings.maxAgeHours when set.",
      },
      "threadBindings.spawnSubagentSessions": {
        label: "Discord Thread-Bound Subagent Spawn",
        help: "Allow subagent spawns with thread=true to auto-create and bind Discord threads (default: false; opt-in). Set true to enable thread-bound subagent spawns for this account/channel.",
      },
      "threadBindings.spawnAcpSessions": {
        label: "Discord Thread-Bound ACP Spawn",
        help: "Allow /acp spawn to auto-create and bind Discord threads for ACP sessions (default: false; opt-in). Set true to enable thread-bound ACP spawns for this account/channel.",
      },
      "ui.components.accentColor": {
        label: "Discord Component Accent Color",
        help: "Accent color for Discord component containers (hex). Set per account via channels.discord.accounts.<id>.ui.components.accentColor.",
      },
      "intents.presence": {
        label: "Discord Presence Intent",
        help: "Enable the Guild Presences privileged intent. Must also be enabled in the Discord Developer Portal. Allows tracking user activities (e.g. Spotify). Default: false.",
      },
      "intents.guildMembers": {
        label: "Discord Guild Members Intent",
        help: "Enable the Guild Members privileged intent. Must also be enabled in the Discord Developer Portal. Default: false.",
      },
      "voice.enabled": {
        label: "Discord Voice Enabled",
        help: "Enable Discord voice channel conversations (default: true). Omit channels.discord.voice to keep voice support disabled for the account.",
      },
      "voice.autoJoin": {
        label: "Discord Voice Auto-Join",
        help: "Voice channels to auto-join on startup (list of guildId/channelId entries).",
      },
      "voice.daveEncryption": {
        label: "Discord Voice DAVE Encryption",
        help: "Toggle DAVE end-to-end encryption for Discord voice joins (default: true in @discordjs/voice; Discord may require this).",
      },
      "voice.decryptionFailureTolerance": {
        label: "Discord Voice Decrypt Failure Tolerance",
        help: "Consecutive decrypt failures before DAVE attempts session recovery (passed to @discordjs/voice; default: 24).",
      },
      "voice.tts": {
        label: "Discord Voice Text-to-Speech",
        help: "Optional TTS overrides for Discord voice playback (merged with messages.tts).",
      },
      "pluralkit.enabled": {
        label: "Discord PluralKit Enabled",
        help: "Resolve PluralKit proxied messages and treat system members as distinct senders.",
      },
      "pluralkit.token": {
        label: "Discord PluralKit Token",
        help: "Optional PluralKit token for resolving private systems or members.",
      },
      activity: {
        label: "Discord Presence Activity",
        help: "Discord presence activity text (defaults to custom status).",
      },
      status: {
        label: "Discord Presence Status",
        help: "Discord presence status (online, dnd, idle, invisible).",
      },
      "autoPresence.enabled": {
        label: "Discord Auto Presence Enabled",
        help: "Enable automatic Discord bot presence updates based on runtime/model availability signals. When enabled: healthy=>online, degraded/unknown=>idle, exhausted/unavailable=>dnd.",
      },
      "autoPresence.intervalMs": {
        label: "Discord Auto Presence Check Interval (ms)",
        help: "How often to evaluate Discord auto-presence state in milliseconds (default: 30000).",
      },
      "autoPresence.minUpdateIntervalMs": {
        label: "Discord Auto Presence Min Update Interval (ms)",
        help: "Minimum time between actual Discord presence update calls in milliseconds (default: 15000). Prevents status spam on noisy state changes.",
      },
      "autoPresence.healthyText": {
        label: "Discord Auto Presence Healthy Text",
        help: "Optional custom status text while runtime is healthy (online). If omitted, falls back to static channels.discord.activity when set.",
      },
      "autoPresence.degradedText": {
        label: "Discord Auto Presence Degraded Text",
        help: "Optional custom status text while runtime/model availability is degraded or unknown (idle).",
      },
      "autoPresence.exhaustedText": {
        label: "Discord Auto Presence Exhausted Text",
        help: "Optional custom status text while runtime detects exhausted/unavailable model quota (dnd). Supports {reason} template placeholder.",
      },
      activityType: {
        label: "Discord Presence Activity Type",
        help: "Discord presence activity type (0=Playing,1=Streaming,2=Listening,3=Watching,4=Custom,5=Competing).",
      },
      activityUrl: {
        label: "Discord Presence Activity URL",
        help: "Discord presence streaming URL (required for activityType=1).",
      },
      allowBots: {
        label: "Discord Allow Bot Messages",
        help: 'Allow bot-authored messages to trigger Discord replies (default: false). Set "mentions" to only accept bot messages that mention the bot.',
      },
      token: {
        label: "Discord Bot Token",
        help: "Discord bot token used for gateway and REST API authentication for this provider account. Keep this secret out of committed config and rotate immediately after any leak.",
      },
    },
  },
  {
    pluginId: "feishu",
    channelId: "feishu",
    label: "Feishu",
    description: "\u98DE\u4E66/Lark enterprise messaging with doc/wiki/drive tools.",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
        },
        defaultAccount: {
          type: "string",
        },
        appId: {
          type: "string",
        },
        appSecret: {
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
              ],
            },
          ],
        },
        encryptKey: {
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
              ],
            },
          ],
        },
        verificationToken: {
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
              ],
            },
          ],
        },
        domain: {
          default: "feishu",
          anyOf: [
            {
              type: "string",
              enum: ["feishu", "lark"],
            },
            {
              type: "string",
              format: "uri",
              pattern: "^https:\\/\\/.*",
            },
          ],
        },
        connectionMode: {
          default: "websocket",
          type: "string",
          enum: ["websocket", "webhook"],
        },
        webhookPath: {
          default: "/feishu/events",
          type: "string",
        },
        webhookHost: {
          type: "string",
        },
        webhookPort: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        capabilities: {
          type: "array",
          items: {
            type: "string",
          },
        },
        markdown: {
          type: "object",
          properties: {
            mode: {
              type: "string",
              enum: ["native", "escape", "strip"],
            },
            tableMode: {
              type: "string",
              enum: ["native", "ascii", "simple"],
            },
          },
          additionalProperties: false,
        },
        configWrites: {
          type: "boolean",
        },
        dmPolicy: {
          default: "pairing",
          type: "string",
          enum: ["open", "pairing", "allowlist"],
        },
        allowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        groupPolicy: {
          default: "allowlist",
          anyOf: [
            {
              type: "string",
              enum: ["open", "allowlist", "disabled"],
            },
            {},
          ],
        },
        groupAllowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        groupSenderAllowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        requireMention: {
          type: "boolean",
        },
        groups: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              requireMention: {
                type: "boolean",
              },
              tools: {
                type: "object",
                properties: {
                  allow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  deny: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },
                additionalProperties: false,
              },
              skills: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              enabled: {
                type: "boolean",
              },
              allowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              systemPrompt: {
                type: "string",
              },
              groupSessionScope: {
                type: "string",
                enum: ["group", "group_sender", "group_topic", "group_topic_sender"],
              },
              topicSessionMode: {
                type: "string",
                enum: ["disabled", "enabled"],
              },
              replyInThread: {
                type: "string",
                enum: ["disabled", "enabled"],
              },
            },
            additionalProperties: false,
          },
        },
        historyLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dmHistoryLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dms: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              enabled: {
                type: "boolean",
              },
              systemPrompt: {
                type: "string",
              },
            },
            additionalProperties: false,
          },
        },
        textChunkLimit: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        chunkMode: {
          type: "string",
          enum: ["length", "newline"],
        },
        blockStreamingCoalesce: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
            minDelayMs: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            maxDelayMs: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
          },
          additionalProperties: false,
        },
        mediaMaxMb: {
          type: "number",
          exclusiveMinimum: 0,
        },
        httpTimeoutMs: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 3e5,
        },
        heartbeat: {
          type: "object",
          properties: {
            visibility: {
              type: "string",
              enum: ["visible", "hidden"],
            },
            intervalMs: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
          },
          additionalProperties: false,
        },
        renderMode: {
          type: "string",
          enum: ["auto", "raw", "card"],
        },
        streaming: {
          type: "boolean",
        },
        tools: {
          type: "object",
          properties: {
            doc: {
              type: "boolean",
            },
            chat: {
              type: "boolean",
            },
            wiki: {
              type: "boolean",
            },
            drive: {
              type: "boolean",
            },
            perm: {
              type: "boolean",
            },
            scopes: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
        actions: {
          type: "object",
          properties: {
            reactions: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
        replyInThread: {
          type: "string",
          enum: ["disabled", "enabled"],
        },
        reactionNotifications: {
          default: "own",
          type: "string",
          enum: ["off", "own", "all"],
        },
        typingIndicator: {
          default: true,
          type: "boolean",
        },
        resolveSenderNames: {
          default: true,
          type: "boolean",
        },
        groupSessionScope: {
          type: "string",
          enum: ["group", "group_sender", "group_topic", "group_topic_sender"],
        },
        topicSessionMode: {
          type: "string",
          enum: ["disabled", "enabled"],
        },
        dynamicAgentCreation: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
            workspaceTemplate: {
              type: "string",
            },
            agentDirTemplate: {
              type: "string",
            },
            maxAgents: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
          },
          additionalProperties: false,
        },
        accounts: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              enabled: {
                type: "boolean",
              },
              name: {
                type: "string",
              },
              appId: {
                type: "string",
              },
              appSecret: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "env",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                            pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "file",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "exec",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                    ],
                  },
                ],
              },
              encryptKey: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "env",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                            pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "file",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "exec",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                    ],
                  },
                ],
              },
              verificationToken: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "env",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                            pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "file",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "exec",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                    ],
                  },
                ],
              },
              domain: {
                anyOf: [
                  {
                    type: "string",
                    enum: ["feishu", "lark"],
                  },
                  {
                    type: "string",
                    format: "uri",
                    pattern: "^https:\\/\\/.*",
                  },
                ],
              },
              connectionMode: {
                type: "string",
                enum: ["websocket", "webhook"],
              },
              webhookPath: {
                type: "string",
              },
              webhookHost: {
                type: "string",
              },
              webhookPort: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              capabilities: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              markdown: {
                type: "object",
                properties: {
                  mode: {
                    type: "string",
                    enum: ["native", "escape", "strip"],
                  },
                  tableMode: {
                    type: "string",
                    enum: ["native", "ascii", "simple"],
                  },
                },
                additionalProperties: false,
              },
              configWrites: {
                type: "boolean",
              },
              dmPolicy: {
                type: "string",
                enum: ["open", "pairing", "allowlist"],
              },
              allowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              groupPolicy: {
                anyOf: [
                  {
                    type: "string",
                    enum: ["open", "allowlist", "disabled"],
                  },
                  {},
                ],
              },
              groupAllowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              groupSenderAllowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              requireMention: {
                type: "boolean",
              },
              groups: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    requireMention: {
                      type: "boolean",
                    },
                    tools: {
                      type: "object",
                      properties: {
                        allow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        deny: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                      },
                      additionalProperties: false,
                    },
                    skills: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    enabled: {
                      type: "boolean",
                    },
                    allowFrom: {
                      type: "array",
                      items: {
                        anyOf: [
                          {
                            type: "string",
                          },
                          {
                            type: "number",
                          },
                        ],
                      },
                    },
                    systemPrompt: {
                      type: "string",
                    },
                    groupSessionScope: {
                      type: "string",
                      enum: ["group", "group_sender", "group_topic", "group_topic_sender"],
                    },
                    topicSessionMode: {
                      type: "string",
                      enum: ["disabled", "enabled"],
                    },
                    replyInThread: {
                      type: "string",
                      enum: ["disabled", "enabled"],
                    },
                  },
                  additionalProperties: false,
                },
              },
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dmHistoryLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dms: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    enabled: {
                      type: "boolean",
                    },
                    systemPrompt: {
                      type: "string",
                    },
                  },
                  additionalProperties: false,
                },
              },
              textChunkLimit: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              chunkMode: {
                type: "string",
                enum: ["length", "newline"],
              },
              blockStreamingCoalesce: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                  minDelayMs: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  maxDelayMs: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                },
                additionalProperties: false,
              },
              mediaMaxMb: {
                type: "number",
                exclusiveMinimum: 0,
              },
              httpTimeoutMs: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 3e5,
              },
              heartbeat: {
                type: "object",
                properties: {
                  visibility: {
                    type: "string",
                    enum: ["visible", "hidden"],
                  },
                  intervalMs: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                },
                additionalProperties: false,
              },
              renderMode: {
                type: "string",
                enum: ["auto", "raw", "card"],
              },
              streaming: {
                type: "boolean",
              },
              tools: {
                type: "object",
                properties: {
                  doc: {
                    type: "boolean",
                  },
                  chat: {
                    type: "boolean",
                  },
                  wiki: {
                    type: "boolean",
                  },
                  drive: {
                    type: "boolean",
                  },
                  perm: {
                    type: "boolean",
                  },
                  scopes: {
                    type: "boolean",
                  },
                },
                additionalProperties: false,
              },
              actions: {
                type: "object",
                properties: {
                  reactions: {
                    type: "boolean",
                  },
                },
                additionalProperties: false,
              },
              replyInThread: {
                type: "string",
                enum: ["disabled", "enabled"],
              },
              reactionNotifications: {
                type: "string",
                enum: ["off", "own", "all"],
              },
              typingIndicator: {
                type: "boolean",
              },
              resolveSenderNames: {
                type: "boolean",
              },
              groupSessionScope: {
                type: "string",
                enum: ["group", "group_sender", "group_topic", "group_topic_sender"],
              },
              topicSessionMode: {
                type: "string",
                enum: ["disabled", "enabled"],
              },
            },
            additionalProperties: false,
          },
        },
      },
      required: [
        "domain",
        "connectionMode",
        "webhookPath",
        "dmPolicy",
        "groupPolicy",
        "reactionNotifications",
        "typingIndicator",
        "resolveSenderNames",
      ],
      additionalProperties: false,
    },
  },
  {
    pluginId: "googlechat",
    channelId: "googlechat",
    label: "Google Chat",
    description: "Google Workspace Chat app with HTTP webhook.",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        name: {
          type: "string",
        },
        capabilities: {
          type: "array",
          items: {
            type: "string",
          },
        },
        enabled: {
          type: "boolean",
        },
        configWrites: {
          type: "boolean",
        },
        allowBots: {
          type: "boolean",
        },
        dangerouslyAllowNameMatching: {
          type: "boolean",
        },
        requireMention: {
          type: "boolean",
        },
        groupPolicy: {
          default: "allowlist",
          type: "string",
          enum: ["open", "disabled", "allowlist"],
        },
        groupAllowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        groups: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              enabled: {
                type: "boolean",
              },
              allow: {
                type: "boolean",
              },
              requireMention: {
                type: "boolean",
              },
              users: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              systemPrompt: {
                type: "string",
              },
            },
            additionalProperties: false,
          },
        },
        defaultTo: {
          type: "string",
        },
        serviceAccount: {
          anyOf: [
            {
              type: "string",
            },
            {
              type: "object",
              propertyNames: {
                type: "string",
              },
              additionalProperties: {},
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
              ],
            },
          ],
        },
        serviceAccountRef: {
          oneOf: [
            {
              type: "object",
              properties: {
                source: {
                  type: "string",
                  const: "env",
                },
                provider: {
                  type: "string",
                  pattern: "^[a-z][a-z0-9_-]{0,63}$",
                },
                id: {
                  type: "string",
                  pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                },
              },
              required: ["source", "provider", "id"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                source: {
                  type: "string",
                  const: "file",
                },
                provider: {
                  type: "string",
                  pattern: "^[a-z][a-z0-9_-]{0,63}$",
                },
                id: {
                  type: "string",
                },
              },
              required: ["source", "provider", "id"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                source: {
                  type: "string",
                  const: "exec",
                },
                provider: {
                  type: "string",
                  pattern: "^[a-z][a-z0-9_-]{0,63}$",
                },
                id: {
                  type: "string",
                },
              },
              required: ["source", "provider", "id"],
              additionalProperties: false,
            },
          ],
        },
        serviceAccountFile: {
          type: "string",
        },
        audienceType: {
          type: "string",
          enum: ["app-url", "project-number"],
        },
        audience: {
          type: "string",
        },
        appPrincipal: {
          type: "string",
        },
        webhookPath: {
          type: "string",
        },
        webhookUrl: {
          type: "string",
        },
        botUser: {
          type: "string",
        },
        historyLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dmHistoryLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dms: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
            },
            additionalProperties: false,
          },
        },
        textChunkLimit: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        chunkMode: {
          type: "string",
          enum: ["length", "newline"],
        },
        blockStreaming: {
          type: "boolean",
        },
        blockStreamingCoalesce: {
          type: "object",
          properties: {
            minChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            maxChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            idleMs: {
              type: "integer",
              minimum: 0,
              maximum: 9007199254740991,
            },
          },
          additionalProperties: false,
        },
        streamMode: {
          default: "replace",
          type: "string",
          enum: ["replace", "status_final", "append"],
        },
        mediaMaxMb: {
          type: "number",
          exclusiveMinimum: 0,
        },
        replyToMode: {
          anyOf: [
            {
              type: "string",
              const: "off",
            },
            {
              type: "string",
              const: "first",
            },
            {
              type: "string",
              const: "all",
            },
          ],
        },
        actions: {
          type: "object",
          properties: {
            reactions: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
        dm: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
            policy: {
              default: "pairing",
              type: "string",
              enum: ["pairing", "allowlist", "open", "disabled"],
            },
            allowFrom: {
              type: "array",
              items: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    type: "number",
                  },
                ],
              },
            },
          },
          required: ["policy"],
          additionalProperties: false,
        },
        healthMonitor: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
        typingIndicator: {
          type: "string",
          enum: ["none", "message", "reaction"],
        },
        responsePrefix: {
          type: "string",
        },
        accounts: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              capabilities: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              enabled: {
                type: "boolean",
              },
              configWrites: {
                type: "boolean",
              },
              allowBots: {
                type: "boolean",
              },
              dangerouslyAllowNameMatching: {
                type: "boolean",
              },
              requireMention: {
                type: "boolean",
              },
              groupPolicy: {
                default: "allowlist",
                type: "string",
                enum: ["open", "disabled", "allowlist"],
              },
              groupAllowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              groups: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    enabled: {
                      type: "boolean",
                    },
                    allow: {
                      type: "boolean",
                    },
                    requireMention: {
                      type: "boolean",
                    },
                    users: {
                      type: "array",
                      items: {
                        anyOf: [
                          {
                            type: "string",
                          },
                          {
                            type: "number",
                          },
                        ],
                      },
                    },
                    systemPrompt: {
                      type: "string",
                    },
                  },
                  additionalProperties: false,
                },
              },
              defaultTo: {
                type: "string",
              },
              serviceAccount: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    type: "object",
                    propertyNames: {
                      type: "string",
                    },
                    additionalProperties: {},
                  },
                  {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "env",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                            pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "file",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "exec",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                    ],
                  },
                ],
              },
              serviceAccountRef: {
                oneOf: [
                  {
                    type: "object",
                    properties: {
                      source: {
                        type: "string",
                        const: "env",
                      },
                      provider: {
                        type: "string",
                        pattern: "^[a-z][a-z0-9_-]{0,63}$",
                      },
                      id: {
                        type: "string",
                        pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                      },
                    },
                    required: ["source", "provider", "id"],
                    additionalProperties: false,
                  },
                  {
                    type: "object",
                    properties: {
                      source: {
                        type: "string",
                        const: "file",
                      },
                      provider: {
                        type: "string",
                        pattern: "^[a-z][a-z0-9_-]{0,63}$",
                      },
                      id: {
                        type: "string",
                      },
                    },
                    required: ["source", "provider", "id"],
                    additionalProperties: false,
                  },
                  {
                    type: "object",
                    properties: {
                      source: {
                        type: "string",
                        const: "exec",
                      },
                      provider: {
                        type: "string",
                        pattern: "^[a-z][a-z0-9_-]{0,63}$",
                      },
                      id: {
                        type: "string",
                      },
                    },
                    required: ["source", "provider", "id"],
                    additionalProperties: false,
                  },
                ],
              },
              serviceAccountFile: {
                type: "string",
              },
              audienceType: {
                type: "string",
                enum: ["app-url", "project-number"],
              },
              audience: {
                type: "string",
              },
              appPrincipal: {
                type: "string",
              },
              webhookPath: {
                type: "string",
              },
              webhookUrl: {
                type: "string",
              },
              botUser: {
                type: "string",
              },
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dmHistoryLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dms: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    historyLimit: {
                      type: "integer",
                      minimum: 0,
                      maximum: 9007199254740991,
                    },
                  },
                  additionalProperties: false,
                },
              },
              textChunkLimit: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              chunkMode: {
                type: "string",
                enum: ["length", "newline"],
              },
              blockStreaming: {
                type: "boolean",
              },
              blockStreamingCoalesce: {
                type: "object",
                properties: {
                  minChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  maxChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  idleMs: {
                    type: "integer",
                    minimum: 0,
                    maximum: 9007199254740991,
                  },
                },
                additionalProperties: false,
              },
              streamMode: {
                default: "replace",
                type: "string",
                enum: ["replace", "status_final", "append"],
              },
              mediaMaxMb: {
                type: "number",
                exclusiveMinimum: 0,
              },
              replyToMode: {
                anyOf: [
                  {
                    type: "string",
                    const: "off",
                  },
                  {
                    type: "string",
                    const: "first",
                  },
                  {
                    type: "string",
                    const: "all",
                  },
                ],
              },
              actions: {
                type: "object",
                properties: {
                  reactions: {
                    type: "boolean",
                  },
                },
                additionalProperties: false,
              },
              dm: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                  policy: {
                    default: "pairing",
                    type: "string",
                    enum: ["pairing", "allowlist", "open", "disabled"],
                  },
                  allowFrom: {
                    type: "array",
                    items: {
                      anyOf: [
                        {
                          type: "string",
                        },
                        {
                          type: "number",
                        },
                      ],
                    },
                  },
                },
                required: ["policy"],
                additionalProperties: false,
              },
              healthMonitor: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                },
                additionalProperties: false,
              },
              typingIndicator: {
                type: "string",
                enum: ["none", "message", "reaction"],
              },
              responsePrefix: {
                type: "string",
              },
            },
            required: ["groupPolicy", "streamMode"],
            additionalProperties: false,
          },
        },
        defaultAccount: {
          type: "string",
        },
      },
      required: ["groupPolicy", "streamMode"],
      additionalProperties: false,
    },
  },
  {
    pluginId: "imessage",
    channelId: "imessage",
    label: "iMessage",
    description: "this is still a work in progress.",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        name: {
          type: "string",
        },
        capabilities: {
          type: "array",
          items: {
            type: "string",
          },
        },
        markdown: {
          type: "object",
          properties: {
            tables: {
              type: "string",
              enum: ["off", "bullets", "code"],
            },
          },
          additionalProperties: false,
        },
        enabled: {
          type: "boolean",
        },
        configWrites: {
          type: "boolean",
        },
        cliPath: {
          type: "string",
        },
        dbPath: {
          type: "string",
        },
        remoteHost: {
          type: "string",
        },
        service: {
          anyOf: [
            {
              type: "string",
              const: "imessage",
            },
            {
              type: "string",
              const: "sms",
            },
            {
              type: "string",
              const: "auto",
            },
          ],
        },
        region: {
          type: "string",
        },
        dmPolicy: {
          default: "pairing",
          type: "string",
          enum: ["pairing", "allowlist", "open", "disabled"],
        },
        allowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        defaultTo: {
          type: "string",
        },
        groupAllowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        groupPolicy: {
          default: "allowlist",
          type: "string",
          enum: ["open", "disabled", "allowlist"],
        },
        historyLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dmHistoryLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dms: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
            },
            additionalProperties: false,
          },
        },
        includeAttachments: {
          type: "boolean",
        },
        attachmentRoots: {
          type: "array",
          items: {
            type: "string",
          },
        },
        remoteAttachmentRoots: {
          type: "array",
          items: {
            type: "string",
          },
        },
        mediaMaxMb: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        textChunkLimit: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        chunkMode: {
          type: "string",
          enum: ["length", "newline"],
        },
        blockStreaming: {
          type: "boolean",
        },
        blockStreamingCoalesce: {
          type: "object",
          properties: {
            minChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            maxChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            idleMs: {
              type: "integer",
              minimum: 0,
              maximum: 9007199254740991,
            },
          },
          additionalProperties: false,
        },
        groups: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              requireMention: {
                type: "boolean",
              },
              tools: {
                type: "object",
                properties: {
                  allow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  alsoAllow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  deny: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },
                additionalProperties: false,
              },
              toolsBySender: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    allow: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    alsoAllow: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    deny: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                  },
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
        },
        heartbeat: {
          type: "object",
          properties: {
            showOk: {
              type: "boolean",
            },
            showAlerts: {
              type: "boolean",
            },
            useIndicator: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
        healthMonitor: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
        responsePrefix: {
          type: "string",
        },
        accounts: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              capabilities: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              markdown: {
                type: "object",
                properties: {
                  tables: {
                    type: "string",
                    enum: ["off", "bullets", "code"],
                  },
                },
                additionalProperties: false,
              },
              enabled: {
                type: "boolean",
              },
              configWrites: {
                type: "boolean",
              },
              cliPath: {
                type: "string",
              },
              dbPath: {
                type: "string",
              },
              remoteHost: {
                type: "string",
              },
              service: {
                anyOf: [
                  {
                    type: "string",
                    const: "imessage",
                  },
                  {
                    type: "string",
                    const: "sms",
                  },
                  {
                    type: "string",
                    const: "auto",
                  },
                ],
              },
              region: {
                type: "string",
              },
              dmPolicy: {
                default: "pairing",
                type: "string",
                enum: ["pairing", "allowlist", "open", "disabled"],
              },
              allowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              defaultTo: {
                type: "string",
              },
              groupAllowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              groupPolicy: {
                default: "allowlist",
                type: "string",
                enum: ["open", "disabled", "allowlist"],
              },
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dmHistoryLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dms: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    historyLimit: {
                      type: "integer",
                      minimum: 0,
                      maximum: 9007199254740991,
                    },
                  },
                  additionalProperties: false,
                },
              },
              includeAttachments: {
                type: "boolean",
              },
              attachmentRoots: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              remoteAttachmentRoots: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              mediaMaxMb: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              textChunkLimit: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              chunkMode: {
                type: "string",
                enum: ["length", "newline"],
              },
              blockStreaming: {
                type: "boolean",
              },
              blockStreamingCoalesce: {
                type: "object",
                properties: {
                  minChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  maxChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  idleMs: {
                    type: "integer",
                    minimum: 0,
                    maximum: 9007199254740991,
                  },
                },
                additionalProperties: false,
              },
              groups: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    requireMention: {
                      type: "boolean",
                    },
                    tools: {
                      type: "object",
                      properties: {
                        allow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        alsoAllow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        deny: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                      },
                      additionalProperties: false,
                    },
                    toolsBySender: {
                      type: "object",
                      propertyNames: {
                        type: "string",
                      },
                      additionalProperties: {
                        type: "object",
                        properties: {
                          allow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          alsoAllow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          deny: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                        },
                        additionalProperties: false,
                      },
                    },
                  },
                  additionalProperties: false,
                },
              },
              heartbeat: {
                type: "object",
                properties: {
                  showOk: {
                    type: "boolean",
                  },
                  showAlerts: {
                    type: "boolean",
                  },
                  useIndicator: {
                    type: "boolean",
                  },
                },
                additionalProperties: false,
              },
              healthMonitor: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                },
                additionalProperties: false,
              },
              responsePrefix: {
                type: "string",
              },
            },
            required: ["dmPolicy", "groupPolicy"],
            additionalProperties: false,
          },
        },
        defaultAccount: {
          type: "string",
        },
      },
      required: ["dmPolicy", "groupPolicy"],
      additionalProperties: false,
    },
    uiHints: {
      "": {
        label: "iMessage",
        help: "iMessage channel provider configuration for CLI integration and DM access policy handling. Use explicit CLI paths when runtime environments have non-standard binary locations.",
      },
      dmPolicy: {
        label: "iMessage DM Policy",
        help: 'Direct message access control ("pairing" recommended). "open" requires channels.imessage.allowFrom=["*"].',
      },
      configWrites: {
        label: "iMessage Config Writes",
        help: "Allow iMessage to write config in response to channel events/commands (default: true).",
      },
      cliPath: {
        label: "iMessage CLI Path",
        help: "Filesystem path to the iMessage bridge CLI binary used for send/receive operations. Set explicitly when the binary is not on PATH in service runtime environments.",
      },
    },
  },
  {
    pluginId: "irc",
    channelId: "irc",
    label: "IRC",
    description: "classic IRC networks with DM/channel routing and pairing controls.",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        name: {
          type: "string",
        },
        enabled: {
          type: "boolean",
        },
        dangerouslyAllowNameMatching: {
          type: "boolean",
        },
        host: {
          type: "string",
        },
        port: {
          type: "integer",
          minimum: 1,
          maximum: 65535,
        },
        tls: {
          type: "boolean",
        },
        nick: {
          type: "string",
        },
        username: {
          type: "string",
        },
        realname: {
          type: "string",
        },
        password: {
          type: "string",
        },
        passwordFile: {
          type: "string",
        },
        nickserv: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
            service: {
              type: "string",
            },
            password: {
              type: "string",
            },
            passwordFile: {
              type: "string",
            },
            register: {
              type: "boolean",
            },
            registerEmail: {
              type: "string",
            },
          },
          additionalProperties: false,
        },
        dmPolicy: {
          default: "pairing",
          type: "string",
          enum: ["pairing", "allowlist", "open", "disabled"],
        },
        allowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        groupPolicy: {
          default: "allowlist",
          type: "string",
          enum: ["open", "disabled", "allowlist"],
        },
        groupAllowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        groups: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              requireMention: {
                type: "boolean",
              },
              tools: {
                type: "object",
                properties: {
                  allow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  alsoAllow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  deny: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },
                additionalProperties: false,
              },
              toolsBySender: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    allow: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    alsoAllow: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    deny: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                  },
                  additionalProperties: false,
                },
              },
              skills: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              enabled: {
                type: "boolean",
              },
              allowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              systemPrompt: {
                type: "string",
              },
            },
            additionalProperties: false,
          },
        },
        channels: {
          type: "array",
          items: {
            type: "string",
          },
        },
        mentionPatterns: {
          type: "array",
          items: {
            type: "string",
          },
        },
        markdown: {
          type: "object",
          properties: {
            tables: {
              type: "string",
              enum: ["off", "bullets", "code"],
            },
          },
          additionalProperties: false,
        },
        historyLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dmHistoryLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dms: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
            },
            additionalProperties: false,
          },
        },
        textChunkLimit: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        chunkMode: {
          type: "string",
          enum: ["length", "newline"],
        },
        blockStreaming: {
          type: "boolean",
        },
        blockStreamingCoalesce: {
          type: "object",
          properties: {
            minChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            maxChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            idleMs: {
              type: "integer",
              minimum: 0,
              maximum: 9007199254740991,
            },
          },
          additionalProperties: false,
        },
        responsePrefix: {
          type: "string",
        },
        mediaMaxMb: {
          type: "number",
          exclusiveMinimum: 0,
        },
        accounts: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              enabled: {
                type: "boolean",
              },
              dangerouslyAllowNameMatching: {
                type: "boolean",
              },
              host: {
                type: "string",
              },
              port: {
                type: "integer",
                minimum: 1,
                maximum: 65535,
              },
              tls: {
                type: "boolean",
              },
              nick: {
                type: "string",
              },
              username: {
                type: "string",
              },
              realname: {
                type: "string",
              },
              password: {
                type: "string",
              },
              passwordFile: {
                type: "string",
              },
              nickserv: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                  service: {
                    type: "string",
                  },
                  password: {
                    type: "string",
                  },
                  passwordFile: {
                    type: "string",
                  },
                  register: {
                    type: "boolean",
                  },
                  registerEmail: {
                    type: "string",
                  },
                },
                additionalProperties: false,
              },
              dmPolicy: {
                default: "pairing",
                type: "string",
                enum: ["pairing", "allowlist", "open", "disabled"],
              },
              allowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              groupPolicy: {
                default: "allowlist",
                type: "string",
                enum: ["open", "disabled", "allowlist"],
              },
              groupAllowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              groups: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    requireMention: {
                      type: "boolean",
                    },
                    tools: {
                      type: "object",
                      properties: {
                        allow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        alsoAllow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        deny: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                      },
                      additionalProperties: false,
                    },
                    toolsBySender: {
                      type: "object",
                      propertyNames: {
                        type: "string",
                      },
                      additionalProperties: {
                        type: "object",
                        properties: {
                          allow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          alsoAllow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          deny: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                        },
                        additionalProperties: false,
                      },
                    },
                    skills: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    enabled: {
                      type: "boolean",
                    },
                    allowFrom: {
                      type: "array",
                      items: {
                        anyOf: [
                          {
                            type: "string",
                          },
                          {
                            type: "number",
                          },
                        ],
                      },
                    },
                    systemPrompt: {
                      type: "string",
                    },
                  },
                  additionalProperties: false,
                },
              },
              channels: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              mentionPatterns: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              markdown: {
                type: "object",
                properties: {
                  tables: {
                    type: "string",
                    enum: ["off", "bullets", "code"],
                  },
                },
                additionalProperties: false,
              },
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dmHistoryLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dms: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    historyLimit: {
                      type: "integer",
                      minimum: 0,
                      maximum: 9007199254740991,
                    },
                  },
                  additionalProperties: false,
                },
              },
              textChunkLimit: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              chunkMode: {
                type: "string",
                enum: ["length", "newline"],
              },
              blockStreaming: {
                type: "boolean",
              },
              blockStreamingCoalesce: {
                type: "object",
                properties: {
                  minChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  maxChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  idleMs: {
                    type: "integer",
                    minimum: 0,
                    maximum: 9007199254740991,
                  },
                },
                additionalProperties: false,
              },
              responsePrefix: {
                type: "string",
              },
              mediaMaxMb: {
                type: "number",
                exclusiveMinimum: 0,
              },
            },
            required: ["dmPolicy", "groupPolicy"],
            additionalProperties: false,
          },
        },
        defaultAccount: {
          type: "string",
        },
      },
      required: ["dmPolicy", "groupPolicy"],
      additionalProperties: false,
    },
    uiHints: {
      "": {
        label: "IRC",
        help: "IRC channel provider configuration and compatibility settings for classic IRC transport workflows. Use this section when bridging legacy chat infrastructure into OpenClaw.",
      },
      dmPolicy: {
        label: "IRC DM Policy",
        help: 'Direct message access control ("pairing" recommended). "open" requires channels.irc.allowFrom=["*"].',
      },
      "nickserv.enabled": {
        label: "IRC NickServ Enabled",
        help: "Enable NickServ identify/register after connect (defaults to enabled when password is configured).",
      },
      "nickserv.service": {
        label: "IRC NickServ Service",
        help: "NickServ service nick (default: NickServ).",
      },
      "nickserv.password": {
        label: "IRC NickServ Password",
        help: "NickServ password used for IDENTIFY/REGISTER (sensitive).",
      },
      "nickserv.passwordFile": {
        label: "IRC NickServ Password File",
        help: "Optional file path containing NickServ password.",
      },
      "nickserv.register": {
        label: "IRC NickServ Register",
        help: "If true, send NickServ REGISTER on every connect. Use once for initial registration, then disable.",
      },
      "nickserv.registerEmail": {
        label: "IRC NickServ Register Email",
        help: "Email used with NickServ REGISTER (required when register=true).",
      },
      configWrites: {
        label: "IRC Config Writes",
        help: "Allow IRC to write config in response to channel events/commands (default: true).",
      },
    },
  },
  {
    pluginId: "line",
    channelId: "line",
    label: "LINE",
    description: "LINE Messaging API webhook bot.",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
        },
        channelAccessToken: {
          type: "string",
        },
        channelSecret: {
          type: "string",
        },
        tokenFile: {
          type: "string",
        },
        secretFile: {
          type: "string",
        },
        name: {
          type: "string",
        },
        allowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        groupAllowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        dmPolicy: {
          default: "pairing",
          type: "string",
          enum: ["open", "allowlist", "pairing", "disabled"],
        },
        groupPolicy: {
          default: "allowlist",
          type: "string",
          enum: ["open", "allowlist", "disabled"],
        },
        responsePrefix: {
          type: "string",
        },
        mediaMaxMb: {
          type: "number",
        },
        webhookPath: {
          type: "string",
        },
        threadBindings: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
            idleHours: {
              type: "number",
            },
            maxAgeHours: {
              type: "number",
            },
            spawnSubagentSessions: {
              type: "boolean",
            },
            spawnAcpSessions: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
        accounts: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              enabled: {
                type: "boolean",
              },
              channelAccessToken: {
                type: "string",
              },
              channelSecret: {
                type: "string",
              },
              tokenFile: {
                type: "string",
              },
              secretFile: {
                type: "string",
              },
              name: {
                type: "string",
              },
              allowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              groupAllowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              dmPolicy: {
                default: "pairing",
                type: "string",
                enum: ["open", "allowlist", "pairing", "disabled"],
              },
              groupPolicy: {
                default: "allowlist",
                type: "string",
                enum: ["open", "allowlist", "disabled"],
              },
              responsePrefix: {
                type: "string",
              },
              mediaMaxMb: {
                type: "number",
              },
              webhookPath: {
                type: "string",
              },
              threadBindings: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                  idleHours: {
                    type: "number",
                  },
                  maxAgeHours: {
                    type: "number",
                  },
                  spawnSubagentSessions: {
                    type: "boolean",
                  },
                  spawnAcpSessions: {
                    type: "boolean",
                  },
                },
                additionalProperties: false,
              },
              groups: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    enabled: {
                      type: "boolean",
                    },
                    allowFrom: {
                      type: "array",
                      items: {
                        anyOf: [
                          {
                            type: "string",
                          },
                          {
                            type: "number",
                          },
                        ],
                      },
                    },
                    requireMention: {
                      type: "boolean",
                    },
                    systemPrompt: {
                      type: "string",
                    },
                    skills: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                  },
                  additionalProperties: false,
                },
              },
            },
            required: ["dmPolicy", "groupPolicy"],
            additionalProperties: false,
          },
        },
        defaultAccount: {
          type: "string",
        },
        groups: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              enabled: {
                type: "boolean",
              },
              allowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              requireMention: {
                type: "boolean",
              },
              systemPrompt: {
                type: "string",
              },
              skills: {
                type: "array",
                items: {
                  type: "string",
                },
              },
            },
            additionalProperties: false,
          },
        },
      },
      required: ["dmPolicy", "groupPolicy"],
      additionalProperties: false,
    },
  },
  {
    pluginId: "matrix",
    channelId: "matrix",
    label: "Matrix",
    description: "open protocol; install the plugin to enable.",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        name: {
          type: "string",
        },
        enabled: {
          type: "boolean",
        },
        defaultAccount: {
          type: "string",
        },
        accounts: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {},
        },
        markdown: {
          type: "object",
          properties: {
            tables: {
              type: "string",
              enum: ["off", "bullets", "code"],
            },
          },
          additionalProperties: false,
        },
        homeserver: {
          type: "string",
        },
        allowPrivateNetwork: {
          type: "boolean",
        },
        userId: {
          type: "string",
        },
        accessToken: {
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
              ],
            },
          ],
        },
        password: {
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
              ],
            },
          ],
        },
        deviceId: {
          type: "string",
        },
        deviceName: {
          type: "string",
        },
        avatarUrl: {
          type: "string",
        },
        initialSyncLimit: {
          type: "number",
        },
        encryption: {
          type: "boolean",
        },
        allowlistOnly: {
          type: "boolean",
        },
        allowBots: {
          anyOf: [
            {
              type: "boolean",
            },
            {
              type: "string",
              const: "mentions",
            },
          ],
        },
        groupPolicy: {
          type: "string",
          enum: ["open", "disabled", "allowlist"],
        },
        streaming: {
          anyOf: [
            {
              type: "string",
              enum: ["partial", "off"],
            },
            {
              type: "boolean",
            },
          ],
        },
        replyToMode: {
          type: "string",
          enum: ["off", "first", "all"],
        },
        threadReplies: {
          type: "string",
          enum: ["off", "inbound", "always"],
        },
        textChunkLimit: {
          type: "number",
        },
        chunkMode: {
          type: "string",
          enum: ["length", "newline"],
        },
        responsePrefix: {
          type: "string",
        },
        ackReaction: {
          type: "string",
        },
        ackReactionScope: {
          type: "string",
          enum: ["group-mentions", "group-all", "direct", "all", "none", "off"],
        },
        reactionNotifications: {
          type: "string",
          enum: ["off", "own"],
        },
        threadBindings: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
            idleHours: {
              type: "number",
              minimum: 0,
            },
            maxAgeHours: {
              type: "number",
              minimum: 0,
            },
            spawnSubagentSessions: {
              type: "boolean",
            },
            spawnAcpSessions: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
        startupVerification: {
          type: "string",
          enum: ["off", "if-unverified"],
        },
        startupVerificationCooldownHours: {
          type: "number",
        },
        mediaMaxMb: {
          type: "number",
        },
        historyLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        autoJoin: {
          type: "string",
          enum: ["always", "allowlist", "off"],
        },
        autoJoinAllowlist: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        groupAllowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        dm: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
            policy: {
              type: "string",
              enum: ["pairing", "allowlist", "open", "disabled"],
            },
            allowFrom: {
              type: "array",
              items: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    type: "number",
                  },
                ],
              },
            },
          },
          additionalProperties: false,
        },
        groups: {
          type: "object",
          properties: {},
          additionalProperties: {
            type: "object",
            properties: {
              enabled: {
                type: "boolean",
              },
              allow: {
                type: "boolean",
              },
              requireMention: {
                type: "boolean",
              },
              allowBots: {
                anyOf: [
                  {
                    type: "boolean",
                  },
                  {
                    type: "string",
                    const: "mentions",
                  },
                ],
              },
              tools: {
                type: "object",
                properties: {
                  allow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  alsoAllow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  deny: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },
                additionalProperties: false,
              },
              autoReply: {
                type: "boolean",
              },
              users: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              skills: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              systemPrompt: {
                type: "string",
              },
            },
            additionalProperties: false,
          },
        },
        rooms: {
          type: "object",
          properties: {},
          additionalProperties: {
            type: "object",
            properties: {
              enabled: {
                type: "boolean",
              },
              allow: {
                type: "boolean",
              },
              requireMention: {
                type: "boolean",
              },
              allowBots: {
                anyOf: [
                  {
                    type: "boolean",
                  },
                  {
                    type: "string",
                    const: "mentions",
                  },
                ],
              },
              tools: {
                type: "object",
                properties: {
                  allow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  alsoAllow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  deny: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },
                additionalProperties: false,
              },
              autoReply: {
                type: "boolean",
              },
              users: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              skills: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              systemPrompt: {
                type: "string",
              },
            },
            additionalProperties: false,
          },
        },
        actions: {
          type: "object",
          properties: {
            reactions: {
              type: "boolean",
            },
            messages: {
              type: "boolean",
            },
            pins: {
              type: "boolean",
            },
            profile: {
              type: "boolean",
            },
            memberInfo: {
              type: "boolean",
            },
            channelInfo: {
              type: "boolean",
            },
            verification: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    pluginId: "mattermost",
    channelId: "mattermost",
    label: "Mattermost",
    description: "self-hosted Slack-style chat; install the plugin to enable.",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        name: {
          type: "string",
        },
        capabilities: {
          type: "array",
          items: {
            type: "string",
          },
        },
        dangerouslyAllowNameMatching: {
          type: "boolean",
        },
        markdown: {
          type: "object",
          properties: {
            tables: {
              type: "string",
              enum: ["off", "bullets", "code"],
            },
          },
          additionalProperties: false,
        },
        enabled: {
          type: "boolean",
        },
        configWrites: {
          type: "boolean",
        },
        botToken: {
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
              ],
            },
          ],
        },
        baseUrl: {
          type: "string",
        },
        chatmode: {
          type: "string",
          enum: ["oncall", "onmessage", "onchar"],
        },
        oncharPrefixes: {
          type: "array",
          items: {
            type: "string",
          },
        },
        requireMention: {
          type: "boolean",
        },
        dmPolicy: {
          default: "pairing",
          type: "string",
          enum: ["pairing", "allowlist", "open", "disabled"],
        },
        allowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        groupAllowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        groupPolicy: {
          default: "allowlist",
          type: "string",
          enum: ["open", "disabled", "allowlist"],
        },
        textChunkLimit: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        chunkMode: {
          type: "string",
          enum: ["length", "newline"],
        },
        blockStreaming: {
          type: "boolean",
        },
        blockStreamingCoalesce: {
          type: "object",
          properties: {
            minChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            maxChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            idleMs: {
              type: "integer",
              minimum: 0,
              maximum: 9007199254740991,
            },
          },
          additionalProperties: false,
        },
        replyToMode: {
          type: "string",
          enum: ["off", "first", "all"],
        },
        responsePrefix: {
          type: "string",
        },
        actions: {
          type: "object",
          properties: {
            reactions: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
        commands: {
          type: "object",
          properties: {
            native: {
              anyOf: [
                {
                  type: "boolean",
                },
                {
                  type: "string",
                  const: "auto",
                },
              ],
            },
            nativeSkills: {
              anyOf: [
                {
                  type: "boolean",
                },
                {
                  type: "string",
                  const: "auto",
                },
              ],
            },
            callbackPath: {
              type: "string",
            },
            callbackUrl: {
              type: "string",
            },
          },
          additionalProperties: false,
        },
        interactions: {
          type: "object",
          properties: {
            callbackBaseUrl: {
              type: "string",
            },
            allowedSourceIps: {
              type: "array",
              items: {
                type: "string",
              },
            },
          },
          additionalProperties: false,
        },
        allowPrivateNetwork: {
          type: "boolean",
        },
        dmChannelRetry: {
          type: "object",
          properties: {
            maxRetries: {
              type: "integer",
              minimum: 0,
              maximum: 10,
            },
            initialDelayMs: {
              type: "integer",
              minimum: 100,
              maximum: 6e4,
            },
            maxDelayMs: {
              type: "integer",
              minimum: 1e3,
              maximum: 6e4,
            },
            timeoutMs: {
              type: "integer",
              minimum: 5e3,
              maximum: 12e4,
            },
          },
          additionalProperties: false,
        },
        accounts: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              capabilities: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              dangerouslyAllowNameMatching: {
                type: "boolean",
              },
              markdown: {
                type: "object",
                properties: {
                  tables: {
                    type: "string",
                    enum: ["off", "bullets", "code"],
                  },
                },
                additionalProperties: false,
              },
              enabled: {
                type: "boolean",
              },
              configWrites: {
                type: "boolean",
              },
              botToken: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "env",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                            pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "file",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "exec",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                    ],
                  },
                ],
              },
              baseUrl: {
                type: "string",
              },
              chatmode: {
                type: "string",
                enum: ["oncall", "onmessage", "onchar"],
              },
              oncharPrefixes: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              requireMention: {
                type: "boolean",
              },
              dmPolicy: {
                default: "pairing",
                type: "string",
                enum: ["pairing", "allowlist", "open", "disabled"],
              },
              allowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              groupAllowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              groupPolicy: {
                default: "allowlist",
                type: "string",
                enum: ["open", "disabled", "allowlist"],
              },
              textChunkLimit: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              chunkMode: {
                type: "string",
                enum: ["length", "newline"],
              },
              blockStreaming: {
                type: "boolean",
              },
              blockStreamingCoalesce: {
                type: "object",
                properties: {
                  minChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  maxChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  idleMs: {
                    type: "integer",
                    minimum: 0,
                    maximum: 9007199254740991,
                  },
                },
                additionalProperties: false,
              },
              replyToMode: {
                type: "string",
                enum: ["off", "first", "all"],
              },
              responsePrefix: {
                type: "string",
              },
              actions: {
                type: "object",
                properties: {
                  reactions: {
                    type: "boolean",
                  },
                },
                additionalProperties: false,
              },
              commands: {
                type: "object",
                properties: {
                  native: {
                    anyOf: [
                      {
                        type: "boolean",
                      },
                      {
                        type: "string",
                        const: "auto",
                      },
                    ],
                  },
                  nativeSkills: {
                    anyOf: [
                      {
                        type: "boolean",
                      },
                      {
                        type: "string",
                        const: "auto",
                      },
                    ],
                  },
                  callbackPath: {
                    type: "string",
                  },
                  callbackUrl: {
                    type: "string",
                  },
                },
                additionalProperties: false,
              },
              interactions: {
                type: "object",
                properties: {
                  callbackBaseUrl: {
                    type: "string",
                  },
                  allowedSourceIps: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },
                additionalProperties: false,
              },
              allowPrivateNetwork: {
                type: "boolean",
              },
              dmChannelRetry: {
                type: "object",
                properties: {
                  maxRetries: {
                    type: "integer",
                    minimum: 0,
                    maximum: 10,
                  },
                  initialDelayMs: {
                    type: "integer",
                    minimum: 100,
                    maximum: 6e4,
                  },
                  maxDelayMs: {
                    type: "integer",
                    minimum: 1e3,
                    maximum: 6e4,
                  },
                  timeoutMs: {
                    type: "integer",
                    minimum: 5e3,
                    maximum: 12e4,
                  },
                },
                additionalProperties: false,
              },
            },
            required: ["dmPolicy", "groupPolicy"],
            additionalProperties: false,
          },
        },
        defaultAccount: {
          type: "string",
        },
      },
      required: ["dmPolicy", "groupPolicy"],
      additionalProperties: false,
    },
  },
  {
    pluginId: "msteams",
    channelId: "msteams",
    label: "Microsoft Teams",
    description: "Teams SDK; enterprise support.",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
        },
        capabilities: {
          type: "array",
          items: {
            type: "string",
          },
        },
        dangerouslyAllowNameMatching: {
          type: "boolean",
        },
        markdown: {
          type: "object",
          properties: {
            tables: {
              type: "string",
              enum: ["off", "bullets", "code"],
            },
          },
          additionalProperties: false,
        },
        configWrites: {
          type: "boolean",
        },
        appId: {
          type: "string",
        },
        appPassword: {
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
              ],
            },
          ],
        },
        tenantId: {
          type: "string",
        },
        webhook: {
          type: "object",
          properties: {
            port: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            path: {
              type: "string",
            },
          },
          additionalProperties: false,
        },
        dmPolicy: {
          default: "pairing",
          type: "string",
          enum: ["pairing", "allowlist", "open", "disabled"],
        },
        allowFrom: {
          type: "array",
          items: {
            type: "string",
          },
        },
        defaultTo: {
          type: "string",
        },
        groupAllowFrom: {
          type: "array",
          items: {
            type: "string",
          },
        },
        groupPolicy: {
          default: "allowlist",
          type: "string",
          enum: ["open", "disabled", "allowlist"],
        },
        textChunkLimit: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        chunkMode: {
          type: "string",
          enum: ["length", "newline"],
        },
        blockStreaming: {
          type: "boolean",
        },
        blockStreamingCoalesce: {
          type: "object",
          properties: {
            minChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            maxChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            idleMs: {
              type: "integer",
              minimum: 0,
              maximum: 9007199254740991,
            },
          },
          additionalProperties: false,
        },
        mediaAllowHosts: {
          type: "array",
          items: {
            type: "string",
          },
        },
        mediaAuthAllowHosts: {
          type: "array",
          items: {
            type: "string",
          },
        },
        requireMention: {
          type: "boolean",
        },
        historyLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dmHistoryLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dms: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
            },
            additionalProperties: false,
          },
        },
        replyStyle: {
          type: "string",
          enum: ["thread", "top-level"],
        },
        teams: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              requireMention: {
                type: "boolean",
              },
              tools: {
                type: "object",
                properties: {
                  allow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  alsoAllow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  deny: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },
                additionalProperties: false,
              },
              toolsBySender: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    allow: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    alsoAllow: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    deny: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                  },
                  additionalProperties: false,
                },
              },
              replyStyle: {
                type: "string",
                enum: ["thread", "top-level"],
              },
              channels: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    requireMention: {
                      type: "boolean",
                    },
                    tools: {
                      type: "object",
                      properties: {
                        allow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        alsoAllow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        deny: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                      },
                      additionalProperties: false,
                    },
                    toolsBySender: {
                      type: "object",
                      propertyNames: {
                        type: "string",
                      },
                      additionalProperties: {
                        type: "object",
                        properties: {
                          allow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          alsoAllow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          deny: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                        },
                        additionalProperties: false,
                      },
                    },
                    replyStyle: {
                      type: "string",
                      enum: ["thread", "top-level"],
                    },
                  },
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
        },
        mediaMaxMb: {
          type: "number",
          exclusiveMinimum: 0,
        },
        sharePointSiteId: {
          type: "string",
        },
        heartbeat: {
          type: "object",
          properties: {
            showOk: {
              type: "boolean",
            },
            showAlerts: {
              type: "boolean",
            },
            useIndicator: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
        healthMonitor: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
        responsePrefix: {
          type: "string",
        },
        welcomeCard: {
          type: "boolean",
        },
        promptStarters: {
          type: "array",
          items: {
            type: "string",
          },
        },
        groupWelcomeCard: {
          type: "boolean",
        },
        feedbackEnabled: {
          type: "boolean",
        },
        feedbackReflection: {
          type: "boolean",
        },
        feedbackReflectionCooldownMs: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
      },
      required: ["dmPolicy", "groupPolicy"],
      additionalProperties: false,
    },
    uiHints: {
      "": {
        label: "MS Teams",
        help: "Microsoft Teams channel provider configuration and provider-specific policy toggles. Use this section to isolate Teams behavior from other enterprise chat providers.",
      },
      configWrites: {
        label: "MS Teams Config Writes",
        help: "Allow Microsoft Teams to write config in response to channel events/commands (default: true).",
      },
    },
  },
  {
    pluginId: "nextcloud-talk",
    channelId: "nextcloud-talk",
    label: "Nextcloud Talk",
    description: "Self-hosted chat via Nextcloud Talk webhook bots.",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        name: {
          type: "string",
        },
        enabled: {
          type: "boolean",
        },
        markdown: {
          type: "object",
          properties: {
            tables: {
              type: "string",
              enum: ["off", "bullets", "code"],
            },
          },
          additionalProperties: false,
        },
        baseUrl: {
          type: "string",
        },
        botSecret: {
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
              ],
            },
          ],
        },
        botSecretFile: {
          type: "string",
        },
        apiUser: {
          type: "string",
        },
        apiPassword: {
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
              ],
            },
          ],
        },
        apiPasswordFile: {
          type: "string",
        },
        dmPolicy: {
          default: "pairing",
          type: "string",
          enum: ["pairing", "allowlist", "open", "disabled"],
        },
        webhookPort: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        webhookHost: {
          type: "string",
        },
        webhookPath: {
          type: "string",
        },
        webhookPublicUrl: {
          type: "string",
        },
        allowFrom: {
          type: "array",
          items: {
            type: "string",
          },
        },
        groupAllowFrom: {
          type: "array",
          items: {
            type: "string",
          },
        },
        groupPolicy: {
          default: "allowlist",
          type: "string",
          enum: ["open", "disabled", "allowlist"],
        },
        rooms: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              requireMention: {
                type: "boolean",
              },
              tools: {
                type: "object",
                properties: {
                  allow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  alsoAllow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  deny: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },
                additionalProperties: false,
              },
              skills: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              enabled: {
                type: "boolean",
              },
              allowFrom: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              systemPrompt: {
                type: "string",
              },
            },
            additionalProperties: false,
          },
        },
        allowPrivateNetwork: {
          type: "boolean",
        },
        historyLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dmHistoryLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dms: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
            },
            additionalProperties: false,
          },
        },
        textChunkLimit: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        chunkMode: {
          type: "string",
          enum: ["length", "newline"],
        },
        blockStreaming: {
          type: "boolean",
        },
        blockStreamingCoalesce: {
          type: "object",
          properties: {
            minChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            maxChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            idleMs: {
              type: "integer",
              minimum: 0,
              maximum: 9007199254740991,
            },
          },
          additionalProperties: false,
        },
        responsePrefix: {
          type: "string",
        },
        mediaMaxMb: {
          type: "number",
          exclusiveMinimum: 0,
        },
        accounts: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              enabled: {
                type: "boolean",
              },
              markdown: {
                type: "object",
                properties: {
                  tables: {
                    type: "string",
                    enum: ["off", "bullets", "code"],
                  },
                },
                additionalProperties: false,
              },
              baseUrl: {
                type: "string",
              },
              botSecret: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "env",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                            pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "file",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "exec",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                    ],
                  },
                ],
              },
              botSecretFile: {
                type: "string",
              },
              apiUser: {
                type: "string",
              },
              apiPassword: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "env",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                            pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "file",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "exec",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                    ],
                  },
                ],
              },
              apiPasswordFile: {
                type: "string",
              },
              dmPolicy: {
                default: "pairing",
                type: "string",
                enum: ["pairing", "allowlist", "open", "disabled"],
              },
              webhookPort: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              webhookHost: {
                type: "string",
              },
              webhookPath: {
                type: "string",
              },
              webhookPublicUrl: {
                type: "string",
              },
              allowFrom: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              groupAllowFrom: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              groupPolicy: {
                default: "allowlist",
                type: "string",
                enum: ["open", "disabled", "allowlist"],
              },
              rooms: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    requireMention: {
                      type: "boolean",
                    },
                    tools: {
                      type: "object",
                      properties: {
                        allow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        alsoAllow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        deny: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                      },
                      additionalProperties: false,
                    },
                    skills: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    enabled: {
                      type: "boolean",
                    },
                    allowFrom: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    systemPrompt: {
                      type: "string",
                    },
                  },
                  additionalProperties: false,
                },
              },
              allowPrivateNetwork: {
                type: "boolean",
              },
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dmHistoryLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dms: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    historyLimit: {
                      type: "integer",
                      minimum: 0,
                      maximum: 9007199254740991,
                    },
                  },
                  additionalProperties: false,
                },
              },
              textChunkLimit: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              chunkMode: {
                type: "string",
                enum: ["length", "newline"],
              },
              blockStreaming: {
                type: "boolean",
              },
              blockStreamingCoalesce: {
                type: "object",
                properties: {
                  minChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  maxChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  idleMs: {
                    type: "integer",
                    minimum: 0,
                    maximum: 9007199254740991,
                  },
                },
                additionalProperties: false,
              },
              responsePrefix: {
                type: "string",
              },
              mediaMaxMb: {
                type: "number",
                exclusiveMinimum: 0,
              },
            },
            required: ["dmPolicy", "groupPolicy"],
            additionalProperties: false,
          },
        },
        defaultAccount: {
          type: "string",
        },
      },
      required: ["dmPolicy", "groupPolicy"],
      additionalProperties: false,
    },
  },
  {
    pluginId: "nostr",
    channelId: "nostr",
    label: "Nostr",
    description: "Decentralized protocol; encrypted DMs via NIP-04.",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        name: {
          type: "string",
        },
        defaultAccount: {
          type: "string",
        },
        enabled: {
          type: "boolean",
        },
        markdown: {
          type: "object",
          properties: {
            tables: {
              type: "string",
              enum: ["off", "bullets", "code"],
            },
          },
          additionalProperties: false,
        },
        privateKey: {
          type: "string",
        },
        relays: {
          type: "array",
          items: {
            type: "string",
          },
        },
        dmPolicy: {
          type: "string",
          enum: ["pairing", "allowlist", "open", "disabled"],
        },
        allowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        profile: {
          type: "object",
          properties: {
            name: {
              type: "string",
              maxLength: 256,
            },
            displayName: {
              type: "string",
              maxLength: 256,
            },
            about: {
              type: "string",
              maxLength: 2e3,
            },
            picture: {
              type: "string",
              format: "uri",
            },
            banner: {
              type: "string",
              format: "uri",
            },
            website: {
              type: "string",
              format: "uri",
            },
            nip05: {
              type: "string",
            },
            lud16: {
              type: "string",
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    pluginId: "signal",
    channelId: "signal",
    label: "Signal",
    description: 'signal-cli linked device; more setup (David Reagans: "Hop on Discord.").',
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        name: {
          type: "string",
        },
        capabilities: {
          type: "array",
          items: {
            type: "string",
          },
        },
        markdown: {
          type: "object",
          properties: {
            tables: {
              type: "string",
              enum: ["off", "bullets", "code"],
            },
          },
          additionalProperties: false,
        },
        enabled: {
          type: "boolean",
        },
        configWrites: {
          type: "boolean",
        },
        account: {
          type: "string",
        },
        accountUuid: {
          type: "string",
        },
        httpUrl: {
          type: "string",
        },
        httpHost: {
          type: "string",
        },
        httpPort: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        cliPath: {
          type: "string",
        },
        autoStart: {
          type: "boolean",
        },
        startupTimeoutMs: {
          type: "integer",
          minimum: 1e3,
          maximum: 12e4,
        },
        receiveMode: {
          anyOf: [
            {
              type: "string",
              const: "on-start",
            },
            {
              type: "string",
              const: "manual",
            },
          ],
        },
        ignoreAttachments: {
          type: "boolean",
        },
        ignoreStories: {
          type: "boolean",
        },
        sendReadReceipts: {
          type: "boolean",
        },
        dmPolicy: {
          default: "pairing",
          type: "string",
          enum: ["pairing", "allowlist", "open", "disabled"],
        },
        allowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        defaultTo: {
          type: "string",
        },
        groupAllowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        groupPolicy: {
          default: "allowlist",
          type: "string",
          enum: ["open", "disabled", "allowlist"],
        },
        groups: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              requireMention: {
                type: "boolean",
              },
              tools: {
                type: "object",
                properties: {
                  allow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  alsoAllow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  deny: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },
                additionalProperties: false,
              },
              toolsBySender: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    allow: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    alsoAllow: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    deny: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                  },
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
        },
        historyLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dmHistoryLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dms: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
            },
            additionalProperties: false,
          },
        },
        textChunkLimit: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        chunkMode: {
          type: "string",
          enum: ["length", "newline"],
        },
        blockStreaming: {
          type: "boolean",
        },
        blockStreamingCoalesce: {
          type: "object",
          properties: {
            minChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            maxChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            idleMs: {
              type: "integer",
              minimum: 0,
              maximum: 9007199254740991,
            },
          },
          additionalProperties: false,
        },
        mediaMaxMb: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        reactionNotifications: {
          type: "string",
          enum: ["off", "own", "all", "allowlist"],
        },
        reactionAllowlist: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        actions: {
          type: "object",
          properties: {
            reactions: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
        reactionLevel: {
          type: "string",
          enum: ["off", "ack", "minimal", "extensive"],
        },
        heartbeat: {
          type: "object",
          properties: {
            showOk: {
              type: "boolean",
            },
            showAlerts: {
              type: "boolean",
            },
            useIndicator: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
        healthMonitor: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
        responsePrefix: {
          type: "string",
        },
        accounts: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              capabilities: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              markdown: {
                type: "object",
                properties: {
                  tables: {
                    type: "string",
                    enum: ["off", "bullets", "code"],
                  },
                },
                additionalProperties: false,
              },
              enabled: {
                type: "boolean",
              },
              configWrites: {
                type: "boolean",
              },
              account: {
                type: "string",
              },
              accountUuid: {
                type: "string",
              },
              httpUrl: {
                type: "string",
              },
              httpHost: {
                type: "string",
              },
              httpPort: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              cliPath: {
                type: "string",
              },
              autoStart: {
                type: "boolean",
              },
              startupTimeoutMs: {
                type: "integer",
                minimum: 1e3,
                maximum: 12e4,
              },
              receiveMode: {
                anyOf: [
                  {
                    type: "string",
                    const: "on-start",
                  },
                  {
                    type: "string",
                    const: "manual",
                  },
                ],
              },
              ignoreAttachments: {
                type: "boolean",
              },
              ignoreStories: {
                type: "boolean",
              },
              sendReadReceipts: {
                type: "boolean",
              },
              dmPolicy: {
                default: "pairing",
                type: "string",
                enum: ["pairing", "allowlist", "open", "disabled"],
              },
              allowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              defaultTo: {
                type: "string",
              },
              groupAllowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              groupPolicy: {
                default: "allowlist",
                type: "string",
                enum: ["open", "disabled", "allowlist"],
              },
              groups: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    requireMention: {
                      type: "boolean",
                    },
                    tools: {
                      type: "object",
                      properties: {
                        allow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        alsoAllow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        deny: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                      },
                      additionalProperties: false,
                    },
                    toolsBySender: {
                      type: "object",
                      propertyNames: {
                        type: "string",
                      },
                      additionalProperties: {
                        type: "object",
                        properties: {
                          allow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          alsoAllow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          deny: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                        },
                        additionalProperties: false,
                      },
                    },
                  },
                  additionalProperties: false,
                },
              },
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dmHistoryLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dms: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    historyLimit: {
                      type: "integer",
                      minimum: 0,
                      maximum: 9007199254740991,
                    },
                  },
                  additionalProperties: false,
                },
              },
              textChunkLimit: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              chunkMode: {
                type: "string",
                enum: ["length", "newline"],
              },
              blockStreaming: {
                type: "boolean",
              },
              blockStreamingCoalesce: {
                type: "object",
                properties: {
                  minChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  maxChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  idleMs: {
                    type: "integer",
                    minimum: 0,
                    maximum: 9007199254740991,
                  },
                },
                additionalProperties: false,
              },
              mediaMaxMb: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              reactionNotifications: {
                type: "string",
                enum: ["off", "own", "all", "allowlist"],
              },
              reactionAllowlist: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              actions: {
                type: "object",
                properties: {
                  reactions: {
                    type: "boolean",
                  },
                },
                additionalProperties: false,
              },
              reactionLevel: {
                type: "string",
                enum: ["off", "ack", "minimal", "extensive"],
              },
              heartbeat: {
                type: "object",
                properties: {
                  showOk: {
                    type: "boolean",
                  },
                  showAlerts: {
                    type: "boolean",
                  },
                  useIndicator: {
                    type: "boolean",
                  },
                },
                additionalProperties: false,
              },
              healthMonitor: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                },
                additionalProperties: false,
              },
              responsePrefix: {
                type: "string",
              },
            },
            required: ["dmPolicy", "groupPolicy"],
            additionalProperties: false,
          },
        },
        defaultAccount: {
          type: "string",
        },
      },
      required: ["dmPolicy", "groupPolicy"],
      additionalProperties: false,
    },
    uiHints: {
      "": {
        label: "Signal",
        help: "Signal channel provider configuration including account identity and DM policy behavior. Keep account mapping explicit so routing remains stable across multi-device setups.",
      },
      dmPolicy: {
        label: "Signal DM Policy",
        help: 'Direct message access control ("pairing" recommended). "open" requires channels.signal.allowFrom=["*"].',
      },
      configWrites: {
        label: "Signal Config Writes",
        help: "Allow Signal to write config in response to channel events/commands (default: true).",
      },
      account: {
        label: "Signal Account",
        help: "Signal account identifier (phone/number handle) used to bind this channel config to a specific Signal identity. Keep this aligned with your linked device/session state.",
      },
    },
  },
  {
    pluginId: "slack",
    channelId: "slack",
    label: "Slack",
    description: "supported (Socket Mode).",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        name: {
          type: "string",
        },
        mode: {
          default: "socket",
          type: "string",
          enum: ["socket", "http"],
        },
        signingSecret: {
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
              ],
            },
          ],
        },
        webhookPath: {
          default: "/slack/events",
          type: "string",
        },
        capabilities: {
          anyOf: [
            {
              type: "array",
              items: {
                type: "string",
              },
            },
            {
              type: "object",
              properties: {
                interactiveReplies: {
                  type: "boolean",
                },
              },
              additionalProperties: false,
            },
          ],
        },
        markdown: {
          type: "object",
          properties: {
            tables: {
              type: "string",
              enum: ["off", "bullets", "code"],
            },
          },
          additionalProperties: false,
        },
        enabled: {
          type: "boolean",
        },
        commands: {
          type: "object",
          properties: {
            native: {
              anyOf: [
                {
                  type: "boolean",
                },
                {
                  type: "string",
                  const: "auto",
                },
              ],
            },
            nativeSkills: {
              anyOf: [
                {
                  type: "boolean",
                },
                {
                  type: "string",
                  const: "auto",
                },
              ],
            },
          },
          additionalProperties: false,
        },
        configWrites: {
          type: "boolean",
        },
        botToken: {
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
              ],
            },
          ],
        },
        appToken: {
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
              ],
            },
          ],
        },
        userToken: {
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
              ],
            },
          ],
        },
        userTokenReadOnly: {
          default: true,
          type: "boolean",
        },
        allowBots: {
          type: "boolean",
        },
        dangerouslyAllowNameMatching: {
          type: "boolean",
        },
        requireMention: {
          type: "boolean",
        },
        groupPolicy: {
          default: "allowlist",
          type: "string",
          enum: ["open", "disabled", "allowlist"],
        },
        historyLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dmHistoryLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dms: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
            },
            additionalProperties: false,
          },
        },
        textChunkLimit: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        chunkMode: {
          type: "string",
          enum: ["length", "newline"],
        },
        blockStreaming: {
          type: "boolean",
        },
        blockStreamingCoalesce: {
          type: "object",
          properties: {
            minChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            maxChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            idleMs: {
              type: "integer",
              minimum: 0,
              maximum: 9007199254740991,
            },
          },
          additionalProperties: false,
        },
        streaming: {
          anyOf: [
            {
              type: "boolean",
            },
            {
              type: "string",
              enum: ["off", "partial", "block", "progress"],
            },
          ],
        },
        nativeStreaming: {
          type: "boolean",
        },
        streamMode: {
          type: "string",
          enum: ["replace", "status_final", "append"],
        },
        mediaMaxMb: {
          type: "number",
          exclusiveMinimum: 0,
        },
        reactionNotifications: {
          type: "string",
          enum: ["off", "own", "all", "allowlist"],
        },
        reactionAllowlist: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        replyToMode: {
          anyOf: [
            {
              type: "string",
              const: "off",
            },
            {
              type: "string",
              const: "first",
            },
            {
              type: "string",
              const: "all",
            },
          ],
        },
        replyToModeByChatType: {
          type: "object",
          properties: {
            direct: {
              anyOf: [
                {
                  type: "string",
                  const: "off",
                },
                {
                  type: "string",
                  const: "first",
                },
                {
                  type: "string",
                  const: "all",
                },
              ],
            },
            group: {
              anyOf: [
                {
                  type: "string",
                  const: "off",
                },
                {
                  type: "string",
                  const: "first",
                },
                {
                  type: "string",
                  const: "all",
                },
              ],
            },
            channel: {
              anyOf: [
                {
                  type: "string",
                  const: "off",
                },
                {
                  type: "string",
                  const: "first",
                },
                {
                  type: "string",
                  const: "all",
                },
              ],
            },
          },
          additionalProperties: false,
        },
        thread: {
          type: "object",
          properties: {
            historyScope: {
              type: "string",
              enum: ["thread", "channel"],
            },
            inheritParent: {
              type: "boolean",
            },
            initialHistoryLimit: {
              type: "integer",
              minimum: 0,
              maximum: 9007199254740991,
            },
          },
          additionalProperties: false,
        },
        actions: {
          type: "object",
          properties: {
            reactions: {
              type: "boolean",
            },
            messages: {
              type: "boolean",
            },
            pins: {
              type: "boolean",
            },
            search: {
              type: "boolean",
            },
            permissions: {
              type: "boolean",
            },
            memberInfo: {
              type: "boolean",
            },
            channelInfo: {
              type: "boolean",
            },
            emojiList: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
        slashCommand: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
            name: {
              type: "string",
            },
            sessionPrefix: {
              type: "string",
            },
            ephemeral: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
        dmPolicy: {
          type: "string",
          enum: ["pairing", "allowlist", "open", "disabled"],
        },
        allowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        defaultTo: {
          type: "string",
        },
        dm: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
            policy: {
              type: "string",
              enum: ["pairing", "allowlist", "open", "disabled"],
            },
            allowFrom: {
              type: "array",
              items: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    type: "number",
                  },
                ],
              },
            },
            groupEnabled: {
              type: "boolean",
            },
            groupChannels: {
              type: "array",
              items: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    type: "number",
                  },
                ],
              },
            },
            replyToMode: {
              anyOf: [
                {
                  type: "string",
                  const: "off",
                },
                {
                  type: "string",
                  const: "first",
                },
                {
                  type: "string",
                  const: "all",
                },
              ],
            },
          },
          additionalProperties: false,
        },
        channels: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              enabled: {
                type: "boolean",
              },
              allow: {
                type: "boolean",
              },
              requireMention: {
                type: "boolean",
              },
              tools: {
                type: "object",
                properties: {
                  allow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  alsoAllow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  deny: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },
                additionalProperties: false,
              },
              toolsBySender: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    allow: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    alsoAllow: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    deny: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                  },
                  additionalProperties: false,
                },
              },
              allowBots: {
                type: "boolean",
              },
              users: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              skills: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              systemPrompt: {
                type: "string",
              },
            },
            additionalProperties: false,
          },
        },
        heartbeat: {
          type: "object",
          properties: {
            showOk: {
              type: "boolean",
            },
            showAlerts: {
              type: "boolean",
            },
            useIndicator: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
        healthMonitor: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
          },
          additionalProperties: false,
        },
        responsePrefix: {
          type: "string",
        },
        ackReaction: {
          type: "string",
        },
        typingReaction: {
          type: "string",
        },
        accounts: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              mode: {
                type: "string",
                enum: ["socket", "http"],
              },
              signingSecret: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "env",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                            pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "file",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "exec",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                    ],
                  },
                ],
              },
              webhookPath: {
                type: "string",
              },
              capabilities: {
                anyOf: [
                  {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  {
                    type: "object",
                    properties: {
                      interactiveReplies: {
                        type: "boolean",
                      },
                    },
                    additionalProperties: false,
                  },
                ],
              },
              markdown: {
                type: "object",
                properties: {
                  tables: {
                    type: "string",
                    enum: ["off", "bullets", "code"],
                  },
                },
                additionalProperties: false,
              },
              enabled: {
                type: "boolean",
              },
              commands: {
                type: "object",
                properties: {
                  native: {
                    anyOf: [
                      {
                        type: "boolean",
                      },
                      {
                        type: "string",
                        const: "auto",
                      },
                    ],
                  },
                  nativeSkills: {
                    anyOf: [
                      {
                        type: "boolean",
                      },
                      {
                        type: "string",
                        const: "auto",
                      },
                    ],
                  },
                },
                additionalProperties: false,
              },
              configWrites: {
                type: "boolean",
              },
              botToken: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "env",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                            pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "file",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "exec",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                    ],
                  },
                ],
              },
              appToken: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "env",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                            pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "file",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "exec",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                    ],
                  },
                ],
              },
              userToken: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "env",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                            pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "file",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "exec",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                    ],
                  },
                ],
              },
              userTokenReadOnly: {
                default: true,
                type: "boolean",
              },
              allowBots: {
                type: "boolean",
              },
              dangerouslyAllowNameMatching: {
                type: "boolean",
              },
              requireMention: {
                type: "boolean",
              },
              groupPolicy: {
                type: "string",
                enum: ["open", "disabled", "allowlist"],
              },
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dmHistoryLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dms: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    historyLimit: {
                      type: "integer",
                      minimum: 0,
                      maximum: 9007199254740991,
                    },
                  },
                  additionalProperties: false,
                },
              },
              textChunkLimit: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              chunkMode: {
                type: "string",
                enum: ["length", "newline"],
              },
              blockStreaming: {
                type: "boolean",
              },
              blockStreamingCoalesce: {
                type: "object",
                properties: {
                  minChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  maxChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  idleMs: {
                    type: "integer",
                    minimum: 0,
                    maximum: 9007199254740991,
                  },
                },
                additionalProperties: false,
              },
              streaming: {
                anyOf: [
                  {
                    type: "boolean",
                  },
                  {
                    type: "string",
                    enum: ["off", "partial", "block", "progress"],
                  },
                ],
              },
              nativeStreaming: {
                type: "boolean",
              },
              streamMode: {
                type: "string",
                enum: ["replace", "status_final", "append"],
              },
              mediaMaxMb: {
                type: "number",
                exclusiveMinimum: 0,
              },
              reactionNotifications: {
                type: "string",
                enum: ["off", "own", "all", "allowlist"],
              },
              reactionAllowlist: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              replyToMode: {
                anyOf: [
                  {
                    type: "string",
                    const: "off",
                  },
                  {
                    type: "string",
                    const: "first",
                  },
                  {
                    type: "string",
                    const: "all",
                  },
                ],
              },
              replyToModeByChatType: {
                type: "object",
                properties: {
                  direct: {
                    anyOf: [
                      {
                        type: "string",
                        const: "off",
                      },
                      {
                        type: "string",
                        const: "first",
                      },
                      {
                        type: "string",
                        const: "all",
                      },
                    ],
                  },
                  group: {
                    anyOf: [
                      {
                        type: "string",
                        const: "off",
                      },
                      {
                        type: "string",
                        const: "first",
                      },
                      {
                        type: "string",
                        const: "all",
                      },
                    ],
                  },
                  channel: {
                    anyOf: [
                      {
                        type: "string",
                        const: "off",
                      },
                      {
                        type: "string",
                        const: "first",
                      },
                      {
                        type: "string",
                        const: "all",
                      },
                    ],
                  },
                },
                additionalProperties: false,
              },
              thread: {
                type: "object",
                properties: {
                  historyScope: {
                    type: "string",
                    enum: ["thread", "channel"],
                  },
                  inheritParent: {
                    type: "boolean",
                  },
                  initialHistoryLimit: {
                    type: "integer",
                    minimum: 0,
                    maximum: 9007199254740991,
                  },
                },
                additionalProperties: false,
              },
              actions: {
                type: "object",
                properties: {
                  reactions: {
                    type: "boolean",
                  },
                  messages: {
                    type: "boolean",
                  },
                  pins: {
                    type: "boolean",
                  },
                  search: {
                    type: "boolean",
                  },
                  permissions: {
                    type: "boolean",
                  },
                  memberInfo: {
                    type: "boolean",
                  },
                  channelInfo: {
                    type: "boolean",
                  },
                  emojiList: {
                    type: "boolean",
                  },
                },
                additionalProperties: false,
              },
              slashCommand: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                  name: {
                    type: "string",
                  },
                  sessionPrefix: {
                    type: "string",
                  },
                  ephemeral: {
                    type: "boolean",
                  },
                },
                additionalProperties: false,
              },
              dmPolicy: {
                type: "string",
                enum: ["pairing", "allowlist", "open", "disabled"],
              },
              allowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              defaultTo: {
                type: "string",
              },
              dm: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                  policy: {
                    type: "string",
                    enum: ["pairing", "allowlist", "open", "disabled"],
                  },
                  allowFrom: {
                    type: "array",
                    items: {
                      anyOf: [
                        {
                          type: "string",
                        },
                        {
                          type: "number",
                        },
                      ],
                    },
                  },
                  groupEnabled: {
                    type: "boolean",
                  },
                  groupChannels: {
                    type: "array",
                    items: {
                      anyOf: [
                        {
                          type: "string",
                        },
                        {
                          type: "number",
                        },
                      ],
                    },
                  },
                  replyToMode: {
                    anyOf: [
                      {
                        type: "string",
                        const: "off",
                      },
                      {
                        type: "string",
                        const: "first",
                      },
                      {
                        type: "string",
                        const: "all",
                      },
                    ],
                  },
                },
                additionalProperties: false,
              },
              channels: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    enabled: {
                      type: "boolean",
                    },
                    allow: {
                      type: "boolean",
                    },
                    requireMention: {
                      type: "boolean",
                    },
                    tools: {
                      type: "object",
                      properties: {
                        allow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        alsoAllow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        deny: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                      },
                      additionalProperties: false,
                    },
                    toolsBySender: {
                      type: "object",
                      propertyNames: {
                        type: "string",
                      },
                      additionalProperties: {
                        type: "object",
                        properties: {
                          allow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          alsoAllow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          deny: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                        },
                        additionalProperties: false,
                      },
                    },
                    allowBots: {
                      type: "boolean",
                    },
                    users: {
                      type: "array",
                      items: {
                        anyOf: [
                          {
                            type: "string",
                          },
                          {
                            type: "number",
                          },
                        ],
                      },
                    },
                    skills: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    systemPrompt: {
                      type: "string",
                    },
                  },
                  additionalProperties: false,
                },
              },
              heartbeat: {
                type: "object",
                properties: {
                  showOk: {
                    type: "boolean",
                  },
                  showAlerts: {
                    type: "boolean",
                  },
                  useIndicator: {
                    type: "boolean",
                  },
                },
                additionalProperties: false,
              },
              healthMonitor: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                },
                additionalProperties: false,
              },
              responsePrefix: {
                type: "string",
              },
              ackReaction: {
                type: "string",
              },
              typingReaction: {
                type: "string",
              },
            },
            required: ["userTokenReadOnly"],
            additionalProperties: false,
          },
        },
        defaultAccount: {
          type: "string",
        },
      },
      required: ["mode", "webhookPath", "userTokenReadOnly", "groupPolicy"],
      additionalProperties: false,
    },
    uiHints: {
      "": {
        label: "Slack",
        help: "Slack channel provider configuration for bot/app tokens, streaming behavior, and DM policy controls. Keep token handling and thread behavior explicit to avoid noisy workspace interactions.",
      },
      "dm.policy": {
        label: "Slack DM Policy",
        help: 'Direct message access control ("pairing" recommended). "open" requires channels.slack.allowFrom=["*"] (legacy: channels.slack.dm.allowFrom).',
      },
      dmPolicy: {
        label: "Slack DM Policy",
        help: 'Direct message access control ("pairing" recommended). "open" requires channels.slack.allowFrom=["*"].',
      },
      configWrites: {
        label: "Slack Config Writes",
        help: "Allow Slack to write config in response to channel events/commands (default: true).",
      },
      "commands.native": {
        label: "Slack Native Commands",
        help: 'Override native commands for Slack (bool or "auto").',
      },
      "commands.nativeSkills": {
        label: "Slack Native Skill Commands",
        help: 'Override native skill commands for Slack (bool or "auto").',
      },
      allowBots: {
        label: "Slack Allow Bot Messages",
        help: "Allow bot-authored messages to trigger Slack replies (default: false).",
      },
      botToken: {
        label: "Slack Bot Token",
        help: "Slack bot token used for standard chat actions in the configured workspace. Keep this credential scoped and rotate if workspace app permissions change.",
      },
      appToken: {
        label: "Slack App Token",
        help: "Slack app-level token used for Socket Mode connections and event transport when enabled. Use least-privilege app scopes and store this token as a secret.",
      },
      userToken: {
        label: "Slack User Token",
        help: "Optional Slack user token for workflows requiring user-context API access beyond bot permissions. Use sparingly and audit scopes because this token can carry broader authority.",
      },
      userTokenReadOnly: {
        label: "Slack User Token Read Only",
        help: "When true, treat configured Slack user token usage as read-only helper behavior where possible. Keep enabled if you only need supplemental reads without user-context writes.",
      },
      "capabilities.interactiveReplies": {
        label: "Slack Interactive Replies",
        help: "Enable agent-authored Slack interactive reply directives (`[[slack_buttons: ...]]`, `[[slack_select: ...]]`). Default: false.",
      },
      streaming: {
        label: "Slack Streaming Mode",
        help: 'Unified Slack stream preview mode: "off" | "partial" | "block" | "progress". Legacy boolean/streamMode keys are auto-mapped.',
      },
      nativeStreaming: {
        label: "Slack Native Streaming",
        help: "Enable native Slack text streaming (chat.startStream/chat.appendStream/chat.stopStream) when channels.slack.streaming is partial (default: true).",
      },
      streamMode: {
        label: "Slack Stream Mode (Legacy)",
        help: "Legacy Slack preview mode alias (replace | status_final | append); auto-migrated to channels.slack.streaming.",
      },
      "thread.historyScope": {
        label: "Slack Thread History Scope",
        help: 'Scope for Slack thread history context ("thread" isolates per thread; "channel" reuses channel history).',
      },
      "thread.inheritParent": {
        label: "Slack Thread Parent Inheritance",
        help: "If true, Slack thread sessions inherit the parent channel transcript (default: false).",
      },
      "thread.initialHistoryLimit": {
        label: "Slack Thread Initial History Limit",
        help: "Maximum number of existing Slack thread messages to fetch when starting a new thread session (default: 20, set to 0 to disable).",
      },
    },
  },
  {
    pluginId: "synology-chat",
    channelId: "synology-chat",
    label: "Synology Chat",
    description: "Connect your Synology NAS Chat to OpenClaw with full agent capabilities.",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        dangerouslyAllowNameMatching: {
          type: "boolean",
        },
        dangerouslyAllowInheritedWebhookPath: {
          type: "boolean",
        },
      },
      additionalProperties: {},
    },
  },
  {
    pluginId: "telegram",
    channelId: "telegram",
    label: "Telegram",
    description: "simplest way to get started \u2014 register a bot with @BotFather and get going.",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        name: {
          type: "string",
        },
        capabilities: {
          anyOf: [
            {
              type: "array",
              items: {
                type: "string",
              },
            },
            {
              type: "object",
              properties: {
                inlineButtons: {
                  type: "string",
                  enum: ["off", "dm", "group", "all", "allowlist"],
                },
              },
              additionalProperties: true,
            },
          ],
        },
        execApprovals: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
            approvers: {
              type: "array",
              items: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    type: "number",
                  },
                ],
              },
            },
            agentFilter: {
              type: "array",
              items: {
                type: "string",
              },
            },
            sessionFilter: {
              type: "array",
              items: {
                type: "string",
              },
            },
            target: {
              type: "string",
              enum: ["dm", "channel", "both"],
            },
          },
          additionalProperties: true,
        },
        markdown: {
          type: "object",
          properties: {
            tables: {
              type: "string",
              enum: ["off", "bullets", "code"],
            },
          },
          additionalProperties: true,
        },
        enabled: {
          type: "boolean",
        },
        commands: {
          type: "object",
          properties: {
            native: {
              anyOf: [
                {
                  type: "boolean",
                },
                {
                  type: "string",
                  const: "auto",
                },
              ],
            },
            nativeSkills: {
              anyOf: [
                {
                  type: "boolean",
                },
                {
                  type: "string",
                  const: "auto",
                },
              ],
            },
          },
          additionalProperties: true,
        },
        customCommands: {
          type: "array",
          items: {
            type: "object",
            properties: {
              command: {
                type: "string",
              },
              description: {
                type: "string",
              },
            },
            required: ["command", "description"],
            additionalProperties: true,
          },
        },
        configWrites: {
          type: "boolean",
        },
        dmPolicy: {
          default: "pairing",
          type: "string",
          enum: ["pairing", "allowlist", "open", "disabled"],
        },
        botToken: {
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: true,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: true,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: true,
                },
              ],
            },
          ],
        },
        tokenFile: {
          type: "string",
        },
        replyToMode: {
          anyOf: [
            {
              type: "string",
              const: "off",
            },
            {
              type: "string",
              const: "first",
            },
            {
              type: "string",
              const: "all",
            },
          ],
        },
        groups: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              requireMention: {
                type: "boolean",
              },
              disableAudioPreflight: {
                type: "boolean",
              },
              groupPolicy: {
                type: "string",
                enum: ["open", "disabled", "allowlist"],
              },
              tools: {
                type: "object",
                properties: {
                  allow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  alsoAllow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  deny: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },
                additionalProperties: true,
              },
              toolsBySender: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    allow: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    alsoAllow: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    deny: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                  },
                  additionalProperties: true,
                },
              },
              skills: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              enabled: {
                type: "boolean",
              },
              allowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              systemPrompt: {
                type: "string",
              },
              topics: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    requireMention: {
                      type: "boolean",
                    },
                    disableAudioPreflight: {
                      type: "boolean",
                    },
                    groupPolicy: {
                      type: "string",
                      enum: ["open", "disabled", "allowlist"],
                    },
                    skills: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    enabled: {
                      type: "boolean",
                    },
                    allowFrom: {
                      type: "array",
                      items: {
                        anyOf: [
                          {
                            type: "string",
                          },
                          {
                            type: "number",
                          },
                        ],
                      },
                    },
                    systemPrompt: {
                      type: "string",
                    },
                    agentId: {
                      type: "string",
                    },
                    gateMode: {
                      type: "string",
                      enum: ["blocked", "silent", "frank-only", "allowlist", "mention", "open"],
                    },
                  },
                  additionalProperties: true,
                },
              },
              gateMode: {
                type: "string",
                enum: ["blocked", "silent", "frank-only", "allowlist", "mention", "open"],
              },
            },
            additionalProperties: true,
          },
        },
        allowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        defaultTo: {
          anyOf: [
            {
              type: "string",
            },
            {
              type: "number",
            },
          ],
        },
        groupAllowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        groupPolicy: {
          default: "allowlist",
          type: "string",
          enum: ["open", "disabled", "allowlist"],
        },
        historyLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dmHistoryLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dms: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
            },
            additionalProperties: true,
          },
        },
        direct: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              dmPolicy: {
                type: "string",
                enum: ["pairing", "allowlist", "open", "disabled"],
              },
              tools: {
                type: "object",
                properties: {
                  allow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  alsoAllow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  deny: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },
                additionalProperties: true,
              },
              toolsBySender: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    allow: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    alsoAllow: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    deny: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                  },
                  additionalProperties: true,
                },
              },
              skills: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              enabled: {
                type: "boolean",
              },
              allowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              systemPrompt: {
                type: "string",
              },
              topics: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    requireMention: {
                      type: "boolean",
                    },
                    disableAudioPreflight: {
                      type: "boolean",
                    },
                    groupPolicy: {
                      type: "string",
                      enum: ["open", "disabled", "allowlist"],
                    },
                    skills: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    enabled: {
                      type: "boolean",
                    },
                    allowFrom: {
                      type: "array",
                      items: {
                        anyOf: [
                          {
                            type: "string",
                          },
                          {
                            type: "number",
                          },
                        ],
                      },
                    },
                    systemPrompt: {
                      type: "string",
                    },
                    agentId: {
                      type: "string",
                    },
                    gateMode: {
                      type: "string",
                      enum: ["blocked", "silent", "frank-only", "allowlist", "mention", "open"],
                    },
                  },
                  additionalProperties: true,
                },
              },
              requireTopic: {
                type: "boolean",
              },
              autoTopicLabel: {
                anyOf: [
                  {
                    type: "boolean",
                  },
                  {
                    type: "object",
                    properties: {
                      enabled: {
                        type: "boolean",
                      },
                      prompt: {
                        type: "string",
                      },
                    },
                    additionalProperties: true,
                  },
                ],
              },
            },
            additionalProperties: true,
          },
        },
        textChunkLimit: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        chunkMode: {
          type: "string",
          enum: ["length", "newline"],
        },
        streaming: {
          anyOf: [
            {
              type: "boolean",
            },
            {
              type: "string",
              enum: ["off", "partial", "block", "progress"],
            },
          ],
        },
        blockStreaming: {
          type: "boolean",
        },
        draftChunk: {
          type: "object",
          properties: {
            minChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            maxChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            breakPreference: {
              anyOf: [
                {
                  type: "string",
                  const: "paragraph",
                },
                {
                  type: "string",
                  const: "newline",
                },
                {
                  type: "string",
                  const: "sentence",
                },
              ],
            },
          },
          additionalProperties: true,
        },
        blockStreamingCoalesce: {
          type: "object",
          properties: {
            minChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            maxChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            idleMs: {
              type: "integer",
              minimum: 0,
              maximum: 9007199254740991,
            },
          },
          additionalProperties: true,
        },
        streamMode: {
          type: "string",
          enum: ["off", "partial", "block"],
        },
        mediaMaxMb: {
          type: "number",
          exclusiveMinimum: 0,
        },
        timeoutSeconds: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        retry: {
          type: "object",
          properties: {
            attempts: {
              type: "integer",
              minimum: 1,
              maximum: 9007199254740991,
            },
            minDelayMs: {
              type: "integer",
              minimum: 0,
              maximum: 9007199254740991,
            },
            maxDelayMs: {
              type: "integer",
              minimum: 0,
              maximum: 9007199254740991,
            },
            jitter: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
          additionalProperties: true,
        },
        network: {
          type: "object",
          properties: {
            autoSelectFamily: {
              type: "boolean",
            },
            dnsResultOrder: {
              type: "string",
              enum: ["ipv4first", "verbatim"],
            },
          },
          additionalProperties: true,
        },
        proxy: {
          type: "string",
        },
        webhookUrl: {
          description:
            "Public HTTPS webhook URL registered with Telegram for inbound updates. This must be internet-reachable and requires channels.telegram.webhookSecret.",
          type: "string",
        },
        webhookSecret: {
          description:
            "Secret token sent to Telegram during webhook registration and verified on inbound webhook requests. Telegram returns this value for verification; this is not the gateway auth token and not the bot token.",
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: true,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: true,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: true,
                },
              ],
            },
          ],
        },
        webhookPath: {
          description:
            "Local webhook route path served by the gateway listener. Defaults to /telegram-webhook.",
          type: "string",
        },
        webhookHost: {
          description:
            "Local bind host for the webhook listener. Defaults to 127.0.0.1; keep loopback unless you intentionally expose direct ingress.",
          type: "string",
        },
        webhookPort: {
          description:
            "Local bind port for the webhook listener. Defaults to 8787; set to 0 to let the OS assign an ephemeral port.",
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        webhookCertPath: {
          description:
            "Path to the self-signed certificate (PEM) to upload to Telegram during webhook registration. Required for self-signed certs (direct IP or no domain).",
          type: "string",
        },
        actions: {
          type: "object",
          properties: {
            reactions: {
              type: "boolean",
            },
            sendMessage: {
              type: "boolean",
            },
            poll: {
              type: "boolean",
            },
            deleteMessage: {
              type: "boolean",
            },
            editMessage: {
              type: "boolean",
            },
            sticker: {
              type: "boolean",
            },
            createForumTopic: {
              type: "boolean",
            },
            editForumTopic: {
              type: "boolean",
            },
          },
          additionalProperties: true,
        },
        threadBindings: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
            idleHours: {
              type: "number",
              minimum: 0,
            },
            maxAgeHours: {
              type: "number",
              minimum: 0,
            },
            spawnSubagentSessions: {
              type: "boolean",
            },
            spawnAcpSessions: {
              type: "boolean",
            },
          },
          additionalProperties: true,
        },
        reactionNotifications: {
          type: "string",
          enum: ["off", "own", "all"],
        },
        reactionLevel: {
          type: "string",
          enum: ["off", "ack", "minimal", "extensive"],
        },
        heartbeat: {
          type: "object",
          properties: {
            showOk: {
              type: "boolean",
            },
            showAlerts: {
              type: "boolean",
            },
            useIndicator: {
              type: "boolean",
            },
          },
          additionalProperties: true,
        },
        healthMonitor: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
          },
          additionalProperties: true,
        },
        linkPreview: {
          type: "boolean",
        },
        silentErrorReplies: {
          type: "boolean",
        },
        responsePrefix: {
          type: "string",
        },
        ackReaction: {
          type: "string",
        },
        apiRoot: {
          type: "string",
          format: "uri",
        },
        autoTopicLabel: {
          anyOf: [
            {
              type: "boolean",
            },
            {
              type: "object",
              properties: {
                enabled: {
                  type: "boolean",
                },
                prompt: {
                  type: "string",
                },
              },
              additionalProperties: true,
            },
          ],
        },
        accounts: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              capabilities: {
                anyOf: [
                  {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  {
                    type: "object",
                    properties: {
                      inlineButtons: {
                        type: "string",
                        enum: ["off", "dm", "group", "all", "allowlist"],
                      },
                    },
                    additionalProperties: true,
                  },
                ],
              },
              execApprovals: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                  approvers: {
                    type: "array",
                    items: {
                      anyOf: [
                        {
                          type: "string",
                        },
                        {
                          type: "number",
                        },
                      ],
                    },
                  },
                  agentFilter: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  sessionFilter: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  target: {
                    type: "string",
                    enum: ["dm", "channel", "both"],
                  },
                },
                additionalProperties: true,
              },
              markdown: {
                type: "object",
                properties: {
                  tables: {
                    type: "string",
                    enum: ["off", "bullets", "code"],
                  },
                },
                additionalProperties: true,
              },
              enabled: {
                type: "boolean",
              },
              commands: {
                type: "object",
                properties: {
                  native: {
                    anyOf: [
                      {
                        type: "boolean",
                      },
                      {
                        type: "string",
                        const: "auto",
                      },
                    ],
                  },
                  nativeSkills: {
                    anyOf: [
                      {
                        type: "boolean",
                      },
                      {
                        type: "string",
                        const: "auto",
                      },
                    ],
                  },
                },
                additionalProperties: true,
              },
              customCommands: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    command: {
                      type: "string",
                    },
                    description: {
                      type: "string",
                    },
                  },
                  required: ["command", "description"],
                  additionalProperties: true,
                },
              },
              configWrites: {
                type: "boolean",
              },
              dmPolicy: {
                default: "pairing",
                type: "string",
                enum: ["pairing", "allowlist", "open", "disabled"],
              },
              botToken: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "env",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                            pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: true,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "file",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: true,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "exec",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: true,
                      },
                    ],
                  },
                ],
              },
              tokenFile: {
                type: "string",
              },
              replyToMode: {
                anyOf: [
                  {
                    type: "string",
                    const: "off",
                  },
                  {
                    type: "string",
                    const: "first",
                  },
                  {
                    type: "string",
                    const: "all",
                  },
                ],
              },
              groups: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    requireMention: {
                      type: "boolean",
                    },
                    disableAudioPreflight: {
                      type: "boolean",
                    },
                    groupPolicy: {
                      type: "string",
                      enum: ["open", "disabled", "allowlist"],
                    },
                    tools: {
                      type: "object",
                      properties: {
                        allow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        alsoAllow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        deny: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                      },
                      additionalProperties: true,
                    },
                    toolsBySender: {
                      type: "object",
                      propertyNames: {
                        type: "string",
                      },
                      additionalProperties: {
                        type: "object",
                        properties: {
                          allow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          alsoAllow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          deny: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                        },
                        additionalProperties: true,
                      },
                    },
                    skills: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    enabled: {
                      type: "boolean",
                    },
                    allowFrom: {
                      type: "array",
                      items: {
                        anyOf: [
                          {
                            type: "string",
                          },
                          {
                            type: "number",
                          },
                        ],
                      },
                    },
                    systemPrompt: {
                      type: "string",
                    },
                    topics: {
                      type: "object",
                      propertyNames: {
                        type: "string",
                      },
                      additionalProperties: {
                        type: "object",
                        properties: {
                          requireMention: {
                            type: "boolean",
                          },
                          disableAudioPreflight: {
                            type: "boolean",
                          },
                          groupPolicy: {
                            type: "string",
                            enum: ["open", "disabled", "allowlist"],
                          },
                          skills: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          enabled: {
                            type: "boolean",
                          },
                          allowFrom: {
                            type: "array",
                            items: {
                              anyOf: [
                                {
                                  type: "string",
                                },
                                {
                                  type: "number",
                                },
                              ],
                            },
                          },
                          systemPrompt: {
                            type: "string",
                          },
                          agentId: {
                            type: "string",
                          },
                          gateMode: {
                            type: "string",
                            enum: [
                              "blocked",
                              "silent",
                              "frank-only",
                              "allowlist",
                              "mention",
                              "open",
                            ],
                          },
                        },
                        additionalProperties: true,
                      },
                    },
                    gateMode: {
                      type: "string",
                      enum: ["blocked", "silent", "frank-only", "allowlist", "mention", "open"],
                    },
                  },
                  additionalProperties: true,
                },
              },
              allowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              defaultTo: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    type: "number",
                  },
                ],
              },
              groupAllowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              groupPolicy: {
                default: "allowlist",
                type: "string",
                enum: ["open", "disabled", "allowlist"],
              },
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dmHistoryLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dms: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    historyLimit: {
                      type: "integer",
                      minimum: 0,
                      maximum: 9007199254740991,
                    },
                  },
                  additionalProperties: true,
                },
              },
              direct: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    dmPolicy: {
                      type: "string",
                      enum: ["pairing", "allowlist", "open", "disabled"],
                    },
                    tools: {
                      type: "object",
                      properties: {
                        allow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        alsoAllow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        deny: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                      },
                      additionalProperties: true,
                    },
                    toolsBySender: {
                      type: "object",
                      propertyNames: {
                        type: "string",
                      },
                      additionalProperties: {
                        type: "object",
                        properties: {
                          allow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          alsoAllow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          deny: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                        },
                        additionalProperties: true,
                      },
                    },
                    skills: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    enabled: {
                      type: "boolean",
                    },
                    allowFrom: {
                      type: "array",
                      items: {
                        anyOf: [
                          {
                            type: "string",
                          },
                          {
                            type: "number",
                          },
                        ],
                      },
                    },
                    systemPrompt: {
                      type: "string",
                    },
                    topics: {
                      type: "object",
                      propertyNames: {
                        type: "string",
                      },
                      additionalProperties: {
                        type: "object",
                        properties: {
                          requireMention: {
                            type: "boolean",
                          },
                          disableAudioPreflight: {
                            type: "boolean",
                          },
                          groupPolicy: {
                            type: "string",
                            enum: ["open", "disabled", "allowlist"],
                          },
                          skills: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          enabled: {
                            type: "boolean",
                          },
                          allowFrom: {
                            type: "array",
                            items: {
                              anyOf: [
                                {
                                  type: "string",
                                },
                                {
                                  type: "number",
                                },
                              ],
                            },
                          },
                          systemPrompt: {
                            type: "string",
                          },
                          agentId: {
                            type: "string",
                          },
                          gateMode: {
                            type: "string",
                            enum: [
                              "blocked",
                              "silent",
                              "frank-only",
                              "allowlist",
                              "mention",
                              "open",
                            ],
                          },
                        },
                        additionalProperties: true,
                      },
                    },
                    requireTopic: {
                      type: "boolean",
                    },
                    autoTopicLabel: {
                      anyOf: [
                        {
                          type: "boolean",
                        },
                        {
                          type: "object",
                          properties: {
                            enabled: {
                              type: "boolean",
                            },
                            prompt: {
                              type: "string",
                            },
                          },
                          additionalProperties: true,
                        },
                      ],
                    },
                  },
                  additionalProperties: true,
                },
              },
              textChunkLimit: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              chunkMode: {
                type: "string",
                enum: ["length", "newline"],
              },
              streaming: {
                anyOf: [
                  {
                    type: "boolean",
                  },
                  {
                    type: "string",
                    enum: ["off", "partial", "block", "progress"],
                  },
                ],
              },
              blockStreaming: {
                type: "boolean",
              },
              draftChunk: {
                type: "object",
                properties: {
                  minChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  maxChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  breakPreference: {
                    anyOf: [
                      {
                        type: "string",
                        const: "paragraph",
                      },
                      {
                        type: "string",
                        const: "newline",
                      },
                      {
                        type: "string",
                        const: "sentence",
                      },
                    ],
                  },
                },
                additionalProperties: true,
              },
              blockStreamingCoalesce: {
                type: "object",
                properties: {
                  minChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  maxChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  idleMs: {
                    type: "integer",
                    minimum: 0,
                    maximum: 9007199254740991,
                  },
                },
                additionalProperties: true,
              },
              streamMode: {
                type: "string",
                enum: ["off", "partial", "block"],
              },
              mediaMaxMb: {
                type: "number",
                exclusiveMinimum: 0,
              },
              timeoutSeconds: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              retry: {
                type: "object",
                properties: {
                  attempts: {
                    type: "integer",
                    minimum: 1,
                    maximum: 9007199254740991,
                  },
                  minDelayMs: {
                    type: "integer",
                    minimum: 0,
                    maximum: 9007199254740991,
                  },
                  maxDelayMs: {
                    type: "integer",
                    minimum: 0,
                    maximum: 9007199254740991,
                  },
                  jitter: {
                    type: "number",
                    minimum: 0,
                    maximum: 1,
                  },
                },
                additionalProperties: true,
              },
              network: {
                type: "object",
                properties: {
                  autoSelectFamily: {
                    type: "boolean",
                  },
                  dnsResultOrder: {
                    type: "string",
                    enum: ["ipv4first", "verbatim"],
                  },
                },
                additionalProperties: true,
              },
              proxy: {
                type: "string",
              },
              webhookUrl: {
                description:
                  "Public HTTPS webhook URL registered with Telegram for inbound updates. This must be internet-reachable and requires channels.telegram.webhookSecret.",
                type: "string",
              },
              webhookSecret: {
                description:
                  "Secret token sent to Telegram during webhook registration and verified on inbound webhook requests. Telegram returns this value for verification; this is not the gateway auth token and not the bot token.",
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "env",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                            pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: true,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "file",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: true,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "exec",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: true,
                      },
                    ],
                  },
                ],
              },
              webhookPath: {
                description:
                  "Local webhook route path served by the gateway listener. Defaults to /telegram-webhook.",
                type: "string",
              },
              webhookHost: {
                description:
                  "Local bind host for the webhook listener. Defaults to 127.0.0.1; keep loopback unless you intentionally expose direct ingress.",
                type: "string",
              },
              webhookPort: {
                description:
                  "Local bind port for the webhook listener. Defaults to 8787; set to 0 to let the OS assign an ephemeral port.",
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              webhookCertPath: {
                description:
                  "Path to the self-signed certificate (PEM) to upload to Telegram during webhook registration. Required for self-signed certs (direct IP or no domain).",
                type: "string",
              },
              actions: {
                type: "object",
                properties: {
                  reactions: {
                    type: "boolean",
                  },
                  sendMessage: {
                    type: "boolean",
                  },
                  poll: {
                    type: "boolean",
                  },
                  deleteMessage: {
                    type: "boolean",
                  },
                  editMessage: {
                    type: "boolean",
                  },
                  sticker: {
                    type: "boolean",
                  },
                  createForumTopic: {
                    type: "boolean",
                  },
                  editForumTopic: {
                    type: "boolean",
                  },
                },
                additionalProperties: true,
              },
              threadBindings: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                  idleHours: {
                    type: "number",
                    minimum: 0,
                  },
                  maxAgeHours: {
                    type: "number",
                    minimum: 0,
                  },
                  spawnSubagentSessions: {
                    type: "boolean",
                  },
                  spawnAcpSessions: {
                    type: "boolean",
                  },
                },
                additionalProperties: true,
              },
              reactionNotifications: {
                type: "string",
                enum: ["off", "own", "all"],
              },
              reactionLevel: {
                type: "string",
                enum: ["off", "ack", "minimal", "extensive"],
              },
              heartbeat: {
                type: "object",
                properties: {
                  showOk: {
                    type: "boolean",
                  },
                  showAlerts: {
                    type: "boolean",
                  },
                  useIndicator: {
                    type: "boolean",
                  },
                },
                additionalProperties: true,
              },
              healthMonitor: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                },
                additionalProperties: true,
              },
              linkPreview: {
                type: "boolean",
              },
              silentErrorReplies: {
                type: "boolean",
              },
              responsePrefix: {
                type: "string",
              },
              ackReaction: {
                type: "string",
              },
              apiRoot: {
                type: "string",
                format: "uri",
              },
              autoTopicLabel: {
                anyOf: [
                  {
                    type: "boolean",
                  },
                  {
                    type: "object",
                    properties: {
                      enabled: {
                        type: "boolean",
                      },
                      prompt: {
                        type: "string",
                      },
                    },
                    additionalProperties: true,
                  },
                ],
              },
            },
            required: ["dmPolicy", "groupPolicy"],
            additionalProperties: true,
          },
        },
        defaultAccount: {
          type: "string",
        },
      },
      required: ["dmPolicy", "groupPolicy"],
      additionalProperties: true,
    },
    uiHints: {
      "": {
        label: "Telegram",
        help: "Telegram channel provider configuration including auth tokens, retry behavior, and message rendering controls. Use this section to tune bot behavior for Telegram-specific API semantics.",
      },
      customCommands: {
        label: "Telegram Custom Commands",
        help: "Additional Telegram bot menu commands (merged with native; conflicts ignored).",
      },
      botToken: {
        label: "Telegram Bot Token",
        help: "Telegram bot token used to authenticate Bot API requests for this account/provider config. Use secret/env substitution and rotate tokens if exposure is suspected.",
      },
      dmPolicy: {
        label: "Telegram DM Policy",
        help: 'Direct message access control ("pairing" recommended). "open" requires channels.telegram.allowFrom=["*"].',
      },
      configWrites: {
        label: "Telegram Config Writes",
        help: "Allow Telegram to write config in response to channel events/commands (default: true).",
      },
      "commands.native": {
        label: "Telegram Native Commands",
        help: 'Override native commands for Telegram (bool or "auto").',
      },
      "commands.nativeSkills": {
        label: "Telegram Native Skill Commands",
        help: 'Override native skill commands for Telegram (bool or "auto").',
      },
      streaming: {
        label: "Telegram Streaming Mode",
        help: 'Unified Telegram stream preview mode: "off" | "partial" | "block" | "progress" (default: "partial"). "progress" maps to "partial" on Telegram. Legacy boolean/streamMode keys are auto-mapped.',
      },
      "retry.attempts": {
        label: "Telegram Retry Attempts",
        help: "Max retry attempts for outbound Telegram API calls (default: 3).",
      },
      "retry.minDelayMs": {
        label: "Telegram Retry Min Delay (ms)",
        help: "Minimum retry delay in ms for Telegram outbound calls.",
      },
      "retry.maxDelayMs": {
        label: "Telegram Retry Max Delay (ms)",
        help: "Maximum retry delay cap in ms for Telegram outbound calls.",
      },
      "retry.jitter": {
        label: "Telegram Retry Jitter",
        help: "Jitter factor (0-1) applied to Telegram retry delays.",
      },
      "network.autoSelectFamily": {
        label: "Telegram autoSelectFamily",
        help: "Override Node autoSelectFamily for Telegram (true=enable, false=disable).",
      },
      timeoutSeconds: {
        label: "Telegram API Timeout (seconds)",
        help: "Max seconds before Telegram API requests are aborted (default: 500 per grammY).",
      },
      silentErrorReplies: {
        label: "Telegram Silent Error Replies",
        help: "When true, Telegram bot replies marked as errors are sent silently (no notification sound). Default: false.",
      },
      apiRoot: {
        label: "Telegram API Root URL",
        help: "Custom Telegram Bot API root URL. Use for self-hosted Bot API servers (https://github.com/tdlib/telegram-bot-api) or reverse proxies in regions where api.telegram.org is blocked.",
      },
      autoTopicLabel: {
        label: "Telegram Auto Topic Label",
        help: "Auto-rename DM forum topics on first message using LLM. Default: true. Set to false to disable, or use object form { enabled: true, prompt: '...' } for custom prompt.",
      },
      "autoTopicLabel.enabled": {
        label: "Telegram Auto Topic Label Enabled",
        help: "Whether auto topic labeling is enabled. Default: true.",
      },
      "autoTopicLabel.prompt": {
        label: "Telegram Auto Topic Label Prompt",
        help: "Custom prompt for LLM-based topic naming. The user message is appended after the prompt.",
      },
      "capabilities.inlineButtons": {
        label: "Telegram Inline Buttons",
        help: "Enable Telegram inline button components for supported command and interaction surfaces. Disable if your deployment needs plain-text-only compatibility behavior.",
      },
      execApprovals: {
        label: "Telegram Exec Approvals",
        help: "Telegram-native exec approval routing and approver authorization. Enable this only when Telegram should act as an explicit exec-approval client for the selected bot account.",
      },
      "execApprovals.enabled": {
        label: "Telegram Exec Approvals Enabled",
        help: "Enable Telegram exec approvals for this account. When false or unset, Telegram messages/buttons cannot approve exec requests.",
      },
      "execApprovals.approvers": {
        label: "Telegram Exec Approval Approvers",
        help: "Telegram user IDs allowed to approve exec requests for this bot account. Use numeric Telegram user IDs; prompts are only delivered to these approvers when target includes dm.",
      },
      "execApprovals.agentFilter": {
        label: "Telegram Exec Approval Agent Filter",
        help: 'Optional allowlist of agent IDs eligible for Telegram exec approvals, for example `["main", "ops-agent"]`. Use this to keep approval prompts scoped to the agents you actually operate from Telegram.',
      },
      "execApprovals.sessionFilter": {
        label: "Telegram Exec Approval Session Filter",
        help: "Optional session-key filters matched as substring or regex-style patterns before Telegram approval routing is used. Use narrow patterns so Telegram approvals only appear for intended sessions.",
      },
      "execApprovals.target": {
        label: "Telegram Exec Approval Target",
        help: 'Controls where Telegram approval prompts are sent: "dm" sends to approver DMs (default), "channel" sends to the originating Telegram chat/topic, and "both" sends to both. Channel delivery exposes the command text to the chat, so only use it in trusted groups/topics.',
      },
      "threadBindings.enabled": {
        label: "Telegram Thread Binding Enabled",
        help: "Enable Telegram conversation binding features (/focus, /unfocus, /agents, and /session idle|max-age). Overrides session.threadBindings.enabled when set.",
      },
      "threadBindings.idleHours": {
        label: "Telegram Thread Binding Idle Timeout (hours)",
        help: "Inactivity window in hours for Telegram bound sessions. Set 0 to disable idle auto-unfocus (default: 24). Overrides session.threadBindings.idleHours when set.",
      },
      "threadBindings.maxAgeHours": {
        label: "Telegram Thread Binding Max Age (hours)",
        help: "Optional hard max age in hours for Telegram bound sessions. Set 0 to disable hard cap (default: 0). Overrides session.threadBindings.maxAgeHours when set.",
      },
      "threadBindings.spawnSubagentSessions": {
        label: "Telegram Thread-Bound Subagent Spawn",
        help: "Allow subagent spawns with thread=true to auto-bind Telegram current conversations when supported.",
      },
      "threadBindings.spawnAcpSessions": {
        label: "Telegram Thread-Bound ACP Spawn",
        help: "Allow ACP spawns with thread=true to auto-bind Telegram current conversations when supported.",
      },
    },
  },
  {
    pluginId: "tlon",
    channelId: "tlon",
    label: "Tlon",
    description: "decentralized messaging on Urbit; install the plugin to enable.",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        name: {
          type: "string",
        },
        enabled: {
          type: "boolean",
        },
        ship: {
          type: "string",
          minLength: 1,
        },
        url: {
          type: "string",
        },
        code: {
          type: "string",
        },
        allowPrivateNetwork: {
          type: "boolean",
        },
        groupChannels: {
          type: "array",
          items: {
            type: "string",
            minLength: 1,
          },
        },
        dmAllowlist: {
          type: "array",
          items: {
            type: "string",
            minLength: 1,
          },
        },
        autoDiscoverChannels: {
          type: "boolean",
        },
        showModelSignature: {
          type: "boolean",
        },
        responsePrefix: {
          type: "string",
        },
        autoAcceptDmInvites: {
          type: "boolean",
        },
        autoAcceptGroupInvites: {
          type: "boolean",
        },
        ownerShip: {
          type: "string",
          minLength: 1,
        },
        authorization: {
          type: "object",
          properties: {
            channelRules: {
              type: "object",
              propertyNames: {
                type: "string",
              },
              additionalProperties: {
                type: "object",
                properties: {
                  mode: {
                    type: "string",
                    enum: ["restricted", "open"],
                  },
                  allowedShips: {
                    type: "array",
                    items: {
                      type: "string",
                      minLength: 1,
                    },
                  },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
        defaultAuthorizedShips: {
          type: "array",
          items: {
            type: "string",
            minLength: 1,
          },
        },
        accounts: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              enabled: {
                type: "boolean",
              },
              ship: {
                type: "string",
                minLength: 1,
              },
              url: {
                type: "string",
              },
              code: {
                type: "string",
              },
              allowPrivateNetwork: {
                type: "boolean",
              },
              groupChannels: {
                type: "array",
                items: {
                  type: "string",
                  minLength: 1,
                },
              },
              dmAllowlist: {
                type: "array",
                items: {
                  type: "string",
                  minLength: 1,
                },
              },
              autoDiscoverChannels: {
                type: "boolean",
              },
              showModelSignature: {
                type: "boolean",
              },
              responsePrefix: {
                type: "string",
              },
              autoAcceptDmInvites: {
                type: "boolean",
              },
              autoAcceptGroupInvites: {
                type: "boolean",
              },
              ownerShip: {
                type: "string",
                minLength: 1,
              },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    pluginId: "twitch",
    channelId: "twitch",
    label: "Twitch",
    description: "Twitch chat integration",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      anyOf: [
        {
          allOf: [
            {
              type: "object",
              properties: {
                name: {
                  type: "string",
                },
                enabled: {
                  type: "boolean",
                },
                markdown: {
                  type: "object",
                  properties: {
                    tables: {
                      type: "string",
                      enum: ["off", "bullets", "code"],
                    },
                  },
                  additionalProperties: false,
                },
              },
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                username: {
                  type: "string",
                },
                accessToken: {
                  type: "string",
                },
                clientId: {
                  type: "string",
                },
                channel: {
                  type: "string",
                  minLength: 1,
                },
                enabled: {
                  type: "boolean",
                },
                allowFrom: {
                  type: "array",
                  items: {
                    type: "string",
                  },
                },
                allowedRoles: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: ["moderator", "owner", "vip", "subscriber", "all"],
                  },
                },
                requireMention: {
                  type: "boolean",
                },
                responsePrefix: {
                  type: "string",
                },
                clientSecret: {
                  type: "string",
                },
                refreshToken: {
                  type: "string",
                },
                expiresIn: {
                  anyOf: [
                    {
                      type: "number",
                    },
                    {
                      type: "null",
                    },
                  ],
                },
                obtainmentTimestamp: {
                  type: "number",
                },
              },
              required: ["username", "accessToken", "channel"],
              additionalProperties: false,
            },
          ],
        },
        {
          allOf: [
            {
              type: "object",
              properties: {
                name: {
                  type: "string",
                },
                enabled: {
                  type: "boolean",
                },
                markdown: {
                  type: "object",
                  properties: {
                    tables: {
                      type: "string",
                      enum: ["off", "bullets", "code"],
                    },
                  },
                  additionalProperties: false,
                },
              },
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                accounts: {
                  type: "object",
                  propertyNames: {
                    type: "string",
                  },
                  additionalProperties: {
                    type: "object",
                    properties: {
                      username: {
                        type: "string",
                      },
                      accessToken: {
                        type: "string",
                      },
                      clientId: {
                        type: "string",
                      },
                      channel: {
                        type: "string",
                        minLength: 1,
                      },
                      enabled: {
                        type: "boolean",
                      },
                      allowFrom: {
                        type: "array",
                        items: {
                          type: "string",
                        },
                      },
                      allowedRoles: {
                        type: "array",
                        items: {
                          type: "string",
                          enum: ["moderator", "owner", "vip", "subscriber", "all"],
                        },
                      },
                      requireMention: {
                        type: "boolean",
                      },
                      responsePrefix: {
                        type: "string",
                      },
                      clientSecret: {
                        type: "string",
                      },
                      refreshToken: {
                        type: "string",
                      },
                      expiresIn: {
                        anyOf: [
                          {
                            type: "number",
                          },
                          {
                            type: "null",
                          },
                        ],
                      },
                      obtainmentTimestamp: {
                        type: "number",
                      },
                    },
                    required: ["username", "accessToken", "channel"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["accounts"],
              additionalProperties: false,
            },
          ],
        },
      ],
    },
  },
  {
    pluginId: "whatsapp",
    channelId: "whatsapp",
    label: "WhatsApp",
    description: "works with your own number; recommend a separate phone + eSIM.",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
        },
        capabilities: {
          type: "array",
          items: {
            type: "string",
          },
        },
        markdown: {
          type: "object",
          properties: {
            tables: {
              type: "string",
              enum: ["off", "bullets", "code"],
            },
          },
          additionalProperties: true,
        },
        configWrites: {
          type: "boolean",
        },
        sendReadReceipts: {
          type: "boolean",
        },
        messagePrefix: {
          type: "string",
        },
        responsePrefix: {
          type: "string",
        },
        dmPolicy: {
          default: "pairing",
          type: "string",
          enum: ["pairing", "allowlist", "open", "disabled"],
        },
        selfChatMode: {
          type: "boolean",
        },
        allowFrom: {
          type: "array",
          items: {
            type: "string",
          },
        },
        defaultTo: {
          type: "string",
        },
        groupAllowFrom: {
          type: "array",
          items: {
            type: "string",
          },
        },
        groupPolicy: {
          default: "allowlist",
          type: "string",
          enum: ["open", "disabled", "allowlist"],
        },
        historyLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dmHistoryLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        dms: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
            },
            additionalProperties: true,
          },
        },
        textChunkLimit: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        chunkMode: {
          type: "string",
          enum: ["length", "newline"],
        },
        blockStreaming: {
          type: "boolean",
        },
        blockStreamingCoalesce: {
          type: "object",
          properties: {
            minChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            maxChars: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
            },
            idleMs: {
              type: "integer",
              minimum: 0,
              maximum: 9007199254740991,
            },
          },
          additionalProperties: true,
        },
        groups: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              requireMention: {
                type: "boolean",
              },
              tools: {
                type: "object",
                properties: {
                  allow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  alsoAllow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  deny: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },
                additionalProperties: true,
              },
              toolsBySender: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    allow: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    alsoAllow: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                    deny: {
                      type: "array",
                      items: {
                        type: "string",
                      },
                    },
                  },
                  additionalProperties: true,
                },
              },
              gateMode: {
                type: "string",
                enum: ["blocked", "silent", "frank-only", "allowlist", "mention", "open"],
              },
            },
            additionalProperties: true,
          },
        },
        ackReaction: {
          type: "object",
          properties: {
            emoji: {
              type: "string",
            },
            direct: {
              default: true,
              type: "boolean",
            },
            group: {
              default: "mentions",
              type: "string",
              enum: ["always", "mentions", "never"],
            },
          },
          required: ["direct", "group"],
          additionalProperties: true,
        },
        debounceMs: {
          default: 0,
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        heartbeat: {
          type: "object",
          properties: {
            showOk: {
              type: "boolean",
            },
            showAlerts: {
              type: "boolean",
            },
            useIndicator: {
              type: "boolean",
            },
          },
          additionalProperties: true,
        },
        healthMonitor: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
            },
          },
          additionalProperties: true,
        },
        accounts: {
          type: "object",
          propertyNames: {
            type: "string",
          },
          additionalProperties: {
            type: "object",
            properties: {
              enabled: {
                type: "boolean",
              },
              capabilities: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              markdown: {
                type: "object",
                properties: {
                  tables: {
                    type: "string",
                    enum: ["off", "bullets", "code"],
                  },
                },
                additionalProperties: true,
              },
              configWrites: {
                type: "boolean",
              },
              sendReadReceipts: {
                type: "boolean",
              },
              messagePrefix: {
                type: "string",
              },
              responsePrefix: {
                type: "string",
              },
              dmPolicy: {
                default: "pairing",
                type: "string",
                enum: ["pairing", "allowlist", "open", "disabled"],
              },
              selfChatMode: {
                type: "boolean",
              },
              allowFrom: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              defaultTo: {
                type: "string",
              },
              groupAllowFrom: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              groupPolicy: {
                default: "allowlist",
                type: "string",
                enum: ["open", "disabled", "allowlist"],
              },
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dmHistoryLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              dms: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    historyLimit: {
                      type: "integer",
                      minimum: 0,
                      maximum: 9007199254740991,
                    },
                  },
                  additionalProperties: true,
                },
              },
              textChunkLimit: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              chunkMode: {
                type: "string",
                enum: ["length", "newline"],
              },
              blockStreaming: {
                type: "boolean",
              },
              blockStreamingCoalesce: {
                type: "object",
                properties: {
                  minChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  maxChars: {
                    type: "integer",
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                  },
                  idleMs: {
                    type: "integer",
                    minimum: 0,
                    maximum: 9007199254740991,
                  },
                },
                additionalProperties: true,
              },
              groups: {
                type: "object",
                propertyNames: {
                  type: "string",
                },
                additionalProperties: {
                  type: "object",
                  properties: {
                    requireMention: {
                      type: "boolean",
                    },
                    tools: {
                      type: "object",
                      properties: {
                        allow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        alsoAllow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        deny: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                      },
                      additionalProperties: true,
                    },
                    toolsBySender: {
                      type: "object",
                      propertyNames: {
                        type: "string",
                      },
                      additionalProperties: {
                        type: "object",
                        properties: {
                          allow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          alsoAllow: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                          deny: {
                            type: "array",
                            items: {
                              type: "string",
                            },
                          },
                        },
                        additionalProperties: true,
                      },
                    },
                    gateMode: {
                      type: "string",
                      enum: ["blocked", "silent", "frank-only", "allowlist", "mention", "open"],
                    },
                  },
                  additionalProperties: true,
                },
              },
              ackReaction: {
                type: "object",
                properties: {
                  emoji: {
                    type: "string",
                  },
                  direct: {
                    default: true,
                    type: "boolean",
                  },
                  group: {
                    default: "mentions",
                    type: "string",
                    enum: ["always", "mentions", "never"],
                  },
                },
                required: ["direct", "group"],
                additionalProperties: true,
              },
              debounceMs: {
                default: 0,
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              heartbeat: {
                type: "object",
                properties: {
                  showOk: {
                    type: "boolean",
                  },
                  showAlerts: {
                    type: "boolean",
                  },
                  useIndicator: {
                    type: "boolean",
                  },
                },
                additionalProperties: true,
              },
              healthMonitor: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                },
                additionalProperties: true,
              },
              name: {
                type: "string",
              },
              authDir: {
                type: "string",
              },
              mediaMaxMb: {
                type: "integer",
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
            },
            required: ["dmPolicy", "groupPolicy", "debounceMs"],
            additionalProperties: true,
          },
        },
        defaultAccount: {
          type: "string",
        },
        mediaMaxMb: {
          default: 50,
          type: "integer",
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
        },
        actions: {
          type: "object",
          properties: {
            reactions: {
              type: "boolean",
            },
            sendMessage: {
              type: "boolean",
            },
            polls: {
              type: "boolean",
            },
          },
          additionalProperties: true,
        },
      },
      required: ["dmPolicy", "groupPolicy", "debounceMs", "mediaMaxMb"],
      additionalProperties: true,
    },
    uiHints: {
      "": {
        label: "WhatsApp",
        help: "WhatsApp channel provider configuration for access policy and message batching behavior. Use this section to tune responsiveness and direct-message routing safety for WhatsApp chats.",
      },
      dmPolicy: {
        label: "WhatsApp DM Policy",
        help: 'Direct message access control ("pairing" recommended). "open" requires channels.whatsapp.allowFrom=["*"].',
      },
      selfChatMode: {
        label: "WhatsApp Self-Phone Mode",
        help: "Same-phone setup (bot uses your personal WhatsApp number).",
      },
      debounceMs: {
        label: "WhatsApp Message Debounce (ms)",
        help: "Debounce window (ms) for batching rapid consecutive messages from the same sender (0 to disable).",
      },
      configWrites: {
        label: "WhatsApp Config Writes",
        help: "Allow WhatsApp to write config in response to channel events/commands (default: true).",
      },
    },
  },
  {
    pluginId: "zalo",
    channelId: "zalo",
    label: "Zalo",
    description: "Vietnam-focused messaging platform with Bot API.",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        name: {
          type: "string",
        },
        enabled: {
          type: "boolean",
        },
        markdown: {
          type: "object",
          properties: {
            tables: {
              type: "string",
              enum: ["off", "bullets", "code"],
            },
          },
          additionalProperties: false,
        },
        botToken: {
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
              ],
            },
          ],
        },
        tokenFile: {
          type: "string",
        },
        webhookUrl: {
          type: "string",
        },
        webhookSecret: {
          anyOf: [
            {
              type: "string",
            },
            {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "env",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                      pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "file",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    source: {
                      type: "string",
                      const: "exec",
                    },
                    provider: {
                      type: "string",
                      pattern: "^[a-z][a-z0-9_-]{0,63}$",
                    },
                    id: {
                      type: "string",
                    },
                  },
                  required: ["source", "provider", "id"],
                  additionalProperties: false,
                },
              ],
            },
          ],
        },
        webhookPath: {
          type: "string",
        },
        dmPolicy: {
          type: "string",
          enum: ["pairing", "allowlist", "open", "disabled"],
        },
        allowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        groupPolicy: {
          type: "string",
          enum: ["open", "disabled", "allowlist"],
        },
        groupAllowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        mediaMaxMb: {
          type: "number",
        },
        proxy: {
          type: "string",
        },
        responsePrefix: {
          type: "string",
        },
        accounts: {
          type: "object",
          properties: {},
          additionalProperties: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              enabled: {
                type: "boolean",
              },
              markdown: {
                type: "object",
                properties: {
                  tables: {
                    type: "string",
                    enum: ["off", "bullets", "code"],
                  },
                },
                additionalProperties: false,
              },
              botToken: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "env",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                            pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "file",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "exec",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                    ],
                  },
                ],
              },
              tokenFile: {
                type: "string",
              },
              webhookUrl: {
                type: "string",
              },
              webhookSecret: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "env",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                            pattern: "^[A-Z][A-Z0-9_]{0,127}$",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "file",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          source: {
                            type: "string",
                            const: "exec",
                          },
                          provider: {
                            type: "string",
                            pattern: "^[a-z][a-z0-9_-]{0,63}$",
                          },
                          id: {
                            type: "string",
                          },
                        },
                        required: ["source", "provider", "id"],
                        additionalProperties: false,
                      },
                    ],
                  },
                ],
              },
              webhookPath: {
                type: "string",
              },
              dmPolicy: {
                type: "string",
                enum: ["pairing", "allowlist", "open", "disabled"],
              },
              allowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              groupPolicy: {
                type: "string",
                enum: ["open", "disabled", "allowlist"],
              },
              groupAllowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              mediaMaxMb: {
                type: "number",
              },
              proxy: {
                type: "string",
              },
              responsePrefix: {
                type: "string",
              },
            },
            additionalProperties: false,
          },
        },
        defaultAccount: {
          type: "string",
        },
      },
      additionalProperties: false,
    },
  },
  {
    pluginId: "zalouser",
    channelId: "zalouser",
    label: "Zalo Personal",
    description: "Zalo personal account via QR code login.",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        name: {
          type: "string",
        },
        enabled: {
          type: "boolean",
        },
        markdown: {
          type: "object",
          properties: {
            tables: {
              type: "string",
              enum: ["off", "bullets", "code"],
            },
          },
          additionalProperties: false,
        },
        profile: {
          type: "string",
        },
        dangerouslyAllowNameMatching: {
          type: "boolean",
        },
        dmPolicy: {
          type: "string",
          enum: ["pairing", "allowlist", "open", "disabled"],
        },
        allowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        historyLimit: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
        },
        groupAllowFrom: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string",
              },
              {
                type: "number",
              },
            ],
          },
        },
        groupPolicy: {
          default: "allowlist",
          type: "string",
          enum: ["open", "disabled", "allowlist"],
        },
        groups: {
          type: "object",
          properties: {},
          additionalProperties: {
            type: "object",
            properties: {
              allow: {
                type: "boolean",
              },
              enabled: {
                type: "boolean",
              },
              requireMention: {
                type: "boolean",
              },
              tools: {
                type: "object",
                properties: {
                  allow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  alsoAllow: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                  deny: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
        },
        messagePrefix: {
          type: "string",
        },
        responsePrefix: {
          type: "string",
        },
        accounts: {
          type: "object",
          properties: {},
          additionalProperties: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              enabled: {
                type: "boolean",
              },
              markdown: {
                type: "object",
                properties: {
                  tables: {
                    type: "string",
                    enum: ["off", "bullets", "code"],
                  },
                },
                additionalProperties: false,
              },
              profile: {
                type: "string",
              },
              dangerouslyAllowNameMatching: {
                type: "boolean",
              },
              dmPolicy: {
                type: "string",
                enum: ["pairing", "allowlist", "open", "disabled"],
              },
              allowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              historyLimit: {
                type: "integer",
                minimum: 0,
                maximum: 9007199254740991,
              },
              groupAllowFrom: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "number",
                    },
                  ],
                },
              },
              groupPolicy: {
                default: "allowlist",
                type: "string",
                enum: ["open", "disabled", "allowlist"],
              },
              groups: {
                type: "object",
                properties: {},
                additionalProperties: {
                  type: "object",
                  properties: {
                    allow: {
                      type: "boolean",
                    },
                    enabled: {
                      type: "boolean",
                    },
                    requireMention: {
                      type: "boolean",
                    },
                    tools: {
                      type: "object",
                      properties: {
                        allow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        alsoAllow: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                        deny: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                        },
                      },
                      additionalProperties: false,
                    },
                  },
                  additionalProperties: false,
                },
              },
              messagePrefix: {
                type: "string",
              },
              responsePrefix: {
                type: "string",
              },
            },
            required: ["groupPolicy"],
            additionalProperties: false,
          },
        },
        defaultAccount: {
          type: "string",
        },
      },
      required: ["groupPolicy"],
      additionalProperties: false,
    },
  },
];

// src/config/legacy-web-search.ts
var NON_MIGRATED_LEGACY_WEB_SEARCH_PROVIDER_IDS = /* @__PURE__ */ new Set(["tavily"]);
var LEGACY_WEB_SEARCH_PROVIDER_PLUGIN_IDS = Object.fromEntries(
  Object.entries(BUNDLED_WEB_SEARCH_PROVIDER_PLUGIN_IDS).filter(
    ([providerId]) => !NON_MIGRATED_LEGACY_WEB_SEARCH_PROVIDER_IDS.has(providerId),
  ),
);
var LEGACY_WEB_SEARCH_PROVIDER_IDS = Object.keys(LEGACY_WEB_SEARCH_PROVIDER_PLUGIN_IDS);
var LEGACY_WEB_SEARCH_PROVIDER_ID_SET = new Set(LEGACY_WEB_SEARCH_PROVIDER_IDS);

// src/plugin-sdk/facade-runtime.ts
import fs12 from "node:fs";
import path18 from "node:path";
import { fileURLToPath as fileURLToPath6 } from "node:url";
// src/agents/pi-embedded-runner/moonshot-thinking-stream-wrappers.ts
import { streamSimple } from "@mariozechner/pi-ai";
import { createJiti as createJiti2 } from "jiti";
var OPENCLAW_PACKAGE_ROOT2 =
  resolveLoaderPackageRoot({
    modulePath: fileURLToPath6(import.meta.url),
    moduleUrl: import.meta.url,
  }) ?? fileURLToPath6(new URL("../..", import.meta.url));
var CURRENT_MODULE_PATH2 = fileURLToPath6(import.meta.url);
var PUBLIC_SURFACE_SOURCE_EXTENSIONS2 = [".ts", ".mts", ".js", ".mjs", ".cts", ".cjs"];
var jitiLoaders2 = /* @__PURE__ */ new Map();
var loadedFacadeModules = /* @__PURE__ */ new Map();
function resolveSourceFirstPublicSurfacePath(params) {
  const sourceBaseName = params.artifactBasename.replace(/\.js$/u, "");
  const sourceRoot =
    params.bundledPluginsDir ?? path18.resolve(OPENCLAW_PACKAGE_ROOT2, "extensions");
  for (const ext of PUBLIC_SURFACE_SOURCE_EXTENSIONS2) {
    const candidate = path18.resolve(sourceRoot, params.dirName, `${sourceBaseName}${ext}`);
    if (fs12.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
function resolveFacadeModuleLocation(params) {
  const bundledPluginsDir = resolveBundledPluginsDir();
  const preferSource = !CURRENT_MODULE_PATH2.includes(`${path18.sep}dist${path18.sep}`);
  if (preferSource) {
    const modulePath2 =
      resolveSourceFirstPublicSurfacePath({
        ...params,
        ...(bundledPluginsDir ? { bundledPluginsDir } : {}),
      }) ??
      resolveSourceFirstPublicSurfacePath(params) ??
      resolveBundledPluginPublicSurfacePath({
        rootDir: OPENCLAW_PACKAGE_ROOT2,
        ...(bundledPluginsDir ? { bundledPluginsDir } : {}),
        dirName: params.dirName,
        artifactBasename: params.artifactBasename,
      });
    if (!modulePath2) {
      return null;
    }
    return {
      modulePath: modulePath2,
      boundaryRoot:
        bundledPluginsDir && modulePath2.startsWith(path18.resolve(bundledPluginsDir) + path18.sep)
          ? path18.resolve(bundledPluginsDir)
          : OPENCLAW_PACKAGE_ROOT2,
    };
  }
  const modulePath = resolveBundledPluginPublicSurfacePath({
    rootDir: OPENCLAW_PACKAGE_ROOT2,
    ...(bundledPluginsDir ? { bundledPluginsDir } : {}),
    dirName: params.dirName,
    artifactBasename: params.artifactBasename,
  });
  if (!modulePath) {
    return null;
  }
  return {
    modulePath,
    boundaryRoot:
      bundledPluginsDir && modulePath.startsWith(path18.resolve(bundledPluginsDir) + path18.sep)
        ? path18.resolve(bundledPluginsDir)
        : OPENCLAW_PACKAGE_ROOT2,
  };
}
function getJiti2(modulePath) {
  const tryNative =
    shouldPreferNativeJiti(modulePath) || modulePath.includes(`${path18.sep}dist${path18.sep}`);
  const aliasMap = buildPluginLoaderAliasMap(modulePath, process.argv[1], import.meta.url);
  const cacheKey = JSON.stringify({
    tryNative,
    aliasMap: Object.entries(aliasMap).toSorted(([left], [right]) => left.localeCompare(right)),
  });
  const cached = jitiLoaders2.get(cacheKey);
  if (cached) {
    return cached;
  }
  const loader = createJiti2(import.meta.url, {
    ...buildPluginLoaderJitiOptions(aliasMap),
    tryNative,
  });
  jitiLoaders2.set(cacheKey, loader);
  return loader;
}
function loadBundledPluginPublicSurfaceModuleSync(params) {
  const location = resolveFacadeModuleLocation(params);
  if (!location) {
    throw new Error(
      `Unable to resolve bundled plugin public surface ${params.dirName}/${params.artifactBasename}`,
    );
  }
  const cached = loadedFacadeModules.get(location.modulePath);
  if (cached) {
    return cached;
  }
  const opened = openBoundaryFileSync({
    absolutePath: location.modulePath,
    rootPath: location.boundaryRoot,
    boundaryLabel:
      location.boundaryRoot === OPENCLAW_PACKAGE_ROOT2
        ? "OpenClaw package root"
        : "bundled plugin directory",
    rejectHardlinks: false,
  });
  if (!opened.ok) {
    throw new Error(
      `Unable to open bundled plugin public surface ${params.dirName}/${params.artifactBasename}`,
      { cause: opened.error },
    );
  }
  fs12.closeSync(opened.fd);
  const sentinel = {};
  loadedFacadeModules.set(location.modulePath, sentinel);
  let loaded;
  try {
    loaded = getJiti2(location.modulePath)(location.modulePath);
    Object.assign(sentinel, loaded);
  } catch (err) {
    loadedFacadeModules.delete(location.modulePath);
    throw err;
  }
  return sentinel;
}

// src/plugin-sdk/google.ts
function loadFacadeModule() {
  return loadBundledPluginPublicSurfaceModuleSync({
    dirName: "google",
    artifactBasename: "api.js",
  });
}
var DEFAULT_GOOGLE_API_BASE_URL = loadFacadeModule()["DEFAULT_GOOGLE_API_BASE_URL"];
var GOOGLE_GEMINI_DEFAULT_MODEL = loadFacadeModule()["GOOGLE_GEMINI_DEFAULT_MODEL"];

// src/plugin-sdk/xai.ts
function loadFacadeModule2() {
  return loadBundledPluginPublicSurfaceModuleSync({
    dirName: "xai",
    artifactBasename: "api.js",
  });
}
var HTML_ENTITY_TOOL_CALL_ARGUMENTS_ENCODING =
  loadFacadeModule2()["HTML_ENTITY_TOOL_CALL_ARGUMENTS_ENCODING"];
var XAI_BASE_URL = loadFacadeModule2()["XAI_BASE_URL"];
var XAI_DEFAULT_CONTEXT_WINDOW = loadFacadeModule2()["XAI_DEFAULT_CONTEXT_WINDOW"];
var XAI_DEFAULT_MODEL_ID = loadFacadeModule2()["XAI_DEFAULT_MODEL_ID"];
var XAI_DEFAULT_MODEL_REF = loadFacadeModule2()["XAI_DEFAULT_MODEL_REF"];
var XAI_DEFAULT_MAX_TOKENS = loadFacadeModule2()["XAI_DEFAULT_MAX_TOKENS"];
var XAI_TOOL_SCHEMA_PROFILE = loadFacadeModule2()["XAI_TOOL_SCHEMA_PROFILE"];

// src/agents/provider-model-normalization.runtime.ts
import { createRequire as createRequire3 } from "node:module";
var require3 = createRequire3(import.meta.url);

// src/infra/exec-safe-bin-policy-profiles.ts
var NO_FLAGS = /* @__PURE__ */ new Set();
var toFlagSet = (flags) => {
  if (!flags || flags.length === 0) {
    return NO_FLAGS;
  }
  return new Set(flags);
};
function collectKnownLongFlags(allowedValueFlags, deniedFlags) {
  const known = /* @__PURE__ */ new Set();
  for (const flag of allowedValueFlags) {
    if (flag.startsWith("--")) {
      known.add(flag);
    }
  }
  for (const flag of deniedFlags) {
    if (flag.startsWith("--")) {
      known.add(flag);
    }
  }
  return Array.from(known);
}
function buildLongFlagPrefixMap(knownLongFlags) {
  const prefixMap = /* @__PURE__ */ new Map();
  for (const flag of knownLongFlags) {
    if (!flag.startsWith("--") || flag.length <= 2) {
      continue;
    }
    for (let length = 3; length <= flag.length; length += 1) {
      const prefix = flag.slice(0, length);
      const existing = prefixMap.get(prefix);
      if (existing === void 0) {
        prefixMap.set(prefix, flag);
        continue;
      }
      if (existing !== flag) {
        prefixMap.set(prefix, null);
      }
    }
  }
  return prefixMap;
}
function compileSafeBinProfile(fixture) {
  const allowedValueFlags = toFlagSet(fixture.allowedValueFlags);
  const deniedFlags = toFlagSet(fixture.deniedFlags);
  const knownLongFlags = collectKnownLongFlags(allowedValueFlags, deniedFlags);
  return {
    minPositional: fixture.minPositional,
    maxPositional: fixture.maxPositional,
    allowedValueFlags,
    deniedFlags,
    knownLongFlags,
    knownLongFlagsSet: new Set(knownLongFlags),
    longFlagPrefixMap: buildLongFlagPrefixMap(knownLongFlags),
  };
}
function compileSafeBinProfiles(fixtures) {
  return Object.fromEntries(
    Object.entries(fixtures).map(([name, fixture]) => [name, compileSafeBinProfile(fixture)]),
  );
}
var SAFE_BIN_PROFILE_FIXTURES = {
  jq: {
    maxPositional: 1,
    allowedValueFlags: ["--arg", "--argjson", "--argstr"],
    deniedFlags: [
      "--argfile",
      "--rawfile",
      "--slurpfile",
      "--from-file",
      "--library-path",
      "-L",
      "-f",
    ],
  },
  grep: {
    // Keep grep stdin-only: pattern must come from -e/--regexp.
    // Allowing one positional is ambiguous because -e consumes the pattern and
    // frees the positional slot for a filename.
    maxPositional: 0,
    allowedValueFlags: [
      "--regexp",
      "--max-count",
      "--after-context",
      "--before-context",
      "--context",
      "--devices",
      "--binary-files",
      "--exclude",
      "--include",
      "--label",
      "-e",
      "-m",
      "-A",
      "-B",
      "-C",
      "-D",
    ],
    deniedFlags: [
      "--file",
      "--exclude-from",
      "--dereference-recursive",
      "--directories",
      "--recursive",
      "-f",
      "-d",
      "-r",
      "-R",
    ],
  },
  cut: {
    maxPositional: 0,
    allowedValueFlags: [
      "--bytes",
      "--characters",
      "--fields",
      "--delimiter",
      "--output-delimiter",
      "-b",
      "-c",
      "-f",
      "-d",
    ],
  },
  sort: {
    maxPositional: 0,
    allowedValueFlags: [
      "--key",
      "--field-separator",
      "--buffer-size",
      "--parallel",
      "--batch-size",
      "-k",
      "-t",
      "-S",
    ],
    // --compress-program can invoke an external executable and breaks stdin-only guarantees.
    // --random-source/--temporary-directory/-T are filesystem-dependent and not stdin-only.
    deniedFlags: [
      "--compress-program",
      "--files0-from",
      "--output",
      "--random-source",
      "--temporary-directory",
      "-T",
      "-o",
    ],
  },
  uniq: {
    maxPositional: 0,
    allowedValueFlags: [
      "--skip-fields",
      "--skip-chars",
      "--check-chars",
      "--group",
      "-f",
      "-s",
      "-w",
    ],
  },
  head: {
    maxPositional: 0,
    allowedValueFlags: ["--lines", "--bytes", "-n", "-c"],
  },
  tail: {
    maxPositional: 0,
    allowedValueFlags: [
      "--lines",
      "--bytes",
      "--sleep-interval",
      "--max-unchanged-stats",
      "--pid",
      "-n",
      "-c",
    ],
  },
  tr: {
    minPositional: 1,
    maxPositional: 2,
  },
  wc: {
    maxPositional: 0,
    deniedFlags: ["--files0-from"],
  },
};
var SAFE_BIN_PROFILES = compileSafeBinProfiles(SAFE_BIN_PROFILE_FIXTURES);

// src/infra/dispatch-wrapper-resolution.ts
var ENV_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set([
  "-u",
  "--unset",
  "-c",
  "--chdir",
  "-s",
  "--split-string",
  "--default-signal",
  "--ignore-signal",
  "--block-signal",
]);
var ENV_INLINE_VALUE_PREFIXES = [
  "-u",
  "-c",
  "-s",
  "--unset=",
  "--chdir=",
  "--split-string=",
  "--default-signal=",
  "--ignore-signal=",
  "--block-signal=",
];
var ENV_FLAG_OPTIONS = /* @__PURE__ */ new Set(["-i", "--ignore-environment", "-0", "--null"]);
var NICE_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set(["-n", "--adjustment", "--priority"]);
var STDBUF_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set([
  "-i",
  "--input",
  "-o",
  "--output",
  "-e",
  "--error",
]);
var TIME_FLAG_OPTIONS = /* @__PURE__ */ new Set([
  "-a",
  "--append",
  "-h",
  "--help",
  "-l",
  "-p",
  "-q",
  "--quiet",
  "-v",
  "--verbose",
  "-V",
  "--version",
]);
var TIME_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set(["-f", "--format", "-o", "--output"]);
var BSD_SCRIPT_FLAG_OPTIONS = /* @__PURE__ */ new Set(["-a", "-d", "-k", "-p", "-q", "-r"]);
var BSD_SCRIPT_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set(["-F", "-t"]);
var TIMEOUT_FLAG_OPTIONS = /* @__PURE__ */ new Set([
  "--foreground",
  "--preserve-status",
  "-v",
  "--verbose",
]);
var TIMEOUT_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set(["-k", "--kill-after", "-s", "--signal"]);
function withWindowsExeAliases(names) {
  const expanded = /* @__PURE__ */ new Set();
  for (const name of names) {
    expanded.add(name);
    expanded.add(`${name}.exe`);
  }
  return Array.from(expanded);
}
function isEnvAssignment(token) {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}
function hasEnvInlineValuePrefix(lower) {
  for (const prefix of ENV_INLINE_VALUE_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}
function scanWrapperInvocation(argv, params) {
  let idx = 1;
  let expectsOptionValue = false;
  while (idx < argv.length) {
    const token = argv[idx]?.trim() ?? "";
    if (!token) {
      idx += 1;
      continue;
    }
    if (expectsOptionValue) {
      expectsOptionValue = false;
      idx += 1;
      continue;
    }
    if (params.separators?.has(token)) {
      idx += 1;
      break;
    }
    const directive = params.onToken(token, token.toLowerCase());
    if (directive === "stop") {
      break;
    }
    if (directive === "invalid") {
      return null;
    }
    if (directive === "consume-next") {
      expectsOptionValue = true;
    }
    idx += 1;
  }
  if (expectsOptionValue) {
    return null;
  }
  const commandIndex = params.adjustCommandIndex ? params.adjustCommandIndex(idx, argv) : idx;
  if (commandIndex === null || commandIndex >= argv.length) {
    return null;
  }
  return argv.slice(commandIndex);
}
function unwrapEnvInvocation(argv) {
  return scanWrapperInvocation(argv, {
    separators: /* @__PURE__ */ new Set(["--", "-"]),
    onToken: (token, lower) => {
      if (isEnvAssignment(token)) {
        return "continue";
      }
      if (!token.startsWith("-") || token === "-") {
        return "stop";
      }
      const [flag] = lower.split("=", 2);
      if (ENV_FLAG_OPTIONS.has(flag)) {
        return "continue";
      }
      if (ENV_OPTIONS_WITH_VALUE.has(flag)) {
        return lower.includes("=") ? "continue" : "consume-next";
      }
      if (hasEnvInlineValuePrefix(lower)) {
        return "continue";
      }
      return "invalid";
    },
  });
}
function envInvocationUsesModifiers(argv) {
  let idx = 1;
  let expectsOptionValue = false;
  while (idx < argv.length) {
    const token = argv[idx]?.trim() ?? "";
    if (!token) {
      idx += 1;
      continue;
    }
    if (expectsOptionValue) {
      return true;
    }
    if (token === "--" || token === "-") {
      idx += 1;
      break;
    }
    if (isEnvAssignment(token)) {
      return true;
    }
    if (!token.startsWith("-") || token === "-") {
      break;
    }
    const lower = token.toLowerCase();
    const [flag] = lower.split("=", 2);
    if (ENV_FLAG_OPTIONS.has(flag)) {
      return true;
    }
    if (ENV_OPTIONS_WITH_VALUE.has(flag)) {
      if (lower.includes("=")) {
        return true;
      }
      expectsOptionValue = true;
      idx += 1;
      continue;
    }
    if (hasEnvInlineValuePrefix(lower)) {
      return true;
    }
    return true;
  }
  return false;
}
function unwrapDashOptionInvocation(argv, params) {
  return scanWrapperInvocation(argv, {
    separators: /* @__PURE__ */ new Set(["--"]),
    onToken: (token, lower) => {
      if (!token.startsWith("-") || token === "-") {
        return "stop";
      }
      const [flag] = lower.split("=", 2);
      return params.onFlag(flag, lower);
    },
    adjustCommandIndex: params.adjustCommandIndex,
  });
}
function unwrapNiceInvocation(argv) {
  return unwrapDashOptionInvocation(argv, {
    onFlag: (flag, lower) => {
      if (/^-\d+$/.test(lower)) {
        return "continue";
      }
      if (NICE_OPTIONS_WITH_VALUE.has(flag)) {
        return lower.includes("=") || lower !== flag ? "continue" : "consume-next";
      }
      if (lower.startsWith("-n") && lower.length > 2) {
        return "continue";
      }
      return "invalid";
    },
  });
}
function unwrapNohupInvocation(argv) {
  return scanWrapperInvocation(argv, {
    separators: /* @__PURE__ */ new Set(["--"]),
    onToken: (token, lower) => {
      if (!token.startsWith("-") || token === "-") {
        return "stop";
      }
      return lower === "--help" || lower === "--version" ? "continue" : "invalid";
    },
  });
}
function unwrapStdbufInvocation(argv) {
  return unwrapDashOptionInvocation(argv, {
    onFlag: (flag, lower) => {
      if (!STDBUF_OPTIONS_WITH_VALUE.has(flag)) {
        return "invalid";
      }
      return lower.includes("=") ? "continue" : "consume-next";
    },
  });
}
function unwrapTimeInvocation(argv) {
  return unwrapDashOptionInvocation(argv, {
    onFlag: (flag, lower) => {
      if (TIME_FLAG_OPTIONS.has(flag)) {
        return "continue";
      }
      if (TIME_OPTIONS_WITH_VALUE.has(flag)) {
        return lower.includes("=") ? "continue" : "consume-next";
      }
      return "invalid";
    },
  });
}
function supportsScriptPositionalCommand(platform = process.platform) {
  return platform === "darwin" || platform === "freebsd";
}
function unwrapScriptInvocation(argv) {
  if (!supportsScriptPositionalCommand()) {
    return null;
  }
  return scanWrapperInvocation(argv, {
    separators: /* @__PURE__ */ new Set(["--"]),
    onToken: (token, lower) => {
      if (!lower.startsWith("-") || lower === "-") {
        return "stop";
      }
      const [flag] = token.split("=", 2);
      if (BSD_SCRIPT_OPTIONS_WITH_VALUE.has(flag)) {
        return token.includes("=") ? "continue" : "consume-next";
      }
      if (BSD_SCRIPT_FLAG_OPTIONS.has(flag)) {
        return "continue";
      }
      return "invalid";
    },
    adjustCommandIndex: (commandIndex, currentArgv) => {
      let sawTranscript = false;
      for (let idx = commandIndex; idx < currentArgv.length; idx += 1) {
        const token = currentArgv[idx]?.trim() ?? "";
        if (!token) {
          continue;
        }
        if (!sawTranscript) {
          sawTranscript = true;
          continue;
        }
        return idx;
      }
      return null;
    },
  });
}
function unwrapTimeoutInvocation(argv) {
  return unwrapDashOptionInvocation(argv, {
    onFlag: (flag, lower) => {
      if (TIMEOUT_FLAG_OPTIONS.has(flag)) {
        return "continue";
      }
      if (TIMEOUT_OPTIONS_WITH_VALUE.has(flag)) {
        return lower.includes("=") ? "continue" : "consume-next";
      }
      return "invalid";
    },
    adjustCommandIndex: (commandIndex, currentArgv) => {
      const wrappedCommandIndex = commandIndex + 1;
      return wrappedCommandIndex < currentArgv.length ? wrappedCommandIndex : null;
    },
  });
}
var DISPATCH_WRAPPER_SPECS = [
  { name: "chrt" },
  { name: "doas" },
  {
    name: "env",
    unwrap: unwrapEnvInvocation,
    transparentUsage: (argv) => !envInvocationUsesModifiers(argv),
  },
  { name: "ionice" },
  { name: "nice", unwrap: unwrapNiceInvocation, transparentUsage: true },
  { name: "nohup", unwrap: unwrapNohupInvocation, transparentUsage: true },
  { name: "script", unwrap: unwrapScriptInvocation, transparentUsage: true },
  { name: "setsid" },
  { name: "stdbuf", unwrap: unwrapStdbufInvocation, transparentUsage: true },
  { name: "sudo" },
  { name: "taskset" },
  { name: "time", unwrap: unwrapTimeInvocation, transparentUsage: true },
  { name: "timeout", unwrap: unwrapTimeoutInvocation, transparentUsage: true },
];
var DISPATCH_WRAPPER_SPEC_BY_NAME = new Map(
  DISPATCH_WRAPPER_SPECS.map((spec) => [spec.name, spec]),
);
var DISPATCH_WRAPPER_EXECUTABLES = new Set(
  withWindowsExeAliases(DISPATCH_WRAPPER_SPECS.map((spec) => spec.name)),
);

// src/infra/shell-wrapper-resolution.ts
var POSIX_SHELL_WRAPPER_NAMES = ["ash", "bash", "dash", "fish", "ksh", "sh", "zsh"];
var WINDOWS_CMD_WRAPPER_NAMES = ["cmd"];
var POWERSHELL_WRAPPER_NAMES = ["powershell", "pwsh"];
var SHELL_MULTIPLEXER_WRAPPER_NAMES = ["busybox", "toybox"];
function withWindowsExeAliases2(names) {
  const expanded = /* @__PURE__ */ new Set();
  for (const name of names) {
    expanded.add(name);
    expanded.add(`${name}.exe`);
  }
  return Array.from(expanded);
}
var POSIX_SHELL_WRAPPERS = new Set(POSIX_SHELL_WRAPPER_NAMES);
var WINDOWS_CMD_WRAPPERS = new Set(withWindowsExeAliases2(WINDOWS_CMD_WRAPPER_NAMES));
var POWERSHELL_WRAPPERS = new Set(withWindowsExeAliases2(POWERSHELL_WRAPPER_NAMES));
var POSIX_SHELL_WRAPPER_CANONICAL = new Set(POSIX_SHELL_WRAPPER_NAMES);
var WINDOWS_CMD_WRAPPER_CANONICAL = new Set(WINDOWS_CMD_WRAPPER_NAMES);
var POWERSHELL_WRAPPER_CANONICAL = new Set(POWERSHELL_WRAPPER_NAMES);
var SHELL_MULTIPLEXER_WRAPPER_CANONICAL = new Set(SHELL_MULTIPLEXER_WRAPPER_NAMES);
var SHELL_WRAPPER_CANONICAL = /* @__PURE__ */ new Set([
  ...POSIX_SHELL_WRAPPER_NAMES,
  ...WINDOWS_CMD_WRAPPER_NAMES,
  ...POWERSHELL_WRAPPER_NAMES,
]);

// src/config/zod-schema.ts
import { z as z18 } from "zod";

// src/cli/parse-bytes.ts
var UNIT_MULTIPLIERS = {
  b: 1,
  kb: 1024,
  k: 1024,
  mb: 1024 ** 2,
  m: 1024 ** 2,
  gb: 1024 ** 3,
  g: 1024 ** 3,
  tb: 1024 ** 4,
  t: 1024 ** 4,
};
function parseByteSize(raw, opts) {
  const trimmed = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!trimmed) {
    throw new Error("invalid byte size (empty)");
  }
  const m = /^(\d+(?:\.\d+)?)([a-z]+)?$/.exec(trimmed);
  if (!m) {
    throw new Error(`invalid byte size: ${raw}`);
  }
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid byte size: ${raw}`);
  }
  const unit = (m[2] ?? opts?.defaultUnit ?? "b").toLowerCase();
  const multiplier = UNIT_MULTIPLIERS[unit];
  if (!multiplier) {
    throw new Error(`invalid byte size unit: ${raw}`);
  }
  const bytes = Math.round(value * multiplier);
  if (!Number.isFinite(bytes)) {
    throw new Error(`invalid byte size: ${raw}`);
  }
  return bytes;
}

// src/config/zod-schema.agent-runtime.ts
import { z as z6 } from "zod";

// src/agents/sandbox/network-mode.ts
function normalizeNetworkMode(network) {
  const normalized = network?.trim().toLowerCase();
  return normalized || void 0;
}
function getBlockedNetworkModeReason(params) {
  const normalized = normalizeNetworkMode(params.network);
  if (!normalized) {
    return null;
  }
  if (normalized === "host") {
    return "host";
  }
  if (normalized.startsWith("container:") && params.allowContainerNamespaceJoin !== true) {
    return "container_namespace_join";
  }
  return null;
}

// src/config/zod-schema.agent-model.ts
import { z as z5 } from "zod";
var AgentModelSchema = z5.union([
  z5.string(),
  z5
    .object({
      primary: z5.string().optional(),
      fallbacks: z5.array(z5.string()).optional(),
    })
    .strict(),
]);

// src/config/zod-schema.agent-runtime.ts
var HeartbeatSchema = z6
  .object({
    every: z6.string().optional(),
    activeHours: z6
      .object({
        start: z6.string().optional(),
        end: z6.string().optional(),
        timezone: z6.string().optional(),
      })
      .strict()
      .optional(),
    model: z6.string().optional(),
    session: z6.string().optional(),
    includeReasoning: z6.boolean().optional(),
    target: z6.string().optional(),
    directPolicy: z6.union([z6.literal("allow"), z6.literal("block")]).optional(),
    to: z6.string().optional(),
    accountId: z6.string().optional(),
    prompt: z6.string().optional(),
    ackMaxChars: z6.number().int().nonnegative().optional(),
    suppressToolErrorWarnings: z6.boolean().optional(),
    lightContext: z6.boolean().optional(),
    isolatedSession: z6.boolean().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (!val.every) {
      return;
    }
    try {
      parseDurationMs(val.every, { defaultUnit: "m" });
    } catch {
      ctx.addIssue({
        code: z6.ZodIssueCode.custom,
        path: ["every"],
        message: "invalid duration (use ms, s, m, h)",
      });
    }
    const active = val.activeHours;
    if (!active) {
      return;
    }
    const timePattern = /^([01]\d|2[0-3]|24):([0-5]\d)$/;
    const validateTime = (raw, opts, path23) => {
      if (!raw) {
        return;
      }
      if (!timePattern.test(raw)) {
        ctx.addIssue({
          code: z6.ZodIssueCode.custom,
          path: ["activeHours", path23],
          message: 'invalid time (use "HH:MM" 24h format)',
        });
        return;
      }
      const [hourStr, minuteStr] = raw.split(":");
      const hour = Number(hourStr);
      const minute = Number(minuteStr);
      if (hour === 24 && minute !== 0) {
        ctx.addIssue({
          code: z6.ZodIssueCode.custom,
          path: ["activeHours", path23],
          message: "invalid time (24:00 is the only allowed 24:xx value)",
        });
        return;
      }
      if (hour === 24 && !opts.allow24) {
        ctx.addIssue({
          code: z6.ZodIssueCode.custom,
          path: ["activeHours", path23],
          message: "invalid time (start cannot be 24:00)",
        });
      }
    };
    validateTime(active.start, { allow24: false }, "start");
    validateTime(active.end, { allow24: true }, "end");
  })
  .optional();
var SandboxDockerSchema = z6
  .object({
    image: z6.string().optional(),
    containerPrefix: z6.string().optional(),
    workdir: z6.string().optional(),
    readOnlyRoot: z6.boolean().optional(),
    tmpfs: z6.array(z6.string()).optional(),
    network: z6.string().optional(),
    user: z6.string().optional(),
    capDrop: z6.array(z6.string()).optional(),
    env: z6.record(z6.string(), z6.string()).optional(),
    setupCommand: z6
      .union([z6.string(), z6.array(z6.string())])
      .transform((value) => (Array.isArray(value) ? value.join("\n") : value))
      .optional(),
    pidsLimit: z6.number().int().positive().optional(),
    memory: z6.union([z6.string(), z6.number()]).optional(),
    memorySwap: z6.union([z6.string(), z6.number()]).optional(),
    cpus: z6.number().positive().optional(),
    ulimits: z6
      .record(
        z6.string(),
        z6.union([
          z6.string(),
          z6.number(),
          z6
            .object({
              soft: z6.number().int().nonnegative().optional(),
              hard: z6.number().int().nonnegative().optional(),
            })
            .strict(),
        ]),
      )
      .optional(),
    seccompProfile: z6.string().optional(),
    apparmorProfile: z6.string().optional(),
    dns: z6.array(z6.string()).optional(),
    extraHosts: z6.array(z6.string()).optional(),
    binds: z6.array(z6.string()).optional(),
    dangerouslyAllowReservedContainerTargets: z6.boolean().optional(),
    dangerouslyAllowExternalBindSources: z6.boolean().optional(),
    dangerouslyAllowContainerNamespaceJoin: z6.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.binds) {
      for (let i = 0; i < data.binds.length; i += 1) {
        const bind = data.binds[i]?.trim() ?? "";
        if (!bind) {
          ctx.addIssue({
            code: z6.ZodIssueCode.custom,
            path: ["binds", i],
            message: "Sandbox security: bind mount entry must be a non-empty string.",
          });
          continue;
        }
        const firstColon = bind.indexOf(":");
        const source = (firstColon <= 0 ? bind : bind.slice(0, firstColon)).trim();
        if (!source.startsWith("/")) {
          ctx.addIssue({
            code: z6.ZodIssueCode.custom,
            path: ["binds", i],
            message: `Sandbox security: bind mount "${bind}" uses a non-absolute source path "${source}". Only absolute POSIX paths are supported for sandbox binds.`,
          });
        }
      }
    }
    const blockedNetworkReason = getBlockedNetworkModeReason({
      network: data.network,
      allowContainerNamespaceJoin: data.dangerouslyAllowContainerNamespaceJoin === true,
    });
    if (blockedNetworkReason === "host") {
      ctx.addIssue({
        code: z6.ZodIssueCode.custom,
        path: ["network"],
        message:
          'Sandbox security: network mode "host" is blocked. Use "bridge" or "none" instead.',
      });
    }
    if (blockedNetworkReason === "container_namespace_join") {
      ctx.addIssue({
        code: z6.ZodIssueCode.custom,
        path: ["network"],
        message:
          'Sandbox security: network mode "container:*" is blocked by default. Use a custom bridge network, or set dangerouslyAllowContainerNamespaceJoin=true only when you fully trust this runtime.',
      });
    }
    if (data.seccompProfile?.trim().toLowerCase() === "unconfined") {
      ctx.addIssue({
        code: z6.ZodIssueCode.custom,
        path: ["seccompProfile"],
        message:
          'Sandbox security: seccomp profile "unconfined" is blocked. Use a custom seccomp profile file or omit this setting.',
      });
    }
    if (data.apparmorProfile?.trim().toLowerCase() === "unconfined") {
      ctx.addIssue({
        code: z6.ZodIssueCode.custom,
        path: ["apparmorProfile"],
        message:
          'Sandbox security: apparmor profile "unconfined" is blocked. Use a named AppArmor profile or omit this setting.',
      });
    }
  })
  .optional();
var SandboxBrowserSchema = z6
  .object({
    enabled: z6.boolean().optional(),
    image: z6.string().optional(),
    containerPrefix: z6.string().optional(),
    network: z6.string().optional(),
    cdpPort: z6.number().int().positive().optional(),
    cdpSourceRange: z6.string().optional(),
    vncPort: z6.number().int().positive().optional(),
    noVncPort: z6.number().int().positive().optional(),
    headless: z6.boolean().optional(),
    enableNoVnc: z6.boolean().optional(),
    allowHostControl: z6.boolean().optional(),
    autoStart: z6.boolean().optional(),
    autoStartTimeoutMs: z6.number().int().positive().optional(),
    binds: z6.array(z6.string()).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.network?.trim().toLowerCase() === "host") {
      ctx.addIssue({
        code: z6.ZodIssueCode.custom,
        path: ["network"],
        message:
          'Sandbox security: browser network mode "host" is blocked. Use "bridge" or a custom bridge network instead.',
      });
    }
  })
  .strict()
  .optional();
var SandboxPruneSchema = z6
  .object({
    idleHours: z6.number().int().nonnegative().optional(),
    maxAgeDays: z6.number().int().nonnegative().optional(),
  })
  .strict()
  .optional();
var ToolPolicyBaseSchema = z6
  .object({
    allow: z6.array(z6.string()).optional(),
    alsoAllow: z6.array(z6.string()).optional(),
    deny: z6.array(z6.string()).optional(),
  })
  .strict();
var ToolPolicySchema = ToolPolicyBaseSchema.superRefine((value, ctx) => {
  if (value.allow && value.allow.length > 0 && value.alsoAllow && value.alsoAllow.length > 0) {
    ctx.addIssue({
      code: z6.ZodIssueCode.custom,
      message:
        "tools policy cannot set both allow and alsoAllow in the same scope (merge alsoAllow into allow, or remove allow and use profile + alsoAllow)",
    });
  }
}).optional();
var ToolsWebSearchSchema = z6
  .object({
    enabled: z6.boolean().optional(),
    provider: z6.string().optional(),
    maxResults: z6.number().int().positive().optional(),
    timeoutSeconds: z6.number().int().positive().optional(),
    cacheTtlMinutes: z6.number().nonnegative().optional(),
    apiKey: SecretInputSchema.optional().register(sensitive),
    brave: z6
      .object({
        apiKey: SecretInputSchema.optional().register(sensitive),
        baseUrl: z6.string().optional(),
        model: z6.string().optional(),
        mode: z6.string().optional(),
      })
      .strict()
      .optional(),
    firecrawl: z6
      .object({
        apiKey: SecretInputSchema.optional().register(sensitive),
        baseUrl: z6.string().optional(),
        model: z6.string().optional(),
      })
      .strict()
      .optional(),
    gemini: z6
      .object({
        apiKey: SecretInputSchema.optional().register(sensitive),
        baseUrl: z6.string().optional(),
        model: z6.string().optional(),
      })
      .strict()
      .optional(),
    grok: z6
      .object({
        apiKey: SecretInputSchema.optional().register(sensitive),
        baseUrl: z6.string().optional(),
        model: z6.string().optional(),
        inlineCitations: z6.boolean().optional(),
      })
      .strict()
      .optional(),
    kimi: z6
      .object({
        apiKey: SecretInputSchema.optional().register(sensitive),
        baseUrl: z6.string().optional(),
        model: z6.string().optional(),
      })
      .strict()
      .optional(),
    perplexity: z6
      .object({
        apiKey: SecretInputSchema.optional().register(sensitive),
        baseUrl: z6.string().optional(),
        model: z6.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();
var ToolsWebFetchSchema = z6
  .object({
    enabled: z6.boolean().optional(),
    maxChars: z6.number().int().positive().optional(),
    maxCharsCap: z6.number().int().positive().optional(),
    maxResponseBytes: z6.number().int().positive().optional(),
    timeoutSeconds: z6.number().int().positive().optional(),
    cacheTtlMinutes: z6.number().nonnegative().optional(),
    maxRedirects: z6.number().int().nonnegative().optional(),
    userAgent: z6.string().optional(),
    readability: z6.boolean().optional(),
    firecrawl: z6
      .object({
        enabled: z6.boolean().optional(),
        apiKey: SecretInputSchema.optional().register(sensitive),
        baseUrl: z6.string().optional(),
        onlyMainContent: z6.boolean().optional(),
        maxAgeMs: z6.number().int().nonnegative().optional(),
        timeoutSeconds: z6.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();
var ToolsWebXSearchSchema = z6
  .object({
    enabled: z6.boolean().optional(),
    apiKey: SecretInputSchema.optional().register(sensitive),
    model: z6.string().optional(),
    inlineCitations: z6.boolean().optional(),
    maxTurns: z6.number().int().optional(),
    timeoutSeconds: z6.number().int().positive().optional(),
    cacheTtlMinutes: z6.number().nonnegative().optional(),
  })
  .strict()
  .optional();
var ToolsWebSchema = z6
  .object({
    search: ToolsWebSearchSchema,
    fetch: ToolsWebFetchSchema,
    x_search: ToolsWebXSearchSchema,
  })
  .strict()
  .optional();
var ToolProfileSchema = z6
  .union([z6.literal("minimal"), z6.literal("coding"), z6.literal("messaging"), z6.literal("full")])
  .optional();
function addAllowAlsoAllowConflictIssue(value, ctx, message) {
  if (value.allow && value.allow.length > 0 && value.alsoAllow && value.alsoAllow.length > 0) {
    ctx.addIssue({
      code: z6.ZodIssueCode.custom,
      message,
    });
  }
}
var ToolPolicyWithProfileSchema = z6
  .object({
    allow: z6.array(z6.string()).optional(),
    alsoAllow: z6.array(z6.string()).optional(),
    deny: z6.array(z6.string()).optional(),
    profile: ToolProfileSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    addAllowAlsoAllowConflictIssue(
      value,
      ctx,
      "tools.byProvider policy cannot set both allow and alsoAllow in the same scope (merge alsoAllow into allow, or remove allow and use profile + alsoAllow)",
    );
  });
var ElevatedAllowFromSchema = z6
  .record(z6.string(), z6.array(z6.union([z6.string(), z6.number()])))
  .optional();
var ToolExecApplyPatchSchema = z6
  .object({
    enabled: z6.boolean().optional(),
    workspaceOnly: z6.boolean().optional(),
    allowModels: z6.array(z6.string()).optional(),
  })
  .strict()
  .optional();
var ToolExecSafeBinProfileSchema = z6
  .object({
    minPositional: z6.number().int().nonnegative().optional(),
    maxPositional: z6.number().int().nonnegative().optional(),
    allowedValueFlags: z6.array(z6.string()).optional(),
    deniedFlags: z6.array(z6.string()).optional(),
  })
  .strict();
var ToolExecBaseShape = {
  host: z6.enum(["auto", "sandbox", "gateway", "node"]).optional(),
  security: z6.enum(["deny", "allowlist", "full"]).optional(),
  ask: z6.enum(["off", "on-miss", "always"]).optional(),
  node: z6.string().optional(),
  pathPrepend: z6.array(z6.string()).optional(),
  safeBins: z6.array(z6.string()).optional(),
  strictInlineEval: z6.boolean().optional(),
  safeBinTrustedDirs: z6.array(z6.string()).optional(),
  safeBinProfiles: z6.record(z6.string(), ToolExecSafeBinProfileSchema).optional(),
  backgroundMs: z6.number().int().positive().optional(),
  timeoutSec: z6.number().int().positive().optional(),
  cleanupMs: z6.number().int().positive().optional(),
  notifyOnExit: z6.boolean().optional(),
  notifyOnExitEmptySuccess: z6.boolean().optional(),
  applyPatch: ToolExecApplyPatchSchema,
};
var AgentToolExecSchema = z6
  .object({
    ...ToolExecBaseShape,
    approvalRunningNoticeMs: z6.number().int().nonnegative().optional(),
  })
  .strict()
  .optional();
var ToolExecSchema = z6.object(ToolExecBaseShape).strict().optional();
var ToolFsSchema = z6
  .object({
    workspaceOnly: z6.boolean().optional(),
  })
  .strict()
  .optional();
var ToolLoopDetectionDetectorSchema = z6
  .object({
    genericRepeat: z6.boolean().optional(),
    knownPollNoProgress: z6.boolean().optional(),
    pingPong: z6.boolean().optional(),
  })
  .strict()
  .optional();
var ToolLoopDetectionSchema = z6
  .object({
    enabled: z6.boolean().optional(),
    historySize: z6.number().int().positive().optional(),
    warningThreshold: z6.number().int().positive().optional(),
    criticalThreshold: z6.number().int().positive().optional(),
    globalCircuitBreakerThreshold: z6.number().int().positive().optional(),
    detectors: ToolLoopDetectionDetectorSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.warningThreshold !== void 0 &&
      value.criticalThreshold !== void 0 &&
      value.warningThreshold >= value.criticalThreshold
    ) {
      ctx.addIssue({
        code: z6.ZodIssueCode.custom,
        path: ["criticalThreshold"],
        message: "tools.loopDetection.warningThreshold must be lower than criticalThreshold.",
      });
    }
    if (
      value.criticalThreshold !== void 0 &&
      value.globalCircuitBreakerThreshold !== void 0 &&
      value.criticalThreshold >= value.globalCircuitBreakerThreshold
    ) {
      ctx.addIssue({
        code: z6.ZodIssueCode.custom,
        path: ["globalCircuitBreakerThreshold"],
        message:
          "tools.loopDetection.criticalThreshold must be lower than globalCircuitBreakerThreshold.",
      });
    }
  })
  .optional();
var SandboxSshSchema = z6
  .object({
    target: z6.string().min(1).optional(),
    command: z6.string().min(1).optional(),
    workspaceRoot: z6.string().min(1).optional(),
    strictHostKeyChecking: z6.boolean().optional(),
    updateHostKeys: z6.boolean().optional(),
    identityFile: z6.string().min(1).optional(),
    certificateFile: z6.string().min(1).optional(),
    knownHostsFile: z6.string().min(1).optional(),
    identityData: SecretInputSchema.optional().register(sensitive),
    certificateData: SecretInputSchema.optional().register(sensitive),
    knownHostsData: SecretInputSchema.optional().register(sensitive),
  })
  .strict()
  .optional();
var AgentSandboxSchema = z6
  .object({
    mode: z6.union([z6.literal("off"), z6.literal("non-main"), z6.literal("all")]).optional(),
    backend: z6.string().min(1).optional(),
    workspaceAccess: z6.union([z6.literal("none"), z6.literal("ro"), z6.literal("rw")]).optional(),
    sessionToolsVisibility: z6.union([z6.literal("spawned"), z6.literal("all")]).optional(),
    scope: z6.union([z6.literal("session"), z6.literal("agent"), z6.literal("shared")]).optional(),
    perSession: z6.boolean().optional(),
    workspaceRoot: z6.string().optional(),
    docker: SandboxDockerSchema,
    ssh: SandboxSshSchema,
    browser: SandboxBrowserSchema,
    prune: SandboxPruneSchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    const blockedBrowserNetworkReason = getBlockedNetworkModeReason({
      network: data.browser?.network,
      allowContainerNamespaceJoin: data.docker?.dangerouslyAllowContainerNamespaceJoin === true,
    });
    if (blockedBrowserNetworkReason === "container_namespace_join") {
      ctx.addIssue({
        code: z6.ZodIssueCode.custom,
        path: ["browser", "network"],
        message:
          'Sandbox security: browser network mode "container:*" is blocked by default. Set sandbox.docker.dangerouslyAllowContainerNamespaceJoin=true only when you fully trust this runtime.',
      });
    }
  })
  .optional();
var CommonToolPolicyFields = {
  profile: ToolProfileSchema,
  allow: z6.array(z6.string()).optional(),
  alsoAllow: z6.array(z6.string()).optional(),
  deny: z6.array(z6.string()).optional(),
  byProvider: z6.record(z6.string(), ToolPolicyWithProfileSchema).optional(),
};
var AgentToolsSchema = z6
  .object({
    ...CommonToolPolicyFields,
    elevated: z6
      .object({
        enabled: z6.boolean().optional(),
        allowFrom: ElevatedAllowFromSchema,
      })
      .strict()
      .optional(),
    exec: AgentToolExecSchema,
    fs: ToolFsSchema,
    loopDetection: ToolLoopDetectionSchema,
    sandbox: z6
      .object({
        tools: ToolPolicySchema,
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    addAllowAlsoAllowConflictIssue(
      value,
      ctx,
      "agent tools cannot set both allow and alsoAllow in the same scope (merge alsoAllow into allow, or remove allow and use profile + alsoAllow)",
    );
  })
  .optional();
var MemorySearchSchema = z6
  .object({
    enabled: z6.boolean().optional(),
    sources: z6.array(z6.union([z6.literal("memory"), z6.literal("sessions")])).optional(),
    extraPaths: z6.array(z6.string()).optional(),
    multimodal: z6
      .object({
        enabled: z6.boolean().optional(),
        modalities: z6
          .array(z6.union([z6.literal("image"), z6.literal("audio"), z6.literal("all")]))
          .optional(),
        maxFileBytes: z6.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    experimental: z6
      .object({
        sessionMemory: z6.boolean().optional(),
      })
      .strict()
      .optional(),
    provider: z6.string().optional(),
    remote: z6
      .object({
        baseUrl: z6.string().optional(),
        apiKey: SecretInputSchema.optional().register(sensitive),
        headers: z6.record(z6.string(), z6.string()).optional(),
        batch: z6
          .object({
            enabled: z6.boolean().optional(),
            wait: z6.boolean().optional(),
            concurrency: z6.number().int().positive().optional(),
            pollIntervalMs: z6.number().int().nonnegative().optional(),
            timeoutMinutes: z6.number().int().positive().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    fallback: z6.string().optional(),
    model: z6.string().optional(),
    outputDimensionality: z6.number().int().positive().optional(),
    local: z6
      .object({
        modelPath: z6.string().optional(),
        modelCacheDir: z6.string().optional(),
      })
      .strict()
      .optional(),
    store: z6
      .object({
        driver: z6.literal("sqlite").optional(),
        path: z6.string().optional(),
        fts: z6
          .object({
            tokenizer: z6.union([z6.literal("unicode61"), z6.literal("trigram")]).optional(),
          })
          .strict()
          .optional(),
        vector: z6
          .object({
            enabled: z6.boolean().optional(),
            extensionPath: z6.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    chunking: z6
      .object({
        tokens: z6.number().int().positive().optional(),
        overlap: z6.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    sync: z6
      .object({
        onSessionStart: z6.boolean().optional(),
        onSearch: z6.boolean().optional(),
        watch: z6.boolean().optional(),
        watchDebounceMs: z6.number().int().nonnegative().optional(),
        intervalMinutes: z6.number().int().nonnegative().optional(),
        sessions: z6
          .object({
            deltaBytes: z6.number().int().nonnegative().optional(),
            deltaMessages: z6.number().int().nonnegative().optional(),
            postCompactionForce: z6.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    query: z6
      .object({
        maxResults: z6.number().int().positive().optional(),
        minScore: z6.number().min(0).max(1).optional(),
        hybrid: z6
          .object({
            enabled: z6.boolean().optional(),
            vectorWeight: z6.number().min(0).max(1).optional(),
            textWeight: z6.number().min(0).max(1).optional(),
            candidateMultiplier: z6.number().int().positive().optional(),
            mmr: z6
              .object({
                enabled: z6.boolean().optional(),
                lambda: z6.number().min(0).max(1).optional(),
              })
              .strict()
              .optional(),
            temporalDecay: z6
              .object({
                enabled: z6.boolean().optional(),
                halfLifeDays: z6.number().int().positive().optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    cache: z6
      .object({
        enabled: z6.boolean().optional(),
        maxEntries: z6.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();
var AgentRuntimeAcpSchema = z6
  .object({
    agent: z6.string().optional(),
    backend: z6.string().optional(),
    mode: z6.enum(["persistent", "oneshot"]).optional(),
    cwd: z6.string().optional(),
  })
  .strict()
  .optional();
var AgentRuntimeSchema = z6
  .union([
    z6
      .object({
        type: z6.literal("embedded"),
      })
      .strict(),
    z6
      .object({
        type: z6.literal("acp"),
        acp: AgentRuntimeAcpSchema,
      })
      .strict(),
  ])
  .optional();
var AgentEntrySchema = z6
  .object({
    id: z6.string(),
    default: z6.boolean().optional(),
    name: z6.string().optional(),
    workspace: z6.string().optional(),
    agentDir: z6.string().optional(),
    model: AgentModelSchema.optional(),
    thinkingDefault: z6
      .enum(["off", "minimal", "low", "medium", "high", "xhigh", "adaptive"])
      .optional(),
    reasoningDefault: z6.enum(["on", "off", "stream"]).optional(),
    fastModeDefault: z6.boolean().optional(),
    skills: z6.array(z6.string()).optional(),
    memorySearch: MemorySearchSchema,
    humanDelay: HumanDelaySchema.optional(),
    heartbeat: HeartbeatSchema,
    identity: IdentitySchema,
    groupChat: GroupChatSchema,
    subagents: z6
      .object({
        allowAgents: z6.array(z6.string()).optional(),
        model: z6
          .union([
            z6.string(),
            z6
              .object({
                primary: z6.string().optional(),
                fallbacks: z6.array(z6.string()).optional(),
              })
              .strict(),
          ])
          .optional(),
        thinking: z6.string().optional(),
        requireAgentId: z6.boolean().optional(),
      })
      .strict()
      .optional(),
    sandbox: AgentSandboxSchema,
    params: z6.record(z6.string(), z6.unknown()).optional(),
    tools: AgentToolsSchema,
    runtime: AgentRuntimeSchema,
  })
  .strict();
var ToolsSchema = z6
  .object({
    ...CommonToolPolicyFields,
    web: ToolsWebSchema,
    media: ToolsMediaSchema,
    links: ToolsLinksSchema,
    sessions: z6
      .object({
        visibility: z6.enum(["self", "tree", "agent", "all"]).optional(),
      })
      .strict()
      .optional(),
    loopDetection: ToolLoopDetectionSchema,
    message: z6
      .object({
        allowCrossContextSend: z6.boolean().optional(),
        crossContext: z6
          .object({
            allowWithinProvider: z6.boolean().optional(),
            allowAcrossProviders: z6.boolean().optional(),
            marker: z6
              .object({
                enabled: z6.boolean().optional(),
                prefix: z6.string().optional(),
                suffix: z6.string().optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
        broadcast: z6
          .object({
            enabled: z6.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    agentToAgent: z6
      .object({
        enabled: z6.boolean().optional(),
        allow: z6.array(z6.string()).optional(),
      })
      .strict()
      .optional(),
    elevated: z6
      .object({
        enabled: z6.boolean().optional(),
        allowFrom: ElevatedAllowFromSchema,
      })
      .strict()
      .optional(),
    exec: ToolExecSchema,
    fs: ToolFsSchema,
    subagents: z6
      .object({
        tools: ToolPolicySchema,
      })
      .strict()
      .optional(),
    sandbox: z6
      .object({
        tools: ToolPolicySchema,
      })
      .strict()
      .optional(),
    sessions_spawn: z6
      .object({
        attachments: z6
          .object({
            enabled: z6.boolean().optional(),
            maxTotalBytes: z6.number().optional(),
            maxFiles: z6.number().optional(),
            maxFileBytes: z6.number().optional(),
            retainOnSessionKeep: z6.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    addAllowAlsoAllowConflictIssue(
      value,
      ctx,
      "tools cannot set both allow and alsoAllow in the same scope (merge alsoAllow into allow, or remove allow and use profile + alsoAllow)",
    );
  })
  .optional();

// src/config/zod-schema.agents.ts
import { z as z8 } from "zod";
// src/config/zod-schema.agent-defaults.ts
import { z as z7 } from "zod";

// src/config/byte-size.ts
function parseNonNegativeByteSize(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const int = Math.floor(value);
    return int >= 0 ? int : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const bytes = parseByteSize(trimmed, { defaultUnit: "b" });
      return bytes >= 0 ? bytes : null;
    } catch {
      return null;
    }
  }
  return null;
}
function isValidNonNegativeByteSizeString(value) {
  return parseNonNegativeByteSize(value) !== null;
}

// src/config/zod-schema.agent-defaults.ts
var AgentDefaultsSchema = z7
  .object({
    model: AgentModelSchema.optional(),
    imageModel: AgentModelSchema.optional(),
    imageGenerationModel: AgentModelSchema.optional(),
    pdfModel: AgentModelSchema.optional(),
    pdfMaxBytesMb: z7.number().positive().optional(),
    pdfMaxPages: z7.number().int().positive().optional(),
    models: z7
      .record(
        z7.string(),
        z7
          .object({
            alias: z7.string().optional(),
            /** Provider-specific API parameters (e.g., GLM-4.7 thinking mode). */
            params: z7.record(z7.string(), z7.unknown()).optional(),
            /** Enable streaming for this model (default: true, false for Ollama to avoid SDK issue #1205). */
            streaming: z7.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
    workspace: z7.string().optional(),
    repoRoot: z7.string().optional(),
    skipBootstrap: z7.boolean().optional(),
    bootstrapMaxChars: z7.number().int().positive().optional(),
    bootstrapTotalMaxChars: z7.number().int().positive().optional(),
    bootstrapPromptTruncationWarning: z7
      .union([z7.literal("off"), z7.literal("once"), z7.literal("always")])
      .optional(),
    userTimezone: z7.string().optional(),
    timeFormat: z7.union([z7.literal("auto"), z7.literal("12"), z7.literal("24")]).optional(),
    envelopeTimezone: z7.string().optional(),
    envelopeTimestamp: z7.union([z7.literal("on"), z7.literal("off")]).optional(),
    envelopeElapsed: z7.union([z7.literal("on"), z7.literal("off")]).optional(),
    contextTokens: z7.number().int().positive().optional(),
    cliBackends: z7.record(z7.string(), CliBackendSchema).optional(),
    memorySearch: MemorySearchSchema,
    contextPruning: z7
      .object({
        mode: z7.union([z7.literal("off"), z7.literal("cache-ttl")]).optional(),
        ttl: z7.string().optional(),
        keepLastAssistants: z7.number().int().nonnegative().optional(),
        softTrimRatio: z7.number().min(0).max(1).optional(),
        hardClearRatio: z7.number().min(0).max(1).optional(),
        minPrunableToolChars: z7.number().int().nonnegative().optional(),
        tools: z7
          .object({
            allow: z7.array(z7.string()).optional(),
            deny: z7.array(z7.string()).optional(),
          })
          .strict()
          .optional(),
        softTrim: z7
          .object({
            maxChars: z7.number().int().nonnegative().optional(),
            headChars: z7.number().int().nonnegative().optional(),
            tailChars: z7.number().int().nonnegative().optional(),
          })
          .strict()
          .optional(),
        hardClear: z7
          .object({
            enabled: z7.boolean().optional(),
            placeholder: z7.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    llm: z7
      .object({
        idleTimeoutSeconds: z7
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "Idle timeout for LLM streaming responses in seconds. If no token is received within this time, the request is aborted. Set to 0 to disable. Default: 60 seconds.",
          ),
      })
      .strict()
      .optional(),
    compaction: z7
      .object({
        mode: z7.union([z7.literal("default"), z7.literal("safeguard")]).optional(),
        reserveTokens: z7.number().int().nonnegative().optional(),
        keepRecentTokens: z7.number().int().positive().optional(),
        reserveTokensFloor: z7.number().int().nonnegative().optional(),
        maxHistoryShare: z7.number().min(0.1).max(0.9).optional(),
        customInstructions: z7.string().optional(),
        identifierPolicy: z7
          .union([z7.literal("strict"), z7.literal("off"), z7.literal("custom")])
          .optional(),
        identifierInstructions: z7.string().optional(),
        recentTurnsPreserve: z7.number().int().min(0).max(12).optional(),
        qualityGuard: z7
          .object({
            enabled: z7.boolean().optional(),
            maxRetries: z7.number().int().nonnegative().optional(),
          })
          .strict()
          .optional(),
        postIndexSync: z7.enum(["off", "async", "await"]).optional(),
        postCompactionSections: z7.array(z7.string()).optional(),
        model: z7.string().optional(),
        timeoutSeconds: z7.number().int().positive().optional(),
        memoryFlush: z7
          .object({
            enabled: z7.boolean().optional(),
            softThresholdTokens: z7.number().int().nonnegative().optional(),
            forceFlushTranscriptBytes: z7
              .union([
                z7.number().int().nonnegative(),
                z7
                  .string()
                  .refine(isValidNonNegativeByteSizeString, "Expected byte size string like 2mb"),
              ])
              .optional(),
            prompt: z7.string().optional(),
            systemPrompt: z7.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    embeddedPi: z7
      .object({
        projectSettingsPolicy: z7
          .union([z7.literal("trusted"), z7.literal("sanitize"), z7.literal("ignore")])
          .optional(),
      })
      .strict()
      .optional(),
    thinkingDefault: z7
      .union([
        z7.literal("off"),
        z7.literal("minimal"),
        z7.literal("low"),
        z7.literal("medium"),
        z7.literal("high"),
        z7.literal("xhigh"),
        z7.literal("adaptive"),
      ])
      .optional(),
    verboseDefault: z7.union([z7.literal("off"), z7.literal("on"), z7.literal("full")]).optional(),
    elevatedDefault: z7
      .union([z7.literal("off"), z7.literal("on"), z7.literal("ask"), z7.literal("full")])
      .optional(),
    blockStreamingDefault: z7.union([z7.literal("off"), z7.literal("on")]).optional(),
    blockStreamingBreak: z7.union([z7.literal("text_end"), z7.literal("message_end")]).optional(),
    blockStreamingChunk: BlockStreamingChunkSchema.optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
    humanDelay: HumanDelaySchema.optional(),
    timeoutSeconds: z7.number().int().positive().optional(),
    mediaMaxMb: z7.number().positive().optional(),
    imageMaxDimensionPx: z7.number().int().positive().optional(),
    typingIntervalSeconds: z7.number().int().positive().optional(),
    typingMode: TypingModeSchema.optional(),
    heartbeat: HeartbeatSchema,
    maxConcurrent: z7.number().int().positive().optional(),
    subagents: z7
      .object({
        maxConcurrent: z7.number().int().positive().optional(),
        maxSpawnDepth: z7
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe(
            "Maximum nesting depth for sub-agent spawning. 1 = no nesting (default), 2 = sub-agents can spawn sub-sub-agents.",
          ),
        maxChildrenPerAgent: z7
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe(
            "Maximum number of active children a single agent session can spawn (default: 5).",
          ),
        archiveAfterMinutes: z7.number().int().min(0).optional(),
        model: AgentModelSchema.optional(),
        thinking: z7.string().optional(),
        runTimeoutSeconds: z7.number().int().min(0).optional(),
        announceTimeoutMs: z7.number().int().positive().optional(),
        auth: z7.record(z7.string(), z7.unknown()).optional(),
        requireAgentId: z7.boolean().optional(),
      })
      .strict()
      .optional(),
    sandbox: AgentSandboxSchema,
    gateNotifyChannel: z7.string().optional(),
    gateNotifyOwner: z7.string().optional(),
    mentionKeywords: z7.array(z7.string()).optional(),
  })
  .strict()
  .optional();

// src/config/zod-schema.agents.ts
var AgentsSchema = z8
  .object({
    defaults: z8.lazy(() => AgentDefaultsSchema).optional(),
    list: z8.array(AgentEntrySchema).optional(),
  })
  .strict()
  .optional();
var BindingMatchSchema = z8
  .object({
    channel: z8.string(),
    accountId: z8.string().optional(),
    peer: z8
      .object({
        kind: z8.union([
          z8.literal("direct"),
          z8.literal("group"),
          z8.literal("channel"),
          /** @deprecated Use `direct` instead. Kept for backward compatibility. */
          z8.literal("dm"),
        ]),
        id: z8.string(),
      })
      .strict()
      .optional(),
    guildId: z8.string().optional(),
    teamId: z8.string().optional(),
    roles: z8.array(z8.string()).optional(),
  })
  .strict();
var RouteBindingSchema = z8
  .object({
    type: z8.literal("route").optional(),
    agentId: z8.string(),
    comment: z8.string().optional(),
    match: BindingMatchSchema,
  })
  .strict();
var AcpBindingSchema = z8
  .object({
    type: z8.literal("acp"),
    agentId: z8.string(),
    comment: z8.string().optional(),
    match: BindingMatchSchema,
    acp: z8
      .object({
        mode: z8.enum(["persistent", "oneshot"]).optional(),
        label: z8.string().optional(),
        cwd: z8.string().optional(),
        backend: z8.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const peerId = value.match.peer?.id?.trim() ?? "";
    if (!peerId) {
      ctx.addIssue({
        code: z8.ZodIssueCode.custom,
        path: ["match", "peer"],
        message: "ACP bindings require match.peer.id to target a concrete conversation.",
      });
      return;
    }
    const channel = value.match.channel.trim().toLowerCase();
    if (channel !== "discord" && channel !== "telegram" && channel !== "feishu") {
      ctx.addIssue({
        code: z8.ZodIssueCode.custom,
        path: ["match", "channel"],
        message:
          'ACP bindings currently support only "discord", "telegram", and "feishu" channels.',
      });
      return;
    }
    if (channel === "telegram" && !/^-\d+:topic:\d+$/.test(peerId)) {
      ctx.addIssue({
        code: z8.ZodIssueCode.custom,
        path: ["match", "peer", "id"],
        message:
          "Telegram ACP bindings require canonical topic IDs in the form -1001234567890:topic:42.",
      });
    }
    if (channel === "feishu") {
      const peerKind = value.match.peer?.kind;
      const isDirectId =
        (peerKind === "direct" || peerKind === "dm") &&
        /^[^:]+$/.test(peerId) &&
        !peerId.startsWith("oc_") &&
        !peerId.startsWith("on_");
      const isTopicId =
        peerKind === "group" && /^oc_[^:]+:topic:[^:]+(?::sender:ou_[^:]+)?$/.test(peerId);
      if (!isDirectId && !isTopicId) {
        ctx.addIssue({
          code: z8.ZodIssueCode.custom,
          path: ["match", "peer", "id"],
          message:
            "Feishu ACP bindings require direct peer IDs for DMs or topic IDs in the form oc_group:topic:om_root[:sender:ou_xxx].",
        });
      }
    }
  });
var BindingsSchema = z8.array(z8.union([RouteBindingSchema, AcpBindingSchema])).optional();
var BroadcastStrategySchema = z8.enum(["parallel", "sequential"]);
var BroadcastSchema = z8
  .object({
    strategy: BroadcastStrategySchema.optional(),
  })
  .catchall(z8.array(z8.string()))
  .optional();
var AudioSchema = z8
  .object({
    transcription: TranscribeAudioSchema,
  })
  .strict()
  .optional();

// src/config/zod-schema.approvals.ts
import { z as z9 } from "zod";
var ExecApprovalForwardTargetSchema = z9
  .object({
    channel: z9.string().min(1),
    to: z9.string().min(1),
    accountId: z9.string().optional(),
    threadId: z9.union([z9.string(), z9.number()]).optional(),
  })
  .strict();
var ExecApprovalForwardingSchema = z9
  .object({
    enabled: z9.boolean().optional(),
    mode: z9.union([z9.literal("session"), z9.literal("targets"), z9.literal("both")]).optional(),
    agentFilter: z9.array(z9.string()).optional(),
    sessionFilter: z9.array(z9.string()).optional(),
    targets: z9.array(ExecApprovalForwardTargetSchema).optional(),
  })
  .strict()
  .optional();
var ApprovalsSchema = z9
  .object({
    exec: ExecApprovalForwardingSchema,
    plugin: ExecApprovalForwardingSchema,
  })
  .strict()
  .optional();

// src/config/zod-schema.hooks.ts
import path19 from "node:path";
import { z as z11 } from "zod";
// src/config/zod-schema.installs.ts
import { z as z10 } from "zod";
var InstallSourceSchema = z10.union([
  z10.literal("npm"),
  z10.literal("archive"),
  z10.literal("path"),
  z10.literal("clawhub"),
]);
var PluginInstallSourceSchema = z10.union([InstallSourceSchema, z10.literal("marketplace")]);
var InstallRecordShape = {
  source: InstallSourceSchema,
  spec: z10.string().optional(),
  sourcePath: z10.string().optional(),
  installPath: z10.string().optional(),
  version: z10.string().optional(),
  resolvedName: z10.string().optional(),
  resolvedVersion: z10.string().optional(),
  resolvedSpec: z10.string().optional(),
  integrity: z10.string().optional(),
  shasum: z10.string().optional(),
  resolvedAt: z10.string().optional(),
  installedAt: z10.string().optional(),
  clawhubUrl: z10.string().optional(),
  clawhubPackage: z10.string().optional(),
  clawhubFamily: z10.union([z10.literal("code-plugin"), z10.literal("bundle-plugin")]).optional(),
  clawhubChannel: z10
    .union([z10.literal("official"), z10.literal("community"), z10.literal("private")])
    .optional(),
};
var PluginInstallRecordShape = {
  ...InstallRecordShape,
  source: PluginInstallSourceSchema,
  marketplaceName: z10.string().optional(),
  marketplaceSource: z10.string().optional(),
  marketplacePlugin: z10.string().optional(),
};

// src/config/zod-schema.hooks.ts
function isSafeRelativeModulePath(raw) {
  const value = raw.trim();
  if (!value) {
    return false;
  }
  if (path19.isAbsolute(value)) {
    return false;
  }
  if (value.startsWith("~")) {
    return false;
  }
  if (value.includes(":")) {
    return false;
  }
  const parts = value.split(/[\\/]+/g);
  if (parts.some((part) => part === "..")) {
    return false;
  }
  return true;
}
var SafeRelativeModulePathSchema = z11
  .string()
  .refine(isSafeRelativeModulePath, "module must be a safe relative path (no absolute paths)");
var HookMappingSchema = z11
  .object({
    id: z11.string().optional(),
    match: z11
      .object({
        path: z11.string().optional(),
        source: z11.string().optional(),
      })
      .optional(),
    action: z11.union([z11.literal("wake"), z11.literal("agent")]).optional(),
    wakeMode: z11.union([z11.literal("now"), z11.literal("next-heartbeat")]).optional(),
    name: z11.string().optional(),
    agentId: z11.string().optional(),
    sessionKey: z11.string().optional().register(sensitive),
    messageTemplate: z11.string().optional(),
    textTemplate: z11.string().optional(),
    deliver: z11.boolean().optional(),
    allowUnsafeExternalContent: z11.boolean().optional(),
    // Keep this open-ended so runtime channel plugins (for example feishu) can be
    // referenced without hard-coding every channel id in the config schema.
    // Runtime still validates the resolved value against currently registered channels.
    channel: z11.string().trim().min(1).optional(),
    to: z11.string().optional(),
    model: z11.string().optional(),
    thinking: z11.string().optional(),
    timeoutSeconds: z11.number().int().positive().optional(),
    transform: z11
      .object({
        module: SafeRelativeModulePathSchema,
        export: z11.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();
var InternalHookHandlerSchema = z11
  .object({
    event: z11.string(),
    module: SafeRelativeModulePathSchema,
    export: z11.string().optional(),
  })
  .strict();
var HookConfigSchema = z11
  .object({
    enabled: z11.boolean().optional(),
    env: z11.record(z11.string(), z11.string()).optional(),
  })
  .passthrough();
var HookInstallRecordSchema = z11
  .object({
    ...InstallRecordShape,
    hooks: z11.array(z11.string()).optional(),
  })
  .strict();
var InternalHooksSchema = z11
  .object({
    enabled: z11.boolean().optional(),
    handlers: z11.array(InternalHookHandlerSchema).optional(),
    entries: z11.record(z11.string(), HookConfigSchema).optional(),
    load: z11
      .object({
        extraDirs: z11.array(z11.string()).optional(),
      })
      .strict()
      .optional(),
    installs: z11.record(z11.string(), HookInstallRecordSchema).optional(),
  })
  .strict()
  .optional();
var HooksGmailSchema = z11
  .object({
    account: z11.string().optional(),
    label: z11.string().optional(),
    topic: z11.string().optional(),
    subscription: z11.string().optional(),
    pushToken: z11.string().optional().register(sensitive),
    hookUrl: z11.string().optional(),
    includeBody: z11.boolean().optional(),
    maxBytes: z11.number().int().positive().optional(),
    renewEveryMinutes: z11.number().int().positive().optional(),
    allowUnsafeExternalContent: z11.boolean().optional(),
    serve: z11
      .object({
        bind: z11.string().optional(),
        port: z11.number().int().positive().optional(),
        path: z11.string().optional(),
      })
      .strict()
      .optional(),
    tailscale: z11
      .object({
        mode: z11
          .union([z11.literal("off"), z11.literal("serve"), z11.literal("funnel")])
          .optional(),
        path: z11.string().optional(),
        target: z11.string().optional(),
      })
      .strict()
      .optional(),
    model: z11.string().optional(),
    thinking: z11
      .union([
        z11.literal("off"),
        z11.literal("minimal"),
        z11.literal("low"),
        z11.literal("medium"),
        z11.literal("high"),
      ])
      .optional(),
  })
  .strict()
  .optional();

// src/config/zod-schema.providers.ts
import { z as z16 } from "zod";
// src/config/zod-schema.channels.ts
import { z as z12 } from "zod";
var ChannelHeartbeatVisibilitySchema = z12
  .object({
    showOk: z12.boolean().optional(),
    showAlerts: z12.boolean().optional(),
    useIndicator: z12.boolean().optional(),
  })
  .strict()
  .optional();
var ChannelHealthMonitorSchema = z12
  .object({
    enabled: z12.boolean().optional(),
  })
  .strict()
  .optional();

// src/config/zod-schema.providers-core.ts
import { z as z14 } from "zod";

// src/infra/scp-host.ts
var SSH_TOKEN = /^[A-Za-z0-9._-]+$/;
var BRACKETED_IPV6 = /^\[[0-9A-Fa-f:.%]+\]$/;
var WHITESPACE = /\s/;
function hasControlOrWhitespace(value) {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127 || WHITESPACE.test(char)) {
      return true;
    }
  }
  return false;
}
function normalizeScpRemoteHost(value) {
  if (typeof value !== "string") {
    return void 0;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return void 0;
  }
  if (hasControlOrWhitespace(trimmed)) {
    return void 0;
  }
  if (trimmed.startsWith("-") || trimmed.includes("/") || trimmed.includes("\\")) {
    return void 0;
  }
  const firstAt = trimmed.indexOf("@");
  const lastAt = trimmed.lastIndexOf("@");
  let user;
  let host = trimmed;
  if (firstAt !== -1) {
    if (firstAt !== lastAt || firstAt === 0 || firstAt === trimmed.length - 1) {
      return void 0;
    }
    user = trimmed.slice(0, firstAt);
    host = trimmed.slice(firstAt + 1);
    if (!SSH_TOKEN.test(user)) {
      return void 0;
    }
  }
  if (!host || host.startsWith("-") || host.includes("@")) {
    return void 0;
  }
  if (host.includes(":") && !BRACKETED_IPV6.test(host)) {
    return void 0;
  }
  if (!SSH_TOKEN.test(host) && !BRACKETED_IPV6.test(host)) {
    return void 0;
  }
  return user ? `${user}@${host}` : host;
}
function isSafeScpRemoteHost(value) {
  return normalizeScpRemoteHost(value) !== void 0;
}

// src/media/inbound-path-policy.ts
import path20 from "node:path";
var WILDCARD_SEGMENT = "*";
var WINDOWS_DRIVE_ABS_RE = /^[A-Za-z]:\//;
var WINDOWS_DRIVE_ROOT_RE = /^[A-Za-z]:$/;
function normalizePosixAbsolutePath(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\0")) {
    return void 0;
  }
  const normalized = path20.posix.normalize(trimmed.replaceAll("\\", "/"));
  const isAbsolute = normalized.startsWith("/") || WINDOWS_DRIVE_ABS_RE.test(normalized);
  if (!isAbsolute || normalized === "/") {
    return void 0;
  }
  const withoutTrailingSlash = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  if (WINDOWS_DRIVE_ROOT_RE.test(withoutTrailingSlash)) {
    return void 0;
  }
  return withoutTrailingSlash;
}
function splitPathSegments(value) {
  return value.split("/").filter(Boolean);
}
function isValidInboundPathRootPattern(value) {
  const normalized = normalizePosixAbsolutePath(value);
  if (!normalized) {
    return false;
  }
  const segments = splitPathSegments(normalized);
  if (segments.length === 0) {
    return false;
  }
  return segments.every((segment) => segment === WILDCARD_SEGMENT || !segment.includes("*"));
}

// src/config/telegram-custom-commands.ts
var TELEGRAM_COMMAND_NAME_PATTERN = /^[a-z0-9_]{1,32}$/;
function normalizeTelegramCommandName(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const withoutSlash = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  return withoutSlash.trim().toLowerCase().replace(/-/g, "_");
}
function normalizeTelegramCommandDescription(value) {
  return value.trim();
}
function resolveTelegramCustomCommands(params) {
  const entries = Array.isArray(params.commands) ? params.commands : [];
  const reserved = params.reservedCommands ?? /* @__PURE__ */ new Set();
  const checkReserved = params.checkReserved !== false;
  const checkDuplicates = params.checkDuplicates !== false;
  const seen = /* @__PURE__ */ new Set();
  const resolved = [];
  const issues = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const normalized = normalizeTelegramCommandName(String(entry?.command ?? ""));
    if (!normalized) {
      issues.push({
        index,
        field: "command",
        message: "Telegram custom command is missing a command name.",
      });
      continue;
    }
    if (!TELEGRAM_COMMAND_NAME_PATTERN.test(normalized)) {
      issues.push({
        index,
        field: "command",
        message: `Telegram custom command "/${normalized}" is invalid (use a-z, 0-9, underscore; max 32 chars).`,
      });
      continue;
    }
    if (checkReserved && reserved.has(normalized)) {
      issues.push({
        index,
        field: "command",
        message: `Telegram custom command "/${normalized}" conflicts with a native command.`,
      });
      continue;
    }
    if (checkDuplicates && seen.has(normalized)) {
      issues.push({
        index,
        field: "command",
        message: `Telegram custom command "/${normalized}" is duplicated.`,
      });
      continue;
    }
    const description = normalizeTelegramCommandDescription(String(entry?.description ?? ""));
    if (!description) {
      issues.push({
        index,
        field: "description",
        message: `Telegram custom command "/${normalized}" is missing a description.`,
      });
      continue;
    }
    if (checkDuplicates) {
      seen.add(normalized);
    }
    resolved.push({ command: normalized, description });
  }
  return { commands: resolved, issues };
}

// src/config/zod-schema.secret-input-validation.ts
import { z as z13 } from "zod";
function forEachEnabledAccount(accounts, run) {
  if (!accounts) {
    return;
  }
  for (const [accountId, account] of Object.entries(accounts)) {
    if (!account || account.enabled === false) {
      continue;
    }
    run(accountId, account);
  }
}
function validateTelegramWebhookSecretRequirements(value, ctx) {
  const baseWebhookUrl = typeof value.webhookUrl === "string" ? value.webhookUrl.trim() : "";
  const hasBaseWebhookSecret = hasConfiguredSecretInput(value.webhookSecret);
  if (baseWebhookUrl && !hasBaseWebhookSecret) {
    ctx.addIssue({
      code: z13.ZodIssueCode.custom,
      message: "channels.telegram.webhookUrl requires channels.telegram.webhookSecret",
      path: ["webhookSecret"],
    });
  }
  forEachEnabledAccount(value.accounts, (accountId, account) => {
    const accountWebhookUrl =
      typeof account.webhookUrl === "string" ? account.webhookUrl.trim() : "";
    if (!accountWebhookUrl) {
      return;
    }
    const hasAccountSecret = hasConfiguredSecretInput(account.webhookSecret);
    if (!hasAccountSecret && !hasBaseWebhookSecret) {
      ctx.addIssue({
        code: z13.ZodIssueCode.custom,
        message:
          "channels.telegram.accounts.*.webhookUrl requires channels.telegram.webhookSecret or channels.telegram.accounts.*.webhookSecret",
        path: ["accounts", accountId, "webhookSecret"],
      });
    }
  });
}
function validateSlackSigningSecretRequirements(value, ctx) {
  const baseMode = value.mode === "http" || value.mode === "socket" ? value.mode : "socket";
  if (baseMode === "http" && !hasConfiguredSecretInput(value.signingSecret)) {
    ctx.addIssue({
      code: z13.ZodIssueCode.custom,
      message: 'channels.slack.mode="http" requires channels.slack.signingSecret',
      path: ["signingSecret"],
    });
  }
  forEachEnabledAccount(value.accounts, (accountId, account) => {
    const accountMode =
      account.mode === "http" || account.mode === "socket" ? account.mode : baseMode;
    if (accountMode !== "http") {
      return;
    }
    const accountSecret = account.signingSecret ?? value.signingSecret;
    if (!hasConfiguredSecretInput(accountSecret)) {
      ctx.addIssue({
        code: z13.ZodIssueCode.custom,
        message:
          'channels.slack.accounts.*.mode="http" requires channels.slack.signingSecret or channels.slack.accounts.*.signingSecret',
        path: ["accounts", accountId, "signingSecret"],
      });
    }
  });
}

// src/config/zod-schema.providers-core.ts
var ToolPolicyBySenderSchema = z14.record(z14.string(), ToolPolicySchema).optional();
var DiscordIdSchema = z14
  .union([z14.string(), z14.number()])
  .refine((value) => typeof value === "string", {
    message: "Discord IDs must be strings (wrap numeric IDs in quotes).",
  });
var DiscordIdListSchema = z14.array(DiscordIdSchema);
var TelegramInlineButtonsScopeSchema = z14.enum(["off", "dm", "group", "all", "allowlist"]);
var TelegramIdListSchema = z14.array(z14.union([z14.string(), z14.number()]));
var TelegramCapabilitiesSchema = z14.union([
  z14.array(z14.string()),
  z14
    .object({
      inlineButtons: TelegramInlineButtonsScopeSchema.optional(),
    })
    .strict(),
]);
var SlackCapabilitiesSchema = z14.union([
  z14.array(z14.string()),
  z14
    .object({
      interactiveReplies: z14.boolean().optional(),
    })
    .strict(),
]);
var GateModeSchema = z14
  .enum(["blocked", "silent", "frank-only", "allowlist", "mention", "open"])
  .optional();
var TelegramTopicSchema = z14
  .object({
    requireMention: z14.boolean().optional(),
    disableAudioPreflight: z14.boolean().optional(),
    groupPolicy: GroupPolicySchema.optional(),
    skills: z14.array(z14.string()).optional(),
    enabled: z14.boolean().optional(),
    allowFrom: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    systemPrompt: z14.string().optional(),
    agentId: z14.string().optional(),
    gateMode: GateModeSchema,
  })
  .strict();
var TelegramGroupSchema = z14
  .object({
    requireMention: z14.boolean().optional(),
    disableAudioPreflight: z14.boolean().optional(),
    groupPolicy: GroupPolicySchema.optional(),
    tools: ToolPolicySchema,
    toolsBySender: ToolPolicyBySenderSchema,
    skills: z14.array(z14.string()).optional(),
    enabled: z14.boolean().optional(),
    allowFrom: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    systemPrompt: z14.string().optional(),
    topics: z14.record(z14.string(), TelegramTopicSchema.optional()).optional(),
    gateMode: GateModeSchema,
  })
  .strict();
var AutoTopicLabelSchema = z14
  .union([
    z14.boolean(),
    z14
      .object({
        enabled: z14.boolean().optional(),
        prompt: z14.string().optional(),
      })
      .strict(),
  ])
  .optional();
var TelegramDirectSchema = z14
  .object({
    dmPolicy: DmPolicySchema.optional(),
    tools: ToolPolicySchema,
    toolsBySender: ToolPolicyBySenderSchema,
    skills: z14.array(z14.string()).optional(),
    enabled: z14.boolean().optional(),
    allowFrom: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    systemPrompt: z14.string().optional(),
    topics: z14.record(z14.string(), TelegramTopicSchema.optional()).optional(),
    requireTopic: z14.boolean().optional(),
    autoTopicLabel: AutoTopicLabelSchema,
  })
  .strict();
var TelegramCustomCommandSchema = z14
  .object({
    command: z14.string().overwrite(normalizeTelegramCommandName),
    description: z14.string().overwrite(normalizeTelegramCommandDescription),
  })
  .strict();
var validateTelegramCustomCommands = (value, ctx) => {
  if (!value.customCommands || value.customCommands.length === 0) {
    return;
  }
  const { issues } = resolveTelegramCustomCommands({
    commands: value.customCommands,
    checkReserved: false,
    checkDuplicates: false,
  });
  for (const issue of issues) {
    ctx.addIssue({
      code: z14.ZodIssueCode.custom,
      path: ["customCommands", issue.index, issue.field],
      message: issue.message,
    });
  }
};
function normalizeTelegramStreamingConfig(value) {
  value.streaming = resolveTelegramPreviewStreamMode(value);
  delete value.streamMode;
}
function normalizeDiscordStreamingConfig(value) {
  value.streaming = resolveDiscordPreviewStreamMode(value);
  delete value.streamMode;
}
function normalizeSlackStreamingConfig(value) {
  value.nativeStreaming = resolveSlackNativeStreaming(value);
  value.streaming = resolveSlackStreamingMode(value);
  delete value.streamMode;
}
var TelegramAccountSchemaBase = z14
  .object({
    name: z14.string().optional(),
    capabilities: TelegramCapabilitiesSchema.optional(),
    execApprovals: z14
      .object({
        enabled: z14.boolean().optional(),
        approvers: TelegramIdListSchema.optional(),
        agentFilter: z14.array(z14.string()).optional(),
        sessionFilter: z14.array(z14.string()).optional(),
        target: z14.enum(["dm", "channel", "both"]).optional(),
      })
      .strict()
      .optional(),
    markdown: MarkdownConfigSchema,
    enabled: z14.boolean().optional(),
    commands: ProviderCommandsSchema,
    customCommands: z14.array(TelegramCustomCommandSchema).optional(),
    configWrites: z14.boolean().optional(),
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    botToken: SecretInputSchema.optional().register(sensitive),
    tokenFile: z14.string().optional(),
    replyToMode: ReplyToModeSchema.optional(),
    groups: z14.record(z14.string(), TelegramGroupSchema.optional()).optional(),
    allowFrom: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    defaultTo: z14.union([z14.string(), z14.number()]).optional(),
    groupAllowFrom: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    historyLimit: z14.number().int().min(0).optional(),
    dmHistoryLimit: z14.number().int().min(0).optional(),
    dms: z14.record(z14.string(), DmConfigSchema.optional()).optional(),
    direct: z14.record(z14.string(), TelegramDirectSchema.optional()).optional(),
    textChunkLimit: z14.number().int().positive().optional(),
    chunkMode: z14.enum(["length", "newline"]).optional(),
    streaming: z14
      .union([z14.boolean(), z14.enum(["off", "partial", "block", "progress"])])
      .optional(),
    blockStreaming: z14.boolean().optional(),
    draftChunk: BlockStreamingChunkSchema.optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
    // Legacy key kept for automatic migration to `streaming`.
    streamMode: z14.enum(["off", "partial", "block"]).optional(),
    mediaMaxMb: z14.number().positive().optional(),
    timeoutSeconds: z14.number().int().positive().optional(),
    retry: RetryConfigSchema,
    network: z14
      .object({
        autoSelectFamily: z14.boolean().optional(),
        dnsResultOrder: z14.enum(["ipv4first", "verbatim"]).optional(),
      })
      .strict()
      .optional(),
    proxy: z14.string().optional(),
    webhookUrl: z14
      .string()
      .optional()
      .describe(
        "Public HTTPS webhook URL registered with Telegram for inbound updates. This must be internet-reachable and requires channels.telegram.webhookSecret.",
      ),
    webhookSecret: SecretInputSchema.optional()
      .describe(
        "Secret token sent to Telegram during webhook registration and verified on inbound webhook requests. Telegram returns this value for verification; this is not the gateway auth token and not the bot token.",
      )
      .register(sensitive),
    webhookPath: z14
      .string()
      .optional()
      .describe(
        "Local webhook route path served by the gateway listener. Defaults to /telegram-webhook.",
      ),
    webhookHost: z14
      .string()
      .optional()
      .describe(
        "Local bind host for the webhook listener. Defaults to 127.0.0.1; keep loopback unless you intentionally expose direct ingress.",
      ),
    webhookPort: z14
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Local bind port for the webhook listener. Defaults to 8787; set to 0 to let the OS assign an ephemeral port.",
      ),
    webhookCertPath: z14
      .string()
      .optional()
      .describe(
        "Path to the self-signed certificate (PEM) to upload to Telegram during webhook registration. Required for self-signed certs (direct IP or no domain).",
      ),
    actions: z14
      .object({
        reactions: z14.boolean().optional(),
        sendMessage: z14.boolean().optional(),
        poll: z14.boolean().optional(),
        deleteMessage: z14.boolean().optional(),
        editMessage: z14.boolean().optional(),
        sticker: z14.boolean().optional(),
        createForumTopic: z14.boolean().optional(),
        editForumTopic: z14.boolean().optional(),
      })
      .strict()
      .optional(),
    threadBindings: z14
      .object({
        enabled: z14.boolean().optional(),
        idleHours: z14.number().nonnegative().optional(),
        maxAgeHours: z14.number().nonnegative().optional(),
        spawnSubagentSessions: z14.boolean().optional(),
        spawnAcpSessions: z14.boolean().optional(),
      })
      .strict()
      .optional(),
    reactionNotifications: z14.enum(["off", "own", "all"]).optional(),
    reactionLevel: z14.enum(["off", "ack", "minimal", "extensive"]).optional(),
    heartbeat: ChannelHeartbeatVisibilitySchema,
    healthMonitor: ChannelHealthMonitorSchema,
    linkPreview: z14.boolean().optional(),
    silentErrorReplies: z14.boolean().optional(),
    responsePrefix: z14.string().optional(),
    ackReaction: z14.string().optional(),
    apiRoot: z14.string().url().optional(),
    autoTopicLabel: AutoTopicLabelSchema,
  })
  .strict();
var TelegramAccountSchema = TelegramAccountSchemaBase.superRefine((value, ctx) => {
  normalizeTelegramStreamingConfig(value);
  validateTelegramCustomCommands(value, ctx);
});
var TelegramConfigSchema = TelegramAccountSchemaBase.extend({
  accounts: z14.record(z14.string(), TelegramAccountSchema.optional()).optional(),
  defaultAccount: z14.string().optional(),
}).superRefine((value, ctx) => {
  normalizeTelegramStreamingConfig(value);
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message:
      'channels.telegram.dmPolicy="open" requires channels.telegram.allowFrom to include "*"',
  });
  requireAllowlistAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message:
      'channels.telegram.dmPolicy="allowlist" requires channels.telegram.allowFrom to contain at least one sender ID',
  });
  validateTelegramCustomCommands(value, ctx);
  if (value.accounts) {
    for (const [accountId, account] of Object.entries(value.accounts)) {
      if (!account) {
        continue;
      }
      const effectivePolicy = account.dmPolicy ?? value.dmPolicy;
      const effectiveAllowFrom = account.allowFrom ?? value.allowFrom;
      requireOpenAllowFrom({
        policy: effectivePolicy,
        allowFrom: effectiveAllowFrom,
        ctx,
        path: ["accounts", accountId, "allowFrom"],
        message:
          'channels.telegram.accounts.*.dmPolicy="open" requires channels.telegram.accounts.*.allowFrom (or channels.telegram.allowFrom) to include "*"',
      });
      requireAllowlistAllowFrom({
        policy: effectivePolicy,
        allowFrom: effectiveAllowFrom,
        ctx,
        path: ["accounts", accountId, "allowFrom"],
        message:
          'channels.telegram.accounts.*.dmPolicy="allowlist" requires channels.telegram.accounts.*.allowFrom (or channels.telegram.allowFrom) to contain at least one sender ID',
      });
    }
  }
  if (!value.accounts) {
    validateTelegramWebhookSecretRequirements(value, ctx);
    return;
  }
  for (const [accountId, account] of Object.entries(value.accounts)) {
    if (!account) {
      continue;
    }
    if (account.enabled === false) {
      continue;
    }
    const effectiveDmPolicy = account.dmPolicy ?? value.dmPolicy;
    const effectiveAllowFrom = Array.isArray(account.allowFrom)
      ? account.allowFrom
      : value.allowFrom;
    requireOpenAllowFrom({
      policy: effectiveDmPolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message:
        'channels.telegram.accounts.*.dmPolicy="open" requires channels.telegram.allowFrom or channels.telegram.accounts.*.allowFrom to include "*"',
    });
    requireAllowlistAllowFrom({
      policy: effectiveDmPolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message:
        'channels.telegram.accounts.*.dmPolicy="allowlist" requires channels.telegram.allowFrom or channels.telegram.accounts.*.allowFrom to contain at least one sender ID',
    });
  }
  validateTelegramWebhookSecretRequirements(value, ctx);
});
var DiscordDmSchema = z14
  .object({
    enabled: z14.boolean().optional(),
    policy: DmPolicySchema.optional(),
    allowFrom: DiscordIdListSchema.optional(),
    groupEnabled: z14.boolean().optional(),
    groupChannels: DiscordIdListSchema.optional(),
  })
  .strict();
var DiscordGuildChannelSchema = z14
  .object({
    allow: z14.boolean().optional(),
    requireMention: z14.boolean().optional(),
    ignoreOtherMentions: z14.boolean().optional(),
    tools: ToolPolicySchema,
    toolsBySender: ToolPolicyBySenderSchema,
    skills: z14.array(z14.string()).optional(),
    enabled: z14.boolean().optional(),
    users: DiscordIdListSchema.optional(),
    roles: DiscordIdListSchema.optional(),
    systemPrompt: z14.string().optional(),
    includeThreadStarter: z14.boolean().optional(),
    autoThread: z14.boolean().optional(),
    /** Naming strategy for auto-created threads. "message" uses message text; "generated" creates an LLM title after thread creation. */
    autoThreadName: z14.enum(["message", "generated"]).optional(),
    /** Archive duration for auto-created threads in minutes. Discord supports 60, 1440 (1 day), 4320 (3 days), 10080 (1 week). Default: 60. */
    autoArchiveDuration: z14
      .union([
        z14.enum(["60", "1440", "4320", "10080"]),
        z14.literal(60),
        z14.literal(1440),
        z14.literal(4320),
        z14.literal(10080),
      ])
      .optional(),
    gateMode: GateModeSchema,
    allowFrom: z14.array(z14.union([z14.string(), z14.number()])).optional(),
  })
  .strict();
var DiscordGuildSchema = z14
  .object({
    slug: z14.string().optional(),
    requireMention: z14.boolean().optional(),
    ignoreOtherMentions: z14.boolean().optional(),
    tools: ToolPolicySchema,
    toolsBySender: ToolPolicyBySenderSchema,
    reactionNotifications: z14.enum(["off", "own", "all", "allowlist"]).optional(),
    users: DiscordIdListSchema.optional(),
    roles: DiscordIdListSchema.optional(),
    channels: z14.record(z14.string(), DiscordGuildChannelSchema.optional()).optional(),
    gateMode: GateModeSchema,
    allowFrom: z14.array(z14.union([z14.string(), z14.number()])).optional(),
  })
  .strict();
var DiscordUiSchema = z14
  .object({
    components: z14
      .object({
        accentColor: HexColorSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();
var DiscordVoiceAutoJoinSchema = z14
  .object({
    guildId: z14.string().min(1),
    channelId: z14.string().min(1),
  })
  .strict();
var DiscordVoiceSchema = z14
  .object({
    enabled: z14.boolean().optional(),
    autoJoin: z14.array(DiscordVoiceAutoJoinSchema).optional(),
    daveEncryption: z14.boolean().optional(),
    decryptionFailureTolerance: z14.number().int().min(0).optional(),
    tts: TtsConfigSchema.optional(),
  })
  .strict()
  .optional();
var DiscordAccountSchema = z14
  .object({
    name: z14.string().optional(),
    capabilities: z14.array(z14.string()).optional(),
    markdown: MarkdownConfigSchema,
    enabled: z14.boolean().optional(),
    commands: ProviderCommandsSchema,
    configWrites: z14.boolean().optional(),
    token: SecretInputSchema.optional().register(sensitive),
    proxy: z14.string().optional(),
    allowBots: z14.union([z14.boolean(), z14.literal("mentions")]).optional(),
    dangerouslyAllowNameMatching: z14.boolean().optional(),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    historyLimit: z14.number().int().min(0).optional(),
    dmHistoryLimit: z14.number().int().min(0).optional(),
    dms: z14.record(z14.string(), DmConfigSchema.optional()).optional(),
    textChunkLimit: z14.number().int().positive().optional(),
    chunkMode: z14.enum(["length", "newline"]).optional(),
    blockStreaming: z14.boolean().optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
    // Canonical streaming mode. Legacy aliases (`streamMode`, boolean `streaming`) are auto-mapped.
    streaming: z14
      .union([z14.boolean(), z14.enum(["off", "partial", "block", "progress"])])
      .optional(),
    streamMode: z14.enum(["partial", "block", "off"]).optional(),
    draftChunk: BlockStreamingChunkSchema.optional(),
    maxLinesPerMessage: z14.number().int().positive().optional(),
    mediaMaxMb: z14.number().positive().optional(),
    retry: RetryConfigSchema,
    actions: z14
      .object({
        reactions: z14.boolean().optional(),
        stickers: z14.boolean().optional(),
        emojiUploads: z14.boolean().optional(),
        stickerUploads: z14.boolean().optional(),
        polls: z14.boolean().optional(),
        permissions: z14.boolean().optional(),
        messages: z14.boolean().optional(),
        threads: z14.boolean().optional(),
        pins: z14.boolean().optional(),
        search: z14.boolean().optional(),
        memberInfo: z14.boolean().optional(),
        roleInfo: z14.boolean().optional(),
        roles: z14.boolean().optional(),
        channelInfo: z14.boolean().optional(),
        voiceStatus: z14.boolean().optional(),
        events: z14.boolean().optional(),
        moderation: z14.boolean().optional(),
        channels: z14.boolean().optional(),
        presence: z14.boolean().optional(),
      })
      .strict()
      .optional(),
    replyToMode: ReplyToModeSchema.optional(),
    // Aliases for channels.discord.dm.policy / channels.discord.dm.allowFrom. Prefer these for
    // inheritance in multi-account setups (shallow merge works; nested dm object doesn't).
    dmPolicy: DmPolicySchema.optional(),
    allowFrom: DiscordIdListSchema.optional(),
    defaultTo: z14.string().optional(),
    dm: DiscordDmSchema.optional(),
    guilds: z14.record(z14.string(), DiscordGuildSchema.optional()).optional(),
    heartbeat: ChannelHeartbeatVisibilitySchema,
    healthMonitor: ChannelHealthMonitorSchema,
    execApprovals: z14
      .object({
        enabled: z14.boolean().optional(),
        approvers: DiscordIdListSchema.optional(),
        agentFilter: z14.array(z14.string()).optional(),
        sessionFilter: z14.array(z14.string()).optional(),
        cleanupAfterResolve: z14.boolean().optional(),
        target: z14.enum(["dm", "channel", "both"]).optional(),
      })
      .strict()
      .optional(),
    agentComponents: z14
      .object({
        enabled: z14.boolean().optional(),
      })
      .strict()
      .optional(),
    ui: DiscordUiSchema,
    slashCommand: z14
      .object({
        ephemeral: z14.boolean().optional(),
      })
      .strict()
      .optional(),
    threadBindings: z14
      .object({
        enabled: z14.boolean().optional(),
        idleHours: z14.number().nonnegative().optional(),
        maxAgeHours: z14.number().nonnegative().optional(),
        spawnSubagentSessions: z14.boolean().optional(),
        spawnAcpSessions: z14.boolean().optional(),
      })
      .strict()
      .optional(),
    intents: z14
      .object({
        presence: z14.boolean().optional(),
        guildMembers: z14.boolean().optional(),
      })
      .strict()
      .optional(),
    voice: DiscordVoiceSchema,
    pluralkit: z14
      .object({
        enabled: z14.boolean().optional(),
        token: SecretInputSchema.optional().register(sensitive),
      })
      .strict()
      .optional(),
    responsePrefix: z14.string().optional(),
    ackReaction: z14.string().optional(),
    ackReactionScope: z14
      .enum(["group-mentions", "group-all", "direct", "all", "off", "none"])
      .optional(),
    activity: z14.string().optional(),
    status: z14.enum(["online", "dnd", "idle", "invisible"]).optional(),
    autoPresence: z14
      .object({
        enabled: z14.boolean().optional(),
        intervalMs: z14.number().int().positive().optional(),
        minUpdateIntervalMs: z14.number().int().positive().optional(),
        healthyText: z14.string().optional(),
        degradedText: z14.string().optional(),
        exhaustedText: z14.string().optional(),
      })
      .strict()
      .optional(),
    activityType: z14
      .union([
        z14.literal(0),
        z14.literal(1),
        z14.literal(2),
        z14.literal(3),
        z14.literal(4),
        z14.literal(5),
      ])
      .optional(),
    activityUrl: z14.string().url().optional(),
    inboundWorker: z14
      .object({
        runTimeoutMs: z14.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    eventQueue: z14
      .object({
        listenerTimeout: z14.number().int().positive().optional(),
        maxQueueSize: z14.number().int().positive().optional(),
        maxConcurrency: z14.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    normalizeDiscordStreamingConfig(value);
    const activityText = typeof value.activity === "string" ? value.activity.trim() : "";
    const hasActivity = Boolean(activityText);
    const hasActivityType = value.activityType !== void 0;
    const activityUrl = typeof value.activityUrl === "string" ? value.activityUrl.trim() : "";
    const hasActivityUrl = Boolean(activityUrl);
    if ((hasActivityType || hasActivityUrl) && !hasActivity) {
      ctx.addIssue({
        code: z14.ZodIssueCode.custom,
        message: "channels.discord.activity is required when activityType or activityUrl is set",
        path: ["activity"],
      });
    }
    if (value.activityType === 1 && !hasActivityUrl) {
      ctx.addIssue({
        code: z14.ZodIssueCode.custom,
        message: "channels.discord.activityUrl is required when activityType is 1 (Streaming)",
        path: ["activityUrl"],
      });
    }
    if (hasActivityUrl && value.activityType !== 1) {
      ctx.addIssue({
        code: z14.ZodIssueCode.custom,
        message: "channels.discord.activityType must be 1 (Streaming) when activityUrl is set",
        path: ["activityType"],
      });
    }
    const autoPresenceInterval = value.autoPresence?.intervalMs;
    const autoPresenceMinUpdate = value.autoPresence?.minUpdateIntervalMs;
    if (
      typeof autoPresenceInterval === "number" &&
      typeof autoPresenceMinUpdate === "number" &&
      autoPresenceMinUpdate > autoPresenceInterval
    ) {
      ctx.addIssue({
        code: z14.ZodIssueCode.custom,
        message:
          "channels.discord.autoPresence.minUpdateIntervalMs must be less than or equal to channels.discord.autoPresence.intervalMs",
        path: ["autoPresence", "minUpdateIntervalMs"],
      });
    }
  });
var DiscordConfigSchema = DiscordAccountSchema.extend({
  accounts: z14.record(z14.string(), DiscordAccountSchema.optional()).optional(),
  defaultAccount: z14.string().optional(),
}).superRefine((value, ctx) => {
  const dmPolicy = value.dmPolicy ?? value.dm?.policy ?? "pairing";
  const allowFrom = value.allowFrom ?? value.dm?.allowFrom;
  const allowFromPath = value.allowFrom !== void 0 ? ["allowFrom"] : ["dm", "allowFrom"];
  requireOpenAllowFrom({
    policy: dmPolicy,
    allowFrom,
    ctx,
    path: [...allowFromPath],
    message:
      'channels.discord.dmPolicy="open" requires channels.discord.allowFrom (or channels.discord.dm.allowFrom) to include "*"',
  });
  requireAllowlistAllowFrom({
    policy: dmPolicy,
    allowFrom,
    ctx,
    path: [...allowFromPath],
    message:
      'channels.discord.dmPolicy="allowlist" requires channels.discord.allowFrom (or channels.discord.dm.allowFrom) to contain at least one sender ID',
  });
  if (!value.accounts) {
    return;
  }
  for (const [accountId, account] of Object.entries(value.accounts)) {
    if (!account) {
      continue;
    }
    const effectivePolicy =
      account.dmPolicy ?? account.dm?.policy ?? value.dmPolicy ?? value.dm?.policy ?? "pairing";
    const effectiveAllowFrom =
      account.allowFrom ?? account.dm?.allowFrom ?? value.allowFrom ?? value.dm?.allowFrom;
    requireOpenAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message:
        'channels.discord.accounts.*.dmPolicy="open" requires channels.discord.accounts.*.allowFrom (or channels.discord.allowFrom) to include "*"',
    });
    requireAllowlistAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message:
        'channels.discord.accounts.*.dmPolicy="allowlist" requires channels.discord.accounts.*.allowFrom (or channels.discord.allowFrom) to contain at least one sender ID',
    });
  }
});
var GoogleChatDmSchema = z14
  .object({
    enabled: z14.boolean().optional(),
    policy: DmPolicySchema.optional().default("pairing"),
    allowFrom: z14.array(z14.union([z14.string(), z14.number()])).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    requireOpenAllowFrom({
      policy: value.policy,
      allowFrom: value.allowFrom,
      ctx,
      path: ["allowFrom"],
      message:
        'channels.googlechat.dm.policy="open" requires channels.googlechat.dm.allowFrom to include "*"',
    });
    requireAllowlistAllowFrom({
      policy: value.policy,
      allowFrom: value.allowFrom,
      ctx,
      path: ["allowFrom"],
      message:
        'channels.googlechat.dm.policy="allowlist" requires channels.googlechat.dm.allowFrom to contain at least one sender ID',
    });
  });
var GoogleChatGroupSchema = z14
  .object({
    enabled: z14.boolean().optional(),
    allow: z14.boolean().optional(),
    requireMention: z14.boolean().optional(),
    users: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    systemPrompt: z14.string().optional(),
  })
  .strict();
var GoogleChatAccountSchema = z14
  .object({
    name: z14.string().optional(),
    capabilities: z14.array(z14.string()).optional(),
    enabled: z14.boolean().optional(),
    configWrites: z14.boolean().optional(),
    allowBots: z14.boolean().optional(),
    dangerouslyAllowNameMatching: z14.boolean().optional(),
    requireMention: z14.boolean().optional(),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    groupAllowFrom: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    groups: z14.record(z14.string(), GoogleChatGroupSchema.optional()).optional(),
    defaultTo: z14.string().optional(),
    serviceAccount: z14
      .union([z14.string(), z14.record(z14.string(), z14.unknown()), SecretRefSchema])
      .optional()
      .register(sensitive),
    serviceAccountRef: SecretRefSchema.optional().register(sensitive),
    serviceAccountFile: z14.string().optional(),
    audienceType: z14.enum(["app-url", "project-number"]).optional(),
    audience: z14.string().optional(),
    appPrincipal: z14.string().optional(),
    webhookPath: z14.string().optional(),
    webhookUrl: z14.string().optional(),
    botUser: z14.string().optional(),
    historyLimit: z14.number().int().min(0).optional(),
    dmHistoryLimit: z14.number().int().min(0).optional(),
    dms: z14.record(z14.string(), DmConfigSchema.optional()).optional(),
    textChunkLimit: z14.number().int().positive().optional(),
    chunkMode: z14.enum(["length", "newline"]).optional(),
    blockStreaming: z14.boolean().optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
    streamMode: z14.enum(["replace", "status_final", "append"]).optional().default("replace"),
    mediaMaxMb: z14.number().positive().optional(),
    replyToMode: ReplyToModeSchema.optional(),
    actions: z14
      .object({
        reactions: z14.boolean().optional(),
      })
      .strict()
      .optional(),
    dm: GoogleChatDmSchema.optional(),
    healthMonitor: ChannelHealthMonitorSchema,
    typingIndicator: z14.enum(["none", "message", "reaction"]).optional(),
    responsePrefix: z14.string().optional(),
  })
  .strict();
var GoogleChatConfigSchema = GoogleChatAccountSchema.extend({
  accounts: z14.record(z14.string(), GoogleChatAccountSchema.optional()).optional(),
  defaultAccount: z14.string().optional(),
});
var SlackDmSchema = z14
  .object({
    enabled: z14.boolean().optional(),
    policy: DmPolicySchema.optional(),
    allowFrom: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    groupEnabled: z14.boolean().optional(),
    groupChannels: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    replyToMode: ReplyToModeSchema.optional(),
  })
  .strict();
var SlackChannelSchema = z14
  .object({
    enabled: z14.boolean().optional(),
    allow: z14.boolean().optional(),
    requireMention: z14.boolean().optional(),
    tools: ToolPolicySchema,
    toolsBySender: ToolPolicyBySenderSchema,
    allowBots: z14.boolean().optional(),
    users: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    skills: z14.array(z14.string()).optional(),
    systemPrompt: z14.string().optional(),
  })
  .strict();
var SlackThreadSchema = z14
  .object({
    historyScope: z14.enum(["thread", "channel"]).optional(),
    inheritParent: z14.boolean().optional(),
    initialHistoryLimit: z14.number().int().min(0).optional(),
  })
  .strict();
var SlackReplyToModeByChatTypeSchema = z14
  .object({
    direct: ReplyToModeSchema.optional(),
    group: ReplyToModeSchema.optional(),
    channel: ReplyToModeSchema.optional(),
  })
  .strict();
var SlackAccountSchema = z14
  .object({
    name: z14.string().optional(),
    mode: z14.enum(["socket", "http"]).optional(),
    signingSecret: SecretInputSchema.optional().register(sensitive),
    webhookPath: z14.string().optional(),
    capabilities: SlackCapabilitiesSchema.optional(),
    markdown: MarkdownConfigSchema,
    enabled: z14.boolean().optional(),
    commands: ProviderCommandsSchema,
    configWrites: z14.boolean().optional(),
    botToken: SecretInputSchema.optional().register(sensitive),
    appToken: SecretInputSchema.optional().register(sensitive),
    userToken: SecretInputSchema.optional().register(sensitive),
    userTokenReadOnly: z14.boolean().optional().default(true),
    allowBots: z14.boolean().optional(),
    dangerouslyAllowNameMatching: z14.boolean().optional(),
    requireMention: z14.boolean().optional(),
    groupPolicy: GroupPolicySchema.optional(),
    historyLimit: z14.number().int().min(0).optional(),
    dmHistoryLimit: z14.number().int().min(0).optional(),
    dms: z14.record(z14.string(), DmConfigSchema.optional()).optional(),
    textChunkLimit: z14.number().int().positive().optional(),
    chunkMode: z14.enum(["length", "newline"]).optional(),
    blockStreaming: z14.boolean().optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
    streaming: z14
      .union([z14.boolean(), z14.enum(["off", "partial", "block", "progress"])])
      .optional(),
    nativeStreaming: z14.boolean().optional(),
    streamMode: z14.enum(["replace", "status_final", "append"]).optional(),
    mediaMaxMb: z14.number().positive().optional(),
    reactionNotifications: z14.enum(["off", "own", "all", "allowlist"]).optional(),
    reactionAllowlist: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    replyToMode: ReplyToModeSchema.optional(),
    replyToModeByChatType: SlackReplyToModeByChatTypeSchema.optional(),
    thread: SlackThreadSchema.optional(),
    actions: z14
      .object({
        reactions: z14.boolean().optional(),
        messages: z14.boolean().optional(),
        pins: z14.boolean().optional(),
        search: z14.boolean().optional(),
        permissions: z14.boolean().optional(),
        memberInfo: z14.boolean().optional(),
        channelInfo: z14.boolean().optional(),
        emojiList: z14.boolean().optional(),
      })
      .strict()
      .optional(),
    slashCommand: z14
      .object({
        enabled: z14.boolean().optional(),
        name: z14.string().optional(),
        sessionPrefix: z14.string().optional(),
        ephemeral: z14.boolean().optional(),
      })
      .strict()
      .optional(),
    // Aliases for channels.slack.dm.policy / channels.slack.dm.allowFrom. Prefer these for
    // inheritance in multi-account setups (shallow merge works; nested dm object doesn't).
    dmPolicy: DmPolicySchema.optional(),
    allowFrom: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    defaultTo: z14.string().optional(),
    dm: SlackDmSchema.optional(),
    channels: z14.record(z14.string(), SlackChannelSchema.optional()).optional(),
    heartbeat: ChannelHeartbeatVisibilitySchema,
    healthMonitor: ChannelHealthMonitorSchema,
    responsePrefix: z14.string().optional(),
    ackReaction: z14.string().optional(),
    typingReaction: z14.string().optional(),
  })
  .strict()
  .superRefine((value) => {
    normalizeSlackStreamingConfig(value);
  });
var SlackConfigSchema = SlackAccountSchema.safeExtend({
  mode: z14.enum(["socket", "http"]).optional().default("socket"),
  signingSecret: SecretInputSchema.optional().register(sensitive),
  webhookPath: z14.string().optional().default("/slack/events"),
  groupPolicy: GroupPolicySchema.optional().default("allowlist"),
  accounts: z14.record(z14.string(), SlackAccountSchema.optional()).optional(),
  defaultAccount: z14.string().optional(),
}).superRefine((value, ctx) => {
  const dmPolicy = value.dmPolicy ?? value.dm?.policy ?? "pairing";
  const allowFrom = value.allowFrom ?? value.dm?.allowFrom;
  const allowFromPath = value.allowFrom !== void 0 ? ["allowFrom"] : ["dm", "allowFrom"];
  requireOpenAllowFrom({
    policy: dmPolicy,
    allowFrom,
    ctx,
    path: [...allowFromPath],
    message:
      'channels.slack.dmPolicy="open" requires channels.slack.allowFrom (or channels.slack.dm.allowFrom) to include "*"',
  });
  requireAllowlistAllowFrom({
    policy: dmPolicy,
    allowFrom,
    ctx,
    path: [...allowFromPath],
    message:
      'channels.slack.dmPolicy="allowlist" requires channels.slack.allowFrom (or channels.slack.dm.allowFrom) to contain at least one sender ID',
  });
  const baseMode = value.mode ?? "socket";
  if (!value.accounts) {
    validateSlackSigningSecretRequirements(value, ctx);
    return;
  }
  for (const [accountId, account] of Object.entries(value.accounts)) {
    if (!account) {
      continue;
    }
    if (account.enabled === false) {
      continue;
    }
    const accountMode = account.mode ?? baseMode;
    const effectivePolicy =
      account.dmPolicy ?? account.dm?.policy ?? value.dmPolicy ?? value.dm?.policy ?? "pairing";
    const effectiveAllowFrom =
      account.allowFrom ?? account.dm?.allowFrom ?? value.allowFrom ?? value.dm?.allowFrom;
    requireOpenAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message:
        'channels.slack.accounts.*.dmPolicy="open" requires channels.slack.accounts.*.allowFrom (or channels.slack.allowFrom) to include "*"',
    });
    requireAllowlistAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message:
        'channels.slack.accounts.*.dmPolicy="allowlist" requires channels.slack.accounts.*.allowFrom (or channels.slack.allowFrom) to contain at least one sender ID',
    });
    if (accountMode !== "http") {
      continue;
    }
  }
  validateSlackSigningSecretRequirements(value, ctx);
});
var SignalGroupEntrySchema = z14
  .object({
    requireMention: z14.boolean().optional(),
    tools: ToolPolicySchema,
    toolsBySender: ToolPolicyBySenderSchema,
  })
  .strict();
var SignalGroupsSchema = z14.record(z14.string(), SignalGroupEntrySchema.optional()).optional();
var SignalAccountSchemaBase = z14
  .object({
    name: z14.string().optional(),
    capabilities: z14.array(z14.string()).optional(),
    markdown: MarkdownConfigSchema,
    enabled: z14.boolean().optional(),
    configWrites: z14.boolean().optional(),
    account: z14.string().optional(),
    accountUuid: z14.string().optional(),
    httpUrl: z14.string().optional(),
    httpHost: z14.string().optional(),
    httpPort: z14.number().int().positive().optional(),
    cliPath: ExecutableTokenSchema.optional(),
    autoStart: z14.boolean().optional(),
    startupTimeoutMs: z14.number().int().min(1e3).max(12e4).optional(),
    receiveMode: z14.union([z14.literal("on-start"), z14.literal("manual")]).optional(),
    ignoreAttachments: z14.boolean().optional(),
    ignoreStories: z14.boolean().optional(),
    sendReadReceipts: z14.boolean().optional(),
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    allowFrom: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    defaultTo: z14.string().optional(),
    groupAllowFrom: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    groups: SignalGroupsSchema,
    historyLimit: z14.number().int().min(0).optional(),
    dmHistoryLimit: z14.number().int().min(0).optional(),
    dms: z14.record(z14.string(), DmConfigSchema.optional()).optional(),
    textChunkLimit: z14.number().int().positive().optional(),
    chunkMode: z14.enum(["length", "newline"]).optional(),
    blockStreaming: z14.boolean().optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
    mediaMaxMb: z14.number().int().positive().optional(),
    reactionNotifications: z14.enum(["off", "own", "all", "allowlist"]).optional(),
    reactionAllowlist: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    actions: z14
      .object({
        reactions: z14.boolean().optional(),
      })
      .strict()
      .optional(),
    reactionLevel: z14.enum(["off", "ack", "minimal", "extensive"]).optional(),
    heartbeat: ChannelHeartbeatVisibilitySchema,
    healthMonitor: ChannelHealthMonitorSchema,
    responsePrefix: z14.string().optional(),
  })
  .strict();
var SignalAccountSchema = SignalAccountSchemaBase;
var SignalConfigSchema = SignalAccountSchemaBase.extend({
  accounts: z14.record(z14.string(), SignalAccountSchema.optional()).optional(),
  defaultAccount: z14.string().optional(),
}).superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.signal.dmPolicy="open" requires channels.signal.allowFrom to include "*"',
  });
  requireAllowlistAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message:
      'channels.signal.dmPolicy="allowlist" requires channels.signal.allowFrom to contain at least one sender ID',
  });
  if (!value.accounts) {
    return;
  }
  for (const [accountId, account] of Object.entries(value.accounts)) {
    if (!account) {
      continue;
    }
    const effectivePolicy = account.dmPolicy ?? value.dmPolicy;
    const effectiveAllowFrom = account.allowFrom ?? value.allowFrom;
    requireOpenAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message:
        'channels.signal.accounts.*.dmPolicy="open" requires channels.signal.accounts.*.allowFrom (or channels.signal.allowFrom) to include "*"',
    });
    requireAllowlistAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message:
        'channels.signal.accounts.*.dmPolicy="allowlist" requires channels.signal.accounts.*.allowFrom (or channels.signal.allowFrom) to contain at least one sender ID',
    });
  }
});
var IrcGroupSchema = z14
  .object({
    requireMention: z14.boolean().optional(),
    tools: ToolPolicySchema,
    toolsBySender: ToolPolicyBySenderSchema,
    skills: z14.array(z14.string()).optional(),
    enabled: z14.boolean().optional(),
    allowFrom: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    systemPrompt: z14.string().optional(),
  })
  .strict();
var IrcNickServSchema = z14
  .object({
    enabled: z14.boolean().optional(),
    service: z14.string().optional(),
    password: SecretInputSchema.optional().register(sensitive),
    passwordFile: z14.string().optional(),
    register: z14.boolean().optional(),
    registerEmail: z14.string().optional(),
  })
  .strict();
var IrcAccountSchemaBase = z14
  .object({
    name: z14.string().optional(),
    capabilities: z14.array(z14.string()).optional(),
    markdown: MarkdownConfigSchema,
    enabled: z14.boolean().optional(),
    configWrites: z14.boolean().optional(),
    host: z14.string().optional(),
    port: z14.number().int().min(1).max(65535).optional(),
    tls: z14.boolean().optional(),
    nick: z14.string().optional(),
    username: z14.string().optional(),
    realname: z14.string().optional(),
    password: SecretInputSchema.optional().register(sensitive),
    passwordFile: z14.string().optional(),
    nickserv: IrcNickServSchema.optional(),
    channels: z14.array(z14.string()).optional(),
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    allowFrom: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    defaultTo: z14.string().optional(),
    groupAllowFrom: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    groups: z14.record(z14.string(), IrcGroupSchema.optional()).optional(),
    mentionPatterns: z14.array(z14.string()).optional(),
    historyLimit: z14.number().int().min(0).optional(),
    dmHistoryLimit: z14.number().int().min(0).optional(),
    dms: z14.record(z14.string(), DmConfigSchema.optional()).optional(),
    textChunkLimit: z14.number().int().positive().optional(),
    chunkMode: z14.enum(["length", "newline"]).optional(),
    blockStreaming: z14.boolean().optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
    mediaMaxMb: z14.number().positive().optional(),
    heartbeat: ChannelHeartbeatVisibilitySchema,
    healthMonitor: ChannelHealthMonitorSchema,
    responsePrefix: z14.string().optional(),
  })
  .strict();
function refineIrcAllowFromAndNickserv(value, ctx) {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.irc.dmPolicy="open" requires channels.irc.allowFrom to include "*"',
  });
  requireAllowlistAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message:
      'channels.irc.dmPolicy="allowlist" requires channels.irc.allowFrom to contain at least one sender ID',
  });
  if (value.nickserv?.register && !value.nickserv.registerEmail?.trim()) {
    ctx.addIssue({
      code: z14.ZodIssueCode.custom,
      path: ["nickserv", "registerEmail"],
      message: "channels.irc.nickserv.register=true requires channels.irc.nickserv.registerEmail",
    });
  }
}
var IrcAccountSchema = IrcAccountSchemaBase.superRefine((value, ctx) => {
  if (value.nickserv?.register && !value.nickserv.registerEmail?.trim()) {
    ctx.addIssue({
      code: z14.ZodIssueCode.custom,
      path: ["nickserv", "registerEmail"],
      message: "channels.irc.nickserv.register=true requires channels.irc.nickserv.registerEmail",
    });
  }
});
var IrcConfigSchema = IrcAccountSchemaBase.extend({
  accounts: z14.record(z14.string(), IrcAccountSchema.optional()).optional(),
  defaultAccount: z14.string().optional(),
}).superRefine((value, ctx) => {
  refineIrcAllowFromAndNickserv(value, ctx);
  if (!value.accounts) {
    return;
  }
  for (const [accountId, account] of Object.entries(value.accounts)) {
    if (!account) {
      continue;
    }
    const effectivePolicy = account.dmPolicy ?? value.dmPolicy;
    const effectiveAllowFrom = account.allowFrom ?? value.allowFrom;
    requireOpenAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message:
        'channels.irc.accounts.*.dmPolicy="open" requires channels.irc.accounts.*.allowFrom (or channels.irc.allowFrom) to include "*"',
    });
    requireAllowlistAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message:
        'channels.irc.accounts.*.dmPolicy="allowlist" requires channels.irc.accounts.*.allowFrom (or channels.irc.allowFrom) to contain at least one sender ID',
    });
  }
});
var IMessageAccountSchemaBase = z14
  .object({
    name: z14.string().optional(),
    capabilities: z14.array(z14.string()).optional(),
    markdown: MarkdownConfigSchema,
    enabled: z14.boolean().optional(),
    configWrites: z14.boolean().optional(),
    cliPath: ExecutableTokenSchema.optional(),
    dbPath: z14.string().optional(),
    remoteHost: z14
      .string()
      .refine(isSafeScpRemoteHost, "expected SSH host or user@host (no spaces/options)")
      .optional(),
    service: z14
      .union([z14.literal("imessage"), z14.literal("sms"), z14.literal("auto")])
      .optional(),
    region: z14.string().optional(),
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    allowFrom: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    defaultTo: z14.string().optional(),
    groupAllowFrom: z14.array(z14.union([z14.string(), z14.number()])).optional(),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    historyLimit: z14.number().int().min(0).optional(),
    dmHistoryLimit: z14.number().int().min(0).optional(),
    dms: z14.record(z14.string(), DmConfigSchema.optional()).optional(),
    includeAttachments: z14.boolean().optional(),
    attachmentRoots: z14
      .array(z14.string().refine(isValidInboundPathRootPattern, "expected absolute path root"))
      .optional(),
    remoteAttachmentRoots: z14
      .array(z14.string().refine(isValidInboundPathRootPattern, "expected absolute path root"))
      .optional(),
    mediaMaxMb: z14.number().int().positive().optional(),
    textChunkLimit: z14.number().int().positive().optional(),
    chunkMode: z14.enum(["length", "newline"]).optional(),
    blockStreaming: z14.boolean().optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
    groups: z14
      .record(
        z14.string(),
        z14
          .object({
            requireMention: z14.boolean().optional(),
            tools: ToolPolicySchema,
            toolsBySender: ToolPolicyBySenderSchema,
          })
          .strict()
          .optional(),
      )
      .optional(),
    heartbeat: ChannelHeartbeatVisibilitySchema,
    healthMonitor: ChannelHealthMonitorSchema,
    responsePrefix: z14.string().optional(),
  })
  .strict();
var IMessageAccountSchema = IMessageAccountSchemaBase;
var IMessageConfigSchema = IMessageAccountSchemaBase.extend({
  accounts: z14.record(z14.string(), IMessageAccountSchema.optional()).optional(),
  defaultAccount: z14.string().optional(),
}).superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message:
      'channels.imessage.dmPolicy="open" requires channels.imessage.allowFrom to include "*"',
  });
  requireAllowlistAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message:
      'channels.imessage.dmPolicy="allowlist" requires channels.imessage.allowFrom to contain at least one sender ID',
  });
  if (!value.accounts) {
    return;
  }
  for (const [accountId, account] of Object.entries(value.accounts)) {
    if (!account) {
      continue;
    }
    const effectivePolicy = account.dmPolicy ?? value.dmPolicy;
    const effectiveAllowFrom = account.allowFrom ?? value.allowFrom;
    requireOpenAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message:
        'channels.imessage.accounts.*.dmPolicy="open" requires channels.imessage.accounts.*.allowFrom (or channels.imessage.allowFrom) to include "*"',
    });
    requireAllowlistAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message:
        'channels.imessage.accounts.*.dmPolicy="allowlist" requires channels.imessage.accounts.*.allowFrom (or channels.imessage.allowFrom) to contain at least one sender ID',
    });
  }
});
var BlueBubblesAllowFromEntry = z14.union([z14.string(), z14.number()]);
var BlueBubblesActionSchema = z14
  .object({
    reactions: z14.boolean().optional(),
    edit: z14.boolean().optional(),
    unsend: z14.boolean().optional(),
    reply: z14.boolean().optional(),
    sendWithEffect: z14.boolean().optional(),
    renameGroup: z14.boolean().optional(),
    setGroupIcon: z14.boolean().optional(),
    addParticipant: z14.boolean().optional(),
    removeParticipant: z14.boolean().optional(),
    leaveGroup: z14.boolean().optional(),
    sendAttachment: z14.boolean().optional(),
  })
  .strict()
  .optional();
var BlueBubblesGroupConfigSchema = z14
  .object({
    requireMention: z14.boolean().optional(),
    tools: ToolPolicySchema,
    toolsBySender: ToolPolicyBySenderSchema,
  })
  .strict();
var BlueBubblesAccountSchemaBase = z14
  .object({
    name: z14.string().optional(),
    capabilities: z14.array(z14.string()).optional(),
    markdown: MarkdownConfigSchema,
    configWrites: z14.boolean().optional(),
    enabled: z14.boolean().optional(),
    serverUrl: z14.string().optional(),
    password: SecretInputSchema.optional().register(sensitive),
    webhookPath: z14.string().optional(),
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    allowFrom: z14.array(BlueBubblesAllowFromEntry).optional(),
    groupAllowFrom: z14.array(BlueBubblesAllowFromEntry).optional(),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    historyLimit: z14.number().int().min(0).optional(),
    dmHistoryLimit: z14.number().int().min(0).optional(),
    dms: z14.record(z14.string(), DmConfigSchema.optional()).optional(),
    textChunkLimit: z14.number().int().positive().optional(),
    chunkMode: z14.enum(["length", "newline"]).optional(),
    mediaMaxMb: z14.number().int().positive().optional(),
    mediaLocalRoots: z14.array(z14.string()).optional(),
    sendReadReceipts: z14.boolean().optional(),
    allowPrivateNetwork: z14.boolean().optional(),
    blockStreaming: z14.boolean().optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
    groups: z14.record(z14.string(), BlueBubblesGroupConfigSchema.optional()).optional(),
    heartbeat: ChannelHeartbeatVisibilitySchema,
    healthMonitor: ChannelHealthMonitorSchema,
    responsePrefix: z14.string().optional(),
  })
  .strict();
var BlueBubblesAccountSchema = BlueBubblesAccountSchemaBase;
var BlueBubblesConfigSchema = BlueBubblesAccountSchemaBase.extend({
  accounts: z14.record(z14.string(), BlueBubblesAccountSchema.optional()).optional(),
  defaultAccount: z14.string().optional(),
  actions: BlueBubblesActionSchema,
}).superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message:
      'channels.bluebubbles.dmPolicy="open" requires channels.bluebubbles.allowFrom to include "*"',
  });
  requireAllowlistAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message:
      'channels.bluebubbles.dmPolicy="allowlist" requires channels.bluebubbles.allowFrom to contain at least one sender ID',
  });
  if (!value.accounts) {
    return;
  }
  for (const [accountId, account] of Object.entries(value.accounts)) {
    if (!account) {
      continue;
    }
    const effectivePolicy = account.dmPolicy ?? value.dmPolicy;
    const effectiveAllowFrom = account.allowFrom ?? value.allowFrom;
    requireOpenAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message:
        'channels.bluebubbles.accounts.*.dmPolicy="open" requires channels.bluebubbles.accounts.*.allowFrom (or channels.bluebubbles.allowFrom) to include "*"',
    });
    requireAllowlistAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message:
        'channels.bluebubbles.accounts.*.dmPolicy="allowlist" requires channels.bluebubbles.accounts.*.allowFrom (or channels.bluebubbles.allowFrom) to contain at least one sender ID',
    });
  }
});
var MSTeamsChannelSchema = z14
  .object({
    requireMention: z14.boolean().optional(),
    tools: ToolPolicySchema,
    toolsBySender: ToolPolicyBySenderSchema,
    replyStyle: MSTeamsReplyStyleSchema.optional(),
  })
  .strict();
var MSTeamsTeamSchema = z14
  .object({
    requireMention: z14.boolean().optional(),
    tools: ToolPolicySchema,
    toolsBySender: ToolPolicyBySenderSchema,
    replyStyle: MSTeamsReplyStyleSchema.optional(),
    channels: z14.record(z14.string(), MSTeamsChannelSchema.optional()).optional(),
  })
  .strict();
var MSTeamsConfigSchema = z14
  .object({
    enabled: z14.boolean().optional(),
    capabilities: z14.array(z14.string()).optional(),
    dangerouslyAllowNameMatching: z14.boolean().optional(),
    markdown: MarkdownConfigSchema,
    configWrites: z14.boolean().optional(),
    appId: z14.string().optional(),
    appPassword: SecretInputSchema.optional().register(sensitive),
    tenantId: z14.string().optional(),
    webhook: z14
      .object({
        port: z14.number().int().positive().optional(),
        path: z14.string().optional(),
      })
      .strict()
      .optional(),
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    allowFrom: z14.array(z14.string()).optional(),
    defaultTo: z14.string().optional(),
    groupAllowFrom: z14.array(z14.string()).optional(),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    textChunkLimit: z14.number().int().positive().optional(),
    chunkMode: z14.enum(["length", "newline"]).optional(),
    blockStreaming: z14.boolean().optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
    mediaAllowHosts: z14.array(z14.string()).optional(),
    mediaAuthAllowHosts: z14.array(z14.string()).optional(),
    requireMention: z14.boolean().optional(),
    historyLimit: z14.number().int().min(0).optional(),
    dmHistoryLimit: z14.number().int().min(0).optional(),
    dms: z14.record(z14.string(), DmConfigSchema.optional()).optional(),
    replyStyle: MSTeamsReplyStyleSchema.optional(),
    teams: z14.record(z14.string(), MSTeamsTeamSchema.optional()).optional(),
    /** Max media size in MB (default: 100MB for OneDrive upload support). */
    mediaMaxMb: z14.number().positive().optional(),
    /** SharePoint site ID for file uploads in group chats/channels (e.g., "contoso.sharepoint.com,guid1,guid2") */
    sharePointSiteId: z14.string().optional(),
    heartbeat: ChannelHeartbeatVisibilitySchema,
    healthMonitor: ChannelHealthMonitorSchema,
    responsePrefix: z14.string().optional(),
    welcomeCard: z14.boolean().optional(),
    promptStarters: z14.array(z14.string()).optional(),
    groupWelcomeCard: z14.boolean().optional(),
    feedbackEnabled: z14.boolean().optional(),
    feedbackReflection: z14.boolean().optional(),
    feedbackReflectionCooldownMs: z14.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    requireOpenAllowFrom({
      policy: value.dmPolicy,
      allowFrom: value.allowFrom,
      ctx,
      path: ["allowFrom"],
      message:
        'channels.msteams.dmPolicy="open" requires channels.msteams.allowFrom to include "*"',
    });
    requireAllowlistAllowFrom({
      policy: value.dmPolicy,
      allowFrom: value.allowFrom,
      ctx,
      path: ["allowFrom"],
      message:
        'channels.msteams.dmPolicy="allowlist" requires channels.msteams.allowFrom to contain at least one sender ID',
    });
  });

// src/config/zod-schema.providers-whatsapp.ts
import { z as z15 } from "zod";
var ToolPolicyBySenderSchema2 = z15.record(z15.string(), ToolPolicySchema).optional();
var GateModeSchema2 = z15
  .enum(["blocked", "silent", "frank-only", "allowlist", "mention", "open"])
  .optional();
var WhatsAppGroupEntrySchema = z15
  .object({
    requireMention: z15.boolean().optional(),
    tools: ToolPolicySchema,
    toolsBySender: ToolPolicyBySenderSchema2,
    gateMode: GateModeSchema2,
  })
  .strict()
  .optional();
var WhatsAppGroupsSchema = z15.record(z15.string(), WhatsAppGroupEntrySchema).optional();
var WhatsAppAckReactionSchema = z15
  .object({
    emoji: z15.string().optional(),
    direct: z15.boolean().optional().default(true),
    group: z15.enum(["always", "mentions", "never"]).optional().default("mentions"),
  })
  .strict()
  .optional();
var WhatsAppSharedSchema = z15.object({
  enabled: z15.boolean().optional(),
  capabilities: z15.array(z15.string()).optional(),
  markdown: MarkdownConfigSchema,
  configWrites: z15.boolean().optional(),
  sendReadReceipts: z15.boolean().optional(),
  messagePrefix: z15.string().optional(),
  responsePrefix: z15.string().optional(),
  dmPolicy: DmPolicySchema.optional().default("pairing"),
  selfChatMode: z15.boolean().optional(),
  allowFrom: z15.array(z15.string()).optional(),
  defaultTo: z15.string().optional(),
  groupAllowFrom: z15.array(z15.string()).optional(),
  groupPolicy: GroupPolicySchema.optional().default("allowlist"),
  historyLimit: z15.number().int().min(0).optional(),
  dmHistoryLimit: z15.number().int().min(0).optional(),
  dms: z15.record(z15.string(), DmConfigSchema.optional()).optional(),
  textChunkLimit: z15.number().int().positive().optional(),
  chunkMode: z15.enum(["length", "newline"]).optional(),
  blockStreaming: z15.boolean().optional(),
  blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
  groups: WhatsAppGroupsSchema,
  ackReaction: WhatsAppAckReactionSchema,
  debounceMs: z15.number().int().nonnegative().optional().default(0),
  heartbeat: ChannelHeartbeatVisibilitySchema,
  healthMonitor: ChannelHealthMonitorSchema,
});
function enforceOpenDmPolicyAllowFromStar(params) {
  if (params.dmPolicy !== "open") {
    return;
  }
  const allow = (Array.isArray(params.allowFrom) ? params.allowFrom : [])
    .map((v) => String(v).trim())
    .filter(Boolean);
  if (allow.includes("*")) {
    return;
  }
  params.ctx.addIssue({
    code: z15.ZodIssueCode.custom,
    path: params.path ?? ["allowFrom"],
    message: params.message,
  });
}
function enforceAllowlistDmPolicyAllowFrom(params) {
  if (params.dmPolicy !== "allowlist") {
    return;
  }
  const allow = (Array.isArray(params.allowFrom) ? params.allowFrom : [])
    .map((v) => String(v).trim())
    .filter(Boolean);
  if (allow.length > 0) {
    return;
  }
  params.ctx.addIssue({
    code: z15.ZodIssueCode.custom,
    path: params.path ?? ["allowFrom"],
    message: params.message,
  });
}
var WhatsAppAccountSchema = WhatsAppSharedSchema.extend({
  name: z15.string().optional(),
  enabled: z15.boolean().optional(),
  /** Override auth directory for this WhatsApp account (Baileys multi-file auth state). */
  authDir: z15.string().optional(),
  mediaMaxMb: z15.number().int().positive().optional(),
}).strict();
var WhatsAppConfigSchema = WhatsAppSharedSchema.extend({
  accounts: z15.record(z15.string(), WhatsAppAccountSchema.optional()).optional(),
  defaultAccount: z15.string().optional(),
  mediaMaxMb: z15.number().int().positive().optional().default(50),
  actions: z15
    .object({
      reactions: z15.boolean().optional(),
      sendMessage: z15.boolean().optional(),
      polls: z15.boolean().optional(),
    })
    .strict()
    .optional(),
})
  .strict()
  .superRefine((value, ctx) => {
    enforceOpenDmPolicyAllowFromStar({
      dmPolicy: value.dmPolicy,
      allowFrom: value.allowFrom,
      ctx,
      message:
        'channels.whatsapp.dmPolicy="open" requires channels.whatsapp.allowFrom to include "*"',
    });
    enforceAllowlistDmPolicyAllowFrom({
      dmPolicy: value.dmPolicy,
      allowFrom: value.allowFrom,
      ctx,
      message:
        'channels.whatsapp.dmPolicy="allowlist" requires channels.whatsapp.allowFrom to contain at least one sender ID',
    });
    if (!value.accounts) {
      return;
    }
    for (const [accountId, account] of Object.entries(value.accounts)) {
      if (!account) {
        continue;
      }
      const effectivePolicy = account.dmPolicy ?? value.dmPolicy;
      const effectiveAllowFrom = account.allowFrom ?? value.allowFrom;
      enforceOpenDmPolicyAllowFromStar({
        dmPolicy: effectivePolicy,
        allowFrom: effectiveAllowFrom,
        ctx,
        path: ["accounts", accountId, "allowFrom"],
        message:
          'channels.whatsapp.accounts.*.dmPolicy="open" requires channels.whatsapp.accounts.*.allowFrom (or channels.whatsapp.allowFrom) to include "*"',
      });
      enforceAllowlistDmPolicyAllowFrom({
        dmPolicy: effectivePolicy,
        allowFrom: effectiveAllowFrom,
        ctx,
        path: ["accounts", accountId, "allowFrom"],
        message:
          'channels.whatsapp.accounts.*.dmPolicy="allowlist" requires channels.whatsapp.accounts.*.allowFrom (or channels.whatsapp.allowFrom) to contain at least one sender ID',
      });
    }
  });

// src/config/zod-schema.providers.ts
var ChannelModelByChannelSchema = z16
  .record(z16.string(), z16.record(z16.string(), z16.string()))
  .optional();
var directChannelRuntimeSchemas = /* @__PURE__ */ new Map([
  ["bluebubbles", { safeParse: (value) => BlueBubblesConfigSchema.safeParse(value) }],
  ["discord", { safeParse: (value) => DiscordConfigSchema.safeParse(value) }],
  ["googlechat", { safeParse: (value) => GoogleChatConfigSchema.safeParse(value) }],
  ["imessage", { safeParse: (value) => IMessageConfigSchema.safeParse(value) }],
  ["irc", { safeParse: (value) => IrcConfigSchema.safeParse(value) }],
  ["msteams", { safeParse: (value) => MSTeamsConfigSchema.safeParse(value) }],
  ["signal", { safeParse: (value) => SignalConfigSchema.safeParse(value) }],
  ["slack", { safeParse: (value) => SlackConfigSchema.safeParse(value) }],
  ["telegram", { safeParse: (value) => TelegramConfigSchema.safeParse(value) }],
  ["whatsapp", { safeParse: (value) => WhatsAppConfigSchema.safeParse(value) }],
]);
function addLegacyChannelAcpBindingIssues(value, ctx, path23 = []) {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      addLegacyChannelAcpBindingIssues(entry, ctx, [...path23, index]),
    );
    return;
  }
  const record = value;
  const bindings = record.bindings;
  if (bindings && typeof bindings === "object" && !Array.isArray(bindings)) {
    const acp = bindings.acp;
    if (acp && typeof acp === "object") {
      ctx.addIssue({
        code: z16.ZodIssueCode.custom,
        path: [...path23, "bindings", "acp"],
        message:
          "Legacy channel-local ACP bindings were removed; use top-level bindings[] entries.",
      });
    }
  }
  for (const [key, entry] of Object.entries(record)) {
    addLegacyChannelAcpBindingIssues(entry, ctx, [...path23, key]);
  }
}
function normalizeBundledChannelConfigs(value, ctx) {
  if (!value) {
    return value;
  }
  let next;
  for (const [channelId, runtimeSchema] of directChannelRuntimeSchemas) {
    if (!Object.prototype.hasOwnProperty.call(value, channelId)) {
      continue;
    }
    const parsed = runtimeSchema.safeParse(value[channelId]);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: z16.ZodIssueCode.custom,
          message: issue.message ?? `Invalid channels.${channelId} config.`,
          path: [channelId, ...(Array.isArray(issue.path) ? issue.path : [])],
        });
      }
      continue;
    }
    next ??= { ...value };
    next[channelId] = parsed.data;
  }
  return next ?? value;
}
var ChannelsSchema = z16
  .object({
    defaults: z16
      .object({
        groupPolicy: GroupPolicySchema.optional(),
        heartbeat: ChannelHeartbeatVisibilitySchema,
      })
      .strict()
      .optional(),
    modelByChannel: ChannelModelByChannelSchema,
  })
  .passthrough()
  .superRefine((value, ctx) => {
    addLegacyChannelAcpBindingIssues(value, ctx);
  })
  .transform((value, ctx) => normalizeBundledChannelConfigs(value, ctx))
  .optional();

// src/config/zod-schema.session.ts
import { z as z17 } from "zod";
var SessionResetConfigSchema = z17
  .object({
    mode: z17.union([z17.literal("daily"), z17.literal("idle")]).optional(),
    atHour: z17.number().int().min(0).max(23).optional(),
    idleMinutes: z17.number().int().positive().optional(),
  })
  .strict();
var SessionSendPolicySchema = createAllowDenyChannelRulesSchema();
var SessionSchema = z17
  .object({
    scope: z17.union([z17.literal("per-sender"), z17.literal("global")]).optional(),
    dmScope: z17
      .union([
        z17.literal("main"),
        z17.literal("per-peer"),
        z17.literal("per-channel-peer"),
        z17.literal("per-account-channel-peer"),
      ])
      .optional(),
    identityLinks: z17.record(z17.string(), z17.array(z17.string())).optional(),
    resetTriggers: z17.array(z17.string()).optional(),
    idleMinutes: z17.number().int().positive().optional(),
    reset: SessionResetConfigSchema.optional(),
    resetByType: z17
      .object({
        direct: SessionResetConfigSchema.optional(),
        /** @deprecated Use `direct` instead. Kept for backward compatibility. */
        dm: SessionResetConfigSchema.optional(),
        group: SessionResetConfigSchema.optional(),
        thread: SessionResetConfigSchema.optional(),
      })
      .strict()
      .optional(),
    resetByChannel: z17.record(z17.string(), SessionResetConfigSchema).optional(),
    store: z17.string().optional(),
    typingIntervalSeconds: z17.number().int().positive().optional(),
    typingMode: TypingModeSchema.optional(),
    parentForkMaxTokens: z17.number().int().nonnegative().optional(),
    mainKey: z17.string().optional(),
    sendPolicy: SessionSendPolicySchema.optional(),
    agentToAgent: z17
      .object({
        maxPingPongTurns: z17.number().int().min(0).max(5).optional(),
      })
      .strict()
      .optional(),
    threadBindings: z17
      .object({
        enabled: z17.boolean().optional(),
        idleHours: z17.number().nonnegative().optional(),
        maxAgeHours: z17.number().nonnegative().optional(),
      })
      .strict()
      .optional(),
    maintenance: z17
      .object({
        mode: z17.enum(["enforce", "warn"]).optional(),
        pruneAfter: z17.union([z17.string(), z17.number()]).optional(),
        /** @deprecated Use pruneAfter instead. */
        pruneDays: z17.number().int().positive().optional(),
        maxEntries: z17.number().int().positive().optional(),
        rotateBytes: z17.union([z17.string(), z17.number()]).optional(),
        resetArchiveRetention: z17
          .union([z17.string(), z17.number(), z17.literal(false)])
          .optional(),
        maxDiskBytes: z17.union([z17.string(), z17.number()]).optional(),
        highWaterBytes: z17.union([z17.string(), z17.number()]).optional(),
      })
      .strict()
      .superRefine((val, ctx) => {
        if (val.pruneAfter !== void 0) {
          try {
            parseDurationMs(String(val.pruneAfter).trim(), { defaultUnit: "d" });
          } catch {
            ctx.addIssue({
              code: z17.ZodIssueCode.custom,
              path: ["pruneAfter"],
              message: "invalid duration (use ms, s, m, h, d)",
            });
          }
        }
        if (val.rotateBytes !== void 0) {
          try {
            parseByteSize(String(val.rotateBytes).trim(), { defaultUnit: "b" });
          } catch {
            ctx.addIssue({
              code: z17.ZodIssueCode.custom,
              path: ["rotateBytes"],
              message: "invalid size (use b, kb, mb, gb, tb)",
            });
          }
        }
        if (val.resetArchiveRetention !== void 0 && val.resetArchiveRetention !== false) {
          try {
            parseDurationMs(String(val.resetArchiveRetention).trim(), { defaultUnit: "d" });
          } catch {
            ctx.addIssue({
              code: z17.ZodIssueCode.custom,
              path: ["resetArchiveRetention"],
              message: "invalid duration (use ms, s, m, h, d)",
            });
          }
        }
        if (val.maxDiskBytes !== void 0) {
          try {
            parseByteSize(String(val.maxDiskBytes).trim(), { defaultUnit: "b" });
          } catch {
            ctx.addIssue({
              code: z17.ZodIssueCode.custom,
              path: ["maxDiskBytes"],
              message: "invalid size (use b, kb, mb, gb, tb)",
            });
          }
        }
        if (val.highWaterBytes !== void 0) {
          try {
            parseByteSize(String(val.highWaterBytes).trim(), { defaultUnit: "b" });
          } catch {
            ctx.addIssue({
              code: z17.ZodIssueCode.custom,
              path: ["highWaterBytes"],
              message: "invalid size (use b, kb, mb, gb, tb)",
            });
          }
        }
      })
      .optional(),
  })
  .strict()
  .optional();
var MessagesSchema = z17
  .object({
    messagePrefix: z17.string().optional(),
    responsePrefix: z17.string().optional(),
    groupChat: GroupChatSchema,
    queue: QueueSchema,
    inbound: InboundDebounceSchema,
    ackReaction: z17.string().optional(),
    ackReactionScope: z17
      .enum(["group-mentions", "group-all", "direct", "all", "off", "none"])
      .optional(),
    removeAckAfterReply: z17.boolean().optional(),
    statusReactions: z17
      .object({
        enabled: z17.boolean().optional(),
        emojis: z17
          .object({
            thinking: z17.string().optional(),
            tool: z17.string().optional(),
            coding: z17.string().optional(),
            web: z17.string().optional(),
            done: z17.string().optional(),
            error: z17.string().optional(),
            stallSoft: z17.string().optional(),
            stallHard: z17.string().optional(),
            compacting: z17.string().optional(),
          })
          .strict()
          .optional(),
        timing: z17
          .object({
            debounceMs: z17.number().int().min(0).optional(),
            stallSoftMs: z17.number().int().min(0).optional(),
            stallHardMs: z17.number().int().min(0).optional(),
            doneHoldMs: z17.number().int().min(0).optional(),
            errorHoldMs: z17.number().int().min(0).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    suppressToolErrors: z17.boolean().optional(),
    tts: TtsConfigSchema,
  })
  .strict()
  .optional();
var CommandsSchema = z17
  .object({
    native: NativeCommandsSettingSchema.optional().default("auto"),
    nativeSkills: NativeCommandsSettingSchema.optional().default("auto"),
    text: z17.boolean().optional(),
    bash: z17.boolean().optional(),
    bashForegroundMs: z17.number().int().min(0).max(3e4).optional(),
    config: z17.boolean().optional(),
    mcp: z17.boolean().optional(),
    plugins: z17.boolean().optional(),
    debug: z17.boolean().optional(),
    restart: z17.boolean().optional().default(true),
    useAccessGroups: z17.boolean().optional(),
    ownerAllowFrom: z17.array(z17.union([z17.string(), z17.number()])).optional(),
    ownerDisplay: z17.enum(["raw", "hash"]).optional().default("raw"),
    ownerDisplaySecret: z17.string().optional().register(sensitive),
    allowFrom: ElevatedAllowFromSchema.optional(),
  })
  .strict()
  .optional()
  .default(() => ({ native: "auto", nativeSkills: "auto", restart: true, ownerDisplay: "raw" }));

// src/config/zod-schema.ts
var BrowserSnapshotDefaultsSchema = z18
  .object({
    mode: z18.literal("efficient").optional(),
  })
  .strict()
  .optional();
var NodeHostSchema = z18
  .object({
    browserProxy: z18
      .object({
        enabled: z18.boolean().optional(),
        allowProfiles: z18.array(z18.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();
var MemoryQmdPathSchema = z18
  .object({
    path: z18.string(),
    name: z18.string().optional(),
    pattern: z18.string().optional(),
  })
  .strict();
var MemoryQmdSessionSchema = z18
  .object({
    enabled: z18.boolean().optional(),
    exportDir: z18.string().optional(),
    retentionDays: z18.number().int().nonnegative().optional(),
  })
  .strict();
var MemoryQmdUpdateSchema = z18
  .object({
    interval: z18.string().optional(),
    debounceMs: z18.number().int().nonnegative().optional(),
    onBoot: z18.boolean().optional(),
    waitForBootSync: z18.boolean().optional(),
    embedInterval: z18.string().optional(),
    commandTimeoutMs: z18.number().int().nonnegative().optional(),
    updateTimeoutMs: z18.number().int().nonnegative().optional(),
    embedTimeoutMs: z18.number().int().nonnegative().optional(),
  })
  .strict();
var MemoryQmdLimitsSchema = z18
  .object({
    maxResults: z18.number().int().positive().optional(),
    maxSnippetChars: z18.number().int().positive().optional(),
    maxInjectedChars: z18.number().int().positive().optional(),
    timeoutMs: z18.number().int().nonnegative().optional(),
  })
  .strict();
var MemoryQmdMcporterSchema = z18
  .object({
    enabled: z18.boolean().optional(),
    serverName: z18.string().optional(),
    startDaemon: z18.boolean().optional(),
  })
  .strict();
var LoggingLevelSchema = z18.union([
  z18.literal("silent"),
  z18.literal("fatal"),
  z18.literal("error"),
  z18.literal("warn"),
  z18.literal("info"),
  z18.literal("debug"),
  z18.literal("trace"),
]);
var MemoryQmdSchema = z18
  .object({
    command: z18.string().optional(),
    mcporter: MemoryQmdMcporterSchema.optional(),
    searchMode: z18
      .union([z18.literal("query"), z18.literal("search"), z18.literal("vsearch")])
      .optional(),
    searchTool: z18.string().trim().min(1).optional(),
    includeDefaultMemory: z18.boolean().optional(),
    paths: z18.array(MemoryQmdPathSchema).optional(),
    sessions: MemoryQmdSessionSchema.optional(),
    update: MemoryQmdUpdateSchema.optional(),
    limits: MemoryQmdLimitsSchema.optional(),
    scope: SessionSendPolicySchema.optional(),
  })
  .strict();
var MemorySchema = z18
  .object({
    backend: z18.union([z18.literal("builtin"), z18.literal("qmd")]).optional(),
    citations: z18.union([z18.literal("auto"), z18.literal("on"), z18.literal("off")]).optional(),
    qmd: MemoryQmdSchema.optional(),
  })
  .strict()
  .optional();
var HttpUrlSchema = z18
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Expected http:// or https:// URL");
var ResponsesEndpointUrlFetchShape = {
  allowUrl: z18.boolean().optional(),
  urlAllowlist: z18.array(z18.string()).optional(),
  allowedMimes: z18.array(z18.string()).optional(),
  maxBytes: z18.number().int().positive().optional(),
  maxRedirects: z18.number().int().nonnegative().optional(),
  timeoutMs: z18.number().int().positive().optional(),
};
var SkillEntrySchema = z18
  .object({
    enabled: z18.boolean().optional(),
    apiKey: SecretInputSchema.optional().register(sensitive),
    env: z18.record(z18.string(), z18.string()).optional(),
    config: z18.record(z18.string(), z18.unknown()).optional(),
  })
  .strict();
var PluginEntrySchema = z18
  .object({
    enabled: z18.boolean().optional(),
    hooks: z18
      .object({
        allowPromptInjection: z18.boolean().optional(),
      })
      .strict()
      .optional(),
    subagent: z18
      .object({
        allowModelOverride: z18.boolean().optional(),
        allowedModels: z18.array(z18.string()).optional(),
      })
      .strict()
      .optional(),
    config: z18.record(z18.string(), z18.unknown()).optional(),
  })
  .strict();
var TalkProviderEntrySchema = z18
  .object({
    voiceId: z18.string().optional(),
    voiceAliases: z18.record(z18.string(), z18.string()).optional(),
    modelId: z18.string().optional(),
    outputFormat: z18.string().optional(),
    apiKey: SecretInputSchema.optional().register(sensitive),
  })
  .catchall(z18.unknown());
var TalkSchema = z18
  .object({
    provider: z18.string().optional(),
    providers: z18.record(z18.string(), TalkProviderEntrySchema).optional(),
    voiceId: z18.string().optional(),
    voiceAliases: z18.record(z18.string(), z18.string()).optional(),
    modelId: z18.string().optional(),
    outputFormat: z18.string().optional(),
    apiKey: SecretInputSchema.optional().register(sensitive),
    interruptOnSpeech: z18.boolean().optional(),
    silenceTimeoutMs: z18.number().int().positive().optional(),
  })
  .strict()
  .superRefine((talk, ctx) => {
    const provider = talk.provider?.trim().toLowerCase();
    const providers = talk.providers ? Object.keys(talk.providers) : [];
    if (provider && providers.length > 0 && !(provider in talk.providers)) {
      ctx.addIssue({
        code: z18.ZodIssueCode.custom,
        path: ["provider"],
        message: `talk.provider must match a key in talk.providers (missing "${provider}")`,
      });
    }
    if (!provider && providers.length > 1) {
      ctx.addIssue({
        code: z18.ZodIssueCode.custom,
        path: ["provider"],
        message: "talk.provider is required when talk.providers defines multiple providers",
      });
    }
  });
var McpServerSchema = z18
  .object({
    command: z18.string().optional(),
    args: z18.array(z18.string()).optional(),
    env: z18
      .record(z18.string(), z18.union([z18.string(), z18.number(), z18.boolean()]))
      .optional(),
    cwd: z18.string().optional(),
    workingDirectory: z18.string().optional(),
    url: HttpUrlSchema.optional(),
    headers: z18
      .record(
        z18.string(),
        z18
          .union([z18.string().register(sensitive), z18.number(), z18.boolean()])
          .register(sensitive),
      )
      .optional(),
  })
  .catchall(z18.unknown());
var McpConfigSchema = z18
  .object({
    servers: z18.record(z18.string(), McpServerSchema).optional(),
  })
  .strict()
  .optional();
var OpenClawSchema = z18
  .object({
    $schema: z18.string().optional(),
    meta: z18
      .object({
        lastTouchedVersion: z18.string().optional(),
        // Accept any string unchanged (backwards-compatible) and coerce numeric Unix
        // timestamps to ISO strings (agent file edits may write Date.now()).
        lastTouchedAt: z18
          .union([
            z18.string(),
            z18.number().transform((n, ctx) => {
              const d = new Date(n);
              if (Number.isNaN(d.getTime())) {
                ctx.addIssue({ code: z18.ZodIssueCode.custom, message: "Invalid timestamp" });
                return z18.NEVER;
              }
              return d.toISOString();
            }),
          ])
          .optional(),
      })
      .strict()
      .optional(),
    env: z18
      .object({
        shellEnv: z18
          .object({
            enabled: z18.boolean().optional(),
            timeoutMs: z18.number().int().nonnegative().optional(),
          })
          .strict()
          .optional(),
        vars: z18.record(z18.string(), z18.string()).optional(),
      })
      .catchall(z18.string())
      .optional(),
    wizard: z18
      .object({
        lastRunAt: z18.string().optional(),
        lastRunVersion: z18.string().optional(),
        lastRunCommit: z18.string().optional(),
        lastRunCommand: z18.string().optional(),
        lastRunMode: z18.union([z18.literal("local"), z18.literal("remote")]).optional(),
      })
      .strict()
      .optional(),
    diagnostics: z18
      .object({
        enabled: z18.boolean().optional(),
        flags: z18.array(z18.string()).optional(),
        stuckSessionWarnMs: z18.number().int().positive().optional(),
        otel: z18
          .object({
            enabled: z18.boolean().optional(),
            endpoint: z18.string().optional(),
            protocol: z18.union([z18.literal("http/protobuf"), z18.literal("grpc")]).optional(),
            headers: z18.record(z18.string(), z18.string()).optional(),
            serviceName: z18.string().optional(),
            traces: z18.boolean().optional(),
            metrics: z18.boolean().optional(),
            logs: z18.boolean().optional(),
            sampleRate: z18.number().min(0).max(1).optional(),
            flushIntervalMs: z18.number().int().nonnegative().optional(),
          })
          .strict()
          .optional(),
        cacheTrace: z18
          .object({
            enabled: z18.boolean().optional(),
            filePath: z18.string().optional(),
            includeMessages: z18.boolean().optional(),
            includePrompt: z18.boolean().optional(),
            includeSystem: z18.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    logging: z18
      .object({
        level: LoggingLevelSchema.optional(),
        file: z18.string().optional(),
        maxFileBytes: z18.number().int().positive().optional(),
        consoleLevel: LoggingLevelSchema.optional(),
        consoleStyle: z18
          .union([z18.literal("pretty"), z18.literal("compact"), z18.literal("json")])
          .optional(),
        redactSensitive: z18.union([z18.literal("off"), z18.literal("tools")]).optional(),
        redactPatterns: z18.array(z18.string()).optional(),
      })
      .strict()
      .optional(),
    cli: z18
      .object({
        banner: z18
          .object({
            taglineMode: z18
              .union([z18.literal("random"), z18.literal("default"), z18.literal("off")])
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    update: z18
      .object({
        channel: z18
          .union([z18.literal("stable"), z18.literal("beta"), z18.literal("dev")])
          .optional(),
        checkOnStart: z18.boolean().optional(),
        auto: z18
          .object({
            enabled: z18.boolean().optional(),
            stableDelayHours: z18.number().nonnegative().max(168).optional(),
            stableJitterHours: z18.number().nonnegative().max(168).optional(),
            betaCheckIntervalHours: z18.number().positive().max(24).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    browser: z18
      .object({
        enabled: z18.boolean().optional(),
        evaluateEnabled: z18.boolean().optional(),
        cdpUrl: z18.string().optional(),
        remoteCdpTimeoutMs: z18.number().int().nonnegative().optional(),
        remoteCdpHandshakeTimeoutMs: z18.number().int().nonnegative().optional(),
        color: z18.string().optional(),
        executablePath: z18.string().optional(),
        userDataDir: z18.string().optional(),
        headless: z18.boolean().optional(),
        noSandbox: z18.boolean().optional(),
        attachOnly: z18.boolean().optional(),
        cdpPortRangeStart: z18.number().int().min(1).max(65535).optional(),
        defaultProfile: z18.string().optional(),
        snapshotDefaults: BrowserSnapshotDefaultsSchema,
        ssrfPolicy: z18
          .object({
            allowPrivateNetwork: z18.boolean().optional(),
            dangerouslyAllowPrivateNetwork: z18.boolean().optional(),
            allowedHostnames: z18.array(z18.string()).optional(),
            hostnameAllowlist: z18.array(z18.string()).optional(),
          })
          .strict()
          .optional(),
        profiles: z18
          .record(
            z18
              .string()
              .regex(/^[a-z0-9-]+$/, "Profile names must be alphanumeric with hyphens only"),
            z18
              .object({
                cdpPort: z18.number().int().min(1).max(65535).optional(),
                cdpUrl: z18.string().optional(),
                userDataDir: z18.string().optional(),
                driver: z18
                  .union([
                    z18.literal("openclaw"),
                    z18.literal("clawd"),
                    z18.literal("existing-session"),
                  ])
                  .optional(),
                attachOnly: z18.boolean().optional(),
                color: HexColorSchema,
              })
              .strict()
              .refine(
                (value) => value.driver === "existing-session" || value.cdpPort || value.cdpUrl,
                {
                  message: "Profile must set cdpPort or cdpUrl",
                },
              )
              .refine((value) => value.driver === "existing-session" || !value.userDataDir, {
                message: 'Profile userDataDir is only supported with driver="existing-session"',
              }),
          )
          .optional(),
        extraArgs: z18.array(z18.string()).optional(),
      })
      .strict()
      .optional(),
    ui: z18
      .object({
        seamColor: HexColorSchema.optional(),
        assistant: z18
          .object({
            name: z18.string().max(50).optional(),
            avatar: z18.string().max(200).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    secrets: SecretsConfigSchema,
    auth: z18
      .object({
        profiles: z18
          .record(
            z18.string(),
            z18
              .object({
                provider: z18.string(),
                mode: z18.union([
                  z18.literal("api_key"),
                  z18.literal("oauth"),
                  z18.literal("token"),
                ]),
                email: z18.string().optional(),
                displayName: z18.string().optional(),
              })
              .strict(),
          )
          .optional(),
        order: z18.record(z18.string(), z18.array(z18.string())).optional(),
        cooldowns: z18
          .object({
            billingBackoffHours: z18.number().positive().optional(),
            billingBackoffHoursByProvider: z18
              .record(z18.string(), z18.number().positive())
              .optional(),
            billingMaxHours: z18.number().positive().optional(),
            failureWindowHours: z18.number().positive().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    acp: z18
      .object({
        enabled: z18.boolean().optional(),
        dispatch: z18
          .object({
            enabled: z18.boolean().optional(),
          })
          .strict()
          .optional(),
        backend: z18.string().optional(),
        defaultAgent: z18.string().optional(),
        allowedAgents: z18.array(z18.string()).optional(),
        maxConcurrentSessions: z18.number().int().positive().optional(),
        stream: z18
          .object({
            coalesceIdleMs: z18.number().int().nonnegative().optional(),
            maxChunkChars: z18.number().int().positive().optional(),
            repeatSuppression: z18.boolean().optional(),
            deliveryMode: z18.union([z18.literal("live"), z18.literal("final_only")]).optional(),
            hiddenBoundarySeparator: z18
              .union([
                z18.literal("none"),
                z18.literal("space"),
                z18.literal("newline"),
                z18.literal("paragraph"),
              ])
              .optional(),
            maxOutputChars: z18.number().int().positive().optional(),
            maxSessionUpdateChars: z18.number().int().positive().optional(),
            tagVisibility: z18.record(z18.string(), z18.boolean()).optional(),
          })
          .strict()
          .optional(),
        runtime: z18
          .object({
            ttlMinutes: z18.number().int().positive().optional(),
            installCommand: z18.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    models: ModelsConfigSchema,
    nodeHost: NodeHostSchema,
    agents: AgentsSchema,
    tools: ToolsSchema,
    bindings: BindingsSchema,
    broadcast: BroadcastSchema,
    audio: AudioSchema,
    media: z18
      .object({
        preserveFilenames: z18.boolean().optional(),
        ttlHours: z18
          .number()
          .int()
          .min(1)
          .max(24 * 7)
          .optional(),
      })
      .strict()
      .optional(),
    messages: MessagesSchema,
    commands: CommandsSchema,
    approvals: ApprovalsSchema,
    session: SessionSchema,
    cron: z18
      .object({
        enabled: z18.boolean().optional(),
        store: z18.string().optional(),
        maxConcurrentRuns: z18.number().int().positive().optional(),
        retry: z18
          .object({
            maxAttempts: z18.number().int().min(0).max(10).optional(),
            backoffMs: z18.array(z18.number().int().nonnegative()).min(1).max(10).optional(),
            retryOn: z18
              .array(z18.enum(["rate_limit", "overloaded", "network", "timeout", "server_error"]))
              .min(1)
              .optional(),
          })
          .strict()
          .optional(),
        webhook: HttpUrlSchema.optional(),
        webhookToken: SecretInputSchema.optional().register(sensitive),
        sessionRetention: z18.union([z18.string(), z18.literal(false)]).optional(),
        runLog: z18
          .object({
            maxBytes: z18.union([z18.string(), z18.number()]).optional(),
            keepLines: z18.number().int().positive().optional(),
          })
          .strict()
          .optional(),
        failureAlert: z18
          .object({
            enabled: z18.boolean().optional(),
            after: z18.number().int().min(1).optional(),
            cooldownMs: z18.number().int().min(0).optional(),
            mode: z18.enum(["announce", "webhook"]).optional(),
            accountId: z18.string().optional(),
          })
          .strict()
          .optional(),
        failureDestination: z18
          .object({
            channel: z18.string().optional(),
            to: z18.string().optional(),
            accountId: z18.string().optional(),
            mode: z18.enum(["announce", "webhook"]).optional(),
          })
          .strict()
          .optional(),
        selfHeal: z18
          .object({
            enabled: z18.boolean().optional(),
            maxAttempts: z18.number().int().min(0).optional(),
            backoffMs: z18.array(z18.number().int().min(0)).optional(),
            retryDelay: z18.string().optional(),
            maxAttemptsPerRun: z18.number().int().min(1).optional(),
            match: z18.array(z18.string()).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .superRefine((val, ctx) => {
        if (val.sessionRetention !== void 0 && val.sessionRetention !== false) {
          try {
            parseDurationMs(String(val.sessionRetention).trim(), { defaultUnit: "h" });
          } catch {
            ctx.addIssue({
              code: z18.ZodIssueCode.custom,
              path: ["sessionRetention"],
              message: "invalid duration (use ms, s, m, h, d)",
            });
          }
        }
        if (val.runLog?.maxBytes !== void 0) {
          try {
            parseByteSize(String(val.runLog.maxBytes).trim(), { defaultUnit: "b" });
          } catch {
            ctx.addIssue({
              code: z18.ZodIssueCode.custom,
              path: ["runLog", "maxBytes"],
              message: "invalid size (use b, kb, mb, gb, tb)",
            });
          }
        }
      })
      .optional(),
    hooks: z18
      .object({
        enabled: z18.boolean().optional(),
        path: z18.string().optional(),
        token: z18.string().optional().register(sensitive),
        defaultSessionKey: z18.string().optional(),
        allowRequestSessionKey: z18.boolean().optional(),
        allowedSessionKeyPrefixes: z18.array(z18.string()).optional(),
        allowedAgentIds: z18.array(z18.string()).optional(),
        maxBodyBytes: z18.number().int().positive().optional(),
        presets: z18.array(z18.string()).optional(),
        transformsDir: z18.string().optional(),
        mappings: z18.array(HookMappingSchema).optional(),
        gmail: HooksGmailSchema,
        internal: InternalHooksSchema,
      })
      .strict()
      .optional(),
    web: z18
      .object({
        enabled: z18.boolean().optional(),
        heartbeatSeconds: z18.number().int().positive().optional(),
        reconnect: z18
          .object({
            initialMs: z18.number().positive().optional(),
            maxMs: z18.number().positive().optional(),
            factor: z18.number().positive().optional(),
            jitter: z18.number().min(0).max(1).optional(),
            maxAttempts: z18.number().int().min(0).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    channels: ChannelsSchema,
    discovery: z18
      .object({
        wideArea: z18
          .object({
            enabled: z18.boolean().optional(),
            domain: z18.string().optional(),
          })
          .strict()
          .optional(),
        mdns: z18
          .object({
            mode: z18.enum(["off", "minimal", "full"]).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    canvasHost: z18
      .object({
        enabled: z18.boolean().optional(),
        root: z18.string().optional(),
        port: z18.number().int().positive().optional(),
        liveReload: z18.boolean().optional(),
      })
      .strict()
      .optional(),
    talk: TalkSchema.optional(),
    gateway: z18
      .object({
        port: z18.number().int().positive().optional(),
        mode: z18.union([z18.literal("local"), z18.literal("remote")]).optional(),
        bind: z18
          .union([
            z18.literal("auto"),
            z18.literal("lan"),
            z18.literal("loopback"),
            z18.literal("custom"),
            z18.literal("tailnet"),
          ])
          .optional(),
        customBindHost: z18.string().optional(),
        controlUi: z18
          .object({
            enabled: z18.boolean().optional(),
            basePath: z18.string().optional(),
            root: z18.string().optional(),
            allowedOrigins: z18.array(z18.string()).optional(),
            dangerouslyAllowHostHeaderOriginFallback: z18.boolean().optional(),
            allowInsecureAuth: z18.boolean().optional(),
            dangerouslyDisableDeviceAuth: z18.boolean().optional(),
          })
          .strict()
          .optional(),
        auth: z18
          .object({
            mode: z18
              .union([
                z18.literal("none"),
                z18.literal("token"),
                z18.literal("password"),
                z18.literal("trusted-proxy"),
              ])
              .optional(),
            token: SecretInputSchema.optional().register(sensitive),
            password: SecretInputSchema.optional().register(sensitive),
            allowTailscale: z18.boolean().optional(),
            rateLimit: z18
              .object({
                maxAttempts: z18.number().optional(),
                windowMs: z18.number().optional(),
                lockoutMs: z18.number().optional(),
                exemptLoopback: z18.boolean().optional(),
              })
              .strict()
              .optional(),
            trustedProxy: z18
              .object({
                userHeader: z18.string().min(1, "userHeader is required for trusted-proxy mode"),
                requiredHeaders: z18.array(z18.string()).optional(),
                allowUsers: z18.array(z18.string()).optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
        trustedProxies: z18.array(z18.string()).optional(),
        allowRealIpFallback: z18.boolean().optional(),
        tools: z18
          .object({
            deny: z18.array(z18.string()).optional(),
            allow: z18.array(z18.string()).optional(),
          })
          .strict()
          .optional(),
        channelHealthCheckMinutes: z18.number().int().min(0).optional(),
        channelStaleEventThresholdMinutes: z18.number().int().min(1).optional(),
        channelMaxRestartsPerHour: z18.number().int().min(1).optional(),
        tailscale: z18
          .object({
            mode: z18
              .union([z18.literal("off"), z18.literal("serve"), z18.literal("funnel")])
              .optional(),
            resetOnExit: z18.boolean().optional(),
          })
          .strict()
          .optional(),
        remote: z18
          .object({
            url: z18.string().optional(),
            transport: z18.union([z18.literal("ssh"), z18.literal("direct")]).optional(),
            token: SecretInputSchema.optional().register(sensitive),
            password: SecretInputSchema.optional().register(sensitive),
            tlsFingerprint: z18.string().optional(),
            sshTarget: z18.string().optional(),
            sshIdentity: z18.string().optional(),
          })
          .strict()
          .optional(),
        reload: z18
          .object({
            mode: z18
              .union([
                z18.literal("off"),
                z18.literal("restart"),
                z18.literal("hot"),
                z18.literal("hybrid"),
              ])
              .optional(),
            debounceMs: z18.number().int().min(0).optional(),
            deferralTimeoutMs: z18.number().int().min(0).optional(),
          })
          .strict()
          .optional(),
        tls: z18
          .object({
            enabled: z18.boolean().optional(),
            autoGenerate: z18.boolean().optional(),
            certPath: z18.string().optional(),
            keyPath: z18.string().optional(),
            caPath: z18.string().optional(),
          })
          .optional(),
        http: z18
          .object({
            endpoints: z18
              .object({
                chatCompletions: z18
                  .object({
                    enabled: z18.boolean().optional(),
                    maxBodyBytes: z18.number().int().positive().optional(),
                    maxImageParts: z18.number().int().nonnegative().optional(),
                    maxTotalImageBytes: z18.number().int().positive().optional(),
                    images: z18
                      .object({
                        ...ResponsesEndpointUrlFetchShape,
                      })
                      .strict()
                      .optional(),
                  })
                  .strict()
                  .optional(),
                responses: z18
                  .object({
                    enabled: z18.boolean().optional(),
                    maxBodyBytes: z18.number().int().positive().optional(),
                    maxUrlParts: z18.number().int().nonnegative().optional(),
                    files: z18
                      .object({
                        ...ResponsesEndpointUrlFetchShape,
                        maxChars: z18.number().int().positive().optional(),
                        pdf: z18
                          .object({
                            maxPages: z18.number().int().positive().optional(),
                            maxPixels: z18.number().int().positive().optional(),
                            minTextChars: z18.number().int().nonnegative().optional(),
                          })
                          .strict()
                          .optional(),
                      })
                      .strict()
                      .optional(),
                    images: z18
                      .object({
                        ...ResponsesEndpointUrlFetchShape,
                      })
                      .strict()
                      .optional(),
                  })
                  .strict()
                  .optional(),
              })
              .strict()
              .optional(),
            securityHeaders: z18
              .object({
                strictTransportSecurity: z18.union([z18.string(), z18.literal(false)]).optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
        push: z18
          .object({
            apns: z18
              .object({
                relay: z18
                  .object({
                    baseUrl: z18.string().optional(),
                    timeoutMs: z18.number().int().positive().optional(),
                  })
                  .strict()
                  .optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
        nodes: z18
          .object({
            browser: z18
              .object({
                mode: z18
                  .union([z18.literal("auto"), z18.literal("manual"), z18.literal("off")])
                  .optional(),
                node: z18.string().optional(),
              })
              .strict()
              .optional(),
            allowCommands: z18.array(z18.string()).optional(),
            denyCommands: z18.array(z18.string()).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .superRefine((gateway, ctx) => {
        const effectiveHealthCheckMinutes = gateway.channelHealthCheckMinutes ?? 5;
        if (
          gateway.channelStaleEventThresholdMinutes != null &&
          effectiveHealthCheckMinutes !== 0 &&
          gateway.channelStaleEventThresholdMinutes < effectiveHealthCheckMinutes
        ) {
          ctx.addIssue({
            code: z18.ZodIssueCode.custom,
            path: ["channelStaleEventThresholdMinutes"],
            message:
              "channelStaleEventThresholdMinutes should be >= channelHealthCheckMinutes to avoid delayed stale detection",
          });
        }
      })
      .optional(),
    memory: MemorySchema,
    mcp: McpConfigSchema,
    skills: z18
      .object({
        allowBundled: z18.array(z18.string()).optional(),
        load: z18
          .object({
            extraDirs: z18.array(z18.string()).optional(),
            watch: z18.boolean().optional(),
            watchDebounceMs: z18.number().int().min(0).optional(),
          })
          .strict()
          .optional(),
        install: z18
          .object({
            preferBrew: z18.boolean().optional(),
            nodeManager: z18
              .union([
                z18.literal("npm"),
                z18.literal("pnpm"),
                z18.literal("yarn"),
                z18.literal("bun"),
              ])
              .optional(),
          })
          .strict()
          .optional(),
        limits: z18
          .object({
            maxCandidatesPerRoot: z18.number().int().min(1).optional(),
            maxSkillsLoadedPerSource: z18.number().int().min(1).optional(),
            maxSkillsInPrompt: z18.number().int().min(0).optional(),
            maxSkillsPromptChars: z18.number().int().min(0).optional(),
            maxSkillFileBytes: z18.number().int().min(0).optional(),
          })
          .strict()
          .optional(),
        entries: z18.record(z18.string(), SkillEntrySchema).optional(),
      })
      .strict()
      .optional(),
    plugins: z18
      .object({
        enabled: z18.boolean().optional(),
        allow: z18.array(z18.string()).optional(),
        deny: z18.array(z18.string()).optional(),
        load: z18
          .object({
            paths: z18.array(z18.string()).optional(),
          })
          .strict()
          .optional(),
        slots: z18
          .object({
            memory: z18.string().optional(),
            contextEngine: z18.string().optional(),
          })
          .strict()
          .optional(),
        entries: z18.record(z18.string(), PluginEntrySchema).optional(),
        installs: z18
          .record(
            z18.string(),
            z18
              .object({
                ...PluginInstallRecordShape,
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const agents = cfg.agents?.list ?? [];
    if (agents.length === 0) {
      return;
    }
    const agentIds = new Set(agents.map((agent) => agent.id));
    const broadcast = cfg.broadcast;
    if (!broadcast) {
      return;
    }
    for (const [peerId, ids] of Object.entries(broadcast)) {
      if (peerId === "strategy") {
        continue;
      }
      if (!Array.isArray(ids)) {
        continue;
      }
      for (let idx = 0; idx < ids.length; idx += 1) {
        const agentId = ids[idx];
        if (!agentIds.has(agentId)) {
          ctx.addIssue({
            code: z18.ZodIssueCode.custom,
            path: ["broadcast", peerId, idx],
            message: `Unknown agent id "${agentId}" (not in agents.list).`,
          });
        }
      }
    }
  });

// src/config/validation.ts
var bundledChannelSchemaById = new Map(
  GENERATED_BUNDLED_CHANNEL_CONFIG_METADATA.map((entry) => [entry.channelId, entry.schema]),
);

// src/logging/diagnostic-session-state.ts
var SESSION_STATE_TTL_MS = 30 * 60 * 1e3;
var SESSION_STATE_PRUNE_INTERVAL_MS = 60 * 1e3;

// src/logging/diagnostic.ts
var diag = createSubsystemLogger("diagnostic");
var MAX_STUCK_SESSION_WARN_MS = 24 * 60 * 60 * 1e3;

// src/markdown/ir.ts
import MarkdownIt from "markdown-it";

// src/markdown/render.ts
var STYLE_ORDER = [
  "blockquote",
  "code_block",
  "code",
  "bold",
  "italic",
  "strikethrough",
  "spoiler",
];
var STYLE_RANK = new Map(STYLE_ORDER.map((style, index) => [style, index]));

// src/shared/text/auto-linked-file-ref.ts
var FILE_REF_EXTENSIONS = ["md", "go", "py", "pl", "sh", "am", "at", "be", "cc"];
var FILE_REF_EXTENSIONS_WITH_TLD = new Set(FILE_REF_EXTENSIONS);

// extensions/whatsapp/src/creds-files.ts
import fsSync2 from "node:fs";
import path21 from "node:path";
function resolveWebCredsPath(authDir) {
  return path21.join(authDir, "creds.json");
}
function resolveWebCredsBackupPath(authDir) {
  return path21.join(authDir, "creds.json.bak");
}
function hasWebCredsSync(authDir) {
  try {
    const stats = fsSync2.statSync(resolveWebCredsPath(authDir));
    return stats.isFile() && stats.size > 1;
  } catch {
    return false;
  }
}

// extensions/whatsapp/src/identity.ts
var WHATSAPP_LID_RE = /@(lid|hosted\.lid)$/i;
function normalizeDeviceScopedJid(jid) {
  return jid ? jid.replace(/:\d+/, "") : null;
}
function isLidJid(jid) {
  return Boolean(jid && WHATSAPP_LID_RE.test(jid));
}
function resolveComparableIdentity(identity, authDir) {
  const rawJid = normalizeDeviceScopedJid(identity?.jid);
  const rawLid = normalizeDeviceScopedJid(identity?.lid);
  const lid = rawLid ?? (isLidJid(rawJid) ? rawJid : null);
  const jid = rawJid && !isLidJid(rawJid) ? rawJid : null;
  const e164 =
    identity?.e164 != null
      ? normalizeE164(identity.e164)
      : ((jid ? jidToE164(jid, authDir ? { authDir } : void 0) : null) ??
        (lid ? jidToE164(lid, authDir ? { authDir } : void 0) : null));
  return {
    ...identity,
    jid,
    lid,
    e164,
  };
}

// extensions/whatsapp/src/auth-store.ts
function resolveDefaultWebAuthDir() {
  return path22.join(resolveOAuthDir(), "whatsapp", DEFAULT_ACCOUNT_ID);
}
var WA_WEB_AUTH_DIR = resolveDefaultWebAuthDir();
function readCredsJsonRaw(filePath) {
  try {
    if (!fsSync3.existsSync(filePath)) {
      return null;
    }
    const stats = fsSync3.statSync(filePath);
    if (!stats.isFile() || stats.size <= 1) {
      return null;
    }
    return fsSync3.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}
function maybeRestoreCredsFromBackup(authDir) {
  const logger = getChildLogger({ module: "web-session" });
  try {
    const credsPath = resolveWebCredsPath(authDir);
    const backupPath = resolveWebCredsBackupPath(authDir);
    const raw = readCredsJsonRaw(credsPath);
    if (raw) {
      JSON.parse(raw);
      return;
    }
    const backupRaw = readCredsJsonRaw(backupPath);
    if (!backupRaw) {
      return;
    }
    JSON.parse(backupRaw);
    fsSync3.copyFileSync(backupPath, credsPath);
    try {
      fsSync3.chmodSync(credsPath, 384);
    } catch {}
    logger.warn({ credsPath }, "restored corrupted WhatsApp creds.json from backup");
  } catch {}
}
async function webAuthExists(authDir = resolveDefaultWebAuthDir()) {
  const resolvedAuthDir = resolveUserPath2(authDir);
  maybeRestoreCredsFromBackup(resolvedAuthDir);
  const credsPath = resolveWebCredsPath(resolvedAuthDir);
  try {
    await fs13.access(resolvedAuthDir);
  } catch {
    return false;
  }
  try {
    const stats = await fs13.stat(credsPath);
    if (!stats.isFile() || stats.size <= 1) {
      return false;
    }
    const raw = await fs13.readFile(credsPath, "utf-8");
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}
async function clearLegacyBaileysAuthState(authDir) {
  const entries = await fs13.readdir(authDir, { withFileTypes: true });
  const shouldDelete = (name) => {
    if (name === "oauth.json") {
      return false;
    }
    if (name === "creds.json" || name === "creds.json.bak") {
      return true;
    }
    if (!name.endsWith(".json")) {
      return false;
    }
    return /^(app-state-sync|session|sender-key|pre-key)-/.test(name);
  };
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile()) {
        return;
      }
      if (!shouldDelete(entry.name)) {
        return;
      }
      await fs13.rm(path22.join(authDir, entry.name), { force: true });
    }),
  );
}
async function logoutWeb(params) {
  const runtime = params.runtime ?? defaultRuntime;
  const resolvedAuthDir = resolveUserPath2(params.authDir ?? resolveDefaultWebAuthDir());
  const exists = await webAuthExists(resolvedAuthDir);
  if (!exists) {
    runtime.log(info("No WhatsApp Web session found; nothing to delete."));
    return false;
  }
  if (params.isLegacyAuthDir) {
    await clearLegacyBaileysAuthState(resolvedAuthDir);
  } else {
    await fs13.rm(resolvedAuthDir, { recursive: true, force: true });
  }
  runtime.log(success("Cleared WhatsApp Web credentials."));
  return true;
}
function readWebSelfId(authDir = resolveDefaultWebAuthDir()) {
  try {
    const credsPath = resolveWebCredsPath(resolveUserPath2(authDir));
    if (!fsSync3.existsSync(credsPath)) {
      return { e164: null, jid: null, lid: null };
    }
    const raw = fsSync3.readFileSync(credsPath, "utf-8");
    const parsed = JSON.parse(raw);
    const identity = resolveComparableIdentity(
      {
        jid: parsed?.me?.id ?? null,
        lid: parsed?.me?.lid ?? null,
      },
      authDir,
    );
    return {
      e164: identity.e164 ?? null,
      jid: identity.jid ?? null,
      lid: identity.lid ?? null,
    };
  } catch {
    return { e164: null, jid: null, lid: null };
  }
}
async function readWebSelfIdentity(authDir = resolveDefaultWebAuthDir(), fallback) {
  const resolvedAuthDir = resolveUserPath2(authDir);
  maybeRestoreCredsFromBackup(resolvedAuthDir);
  try {
    const raw = await fs13.readFile(resolveWebCredsPath(resolvedAuthDir), "utf-8");
    const parsed = JSON.parse(raw);
    return resolveComparableIdentity(
      {
        jid: parsed?.me?.id ?? null,
        lid: parsed?.me?.lid ?? null,
      },
      resolvedAuthDir,
    );
  } catch {
    return resolveComparableIdentity(
      {
        jid: fallback?.id ?? null,
        lid: fallback?.lid ?? null,
      },
      resolvedAuthDir,
    );
  }
}
function getWebAuthAgeMs(authDir = resolveDefaultWebAuthDir()) {
  try {
    const stats = fsSync3.statSync(resolveWebCredsPath(resolveUserPath2(authDir)));
    return Date.now() - stats.mtimeMs;
  } catch {
    return null;
  }
}
function logWebSelfId(
  authDir = resolveDefaultWebAuthDir(),
  runtime = defaultRuntime,
  includeChannelPrefix = false,
) {
  const { e164, jid, lid } = readWebSelfId(authDir);
  const parts = [jid ? `jid ${jid}` : null, lid ? `lid ${lid}` : null].filter((value) =>
    Boolean(value),
  );
  const details =
    e164 || parts.length > 0
      ? `${e164 ?? "unknown"}${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`
      : "unknown";
  const prefix = includeChannelPrefix ? "Web Channel: " : "";
  runtime.log(info(`${prefix}${details}`));
}
async function pickWebChannel(pref, authDir = resolveDefaultWebAuthDir()) {
  const choice = pref === "auto" ? "web" : pref;
  const hasWeb = await webAuthExists(authDir);
  if (!hasWeb) {
    throw new Error(
      `No WhatsApp Web session found. Run \`${formatCliCommand("openclaw channels login --channel whatsapp --verbose")}\` to link.`,
    );
  }
  return choice;
}
export {
  WA_WEB_AUTH_DIR,
  getWebAuthAgeMs,
  hasWebCredsSync,
  logWebSelfId,
  logoutWeb,
  maybeRestoreCredsFromBackup,
  pickWebChannel,
  readCredsJsonRaw,
  readWebSelfId,
  readWebSelfIdentity,
  resolveDefaultWebAuthDir,
  resolveWebCredsBackupPath,
  resolveWebCredsPath,
  webAuthExists,
};
