/** The cloud-texture generator (The Mantle) — turns each tile's
 * `cloudType`/`weatherPropensity` (Task 1's `parseTiles` fields) into an
 * equirectangular RGBA cloud layer. THE KEYSTONE: alpha is a self-contained
 * value-noise fbm gated by a per-cloud-type coverage threshold, so cloud
 * edges read soft and irregular — never a flat per-tile color block (a
 * prior campaign's attempt shipped exactly that, and read as haze). Pixel
 * math (`cloudTextureData`) is split from any `THREE.DataTexture` wrapper,
 * mirroring `moonTexture.ts`'s `moonTextureData` pattern, so it is
 * unit-testable without constructing a three.js texture. Non-deterministic
 * client eyecandy: the noise is a `Math.sin`-hash, not the kernel's seeded
 * PRNG, and carries no save-format contract. */
import type { TilesScene } from '../sim/scene';

/** Cloud texture width, texels — an equirectangular map sized independently
 * of the tile lattice's own resolution. */
export const CLOUD_TEX_W = 1024;
/** Cloud texture height, texels. */
export const CLOUD_TEX_H = 512;

/** One cloud type's visual treatment: base color (0-1 channels), how much
 * of a region fills in once fbm-gated (`coverage`, 0-1), and its noise
 * feature size (`grain` — below 1 reads finer/streakier, above 1 reads
 * broader/smoother). */
export interface CloudStyle {
  color: [number, number, number];
  coverage: number;
  grain: number;
}

/** Per-`cloudType` style table, index-matched to the producer's `CloudType`
 * declaration order (0 None .. 5 Cirrus — see `../sim/scene.ts`'s
 * `TilesScene.cloudType` doc comment). Colors and the density ordering
 * reuse The Firmament WIP's palette (cumulonimbus densest/darkest, cirrus
 * thinnest/palest). Index 0 (None) is never actually noise-sampled
 * (`cloudTextureData` forces it fully transparent outright), but the table
 * stays TOTAL for defensive safety. */
const CLOUD_STYLES: readonly CloudStyle[] = [
  // 0 None — unreachable in practice; present only for totality.
  { color: [0xd8 / 255, 0xe4 / 255, 0xf0 / 255], coverage: 0, grain: 1.0 },
  // 1 Cumulus — fair-weather puffs: bright white, mid coverage, mid grain.
  { color: [0xff / 255, 0xff / 255, 0xfa / 255], coverage: 0.45, grain: 1.0 },
  // 2 Stratus — flat grey overcast sheet: duller, broader (larger grain).
  { color: [0xc9 / 255, 0xcf / 255, 0xd6 / 255], coverage: 0.6, grain: 1.6 },
  // 3 Nimbostratus — rain-bearing overcast: darker grey, dense, broad.
  { color: [0x9a / 255, 0xa2 / 255, 0xac / 255], coverage: 0.72, grain: 1.4 },
  // 4 Cumulonimbus — storm towers: darkest and densest of the six.
  { color: [0x55 / 255, 0x58 / 255, 0x60 / 255], coverage: 0.8, grain: 0.8 },
  // 5 Cirrus — high wispy ice cloud: palest and thinnest, fine streaky grain.
  { color: [0xf5 / 255, 0xf7 / 255, 0xfb / 255], coverage: 0.22, grain: 0.3 },
];

/** The visual style for a `cloudType` index — TOTAL over `0..=5` (every
 * value the wire's `intArrayInRange(..., 0, 5)` parse guard admits). An
 * out-of-range index clamps to Cumulus (index 1, the "ordinary cloud"
 * middle ground), mirroring the existing weather overlay's (`clouds.ts`)
 * `cloudStyleFor` convention. */
