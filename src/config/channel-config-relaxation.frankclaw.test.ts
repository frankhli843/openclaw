import { describe, expect, it } from "vitest";
import { ChannelsSchema } from "./zod-schema.channels-config.js";

describe("channel config additionalProperties relaxation", () => {
  it("accepts known defaults without error", () => {
    const result = ChannelsSchema.parse({
      defaults: {
        groupPolicy: "open",
      },
    });
    expect(result!.defaults!.groupPolicy).toBe("open");
  });

  it("accepts additional unknown channel properties via passthrough", () => {
    // Extension channels like nostr, matrix, zalo should be accepted
    // without failing validation thanks to .passthrough() on ChannelsSchema
    expect(() =>
      ChannelsSchema.parse({
        nostr: { enabled: true, relays: ["wss://relay.example.com"] },
      }),
    ).not.toThrow();
  });

  it("accepts multiple unknown extension channel configs simultaneously", () => {
    expect(() =>
      ChannelsSchema.parse({
        matrix: { homeserver: "https://matrix.example.com", enabled: true },
        zalo: { enabled: false },
        customChannel: { foo: "bar", baz: 42 },
      }),
    ).not.toThrow();
  });

  it("accepts mix of known defaults and unknown extension channels", () => {
    const result = ChannelsSchema.parse({
      defaults: {
        groupPolicy: "open",
      },
      nostr: { enabled: true },
      matrix: { homeserver: "https://matrix.org" },
    });
    expect(result!.defaults!.groupPolicy).toBe("open");
  });

  it("rejects invalid values in known fields even with passthrough", () => {
    expect(() =>
      ChannelsSchema.parse({
        defaults: {
          groupPolicy: 12345, // invalid type
        },
      }),
    ).toThrow();
  });
});
