import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const distDir = resolve("dist");

if (!existsSync(join(distDir, "index.html"))) {
  throw new Error("Expected a static index.html in dist. Run the static Vite build first.");
}

writeFileSync(
  join(distDir, ".htaccess"),
  `Options -MultiViews
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]
`,
);

console.log("Prepared static dist route fallback.");
