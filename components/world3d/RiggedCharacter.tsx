'use client';

// ============================================================
// RiggedCharacter — a real skinned humanoid on the story-planet.
//
// Replaces the emoji-capsule "dummy" avatar and the flat PNG / emoji
// NPC billboards with a rigged humanoid GLB (Quaternius "Character
// Animated", CC0 — see public/models/character-animated.glb and the
// license note in WORLD_ENGINE_AUDIT.md). The figure stands on the
// planet surface (feet on the ground, head outward), idles when still,
// walks when moving, and turns to face its travel direction. Per
// character it is cloned (independent skeleton + AnimationMixer) and
// shirt-tinted for variety; the emoji remains the no-asset fallback.
//
// HONESTY — what I can and cannot verify:
//   • The GLB carries 24 unlabeled animation clips ("0".."23"). I picked
//     IDLE/WALK below by offline motion analysis (translation magnitude
//     per clip — see the comment at the constants). Only 5 clips have
//     finite translations everywhere; the other 19 carry garbage
//     IK-helper translation channels that would teleport the figure if
//     played, so the usable set is small. I CANNOT visually confirm
//     which clip looks like idle vs walk (no image review), so the two
//     indices below are the best blind picks and are intentionally easy
//     to tweak: flip the numbers after eyeballing in a browser.
//   • The model's "forward" axis is assumed +Z (Quaternius convention).
//     If the character walks backward, set FORWARD_SIGN (below) to -1.
//   • I cannot eye-verify the figure stands correctly on the sphere /
//     animates smoothly. The emoji fallback guarantees the world never
//     breaks if the model fails to load or looks wrong until tuned.
// ============================================================

