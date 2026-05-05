import React from 'react';
import { Composition } from 'remotion';
import { KathaTrailer, TRAILER_DURATION } from './KathaTrailer';
import { RamayanaMovie, RAMAYANA_MOVIE_DURATION, RAMAYANA_MOVIE_FPS } from './RamayanaMovie';

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
        id="RamayanaMovie"
        component={RamayanaMovie}
        durationInFrames={RAMAYANA_MOVIE_DURATION}
        fps={RAMAYANA_MOVIE_FPS}
        width={1920}
        height={1080}
      />
    </>
  );
};
