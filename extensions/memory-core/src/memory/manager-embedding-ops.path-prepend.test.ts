import { describe, expect, it } from "vitest";

/**
 * Tests the frankclaw-specific path-prepend behavior for memory search chunks.
 *
 * In manager-embedding-ops.ts, indexFile() prepends `[<file-path>]` to each
 * chunk's text before indexing, improving FTS recall. This test validates
 * the transformation logic in isolation.
 */

function prependFilePath(chunkText: string, filePath: string): string {
  return `[${filePath}]\n${chunkText}`;
}

describe("memory search path prepend (frankclaw)", () => {
  it("prepends file path in bracket notation to chunk text", () => {
    const result = prependFilePath("some content here", "docs/README.md");
    expect(result).toBe("[docs/README.md]\nsome content here");
  });

  it("handles nested paths correctly", () => {
    const result = prependFilePath("hello world", "workspace/knowledge/people/frank.md");
    expect(result).toBe("[workspace/knowledge/people/frank.md]\nhello world");
  });

  it("preserves original chunk text after the path prefix", () => {
    const original = "# Title\n\nSome content with **bold** text.";
    const result = prependFilePath(original, "notes.md");
    expect(result.startsWith("[notes.md]\n")).toBe(true);
    expect(result).toContain(original);
  });

  it("makes path searchable when searching for file name", () => {
    const result = prependFilePath("unrelated content", "config/agents.yaml");
    expect(result.includes("agents.yaml")).toBe(true);
  });

  it("applies to multiple chunks independently", () => {
    const chunks = [
      { text: "chunk 1", startLine: 0, endLine: 5 },
      { text: "chunk 2", startLine: 6, endLine: 10 },
    ];
    const filePath = "test/file.md";

    for (const chunk of chunks) {
      chunk.text = prependFilePath(chunk.text, filePath);
    }

    expect(chunks[0].text).toBe("[test/file.md]\nchunk 1");
    expect(chunks[1].text).toBe("[test/file.md]\nchunk 2");
    // Metadata preserved
    expect(chunks[0].startLine).toBe(0);
    expect(chunks[1].startLine).toBe(6);
  });
});
