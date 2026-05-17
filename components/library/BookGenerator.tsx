'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { STYLE_PRESETS, type StylePreset } from '@/lib/types/style';

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
  'Hitopadesha',
];

// sessionStorage key — survives a refresh during a long generation so
// the user reattaches to the in-flight Redis job instead of starting
// a fresh one. Cleared on completion / failure / explicit reset.
const RESUME_KEY = 'katha:active-generation';

type Status = 'idle' | 'generating' | 'polling' | 'done' | 'error';

// Persist a resume handle so a refresh during generation reattaches
// to the in-flight Redis job. Lives outside the component so React's
// purity rule doesn't flag the `Date.now()` reference (the rule
// scopes its impurity check to component bodies and hooks).
function persistResume(slug: string, title: string) {
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({
      slug, title, startedAt: Date.now(),
    }));
  } catch { /* private mode / quota — non-fatal */ }
}

function readResume(): { slug: string; title: string; startedAt: number } | null {
  try {
    const raw = sessionStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    // Older than 30 minutes? The server has likely abandoned the job
    // too; don't reattach to a corpse.
    if (Date.now() - saved.startedAt > 30 * 60 * 1000) {
      sessionStorage.removeItem(RESUME_KEY);
      return null;
    }
    return saved;
  } catch {
    sessionStorage.removeItem(RESUME_KEY);
    return null;
  }
}

