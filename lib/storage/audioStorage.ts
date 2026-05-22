// ============================================================
// KathaKitaab — Generated-narration storage (Supabase Storage)
//
// Sarvam returns ~150KB-500KB WAV buffers per scene. Inline-caching
// those in Upstash Redis silently fails near the 1MB REST limit, so
// the movie/manifest renderer never has stable URLs to feed into
// Remotion's <Audio> source.
//
// Flow:
//   1. speakTTS() returns raw audio Buffer + mime
//   2. uploadGeneratedNarration() puts it in Supabase Storage under a
//      content-hash filename (so identical bytes dedupe at the
//      storage layer)
//   3. Returns the public CDN URL — short string that does fit in
//      the bookRegistry Redis cache
// ============================================================

import { createHash } from 'node:crypto';
import { getSupabaseService } from '@/lib/supabase';

// Audio storage bucket. Falls back to the same bucket as images
// (scene-images) with a subfolder prefix so we don't need a separate
// bucket. Some Supabase projects only ship one public bucket by default.
const BUCKET = process.env.SUPABASE_AUDIO_BUCKET ?? 'scene-images';

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
 * Upload a narration audio buffer to Supabase Storage and return its
 * public URL. Falls back to a `data:audio/...;base64,...` data URI
 * when Supabase isn't configured so dev still works.
 */
export async function uploadGeneratedNarration(
  buffer: Buffer,
  opts: UploadAudioOpts,
): Promise<string> {
  if (!buffer.length) return '';

  const supabase = getSupabaseService();
  if (!supabase) {
    return `data:${opts.mimeType};base64,${buffer.toString('base64')}`;
  }

  const ext = opts.mimeType === 'audio/mpeg' ? 'mp3' : 'wav';
  let path: string;
  if (opts.path) {
    path = opts.path;
  } else {
    const hash = createHash('sha1').update(buffer).digest('hex');
    const prefix = opts.pathHint ? `${slug(opts.pathHint)}/narration/` : 'narration/';
    path = `${prefix}${hash}.${ext}`;
  }

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: opts.mimeType,
      upsert: true, // same hash means same bytes
      cacheControl: 'public, max-age=31536000, immutable',
    });

  if (error) {
    console.error('[audioStorage] upload failed:', error.message);
    return `data:${opts.mimeType};base64,${buffer.toString('base64')}`;
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
