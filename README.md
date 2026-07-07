<div align="center">

# KathaKitaab

**Not a flipbook. A Living AI Story Engine.**

<p align="center">
  <a href="https://www.kathakitaab.com">🌐 Live Demo</a> •
  <a href="#run-it">⚡ Quick Start</a> •
  <a href="#architecture">🏗️ Architecture</a> •
  <a href="#roadmap">🗺️ Roadmap</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" />
  <img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript" />
  <img src="https://img.shields.io/badge/Remotion-4.0-FF6B6B?logo=video" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/AI%20Text%20Engine-Outline%20%2B%20Scenes-412991" />
  <img src="https://img.shields.io/badge/AI%20Illustration%20Engine-1536x1024-412991" />
  <img src="https://img.shields.io/badge/AI%20Narration%20Engine-Multilingual%20TTS-FF9933" />
  <img src="https://img.shields.io/badge/Fallback%20AI-Gemini%20Native%20Audio-8E75B2?logo=google" />
</p>

</div>

---

KathaKitaab turns any title into a living, interactive storybook — then plays it as a cinematic film. Characters breathe, blink, and lean toward each other when they speak. The camera dollies, pushes, and shakes in time with your chosen verb. Every scene is a multi-shot cinematic cut with ambient soundscapes, one-shot SFX, and sentence-timed captions.

Type any title ("Mahabharata", "Akbar and Birbal", "NCERT History — Ancient India") and the engine builds a complete 10–12 scene book in ~3 minutes — persistently stored, resumable if anything fails, and immediately playable as an interactive reader, a cinematic movie, and a walkable living world.

<div align="center">

### 📖 Read it → 🎬 Watch it → 🖱️ Click it → 🚶 Walk it

</div>

---

## What Makes It Different

| Feature | Traditional Story App | KathaKitaab |
|---|---|---|
| **Content creation** | Hand-authored, months of work | Type a title → AI builds the book in ~3 min |
| **Visual storytelling** | Single static image per scene | **Multi-shot cinema** — 2–5 distinct camera shots per scene with hard cuts |
| **Audio** | Silent or generic background | **AI narration engine** shaped by scene mood + ambient soundscapes + SFX |
| **Interactivity** | Linear scroll or simple tap | **19 verbs** → Talk, Fight, Leap, Honor, Comfort, Move, Learn, Observe… each with unique camera + character motion + AI branch |
| **Spatial play** | None | **Living World Mode** — the same book becomes a tiny walkable planet; carry story fragments between scenes, meet NPCs, collect clues, answer reflections. Pure deterministic engine, offline |
| **Movie export** | None or manual video editing | **In-browser player** — same manifest powers both the live player and the Remotion composition. Server-side MP4 export is disabled by default (enable with `KATHA_MP4_EXPORT_ENABLED=1`) |
| **Resilience** | Lose progress on refresh | **Persistent jobs** in Redis — resume from the exact failed step |

---

## The Engine in 60 Seconds

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  User types a   │────▶│  gpt-4o-mini       │────▶│  10–12 scenes   │
│  book title     │     │  outlines story    │     │  + characters   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  gpt-image-1    │◀───│  Per-scene       │◀───│  Sarvam Bulbul  │
│  paints scenes  │     │  narration       │     │  narrates       │
│  (1536×1024)    │     │  + hotspots      │     │  (mood-shaped)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 ▼
                    ┌─────────────────────┐
                    │  Redis persistence  │
                    │  (job + scenes)     │
                    └─────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────┐
                    │  Interactive reader │
                    │  + Cinematic movie  │
                    └─────────────────────┘
