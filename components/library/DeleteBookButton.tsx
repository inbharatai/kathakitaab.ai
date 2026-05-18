'use client';

// ============================================================
// DeleteBookButton — owner-only delete affordance for private books.
//
// Mounted on the reader page header. The button itself is HIDDEN
// when the book isn't private OR the cookie owner doesn't match —
// the server enforces those rules too, so a user who somehow forces
// the button to appear still hits a 404. Two clicks: first arms the
// confirm state, second sends the DELETE.
// ============================================================

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  bookSlug: string;
}

export default function DeleteBookButton({ bookSlug }: Props) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Decide visibility from the book's metadata. Calling /api/books/<slug>
  // returns 404 for non-owners, so a successful response with
  // mode != 'world' (private classroom/personalized) tells us the
  // current cookie owns this book and the button should appear.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/books/${bookSlug}`);
        if (!res.ok) return;
        const data = await res.json();
        const book = data?.book ?? data;
        // Seed Ramayana doesn't have a mode field; AI-generated public
        // books have mode='world'. Either way, leave the button hidden.
        const isPrivate = book?.visibility === 'private'
          || book?.mode === 'classroom'
          || book?.mode === 'personalized_text';
        if (!cancelled && isPrivate) setVisible(true);
      } catch { /* fail closed — don't show the button on error */ }
    })();
    return () => {
      cancelled = true;
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    };
  }, [bookSlug]);

  if (!visible) return null;

  async function onClick() {
    if (busy) return;
    if (!confirming) {
      setConfirming(true);
      // Auto-revert if the user doesn't confirm within 5s — avoids
      // leaving the button in a "click-to-confirm" state forever.
      confirmTimeoutRef.current = setTimeout(() => setConfirming(false), 5000);
      return;
    }
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/books/${bookSlug}`, { method: 'DELETE' });
      if (!res.ok) {
        let msg = '';
        try { const j = await res.json(); msg = j.error || ''; } catch { /* */ }
        throw new Error(msg || `Delete failed (${res.status})`);
      }
      // Successful delete → redirect to library.
      router.push('/books');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete this story.');
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <button
        type="button"
        data-testid="delete-book-button"
        onClick={onClick}
        disabled={busy}
        style={{
          padding: '7px 14px',
          borderRadius: 999,
          background: confirming ? 'rgba(232,90,90,0.95)' : 'rgba(43,27,21,0.55)',
          color: confirming ? '#0C0806' : '#ff8a8a',
          border: `1px solid ${confirming ? 'rgba(232,90,90,0.95)' : 'rgba(232,90,90,0.4)'}`,
          fontSize: '0.78rem',
          fontWeight: 700,
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Deleting…' : confirming ? 'Tap again to confirm' : 'Delete this story'}
      </button>
      {error && <span style={{ fontSize: '0.74rem', color: '#ff8a8a' }}>{error}</span>}
    </div>
  );
}
