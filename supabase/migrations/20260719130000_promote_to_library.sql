-- Library ingestion by promotion.
--
-- A student's uploaded book is already chunked + embedded in document_chunks.
-- When an admin approves it for the shared library we simply copy those chunks
-- into library_document_chunks - no re-extraction or re-embedding. The copy
-- crosses an RLS boundary (the admin is not the chunk owner), so it runs as a
-- SECURITY DEFINER function that first verifies the caller is an admin.
create or replace function public.promote_document_to_library(
  p_library_id uuid,
  p_source_document_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_discipline text;
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  select discipline into v_discipline
  from public.library_documents
  where id = p_library_id;

  -- Idempotent: clear any prior copy before re-inserting.
  delete from public.library_document_chunks
  where library_document_id = p_library_id;

  insert into public.library_document_chunks
    (library_document_id, discipline, chunk_index, page_start, page_end,
     content, token_estimate, embedding)
  select
    p_library_id, v_discipline, dc.chunk_index, dc.page_start, dc.page_end,
    dc.content, dc.token_estimate, dc.embedding
  from public.document_chunks dc
  where dc.document_id = p_source_document_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.promote_document_to_library(uuid, uuid) to authenticated;

-- Reward a student whose submitted book is approved into the shared library.
-- Admin-only, SECURITY DEFINER so it can credit another user's profile (the
-- normal RLS only lets a user update their own row).
create or replace function public.award_library_points(
  p_user_id uuid,
  p_points int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  update public.user_profiles
  set points = coalesce(points, 0) + p_points,
      weekly_points = coalesce(weekly_points, 0) + p_points
  where id = p_user_id;
end;
$$;

grant execute on function public.award_library_points(uuid, int) to authenticated;
