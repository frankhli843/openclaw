import { describe, expect, it } from "vitest";
import { buildDiscordMessagePayload } from "./send.shared.js";

describe("buildDiscordMessagePayload", () => {
  it("trims leading and trailing whitespace from content", () => {
    const payload = buildDiscordMessagePayload({ text: "\n\n  Hello World  \n\n" });
    expect(payload.content).toBe("Hello World");
  });

  it("trims leading newlines from content", () => {
    const payload = buildDiscordMessagePayload({ text: "\n\nHello" });
    expect(payload.content).toBe("Hello");
  });

  it("trims trailing newlines from content", () => {
    const payload = buildDiscordMessagePayload({ text: "Hello\n\n" });
    expect(payload.content).toBe("Hello");
  });

  it("preserves internal whitespace and newlines", () => {
    const payload = buildDiscordMessagePayload({ text: "Hello\n\nWorld" });
    expect(payload.content).toBe("Hello\n\nWorld");
  });

  it("omits content when text is only whitespace", () => {
    const payload = buildDiscordMessagePayload({ text: "   \n\n  " });
    expect(payload.content).toBeUndefined();
  });

  it("omits content when text is empty", () => {
    const payload = buildDiscordMessagePayload({ text: "" });
    expect(payload.content).toBeUndefined();
  });
});
