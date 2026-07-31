# Pokémon Fangame Asset Pack (Pokémon Essentials, Non-EBDX)

Full UI/world/item/trainer asset library sourced from a Pokémon Essentials
(RPG Maker XP fangame engine) project — the same engine and asset conventions
used by games like Pokémon Rejuvenation, Reborn, Insurgence, etc. This is the
style shown in your summary-screen screenshot.

**479MB total in the original repo — this pack is the 79MB non-EBDX subset**
(EBDX is an optional battle-animation plugin, not core assets; skipped to keep
this manageable — ask if you want that too, it's mostly extra battle transition FX).

## Folder guide

| Folder | What's in it |
|---|---|
| `UI/` | Every menu screen's assets: Pokedex, Bag, Party, Summary, Storage (PC box), Trainer Card, Town Map, Pokegear, Phone, Mart, Naming screen, Hall of Fame, Mail, etc. **Type badges** are in `UI/types.png` and `UI/Pokedex/icon_types.png`. **Poké Ball icons** (all ball types, incl. Beast Ball, Cherish Ball, Hisuian Ultra Ball) are in `UI/Summary/icon_ball_*.png`. |
| `Icons/` | Bag pocket tab icons. |
| `Items/` | 705 individual item icons — berries, held items, TMs, mega stones, evolution items, Gen 9 items (Tera Orb, Herba Mysticas, etc). |
| `Pokemon/` | Battle sprites: `Front/`, `Back/`, `Front shiny/`, `Back shiny/` (full battle art), plus `Icons/` + `Icons shiny/` (party menu icons — a second, slightly different set from what I gave you earlier), `Footprints/`, `Eggs/`, `Shadow/` (Shadow Pokémon forms). |
| `Trainers/` | 78 full trainer-class **battle sprites** (the big trainer art shown when you battle them) — Youngster, Ace Trainer, Elite Four members, Gym Leaders, etc. |
| `Characters/` | 2,931 files — **overworld walking sprites**: NPCs, trainers (overworld scale), Pokémon overworld/following sprites, berry trees. This is what walks around on the map. |
| `Tilesets/` | Map tilesets — **houses, interiors** (Pokémon Center, Mart, Gym, caves, department store, harbour, multiplayer rooms, etc.), used to build the overworld map itself. |
| `Autotiles/` | Auto-tiling terrain pieces (water, grass, cliffs) that pair with tilesets. |
| `Battlebacks/` | Battle background scenery (grass, cave, water, gym, etc.) |
| `Animations/` | 97 **move animation spritesheets** — elemental effects (fire, ice, electric, poison, etc.), status effects, and generic battle FX like Tackle. These are frame-sheets (multiple animation frames laid out in a grid), meant to be played back in-engine — not standalone GIFs. |
| `Battle animations/` | Additional battle animation sheets. |
| `Transitions/` | Screen-wipe transition effects (for entering battle, etc.) |
| `Windowskins/` | The frame/border graphics used for all dialogue and menu boxes. |
| `Weather/`, `Fogs/`, `Pictures/`, `Titles/` | Weather effects, fog overlays, misc UI pictures, and title-screen art. |

## Note on "animated moves"

There's no pre-rendered "animated GIF of Flamethrower" type asset — these games
build move animations at runtime by layering and moving the frame-sheets in
`Animations/` according to scripted timing (defined in the engine's code, not
image files). If you want truly pre-rendered animated move clips, that's a
different, much rarer resource — let me know if you want me to look for that
specifically (Pokémon Showdown's animated sprites are closer to that, but only
cover Pokémon themselves, not moves).

## Source & credits

Sourced from a public Pokémon Essentials v21 fork on GitHub
(Manurocker95/Pokemon-Essentials-21-With-Unofficial-EBDX), which compiles work
from a large number of individual fan spriters and the Essentials dev community.
See `gen9_credits.txt` and `SOURCE_README.md` (from the original repo) included
here for the detailed per-asset credit list — please keep these if you
redistribute or ship anything using these assets.

**These are © Nintendo / Creatures Inc. / GAME FREAK Inc. fan-made recreations**
— same usage note as before: great for personal/prototype/fan work, not for
commercial release.
