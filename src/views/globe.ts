/** The globe view: the planet itself — a cube-sphere mesh (reusing gg's
 * `cubeSphere.ts` addressing, not reinventing it) displaced by real relief
 * from `scene/tiles/v1`, colored by ocean depth or biome, carrying
 * settlement markers, and lit by an honest day/night terminator.
 *
 * Two kinds of surface, same split as `./system.ts`: pure sampling/position
 * math (`sampleTile`, `subsolarPoint` — no WebGL, unit-tested directly) and
 * the three.js scene graph builder (`createGlobeView`) that consumes it.
 */
import * as THREE from 'three';
import type { SystemScene, TilesScene } from '../sim/scene';
import { rotationPhase, worldPhase } from '../sim/ephemeris';
import { elevationColor } from '../sim/palette';
import { biomeColorForName } from './biomePalette';
import { TILE_QUADS, tileGrid } from './cubeSphere';

const TAU = Math.PI * 2;

/** Schematic globe radius (world units) — this view stands alone (not
 * sharing `./system.ts`'s AU scale), so the number is arbitrary. */
export const GLOBE_RADIUS = 2;

/** Reference body radius (Earth's, meters) used only to turn raw elevation
 * meters into a *fraction* of the schematic globe radius before exaggerating
 * — not a claim that the rendered world has this radius. */
const REFERENCE_RADIUS_M = 6.371e6;

/** How much the relief displacement is exaggerated over true scale, so a
 * planet's mountains and trenches are visible on a rendered sphere at all.
 * The HUD caption must show this number — spec §4½: the render admits its
 * lie. */
export const RELIEF_EXAGGERATION = 60;

/** How far above the (undisplaced) globe radius a settlement marker floats,
 * as a multiple of `GLOBE_RADIUS` — comfortably clear of the relief bump so
 * markers never clip into terrain. */
const MARKER_HEIGHT_FACTOR = 1.05;

/** Distance of the directional "sun" light from the globe center, in world
 * units — far enough to read as parallel light across the whole sphere. */
const LIGHT_DISTANCE = GLOBE_RADIUS * 20;

/** The tile-grid array fields `sampleTile` can index into — every
 * `TilesScene` field that is a flat, row-major per-tile layer. */
type TileArrayKey = {
  [K in keyof TilesScene]: TilesScene[K] extends readonly unknown[] ? K : never;
}[keyof TilesScene];

/** Sample a per-tile layer at `(lat, lon)` through the row-major equirect
 * lattice `scene/tiles/v1` defines: row 0 is lat +90..0 downward, col 0 is
 * lon −180, values are pixel centers (`windows/scene/src/lib.rs:68-71`,
 * binding convention — fix a mismatch here, never there). Longitude wraps
 * at the ±180 seam; latitude clamps at the poles. */
export function sampleTile<K extends TileArrayKey>(
  tiles: TilesScene,
  lat: number,
  lon: number,
  field: K,
): TilesScene[K] extends readonly (infer E)[] ? E : never {
  const rowSpan = 180 / tiles.height;
  const colSpan = 360 / tiles.width;
  const row = Math.min(tiles.height - 1, Math.max(0, Math.floor((90 - lat) / rowSpan)));
  const rawCol = Math.floor((lon + 180) / colSpan);
  const col = ((rawCol % tiles.width) + tiles.width) % tiles.width;
  const layer = tiles[field] as unknown as ArrayLike<unknown>;
  return layer[row * tiles.width + col] as never;
}

/** The point on the globe directly facing the star at `day`. Latitude comes
 * from the golden-pinned `worldPhase` (never reimplemented) swinging
 * ±obliquity over the year. Longitude comes from `rotationPhase` for a
 * spinning world — 0 for a tidally locked one, which has no rotation to
 * derive a sweep from. */
export function subsolarPoint(sys: SystemScene, day: number): { lat: number; lon: number } {
  const lat = sys.world.obliquityDeg * Math.sin(TAU * worldPhase(sys, day));
  if (sys.world.dayLengthDays === null) {
    return { lat, lon: 0 };
  }
  // rotationPhase sweeps [0,1) once per day_length_days; the sub-solar
  // longitude on the rotating surface sweeps the opposite way (the ground
  // spins to meet the sun, not the reverse). Wrapped into (-180, 180].
  const swept = -rotationPhase(sys, day) * 360;
  const lon = ((((swept + 180) % 360) + 360) % 360) - 180;
  return { lat, lon };
}

/** Unit vector for a (lat, lon) in degrees — the inverse of `cubeSphere.ts`'s
 * `unitLatLon` (lat = asin(z), lon = atan2(y, x)). */
function latLonToUnit(latDeg: number, lonDeg: number): THREE.Vector3 {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
}

/** Build one cube face's displaced, vertex-colored geometry (level-0 tile —
 * the whole face at TILE_QUADS×TILE_QUADS resolution; Task 10's zoom is
 * where adaptive depth joins). */
