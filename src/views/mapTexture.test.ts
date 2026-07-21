import { describe, expect, test } from 'vitest';
import { regionPixelRGBA } from './mapTexture';
import type { RegionScene } from '../sim/scene';

function region(samples: number, fill: Partial<RegionScene>): RegionScene {
  const n = (samples + 1) * (samples + 1);
  return {
    schema: 'scene/tiles-region/v1', seed: 42, face: 0, level: 3, ix: 0, iy: 0,
    samples, sea_level_m: 0, season_period_days: 360, circulationBands: 3,
    biomeLegend: ['deep-ocean', 'temperate-forest'],
    elevation_m: Array.from({ length: n }, () => 100),
    ocean: Array.from({ length: n }, () => false),
    biome: Array.from({ length: n }, () => 1),
    plate: Array.from({ length: n }, () => 0),
    unrest: Array.from({ length: n }, () => 0),
    ...fill,
  } as unknown as RegionScene;
}

describe('regionPixelRGBA', () => {
  test('produces 4 RGBA bytes per node', () => {
    const s = 4;
    const rgba = regionPixelRGBA(region(s, {}));
    expect(rgba.length).toBe(4 * (s + 1) * (s + 1));
  });

  test('ocean nodes are blue-dominant, forest nodes green-dominant, alpha opaque', () => {
    const s = 2;
    const n = (s + 1) * (s + 1);
    const allOcean = regionPixelRGBA(region(s, { ocean: Array.from({ length: n }, () => true), elevation_m: Array.from({ length: n }, () => -1000) }));
    expect(allOcean[2]!).toBeGreaterThan(allOcean[0]!); // B > R on node 0
    expect(allOcean[3]).toBe(255); // opaque
    const allForest = regionPixelRGBA(region(s, {})); // biome index 1 = temperate-forest, land
    expect(allForest[1]!).toBeGreaterThan(allForest[2]!); // G > B on node 0
  });
});
