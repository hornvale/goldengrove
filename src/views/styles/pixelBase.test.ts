import { expect, test } from 'vitest';
import { pixelColorFor, PIXEL_STEP } from './pixelBase';
import type { TilesScene } from '../../sim/scene';

const src = { ocean: [true, false] } as unknown as TilesScene;

test('an ocean tile stays blue-dominant (never takes a land colour)', () => {
  // feed a LAND-green input; the treatment must not let ocean read green
  const [r, g, b] = pixelColorFor([80, 140, 70], src, 0);
  expect(b).toBeGreaterThan(r);
  expect(b).toBeGreaterThan(g);
});

test('a land tile with no biome data falls back to the quantized lens hue', () => {
  const [r, g, b] = pixelColorFor([80, 140, 70], src, 1);
  expect(g).toBeGreaterThan(b); // green land stays green-dominant
  for (const c of [r, g, b]) expect(c % PIXEL_STEP === 0 || c === 255).toBe(true);
});

test('curated biome palette: ice stays legible (not a white blob), forest is green', () => {
  const world = {
    ocean: [false, false],
    biome: [0, 1],
    biomeLegend: ['ice', 'temperate-forest'],
  } as unknown as TilesScene;
  const ice = pixelColorFor([0, 0, 0], world, 0);
  expect(ice[0] > 240 && ice[1] > 240 && ice[2] > 240).toBe(false); // never near-white
  const forest = pixelColorFor([0, 0, 0], world, 1);
  expect(forest[1]).toBeGreaterThan(forest[0]); // green-dominant
  expect(forest[1]).toBeGreaterThan(forest[2]);
});

test('ocean is depth-toned: deep is a darker blue than shallow', () => {
  const world = { ocean: [true, true], elevation_m: [-3000, -100], sea_level_m: 0 } as unknown as TilesScene;
  const deep = pixelColorFor([0, 0, 0], world, 0);
  const shallow = pixelColorFor([0, 0, 0], world, 1);
  expect(deep[2]).toBeGreaterThan(deep[0]); // blue-dominant
  expect(shallow[2]).toBeGreaterThan(deep[2]); // shallow is a lighter blue
});

test('a river node colours as flowing blue, distinct from ocean and land', () => {
  const world = {
    ocean: [false, false, false],
    biome: [0],
    biomeLegend: ['temperate-forest'],
    water: [2, 3, 0],
    waterLegend: ['ocean', 'salt-basin', 'river', 'dry-land'],
    drainage: [1.0, 0, 0],
  } as unknown as TilesScene;
  const river = pixelColorFor([0, 0, 0], world, 0);
  expect(river[2]).toBeGreaterThan(river[0]); // blue-dominant
  expect(river[2]).toBeGreaterThan(river[1]);

  const dryLand = pixelColorFor([0, 0, 0], world, 1);
  expect(river).not.toEqual(dryLand);

  const oceanTile = { ...world, water: [0, 3, 0] } as unknown as TilesScene;
  const oceanColor = pixelColorFor([0, 0, 0], oceanTile, 0);
  expect(river).not.toEqual(oceanColor);
});

test('a river brightens with higher drainage (big river vs a creek)', () => {
  const world = {
    ocean: [false, false],
    water: [2, 2],
    waterLegend: ['ocean', 'salt-basin', 'river', 'dry-land'],
    drainage: [0.1, 10.0],
  } as unknown as TilesScene;
  const creek = pixelColorFor([0, 0, 0], world, 0);
  const bigRiver = pixelColorFor([0, 0, 0], world, 1);
  expect(bigRiver[2]).toBeGreaterThanOrEqual(creek[2]);
  expect(bigRiver[0] + bigRiver[1] + bigRiver[2]).toBeGreaterThan(creek[0] + creek[1] + creek[2]);
});

test('a salt-basin node colours as a distinct still-lake tone', () => {
  const world = {
    ocean: [false, false, true],
    water: [1, 3, 0],
    waterLegend: ['ocean', 'salt-basin', 'river', 'dry-land'],
    drainage: [0, 0, 0],
    elevation_m: [10, 10, -3000],
    sea_level_m: 0,
  } as unknown as TilesScene;
  const lake = pixelColorFor([0, 0, 0], world, 0);
  const oceanColor = pixelColorFor([0, 0, 0], world, 2);
  const river = pixelColorFor([0, 0, 0], { ...world, water: [2, 3, 0] } as unknown as TilesScene, 0);
  expect(lake).not.toEqual(oceanColor);
  expect(lake).not.toEqual(river);
  // blue/green-ish: not a warm colour.
  expect(lake[2] + lake[1]).toBeGreaterThan(lake[0] * 1.5);
});
