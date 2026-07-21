/** The flat map's symbol overlay: peaks/forests/waves as plain 2D sprites
 * sitting on the flat pixel-art quad (`./mapView`). Unlike the globe's
 * `./symbols/symbolLayer`, a flat plane needs no billboarding, no limb cull,
 * and no sphere distortion — every sprite just sits at a fixed (x, y, z) over
 * the quad and always faces the map's orthographic camera trivially. This
 * reuses the same extraction (`./symbols/extract`), budget (`./symbols/
 * budget`), and sprite-glyph builders (`./symbols/sprites`) as the globe
 * layer, so the two rungs render identical iconography.
 *
 * `extractPeaks`/`extractForests` read lat/lon off a `TilesScene`-shaped
 * grid, which the flat map has no use for (a region has no globe
 * coordinates) — but they also read `tileIndex = y*width+x`, which is all
 * this module needs to recover a region's grid (gx, gy). So a `RegionScene`
 * is wrapped in a `TilesScene`-shaped shim (width/height = `samples+1`) purely
 * to reuse the row-major connected-component/local-maximum algorithms; the
 * lat/lon fields the shim's callers compute are simply discarded here. */
import * as THREE from 'three';
import type { RegionScene, TilesScene } from '../sim/scene';
import type { ForestRegion, Peak } from './symbols/extract';
import { extractForests, extractPeaks } from './symbols/extract';
import type { Rung } from './symbols/budget';
import { RUNG_BUDGETS, selectByBudget } from './symbols/budget';
import {
  buildCactusMaterial,
  buildMushroomMaterial,
  buildPeakMaterial,
  buildTreeMaterial,
  buildVolcanoMaterial,
  buildWaveMaterial,
  hash01,
} from './symbols/sprites';

/** Sprite scale, as a fraction of the map quad's 2-unit span (`x,y ∈
 * [-1, 1]`) — small and fixed; unlike the globe, flat symbols carry no
 * elevation-proportional scaling. */
const SPRITE_SCALE = 0.06;

/** Sprite z — just off the quad's z=0 plane so symbols render in front of it
 * without needing depth-sorting tricks. */
const SYMBOL_Z = 1;

/** Max tree sprites drawn per forest region (also clamps the log2(area)
 * placement count below), matching the globe layer's convention. */
const MAX_TREES_PER_FOREST = 8;

/** Jitter radius, in grid cells, for tree placement around a forest's
 * representative node — small enough that a cluster reads as one region. */
const TREE_JITTER_CELLS = 0.8;

/** Unrest (0..1-ish) above which a high peak reads as a live volcano rather
 * than a plain mountain. */
const ICON_VOLCANO_UNREST = 0.7;

/** Elevation (m) above which a high-unrest node reads as a volcano's peak
 * rather than mere tectonic tremor at low ground. */
const ICON_VOLCANO_ELEVATION_M = 2000;

/** Only every Nth qualifying node gets a biome-signature icon, so a broad
 * desert or rainforest biome doesn't carpet the map in glyphs — spacing is a
 * fixed grid-order stride, deterministic and never `Math.random`. */
const ICON_STRIDE = 6;

/** Hard cap on biome-signature icon sprites per rebuild, regardless of
 * stride — keeps the near rung tasteful even over a biome-dense region. */
const MAX_ICONS = 40;

/** A biome-signature icon a region node may warrant, or `null` for none. */
export type BiomeIcon = 'volcano' | 'cactus' | 'mushroom' | null;

/** The biome-signature icon node `i` of `region` warrants, or `null`.
 * Deterministic and datum-driven: ocean nodes never qualify; a fiery
 * high-unrest peak wins as the rarest/most salient signature (checked
 * first), then desert/rainforest biome names. */
export function iconForNode(region: RegionScene, i: number): BiomeIcon {
  if (region.ocean[i]) return null;
  if ((region.unrest[i] ?? 0) >= ICON_VOLCANO_UNREST && (region.elevation_m[i] ?? 0) >= ICON_VOLCANO_ELEVATION_M) {
    return 'volcano';
  }
  const biomeName = region.biomeLegend[region.biome[i] ?? -1];
  if (biomeName === 'desert') return 'cactus';
  if (biomeName === 'temperate-rainforest' || biomeName === 'tropical-rainforest') return 'mushroom';
  return null;
}

/** Wrap `region` in a `TilesScene`-shaped shim so `extractPeaks`/
 * `extractForests` can run their row-major grid algorithms over it. Only the
 * fields those functions actually read (`width`, `height`, `elevation_m`,
 * `ocean`, `biome`, `biomeLegend`) are populated; the shim is never used as a
 * real `TilesScene` beyond that. */
function toGridShim(region: RegionScene): TilesScene {
  const dim = region.samples + 1;
  return {
    width: dim,
    height: dim,
    elevation_m: region.elevation_m,
    ocean: region.ocean,
    biome: region.biome,
    biomeLegend: region.biomeLegend,
  } as unknown as TilesScene;
}

/** Map a region grid node (gx, gy) to the map quad's world (x, y) — quad
 * spans `[-1, 1]` on both axes, node (0,0) at the top-left. Starting
 * convention (Task 8); verify against a visual pass once the map rung is
 * driven live. */
function gridToWorld(gx: number, gy: number, dim: number): { x: number; y: number } {
  return { x: -1 + (2 * (gx + 0.5)) / dim, y: 1 - (2 * (gy + 0.5)) / dim };
}

