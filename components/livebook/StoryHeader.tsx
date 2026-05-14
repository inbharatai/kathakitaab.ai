'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState, useCallback, useRef } from 'react';

interface Props {
  isMuted: boolean;
  isNarrating: boolean;
  onToggleMute: () => void;
  onToggleNarration: () => void;
}

export default function StoryHeader({
  isMuted,
  isNarrating,
  onToggleMute,
  onToggleNarration,
}: Props) {
  const [isCompact, setIsCompact] = useState<boolean>(() => (
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  ));
  // Single music control: a slider appears inline when the user clicks
  // the music icon. Dragging to 0 effectively mutes; clicking the icon
  // again hides the slider. Removes the previous duplicate "Mute"
  // button — cleaner and matches what the user asked for.
  const [volume, setVolume] = useState<number>(0.33);
  const [showSlider, setShowSlider] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    import('@/lib/audio/musicOrchestrator').then(m => {
      const v = m.loadPersistedMusicVolume();
      if (!cancelled) setVolume(v);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onResize = () => setIsCompact(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Close the slider when clicking outside.
  useEffect(() => {
    if (!showSlider) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setShowSlider(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [showSlider]);

  const onVolumeChange = useCallback((next: number) => {
    setVolume(next);
    import('@/lib/audio/musicOrchestrator').then(m => m.setUserMusicVolume(next));
    if (next > 0 && isMuted) onToggleMute();
  }, [isMuted, onToggleMute]);

  const musicIcon = isMuted ? '🔇' : volume === 0 ? '🔈' : volume < 0.4 ? '🔉' : '🔊';

  return (
    <motion.div
      ref={containerRef}
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.2, type: 'spring', damping: 20 }}
      style={{
        position: isCompact ? 'sticky' : 'fixed',
        top: isCompact ? 'calc(env(safe-area-inset-top, 0px) + 8px)' : 14,
        right: isCompact ? 'auto' : 18,
        left: isCompact ? 0 : 'auto',
        width: isCompact ? '100%' : 'auto',
        display: 'flex',
        justifyContent: isCompact ? 'center' : 'flex-end',
        zIndex: 120,
        pointerEvents: 'auto',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: isCompact ? 'wrap' : 'nowrap',
        gap: 6,
        padding: 6,
        maxWidth: isCompact ? 'calc(100% - 16px)' : 'none',
        margin: isCompact ? '0 8px 6px' : 0,
        borderRadius: 999,
        background: 'rgba(12,8,6,0.82)',
        border: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(16px)',
      }}>
        {/* Music — single combined control. Click to open volume.
            Long-press / right-click toggles mute. */}
        <button
          onClick={() => setShowSlider(s => !s)}
          onContextMenu={e => { e.preventDefault(); onToggleMute(); }}
          title={isMuted ? 'Music muted (click to unmute)' : 'Music — click to adjust volume'}
          aria-label="Music volume"
          style={{
            background: showSlider ? 'rgba(255,153,51,0.15)' : 'rgba(255,255,255,0.08)',
            border: `1px solid ${showSlider ? 'var(--color-saffron, #E97A3A)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: 999,
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: '0.95rem',
            color: 'white',
            transition: 'background 0.18s, border-color 0.18s',
          }}
        >
          {musicIcon}
        </button>

        <AnimatePresence initial={false}>
          {showSlider && (
            <motion.div
              key="vol"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.18 }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 6, overflow: 'hidden' }}
            >
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={e => onVolumeChange(Number(e.target.value))}
                aria-label="Music volume slider"
                style={{
                  width: 96,
                  accentColor: 'var(--color-saffron, #E97A3A)',
                  cursor: 'pointer',
                }}
              />
              <span style={{
                fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)', minWidth: 28, textAlign: 'right',
              }}>
                {Math.round((isMuted ? 0 : volume) * 100)}
              </span>
              <button
                onClick={onToggleMute}
                title={isMuted ? 'Unmute' : 'Mute'}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 999,
                  padding: '3px 9px',
                  cursor: 'pointer',
                  fontSize: '0.7rem',
                  color: 'rgba(255,255,255,0.75)',
                }}
              >
                {isMuted ? 'Unmute' : 'Mute'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Narration — separate concern, separate button */}
        <button
          onClick={onToggleNarration}
          title={isNarrating ? 'Stop reading' : 'Read aloud'}
          aria-label={isNarrating ? 'Stop narration' : 'Read aloud'}
          style={{
            background: isNarrating ? 'rgba(255,153,51,0.18)' : 'rgba(255,255,255,0.08)',
            border: `1px solid ${isNarrating ? 'var(--color-saffron, #E97A3A)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: 999,
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: '0.85rem',
            color: 'white',
          }}
        >
          {isNarrating ? '⏹ Stop' : '🔊 Read'}
        </button>
      </div>
    </motion.div>
  );
}
