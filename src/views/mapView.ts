/** The map view: the flat pixel-art rung below the globe (orrery's newest
 * zoom rung) — a self-contained 2D orthographic three.js scene showing one
 * region as a flat quad textured with its crisp pixel-art biome/ocean map
 * (`./mapTexture`). A later task adds the symbol overlay (Stage 4) and wires
 * this view into the app's render loop and zoom ladder (Task 4). */
import * as THREE from 'three';
import type { RegionScene } from '../sim/scene';
import { regionPixelTexture } from './mapTexture';

/** Half-extent of the orthographic frustum (world units) — the camera frames
 * a roughly unit-sized area centered on the origin, matching the unit quad
 * `setRegion` mounts. */
const FRUSTUM_HALF_EXTENT = 1;

/** The map view's public surface: a mountable scene graph plus the per-frame
 * driver a caller (the app's render loop, Task 4) needs. */
export interface MapView {
  /** The map's scene root — render this with `camera` via `render`. */
  scene: THREE.Scene;
  /** Looks down the +z axis at the origin, framing a unit-ish area. */
  camera: THREE.OrthographicCamera;
  /** Show `region` as a flat quad textured with its pixel-art biome/ocean map;
   * `null` clears it. Replaces any prior region's mesh, so the scene never
   * carries more than one mounted map mesh at a time. */
  setRegion(region: RegionScene | null): void;
  /** Render this view with the shared renderer. */
  render(renderer: THREE.WebGLRenderer): void;
  /** Dispose the mounted mesh's geometry and material, and empty the scene. */
  dispose(): void;
}

/** Build the map view: an empty orthographic scene ready to mount a region's
 * textured quad via `setRegion`. */
export function createMapView(): MapView {
  const scene = new THREE.Scene();
  scene.name = 'map-root';

  const camera = new THREE.OrthographicCamera(
    -FRUSTUM_HALF_EXTENT,
    FRUSTUM_HALF_EXTENT,
    FRUSTUM_HALF_EXTENT,
    -FRUSTUM_HALF_EXTENT,
    0.1,
    100,
  );
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  let mesh: THREE.Mesh | null = null;

  function clearMesh(): void {
    if (!mesh) return;
    scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.MeshBasicMaterial).map?.dispose();
    (mesh.material as THREE.Material).dispose();
    mesh = null;
  }

  function setRegion(region: RegionScene | null): void {
    clearMesh();
    if (!region) return;
    // Regions are square face-tiles (same sample count on both axes), so a
    // unit square reads at the right aspect regardless of `samples`.
    const geometry = new THREE.PlaneGeometry(2 * FRUSTUM_HALF_EXTENT, 2 * FRUSTUM_HALF_EXTENT);
    const material = new THREE.MeshBasicMaterial({ map: regionPixelTexture(region) });
    mesh = new THREE.Mesh(geometry, material);
    mesh.name = `map-region-${region.face}:${region.level}:${region.ix}:${region.iy}`;
    scene.add(mesh);
  }

  function render(renderer: THREE.WebGLRenderer): void {
    renderer.render(scene, camera);
  }

  function dispose(): void {
    clearMesh();
  }

  return { scene, camera, setRegion, render, dispose };
}
