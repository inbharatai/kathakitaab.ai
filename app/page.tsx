'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { useRef, useState } from 'react';
import { Player } from '@remotion/player';
import { BookMovie, BOOK_MOVIE_FPS, computeBookMovieFrames } from '@/remotion/BookMovie';
import { BookTrailer, TRAILER_FPS, computeTrailerFrames } from '@/remotion/BookTrailer';
import { getManifestForSlug } from '@/lib/video/manifestRegistry';

const LANDING_MANIFEST = getManifestForSlug('ramayana')!;
const LANDING_MOVIE_FRAMES = computeBookMovieFrames(LANDING_MANIFEST);
const LANDING_TRAILER_FRAMES = computeTrailerFrames(LANDING_MANIFEST);

// ── Data ─────────────────────────────────────────────────────

const SCENE_PREVIEWS = [
  { src: '/images/scene_ayodhya_intro.png', label: 'Ayodhya' },
  { src: '/images/scene_mithila_bow.png', label: 'The Bow' },
  { src: '/images/scene_forest_life.png', label: 'Forest' },
  { src: '/images/scene_battle_lanka.png', label: 'Battle' },
  { src: '/images/scene_return_ayodhya.png', label: 'Return' },
];

const COMPARISON = [
  { old: 'Static pages you flip through', new: 'Living scenes — figures breathe, sway, blink, and look around' },
  { old: 'Read-only text and images', new: 'Highlighted characters and objects respond on click' },
  { old: 'Same response no matter which action', new: 'Verb-aware AI — Talk, Fight, Honor, Comfort each feel different' },
  { old: 'No reaction when you click', new: 'Camera dollies, characters pose, sprites flash — keyed to the verb' },
  { old: 'Same experience every time', new: 'AI generates a fresh branch the first time, caches it after' },
  { old: 'Silent or robotic narration', new: 'Sarvam Bulbul shaped per scene mood — sorrow plays slow, battle plays urgent' },
  { old: 'One linear path', new: 'Story graph with hidden discoveries via tap-anywhere' },
  { old: 'Books vs. movies — pick one', new: 'Every book also plays as a cinematic movie' },
  { old: 'Flat illustrations', new: 'Layered scenes with parallax, fog, particles, dust shafts per scene' },
];

const STEPS = [
  { num: '01', title: 'A scene appears', desc: 'Hand-painted illustration breathes with parallax + drifting fog, with a procedural mood bed underneath and emotional Sarvam narration shaped to the scene’s mood.' },
  { num: '02', title: 'Click highlighted elements', desc: 'Characters and objects with golden glow rings respond instantly. Tap anywhere else and AI checks if there’s a hidden detail worth surfacing.' },
  { num: '03', title: 'Pick a verb — the world reacts', desc: 'Camera dollies in for Talk, pushes + shakes for Fight, arcs upward for Leap. The figure quickens its breath, leans toward the addressee, and a verb-keyed sprite flashes — then a branch unfolds, action-keyed so Talk and Fight stay distinct.' },
  { num: '04', title: 'Or watch it as a movie', desc: 'Same engine renders a cinematic cut: per-scene camera motion, sentence cues, mood music ducked under narration, the same effects DSL baked into the file. Plus a 45-second trailer cut on demand.' },
];

const SUPPORTED_WORLDS = [
  'Ramayana', 'Mahabharata', 'Panchatantra', 'Shiva Stories', 'Buddha Tales',
  'Indian History', 'Fantasy', 'Sci-Fi', 'Kids Stories', 'Education', 'Biography', 'Any Title You Type',
];

// ── Component ────────────────────────────────────────────────

