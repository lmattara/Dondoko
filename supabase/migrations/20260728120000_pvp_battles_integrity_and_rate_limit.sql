-- Fixes two gaps found in a security review of pvp_battles (added in
-- 20260727270000_pvp_teams_and_battles.sql):
--
-- 1. winner_id was never checked to actually be one of the two
--    participants — an authenticated user could insert a row naming any
--    arbitrary uuid (even a third party who wasn't in the battle) as the
--    winner, corrupting both players' win/loss history.
-- 2. Nothing required the two players to be accepted friends, and there was
--    no rate limit on this table at all — unlike `friends`, which has both a
--    request-acceptance gate and its own rate-limit trigger. A user could
--    spam-insert battles naming a stranger as opponent_id, inflating rival
--    counts and injecting unwanted rows into that stranger's own battle
--    history (readable by them via "Read own pvp battles").

alter table public.pvp_battles
  add constraint winner_is_participant
  check (winner_id is null or winner_id in (challenger_id, opponent_id));

create or replace function public.enforce_pvp_battle_requires_friendship()
returns trigger as $$
begin
  if not exists (
    select 1 from public.friends
    where status = 'accepted'
      and ((requester_id = new.challenger_id and addressee_id = new.opponent_id)
        or (requester_id = new.opponent_id and addressee_id = new.challenger_id))
  ) then
    raise exception 'You can only log PvP battles against an accepted friend.' using errcode = 'P0001';
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger pvp_battles_requires_friendship
  before insert on public.pvp_battles
  for each row execute function public.enforce_pvp_battle_requires_friendship();

-- Same rate-limit shape as enforce_friend_request_rate_limit (schema.sql) —
-- PvP battles are casual and expected to happen more often than friend
-- requests, so the cap is looser.
create or replace function public.enforce_pvp_battle_rate_limit()
returns trigger as $$
declare
  recent_count integer;
begin
  select count(*) into recent_count
  from public.pvp_battles
  where challenger_id = new.challenger_id
    and created_at > now() - interval '1 hour';
  if recent_count >= 30 then
    raise exception 'Too many PvP battles logged, please slow down.' using errcode = 'P0001';
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger pvp_battles_rate_limit_trigger
  before insert on public.pvp_battles
  for each row execute function public.enforce_pvp_battle_rate_limit();
