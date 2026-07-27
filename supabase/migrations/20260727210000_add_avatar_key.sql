-- Lets a player pick one of the 18 Gym Badge icons as their profile avatar
-- (see profile.html's avatar picker + supabase/functions/update-avatar).
-- No cooldown like game_name has — picking a badge you've already earned
-- isn't an impersonation/spam concern, so it doesn't need one. Still routed
-- through a dedicated Edge Function rather than a direct client update,
-- same reasoning as game_name: `profiles` has no client-writable RLS policy
-- at all, so a Function using the service role is the only way to write here.
-- Run this once in the Supabase SQL Editor. schema.sql already has this
-- baked in for fresh installs.

alter table public.profiles add column if not exists avatar_key text;
