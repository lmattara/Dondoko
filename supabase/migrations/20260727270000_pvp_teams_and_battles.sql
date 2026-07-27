-- Async, offline PvP: a player saves a "PvP team" (species from one of
-- their own past runs), and can Challenge an accepted friend — the battle
-- runs immediately client-side using the normal battle engine (beginBattle,
-- see game.js), with the friend's saved team rebuilt as an AI-controlled
-- opponent squad, same technique as King of the Hill's Top1 reconstruction.
-- The friend never needs to be online.
--
-- pvp_teams: unlike profiles/scores, this is safe to let the client write
-- directly (own row only) — there's no cooldown/uniqueness/anti-cheat
-- concern here, the team is just a list of species names the player already
-- owns in real run history, picked client-side.
create table if not exists public.pvp_teams (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  team        jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.pvp_teams enable row level security;

create policy "Public read access"
  on public.pvp_teams for select
  to anon, authenticated
  using (true);

create policy "Users manage own pvp team"
  on public.pvp_teams for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users update own pvp team"
  on public.pvp_teams for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- One row per PvP battle fought. `winner_id` is set from the client-side
-- battle outcome (there's no server-side simulation to double-check
-- against — same trust model as everything else client-computed in this
-- game, PvP has no rewards/stakes beyond bragging rights and history).
-- 10+ total rows between the same pair (either direction) flips their
-- "Friend" tag to "Rival" (see profile.html/game.js).
create table if not exists public.pvp_battles (
  id             bigint generated always as identity primary key,
  challenger_id  uuid not null references auth.users(id) on delete cascade,
  opponent_id    uuid not null references auth.users(id) on delete cascade,
  winner_id      uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint no_self_challenge check (challenger_id <> opponent_id)
);

alter table public.pvp_battles enable row level security;
create index if not exists pvp_battles_challenger_idx on public.pvp_battles (challenger_id);
create index if not exists pvp_battles_opponent_idx on public.pvp_battles (opponent_id);

create policy "Read own pvp battles"
  on public.pvp_battles for select
  to authenticated
  using (auth.uid() = challenger_id or auth.uid() = opponent_id);

create policy "Log own pvp challenges"
  on public.pvp_battles for insert
  to authenticated
  with check (auth.uid() = challenger_id);
