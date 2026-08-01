---
name: deploy-edge-functions
description: Deploy G&D's Supabase Edge Functions (chat, suggest-folder, studybody, last-minute, etc.) to the live Supabase project. Use when the user changes anything under supabase/functions/ and says "deploy the function", "push the edge function", "update the chat backend", or "deploy supabase functions".
---

# Deploy Supabase Edge Functions

The app's AI backend lives in `supabase/functions/` (Deno edge functions). These
deploy independently of the web frontend — a frontend push to Hostinger does **not**
update them (except `last-minute`, which `deploy.yml` deploys on push to main).

**Project ref:** `ptditjhezxiwdeqqoezc`

## Prerequisites

- Supabase CLI available: `npx supabase --version`.
- Authenticated: `npx supabase login` (or `SUPABASE_ACCESS_TOKEN` set). If not
  logged in, ask the user to run `! npx supabase login` in the session.

## Deploy

Deploy only the function(s) that changed. Current functions:
`chat`, `connect-dots`, `delete-account`, `embed`, `extract-image` (legacy),
`extract-pdf`, `last-minute`, `studybody`, `suggest-folder`. Example:
```
npx supabase functions deploy chat            --project-ref ptditjhezxiwdeqqoezc
npx supabase functions deploy suggest-folder  --project-ref ptditjhezxiwdeqqoezc
npx supabase functions deploy studybody       --project-ref ptditjhezxiwdeqqoezc
npx supabase functions deploy last-minute     --project-ref ptditjhezxiwdeqqoezc
```
List what actually exists first if unsure:
```
ls supabase/functions
```

## Secrets (server-only — never commit these)

Edge functions read secrets like `OPENAI_API_KEY` and `DEEPSEEK_API_KEY` from
Supabase, not from `.env`. To set/update:
```
npx supabase secrets set OPENAI_API_KEY=sk-... DEEPSEEK_API_KEY=sk-... --project-ref ptditjhezxiwdeqqoezc
```
Never echo secret values back into the transcript or commit them.

## Verify

After deploy, confirm the function responds (or check the Supabase dashboard →
Edge Functions → logs). Report which functions deployed and their status.

## Notes

- Database schema changes are separate: `npx supabase db push` applies migrations in
  `supabase/migrations/`. Don't run it as part of a function deploy unless the user
  asked to migrate.
- The `extract-image` function is legacy (browser Tesseract.js OCR replaced it) —
  don't deploy it unless explicitly requested.
