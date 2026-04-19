import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetPreflightSeenForTest,
  buildDestinationCandidateSessionKeys,
  checkMessageToolScopedPromptPreflight,
  resolveScopedPromptForDestination,
} from "./outbound-scoped-prompt.frankclaw.js";
import {
  __resetScopedPromptCacheForTest,
  type ScopedPromptEntry,
} from "./scoped-prompt.frankclaw.js";

function writeRegistry(dir: string, entries: ScopedPromptEntry[]): void {
  const p = path.join(dir, "state", "channel-prompt-injections.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ schema: "channel-prompt-injections/v1", entries }, null, 2));
}

describe("outbound-scoped-prompt.frankclaw", () => {
  let tmpWorkspace: string;
  let prevWorkspace: string | undefined;

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "outbound-scoped-prompt-test-"));
    prevWorkspace = process.env["OPENCLAW_WORKSPACE"];
    process.env["OPENCLAW_WORKSPACE"] = tmpWorkspace;
    __resetScopedPromptCacheForTest();
    __resetPreflightSeenForTest();
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

  describe("buildDestinationCandidateSessionKeys", () => {
    it("builds three candidate keys for all peer kinds", () => {
      const keys = buildDestinationCandidateSessionKeys({
        channel: "discord",
        to: "1488885819891515494",
        agentId: "main",
      });
      expect(keys).toHaveLength(3);
      expect(keys).toContain("agent:main:discord:group:1488885819891515494");
      expect(keys).toContain("agent:main:discord:channel:1488885819891515494");
      expect(keys).toContain("agent:main:discord:direct:1488885819891515494");
    });

    it("normalizes channel and to to lowercase", () => {
      const keys = buildDestinationCandidateSessionKeys({
        channel: "Discord",
        to: "ABC123",
        agentId: "Main",
      });
      expect(keys[0]).toBe("agent:main:discord:group:abc123");
    });

    it("returns empty array when to is empty", () => {
      const keys = buildDestinationCandidateSessionKeys({
        channel: "discord",
        to: "",
        agentId: "main",
      });
      expect(keys).toHaveLength(0);
    });

    it("includes candidates that strip channel: prefix", () => {
      const keys = buildDestinationCandidateSessionKeys({
        channel: "discord",
        to: "channel:1488885819891515494",
        agentId: "main",
      });
      expect(keys).toContain("agent:main:discord:channel:1488885819891515494");
    });

    it("includes topic candidates when threadId is provided", () => {
      const keys = buildDestinationCandidateSessionKeys({
        channel: "telegram",
        to: "-100123",
        agentId: "main",
        threadId: 42,
      });
      expect(keys).toContain("agent:main:telegram:group:-100123:topic:42");
    });
  });

  describe("resolveScopedPromptForDestination", () => {
    it("returns undefined when registry is empty", () => {
      const result = resolveScopedPromptForDestination({
        channel: "discord",
        to: "1488885819891515494",
        agentId: "main",
      });
      expect(result).toBeUndefined();
    });

    it("matches entry by exact sessionKey for channel peer kind", () => {
      writeRegistry(tmpWorkspace, [
        {
          id: "wwsa-channel",
          match: { sessionKey: "agent:main:discord:channel:1488885819891515494" },
          prompt: "WWSA grinding AI instructions.",
        },
      ]);
      __resetScopedPromptCacheForTest();
      const result = resolveScopedPromptForDestination({
        channel: "discord",
        to: "1488885819891515494",
        agentId: "main",
      });
      expect(result).toContain("WWSA grinding AI instructions.");
      expect(result).toContain('<scoped_prompt id="wwsa-channel">');
    });

    it("matches entry when destination uses channel: prefix", () => {
      writeRegistry(tmpWorkspace, [
        {
          id: "wwsa-channel",
          match: { sessionKey: "agent:main:discord:channel:1488885819891515494" },
          prompt: "WWSA grinding AI instructions.",
        },
      ]);
      __resetScopedPromptCacheForTest();
      const result = resolveScopedPromptForDestination({
        channel: "discord",
        to: "channel:1488885819891515494",
        agentId: "main",
      });
      expect(result).toContain("WWSA grinding AI instructions.");
    });

    it("matches entry by exact sessionKey for WhatsApp group", () => {
      writeRegistry(tmpWorkspace, [
        {
          id: "dahong",
          match: { sessionKey: "agent:main:whatsapp:group:120363405743307729@g.us" },
          prompt: "DaHong group rules.",
        },
      ]);
      __resetScopedPromptCacheForTest();
      const result = resolveScopedPromptForDestination({
        channel: "whatsapp",
        to: "120363405743307729@g.us",
        agentId: "main",
      });
      expect(result).toContain("DaHong group rules.");
    });

    it("matches entry by channel type", () => {
      writeRegistry(tmpWorkspace, [
        {
          id: "all-discord",
          match: { channel: "discord" },
          prompt: "Discord style note.",
        },
      ]);
      __resetScopedPromptCacheForTest();
      const result = resolveScopedPromptForDestination({
        channel: "discord",
        to: "9999",
        agentId: "main",
      });
      expect(result).toContain("Discord style note.");
    });

    it("matches entry by sessionKeyPattern", () => {
      writeRegistry(tmpWorkspace, [
        {
          id: "telegram-frank",
          match: { sessionKeyPattern: "telegram.*7918451151" },
          prompt: "Frank direct instructions.",
        },
      ]);
      __resetScopedPromptCacheForTest();
      const result = resolveScopedPromptForDestination({
        channel: "telegram",
        to: "7918451151",
        agentId: "main",
      });
      expect(result).toContain("Frank direct instructions.");
    });

    it("returns undefined when no entries match", () => {
      writeRegistry(tmpWorkspace, [
        {
          id: "other",
          match: { sessionKey: "agent:main:discord:channel:9999" },
          prompt: "Not relevant.",
        },
      ]);
      __resetScopedPromptCacheForTest();
      const result = resolveScopedPromptForDestination({
        channel: "whatsapp",
        to: "120363405743307729@g.us",
        agentId: "main",
      });
      expect(result).toBeUndefined();
    });

    it("deduplicates entries matched via multiple peer kinds", () => {
      // An entry matching by channel will match all three candidate keys.
      writeRegistry(tmpWorkspace, [
        {
          id: "all-discord",
          match: { channel: "discord" },
          prompt: "Unique instruction.",
        },
      ]);
      __resetScopedPromptCacheForTest();
      const result = resolveScopedPromptForDestination({
        channel: "discord",
        to: "123",
        agentId: "main",
      });
      // Should appear exactly once, not three times.
      expect(result).toBe(
        '<scoped_prompt id="all-discord">\nUnique instruction.\n</scoped_prompt>',
      );
    });
  });

  describe("checkMessageToolScopedPromptPreflight", () => {
    it("proceeds immediately for same-session sends", () => {
      const result = checkMessageToolScopedPromptPreflight({
        currentSessionKey: "agent:main:discord:channel:123",
        destinationChannel: "discord",
        destinationTarget: "123",
        agentId: "main",
      });
      expect(result.proceed).toBe(true);
    });

    it("treats channel: prefixed targets as same-session when they resolve to the same destination", () => {
      const result = checkMessageToolScopedPromptPreflight({
        currentSessionKey: "agent:main:discord:channel:123",
        destinationChannel: "discord",
        destinationTarget: "channel:123",
        agentId: "main",
      });
      expect(result.proceed).toBe(true);
    });

    it("proceeds when no scoped prompts exist for destination", () => {
      const result = checkMessageToolScopedPromptPreflight({
        currentSessionKey: "agent:main:telegram:direct:7918451151",
        destinationChannel: "discord",
        destinationTarget: "1488885819891515494",
        agentId: "main",
      });
      expect(result.proceed).toBe(true);
    });

    it("blocks first call with scoped prompt XML, then proceeds on second call", () => {
      writeRegistry(tmpWorkspace, [
        {
          id: "target-rules",
          match: { sessionKey: "agent:main:discord:channel:1488885819891515494" },
          prompt: "Follow WWSA rules.",
        },
      ]);
      __resetScopedPromptCacheForTest();

      const preflightParams = {
        currentSessionKey: "agent:main:telegram:direct:7918451151",
        destinationChannel: "discord",
        destinationTarget: "1488885819891515494",
        agentId: "main",
      };

      // First call: should block.
      const first = checkMessageToolScopedPromptPreflight(preflightParams);
      expect(first.proceed).toBe(false);
      if (!first.proceed) {
        expect(first.scopedPromptXml).toContain("Follow WWSA rules.");
        expect(first.instruction).toContain("re-issue");
      }

      // Second call: should proceed.
      const second = checkMessageToolScopedPromptPreflight(preflightParams);
      expect(second.proceed).toBe(true);
    });

    it("blocks only cross-session, not same-session even when prompts exist", () => {
      writeRegistry(tmpWorkspace, [
        {
          id: "discord-all",
          match: { channel: "discord" },
          prompt: "Discord rules.",
        },
      ]);
      __resetScopedPromptCacheForTest();

      // Same session: should proceed.
      const same = checkMessageToolScopedPromptPreflight({
        currentSessionKey: "agent:main:discord:channel:123",
        destinationChannel: "discord",
        destinationTarget: "123",
        agentId: "main",
      });
      expect(same.proceed).toBe(true);

      // Cross session: should block first time.
      const cross = checkMessageToolScopedPromptPreflight({
        currentSessionKey: "agent:main:telegram:direct:999",
        destinationChannel: "discord",
        destinationTarget: "123",
        agentId: "main",
      });
      expect(cross.proceed).toBe(false);
    });
  });
});
