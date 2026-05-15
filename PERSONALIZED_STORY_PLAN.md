# Personalized Story — design plan (NOT YET SHIPPED)

This document captures the design decisions for KathaKitaab's personalized story feature so the next engineering session can implement it without re-litigating the architecture. Nothing here is live in the product. Do not let landing copy, Studio copy, or README claim any of these features until they ship and pass safety review.

Audience: any future engineer (human or AI) picking this up.

---

## Why a plan first

Personalized Story collects a child's first name, age, language, and (in V3) their photo. That data class triggers obligations the rest of the product doesn't have:

- Privacy — these stories must be private by default; we cannot list them on a public gallery
- Moderation — both the prompt that produces the story and the story itself must pass content moderation, with stricter thresholds than for adult-facing content
- Consent — the parent must affirm guardianship before any data is collected
- Retention — uploaded photos are not stored permanently by default
- Honest UX — gpt-image-1 cannot reliably reproduce a specific child's face from a single photo. Any V3 image-upload flow must be honest about what the AI is actually doing

Shipping any of these features in a half-built state is worse than not shipping them. The plan below is sequenced so each phase is independently shippable and independently honest.

---

## V2 — text-only personalization (next session)

The fastest honest version. No photo upload. The child's name, age, and language drive the story; the visual hero is a generic child described to the image model.

### User flow

1. User picks "Personalized Story" mode from the Studio's mode selector (the selector itself doesn't exist yet — V2 ships it)
2. **Consent gate** blocks the form until checked: "I am the parent or legal guardian of the child this story is about. I understand KathaKitaab stores only the data I provide here, marks the story private by default, and lets me delete it at any time."
3. Form fields (in order):
   - Child first name (required, ≤30 chars, no last name input)
   - Age (3–12, drives reading-level + content-strictness tier)
   - Language (English / Hindi / others Sarvam supports cleanly)
   - Story setting — chip from the existing world list ("In the Ramayana world", "In a Panchatantra forest", "A modern adventure")
   - Moral / lesson (optional, free text, ≤80 chars)
   - Prompt (optional, free text, ≤300 chars, "what should happen?")
4. CTA: "Create [name]'s Story"
5. On submit: moderatePrompt() runs over name + prompt + moral. If flagged, generic error.
6. Same generation pipeline as World mode; the only difference is a prompt-template variant that injects the child profile.

### Backend

```
POST /api/books/generate
  body: {
    mode: 'personalized',
    payload: {
      childName: string,
      age: number,
      language: string,
      worldChip?: string,
      moral?: string,
      prompt?: string,
    }
  }
```

