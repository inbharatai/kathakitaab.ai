'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Scene } from '@/lib/types/livebook';

interface Props {
  scene: Scene;
  onReadAloud?: () => void;
  isNarrating?: boolean;
  showLearningPoints?: boolean;
  showReadAloudButton?: boolean;
}

export default function NarrationPanel({
  scene,
  onReadAloud,
  isNarrating,
  showLearningPoints = true,
  showReadAloudButton = true,
}: Props) {
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping]           = useState(false);
  const [isCompact, setIsCompact]         = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  ));
  const [isExpanded, setIsExpanded]       = useState(false);

  useEffect(() => {
    const handleResize = () => setIsCompact(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Typewriter effect on scene change
  useEffect(() => {
    let intervalId: number | undefined;
    const resetTimer = window.setTimeout(() => {
      setDisplayedText('');
      setIsTyping(true);
      setIsExpanded(false);

      let i = 0;
      const text = scene.narration;
      intervalId = window.setInterval(() => {
        if (i <= text.length) {
          setDisplayedText(text.slice(0, i));
          i += 1;
        } else if (intervalId) {
          window.clearInterval(intervalId);
          setIsTyping(false);
        }
      }, 18);
    }, 0);

    return () => {
      window.clearTimeout(resetTimer);
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [scene.narration, scene.scene_id]);

  const excerpt = useMemo(() => {
    const limit = 280;
    if (displayedText.length <= limit) return displayedText;
    const trimmed = displayedText.slice(0, limit).replace(/\s+\S*$/, '');
    return `${trimmed}...`;
  }, [displayedText]);

  const shouldShowExcerpt = isCompact && !isExpanded;
  const shouldShowLearning = showLearningPoints && (!isCompact || isExpanded);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="glass-card"
      style={{ marginTop: 24, overflow: 'hidden' }}
    >
      {/* ── Header row — always visible ── */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'clamp(14px, 3vw, 24px) clamp(20px, 4vw, 40px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ fontSize: 'clamp(1rem, 2.5vw, 1.4rem)', fontWeight: 700, color: 'var(--color-saffron-light)', margin: 0 }}>
            {scene.title}
          </h2>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {onReadAloud && showReadAloudButton ? (
            <button
              onClick={onReadAloud}
              title={isNarrating ? 'Stop reading' : 'Read aloud'}
              style={{
                background: isNarrating ? 'rgba(255,153,51,0.2)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${isNarrating ? 'var(--color-saffron)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 8, padding: '5px 12px', cursor: 'pointer',
                color: isNarrating ? 'var(--color-saffron)' : 'var(--color-text-dim)',
                fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {isNarrating ? '⏹ Stop' : '🔊 Read'}
              {isNarrating && (
                <span style={{ display: 'inline-flex', gap: 2 }}>
                  {[0,1,2].map(i => (
                    <motion.span key={i} animate={{ scaleY: [1, 2.5, 1] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                      style={{ display: 'inline-block', width: 3, height: 10, background: 'var(--color-saffron)', borderRadius: 2 }}
                    />
                  ))}
                </span>
              )}
            </button>
          ) : null}
        </div>
      </div>

      <AnimatePresence initial={false}>
        <motion.div
          key="content"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          style={{ overflow: 'hidden' }}
        >
          <div style={{ padding: '0 clamp(20px, 4vw, 40px) clamp(20px, 4vw, 36px)' }}>
            <p className="narration-text" style={{ position: 'relative', margin: 0 }}>
              {shouldShowExcerpt ? excerpt : displayedText}
              {isTyping && (
                <motion.span
                  animate={{ opacity: [1, 0] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                  style={{ display: 'inline-block', width: 2, height: '1em', background: 'var(--color-gold)', marginLeft: 2, verticalAlign: 'text-bottom' }}
                />
              )}
            </p>

            {!isTyping && isCompact && displayedText.length > excerpt.length ? (
              <button
                onClick={() => setIsExpanded(value => !value)}
                style={{
                  marginTop: 10,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 999,
                  padding: '6px 12px',
                  color: 'var(--color-text-light)',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                }}
              >
                {isExpanded ? 'Read less' : 'Read more'}
              </button>
            ) : null}

            {!isTyping && shouldShowLearning && scene.learning_points.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
                style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid rgba(212,168,71,0.1)' }}
              >
                <h3 style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-dim)', marginBottom: 14 }}>
                  🎓 Learning Points
                </h3>
                <ul style={{ paddingLeft: 0, margin: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {scene.learning_points.map((point, i) => (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.08 * i }}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 10, color: 'var(--color-gold-light)', fontSize: '0.93rem', lineHeight: 1.5 }}
                    >
                      <span style={{ color: 'var(--color-saffron)', flexShrink: 0, marginTop: 2 }}>✦</span>
                      {point}
                    </motion.li>
                  ))}
                </ul>
              </motion.div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
