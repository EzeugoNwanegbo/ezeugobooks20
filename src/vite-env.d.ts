/// <reference types="vite/client" />

// Injected at build time by `define` in vite.config.ts / vite.static.config.ts.
// Format: "<short-git-sha>-<YYYYMMDDHHmm>". Used to verify which build is live.
declare const __BUILD_ID__: string;
/**
 * True in the client-only SPA build (vite.static.config.ts), false in the
 * TanStack Start / SSR build (vite.config.ts).
 *
 * Exists because the root route's shellComponent renders a whole <html>
 * document, which is right for SSR and catastrophic for a client mount into a
 * <div>. See src/routes/__root.tsx.
 */
declare const __STATIC_SPA__: boolean;
