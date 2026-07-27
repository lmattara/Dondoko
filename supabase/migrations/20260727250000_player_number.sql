-- A stable numeric id per account, separate from the (changeable, and now
-- unique) game_name — so a friend can be added by ID even after they've
-- since renamed themselves. Auto-assigned (identity column), never reused.
-- Run this once in the Supabase SQL Editor. schema.sql already has this
-- baked in for fresh installs.

alter table public.profiles add column if not exists player_number bigint generated always as identity;
alter table public.profiles add constraint profiles_player_number_unique unique (player_number);