import { Component, Suspense, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const MODEL_URL = '/models/character-animated.glb';

// Target figure height in planet units. The old emoji avatar was ~0.26
// tall; keeping the same scale means the rigged human reads at the same
// size as the markers/rings around it.
const TARGET_HEIGHT = 0.26;

// Animation clip indices, chosen by offline motion analysis of every
// clip's per-node translation extent (scripts run against the GLB's BIN
// chunk). Among the 24 clips only 5 have finite translations everywhere:
//   19 = lowest body motion (subtle shoulder gesture, body ~static) → idle
//   22 = cyclic Foot.R + Body + Foot.L motion → walk
// The others either have near-zero motion (no visible loop) or carry
// garbage IK-helper translations (teleport). These two are the best
// blind picks; swap after a visual check. (See HONESTY note above.)
const IDLE_CLIP = 19;
const WALK_CLIP = 22;

// Sign of the axis the character model faces in its rest pose. Quaternius
// characters are authored facing +Z, which makeBasis maps to `faceDir`
// (the third column). If the character walks backward, flip this to -1 —
// a single-line tweak (negates faceDir, turning the figure 180°).
const FORWARD_SIGN = 1;
const UP_AXIS = new THREE.Vector3(0, 1, 0);

/** Catches a model load / clone failure and renders the emoji fallback so
 *  the world never breaks on a bad asset. Keyed by MODEL_URL at the call
 *  site so a remount resets the boundary. */
class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* swallow — fallback renders */ }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Deterministic per-slug hue → shirt tint, so each NPC reads as a
 *  distinct person without bundling extra models. FNV-1a (matches the
 *  world engine's deterministic ethos — no Math.random). */
function tintForSlug(slug: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hue = (h % 360) / 360;
  const c = new THREE.Color().setHSL(hue, 0.55, 0.5);
  return `#${c.getHexString()}`;
}

/** The rigged humanoid. The parent <group> translates it to the surface
 *  point; this component orients itself (feet on the ground, head outward,
 *  facing travel/target direction), scales itself to TARGET_HEIGHT, and
 *  drives idle/walk from its own world-position delta (avatar) or stays
 *  idle facing `faceTargetPos` (NPC). */
function RiggedFigure({
  tintHex,
  faceTargetPos,
  alwaysIdle,
  reducedMotion,
}: {
  tintHex?: string;
  faceTargetPos?: THREE.Vector3;
  alwaysIdle?: boolean;
  reducedMotion: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  // Inner group holds the cloned scene so we can offset the feet to the
  // group's local origin by moving the inner group (a ref), NOT by
  // mutating the useMemo-derived `cloned` (the react-hooks/immutability
  // rule forbids that).
  const inner = useRef<THREE.Group>(null);
  // useGLTF caches the parsed GLTF; clone the skinned scene per instance
  // so each character has its own skeleton + can animate independently.
  const gltf = useGLTF(MODEL_URL) as unknown as { scene: THREE.Group; animations: THREE.AnimationClip[] };
  const cloned = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf.scene]);
  const { actions } = useAnimations(gltf.animations, group);

  // Scale to TARGET_HEIGHT from the model's real bounding box (the GLB's
  // accessor min/max is unreliable for the rigged meshes, so we measure
  // at runtime) and lift so the feet rest at the group's local origin.
  useLayoutEffect(() => {
    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = size.y > 1e-4 ? TARGET_HEIGHT / size.y : 1;
    group.current?.scale.setScalar(scale);
    // Feet at local y=0: offset the inner group up by -box.min.y (scaled).
    if (inner.current) inner.current.position.y = -box.min.y * scale;
  }, [cloned]);

  // Shirt tint for variety (avatar keeps its own tint; NPCs get a per-slug
  // hue). Tints the clothing materials only — skin/hair/eyes stay as
  // authored so faces still read human. (The materials are reached via
  // traverse, so the react-hooks/immutability rule does not flag the tint.)
  useLayoutEffect(() => {
    if (!tintHex) return;
    const shirt = new THREE.Color(tintHex);
    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (!mat) return;
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        const sm = m as THREE.MeshStandardMaterial;
        if (sm.isMeshStandardMaterial && (sm.name === 'Shirt' || sm.name === 'Pants' || sm.name === 'UnderShirt')) {
          sm.color.copy(shirt);
        }
      }
    });
  }, [cloned, tintHex]);

  // Orientation + animation state. We track the previous world position
  // to derive a travel direction (avatar) — the parent mutates this
  // group's world position each frame, so we read it back here.
  const prevWorld = useRef<THREE.Vector3 | null>(null);
  const lastHeadingQuat = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const currentClip = useRef<string | null>(null);

  useFrame((_state, delta) => {
    const g = group.current;
    if (!g) return;

    // Outward normal at this point on the sphere = normalized world pos.
    const worldPos = new THREE.Vector3();
    g.getWorldPosition(worldPos);
    const normal = worldPos.clone().normalize();

    // Desired facing direction (tangent to the sphere). The avatar derives
    // it from its own world-position delta (the parent moves the group);
    // NPCs face the supplied avatar point.
    let faceDir: THREE.Vector3 | null = null;
    let moving = false;
    if (faceTargetPos) {
      const toTarget = faceTargetPos.clone().sub(worldPos);
      faceDir = toTarget.sub(normal.clone().multiplyScalar(toTarget.dot(normal)));
      faceDir = faceDir.lengthSq() > 1e-8 ? faceDir.normalize() : null;
    } else if (!alwaysIdle && prevWorld.current && !reducedMotion) {
      const travel = worldPos.clone().sub(prevWorld.current);
      moving = travel.length() > 1e-4;
      if (moving) {
        faceDir = travel.sub(normal.clone().multiplyScalar(travel.dot(normal)));
        faceDir = faceDir.lengthSq() > 1e-8 ? faceDir.normalize() : null;
      }
    }
    prevWorld.current = worldPos.clone();

    if (faceDir) faceDir.multiplyScalar(FORWARD_SIGN);

    // Orientation: model +Y → outward normal (feet on ground, head up),
    // and +Z (forward) → faceDir when we have one. Without a faceDir we
    // still align up to the normal so the figure stands on the sphere
    // rather than pointing up the world axis.
    const targetQuat = new THREE.Quaternion();
    if (faceDir) {
      const right = new THREE.Vector3().crossVectors(normal, faceDir);
      if (right.lengthSq() > 1e-8) {
        right.normalize();
        targetQuat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, normal, faceDir));
      } else {
        targetQuat.setFromUnitVectors(UP_AXIS, normal);
      }
    } else {
      targetQuat.setFromUnitVectors(UP_AXIS, normal);
    }
    // Smoothly slerp the heading so turns feel natural, not snappy.
    lastHeadingQuat.current.slerp(targetQuat, Math.min(1, delta * 6));
    g.quaternion.copy(lastHeadingQuat.current);

    // Animation selection: walk while moving, idle otherwise.
    const wantClip = moving && !reducedMotion ? String(WALK_CLIP) : String(IDLE_CLIP);
    if (wantClip !== currentClip.current) {
      const next = actions[wantClip];
      const prevName = currentClip.current;
      if (next) {
        next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
        // crossFadeTo(other) fades `prev` OUT and `next` IN — the canonical
        // R3F pattern (prev.crossFadeTo(next)), not the reverse.
        const prev = prevName ? actions[prevName] : null;
        if (prev && prev !== next) prev.crossFadeTo(next, 0.18, false);
      }
      currentClip.current = wantClip;
    }
  });

  return (
    <group ref={group}>
      <group ref={inner}>
        <primitive object={cloned} />
      </group>
    </group>
  );
}

