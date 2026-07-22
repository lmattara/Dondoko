-- Adds the Classic/Pro game-mode column to an EXISTING `scores` table.
-- Run this once in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- schema.sql already has `mode` baked into the `create table` for fresh installs —
-- this migration is only needed to bring an already-created table up to date.

alter table public.scores
  add column if not exists mode text not null default 'classic';

alter table public.scores
  drop constraint if exists mode_valid;
alter table public.scores
  add constraint mode_valid check (mode in ('classic','pro'));

create index if not exists scores_mode_score_desc_idx on public.scores (mode, score desc);
