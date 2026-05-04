'use client';

/**
 * SceneGenerating — Progress UI shown while a new scene is being generated.
 *
 * Shows animated steps:
 *   1. "Directing the story..."
 *   2. "Placing characters..."
 *   3. "Painting the scene..."
 *   4. Fades into the new scene
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const STEPS = [
  { label: 'Directing the story...', icon: '\u270D\uFE0F', duration: 3000 },
  { label: 'Placing characters...', icon: '\uD83C\uDFAD', duration: 4000 },
  { label: 'Painting the scene...', icon: '\uD83C\uDFA8', duration: 8000 },
];

interface Props {
  /** Optional message to show (e.g., "Continuing from: The Forest of Exile") */
  context?: string;
}

export default function SceneGenerating({ context }: Props) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    function advanceStep(idx: number) {
      if (idx >= STEPS.length - 1) return;
      timeout = setTimeout(() => {
        setStepIndex(idx + 1);
        advanceStep(idx + 1);
      }, STEPS[idx].duration);
    }

    advanceStep(0);
    return () => clearTimeout(timeout);
  }, []);

  const currentStep = STEPS[stepIndex];

  return (
    <div
      className="scene-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        background: 'radial-gradient(ellipse at center, rgba(42,24,16,0.95) 0%, rgba(12,8,6,1) 100%)',
      }}
    >
      {/* Animated icon */}
      <motion.div
        key={stepIndex}
        initial={{ scale: 0.5, opacity: 0, rotate: -10 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        style={{ fontSize: '3rem' }}
      >
        {currentStep.icon}
      </motion.div>

      {/* Step label */}
      <AnimatePresence mode="wait">
        <motion.p
          key={stepIndex}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
          style={{
            color: 'var(--color-gold)',
            fontWeight: 600,
            fontSize: '1.1rem',
            textAlign: 'center',
          }}
        >
          {currentStep.label}
        </motion.p>
      </AnimatePresence>

      {/* Context line */}
      {context && (
        <p style={{
          color: 'rgba(255,255,255,0.4)',
          fontSize: '0.8rem',
          textAlign: 'center',
          maxWidth: 300,
        }}>
          {context}
        </p>
      )}

      {/* Progress dots */}
      <div style={{ display: 'flex', gap: 8 }}>
        {STEPS.map((_, i) => (
          <motion.div
            key={i}
            animate={{
              scale: i === stepIndex ? [1, 1.3, 1] : 1,
              opacity: i <= stepIndex ? 1 : 0.3,
            }}
            transition={i === stepIndex ? { duration: 1.5, repeat: Infinity } : {}}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: i <= stepIndex ? 'var(--color-gold)' : 'rgba(255,255,255,0.2)',
            }}
          />
        ))}
      </div>

      {/* Shimmer line */}
      <motion.div
        animate={{ x: [-200, 200] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          width: 200,
          height: 2,
          borderRadius: 1,
          background: 'linear-gradient(90deg, transparent, var(--color-gold), transparent)',
          opacity: 0.4,
        }}
      />
    </div>
  );
}
