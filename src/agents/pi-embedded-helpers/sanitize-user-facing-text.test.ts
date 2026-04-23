import { describe, expect, it } from "vitest";
import { sanitizeUserFacingText } from "./sanitize-user-facing-text.js";

// ---------------------------------------------------------------------------
// Paragraph preservation & spacing normalization
// ---------------------------------------------------------------------------

describe("sanitizeUserFacingText – paragraph spacing", () => {
  it("preserves \\n\\n paragraph breaks between distinct paragraphs", () => {
    const input = "First paragraph here.\n\nSecond paragraph here.";
    const result = sanitizeUserFacingText(input);
    expect(result).toBe("First paragraph here.\n\nSecond paragraph here.");
  });

  it("preserves multiple distinct paragraphs separated by blank lines", () => {
    const input = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
    const result = sanitizeUserFacingText(input);
    expect(result).toBe("Paragraph one.\n\nParagraph two.\n\nParagraph three.");
  });

  it("normalizes excessive blank lines (3+ newlines) to exactly \\n\\n", () => {
    const input = "Paragraph one.\n\n\n\nParagraph two.";
    const result = sanitizeUserFacingText(input);
    expect(result).toBe("Paragraph one.\n\nParagraph two.");
  });

  it("normalizes 5+ newlines to \\n\\n", () => {
    const input = "A.\n\n\n\n\nB.";
    const result = sanitizeUserFacingText(input);
    expect(result).toBe("A.\n\nB.");
  });

  it("preserves single \\n line breaks within a paragraph", () => {
    const input = "Line one.\nLine two.\nLine three.";
    const result = sanitizeUserFacingText(input);
    expect(result).toBe("Line one.\nLine two.\nLine three.");
  });

  it("preserves single-paragraph text without any newlines", () => {
    const input = "Just a single block of text with no breaks.";
    const result = sanitizeUserFacingText(input);
    expect(result).toBe("Just a single block of text with no breaks.");
  });

  it("preserves code blocks containing multiple newlines", () => {
    const input = "Before code.\n\n```\nfunction foo() {\n  return 1;\n}\n```\n\nAfter code.";
    const result = sanitizeUserFacingText(input);
    expect(result).toBe(
      "Before code.\n\n```\nfunction foo() {\n  return 1;\n}\n```\n\nAfter code.",
    );
  });

  it("preserves bullet list items separated by single newlines", () => {
    const input = "Items:\n- Item one\n- Item two\n- Item three";
    const result = sanitizeUserFacingText(input);
    expect(result).toBe("Items:\n- Item one\n- Item two\n- Item three");
  });

  it("handles OCR-style text with paragraphs and hard wraps", () => {
    // This simulates OCR output where paragraphs are separated by blank lines
    // and lines within paragraphs have hard wraps
    const input =
      "The quick brown fox jumps\nover the lazy dog.\n\nThe second paragraph\nhas more text here.";
    const result = sanitizeUserFacingText(input);
    expect(result).toBe(
      "The quick brown fox jumps\nover the lazy dog.\n\nThe second paragraph\nhas more text here.",
    );
  });

  it("strips leading empty lines but preserves internal paragraph breaks", () => {
    const input = "\n\n\nFirst paragraph.\n\nSecond paragraph.";
    const result = sanitizeUserFacingText(input);
    expect(result).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("collapses duplicate consecutive blocks while preserving paragraph spacing", () => {
    const input = "Same text.\n\nSame text.\n\nDifferent text.";
    const result = sanitizeUserFacingText(input);
    expect(result).toBe("Same text.\n\nDifferent text.");
  });

  it("does not collapse non-duplicate blocks", () => {
    const input = "Block A.\n\nBlock B.\n\nBlock C.";
    const result = sanitizeUserFacingText(input);
    expect(result).toBe("Block A.\n\nBlock B.\n\nBlock C.");
  });

  it("preserves internal paragraph structure with surrounding whitespace", () => {
    // sanitizeUserFacingText preserves internal structure; outer whitespace
    // is stripped only when collapseConsecutiveDuplicateBlocks deduplicates.
    const input = "  First paragraph.  \n\n  Second paragraph.  ";
    const result = sanitizeUserFacingText(input);
    // Verify paragraph break is preserved (exact whitespace around blocks
    // depends on upstream processing, so just check the break).
    expect(result).toContain("\n\n");
    expect(result).toContain("First paragraph.");
    expect(result).toContain("Second paragraph.");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(sanitizeUserFacingText("   \n\n   ")).toBe("");
  });
});
