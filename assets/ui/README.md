Sprite frames for `.btn-sprite` (see style.css), an opt-in 9-slice button skin —
not applied to any button by default.

- `button-frame.png` / `button-frame-hover.png` / `button-frame-pressed.png`
  are 32x32 placeholdCaer pixel-art frames (idle / hover / pressed states).

How to make a real one to replace these:
1. Draw a 24x24 or 32x32 canvas (Piskel, Aseprite, or GIMP/Photoshop at 1:1 zoom).
2. Only the outer border band needs art — leave the center transparent, that's
   the part `border-image` discards by default.
3. Keep all 4 corners identical (or mirrored), `border-image-slice` cuts the
   same number of pixels from every edge.
4. Export as PNG with alpha, no flattening.
5. Set `border-image-slice` in style.css to your border's thickness in source
   pixels. `border-image-width` can be any size you want it to render at —
   they don't have to match.
6. Draw a hover and pressed variant too, then swap `border-image-source` on
   `:hover`/`:active`.
