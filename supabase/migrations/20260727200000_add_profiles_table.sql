-- Backs the Profile page's editable in-game name (profile.html) and its
-- 7-day change cooldown (see supabase/functions/update-name). Deliberately
-- NOT stored in auth.users.user_metadata: any signed-in client can call
-- supabase.auth.updateUser() directly and rewrite their own metadata,
-- bypassing any cooldown check a client-side call could ever enforce. This
-- table has no insert/update/delete policy for anon or authenticated at
-- all, so the only way to write a row is through update-name (service role,
-- bypasses RLS) — same pattern as `scores` and its submit-score Function.
-- Run this once in the Supabase SQL Editor. schema.sql already has this
-- baked in for fresh installs.

create table if not exists public.profiles (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  game_name             text,
  game_name_changed_at  timestamptz,
  created_at            timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A player can read their own name/cooldown, never anyone else's — this
-- table isn't part of the public leaderboard, just per-account profile state.
create policy "Users can read own profile"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = user_id);
