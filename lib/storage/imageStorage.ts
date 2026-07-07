// ============================================================
// KathaKitaab — Generated-image storage (AWS S3 + CloudFront)
//
// gpt-image-1 returns ~2-3MB base64 PNGs. Caching those raw in Upstash
// Redis (1MB REST limit) silently fails, which is why every scene
// re-generates and the visuals look unstable across visits.
//
// Flow now:
//   1. Generate image → base64 PNG/JPEG bytes.
//   2. Upload to S3 (single bucket, content-hashed key for dedup).
//   3. Return the CloudFront URL (cdn.kathakitaab.com).
//   4. Caller caches the URL (small string) in Redis. Next visit
//      hits the cache, gets the URL, browser fetches the image
//      directly from the CDN — fast and visually consistent.
//
// Falls back to the data URI itself when S3 isn't configured so dev
// keeps working without credentials.
// ============================================================

import { createHash } from 'crypto';
import { putObject } from '@/lib/storage/s3Storage';

export interface UploadedImage {
  publicUrl: string;
  /** Stable hash of the source bytes — handy for dedup if needed. */
  hash: string;
}

/**
 * Upload a base64 image (with or without `data:` prefix) to S3 and
 * return its public CDN URL. If S3 isn't configured, falls back to
 * returning the data URI itself so dev still works.
 */
export async function uploadGeneratedImage(
  dataUriOrBase64: string,
  opts: { mimeType?: string; pathHint?: string; path?: string } = {},
): Promise<string> {
  if (!dataUriOrBase64) return '';

  // If it's already a public URL (e.g. cache hit re-uploads avoided),
  // pass it through unchanged.
  if (/^https?:\/\//i.test(dataUriOrBase64)) return dataUriOrBase64;

  const { mime, base64 } = parseDataUri(dataUriOrBase64, opts.mimeType);
  const bytes = Buffer.from(base64, 'base64');

  // Two pathing modes:
  //   1. Caller supplies an explicit `path` — used by pre-bake scripts
  //      that need stable, predictable URLs (e.g. anchor portraits).
  //      The caller is responsible for collision/sanitization.
  //   2. Otherwise we use a content-hash filename so identical bytes
  //      always land at the same path — that gives us free dedup at
  //      the storage layer for repeated cache misses.
  const ext = mime === 'image/jpeg' ? 'jpg' : 'png';
  let key: string;
  if (opts.path) {
    key = opts.path;
  } else {
    const hash = createHash('sha1').update(bytes).digest('hex');
    const prefix = opts.pathHint ? `${slug(opts.pathHint)}/` : '';
    key = `${prefix}${hash}.${ext}`;
  }

  const result = await putObject(key, bytes, mime);
  if (!result) {
    // No S3 configured (dev) or upload failed — fall back to the data
    // URI so the response still renders. We just lose the durable
    // cross-visit cache win.
    return dataUriOrBase64;
  }

  return result.url;
}

function parseDataUri(input: string, fallbackMime?: string): { mime: string; base64: string } {
  const m = input.match(/^data:([^;]+);base64,(.+)$/);
  if (m) return { mime: m[1], base64: m[2] };
  return { mime: fallbackMime || 'image/png', base64: input };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
