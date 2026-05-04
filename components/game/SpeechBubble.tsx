'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface SpeechBubbleData {
  hotspotId: string;
  characterName: string;
  x: number; // % from left
  y: number; // % from top
  text: string;
}

interface Props {
  bubble: SpeechBubbleData | null;
  onDismiss: () => void;
}

export default function SpeechBubble({ bubble, onDismiss }: Props) {
  const [displayedText, setDisplayedText] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!bubble) { setDisplayedText(''); setDone(false); return; }
    setDisplayedText('');
    setDone(false);
    let i = 0;
    const interval = setInterval(() => {
      if (i <= bubble.text.length) {
        setDisplayedText(bubble.text.slice(0, i));
        i++;
      } else {
        clearInterval(interval);
        setDone(true);
      }
    }, 22);
    return () => clearInterval(interval);
  }, [bubble?.hotspotId]);

  // Auto-dismiss after 6s
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [done, onDismiss]);

  if (!bubble) return null;

  // Keep bubble inside viewport
  const left = Math.min(Math.max(bubble.x, 8), 68);
  const top = bubble.y > 50 ? bubble.y - 22 : bubble.y + 16;

  return (
    <AnimatePresence>
      <motion.div
        key={bubble.hotspotId}
        initial={{ opacity: 0, scale: 0.85, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: -6 }}
        transition={{ type: 'spring', damping: 22, stiffness: 260 }}
        style={{
          position: 'absolute',
          left: `${left}%`,
          top: `${top}%`,
          zIndex: 20,
          maxWidth: '28%',
          minWidth: 180,
        }}
        onClick={onDismiss}
      >
        {/* Bubble */}
        <div style={{
          background: 'rgba(12,8,6,0.94)',
          border: '1.5px solid var(--color-gold)',
          borderRadius: 14,
          padding: '10px 14px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 20px rgba(212,168,71,0.2)',
          position: 'relative',
          cursor: 'pointer',
        }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-saffron)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            💬 {bubble.characterName}
          </div>
          <p className="narration-text" style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.55, color: 'var(--color-text-light)' }}>
            {displayedText}
            {!done && (
              <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.5, repeat: Infinity }}
                style={{ display: 'inline-block', width: 2, height: '0.9em', background: 'var(--color-gold)', marginLeft: 2, verticalAlign: 'text-bottom' }} />
            )}
          </p>
          {done && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ fontSize: '0.65rem', color: 'var(--color-text-dim)', marginTop: 8, margin: '8px 0 0' }}>
              Click to learn more →
            </motion.p>
          )}
          {/* Tail */}
          <div style={{
            position: 'absolute', bottom: -8, left: 20,
            width: 0, height: 0,
            borderLeft: '8px solid transparent',
            borderRight: '8px solid transparent',
            borderTop: '8px solid var(--color-gold)',
          }} />
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
