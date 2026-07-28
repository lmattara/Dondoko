-- Profile banner: 3 solid-color options (grass/water/fire, same palette as
-- the starter types) plus 2 fixed image options the player provides art for
-- (assets/banners/banner-1.png, banner-2.png). No unlock/progress gate,
-- unlike avatar_key — same reasoning as avatar_key having no client-writable
-- RLS policy, the actual write only ever happens through update-banner
-- (service role), which whitelists the valid keys server-side.
alter table public.profiles add column if not exists banner_key text;
