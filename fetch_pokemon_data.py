"""
Pokémon Data Fetcher — powered by PokeAPI (pokeapi.co)

Builds data/pokemon.json: one entry per Pokémon with its id, name,
type(s), base stat total, and legendary/mythical flag. Used by the
catching game to know which Pokémon are legal to appear in the wild
list (non-legendary, non-mythical) and how hard each is to catch.

Pairs with download_pokemon.py, which pulls the PNG artwork into
./pokemon_png/official-artwork/<name>.png — this script only pulls
the JSON stats/typing/species data, it doesn't touch images.

Setup:
    pip install requests

Run:
    python fetch_pokemon_data.py
"""

import json
import os
import time
import requests

BASE_URL = "https://pokeapi.co/api/v2/pokemon"
OUTPUT_PATH = os.path.join("data", "pokemon.json")
REQUEST_DELAY = 0.1


def get_all_pokemon(limit=2000):
    resp = requests.get(BASE_URL, params={"limit": limit})
    resp.raise_for_status()
    return resp.json()["results"]


def main():
    os.makedirs("data", exist_ok=True)

    existing = {}
    if os.path.exists(OUTPUT_PATH):
        with open(OUTPUT_PATH, "r", encoding="utf-8") as f:
            for entry in json.load(f):
                existing[entry["name"]] = entry

    print("Fetching full Pokémon list from PokeAPI...")
    pokemon_list = get_all_pokemon()
    total = len(pokemon_list)
    print(f"Found {total} Pokémon.\n")

    results = dict(existing)

    for i, entry in enumerate(pokemon_list, start=1):
        name = entry["name"]
        if name in existing:
            continue

        try:
            detail = requests.get(entry["url"])
            detail.raise_for_status()
            detail = detail.json()

            species = requests.get(detail["species"]["url"])
            species.raise_for_status()
            species = species.json()
        except requests.RequestException as e:
            print(f"[{i}/{total}] Failed {name}: {e}")
            continue

        types = [t["type"]["name"] for t in detail["types"]]
        bst = sum(s["base_stat"] for s in detail["stats"])
        legendary = bool(species.get("is_legendary") or species.get("is_mythical"))

        results[name] = {
            "id": detail["id"],
            "name": name,
            "types": types,
            "bst": bst,
            "legendary": legendary,
        }
        print(f"[{i}/{total}] {name}: types={types} bst={bst} legendary={legendary}")

        if i % 25 == 0:
            with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
                json.dump(list(results.values()), f)

        time.sleep(REQUEST_DELAY)

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(sorted(results.values(), key=lambda e: e["id"]), f, indent=1)

    print(f"\nDone. Wrote {len(results)} entries to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
