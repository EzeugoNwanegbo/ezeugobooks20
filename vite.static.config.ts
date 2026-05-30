import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

const BUILD_ID = (() => {
  try {
    const sha = execSync("git rev-parse --short HEAD").toString().trim();
    return `${sha}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
  } catch {
    return `nogit-${Date.now()}`;
  }
})();

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
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
