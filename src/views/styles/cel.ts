import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import type { TilesScene } from '../../sim/scene';
import type { RenderStyle } from '../renderStyle';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;      // 1/resolution
  uniform float uBands;     // number of lighting bands
  uniform float uEdge;      // edge threshold
  varying vec2 vUv;
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  void main() {
    vec4 src = texture2D(tDiffuse, vUv);
    // Posterize by banding the luminance, keep hue.
    float l = luma(src.rgb);
    float banded = floor(l * uBands + 0.5) / uBands;
    vec3 flat = src.rgb * (banded / max(l, 1e-3));
    // Sobel on luminance for the ink outline.
    float gx = 0.0, gy = 0.0;
    float k[9]; k[0]=-1.;k[1]=0.;k[2]=1.;k[3]=-2.;k[4]=0.;k[5]=2.;k[6]=-1.;k[7]=0.;k[8]=1.;
    int idx = 0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      float s = luma(texture2D(tDiffuse, vUv + vec2(float(x), float(y)) * uTexel).rgb);
      gx += s * k[idx];
      gy += s * k[8 - idx];
      idx++;
    }
    float edge = sqrt(gx * gx + gy * gy);
    float ink = smoothstep(uEdge, uEdge * 2.0, edge);
    gl_FragColor = vec4(mix(flat, vec3(0.05, 0.05, 0.08), ink), src.a);
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
    // ShaderPass CLONES the uniforms above, so the live uniform the shader reads
    // is `pass.uniforms.uTexel` — NOT the object literal we passed in. Capture it
    // AFTER construction; the composer calls this setSize (via
    // EffectComposer.addPass/setSize) with the drawing-buffer dimensions.
    const uTexel = pass.uniforms.uTexel!.value as THREE.Vector2;
    (pass as unknown as { setSize: (w: number, h: number) => void }).setSize = (w, h) => {
      uTexel.set(1 / w, 1 / h);
    };
    return [pass];
  },
};
