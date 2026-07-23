/** Discrete level-of-detail rungs, coarsest to finest. */
export type Rung = 'far' | 'mid' | 'near';

/** Per-rung symbol budget and visibility thresholds. */
export interface RungBudget {
  /** Max number of peak symbols to show at this rung. */
  peaks: number;
  /** Max number of forest symbols to show at this rung. */
  forests: number;
  /** Minimum elevation (m) a peak must have to be eligible at this rung. */
  peakMinElevationM: number;
  /** Minimum area a forest patch must have to be eligible at this rung. */
  forestMinArea: number;
}

// Visual-pass-tuned. Thresholds fall and budgets rise as we zoom in, so finer
// features emerge. Angular radius (rad) of the visible cap drives the rung.
export const RUNG_BUDGETS: Record<Rung, RungBudget> = {
  far: { peaks: 16, forests: 12, peakMinElevationM: 3000, forestMinArea: 60 },
  mid: { peaks: 55, forests: 45, peakMinElevationM: 1500, forestMinArea: 15 },
  near: { peaks: 150, forests: 120, peakMinElevationM: 500, forestMinArea: 3 },
};

/** Coarser rung when more of the sphere is visible. Boundaries visual-tuned. */
export function rungForZoom(visibleAngularRadiusRad: number): Rung {
  if (visibleAngularRadiusRad > 0.8) return 'far';
  if (visibleAngularRadiusRad > 0.25) return 'mid';
  return 'near';
}

/** Items arrive pre-sorted by salience (Task 2); take the first `budget`. */
export function selectByBudget<T>(items: T[], budget: number): T[] {
  return items.slice(0, Math.max(0, budget));
}
