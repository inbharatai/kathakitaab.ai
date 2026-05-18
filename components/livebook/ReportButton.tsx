'use client';

// Small "Report" button that opens a one-screen form. Rendered in
// the live reader so anyone (signed-in or anonymous) can flag a
// scene or whole book.

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  bookSlug: string;
  /** Optional scene to report. When omitted the report is book-level. */
  sceneId?: string;
}

type Reason = 'inappropriate' | 'inaccurate' | 'copyright' | 'other';

const REASONS: { key: Reason; label: string }[] = [
  { key: 'inappropriate', label: 'Inappropriate / unsafe content' },
  { key: 'inaccurate', label: 'Factually or culturally inaccurate' },
  { key: 'copyright', label: 'Copyright concern' },
  { key: 'other', label: 'Something else' },
];

export function ReportButton({ bookSlug, sceneId }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>('inappropriate');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  async function submit() {
    setStatus('sending');
    setError('');
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookSlug, sceneId, reason, notes }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setStatus('sent');
      closeTimerRef.current = setTimeout(() => { setOpen(false); setStatus('idle'); setNotes(''); }, 1600);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Failed to send');
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
          setOpen(true);
        }}
        aria-label="Report this content"
        style={{
          padding: '6px 14px', borderRadius: 999,
          background: 'transparent', border: '1px solid rgba(255,255,255,0.18)',
          color: 'var(--color-text-dim)', cursor: 'pointer', fontSize: '0.72rem',
          letterSpacing: 0.4,
        }}
      >
        ⚑ Report
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 9999,
              background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
              display: 'grid', placeItems: 'center', padding: 20,
            }}
          >
            <motion.div
              initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.98, y: 8 }}
              onClick={e => e.stopPropagation()}
              style={{
                maxWidth: 440, width: '100%',
                background: 'rgba(20,12,8,0.94)', borderRadius: 16,
                border: '1px solid rgba(212,168,71,0.3)',
                padding: 24, color: 'var(--color-text-dim)',
              }}
            >
              <h3 className="font-serif" style={{ fontSize: '1.3rem', color: 'var(--color-gold-light)', margin: 0 }}>
                Report this {sceneId ? 'scene' : 'book'}
              </h3>
              <p style={{ fontSize: '0.86rem', marginTop: 6, lineHeight: 1.55 }}>
                Tell us what&apos;s off — we&apos;ll review and act on inappropriate or harmful content.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '16px 0' }}>
                {REASONS.map(r => (
                  <label key={r.key} style={{
                    display: 'flex', gap: 10, alignItems: 'center',
                    padding: '8px 10px', borderRadius: 8,
                    background: reason === r.key ? 'rgba(212,168,71,0.1)' : 'transparent',
                    cursor: 'pointer',
                  }}>
                    <input
                      type="radio"
                      name="reason"
                      checked={reason === r.key}
                      onChange={() => setReason(r.key)}
                    />
                    <span style={{ fontSize: '0.88rem', color: reason === r.key ? 'var(--color-gold-light)' : 'var(--color-text-dim)' }}>
                      {r.label}
                    </span>
                  </label>
                ))}
              </div>

              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="Anything else we should know? (optional)"
                style={{
                  width: '100%', padding: '10px 14px',
                  background: 'rgba(255,255,255,0.05)', borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.12)', color: 'white',
                  fontSize: '0.88rem', resize: 'vertical', outline: 'none',
                }}
              />

              {error && (
                <p style={{ color: '#ff8a8a', fontSize: '0.82rem', marginTop: 8 }}>{error}</p>
              )}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
                <button
                  type="button"
                  onClick={() => {
                    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
                    setOpen(false);
                  }}
                  disabled={status === 'sending'}
                  className="btn-secondary"
                  style={{ padding: '8px 18px' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={status === 'sending' || status === 'sent'}
                  className="btn-primary"
                  style={{ padding: '8px 18px' }}
                >
                  {status === 'sent' ? 'Reported · thanks' : status === 'sending' ? 'Sending…' : 'Send report'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
