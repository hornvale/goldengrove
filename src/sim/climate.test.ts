/** Tests for ./climate: the producer-pinned equivalence against the frozen
 * seed-42 triples, plus plain unit tests for windAt/coldestC. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { temperatureAt, windAt, coldestC } from "./climate";
import { loadSeed42Tiles } from "./catalogFixture.test";
import type { TilesScene } from "./scene";

const triples = JSON.parse(readFileSync("testdata/climate-triples-seed-42.json", "utf8"));

test("temperatureAt reproduces the producer-pinned triples", async () => {
  const tiles = await loadSeed42Tiles(triples.width);
  expect(tiles.season_period_days).toBeCloseTo(triples.season_period_days, 5);
  for (const row of triples.rows) {
    expect(temperatureAt(tiles, row.i, row.day)).toBeCloseTo(row.t, 10);
  }
});

test("windAt buckets by latitude and alternates direction", () => {
  expect(windAt(3, 0).band).toBe(0);
  expect(windAt(3, 0).direction).toBe("easterly");
  expect(windAt(3, 45).band).toBe(1);
  expect(windAt(3, 45).direction).toBe("westerly");
  expect(windAt(3, 90).band).toBe(2); // clamped
});

test("coldestC is mean minus the swing magnitude", () => {
  const tiles = { t_mean_c: [10], t_swing_c: [-8] } as unknown as TilesScene;
  expect(coldestC(tiles, 0)).toBe(2);
});
