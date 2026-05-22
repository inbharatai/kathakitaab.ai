'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import StudioModeSelector from '@/components/library/StudioModeSelector';
import LibraryHome from '@/components/library/LibraryHome';
import { AuthNavButton } from '@/components/auth/AuthNavButton';

interface LibraryBook {
  id?: string;
  slug: string;
  title: string;
  subtitle?: string;
  description?: string;
  mode?: 'world' | 'personalized_text' | 'personalized_photo';
  coverImage?: string;
  visibility?: 'public' | 'private';
  isOwner?: boolean;
  accuracyLabel?: string;
  hasMovie?: boolean;
  movieStatus?: 'ready' | 'pending' | 'partial' | 'failed';
}

interface GenerationJob {
  id: string;
  slug: string;
  title: string;
  status: string;
  currentStep: string | null;
  totalSteps: number;
  completedSteps: number;
  resumable: boolean;
  errorMessage?: string;
}

const FALLBACK: LibraryBook[] = [{
  slug: 'ramayana',
  title: 'Ramayana',
  subtitle: 'A classic epic retold as a living storybook',
  description: 'Read the Ramayana as a clean visual story, or step inside and shape the next turn through simple choices.',
  coverImage: '/images/scene_ayodhya_intro.png',
  accuracyLabel: 'CANONICAL',
}];

const statusLabel = (status: string, step: string | null) => {
  const map: Record<string, string> = {
    queued: 'Queued',
    planning: 'Planning...',
    outline_generated: 'Outline ready',
    scenes_generating: 'Writing scenes...',
    scenes_generated: 'Scenes ready',
    images_generating: 'Illustrating...',
    images_partial: 'Images partial',
    images_generated: 'Images ready',
    tts_generating: 'Recording audio...',
    tts_partial: 'Audio partial',
    tts_generated: 'Audio ready',
    completed: 'Complete',
    failed: step ? `Failed at ${step}` : 'Failed',
    cancelled: 'Cancelled',
  };
  return map[status] || status;
};

const statusColor = (status: string) => {
  if (status === 'completed') return '#4ade80';
  if (status === 'failed') return '#ff6b6b';
  if (status === 'cancelled') return 'var(--color-text-dim)';
  return '#fbbf24';
};

