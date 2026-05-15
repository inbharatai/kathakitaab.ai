# KathaKitaab

**Not a flipbook. A Living AI Story Engine.**

KathaKitaab turns canon books into living scenes you read, click, and watch. Highlighted characters and objects respond on click; figures breathe, sway, blink, and lean toward each other when they speak; the camera dollies, pushes, and shakes in time with whichever verb you choose; every book also plays as a cinematic film, full or trailer, rendered from the same manifest the interactive reader uses.

**Type any title and the engine builds a complete book.** No canon file required. The default reference book is the curated **Ramayana** (12 hand-tuned scenes); a typed-in book like *Akbar and Birbal* runs through the universal pipeline — gpt-4o-mini for the narrative, gpt-image-1 for the art, Sarvam Bulbul for the narration, all stored on Supabase + Redis, ~3 minutes end to end.

## From a typed title to a movie — what actually happens

When you POST `/api/books/generate { title: "..." }`, the engine runs four parallel phases inside one Vercel function (300s budget):

1. **Outline + characters** — gpt-4o-mini drafts a 9–12 scene chronological arc and assigns each character a universal `voice_archetype` (one of nine: noble-male, wise-male, bright-male, commanding-male, noble-female, …). Sets the `mood` and `theme` per scene up front so downstream modules don't reverse-engineer them from text.
2. **Scene details** (concurrency 4) — gpt-4o-mini writes per-scene narration, hotspot positions, quiz questions, and per-scene camera motion. ~25s for 11 scenes.
3. **Scene images** (concurrency 3) — gpt-image-1 paints each scene at 1536×1024. Cached at the prompt level on Supabase, so re-generating the same book is free. ~120–180s.
4. **Scene narration** (concurrency 6) — Sarvam Bulbul records each scene's narration shaped to the scene's mood. ~10–15s. URLs stored on the scene so the live reader and the movie share the same audio.

The result lands in Redis (`kk:book:<slug>`, 30-day TTL) and is immediately playable at `/books/<slug>` interactively or at `/books/<slug>/movie` as a synthesised cinematic cut.

---

## What's actually here

### Living scene runtime
- **Background atmosphere** — Ken Burns drift, 2.5D parallax tilt, ambient fireflies/dust motes, plus a universal **Effects DSL** (particles / glow / dust shaft / vignette / rim-light / shake / ripple / parallax / desaturation / bloom / **fog**) baked per-scene from topic + mood at manifest-build time.
- **Ambient figure life** — every character hotspot is wrapped in an **AmbientFigure** layer that breathes, sways, blinks, and does a soft idle "look-around" every 8–14 seconds. Reduced-motion users get a still frame.
- **Layered scenes** — `SceneLayers` renders the bg plate plus per-character cutouts as separate motion layers. Two modes share one component: virtual ellipse-clip (no asset cost, runs immediately) and sliced PNG cutouts (opt-in, pulled from `public/images/layers/{slug}/{sceneId}/` when `npm run slice:layers` has been run).
- **Verb-keyed camera** — picking *Talk*, *Fight*, *Leap*, *Honor*, *Comfort* etc. fires a short scaled+translated camera burst aimed at the chosen hotspot, with optional shake and a color-flash for impact verbs.
- **Verb-keyed character motion** — the same verb also flips the chosen figure's per-character motion (Leap arcs upward, Honor bows, Fight lunges forward, Comfort softens). Driven by a small per-character state machine (`useCharacterStates`) — exposed as `data-character-state` on each `AmbientFigure` for tests and downstream renderers.
- **Verb sprite overlays** — inline-SVG flash effects: sword-flash for Fight, leap-chevrons for Leap, speech-ripples for Talk/Ask, divine-rays for Honor, warmth-pulse for Comfort, footprint-trail for Move, insight-pulse for Learn/Observe. Universal vocabulary, zero asset weight.
- **Audio-driven lip-pulse** — Web Audio AnalyserNode reads RMS amplitude from the active TTS audio and pulses the speaker's mouth-region overlay; gaze geometry leans the pulse toward whichever hotspot was on stage just before. Reads as "they're looking at each other" in tap-tap conversational sequences.

