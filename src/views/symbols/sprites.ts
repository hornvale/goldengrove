/** Shared 2D symbol-sprite building blocks: a deterministic jitter hash and
 * the three canvas-glyph sprite materials (peak/tree/wave). Split out of
 * `./symbolLayer` (the globe's symbol layer) so the flat map's symbol layer
 * (`../mapSymbols`) can reuse the exact same glyphs without duplicating the
 * canvas-drawing code. */
import * as THREE from 'three';

/** Deterministic [0,1) from an integer — used for jitter placement so symbol
 * scatter never shimmers between identical updates (no `Math.random`
 * anywhere in this module). */
export function hash01(i: number): number {
  let x = (i | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Build a small offscreen-canvas texture for a symbol class, falling back to
 * a flat-colour material when no 2D context is available (jsdom — the unit
 * tests here run headless with no canvas 2D renderer, same guard as
 * `../globe`'s `buildLabelSprite`). */
function buildSymbolMaterial(draw: (ctx: CanvasRenderingContext2D, size: number) => void, fallbackColor: number): THREE.SpriteMaterial {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.SpriteMaterial({ color: fallbackColor });
  }
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  return new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
}

/** Mountain-peak glyph: a dark slate triangle with a pale snow cap. */
export function buildPeakMaterial(): THREE.SpriteMaterial {
  return buildSymbolMaterial((ctx, size) => {
    // Body: dark slate triangle — bolder than the original mid-grey so it
    // reads clearly against land (visual pass: peaks too faint to read).
    ctx.fillStyle = 'rgb(70,74,86)';
    ctx.beginPath();
    ctx.moveTo(size / 2, size * 0.12);
    ctx.lineTo(size * 0.88, size * 0.88);
    ctx.lineTo(size * 0.12, size * 0.88);
    ctx.closePath();
    ctx.fill();
    // Subtle darker outline for edge contrast.
    ctx.strokeStyle = 'rgb(34,36,44)';
    ctx.lineWidth = size * 0.04;
    ctx.stroke();
    // Pale snow cap at the apex.
    ctx.fillStyle = 'rgb(242,245,248)';
    ctx.beginPath();
    ctx.moveTo(size / 2, size * 0.12);
    ctx.lineTo(size * 0.63, size * 0.34);
    ctx.lineTo(size * 0.5, size * 0.4);
    ctx.lineTo(size * 0.37, size * 0.34);
    ctx.closePath();
    ctx.fill();
  }, 0x464a56);
}

/** Forest tree-cluster glyph: a simple green disc. */
export function buildTreeMaterial(): THREE.SpriteMaterial {
  return buildSymbolMaterial((ctx, size) => {
    ctx.fillStyle = '#3f7d3f';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }, 0x3f7d3f);
}

/** Stylized `~~` wave-mark texture for ocean tiles — two short wavy strokes
 * in light cyan, matching the pixel-art-RPG convention for open sea. */
export function buildWaveMaterial(): THREE.SpriteMaterial {
  return buildSymbolMaterial((ctx, size) => {
    ctx.lineCap = 'round';
    const drawWave = (yBase: number, style: string, width: number): void => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(size * 0.08, yBase);
      ctx.quadraticCurveTo(size * 0.3, yBase - size * 0.1, size * 0.5, yBase);
      ctx.quadraticCurveTo(size * 0.7, yBase + size * 0.1, size * 0.92, yBase);
      ctx.stroke();
    };
    // A darker halo first, then a bright stroke on top — reads on both the
    // light shallows and the deep ocean.
    for (const y of [size * 0.4, size * 0.64]) {
      drawWave(y, 'rgba(20,52,96,0.55)', size * 0.22);
      drawWave(y, 'rgba(238,250,255,0.95)', size * 0.12);
    }
  }, 0xe8f6ff);
}

/** Volcano glyph: a dark cone with a red/orange lava top — the rarest
 * biome-signature icon (high unrest atop a high peak). */
export function buildVolcanoMaterial(): THREE.SpriteMaterial {
  return buildSymbolMaterial((ctx, size) => {
    // Dark basalt cone.
    ctx.fillStyle = 'rgb(48,42,44)';
    ctx.beginPath();
    ctx.moveTo(size / 2, size * 0.14);
    ctx.lineTo(size * 0.86, size * 0.88);
    ctx.lineTo(size * 0.14, size * 0.88);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgb(20,18,18)';
    ctx.lineWidth = size * 0.04;
    ctx.stroke();
    // Lava glow at the summit.
    ctx.fillStyle = 'rgb(255,120,30)';
    ctx.beginPath();
    ctx.moveTo(size / 2, size * 0.14);
    ctx.lineTo(size * 0.62, size * 0.32);
    ctx.lineTo(size * 0.5, size * 0.4);
    ctx.lineTo(size * 0.38, size * 0.32);
    ctx.closePath();
    ctx.fill();
    // A bright ember core.
    ctx.fillStyle = 'rgb(255,210,90)';
    ctx.beginPath();
    ctx.arc(size / 2, size * 0.26, size * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }, 0xff7818);
}

/** Cactus glyph: a green saguaro — a vertical bar with two arms — marking
 * desert biome nodes. */
export function buildCactusMaterial(): THREE.SpriteMaterial {
  return buildSymbolMaterial((ctx, size) => {
    ctx.fillStyle = '#3f8f4f';
    ctx.strokeStyle = '#2c6a3a';
    ctx.lineWidth = size * 0.03;
    const trunkW = size * 0.16;
    // Trunk.
    ctx.beginPath();
    ctx.roundRect(size / 2 - trunkW / 2, size * 0.16, trunkW, size * 0.72, trunkW / 2);
    ctx.fill();
    ctx.stroke();
    // Left arm.
    ctx.beginPath();
    ctx.roundRect(size * 0.24, size * 0.36, trunkW, size * 0.34, trunkW / 2);
    ctx.fill();
    ctx.stroke();
    // Right arm.
    ctx.beginPath();
    ctx.roundRect(size * 0.6, size * 0.28, trunkW, size * 0.34, trunkW / 2);
    ctx.fill();
    ctx.stroke();
  }, 0x3f8f4f);
}

/** Mushroom glyph: a red, spotted cap on a pale stalk — marking damp,
 * fungal rainforest biome nodes. */
export function buildMushroomMaterial(): THREE.SpriteMaterial {
  return buildSymbolMaterial((ctx, size) => {
    // Pale stalk.
    ctx.fillStyle = 'rgb(238,228,208)';
    ctx.fillRect(size * 0.42, size * 0.5, size * 0.16, size * 0.38);
    // Red cap.
    ctx.fillStyle = 'rgb(196,44,44)';
    ctx.beginPath();
    ctx.arc(size / 2, size * 0.48, size * 0.36, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    // White spots.
    ctx.fillStyle = 'rgb(250,246,238)';
    for (const [dx, dy, r] of [
      [-0.14, -0.1, 0.055],
      [0.12, -0.14, 0.05],
      [0, -0.02, 0.045],
    ] as const) {
      ctx.beginPath();
      ctx.arc(size / 2 + dx * size, size * 0.48 + dy * size, r * size, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 0xc42c2c);
}
