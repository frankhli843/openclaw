// frankclaw: ACP protocol-mode hygiene + diagnostic logging.
//
// When `openclaw acp ...` is invoked (typically as a child of acpx), stdout
// is the ACP protocol stream. Any decorative output (banner, box-drawn
// `Config warnings` notes from doctor preflight) becomes invalid JSON for
// the parent acpx parser and silently produces an empty transcript.
//
// This module runs during `entry.ts` bootstrap. If the invocation matches
// the ACP subcommand it sets `OPENCLAW_HIDE_BANNER=1` and
// `OPENCLAW_SUPPRESS_NOTES=1` before the CLI preaction fires, so the
// banner emitter and `note()` helper become no-ops for this process.
//
// Diagnostic events are appended to state/acp-diag.log (rotated at 2MB)
// to make protocol-stream contamination visible in audits.

import { acpDiag } from "../acp/control-plane/acp-diag.frankclaw.js";

export function detectAcpProtocolModeFromArgv(argv: readonly string[]): boolean {
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (typeof token !== "string" || token.length === 0) {
      continue;
    }
    if (token.startsWith("-")) {
      continue;
    }
    return token === "acp";
  }
  return false;
}

export type AcpProtocolModeBootstrapDeps = {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  diag?: (message: string) => void;
};

export type AcpProtocolModeBootstrapResult = {
  protocolMode: boolean;
  appliedSuppressNotes: boolean;
  appliedHideBanner: boolean;
};

export function applyAcpProtocolModeBootstrap(
  deps: AcpProtocolModeBootstrapDeps = {},
): AcpProtocolModeBootstrapResult {
  const argv = deps.argv ?? process.argv;
  const env = deps.env ?? process.env;
  const protocolMode = detectAcpProtocolModeFromArgv(argv);

  const result: AcpProtocolModeBootstrapResult = {
    protocolMode,
    appliedSuppressNotes: false,
    appliedHideBanner: false,
  };

  if (!protocolMode) {
    return result;
  }

  const previousSuppressNotes = env.OPENCLAW_SUPPRESS_NOTES;
  const previousHideBanner = env.OPENCLAW_HIDE_BANNER;

  if (
    !previousSuppressNotes ||
    previousSuppressNotes === "0" ||
    previousSuppressNotes === "false"
  ) {
    env.OPENCLAW_SUPPRESS_NOTES = "1";
    result.appliedSuppressNotes = true;
  }
  if (!previousHideBanner || previousHideBanner === "0" || previousHideBanner === "false") {
    env.OPENCLAW_HIDE_BANNER = "1";
    result.appliedHideBanner = true;
  }

  const diag = deps.diag ?? acpDiag;
  diag(
    `ACP_PROTOCOL_BOOTSTRAP applied=true ` +
      `applied_suppress_notes=${result.appliedSuppressNotes} ` +
      `applied_hide_banner=${result.appliedHideBanner} ` +
      `prev_suppress_notes=${previousSuppressNotes ?? ""} ` +
      `prev_hide_banner=${previousHideBanner ?? ""} ` +
      `pid=${process.pid}`,
  );

  return result;
}
