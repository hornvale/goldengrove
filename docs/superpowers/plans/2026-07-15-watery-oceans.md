# Watery Oceans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A translucent, depth-graded, sun-glinting ocean surface at sea level over the existing displaced seafloor, with deterministic sim-clock wave motion.

**Architecture:** One new module `src/views/ocean.ts` (pure math + three.js builder, the house split). A smooth cube-sphere at sea-level radius wears RGBA vertex colors — alpha graded by ocean depth, alpha 0 over land — on one low-roughness transparent `MeshStandardMaterial`. The globe view mounts it inside `spinGroup` and forwards `setTrueRelief`/`update`. Spec: `docs/superpowers/specs/2026-07-15-watery-oceans-design.md`.

**Tech Stack:** TypeScript, three.js ^0.166, vitest (happy-dom).

## Global Constraints

- No new dependencies; no external assets (deploy CSP forbids network fetches — generate textures on a canvas).
- Determinism: same seed + same day ⇒ identical render state. Never `Date.now()`/`Math.random()`; seeded PRNG only (`src/util/prng.ts`).
- happy-dom has no canvas 2D context: any `canvas.getContext('2d')` call may return null in tests — degrade gracefully (see `buildLabelSprite` in `src/views/globe.ts` for the precedent).
- The globe's honest terminator (no ambient light) must be untouched.
- `elevation_m` is datum-relative; `sea_level_m` is NOT 0 (seed 42: −2581.88). Depth of an ocean tile = `sea_level_m − elevation_m` ≥ 0.
- Run tests with the project-local runner: `./node_modules/.bin/vitest run <path>` (a bare `npx vitest` may resolve to an incompatible global).
- Every commit: tests green, `npx tsc --noEmit` clean.

## File Structure

- **Create** `src/views/ocean.ts` — everything ocean: pure grading/radius math, geometry builder, `createOcean` view object. Single responsibility: the water layer.
- **Create** `src/views/ocean.test.ts` — its tests.
- **Modify** `src/views/globe.ts` — ~4 lines: construct/mount the ocean, forward `setTrueRelief` and `update`.
- **Modify** `src/views/globe.test.ts` — one integration test.

---

### Task 1: Pure water math — `seaLevelRadius` and `waterColorAlpha`

**Files:**
- Create: `src/views/ocean.ts`
- Test: `src/views/ocean.test.ts`

**Interfaces:**
- Consumes: `REFERENCE_RADIUS_M` from `src/views/worldMesh.ts`; `TilesScene` from `src/sim/scene.ts`.
- Produces (later tasks rely on these exact names):
  - `seaLevelRadius(tiles: TilesScene, radius: number, reliefScale: number): number`
  - `waterColorAlpha(depthM: number): { r: number; g: number; b: number; a: number }`
  - Constants `DEEP_FULL_M = 3000`, `SHALLOW_ALPHA = 0.35`, `DEEP_ALPHA = 0.92`, `SHALLOW_COLOR: [number, number, number]`, `DEEP_COLOR: [number, number, number]`.

- [ ] **Step 1: Write the failing tests**

