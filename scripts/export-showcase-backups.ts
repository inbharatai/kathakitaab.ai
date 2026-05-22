import './_loadEnv';
import { getBook } from '../lib/data/bookRegistry';
import { getScenesByBookSlug } from '../lib/data/sceneRegistry';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SLUGS = ['mahabharata', 'akbar-and-birbal', 'vikram-and-betaal', 'tenali-raman'];
const OUT_DIR = join(process.cwd(), 'data', 'showcase-backups');

async function exportBook(slug: string) {
  const book = await getBook(slug);
  if (!book) {
    console.warn(`[export] ${slug}: not found in Redis`);
    return;
  }
  const scenes = await getScenesByBookSlug(slug);
  const payload = { book, scenes };
  const path = join(OUT_DIR, `${slug}.json`);
  writeFileSync(path, JSON.stringify(payload, null, 2));
  console.log(`[export] ${slug} → ${path} (${scenes.length} scenes)`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const slug of SLUGS) {
    await exportBook(slug);
  }
  console.log('[export] done');
}

main().catch(err => {
  console.error('[export] fatal:', err);
  process.exit(1);
});