```

---

## From a Typed Title to a Movie

When you POST `/api/books/generate { title: "..." }`, the engine immediately creates a **persistent generation job** in Redis (`kk:job:{id}`, 7-day TTL) and runs four parallel phases inside one Vercel function (300s budget):

1. **Outline + characters** — a compact LLM drafts a 9–12 scene chronological arc. Each character gets a universal `voice_archetype` (one of nine: noble-male, wise-male, bright-male, commanding-male, noble-female, …). The LLM sets `mood`, `theme`, and `shot_type` per visual beat up front. Requests **shot-reverse-shot** for dialogue scenes. Suggests `ambient_sound` per scene and `sfx` per beat.
2. **Scene details** (concurrency 4) — per-scene narration, hotspot positions, quiz questions, camera motion, and per-beat descriptions. ~25s for 11 scenes.
3. **Scene images** (concurrency 3) — the illustration engine paints each scene at 1536×1024 with character face-locking via anchor portraits. Uploaded to S3 + served via CloudFront (cdn.kathakitaab.com). ~120–180s.
4. **Scene narration** (concurrency 6) — the TTS engine records each scene shaped to its mood, with automatic fallback if the primary provider is unavailable. ~10–15s.

The result lands in Redis and is immediately playable at `/books/<slug>` interactively or at `/books/<slug>/movie` as a synthesised cinematic cut.

---

## What You Get

<details open>
<summary><b>🎬 Cinematic Movie Mode</b></summary>

- **Multi-shot storyboarding** — every scene carries 2–5 visual beats. The renderer **hard-cuts** between shots at sentence boundaries (2-frame micro-dissolve, no slideshow cross-fade). Each beat gets its own camera motion.
- **Shot-reverse-shot** — dialogue scenes alternate `reverse` / `over_shoulder` framing between speakers.
- **Sound design layer** — looping ambient soundscapes (wind, rain, temple bells, forest birds) mixed at 0.15 beneath the mood bed. One-shot SFX (sword clash, thunder, door creak) fire on key beats.
- **Per-scene camera motion** — `slow_zoom_in`, `slow_zoom_out`, `pan_left`, `pan_right`, `divine_glow`, `battle_push`, `fade_only`.
- **Procedural mood beds** — 6 ambient WAVs synthesized in-house. No licensed soundtrack.
- **MP4 export (opt-in)** — `npm run movie:render` works locally. The hosted `/api/livebook/render-movie` route is disabled by default; enable with `KATHA_MP4_EXPORT_ENABLED=1` on a Chromium-bearing host.
- **Cinematic captions** — blur-backdrop panel with segmented progress strip and active-cue glow.

</details>

<details open>
<summary><b>📖 Interactive Living Reader</b></summary>

- **Ambient figure life** — every character hotspot breathes, sways, and blinks. Puppet states quicken breath/sway timing during active verbs (talk, fight, leap).
- **19 verb-driven interactions** — Talk, Fight, Leap, Honor, Comfort, Move, Learn, Observe… each fires a unique camera burst + character motion + inline SVG sprite effect.
- **Audio-driven lip-pulse** — Web Audio AnalyserNode pulses the speaker's mouth-region in time with narration amplitude.
- **Bottom interaction panel** — branch responses render below the scene image (never as overlay), with auto-scroll on mobile.
- **Effects DSL** — particles, glow, dust shaft, vignette, rim-light, shake, ripple, parallax, desaturation, bloom, fog — baked per-scene from topic + mood.

</details>

<details open>
<summary><b>🚶 Living World Mode</b></summary>

A spatial companion to the linear reader — the same Book becomes a small, walkable planet you cross in one sitting. Open it at `/world/<slug>` (e.g. `/world/ramayana`).

- **Universal WorldManifest engine** — a pure, deterministic function of `(book, scenes, characters)` turns any book into a tiny world: one node per scene on a golden-angle spiral, a portal between each pair, NPCs placed from each scene's `characters_present`, and a cozy palette keyed by book slug. No AI, no database, no network — it runs client-side and works offline against the curated seed canon.
- **Soft camera + tap-to-move avatar** — the camera follows a story courier across a 1000×620 ground layer; interactive markers are projected into screen space so they stay a constant, readable, tappable size on phones. Snap-on-arrival when the OS requests reduced motion.
- **A simple, cozy mission loop** — carry this scene's story fragment to the glowing portal, deliver it, and the next scene unfolds. Side missions along the way: ask a character, collect a clue (a learning point), answer a reflection quiz. A lightweight world-XP counter tallies it all.
- **Lightweight NPC life** — idle characters ring each node with an emoji and a phrase drawn from their `talk_examples`. They do not gate progress; they are warmth.
- **Persistence** — progress is saved to `localStorage` (`kathakitaab_world_session:<slug>`), separate from Play Mode keys. Living World Mode is an additive layer and never perturbs Play Mode's progress.
- **No game engine** — plain DOM + CSS transforms + `requestAnimationFrame`. No PixiJS/Phaser/Spinel, deliberately, to keep Playwright accessibility and Remotion parity with the rest of the app.

Benchmarked in emotional principle only on Messenger (abeto.co) — a small explorable planet, soft camera, readable destinations, cozy feeling. We do not copy its art, characters, name, delivery story, or exact gameplay.

</details>

<details open>
<summary><b>⚡ Persistent Generation Engine</b></summary>

- **Real-time SSE progress** — `/books` opens `EventSource` to `/api/jobs/stream` for live queue updates. The creation form opens a second SSE stream to `/api/books/stream` for per-book progress. Replaces the old 5-second polling.
- **Resume from any failure** — four failure-mode branches: early re-run, image regen, TTS hydrate, stitch recovery. Triggered by `POST /api/books/resume`.
- **Job Registry** — 15 statuses, per-step tracking, global + per-user indexes.
- **Scene Registry** — per-scene persistence with no TTL. Independent asset status tracking (`imageStatus`, `ttsStatus`).
- **Staleness tracking** — editing a scene marks it stale; downstream image/audio regeneration resumes automatically.

</details>

<details open>
<summary><b>🎨 Visual Style Presets</b></summary>

Choose at generation time:

| Preset | Description |
|---|---|
| `photoreal_cinematic` | Photorealistic epic — warm Indian palette, golden hour lighting, film grain |
| `storybook_watercolor` | Children's fable — soft watercolor washes, gentle outlines |
| `cinematic_animation` | Indian animation studio style — rich colour, expressive characters |
| `comic_book` | Comic book panels — ink outlines, flat colour, in-frame speech bubbles |
| `anime_manga` | Anime / Manga Adventure — expressive characters, clean linework, cinematic colour, dramatic emotions, dynamic action poses |

</details>

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                 │
├─────────────────────────────────────────────────────────────────────┤
│  /books              /books/[slug]         /books/[slug]/movie       │
│  Library + Queue     Interactive Reader    Remotion Player           │
│  (SSE jobs stream)   (SceneCanvas +        (BookMovie composition)   │
│                      AmbientFigure +                                 │
│                      verb-keyed camera)                              │
│                                                                       │
│  /world/[slug]                                                        │
│  Living World (walkable planet + WorldManifest engine, offline)       │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         API LAYER                                    │
├─────────────────────────────────────────────────────────────────────┤
│  /api/books/generate  →  persistent job → outline → scenes → images │
│  /api/books/resume    →  four-branch recovery                        │
│  /api/books/stream    →  SSE per-book progress                       │
│  /api/jobs/stream     →  SSE job queue updates                       │
│  /api/livebook/...    →  branch cache, TTS, manifest, movie render   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         DATA LAYER                                   │
├─────────────────────────────────────────────────────────────────────┤
│  Upstash Redis        →  jobs, scenes, books, branch cache           │
│  AWS S3 + CloudFront  →  images, narration audio, MP4 exports        │
│  AWS Aurora Postgres  →  durable story DB + quota + reports          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## H0: Vercel + AWS Aurora PostgreSQL (durable story DB)

For the H0 / **Vercel + AWS Databases** track, KathaKitaab's data layer was
extended from *Vercel + Upstash-only* to **Vercel + AWS Aurora PostgreSQL**
as the durable global story database — **without touching any existing
Upstash data**.

- **AWS Aurora PostgreSQL** (Serverless v2, `aurora-postgresql 17.7`) now
  stores durable long-term records: `users`, `story_projects`,
  `story_scenes`, `characters`, `generated_assets`, `story_versions`,
  `public_story_links`, `generation_jobs`, `audit_events`.
- **Upstash Redis stays** for legacy reads, cache, in-flight generation
  progress, locks, queues, and rate limits — exactly as before.
- **Reads:** Aurora-first → Upstash Redis fallback (Redis keys never deleted).
- **Writes:** dual-write — Redis remains the source of truth, Aurora is the
  best-effort durable mirror; an Aurora failure never blocks the Redis write.
- **Reversible:** `USE_AURORA=false` reverts to the exact pre-Aurora behavior.
- **Judge-facing proof:** `GET https://kathakitaab.com/api/aurora/status`
  returns the live Aurora engine version + per-table row counts from a real
  `SELECT count(*)`.

