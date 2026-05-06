'use client';

/**
 * SceneCanvas — Layered live scene renderer.
 *
 * Renders a scene as composable layers:
 *   1. Background (image or gradient fallback)
 *   2. Object layers (positioned, animated)
 *   3. Character layers (positioned, animated)
 *   4. Effect layers (particles, glow, etc.)
 *   5. Hotspot overlay (invisible touch targets)
 *   6. Contextual action menu
 *
 * This replaces SceneBackground + HotspotOverlay with a
 * unified, layered canvas that supports the StoryScene contract.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  StoryScene,
  SceneState,
  SceneHotspot,
  SceneEffect,
  HotspotClickAction,
} from '@/lib/types/storyScene';

// ── Glow filter for glow animations ──────────────────────────

function GlowFilter({ id, color }: { id: string; color?: string }) {
  const c = color ?? 'rgba(255,215,0,0.6)';
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }}>
      <defs>
        <filter id={id}>
          <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor={c} floodOpacity="0.7" />
          <feDropShadow dx="0" dy="0" stdDeviation="12" floodColor={c} floodOpacity="0.3" />
        </filter>
      </defs>
    </svg>
  );
}

// ── Action Menu for hotspots ─────────────────────────────────

interface ActionMenuPopup {
  hotspot: SceneHotspot;
  x: number;
  y: number;
}

/** SceneStream manifest action status, keyed by `${entityId}:${verb}`.
 * 'ready'   = warmed branch in cache, instant tap
 * 'pending' = canon-allowed but not yet warmed, will generate on click
 * 'none'    = no canon entry, generic fallback
 * Drives the green/amber dot next to each verb in the action menu. */
export type ActionStatusMap = Map<string, 'ready' | 'pending' | 'none'>;

