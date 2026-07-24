-- Write-only (from the client's perspective) bug report inbox, same shape
-- as run_analytics: anon can insert their own report, nobody (not even the
-- anon key) can read it back — only you, via the Supabase dashboard/SQL
-- editor using your own credentials, which bypass RLS entirely.
-- Run this once in the Supabase SQL Editor (Dashboard > SQL Editor > New query).

create table if not exists public.bug_reports (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  message       text not null check (char_length(message) between 1 and 2000),
  -- Same anonymous per-browser id run_analytics uses (see getAnalyticsId() in
  -- game.js) — not tied to the player's leaderboard name, just lets repeated
  -- reports from the same device be grouped.
  analytics_id  text,
  game_mode     text,
  -- Which screen the report button was pressed from (encounter, battle,
  -- pokestop, etc.) — cheap context for reproducing the bug.
  screen        text,
  run_badges    integer,
  user_agent    text
);

alter table public.bug_reports enable row level security;

create policy "anon can insert bug reports"
  on public.bug_reports
  for insert
  to anon
  with check (true);
