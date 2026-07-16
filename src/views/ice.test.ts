import { expect, test } from 'vitest';
import { iceFraction } from './ice';
import type { TilesScene } from '../sim/scene';

function tile(mean: number, swing: number): TilesScene {
  return { t_mean_c: [mean], t_swing_c: [swing], season_period_days: 360 } as unknown as TilesScene;
}

test('a permanently cold tile is frozen year-round', () => {
  const t = tile(-20, 5);
  for (const day of [0, 90, 180, 270]) expect(iceFraction(t, 0, day)).toBe(1);
});

test('a warm tile never freezes', () => {
  const t = tile(25, 5);
  for (const day of [0, 90, 180, 270]) expect(iceFraction(t, 0, day)).toBe(0);
});

test('a seasonal tile freezes in its cold half and thaws in its warm half', () => {
  const t = tile(0, 15); // north tile: cold near day 270 (sin < 0), warm near day 90
  expect(iceFraction(t, 0, 270)).toBeGreaterThan(0.5);
  expect(iceFraction(t, 0, 90)).toBeLessThan(0.5);
});

test('locked tile (zero swing) is static — frozen iff mean below freeze', () => {
  expect(iceFraction(tile(-3, 0), 0, 0)).toBe(1);
  expect(iceFraction(tile(3, 0), 0, 999)).toBe(0);
});
