import { NextResponse } from 'next/server';
import { getCharacterBySlug } from '@/lib/data/ramayanaSeed';
import { getCharacter as getRegistryCharacter } from '@/lib/data/bookRegistry';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; characterSlug: string }> }
) {
  const { slug, characterSlug } = await params;

  // Curated Ramayana seed first (fast, in-memory).
  const seedChar = getCharacterBySlug(characterSlug);
  if (seedChar) return NextResponse.json({ character: seedChar });

  // Fall back to the bookRegistry — works for every AI-generated
  // book without registering each one here.
  const generated = await getRegistryCharacter(slug, characterSlug);
  if (generated) return NextResponse.json({ character: generated });

  return NextResponse.json({ error: 'Character not found' }, { status: 404 });
}
