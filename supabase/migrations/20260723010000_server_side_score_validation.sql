-- Locks down direct anon inserts into `scores` and fixes score_matches_formula
-- to account for eliteBeaten, which computeScore() in game.js already includes
-- but this constraint didn't. From here on, only the submit-score Edge
-- Function (via the service_role key, which bypasses RLS) can insert rows.
-- Run this once in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- schema.sql already has this baked in for fresh installs.

alter table public.scores
  drop constraint if exists score_matches_formula;
alter table public.scores
  add constraint score_matches_formula check (
    score = badges * 100
      + coalesce((details->>'eliteBeaten')::int, 0) * 60
      + trainers_beaten * 25
      + caught_count * 15
      + gold_earned
  );

alter table public.scores
  drop constraint if exists elite_beaten_range;
alter table public.scores
  add constraint elite_beaten_range check (
    coalesce((details->>'eliteBeaten')::int, 0) between 0 and 4
  );

drop policy if exists "Public insert access" on public.scores;
