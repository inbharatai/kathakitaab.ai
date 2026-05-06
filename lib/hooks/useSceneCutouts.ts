'use client';

// ============================================================
// useSceneCutouts
//
// Discovers per-scene character-cutout PNGs on disk by HEAD-checking
// /images/layers/{slug}/{sceneId}/{target_id}.png. Returns a map
// keyed by hotspot target_id of cutouts that exist; missing entries
// fall through to virtual ellipse-clip mode in SceneLayers.
//
// Why HEAD-check vs a manifest field: the slicer writes lazily, so
// new books / new scenes don't need to update a separate index.
// One HEAD per character per scene is a few KB total and the
// browser caches the response.
//
// The hook also returns an optional bgPlateUrl when bg.png exists,
// signaling sliced mode for the bg layer (no need for the virtual
// blur fallback).
// ============================================================

import { useEffect, useState } from 'react';

export interface SceneCutouts {
  /** Bg-plate URL when sliced; undefined → use virtual fallback. */
  bgPlateUrl?: string;
  /** target_id → cutout PNG URL. */
  cutouts: Record<string, string>;
}

interface UseSceneCutoutsArgs {
  bookSlug: string;
  sceneId: string;
  /** Hotspot target_ids we expect cutouts for. */
  targetIds: string[];
}

const headCache = new Map<string, boolean>();

async function exists(url: string): Promise<boolean> {
  const cached = headCache.get(url);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const ok = res.ok;
    headCache.set(url, ok);
    return ok;
  } catch {
    headCache.set(url, false);
    return false;
  }
}

export function useSceneCutouts({ bookSlug, sceneId, targetIds }: UseSceneCutoutsArgs): SceneCutouts {
  const [state, setState] = useState<SceneCutouts>({ cutouts: {} });

  useEffect(() => {
    let cancelled = false;
    const base = `/images/layers/${bookSlug}/${sceneId}`;
    (async () => {
      const bgUrl = `${base}/bg.png`;
      const charChecks = await Promise.all(
        targetIds.map(async id => [id, await exists(`${base}/${id}.png`)] as const),
      );
      const bgOk = await exists(bgUrl);
      if (cancelled) return;
      const cutouts: Record<string, string> = {};
      for (const [id, ok] of charChecks) {
        if (ok) cutouts[id] = `${base}/${id}.png`;
      }
      setState({ bgPlateUrl: bgOk ? bgUrl : undefined, cutouts });
    })();
    return () => { cancelled = true; };
    // targetIds is intentionally serialized to avoid identity-instability
    // re-runs when the parent rebuilds the array each render.
  }, [bookSlug, sceneId, targetIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
