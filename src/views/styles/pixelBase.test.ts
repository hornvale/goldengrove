import { expect, test } from 'vitest';
import { pixelBaseTreatment, PIXEL_STEP } from './pixelBase';
import type { TilesScene } from '../../sim/scene';

const src = { ocean: [true, false] } as unknown as TilesScene;

test('an ocean tile stays blue-dominant (never takes a land colour)', () => {
  // feed a LAND-green input; the treatment must not let ocean read green
  const [r, g, b] = pixelBaseTreatment.transform([80, 140, 70], src, 0);
  expect(b).toBeGreaterThan(r);
  expect(b).toBeGreaterThan(g);
});

test('a land tile keeps its land hue, quantized', () => {
  const [r, g, b] = pixelBaseTreatment.transform([80, 140, 70], src, 1);
  expect(g).toBeGreaterThan(b); // green land stays green-dominant
  for (const c of [r, g, b]) expect(c % PIXEL_STEP === 0 || c === 255).toBe(true);
});
