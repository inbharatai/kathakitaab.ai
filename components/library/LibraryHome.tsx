'use client';

import { useMemo } from 'react';
import StoryRail from './StoryRail';

interface LibraryBook {
  id?: string;
  slug: string;
  title: string;
  subtitle?: string;
  description?: string;
  mode?: 'world' | 'classroom' | 'personalized_text' | 'personalized_photo';
  coverImage?: string;
  visibility?: 'public' | 'private';
  isOwner?: boolean;
  accuracyLabel?: string;
  hasMovie?: boolean;
  movieStatus?: 'ready' | 'pending' | 'partial' | 'failed';
  progress?: number;
}

interface LibraryHomeProps {
  books: LibraryBook[];
  loading?: boolean;
  userBooks?: LibraryBook[];
}

/** Netflix-style library home with categorized horizontal rails.
 *
 *  Rails shown:
 *  - Continue Reading (books with progress > 0)
 *  - My Generated Books (user-owned private books)
 *  - Featured Stories (seed/world books — Ramayana, Mahabharata, etc.)
 *  - Mythology & Folktales (world mode, non-seed mythology)
 *  - Watch as Movie (all books with movie capability)
 *  - Recently Created (most recent, excluding seeds)
 */
export default function LibraryHome({ books, loading = false, userBooks }: LibraryHomeProps) {
  const {
    continueReading,
    myGenerated,
    featured,
    mythology,
    watchAsMovie,
    recentlyCreated,
  } = useMemo(() => {
    // Seed books (canonical reference stories)
    const seedSlugs = new Set(['ramayana', 'mahabharata', 'panchatantra']);

    const continueReading = books.filter(b => (b.progress ?? 0) > 0);

    const myGenerated = books.filter(b =>
      b.isOwner && (b.mode === 'personalized_text' || b.mode === 'personalized_photo' || b.mode === 'classroom')
    );

    const featured = books.filter(b => seedSlugs.has(b.slug));

    const mythology = books.filter(b =>
      b.mode === 'world' && !seedSlugs.has(b.slug)
    );

    const watchAsMovie = books.filter(b => b.movieStatus === 'ready');

    // Sort by most recently created (fallback to existing order)
    const recentlyCreated = [...books]
      .filter(b => !seedSlugs.has(b.slug))
      .sort(() => 0);

    return {
      continueReading,
      myGenerated: userBooks ?? myGenerated,
      featured,
      mythology,
      watchAsMovie,
      recentlyCreated,
    };
  }, [books, userBooks]);

  return (
    <div style={{ padding: '0 0 40px' }}>
      {/* Continue Reading */}
      {continueReading.length > 0 && (
        <StoryRail
          title="Continue Reading"
          items={continueReading}
          linkMode="read"
        />
      )}

      {/* My Generated Books */}
      {myGenerated.length > 0 && (
        <StoryRail
          title="My Generated Books"
          items={myGenerated}
          linkMode="read"
          emptyMessage="No generated books yet. Create your first story above."
        />
      )}

      {/* Featured Stories (seeds) */}
      <StoryRail
        title="Featured Stories"
        items={featured}
        loading={loading && featured.length === 0}
        linkMode="read"
      />

      {/* Watch as Movie */}
      <StoryRail
        title="Watch as Movie"
        items={watchAsMovie}
        loading={loading && watchAsMovie.length === 0}
        showPlayIcon
        linkMode="movie"
        emptyMessage="No movies available yet."
      />

      {/* Mythology & Folktales */}
      {mythology.length > 0 && (
        <StoryRail
          title="Mythology & Folktales"
          items={mythology}
          linkMode="read"
        />
      )}

      {/* More Stories */}
      {recentlyCreated.length > 0 && (
        <StoryRail
          title="More Stories"
          items={recentlyCreated}
          linkMode="read"
        />
      )}
    </div>
  );
}
