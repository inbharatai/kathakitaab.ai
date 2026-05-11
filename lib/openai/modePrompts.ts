// ============================================================
// lib/openai/modePrompts.ts
//
// Per-mode prompt builders for the universal book generator.
// Three modes share the same downstream pipeline (scene-details +
// images + narration) — only the OUTLINE prompt and the synthesized
// title differ. Keeping the divergence in one file makes it cheap
// to add a fourth mode (personalized_photo) later without touching
// the agent itself.
//
// World mode: existing behaviour. Title-based slug, public visibility,
// classic "tell me a 10-12 scene story about <title>" pipeline.
//
// Classroom mode: 6-8 scene story tuned to a grade band, language,
// and learning goal. Always private. Output ends with a learning
// summary + recap questions baked into the final scene.
//
// Personalized text mode: 6-10 scene story where a named child is
// the hero. NO photo input — the prompt explicitly tells the image
// model to render a generic age-appropriate child, never a specific
// face. Always private.
// ============================================================

export interface ClassroomMeta {
  gradeBand: string;       // e.g. "Class 6", "Grade 4-5"
  subject?: string;        // optional — Akbar/Birbal isn't really a subject
  chapter?: string;        // free-form chapter / topic descriptor
  learningGoal?: string;   // "explain how kingdoms rose and fell"
  language?: string;       // "English" / "Hindi"
  tone?: string;           // "fun adventure" / "gentle"
}

export interface PersonalizedTextMeta {
  childName: string;       // first name only — UI rejects last names
  age: number;             // 3-12 driven by UI
  language?: string;
  interests?: string;
  prompt?: string;         // free-form parent prompt
  moral?: string;
  tone?: string;
}

// ── Shared prompt fragments — stay in lockstep with what the
// generator's existing pipeline expects to find in the JSON.
// ============================================================

const OUTLINE_JSON_SHAPE = `Return JSON with this structure:
{
  "book_subtitle": "string",
  "book_description": "string",
  "source_tradition": "string (e.g., Valmiki Ramayana, Mughal court chronicles, Aesop's Fables, Indian history textbook)",
  "scenes": [
    {
      "scene_id": "snake_case_id",
      "title": "string",
      "short_summary": "string (1-2 sentences, factually grounded)",
      "visual_description": "string (detailed for image generation — used as the establishing FIRST beat. Wide-ish framing that sets the location and key characters.)",
      "visual_beats": [
        {
          "description": "string — the SECOND beat. A different shot from beat 1: a character close-up, a key object detail, a reaction face, an action moment, or a reveal. Detailed enough to paint as its own illustration. Specify WHO is in frame and what they're doing.",
          "camera_action": "one of: slow_zoom_in | slow_zoom_out | pan_left | pan_right | divine_glow | battle_push | fade_only — pick what suits this shot. Close-ups want slow_zoom_in or fade_only; reveals want slow_zoom_out; action wants battle_push; sacred moments want divine_glow."
        },
        {
          "description": "string — the THIRD beat. Another distinct shot. Vary the framing again: if beat 2 was a close-up, beat 3 might be a wide reaction or detail shot.",
          "camera_action": "same vocabulary as beat 2 — different value when possible so the camera personality varies"
        },
        {
          "description": "string — OPTIONAL fourth beat. Only include when the narration is long enough (>20s) to support 4 painted moments. Skip for short scenes.",
          "camera_action": "same vocabulary"
        },
        {
          "description": "string — OPTIONAL fifth beat. Only for the longest, most action-heavy scenes. Skip otherwise.",
          "camera_action": "same vocabulary"
        }
      ],
      "mood": "serene|dramatic|somber|joyful|sacred|mysterious|tense",
      "theme": "one-word noun for the beat — duty, wit, sacrifice, trick, courage, loss, devotion, reflection"
    }
  ],
  "characters": [
    {
      "slug": "lowercase-slug",
      "name": "string",
      "role": "string (e.g., emperor, witty courtier, sage, princess, warrior, antagonist)",
      "short_summary": "string",
      "traits": ["string"],
      "speech_tone": "string (e.g., warm and steady, witty and quick, commanding, gentle)",
      "talk_examples": ["string", "string"],
      "source_notes": "string",
      "voice_archetype": "one of: noble-male, young-male, wise-male, commanding-male, bright-male, noble-female, young-female, aged-female, narrator",
      "appearance": "REQUIRED. 4-6 sentences locking the character's physical look so every scene image keeps them consistent. Cover: approximate age, skin tone, hair (color/length/style), eyes, face shape and notable features, build/height, signature clothing palette and silhouette, signature props or weapons. Be concrete and specific — 'tall lean warrior in dark green silk with a curved sword at the hip' beats 'handsome young man'.",
      "aliases": ["string (alternative names, nicknames, titles, role-only references the LLM or user might use — empty array if none)"],
      "divine": "boolean — true ONLY for deities, avatars of gods, or sacred figures whose face should be especially locked across scenes; false for ordinary mortals, animals, or invented characters"
    }
  ]
}`;