function buildFaceGeometry(tiles: TilesScene, face: number): THREE.BufferGeometry {
  const grid = tileGrid({ face, level: 0, ix: 0, iy: 0 });
  const n = TILE_QUADS + 1;
  const positions = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  for (let i = 0; i < n * n; i++) {
    const lat = grid.lats[i]!;
    const lon = grid.lons[i]!;
    const elevation = sampleTile(tiles, lat, lon, 'elevation_m');
    const radius = GLOBE_RADIUS * (1 + (RELIEF_EXAGGERATION * elevation) / REFERENCE_RADIUS_M);
    positions[3 * i] = grid.units[3 * i]! * radius;
    positions[3 * i + 1] = grid.units[3 * i + 1]! * radius;
    positions[3 * i + 2] = grid.units[3 * i + 2]! * radius;

    const ocean = sampleTile(tiles, lat, lon, 'ocean');
    const rgb = ocean
      ? elevationColor(elevation, tiles.sea_level_m)
      : biomeColorForName(tiles.biomeLegend[sampleTile(tiles, lat, lon, 'biome')] ?? '');
    colors[3 * i] = rgb[0] / 255;
    colors[3 * i + 1] = rgb[1] / 255;
    colors[3 * i + 2] = rgb[2] / 255;
  }
  const indices: number[] = [];
  for (let row = 0; row < TILE_QUADS; row++) {
    for (let col = 0; col < TILE_QUADS; col++) {
      const i00 = row * n + col;
      const i10 = row * n + col + 1;
      const i01 = (row + 1) * n + col;
      const i11 = (row + 1) * n + col + 1;
      // CCW in the face's (a, b) plane, whose u×v = n by construction
      // (verified for all six faces) — this winding is outward-facing on
      // every face without a per-face special case.
      indices.push(i00, i10, i11, i00, i11, i01);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/** A small canvas-texture sprite carrying `text`, for settlement labels.
 * Real browsers always give a 2D context here (this app already requires
 * WebGL for the rest of the scene); a `null` context only shows up in a
 * headless DOM stub (happy-dom has no canvas 2D renderer) — fall back to an
 * untextured sprite rather than crash createGlobeView in that case. */
function buildLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, opacity: 0 }));
  }
  ctx.font = '28px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f5e9c8';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 8, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set(0.5, 0.125, 1);
  return sprite;
}

/** One settlement (or the flagship): a small marker dot plus its name label,
 * both fixed to the rotating surface at the feature's lat/lon. */
function buildFeatureMarker(feature: TilesScene['features'][number]): THREE.Object3D {
  const group = new THREE.Object3D();
  group.name = `feature-${feature.name}`;
  const up = latLonToUnit(feature.latitude, feature.longitude);
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_RADIUS * 0.015, 8, 6),
    new THREE.MeshBasicMaterial({ color: feature.kind === 'flagship' ? 0xffd76e : 0xe8e8f0 }),
  );
  dot.position.copy(up).multiplyScalar(GLOBE_RADIUS * MARKER_HEIGHT_FACTOR);
  group.add(dot);
  const label = buildLabelSprite(feature.name);
  label.position.copy(up).multiplyScalar(GLOBE_RADIUS * MARKER_HEIGHT_FACTOR * 1.08);
  group.add(label);
  return group;
}

/** The globe view's public surface: a mountable object graph plus the
 * per-frame driver a caller (main.ts's rAF loop) needs. */
export interface GlobeView {
  /** The whole globe's root node — mount this once into a THREE.Scene. */
  object3d: THREE.Object3D;
  /** Repositions the terminator light and spins the mesh for `day`; call
   * every frame. */
  update(day: number): void;
}

/** Build the globe view: a cube-sphere mesh displaced by real relief,
 * colored by ocean depth or biome, carrying settlement markers, and lit by a
 * fixed-direction "sun" whose latitude tracks the season while the mesh
 * itself spins by `rotationPhase` — together reproducing `subsolarPoint`'s
 * lat/lon on the rotating surface without moving the light twice. */
export function createGlobeView(tiles: TilesScene, sys: SystemScene): GlobeView {
  const root = new THREE.Object3D();
  root.name = 'globe-root';

  const spinGroup = new THREE.Object3D();
  spinGroup.name = 'globe-spin';
  root.add(spinGroup);

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  for (let face = 0; face < 6; face++) {
    const mesh = new THREE.Mesh(buildFaceGeometry(tiles, face), material);
    mesh.name = `globe-face-${face}`;
    spinGroup.add(mesh);
  }

  for (const feature of tiles.features) {
    spinGroup.add(buildFeatureMarker(feature));
  }

  // No ambient light here: the night side is meant to fall to shader
  // darkness (spec §4½) — the system view's ambient wash belongs to that
  // view's always-lit spheres, not this one's honest terminator.
  const light = new THREE.DirectionalLight(0xfff4e0, 2.2);
  light.target.position.set(0, 0, 0);
  root.add(light);
  root.add(light.target);

  function update(day: number): void {
    const sub = subsolarPoint(sys, day);
    // Fixed reference azimuth 0: the daily sweep comes from spinning
    // spinGroup below, not from moving the light's longitude — see the
    // function doc's derivation.
    light.position.copy(latLonToUnit(sub.lat, 0)).multiplyScalar(LIGHT_DISTANCE);
    spinGroup.rotation.z = rotationPhase(sys, day) * TAU;
  }

  update(0);

  return { object3d: root, update };
}
