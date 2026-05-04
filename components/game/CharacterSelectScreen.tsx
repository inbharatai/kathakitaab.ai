'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface PlayableCharacter {
  id: string;
  name: string;
  class: string;
  emoji: string;
  description: string;
  traits: string[];
  stats: {
    strength: number;
    intelligence: number;
    courage: number;
    creativity: number;
    empathy: number;
    memory: number;
  };
  specialTool: string;
  specialToolEmoji: string;
  weakness: string;
  color: string;
  glowColor: string;
}

export const PLAYABLE_CHARACTERS: PlayableCharacter[] = [
  {
    id: 'hero',
    name: 'The Hero',
    class: 'hero',
    emoji: '⚔️',
    description: 'Born for great deeds. Leads with courage and inspires all around.',
    traits: ['Brave', 'Loyal', 'Just', 'Strong', 'Inspiring'],
    stats: { strength: 9, intelligence: 6, courage: 10, creativity: 5, empathy: 7, memory: 6 },
    specialTool: 'Talking Conch',
    specialToolEmoji: '🐚',
    weakness: 'Impatience',
    color: '#FF9933',
    glowColor: 'rgba(255,153,51,0.4)',
  },
  {
    id: 'detective',
    name: 'The Detective',
    class: 'detective',
    emoji: '🔍',
    description: 'Sees what others miss. Every clue is a doorway to truth.',
    traits: ['Sharp', 'Patient', 'Analytical', 'Observant', 'Persistent'],
    stats: { strength: 5, intelligence: 10, courage: 7, creativity: 8, empathy: 6, memory: 9 },
    specialTool: 'Knowledge Oracle',
    specialToolEmoji: '🔮',
    weakness: 'Overconfidence',
    color: '#79B8FF',
    glowColor: 'rgba(121,184,255,0.4)',
  },
  {
    id: 'scientist',
    name: 'The Scientist',
    class: 'scientist',
    emoji: '🔬',
    description: 'Questions everything. Turns curiosity into world-changing discovery.',
    traits: ['Curious', 'Precise', 'Logical', 'Inventive', 'Skeptical'],
    stats: { strength: 4, intelligence: 10, courage: 6, creativity: 9, empathy: 5, memory: 10 },
    specialTool: 'Magic Paintbrush',
    specialToolEmoji: '🎨',
    weakness: 'Emotional detachment',
    color: '#5CDB95',
    glowColor: 'rgba(92,219,149,0.4)',
  },
  {
    id: 'warrior',
    name: 'The Warrior',
    class: 'warrior',
    emoji: '🛡️',
    description: 'Protects the weak. Unmatched in courage, unwavering in duty.',
    traits: ['Disciplined', 'Fearless', 'Protective', 'Honorable', 'Fierce'],
    stats: { strength: 10, intelligence: 5, courage: 10, creativity: 4, empathy: 6, memory: 5 },
    specialTool: 'Trial Chamber',
    specialToolEmoji: '⚡',
    weakness: 'Stubbornness',
    color: '#FF6B6B',
    glowColor: 'rgba(255,107,107,0.4)',
  },
  {
    id: 'monk',
    name: 'The Monk',
    class: 'monk',
    emoji: '🧘',
    description: 'Master of inner stillness. Wisdom flows from a quiet mind.',
    traits: ['Peaceful', 'Wise', 'Patient', 'Compassionate', 'Disciplined'],
    stats: { strength: 4, intelligence: 9, courage: 7, creativity: 7, empathy: 10, memory: 8 },
    specialTool: 'Wisdom Scroll',
    specialToolEmoji: '📜',
    weakness: 'Passivity',
    color: '#C39BD3',
    glowColor: 'rgba(195,155,211,0.4)',
  },
  {
    id: 'explorer',
    name: 'The Explorer',
    class: 'explorer',
    emoji: '🧭',
    description: 'Every horizon is a new beginning. Born to chart the unknown.',
    traits: ['Adventurous', 'Resourceful', 'Optimistic', 'Adaptable', 'Curious'],
    stats: { strength: 7, intelligence: 7, courage: 8, creativity: 8, empathy: 6, memory: 7 },
    specialTool: 'World Compass',
    specialToolEmoji: '🧭',
    weakness: 'Restlessness',
    color: '#FFD700',
    glowColor: 'rgba(255,215,0,0.4)',
  },
  {
    id: 'creator',
    name: 'The Creator',
    class: 'creator',
    emoji: '🎨',
    description: 'Builds worlds from imagination. Art is their greatest weapon.',
    traits: ['Imaginative', 'Expressive', 'Empathetic', 'Visionary', 'Sensitive'],
    stats: { strength: 4, intelligence: 8, courage: 6, creativity: 10, empathy: 9, memory: 6 },
    specialTool: 'Comic Forge',
    specialToolEmoji: '🖼️',
    weakness: 'Self-doubt',
    color: '#F5A623',
    glowColor: 'rgba(245,166,35,0.4)',
  },
  {
    id: 'student',
    name: 'The Student',
    class: 'student',
    emoji: '📚',
    description: 'The most dangerous person in any room. Always learning, always growing.',
    traits: ['Eager', 'Humble', 'Persistent', 'Open-minded', 'Questioning'],
    stats: { strength: 5, intelligence: 9, courage: 6, creativity: 7, empathy: 8, memory: 10 },
    specialTool: 'Wisdom Scroll',
    specialToolEmoji: '📜',
    weakness: 'Inexperience',
    color: '#138808',
    glowColor: 'rgba(19,136,8,0.4)',
  },
];

