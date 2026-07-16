/** A lens is a pure projection of a tile's state onto a color.
 *
 * The realistic view is not a privileged ground truth that data modes
 * decorate — it is itself a colorizer (`ocean ? elevationColor :
 * biomeColorForName`), so it registers here as the `natural` lens and gets no
 * special case. Each lens owns its colormap, legend, and caption, so the HUD
 * stays generic over the registry and a new lens costs one file.
 *
 * Colormaps are presentation only (decision 0022): the sim ships numbers and
 * has no palette. Each `caption` says what its lens exaggerates or invents. */
import type { TilesScene } from '../sim/scene';
import { elevationColor } from '../sim/palette';
import { biomeColorForName } from './biomePalette';

/** 0-255 RGB, matching `elevationColor`'s existing return shape. */
export type RGB = [number, number, number];

/** One row of a lens's legend: a swatch and what it means. */
export interface LegendEntry {
  swatch: RGB;
  label: string;
}

/** A registered render mode. */
export interface Lens {
  /** Stable id — used by the HUD and the URL state. */
  id: string;
  /** HUD picker text. */
  label: string;
  /** What this lens exaggerates or invents (the caption discipline). */
  caption: string;
  /** Whether `colorAt` varies with `day`. Static lenses bake once at geometry
   * build; only a living lens pays the per-day recolor. */
  dependsOnDay: boolean;
  /** This lens's color for tile `i` on absolute standard `day`. */
  colorAt(tiles: TilesScene, i: number, day: number): RGB;
  /** The legend rows to draw for this lens. */
  legend(tiles: TilesScene): LegendEntry[];
}

/** Today's view, unchanged: ocean tiles shaded by depth, land by biome. */
export const naturalLens: Lens = {
  id: 'natural',
  label: 'natural',
  caption:
    'ocean shaded by depth, land by biome — a rendering choice, not a photograph: the sim ships numbers, not colors.',
  dependsOnDay: false,
  colorAt(tiles, i) {
    return tiles.ocean[i]
      ? elevationColor(tiles.elevation_m[i]!, tiles.sea_level_m)
      : biomeColorForName(tiles.biomeLegend[tiles.biome[i]!] ?? '');
  },
  legend(tiles) {
    const rows: LegendEntry[] = [
      { swatch: elevationColor(tiles.sea_level_m - 6000, tiles.sea_level_m), label: 'deep ocean' },
      { swatch: elevationColor(tiles.sea_level_m - 100, tiles.sea_level_m), label: 'shallows' },
    ];
    // One row per land biome actually present, in legend order.
    const present = new Set(tiles.biome.filter((_, i) => !tiles.ocean[i]));
    for (let b = 0; b < tiles.biomeLegend.length; b++) {
      if (!present.has(b)) continue;
      const name = tiles.biomeLegend[b]!;
      rows.push({ swatch: biomeColorForName(name), label: name });
    }
    return rows;
  },
};

/** The registry. `natural` is first — it is the default, not a base case. */
export const LENSES: readonly Lens[] = [naturalLens];

/** The lens for `id`, falling back to `natural` for anything unrecognized
 * (a stale URL, a removed lens). */
export function lensById(id: string): Lens {
  return LENSES.find((l) => l.id === id) ?? naturalLens;
}
