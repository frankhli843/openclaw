import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetScopedPromptCacheForTest,
  entryMatches,
  loadScopedPromptRegistry,
  resolveScopedPromptForContext,
  type ScopedPromptEntry,
} from "./scoped-prompt.frankclaw.js";

function writeRegistry(dir: string, entries: ScopedPromptEntry[]): void {
  const p = path.join(dir, "state", "channel-prompt-injections.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ schema: "channel-prompt-injections/v1", entries }, null, 2));
}

describe("scoped-prompt.frankclaw", () => {
  let tmpWorkspace: string;
  let prevWorkspace: string | undefined;

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-prompt-test-"));
    prevWorkspace = process.env["OPENCLAW_WORKSPACE"];
    process.env["OPENCLAW_WORKSPACE"] = tmpWorkspace;
    __resetScopedPromptCacheForTest();
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

  describe("loadScopedPromptRegistry", () => {
    it("returns empty registry when file missing", () => {
      const r = loadScopedPromptRegistry();
      expect(r.entries).toEqual([]);
    });

    it("returns empty registry when file is malformed", () => {
      const p = path.join(tmpWorkspace, "state", "channel-prompt-injections.json");
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, "{not valid json");
      const r = loadScopedPromptRegistry();
      expect(r.entries).toEqual([]);
    });

    it("filters out malformed entries", () => {
      writeRegistry(tmpWorkspace, [
        { id: "good", match: { channel: "discord" }, prompt: "hello" },
        { id: "", match: { channel: "discord" }, prompt: "no-id" } as ScopedPromptEntry,
        { id: "no-prompt", match: { channel: "discord" }, prompt: "" } as ScopedPromptEntry,
      ]);
      __resetScopedPromptCacheForTest();
      const r = loadScopedPromptRegistry();
      expect(r.entries.map((e) => e.id)).toEqual(["good"]);
    });
  });

  describe("entryMatches", () => {
    const base: ScopedPromptEntry = { id: "t", match: {}, prompt: "p" };

    it("rejects entries with no predicates (safety rail)", () => {
      expect(entryMatches(base, { sessionKey: "agent:main:discord:channel:1" })).toBe(false);
    });

    it("matches by channel type", () => {
      const e: ScopedPromptEntry = { ...base, match: { channel: "discord" } };
      expect(entryMatches(e, { sessionKey: "agent:main:discord:channel:1" })).toBe(true);
      expect(entryMatches(e, { sessionKey: "agent:main:telegram:direct:1" })).toBe(false);
    });

    it("matches by exact sessionKey (case-insensitive)", () => {
      const e: ScopedPromptEntry = {
        ...base,
        match: { sessionKey: "agent:main:discord:channel:ABC123" },
      };
      expect(entryMatches(e, { sessionKey: "agent:main:discord:channel:abc123" })).toBe(true);
      expect(entryMatches(e, { sessionKey: "agent:main:discord:channel:def" })).toBe(false);
    });

    it("matches by sessionKey regex", () => {
      const e: ScopedPromptEntry = {
        ...base,
        match: { sessionKeyPattern: "^agent:main:discord:channel:14888" },
      };
      expect(
        entryMatches(e, { sessionKey: "agent:main:discord:channel:1488885819891515494" }),
      ).toBe(true);
      expect(entryMatches(e, { sessionKey: "agent:main:discord:channel:9999" })).toBe(false);
    });

    it("matches by thread-name regex", () => {
      const e: ScopedPromptEntry = { ...base, match: { threadNamePattern: "^/iterate" } };
      expect(
        entryMatches(e, {
          sessionKey: "agent:main:discord:channel:1",
          threadName: "/iterate_continuously on genie",
        }),
      ).toBe(true);
      expect(
        entryMatches(e, { sessionKey: "agent:main:discord:channel:1", threadName: "random" }),
      ).toBe(false);
    });

    it("ALL specified predicates must match (AND semantics)", () => {
      const e: ScopedPromptEntry = {
        ...base,
        match: { channel: "discord", threadNamePattern: "F28B" },
      };
      expect(
        entryMatches(e, {
          sessionKey: "agent:main:discord:channel:1",
          threadName: "F28B v4 metrics",
        }),
      ).toBe(true);
      // wrong channel
      expect(
        entryMatches(e, {
          sessionKey: "agent:main:telegram:direct:1",
          threadName: "F28B v4 metrics",
        }),
      ).toBe(false);
      // wrong thread
      expect(
        entryMatches(e, { sessionKey: "agent:main:discord:channel:1", threadName: "random" }),
      ).toBe(false);
    });

    it("skips entries with enabled=false", () => {
      const e: ScopedPromptEntry = {
        ...base,
        enabled: false,
        match: { channel: "discord" },
      };
      expect(entryMatches(e, { sessionKey: "agent:main:discord:channel:1" })).toBe(false);
    });

    it("safely ignores invalid regex patterns (no crash, no match)", () => {
      const e: ScopedPromptEntry = {
        ...base,
        match: { sessionKeyPattern: "([unclosed" },
      };
      expect(entryMatches(e, { sessionKey: "agent:main:discord:channel:1" })).toBe(false);
    });
  });

  describe("resolveScopedPromptForContext", () => {
    it("returns undefined when registry is empty", () => {
      expect(
        resolveScopedPromptForContext({ sessionKey: "agent:main:discord:channel:1" }),
      ).toBeUndefined();
    });

    it("emits a single <scoped_prompt> when one entry matches", () => {
      writeRegistry(tmpWorkspace, [
        {
          id: "wwsa-grinding-ai",
          match: { channel: "discord" },
          prompt: "Use v6 as baseline unless a newer iteration is referenced.",
        },
      ]);
      __resetScopedPromptCacheForTest();
      const result = resolveScopedPromptForContext({
        sessionKey: "agent:main:discord:channel:1",
      });
      expect(result).toBe(
        '<scoped_prompt id="wwsa-grinding-ai">\nUse v6 as baseline unless a newer iteration is referenced.\n</scoped_prompt>',
      );
    });

    it("wraps multiple matches in <scoped_prompts>", () => {
      writeRegistry(tmpWorkspace, [
        {
          id: "all-discord",
          match: { channel: "discord" },
          prompt: "General Discord style note.",
        },
        {
          id: "iterate-threads",
          match: { threadNamePattern: "^/iterate" },
          prompt: "Use the coding-agent SKILL.md flow.",
        },
      ]);
      __resetScopedPromptCacheForTest();
      const result = resolveScopedPromptForContext({
        sessionKey: "agent:main:discord:channel:1",
        threadName: "/iterate genie",
      });
      expect(result).toContain("<scoped_prompts>");
      expect(result).toContain('<scoped_prompt id="all-discord">');
      expect(result).toContain('<scoped_prompt id="iterate-threads">');
      expect(result).toContain("</scoped_prompts>");
    });

    it("XML-escapes the id attribute", () => {
      writeRegistry(tmpWorkspace, [{ id: "a&b<c>", match: { channel: "discord" }, prompt: "x" }]);
      __resetScopedPromptCacheForTest();
      const result = resolveScopedPromptForContext({
        sessionKey: "agent:main:discord:channel:1",
      });
      expect(result).toContain('id="a&amp;b&lt;c&gt;"');
    });

    it("supports a full target-practice example (Discord thread by id)", () => {
      writeRegistry(tmpWorkspace, [
        {
          id: "f28b-thread",
          match: { sessionKey: "agent:main:discord:channel:1493276394732519577" },
          prompt:
            "F28B integration thread. Current baseline is v6 (prod) unless a newer iteration is referenced.",
        },
      ]);
      __resetScopedPromptCacheForTest();
      const result = resolveScopedPromptForContext({
        sessionKey: "agent:main:discord:channel:1493276394732519577",
      });
      expect(result).toContain('<scoped_prompt id="f28b-thread">');
      expect(result).toContain("F28B integration thread");
    });

    it("supports WhatsApp group exact match", () => {
      writeRegistry(tmpWorkspace, [
        {
          id: "dahong",
          match: { sessionKey: "agent:main:whatsapp:group:120363405743307729@g.us" },
          prompt: "DaHong group. Default English, switch to Chinese if Charlotte does.",
        },
      ]);
      __resetScopedPromptCacheForTest();
      const result = resolveScopedPromptForContext({
        sessionKey: "agent:main:whatsapp:group:120363405743307729@g.us",
      });
      expect(result).toContain('<scoped_prompt id="dahong">');
    });

    it("supports Telegram direct chat exact match", () => {
      writeRegistry(tmpWorkspace, [
        {
          id: "frank-tg-direct",
          match: { sessionKey: "agent:main:telegram:direct:7918451151" },
          prompt: "Direct chat with Frank. Honest, succinct, no filler.",
        },
      ]);
      __resetScopedPromptCacheForTest();
      const result = resolveScopedPromptForContext({
        sessionKey: "agent:main:telegram:direct:7918451151",
      });
      expect(result).toContain("Honest, succinct");
    });
  });
});
