// scripts/backfill-book-canon.ts
//
// One-off backfill that brings older Redis books up to the universal
// canon contract added in commit 945f931. For each character that
// lacks an `appearance` field, asks gpt-4o-mini to write one from the
// existing role/short_summary/traits. For each character with an
// appearance but no anchor_image_url, bakes a portrait via the
// universal generateCharacterPortrait pipeline (which honours the
// book's stylePreset or the photoreal default).
//
// Idempotent: characters that already carry both fields are skipped.
// Re-running after a failure resumes from where it stopped (the
// saved book state advances after each successful step).
//
// Cost per book: ~$0.01 (appearance LLM) + ~$0.04 per character
// portrait. A 6-character book runs about $0.25.
//
// Usage:
//   npx tsx scripts/backfill-book-canon.ts                 # all books
//   npx tsx scripts/backfill-book-canon.ts vikram-and-betaal  # one book
//   npx tsx scripts/backfill-book-canon.ts --dry-run       # only report

import './_loadEnv';

import OpenAI from 'openai';
import { getRedis } from '../lib/redis';
import { getBook, saveGeneratedBook } from '../lib/data/bookRegistry';
import { generateCharacterPortrait } from '../lib/agents/visualAgent';
import { uploadGeneratedImage } from '../lib/storage/imageStorage';
import type { GeneratedBook, GeneratedCharacter } from '../lib/openai/bookGeneratorAgent';

const APPEARANCE_PROMPT_SYSTEM =
  'You are a costume + character designer for a high-budget Bollywood ' +
  'mythological epic film. Given a character\'s name, role, traits, and ' +
  'short summary, you produce a tight 4-6 sentence physical-appearance ' +
  'spec that locks how every scene image should render them. Cover: ' +
  'approximate age, skin tone, hair (colour/length/style), eyes, face ' +
  'shape and notable features, build/height, signature clothing palette ' +
  'and silhouette, signature props or weapons. Be concrete and specific. ' +
  'Output ONLY the appearance text, no prefix, no markdown, no quotes.';

async function inferAppearance(client: OpenAI, c: GeneratedCharacter, bookTitle: string): Promise<string | null> {
  const userMsg = `Book: "${bookTitle}"
Character: ${c.name}
Role: ${c.role}
Traits: ${(c.traits ?? []).join(', ') || '(none recorded)'}
Short summary: ${c.short_summary || '(none recorded)'}

Write the locked physical appearance spec for ${c.name}.`;
  try {
    const r = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: APPEARANCE_PROMPT_SYSTEM },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.5,
      max_tokens: 350,
    });
    const text = r.choices[0]?.message?.content?.trim();
    if (!text || text.length < 60) return null;
    return text;
  } catch (e) {
    console.warn(`  ! appearance gen failed for ${c.slug}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

async function bakeAnchor(c: GeneratedCharacter, book: GeneratedBook): Promise<string | null> {
  if (!c.appearance) return null;
  try {
    const r = await generateCharacterPortrait(c.name, c.appearance, book.slug, book.stylePreset);
    if (!r.imageUrl) return null;
    // Re-upload to the canonical anchor path so the URL is stable
    // across reruns / regenerations (and the canon JSON's anchor URL
    // convention stays consistent).
    const stable = await uploadGeneratedImage(r.imageUrl, {
      path: `${book.slug}/anchors/character-${c.slug}.png`,
      mimeType: 'image/png',
    });
    return stable;
  } catch (e) {
    console.warn(`  ! anchor bake failed for ${c.slug}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

interface Stats {
  scanned: number;
  appearanceAdded: number;
  anchorBaked: number;
  alreadyHad: number;
  skipped: number;
}

async function backfillBook(slug: string, dryRun: boolean): Promise<Stats> {
  const stats: Stats = { scanned: 0, appearanceAdded: 0, anchorBaked: 0, alreadyHad: 0, skipped: 0 };
  const book = await getBook(slug);
  if (!book) {
    console.warn(`[backfill] ${slug}: not in Redis`);
    return stats;
  }
  if (!book.characters?.length) {
    console.log(`[backfill] ${slug}: no characters[] — skipping`);
    return stats;
  }

  console.log(`\n=== ${slug} (${book.characters.length} characters) ===`);
  const client = new OpenAI();
  let changed = false;

  for (const c of book.characters) {
    stats.scanned++;
    const hasAppearance = !!(c.appearance && c.appearance.length > 30);
    const hasAnchor = !!c.anchor_image_url;
    if (hasAppearance && hasAnchor) {
      console.log(`  ✓ ${c.slug}: complete`);
      stats.alreadyHad++;
      continue;
    }

    if (!hasAppearance) {
      if (dryRun) {
        console.log(`  → ${c.slug}: WOULD generate appearance`);
        stats.skipped++;
        continue;
      }
      const appearance = await inferAppearance(client, c, book.title);
      if (!appearance) { stats.skipped++; continue; }
      c.appearance = appearance;
      stats.appearanceAdded++;
      changed = true;
      console.log(`  + ${c.slug}: appearance written (${appearance.length} chars)`);
      // Persist after each appearance so a crash doesn't lose work.
      await saveGeneratedBook(book);
    }

    if (!c.anchor_image_url && c.appearance) {
      if (dryRun) {
        console.log(`  → ${c.slug}: WOULD bake anchor`);
        stats.skipped++;
        continue;
      }
      const url = await bakeAnchor(c, book);
      if (!url) { stats.skipped++; continue; }
      c.anchor_image_url = url;
      stats.anchorBaked++;
      changed = true;
      console.log(`  + ${c.slug}: anchor baked → ${url.slice(-60)}`);
      await saveGeneratedBook(book);
    }
  }

  if (changed && !dryRun) {
    await saveGeneratedBook(book);
    console.log(`  saved ${slug}`);
  }
  return stats;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const slugs = args.filter(a => !a.startsWith('--'));

  let targets = slugs;
  if (targets.length === 0) {
    const r = getRedis();
    if (!r) { console.error('No Redis configured'); process.exit(1); }
    const keys = await r.keys('kk:book:*');
    targets = keys.map(k => k.replace('kk:book:', '')).sort();
  }
  console.log(`[backfill] targets: ${targets.join(', ')}${dryRun ? '  (DRY RUN)' : ''}`);

  const totals: Stats = { scanned: 0, appearanceAdded: 0, anchorBaked: 0, alreadyHad: 0, skipped: 0 };
  for (const slug of targets) {
    const s = await backfillBook(slug, dryRun);
    totals.scanned += s.scanned;
    totals.appearanceAdded += s.appearanceAdded;
    totals.anchorBaked += s.anchorBaked;
    totals.alreadyHad += s.alreadyHad;
    totals.skipped += s.skipped;
  }
  console.log(`\n=== DONE ===`);
  console.log(`  characters scanned:    ${totals.scanned}`);
  console.log(`  appearance specs added: ${totals.appearanceAdded}`);
  console.log(`  anchor portraits baked: ${totals.anchorBaked}`);
  console.log(`  already complete:       ${totals.alreadyHad}`);
  console.log(`  skipped:                ${totals.skipped}`);
}

main().catch(e => {
  console.error('[backfill] failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
