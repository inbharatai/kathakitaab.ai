'use client';

// ============================================================
// KathaKitaab — Living World accessibility + interaction layer
//
// A visible, keyboard-focusable DOM control surface that mirrors the
// 3D world. This is the canonical interaction + screen-reader surface:
//   · one <button data-world-node> per place (locked places disabled)
//   · one <button data-world-portal> per story-graph edge
//   · one <button data-world-mission> per clue at the current place
//   · one <button data-world-npc> per character
//
// Why a DOM layer on top of a WebGL canvas:
//   1. Screen readers + keyboard users get a real, labelled control
//      set (Messenger's accessibility was its weakest score; we do
//      better).
//   2. The existing Playwright e2e (tests/e2e/living-world.spec.ts)
//      asserts on these exact `.world-*` classes + `data-*` hooks, so
//      the 3D rewrite stays green without touching the spec.
//   3. The 3D canvas is free to be pure visual + raycast delight —
//      session state is the single source of truth, the canvas follows
//      it, this layer dispatches into it.
//
// The class names + data attributes are identical to the v1 DOM stage
// (components/world/WorldStage.tsx) so the CSS in app/globals.css and
// the e2e selectors carry over unchanged.
// ============================================================

import { useCallback } from 'react';
import {
  clueEmoji,
  isNodeUnlocked,
  type WorldManifest,
  type WorldNpc,
  type WorldNode,
  type WorldPortal,
} from '@/lib/world/worldManifest';
import { isPortalOpenFor, type WorldSessionState } from '@/lib/world/worldSession';

export interface WorldA11yLayerProps {
  manifest: WorldManifest;
  session: WorldSessionState;
  onArriveNode: (nodeId: string) => void;
  onArrivePortal: (portal: WorldPortal) => void;
  onSetAvatar: (x: number, y: number, lat?: number, lon?: number) => void;
  onSpeakNpc: (npc: WorldNpc) => void;
  onCollectClue: (missionId: string) => void;
}