**Env vars (existing Upstash/OpenAI/Gemini/Sarvam unchanged; Supabase removed):**
`DATABASE_URL` (Aurora connection string, no `sslmode=` — TLS via the RDS CA
bundle), `USE_AURORA=true`, `AURORA_SSL=require`, `AURORA_POOL_MAX=3`. Quota +
reports schema is in `db/aurora/migrations/0002_quota_and_reports.sql`.

**Scripts:** `npm run migrate:aurora` (apply schema), `npm run aurora:smoke`
(end-to-end write/read/soft-delete against live Aurora, asserts Redis is NOT
touched), `MIGRATE_LEGACY=true npm run migrate:legacy` (non-destructive
Redis→Aurora copy — proves Redis key count is unchanged before vs after).

Full design, safety guarantees, and verification steps:
**[H0_ARCHITECTURE.md](./H0_ARCHITECTURE.md)**.

---

## Manifest Contract

Each scene in `remotion/manifests/{slug}.json` carries:

```typescript
{
  sceneId: string;
  title: string;
  narration: string;
  imagePath: string;              // establishing shot
  beats?: [{                     // multi-beat visual track
    imagePath: string;
    motion?: SceneMotion;         // slow_zoom_in | pan_left | battle_push | ...
    shotType?: string;             // wide | close_up | reverse | over_shoulder | ...
    sfxUrl?: string;              // one-shot sound effect
  }];
  audioPath: string;             // Sarvam narration URL
  durationSeconds: number;
  mood: 'serene' | 'dramatic' | 'somber' | 'joyful' | 'sacred' | 'mysterious' | 'tense';
  motion: SceneMotion;
  backgroundMusicUrl?: string;    // explicit ambient bed
  ambientSoundUrl?: string;      // looping soundscape (wind, rain, temple bells...)
  effects?: SceneEffect[];        // particles | glow | dust_shaft | vignette | ...
  subtitles?: SubtitleCue[];     // sentence cues with startMs / endMs
  hotspots?: BookMovieHotspot[]; // character / object positions
  dialogue?: SceneDialogue[];     // comic-book overlay track
}
```

