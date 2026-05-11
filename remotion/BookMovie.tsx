// ============================================================
// remotion/BookMovie.tsx
//
// Universal book-to-video composition. Any book whose canon has
// been processed by `scripts/build-book-video.ts` produces a
// matching `manifests/{slug}.json` and feeds this composition.
//
// Per scene: Ken-Burns pan + Sarvam narration + chapter chip +
// flowing caption + cross-fade. Plus a title card and end card.
//
// Length is data-driven — `computeBookMovieFrames(manifest)` is
// the single source of truth so callers (Player on the landing
// page, the per-book movie page, future studio renderer) can size
// their player uniformly without re-doing the math.
// ============================================================

import React from 'react';
import {
  AbsoluteFill, Audio, Img, Sequence, interpolate, random, spring,
  staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';

import type { SceneMotion } from '../lib/video/motion';
import { motionForMood, motionParams } from '../lib/video/motion';
import type { SubtitleCue } from '../lib/video/subtitlePlanner';
import type { SceneEffect } from '../lib/video/effects/types';
import { EffectStack, shakeOffset } from '../lib/video/effects/layers';

/** Position + type for a per-character ambient overlay in the
 *  movie composition. Mirrors the live reader's hotspot model; only
 *  the fields the BookMovie render actually needs are included. */
export interface BookMovieHotspot {
  /** Display label — used to seed phase offsets so neighbouring
   *  characters don't all breathe in lockstep. */
  label: string;
  /** 'character' hotspots get a breathing glow ring; objects get a
   *  fainter pulse. Other types render nothing. */
  type: 'character' | 'object' | 'place';
  /** Bounding box in scene-relative percent coords, same as the live
   *  reader's hotspots. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BookMovieScene {
  sceneId: string;
  title: string;
  /** Source narration text. Subtitles[] is the rendered, timed
   *  caption track — keep both so the audio can re-derive cues
   *  if the manifest lacks them. */
  narration: string;
  /** Pre-baked sentence cues with explicit start/end ms. The
   *  composition reads these directly instead of computing in
   *  React, so the manifest is the single source of truth. */
  subtitles?: SubtitleCue[];
  /** Either an absolute http(s) URL (Supabase Storage) or `/`-prefixed local path. */
  imagePath: string;
  /** Optional multi-beat visual track. When present, the cinematic
   *  cut cross-fades through these images across the scene's
   *  durationSeconds; backwards-compatible with single-image scenes
   *  (older manifests omit this and keep playing imagePath). */
  beats?: { imagePath: string }[];
  /** Either an absolute http(s) URL (Supabase Storage) or `/`-prefixed local path. */
  audioPath: string;
  /** Per Phase 10 spec — alias of audioPath but explicit. Either is fine. */
  narrationAudioUrl?: string;
  durationSeconds: number;
  /** Mood tag (serene|dramatic|somber|joyful|sacred|mysterious).
   *  Drives the default motion + the procedural ambient bed when
   *  no explicit `backgroundMusicUrl` is supplied. */
  mood?: string;
  /** Per-scene camera motion. Falls back to a mood-derived default
   *  if absent. See `lib/video/motion.ts` for the vocabulary. */
  motion?: SceneMotion;
  /** Explicit ambient bed URL. When set, used instead of the mood
   *  default. Either http(s) or `/`-prefixed local path — same
   *  resolveAsset rules as imagePath. */
  backgroundMusicUrl?: string;
  /** Universal effects DSL — particles, glow, flash, tint, vignette,
   *  rim_light, dust_shaft, shake, ripple, parallax, desaturation,
   *  bloom. Same vocabulary the live reader uses. Derived from the
   *  scene's narration topics + mood at build time, baked here so
   *  the renderer is purely manifest-driven. */
  effects?: SceneEffect[];
  /** Hotspot positions used by the ambient-figure layer to draw a
   *  pulsing glow ring on each character region. The figures are
   *  baked into the bg image; this layer adds the "alive" signal
   *  (breath-rate scale + glow pulse) over them. */
  hotspots?: BookMovieHotspot[];
}

export interface BookMovieManifest {
  bookSlug: string;
  bookTitle: string;
  scenes: BookMovieScene[];
  generatedAt: string;
}

export const BOOK_MOVIE_FPS = 30;
const SCENE_TAIL_SECONDS = 1.2;
const TITLE_FRAMES = 4 * BOOK_MOVIE_FPS;
const END_FRAMES = 4 * BOOK_MOVIE_FPS;
const SCENE_FADE_FRAMES = 12;

export function computeBookMovieFrames(manifest: BookMovieManifest): number {
  const scenes = manifest.scenes.reduce(
    (sum, s) => sum + Math.ceil((s.durationSeconds + SCENE_TAIL_SECONDS) * BOOK_MOVIE_FPS),
    0,
  );
  return TITLE_FRAMES + scenes + END_FRAMES;
}

// Manifest paths can be absolute URLs (Supabase CDN narration) or
// `/`-prefixed local paths (static images in /public). staticFile()
// expects bare relative names; absolute URLs pass through untouched.
const resolveAsset = (path: string): string =>
  /^https?:\/\//i.test(path)
    ? path
    : staticFile(path.startsWith('/') ? path.slice(1) : path);

// ── Cards ─────────────────────────────────────────────────────

const TitleCard: React.FC<{ bookTitle: string }> = ({ bookTitle }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 80, stiffness: 200 } });
  const fade = interpolate(frame, [durationInFrames - 18, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Slow rotating glow ring + drifting embers behind the title.
  // Cinematic-feeling without licensed assets — pure CSS + Img.
  const glowAngle = frame * 0.6;
  const embers = React.useMemo(() => Array.from({ length: 24 }, (_, i) => ({
    id: i,
    seedX: random(`tx-${i}`),
    seedY: random(`ty-${i}`),
    seedDelay: random(`td-${i}`),
    seedSize: random(`ts-${i}`),
  })), []);

  return (
    <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 35%, #5A0404 0%, #2A0606 45%, #0C0806 100%)', overflow: 'hidden', opacity: fade }}>
      {/* Rotating outer glow ring */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        width: 1200, height: 1200, marginLeft: -600, marginTop: -600,
        borderRadius: '50%',
        background: `conic-gradient(from ${glowAngle}deg, rgba(255,215,0,0) 0deg, rgba(255,215,0,0.18) 60deg, rgba(255,153,51,0.10) 180deg, rgba(255,215,0,0) 360deg)`,
        filter: 'blur(40px)',
        opacity: interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' }),
      }} />

      {/* Drifting embers */}
      {embers.map(e => {
        const tt = ((frame + e.seedDelay * 90) / 90) % 1;
        const x = (e.seedX * 1920) | 0;
        const y = 1080 + 120 - tt * 1300;
        const op = Math.sin(tt * Math.PI) * 0.6;
        const size = 2 + e.seedSize * 4;
        return (
          <div key={e.id} style={{
            position: 'absolute', left: x, top: y,
            width: size, height: size, borderRadius: '50%',
            background: '#FFD27A',
            boxShadow: '0 0 12px rgba(255,210,122,0.85)',
            opacity: op,
          }} />
        );
      })}

      <div style={{
        position: 'relative', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', height: '100%',
      }}>
        <div style={{ width: 160, height: 160, borderRadius: '50%', overflow: 'hidden', border: '4px solid #FFD700', boxShadow: '0 0 80px rgba(255,215,0,0.55), inset 0 0 40px rgba(255,215,0,0.25)', marginBottom: 44, transform: `scale(${s})` }}>
          <Img src={staticFile('logo.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.25) translateY(-5%)' }} />
        </div>
        <div style={{ fontSize: 96, fontWeight: 800, color: '#FFD700', textShadow: '0 6px 40px rgba(255,215,0,0.45), 0 2px 12px rgba(0,0,0,0.8)', transform: `scale(${s})`, fontFamily: 'serif', textAlign: 'center', padding: '0 80px', lineHeight: 1.05 }}>
          {bookTitle}
        </div>
        <div style={{ fontSize: 28, color: '#FFF0B3', marginTop: 24, letterSpacing: '0.36em', textTransform: 'uppercase', opacity: interpolate(frame, [30, 60], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }), fontWeight: 600 }}>
          A Living Story
        </div>
        <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)', marginTop: 32, opacity: interpolate(frame, [50, 80], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }), letterSpacing: 1 }}>
          Narrated end-to-end · Click highlighted scenes in the app
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── Sentence cue helpers ─────────────────────────────────────
// The manifest is the source of truth for subtitle timing — these
// helpers convert ms-anchored cues from the manifest into frame
// windows for the current Sequence, and provide a fallback that
// derives cues from raw narration text only when the manifest does
// not include them (e.g., older manifests built before v2).

