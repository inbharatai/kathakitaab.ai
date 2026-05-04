# KathaKitaab.ai

**Books that come alive, talk, teach, and let you explore.**

KathaKitaab.ai is an AI-powered visual live book engine where trusted books become clickable, talking, interactive learning worlds. This repo contains the MVP version: **Ramayana LiveBook**.

## 🎯 What is included in the MVP?
- **Ramayana LiveBook**: A 15-minute interactive visual journey.
- **12 Seeded Scenes**: Clickable hotspots, original narration, learning points, and quizzes.
- **10 Seeded Characters**: Rama, Sita, Hanuman, Ravana, etc. with rich Character Bibles.
- **AI-Powered "Ask Character"**: A feature to talk to characters with source-grounded answers (using OpenAI API).
- **Labeling System**: AI answers are explicitly labeled as `CANON`, `EXPLANATION`, `INTERPRETATION`, or `CREATIVE`.
- **Hotspot Engine**: 2D cinematic visual scenes with overlay hotspots.
- **Quiz Panel**: Test learning with scene-specific questions and explanations.
- **Responsive UI**: A premium Indian storytelling aesthetic optimized for mobile and desktop.

## 🚧 What is NOT included yet?
- **Image Generation**: Scene backgrounds are currently pure CSS gradients (OpenAI image generation is planned for Phase 2).
- **Voice Narration / TTS**: Not included in MVP (planned for Phase 3).
- **Full Database Sync**: The MVP uses seed JSON fallback. The Supabase schema is defined, but it uses local fallback mock files so you can run it immediately without DB setup.
- **Educator Mode**: The educator dashboard is a placeholder.

## 🛠️ Tech Stack
- **Next.js 15 (App Router)**
- **TypeScript**
- **React & Tailwind CSS**
- **Framer Motion** (for smooth transitions)
- **OpenAI API** (gpt-4o-mini default, text answers)
- **Playwright** (E2E testing)
- **Supabase / PostgreSQL** (Schema defined in `supabase/migrations/001_initial_schema.sql`)

## 🚀 Setup Steps

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Variables
Create a `.env.local` file in the root directory:
```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_TEXT_MODEL=gpt-4o-mini
```
*(If `OPENAI_API_KEY` is not provided, the app uses a graceful fallback system for character Q&A).*

### 3. Run the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the app.

### 4. Run Playwright Tests
```bash
npx playwright test
```

## 🗄️ Database (Supabase) Setup
For the MVP, you do not need to configure Supabase; the app uses local seed data (`lib/data/ramayanaSeed.ts`).
When you are ready to transition to a database:
1. Copy `supabase/migrations/001_initial_schema.sql` into your Supabase SQL editor to create the schema.
2. The schema supports tables for `books`, `scenes`, `hotspots`, `characters`, `quizzes`, and `generated_responses` caching.

## 🤖 How OpenAI is Used
The OpenAI API is strictly used for the **Ask Character** feature.
- **Grounded:** The agent receives the scene narration, character traits, role, speech tone, and source notes as a system prompt.
- **Safe:** Creative mode is disabled by default to prevent hallucination of scripture. The agent must answer based on the context.
- **Labeled:** Responses return structured JSON including the `label` (Canon, Explanation, Interpretation) and a `source_note`.

## 📍 Character Consistency
The seed data enforces character consistency by providing a rigorous `character_bible` for every character (clothing, colors, traits, forbidden changes). This acts as the prompt grounding for future AI image generation to prevent random stylistic jumps.

## 🔮 Future Roadmap

- **Phase 1:** Ramayana clickable 2D LiveBook (✅ MVP Complete)
- **Phase 2:** OpenAI image generation + character visual cache
- **Phase 3:** Voice narration + talk to character (TTS/Whisper)
- **Phase 4:** 2.5D parallax scenes
- **Phase 5:** Educator mode
- **Phase 6:** Upload-any-book ingestion
- **Phase 7:** Mahabharata / Panchatantra packs
- **Phase 8:** School tutoring and exam learning worlds

---
*Built with care for authentic storytelling.*
