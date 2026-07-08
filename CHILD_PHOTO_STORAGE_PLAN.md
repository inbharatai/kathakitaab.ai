# Child photo upload — storage & safety plan (NOT YET SHIPPED)

> **⚠ SUPERSEDED STORAGE BACKEND — read before implementing.**
> This plan was written when KathaKitaab used **Supabase Storage** for assets.
> Supabase was removed on 2026-07-07. Asset storage is now **AWS S3 served via
> CloudFront** (`cdn.kathakitaab.com`); the durable DB is **AWS Aurora PostgreSQL**;
> auth is anonymous-only (`katha:owner` cookie, no Supabase auth, no accounts).
> Every "Supabase bucket / RLS / signed-URL / service-role key" instruction below
> must be reworked against S3 (private bucket + CloudFront signed URLs / origin
> access control) and Aurora before any of this ships. The *safety* requirements
> (no public child URLs, per-owner isolation, signed-URL-only read path) still
> hold — only the storage substrate changed.

This document is the engineering contract for shipping `personalized_photo` mode. **Nothing in this file is live in the product.** Until every requirement here is implemented and tested, the Studio's Coming-Soon strip continues to say "Child photo upload — coming soon."

Audience: any future engineer (human or AI) picking this up.

Pairs with `PERSONALIZED_STORY_PLAN.md`. Where the two overlap, this doc takes precedence for photo-specific rules.

---

## Why this needs its own doc

Text-only personalization (V1, shipped) collects a child's first name, age, and the parent's prompt. That class of data has clear safety primitives: input moderation, output moderation, owner-scoped private storage, delete affordance.

Photo upload adds an entirely new threat surface:

