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
  <img src="https://img.shields.io/badge/gpt--4o--mini-Text%20%2B%20Images-412991?logo=openai" />
  <img src="https://img.shields.io/badge/gpt--image--1-1536x1024-412991?logo=openai" />
  <img src="https://img.shields.io/badge/Sarvam-Bulbul%20v2-FF9933" />
  <img src="https://img.shields.io/badge/Gemini-2.5%20Flash-8E75B2?logo=google" />
</p>

</div>

---

KathaKitaab turns any title into a living, interactive storybook — then plays it as a cinematic film. Characters breathe, blink, and lean toward each other when they speak. The camera dollies, pushes, and shakes in time with your chosen verb. Every scene is a multi-shot cinematic cut with ambient soundscapes, one-shot SFX, and sentence-timed captions.

Type any title ("Mahabharata", "Akbar and Birbal", "NCERT History — Ancient India") and the engine builds a complete 10–12 scene book in ~3 minutes — persistently stored, resumable if anything fails, and immediately playable as both an interactive reader and a movie.

<div align="center">

### 📖 Read it → 🎬 Watch it → 🖱️ Click it

</div>

---

## What Makes It Different

| Feature | Traditional Story App | KathaKitaab |
|---|---|---|
| **Content creation** | Hand-authored, months of work | Type a title → AI builds the book in ~3 min |
| **Visual storytelling** | Single static image per scene | **Multi-shot cinema** — 2–5 distinct camera shots per scene with hard cuts |
| **Audio** | Silent or generic background | **Sarvam Bulbul narration** shaped by scene mood + ambient soundscapes + SFX |
| **Interactivity** | Linear scroll or simple tap | **17 verbs** → Talk, Fight, Leap, Honor, Comfort… each with unique camera + character motion + AI branch |
| **Movie export** | None or manual video editing | **One-click MP4** — same manifest powers both the live player and the rendered film |
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

1. **Outline + characters** — gpt-4o-mini drafts a 9–12 scene chronological arc. Each character gets a universal `voice_archetype` (one of nine: noble-male, wise-male, bright-male, commanding-male, noble-female, …). The LLM sets `mood`, `theme`, and `shot_type` per visual beat up front. Requests **shot-reverse-shot** for dialogue scenes. Suggests `ambient_sound` per scene and `sfx` per beat.
2. **Scene details** (concurrency 4) — per-scene narration, hotspot positions, quiz questions, camera motion, and per-beat descriptions. ~25s for 11 scenes.
3. **Scene images** (concurrency 3) — gpt-image-1 paints each scene at 1536×1024. Cached at the prompt level on Supabase. ~120–180s.
4. **Scene narration** (concurrency 6) — Sarvam Bulbul records each scene shaped to its mood. ~10–15s.

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
- **MP4 export** — `POST /api/livebook/render-movie` or `npm run movie:render`. Hash-based dedupe so unchanged manifests return instantly.
- **Cinematic captions** — blur-backdrop panel with segmented progress strip and active-cue glow.

</details>

<details open>
<summary><b>📖 Interactive Living Reader</b></summary>

- **Ambient figure life** — every character hotspot breathes, sways, blinks, and does a soft idle "look-around" every 8–14 seconds.
- **17 verb-driven interactions** — Talk, Fight, Leap, Honor, Comfort, Move, Learn, Observe… each fires a unique camera burst + character motion + inline SVG sprite effect.
- **Audio-driven lip-pulse** — Web Audio AnalyserNode pulses the speaker's mouth-region in time with narration amplitude.
- **Bottom interaction panel** — branch responses render below the scene image (never as overlay), with auto-scroll on mobile.
- **Effects DSL** — particles, glow, dust shaft, vignette, rim-light, shake, ripple, parallax, desaturation, bloom, fog — baked per-scene from topic + mood.

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
│  Supabase Storage     →  images, narration audio, MP4 exports        │
│  Postgres (optional)  →  user accounts, analytics                    │
└─────────────────────────────────────────────────────────────────────┘
```

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
SARVAM_TTS_MODEL=bulbul:v2

GEMINI_API_KEY=...
GEMINI_TEXT_MODEL=gemini-2.5-flash
GEMINI_AUDIO_MODEL=gemini-2.5-flash-preview-tts

OPENAI_API_KEY=...
OPENAI_TEXT_MODEL=gpt-4o-mini

# Optional but recommended for production:
NEXT_PUBLIC_SITE_URL=https://www.kathakitaab.com
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_DB_URL=...

UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Without Supabase the app still runs — narration falls back to local WAV cache, MP4 export writes to `public/movies/`. Without Redis the job registry falls back to in-process Maps (works for local dev, not multi-instance).

### 3. Dev Server

```bash
npm run dev
```

Open [http://localhost:5009](http://localhost:5009).

### 4. Full User Journey

**Step 1 — Pick or type a book**
- Open `/books`. The featured world is **Ramayana** (curated, pre-baked manifest).
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
  page.tsx                    Landing — featured rail + movie toggle
  books/page.tsx              Library — rails + generator + SSE queue
  books/[slug]/page.tsx       Interactive reader
  books/[slug]/movie/page.tsx Movie player + landscape rotation
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

lib/
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
- **Resume has four fixed branches.** Unexpected sub-step failures may re-run more than strictly necessary.

---

## Roadmap

| Phase | Feature | Status |
|---|---|---|
| ✅ SSE progress streaming | Real-time job + book updates via EventSource | **Shipped** |
| ✅ Multi-shot cinema | Hard-cut between beats, shot-reverse-shot | **Shipped** |
| ✅ Sound design | Ambient loops + one-shot SFX per beat | **Shipped** |
| 🔄 Puppet rigging | Per-body-part cutouts (head/eyes/mouth/torso/arms) | Next |
| 🔄 Phoneme lip-sync | Whisper-aligned mouth shapes replacing amplitude pulse | Planned |
| 🔄 AI video inserts | SVD/Runway for hero moments only (deer running, Hanuman flying) | Planned |
| 🔄 Multi-book canon | Mahabharata + Panchatantra manifests | Planned |
| 🔄 Agents SDK | OpenAI Agents handoffs + guardrails | Planned |

---

<div align="center">

*Built carefully. No half measures, no overclaiming.*

**[🌐 kathakitaab.com](https://www.kathakitaab.com)**

</div>