interface FrameCue {
  text: string;
  fromFrame: number;
  toFrame: number;
}

function cuesFromManifest(subtitles: SubtitleCue[], audioStartFrame: number, fps: number): FrameCue[] {
  return subtitles.map(c => ({
    text: c.text,
    fromFrame: audioStartFrame + Math.round((c.startMs / 1000) * fps),
    toFrame:   audioStartFrame + Math.round((c.endMs   / 1000) * fps),
  }));
}

function fallbackCues(narration: string, totalFrames: number, audioStartFrame: number): FrameCue[] {
  const sentences = narration
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  if (sentences.length === 0) return [];
  const audioFrames = Math.max(1, totalFrames - audioStartFrame - SCENE_FADE_FRAMES);
  const totalChars = sentences.reduce((sum, s) => sum + s.length, 0);
  let cursor = audioStartFrame;
  return sentences.map((text, i) => {
    const isLast = i === sentences.length - 1;
    const share = totalChars > 0 ? text.length / totalChars : 1 / sentences.length;
    const span = Math.max(12, Math.round(audioFrames * share));
    const fromFrame = cursor;
    const toFrame = isLast ? totalFrames : cursor + span;
    cursor = toFrame;
    return { text, fromFrame, toFrame };
  });
}

// Music ducking volume function — accepts the absolute frame and
// returns the appropriate volume so the mood bed stays under TTS
// during narration and rises gently between cues.
//   base            : volume between cues / outside the audio window
//   ducked          : volume during a sentence
// Defaults give the music a clear "I am there" presence (0.28) that
// drops to 0.10 under speech, with a small fade between the two.
function makeMusicVolume(
  cues: FrameCue[],
  base: number,
  ducked: number,
  rampFrames: number,
): (frame: number) => number {
  return (frame: number) => {
    const inCue = cues.some(c => frame >= c.fromFrame && frame < c.toFrame);
    if (inCue) return ducked;
    // Look for a cue starting within rampFrames so we anticipate
    // the duck — the music drops just before TTS speaks.
    const upcoming = cues.find(c => frame < c.fromFrame && c.fromFrame - frame < rampFrames);
    if (upcoming) {
      const t = (rampFrames - (upcoming.fromFrame - frame)) / rampFrames;
      return base + (ducked - base) * t;
    }
    return base;
  };
}