1. The photo IS the child's likeness — a leaked URL is materially worse than a leaked story
2. Generative image models can produce inappropriate variations of an uploaded face
3. Photo retention and deletion are legally fraught in most jurisdictions
4. The image-generation model that ACCEPTS reference photos is different from the one we use today (gpt-image-1 doesn't accept image inputs); switching adds a new vendor with its own policies
5. NCMEC obligations apply if any abusive content is uploaded — we need a clear path to detect, block, and report

None of this is theoretical. Many "AI for kids" startups have shipped photo upload and had to retract it. We're not shipping it until the safety stack is real.

---

## Hard requirements before shipping

Each item is BLOCKING. The PR that ships `personalized_photo` must satisfy every row, with a corresponding test or operator runbook entry.

### Storage architecture

| # | Requirement | Implementation |
|---|---|---|
| S1 | Private bucket separate from public assets | New Supabase bucket `scene-images-private` with `public read = false`. Public `scene-images` continues to serve world-mode art. |
| S2 | Server-side upload only | `POST /api/personalized/upload` accepts the photo, validates it, and writes to the private bucket. Client-direct uploads are forbidden. |
| S3 | Signed URLs with 1-hour TTL | Reads use `createSignedUrl({ expiresIn: 3600 })`. Photo refs in the database store the storage key, NOT the URL. |
| S4 | No public child URLs ever | The signed-URL flow is the only read path. The bucket-level setting confirms public reads are blocked. Operator runbook step: verify the bucket policy in Supabase before deploy. |
| S5 | EXIF strip on upload | `sharp(...).rotate().withMetadata({}).toBuffer()` before writing to the bucket. GPS, camera serial, etc. all gone. |
| S6 | Default retention: zero | Photo is used once during generation, then deleted from the bucket. The book stores only the vision-derived text description, not the photo. |
| S7 | Opt-in retention max 30 days | If the parent ticks "Save for re-generation", retention is 30 days from upload. After that, an automated cleanup job deletes; the database row keeps a tombstone (no photo). |
| S8 | Deletion through the user-visible delete affordance | Clicking "Delete this story" purges both the book record AND any retained photo within 60 seconds. Operator runbook: verify with `supabase storage list` after deletion. |

### Validation gates (server-side)

| # | Requirement | Implementation |
|---|---|---|
| V1 | MIME validation by magic bytes | Use `file-type` library on the buffer; accept only `image/jpeg`, `image/png`, `image/webp`. Reject any disagreement between Content-Type header and sniff. |
| V2 | Dimension validation | 256–4096 px on each side. Reject larger or smaller. |
| V3 | Size validation | Max 5 MB after EXIF strip. Pre-EXIF size limit 8 MB to allow for sane phone photos. |
| V4 | Image moderation BEFORE storing | OpenAI Vision moderation on the buffer; reject any flag. The photo is held in memory only until moderation passes. |
| V5 | NCMEC-style hash matching (V4 paid tier) | Out of scope for V3 first ship. Documented here so we don't claim it's there. |

### Generation gates

| # | Requirement | Implementation |
|---|---|---|
| G1 | Vision-derived text description, NOT face transfer | gpt-4o-mini with vision input produces a 1-2 sentence description ("a child of about 7 with shoulder-length black hair, wearing a yellow t-shirt"). The image-generation model never sees the photo. |
| G2 | Honest UI copy | "KathaKitaab will create a child character with the colours and clothing from your photo. It is generative art, not photo editing — the AI doesn't copy your child's face." |
| G3 | Output moderation per scene | Every generated scene image runs through Vision moderation. A flagged scene discards the entire book and surfaces a generic "we couldn't generate this safely" message. |
| G4 | Hard-block category extension | Personalized photo mode hard-blocks `violence/graphic` (acceptable for Mahabharata, not for a 7-year-old hero). Existing hard blocks (`sexual/minors`, `self-harm/intent`, `self-harm/instructions`) remain. |
| G5 | Fail-CLOSED moderation | Already implemented in `lib/safety/moderation.ts` — pass `{ failClosed: true }` for every photo-mode call. |

### Owner / authorization

Already shipped in V1 and inherits cleanly — listed here so the V3 reviewer doesn't re-implement.

| # | Requirement | Implementation |
|---|---|---|
| A1 | Owner cookie required | `katha:owner` cookie set by `proxy.ts` (Next.js 16 proxy, formerly `middleware.ts`). Photo upload route refuses without it. |
| A2 | Random non-enumerable slug | `pv-…` 16-hex prefix, distinct from `cl-…`. (May add `pp-` prefix for photo-mode if we want to grep them apart in Redis.) |
| A3 | Private by default | `visibility: 'private'`. The book listing filters cl-/pv-/pp- away from non-owners. |
| A4 | Owner-only delete | DELETE `/api/books/[slug]` already enforces. Photo cleanup must be wrapped into the same handler. |

### Logging / telemetry

| # | Requirement | Implementation |
|---|---|---|
| L1 | NEVER log child name in console.log/console.error | Existing scrub helper (planned: `lib/logging/scrub.ts`) replaces fields named `childName` / `firstName` / `photoPath` / `uploadKey` with `[redacted]`. |
| L2 | Lint rule forbidding raw `console.error(err)` in personalized paths | Either an eslint-plugin-local rule or a comment-based opt-in. Must be enforceable in CI. |
| L3 | Photo path NEVER appears in any log | Audited via grep on every PR. |

### Rate limiting / cost control

| # | Requirement | Implementation |
|---|---|---|
| R1 | Per-cookie photo upload cap | 5 uploads/hour per `ownerId`. |
| R2 | Per-cookie generation cap | 3/24h matches text-only personalized; tightening for photo would be operator-tunable. |
| R3 | Per-IP cap survives | Existing `checkRateLimit({ scope: 'expensive' })` continues to apply on the generation route. |

### Supabase bucket setup (operator runbook)

When V3 is ready to ship:

```
Bucket: scene-images-private
  Public: NO
  RLS: enabled
  Policy "owner reads via signed URL only":
    - SELECT for service_role only (signed URLs are minted server-side)
  Policy "owner uploads":
    - INSERT for service_role only (server is the only writer)
  CORS: same-origin; signed-URL reads work without explicit CORS
```

We deliberately do NOT use Supabase RLS to scope per-cookie ownership. The cookie isn't a Supabase session, and trying to bind it would add a auth provider we don't currently run. Authorization is enforced at the route layer; Supabase only sees the service-role key.

---

## What V3 ships

Once every blocking row above is implemented and tested:

1. New `Upload photo (optional)` field in `PersonalizedStoryForm`.
2. New `POST /api/personalized/upload` endpoint, multipart, server-side validation, returns a `{ photoRef }` token.
3. The `personalized_photo` mode payload extends `personalized_text` with `{ photoRef, retainPhoto: boolean }`.
4. Generation calls `gpt-4o-mini` with vision to extract a description, deletes the photo (or keeps if `retainPhoto`), then runs the existing personalized pipeline with the description injected.
5. Studio Coming-Soon strip removes "Child photo upload" from the list.

What V3 does **not** include:
- Face-faithful image generation (that's V4 — IP-Adapter / Flux Redux paid path)
- Cross-device sync (still cookie-only)
- Public sharing
- Email notification when retention expires (V4)

---

## Sign-off checklist for V3 PR

```
[ ] Private bucket created and verified non-public
[ ] All 8 storage rows (S1–S8) implemented
[ ] All 4 validation rows (V1–V4) implemented with tests
[ ] All 5 generation rows (G1–G5) implemented with tests
[ ] All 4 authz rows (A1–A4) verified inherited from V1
[ ] All 3 logging rows (L1–L3) with explicit log scrubbing test
[ ] Both rate-limit rows (R1, R2) implemented
[ ] Operator runbook updated; bucket creation steps tested by a second engineer
[ ] Studio Coming-Soon strip updated
[ ] Landing copy reviewed for unsupported claims
[ ] Truth-pinning Playwright spec extended to assert "no input[type=file]" is REMOVED for personalized mode
```

---

*Photo upload is the highest-risk feature on the roadmap. We ship it carefully, or not at all.*
