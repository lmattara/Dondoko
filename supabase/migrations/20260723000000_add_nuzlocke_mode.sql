-- Adds Nuzlocke as a valid game mode to an EXISTING `scores` table.
-- Run this once in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- schema.sql already has 'nuzlocke' baked into the mode_valid check for fresh
-- installs, this migration is only needed to bring an already-created table
-- (one that already ran 2026-07-22_add_mode.sql) up to date.

alter table public.scores
  drop constraint if exists mode_valid;
alter table public.scores
  add constraint mode_valid check (mode in ('classic','pro','nuzlocke'));
