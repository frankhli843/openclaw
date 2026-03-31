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
    const require2 = createRequire(moduleUrl);
    for (const candidate of candidates) {
      try {
        const parsed = require2(candidate);
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

// src/logging/subsystem.ts
import { Chalk as Chalk2 } from "chalk";

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

// src/logging/node-require.ts
function resolveNodeRequireFromMeta(metaUrl) {
  const getBuiltinModule = process.getBuiltinModule;
  if (typeof getBuiltinModule !== "function") {
    return null;
  }
  try {
    const moduleNamespace = getBuiltinModule("module");
    const createRequire2 =
      typeof moduleNamespace.createRequire === "function" ? moduleNamespace.createRequire : null;
    return createRequire2 ? createRequire2(metaUrl) : null;
  } catch {
    return null;
  }
}

// src/logging/config.ts
var requireConfig = resolveNodeRequireFromMeta(import.meta.url);

// src/infra/tmp-openclaw-dir.ts
import fs2 from "node:fs";
import { tmpdir as getOsTmpDir } from "node:os";
// src/logging/logger.ts
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
    const state3 = resolveDirState(fallbackPath);
    if (state3 === "available") {
      return fallbackPath;
    }
    if (state3 === "invalid") {
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
var MAX_LOG_AGE_MS = 24 * 60 * 60 * 1e3;
var DEFAULT_MAX_LOG_FILE_BYTES = 500 * 1024 * 1024;
var requireConfig2 = resolveNodeRequireFromMeta(import.meta.url);

// src/logging/console.ts
var requireConfig3 = resolveNodeRequireFromMeta(import.meta.url);

// src/logging/subsystem.ts
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

// src/routing/account-id.ts
var DEFAULT_ACCOUNT_ID = "default";

// src/utils.ts
import fs3 from "node:fs";
import os3 from "node:os";
import path6 from "node:path";

// src/globals.ts
var success = theme.success;
var warn = theme.warn;
var info = theme.info;
var danger = theme.error;

// src/utils.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    const hasNew = fs3.existsSync(newDir);
    if (hasNew) {
      return newDir;
    }
  } catch {}
  return newDir;
}
var CONFIG_DIR = resolveConfigDir();

// src/infra/boundary-file-read.ts
import fs6 from "node:fs";
// src/infra/boundary-path.ts
import fs4 from "node:fs";
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
  const state3 = createLexicalTraversalState(params);
  for (let idx = 0; idx < state3.segments.length; idx += 1) {
    const segment = state3.segments[idx] ?? "";
    const isLast = idx === state3.segments.length - 1;
    state3.lexicalCursor = path8.join(state3.lexicalCursor, segment);
    const maybeStat = readLexicalStat({
      state: state3,
      missingFromIndex: idx,
      rootCanonicalPath: params.rootCanonicalPath,
      resolveParams: params.params,
      absolutePath: params.absolutePath,
      read: (cursor) => fs4.lstatSync(cursor),
    });
    if (isPromiseLike(maybeStat)) {
      throw new Error("Unexpected async lexical stat");
    }
    const stat = maybeStat;
    if (!stat) {
      break;
    }
    const disposition = handleLexicalStatDisposition({
      state: state3,
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
      state: state3,
      rootCanonicalPath: params.rootCanonicalPath,
      boundaryLabel: params.params.boundaryLabel,
      resolveLinkCanonical: (cursor) => resolveSymlinkHopPathSync(cursor),
    });
    if (isPromiseLike(maybeApplied)) {
      throw new Error("Unexpected async symlink resolution");
    }
  }
  const kind = getPathKindSync(params.absolutePath, state3.preserveFinalSymlink);
  return finalizeLexicalResolution({
    ...params,
    state: state3,
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
  while (!isFilesystemRoot(cursor) && !fs4.existsSync(cursor)) {
    missingSuffix.unshift(path8.basename(cursor));
    const parent = path8.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  if (!fs4.existsSync(cursor)) {
    return normalized;
  }
  try {
    const resolvedAncestor = path8.resolve(fs4.realpathSync(cursor));
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
    const stat = preserveFinalSymlink ? fs4.lstatSync(absolutePath) : fs4.statSync(absolutePath);
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
    return path8.resolve(fs4.realpathSync(symlinkPath));
  } catch (error) {
    if (!isNotFoundPathError(error)) {
      throw error;
    }
    const linkTarget = fs4.readlinkSync(symlinkPath);
    const linkAbsolute = path8.resolve(path8.dirname(symlinkPath), linkTarget);
    return resolvePathViaExistingAncestorSync(linkAbsolute);
  }
}

// src/infra/safe-open-sync.ts
import fs5 from "node:fs";

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
  const ioFs = params.ioFs ?? fs5;
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
  const ioFs = params.ioFs ?? fs6;
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
import fs9 from "node:fs";
import path16 from "node:path";
// src/config/zod-schema.core.ts
import path13 from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";
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
  const path17 = Array.isArray(record.path)
    ? record.path.filter((segment) => {
        const kind = typeof segment;
        return kind === "string" || kind === "number";
      })
    : void 0;
  return {
    ...record,
    ...(path17 ? { path: path17 } : {}),
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

// src/plugins/manifest.ts
import fs7 from "node:fs";
import path14 from "node:path";

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
    const candidate = path14.join(rootDir, filename);
    if (fs7.existsSync(candidate)) {
      return candidate;
    }
  }
  return path14.join(rootDir, PLUGIN_MANIFEST_FILENAME);
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
    raw = JSON.parse(fs7.readFileSync(opened.fd, "utf-8"));
  } catch (err) {
    return {
      ok: false,
      error: `failed to parse plugin manifest: ${String(err)}`,
      manifestPath,
    };
  } finally {
    fs7.closeSync(opened.fd);
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
import fs8 from "node:fs";
import path15 from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
var STARTUP_ARGV1 = process.argv[1];
function resolveLoaderModulePath(params = {}) {
  return params.modulePath ?? fileURLToPath3(params.moduleUrl ?? import.meta.url);
}
function readPluginSdkPackageJson(packageRoot) {
  try {
    const pkgRaw = fs8.readFileSync(path15.join(packageRoot, "package.json"), "utf-8");
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
  const hasOpenClawEntrypoint = fs8.existsSync(path15.join(params.packageRoot, "openclaw.mjs"));
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
  let cursor = path15.resolve(startDir);
  for (let i = 0; i < maxDepth; i += 1) {
    const subpaths = readPluginSdkSubpathsFromPackageRoot(cursor);
    if (subpaths) {
      return cursor;
    }
    const parent = path15.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  return null;
}
function resolveLoaderPackageRoot(params) {
  const cwd = params.cwd ?? path15.dirname(params.modulePath);
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
  const cwd = params.cwd ?? path15.dirname(params.modulePath);
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
    findNearestPluginSdkPackageRoot(path15.dirname(params.modulePath)) ??
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
      src: path15.join(packageRoot, "src", "plugin-sdk", params.srcFile),
      dist: path15.join(packageRoot, "dist", "plugin-sdk", params.distFile),
    };
    return orderedKinds.map((kind) => candidateMap[kind]);
  }
  let cursor = path15.dirname(params.modulePath);
  const candidates = [];
  for (let i = 0; i < 6; i += 1) {
    const candidateMap = {
      src: path15.join(cursor, "src", "plugin-sdk", params.srcFile),
      dist: path15.join(cursor, "dist", "plugin-sdk", params.distFile),
    };
    for (const kind of orderedKinds) {
      candidates.push(candidateMap[kind]);
    }
    const parent = path15.dirname(cursor);
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
      if (fs8.existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {}
  return null;
}
var cachedPluginSdkExportedSubpaths = /* @__PURE__ */ new Map();
var cachedPluginSdkScopedAliasMaps = /* @__PURE__ */ new Map();
function listPluginSdkExportedSubpaths(params = {}) {
  const modulePath = params.modulePath ?? fileURLToPath3(import.meta.url);
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
  const modulePath = params.modulePath ?? fileURLToPath3(import.meta.url);
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
      src: path15.join(packageRoot, "src", "plugin-sdk", `${subpath}.ts`),
      dist: path15.join(packageRoot, "dist", "plugin-sdk", `${subpath}.js`),
    };
    for (const kind of orderedKinds) {
      const candidate = candidateMap[kind];
      if (fs8.existsSync(candidate)) {
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
      src: path15.join(packageRoot, "src", "extensionAPI.ts"),
      dist: path15.join(packageRoot, "dist", "extensionAPI.js"),
    };
    for (const kind of orderedKinds) {
      const candidate = candidateMap[kind];
      if (fs8.existsSync(candidate)) {
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
  switch (path15.extname(modulePath).toLowerCase()) {
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
    modulePath: fileURLToPath4(import.meta.url),
    moduleUrl: import.meta.url,
  }) ?? fileURLToPath4(new URL("../..", import.meta.url));
var CURRENT_MODULE_PATH = fileURLToPath4(import.meta.url);
var RUNNING_FROM_BUILT_ARTIFACT =
  CURRENT_MODULE_PATH.includes(`${path16.sep}dist${path16.sep}`) ||
  CURRENT_MODULE_PATH.includes(`${path16.sep}dist-runtime${path16.sep}`);
var PUBLIC_SURFACE_SOURCE_EXTENSIONS = [".ts", ".mts", ".js", ".mjs", ".cts", ".cjs"];
var RUNTIME_SIDECAR_ARTIFACTS = /* @__PURE__ */ new Set([
  "helper-api.js",
  "light-runtime-api.js",
  "runtime-api.js",
  "thread-bindings-runtime.js",
]);
var SOURCE_CONFIG_SCHEMA_CANDIDATES = [
  path16.join("src", "config-schema.ts"),
  path16.join("src", "config-schema.js"),
  path16.join("src", "config-schema.mts"),
  path16.join("src", "config-schema.mjs"),
  path16.join("src", "config-schema.cts"),
  path16.join("src", "config-schema.cjs"),
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
  const packagePath = path16.join(pluginDir, "package.json");
  if (!fs9.existsSync(packagePath)) {
    return void 0;
  }
  try {
    return JSON.parse(fs9.readFileSync(packagePath, "utf-8"));
  } catch {
    return void 0;
  }
}
function deriveIdHint(params) {
  const base = path16.basename(params.entryPath, path16.extname(params.entryPath));
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
  if (!PUBLIC_SURFACE_SOURCE_EXTENSIONS.includes(path16.extname(name))) {
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
      .map((entry) => path16.basename(entry)),
  );
  const artifacts = fs9
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
  const sourceDir = path16.join(packageRoot, "extensions");
  const runtimeDir = path16.join(packageRoot, "dist-runtime", "extensions");
  const builtDir = path16.join(packageRoot, "dist", "extensions");
  if (RUNNING_FROM_BUILT_ARTIFACT) {
    if (fs9.existsSync(builtDir)) {
      return builtDir;
    }
    if (fs9.existsSync(runtimeDir)) {
      return runtimeDir;
    }
  }
  if (fs9.existsSync(sourceDir)) {
    return sourceDir;
  }
  if (fs9.existsSync(runtimeDir) && fs9.existsSync(builtDir)) {
    return runtimeDir;
  }
  if (fs9.existsSync(builtDir)) {
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
    shouldPreferNativeJiti(modulePath) || modulePath.includes(`${path16.sep}dist${path16.sep}`);
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
    const candidate = path16.join(pluginDir, relativePath);
    if (fs9.existsSync(candidate)) {
      return candidate;
    }
  }
  for (const basename of PUBLIC_CONFIG_SURFACE_BASENAMES) {
    for (const extension of PUBLIC_SURFACE_SOURCE_EXTENSIONS) {
      const candidate = path16.join(pluginDir, `${basename}${extension}`);
      if (fs9.existsSync(candidate)) {
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
  if (!scanDir || !fs9.existsSync(scanDir)) {
    return [];
  }
  const entries = [];
  for (const dirName of fs9
    .readdirSync(scanDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted((left, right) => left.localeCompare(right))) {
    const pluginDir = path16.join(scanDir, dirName);
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
  const rootDir = path16.resolve(params?.rootDir ?? OPENCLAW_PACKAGE_ROOT);
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

// extensions/whatsapp/src/active-listener.ts
var WHATSAPP_ACTIVE_LISTENER_STATE_KEY = /* @__PURE__ */ Symbol.for(
  "openclaw.whatsapp.activeListenerState",
);
var g = globalThis;
if (!g[WHATSAPP_ACTIVE_LISTENER_STATE_KEY]) {
  g[WHATSAPP_ACTIVE_LISTENER_STATE_KEY] = {
    listeners: /* @__PURE__ */ new Map(),
    current: null,
  };
}
var state2 = g[WHATSAPP_ACTIVE_LISTENER_STATE_KEY];
function setCurrentListener(listener) {
  state2.current = listener;
}
function resolveWebAccountId(accountId) {
  return (accountId ?? "").trim() || DEFAULT_ACCOUNT_ID;
}
function requireActiveWebListener(accountId) {
  const id = resolveWebAccountId(accountId);
  const listener = state2.listeners.get(id) ?? null;
  if (!listener) {
    throw new Error(
      `No active WhatsApp Web listener (account: ${id}). Start the gateway, then link WhatsApp with: ${formatCliCommand(`openclaw channels login --channel whatsapp --account ${id}`)}.`,
    );
  }
  return { accountId: id, listener };
}
function setActiveWebListener(accountIdOrListener, maybeListener) {
  const { accountId, listener } =
    typeof accountIdOrListener === "string"
      ? { accountId: accountIdOrListener, listener: maybeListener ?? null }
      : {
          accountId: DEFAULT_ACCOUNT_ID,
          listener: accountIdOrListener ?? null,
        };
  const id = resolveWebAccountId(accountId);
  if (!listener) {
    state2.listeners.delete(id);
  } else {
    state2.listeners.set(id, listener);
  }
  if (id === DEFAULT_ACCOUNT_ID) {
    setCurrentListener(listener);
  }
}
function getActiveWebListener(accountId) {
  const id = resolveWebAccountId(accountId);
  return state2.listeners.get(id) ?? null;
}
export {
  getActiveWebListener,
  requireActiveWebListener,
  resolveWebAccountId,
  setActiveWebListener,
};
