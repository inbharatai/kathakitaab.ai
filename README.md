# KathaKitaab.ai

**Not a flipbook. A Living AI Story Engine.**

KathaKitaab turns canon books into living scenes you read, click, and watch. Highlighted characters and objects respond on click; the background reacts to taps; every book also plays as a cinematic film, full or trailer, rendered from the same manifest the interactive reader uses.

The first book in the engine is **Ramayana**. The engine is universal — adding Mahabharata, Panchatantra, or any other title is a canon JSON + a build-script call, not new code.

---

## What's actually here

### Interactive reader
- **Living 2.5D scenes**: Ken-Burns + parallax + golden-dust particles + glow rings on hotspots, in plain CSS + Framer Motion.
- **Highlighted hotspots**: characters and objects respond on click. The action menu shows a green dot for warmed branches and amber for ones that will generate on tap.
- **Per-action branches**: cache key is `(scene, entity, verb)`. "Talk to Rama" and "Fight Rama" are distinct cache buckets — neither shadows the other.
- **Live readiness**: an SSE stream (`/api/livebook/stream-updates/[sceneId]`) flips action-menu dots from amber → green in real time as pre-gen warms branches.
- **Sarvam Bulbul narration**: every scene narrated end-to-end. Music ducks under speech automatically.

### Living Book Brain
- **Multi-stage pipeline**: research → safety → story director → visual → vision → branch agent → narration → QA → cache. Each stage is a real module under `lib/agents/` and `lib/brain/`.
- **Action-aware branch generation**: `lib/agents/branchAgent.ts` is the single owner of (verb → narration). Both the brain pipeline and the on-demand `/api/livebook/pregenerate-branches` route delegate to it.
- **Canon-grounded**: each book has a JSON canon at `lib/data/canon/{slug}.json` that lists allowed verbs, character bibles, and forbidden changes. Used by every agent prompt.

### Movie Mode v2
Same engine that runs the reader builds the movie. Two cuts:
- **Full Movie** (~6:46 for Ramayana): all scenes, sentence-by-sentence captions, per-scene camera motion, mood music ducked to 0.10 under narration.
- **Cinematic Trailer** (~45s): top-6 dramatic scenes scored by mood + motion, punchier mix, end CTA.
- **Per-scene motion** drawn from the manifest: `slow_zoom_in`, `slow_zoom_out`, `pan_left`, `pan_right`, `divine_glow` (radial gold + particles), `battle_push` (zoom + tasteful shake + crimson tint), `fade_only`.
- **Cinematic captions**: blur-backdrop panel, segmented progress strip with active-cue glow.
- **Procedural mood beds**: 6 ambient WAVs synthesized in-house (`lib/audio/proceduralWav.ts`). No licensed soundtrack.
- **MP4 export**: `POST /api/livebook/render-movie` bundles Remotion, renders, uploads to Supabase, falls back to `public/movies/` if the file is too large for the bucket. Cached by manifest hash so unchanged inputs return the existing file in milliseconds.

### Manifest contract (Phase 10 spec)
Each scene in `remotion/manifests/{slug}.json` carries:
- `subtitles[]` with explicit `startMs`/`endMs` per sentence
- `motion`: one of the seven motion tokens
- `narrationAudioUrl` and `audioPath`
- `mood`: serene / dramatic / somber / joyful / sacred / mysterious
- `backgroundMusicUrl?`: explicit ambient bed URL, or fall back to the procedural WAV for the mood
- `durationSeconds`, `imagePath`, `narration`, `title`, `sceneId`

`npm run movie:verify` walks every manifest and exits non-zero on the first missing field.

---

## Tech

