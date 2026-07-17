/** The real night sky: the world's own drawn neighbor stars plus its
 * derived background field, from `scene/neighbors/v1` (`../sim/scene.ts`'s
 * `NeighborsScene`) — replacing the earlier cosmetic `mulberry32` point
 * cloud. Kept apart from `./system.ts` so the coordinate transform and
 * intensity math are unit-testable without a WebGL context, the way
 * `./moonShading.ts` splits shading math from the scene graph.
 *
 * The coordinate transform is the book's `scene/neighbors/v1` reference
 * page's normative "consumer transform" (Task 3), pinned exactly: a
 * dec=+90 star must land at `(0, cos eps, sin eps)` in the y-up ecliptic
 * scene frame — the world's own spin axis, tilted away from ecliptic-north
 * by its obliquity. A sign error or axis swap here silently misplaces
 * every star in the sky.
 */
import * as THREE from 'three';
import type { FieldStar, NeighborElem, NeighborsScene } from '../sim/scene';

const DEG = Math.PI / 180;

/** Map genesis-epoch equatorial coordinates (`raDeg` in [0,360), `decDeg`
 * in [-90,90]) to a unit direction in the y-up ecliptic scene frame — the
 * same frame the system view's orbits already live in (xz plane).
 * Build the equatorial unit vector, then rotate about the x-axis (the
 * vernal equinox, RA 0) by the world's obliquity. */
export function equatorialToEcliptic(raDeg: number, decDeg: number, obliquityDeg: number): THREE.Vector3 {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const v = new THREE.Vector3(Math.cos(dec) * Math.cos(ra), Math.sin(dec), Math.cos(dec) * Math.sin(ra));
  return v.applyAxisAngle(new THREE.Vector3(1, 0, 0), obliquityDeg * DEG);
}

/** Floor under a neighbor's rendered intensity — even the document's
 * dimmest neighbor still reads as a distinct point, never fading to black. */
const NEIGHBOR_INTENSITY_FLOOR = 0.35;

/** A neighbor's rendered intensity: a document-relative log scale so a
 * sky with only faint neighbors doesn't render as uniformly dim, and one
 * with a huge brightness spread doesn't blow out — the brightest neighbor
 * in *this* document always renders at 1, the dimmest at the floor.
 * Monotone nondecreasing in `brightnessRel`. */
export function neighborIntensity(brightnessRel: number, all: number[]): number {
  const logs = all.map((b) => Math.log10(b));
  const min = Math.min(...logs);
  const max = Math.max(...logs);
  if (max === min) return 1; // single neighbor, or an equal-brightness document
  const t = (Math.log10(brightnessRel) - min) / (max - min);
  return NEIGHBOR_INTENSITY_FLOOR + (1 - NEIGHBOR_INTENSITY_FLOOR) * t;
}

/** The fixed brightness ladder for the anonymous background field's
 * `magnitudeClass` (1 brightest .. 5 faintest) — unlike neighbors, field
 * stars carry no document-relative brightness value to scale against, only
 * a coarse class, so this is a fixed table rather than a derived formula. */
const FIELD_STAR_LADDER: Record<number, number> = { 1: 0.65, 2: 0.5, 3: 0.38, 4: 0.28, 5: 0.2 };

/** A field star's rendered intensity from its `magnitudeClass`. */
export function fieldStarIntensity(magnitudeClass: number): number {
  return FIELD_STAR_LADDER[magnitudeClass] ?? FIELD_STAR_LADDER[5]!;
}

/** Neutral fallback tint (0-1 RGB) for a neighbor color word this map
 * doesn't recognize — keeps an unrecognized future producer color word
 * from crashing the render instead of just looking a little flat. */
const FALLBACK_COLOR: [number, number, number] = [0.8, 0.8, 0.85];

