import LivingWorldScreen from '@/components/world/LivingWorldScreen';

// ============================================================
// /world/[slug] — Living World Mode
//
// A spatial, explorable companion to the linear reader. The page
// itself is a thin server shell; all the work happens in the client
// <LivingWorldScreen>, which fetches the book and synthesizes the
// WorldManifest locally (offline-capable against the seed canon).
// ============================================================

export default async function WorldPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  // W3 — seeded-replay URLs. Parse ?s=<uint32>; invalid/absent → undefined
  // (slug-derived hash). Next 16 app-router: searchParams is a Promise
  // prop alongside params (see node_modules/next/dist/docs/01-app/01-getting-started/
  // 03-layouts-and-pages.md).
  const sp = await searchParams;
  const rawSeed = sp.s;
  const seedStr = Array.isArray(rawSeed) ? rawSeed[0] : rawSeed;
  let seedOverride: number | undefined;
  if (seedStr !== undefined) {
    const parsed = Number(seedStr);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffffffff) {
      seedOverride = parsed;
    }
  }
  // #5 — World↔SceneViewer gateway. `?scene=<id>` (from the reader's
  // "Living World" link) asks the world to land the avatar on that
  // place when it is unlocked; otherwise the world spawns at the
  // beginning and highlights the place (see LivingWorldScreen). Validated
  // client-side; an unknown id is ignored so a stale reader scene can't
  // crash the world.
  const rawScene = sp.scene;
  const sceneStr = Array.isArray(rawScene) ? rawScene[0] : rawScene;
  const placeOverride = sceneStr || undefined;
  return <LivingWorldScreen bookSlug={slug} seedOverride={seedOverride} placeOverride={placeOverride} />;
}