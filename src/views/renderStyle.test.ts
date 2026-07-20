import { expect, test } from 'vitest';
import { STYLES, styleById, photorealStyle } from './renderStyle';
import { biomePalette } from './styles/pixelArt';

test('STYLES has photoreal first and every entry has a unique id + label', () => {
  expect(STYLES[0]).toBe(photorealStyle);
  const ids = STYLES.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length); // unique
  for (const s of STYLES) expect(s.label.length).toBeGreaterThan(0);
});

test('styleById returns the match, and falls back to photoreal for an unknown id', () => {
  expect(styleById('photoreal')).toBe(photorealStyle);
  expect(styleById('nope-not-a-style')).toBe(photorealStyle);
});

test('photoreal produces an empty effect chain (identity)', () => {
  const fakeTiles = { width: 1, height: 1, elevation_m: [0], biome: [0] } as never;
  expect(photorealStyle.passes(fakeTiles)).toEqual([]);
});

test('biomePalette is deterministic and bounded, ordered by biome frequency', () => {
  // 4 cells: biome 2 appears x3, biome 5 once → 2 must come before 5.
  const tiles = { width: 4, height: 1, elevation_m: [0, 0, 0, 0], biome: [2, 2, 2, 5] } as never;
  const a = biomePalette(tiles);
  const b = biomePalette(tiles);
  expect(a).toEqual(b); // deterministic
  expect(a.length).toBeGreaterThan(0);
  expect(a.length).toBeLessThanOrEqual(16); // bounded
  for (const [r, g, bl] of a) {
    for (const c of [r, g, bl]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  }
});

test('photoreal and filter styles declare no base or symbol layer', () => {
  for (const s of STYLES) {
    if (s.id === 'photoreal' || s.id === 'cel' || s.id === 'engraving' || s.id === 'watercolor') {
      expect(s.base).toBeUndefined();
      expect(s.symbolLayer).toBeUndefined();
    }
  }
  expect(photorealStyle.base).toBeUndefined();
});
