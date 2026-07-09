# World/Story/Movie Engine — Honest Audit + Innovations Addendum

Date: 2026-07-09
Author: Claude (engine audit, 3 parallel deep-read agents, file:line evidence)
Status: **Tier 1 code fixes done + gate green (code level). Not committed yet. Not eye-verified.**

This is the honest record behind the README's accuracy pass. It exists so the
gap between what we *claim* and what the engines *do* is written down in one
place — no "implemented" labels on dead schema fields.

---

## 1. The verdict: can we beat Messenger (Abeto) today? **No.**

Messenger is a handcrafted 2-person multiplayer cozy game: watercolor 3D + a
lo-fi score + readable, emotionally warm destinations. It is **not** an AI
story app. We are an AI story engine. The axes are different.

| Axis | Us | Messenger | Winner |
|------|----|-----------|--------|
| Scope / universality | any book, prompt-driven, runtime canon | one handcrafted world | **us** |
| Interactivity | click-anywhere vision, verb branches, walkable 3D planet | fixed paths | **us** |
| Accessibility | DOM compass mirrors 3D, keyboard/SR labelled | weak a11y | **us** |
| Engineering generality | deterministic synthesizer + Remotion + R3F | bespoke | **us** |
| Cozy-emotional art | scene art loads over net, emoji-portrait fallback | handcrafted watercolor | **them** |
| Sound / audio bed | static mood-bed WAVs only, no ambient SFX, no NPC murmur | lo-fi score + SFX | **them** |
| Readable destinations | now textured + biome-tinted + scheduled NPCs | always | **them** (still ahead) |
| Movie | narrated storyboard (effects DSL, beat-snap, emotion TTS) | — | n/a |

We win the engineering/scope/a11y axis. We lose the cozy-emotional axis that
*defines* Messenger. Closing that gap is Tier 3 below.

---

## 2. What was real vs fake/dead before this pass

### World engine (`lib/world/worldManifest.ts`, `components/world3d/World3DCanvas.tsx`)
- **Real:** pure deterministic synthesizer (FNV-1a, no `Math.random`) → fibonacci-sphere planet + great-circle DAG portals + branching-aware unlocks. Real R3F/three planet (IcosahedronGeometry displaced, soft follow-cam, raycast click-to-move, progress-tied day/night). Real DOM a11y mirror. Complete reducer (4 mission kinds, no stubs).
- **Was fake/dead (now fixed in Tier 1):**
  - `World3DCanvas.tsx:153` live-media material had **no `map` texture** → scene images never rendered on the planet (the headline visual defect). **Fixed:** drei `<Image>` (sRGB + anisotropy) with a `TextureErrorBoundary` + `Suspense` → biome-tile fallback for dead/slow URLs.
  - `BIOME_COLORS.terrain` per-biome color never applied (one global ground color). **Fixed:** planet vertices tint toward the nearest place's biome terrain color with smoothstep falloff.
  - NPC `schedule`/`homePlaceId` computed but never visualized (NPCs static). **Fixed:** `npcCurrentPlaceId()` walks the schedule in story order; NPCs migrate as the avatar unlocks scenes, in both the 3D canvas and the a11y compass ("here now").
  - NPC `portraitUrl` ignored (emoji only). **Fixed:** `NpcPortrait` billboard; emoji is the graceful fallback.
- **Still dictionary-leaning (intentional):** `MOOD_KEYWORDS`/`BIOME_KEYWORDS` contain ravana/lanka/ayodhya etc. Generic fallback exists. Not a bug.

### Story engine (`lib/.../bookGeneratorAgent.ts`, `modePrompts.ts`, `genreDetector.ts`)
- **Real + universal:** prompt-driven, any title, 12 genres × 11 cultures, runtime canon registration. 3 real modes + 1 stub (`personalized_photo` — child-photo safety gate). ~40–50 AI calls/book, self-repairing outline + branch QA-gated retry. GPT-4o-mini VISION click classification. Aurora race-safe quota+refund.
- **Gaps (Tier 2, not touched this pass):** no persistent character persona/memory (ask-character stateless); book-gen hotspots LLM-guessed, vision-corrected only on regen; language = prompt-only (no Hindi system prompt, no language-routed TTS voice); no whole-arc QA critic (one outline call decides the whole book); `creative` ask-mode hard-blocked by policy (deliberate).

### Movie engine (Remotion)
- **Real:** manifest-driven multi-beat, generative effects DSL (14 topics × 6 moods → recipe), beat-snap-to-sentence, Sarvam/Gemini per-cue emotion TTS, env-gated Remotion MP4 renderer.
- **Was fake/dead (now fixed in Tier 1):**
  - `ripple` + `parallax` declared in the effects DSL but **unrendered** (duffy). **Fixed:** new `<Ripple>` overlay in `lib/video/effects/layers.tsx`; parallax sway applied to the beat transform in `BookMovie.tsx` + `BookTrailer.tsx`.
  - "Procedural mood bed" comment misleading (the 6 WAVs are synthesized **once** and shipped as static files, not a live score). **Fixed:** wording → "static mood bed" in README, landing, and code comments.
  - `remotion/manifests/ramayana.json` audioPaths pointed at a **decommissioned Supabase bucket** (dead URLs that would 404-crash the render). **Fixed:** nulled them; `audioPath: string | null`; narration gracefully skipped so the mood bed still plays. The real fix — regenerate narration to S3 — is the deferred credit-burning task in the Supabase-removal backlog.