/** Total map (with fallback) from a neighbor's producer color word
 * (`hornvale_astronomy::neighborhood::class_color`) to a 0-1 RGB triple.
 * The producer's full word list, pinned in `./starfield.test.ts`: "dim
 * red", "warm yellow", "pale white", "deep orange", "smoldering red",
 * "hard blue-white". */
export const STAR_COLOR: Record<string, [number, number, number]> = {
  'dim red': [0.55, 0.18, 0.15],
  'warm yellow': [1.0, 0.86, 0.55],
  'pale white': [0.92, 0.94, 1.0],
  'deep orange': [1.0, 0.55, 0.2],
  'smoldering red': [0.75, 0.22, 0.12],
  'hard blue-white': [0.65, 0.75, 1.0],
};

function colorFor(color: string): [number, number, number] {
  return STAR_COLOR[color] ?? FALLBACK_COLOR;
}

const NEIGHBOR_POINT_SIZE = 0.06;
const FIELD_STAR_POINT_SIZE = 0.025;
/** Neutral field-star tint (0-1 RGB), scaled per-star by `fieldStarIntensity`. */
const FIELD_STAR_BASE_COLOR: [number, number, number] = [0.75, 0.78, 0.85];

function buildNeighborPoints(neighbors: NeighborElem[], obliquityDeg: number, shellRadius: number): THREE.Points {
  const positions = new Float32Array(neighbors.length * 3);
  const colors = new Float32Array(neighbors.length * 3);
  const allBrightness = neighbors.map((n) => n.brightnessRel);
  neighbors.forEach((n, i) => {
    const dir = equatorialToEcliptic(n.raDeg, n.decDeg, obliquityDeg).multiplyScalar(shellRadius);
    positions[3 * i] = dir.x;
    positions[3 * i + 1] = dir.y;
    positions[3 * i + 2] = dir.z;
    const intensity = neighborIntensity(n.brightnessRel, allBrightness);
    const [r, g, b] = colorFor(n.color);
    colors[3 * i] = r * intensity;
    colors[3 * i + 1] = g * intensity;
    colors[3 * i + 2] = b * intensity;
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({ vertexColors: true, size: NEIGHBOR_POINT_SIZE, sizeAttenuation: true });
  const points = new THREE.Points(geom, mat);
  points.name = 'starfield-neighbors';
  return points;
}

function buildFieldStarPoints(stars: FieldStar[], obliquityDeg: number, shellRadius: number): THREE.Points {
  const positions = new Float32Array(stars.length * 3);
  const colors = new Float32Array(stars.length * 3);
  const [br, bg, bb] = FIELD_STAR_BASE_COLOR;
  stars.forEach((s, i) => {
    const dir = equatorialToEcliptic(s.raDeg, s.decDeg, obliquityDeg).multiplyScalar(shellRadius);
    positions[3 * i] = dir.x;
    positions[3 * i + 1] = dir.y;
    positions[3 * i + 2] = dir.z;
    const intensity = fieldStarIntensity(s.magnitudeClass);
    colors[3 * i] = br * intensity;
    colors[3 * i + 1] = bg * intensity;
    colors[3 * i + 2] = bb * intensity;
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({ vertexColors: true, size: FIELD_STAR_POINT_SIZE, sizeAttenuation: true });
  const points = new THREE.Points(geom, mat);
  points.name = 'starfield-field';
  return points;
}

/** Build the real night sky as a `THREE.Group` of two `THREE.Points`
 * populations: the tinted, brightness-scaled neighbors and the neutral,
 * magnitude-scaled background field — both placed on the same `reach * 3`
 * shell the earlier cosmetic starfield used, via `equatorialToEcliptic`. */
export function buildRealStarfield(sky: NeighborsScene, obliquityDeg: number, reach: number): THREE.Group {
  const shellRadius = reach * 3;
  const group = new THREE.Group();
  group.name = 'starfield';
  group.add(buildNeighborPoints(sky.neighbors, obliquityDeg, shellRadius));
  group.add(buildFieldStarPoints(sky.stars, obliquityDeg, shellRadius));
  return group;
}
