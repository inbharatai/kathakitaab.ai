'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { Player } from '@remotion/player';
import { BookMovie, BOOK_MOVIE_FPS, computeBookMovieFrames } from '@/remotion/BookMovie';
import { BookTrailer, TRAILER_FPS, computeTrailerFrames } from '@/remotion/BookTrailer';
import { getManifestForSlug } from '@/lib/video/manifestRegistry';
import { STYLE_PRESETS, type StylePreset } from '@/lib/types/style';
import { AuthNavButton } from '@/components/auth/AuthNavButton';
import { CinematicHeroBackground } from '@/components/landing/CinematicHeroBackground';
import { DriftingMotes } from '@/components/landing/DriftingMotes';
import { BookCardBackground } from '@/components/landing/BookCardBackground';

const LANDING_MANIFEST = getManifestForSlug('ramayana')!;
const LANDING_MOVIE_FRAMES = computeBookMovieFrames(LANDING_MANIFEST);
const LANDING_TRAILER_FRAMES = computeTrailerFrames(LANDING_MANIFEST);

// ── Data ─────────────────────────────────────────────────────

// SCENE_PREVIEWS was the static thumbnail strip behind the hero —
// replaced by the auto-cycling CinematicHeroBackground component
// (components/landing/CinematicHeroBackground.tsx) which sources its
// own scene list. No callers remain.