const VOICE_ARCHETYPE_GUIDE = `voice_archetype guide — pick the closest fit:
- noble-male: heroic male leads, warrior princes, dignified protagonists
- young-male: younger brothers, adolescent heroes, lighter male voices
- wise-male: sages, ministers, elders, scholarly characters
- commanding-male: antagonists, kings with authority, deep-voiced villains
- bright-male: witty/playful male characters, tricksters, energetic
- noble-female: queens, princesses, dignified female leads
- young-female: girls, younger female characters
- aged-female: queen mothers, elder female characters
- narrator: when no character voice fits`;

// ── World mode (existing behaviour, extracted) ───────────────

export function worldOutlinePrompt(title: string): string {
  return `Create a 10-12 scene outline for an interactive educational LiveBook about: "${title}".

Walk the story chronologically — establish the world, introduce the main characters, raise the central conflict, follow it through rising action and a clear turn, and close on the resolution. Each scene should advance the timeline; don't repeat beats.

For each scene, include 2 to 3 distinct VISUAL BEATS — different moments within the same scene that the camera moves through. The first beat is the establishing shot in visual_description; visual_beats[0] and visual_beats[1] are subsequent moments the picture cuts to mid-narration. Children get bored when one image holds for 30 seconds; multiple beats fix that. Each beat must paint as its own illustration — vary the camera angle, the focal character, or what's happening on screen.

${OUTLINE_JSON_SHAPE}

${VOICE_ARCHETYPE_GUIDE}`;
}

// ── Classroom mode ───────────────────────────────────────────

/** Synthesizes a stable, parent-readable title from classroom inputs.
 *  Used as the book title shown in the reader; the slug is random. */
export function classroomTitle(meta: ClassroomMeta): string {
  const parts: string[] = [];
  if (meta.chapter) parts.push(meta.chapter.trim());
  else if (meta.subject) parts.push(meta.subject.trim());
  if (meta.gradeBand) parts.push(`(${meta.gradeBand.trim()})`);
  if (parts.length === 0) parts.push('Classroom Story');
  return parts.join(' ');
}

export function classroomOutlinePrompt(meta: ClassroomMeta): string {
  const subject = meta.subject?.trim() || 'general knowledge';
  const chapter = meta.chapter?.trim() || meta.subject?.trim() || 'a memorable story';
  const goal = meta.learningGoal?.trim() || 'leave the student curious about the topic';
  const language = meta.language?.trim() || 'English';
  const tone = meta.tone?.trim() || 'gentle and engaging';

  return `Create a 6-8 scene story for ${meta.gradeBand} students. The story will play as an interactive illustrated book.

Topic: ${chapter}.
Subject area: ${subject}.
Language: ${language}.
Tone: ${tone}.
Learning goal: ${goal}.

Constraints — non-negotiable for a classroom audience:
- Vocabulary appropriate to ${meta.gradeBand}. Define any unusual term in-line.
- Age-appropriate content. No graphic violence, no fear-based learning.
- The story should EMBODY the learning goal through narrative, not lecture about it.
- Use Indian / classroom-appropriate cultural references where relevant.
- Each scene must advance both the story and the learning. No filler.
- Final scene's narration should briefly recap the lesson in one paragraph.

Generate scenes that are concrete and visual — characters, places, events. Avoid abstract diagrams. The image model paints what's described in visual_description AND each visual_beats entry.

For each scene, include 2 to 3 distinct visual beats: the establishing shot (visual_description) plus 1-2 follow-up moments in visual_beats. Vary the camera, the focal character, or the action between beats. Children at this grade band get bored when one image holds for 30 seconds — multiple beats keep their attention.

${OUTLINE_JSON_SHAPE}

${VOICE_ARCHETYPE_GUIDE}`;
}

