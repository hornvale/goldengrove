/** Client-side port of the producer's diurnal (day/night) temperature
 * waveform — mirrors `diurnal_waveform` (`domains/climate/src/diurnal.rs`)
 * exactly, same constants included, pinned by a producer-sourced golden (The
 * Isotherm rule — never a client reconstruction of itself). Determinism
 * across platforms is not required client-side (decision 0022); plain
 * `Math.sin/cos/exp` are fine, matched to the golden within 1e-3. */

const TAU = Math.PI * 2;

/** Thermal-inertia time constant (in rotations) — mirrors `TAU_THERMAL` in
 * `domains/climate/src/diurnal.rs`. */
const TAU_THERMAL = 0.5;

/** The fraction of the day (0..1) at which the waveform peaks — mirrors
 * `PEAK_FRAC` in `domains/climate/src/diurnal.rs`. */
const PEAK_FRAC = 0.6;

/** The normalized diurnal waveform `D`: zero-mean over `dayFraction ∈
 * [0,1)`, afternoon-peaked on LOCAL solar time (phased by `longitudeDeg`,
 * not the planet-wide `dayFraction` alone), damped by thermal inertia, and
 * zero when the sun never rises (polar night). A real day/night cycle is
 * per-longitude: at any instant half the planet is in daytime and half in
 * night, and the warm band sweeps as the planet turns — `longitudeDeg`
 * shifts the phase so cells at different meridians peak at different
 * moments of the same rotation. Mirrors `diurnal_waveform`
 * (`domains/climate/src/diurnal.rs`) verbatim — same formula, same
 * constants. Multiply by a tile's `tDiurnalAmpC` to get the °C anomaly. */
export function diurnalWaveform(
  latitudeDeg: number,
  longitudeDeg: number,
  obliquityDeg: number,
  yearPhase: number,
  dayFraction: number,
  dayLengthStd: number,
): number {
  const declDeg = obliquityDeg * Math.sin(TAU * yearPhase);
  const lat = (latitudeDeg * Math.PI) / 180;
  const dec = (declDeg * Math.PI) / 180;
  const noonSin = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec);
  const aGeo = Math.max(0, noonSin);
  const inertia = 1 - Math.exp(-Math.max(0, dayLengthStd) / TAU_THERMAL);
  const localSolarTime = (((dayFraction + longitudeDeg / 360) % 1) + 1) % 1;
  return aGeo * inertia * Math.cos(TAU * (localSolarTime - PEAK_FRAC));
}
