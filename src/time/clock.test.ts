import { describe, expect, it } from 'vitest';
import { clockToDay, SimClock } from './clock';

describe('SimClock', () => {
  it('accumulates wall time scaled by speed', () => {
    const c = new SimClock();
    c.speed = 3600;
    c.tick(0.5);
    expect(c.t).toBeCloseTo(1800);
  });

  it('does not advance while paused', () => {
    const c = new SimClock();
    c.paused = true;
    c.tick(10);
    expect(c.t).toBe(0);
  });
});

describe('clockToDay', () => {
  it('scales elapsed wall time by the days/second rate', () => {
    expect(clockToDay(2000, 5)).toBeCloseTo(10);
  });

  it('is zero at zero elapsed time regardless of rate', () => {
    expect(clockToDay(0, 100)).toBe(0);
  });
});
