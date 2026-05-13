'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import BookGenerator from '@/components/library/BookGenerator';
import { AuthNavButton } from '@/components/auth/AuthNavButton';

interface LibraryBook {
  id?: string;
  slug: string;
  title: string;
  subtitle?: string;
  description?: string;
  mode?: 'world' | 'classroom' | 'personalized_text' | 'personalized_photo';
  /** First scene's image — used as the card cover. When missing the
   *  card falls back to the gradient + emoji placeholder. */
  coverImage?: string;
}

// Pulled when /api/books returns nothing (cold lambda before any
// other route has warmed Redis). Ramayana is the curated seed so
// the page is never empty. coverImage matches the static manifest.
const FALLBACK: LibraryBook[] = [{
  slug: 'ramayana',
  title: 'Ramayana',
  subtitle: 'A classic epic retold as a living storybook',
  description: 'Read the Ramayana as a clean visual story, or step inside and shape the next turn through simple choices.',
  coverImage: '/images/scene_ayodhya_intro.png',
}];

// Small visual identity per book type. Used to pick a cover gradient
// when the book record doesn't ship one.
const COVER_ICONS: Record<string, string> = {
  ramayana: '🏛️',
  mahabharata: '⚔️',
  panchatantra: '🦊',
  'akbar-and-birbal': '👑',
  'akbar-and-birbal-stories': '👑',
  'tenali-raman': '🪔',
  'vikram-and-betaal': '🌙',
};

function coverIconFor(slug: string): string {
  if (COVER_ICONS[slug]) return COVER_ICONS[slug];
  if (slug.startsWith('pv-')) return '🌟'; // personalized
  if (slug.startsWith('cl-')) return '📚'; // classroom
  return '📖';
}

export default function BooksPage() {
  const [books, setBooks] = useState<LibraryBook[]>(FALLBACK);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/books', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { books: LibraryBook[] };
        if (cancelled) return;
        if (Array.isArray(data.books) && data.books.length > 0) {
          // Sort so seed/world books come first, private modes last.
          const order = (b: LibraryBook): number =>
            b.mode === 'world' || !b.mode ? 0 :
            b.mode === 'classroom' ? 1 : 2;
          setBooks([...data.books].sort((a, b) => order(a) - order(b)));
        }
      } catch (err) {
        console.warn('[books] failed to fetch library, keeping fallback:',
          err instanceof Error ? err.message : err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
            KathaKitaab
          </span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ color: 'var(--color-text-dim)', fontSize: '0.88rem' }}>Story Worlds</span>
          <AuthNavButton next="/books#create-story" compact />
        </div>
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
          <BookGenerator existingBooks={books.map(b => b.slug)} />
        </section>

        <h2 style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2.4, marginBottom: 18 }}>
          {loaded ? `Explore Worlds · ${books.length} ready` : 'Explore Worlds'}
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 24 }}>
          {books.map((book, i) => {
            const icon = coverIconFor(book.slug);
            const subtitle = book.subtitle
              || (book.mode === 'classroom' ? 'Classroom story' :
                  book.mode === 'personalized_text' ? 'Personalized story' :
                  'AI-generated storybook');
            const description = book.description
              || 'Open the live reader to step into the scenes, or hop into Play Mode and pick an archetype.';
            return (
              <motion.div
                key={book.slug}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                whileHover={{ y: -6 }}
                className="glass-card"
                style={{ padding: 0, overflow: 'hidden', background: 'rgba(43,27,21,0.45)' }}
              >
                <div style={{
                  height: 220,
                  // Real scene image when available, gradient placeholder
                  // when not. A darkened bottom gradient overlays the
                  // image so the title and subtitle stay legible
                  // regardless of how bright the underlying scene is.
                  backgroundImage: book.coverImage
                    ? `linear-gradient(180deg, rgba(12,8,6,0) 30%, rgba(12,8,6,0.55) 70%, rgba(12,8,6,0.92) 100%), url("${book.coverImage}")`
                    : 'linear-gradient(135deg, #2A1810 0%, #6A3916 48%, #D4A847 100%)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'flex-start', justifyContent: 'flex-end',
                  padding: 18,
                  position: 'relative', overflow: 'hidden',
                }}>
                  {!book.coverImage && (
                    <span style={{
                      position: 'absolute', top: '50%', left: '50%',
                      transform: 'translate(-50%, -120%)',
                      fontSize: '3.5rem',
                      filter: 'drop-shadow(0 0 20px rgba(255,215,0,0.5))',
                    }}>{icon}</span>
                  )}
                  <span className="font-serif" style={{
                    fontSize: '1.3rem', fontWeight: 700, color: 'var(--color-gold-light)',
                    textShadow: '0 2px 14px rgba(0,0,0,0.7)',
                  }}>{book.title}</span>
                  <span style={{
                    fontSize: '0.76rem', color: 'rgba(255,255,255,0.86)', marginTop: 4,
                    textShadow: '0 1px 8px rgba(0,0,0,0.6)',
                  }}>{subtitle}</span>
                </div>

                <div style={{ padding: 20 }}>
                  <p style={{ fontSize: '0.9rem', color: 'var(--color-text-dim)', marginBottom: 18, lineHeight: 1.7 }}>
                    {description}
                  </p>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <Link
                      href={`/books/${book.slug}`}
                      id={`read-${book.slug}`}
                      className="btn-secondary"
                      style={{ flex: 1, minWidth: 110, justifyContent: 'center', textDecoration: 'none', borderRadius: 999 }}
                    >
                      Read
                    </Link>
                    <Link
                      href={`/play/${book.slug}`}
                      id={`play-${book.slug}`}
                      className="btn-primary"
                      style={{ flex: 1, minWidth: 110, justifyContent: 'center', textDecoration: 'none', borderRadius: 999 }}
                    >
                      Play
                    </Link>
                    <Link
                      href={`/books/${book.slug}/movie`}
                      id={`movie-${book.slug}`}
                      className="btn-secondary"
                      style={{ flex: 1, minWidth: 110, justifyContent: 'center', textDecoration: 'none', borderRadius: 999 }}
                    >
                      Movie
                    </Link>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
