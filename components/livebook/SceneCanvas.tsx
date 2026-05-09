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
import type { SceneEffect as ManifestEffect } from '@/lib/video/effects/types';
import { EffectStack } from '@/lib/video/effects/layers';
import { useFrameTicker } from '@/lib/video/effects/useFrameTicker';
import { AmbientFigure } from './AmbientFigure';
import { usePrefersReducedMotion } from '@/lib/hooks/usePrefersReducedMotion';
import { cameraForVerb, aimBurstAtTarget, type CameraBurst } from '@/lib/video/verbCamera';
import { subscribeActiveSpeaker, type ActiveSpeaker } from '@/lib/engine/narrationManager';
import { useAudioAmplitude } from '@/lib/hooks/useAudioAmplitude';
import { VerbSprite } from '@/lib/video/verbSprites';
import { SceneLayers, type CharacterMotion } from './SceneLayers';
import { motionForVerb } from '@/lib/video/verbCharacterMotion';
import { useSceneCutouts } from '@/lib/hooks/useSceneCutouts';
import { useCharacterStates } from '@/lib/hooks/useCharacterStates';

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
  /** Universal effects DSL — same vocabulary as the Remotion compositions.
   * When provided, layered on top of the scene image (particles, glow,
   * dust shafts, vignette, etc.) by the shared EffectStack component.
   * The reader and the movie share these so what you see in-app is what
   * you see on export. */
  manifestEffects?: ManifestEffect[];
  /** Book slug for sliced-cutout discovery. When the slicer has run
   *  for this book + scene, character cutouts are loaded from
   *  /images/layers/{slug}/{sceneId}/. Falls back to virtual ellipse-
   *  clip mode when missing. Optional — falls back to scene.story_id. */
  bookSlug?: string;
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
  showHotspotVisuals = false,
  preloadedHotspots,
  actionStatus,
  manifestEffects,
  bookSlug,
  onHotspotAction,
  onBackgroundClick,
  onBackgroundDoubleClick,
  disabled = false,
}: SceneCanvasProps) {
  // Resolve bookSlug for cutout discovery: explicit prop wins; fall
  // back to scene.story_id which is the slug for AI-generated books.
  const cutoutBookSlug = bookSlug ?? scene.story_id ?? '';
  // Stable list of character target_ids — passing it to useSceneCutouts
  // controls how many HEAD checks we kick off.
  const characterTargetIds = scene.hotspots
    .filter(h => h.type === 'character')
    .map(h => h.target_id);
  const sceneCutouts = useSceneCutouts({
    bookSlug: cutoutBookSlug,
    sceneId: scene.scene_id,
    targetIds: characterTargetIds,
  });
  // Per-character state machine (idle / talk / fight / leap / etc.)
  // — driven by the active TTS speaker (auto 'talk' for the speaking
  // character) and by the verb-burst trigger below.
  const characterStates = useCharacterStates();
  // Reduce-motion preference disables effect animation but keeps
  // first-frame visuals (vignettes/tints still render statically).
  // useSyncExternalStore-based hook keeps the value live without
  // setState-in-effect cascades.
  const prefersReducedMotion = usePrefersReducedMotion();
  const { frame: effectFrame, fps: effectFps } = useFrameTicker({ reducedMotion: prefersReducedMotion });
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredHotspot, setHoveredHotspot] = useState<string | null>(null);
  const [actionPopup, setActionPopup] = useState<ActionMenuPopup | null>(null);

  // ── Verb camera burst ──
  // Brief transform applied to the parallax wrapper when a verb is
  // chosen (Talk → dolly-in, Fight → push+shake, Leap → vertical arc,
  // Honor → bow tilt, etc.). The burst plays once for ~500-800ms then
  // clears; the FlipbookPage usually opens during this window so the
  // user perceives the camera reaction *as* the page flips. Reduced-
  // motion users get an immediate identity transform.
  interface ActiveBurst {
    burst: CameraBurst;
    verb: HotspotClickAction;
    hotspot: SceneHotspot;
    startedAt: number;
    /** Frame counter for the shake jitter — increments every render
     *  while the burst is active, drives a tiny pseudo-random offset. */
    tickKey: number;
  }
  const [burst, setBurst] = useState<ActiveBurst | null>(null);
  const burstTimer = useRef<number | null>(null);
  // Hotspot the user interacted with *before* the current one — used
  // as the implicit gaze target. When the current speaker fires their
  // lip-pulse, they lean toward whoever was on stage just before them,
  // which reads as a conversation: tap A then tap B and B "looks at"
  // A. Pure geometry, no language parsing.
  const lastInteractedRef = useRef<string | null>(null);
  const [gazeTargetId, setGazeTargetId] = useState<string | null>(null);
  // Pixel-snapshot of the canvas at burst-trigger time, so aim biasing
  // resolves to real coordinates. Read from the container ref's bbox.
  const triggerBurst = useCallback((verb: HotspotClickAction, hotspot: SceneHotspot) => {
    if (prefersReducedMotion) return;
    const rect = containerRef.current?.getBoundingClientRect();
    const w = rect?.width ?? 0;
    const h = rect?.height ?? 0;
    // Aim the dolly toward the hotspot's center (% → px).
    const targetXPct = hotspot.x + hotspot.width / 2;
    const targetYPct = hotspot.y + hotspot.height / 2;
    const aimed = aimBurstAtTarget(cameraForVerb(verb), targetXPct, targetYPct, w, h);
    setBurst({ burst: aimed, verb, hotspot, startedAt: performance.now(), tickKey: 0 });
    // Flip the character state machine for this hotspot for the
    // duration of the burst so AmbientFigure visibly stirs in time
    // with the verb (fight quickens breath, leap doubles sway, etc.).
    characterStates.applyVerbBurst(hotspot.target_id, verb, aimed.durationMs);
    // Promote the prior interaction to the gaze target — but only if
    // it's a *different* hotspot. Tapping the same hotspot twice
    // shouldn't make them stare at themselves.
    const prior = lastInteractedRef.current;
    setGazeTargetId(prior && prior !== hotspot.target_id ? prior : null);
    lastInteractedRef.current = hotspot.target_id;
    if (burstTimer.current) window.clearTimeout(burstTimer.current);
    burstTimer.current = window.setTimeout(() => setBurst(null), aimed.durationMs + 100);
  }, [prefersReducedMotion, characterStates]);
  useEffect(() => () => { if (burstTimer.current) window.clearTimeout(burstTimer.current); }, []);

  // ── Audio-driven lip-pulse ──
  // Subscribe to the narration manager's currently-active speaker.
  // When narration is playing for a known character (entityId set),
  // we read RMS amplitude from the audio element and pulse the
  // matching hotspot's mouth region. Idle/narrator audio falls
  // through with entityId=null and renders nothing.
  const [speaker, setSpeaker] = useState<ActiveSpeaker>({ audio: null, entityId: null });
  useEffect(() => subscribeActiveSpeaker(setSpeaker), []);
  const amplitude = useAudioAmplitude(speaker.audio, {
    reducedMotion: prefersReducedMotion,
  });
  // Resolve the hotspot to pulse: match speaker.entityId against the
  // scene's hotspots. null when speaker is the narrator (no specific
  // mouth to animate) or when no hotspot matches the entityId.
  const pulsingHotspot = speaker.entityId
    ? scene.hotspots.find(h => h.target_id === speaker.entityId) ?? null
    : null;

  // ── Heartbeat lip-pulse fallback ──
  // Web Audio amplitude reads silently fail on cross-origin Supabase
  // streams (Gemini-rendered narration in particular) — the analyser
  // wires up but RMS reads zero. Without this fallback, the speaker's
  // mouth would stay still even though we KNOW audio is playing.
  // A 3-Hz sinusoid gives a "talking" feel; clamped between 0.25 and
  // 0.85 so the pulse is always visible but never blown out.
  const [heartbeat, setHeartbeat] = useState(0);
  useEffect(() => {
    // No audio or reduce-motion: stop the rAF loop entirely. The
    // initial useState(0) keeps heartbeat at 0, so we don't need a
    // setState in the early return — that would be a setState-in-
    // effect cascading-render lint violation.
    if (!speaker.audio || prefersReducedMotion) return;
    let raf = 0;
    const tick = () => {
      const t = performance.now() / 1000;
      // Mix two close frequencies for a less mechanical rhythm.
      const v = 0.55 + 0.30 * Math.sin(t * 6.0) + 0.15 * Math.sin(t * 9.7);
      setHeartbeat(Math.max(0.25, Math.min(0.85, v)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // On unmount or when speaker.audio flips to null, the cleanup
    // cancels the loop and leaves heartbeat at its last value — but
    // the lipDrive consumer is gated on speaker.audio so the stale
    // value is never read.
    return () => cancelAnimationFrame(raf);
  }, [speaker.audio, prefersReducedMotion]);
  // Use whichever signal is louder — real amplitude when Web Audio
  // reads it, heartbeat fallback otherwise.
  const lipDrive = Math.max(amplitude, heartbeat);

  // ── Gaze bias ──
  // When a different hotspot was the most recent interaction (the
  // implicit "addressee"), compute a small directional offset for the
  // speaker's lip-pulse layer pointing toward them. The offset is
  // capped so the pulse never drifts off the figure's face.
  const gazeTargetHotspot = gazeTargetId && pulsingHotspot && gazeTargetId !== pulsingHotspot.target_id
    ? scene.hotspots.find(h => h.target_id === gazeTargetId) ?? null
    : null;
  let gazeOffsetX = 0;
  let gazeOffsetY = 0;
  if (pulsingHotspot && gazeTargetHotspot) {
    const speakerCx = pulsingHotspot.x + pulsingHotspot.width / 2;
    const speakerCy = pulsingHotspot.y + pulsingHotspot.height / 2;
    const targetCx  = gazeTargetHotspot.x + gazeTargetHotspot.width / 2;
    const targetCy  = gazeTargetHotspot.y + gazeTargetHotspot.height / 2;
    const dx = targetCx - speakerCx;
    const dy = targetCy - speakerCy;
    const mag = Math.max(1, Math.hypot(dx, dy));
    // Normalize then scale to a small fraction of the speaker's bbox
    // so the pulse always stays on their face. Dividing by mag here
    // prevents distant targets from pulling harder than near ones —
    // the gaze direction matters, the distance doesn't.
    const intensity = pulsingHotspot.width * 0.18; // up to 18% of their own width
    gazeOffsetX = (dx / mag) * intensity;
    gazeOffsetY = (dy / mag) * (pulsingHotspot.height * 0.12);
  }

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

    // If only one action available, trigger immediately + camera burst.
    if (hotspot.allowed_actions.length === 1) {
      const verb = hotspot.allowed_actions[0];
      triggerBurst(verb, hotspot);
      onHotspotAction?.(hotspot, verb);
      return;
    }

    // Show action menu
    setActionPopup({
      hotspot,
      x: hotspot.x + hotspot.width / 2,
      y: hotspot.y,
    });
  }, [disabled, onHotspotAction, triggerBurst]);

  const handleActionSelect = useCallback((hotspot: SceneHotspot, action: HotspotClickAction) => {
    triggerBurst(action, hotspot);
    onHotspotAction?.(hotspot, action);
  }, [onHotspotAction, triggerBurst]);

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
      {/* ── Verb camera burst wrapper ──
          When a verb is chosen, this layer animates a brief scale+
          translate (and optional shake) keyed off the verb's intent.
          Sits *inside* the parallax tilt so a Talk dolly-in still
          tilts with mouse movement, but *outside* every visual layer
          so the entire canvas reacts in unison. Identity transform
          when no burst is active. */}
      <motion.div
        animate={burst ? {
          scale: [burst.burst.fromScale, burst.burst.toScale],
          x:     [burst.burst.fromX,     burst.burst.toX],
          y:     [burst.burst.fromY,     burst.burst.toY],
        } : { scale: 1, x: 0, y: 0 }}
        transition={burst ? {
          duration: burst.burst.durationMs / 1000,
          ease: [0.22, 1, 0.36, 1],
        } : { duration: 0.4, ease: 'easeOut' }}
        style={{
          position: 'absolute', inset: 0,
          transformOrigin: 'center center',
          willChange: 'transform',
        }}
      >
      {/* Shake jitter — only rendered while burst.shake > 0. Uses a
          framer-motion keyframe array so the oscillation is GPU-driven
          and doesn't depend on a rAF loop in this component. */}
      {burst && burst.burst.shake > 0 ? (
        <motion.div
          animate={{
            x: [0, -burst.burst.shake, burst.burst.shake, -burst.burst.shake * 0.6, burst.burst.shake * 0.6, 0],
            y: [0, burst.burst.shake * 0.4, -burst.burst.shake * 0.4, burst.burst.shake * 0.2, -burst.burst.shake * 0.2, 0],
          }}
          transition={{ duration: burst.burst.durationMs / 1000 * 0.6, ease: 'linear' }}
          style={{ position: 'absolute', inset: 0 }}
        >
          {/* shaking children rendered below via portal-less continuation */}
        </motion.div>
      ) : null}
      {/* Flash overlay — short color wash for impact verbs (fight,
          honor, animate, etc.). Independent so it can fade independently
          of the camera transform. */}
      {burst?.burst.flash ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: burst.burst.durationMs / 1000 * 0.7, ease: 'easeOut' }}
          style={{
            position: 'absolute', inset: 0,
            background: burst.burst.flash,
            mixBlendMode: 'screen',
            pointerEvents: 'none',
            zIndex: 9,
          }}
        />
      ) : null}
      {/* Verb sprite — universal SVG/CSS animation keyed off the
          chosen verb (sword-flash for fight, leap-arc for leap, etc.).
          Mounts at the hotspot bbox so the effect lands where the
          user tapped. Auto-fades over the burst duration. */}
      {burst ? (
        <VerbSprite
          verb={burst.verb}
          x={burst.hotspot.x}
          y={burst.hotspot.y}
          width={burst.hotspot.width}
          height={burst.hotspot.height}
          durationMs={burst.burst.durationMs}
        />
      ) : null}

      {/* ── Layer 1: Background with Ken Burns cinematic pan ──
          When the scene has an image, we mount the layered renderer
          (bg plate + character cutouts) inside the Ken Burns wrapper
          so the whole scene drifts together but characters can have
          their own per-verb motion overlays on top. */}
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
              filter: 'brightness(0.82) saturate(1.15)',
            }}
          >
            <SceneLayers
              bgImageUrl={scene.background.image_url}
              bgPlateUrl={sceneCutouts.bgPlateUrl}
              cutouts={sceneCutouts.cutouts}
              hotspots={scene.hotspots}
              motions={
                burst
                  ? { [burst.hotspot.target_id]: motionForVerb(burst.verb) } as Record<string, CharacterMotion>
                  : undefined
              }
              reducedMotion={prefersReducedMotion}
            />
          </motion.div>
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

      {/* ── Layer 4a: Universal manifest effects (DSL) ──
          Same vocabulary the Remotion movie uses — particles, glow,
          dust shafts, vignette, etc. Driven by per-scene effects[]
          baked into the manifest at build time from topic + mood
          recipes. Stays inside the parallax wrapper so effects tilt
          with the scene. */}
      {manifestEffects && manifestEffects.length > 0 && (
        <EffectStack
          effects={manifestEffects}
          frame={effectFrame}
          fps={effectFps}
          seedPrefix={scene.scene_id}
        />
      )}

      {/* ── Layer 4b: Legacy scene-effect array (StoryScene contract) ── */}
      {scene.effects.map(effect => (
        <EffectLayer key={effect.id} effect={effect} />
      ))}

      {/* ── Layer 4d: Audio-driven lip-pulse ──
          When narration is playing for a known speaker, scale + glow
          the top quarter of their hotspot bbox in time with audio
          amplitude. Reads as "the figure's mouth is moving" without
          any actual lip-sync model. Pointer-events:none so it never
          blocks hotspot taps. */}
      {pulsingHotspot && lipDrive > 0 && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: `${pulsingHotspot.x}%`,
            top: `${pulsingHotspot.y}%`,
            width: `${pulsingHotspot.width}%`,
            height: `${pulsingHotspot.height * 0.28}%`,
            pointerEvents: 'none',
            zIndex: 4,
            // Position the pulse on the upper face region (mouth area
            // is roughly 12-30% from the top of a portrait bbox).
            // Add gaze bias toward the implicit addressee so the
            // speaker's "voice" leans in the right direction. The
            // bias is in % of canvas; the pulse layer is sized to
            // the speaker's bbox so we apply it as a translate.
            transform: `translate(${gazeOffsetX.toFixed(2)}%, ${(Math.round(pulsingHotspot.height * 0.22 * 100) / 100) + gazeOffsetY}%) scale(${1 + lipDrive * 0.18})`,
            transition: 'transform 140ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          <div
            style={{
              position: 'absolute', inset: 0,
              borderRadius: '50%',
              background: `radial-gradient(ellipse at 50% 50%, rgba(255,235,180,${0.30 + lipDrive * 0.45}) 0%, transparent 65%)`,
              filter: `blur(${5 + lipDrive * 10}px)`,
              mixBlendMode: 'screen',
              opacity: 0.85 + lipDrive * 0.15,
            }}
          />
        </div>
      )}

      {/* ── Layer 4c: Ambient idle animation ──
          Subtle breath/sway/blink halos at every character (and softer
          on object) hotspot, so the static illustration feels alive
          even when no one is interacting. Universal — driven entirely
          by hotspot bbox + a deterministic per-figure phase, no book
          knowledge required. Sits inside the parallax wrapper so the
          ambient layer tilts with the scene. */}
      {scene.hotspots.map((hotspot, i) => (
        <AmbientFigure
          key={`ambient-${hotspot.id}`}
          hotspot={hotspot}
          index={i}
          state={characterStates.stateFor(hotspot.target_id)}
        />
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

      {/* ── End verb camera burst wrapper ── */}
      </motion.div>
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
