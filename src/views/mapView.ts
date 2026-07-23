/** The map view: the region rung below the globe (orrery's newest zoom
 * rung) — a self-contained 2D-orthographic three.js scene showing one
 * region under a `MapStyle` switch (campaign "The Diorama"): either the
 * original flat pixel-art quad (`./mapTexture`, `./mapSymbols`) or a
 * Voxel-2.5D relief diorama (`./worldMesh`'s `buildVoxelHeightfieldGeometry`)
 * under a fixed-isometric camera. The center tile's symbol overlay (under
 * `'pixel'`) is driven by the real camera zoom (`./symbols/budget`'s
 * `rungForMapZoom`, wired via `mountTileAt`/`updateSymbolRung` below). */
import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import type { RegionScene } from "../sim/scene";
import { overworldTexture } from "./mapTexture";
import type { MapSymbols } from "./mapSymbols";
import { buildMapSymbols } from "./mapSymbols";
import { rungForMapZoom, type Rung } from "./symbols/budget";
import { buildVoxelHeightfieldGeometry } from "./worldMesh";
import { pixelColorFor } from "./styles/pixelBase";
import type { TileId } from "./cubeSphere";
import { tileKey } from "./cubeSphere";
import {
  panBoundsInTiles,
  recenterTarget,
  ringAddresses,
  sameFaceOffset,
  withinChebyshev,
} from "./mapRing";

/** Half-extent of the PIXEL style's orthographic frustum (world units) —
 * unchanged from the original flat map: the camera frames a roughly
 * unit-sized area centered on the origin, matching the unit quad `setRegion`
 * mounts under `'pixel'`. */
const FRUSTUM_HALF_EXTENT = 1;

/** The map's two rungs (campaign "The Diorama"): `'voxel'`, a relief
 * diorama of extruded blocks under a fixed-isometric camera, or `'pixel'`,
 * the original flat pixel-art quad under a top-down camera. A style
 * switches geometry + camera only — both read the SAME per-node color
 * (`pixelColorFor`, below), so Style ⟂ Lens holds: no style special-cases a
 * color. */
export type MapStyle = "voxel" | "pixel";

/** The voxel diorama's footprint (world units, X–Z span) — the same
 * numeric size as the pixel plane's own `2 * FRUSTUM_HALF_EXTENT`, so
 * switching styles doesn't change how much of the region is on screen. Not
 * shared as one constant with the pixel path's literal (kept verbatim,
 * below) so the two styles stay independently readable and tunable. */
export const MAP_VOXEL_EXTENT = 2 * FRUSTUM_HALF_EXTENT;

/** Elevation-band size (m) the voxel diorama quantizes to before scaling to
 * world height — the same value the globe's Terraced/Voxel styles use
 * (`globe.ts`'s private `TERRACE_BAND_M`/`VOXEL_BAND_M`), so a step reads as
 * "one band" the same way on both rungs. Kept as its own local constant
 * (not imported from `globe.ts`) to avoid a view-to-view coupling for what's
 * a shared visual convention, not a shared dependency. */
export const MAP_VOXEL_BAND_M = 250;

/** World-height per meter of banded elevation. Follows the same
 * displacement-fraction formula the globe uses for its own relief
 * (`heightScale * banded / REFERENCE_RADIUS_M`, see `buildVoxelHeightfieldGeometry`'s
 * doc comment), scaled to `globe.ts`'s own `GLOBE_RADIUS * RELIEF_EXAGGERATION`
 * (`2 * 60`) so a given elevation band displaces by a comparable WORLD
 * distance on both the globe and the flat diorama. A first-pass value —
 * the tuning knob for the campaign's mandatory visual framing pass
 * (Task 4). */
export const MAP_VOXEL_HEIGHT_SCALE = 800;

