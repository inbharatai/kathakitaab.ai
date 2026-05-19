'use client';

// ============================================================
// PersonalizedStoryForm — V1 text-only personalization.
//
// IMPORTANT: this form does NOT accept photo uploads. The hero
// is described by name/age/interests; image generation paints a
// generic age-appropriate child. See PERSONALIZED_STORY_PLAN.md
// V3 for the photo-upload roadmap.
//
// Required: parent/guardian consent + first-name-only child name
// + age 3-12. Server enforces these too — the form just gives the
// user fast, clear errors before the round-trip.
//
// All personalized stories are private by default. The cookie
// owner is the only person who can read or delete them. The
// generated book's slug is random (pv-…); it never contains the
// child's name.
// ============================================================

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { StylePresetPicker } from './StylePresetPicker';
import type { StylePreset } from '@/lib/types/style';

const RESUME_KEY = 'katha:active-generation';
type Status = 'idle' | 'generating' | 'polling' | 'done' | 'error';

const TONES = ['Warm and adventurous', 'Funny', 'Magical', 'Calming bedtime', 'Inspiring'];
const LANGUAGES = ['English', 'Hindi'];

function persistResume(slug: string, title: string) {
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({
      slug, title, startedAt: Date.now(),
    }));
  } catch { /* */ }
}