Create `src/views/ocean.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEEP_ALPHA,
  DEEP_FULL_M,
  SHALLOW_ALPHA,
  seaLevelRadius,
  waterColorAlpha,
} from './ocean';
import { REFERENCE_RADIUS_M } from './worldMesh';
import type { TilesScene } from '../sim/scene';

/** 4×2 world, west half ocean (100 m deep), east half land 500 m above sea.
 * sea_level_m is deliberately non-zero: the datum's zero is not sea level. */
export function oceanTiles(): TilesScene {
  return {
    schema: 'scene/tiles/v1', width: 4, height: 2, sea_level_m: -2500,
    // row-major, row 0 = north: cols 0-1 ocean floor, cols 2-3 land.
    elevation_m: [-2600, -2600, -2000, -2000, -2600, -2600, -2000, -2000],
    ocean: [true, true, false, false, true, true, false, false],
    biome: [0, 0, 0, 0, 0, 0, 0, 0], biomeLegend: ['steppe'], features: [],
  };
}

describe('seaLevelRadius', () => {
  it('is where buildFaceGeometry puts sea level, in both relief modes', () => {
    const tiles = oceanTiles();
    expect(seaLevelRadius(tiles, 2, 60)).toBeCloseTo(2 * (1 + (60 * -2500) / REFERENCE_RADIUS_M), 12);
    expect(seaLevelRadius(tiles, 2, 1)).toBeCloseTo(2 * (1 + (1 * -2500) / REFERENCE_RADIUS_M), 12);
  });
});

describe('waterColorAlpha', () => {
  it('grades from shallow to deep, monotonically', () => {
    expect(waterColorAlpha(0).a).toBeCloseTo(SHALLOW_ALPHA, 6);
    expect(waterColorAlpha(DEEP_FULL_M).a).toBeCloseTo(DEEP_ALPHA, 6);
    expect(waterColorAlpha(DEEP_FULL_M * 2).a).toBeCloseTo(DEEP_ALPHA, 6); // clamped
    let prev = -1;
    for (let d = 0; d <= DEEP_FULL_M; d += 100) {
      const a = waterColorAlpha(d).a;
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });
  it('clamps negative depth to the shallow end', () => {
    expect(waterColorAlpha(-50)).toEqual(waterColorAlpha(0));
  });
  it('darkens color with depth', () => {
    expect(waterColorAlpha(DEEP_FULL_M).b).toBeLessThan(waterColorAlpha(0).b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run src/views/ocean.test.ts`
Expected: FAIL — `Cannot find module './ocean'` (or missing exports).

- [ ] **Step 3: Write the implementation**

Create `src/views/ocean.ts`:

```ts
/** The ocean layer: a smooth, translucent sea-level sphere over the
 * displaced seafloor (spec: docs/superpowers/specs/2026-07-15-watery-oceans-design.md).
 * Same split as the other views: pure grading/radius math (unit-tested
 * directly), then the three.js builder that consumes it. */
import type { TilesScene } from '../sim/scene';
import { REFERENCE_RADIUS_M } from './worldMesh';

/** Depth (m below sea level) at which water reaches full darkness/opacity. */
export const DEEP_FULL_M = 3000;
/** Water alpha over the shallowest ocean (seafloor clearly visible). */
export const SHALLOW_ALPHA = 0.35;
/** Water alpha at DEEP_FULL_M and beyond (nearly opaque). */
export const DEEP_ALPHA = 0.92;
/** Shallow-water tint (0-1 channels) — a tuning knob, not a contract. */
export const SHALLOW_COLOR: [number, number, number] = [0.55, 0.8, 0.85];
/** Deep-water tint (0-1 channels) — a tuning knob, not a contract. */
export const DEEP_COLOR: [number, number, number] = [0.02, 0.15, 0.3];

/** The sea sphere's radius: exactly where `buildFaceGeometry` puts sea level
 * for this `reliefScale` (sea_level_m is datum-relative and negative in
 * practice, so this sits below the undisplaced radius). */
export function seaLevelRadius(tiles: TilesScene, radius: number, reliefScale: number): number {
  return radius * (1 + (reliefScale * tiles.sea_level_m) / REFERENCE_RADIUS_M);
}

/** Depth-graded water: pale, translucent aqua over the shallows smoothing to
 * near-opaque dark blue by DEEP_FULL_M. Callers gate land to alpha 0 with the
 * tile's own `ocean` flag — depth alone can't tell coastal land (elevation at
 * exactly sea level) from zero-depth sea. */
export function waterColorAlpha(depthM: number): { r: number; g: number; b: number; a: number } {
  const t = Math.min(1, Math.max(0, depthM / DEEP_FULL_M));
  const s = t * t * (3 - 2 * t); // smoothstep
  const lerp = (from: number, to: number) => from + (to - from) * s;
  return {
    r: lerp(SHALLOW_COLOR[0], DEEP_COLOR[0]),
    g: lerp(SHALLOW_COLOR[1], DEEP_COLOR[1]),
    b: lerp(SHALLOW_COLOR[2], DEEP_COLOR[2]),
    a: lerp(SHALLOW_ALPHA, DEEP_ALPHA),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run src/views/ocean.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/views/ocean.ts src/views/ocean.test.ts
git commit -m "feat(ocean): pure water math — sea-level radius and depth-graded color/alpha"
```