- **Next.js 16** (App Router, React 19, TypeScript strict)
- **Remotion 4.0** (`@remotion/player`, `@remotion/bundler`, `@remotion/renderer`) for live playback + server-rendered MP4 export
- **OpenAI** (gpt-4o-mini for branch generation, gpt-image-1 for scene art, Sarvam for TTS)
- **Supabase Storage** for narration audio and MP4 cache (with local-fs fallback)
- **Upstash Redis** for cross-instance branch + manifest cache
- **Playwright** for end-to-end testing
- **Framer Motion** for the reader's living-scene effects

---

## Run it

### 1. Install
```bash
npm install
```

### 2. Environment
Create `.env.local` with at minimum:
```env
OPENAI_API_KEY=...
OPENAI_TEXT_MODEL=gpt-4o-mini
SARVAM_API_KEY=...

# Optional but recommended for production:
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Without Supabase the app still runs — narration falls back to local WAV cache, the MP4 export writes to `public/movies/`. Without Redis the cache is in-process only (works for local dev, not multi-instance).

### 3. Dev server
```bash
npm run dev
```
Open [http://localhost:5009](http://localhost:5009).

### 4. Tests
```bash
npx playwright test                       # Full E2E suite
npx playwright test tests/e2e/landing-truth.spec.ts  # Truth-first copy guards
npx playwright test tests/e2e/cache-hit.spec.ts      # Per-action cache contract
npx playwright test tests/e2e/movie-cues.spec.ts     # Subtitle cue advancement
npx playwright test tests/e2e/mp4-exists.spec.ts     # MP4 export end-to-end
```

### 5. Build a book's movie manifest
```bash
# Re-TTS narration → upload to Supabase → write subtitles[] + motion + mood
npm run movie:build:ramayana

# Verify the manifest matches the Phase 10 contract
npm run movie:verify
```

### 6. Render the MP4 / trailer
```bash
# Full Movie — server-renders Remotion BookMovie composition
curl -X POST http://localhost:5009/api/livebook/render-movie \
  -H "Content-Type: application/json" \
  -d '{"bookSlug":"ramayana","force":true,"mode":"movie"}'

# Cinematic Trailer — picks the top-6 dramatic scenes
curl -X POST http://localhost:5009/api/livebook/render-movie \
  -H "Content-Type: application/json" \
  -d '{"bookSlug":"ramayana","force":true,"mode":"trailer"}'
```

The same buttons are available on the per-book movie page at `/books/{slug}/movie`.

### 7. Generate procedural mood beds
```bash
npm run movie:music
# Writes 6 deterministic WAVs to public/audio/mood/
```

---

## Repo map

```
app/
  page.tsx                                Landing — truth-first copy + Movie Mode v2 with Trailer/Movie toggle
  books/[slug]/page.tsx                   Interactive reader entry
  books/[slug]/movie/page.tsx             Movie page with live <Player> + dual export buttons
  api/livebook/
    entity-interact/                      Per-action branch lookup with cache fallbacks
    pregenerate-branches/                 Fire-and-forget warmer; calls branchAgent
    scene-stream/[sceneId]/               Unified scene+entities+action-status manifest
    stream-updates/[sceneId]/             SSE branch_ready stream
    render-movie/                         Remotion bundle + render + upload
    tts/                                  Sarvam Bulbul wrapper

lib/
  agents/
    branchAgent.ts                        Single owner of (verb → narration)
    safetyAgent.ts                        Content safety filter
    visualAgent.ts                        gpt-image-1 wrapper
    visionAgent.ts                        Entity detection in generated images
    researchAgent.ts                      Web-grounded fact pull
  audio/
    proceduralWav.ts                      In-house PCM synthesizer for mood beds
    musicOrchestrator.ts                  Mood-driven profile picker, ducks under TTS
    soundEngine.ts                        Click/transition SFX, ambient drone
  brain/
    LivingBookBrain.ts                    The orchestrator — research → director → vision → branch agent → QA
  data/
    canon/{slug}.json                     Per-book canon: characters, allowed_actions, forbidden_changes
    canonLookup.ts                        Universal lookup + prompt fragment builder
  engine/
    branchPreGenerator.ts                 Action-aware cache keys, getPregenActions()
    entityInteraction.ts                  Client-side click handler with 3-tier cache
    sceneGraph.ts                         In-memory branch graph
  video/
    motion.ts                             7-motion vocabulary + mood→motion defaults
    subtitlePlanner.ts                    Sentence cues with explicit ms timing
    manifestRegistry.ts                   Static lookup of compiled book manifests

