/**
 * Hotspot coordinate validation and normalization.
 *
 * Ensures x/y coordinates are finite numbers clamped to [0, 100].
 * Prevents undefined/NaN from leaking into AI prompts or UI text.
 */

export interface NormalizedPosition {
  valid: boolean;
  label: string;
  x: number | null;
  y: number | null;
}

export function normalizeHotspotPosition(input: { x?: number; y?: number }): NormalizedPosition {
  const x = Number(input?.x);
  const y = Number(input?.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return {
      valid: false,
      label: "general scene area",
      x: null,
      y: null,
    };
  }

  const cx = Math.max(0, Math.min(100, x));
  const cy = Math.max(0, Math.min(100, y));

  return {
    valid: true,
    label: `scene area at ${Math.round(cx)}%, ${Math.round(cy)}%`,
    x: cx,
    y: cy,
  };
}

/** Build a cache-friendly region key from validated coordinates. */
export function buildClickRegionKey(x?: number, y?: number): string {
  if (x === undefined || y === undefined) return "none";
  const n = normalizeHotspotPosition({ x, y });
  if (!n.valid) return "none";
  return `${Math.round(n.x! / 10) * 10},${Math.round(n.y! / 10) * 10}`;
}