/** True isometric camera offset: elevation `atan(1/√2) ≈ 35.264°`, azimuth
 * 45°. Positioning the camera at `(d, d, d)` looking at the origin with
 * `up = (0, 1, 0)` produces exactly this angle with no separate trig — the
 * symmetric offset over all three axes IS the isometric pose. `d` (world
 * units) only needs to clear the diorama's bounding radius; under an
 * ORTHOGRAPHIC camera it does not affect the apparent (projected) size —
 * that's `ISO_FRUSTUM_HALF_EXTENT`, below. */
export const ISO_CAMERA_DISTANCE = 5;

/** Half-extent of the voxel style's orthographic frustum. A flat
 * `[-E, E]²` footprint (`E = MAP_VOXEL_EXTENT / 2`) viewed from a true
 * isometric direction projects to a silhouette whose widest span is the
 * footprint's diagonal, `E * √2` (the `x - z` extreme at opposite corners);
 * this constant adds margin above that for the blocks' own height plus a
 * comfortable visual border. First-pass value — the campaign's mandatory
 * visual pass (Task 4) is the tuning step if the diorama still clips or
 * floats too small/large in frame. */
export const ISO_FRUSTUM_HALF_EXTENT = 1.8;

/** Near/far planes for the isometric camera — generous around
 * `ISO_CAMERA_DISTANCE`'s distance to the origin (`d * √3`) so the
 * diorama's full depth along the view axis is never clipped. */
const ISO_NEAR = 0.1;
const ISO_FAR = 100;

/** Directional "sun" for the voxel diorama: mostly overhead with a slight
 * tilt (rather than straight down) so top faces (normal `(0,1,0)`) catch
 * more light than the vertical cliff walls (`buildVoxelHeightfieldGeometry`'s
 * outward-facing wall normals) — the Lambertian dot product with a
 * mostly-+Y direction favors +Y-facing faces, which is what makes a stepped
 * relief read as blocks stacked on a table rather than a flat wash. Warm
 * tone matches the globe's own sun light (`globe.ts`'s `light`). */
const VOXEL_LIGHT_COLOR = 0xfff4e0;
const VOXEL_LIGHT_INTENSITY = 1.8;
const VOXEL_LIGHT_POSITION: readonly [number, number, number] = [1, 3, 1.5];

/** Ambient fill so the darkened cliff walls (`VOXEL_CLIFF_DARKEN`) never
 * fall to pure black under the single directional light above. */
const VOXEL_AMBIENT_INTENSITY = 0.55;

/** How many same-face/same-level neighbor tiles are mounted around the
 * center at once, in each of the four directions — radius 1 is a 3×3 grid
 * (9 tiles). First-pass value (The Excursion); a visual pass may retune it
 * if "zoom out pretty handily" wants a wider ring. */
export const MAP_RING_RADIUS = 1;

/** How far (in the same units as `MAP_RING_RADIUS`) a tile's `RegionScene`
 * stays cached after it's unmounted from the ring, before being dropped for
 * real. Must be ≥ `MAP_RING_RADIUS` (the "hot" mounted ring is always inside
 * the "warm" cached halo) — bounds a long roaming session's memory instead
 * of letting `regionCache` grow forever. */
export const MAP_CACHE_HALO_RADIUS = 2;

/** Extra margin (a fraction of one tile width) the camera must drift past a
 * tile's boundary before the ring recenters — without this, a camera sitting
 * near a tile edge would thrash the ring back and forth every time it
 * jitters across the line. The spatial equivalent of `cubeSphere.ts`'s
 * `LOD_MERGE_FACTOR` split/merge hysteresis. */
export const RECENTER_HYSTERESIS_FRACTION = 0.1;

/** Zoomed all the way out, the whole `MAP_RING_RADIUS` ring should be
 * visible without exposing its own edge — `1 / (2·radius + 1)` frames the
 * ring exactly; the extra `1.1` divisor leaves a small margin so the ring's
 * outermost edge doesn't sit flush against the viewport border. */
export const MAP_MIN_ZOOM = 1 / ((2 * MAP_RING_RADIUS + 1) * 1.1);

/** Zoomed all the way in — a first-pass "close-up on about a quarter of one
 * tile" value; a visual pass may retune it. */
