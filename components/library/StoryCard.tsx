'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

interface StoryCardProps {
  slug: string;
  title: string;
  subtitle?: string;
  coverImage?: string;
  previewImages?: string[];
  mode?: string;
  visibility?: 'public' | 'private';
  isOwner?: boolean;
  isGenerated?: boolean;
  accuracyLabel?: string;
  hasMovie?: boolean;
  badge?: string;
  href: string;
  progress?: number; // 0-100
  showPlayIcon?: boolean;
  ariaLabel?: string;
}

/** Single poster-style card for the Netflix-style library rails.
 *
 *  - Poster image with gradient fallback
 *  - Multi-image Ken-Burns crossfade (when previewImages >= 2)
 *  - Badges for generated/canon/movie/private status
 *  - Optional progress bar
 *  - Optional play icon overlay (for movie cards)
 *  - Tap-friendly sizing (44px min touch target)
 *  - IntersectionObserver lazy image loading (overflow-safe)
 */
export default function StoryCard({
  slug,
  title,
  subtitle,
  coverImage,
  previewImages,
  mode,
  visibility,
  isGenerated,
  accuracyLabel,
  hasMovie,
  badge,
  href,
  progress,
  showPlayIcon,
  ariaLabel,
}: StoryCardProps) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(new Set());
  const posterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = posterRef.current;
    if (!el || (!coverImage && !previewImages?.length)) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [coverImage, previewImages]);

  const visiblePreviews = previewImages?.filter(img => !failedPreviews.has(img)) ?? [];
  const hasMultiImages = visiblePreviews.length >= 2;
  const singleImage = coverImage || visiblePreviews[0];

  // Determine badges — cap at 2 so small cards don't overflow
  const badges: Array<{ text: string; className: string }> = [];
  if (badge) {
    badges.push({ text: badge, className: 'story-card-badge-custom' });
  }
  if (visibility === 'private') {
    badges.push({ text: 'Private', className: 'story-card-badge-private' });
  }
  if (hasMovie) {
    badges.push({ text: 'Movie', className: 'story-card-badge-movie' });
  }
  if (accuracyLabel === 'CANONICAL') {
    badges.push({ text: 'Canon', className: 'story-card-badge-canon' });
  } else if (isGenerated || mode !== 'world') {
    badges.push({ text: 'AI', className: 'story-card-badge-generated' });
  }
  const visibleBadges = badges.slice(0, 2);

  // Icon fallback for missing cover
  const COVER_ICONS: Record<string, string> = {
    ramayana: '🏛️',
    mahabharata: '⚔️',
    panchatantra: '🦊',
    'akbar-and-birbal': '👑',
    'akbar-and-birbal-stories': '👑',
    'tenali-raman': '🪔',
    'vikram-and-betaal': '🌙',
  };
  const icon = COVER_ICONS[slug] || '📖';

  return (
    <Link
      href={href}
      className="story-card"
      aria-label={ariaLabel || `${title}${hasMovie ? ' — watch movie' : ' — read book'}`}
      tabIndex={0}
    >
      <div className="story-card-poster" ref={posterRef}>
        {/* Badges */}
        {visibleBadges.length > 0 && (
          <div className="story-card-badges">
            {visibleBadges.map(b => (
              <span key={b.text} className={`story-card-badge ${b.className}`}>
                {b.text}
              </span>
            ))}
          </div>
        )}

        {/* Image, Ken-Burns stack, or icon fallback */}
        {hasMultiImages && isVisible ? (
          <div className="story-card-kenburns-stack">
            {visiblePreviews.map((img, i) => (
              <img
                key={`${img}-${i}`}
                src={img}
                alt=""
                loading="lazy"
                decoding="async"
                className="story-card-kenburns-image"
                style={{
                  animationDuration: `${visiblePreviews.length * 7}s`,
                  animationDelay: `${i * 7}s`,
                }}
                onError={() => setFailedPreviews(prev => new Set([...prev, img]))}
              />
            ))}
          </div>
        ) : singleImage && !imgError && isVisible ? (
          <img
            src={singleImage}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
            style={{
              opacity: imgLoaded ? 1 : 0,
              transition: 'opacity 0.3s ease, transform 0.4s ease',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '3rem',
              filter: 'drop-shadow(0 0 20px rgba(255,215,0,0.3))',
            }}
          >
            {icon}
          </div>
        )}

        {/* Play overlay */}
        {showPlayIcon && (
          <div className="story-card-play visible">
            <div className="story-card-play-icon" />
          </div>
        )}

        {/* Progress bar */}
        {progress !== undefined && progress > 0 && (
          <div className="story-card-progress">
            <div
              className="story-card-progress-fill"
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
        )}
      </div>

      <div className="story-card-info">
        <h3 className="story-card-title">{title}</h3>
        {subtitle && <p className="story-card-subtitle">{subtitle}</p>}
      </div>
    </Link>
  );
}

/** Skeleton placeholder for loading state */
export function StoryCardSkeleton() {
  return (
    <div className="story-card-skeleton">
      <div className="story-card-skeleton-poster shimmer" />
      <div className="story-card-skeleton-text shimmer" />
    </div>
  );
}
