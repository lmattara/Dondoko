-- Adds account support (Google/Discord sign-in via Supabase Auth). Two changes:
--
-- 1. The "Public read access" policy only granted SELECT to the `anon` role.
--    Once a player signs in, the client sends their user JWT instead of the
--    anon key, so every query (including the homepage leaderboard and the
--    submit-score Edge Function's "is this a new high score" check) runs as
--    `authenticated` instead — which had no matching policy, so RLS silently
--    returned zero rows. This is what made the homepage ranking look "account-
--    scoped"/empty once logged in, instead of showing the same global ranking
--    guests see.
-- 2. `user_id` lets a signed-in player's runs be queried for a personal
--    profile page, without affecting anonymous/guest submissions (nullable —
--    a guest run just leaves it null, same as before this migration existed).
-- Run this once in the Supabase SQL Editor. schema.sql already has this baked
-- in for fresh installs.

drop policy if exists "Public read access" on public.scores;
create policy "Public read access"
  on public.scores
  for select
  to anon, authenticated
  using (true);

alter table public.scores add column if not exists user_id uuid references auth.users(id);
create index if not exists scores_user_id_idx on public.scores(user_id);
