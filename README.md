# Apex Tamer — Catch 'Em

A roguelike catching loop with a 10-badge, player-chosen structure: pick 1
of 3 random starters (drawn from all 9 generations), then cycle through
**encounter → catch attempt → route trainer → PokeStop → pick a Gym Badge
→ PokeStop**, over and over, until you lose a battle, clear the endgame,
or choose to stop.

**Each encounter** shows 6 random wild, non-legendary Pokémon side by side
in a single row. Pick one target and try to catch it — catch chance is a
proper modifier-stacking formula: `base_species_rate × ball_modifier ×
food multiplier stack`, clamped to [0, 1]. Pokéball/Great Ball/Ultra Ball
each carry their own multiplier (1×/1.5×/2×); Master Ball (earned, not
sold) bypasses the formula for a guaranteed catch. 2 tiered food items
(Berry Snack/Poke Treat) are separate pre-throw actions that stack
multiplicatively into the same roll — food also reduces the flat chance
a failed throw lets the target flee outright. There's a `SHINY_CHANCE` (1/512) roll on every wild Pokémon
shown; a shiny uses its shiny artwork everywhere (encounter card, catch
screen, battle, results) and keeps that flag through evolution. Every
catch goes onto your active team if there's room (max 6), otherwise
straight to **Storage**.

**Every encounter** (caught or not) is followed by a quick route trainer
fight — just 1 Pokémon, a fast hurdle rather than a real test. Win it and
you stop at the **PokeStop**, where you pick which of **10 Gym Badges** to
challenge next — each themed to a type (or type pair) with its own badge
art, e.g. Fire, Water, Ice/Flying, Steel/Dark. A Gym Leader's squad is
type-matched to their badge where possible (falling back to the untyped
strength band if too few typed Pokémon qualify). Each badge can only be
challenged — and beaten — once per run, and difficulty scales with how
many badges you've already earned this run (badge #1 you pick is easy,
badge #8 is hard) rather than with which specific badge it is. Only 8 of
the 10 badges are required — the other 2 are optional.

Right after earning your **8th badge**, a one-time, unrepeatable
**Legendary Pokémon** battle unlocks: win and it's added to Storage (not
auto-added to your active team, which may already be full); lose and it
flees for good — either way the run continues straight into a PokeStop
and then the **Elite Four**. The Elite Four is four brutal, untyped, full
6-vs-6 battles fought back to back (with a PokeStop stop between each to
restock). Beat all four and you become **Pokémon Champion**, earning a
Master Ball, and the run ends there as a win.

Beating a Gym Leader picks one random Pokémon from your active roster
that's capable of evolving (if any) and evolves it — the reveal plays as
an animation on the next screen (the PokeStop) rather than in the battle
log.

In every battle, your team (capped at 6) auto-battles the opponent's turn
by turn with real moves, types, and HP bars, rotating in the next Pokémon
whenever one faints. Mid-battle you can open the **Bag** to use a Potion
(heals your active Pokémon) or a Revive (brings back your most recently
fainted one) — opening the bag pauses the auto-battle until you close it.

**The PokeStop** is the one hub for everything mid-run:
- **Shop** — buy one-off Pokéballs/Great Balls/Ultra Balls/food
  items/Potions/Revives with gold. Your full inventory is always visible
  right on the PokeStop screen.
- **Computer** — the PC box: deposit an active-team Pokémon into Storage
  or withdraw one from Storage into the active team (blocked if the
  active team is already at 6 — deposit first). This is how you actually
  get a caught Legendary into your battling lineup.

**Losing** any non-Legendary battle ends the run immediately. Gold
persists across runs.

**When a run ends** (win, loss, or voluntary stop), the result screen
tallies badges earned, battles won, Pokémon caught, and gold earned into a
single score. You can write your name to save the run as a Highscore —
the top 5 all-time runs (by score) are tracked as a local high-score
table, with a "NEW HIGH SCORE" banner when you beat your own record.

## Running it

Don't just double-click `index.html` — the game loads its data from
`/data/*.json` via `fetch()`, and browsers block that over a plain
`file://` path. You need a local server. Easiest option in VS Code:

1. Install the **Live Server** extension (by Ritwick Dey).
2. Right-click `index.html` → **Open with Live Server**.
3. It opens at something like `http://127.0.0.1:5500` and auto-reloads
   whenever you save a file.

(Any other local server works too — `npx serve`, Python's
`python3 -m http.server`, etc. — Live Server is just the path of least
resistance in VS Code.)

