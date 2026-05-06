'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { QuestState, QUEST_TYPE_LABELS, Quest, QuestObjective } from '@/lib/game/questAgent';

interface Props {
  questState: QuestState;
  currentSceneId: string;
}

export default function QuestPanel({ questState, currentSceneId }: Props) {
  const activeQuests = questState.activeQuests;
  const currentSceneQuests = activeQuests.filter(q => q.sceneId === currentSceneId);
  const otherQuests = activeQuests.filter(q => q.sceneId !== currentSceneId);

  return (
    <div style={{ padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      
      {/* Header */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 }}>
          <div style={{ fontSize: '0.6rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2 }}>
            Active Quests
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-gold)', fontWeight: 600 }}>
            {questState.totalQuestsCompleted} Completed
          </div>
        </div>
        <div style={{ height: 1, background: 'linear-gradient(90deg, rgba(255,215,0,0.2) 0%, transparent 100%)' }} />
      </div>

      {activeQuests.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--color-text-dim)' }}>
          <div style={{ fontSize: '2rem', marginBottom: 8, opacity: 0.5 }}>📜</div>
          <div style={{ fontSize: '0.85rem' }}>No active quests.</div>
          <div style={{ fontSize: '0.7rem', marginTop: 4, opacity: 0.7 }}>Explore the world to find your next mission.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <AnimatePresence>
            {/* Current Scene Quests First */}
            {currentSceneQuests.map((quest, i) => (
              <QuestCard key={quest.id} quest={quest} isCurrentScene={true} index={i} />
            ))}
            
            {/* Divider if we have both */}
            {currentSceneQuests.length > 0 && otherQuests.length > 0 && (
              <div style={{ fontSize: '0.65rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center', margin: '8px 0' }}>
                Other Locations
              </div>
            )}

            {/* Other Quests */}
            {otherQuests.map((quest, i) => (
              <QuestCard key={quest.id} quest={quest} isCurrentScene={false} index={i + currentSceneQuests.length} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function QuestCard({ quest, isCurrentScene, index }: { quest: Quest, isCurrentScene: boolean, index: number }) {
  const typeLabel = QUEST_TYPE_LABELS[quest.type as keyof typeof QUEST_TYPE_LABELS] || QUEST_TYPE_LABELS.SIDE;

  const completedCount = quest.objectives.filter((o: QuestObjective) => o.completed).length;
  const totalCount = quest.objectives.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ delay: index * 0.05 }}
      style={{
        background: isCurrentScene ? 'rgba(43,27,21,0.6)' : 'rgba(20,12,8,0.4)',
        border: `1px solid ${isCurrentScene ? 'rgba(255,215,0,0.2)' : 'rgba(255,255,255,0.05)'}`,
        borderRadius: 12, padding: 12,
        boxShadow: isCurrentScene ? '0 4px 12px rgba(255,215,0,0.05)' : 'none',
      }}
    >
      {/* Card Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <div style={{ 
          fontSize: '1.2rem', background: 'rgba(255,255,255,0.05)', 
          width: 28, height: 28, borderRadius: 8, display: 'flex', 
          alignItems: 'center', justifyContent: 'center', flexShrink: 0
        }}>
          {typeLabel.emoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.6rem', color: typeLabel.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {typeLabel.label} {quest.moralWeight !== 'neutral' && `• ${quest.moralWeight}`}
          </div>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-light)', lineHeight: 1.2, marginTop: 2 }}>
            {quest.title}
          </div>
        </div>
      </div>

      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-dim)', marginBottom: 12, lineHeight: 1.4 }}>
        {quest.description}
      </div>

      {/* Objectives */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {quest.objectives.map((obj: QuestObjective) => (
          <div key={obj.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <div style={{ 
              width: 12, height: 12, borderRadius: 3, flexShrink: 0, marginTop: 2,
              border: `1px solid ${obj.completed ? typeLabel.color : 'rgba(255,255,255,0.2)'}`,
              background: obj.completed ? typeLabel.color : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              {obj.completed && <span style={{ fontSize: '0.5rem', color: '#000' }}>✓</span>}
            </div>
            <div style={{ 
              fontSize: '0.75rem', 
              color: obj.completed ? 'var(--color-text-dim)' : 'var(--color-text-light)',
              textDecoration: obj.completed ? 'line-through' : 'none',
              lineHeight: 1.2
            }}>
              {obj.description} {obj.optional && <span style={{ fontSize: '0.6rem', opacity: 0.5 }}>(Optional)</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Progress & Rewards */}
      <div style={{ 
        background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '8px 10px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div style={{ flex: 1, marginRight: 12 }}>
          <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
            <motion.div 
              initial={{ width: 0 }} animate={{ width: `${progress}%` }}
              style={{ height: '100%', background: typeLabel.color }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, fontSize: '0.65rem', fontWeight: 600 }}>
          {quest.reward.xp && <span style={{ color: 'var(--color-gold)' }}>+{quest.reward.xp} XP</span>}
          {quest.reward.coins && <span style={{ color: '#FFD700' }}>+{quest.reward.coins} 🪙</span>}
        </div>
      </div>

    </motion.div>
  );
}
