// One-off audit + heal across every book in Redis. Probes Supabase for
// each existing narration_audio_url, clears any 404s, then re-hydrates.
// Safe to re-run — already-good scenes skip the render step.

import './_loadEnv';
import { getRedis } from '../lib/redis';
import { getBook, saveGeneratedBook } from '../lib/data/bookRegistry';
import { hydrateBookAudio } from '../lib/video/manifestSynthesizer';

interface Probe {
  id: string;
  status: 'ok' | 'no-url' | 'data-uri' | string;
}

async function main() {
  const r = getRedis();
  if (!r) {
    console.error('no Redis configured');
    process.exit(1);
  }
  const keys = await r.keys('kk:book:*');
  const slugs = keys.map(k => k.replace('kk:book:', '')).sort();
  console.log('Books in Redis:', slugs.join(', '));

  for (const slug of slugs) {
    const book = await getBook(slug);
    if (!book) continue;
    console.log('\n=== ' + slug + ' (' + book.scenes.length + ' scenes) ===');

    const probes: Probe[] = await Promise.all(
      book.scenes.map(async (s): Promise<Probe> => {
        if (!s.narration_audio_url) return { id: s.scene_id, status: 'no-url' };
        if (s.narration_audio_url.startsWith('data:')) return { id: s.scene_id, status: 'data-uri' };
        try {
          const res = await fetch(s.narration_audio_url, { method: 'HEAD' });
          return { id: s.scene_id, status: res.ok ? 'ok' : `HTTP ${res.status}` };
        } catch (e) {
          return { id: s.scene_id, status: `ERR ${e instanceof Error ? e.message : e}` };
        }
      }),
    );

    const ok = probes.filter(p => p.status === 'ok').length;
    const broken = probes.filter(p => p.status !== 'ok' && p.status !== 'no-url').length;
    const missing = probes.filter(p => p.status === 'no-url').length;
    console.log(`  ok=${ok} missing=${missing} broken=${broken}`);
    for (const p of probes) if (p.status !== 'ok') console.log(`   - ${p.id}: ${p.status}`);

    if (broken > 0) {
      const cleaned = {
        ...book,
        scenes: book.scenes.map((s, i) => {
          if (probes[i].status !== 'ok' && probes[i].status !== 'no-url') {
            // Strip the broken URL so hydrateBookAudio re-renders the scene.
            const next = { ...s };
            delete next.narration_audio_url;
            return next;
          }
          return s;
        }),
      };
      await saveGeneratedBook(cleaned);
      console.log(`  cleared ${broken} broken URL(s) from Redis`);
    }

    const fresh = (await getBook(slug))!;
    const need = fresh.scenes.filter(s => !s.narration_audio_url).length;
    if (need === 0) {
      console.log('  no rendering needed');
      continue;
    }
    console.log(`  rendering ${need} scene(s) via Sarvam→Gemini chain…`);
    const t0 = Date.now();
    const hydrated = await hydrateBookAudio(fresh);
    await saveGeneratedBook(hydrated);
    const after = hydrated.scenes.filter(s => s.narration_audio_url).length;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  done: ${after}/${hydrated.scenes.length} have audio (${elapsed}s)`);
  }
  console.log('\nDONE');
}

main().catch(e => {
  console.error('FAIL:', e);
  process.exit(1);
});