// ── Personalized text mode ───────────────────────────────────

/** Title for the parent's library: "[Name]'s Adventure" or based on
 *  parent's prompt. Slug is random — title is never used in URLs. */
export function personalizedTitle(meta: PersonalizedTextMeta): string {
  if (meta.prompt && meta.prompt.trim().length > 0) {
    // Lift a 3-5 word evocative phrase from the prompt rather than
    // just slapping the child's name on it.
    const trimmed = meta.prompt.trim().slice(0, 60);
    return `${meta.childName}'s Story — ${trimmed}`;
  }
  return `${meta.childName}'s Adventure`;
}

export function personalizedOutlinePrompt(meta: PersonalizedTextMeta): string {
  const language = meta.language?.trim() || 'English';
  const interests = meta.interests?.trim() || 'curiosity and adventure';
  const moral = meta.moral?.trim() || 'kindness and courage';
  const tone = meta.tone?.trim() || 'warm and adventurous';
  const userPrompt = meta.prompt?.trim();

  // Reading level hints by age band — drives vocabulary choice in
  // the downstream scene-details prompt indirectly via the visual
  // descriptions.
  const readingLevel = meta.age <= 5
    ? 'very simple sentences, short words, picture-first storytelling'
    : meta.age <= 8
    ? 'simple sentences, light vocabulary, lots of dialogue'
    : meta.age <= 12
    ? 'rich vocabulary appropriate for early readers, clear structure'
    : 'age-appropriate prose';

  const promptLine = userPrompt
    ? `Story idea from the parent: ${userPrompt}`
    : `No specific story idea — invent something joyful and adventurous around the child's interests.`;

  return `Create a 6-10 scene story where the hero is named ${meta.childName} (age ${meta.age}). The story plays as an interactive illustrated book for the family.

${promptLine}
Language: ${language}.
Tone: ${tone}.
Child's interests: ${interests}.
Moral / lesson: ${moral}.
Reading level: ${readingLevel}.

CRITICAL constraints — these are non-negotiable for a children's product:
- The hero is referred to by name (${meta.childName}) throughout the narration.
- Visual descriptions must describe a GENERIC age-appropriate child of about ${meta.age} years old. NEVER describe specific facial features, exact hair length, exact skin tone — KathaKitaab does NOT have a photo of this child. The image model is going to paint a generic child; the prompt must reflect that. Phrases like "a child with bright eyes" are fine; phrases like "a girl with shoulder-length black hair, brown eyes, and a red kurti" are NOT.
- Each scene MUST include 2-3 visual beats (visual_description + visual_beats[]). Children at age ${meta.age} need a new picture every ~10 seconds; one held image bores them. Vary the camera, the action, or the focal character between beats.
- Age-appropriate content: no graphic violence, no scary monsters that aren't resolved, no death of named characters, no romantic content.
- The story should embody the moral through what the hero does — never lecture.
- Avoid stereotyping by name or age. The hero's gender / cultural background is not specified beyond what the parent provided.

${OUTLINE_JSON_SHAPE}

${VOICE_ARCHETYPE_GUIDE}`;
}

// ── Random private slug helper ────────────────────────────────

/** 16-hex-char random slug for a private book. Prefix encodes the
 *  mode so a slug like `cl-…` or `pv-…` is human-recognizable in
 *  Redis without leaking what's in the book. Public world books
 *  keep title-based slugs (handled in the route). */
export function privateSlug(mode: 'classroom' | 'personalized_text' | 'personalized_photo'): string {
  const prefix = mode === 'classroom' ? 'cl' : 'pv';
  const u = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(16).slice(2).padEnd(32, '0');
  return `${prefix}-${u.slice(0, 16)}`;
}
