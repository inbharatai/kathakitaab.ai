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
import StoryRail from '@/components/library/StoryRail';
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
  { old: 'Fixed stories', new: 'Generates new stories from prompts' },
  { old: 'Static pages', new: 'Interactive living scenes' },
  { old: 'One-way reading', new: 'Highlighted characters and objects respond on click' },
  { old: 'Random images', new: 'Consistent character identity across scenes' },
  { old: 'Text only', new: 'Story, images, narration, subtitles, quiz, and movie' },
  { old: 'Video only', new: 'Book + interactive reader + movie mode' },
  { old: 'Same path every read', new: 'AI generates a fresh branch the first time, caches it after' },
  { old: 'Made by creators only', new: 'Created by anyone using prompts' },
];

const AUDIENCE_CARDS = [
  {
    icon: '🎓',
    title: 'For Students',
    desc: 'Turn lessons, chapters, and concepts into visual stories, narrated explainers, and interactive learning books.',
  },
  {
    icon: '🏠',
    title: 'For Parents',
    desc: 'Create safe, engaging, illustrated stories for children in minutes.',
  },
  {
    icon: '🍎',
    title: 'For Teachers',
    desc: 'Convert topics into story-based lessons with narration, scenes, questions, and visual explanations.',
  },
  {
    icon: '✨',
    title: 'For Creators',
    desc: 'Generate mythology, fantasy, history, anime, manga, comic, and educational story videos from prompts.',
  },
  {
    icon: '🇮🇳',
    title: "For India's Stories",
    desc: 'Bring Ramayana, Mahabharata, Panchatantra, Assam history, folk tales, and local stories into interactive AI format.',
  },
];

const STEPS = [
  { num: '01', title: 'Type your idea', desc: 'Enter a title, topic, lesson, mythological story, history chapter, fantasy idea, or educational concept. The AI understands what you want.' },
  { num: '02', title: 'AI plans the story', desc: 'The agent creates the story arc, scenes, characters, narration, clickable hotspots, and learning questions — all from one prompt.' },
  { num: '03', title: 'Choose a visual style', desc: 'Pick cinematic, storybook, comic, anime/manga, or animation style. The same character face is locked across every scene by anchor portraits.' },
  { num: '04', title: 'Experience the living book', desc: 'Read it interactively, click characters and objects, discover hidden details, and answer questions. Every click is cached so repeats are instant.' },
  { num: '05', title: 'Watch it as a movie', desc: 'The same story becomes a cinematic narrated video experience — per-scene camera motion, sentence-timed captions, mood music, and effects.' },
];

const SUPPORTED_WORLDS = [
  'Ramayana', 'Mahabharata', 'Panchatantra', 'Shiva Stories', 'Buddha Tales',
  'Indian History', 'Fantasy', 'Sci-Fi', 'Anime Adventure', 'Manga Quest', 'Kids Stories', 'Education', 'Biography', 'Any Title You Type',
];

// Steps shown in the "Make your own" stepper. Each maps to a real
// endpoint or page so a visitor can follow them top to bottom and end
// up with a finished movie. Numbers and timing reflect the actual
// generator pipeline (parallel detail/image/audio passes).
const MAKE_YOUR_OWN_STEPS = [
  {
    num: '01',
    title: 'Type any idea',
    desc: 'Mahabharata. Panchatantra. NCERT Science Grade 6. Tenali Raman. A fantasy world. The AI plans a complete story arc — establish, raise the conflict, follow the rising action, turn, resolve.',
    cta: { label: 'Create a story', href: '/books#create-story' },
    timing: '~10 seconds to plan',
  },
  {
    num: '02',
    title: 'Pick a style — the engine builds everything',
    desc: 'Choose photoreal cinematic, storybook watercolour, cinematic animation, comic book, or anime/manga. The AI writes scene narration, generates illustrations, creates clickable hotspots, and records voice narration — all with consistent character faces across every scene.',
    cta: { label: 'See an example', href: '/books/ramayana' },
    timing: '~3 minutes to generate',
  },
  {
    num: '03',
    title: 'Explore the living book',
    desc: 'Click highlighted characters and objects. The AI responds with hidden details, backstory, and lore. Tap anywhere on the background and the AI discovers what belongs there. Every interaction is cached so repeats are instant.',
    cta: { label: 'Try the reader', href: '/books/ramayana' },
    timing: 'first reply ~5s, repeats <100ms',
  },
  {
    num: '04',
    title: 'Watch it as a movie',
    desc: 'The same scenes become a cinematic narrated video — per-scene camera motion, sentence-timed captions, mood music, and particle effects. Play the trailer or the full movie, entirely in-browser.',
    cta: { label: 'Open movie mode', href: '/books/ramayana/movie' },
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

// Hand-curated Ramayana showcase. Ramayana is the only curated,
// hand-tuned reference book currently live; the earlier generated
// showcase books (Mahabharata, Akbar & Birbal, Vikram & Betaal) lived
// in Supabase and were removed with the Supabase decommission — they'll
// be regenerated fresh later. Pointing the landing cards at dead slugs
// would 404, so only Ramayana is featured. Generated books users make
// appear in /books and on their own story pages.
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
    coverImage: '/images/scene_ayodhya_intro.png',
  },
];

