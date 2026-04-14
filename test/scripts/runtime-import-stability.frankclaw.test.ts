/**
 * frankclaw addition: verify that every `importRuntimeModule` call-site in src/
 * references a runtime module that is either:
 * (a) listed as an explicit entry in buildCoreDistEntries() (stable filename), or
 * (b) will produce a hashed dist file matching the postbuild alias regex.
 *
 * This prevents MODULE_NOT_FOUND regressions when dist/ is rebuilt while the
 * gateway is running (content-hash changes break lazy imports).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(ROOT, "src");

/**
 * Extract the base module name from a RUNTIME_SPEC constant.
 * E.g. ["./subagent-registry.runtime", ".js"] -> "subagent-registry.runtime"
 */
function extractSpecBaseName(specValue: string): string | null {
  // Match the first string in the array: ["./foo.runtime", ".js"]
  const match = specValue.match(/\["([^"]+)"/);
  if (!match) {
    return null;
  }
  const relPath = match[1];
  // Strip leading ./ or deeper relative paths, keep only the filename
  const basename = relPath.split("/").pop();
  return basename ?? null;
}

/**
 * Scan src/ for all _RUNTIME_SPEC constant definitions that feed importRuntimeModule.
 */
function findRuntimeSpecs(): Array<{
  file: string;
  specName: string;
  baseName: string;
  specValue: string;
}> {
  const specs: Array<{ file: string; specName: string; baseName: string; specValue: string }> = [];
  const specPattern = /const\s+(\w+_RUNTIME_SPEC)\s*=\s*(\[[\s\S]*?\])\s*(?:as\s+const)?;/g;

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.includes(".test.")) {
        const content = fs.readFileSync(full, "utf8");
        let match;
        while ((match = specPattern.exec(content)) !== null) {
          const baseName = extractSpecBaseName(match[2]);
          if (baseName) {
            specs.push({
              file: path.relative(ROOT, full),
              specName: match[1],
              baseName,
              specValue: match[2].replace(/\s+/g, " "),
            });
          }
        }
      }
    }
  }

  walk(SRC);
  return specs;
}

/**
 * Read tsdown.config.ts and extract all entry keys from buildCoreDistEntries().
 */
function getStableEntryKeys(): Set<string> {
  const configPath = path.join(ROOT, "tsdown.config.ts");
  const content = fs.readFileSync(configPath, "utf8");

  // Extract the block inside buildCoreDistEntries()
  const fnMatch = content.match(
    /function buildCoreDistEntries\(\)[^{]*\{[\s\S]*?return\s*\{([\s\S]*?)\};/,
  );
  if (!fnMatch) {
    return new Set();
  }

  const keys = new Set<string>();
  // Match quoted keys like "agents/auth-profiles.runtime" or "subagent-registry.runtime"
  const keyPattern = /"([^"]+)":/g;
  let m;
  while ((m = keyPattern.exec(fnMatch[1])) !== null) {
    keys.add(m[1]);
  }
  // Also match unquoted keys like extensionAPI
  const unquotedKeyPattern = /^\s*(\w+):/gm;
  while ((m = unquotedKeyPattern.exec(fnMatch[1])) !== null) {
    keys.add(m[1]);
  }

  return keys;
}

/**
 * Check if a base name would be caught by the postbuild alias regex.
 * The regex is: /^(?<base>.+\.(?:runtime|contract))-[A-Za-z0-9_-]+\.js$/
 * A file named `foo.runtime-HASH.js` matches; `foo-HASH.js` does not.
 */
function wouldPostbuildAliasCatch(baseName: string): boolean {
  return /\.(?:runtime|contract)$/.test(baseName);
}

describe("runtime import stability", () => {
  it("every importRuntimeModule spec has a stable dist entry or postbuild-aliasable name", () => {
    const specs = findRuntimeSpecs();
    const stableEntries = getStableEntryKeys();

    // Build set of basenames that have stable entries (strip directory prefix)
    const stableBaseNames = new Set<string>();
    for (const key of stableEntries) {
      const base = key.split("/").pop()!;
      stableBaseNames.add(base);
    }

    const missing: string[] = [];
    for (const spec of specs) {
      const hasStableEntry = stableBaseNames.has(spec.baseName);
      const willGetAlias = wouldPostbuildAliasCatch(spec.baseName);

      if (!hasStableEntry && !willGetAlias) {
        missing.push(
          `${spec.file}: ${spec.specName} references "${spec.baseName}" ` +
            `which has no stable tsdown entry and won't get a postbuild alias`,
        );
      }
    }

    expect(missing, "Runtime modules without stable dist filenames").toEqual([]);
  });

  it("subagent-registry.runtime is listed as a stable entry", () => {
    const entries = getStableEntryKeys();
    // The entry can be at root or under agents/
    const hasEntry =
      entries.has("subagent-registry.runtime") || entries.has("agents/subagent-registry.runtime");
    expect(hasEntry, "subagent-registry.runtime must be in buildCoreDistEntries()").toBe(true);
  });
});
