import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { createMapView } from './mapView';
import type { RegionScene } from '../sim/scene';

function fakeRegion(samples = 4): RegionScene {
  const n = (samples + 1) * (samples + 1);
  return {
    schema: 'scene/tiles-region/v1', seed: 42, face: 0, level: 3, ix: 0, iy: 0,
    samples, sea_level_m: 0, season_period_days: 360, circulationBands: 3,
    biomeLegend: ['deep-ocean', 'temperate-forest'],
    elevation_m: Array.from({ length: n }, () => 100),
    ocean: Array.from({ length: n }, () => false),
    biome: Array.from({ length: n }, () => 1),
    plate: Array.from({ length: n }, () => 0),
    unrest: Array.from({ length: n }, () => 0),
  } as unknown as RegionScene;
}

test('createMapView returns a scene with an orthographic camera', () => {
  const v = createMapView();
  expect(v.scene).toBeInstanceOf(THREE.Scene);
  expect(v.camera).toBeInstanceOf(THREE.OrthographicCamera);
});

test('setRegion mounts exactly one map mesh; null clears it', () => {
  const v = createMapView();
  const meshCount = () => v.scene.children.filter((c) => c instanceof THREE.Mesh).length;
  expect(meshCount()).toBe(0);
  v.setRegion(fakeRegion());
  expect(meshCount()).toBe(1);
  v.setRegion(fakeRegion(8)); // replacing keeps it at one
  expect(meshCount()).toBe(1);
  v.setRegion(null);
  expect(meshCount()).toBe(0);
});

test('dispose empties the scene', () => {
  const v = createMapView();
  v.setRegion(fakeRegion());
  v.dispose();
  expect(v.scene.children.filter((c) => c instanceof THREE.Mesh).length).toBe(0);
});
