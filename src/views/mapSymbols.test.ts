import { expect, test } from 'vitest';
import * as THREE from 'three';
import { buildMapSymbols, iconForNode } from './mapSymbols';
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

test('iconForNode: volcano for a high-unrest high peak, cactus for desert, null for ocean', () => {
  const s = 4, dim = s + 1, n = dim * dim;
  const mk = (over: Partial<Record<string, unknown>>) => ({
    schema: 'scene/tiles-region/v1', seed: 42, face: 0, level: 3, ix: 0, iy: 0, samples: s,
    sea_level_m: 0, season_period_days: 360, circulationBands: 3,
    biomeLegend: ['deep-ocean', 'desert', 'temperate-rainforest'],
    elevation_m: Array.from({length:n},()=>100), ocean: Array.from({length:n},()=>false),
    biome: Array.from({length:n},()=>1), unrest: Array.from({length:n},()=>0),
    plate: Array.from({length:n},()=>0), ...over,
  } as unknown as RegionScene);
  // desert biome index 1
  expect(iconForNode(mk({}), 0)).toBe('cactus');
  // ocean node -> null
  expect(iconForNode(mk({ ocean: Array.from({length:n},()=>true) }), 0)).toBeNull();
  // high unrest + high elevation -> volcano (wins over biome)
  expect(iconForNode(mk({ unrest: Array.from({length:n},()=>0.95), elevation_m: Array.from({length:n},()=>5000) }), 0)).toBe('volcano');
});

test('icons appear at near but not far', async () => {
  const s = 6, dim = s+1, n = dim*dim;
  const region = { schema:'scene/tiles-region/v1', seed:42, face:0, level:3, ix:0, iy:0, samples:s,
    sea_level_m:0, season_period_days:360, circulationBands:3, biomeLegend:['deep-ocean','desert'],
    elevation_m:Array.from({length:n},()=>100), ocean:Array.from({length:n},()=>false),
    biome:Array.from({length:n},()=>1), unrest:Array.from({length:n},()=>0), plate:Array.from({length:n},()=>0) } as unknown as RegionScene;
  const { buildMapSymbols } = await import('./mapSymbols');
  const m = buildMapSymbols(region);
  m.update('far');
  const farIcons = m.group.children.filter((c) => c.userData.kind === 'icon').length;
  m.update('near');
  const nearIcons = m.group.children.filter((c) => c.userData.kind === 'icon').length;
  expect(farIcons).toBe(0);
  expect(nearIcons).toBeGreaterThan(0);
});
