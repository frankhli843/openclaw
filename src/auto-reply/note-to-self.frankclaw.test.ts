import { describe, expect, it } from "vitest";
import {
  isNoteToSelf,
  isStatusOnlyBackgroundNoteToSelf,
  noteToSelfPrefix,
  noteToSelfPromptOverlay,
  wrapAsNoteToSelf,
} from "./note-to-self.frankclaw.js";

describe("isNoteToSelf", () => {
  it("matches the canonical prefix", () => {
    expect(isNoteToSelf("[Doramon note to self] Background task done: foo.")).toBe(true);
  });

  it("matches the canonical prefix case-insensitively", () => {
    expect(isNoteToSelf("[doramon note to self] anything")).toBe(true);
    expect(isNoteToSelf("[DORAMON NOTE TO SELF] anything")).toBe(true);
  });

  it("matches the legacy deadletter prefix (back-compat)", () => {
    expect(isNoteToSelf("[doramon you forgot to answer!]: your message")).toBe(true);
  });

  it("tolerates leading whitespace", () => {
    expect(isNoteToSelf("   [Doramon note to self] delayed")).toBe(true);
    expect(isNoteToSelf("\n\t[Doramon note to self] mixed")).toBe(true);
  });

  it("rejects plain user messages", () => {
    expect(isNoteToSelf("hey, can you look at this?")).toBe(false);
    expect(isNoteToSelf("Background task done: foo")).toBe(false);
    expect(isNoteToSelf("[Doramon note]: not the prefix")).toBe(false);
  });

  it("returns false for empty / null / undefined", () => {
    expect(isNoteToSelf("")).toBe(false);
    expect(isNoteToSelf(null)).toBe(false);
    expect(isNoteToSelf(undefined)).toBe(false);
  });
});

describe("noteToSelfPrefix", () => {
  it("exposes the canonical prefix", () => {
    expect(noteToSelfPrefix()).toBe("[Doramon note to self]");
  });
});

describe("wrapAsNoteToSelf", () => {
  it("prefixes an unmarked body", () => {
    expect(wrapAsNoteToSelf("Background task done: foo.")).toBe(
      "[Doramon note to self] Background task done: foo.",
    );
  });

  it("trims leading whitespace from the body before wrapping", () => {
    expect(wrapAsNoteToSelf("   spaced")).toBe("[Doramon note to self] spaced");
  });

  it("is idempotent: re-wrapping an already-prefixed body returns it unchanged", () => {
    const already = "[Doramon note to self] already";
    expect(wrapAsNoteToSelf(already)).toBe(already);
  });

  it("is idempotent for the legacy prefix too (we don't double-wrap)", () => {
    const legacy = "[doramon you forgot to answer!]: legacy body";
    expect(wrapAsNoteToSelf(legacy)).toBe(legacy);
  });
});

describe("isStatusOnlyBackgroundNoteToSelf", () => {
  it("matches background failure notices that must not do channel inline work", () => {
    expect(
      isStatusOnlyBackgroundNoteToSelf(
        "[Doramon note to self] Background task failed: homezai-fix. Error: timeout",
      ),
    ).toBe(true);
    expect(
      isStatusOnlyBackgroundNoteToSelf(
        "[Doramon note to self] Background task timed out: benchmark-run.",
      ),
    ).toBe(true);
    expect(
      isStatusOnlyBackgroundNoteToSelf("[Doramon note to self] Background task lost: worker."),
    ).toBe(true);
    expect(
      isStatusOnlyBackgroundNoteToSelf(
        "[Doramon note to self] Background task cancelled: stale run.",
      ),
    ).toBe(true);
  });

  it("does not mark successful background status or plain user text as status-only", () => {
    expect(
      isStatusOnlyBackgroundNoteToSelf("[Doramon note to self] Background task done: foo."),
    ).toBe(false);
    expect(isStatusOnlyBackgroundNoteToSelf("Background task failed: foo.")).toBe(false);
  });
});

describe("noteToSelfPromptOverlay", () => {
  it("emits the note_to_self_protocol tag with required behavior cues", () => {
    const overlay = noteToSelfPromptOverlay();
    expect(overlay).toContain("<note_to_self_protocol>");
    expect(overlay).toContain("</note_to_self_protocol>");
    expect(overlay.toLowerCase()).toContain("summary");
    expect(overlay.toLowerCase()).toContain("owning task");
    expect(overlay.toLowerCase()).toContain("never reply with no_reply");
  });

  it("makes background failures status-only so channel sessions cannot wedge", () => {
    const overlay = noteToSelfPromptOverlay(
      "[Doramon note to self] Background task failed: homezai-genie. Error: billing",
    );
    const lower = overlay.toLowerCase();

    expect(overlay).toContain("<note_to_self_protocol>");
    expect(lower).toContain("status-only");
    expect(lower).toContain("do not call tools");
    expect(lower).toContain("do not");
    expect(lower).toContain("spawn workers");
    expect(lower).toContain("stay responsive");
    expect(lower).not.toContain("continue iterating");
  });
});