export const MAP_MAX_ZOOM = 4;

/** The map view's public surface: a mountable scene graph plus the per-frame
 * driver a caller (the app's render loop, Task 4) needs. */
export interface MapView {
  /** The map's scene root — render this with `camera` via `render`. */
  scene: THREE.Scene;
  /** The map's shared camera. Under `'pixel'` it looks down the +z axis at
   * the origin; under `'voxel'` it sits at the fixed isometric offset. */
  camera: THREE.OrthographicCamera;
  /** Pan (drag) + zoom (wheel) controls, shared by both styles — only
   * position/zoom change between styles, never the fixed camera angle
   * (`enableRotate` stays `false`). Exposed (not fully private) so tests can
   * drive/inspect it directly; `render` is the only method real callers
   * need to invoke it through. */
  controls: MapControls;
  /** Show `region` under the active `MapStyle`, mounted alone at the local
   * origin with no ring/network involvement; `null` clears it. This is the
   * synchronous, data-already-in-hand path (used directly by tests and by
   * any caller that already has a `RegionScene` in hand) — it resets the
   * ring's origin/center to this one tile and populates the cache with just
   * it. Replaces any prior mounted tiles. */
  setRegion(region: RegionScene | null): void;
  /** Start a fresh, network-backed region visit at `tile`: clears every
   * previously mounted/cached tile, then eagerly requests (via the
   * `requestRegion` this view was constructed with) the full
   * `MAP_RING_RADIUS` ring around `tile` — including `tile` itself. Meshes
   * mount as `onRegion` replies arrive. Throws if this view was constructed
   * without a `requestRegion` callback. */
  beginRegion(tile: TileId): void;
  /** Route a worker reply for `key` to this view: caches it (if it's within
   * the current warm halo), and mounts/rebuilds its mesh (if it's within the
   * current hot ring). A reply for a key this view isn't tracking (a stray
   * or stale arrival) is a no-op — mirrors `globe.ts`'s own `onRegion`
   * tolerance for arrivals it no longer wants. */
  onRegion(key: string, region: RegionScene): void;
  /** Switch the active style: swaps the camera pose immediately, and
   * rebuilds every currently-mounted ring tile from cache under the new
   * style (no new requests — every mounted tile's data is already
   * resident). Default is `'voxel'`. */
  setStyle(style: MapStyle): void;
  /** Render this view with the shared renderer. */
  render(renderer: THREE.WebGLRenderer): void;
  /** Dispose every mounted tile's geometry and material, and empty the
   * scene. */
  dispose(): void;
}

/** Build the map view: an orthographic scene, already posed for the default
 * `'voxel'` style, ready to mount a region via `setRegion`. */
export interface CreateMapViewOptions {
  /** How to fetch a region tile for `beginRegion`/recenter — the same
   * function `main.ts` already passes to `createGlobeView`. Omit only for
   * tests/callers that exclusively use the synchronous `setRegion` path. */
  requestRegion?: (tile: TileId) => void;
  /** The element `MapControls` listens on for drag/wheel input — `main.ts`
   * passes the real `mapCanvas` (Task 4 wires this) so pointer/wheel events
   * from the visible canvas actually reach the controls. `OrbitControls`'
   * constructor unconditionally touches `domElement.style`, so this can't be
   * left `undefined`; omitting it falls back to a detached, never-rendered
   * `<canvas>` that satisfies the constructor without needing a real DOM
   * (used by unit tests, which drive pan/zoom by writing to
   * `controls.target`/`controls.object.zoom` directly rather than dispatching
   * real pointer events). */
  domElement?: HTMLElement;
}

