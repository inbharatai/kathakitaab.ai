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
    </>
  );
};