export default function WorldA11yLayer({
  manifest,
  session,
  onArriveNode,
  onArrivePortal,
  onSetAvatar,
  onSpeakNpc,
  onCollectClue,
}: WorldA11yLayerProps) {
  const visitNode = useCallback(
    (node: WorldNode) => {
      if (!isNodeUnlocked(manifest, session.completedMissionIds, node.id)) return;
      onSetAvatar(node.x, node.y, node.lat, node.lon);
      onArriveNode(node.id);
    },
    [manifest, session.completedMissionIds, onArriveNode, onSetAvatar],
  );

  const visitPortal = useCallback(
    (portal: WorldPortal) => {
      const open = isPortalOpenFor(session, portal);
      if (open && portal.toNodeId) {
        const target = manifest.nodes.find(n => n.id === portal.toNodeId);
        if (target) {
          onSetAvatar(target.x, target.y, target.lat, target.lon);
          onArriveNode(target.id);
          return;
        }
      }
      // Closed/ready portal — walk to it and hand over the fragment.
      onSetAvatar(portal.x, portal.y, portal.lat, portal.lon);
      onArrivePortal(portal);
    },
    [manifest, session, onArriveNode, onArrivePortal, onSetAvatar],
  );

  const currentClueMissions = (() => {
    const node = manifest.nodes.find(n => n.id === session.currentNodeId);
    if (!node) return [];
    return node.missions.filter(
      m => m.kind === 'collect_clue' && !session.completedMissionIds.includes(m.id),
    );
  })();

  // Portal rows with their live state precomputed once, then sorted so the
  // ACTIONABLE portal (is-ready: carry-and-deliver now) is first, then open
  // gateways, then closed/locked ones. The compass is action-first: the one
  // thing the courier must do next sits at the top of the list, visible
  // without scrolling — instead of buried below the full Places reference
  // list (which on a 12-scene book pushed the ready portal off-screen and
  // left both the e2e click and a real small-viewport user stranded).
  const portalRows = manifest.portals
    .map(portal => {
      const open = isPortalOpenFor(session, portal);
      const carrying = session.carriedFragmentNodeId === portal.fromNodeId;
      const canDeliver = carrying && !open;
      const target = manifest.nodes.find(n => n.id === portal.toNodeId);
      // rank: ready(3) > open(2) > closed(1); stable within rank by portal id.
      const rank = canDeliver ? 3 : open ? 2 : 1;
      return { portal, open, canDeliver, target, rank };
    })
    .sort((a, b) => b.rank - a.rank || a.portal.id.localeCompare(b.portal.id));

  return (
    <div className="world-compass" aria-label="Story world destinations">
      {/* Clues here — the current place's uncompleted clues, surfaced first
          because they are actionable right now. */}
      {currentClueMissions.length > 0 && (
        <div className="world-compass-section" aria-label="Clues here">
          <div className="world-compass-head">Clues here</div>
          <ul className="world-compass-list">
            {currentClueMissions.map(mission => (
              <li key={mission.id}>
                <button
                  type="button"
                  className="world-clue"
                  style={{ borderRadius: 999 }}
                  onClick={() => onCollectClue(mission.id)}
                  aria-label={`Collect a clue: ${mission.clueText ?? mission.description}`}
                  data-world-mission={mission.id}
                >
                  <span aria-hidden>{clueEmoji(mission.id)}</span>
                  <span className="world-node-label">{mission.clueText ?? mission.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Portals — the [data-world-portal] + is-ready/is-open surface,
          sorted action-first (ready > open > closed). */}
      {portalRows.length > 0 && (
        <div className="world-compass-section" aria-label="Portals">
          <div className="world-compass-head">Portals</div>
          <ul className="world-compass-list">
            {portalRows.map(({ portal, open, canDeliver, target }) => (
              <li key={portal.id}>
                <button
                  type="button"
                  className={`world-portal ${open ? 'is-open' : ''} ${canDeliver ? 'is-ready' : ''}`}
                  style={{ borderRadius: 999 }}
                  onClick={() => visitPortal(portal)}
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
                  <span className="world-portal-glyph" aria-hidden>{open ? '🌀' : '✨'}</span>
                  <span className="world-node-label">{target?.title ?? 'Next scene'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Places — the canonical [data-world-node] surface. A reference list
          of every scene; sits below the action sections. */}
      <div className="world-compass-section" aria-label="Places">
        <div className="world-compass-head">Places</div>
        <ul className="world-compass-list">
          {manifest.nodes.map(node => {
            const unlocked = isNodeUnlocked(manifest, session.completedMissionIds, node.id);
            const current = node.id === session.currentNodeId;
            const visited = session.visitedNodeIds.includes(node.id);
            const carrying = session.carriedFragmentNodeId === node.id;
            return (
              <li key={node.id}>
                <button
                  type="button"
                  className={`world-node ${current ? 'is-current' : ''} ${visited ? 'is-visited' : ''}`}
                  style={{ borderRadius: 999 }}
                  disabled={!unlocked}
                  onClick={() => visitNode(node)}
                  aria-label={`${unlocked ? 'Enter' : 'Locked'} scene: ${node.title}`}
                  data-world-node={node.id}
                  data-world-unlocked={unlocked ? 'true' : 'false'}
                >
                  <span className="world-node-emoji" aria-hidden>{unlocked ? node.emoji : '🔒'}</span>
                  <span className="world-node-label">{node.title}</span>
                  {carrying && <span className="world-node-badge" aria-label="carrying fragment">✉️</span>}
                  {current && <span className="world-node-here" aria-hidden>●</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* NPCs — the [data-world-npc] surface. */}
      {manifest.npcs.length > 0 && (
        <div className="world-compass-section" aria-label="Characters">
          <div className="world-compass-head">Characters</div>
          <ul className="world-compass-list">
            {manifest.npcs.map(npc => (
              <li key={npc.slug}>
                <button
                  type="button"
                  className="world-npc"
                  style={{ borderRadius: 999 }}
                  onClick={() => onSpeakNpc(npc)}
                  aria-label={`Speak with ${npc.name}`}
                  data-world-npc={npc.slug}
                >
                  <span aria-hidden>{npc.emoji}</span>
                  <span className="world-node-label">{npc.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}