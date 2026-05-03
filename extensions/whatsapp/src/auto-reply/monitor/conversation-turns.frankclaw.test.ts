import { beforeEach, describe, expect, it } from "vitest";
import {
  buildConversationTurnsHistoryEntries,
  buildConversationTurnsContext,
  CONVERSATION_TURNS_END_MARKER,
  CONVERSATION_TURNS_MARKER,
  DEFAULT_MAX_CONVERSATION_TURNS,
  getConversationTurns,
  prependConversationTurnsToBody,
  recordConversationTurn,
  __clearAllConversationTurns,
  __clearConversationTurnsMemoryOnlyForTest,
  __getConversationTurnsMap,
} from "./conversation-turns.frankclaw.js";

describe("conversation-turns.frankclaw", () => {
  beforeEach(() => {
    __clearAllConversationTurns();
  });

  describe("recordConversationTurn", () => {
    it("records a single turn", () => {
      recordConversationTurn({
        chatKey: "chat:1",
        userMessage: "What is the weather?",
        botReply: "It's sunny today!",
        timestamp: 1000,
        senderLabel: "Frank",
      });

      const turns = getConversationTurns("chat:1");
      expect(turns).toHaveLength(1);
      expect(turns[0]).toEqual({
        userMessage: "What is the weather?",
        botReply: "It's sunny today!",
        timestamp: 1000,
        senderLabel: "Frank",
      });
    });

    it("records multiple turns in order", () => {
      recordConversationTurn({
        chatKey: "chat:1",
        userMessage: "Show me recipes",
        botReply: "Here are 3 recipes: lasagna, pasta, pizza",
        timestamp: 1000,
      });
      recordConversationTurn({
        chatKey: "chat:1",
        userMessage: "Just the first one",
        botReply: "Here's the lasagna recipe...",
        timestamp: 2000,
      });

      const turns = getConversationTurns("chat:1");
      expect(turns).toHaveLength(2);
      expect(turns[0].userMessage).toBe("Show me recipes");
      expect(turns[1].userMessage).toBe("Just the first one");
    });

    it("evicts oldest turns when exceeding max", () => {
      for (let i = 0; i < 7; i++) {
        recordConversationTurn({
          chatKey: "chat:1",
          userMessage: `msg ${i}`,
          botReply: `reply ${i}`,
          timestamp: i * 1000,
          maxTurns: 5,
        });
      }

      const turns = getConversationTurns("chat:1");
      expect(turns).toHaveLength(5);
      expect(turns[0].userMessage).toBe("msg 2");
      expect(turns[4].userMessage).toBe("msg 6");
    });

    it("respects custom maxTurns", () => {
      for (let i = 0; i < 5; i++) {
        recordConversationTurn({
          chatKey: "chat:1",
          userMessage: `msg ${i}`,
          botReply: `reply ${i}`,
          timestamp: i * 1000,
          maxTurns: 2,
        });
      }

      const turns = getConversationTurns("chat:1");
      expect(turns).toHaveLength(2);
      expect(turns[0].userMessage).toBe("msg 3");
      expect(turns[1].userMessage).toBe("msg 4");
    });

    it("does nothing when maxTurns is 0", () => {
      recordConversationTurn({
        chatKey: "chat:1",
        userMessage: "hello",
        botReply: "hi",
        timestamp: 1000,
        maxTurns: 0,
      });

      expect(getConversationTurns("chat:1")).toHaveLength(0);
    });

    it("tracks multiple chats independently", () => {
      recordConversationTurn({
        chatKey: "chat:1",
        userMessage: "hello from chat 1",
        botReply: "hi chat 1",
        timestamp: 1000,
      });
      recordConversationTurn({
        chatKey: "chat:2",
        userMessage: "hello from chat 2",
        botReply: "hi chat 2",
        timestamp: 2000,
      });

      expect(getConversationTurns("chat:1")).toHaveLength(1);
      expect(getConversationTurns("chat:2")).toHaveLength(1);
      expect(getConversationTurns("chat:1")[0].userMessage).toBe("hello from chat 1");
      expect(getConversationTurns("chat:2")[0].userMessage).toBe("hello from chat 2");
    });

    it("returns empty array for unknown chat", () => {
      expect(getConversationTurns("nonexistent")).toEqual([]);
    });

    it("reloads turns from durable storage after memory is cleared", () => {
      recordConversationTurn({
        chatKey: "chat:durable",
        userMessage: "Register this as Frank",
        botReply: "Got it, Frank. Voice sample noted.",
        timestamp: 1000,
        senderLabel: "Frank",
      });

      __clearConversationTurnsMemoryOnlyForTest();

      const turns = getConversationTurns("chat:durable");
      expect(turns).toHaveLength(1);
      expect(turns[0]).toMatchObject({
        userMessage: "Register this as Frank",
        botReply: "Got it, Frank. Voice sample noted.",
        senderLabel: "Frank",
      });
    });

    it("evicts oldest chat keys when exceeding max keys", () => {
      // Record turns for 502 different chats (max is 500)
      for (let i = 0; i < 502; i++) {
        recordConversationTurn({
          chatKey: `chat:${i}`,
          userMessage: `msg ${i}`,
          botReply: `reply ${i}`,
          timestamp: i,
        });
      }

      const map = __getConversationTurnsMap();
      expect(map.size).toBeLessThanOrEqual(500);
      // Oldest chats should be evicted
      expect(map.has("chat:0")).toBe(false);
      expect(map.has("chat:1")).toBe(false);
      // Newest chats should remain
      expect(map.has("chat:501")).toBe(true);
    });

    it("uses DEFAULT_MAX_CONVERSATION_TURNS when maxTurns not specified", () => {
      expect(DEFAULT_MAX_CONVERSATION_TURNS).toBe(5);

      for (let i = 0; i < DEFAULT_MAX_CONVERSATION_TURNS + 3; i++) {
        recordConversationTurn({
          chatKey: "chat:1",
          userMessage: `msg ${i}`,
          botReply: `reply ${i}`,
          timestamp: i * 1000,
        });
      }

      expect(getConversationTurns("chat:1")).toHaveLength(DEFAULT_MAX_CONVERSATION_TURNS);
    });
  });

  describe("buildConversationTurnsContext", () => {
    it("returns empty string for no turns", () => {
      expect(buildConversationTurnsContext({ turns: [] })).toBe("");
    });

    it("formats turns with default formatting", () => {
      const result = buildConversationTurnsContext({
        turns: [
          {
            userMessage: "What time is it?",
            botReply: "It's 3 PM",
            timestamp: 1000,
            senderLabel: "Frank",
          },
        ],
      });

      expect(result).toContain(CONVERSATION_TURNS_MARKER);
      expect(result).toContain(CONVERSATION_TURNS_END_MARKER);
      expect(result).toContain("Frank: What time is it?");
      expect(result).toContain("Assistant: It's 3 PM");
    });

    it("formats multiple turns", () => {
      const result = buildConversationTurnsContext({
        turns: [
          {
            userMessage: "Show recipes",
            botReply: "Here are recipes: A, B, C",
            timestamp: 1000,
            senderLabel: "Frank",
          },
          {
            userMessage: "Just A",
            botReply: "Here's recipe A...",
            timestamp: 2000,
            senderLabel: "Frank",
          },
        ],
      });

      expect(result).toContain("Frank: Show recipes");
      expect(result).toContain("Assistant: Here are recipes: A, B, C");
      expect(result).toContain("Frank: Just A");
      expect(result).toContain("Assistant: Here's recipe A...");
    });

    it("uses 'User' as default sender label", () => {
      const result = buildConversationTurnsContext({
        turns: [
          {
            userMessage: "hello",
            botReply: "hi",
            timestamp: 1000,
          },
        ],
      });

      expect(result).toContain("User: hello");
    });

    it("supports custom formatters", () => {
      const result = buildConversationTurnsContext({
        turns: [
          {
            userMessage: "hello",
            botReply: "hi",
            timestamp: 1000,
            senderLabel: "Frank",
          },
        ],
        formatUserMessage: (turn) => `[USER ${turn.senderLabel}] ${turn.userMessage}`,
        formatBotReply: (turn) => `[BOT] ${turn.botReply}`,
      });

      expect(result).toContain("[USER Frank] hello");
      expect(result).toContain("[BOT] hi");
    });
  });

  describe("prependConversationTurnsToBody", () => {
    it("returns original body when no turns exist", () => {
      const result = prependConversationTurnsToBody({
        chatKey: "chat:nonexistent",
        currentBody: "Current message text",
      });

      expect(result).toBe("Current message text");
    });

    it("prepends turns context to body", () => {
      recordConversationTurn({
        chatKey: "chat:1",
        userMessage: "Show me recipes",
        botReply: "Here are 3 recipes",
        timestamp: 1000,
        senderLabel: "Frank",
      });

      const result = prependConversationTurnsToBody({
        chatKey: "chat:1",
        currentBody: "Just the first one please",
      });

      expect(result).toContain(CONVERSATION_TURNS_MARKER);
      expect(result).toContain("Frank: Show me recipes");
      expect(result).toContain("Assistant: Here are 3 recipes");
      expect(result).toContain(CONVERSATION_TURNS_END_MARKER);
      expect(result).toContain("Just the first one please");

      // Turns context should come before current body
      const turnsEndIdx = result.indexOf(CONVERSATION_TURNS_END_MARKER);
      const currentBodyIdx = result.indexOf("Just the first one please");
      expect(turnsEndIdx).toBeLessThan(currentBodyIdx);
    });

    it("works with the screenshot scenario: 'Nope just this one'", () => {
      // Simulate: user asked about recipes, bot replied, now follow-up
      recordConversationTurn({
        chatKey: "dahong-group",
        userMessage: "Show me the recipe for lasagna",
        botReply:
          "Here are 3 Italian recipes you might like: lasagna, carbonara, and risotto. Want me to detail any of them?",
        timestamp: 1000,
        senderLabel: "Frank (+16478023321)",
      });

      const result = prependConversationTurnsToBody({
        chatKey: "dahong-group",
        currentBody: "Nope just this one",
      });

      // The model should now see the prior exchange
      expect(result).toContain("Show me the recipe for lasagna");
      expect(result).toContain("lasagna, carbonara, and risotto");
      expect(result).toContain("Nope just this one");
    });
  });

  describe("buildConversationTurnsHistoryEntries", () => {
    it("converts prior turns into structured inbound history entries", () => {
      recordConversationTurn({
        chatKey: "chat:history",
        userMessage: "Register this as Frank",
        botReply: "Got it, Frank. English voice sample noted.",
        timestamp: 1000,
        senderLabel: "Frank",
      });

      expect(buildConversationTurnsHistoryEntries("chat:history")).toEqual([
        {
          sender: "Frank",
          body: "Register this as Frank",
          timestamp: 1000,
        },
        {
          sender: "Doraemon",
          body: "Got it, Frank. English voice sample noted.",
          timestamp: 1001,
        },
      ]);
    });
  });
});
