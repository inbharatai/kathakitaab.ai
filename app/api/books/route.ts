import { NextResponse } from 'next/server';
import { getAllBooks } from '@/lib/data/ramayanaSeed';

export async function GET() {
  const books = getAllBooks();
  return NextResponse.json({ books });
}