- **Still gaps (Tier 2, not touched this pass):** linear (not eased/bezier) camera; "bloom" = radial gradient not true post-process bloom; no DOF/motion-blub/CA; characters = baked image + breath/mouth oscillation (puppet); 540p render cap; per-cue emotion TTS off by default; `dialogue[]` schema exists but TTS only narrates (no per-character voiced dialogue).

---

## 3. Tier 1 — done this pass (code level)

| # | Fix | Gate |
|---|-----|------|
| 1 | Scene imagery textured onto 3D planet + graceful fallback | ✅ build/tsc |
| 2 | Per-biome terrain tinting on planet | ✅ build/tsc |
| 3 | NPC schedule migration (3D + a11y) | ✅ world:verify 58/58 |
| 4 | NPC portraitUrl billboards | ✅ build/tsc |
| 5 | Movie `ripple` + `parallax` rendered | ✅ build/tsc |
| 6 | "Procedural" → "static mood bed" wording | ✅ lint |
| 7 | Dead Supabase audio URLs → honest null + graceful skip | ✅ movie:verify (honest warnings, no regression) |

**Gate (code level):** `tsc` 0 errors · `eslint` 0 errors · `next build --webpack` success · `world:verify` 58/58 · `movie:verify` exit 1 but pre-existing (Phase-10 `narrationAudioUrl` field never populated) + the new honest null warnings — not a regression.

### What I could NOT verify (honest)
The one check I cannot perform is **visual**: that scene textures actually
paint onto the planet in a browser. I cannot process images. The code path is
correct (drei `<Image>`, sRGB, error-boundary → procedural fallback) and it
compiles + builds, but **eye-confirmation of the planet render is outstanding.**
Run `/world/ramayana` locally (`npm run dev`, port 5009) and look for art tiles
on the place rings. If a tile is blank where art should be, the URL is dead or
CORS-blocked and the boundary fell back to the biome tile — check the browser
Network tab.

---

## 4. Tier 2 — DONE AS CODE (live-burn deferred, gated)

Each item below ships complete as code with a no-key / offline fallback proven
by the no-key path. Paid/infra calls are env-gated (default OFF). Nothing is
fake-passed; visual eye-checks I can't perform are flagged.

- **Persistent character persona/memory thread** — `ask-character` now carries
  a `threadId`, threads prior turns, persists per `(owner_id, book_slug,
  character_slug)` in Aurora `character_memory` (migration `0004`, applied
  live + verified capping), Redis fallback when `USE_AURORA=false`. Degrades
  to today's stateless single-turn when no Aurora + no OpenAI. *(S1)*
- **Vision-verify hotspots at initial gen** — after beat-0 image lands,
  `analyzeImageForTargets` overwrites LLM-guessed hotspot coords. Gated
  `KATHA_VISION_HOTSPOTS_ENABLED=1`; off → LLM-guessed coords stand.
  `analyzeImageForTargets` no-ops when unconfigured. *(S3)*
- **Whole-arc QA critic** — `lib/agents/arcCriticAgent.ts`: one gpt-4o-mini
  call post-outline flags arc breaks into `GeneratedBook.qaNotes`
  (non-blocking). Gated `KATHA_ARC_CRITIC_ENABLED=1`; off → returns score 100
  (skip), like `branchQAAgent`. *(S2)*
- **Language-routed prompts + TTS voice** — `language?: 'hi'|'en'|'auto'` on
  `GeneratedBook`, threaded into the system/character prompts, persisted on
  the book + registry, and the TTS route already threads it end-to-end. Pure
  code. *(S4)*
- **Eased/bezier camera** — `MOTION_EASING` per motion token, resolved
  client-side via `resolveEasing()` (motion.ts exports a serializable
  `EasingSpec` so it stays server-safe — see build note below). *(M1)*
- **True-ish bloom + DOF/CA/MB** — SVG `feColorMatrix` luminance-key →
  `feGaussianBlur` → screen-composite replaces the faux-`Bloom`; new
  `depth_of_field` / `chromatic_aberration` / `motion_blur` effect types
  with no-dep approximations. True WebGL post-processing deferred (risky in
  headless Chromium). *(M2)*
- **Lift the 540p cap** — `KATHA_RENDER_SCALE` (0.5/1.0/2.0) + `KATHA_RENDER_CRF`
  (18–32) read in both the route + the CLI; `scale` is in the manifest hash so
  resolutions don't collide. Default stays 540p / CRF 28. *(M3)*
