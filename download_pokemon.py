"""
Pokémon PNG Downloader — powered by PokeAPI (pokeapi.co)

Downloads Pokémon artwork/sprites and saves each as
<pokemon-name>.png, organized into subfolders by variant. Uses
PokeAPI, a free, open, fan-maintained API intended for exactly this
kind of project — no scraping, no ToS issues.

Setup:
    pip install requests

Run:
    python download_pokemon.py

Output (one subfolder per variant, e.g.):
    ./pokemon_png/official-artwork/pikachu.png
    ./pokemon_png/official-artwork-shiny/pikachu.png
    ./pokemon_png/home/pikachu.png
    ./pokemon_png/home-shiny/pikachu.png
    ./pokemon_png/dream-world/pikachu.png

Edit the VARIANTS list below to add/remove which image sets get
downloaded.
"""

import os
import time
import requests

BASE_URL = "https://pokeapi.co/api/v2/pokemon"
OUTPUT_DIR = "pokemon_png"
REQUEST_DELAY = 0.15  # be a good citizen to the free public API

# Each variant maps a folder name -> function that pulls the right
# URL out of a pokemon's "sprites" data. Comment out any you don't want.
VARIANTS = {
    "official-artwork": lambda sprites: sprites.get("other", {})
        .get("official-artwork", {}).get("front_default"),
    "official-artwork-shiny": lambda sprites: sprites.get("other", {})
        .get("official-artwork", {}).get("front_shiny"),
    "home": lambda sprites: sprites.get("other", {})
        .get("home", {}).get("front_default"),
    "home-shiny": lambda sprites: sprites.get("other", {})
        .get("home", {}).get("front_shiny"),
    "dream-world": lambda sprites: sprites.get("other", {})
        .get("dream_world", {}).get("front_default"),
}


def get_all_pokemon(limit=2000):
    """Fetch the full list of {name, url} entries from PokeAPI."""
    resp = requests.get(BASE_URL, params={"limit": limit})
    resp.raise_for_status()
    return resp.json()["results"]


def get_sprites(pokemon_url):
    """Given a pokemon detail URL, return its full 'sprites' dict."""
    resp = requests.get(pokemon_url)
    resp.raise_for_status()
    return resp.json().get("sprites", {})


def download_image(url, filepath):
    resp = requests.get(url)
    resp.raise_for_status()
    with open(filepath, "wb") as f:
        f.write(resp.content)


def main():
    for variant_name in VARIANTS:
        os.makedirs(os.path.join(OUTPUT_DIR, variant_name), exist_ok=True)

    print("Fetching full Pokémon list from PokeAPI...")
    pokemon_list = get_all_pokemon()
    total = len(pokemon_list)
    print(f"Found {total} Pokémon. Variants to download: {', '.join(VARIANTS)}\n")

    downloaded, skipped, failed = 0, 0, 0

    for i, entry in enumerate(pokemon_list, start=1):
        name = entry["name"]

        # Skip the whole entry only if every variant file already exists
        all_exist = all(
            os.path.exists(os.path.join(OUTPUT_DIR, variant, f"{name}.png"))
            for variant in VARIANTS
        )
        if all_exist:
            skipped += 1
            continue

        try:
            sprites = get_sprites(entry["url"])
        except requests.RequestException as e:
            print(f"[{i}/{total}] Failed to fetch data for {name}: {e}")
            failed += 1
            continue

        for variant_name, extractor in VARIANTS.items():
            filepath = os.path.join(OUTPUT_DIR, variant_name, f"{name}.png")
            if os.path.exists(filepath):
                continue

            image_url = extractor(sprites)
            if not image_url:
                continue  # this variant doesn't exist for this pokemon

            try:
                download_image(image_url, filepath)
                downloaded += 1
                print(f"[{i}/{total}] Saved {variant_name}/{name}.png")
            except requests.RequestException as e:
                print(f"[{i}/{total}] Failed {variant_name}/{name}: {e}")
                failed += 1

            time.sleep(REQUEST_DELAY)

    print("\nDone.")
    print(f"Downloaded: {downloaded} | Fully skipped Pokémon: {skipped} | Failed: {failed}")
    print(f"Files saved under: ./{OUTPUT_DIR}/<variant>/")


if __name__ == "__main__":
    main()
