import { getRedis } from '../lib/redis';

async function main() {
  const r = getRedis();
  if (!r) {
    console.log('No Redis connection');
    return;
  }

  const slugs = ['mahabharata', 'akbar-and-birbal-stories', 'panchatantra', 'tenali-raman', 'vikram-and-betaal'];
  for (const slug of slugs) {
    const k = 'kk:book:' + slug;
    const b = await r.get(k).catch(() => null);
    if (b) {
      await r.del(k);
      console.log('DELETED:', slug, '(' + (b.scenes?.length ?? 0) + ' scenes)');
    } else {
      console.log('NOT FOUND:', slug);
    }
  }
}

main().catch(console.error);
