/** Tests for ./diurnal: the producer-pinned golden for seed 42 (spinning)
 * plus the mirrored zero-mean / afternoon-peak invariants from the Rust
 * suite (`domains/climate/src/diurnal.rs`). */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { diurnalWaveform } from "./diurnal";

/** Seed 42's system constants the golden
 * (`windows/scene/examples/diurnal_temperature_golden.rs`) was evaluated
 * at, hardcoded here rather than re-derived per test run: obliquity/
 * year_phase/day_length_std are fixed per-run system constants (the golden
 * rows only vary lat/lon/day_fraction/amplitude). Read via a throwaway
 * debug example against `build_world(Seed(42), ...)` (generated sky,
 * default rotation pin, day = 0 so `year_phase == year_phase_offset`
 * exactly). */
const SEED42 = {
  obliquityDeg: 0.9593056670606165,
  yearPhase: 0.20941867934994152,
  dayLengthStd: 0.8798799803519574,
};

interface GoldenRow {
  lat_deg: number;
  lon_deg: number;
  day_fraction: number;
  amplitude_c: number;
  diurnal_c: number;
}

test("diurnalWaveform reproduces the Rust producer's spinning-world golden (seed 42)", () => {
  const rows: GoldenRow[] = JSON.parse(readFileSync("testdata/diurnal-golden-seed42.json", "utf8"));
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    const d = diurnalWaveform(
      row.lat_deg,
      SEED42.obliquityDeg,
      SEED42.yearPhase,
      row.day_fraction,
      SEED42.dayLengthStd,
    );
    const got = row.amplitude_c * d;
    expect(Math.abs(got - row.diurnal_c)).toBeLessThan(1e-3);
  }
});

// Mirrors `waveform_is_zero_mean_over_a_rotation` (domains/climate/src/diurnal.rs).
test("diurnalWaveform is zero-mean over a rotation", () => {
  const n = 1000;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += diurnalWaveform(23.4, 23.4, 0.25, i / n, 1.0);
  }
  expect(Math.abs(sum / n)).toBeLessThan(1e-3);
});

// Mirrors `peak_is_in_the_afternoon` (domains/climate/src/diurnal.rs).
test("diurnalWaveform peaks in the local afternoon", () => {
  let bestFrac = 0;
  let best = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const f = i / 1000;
    const d = diurnalWaveform(0.0, 0.0, 0.0, f, 1.0);
    if (d > best) {
      best = d;
      bestFrac = f;
    }
  }
  expect(bestFrac).toBeGreaterThan(0.5);
  expect(bestFrac).toBeLessThan(0.75);
});
