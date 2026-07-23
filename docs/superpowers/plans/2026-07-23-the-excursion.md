# The Excursion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real pan/zoom camera controls for the Orrery's Map rung, backed by a same-face neighbor-tile ring so panning reveals real terrain instead of void, plus removing the flat map's ocean wave sprites.

**Architecture:** A new pure module (`mapRing.ts`) does all tile-address/offset/hysteresis math with no THREE.js or network dependency. `mapView.ts` grows a `Map<string, THREE.Mesh>` of mounted ring tiles (replacing its single `mesh` variable), an internal `regionCache`/`regionPending`, and a `MapControls` instance; it exposes `beginRegion(tile)` (start a fresh ring fetch) and `onRegion(key, region)` (route a worker reply) alongside its existing `setRegion`/`setStyle`/`render`/`dispose`. `main.ts` wires its existing `requestRegion`/worker-reply plumbing to the new API, replacing the single-key `pendingMapKey` special case.

**Tech Stack:** TypeScript, Three.js 0.166 (`MapControls` from `three/addons/controls/MapControls.js`), Vitest, Playwright.

## Global Constraints

- No wasm/producer changes — `tiles_region_scene` already accepts every address this campaign requests; do not touch `public/hornvale_world.wasm` or `CATALOG_VERSION`.
- No `Math.random` anywhere (project-wide determinism convention carried over from the sim side) — all math here is either literal user input (drag/wheel) or deterministic address arithmetic, so this is naturally satisfied; don't introduce randomness for tie-breaking or jitter.
- Cross-face-boundary panning is explicitly out of scope — every function operates on same-face addresses only, and face-edge conditions clamp rather than attempt a cross-face request.
- `npm test` = `vitest run`; `npm run build` = `tsc --noEmit && vite build`; `npm run e2e` = `playwright test --grep-invert @perf`. Run `npm test` after every task; run `npm run build` and `npm run e2e` at minimum after Task 4 and again at the end.
- First-pass tunable constants (ring radius, cache halo radius, hysteresis fraction, zoom bounds) are named exports, matching every existing constant in `mapView.ts` (`MAP_VOXEL_EXTENT`, `MAP_VOXEL_HEIGHT_SCALE`, etc.) — exact values are the plan's first-pass choice, not a placeholder; retuning later means changing one named constant, not restructuring code.

---

### Task 1: Remove the flat map's ocean wave symbols

**Files:**
- Modify: `src/views/symbols/sprites.ts` (delete `buildWaveMaterial`)
- Modify: `src/views/symbols/budget.ts` (delete `waveStride`/`waves` fields)
- Modify: `src/views/mapSymbols.ts` (delete wave placement/dispose/import, drop `'wave'` from `place()`'s `kind` union)
- Modify: `src/views/mapSymbols.test.ts` (delete the wave test)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this is pure deletion. No other file imports `buildWaveMaterial` or reads `RungBudget.waves`/`waveStride` (verified: `grep -rn "buildWaveMaterial\|waveStride\|\.waves\b" src` outside these three files returns nothing).

- [ ] **Step 1: Delete the failing-first assertion — remove the wave test**

In `src/views/mapSymbols.test.ts`, delete this entire test (lines 29-39):

```ts
test('all-ocean region places wave-marks at near', () => {
  const s = 8, dim = s + 1, n = dim * dim;
  const r = { schema: 'scene/tiles-region/v1', seed: 42, face: 0, level: 3, ix: 0, iy: 0,
    samples: s, sea_level_m: 0, season_period_days: 360, circulationBands: 3,
    biomeLegend: ['deep-ocean'], elevation_m: Array.from({length:n},()=>-1000),
    ocean: Array.from({length:n},()=>true), biome: Array.from({length:n},()=>0),
    plate: Array.from({length:n},()=>0), unrest: Array.from({length:n},()=>0) } as unknown as RegionScene;
  const m = buildMapSymbols(r);
  m.update('near');
  expect(m.group.children.filter((c) => c.userData.kind === 'wave').length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests to confirm the file still compiles and passes without it**

Run: `npm test -- mapSymbols`
Expected: PASS (3 remaining tests in the file) — this step just confirms the deletion alone doesn't break anything before touching the source.

- [ ] **Step 3: Remove `buildWaveMaterial` from `sprites.ts`**

In `src/views/symbols/sprites.ts`, delete this function (currently lines 75-96):

```ts
/** Stylized `~~` wave-mark texture for ocean tiles — two short wavy strokes
 * in light cyan, matching the pixel-art-RPG convention for open sea. */
export function buildWaveMaterial(): THREE.SpriteMaterial {
  return buildSymbolMaterial((ctx, size) => {
    ctx.lineCap = 'round';
    const drawWave = (yBase: number, style: string, width: number): void => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(size * 0.08, yBase);
      ctx.quadraticCurveTo(size * 0.3, yBase - size * 0.1, size * 0.5, yBase);
      ctx.quadraticCurveTo(size * 0.7, yBase + size * 0.1, size * 0.92, yBase);
      ctx.stroke();
    };
    // A darker halo first, then a bright stroke on top — reads on both the
    // light shallows and the deep ocean.
    for (const y of [size * 0.4, size * 0.64]) {
      drawWave(y, 'rgba(20,52,96,0.55)', size * 0.22);
      drawWave(y, 'rgba(238,250,255,0.95)', size * 0.12);
    }
  }, 0xe8f6ff);
}
```

- [ ] **Step 4: Remove the wave fields from `budget.ts`**

In `src/views/symbols/budget.ts`, change:

```ts
export interface RungBudget {
  /** Max number of peak symbols to show at this rung. */
  peaks: number;
  /** Max number of forest symbols to show at this rung. */
  forests: number;
  /** Minimum elevation (m) a peak must have to be eligible at this rung. */
  peakMinElevationM: number;
  /** Minimum area a forest patch must have to be eligible at this rung. */
  forestMinArea: number;
  /** Tile-grid stride between candidate ocean wave-marks at this rung (bigger
   * = sparser scatter). */
  waveStride: number;
  /** Max number of wave-mark symbols to show at this rung. */
  waves: number;
}

// Visual-pass-tuned. Thresholds fall and budgets rise as we zoom in, so finer
// features emerge. Angular radius (rad) of the visible cap drives the rung.
export const RUNG_BUDGETS: Record<Rung, RungBudget> = {
  far: { peaks: 16, forests: 12, peakMinElevationM: 3000, forestMinArea: 60, waveStride: 14, waves: 40 },
  mid: { peaks: 55, forests: 45, peakMinElevationM: 1500, forestMinArea: 15, waveStride: 11, waves: 85 },
  near: { peaks: 150, forests: 120, peakMinElevationM: 500, forestMinArea: 3, waveStride: 8, waves: 170 },
};
```

to:

```ts
export interface RungBudget {
  /** Max number of peak symbols to show at this rung. */
  peaks: number;
  /** Max number of forest symbols to show at this rung. */
  forests: number;
  /** Minimum elevation (m) a peak must have to be eligible at this rung. */
  peakMinElevationM: number;
  /** Minimum area a forest patch must have to be eligible at this rung. */
  forestMinArea: number;
}

