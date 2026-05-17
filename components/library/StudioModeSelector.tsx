'use client';

// ============================================================
// StudioModeSelector — segmented control + per-mode form switcher.
//
// Three modes:
//   • Story World        → existing BookGenerator (universal title)
//   • Classroom Story    → ClassroomStoryForm (grade/topic/goal)
//   • Personalized Story → PersonalizedStoryForm (name/age, no photo)
//
// State lives at this top-level component so switching modes
// preserves nothing — each mode has its own form state. We
// deliberately don't try to share fields across modes; the inputs
// are different enough that "smart" cross-mode copying would
// confuse more than it'd help.
// ============================================================

import { useState } from 'react';
import { motion } from 'framer-motion';
import BookGenerator from './BookGenerator';
import PersonalizedStoryForm from './PersonalizedStoryForm';

type Mode = 'world' | 'personalized';

const MODES: { id: Mode; label: string; sublabel: string }[] = [
  { id: 'world',        label: 'Story World',         sublabel: 'Mahabharata, Akbar–Birbal, any title' },
  { id: 'personalized', label: 'Personalized Story',  sublabel: 'Your child as the hero (text)' },
];

export default function StudioModeSelector() {
  const [mode, setMode] = useState<Mode>('world');

  return (
    <div data-testid="studio-mode-selector">
      {/* Segmented control. Each tab is a real <button> for keyboard
          + a11y; the active state is purely visual. */}
      <div
        role="tablist"
        aria-label="Creation mode"
        style={{
          display: 'flex', gap: 6, padding: 6,
          marginBottom: 18,
          borderRadius: 14,
          background: 'rgba(12,8,6,0.55)',
          border: '1px solid rgba(255,215,0,0.1)',
          flexWrap: 'wrap',
        }}
      >
        {MODES.map((m) => {
          const active = m.id === mode;
          return (
            <button
              key={m.id}
              role="tab"
              aria-selected={active}
              data-testid={`mode-tab-${m.id}`}
              onClick={() => setMode(m.id)}
              style={{
                flex: '1 1 200px', minWidth: 0,
                padding: '10px 14px', borderRadius: 10,
                background: active ? 'linear-gradient(135deg, rgba(232,131,42,0.95), rgba(212,168,71,0.95))' : 'transparent',
                color: active ? '#0C0806' : 'var(--color-gold-light)',
                border: 'none', cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.18s ease, color 0.18s ease',
              }}
            >
              <span style={{ display: 'block', fontWeight: 800, fontSize: '0.92rem', letterSpacing: 0.2 }}>
                {m.label}
              </span>
              <span style={{ display: 'block', fontSize: '0.74rem', opacity: 0.8, marginTop: 2 }}>
                {m.sublabel}
              </span>
            </button>
          );
        })}
      </div>

      {/* Per-mode form. Mounting/unmounting is intentional — switching
          modes resets the form state, which is what users want when
          they change their mind about what to create. */}
      <motion.div
        key={mode}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
      >
        {mode === 'world' && <BookGenerator />}
        {mode === 'personalized' && <PersonalizedStoryForm />}
      </motion.div>
    </div>
  );
}
