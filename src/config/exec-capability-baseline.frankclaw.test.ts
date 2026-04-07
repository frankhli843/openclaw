import { describe, expect, it } from "vitest";
import { AgentDefaultsSchema } from "./zod-schema.agent-defaults.js";
import { ToolsSchema } from "./zod-schema.agent-runtime.js";

describe("explicit exec capability baseline", () => {
  describe("agents.defaults.sandbox.mode", () => {
    it("accepts sandbox.mode = off", () => {
      const result = AgentDefaultsSchema.parse({ sandbox: { mode: "off" } });
      expect(result!.sandbox!.mode).toBe("off");
    });

    it("accepts sandbox.mode = non-main", () => {
      const result = AgentDefaultsSchema.parse({ sandbox: { mode: "non-main" } });
      expect(result!.sandbox!.mode).toBe("non-main");
    });

    it("accepts sandbox.mode = all", () => {
      const result = AgentDefaultsSchema.parse({ sandbox: { mode: "all" } });
      expect(result!.sandbox!.mode).toBe("all");
    });

    it("rejects invalid sandbox.mode values", () => {
      expect(() => AgentDefaultsSchema.parse({ sandbox: { mode: "invalid" } })).toThrow();
    });
  });

  describe("tools.exec shape", () => {
    it("accepts exec.host = gateway", () => {
      const result = ToolsSchema.parse({ exec: { host: "gateway" } });
      expect(result!.exec!.host).toBe("gateway");
    });

    it("accepts exec.security = full", () => {
      const result = ToolsSchema.parse({ exec: { security: "full" } });
      expect(result!.exec!.security).toBe("full");
    });

    it("accepts exec.ask = off", () => {
      const result = ToolsSchema.parse({ exec: { ask: "off" } });
      expect(result!.exec!.ask).toBe("off");
    });

    it("accepts combined exec config: host=gateway, security=full, ask=off", () => {
      const result = ToolsSchema.parse({
        exec: { host: "gateway", security: "full", ask: "off" },
      });
      expect(result!.exec).toMatchObject({
        host: "gateway",
        security: "full",
        ask: "off",
      });
    });

    it("accepts all valid exec.host values", () => {
      for (const host of ["auto", "sandbox", "gateway", "node"] as const) {
        const result = ToolsSchema.parse({ exec: { host } });
        expect(result!.exec!.host).toBe(host);
      }
    });

    it("accepts all valid exec.security values", () => {
      for (const security of ["deny", "allowlist", "full"] as const) {
        const result = ToolsSchema.parse({ exec: { security } });
        expect(result!.exec!.security).toBe(security);
      }
    });

    it("accepts all valid exec.ask values", () => {
      for (const ask of ["off", "on-miss", "always"] as const) {
        const result = ToolsSchema.parse({ exec: { ask } });
        expect(result!.exec!.ask).toBe(ask);
      }
    });

    it("rejects invalid exec.host values", () => {
      expect(() => ToolsSchema.parse({ exec: { host: "invalid" } })).toThrow();
    });

    it("rejects invalid exec.security values", () => {
      expect(() => ToolsSchema.parse({ exec: { security: "invalid" } })).toThrow();
    });
  });
});
