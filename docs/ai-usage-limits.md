# AI usage controls

The daily base allowance is **10 credits per user**, resetting at 00:00 UTC (01:00 in Lagos). Existing admin grants continue to add to that allowance. Already-spent credits are preserved when the allowance changes.

| Action                                     | Credits                        |
| ------------------------------------------ | ------------------------------ |
| Chat, including web and document questions | 1                              |
| Patient clerking draft (each generation)    | 2                              |
| Questions                                  | 1 per 10 questions, rounded up |
| Flashcards                                 | 1 per 20 cards, rounded up     |
| Study plan or Last Minute guide            | 2                              |
| AI answer review / coaching                | 1                              |
| Objective MCQ grading                      | 0                              |
| Folder suggestion or embedding request     | 1                              |
| Connections or legacy image OCR request    | 2                              |

Embedding and folder suggestion requests have their own costs: an upload or a chat action may trigger these auxiliary requests as well. Browser OCR itself uses no paid AI. Battle rounds are charged through question generation, with no second battle charge.

Paid endpoints verify the session using Supabase Auth. Missing billing configuration, missing migrations, RPC failures, and exhausted credits block paid work. A database transaction lock serializes spending per user. Refunds are server-only and idempotent; users cannot refund a successful AI request through a browser RPC.

## Provider budgets

Every paid provider hop, including fallback attempts, reserves from a shared database ledger before contacting the provider. This covers chat, StudyBody, Last Minute, folder suggestions, connections, embeddings, and legacy image OCR.

| Control                                                  | Default ceiling |
| -------------------------------------------------------- | --------------- |
| Provider requests across the whole site per UTC day      | 100             |
| Reserved output tokens across the whole site per UTC day | 300,000         |
| Input characters across the whole site per UTC day       | 2,000,000       |
| Text input characters per provider request               | 200,000         |
| Standard chat / Last Minute / image OCR output           | 4,096 tokens    |
| StudyBody output (up to 40 questions per set)            | 8,192 tokens    |
| Connections output                                       | 2,048 tokens    |
| Patient clerking draft output                            | 3,000 tokens    |
| Folder suggestion output                                 | 256 tokens      |
| Web search tool calls per request                        | 1               |

Provider reservations are not refunded on failed requests: providers may have already billed the work. Student credits are refunded on reported generation failures. A disconnected process can still prevent a student refund, but cannot remove its provider reservation. Output budgets reserve the maximum possible completion, rather than relying on post-response accounting. Input character counts are a conservative workload control, not an exact tokenizer measurement. Image inputs reserve 8,192 input characters each. This is not an exact currency limit; model prices, reasoning, and search fees vary.

HTTP JSON input is limited to 1 MB, or 12 MB for legacy image OCR. Output caps can truncate longer generations; chat's existing completion-length warning remains in place. Question generation keeps its existing 8,192-token cap so a 40-question set remains supported.

## Activate in Supabase

1. Ensure the existing cookie budget and ladder migrations have been applied. Apply `supabase/migrations/20261009120000_strict_ai_usage_limits.sql` in the SQL editor (or through your usual migration pipeline). It creates the provider ledger and safe refund RPC, serializes credit spending, revokes browser refunds, and changes the base allowance to ten.
2. Deploy all seven updated functions together: `chat`, `studybody`, `last-minute`, `suggest-folder`, `connect-dots`, `embed`, and `extract-image`. Shared code in `_shared/usage-limits.ts` is bundled by Supabase; `_shared` is not a deployable function.
3. Deploy the frontend so AI-review pricing is reflected in its optimistic credit meter. Actual balances come from the server.
4. Verify a signed-in account can complete a question, its balance decreases, and an exhausted account is refused before a provider call. Check `ai_provider_daily_usage` in the SQL editor. Check a failed generation refunds once.

Existing provider and Supabase service-role keys stay in Supabase Edge Function secrets. Never put these keys in frontend environment variables or logs.

Optional Edge Function settings can lower the ceilings: `AI_DAILY_PROVIDER_CALL_LIMIT`, `AI_DAILY_OUTPUT_TOKEN_LIMIT`, `AI_DAILY_INPUT_CHAR_LIMIT`, and `AI_MAX_OUTPUT_TOKENS`. The shared helper refuses to raise a ceiling above its code default. Lowering `AI_MAX_OUTPUT_TOKENS` also lowers question-generation output and may make large sets incomplete.

The ledger is shared within this Supabase project. Provider use from other applications, old deployed functions, direct SDK clients, and manual calls is outside these controls. Production protection starts only after the migration and all updated functions are deployed. Migrating without deployment revokes old refund permissions before old functions have switched to the new RPC; complete the deployment promptly.

## Validation

Run `node scripts/test-ai-usage-limits.cjs` for mocked authentication, credit failures, provider caps, global-budget refusal, auxiliary refunds, and request-size checks. Run `npx tsc --noEmit` and the normal frontend build. Onboarding also exercised the migration against embedded PostgreSQL; live Supabase deployment and concurrent production behavior still require verification.
