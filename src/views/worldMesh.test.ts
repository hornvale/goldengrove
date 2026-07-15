import { describe, expect, it } from 'vitest';
import { REFERENCE_RADIUS_M, buildFaceGeometry } from './worldMesh';
import type { TilesScene } from '../sim/scene';

/** 4×2 all-land world, one uniform biome, 1000 m everywhere. */
function flatTiles(): TilesScene {
  const n = 8;
  return {
    schema: 'scene/tiles/v1', width: 4, height: 2, sea_level_m: 0,
    elevation_m: Array(n).fill(1000), ocean: Array(n).fill(false),
    biome: Array(n).fill(0), biomeLegend: ['steppe'], features: [],
  };
}

describe('buildFaceGeometry', () => {
  it('reliefScale 0 puts every vertex exactly on the sphere', () => {
    const geom = buildFaceGeometry(flatTiles(), 0, 2, 0);
    const pos = geom.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      // The position attribute is a Float32Array (required for WebGL vertex
      // upload — three.js throws on any other typed array; verified against
      // node_modules/three/src/renderers/webgl/WebGLAttributes.js), so the
      // achievable precision is float32's ~7 significant digits, not
      // float64's ~15. 6 digits (5e-7 tolerance) comfortably clears the
      // observed worst-case rounding (~8e-8) while still catching any real
      // formula bug, which would be off by orders of magnitude more.
      expect(r).toBeCloseTo(2, 6);
    }
  });
  it('reliefScale displaces by scale * elevation / reference radius', () => {
    const geom = buildFaceGeometry(flatTiles(), 0, 2, 60);
    const pos = geom.getAttribute('position');
    const expected = 2 * (1 + (60 * 1000) / REFERENCE_RADIUS_M);
    const r = Math.hypot(pos.getX(0), pos.getY(0), pos.getZ(0));
    expect(r).toBeCloseTo(expected, 6);
  });
});
