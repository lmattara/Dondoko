Drop the 2 fixed-image profile banners here:

- `banner-1.png` (key `art1` in profile.html's BANNER_IMAGE_OPTIONS)
- `banner-2.png` (key `art2`)

Recommended size: around 960x320px (3:1), PNG or JPG. It's rendered with
`background-size: cover; background-position: center;` behind the profile
bar's name/avatar, with a dark gradient scrim on top for text legibility —
so the important part of the art should sit away from the top-left/bottom
edges where the name and buttons overlap, and the image should still read
fine once darkened toward the right/bottom.

Until these files exist, that swatch/banner will just show as blank (the
`<img>`-less CSS background silently renders nothing, no broken-image icon).

To add a 3rd, 4th, etc. image option later: add another PNG here, then add an
entry to `BANNER_IMAGE_OPTIONS` in profile.html and to `VALID_BANNER_KEYS` in
supabase/functions/update-banner/index.ts (both must match, or the server
rejects the new key with "Invalid banner").
