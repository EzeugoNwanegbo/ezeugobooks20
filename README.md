# G&D

A precision document-answering app for students.
Upload notes/course materials → AI organizes them into folders → ask questions in
**Simplified**, **Detailed**, **Storytelling**, or **Visuals** mode → use **Find connections**
to interlink concepts across subjects. The core promise is pinpoint retrieval:
ask a precise question about large files and get the exact answer, source trail,
explanation, or an animated visual package.

Built with **TanStack Start (React 19) + Vite 7 + Tailwind v4 + Supabase**.

---

## How Codex was used

We used **OpenAI Codex** as the primary coding agent while building G&D. It did
the heaviest lifting on the **React 19 / TanStack Start frontend** and on the
surrounding app plumbing:

- **The full frontend surface** — the file-based TanStack routes under
  `src/routes/`: the multi-mode chat UI (`app.chat`), the PDF upload + folder
  library (`app.library`), the 4-step onboarding flow (`onboarding`), email +
  Google auth (`auth`), plus settings, chat history, leaderboard, practice,
  StudyBody, the admin/shared-library page, and last-minute cram mode.
- **Shared UI + app shell** — the Radix/shadcn component layer under
  `src/components/ui/`, the responsive app shell, theme toggle, loading and
  skeleton states, and the error boundary.
- **Client-side app logic** — the SSE streaming chat client
  (`src/lib/chat-client.ts`), browser-side PDF text extraction
  (`src/lib/pdf.ts`), the Tesseract.js OCR wiring, hybrid chunk retrieval and
  page-citation handling on the client, plus the gamification and
  personalization helpers.
- **Backend scaffolding** — first drafts of the Supabase Edge Functions under
  `supabase/functions/` (chat routing, folder suggestion, StudyBody) and the
  page-aware document chunking logic.

In short: Codex built most of what a student actually sees and touches, and
scaffolded the edge-function backend it talks to.

---

## Stack at a glance

| Piece                   | What it is                                                |
| ----------------------- | --------------------------------------------------------- |
| Frontend                | React 19 + TanStack Start + Tailwind v4                   |
| Auth + DB + Storage     | Supabase (Postgres + Auth + Storage)                      |
| Chat AI (general)       | DeepSeek draft -> OpenAI final style                      |
| File answer AI          | DeepSeek retrieval -> OpenAI final style                  |
| Visuals mode            | DeepSeek research -> GPT storyboard -> DeepSeek animation |
| Folder suggestion       | DeepSeek                                                  |
| Image OCR               | Tesseract.js in the browser                               |
| Edge runtime            | Supabase Edge Functions (Deno)                            |
| Deploy target (default) | Cloudflare Workers (via Vite plugin)                      |
| Android wrapper         | Capacitor                                                 |
| Expo mobile project     | `gandd-mobile/`                                           |

---

## Running it on Lovable (zero setup - deprecated)

The app was originally built on Lovable Cloud, which provided built-in Supabase + AI Gateway integration. Now it's self-hosted with full control over your AI providers.

---

## Self-hosting setup

You need two API keys for chat. Image uploads are handled in the browser with Tesseract.js:

- `OPENAI_API_KEY` (for final response style and web search sources)
- `DEEPSEEK_API_KEY` (for document analysis, factual drafts, and folder suggestion)

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
```

Set the edge-function secrets either via Supabase Dashboard or CLI:

```bash
npx supabase secrets set OPENAI_API_KEY=sk-... DEEPSEEK_API_KEY=sk-...
```

### 5. Deploy edge functions

```bash
npx supabase functions deploy chat
npx supabase functions deploy suggest-folder
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

## Android app

The Android app is a Capacitor wrapper around the same static web build. The
website remains unchanged; Capacitor copies `dist/` into the native Android
project.

Local commands:

```bash
npm run android:sync        # build static web app and sync android/
npm run android:open        # open android/ in Android Studio
npm run android:build:debug # build a local debug APK, requires JDK + Android SDK
```

The GitHub Actions workflow at `.github/workflows/android.yml` builds a debug
APK artifact on pushes to `main` and can also be run manually from GitHub
Actions.

Release to Google Play still needs a Play Console account, final package ID,
app icon/splash assets, privacy policy, and a signed release AAB.

---

## Expo mobile project

`gandd-mobile/` is a separate Expo project for testing G&D on iPhone through
Expo Go and for a later native mobile rebuild.

Current first version: an Expo WebView shell that opens the deployed or local
G&D website without changing the web app.

```bash
cd gandd-mobile
npm run start:lan
```

See `gandd-mobile/README.md` for iPhone setup.

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

**Visuals mode**:

- If files are selected or pinpoint search finds matching material, **DeepSeek**
  extracts the source facts and visual cues.
- If Web is enabled, **OpenAI web search** gathers current source-grounded facts.
- **GPT** turns the research into a storyboard and developer handoff.
- **DeepSeek** produces a self-contained HTML/CSS/JS animation package that the
  chat UI previews in a sandboxed iframe.

**Plain chat** (no documents):

- **DeepSeek** prepares the factual draft.
- **OpenAI** receives the draft and applies Simplified/Detailed/Storytelling style.

**Folder suggestion** (when uploading new documents):

- **DeepSeek** analyzes the document excerpt and suggests a folder name.

**Image upload**:

- The browser runs **Tesseract.js** OCR locally on the user's image.
- No OCR Edge Function secret is required.
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
    extract-image/         Legacy OCR proxy, not used by current browser OCR
    studybody/             Roadmaps, practice generation, grading, coaching
  migrations/              Schema (folders, documents, conversations, messages, profiles)
  config.toml              Edge function config
```

---

## License

MIT.