`npm run movie:verify` walks every manifest and exits non-zero on the first missing field.

---

## Run It

### 1. Install

```bash
npm install
```

### 2. Environment

Create `.env.local` with at minimum:

```env
SARVAM_API_KEY=...
SARVAM_TTS_MODEL=bulbul:v3

GEMINI_API_KEY=...
GEMINI_TEXT_MODEL=gemini-2.5-flash
GEMINI_AUDIO_MODEL=gemini-2.5-flash-preview-tts

OPENAI_API_KEY=...
OPENAI_TEXT_MODEL=gpt-4o-mini

# Optional but recommended for production:
NEXT_PUBLIC_SITE_URL=https://www.kathakitaab.com

# AWS Aurora (durable story DB + quota + reports)
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/kathakitaab
USE_AURORA=true
AURORA_SSL=require
AURORA_POOL_MAX=3

# AWS S3 + CloudFront (generated asset storage)
KK_S3_BUCKET=kathakitaab-assets
KK_S3_REGION=us-east-1
KK_S3_ACCESS_KEY_ID=...
KK_S3_SECRET_ACCESS_KEY=...
KK_CDN_HOST=cdn.kathakitaab.com

# Admin allowlist (your katha:owner cookie id — see /admin)
KATHA_ADMIN_OWNER_IDS=

UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Apply the Aurora schema before first run: `npm run migrate:aurora` (runs
`db/aurora/migrations/0001_init.sql` + `0002_quota_and_reports.sql`).

Without S3 the app still runs — uploads fall back to inline data URIs (dev), MP4 export writes to `public/movies/`. Without Aurora the free-era quota gate degrades to "allowed" (local dev); production must have Aurora configured. Without Redis the job registry falls back to in-process Maps (works for local dev, not multi-instance).

### 3. Dev Server

```bash
npm run dev
```

Open [http://localhost:5009](http://localhost:5009).

### 4. Full User Journey

**Step 1 — Pick or type a book**
- Open `/books`. The showcase library includes **Ramayana, Mahabharata, Panchatantra, Akbar and Birbal, Vikram and Betaal,** and **Tenali Raman** (curated, pre-baked manifests).
- To make your own: scroll to "Create a Story", type any title, hit **Create Story**.

**Step 2 — Watch it build in real time**
- SSE progress streams per-scene updates to the creation form without refreshes.
- ~3 minutes for an 11-scene book. ~$0.40 in API cost. Caches kick in on regeneration.
- If the tab closes, the job survives in Redis. Reopen `/books` — the queue reattaches automatically via SSE.

**Step 3 — Read interactively**
- `/books/<slug>` — click highlighted hotspots, pick a verb, watch the scene react.

**Step 4 — Watch as a movie**
- `/books/<slug>/movie` — multi-shot cinema with ambient sound, SFX, sentence-timed captions, and ducked mood music.

**Step 5 — Edit or retry**
- Owners can PATCH scene fields. Media-relevant changes trigger automatic downstream regeneration.

---

## Tests

```bash
# Platform integrity — 16 regression tests covering admin access,
# library accuracy, multi-beat rendering, provider name leak prevention,
# mobile overflow, API integrity, and generation pipeline.
npx playwright test tests/e2e/platform-integrity.spec.ts --project=chromium --workers=1