---

### Task 2: `buildOceanGeometry` — a sea-level cube-sphere face with RGBA vertex colors

**Files:**
- Modify: `src/views/ocean.ts` (append)
- Test: `src/views/ocean.test.ts` (append)

**Interfaces:**
- Consumes: `tileGrid`, `TILE_QUADS` from `src/views/cubeSphere.ts`; `sampleTile` from `src/views/worldMesh.ts`; Task 1's `seaLevelRadius`, `waterColorAlpha`.
- Produces: `buildOceanGeometry(tiles: TilesScene, face: number, radius: number, reliefScale: number): THREE.BufferGeometry | null` — null when every sampled vertex on the face is land. Geometry has `position` (3), `normal` (3, unit position direction), `color` (4 — RGBA).

- [ ] **Step 1: Write the failing tests**

Append to `src/views/ocean.test.ts` (extend the import from `./ocean` with `buildOceanGeometry`, and add `import * as THREE from 'three';` if not present):

```ts
describe('buildOceanGeometry', () => {
  it('puts every vertex exactly at the sea-level radius, normals outward', () => {
    const tiles = oceanTiles();
    const geom = buildOceanGeometry(tiles, 0, 2, 60)!;
    const pos = geom.getAttribute('position');
    const nrm = geom.getAttribute('normal');
    const r = seaLevelRadius(tiles, 2, 60);
    for (let i = 0; i < pos.count; i++) {
      const len = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      expect(len).toBeCloseTo(r, 6);
      // normal = unit position direction (a sphere's exact normal)
      expect(nrm.getX(i) * r).toBeCloseTo(pos.getX(i), 5);
      expect(nrm.getY(i) * r).toBeCloseTo(pos.getY(i), 5);
      expect(nrm.getZ(i) * r).toBeCloseTo(pos.getZ(i), 5);
    }
  });
  it('carries RGBA colors: alpha 0 over land, graded alpha over ocean', () => {
    const tiles = oceanTiles();
    const geom = buildOceanGeometry(tiles, 0, 2, 60)!;
    const color = geom.getAttribute('color');
    expect(color.itemSize).toBe(4);
    const alphas = new Set<number>();
    for (let i = 0; i < color.count; i++) alphas.add(color.getW(i));
    expect(alphas.has(0)).toBe(true); // land vertices exist on this face
    // 100 m deep ocean: the exact graded alpha, not a guess
    const expected = waterColorAlpha(100).a;
    expect([...alphas].some((a) => Math.abs(a - expected) < 1e-6)).toBe(true);
  });
  it('returns null for a face with no ocean at all', () => {
    const tiles = oceanTiles();
    tiles.ocean = tiles.ocean.map(() => false);
    expect(buildOceanGeometry(tiles, 0, 2, 60)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run src/views/ocean.test.ts`
Expected: FAIL — `buildOceanGeometry` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/views/ocean.ts` (add the imports to the top of the file):

```ts
import * as THREE from 'three';
import { TILE_QUADS, tileGrid } from './cubeSphere';
import { sampleTile } from './worldMesh';
```

```ts
/** One cube face of the sea: a smooth sphere at `seaLevelRadius`, RGBA
 * vertex colors carrying the depth grading (alpha 0 over land, so continents
 * punch through with a soft coastline). Normals are the unit position
 * directions — exact for a sphere, and identical across face edges by
 * construction, so no seam stitching is needed. Returns null when the whole
 * face is land (no mesh at all beats an invisible one). */
