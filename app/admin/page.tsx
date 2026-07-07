'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { OWNER_COOKIE, isValidOwnerId } from '@/lib/auth/ownerId';

interface AdminBook {
  id?: string;
  slug: string;
  title: string;
  subtitle?: string;
  description?: string;
  mode?: string;
  visibility?: string;
  ownerId?: string | null;
  coverImage?: string;
}

interface AdminJob {
  id: string;
  slug: string;
  title: string;
  status: string;
  currentStep: string | null;
  totalSteps: number;
  completedSteps: number;
  resumable: boolean;
  errorMessage?: string;
  userId: string | null;
  mode: string;
  createdAt: number;
}

export default function AdminPage() {
  const [books, setBooks] = useState<AdminBook[]>([]);
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [seedMessage, setSeedMessage] = useState('');

  // Anonymous-only mode: there's no login. The backend /api/admin/*
  // routes gate on the katha:owner cookie against KATHA_ADMIN_OWNER_IDS.
  // This page keeps a soft ?owner=1 sessionStorage gate so it isn't
  // indexed/linked as the admin surface; the real authorization is
  // the cookie + env allowlist enforced server-side.
  const [ownerGatePassed] = useState(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get('owner') === '1') {
      sessionStorage.setItem('katha_admin_gate', '1');
      return true;
    }
    return sessionStorage.getItem('katha_admin_gate') === '1';
  });

  // Surface the caller's owner id so the operator can copy it into
  // KATHA_ADMIN_OWNER_IDS to grant themselves admin. Read-only, client
  // side, never transmitted.
  const [ownerId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const want = `${OWNER_COOKIE}=`;
    for (const part of document.cookie.split(';')) {
      const t = part.trim();
      if (t.startsWith(want)) {
        const v = decodeURIComponent(t.slice(want.length));
        if (isValidOwnerId(v)) return v;
        return null;
      }
    }
    return null;
  });

  const showAdmin = ownerGatePassed;

  useEffect(() => {
    if (!showAdmin) return;
    let cancelled = false;
    fetch('/api/admin/books')
      .then(r => (r.ok ? r.json() : null))
      .then((data: { books?: AdminBook[] } | null) => {
        if (!cancelled && data?.books) setBooks(data.books);
      })
      .catch(() => {});
    fetch('/api/admin/jobs')
      .then(r => (r.ok ? r.json() : null))
      .then((data: { jobs?: AdminJob[] } | null) => {
        if (!cancelled && data?.jobs) setJobs(data.jobs);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [showAdmin]);

  async function deleteBook(slug: string) {
    if (!confirm(`Delete ${slug}?`)) return;
    setBusy(true);
    const res = await fetch(`/api/books/${slug}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) {
      setBooks(prev => prev.filter(b => b.slug !== slug));
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Delete failed');
    }
  }

  async function hydrateBook(slug: string) {
    setBusy(true);
    const res = await fetch(`/api/admin/books/${slug}`, { method: 'POST' });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      alert(`Hydrated ${data.scenesHydrated} scenes for ${slug}`);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Hydration failed');
    }
  }

  async function resumeJob(slug: string) {
    setBusy(true);
    const res = await fetch('/api/books/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
    setBusy(false);
    if (res.ok) {
      alert(`Resume triggered for ${slug}`);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Resume failed');
    }
  }

  async function seedShowcase(force = false) {
    setBusy(true);
    setSeedMessage('');
    const res = await fetch(`/api/admin/seed-showcase${force ? '?force=true' : ''}`, { method: 'POST' });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setSeedMessage(data.message || 'Seed initiated.');
    } else {
      setError(data.error || 'Seed failed');
    }
  }

  async function deleteJob(id: string, _slug: string) {
    if (!confirm(`Delete job ${_slug}?`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/jobs/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) {
      setJobs(prev => prev.filter(j => j.id !== id));
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Delete job failed');
    }
  }

  if (!showAdmin) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ color: 'var(--color-gold)', fontSize: '1.2rem' }}>Admin access only.</div>
        <Link href="/" style={{ color: 'var(--color-gold-light)' }}>← Home</Link>
      </div>
    );
  }

  return (
    <main style={{ minHeight: '100vh', padding: '80px 24px 60px', maxWidth: 1200, margin: '0 auto' }}>
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40,
        padding: '14px 24px',
        background: 'rgba(12,8,6,0.82)', backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16
      }}>
        <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '1.3rem' }}>🔧</span>
          <span style={{ fontWeight: 800, fontSize: '1.1rem', background: 'linear-gradient(135deg, #E8832A, #D4A847)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Admin
          </span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ color: 'var(--color-text-dim)', fontSize: '0.78rem', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ownerId ?? undefined}>
            {ownerId ? `owner: ${ownerId.slice(0, 12)}…` : 'owner: —'}
          </span>
          <Link href="/books" style={{ color: 'var(--color-gold-light)', fontSize: '0.88rem' }}>Library →</Link>
        </div>
      </nav>

      {ownerId && (
        <p style={{ color: 'var(--color-text-dim)', fontSize: '0.8rem', marginBottom: 16, padding: 10, borderRadius: 8, background: 'rgba(43,27,21,0.45)', border: '1px solid rgba(255,255,255,0.06)' }}>
          Your owner id: <code style={{ color: 'var(--color-gold-light)' }}>{ownerId}</code>. If the admin actions below 403, add this id to <code>KATHA_ADMIN_OWNER_IDS</code> and redeploy.
        </p>
      )}

      <h1 style={{ fontSize: 'clamp(1.6rem, 3vw, 2.2rem)', color: 'var(--color-gold-light)', marginBottom: 8 }}>Generation Jobs</h1>
      <p style={{ color: 'var(--color-text-dim)', marginBottom: 24 }}>{jobs.length} total · admin override enabled</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20, marginBottom: 40 }}>
        {jobs.map(job => (
          <div
            key={job.id}
            style={{
              borderRadius: 12,
              background: 'rgba(43,27,21,0.45)',
              border: '1px solid rgba(255,215,0,0.12)',
              padding: 18,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: 'var(--color-gold-light)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {job.title}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-dim)' }}>
                {job.slug} · {job.status} · {job.mode}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-dim)', marginTop: 2 }}>
                Step {job.completedSteps} / {job.totalSteps}
                {job.errorMessage && (
                  <span style={{ color: '#ff6b6b', marginLeft: 8 }}>{job.errorMessage}</span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              {job.resumable && (
                <button
                  disabled={busy}
                  onClick={() => resumeJob(job.slug)}
                  style={{
                    fontSize: '0.78rem', padding: '6px 12px', borderRadius: 999,
                    background: 'rgba(251,191,36,0.1)', color: '#fbbf24',
                    border: '1px solid rgba(251,191,36,0.25)', cursor: 'pointer',
                  }}
                >
                  Resume
                </button>
              )}
              <button
                disabled={busy}
                onClick={() => deleteJob(job.id, job.slug)}
                style={{
                  fontSize: '0.78rem', padding: '6px 12px', borderRadius: 999,
                  background: 'rgba(255,107,107,0.1)', color: '#ff6b6b',
                  border: '1px solid rgba(255,107,107,0.25)', cursor: 'pointer',
                }}
              >
                Delete
              </button>
            </div>

            {job.userId && (
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-dim)' }}>Owner: {job.userId.slice(0, 12)}…</div>
            )}
          </div>
        ))}
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.06)', marginBottom: 40 }} />

      <h1 style={{ fontSize: 'clamp(1.6rem, 3vw, 2.2rem)', color: 'var(--color-gold-light)', marginBottom: 8 }}>All Books</h1>
      <p style={{ color: 'var(--color-text-dim)', marginBottom: 24 }}>{books.length} total · admin override enabled</p>

      {error && (
        <div style={{ color: '#ff6b6b', marginBottom: 16, padding: 12, borderRadius: 8, background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.25)' }}>
          {error}
        </div>
      )}
      {seedMessage && (
        <div style={{ color: '#4ade80', marginBottom: 16, padding: 12, borderRadius: 8, background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)' }}>
          {seedMessage}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        <button
          disabled={busy}
          onClick={() => seedShowcase(false)}
          style={{
            fontSize: '0.85rem', padding: '8px 16px', borderRadius: 999,
            background: 'rgba(212,168,71,0.15)', color: 'var(--color-gold-light)',
            border: '1px solid rgba(212,168,71,0.35)', cursor: 'pointer',
          }}
        >
          Seed Missing Showcase Books
        </button>
        <button
          disabled={busy}
          onClick={() => seedShowcase(true)}
          style={{
            fontSize: '0.85rem', padding: '8px 16px', borderRadius: 999,
            background: 'rgba(255,107,107,0.1)', color: '#ff6b6b',
            border: '1px solid rgba(255,107,107,0.25)', cursor: 'pointer',
          }}
        >
          Force-Rebuild All Showcase
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
        {books.map(book => (
          <div
            key={book.slug}
            style={{
              borderRadius: 12,
              background: 'rgba(43,27,21,0.45)',
              border: '1px solid rgba(255,215,0,0.12)',
              padding: 18,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 8,
                backgroundImage: book.coverImage ? `url(${book.coverImage})` : undefined,
                backgroundSize: 'cover', backgroundPosition: 'center',
                backgroundColor: 'rgba(12,8,6,0.6)',
                flexShrink: 0,
              }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--color-gold-light)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {book.title}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-dim)' }}>
                  {book.slug} · {book.visibility} · {book.mode}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <Link
                href={`/books/${book.slug}`}
                style={{ fontSize: '0.78rem', padding: '6px 12px', borderRadius: 999, background: 'rgba(255,215,0,0.1)', color: 'var(--color-gold-light)', textDecoration: 'none', border: '1px solid rgba(255,215,0,0.2)' }}
              >
                Read
              </Link>
              <Link
                href={`/books/${book.slug}/movie`}
                style={{ fontSize: '0.78rem', padding: '6px 12px', borderRadius: 999, background: 'rgba(255,215,0,0.1)', color: 'var(--color-gold-light)', textDecoration: 'none', border: '1px solid rgba(255,215,0,0.2)' }}
              >
                Movie
              </Link>
              <button
                disabled={busy}
                onClick={() => hydrateBook(book.slug)}
                style={{ fontSize: '0.78rem', padding: '6px 12px', borderRadius: 999, background: 'rgba(255,215,0,0.1)', color: 'var(--color-gold-light)', border: '1px solid rgba(255,215,0,0.2)', cursor: 'pointer' }}
              >
                Re-Hydrate
              </button>
              <button
                disabled={busy}
                onClick={() => deleteBook(book.slug)}
                style={{ fontSize: '0.78rem', padding: '6px 12px', borderRadius: 999, background: 'rgba(255,107,107,0.1)', color: '#ff6b6b', border: '1px solid rgba(255,107,107,0.25)', cursor: 'pointer' }}
              >
                Delete
              </button>
            </div>

            {book.ownerId && (
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-dim)' }}>Owner: {book.ownerId.slice(0, 12)}…</div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
