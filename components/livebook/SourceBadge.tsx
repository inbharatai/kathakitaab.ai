'use client';

interface Props {
  note: string;
}

export default function SourceBadge({ note }: Props) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'flex-start', gap: 8,
      padding: '12px 16px', background: 'rgba(58,36,24,0.4)',
      border: '1px solid rgba(212,168,71,0.15)', borderRadius: 12,
      maxWidth: 600, marginTop: 32
    }}>
      <span style={{ fontSize: '1.2rem' }}>📜</span>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-gold-light)', marginBottom: 4 }}>
          Source Note
        </span>
        <span style={{ fontSize: '0.85rem', color: 'var(--color-text-dim)', lineHeight: 1.5 }}>
          {note}
        </span>
      </div>
    </div>
  );
}