The route:
1. Reads or sets the anonymous `ownerId` cookie
2. Runs `moderatePrompt()` on the concatenated user-supplied strings; rejects with 400 if flagged
3. Builds a slug: `personalized-<random16>` (NOT the child's name — we never expose it in URLs)
4. Calls `bookGeneratorAgent` with a personalized prompt-template variant
5. Persists the generated book under `kk:book:<slug>` with:
   - `mode: 'personalized'`
   - `ownerId`
   - `visibility: 'private'`
   - `metadata.personalized: { childFirstName, age, language, consentTimestamp, retainUntil }` — child name STAYS in metadata for re-generation but never goes into the public book schema
6. Adds slug to `kk:owner:<ownerId>:books` set
7. Runs `moderateOutput()` on the generated narration before persisting (any flag ≥ rejected → discard book + refund quota)

### Privacy / authorization rules

- **Private by default.** `/api/books/[slug]` returns 404 unless `ownerId` cookie matches the book's owner.
- **No public gallery** of personalized books. The library page (`/books`) excludes `mode: 'personalized'` entirely.
- **Random slug.** Never use the child's name in the URL.
- **Non-enumerable.** Slug is 16 hex chars from `crypto.randomUUID()`. Brute force at 64 attempts/sec across 16^16 keys is computationally infeasible; we still rate-limit `/api/books/[slug]` to 60/min/cookie to defeat the easier attacks.

### Rate limits

- Personalized generation: 3 per `ownerId` per 24h. Enforced in route handler before generation.
- Anonymous cookies persist 1 year. Resetting the cookie does NOT escape the limit until the day rolls over (we hash IP+UA as a secondary key).

### Delete affordances

- A book reader (`/books/<slug>`) for a personalized book shows a "Delete this story" button visible only to the cookie owner.
- A footer link "Delete all my data" wipes `kk:owner:<ownerId>:*` and removes every book in the owner's set.
- Both delete endpoints take 1 confirmation click — we don't want accidents but we also don't want a 6-step ceremony.

### What V2 does NOT include

- Photo upload (V3)
- Image-based character consistency (V3)
- Cross-device sync (V4)
- Re-generation with edits (V4)
- Sharing (V4)

### Acceptance criteria for V2

1. User can complete the personalized flow without seeing the public library
2. Generated book has the child's first name in narration, hero descriptions tuned to age + language
3. Refresh during generation reattaches via the existing sessionStorage resume
4. Cookie A cannot read cookie B's books (test with two browsers)
5. moderatePrompt() blocks an obvious abuse case (sexual/minors, self-harm) and returns a generic error
6. moderateOutput() catches a hallucinated unsafe scene if one occurs (run a synthetic test where the prompt nudges toward edge content)
7. Delete clears the slug from Redis and surfaces 404 on subsequent reads
8. ESLint clean, tsc clean, no console.log of child name in any code path

---

## V3 — photo upload (later session, after V2 validates demand)

Only worth building if V2 metrics show parents using personalized mode. Don't build photo upload as a speculative feature.

### Two honest options

**Option A — describe-the-photo (cheaper, more honest)**

1. Upload happens to a private Supabase bucket (`scene-images-private/personalized/<ownerId>/<random>.jpg`)
2. Server runs OpenAI Vision (`gpt-4o-mini` with vision input) to generate a TEXT description: "a 7-year-old girl with shoulder-length black hair, brown eyes, wearing a red kurti"
3. The description gets injected into gpt-image-1 prompts for every scene. The image model never sees the photo.
4. Photo is deleted from the bucket immediately after the description is generated, unless the user opts in to "save for re-generation"
5. Honest copy: **"KathaKitaab will create a child character with the colors and clothing from your photo. It is generative art, not photo editing — the AI doesn't copy your child's face."**

This is the recommended path. It's:
- Cheap (~$0.005 per photo via vision)
- Privacy-respecting (photo never travels beyond our server)
- Honest about what the AI delivers (no false expectation of face replication)
- Compatible with our existing image pipeline

**Option B — IP-Adapter / reference image model (paid tier, V4)**

Use a model that genuinely accepts reference images: fal.ai SDXL+IP-Adapter, Replicate Flux Redux, or similar.

- More faithful face reproduction
- Adds a third image provider and ~$0.08 per scene = $0.80 per book
- Photo must be retained throughout the generation (or re-uploaded per scene)
- Privacy bar is higher; needs separate signed-URL flow with explicit per-scene access

Option B becomes a paid-tier upgrade after V3 validates demand for face fidelity over thematic personalization.

### Photo upload — required protections

Every one of these is BLOCKING for V3:

| # | Protection | Implementation |
|---|---|---|
| 1 | Server-side MIME validation | `image/jpeg`, `image/png`, `image/webp` only, sniffed from magic bytes, not just headers |
| 2 | Server-side dimension validation | Max 4096×4096, min 256×256 |
| 3 | Server-side size validation | Max 5MB after EXIF strip |
| 4 | EXIF stripping | All metadata removed on upload, including GPS |
| 5 | Image moderation | OpenAI Vision moderation OR Cloudflare Images NCMEC scan (V4 paid). For V3 MVP: OpenAI omni-moderation-latest with the photo as multimodal input — flag any non-pass and reject the upload. |
| 6 | Private bucket | `scene-images-private` with no public read; signed URLs only |
| 7 | Default retention 0 | Photo deleted immediately after vision description generated unless user opts in |
| 8 | Opt-in retention max 30 days | If retained, deleted after 30 days regardless of opt-in |
| 9 | Per-cookie upload rate limit | 5 uploads/hour |
| 10 | NEVER log photo path or filename in console.log/console.error | Replace with `[redacted-photo-ref]` in any caught exception |

### Output guardrails

- moderateOutput() runs on every scene narration AND every generated scene image (Vision-based moderation on the rendered image, not just the prompt)
- A flagged image causes the WHOLE book to be discarded — no per-scene swap-out. Children don't need a half-disturbing book.
- The hard-block category list for personalized mode includes 'violence/graphic' (excluded from World mode where it's acceptable for Mahabharata battle scenes)

### Acceptance criteria for V3

In addition to V2 criteria:
- Upload of an obviously-inappropriate image is rejected with a generic "we can't use that image" message
- Photo file is gone from the bucket within 60 seconds of generation completing (verify by listing the bucket)
- A book generated from photo A and a book generated from photo B describe visibly different children (child color/clothing differ)
- Console output during a personalized generation never contains the child's name or photo filename

---

## V4 — paid tier (much later)

- Higher-fidelity image personalization via IP-Adapter
- Save photo for re-generation
- More languages
- PDF export (real, not coming-soon)
- Real auth (email magic link or Google) replacing the cookie model
- Cross-device sync
- Sharing personalized books with one specific email (signed-link, expiry)

---

## Data model — what changes in V2 and V3

### Cookie

`katha:owner` — `Set-Cookie: katha:owner=<uuid>; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`

Created in middleware on first request that doesn't have one. NOT in `/api/books/generate` — the middleware approach guarantees every request has one before any handler runs.

### Redis keys (additions)

```
kk:owner:<ownerId>:books        SET<slug>           lifetime
kk:book:<slug>                  GeneratedBook       30d (extended on read for personalized)
kk:rl:personalized:<ownerId>    counter             24h sliding window
kk:rl:photo-upload:<ownerId>    counter             1h sliding window
```

### GeneratedBook schema (additions)

```ts
interface GeneratedBook {
  // ...existing fields...
  mode?: 'world' | 'classroom' | 'personalized';        // V1 adds this
  ownerId?: string;                                       // V2 adds this
  visibility?: 'public' | 'private';                      // V2 adds this; default 'public' for World/Classroom, 'private' for Personalized
  metadata?: {
    classroom?: { gradeBand: '1-3'|'4-6'|'7-9'; language: string; theme: string; tone?: string };  // V1
    personalized?: {
      childFirstName: string;
      age: number;
      language: string;
      consentTimestamp: string;
      retainUntil: string;
      photoDescription?: string;  // V3, replaces photo retention
      photoSavedUntil?: string;   // V3, only when user opts in
    };
  };
}
```

### Logging redaction

Every `console.error` and `console.warn` in personalized code paths must run through:

```ts
function scrub<T>(o: T): T {
  // walk the object, replace fields named childName/firstName/photoPath/uploadKey
  // with '[redacted]'. Used in catch blocks before logging.
}
```

A linter rule (custom or comment-based) forbids `console.error(err)` in `lib/safety/`, `lib/auth/`, and `app/api/books/generate/` — must use `console.error(scrub(err))`.

---

## Implementation order — exact next steps

When the next engineering session picks this up:

1. **Add anonymous cookie middleware** — `middleware.ts` at the project root, sets `katha:owner` UUID cookie if missing. Touches every request. Cheap.
2. **Extend GeneratedBook schema** — add the 4 fields above as optional. No migration needed; existing books just have `mode` undefined.
3. **Build mode-aware generation route** — single `POST /api/books/generate` accepts `{ mode, payload }`, dispatches to mode-specific prompt builders. For V2, only `world` (existing) and `personalized` are wired. Classroom waits for V1.
4. **Wire moderatePrompt() and moderateOutput() throughout** — already built; now plumbed into every personalized code path
5. **Build PersonalizedStoryForm** — child profile + consent + prompt fields, calls the mode-aware route
6. **Build mode selector in Studio** — segmented control, three buttons. World stays the default.
7. **Library filter** — `/books` excludes `mode: 'personalized'` and books with `visibility: 'private'`
8. **Owner-scoped read** — `/api/books/[slug]` checks ownership for private books, 404s otherwise
9. **Delete affordances** — `DELETE /api/books/[slug]` (cookie owner only) and `DELETE /api/owner/all-data`
10. **Per-cookie rate limit** — `kk:rl:personalized:<ownerId>`, 3/24h
11. **Manual QA checklist** — verify the V2 acceptance criteria above
12. **Update Studio Coming-Soon strip** — remove "Personalized Stories" from the list

For V3, add steps 13–25 mirroring the V3 protections + acceptance criteria.

---

## What we are NOT doing

- ❌ Real-time face-swap / deepfake-style image generation
- ❌ Storing children's photos by default
- ❌ Public sharing of personalized stories
- ❌ Selling or training on user-uploaded data
- ❌ Promising "your child as the hero with their actual face" until V4

The honest pitch is "stories about [Child], shaped to their age, language, and what you want them to learn — with art that captures their style, not their likeness." That's both achievable and ethical. Anything beyond it is a feature for V4 with paid-tier privacy infrastructure.

---

*Built honestly. Personalized features ship with safety, or they don't ship.*
