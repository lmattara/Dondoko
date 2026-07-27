-- Two players can no longer share the same in-game name (case-insensitive —
-- "Ash" and "ash" collide). Enforced at the DB level as the real backstop;
-- update-name also checks this itself first so it can return a friendly
-- "That name is already taken" message instead of a raw constraint error.
-- Partial index (where game_name is not null) so accounts that haven't set
-- a name yet don't all collide against each other on NULL.
-- Run this once in the Supabase SQL Editor. schema.sql already has this
-- baked in for fresh installs.

create unique index if not exists profiles_game_name_lower_unique_idx
  on public.profiles (lower(game_name))
  where game_name is not null;
