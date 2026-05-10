// ============================================================
// lib/safety/scrub.ts
//
// Removes child / personally-sensitive fields from any object
// before it hits a logger. Use this on EVERY console.error /
// console.warn / structured-logger payload that might carry a
// classroom or personalized-story request.
//
// Why: a future personalized_photo flow is going to put a child's
// name and an uploaded image path in the request payload. If a
// caught exception ever reaches the production logs with that
// payload attached, we leak PII. The fix isn't to remember every
// time — it's to make logging-without-scrub the harder path.
//
// Three primitives:
//   • scrub(value)     — recursive, deep clone, sensitive keys
//                        replaced with '[redacted]'
//   • scrubError(err)  — extract a safe message + name from a
//                        thrown value
//   • redactString(s)  — pattern-match scrub for free-form text
//                        (catches a child name or email that
//                        accidentally landed in a stack trace)
//
// Honest limits:
//   • This is defense-in-depth. The first defense is not putting
//     PII in error objects in the first place.
//   • Patterns catch known shapes (emails, phones, slug formats);
//     they won't catch arbitrary names. The KEY-name redaction
//     (scrub) catches those — call scrub() on every payload.
// ============================================================

/** Field names whose values we always replace. Lowercase compared
 *  case-insensitively so accidental camelCase variants are caught. */
const SENSITIVE_KEYS = new Set<string>([
  'childname',
  'childfirstname',
  'firstname',
  'lastname',
  'fullname',
  'ownerid',
  'owner_id',
  'prompt',
  'storyidea',
  'story_idea',
  'interests',
  'moral',
  'tone',
  // Photo-specific (V3-ready)
  'photopath',
  'photo_path',
  'photoref',
  'photo_ref',
  'photourl',
  'photo_url',
  'imagepath',
  'image_path',
  'imageurl',
  'image_url',
  'uploadkey',
  'upload_key',
  // Contact-shaped fields if they ever leak in
  'email',
  'phone',
  'phonenumber',
  'phone_number',
  // Auth tokens we should never log
  'cookie',
  'authorization',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'apikey',
  'api_key',
]);

const REDACTED = '[redacted]' as const;

/** Free-form patterns that catch sensitive shapes wherever they
 *  appear — including inside string values that came through. The
 *  patterns are conservative: better to over-redact than to leak. */
const PATTERNS: Array<{ name: string; re: RegExp }> = [
  // Emails
  { name: 'email', re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  // Indian phone (10 digits) and international (+CC...)
  { name: 'phone', re: /\b(?:\+\d{1,3}[\s-]?)?[6-9]\d{9}\b/g },
  // Private slugs (cl- / pv- / pp- + 16 hex). Slugs in user-visible
  // contexts (URLs, error messages to the user) are fine; this
  // catches them in server logs only.
  { name: 'slug', re: /\b(?:cl|pv|pp)-[0-9a-f]{16}\b/gi },
  // UUID v4 (cookie owner IDs)
  { name: 'uuid', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
];

/** Replace any matched pattern in a free-form string with [redacted].
 *  Used for stack traces and error messages where structure isn't
 *  available. */
export function redactString(s: string): string {
  let out = s;
  for (const { re } of PATTERNS) {
    // Reset lastIndex for global regexes used on multiple inputs.
    re.lastIndex = 0;
    out = out.replace(re, REDACTED);
  }
  return out;
}

/** Recursively walks the value and redacts sensitive fields by key
 *  AND patterns inside string values. Returns a deep clone — the
 *  original is never mutated. Cycle-safe via WeakSet. */
export function scrub<T>(value: T): T {
  return scrubInner(value, new WeakSet()) as T;
}

function scrubInner(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string') return redactString(value as string);
  if (t === 'number' || t === 'boolean' || t === 'bigint' || t === 'symbol') return value;
  if (t === 'function') return REDACTED;
  if (Array.isArray(value)) {
    if (seen.has(value as object)) return REDACTED;
    seen.add(value as object);
    return value.map(v => scrubInner(v, seen));
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) return REDACTED;
    seen.add(obj);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = REDACTED;
      } else {
        out[k] = scrubInner(v, seen);
      }
    }
    return out;
  }
  return value;
}

/** Pull a safe { name, message } pair out of an unknown thrown
 *  value. The message goes through redactString so any PII that
 *  ended up in the error text is removed. */
export function scrubError(err: unknown): { name: string; message: string } {
  if (err instanceof Error) {
    return {
      name: err.name || 'Error',
      message: redactString(err.message || ''),
    };
  }
  if (typeof err === 'string') {
    return { name: 'Error', message: redactString(err) };
  }
  // Object thrown that isn't an Error — log a generic shape.
  return { name: 'NonError', message: '[redacted]' };
}
