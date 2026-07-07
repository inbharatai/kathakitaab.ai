// ============================================================
// KathaKitaab — Generated-narration storage (AWS S3 + CloudFront)
//
// Sarvam returns ~150KB-500KB WAV buffers per scene. Inline-caching
// those in Upstash Redis silently fails near the 1MB REST limit, so
// the movie/manifest renderer never has stable URLs to feed into
// Remotion's <Audio> source.
//
// Flow:
//   1. speakTTS() returns raw audio Buffer + mime
//   2. uploadGeneratedNarration() puts it in S3 under a content-hash
//      filename (so identical bytes dedupe at the storage layer)
//   3. Returns the CloudFront URL — short string that does fit in
//      the bookRegistry Redis cache
//
// Falls back to a data URI when S3 isn't configured so dev still works.
// ============================================================

import { createHash } from 'crypto';
import { putObject } from '@/lib/storage/s3Storage';

export interface UploadAudioOpts {
  /** Folder prefix inside the bucket — usually the book slug, so
   *  artefacts for "akbar-and-birbal" land under that folder. */
  pathHint?: string;
  /** Explicit path to upload to. When provided, skips the content-
   *  hash filename — useful for deterministic per-scene paths. */
  path?: string;
  mimeType: string;
}

/**
 * Upload a narration audio buffer to S3 and return its public CDN
 * URL. Falls back to a `data:audio/...;base64,...` data URI when S3
 * isn't configured so dev still works.
 */
export async function uploadGeneratedNarration(
  buffer: Buffer,
  opts: UploadAudioOpts,
): Promise<string> {
  if (!buffer.length) return '';

  const ext = opts.mimeType === 'audio/mpeg' ? 'mp3' : 'wav';
  let key: string;
  if (opts.path) {
    key = opts.path;
  } else {
    const hash = createHash('sha1').update(buffer).digest('hex');
    const prefix = opts.pathHint ? `${slug(opts.pathHint)}/narration/` : 'narration/';
    key = `${prefix}${hash}.${ext}`;
  }

  const result = await putObject(key, buffer, opts.mimeType);
  if (!result) {
    return `data:${opts.mimeType};base64,${buffer.toString('base64')}`;
  }
  return result.url;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
