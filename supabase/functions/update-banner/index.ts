// Sets the calling player's profile banner — 3 solid-color keys or 2 fixed
// image keys (see BANNER_OPTIONS in profile.html), or '' to clear it back to
// no banner. Most options are cosmetic-only with no gate; 'art2' requires
// having beaten the game as Champion at least once, re-checked here the
// same way update-avatar re-checks its Master Ball unlock — the client-side
// lock in profile.html is only ever a UX nicety, this is the real gate.
// Still goes through a Function using the service role, because `profiles`
// has no client-writable RLS policy at all (see the profiles table
// migrations).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

// Mirrors BANNER_OPTIONS' `key` values in profile.html — kept as a literal
// list here, same reasoning as update-avatar's VALID_AVATAR_KEYS, so a
// bad/unknown key can never be written to the DB.
const VALID_BANNER_KEYS = ['grass', 'water', 'fire', 'art1', 'art2'];
// Mirrors BANNER_IMAGE_OPTIONS' requiresChampion flag in profile.html.
const CHAMPION_GATED_KEYS = ['art2'];
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
  // '' (or omitted) means "clear the banner" — stored as null, not the
  // empty string, so accountBannerHTML()'s lookup just finds nothing.
  const bannerKey = typeof body?.bannerKey === 'string' ? body.bannerKey : '';
  if (bannerKey !== '' && !VALID_BANNER_KEYS.includes(bannerKey)) {
    return respond(400, { error: 'Invalid banner' });
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const rateLimit = await checkRateLimit(adminClient, user.id, 'update-banner', RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MINUTES);
  if (!rateLimit.ok) {
    return respond(429, { error: 'Too many attempts, please slow down.' });
  }

  if (CHAMPION_GATED_KEYS.includes(bannerKey)) {
    // Reads this account's own runs (RLS's "Public read access" policy
    // already lets `authenticated` read the whole leaderboard, own rows
    // included) rather than trusting the client's say-so about what it's
    // unlocked.
    const { data: ownRuns, error: runsError } = await callerClient
      .from('scores')
      .select('details')
      .eq('user_id', user.id);
    if (runsError) {
      return respond(500, { error: runsError.message });
    }
    const beatChampion = (ownRuns ?? []).some((row) => {
      const details = row.details as Record<string, unknown> | null;
      if (!details) return false;
      const eliteBeaten = Number(details.eliteBeaten ?? 0);
      return !!details.champion || eliteBeaten >= 4;
    });
    if (!beatChampion) {
      return respond(403, { error: "You haven't unlocked that banner yet." });
    }
  }

  const { error: upsertError } = await adminClient
    .from('profiles')
    .upsert({ user_id: user.id, banner_key: bannerKey || null }, { onConflict: 'user_id' });
  if (upsertError) {
    return respond(500, { error: upsertError.message });
  }

  return respond(200, { ok: true, bannerKey: bannerKey || null });
});