## Project structure

```
apex-tamer/
├── index.html                → page shell, all screens
├── style.css                  → all styling
├── game.js                     → all game logic, loads data from /data
├── data/
│   ├── pokemon.json             → id, name, types, bst, legendary flag, full stat spread, base_species_rate (catch rate)
│   ├── battle_moves.json         → per-Pokémon moveset used in trainer battles (name, type, power, accuracy, damage_class)
│   └── evolutions.json            → { species_name: next_evolution_name } for the "evolve on Gym win" feature
├── pokedex_data/
│   ├── pokemon_moves.csv         → raw (pokemon, move, learn_method, level) relational table
│   └── moves.csv                  → raw move detail table (type, damage_class, power, pp, accuracy, priority)
├── pokemon_png/
│   ├── official-artwork/         → <name>.png artwork
│   └── official-artwork-shiny/    → <name>.png shiny artwork
├── download_pokemon.py          → pulls PNG artwork (both variants) from PokeAPI into pokemon_png/
├── fetch_pokemon_data.py         → pulls types/bst/legendary flag from PokeAPI into data/pokemon.json
├── augment_stats.py               → adds the 6 individual base stats to existing data/pokemon.json entries
├── augment_catch_rate.py           → adds base_species_rate to data/pokemon.json (local computation, no network)
├── pokemon_moves.py                 → pulls the moves relational tables into pokedex_data/*.csv
├── build_battle_moves.py             → joins pokedex_data/*.csv into data/battle_moves.json (local only, no API calls)
└── fetch_evolutions.py                → walks every PokeAPI evolution chain into data/evolutions.json
```

## Regenerating the data

