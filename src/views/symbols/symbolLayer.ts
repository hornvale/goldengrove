/** The symbol layer: a `THREE.Group` of sprites (mountain peaks, forest
 * tree-clusters, settlements) placed on the globe, selected per zoom rung
 * against the salience budget (`./budget`), culled to the near hemisphere
 * (`../globe`'s `onNearSide`). This is the visible payoff of The Cartographer.
 *
 * Extraction (`./extract`) runs once at build time — the tile data doesn't
 * change under a mounted layer, only the camera does — so `update` only
 * rebuilds children on a rung boundary crossing and otherwise just re-culls.
 */
import * as THREE from 'three';
import type { TilesScene } from '../../sim/scene';
import { GLOBE_RADIUS, latLonToUnit, onNearSide, clusterFeatures } from '../globe';
import type { Peak, ForestRegion } from './extract';
import { extractForests, extractPeaks } from './extract';
import type { Rung } from './budget';
import { RUNG_BUDGETS, selectByBudget } from './budget';

/** Deterministic [0,1) from an integer — used for the forest-scatter jitter
 * so tree placement never shimmers between identical updates (no
 * `Math.random` anywhere in this module). */
export function hash01(i: number): number {
  let x = (i | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** How far above the globe surface (as a fraction of `GLOBE_RADIUS`, matching
 * `../globe`'s `MARKER_CLEARANCE` idiom) a symbol sprite floats. */
const SYMBOL_CLEARANCE = 1.01;

/** Peak sprite scale bounds, in units of `GLOBE_RADIUS` — a tall peak reads
 * bigger than a modest one, clamped so an extreme elevation never dwarfs the
 * globe. */
const PEAK_SCALE_MIN = 0.02;
const PEAK_SCALE_ELEVATION_FACTOR = 0.00001;
const PEAK_SCALE_MAX = 0.08;

/** Tree/settlement sprite scale, in units of `GLOBE_RADIUS`. */
const TREE_SCALE = 0.018;
const SETTLEMENT_SCALE = 0.02;

/** Max tree sprites drawn per forest region (also clamps the log2(area)
 * placement count below). */
const MAX_TREES_PER_FOREST = 8;

/** Jitter radius (degrees) for tree placement around a forest's centroid. */
const TREE_JITTER_DEG = 1.5;

/** Build a small offscreen-canvas texture for a symbol class, falling back to
 * a flat-colour material when no 2D context is available (jsdom — the unit
 * tests here run headless with no canvas 2D renderer, same guard as
 * `../globe`'s `buildLabelSprite`). */
function buildSymbolMaterial(draw: (ctx: CanvasRenderingContext2D, size: number) => void, fallbackColor: number): THREE.SpriteMaterial {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.SpriteMaterial({ color: fallbackColor });
  }
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  return new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
}

function buildPeakMaterial(): THREE.SpriteMaterial {
  return buildSymbolMaterial((ctx, size) => {
    ctx.fillStyle = '#8c8c96';
    ctx.beginPath();
    ctx.moveTo(size / 2, size * 0.12);
    ctx.lineTo(size * 0.88, size * 0.88);
    ctx.lineTo(size * 0.12, size * 0.88);
    ctx.closePath();
    ctx.fill();
  }, 0x8c8c96);
}

function buildTreeMaterial(): THREE.SpriteMaterial {
  return buildSymbolMaterial((ctx, size) => {
    ctx.fillStyle = '#3f7d3f';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }, 0x3f7d3f);
}

function buildSettlementMaterial(): THREE.SpriteMaterial {
  return buildSymbolMaterial((ctx, size) => {
    ctx.fillStyle = '#e8e0c0';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }, 0xe8e0c0);
}

/** A built sprite tagged with the unit "up" direction it was placed at, so
 * the near-side cull (`onNearSide`) doesn't need to re-derive it from
 * position/GLOBE_RADIUS each frame. */
function placedSprite(material: THREE.SpriteMaterial, lat: number, lon: number, scale: number): THREE.Sprite {
  const sprite = new THREE.Sprite(material);
  const up = latLonToUnit(lat, lon);
  sprite.position.copy(up).multiplyScalar(GLOBE_RADIUS * SYMBOL_CLEARANCE);
  sprite.scale.set(GLOBE_RADIUS * scale, GLOBE_RADIUS * scale, 1);
  sprite.userData.up = up;
  return sprite;
}

/** The symbol layer's public surface: a mountable group plus the per-frame
 * driver the globe view calls with the current rung and camera position. */
export interface SymbolLayer {
  /** The layer's root node — mount this once into the globe's spinning
   * group so symbols turn with the planet. */
  group: THREE.Group;
  /** Rebuilds the child sprite set on a rung boundary crossing (a no-op
   * rebuild otherwise), then re-culls every child to the near hemisphere
   * against `camWorld`. */
  update(rung: Rung, camWorld: THREE.Vector3): void;
  /** Removes every child and disposes the three shared materials/textures. */
  dispose(): void;
}

/** Build the symbol layer for `tiles`: extracts peaks/forests/settlement
 * sites once, builds the three shared sprite materials once, and returns a
 * layer whose `update` rebuilds the (budget-bounded, so cheap) child set
 * only when the rung actually changes. */
export function buildSymbolLayer(tiles: TilesScene): SymbolLayer {
  const peaks: Peak[] = extractPeaks(tiles);
  const forests: ForestRegion[] = extractForests(tiles);
  const sites = clusterFeatures(tiles.features);

  const peakMaterial = buildPeakMaterial();
  const treeMaterial = buildTreeMaterial();
  const settlementMaterial = buildSettlementMaterial();

  const group = new THREE.Group();
  group.name = 'symbol-layer';

  let lastRung: Rung | null = null;

  function rebuild(rung: Rung): void {
    while (group.children.length > 0) group.remove(group.children[0]!);
    const b = RUNG_BUDGETS[rung];

    const chosenPeaks = selectByBudget(peaks.filter((p) => p.elevationM >= b.peakMinElevationM), b.peaks);
    for (const p of chosenPeaks) {
      const scale = Math.min(PEAK_SCALE_MAX, PEAK_SCALE_MIN + PEAK_SCALE_ELEVATION_FACTOR * p.elevationM);
      group.add(placedSprite(peakMaterial, p.lat, p.lon, scale));
    }

    const chosenForests = selectByBudget(forests.filter((f) => f.area >= b.forestMinArea), b.forests);
    for (const f of chosenForests) {
      const n = Math.min(MAX_TREES_PER_FOREST, Math.max(1, Math.round(Math.log2(f.area + 1))));
      for (let k = 0; k < n; k++) {
        const hLat = hash01(f.tileIndex * 8 + k);
        const hLon = hash01(f.tileIndex * 8 + k + 4);
        const lat = f.lat + (hLat * 2 - 1) * TREE_JITTER_DEG;
        const lon = f.lon + (hLon * 2 - 1) * TREE_JITTER_DEG;
        group.add(placedSprite(treeMaterial, lat, lon, TREE_SCALE));
      }
    }

    for (const site of sites) {
      group.add(placedSprite(settlementMaterial, site.latitude, site.longitude, SETTLEMENT_SCALE));
    }
  }

  function update(rung: Rung, camWorld: THREE.Vector3): void {
    if (rung !== lastRung) {
      rebuild(rung);
      lastRung = rung;
    }
    for (const child of group.children) {
      const up = child.userData.up as THREE.Vector3 | undefined;
      if (up) child.visible = onNearSide(up, camWorld, GLOBE_RADIUS);
    }
  }

  function dispose(): void {
    while (group.children.length > 0) group.remove(group.children[0]!);
    for (const material of [peakMaterial, treeMaterial, settlementMaterial]) {
      material.map?.dispose();
      material.dispose();
    }
  }

  return { group, update, dispose };
}
