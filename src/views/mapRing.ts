/** Pure same-face tile-address math for the Map rung's neighbor ring (the
 * campaign "The Excursion"): no THREE.js, no worker, no network — every
 * function here is a plain data transform, unit-testable with literal
 * numbers. `mapView.ts` is the only consumer; it supplies real `TileId`s and
 * a real camera position.
 *
 * Cross-face-boundary panning is explicitly out of scope (no adjacency
 * table exists for the cube's six faces) — every function below either
 * operates on same-face addresses or returns `null`/clamps at a face edge
 * rather than attempting to cross one. */
import type { TileId } from './cubeSphere';

/** A same-face tile offset in TILE units (not world units) — `dx`/`dy` count
 * whole tiles along the face's `ix`/`iy` axes. */
export interface TileOffset {
  dx: number;
  dy: number;
}

/** `addr`'s offset from `from`, in tile units — `null` if they aren't on the
 * same face/level (cross-face addressing is out of scope; a caller getting
 * `null` here has a bug, not a boundary condition to handle gracefully). */
export function sameFaceOffset(addr: TileId, from: TileId): TileOffset | null {
  if (addr.face !== from.face || addr.level !== from.level) return null;
  return { dx: addr.ix - from.ix, dy: addr.iy - from.iy };
}

/** Whether `addr` is within `radius` tiles of `center` (Chebyshev/square
 * distance — the natural metric for a square ring), same face/level only. */
export function withinChebyshev(addr: TileId, center: TileId, radius: number): boolean {
  const off = sameFaceOffset(addr, center);
  if (!off) return false;
  return Math.max(Math.abs(off.dx), Math.abs(off.dy)) <= radius;
}

/** Every same-face/same-level tile within `radius` of `center` (a
 * `(2·radius+1)²` square when away from a face edge), face-edge-clamped: a
 * neighbor whose `ix`/`iy` would leave `[0, 2^level)` is simply omitted, not
 * substituted or wrapped. Includes `center` itself. */
export function ringAddresses(center: TileId, radius: number): TileId[] {
  const span = 1 << center.level;
  const out: TileId[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    const iy = center.iy + dy;
    if (iy < 0 || iy >= span) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const ix = center.ix + dx;
      if (ix < 0 || ix >= span) continue;
      out.push({ face: center.face, level: center.level, ix, iy });
    }
  }
  return out;
}

/** The legal pan range, in tile units relative to `originAddr` (the tile
 * mesh positions are anchored to — see `mapView.ts`'s stable-coordinate-frame
 * doc comment): every same-face tile within `radius` of `centerAddr`,
 * face-edge-clamped. `mapView.ts` converts this to world units and applies
 * it as the camera's active pan bound. */
export interface TileBounds {
  minDx: number;
  maxDx: number;
  minDy: number;
  maxDy: number;
}

export function panBoundsInTiles(centerAddr: TileId, originAddr: TileId, radius: number): TileBounds {
  const span = 1 << centerAddr.level;
  const minIx = Math.max(0, centerAddr.ix - radius);
  const maxIx = Math.min(span - 1, centerAddr.ix + radius);
  const minIy = Math.max(0, centerAddr.iy - radius);
  const maxIy = Math.min(span - 1, centerAddr.iy + radius);
  return {
    minDx: minIx - originAddr.ix,
    maxDx: maxIx - originAddr.ix,
    minDy: minIy - originAddr.iy,
    maxDy: maxIy - originAddr.iy,
  };
}

/** Whether the camera (at `(localX, localY)`, tile units relative to
 * `originAddr`) has drifted solidly enough past `centerAddr`'s own boundary
 * to recenter there — "solidly" meaning past the tile edge (±0.5) by a
 * further `hysteresisFraction`, so a position sitting right on the boundary
 * doesn't thrash back and forth as it jitters across the line (the spatial
 * equivalent of `cubeSphere.ts`'s `LOD_MERGE_FACTOR` split/merge hysteresis,
 * for a pan boundary instead of a zoom threshold).
 *
 * Returns the new center `TileId` if a recenter should happen, else `null`
 * — either because the camera hasn't moved far enough, or because the
 * recenter would cross a face edge (face-crossing is out of scope; the
 * caller's active pan clamp should already prevent the camera reaching this
 * case in practice, but this function refuses it either way). */
export function recenterTarget(
  originAddr: TileId,
  centerAddr: TileId,
  localX: number,
  localY: number,
  hysteresisFraction: number,
): TileId | null {
  const centerOffset = sameFaceOffset(centerAddr, originAddr);
  if (!centerOffset) return null;
  const span = 1 << originAddr.level;
  let dx = centerOffset.dx;
  let dy = centerOffset.dy;
  let changed = false;
  const threshold = 0.5 + hysteresisFraction;
  if (localX - centerOffset.dx > threshold) {
    dx += 1;
    changed = true;
  } else if (localX - centerOffset.dx < -threshold) {
    dx -= 1;
    changed = true;
  }
  if (localY - centerOffset.dy > threshold) {
    dy += 1;
    changed = true;
  } else if (localY - centerOffset.dy < -threshold) {
    dy -= 1;
    changed = true;
  }
  if (!changed) return null;
  const newIx = originAddr.ix + dx;
  const newIy = originAddr.iy + dy;
  if (newIx < 0 || newIx >= span || newIy < 0 || newIy >= span) return null;
  return { face: originAddr.face, level: originAddr.level, ix: newIx, iy: newIy };
}