// ---- Public wrappers --------------------------------------------------

/** A rigged humanoid standing on the surface (positioned by the parent
 *  group), idle, facing `faceTargetPos` (the avatar) — used for NPCs.
 *  Emoji shown if the model fails to load. */
export function RiggedNpc({
  faceTargetPos,
  slug,
  emoji,
  reducedMotion,
}: {
  faceTargetPos?: THREE.Vector3;
  slug: string;
  emoji: string;
  reducedMotion: boolean;
}) {
  return (
    <ModelErrorBoundary key={MODEL_URL} fallback={<Text fontSize={0.2}>{emoji}</Text>}>
      <Suspense fallback={<Text fontSize={0.2}>{emoji}</Text>}>
        <RiggedFigure
          tintHex={tintForSlug(slug)}
          faceTargetPos={faceTargetPos}
          alwaysIdle
          reducedMotion={reducedMotion}
        />
      </Suspense>
    </ModelErrorBoundary>
  );
}

/** The player avatar — rigged, walks when moving, faces travel direction,
 *  tinted with the avatar's orange identity. Emoji shown if the model
 *  fails. Rendered inside the moving avatar group (see World3DCanvas). */
export function RiggedAvatar({
  reducedMotion,
  carryFragment,
}: {
  reducedMotion: boolean;
  carryFragment: boolean;
}) {
  return (
    <ModelErrorBoundary key={MODEL_URL} fallback={<AvatarEmojiFallback carryFragment={carryFragment} />}>
      <Suspense fallback={<AvatarEmojiFallback carryFragment={carryFragment} />}>
        <RiggedFigure tintHex="#FF9933" reducedMotion={reducedMotion} />
      </Suspense>
    </ModelErrorBoundary>
  );
}

function AvatarEmojiFallback({ carryFragment }: { carryFragment: boolean }) {
  return (
    <group>
      <mesh>
        <capsuleGeometry args={[0.07, 0.12, 4, 8]} />
        <meshStandardMaterial color="#FF9933" emissive="#FF9933" emissiveIntensity={0.3} roughness={0.5} />
      </mesh>
      <Text fontSize={0.18} anchorX="center" anchorY="bottom" position={[0, 0.16, 0]}>
        🧑‍🚀
      </Text>
      {carryFragment && (
        <Text fontSize={0.14} anchorX="center" anchorY="top" position={[0, 0.2, 0]}>
          ✉️
        </Text>
      )}
    </group>
  );
}

// Preload once at module load so the first planet mount doesn't stall.
useGLTF.preload(MODEL_URL);