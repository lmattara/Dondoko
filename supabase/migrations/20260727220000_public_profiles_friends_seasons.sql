-- Bundles the DB side of several account-powered features at once:
--
-- 1. Public profile pages (profile.html?id=<uuid>) and friend search both
--    need to read *someone else's* name/avatar, not just your own — relaxes
--    the profiles SELECT policy from "own row only" to public. Nothing
--    sensitive lives in this table (no email, no auth data), so this is safe.
-- 2. `friends` — pending/accepted friend requests between two accounts.
--    Selecting is restricted to the two parties involved; only the
--    requester can create a row, only the addressee can flip it to
--    'accepted'; either side can delete it (unfriend / cancel / decline).
-- 3. `seasons` + `scores.season_id` — one row per leaderboard season,
--    `ended_at` null means "current". Seeds "Season 1" starting now and
--    backfills every existing score into it, so nothing already on the
--    leaderboard silently vanishes from a season-filtered view. Starting a
--    new season later is a manual SQL action (set ended_at on the old row,
--    insert a new one) — no UI for that yet, this migration only lays the
--    groundwork.
-- Run this once in the Supabase SQL Editor. schema.sql already has this
-- baked in for fresh installs.

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Public read access"
  on public.profiles for select
  to anon, authenticated
  using (true);

create table if not exists public.friends (
  id            bigint generated always as identity primary key,
  requester_id  uuid not null references auth.users(id) on delete cascade,
  addressee_id  uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','accepted')),
  created_at    timestamptz not null default now(),
  constraint no_self_friend check (requester_id <> addressee_id),
  constraint unique_pair unique (requester_id, addressee_id)
);

alter table public.friends enable row level security;
create index if not exists friends_requester_idx on public.friends (requester_id);
create index if not exists friends_addressee_idx on public.friends (addressee_id);

create policy "Read own friend rows"
  on public.friends for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "Send friend requests"
  on public.friends for insert
  to authenticated
  with check (auth.uid() = requester_id);

create policy "Respond to friend requests"
  on public.friends for update
  to authenticated
  using (auth.uid() = addressee_id)
  with check (auth.uid() = addressee_id);

create policy "Remove own friend rows"
  on public.friends for delete
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create table if not exists public.seasons (
  id          bigint generated always as identity primary key,
  label       text not null,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz -- null = the current season
);

alter table public.seasons enable row level security;
create policy "Public read access"
  on public.seasons for select
  to anon, authenticated
  using (true);

insert into public.seasons (label, started_at, ended_at)
select 'Season 1', now(), null
where not exists (select 1 from public.seasons);

alter table public.scores add column if not exists season_id bigint references public.seasons(id);
create index if not exists scores_season_idx on public.scores (season_id, mode, score desc);

update public.scores set season_id = (select id from public.seasons order by id limit 1)
where season_id is null;
