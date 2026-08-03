-- Bulk library ingest support.
--
-- Adds the two things a repeatable, resumable import needs:
--   1. A content hash so re-running an import is idempotent server-side, not
--      just via a local state file. Two copies of the same book (a very common
--      thing in a compiled textbook folder) collapse to one row.
--   2. An admin INSERT policy on library_documents. Until now an admin added a
--      book by inserting it as 'pending' under the user-submit policy and then
--      updating it to 'approved'. That two-step dance exists only because there
--      was no admin insert path; a bulk importer wants to write the final row
--      once. The user-submit policy is unchanged, so student submissions still
--      land as pending.

-- ── 1. Content hash for idempotent re-imports ──────────────────────────────
alter table public.library_documents
  add column if not exists content_hash text;

comment on column public.library_documents.content_hash is
  'SHA-256 of the source file. Set by the bulk importer so re-runs skip books already ingested.';

-- Partial unique index: rows added before this migration (and any future row
-- without a hash) are unconstrained, but no two hashed books can collide.
create unique index if not exists idx_library_documents_content_hash
  on public.library_documents(content_hash)
  where content_hash is not null;

-- ── 2. Admins may insert library rows directly ─────────────────────────────
-- Permissive INSERT policies are OR'd, so this sits alongside "Users submit
-- library docs" rather than replacing it.
drop policy if exists "Admins insert library docs" on public.library_documents;
create policy "Admins insert library docs"
  on public.library_documents for insert
  with check (public.is_admin());

-- ── 3. Admins may write library chunks directly ────────────────────────────
-- library_document_chunks had no INSERT policy at all: the only way in was the
-- SECURITY DEFINER promote_document_to_library(), which copies from a user's
-- own document_chunks. A bulk importer chunks and embeds the file itself, so it
-- needs to insert directly. Still admin-only; students cannot write here.
drop policy if exists "Admins insert library chunks" on public.library_document_chunks;
create policy "Admins insert library chunks"
  on public.library_document_chunks for insert
  with check (public.is_admin());

drop policy if exists "Admins delete library chunks" on public.library_document_chunks;
create policy "Admins delete library chunks"
  on public.library_document_chunks for delete
  using (public.is_admin());
