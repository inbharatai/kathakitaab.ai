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
  AbsoluteFill, Audio, Img, Sequence, interpolate, spring,
  staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';

export interface BookMovieScene {
  sceneId: string;
  title: string;
  narration: string;
  /** Either an absolute http(s) URL (Supabase Storage) or `/`-prefixed local path. */
  imagePath: string;
  /** Either an absolute http(s) URL (Supabase Storage) or `/`-prefixed local path. */
  audioPath: string;
  durationSeconds: number;
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

  return (
    <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 30%, #4A0404, #0C0806)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: fade }}>
      <div style={{ width: 140, height: 140, borderRadius: '50%', overflow: 'hidden', border: '4px solid #FFD700', boxShadow: '0 0 60px rgba(255,215,0,0.4)', marginBottom: 40, transform: `scale(${s})` }}>
        <Img src={staticFile('logo.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.25) translateY(-5%)' }} />
      </div>
      <div style={{ fontSize: 84, fontWeight: 800, color: '#FFD700', textShadow: '0 4px 30px rgba(255,215,0,0.3)', transform: `scale(${s})`, fontFamily: 'serif', textAlign: 'center', padding: '0 80px' }}>
        {bookTitle}
      </div>
      <div style={{ fontSize: 26, color: '#FFF0B3', marginTop: 20, letterSpacing: '0.3em', textTransform: 'uppercase', opacity: interpolate(frame, [30, 60], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
        A Living Story
      </div>
      <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.45)', marginTop: 28, opacity: interpolate(frame, [50, 80], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
        Narrated end-to-end. Click anything in the app.
      </div>
    </AbsoluteFill>
  );
};

const SceneShot: React.FC<{
  imagePath: string;
  title: string;
  narration: string;
  audioPath: string;
  index: number;
  total: number;
}> = ({ imagePath, title, narration, audioPath, index, total }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Ken Burns: subtle 1.04→1.10 scale + slow horizontal drift.
  // Direction alternates per scene so successive panes don't all
  // drift the same way and feel monotonous.
  const dir = index % 2 === 0 ? 1 : -1;
  const t = frame / durationInFrames;
  const scale = interpolate(t, [0, 1], [1.04, 1.10]);
  const tx = interpolate(t, [0, 1], [0, dir * 28]);
  const ty = interpolate(t, [0, 1], [0, -8]);

  const fadeIn = interpolate(frame, [0, SCENE_FADE_FRAMES], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - SCENE_FADE_FRAMES, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity = Math.min(fadeIn, fadeOut);

  // Audio leads in 6 frames after the visual so the first syllable
  // lands once the eye has registered the new scene.
  const audioStart = 6;
  const captionAppear = interpolate(frame, [12, 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: '#0C0806', opacity }}>
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <Img
          src={resolveAsset(imagePath)}
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            transform: `scale(${scale}) translate(${tx}px, ${ty}px)`,
            filter: 'brightness(0.86) saturate(1.12)',
          }}
        />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(12,8,6,0.55) 0%, transparent 24%, transparent 56%, rgba(12,8,6,0.92) 100%)' }} />
      </div>

      <div style={{
        position: 'absolute', top: 40, left: 56,
        display: 'flex', alignItems: 'center', gap: 14, opacity: captionAppear,
      }}>
        <div style={{
          padding: '6px 16px', borderRadius: 30,
          background: 'rgba(255,153,51,0.92)', color: '#0C0806',
          fontSize: 16, fontWeight: 800, letterSpacing: 1,
        }}>
          Scene {index + 1} / {total}
        </div>
        <div style={{ fontSize: 36, fontWeight: 800, color: '#FFD700', textShadow: '0 3px 14px rgba(0,0,0,0.7)' }}>
          {title}
        </div>
      </div>

      <div style={{
        position: 'absolute', bottom: 56, left: 80, right: 80, opacity: captionAppear,
      }}>
        <p style={{
          fontSize: 26, lineHeight: 1.55, color: '#FFF0B3',
          fontFamily: 'serif', textShadow: '0 3px 16px rgba(0,0,0,0.85)',
          margin: 0, maxWidth: 1500,
        }}>
          {narration}
        </p>
      </div>

      <Sequence from={audioStart}>
        <Audio src={resolveAsset(audioPath)} />
      </Sequence>
    </AbsoluteFill>
  );
};

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 80, stiffness: 200 } });

  return (
    <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 40%, #4A0404, #0C0806)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ transform: `scale(${s})`, textAlign: 'center' }}>
        <div style={{ width: 96, height: 96, borderRadius: '50%', overflow: 'hidden', border: '3px solid #FFD700', margin: '0 auto 26px' }}>
          <Img src={staticFile('logo.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.25) translateY(-5%)' }} />
        </div>
        <div style={{ fontSize: 60, fontWeight: 800, color: '#FFD700', marginBottom: 16, fontFamily: 'serif' }}>Touch the Story</div>
        <div style={{ fontSize: 24, color: '#FFF0B3', marginBottom: 14 }}>Click any character. Click any object. Click anywhere.</div>
        <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.45)', marginBottom: 36 }}>Every interaction generates a new branch — narration, image, follow-up actions.</div>
        <div style={{ fontSize: 24, color: '#0C0806', fontWeight: 800, background: 'linear-gradient(135deg, #FF9933, #FFD700)', padding: '16px 52px', borderRadius: 14, display: 'inline-block' }}>kathakitaab.ai</div>
      </div>
    </AbsoluteFill>
  );
};

// ── Composition ──────────────────────────────────────────────

export const BookMovie: React.FC<{ manifest: BookMovieManifest }> = ({ manifest }) => {
  let cursor = 0;
  const total = manifest.scenes.length;

  return (
    <AbsoluteFill style={{ backgroundColor: '#0C0806' }}>
      <Sequence from={cursor} durationInFrames={TITLE_FRAMES}>
        <TitleCard bookTitle={manifest.bookTitle} />
      </Sequence>
      {(() => { cursor += TITLE_FRAMES; return null; })()}

      {manifest.scenes.map((scene, index) => {
        const sceneFrames = Math.ceil((scene.durationSeconds + SCENE_TAIL_SECONDS) * BOOK_MOVIE_FPS);
        const from = cursor;
        cursor += sceneFrames;
        return (
          <Sequence key={scene.sceneId} from={from} durationInFrames={sceneFrames}>
            <SceneShot
              imagePath={scene.imagePath}
              title={scene.title}
              narration={scene.narration}
              audioPath={scene.audioPath}
              index={index}
              total={total}
            />
          </Sequence>
        );
      })}

      <Sequence from={cursor} durationInFrames={END_FRAMES}>
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
};
