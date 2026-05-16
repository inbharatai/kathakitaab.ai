'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/useAuth';

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

export default function AdminPage() {
  const { user, loading } = useAuth();
  const [books, setBooks] = useState<AdminBook[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isAdmin = user?.email === 'reetu004@gmail.com';

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    fetch('/api/admin/books')
      .then(r => (r.ok ? r.json() : null))
      .then((data: { books?: AdminBook[] } | null) => {
        if (!cancelled && data?.books) setBooks(data.books);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isAdmin]);

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

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-gold)' }}>
        Loading...
      </div>
    );
  }

  if (!isAdmin) {
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
          <span style={{ color: 'var(--color-text-dim)', fontSize: '0.88rem' }}>{user?.email}</span>
          <Link href="/books" style={{ color: 'var(--color-gold-light)', fontSize: '0.88rem' }}>Library →</Link>
        </div>
      </nav>

      <h1 style={{ fontSize: 'clamp(1.6rem, 3vw, 2.2rem)', color: 'var(--color-gold-light)', marginBottom: 8 }}>All Books</h1>
      <p style={{ color: 'var(--color-text-dim)', marginBottom: 24 }}>{books.length} total · admin override enabled</p>

      {error && (
        <div style={{ color: '#ff6b6b', marginBottom: 16, padding: 12, borderRadius: 8, background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.25)' }}>
          {error}
        </div>
      )}

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
