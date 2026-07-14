// worker.ts — genesis off the main thread (it takes seconds).
import { loadCatalog } from "./catalog";
import { parseSystem, parseTiles } from "./scene";

self.onmessage = async (ev: MessageEvent) => {
  const { seed, pins, tilesWidth } = ev.data;
  try {
    const catalog = await loadCatalog(new URL("/hornvale_world.wasm", self.location.origin).href);
    catalog.generate(BigInt(seed), pins);
    const system = parseSystem(catalog.sceneSystem());
    const tiles = parseTiles(catalog.sceneTiles(tilesWidth));
    self.postMessage({ type: "world", system, tiles });
  } catch (err) {
    self.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
