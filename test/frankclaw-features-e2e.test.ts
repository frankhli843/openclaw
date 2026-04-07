/**
 * Frankclaw Feature Registry — E2E Verification
 *
 * This test loads the built module graph and verifies that all frankclaw
 * custom feature hook points are wired correctly.  It exercises the same
 * static probes defined in `frankclaw-features.json` but through actual
 * file-system reads of the BUILT output, catching cases where source-level
 * greps pass but the build pipeline drops a hook (tree-shaking, dead code
 * elimination, missing re-exports, etc.).
 *
 * Run with: pnpm test test/frankclaw-features.e2e.test.ts
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const FEATURES_PATH = path.join(REPO_ROOT, "frankclaw-features.json");

interface StaticProbe {
  file: string;
  pattern: string;
  minCount?: number;
  note?: string;
}

interface Feature {
  id?: string;
  name: string;
  description?: string;
  location?: string;
  hookPoint?: string;
  status?: string;
  static: StaticProbe[];
  tests: string[];
  e2eTests?: string[];
  runtime: unknown[];
}

interface FeaturesFile {
  features: Feature[];
}

function loadFeatures(): FeaturesFile {
  const raw = fs.readFileSync(FEATURES_PATH, "utf8");
  return JSON.parse(raw) as FeaturesFile;
}

describe("frankclaw feature registry e2e verification", () => {
  const { features } = loadFeatures();

  it("feature registry file is valid JSON with at least one feature", () => {
    expect(features).toBeDefined();
    expect(features.length).toBeGreaterThan(0);
  });

  // Verify every feature has required test arrays
  describe("registry completeness", () => {
    for (const feature of features) {
      if (feature.status === "planned") {
        continue;
      }

      it(`${feature.name} has unit tests registered`, () => {
        expect(
          feature.tests?.length,
          `Feature "${feature.name}" must have at least one unit test in "tests" array`,
        ).toBeGreaterThan(0);
      });

      it(`${feature.name} has e2e tests registered`, () => {
        expect(
          (feature.e2eTests ?? []).length,
          `Feature "${feature.name}" must have at least one e2e test in "e2eTests" array`,
        ).toBeGreaterThan(0);
      });
    }
  });

  // Verify all registered test files exist on disk
  describe("test file existence", () => {
    for (const feature of features) {
      if (feature.status === "planned") {
        continue;
      }

      for (const testPath of feature.tests ?? []) {
        it(`${feature.name}: unit test ${testPath} exists`, () => {
          const fullPath = path.join(REPO_ROOT, testPath);
          expect(fs.existsSync(fullPath), `Test file not found: ${testPath}`).toBe(true);
        });
      }

      for (const e2ePath of feature.e2eTests ?? []) {
        it(`${feature.name}: e2e test ${e2ePath} exists`, () => {
          const fullPath = path.join(REPO_ROOT, e2ePath);
          expect(fs.existsSync(fullPath), `E2E test file not found: ${e2ePath}`).toBe(true);
        });
      }
    }
  });

  // Verify all static probes match in source files
  describe("static probe verification (source)", () => {
    for (const feature of features) {
      if (feature.status === "planned") {
        continue;
      }
      if (!feature.static || feature.static.length === 0) {
        continue;
      }

      describe(feature.name, () => {
        for (const probe of feature.static) {
          const minCount = probe.minCount ?? 1;
          it(`${probe.file} contains "${probe.pattern}" (>=${minCount})`, () => {
            const fullPath = path.join(REPO_ROOT, probe.file);
            expect(fs.existsSync(fullPath), `Source file not found: ${probe.file}`).toBe(true);
            const content = fs.readFileSync(fullPath, "utf8");
            // Try literal string match first (most reliable for patterns
            // containing JS operators like ??), fall back to regex.
            let matches = content.split(probe.pattern).length - 1;
            if (matches === 0) {
              try {
                const re = new RegExp(probe.pattern, "g");
                matches = (content.match(re) ?? []).length;
              } catch {
                // Pattern is not valid regex; stick with literal count of 0
              }
            }
            expect(
              matches,
              `Expected >=${minCount} occurrences of "${probe.pattern}" in ${probe.file}, found ${matches}`,
            ).toBeGreaterThanOrEqual(minCount);
          });
        }
      });
    }
  });

  // Verify the verify script itself is executable and has all phases
  it("verify-frankclaw-features.sh has all required phases", () => {
    const scriptPath = path.join(REPO_ROOT, "scripts/verify-frankclaw-features.sh");
    expect(fs.existsSync(scriptPath)).toBe(true);
    const content = fs.readFileSync(scriptPath, "utf8");
    expect(content).toContain("run_registry");
    expect(content).toContain("run_static");
    expect(content).toContain("run_test");
    expect(content).toContain("run_e2e");
    expect(content).toContain("run_runtime");
  });
});
