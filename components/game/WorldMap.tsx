'use client';

import { motion } from 'framer-motion';
import { WorldState } from '@/lib/game/worldMasterAgent';
import { QuestState } from '@/lib/game/questAgent';
import { GameState } from '@/lib/game/gameState';
import { PlayableCharacter } from './CharacterSelectScreen';

interface Props {
  bookSlug: string;
  scenes: Array<{ scene_id: string; title: string; order_index: number; short_summary: string }>;
  worldState: WorldState;
  questState: QuestState;
  gameState: GameState;
  selectedCharacter: PlayableCharacter;
  currentSceneId: string;
  onSceneSelect: (sceneId: string) => void;
}

// Location themes for visual variety
const LOCATION_THEMES = [
  { emoji: '🏰', color: '#FF9933', bg: 'rgba(255,153,51,0.15)' },
  { emoji: '🌳', color: '#5CDB95', bg: 'rgba(92,219,149,0.15)' },
  { emoji: '🏔️', color: '#79B8FF', bg: 'rgba(121,184,255,0.15)' },
  { emoji: '🌊', color: '#5BC8F5', bg: 'rgba(91,200,245,0.15)' },
  { emoji: '🔥', color: '#FF6B6B', bg: 'rgba(255,107,107,0.15)' },
  { emoji: '⭐', color: '#FFD700', bg: 'rgba(255,215,0,0.15)' },
  { emoji: '🌙', color: '#C39BD3', bg: 'rgba(195,155,211,0.15)' },
  { emoji: '🏛️', color: '#F5A623', bg: 'rgba(245,166,35,0.15)' },
  { emoji: '🌺', color: '#FF69B4', bg: 'rgba(255,105,180,0.15)' },
  { emoji: '⚡', color: '#FFF176', bg: 'rgba(255,241,118,0.15)' },
  { emoji: '🌿', color: '#98FB98', bg: 'rgba(152,251,152,0.15)' },
  { emoji: '🗡️', color: '#E8832A', bg: 'rgba(232,131,42,0.15)' },
];

export default function WorldMap({
  scenes, questState, gameState,
  selectedCharacter, currentSceneId, onSceneSelect,
}: Props) {
  const completedSceneIds = new Set(gameState.scenesVisited);
  const activeQuestSceneIds = new Set(questState.activeQuests.map(q => q.sceneId));

  // A scene is unlocked if it's the first, is visited, or comes right after a visited scene
  const isUnlocked = (scene: Props['scenes'][0], index: number) => {
    if (index === 0) return true;
    if (completedSceneIds.has(scene.scene_id)) return true;
    const prevScene = scenes[index - 1];
    return prevScene ? completedSceneIds.has(prevScene.scene_id) : false;
  };

  return (
    <div style={{
      height: '100%', overflowY: 'auto',
      padding: '16px 12px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {/* Header */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: '0.6rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 4 }}>
          World Map
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--color-gold)', fontWeight: 600 }}>
          {completedSceneIds.size}/{scenes.length} explored
        </div>
      </div>

      {/* Scene nodes */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
        {/* Connecting line */}
        <div style={{
          position: 'absolute', left: 20, top: 24, bottom: 24,
          width: 2,
          background: 'linear-gradient(180deg, var(--color-saffron) 0%, rgba(255,153,51,0.1) 100%)',
          zIndex: 0,
        }} />

        {scenes.map((scene, index) => {
          const theme = LOCATION_THEMES[index % LOCATION_THEMES.length];
          const isVisited = completedSceneIds.has(scene.scene_id);
          const isCurrent = scene.scene_id === currentSceneId;
          const unlocked = isUnlocked(scene, index);
          const hasQuest = activeQuestSceneIds.has(scene.scene_id);

          return (
            <motion.button
              key={scene.scene_id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.06 }}
              onClick={() => unlocked && onSceneSelect(scene.scene_id)}
              style={{
                position: 'relative', zIndex: 1,
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px 8px 6px',
                background: isCurrent
                  ? `linear-gradient(90deg, ${theme.bg}, rgba(43,27,21,0.6))`
                  : isVisited
                    ? 'rgba(43,27,21,0.3)'
                    : 'rgba(20,12,8,0.4)',
                border: `1px solid ${isCurrent ? theme.color : isVisited ? 'rgba(255,215,0,0.15)' : 'rgba(255,255,255,0.04)'}`,
                borderRadius: 12,
                cursor: unlocked ? 'pointer' : 'not-allowed',
                opacity: unlocked ? 1 : 0.4,
                textAlign: 'left',
                transition: 'all 0.2s ease',
              }}
            >
              {/* Node circle */}
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: isCurrent ? theme.color : isVisited ? theme.bg : 'rgba(255,255,255,0.05)',
                border: `2px solid ${isCurrent ? theme.color : isVisited ? theme.color + '60' : 'rgba(255,255,255,0.1)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.9rem',
                boxShadow: isCurrent ? `0 0 12px ${theme.color}60` : 'none',
              }}>
                {!unlocked ? '🔒' : isCurrent ? theme.emoji : isVisited ? '✓' : theme.emoji}
              </div>

              {/* Scene info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '0.7rem', fontWeight: isCurrent ? 700 : 600,
                  color: isCurrent ? theme.color : isVisited ? 'var(--color-text-light)' : 'var(--color-text-dim)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  Ch.{scene.order_index} · {scene.title}
                </div>
                {isCurrent && (
                  <div style={{ fontSize: '0.6rem', color: 'var(--color-text-dim)', marginTop: 2 }}>
                    ▶ You are here
                  </div>
                )}
                {hasQuest && !isCurrent && (
                  <div style={{ fontSize: '0.6rem', color: '#FFD700', marginTop: 2 }}>
                    ⭐ Quest available
                  </div>
                )}
              </div>

              {/* Status badge */}
              {isVisited && !isCurrent && (
                <div style={{
                  fontSize: '0.6rem', padding: '2px 6px', borderRadius: 8,
                  background: 'rgba(92,219,149,0.15)', color: '#5CDB95',
                  border: '1px solid rgba(92,219,149,0.3)', flexShrink: 0,
                }}>✓</div>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Character badge */}
      <div style={{
        marginTop: 'auto', paddingTop: 12,
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
          background: `linear-gradient(135deg, ${selectedCharacter.color}40, ${selectedCharacter.color}20)`,
          border: `2px solid ${selectedCharacter.color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1rem',
        }}>
          {selectedCharacter.emoji}
        </div>
        <div>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: selectedCharacter.color }}>
            {selectedCharacter.name}
          </div>
          <div style={{ fontSize: '0.55rem', color: 'var(--color-text-dim)' }}>
            {selectedCharacter.specialToolEmoji} {selectedCharacter.specialTool}
          </div>
        </div>
      </div>
    </div>
  );
}
