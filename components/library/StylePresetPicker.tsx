'use client';

// ============================================================
// components/library/StylePresetPicker.tsx
//
// Shared visual-style picker used by every generation form in the
// Studio — world mode, classroom mode, personalized mode. One
// component keeps the cards and the active-state styling in
// lockstep so adding a fourth (or fifth) preset only requires
// touching lib/types/style.ts.
//
// Iterates Object.keys(STYLE_PRESETS) so the row auto-updates as
// new presets are registered. Disabled state mirrors the parent
// form's busy flag so users can't switch styles mid-generation.
// ============================================================

import { STYLE_PRESETS, type StylePreset } from '@/lib/types/style';

interface Props {
  value: StylePreset;
  onChange: (next: StylePreset) => void;
  disabled?: boolean;
  /** Label shown above the picker. Defaults to "Visual style". */
  label?: string;
}

export function StylePresetPicker({ value, onChange, disabled = false, label = 'Visual style' }: Props) {
  return (
    <div>
      <div style={{
        fontSize: '0.72rem', color: 'var(--color-text-dim)',
        textTransform: 'uppercase', letterSpacing: '0.18em', marginBottom: 10,
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {(Object.keys(STYLE_PRESETS) as StylePreset[]).map(key => {
          const meta = STYLE_PRESETS[key];
          const active = value === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => !disabled && onChange(key)}
              disabled={disabled}
              style={{
                flex: '1 1 220px',
                minWidth: 200,
                padding: '12px 14px',
                textAlign: 'left',
                borderRadius: 12,
                border: active ? '1px solid var(--color-gold)' : '1px solid rgba(255,255,255,0.08)',
                background: active ? 'rgba(212,168,71,0.12)' : 'rgba(255,255,255,0.03)',
                color: active ? 'var(--color-gold-light)' : 'var(--color-text-dim)',
                cursor: disabled ? 'default' : 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: '0.92rem', fontWeight: 600, marginBottom: 4 }}>
                {meta.label}
              </div>
              <div style={{ fontSize: '0.78rem', lineHeight: 1.45, color: active ? 'rgba(255,255,255,0.78)' : 'var(--color-text-dim)' }}>
                {meta.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
