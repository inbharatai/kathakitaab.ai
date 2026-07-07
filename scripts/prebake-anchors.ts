// ============================================================
// scripts/prebake-anchors.ts
//
// Pre-bake canonical "anchor" assets — portraits for major
// characters and establishing shots for major places — and write
// the resulting public URLs back into the book's canon JSON. At
// runtime, the visualAgent uses anchor_image_url with images.edit
// to keep faces / settings consistent across scenes.
//
// Universal: works for any book that has a lib/data/canon/{slug}.json.
// Pass `--book <slug>` to target one book; pass `--all` to walk every
// canon file. Pass `--include-places` to also bake place anchors.
//
// Pre-bake is idempotent — file paths are stable per (book, id), so a
// re-run overwrites the same Supabase Storage object and the canon
// URL stays valid.
//
// Usage:
//   npx tsx scripts/prebake-anchors.ts --book ramayana
//   npx tsx scripts/prebake-anchors.ts --book ramayana --include-places
//   npx tsx scripts/prebake-anchors.ts --all
// ============================================================

// MUST be the first import — populates process.env before Supabase /
// OpenAI clients are constructed inside the modules below.
import './_loadEnv';

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { CanonFile, CanonEntry } from '../lib/types/canon';
import { generateCharacterPortrait, generateSceneImage } from '../lib/agents/visualAgent';
import { uploadGeneratedImage } from '../lib/storage/imageStorage';
import { isS3Configured } from '../lib/storage/s3Storage';

const CANON_DIR = join(process.cwd(), 'lib', 'data', 'canon');

interface CliFlags {
  book?: string;
  all: boolean;
  includePlaces: boolean;
  divineOnly: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { all: false, includePlaces: false, divineOnly: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book') flags.book = argv[++i];
    else if (a === '--all') flags.all = true;
    else if (a === '--include-places') flags.includePlaces = true;
    else if (a === '--all-characters') flags.divineOnly = false;
  }
  return flags;
}

function listCanonFiles(): string[] {
  return readdirSync(CANON_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''));
}

function loadCanon(slug: string): CanonFile {
  const p = join(CANON_DIR, `${slug}.json`);
  return JSON.parse(readFileSync(p, 'utf8')) as CanonFile;
}

function saveCanon(slug: string, file: CanonFile): void {
  const p = join(CANON_DIR, `${slug}.json`);
  writeFileSync(p, JSON.stringify(file, null, 2) + '\n', 'utf8');
}

async function bakeCharacter(slug: string, entry: CanonEntry): Promise<string | null> {
  if (!entry.appearance) {
    console.warn(`  - skip ${entry.id}: no appearance field`);
    return null;
  }
  console.log(`  → portrait: ${entry.label}`);
  const result = await generateCharacterPortrait(entry.label, entry.appearance, slug);
  if (!result.imageUrl) {
    console.error(`  ! ${entry.label}: portrait generation returned no image`);
    return null;
  }
  // Re-upload to a stable anchor path. generateCharacterPortrait
  // already uploaded under a hashed filename — we re-fetch the bytes
  // and write to the canonical anchor path so the URL is permanent.
  if (/^data:/.test(result.imageUrl)) {
    const stable = await uploadGeneratedImage(result.imageUrl, {
      path: `${slug}/anchors/character-${entry.id}.png`,
      mimeType: 'image/png',
    });
    return stable;
  }
  // Already an https URL — fetch the bytes and re-upload at the
  // stable path so the canon URL is guaranteed to be the anchor file.
  const res = await fetch(result.imageUrl);
  const buf = Buffer.from(await res.arrayBuffer());
  const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
  return await uploadGeneratedImage(dataUri, {
    path: `${slug}/anchors/character-${entry.id}.png`,
    mimeType: 'image/png',
  });
}

async function bakePlace(slug: string, entry: CanonEntry): Promise<string | null> {
  if (!entry.appearance) {
    console.warn(`  - skip ${entry.id}: no appearance field`);
    return null;
  }
  console.log(`  → place: ${entry.label}`);
  const description = `Establishing wide shot of ${entry.label}. ${entry.appearance}. No people, no characters in frame — pure setting reference.`;
  const result = await generateSceneImage(description, {
    bookSlug: slug,
    mood: 'serene',
    characters: [],
  });
  if (!result.imageUrl) {
    console.error(`  ! ${entry.label}: scene-bg generation returned no image`);
    return null;
  }
  if (/^data:/.test(result.imageUrl)) {
    return await uploadGeneratedImage(result.imageUrl, {
      path: `${slug}/anchors/place-${entry.id}.png`,
      mimeType: 'image/png',
    });
  }
  const res = await fetch(result.imageUrl);
  const buf = Buffer.from(await res.arrayBuffer());
  const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
  return await uploadGeneratedImage(dataUri, {
    path: `${slug}/anchors/place-${entry.id}.png`,
    mimeType: 'image/png',
  });
}

async function bakeBook(slug: string, flags: CliFlags): Promise<void> {
  console.log(`\n[prebake] ${slug}`);
  const file = loadCanon(slug);

  const characterTargets = file.entries.filter(e =>
    e.kind === 'character'
    && e.appearance
    && (!flags.divineOnly || e.divine === true),
  );
  const placeTargets = flags.includePlaces
    ? file.entries.filter(e => e.kind === 'place' && e.appearance)
    : [];

  console.log(`  characters: ${characterTargets.length}, places: ${placeTargets.length}`);

  for (const entry of characterTargets) {
    try {
      const url = await bakeCharacter(slug, entry);
      if (url) {
        entry.anchor_image_url = url;
        // Persist after every successful bake so a mid-run failure
        // doesn't lose the work that already finished.
        saveCanon(slug, file);
        console.log(`  ✓ ${entry.id} → ${url}`);
      }
    } catch (err) {
      console.error(`  ! ${entry.id}:`, err instanceof Error ? err.message : err);
    }
  }

  for (const entry of placeTargets) {
    try {
      const url = await bakePlace(slug, entry);
      if (url) {
        entry.anchor_image_url = url;
        saveCanon(slug, file);
        console.log(`  ✓ ${entry.id} → ${url}`);
      }
    } catch (err) {
      console.error(`  ! ${entry.id}:`, err instanceof Error ? err.message : err);
    }
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  if (!isS3Configured()) {
    throw new Error(
      'S3 storage not configured. Set KK_S3_BUCKET + KK_S3_ACCESS_KEY_ID + KK_S3_SECRET_ACCESS_KEY (and KK_CDN_HOST) before running.',
    );
  }
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    throw new Error('No image-gen API configured. Set OPENAI_API_KEY or GEMINI_API_KEY.');
  }

  const books = flags.all
    ? listCanonFiles()
    : flags.book
      ? [flags.book]
      : (() => { throw new Error('Pass --book <slug> or --all'); })();

  for (const slug of books) {
    await bakeBook(slug, flags);
  }
  console.log('\n[prebake] done');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
