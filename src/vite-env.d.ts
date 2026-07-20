/// <reference types="vite/client" />

/** Build stamp injected by `vite.config.ts`'s `define` — ISO build time + short
 * git SHA (+`-dirty`). Logged on boot (`main.ts`) to defeat layered caching when
 * confirming a rebuilt bundle is what's actually running. */
declare const __BUILD_STAMP__: string;
