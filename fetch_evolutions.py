"""
Pokémon Evolution Map Fetcher — powered by PokeAPI (pokeapi.co)

Builds data/evolutions.json: a flat { species_name: next_evolution_name }
map used by the "winning a Gym battle evolves your Pokémon" feature.
Only the immediate next stage is stored (e.g. charmander -> charmeleon,
not charizard); species with no further evolution are simply absent.
For branching evolutions (e.g. Eevee) only the first-listed branch is
kept — good enough for a simple gameplay hook, not meant to be exhaustive.

Walks every evolution chain once (not per-species), which is far cheaper
than looking up each of the ~1300 Pokémon individually.

Setup:
    pip install requests

Run:
    python fetch_evolutions.py
"""

import json
import os
import time
import requests

CHAIN_LIST_URL = "https://pokeapi.co/api/v2/evolution-chain"
OUTPUT_PATH = os.path.join("data", "evolutions.json")
REQUEST_DELAY = 0.1


def walk_chain(node, mapping):
    name = node["species"]["name"]
    evolves_to = node.get("evolves_to") or []
    if evolves_to:
        mapping[name] = evolves_to[0]["species"]["name"]
    for child in evolves_to:
        walk_chain(child, mapping)


def main():
    os.makedirs("data", exist_ok=True)

    resp = requests.get(CHAIN_LIST_URL, params={"limit": 1000})
    resp.raise_for_status()
    chains = resp.json()["results"]
    total = len(chains)
    print(f"Found {total} evolution chains.\n")

    mapping = {}
    for i, entry in enumerate(chains, start=1):
        try:
            detail = requests.get(entry["url"])
            detail.raise_for_status()
            walk_chain(detail.json()["chain"], mapping)
        except requests.RequestException as e:
            print(f"[{i}/{total}] Failed {entry['url']}: {e}")
            continue

        if i % 25 == 0 or i == total:
            print(f"[{i}/{total}] {len(mapping)} evolution links mapped so far...")

        time.sleep(REQUEST_DELAY)

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(mapping, f, indent=1)

    print(f"\nDone. Wrote {len(mapping)} evolution links to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