function HotspotActionMenu({
  popup,
  actionStatus,
  onAction,
  onClose,
}: {
  popup: ActionMenuPopup;
  actionStatus?: ActionStatusMap;
  onAction: (hotspot: SceneHotspot, action: HotspotClickAction) => void;
  onClose: () => void;
}) {
  // Universal labels — extended for the role-locked actions surfaced
  // by canon (Hanuman.leap, Ravana.confront, Lakshmana.guard, etc.).
  // Any unknown action falls back to a Title-cased label so books with
  // novel canon vocabularies still render readably.
  const labels: Record<HotspotClickAction, string> = {
    ask: 'Ask',
    talk: 'Talk',
    inspect: 'Inspect',
    move: 'Move',
    change: 'Change',
    animate: 'Animate',
    continue: 'Continue',
    leap: 'Leap',
    fight: 'Fight',
    confront: 'Confront',
    observe: 'Observe',
    comfort: 'Comfort',
    guard: 'Guard',
    counsel: 'Counsel',
    ally: 'Ally',
    learn: 'Learn',
    petition: 'Petition',
    honor: 'Honor',
    follow: 'Follow',
  };
  const labelFor = (a: HotspotClickAction): string =>
    labels[a] ?? (String(a).charAt(0).toUpperCase() + String(a).slice(1));

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, y: -8 }}
      transition={{ duration: 0.15 }}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: `${popup.x}%`,
        top: `${popup.y}%`,
        transform: 'translate(-50%, -110%)',
        zIndex: 50,
        minWidth: 140,
        padding: 8,
        borderRadius: 14,
        background: 'rgba(12,8,6,0.94)',
        border: '1px solid rgba(255,255,255,0.1)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 12px 36px rgba(0,0,0,0.4)',
      }}
    >
      <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.45)', padding: '2px 8px 6px', fontWeight: 600 }}>
        {popup.hotspot.label}
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        {popup.hotspot.allowed_actions.map(action => {
          const statusKey = `${popup.hotspot.target_id}:${action}`;
          const status = actionStatus?.get(statusKey);
          const dot =
            status === 'ready'   ? { color: '#5CDB95', glow: 'rgba(92,219,149,0.6)', title: 'Branch ready — instant' }
          : status === 'pending' ? { color: '#F4B06A', glow: 'rgba(244,176,106,0.5)', title: 'Branch warming — first tap may take a moment' }
                                 : null;
          return (
            <button
              key={action}
              data-testid={`action-${action}`}
              data-action-status={status ?? 'unknown'}
              onClick={() => { onAction(popup.hotspot, action); onClose(); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                borderRadius: 8,
                padding: '7px 12px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.06)',
                color: 'rgba(255,255,255,0.88)',
                cursor: 'pointer',
                fontSize: '0.78rem',
                fontWeight: 600,
                textAlign: 'left',
              }}
            >
              <span style={{ flex: 1 }}>
                {labelFor(action)}
                {action === 'animate' && (
                  <span style={{ marginLeft: 6, fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)' }}>beta</span>
                )}
              </span>
              {dot && (
                <span
                  title={dot.title}
                  style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: dot.color,
                    boxShadow: `0 0 6px ${dot.glow}`,
                    marginLeft: 8,
                    flexShrink: 0,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Props ────────────────────────────────────────────────────

interface SceneCanvasProps {
  scene: StoryScene;
  sceneState?: SceneState;
  /** Show hotspot glow indicators (false = invisible overlay only) */
  showHotspotVisuals?: boolean;
  /** Set of hotspot IDs that have been preloaded */
  preloadedHotspots?: Set<string>;
  /** Per-(entity,action) cache state from the SceneStream manifest.
   * Keyed by `${entityId}:${verb}`. Drives the green/amber readiness
   * dot in the action menu so users can see which verbs are warmed
   * for instant tap and which will trigger a fresh generation. */
  actionStatus?: ActionStatusMap;
  /** Called when user selects an action on a hotspot */
  onHotspotAction?: (hotspot: SceneHotspot, action: HotspotClickAction) => void;
  /** Called when user clicks the background (no hotspot) */
  onBackgroundClick?: (xPct: number, yPct: number) => void;
  /** Called when user double-clicks the background */
  onBackgroundDoubleClick?: (xPct: number, yPct: number) => void;
  /** Whether to disable interactions (e.g., when flipbook is open) */
  disabled?: boolean;
}

// ── Component ────────────────────────────────────────────────

export default function SceneCanvas({
  scene,
  sceneState,
  showHotspotVisuals = false,
  preloadedHotspots,
  actionStatus,
  onHotspotAction,
  onBackgroundClick,
  onBackgroundDoubleClick,
  disabled = false,
}: SceneCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredHotspot, setHoveredHotspot] = useState<string | null>(null);
  const [actionPopup, setActionPopup] = useState<ActionMenuPopup | null>(null);

  // ── 2.5D parallax tilt ──
  // Tracks normalized pointer position [-1, 1]. Bound to a perspective
  // wrapper that tilts the scene (bg, particles, effects, hotspots)
  // in response to mouse movement. Disabled for touch / reduced-motion.
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const parallaxRaf = useRef<number | null>(null);
  const reducedMotion = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const noHover = window.matchMedia('(hover: none)').matches;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    reducedMotion.current = noHover || reduced;
    return () => {
      if (parallaxRaf.current) cancelAnimationFrame(parallaxRaf.current);
    };
  }, []);

  const handleParallaxMove = useCallback((e: React.MouseEvent) => {
    if (reducedMotion.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    if (parallaxRaf.current) cancelAnimationFrame(parallaxRaf.current);
    parallaxRaf.current = requestAnimationFrame(() => {
      setParallax({
        x: Math.max(-1, Math.min(1, nx)),
        y: Math.max(-1, Math.min(1, ny)),
      });
    });
  }, []);

  const handleParallaxLeave = useCallback(() => {
    if (parallaxRaf.current) cancelAnimationFrame(parallaxRaf.current);
    setParallax({ x: 0, y: 0 });
  }, []);

  // ── Click handlers ──

  const getPctFromEvent = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { xPct: 50, yPct: 50 };
    return {
      xPct: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
      yPct: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
    };
  }, []);

  const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    setActionPopup(null);
    const { xPct, yPct } = getPctFromEvent(e);
    onBackgroundClick?.(xPct, yPct);
  }, [disabled, getPctFromEvent, onBackgroundClick]);

  const handleBackgroundDoubleClick = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    const { xPct, yPct } = getPctFromEvent(e);
    onBackgroundDoubleClick?.(xPct, yPct);
  }, [disabled, getPctFromEvent, onBackgroundDoubleClick]);

  const handleHotspotClick = useCallback((hotspot: SceneHotspot, e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;

    // If only one action available, trigger immediately
    if (hotspot.allowed_actions.length === 1) {
      onHotspotAction?.(hotspot, hotspot.allowed_actions[0]);
      return;
    }

    // Show action menu
    setActionPopup({
      hotspot,
      x: hotspot.x + hotspot.width / 2,
      y: hotspot.y,
    });
  }, [disabled, onHotspotAction]);

  const handleActionSelect = useCallback((hotspot: SceneHotspot, action: HotspotClickAction) => {
    onHotspotAction?.(hotspot, action);
  }, [onHotspotAction]);

  return (
    <div
      ref={containerRef}
      className="scene-container"
      onClick={handleBackgroundClick}
      onDoubleClick={handleBackgroundDoubleClick}
      onMouseMove={handleParallaxMove}
      onMouseLeave={handleParallaxLeave}
      style={{
        position: 'relative',
        cursor: disabled ? 'default' : 'pointer',
        userSelect: 'none',
        overflow: 'hidden',
        perspective: 1400,
      }}
    >
      {/* SVG filter for hotspot glow */}
      <GlowFilter id="char-glow" color="rgba(255,215,0,0.6)" />

      {/* ── 2.5D parallax wrapper ──
          Wraps background, particles, effects, hotspots, and action
          menu in a perspective-tilted container that responds to
          mouse movement. Hint bar and badges sit outside so they
          stay flat to the screen. */}
      <div
        style={{
          position: 'absolute', inset: 0,
          transform: `rotateX(${-parallax.y * 2}deg) rotateY(${parallax.x * 3}deg)`,
          transition: 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
          willChange: 'transform',
          transformStyle: 'preserve-3d',
        }}
      >

      {/* ── Layer 1: Background with Ken Burns cinematic pan ── */}
      <div style={{ position: 'absolute', inset: 0 }}>
        {scene.background.image_url ? (
          <motion.div
            initial={{ scale: 1.08, opacity: 0 }}
            animate={{
              scale: [1.08, 1.12, 1.08],
              opacity: 1,
              x: [0, -15, 0],
              y: [0, -8, 0],
            }}
            transition={{
              scale: { duration: 25, repeat: Infinity, ease: 'easeInOut' },
              x: { duration: 30, repeat: Infinity, ease: 'easeInOut' },
              y: { duration: 20, repeat: Infinity, ease: 'easeInOut' },
              opacity: { duration: 1.2, ease: 'easeOut' },
            }}
            style={{
              position: 'absolute', inset: -20,
              backgroundImage: `url(${scene.background.image_url})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'brightness(0.82) saturate(1.15)',
            }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, background: scene.background.fallback_gradient }}>
            {/* Atmospheric bokeh overlays */}
            <motion.div
              animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.8, 0.5], x: [0, 20, 0], y: [0, -20, 0] }}
              transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                position: 'absolute', inset: -100,
                background: 'radial-gradient(ellipse at 30% 40%, rgba(212,168,71,0.08) 0%, transparent 60%)',
              }}
            />
            <motion.div
              animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0.7, 0.4], x: [0, -30, 0], y: [0, 20, 0] }}
              transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
              style={{
                position: 'absolute', inset: -100,
                background: 'radial-gradient(ellipse at 70% 60%, rgba(232,131,42,0.06) 0%, transparent 60%)',
              }}
            />
          </div>
        )}
      </div>

      {/* ── Ambient particles (fireflies/dust motes) ── */}
      {scene.background.image_url && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2, overflow: 'hidden' }}>
          {[...Array(8)].map((_, i) => (
            <motion.div
              key={`particle-${i}`}
              animate={{
                x: [0, 30 + i * 10, -20 + i * 5, 0],
                y: [0, -20 - i * 8, 15 + i * 3, 0],
                opacity: [0, 0.6, 0.3, 0],
                scale: [0.5, 1, 0.7, 0.5],
              }}
              transition={{
                duration: 8 + i * 2,
                repeat: Infinity,
                delay: i * 1.5,
                ease: 'easeInOut',
              }}
              style={{
                position: 'absolute',
                left: `${10 + i * 11}%`,
                top: `${20 + (i % 3) * 25}%`,
                width: 4,
                height: 4,
                borderRadius: '50%',
                background: 'rgba(255,215,0,0.6)',
                boxShadow: '0 0 8px rgba(255,215,0,0.4)',
              }}
            />
          ))}
        </div>
      )}

      {/* ── Layer 4: Effects ── */}
      {scene.effects.map(effect => (
        <EffectLayer key={effect.id} effect={effect} />
      ))}

      {/* ── Layer 5: Hotspot overlay (invisible touch targets) ── */}
      {!disabled && scene.hotspots.map((hotspot, hotspotIndex) => {
        const isHovered = hoveredHotspot === hotspot.id;
        const isPreloaded = preloadedHotspots?.has(hotspot.id);
        const isCharacter = hotspot.type === 'character';
        const pulseDelay = (hotspotIndex * 0.4) % 2; // stable, deterministic delay
        const color = isCharacter
          ? { ring: 'rgba(255,215,0,0.7)', glow: 'rgba(255,215,0,0.25)', dot: '#FFD700' }
          : { ring: 'rgba(232,131,42,0.7)', glow: 'rgba(232,131,42,0.25)', dot: '#FF9933' };
        // Y-depth: hotspots near the bottom of the scene render larger
        // (closer to the camera); hotspots near the top render smaller
        // (farther). Subtle but adds a real 2.5D feel.
        const depthScale = 0.85 + (Math.max(0, Math.min(100, hotspot.y)) / 100) * 0.35;
        const depthZ = 10 + Math.round(hotspot.y / 10); // closer hotspots stack on top

        return (
          <motion.button
            key={hotspot.id}
            aria-label={hotspot.tooltip ?? hotspot.label}
            data-testid={`hotspot-${hotspot.target_id}`}
            data-hotspot-type={hotspot.type}
            onClick={e => handleHotspotClick(hotspot, e)}
            onMouseEnter={() => setHoveredHotspot(hotspot.id)}
            onMouseLeave={() => setHoveredHotspot(null)}
            style={{
              position: 'absolute',
              left: `${hotspot.x}%`,
              top: `${hotspot.y}%`,
              width: `${Math.max(hotspot.width, 6)}%`,
              height: `${Math.max(hotspot.height, 8)}%`,
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              zIndex: depthZ,
              transform: `scale(${depthScale})`,
              transformOrigin: 'center',
            }}
          >
            {showHotspotVisuals && (
              <>
                {/* Pulse ring */}
                <motion.div
                  animate={{ scale: [1, 1.35, 1], opacity: [0.35, 0, 0.35] }}
                  transition={{ duration: 2.4, repeat: Infinity, delay: pulseDelay }}
                  style={{
                    position: 'absolute', inset: '20%',
                    borderRadius: '50%',
                    border: `1.5px solid ${color.ring}`,
                    pointerEvents: 'none',
                  }}
                />
                {/* Center dot */}
                <div style={{
                  position: 'absolute', top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 10, height: 10, borderRadius: '50%',
                  background: color.dot,
                  boxShadow: `0 0 ${isHovered ? 16 : 8}px ${color.dot}, 0 0 ${isHovered ? 32 : 16}px ${color.glow}`,
                  transition: 'box-shadow 0.2s ease',
                  pointerEvents: 'none',
                }} />
                {/* Hover highlight */}
                <AnimatePresence>
                  {isHovered && (
                    <motion.div
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      style={{
                        position: 'absolute', inset: 0, borderRadius: 8,
                        background: `radial-gradient(ellipse at center, ${color.glow} 0%, transparent 70%)`,
                        border: `1px solid ${color.ring}`,
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                </AnimatePresence>
                {/* Tooltip on hover */}
                <AnimatePresence>
                  {isHovered && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.15 }}
                      style={{
                        position: 'absolute', bottom: 'calc(100% + 10px)', left: '50%',
                        transform: 'translateX(-50%)', whiteSpace: 'nowrap',
                        padding: '5px 14px',
                        background: 'rgba(10,6,4,0.92)', backdropFilter: 'blur(8px)',
                        border: `1px solid ${color.ring}`, borderRadius: 8,
                        fontSize: '0.78rem', fontWeight: 700,
                        color: isCharacter ? '#FFD700' : '#FF9933',
                        pointerEvents: 'none',
                        boxShadow: `0 0 12px ${color.glow}`,
                        zIndex: 20,
                      }}
                    >
                      {hotspot.label}
                      {isCharacter && (
                        <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400, marginLeft: 6, fontSize: '0.65rem' }}>
                          click to interact
                        </span>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
                {/* Quick-speak bubble */}
                <AnimatePresence>
                  {isHovered && hotspot.quick_speak && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.85, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.85, y: 10 }}
                      transition={{ duration: 0.25, delay: 0.3 }}
                      style={{
                        position: 'absolute', top: 'calc(100% + 10px)', left: '50%',
                        transform: 'translateX(-50%)', maxWidth: 220,
                        padding: '8px 14px',
                        background: 'rgba(10,6,4,0.95)', backdropFilter: 'blur(10px)',
                        border: `1px solid ${color.ring}`, borderRadius: 10,
                        fontSize: '0.75rem', fontStyle: 'italic',
                        color: 'rgba(255,255,255,0.85)',
                        lineHeight: 1.5, pointerEvents: 'none',
                        zIndex: 20, textAlign: 'center',
                        boxShadow: `0 4px 20px ${color.glow}`,
                      }}
                    >
                      <span style={{ color: color.dot, fontSize: '0.65rem', fontStyle: 'normal' }}>{'\u275D'} </span>
                      {hotspot.quick_speak}
                      <span style={{ color: color.dot, fontSize: '0.65rem', fontStyle: 'normal' }}> {'\u275E'}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
                {/* Preload indicator */}
                {isPreloaded && (
                  <div style={{
                    position: 'absolute', top: 2, right: 2,
                    width: 8, height: 8, borderRadius: '50%',
                    background: '#5CDB95',
                    boxShadow: '0 0 6px rgba(92,219,149,0.8)',
                  }} />
                )}
              </>
            )}
          </motion.button>
        );
      })}

      {/* ── Layer 6: Action Menu Popup ── */}
      <AnimatePresence>
        {actionPopup && !disabled && (
          <HotspotActionMenu
            popup={actionPopup}
            actionStatus={actionStatus}
            onAction={handleActionSelect}
            onClose={() => setActionPopup(null)}
          />
        )}
      </AnimatePresence>

      {/* ── End 2.5D parallax wrapper ── */}
      </div>

      {/* ── Hint bar ── */}
      {!disabled && (
        <div style={{
          position: 'absolute', bottom: 10, left: 12, right: 12, zIndex: 6,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{
            padding: '3px 10px', borderRadius: 8,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            fontSize: '0.62rem', color: 'rgba(255,255,255,0.5)', pointerEvents: 'none',
          }}>
            Tap a character or object to interact. Tap anywhere to explore.
          </div>
        </div>
      )}

      {/* ── Unverified scene badge ──
          Shown when web research did not ground this scene, so the
          reader knows it's an AI interpretation rather than canon. */}
      {scene.unverified && (
        <div
          title={scene.verification_note ?? 'AI interpretation, not verified to source.'}
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 60,
            pointerEvents: 'auto',
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.6 }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 20,
              background: 'rgba(232, 131, 42, 0.14)',
              border: '1px solid rgba(232, 131, 42, 0.4)',
              color: '#f4b06a',
              fontSize: 11, fontWeight: 600, letterSpacing: 0.04,
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              cursor: 'help',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#f4b06a', boxShadow: '0 0 8px rgba(244,176,106,0.7)',
            }} />
            AI interpretation
          </motion.div>
        </div>
      )}
    </div>
  );
}

// ── Effect Layer Sub-component ────────────────────────────────

function EffectLayer({ effect }: { effect: SceneEffect }) {
  if (effect.type === 'none') return null;

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: `${effect.x}%`,
    top: `${effect.y}%`,
    width: `${effect.width}%`,
    height: `${effect.height}%`,
    pointerEvents: 'none',
    zIndex: 4,
  };

  switch (effect.type) {
    case 'shimmer':
      return (
        <motion.div
          animate={{ opacity: [0.2, 0.5, 0.2] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            ...baseStyle,
            background: `radial-gradient(ellipse, ${effect.color ?? 'rgba(255,215,0,0.15)'} 0%, transparent 70%)`,
          }}
        />
      );

    case 'glow':
      return (
        <motion.div
          animate={{ opacity: [0.3 * effect.intensity, 0.7 * effect.intensity, 0.3 * effect.intensity] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            ...baseStyle,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${effect.color ?? 'rgba(255,215,0,0.3)'} 0%, transparent 60%)`,
            filter: 'blur(8px)',
          }}
        />
      );

    case 'fire':
      return (
        <motion.div
          animate={{ opacity: [0.6, 1, 0.7, 0.9, 0.6], y: [-2, 2, -1, 3, -2] }}
          transition={{ duration: 1.2, repeat: Infinity }}
          style={{
            ...baseStyle,
            background: `radial-gradient(ellipse at bottom, ${effect.color ?? 'rgba(255,120,0,0.4)'} 0%, rgba(255,60,0,0.15) 40%, transparent 70%)`,
            filter: 'blur(3px)',
          }}
        />
      );

    case 'particles':
      return (
        <motion.div
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            ...baseStyle,
            background: `radial-gradient(circle at 20% 30%, ${effect.color ?? 'rgba(255,215,0,0.1)'} 1px, transparent 2px),
                         radial-gradient(circle at 60% 50%, ${effect.color ?? 'rgba(255,215,0,0.08)'} 1px, transparent 2px),
                         radial-gradient(circle at 80% 20%, ${effect.color ?? 'rgba(255,215,0,0.06)'} 1px, transparent 2px)`,
          }}
        />
      );

    case 'smoke':
      return (
        <motion.div
          animate={{ opacity: [0.15, 0.3, 0.15], y: [-5, 5, -5] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            ...baseStyle,
            background: `radial-gradient(ellipse, rgba(200,200,200,${0.1 * effect.intensity}) 0%, transparent 70%)`,
            filter: 'blur(12px)',
          }}
        />
      );

    case 'rain':
      return (
        <motion.div
          animate={{ backgroundPositionY: ['0%', '200%'] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
          style={{
            ...baseStyle,
            opacity: 0.15 * effect.intensity,
            backgroundImage: `repeating-linear-gradient(
              180deg,
              transparent,
              transparent 8px,
              rgba(180,200,255,0.3) 8px,
              rgba(180,200,255,0.3) 10px
            )`,
            backgroundSize: '4px 20px',
          }}
        />
      );

    default:
      return null;
  }
}
