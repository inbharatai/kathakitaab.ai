import PlayModeScreen from '@/components/game/PlayModeScreen';

export default async function PlayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  return <PlayModeScreen bookSlug={slug} />;
}