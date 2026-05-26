import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearWhatsAppSessionConflict440,
  isWhatsAppSessionConflict440,
  markWhatsAppSessionConflict440,
} from "./session-conflict-guard.frankclaw.js";

// Spy on spawn so tests don't actually launch subprocesses.
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

const mockRuntime = {
  error: vi.fn(),
  log: vi.fn(),
};

afterEach(() => {
  // Clear state between tests
  clearWhatsAppSessionConflict440("default");
  clearWhatsAppSessionConflict440("testAccount");
  vi.clearAllMocks();
});

describe("isWhatsAppSessionConflict440", () => {
  it("returns false for unknown account", () => {
    expect(isWhatsAppSessionConflict440("default")).toBe(false);
  });

  it("returns true after markWhatsAppSessionConflict440", () => {
    markWhatsAppSessionConflict440("default", mockRuntime as never);
    expect(isWhatsAppSessionConflict440("default")).toBe(true);
  });

  it("returns false after clearWhatsAppSessionConflict440", () => {
    markWhatsAppSessionConflict440("default", mockRuntime as never);
    clearWhatsAppSessionConflict440("default");
    expect(isWhatsAppSessionConflict440("default")).toBe(false);
  });
});

describe("markWhatsAppSessionConflict440", () => {
  it("posts Discord alert on first conflict", async () => {
    const { spawn } = await import("node:child_process");
    markWhatsAppSessionConflict440("default", mockRuntime as never);
    expect(spawn).toHaveBeenCalledOnce();
    const args = (spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args[0]).toBe("openclaw");
    expect(args[1]).toContain("message");
    expect(args[1]).toContain("send");
    expect(args[1]).toContain("discord");
  });

  it("does not post Discord alert on second conflict for same account", async () => {
    const { spawn } = await import("node:child_process");
    markWhatsAppSessionConflict440("default", mockRuntime as never);
    markWhatsAppSessionConflict440("default", mockRuntime as never);
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("calls runtime.error with relink instructions", () => {
    markWhatsAppSessionConflict440("default", mockRuntime as never);
    expect(mockRuntime.error).toHaveBeenCalledOnce();
    expect(mockRuntime.error.mock.calls[0][0]).toContain("440");
    expect(mockRuntime.error.mock.calls[0][0]).toContain("openclaw channels login");
  });

  it("isolates conflict state by accountId", () => {
    markWhatsAppSessionConflict440("testAccount", mockRuntime as never);
    expect(isWhatsAppSessionConflict440("testAccount")).toBe(true);
    expect(isWhatsAppSessionConflict440("default")).toBe(false);
  });
});