# Priority sweep — serial, no flakes. ~45s warm.
npx playwright test --project=chromium --workers=1 \
  character-state.spec.ts hotspot-branch.spec.ts \
  cache-hit.spec.ts landing-truth.spec.ts movie-cues.spec.ts \
  reader-panel-layout.spec.ts

# Full suite
npx playwright test tests/e2e/
```

---

## CLI Tools

```bash
# Build a curated book manifest (Ramayana)
npm run movie:build:ramayana

# Per-cue emotional TTS (~5× calls, byte-accurate timing)
npm run movie:build -- --slug=ramayana --per-cue-tts

# Render MP4 / trailer
npm run movie:render                    # both
npm run movie:render -- --mode=trailer  # trailer only (~3 min)
npm run movie:render -- --mode=movie    # full movie (~10 min)

# Verify manifest contract
npm run movie:verify

# Synthesize procedural mood beds
npm run movie:music

# Vision hotspot refinement (~$0.30/book)
npm run derive:hotspots

# Layer slicing — real alpha cutouts (~$2/book)
npm run slice:layers

# Infrastructure health check
npm run survey:infra
```

---

## Repo Map

```
app/
  page.tsx                    Landing — featured rail + movie toggle + living world
  books/page.tsx              Library — rails + generator + SSE queue
  books/[slug]/page.tsx       Interactive reader
  books/[slug]/movie/page.tsx Movie player + landscape rotation
  world/[slug]/page.tsx       Living World — walkable planet (offline WorldManifest)
  educator/page.tsx           Studio — story creation workspace
  api/books/generate/         Persistent job + step-by-step generation
  api/books/resume/           Four-branch failure recovery
  api/books/stream/           SSE per-book progress
  api/jobs/stream/            SSE job queue
  api/livebook/
    render-movie/             Remotion bundle + render + upload
    tts/                      Sarvam → Gemini fallback
    manifest/                 Runtime manifest synthesis
    scene-stream/             Unified scene manifest

