'use client';

// ============================================================
// KathaKitaab — Living World Stage
//
// The explorable diorama: a tiny planet rendered as a 1000×620
// ground layer inside a responsive viewport, with a soft camera
// that follows the avatar. Navigation is click/tap-to-move; the
// avatar tweens to the target with an easeInOut curve, or snaps
// when the OS asks for reduced motion.
//
// Architecture note: the ground (planet rim, motes, node platforms)
// lives in a CSS-scaled world layer so it always fills the viewport.
// Interactive markers (nodes, portals, NPCs, clues, avatar) are
// projected into SCREEN space (world × scale + camera) so they stay
// a constant, readable, tappable size on phones as well as desktops.
//
// No WebGL/PixiJS/Phaser — plain DOM + CSS transforms only, to keep
// Playwright accessibility + Remotion parity with the rest of the app.
// ============================================================

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '@/lib/hooks/usePrefersReducedMotion';
import {
  clueEmoji,
  isNodeUnlocked,
  type WorldManifest,
  type WorldNpc,
  type WorldNode,
  type WorldPortal,
} from '@/lib/world/worldManifest';
import { isPortalOpenFor, type WorldSessionState } from '@/lib/world/worldSession';

interface MoveTarget {
  kind: 'node' | 'portal';
  id: string;
  x: number;
  y: number;
}

export interface WorldStageProps {
  manifest: WorldManifest;
  session: WorldSessionState;
  onArriveNode: (nodeId: string) => void;
  onArrivePortal: (portal: WorldPortal) => void;
  onSetAvatar: (x: number, y: number) => void;
  onSpeakNpc: (npc: WorldNpc) => void;
  onCollectClue: (missionId: string) => void;
}

