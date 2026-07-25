-- Backing table for submit-score's rate limiting. Kept separate from
-- `scores` (rather than adding an ip_hash column there) so this data is
-- never exposed through the public "Public read access" select policy on
-- scores -- nobody needs to read this table except the Edge Function
-- itself, which uses the service_role key and bypasses RLS entirely.
create table if not exists public.score_submission_log (
  id         bigint generated always as identity primary key,
  ip_hash    text not null,
  created_at timestamptz not null default now()
);

-- Fast "how many submissions from this IP in the last N minutes" lookups.
create index if not exists score_submission_log_ip_created_idx
  on public.score_submission_log (ip_hash, created_at desc);

alter table public.score_submission_log enable row level security;
-- No policies created for `anon` on purpose: with RLS enabled and no
-- matching policy, anon gets permission-denied on every operation. Only the
-- submit-score Edge Function (service_role key, bypasses RLS) touches this
-- table.
