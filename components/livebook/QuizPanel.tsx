'use client';

import { useState } from 'react';
import { QuizQuestion } from '@/lib/types/livebook';

interface Props {
  sceneId: string;
  quizzes: QuizQuestion[];
  onAnswer?: (correct: boolean, x: number, y: number) => void;
}

export default function QuizPanel({ sceneId, quizzes, onAnswer }: Props) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [results, setResults] = useState<Record<string, { correct: boolean; explanation: string; correctAnswer: number }>>({});

  if (!quizzes || quizzes.length === 0) {
    return (
      <div className="glass-card" style={{ padding: 32, textAlign: 'center', marginTop: 24 }}>
        <p style={{ color: 'var(--color-text-dim)' }}>No quizzes available for this scene yet.</p>
      </div>
    );
  }

  const handleAnswer = async (quizId: string, selectedAnswer: number, e: React.MouseEvent) => {
    setAnswers(prev => ({ ...prev, [quizId]: selectedAnswer }));

    try {
      const res = await fetch('/api/livebook/quiz-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quizId, sceneId, selectedAnswer }),
      });
      const data = await res.json();
      
      if (res.ok) {
        setResults(prev => ({ ...prev, [quizId]: data }));
        onAnswer?.(data.correct, e.clientX, e.clientY);
      }
    } catch (error) {
      console.error('Error submitting quiz answer:', error);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 24 }}>
      {quizzes.map((quiz, index) => {
        const result = results[quiz.id];
        const isAnswered = result !== undefined;

        return (
          <div key={quiz.id} className="glass-card" style={{ padding: 32 }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--color-gold-light)', marginBottom: 20 }}>
              Question {index + 1}: {quiz.question}
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {quiz.options.map((option, optIdx) => {
                const isSelected = answers[quiz.id] === optIdx;
                let bgStyle = 'rgba(58,36,24,0.6)';
                let borderStyle = '1px solid rgba(212,168,71,0.2)';
                
                if (isAnswered) {
                  if (optIdx === result.correctAnswer) {
                    bgStyle = 'rgba(46,139,87,0.2)';
                    borderStyle = '1px solid #5CDB95';
                  } else if (isSelected && !result.correct) {
                    bgStyle = 'rgba(139,34,82,0.2)';
                    borderStyle = '1px solid #ff8a8a';
                  }
                } else if (isSelected) {
                  bgStyle = 'rgba(232,131,42,0.2)';
                  borderStyle = '1px solid var(--color-saffron)';
                }

                return (
                  <button
                    key={optIdx}
                  onClick={(e) => !isAnswered && handleAnswer(quiz.id, optIdx, e)}
                    disabled={isAnswered}
                    style={{
                      textAlign: 'left', padding: '14px 20px', borderRadius: 12,
                      background: bgStyle, border: borderStyle,
                      color: 'var(--color-text-light)', fontSize: '1rem', cursor: isAnswered ? 'default' : 'pointer',
                      transition: 'all 0.2s',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                    }}
                  >
                    <span>{option}</span>
                    {isAnswered && optIdx === result.correctAnswer && <span style={{ color: '#5CDB95' }}>✓</span>}
                    {isAnswered && isSelected && !result.correct && <span style={{ color: '#ff8a8a' }}>✕</span>}
                  </button>
                );
              })}
            </div>

            {result && (
              <div style={{ marginTop: 24, padding: 16, borderRadius: 12, background: 'rgba(26,14,10,0.6)', borderLeft: `4px solid ${result.correct ? '#5CDB95' : '#ff8a8a'}` }}>
                <p style={{ fontWeight: 600, color: result.correct ? '#5CDB95' : '#ff8a8a', marginBottom: 8 }}>
                  {result.correct ? 'Correct!' : 'Not quite.'}
                </p>
                <p style={{ fontSize: '0.95rem', color: 'var(--color-text-dim)', lineHeight: 1.5 }}>
                  {result.explanation}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
