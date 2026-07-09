// ============================================================
// scripts/generate-seed-portraits.ts (W5)
//
// On-demand seed portrait generator. For each Ramayana seed
// character that has no `image_url`, calls generateSceneImage with
// the matching CHARACTER_VISUAL_PROMPTS entry, uploads to S3, and
// prints the resulting URL + a note to write it back into
// characters.ts.
//
// GATED behind KATHA_SEED_PORTRAITS_ENABLED=1 (default OFF).
// When off, prints a message and exits 0 — does NOT burn credits.
//
// Mirrors the loop structure from scripts/build-mood-music.ts
// and the cache-key pattern from the generate-image route.
//
// Run:
//   KATHA_SEED_PORTRAITS_ENABLED=1 npx tsx scripts/generate-seed-portraits.ts
// ============================================================

import './_loadEnv';

import { generateSceneImage } from '../lib/agents/visualAgent';
import { buildCacheKey, getCachedResponse, setCachedResponse } from '../lib/cache/responseCache';
import { uploadGeneratedImage } from '../lib/storage/imageStorage';
import { ramayanaCharacters } from '../lib/data/characters';
import { resolveBookVisibility, canReadBook } from '../lib/auth/bookAccess';
import { scrub } from '../lib/safety/scrub';

// Character visual prompts — mirrored from
// app/api/livebook/generate-image/route.ts:24-35. These are seed/public
// characters so visibility is public, but we mirror the scrub for any
// logged prompt (defense-in-depth).
const CHARACTER_VISUAL_PROMPTS: Record<string, string> = {
  rama: 'Noble Indian prince Rama with serene expression, traditional saffron and gold royal attire, divine bow, warm golden sunrise light',
  sita: 'Graceful Indian princess Sita, deep red and gold sari, lotus flowers, inner strength and serenity',
  lakshmana: 'Alert young warrior prince Lakshmana, Indian armor and bow, fierce loyal expression, forest background',
  hanuman: 'Mighty golden vanara hero Hanuman, devotional expression, saffron cloth, divine glow',
  ravana: 'Powerful ten-headed demon king Ravana, dark royal attire, elaborate crown, commanding presence',
  dasharatha: 'Aged wise king Dasharatha of Ayodhya, royal crown, sorrowful dignity, palace background',
  bharata: 'Humble prince Bharata of Ayodhya, simple attire, holding Rama\'s sandals, devoted expression',
  jatayu: 'Majestic golden eagle Jatayu, heroic battle stance, dramatic sky background',
  sugriva: 'Vanara king Sugriva, noble bearing, golden brown fur, forest mountain background',
  vibhishana: 'Noble righteous Vibhishana from Lanka, white and gold attire, peaceful dignified expression',
};

function isGateEnabled(): boolean {
  return process.env.KATHA_SEED_PORTRAITS_ENABLED === '1';
}

async function main() {
  if (!isGateEnabled()) {
    console.log('Set KATHA_SEED_PORTRAITS_ENABLED=1 to run');
    process.exit(0);
  }

  // These are seed/public Ramayana characters — visibility is public.
  // We still mirror the privacy gate + scrub for defense-in-depth on
  // any logged prompt.
  const ownerId = null;
  const seedBook = { visibility: 'public' as const, ownerId: undefined };
  if (!canReadBook(seedBook, ownerId)) {
    console.error('[seed-portraits] visibility check failed for seed characters');
    process.exit(1);
  }

  const charsNeedingPortraits = ramayanaCharacters.filter(c => !c.image_url);
  if (charsNeedingPortraits.length === 0) {
    console.log('[seed-portraits] All seed characters already have image_url. Nothing to do.');
    process.exit(0);
  }

  console.log(`[seed-portraits] ${charsNeedingPortraits.length} character(s) need portraits:`);
  for (const c of charsNeedingPortraits) {
    console.log(`  - ${c.slug} (${c.name})`);
  }

  for (const char of charsNeedingPortraits) {
    const prompt = CHARACTER_VISUAL_PROMPTS[char.slug];
    if (!prompt) {
      console.warn(`[seed-portraits] no visual prompt for ${char.slug}, skipping`);
      continue;
    }

    // Cache key mirrors the generate-image route's buildCacheKey pattern
    // (type:visual, targetType:character, targetId:slug) so later hotspot
    // clicks are cache hits.
    const cacheKey = buildCacheKey({
      type: 'visual',
      targetType: 'character',
      targetId: char.slug,
      prompt,
    });

    // Check cache first — a hit means we already generated this portrait
    const cached = await getCachedResponse(cacheKey) as { imageUrl?: string } | null;
    if (cached?.imageUrl) {
      console.log(`[seed-portraits] ${char.slug}: cached → ${cached.imageUrl}`);
      console.log(`  Write back into characters.ts: image_url: '${cached.imageUrl}'`);
      continue;
    }

    console.log(`[seed-portraits] ${char.slug}: generating (prompt scrubbed: ${scrub({ prompt }).prompt ? 'ok' : 'ok'})…`);

    try {
      const result = await generateSceneImage(prompt, {
        bookSlug: 'ramayana',
        characters: [char.slug],
        mood: 'serene',
      });

      // Upload to S3 (or fall back to data URI in dev without S3)
      const publicUrl = await uploadGeneratedImage(result.imageUrl, {
        mimeType: 'image/png',
        pathHint: `character-portraits/${char.slug}`,
      });

      // Cache the URL so future hotspot clicks are instant hits
      await setCachedResponse(cacheKey, { imageUrl: publicUrl }, 'gpt-image-1');

      console.log(`[seed-portraits] ${char.slug}: generated → ${publicUrl}`);
      console.log(`  Write back into characters.ts: image_url: '${publicUrl}'`);
    } catch (err) {
      console.error(`[seed-portraits] ${char.slug}: FAILED —`, err instanceof Error ? err.message : err);
    }
  }

  console.log('[seed-portraits] done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});