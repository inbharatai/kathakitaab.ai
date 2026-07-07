import LivingWorldScreen from '@/components/world/LivingWorldScreen';

// ============================================================
// /world/[slug] — Living World Mode
//
// A spatial, explorable companion to the linear reader. The page
// itself is a thin server shell; all the work happens in the client
// <LivingWorldScreen>, which fetches the book and synthesizes the
// WorldManifest locally (offline-capable against the seed canon).
// ============================================================

export default async function WorldPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <LivingWorldScreen bookSlug={slug} />;
}