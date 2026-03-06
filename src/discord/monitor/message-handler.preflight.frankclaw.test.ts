/**
 * Tests for frankclaw Discord preflight extensions.
 *
 * Covers resolveSessionExistsFallback — the session-existence fallback
 * that recovers thread bindings after a gateway restart by checking the
 * persisted session store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the session store module before importing
const loadSessionStoreMock = vi.hoisted(() => vi.fn());
const resolveStorePathMock = vi.hoisted(() => vi.fn());

vi.mock("../../config/sessions.js", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    loadSessionStore: loadSessionStoreMock,
    resolveStorePath: resolveStorePathMock,
  };
});

vi.mock("../../globals.js", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    logVerbose: vi.fn(),
    shouldLogVerbose: () => false,
  };
});

import { resolveSessionExistsFallback } from "./message-handler.preflight.frankclaw.js";

describe("resolveSessionExistsFallback", () => {
  beforeEach(() => {
    resolveStorePathMock.mockReturnValue("/fake/sessions.json");
    loadSessionStoreMock.mockReturnValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when not a thread", () => {
    expect(
      resolveSessionExistsFallback({
        channelId: "thread-123",
        isThread: false,
      }),
    ).toBe(false);
    // Should not even attempt to load the session store
    expect(loadSessionStoreMock).not.toHaveBeenCalled();
  });

  it("returns false when channelId is empty", () => {
    expect(
      resolveSessionExistsFallback({
        channelId: "",
        isThread: true,
      }),
    ).toBe(false);
    expect(loadSessionStoreMock).not.toHaveBeenCalled();
  });

  it("returns false when no matching session exists", () => {
    loadSessionStoreMock.mockReturnValue({
      "agent:main:discord:channel:other-channel": { updatedAt: 1 },
      "agent:main:telegram:user:123": { updatedAt: 2 },
    });

    expect(
      resolveSessionExistsFallback({
        channelId: "thread-456",
        isThread: true,
      }),
    ).toBe(false);
  });

  it("returns true when a matching session exists for the thread channel", () => {
    loadSessionStoreMock.mockReturnValue({
      "agent:main:discord:channel:thread-456": { updatedAt: 1 },
      "agent:main:telegram:user:123": { updatedAt: 2 },
    });

    expect(
      resolveSessionExistsFallback({
        channelId: "thread-456",
        isThread: true,
      }),
    ).toBe(true);
  });

  it("matches across different agent IDs", () => {
    loadSessionStoreMock.mockReturnValue({
      "agent:custom-agent:discord:channel:thread-789": { updatedAt: 1 },
    });

    expect(
      resolveSessionExistsFallback({
        channelId: "thread-789",
        isThread: true,
      }),
    ).toBe(true);
  });

  it("returns false gracefully when loadSessionStore throws", () => {
    loadSessionStoreMock.mockImplementation(() => {
      throw new Error("file not found");
    });

    expect(
      resolveSessionExistsFallback({
        channelId: "thread-123",
        isThread: true,
      }),
    ).toBe(false);
  });

  it("does not match partial channel ID suffixes", () => {
    loadSessionStoreMock.mockReturnValue({
      "agent:main:discord:channel:1234567890": { updatedAt: 1 },
    });

    // "7890" is a suffix of "1234567890" but should NOT match
    expect(
      resolveSessionExistsFallback({
        channelId: "7890",
        isThread: true,
      }),
    ).toBe(false);
  });

  it("passes agentId to resolveStorePath", () => {
    loadSessionStoreMock.mockReturnValue({});

    resolveSessionExistsFallback({
      channelId: "thread-123",
      isThread: true,
      agentId: "custom",
    });

    expect(resolveStorePathMock).toHaveBeenCalledWith(undefined, { agentId: "custom" });
  });
});
