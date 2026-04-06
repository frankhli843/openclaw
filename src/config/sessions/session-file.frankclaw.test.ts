import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAndPersistSessionFile } from "./session-file.js";
import { loadSessionStore } from "./store.js";

describe("resolveAndPersistSessionFile frankclaw materialization", () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-file-frankclaw-test-"));
    storePath = path.join(tmpDir, "sessions.json");
    fs.writeFileSync(storePath, JSON.stringify({}), "utf-8");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the transcript file before persisting the session entry", async () => {
    const sessionId = "session-materialized";
    const sessionKey = "agent:main:discord:channel:123";
    const sessionStore = loadSessionStore(storePath, { skipCache: true });
    const fallbackSessionFile = path.join(tmpDir, "sessions", `${sessionId}.jsonl`);

    const result = await resolveAndPersistSessionFile({
      sessionId,
      sessionKey,
      sessionStore,
      storePath,
      fallbackSessionFile,
    });

    expect(result.sessionFile).toBe(fallbackSessionFile);
    expect(fs.existsSync(fallbackSessionFile)).toBe(true);
    const saved = loadSessionStore(storePath, { skipCache: true });
    expect(saved[sessionKey]?.sessionFile).toBe(fallbackSessionFile);
  });

  it("fails hard and does not persist session metadata when transcript materialization fails", async () => {
    const sessionId = "session-materialization-failure";
    const sessionKey = "agent:main:discord:channel:456";
    const sessionStore = loadSessionStore(storePath, { skipCache: true });
    const blockingPath = path.join(tmpDir, "blocked-parent");
    fs.writeFileSync(blockingPath, "not-a-directory", "utf-8");
    const fallbackSessionFile = path.join(blockingPath, `${sessionId}.jsonl`);

    await expect(
      resolveAndPersistSessionFile({
        sessionId,
        sessionKey,
        sessionStore,
        storePath,
        fallbackSessionFile,
      }),
    ).rejects.toThrow();

    const saved = loadSessionStore(storePath, { skipCache: true });
    expect(saved[sessionKey]).toBeUndefined();
    expect(fs.existsSync(fallbackSessionFile)).toBe(false);
  });
});
