'use client';

// Per-book live trailer. The same Remotion BookMovie composition that
// plays on the landing page is rendered here for any book with a
// committed manifest. Narration streams from S3 (CloudFront CDN); images
// come either from /public or from CDN URLs the manifest already holds.
//
// "Not yet ready" books (no manifest committed) get a friendly message
// pointing back to the reader — no half-rendered placeholder.

import Link from 'next/link';
import { use, useState, useEffect, useRef, useCallback } from 'react';
import { Player } from '@remotion/player';
import { prefetch } from 'remotion';
import { BookMovie, BOOK_MOVIE_FPS, computeBookMovieFrames, type BookMovieManifest } from '@/remotion/BookMovie';

export default function BookMoviePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  // Manifest comes from the universal /api/livebook/manifest endpoint.
  // Static books resolve instantly (in-memory lookup); AI-generated
  // books synth on the fly from the bookRegistry. Either way the
  // Player is the same.
  const [manifest, setManifest] = useState<BookMovieManifest | null>(null);
  const [manifestStatus, setManifestStatus] = useState<'loading' | 'ready' | 'partial' | 'missing'>('loading');
  const [missingAssets, setMissingAssets] = useState<Array<{ sceneId: string; missing: string }>>([]);
  const [bookTitle, setBookTitle] = useState<string>('');
  const [assetsReady, setAssetsReady] = useState(false);
  const preloadsRef = useRef<Array<{ free: () => void }>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch book title in parallel with manifest
        const [bookRes, manifestRes] = await Promise.all([
          fetch(`/api/books/${encodeURIComponent(slug)}`),
          fetch(`/api/livebook/manifest?slug=${encodeURIComponent(slug)}`),
        ]);
        if (bookRes.ok) {
          const bookData = await bookRes.json();
          if (!cancelled) setBookTitle(bookData.book?.title || bookData.title || '');
        }
        if (!manifestRes.ok) {
          if (!cancelled) setManifestStatus('missing');
          return;
        }
        const data = await manifestRes.json();
        if (!cancelled) {
          setManifest(data.manifest);
          setAssetsReady(false);
          if (data.ready === false) {
            setManifestStatus('partial');
            setMissingAssets(data.missing ?? []);
          } else {
            setManifestStatus('ready');
          }
        }
      } catch {
        if (!cancelled) setManifestStatus('missing');
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // Prefetch remote image assets so Remotion's <Img> can decode them
  // from blob URLs instead of fetching over the network on every frame.
  // This fixes blank backgrounds for generated books whose images live
  // on S3 (CloudFront CDN).
  useEffect(() => {
    if (!manifest) return;

    const remoteUrls = manifest.scenes.flatMap(s => {
      const urls: string[] = [];
      if (s.imagePath && /^https?:\/\//i.test(s.imagePath)) urls.push(s.imagePath);
      s.beats?.forEach(b => {
        if (b.imagePath && /^https?:\/\//i.test(b.imagePath)) urls.push(b.imagePath);
      });
      return urls;
    });

    // Deduplicate
    const uniqueUrls = [...new Set(remoteUrls)];
    let cancelled = false;
    const preloads = uniqueUrls.length === 0 ? [] : uniqueUrls.map(url => prefetch(url));
    preloadsRef.current = preloads;

    Promise.all(preloads.map(p => p.waitUntilDone()))
      .then(() => {
        if (!cancelled) setAssetsReady(true);
      })
      .catch(() => {
        // Even if some prefetches fail, let the Player try loading
        // directly — worst case it shows the same blank it did before.
        if (!cancelled) setAssetsReady(true);
      });

    return () => {
      cancelled = true;
      preloads.forEach(p => p.free());
    };
  }, [manifest]);

  // Fullscreen + orientation lock for immersive cinematic playback
  const playerWrapRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = playerWrapRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        const req = el.requestFullscreen || (el as unknown as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen;
        if (req) {
          await req.call(el);
          try { await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape'); } catch { /* ignore */ }
        }
      } else {
        const exit = document.exitFullscreen || (document as unknown as Document & { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen;
        if (exit) {
          await exit.call(document);
          try { (screen.orientation as unknown as { unlock?: () => void }).unlock?.(); } catch { /* ignore */ }
        }
      }
    } catch { /* fullscreen may be blocked by browser policy */ }
  }, []);

  return (
    <main className="lp-movie-page-main movie-page-root">
      <div className="movie-page-inner">
        <div className="movie-page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link href={`/books/${slug}`} className="btn-secondary" style={{ textDecoration: 'none', borderRadius: 999 }}>
              ← Read the Book
            </Link>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2 }}>Movie Mode</div>
            <div className="font-serif" style={{ fontSize: '1.15rem', color: 'var(--color-gold-light)' }}>{bookTitle || manifest?.bookTitle || 'Loading...'}</div>
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
        ) : manifestStatus === 'partial' ? (
          <div style={{
            padding: '60px 24px', textAlign: 'center',
            borderRadius: 16, border: '1px dashed rgba(255,215,0,0.2)',
            background: 'rgba(43,27,21,0.4)',
          }}>
            <div className="font-serif" style={{ fontSize: '1.4rem', color: 'var(--color-gold)', marginBottom: 12 }}>
              Still preparing the movie
            </div>
            <p style={{ color: 'var(--color-text-dim)', maxWidth: 540, margin: '0 auto 16px' }}>
              Some scenes are still being processed. The movie will be ready shortly.
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 auto 20px', maxWidth: 400, textAlign: 'left', fontSize: '0.8rem', color: 'var(--color-text-dim)' }}>
              {missingAssets.map((m, i) => (
                <li key={i} style={{ padding: '4px 0', borderBottom: '1px solid rgba(255,215,0,0.08)' }}>
                  Scene {m.sceneId}: missing {m.missing}
                </li>
              ))}
            </ul>
            <Link href={`/books/${slug}`} className="btn-primary" style={{ textDecoration: 'none' }}>
              Read the Book
            </Link>
          </div>
        ) : manifest && !assetsReady ? (
          <div style={{
            padding: '60px 24px', textAlign: 'center',
            borderRadius: 16, border: '1px solid rgba(255,215,0,0.1)',
            background: 'rgba(43,27,21,0.4)',
          }}>
            <div style={{ color: 'var(--color-gold)' }}>Caching scene images…</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-dim)', marginTop: 8 }}>
              This only happens once per book.
            </div>
          </div>
        ) : manifest && assetsReady ? (
          <>
            <div
              ref={playerWrapRef}
              className="movie-player-wrap"
              style={{
                position: 'relative',
                ...(isFullscreen
                  ? { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }
                  : {}),
              }}
            >
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
                style={{
                  width: '100%',
                  aspectRatio: '16 / 9',
                  display: 'block',
                  background: '#0C0806',
                  maxHeight: isFullscreen ? '100vh' : undefined,
                }}
              />
              {/* Fullscreen toggle — visible when not fullscreen so users
                  on mobile (where double-click is unreliable) have a clear
                  affordance to enter cinematic mode. Hidden when already
                  fullscreen to avoid clutter; double-click still exits. */}
              {!isFullscreen && (
                <button
                  onClick={toggleFullscreen}
                  aria-label="Enter fullscreen"
                  style={{
                    position: 'absolute',
                    bottom: 14,
                    right: 14,
                    zIndex: 2,
                    padding: '8px 14px',
                    borderRadius: 10,
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    background: 'rgba(0,0,0,0.55)',
                    backdropFilter: 'blur(6px)',
                    border: '1px solid rgba(255,215,0,0.3)',
                    color: 'var(--color-gold-light)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                  Fullscreen
                </button>
              )}
            </div>

            {/* MP4 export — disabled in the public UI because the
                server-side renderer needs Chromium + FFmpeg, which
                Vercel's standard serverless functions don't ship.
                The cinematic player above is the canonical experience.
                Local builds can still render via `npm run movie:render`
                or the CLI (documented in the README). */}
            <div
              data-testid="mp4-export-coming-soon"
              className="movie-export-banner"
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

