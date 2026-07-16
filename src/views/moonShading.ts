/** Pure (no-three-context-required beyond THREE.Color's plain math) shading
 * for the system view's moon spheres, driven by `scene/moons/v1`'s
 * per-moon surface descriptors (`../sim/scene.ts`'s `MoonSurface`) instead
 * of the flat gray placeholder. Kept apart from `./system.ts` so the
 * albedo/tint/radius math is unit-testable without a WebGL context. */
import * as THREE from 'three';
import type { MoonSurface } from '../sim/scene';
import { LUNA_RADIUS_MM, MOON_RADIUS, mmToUnits } from './scale';

/** Luna's radius, kilometers — the same constant `windows/scene` derives
 * every moon's `radius_km` from (`LUNA_RADIUS_KM` in its lib.rs), so
 * `radiusKm / LUNA_RADIUS_KM` reproduces the producer's own mass→radius
 * ratio exactly rather than re-deriving it from the view's rounded
 * megameter reference (`LUNA_RADIUS_MM` in `./scale.ts`, used by the
 * `sizeRel`-driven schematic scale that predates `scene/moons/v1`). */
const LUNA_RADIUS_KM = 1737.4;

/** Even a near-zero-albedo moon still reads as a lit sphere rather than
 * going pure black — a brightness floor under the albedo-driven gain. */
const MIN_BRIGHTNESS = 0.35;
/** How strongly `albedo` raises brightness above that floor. Moons in the
 * documents run roughly 0.1-0.3 (rocky/maria-rich) up toward icy extremes;
 * this gain keeps that whole range legible without clipping to white. */
const ALBEDO_GAIN = 1.8;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** The moon sphere's base (unlit) material color: `surface.tint` (hue/
 * saturation) scaled by an `albedo`-driven brightness. A higher `albedo`
 * always yields a strictly brighter color at the same `tint` — the
 * procedural texture (`./moonTexture.ts`) layers cratering/maria detail
 * on top via the material's map. */
export function moonBaseColor(surface: MoonSurface): THREE.Color {
  const brightness = MIN_BRIGHTNESS + surface.albedo * ALBEDO_GAIN;
  const [r, g, b] = surface.tint;
  return new THREE.Color(clamp01(r! * brightness), clamp01(g! * brightness), clamp01(b! * brightness));
}

/** Moon sphere radius (world units), driven by the physical `radiusKm`
 * descriptor rather than the schematic `sizeRel` orbital element — mirrors
 * `./scale.ts`'s `moonRadiusUnits`, but the size ratio is `radiusKm /
 * LUNA_RADIUS_KM` instead of a pre-computed `sizeRel`. True scale uses
 * Luna's reference radius through the same AU scale as every other body;
 * schematic scale keeps the existing visual-legibility clamp. */
export function moonRadiusUnitsFromKm(radiusKm: number, trueScale: boolean): number {
  const ratio = radiusKm / LUNA_RADIUS_KM;
  if (trueScale) return mmToUnits(LUNA_RADIUS_MM) * ratio;
  return MOON_RADIUS * Math.max(0.3, Math.min(2, ratio));
}
