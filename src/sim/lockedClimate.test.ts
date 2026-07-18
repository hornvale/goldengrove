/** Tests for ./lockedClimate: the producer-pinned golden for seed 8 (tidally
 * locked) plus the seasonalTemperatureAt dispatcher. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { lockedTemperatureAt, seasonalTemperatureAt } from "./lockedClimate";
import { parseTiles } from "./scene";
import { readOut } from "./catalog";
import type { TilesScene } from "./scene";

/** Seed 8's `scene/system/v1` orbital elements (`hornvale scene system
 * --world <seed-8>`), hardcoded here rather than re-parsed per test run:
 * seed 8 is tidally locked (obliquity ~21.8°), the world this golden was
 * captured against (`windows/scene/examples/locked_temperature_golden.rs`).
 */
const SEED8 = {
  obliquityDeg: 21.786886,
  yearPhaseOffset: 0.55227045,
  luminosityRel: 0.40864556,
  orbitAu: 0.68649318,
};

/** `insolation_rel` (`hornvale_astronomy::insolation_rel` — the single
 * shared definition, SKY-15): `L / a²`, relative to Earth. */
const insolation = SEED8.luminosityRel / (SEED8.orbitAu * SEED8.orbitAu);

async function loadSeed8Tiles(width: number): Promise<TilesScene> {
  const bytes = readFileSync("public/hornvale_world.wasm");
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const e = instance.exports as any;
  e.hw_new(8n);
  if (e.hw_scene_tiles(width) !== 0) throw new Error(readOut(e));
  return parseTiles(readOut(e));
}

test("lockedTemperatureAt reproduces the Rust producer's locked-world golden (seed 8)", async () => {
  const tiles = await loadSeed8Tiles(64);
  expect(tiles.locked).toBe(true);
  const lines = readFileSync("testdata/locked-temperature-golden-seed8.csv", "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#"));
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    const [nodeStr, dayStr, tStr] = line.split(",");
    const node = Number(nodeStr);
    const day = Number(dayStr);
    const t = Number(tStr);
    const got = lockedTemperatureAt(
      tiles,
      node,
      day,
      tiles.season_period_days,
      SEED8.obliquityDeg,
      SEED8.yearPhaseOffset,
      insolation,
    );
    expect(Math.abs(got - t)).toBeLessThan(1e-3);
  }
});

test("seasonalTemperatureAt routes a locked tiles document to lockedTemperatureAt", async () => {
  const tiles = await loadSeed8Tiles(64);
  const ctx = { yearPhaseOffset: SEED8.yearPhaseOffset, obliquityDeg: SEED8.obliquityDeg, insolation };
  const viaDispatcher = seasonalTemperatureAt(tiles, 96, 0, ctx);
  const direct = lockedTemperatureAt(tiles, 96, 0, tiles.season_period_days, ctx.obliquityDeg, ctx.yearPhaseOffset, ctx.insolation);
  expect(viaDispatcher).toBe(direct);
});

test("seasonalTemperatureAt routes a spinning tiles document to temperatureAt", () => {
  const spinning = {
    locked: false,
    t_mean_c: [10],
    t_swing_c: [8],
    season_period_days: 360,
  } as unknown as TilesScene;
  const ctx = { yearPhaseOffset: 0.2, obliquityDeg: 21, insolation: 1 };
  const got = seasonalTemperatureAt(spinning, 0, 90, ctx);
  // 90 days at offset 0.2, year 360: phase = frac(90/360+0.2) = 0.45
  const expected = 10 + 8 * Math.sin(2 * Math.PI * 0.45);
  expect(Math.abs(got - expected)).toBeLessThan(1e-9);
});
