// Server-side score submission. Recomputes `score` from raw run inputs
// (never trusts a client-supplied score) and validates every field against
// the same plausibility ranges as the DB CHECK constraints in
// supabase/schema.sql, before inserting with the service_role key. Direct
// anon-key inserts into `scores` are blocked by RLS (see the
// 2026-07-23_server_side_score_validation.sql migration) — this function is
// the only path in.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Edge Functions get no CORS handling by default. This one is called
// directly from the browser (GitHub Pages, a different origin than
// *.supabase.co), so every response — including the preflight OPTIONS
// request the browser sends before the real POST — needs these headers,
// or the browser silently blocks the call before it ever reaches this
// function's logic (surfaces client-side as functions.invoke() throwing,
// which recordRun() swallows, so the run just never gets saved).
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

function badRequest(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

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
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

  const { name, badges, trainersBeaten, caughtCount, goldEarned, mode, details, finalTeam, hillDefenses } = body ?? {};

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

  // Same formula as computeScore() in game.js.
  const score = badges * 100 + eliteBeaten * 60 + trainersBeaten * 25 + caughtCount * 15 + goldEarned;

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
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ score }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