export default function BooksPage() {
  const [books, setBooks] = useState<LibraryBook[]>(FALLBACK);
  const [loaded, setLoaded] = useState(false);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [resumingSlug, setResumingSlug] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/books', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { books: LibraryBook[] };
        if (cancelled) return;
        if (Array.isArray(data.books) && data.books.length > 0) {
          setBooks(data.books);
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

  // Fetch generation jobs via SSE for real-time updates.
  // Falls back to a one-time fetch if EventSource is unavailable
  // (e.g. very old browsers, or when the user has disabled it).
  useEffect(() => {
    let source: EventSource | null = null;

    if (typeof EventSource !== 'undefined') {
      source = new EventSource('/api/jobs/stream');
      source.addEventListener('jobs', (e) => {
        try {
          const data = JSON.parse(e.data) as { jobs: GenerationJob[] };
          setJobs(Array.isArray(data.jobs) ? data.jobs : []);
        } catch {
          console.warn('[books] malformed SSE job event');
        }
        setJobsLoaded(true);
      });
      source.addEventListener('error', () => {
        console.warn('[books] jobs SSE error — connection dropped');
        setJobsLoaded(true);
        // EventSource auto-reconnects by default; we only fall back
        // to polling if it stays closed after the reconnect window.
      });
      source.addEventListener('done', () => {
        source?.close();
      });
    } else {
      // Fallback for environments without EventSource
      fetch('/api/jobs', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then((data: { jobs?: GenerationJob[] } | null) => {
          setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
        })
        .catch(err => console.warn('[books] failed to fetch jobs:', err instanceof Error ? err.message : err))
        .finally(() => setJobsLoaded(true));
    }

    return () => {
      source?.close();
    };
  }, []);

  async function handleDelete(slug: string) {
    if (!confirm('Delete this story? This cannot be undone.')) return;
    const res = await fetch(`/api/books/${slug}`, { method: 'DELETE' });
    if (res.ok) {
      setBooks(prev => prev.filter(b => b.slug !== slug));
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Failed to delete story');
    }
  }

  async function handleEditSave(slug: string, updates: { title?: string; subtitle?: string; description?: string }) {
    const res = await fetch(`/api/books/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      setBooks(prev => prev.map(b => b.slug === slug ? { ...b, ...updates } : b));
      return true;
    }
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Failed to update story');
    return false;
  }

  async function handleResume(slug: string) {
    setResumingSlug(slug);
    const res = await fetch('/api/books/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
    setResumingSlug(null);
    if (res.ok) {
      // Refresh jobs immediately so the resumed job appears active
      const jobsRes = await fetch('/api/jobs', { cache: 'no-store' });
      if (jobsRes.ok) {
        const data = await jobsRes.json() as { jobs: GenerationJob[] };
        setJobs(Array.isArray(data.jobs) ? data.jobs : []);
      }
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Failed to resume generation');
    }
  }

  return (
    <main style={{ minHeight: '100vh', padding: '80px 0 60px' }}>
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
          <Link href="/books" style={{ color: 'var(--color-gold-light)', fontSize: '0.88rem', textDecoration: 'none', fontWeight: 600 }}>Stories</Link>
          <Link href="/educator" style={{ color: 'var(--color-gold-light)', fontSize: '0.88rem', textDecoration: 'none' }}>Studio →</Link>
          <AuthNavButton next="/books#create-story" compact />
        </div>
      </nav>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 16px' }}>
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ textAlign: 'center', marginBottom: 32, padding: '0 8px' }}
        >
          <div style={{
            fontSize: '0.72rem', color: 'var(--color-gold)', textTransform: 'uppercase',
            letterSpacing: '0.24em', marginBottom: 10
          }}>
            KathaKitaab Studio
          </div>
          <h1 className="font-serif" style={{
            fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 800, marginBottom: 10,
            color: 'var(--color-gold-light)'
          }}>
            Create a story or step inside one.
          </h1>
          <p style={{
            color: 'var(--color-text-dim)', marginBottom: 0, fontSize: '1rem',
            lineHeight: 1.75, maxWidth: 700, marginInline: 'auto'
          }}>
            Type a title or prompt — the engine writes the scenes, paints the art, and prepares the narration.
            Swipe through stories, tap to read, or watch the cinematic movie.
          </p>
        </motion.div>

        <section id="create-story" style={{ marginBottom: 32 }}>
          <StudioModeSelector />
        </section>
      </div>

      {/* Netflix-style rails */}
      <LibraryHome books={books} loading={!loaded} />

      {/* Empty-library nudge — when only Ramayana exists, prompt the
          user to generate stories or restore the showcase books. */}
      {loaded && books.length <= 1 && (
        <div style={{ maxWidth: 1200, margin: '24px auto 0', padding: '0 16px' }}>
          <div style={{
            padding: '28px 24px', borderRadius: 16, textAlign: 'center',
            background: 'rgba(43,27,21,0.45)',
            border: '1px dashed rgba(255,215,0,0.18)',
          }}>
            <div className="font-serif" style={{ fontSize: '1.3rem', color: 'var(--color-gold-light)', marginBottom: 8 }}>
              Build your library
            </div>
            <p style={{ color: 'var(--color-text-dim)', maxWidth: 520, margin: '0 auto 18px', lineHeight: 1.6 }}>
              The showcase books (Mahabharata, Akbar and Birbal, Vikram and Betaal)
              were cleared from storage. Generate them from the admin panel,
              or create your own stories above.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link
                href="/admin"
                className="btn-primary"
                style={{ textDecoration: 'none' }}
              >
                Restore Showcase Books →
              </Link>
              <Link
                href="#create-story"
                className="btn-secondary"
                style={{ textDecoration: 'none' }}
              >
                Create New Story
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Generation Queue — active and failed jobs */}
      {jobsLoaded && jobs.filter(j => j.status !== 'completed' && j.status !== 'cancelled').length > 0 && (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 16px 40px' }}>
          <h2 style={{
            fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text-dim)',
            textTransform: 'uppercase', letterSpacing: 2.4, marginBottom: 18
          }}>
            Generation Queue
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {jobs.filter(j => j.status !== 'completed' && j.status !== 'cancelled').map(job => (
              <div
                key={job.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px', borderRadius: 12,
                  background: 'rgba(43,27,21,0.35)',
                  border: '1px solid rgba(255,215,0,0.08)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: 'var(--color-gold-light)', fontSize: '0.9rem' }}>
                    {job.title}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-dim)', marginTop: 2 }}>
                    {statusLabel(job.status, job.currentStep)}
                    {job.errorMessage && (
                      <span style={{ color: '#ff6b6b', marginLeft: 8 }}>
                        {job.errorMessage}
                      </span>
                    )}
                  </div>
                  <div style={{
                    height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)',
                    marginTop: 6, overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${(job.completedSteps / job.totalSteps) * 100}%`,
                      height: '100%',
                      background: statusColor(job.status),
                      borderRadius: 2,
                      transition: 'width 0.5s ease'
                    }} />
                  </div>
                </div>
                {job.resumable && (
                  <button
                    className="btn-secondary"
                    disabled={resumingSlug === job.slug}
                    style={{
                      padding: '6px 12px', fontSize: '0.72rem', borderRadius: 999,
                      color: '#fbbf24', borderColor: 'rgba(251,191,36,0.35)',
                      opacity: resumingSlug === job.slug ? 0.6 : 1,
                    }}
                    onClick={() => handleResume(job.slug)}
                  >
                    {resumingSlug === job.slug ? 'Resuming...' : 'Resume'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Owner edit/delete for private books — inline rail cards handle this,
          but keep a compact list view at the bottom for bulk management */}
      {books.some(b => b.isOwner) && (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 16px 40px' }}>
          <h2 style={{
            fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text-dim)',
            textTransform: 'uppercase', letterSpacing: 2.4, marginBottom: 18
          }}>
            Your Stories
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {books.filter(b => b.isOwner).map(book => (
              <div
                key={book.slug}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px', borderRadius: 12,
                  background: 'rgba(43,27,21,0.35)',
                  border: '1px solid rgba(255,215,0,0.08)',
                }}
              >
                <div style={{
                  width: 40, height: 56, borderRadius: 6, flexShrink: 0,
                  backgroundImage: book.coverImage ? `url(${book.coverImage})` : undefined,
                  backgroundSize: 'cover', backgroundPosition: 'center',
                  backgroundColor: 'rgba(12,8,6,0.6)',
                }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: 'var(--color-gold-light)', fontSize: '0.9rem' }}>
                    {book.title}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-dim)' }}>
                    {book.subtitle || book.mode}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '0.72rem', borderRadius: 999 }}
                    onClick={async () => {
                      const title = prompt('New title:', book.title);
                      if (title === null) return;
                      const subtitle = prompt('New subtitle:', book.subtitle || '');
                      const description = prompt('New description:', book.description || '');
                      await handleEditSave(book.slug, {
                        title: title.trim() || book.title,
                        subtitle: subtitle?.trim() ?? book.subtitle,
                        description: description?.trim() ?? book.description,
                      });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="btn-secondary"
                    style={{
                      padding: '6px 12px', fontSize: '0.72rem', borderRadius: 999,
                      color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.35)',
                    }}
                    onClick={() => handleDelete(book.slug)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
