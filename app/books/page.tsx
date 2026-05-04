'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import BookGenerator from '@/components/library/BookGenerator';

const SEED_BOOKS = [
  {
    slug: 'ramayana',
    title: 'Ramayana',
    subtitle: 'A classic epic retold as a living storybook',
    description: 'Read the Ramayana as a clean visual story, or step inside and shape the next turn through simple choices.',
    icon: '🏛️',
  }
];

export default function BooksPage() {
  return (
    <main style={{ minHeight: '100vh', padding: '80px 24px 60px' }}>
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40,
        padding: '14px 24px',
        background: 'rgba(12,8,6,0.82)', backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16
      }}>
        <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '1.3rem' }}>📚</span>
          <span style={{ fontWeight: 800, fontSize: '1.1rem', background: 'linear-gradient(135deg, #E8832A, #D4A847)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            KathaKitaab.ai
          </span>
        </Link>
        <span style={{ color: 'var(--color-text-dim)', fontSize: '0.88rem' }}>Story Worlds</span>
      </nav>

      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--color-gold)', textTransform: 'uppercase', letterSpacing: '0.24em', marginBottom: 10 }}>
            Story Worlds
          </div>
          <h1 className="font-serif" style={{ fontSize: 'clamp(2.2rem, 4vw, 3.2rem)', fontWeight: 800, marginBottom: 10, color: 'var(--color-gold-light)' }}>
            Create a story or step inside one.
          </h1>
          <p style={{ color: 'var(--color-text-dim)', marginBottom: 0, fontSize: '1rem', lineHeight: 1.75, maxWidth: 700, marginInline: 'auto' }}>
            Keep the experience simple: pick a world, read the story beautifully, or open Play Mode and shape what happens next.
          </p>
        </motion.div>

        <section id="create-story" style={{ marginBottom: 42 }}>
          <BookGenerator existingBooks={SEED_BOOKS.map(b => b.slug)} />
        </section>

        <h2 style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2.4, marginBottom: 18 }}>
          Explore Worlds
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 24 }}>
          {SEED_BOOKS.map((book, i) => (
            <motion.div
              key={book.slug}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              whileHover={{ y: -6 }}
              className="glass-card"
              style={{ padding: 0, overflow: 'hidden', background: 'rgba(43,27,21,0.45)' }}
            >
              <div style={{
                height: 168,
                background: 'linear-gradient(135deg, #2A1810 0%, #6A3916 48%, #D4A847 100%)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                position: 'relative', overflow: 'hidden',
              }}>
                {[...Array(6)].map((_, j) => (
                  <div key={j} style={{
                    position: 'absolute', right: 20 + j * 3, top: 0, bottom: 0,
                    width: 1, background: 'rgba(255,255,255,0.06)',
                  }} />
                ))}
                <span style={{ fontSize: '3.5rem', marginBottom: 8, filter: 'drop-shadow(0 0 20px rgba(255,215,0,0.5))' }}>{book.icon}</span>
                <span className="font-serif" style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--color-gold-light)' }}>{book.title}</span>
                <span style={{ fontSize: '0.76rem', color: 'rgba(255,255,255,0.72)', marginTop: 4 }}>{book.subtitle}</span>
              </div>

              <div style={{ padding: 20 }}>
                <p style={{ fontSize: '0.9rem', color: 'var(--color-text-dim)', marginBottom: 18, lineHeight: 1.7 }}>
                  {book.description}
                </p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Link
                    href={`/books/${book.slug}`}
                    id={`read-${book.slug}`}
                    className="btn-secondary"
                    style={{ flex: 1, minWidth: 120, justifyContent: 'center', textDecoration: 'none', borderRadius: 999 }}
                  >
                    Read Story
                  </Link>
                  <Link
                    href={`/play/${book.slug}`}
                    id={`play-${book.slug}`}
                    className="btn-primary"
                    style={{ flex: 1, minWidth: 120, justifyContent: 'center', textDecoration: 'none', borderRadius: 999 }}
                  >
                    Play Story
                  </Link>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </main>
  );
}
