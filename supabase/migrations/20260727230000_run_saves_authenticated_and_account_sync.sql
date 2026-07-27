-- run_saves' policies only covered the `anon` role. Once a player is signed
-- in, run_saves.js now uses their account id (not just the device's random
-- UUID) as player_id, so checkpoints follow them across devices — but that
-- request runs as `authenticated`, and with no policy for that role RLS
-- silently returned/wrote nothing, same bug pattern as `scores`' "Public
-- read access" policy before it covered `authenticated` too (see the
-- 20260727180000 migration).
-- Run this once in the Supabase SQL Editor. supabase_run_saves_setup.sql
-- already has this baked in for fresh installs.

drop policy if exists "anon can read own checkpoint" on run_saves;
create policy "anon can read own checkpoint"
  on run_saves for select
  to anon, authenticated
  using (true);

drop policy if exists "anon can upsert own checkpoint" on run_saves;
create policy "anon can upsert own checkpoint"
  on run_saves for insert
  to anon, authenticated
  with check (true);

drop policy if exists "anon can update own checkpoint" on run_saves;
create policy "anon can update own checkpoint"
  on run_saves for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "anon can delete own checkpoint" on run_saves;
create policy "anon can delete own checkpoint"
  on run_saves for delete
  to anon, authenticated
  using (true);
