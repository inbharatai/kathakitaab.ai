// GET /api/status — provider health probe.
//
// Best-effort ping of every external dependency. Returns JSON the
// /status page renders. Read-only; no auth required.
//
// We deliberately don't spend money on probes (no full image gen,
// no full TTS) — we hit cheap "are you alive" endpoints:
//   - OpenAI: /v1/models (returns instantly when the key is valid)
//   - Sarvam: a minimal 1-character TTS request (charges roughly $0)
//   - Aurora: a SELECT 1 (cheapest possible round-trip)
//   - S3: a HeadObject on a sentinel key (or 'unconfigured' when no creds)
//   - Upstash Redis: a PING
//
// Each probe times out at 4s — we'd rather show "degraded" than hang
// the status page.

import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { auroraQuery, isAuroraEnabled } from '@/lib/db/aurora';
import { isS3Configured, objectExists } from '@/lib/storage/s3Storage';

interface ProbeResult {
  name: string;
  status: 'ok' | 'degraded' | 'down' | 'unconfigured';
  latencyMs: number | null;
  detail?: string;
}

const TIMEOUT_MS = 4_000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<T | null>(resolve => setTimeout(() => resolve(null), ms)),
  ]);
}

async function probeOpenAI(): Promise<ProbeResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { name: 'OpenAI', status: 'unconfigured', latencyMs: null };
  const t0 = Date.now();
  try {
    const res = await withTimeout(
      fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } }),
      TIMEOUT_MS,
    );
    if (!res) return { name: 'OpenAI', status: 'degraded', latencyMs: null, detail: 'timeout' };
    return {
      name: 'OpenAI',
      status: res.ok ? 'ok' : 'degraded',
      latencyMs: Date.now() - t0,
      detail: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    return { name: 'OpenAI', status: 'down', latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : 'error' };
  }
}

async function probeSarvam(): Promise<ProbeResult> {
  const key = process.env.SARVAM_API_KEY;
  if (!key) return { name: 'Sarvam', status: 'unconfigured', latencyMs: null };
  const t0 = Date.now();
  try {
    // List speakers endpoint is the cheapest probe. If they break it
    // we degrade — TTS API itself isn't probed because it'd cost.
    const res = await withTimeout(
      fetch('https://api.sarvam.ai/text-to-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-subscription-key': key },
        body: JSON.stringify({
          inputs: ['hi'], target_language_code: 'en-IN', speaker: 'priya',
          model: process.env.SARVAM_TTS_MODEL || 'bulbul:v3', speech_sample_rate: 22050,
        }),
      }),
      TIMEOUT_MS,
    );
    if (!res) return { name: 'Sarvam', status: 'degraded', latencyMs: null, detail: 'timeout' };
    return {
      name: 'Sarvam',
      status: res.ok ? 'ok' : 'degraded',
      latencyMs: Date.now() - t0,
      detail: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    return { name: 'Sarvam', status: 'down', latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : 'error' };
  }
}

async function probeAurora(): Promise<ProbeResult> {
  if (!isAuroraEnabled()) return { name: 'Aurora', status: 'unconfigured', latencyMs: null };
  const t0 = Date.now();
  try {
    const r = await withTimeout(auroraQuery('SELECT 1'), TIMEOUT_MS);
    if (!r) return { name: 'Aurora', status: 'degraded', latencyMs: null, detail: 'timeout' };
    return { name: 'Aurora', status: 'ok', latencyMs: Date.now() - t0 };
  } catch (err) {
    return { name: 'Aurora', status: 'down', latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : 'error' };
  }
}

async function probeS3(): Promise<ProbeResult> {
  if (!isS3Configured()) return { name: 'S3', status: 'unconfigured', latencyMs: null };
  const t0 = Date.now();
  try {
    // HeadObject on a sentinel key. 404 means "bucket reachable,
    // object absent" — that's still a healthy bucket, so we report ok.
    await withTimeout(objectExists('__kk_status_probe__'), TIMEOUT_MS);
    return { name: 'S3', status: 'ok', latencyMs: Date.now() - t0 };
  } catch (err) {
    return { name: 'S3', status: 'down', latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : 'error' };
  }
}

async function probeRedis(): Promise<ProbeResult> {
  const r = getRedis();
  if (!r) return { name: 'Upstash Redis', status: 'unconfigured', latencyMs: null };
  const t0 = Date.now();
  try {
    const pong = await withTimeout(r.ping(), TIMEOUT_MS);
    return {
      name: 'Upstash Redis',
      status: pong === 'PONG' ? 'ok' : 'degraded',
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    return { name: 'Upstash Redis', status: 'down', latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : 'error' };
  }
}

export async function GET() {
  const [openai, sarvam, aurora, s3, redis] = await Promise.all([
    probeOpenAI(),
    probeSarvam(),
    probeAurora(),
    probeS3(),
    probeRedis(),
  ]);
  const probes = [openai, sarvam, aurora, s3, redis];
  const worst: ProbeResult['status'] = probes.some(p => p.status === 'down') ? 'down'
    : probes.some(p => p.status === 'degraded') ? 'degraded'
    : 'ok';
  return NextResponse.json({
    overall: worst,
    checkedAt: new Date().toISOString(),
    probes,
  }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
