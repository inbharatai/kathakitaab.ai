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

const AGENT_FLOW = [
  {
    num: '1', title: 'Story Architect',
    desc: 'Understands the user prompt, builds the plot, decides the story arc, and creates the chapter or scene structure.',
  },
  {
    num: '2', title: 'Character Keeper',
    desc: 'Creates the main characters, remembers their look, personality, role, and keeps them consistent across scenes.',
  },
  {
    num: '3', title: 'Scene Director',
    desc: 'Breaks the story into cinematic scenes with narration, emotions, camera movement, and visual instructions.',
  },
  {
    num: '4', title: 'Art & World Builder',
    desc: 'Generates the visual world of the story — characters, places, backgrounds, mood, and scene illustrations.',
  },
  {
    num: '5', title: 'Narration & Voice Agent',
    desc: 'Turns the story into spoken narration with mood, pacing, and child-friendly storytelling flow.',
  },
  {
    num: '6', title: 'Interaction Agent',
    desc: 'Adds hotspots, choices, questions, activities, and learning moments so the book becomes interactive.',
  },
  {
    num: '7', title: 'Movie & Book Assembler',
    desc: 'Combines scenes, images, narration, subtitles, and interactions into a playable storybook or movie format.',
  },
  {
    num: '8', title: 'Quality Guard',
    desc: 'Checks consistency, missing scenes, broken assets, unsafe content, and final user experience before delivery.',
  },
];

const FLOW_STEPS = ['Prompt', 'Story', 'Characters', 'Scenes', 'Art', 'Voice', 'Interaction', 'Book/Movie'];

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


        {/* How KathaKitaab works — public-facing agent flow. No backend
            implementation details, no model names, no provider names. */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="glass-card"
          style={{
            marginTop: 32,
            padding: '28px 20px 32px',
            borderTop: '2px solid rgba(212,168,71,0.2)',
            borderRadius: 16,
          }}
        >
          <h2 style={{
            fontSize: 'clamp(1.05rem, 2.5vw, 1.25rem)',
            fontWeight: 700,
            color: 'var(--color-gold-light)',
            marginBottom: 6,
            textAlign: 'center',
          }}>
            How KathaKitaab turns one prompt into a living story
          </h2>
          <p style={{
            fontSize: '0.84rem',
            color: 'var(--color-text-dim)',
            margin: '0 auto 24px',
            lineHeight: 1.6,
            maxWidth: 620,
            textAlign: 'center',
          }}>
            A coordinated AI agent flow plans the story, designs characters, creates scenes, adds narration, builds interactions, and prepares the final book or movie experience.
          </p>

          {/* Subtle flow pipeline — mobile scrolls horizontally, desktop wraps */}
          <div style={{
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            paddingBottom: 8,
            marginBottom: 20,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}>
            {FLOW_STEPS.map((step, i) => (
              <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  color: 'var(--color-gold)',
                  background: 'rgba(212,168,71,0.12)',
                  padding: '3px 10px',
                  borderRadius: 999,
                  border: '1px solid rgba(212,168,71,0.25)',
                  whiteSpace: 'nowrap',
                }}>
                  {step}
                </span>
                {i < FLOW_STEPS.length - 1 && (
                  <span style={{ color: 'rgba(212,168,71,0.35)', fontSize: '0.7rem' }}>→</span>
                )}
              </div>
            ))}
          </div>

          {/* Agent cards — mobile 1-col, tablet 2-col, desktop 4-col */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 14,
          }}>
            {AGENT_FLOW.map((a, i) => (
              <motion.div
                key={a.num}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.05 * i }}
                style={{
                  padding: '16px 16px 18px',
                  borderRadius: 14,
                  background: 'rgba(12,8,6,0.55)',
                  border: '1px solid rgba(255,215,0,0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: 999,
                    background: 'linear-gradient(135deg, #E8832A, #D4A847)',
                    color: '#0C0806',
                    fontSize: '0.72rem', fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {a.num}
                  </span>
                  <span style={{
                    fontSize: '0.7rem', fontWeight: 700,
                    color: 'var(--color-saffron)',
                    textTransform: 'uppercase', letterSpacing: 1.2,
                  }}>
                    Agent {a.num}
                  </span>
                </div>
                <div style={{
                  fontSize: '0.92rem', fontWeight: 700,
                  color: 'var(--color-gold-light)',
                  lineHeight: 1.35,
                }}>
                  {a.title}
                </div>
                <div style={{
                  fontSize: '0.78rem', color: 'var(--color-text-dim)',
                  lineHeight: 1.55,
                }}>
                  {a.desc}
                </div>
              </motion.div>
            ))}
          </div>

          <p style={{
            fontSize: '0.8rem',
            color: 'var(--color-text-dim)',
            marginTop: 22,
            lineHeight: 1.65,
            textAlign: 'center',
            maxWidth: 640,
            marginInline: 'auto',
          }}>
            From one idea to a complete interactive story — KathaKitaab coordinates multiple AI agents so children can read, watch, listen, and explore stories in a magical way.
          </p>
        </motion.div>
      </div>
    </main>
  );
}
