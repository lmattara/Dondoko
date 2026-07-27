// Get-or-create for the calling player's own `profiles` row. Called once per
// profile.html load so every signed-in account has a player_number (the
// stable numeric id — see the 20260727250000 migration) assigned as soon as
// they first view their profile, not only once they set a name or avatar
// (both of which are optional and may never happen). `profiles` has no
// client-writable RLS policy at all, so the insert has to go through a
// Function using the service role, same as update-name/update-avatar.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

// Called once per profile.html load, so this has to stay generous enough
// for normal browsing (switching tabs, re-opening the page) — it's really
// just a backstop against a scripted loop, not a real per-visit limit.
const RATE_LIMIT_MAX = 30;
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

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const rateLimit = await checkRateLimit(adminClient, user.id, 'ensure-profile', RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MINUTES);
  if (!rateLimit.ok) {
    return respond(429, { error: 'Too many attempts, please slow down.' });
  }

  // ignoreDuplicates so a row that already exists is left untouched (name/
  // avatar/cooldown intact) — this only ever needs to insert the bare id
  // once, on a brand-new account.
  const { error: insertError } = await adminClient
    .from('profiles')
    .upsert({ user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (insertError) {
    return respond(500, { error: insertError.message });
  }

  const { data: profile, error: fetchError } = await adminClient
    .from('profiles')
    .select('game_name, game_name_changed_at, avatar_key, player_number')
    .eq('user_id', user.id)
    .single();
  if (fetchError) {
    return respond(500, { error: fetchError.message });
  }

  return respond(200, profile);
});
