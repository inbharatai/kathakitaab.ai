'use client';

// /status — public health page. Fetches /api/status on mount, shows
// a coloured pill per dependency. Auto-refreshes every 30s.

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Probe {
  name: string;
  status: 'ok' | 'degraded' | 'down' | 'unconfigured';
  latencyMs: number | null;
  detail?: string;
}

interface StatusPayload {
  overall: Probe['status'];
  checkedAt: string;
  probes: Probe[];
}

const COLOR: Record<Probe['status'], { bg: string; fg: string; dot: string; label: string }> = {
  ok:           { bg: 'rgba(46,139,87,0.18)',  fg: '#5CDB95', dot: '#5CDB95', label: 'Operational' },
  degraded:     { bg: 'rgba(255,170,40,0.18)', fg: '#FFC265', dot: '#FFC265', label: 'Degraded' },
  down:         { bg: 'rgba(255,80,80,0.18)',  fg: '#ff8a8a', dot: '#ff8a8a', label: 'Down' },
  unconfigured: { bg: 'rgba(255,255,255,0.06)', fg: 'rgba(255,255,255,0.55)', dot: 'rgba(255,255,255,0.4)', label: 'Not configured' },
};

export default function StatusPage() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const r = await fetch('/api/status', { cache: 'no-store' });
        if (cancelled) return;
        const j = await r.json() as StatusPayload;
        setData(j);
        setErr(null);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'failed');
      }
      if (!cancelled) timer = setTimeout(tick, 30_000);
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  return (
    <main style={{ minHeight: '100vh', padding: '88px 24px 80px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', color: 'var(--color-text-dim)' }}>
        <Link href="/" style={{ color: 'var(--color-gold)', textDecoration: 'none', fontSize: '0.85rem' }}>← Back</Link>
        <h1 className="font-serif" style={{ fontSize: '2.2rem', color: 'var(--color-gold-light)', marginTop: 24, marginBottom: 6 }}>
          System status
        </h1>
        <p style={{ fontSize: '0.9rem', marginBottom: 28 }}>
          Live health of the third-party services KathaKitaab depends on. Auto-refreshes every 30 seconds.
        </p>

        {err && (
          <p style={{ color: '#ff8a8a', fontSize: '0.9rem' }}>Couldn&apos;t reach /api/status: {err}</p>
        )}

        {data && (
          <>
            <div style={{
              padding: '14px 18px', borderRadius: 12, marginBottom: 22,
              background: COLOR[data.overall].bg, color: COLOR[data.overall].fg,
              border: `1px solid ${COLOR[data.overall].fg}33`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: COLOR[data.overall].dot }} aria-hidden />
                <span style={{ fontWeight: 700, fontSize: '1rem' }}>{COLOR[data.overall].label}</span>
              </div>
              <span style={{ fontSize: '0.78rem', opacity: 0.7 }}>
                Checked {new Date(data.checkedAt).toLocaleTimeString()}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.probes.map(p => (
                <div key={p.name} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '14px 18px', borderRadius: 12,
                  background: 'rgba(43,27,21,0.55)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: 'var(--color-gold-light)', fontWeight: 600 }}>{p.name}</span>
                    {p.detail && <span style={{ fontSize: '0.78rem', opacity: 0.7 }}>{p.detail}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {p.latencyMs !== null && <span style={{ fontSize: '0.78rem', opacity: 0.7 }}>{p.latencyMs}ms</span>}
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      padding: '4px 12px', borderRadius: 999,
                      background: COLOR[p.status].bg, color: COLOR[p.status].fg,
                      fontSize: '0.78rem', fontWeight: 600,
                    }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: COLOR[p.status].dot }} aria-hidden />
                      {COLOR[p.status].label}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {!data && !err && (
          <p style={{ opacity: 0.7 }}>Probing…</p>
        )}
      </div>
    </main>
  );
}
