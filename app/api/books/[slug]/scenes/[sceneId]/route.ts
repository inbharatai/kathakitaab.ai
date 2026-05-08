import { NextResponse } from 'next/server';
import { getSceneWithHotspots } from '@/lib/data/ramayanaSeed';
import { getScene } from '@/lib/data/bookRegistry';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; sceneId: string }> }
) {
  const { slug, sceneId } = await params;

  // 1. Try the Ramayana seed (built-in)
  if (slug === 'ramayana') {
    const scene = getSceneWithHotspots(sceneId);
    if (scene) return NextResponse.json({ scene });
  }

  // 2. Try the book registry (AI-generated books)
  const scene = await getScene(slug, sceneId);
  if (scene) return NextResponse.json({ scene });

  return NextResponse.json({ error: `Scene not found: ${sceneId} in book ${slug}` }, { status: 404 });
}
