'use client';

interface Props {
  currentMode: 'story' | 'learn' | 'quiz';
  onModeChange: (mode: 'story' | 'learn' | 'quiz') => void;
  hasQuizzes: boolean;
  compact?: boolean;
}

export default function ModeSwitcher({ currentMode, onModeChange, hasQuizzes, compact = false }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        background: 'rgba(26,14,10,0.8)',
        padding: 6,
        borderRadius: 14,
        border: '1px solid rgba(212,168,71,0.2)',
        width: compact ? '100%' : 'fit-content',
        maxWidth: '100%',
        overflowX: compact ? 'auto' : 'visible',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <button
        className={`mode-tab ${currentMode === 'story' ? 'active' : ''}`}
        onClick={() => onModeChange('story')}
        style={{ flex: '0 0 auto' }}
      >
        📖 Story
      </button>
      <button
        className={`mode-tab ${currentMode === 'learn' ? 'active' : ''}`}
        onClick={() => onModeChange('learn')}
        style={{ flex: '0 0 auto' }}
      >
        🎓 Learn
      </button>
      {hasQuizzes && (
        <button
          className={`mode-tab ${currentMode === 'quiz' ? 'active' : ''}`}
          onClick={() => onModeChange('quiz')}
          style={{ flex: '0 0 auto' }}
        >
          🧩 Quiz
        </button>
      )}
    </div>
  );
}