/** The flat map's symbol overlay public surface. */
export interface MapSymbols {
  /** The overlay's root node — mount this into the map scene alongside the
   * textured quad. */
  group: THREE.Group;
  /** Rebuild the symbol set for `rung`: reruns budget selection and
   * repositions 2D sprites on the flat map. */
  update(rung: Rung): void;
  /** Removes every child and disposes the shared materials/textures. */
  dispose(): void;
}

/** Build the flat map's symbol overlay for `region`: extracts peaks/forests
 * once, builds the shared sprite materials once (reused from the globe's
 * `./symbols/sprites`), and returns an overlay whose `update` rebuilds the
 * (budget-bounded, so cheap) child set for the given rung. */
export function buildMapSymbols(region: RegionScene): MapSymbols {
  const dim = region.samples + 1;
  const tiles = toGridShim(region);
  const peaks: Peak[] = extractPeaks(tiles);
  const forests: ForestRegion[] = extractForests(tiles);

  const peakMaterial = buildPeakMaterial();
  const treeMaterial = buildTreeMaterial();
  const waveMaterial = buildWaveMaterial();
  const volcanoMaterial = buildVolcanoMaterial();
  const cactusMaterial = buildCactusMaterial();
  const mushroomMaterial = buildMushroomMaterial();

  const group = new THREE.Group();
  group.name = 'map-symbols';

  function place(
    material: THREE.SpriteMaterial,
    gx: number,
    gy: number,
    kind: 'peak' | 'tree' | 'wave' | 'icon',
    icon?: BiomeIcon,
  ): void {
    const sprite = new THREE.Sprite(material);
    const { x, y } = gridToWorld(gx, gy, dim);
    sprite.position.set(x, y, SYMBOL_Z);
    sprite.scale.set(SPRITE_SCALE, SPRITE_SCALE, 1);
    sprite.userData.kind = kind;
    if (icon) sprite.userData.icon = icon;
    group.add(sprite);
  }

  function materialForIcon(icon: BiomeIcon): THREE.SpriteMaterial {
    switch (icon) {
      case 'volcano':
        return volcanoMaterial;
      case 'cactus':
        return cactusMaterial;
      case 'mushroom':
        return mushroomMaterial;
      case null:
        // Unreachable at call sites (guarded by iconForNode's non-null
        // check), but exhaustive switches keep this safe under refactor.
        return peakMaterial;
    }
  }

  function gridOf(tileIndex: number): { gx: number; gy: number } {
    const gx = tileIndex % dim;
    const gy = (tileIndex - gx) / dim;
    return { gx, gy };
  }

  function update(rung: Rung): void {
    while (group.children.length > 0) group.remove(group.children[0]!);
    const b = RUNG_BUDGETS[rung];

    const chosenPeaks = selectByBudget(peaks.filter((p) => p.elevationM >= b.peakMinElevationM), b.peaks);
    for (const p of chosenPeaks) {
      const { gx, gy } = gridOf(p.tileIndex);
      place(peakMaterial, gx, gy, 'peak');
    }

    const chosenForests = selectByBudget(forests.filter((f) => f.area >= b.forestMinArea), b.forests);
    for (const f of chosenForests) {
      const { gx: fgx, gy: fgy } = gridOf(f.tileIndex);
      const n = Math.min(MAX_TREES_PER_FOREST, Math.max(1, Math.round(Math.log2(f.area + 1))));
      for (let k = 0; k < n; k++) {
        const hX = hash01(f.tileIndex * 8 + k);
        const hY = hash01(f.tileIndex * 8 + k + 4);
        const gx = fgx + (hX * 2 - 1) * TREE_JITTER_CELLS;
        const gy = fgy + (hY * 2 - 1) * TREE_JITTER_CELLS;
        place(treeMaterial, gx, gy, 'tree');
      }
    }

    // Wave marks: sparse cartographic sea-texture, gated by the rung's
    // stride/cap. Deterministic grid walk — no jitter, no Math.random.
    let waveCount = 0;
    waveScan: for (let gy = 0; gy < dim; gy += b.waveStride) {
      for (let gx = 0; gx < dim; gx += b.waveStride) {
        if (waveCount >= b.waves) break waveScan;
        if (!region.ocean[gy * dim + gx]) continue;
        place(waveMaterial, gx, gy, 'wave');
        waveCount++;
      }
    }

    // Biome-signature icons (volcano/cactus/mushroom): a closest-detail tier
    // only, so a zoomed-out map isn't cluttered with glyphs finer than the
    // peak/forest symbols already carry. Deterministic grid-order stride
    // thins a dense biome down to a readable scatter; no `Math.random`.
    if (rung === 'near') {
      let qualifying = 0;
      let iconCount = 0;
      for (let i = 0; i < dim * dim && iconCount < MAX_ICONS; i++) {
        const icon = iconForNode(region, i);
        if (!icon) continue;
        const take = qualifying % ICON_STRIDE === 0;
        qualifying++;
        if (!take) continue;
        const { gx, gy } = gridOf(i);
        place(materialForIcon(icon), gx, gy, 'icon', icon);
        iconCount++;
      }
    }
  }

  function dispose(): void {
    while (group.children.length > 0) group.remove(group.children[0]!);
    for (const material of [peakMaterial, treeMaterial, waveMaterial, volcanoMaterial, cactusMaterial, mushroomMaterial]) {
      material.map?.dispose();
      material.dispose();
    }
  }

  return { group, update, dispose };
}
