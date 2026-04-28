import { describe, expect, it } from "vitest";
import {
  applyAcpProtocolModeBootstrap,
  detectAcpProtocolModeFromArgv,
} from "./acp-protocol-mode-bootstrap.frankclaw.js";

describe("detectAcpProtocolModeFromArgv", () => {
  it("matches `openclaw acp ...` invocation", () => {
    expect(detectAcpProtocolModeFromArgv(["node", "openclaw", "acp", "--url", "ws://x"])).toBe(
      true,
    );
  });

  it("matches `openclaw acp client ...` invocation", () => {
    expect(detectAcpProtocolModeFromArgv(["node", "openclaw", "acp", "client"])).toBe(true);
  });

  it("ignores leading flags before the subcommand", () => {
    expect(detectAcpProtocolModeFromArgv(["node", "openclaw", "--no-color", "acp"])).toBe(true);
  });

  it("rejects a different subcommand", () => {
    expect(detectAcpProtocolModeFromArgv(["node", "openclaw", "doctor"])).toBe(false);
  });

  it("rejects when there is no positional subcommand", () => {
    expect(detectAcpProtocolModeFromArgv(["node", "openclaw", "--help"])).toBe(false);
    expect(detectAcpProtocolModeFromArgv(["node", "openclaw"])).toBe(false);
  });

  it("does not match `openclaw plugins acp` (acp not the top-level subcommand)", () => {
    expect(detectAcpProtocolModeFromArgv(["node", "openclaw", "plugins", "acp"])).toBe(false);
  });
});

describe("applyAcpProtocolModeBootstrap", () => {
  it("sets OPENCLAW_SUPPRESS_NOTES and OPENCLAW_HIDE_BANNER for `openclaw acp`", () => {
    const env: NodeJS.ProcessEnv = {};
    const calls: string[] = [];
    const result = applyAcpProtocolModeBootstrap({
      argv: ["node", "openclaw", "acp", "--url", "ws://x"],
      env,
      diag: (message) => calls.push(message),
    });
    expect(result.protocolMode).toBe(true);
    expect(result.appliedSuppressNotes).toBe(true);
    expect(result.appliedHideBanner).toBe(true);
    expect(env.OPENCLAW_SUPPRESS_NOTES).toBe("1");
    expect(env.OPENCLAW_HIDE_BANNER).toBe("1");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/ACP_PROTOCOL_BOOTSTRAP applied=true/);
  });

  it("does not modify env or write diag for non-ACP commands", () => {
    const env: NodeJS.ProcessEnv = {};
    const calls: string[] = [];
    const result = applyAcpProtocolModeBootstrap({
      argv: ["node", "openclaw", "doctor"],
      env,
      diag: (message) => calls.push(message),
    });
    expect(result.protocolMode).toBe(false);
    expect(env.OPENCLAW_SUPPRESS_NOTES).toBeUndefined();
    expect(env.OPENCLAW_HIDE_BANNER).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("respects an explicit OPENCLAW_SUPPRESS_NOTES=0 override", () => {
    const env: NodeJS.ProcessEnv = {
      OPENCLAW_SUPPRESS_NOTES: "1",
      OPENCLAW_HIDE_BANNER: "1",
    };
    const result = applyAcpProtocolModeBootstrap({
      argv: ["node", "openclaw", "acp"],
      env,
      diag: () => {},
    });
    expect(result.protocolMode).toBe(true);
    expect(result.appliedSuppressNotes).toBe(false);
    expect(result.appliedHideBanner).toBe(false);
    expect(env.OPENCLAW_SUPPRESS_NOTES).toBe("1");
    expect(env.OPENCLAW_HIDE_BANNER).toBe("1");
  });
});
