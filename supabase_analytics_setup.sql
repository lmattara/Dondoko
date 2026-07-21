-- Run this once in the Supabase SQL Editor for your project.
-- Creates a write-only (from the client's perspective) analytics table,
-- separate from the public `scores` leaderboard table.

create table if not exists run_analytics (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  analytics_id text not null,          -- random UUID stored in the player's browser, not tied to their leaderboard name
  outcome text not null check (outcome in ('champion','lost','abandoned')),
  duration_sec integer,
  badges integer,
  caught_count integer,
  gold_earned integer,
  bought_safari boolean default false,
  bought_cruise boolean default false,
  items_bought jsonb,                  -- { invKey: count } — what was purchased
  items_used jsonb                     -- { invKey: count } — what was actually used
);

alter table run_analytics enable row level security;

-- Anonymous clients (the game, running in any player's browser) can INSERT
-- their own run's analytics row...
create policy "anon can insert analytics"
  on run_analytics
  for insert
  to anon
  with check (true);

-- ...but deliberately CANNOT select/read back any analytics data. Unlike
-- `scores` (which needs public SELECT for the leaderboard to render), nobody
-- should be able to query player behavior data from the browser — only you,
-- via the Supabase dashboard/SQL editor using your own credentials, which
-- bypass RLS entirely.