### Emotional narration
- **Universal emotion tagger** — classifies any narration into 7 tones (`neutral / serene / joyful / dramatic / sorrowful / sacred / tense`) by word-boundary triggers. Pure function, no API call.
- **Sarvam Bulbul v2** — primary path. Per-tone (pace, pitch, loudness) triple sent on every call. Cache key includes tone + mood so emotional re-renders don't collide with neutral cached audio.
- **Gemini 2.5 Native Audio fallback** — same tone signal becomes a one-line natural-language prosody direction prepended to the text.
- **Per-cue rendering (opt-in)** — `--per-cue-tts` flag on the build script splits narration into sentences, runs detect-tone per sentence, calls TTS once per cue, splices the WAVs via the new `lib/audio/concatWav.ts` PCM splicer, and writes byte-accurate cue timing into the manifest. Off by default (5× more TTS calls per scene).

### Per-action branches & live readiness
- **Cache key is `(scene, entity, verb)`** — *Talk to Rama* and *Fight Rama* are distinct cache buckets; neither shadows the other.
- **Branch QA loop** — `lib/agents/branchQAAgent.ts` scores every generated branch on verb / entity / canon axes via gpt-4o-mini. Branches scoring < 70 retry once with a tightened prompt that explicitly tells the model its previous attempt ignored the verb.
- **Live readiness stream** — SSE at `/api/livebook/stream-updates/[sceneId]` flips action-menu dots from amber → green in real time as pre-gen warms branches.

### Living Book Brain
- **Multi-stage pipeline** — research → safety → story director → visual → vision → branch agent → narration → QA → cache. Each stage is a real module under `lib/agents/` and `lib/brain/`.
- **Action-aware branch generation** — `lib/agents/branchAgent.ts` is the single owner of (verb → narration). Both the brain pipeline and `/api/livebook/pregenerate-branches` delegate to it.
- **Canon-grounded** — each book has a JSON canon at `lib/data/canon/{slug}.json` listing allowed verbs, character bibles, and forbidden changes. Used by every agent prompt.

### Movie Mode v3
- **Full Movie** (~6:46 for Ramayana): all scenes, sentence-by-sentence captions, per-scene camera motion, mood music ducked to 0.10 under narration, full effects DSL baked in.
- **Cinematic Trailer** (43s, fixed): title (3s) + top-6 dramatic scenes (6s each) + end card (4s) = 1290 frames at 30fps. Scenes are scored by mood + motion, then chronologically ordered.
- **Per-scene motion** drawn from the manifest: `slow_zoom_in`, `slow_zoom_out`, `pan_left`, `pan_right`, `divine_glow`, `battle_push`, `fade_only`.
- **Effects parity** — same `EffectStack` component runs in `BookMovie`, `BookTrailer`, and the live reader. What you see in the player is what bakes into the MP4.
- **Cinematic captions** — blur-backdrop panel, segmented progress strip with active-cue glow.
- **Procedural mood beds** — 6 ambient WAVs synthesized in-house (`lib/audio/proceduralWav.ts`). No licensed soundtrack.
- **MP4 export** — two paths to the same render:
  - `POST /api/livebook/render-movie` from the dev server (uploads to Supabase if available, falls back to `public/movies/`)
  - `npm run movie:render` CLI for offline / CI / no-server renders. Same hash + filename strategy as the route, so the route's local-cache check finds these and skips re-rendering.
- **Manifest hash dedupe** — unchanged inputs return the existing file in milliseconds.

### Manifest contract
Each scene in `remotion/manifests/{slug}.json` carries:
- `subtitles[]` with explicit `startMs`/`endMs` per sentence
- `motion`: one of the seven motion tokens
- `narrationAudioUrl` and `audioPath`
- `mood`: serene / dramatic / somber / joyful / sacred / mysterious
- `backgroundMusicUrl?`: explicit ambient bed URL, or fall back to the procedural WAV for the mood
- `effects[]`: discriminated-union DSL entries (particles / glow / dust_shaft / vignette / rim_light / shake / ripple / parallax / fog / etc.)
- `durationSeconds`, `imagePath`, `narration`, `title`, `sceneId`

