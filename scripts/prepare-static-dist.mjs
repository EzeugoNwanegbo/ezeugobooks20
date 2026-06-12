import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const distDir = resolve("dist");

if (!existsSync(join(distDir, "index.html"))) {
  throw new Error("Expected a static index.html in dist. Run the static Vite build first.");
}

// SPA fallback + cache policy. The cache rules are what keep deploys safe:
// index.html must NEVER be cached (it's the pointer to the current hashed
// bundles — a stale copy references deleted files and renders a broken app),
// while the hashed files under assets/ are immutable and can be cached for a
// year (any content change produces a new filename).
writeFileSync(
  join(distDir, ".htaccess"),
  `Options -MultiViews
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]

<IfModule mod_headers.c>
  # Entry point: always revalidate so every deploy is live for everyone
  # immediately — no "clear your cache" support cases.
  <FilesMatch "\\.html$">
    Header set Cache-Control "no-cache, no-store, must-revalidate"
  </FilesMatch>
  # Root-level non-hashed files (favicons etc.) change in place across
  # deploys, so keep their cache short.
  <FilesMatch "\\.(ico|png|svg|txt|webmanifest)$">
    Header set Cache-Control "public, max-age=3600"
  </FilesMatch>
</IfModule>
`,
);

if (existsSync(join(distDir, "assets"))) {
  // Everything in assets/ carries a content hash in its filename, so it is
  // immutable by construction — cache as hard as browsers allow.
  writeFileSync(
    join(distDir, "assets", ".htaccess"),
    `<IfModule mod_headers.c>
  Header set Cache-Control "public, max-age=31536000, immutable"
</IfModule>
`,
  );
}

console.log("Prepared static dist route fallback + cache headers.");
