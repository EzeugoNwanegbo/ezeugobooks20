/// <reference types="vite/client" />

// Injected at build time by `define` in vite.config.ts / vite.static.config.ts.
// Format: "<short-git-sha>-<YYYYMMDDHHmm>". Used to verify which build is live.
declare const __BUILD_ID__: string;
