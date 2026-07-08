'use client';

// ============================================================
// KathaKitaab — Living World 3D canvas (react-three-fiber v9)
//
// The immersive story-planet. Pure visual + raycast delight — the
// DOM accessibility/mirror layer (WorldA11yLayer) is the canonical
// interaction + screen-reader surface, and session state is the
// single source of truth this canvas follows.
//
// Mount chain: app/world/[slug]/page.tsx (Server shell) →
//   LivingWorldScreen (client) →
//   dynamic(() => import('./World3DCanvas'), { ssr:false }).
//   `ssr:false` MUST live in a client component (Next 16 rejects it
//   in Server Components) — see node_modules/next/dist/docs/01-app/
//   02-guides/lazy-loading.md.
//
// Emotional principle adapted (NOT copied) from Messenger (abeto.co):
// small explorable sphere-planet, soft follow-cam, click-to-move,
// cozy low-noise. We do not copy Messenger's art/characters/name.
// ============================================================

import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Billboard, Text, Ring } from '@react-three/drei';
import * as THREE from 'three';
import {
  BIOME_COLORS,
  latLonToVec3,
  slerpLatLon,
  type WorldManifest,
  type WorldNode,
  type WorldPortal,
} from '@/lib/world/worldManifest';
import { isPortalOpenFor, type WorldSessionState } from '@/lib/world/worldSession';
import { resolvePlaceMedia } from '@/lib/world/mediaResolver';

// ---- helpers ---------------------------------------------------------

const R = 6; // planet radius (kept in sync with PLANET_RADIUS)

function vec3FromLatLon(lat: number, lon: number, radius = R): THREE.Vector3 {
  const [x, y, z] = latLonToVec3(lat, lon, radius);
  return new THREE.Vector3(x, y, z);
}

/** Convert a world point on the sphere back to lat/lon (radians). */
function worldToLatLon(p: THREE.Vector3): { lat: number; lon: number } {
  const r = p.length();
  const lat = Math.asin(THREE.MathUtils.clamp(p.y / r, -1, 1));
  const lon = Math.atan2(p.z, p.x);
  return { lat, lon };
}

/** Cheap deterministic value noise from an integer seed + 3D point.
 *  Used to displace the icosahedron vertices so the planet has gentle
 *  low-poly terrain. No external noise lib — keeps the bundle lean. */
function valueNoise(seed: number, x: number, y: number, z: number): number {
  // Hash the point into a pseudo-random in [-1,1].
  let h = seed | 0;
  h = (h ^ Math.imul(Math.floor(x * 255), 2654435761)) >>> 0;
  h = (h ^ Math.imul(Math.floor(y * 255), 40503)) >>> 0;
  h = (h ^ Math.imul(Math.floor(z * 255), 80585)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 2246822519) >>> 0;
  return (h & 0xffff) / 0x8000 - 1; // [-1,1]
}

// ---- Planet ----------------------------------------------------------

function PlanetMesh({ seed, groundColor }: { seed: number; groundColor: string }) {
  const geo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(R, 12);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color(groundColor);
    const hi = base.clone().offsetHSL(0, 0, 0.08);
    const lo = base.clone().offsetHSL(0, 0, -0.06);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = valueNoise(seed, x, y, z);
      const len = Math.sqrt(x * x + y * y + z * z);
      const d = 1 + n * 0.06; // ±6% radial displacement
      pos.setXYZ(i, (x / len) * R * d, (y / len) * R * d, (z / len) * R * d);
      // Latitude-based hue shift + noise variation for gentle biomes.
      const latN = y / len;
      const mix = THREE.MathUtils.clamp((latN + 1) / 2 + n * 0.2, 0, 1);
      const c = lo.clone().lerp(hi, mix);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [seed, groundColor]);

  return (
    <mesh geometry={geo} receiveShadow castShadow>
      <meshStandardMaterial vertexColors roughness={0.95} metalness={0.0} flatShading />
    </mesh>
  );
}

// ---- Sky (gradient backdrop) ----------------------------------------

function SkyShell({ skyDay, skyNight, dayPhase }: { skyDay: string; skyNight: string; dayPhase: number }) {
  // dayPhase ∈ [0,1]; 0 = dawn, 1 = dusk. Blends two colors.
  const color = useMemo(() => {
    const a = new THREE.Color(skyDay);
    const b = new THREE.Color(skyNight);
    return a.lerp(b, THREE.MathUtils.clamp(dayPhase, 0, 1));
  }, [skyDay, skyNight, dayPhase]);
  return (
    <mesh scale={[-1, 1, 1]}>
      <sphereGeometry args={[60, 32, 32]} />
      <meshBasicMaterial color={color} side={THREE.BackSide} depthWrite={false} fog={false} />
    </mesh>
  );
}

// ---- Place marker ----------------------------------------------------