// Visual-pass-tuned. Thresholds fall and budgets rise as we zoom in, so finer
// features emerge. Angular radius (rad) of the visible cap drives the rung.
export const RUNG_BUDGETS: Record<Rung, RungBudget> = {
  far: { peaks: 16, forests: 12, peakMinElevationM: 3000, forestMinArea: 60 },
  mid: { peaks: 55, forests: 45, peakMinElevationM: 1500, forestMinArea: 15 },
  near: { peaks: 150, forests: 120, peakMinElevationM: 500, forestMinArea: 3 },
};
```

- [ ] **Step 5: Remove wave placement from `mapSymbols.ts`**

In `src/views/mapSymbols.ts`, remove `buildWaveMaterial` from the import list (currently):

```ts
import {
  buildCactusMaterial,
  buildMushroomMaterial,
  buildPeakMaterial,
  buildTreeMaterial,
  buildVolcanoMaterial,
  buildWaveMaterial,
  hash01,
} from './symbols/sprites';
```

to:

```ts
import {
  buildCactusMaterial,
  buildMushroomMaterial,
  buildPeakMaterial,
  buildTreeMaterial,
  buildVolcanoMaterial,
  hash01,
} from './symbols/sprites';
```

Change `place()`'s `kind` parameter type from:

```ts
  function place(
    material: THREE.SpriteMaterial,
    gx: number,
    gy: number,
    kind: 'peak' | 'tree' | 'wave' | 'icon',
    icon?: BiomeIcon,
  ): void {
```

to:

```ts
  function place(
    material: THREE.SpriteMaterial,
    gx: number,
    gy: number,
    kind: 'peak' | 'tree' | 'icon',
    icon?: BiomeIcon,
  ): void {
```

Delete the `waveMaterial` construction line:

```ts
  const waveMaterial = buildWaveMaterial();
```

Delete the wave-placement block from `update()`:

```ts
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
```

Remove `waveMaterial` from the dispose list:

```ts
  function dispose(): void {
    while (group.children.length > 0) group.remove(group.children[0]!);
    for (const material of [peakMaterial, treeMaterial, waveMaterial, volcanoMaterial, cactusMaterial, mushroomMaterial]) {
      material.map?.dispose();
      material.dispose();
    }
  }
```

becomes:

```ts
  function dispose(): void {
    while (group.children.length > 0) group.remove(group.children[0]!);
    for (const material of [peakMaterial, treeMaterial, volcanoMaterial, cactusMaterial, mushroomMaterial]) {
      material.map?.dispose();
      material.dispose();
    }
  }
```

- [ ] **Step 6: Run the full unit suite and typecheck**

Run: `npm test 2>&1 | tail -20`
Expected: all test files pass (one fewer test than baseline: 558, was 559).

Run: `npm run build`
Expected: clean (no unused-import errors for `buildWaveMaterial`/`waveStride`/`waves`).

- [ ] **Step 7: Commit**

```bash
git add src/views/symbols/sprites.ts src/views/symbols/budget.ts src/views/mapSymbols.ts src/views/mapSymbols.test.ts
git commit -m "feat(map): remove the flat map's ocean wave sprites

The Overworld's crafted coastlines (shallows/outline/foam) already carry
the ocean edge visually; the sprite waves were a second, clashing
treatment of the same thing."
```

---

### Task 2: Pure ring/offset/hysteresis math (`mapRing.ts`)

**Files:**
- Create: `src/views/mapRing.ts`
- Test: `src/views/mapRing.test.ts`

**Interfaces:**
- Consumes: `TileId` from `./cubeSphere` (`{ face: number; level: number; ix: number; iy: number }`).
- Produces (used by Task 3): `TileOffset { dx: number; dy: number }`, `sameFaceOffset(addr: TileId, from: TileId): TileOffset | null`, `withinChebyshev(addr: TileId, center: TileId, radius: number): boolean`, `ringAddresses(center: TileId, radius: number): TileId[]`, `TileBounds { minDx: number; maxDx: number; minDy: number; maxDy: number }`, `panBoundsInTiles(centerAddr: TileId, originAddr: TileId, radius: number): TileBounds`, `recenterTarget(originAddr: TileId, centerAddr: TileId, localX: number, localY: number, hysteresisFraction: number): TileId | null`.

- [ ] **Step 1: Write the failing tests**

Create `src/views/mapRing.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  panBoundsInTiles,
  recenterTarget,
  ringAddresses,
  sameFaceOffset,
  withinChebyshev,
} from './mapRing';
import type { TileId } from './cubeSphere';

const CENTER: TileId = { face: 0, level: 3, ix: 4, iy: 4 };

describe('sameFaceOffset', () => {
  test('same face/level: returns the (dx, dy) offset', () => {
    expect(sameFaceOffset({ face: 0, level: 3, ix: 5, iy: 3 }, CENTER)).toEqual({ dx: 1, dy: -1 });
  });

  test('different face: null', () => {
    expect(sameFaceOffset({ face: 1, level: 3, ix: 4, iy: 4 }, CENTER)).toBeNull();
  });

  test('different level: null', () => {
    expect(sameFaceOffset({ face: 0, level: 2, ix: 4, iy: 4 }, CENTER)).toBeNull();
  });
});

describe('withinChebyshev', () => {
  test('a diagonal neighbor at radius 1 is within radius 1', () => {
    expect(withinChebyshev({ face: 0, level: 3, ix: 5, iy: 5 }, CENTER, 1)).toBe(true);
  });

  test('two tiles away on one axis is outside radius 1', () => {
    expect(withinChebyshev({ face: 0, level: 3, ix: 6, iy: 4 }, CENTER, 1)).toBe(false);
  });

  test('a different face is never within radius, regardless of ix/iy', () => {
    expect(withinChebyshev({ face: 1, level: 3, ix: 4, iy: 4 }, CENTER, 5)).toBe(false);
  });
});

describe('ringAddresses', () => {
  test('radius 0 is just the center tile', () => {
    expect(ringAddresses(CENTER, 0)).toEqual([CENTER]);
  });

  test('radius 1 away from any face edge is the full 3x3 (9 tiles)', () => {
    expect(ringAddresses(CENTER, 1)).toHaveLength(9);
  });

  test('radius 1 at ix=0 (a face edge) clamps: no ix=-1 column, so 6 tiles not 9', () => {
    const edge: TileId = { face: 0, level: 3, ix: 0, iy: 4 };
    const ring = ringAddresses(edge, 1);
    expect(ring).toHaveLength(6);
    expect(ring.every((t) => t.ix >= 0)).toBe(true);
  });

  test('radius 1 at the ix=0,iy=0 corner clamps both axes: 4 tiles not 9', () => {
    const corner: TileId = { face: 0, level: 3, ix: 0, iy: 0 };
    const ring = ringAddresses(corner, 1);
    expect(ring).toHaveLength(4);
    expect(ring.every((t) => t.ix >= 0 && t.iy >= 0)).toBe(true);
  });

  test('radius 1 at the far edge (ix = 2^level - 1) clamps the top end too', () => {
    const span = 1 << 3; // level 3 → 8 tiles per side
    const edge: TileId = { face: 0, level: 3, ix: span - 1, iy: 4 };
    const ring = ringAddresses(edge, 1);
    expect(ring.every((t) => t.ix < span)).toBe(true);
    expect(ring).toHaveLength(6);
  });
});

describe('panBoundsInTiles', () => {
  test('at the origin tile, away from any face edge, bounds are symmetric ±radius', () => {
    const b = panBoundsInTiles(CENTER, CENTER, 1);
    expect(b).toEqual({ minDx: -1, maxDx: 1, minDy: -1, maxDy: 1 });
  });

  test('after a recenter one tile east, bounds shift with it (origin-relative)', () => {
    const newCenter: TileId = { face: 0, level: 3, ix: 5, iy: 4 };
    const b = panBoundsInTiles(newCenter, CENTER, 1);
    expect(b).toEqual({ minDx: 0, maxDx: 2, minDy: -1, maxDy: 1 });
  });

  test('near a face edge, bounds clamp rather than extending past it', () => {
    const edgeOrigin: TileId = { face: 0, level: 3, ix: 0, iy: 4 };
    const b = panBoundsInTiles(edgeOrigin, edgeOrigin, 1);
    expect(b.minDx).toBe(0); // can't go past ix=0
    expect(b.maxDx).toBe(1);
  });
});

describe('recenterTarget', () => {
  test('within the hysteresis margin of center: no recenter', () => {
    expect(recenterTarget(CENTER, CENTER, 0.4, 0, 0.1)).toBeNull();
  });

  test('past the boundary but within the hysteresis margin: no recenter yet', () => {
    expect(recenterTarget(CENTER, CENTER, 0.55, 0, 0.1)).toBeNull();
  });

  test('solidly past the +X boundary (beyond 0.5 + margin): recenters east', () => {
    const next = recenterTarget(CENTER, CENTER, 0.65, 0, 0.1);
    expect(next).toEqual({ face: 0, level: 3, ix: 5, iy: 4 });
  });

  test('solidly past the -Y boundary: recenters in -iy', () => {
    const next = recenterTarget(CENTER, CENTER, 0, -0.65, 0.1);
    expect(next).toEqual({ face: 0, level: 3, ix: 4, iy: 3 });
  });

  test('at a face edge, recentering off the edge is refused (returns null)', () => {
    const edge: TileId = { face: 0, level: 3, ix: 0, iy: 4 };
    expect(recenterTarget(edge, edge, -0.65, 0, 0.1)).toBeNull();
  });

  test('recenter is evaluated relative to the CURRENT center, not the origin', () => {
    // Origin still at CENTER (4,4); we already recentered once to (5,4) and
    // the camera has drifted a further 0.65 tiles east of THAT.
    const currentCenter: TileId = { face: 0, level: 3, ix: 5, iy: 4 };
    const next = recenterTarget(CENTER, currentCenter, 1.65, 0, 0.1);
    expect(next).toEqual({ face: 0, level: 3, ix: 6, iy: 4 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- mapRing`
Expected: FAIL — `Cannot find module './mapRing'` (the file doesn't exist yet).

- [ ] **Step 3: Implement `mapRing.ts`**

Create `src/views/mapRing.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- mapRing`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
git add src/views/mapRing.ts src/views/mapRing.test.ts
git commit -m "feat(map): add mapRing — pure same-face tile-ring address math

Neighbor-tile selection, face-edge clamping, pan bounds, and recenter
hysteresis, all as plain data transforms with no THREE.js or network
dependency. Consumed by mapView.ts's ring-loading (next task)."
```

---

### Task 3: Multi-tile ring mount/cache/dispose in `mapView.ts`

**Files:**
- Modify: `src/views/mapView.ts`
- Modify: `src/views/mapView.test.ts` (add ring tests; existing tests must keep passing unchanged)

**Interfaces:**
- Consumes: `TileId`, `tileKey`, `sameFaceOffset`, `withinChebyshev`, `ringAddresses` from `./mapRing`/`./cubeSphere` (Task 2). `RegionScene` from `../sim/scene` (unchanged).
- Produces (used by Task 4): `createMapView(options?: { requestRegion?: (tile: TileId) => void }): MapView`, where `MapView` gains `beginRegion(tile: TileId): void` and `onRegion(key: string, region: RegionScene): void`, alongside the existing `scene`, `camera`, `setRegion`, `setStyle`, `render`, `dispose`.

This task does **not** touch the camera (no `MapControls` yet — that's Task 5). It only generalizes mounting from "one mesh at local origin" to "a `Map` of meshes at their `(Δix, Δiy)` offsets," reachable either via the existing `setRegion` (unchanged behavior: mount exactly one tile at the origin, no network) or the new `beginRegion`/`onRegion` pair (network-backed ring fetch).

- [ ] **Step 1: Write the failing tests**

Add to `src/views/mapView.test.ts` (after the existing imports, add `TileId` and the ring-radius constant; the existing `fakeRegion` helper and all existing tests stay exactly as they are):

```ts
import type { TileId } from "./cubeSphere";
import { tileKey } from "./cubeSphere";
```

Add this new `describe` block at the end of the file:

```ts
describe("neighbor-tile ring (The Excursion)", () => {
  function fakeRegionAt(tile: TileId, samples = 4): RegionScene {
    const n = (samples + 1) * (samples + 1);
    return {
      schema: "scene/tiles-region/v1",
      seed: 42,
      face: tile.face,
      level: tile.level,
      ix: tile.ix,
      iy: tile.iy,
      samples,
      sea_level_m: 0,
      season_period_days: 360,
      circulationBands: 3,
      biomeLegend: ["deep-ocean", "temperate-forest"],
      elevation_m: Array.from({ length: n }, () => 100),
      ocean: Array.from({ length: n }, () => false),
      biome: Array.from({ length: n }, () => 1),
      plate: Array.from({ length: n }, () => 0),
      unrest: Array.from({ length: n }, () => 0),
    } as unknown as RegionScene;
  }

  const CENTER: TileId = { face: 0, level: 3, ix: 4, iy: 4 };

  test("beginRegion requests the full radius-1 ring (9 tiles) eagerly, up front", () => {
    const requested: TileId[] = [];
    const v = createMapView({ requestRegion: (t) => requested.push(t) });
    v.beginRegion(CENTER);
    expect(requested).toHaveLength(9);
    expect(requested.map(tileKey).sort()).toContain(tileKey(CENTER));
  });

  test("onRegion mounts each arriving ring tile at its own offset; only 1 mesh until neighbors arrive", () => {
    const v = createMapView({ requestRegion: () => {} });
    v.beginRegion(CENTER);
    const meshCount = () => v.scene.children.filter((c) => c instanceof THREE.Mesh).length;
    v.onRegion(tileKey(CENTER), fakeRegionAt(CENTER));
    expect(meshCount()).toBe(1);
    const east: TileId = { face: 0, level: 3, ix: 5, iy: 4 };
    v.onRegion(tileKey(east), fakeRegionAt(east));
    expect(meshCount()).toBe(2);
  });

  test("mounted ring tiles sit at distinct world positions, offset by tile extent", () => {
    const v = createMapView({ requestRegion: () => {} });
    v.beginRegion(CENTER);
    v.onRegion(tileKey(CENTER), fakeRegionAt(CENTER));
    const east: TileId = { face: 0, level: 3, ix: 5, iy: 4 };
    v.onRegion(tileKey(east), fakeRegionAt(east));
    const meshes = v.scene.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    const xs = meshes.map((m) => m.position.x).sort((a, b) => a - b);
    expect(xs[1]! - xs[0]!).toBeCloseTo(MAP_VOXEL_EXTENT);
  });

  test("a reply for a tile outside the current halo is dropped, not mounted or cached", () => {
    const v = createMapView({ requestRegion: () => {} });
    v.beginRegion(CENTER);
    const meshCount = () => v.scene.children.filter((c) => c instanceof THREE.Mesh).length;
    const farAway: TileId = { face: 0, level: 3, ix: 4, iy: 7 }; // 3 tiles away > halo radius 2
    v.onRegion(tileKey(farAway), fakeRegionAt(farAway));
    expect(meshCount()).toBe(0);
  });

  test("a genuine region change (beginRegion again) clears every previously mounted tile", () => {
    const v = createMapView({ requestRegion: () => {} });
    v.beginRegion(CENTER);
    v.onRegion(tileKey(CENTER), fakeRegionAt(CENTER));
    expect(v.scene.children.filter((c) => c instanceof THREE.Mesh)).toHaveLength(1);
    const elsewhere: TileId = { face: 2, level: 3, ix: 1, iy: 1 };
    v.beginRegion(elsewhere);
    expect(v.scene.children.filter((c) => c instanceof THREE.Mesh)).toHaveLength(0);
    v.onRegion(tileKey(elsewhere), fakeRegionAt(elsewhere));
    expect(v.scene.children.filter((c) => c instanceof THREE.Mesh)).toHaveLength(1);
  });

  test("setStyle rebuilds every currently-mounted ring tile from cache, no new requests", () => {
    const requested: TileId[] = [];
    const v = createMapView({ requestRegion: (t) => requested.push(t) });
    v.beginRegion(CENTER);
    const east: TileId = { face: 0, level: 3, ix: 5, iy: 4 };
    v.onRegion(tileKey(CENTER), fakeRegionAt(CENTER));
    v.onRegion(tileKey(east), fakeRegionAt(east));
    const requestedBefore = requested.length;
    v.setStyle("pixel");
    expect(requested.length).toBe(requestedBefore); // no new fetches
    const meshes = v.scene.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    expect(meshes).toHaveLength(2);
    expect(meshes.every((m) => m.geometry instanceof THREE.PlaneGeometry)).toBe(true);
  });

  test("only the center tile carries the symbol overlay, never a neighbor", () => {
    const v = createMapView({ requestRegion: () => {} });
    v.setStyle("pixel");
    v.beginRegion(CENTER);
    v.onRegion(tileKey(CENTER), fakeRegionAt(CENTER));
    const east: TileId = { face: 0, level: 3, ix: 5, iy: 4 };
    v.onRegion(tileKey(east), fakeRegionAt(east));
    const symbolGroups = v.scene.children.filter((c) => c.name === "map-symbols");
    expect(symbolGroups).toHaveLength(1);
  });
});
```

Also add the `MAP_VOXEL_EXTENT` import to the top of the test file (alongside the existing `ISO_CAMERA_DISTANCE` import):

```ts
import { createMapView, ISO_CAMERA_DISTANCE, MAP_VOXEL_EXTENT } from "./mapView";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- mapView`
Expected: FAIL — `v.beginRegion is not a function` (doesn't exist yet).

- [ ] **Step 3: Implement the ring in `mapView.ts`**

Add these named constants near the top of `src/views/mapView.ts`, after the existing `ISO_FRUSTUM_HALF_EXTENT`/`ISO_NEAR`/`ISO_FAR` block:

```ts
/** How many same-face/same-level neighbor tiles are mounted around the
 * center at once, in each of the four directions — radius 1 is a 3×3 grid
 * (9 tiles). First-pass value (The Excursion); a visual pass may retune it
 * if "zoom out pretty handily" wants a wider ring. */
export const MAP_RING_RADIUS = 1;

/** How far (in the same units as `MAP_RING_RADIUS`) a tile's `RegionScene`
 * stays cached after it's unmounted from the ring, before being dropped for
 * real. Must be ≥ `MAP_RING_RADIUS` (the "hot" mounted ring is always inside
 * the "warm" cached halo) — bounds a long roaming session's memory instead
 * of letting `regionCache` grow forever. */
export const MAP_CACHE_HALO_RADIUS = 2;

/** Extra margin (a fraction of one tile width) the camera must drift past a
 * tile's boundary before the ring recenters — without this, a camera sitting
 * near a tile edge would thrash the ring back and forth every time it
 * jitters across the line. The spatial equivalent of `cubeSphere.ts`'s
 * `LOD_MERGE_FACTOR` split/merge hysteresis. */
export const RECENTER_HYSTERESIS_FRACTION = 0.1;
```

Add the import line at the top of the file (alongside the existing imports):

```ts
import type { TileId } from "./cubeSphere";
import { tileKey } from "./cubeSphere";
import {
  panBoundsInTiles,
  recenterTarget,
  ringAddresses,
  sameFaceOffset,
  withinChebyshev,
} from "./mapRing";
```

Change the `MapView` interface to add the two new methods (insert after `setRegion`'s doc comment/signature):

```ts
export interface MapView {
  /** The map's scene root — render this with `camera` via `render`. */
  scene: THREE.Scene;
  /** The map's shared camera. Under `'pixel'` it looks down the +z axis at
   * the origin; under `'voxel'` it sits at the fixed isometric offset. */
  camera: THREE.OrthographicCamera;
  /** Show `region` under the active `MapStyle`, mounted alone at the local
   * origin with no ring/network involvement; `null` clears it. This is the
   * synchronous, data-already-in-hand path (used directly by tests and by
   * any caller that already has a `RegionScene` in hand) — it resets the
   * ring's origin/center to this one tile and populates the cache with just
   * it. Replaces any prior mounted tiles. */
  setRegion(region: RegionScene | null): void;
  /** Start a fresh, network-backed region visit at `tile`: clears every
   * previously mounted/cached tile, then eagerly requests (via the
   * `requestRegion` this view was constructed with) the full
   * `MAP_RING_RADIUS` ring around `tile` — including `tile` itself. Meshes
   * mount as `onRegion` replies arrive. Throws if this view was constructed
   * without a `requestRegion` callback. */
  beginRegion(tile: TileId): void;
  /** Route a worker reply for `key` to this view: caches it (if it's within
   * the current warm halo), and mounts/rebuilds its mesh (if it's within the
   * current hot ring). A reply for a key this view isn't tracking (a stray
   * or stale arrival) is a no-op — mirrors `globe.ts`'s own `onRegion`
   * tolerance for arrivals it no longer wants. */
  onRegion(key: string, region: RegionScene): void;
  /** Switch the active style: swaps the camera pose immediately, and
   * rebuilds every currently-mounted ring tile from cache under the new
   * style (no new requests — every mounted tile's data is already
   * resident). Default is `'voxel'`. */
  setStyle(style: MapStyle): void;
  /** Render this view with the shared renderer. */
  render(renderer: THREE.WebGLRenderer): void;
  /** Dispose every mounted tile's geometry and material, and empty the
   * scene. */
  dispose(): void;
}
```

Now replace the body of `createMapView`. Find this block (the single-mesh state and `clearMesh`/`mountPixel`/`mountVoxel`/`mountRegion`/`setRegion`/`setStyle`):

```ts
  let mesh: THREE.Mesh | null = null;
  let symbols: MapSymbols | null = null;
  let activeStyle: MapStyle = "voxel";
  let currentRegion: RegionScene | null = null;
```

replace with:

```ts
  /** One ring member's mounted state: its mesh (positioned at its
   * origin-relative offset) and, for the center tile only, its symbol
   * overlay. */
  interface MountedTile {
    mesh: THREE.Mesh;
    symbols: MapSymbols | null;
    /** This tile's own address — stored directly (not reverse-derived from
     * `mesh.position`) so ring/halo membership checks never depend on
     * rounding a world-space float back to an integer tile index. */
    addr: TileId;
  }
  const mounted = new Map<string, MountedTile>();
  const regionCache = new Map<string, RegionScene>();
  const regionPending = new Set<string>();
  let activeStyle: MapStyle = "voxel";
  /** The tile every mounted mesh's position is anchored to — set once per
   * region visit (by `setRegion` or `beginRegion`) and NEVER re-zeroed
   * afterward. Recentering (below) only ever changes `centerAddr`; it never
   * moves this, and therefore never moves the camera or any existing mesh
   * (a floating-origin frame would fight `MapControls`' in-progress drag
   * deltas — see The Excursion's design doc §4). */
  let originAddr: TileId | null = null;
  /** The ring's current nominal center, for ring/halo MEMBERSHIP tests only
   * (never for mesh positioning — that's always relative to `originAddr`).
   * Moves on every recenter. */
  let centerAddr: TileId | null = null;
```

Replace `clearMesh()`:

```ts
  function clearMesh(): void {
    if (symbols) {
      scene.remove(symbols.group);
      symbols.dispose();
      symbols = null;
    }
    if (!mesh) return;
    scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.MeshBasicMaterial).map?.dispose();
    (mesh.material as THREE.Material).dispose();
    mesh = null;
  }
```

with:

```ts
  /** Dispose and unmount every currently-mounted ring tile (meshes AND, for
   * the center, its symbol overlay) — does not touch `regionCache`. */
  function clearAllMounted(): void {
    for (const key of [...mounted.keys()]) unmountTile(key);
  }

  /** Dispose and unmount one ring tile by key — does not touch
   * `regionCache` (a tile leaving the hot ring stays cached in the warm
   * halo; see `recenterTo`). No-op if `key` isn't currently mounted. */
  function unmountTile(key: string): void {
    const entry = mounted.get(key);
    if (!entry) return;
    if (entry.symbols) {
      scene.remove(entry.symbols.group);
      entry.symbols.dispose();
    }
    scene.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    (entry.mesh.material as THREE.MeshBasicMaterial).map?.dispose();
    (entry.mesh.material as THREE.Material).dispose();
    mounted.delete(key);
  }
```

Replace `mountPixel(region: RegionScene): void` and `mountVoxel(region: RegionScene): void` — they now each *build and return* a mesh instead of assigning the module-level `mesh`/adding to the scene themselves (mounting/positioning/scene-adding is now `mountTileAt`'s job, shared by every ring member):

```ts
  /** `'pixel'`: a flat quad textured with the procedural overworld renderer
   * (`overworldTexture`, campaign "The Overworld"). Plane geometry is
   * unchanged from the original flat pixel-art path; only *mounting*
   * (position, scene membership) moved to `mountTileAt`, shared by every
   * ring member. */
  function buildPixelMesh(region: RegionScene): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(2 * FRUSTUM_HALF_EXTENT, 2 * FRUSTUM_HALF_EXTENT);
    const material = new THREE.MeshBasicMaterial({ map: overworldTexture(region) });
    const m = new THREE.Mesh(geometry, material);
    m.name = `map-region-${region.face}:${region.level}:${region.ix}:${region.iy}`;
    return m;
  }

  /** `'voxel'`: the relief diorama — an extruded-block heightfield colored
   * by the SAME per-node source `buildPixelMesh`'s texture uses
   * (`pixelColorFor`), so Style ⟂ Lens holds. */
  function buildVoxelMesh(region: RegionScene): THREE.Mesh {
    const geometry = buildVoxelHeightfieldGeometry(
      region,
      (nodeIndex) => pixelColorFor([0, 0, 0], region, nodeIndex),
      { extent: MAP_VOXEL_EXTENT, heightScale: MAP_VOXEL_HEIGHT_SCALE, bandM: MAP_VOXEL_BAND_M },
    );
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 1,
      metalness: 0,
    });
    const m = new THREE.Mesh(geometry, material);
    m.name = `map-region-voxel-${region.face}:${region.level}:${region.ix}:${region.iy}`;
    return m;
  }

  function buildTileMesh(region: RegionScene): THREE.Mesh {
    return activeStyle === "voxel" ? buildVoxelMesh(region) : buildPixelMesh(region);
  }

  /** Positions `mesh` (and, if given, `symbolsGroup`) at `(dx, dy)` tiles
   * from `originAddr` — the SAME formula for every ring member, center
   * included (the center's own offset is `(0, 0)` only immediately after
   * `setRegion`/`beginRegion`; after any number of recenters it can be
   * anywhere). `'voxel'`'s ground plane is X–Z (Y is height, see
   * `MAP_VOXEL_EXTENT`'s doc comment); `'pixel'`'s flat quad is X–Y (Z is
   * depth-only). `dy` maps to the NEGATIVE second axis in both styles,
   * extending `mapSymbols.ts`'s existing within-tile convention (increasing
   * row/iy → decreasing world Y) across tile boundaries too, so a tile's
   * own row ordering and the ring's tile ordering agree. */
  function positionAt(object: THREE.Object3D, dx: number, dy: number): void {
    if (activeStyle === "voxel") {
      object.position.set(dx * MAP_VOXEL_EXTENT, 0, -dy * MAP_VOXEL_EXTENT);
    } else {
      object.position.set(dx * MAP_VOXEL_EXTENT, -dy * MAP_VOXEL_EXTENT, 0);
    }
  }

  /** Mount (or remount, replacing any existing mesh at `key`) one ring
   * tile's `region` at its `originAddr`-relative offset. `isCenter` gates
   * the symbol overlay — see The Excursion's design doc §5: budgets were
   * tuned for one tile's worth of symbols, so only the center ever carries
   * them. */
  function mountTileAt(key: string, region: RegionScene, isCenter: boolean): void {
    unmountTile(key);
    const addr: TileId = { face: region.face, level: region.level, ix: region.ix, iy: region.iy };
    const offset = sameFaceOffset(addr, originAddr!)!;
    const m = buildTileMesh(region);
    positionAt(m, offset.dx, offset.dy);
    scene.add(m);
    let tileSymbols: MapSymbols | null = null;
    if (isCenter && activeStyle === "pixel") {
      tileSymbols = buildMapSymbols(region);
      tileSymbols.update("near"); // Task 6 wires this to the real camera zoom
      positionAt(tileSymbols.group, offset.dx, offset.dy);
      scene.add(tileSymbols.group);
    }
    mounted.set(key, { mesh: m, symbols: tileSymbols, addr });
  }
```

Replace `mountRegion(region: RegionScene): void`:

```ts
  function mountRegion(region: RegionScene): void {
    clearMesh();
    if (activeStyle === "voxel") mountVoxel(region);
    else mountPixel(region);
  }
```

with the ring-fetch/recenter machinery. This is the largest new block — insert it where `mountRegion` was:

```ts
  /** Request every not-yet-cached, not-yet-pending address in `addresses`
   * via the `requestRegion` this view was constructed with. Throws if this
   * view has none (a real app always supplies one; only `setRegion`'s
   * synchronous, data-in-hand path works without it). */
  function requestMissing(addresses: TileId[]): void {
    if (!requestRegion) {
      throw new Error("mapView: beginRegion/recenter needs a requestRegion callback");
    }
    for (const addr of addresses) {
      const key = tileKey(addr);
      if (regionCache.has(key) || regionPending.has(key)) continue;
      regionPending.add(key);
      requestRegion(addr);
    }
  }

  /** Mount every address in the current ring that's already cached (used
   * right after a recenter, when some ring members may already be resident
   * from the warm halo — no need to wait for a fresh reply). */
  function mountCachedRing(): void {
    if (!centerAddr) return;
    for (const addr of ringAddresses(centerAddr, MAP_RING_RADIUS)) {
      const key = tileKey(addr);
      const cached = regionCache.get(key);
      if (cached) mountTileAt(key, cached, key === tileKey(centerAddr));
    }
  }

  function beginRegion(tile: TileId): void {
    clearAllMounted();
    regionCache.clear();
    regionPending.clear();
    originAddr = tile;
    centerAddr = tile;
    requestMissing(ringAddresses(tile, MAP_RING_RADIUS));
  }

  function onRegion(key: string, region: RegionScene): void {
    regionPending.delete(key);
    if (!originAddr || !centerAddr) return; // no active region visit
    const addr: TileId = { face: region.face, level: region.level, ix: region.ix, iy: region.iy };
    if (!withinChebyshev(addr, centerAddr, MAP_CACHE_HALO_RADIUS)) return; // stale/irrelevant
    regionCache.set(key, region);
    if (withinChebyshev(addr, centerAddr, MAP_RING_RADIUS)) {
      mountTileAt(key, region, key === tileKey(centerAddr));
    }
  }

  /** Recenter the ring to `newCenter`: unmount (but keep cached, within the
   * warm halo) tiles that fall outside the new hot ring, drop from the
   * cache entirely anything now outside the warm halo, mount anything
   * already cached that's newly in-ring, and request whatever's still
   * missing. Never touches `originAddr`, any mesh's position, or the
   * camera. */
  function recenterTo(newCenter: TileId): void {
    centerAddr = newCenter;
    for (const [key, entry] of [...mounted.entries()]) {
      if (!withinChebyshev(entry.addr, newCenter, MAP_RING_RADIUS)) unmountTile(key);
    }
    for (const key of [...regionCache.keys()]) {
      const cached = regionCache.get(key)!;
      const addr: TileId = { face: cached.face, level: cached.level, ix: cached.ix, iy: cached.iy };
      if (!withinChebyshev(addr, newCenter, MAP_CACHE_HALO_RADIUS)) regionCache.delete(key);
    }
    mountCachedRing();
    requestMissing(ringAddresses(newCenter, MAP_RING_RADIUS));
  }
```

Replace `setRegion`:

```ts
  function setRegion(region: RegionScene | null): void {
    currentRegion = region;
    if (!region) {
      clearMesh();
      return;
    }
    mountRegion(region);
  }
```

with:

```ts
  function setRegion(region: RegionScene | null): void {
    clearAllMounted();
    regionCache.clear();
    regionPending.clear();
    if (!region) {
      originAddr = null;
      centerAddr = null;
      return;
    }
    const addr: TileId = { face: region.face, level: region.level, ix: region.ix, iy: region.iy };
    originAddr = addr;
    centerAddr = addr;
    const key = tileKey(addr);
    regionCache.set(key, region);
    mountTileAt(key, region, true);
  }
```

Replace `setStyle`:

```ts
  function setStyle(style: MapStyle): void {
    activeStyle = style;
    if (style === "voxel") applyIsoCamera();
    else applyPixelCamera();
    if (currentRegion) mountRegion(currentRegion);
    else clearMesh();
  }
```

with:

```ts
  function setStyle(style: MapStyle): void {
    activeStyle = style;
    if (style === "voxel") applyIsoCamera();
    else applyPixelCamera();
    if (!centerAddr) return;
    const centerKey = tileKey(centerAddr);
    for (const key of [...mounted.keys()]) {
      const cached = regionCache.get(key);
      if (!cached) continue; // shouldn't happen (a mounted tile is always cached) but stay defensive
      mountTileAt(key, cached, key === centerKey); // replaces the old style's mesh internally
    }
  }
```

Replace `dispose`:

```ts
  function dispose(): void {
    clearMesh();
  }
```

with:

```ts
  function dispose(): void {
    clearAllMounted();
    regionCache.clear();
    regionPending.clear();
  }
```

Finally, change the `createMapView` function signature and the `requestRegion` capture. Find:

```ts
export function createMapView(): MapView {
  const scene = new THREE.Scene();
```

replace with:

```ts
export interface CreateMapViewOptions {
  /** How to fetch a region tile for `beginRegion`/recenter — the same
   * function `main.ts` already passes to `createGlobeView`. Omit only for
   * tests/callers that exclusively use the synchronous `setRegion` path. */
  requestRegion?: (tile: TileId) => void;
}

export function createMapView(options: CreateMapViewOptions = {}): MapView {
  const { requestRegion } = options;
  const scene = new THREE.Scene();
```

And the final return statement:

```ts
  return { scene, camera, setRegion, setStyle, render, dispose };
```

becomes:

```ts
  return { scene, camera, setRegion, beginRegion, onRegion, setStyle, render, dispose };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- mapView`
Expected: PASS — every existing test (unchanged) plus the 7 new ring tests.

Run: `npm test 2>&1 | tail -20`
Expected: full suite green.

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: clean. (This mainly catches the `MapView` interface additions being consistently typed across the file.)

- [ ] **Step 6: Commit**

```bash
git add src/views/mapView.ts src/views/mapView.test.ts
git commit -m "feat(map): multi-tile neighbor ring — mount/cache/dispose, no camera yet

mapView.ts now tracks a Map of mounted ring tiles instead of one mesh,
with a two-radius (hot ring / warm cache halo) eviction policy and a
stable origin-relative coordinate frame that recentering never moves.
beginRegion/onRegion are the new network-backed entry points; setRegion
keeps its existing synchronous, data-in-hand behavior unchanged.
Camera controls land in a later task — this is data/mount plumbing only."
```

---

### Task 4: Wire `main.ts` to the new `beginRegion`/`onRegion` API

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `MapView.beginRegion`/`onRegion` from Task 3.
- Produces: nothing new for later tasks — this task only rewires existing call sites.

- [ ] **Step 1: Hoist `requestRegion` above `createMapView` and pass it in**

In `src/main.ts`, the map view is currently created before `requestRegion` is defined:

```ts
  // The map view: the flat pixel-art rung below the globe (Task 4 wires it
  // in; the region quad itself is still a placeholder, Stage 3).
  const mapView = createMapView();

  // The system view: the schematic AU-scale orrery (Task 8).
```

and, later:

```ts
  // Region-tile request bridge (LOD stage 4): the globe asks for a tile's true
  // higher-res patch; the worker serves it from the persisted catalog and the
  // reply routes back to `globe.onRegion` (see boot's onmessage). `samples` is
  // the tile grid resolution (TILE_QUADS), `key` matches reply to request.
  const requestRegion = (tile: TileId): void => {
    worker.postMessage({
      type: 'region',
      face: tile.face,
      level: tile.level,
      ix: tile.ix,
      iy: tile.iy,
      samples: TILE_QUADS,
      key: tileKey(tile),
    });
  };
  const globeView = createGlobeView(tiles, system, eclipses.events, requestRegion);
```

Move the `requestRegion` definition up so it exists before `mapView` is constructed, and pass it in. Delete the old `const mapView = createMapView();` line and the comment above it, then insert both `requestRegion` and `mapView` together where `requestRegion` used to be defined:

```ts
  // Region-tile request bridge (LOD stage 4): the globe (and, since The
  // Excursion, the map's own neighbor ring) ask for a tile's true higher-res
  // patch; the worker serves it from the persisted catalog and the reply
  // routes back via `deliverRegion` below. `samples` is the tile grid
  // resolution (TILE_QUADS), `key` matches reply to request.
  const requestRegion = (tile: TileId): void => {
    worker.postMessage({
      type: 'region',
      face: tile.face,
      level: tile.level,
      ix: tile.ix,
      iy: tile.iy,
      samples: TILE_QUADS,
      key: tileKey(tile),
    });
  };

  // The map view: the flat rung below the globe, backed by a same-face
  // neighbor-tile ring (The Excursion) fetched through the same worker
  // bridge the globe's own region tiles use.
  const mapView = createMapView({ requestRegion });

  const globeView = createGlobeView(tiles, system, eclipses.events, requestRegion);
```

- [ ] **Step 2: Replace `pendingMapKey` with `beginRegion`/unconditional `onRegion`**

Delete the `pendingMapKey` declaration:

```ts
  // The region key the map rung is waiting on (set by the globe->map
  // handoff's requestRegion call, consumed by deliverRegion below) — null
  // when the map isn't expecting a reply (e.g. a repeat visit already
  // holding a cached region).
  let pendingMapKey: string | null = null;
```

In `enterMapRegion()`, change:

```ts
    pendingMapKey = tileKey(tile);
    requestRegion(tile); // reply routes via boot -> deliverRegion
```

to:

```ts
    mapView.beginRegion(tile); // fetches the whole ring; replies route via boot -> deliverRegion
```

In `deliverRegion`, change:

```ts
  function deliverRegion(key: string, region: RegionScene): void {
    globeView.onRegion(key, region);
    if (key === pendingMapKey) {
      mapView.setRegion(region);
      // Consume it: the globe's own LOD re-requests this same level-3 tile as
      // it reselects, and a stale match would rebuild the (invisible) map quad
      // + sprite materials while on the globe rung. The next handoff re-sets it.
      pendingMapKey = null;
    }
  }
```

to:

```ts
  function deliverRegion(key: string, region: RegionScene): void {
    globeView.onRegion(key, region);
    mapView.onRegion(key, region); // no-ops if `key` isn't one the map's ring is tracking
  }
```

- [ ] **Step 3: Typecheck and run the unit suite**

Run: `npm run build`
Expected: clean — no remaining references to `pendingMapKey`.

Run: `npm test 2>&1 | tail -10`
Expected: full suite green (this task touches no test files; existing `mapView`/`globe` tests are unaffected since they construct their views directly, not through `main.ts`).

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev` and, in the browser, `#seed=42`, switch to Globe, then to Map via the HUD dropdown. Confirm the map still shows terrain (the center tile) with no console errors — this is the same behavior as before this task, just routed through the new API; a regression here would mean `beginRegion`/`onRegion` wiring is wrong before Task 5 adds anything new to look at.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(map): route worker region replies through mapView's ring API

Replaces the single-key pendingMapKey special-case with an unconditional
onRegion call, exactly mirroring how globeView.onRegion already works —
the map view now decides internally which replies it cares about.
enterMapRegion starts a ring fetch (beginRegion) instead of a lone tile
request."
```

---

### Task 5: `MapControls` — pan, zoom, active clamp, recenter trigger

**Files:**
- Modify: `src/views/mapView.ts`
- Modify: `src/views/mapView.test.ts`

**Interfaces:**
- Consumes: `MapControls` from `three/addons/controls/MapControls.js`; `panBoundsInTiles`, `recenterTarget` from `./mapRing` (Task 2).
- Produces: `MapView.render` now also drives the controls/clamp/recenter each call — no new public methods (camera behavior is internal).

- [ ] **Step 1: Write the failing tests**

Add to `src/views/mapView.test.ts`:

```ts
describe("camera pan/zoom (The Excursion)", () => {
  test("MapControls is attached with rotation disabled", () => {
    const v = createMapView({ requestRegion: () => {} });
    expect(v.controls.enableRotate).toBe(false);
  });

  test("minZoom/maxZoom are set and minZoom < 1 < maxZoom (can zoom both out and in)", () => {
    const v = createMapView({ requestRegion: () => {} });
    expect(v.controls.minZoom).toBeLessThan(1);
    expect(v.controls.maxZoom).toBeGreaterThan(1);
  });

  test("panning the camera target past the ring's edge is clamped on render", () => {
    const v = createMapView({ requestRegion: () => {} });
    const center: TileId = { face: 0, level: 3, ix: 4, iy: 4 };
    v.beginRegion(center);
    // Push the target way out past any legal ring bound.
    v.controls.target.set(1000, 0, 0);
    v.render({ render: () => {} } as unknown as THREE.WebGLRenderer);
    const maxWorldDx = (MAP_RING_RADIUS + 0.5) * MAP_VOXEL_EXTENT;
    expect(Math.abs(v.controls.target.x)).toBeLessThanOrEqual(maxWorldDx);
  });

  test("panning solidly past a tile boundary triggers a recenter (new tile mounts)", () => {
    const requested: TileId[] = [];
    const v = createMapView({ requestRegion: (t) => requested.push(t) });
    const center: TileId = { face: 0, level: 3, ix: 4, iy: 4 };
    v.beginRegion(center);
    const requestedAfterBegin = requested.length;
    // Move solidly past the +X tile boundary (beyond 0.5 + hysteresis tiles).
    v.controls.target.set(0.7 * MAP_VOXEL_EXTENT, 0, 0);
    v.render({ render: () => {} } as unknown as THREE.WebGLRenderer);
    // A recenter re-requests the newly-exposed ring edge — more requests than
    // beginRegion alone issued.
    expect(requested.length).toBeGreaterThan(requestedAfterBegin);
  });
});
```

Add `MAP_RING_RADIUS` to the existing `mapView` import in the test file (it already imports `MAP_VOXEL_EXTENT` from Task 3's step):

```ts
import { createMapView, ISO_CAMERA_DISTANCE, MAP_RING_RADIUS, MAP_VOXEL_EXTENT } from "./mapView";
```

Add `controls` to the `MapView` interface (test-visible, since the tests above read `v.controls` directly — real callers besides tests only ever need `render`, but exposing it keeps the controls inspectable/testable without a parallel private-state backdoor):

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- mapView`
Expected: FAIL — `v.controls` is undefined, `MapControls` isn't wired up yet.

- [ ] **Step 3: Implement**

Add the import at the top of `src/views/mapView.ts`:

```ts
import { MapControls } from "three/addons/controls/MapControls.js";
```

Add these constants near `RECENTER_HYSTERESIS_FRACTION` (from Task 3):

```ts
/** Zoomed all the way out, the whole `MAP_RING_RADIUS` ring should be
 * visible without exposing its own edge — `1 / (2·radius + 1)` frames the
 * ring exactly; the extra `1.1` divisor leaves a small margin so the ring's
 * outermost edge doesn't sit flush against the viewport border. */
export const MAP_MIN_ZOOM = 1 / ((2 * MAP_RING_RADIUS + 1) * 1.1);

/** Zoomed all the way in — a first-pass "close-up on about a quarter of one
 * tile" value; a visual pass may retune it. */
export const MAP_MAX_ZOOM = 4;
```

Add `controls` to the `MapView` interface, right after `camera`:

```ts
  /** The map's shared camera. Under `'pixel'` it looks down the +z axis at
   * the origin; under `'voxel'` it sits at the fixed isometric offset. */
  camera: THREE.OrthographicCamera;
  /** Pan (drag) + zoom (wheel) controls, shared by both styles — only
   * position/zoom change between styles, never the fixed camera angle
   * (`enableRotate` stays `false`). Exposed (not fully private) so tests can
   * drive/inspect it directly; `render` is the only method real callers
   * need to invoke it through. */
  controls: MapControls;
```

First, extend the `CreateMapViewOptions` interface (added in Task 3) with an optional DOM element for `MapControls` to attach its listeners to:

```ts
export interface CreateMapViewOptions {
  /** How to fetch a region tile for `beginRegion`/recenter — the same
   * function `main.ts` already passes to `createGlobeView`. Omit only for
   * tests/callers that exclusively use the synchronous `setRegion` path. */
  requestRegion?: (tile: TileId) => void;
  /** The element `MapControls` listens on for drag/wheel input — `main.ts`
   * passes the real `mapCanvas` (Task 4 wires this) so pointer/wheel events
   * from the visible canvas actually reach the controls. `OrbitControls`'
   * constructor unconditionally touches `domElement.style`, so this can't be
   * left `undefined`; omitting it falls back to a detached, never-rendered
   * `<canvas>` that satisfies the constructor without needing a real DOM
   * (used by unit tests, which drive pan/zoom by writing to
   * `controls.target`/`controls.object.zoom` directly rather than dispatching
   * real pointer events). */
  domElement?: HTMLElement;
}
```

(This replaces Task 3's original narrower `CreateMapViewOptions` — same interface, with `domElement` added.)

Change the destructuring at the top of `createMapView` from:

```ts
export function createMapView(options: CreateMapViewOptions = {}): MapView {
  const { requestRegion } = options;
  const scene = new THREE.Scene();
```

to:

```ts
export function createMapView(options: CreateMapViewOptions = {}): MapView {
  const { requestRegion, domElement = document.createElement("canvas") } = options;
  const scene = new THREE.Scene();
```

Then, after the camera is constructed and the light rig is added (right before `let mounted = ...` — i.e., right after the `const ambient = new THREE.AmbientLight(...)` block and before the `MountedTile` interface/`mounted` map), add:

```ts
  const controls = new MapControls(camera, domElement);
  controls.enableRotate = false;
  controls.minZoom = MAP_MIN_ZOOM;
  controls.maxZoom = MAP_MAX_ZOOM;
```

Add the pan-clamp and recenter-check functions, right after `recenterTo` (defined in Task 3):

```ts
  /** The world-unit box `controls.target` must stay within, given the
   * current ring — converts `mapRing.ts`'s tile-unit bounds to world units
   * and the active style's plane (X–Z for voxel, X–Y for pixel). */
  function clampPan(): void {
    if (!originAddr || !centerAddr) return;
    const bounds = panBoundsInTiles(centerAddr, originAddr, MAP_RING_RADIUS);
    const minX = bounds.minDx * MAP_VOXEL_EXTENT;
    const maxX = bounds.maxDx * MAP_VOXEL_EXTENT;
    // Y bounds are the negated Dy bounds (positionAt's sign convention),
    // so min/max swap.
    const minSecond = -bounds.maxDy * MAP_VOXEL_EXTENT;
    const maxSecond = -bounds.minDy * MAP_VOXEL_EXTENT;
    controls.target.x = Math.min(maxX, Math.max(minX, controls.target.x));
    if (activeStyle === "voxel") {
      controls.target.z = Math.min(maxSecond, Math.max(minSecond, controls.target.z));
    } else {
      controls.target.y = Math.min(maxSecond, Math.max(minSecond, controls.target.y));
    }
  }

  /** Checks `controls.target` against the recenter-hysteresis boundary and
   * recenters the ring if the camera has drifted solidly into a neighbor's
   * footprint. Called every frame from `render` (cheap: a handful of
   * arithmetic comparisons, no allocation on the common no-op path). */
  function maybeRecenter(): void {
    if (!originAddr || !centerAddr) return;
    const localX = controls.target.x / MAP_VOXEL_EXTENT;
    const secondAxis = activeStyle === "voxel" ? controls.target.z : controls.target.y;
    const localY = -secondAxis / MAP_VOXEL_EXTENT;
    const next = recenterTarget(originAddr, centerAddr, localX, localY, RECENTER_HYSTERESIS_FRACTION);
    if (next) recenterTo(next);
  }
```

Replace `render`:

```ts
  function render(renderer: THREE.WebGLRenderer): void {
    renderer.render(scene, camera);
  }
```

with:

```ts
  function render(renderer: THREE.WebGLRenderer): void {
    controls.update();
    clampPan();
    maybeRecenter();
    renderer.render(scene, camera);
  }
```

Finally, add `controls` to the returned object:

```ts
  return { scene, camera, controls, setRegion, beginRegion, onRegion, setStyle, render, dispose };
```

- [ ] **Step 4: Pass the real canvas from `main.ts`**

Without this, the live app would still construct `MapControls` against the internal throwaway `<canvas>` `createMapView`'s default falls back to (Task 3/5's `domElement` option) — one never attached to the DOM, so no real drag/wheel event would ever reach it. In `src/main.ts`, change the call site Task 4 (the previous task) added:

```ts
  const mapView = createMapView({ requestRegion });
```

to:

```ts
  const mapView = createMapView({ requestRegion, domElement: mapCanvas });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- mapView`
Expected: PASS.

Run: `npm test 2>&1 | tail -20`
Expected: full suite green.

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/views/mapView.ts src/views/mapView.test.ts src/main.ts
git commit -m "feat(map): MapControls pan/zoom, active pan clamp, recenter trigger

One MapControls instance (rotate disabled) serves both map styles.
render() now updates it, clamps the target into the current ring's legal
footprint every frame (so panning can never drift into unrendered void
past the ring's edge), and checks the recenter-hysteresis boundary.
main.ts now passes the real mapCanvas so MapControls listens on the
actual visible canvas instead of the test-only detached fallback."
```

---

### Task 6: Zoom-driven symbol rung, center-tile-only

**Files:**
- Modify: `src/views/symbols/budget.ts`
- Modify: `src/views/symbols/budget.test.ts`
- Modify: `src/views/mapView.ts`

**Interfaces:**
- Consumes: `Rung`, `RUNG_BUDGETS` from `./symbols/budget` (unchanged).
- Produces: `rungForMapZoom(cameraZoom: number): Rung`, exported from `budget.ts`.

- [ ] **Step 1: Write the failing test**

Add to `src/views/symbols/budget.test.ts`:

```ts
test('rungForMapZoom: zoomed out reads far, zoomed in reads near', () => {
  expect(rungForMapZoom(0.3)).toBe('far');
  expect(rungForMapZoom(1)).toBe('mid');
  expect(rungForMapZoom(3)).toBe('near');
});
```

Update the import line at the top of the file:

```ts
import { rungForZoom, selectByBudget, RUNG_BUDGETS } from './budget';
```

to:

```ts
import { rungForMapZoom, rungForZoom, selectByBudget, RUNG_BUDGETS } from './budget';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- budget`
Expected: FAIL — `rungForMapZoom` is not exported.

- [ ] **Step 3: Implement `rungForMapZoom`**

Add to `src/views/symbols/budget.ts`, right after `rungForZoom`:

```ts
/** Coarser rung when the map camera is zoomed further out — the flat map's
 * analog of `rungForZoom` above, but keyed on the orthographic camera's own
 * `.zoom` factor (1 = the base single-tile frustum; below 1 is zoomed out,
 * above 1 is zoomed in) rather than an angular radius, since the map has no
 * sphere to subtend an angle against. Boundaries are a first-pass visual
 * guess, same convention as `rungForZoom`'s. */
export function rungForMapZoom(cameraZoom: number): Rung {
  if (cameraZoom < 0.5) return 'far';
  if (cameraZoom < 2) return 'mid';
  return 'near';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- budget`
Expected: PASS.

- [ ] **Step 5: Wire it into `mapView.ts`, replacing the hardcoded `'near'`**

Find, in `mountTileAt` (Task 3):

```ts
    if (isCenter && activeStyle === "pixel") {
      tileSymbols = buildMapSymbols(region);
      tileSymbols.update("near"); // Task 6 wires this to the real camera zoom
      positionAt(tileSymbols.group, offset.dx, offset.dy);
      scene.add(tileSymbols.group);
    }
```

replace with:

```ts
    if (isCenter && activeStyle === "pixel") {
      tileSymbols = buildMapSymbols(region);
      tileSymbols.update(rungForMapZoom(camera.zoom));
      positionAt(tileSymbols.group, offset.dx, offset.dy);
      scene.add(tileSymbols.group);
    }
```

Add the import at the top of `mapView.ts` (alongside the existing `RUNG_BUDGETS`-adjacent imports, or wherever `mapSymbols` is imported from):

```ts
import { rungForMapZoom } from "./symbols/budget";
```

Now the center tile's symbol rung is set at *mount* time from whatever `camera.zoom` happens to be — but it also needs to update as the user zooms *without* remounting the tile. Add this to `render`, right after `clampPan()`:

```ts
  function render(renderer: THREE.WebGLRenderer): void {
    controls.update();
    clampPan();
    maybeRecenter();
    updateSymbolRung();
    renderer.render(scene, camera);
  }
```

Add `updateSymbolRung` near `maybeRecenter`:

```ts
  /** Re-evaluates the center tile's symbol rung against the current camera
   * zoom every frame — cheap (one comparison chain) on the common
   * unchanged-rung path, since `MapSymbols.update` itself is a no-op-cost
   * early return only in the sense that rebuilding the same rung twice is
   * wasted work, not incorrect; guard on the rung actually changing. */
  let lastSymbolRung: Rung | null = null;
  function updateSymbolRung(): void {
    if (activeStyle !== "pixel" || !centerAddr) return;
    const entry = mounted.get(tileKey(centerAddr));
    if (!entry || !entry.symbols) return;
    const rung = rungForMapZoom(camera.zoom);
    if (rung === lastSymbolRung) return;
    lastSymbolRung = rung;
    entry.symbols.update(rung);
  }
```

Add the `Rung` type import alongside `rungForMapZoom`:

```ts
import { rungForMapZoom, type Rung } from "./symbols/budget";
```

Reset `lastSymbolRung` wherever the center tile's symbols are rebuilt from scratch (so a fresh mount re-evaluates rather than trusting a stale memo from a previous tile). In `mountTileAt`, right after `mounted.set(key, { mesh: m, symbols: tileSymbols, addr });`, add:

```ts
    if (isCenter) lastSymbolRung = tileSymbols ? rungForMapZoom(camera.zoom) : null;
```

- [ ] **Step 6: Run the tests**

Run: `npm test 2>&1 | tail -20`
Expected: full suite green.

Run: `npm run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/views/symbols/budget.ts src/views/symbols/budget.test.ts src/views/mapView.ts
git commit -m "feat(map): drive the symbol rung from real camera zoom

rungForMapZoom replaces the hardcoded 'near' the flat map's symbol
overlay was stuck at before real zoom existed. Re-evaluated every frame
against camera.zoom, guarded on the rung actually changing so an
unchanged zoom costs one comparison, not a symbol rebuild."
```

---

### Task 7: e2e coverage + visual pass

**Files:**
- Modify: `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: the running app (`npm run dev` / the Playwright preview server already wired by `e2e/serve.mjs`).
- Produces: nothing for later tasks — this is the campaign's final verification task.

- [ ] **Step 1: Add e2e tests**

Append to `e2e/smoke.spec.ts`:

```ts
test('the excursion: dragging the map pans across a tile boundary without erroring', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('#seed=42&view=globe');
  await expect(page.locator('.hud-top-left')).toContainText('seed 42', { timeout: 150_000 });
  await page.locator('.hud-view').selectOption('map');
  const mapCanvas = page.locator('canvas.view-canvas').nth(2);
  await expect(mapCanvas).toBeVisible();
  await page.waitForTimeout(2000); // let the ring's eager fetch settle

  const box = await mapCanvas.boundingBox();
  if (!box) throw new Error('map canvas has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Drag far enough to cross at least one tile boundary and trigger a
  // recenter — several hundred px at whatever the default zoom is.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 400, cy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  expect(errors).toEqual([]);
});

test('the excursion: wheel-zoom changes the visible extent within bounds', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('#seed=42&view=globe');
  await expect(page.locator('.hud-top-left')).toContainText('seed 42', { timeout: 150_000 });
  await page.locator('.hud-view').selectOption('map');
  const mapCanvas = page.locator('canvas.view-canvas').nth(2);
  await expect(mapCanvas).toBeVisible();
  await page.waitForTimeout(2000);

  const box = await mapCanvas.boundingBox();
  if (!box) throw new Error('map canvas has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Zoom out, then in — should not throw or hang either direction.
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
  await page.mouse.wheel(0, -800);
  await page.waitForTimeout(300);

  expect(errors).toEqual([]);
});

test('the excursion: panning toward a face-clamped edge does not error or hang', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('#seed=42&view=globe');
  await expect(page.locator('.hud-top-left')).toContainText('seed 42', { timeout: 150_000 });
  await page.locator('.hud-view').selectOption('map');
  const mapCanvas = page.locator('canvas.view-canvas').nth(2);
  await expect(mapCanvas).toBeVisible();
  await page.waitForTimeout(2000);

  const box = await mapCanvas.boundingBox();
  if (!box) throw new Error('map canvas has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Drag hard and repeatedly in one direction — whether or not this
  // particular seed/region lands near a face edge, repeated large drags
  // exercise the clamp path without throwing either way.
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 500, cy - 500, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  }

  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run the new e2e tests**

Run: `npm run e2e -- --grep "the excursion"`
Expected: 3 passed. (This requires a built/served app — `npm run e2e` handles that via the existing Playwright config; if it fails to find a server, run `npm run build` first.)

- [ ] **Step 3: Run the full e2e suite to confirm no regressions**

Run: `npm run e2e`
Expected: every existing test still passes (the map-style-switch tests from The Diorama/The Overworld exercise `setStyle` while panned/recentered state may differ from a fresh mount — confirm they still find a non-blank canvas).

- [ ] **Step 4: Visual pass**

Run: `npm run dev`, open the app at `#seed=42&view=globe`, switch to Map. Drag across at least two tile boundaries in each style (pixel and voxel) and confirm:
- Neighbor tiles appear with no visible seam/gap or z-fighting at the boundary.
- The pixel style's ocean reads fine with no wave sprites (Task 1).
- Zooming out shows the full ring without an abrupt edge before the ring's actual face/data boundary.
- Symbol density visibly changes between zoomed-out and zoomed-in on the pixel style, and never appears doubled on a neighbor tile.

If anything looks wrong, note it as a follow-up rather than iterating further tuning here — the design doc explicitly defers exact constant values to this pass, not additional architecture.

- [ ] **Step 5: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "test(orrery): e2e coverage for map pan/zoom/recenter/clamp (The Excursion)"
```

## Self-Review

**Spec coverage:**
- §3 Camera controls → Task 5 (MapControls, rotate disabled, minZoom/maxZoom, shared instance).
- §4 Neighbor-tile ring (ownership, two radii, eager fetch, stable frame, recenter+hysteresis, face-edge clamp, style-switch-from-cache, region-change cache-clear) → Tasks 2 (pure math) + 3 (mount/cache) + 5 (recenter trigger wired to real camera).
- §5 Zoom-driven symbol rung, center-tile-only → Task 6 (and enforced in Task 3's `mountTileAt` via the `isCenter` gate).
- §6 Remove wave symbols → Task 1.
- §7 Testing → unit tests embedded in Tasks 1–6; e2e in Task 7.
- §8/§9 Non-goals (cross-face stitching, multi-tile symbol budgets, elastic clamp, wasm changes, pixel aesthetic tuning) → nothing in this plan touches any of them; `ringAddresses`/`panBoundsInTiles`/`recenterTarget` all clamp at face edges rather than crossing.

**Placeholder scan:** no TBD/TODO; every step has complete code. The one `TODO(map-rung)` comment already in `main.ts` (about the map rung not being URL-addressable) is pre-existing and untouched — out of scope per the spec.

**Type consistency:** `TileId` (from `cubeSphere.ts`) is used consistently as the address type end-to-end — `mapRing.ts`'s functions, `beginRegion`'s parameter, and `RegionScene`'s own `face/level/ix/iy` fields are converted to a `TileId`-shaped object wherever compared, never mixed with a differently-named shape. `mounted: Map<string, MountedTile>` and its `{mesh, symbols}` shape is introduced once (Task 3) and used identically in Tasks 5–6. `MAP_VOXEL_EXTENT` (pre-existing) is reused as the universal tile width for both styles rather than introducing a second constant.
