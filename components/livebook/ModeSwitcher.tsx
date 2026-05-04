'use client';

interface Props {
  currentMode: 'story' | 'learn' | 'quiz';
  onModeChange: (mode: 'story' | 'learn' | 'quiz') => void;
  hasQuizzes: boolean;
}

export default function ModeSwitcher({ currentMode, onModeChange, hasQuizzes }: Props) {
  return (
    <div style={{ display: 'flex', gap: 8, background: 'rgba(26,14,10,0.8)', padding: 6, borderRadius: 14, border: '1px solid rgba(212,168,71,0.2)', width: 'fit-content' }}>
      <button
        className={`mode-tab ${currentMode === 'story' ? 'active' : ''}`}
        onClick={() => onModeChange('story')}
      >
        📖 Story
      </button>
      <button
        className={`mode-tab ${currentMode === 'learn' ? 'active' : ''}`}
        onClick={() => onModeChange('learn')}
      >
        🎓 Learn
      </button>
      {hasQuizzes && (
        <button
          className={`mode-tab ${currentMode === 'quiz' ? 'active' : ''}`}
          onClick={() => onModeChange('quiz')}
        >
          🧩 Quiz
        </button>
      )}
    </div>
  );
}
