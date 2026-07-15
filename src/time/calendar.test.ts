import { describe, expect, it } from 'vitest';
import { dayToRawDate, formatRawDate, rawDateToDay } from './calendar';

describe('raw day-count calendar', () => {
  it('splits an ephemeris day into year / day-of-year / fraction', () => {
    expect(dayToRawDate(0, 365.25)).toEqual({ year: 0, dayOfYear: 0, dayFraction: 0 });
    const d = dayToRawDate(730.75, 365.25);
    expect(d.year).toBe(2);
    expect(d.dayOfYear).toBe(0);
    expect(d.dayFraction).toBeCloseTo(0.25, 10);
  });
  it('round-trips through rawDateToDay at day granularity', () => {
    const yearDays = 402.7;
    const day = rawDateToDay(3, 141, yearDays);
    const back = dayToRawDate(day, yearDays);
    expect(back.year).toBe(3);
    expect(back.dayOfYear).toBe(141);
  });
  it('formats as the 24x60 clock-face convention, 1-based for humans', () => {
    expect(formatRawDate({ year: 2, dayOfYear: 141, dayFraction: 0.5 })).toBe('Y3 · Day 142 · 12:00');
  });
});
