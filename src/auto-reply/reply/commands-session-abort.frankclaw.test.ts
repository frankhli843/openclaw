/**
 * Tests frankclaw-specific stop command behavior:
 *   - handleStopCommand accepts both /stop and doramon_stop
 */

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  abortEmbeddedPiRun: vi.fn(),
  logVerbose: vi.fn(),
  createInternalHookEvent: vi.fn(() => ({})),
  triggerInternalHook: vi.fn(),
  normalizeOptionalString: vi.fn((s: string | null | undefined) => s?.trim() || undefined),
  resolveAbortCutoffFromContext: vi.fn(),
  shouldPersistAbortCutoff: vi.fn(() => false),
  isAbortTrigger: vi.fn(() => false),
  formatAbortReplyText: vi.fn(() => "Stopped."),
  resolveSessionEntryForKey: vi.fn(() => ({ entry: undefined, key: undefined })),
  setAbortMemory: vi.fn(),
  stopSubagentsForRequester: vi.fn(() => ({ stopped: [] })),
  abortSessionRunTarget: vi.fn(() => false),
  rejectUnauthorizedCommand: vi.fn(() => null),
  persistAbortTargetEntry: vi.fn(async () => false),
  clearSessionQueues: vi.fn(() => ({ followupCleared: 0, laneCleared: 0, keys: [] })),
  replyRunRegistryAbort: vi.fn(),
  replyRunRegistryResolveSessionId: vi.fn(() => undefined),
}));

vi.mock("../../agents/pi-embedded.js", () => ({
  abortEmbeddedPiRun: mocks.abortEmbeddedPiRun,
}));

vi.mock("../../globals.js", () => ({
  logVerbose: mocks.logVerbose,
}));

vi.mock("../../hooks/internal-hooks.js", () => ({
  createInternalHookEvent: mocks.createInternalHookEvent,
  triggerInternalHook: mocks.triggerInternalHook,
}));

vi.mock("../../shared/string-coerce.js", () => ({
  normalizeOptionalString: mocks.normalizeOptionalString,
}));

vi.mock("./abort-cutoff.js", () => ({
  resolveAbortCutoffFromContext: mocks.resolveAbortCutoffFromContext,
  shouldPersistAbortCutoff: mocks.shouldPersistAbortCutoff,
}));

vi.mock("./abort.js", () => ({
  formatAbortReplyText: mocks.formatAbortReplyText,
  isAbortTrigger: mocks.isAbortTrigger,
  resolveSessionEntryForKey: mocks.resolveSessionEntryForKey,
  setAbortMemory: mocks.setAbortMemory,
  stopSubagentsForRequester: mocks.stopSubagentsForRequester,
  abortSessionRunTarget: mocks.abortSessionRunTarget,
}));

vi.mock("./command-gates.js", () => ({
  rejectUnauthorizedCommand: mocks.rejectUnauthorizedCommand,
}));

vi.mock("./commands-session-store.js", () => ({
  persistAbortTargetEntry: mocks.persistAbortTargetEntry,
}));

vi.mock("./queue.js", () => ({
  clearSessionQueues: mocks.clearSessionQueues,
}));

vi.mock("./reply-run-registry.js", () => ({
  replyRunRegistry: {
    abort: mocks.replyRunRegistryAbort,
    resolveSessionId: mocks.replyRunRegistryResolveSessionId,
  },
}));

import { handleStopCommand } from "./commands-session-abort.js";

function createParams(commandBodyNormalized: string) {
  return {
    command: {
      commandBodyNormalized,
      rawBodyNormalized: commandBodyNormalized,
      abortKey: "test-abort-key",
      surface: "text",
      senderId: "user1",
    },
    ctx: {},
    cfg: {},
    sessionKey: "sess1",
    sessionEntry: undefined,
    sessionStore: {},
    storePath: "/tmp/test",
  } as any;
}

describe("handleStopCommand (frankclaw)", () => {
  it("handles /stop command", async () => {
    const result = await handleStopCommand(createParams("/stop"), true);
    expect(result).not.toBeNull();
    expect(result!.shouldContinue).toBe(false);
    expect(result!.reply!.text).toBe("Stopped.");
  });

  it("handles doramon_stop command", async () => {
    const result = await handleStopCommand(createParams("doramon_stop"), true);
    expect(result).not.toBeNull();
    expect(result!.shouldContinue).toBe(false);
    expect(result!.reply!.text).toBe("Stopped.");
  });

  it("returns null for unrelated commands", async () => {
    const result = await handleStopCommand(createParams("/help"), true);
    expect(result).toBeNull();
  });

  it("returns null when text commands are not allowed", async () => {
    const result = await handleStopCommand(createParams("/stop"), false);
    expect(result).toBeNull();
  });
});
