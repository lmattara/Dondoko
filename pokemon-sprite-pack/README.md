# Pokémon Icon Sprite Pack (Gen 1–9)

32×32 "party menu" style icon sprites — the same style shown in Fire Red / Emerald
party screens — for all 1,025 Pokémon (Gen 1–9), including forms.

## What's included

- `sprites/common/icons/` — 1,471 regular sprites
- `sprites/shiny/icons/` — 1,471 shiny sprites
- `pokemon.json` — metadata for every Pokémon and form (names, types, gen, evolution, gender ratio)
- `lookup.py` — helper script to find sprite files by name/number/form
- `SOURCE_README.md` — original project README with full credits

## Forms covered

| Form type      | Count |
|-----------------|-------|
| Mega Evolution   | 48    |
| Gigantamax       | 33    |
| Alolan forms     | 20    |
| Galarian forms   | 20    |
| Hisuian forms    | 16    |
| Paldean forms    | 4     |
| Regular + misc forms | rest |

**Not included:** Tera forms. Terastallization is a battle-time crystal/color overlay
applied to a Pokémon's *existing* sprite rather than a unique icon design, so there's
no separate "Tera icon" style art for it in official or fan projects — except for
Terapagos, whose three forms (Normal/Terastal/Stellar) genuinely do have distinct
sprites and are included.

## File naming

```
sprites/common/icons/<dex_number>_<variant>.png
sprites/shiny/icons/<dex_number>_<variant>.png
```
Base forms have no `_<variant>` suffix, e.g. `0025.png` = Pikachu.
Numbers are zero-padded to 4 digits.

## Quick usage

```bash
# Find Pikachu's base sprite
python3 lookup.py --name pikachu

# List every form/variant a Pokemon has
python3 lookup.py --name pikachu --list-forms

# Get a specific variant (Mega Charizard Y)
python3 lookup.py --number 6 --variant mega-y

# Get the shiny version
python3 lookup.py --number 6 --variant mega-y --shiny

# Search across all forms (e.g. every Alolan form)
python3 lookup.py --search alola
```

## Source & credits

Sourced from [NathanPERIER/pokemon-icons-db](https://github.com/NathanPERIER/pokemon-icons-db),
which compiled Gen 1–8 icons via the [PokéSprite](https://github.com/msikma/pokesprite) project
and Gen 9 icons from a fan resource pack (credits: Vent, Katten, leParagon, Cesare_CBass,
AlexandreV2.0, Carmanekko, GRAFAIAIMX). See `SOURCE_README.md` for the full credit list.

**Usage note:** these sprites are © Nintendo / Creatures Inc. / GAME FREAK Inc.
This is a fan-made, unofficial community dataset — great for personal projects,
prototyping, and fan tools, but keep that in mind for anything commercial.