function PlaceMarker({
  node,
  unlocked,
  current,
  isCarrying,
}: {
  node: WorldNode;
  unlocked: boolean;
  current: boolean;
  isCarrying: boolean;
}) {
  const media = resolvePlaceMedia(node.bgImageUrl, node.biome, node.mood);
  const biomeColor = BIOME_COLORS[node.biome].accent;
  const pos = vec3FromLatLon(node.lat, node.lon, R + 0.04);
  const ringColor = current ? '#FFD66B' : biomeColor;

  return (
    <group position={pos}>
      {/* Tangent ring so the place reads on the surface. */}
      <Ring
        args={[0.16, 0.22, 24]}
        rotation={tangentRotation(pos)}
      >
        <meshBasicMaterial color={ringColor} side={THREE.DoubleSide} transparent opacity={unlocked ? 0.9 : 0.25} />
      </Ring>
      <Billboard position={[0, 0.28, 0]}>
        {/* Scene art tile (procedural color when media is dead). */}
        <mesh>
          <planeGeometry args={[0.5, 0.32]} />
          {media.kind === 'live' ? (
            <meshBasicMaterial transparent opacity={unlocked ? 0.96 : 0.35} />
          ) : (
            <meshStandardMaterial
              color={biomeColor}
              emissive={biomeColor}
              emissiveIntensity={0.25}
              roughness={0.8}
              transparent
              opacity={unlocked ? 0.9 : 0.3}
            />
          )}
        </mesh>
        <Text
          fontSize={0.16}
          color={unlocked ? '#fff' : '#9aa0a6'}
          outlineWidth={0.012}
          outlineColor="#000"
          anchorX="center"
          anchorY="top"
          position={[0, 0.34, 0]}
          maxWidth={2}
        >
          {unlocked ? node.emoji : '🔒'} {node.title}
        </Text>
        {isCarrying && (
          <Text fontSize={0.18} anchorX="center" anchorY="bottom" position={[0, -0.22, 0]}>
            ✉️
          </Text>
        )}
      </Billboard>
    </group>
  );
}

/** Rotation that lays a flat geometry tangent to the sphere at `pos`. */
function tangentRotation(pos: THREE.Vector3): [number, number, number] {
  const normal = pos.clone().normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  const e = new THREE.Euler().setFromQuaternion(quat);
  return [e.x, e.y, e.z];
}

// ---- NPC sprite ------------------------------------------------------

function NpcSprite({ lat, lon, emoji, name, atCurrent }: {
  lat: number; lon: number; emoji: string; name: string; atCurrent: boolean;
}) {
  const pos = vec3FromLatLon(lat, lon, R + 0.05);
  return (
    <group position={pos}>
      <Billboard position={[0, 0.22, 0]}>
        <Text fontSize={0.2} anchorX="center" anchorY="middle">
          {emoji}
        </Text>
        {atCurrent && (
          <Text
            fontSize={0.1}
            color="#fff"
            outlineWidth={0.008}
            outlineColor="#000"
            anchorX="center"
            anchorY="top"
            position={[0, 0.18, 0]}
          >
            {name}
          </Text>
        )}
      </Billboard>
    </group>
  );
}

// ---- Portal ring -----------------------------------------------------

function PortalRing({ portal, session }: { portal: WorldPortal; session: WorldSessionState }) {
  const open = isPortalOpenFor(session, portal);
  const carrying = session.carriedFragmentNodeId === portal.fromNodeId;
  const ready = carrying && !open;
  const pos = vec3FromLatLon(portal.lat, portal.lon, R + 0.06);
  const color = open ? '#7FB2FF' : ready ? '#FFD66B' : '#6b7280';
  return (
    <group position={pos}>
      <Ring args={[0.12, 0.18, 24]} rotation={tangentRotation(pos)}>
        <meshBasicMaterial color={color} side={THREE.DoubleSide} transparent opacity={open || ready ? 0.95 : 0.3} />
      </Ring>
      {ready && (
        <Billboard position={[0, 0.26, 0]}>
          <Text fontSize={0.16} color="#FFD66B" outlineWidth={0.01} outlineColor="#000">
            ✨
          </Text>
        </Billboard>
      )}
    </group>
  );
}

// ---- Avatar + follow camera -----------------------------------------

