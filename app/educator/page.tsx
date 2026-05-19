'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import StudioModeSelector from '@/components/library/StudioModeSelector';
import { AuthNavButton } from '@/components/auth/AuthNavButton';

// Theme starting points the universal generator handles cleanly.
// Each chip pre-fills the title input — clicking it doesn't bypass
// the form, so the user still sees the generation pipeline run.
const STARTING_POINTS: { label: string; example: string }[] = [
  { label: 'Mahabharata',          example: 'Mahabharata — Key Moments' },
  { label: 'Panchatantra',         example: 'Panchatantra Stories' },
  { label: 'Akbar and Birbal',     example: 'Akbar and Birbal Stories' },
  { label: 'Tenali Raman',         example: 'Tenali Raman' },
  { label: 'Jataka Tales',         example: 'Jataka Tales' },
  { label: 'Vikram and Betaal',    example: 'Vikram and Betaal' },
  { label: 'Indian History',       example: 'Indian History — Ancient Kingdoms' },
  { label: 'Buddha Stories',       example: 'Stories from the Life of Buddha' },
];

// Real pipeline phases — these match what bookGeneratorAgent.ts
// actually does, and what the README describes. The earlier
// "Agent Swarm" copy implied OpenAI Agents SDK with 6+ named
// agents; the engine doesn't use that framework. These four are
// the real concurrent phases the user's title goes through.
const PIPELINE_PHASES = [
  { num: '1', title: 'Outline + characters', desc: 'gpt-4o-mini drafts a 9–12 scene arc and assigns each character a voice archetype.' },
  { num: '2', title: 'Scene details',         desc: 'Per-scene narration, hotspot positions, quiz questions, and camera motion. Concurrency 4.' },
  { num: '3', title: 'Scene images',          desc: 'gpt-image-1 paints each scene at 1536×1024. Concurrency 3.' },
  { num: '4', title: 'Scene narration',       desc: 'Sarvam Bulbul records each scene shaped to its mood. Concurrency 6.' },
];

export default function EducatorPage() {
  return (
    <main style={{ minHeight: '100vh', padding: '80px 24px 60px' }}>
      {/* Nav */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40,
        padding: '14px 24px',
        background: 'rgba(12,8,6,0.92)', backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(212,168,71,0.1)',
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '1.3rem' }}>📚</span>
          <span style={{ fontWeight: 800, fontSize: '1.1rem', background: 'linear-gradient(135deg, #E8832A, #D4A847)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            KathaKitaab
          </span>
        </Link>
        <span style={{ color: 'var(--color-text-dim)', fontSize: '0.9rem' }}>/ Studio</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/books" style={{ color: 'var(--color-gold-light)', fontSize: '0.88rem', textDecoration: 'none' }}>
            Stories
          </Link>
          <span style={{ color: 'var(--color-gold)', fontSize: '0.85rem', fontWeight: 600 }}>Studio</span>
          <AuthNavButton next="/educator" compact />
        </div>
      </nav>

      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        {/* Header — honest, narrow, no fake stats */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="font-serif" style={{
            fontSize: 'clamp(1.8rem, 3.5vw, 2.5rem)', fontWeight: 800,
            color: 'var(--color-gold-light)', margin: 0,
          }}>
            KathaKitaab Studio
          </h1>
          <p style={{ color: 'var(--color-text-dim)', fontSize: '1rem', margin: '8px 0 0', maxWidth: 640, lineHeight: 1.6 }}>
            Create playable AI storybooks from Indian epics, folktales, and story worlds. Type a title — the engine
            writes the scenes, paints the art, and records the narration. About three minutes end to end.
          </p>
        </motion.div>

        {/* Generation forms — world and personalized modes. World mode
            is the default (it's what most visitors want). */}
        <div style={{ marginTop: 32 }}>
          <StudioModeSelector />
        </div>

        {/* Starting points — chips fill the input above instead of routing
            elsewhere, so the user still sees the generation flow. */}
        <h2 style={{
          fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text-dim)',
          textTransform: 'uppercase', letterSpacing: 2, margin: '32px 0 14px',
        }}>
          Starting points
        </h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {STARTING_POINTS.map((p, i) => (
            <motion.a
              key={p.label}
              href={`#create-story?prefill=${encodeURIComponent(p.example)}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 * i }}
              onClick={(e) => {
                // Pre-fill the BookGenerator input by dispatching a custom
                // event the form listens for. Falls back to the URL hash
                // so deep-linking still works.
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('katha:prefill-title', { detail: p.example }));
                document.getElementById('create-story')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              style={{
                textDecoration: 'none',
                padding: '7px 14px', borderRadius: 999,
                background: 'rgba(212,168,71,0.08)',
                border: '1px solid rgba(212,168,71,0.22)',
                color: 'var(--color-gold-light)', fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              {p.label}
            </motion.a>
          ))}
        </div>


        {/* How the engine actually builds your book — replaces the old
            "Agent Swarm" diagram. Names match the real concurrent
            phases in lib/openai/bookGeneratorAgent.ts and the README. */}
        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
          className="glass-card" style={{ marginTop: 40, padding: 32, borderTop: '2px solid rgba(212,168,71,0.2)' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-gold-light)', marginBottom: 6 }}>
            How KathaKitaab builds your book
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-dim)', marginBottom: 22, lineHeight: 1.55, maxWidth: 600 }}>
            Four concurrent phases inside one Vercel function. About 25 seconds for the outline, two to three minutes for the art, ten seconds for the narration — running in parallel.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {PIPELINE_PHASES.map(p => (
              <div key={p.num} style={{
                padding: '14px 16px', borderRadius: 12,
                background: 'rgba(12,8,6,0.55)',
                border: '1px solid rgba(255,215,0,0.08)',
              }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--color-saffron)', marginBottom: 6 }}>
                  Phase {p.num}
                </div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-gold-light)', marginBottom: 4 }}>
                  {p.title}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-dim)', lineHeight: 1.55 }}>
                  {p.desc}
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: '0.74rem', color: 'var(--color-text-dim)', marginTop: 18, fontStyle: 'italic' }}>
            These are concurrent functions, not OpenAI Agents SDK instances — the README documents this honestly.
          </p>
        </motion.div>
      </div>
    </main>
  );
}
