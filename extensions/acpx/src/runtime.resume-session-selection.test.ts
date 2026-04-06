import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "runtime.ts"), "utf8");
const normalized = source.replace(/\s+/g, " ");

describe("ACPX runtime resume selection source contract", () => {
  it("mentions both agentSessionId and acpxSessionId in the runtime resume path", () => {
    expect(source.includes("agentSessionId")).toBe(true);
    expect(source.includes("acpxSessionId")).toBe(true);
  });

  it("contains an agentSessionId-first resume selection hint", () => {
    const preferencePatterns = [
      /agentSessionId\s*\?\?\s*acpxSessionId/,
      /agentSessionId\s*\|\|\s*acpxSessionId/,
      /agentSessionId[^]{0,240}acpxSessionId/,
    ];

    expect(preferencePatterns.some((pattern) => pattern.test(normalized))).toBe(true);
  });
});
