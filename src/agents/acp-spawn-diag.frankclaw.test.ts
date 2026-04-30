import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  callGatewayMock: vi.fn(),
  acpDiagMock: vi.fn(),
}));

vi.mock("../gateway/call.js", () => ({
  callGateway: hoisted.callGatewayMock,
}));

vi.mock("../acp/control-plane/acp-diag.frankclaw.js", () => ({
  acpDiag: hoisted.acpDiagMock,
}));

const { forceDeleteOrphanAcpSession, acpSpawnDiag } = await import("./acp-spawn-diag.frankclaw.js");

beforeEach(() => {
  hoisted.callGatewayMock.mockReset();
  hoisted.acpDiagMock.mockReset();
});

afterEach(() => {
  vi.clearAllTimers();
});

describe("acp-spawn-diag", () => {
  describe("acpSpawnDiag", () => {
    it("emits a stage-prefixed line with key=value pairs", () => {
      acpSpawnDiag("ENTER", "agent:claude:acp:abc", {
        agent: "claude",
        thread: false,
        runId: undefined,
      });
      expect(hoisted.acpDiagMock).toHaveBeenCalledTimes(1);
      const line = hoisted.acpDiagMock.mock.calls[0]?.[0] ?? "";
      expect(line).toContain("ACP_SPAWN_ENTER");
      expect(line).toContain("session=agent:claude:acp:abc");
      expect(line).toContain("agent=claude");
      expect(line).toContain("thread=false");
      // undefined values should be skipped
      expect(line).not.toContain("runId=");
    });

    it("falls back to <unset> when the session key is empty", () => {
      acpSpawnDiag("CATCH_PRECREATE", "");
      const line = hoisted.acpDiagMock.mock.calls[0]?.[0] ?? "";
      expect(line).toContain("session=<unset>");
    });
  });

  describe("forceDeleteOrphanAcpSession", () => {
    it("calls sessions.delete with deleteTranscript=true and a 30s timeout", async () => {
      hoisted.callGatewayMock.mockResolvedValue({ deleted: true });
      await forceDeleteOrphanAcpSession({
        sessionKey: "agent:claude:acp:abc",
        reason: "spawn_pre_create_failed",
      });
      expect(hoisted.callGatewayMock).toHaveBeenCalledTimes(1);
      const arg = hoisted.callGatewayMock.mock.calls[0]?.[0] as {
        method?: string;
        params?: { key?: string; deleteTranscript?: boolean; emitLifecycleHooks?: boolean };
        timeoutMs?: number;
      };
      expect(arg.method).toBe("sessions.delete");
      expect(arg.params?.key).toBe("agent:claude:acp:abc");
      expect(arg.params?.deleteTranscript).toBe(true);
      expect(arg.params?.emitLifecycleHooks).toBe(false);
      expect(arg.timeoutMs).toBeGreaterThanOrEqual(30_000);
    });

    it("logs SAFETY_NET_DELETE_OK on success", async () => {
      hoisted.callGatewayMock.mockResolvedValue({ deleted: true });
      await forceDeleteOrphanAcpSession({
        sessionKey: "agent:claude:acp:abc",
        reason: "spawn_dispatch_failed",
      });
      const lines = hoisted.acpDiagMock.mock.calls.map((c) => String(c?.[0] ?? ""));
      expect(lines.some((l) => l.includes("ACP_SPAWN_SAFETY_NET_DELETE "))).toBe(true);
      expect(lines.some((l) => l.includes("ACP_SPAWN_SAFETY_NET_DELETE_OK"))).toBe(true);
    });

    it("logs SAFETY_NET_DELETE_FAIL when sessions.delete throws and never re-throws", async () => {
      hoisted.callGatewayMock.mockRejectedValue(new Error("gateway timeout after 30000ms"));
      await expect(
        forceDeleteOrphanAcpSession({
          sessionKey: "agent:claude:acp:abc",
          reason: "spawn_init_failed",
        }),
      ).resolves.toBeUndefined();
      const lines = hoisted.acpDiagMock.mock.calls.map((c) => String(c?.[0] ?? ""));
      expect(lines.some((l) => l.includes("ACP_SPAWN_SAFETY_NET_DELETE_FAIL"))).toBe(true);
      expect(lines.some((l) => l.includes("gateway timeout after 30000ms"))).toBe(true);
    });

    it("is a no-op when session key is blank", async () => {
      await forceDeleteOrphanAcpSession({ sessionKey: "  ", reason: "spawn_pre_create_failed" });
      expect(hoisted.callGatewayMock).not.toHaveBeenCalled();
    });
  });
});