- **Per-character voiced dialogue (movie)** — `build-book-video.ts` loops
  `scene.dialogue[]` through `/api/livebook/tts` per line → per-scene
  `dialogueAudioUrl`; `<Audio>` mounted in `BookMovie`. Gated
  `KATHA_DIALOGUE_TTS_ENABLED=1`; off → narrate-only (today's manifest). *(M4)*
- **Regenerate Ramayana narration to S3** — DEFERRED (credit-burning).
  `ramayana.json` stays honestly null; `movie:verify` reports the nulls as
  "regenerate the manifest to restore voiced narration." Not faked.

### Build note (regression caught + fixed this pass)
M1 initially imported `Easing` from `remotion` into `lib/video/motion.ts`.
That module is imported server-side by the manifest synthesizer
(`/api/books/[slug]`), which pulled the `remotion` package into an RSC
bundle and crashed `next build` on `React.createContext` undefined. Fixed by
exporting a serializable `EasingSpec` from `motion.ts` and resolving it to
`Easing` client-side in `BookMovie.tsx` / `BookTrailer.tsx`. `motion.ts` now
has zero `remotion` runtime import — the build is green.

---

## 5. Tier 3 — DONE AS CODE (live-burn deferred, gated)

- **Ambient biome audio + NPC murmur + footsteps** —
  `lib/audio/worldAudioEngine.ts` (browser WebAudio): synth biome beds
  transcribed from `proceduralWav.ts`, crossfade on node change, spatialized
  NPC murmur from `voiceMood`, footstep SFX on avatar step. Mounted in
  `LivingWorldScreen.tsx` gated by `NEXT_PUBLIC_KATHA_WORLD_AUDIO=1` + the 3D
  path. Off → silent world (the v1 DOM fallback is always silent). *(W1)*
- **`ask_character` dialogue tree** — `replies[]` on seed characters +
  `replyFor(character, turn)`; `ADVANCE_DIALOG` action persists the turn in
  `livingMemory`; LLM opt-in via `ask-character` with `threadId` (S1) when
  `OPENAI_API_KEY` set. Default (no key) → deterministic replies. *(W2)*
- **Per-character voiced dialogue in the movie** — see M4 above (Tier 2).
- **Voice in the World engine (TTS + STT)** — the user's "but with tts sts":
  `components/world/useWorldVoice.ts` adds a "Hear" button (TTS route →
  `speechSynthesis` no-key fallback) and a "Speak" mic button (browser
  `SpeechRecognition`, no key) that feeds the spoken question to the
  ask-character LLM flow. Gated `NEXT_PUBLIC_KATHA_WORLD_TTS=1` /
  `NEXT_PUBLIC_KATHA_WORLD_VOICE_INPUT=1`. No-key path is real (browser
  voices + no mic).

---

## 6. Innovations addendum (beyond the 3-tier plan)

These are the ideas the audit surfaced that don't fit cleanly into "fix the
bug" or "match Messenger." Items marked **DONE** shipped this pass
(complete as code, gated, no-key fallback proven); the rest stay speculative.

1. **Whole-arc QA critic with a budget.** **DONE (S2)** — `arcCriticAgent.ts`,
   gated `KATHA_ARC_CRITIC_ENABLED`, non-blocking, degrades to skip.

2. **Deterministic-but-seeded replay.** **DONE (W3)** — `?s=<uint32>` seed in
   `/world/[slug]` overrides the slug-derived seed; invalid/mismatched seeds
   are ignored. The synthesizer's purity makes this near-free.

3. **Portrait-on-demand via the existing image route.** **DONE (W5)** —
   `scripts/generate-seed-portraits.ts` generates + caches one portrait per
   seed character (once, at seed time). Gated `KATHA_SEED_PORTRAITS_ENABLED`;
   off → emoji portraits stand (the honest fallback).

4. **Hot-link the World planet and the Movie.** **DONE (W4)** —
   `remotion/WorldFlythrough.tsx` composition + `mode:'flythrough'` branch in
   the render-movie route (pre-built manifest preferred, else synthesized
   text-only from the book's scenes + worldIdentity). Behind
   `KATHA_MP4_EXPORT_ENABLED`.

5. **Audio in the World engine, finally.** **DONE (W1)** — full ambient biome
   audio + NPC murmur + footsteps, not just the single looping bed. Gated
   `NEXT_PUBLIC_KATHA_WORLD_AUDIO`.

6. **Honest "what this is" rail on the landing page.** **DONE (W6)** — a
   text-only "what the World engine does / does not do" block on the landing
   page. The dead Supabase showcase books (Mahabharata, Akbar & Birbal,
   Vikram & Betaal) were also removed from the landing cards + CTAs this
   pass — only Ramayana stays until they're regenerated fresh.

---

## 7. Self-critique

I shipped a 3D planet whose headline visual was silently broken, and labeled
dead schema fields "implemented" — the half-measures the user warned against.
Tier 1 fixed the headline bug; this pass completes Tier 2 + Tier 3 + the six
innovations **as code**, each with a no-key / offline fallback proven by the
no-key path and gated so the paid burns are deferred. The *visual* and
*audible* confirmation is still outstanding because I can't process images or
hear audio — those are flagged, not claimed. The honest distance to
Messenger's handcrafted watercolor (a 2-person art team) is unchanged: code
can build toward it on the achievable axes (universal story-driven world,
warm painterly art direction, ambient audio, living NPCs, voiced TTS + STT),
but cannot clone handcrafted illustration.