export function createMapView(options: CreateMapViewOptions = {}): MapView {
  const { requestRegion, domElement = document.createElement("canvas") } = options;
  const scene = new THREE.Scene();
  scene.name = "map-root";

  const camera = new THREE.OrthographicCamera(
    -FRUSTUM_HALF_EXTENT,
    FRUSTUM_HALF_EXTENT,
    FRUSTUM_HALF_EXTENT,
    -FRUSTUM_HALF_EXTENT,
    0.1,
    100,
  );

  // The voxel diorama's light rig: mounted unconditionally. The pixel
  // style's `MeshBasicMaterial` ignores lights entirely, so leaving these in
  // the scene under `'pixel'` is harmless — this avoids managing light
  // membership as a THIRD thing (on top of the mesh and camera) `setStyle`
  // has to swap.
  const light = new THREE.DirectionalLight(
    VOXEL_LIGHT_COLOR,
    VOXEL_LIGHT_INTENSITY,
  );
  light.position.set(...VOXEL_LIGHT_POSITION);
  light.target.position.set(0, 0, 0);
  scene.add(light);
  scene.add(light.target);
  const ambient = new THREE.AmbientLight(0xffffff, VOXEL_AMBIENT_INTENSITY);
  scene.add(ambient);

  const controls = new MapControls(camera, domElement);
  controls.enableRotate = false;
  controls.minZoom = MAP_MIN_ZOOM;
  controls.maxZoom = MAP_MAX_ZOOM;

  /** One ring member's mounted state: its mesh (positioned at its
   * origin-relative offset) and, for the center tile only, its symbol
   * overlay. */
  interface MountedTile {
    mesh: THREE.Mesh;
    symbols: MapSymbols | null;
    /** This tile's own address — stored directly (not reverse-derived from
     * `mesh.position`) so ring/halo membership checks never depend on
     * rounding a world-space float back to an integer tile index. */
    addr: TileId;
  }
  const mounted = new Map<string, MountedTile>();
  const regionCache = new Map<string, RegionScene>();
  const regionPending = new Set<string>();
  let activeStyle: MapStyle = "voxel";
  /** The tile every mounted mesh's position is anchored to — set once per
   * region visit (by `setRegion` or `beginRegion`) and NEVER re-zeroed
   * afterward. Recentering (below) only ever changes `centerAddr`; it never
   * moves this, and therefore never moves the camera or any existing mesh
   * (a floating-origin frame would fight `MapControls`' in-progress drag
   * deltas — see The Excursion's design doc §4). */
  let originAddr: TileId | null = null;
  /** The ring's current nominal center, for ring/halo MEMBERSHIP tests only
   * (never for mesh positioning — that's always relative to `originAddr`).
   * Moves on every recenter. */
  let centerAddr: TileId | null = null;

  /** The `'pixel'` style's camera pose — today's exact top-down setup,
   * verbatim. */
  function applyPixelCamera(): void {
    camera.left = -FRUSTUM_HALF_EXTENT;
    camera.right = FRUSTUM_HALF_EXTENT;
    camera.top = FRUSTUM_HALF_EXTENT;
    camera.bottom = -FRUSTUM_HALF_EXTENT;
    camera.near = 0.1;
    camera.far = 100;
    camera.position.set(0, 0, 10);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }

  /** The `'voxel'` style's fixed-isometric camera pose (see
   * `ISO_CAMERA_DISTANCE`'s doc comment for why `(d, d, d)` IS the
   * isometric angle). */
  function applyIsoCamera(): void {
    camera.left = -ISO_FRUSTUM_HALF_EXTENT;
    camera.right = ISO_FRUSTUM_HALF_EXTENT;
    camera.top = ISO_FRUSTUM_HALF_EXTENT;
    camera.bottom = -ISO_FRUSTUM_HALF_EXTENT;
    camera.near = ISO_NEAR;
    camera.far = ISO_FAR;
    camera.position.set(
      ISO_CAMERA_DISTANCE,
      ISO_CAMERA_DISTANCE,
      ISO_CAMERA_DISTANCE,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }
  applyIsoCamera(); // default style is 'voxel'

  /** Dispose and unmount every currently-mounted ring tile (meshes AND, for
   * the center, its symbol overlay) — does not touch `regionCache`. */
  function clearAllMounted(): void {
    for (const key of [...mounted.keys()]) unmountTile(key);
  }

  /** Dispose and unmount one ring tile by key — does not touch
   * `regionCache` (a tile leaving the hot ring stays cached in the warm
   * halo; see `recenterTo`). No-op if `key` isn't currently mounted. */
  function unmountTile(key: string): void {
    const entry = mounted.get(key);
    if (!entry) return;
    if (entry.symbols) {
      scene.remove(entry.symbols.group);
      entry.symbols.dispose();
    }
    scene.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    (entry.mesh.material as THREE.MeshBasicMaterial).map?.dispose();
    (entry.mesh.material as THREE.Material).dispose();
    mounted.delete(key);
  }

  /** `'pixel'`: a flat quad textured with the procedural overworld renderer
   * (`overworldTexture`, campaign "The Overworld"). Plane geometry is
   * unchanged from the original flat pixel-art path; only *mounting*
   * (position, scene membership) moved to `mountTileAt`, shared by every
   * ring member. */
  function buildPixelMesh(region: RegionScene): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(2 * FRUSTUM_HALF_EXTENT, 2 * FRUSTUM_HALF_EXTENT);
    const material = new THREE.MeshBasicMaterial({ map: overworldTexture(region) });
    const m = new THREE.Mesh(geometry, material);
    m.name = `map-region-${region.face}:${region.level}:${region.ix}:${region.iy}`;
    return m;
  }

  /** `'voxel'`: the relief diorama — an extruded-block heightfield colored
   * by the SAME per-node source `buildPixelMesh`'s texture uses
   * (`pixelColorFor`), so Style ⟂ Lens holds. */
  function buildVoxelMesh(region: RegionScene): THREE.Mesh {
    const geometry = buildVoxelHeightfieldGeometry(
      region,
      (nodeIndex) => pixelColorFor([0, 0, 0], region, nodeIndex),
      { extent: MAP_VOXEL_EXTENT, heightScale: MAP_VOXEL_HEIGHT_SCALE, bandM: MAP_VOXEL_BAND_M },
    );
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 1,
      metalness: 0,
    });
    const m = new THREE.Mesh(geometry, material);
    m.name = `map-region-voxel-${region.face}:${region.level}:${region.ix}:${region.iy}`;
    return m;
  }

  function buildTileMesh(region: RegionScene): THREE.Mesh {
    return activeStyle === "voxel" ? buildVoxelMesh(region) : buildPixelMesh(region);
  }

  /** Positions `mesh` (and, if given, `symbolsGroup`) at `(dx, dy)` tiles
   * from `originAddr` — the SAME formula for every ring member, center
   * included (the center's own offset is `(0, 0)` only immediately after
   * `setRegion`/`beginRegion`; after any number of recenters it can be
   * anywhere). `'voxel'`'s ground plane is X–Z (Y is height, see
   * `MAP_VOXEL_EXTENT`'s doc comment); `'pixel'`'s flat quad is X–Y (Z is
   * depth-only). `dy` maps to the NEGATIVE second axis in both styles,
   * extending `mapSymbols.ts`'s existing within-tile convention (increasing
   * row/iy → decreasing world Y) across tile boundaries too, so a tile's
   * own row ordering and the ring's tile ordering agree. */
  function positionAt(object: THREE.Object3D, dx: number, dy: number): void {
    if (activeStyle === "voxel") {
      object.position.set(dx * MAP_VOXEL_EXTENT, 0, -dy * MAP_VOXEL_EXTENT);
    } else {
      object.position.set(dx * MAP_VOXEL_EXTENT, -dy * MAP_VOXEL_EXTENT, 0);
    }
  }

  /** Mount (or remount, replacing any existing mesh at `key`) one ring
   * tile's `region` at its `originAddr`-relative offset. `isCenter` gates
   * the symbol overlay — see The Excursion's design doc §5: budgets were
   * tuned for one tile's worth of symbols, so only the center ever carries
   * them. */
  function mountTileAt(key: string, region: RegionScene, isCenter: boolean): void {
    unmountTile(key);
    const addr: TileId = { face: region.face, level: region.level, ix: region.ix, iy: region.iy };
    const offset = sameFaceOffset(addr, originAddr!)!;
    const m = buildTileMesh(region);
    positionAt(m, offset.dx, offset.dy);
    scene.add(m);
    let tileSymbols: MapSymbols | null = null;
    if (isCenter && activeStyle === "pixel") {
      tileSymbols = buildMapSymbols(region);
      tileSymbols.update(rungForMapZoom(camera.zoom));
      positionAt(tileSymbols.group, offset.dx, offset.dy);
      scene.add(tileSymbols.group);
    }
    mounted.set(key, { mesh: m, symbols: tileSymbols, addr });
    if (isCenter) lastSymbolRung = tileSymbols ? rungForMapZoom(camera.zoom) : null;
  }

  /** Request every not-yet-cached, not-yet-pending address in `addresses`
   * via the `requestRegion` this view was constructed with. Throws if this
   * view has none (a real app always supplies one; only `setRegion`'s
   * synchronous, data-in-hand path works without it). */
  function requestMissing(addresses: TileId[]): void {
    if (!requestRegion) {
      throw new Error("mapView: beginRegion/recenter needs a requestRegion callback");
    }
    for (const addr of addresses) {
      const key = tileKey(addr);
      if (regionCache.has(key) || regionPending.has(key)) continue;
      regionPending.add(key);
      requestRegion(addr);
    }
  }

  /** Mount every address in the current ring that's already cached (used
   * right after a recenter, when some ring members may already be resident
   * from the warm halo — no need to wait for a fresh reply). */
  function mountCachedRing(): void {
    if (!centerAddr) return;
    for (const addr of ringAddresses(centerAddr, MAP_RING_RADIUS)) {
      const key = tileKey(addr);
      const cached = regionCache.get(key);
      if (cached) mountTileAt(key, cached, key === tileKey(centerAddr));
    }
  }

  function beginRegion(tile: TileId): void {
    clearAllMounted();
    regionCache.clear();
    regionPending.clear();
    originAddr = tile;
    centerAddr = tile;
    requestMissing(ringAddresses(tile, MAP_RING_RADIUS));
  }

  function onRegion(key: string, region: RegionScene): void {
    regionPending.delete(key);
    if (!originAddr || !centerAddr) return; // no active region visit
    const addr: TileId = { face: region.face, level: region.level, ix: region.ix, iy: region.iy };
    if (!withinChebyshev(addr, centerAddr, MAP_CACHE_HALO_RADIUS)) return; // stale/irrelevant
    regionCache.set(key, region);
    if (withinChebyshev(addr, centerAddr, MAP_RING_RADIUS)) {
      mountTileAt(key, region, key === tileKey(centerAddr));
    }
  }

  /** Recenter the ring to `newCenter`: unmount (but keep cached, within the
   * warm halo) tiles that fall outside the new hot ring, drop from the
   * cache entirely anything now outside the warm halo, mount anything
   * already cached that's newly in-ring, and request whatever's still
   * missing. Never touches `originAddr`, any mesh's position, or the
   * camera. */
  function recenterTo(newCenter: TileId): void {
    centerAddr = newCenter;
    for (const [key, entry] of [...mounted.entries()]) {
      if (!withinChebyshev(entry.addr, newCenter, MAP_RING_RADIUS)) unmountTile(key);
    }
    for (const key of [...regionCache.keys()]) {
      const cached = regionCache.get(key)!;
      const addr: TileId = { face: cached.face, level: cached.level, ix: cached.ix, iy: cached.iy };
      if (!withinChebyshev(addr, newCenter, MAP_CACHE_HALO_RADIUS)) regionCache.delete(key);
    }
    mountCachedRing();
    requestMissing(ringAddresses(newCenter, MAP_RING_RADIUS));
  }

  /** The world-unit box `controls.target` must stay within, given the
   * current ring — converts `mapRing.ts`'s tile-unit bounds to world units
   * and the active style's plane (X–Z for voxel, X–Y for pixel). */
  function clampPan(): void {
    if (!originAddr || !centerAddr) return;
    const bounds = panBoundsInTiles(centerAddr, originAddr, MAP_RING_RADIUS);
    const minX = bounds.minDx * MAP_VOXEL_EXTENT;
    const maxX = bounds.maxDx * MAP_VOXEL_EXTENT;
    // Y bounds are the negated Dy bounds (positionAt's sign convention),
    // so min/max swap.
    const minSecond = -bounds.maxDy * MAP_VOXEL_EXTENT;
    const maxSecond = -bounds.minDy * MAP_VOXEL_EXTENT;
    controls.target.x = Math.min(maxX, Math.max(minX, controls.target.x));
    if (activeStyle === "voxel") {
      controls.target.z = Math.min(maxSecond, Math.max(minSecond, controls.target.z));
    } else {
      controls.target.y = Math.min(maxSecond, Math.max(minSecond, controls.target.y));
    }
  }

  /** Checks `controls.target` against the recenter-hysteresis boundary and
   * recenters the ring if the camera has drifted solidly into a neighbor's
   * footprint. Called every frame from `render` (cheap: a handful of
   * arithmetic comparisons, no allocation on the common no-op path). */
  function maybeRecenter(): void {
    if (!originAddr || !centerAddr) return;
    const localX = controls.target.x / MAP_VOXEL_EXTENT;
    const secondAxis = activeStyle === "voxel" ? controls.target.z : controls.target.y;
    const localY = -secondAxis / MAP_VOXEL_EXTENT;
    const next = recenterTarget(originAddr, centerAddr, localX, localY, RECENTER_HYSTERESIS_FRACTION);
    if (next) recenterTo(next);
  }

  /** Re-evaluates the center tile's symbol rung against the current camera
   * zoom every frame — cheap (one comparison chain) on the common
   * unchanged-rung path, since `MapSymbols.update` itself is a no-op-cost
   * early return only in the sense that rebuilding the same rung twice is
   * wasted work, not incorrect; guard on the rung actually changing. */
  let lastSymbolRung: Rung | null = null;
  function updateSymbolRung(): void {
    if (activeStyle !== "pixel" || !centerAddr) return;
    const entry = mounted.get(tileKey(centerAddr));
    if (!entry || !entry.symbols) return;
    const rung = rungForMapZoom(camera.zoom);
    if (rung === lastSymbolRung) return;
    lastSymbolRung = rung;
    entry.symbols.update(rung);
  }

  function setRegion(region: RegionScene | null): void {
    clearAllMounted();
    regionCache.clear();
    regionPending.clear();
    if (!region) {
      originAddr = null;
      centerAddr = null;
      return;
    }
    const addr: TileId = { face: region.face, level: region.level, ix: region.ix, iy: region.iy };
    originAddr = addr;
    centerAddr = addr;
    const key = tileKey(addr);
    regionCache.set(key, region);
    mountTileAt(key, region, true);
  }

  function setStyle(style: MapStyle): void {
    activeStyle = style;
    if (style === "voxel") applyIsoCamera();
    else applyPixelCamera();
    if (!centerAddr) return;
    const centerKey = tileKey(centerAddr);
    for (const key of [...mounted.keys()]) {
      const cached = regionCache.get(key);
      if (!cached) continue; // shouldn't happen (a mounted tile is always cached) but stay defensive
      mountTileAt(key, cached, key === centerKey); // replaces the old style's mesh internally
    }
  }

  function render(renderer: THREE.WebGLRenderer): void {
    controls.update();
    clampPan();
    maybeRecenter();
    updateSymbolRung();
    renderer.render(scene, camera);
  }

  function dispose(): void {
    clearAllMounted();
    regionCache.clear();
    regionPending.clear();
  }

  return { scene, camera, controls, setRegion, beginRegion, onRegion, setStyle, render, dispose };
}
