import { describe, expect, it } from 'vitest';
import { majorWaterColor, naturalLens } from './lens';
import type { TilesScene } from '../sim/scene';

/** A 1-tile scene carrying only what `majorWaterColor`/`naturalLens` read. */
const oneTile = (fields: Partial<TilesScene>): TilesScene =>
  ({
    width: 1,
    height: 1,
    sea_level_m: 0,
    elevation_m: [0],
    ocean: [false],
    biome: [0],
    biomeLegend: ['tundra'],
    features: [],
    t_mean_c: [0],
    t_swing_c: [0],
    season_period_days: 365,
    circulationBands: 3,
    moisture: [0],
    plate: [0],
    unrest: [0],
    ...fields,
  }) as never;

const WATER_LEGEND = ['ocean', 'salt-basin', 'river', 'dry-land'];
const RIVER_IDX = WATER_LEGEND.indexOf('river');
const SALT_BASIN_IDX = WATER_LEGEND.indexOf('salt-basin');
const DRY_LAND_IDX = WATER_LEGEND.indexOf('dry-land');

describe('majorWaterColor', () => {
  it('renders a river blue for a tile whose drainage clears the globe threshold', () => {
    const tiles = oneTile({
      water: [RIVER_IDX],
      waterLegend: WATER_LEGEND,
      drainage: [40],
    });
    const color = majorWaterColor(tiles, 0);
    expect(color).not.toBeNull();
    // Blue-dominant: the blue channel outranks red and green.
    expect(color![2]).toBeGreaterThan(color![0]);
    expect(color![2]).toBeGreaterThan(color![1]);
  });

  it('returns null for a river tile below the threshold (a creek is not drawn on the globe)', () => {
    const tiles = oneTile({
      water: [RIVER_IDX],
      waterLegend: WATER_LEGEND,
      drainage: [1],
    });
    expect(majorWaterColor(tiles, 0)).toBeNull();
  });

  it('returns null for an ocean tile regardless of water class', () => {
    const tiles = oneTile({
      ocean: [true],
      water: [RIVER_IDX],
      waterLegend: WATER_LEGEND,
      drainage: [999],
    });
    expect(majorWaterColor(tiles, 0)).toBeNull();
  });

  it('renders the lake tint for a salt-basin tile above the lake threshold', () => {
    const tiles = oneTile({
      water: [SALT_BASIN_IDX],
      waterLegend: WATER_LEGEND,
      drainage: [20],
    });
    const color = majorWaterColor(tiles, 0);
    expect(color).not.toBeNull();
    expect(color).toEqual([72, 150, 138]);
  });

  it('returns null for a salt-basin tile below the lake threshold', () => {
    const tiles = oneTile({
      water: [SALT_BASIN_IDX],
      waterLegend: WATER_LEGEND,
      drainage: [1],
    });
    expect(majorWaterColor(tiles, 0)).toBeNull();
  });

  it('returns null for dry-land tiles', () => {
    const tiles = oneTile({
      water: [DRY_LAND_IDX],
      waterLegend: WATER_LEGEND,
      drainage: [999],
    });
    expect(majorWaterColor(tiles, 0)).toBeNull();
  });

  it('gracefully returns null for a scene with no water fields (an older scene)', () => {
    const tiles = oneTile({});
    expect(majorWaterColor(tiles, 0)).toBeNull();
  });
});

describe('naturalLens with major water', () => {
  it('overrides the land biome color for a qualifying river tile', () => {
    const tiles = oneTile({
      water: [RIVER_IDX],
      waterLegend: WATER_LEGEND,
      drainage: [40],
    });
    const color = naturalLens.colorAt(tiles, 0, 0);
    expect(color).toEqual(majorWaterColor(tiles, 0));
  });

  it('falls through to the biome color for a sub-threshold river tile', () => {
    const tiles = oneTile({
      water: [RIVER_IDX],
      waterLegend: WATER_LEGEND,
      drainage: [1],
      biome: [0],
      biomeLegend: ['tundra'],
    });
    const color = naturalLens.colorAt(tiles, 0, 0);
    expect(color).not.toBeNull();
    // Should equal the plain biome color path (no water override).
    expect(color).not.toEqual([72, 150, 138]);
  });
});
