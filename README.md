# G&D

A precision document-answering app for students.
Upload notes/course materials → AI organizes them into folders → ask questions in
**Simplified**, **Detailed**, or **Storytelling** mode → use **Find connections**
to interlink concepts across subjects. The core promise is pinpoint retrieval:
ask a precise question about large files and get the exact answer, source trail,
and explanation.

Built with **TanStack Start (React 19) + Vite 7 + Tailwind v4 + Supabase**.

---

## Stack at a glance

| Piece                   | What it is                               |
| ----------------------- | ---------------------------------------- |
| Frontend                | React 19 + TanStack Start + Tailwind v4  |
| Auth + DB + Storage     | Supabase (Postgres + Auth + Storage)     |
| Chat AI (general)       | DeepSeek draft -> OpenAI final style     |
| File answer AI          | DeepSeek retrieval -> OpenAI final style |
| Folder suggestion       | DeepSeek                                 |
| Image OCR               | DeepSeek OCR endpoint                    |
| Edge runtime            | Supabase Edge Functions (Deno)           |
| Deploy target (default) | Cloudflare Workers (via Vite plugin)     |

---

## Running it on Lovable (zero setup - deprecated)

The app was originally built on Lovable Cloud, which provided built-in Supabase + AI Gateway integration. Now it's self-hosted with full control over your AI providers.

---

## Self-hosting setup

You need two API keys for chat, plus an OCR endpoint if you want image uploads:

- `OPENAI_API_KEY` (for final response style and web search sources)
- `DEEPSEEK_API_KEY` (for document analysis, factual drafts, and folder suggestion)
- `DEEPSEEK_OCR_BASE_URL` + `DEEPSEEK_OCR_API_KEY` (optional, for image uploads)

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

| Provider | Where                                  | What it powers                       |
| -------- | -------------------------------------- | ------------------------------------ |
| OpenAI   | https://platform.openai.com/api-keys   | Final explanation style + web search |
| DeepSeek | https://platform.deepseek.com/api_keys | Document analysis + factual drafts   |

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
#   DEEPSEEK_OCR_BASE_URL=https://YOUR_DEEPSEEK_OCR_ENDPOINT
#   DEEPSEEK_OCR_API_KEY=sk-...
```

Set the edge-function secrets either via Supabase Dashboard or CLI:

```bash
npx supabase secrets set OPENAI_API_KEY=sk-... DEEPSEEK_API_KEY=sk-...
# Optional image OCR:
npx supabase secrets set DEEPSEEK_OCR_BASE_URL=https://YOUR_DEEPSEEK_OCR_ENDPOINT DEEPSEEK_OCR_API_KEY=sk-...
```

### 5. Deploy edge functions

```bash
npx supabase functions deploy chat
npx supabase functions deploy suggest-folder
npx supabase functions deploy extract-image
npx supabase functions deploy studybody
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

Large course-material PDFs are extracted as text and split into searchable
chunks. Chat uses the most relevant chunks first, then falls back to targeted
document previews when chunk search is unavailable.

### 300 MB uploads

PDFs are extracted in the **browser** with `pdfjs-dist`. The original PDF
file is **never** uploaded to Supabase Storage (that bypasses Supabase's
50 MB file limit and saves storage cost). Only the extracted text is
persisted in the `documents.extracted_text` column.

Storage paths starting with `text-only/` are virtual markers — there's no
real object behind them. The library code already knows not to attempt
storage cleanup on those.

### Routing logic in `supabase/functions/chat/index.ts`

**File-answer pipeline** (with documents):

1. Search indexed chunks from selected files or the whole library.
2. **DeepSeek** reads the retrieved excerpts and produces the factual/source summary.
3. **OpenAI** receives only DeepSeek's summary and applies Simplified/Detailed/Storytelling style.

**Plain chat** (no documents):

- **DeepSeek** prepares the factual draft.
- **OpenAI** receives the draft and applies Simplified/Detailed/Storytelling style.

**Folder suggestion** (when uploading new documents):

- **DeepSeek** analyzes the document excerpt and suggests a folder name.

**Image upload**:

- Browser sends the image to `extract-image`.
- `extract-image` calls your configured **DeepSeek OCR** endpoint.
- The extracted text is chunked and searched like any other uploaded material.

**StudyBody**:

- **DeepSeek** turns selected files/course outlines into roadmaps and practice questions.
- **DeepSeek** grades MCQ/essay answers against answer keys and rubrics.
- **OpenAI** receives DeepSeek's grading summary and writes the final correction/coaching in the user's preferred style.

The edge functions use OpenAI-compatible chat completions where the provider supports it.

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
    extract-image/         DeepSeek OCR proxy for image uploads
    studybody/             Roadmaps, practice generation, grading, coaching
  migrations/              Schema (folders, documents, conversations, messages, profiles)
  config.toml              Edge function config
```

---

## License

MIT.
