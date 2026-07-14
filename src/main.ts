// Boots genesis in a worker, then mounts the system view (the 3D orrery) and
// the globe view (the planet itself) once the world lands. Both share one
// renderer; a temporary 'g' keyboard toggle switches which is on screen —
// Task 10 replaces that with the real zoom + URL-state wiring (AppState,
// src/state/url.ts) that will pick a view from the shared link instead.
import * as THREE from 'three';
import './styles.css';
import { buildHud, type HudCallbacks } from './ui/hud';
import { clockToDay } from './time/clock';
import { createSystemView } from './views/system';
import { createGlobeView, RELIEF_EXAGGERATION } from './views/globe';
import type { SystemScene, TilesScene } from './sim/scene';

const app = document.getElementById('app')!;

const status = document.createElement('pre');
status.className = 'status';
status.textContent = 'generating…';
app.append(status);

const worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });

worker.onmessage = (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type === 'world') {
    status.remove();
    mountViews(msg.system, msg.tiles);
  } else if (msg.type === 'error') {
    // Genesis-refused replies render the message verbatim — the sim's
    // physical reason is the UI copy.
    status.textContent = msg.message;
  }
};

worker.postMessage({ type: 'generate', seed: '42', tilesWidth: 512 });

/** Default orrery playback rate: a full year sweeps by in ~12 real seconds. */
function defaultDaysPerSecond(sys: SystemScene): number {
  return sys.world.yearDays / 12;
}

const SPACE_CAPTION =
  'schematic scale: the world’s orbit is to true AU scale, but moon orbits are compressed onto even rungs for legibility — not to true distance. Press "g" to switch views.';
const GROUND_CAPTION = `relief is exaggerated ${RELIEF_EXAGGERATION}× over true scale so mountains and trenches read on a rendered sphere at all — not to true height. Press "g" to switch views.`;

function mountViews(system: SystemScene, tiles: TilesScene): void {
  const canvas = document.createElement('canvas');
  canvas.className = 'orrery-canvas';
  app.append(canvas);

  const caption = document.createElement('div');
  caption.className = 'scale-caption';
  caption.textContent = SPACE_CAPTION;
  app.append(caption);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // The system view: the schematic AU-scale orrery (Task 8).
  const systemScene = new THREE.Scene();
  systemScene.background = new THREE.Color(0x03050a);
  systemScene.add(new THREE.AmbientLight(0x404050, 1.2));
  const systemView = createSystemView(system);
  systemScene.add(systemView.object3d);
  const systemReach = Math.max(system.world.orbitAu, system.star.hzOuterAu) * 3 + 2;
  const systemCamera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.05,
    systemReach * 20,
  );
  systemCamera.position.set(0, systemReach * 0.6, systemReach);
  systemCamera.lookAt(0, 0, 0);

  // The globe view: the planet itself (Task 9) — real relief, biome/ocean
  // colors, settlement markers, an honest day/night terminator. No ambient
  // light in this scene: the night side is meant to fall dark.
  const globeScene = new THREE.Scene();
  globeScene.background = new THREE.Color(0x000000);
  const globeView = createGlobeView(tiles, system);
  globeScene.add(globeView.object3d);
  const globeReach = 6;
  const globeCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, globeReach * 20);
  globeCamera.position.set(0, globeReach * 0.4, globeReach);
  globeCamera.lookAt(0, 0, 0);

  let showGlobe = false;
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'g') return;
    showGlobe = !showGlobe;
    caption.textContent = showGlobe ? GROUND_CAPTION : SPACE_CAPTION;
  });

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    const aspect = window.innerWidth / window.innerHeight;
    systemCamera.aspect = aspect;
    systemCamera.updateProjectionMatrix();
    globeCamera.aspect = aspect;
    globeCamera.updateProjectionMatrix();
  });

  const hudRoot = document.createElement('div');
  app.append(hudRoot);

  let paused = false;
  const daysPerSecond = defaultDaysPerSecond(system);
  let playStartMs = performance.now();
  let dayAtPlayStart = 0;
  let day = 0;

  function renderFrame(): void {
    systemView.update(day);
    globeView.update(day);
    renderer.render(showGlobe ? globeScene : systemScene, showGlobe ? globeCamera : systemCamera);
  }

  const cb: HudCallbacks = {
    onPlayPause() {
      paused = !paused;
      if (!paused) {
        // Resuming rebases the play-head so playback continues from
        // wherever the scrubber currently sits, not from the last
        // pre-pause position.
        playStartMs = performance.now();
        dayAtPlayStart = day;
      }
      hud.setPaused(paused);
    },
    // Speed/true-scale/reroll/share/date-jump/view-toggle belong to the
    // calendar clock and Task 10's URL-state wiring — no-ops here.
    onSpeed() {},
    onTrueScale() {},
    onReroll() {},
    onShare() {},
    onDateJump() {},
    onToggleView() {},
    onScrub(scrubbedDay) {
      day = scrubbedDay;
      playStartMs = performance.now();
      dayAtPlayStart = day;
      renderFrame();
    },
  };
  const hud = buildHud(hudRoot, String(system.seed), cb);
  hud.setViewButton('', false);
  hud.setDayRange(system.world.yearDays);
  hud.setMaxSpeed(null);

  function frame(): void {
    if (!paused) {
      day = dayAtPlayStart + clockToDay(performance.now() - playStartMs, daysPerSecond);
      hud.setDay(day % system.world.yearDays);
    }
    renderFrame();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
