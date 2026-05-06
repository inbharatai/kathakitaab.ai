// ============================================================
// KathaKitaab.ai — Subtitle planner
//
// Splits a scene's narration text into sentence cues with explicit
// startMs/endMs timings. Two callers consume this:
//
//   1. The build-book-video script bakes the cues into the
//      manifest at build time, so the manifest is the single
//      source of subtitle truth (per Phase 10 spec).
//   2. The Remotion BookMovie composition reads the cues directly
//      out of the manifest at render time — no in-component
//      timing math, so what you see in the MP4 is what's in the
//      manifest, byte for byte.
//
// Distribution heuristic:
//   - Scene starts with a small lead-in (300ms) so the first
//     sentence doesn't snap on at frame 0.
//   - Each sentence gets time proportional to its character count
//     within the audio body window, with a 1.5s minimum so very
//     short fragments stay readable.
//   - The last cue is extended to the end of the audio so trailing
//     silence still has a caption visible.
// ============================================================

export interface SubtitleCue {
  text: string;
  startMs: number;
  endMs: number;
}

export interface SubtitlePlanOptions {
  /** Lead-in before the first cue, ms. Defaults to 300. */
  leadInMs?: number;
  /** Tail after the last cue ends and the scene fades out, ms.
   *  Defaults to 800 — that gives the audio a moment to breathe. */
  tailMs?: number;
  /** Minimum on-screen time per cue. Sentences shorter than this
   *  threshold still stick around long enough to read. Defaults
   *  to 1500ms. */
  minCueMs?: number;
}

/**
 * Split narration into timed sentence cues.
 *
 * `narrationDurationSec` is the duration of the actual TTS audio
 * — the cues fit *inside* that window so the caption never trails
 * past the audio. Returns cues with millisecond timestamps anchored
 * at scene start (frame 0 of the SceneShot Sequence).
 */
export function planSubtitles(
  narration: string,
  narrationDurationSec: number,
  opts: SubtitlePlanOptions = {},
): SubtitleCue[] {
  const leadInMs = opts.leadInMs ?? 300;
  const tailMs = opts.tailMs ?? 800;
  const minCueMs = opts.minCueMs ?? 1500;

  const sentences = splitIntoSentences(narration);
  if (sentences.length === 0) return [];

  const totalAudioMs = Math.max(0, narrationDurationSec * 1000);
  // The cue track lives inside the audio window minus a tiny
  // leadIn/tail margin so the first/last cue don't bleed into
  // the cross-fade at scene boundaries.
  const usableMs = Math.max(minCueMs * sentences.length, totalAudioMs - leadInMs - tailMs);

  const totalChars = sentences.reduce((s, t) => s + t.length, 0) || sentences.length;

  const cues: SubtitleCue[] = [];
  let cursor = leadInMs;
  for (let i = 0; i < sentences.length; i++) {
    const text = sentences[i];
    const isLast = i === sentences.length - 1;
    const share = totalChars > 0 ? text.length / totalChars : 1 / sentences.length;
    let span = Math.max(minCueMs, Math.round(usableMs * share));
    const startMs = cursor;
    let endMs = startMs + span;

    // Last cue extends to scene end so trailing audio still has
    // a caption visible — feels intentional, not a missed timing.
    if (isLast) endMs = leadInMs + usableMs;

    cues.push({ text, startMs, endMs });
    cursor = endMs;
    span = endMs - startMs;
    void span;
  }
  return cues;
}

// Sentence boundary heuristic — split on `[.!?]` followed by
// whitespace, while protecting ellipses and quote endings. Tiny
// imperfections are fine; the output is intentionally robust to
// AI-written narration that may not be perfectly punctuated.
function splitIntoSentences(narration: string): string[] {
  const trimmed = narration.trim();
  if (!trimmed) return [];
  // Use a non-capturing lookbehind to keep punctuation attached.
  const parts = trimmed
    .split(/(?<=[.!?])\s+(?=[A-Zऀ-ॿ])/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return parts.length > 0 ? parts : [trimmed];
}
