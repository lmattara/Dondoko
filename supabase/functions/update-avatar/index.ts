// Sets the calling player's profile avatar — one of the 18 Gym Badge keys,
// or 'masterball', each gated by actual progress on THIS account (checked
// below against their own `scores` rows), not just a static whitelist:
//   - a Gym Badge key requires having beaten that Gym at least once
//   - 'masterball' requires having beaten the Elite Four (all 4 members)
//     at least once
// No cooldown, unlike update-name — picking an already-unlocked avatar
// isn't an impersonation/spam concern. Still goes through a Function using
// the service role for the actual write, because `profiles` has no
// client-writable RLS policy at all (see the profiles table migrations).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

// Mirrors the BADGES array's `key` values in game.js — kept as a literal
// list here rather than importing game.js (a browser-only classic script,
// not a module) so a bad/unknown key can never be written to the DB.
const VALID_BADGE_KEYS = [
  'normal', 'fire', 'water', 'electric', 'grass-poison', 'fairy',
  'ice-flying', 'ghost-psychic', 'steel-dark', 'dragon', 'flying',
  'ghost-grass', 'bug-poison', 'rock-water', 'bug-fighting', 'plain',
  'poison-dark', 'water-ice',
];
const MASTERBALL_KEY = 'masterball';
const VALID_AVATAR_KEYS = [...VALID_BADGE_KEYS, MASTERBALL_KEY];
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MINUTES = 10;

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return respond(401, { error: 'Not signed in' });
  }

  const callerClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) {
    return respond(401, { error: 'Not signed in' });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }
  const avatarKey = typeof body?.avatarKey === 'string' ? body.avatarKey : '';
  if (!VALID_AVATAR_KEYS.includes(avatarKey)) {
    return respond(400, { error: 'Invalid avatar' });
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const rateLimit = await checkRateLimit(adminClient, user.id, 'update-avatar', RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MINUTES);
  if (!rateLimit.ok) {
    return respond(429, { error: 'Too many attempts, please slow down.' });
  }

  // Progress check — reads this account's own runs (RLS's "Public read
  // access" policy already lets `authenticated` read the whole leaderboard,
  // own rows included) rather than trusting the client's say-so about what
  // it's unlocked.
  const { data: ownRuns, error: runsError } = await callerClient
    .from('scores')
    .select('details')
    .eq('user_id', user.id);
  if (runsError) {
    return respond(500, { error: runsError.message });
  }
  const earnedBadges = new Set<string>();
  let beatElite = false;
  (ownRuns ?? []).forEach((row) => {
    const details = row.details as Record<string, unknown> | null;
    if (!details) return;
    const badges = Array.isArray(details.beatenBadges) ? details.beatenBadges : [];
    badges.forEach((b) => typeof b === 'string' && earnedBadges.add(b));
    const eliteBeaten = Number(details.eliteBeaten ?? 0);
    if (details.champion || eliteBeaten >= 4) beatElite = true;
  });

  const unlocked = avatarKey === MASTERBALL_KEY ? beatElite : earnedBadges.has(avatarKey);
  if (!unlocked) {
    return respond(403, { error: "You haven't unlocked that avatar yet." });
  }

  const { error: upsertError } = await adminClient
    .from('profiles')
    .upsert({ user_id: user.id, avatar_key: avatarKey }, { onConflict: 'user_id' });
  if (upsertError) {
    return respond(500, { error: upsertError.message });
  }

  return respond(200, { ok: true, avatarKey });
});
