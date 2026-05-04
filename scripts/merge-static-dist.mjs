import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const projectRoot = process.cwd();
const distDir = resolve(projectRoot, "dist");
const staticDir = resolve(projectRoot, "dist-static");

function assertOutputDir(dir, expectedName) {
  if (basename(dir) !== expectedName || !dir.startsWith(projectRoot)) {
    throw new Error(`Refusing to use unexpected output directory: ${dir}`);
  }
}

assertOutputDir(distDir, "dist");
assertOutputDir(staticDir, "dist-static");

const staticIndex = join(staticDir, "index.html");
const staticAssets = join(staticDir, "assets");

if (!existsSync(join(distDir, "server", "server.js"))) {
  throw new Error("Expected SSR server build at dist/server/server.js.");
}

if (!existsSync(staticIndex) || !existsSync(staticAssets)) {
  throw new Error("Expected static build output in dist-static.");
}

const targetAssets = join(distDir, "assets");

if (existsSync(targetAssets)) {
  rmSync(targetAssets, { recursive: true, force: true });
}

cpSync(staticIndex, join(distDir, "index.html"));
cpSync(staticAssets, targetAssets, { recursive: true });

writeFileSync(
  join(distDir, ".htaccess"),
  `Options -MultiViews
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]
`,
);

rmSync(staticDir, { recursive: true, force: true });

console.log("Merged static fallback into SSR dist output.");
