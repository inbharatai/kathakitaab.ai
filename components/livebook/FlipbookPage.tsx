'use client';

/**
 * FlipbookPage — the core Flipbook-style interaction component.
 *
 * Flipbook pattern: click a visual region → a NEW full visual page
 * slides in with generated content and its own clickable hotspots.
 *
 * Design:
 * - Takes over the scene area (not a side drawer)
 * - Shows a generated visual description area (gradient + icon + text)
 * - Shows AI answer with source label
 * - Shows 3-5 "next options" as clickable cards that go deeper
 * - User can type any custom question
 * - "← Back to scene" returns to the map
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface FlipbookPageData {
  label: 'CANON' | 'EXPLANATION' | 'INTERPRETATION' | 'CREATIVE';
  answer: string;
  source_note: string;
  next_options: string[];
  safety_note?: string;
  visual_description?: string;
}

export interface FlipbookEntry {
  id: string;
  targetLabel: string;
  agentType: 'character' | 'info' | 'free';
  targetId?: string;
  sceneId: string;
  sceneTitle?: string;
  portraitUrl?: string;
  question: string;
  data: FlipbookPageData | null;
  loading: boolean;
  error?: string;
  cached?: boolean;
}

interface Props {
  entry: FlipbookEntry;
  onClose: () => void;
  onDiveDeeper: (question: string, label?: string) => void;
  onXpEarned: (amount: number, x: number, y: number) => void;
  historyDepth: number;
  onBack: () => void;
}

// Colour system per label
const LABEL_THEME = {
  CANON:          { bg: 'rgba(19,136,8,0.12)',   border: 'rgba(19,136,8,0.4)',   color: '#5CDB95', icon: '📜' },
  EXPLANATION:    { bg: 'rgba(59,125,216,0.12)',  border: 'rgba(59,125,216,0.4)', color: '#79B8FF', icon: '🔍' },
  INTERPRETATION: { bg: 'rgba(155,89,182,0.12)', border: 'rgba(155,89,182,0.4)', color: '#C39BD3', icon: '🌟' },
  CREATIVE:       { bg: 'rgba(232,131,42,0.12)',  border: 'rgba(232,131,42,0.4)', color: '#F5A623', icon: '✨' },
} as const;

// Visual header gradient per agent type/character
const VISUAL_GRADIENTS: Record<string, string> = {
  rama:        'linear-gradient(135deg, #1a0e0a 0%, #4a2200 40%, #c87941 70%, #ffd700 100%)',
  sita:        'linear-gradient(135deg, #1a0010 0%, #4a1830 40%, #b85090 70%, #ffd700 100%)',
  lakshmana:   'linear-gradient(135deg, #0a1a1a 0%, #1a4a3a 40%, #4aaa6a 70%, #c8d700 100%)',
  hanuman:     'linear-gradient(135deg, #1a0800 0%, #5a2500 40%, #e87020 70%, #ffd700 100%)',
  ravana:      'linear-gradient(135deg, #0a0000 0%, #3a0820 40%, #8a1030 70%, #c00000 100%)',
  dasharatha:  'linear-gradient(135deg, #10080a 0%, #3a1040 40%, #7a4090 70%, #c8a0d0 100%)',
  bharata:     'linear-gradient(135deg, #0a1000 0%, #2a3818 40%, #6a9038 70%, #d0e070 100%)',
  jatayu:      'linear-gradient(135deg, #100a00 0%, #402808 40%, #906040 70%, #d0b880 100%)',
  sugriva:     'linear-gradient(135deg, #100800 0%, #402000 40%, #906020 70%, #d0a040 100%)',
  vibhishana:  'linear-gradient(135deg, #000a10 0%, #002838 40%, #006088 70%, #40b8e0 100%)',
  default:     'linear-gradient(135deg, #1a0e0a 0%, #3a2010 40%, #7a5030 70%, #d4a847 100%)',
};

function getVisualGradient(targetId?: string) {
  if (!targetId) return VISUAL_GRADIENTS.default;
  return VISUAL_GRADIENTS[targetId] || VISUAL_GRADIENTS.default;
}

// Character emojis for visual header
const CHARACTER_EMBLEMS: Record<string, string> = {
  rama: '🏹', sita: '🌸', lakshmana: '⚔️', hanuman: '🌟',
  ravana: '👑', dasharatha: '🏛️', bharata: '🪔', jatayu: '🦅',
  sugriva: '🌿', vibhishana: '☯️',
};

export default function FlipbookPage({ entry, onClose, onDiveDeeper, onXpEarned, historyDepth, onBack }: Props) {
  const [customQ, setCustomQ] = useState('');
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [isResponseCollapsed, setIsResponseCollapsed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const theme = entry.data ? LABEL_THEME[entry.data.label] : LABEL_THEME.EXPLANATION;
  const gradient = getVisualGradient(entry.targetId);
  const emblem = entry.targetId ? (CHARACTER_EMBLEMS[entry.targetId] || '✦') : '🔍';
  const visualHeight = isResponseCollapsed ? '100%' : '36%';

  // Fetch a generated visual when the content loads
  useEffect(() => {
    if (!entry.data || entry.loading) return;
    if (generatedImageUrl) return; // already have one

    const agentType = entry.agentType === 'character' ? 'character' : 'info';
    const imageTargetId = entry.targetId || `${entry.sceneId}-${entry.targetLabel || 'scene'}`;
    const sceneTitle = entry.sceneTitle || entry.sceneId;

    fetch('/api/livebook/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetType: agentType,
        targetId: imageTargetId,
        sceneId: entry.sceneId,
        sceneTitle,
        label: entry.targetLabel,
        promptHint: entry.question,
      }),
    })
      .then(r => r.json())
      .then(json => {
        if (json.imageUrl && !json.error) setGeneratedImageUrl(json.imageUrl);
      })
      .catch(() => {});
  }, [entry.data, entry.loading, entry.targetId]); // eslint-disable-line

  // Auto-focus the input when loaded
  useEffect(() => {
    if (entry.data && !entry.loading) {
      setTimeout(() => inputRef.current?.focus(), 400);
    }
  }, [entry.data, entry.loading]);

  const handleCustomQ = useCallback(() => {
    const q = customQ.trim();
    if (!q) return;
    setCustomQ('');
    onDiveDeeper(q, entry.targetLabel);
  }, [customQ, onDiveDeeper, entry.targetLabel]);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={entry.id}
        initial={{ opacity: 0, y: 40, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -30, scale: 0.97 }}
        transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
        style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          background: '#0C0806',
          borderRadius: 16,
          overflow: 'hidden',
          zIndex: 30,
        }}
      >
        {/* ── Cinematic visual header ── */}
        <div style={{
          position: 'relative',
          height: visualHeight,
          background: gradient,
          flexShrink: 0,
          overflow: 'hidden',
        }}>
          {/* Animated bokeh */}
          {[...Array(6)].map((_, i) => (
            <motion.div
              key={i}
              animate={{
                x: [0, (i % 2 === 0 ? 1 : -1) * 30, 0],
                y: [0, (i % 3 === 0 ? -1 : 1) * 20, 0],
                opacity: [0.12, 0.25, 0.12],
              }}
              transition={{ duration: 6 + i * 1.5, repeat: Infinity, delay: i * 0.8 }}
              style={{
                position: 'absolute',
                width: 80 + i * 40, height: 80 + i * 40,
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(255,215,0,0.15) 0%, transparent 70%)',
                top: `${10 + i * 12}%`, left: `${5 + i * 14}%`,
                pointerEvents: 'none',
              }}
            />
          ))}

          {/* Generated image layer — replaces/augments portrait */}
          {generatedImageUrl ? (
            <motion.img
              src={generatedImageUrl}
              alt={entry.targetLabel}
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: isResponseCollapsed ? 0.88 : 0.55, scale: 1 }}
              transition={{ duration: 1.4 }}
              drag={isResponseCollapsed}
              dragElastic={0.08}
              dragConstraints={{ top: -40, bottom: 40, left: -60, right: 60 }}
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: 'cover', objectPosition: 'top center',
                filter: isResponseCollapsed ? 'brightness(0.78) saturate(1.4)' : 'brightness(0.62) saturate(1.3)',
                cursor: isResponseCollapsed ? 'grab' : 'default',
              }}
            />
          ) : entry.portraitUrl && (
            <motion.img
              src={entry.portraitUrl}
              alt={entry.targetLabel}
              initial={{ opacity: 0, scale: 1.08 }}
              animate={{ opacity: isResponseCollapsed ? 0.68 : 0.35, scale: 1 }}
              transition={{ duration: 1.2 }}
              drag={isResponseCollapsed}
              dragElastic={0.08}
              dragConstraints={{ top: -40, bottom: 40, left: -60, right: 60 }}
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: 'cover', objectPosition: 'top center',
                filter: isResponseCollapsed ? 'brightness(0.7) saturate(1.4)' : 'brightness(0.5) saturate(1.4)',
                cursor: isResponseCollapsed ? 'grab' : 'default',
              }}
            />
          )}

          {/* ← Back / close controls */}
          <div style={{
            position: 'absolute', top: 12, left: 12, right: 12,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            zIndex: 5,
          }}>
            <motion.button
              whileHover={{ scale: 1.06, x: -2 }}
              whileTap={{ scale: 0.94 }}
              onClick={historyDepth > 0 ? onBack : onClose}
              style={{
                background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
                color: 'rgba(255,255,255,0.8)', cursor: 'pointer',
                padding: '5px 12px', fontSize: '0.8rem', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {historyDepth > 0 ? '← Back' : '✕ Close'}
            </motion.button>

            {historyDepth > 0 && (
              <div style={{
                background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,215,0,0.25)', borderRadius: 8,
                color: 'var(--color-gold)', padding: '5px 12px',
                fontSize: '0.72rem', fontWeight: 600,
              }}>
                Depth {historyDepth + 1}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <motion.button
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.94 }}
                onClick={() => setIsResponseCollapsed(collapsed => !collapsed)}
                style={{
                  background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255,255,255,0.15)', borderRadius: 999,
                  color: 'rgba(255,255,255,0.8)', cursor: 'pointer',
                  padding: '6px 12px', fontSize: '0.72rem', fontWeight: 600,
                }}
              >
                {isResponseCollapsed ? 'Show text' : 'Hide text'}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.94 }}
                onClick={onClose}
                style={{
                  background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '50%',
                  color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
                  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1rem',
                }}
              >
                ✕
              </motion.button>
            </div>
          </div>

          {/* Character/topic identity */}
          <div style={{
            position: 'absolute', bottom: 16, left: 20,
            zIndex: 5,
          }}>
            <div style={{ fontSize: 'clamp(2rem, 6vw, 3rem)', marginBottom: 4 }}>{emblem}</div>
            <h2 className="font-serif" style={{
              margin: 0, fontSize: 'clamp(1.2rem, 3vw, 1.7rem)',
              fontWeight: 800, color: '#fff',
              textShadow: '0 2px 12px rgba(0,0,0,0.8)',
              lineHeight: 1.1,
            }}>
              {entry.targetLabel}
            </h2>
            <p style={{
              margin: '4px 0 0', fontSize: '0.75rem',
              color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: 1.5,
            }}>
              {entry.agentType === 'character' ? '💬 In Character' : entry.agentType === 'info' ? '📖 Deep Dive' : '🔍 Exploring'}
            </p>
          </div>
        </div>

        {!isResponseCollapsed && (
          <>
        {/* ── Scrollable content ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

          {/* Loading */}
          {entry.loading && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              style={{ padding: '40px 0', textAlign: 'center' }}
            >
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
                {[0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    animate={{ y: [-8, 8, -8] }}
                    transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18 }}
                    style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--color-gold)' }}
                  />
                ))}
              </div>
              <p style={{ color: 'var(--color-text-dim)', fontSize: '0.9rem' }}>
                {entry.agentType === 'character'
                  ? `${entry.targetLabel} is thinking...`
                  : 'Consulting the scriptures...'}
              </p>
            </motion.div>
          )}

          {/* Error */}
          {entry.error && !entry.loading && (
            <div style={{
              padding: 16, background: 'rgba(220,50,50,0.1)',
              border: '1px solid rgba(220,50,50,0.3)', borderRadius: 10, marginBottom: 12,
            }}>
              <p style={{ color: '#ff8a8a', margin: 0, fontSize: '0.9rem' }}>⚠️ {entry.error}</p>
            </div>
          )}

          {/* Content */}
          {entry.data && !entry.loading && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              {/* Label badge + cached indicator */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{
                  display: 'inline-flex', padding: '4px 14px', borderRadius: 20,
                  fontSize: '0.68rem', fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase',
                  background: theme.bg, color: theme.color, border: `1px solid ${theme.border}`,
                }}>
                  {theme.icon} {entry.data.label}
                </div>
                {entry.cached && (
                  <div style={{
                    padding: '3px 10px', borderRadius: 20,
                    fontSize: '0.62rem', color: 'rgba(255,255,255,0.3)',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}>
                    ⚡ cached
                  </div>
                )}
              </div>

              <AnimatePresence initial={false} mode="wait">
                {isResponseCollapsed ? (
                  <motion.div
                    key="collapsed-response"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    style={{
                      padding: '12px 14px', borderRadius: 12,
                      background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.1)',
                      color: 'var(--color-text-dim)', fontSize: '0.8rem',
                    }}
                  >
                    Generated text is hidden so the visual can stay in focus.
                  </motion.div>
                ) : (
                  <motion.div
                    key="expanded-response"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
                  >
                    <div style={{
                      padding: '16px 18px',
                      background: 'rgba(43,27,21,0.55)',
                      borderRadius: 12,
                      border: `1px solid ${theme.border}`,
                    }}>
                      <p className="narration-text" style={{ margin: 0, fontSize: '0.97rem', lineHeight: 1.8 }}>
                        {entry.data.answer}
                      </p>
                    </div>

                    {entry.data.next_options.length > 0 ? (
                      <div>
                        <h3 style={{
                          fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-gold)',
                          textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8,
                        }}>
                          ▼ Dive Deeper
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {entry.data.next_options.map((opt, i) => (
                            <motion.button
                              key={i}
                              whileHover={{ scale: 1.01, x: 5 }}
                              whileTap={{ scale: 0.97 }}
                              onClick={(e) => {
                                onDiveDeeper(opt, entry.targetLabel);
                                onXpEarned(25, (e as React.MouseEvent<HTMLButtonElement>).clientX || 400, (e as React.MouseEvent<HTMLButtonElement>).clientY || 300);
                              }}
                              style={{
                                textAlign: 'left', padding: '11px 16px',
                                background: 'rgba(212,168,71,0.04)',
                                border: '1px solid rgba(212,168,71,0.18)', borderRadius: 10,
                                color: 'var(--color-gold-light)', cursor: 'pointer', fontSize: '0.88rem',
                                display: 'flex', alignItems: 'flex-start', gap: 10,
                                lineHeight: 1.45,
                              }}
                            >
                              <span style={{ color: 'var(--color-saffron)', fontSize: '0.7rem', marginTop: 2, flexShrink: 0 }}>▶</span>
                              {opt}
                            </motion.button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div style={{
                      padding: '8px 14px', borderRadius: 8,
                      background: 'rgba(19,136,8,0.06)', border: '1px solid rgba(19,136,8,0.2)',
                      fontSize: '0.75rem', color: 'var(--color-text-dim)', fontStyle: 'italic',
                    }}>
                      📜 {entry.data.source_note}
                    </div>

                    {entry.data.safety_note ? (
                      <div style={{
                        padding: '8px 14px', borderRadius: 8,
                        background: 'rgba(255,153,51,0.06)', border: '1px solid rgba(255,153,51,0.2)',
                        fontSize: '0.72rem', color: 'rgba(255,153,51,0.7)', fontStyle: 'italic',
                      }}>
                        ⚠️ {entry.data.safety_note}
                      </div>
                    ) : null}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </div>

        {/* ── Ask bar (sticky bottom) ── */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid rgba(212,168,71,0.1)',
          background: 'rgba(12,8,6,0.9)',
          backdropFilter: 'blur(12px)',
          flexShrink: 0,
        }}>
          {/* Quick chips (character-specific) */}
          {entry.agentType === 'character' && !entry.loading && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {['What is dharma?', 'What should I learn from you?', 'Tell me your story.'].map(q => (
                <button
                  key={q}
                  onClick={() => { onDiveDeeper(q, entry.targetLabel); }}
                  style={{
                    padding: '4px 12px', borderRadius: 16,
                    background: 'rgba(212,168,71,0.06)', border: '1px solid rgba(212,168,71,0.18)',
                    color: 'var(--color-text-dim)', cursor: 'pointer', fontSize: '0.74rem',
                    transition: 'all 0.15s',
                  }}
                  onMouseOver={e => { (e.target as HTMLElement).style.background = 'rgba(212,168,71,0.14)'; }}
                  onMouseOut={e => { (e.target as HTMLElement).style.background = 'rgba(212,168,71,0.06)'; }}
                >
                  ✦ {q}
                </button>
              ))}
            </div>
          )}

          {/* Free text input */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              ref={inputRef}
              value={customQ}
              onChange={e => setCustomQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !entry.loading) handleCustomQ(); }}
              placeholder={entry.agentType === 'character'
                ? `Ask ${entry.targetLabel} anything...`
                : 'Explore deeper — ask anything...'}
              disabled={entry.loading}
              style={{
                flex: 1, padding: '10px 16px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(212,168,71,0.3)',
                borderRadius: 12, color: '#fff', fontSize: '0.9rem',
                outline: 'none',
              }}
            />
            <motion.button
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              onClick={handleCustomQ}
              disabled={!customQ.trim() || entry.loading}
              style={{
                width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                background: customQ.trim() && !entry.loading
                  ? 'linear-gradient(135deg, var(--color-saffron), var(--color-gold))'
                  : 'rgba(212,168,71,0.1)',
                border: 'none',
                cursor: customQ.trim() && !entry.loading ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.1rem', transition: 'all 0.2s',
                color: customQ.trim() ? '#000' : 'rgba(255,255,255,0.3)',
              }}
            >
              {entry.loading ? '⋯' : '➤'}
            </motion.button>
          </div>
        </div>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