remotion/
  index.ts                                Remotion entry
  Root.tsx                                Registers BookMovie + BookTrailer + KathaTrailer
  BookMovie.tsx                           Full-book composition, manifest-driven
  BookTrailer.tsx                         45s cinematic teaser
  KathaTrailer.tsx                        Marketing trailer (separate)
  manifests/{slug}.json                   Compiled book manifests (regenerable)

scripts/
  build-book-video.ts                     Re-TTS + upload + write manifest
  build-mood-music.ts                     Synthesize procedural mood WAVs
  verify-manifest.ts                      Phase 10 contract checker
  prebake-anchors.ts                      Pre-generate character portrait anchors
  apply-supabase-migrations.ts            DB schema migration runner

tests/e2e/
  landing-truth.spec.ts                   Pins truth-first hero copy; bans known hyperbole
  hotspot-branch.spec.ts                  Click Rama → action menu → readiness dots → narration
  cache-hit.spec.ts                       Talk and Move warm into separate cache buckets
  mobile-tap.spec.ts                      Mobile Safari touch event chain
  movie-cues.spec.ts                      data-cue-index advances during playback
  mp4-exists.spec.ts                      End-to-end render → HEAD → cache hit on rerun
  human-walkthrough.spec.ts               Full reader → branch → movie → export with screenshots
  v2-screenshots.spec.ts                  Visual evidence: title-card, caption-scene, battle-scene, divine-scene, movie-page-desktop, movie-page-mobile
  book-movie.spec.ts                      Live Player playback through scene 1
  livebook.spec.ts                        Walkthrough A-to-Z baseline
  ...                                     Plus play-mode, full-flow, full-screenshots, canon-consistency, menu-probe
```

---

## What's still honest about its limits

- **Scene art is pre-baked.** The 11 Ramayana PNGs are static; per-scene camera motion + captions + mood beds make them feel different, but the underlying paintings don't change between renders. gpt-image-1 wiring exists in the brain pipeline but `npm run movie:build` doesn't yet use it.
- **The brain isn't the default reader path.** Static scenes still flow through `/api/books/[slug]/scenes/[sceneId]`. The brain only runs when generating fresh scenes.
- **Click-anywhere is hotspot-only.** Tapping background pixels asks the AI for hidden details, but only a curated set of hotspots renders glow rings. The hero copy reflects this.
- **No real Agents SDK.** The "agents" are role-flavored functions, not OpenAI Agents SDK with handoffs/guardrails. The architecture matches the spec; the framework doesn't.
- **Music is procedural, never licensed.** Mood beds are synthesized at build time from `lib/audio/proceduralWav.ts`. Don't expect a film soundtrack.

---

## Roadmap

- **Phase J — Universal effects DSL**: per-scene `effects[]` (particles, flash, glow, shake, parallax) derived from topic detection. Same vocabulary in reader and movie.
- **Phase K — Brain in the live reader**: route static scene loads through `prepareScene()` so the brain enriches every scene, not only generated ones.
- **Phase L — Multi-book canon expansion**: ship Mahabharata + Panchatantra manifests; verify the engine renders without scene-id-specific code.
- **Phase M — Real Agents SDK**: replace the function-call pipeline with OpenAI Agents handoffs + guardrails per the spec.

---

## Latest movie bundle

`public/movies/ramayana/` ships with a current build of the Ramayana movie plus the trailer and every source asset. See its README for the per-scene motion table, regen commands, and visual evidence screenshot paths.

---

*Built carefully. No half measures, no overclaiming.*
