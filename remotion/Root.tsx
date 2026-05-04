import React from 'react';
import { Composition } from 'remotion';
import { KathaTrailer, TRAILER_DURATION } from './KathaTrailer';

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
    </>
  );
};
