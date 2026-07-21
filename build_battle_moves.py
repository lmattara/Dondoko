"""
Battle Moveset Builder — joins pokedex_data/pokemon_moves.csv,
pokedex_data/moves.csv, and data/pokemon.json (both produced earlier in the
pipeline) into a compact per-Pokémon moveset for the auto-battle game.

For each Pokémon (including every evolution stage, tracked separately by
name): considers every distinct, damaging (power > 0) move it can ever learn
by ANY method (level-up, TM/machine, egg, tutor, etc. — restricting to
level-up alone starves many Pokémon down to 1-2 real options), then scores
each candidate for how strong it actually is *on that specific Pokémon*:

    score = power * accuracy/100
                   * (1.5 if the move's type is one of the Pokémon's own
                      types, i.e. STAB, else 1.0)
                   * (1.15 if the move's damage class matches whichever of
                      attack/sp_atk is higher for this Pokémon, else 0.85 —
                      a physical move on a special attacker or vice versa
                      underperforms relative to its listed power)

The top 4 moves by that score are kept — always the strongest real options
for that Pokémon's own typing and stat spread, not just whatever has the
highest power number in a vacuum.

Run:
    python build_battle_moves.py

Output:
    data/battle_moves.json   { pokemon_name: [{name,type,power,accuracy,damage_class}, ...] }
"""

import csv
import json
import os

MOVES_CSV = os.path.join("pokedex_data", "moves.csv")
POKEMON_MOVES_CSV = os.path.join("pokedex_data", "pokemon_moves.csv")
POKEMON_JSON = os.path.join("data", "pokemon.json")
OUTPUT_PATH = os.path.join("data", "battle_moves.json")
MAX_MOVES = 4

STAB_MULT = 1.5
STAT_MATCH_MULT = 1.15
STAT_MISMATCH_MULT = 0.85


def main():
    moves_by_name = {}
    with open(MOVES_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            power = row["power"]
            if not power:
                continue
            moves_by_name[row["move"]] = {
                "name": row["move"].replace("-", " "),
                "type": row["type"],
                "power": int(power),
                "accuracy": int(row["accuracy"]) if row["accuracy"] else 100,
                "damage_class": row["damage_class"],
            }

    # Every damaging move a Pokémon can learn by any method — level-up alone
    # leaves most Pokémon with only 1-2 real options.
    candidates = {}  # pokemon -> {move_name: move_dict}
    with open(POKEMON_MOVES_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            move = moves_by_name.get(row["move"])
            if not move:
                continue
            candidates.setdefault(row["pokemon"], {})[row["move"]] = move

    with open(POKEMON_JSON, encoding="utf-8") as f:
        pokemon_list = json.load(f)
    stats_by_name = {p["name"]: p for p in pokemon_list}

    def score(move, pokemon_types, physical_is_stronger):
        s = move["power"] * (move["accuracy"] / 100.0)
        if move["type"] in pokemon_types:
            s *= STAB_MULT
        stat_matches = (move["damage_class"] == "physical") == physical_is_stronger
        s *= STAT_MATCH_MULT if stat_matches else STAT_MISMATCH_MULT
        return s

    result = {}
    for pokemon, moves in candidates.items():
        stats = stats_by_name.get(pokemon)
        if stats:
            types = stats.get("types", [])
            physical_is_stronger = stats.get("attack", 0) >= stats.get("sp_atk", 0)
        else:
            # No stat data for this entry (rare alt-form) — fall back to
            # plain power ordering rather than guessing a stat profile.
            types, physical_is_stronger = [], True

        best = sorted(
            moves.values(),
            key=lambda m: score(m, types, physical_is_stronger),
            reverse=True,
        )[:MAX_MOVES]
        result[pokemon] = best

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f)

    with_moves = sum(1 for v in result.values() if v)
    print(f"Wrote movesets for {len(result)} Pokémon ({with_moves} with at least 1 damaging move) to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