interface Props {
  bookTitle: string;
  onSelect: (character: PlayableCharacter) => void;
  onBack: () => void;
}

export default function CharacterSelectScreen({ bookTitle, onSelect, onBack }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const activeId = selected ?? hovered ?? PLAYABLE_CHARACTERS[0].id;
  const activeChar = PLAYABLE_CHARACTERS.find(c => c.id === activeId) ?? PLAYABLE_CHARACTERS[0];

  const handleEnter = () => {
    if (!selected) return;
    const char = PLAYABLE_CHARACTERS.find(c => c.id === selected);
    if (char) onSelect(char);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'radial-gradient(circle at 50% 0%, rgba(128,0,0,0.28) 0%, #0C0806 60%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', overflowY: 'auto',
    }}>
      {Array.from({ length: 14 }).map((_, i) => (
        <motion.div key={i}
          animate={{ y: [-20, -80, -20], opacity: [0, 0.6, 0], x: [0, (i % 2 === 0 ? 20 : -20), 0] }}
          transition={{ duration: 3 + (i % 3), repeat: Infinity, delay: i * 0.3 }}
          style={{
            position: 'absolute',
            left: `${5 + (i * 4.8) % 90}%`,
            bottom: `${10 + (i * 7) % 40}%`,
            width: 4, height: 4, borderRadius: '50%',
            background: activeChar.color,
            filter: 'blur(1px)',
            pointerEvents: 'none',
          }}
        />
      ))}

      <button onClick={onBack} style={{
        position: 'absolute', top: 24, left: 24,
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10, padding: '8px 16px', color: 'var(--color-text-dim)',
        cursor: 'pointer', fontSize: '0.85rem',
      }}>
        ← Back
      </button>

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
        style={{ textAlign: 'center', marginBottom: 28, padding: '72px 24px 0' }}>
        <div style={{ fontSize: '0.72rem', color: activeChar.color, textTransform: 'uppercase', letterSpacing: 3, marginBottom: 10 }}>
          {bookTitle}
        </div>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)', fontWeight: 800, color: 'white', margin: 0 }}>
          Choose Who You Become
        </h1>
        <p style={{ color: 'var(--color-text-dim)', marginTop: 10, fontSize: '0.98rem', lineHeight: 1.7, maxWidth: 620 }}>
          Pick a voice for this chapter. The story will quietly adapt to your character without turning the screen into a dashboard.
        </p>
      </motion.div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 1120, width: '100%', padding: '0 24px 40px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          {PLAYABLE_CHARACTERS.map((char, i) => (
            <motion.button
              key={char.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              onMouseEnter={() => setHovered(char.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setSelected(char.id)}
              style={{
                background: selected === char.id
                  ? `linear-gradient(135deg, ${char.color}28, rgba(43,27,21,0.72))`
                  : 'rgba(43,27,21,0.45)',
                border: `1px solid ${selected === char.id ? char.color : hovered === char.id ? char.color + '80' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 18, padding: '18px 16px',
                cursor: 'pointer', textAlign: 'left',
                transition: 'all 0.25s ease',
                boxShadow: selected === char.id ? `0 0 24px ${char.glowColor}` : 'none',
                minHeight: 168,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ fontSize: '2rem' }}>{char.emoji}</div>
                <div style={{
                  fontSize: '0.62rem', padding: '4px 10px', borderRadius: 999,
                  background: `${char.color}18`, color: char.color,
                  border: `1px solid ${char.color}30`,
                }}>
                  {char.specialToolEmoji} Quiet Gift
                </div>
              </div>
              <div style={{
                fontSize: '0.92rem', fontWeight: 700,
                color: selected === char.id ? char.color : 'var(--color-text-light)',
                lineHeight: 1.2,
              }}>
                {char.name}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-dim)', marginTop: 8, lineHeight: 1.5 }}>
                {char.description}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
                {char.traits.slice(0, 3).map(trait => (
                  <span key={trait} style={{
                    fontSize: '0.62rem', padding: '3px 8px', borderRadius: 999,
                    background: 'rgba(255,255,255,0.05)', color: 'var(--color-text-dim)',
                  }}>
                    {trait}
                  </span>
                ))}
              </div>
            </motion.button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeChar.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="glass-card"
            style={{
              padding: 28,
              background: `linear-gradient(135deg, rgba(43,27,21,0.82), rgba(28,18,14,0.92))`,
              border: `1px solid ${activeChar.color}36`,
              boxShadow: `0 0 40px ${activeChar.glowColor}`,
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 18 }}>
              <div style={{ maxWidth: 680 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div style={{ fontSize: '2.8rem' }}>{activeChar.emoji}</div>
                  <div>
                    <div style={{ fontSize: '1.45rem', fontWeight: 800, color: activeChar.color }}>{activeChar.name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>
                      Story-first play style
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: '0.92rem', color: 'var(--color-text-dim)', lineHeight: 1.7 }}>
                  {activeChar.description}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                  {activeChar.traits.map(trait => (
                    <span key={trait} style={{
                      padding: '4px 10px', borderRadius: 999, fontSize: '0.66rem', fontWeight: 600,
                      background: `${activeChar.color}16`, color: activeChar.color,
                      border: `1px solid ${activeChar.color}32`,
                    }}>{trait}</span>
                  ))}
                </div>
                <div style={{ marginTop: 16, fontSize: '0.82rem', color: 'var(--color-text-dim)', lineHeight: 1.6 }}>
                  <span style={{ color: activeChar.color, fontWeight: 700 }}>Quiet gift:</span> {activeChar.specialToolEmoji} {activeChar.specialTool}
                </div>
                <div style={{ marginTop: 6, fontSize: '0.78rem', color: 'var(--color-text-dim)' }}>
                  Move with {activeChar.weakness.toLowerCase()} in mind. It will shape how the story answers you.
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleEnter}
                disabled={!selected}
                style={{
                  minWidth: 220,
                  minHeight: 54,
                  padding: '0 24px',
                  background: selected ? `linear-gradient(135deg, ${activeChar.color}, ${activeChar.color}cc)` : 'rgba(255,255,255,0.05)',
                  border: 'none', borderRadius: 999, cursor: selected ? 'pointer' : 'not-allowed',
                  fontSize: '0.98rem', fontWeight: 800,
                  color: selected ? '#1a0e0a' : 'var(--color-text-dim)',
                  transition: 'all 0.3s ease',
                  boxShadow: selected ? `0 8px 24px ${activeChar.glowColor}` : 'none',
                }}
              >
                {selected ? `Enter the story as ${activeChar.name}` : 'Select a character'}
              </motion.button>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