`npm run movie:verify` walks every manifest and exits non-zero on the first missing field.

---

## Tech

- **Next.js 16** (App Router, React 19, TypeScript strict)
- **Remotion 4.0.457** (`@remotion/player`, `@remotion/bundler`, `@remotion/renderer`) for live playback + server-rendered MP4 export. All five Remotion packages pinned to the same exact version (mismatch causes the bundler to refuse to load).
- **Sarvam Bulbul v2** for primary TTS with pace/pitch/loudness shaping
- **Gemini 2.5 Flash + Native Audio** for fallback text & TTS
- **OpenAI** (gpt-4o-mini for branch generation + QA, gpt-image-1 for scene art and the optional layer-slicer)
- **Supabase Storage** for narration audio and MP4 cache (with local-fs fallback)
- **Upstash Redis** for cross-instance branch + manifest cache (with in-process LRU fallback)
- **Framer Motion** for the reader's living-scene effects
- **Web Audio API** (AnalyserNode) for the lip-pulse amplitude track
- **Playwright** for end-to-end testing

---

## Run it

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

Without Supabase the app still runs — narration falls back to local WAV cache, the MP4 export writes to `public/movies/`. Without Redis the cache is in-process only (works for local dev, not multi-instance).

### 3. Dev server
```bash
npm run dev
```
Open [http://localhost:5009](http://localhost:5009).

### 4. The full user journey (from landing page to finished movie)

The same flow that runs in production at [www.kathakitaab.com](https://www.kathakitaab.com):

**Step 1 — Pick a book or type a new one.**
- Open `/books`. The featured world is **Ramayana** (curated, pre-baked manifest).
- To make your own: scroll to "Create a Story", type any title (e.g. `Akbar and Birbal`, `Mahabharata`, `NCERT History – Ancient India`), hit **Create Story**.

**Step 2 — KathaKitaab builds the book.**
- The progress bar walks through *Planning the story → Writing scenes → Illustrating → Narrating*.
- ~3 minutes for an 11-scene book on the standard pipeline (concurrency 4 details / 3 images / 6 audio).
- ~$0.40 in API cost (OpenAI text + image, Sarvam narration). Caches kick in on every regeneration.

**Step 3 — Read it interactively.**
- After completion the page redirects to `/books/<slug>`.
- Click any highlighted hotspot to open the action menu; pick a verb (Talk / Move / Honor / Comfort / …) and the scene reacts:
  the camera dollies for *Talk*, pushes + shakes for *Fight*, arcs upward for *Leap*. The figure quickens its breath and a verb-keyed sprite flashes. AI narrates the branch in the speaker's voice (chosen by `voice_archetype` at gen time — Akbar speaks as `wise-male`, Birbal as `bright-male`).
- Tap empty background and the AI checks for hidden details worth surfacing.

**Step 4 — Watch as a movie.**
- Open `/books/<slug>/movie`. The page fetches a `BookMovieManifest` from `/api/livebook/manifest`:
  - For Ramayana, it's the static, hand-tuned `remotion/manifests/ramayana.json`.
  - For any AI-generated book, it's synthesised on demand from the registry — same scenes, same narration audio URLs, same effects DSL, same procedural mood beds, motion picked by the LLM (or mood-derived).
- The in-browser Remotion `<Player>` plays the cinematic cut: per-scene camera motion, sentence-timed captions, ducked mood music under Sarvam narration, particles + dust shafts + divine glow per the manifest.
- MP4 download via the **Export** button works locally (`npm run movie:render`) and on hosts that ship Chromium; on Vercel's standard serverless functions the in-browser Player is the canonical path.

### 5. Tests
```bash
# Priority sweep — runs serially, no flakes. ~45s warm.
npx playwright test --project=chromium --workers=1 \
  character-state.spec.ts hotspot-branch.spec.ts \
  cache-hit.spec.ts landing-truth.spec.ts movie-cues.spec.ts

# Specific specs
npx playwright test tests/e2e/character-state.spec.ts   # data-character-state flips on verb burst
npx playwright test tests/e2e/landing-truth.spec.ts     # truth-first copy guards
npx playwright test tests/e2e/cache-hit.spec.ts         # per-action cache contract
npx playwright test tests/e2e/movie-cues.spec.ts        # subtitle cue advancement
npx playwright test tests/e2e/mp4-exists.spec.ts        # MP4 export end-to-end (~6 min)
```

### 6. Build a curated book's manifest (advanced — only when you want hand-tuning)

The user-facing flow above (typing a title) covers most cases. The CLI manifest builder is for when you want to commit a tuned manifest to `remotion/manifests/<slug>.json` and ship it pre-baked, like Ramayana:

```bash
# Standard build: per-scene mood-shaped TTS + topic-derived effects[]
npm run movie:build:ramayana

# Per-cue emotional TTS — splits narration into sentences,
# runs detect-tone per sentence, splices WAVs together,
# writes byte-accurate subtitle timing. ~5× TTS calls per scene.
npm run movie:build -- --slug=ramayana --per-cue-tts

# Verify the manifest matches the contract (effects[] included)
npm run movie:verify

# Synthesize procedural mood beds (deterministic, ~5s)
npm run movie:music
```

### 7. Render the MP4 / trailer

**CLI path (no server needed):**
```bash
# Both trailer + full movie, ramayana
npm run movie:render

# Just the trailer (faster, ~3 min)
npm run movie:render -- --mode=trailer

# Just the full movie (~10 min)
npm run movie:render -- --mode=movie

# Force re-render even if hashed cache exists
npm run movie:render -- --mode=movie --force
```

**HTTP path (when dev server is up):**
```bash
curl -X POST http://localhost:5009/api/livebook/render-movie \
  -H "Content-Type: application/json" \
  -d '{"bookSlug":"ramayana","force":true,"mode":"movie"}'
```

Output: `public/movies/{slug}.{stem}.{hash}.mp4`. The route auto-discovers these and serves them directly.

### 8. Optional upgrades

```bash
# Vision-derived hotspot tightening — runs gpt-4o over each scene
# image to refine character bounding boxes. ~$0.30 per book.
npm run derive:hotspots                            # full run
npm run derive:hotspots -- --dry-run               # preview, no API calls

# Layer slicing — produces real character cutouts (PNG with alpha)
# via gpt-image-1 reference editing. SceneLayers auto-detects the
# outputs and switches that scene from virtual to sliced mode.
# ~$2 per book one-time. Idempotent.
npm run slice:layers                               # full ramayana
npm run slice:layers -- --dry-run                  # preview job list
npm run slice:layers -- --scene=ayodhya_intro      # one scene only
npm run slice:layers -- --force                    # rebuild existing
```

### 9. Infrastructure health check + maintenance
```bash
# Read-only inventory: Postgres tables, Supabase storage layout,
# Redis namespace bucket counts, local .env.local key presence.
npm run survey:infra

# Push managed keys from .env.local to Vercel env (production +
# preview + development). Without VERCEL_TOKEN set, prints the
# `vercel env add` commands you can paste yourself.
npm run sync:vercel              # dry run
npm run sync:vercel -- --apply   # actually push (token mode)

# Drop pre-Wave-1.1 TTS cache keys after a cache-key shape change.
# Default --dry-run; --apply to actually delete.
npm run flush:stale
npm run flush:stale -- --apply
```

---

## Repo map

```
app/
  page.tsx                                Landing — truth-first copy + Movie Mode v3 with Trailer/Movie toggle
  books/[slug]/page.tsx                   Interactive reader entry
  books/[slug]/movie/page.tsx             Movie page with live <Player> + dual export buttons
  api/livebook/
    entity-interact/                      Per-action branch lookup with cache fallbacks
    pregenerate-branches/                 Fire-and-forget warmer; calls branchAgent
    scene-stream/[sceneId]/               Unified scene+entities+action-status manifest
    stream-updates/[sceneId]/             SSE branch_ready stream
    render-movie/                         Remotion bundle + render + upload (HTTP path)
    tts/                                  Sarvam → Gemini fallback chain with tone+mood

components/livebook/
  SceneCanvas.tsx                         Layered scene runtime — bg + cutouts + effects + ambient + lip-pulse
  SceneLayers.tsx                         Bg plate + character cutouts (virtual or sliced)
  AmbientFigure.tsx                       Per-hotspot breath / sway / blink / look-around layer
  FlipbookPage.tsx                        Deep-dive panel with branch narration + image
  SceneViewer.tsx                         Reader controller — narration, branch state, scene navigation

lib/
  agents/
    branchAgent.ts                        Single owner of (verb → narration)
    branchQAAgent.ts                      Verb / entity / canon scoring with retry
    safetyAgent.ts                        Content safety filter
    visualAgent.ts                        gpt-image-1 wrapper
    visionAgent.ts                        Entity detection in generated images
    researchAgent.ts                      Web-grounded fact pull
  audio/
    emotionTagger.ts                      7-tone classifier + (pace, pitch, loudness) map
    ttsRouter.ts                          Sarvam → Gemini chain with per-tone shaping
    sarvamClient.ts                       Bulbul v2/v3 TTS wrapper
    geminiAudioClient.ts                  Gemini 2.5 Native Audio + prosody-direction prefix
    concatWav.ts                          PCM WAV splicer for per-cue TTS rendering
    characterVoices.ts                    Universal archetype → voice mapping
    proceduralWav.ts                      In-house PCM synthesizer for mood beds
    musicOrchestrator.ts                  Mood-driven profile picker, ducks under TTS
    soundEngine.ts                        Click/transition SFX, ambient drone
  brain/
    LivingBookBrain.ts                    The orchestrator — research → director → vision → branch agent → QA
  data/
    canon/{slug}.json                     Per-book canon
    canonLookup.ts                        Universal lookup + prompt fragment builder
    hotspots.ts                           Hand-authored hotspot bboxes (Ramayana)
  engine/
    branchPreGenerator.ts                 Action-aware cache keys
    entityInteraction.ts                  Client-side click handler with 3-tier cache
    sceneGraph.ts                         In-memory branch graph
    narrationManager.ts                   Audio playback + active-speaker subscription
  hooks/
    useCharacterStates.ts                 Per-character state machine (idle/talk/fight/...)
    useAudioAmplitude.ts                  Web Audio AnalyserNode → smoothed RMS
    useSceneCutouts.ts                    HEAD-discovery of public/images/layers/{slug}/...
    usePrefersReducedMotion.ts            useSyncExternalStore subscription
  video/
    motion.ts                             7-motion vocabulary + mood→motion defaults
    verbCamera.ts                         17 verbs → camera burst (scale/translate/shake/flash)
    verbCharacterMotion.ts                17 verbs → character motion (dx/dy/scale/rotate)
    verbSprites.tsx                       Inline-SVG verb flash effects
    subtitlePlanner.ts                    Sentence cues with explicit ms timing
    manifestRegistry.ts                   Static lookup of compiled book manifests
    effects/
      types.ts                            Discriminated-union effect DSL
      effectRecipes.ts                    Topic + mood → effects[] composer
      topicTagger.ts                      Universal narration → topic-vector classifier
      layers.tsx                          Shared React components for every effect type
      useFrameTicker.ts                   rAF-based frame counter mirroring Remotion's

remotion/
  index.ts                                Remotion entry
  Root.tsx                                Registers BookMovie + BookTrailer + KathaTrailer
  BookMovie.tsx                           Full-book composition, manifest-driven, EffectStack-aware
  BookTrailer.tsx                         43s cinematic teaser (top-6 dramatic scenes)
  KathaTrailer.tsx                        Marketing trailer (separate)
  manifests/{slug}.json                   Compiled book manifests (regenerable)

scripts/
  build-book-video.ts                     Re-TTS + upload + write manifest. --per-cue-tts opt-in.
  build-mood-music.ts                     Synthesize procedural mood WAVs
  verify-manifest.ts                      Phase 10 contract checker (effects[] required)
  render-movie.ts                         CLI MP4 renderer (no dev server needed)
  derive-hotspots.ts                      Vision-tightened hotspot bbox refinement
  slice-scene-layers.ts                   gpt-image-1 layer slicer (bg plate + character cutouts)
  check-infra.ts                          Read-only Redis + Supabase health check
  prebake-anchors.ts                      Pre-generate character portrait anchors
  apply-supabase-migrations.ts            DB schema migration runner

tests/e2e/
  landing-truth.spec.ts                   Pins truth-first hero copy; bans known hyperbole
  hotspot-branch.spec.ts                  Click Rama → action menu → readiness dots → narration
  cache-hit.spec.ts                       Talk and Move warm into separate cache buckets
  character-state.spec.ts                 data-character-state flips on verb burst (Phase 1)
  movie-cues.spec.ts                      data-cue-index advances during playback
  mp4-exists.spec.ts                      End-to-end render → HEAD → cache hit on rerun
  mobile-tap.spec.ts                      Mobile Safari touch event chain
  human-walkthrough.spec.ts               Full reader → branch → movie → export with screenshots
  v2-screenshots.spec.ts                  Visual evidence snapshots
  book-movie.spec.ts                      Live Player playback through scene 1
  livebook.spec.ts                        v1 MVP suite (skipped — superseded by newer specs)
  ...                                     Plus play-mode, full-flow, full-screenshots, canon-consistency, menu-probe
```

---

## What's still honest about its limits

- **Scene art is pre-baked.** The Ramayana PNGs are static; per-scene camera motion + cue-timed captions + verb-driven figure animation + atmospheric effects make them feel alive, but the underlying paintings don't change between renders. The `slice:layers` pipeline can produce real per-character alpha cutouts on demand, but the default reader uses the virtual ellipse-clip mode (no asset cost).
- **Character cutouts are virtual by default.** The `SceneLayers` virtual mode soft-masks the bg image to an ellipse around each hotspot — visually convincing for stationary scenes, less so for large character motion deltas. Run `npm run slice:layers` (~$2/book OpenAI cost) to upgrade any book to true alpha cutouts.
- **Lip-pulse is amplitude-driven, not phoneme-aligned.** The mouth-region pulse follows audio loudness, not actual phonemes. Reads as "they're talking", not as "their lips are forming these words". Real lip-sync would need a Whisper-aligned phoneme track per cue.
- **The brain isn't the default reader path.** Static scenes still flow through `/api/books/[slug]/scenes/[sceneId]`. The brain only runs when generating fresh scenes.
- **Click-anywhere is hotspot-only.** Tapping background pixels asks the AI for hidden details, but only a curated set of hotspots renders glow rings. The hero copy reflects this.
- **No real Agents SDK.** The "agents" are role-flavored functions, not OpenAI Agents SDK with handoffs/guardrails. The architecture matches the spec; the framework doesn't.
- **Music is procedural, never licensed.** Mood beds are synthesized at build time. Don't expect a film soundtrack.
- **No game-engine / canvas runtime.** The reader is plain DOM + CSS + framer-motion. We deliberately did **not** add PixiJS, Phaser, Rive, or Spine — those would break Playwright a11y selectors, Remotion export parity, and the SSR-friendly mount, with no measurable visual win at our current scale.

---

## Roadmap

- **Phase 2 (next, opt-in)** — Multi-part puppet rigging: extend the slicer to per-body-part PNGs (head / eyes / mouth / torso / arms) and route them through a state-machine renderer for true cartoon-style poses (idle, talk, walk, react). Falls back to single-cutout when part segmentation is uncertain.
- **Phase 3** — Whisper-aligned phoneme lip-sync replacing the amplitude-driven mouth pulse.
- **Phase 4** — AI image-to-video (SVD / Runway / Kling) for *hero moments only* — deer running, Hanuman flying, divine darshan reveal. Inserted between scenes, never inside the cue track (their dynamic durations would break subtitle timing).
- **Phase 5** — Multi-book canon expansion: ship Mahabharata + Panchatantra manifests; verify the engine renders without scene-id-specific code.
- **Phase 6** — Real Agents SDK: replace the function-call pipeline with OpenAI Agents handoffs + guardrails per the spec.

---

## Latest movie bundle

`public/movies/ramayana/` ships with a current build of the Ramayana movie plus the trailer and every source asset (gitignored — regenerable via `npm run movie:render`). See its README for the per-scene motion table, regen commands, and visual evidence screenshot paths.

---

*Built carefully. No half measures, no overclaiming.*
