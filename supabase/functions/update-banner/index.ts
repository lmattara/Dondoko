// Sets the calling player's profile banner — 3 solid-color keys or 2 fixed
// image keys (see BANNER_OPTIONS in profile.html), or '' to clear it back to
// no banner. Unlike update-avatar, there's no unlock/progress check — these
// are cosmetic-only options available to every account. Still goes through
// a Function using the service role, because `profiles` has no
// client-writable RLS policy at all (see the profiles table migrations).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

// Mirrors BANNER_OPTIONS' `key` values in profile.html — kept as a literal
// list here, same reasoning as update-avatar's VALID_AVATAR_KEYS, so a
// bad/unknown key can never be written to the DB.
const VALID_BANNER_KEYS = ['grass', 'water', 'fire', 'art1', 'art2'];
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

  const { error: upsertError } = await adminClient
    .from('profiles')
    .upsert({ user_id: user.id, banner_key: bannerKey || null }, { onConflict: 'user_id' });
  if (upsertError) {
    return respond(500, { error: upsertError.message });
  }

  return respond(200, { ok: true, bannerKey: bannerKey || null });
});
