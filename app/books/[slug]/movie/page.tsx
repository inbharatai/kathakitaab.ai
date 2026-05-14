'use client';

// Per-book live trailer. The same Remotion BookMovie composition that
// plays on the landing page is rendered here for any book with a
// committed manifest. Narration streams from Supabase Storage; images
// come either from /public or from CDN URLs the manifest already holds.
//
// "Not yet ready" books (no manifest committed) get a friendly message
// pointing back to the reader — no half-rendered placeholder.

import Link from 'next/link';
import { use, useState, useEffect } from 'react';
import { Player } from '@remotion/player';
import { BookMovie, BOOK_MOVIE_FPS, computeBookMovieFrames, type BookMovieManifest } from '@/remotion/BookMovie';

export default function BookMoviePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  // Manifest comes from the universal /api/livebook/manifest endpoint.
  // Static books resolve instantly (in-memory lookup); AI-generated
  // books synth on the fly from the bookRegistry. Either way the
  // Player is the same.
  const [manifest, setManifest] = useState<BookMovieManifest | null>(null);
  const [manifestStatus, setManifestStatus] = useState<'loading' | 'ready' | 'missing'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/livebook/manifest?slug=${encodeURIComponent(slug)}`);
        if (!res.ok) {
          if (!cancelled) setManifestStatus('missing');
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setManifest(data.manifest);
          setManifestStatus('ready');
        }
      } catch {
        if (!cancelled) setManifestStatus('missing');
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  return (
    <main className="lp-movie-page-main" style={{ minHeight: '100vh', padding: '20px 18px 52px' }}>
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

        {manifestStatus === 'loading' ? (
          <div style={{
            padding: '60px 24px', textAlign: 'center',
            borderRadius: 16, border: '1px solid rgba(255,215,0,0.1)',
            background: 'rgba(43,27,21,0.4)',
          }}>
            <div style={{ color: 'var(--color-gold)' }}>Loading the cinematic cut…</div>
          </div>
        ) : manifest ? (
          <>
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

            {/* MP4 export — disabled in the public UI because the
                server-side renderer needs Chromium + FFmpeg, which
                Vercel's standard serverless functions don't ship.
                The cinematic player above is the canonical experience.
                Local builds can still render via `npm run movie:render`
                or the CLI (documented in the README). */}
            <div
              data-testid="mp4-export-coming-soon"
              style={{
                marginTop: 18, padding: '14px 18px',
                background: 'rgba(43,27,21,0.45)',
                border: '1px dashed rgba(255,215,0,0.18)',
                borderRadius: 12,
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}
            >
              <span aria-hidden style={{ fontSize: '1.1rem' }}>🎬</span>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: '0.88rem', color: 'var(--color-gold-light)', fontWeight: 600 }}>
                  Video export — coming soon
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--color-text-dim)', marginTop: 2, lineHeight: 1.5 }}>
                  The cinematic cut plays here in the browser at full quality. A downloadable MP4 will arrive once the renderer is hosted somewhere with Chromium support.
                </div>
              </div>
            </div>
          </>
        ) : (
          <div style={{
            padding: '60px 24px', textAlign: 'center',
            borderRadius: 16, border: '1px dashed rgba(255,215,0,0.2)',
            background: 'rgba(43,27,21,0.4)',
          }}>
            <div className="font-serif" style={{ fontSize: '1.6rem', color: 'var(--color-gold)', marginBottom: 12 }}>
              This book hasn&apos;t been generated yet
            </div>
            <p style={{ color: 'var(--color-text-dim)', maxWidth: 540, margin: '0 auto 20px' }}>
              Generate the book first from the library — the engine will synthesise both the interactive reader and the cinematic cut from the same scenes.
            </p>
            <Link href="/books" className="btn-primary" style={{ textDecoration: 'none' }}>
              Go to the Library
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

