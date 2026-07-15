import { expect, test } from "vitest";
import { catalogUrl } from "./worker";

test("catalogUrl joins a Pages sub-path base with the filename", () => {
  expect(catalogUrl("/goldengrove/", "https://hornvale.github.io")).toBe(
    "https://hornvale.github.io/goldengrove/hornvale_world.wasm",
  );
});

test("catalogUrl joins the root base for local dev/preview", () => {
  expect(catalogUrl("/", "http://localhost:4173")).toBe("http://localhost:4173/hornvale_world.wasm");
});

test("catalogUrl tolerates a base missing its trailing slash", () => {
  expect(catalogUrl("/goldengrove", "https://hornvale.github.io")).toBe(
    "https://hornvale.github.io/goldengrove/hornvale_world.wasm",
  );
});
