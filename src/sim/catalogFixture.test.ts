/** The vendored wasm binary IS the contract fixture: instantiates
 * `public/hornvale_world.wasm` directly, drives it through `hw_new` +
 * `hw_scene_*`, and asserts the strict parser (./scene.ts) accepts the real
 * documents. No committed JSON copy sits between producer and consumer to
 * drift — this is the end-to-end proof. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseTiles, parseSystem } from "./scene";

async function exports() {
  const bytes = readFileSync("public/hornvale_world.wasm");
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports as any;
}

function readOut(e: any): string {
  return new TextDecoder().decode(new Uint8Array(e.memory.buffer, e.hw_out_ptr(), e.hw_out_len()));
}

/** Instantiate the vendored binary fresh, seed 42, and return the strict-parsed tiles document. */
export async function loadSeed42Tiles(width: number) {
  const e = await exports();
  e.hw_new(42n);
  if (e.hw_scene_tiles(width) !== 0) throw new Error(readOut(e));
  return parseTiles(readOut(e));
}

/** Instantiate the vendored binary fresh, seed 42, and return the strict-parsed system document. */
export async function loadSeed42System() {
  const e = await exports();
  e.hw_new(42n);
  if (e.hw_scene_system() !== 0) throw new Error(readOut(e));
  return parseSystem(readOut(e));
}

test("the vendored binary's tiles document parses strictly", async () => {
  const tiles = await loadSeed42Tiles(64);
  expect(tiles.schema).toBe("scene/tiles/v1");
  expect(tiles.t_mean_c).toHaveLength(tiles.width * tiles.height);
  expect(tiles.circulationBands).toBe(3); // seed 42 spins Earth-like
});

test("the vendored binary's system document parses strictly", async () => {
  const sys = await loadSeed42System();
  expect(sys.schema).toBe("scene/system/v1");
  expect(sys.moons.length).toBeGreaterThan(0);
});
