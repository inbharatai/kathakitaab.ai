// Remotion compositions registered for studio + Player.
//
// `BookMovie` is the universal book-to-video composition: pass any
// book's manifest via inputProps and the duration is computed from
// it. Studio defaults to the Ramayana manifest so the preview is
// useful out-of-the-box.

import React from 'react';
import { Composition } from 'remotion';
import { KathaTrailer, TRAILER_DURATION } from './KathaTrailer';
import { BookMovie, BOOK_MOVIE_FPS, computeBookMovieFrames, type BookMovieManifest } from './BookMovie';
import { BookTrailer, TRAILER_FPS, computeTrailerFrames } from './BookTrailer';
import { WorldFlythrough, WORLD_FLYTHROUGH_FPS, computeWorldFlythroughFrames, type WorldFlythroughManifest } from './WorldFlythrough';
import ramayanaManifest from './manifests/ramayana.json';

const defaultManifest = ramayanaManifest as BookMovieManifest;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="KathaTrailer"
        component={KathaTrailer}
        durationInFrames={TRAILER_DURATION}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="BookMovie"
        component={BookMovie}
        defaultProps={{ manifest: defaultManifest }}
        durationInFrames={computeBookMovieFrames(defaultManifest)}
        fps={BOOK_MOVIE_FPS}
        width={1920}
        height={1080}
        // Re-derive duration whenever the inputProps manifest changes
        // — a different book just picks the right frame count.
        calculateMetadata={async ({ props }) => {
          const m = props.manifest as BookMovieManifest;
          return {
            durationInFrames: computeBookMovieFrames(m),
            props: { manifest: m },
          };
        }}
      />
      <Composition
        id="BookTrailer"
        component={BookTrailer}
        defaultProps={{ manifest: defaultManifest }}
        durationInFrames={computeTrailerFrames(defaultManifest)}
        fps={TRAILER_FPS}
        width={1920}
        height={1080}
        calculateMetadata={async ({ props }) => {
          const m = props.manifest as BookMovieManifest;
          return {
            durationInFrames: computeTrailerFrames(m),
            props: { manifest: m },
          };
        }}
      />
      <Composition
        id="WorldFlythrough"
        component={WorldFlythrough}
        // Default props are empty — the real manifest is provided by
        // scripts/build-world-flythrough.ts via inputProps. The studio
        // preview uses a minimal placeholder so the composition mounts.
        defaultProps={{ manifest: { bookSlug: 'ramayana', bookTitle: 'Ramayana', nodes: [], world: { ...defaultManifest, worldId: '', subtitle: '', nodes: [], places: [], npcs: [], portals: [], paths: [], palette: { sky: '', ground: '', accent: '' }, planet: { radius: 6, seed: 0, skyDay: '', skyNight: '' }, createdAt: 0 } } as unknown as WorldFlythroughManifest }}
        durationInFrames={120}
        fps={WORLD_FLYTHROUGH_FPS}
        width={1920}
        height={1080}
        calculateMetadata={async ({ props }) => {
          const m = props.manifest as WorldFlythroughManifest;
          return {
            durationInFrames: m.nodes.length > 0 ? computeWorldFlythroughFrames(m) : 120,
            props: { manifest: m },
          };
        }}
      />
    </>
  );
};
