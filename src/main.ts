// Boots genesis in a worker, then mounts the system view (the 3D orrery)
// once the world lands. The globe view (Task 9) and the URL-state/zoom
// wiring around AppState (Task 10, src/state/url.ts) join this loop later;
// for now the seed is fixed at 42, matching the harvested boot stub.
import * as THREE from 'three';
import './styles.css';
import { buildHud, type HudCallbacks } from './ui/hud';
import { clockToDay } from './time/clock';
import { createSystemView } from './views/system';
import type { SystemScene } from './sim/scene';

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
    mountSystemView(msg.system);
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

function mountSystemView(system: SystemScene): void {
  const canvas = document.createElement('canvas');
  canvas.className = 'orrery-canvas';
  app.append(canvas);

  const caption = document.createElement('div');
  caption.className = 'scale-caption';
  caption.textContent =
    'schematic scale: the world’s orbit is to true AU scale, but moon orbits are compressed onto even rungs for legibility — not to true distance.';
  app.append(caption);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03050a);
  scene.add(new THREE.AmbientLight(0x404050, 1.2));

  const view = createSystemView(system);
  scene.add(view.object3d);

  const reach = Math.max(system.world.orbitAu, system.star.hzOuterAu) * 3 + 2;
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, reach * 20);
  camera.position.set(0, reach * 0.6, reach);
  camera.lookAt(0, 0, 0);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  const hudRoot = document.createElement('div');
  app.append(hudRoot);

  let paused = false;
  const daysPerSecond = defaultDaysPerSecond(system);
  let playStartMs = performance.now();
  let dayAtPlayStart = 0;
  let day = 0;

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
    // calendar clock and globe view (Tasks 9–10) — no-ops here.
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
      view.update(day);
      renderer.render(scene, camera);
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
    view.update(day);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
