'use client';

// ============================================================
// KathaKitaab — Living World Mission Panel
//
// Low-noise bottom panel. Shows where you are, what the courier
// loop is asking of you right now, and the at-node side actions
// (ask a character, answer a reflection). Clue collection happens
// on the stage itself (tap the glowing clue markers), so it isn't
// duplicated here. Keeps Messenger's "minimal UI, one job at a time"
// principle.
// ============================================================

import Link from 'next/link';
import type { WorldManifest, WorldMission } from '@/lib/world/worldManifest';
import { deliverMissionId } from '@/lib/world/worldManifest';
import { totalMissionCount, type WorldSessionState } from '@/lib/world/worldSession';

interface MissionPanelProps {
  manifest: WorldManifest;
  session: WorldSessionState;
  onAskCharacter: (mission: WorldMission) => void;
  onAnswerQuiz: (mission: WorldMission) => void;
  onReset: () => void;
}

function primaryStatus(manifest: WorldManifest, session: WorldSessionState): string {
  const node = manifest.nodes.find(n => n.id === session.currentNodeId);
  if (!node) return 'Walking the world…';
  const hasDeliver = node.missions.some(m => m.kind === 'deliver_fragment');
  if (!hasDeliver) return 'This is the final scene — the journey pauses here.';
  const done = session.completedMissionIds.includes(deliverMissionId(node.id));
  if (done) return 'Fragment delivered — the next scene is unlocked. Walk through the open portal.';
  if (session.carriedFragmentNodeId === node.id) return 'Carrying the fragment — walk to the ✨ portal and deliver it.';
  if (session.carriedFragmentNodeId) return 'You are carrying another scene’s fragment — deliver it first.';
  return 'Stand at this scene to pick up its story fragment.';
}

export default function MissionPanel({
  manifest,
  session,
  onAskCharacter,
  onAnswerQuiz,
  onReset,
}: MissionPanelProps) {
  const node = manifest.nodes.find(n => n.id === session.currentNodeId);
  const totalMissions = totalMissionCount(manifest);
  const completed = session.completedMissionIds.length;

  const sideMissions: WorldMission[] = node
    ? node.missions.filter(m => m.kind === 'ask_character' || m.kind === 'answer_question')
    : [];

  return (
    <aside className="world-panel" aria-label="Living world mission panel">
      <div className="world-panel-head">
        <div>
          <div className="world-panel-eyebrow">Living World · {manifest.bookTitle}</div>
          <div className="world-panel-place">
            {node ? `${node.emoji} ${node.title}` : 'Walking…'}
          </div>
        </div>
        <div className="world-panel-stats" data-world-xp={session.xp}>
          <div className="world-stat"><span aria-hidden>🧭</span> {session.visitedNodeIds.length}/{manifest.nodes.length}</div>
          <div className="world-stat"><span aria-hidden>⭐</span> {session.xp} XP</div>
          <div className="world-stat"><span aria-hidden>✅</span> {completed}/{totalMissions}</div>
        </div>
      </div>

      <p className="world-panel-status">{primaryStatus(manifest, session)}</p>

      {sideMissions.length > 0 && (
        <div className="world-panel-actions">
          {sideMissions.map(mission => {
            const done = session.completedMissionIds.includes(mission.id);
            if (mission.kind === 'ask_character') {
              const npc = manifest.npcs.find(n => n.slug === mission.characterSlug);
              return (
                <button
                  key={mission.id}
                  type="button"
                  className="world-action"
                  disabled={done}
                  onClick={() => onAskCharacter(mission)}
                  data-world-mission={mission.id}
                >
                  <span aria-hidden>{done ? '✓' : '💬'}</span>
                  {done ? `Spoke with ${npc?.name ?? 'a character'}` : `Ask ${npc?.name ?? 'a character'}`}
                </button>
              );
            }
            return (
              <button
                key={mission.id}
                type="button"
                className="world-action"
                disabled={done}
                onClick={() => onAnswerQuiz(mission)}
                data-world-mission={mission.id}
              >
                <span aria-hidden>{done ? '✓' : '🔮'}</span>
                {done ? 'Reflection answered' : 'Answer a reflection'}
              </button>
            );
          })}
        </div>
      )}

      <div className="world-panel-foot">
        <Link href={`/books/${manifest.bookSlug}`} className="btn-secondary" style={{ textDecoration: 'none', borderRadius: 999 }}>
          ← Read mode
        </Link>
        <Link href="/books" className="btn-secondary" style={{ textDecoration: 'none', borderRadius: 999 }}>
          Library
        </Link>
        <button type="button" className="btn-secondary" style={{ borderRadius: 999 }} onClick={onReset}>
          ↺ Reset world
        </button>
      </div>
    </aside>
  );
}