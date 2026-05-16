'use client';

import { useRef } from 'react';
import StoryCard, { StoryCardSkeleton } from './StoryCard';

interface RailItem {
  slug: string;
  title: string;
  subtitle?: string;
  coverImage?: string;
  previewImages?: string[];
  mode?: string;
  visibility?: 'public' | 'private';
  isOwner?: boolean;
  accuracyLabel?: string;
  hasMovie?: boolean;
  progress?: number;
  badge?: string;
}

interface StoryRailProps {
  title: string;
  items: RailItem[];
  loading?: boolean;
  skeletonCount?: number;
  showPlayIcon?: boolean; // show ▶ overlay
  viewAllHref?: string;
  emptyMessage?: string;
  /** Link mode: 'read' → /books/[slug], 'movie' → /books/[slug]/movie, 'play' → /play/[slug] */
  linkMode?: 'read' | 'movie' | 'play';
}

/** Horizontal scrollable rail of StoryCards.
 *
 *  - CSS scroll-snap for native-feeling touch swipe
 *  - Keyboard accessible (tab through cards)
 *  - Lazy image loading via StoryCard
 *  - Skeleton placeholders while loading
 *  - Empty state when no items
 */
export default function StoryRail({
  title,
  items,
  loading = false,
  skeletonCount = 4,
  showPlayIcon = false,
  viewAllHref,
  emptyMessage = 'Nothing here yet.',
  linkMode = 'read',
}: StoryRailProps) {
  const railRef = useRef<HTMLDivElement>(null);

  const getHref = (slug: string) => {
    switch (linkMode) {
      case 'movie': return `/books/${slug}/movie`;
      case 'play': return `/play/${slug}`;
      default: return `/books/${slug}`;
    }
  };

  return (
    <section className="story-rail-section" aria-label={title || undefined}>
      {title && (
        <div className="story-rail-header">
          <h2 className="story-rail-title">{title}</h2>
          {viewAllHref && (
            <a href={viewAllHref} className="story-rail-view-all">
              View all
            </a>
          )}
        </div>
      )}

      <div
        ref={railRef}
        className="story-rail"
        role="list"
        aria-label={`${title || 'Stories'} carousel`}
      >
        {loading ? (
          Array.from({ length: skeletonCount }).map((_, i) => (
            <div key={`skel-${i}`} role="listitem">
              <StoryCardSkeleton />
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="story-rail-empty" role="listitem">
            {emptyMessage}
          </div>
        ) : (
          items.map(item => (
            <div key={item.slug} role="listitem">
              <StoryCard
                slug={item.slug}
                title={item.title}
                subtitle={item.subtitle}
                coverImage={item.coverImage}
                previewImages={item.previewImages}
                mode={item.mode}
                visibility={item.visibility}
                isOwner={item.isOwner}
                isGenerated={item.mode !== 'world'}
                accuracyLabel={item.accuracyLabel}
                hasMovie={item.hasMovie}
                badge={item.badge}
                href={getHref(item.slug)}
                progress={item.progress}
                showPlayIcon={showPlayIcon}
              />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
