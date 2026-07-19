-- Shared library ("built-in textbooks") + admin moderation.
--
-- New users can search a curated, owner-less corpus without uploading anything,
-- scoped to their discipline. Content is added or approved by an admin. A user
-- may also submit their own upload to the shared library (for points); it stays
-- pending until an admin approves it. This keeps the owner in control of what
-- actually gets redistributed.

-- ── 1. Admin flag ──────────────────────────────────────────────────────────
alter table public.user_profiles
  add column if not exists is_admin boolean not null default false;

-- Bootstrap the owner account as admin (id looked up from auth.users by email).
update public.user_profiles p
set is_admin = true
from auth.users u
where u.id = p.id
  and lower(u.email) = 'nwanegboezeugo@gmail.com';

-- SECURITY DEFINER helper so RLS policies can check admin without recursively
-- evaluating user_profiles' own policies.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_admin from public.user_profiles where id = auth.uid()), false);
$$;

-- ── 2. Library catalog ─────────────────────────────────────────────────────
create table if not exists public.library_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  file_name text not null,
  storage_path text,
  file_type text,
  file_size bigint,
  page_count int,
  discipline text,            -- 'medicine' | 'law' | null (= visible to all)
  subject text,               -- e.g. 'Anatomy', 'Contract Law'
  track text,                 -- e.g. 'Pre-clinical'
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  submitted_by uuid references auth.users(id) on delete set null, -- null = admin-added
  source_document_id uuid,    -- the user document this was submitted from, if any
  rights_note text,           -- admin note on licensing / source
  created_at timestamptz default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

alter table public.library_documents enable row level security;

-- Signed-in users see approved docs; submitters see their own; admins see all.
create policy "View approved or own library docs"
  on public.library_documents for select
  using (status = 'approved' or submitted_by = auth.uid() or public.is_admin());

-- Users may submit their own upload (always lands as pending).
create policy "Users submit library docs"
  on public.library_documents for insert
  with check (submitted_by = auth.uid() and status = 'pending');

-- Only admins moderate / edit / remove.
create policy "Admins update library docs"
  on public.library_documents for update using (public.is_admin());
create policy "Admins delete library docs"
  on public.library_documents for delete using (public.is_admin());

create index if not exists idx_library_documents_status on public.library_documents(status);
create index if not exists idx_library_documents_discipline on public.library_documents(discipline);

-- ── 3. Library chunks (owner-less; mirrors document_chunks + embedding) ─────
create extension if not exists vector;

create table if not exists public.library_document_chunks (
  id uuid primary key default gen_random_uuid(),
  library_document_id uuid not null
    references public.library_documents(id) on delete cascade,
  discipline text,            -- denormalized from the parent for fast filtering
  chunk_index int not null,
  page_start int,
  page_end int,
  content text not null,
  token_estimate int,
  embedding vector(1536),
  created_at timestamptz default now(),
  unique (library_document_id, chunk_index)
);

alter table public.library_document_chunks enable row level security;

-- Readable when the parent doc is approved (or the reader is an admin).
create policy "View approved library chunks"
  on public.library_document_chunks for select
  using (exists (
    select 1 from public.library_documents ld
    where ld.id = library_document_id
      and (ld.status = 'approved' or public.is_admin())
  ));

create index if not exists idx_library_chunks_doc
  on public.library_document_chunks(library_document_id, chunk_index);
create index if not exists idx_library_chunks_discipline
  on public.library_document_chunks(discipline);
create index if not exists idx_library_chunks_embedding_hnsw
  on public.library_document_chunks using hnsw (embedding vector_cosine_ops);

-- ── 4. Hybrid search over the approved library, scoped by discipline ────────
-- Mirrors search_document_chunks_hybrid but with no per-user filter: it returns
-- approved library chunks, optionally narrowed to a discipline (null discipline
-- rows are shared with everyone). query_embedding is a pgvector text literal so
-- it survives the PostgREST boundary; null -> keyword-only ranking.
create or replace function public.search_library_chunks_hybrid(
  query_terms text[],
  query_embedding text default null,
  match_discipline text default null,
  match_count int default 12
)
returns table (
  id uuid,
  library_document_id uuid,
  title text,
  chunk_index int,
  page_start int,
  page_end int,
  content text,
  rank int
)
language sql stable security definer set search_path = public, extensions
as $$
  with params as (
    select
      least(greatest(match_count, 1), 40) as lim,
      case
        when query_embedding is null or length(trim(query_embedding)) = 0 then null
        else query_embedding::vector
      end as emb
  ),
  normalized_terms as (
    select distinct lower(trim(term)) as term
    from unnest(coalesce(query_terms, array[]::text[])) as term
    where length(trim(term)) > 2
  ),
  scoped as (
    select lc.id, lc.library_document_id, ld.title, lc.chunk_index,
           lc.page_start, lc.page_end, lc.content, lc.embedding
    from public.library_document_chunks lc
    join public.library_documents ld on ld.id = lc.library_document_id
    where ld.status = 'approved'
      and (match_discipline is null or lc.discipline is null or lc.discipline = match_discipline)
  ),
  scored as (
    select
      scoped.id, scoped.library_document_id, scoped.title, scoped.chunk_index,
      scoped.page_start, scoped.page_end, scoped.content,
      (
        select coalesce(sum(
          case when lower(scoped.content) like '%' || nt.term || '%' then 3 else 0 end
          + case when lower(coalesce(scoped.title, '')) like '%' || nt.term || '%' then 2 else 0 end
        ), 0)
        from normalized_terms nt
      ) as kw,
      case
        when (select emb from params) is not null and scoped.embedding is not null
          then 1 - (scoped.embedding <=> (select emb from params))
        else null
      end as sim
    from scoped
  ),
  blended as (
    select
      scored.id, scored.library_document_id, scored.title, scored.chunk_index,
      scored.page_start, scored.page_end, scored.content,
      (coalesce(scored.sim, 0) * 0.7 + least(scored.kw, 10) / 10.0 * 0.3) as score
    from scored
  )
  select
    id, library_document_id, title, chunk_index, page_start, page_end, content,
    row_number() over (order by score desc)::int as rank
  from blended
  where score > 0 or (select emb from params) is not null
  order by score desc
  limit (select lim from params);
$$;

grant execute on function public.is_admin() to authenticated, anon;
grant execute on function public.search_library_chunks_hybrid(text[], text, text, int)
  to authenticated, anon;
