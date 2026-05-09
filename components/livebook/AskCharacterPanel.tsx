'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AskCharacterResponse, AnswerLabel } from '@/lib/types/livebook';

interface Props {
  bookSlug: string;
  sceneId: string;
  characterSlug: string;
  characterName: string;
  suggestedQuestions: string[];
}

export default function AskCharacterPanel({ bookSlug, sceneId, characterSlug, characterName, suggestedQuestions }: Props) {
  const [question, setQuestion] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [response, setResponse] = useState<AskCharacterResponse | null>(null);
  const [error, setError] = useState('');
  const [isResponseCollapsed, setIsResponseCollapsed] = useState(false);

  const askQuestion = async (q: string) => {
    if (!q.trim()) return;
    
    setIsAsking(true);
    setError('');
    setQuestion(q);
    
    try {
      const res = await fetch('/api/livebook/ask-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookSlug,
          sceneId,
          characterSlug,
          question: q,
          mode: 'explanation'
        }),
      });

      // Check status BEFORE parsing — a 5xx may return HTML error
      // page bodies that crash JSON.parse with an opaque error,
      // hiding the real failure from the catch handler.
      if (!res.ok) {
        let serverMsg = '';
        try {
          const j = await res.json();
          serverMsg = j.error || '';
        } catch { /* non-JSON body */ }
        throw new Error(serverMsg || `Failed to get answer (${res.status})`);
      }
      const data = await res.json();

      setResponse(data);
      setIsResponseCollapsed(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsAsking(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    askQuestion(question);
  };

  const getLabelClass = (label: AnswerLabel) => {
    return `label-badge label-${label.toLowerCase()}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Suggestions */}
      {!response && !isAsking && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-dim)' }}>Suggested questions:</p>
          {suggestedQuestions.map(sq => (
            <button
              key={sq}
              onClick={() => askQuestion(sq)}
              style={{
                textAlign: 'left', padding: '10px 14px', borderRadius: 8,
                background: 'rgba(58,36,24,0.4)', border: '1px solid rgba(212,168,71,0.15)',
                color: 'var(--color-gold-light)', fontSize: '0.9rem', cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseOver={e => (e.currentTarget.style.background = 'rgba(58,36,24,0.8)')}
              onMouseOut={e => (e.currentTarget.style.background = 'rgba(58,36,24,0.4)')}
            >
              {sq}
            </button>
          ))}
        </div>
      )}

      {/* Answer Area */}
      {isAsking && (
        <div className="glass-card" style={{ padding: 24, textAlign: 'center' }}>
          <div className="shimmer" style={{ height: 60, borderRadius: 8, opacity: 0.5 }} />
          <p style={{ fontSize: '0.9rem', color: 'var(--color-saffron)', marginTop: 12 }}>
            {characterName} is thinking...
          </p>
        </div>
      )}

      {error && (
        <div style={{ padding: 16, background: 'rgba(139,34,82,0.2)', border: '1px solid rgba(139,34,82,0.4)', borderRadius: 8, color: '#ff8a8a', fontSize: '0.9rem' }}>
          {error}
        </div>
      )}

      {response && !isAsking && (
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div style={{ fontWeight: 600, color: 'var(--color-gold-light)' }}>{characterName}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <span className={getLabelClass(response.label)}>{response.label}</span>
              <button
                onClick={() => setIsResponseCollapsed(collapsed => !collapsed)}
                style={{
                  padding: '6px 10px', borderRadius: 999,
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  color: 'var(--color-text-dim)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600,
                }}
              >
                {isResponseCollapsed ? 'Show text' : 'Hide text'}
              </button>
            </div>
          </div>

          <AnimatePresence initial={false} mode="wait">
            {isResponseCollapsed ? (
              <motion.div
                key="collapsed-ask-response"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                style={{
                  padding: '12px 14px', borderRadius: 12,
                  background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.1)',
                  color: 'var(--color-text-dim)', fontSize: '0.8rem',
                }}
              >
                Generated text is hidden so the visual stays clear.
              </motion.div>
            ) : (
              <motion.div
                key="expanded-ask-response"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
              >
                <p className="font-serif" style={{ fontSize: '1.05rem', lineHeight: 1.7, color: 'var(--color-text-light)', margin: 0 }}>
                  {response.answer}
                </p>
                <div style={{ borderTop: '1px solid rgba(212,168,71,0.1)', paddingTop: 16, fontSize: '0.8rem', color: 'var(--color-text-dim)' }}>
                  <span style={{ opacity: 0.8 }}>Source Base:</span> {response.source_note}
                </div>
                
                {response.next_options && response.next_options.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {response.next_options.map(opt => (
                      <button
                        key={opt}
                        onClick={() => askQuestion(opt)}
                        style={{
                          textAlign: 'left', padding: '8px 12px', borderRadius: 6,
                          background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)',
                          color: 'var(--color-saffron-light)', fontSize: '0.85rem', cursor: 'pointer',
                        }}
                        onMouseOver={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.4)')}
                        onMouseOut={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.2)')}
                      >
                        Ask: {opt}
                      </button>
                    ))}
                  </div>
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Input Form */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
        <input
          type="text"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder={`Ask ${characterName} something...`}
          style={{
            flex: 1, padding: '12px 16px', borderRadius: 12,
            background: 'rgba(26,14,10,0.6)', border: '1px solid rgba(212,168,71,0.3)',
            color: 'var(--color-text-light)', fontSize: '1rem', outline: 'none'
          }}
          disabled={isAsking}
        />
        <button
          type="submit"
          className="btn-primary"
          style={{ padding: '0 24px' }}
          disabled={!question.trim() || isAsking}
        >
          Ask
        </button>
      </form>
    </div>
  );
}
