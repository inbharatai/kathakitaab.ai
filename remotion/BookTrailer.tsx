// ============================================================
// remotion/BookTrailer.tsx
//
// 60-90 second cinematic teaser carved out of the same
// BookMovieManifest the full BookMovie reads. Picks the most
// dramatic scenes by motion type (battle_push, divine_glow,
// pan_left for somber arcs), trims each scene's audio to a
// short tease, layers a punchier mood mix.
//
// Why a separate composition vs. a query parameter on BookMovie:
//   - The trailer pacing is *different* — short scene tails
//     (~6s each), faster transitions, an end CTA card —
//     not a "BookMovie minus narration" derivative.
//   - Remotion compositions are cheap; sharing the manifest type
//     and motion vocabulary keeps both renders coherent without
//     coupling their pacing logic.
// ============================================================

import React from 'react';
import {
  AbsoluteFill, Audio, Img, Sequence, interpolate, random, spring,
  staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';

import { motionForMood, motionParams } from '../lib/video/motion';
import { EffectStack, shakeOffset } from '../lib/video/effects/layers';
import type { BookMovieManifest, BookMovieScene } from './BookMovie';

export const TRAILER_FPS = 30;
const SCENE_FRAMES = 6 * TRAILER_FPS;        // 6s per dramatic shot
const TRAILER_FADE_FRAMES = 14;
const TRAILER_TITLE_FRAMES = 3 * TRAILER_FPS;
const TRAILER_END_FRAMES = 4 * TRAILER_FPS;

// Score each scene by visual impact — battle and divine scenes
// score highest, fade_only/closing scenes score lowest. The top
// 6 scenes go into the trailer.
function dramaticScore(scene: BookMovieScene): number {
  const motion = scene.motion ?? motionForMood(scene.mood);
  const moodWeights: Record<string, number> = {
    dramatic: 10, sacred: 8, joyful: 6, mysterious: 5, somber: 4, serene: 2,
  };
  const motionWeights: Record<string, number> = {
    battle_push: 4, divine_glow: 3, pan_right: 2, pan_left: 2,
    slow_zoom_in: 1, slow_zoom_out: 1, fade_only: 0,
  };
  return (moodWeights[scene.mood ?? ''] ?? 1) + (motionWeights[motion] ?? 0);
}

export function selectTrailerScenes(manifest: BookMovieManifest, count = 6): BookMovieScene[] {
  // Pick the top N by dramatic score, then sort by their original
  // order so the trailer still walks the story chronologically.
  const ranked = manifest.scenes
    .map((s, originalIndex) => ({ s, originalIndex, score: dramaticScore(s) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
  ranked.sort((a, b) => a.originalIndex - b.originalIndex);
  return ranked.map(r => r.s);
}

export function computeTrailerFrames(manifest: BookMovieManifest, count = 6): number {
  const scenes = selectTrailerScenes(manifest, count);
  return TRAILER_TITLE_FRAMES + scenes.length * SCENE_FRAMES + TRAILER_END_FRAMES;
}

const resolveAsset = (path: string): string =>
  /^https?:\/\//i.test(path)
    ? path
    : staticFile(path.startsWith('/') ? path.slice(1) : path);

// ── Title flash ──────────────────────────────────────────────

const TitleFlash: React.FC<{ bookTitle: string }> = ({ bookTitle }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 80, stiffness: 240 } });
  const fade = interpolate(frame, [durationInFrames - 14, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 35%, #5A0404, #0C0806)', opacity: fade, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 120, height: 120, borderRadius: '50%', overflow: 'hidden', border: '3px solid #FFD700', boxShadow: '0 0 60px rgba(255,215,0,0.4)', marginBottom: 36, transform: `scale(${s})` }}>
        <Img src={staticFile('logo.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.25) translateY(-5%)' }} />
      </div>
      <div style={{ fontSize: 88, fontWeight: 800, color: '#FFD700', textShadow: '0 4px 30px rgba(255,215,0,0.4)', transform: `scale(${s})`, fontFamily: 'serif' }}>
        {bookTitle}
      </div>
      <div style={{ fontSize: 26, color: '#FFF0B3', marginTop: 18, letterSpacing: '0.4em', textTransform: 'uppercase', opacity: interpolate(frame, [16, 40], [0, 1], { extrapolateRight: 'clamp' }) }}>
        Trailer
      </div>
    </AbsoluteFill>
  );
};

// ── Trailer scene ────────────────────────────────────────────

const TrailerShot: React.FC<{ scene: BookMovieScene; index: number }> = ({ scene, index }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const motion = scene.motion ?? motionForMood(scene.mood);
  const params = motionParams(motion);
  const effects = scene.effects ?? [];

  // Faster, punchier camera than BookMovie — bigger scale change
  // over the shorter window so the motion reads.
  const t = frame / Math.max(1, durationInFrames);
  const scale = interpolate(t, [0, 1], [params.startScale + 0.04, params.endScale + 0.06]);
  const tx = interpolate(t, [0, 1], [0, params.panX * 1.2]);
  const ty = interpolate(t, [0, 1], [0, params.panY * 1.2]);
  // Trailer shake is amplified ~1.4× from the DSL value for a punchier feel.
  const dslShake = shakeOffset(effects, frame);
  const motionShakeX = params.shake ? Math.sin(frame * 0.41) * params.shake * 1.4 : 0;
  const motionShakeY = params.shake ? Math.cos(frame * 0.37) * params.shake : 0;
  const shakeX = effects.some(e => e.type === 'shake') ? dslShake.x * 1.4 : motionShakeX;
  const shakeY = effects.some(e => e.type === 'shake') ? dslShake.y * 1.4 : motionShakeY;

  const fadeIn = interpolate(frame, [0, TRAILER_FADE_FRAMES], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - TRAILER_FADE_FRAMES, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity = Math.min(fadeIn, fadeOut);

  // First sentence of the narration is the trailer caption — short,
  // hook-y, doesn't try to compress 30s of story into 6s.
  const firstSentence = (scene.narration.split(/(?<=[.!?])\s+/)[0] ?? '').trim();
  const captionAlpha = interpolate(frame, [16, 40, durationInFrames - 24, durationInFrames - 8], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Tease the narration audio for ~5s — start at scene start, fade
  // out in the last 1s. Mood bed plays at 0.32 (louder than the full
  // movie's 0.28 base) for a punchier trailer feel.
  const audioVolume = (f: number) => interpolate(f, [0, durationInFrames - 24, durationInFrames], [0.85, 0.85, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const moodSrc = scene.backgroundMusicUrl
    ? resolveAsset(scene.backgroundMusicUrl)
    : scene.mood
      ? staticFile(`audio/mood/${scene.mood}.wav`)
      : null;

  return (
    <AbsoluteFill style={{ backgroundColor: '#0C0806', opacity }}>
      <Img
        src={resolveAsset(scene.imagePath)}
        style={{
          width: '100%', height: '100%', objectFit: 'cover',
          transform: `scale(${scale}) translate(${tx + shakeX}px, ${ty + shakeY}px)`,
          filter: 'brightness(0.82) saturate(1.18)',
        }}
      />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(12,8,6,0.5) 0%, transparent 22%, transparent 50%, rgba(12,8,6,0.96) 100%)' }} />

      {/* Universal effects stack with legacy tint fallback. */}
      {effects.length > 0 ? (
        <EffectStack effects={effects} frame={frame} fps={fps} seedPrefix={`trailer-${scene.sceneId}`} />
      ) : (
        params.tint && (
          <div style={{ position: 'absolute', inset: 0, background: params.tint, mixBlendMode: 'multiply' }} />
        )
      )}

      {/* Caption — shorter, larger, no progress dots in trailer mode */}
      <div data-testid="trailer-caption" data-scene-index={index} style={{
        position: 'absolute', bottom: 90, left: 140, right: 140,
        opacity: captionAlpha,
      }}>
        <p style={{
          fontSize: 44, lineHeight: 1.32, color: '#FFF7DA',
          fontFamily: 'serif', fontWeight: 600,
          textShadow: '0 4px 18px rgba(0,0,0,0.85)',
          margin: 0, letterSpacing: 0.3,
        }}>
          {firstSentence}
        </p>
      </div>

      <Sequence from={0}>
        <Audio src={resolveAsset(scene.audioPath)} volume={audioVolume} />
      </Sequence>

      {moodSrc && (
        <Audio src={moodSrc} volume={0.32} loop />
      )}
    </AbsoluteFill>
  );
};

// ── End CTA ──────────────────────────────────────────────────

const TrailerEndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 80, stiffness: 240 } });
  const fadeIn = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 42%, #5A0404, #0C0806)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: fadeIn }}>
      <div style={{ width: 100, height: 100, borderRadius: '50%', overflow: 'hidden', border: '3px solid #FFD700', boxShadow: '0 0 60px rgba(255,215,0,0.45)', marginBottom: 28, transform: `scale(${s})` }}>
        <Img src={staticFile('logo.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.25) translateY(-5%)' }} />
      </div>
      <div style={{ fontSize: 64, fontWeight: 800, color: '#FFD700', fontFamily: 'serif', marginBottom: 16 }}>
        Touch the Story
      </div>
      <div style={{ fontSize: 24, color: '#FFF0B3', marginBottom: 36, maxWidth: 1100, textAlign: 'center', padding: '0 80px', lineHeight: 1.4 }}>
        Click highlighted characters and objects. Tap the background to discover hidden details.
      </div>
      <div style={{
        fontSize: 26, color: '#0C0806', fontWeight: 800, letterSpacing: 1.4,
        background: 'linear-gradient(135deg, #FF9933, #FFD700)',
        padding: '18px 56px', borderRadius: 14, display: 'inline-block',
        boxShadow: '0 12px 36px rgba(255,153,51,0.4)',
      }}>
        https://www.kathakitaab.com
      </div>
    </AbsoluteFill>
  );
};

// ── Composition ──────────────────────────────────────────────

export const BookTrailer: React.FC<{ manifest: BookMovieManifest }> = ({ manifest }) => {
  const scenes = selectTrailerScenes(manifest, 6);
  void random; // keep deterministic seeding consistent if added later

  return (
    <AbsoluteFill style={{ backgroundColor: '#0C0806' }}>
      <Sequence from={0} durationInFrames={TRAILER_TITLE_FRAMES}>
        <TitleFlash bookTitle={manifest.bookTitle} />
      </Sequence>

      {scenes.map((scene, i) => (
        <Sequence
          key={scene.sceneId}
          from={TRAILER_TITLE_FRAMES + i * SCENE_FRAMES}
          durationInFrames={SCENE_FRAMES}
        >
          <TrailerShot scene={scene} index={i} />
        </Sequence>
      ))}

      <Sequence
        from={TRAILER_TITLE_FRAMES + scenes.length * SCENE_FRAMES}
        durationInFrames={TRAILER_END_FRAMES}
      >
        <TrailerEndCard />
      </Sequence>
    </AbsoluteFill>
  );
};
