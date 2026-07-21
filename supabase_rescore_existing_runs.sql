-- One-off migration: recompute `score` on every existing row in `scores`
-- using the updated formula that now counts Elite Four wins (60 points per
-- member beaten), matching computeScore() in game.js as of commit 79a3489.
--
-- Safe to run more than once — it's a pure recompute from the columns/JSON
-- already stored, not an increment. Run this in the Supabase SQL Editor.

update scores
set score =
  badges * 100
  + coalesce((details->>'eliteBeaten')::int, 0) * 60
  + trainers_beaten * 25
  + caught_count * 15
  + gold_earned;

-- Optional sanity check afterward — top 10 by the recomputed score:
-- select name, score, badges, trainers_beaten, caught_count, gold_earned,
--        details->>'eliteBeaten' as elite_beaten
-- from scores
-- order by score desc
-- limit 10;