export function cloudStyleFor(cloudType: number): CloudStyle {
  const idx =
    Number.isInteger(cloudType) && cloudType >= 0 && cloudType < CLOUD_STYLES.length ? cloudType : 1;
  return CLOUD_STYLES[idx]!;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** `Math.sin`-hash lattice value at integer coordinates `(i, j)`, in
 * `[0, 1)` — eyecandy noise, deliberately not the kernel's seeded PRNG
 * (no determinism contract on this texture). */
function hash(i: number, j: number): number {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Bilinear-interpolated (smoothstep-eased) value noise at `(x, y)`, in
 * `[0, 1)` — the single-octave building block `fbm` sums. */
function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const h00 = hash(xi, yi);
  const h10 = hash(xi + 1, yi);
  const h01 = hash(xi, yi + 1);
  const h11 = hash(xi + 1, yi + 1);
  const top = h00 + u * (h10 - h00);
  const bottom = h01 + u * (h11 - h01);
  return top + v * (bottom - top);
}

/** Octave count `fbm` sums — enough to break up `valueNoise`'s single-scale
 * lattice regularity without costing much at texture resolution. */
const FBM_OCTAVES = 4;

/** Fractal Brownian motion: `FBM_OCTAVES` octaves of `valueNoise`, each
 * halved in amplitude and doubled in frequency, normalized back to
 * `[0, 1)`. THE KEYSTONE MECHANISM: `cloudTextureData` gates alpha against
 * this field's threshold crossing, which is what gives cloud boundaries
 * soft, irregular edges instead of a hard per-tile block. */
function fbm(x: number, y: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let ampTotal = 0;
  for (let o = 0; o < FBM_OCTAVES; o++) {
    sum += amp * valueNoise(x * freq, y * freq);
    ampTotal += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / ampTotal;
}

/** Base noise feature size, texels — `CloudStyle.grain` scales this per
 * cloud type. */
const NOISE_BASE_SCALE = 48;

/** Below this `grain`, the fbm sample is stretched anisotropically along x
 * — cirrus's fine grain then reads as horizontal streaks rather than round
 * blobs, matching real wind-sheared high-altitude ice cloud. */
const STREAK_GRAIN_THRESHOLD = 0.5;

/** How much wider than tall the sampling grid gets once `grain` is below
 * `STREAK_GRAIN_THRESHOLD`. */
const STREAK_STRETCH = 3;

/** How sharply `alpha`'s fbm-vs-coverage-threshold crossing sharpens into
 * an edge. Low enough that the crossing band is genuinely partial-alpha
 * (soft, several texels wide) rather than a one-texel-wide seam — the
 * soft-edge keystone the prior campaign's flat blocks lacked. */
const EDGE_SOFTNESS = 3.2;

/** How much a tile's `weatherPropensity` (0-1) nudges its cloud type's
 * base `coverage` upward — a stormier cell fills in a little more, without
 * overriding the type's own character. */
const PROPENSITY_COVERAGE_BOOST = 0.12;

/** Ceiling on rendered cloud alpha (0-1). Nathan: keep prominence
 * BALANCED — even the densest cumulonimbus stays translucent, the surface
 * must read through the gaps, so this never reaches fully opaque (255). */
const BASE_ALPHA_CAP = 0.82;
/** Floor on rendered cloud alpha once a texel clears the coverage
 * threshold at all. */
const BASE_ALPHA_FLOOR = 0.5;

/** The pure RGBA pixel data (row-major, `CLOUD_TEX_W` x `CLOUD_TEX_H`
 * texels) behind the cloud overlay's `THREE.DataTexture`: an
 * equirectangular map whose alpha is `fbm` gated by each tile's
 * `cloudType` coverage threshold, so cloud edges read soft and irregular
 * rather than as flat per-tile color blocks. `cloudType` 0 (None) is
 * always fully transparent, independent of the noise field. */
export function cloudTextureData(tiles: TilesScene): Uint8ClampedArray {
  const data = new Uint8ClampedArray(CLOUD_TEX_W * CLOUD_TEX_H * 4);
  for (let y = 0; y < CLOUD_TEX_H; y++) {
    const row = Math.min(tiles.height - 1, Math.floor((y / CLOUD_TEX_H) * tiles.height));
    for (let x = 0; x < CLOUD_TEX_W; x++) {
      const col = Math.min(tiles.width - 1, Math.floor((x / CLOUD_TEX_W) * tiles.width));
      const idx = row * tiles.width + col;
      const type = tiles.cloudType[idx]!;
      const i = (y * CLOUD_TEX_W + x) * 4;
      if (type === 0) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
        continue;
      }
      const style = cloudStyleFor(type);
      const propensity = tiles.weatherPropensity[idx]!;
      const coverage = clamp01(style.coverage + propensity * PROPENSITY_COVERAGE_BOOST);
      const scaleY = NOISE_BASE_SCALE * style.grain;
      const scaleX = style.grain < STREAK_GRAIN_THRESHOLD ? scaleY * STREAK_STRETCH : scaleY;
      const n = fbm(x / scaleX, y / scaleY);
      const raw = clamp01((n - (1 - coverage)) * EDGE_SOFTNESS);
      const baseAlpha = BASE_ALPHA_FLOOR + coverage * (BASE_ALPHA_CAP - BASE_ALPHA_FLOOR);
      data[i] = Math.round(style.color[0] * 255);
      data[i + 1] = Math.round(style.color[1] * 255);
      data[i + 2] = Math.round(style.color[2] * 255);
      data[i + 3] = Math.round(raw * baseAlpha * 255);
    }
  }
  return data;
}
