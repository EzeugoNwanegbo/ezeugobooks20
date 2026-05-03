# G&D

A personalized study assistant for students in any course.
Upload notes/course materials → AI organizes them into folders → ask questions in
**Simplified**, **Detailed**, or **Storytelling** mode → use **Find connections**
to interlink concepts across subjects.

Built with **TanStack Start (React 19) + Vite 7 + Tailwind v4 + Supabase**.

---

## Stack at a glance

| Piece                   | What it is                                   |
| ----------------------- | -------------------------------------------- |
| Frontend                | React 19 + TanStack Start + Tailwind v4      |
| Auth + DB + Storage     | Supabase (Postgres + Auth + Storage)         |
| Chat AI (general)       | OpenAI `gpt-4o-mini`                         |
| Library Q&A AI          | DeepSeek `deepseek-chat` (128K context)      |
| Folder suggestion       | OpenAI `gpt-4o-mini`                         |
| Edge runtime            | Supabase Edge Functions (Deno)               |
| Deploy target (default) | Cloudflare Workers (via Vite plugin)         |

---

## Running it on Lovable (zero setup - deprecated)

The app was originally built on Lovable Cloud, which provided built-in Supabase + AI Gateway integration. Now it's self-hosted with full control over your AI providers.

---

## Self-hosting setup

You only need two API keys:
- `OPENAI_API_KEY` (for chat responses and folder suggestion)
- `DEEPSEEK_API_KEY` (for document analysis)

### 1. Clone and install

```bash
git clone <your-repo>
cd <your-repo>
bun install   # or npm install / pnpm install
```

### 2. Create a Supabase project

1. Go to https://supabase.com → **New project**.
2. Once it's ready, copy from **Project Settings → API**:
   - Project URL → `VITE_SUPABASE_URL`
   - `anon` public key → `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `service_role` key → keep secret (server only)
3. Run all migrations in `supabase/migrations/` against your new DB:
   ```bash
   npx supabase link --project-ref <your-ref>
   npx supabase db push
   ```
4. Create the storage bucket (private):
   - Storage → New bucket → `documents` → **not public**
5. Enable Email + Google providers in **Auth → Providers**.
   For Google OAuth: create credentials in Google Cloud Console
   (https://console.cloud.google.com → APIs & Services → Credentials),
   add your domain to authorized origins, paste the client ID/secret
   into Supabase.

### 3. Get the AI keys

You need exactly two API keys:

| Provider | Where                                  | What it powers                |
| -------- | -------------------------------------- | ----------------------------- |
| OpenAI   | https://platform.openai.com/api-keys   | Chat responses + folder suggestion |
| DeepSeek | https://platform.deepseek.com/api_keys | Document analysis (with 128K context) |

### 4. Set environment variables

Create a `.env` file at the project root:

```env
# Frontend (exposed to browser, must be prefixed VITE_)
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGci...

# Edge function secrets (set these in Supabase dashboard → Edge Functions → Secrets)
# DO NOT put these in .env — they are server-only.
#   OPENAI_API_KEY=sk-...
#   DEEPSEEK_API_KEY=sk-...
```

Set the edge-function secrets either via Supabase Dashboard or CLI:

```bash
npx supabase secrets set OPENAI_API_KEY=sk-... DEEPSEEK_API_KEY=sk-...
```

### 5. Deploy edge functions

```bash
npx supabase functions deploy chat
npx supabase functions deploy suggest-folder
```

### 6. Deploy the frontend

This template targets **Cloudflare Workers** by default (see
`wrangler.jsonc`). Other options:

| Host             | What to do                                                      |
| ---------------- | --------------------------------------------------------------- |
| Cloudflare       | `bun run build` then `npx wrangler deploy`                      |
| Vercel           | Add a Vercel preset to `vite.config.ts`, push to GitHub, import |
| Netlify          | Add the Netlify TanStack Start preset                           |
| Self-hosted Node | `bun run build` then run the Node entry from `.output/server`   |

### 7. Update CORS / OAuth allowed origins

Once you have your final domain:

- Supabase **Auth → URL Configuration** → add your site URL + redirect URLs.
- Google Cloud Console → OAuth client → add the same URLs.

---

## Things to know about the AI setup

### DeepSeek context limit (128K tokens ≈ 400K chars)

Even for 300 MB course-material PDFs we extract text only and **truncate to ~280K
chars per request**, split evenly across the documents the user has open.
For a true full-book Q&A on enormous libraries you'd want to add **RAG**
(chunk + embed + retrieve only relevant chunks). Not built in yet — the
current setup is "send the most we can fit, get a great answer, mention the
truncation in the system prompt."

### 300 MB uploads

PDFs are extracted in the **browser** with `pdfjs-dist`. The original PDF
file is **never** uploaded to Supabase Storage (that bypasses Supabase's
50 MB file limit and saves storage cost). Only the extracted text is
persisted in the `documents.extracted_text` column.

Storage paths starting with `text-only/` are virtual markers — there's no
real object behind them. The library code already knows not to attempt
storage cleanup on those.

### Routing logic in `supabase/functions/chat/index.ts`

**Two-stage AI pipeline** (with documents):
1. **DeepSeek** reads all uploaded documents → extracts raw facts (temperature 0.2 for accuracy)
2. **OpenAI** takes DeepSeek's response → rewrites in the student's chosen style

**Plain chat** (no documents):
- **OpenAI** handles everything directly

**Folder suggestion** (when uploading new documents):
- **OpenAI** analyzes the document excerpt → suggests a folder name

Both `chat` and `suggest-folder` edge functions use the OpenAI-compatible chat completions API schema.

---

## Project structure

```
src/
  routes/                  TanStack Start file-based routes
    app.chat.tsx           Chat UI (modes + interlink + sidebar)
    app.library.tsx        PDF upload + folder management
    onboarding.tsx         4-step student profile setup
    auth.tsx               Email + Google sign-in
  lib/
    auth-context.tsx       Supabase auth + profile provider
    chat-client.ts         SSE streaming client for /functions/v1/chat
    pdf.ts                 Browser PDF text extraction
  integrations/
    supabase/              Auto-generated client + types (DO NOT edit)

supabase/
  functions/
    chat/                  AI router (DeepSeek docs / OpenAI chat)
    suggest-folder/        Auto-categorises new uploads
  migrations/              Schema (folders, documents, conversations, messages, profiles)
  config.toml              Edge function config
```

---

## License

MIT.
