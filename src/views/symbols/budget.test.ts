import { expect, test } from 'vitest';
import { rungForZoom, selectByBudget, RUNG_BUDGETS } from './budget';

test('rung coarsens as the visible arc widens', () => {
  expect(rungForZoom(2.0)).toBe('far');
  expect(rungForZoom(0.05)).toBe('near');
});

test('selectByBudget takes the top-N pre-sorted items', () => {
  expect(selectByBudget([1, 2, 3, 4, 5], 3)).toEqual([1, 2, 3]);
  expect(selectByBudget([1, 2], 5)).toEqual([1, 2]);
});

test('budgets grow richer from far to near', () => {
  expect(RUNG_BUDGETS.near.peaks).toBeGreaterThan(RUNG_BUDGETS.far.peaks);
  expect(RUNG_BUDGETS.near.peakMinElevationM).toBeLessThan(RUNG_BUDGETS.far.peakMinElevationM);
});
