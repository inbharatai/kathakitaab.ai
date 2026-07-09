// ============================================================
// remotion/WorldFlythrough.tsx
//
// A Remotion composition that glides the camera node→node along the
// WorldManifest story graph (paths/portals), slerping across the
// great-circle between each place. Each node gets:
//   - a duration based on its narration length (or fixed 90 frames)
//   - narration text = the deliver_fragment mission's fragmentText
//     or node.shortSummary
//   - a mood-bed audio track from the static /audio/mood/{mood}.wav
//
// Pure code: no live TTS calls, no image generation. The narration
// audio is optionally pre-rendered by scripts/build-world-flythrough.ts
// (gated behind KATHA_DIALOGUE_TTS_ENABLED=1) and passed via the
// flythrough manifest; when absent, the composition shows text only.
//
// Camera math reuses slerpLatLon + latLonToVec3 from
// lib/world/worldManifest.ts so the flythrough follows the exact
// same great-circle arcs the live 3D planet uses.
// ============================================================

import React from 'react';
import {
  AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';
import {
  slerpLatLon, latLonToVec3, PLANET_RADIUS,
  type WorldManifest, type WorldNode,
} from '../lib/world/worldManifest';

export const WORLD_FLYTHROUGH_FPS = 30;
const DEFAULT_NODE_FRAMES = 90;
const TITLE_FRAMES = 60;
const END_FRAMES = 60;

// ── Flythrough manifest (built by scripts/build-world-flythrough.ts) ──

export interface FlythroughNode {
  /** The world node id */
  nodeId: string;
  /** Narration text for this node (fragmentText or shortSummary) */
  narration: string;
  /** Pre-rendered narration audio URL (S3/CDN), or null for text-only */
  narrationAudioUrl: string | null;
  /** Duration in frames for this node */
  durationInFrames: number;
  /** Mood for the mood-bed audio */
  mood: string;
}

export interface WorldFlythroughManifest {
  bookSlug: string;
  bookTitle: string;
  nodes: FlythroughNode[];
  /** The full WorldManifest for camera/sphere math */
  world: WorldManifest;
}

// ── Resolve a static mood-bed audio path ──
// Mirrors BookMovie's resolveAsset + mood-bed pattern.
const resolveMoodAudio = (mood: string): string | null => {
  // 'tense' → 'dramatic' (the Mood WAV vocabulary doesn't have 'tense')
  const m = mood === 'tense' ? 'dramatic' : mood;
  return staticFile(`audio/mood/${m}.wav`);
};

// ── Compute total duration ──

export function computeWorldFlythroughFrames(manifest: WorldFlythroughManifest): number {
  const nodes = manifest.nodes.reduce((sum, n) => sum + n.durationInFrames, 0);
  return TITLE_FRAMES + nodes + END_FRAMES;
}

// ── Camera slerp between two nodes ──
// Computes the camera world-position at fraction `t` along the
// great-circle from `fromNode` to `toNode`. Hovering at 1.8× the
// planet radius gives a flyover feel. (Not yet wired to a 3D
// renderer — the 2D composition shows text cards; this math is
// ready for a future three.js flythrough overlay.)

function cameraPosition(
  fromNode: WorldNode,
  toNode: WorldNode,
  t: number,
): [number, number, number] {
  const slerped = slerpLatLon(
    { lat: fromNode.lat, lon: fromNode.lon },
    { lat: toNode.lat, lon: toNode.lon },
    t,
  );
  return latLonToVec3(slerped.lat, slerped.lon, PLANET_RADIUS * 1.8);
}

// ── Title card ──

const TitleCard: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const fade = interpolate(frame, [0, 12, durationInFrames - 12, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0e1a', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: fade }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 28, color: '#FF9933', letterSpacing: 4, marginBottom: 16 }}>WORLD FLYTHROUGH</div>
        <div style={{ fontSize: 64, fontFamily: 'serif', color: '#E8DBC4' }}>{title}</div>
      </div>
    </AbsoluteFill>
  );
};

// ── Node scene ──

const NodeScene: React.FC<{
  node: FlythroughNode;
  worldNode: WorldNode;
  fromNode: WorldNode;
}> = ({ node, worldNode, fromNode }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Camera slerps from the previous node to this node over the
  // first 60% of the scene, then holds. The resulting world position
  // is computed for a future 3D flythrough overlay.
  const travelFrames = Math.min(Math.floor(durationInFrames * 0.6), 60);
  const t = interpolate(frame, [0, travelFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _cameraPos = cameraPosition(fromNode, worldNode, t);

  // Fade in/out for the narration text
  const textFade = interpolate(
    frame,
    [0, 10, durationInFrames - 10, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // Mood bed audio
  const moodAudioSrc = resolveMoodAudio(node.mood);

  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0e1a' }}>
      {/* Camera positioning is conceptual here — the Remotion composition
          renders a 2D stage. In a real 3D flythrough, this would drive a
          three.js camera. For the 2D composition, we show the node's
          title + narration text as a cinematic card sequence. */}
      <AbsoluteFill style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 80, opacity: textFade,
      }}>
        <div style={{ fontSize: 20, color: '#FF9933', letterSpacing: 3, marginBottom: 12 }}>
          {worldNode.emoji} {worldNode.title}
        </div>
        <div style={{ fontSize: 36, fontFamily: 'serif', color: '#E8DBC4', maxWidth: 1200, textAlign: 'center', lineHeight: 1.4 }}>
          {node.narration}
        </div>
      </AbsoluteFill>
      {moodAudioSrc && (
        <Audio src={moodAudioSrc} volume={0.12} loop />
      )}
      {node.narrationAudioUrl && (
        <Audio src={node.narrationAudioUrl} volume={0.9} />
      )}
    </AbsoluteFill>
  );
};

// ── End card ──

const EndCard: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const fade = interpolate(frame, [0, 12, durationInFrames - 12, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0e1a', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: fade }}>
      <div style={{ fontSize: 36, fontFamily: 'serif', color: '#E8DBC4', textAlign: 'center' }}>
        End of {title}
      </div>
    </AbsoluteFill>
  );
};

// ── Main composition ──

export const WorldFlythrough: React.FC<{ manifest: WorldFlythroughManifest }> = ({ manifest }) => {
  const frame = useCurrentFrame();
  const totalFrames = computeWorldFlythroughFrames(manifest);

  // Title card
  if (frame < TITLE_FRAMES) {
    return <TitleCard title={manifest.bookTitle} />;
  }

  // End card
  if (frame >= totalFrames - END_FRAMES) {
    return <EndCard title={manifest.bookTitle} />;
  }

  // Find which node scene we're in
  let cursor = TITLE_FRAMES;
  let nodeIndex = 0;
  for (let i = 0; i < manifest.nodes.length; i++) {
    const n = manifest.nodes[i];
    if (frame < cursor + n.durationInFrames) {
      nodeIndex = i;
      break;
    }
    cursor += n.durationInFrames;
  }

  const flyNode = manifest.nodes[nodeIndex];
  const worldNode = manifest.world.nodes.find(n => n.id === flyNode.nodeId);
  const prevWorldNode = manifest.world.nodes[Math.max(0, nodeIndex - 1)];

  if (!worldNode) {
    return <AbsoluteFill style={{ backgroundColor: '#0a0e1a' }} />;
  }

  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0e1a' }}>
      <Sequence from={cursor} durationInFrames={flyNode.durationInFrames}>
        <NodeScene
          node={flyNode}
          worldNode={worldNode}
          fromNode={prevWorldNode ?? worldNode}
        />
      </Sequence>
    </AbsoluteFill>
  );
};

export default WorldFlythrough;