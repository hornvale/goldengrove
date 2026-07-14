import { expect, test } from 'vitest';
import { orbitAngle, moonLocalPosition } from './system';
import type { SystemScene } from '../sim/scene';

// Names adapted to the parsed (camelCase) SystemScene shape — the brief's
// sketch uses raw scene/system/v1 snake_case, but parseSystem in ./scene.ts
// is what every consumer actually sees.
const sys: SystemScene = {
  schema: 'scene/system/v1',
  seed: 42,
  star: { className: 'yellow dwarf (G)', luminosityRel: 1, hzInnerAu: 0.95, hzOuterAu: 1.4 },
  world: { orbitAu: 1, yearDays: 360, dayLengthDays: 1, obliquityDeg: 20, yearPhaseOffset: 0.25 },
  moons: [{ siderealDays: 30, phaseOffset: 0, distanceMm: 384, sizeRel: 1 }],
};

test('orbitAngle honors the genesis phase offset', () => {
  // worldPhase(sys, 0) = 0.25 turns → angle π/2.
  expect(orbitAngle(sys, 0)).toBeCloseTo(Math.PI / 2, 10);
});

test('a moon returns to its position after one sidereal period', () => {
  const a = moonLocalPosition(sys, 0, 0);
  const b = moonLocalPosition(sys, 0, 30);
  expect(a.x).toBeCloseTo(b.x, 8);
  expect(a.z).toBeCloseTo(b.z, 8);
});

test('a moon is a quarter of the way around after a quarter sidereal period', () => {
  const start = moonLocalPosition(sys, 0, 0);
  const quarter = moonLocalPosition(sys, 0, 7.5);
  const r = Math.hypot(start.x, start.z);
  // 7.5/30 = 0.25 turn: (x, z) rotates from (r, 0) to (0, r).
  expect(quarter.x).toBeCloseTo(0, 8);
  expect(quarter.z).toBeCloseTo(r, 8);
});

test('two moons at the same day sit on different rungs of the radial ladder', () => {
  const twoMoonSys: SystemScene = {
    ...sys,
    moons: [
      { siderealDays: 30, phaseOffset: 0, distanceMm: 384, sizeRel: 1 },
      { siderealDays: 45, phaseOffset: 0, distanceMm: 900, sizeRel: 0.5 },
    ],
  };
  const m0 = moonLocalPosition(twoMoonSys, 0, 0);
  const m1 = moonLocalPosition(twoMoonSys, 1, 0);
  const r0 = Math.hypot(m0.x, m0.z);
  const r1 = Math.hypot(m1.x, m1.z);
  expect(r1).toBeGreaterThan(r0);
});
