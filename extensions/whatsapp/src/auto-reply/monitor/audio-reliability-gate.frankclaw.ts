// frankclaw: Audio transcript reliability gate.
// Screens WhatsApp audio transcripts for IVR/phone-tree content before they are
// injected as the agent-facing message body. When a transcript looks like an
// automated recording or obvious misrecognition, it is wrapped with a quarantine
// prefix so downstream health-channel injections do not write it as health facts.
//
// This module has no upstream equivalent; it is a pure frankclaw addition.
// Imported with one line in process-message.ts (marked // frankclaw:).

import { logVerbose, shouldLogVerbose } from "../../../../../src/globals.js";

export const UNRELIABLE_TRANSCRIPT_PREFIX = "[AUDIO TRANSCRIPT — RELIABILITY UNCERTAIN:";
const UNRELIABLE_TRANSCRIPT_SUFFIX = "]";

/**
 * Patterns that strongly suggest an automated phone recording rather than a
 * genuine voice note. Matched case-insensitively against the transcript.
 *
 * Keep this list generic — do not hardcode pharmacy names or person-specific
 * references. These are structural/lexical signals of IVR/phone-tree content.
 */
const IVR_PATTERNS: RegExp[] = [
  // Numbered menu options
  /press\s+[0-9#*]/i,
  /for\s+\w[\w\s]{0,20},\s*press\s+[0-9]/i,
  // Refill / prescription automation
  /\brefill\b.{0,60}\bprescription\b/i,
  /\bprescription\b.{0,60}\brefill\b/i,
  /\bprescription\s+is\s+ready\b/i,
  /\bpick\s+up\s+your\s+prescription\b/i,
  /\bprescription\s+number\b/i,
  /\bRx\s*#?\s*\d{4,}/i,
  // Generic IVR markers
  /\bthis\s+is\s+an?\s+automated\b/i,
  /\bautomated\s+(message|call|reminder|notification)\b/i,
  /\bplease\s+(hold|wait)\s+(for|while)\b/i,
  /\bif\s+you\s+(are|would\s+like\s+to)\b.{0,60}\bpress\b/i,
  /\bto\s+(speak|talk)\s+to\s+a\s+(representative|pharmacist|agent)\b/i,
  /\bmenu\s+options?\b/i,
  /\byour\s+(order|refill|request)\s+(is|has been)\s+(ready|processed|filled)\b/i,
];

/**
 * Returns true when the transcript matches at least one IVR/phone-tree pattern.
 */
export function looksLikeIvrRecording(transcript: string): boolean {
  return IVR_PATTERNS.some((re) => re.test(transcript));
}

/**
 * Returns true when STT produced no usable text (empty, whitespace-only, or a
 * lone punctuation token such as "." that whisper emits for silence/noise).
 * An empty transcript over real audio energy means the speech was not resolved,
 * never that nothing was said — so it must be treated as unreliable, not as a
 * blank message the agent silently ignores.
 */
export function isEmptyOrUnusableTranscript(transcript: string): boolean {
  const stripped = transcript.replace(/[\s.,!?…·•\-–—]/gu, "");
  return stripped.length === 0;
}

/**
 * Classifies why a transcript is being quarantined, or null when it looks
 * credible. Exposed for tests and observability.
 */
export function transcriptUnreliableReason(transcript: string): "empty" | "ivr" | null {
  if (isEmptyOrUnusableTranscript(transcript)) {
    return "empty";
  }
  if (looksLikeIvrRecording(transcript)) {
    return "ivr";
  }
  return null;
}

/**
 * Wraps a transcript with a quarantine prefix when it is empty/unusable or
 * appears to be an IVR recording. Returns the original transcript unchanged
 * when it looks credible.
 *
 * The prefix is recognised by the whatsapp-health-workflow shared prompt so the
 * agent quarantines the content instead of writing it to knowledge files.
 */
export function applyTranscriptReliabilityGate(transcript: string): string {
  const reason = transcriptUnreliableReason(transcript);
  if (reason === null) {
    return transcript;
  }
  if (shouldLogVerbose()) {
    logVerbose(
      `audio-reliability-gate: transcript flagged as unreliable (reason=${reason}, ${transcript.length} chars)`,
    );
  }
  const detail =
    reason === "empty"
      ? "audio received but speech could not be transcribed (empty/unusable result)"
      : "possible automated recording or misrecognition";
  return (
    `${UNRELIABLE_TRANSCRIPT_PREFIX} ${detail}. ` +
    `Do not treat as health facts. Original text follows for reference only.${UNRELIABLE_TRANSCRIPT_SUFFIX}\n${transcript}`
  );
}
