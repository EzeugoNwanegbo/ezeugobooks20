---
name: preview-web
description: Build and preview the G&D static production bundle locally before deploying, to catch build errors and eyeball the real production output. Use when the user says "preview", "test the build", "check the static build", "does it build", or wants to sanity-check before shipping to gd1.online.
---

# Preview the G&D production build locally

Produces the exact bundle that ships to gd1.online and serves it locally, so build
failures and production-only issues surface before you push to `main`.

## Steps

1. **Build the static bundle** (same command the live deploy runs):
   ```
   npm run build:static
   ```
   Runs `clean-dist` → `vite build --config vite.static.config.ts` →
   `prepare-static-dist` (SPA `.htaccess` + cache headers). Output lands in `dist/`.
   If this fails, the live deploy would fail too — fix it here.

2. **Serve the built bundle** exactly as production would (static, no dev server):
   ```
   npm run preview:static
   ```
   Open the printed local URL. This serves `dist/` — hashed assets, real routing
   fallback — so it matches gd1.online far better than `npm run dev`.

3. **Sanity-check:** app loads, routes work on refresh (SPA fallback), and no
   missing-asset 404s in the network tab.

## Notes

- `VITE_*` env values are baked in at build time from your local `.env`. The **live**
  site uses GitHub Secrets instead, so auth/analytics may point at different projects
  locally — that's expected.
- For a fast iteration loop use `npm run dev` instead; use this skill specifically to
  validate the *production* build shape before shipping.
- When it looks good, hand off to the `deploy-web` skill to ship.
