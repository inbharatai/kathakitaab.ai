import { NextResponse } from 'next/server';
import { getBook as getSeedBook, getScenesByBookId, getCharactersByBookId } from '@/lib/data/ramayanaSeed';
import { getBook as getRegistryBook } from '@/lib/data/bookRegistry';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // Try the curated seed (Ramayana) first.
  const seedBook = getSeedBook(slug);
  if (seedBook) {
    const scenes = getScenesByBookId(seedBook.id);
    const characters = getCharactersByBookId(seedBook.id);
    return NextResponse.json({ book: seedBook, scenes, characters });
  }

  // Fall back to the bookRegistry (AI-generated books). The shape
  // there is GeneratedBook — slightly different from the seed Book
  // type, so we normalise into the same { book, scenes, characters }
  // envelope the reader expects.
  const generated = await getRegistryBook(slug);
  if (generated) {
    return NextResponse.json({
      book: {
        id: generated.id,
        slug: generated.slug,
        title: generated.title,
        subtitle: generated.subtitle,
        description: generated.description,
        source_tradition: generated.source_tradition,
      },
      scenes: generated.scenes,
      characters: generated.characters,
    });
  }

  return NextResponse.json({ error: 'Book not found' }, { status: 404 });
}
