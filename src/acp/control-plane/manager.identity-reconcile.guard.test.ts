import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("ACP session identity merge guardrail", () => {
  it("prefers the refreshed runtimeSessionName when next identity exists", () => {
    const sourcePath = fileURLToPath(new URL("./manager.identity-reconcile.ts", import.meta.url));
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).toContain(
      "runtimeSessionName: params.meta.runtimeSessionName ?? base.runtimeSessionName,",
    );
    expect(source).not.toContain("runtimeSessionName: base.runtimeSessionName,");
  });
});
