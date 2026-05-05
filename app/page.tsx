'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { useRef } from 'react';
import { Player } from '@remotion/player';
import { RamayanaMovie, RAMAYANA_MOVIE_DURATION, RAMAYANA_MOVIE_FPS } from '@/remotion/RamayanaMovie';

// ── Data ─────────────────────────────────────────────────────

const SCENE_PREVIEWS = [
  { src: '/images/scene_ayodhya_intro.png', label: 'Ayodhya' },
  { src: '/images/scene_mithila_bow.png', label: 'The Bow' },
  { src: '/images/scene_forest_life.png', label: 'Forest' },
  { src: '/images/scene_battle_lanka.png', label: 'Battle' },
  { src: '/images/scene_return_ayodhya.png', label: 'Return' },
];

const COMPARISON = [
  { old: 'Static pages you flip through', new: 'Living scenes you explore' },
  { old: 'Read-only text and images', new: 'Click any character or object' },
  { old: 'Same experience every time', new: 'AI generates new branches on every click' },
  { old: 'Silent pages', new: 'Every scene narrated with cinematic voice' },
  { old: 'One linear path', new: 'Story graph with hidden discoveries' },
];

const STEPS = [
  { num: '01', title: 'A scene appears', desc: 'AI-generated cinematic illustration with ambient music and auto-narration.' },
  { num: '02', title: 'Click anything', desc: 'Characters, objects, paths, rivers — every meaningful element responds.' },
  { num: '03', title: 'AI generates a branch', desc: 'New dialogue, close-up, hidden detail, or entire new scene with its own image.' },
  { num: '04', title: 'Keep exploring', desc: 'Every click deepens the story. Branches are cached. The world remembers.' },
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
              Click any character. Ask any object. Explore any path.<br />
              AI generates new scenes, narration, and images — in real time.
            </p>

            <div className="lp-hero-ctas">
              <Link href="/books/ramayana" className="lp-btn-primary">
                <span>Enter the Ramayana</span>
                <span className="lp-btn-arrow">{'\u2192'}</span>
              </Link>
              <Link href="/books#create-story" className="lp-btn-outline">Create Your Own Book</Link>
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
          <p className="lp-section-sub">Every scene is a living world. Click anywhere meaningful — the AI responds.</p>
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

      {/* ── Trailer ── */}
      <section className="lp-trailer">
        <motion.h2 className="lp-section-title" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
          Watch the Trailer
        </motion.h2>
        <motion.div
          className="lp-trailer-wrap"
          initial={{ opacity: 0, scale: 0.97 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          {/* Live Remotion composition — narration streams from Supabase
              Storage CDN, scene art is static, frames render in-browser.
              No pre-baked MP4: the same engine that runs the in-app reader
              renders the trailer. */}
          <Player
            component={RamayanaMovie}
            durationInFrames={RAMAYANA_MOVIE_DURATION}
            fps={RAMAYANA_MOVIE_FPS}
            compositionWidth={1920}
            compositionHeight={1080}
            // Park the playhead 1s into the title card so the spring
            // animation has settled — visitors see "The Ramayana"
            // branding, not a half-faded red gradient.
            initialFrame={30}
            controls
            clickToPlay
            doubleClickToFullscreen
            style={{ width: '100%', aspectRatio: '16 / 9', display: 'block', background: '#0C0806', borderRadius: 'inherit' }}
          />
        </motion.div>
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
