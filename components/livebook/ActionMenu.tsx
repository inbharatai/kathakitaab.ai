'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type ActionMenuAction = 'ask' | 'change' | 'animate' | 'continue';

interface Props {
  isOpen: boolean;
  x: number;
  y: number;
  onSelect: (action: ActionMenuAction) => void;
  onChangeSubmit: (instruction: string) => void;
  onClose: () => void;
}

export default function ActionMenu({ isOpen, x, y, onSelect, onChangeSubmit, onClose }: Props) {
  const [isChangeMode, setIsChangeMode] = useState(false);
  const [changeText, setChangeText] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setIsChangeMode(false);
      setChangeText('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSelect = (action: ActionMenuAction) => {
    if (action === 'change') {
      setIsChangeMode(true);
      return;
    }

    onSelect(action);
    onClose();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!changeText.trim()) return;
    onChangeSubmit(changeText.trim());
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -6 }}
          transition={{ duration: 0.16 }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          style={{
            position: 'absolute',
            left: x,
            top: y,
            transform: 'translate(-50%, -100%)',
            zIndex: 30,
            minWidth: 190,
            maxWidth: 260,
            padding: 10,
            borderRadius: 16,
            background: 'rgba(12,8,6,0.92)',
            border: '1px solid rgba(255,255,255,0.1)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
          }}
        >
          {!isChangeMode ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <button
                onClick={() => handleSelect('ask')}
                style={menuButtonStyle}
              >
                Ask
              </button>
              <button
                onClick={() => handleSelect('change')}
                style={menuButtonStyle}
              >
                Change
              </button>
              <button
                onClick={() => handleSelect('animate')}
                style={menuButtonStyle}
              >
                Animate
                <span style={{ marginLeft: 6, fontSize: '0.65rem', color: 'rgba(255,255,255,0.5)' }}>beta</span>
              </button>
              <button
                onClick={() => handleSelect('continue')}
                style={menuButtonStyle}
              >
                Continue
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.65)' }}>
                What should change?
              </div>
              <input
                value={changeText}
                onChange={(event) => setChangeText(event.target.value)}
                placeholder="e.g. Make the river glow"
                style={{
                  minHeight: 38,
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  padding: '0 12px',
                  color: 'white',
                  fontSize: '0.82rem',
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={onClose} style={cancelButtonStyle}>
                  Cancel
                </button>
                <button type="submit" style={confirmButtonStyle}>
                  Update
                </button>
              </div>
            </form>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const menuButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  borderRadius: 10,
  padding: '8px 12px',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: 'var(--color-text-light)',
  cursor: 'pointer',
  fontSize: '0.82rem',
  fontWeight: 600,
};

const cancelButtonStyle: React.CSSProperties = {
  borderRadius: 999,
  padding: '6px 12px',
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.16)',
  color: 'var(--color-text-dim)',
  cursor: 'pointer',
  fontSize: '0.74rem',
};

const confirmButtonStyle: React.CSSProperties = {
  borderRadius: 999,
  padding: '6px 14px',
  background: 'linear-gradient(135deg, var(--color-saffron), var(--color-gold))',
  border: 'none',
  color: '#1a0e0a',
  cursor: 'pointer',
  fontSize: '0.74rem',
  fontWeight: 700,
};