function AvatarAndCamera({
  session,
  manifest,
  reducedMotion,
  onMoveTo,
}: {
  session: WorldSessionState;
  manifest: WorldManifest;
  reducedMotion: boolean;
  onMoveTo: (lat: number, lon: number) => void;
}) {
  const avatarRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  // Target lat/lon from session (the a11y layer dispatches SET_AVATAR).
  const target = useMemo(() => {
    const lat = session.avatarLat ?? manifest.nodes[0]?.lat ?? 0;
    const lon = session.avatarLon ?? manifest.nodes[0]?.lon ?? 0;
    return { lat, lon };
  }, [session.avatarLat, session.avatarLon, manifest.nodes]);

  const current = useRef({ lat: target.lat, lon: target.lon });

  useFrame((_state, delta) => {
    if (reducedMotion) {
      current.current = { lat: target.lat, lon: target.lon };
    } else {
      // Slerp the avatar along the great-circle toward the target.
      const step = Math.min(1, delta * 2.2);
      const next = slerpLatLon(current.current, target, step);
      // Snap when close enough to avoid endless micro-steps.
      const d = Math.abs(next.lat - target.lat) + Math.abs(next.lon - target.lon);
      current.current = d < 1e-3 ? { lat: target.lat, lon: target.lon } : next;
    }
    const p = vec3FromLatLon(current.current.lat, current.current.lon, R + 0.12);
    if (avatarRef.current) avatarRef.current.position.copy(p);

    // Soft follow-cam: orbit above + behind the avatar, looking at it.
    const camTarget = p.clone().multiplyScalar(1.0);
    const offset = p.clone().normalize().multiplyScalar(7).add(new THREE.Vector3(0, 3.2, 0));
    const desired = camTarget.clone().add(offset);
    const lerp = reducedMotion ? 1 : Math.min(1, delta * 2.5);
    camera.position.lerp(desired, lerp);
    camera.lookAt(camTarget);
  });

  // Click-to-move on the planet: raycast gives the world point; convert
  // to lat/lon and dispatch. The a11y layer remains the precise
  // node-arrival surface; this is the immersive delight path.
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const p = e.point.clone();
    const { lat, lon } = worldToLatLon(p);
    onMoveTo(lat, lon);
  };

  return (
    <>
      <group ref={avatarRef}>
        <Billboard>
          <mesh>
            <capsuleGeometry args={[0.07, 0.12, 4, 8]} />
            <meshStandardMaterial color="#FF9933" emissive="#FF9933" emissiveIntensity={0.3} roughness={0.5} />
          </mesh>
          <Text fontSize={0.18} anchorX="center" anchorY="bottom" position={[0, 0.16, 0]}>
            🧑‍🚀
          </Text>
          {session.carriedFragmentNodeId && (
            <Text fontSize={0.14} anchorX="center" anchorY="top" position={[0, 0.2, 0]}>
              ✉️
            </Text>
          )}
        </Billboard>
      </group>
      {/* Invisible large sphere capturing clicks anywhere on the planet. */}
      <mesh
        position={[0, 0, 0]}
        onPointerDown={handlePointerDown}
      >
        <sphereGeometry args={[R + 0.5, 32, 32]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </>
  );
}

// ---- Lights ----------------------------------------------------------

function Lights() {
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[10, 14, 8]} intensity={1.1} castShadow />
      <hemisphereLight args={['#fff7e6', '#3a2a1a', 0.4]} />
    </>
  );
}

// ---- Canvas shell ----------------------------------------------------

export interface World3DCanvasProps {
  manifest: WorldManifest;
  session: WorldSessionState;
  reducedMotion: boolean;
  onMoveTo: (lat: number, lon: number) => void;
}

export default function World3DCanvas({ manifest, session, reducedMotion, onMoveTo }: World3DCanvasProps) {
  // Day phase from story progress: dawn at spawn → dusk at the end.
  const currentNode = manifest.nodes.find(n => n.id === session.currentNodeId);
  const dayPhase = currentNode
    ? currentNode.sceneIndex / Math.max(1, manifest.nodes.length - 1)
    : 0;

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 9, 16], fov: 50, near: 0.1, far: 200 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={[manifest.planet.skyNight]} />
      <fog attach="fog" args={[manifest.planet.skyNight, 30, 90]} />
      <Suspense fallback={null}>
        <Lights />
        <SkyShell
          skyDay={manifest.planet.skyDay}
          skyNight={manifest.planet.skyNight}
          dayPhase={dayPhase}
        />
        <PlanetMesh seed={manifest.planet.seed} groundColor={manifest.palette.ground} />
        {manifest.nodes.map(node => (
          <PlaceMarker
            key={node.id}
            node={node}
            unlocked={
              // unlocked check inline to avoid importing the selector
              node.sceneIndex === 0 ||
              node.unlockedBy.every(id => session.completedMissionIds.includes(id))
            }
            current={node.id === session.currentNodeId}
            isCarrying={session.carriedFragmentNodeId === node.id}
          />
        ))}
        {manifest.portals.map(p => (
          <PortalRing key={p.id} portal={p} session={session} />
        ))}
        {manifest.npcs.map(npc => {
          const node = manifest.nodes.find(n => n.id === npc.nodeId);
          if (!node) return null;
          return (
            <NpcSprite
              key={npc.slug}
              lat={node.lat}
              lon={node.lon}
              emoji={npc.emoji}
              name={npc.name}
              atCurrent={node.id === session.currentNodeId}
            />
          );
        })}
        <AvatarAndCamera
          session={session}
          manifest={manifest}
          reducedMotion={reducedMotion}
          onMoveTo={onMoveTo}
        />
      </Suspense>
    </Canvas>
  );
}