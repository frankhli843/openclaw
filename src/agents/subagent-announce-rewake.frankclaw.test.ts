import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestHeartbeatNow = vi.fn();
vi.mock("../infra/heartbeat-wake.js", () => ({
  requestHeartbeatNow: (opts: unknown) => requestHeartbeatNow(opts),
}));

import { rewakeParentAfterAnnounce } from "./subagent-announce-rewake.frankclaw.js";

describe("rewakeParentAfterAnnounce", () => {
  let tmpWorkspace: string;
  let prevWorkspace: string | undefined;

  beforeEach(() => {
    requestHeartbeatNow.mockReset();
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
});
