import { NextResponse } from 'next/server';
import { getAllBooks as getSeedBooks } from '@/lib/data/ramayanaSeed';
import { getAllBooks as getRegistryBooks } from '@/lib/data/bookRegistry';

export async function GET() {
  // Curated seed books + everything generated through the engine.
  // Both are exposed under one universal listing so a future books-
  // index UI doesn't need to know about the two sources.
  const seed = getSeedBooks();
  const generated = await getRegistryBooks();
  const generatedAsBook = generated.map(b => ({
    id: b.id,
    slug: b.slug,
    title: b.title,
    subtitle: b.subtitle,
    description: b.description,
    source_tradition: b.source_tradition,
  }));
  return NextResponse.json({ books: [...seed, ...generatedAsBook] });
}
