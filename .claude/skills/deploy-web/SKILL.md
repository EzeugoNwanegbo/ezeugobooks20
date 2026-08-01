---
name: deploy-web
description: Ship the G&D web app to production at gd1.online. Builds the static bundle, commits and pushes to main to trigger the Hostinger FTP deploy via GitHub Actions, watches the workflow run, then verifies the live site. Use when the user says "deploy", "push to web", "ship the site", "publish", "go live", or "update gd1.online".
---

# Deploy G&D to the web (gd1.online)

The production site is a **static** Vite build served from Hostinger. Pushing to
`main` triggers `.github/workflows/deploy.yml`, which runs `npm run build:static`
and FTP-uploads `dist/` to `public_html/`. The same workflow deploys the
`last-minute` Supabase edge function.

**Live URL:** https://gd1.online
**Repo:** EzeugoNwanegbo/ezeugobooks20 (`origin`, branch `main`)

## Before you touch anything

- Confirm the working dir is `project-compass-production/` and the inner git repo
  is on `main` tracking `origin/main`. (The parent folder has its own unrelated
  `.git` — always operate in the inner repo.)
- This deploy is **outward-facing and auto-deploys on push to main**. Confirm the
  user actually wants to go live before pushing, unless they already said so.

## Steps

1. **Build locally first to catch failures cheaply.** GitHub Actions minutes and a
   broken live site are more expensive than a local build.
   ```
   npm run build:static
   ```
   This runs `clean-dist` → `vite build --config vite.static.config.ts` →
   `prepare-static-dist` (writes `.htaccess` SPA fallback + cache headers). If it
   fails, fix the build before pushing — do not push a broken build.

   Note: `VITE_*` values are baked in at build time. The **live** deploy uses the
   values in GitHub Secrets, not your local `.env`; your local build only proves
   the code compiles.

2. **Stage only intentional source changes.** Never stage `dist/`, `*.zip`,
   `node_modules`, `.env`, build logs (`*.log`, `*.err`), or the `android/` build
   output. Show the user `git status` and the diff summary if anything looks off.

3. **Commit** in the repo's style (short, imperative subject; see `git log`). End
   the message with the Co-Authored-By trailer.

4. **Push to main** — this is the trigger:
   ```
   git push origin main
   ```

5. **Watch the deploy.** Find and follow the run:
   ```
   gh run list --workflow=deploy.yml --limit 1
   gh run watch <run-id>
   ```
   The workflow has two jobs: `deploy-edge-functions` (skips gracefully if
   `SUPABASE_ACCESS_TOKEN` is unset) and `build-and-deploy` (the FTP publish).
   Report the outcome of both.

6. **Verify live.** The entry `index.html` is served `no-cache`, so a new deploy is
   visible immediately. Confirm the site is up and serving the new bundle:
   ```
   curl -sI "https://gd1.online/?cb=$(date +%s)"
   curl -s "https://gd1.online/?cb=$(date +%s)" | grep -o 'assets/[^"]*\.js' | head
   ```
   Optionally cross-check the hashed asset filename against your local `dist/assets/`
   to confirm the bundle actually rolled over.

## Report back

State plainly: build result, commit pushed, both CI job outcomes, and whether
gd1.online is serving the new build. If CI failed, paste the failing step's log —
don't claim success.

## Gotchas

- **Secrets live in GitHub, not the repo.** If the live build behaves differently
  from local, check repo Secrets (`VITE_SUPABASE_*`, `VITE_POSTHOG_*`, `FTP_*`).
- **Concurrency:** the workflow cancels an in-progress deploy if you push again
  (`concurrency: hostinger-deploy`). Don't rapid-fire pushes.
- **This is not the Render or Cloudflare path.** Render auto-deploys separately from
  `render.yaml` (SSR build); Cloudflare is manual via `wrangler`. This skill only
  covers the Hostinger static production site. See `deploy-edge-functions` for
  Supabase functions beyond `last-minute`.
