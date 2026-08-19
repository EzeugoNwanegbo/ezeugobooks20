import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

const BUILD_ID = (() => {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  // Vercel builds from a source snapshot without a usable .git, so `git
  // rev-parse` throws there and every deploy would stamp `nogit-...` — which
  // defeats the point of the build id. The sha is exported as an env var
  // instead, so prefer it and fall back to git for local/CI builds.
  const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (vercelSha) return `${vercelSha.slice(0, 7)}-${stamp}`;

  try {
    const sha = execSync("git rev-parse --short HEAD").toString().trim();
    return `${sha}-${stamp}`;
  } catch {
    return `nogit-${Date.now()}`;
  }
})();

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    // This config mounts into <div id="root"> via index.html -> main.tsx.
    __STATIC_SPA__: JSON.stringify(true),
  },
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  server: {
    watch: {
      ignored: ["**/android/**", "**/gandd-mobile/**"],
    },
  },
  resolve: {
    alias: {
      "@": "/src",
    },
    dedupe: ["react", "react-dom"],
  },
});
