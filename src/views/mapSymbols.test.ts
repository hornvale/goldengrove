import { expect, test } from 'vitest';
import * as THREE from 'three';
import { buildMapSymbols } from './mapSymbols';
import type { RegionScene } from '../sim/scene';

function region(): RegionScene {
  const s = 8, dim = s + 1, n = dim * dim;
  const elevation_m = Array.from({ length: n }, (_, i) => (i === 40 ? 6000 : 100));
  return {
    schema: 'scene/tiles-region/v1', seed: 42, face: 0, level: 3, ix: 0, iy: 0,
    samples: s, sea_level_m: 0, season_period_days: 360, circulationBands: 3,
    biomeLegend: ['deep-ocean', 'temperate-forest'],
    elevation_m, ocean: elevation_m.map(() => false), biome: elevation_m.map(() => 1),
    plate: elevation_m.map(() => 0), unrest: elevation_m.map(() => 0),
  } as unknown as RegionScene;
}

test('near rung places more symbols than far; stable across identical updates', () => {
  const m = buildMapSymbols(region());
  m.update('far'); const far = m.group.children.length;
  m.update('near'); const near = m.group.children.length;
  expect(near).toBeGreaterThanOrEqual(far);
  const a = m.group.children.map((c) => c.position.toArray().join(','));
  m.update('near');
  const b = m.group.children.map((c) => c.position.toArray().join(','));
  expect(b).toEqual(a);
});

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
