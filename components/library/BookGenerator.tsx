'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';

interface Props {
  existingBooks?: string[];
}

const SUGGESTED_BOOKS = [
  'Mahabharata',
  'Panchatantra',
  'Akbar and Birbal Stories',
  'Tenali Raman',
  'Jataka Tales',
  'Vikram and Betaal',
  'NCERT History – Ancient India',
  'Hitopadesha',
];

export default function BookGenerator({ existingBooks = [] }: Props) {
  const router = useRouter();
  const [bookTitle, setBookTitle] = useState('');
  const [status, setStatus] = useState<'idle' | 'generating' | 'polling' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<{ step: string; percent: number }>({ step: '', percent: 0 });
  const [error, setError] = useState('');

  const handleGenerate = async (title = bookTitle) => {
    if (!title.trim()) return;
    setStatus('generating');
    setError('');
    setProgress({ step: 'Starting agents...', percent: 0 });

    try {
      const res = await fetch('/api/books/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() }),
      });
      // Vercel renders HTML error pages on 5xx, so check ok before
      // parsing — otherwise res.json() throws an opaque parse error
      // and the user sees nothing actionable.
      if (!res.ok) {
        const msg = await safeReadError(res);
        throw new Error(msg);
      }
      const data = await res.json();

      if (data.cached) {
        router.push(`/books/${data.book.slug}`);
        return;
      }

      if (data.generating) {
        setStatus('polling');
        pollProgress(data.slug);
        return;
      }

      // Neither cached nor generating — server returned an unexpected
      // shape. Surface it instead of silently leaving the spinner.
      throw new Error('Unexpected response from book generator.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to create this story right now.');
      setStatus('error');
    }
  };

  const pollProgress = async (slug: string) => {
    // Cap consecutive transient failures so a flaky network or a
    // permanently-broken slug doesn't loop forever.
    let consecutiveFailures = 0;
    const MAX_FAILURES = 8;

    const poll = async () => {
      try {
        const res = await fetch(`/api/books/generate?slug=${slug}`);
        if (!res.ok) {
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_FAILURES) {
            setError('Lost connection to the book generator. Try again in a moment.');
            setStatus('error');
            return;
          }
          setTimeout(poll, 2000);
          return;
        }
        consecutiveFailures = 0;
        const data = await res.json();

        if (data.done && data.book) {
          setStatus('done');
          setProgress({ step: 'Book complete!', percent: 100 });
          setTimeout(() => router.push(`/books/${slug}`), 1000);
          return;
        }

        if (data.error) {
          setError(data.error);
          setStatus('error');
          return;
        }

        setProgress({ step: data.step || 'Working...', percent: data.percent || 0 });
        setTimeout(poll, 1500);
      } catch {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_FAILURES) {
          setError('Lost connection to the book generator. Try again in a moment.');
          setStatus('error');
          return;
        }
        setTimeout(poll, 2000);
      }
    };
    poll();
  };

  // Best-effort error message extraction. Tries JSON first, falls back
  // to text, falls back to an HTTP-status string. Never throws.
  async function safeReadError(res: Response): Promise<string> {
    try {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const j = await res.json();
        return j.error || j.message || `Request failed (${res.status})`;
      }
      const t = await res.text();
      return t.slice(0, 200) || `Request failed (${res.status})`;
    } catch {
      return `Request failed (${res.status})`;
    }
  }

  return (
    <div id="create-story">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card"
        style={{ padding: 32, marginBottom: 0, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(43,27,21,0.46)' }}
      >
        <div style={{ fontSize: '0.72rem', color: 'var(--color-gold)', textTransform: 'uppercase', letterSpacing: '0.22em', marginBottom: 8 }}>
          Create a Story
        </div>
        <h2 className="font-serif" style={{ fontSize: '1.75rem', color: 'var(--color-gold-light)', marginBottom: 10 }}>
          Name the world you want to enter.
        </h2>
        <p style={{ color: 'var(--color-text-dim)', fontSize: '0.95rem', marginBottom: 24, lineHeight: 1.7, maxWidth: 680 }}>
          Start with a book, folktale, or classroom theme. KathaKitaab.ai will turn it into a clean playable storybook.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <input
            value={bookTitle}
            onChange={e => setBookTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleGenerate()}
            placeholder='e.g. "Mahabharata" or "Panchatantra" or "NCERT Science Grade 6"'
            disabled={status === 'generating' || status === 'polling'}
            style={{
              flex: 1, minWidth: 240,
              padding: '12px 18px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(212,168,71,0.3)',
              borderRadius: 12, color: 'white', fontSize: '1rem',
              outline: 'none',
            }}
          />
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => handleGenerate()}
            disabled={!bookTitle.trim() || status === 'generating' || status === 'polling'}
            className="btn-primary"
            style={{ flexShrink: 0, opacity: (!bookTitle.trim() || status === 'generating' || status === 'polling') ? 0.6 : 1 }}
          >
            {status === 'generating' || status === 'polling' ? 'Creating...' : 'Create Story'}
          </motion.button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SUGGESTED_BOOKS.filter(b => !existingBooks.includes(b.toLowerCase().replace(/\s+/g, '-'))).slice(0, 6).map(book => (
            <button
              key={book}
              onClick={() => { setBookTitle(book); handleGenerate(book); }}
              disabled={status === 'generating' || status === 'polling'}
              style={{
                padding: '5px 14px', borderRadius: 20,
                background: 'rgba(212,168,71,0.06)', border: '1px solid rgba(212,168,71,0.2)',
                color: 'var(--color-text-dim)', cursor: 'pointer', fontSize: '0.8rem',
                transition: 'all 0.2s',
              }}
              onMouseOver={e => (e.currentTarget.style.background = 'rgba(212,168,71,0.14)')}
              onMouseOut={e => (e.currentTarget.style.background = 'rgba(212,168,71,0.06)')}
            >
              {book}
            </button>
          ))}
        </div>

        <AnimatePresence>
          {(status === 'generating' || status === 'polling') && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={{ marginTop: 24 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-gold)' }}>{progress.step}</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-dim)' }}>{Math.round(progress.percent)}%</span>
              </div>
              <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden' }}>
                <motion.div
                  animate={{ width: `${progress.percent}%` }}
                  transition={{ duration: 0.5 }}
                  style={{ height: '100%', background: 'linear-gradient(90deg, var(--color-saffron), var(--color-gold))', borderRadius: 4 }}
                />
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-dim)', marginTop: 8 }}>
                Building your story world usually takes about a minute.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {status === 'done' && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ color: '#5CDB95', marginTop: 12, fontWeight: 600 }}>
            Story ready. Opening...
          </motion.p>
        )}

        {error && (
          <p style={{ color: '#ff8a8a', marginTop: 12, fontSize: '0.9rem' }}>❌ {error}</p>
        )}
      </motion.div>
    </div>
  );
}
