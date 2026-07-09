import { NextResponse, after } from 'next/server';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { isAdminSession } from '@/lib/auth/adminAllowlist';
import { generateBook } from '@/lib/openai/bookGeneratorAgent';
import { saveGeneratedBook, deleteBook, getBook, acquireGenerationLock, releaseGenerationLock } from '@/lib/data/bookRegistry';
import { saveScenes, type PersistedScene } from '@/lib/data/sceneRegistry';
import { hydrateBookAudio } from '@/lib/video/manifestSynthesizer';

// Previously this listed mahabharata / akbar-and-birbal /
// vikram-and-betaal / panchatantra / tenali-raman. All of those were
// seeded against the now-decommissioned Supabase asset bucket, so their
// scene images and narration audio 404 today — surfacing them would
// send readers to broken stories. They have been removed. Ramayana is
// the only working seed and lives in lib/data/ramayanaSeed.ts (not
// here). The dead stories will be regenerated via the universal engine
// (educator page) later, at which point a new SHOWCASE list can be
// re-added with S3-backed assets.
const SHOWCASE: { slug: string; title: string }[] = [];

/** Admin-only endpoint to batch-regenerate showcase books.
 *
 *  POST /api/admin/seed-showcase?force=true
 *  Returns immediately with a job summary; actual generation runs in
 *  `after()` so the HTTP response isn't held for 3+ minutes.
 */
export async function POST(request: Request) {
  const session = await getSessionFromRouteRequest(request);
  if (!isAdminSession(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const force = searchParams.get('force') === 'true';

  // Build a summary of what's missing vs present before firing after()
  const snapshot: Array<{ slug: string; title: string; exists: boolean; action: string }> = [];
  for (const s of SHOWCASE) {
    const existing = await getBook(s.slug);
    if (existing && !force) {
      snapshot.push({ slug: s.slug, title: s.title, exists: true, action: 'skip' });
    } else {
      snapshot.push({ slug: s.slug, title: s.title, exists: !!existing, action: 'regenerate' });
    }
  }

  const toRegenerate = snapshot.filter(s => s.action === 'regenerate');
  if (SHOWCASE.length === 0) {
    return NextResponse.json({
      message: 'No showcase seeds are configured. The previous Supabase-backed seeds (mahabharata, akbar-and-birbal, vikram-and-betaal, panchatantra, tenali-raman) were removed because their assets 404. Regenerate stories via the universal engine on the educator page instead.',
      snapshot,
    });
  }
  if (toRegenerate.length === 0) {
    return NextResponse.json({
      message: 'All showcase books already exist. Pass ?force=true to regenerate.',
      snapshot,
    });
  }

  after(async () => {
    for (const entry of toRegenerate) {
      const locked = await acquireGenerationLock(entry.slug);
      if (!locked) {
        console.log(`[seed-showcase] ${entry.slug} is already being generated — skipping.`);
        continue;
      }
      try {
        if (entry.exists && force) {
          await deleteBook(entry.slug);
        }

        const book = await generateBook(
          entry.title,
          (step, percent) => {
            console.log(`[seed-showcase] ${entry.slug}: ${percent}% ${step}`);
          },
        );

        if (book.slug !== entry.slug) {
          console.error(`[seed-showcase] slug mismatch: generated "${book.slug}" != expected "${entry.slug}".`);
          continue;
        }

        const finalBook = {
          ...book,
          mode: 'world' as const,
          visibility: 'public' as const,
          movieStatus: 'ready' as const,
          updatedAt: Date.now(),
        };

        await saveGeneratedBook(finalBook);

        const hydrated = await hydrateBookAudio(finalBook);
        await saveGeneratedBook(hydrated);

        const persistedScenes: PersistedScene[] = hydrated.scenes.map(s => ({
          ...s,
          savedAt: Date.now(),
          imageStatus: s.background_asset_url ? 'completed' : 'pending',
          ttsStatus: s.narration_audio_url ? 'completed' : 'pending',
        }));
        await saveScenes(entry.slug, persistedScenes);

        console.log(`[seed-showcase] done: ${entry.slug} (${hydrated.scenes.length} scenes)`);
      } catch (err) {
        console.error(`[seed-showcase] failed for ${entry.slug}:`, err instanceof Error ? err.message : err);
      } finally {
        await releaseGenerationLock(entry.slug);
      }
    }
  });

  return NextResponse.json({
    message: `Seeding ${toRegenerate.length} showcase book(s) in the background.`,
    snapshot,
    toRegenerate: toRegenerate.map(r => r.slug),
  });
}

/** GET returns the current status of showcase books without changing anything. */
export async function GET(request: Request) {
  const session = await getSessionFromRouteRequest(request);
  if (!isAdminSession(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const snapshot = [];
  for (const s of SHOWCASE) {
    const book = await getBook(s.slug);
    snapshot.push({
      slug: s.slug,
      title: s.title,
      exists: !!book,
      scenes: book?.scenes?.length ?? 0,
      hasAudio: book?.scenes?.filter((sc: { narration_audio_url?: string }) => sc.narration_audio_url).length ?? 0,
      movieStatus: book?.movieStatus ?? 'missing',
    });
  }

  return NextResponse.json({ snapshot });
}