const SceneShot: React.FC<{
  scene: BookMovieScene;
  index: number;
  total: number;
}> = ({ scene, index, total }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();

  const motion = scene.motion ?? motionForMood(scene.mood);
  const params = motionParams(motion);
  const effects = scene.effects ?? [];

  // Camera math driven by the motion table — same composition for
  // every scene, but each scene has its own camera personality.
  const t = frame / Math.max(1, durationInFrames);
  const scale = interpolate(t, [0, 1], [params.startScale, params.endScale]);
  const tx = interpolate(t, [0, 1], [0, params.panX]);
  const ty = interpolate(t, [0, 1], [0, params.panY]);

  // Shake comes from the effects DSL when an effect of type 'shake'
  // is present; otherwise fall back to the motion table's shake. The
  // DSL wins so a hand-authored manifest can override.
  const dslShake = shakeOffset(effects, frame);
  const motionShakeX = params.shake
    ? Math.sin(frame * 0.41) * params.shake + Math.sin(frame * 0.13) * params.shake * 0.6
    : 0;
  const motionShakeY = params.shake ? Math.cos(frame * 0.37) * params.shake * 0.7 : 0;
  const shakeX = effects.some(e => e.type === 'shake') ? dslShake.x : motionShakeX;
  const shakeY = effects.some(e => e.type === 'shake') ? dslShake.y : motionShakeY;

  const fadeIn = interpolate(frame, [0, SCENE_FADE_FRAMES], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - SCENE_FADE_FRAMES, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity = Math.min(fadeIn, fadeOut);

  const audioStart = 6;
  const headerAppear = interpolate(frame, [12, 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Cues come from the manifest when present, derived otherwise.
  // Wrapping in useMemo keeps the array reference stable across
  // frame ticks so we don't re-render dependents needlessly.
  const cues = React.useMemo<FrameCue[]>(() => {
    if (scene.subtitles && scene.subtitles.length > 0) {
      return cuesFromManifest(scene.subtitles, audioStart, fps);
    }
    return fallbackCues(scene.narration, durationInFrames, audioStart);
  }, [scene.subtitles, scene.narration, durationInFrames, fps]);

  const activeCueIndex = cues.findIndex(c => frame >= c.fromFrame && frame < c.toFrame);
  const activeCue = activeCueIndex >= 0 ? cues[activeCueIndex] : null;

  // Music ducking — base 0.28, ducked 0.10, ramps over 18 frames
  // (~600ms at 30fps). The mood bed source comes from the manifest
  // (`backgroundMusicUrl`) when present, else the procedural mood
  // WAV inferred from the mood tag.
  const musicVolume = React.useMemo(
    () => makeMusicVolume(cues, 0.28, 0.10, 18),
    [cues],
  );
  const musicSrc = scene.backgroundMusicUrl
    ? resolveAsset(scene.backgroundMusicUrl)
    : scene.mood
      ? staticFile(`audio/mood/${scene.mood}.wav`)
      : null;

  // Multi-beat track: when the manifest carries beats[], we paint
  // each one as its own <Img> and fade between them at evenly-
  // spaced intervals across the scene's frame range. The camera
  // transform applies to every beat identically so the cinematic
  // motion stays consistent. Single-beat scenes fall through to
  // the legacy single <Img> path.
  const beatImages = scene.beats && scene.beats.length >= 2
    ? scene.beats.map(b => b.imagePath)
    : [scene.imagePath];
  const beatLengthFrames = Math.max(1, Math.floor(durationInFrames / beatImages.length));
  const fadeFrames = Math.min(20, Math.floor(beatLengthFrames * 0.18));

  return (
    <AbsoluteFill style={{ backgroundColor: '#0C0806', opacity }}>
      {/* ── Background image(s) with motion-driven camera ── */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        {beatImages.map((src, i) => {
          // Cross-fade window for this beat. The first beat starts
          // visible; subsequent beats fade in over fadeFrames. After
          // their slot, beats fade out unless this is the last one
          // (final beat holds to the end of the scene).
          const startF = i * beatLengthFrames;
          const endF = i === beatImages.length - 1 ? durationInFrames : (i + 1) * beatLengthFrames;
          let beatOpacity = 1;
          if (beatImages.length > 1) {
            if (frame < startF - fadeFrames) {
              beatOpacity = 0;
            } else if (frame < startF) {
              beatOpacity = (frame - (startF - fadeFrames)) / fadeFrames;
            } else if (frame < endF) {
              beatOpacity = 1;
            } else {
              beatOpacity = 0;
            }
          }
          return (
            <Img
              key={i}
              src={resolveAsset(src)}
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%', objectFit: 'cover',
                transform: `scale(${scale}) translate(${tx + shakeX}px, ${ty + shakeY}px)`,
                filter: 'brightness(0.86) saturate(1.15)',
                opacity: beatOpacity,
              }}
            />
          );
        })}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(12,8,6,0.55) 0%, transparent 22%, transparent 50%, rgba(12,8,6,0.96) 100%)' }} />
      </div>

      {/* ── Universal effects stack ── particles, glow, flash, tint,
          vignette, rim_light, dust_shaft, bloom, desaturation. Order
          is determined by the recipe layer; render order in EffectStack
          matches the manifest array. */}
      {effects.length > 0 ? (
        <EffectStack effects={effects} frame={frame} fps={fps} seedPrefix={scene.sceneId} />
      ) : (
        // Legacy fallback: motion table's own tint + divine glow
        // overlay for older manifests without effects[].
        <>
          {params.tint && (
            <div style={{ position: 'absolute', inset: 0, background: params.tint, mixBlendMode: 'multiply' }} />
          )}
          {params.glow && <DivineGlowOverlay frame={frame} />}
        </>
      )}

      {/* ── Per-character ambient layer ── puppet states baked into
          the movie. Each character hotspot gets a pulsing glow over
          the lower body, plus a mouth that opens/closes whenever a
          subtitle cue is active. The bg figures are flat — this
          layer is what makes them read as alive during narration. */}
      {scene.hotspots && scene.hotspots.length > 0 && (
        <AmbientFiguresLayer
          hotspots={scene.hotspots}
          frame={frame}
          fps={fps}
          cueActive={!!activeCue}
        />
      )}

      {/* ── Top header chip + scene title ── */}
      <div style={{
        position: 'absolute', top: 44, left: 60, right: 60,
        display: 'flex', alignItems: 'center', gap: 16, opacity: headerAppear,
      }}>
        <div style={{
          padding: '7px 18px', borderRadius: 999,
          background: 'linear-gradient(135deg, #FF9933 0%, #FFD700 100%)',
          color: '#0C0806', fontSize: 16, fontWeight: 800, letterSpacing: 1.5,
          boxShadow: '0 4px 16px rgba(255,153,51,0.35)',
        }}>
          Scene {index + 1} / {total}
        </div>
        <div style={{
          fontSize: 42, fontWeight: 800, color: '#FFD700',
          textShadow: '0 3px 16px rgba(0,0,0,0.85), 0 0 24px rgba(255,215,0,0.25)',
          fontFamily: 'serif', letterSpacing: 0.5,
        }}>
          {scene.title}
        </div>
      </div>

      {/* ── Cinematic subtitle panel ── */}
      <SubtitlePanel
        cues={cues}
        activeCueIndex={activeCueIndex}
        activeCue={activeCue}
        appearAlpha={headerAppear}
      />

      {/* ── Narration audio (Sarvam Bulbul) ── */}
      <Sequence from={audioStart}>
        <Audio src={resolveAsset(scene.audioPath)} />
      </Sequence>

      {/* ── Mood bed with frame-accurate ducking ── */}
      {musicSrc && (
        <Audio
          src={musicSrc}
          volume={musicVolume}
          loop
        />
      )}
    </AbsoluteFill>
  );
};

// Per-character ambient layer for the movie composition. Mirrors
// the live reader's AmbientFigure: each character region breathes,
// glows, and sways gently. Phase-offset by label so neighbouring
// figures don't pulse in lockstep — same trick as the reader.
const AmbientFiguresLayer: React.FC<{
  hotspots: BookMovieHotspot[];
  frame: number;
  fps: number;
  /** True when a subtitle cue is on-screen → mouths open. False
   *  during inter-cue silence → mouths return to a closed/parted
   *  pose. Drives the chorus mouth motion universally for any
   *  book whose manifest has cues (the synthesizer always emits
   *  them via planSubtitles). */
  cueActive: boolean;
}> = ({ hotspots, frame, fps, cueActive }) => {
  const t = frame / fps; // seconds since scene start
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {hotspots.map((h, i) => {
        if (h.type !== 'character' && h.type !== 'object') return null;
        const isCharacter = h.type === 'character';
        // Stable per-figure phase from the label so the same scene
        // always animates the same way (deterministic for caching).
        const phase = (i * 1.07 + h.label.length * 0.31) % (2 * Math.PI);
        const breathHz = 0.42; // ~25 breaths/min — calm range
        const swayHz = 0.18;
        const breath = Math.sin(2 * Math.PI * breathHz * t + phase);
        const sway = Math.sin(2 * Math.PI * swayHz * t + phase * 0.5);

        // Visible breath / sway — the previous 1.2% scale was below
        // the perceptual threshold on a 1920×1080 still. 4% scale +
        // 1.2% translate matches the live reader's amplitude.
        const scale = 1 + breath * 0.04;
        const tx = sway * 1.2;
        // Glow ring opacity pulses at the breath rate. Characters get
        // a stronger ring than objects.
        const ringAlpha = (isCharacter ? 0.18 : 0.08) + breath * 0.06;
        const ringColor = isCharacter ? '255,215,140' : '255,200,140';

        // Mouth oscillation — when cueActive, the mouth opens / closes
        // at ~3.5 Hz (natural speech cadence). Phase-offset per figure
        // so they're never all open at the exact same instant. When
        // no cue is active (between sentences), the mouth slowly
        // closes to a parted resting pose.
        const speechHz = 3.6;
        const speechMix = (Math.sin(2 * Math.PI * speechHz * t + phase * 2.3) + 1) / 2; // 0..1
        const mouthOpen = isCharacter
          ? (cueActive ? 0.30 + speechMix * 0.70 : 0.22)
          : 0;
        // Derive mouth position + size based on bbox shape. There are
        // two distinct hotspot shapes in the wild:
        //   - head-only (squarish, h ≤ 1.8 × w): hand-authored boxes.
        //     Mouth lives mid-face at ~55% down the bbox.
        //   - full-body (tall, h > 1.8 × w): vision-agent-derived
        //     boxes covering the whole figure. The head sits in the
        //     top ~10-15% of the bbox; the mouth at ~8% from the top
        //     of the bbox puts it on the face. Mouth size also scales
        //     down because the head occupies a smaller fraction of
        //     image area.
        //
        // Previous attempt used Math.min(h.height, h.width * 1.4) as
        // a unified head-height — that put the mouth on the upper
        // chest for full-body bboxes (the "nipples" complaint).
        const isFullBody = h.height > h.width * 1.8;
        const mouthYFrac = isFullBody ? 0.08 : 0.55;
        const mouthW = isFullBody ? h.width * 0.10 : h.width * 0.20;
        const mouthH = isFullBody ? h.width * 0.06 : Math.min(h.height, h.width * 1.4) * 0.10;
        const ellipseRy = mouthH * mouthOpen;
        const ellipseRx = mouthW * 0.5 * (0.85 + speechMix * 0.15);

        return (
          <React.Fragment key={`${h.label}-${i}`}>
            {/* Body aura — narrow vertical ellipse over the lower 60%
                of the bbox so it lights the torso/legs, not the empty
                bg above the head. */}
            <div
              style={{
                position: 'absolute',
                left: `${h.x + h.width * 0.12}%`,
                top: `${h.y + h.height * 0.38}%`,
                width: `${h.width * 0.76}%`,
                height: `${h.height * 0.60}%`,
                transform: `translate(${tx}%, 0) scale(${scale})`,
                transformOrigin: 'center bottom',
                transition: 'none',
                borderRadius: '50% 50% 45% 45% / 60% 60% 40% 40%',
                background: `radial-gradient(ellipse at 50% 50%, rgba(${ringColor},${ringAlpha.toFixed(3)}) 0%, transparent 70%)`,
                filter: 'blur(8px)',
                mixBlendMode: 'screen',
              }}
            />
            {/* Mouth — only on character hotspots. Opens/closes with
                cueActive so the bg figures appear to be speaking the
                narration. Position math lives above this block — for
                full-body bboxes mouthYFrac is 0.08 (right under the
                top edge of the bbox, on the face); for head-only
                bboxes it's 0.55 (mid-face). */}
            {isCharacter && (
              <div
                style={{
                  position: 'absolute',
                  left: `${h.x + (h.width - mouthW) / 2}%`,
                  top: `${h.y + h.height * mouthYFrac}%`,
                  width: `${mouthW}%`,
                  height: `${mouthH}%`,
                  pointerEvents: 'none',
                }}
              >
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
                  <ellipse
                    cx={50}
                    cy={50}
                    rx={ellipseRx / mouthW * 100}
                    ry={ellipseRy / mouthH * 100}
                    fill={`rgba(60, 20, 18, ${cueActive ? 0.78 : 0.45})`}
                  />
                  <path
                    d={`M ${50 - ellipseRx / mouthW * 100} 50 Q 50 ${50 - ellipseRy / mouthH * 110}, ${50 + ellipseRx / mouthW * 100} 50`}
                    fill="none"
                    stroke={`rgba(255, 200, 170, ${cueActive ? 0.65 : 0.35})`}
                    strokeWidth={2.0}
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// Cinematic subtitle panel — readable contrast, blur backdrop,
// segmented progress bar that looks intentional. Lifted into its
// own component because the styling matters and inlining made the
// SceneShot return statement hard to read.
const SubtitlePanel: React.FC<{
  cues: FrameCue[];
  activeCueIndex: number;
  activeCue: FrameCue | null;
  appearAlpha: number;
}> = ({ cues, activeCueIndex, activeCue, appearAlpha }) => {
  return (
    <div
      data-testid="movie-caption"
      data-cue-index={activeCueIndex}
      data-cue-total={cues.length}
      style={{
        position: 'absolute', bottom: 72, left: 120, right: 120,
        opacity: activeCue ? appearAlpha : 0,
      }}
    >
      <div style={{
        padding: '24px 32px',
        borderRadius: 18,
        background: 'linear-gradient(180deg, rgba(12,8,6,0.62) 0%, rgba(12,8,6,0.82) 100%)',
        backdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,215,0,0.22)',
        boxShadow: '0 12px 36px rgba(0,0,0,0.45)',
      }}>
        <p style={{
          fontSize: 38,
          lineHeight: 1.42,
          color: '#FFF7DA',
          fontFamily: 'serif',
          fontWeight: 500,
          textShadow: '0 2px 12px rgba(0,0,0,0.85)',
          margin: 0,
          letterSpacing: 0.2,
          // Cap caption to two visual lines on a 1920px canvas;
          // anything longer is ellipsised so the panel doesn't
          // grow taller than the lower-third strip.
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {activeCue?.text ?? ''}
        </p>
        {cues.length > 1 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            {cues.map((_, i) => {
              const past = i < activeCueIndex;
              const current = i === activeCueIndex;
              return (
                <div key={i} style={{
                  height: 4,
                  flex: 1,
                  borderRadius: 4,
                  background: past
                    ? 'linear-gradient(90deg, #FF9933, #FFD700)'
                    : current
                      ? 'linear-gradient(90deg, #FFD700, rgba(255,215,0,0.4))'
                      : 'rgba(255,255,255,0.14)',
                  boxShadow: current ? '0 0 14px rgba(255,215,0,0.55)' : 'none',
                  transition: 'background 0.25s ease, box-shadow 0.25s ease',
                }} />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// Divine glow + golden particle layer used by sacred scenes (the
// `divine_glow` motion). Subtle radial gradient that breathes,
// plus 18 drifting golden specks anchored by Remotion's seeded
// random so they're deterministic across re-renders.
const DivineGlowOverlay: React.FC<{ frame: number }> = ({ frame }) => {
  const breath = 0.55 + Math.sin(frame * 0.04) * 0.15;
  const particles = React.useMemo(
    () => Array.from({ length: 18 }, (_, i) => ({
      id: i,
      x: random(`gx-${i}`) * 1920,
      yPhase: random(`gy-${i}`),
      size: 3 + random(`gs-${i}`) * 4,
      speed: 0.4 + random(`gv-${i}`) * 0.6,
    })),
    [],
  );
  return (
    <>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(circle at 50% 38%, rgba(255,215,0,0.18) 0%, rgba(255,215,0,0.04) 35%, transparent 65%)',
        opacity: breath,
        pointerEvents: 'none',
        mixBlendMode: 'screen',
      }} />
      {particles.map(p => {
        const phase = (p.yPhase + (frame * p.speed) / 240) % 1;
        const y = 1080 - phase * 1180;
        return (
          <div key={p.id} style={{
            position: 'absolute', left: p.x, top: y,
            width: p.size, height: p.size, borderRadius: '50%',
            background: '#FFE7A6',
            boxShadow: '0 0 14px rgba(255,231,166,0.85)',
            opacity: Math.sin(phase * Math.PI) * 0.85,
            pointerEvents: 'none',
          }} />
        );
      })}
    </>
  );
};

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 80, stiffness: 200 } });
  const fadeIn = interpolate(frame, [0, 24], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 42%, #5A0404 0%, #2A0606 50%, #0C0806 100%)', overflow: 'hidden' }}>
      {/* Slow rotating golden ring */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        width: 1400, height: 1400, marginLeft: -700, marginTop: -700,
        borderRadius: '50%',
        background: `conic-gradient(from ${frame * 0.5}deg, rgba(255,215,0,0) 0deg, rgba(255,215,0,0.12) 80deg, rgba(255,153,51,0.10) 200deg, rgba(255,215,0,0) 360deg)`,
        filter: 'blur(60px)',
        opacity: fadeIn,
      }} />
      <div style={{
        position: 'relative', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', height: '100%',
        transform: `scale(${s})`, textAlign: 'center',
      }}>
        <div style={{ width: 110, height: 110, borderRadius: '50%', overflow: 'hidden', border: '3px solid #FFD700', boxShadow: '0 0 60px rgba(255,215,0,0.45)', margin: '0 auto 32px' }}>
          <Img src={staticFile('logo.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.25) translateY(-5%)' }} />
        </div>
        <div style={{ fontSize: 72, fontWeight: 800, color: '#FFD700', marginBottom: 20, fontFamily: 'serif', textShadow: '0 4px 22px rgba(255,215,0,0.35)' }}>Touch the Story</div>
        <div style={{ fontSize: 26, color: '#FFF0B3', marginBottom: 12, maxWidth: 1100, lineHeight: 1.4 }}>
          Click highlighted characters and objects. Tap the background to discover hidden details.
        </div>
        <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)', marginBottom: 44, letterSpacing: 1 }}>
          Every interaction generates a new branch — narration, image, follow-up actions.
        </div>
        <div style={{
          fontSize: 26, color: '#0C0806', fontWeight: 800, letterSpacing: 1.2,
          background: 'linear-gradient(135deg, #FF9933, #FFD700)',
          padding: '18px 56px', borderRadius: 16, display: 'inline-block',
          boxShadow: '0 12px 36px rgba(255,153,51,0.4)',
        }}>
          kathakitaab.ai
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── Composition ──────────────────────────────────────────────

// Precompute scene placements so the JSX doesn't mutate a closed-over
// counter while rendering — Remotion + React-hooks rules flag that as
// non-deterministic across re-renders.
function planLayout(manifest: BookMovieManifest) {
  const placements: Array<{ from: number; frames: number }> = [];
  let cursor = TITLE_FRAMES;
  for (const scene of manifest.scenes) {
    const frames = Math.ceil((scene.durationSeconds + SCENE_TAIL_SECONDS) * BOOK_MOVIE_FPS);
    placements.push({ from: cursor, frames });
    cursor += frames;
  }
  return { placements, endCardFrom: cursor };
}

export const BookMovie: React.FC<{ manifest: BookMovieManifest }> = ({ manifest }) => {
  const total = manifest.scenes.length;
  const { placements, endCardFrom } = planLayout(manifest);

  return (
    <AbsoluteFill style={{ backgroundColor: '#0C0806' }}>
      <Sequence from={0} durationInFrames={TITLE_FRAMES}>
        <TitleCard bookTitle={manifest.bookTitle} />
      </Sequence>

      {manifest.scenes.map((scene, index) => {
        const { from, frames } = placements[index];
        return (
          <Sequence key={scene.sceneId} from={from} durationInFrames={frames}>
            <SceneShot scene={scene} index={index} total={total} />
          </Sequence>
        );
      })}

      <Sequence from={endCardFrom} durationInFrames={END_FRAMES}>
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
};
