import { describe, expect, it } from "vitest";
import { slimSessionStoreForWrite } from "./store-session-slim.frankclaw.js";
import type { SessionEntry } from "./types.js";

function makeEntry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    sessionId: "test-session",
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeSkillsSnapshot() {
  // Create a realistically large snapshot (~80KB)
  const skills: Record<string, unknown> = {};
  for (let i = 0; i < 100; i++) {
    skills[`skill-${i}`] = {
      name: `skill-${i}`,
      description: `A test skill number ${i} with a moderately long description to simulate real data`,
      triggers: [`trigger-${i}-a`, `trigger-${i}-b`],
      config: { enabled: true, timeout: 30000, retries: 3 },
    };
  }
  return skills;
}

describe("slimSessionStoreForWrite", () => {
  it("strips bloat fields from terminal entries", () => {
    const store: Record<string, SessionEntry> = {
      "session-done": makeEntry({
        status: "done",
        skillsSnapshot: makeSkillsSnapshot() as SessionEntry["skillsSnapshot"],
        systemPromptReport: { tokens: 5000 } as SessionEntry["systemPromptReport"],
      }),
      "session-failed": makeEntry({
        status: "failed",
        skillsSnapshot: makeSkillsSnapshot() as SessionEntry["skillsSnapshot"],
      }),
      "session-killed": makeEntry({
        status: "killed",
        skillsSnapshot: makeSkillsSnapshot() as SessionEntry["skillsSnapshot"],
      }),
      "session-timeout": makeEntry({
        status: "timeout",
        skillsSnapshot: makeSkillsSnapshot() as SessionEntry["skillsSnapshot"],
      }),
    };

    const result = slimSessionStoreForWrite(store);

    expect(result.slimmed).toBe(4);
    expect(result.estimatedBytesSaved).toBeGreaterThan(0);
    expect(store["session-done"].skillsSnapshot).toBeUndefined();
    expect(store["session-done"].systemPromptReport).toBeUndefined();
    expect(store["session-failed"].skillsSnapshot).toBeUndefined();
    expect(store["session-killed"].skillsSnapshot).toBeUndefined();
    expect(store["session-timeout"].skillsSnapshot).toBeUndefined();
  });

  it("preserves bloat fields on active/running entries", () => {
    const snapshot = makeSkillsSnapshot() as SessionEntry["skillsSnapshot"];
    const store: Record<string, SessionEntry> = {
      "session-running": makeEntry({
        status: "running",
        skillsSnapshot: snapshot,
      }),
      "session-no-status": makeEntry({
        skillsSnapshot: snapshot,
      }),
    };

    const result = slimSessionStoreForWrite(store);

    expect(result.slimmed).toBe(0);
    expect(store["session-running"].skillsSnapshot).toBe(snapshot);
    expect(store["session-no-status"].skillsSnapshot).toBe(snapshot);
  });

  it("never strips the active session key", () => {
    const snapshot = makeSkillsSnapshot() as SessionEntry["skillsSnapshot"];
    const store: Record<string, SessionEntry> = {
      "active-session": makeEntry({
        status: "done",
        skillsSnapshot: snapshot,
      }),
    };

    const result = slimSessionStoreForWrite(store, "active-session");

    expect(result.slimmed).toBe(0);
    expect(store["active-session"].skillsSnapshot).toBe(snapshot);
  });

  it("handles empty store", () => {
    const store: Record<string, SessionEntry> = {};
    const result = slimSessionStoreForWrite(store);
    expect(result.slimmed).toBe(0);
    expect(result.estimatedBytesSaved).toBe(0);
  });

  it("handles entries without bloat fields", () => {
    const store: Record<string, SessionEntry> = {
      "session-done": makeEntry({ status: "done" }),
    };

    const result = slimSessionStoreForWrite(store);
    expect(result.slimmed).toBe(0);
  });

  it("demonstrates significant size reduction", () => {
    const store: Record<string, SessionEntry> = {};
    for (let i = 0; i < 100; i++) {
      store[`session-${i}`] = makeEntry({
        status: "done",
        skillsSnapshot: makeSkillsSnapshot() as SessionEntry["skillsSnapshot"],
      });
    }

    const beforeSize = JSON.stringify(store).length;
    slimSessionStoreForWrite(store);
    const afterSize = JSON.stringify(store).length;

    // Should reduce size by at least 90%
    expect(afterSize).toBeLessThan(beforeSize * 0.1);
  });
});