export default function WorldStage({
  manifest,
  session,
  onArriveNode,
  onArrivePortal,
  onSetAvatar,
  onSpeakNpc,
  onCollectClue,
}: WorldStageProps) {
  const reducedMotion = usePrefersReducedMotion();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ w: 1000, h: 620 });

  const spawnNode = manifest.nodes[0];
  const [avatar, setAvatar] = useState<{ x: number; y: number }>({
    x: Number.isFinite(session.avatarX) && session.avatarX > 0 ? session.avatarX : (spawnNode?.x ?? manifest.width / 2),
    y: Number.isFinite(session.avatarY) && session.avatarY > 0 ? session.avatarY : (spawnNode?.y ?? manifest.height / 2),
  });
  const avatarRef = useRef(avatar);
  const [move, setMove] = useState<MoveTarget | null>(null);
  // Keep a ref mirror of the avatar so the next tween can read the
  // latest committed position as its start. Updated in an effect (ref
  // writes during render are disallowed by the repo's react-hooks rules).
  useEffect(() => {
    avatarRef.current = avatar;
  }, [avatar]);

  // Measure the responsive viewport so the camera can scale the
  // 1000×620 world to fit. useLayoutEffect avoids a flash of the
  // unscaled layer on first paint.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setViewport({ w: rect.width || 1000, h: rect.height || 620 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const scale = viewport.w / manifest.width;
  // Camera centres the avatar in the viewport.
  const cameraX = viewport.w / 2 - avatar.x * scale;
  const cameraY = viewport.h / 2 - avatar.y * scale;

  const toScreen = useCallback(
    (x: number, y: number) => ({ x: x * scale + cameraX, y: y * scale + cameraY }),
    [scale, cameraX, cameraY],
  );

  // Note: avatar is re-initialised from `session.avatarX/Y` on mount.
  // On Reset the parent remounts this component via a `key` change, so a
  // synchronous setState-in-effect sync is not needed here.

  const resolveArrival = useCallback(
    (target: MoveTarget) => {
      onSetAvatar(target.x, target.y);
      if (target.kind === 'node') onArriveNode(target.id);
      else {
        const portal = manifest.portals.find(p => p.id === target.id);
        if (portal) onArrivePortal(portal);
      }
    },
    [manifest, onArriveNode, onArrivePortal, onSetAvatar],
  );

  // Tween the avatar to the move target. Snap when reduced motion is
  // requested or the distance is effectively zero.
  useEffect(() => {
    if (!move) return;
    const start = { ...avatarRef.current };
    const dist = Math.hypot(move.x - start.x, move.y - start.y);
    if (dist < 1 || reducedMotion) {
      setAvatar({ x: move.x, y: move.y });
      avatarRef.current = { x: move.x, y: move.y };
      resolveArrival(move);
      setMove(null);
      return;
    }
    const duration = Math.min(800, 220 + dist * 0.7);
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
      const x = start.x + (move.x - start.x) * e;
      const y = start.y + (move.y - start.y) * e;
      setAvatar({ x, y });
      avatarRef.current = { x, y };
      if (t < 1) raf = requestAnimationFrame(tick);
      else {
        resolveArrival(move);
        setMove(null);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [move, reducedMotion, resolveArrival]);

  const handleNodeTap = useCallback(
    (node: WorldNode) => {
      const unlocked = isNodeUnlocked(manifest, session.completedMissionIds, node.id);
      if (!unlocked) return;
      setMove({ kind: 'node', id: node.id, x: node.x, y: node.y });
    },
    [manifest, session.completedMissionIds],
  );

  const handlePortalTap = useCallback((portal: WorldPortal) => {
    // An open portal is a travel gateway: clicking it walks the
    // courier through to the next scene's node. A closed/ready portal
    // is the deliver target — walk to it and hand over the fragment.
    if (isPortalOpenFor(session, portal) && portal.toNodeId) {
      const target = manifest.nodes.find(n => n.id === portal.toNodeId);
      if (target) {
        setMove({ kind: 'node', id: target.id, x: target.x, y: target.y });
        return;
      }
    }
    setMove({ kind: 'portal', id: portal.id, x: portal.x, y: portal.y });
  }, [manifest, session]);

  const avatarScreen = toScreen(avatar.x, avatar.y);
  const currentClueMissions = (() => {
    const node = manifest.nodes.find(n => n.id === session.currentNodeId);
    if (!node) return [];
    return node.missions.filter(
      m => m.kind === 'collect_clue' && !session.completedMissionIds.includes(m.id),
    );
  })();

  return (
    <div
      ref={viewportRef}
      className="world-viewport"
      style={{ background: manifest.palette.sky }}
      role="application"
      aria-label={`Living world map for ${manifest.bookTitle}`}
    >
      {/* Scaled ground layer — decorative only */}
      <div
        className="world-layer"
        aria-hidden
        style={{
          width: manifest.width,
          height: manifest.height,
          background: manifest.palette.ground,
          transform: `translate(${cameraX}px, ${cameraY}px) scale(${scale})`,
          transformOrigin: '0 0',
        }}
      >
        <div className="world-planet-rim" />
        <div className="world-motes" />
        {manifest.nodes.map(node => (
          <div key={`plat-${node.id}`} className="world-node-platform" style={{ left: node.x, top: node.y }} />
        ))}
      </div>

      {/* Screen-space markers layer (constant-size, readable on mobile) */}
      <div className="world-markers">
        {/* Portals */}
        {manifest.portals.map(portal => {
          const p = toScreen(portal.x, portal.y);
          const open = isPortalOpenFor(session, portal);
          const carrying = session.carriedFragmentNodeId === portal.fromNodeId;
          const canDeliver = carrying && !open;
          return (
            <button
              key={portal.id}
              type="button"
              className={`world-portal ${open ? 'is-open' : ''} ${canDeliver ? 'is-ready' : ''} ${move?.id === portal.id ? 'is-target' : ''}`}
              style={{ left: p.x, top: p.y }}
              onClick={() => handlePortalTap(portal)}
              aria-label={
                open
                  ? 'Open portal — the next scene is unlocked'
                  : canDeliver
                    ? 'Deliver the story fragment to this portal'
                    : 'A closed portal — carry a story fragment here'
              }
              data-world-portal={portal.id}
              data-world-portal-open={open ? 'true' : 'false'}
            >
              <span className="world-portal-glow" aria-hidden />
              <span className="world-portal-glyph" aria-hidden>{open ? '🌀' : '✨'}</span>
            </button>
          );
        })}

        {/* Nodes */}
        {manifest.nodes.map(node => {
          const p = toScreen(node.x, node.y);
          const unlocked = isNodeUnlocked(manifest, session.completedMissionIds, node.id);
          const current = node.id === session.currentNodeId;
          const visited = session.visitedNodeIds.includes(node.id);
          const carrying = session.carriedFragmentNodeId === node.id;
          return (
            <button
              key={node.id}
              type="button"
              className={`world-node ${current ? 'is-current' : ''} ${visited ? 'is-visited' : ''} ${move?.id === node.id ? 'is-target' : ''}`}
              style={{ left: p.x, top: p.y }}
              onClick={() => handleNodeTap(node)}
              disabled={!unlocked}
              aria-label={`${unlocked ? 'Enter' : 'Locked'} scene: ${node.title}`}
              data-world-node={node.id}
              data-world-unlocked={unlocked ? 'true' : 'false'}
            >
              <span className="world-node-ring" aria-hidden />
              <span className="world-node-emoji" aria-hidden>{unlocked ? node.emoji : '🔒'}</span>
              <span className="world-node-label">{node.title}</span>
              {carrying && <span className="world-node-badge" aria-label="carrying fragment">✉️</span>}
              {current && <span className="world-node-here" aria-hidden>●</span>}
            </button>
          );
        })}

        {/* Clue markers for the current node's uncompleted clues */}
        {currentClueMissions.map((mission, i) => {
          const node = manifest.nodes.find(n => n.id === mission.nodeId);
          if (!node) return null;
          const angle = (i / Math.max(1, currentClueMissions.length)) * Math.PI * 2;
          const r = 84;
          const cx = node.x + Math.cos(angle) * r;
          const cy = node.y + Math.sin(angle) * r + 6;
          const p = toScreen(cx, cy);
          return (
            <button
              key={mission.id}
              type="button"
              className="world-clue"
              style={{ left: p.x, top: p.y }}
              onClick={() => onCollectClue(mission.id)}
              aria-label={`Collect a clue: ${mission.clueText ?? mission.description}`}
              data-world-mission={mission.id}
            >
              <span aria-hidden>{clueEmoji(mission.id)}</span>
            </button>
          );
        })}

        {/* NPCs — decorative life */}
        {manifest.npcs.map(npc => {
          const node = manifest.nodes.find(n => n.id === npc.nodeId);
          if (!node) return null;
          const p = toScreen(node.x + npc.dx, node.y + npc.dy);
          const atCurrent = node.id === session.currentNodeId;
          return (
            <button
              key={npc.slug}
              type="button"
              className="world-npc"
              style={{ left: p.x, top: p.y }}
              onClick={() => onSpeakNpc(npc)}
              aria-label={`Speak with ${npc.name}`}
              data-world-npc={npc.slug}
            >
              <span aria-hidden>{npc.emoji}</span>
              {atCurrent && <span className="world-npc-name">{npc.name}</span>}
            </button>
          );
        })}

        {/* Avatar (courier) */}
        <div
          className="world-avatar"
          style={{ left: avatarScreen.x, top: avatarScreen.y }}
          aria-label="Your story courier"
          role="img"
        >
          <span className="world-avatar-figure" aria-hidden>🧑‍🚀</span>
          {session.carriedFragmentNodeId && <span className="world-avatar-satchel" aria-hidden>✉️</span>}
        </div>
      </div>
    </div>
  );
}