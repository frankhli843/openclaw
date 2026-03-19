import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkChannelPolicy } from "./channel-policy.js";

describe.sequential("channel policy aliases", () => {
  const previousWorkspace = process.env.OPENCLAW_WORKSPACE;
  let workspace = "";

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "channel-policy-"));
    process.env.OPENCLAW_WORKSPACE = workspace;
  });

  afterEach(() => {
    if (previousWorkspace === undefined) {
      delete process.env.OPENCLAW_WORKSPACE;
    } else {
      process.env.OPENCLAW_WORKSPACE = previousWorkspace;
    }
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("allows discord channel via guild alias entry", () => {
    const policyPath = path.join(workspace, "channel-policy.json");
    fs.writeFileSync(
      policyPath,
      JSON.stringify(
        {
          defaultPolicy: "ask",
          channels: {
            "discord:guild:123456789": {
              policy: "allow",
            },
          },
        },
        null,
        2,
      ),
    );

    const decision = checkChannelPolicy("discord", "channel:987654321", false, {
      aliases: ["discord:guild:123456789"],
    });

    expect(decision).toEqual({ action: "allow" });
  });

  it("keeps unknown channels as ask when no alias matches", () => {
    const decision = checkChannelPolicy("discord", "channel:111", false, {
      aliases: ["discord:guild:does-not-exist"],
    });

    expect(decision).toEqual({ action: "ask", channelKey: "discord:channel:111" });
  });
});