export default function PersonalizedStoryForm() {
  const router = useRouter();
  const [childName, setChildName] = useState('');
  const [age, setAge] = useState<number | ''>(7);
  const [language, setLanguage] = useState(LANGUAGES[0]);
  const [interests, setInterests] = useState('');
  const [prompt, setPrompt] = useState('');
  const [moral, setMoral] = useState('');
  const [tone, setTone] = useState(TONES[0]);
  // Personalized children's stories default to watercolour storybook
  // — soft register that works at any age. Parents can switch to
  // animation, photoreal, or comic_book (for older kids). Universal
  // across all 5 presets, same as the other two modes.
  const [stylePreset, setStylePreset] = useState<StylePreset>('storybook_watercolor');
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<{ step: string; percent: number }>({ step: '', percent: 0 });
  const [error, setError] = useState('');
  const inFlightRef = useRef(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const busy = status === 'generating' || status === 'polling';

  // Same client-side validation the server enforces. Catching it
  // here gives users an immediate, useful message — server
  // validation is the security boundary.
  const trimmedName = childName.trim();
  const isFirstNameOnly = trimmedName.length > 0 && !/\s/.test(trimmedName);
  const ageOk = typeof age === 'number' && age >= 3 && age <= 12;
  const canSubmit = !busy && isFirstNameOnly && ageOk && consent;

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
          mode: 'personalized_text',
          payload: {
            childName: trimmedName,
            age: age as number,
            language,
            interests: interests.trim() || undefined,
            prompt: prompt.trim() || undefined,
            moral: moral.trim() || undefined,
            tone,
            consent: true,
          },
          stylePreset,
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
        persistResume(data.slug, `${trimmedName}'s Story`);
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
          pollTimeoutRef.current = setTimeout(poll, 2000);
          return;
        }
        consecutiveFailures = 0;
        const data = await res.json();
        if (data.done && data.book) {
          inFlightRef.current = false;
          sessionStorage.removeItem(RESUME_KEY);
          setStatus('done');
          setProgress({ step: 'Story ready!', percent: 100 });
          redirectTimeoutRef.current = setTimeout(() => router.push(`/books/${slug}`), 1000);
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
        pollTimeoutRef.current = setTimeout(poll, 1500);
      } catch {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_FAILURES) {
          inFlightRef.current = false;
          sessionStorage.removeItem(RESUME_KEY);
          setError('Lost connection to the book generator. Try again in a moment.');
          setStatus('error');
          return;
        }
        pollTimeoutRef.current = setTimeout(poll, 2000);
      }
    };
    poll();
  }

  // Resume an in-flight personalized job after a refresh.
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
      if (typeof saved.slug !== 'string' || !saved.slug.startsWith('pv-')) return;
      inFlightRef.current = true;
      setStatus('polling');
      setProgress({ step: 'Reattaching to your story…', percent: 0 });
      pollProgress(saved.slug);
    } catch { /* */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
      if (redirectTimeoutRef.current) clearTimeout(redirectTimeoutRef.current);
    };
  }, []);

  const nameError = childName.length > 0 && !isFirstNameOnly
    ? 'Please enter the child’s first name only.'
    : '';

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="personalized-form"
      className="glass-card"
      style={{ padding: 32, marginBottom: 0, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(43,27,21,0.46)' }}
    >
      <div style={{ fontSize: '0.72rem', color: 'var(--color-gold)', textTransform: 'uppercase', letterSpacing: '0.22em', marginBottom: 8 }}>
        Personalized Story
      </div>
      <h2 className="font-serif" style={{ fontSize: '1.6rem', color: 'var(--color-gold-light)', marginBottom: 8 }}>
        A story where your child is the hero.
      </h2>
      <p style={{ color: 'var(--color-text-dim)', fontSize: '0.92rem', marginBottom: 20, lineHeight: 1.6, maxWidth: 680 }}>
        Text-only for now: your child appears by name and personality, not photo. The art shows a generic age-appropriate child. Your story is saved privately to this browser; only you can open or delete it.
      </p>

      <div style={{
        marginBottom: 18, padding: '12px 16px',
        borderRadius: 10, border: '1px dashed rgba(255,215,0,0.24)',
        background: 'rgba(43,27,21,0.4)', fontSize: '0.78rem', color: 'var(--color-text-dim)', lineHeight: 1.55,
      }}>
        Note: child photo upload is coming later, after we ship the consent + private-bucket safety stack.
        <br />Today, KathaKitaab does <strong>not</strong> ask you to upload any photo.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
        <FieldText
          label="Child first name"
          value={childName}
          onChange={setChildName}
          placeholder="e.g. Asha"
          required
          error={nameError}
        />
        <FieldNumber
          label="Age"
          value={age}
          onChange={setAge}
          min={3}
          max={12}
          required
        />
        <FieldSelect label="Language" value={language} options={LANGUAGES} onChange={setLanguage} />
        <FieldSelect label="Tone" value={tone} options={TONES} onChange={setTone} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <FieldText label="Interests (optional)" value={interests} onChange={setInterests} placeholder="dinosaurs, space, kindness, drawing" />
      </div>
      <div style={{ marginBottom: 16 }}>
        <FieldTextarea label="Story idea (optional)" value={prompt} onChange={setPrompt} placeholder="e.g. a treasure hunt in the forest where she helps an injured bird" />
      </div>
      <div style={{ marginBottom: 18 }}>
        <FieldText label="Moral / lesson (optional)" value={moral} onChange={setMoral} placeholder="kindness, courage, honesty" />
      </div>

      <div style={{ marginBottom: 18 }}>
        <StylePresetPicker value={stylePreset} onChange={setStylePreset} disabled={busy} />
      </div>

      <label
        data-testid="personalized-consent"
        style={{
          display: 'flex', gap: 10, alignItems: 'flex-start',
          padding: '12px 14px', borderRadius: 10,
          border: '1px solid rgba(212,168,71,0.25)',
          background: 'rgba(43,27,21,0.4)', marginBottom: 18, cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          style={{ marginTop: 3, accentColor: 'var(--color-gold)' }}
        />
        <span style={{ fontSize: '0.84rem', color: 'var(--color-text-dim)', lineHeight: 1.55 }}>
          I confirm I am the parent or guardian of this child, or have permission to create this story.
          KathaKitaab will store the story privately to this browser and let me delete it at any time.
        </span>
      </label>

      <motion.button
        type="submit"
        whileHover={{ scale: canSubmit ? 1.04 : 1 }}
        whileTap={{ scale: canSubmit ? 0.96 : 1 }}
        disabled={!canSubmit}
        className="btn-primary"
        style={{ opacity: canSubmit ? 1 : 0.6 }}
      >
        {busy ? 'Creating…' : trimmedName ? `Create ${trimmedName}'s Story` : 'Create Personalized Story'}
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

// ── Field primitives (small duplication vs ClassroomStoryForm,
// kept inline to keep each form readable. They will diverge as
// each form grows, so I'm not extracting prematurely.) ─────────

function FieldText({ label, value, onChange, placeholder, required, error }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; error?: string;
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
        aria-invalid={!!error}
        style={{
          width: '100%', padding: '10px 14px',
          background: 'rgba(255,255,255,0.05)',
          border: `1px solid ${error ? '#ff8a8a' : 'rgba(212,168,71,0.3)'}`,
          borderRadius: 10, color: 'white', fontSize: '0.95rem', outline: 'none',
        }}
      />
      {error && <span style={{ display: 'block', marginTop: 4, fontSize: '0.74rem', color: '#ff8a8a' }}>{error}</span>}
    </label>
  );
}

function FieldNumber({ label, value, onChange, min, max, required }: {
  label: string; value: number | ''; onChange: (v: number | '') => void; min: number; max: number; required?: boolean;
}) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>
        {label}{required ? ' *' : ''}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '') onChange('');
          else onChange(Number(v));
        }}
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

function FieldTextarea({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        style={{
          width: '100%', padding: '10px 14px',
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(212,168,71,0.3)',
          borderRadius: 10, color: 'white', fontSize: '0.95rem', outline: 'none', resize: 'vertical',
        }}
      />
    </label>
  );
}
