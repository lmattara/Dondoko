"""
Base Species Catch Rate Augmenter — local computation, no network calls.

Adds a `base_species_rate` field (0.0-1.0) to every entry in
data/pokemon.json, derived from its base stat total and legendary flag:
legendaries are hard-set low (0.03), everything else scales down from a
0.6 cap as bst rises, floored at 0.08 for the toughest non-legendaries.

Run:
    python augment_catch_rate.py
"""

import json
import os

DATA_PATH = os.path.join("data", "pokemon.json")
LEGENDARY_RATE = 0.03
RATE_MAX = 0.6
RATE_MIN = 0.08


def catch_rate_for(p):
    if p.get("legendary"):
        return LEGENDARY_RATE
    bst = p.get("bst", 400)
    rate = 1.15 - bst / 500
    return round(max(RATE_MIN, min(RATE_MAX, rate)), 3)


def main():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        entries = json.load(f)

    for entry in entries:
        entry["base_species_rate"] = catch_rate_for(entry)

    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=1)

    print(f"Added base_species_rate to {len(entries)} entries in {DATA_PATH}")


if __name__ == "__main__":
    main()
