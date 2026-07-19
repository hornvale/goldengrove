/** The ocean-current advection overlay.
 *
 * Sibling to `./winds.ts`: same split (pure tangent-frame geometry,
 * unit-tested without WebGL; a three.js builder that consumes it) and the
 * same `null`-on-no-data contract. Unlike winds (static arrows drawn from a
 * closed-form band model), the current field is per-tile data the producer
 * already computed (`windows/scene`'s `tiles_scene`: zero over land, zero
 * everywhere on a locked world) — this overlay reads it, never re-derives
 * it. It seeds a fixed count of particles over ocean tiles carrying a
 * nonzero current, each drawn as a short arrow along that tile's
 * world-space tangent direction. Non-deterministic client eyecandy (decision
 * 0022): which ocean tiles get a particle is `Math.random`-sampled, not
 * seeded from the world. Task 5 builds this static placement; the particles
 * actually drifting over time is Task 6's visual pass. */
import * as THREE from 'three';
import type { TilesScene } from '../sim/scene';

/** How many current arrows to draw, at most (one world-space line segment
 * each) — a fixed budget independent of the tile lattice's resolution
 * (hundreds of thousands of ocean tiles at the client's 512-wide fetch), so
 * the overlay stays cheap regardless of how fine the lattice gets. */
export const CURRENT_PARTICLES = 400;

/** Arrow length, as a fraction of the sphere's radius. */
const ARROW_LENGTH = 0.02;

/** Lift above the sphere, so exaggerated relief cannot swallow the arrows —
 * matches `winds.ts`'s LIFT. */
const LIFT = 1.015;

/** Squared-length floor below which a tangent-frame vector counts as zero
 * (the poles, where east/north are undefined) — mirrors the producer's own
 * `1e-9` guards in `windows/scene`'s `wind_east_tangent`/`tangent_north`. */
const POLE_EPSILON_SQ = 1e-18;

/** Lat/lon (degrees) to a point on a unit sphere — the same convention as
 * `winds.ts`'s `onSphere` (and the producer's tangent-frame construction: lat
 * = asin(z), lon = atan2(y, x)), just at radius 1 so it doubles as the
 * tangent-frame's local "position" vector. */
function unitPosition(lat: number, lon: number): THREE.Vector3 {
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(latRad) * Math.cos(lonRad),
    Math.cos(latRad) * Math.sin(lonRad),
    Math.sin(latRad),
  );
}

/** The local eastward unit tangent at a unit-sphere `position` — zero at the
 * poles (undefined there), mirroring the producer's `wind_east_tangent`
 * (`east = normalize(cross([0, 0, 1], position))`). */
function eastTangent(position: THREE.Vector3): THREE.Vector3 {
  const east = new THREE.Vector3(0, 0, 1).cross(position);
  return east.lengthSq() < POLE_EPSILON_SQ ? east.set(0, 0, 0) : east.normalize();
}

/** The local northward unit tangent completing the (east, north) frame —
 * zero wherever `east` is zero, mirroring the producer's `tangent_north`
 * (`north = normalize(cross(position, east))`). */
function northTangent(position: THREE.Vector3, east: THREE.Vector3): THREE.Vector3 {
  const north = position.clone().cross(east);
  return north.lengthSq() < POLE_EPSILON_SQ ? north.set(0, 0, 0) : north.normalize();
}

/** Maps a tile's `(currentEast, currentNorth)` local-tangent components plus
 * its lat/lon into a world-space (unit-sphere-frame) advection vector — the
 * pure geometry this overlay owns, unit-tested without WebGL. Zero in, zero
 * out: a land tile or a locked world (both zeroed by the producer) advects
 * nothing, so the caller can tell "no current" from "current" by
 * `lengthSq() === 0` alone. */
export function currentTangentAt(
  currentEast: number,
  currentNorth: number,
  lat: number,
  lon: number,
): THREE.Vector3 {
  if (currentEast === 0 && currentNorth === 0) return new THREE.Vector3(0, 0, 0);
  const position = unitPosition(lat, lon);
  const east = eastTangent(position);
  const north = northTangent(position, east);
  return east.multiplyScalar(currentEast).addScaledVector(north, currentNorth);
}

/** The lat/lon (degrees) at the center of row-major tile `index` — the exact
 * inverse of `./worldMesh.ts`'s `tileIndex`, and identical to the producer's
 * own per-tile latitude/longitude in `windows/scene`'s `tiles_scene`. */
function tileLatLon(tiles: TilesScene, index: number): { lat: number; lon: number } {
  const row = Math.floor(index / tiles.width);
  const col = index % tiles.width;
  const lat = 90 - ((row + 0.5) / tiles.height) * 180;
  const lon = ((col + 0.5) / tiles.width) * 360 - 180;
  return { lat, lon };
}

/** The overlay, or `null` when the world has no ocean-current data to show —
 * a locked world (or an all-land seed) zeroes the whole field, and the
 * caller must SAY so rather than silently hiding the control. */
export function createCurrents(
  tiles: TilesScene,
  radius: number,
): { object3d: THREE.Object3D; setVisible(on: boolean): void } | null {
  const candidates: number[] = [];
  for (let i = 0; i < tiles.ocean.length; i++) {
    if (tiles.ocean[i] && (tiles.currentEast[i] !== 0 || tiles.currentNorth[i] !== 0)) {
      candidates.push(i);
    }
  }
  if (candidates.length === 0) return null;

  const r = radius * LIFT;
  const points: THREE.Vector3[] = [];
  const seeds = Math.min(CURRENT_PARTICLES, candidates.length);
  for (let k = 0; k < seeds; k++) {
    const i = candidates[Math.floor(Math.random() * candidates.length)]!;
    const { lat, lon } = tileLatLon(tiles, i);
    const tangent = currentTangentAt(tiles.currentEast[i]!, tiles.currentNorth[i]!, lat, lon);
    if (tangent.lengthSq() === 0) continue;
    const direction = tangent.clone().normalize();
    const base = unitPosition(lat, lon).multiplyScalar(r);
    const tip = base.clone().addScaledVector(direction, ARROW_LENGTH * radius);
    points.push(base, tip);
  }

  const geom = new THREE.BufferGeometry().setFromPoints(points);
  const lines = new THREE.LineSegments(
    geom,
    new THREE.LineBasicMaterial({ color: 0x8fd9ff, transparent: true, opacity: 0.85 }),
  );
  lines.name = 'globe-currents';
  lines.visible = false;
  return {
    object3d: lines,
    setVisible: (on) => {
      lines.visible = on;
    },
  };
}
