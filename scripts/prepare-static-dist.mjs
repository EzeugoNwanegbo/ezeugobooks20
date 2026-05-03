import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const distDir = resolve("dist");
const clientAssetsDir = join(distDir, "client", "assets");
const publicAssetsDir = join(distDir, "assets");

if (!existsSync(clientAssetsDir)) {
  throw new Error("Expected TanStack client assets in dist/client/assets. Run vite build first.");
}

rmSync(publicAssetsDir, { recursive: true, force: true });
mkdirSync(publicAssetsDir, { recursive: true });

const assetFiles = readdirSync(clientAssetsDir);

for (const file of assetFiles) {
  copyFileSync(join(clientAssetsDir, file), join(publicAssetsDir, file));
}

const entryFile = assetFiles.find((file) => {
  if (extname(file) !== ".js") return false;
  const source = readFileSync(join(clientAssetsDir, file), "utf8");
  return source.includes("hydrateRoot(document");
});

if (!entryFile) {
  throw new Error("Could not find the browser entry bundle in dist/client/assets.");
}

const cssFile = assetFiles.find((file) => extname(file) === ".css");
const stylesheet = cssFile ? `    <link rel="stylesheet" href="/assets/${basename(cssFile)}">\n` : "";

writeFileSync(
  join(distDir, "index.html"),
  `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>G&D - quiet intelligence for focused study</title>
    <meta name="description" content="A restrained, document-aware study interface for reading, questioning, and remembering your own notes.">
${stylesheet}    <script type="module" src="/assets/${basename(entryFile)}"></script>
  </head>
  <body></body>
</html>
`,
);

writeFileSync(
  join(distDir, ".htaccess"),
  `Options -MultiViews
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]
`,
);

console.log(`Prepared static dist with ${assetFiles.length} assets and entry ${entryFile}.`);
