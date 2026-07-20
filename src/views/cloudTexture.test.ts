import { describe, it, expect } from 'vitest';
import { cloudTextureData, cloudStyleFor, CLOUD_TEX_W, CLOUD_TEX_H } from './cloudTexture';

// Build a tiny TilesScene whose every tile is one cloud type.
function uniform(cloudType: number, propensity = 0.6) {
  const width = 8, height = 4, n = width * height;
  return { width, height, cloudType: Array(n).fill(cloudType), weatherPropensity: Array(n).fill(propensity) } as any;
}

describe('cloudTextureData', () => {
  it('is transparent everywhere over a cloudless (None) world', () => {
    const d = cloudTextureData(uniform(0));
    let maxAlpha = 0;
    for (let i = 3; i < d.length; i += 4) maxAlpha = Math.max(maxAlpha, d[i]!);
    expect(maxAlpha).toBe(0);
  });

  it('produces cloud where cloudType is non-None, with soft (non-binary) edges', () => {
    const d = cloudTextureData(uniform(4)); // cumulonimbus
    let opaque = 0, partial = 0, clear = 0;
    for (let i = 3; i < d.length; i += 4) {
      const a = d[i]!;
      if (a === 0) clear++; else if (a >= 250) opaque++; else partial++;
    }
    expect(opaque + partial).toBeGreaterThan(0);   // there ARE clouds
    expect(partial).toBeGreaterThan(0);            // soft edges exist (not binary) — the keystone
    expect(clear).toBeGreaterThan(0);              // and gaps exist (balanced, surface reads through)
  });

  it('cumulonimbus reads denser+darker than cirrus (typed, mechanism-sensitive)', () => {
    const dark = cloudStyleFor(4), wisp = cloudStyleFor(5);
    const lum = (c: [number,number,number]) => 0.299*c[0]+0.587*c[1]+0.114*c[2];
    expect(dark.coverage).toBeGreaterThan(wisp.coverage);
    expect(lum(dark.color)).toBeLessThan(lum(wisp.color));
  });

  it('cloudStyleFor is total over 0..5 and clamps out of range', () => {
    for (let t = 0; t <= 5; t++) expect(cloudStyleFor(t)).toBeTruthy();
    expect(cloudStyleFor(9)).toEqual(cloudStyleFor(1)); // clamp to cumulus
  });

  it('texture is the declared size', () => {
    expect(cloudTextureData(uniform(1))).toHaveLength(CLOUD_TEX_W * CLOUD_TEX_H * 4);
  });
});
