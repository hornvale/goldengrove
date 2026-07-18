import { describe, expect, it } from 'vitest';
import type { EclipseEvent } from '../sim/scene';
import { eclipseMarkPositions } from './eclipseMarks';

function solarTotal(day: number): EclipseEvent {
  return {
    day,
    moonIndex: 0,
    body: 'solar',
    kind: 'total',
    track: { centerLatDeg: 0, halfWidthDeg: 1.2, startLonDeg: -40, endLonDeg: 10, durationDays: 0.01 },
  };
}

function lunarAnnular(day: number): EclipseEvent {
  return { day, moonIndex: 1, body: 'lunar', kind: 'annular', track: null };
}

describe('eclipseMarkPositions', () => {
  it('places a day-184 event at leftFraction 0.5 on a 368-day scrubber', () => {
    const marks = eclipseMarkPositions([solarTotal(184)], 368);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.leftFraction).toBeCloseTo(0.5, 9);
  });

  it('carries distinct body/kind for a solar-total and a lunar-annular event', () => {
    const marks = eclipseMarkPositions([solarTotal(10), lunarAnnular(20)], 368);
    expect(marks).toHaveLength(2);
    expect(marks[0]).toMatchObject({ body: 'solar', kind: 'total' });
    expect(marks[1]).toMatchObject({ body: 'lunar', kind: 'annular' });
  });

  it('carries the original event for the click handler', () => {
    const event = solarTotal(10);
    const marks = eclipseMarkPositions([event], 368);
    expect(marks[0]!.event).toBe(event);
  });

  it('drops events outside [0, maxDay] rather than clamping them', () => {
    const outsideLow = solarTotal(-5);
    const inside = solarTotal(100);
    const outsideHigh = lunarAnnular(400);
    const marks = eclipseMarkPositions([outsideLow, inside, outsideHigh], 368);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.event).toBe(inside);
    expect(marks.some((m) => m.event === outsideLow)).toBe(false);
    expect(marks.some((m) => m.event === outsideHigh)).toBe(false);
  });

  it('keeps boundary days 0 and maxDay', () => {
    const atZero = solarTotal(0);
    const atMax = solarTotal(368);
    const marks = eclipseMarkPositions([atZero, atMax], 368);
    expect(marks).toHaveLength(2);
    expect(marks[0]!.leftFraction).toBe(0);
    expect(marks[1]!.leftFraction).toBe(1);
  });
});