export default function HomePage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const heroParallax = useTransform(scrollYProgress, [0, 1], [0, -80]);
  const heroScale = useTransform(scrollYProgress, [0, 1], [1, 0.95]);

  // Movie Mode preview defaults to the 45-second trailer cut for a
  // snappier first impression. Visitor can switch to the Full Movie
  // (~6:46) without leaving the section. Same composition vocabulary,
  // different pacing — built on the same manifest.
  const [moviePreview, setMoviePreview] = useState<'trailer' | 'movie'>('trailer');

  return (
    <main className="lp">
      {/* ── Nav ── */}
      <nav className="lp-nav">
        <Link href="/" className="lp-nav-brand">
          <div className="lp-nav-logo">
            <Image src="/logo.png" alt="KathaKitaab" width={36} height={36} style={{ objectFit: 'cover', transform: 'scale(1.9) translateY(18%)' }} />
          </div>
          <span className="lp-nav-name">KathaKitaab<span className="lp-nav-ai">.ai</span></span>
        </Link>
        <div className="lp-nav-links">
          <Link href="/books" className="lp-nav-link">Stories</Link>
          <Link href="/educator" className="lp-nav-link">Educators</Link>
          <Link href="/books/ramayana" className="lp-btn-glow">Enter Ramayana</Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="lp-hero" ref={heroRef}>
        {/* Animated scene preview strip behind hero */}
        <div className="lp-hero-scenes">
          {SCENE_PREVIEWS.map((s, i) => (
            <motion.div
              key={s.label}
              className="lp-hero-scene-thumb"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 0.25, y: 0 }}
              transition={{ delay: 0.8 + i * 0.15, duration: 1 }}
            >
              <Image src={s.src} alt={s.label} fill sizes="300px" style={{ objectFit: 'cover' }} />
            </motion.div>
          ))}
        </div>

        <motion.div className="lp-hero-content" style={{ y: heroParallax, scale: heroScale }}>
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
            <div className="lp-hero-badge">
              <span className="lp-hero-badge-dot" />
              Not a Flipbook. A Living Story Engine.
            </div>

            <h1 className="lp-hero-h1">
              Where Stories<br /><span className="gradient-tricolor">Come Alive</span>
            </h1>

            <p className="lp-hero-sub font-serif">
              Click highlighted characters and objects. Tap the background to discover hidden details.<br />
              Figures breathe, sway, and glow as the scene comes alive. Or watch the whole book play as a cinematic movie.<br />
              AI generates new scenes, narration, and images — in real time.
            </p>

            <div className="lp-hero-ctas">
              <Link href="/books/ramayana" className="lp-btn-primary">
                <span>Enter the Ramayana</span>
                <span className="lp-btn-arrow">{'\u2192'}</span>
              </Link>
              <Link href="#movie-mode" className="lp-btn-outline">Watch as a Movie</Link>
            </div>

            <p className="lp-hero-hint">Free to explore. No signup required.</p>
          </motion.div>
        </motion.div>

        {/* Glow effects */}
        <div className="lp-hero-glow lp-hero-glow-1" />
        <div className="lp-hero-glow lp-hero-glow-2" />
        <div className="lp-hero-glow lp-hero-glow-3" />
      </section>

      {/* ── Interactive Demo Preview ── */}
      <section className="lp-demo">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
          <Image src="/logo.png" alt="KathaKitaab.ai" width={140} height={140} style={{ display: 'block', margin: '0 auto 20px', borderRadius: '18px' }} />
          <p className="lp-section-sub">Highlighted characters and objects respond on click. Tap the background and the AI checks for hidden details worth surfacing.</p>
        </motion.div>

        <motion.div
          className="lp-demo-frame"
          initial={{ opacity: 0, scale: 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <div className="lp-demo-image">
            <Image src="/images/scene_forest_life.png" alt="Interactive Forest Scene" fill sizes="900px" style={{ objectFit: 'cover' }} priority />
            {/* Simulated hotspot indicators */}
            <div className="lp-demo-hotspot" style={{ left: '28%', top: '40%' }}>
              <span className="lp-demo-hotspot-ring" />
              <span className="lp-demo-hotspot-label">Rama</span>
            </div>
            <div className="lp-demo-hotspot" style={{ left: '48%', top: '42%' }}>
              <span className="lp-demo-hotspot-ring" />
              <span className="lp-demo-hotspot-label">Sita</span>
            </div>
            <div className="lp-demo-hotspot" style={{ left: '72%', top: '55%' }}>
              <span className="lp-demo-hotspot-ring" />
              <span className="lp-demo-hotspot-label">Golden Deer</span>
            </div>
          </div>
          <div className="lp-demo-caption">
            <span className="lp-demo-caption-icon">{'\uD83D\uDC46'}</span>
            Click Rama, Sita, the Golden Deer, the river, the trees — anything. AI generates a unique response.
          </div>
        </motion.div>
      </section>

      {/* ── How It Works ── */}
      <section className="lp-steps">
        <motion.h2 className="lp-section-title" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
          How It Works
        </motion.h2>
        <div className="lp-steps-grid">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.num}
              className="lp-step"
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.5 }}
            >
              <span className="lp-step-num">{step.num}</span>
              <div>
                <h3 className="lp-step-title">{step.title}</h3>
                <p className="lp-step-desc">{step.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Flipbook vs KathaKitaab ── */}
      <section className="lp-compare">
        <motion.h2 className="lp-section-title" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
          Normal Flipbook vs Living Story Engine
        </motion.h2>
        <div className="lp-compare-table">
          <div className="lp-compare-header">
            <span className="lp-compare-old-h">Traditional Flipbook</span>
            <span className="lp-compare-new-h">KathaKitaab.ai</span>
          </div>
          {COMPARISON.map((row, i) => (
            <motion.div
              key={i}
              className="lp-compare-row"
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06 }}
            >
              <span className="lp-compare-old">{row.old}</span>
              <span className="lp-compare-new">{row.new}</span>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Trailer / Movie Mode ── */}
      <section className="lp-trailer" id="movie-mode">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          style={{ textAlign: 'center', marginBottom: 18 }}
        >
          <span className="lp-hero-badge" style={{ marginBottom: 14 }}>
            <span className="lp-hero-badge-dot" />
            New · Cartoon Phase 1 · Puppet states + drifting fog
          </span>
          <motion.h2 className="lp-section-title" style={{ marginTop: 8 }}>
            Every book also plays as a film
          </motion.h2>
          <p className="lp-section-sub" style={{ maxWidth: 760, margin: '10px auto 0' }}>
            One manifest, two cuts. The engine renders a {Math.round(LANDING_TRAILER_FRAMES / TRAILER_FPS)}-second
            cinematic trailer or the full {Math.round(LANDING_MOVIE_FRAMES / BOOK_MOVIE_FPS / 60)}-minute movie
            from the same scenes — per-scene motion, sentence cues, and a procedural mood bed ducked under
            Sarvam&apos;s emotional narration. The same effects DSL — particles, dust shafts, drifting fog,
            divine glow — and the same per-character puppet states play in the live reader and the
            exported MP4.
          </p>
          <ul style={{
            display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap',
            margin: '22px auto 0', padding: 0, listStyle: 'none', maxWidth: 920,
          }}>
            {[
              ['🎥', 'Per-scene motion — battle push, divine glow, slow pan'],
              ['🌬️', 'Ambient idle — figures breathe, sway, blink, and look around'],
              ['🎭', 'Puppet states — Talk speeds breath, Fight quickens sway, Leap arcs upward'],
              ['🗣️', 'Emotional Sarvam narration — pace + pitch shaped per scene mood'],
              ['💬', 'Sentence cues with explicit ms timing in the manifest'],
              ['🎼', 'Procedural mood bed, ducked to 0.10 under speech'],
              ['✨', 'Universal effects DSL — particles, dust shafts, fog, rim light'],
              ['👁', 'Audio-driven mouth pulse + geometric gaze toward the addressee'],
              ['🛡️', 'Verb-aware QA — Talk, Fight, Honor each feel distinct'],
              ['📥', 'Full-quality MP4 export from the movie page'],
            ].map(([icon, text]) => (
              <li key={text} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '8px 14px', borderRadius: 999,
                background: 'rgba(43,27,21,0.6)', border: '1px solid rgba(255,215,0,0.12)',
                fontSize: '0.82rem', color: 'var(--color-gold-light)',
              }}>
                <span aria-hidden>{icon}</span>{text}
              </li>
            ))}
          </ul>

          {/* Trailer / Full Movie toggle — same composition vocabulary,
              different pacing. Visitors land on the trailer (snappy)
              and can switch to the full cut without leaving the page. */}
          <div role="tablist" aria-label="Movie preview mode" style={{
            display: 'inline-flex', gap: 4, marginTop: 26, padding: 4,
            background: 'rgba(12,8,6,0.7)', borderRadius: 999,
            border: '1px solid rgba(255,215,0,0.16)',
          }}>
            {(['trailer', 'movie'] as const).map(key => {
              const active = moviePreview === key;
              const label = key === 'trailer'
                ? `Trailer · ${Math.round(LANDING_TRAILER_FRAMES / TRAILER_FPS)}s`
                : `Full Movie · ${Math.round(LANDING_MOVIE_FRAMES / BOOK_MOVIE_FPS / 60)} min`;
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setMoviePreview(key)}
                  data-testid={`landing-${key}-toggle`}
                  style={{
                    padding: '8px 18px', borderRadius: 999,
                    background: active ? 'linear-gradient(135deg, #FF9933, #FFD700)' : 'transparent',
                    color: active ? '#0C0806' : 'var(--color-gold-light)',
                    border: 'none', cursor: 'pointer',
                    fontSize: '0.82rem', fontWeight: 700, letterSpacing: 0.4,
                    transition: 'background 0.2s ease, color 0.2s ease',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </motion.div>

        <motion.div
          className="lp-trailer-wrap"
          initial={{ opacity: 0, scale: 0.97 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          {/* Live Remotion composition — same one that exports the MP4.
              Narration WAVs stream from Supabase CDN, scene art is in
              /public, mood beds are local procedural WAVs. No pre-render
              wait. Switching modes swaps the composition + manifest in
              place; React keys force a fresh Player mount. */}
          {moviePreview === 'trailer' ? (
            <Player
              key="trailer"
              component={BookTrailer}
              inputProps={{ manifest: LANDING_MANIFEST }}
              durationInFrames={LANDING_TRAILER_FRAMES}
              fps={TRAILER_FPS}
              compositionWidth={1920}
              compositionHeight={1080}
              initialFrame={20}
              controls
              clickToPlay
              doubleClickToFullscreen
              style={{ width: '100%', aspectRatio: '16 / 9', display: 'block', background: '#0C0806', borderRadius: 'inherit' }}
            />
          ) : (
            <Player
              key="movie"
              component={BookMovie}
              inputProps={{ manifest: LANDING_MANIFEST }}
              durationInFrames={LANDING_MOVIE_FRAMES}
              fps={BOOK_MOVIE_FPS}
              compositionWidth={1920}
              compositionHeight={1080}
              initialFrame={30}
              controls
              clickToPlay
              doubleClickToFullscreen
              style={{ width: '100%', aspectRatio: '16 / 9', display: 'block', background: '#0C0806', borderRadius: 'inherit' }}
            />
          )}
        </motion.div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 22, flexWrap: 'wrap' }}>
          <Link href="/books/ramayana/movie" className="lp-btn-primary" style={{ textDecoration: 'none' }}>
            Open Movie Mode
            <span className="lp-btn-arrow">{'→'}</span>
          </Link>
          <Link href="/books/ramayana" className="lp-btn-outline" style={{ textDecoration: 'none' }}>
            Read it interactively
          </Link>
        </div>
      </section>

      {/* ── Supported Worlds ── */}
      <section className="lp-worlds">
        <motion.h2 className="lp-section-title" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
          One Engine. Any Story.
        </motion.h2>
        <p className="lp-section-sub">Type any title. The AI builds a complete interactive illustrated book.</p>
        <div className="lp-worlds-grid">
          {SUPPORTED_WORLDS.map((w, i) => (
            <motion.span
              key={w}
              className="lp-world-tag"
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.03 }}
            >
              {w}
            </motion.span>
          ))}
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="lp-final-cta">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          <h2 className="lp-final-h2">Ready to enter a living story?</h2>
          <p className="lp-final-sub">Click a character. Discover a hidden path. Hear the story narrated. Shape what happens next.</p>
          <div className="lp-hero-ctas">
            <Link href="/books/ramayana" className="lp-btn-primary">
              <span>Start with Ramayana</span>
              <span className="lp-btn-arrow">{'\u2192'}</span>
            </Link>
            <Link href="/books#create-story" className="lp-btn-outline">Create Your Own</Link>
          </div>
        </motion.div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <Image src="/logo.png" alt="Logo" width={24} height={24} style={{ objectFit: 'cover', transform: 'scale(1.25) translateY(-5%)', borderRadius: '50%' }} />
            <span>KathaKitaab.ai</span>
          </div>
          <p className="lp-footer-text">Not a Flipbook. A Living Story Engine. &copy; 2026</p>
        </div>
      </footer>
    </main>
  );
}
