import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestHeartbeatNow = vi.fn();
vi.mock("../infra/heartbeat-wake.js", () => ({
  requestHeartbeat: (opts: unknown) => requestHeartbeatNow(opts),
}));

import {
  __resetRewakeDebounceForTest,
  rewakeParentAfterAnnounce,
} from "./subagent-announce-rewake.frankclaw.js";

describe("rewakeParentAfterAnnounce", () => {
  let tmpWorkspace: string;
  let prevWorkspace: string | undefined;

  beforeEach(() => {
    requestHeartbeatNow.mockReset();
    __resetRewakeDebounceForTest();
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "rewake-test-"));
    prevWorkspace = process.env["OPENCLAW_WORKSPACE"];
    process.env["OPENCLAW_WORKSPACE"] = tmpWorkspace;
  });

  afterEach(() => {
    if (prevWorkspace === undefined) {
      delete process.env["OPENCLAW_WORKSPACE"];
    } else {
      process.env["OPENCLAW_WORKSPACE"] = prevWorkspace;
    }
    try {
      fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("wakes the parent when delivery succeeded and completion is expected", () => {
    rewakeParentAfterAnnounce({
      parentSessionKey: "agent:main:discord:channel:123",
      childSessionKey: "agent:claude:acp:abc",
      childRunId: "run-1",
      delivered: true,
      expectsCompletionMessage: true,
    });
    expect(requestHeartbeatNow).toHaveBeenCalledTimes(1);
  });

  it("does NOT wake on mid-flight (non-completion) announces", () => {
    rewakeParentAfterAnnounce({
      parentSessionKey: "agent:main:discord:channel:123",
      childSessionKey: "agent:claude:acp:abc",
      delivered: true,
      expectsCompletionMessage: false,
    });
    expect(requestHeartbeatNow).not.toHaveBeenCalled();
  });

  it("does NOT wake when parentSessionKey is missing", () => {
    rewakeParentAfterAnnounce({
      parentSessionKey: "",
      childSessionKey: "agent:claude:acp:abc",
      delivered: true,
      expectsCompletionMessage: true,
    });
    expect(requestHeartbeatNow).not.toHaveBeenCalled();
  });

  it("queues a retry marker when delivery failed", () => {
    rewakeParentAfterAnnounce({
      parentSessionKey: "agent:main:discord:channel:123",
      childSessionKey: "agent:claude:acp:abc",
      childRunId: "run-2",
      label: "test-label",
      delivered: false,
      expectsCompletionMessage: true,
      deliveryError: "gateway closed",
    });
    expect(requestHeartbeatNow).not.toHaveBeenCalled();
    const dir = path.join(tmpWorkspace, "state", "subagent-announce-retry");
    expect(fs.existsSync(dir)).toBe(true);
    const files = fs.readdirSync(dir);
    expect(files.length).toBe(1);
    const payload = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8"));
    expect(payload.parent_session_key).toBe("agent:main:discord:channel:123");
    expect(payload.child_run_id).toBe("run-2");
    expect(payload.label).toBe("test-label");
    expect(payload.delivery_error).toBe("gateway closed");
    expect(payload.attempts).toBe(0);
  });

  it("does not write a retry marker on non-completion failures", () => {
    rewakeParentAfterAnnounce({
      parentSessionKey: "agent:main:discord:channel:123",
      childSessionKey: "agent:claude:acp:abc",
      delivered: false,
      expectsCompletionMessage: false,
      deliveryError: "some error",
    });
    const dir = path.join(tmpWorkspace, "state", "subagent-announce-retry");
    expect(fs.existsSync(dir)).toBe(false);
  });

  // Regression: 2026-04-19 Discord thread 1495460242920706168 saw the same
  // "ACP deep local test sweep" paragraph posted three times within 3
  // minutes because multiple ACP children completed on the same parent in
  // quick succession and each one fired requestHeartbeatNow.
  describe("per-parent wake debounce", () => {
    it("skips subsequent wakes for the same parent within the debounce window", () => {
      const parent = "agent:main:discord:channel:1495460242920706168";
      for (let i = 0; i < 5; i++) {
        rewakeParentAfterAnnounce({
          parentSessionKey: parent,
          childSessionKey: `agent:claude:acp:child-${i}`,
          childRunId: `run-${i}`,
          delivered: true,
          expectsCompletionMessage: true,
        });
      }
      // Only the first wake fires; the rest are debounced.
      expect(requestHeartbeatNow).toHaveBeenCalledTimes(1);
    });

    it("debounce is per-parent — different parents each get one wake", () => {
      rewakeParentAfterAnnounce({
        parentSessionKey: "agent:main:discord:channel:AAA",
        childSessionKey: "agent:claude:acp:a1",
        childRunId: "run-a1",
        delivered: true,
        expectsCompletionMessage: true,
      });
      rewakeParentAfterAnnounce({
        parentSessionKey: "agent:main:discord:channel:BBB",
        childSessionKey: "agent:claude:acp:b1",
        childRunId: "run-b1",
        delivered: true,
        expectsCompletionMessage: true,
      });
      expect(requestHeartbeatNow).toHaveBeenCalledTimes(2);
    });

    it("resetting the debounce allows a subsequent wake for the same parent", () => {
      const parent = "agent:main:discord:channel:ccc";
      rewakeParentAfterAnnounce({
        parentSessionKey: parent,
        childSessionKey: "agent:claude:acp:c1",
        childRunId: "run-c1",
        delivered: true,
        expectsCompletionMessage: true,
      });
      expect(requestHeartbeatNow).toHaveBeenCalledTimes(1);

      // Second call within window = no new wake.
      rewakeParentAfterAnnounce({
        parentSessionKey: parent,
        childSessionKey: "agent:claude:acp:c2",
        childRunId: "run-c2",
        delivered: true,
        expectsCompletionMessage: true,
      });
      expect(requestHeartbeatNow).toHaveBeenCalledTimes(1);

      // After reset, a new wake goes through.
      __resetRewakeDebounceForTest();
      rewakeParentAfterAnnounce({
        parentSessionKey: parent,
        childSessionKey: "agent:claude:acp:c3",
        childRunId: "run-c3",
        delivered: true,
        expectsCompletionMessage: true,
      });
      expect(requestHeartbeatNow).toHaveBeenCalledTimes(2);
    });
  });
});
