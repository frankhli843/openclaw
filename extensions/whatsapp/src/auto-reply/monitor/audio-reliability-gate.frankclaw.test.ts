// frankclaw: Tests for the WhatsApp audio transcript reliability gate.
// Verifies that IVR/phone-tree transcripts are quarantined and genuine voice
// notes pass through unmodified.
import { describe, expect, it } from "vitest";
import {
  applyTranscriptReliabilityGate,
  isEmptyOrUnusableTranscript,
  looksLikeIvrRecording,
  transcriptUnreliableReason,
  UNRELIABLE_TRANSCRIPT_PREFIX,
} from "./audio-reliability-gate.frankclaw.js";

describe("looksLikeIvrRecording", () => {
  describe("IVR patterns — should return true", () => {
    it("detects 'press 1' menu option", () => {
      expect(looksLikeIvrRecording("For refills press 1, for pharmacy hours press 2")).toBe(true);
    });

    it("detects 'press #' pattern", () => {
      expect(looksLikeIvrRecording("To confirm your order press #")).toBe(true);
    });

    it("detects prescription ready announcement", () => {
      expect(looksLikeIvrRecording("Your prescription is ready for pickup at our pharmacy")).toBe(
        true,
      );
    });

    it("detects refill + prescription collocation", () => {
      expect(
        looksLikeIvrRecording("You have a prescription refill available. Please call us."),
      ).toBe(true);
    });

    it("detects prescription + refill in reverse order", () => {
      expect(looksLikeIvrRecording("This is a reminder to refill your prescription soon")).toBe(
        true,
      );
    });

    it("detects 'pick up your prescription'", () => {
      expect(looksLikeIvrRecording("Please come pick up your prescription today")).toBe(true);
    });

    it("detects automated message marker", () => {
      expect(looksLikeIvrRecording("This is an automated message from your pharmacy")).toBe(true);
    });

    it("detects 'automated call'", () => {
      expect(looksLikeIvrRecording("This is an automated call. Please press 1 to confirm.")).toBe(
        true,
      );
    });

    it("detects 'please hold for'", () => {
      expect(looksLikeIvrRecording("Please hold for the next available representative")).toBe(true);
    });

    it("detects 'to speak to a representative'", () => {
      expect(looksLikeIvrRecording("To speak to a representative, please press zero now")).toBe(
        true,
      );
    });

    it("detects 'to talk to a pharmacist'", () => {
      expect(looksLikeIvrRecording("To talk to a pharmacist press 0")).toBe(true);
    });

    it("detects 'your order is ready'", () => {
      expect(looksLikeIvrRecording("Your order is ready. You can pick it up any time.")).toBe(true);
    });

    it("detects 'your refill has been processed'", () => {
      expect(looksLikeIvrRecording("Your refill has been processed. Thank you.")).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(looksLikeIvrRecording("PRESS 1 TO REFILL YOUR PRESCRIPTION")).toBe(true);
    });
  });

  describe("genuine voice notes — should return false", () => {
    it("allows normal appointment note (English)", () => {
      expect(
        looksLikeIvrRecording(
          "William has an eye doctor appointment next Thursday at 2 PM for his annual checkup",
        ),
      ).toBe(false);
    });

    it("allows health update note (mixed language Cantonese/English)", () => {
      expect(
        looksLikeIvrRecording(
          "威廉今日有啲咳，我已經俾咗佢食藥 William coughed today I gave him some medicine",
        ),
      ).toBe(false);
    });

    it("allows symptom description", () => {
      expect(looksLikeIvrRecording("He had a fever of 38.5 last night and is better now")).toBe(
        false,
      );
    });

    it("allows dose logging", () => {
      expect(looksLikeIvrRecording("Gave Advil 5ml at 10pm, will check again at 2am")).toBe(false);
    });

    it("allows appointment booking confirmation", () => {
      expect(
        looksLikeIvrRecording("Doctor Li confirmed the appointment is on June 30th at 3 PM"),
      ).toBe(false);
    });

    it("allows casual family message", () => {
      expect(
        looksLikeIvrRecording("Hey just wanted to update you, Sophie is doing great today"),
      ).toBe(false);
    });

    it("does not false-positive on 'medicine is ready' without IVR markers", () => {
      expect(looksLikeIvrRecording("Charlotte said the medicine is ready on the counter")).toBe(
        false,
      );
    });
  });
});

describe("applyTranscriptReliabilityGate", () => {
  it("passes credible transcripts through unchanged", () => {
    const transcript = "William has a dentist appointment on July 31st at 3 PM";
    expect(applyTranscriptReliabilityGate(transcript)).toBe(transcript);
  });

  it("wraps IVR transcripts with quarantine prefix", () => {
    const transcript = "Your prescription is ready for pickup. Press 1 to confirm.";
    const result = applyTranscriptReliabilityGate(transcript);
    expect(result.startsWith(UNRELIABLE_TRANSCRIPT_PREFIX)).toBe(true);
    expect(result).toContain(transcript);
  });

  it("quarantined transcript still contains original text for reference", () => {
    const transcript = "This is an automated message. To refill your prescription press 1.";
    const result = applyTranscriptReliabilityGate(transcript);
    expect(result).toContain(transcript);
  });

  it("quarantine prefix format matches what whatsapp-health-workflow prompt expects", () => {
    const transcript = "Press 2 for pharmacy hours.";
    const result = applyTranscriptReliabilityGate(transcript);
    // The health workflow prompt checks for this exact prefix string
    expect(result.startsWith("[AUDIO TRANSCRIPT — RELIABILITY UNCERTAIN:")).toBe(true);
  });

  it("allows a plausible mixed Cantonese/English eye-appointment note through", () => {
    // The real Jun-21 incident clip: an eye doctor appointment note. Once STT
    // resolves it credibly it must pass through as a normal note, not be blocked.
    const transcript = "William 今日睇眼科 doctor said his eyes are fine, follow up in six months";
    expect(applyTranscriptReliabilityGate(transcript)).toBe(transcript);
  });
});

describe("empty / unusable transcripts", () => {
  it("flags an empty-string transcript as unreliable (reason=empty)", () => {
    expect(isEmptyOrUnusableTranscript("")).toBe(true);
    expect(transcriptUnreliableReason("")).toBe("empty");
  });

  it("flags a whitespace-only transcript as unreliable", () => {
    expect(isEmptyOrUnusableTranscript("   \n\t  ")).toBe(true);
    expect(transcriptUnreliableReason("   \n\t  ")).toBe("empty");
  });

  it("flags a lone-punctuation transcript (whisper silence artifact) as unreliable", () => {
    expect(isEmptyOrUnusableTranscript(". . .")).toBe(true);
    expect(transcriptUnreliableReason("...")).toBe("empty");
  });

  it("wraps empty STT output with quarantine prefix instead of injecting a blank body", () => {
    const result = applyTranscriptReliabilityGate("");
    expect(result.startsWith(UNRELIABLE_TRANSCRIPT_PREFIX)).toBe(true);
    expect(result.toLowerCase()).toContain("could not be transcribed");
  });

  it("does not treat a short genuine note as empty", () => {
    expect(isEmptyOrUnusableTranscript("yes")).toBe(false);
    expect(transcriptUnreliableReason("ok thanks")).toBe(null);
  });
});
