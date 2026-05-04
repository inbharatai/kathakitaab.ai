import React from 'react';
import {
  AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig,
  staticFile, Sequence, spring,
} from 'remotion';

// ── Slide definitions — every slide is a REAL screenshot ─────

const SLIDES: Array<{
  type: 'title' | 'screenshot' | 'feature' | 'mobile' | 'end';
  file?: string;
  files?: string[];
  label?: string;
  caption?: string;
  title?: string;
}> = [
  { type: 'title' },

  // Landing page
  { type: 'screenshot', file: '01-landing-hero.png', label: 'Landing Page', caption: 'Not a Flipbook. A Living Story Engine — powered by AI.' },
  { type: 'screenshot', file: '02-landing-features.png', label: 'Features', caption: 'AI-generated scenes, clickable characters, web-grounded content, infinite stories.' },

  // Story library
  { type: 'screenshot', file: '04-books-page.png', label: 'Story Library', caption: 'Type any title — the AI generates a complete illustrated interactive book.' },

  // Scene walkthrough (showing the real AI images)
  { type: 'screenshot', file: '05-ayodhya_intro.png', label: 'Scene 1', caption: 'The Princes of Ayodhya — where the Ramayana begins.' },
  { type: 'screenshot', file: '06-mithila_bow.png', label: 'Scene 2', caption: 'Rama lifts the mighty Bow of Shiva in King Janaka\'s court.' },
  { type: 'screenshot', file: '07-exile.png', label: 'Scene 3', caption: 'Rama accepts fourteen years of exile. Sita and Lakshmana follow.' },
  { type: 'screenshot', file: '08-forest_life.png', label: 'Scene 4', caption: 'Life in the forest — peace before the storm. The golden deer appears.' },
  { type: 'screenshot', file: '09-ravana_jatayu.png', label: 'Scene 5', caption: 'Ravana strikes. Jatayu fights with his last breath to save Sita.' },
  { type: 'screenshot', file: '11-hanuman_lanka.png', label: 'Scene 7', caption: 'Hanuman leaps across the ocean to Lanka — powered by devotion.' },
  { type: 'screenshot', file: '13-battle_lanka.png', label: 'Scene 9', caption: 'The great battle of Lanka — Rama faces the ten-headed Ravana.' },
  { type: 'screenshot', file: '14-return_ayodhya.png', label: 'Scene 10', caption: 'Ayodhya lights a thousand lamps. Rama returns victorious.' },

  // Interactive features (showing real interactions)
  { type: 'feature', file: '16-hotspot-hover.png', title: 'Click Any Character', caption: 'Characters glow when hovered. Click to talk, inspect, or follow.' },
  { type: 'feature', file: '17-branch-panel.png', title: 'Instant AI Response', caption: 'Every click generates narration, new text, and follow-up actions — pre-cached, instant.' },
  { type: 'feature', file: '18-battle-hotspots.png', title: 'Living Scene', caption: 'Every scene has clickable entities — characters, objects, paths, backgrounds.' },
  { type: 'feature', file: '19-click-anywhere-result.png', title: 'Click Anywhere', caption: 'Click anywhere on the image. AI classifies what you touched and responds.' },
  { type: 'feature', file: '20-quiz-mode.png', title: 'Quiz Mode', caption: 'Switch to Quiz mode — test your knowledge with AI-generated questions.' },

  // Mobile
  { type: 'mobile', files: ['21-mobile-landing.png', '22-mobile-scene.png'], caption: 'Fully optimized for mobile. Touch the story on any device.' },

  // Educator + comparison
  { type: 'screenshot', file: '23-educator.png', label: 'Educator Dashboard', caption: 'Teachers generate curriculum-based interactive books for any subject.' },
  { type: 'screenshot', file: '03-landing-comparison.png', label: 'Beyond Flipbook', caption: 'Static pages vs living scenes. AI narration vs silence. Clicks that do nothing vs clicks that generate.' },

  { type: 'end' },
];

const SLIDE_DURATION = 120; // 4 seconds per slide at 30fps

// ── Components ───────────────────────────────────────────────

function TitleCard() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 80, stiffness: 200 } });
  const fade = interpolate(frame, [SLIDE_DURATION - 20, SLIDE_DURATION], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 30%, #4A0404, #0C0806)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: fade }}>
      <div style={{ width: 140, height: 140, borderRadius: '50%', overflow: 'hidden', border: '4px solid #FFD700', boxShadow: '0 0 60px rgba(255,215,0,0.4)', marginBottom: 36, transform: `scale(${s})` }}>
        <Img src={staticFile('logo.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.25) translateY(-5%)' }} />
      </div>
      <div style={{ fontSize: 72, fontWeight: 800, color: '#FFD700', textShadow: '0 4px 30px rgba(255,215,0,0.3)', transform: `scale(${s})` }}>KathaKitaab.ai</div>
      <div style={{ fontSize: 28, color: '#FFF0B3', marginTop: 16, letterSpacing: '0.2em', textTransform: 'uppercase', opacity: interpolate(frame, [30, 60], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
        A Living Story Engine
      </div>
      <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.4)', marginTop: 24, opacity: interpolate(frame, [50, 80], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
        Click. Explore. Listen. Shape the Story.
      </div>
    </AbsoluteFill>
  );
}

function ScreenshotSlide({ file, caption, label }: { file: string; caption: string; label: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 100, stiffness: 200, mass: 0.5 } });
  const captionOp = interpolate(frame, [30, 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const fade = interpolate(frame, [SLIDE_DURATION - 15, SLIDE_DURATION], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: '#0C0806', opacity: fade }}>
      <div style={{ position: 'absolute', inset: 40, borderRadius: 16, overflow: 'hidden', border: '2px solid rgba(255,215,0,0.12)', boxShadow: '0 30px 80px rgba(0,0,0,0.8)', transform: `scale(${interpolate(enter, [0, 1], [0.95, 1])})` }}>
        <Img src={staticFile('full-screenshots/' + file)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
      <div style={{ position: 'absolute', top: 52, left: 56, padding: '8px 20px', borderRadius: 30, background: 'rgba(255,153,51,0.9)', color: '#0C0806', fontSize: 16, fontWeight: 700, opacity: captionOp }}>{label}</div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '20px 60px 28px', background: 'linear-gradient(transparent, rgba(12,8,6,0.95))', opacity: captionOp }}>
        <div style={{ fontSize: 22, color: '#FFF0B3', fontWeight: 600, lineHeight: 1.5 }}>{caption}</div>
      </div>
    </AbsoluteFill>
  );
}

