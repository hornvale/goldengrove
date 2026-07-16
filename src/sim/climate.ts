/** Client-side evaluators for scene/tiles/v1 climate layers — the normative
 * formulas documented in the book's scene/tiles/v1 reference. Mirrors the
 * shape of ./ephemeris.ts (pure functions over parsed scene documents). */
import type { TilesScene } from "./scene";

const frac = (x: number) => x - Math.floor(x);

/** Temperature at tile `i` on absolute standard `day`, °C. Self-contained:
 * the seasonal period is the document's own `season_period_days`, and the
 * phase is NOT offset by scene/system/v1's year_phase_offset. */
export function temperatureAt(tiles: TilesScene, i: number, day: number): number {
  return tiles.t_mean_c[i]! + tiles.t_swing_c[i]! * Math.sin(2 * Math.PI * frac(day / tiles.season_period_days));
}

/** Coldest-season temperature at tile `i`, °C — the freeze test's input. */
export function coldestC(tiles: TilesScene, i: number): number {
  return tiles.t_mean_c[i]! - Math.abs(tiles.t_swing_c[i]!);
}

/** Prevailing wind band + direction at a latitude, given the document's
 * circulation_bands. Even bands easterly (rising/wet), odd westerly. */
export function windAt(bands: number, latitudeDeg: number): { band: number; direction: "easterly" | "westerly" } {
  const width = 90 / bands;
  const band = Math.min(Math.floor(Math.abs(latitudeDeg) / width), bands - 1);
  return { band, direction: band % 2 === 0 ? "easterly" : "westerly" };
}
