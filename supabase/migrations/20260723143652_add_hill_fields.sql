-- King of the Hill: adds the final active team's species list (rebuilt as
-- the AI opponent for whoever reaches the Hill next) and a counter for how
-- many infinite-loop trainers were beaten after dethroning the previous
-- Top1. hill_defenses feeds into trainers_beaten already (see game.js
-- finishEncounter()), it is not a separate scoring term, so
-- score_matches_formula is untouched. trainers_range is widened because a
-- run can now continue indefinitely past Elite Four instead of ending there.
-- Run this once in the Supabase SQL Editor (Dashboard > SQL Editor > New
-- query). schema.sql already has this baked in for fresh installs.

alter table public.scores
  add column if not exists final_team jsonb not null default '[]'::jsonb,
  add column if not exists hill_defenses integer not null default 0;

alter table public.scores
  drop constraint if exists trainers_range;
alter table public.scores
  add constraint trainers_range check (trainers_beaten between 0 and 2000);

alter table public.scores
  drop constraint if exists hill_defenses_range;
alter table public.scores
  add constraint hill_defenses_range check (hill_defenses between 0 and 2000);
