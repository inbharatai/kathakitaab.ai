'use client';

// Per-book live trailer. The same Remotion BookMovie composition that
// plays on the landing page is rendered here for any book with a
// committed manifest. Narration streams from Supabase Storage; images
// come either from /public or from CDN URLs the manifest already holds.
//
// "Not yet ready" books (no manifest committed) get a friendly message
// pointing back to the reader — no half-rendered placeholder.

import Link from 'next/link';
import { use } from 'react';
import { Player } from '@remotion/player';
import { BookMovie, BOOK_MOVIE_FPS, computeBookMovieFrames, type BookMovieManifest } from '@/remotion/BookMovie';
import { getManifestForSlug } from '@/lib/video/manifestRegistry';

export default function BookMoviePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const manifest = getManifestForSlug(slug);

  return (
    <main style={{ minHeight: '100vh', padding: '20px 18px 52px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link href={`/books/${slug}`} className="btn-secondary" style={{ textDecoration: 'none', borderRadius: 999 }}>
              ← Read the Book
            </Link>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2 }}>Movie Mode</div>
            <div className="font-serif" style={{ fontSize: '1.15rem', color: 'var(--color-gold-light)' }}>{manifest?.bookTitle || slug}</div>
          </div>
        </div>

        {manifest ? (
          <div style={{
            borderRadius: 16, overflow: 'hidden',
            border: '1px solid rgba(255,215,0,0.1)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <Player
              component={BookMovie}
              inputProps={{ manifest }}
              durationInFrames={computeBookMovieFrames(manifest)}
              fps={BOOK_MOVIE_FPS}
              compositionWidth={1920}
              compositionHeight={1080}
              initialFrame={30}
              controls
              clickToPlay
              doubleClickToFullscreen
              style={{ width: '100%', aspectRatio: '16 / 9', display: 'block', background: '#0C0806' }}
            />
          </div>
        ) : (
          <div style={{
            padding: '60px 24px', textAlign: 'center',
            borderRadius: 16, border: '1px dashed rgba(255,215,0,0.2)',
            background: 'rgba(43,27,21,0.4)',
          }}>
            <div className="font-serif" style={{ fontSize: '1.6rem', color: 'var(--color-gold)', marginBottom: 12 }}>
              The movie for this book isn&apos;t ready yet
            </div>
            <p style={{ color: 'var(--color-text-dim)', maxWidth: 540, margin: '0 auto 20px' }}>
              The interactive book is fully playable — the cinematic narration version is generated separately.
              Run <code style={{ background: 'rgba(0,0,0,0.4)', padding: '2px 8px', borderRadius: 6 }}>npm run movie:build -- --slug={slug}</code> to produce the manifest, then refresh.
            </p>
            <Link href={`/books/${slug}`} className="btn-primary" style={{ textDecoration: 'none' }}>
              Read the Book Instead
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
