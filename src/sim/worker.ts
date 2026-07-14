// worker.ts — genesis off the main thread (it takes seconds).
import { CatalogFetchError, loadCatalog } from "./catalog";
import { parseSystem, parseTiles, SceneFormatError } from "./scene";

/** How main.ts distinguishes the three worker failure modes it renders as
 * distinct, styled full-screen states: the catalog binary itself never
 * loaded, genesis refused the seed, or a landed scene document failed its
 * own schema check. */
export type WorkerErrorKind = "catalog-fetch" | "genesis" | "schema" | "unknown";

function errorKind(err: unknown): WorkerErrorKind {
  if (err instanceof CatalogFetchError) return "catalog-fetch";
  if (err instanceof SceneFormatError) return "schema";
  if (err instanceof Error) return "genesis";
  return "unknown";
}

self.onmessage = async (ev: MessageEvent) => {
  const { seed, pins, tilesWidth } = ev.data;
  try {
    const catalog = await loadCatalog(new URL("/hornvale_world.wasm", self.location.origin).href);
    catalog.generate(BigInt(seed), pins);
    const system = parseSystem(catalog.sceneSystem());
    const tiles = parseTiles(catalog.sceneTiles(tilesWidth));
    self.postMessage({ type: "world", system, tiles });
  } catch (err) {
    self.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
      kind: errorKind(err),
    });
  }
};
