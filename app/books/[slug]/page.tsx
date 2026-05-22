'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import SceneViewer from '@/components/livebook/SceneViewer';
import DeleteBookButton from '@/components/library/DeleteBookButton';

function toTitleCase(slug: string): string {
  return slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// Fallback default for the curated Ramayana — the first scene there
// is `ayodhya_intro`. Any other book gets its first scene id by
// fetching /api/books/<slug>, since AI-generated books each have
// their own scene id vocabulary.
const RAMAYANA_DEFAULT_SCENE = 'ayodhya_intro';

function SceneViewerWrapper({ params }: { params: { slug: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const explicitScene = searchParams.get('scene');
  // Initial value is derived synchronously from the URL + slug so we
  // never need a setState in the effect just to seed it. For Ramayana
  // (the only book whose first-scene id is known statically), we
  // resolve it inline; everything else stays null until the fetch
  // below resolves the real first scene.
  const initialSceneId = explicitScene
    ?? (params.slug === 'ramayana' ? RAMAYANA_DEFAULT_SCENE : null);
  const [resolvedSceneId, setResolvedSceneId] = useState<string | null>(initialSceneId);
  const [error, setError] = useState<string | null>(null);
  const [accuracyLabel, setAccuracyLabel] = useState<string | null>(
    params.slug === 'ramayana' ? 'CANONICAL' : null,
  );

  useEffect(() => {
    // If we already know the scene id (URL param or Ramayana default),
    // there's nothing for this effect to fetch. The early return keeps
    // us out of a setState-in-effect cascade.
    if (initialSceneId) return;

    // For any other book — including every AI-generated one — fetch
    // the book and pick its first scene by order_index. This is what
    // unblocks "type any title" → working reader.
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/books/${params.slug}`);
        if (!res.ok) {
          if (!cancelled) setError('not_ready');
          return;
        }
        const data = await res.json();
        if (!cancelled) setAccuracyLabel(data.book?.accuracyLabel ?? null);
        const scenes: Array<{ scene_id: string; order_index?: number }> = data.scenes ?? [];
        if (scenes.length === 0) {
          if (!cancelled) setError('This book has no scenes yet.');
          return;
        }
        const sorted = [...scenes].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
        if (!cancelled) setResolvedSceneId(sorted[0].scene_id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load book');
      }
    })();
    return () => { cancelled = true; };
  }, [params.slug, initialSceneId, router]);

  if (error) {
    const isNotReady = error === 'not_ready';
    return (
      <div className="glass-card" style={{ padding: 40, textAlign: 'center', marginTop: 40 }}>
        <p style={{ color: '#ff8a8a', marginBottom: 16, fontSize: '1.1rem', fontWeight: 600 }}>
          {isNotReady ? 'This story is not ready yet.' : error}
        </p>
        <p style={{ color: 'var(--color-text-dim)', marginBottom: 24, fontSize: '0.95rem' }}>
          {isNotReady ? 'You can generate it from Studio.' : 'Go to the Library to find or create stories.'}
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/books" className="btn-secondary" style={{ textDecoration: 'none' }}>
            Browse Library
          </Link>
          {isNotReady && (
            <Link href="/books?tab=studio" className="btn-primary" style={{ textDecoration: 'none' }}>
              Generate Story
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (!resolvedSceneId) {
    return (
      <div style={{ height: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 20 }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          border: '3px solid rgba(212,168,71,0.15)',
          borderTop: '3px solid var(--color-gold)',
          animation: 'spin 1.5s linear infinite',
        }} />
        <p style={{ color: 'var(--color-gold)', fontWeight: 600 }}>Opening the book...</p>
      </div>
    );
  }

  const labelColors: Record<string, string> = {
    CANONICAL: '#2ecc71',
    CREATIVE_RETELLING: '#3498db',
    EDUCATIONAL_SUMMARY: '#9b59b6',
    UNVERIFIED: '#f39c12',
  };

  return (
    <div style={{ position: 'relative' }}>
      {accuracyLabel && (
        <div
          style={{
            position: 'absolute',
            top: -28,
            right: 0,
            fontSize: '0.6rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 1.5,
            color: labelColors[accuracyLabel] || 'var(--color-text-dim)',
            background: 'rgba(0,0,0,0.45)',
            padding: '3px 10px',
            borderRadius: 999,
            zIndex: 10,
            backdropFilter: 'blur(4px)',
          }}
          title={
            accuracyLabel === 'CANONICAL'
              ? 'This book is drawn from verified source material.'
              : accuracyLabel === 'CREATIVE_RETELLING'
                ? 'This is an AI retelling — not verified against a single source.'
                : accuracyLabel === 'EDUCATIONAL_SUMMARY'
                  ? 'Simplified educational summary.'
                  : 'Accuracy status unknown.'
          }
        >
          {accuracyLabel.replace(/_/g, ' ')}
        </div>
      )}
      <SceneViewer bookSlug={params.slug} initialSceneId={resolvedSceneId} />
    </div>
  );
}

export default function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = use(params);
  const fallbackTitle = toTitleCase(resolvedParams.slug);
  const [title, setTitle] = useState(fallbackTitle);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/books/${resolvedParams.slug}`);
        if (!res.ok) return;
        const data = await res.json();
        const realTitle = data.book?.title || data.title;
        if (realTitle && !cancelled) setTitle(realTitle);
      } catch {
        // keep fallback
      }
    })();
    return () => { cancelled = true; };
  }, [resolvedParams.slug]);

  return (
    <main className="reader-page-main" style={{ minHeight: '100vh', padding: '20px 18px calc(52px + env(safe-area-inset-bottom, 0px))' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div className="reader-page-topbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, paddingTop: 6 }}>
          <div className="reader-page-actions" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link href="/books" className="btn-secondary" style={{ textDecoration: 'none', borderRadius: 999 }}>
              ← Explore Worlds
            </Link>
            <Link
              href={`/books/${resolvedParams.slug}/movie`}
              className="btn-secondary"
              style={{ textDecoration: 'none', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              ▶ Watch as Movie
            </Link>
          </div>
          <div className="reader-page-meta" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* Delete affordance — self-hides for public/seed books
                and for non-owners. The component fetches the book's
                metadata to decide visibility. */}
            <DeleteBookButton bookSlug={resolvedParams.slug} />
            <div style={{ textAlign: 'right', minWidth: 0 }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2 }}>Read Mode</div>
              <div className="font-serif" style={{ fontSize: '1.15rem', color: 'var(--color-gold-light)', lineHeight: 1.35, overflowWrap: 'anywhere' }}>{title}</div>
            </div>
          </div>
        </div>

        <Suspense fallback={
          <div style={{ height: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 20 }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              border: '3px solid rgba(212,168,71,0.15)',
              borderTop: '3px solid var(--color-gold)',
              animation: 'spin 1.5s linear infinite',
            }} />
            <p style={{ color: 'var(--color-gold)', fontWeight: 600 }}>Opening the book...</p>
          </div>
        }>
          <SceneViewerWrapper params={resolvedParams} />
        </Suspense>
      </div>
    </main>
  );
}
