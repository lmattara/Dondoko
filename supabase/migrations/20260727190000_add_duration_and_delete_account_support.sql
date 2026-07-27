-- Two changes needed for the profile "delete account" flow and lifetime
-- playtime stat:
--
-- 1. `scores.user_id` had a default (NO ACTION) FK to auth.users. Deleting
--    an account (see supabase/functions/delete-account) would then fail
--    outright the moment that user had any leaderboard rows. Switched to
--    ON DELETE SET NULL so their runs stay on the global leaderboard
--    (matches how a run submitted as a guest already looks) instead of
--    either blocking the deletion or cascading into deleting run history
--    that other players' rankings/context may still reference.
-- 2. `duration_sec` per run, populated by submit-score from here on, powers
--    the "hours played" lifetime stat on the profile page. Historical runs
--    (before this column existed) are left null and just don't count
--    toward that total, same caveat as `user_id` on older rows.
-- Run this once in the Supabase SQL Editor. schema.sql already has this
-- baked in for fresh installs.

alter table public.scores drop constraint if exists scores_user_id_fkey;
alter table public.scores
  add constraint scores_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;

alter table public.scores add column if not exists duration_sec integer;
