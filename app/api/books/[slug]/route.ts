import { NextResponse } from 'next/server';
import { getBook, getScenesByBookId, getCharactersByBookId } from '@/lib/data/ramayanaSeed';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const book = getBook(slug);
  
  if (!book) {
    return NextResponse.json({ error: 'Book not found' }, { status: 404 });
  }

  const scenes = getScenesByBookId(book.id);
  const characters = getCharactersByBookId(book.id);

  return NextResponse.json({ book, scenes, characters });
}