// Visual style presets surfaced on the generation form. Pulled from
// the canonical style registry so descriptions stay in sync with the
// actual prompt clauses that drive the visual style.
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
  {
    preset: 'anime_manga',
    icon: '🌸',
    bestFor: ['Teen adventures', 'Fantasy quests', 'Sci-fi stories', 'Superhero retellings', 'Action mythology', 'Emotional character journeys'],
    accent: 'rgba(255,105,180,0.5)',
    previewImages: [
      '/images/styles/anime-manga/ramayana-anime.png',
      '/images/styles/anime-manga/hanuman-anime.png',
      '/images/styles/anime-manga/mahabharata-anime.png',
      '/images/styles/anime-manga/maharana-pratap-anime.png',
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
              AI Story & Video Creation Engine
            </div>

            <h1 className="lp-hero-h1">
              Turn Any Prompt Into a<br /><span className="gradient-tricolor">Living Storybook and AI Movie</span>
            </h1>

            <p className="lp-hero-sub font-serif">
              KathaKitaab is an AI agentic creation engine that plans the story arc,
              generates illustrated scenes with highlighted characters and objects that
              respond on click, records narration, and creates a cinematic movie — all
              from one typed prompt.
            </p>

            <div className="lp-hero-ctas">
              <Link href="/books#create-story" className="lp-btn-primary">
                <span>Create a Story</span>
                <span className="lp-btn-arrow">{'\u2192'}</span>
              </Link>
              <Link href="/books/ramayana/movie" className="lp-btn-outline">Watch Demo</Link>
            </div>

            <p className="lp-hero-hint">Explore the demo instantly. Create full AI-powered books and movies from your own prompts.</p>
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
            Three ways to experience every story
          </motion.h2>
          <p className="lp-section-sub" style={{ maxWidth: 760, margin: '8px auto 0' }}>
            Click into characters and discover hidden details, watch the whole book play as a cinematic film, or walk a tiny living world and carry the story forward yourself. One story, three experiences — same scenes, same narrated voices.
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
            Highlighted characters and objects respond on click. Tap the background and the AI surfaces a hidden detail worth knowing.
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

          {/* FAR RIGHT — Living World: a tiny explorable planet */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, delay: 0.16 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <div style={{ fontSize: '0.72rem', color: 'var(--color-gold)', textTransform: 'uppercase', letterSpacing: '0.22em' }}>
              Living world · walk it yourself
            </div>
            <div className="lp-demo-frame" style={{ marginTop: 0 }}>
              <div
                className="lp-demo-image"
                style={{
                  aspectRatio: '16 / 9',
                  background: 'radial-gradient(circle at 50% 22%, #2d1b3a 0%, #1a1023 52%, #0c0813 88%)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
                aria-label="Preview of a tiny explorable story world"
              >
                {/* tiny planet rim */}
                <div style={{
                  position: 'absolute', left: '50%', top: '58%', width: 320, height: 320,
                  transform: 'translate(-50%, -50%)', borderRadius: '50%',
                  background: 'radial-gradient(circle at 42% 38%, #3a2a4a, #1c1226 70%, #120b1a)',
                  boxShadow: 'inset 0 0 60px rgba(0,0,0,0.55), 0 0 50px rgba(195,155,211,0.18)',
                }} />
                {/* scene nodes spiralling outward */}
                {[
                  { left: '50%', top: '58%', e: '🪔', label: 'Ayodhya' },
                  { left: '38%', top: '50%', e: '🏹', label: 'Mithila' },
                  { left: '63%', top: '47%', e: '🌿', label: 'Forest' },
                  { left: '44%', top: '70%', e: '🔥', label: 'Lanka' },
                  { left: '60%', top: '72%', e: '🌀', label: 'Portal' },
                ].map((n, i) => (
                  <div key={i} style={{
                    position: 'absolute', left: n.left, top: n.top, transform: 'translate(-50%, -50%)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  }}>
                    <span style={{ fontSize: '1.5rem', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.6))' }}>{n.e}</span>
                    <span style={{ fontSize: '0.6rem', color: 'var(--color-gold-light)', letterSpacing: 0.4 }}>{n.label}</span>
                  </div>
                ))}
                {/* courier avatar */}
                <div style={{
                  position: 'absolute', left: '52%', top: '60%', transform: 'translate(-50%, -50%)',
                  fontSize: '1.1rem', filter: 'drop-shadow(0 0 6px rgba(255,153,51,0.7))',
                }}>🧑‍🚀</div>
              </div>
              <div className="lp-demo-caption">
                <span className="lp-demo-caption-icon">{'🧿'}</span>
            A small living planet you cross in one sitting. Carry each scene&rsquo;s story fragment to the glowing portal, unlock the next place, meet its people, and find clues along the way.
              </div>
            </div>
            <Link href="/world/ramayana" className="lp-btn-outline" style={{ textDecoration: 'none', alignSelf: 'flex-start', marginTop: 6 }}>
              Walk the living world →
            </Link>
          </motion.div>
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

      {/* ── Visual style presets ── */}
      <section className="lp-worlds" id="visual-styles">
        <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} style={{ textAlign: 'center', marginBottom: 28 }}>
          <span className="lp-hero-badge">
            <span className="lp-hero-badge-dot" />
            New · Pick the aesthetic, lock the cast
          </span>
          <h2 className="lp-section-title" style={{ marginTop: 14 }}>
            Five visual styles. One consistent cast.
          </h2>
          <p className="lp-section-sub" style={{ maxWidth: 780, margin: '12px auto 0' }}>
            Pick a style at generation time. Whichever you choose, every scene image
            is anchored to a canonical portrait of each character — the same face in scene 1 and scene 12.
            Comic books even talk: in-frame speech bubbles, narrator captions, shout starbursts.
            Anime brings expressive emotion, dynamic action poses, and manga energy.
            Style and accuracy are decoupled by design.
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

      {/* ── Featured books — always show all 4, with real images when
          available and honest placeholders when missing from Redis. ── */}
      <section className="lp-worlds" id="featured-books" style={{ paddingBottom: 0 }}>
        <motion.h2 className="lp-section-title" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
          Live in the engine right now
        </motion.h2>
        <p className="lp-section-sub">
          One curated showcase and AI-generated stories built end-to-end from a typed title.
          Every book reads interactively and plays as a cinematic cut in the browser.
        </p>
        <StoryRail
          title=""
          items={FEATURED_BOOKS.map(b => {
            const existsInRedis = (bookPreviews[b.slug]?.length ?? 0) > 0;
            return {
              slug: b.slug,
              title: b.title,
              subtitle: b.subtitle,
              // Real images from API; nothing when missing so the card
              // renders its icon fallback honestly.
              coverImage: bookPreviews[b.slug]?.[0],
              previewImages: bookPreviews[b.slug] ?? [],
              hasMovie: existsInRedis,
              badge: existsInRedis ? b.badge : 'Generate',
              accuracyLabel: b.slug === 'ramayana' ? 'CANONICAL' : undefined,
            };
          })}
          linkMode="read"
        />

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

      {/* ── How It Works ── */}
      <section className="lp-steps">
        <motion.h2 className="lp-section-title" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
          How the Engine Works
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
          Not Just Stories. A Creation Engine.
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

      {/* ── Audience cards ── */}
      <section className="lp-worlds" id="audience" style={{ paddingTop: 48 }}>
        <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} style={{ textAlign: 'center', marginBottom: 32 }}>
          <span className="lp-hero-badge">
            <span className="lp-hero-badge-dot" />
            Who is it for?
          </span>
          <p className="lp-section-sub" style={{ maxWidth: 720, margin: '16px auto 0' }}>
            Built for anyone who wants to turn knowledge, mythology, or imagination into an interactive experience.
          </p>
        </motion.div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 18, maxWidth: 1100, margin: '0 auto',
        }}>
          {AUDIENCE_CARDS.map((card, i) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06, duration: 0.5 }}
              style={{
                padding: 22, borderRadius: 14,
                background: 'rgba(43,27,21,0.55)', border: '1px solid rgba(255,215,0,0.12)',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}
            >
              <span style={{ fontSize: '1.6rem' }} aria-hidden>{card.icon}</span>
              <h3 className="font-serif" style={{ fontSize: '1.1rem', color: 'var(--color-gold-light)', margin: 0 }}>{card.title}</h3>
              <p style={{ color: 'rgba(232,219,196,0.88)', margin: 0, fontSize: '0.85rem', lineHeight: 1.55 }}>{card.desc}</p>
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
            ['🗣️', 'Emotional narration — pace + pitch shaped per mood'],
            ['💬', 'Sentence cues with explicit ms timing in the manifest'],
            ['🎼', 'Static mood bed (6 pre-synthesized WAVs), auto-ducked under narration'],
            ['✨', 'Universal effects DSL — particles, dust shafts, fog, rim light'],
            ['👁', 'Audio-driven mouth pulse + geometric gaze toward addressees'],
            ['🛡️', 'Verb-aware QA — Talk, Fight, Honor each feel distinct'],
            ['📥', 'MP4 export — opt-in via KATHA_MP4_EXPORT_ENABLED=1'],
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

      {/* ── What the World engine does / does not do (honest rail) ──
          Pure text — no art. Sets honest expectations for the Living
          World mode so the landing never overstates capability. */}
      <section className="lp-worlds" style={{ paddingTop: 8, paddingBottom: 40 }}>
        <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} style={{ textAlign: 'center', marginBottom: 22 }}>
          <span className="lp-hero-badge">
            <span className="lp-hero-badge-dot" />
            The World engine — honestly
          </span>
        </motion.div>
        <div style={{
          maxWidth: 760, margin: '0 auto', padding: '24px 28px',
          borderRadius: 16,
          background: 'rgba(26,18,12,0.55)',
          border: '1px solid rgba(255,215,0,0.10)',
        }}>
          <p style={{ color: 'var(--color-gold-light)', fontSize: '0.85rem', lineHeight: 1.6, margin: 0 }}>
            <strong style={{ color: 'var(--color-gold)' }}>What it does:</strong>{' '}
            a walkable 3D planet you cross in one sitting, with real scene art on
            each destination, canon-accurate NPCs that migrate as you unlock the
            story, character portraits (where available), and a courier loop that
            carries each scene&rsquo;s fragment to the next portal.
          </p>
          <p style={{ color: 'rgba(232,219,196,0.68)', fontSize: '0.85rem', lineHeight: 1.6, margin: '12px 0 0' }}>
            <strong style={{ color: 'var(--color-gold-light)' }}>What it does not do (yet):</strong>{' '}
            ambient audio is opt-in (<code style={{ fontSize: '0.78rem' }}>KATHA_WORLD_AUDIO=1</code>) and
            not on by default. NPC replies are deterministic by default; in-character LLM dialogue is
            an opt-in (configure an AI narration key). There is no
            multiplayer. There is no licensed soundtrack — every sound is procedural or absent.
          </p>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="lp-final-cta">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          <h2 className="lp-final-h2">Ready to turn your idea into a story?</h2>
          <p className="lp-final-sub">Type a prompt. The engine plans the arc, illustrates the scenes, and builds the movie. Your story, your style, your cast - created in minutes.</p>
          <div className="lp-hero-ctas">
            <Link href="/books#create-story" className="lp-btn-primary">
              <span>Create a Story</span>
              <span className="lp-btn-arrow">{'\u2192'}</span>
            </Link>
            <Link href="/books/ramayana/movie" className="lp-btn-outline">Watch Demo</Link>
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
