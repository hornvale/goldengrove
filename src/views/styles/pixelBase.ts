import type { BaseTreatment } from '../renderStyle';
import type { TilesScene } from '../../sim/scene';

/** Channel quantization step — the pixel-art banding. Visual-pass-tuned. */
export const PIXEL_STEP = 32;

const OCEAN_RGB: readonly [number, number, number] = [40, 72, 132];

const quant = (c: number): number => Math.min(255, Math.round(c / PIXEL_STEP) * PIXEL_STEP);

/** Data-native pixel base: ocean tiles read from the ocean palette (not the
 * lens-lit frame), land tiles keep the lens hue, both quantized. Because ocean
 * colour is chosen from src.ocean[idx], land can never take the ocean's colour
 * and vice-versa — the bug dies here by construction. */
export const pixelBaseTreatment: BaseTreatment = {
  id: 'pixel',
  transform(rgb, src: TilesScene, idx) {
    const base = src.ocean[idx] ? OCEAN_RGB : rgb;
    return [quant(base[0]), quant(base[1]), quant(base[2])];
  },
};
