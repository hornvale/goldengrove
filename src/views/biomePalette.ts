/**
 * Shared biome palette — THE single source of truth for biome colors.
 * Indices mirror `gg-climate`'s `Biome` enum (crates/gg-climate/src/lib.rs).
 */
import { lerpRgb } from "./color";

export const BIOME_COUNT = 13;

export const BIOME_RGB: ReadonlyArray<readonly [number, number, number]> = [
  [12, 42, 82], // 0 DeepOcean
  [42, 92, 138], // 1 Shelf
  [207, 192, 154], // 2 Shore
  [238, 243, 246], // 3 IceCap
  [154, 160, 140], // 4 Tundra
  [63, 95, 66], // 5 BorealForest
  [79, 122, 69], // 6 TemperateForest
  [154, 168, 94], // 7 Grassland
  [185, 164, 95], // 8 Savanna
  [47, 107, 60], // 9 TropicalRainforest
  [217, 181, 120], // 10 HotDesert
  [179, 165, 142], // 11 ColdDesert
  [141, 133, 120], // 12 AlpineRock
];

/**
 * Biome color for a classification index, shaded like `hypsometricColor`'s
 * shade factor. Out-of-range indices clamp to 12 (AlpineRock grey) — the
 * pinned defensive rule for corrupt/unexpected classification data.
 */
export function biomeColor(classIndex: number, shade: number): [number, number, number] {
  const idx = classIndex >= 0 && classIndex < BIOME_COUNT ? classIndex : BIOME_COUNT - 1;
  const [r, g, b] = BIOME_RGB[idx]!;
  return [Math.min(255, r * shade), Math.min(255, g * shade), Math.min(255, b * shade)].map(Math.round) as [
    number,
    number,
    number,
  ];
}

/**
 * Hornvale's land-biome legend names (`domains/climate/src/biome.rs`'s
 * kebab-case `Biome::name`) mapped onto this palette's rows by best semantic
 * match, keyed by NAME rather than assuming index alignment — the two enums
 * don't share a cardinality (gg has 13 rows, hornvale's legend has 22 names,
 * 10 of them ocean biomes the globe view never routes through this map: an
 * ocean tile is colored by depth via `elevationColor` instead, regardless of
 * its biome). A handful of hornvale land names have no gg counterpart; those
 * are derived blends between the two nearest gg rows via `color.ts`'s
 * `lerpRgb`, noted per entry below.
 */
export const LEGEND_NAME_RGB: Readonly<Record<string, readonly [number, number, number]>> = {
  ice: BIOME_RGB[3]!, // IceCap
  tundra: BIOME_RGB[4]!, // Tundra (exact)
  taiga: BIOME_RGB[5]!, // BorealForest
  "temperate-grassland": BIOME_RGB[7]!, // Grassland
  shrubland: lerpRgb(BIOME_RGB[7]!, BIOME_RGB[8]!, 0.5), // derived: Grassland↔Savanna midpoint
  "temperate-forest": BIOME_RGB[6]!, // TemperateForest (exact)
  "temperate-rainforest": lerpRgb(BIOME_RGB[6]!, BIOME_RGB[9]!, 0.5), // derived: TemperateForest↔TropicalRainforest midpoint
  desert: BIOME_RGB[10]!, // HotDesert (hornvale has one desert biome; gg splits hot/cold, HotDesert is the closer default)
  savanna: BIOME_RGB[8]!, // Savanna (exact)
  "tropical-seasonal-forest": lerpRgb(BIOME_RGB[8]!, BIOME_RGB[9]!, 0.5), // derived: Savanna↔TropicalRainforest midpoint
  "tropical-rainforest": BIOME_RGB[9]!, // TropicalRainforest (exact)
  alpine: BIOME_RGB[12]!, // AlpineRock
  // Ocean biomes: the globe view never samples these (ocean tiles are
  // depth-shaded via elevationColor instead); mapped anyway so every legend
  // name resolves to something rather than silently falling back.
  "sea-ice": BIOME_RGB[3]!,
  "coral-reef": BIOME_RGB[1]!,
  "kelp-forest": BIOME_RGB[1]!,
  "hydrothermal-vent": BIOME_RGB[0]!,
  "hadal-trench": BIOME_RGB[0]!,
  upwelling: BIOME_RGB[1]!,
  epipelagic: BIOME_RGB[1]!,
  mesopelagic: BIOME_RGB[0]!,
  bathypelagic: BIOME_RGB[0]!,
  abyssal: BIOME_RGB[0]!,
};

/**
 * Biome color for a `biomeLegend` name. Unknown names clamp to AlpineRock
 * grey — the same defensive rule `biomeColor` uses for an out-of-range
 * index.
 */
export function biomeColorForName(name: string): [number, number, number] {
  const rgb = LEGEND_NAME_RGB[name] ?? BIOME_RGB[BIOME_COUNT - 1]!;
  return [rgb[0], rgb[1], rgb[2]];
}
