'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import BookGenerator from '@/components/library/BookGenerator';

const CURRICULUM_PRESETS = [
  { label: 'NCERT History – Ancient India (Grade 6)', slug: 'ncert-history-ancient-india-grade-6' },
  { label: 'Panchatantra Stories', slug: 'panchatantra' },
  { label: 'Akbar and Birbal', slug: 'akbar-and-birbal' },
  { label: 'Tenali Raman', slug: 'tenali-raman' },
  { label: 'Jataka Tales', slug: 'jataka-tales' },
  { label: 'Mahabharata – Key Moments', slug: 'mahabharata-key-moments' },
];

const STATS = [
  { icon: '📖', label: 'Books Available', value: '1 Live + ∞ Generatable' },
  { icon: '🎓', label: 'Total Scenes', value: '12 Ramayana + AI' },
  { icon: '🧩', label: 'Quiz Questions', value: '12+' },
  { icon: '💬', label: 'Characters', value: '10 interactive' },
];

export default function EducatorPage() {
  const router = useRouter();

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
            KathaKitaab.ai
          </span>
        </Link>
        <span style={{ color: 'var(--color-text-dim)', fontSize: '0.9rem' }}>/ Educator Dashboard</span>
        <div style={{ marginLeft: 'auto' }}>
          <Link href="/books" className="btn-secondary" style={{ textDecoration: 'none', padding: '6px 16px', fontSize: '0.85rem' }}>
            View Library
          </Link>
        </div>
      </nav>

      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
            <span style={{ fontSize: '2.5rem' }}>👩‍🏫</span>
            <div>
              <h1 className="font-serif" style={{ fontSize: 'clamp(1.8rem, 3.5vw, 2.5rem)', fontWeight: 800, color: 'var(--color-gold-light)', margin: 0 }}>
                Educator Dashboard
              </h1>
              <p style={{ color: 'var(--color-saffron)', fontSize: '0.9rem', margin: 0, marginTop: 4 }}>
                Generate any book · Assign to students · Track comprehension
              </p>
            </div>
          </div>
        </motion.div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, margin: '32px 0' }}>
          {STATS.map((stat, i) => (
            <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
              className="glass-card" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontSize: '1.8rem' }}>{stat.icon}</span>
              <div>
                <div style={{ fontSize: '0.65rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>{stat.label}</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-gold-light)', marginTop: 2 }}>{stat.value}</div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Generate a curriculum book */}
        <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 16 }}>
          📝 Generate a Curriculum Book
        </h2>
        <BookGenerator />

        {/* Curriculum Presets */}
        <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2, margin: '32px 0 16px' }}>
          ⚡ Quick-Start Curriculum Presets
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {CURRICULUM_PRESETS.map((preset, i) => (
            <motion.button
              key={preset.slug}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.06 }}
              whileHover={{ scale: 1.02, x: 4 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => router.push(`/books?generate=${encodeURIComponent(preset.label)}`)}
              style={{
                textAlign: 'left', padding: '16px 20px', borderRadius: 12,
                background: 'rgba(58,36,24,0.5)', border: '1px solid rgba(212,168,71,0.15)',
                color: 'var(--color-gold-light)', cursor: 'pointer', fontSize: '0.9rem',
                display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <span style={{ fontSize: '1.2rem' }}>📗</span>
              {preset.label}
            </motion.button>
          ))}
        </div>

        {/* How it works */}
        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
          className="glass-card" style={{ marginTop: 40, padding: 32, borderTop: '2px solid rgba(212,168,71,0.2)' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-gold-light)', marginBottom: 24 }}>
            🤖 How the Agent Swarm Works
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
            {[
              { step: '1', icon: '✍️', title: 'You Type a Title', desc: 'Any book, subject, or chapter name' },
              { step: '2', icon: '🏗️', title: 'Architect Agent', desc: 'Generates 10-12 scene outline' },
              { step: '3', icon: '👤', title: 'Character Agent', desc: 'Creates full character bibles' },
              { step: '4', icon: '🎨', title: 'Narration Agent', desc: 'Writes scene-by-scene narration' },
              { step: '5', icon: '🎯', title: 'Hotspot Agent', desc: 'Places interactive click zones' },
              { step: '6', icon: '🧩', title: 'Quiz Agent', desc: 'Generates learning assessments' },
            ].map(s => (
              <div key={s.step} style={{ textAlign: 'center' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(232,131,42,0.15)', border: '1px solid rgba(232,131,42,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px', fontSize: '1.2rem' }}>
                  {s.icon}
                </div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-saffron)', marginBottom: 4 }}>Step {s.step}</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-gold-light)', marginBottom: 4 }}>{s.title}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-dim)' }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </main>
  );
}
