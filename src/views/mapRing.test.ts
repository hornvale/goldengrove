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
