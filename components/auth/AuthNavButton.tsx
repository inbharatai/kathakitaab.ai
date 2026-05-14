'use client';

// Tiny presence widget for the global nav. Shows "Sign in" when
// anonymous and the user's display name + sign-out when signed in.
// Hides entirely while auth state is loading so the navbar doesn't
// flicker on first paint.

import Link from 'next/link';
import { useAuth } from '@/lib/auth/useAuth';

interface Props {
  /** Path to send the user to after sign-in. Useful for putting
   *  them back on the generate form they tried to use. */
  next?: string;
  /** Compact styling for tight navs. */
  compact?: boolean;
  /** Optional className for the anonymous sign-in link wrapper. */
  className?: string;
}

export function AuthNavButton({ next = '/books', compact = false, className }: Props) {
  const { user, loading, signOut } = useAuth();
  if (loading) return null;

  const padding = compact ? '6px 14px' : '8px 18px';
  const fontSize = compact ? '0.78rem' : '0.85rem';

  if (!user) {
    const href = `/signin${next ? `?next=${encodeURIComponent(next)}` : ''}`;
    return (
      <Link
        href={href}
        className={className || undefined}
        style={className ? undefined : {
          padding,
          borderRadius: 999,
          background: 'linear-gradient(135deg, #FF9933, #FFD700)',
          color: '#0C0806',
          fontWeight: 700, fontSize,
          textDecoration: 'none',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
      >
        Sign in
      </Link>
    );
  }

  const label = (user.user_metadata?.full_name as string | undefined)
    ?? (user.email ? user.email.split('@')[0] : 'You');

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        padding, borderRadius: 999,
        background: 'rgba(255,215,140,0.12)', color: 'var(--color-gold-light)',
        fontSize, fontWeight: 600,
        maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        border: '1px solid rgba(255,215,140,0.22)',
      }}>
        {label}
      </span>
      <button
        type="button"
        onClick={() => void signOut()}
        style={{
          padding: compact ? '5px 12px' : '7px 16px',
          borderRadius: 999,
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.18)',
          color: 'var(--color-text-dim)',
          cursor: 'pointer',
          fontSize: compact ? '0.74rem' : '0.8rem',
        }}
      >
        Sign out
      </button>
    </div>
  );
}
