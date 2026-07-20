import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import type { TilesScene } from '../../sim/scene';
import type { RenderStyle } from '../renderStyle';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// Note: variable names must avoid GLSL ES 3.00 (WebGL2) reserved words — `flat`
// is an interpolation qualifier, and naming a variable `flat` silently fails the
// whole shader compile (→ a black screen). Hence `celCol` below.
const fragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;      // 1/resolution
  uniform float uBands;     // number of lighting bands
  uniform float uEdge;      // edge threshold
  varying vec2 vUv;
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  float lum(vec2 uv) { return luma(texture2D(tDiffuse, uv).rgb); }
  void main() {
    vec4 src = texture2D(tDiffuse, vUv);
    // Posterize the luminance into flat bands, keeping hue. Band CENTRES
    // ((floor(l*n)+0.5)/n) so the darkest band is 0.5/n, never 0 (round-to-band
    // zeroes every pixel below one band-width — deep ocean fell into it).
    float l = luma(src.rgb);
    float banded = (floor(l * uBands) + 0.5) / uBands;
    vec3 celCol = src.rgb * (banded / max(l, 1e-3));
    // Sobel on luminance for the ink outline — explicit taps (no dynamically
    // indexed local array, which some GL backends miscompile).
    float tl = lum(vUv + vec2(-1.0, -1.0) * uTexel);
    float tm = lum(vUv + vec2(0.0, -1.0) * uTexel);
    float tr = lum(vUv + vec2(1.0, -1.0) * uTexel);
    float ml = lum(vUv + vec2(-1.0, 0.0) * uTexel);
    float mr = lum(vUv + vec2(1.0, 0.0) * uTexel);
    float bl = lum(vUv + vec2(-1.0, 1.0) * uTexel);
    float bm = lum(vUv + vec2(0.0, 1.0) * uTexel);
    float br = lum(vUv + vec2(1.0, 1.0) * uTexel);
    float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
    float gy = -tl - 2.0 * tm - tr + bl + 2.0 * bm + br;
    float edge = sqrt(gx * gx + gy * gy);
    float ink = smoothstep(uEdge, uEdge * 2.0, edge);
    // Keep near-black space black; opaque output.
    vec3 col = max(src.r, max(src.g, src.b)) < 0.02
      ? vec3(0.0)
      : mix(celCol, vec3(0.05, 0.05, 0.08), ink);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const celStyle: RenderStyle = {
  id: 'cel',
  label: 'cel / ink',
  passes(_tiles: TilesScene): Pass[] {
    const pass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
        uBands: { value: 4.0 },
        uEdge: { value: 0.12 },
      },
      vertexShader,
      fragmentShader,
    });
    // ShaderPass CLONES the uniforms, so capture the live `uTexel` AFTER
    // construction; the composer calls setSize with the drawing-buffer size.
    const uTexel = pass.uniforms.uTexel!.value as THREE.Vector2;
    (pass as unknown as { setSize: (w: number, h: number) => void }).setSize = (w, h) => {
      uTexel.set(1 / w, 1 / h);
    };
    return [pass];
  },
};