const COMPARISON = [
  { old: 'Static pages you flip through', new: 'Living scenes — figures breathe, sway, blink, and look around' },
  { old: 'Read-only text and images', new: 'Highlighted characters and objects respond on click' },
  { old: 'Same response no matter which action', new: 'Verb-aware AI — Talk, Fight, Honor, Comfort each feel different' },
  { old: 'No reaction when you click', new: 'Camera dollies, characters pose, sprites flash — keyed to the verb' },
  { old: 'Same experience every time', new: 'AI generates a fresh branch the first time, caches it after' },
  { old: 'Silent or robotic narration', new: 'Sarvam Bulbul shaped per scene mood — sorrow plays slow, battle plays urgent' },
  { old: 'Characters drift between scenes', new: 'Anchor portraits lock every face — same Rama, same Sita, every scene' },
  { old: 'Locked into one art style', new: 'Pick photoreal, storybook, or animation — same story, different aesthetic' },
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

// Steps shown in the "Make your own" stepper. Each maps to a real
// endpoint or page so a visitor can follow them top to bottom and end
// up with a finished movie. Numbers and timing reflect the actual
// generator pipeline (parallel detail/image/audio passes).
const MAKE_YOUR_OWN_STEPS = [
  {
    num: '01',
    title: 'Type any book title',
    desc: 'Mahabharata. Panchatantra. NCERT Science Grade 6. Tenali Raman. The AI plans a 9–12 scene story arc — establish, raise the conflict, follow the rising action, turn, resolve.',
    cta: { label: 'Open the library', href: '/books#create-story' },
    timing: '~10 seconds to plan',
  },
  {
    num: '02',
    title: 'Pick a visual style — engine builds it',
    desc: 'Photoreal Bollywood cinematic, storybook watercolour, or cinematic animation. gpt-4o-mini writes scene narration, hotspots, and a quiz. gpt-image-1 first bakes one canonical portrait per character, then uses it as an anchor so the same Rama, Sita, or Birbal shows up in every scene. Sarvam Bulbul records the narration in a voice the AI picked to match each character.',
    cta: { label: 'See the engine', href: '/books/akbar-and-birbal' },
    timing: '~3 minutes, ~$0.40 in API cost',
  },
  {
    num: '03',
    title: 'Click anywhere',
    desc: 'Highlighted characters and objects speak in their own voice — the LLM picks the archetype at gen time. Tap empty background and the AI checks what hidden detail belongs there. Every click is cached so repeats are instant.',
    cta: { label: 'Try the live reader', href: '/books/akbar-and-birbal' },
    timing: 'first reply ~5s, repeats <100ms',
  },
  {
    num: '04',
    title: 'Watch as a movie',
    desc: 'Same scenes, cinematic cut. Per-scene camera motion, ducked mood music, sentence-timed captions, particles + dust shafts + divine glow per the manifest. Ramayana ships pre-baked; AI books are synthesised live from the same engine.',
    cta: { label: 'Open movie mode', href: '/books/akbar-and-birbal/movie' },
    timing: 'in-browser playback, no wait',
  },
];

// Books currently shippable end-to-end. Ramayana is the curated,
// hand-tuned reference; the rest are real KathaKitaab generations —
// Hand-picked Ramayana beat images for the curated card's background
// cycle. Drawn from the local /public/images set so the card animates
// on first paint without waiting on /api/books. Ordered for emotional
// pacing — establish, drama, resolution.
const RAMAYANA_PREVIEW_IMAGES = [
  '/images/scene_ayodhya_intro_beat_1.png',
  '/images/scene_mithila_bow_beat_1.png',
  '/images/scene_battle_lanka_beat_3.png',
  '/images/scene_return_ayodhya_beat_1.png',
];

// LLM-written narration, gpt-image-1 art, Sarvam-recorded narration,
// stored on Supabase. All play in the live reader and the in-browser
// <Player> on their movie page.
const FEATURED_BOOKS = [
  {
    slug: 'ramayana',
    title: 'Ramayana',
    subtitle: 'Curated · 12 hand-tuned scenes',
    blurb: 'The hand-tuned reference book — 12 photoreal Bollywood-cinematic scenes, 6:46 movie cut, vision-aligned hotspots. The benchmark every generated book is measured against.',
    badge: 'Curated',
    accent: 'rgba(255,153,51,0.55)',
    href: '/books/ramayana',
    movieHref: '/books/ramayana/movie',
  },
  {
    slug: 'mahabharata',
    title: 'Mahabharata',
    subtitle: 'Generated by KathaKitaab',
    blurb: '10 scenes through Kurukshetra. Anchor portraits for Yudhishthira, Krishna, Duryodhana, and Drona keep every face locked across the battlefield.',
    badge: 'Generated · canon-locked',
    accent: 'rgba(255,215,0,0.5)',
    href: '/books/mahabharata',
    movieHref: '/books/mahabharata/movie',
  },
  {
    slug: 'akbar-and-birbal',
    title: 'Akbar and Birbal',
    subtitle: 'Generated by KathaKitaab',
    blurb: '8 scenes of Mughal court wit. Typed in, drafted by the LLM, painted by gpt-image-1, voiced by Sarvam Bulbul. Live reader and movie both work.',
    badge: 'Generated · ~3 min',
    accent: 'rgba(255,215,0,0.45)',
    href: '/books/akbar-and-birbal',
    movieHref: '/books/akbar-and-birbal/movie',
  },
  {
    slug: 'vikram-and-betaal',
    title: 'Vikram and Betaal',
    subtitle: 'Generated by KathaKitaab',
    blurb: '9 multi-beat scenes of riddle-haunted nights. Three painted moments per scene cross-fade as the narration plays — Vikram and Betaal locked by anchor portrait.',
    badge: 'Generated · multi-beat',
    accent: 'rgba(212,168,71,0.5)',
    href: '/books/vikram-and-betaal',
    movieHref: '/books/vikram-and-betaal/movie',
  },
];

// Visual style presets surfaced on the generation form. Pulled from
// the canonical style registry so descriptions stay in sync with the
// actual prompt clauses that ship to gpt-image-1.
//
// previewImages drives the slow Ken-Burns crossfade behind each card
// so visitors see the actual output of the style they're picking,
// not just the label. Photoreal and Comic reuse Ramayana beats we
// already have on disk; watercolour + animation samples are baked
// by scripts/generate-style-samples.ts.
const STYLE_CARDS: Array<{
  preset: StylePreset;
  icon: string;
  bestFor: string[];
  accent: string;
  previewImages: string[];
}> = [
  {
    preset: 'photoreal_cinematic',
    icon: '🎬',
    bestFor: ['Ramayana', 'Mahabharata', 'Historical drama', 'Mythological epics'],
    accent: 'rgba(255,153,51,0.5)',
    previewImages: [
      '/images/scene_ayodhya_intro_beat_1.png',
      '/images/scene_mithila_bow_beat_1.png',
      '/images/scene_battle_lanka_beat_3.png',
      '/images/scene_return_ayodhya_beat_1.png',
    ],
  },
  {
    preset: 'storybook_watercolor',
    icon: '📖',
    bestFor: ['Panchatantra', 'Jataka tales', 'Aesop fables', 'Talking-animal stories', 'Children\'s tales'],
    accent: 'rgba(212,168,71,0.5)',
    previewImages: [
      '/images/style-samples/watercolour/1-court.png',
      '/images/style-samples/watercolour/2-forest.png',
      '/images/style-samples/watercolour/3-battle.png',
      '/images/style-samples/watercolour/4-temple.png',
    ],
  },
  {
    preset: 'cinematic_animation',
    icon: '✨',
    bestFor: ['Adventure tales', 'Fantasy quests', 'Modern reimaginings', 'Anything in between'],
    accent: 'rgba(255,215,0,0.5)',
    previewImages: [
      '/images/style-samples/animation/1-court.png',
      '/images/style-samples/animation/2-forest.png',
      '/images/style-samples/animation/3-battle.png',
      '/images/style-samples/animation/4-temple.png',
    ],
  },
  {
    preset: 'comic_book',
    icon: '💥',
    bestFor: ['Action mythology', 'Superhero retellings', 'Battle epics', 'Anything with punch'],
    accent: 'rgba(231,76,60,0.55)',
    previewImages: [
      '/images/comic/scene_ayodhya_intro_beat_1.png',
      '/images/comic/scene_ravana_jatayu_beat_3.png',
      '/images/comic/scene_hanuman_lanka_beat_1.png',
      '/images/comic/scene_mithila_bow_beat_3.png',
    ],
  },
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

  // Per-card moving backgrounds for the featured-books section.
  // Ramayana ships with known local beat paths so its cards animate
  // on the first paint without an API round-trip. The other three
  // generated books load their first-beat images from /api/books
  // (which now returns previewImages per book). Falls back silently
  // when the fetch fails or a slug has no images yet.
  const [bookPreviews, setBookPreviews] = useState<Record<string, string[]>>({
    ramayana: RAMAYANA_PREVIEW_IMAGES,
  });
  useEffect(() => {
    let cancelled = false;
    fetch('/api/books')
      .then(r => (r.ok ? r.json() : null))
      .then((body: { books?: Array<{ slug: string; previewImages?: string[] }> } | null) => {
        if (!body || cancelled) return;
        const map: Record<string, string[]> = {};
        for (const b of body.books ?? []) {
          if (b.previewImages && b.previewImages.length > 0) {
            map[b.slug] = b.previewImages;
          }
        }
        setBookPreviews(prev => ({ ...prev, ...map }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="lp">
      {/* ── Nav ── */}
      <nav className="lp-nav">
        <Link href="/" className="lp-nav-brand">
          <div className="lp-nav-logo">
            <Image src="/logo.png" alt="KathaKitaab" width={36} height={36} style={{ objectFit: 'contain' }} />
          </div>
          <span className="lp-nav-name">KathaKitaab</span>
        </Link>
        <div className="lp-nav-actions">
          <div className="lp-nav-links">
            <Link href="/books" className="lp-nav-link lp-nav-pill-saffron">Stories</Link>
            <Link href="/educator" className="lp-nav-link lp-nav-pill-white">Studio</Link>
          </div>
          <AuthNavButton next="/books#create-story" compact className="lp-nav-pill-signin" />
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="lp-hero" ref={heroRef}>
        {/* Auto-cycling Ken-Burns scene background — cycles through
            the photoreal Ramayana paintings every 7s with a slow zoom,
            crossfading on transition. Replaces the previous static
            thumbnail strip which was too subtle to read as motion.
            Drifting motes layer on top adds the "divine dust" mood. */}
        <CinematicHeroBackground />
        <DriftingMotes />

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

      {/* ── Dual experience: interactive reader + cinematic movie ──
          Replaces the old "Interactive Demo Preview" + the late
          "Trailer / Movie Mode" section (which sat ~5 sections down).
          Side-by-side under the hero so visitors see both experiences
          on first scroll. */}
      <section className="lp-demo" id="movie-mode" style={{ paddingTop: 32 }}>
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
          <motion.h2 className="lp-section-title" style={{ marginTop: 0 }}>
            Two ways to experience every story
          </motion.h2>
          <p className="lp-section-sub" style={{ maxWidth: 720, margin: '8px auto 0' }}>
            Click into characters and discover hidden details, or watch the whole book play as a cinematic film. One engine, two cuts — same scenes, same Sarvam narration.
          </p>
        </motion.div>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
          gap: 24, maxWidth: 1280, margin: '32px auto 0',
        }}>
          {/* LEFT — interactive reader preview with simulated hotspots */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <div style={{ fontSize: '0.72rem', color: 'var(--color-gold)', textTransform: 'uppercase', letterSpacing: '0.22em' }}>
              Live reader · click to interact
            </div>
            <div className="lp-demo-frame" style={{ marginTop: 0 }}>
              <div className="lp-demo-image" style={{ aspectRatio: '16 / 9' }}>
                <Image src="/images/scene_forest_life.png" alt="Interactive Forest Scene" fill sizes="640px" style={{ objectFit: 'cover' }} priority />
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
            Click any highlighted character or object. Tap the background and the AI surfaces a hidden detail worth knowing.
              </div>
            </div>
            <Link href="/books/ramayana" className="lp-btn-outline" style={{ textDecoration: 'none', alignSelf: 'flex-start', marginTop: 6 }}>
              Open the live reader →
            </Link>
          </motion.div>

          {/* RIGHT — live Remotion Player with trailer/movie toggle */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, delay: 0.08 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10,
            }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-gold)', textTransform: 'uppercase', letterSpacing: '0.22em' }}>
                Cinematic cut · plays in-browser
              </div>
              <div role="tablist" aria-label="Movie preview mode" style={{
                display: 'inline-flex', gap: 4, padding: 3,
                background: 'rgba(12,8,6,0.7)', borderRadius: 999,
                border: '1px solid rgba(255,215,0,0.16)',
              }}>
                {(['trailer', 'movie'] as const).map(key => {
                  const active = moviePreview === key;
                  const label = key === 'trailer'
                    ? `Trailer · ${Math.round(LANDING_TRAILER_FRAMES / TRAILER_FPS)}s`
                    : `Movie · ${Math.round(LANDING_MOVIE_FRAMES / BOOK_MOVIE_FPS / 60)} min`;
                  return (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={active}
                      onClick={() => setMoviePreview(key)}
                      data-testid={`landing-${key}-toggle`}
                      style={{
                        padding: '6px 14px', borderRadius: 999,
                        background: active ? 'linear-gradient(135deg, #FF9933, #FFD700)' : 'transparent',
                        color: active ? '#0C0806' : 'var(--color-gold-light)',
                        border: 'none', cursor: 'pointer',
                        fontSize: '0.74rem', fontWeight: 700, letterSpacing: 0.3,
                        transition: 'background 0.2s ease, color 0.2s ease',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="lp-trailer-wrap" style={{ marginTop: 0 }}>
              {moviePreview === 'trailer' ? (
                <Player
                  key="dual-trailer"
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
                  key="dual-movie"
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
            </div>
            <Link href="/books/ramayana/movie" className="lp-btn-primary" style={{ textDecoration: 'none', alignSelf: 'flex-start', marginTop: 6 }}>
              Open movie mode <span className="lp-btn-arrow">{'→'}</span>
            </Link>
          </motion.div>
        </div>
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
            <span className="lp-compare-new-h">KathaKitaab</span>
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

      {/* ── What's inside every book — capability pills ──
          The old movie section was the home of these bullets. Now
          that the Player lives in the dual-experience block above,
          this small ribbon stays as the proof-of-engine moment. */}
      <section className="lp-worlds" style={{ paddingTop: 32, paddingBottom: 32 }}>
        <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} style={{ textAlign: 'center', marginBottom: 22 }}>
          <span className="lp-hero-badge">
            <span className="lp-hero-badge-dot" />
            What lives inside every book + movie
          </span>
        </motion.div>
        <ul style={{
          display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap',
          margin: '0 auto', padding: 0, listStyle: 'none', maxWidth: 1080,
        }}>
          {[
            ['🎥', 'Per-scene motion — battle push, divine glow, slow pan'],
            ['🌬️', 'Ambient idle — figures breathe, sway, blink, look around'],
            ['🎭', 'Puppet states — Talk speeds breath, Fight quickens sway'],
            ['🗣️', 'Emotional Sarvam narration — pace + pitch shaped per mood'],
            ['💬', 'Sentence cues with explicit ms timing in the manifest'],
            ['🎼', 'Procedural mood bed, ducked to 0.10 under speech'],
            ['✨', 'Universal effects DSL — particles, dust shafts, fog, rim light'],
            ['👁', 'Audio-driven mouth pulse + geometric gaze toward addressees'],
            ['🛡️', 'Verb-aware QA — Talk, Fight, Honor each feel distinct'],
            ['📥', 'Downloadable MP4 export — coming soon'],
          ].map(([icon, text]) => (
            <li key={text} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '7px 13px', borderRadius: 999,
              background: 'rgba(43,27,21,0.6)', border: '1px solid rgba(255,215,0,0.12)',
              fontSize: '0.8rem', color: 'var(--color-gold-light)',
            }}>
              <span aria-hidden>{icon}</span>{text}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Visual style presets ── */}
      <section className="lp-worlds" id="visual-styles">
        <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} style={{ textAlign: 'center', marginBottom: 28 }}>
          <span className="lp-hero-badge">
            <span className="lp-hero-badge-dot" />
            New · Pick the aesthetic, lock the cast
          </span>
          <h2 className="lp-section-title" style={{ marginTop: 14 }}>
            Four visual styles. One consistent cast.
          </h2>
          <p className="lp-section-sub" style={{ maxWidth: 780, margin: '12px auto 0' }}>
            Pick a style at generation time. Whichever you choose, every scene image
            is anchored to a canonical portrait of each character — Rama looks like the
            same Rama in scene 1 and scene 12. Comic books even talk: in-frame speech
            bubbles, narrator captions, shout starbursts — typed in as the narration
            plays. Style and accuracy are decoupled by design.
          </p>
        </motion.div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 18, maxWidth: 1100, margin: '0 auto',
        }}>
          {STYLE_CARDS.map((card, i) => {
            const meta = STYLE_PRESETS[card.preset];
            return (
              <motion.div
                key={card.preset}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  padding: 22, borderRadius: 16,
                  background: 'rgba(43,27,21,0.55)',
                  border: `1px solid ${card.accent}`,
                  boxShadow: `0 14px 50px rgba(0,0,0,0.4), 0 0 0 1px ${card.accent} inset`,
                  display: 'flex', flexDirection: 'column', gap: 12,
                  minHeight: 320,
                }}
              >
                <BookCardBackground images={card.previewImages} accent={card.accent} />
                {/* Lift content above the moving background. */}
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: '1.6rem' }} aria-hidden>{card.icon}</span>
                    <h3 className="font-serif" style={{
                      fontSize: '1.25rem', color: 'var(--color-gold-light)', margin: 0,
                      textShadow: '0 2px 12px rgba(0,0,0,0.85)',
                    }}>
                      {meta.label}
                    </h3>
                  </div>
                  <p style={{
                    color: 'rgba(232,219,196,0.92)', margin: 0, fontSize: '0.88rem', lineHeight: 1.55,
                    textShadow: '0 1px 8px rgba(0,0,0,0.85)',
                  }}>
                    {meta.description}
                  </p>
                  <div style={{
                    fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 1.4,
                    color: 'var(--color-gold)', marginTop: 4,
                    textShadow: '0 1px 6px rgba(0,0,0,0.8)',
                  }}>
                    Best for
                  </div>
                  <ul style={{
                    margin: 0, paddingLeft: 18,
                    color: 'rgba(232,219,196,0.88)', fontSize: '0.82rem', lineHeight: 1.7,
                    textShadow: '0 1px 6px rgba(0,0,0,0.8)',
                  }}>
                    {card.bestFor.map(b => <li key={b}>{b}</li>)}
                  </ul>
                </div>
              </motion.div>
            );
          })}
        </div>
        <div style={{ textAlign: 'center', marginTop: 26 }}>
          <Link href="/books#create-story" className="lp-btn-primary" style={{ textDecoration: 'none' }}>
            <span>Try the styles</span><span className="lp-btn-arrow">{'→'}</span>
          </Link>
        </div>
      </section>

      {/* ── Featured books — what's actually generated ── */}
      <section className="lp-worlds" id="featured-books" style={{ paddingBottom: 0 }}>
        <motion.h2 className="lp-section-title" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
          Live in the engine right now
        </motion.h2>
        <p className="lp-section-sub">
          One curated, three generated end-to-end by KathaKitaab from a typed title.
          All four read interactively. All four play as a cinematic cut in the browser.
        </p>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 22, maxWidth: 1100, margin: '32px auto 0',
        }}>
          {FEATURED_BOOKS.map((b, i) => {
            const previews = bookPreviews[b.slug] ?? [];
            return (
              <motion.div
                key={b.slug}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  padding: 24, borderRadius: 16,
                  background: 'rgba(43,27,21,0.55)',
                  border: `1px solid ${b.accent}`,
                  boxShadow: `0 18px 60px rgba(0,0,0,0.45), 0 0 0 1px ${b.accent} inset`,
                  display: 'flex', flexDirection: 'column', gap: 14,
                  minHeight: 320,
                }}
              >
                <BookCardBackground images={previews} accent={b.accent} />
                {/* Lift card content above the moving background. */}
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{
                      fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: 2,
                      padding: '4px 10px', borderRadius: 999,
                      background: b.accent.replace('0.5', '0.28'), color: 'var(--color-gold-light)',
                      backdropFilter: 'blur(6px)',
                    }}>{b.badge}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--color-text-dim)' }}>{b.subtitle}</span>
                  </div>
                  <h3 className="font-serif" style={{
                    fontSize: '1.6rem', color: 'var(--color-gold-light)', margin: 0,
                    textShadow: '0 2px 12px rgba(0,0,0,0.85)',
                  }}>
                    {b.title}
                  </h3>
                  <p style={{
                    color: 'rgba(232,219,196,0.92)', margin: 0, fontSize: '0.92rem', lineHeight: 1.6,
                    textShadow: '0 1px 8px rgba(0,0,0,0.85)',
                  }}>
                    {b.blurb}
                  </p>
                  <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 6, flexWrap: 'wrap' }}>
                    <Link href={b.href} className="lp-btn-primary" style={{ textDecoration: 'none', flex: '1 1 140px' }}>
                      <span>Read</span><span className="lp-btn-arrow">{'→'}</span>
                    </Link>
                    <Link href={b.movieHref} className="lp-btn-outline" style={{ textDecoration: 'none', flex: '1 1 140px' }}>
                      Watch
                    </Link>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* ── How to make your own ── */}
      <section className="lp-steps" style={{ paddingTop: 80 }}>
        <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} style={{ textAlign: 'center', marginBottom: 32 }}>
          <span className="lp-hero-badge">
            <span className="lp-hero-badge-dot" />
            From a typed title to a finished movie
          </span>
          <h2 className="lp-section-title" style={{ marginTop: 16 }}>
            Make your own in four steps
          </h2>
          <p className="lp-section-sub" style={{ maxWidth: 760, margin: '10px auto 0' }}>
            Same pipeline that produced Akbar and Birbal above. Each step links straight to the part
            of the engine that handles it — read top to bottom and you&apos;ll have a movie of your own
            in about three minutes.
          </p>
        </motion.div>
        <div className="lp-steps-grid">
          {MAKE_YOUR_OWN_STEPS.map((step, i) => (
            <motion.div
              key={step.num}
              className="lp-step"
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.5 }}
            >
              <span className="lp-step-num">{step.num}</span>
              <div style={{ flex: 1 }}>
                <h3 className="lp-step-title">{step.title}</h3>
                <p className="lp-step-desc">{step.desc}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 12 }}>
                  <Link href={step.cta.href} className="lp-btn-outline" style={{ textDecoration: 'none', fontSize: '0.78rem', padding: '6px 14px' }}>
                    {step.cta.label} →
                  </Link>
                  <span style={{ fontSize: '0.74rem', color: 'var(--color-text-dim)' }}>{step.timing}</span>
                </div>
              </div>
            </motion.div>
          ))}
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
            <Image src="/logo.png" alt="Logo" width={24} height={24} style={{ objectFit: 'contain' }} />
            <span>KathaKitaab</span>
          </div>
          <p className="lp-footer-text">Not a Flipbook. A Living Story Engine. &copy; 2026</p>
        </div>
      </footer>
    </main>
  );
}
