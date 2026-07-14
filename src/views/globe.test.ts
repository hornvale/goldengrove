import { expect, test } from 'vitest';
import { sampleTile, subsolarPoint } from './globe';
import type { SystemScene } from '../sim/scene';

test('sampleTile maps lat/lon to the row-major equirect lattice', () => {
  // 4×2 lattice: row 0 is lat +90..0, col 0 is lon -180.
  const tiles = { width: 4, height: 2, elevation_m: [0, 1, 2, 3, 4, 5, 6, 7] } as never;
  expect(sampleTile(tiles, 45, -180, 'elevation_m')).toBe(0);
  expect(sampleTile(tiles, -45, 90, 'elevation_m')).toBe(7);
});

test('sampleTile reads other per-tile layers by the same lattice', () => {
  const tiles = {
    width: 4,
    height: 2,
    ocean: [true, false, false, false, false, false, false, true],
    biome: [0, 1, 2, 3, 4, 5, 6, 7],
  } as never;
  expect(sampleTile(tiles, 45, -180, 'ocean')).toBe(true);
  expect(sampleTile(tiles, -45, 90, 'biome')).toBe(7);
});

test('sampleTile wraps longitude at the +180/-180 seam', () => {
  const tiles = { width: 4, height: 2, elevation_m: [0, 1, 2, 3, 4, 5, 6, 7] } as never;
  // lon 180 wraps to the same column as lon -180 (col 0).
  expect(sampleTile(tiles, 45, 180, 'elevation_m')).toBe(0);
});

test('subsolar latitude swings ±obliquity over the year', () => {
  // Adapted to the parsed (camelCase) SystemScene shape (see system.test.ts's
  // precedent) — the brief's sketch uses raw scene/system/v1 snake_case.
  const sys = {
    world: { obliquityDeg: 20, yearDays: 360, yearPhaseOffset: 0, dayLengthDays: 1 },
  } as never;
  const lats = [0, 90, 180, 270].map((d) => subsolarPoint(sys, d).lat);
  expect(Math.max(...lats)).toBeCloseTo(20, 5);
  expect(Math.min(...lats)).toBeCloseTo(-20, 5);
});

test('subsolar longitude sweeps a full turn per day_length_days for a spinning world', () => {
  const sys: SystemScene = {
    schema: 'scene/system/v1',
    seed: 1,
    star: { className: 'yellow dwarf (G)', luminosityRel: 1, hzInnerAu: 0.9, hzOuterAu: 1.4 },
    world: { orbitAu: 1, yearDays: 360, dayLengthDays: 1, obliquityDeg: 20, yearPhaseOffset: 0 },
    moons: [],
  };
  const a = subsolarPoint(sys, 0).lon;
  const b = subsolarPoint(sys, 1).lon;
  // A full day_length_days later, the sub-solar point has swept exactly one
  // full turn and returns to the same longitude.
  expect(b).toBeCloseTo(a, 8);
  const quarter = subsolarPoint(sys, 0.25).lon;
  expect(quarter).not.toBeCloseTo(a, 3);
});

test('subsolar longitude is frozen for a tidally locked world', () => {
  const sys: SystemScene = {
    schema: 'scene/system/v1',
    seed: 1,
    star: { className: 'yellow dwarf (G)', luminosityRel: 1, hzInnerAu: 0.9, hzOuterAu: 1.4 },
    world: { orbitAu: 1, yearDays: 360, dayLengthDays: null, obliquityDeg: 20, yearPhaseOffset: 0 },
    moons: [],
  };
  expect(subsolarPoint(sys, 0).lon).toBe(0);
  expect(subsolarPoint(sys, 123).lon).toBe(0);
});
