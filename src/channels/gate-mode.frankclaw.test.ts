import { describe, expect, it } from "vitest";
import { resolveGateMode } from "./gate-mode.frankclaw.js";

const baseParams = {
  senderId: "user1",
  allowFrom: ["owner1"],
  allowedSenders: ["allowed1"],
  wasMentioned: false,
  messageText: "",
  mentionKeywords: ["hey bot"],
};

describe("resolveGateMode (frankclaw)", () => {
  it("returns skip for blocked mode", () => {
    const result = resolveGateMode({ ...baseParams, gateMode: "blocked" });
    expect(result.action).toBe("skip");
    expect(result.effectiveWasMentioned).toBe(false);
  });

  it("returns skip when gateMode is undefined (defaults to blocked)", () => {
    const result = resolveGateMode({ ...baseParams, gateMode: undefined });
    expect(result.action).toBe("skip");
  });

  it("returns silent for silent mode", () => {
    const result = resolveGateMode({ ...baseParams, gateMode: "silent" });
    expect(result.action).toBe("silent");
  });

  it("returns process for open mode", () => {
    const result = resolveGateMode({ ...baseParams, gateMode: "open" });
    expect(result.action).toBe("process");
    expect(result.effectiveWasMentioned).toBe(true);
  });

  it("frank-only: allows owner with mention", () => {
    const result = resolveGateMode({
      ...baseParams,
      gateMode: "frank-only",
      senderId: "owner1",
      wasMentioned: true,
    });
    expect(result.action).toBe("process");
  });

  it("frank-only: skips non-owner", () => {
    const result = resolveGateMode({
      ...baseParams,
      gateMode: "frank-only",
      senderId: "stranger",
      wasMentioned: true,
    });
    expect(result.action).toBe("skip");
  });

  it("frank-only: skips owner without mention", () => {
    const result = resolveGateMode({
      ...baseParams,
      gateMode: "frank-only",
      senderId: "owner1",
      wasMentioned: false,
      messageText: "no keyword here",
    });
    expect(result.action).toBe("skip");
  });

  it("frank-only: allows owner with keyword match", () => {
    const result = resolveGateMode({
      ...baseParams,
      gateMode: "frank-only",
      senderId: "owner1",
      messageText: "hey bot do something",
    });
    expect(result.action).toBe("process");
  });

  it("allowlist: allows allowlisted sender with mention", () => {
    const result = resolveGateMode({
      ...baseParams,
      gateMode: "allowlist",
      senderId: "allowed1",
      wasMentioned: true,
    });
    expect(result.action).toBe("process");
  });

  it("allowlist: skips non-allowlisted sender", () => {
    const result = resolveGateMode({
      ...baseParams,
      gateMode: "allowlist",
      senderId: "stranger",
      wasMentioned: true,
    });
    expect(result.action).toBe("skip");
  });

  it("mention: allows any sender with mention", () => {
    const result = resolveGateMode({
      ...baseParams,
      gateMode: "mention",
      senderId: "anyone",
      wasMentioned: true,
    });
    expect(result.action).toBe("process");
  });

  it("mention: skips without mention or keyword", () => {
    const result = resolveGateMode({
      ...baseParams,
      gateMode: "mention",
      senderId: "anyone",
      messageText: "random text",
    });
    expect(result.action).toBe("skip");
  });

  it("mention: allows keyword match", () => {
    const result = resolveGateMode({
      ...baseParams,
      gateMode: "mention",
      senderId: "anyone",
      messageText: "hey bot please help",
    });
    expect(result.action).toBe("process");
  });
});
