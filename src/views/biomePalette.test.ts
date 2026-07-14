import { describe, expect, it } from 'vitest';
import { BIOME_COUNT, BIOME_RGB, biomeColor, biomeColorForName } from './biomePalette';

describe('BIOME_RGB', () => {
  it('has exactly BIOME_COUNT rows', () => {
    expect(BIOME_RGB.length).toBe(BIOME_COUNT);
    expect(BIOME_COUNT).toBe(13);
  });

  it('every row is a valid RGB triple', () => {
    for (const row of BIOME_RGB) {
      expect(row.length).toBe(3);
      for (const c of row) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('biomeColor', () => {
  it('returns the exact palette row at shade 1.0', () => {
    expect(biomeColor(0, 1)).toEqual([12, 42, 82]); // DeepOcean
    expect(biomeColor(9, 1)).toEqual([47, 107, 60]); // TropicalRainforest
  });

  it('clamps out-of-range indices to 12 (AlpineRock grey)', () => {
    expect(biomeColor(12, 1)).toEqual([141, 133, 120]);
    expect(biomeColor(13, 1)).toEqual([141, 133, 120]);
    expect(biomeColor(255, 1)).toEqual([141, 133, 120]);
    expect(biomeColor(-1, 1)).toEqual([141, 133, 120]);
  });

  it('scales brightness like hypsometricColor shade', () => {
    const flat = biomeColor(6, 1.0);
    const lit = biomeColor(6, 1.15);
    const shadow = biomeColor(6, 0.8);
    expect(lit[0]).toBeGreaterThan(flat[0]);
    expect(shadow[0]).toBeLessThan(flat[0]);
  });

  it('never exceeds 255 even when shaded up', () => {
    const [r, g, b] = biomeColor(3, 1.15); // IceCap is near-white
    expect(r).toBeLessThanOrEqual(255);
    expect(g).toBeLessThanOrEqual(255);
    expect(b).toBeLessThanOrEqual(255);
  });
});

describe('biomeColorForName', () => {
  it('resolves an exact-match legend name to its gg row', () => {
    expect(biomeColorForName('tundra')).toEqual(BIOME_RGB[4]); // Tundra
    expect(biomeColorForName('temperate-forest')).toEqual(BIOME_RGB[6]); // TemperateForest
    expect(biomeColorForName('savanna')).toEqual(BIOME_RGB[8]); // Savanna
    expect(biomeColorForName('tropical-rainforest')).toEqual(BIOME_RGB[9]); // TropicalRainforest
  });

  it('derives a name with no gg counterpart as a blend between its two nearest rows', () => {
    const [r, g, b] = biomeColorForName('shrubland');
    const grassland = BIOME_RGB[7]!;
    const savanna = BIOME_RGB[8]!;
    expect(r).toBeGreaterThanOrEqual(Math.min(grassland[0], savanna[0]));
    expect(r).toBeLessThanOrEqual(Math.max(grassland[0], savanna[0]));
    expect(g).toBeGreaterThanOrEqual(Math.min(grassland[1], savanna[1]));
    expect(g).toBeLessThanOrEqual(Math.max(grassland[1], savanna[1]));
    expect(b).toBeGreaterThanOrEqual(Math.min(grassland[2], savanna[2]));
    expect(b).toBeLessThanOrEqual(Math.max(grassland[2], savanna[2]));
  });

  it('falls back to AlpineRock grey for an unrecognized name', () => {
    expect(biomeColorForName('not-a-real-biome')).toEqual([141, 133, 120]);
  });
});
