/** Maps wall time to simulation time. Sim time is f64 seconds from epoch. */
export class SimClock {
  t = 0;
  speed = 1;
  paused = false;

  tick(wallDtS: number): void {
    if (!this.paused) this.t += wallDtS * this.speed;
  }
}

/** Wall-clock elapsed milliseconds → simulated day count, at a constant
 * days/second rate. Pure and stateless — the orrery scrubber's autoplay
 * owns the play/pause and rebase-on-scrub logic; this just does the
 * arithmetic. */
export function clockToDay(elapsedMs: number, daysPerSecond: number): number {
  return (elapsedMs / 1000) * daysPerSecond;
}
