import { describe, expect, it } from 'vitest';
import { LENSES, lensById, naturalLens } from './lens';
import { loadSeed42Tiles } from '../testHelpers/wasmFixture';

describe('the lens registry', () => {
  it('registers natural first', () => {
    expect(LENSES[0]!.id).toBe('natural');
  });

  it('gives every lens a label, a caption, and a legend', async () => {
    const tiles = await loadSeed42Tiles(64);
    for (const lens of LENSES) {
      expect(lens.label.length, lens.id).toBeGreaterThan(0);
      expect(lens.caption.length, lens.id).toBeGreaterThan(0);
      expect(lens.legend(tiles).length, lens.id).toBeGreaterThan(0);
    }
  });

  it('falls back to natural for an unknown id', () => {
    expect(lensById('no-such-lens').id).toBe('natural');
  });

  it('sets dependsOnDay iff colorAt actually varies with the day', async () => {
    const tiles = await loadSeed42Tiles(64);
    for (const lens of LENSES) {
      const varies = Array.from({ length: tiles.width * tiles.height }, (_, i) => i).some(
        (i) => String(lens.colorAt(tiles, i, 0)) !== String(lens.colorAt(tiles, i, 100)),
      );
      expect(varies, `${lens.id} dependsOnDay`).toBe(lens.dependsOnDay);
    }
  });
});
