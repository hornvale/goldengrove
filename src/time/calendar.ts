/** Day-count reckoning, derived client-side from `year_days` alone — no
 * months, no leap terms. The sim's real calendar (months, leap structure)
 * lives sim-side and is deliberately NOT pulled across the scene-schema
 * boundary for a HUD line (spec §8; the schema is a cross-repo contract).
 * Honest and labeled as such: years and days are counted, not named. */

/** A moment in day-count reckoning. Fields are 0-based; display is 1-based. */
export interface RawDate {
  year: number;
  dayOfYear: number;
  dayFraction: number;
}

/** Split an ephemeris `day` (absolute, from genesis) by `yearDays`. */
export function dayToRawDate(day: number, yearDays: number): RawDate {
  const year = Math.floor(day / yearDays);
  const within = day - year * yearDays;
  const dayOfYear = Math.floor(within);
  return { year, dayOfYear, dayFraction: within - dayOfYear };
}

/** The ephemeris day at the start of (0-based) `year`/`dayOfYear`. */
export function rawDateToDay(year: number, dayOfYear: number, yearDays: number): number {
  return year * yearDays + dayOfYear;
}

/** Local convention (carried over from the retired HUD-local formatter): a
 * day is displayed as 24 "hours" of 60 "minutes" regardless of its
 * physical length — clock-faces travel between worlds. */
export function formatRawDate(d: RawDate): string {
  const totalMinutes = Math.floor(d.dayFraction * 24 * 60);
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  return `Y${d.year + 1} · Day ${d.dayOfYear + 1} · ${hh}:${mm}`;
}
