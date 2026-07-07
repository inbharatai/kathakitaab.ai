// ============================================================
// KathaKitaab — S3 + CloudFront object storage
//
// Replaces Supabase Storage. Generated scene images and narration
// audio are written to a single S3 bucket and served through a
// CloudFront distribution (cdn.kathakitaab.com) for cacheable,
// low-latency delivery.
//
// Env vars (all server-only):
//   KK_S3_BUCKET            — bucket name (required)
//   KK_S3_REGION            — bucket region (defaults to AWS_REGION)
//   KK_S3_ACCESS_KEY_ID      — static key (or AWS_ACCESS_KEY_ID)
//   KK_S3_SECRET_ACCESS_KEY  — static secret (or AWS_SECRET_ACCESS_KEY)
//   KK_CDN_HOST              — e.g. cdn.kathakitaab.com (optional;
//                              falls back to the bucket's public URL)
//
// Safe-by-default: every getter returns null when the bucket or
// credentials are missing, so callers fall back to data URIs (dev)
// instead of crashing. The build never requires S3 to be configured.
// ============================================================

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

interface S3Config {
  bucket: string | undefined;
  region: string | undefined;
  cdnHost: string | undefined;
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
}

function getConfig(): S3Config {
  return {
    bucket: process.env.KK_S3_BUCKET,
    region: process.env.KK_S3_REGION ?? process.env.AWS_REGION,
    cdnHost: process.env.KK_CDN_HOST,
    accessKeyId: process.env.KK_S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.KK_S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY,
  };
}

let cached: S3Client | null | undefined;

/** True only when bucket + credentials are present. */
export function isS3Configured(): boolean {
  const { bucket, accessKeyId, secretAccessKey } = getConfig();
  return !!(bucket && accessKeyId && secretAccessKey);
}

function getClient(): S3Client | null {
  if (!isS3Configured()) return null;
  if (cached) return cached;
  const { region, accessKeyId, secretAccessKey } = getConfig();
  try {
    cached = new S3Client({
      region: region || 'us-east-1',
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    });
    return cached;
  } catch (err) {
    console.warn('[s3Storage] failed to construct client:', err instanceof Error ? err.message : err);
    cached = null;
    return null;
  }
}

/**
 * Public URL for a stored object. Prefers the CloudFront host when
 * configured; otherwise the bucket's virtual-hosted URL.
 */
export function publicUrlFor(key: string): string {
  const { bucket, region, cdnHost } = getConfig();
  const cleanKey = key.replace(/^\/+/, '');
  if (cdnHost) {
    const host = cdnHost.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return `https://${host}/${cleanKey}`;
  }
  return `https://${bucket}.s3.${region || 'us-east-1'}.amazonaws.com/${cleanKey}`;
}

export interface PutResult {
  /** Public CDN/S3 URL of the uploaded object. */
  url: string;
  /** The key the object was stored under. */
  key: string;
}

/**
 * Put bytes into S3 under `key`. Returns the public URL, or null when
 * S3 isn't configured or the upload failed (caller falls back to a
 * data URI). `cacheControl` defaults to the immutable 1-year policy
 * used for content-hashed scene assets.
 */
export async function putObject(
  key: string,
  bytes: Buffer,
  contentType: string,
  cacheControl = 'public, max-age=31536000, immutable',
): Promise<PutResult | null> {
  const client = getClient();
  const { bucket } = getConfig();
  if (!client || !bucket) return null;
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        CacheControl: cacheControl,
      }),
    );
    return { url: publicUrlFor(key), key };
  } catch (err) {
    console.error('[s3Storage] putObject failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Cheap existence check via HeadObject. Returns false when S3 isn't
 * configured, the object is absent (404), or the request errors —
 * callers treat false as "not cached, proceed to render".
 */
export async function objectExists(key: string): Promise<boolean> {
  const client = getClient();
  const { bucket } = getConfig();
  if (!client || !bucket) return false;
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key.replace(/^\/+/, '') }));
    return true;
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    // NotFound / 404 — expected, not an error.
    if (name === 'NotFound' || name === '404') return false;
    return false;
  }
}