export function buildOceanGeometry(
  tiles: TilesScene,
  face: number,
  radius: number,
  reliefScale: number,
): THREE.BufferGeometry | null {
  const grid = tileGrid({ face, level: 0, ix: 0, iy: 0 });
  const n = TILE_QUADS + 1;
  const r = seaLevelRadius(tiles, radius, reliefScale);
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 4);
  let hasOcean = false;
  for (let i = 0; i < n * n; i++) {
    const ux = grid.units[3 * i]!;
    const uy = grid.units[3 * i + 1]!;
    const uz = grid.units[3 * i + 2]!;
    positions[3 * i] = ux * r;
    positions[3 * i + 1] = uy * r;
    positions[3 * i + 2] = uz * r;
    normals[3 * i] = ux;
    normals[3 * i + 1] = uy;
    normals[3 * i + 2] = uz;
    const lat = grid.lats[i]!;
    const lon = grid.lons[i]!;
    const ocean = sampleTile(tiles, lat, lon, 'ocean');
    const water = waterColorAlpha(tiles.sea_level_m - sampleTile(tiles, lat, lon, 'elevation_m'));
    colors[4 * i] = water.r;
    colors[4 * i + 1] = water.g;
    colors[4 * i + 2] = water.b;
    colors[4 * i + 3] = ocean ? water.a : 0;
    if (ocean) hasOcean = true;
  }
  if (!hasOcean) return null;
  const indices: number[] = [];
  for (let row = 0; row < TILE_QUADS; row++) {
    for (let col = 0; col < TILE_QUADS; col++) {
      const i00 = row * n + col;
      const i10 = row * n + col + 1;
      const i01 = (row + 1) * n + col;
      const i11 = (row + 1) * n + col + 1;
      // Same CCW winding as worldMesh's buildFaceGeometry — outward-facing
      // on every face without a per-face special case.
      indices.push(i00, i10, i11, i00, i11, i01);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  geom.setIndex(indices);
  return geom;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run src/views/ocean.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/views/ocean.ts src/views/ocean.test.ts
git commit -m "feat(ocean): sea-level face geometry with depth-graded RGBA vertex colors"
```

---

### Task 3: `createOcean` — the mountable water layer

**Files:**
- Modify: `src/views/ocean.ts` (append)
- Test: `src/views/ocean.test.ts` (append)

**Interfaces:**
- Consumes: Task 2's `buildOceanGeometry`.
- Produces (Task 4 relies on these exact names):
  - `interface OceanView { object3d: THREE.Object3D; setTrueRelief(on: boolean): void; update(day: number): void }`
  - `createOcean(tiles: TilesScene, radius: number, schematicReliefScale: number): OceanView`
  - Root object named `'ocean'`; face meshes named `'ocean-face-<n>'` with no-op `raycast`.
  - `update(day)` is a stage-2 hook; after Task 5 it drives the wave drift. Material: `vertexColors: true, transparent: true, roughness: 0.2, metalness: 0, depthWrite: false`.

- [ ] **Step 1: Write the failing tests**

Append to `src/views/ocean.test.ts` (extend the `./ocean` import with `createOcean`):

```ts
describe('createOcean', () => {
  it('mounts one mesh per ocean-bearing face, raycast-transparent, watery material', () => {
    const ocean = createOcean(oceanTiles(), 2, 60);
    expect(ocean.object3d.name).toBe('ocean');
    const meshes = ocean.object3d.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);
    expect(meshes.length).toBeGreaterThan(0);
    for (const m of meshes) {
      expect(m.name.startsWith('ocean-face-')).toBe(true);
      // Picking must pass through the water to the world beneath.
      const hits: THREE.Intersection[] = [];
      m.raycast(new THREE.Raycaster(new THREE.Vector3(0, 0, 6), new THREE.Vector3(0, 0, -1)), hits);
      expect(hits).toEqual([]);
      const mat = m.material as THREE.MeshStandardMaterial;
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
      expect(mat.vertexColors).toBe(true);
      expect(mat.roughness).toBeLessThan(0.5); // glossy enough to glint
    }
  });
  it('setTrueRelief moves the surface to the 1x sea-level radius and back', () => {
    const tiles = oceanTiles();
    const ocean = createOcean(tiles, 2, 60);
    const mesh = ocean.object3d.children.find((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh)!;
    const radiusOf = (m: THREE.Mesh) => {
      const p = m.geometry.getAttribute('position');
      return Math.hypot(p.getX(0), p.getY(0), p.getZ(0));
    };
    expect(radiusOf(mesh)).toBeCloseTo(seaLevelRadius(tiles, 2, 60), 6);
    ocean.setTrueRelief(true);
    expect(radiusOf(mesh)).toBeCloseTo(seaLevelRadius(tiles, 2, 1), 6);
    ocean.setTrueRelief(false);
    expect(radiusOf(mesh)).toBeCloseTo(seaLevelRadius(tiles, 2, 60), 6);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run src/views/ocean.test.ts`
Expected: FAIL — `createOcean` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/views/ocean.ts`:

```ts
/** The ocean's public surface: a mountable node plus the two drivers the
 * globe view forwards (relief toggle, per-frame day). */
export interface OceanView {
  object3d: THREE.Object3D;
  /** Swap to 1× (true) or schematic (false) sea-level radius — mirrors the
   * terrain's lazily-built second geometry set. */
  setTrueRelief(on: boolean): void;
  /** Per-frame driver. Stage 1: reserved (no-op). Stage 2 drifts the wave
   * normal map deterministically from the sim day. */
  update(day: number): void;
}

/** Build the water layer for a globe of `radius` whose schematic relief
 * exaggeration is `schematicReliefScale` (the globe passes its own
 * RELIEF_EXAGGERATION; true relief is always 1×). */
export function createOcean(
  tiles: TilesScene,
  radius: number,
  schematicReliefScale: number,
): OceanView {
  const root = new THREE.Object3D();
  root.name = 'ocean';
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    transparent: true,
    roughness: 0.2,
    metalness: 0,
    depthWrite: false,
  });
  // Only ocean-bearing faces get meshes; remember which, so the true-relief
  // set (lazily built) pairs up by face index.
  const faceMeshes = new Map<number, THREE.Mesh>();
  for (let face = 0; face < 6; face++) {
    const geom = buildOceanGeometry(tiles, face, radius, schematicReliefScale);
    if (!geom) continue;
    const mesh = new THREE.Mesh(geom, material);
    mesh.name = `ocean-face-${face}`;
    // Clicks pass through the water to the world beneath.
    mesh.raycast = () => {};
    root.add(mesh);
    faceMeshes.set(face, mesh);
  }
  const schematicGeoms = new Map([...faceMeshes].map(([f, m]) => [f, m.geometry]));
  let trueGeoms: Map<number, THREE.BufferGeometry> | null = null;
  function setTrueRelief(on: boolean): void {
    if (on && trueGeoms === null) {
      trueGeoms = new Map(
        [...faceMeshes.keys()].map((f) => [f, buildOceanGeometry(tiles, f, radius, 1)!]),
      );
    }
    for (const [f, mesh] of faceMeshes) {
      mesh.geometry = (on ? trueGeoms! : schematicGeoms).get(f)!;
    }
  }
  function update(_day: number): void {
    // Stage 2 (wave drift) fills this in; the signature is the contract.
  }
  return { object3d: root, setTrueRelief, update };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run src/views/ocean.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/views/ocean.ts src/views/ocean.test.ts
git commit -m "feat(ocean): createOcean — mountable, raycast-transparent water layer with relief toggle"
```

---

### Task 4: Mount the ocean in the globe view

**Files:**
- Modify: `src/views/globe.ts`
- Test: `src/views/globe.test.ts` (append)

**Interfaces:**
- Consumes: Task 3's `createOcean(tiles, radius, schematicReliefScale)` and `OceanView`.
- Produces: the globe view now contains a node named `'ocean'`; `GlobeView.setTrueRelief` and `GlobeView.update` drive the ocean too. No public API change.

- [ ] **Step 1: Write the failing test**

Append to `src/views/globe.test.ts`:

```ts
test('the globe carries an ocean layer that follows the relief toggle', () => {
  // markerTiles is all land — give the west half sea so the ocean mounts.
  const tiles = markerTiles([]);
  tiles.sea_level_m = -2500;
  tiles.elevation_m = [-2600, -2600, -2000, -2000, -2600, -2600, -2000, -2000];
  tiles.ocean = [true, true, false, false, true, true, false, false];
  const view = createGlobeView(tiles, spinningSys());
  const ocean = view.object3d.getObjectByName('ocean')!;
  expect(ocean).toBeDefined();
  const mesh = ocean.children.find((c) => (c as THREE.Mesh).isMesh)! as THREE.Mesh;
  const radiusOf = () => {
    const p = mesh.geometry.getAttribute('position');
    return Math.hypot(p.getX(0), p.getY(0), p.getZ(0));
  };
  const before = radiusOf();
  view.setTrueRelief(true);
  expect(radiusOf()).not.toBeCloseTo(before, 6);
  view.setTrueRelief(false);
  expect(radiusOf()).toBeCloseTo(before, 6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/views/globe.test.ts`
Expected: FAIL — `getObjectByName('ocean')` returns undefined.

- [ ] **Step 3: Wire the ocean into `createGlobeView`**

In `src/views/globe.ts`, add the import:

```ts
import { createOcean } from './ocean';
```

In `createGlobeView`, after the face-mesh loop and normal stitching (right before the `trueGeoms` declaration), add:

```ts
  // The water layer: a smooth translucent sphere at sea level, over the
  // displaced seafloor — spinning with the ground so wave motion (stage 2)
  // stays fixed to the world, not the camera.
  const ocean = createOcean(tiles, GLOBE_RADIUS, RELIEF_EXAGGERATION);
  spinGroup.add(ocean.object3d);
```

In `setTrueRelief`, after the marker reseat loop, add:

```ts
    ocean.setTrueRelief(on);
```

In `update`, immediately after `spinGroup.rotation.z = rotationPhase(sys, day) * TAU;`, add:

```ts
    ocean.update(day);
```

- [ ] **Step 4: Run the full suite and typecheck**

Run: `./node_modules/.bin/vitest run && npx tsc --noEmit`
Expected: all tests PASS, tsc silent. (The whole suite, not just globe: the ocean now renders inside every existing globe test's scene graph.)

- [ ] **Step 5: Commit**

```bash
git add src/views/globe.ts src/views/globe.test.ts
git commit -m "feat(globe): mount the ocean layer — translucent sea over the seafloor"
```

---

### Task 5: Stage 2 — deterministic wave drift on a generated normal map

**Files:**
- Modify: `src/views/ocean.ts`
- Test: `src/views/ocean.test.ts` (append)

**Interfaces:**
- Consumes: `fnv1a32`, `mulberry32` from `src/util/prng.ts` (the starfield's precedent for seeded cosmetic randomness).
- Produces:
  - `waveOffset(day: number): { x: number; y: number }` — pure, exported; fractional UV offset of the wave normal map at `day`.
  - `createOcean`'s `update(day)` applies `waveOffset` to the material's normal map (when a 2D canvas context exists — happy-dom has none, so tests cover the pure function and the null-context no-crash path).

- [ ] **Step 1: Write the failing tests**

Append to `src/views/ocean.test.ts` (extend the `./ocean` import with `waveOffset`):

```ts
describe('wave drift', () => {
  it('waveOffset is a pure, wrapped function of the sim day', () => {
    expect(waveOffset(0)).toEqual({ x: 0, y: 0 });
    const a = waveOffset(12.375);
    expect(waveOffset(12.375)).toEqual(a); // deterministic
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.x).toBeLessThan(1);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(a.y).toBeLessThan(1);
    // Distinct days give distinct sea states.
    expect(waveOffset(12.5)).not.toEqual(a);
  });
  it('update(day) survives a DOM with no 2D canvas (happy-dom)', () => {
    const ocean = createOcean(oceanTiles(), 2, 60);
    expect(() => ocean.update(42.5)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run src/views/ocean.test.ts`
Expected: FAIL — `waveOffset` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/views/ocean.ts`, add to the imports:

```ts
import { fnv1a32, mulberry32 } from '../util/prng';
```

Add above `createOcean`:

```ts
/** UV drift of the wave normal map per sim day. Two incommensurate rates so
 * the pattern never visibly loops; slow enough that 1 day/s (the globe
 * clock's cap) shimmers rather than strobes, fast enough that 1 hr/s
 * visibly lives. */
const WAVE_DRIFT_PER_DAY = { x: 0.37, y: 0.13 };

/** How strongly the wave normals dent the lighting — subtle: the sea should
 * shimmer, not boil. */
const WAVE_NORMAL_SCALE = 0.15;

/** Repeats of the (tileable) wave texture around the sphere. */
const WAVE_REPEAT = 6;

const frac = (v: number) => v - Math.floor(v);

/** The wave normal map's UV offset at `day` — pure and wrapped to [0,1), so
 * the same day always shows the same sea (spec: sim-clock determinism). */
export function waveOffset(day: number): { x: number; y: number } {
  return { x: frac(day * WAVE_DRIFT_PER_DAY.x), y: frac(day * WAVE_DRIFT_PER_DAY.y) };
}

/** A small tileable wave normal map, generated deterministically on a canvas
 * (the deploy CSP forbids fetched assets). Height field = a seeded sum of
 * integer-frequency sines (integer wave numbers keep it tileable); normals
 * come from its finite differences. Returns null where no 2D context exists
 * (happy-dom) — the ocean then simply has no wave detail, matching how
 * buildLabelSprite degrades. */
function buildWaveNormalMap(): THREE.CanvasTexture | null {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const rand = mulberry32(fnv1a32('goldengrove/ocean/waves'));
  // A fixed handful of tileable plane waves: integer frequencies, random
  // phase and direction mix.
  const waves = Array.from({ length: 6 }, () => ({
    fx: 1 + Math.floor(rand() * 4),
    fy: 1 + Math.floor(rand() * 4),
    phase: rand() * Math.PI * 2,
    amp: 0.5 + rand(),
  }));
  const height = (x: number, y: number) =>
    waves.reduce(
      (h, w) => h + w.amp * Math.sin(((x * w.fx + y * w.fy) / size) * Math.PI * 2 + w.phase),
      0,
    );
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Central differences with wrap: tileable normals from a tileable field.
      const dx = height((x + 1) % size, y) - height((x - 1 + size) % size, y);
      const dy = height(x, (y + 1) % size) - height(x, (y - 1 + size) % size);
      const inv = 1 / Math.hypot(dx, dy, 2);
      const i = 4 * (y * size + x);
      img.data[i] = Math.round(((-dx * inv) * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round(((-dy * inv) * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.round(((2 * inv) * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(WAVE_REPEAT, WAVE_REPEAT);
  return texture;
}
```

In `createOcean`, after the `material` construction, add:

```ts
  const waves = buildWaveNormalMap();
  if (waves) {
    material.normalMap = waves;
    material.normalScale = new THREE.Vector2(WAVE_NORMAL_SCALE, WAVE_NORMAL_SCALE);
  }
```

Replace the `update` stub with:

```ts
  function update(day: number): void {
    if (!material.normalMap) return; // headless DOM: no waves to drift
    const { x, y } = waveOffset(day);
    material.normalMap.offset.set(x, y);
  }
```

**Note:** the ocean geometry has no `uv` attribute yet — a normal map needs UVs. Add them in `buildOceanGeometry`: after the `colors` fill loop, derive equirect UVs from each vertex's lat/lon so the texture wraps the sphere seamlessly at integer repeats:

```ts
  const uvs = new Float32Array(n * n * 2);
  for (let i = 0; i < n * n; i++) {
    uvs[2 * i] = (grid.lons[i]! + 180) / 360;
    uvs[2 * i + 1] = (grid.lats[i]! + 90) / 180;
  }
```

and register it alongside the other attributes:

```ts
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
```

(A normal map also needs tangents; three.js derives screen-space tangents automatically when none are supplied, which is fine at this subtlety level.)

- [ ] **Step 4: Run the full suite and typecheck**

Run: `./node_modules/.bin/vitest run && npx tsc --noEmit`
Expected: all tests PASS, tsc silent.

- [ ] **Step 5: Commit**

```bash
git add src/views/ocean.ts src/views/ocean.test.ts
git commit -m "feat(ocean): sim-clock wave drift on a generated tileable normal map"
```

---

### Task 6: End-to-end verification and visual tuning

**Files:**
- No planned source changes (tuning commits only if screenshots demand them: `roughness`, `WAVE_NORMAL_SCALE`, alphas/colors in `src/views/ocean.ts`).

**Interfaces:**
- Consumes: everything above, plus the repo's verification setup: `public/hornvale_world.wasm` must exist (`npm run wasm:release` if missing); e2e needs `npm run build -- --base=/orrery/` (a default-base build fails with "catalog unavailable").

- [ ] **Step 1: Full suite, typecheck, build, e2e**

```bash
./node_modules/.bin/vitest run && npx tsc --noEmit
npm run build -- --base=/orrery/
npm run e2e
```

Expected: all unit tests PASS; tsc silent; build succeeds; both Playwright specs PASS.

- [ ] **Step 2: Visual verification in the real app**

Serve and screenshot (the session's established pattern — script lives inside the project so node resolves `@playwright/test`, and is deleted after):

```bash
cat > shots.tmp.mjs <<'EOF'
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:4173/orrery/#seed=42&view=globe&day=1.2');
await page.locator('.hud-top-left').waitFor({ timeout: 150_000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'ocean-1-schematic.png' });
await page.getByRole('button', { name: 'true scale' }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: 'ocean-2-true.png' });
console.log('ERRORS:', JSON.stringify(errors));
await browser.close();
EOF
node e2e/serve.mjs & sleep 1
node shots.tmp.mjs; pkill -f "node e2e/serve.mjs"; rm shots.tmp.mjs
```

Inspect both screenshots for: a specular glint patch on the day-side sea; matte land; shallows showing the seafloor; deep ocean dark and near-opaque; the terminator still honest (night sea dark); no artifacts at the 1× toggle; settlement dots/labels unaffected.

- [ ] **Step 3: Tune if needed**

If the glint is blown out or invisible, adjust `roughness` (0.15–0.35); if waves distract, lower `WAVE_NORMAL_SCALE`; if shallows read as land, raise `SHALLOW_ALPHA`. One knob per commit, re-screenshot after each.

- [ ] **Step 4: Final commit**

```bash
git add -A src/
git commit -m "feat(ocean): visual tuning from screenshot verification"
```

(Skip if no tuning was needed.)
