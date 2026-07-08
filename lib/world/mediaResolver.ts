// ============================================================
// KathaKitaab — World media resolver
//
// The story-planet must never render a blank tile. Scene background
// URLs are baked into the book record at generation time; when Supabase
// storage was removed, every AI-generated book's image URLs became
// dead `*.supabase.co` links. This module detects those + any empty
// URL and tells the renderer to paint a procedural place (shader
// terrain tinted by biome + mood, with a biome glyph) instead of a
// broken <img>.
//
// Detection is by host suffix only — NO network on the hot path. The
// Supabase removal is a known, permanent fact, so a host match is
// authoritative. A live URL (S3/CloudFront or a local /images path)
// is returned unchanged.
//
// Used by the 3D place markers + the v1 fallback narration overlay.
// ============================================================

import type { Biome } from '@/lib/world/worldManifest';

export type ResolvedMedia =
  | { kind: 'live'; url: string }
  | { kind: 'procedural'; biome: Biome; mood: string };

/** Hosts known to be dead (Supabase storage was removed 2026-07-07). */
const DEAD_HOSTS = ['supabase.co'];

/** True for URLs that point at the removed Supabase storage or are
 *  empty/blank. Local `/images/...` paths and `cdn.kathakitaab.com`
 *  URLs are alive. */
export function isDeadMediaUrl(url: string | undefined | null): boolean {
  if (!url) return true;
  const u = url.trim();
  if (!u) return true;
  // Local static paths are alive (Ramayana seed uses /images/...).
  if (u.startsWith('/')) return false;
  if (/^https?:\/\//i.test(u)) {
    try {
      const host = new URL(u).hostname.toLowerCase();
      return DEAD_HOSTS.some(d => host === d || host.endsWith(`.${d}`));
    } catch {
      return false;
    }
  }
  return false;
}

/** Resolve a place's background media. Procedural fallback for dead
 *  URLs so the planet never shows a broken tile. */
export function resolvePlaceMedia(
  url: string | undefined | null,
  biome: Biome,
  mood: string,
): ResolvedMedia {
  if (!isDeadMediaUrl(url)) {
    return { kind: 'live', url: (url ?? '').trim() };
  }
  return { kind: 'procedural', biome, mood };
}