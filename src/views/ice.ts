/** Client-side seasonal ice from scene/tiles/v1 temperature layers — the
 * derivation documented (non-normatively) in the book's tiles reference.
 * Presentation only; the sim has no cryosphere (decision 0022). */
import type { TilesScene } from '../sim/scene';
import { temperatureAt } from '../sim/climate';

/** Frozen fraction [0,1] at tile `i` on `day`: 1 below freeze, 0 above, a
 * soft 2°C ramp so the ice edge isn't a hard line. Client derivation
 * (decision 0022) — the sim has no cryosphere. `yearPhaseOffset` threads
 * through to `temperatureAt` (`sys.world.yearPhaseOffset`); defaults to 0
 * for callers with no system scene in hand. */
export function iceFraction(
  tiles: TilesScene,
  i: number,
  day: number,
  yearPhaseOffset = 0,
  freezeC = 0,
): number {
  const t = temperatureAt(tiles, i, day, yearPhaseOffset);
  const ramp = 2;
  if (t <= freezeC - ramp) return 1;
  if (t >= freezeC) return 0;
  return (freezeC - t) / ramp;
}
