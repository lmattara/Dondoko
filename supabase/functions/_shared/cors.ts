// Shared CORS handling for every Edge Function. Restricts
// Access-Control-Allow-Origin to the real site instead of '*' (which let
// any website on the internet call these functions using a visitor's own
// stolen/valid session token). Local dev origins are allowed too, or none
// of this could ever be tested against the real Supabase project without
// deploying first.
const ALLOWED_ORIGINS = ['https://playrinne.com'];

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

// Call once per request, after `req` is in scope, not as a module-level
// constant — the allowed origin depends on who's actually calling.
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin! : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
