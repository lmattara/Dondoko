-- Rinne global leaderboard schema
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
  -- Signed-in player this run belongs to (Google/Discord via Supabase Auth),
  -- null for guest runs. Lets a profile page query "my runs" without
  -- affecting the global leaderboard, which stays open to guests and
  -- accounts alike (see the "Public read access" policy below). ON DELETE
  -- SET NULL so deleting an account (supabase/functions/delete-account)
  -- unlinks their runs instead of failing or wiping them from the
  -- leaderboard everyone else still sees.
  user_id        uuid references auth.users(id) on delete set null,
  -- Wall-clock length of the run in seconds, set by submit-score from the
  -- client's runStartedAt. Powers the profile page's "hours played" stat;
  -- null on anything recorded before this column existed.
  duration_sec   integer,

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
-- Fast "my runs" queries for the profile page.
create index if not exists scores_user_id_idx on public.scores (user_id);

alter table public.scores enable row level security;

-- Anyone can read the leaderboard, guest or signed-in — `authenticated` has
-- to be listed explicitly alongside `anon`, or a signed-in player's own
-- queries (which run as `authenticated`, not `anon`) get silently filtered
-- to zero rows by RLS instead of falling back to the anon policy.
create policy "Public read access"
  on public.scores
  for select
  to anon, authenticated
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

-- Editable in-game display name shown on the Profile page and homepage
-- auth widget, with a 7-day change cooldown (see supabase/functions/
-- update-name). Deliberately its own table instead of auth.users.
-- user_metadata: any signed-in client can call supabase.auth.updateUser()
-- directly and rewrite their own metadata, which would bypass any cooldown
-- a client-side check could ever enforce. No insert/update/delete policy
-- exists here for anon or authenticated — only update-name (service role)
-- can write, same pattern as `scores`/submit-score above.
create table if not exists public.profiles (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  game_name             text,
  game_name_changed_at  timestamptz,
  -- One of the 18 Gym Badge keys (see game.js's BADGES), used as the
  -- player's profile picture. No cooldown — see update-avatar.
  avatar_key            text,
  -- Stable numeric id, auto-assigned and never reused — lets a friend be
  -- added by id even after the account has since changed its game_name.
  player_number         bigint generated always as identity,
  created_at            timestamptz not null default now(),
  constraint profiles_player_number_unique unique (player_number)
);

-- Two players can't share the same name (case-insensitive), and this is the
-- real enforcement — update-name checks it too, but only to return a
-- friendly message instead of surfacing this constraint error directly.
create unique index if not exists profiles_game_name_lower_unique_idx
  on public.profiles (lower(game_name))
  where game_name is not null;

alter table public.profiles enable row level security;

-- Public, not just the owner — needed for shareable profile pages
-- (profile.html?id=<uuid>) and for finding someone by name to send a
-- friend request. Nothing sensitive lives here (no email, no auth data).
create policy "Public read access"
  on public.profiles
  for select
  to anon, authenticated
  using (true);

-- Pending/accepted friend requests between two accounts. Selecting is
-- restricted to the two parties involved; only the requester can create a
-- row, only the addressee can flip it to 'accepted'; either side can delete
-- it (unfriend / cancel / decline).
create table if not exists public.friends (
  id            bigint generated always as identity primary key,
  requester_id  uuid not null references auth.users(id) on delete cascade,
  addressee_id  uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','accepted')),
  created_at    timestamptz not null default now(),
  constraint no_self_friend check (requester_id <> addressee_id),
  constraint unique_pair unique (requester_id, addressee_id)
);

alter table public.friends enable row level security;
create index if not exists friends_requester_idx on public.friends (requester_id);
create index if not exists friends_addressee_idx on public.friends (addressee_id);

create policy "Read own friend rows"
  on public.friends for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "Send friend requests"
  on public.friends for insert
  to authenticated
  with check (auth.uid() = requester_id);

create policy "Respond to friend requests"
  on public.friends for update
  to authenticated
  using (auth.uid() = addressee_id)
  with check (auth.uid() = addressee_id);

create policy "Remove own friend rows"
  on public.friends for delete
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- One row per leaderboard season; ended_at null means "the current season".
-- Starting a new one is a manual SQL action (set ended_at on the old row,
-- insert a new one) — there's no admin UI for that yet.
create table if not exists public.seasons (
  id          bigint generated always as identity primary key,
  label       text not null,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);

alter table public.seasons enable row level security;
create policy "Public read access"
  on public.seasons for select
  to anon, authenticated
  using (true);

insert into public.seasons (label, started_at, ended_at)
select 'Season 1', now(), null
where not exists (select 1 from public.seasons);

-- Which season a run counts toward — set automatically by submit-score
-- from whichever season currently has ended_at is null.
alter table public.scores add column if not exists season_id bigint references public.seasons(id);
create index if not exists scores_season_idx on public.scores (season_id, mode, score desc);

-- Rate limiting. `account_action_log` backs update-name/update-avatar/
-- ensure-profile/delete-account (see supabase/functions/_shared/
-- rateLimit.ts) — RLS enabled with zero policies, so only the service_role
-- key those Functions use can read/write it. Friend requests skip an Edge
-- Function entirely (the client inserts into `friends` directly through
-- RLS), so their limit is a DB trigger instead.
create table if not exists public.account_action_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  action     text not null,
  created_at timestamptz not null default now()
);

create index if not exists account_action_log_user_action_idx
  on public.account_action_log (user_id, action, created_at desc);

alter table public.account_action_log enable row level security;

create or replace function public.enforce_friend_request_rate_limit()
returns trigger as $$
declare
  recent_count integer;
begin
  select count(*) into recent_count
  from public.friends
  where requester_id = new.requester_id
    and created_at > now() - interval '1 hour';
  if recent_count >= 10 then
    raise exception 'Too many friend requests, please slow down.' using errcode = 'P0001';
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger friends_rate_limit_trigger
  before insert on public.friends
  for each row execute function public.enforce_friend_request_rate_limit();
