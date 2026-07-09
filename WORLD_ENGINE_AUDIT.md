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

## 4. Tier 2 — next, not done (no-half-measures)

- Persistent character persona/memory thread (ask-character is stateless today).
- Vision-verify hotspots at *initial* gen, not only on the regen path.
- Whole-arc QA critic (one outline call decides the whole book today).
- Language-routed system prompts + TTS voice matching (Hindi system prompt, Hindi voice).
- Eased/bezier camera; true post-process bloom; DOF; lift the 540p render cap.
- Regenerate Ramayana narration audio to S3 (replaces the honest nulls with real voiced narration).

---

## 5. Tier 3 — beat Messenger on its own axis (not done)

- Ambient biome audio + NPC murmur (the `voiceMood` field is waiting) + footsteps — there is **no audio in the World engine today**; only the Movie engine has mood beds.
- `ask_character` dialogue tree using the `talk_examples` array (today it returns one static line).
- Per-character voiced dialogue in the movie (use the `dialogue[]` schema, turn on per-cue emotion TTS by default).

---

## 6. Innovations addendum (beyond the 3-tier plan)

These are the ideas the audit surfaced that don't fit cleanly into "fix the
bug" or "match Messenger." They are speculative — listed so they aren't lost,
not because they're endorsed.

1. **Whole-arc QA critic with a budget.** A second model reads the completed
   outline + all branch narrations and flags arc-level breaks (a promise in
   scene 2 never paid off; a character whose arc flatlines). Gated behind a
   per-book token budget so it can't run away. This is the single biggest
   quality lever the Story engine is missing.

2. **Deterministic-but-seeded replay.** The World synthesizer is already pure
   FNV-1a. Exposing the seed in the URL (`/world/ramayana?s=...`) lets a reader
   share an exact planet layout — and lets us snapshot a layout across deploys
   so a book's planet doesn't silently reshuffle. Near-free; the purity is
   already there.

3. **Portrait-on-demand via the existing image route.** NPC `portraitUrl` is
   blank for seed characters today. The `generate-image` route already exists;
   wiring it to generate + cache one portrait per seed character (once, at
   seed time, not per session) would fill the portrait billboards without
   per-user cost. Behind the same child-safety gate as `personalized_photo`.

4. **Hot-link the World planet and the Movie.** The same `WorldManifest` nodes
   that tint the planet could feed a "world flythrough" movie mode — camera
   glides place → place along the DAG, narration per node. One manifest, two
   products. Reuses everything; new composition only.

5. **Audio in the World engine, finally.** Tier 3 lists ambient biome audio,
   but the cheaper first step is a single looping biome bed per place (forest
   birds / battle drone / temple bells) crossfaded on travel — using the same
   `proceduralWav.ts` synth that already ships the movie beds. No new licensed
   assets, no new infra.

6. **Honest "what this is" rail on the landing page.** The audit's recurring
   failure mode was calling dead schema fields "implemented." A short, plainly
   worded "what the World engine does / does not do" rail (text-only, no art)
   would set expectations correctly and is the cheapest defense against
   future half-measures creeping back into marketing copy.

---

## 7. Self-critique

I shipped a 3D planet whose headline visual was silently broken, and labeled
dead schema fields "implemented" — the half-measures the user warned against.
This pass fixes the headline bug and stops the mislabeling, but the *visual*
confirmation is still outstanding because I can't process images. Tier 2/3
remain the real distance to Messenger's cozy axis.