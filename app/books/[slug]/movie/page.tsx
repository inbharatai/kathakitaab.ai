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

  // ── MP4 export state ──
  // Tracks both export modes independently so the UI can show
  // "Trailer ready" while a Full Movie render is still in flight.
  type RenderState = { status: 'idle' | 'rendering' | 'done' | 'failed'; url: string | null; error: string | null };
  const initialState: RenderState = { status: 'idle', url: null, error: null };
  const [movieState, setMovieState] = useState<RenderState>(initialState);
  const [trailerState, setTrailerState] = useState<RenderState>(initialState);

  const handleExport = async (mode: 'movie' | 'trailer') => {
    const setter = mode === 'movie' ? setMovieState : setTrailerState;
    setter({ status: 'rendering', url: null, error: null });
    try {
      const res = await fetch('/api/livebook/render-movie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookSlug: slug, mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.detail || 'Render failed');
      setter({ status: 'done', url: data.url, error: null });
    } catch (err) {
      setter({ status: 'failed', url: null, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  };

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

            {/* MP4 export UI — renders the same composition server-side
                via Remotion + FFmpeg, uploads to Supabase, returns a
                public download URL. Cached by manifest hash so a second
                click on an unchanged book is instant. Two modes: full
                movie (~6-7 min) and a 45s cinematic trailer. */}
            <div
              data-testid="mp4-export"
              style={{
                marginTop: 18, padding: '16px 20px',
                background: 'rgba(43,27,21,0.55)',
                border: '1px solid rgba(255,215,0,0.12)',
                borderRadius: 12,
                display: 'flex', flexDirection: 'column', gap: 14,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: '0.95rem', color: 'var(--color-gold-light)', fontWeight: 600 }}>
                    Export {manifest.scenes.length}-scene book as MP4
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-dim)', marginTop: 4 }}>
                    Renders the full Remotion composition with sentence cues, ducked mood music, and per-scene camera motion. Cached by manifest hash.
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <ExportButton
                  testId="mp4-export-button"
                  label="Full Movie"
                  hint={`${manifest.scenes.length} scenes · ~6 min`}
                  state={movieState}
                  onClick={() => handleExport('movie')}
                />
                <ExportButton
                  testId="trailer-export-button"
                  label="Cinematic Trailer"
                  hint="6 dramatic scenes · ~45s"
                  state={trailerState}
                  onClick={() => handleExport('trailer')}
                />
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

// ── Export button ────────────────────────────────────────────
// Three states: idle (label), rendering (spinner-like text +
// disabled), done (becomes a link with the download URL). Failed
// state shows an inline error under the button.

interface ExportButtonProps {
  testId: string;
  label: string;
  hint: string;
  state: { status: 'idle' | 'rendering' | 'done' | 'failed'; url: string | null; error: string | null };
  onClick: () => void;
}

function ExportButton({ testId, label, hint, state, onClick }: ExportButtonProps) {
  const wrapStyle: React.CSSProperties = { display: 'inline-flex', flexDirection: 'column', gap: 4 };
  if (state.status === 'done' && state.url) {
    return (
      <div style={wrapStyle}>
        <a
          data-testid={testId === 'mp4-export-button' ? 'mp4-download-link' : `${testId}-link`}
          href={state.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary"
          style={{ textDecoration: 'none', minWidth: 200 }}
        >
          Download {label} ↓
        </a>
        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-dim)', paddingLeft: 8 }}>{hint}</span>
      </div>
    );
  }
  return (
    <div style={wrapStyle}>
      <button
        data-testid={testId}
        onClick={onClick}
        disabled={state.status === 'rendering'}
        className="btn-primary"
        style={{ minWidth: 200, opacity: state.status === 'rendering' ? 0.7 : 1 }}
      >
        {state.status === 'rendering' ? `Rendering ${label}…` : `Export ${label}`}
      </button>
      <span style={{ fontSize: '0.7rem', color: 'var(--color-text-dim)', paddingLeft: 8 }}>{hint}</span>
      {state.status === 'failed' && state.error && (
        <span data-testid={`${testId}-error`} style={{ fontSize: '0.72rem', color: '#FF8888', paddingLeft: 8 }}>
          {state.error}
        </span>
      )}
    </div>
  );
}
