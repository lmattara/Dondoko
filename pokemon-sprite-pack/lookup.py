#!/usr/bin/env python3
"""
Pokemon icon sprite lookup helper.

Usage examples:
    python3 lookup.py --name pikachu
    python3 lookup.py --number 6 --variant mega-y
    python3 lookup.py --name charizard --list-forms
    python3 lookup.py --search alola          # list every Alolan form
    python3 lookup.py --search gigantamax     # list every Gmax form

Sprites live in:
    sprites/common/icons/<dex>_<variant>.png   (regular)
    sprites/shiny/icons/<dex>_<variant>.png    (shiny)
Base forms have no _<variant> suffix, e.g. 0025.png = Pikachu.
"""
import json
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).parent
DATA = json.loads((ROOT / "pokemon.json").read_text())


def iter_forms():
    for entry in DATA:
        num = entry["number"]
        for form in entry["forms"]:
            yield num, form


def sprite_path(number: int, variant: str | None, shiny: bool = False):
    folder = "shiny" if shiny else "common"
    fname = f"{number:04d}"
    if variant:
        fname += f"_{variant}"
    fname += ".png"
    p = ROOT / "sprites" / folder / "icons" / fname
    return p if p.exists() else None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", help="English name to search for (partial match ok)")
    ap.add_argument("--number", type=int, help="National Pokedex number")
    ap.add_argument("--variant", help="Form/variant slug, e.g. mega, mega-y, alola, galar, hisui, gigantamax")
    ap.add_argument("--shiny", action="store_true", help="Get the shiny version")
    ap.add_argument("--list-forms", action="store_true", help="List all known forms for the matched Pokemon(s)")
    ap.add_argument("--search", help="Free-text search across all form names (e.g. 'alola', 'gigantamax')")
    args = ap.parse_args()

    if args.search:
        hits = [(n, f) for n, f in iter_forms() if args.search.lower() in f["names"]["en"].lower()]
        for n, f in hits:
            print(f"#{n:04d}  {f['names']['en']}  (variant={f.get('variant')})")
        print(f"\n{len(hits)} matches.")
        return

    if args.number is not None:
        matches = [(n, f) for n, f in iter_forms() if n == args.number]
    elif args.name:
        matches = [(n, f) for n, f in iter_forms() if args.name.lower() in f["names"]["en"].lower()]
    else:
        ap.print_help()
        return

    if not matches:
        print("No matches found.")
        return

    if args.list_forms:
        for n, f in matches:
            print(f"#{n:04d}  {f['names']['en']}  variant={f.get('variant')}")
        return

    # Default: try to resolve a single sprite
    n, f = matches[0]
    variant = args.variant
    p = sprite_path(n, variant, shiny=args.shiny)
    if p:
        print(p)
    else:
        print(f"No sprite file for #{n:04d} variant={variant!r}. Try --list-forms to see available forms.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
