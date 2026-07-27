// Sets the calling player's in-game display name, enforcing a 7-day cooldown
// between changes. The cooldown lives here (server-side, using the
// service_role key) rather than as a client-side check on
// supabase.auth.updateUser(), because that Auth self-service endpoint is
// always callable directly by any signed-in client no matter what UI wraps
// it — a client-side-only cooldown would just be decoration. `profiles` has
// no client-writable RLS policy at all (see the 2026-07-27 migration), so
// this function is the only path that can ever set game_name.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

const COOLDOWN_DAYS = 7;
const NAME_RE = /^[\p{L}\p{N} '_-]+$/u; // mirrors submit-score's NAME_RE
// The 7-day cooldown already caps successful changes hard — this just
// throttles repeated attempts/spam against the function itself (invalid
// names, races against the cooldown, etc).
const RATE_LIMIT_MAX = 10;
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
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 20 || !NAME_RE.test(name)) {
    return respond(400, { error: 'Invalid name' });
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const rateLimit = await checkRateLimit(adminClient, user.id, 'update-name', RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MINUTES);
  if (!rateLimit.ok) {
    return respond(429, { error: 'Too many attempts, please slow down.' });
  }

  const { data: existing, error: fetchError } = await adminClient
    .from('profiles')
    .select('game_name_changed_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (fetchError) {
    return respond(500, { error: fetchError.message });
  }

  if (existing?.game_name_changed_at) {
    const lastChanged = new Date(existing.game_name_changed_at).getTime();
    const cooldownMs = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    const msRemaining = lastChanged + cooldownMs - Date.now();
    if (msRemaining > 0) {
      const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
      return respond(429, {
        error: `You can change your name again in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`,
        daysRemaining,
      });
    }
  }

  // Case-insensitive uniqueness — also enforced at the DB level by
  // profiles_game_name_lower_unique_idx (a unique index on lower(game_name)),
  // this check just lets us return a friendly message instead of a raw
  // constraint-violation error.
  const { data: taken } = await adminClient
    .from('profiles')
    .select('user_id')
    .ilike('game_name', name)
    .neq('user_id', user.id)
    .maybeSingle();
  if (taken) {
    return respond(409, { error: 'That name is already taken.' });
  }

  const now = new Date().toISOString();
  const { error: upsertError } = await adminClient
    .from('profiles')
    .upsert({ user_id: user.id, game_name: name, game_name_changed_at: now }, { onConflict: 'user_id' });
  if (upsertError) {
    // Belt-and-suspenders against a race between the check above and this
    // write — the unique index is what actually prevents the duplicate.
    if (upsertError.code === '23505') {
      return respond(409, { error: 'That name is already taken.' });
    }
    return respond(500, { error: upsertError.message });
  }

  return respond(200, { ok: true, gameName: name, gameNameChangedAt: now });
});