function FeatureSlide({ title, file, caption }: { title: string; file: string; caption: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 100, stiffness: 200 } });
  const fade = interpolate(frame, [SLIDE_DURATION - 15, SLIDE_DURATION], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: '#0C0806', opacity: fade }}>
      <div style={{ position: 'absolute', top: 30, left: 40, right: 40, bottom: 110, borderRadius: 14, overflow: 'hidden', border: '2px solid rgba(255,215,0,0.12)', transform: `scale(${interpolate(enter, [0, 1], [0.97, 1])})` }}>
        <Img src={staticFile('full-screenshots/' + file)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '14px 60px 24px', background: 'linear-gradient(transparent, rgba(12,8,6,0.98) 30%)' }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#FFD700', marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5 }}>{caption}</div>
      </div>
    </AbsoluteFill>
  );
}

function MobileSlide({ files, caption }: { files: string[]; caption: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 80, stiffness: 200 } });
  const fade = interpolate(frame, [SLIDE_DURATION - 15, SLIDE_DURATION], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: 'radial-gradient(circle, #1C120E, #0C0806)', opacity: fade, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 60 }}>
      {files.map((f, i) => (
        <div key={i} style={{ width: 300, height: 620, borderRadius: 28, overflow: 'hidden', border: '3px solid rgba(255,215,0,0.2)', boxShadow: '0 30px 80px rgba(0,0,0,0.7)', transform: `scale(${enter}) translateY(${i === 0 ? -10 : 10}px)` }}>
          <Img src={staticFile('full-screenshots/' + f)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      ))}
      <div style={{ position: 'absolute', bottom: 50, left: 0, right: 0, textAlign: 'center' }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#FFD700', marginBottom: 8 }}>Works on Mobile</div>
        <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.6)' }}>{caption}</div>
      </div>
    </AbsoluteFill>
  );
}

function EndCard() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 80, stiffness: 200 } });

  return (
    <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 40%, #4A0404, #0C0806)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ transform: `scale(${s})`, textAlign: 'center' }}>
        <div style={{ width: 90, height: 90, borderRadius: '50%', overflow: 'hidden', border: '3px solid #FFD700', margin: '0 auto 24px' }}>
          <Img src={staticFile('logo.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.25) translateY(-5%)' }} />
        </div>
        <div style={{ fontSize: 56, fontWeight: 800, color: '#FFD700', marginBottom: 14 }}>Touch the Story</div>
        <div style={{ fontSize: 22, color: '#FFF0B3', marginBottom: 12 }}>Every character, object, and scene responds.</div>
        <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.4)', marginBottom: 32 }}>AI narration. Pre-generated branches. Instant clicks.</div>
        <div style={{ fontSize: 22, color: '#0C0806', fontWeight: 700, background: 'linear-gradient(135deg, #FF9933, #FFD700)', padding: '16px 48px', borderRadius: 14, display: 'inline-block' }}>kathakitaab.ai</div>
      </div>
    </AbsoluteFill>
  );
}

// ── Main Composition ─────────────────────────────────────────

export const KathaTrailer: React.FC = () => {
  let offset = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: '#0C0806' }}>
      {SLIDES.map((slide, i) => {
        const from = offset;
        offset += SLIDE_DURATION;
        switch (slide.type) {
          case 'title': return <Sequence key={i} from={from} durationInFrames={SLIDE_DURATION}><TitleCard /></Sequence>;
          case 'screenshot': return <Sequence key={i} from={from} durationInFrames={SLIDE_DURATION}><ScreenshotSlide file={slide.file!} caption={slide.caption!} label={slide.label!} /></Sequence>;
          case 'feature': return <Sequence key={i} from={from} durationInFrames={SLIDE_DURATION}><FeatureSlide title={slide.title!} file={slide.file!} caption={slide.caption!} /></Sequence>;
          case 'mobile': return <Sequence key={i} from={from} durationInFrames={SLIDE_DURATION}><MobileSlide files={slide.files!} caption={slide.caption!} /></Sequence>;
          case 'end': return <Sequence key={i} from={from} durationInFrames={SLIDE_DURATION}><EndCard /></Sequence>;
          default: return null;
        }
      })}
    </AbsoluteFill>
  );
};

export const TRAILER_DURATION = SLIDES.length * SLIDE_DURATION;
