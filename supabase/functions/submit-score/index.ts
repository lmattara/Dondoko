// Server-side score submission. Recomputes `score` from raw run inputs
// (never trusts a client-supplied score) and validates every field against
// the same plausibility ranges as the DB CHECK constraints in
// supabase/schema.sql, before inserting with the service_role key. Direct
// anon-key inserts into `scores` are blocked by RLS (see the
// 2026-07-23_server_side_score_validation.sql migration) — this function is
// the only path in.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const VALID_MODES = ['classic', 'pro', 'nuzlocke'];

// Rate limiting: at most RATE_LIMIT_MAX submission attempts (valid or not)
// per IP within RATE_LIMIT_WINDOW_MINUTES. Backed by score_submission_log
// (see the 2026-07-25_add_rate_limit_log.sql migration) instead of an
// in-memory counter, since Deno Deploy can spin up a fresh instance between
// requests and an in-memory count would silently reset.
const RATE_LIMIT_WINDOW_MINUTES = 2;
const RATE_LIMIT_MAX = 5;

async function hashIp(ip: string): Promise<string> {
  const bytes = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Mirrors the DB CHECK constraints in supabase/schema.sql exactly.
const RANGES: Record<string, [number, number]> = {
  badges: [0, 10],
  // Raised from 200: a run no longer has to end at Elite Four, the
  // infinite loop past King of the Hill has no upper limit on trainers beaten.
  trainersBeaten: [0, 2000],
  caughtCount: [0, 1351],
  goldEarned: [0, 10_000_000],
  eliteBeaten: [0, 4],
  hillDefenses: [0, 2000],
};

function inRange(n: unknown, [lo, hi]: [number, number]): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const badRequest = (message: string) =>
    new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // If the request carries a signed-in player's session (game.js's shared
  // supabaseClient auto-attaches it), resolve their user id so the run can
  // show up on their profile page later. Guests send no usable auth header
  // (just the anon key) — getUser() then returns no user and userId stays
  // null, same as any run submitted before accounts existed.
  let userId: string | null = null;
  const authHeader = req.headers.get('Authorization');
  if (authHeader) {
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await callerClient.auth.getUser();
    userId = user?.id ?? null;
  }

  // x-forwarded-for can carry a client-supplied chain ("client, proxy1,
  // proxy2, ..."); the first entry is what Supabase's edge network reports
  // as the actual connecting client.
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  const ipHash = await hashIp(ip);
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString();
  const { count, error: rateLimitError } = await supabase
    .from('score_submission_log')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', windowStart);
  if (!rateLimitError && (count ?? 0) >= RATE_LIMIT_MAX) {
    return new Response(JSON.stringify({ error: 'Too many submissions, please slow down.' }), {
      status: 429,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
  // Logged regardless of what happens next (including validation failures
  // below) so a script can't dodge the limit by sending malformed bodies.
  await supabase.from('score_submission_log').insert({ ip_hash: ipHash });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const { name, badges, trainersBeaten, caughtCount, goldEarned, mode, details, finalTeam, hillDefenses, durationSec } = body ?? {};

  if (typeof details !== 'object' || details === null || Array.isArray(details)) {
    return badRequest('Invalid details');
  }
  const eliteBeaten = Number((details as Record<string, unknown>).eliteBeaten ?? 0);
  const hillDefensesNum = Number(hillDefenses ?? 0);

  // Mirrors stripDisallowedNameChars()/sanitizeHighscoreName() in game.js —
  // the client only strips these client-side, so the check has to be
  // re-applied here or a direct POST could store an unescaped name.
  const NAME_RE = /^[\p{L}\p{N} '_-]+$/u;
  if (typeof name !== 'string' || name.trim().length < 1 || name.length > 20 || !NAME_RE.test(name)) {
    return badRequest('Invalid name');
  }
  if (typeof mode !== 'string' || !VALID_MODES.includes(mode)) {
    return badRequest('Invalid mode');
  }
  if (!inRange(badges, RANGES.badges)) return badRequest('badges out of range');
  if (!inRange(trainersBeaten, RANGES.trainersBeaten)) return badRequest('trainersBeaten out of range');
  if (!inRange(caughtCount, RANGES.caughtCount)) return badRequest('caughtCount out of range');
  if (!inRange(goldEarned, RANGES.goldEarned)) return badRequest('goldEarned out of range');
  if (!inRange(eliteBeaten, RANGES.eliteBeaten)) return badRequest('eliteBeaten out of range');
  if (!inRange(hillDefensesNum, RANGES.hillDefenses)) return badRequest('hillDefenses out of range');
  // Simple array of up to 6 species-name strings, no level/moveset concept
  // exists in this game (see finishEncounter()'s finalTeamSpecies).
  const finalTeamArr = Array.isArray(finalTeam) ? finalTeam : [];
  if (finalTeamArr.length > 6 || !finalTeamArr.every((s) => typeof s === 'string' && s.length <= 60)) {
    return badRequest('Invalid finalTeam');
  }
  // Optional — older clients / a clock-skewed runStartedAt just omit it.
  // Not part of the score formula, so the range here is a generous sanity
  // cap (~2 days), not a balance concern.
  let durationSecNum: number | null = null;
  if (durationSec !== undefined && durationSec !== null) {
    if (!inRange(durationSec, [0, 172_800])) return badRequest('durationSec out of range');
    durationSecNum = durationSec as number;
  }

  // Same formula as computeScore() in game.js.
  const score = badges * 100 + eliteBeaten * 60 + trainersBeaten * 25 + caughtCount * 15 + goldEarned;

  // Whichever season is currently open (ended_at is null) — starting a new
  // season is a manual SQL action for now (see the seasons table migration),
  // so this just always tags the run with whatever that row is at submit time.
  const { data: currentSeason } = await supabase
    .from('seasons')
    .select('id')
    .is('ended_at', null)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from('scores').insert({
    name: name.trim().slice(0, 20),
    score,
    badges,
    trainers_beaten: trainersBeaten,
    caught_count: caughtCount,
    gold_earned: goldEarned,
    mode,
    details,
    final_team: finalTeamArr,
    hill_defenses: hillDefensesNum,
    user_id: userId,
    duration_sec: durationSecNum,
    season_id: currentSeason?.id ?? null,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ score }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
