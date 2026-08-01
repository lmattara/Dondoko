// Rinne auth proxy — deployed at auth.playrinne.com via a Cloudflare Workers
// Custom Domain binding (see the deploy command in this same folder's notes).
//
// Only forwards the two paths Google/Discord's OAuth redirect actually needs
// (/auth/v1/authorize, the initial redirect to the provider's consent screen,
// and /auth/v1/callback, the provider redirecting back after the user
// approves) straight through to the real Supabase project, unmodified.
// Everything else 404s — this is intentionally NOT a general-purpose proxy
// for the whole Supabase API (Realtime, Storage, REST all keep hitting the
// real project URL directly, same as before), so the surface area this
// touches stays small and easy to reason about.
const SUPABASE_ORIGIN = "https://azhhuhzbfuyuuwtykegm.supabase.co";
const ALLOWED_PATHS = new Set(["/auth/v1/authorize", "/auth/v1/callback"]);

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (!ALLOWED_PATHS.has(url.pathname)) {
      return new Response("Not found", { status: 404 });
    }

    const targetUrl = new URL(url.pathname + url.search, SUPABASE_ORIGIN);

    const headers = new Headers(request.headers);
    headers.delete("host");

    // redirect: "manual" — Supabase's /authorize responds with a 302 to
    // Google/Discord, and /callback responds with a 302 back to our app;
    // both need to reach the browser as-is, not get silently followed here.
    const upstream = await fetch(targetUrl.toString(), {
      method: request.method,
      headers,
      body: (request.method === "GET" || request.method === "HEAD") ? undefined : request.body,
      redirect: "manual",
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers,
    });
  },
};
