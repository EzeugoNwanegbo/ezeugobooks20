-- Global leaderboard: persist each user's points on their profile so everyone
-- can be ranked against each other. Points are also kept in the browser for
-- instant UI; this is the shared source of truth for ranking.
alter table public.user_profiles
  add column if not exists points integer not null default 0,
  add column if not exists weekly_points integer not null default 0,
  add column if not exists current_streak integer not null default 0,
  add column if not exists gamification_updated_at timestamptz;

create index if not exists user_profiles_points_idx
  on public.user_profiles (points desc);

-- Top players. SECURITY DEFINER so it can read across users (row-level security
-- otherwise limits each user to their own row); it exposes only display fields.
create or replace function public.leaderboard_top(limit_count integer default 50)
returns table (
  user_id uuid,
  name text,
  points integer,
  current_streak integer,
  rank bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id as user_id,
    coalesce(nullif(btrim(p.name), ''), 'Student') as name,
    p.points,
    p.current_streak,
    rank() over (
      order by p.points desc, p.gamification_updated_at asc nulls last
    ) as rank
  from public.user_profiles p
  where p.points > 0
  order by p.points desc, p.gamification_updated_at asc nulls last
  limit greatest(1, least(coalesce(limit_count, 50), 200));
$$;

-- The signed-in user's own global rank + how many players are ranked.
create or replace function public.leaderboard_rank()
returns table (rank bigint, total bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      select count(*) + 1
      from public.user_profiles p
      where p.points > coalesce(
        (select points from public.user_profiles where id = auth.uid()), 0
      )
    )::bigint as rank,
    (select count(*) from public.user_profiles where points > 0)::bigint as total;
$$;

grant execute on function public.leaderboard_top(integer) to anon, authenticated;
grant execute on function public.leaderboard_rank() to anon, authenticated;