All the Python scripts except `build_battle_moves.py` and
`augment_catch_rate.py` hit the free, public [PokeAPI](https://pokeapi.co)
— no scraping, no ToS issues. Most skip Pokémon/moves they've already
fetched, so re-runs are cheap. Run in this order the first time:

```
pip install requests
python download_pokemon.py       # PNG artwork (incl. shiny) -> pokemon_png/<variant>/<name>.png
python fetch_pokemon_data.py     # types/bst/legendary flag -> data/pokemon.json
python augment_stats.py          # adds hp/attack/defense/sp_atk/sp_def/speed to data/pokemon.json
python augment_catch_rate.py     # adds base_species_rate to data/pokemon.json (no network)
python pokemon_moves.py          # move-learn tables -> pokedex_data/*.csv
python build_battle_moves.py     # joins the CSVs into data/battle_moves.json (no network)
python fetch_evolutions.py       # evolution chains -> data/evolutions.json
```

## Game flow (in `game.js`)

- `startGame()` / `renderStarterChoices()` / `selectStarter()` — rolls 3
  random starters and lets the player pick one. `selectStarter()`
  initializes the whole run's state: `activeTeam` (starts as `[starter]`),
  `storage_` (the Storage array — named with a trailing underscore to
  avoid colliding with `localStorage`/`sessionStorage`), `inv` (every
  consumable, seeded from `META`'s permanent upgrades), `encounterNum`,
  `runTrainersBeaten`, `runBadges`, `runChampion`, `runGoldEarned`,
  `legendaryHandled`.
- `startEncounter()` — rolls `WILD_COUNT` (12, shown as
  two rows of 6) wild Pokémon (excluding legendaries, alternate forms, and anything already in
  `activeTeam`/`storage_`), independently rolling `SHINY_CHANCE` per
  choice and tagging shiny hits with `is_shiny:true` on a *cloned* object
  (never mutates the shared `POKEMON` data). Renders them as a single
  horizontal row (`typeDotsHTML()` swaps in compact colored dots instead
  of full type-chip text so 6 cards fit the screen width). If `inv.balls`
  is 0, the choice screen is skipped entirely and the run goes straight to
  `startTrainerBattle()`.
- `computeCatchChance(mon, kind)` — `base_species_rate × BALL_MODIFIERS[kind]
  × pendingMultiplier` (Master Ball short-circuits to 1). `useFoodItem(kind)`
  multiplies into `pendingMultiplier` (and
  `pendingFleeReduction`/`pendingNoCritFlee` for the food items), reset
  after every throw in `resolveThrow()`. A failed throw rolls
  `BALL_BASE_FLEE_CHANCE` (reduced by food) to decide if the target flees
  outright instead of allowing another throw. `catchWildTarget()` places a
  successful catch on `activeTeam` if there's room, else `storage_`.
- `rollTrainer()` / `rollBadgeGym(badge)` / `rollEliteMember(tier)` /
  `startLegendaryBattle()` / `beginBattle()` — route trainers are always a
  `ROUTE_TRAINER_SQUAD_SIZE` (1) Pokémon fight capped at `LOW_TIER_MAX_BST`.
  `rollBadgeGym()` looks up the difficulty band from `GYM_DIFFICULTY_TIERS`
  indexed by `runBadges` (badges earned so far, not which badge was
  picked), filters the strength-band pool down to Pokémon matching the
  chosen `badge.types` (falling back to the untyped band if too few
  qualify), and caps squad size at `currentPartySize()`. `rollEliteMember()`
  does the same strength-band roll against `ELITE_FOUR[eliteIndex]` with no
  type filter, squad size fixed at 6 (still capped by party size).
- `BADGES` (10 entries: `key`/`icon`/`leaderName`/`types`) drive the Gym
  Badge select screen (`openGymSelect()` / `renderGymSelect()` /
  `challengeBadge(key)`, `#gymSelectScreen`) — each badge is disabled once
  its `key` is in `runBeatenBadges`. `BADGES_TO_UNLOCK_ENDGAME` (8) is how
  many of the 10 are actually required; the other 2 are optional.
- `battleStep()` / `resolveAttack()` / `afterExchange()` — speed decides
  move order each exchange, `computeDamage()` applies STAB + the
  `TYPE_CHART` matchup multiplier + random variance, either side rotates
  in its next Pokémon on faint. `battle.resolving`/`battle.nextTimerId`
  track whether a round is mid-fire so the Bag can only be opened between
  rounds.
- `openBag()` / `closeBag()` / `usePotion()` / `useRevive()` — pausing the
  auto-battle: opening the bag clears the pending `nextTimerId`; closing it
  reschedules `battleStep()`. Potion heals the active player Pokémon by
  `POTION_HEAL_FRACTION` of max HP; Revive targets
  `battle.lastFaintedPlayerIdx`, restores `REVIVE_HP_FRACTION`, and rewinds
  `battle.pIdx` so it's immediately active again.
- `evolveRandomEligible()` — scans the whole `activeTeam` (not just whoever
  was battling) for any Pokémon with an `EVOLUTIONS[name]` entry, picks one
  at random, and swaps that slot for the evolved species' `POKEMON_BY_NAME`
  entry — preserving `is_shiny` — without ever mutating the shared Pokédex
  objects.
- `endBattle(won)` branches four ways: **Legendary** (win → pushes to
  `storage_`, sets `legendaryHandled='caught'`; lose → `legendaryHandled=
  'fled'`, run is *not* ended); **Elite Four** (win → `eliteIndex++`, gold,
  and on the 4th member sets `runChampion` + awards a Master Ball); **Gym**
  (win → `runBadges++`, adds `battle.trainer.badgeKey` to
  `runBeatenBadges`, gold, calls `evolveRandomEligible()` and stashes the
  result in `pendingEvolution` for the next screen to reveal); **route
  trainer** (win → `runTrainersBeaten++`, gold). Any other loss sets
  `trainerLoss` and ends the run.
- `afterBattle(won)` — a Legendary fight (win or lose) always routes to
  `openPokeStop('legendary')`; any other loss or a completed champion run
  (`runChampion`) goes straight to `finishEncounter()`; an Elite Four win
  opens `openPokeStop('preElite')`; otherwise a route trainer win opens
  `openPokeStop('preGym')` and a Gym Badge win opens `openPokeStop('postGym')`.
- `openPokeStop(mode)` / `renderPokeStop()` / `buyPokeStopItem()` /
  `endRunFromPokeStop()` — one shared screen (`#pokestopScreen`) for four
  contexts (`'preGym'`/`'postGym'`/`'legendary'`/`'preElite'`), just with
  different copy and continue-button behavior. `'preGym'` opens the Gym
  Badge select screen; `'postGym'` routes to the Legendary once
  `runBadges >= BADGES_TO_UNLOCK_ENDGAME`, otherwise to the next encounter;
  `'legendary'` routes to the Elite Four; `'preElite'` routes to the next
  Elite Four member. `POKESTOP_SHOP_ITEMS` are bought with `META.gold` and
  added straight to the current run's `inv`. `openPokeStop()` also pulls
  any `pendingEvolution` into `activeEvolution` so
  `renderEvolutionReveal()` can play the evolve animation for that visit.
- `openTeamManagement()` / `renderTeamManagement()` /
  `depositToStorage(idx)` / `withdrawFromStorage(idx)` — the PokeStop's
  **Computer** button opens this screen (`#teamScreen`) directly; swaps
  Pokémon between `activeTeam` and `storage_`. Deposit is blocked if it
  would empty the active team; withdraw is blocked once
  `activeTeam.length >= MAX_PARTY_SIZE`.
- `finishEncounter()` / `renderResult()` — final card summarizing the whole
  run: score (`computeScore()`: badges×100 + trainers×25 + catches×15 +
  gold), badges/battles-won/caught/gold stat tiles, and the full catch
  list (`activeTeam.slice(1)` + `storage_`, so Storage-only catches like a
  won Legendary still count). Also reveals any leftover `pendingEvolution`.
  Prompts for a name and, on save, `recordRun()` stores the run in the
  local high-score table (`localStorage` key `apex-tamer:best`, top 5 by
  score, per-browser not shared) and reports whether it's a new all-time
  best.
- `itemIconHTML(invKey)` / `ITEM_ICONS` — icon art (`assets/items/*.png`)
  for the 5 items that have matching PNGs (Potion/Revive/Golden
  Feast/Poke Treat/Berry Snack); anything else renders text-only.
- `loadMeta()` / `saveMeta()` — persists `META.gold` across runs in
  `localStorage` key `apex-tamer:meta`; applied when `selectStarter()`
  seeds a new run's `inv`.

## Adjusting the rules

- **Wild choices per encounter / base ball count / shiny odds** —
  `WILD_COUNT`, `BASE_BALL_COUNT`, `SHINY_CHANCE` at the top of `game.js`.
- **Catch-rate data** — `base_species_rate` per species in
  `data/pokemon.json` (regenerate with `augment_catch_rate.py`, or hand-edit
  individual entries for bespoke tuning).
- **Ball modifiers** — `BALL_MODIFIERS` (Pokéball/Great/Ultra/Master).
- **Food items** — `BALL_BASE_FLEE_CHANCE`, and the `FOOD_ITEMS` object
  (cost, catch-chance boost, flee reduction, no-crit-flee per tier).
- **Safari Zone Rock** — `SAFARI_ROCK_COUNT`, `SAFARI_ROCK_SUCCESS_CHANCE`,
  `SAFARI_ROCK_MODIFIER`.
- **Evolution on Gym win** — `data/evolutions.json` (regenerate with
  `fetch_evolutions.py`) plus `evolveRandomEligible()` in `game.js`.
- **Potion/Revive strength** — `POTION_HEAL_FRACTION`, `REVIVE_HP_FRACTION`.
- **Starter list** — the `STARTERS` array.
- **Route trainer strength/size** — `LOW_TIER_MAX_BST`,
  `ROUTE_TRAINER_SQUAD_SIZE`. Trainer names — `TRAINER_ARCHETYPES`.
- **Gym Badges** — the `BADGES` array (10 entries, each with
  `key`/`icon`/`leaderName`/`types`; `icon` must match a file in
  `assets/badges/`) and `BADGES_TO_UNLOCK_ENDGAME` (how many of the 10 are
  actually required).
- **Gym difficulty scaling** — `GYM_DIFFICULTY_TIERS` (8 bands of
  `minBst`/`maxBst`/`squadSize`, indexed by badges earned so far).
- **Elite Four** — the `ELITE_FOUR` array (4 entries, each with
  `name`/`minBst`/`maxBst`/`squadSize`) and `ELITE_GOLD_MIN`/`MAX`.
- **Max party size (also caps Gym/Elite squads)** — `MAX_PARTY_SIZE`.
- **Gold payouts** — `TRAINER_GOLD_MIN`/`MAX`, `GYM_GOLD_MIN`/`MAX`, and
  `ELITE_GOLD_MIN`/`MAX`.
- **Run score formula** — `computeScore()`.
- **Item icon art** — `ITEM_ICONS` maps an inventory key to a filename in
  `assets/items/`.
- **Mid-run PokeStop shop** — the `POKESTOP_SHOP_ITEMS` object (`cost` per
  item; no cap, since these are one-off consumables not permanent
  upgrades).
- **Battle pacing / HP scaling** — the per-turn `setTimeout` delays in
  `battleStep()`/`resolveAttack()`, and the `maxHp` formula in
  `makeBattler()`.
#   D o n d o k o  
 