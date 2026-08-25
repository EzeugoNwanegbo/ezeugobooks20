# Moving gd1.online from Hostinger to Vercel

## Why static, not SSR

The app has no server-side code. There is not one `createServerFn` in `src/`, and
the only two server-only modules — `src/integrations/supabase/client.server.ts`
and `src/integrations/supabase/auth-middleware.ts` — are imported by nothing.
Every request goes browser → Supabase or browser → Supabase Edge Function.

So the Node server Hostinger runs (`server.mjs` + `dist/server`) is only rendering
HTML that a CDN can serve for free. The static build (`npm run build:static`) is
the same app, already exercised on every push by CI and already shipped inside the
Android app via Capacitor.

**What you give up:** server-rendered HTML on the public pages (`/`, `/privacy`,
`/terms`). Crawlers and link-preview bots get the empty shell instead of real
markup. If landing-page SEO starts to matter, the fix is prerendering those three
routes at build time — not going back to a Node server.

## What is already configured

- **`vercel.json`** — build command, output dir, SPA rewrite, cache headers.
  The rewrite deliberately excludes `/assets/` so a stale hashed chunk still
  404s; `installChunkReloadHandler()` in `src/main.tsx` depends on that failure
  to detect a post-deploy tab and reload it. If `/assets/` fell through to
  `index.html`, the browser would receive HTML for a `.js` request instead.
  `installCommand` is pinned to `npm ci` because a stray `bun.lockb` sits in the
  repo root and would otherwise make Vercel build with bun.
- **`.vercelignore`** — keeps `android/`, `gandd-mobile/`, `my-video/` and the
  old Hostinger zips out of the build context. **Every pattern is anchored with
  a leading slash.** An unanchored `supabase/` matches a directory of that name
  at any depth, so it also removed `src/integrations/supabase/` and the first
  deploy died with `Could not load /src/integrations/supabase/client`. Root-level
  `supabase/` is no longer excluded at all — it is a few dozen small text files,
  not worth the pattern that caused that.
- **`vite.static.config.ts`** — `BUILD_ID` now prefers `VERCEL_GIT_COMMIT_SHA`,
  because Vercel builds from a source snapshot where `git rev-parse` throws.

## Cutover

Nothing below touches the live site until step 5. Hostinger keeps serving
gd1.online the whole time.

**1. Create the project.** — DONE. Project `gd1` under scope
`nwanegboezeugo-8256s-projects`, created with `vercel link`. `vercel.json`
supplies the build settings, so the framework preset stays "Other".

**2. Set environment variables.** — DONE. These five are set on production,
preview and development, and were verified against `.env` with `vercel env pull`:

| Variable | Source |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase → Settings → API |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase → Settings → API (anon key) |
| `VITE_SUPABASE_PROJECT_ID` | `ptditjhezxiwdeqqoezc` |
| `VITE_POSTHOG_PROJECT_TOKEN` | PostHog → Project settings |
| `VITE_POSTHOG_HOST` | `https://us.i.posthog.com` |

They are baked in at build time, so changing one needs a redeploy to take effect.

`SUPABASE_SERVICE_ROLE_KEY` is deliberately **not** here. This is a static build
— anything Vercel exposes to it can end up in the public bundle, and that key
bypasses row-level security. It belongs only in Supabase Edge Function secrets.

**2b. Connect GitHub to the Vercel account.** — TODO, and required for
auto-deploy. `vercel link` failed to attach the repo with:

> Failed to link EzeugoNwanegbo/ezeugobooks20. You need to add a Login
> Connection to your GitHub account first. (400)

The Vercel account was created with a non-GitHub login method, so it cannot
attach a repo yet. Fix at Vercel → Account Settings → Authentication → connect
GitHub, then Project `gd1` → Settings → Git → connect the repository. Until this
is done, deploys only happen when someone runs `vercel deploy` by hand.

**3. Allowlist the deployed domain in Supabase.** Auth → URL Configuration →
Redirect URLs. Every `emailRedirectTo` / `redirectTo` in the app is built from
`window.location.origin`, so Supabase rejects the callback unless the origin is
listed. Signup confirmation, password reset and Google OAuth all fail without it.

Preview deployments get a new hostname per deploy, so allowlist the wildcard
`https://gd1-*-nwanegboezeugo-8256s-projects.vercel.app/**` rather than one URL.

**4. Test the preview deployment properly.** Not just "does it load":

- sign up with a fresh email and click the confirmation link
- sign in with Google
- upload a PDF and ask a question (proves the Edge Functions are reachable)
- hard-refresh on a deep link like `/app/chat` (proves the SPA rewrite works)
- check `document.documentElement.dataset.build` shows the commit sha
- confirm the pageview lands in PostHog

Note that **Deployment Protection is on**: an unauthenticated request to a
preview URL gets a 302 to Vercel SSO. In a browser signed in to the Vercel
account it just works, but testing on a phone or sharing the link needs either
Project → Settings → Deployment Protection turned off for previews, or a
protection-bypass token.

**5. Point the domain.** Vercel → Settings → Domains, add `gd1.online` and
`www.gd1.online`, then set the DNS records exactly as Vercel displays them in
your Hostinger DNS zone. Propagation is usually minutes. Add
`https://gd1.online/**` to the Supabase redirect allowlist too if it is not
already there.

**6. Disable Hostinger's GitHub auto-deployment** in hPanel. Until you do, both
hosts rebuild on every push, which wastes build minutes and leaves a live
fallback that can silently diverge.

**7. Update `.claude/skills/deploy-web/SKILL.md`.** It currently documents the
Hostinger FTP/SSR flow and will be actively wrong after cutover.

## Rollback

Re-point DNS at Hostinger and re-enable its GitHub deployment. Keep `server.mjs`,
`vite.config.ts` and `render.yaml` in the repo — they are the SSR path and cost
nothing to keep, and `.vercelignore` already excludes them from Vercel builds.

## After cutover

`.github/workflows/deploy.yml` stays useful: it deploys the Supabase Edge
Functions and asserts the PostHog token is baked into the bundle. Only its name
and the header comment about Hostinger need rewording.

`scripts/prepare-static-dist.mjs` writes `.htaccess` files into `dist/` for
Apache/LiteSpeed. Vercel ignores them. Harmless, and worth keeping while
Hostinger is still a rollback target.