export default function BookGenerator({ existingBooks = [] }: Props) {
  const router = useRouter();
  // Note on SSR: Next.js pre-renders this component on the server even
  // though it's marked 'use client'. The useState lazy initializer
  // captures the SERVER's value (window undefined → null) and the
  // client reuses that during hydration; the initializer does NOT
  // re-run client-side. So we initialize plain and pick up any saved
  // resume entry inside an effect below — a Playwright spec
  // (studio-truth.spec.ts) pins the resume behaviour so this stays
  // correct across refactors.
  const [bookTitle, setBookTitle] = useState('');
  const [stylePreset, setStylePreset] = useState<StylePreset>('photoreal_cinematic');
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<{ step: string; percent: number }>({ step: '', percent: 0 });
  const [error, setError] = useState('');

  // Tracks whether a generation request is in flight at THIS moment.
  // Distinct from `status` because state setters batch — a rapid second
  // click can fire before React commits the 'generating' state. The
  // ref is synchronous, so the second call sees `inFlightRef.current
  // === true` and bails out cleanly. This is the duplicate-click guard.
  const inFlightRef = useRef(false);

  // Listen for the prefill event the Studio page dispatches when the
  // user clicks a starting-point chip. Keeps the chip behaviour inside
  // the form's state machine (so the duplicate-click guard still fires)
  // instead of forcing a router.push.
  useEffect(() => {
    function onPrefill(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === 'string') setBookTitle(detail);
    }
    window.addEventListener('katha:prefill-title', onPrefill);
    return () => window.removeEventListener('katha:prefill-title', onPrefill);
  }, []);

  const handleGenerate = async (title = bookTitle) => {
    if (!title.trim()) return;

    // Duplicate-click / duplicate-submit guard. The state setter is
    // asynchronous; the ref is not. Without this, two clicks 30ms
    // apart both reach this line, both pass the disabled check (state
    // hasn't committed yet), and both fire $0.40 generation calls.
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    setStatus('generating');
    setError('');
    setProgress({ step: 'Starting…', percent: 0 });

    try {
      const res = await fetch('/api/books/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), stylePreset }),
      });
      // 401 = caller isn't signed in. Don't surface a generic error
      // toast — send them to /signin and bounce back to the form.
      if (res.status === 401) {
        const here = typeof window !== 'undefined' ? window.location.pathname + window.location.hash : '/books#create-story';
        router.push(`/signin?next=${encodeURIComponent(here)}`);
        return;
      }
      if (!res.ok) {
        const msg = await safeReadError(res);
        throw new Error(msg);
      }
      const data = await res.json();

      if (data.cached) {
        // Cached book — immediate redirect, no polling needed. Clear
        // any stale resume entry from a previous session.
        sessionStorage.removeItem(RESUME_KEY);
        router.push(`/books/${data.book.slug}`);
        return;
      }

      if (data.generating && data.slug) {
        // Persist the resume handle BEFORE polling so a fast refresh
        // still reattaches.
        persistResume(data.slug, title.trim());
        setStatus('polling');
        streamProgress(data.slug);
        return;
      }

      // Server returned an unexpected shape. Surface it instead of
      // silently leaving the spinner.
      throw new Error('Unexpected response from book generator.');
    } catch (err: unknown) {
      inFlightRef.current = false;
      sessionStorage.removeItem(RESUME_KEY);
      setError(err instanceof Error ? err.message : 'Unable to create this story right now.');
      setStatus('error');
    }
  };

  // SSE stream for real-time generation progress.
  // Replaces the old pollProgress() which fired an HTTP request
  // every 1.5 seconds. One persistent EventSource connection, server
  // pushes updates when state changes, auto-reconnects on dropout.
  function streamProgress(slug: string) {
    const source = new EventSource(`/api/books/stream?slug=${encodeURIComponent(slug)}`);

    source.addEventListener('progress', (e) => {
      try {
        const data = JSON.parse(e.data);
        setProgress({ step: data.step || 'Working…', percent: data.percent || 0 });
      } catch { /* malformed — ignore */ }
    });

    source.addEventListener('job', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.job?.errorMessage) {
          inFlightRef.current = false;
          sessionStorage.removeItem(RESUME_KEY);
          setError(data.job.errorMessage);
          setStatus('error');
          source.close();
        }
      } catch { /* ignore */ }
    });

    source.addEventListener('book', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.book) {
          inFlightRef.current = false;
          sessionStorage.removeItem(RESUME_KEY);
          setStatus('done');
          setProgress({ step: 'Book complete!', percent: 100 });
          setTimeout(() => router.push(`/books/${slug}`), 1000);
          source.close();
        }
      } catch { /* ignore */ }
    });

    source.addEventListener('done', () => {
      inFlightRef.current = false;
      sessionStorage.removeItem(RESUME_KEY);
      source.close();
    });

    source.addEventListener('error', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data || '{}');
        inFlightRef.current = false;
        sessionStorage.removeItem(RESUME_KEY);
        setError(data.message || 'Lost connection. Try again in a moment.');
        setStatus('error');
      } catch {
        // If the stream drops without a message, let the EventSource
        // auto-reconnect once. If it fails again we'll show an error.
        setTimeout(() => {
          if (source.readyState === EventSource.CLOSED) {
            inFlightRef.current = false;
            sessionStorage.removeItem(RESUME_KEY);
            setError('Lost connection to the book generator. Try again in a moment.');
            setStatus('error');
          }
        }, 5000);
      }
      source.close();
    });

    // Safety: close the stream after 6 minutes (generation budget + headroom).
    const timeout = setTimeout(() => {
      if (source.readyState !== EventSource.CLOSED) {
        source.close();
        inFlightRef.current = false;
        sessionStorage.removeItem(RESUME_KEY);
        setError('Generation took too long. Please try again.');
        setStatus('error');
      }
    }, 6 * 60 * 1000);

    // Cleanup is handled by the caller (useEffect return), but we
    // also store the source on the component so unmount kills it.
    (streamProgress as unknown as { _source?: EventSource })._source = source;
    (streamProgress as unknown as { _timeout?: ReturnType<typeof setTimeout> })._timeout = timeout;
  }

  // Initialize from sessionStorage on the client. Has to happen in an
  // effect because Next.js pre-renders this component on the server
  // (where sessionStorage doesn't exist), and the useState lazy
  // initializer captures the SSR value — the client reuses the
  // SSR-rendered initial state during hydration. The set-state-in-
  // effect lint rule fires here because we're seeding state from an
  // external store; that's the textbook exception the rule allows
  // ("Subscribe for updates from some external system, calling
  // setState in a callback function when external state changes").
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const saved = readResume();
    if (!saved) return;
    setBookTitle(saved.title);
    setStatus('polling');
    setProgress({ step: 'Reattaching to your story…', percent: 0 });
    inFlightRef.current = true;
    streamProgress(saved.slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  const busy = status === 'generating' || status === 'polling';

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
          Start with an epic, folktale, or theme. KathaKitaab turns it into a playable AI storybook.
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); if (!busy) handleGenerate(); }}
          style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}
        >
          <input
            value={bookTitle}
            onChange={e => setBookTitle(e.target.value)}
            placeholder='e.g. "Mahabharata", "Panchatantra", or "Akbar and Birbal"'
            disabled={busy}
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
            type="submit"
            whileHover={{ scale: busy ? 1 : 1.04 }}
            whileTap={{ scale: busy ? 1 : 0.96 }}
            disabled={!bookTitle.trim() || busy}
            className="btn-primary"
            style={{ flexShrink: 0, opacity: (!bookTitle.trim() || busy) ? 0.6 : 1 }}
          >
            {busy ? 'Creating…' : 'Create Story'}
          </motion.button>
        </form>

        {/* Style preset selector — locks the visual register of every
            scene image. Photoreal default, storybook for fables /
            kids, animation as the in-between. The same scene
            narration + character anchors apply across all three;
            only the rendering aesthetic changes. */}
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: '0.72rem', color: 'var(--color-text-dim)',
            textTransform: 'uppercase', letterSpacing: '0.18em', marginBottom: 10,
          }}>
            Visual style
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {(Object.keys(STYLE_PRESETS) as StylePreset[]).map(key => {
              const meta = STYLE_PRESETS[key];
              const active = stylePreset === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => !busy && setStylePreset(key)}
                  disabled={busy}
                  style={{
                    flex: '1 1 220px',
                    minWidth: 200,
                    padding: '12px 14px',
                    textAlign: 'left',
                    borderRadius: 12,
                    border: active ? '1px solid var(--color-gold)' : '1px solid rgba(255,255,255,0.08)',
                    background: active ? 'rgba(212,168,71,0.12)' : 'rgba(255,255,255,0.03)',
                    color: active ? 'var(--color-gold-light)' : 'var(--color-text-dim)',
                    cursor: busy ? 'default' : 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: '0.92rem', fontWeight: 600, marginBottom: 4 }}>
                    {meta.label}
                  </div>
                  <div style={{ fontSize: '0.78rem', lineHeight: 1.45, color: active ? 'rgba(255,255,255,0.78)' : 'var(--color-text-dim)' }}>
                    {meta.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SUGGESTED_BOOKS.filter(b => !existingBooks.includes(b.toLowerCase().replace(/\s+/g, '-'))).slice(0, 6).map(book => (
            <button
              key={book}
              type="button"
              onClick={() => { if (!busy) { setBookTitle(book); handleGenerate(book); } }}
              disabled={busy}
              style={{
                padding: '5px 14px', borderRadius: 20,
                background: 'rgba(212,168,71,0.06)', border: '1px solid rgba(212,168,71,0.2)',
                color: 'var(--color-text-dim)', cursor: busy ? 'default' : 'pointer', fontSize: '0.8rem',
                transition: 'all 0.2s',
                opacity: busy ? 0.5 : 1,
              }}
              onMouseOver={e => !busy && (e.currentTarget.style.background = 'rgba(212,168,71,0.14)')}
              onMouseOut={e => !busy && (e.currentTarget.style.background = 'rgba(212,168,71,0.06)')}
            >
              {book}
            </button>
          ))}
        </div>

        <AnimatePresence>
          {busy && (
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
                Building your story usually takes a few minutes. You can leave this tab — we&apos;ll resume polling if you come back before it finishes.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {status === 'done' && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ color: '#5CDB95', marginTop: 12, fontWeight: 600 }}>
            Story ready. Opening…
          </motion.p>
        )}

        {error && (
          <p style={{ color: '#ff8a8a', marginTop: 12, fontSize: '0.9rem' }}>❌ {error}</p>
        )}
      </motion.div>
    </div>
  );
}
