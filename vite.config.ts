/// <reference types="vitest" />
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

/** A stamp for the built JS bundle, logged on boot (see main.ts) so a rebuilt
 * version is unmistakable through layered caching. Wall-clock build time is the
 * signal that a rebuild happened (the git SHA alone repeats across rebuilds of
 * one commit); the short SHA + dirty flag ties it to source. Evaluated once per
 * `vite build` / dev-server start. NOT the wasm — that is the world catalog and
 * does not rebuild when the client JS changes. Client-only, determinism waived
 * (0022/0023). */
function buildStamp(): string {
  let src = 'no-git';
  try {
    const sha = execSync('git rev-parse --short HEAD').toString().trim();
    const dirty = execSync('git status --porcelain').toString().trim() ? '-dirty' : '';
    src = `${sha}${dirty}`;
  } catch {
    /* not a git checkout — keep the placeholder */
  }
  return `${new Date().toISOString()} @ ${src}`;
}

export default defineConfig({
  define: { __BUILD_STAMP__: JSON.stringify(buildStamp()) },
  // Absolute base matching the GitHub Pages deploy path (the deploy workflow
  // also passes `--base=/orrery/`; keeping it here makes a plain `npm run
  // build` match the deploy instead of a rootless `./` that 404s the wasm
  // under the sub-path — orrery#7). `catalogUrl` requires an absolute base.
  base: '/orrery/',
  worker: { format: 'es' },
  // e2e/ holds Playwright specs (a different test runner, different
  // `test()` global) — vitest's default glob would otherwise pick them up
  // and collide with @playwright/test's own `test()`. Extend the defaults
  // rather than replace them, so dist/ and friends stay excluded too.
  test: { environment: 'happy-dom', exclude: [...configDefaults.exclude, 'e2e/**'] },
});
