/** A deterministic procedural surface texture for a moon sphere: cratered
 * speckle whose density scales with `MoonSurface.cratering`, and smooth
 * dark maria patches whose extent scales with `MoonSurface.mariaFraction`.
 * Seeded ONLY from the world `seed` and the moon's `index` — never from
 * anything time- or camera-dependent — so the same world always paints the
 * same moon identically, run to run. The pixel math (`moonTextureData`) is
 * split out from the `THREE.DataTexture` wrapper (`moonTexture`) so it is
 * unit-testable without constructing a three.js texture. */
import * as THREE from 'three';
import type { MoonSurface } from '../sim/scene';
import { fnv1a32, mulberry32 } from '../util/prng';

/** Texture edge length, texels — modest, since these spheres render small
 * even at true scale's schematic clamp. */
const TEXTURE_SIZE = 64;
/** Maximum maria blob count, reached at `mariaFraction` 1. */
const MAX_MARIA_BLOBS = 5;
/** Per-texel probability a crater lands there, at `cratering` 1. */
const MAX_CRATER_DENSITY = 0.18;

interface MariaBlob {
  u: number;
  v: number;
  radius: number;
}

/** The pure RGBA pixel data (row-major, `TEXTURE_SIZE`^2 texels) behind
 * `moonTexture`: a grayscale modulation map (1 = full brightness, darker
 * toward maria/crater shadow) meant to multiply against `moonBaseColor` on
 * a `MeshStandardMaterial`'s `map` slot. */
export function moonTextureData(seed: number, index: number, surface: MoonSurface): Uint8ClampedArray {
  // fnv1a32/mulberry32 (../util/prng.ts) are the view layer's existing
  // seeded-cosmetics PRNG (see system.ts's starfield) — not part of the
  // byte-pinned sim determinism contract, but deterministic per (seed,
  // index) all the same.
  const rand = mulberry32(fnv1a32(`the-faces/moon-texture/${seed}/${index}`));

  const blobCount = Math.round(surface.mariaFraction * MAX_MARIA_BLOBS);
  const blobs: MariaBlob[] = Array.from({ length: blobCount }, () => ({
    u: rand(),
    v: rand(),
    radius: 0.08 + rand() * 0.14 * (0.5 + surface.mariaFraction),
  }));
  const craterDensity = surface.cratering * MAX_CRATER_DENSITY;

  const data = new Uint8ClampedArray(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    const v = y / TEXTURE_SIZE;
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const u = x / TEXTURE_SIZE;
      let shade = 1;
      for (const blob of blobs) {
        const du = u - blob.u;
        const dv = v - blob.v;
        if (Math.sqrt(du * du + dv * dv) < blob.radius) shade *= 0.55; // maria: smooth dark patch
      }
      if (rand() < craterDensity) shade *= 0.55 + rand() * 0.3; // cratered speckle: shadowed pit
      const level = Math.round(clamp01(shade) * 255);
      const i = (y * TEXTURE_SIZE + x) * 4;
      data[i] = level;
      data[i + 1] = level;
      data[i + 2] = level;
      data[i + 3] = 255;
    }
  }
  return data;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** The moon sphere's procedural surface texture, as a `THREE.DataTexture`
 * ready for a `MeshStandardMaterial`'s `map` slot. */
export function moonTexture(seed: number, index: number, surface: MoonSurface): THREE.DataTexture {
  const data = moonTextureData(seed, index, surface);
  const texture = new THREE.DataTexture(data, TEXTURE_SIZE, TEXTURE_SIZE, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}
