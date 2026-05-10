'use client';

// ============================================================
// ClassroomStoryForm — V1 mode-aware Studio form for educators.
//
// Mirrors BookGenerator.tsx in how it handles loading state,
// duplicate-click guard, polling, and sessionStorage resume —
// reuses the same RESUME_KEY so a refresh during generation works
// regardless of which mode the in-flight job belongs to.
//
// Inputs: gradeBand (required), subject, chapter/topic, learning
// goal, language, tone. POSTs to /api/books/generate with
// { mode: 'classroom', payload }. Output is a private book that
// only the cookie owner can read.
// ============================================================

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';

const RESUME_KEY = 'katha:active-generation';
type Status = 'idle' | 'generating' | 'polling' | 'done' | 'error';

const GRADE_BANDS = ['Class 1-3', 'Class 4-5', 'Class 6-7', 'Class 8-9', 'Class 10+'];
const TONES = ['Gentle', 'Adventurous', 'Funny', 'Mythical', 'Inspiring'];
const LANGUAGES = ['English', 'Hindi'];

function persistResume(slug: string, title: string) {
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({
      slug, title, startedAt: Date.now(),
    }));
  } catch { /* private mode / quota — non-fatal */ }
}

export default function ClassroomStoryForm() {
  const router = useRouter();
  const [gradeBand, setGradeBand] = useState(GRADE_BANDS[2]);
  const [subject, setSubject] = useState('');
  const [chapter, setChapter] = useState('');
  const [learningGoal, setLearningGoal] = useState('');
  const [language, setLanguage] = useState(LANGUAGES[0]);
  const [tone, setTone] = useState(TONES[0]);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<{ step: string; percent: number }>({ step: '', percent: 0 });
  const [error, setError] = useState('');
  const inFlightRef = useRef(false);

  const busy = status === 'generating' || status === 'polling';
  const canSubmit = !busy && gradeBand.trim().length > 0 && (subject.trim().length > 0 || chapter.trim().length > 0);

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!canSubmit) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus('generating');
    setError('');
    setProgress({ step: 'Starting…', percent: 0 });

    try {
      const res = await fetch('/api/books/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'classroom',
          payload: {
            gradeBand: gradeBand.trim(),
            subject: subject.trim() || undefined,
            chapter: chapter.trim() || undefined,
            learningGoal: learningGoal.trim() || undefined,
            language,
            tone,
          },
        }),
      });
      if (!res.ok) {
        let msg = '';
        try { const j = await res.json(); msg = j.error || ''; } catch { /* */ }
        throw new Error(msg || `Request failed (${res.status})`);
      }
      const data = await res.json();
      if (data.cached) {
        sessionStorage.removeItem(RESUME_KEY);
        router.push(`/books/${data.book.slug}`);
        return;
      }
      if (data.generating && data.slug) {
        persistResume(data.slug, chapter.trim() || subject.trim() || 'Classroom story');
        setStatus('polling');
        pollProgress(data.slug);
        return;
      }
      throw new Error('Unexpected response from book generator.');
    } catch (err: unknown) {
      inFlightRef.current = false;
      sessionStorage.removeItem(RESUME_KEY);
      setError(err instanceof Error ? err.message : 'Unable to create this story right now.');
      setStatus('error');
    }
  }

  async function pollProgress(slug: string) {
    let consecutiveFailures = 0;
    const MAX_FAILURES = 8;
    const poll = async () => {
      try {
        const res = await fetch(`/api/books/generate?slug=${slug}`);
        if (!res.ok) {
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_FAILURES) {
            inFlightRef.current = false;
            sessionStorage.removeItem(RESUME_KEY);
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
          inFlightRef.current = false;
          sessionStorage.removeItem(RESUME_KEY);
          setStatus('done');
          setProgress({ step: 'Story ready!', percent: 100 });
          setTimeout(() => router.push(`/books/${slug}`), 1000);
          return;
        }
        if (data.error) {
          inFlightRef.current = false;
          sessionStorage.removeItem(RESUME_KEY);
          setError(data.error);
          setStatus('error');
          return;
        }
        setProgress({ step: data.step || 'Working…', percent: data.percent || 0 });
        setTimeout(poll, 1500);
      } catch {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_FAILURES) {
          inFlightRef.current = false;
          sessionStorage.removeItem(RESUME_KEY);
          setError('Lost connection to the book generator. Try again in a moment.');
          setStatus('error');
          return;
        }
        setTimeout(poll, 2000);
      }
    };
    poll();
  }

  // Re-attach to an in-flight classroom job after a refresh. Reuses
  // the shared RESUME_KEY so cross-mode resume works.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(RESUME_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Date.now() - saved.startedAt > 30 * 60 * 1000) {
        sessionStorage.removeItem(RESUME_KEY);
        return;
      }
      // Only resume if this slug is recognizable as a classroom one
      // (cl- prefix). Otherwise leave it for whichever form owns it.
      if (typeof saved.slug !== 'string' || !saved.slug.startsWith('cl-')) return;
      inFlightRef.current = true;
      setStatus('polling');
      setProgress({ step: 'Reattaching to your story…', percent: 0 });
      pollProgress(saved.slug);
    } catch { /* */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="classroom-form"
      className="glass-card"
      style={{ padding: 32, marginBottom: 0, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(43,27,21,0.46)' }}
    >
      <div style={{ fontSize: '0.72rem', color: 'var(--color-gold)', textTransform: 'uppercase', letterSpacing: '0.22em', marginBottom: 8 }}>
        Classroom Story
      </div>
      <h2 className="font-serif" style={{ fontSize: '1.6rem', color: 'var(--color-gold-light)', marginBottom: 8 }}>
        Build a story around a topic.
      </h2>
      <p style={{ color: 'var(--color-text-dim)', fontSize: '0.92rem', marginBottom: 22, lineHeight: 1.6, maxWidth: 680 }}>
        Tuned for a grade band — vocabulary, pacing, and a recap baked into the final scene. Your classroom stories are saved privately to this browser; only you can open them.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 16 }}>
        <FieldSelect label="Class / grade" value={gradeBand} options={GRADE_BANDS} onChange={setGradeBand} />
        <FieldText  label="Subject (optional)" value={subject} onChange={setSubject} placeholder="History, Stories, Civics" />
      </div>
      <div style={{ marginBottom: 16 }}>
        <FieldText label="Chapter / topic" value={chapter} onChange={setChapter} placeholder='e.g. "Akbar and Birbal — wisdom of the courts"' required />
      </div>
      <div style={{ marginBottom: 16 }}>
        <FieldText label="Learning goal (optional)" value={learningGoal} onChange={setLearningGoal} placeholder='e.g. "Understand why Birbal is remembered for wit and fairness"' />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}>
        <FieldSelect label="Language" value={language} options={LANGUAGES} onChange={setLanguage} />
        <FieldSelect label="Tone" value={tone} options={TONES} onChange={setTone} />
      </div>

      <motion.button
        type="submit"
        whileHover={{ scale: canSubmit ? 1.04 : 1 }}
        whileTap={{ scale: canSubmit ? 0.96 : 1 }}
        disabled={!canSubmit}
        className="btn-primary"
        style={{ opacity: canSubmit ? 1 : 0.6 }}
      >
        {busy ? 'Creating…' : 'Generate Classroom Story'}
      </motion.button>

      <AnimatePresence>
        {busy && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ marginTop: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-gold)' }}>{progress.step}</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-dim)' }}>{Math.round(progress.percent)}%</span>
            </div>
            <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden' }}>
              <motion.div animate={{ width: `${progress.percent}%` }} transition={{ duration: 0.5 }}
                style={{ height: '100%', background: 'linear-gradient(90deg, var(--color-saffron), var(--color-gold))', borderRadius: 4 }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {status === 'done' && (
        <p style={{ color: '#5CDB95', marginTop: 12, fontWeight: 600 }}>Story ready. Opening…</p>
      )}
      {error && (
        <p style={{ color: '#ff8a8a', marginTop: 12, fontSize: '0.9rem' }}>❌ {error}</p>
      )}
    </form>
  );
}

// ── Field primitives ─────────────────────────────────────────

function FieldText({ label, value, onChange, placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean;
}) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>
        {label}{required ? ' *' : ''}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        style={{
          width: '100%', padding: '10px 14px',
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(212,168,71,0.3)',
          borderRadius: 10, color: 'white', fontSize: '0.95rem', outline: 'none',
        }}
      />
    </label>
  );
}

function FieldSelect({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', padding: '10px 14px',
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(212,168,71,0.3)',
          borderRadius: 10, color: 'white', fontSize: '0.95rem', outline: 'none',
        }}
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
