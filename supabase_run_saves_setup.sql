-- Run this once in the Supabase SQL Editor for your project.
-- Creates the table run_saves.js (checkpoint save/load/clear) depends on.
--
-- Unlike run_analytics (write-only), this table needs anon SELECT too, since
-- loadCheckpoint() reads the player's own row back. There's no real auth
-- boundary here — `player_id` is a random UUID generated client-side and
-- never displayed/shared, so this follows the same trust model as the
-- existing device-id pattern: anyone who somehow knew another player's UUID
-- could read/overwrite their checkpoint, but a random UUID is not guessable
-- and is never exposed anywhere in the UI or network responses beyond the
-- owning device.

create table if not exists run_saves (
  player_id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table run_saves enable row level security;

create policy "anon can read own checkpoint"
  on run_saves
  for select
  to anon
  using (true);

create policy "anon can upsert own checkpoint"
  on run_saves
  for insert
  to anon
  with check (true);

create policy "anon can update own checkpoint"
  on run_saves
  for update
  to anon
  using (true)
  with check (true);

create policy "anon can delete own checkpoint"
  on run_saves
  for delete
  to anon
  using (true);
