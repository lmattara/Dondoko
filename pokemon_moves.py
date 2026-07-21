"""
Pokémon Moves Relational Dataset — powered by PokeAPI (pokeapi.co)

Builds two related CSV files:

1. pokemon_moves.csv
   Every (pokemon, move) pair — i.e. which moves each Pokémon can
   learn, and how (level-up, TM, egg move, tutor), plus the level
   if applicable.

   Columns: pokemon, move, learn_method, level_learned_at

2. moves.csv
   Full detail for every unique move that shows up above, so you
   can join the two tables together.

   Columns: move, type, damage_class, power, pp, accuracy, priority

Setup:
    pip install requests

Run:
    python pokemon_moves.py

Output:
    ./pokemon_png/pokemon_moves.csv   (or current dir if that folder
    doesn't exist — see OUTPUT_DIR below)
    ./pokemon_png/moves.csv
"""

import csv
import os
import time
import requests

POKEMON_LIST_URL = "https://pokeapi.co/api/v2/pokemon"
OUTPUT_DIR = "pokedex_data"
REQUEST_DELAY = 0.1  # be a good citizen to the free public API


def get_all_pokemon(limit=2000):
    resp = requests.get(POKEMON_LIST_URL, params={"limit": limit})
    resp.raise_for_status()
    return resp.json()["results"]


def get_pokemon_detail(pokemon_url):
    resp = requests.get(pokemon_url)
    resp.raise_for_status()
    return resp.json()


def get_move_detail(move_url):
    resp = requests.get(move_url)
    resp.raise_for_status()
    return resp.json()


def extract_move_rows(pokemon_name, moves_data):
    """
    From a pokemon's 'moves' array, produce one row per
    (move, version-group learn method) combo, using the most
    recent version group's data for level_learned_at.
    """
    rows = []
    for move_entry in moves_data:
        move_name = move_entry["move"]["name"]
        details = move_entry.get("version_group_details", [])
        if not details:
            continue
        # Use the last (most recent) version group entry available
        latest = details[-1]
        method = latest["move_learn_method"]["name"]
        level = latest.get("level_learned_at", 0)
        rows.append({
            "pokemon": pokemon_name,
            "move": move_name,
            "learn_method": method,
            "level_learned_at": level,
        })
    return rows


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("Fetching full Pokémon list from PokeAPI...")
    pokemon_list = get_all_pokemon()
    total = len(pokemon_list)
    print(f"Found {total} Pokémon.\n")

    all_pokemon_move_rows = []
    unique_move_urls = {}  # move_name -> move_url

    for i, entry in enumerate(pokemon_list, start=1):
        name = entry["name"]
        try:
            detail = get_pokemon_detail(entry["url"])
        except requests.RequestException as e:
            print(f"[{i}/{total}] Failed to fetch {name}: {e}")
            continue

        moves_data = detail.get("moves", [])
        rows = extract_move_rows(name, moves_data)
        all_pokemon_move_rows.extend(rows)

        for move_entry in moves_data:
            move_name = move_entry["move"]["name"]
            move_url = move_entry["move"]["url"]
            unique_move_urls.setdefault(move_name, move_url)

        print(f"[{i}/{total}] {name}: {len(rows)} moves")
        time.sleep(REQUEST_DELAY)

    # Write pokemon -> move relational table
    pokemon_moves_path = os.path.join(OUTPUT_DIR, "pokemon_moves.csv")
    with open(pokemon_moves_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=["pokemon", "move", "learn_method", "level_learned_at"]
        )
        writer.writeheader()
        writer.writerows(all_pokemon_move_rows)
    print(f"\nSaved {len(all_pokemon_move_rows)} pokemon-move rows to {pokemon_moves_path}")

    # Fetch and write full move detail table
    print(f"\nFetching details for {len(unique_move_urls)} unique moves...")
    move_rows = []
    for i, (move_name, move_url) in enumerate(unique_move_urls.items(), start=1):
        try:
            move_detail = get_move_detail(move_url)
        except requests.RequestException as e:
            print(f"[{i}/{len(unique_move_urls)}] Failed to fetch move {move_name}: {e}")
            continue

        move_rows.append({
            "move": move_name,
            "type": move_detail.get("type", {}).get("name", ""),
            "damage_class": move_detail.get("damage_class", {}).get("name", ""),
            "power": move_detail.get("power"),
            "pp": move_detail.get("pp"),
            "accuracy": move_detail.get("accuracy"),
            "priority": move_detail.get("priority"),
        })

        if i % 25 == 0 or i == len(unique_move_urls):
            print(f"[{i}/{len(unique_move_urls)}] Fetched move details...")

        time.sleep(REQUEST_DELAY)

    moves_path = os.path.join(OUTPUT_DIR, "moves.csv")
    with open(moves_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=["move", "type", "damage_class", "power", "pp", "accuracy", "priority"]
        )
        writer.writeheader()
        writer.writerows(move_rows)
    print(f"Saved {len(move_rows)} move detail rows to {moves_path}")

    print("\nDone. Join the two files on the 'move' column to relate")
    print("each Pokémon to full move stats (power, type, accuracy, etc).")


if __name__ == "__main__":
    main()
