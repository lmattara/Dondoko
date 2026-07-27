-- Rate limiting for account-related Edge Functions (update-name,
-- update-avatar, ensure-profile, delete-account) and for friend requests.
--
-- `account_action_log` mirrors score_submission_log's pattern: a plain
-- append-only log, RLS enabled with zero policies so only the service_role
-- key (used by the Edge Functions) can ever read/write it. Rate limiting
-- for the Edge Functions themselves lives in supabase/functions/_shared/
-- rateLimit.ts, which reads/writes this table.
--
-- Friend requests go straight from the client through RLS (no Edge
-- Function involved), so their limit is enforced as a DB trigger instead —
-- raises an exception the client sees as a normal insert error.
-- Run this once in the Supabase SQL Editor. schema.sql already has this
-- baked in for fresh installs.

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

drop trigger if exists friends_rate_limit_trigger on public.friends;
create trigger friends_rate_limit_trigger
  before insert on public.friends
  for each row execute function public.enforce_friend_request_rate_limit();
