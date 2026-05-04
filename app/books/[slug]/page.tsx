'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, use } from 'react';
import Link from 'next/link';
import SceneViewer from '@/components/livebook/SceneViewer';

function toTitleCase(slug: string): string {
  return slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function SceneViewerWrapper({ params }: { params: { slug: string } }) {
  const searchParams = useSearchParams();
  const sceneId = searchParams.get('scene') || 'ayodhya_intro';
  return <SceneViewer bookSlug={params.slug} initialSceneId={sceneId} />;
}

export default function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = use(params);
  const title = toTitleCase(resolvedParams.slug);

  return (
    <main style={{ minHeight: '100vh', padding: '20px 18px 52px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, paddingTop: 6 }}>
          <Link href="/books" className="btn-secondary" style={{ textDecoration: 'none', borderRadius: 999 }}>
            ← Explore Worlds
          </Link>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2 }}>Read Mode</div>
            <div className="font-serif" style={{ fontSize: '1.15rem', color: 'var(--color-gold-light)' }}>{title}</div>
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
