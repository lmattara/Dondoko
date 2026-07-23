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

// Mirrors the DB CHECK constraints in supabase/schema.sql exactly.
const RANGES: Record<string, [number, number]> = {
  badges: [0, 10],
  trainersBeaten: [0, 200],
  caughtCount: [0, 1351],
  goldEarned: [0, 10_000_000],
  eliteBeaten: [0, 4],
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const { name, badges, trainersBeaten, caughtCount, goldEarned, mode, details } = body ?? {};

  if (typeof details !== 'object' || details === null || Array.isArray(details)) {
    return badRequest('Invalid details');
  }
  const eliteBeaten = Number((details as Record<string, unknown>).eliteBeaten ?? 0);

  if (typeof name !== 'string' || name.trim().length < 1 || name.length > 20) {
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

  // Same formula as computeScore() in game.js.
  const score = badges * 100 + eliteBeaten * 60 + trainersBeaten * 25 + caughtCount * 15 + goldEarned;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { error } = await supabase.from('scores').insert({
    name: name.trim().slice(0, 20),
    score,
    badges,
    trainers_beaten: trainersBeaten,
    caught_count: caughtCount,
    gold_earned: goldEarned,
    mode,
    details,
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
