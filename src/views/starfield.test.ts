import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  buildRealStarfield,
  equatorialToEcliptic,
  fieldStarIntensity,
  neighborIntensity,
  STAR_COLOR,
} from './starfield';
import type { NeighborsScene } from '../sim/scene';

describe('equatorialToEcliptic', () => {
  it('leaves the vernal equinox (ra=0, dec=0) unchanged — it is the rotation axis', () => {
    const v = equatorialToEcliptic(0, 0, 23);
    expect(v.x).toBeCloseTo(1, 10);
    expect(v.y).toBeCloseTo(0, 10);
    expect(v.z).toBeCloseTo(0, 10);
  });

  it('a dec=+90 star lands at (0, cos eps, sin eps) — the pinned normative convention', () => {
    const eps = 23;
    const epsRad = (eps * Math.PI) / 180;
    // RA is degenerate at the pole — any value must produce the same result.
    for (const ra of [0, 45, 190.5, 359]) {
      const v = equatorialToEcliptic(ra, 90, eps);
      expect(v.x).toBeCloseTo(0, 8);
      expect(v.y).toBeCloseTo(Math.cos(epsRad), 8);
      expect(v.z).toBeCloseTo(Math.sin(epsRad), 8);
    }
  });

  it('always returns a unit vector', () => {
    const samples: Array<[number, number, number]> = [
      [0, 0, 23.4],
      [45, -30, 0],
      [190.5, 60, 15],
      [359.9, -89.9, 45],
      [270, 45, 23.4],
    ];
    for (const [ra, dec, eps] of samples) {
      const v = equatorialToEcliptic(ra, dec, eps);
      expect(v.length()).toBeCloseTo(1, 8);
    }
  });
});

describe('neighborIntensity', () => {
  it('is monotone nondecreasing in brightness across a sample document', () => {
    const all = [0.01, 0.05, 0.2, 1.0, 4.2];
    const intensities = all.map((b) => neighborIntensity(b, all));
    for (let i = 1; i < intensities.length; i++) {
      expect(intensities[i]).toBeGreaterThanOrEqual(intensities[i - 1]!);
    }
  });

  it('stays within [0.35, 1]', () => {
    const all = [0.001, 0.01, 0.1, 1, 10, 100];
    for (const b of all) {
      const v = neighborIntensity(b, all);
      expect(v).toBeGreaterThanOrEqual(0.35);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('a single-neighbor document maps to 1', () => {
    expect(neighborIntensity(4.2, [4.2])).toBeCloseTo(1, 10);
  });

  it('an equal-brightness document maps every entry to 1', () => {
    const all = [2.5, 2.5, 2.5];
    for (const b of all) {
      expect(neighborIntensity(b, all)).toBeCloseTo(1, 10);
    }
  });
});

describe('fieldStarIntensity', () => {
  it('brighter magnitude classes are strictly more intense', () => {
    expect(fieldStarIntensity(1)).toBeGreaterThan(fieldStarIntensity(5));
  });

  it('every class in 1..=5 is in (0, 1]', () => {
    for (const cls of [1, 2, 3, 4, 5]) {
      const v = fieldStarIntensity(cls);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is monotone decreasing across the whole ladder', () => {
    const values = [1, 2, 3, 4, 5].map(fieldStarIntensity);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThan(values[i - 1]!);
    }
  });
});

describe('STAR_COLOR', () => {
  // Pinned against domains/astronomy/src/neighborhood.rs's class_color —
  // the producer's total set of color words. A gap here means some
  // neighbor renders with the fallback tint instead of its real color.
  const producerColors = [
    'dim red',
    'warm yellow',
    'pale white',
    'deep orange',
    'smoldering red',
    'hard blue-white',
  ];

  it('has an entry for every producer color word', () => {
    for (const color of producerColors) {
      expect(STAR_COLOR[color]).toBeDefined();
      expect(STAR_COLOR[color]).toHaveLength(3);
    }
  });
});

function sampleNeighborsScene(): NeighborsScene {
  return {
    schema: 'scene/neighbors/v1',
    seed: 42,
    neighbors: [
      {
        index: 0,
        className: 'red giant',
        color: 'smoldering red',
        distanceLy: 68.232281,
        brightnessRel: 0.064437915,
        raDeg: 81.841371,
        decDeg: -65.242947,
      },
      {
        index: 1,
        className: 'sun-like star',
        color: 'warm yellow',
        distanceLy: 4.135297,
        brightnessRel: 0.058477201,
        raDeg: 33.465746,
        decDeg: 21.140972,
      },
      {
        index: 2,
        className: 'unknown class',
        color: 'chartreuse haze', // not a producer color — exercises the fallback
        distanceLy: 20,
        brightnessRel: 0.01,
        raDeg: 200,
        decDeg: 5,
      },
    ],
    stars: [
      { raDeg: 18.174019, decDeg: 44.505004, magnitudeClass: 4 },
      { raDeg: 335.04326, decDeg: -0.4632674, magnitudeClass: 4 },
      { raDeg: 120, decDeg: 10, magnitudeClass: 1 },
      { raDeg: 250, decDeg: -30, magnitudeClass: 3 },
    ],
  };
}

describe('buildRealStarfield', () => {
  it('returns a group with two Points children carrying the right vertex counts', () => {
    const sky = sampleNeighborsScene();
    const group = buildRealStarfield(sky, 23, 10);
    expect(group).toBeInstanceOf(THREE.Group);
    const points = group.children.filter((c): c is THREE.Points => c instanceof THREE.Points);
    expect(points).toHaveLength(2);
    const counts = points.map((p) => p.geometry.getAttribute('position').count).sort((a, b) => a - b);
    expect(counts).toEqual([sky.neighbors.length, sky.stars.length].sort((a, b) => a - b));
    expect(points[0]).not.toBe(points[1]);
  });
});
