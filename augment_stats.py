"""
Pokémon Battle Stats Augmenter — powered by PokeAPI (pokeapi.co)

fetch_pokemon_data.py already wrote data/pokemon.json with each
Pokémon's id/name/types/bst/legendary flag, but discarded the
individual stat breakdown. The auto-battle game needs hp/attack/
defense/special-attack/special-defense/speed to compute damage, so
this script re-fetches just the /pokemon/{name} detail (no species
call needed this time — legendary flag is already known) and merges
the six base stats into each existing entry in place.

Setup:
    pip install requests

Run:
    python augment_stats.py
"""

import json
import os
import time
import requests

DATA_PATH = os.path.join("data", "pokemon.json")
REQUEST_DELAY = 0.1
STAT_KEYS = {
    "hp": "hp",
    "attack": "attack",
    "defense": "defense",
    "special-attack": "sp_atk",
    "special-defense": "sp_def",
    "speed": "speed",
}


def main():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        entries = json.load(f)

    total = len(entries)
    todo = [e for e in entries if "hp" not in e]
    print(f"{total} entries total, {len(todo)} missing stats.\n")

    for i, entry in enumerate(todo, start=1):
        try:
            resp = requests.get(f"https://pokeapi.co/api/v2/pokemon/{entry['name']}")
            resp.raise_for_status()
            detail = resp.json()
        except requests.RequestException as e:
            print(f"[{i}/{len(todo)}] Failed {entry['name']}: {e}")
            continue

        for s in detail.get("stats", []):
            key = STAT_KEYS.get(s["stat"]["name"])
            if key:
                entry[key] = s["base_stat"]

        print(f"[{i}/{len(todo)}] {entry['name']}: hp={entry.get('hp')} atk={entry.get('attack')} spd={entry.get('speed')}")

        if i % 50 == 0:
            with open(DATA_PATH, "w", encoding="utf-8") as f:
                json.dump(entries, f)

        time.sleep(REQUEST_DELAY)

    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=1)

    print(f"\nDone. {DATA_PATH} now has full stat breakdowns.")


if __name__ == "__main__":
    main()
