import { describe, expect, it } from "vitest";
import { collectRecentMediaFromHistory } from "./process-message.js";

describe("collectRecentMediaFromHistory", () => {
  const now = 1700000000000;

  it("returns empty when history has no media entries", () => {
    const result = collectRecentMediaFromHistory({
      history: [
        {
          sender: "Alice",
          body: "hello",
          timestamp: now - 60_000,
          senderJid: "alice@s.whatsapp.net",
        },
      ],
      senderJid: "alice@s.whatsapp.net",
      currentTimestamp: now,
    });
    expect(result.mediaPaths).toHaveLength(0);
    expect(result.mediaTypes).toHaveLength(0);
  });

  it("collects media from same sender within 5-minute window", () => {
    const result = collectRecentMediaFromHistory({
      history: [
        {
          sender: "Alice",
          body: "<media:image>",
          timestamp: now - 60_000,
          senderJid: "alice@s.whatsapp.net",
          mediaPath: "/media/inbound/photo1.jpg",
          mediaType: "image/jpeg",
        },
      ],
      senderJid: "alice@s.whatsapp.net",
      currentTimestamp: now,
    });
    expect(result.mediaPaths).toEqual(["/media/inbound/photo1.jpg"]);
    expect(result.mediaTypes).toEqual(["image/jpeg"]);
  });

  it("ignores media from a different sender", () => {
    const result = collectRecentMediaFromHistory({
      history: [
        {
          sender: "Bob",
          body: "<media:image>",
          timestamp: now - 60_000,
          senderJid: "bob@s.whatsapp.net",
          mediaPath: "/media/inbound/photo-bob.jpg",
          mediaType: "image/jpeg",
        },
      ],
      senderJid: "alice@s.whatsapp.net",
      currentTimestamp: now,
    });
    expect(result.mediaPaths).toHaveLength(0);
  });

  it("ignores media older than 5 minutes", () => {
    const result = collectRecentMediaFromHistory({
      history: [
        {
          sender: "Alice",
          body: "<media:image>",
          timestamp: now - 6 * 60_000, // 6 minutes ago
          senderJid: "alice@s.whatsapp.net",
          mediaPath: "/media/inbound/old-photo.jpg",
          mediaType: "image/jpeg",
        },
      ],
      senderJid: "alice@s.whatsapp.net",
      currentTimestamp: now,
    });
    expect(result.mediaPaths).toHaveLength(0);
  });

  it("caps at 3 items", () => {
    const history = Array.from({ length: 5 }, (_, i) => ({
      sender: "Alice",
      body: `<media:image>`,
      timestamp: now - (5 - i) * 30_000,
      senderJid: "alice@s.whatsapp.net",
      mediaPath: `/media/inbound/photo${i}.jpg`,
      mediaType: "image/jpeg",
    }));
    const result = collectRecentMediaFromHistory({
      history,
      senderJid: "alice@s.whatsapp.net",
      currentTimestamp: now,
    });
    expect(result.mediaPaths).toHaveLength(3);
  });

  it("defaults mediaType to application/octet-stream when missing", () => {
    const result = collectRecentMediaFromHistory({
      history: [
        {
          sender: "Alice",
          body: "<media:document>",
          timestamp: now - 60_000,
          senderJid: "alice@s.whatsapp.net",
          mediaPath: "/media/inbound/doc.pdf",
          // no mediaType
        },
      ],
      senderJid: "alice@s.whatsapp.net",
      currentTimestamp: now,
    });
    expect(result.mediaTypes).toEqual(["application/octet-stream"]);
  });

  it("returns empty when senderJid is undefined", () => {
    const result = collectRecentMediaFromHistory({
      history: [
        {
          sender: "Alice",
          body: "<media:image>",
          timestamp: now - 60_000,
          senderJid: "alice@s.whatsapp.net",
          mediaPath: "/media/inbound/photo.jpg",
          mediaType: "image/jpeg",
        },
      ],
      senderJid: undefined,
      currentTimestamp: now,
    });
    expect(result.mediaPaths).toHaveLength(0);
  });

  it("returns empty when currentTimestamp is undefined", () => {
    const result = collectRecentMediaFromHistory({
      history: [
        {
          sender: "Alice",
          body: "<media:image>",
          timestamp: 1700000000000,
          senderJid: "alice@s.whatsapp.net",
          mediaPath: "/media/inbound/photo.jpg",
          mediaType: "image/jpeg",
        },
      ],
      senderJid: "alice@s.whatsapp.net",
      currentTimestamp: undefined,
    });
    expect(result.mediaPaths).toHaveLength(0);
  });
});
