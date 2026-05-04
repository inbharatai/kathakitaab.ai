import { NextResponse } from 'next/server';
import { getCharacterBySlug } from '@/lib/data/ramayanaSeed';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; characterSlug: string }> }
) {
  const { characterSlug } = await params;
  const character = getCharacterBySlug(characterSlug);
  
  if (!character) {
    return NextResponse.json({ error: 'Character not found' }, { status: 404 });
  }

  return NextResponse.json({ character });
}