components/
  livebook/SceneCanvas.tsx    Layered scene runtime
  livebook/AmbientFigure.tsx  Breathing / swaying / blinking figures
  library/BookGenerator.tsx   Title input + style preset + SSE form
  library/StoryCard.tsx       Poster card with Ken-Burns crossfade
  world/WorldStage.tsx        Living World diorama (camera + avatar + markers)
  world/LivingWorldScreen.tsx Living World orchestrator (fetch + reducer + overlays)
  world/MissionPanel.tsx      Mission list + ask/quiz/reset

lib/
  world/worldManifest.ts         Universal WorldManifest engine (pure, offline)
  world/worldSession.ts          Living World session + reducer + persistence
  openai/bookGeneratorAgent.ts   Universal pipeline (outline → scenes → images → audio)
  openai/modePrompts.ts          Per-mode prompt builders + shot discipline
  video/manifestSynthesizer.ts   GeneratedBook → BookMovieManifest
  video/motion.ts                7-motion vocabulary + mood defaults
  video/effects/                 Universal effects DSL
  audio/ttsRouter.ts             Sarvam → Gemini chain
  data/jobRegistry.ts            Redis job registry (15 statuses)
  data/sceneRegistry.ts          Redis scene registry (no TTL)

remotion/
  BookMovie.tsx               Full-book composition
  BookTrailer.tsx             43s cinematic teaser
  manifests/{slug}.json       Compiled book manifests

scripts/
  build-book-video.ts         Re-TTS + upload + write manifest
  render-movie.ts             CLI MP4 renderer
  verify-manifest.ts          Contract checker
```

---

## Honest Limits

- **Scene art is pre-baked.** The underlying paintings don't change between renders. Camera motion, effects, and figure animation make them feel alive.
- **Character cutouts are virtual by default.** Ellipse-masked hotspots around the bg image. Run `npm run slice:layers` (~$2/book) for true alpha cutouts.
- **Lip-pulse is amplitude-driven, not phoneme-aligned.** Reads as "they're talking", not "their lips are forming these words".
- **Music is procedural.** Synthesized mood beds — don't expect a film soundtrack.
- **No game engine.** Plain DOM + CSS + framer-motion. Deliberately no PixiJS/Phaser/Spine to keep Playwright a11y and Remotion parity.
- **Auth is fully removed (anonymous-only).** Identity is the `katha:owner` cookie set by middleware; admin access is granted by listing an owner id in `KATHA_ADMIN_OWNER_IDS`. Quota + reports live in Aurora (migration `0002_quota_and_reports.sql`). There is no sign-in surface to re-enable.
- **Resume has four fixed branches.** Unexpected sub-step failures may re-run more than strictly necessary.
- **OpenAI billing must be active** for image generation to work. If the quota is exhausted, the engine falls back to the Gemini image provider (when configured) or returns empty placeholders.

---

## Roadmap

| Phase | Feature | Status |
|---|---|---|
| ✅ SSE progress streaming | Real-time job + book updates via EventSource | **Shipped** |
| ✅ Multi-shot cinema | Hard-cut between beats, shot-reverse-shot | **Shipped** |
| ✅ Sound design | Ambient loops + one-shot SFX per beat | **Shipped** |
| ✅ Multi-book canon | Ramayana, Mahabharata, Panchatantra, Akbar & Birbal, Vikram & Betaal, Tenali Raman | **Shipped** |
| ✅ Platform integrity audit | Security, validation, TTS, caching, UX, mobile | **Shipped** |
| ✅ Living World Mode | Walkable planet + WorldManifest engine + courier mission loop (offline) | **Shipped** |
| 🔄 Puppet rigging | Per-body-part cutouts (head/eyes/mouth/torso/arms) | Next |
| 🔄 Phoneme lip-sync | Whisper-aligned mouth shapes replacing amplitude pulse | Planned |
| 🔄 AI video inserts | SVD/Runway for hero moments only (deer running, Hanuman flying) | Planned |

---

<div align="center">

*Built carefully. No half measures, no overclaiming.*

**[🌐 kathakitaab.com](https://www.kathakitaab.com)**

</div>
