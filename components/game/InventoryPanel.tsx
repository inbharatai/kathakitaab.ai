'use client';

import { motion } from 'framer-motion';
import { TOOL_METADATA } from '@/lib/game/worldMasterAgent';
import { QuestState } from '@/lib/game/questAgent';

interface Props {
  unlockedTools: string[];
  questState: QuestState;
  alignmentScore: number;
}

export default function InventoryPanel({ unlockedTools, questState, alignmentScore }: Props) {
  
  // Group story cards by rarity
  const storyCards = questState.storyCards;
  const cardRarityOrder = { 'LEGENDARY': 0, 'EPIC': 1, 'RARE': 2, 'COMMON': 3 };
  const sortedCards = [...storyCards].sort((a, b) => cardRarityOrder[a.rarity] - cardRarityOrder[b.rarity]);

  return (
    <div style={{ padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      
      {/* Top Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ 
          background: 'rgba(43,27,21,0.6)', border: '1px solid rgba(255,215,0,0.2)', 
          borderRadius: 12, padding: 12, textAlign: 'center' 
        }}>
          <div style={{ fontSize: '0.6rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>Coins</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#FFD700' }}>
            {questState.coins} <span style={{ fontSize: '1rem' }}>🪙</span>
          </div>
        </div>
        <div style={{ 
          background: 'rgba(43,27,21,0.6)', border: '1px solid rgba(255,215,0,0.2)', 
          borderRadius: 12, padding: 12, textAlign: 'center' 
        }}>
          <div style={{ fontSize: '0.6rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>Alignment</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: alignmentScore >= 0 ? '#5CDB95' : '#C39BD3' }}>
            {alignmentScore > 0 ? '+' : ''}{alignmentScore}
          </div>
        </div>
      </div>

      {/* Tools Section */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
          <div style={{ fontSize: '0.6rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2 }}>
            Equipped Tools
          </div>
          <div style={{ fontSize: '0.65rem', color: 'var(--color-saffron)' }}>
            {unlockedTools.length} Unlocked
          </div>
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
          {unlockedTools.map((toolId, i) => {
            const meta = TOOL_METADATA[toolId];
            if (!meta) return null;
            return (
              <motion.div
                key={toolId}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 }}
                style={{
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 12, padding: 10, textAlign: 'center',
                  cursor: 'pointer', transition: 'all 0.2s',
                }}
                whileHover={{ background: 'rgba(255,255,255,0.08)', borderColor: 'var(--color-gold)' }}
              >
                <div style={{ fontSize: '1.8rem', marginBottom: 4, filter: 'drop-shadow(0 0 8px rgba(255,215,0,0.3))' }}>
                  {meta.emoji}
                </div>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-text-light)', lineHeight: 1.1 }}>
                  {meta.gameName}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Story Cards Section */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
          <div style={{ fontSize: '0.6rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 2 }}>
            Story Cards
          </div>
          <div style={{ fontSize: '0.65rem', color: 'var(--color-gold)' }}>
            {storyCards.length} Collected
          </div>
        </div>

        {storyCards.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 16px', background: 'rgba(0,0,0,0.2)', borderRadius: 12 }}>
            <span style={{ fontSize: '1.5rem', opacity: 0.5 }}>🎴</span>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-dim)', marginTop: 4 }}>
              Complete quests to earn cards.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sortedCards.map((card, i) => {
              const rarityColor = 
                card.rarity === 'LEGENDARY' ? '#FFD700' :
                card.rarity === 'EPIC' ? '#C39BD3' :
                card.rarity === 'RARE' ? '#79B8FF' : '#5CDB95';

              return (
                <motion.div
                  key={card.id}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    background: 'rgba(255,255,255,0.03)',
                    borderLeft: `3px solid ${rarityColor}`,
                    borderRight: '1px solid rgba(255,255,255,0.05)',
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: '0 8px 8px 0',
                    padding: '8px 12px',
                  }}
                >
                  <div style={{ fontSize: '1.5rem', background: 'rgba(0,0,0,0.3)', width: 32, height: 32, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {card.illustration}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {card.title}
                      </span>
                      <span style={{ fontSize: '0.5rem', padding: '2px 4px', borderRadius: 4, background: `${rarityColor}20`, color: rarityColor, fontWeight: 700, letterSpacing: 0.5 }}>
                        {card.rarity}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--color-text-dim)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {card.description}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
