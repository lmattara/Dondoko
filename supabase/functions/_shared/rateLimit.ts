// Shared per-user rate limiting for account-related Edge Functions, backed
// by public.account_action_log (see the 20260727260000 migration). Unlike
// submit-score's IP-based limiting (which has to work for anonymous
// callers), every function using this already has an authenticated user —
// so this limits by user_id, which can't be dodged the way an IP can.
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type RateLimitResult = { ok: true } | { ok: false; retryAfterMinutes: number };

export async function checkRateLimit(
  adminClient: SupabaseClient,
  userId: string,
  action: string,
  maxCalls: number,
  windowMinutes: number,
): Promise<RateLimitResult> {
  const windowStart = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count } = await adminClient
    .from('account_action_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('action', action)
    .gte('created_at', windowStart);

  // Logged regardless of outcome (including the call that trips the limit)
  // so a caller can't dodge the count by firing requests faster than the
  // insert below would otherwise land.
  await adminClient.from('account_action_log').insert({ user_id: userId, action });

  if ((count ?? 0) >= maxCalls) {
    return { ok: false, retryAfterMinutes: windowMinutes };
  }
  return { ok: true };
}
