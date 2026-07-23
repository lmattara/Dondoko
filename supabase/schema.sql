-- Dondokomon global leaderboard schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).

create table if not exists public.scores (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  name           text not null,
  score          integer not null,
  badges         integer not null,
  trainers_beaten integer not null,
  caught_count   integer not null,
  gold_earned    integer not null,
  -- 'classic' (the game as it always was), 'pro' (wild-encounter/starter
  -- cards hidden until clicked), or 'nuzlocke' (same blind picks as Pro,
  -- plus permadeath). Chosen on the home screen before Start, keeps the 3
  -- leaderboards from ever mixing.
  mode           text not null default 'classic',
  -- Full run snapshot (starter, caught team, active roster, badges beaten,
  -- elite/legendary progress) so the "view run detail" screen keeps working
  -- exactly like it did when this data lived only in localStorage.
  details        jsonb not null default '{}'::jsonb,
  -- Final active team's species list (up to 6 names), rebuilt as the AI
  -- opponent for whoever reaches the King of the Hill encounter next.
  final_team     jsonb not null default '[]'::jsonb,
  -- How many infinite-loop trainers were beaten after dethroning the
  -- previous Top1. Folds into trainers_beaten/score already (see game.js
  -- finishEncounter()), tracked separately here for its own ranking column.
  hill_defenses  integer not null default 0,

  -- ---- plausibility guards (rough anti-cheat, not exact game balance) ----
  constraint name_len          check (char_length(name) between 1 and 20),
  constraint badges_range      check (badges between 0 and 10),
  -- Raised from 200: a run no longer has to end at Elite Four, the infinite
  -- loop past King of the Hill has no upper limit on trainers beaten.
  constraint trainers_range    check (trainers_beaten between 0 and 2000),
  constraint hill_defenses_range check (hill_defenses between 0 and 2000),
  constraint caught_range      check (caught_count between 0 and 1351),
  constraint gold_range        check (gold_earned between 0 and 10000000),
  constraint mode_valid        check (mode in ('classic','pro','nuzlocke')),
  -- eliteBeaten (0-4 Elite Four members) lives in `details`, not its own
  -- column, since it's part of the run snapshot rather than a leaderboard sort key.
  constraint elite_beaten_range check (
    coalesce((details->>'eliteBeaten')::int, 0) between 0 and 4
  ),
  -- Recomputes the score server-side from the same formula game.js uses
  -- (computeScore): badges*100 + eliteBeaten*60 + trainersBeaten*25 + caught*15 + gold.
  -- Rejects any row where the submitted score doesn't match its own inputs.
  -- Belt-and-suspenders alongside the submit-score Edge Function, which is
  -- the only thing allowed to insert here in the first place (see below).
  constraint score_matches_formula check (
    score = badges * 100
      + coalesce((details->>'eliteBeaten')::int, 0) * 60
      + trainers_beaten * 25
      + caught_count * 15
      + gold_earned
  )
);

-- Fast "top N by score" queries.
create index if not exists scores_score_desc_idx on public.scores (score desc);
-- Fast "top N by score, within one mode" queries (the Classic/Pro/Nuzlocke ranking tabs).
create index if not exists scores_mode_score_desc_idx on public.scores (mode, score desc);

alter table public.scores enable row level security;

-- Anyone (anon key) can read the leaderboard.
create policy "Public read access"
  on public.scores
  for select
  to anon
  using (true);

-- No insert policy for `anon` on purpose: score submission goes through the
-- submit-score Edge Function (supabase/functions/submit-score), which uses
-- the service_role key and bypasses RLS entirely. This is what stops a
-- player from crafting a direct REST insert with a fabricated score.
--
-- No update/delete policies are created for `anon` either: with RLS enabled
-- and no matching policy, those operations are simply denied for the public
-- anon key. As the project owner you can still edit/delete rows from the
-- Supabase Table Editor / SQL Editor (which uses your own authenticated
-- dashboard session, not the anon key) or via the service_role key, both of
-- which bypass RLS entirely.
