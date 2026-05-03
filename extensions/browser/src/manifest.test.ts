import fs from "node:fs";
import { describe, expect, it } from "vitest";

type BrowserPackageManifest = {
  dependencies?: Record<string, string>;
  openclaw?: {
    bundle?: {
      stageRuntimeDependencies?: boolean;
    };
  };
};

// Regression test for the 2026-05-02 crash loop:
// extensions/browser/package.json was missing openclaw.bundle.stageRuntimeDependencies,
// so stage-bundled-plugin-runtime-deps.mjs never staged the browser plugin's runtime deps.
// The gateway then threw BundledRuntimeDepsMissingError which the frankclaw
// plugin-load-guard escalated into a crash loop.
describe("browser package manifest", () => {
  it("opts into staging bundled runtime dependencies", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as BrowserPackageManifest;

    expect(packageJson.dependencies).toBeDefined();
    expect(Object.keys(packageJson.dependencies ?? {})).not.toHaveLength(0);
    expect(packageJson.openclaw?.bundle?.stageRuntimeDependencies).toBe(true);
  });
});
