(function(){

  // ---------- CONFIG ----------
  // Public Supabase project URL + anon key for the global leaderboard.
  // Safe to expose in client-side code: the anon key only grants what the
  // RLS policies on the `scores` table allow (public read + public insert),
  // enforced by Postgres itself. See supabase/schema.sql for those policies.
  const SUPABASE_URL = "https://azhhuhzbfuyuuwtykegm.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6aGh1aHpiZnV5dXV3dHlrZWdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1OTc2NTMsImV4cCI6MjEwMDE3MzY1M30._WMBHrCEDRUmKAZORzIUHdm1isjQRrc_ZOH4gMfTA7M";
  const supabaseClient = (typeof window !== 'undefined' && window.supabase)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
  // Exposed globally so run_saves.js (a separate, non-module script) can
  // reuse this exact client instance — no second client, no duplicated keys.
  if(typeof window !== 'undefined') window.supabaseClient = supabaseClient;

  const TYPE_COLOR = {
    normal:"#A8A878", fire:"#F08030", water:"#6890F0", electric:"#F8D030",
    grass:"#78C850", ice:"#98D8D8", fighting:"#C03028", poison:"#A040A0",
    ground:"#E0C068", flying:"#A890F0", psychic:"#F85888", bug:"#A8B820",
    rock:"#B8A038", ghost:"#705898", dragon:"#7038F8", dark:"#705848",
    steel:"#B8B8D0", fairy:"#EE99AC",
  };

  // Standard type effectiveness chart: TYPE_CHART[moveType][defenderType] = multiplier.
  // Omitted pairs default to 1x.
  const TYPE_CHART = {
    normal:{ rock:0.5, ghost:0, steel:0.5 },
    fire:{ fire:0.5, water:0.5, grass:2, ice:2, bug:2, rock:0.5, dragon:0.5, steel:2 },
    water:{ fire:2, water:0.5, grass:0.5, ground:2, rock:2, dragon:0.5 },
    electric:{ water:2, electric:0.5, grass:0.5, ground:0, flying:2, dragon:0.5 },
    grass:{ fire:0.5, water:2, grass:0.5, poison:0.5, ground:2, flying:0.5, bug:0.5, rock:2, dragon:0.5, steel:0.5 },
    ice:{ fire:0.5, water:0.5, grass:2, ice:0.5, ground:2, flying:2, dragon:2, steel:0.5 },
    fighting:{ normal:2, ice:2, poison:0.5, flying:0.5, psychic:0.5, bug:0.5, rock:2, ghost:0, dark:2, steel:2, fairy:0.5 },
    poison:{ grass:2, poison:0.5, ground:0.5, rock:0.5, ghost:0.5, steel:0, fairy:2 },
    ground:{ fire:2, electric:2, grass:0.5, poison:2, flying:0, bug:0.5, rock:2, steel:2 },
    flying:{ electric:0.5, grass:2, fighting:2, bug:2, rock:0.5, steel:0.5 },
    psychic:{ fighting:2, poison:2, psychic:0.5, dark:0, steel:0.5 },
    bug:{ fire:0.5, grass:2, fighting:0.5, poison:0.5, flying:0.5, psychic:2, ghost:0.5, dark:2, steel:0.5, fairy:0.5 },
    rock:{ fire:2, ice:2, fighting:0.5, ground:0.5, flying:2, bug:2, steel:0.5 },
    ghost:{ normal:0, psychic:2, ghost:2, dark:0.5 },
    dragon:{ dragon:2, steel:0.5, fairy:0 },
    dark:{ fighting:0.5, psychic:2, ghost:2, dark:0.5, fairy:0.5 },
    steel:{ fire:0.5, water:0.5, electric:0.5, ice:2, rock:2, steel:0.5, fairy:2 },
    fairy:{ fire:0.5, fighting:2, poison:0.5, dragon:2, dark:2, steel:0.5 },
  };

  const STARTERS = [
    "bulbasaur","charmander","squirtle",
    "chikorita","cyndaquil","totodile",
    "treecko","torchic","mudkip",
    "turtwig","chimchar","piplup",
    "snivy","tepig","oshawott",
    "chespin","fennekin","froakie",
    "rowlet","litten","popplio",
    "grookey","scorbunny","sobble",
    "sprigatito","fuecoco","quaxly",
  ];

  // Exactly 8 archetypes — one per portrait we have art for (see
  // TRAINER_PORTRAIT_FILE below). Which one gets rolled for a given route
  // trainer fight is still random; more can be added once more portraits exist.
  const TRAINER_ARCHETYPES = [
    "Ace Trainer Nadia","School Kid Alan","Lass Dana","Cooltrainer Mia",
    "Hiker Anthony","Sailor Hank","Picnicker Erin","Rising Star Theo",
  ];

  // Portrait art files are named to exactly match a trainer's display name
  // (e.g. "Ace Trainer Nadia" -> "Ace Trainer Nadia.png") — no lookup table
  // needed. Which archetype gets rolled for a given encounter is still
  // random (see rollTrainer()), but once rolled, a given name always shows
  // the same face, every run. Gym Leaders and Cruise Ship crew don't have
  // art yet, so their opponent objects simply have no `portraitFile` —
  // trainerPortraitHTML() already renders nothing in that case.
  const TRAINER_PORTRAIT_DIR = "assets/trainers";
  function trainerPortraitFile(trainerName){
    return `${trainerName}.png`;
  }
  // Elite Four art is filed under a short name only (e.g. "Corvax.png"),
  // stripping the "Elite Four " prefix and any ", the Unbeaten"-style suffix.
  function eliteFourPortraitFile(tierName){
    const shortName = tierName.replace(/^Elite Four /, '').split(',')[0].trim();
    return `${shortName}.png`;
  }
  function trainerPortraitHTML(opponent){
    return opponent.portraitFile
      ? `<img class="trainer-portrait" src="${TRAINER_PORTRAIT_DIR}/${encodeURIComponent(opponent.portraitFile)}" alt="" onerror="this.style.display='none'">`
      : '';
  }

  // 10 Gym Badges, each themed to a type (or type pair) with matching badge
  // art. The player freely picks which to challenge each loop — each can
  // only be challenged (and beaten) once per run. Only 8 of the 10 are
  // needed to advance to the Legendary + Elite Four; the other 2 are
  // optional extra challenges.
  const BADGES = [
    { key:"normal",        icon:"normal.png",        leaderName:"Gym Leader Doran",  types:["normal"] },
    { key:"fire",          icon:"fire.png",           leaderName:"Gym Leader Ember",  types:["fire"] },
    { key:"water",         icon:"water.png",          leaderName:"Gym Leader Marin",  types:["water"] },
    { key:"electric",      icon:"eletric.png",        leaderName:"Gym Leader Volt",   types:["electric"] },
    { key:"grass-poison",  icon:"grass-poison.png",   leaderName:"Gym Leader Thistle", types:["grass","poison"] },
    { key:"fairy",         icon:"fairy.png",          leaderName:"Gym Leader Lumen",  types:["fairy"] },
    { key:"ice-flying",    icon:"ice-flying.png",     leaderName:"Gym Leader Gale",   types:["ice","flying"] },
    { key:"ghost-psychic", icon:"ghost-psychic.png",  leaderName:"Gym Leader Nyx",    types:["ghost","psychic"] },
    { key:"steel-dark",    icon:"steel-dark.png",     leaderName:"Gym Leader Rook",   types:["steel","dark"] },
    { key:"dragon",        icon:"Dragon.png",         leaderName:"Gym Leader Wyrm",   types:["dragon"] },
  ];
  const BADGE_ICON_DIR = "assets/badges";

  // Difficulty scales with how many badges the player has already earned
  // this run (index = runBadges at challenge time), not with which specific
  // badge is picked — so badge #1 you choose is always easy, badge #8 is
  // always hard, regardless of type. Squad size is still capped by the
  // player's own party size at battle time.
  const GYM_DIFFICULTY_TIERS = [
    { minBst:280, maxBst:360, squadSize:2 },
    { minBst:320, maxBst:400, squadSize:2 },
    { minBst:360, maxBst:440, squadSize:3 },
    { minBst:400, maxBst:470, squadSize:3 },
    { minBst:430, maxBst:500, squadSize:4 },
    { minBst:460, maxBst:530, squadSize:4 },
    { minBst:490, maxBst:560, squadSize:5 },
    { minBst:520, maxBst:600, squadSize:6 },
  ];

  // Unlocks right after the player's 8th badge (any 8 of the 10) — a
  // one-time Legendary encounter, then the Elite Four gauntlet. The
  // remaining 2 badges (if any) are never required.
  const BADGES_TO_UNLOCK_ENDGAME = 8;

  // Elite Four: four brutal, full 6-vs-6 battles fought back to back.
  // Not type-locked — these squads are the toughest, most varied Pokémon
  // in the pool. Beating all 4 makes the player Champion.
  // BST bands here must stay wide enough to actually contain 6+ unique
  // non-legendary Pokémon — the old bands (550-620 up to 610-690) narrowed
  // so hard toward the top that the last tier matched exactly ONE Pokémon
  // in the whole dex (Slaking, 670 BST), which is why every run saw a
  // 1-Pokémon "full squad" for the final member. Non-legendary BST tops out
  // around 600 (a cluster of pseudo-legendaries: Dragonite, Tyranitar,
  // Garchomp, etc.), so the bands below rise in floor, not ceiling, to keep
  // a rich pool at every tier while still escalating difficulty — the last
  // member's 550-600 band pulls from that top pseudo-legendary cluster.
  // The last 3 members ramp up noticeably harder than Corvax — bands verified
  // against the real non-legendary BST distribution (931 candidates, tops out
  // at 670/Slaking) so even Ilyra's 580-650 band still has enough unique,
  // non-Paradox Pokémon to fill a repeat-free 6-Pokémon squad.
  const ELITE_FOUR = [
    { name:"Elite Four Corvax",  minBst:480, maxBst:560, squadSize:6 },
    { name:"Elite Four Seraphine", minBst:520, maxBst:590, squadSize:6 },
    { name:"Elite Four Draven",  minBst:550, maxBst:610, squadSize:6 },
    { name:"Elite Four Ilyra, the Unbeaten", minBst:580, maxBst:650, squadSize:6 },
  ];
  const ELITE_GOLD_MIN = 31; // per Pokémon defeated — Elite Four squads are always full (6); +65%
  const ELITE_GOLD_MAX = 46;
  // Scarlet & Violet's Paradox Pokémon (10 Ancient, 10 Future) are strong
  // enough to qualify by BST alone and some share dex entries with
  // legendaries, so they're excluded everywhere a wild/trainer Pokémon is
  // picked (see wildPool()) as well as from Elite Four squads below.
  const PARADOX_POKEMON = [
    "great-tusk","scream-tail","brute-bonnet","flutter-mane","slither-wing",
    "sandy-shocks","roaring-moon","walking-wake","gouging-fire","raging-bolt",
    "iron-treads","iron-bundle","iron-hands","iron-jugulis","iron-moth",
    "iron-thorns","iron-valiant","iron-leaves","iron-boulder","iron-crown",
  ];

  // Mythicals in the dataset are just legendary:true entries like any other
  // — this list is what actually separates them out for their own dedicated
  // encounter (see startMythicalBattle()), and excludes them from the true
  // Legendary encounter's pool so the two never overlap. Default/base forms
  // are used where a Pokémon only exists as named variants (e.g. Deoxys).
  const MYTHICAL_POKEMON = [
    "mew","celebi","jirachi","deoxys-normal","manaphy","darkrai","shaymin-land",
    "arceus","victini","keldeo-ordinary","meloetta-aria","genesect","diancie",
    "hoopa","volcanion","magearna","marshadow","zeraora","meltan","melmetal",
    "zarude","pecharunt",
  ];

  // ---------- CRUISE SHIP (mandatory endgame event, free — see below) ----------
  // Right after the Legendary encounter (and before the Elite Four), the
  // player is handed a free ticket and boards immediately: 3 water-type
  // battles of rising difficulty, each followed by a "Cruise Casino"
  // PokeStop (Fishing + Slot Machine mini-events on top of the normal shop),
  // then a Rival battle before finally moving on.
  // The last battle is against Captain Sereia, who runs the ship — beating
  // her rewards a Mega Stone.
  const CRUISE_SHIP_BATTLES = [
    { name:"Deckhand Milo",      minBst:300, maxBst:380, squadSize:2 },
    // A real Double Battle: exactly 2 Pokémon a side, both active and
    // fighting simultaneously — see startDoubleBattle()/doubleBattleStep().
    { name:"First Mate Talise",  minBst:420, maxBst:500, squadSize:2, isDouble:true },
    { name:"Captain Sereia",     minBst:520, maxBst:600, squadSize:4, isCaptain:true },
  ];
  const CRUISE_RIVAL = { name:"Fukugawa", minBst:480, maxBst:580, squadSize:6 };
  const CRUISE_GOLD_MIN = 45; // per Pokémon defeated; +65%
  const CRUISE_GOLD_MAX = 66;
  const RIVAL_GOLD_MIN = 107; // per Pokémon defeated; +65%
  const RIVAL_GOLD_MAX = 162;

  // JRPG-style dialogue shown right before the Rival battle.
  const RIVAL_DIALOGUE = [
    "So... you actually made it this far. I'm almost impressed.",
    "But this is where your little adventure hits a wall, right here, on this ship.",
    "Let's settle this. No holding back!",
  ];

  const FISHING_CASTS = 7;
  const NUZLOCKE_FISHING_CASTS = 3; // fewer chances at a rare catch, matches the mode's tighter economy
  const FISHING_CATCH_CHANCE = 0.225; // per cast — 0.18 + 25%, rare, but noticeably better odds than a shiny

  // ---------- SAFARI ZONE (instant mini-event, bought at the PokeStop) ----------
  // Unlike the Cruise Ship Ticket, this fires immediately on purchase: 3
  // back-to-back single-target catch encounters using their own dedicated
  // Safari Balls/Berries/Rocks (not the player's real inventory), then
  // straight back to the same PokeStop screen they bought it from.
  const SAFARI_TICKET_COST = 250;
  const SAFARI_BALL_COUNT = 25;
  const SAFARI_BERRY_COUNT = 5;
  const SAFARI_ROCK_COUNT = 3;
  const SAFARI_ENCOUNTERS = 3;
  const SAFARI_BALL_MODIFIER = 1.0;
  const SAFARI_BERRY_BOOST = 1.3;
  const SAFARI_FLEE_CHANCE = 0.15;

  // ---------- MEGA EVOLUTION ----------
  // The only way to get one: the Mega Stone reward from beating Captain
  // Sereia, used deliberately from the Computer screen on any eligible
  // active-team member (see useMegaStone()). No passive/automatic chance —
  // Mega Evolution is a one-shot, player-chosen upgrade.

  const IMG_DIR = "pokemon_png_reduzido/official-artwork";
  const IMG_DIR_SHINY = "pokemon_png_reduzido/official-artwork-shiny";
  const WILD_COUNT = 12; // shown as three rows of 4
  // "Easy" wild Pokémon = a high base_species_rate (top ~44% of the non-legendary
  // pool). The first 2 encounters draw only from this pool; from encounter 3 on,
  // easy slots progressively give way to the unrestricted pool (which can include
  // rarer, lower catch-rate, higher-BST Pokémon), so difficulty ramps with progress.
  // Lowered from 0.3 — widens the early-game pool (~469 -> ~590 species)
  // so the "100%-easy" opening encounters (and the generation-diversity
  // fallback below) have more raw variety to draw from, on top of the
  // cross-run cooldown in freshWildPool() — the two together are meant to
  // fix "every run's early encounters look the same".
  const EASY_CATCH_RATE_MIN = 0.2;
  const ALL_EASY_ENCOUNTERS = 2;   // encounters 1 and 2 are 100% easy pool
  const MIN_EASY_SLOTS = 1;        // never fully removes the easy option
  // Past 4 badges, wild encounters skew further toward rarer, stronger
  // catches: 1 fewer easy slot, and non-easy slots preferentially pull from
  // this high-BST pool instead of the fully unrestricted one.
  const BADGES_FOR_RARITY_RAMP = 4;
  const WILD_STRONG_MIN_BST = 420;
  const BASE_BALL_COUNT = 3;
  const STARTING_GOLD = 50;
  const BASE_REROLL_COUNT = 1; // free wild-encounter rerolls per run (more buyable at the PokeStop)
  const NATIONAL_DEX_MAX = 1025; // excludes megas/gmax/regional-form duplicates from the pool
  const LOW_TIER_MAX_BST = 320; // caps how strong a route trainer's Pokémon can be
  const FIRST_TRAINER_MAX_BST = 220; // extra-easy cap for the player's very first route trainer fight
  const ROUTE_TRAINER_SQUAD_SIZE = 1; // route trainers are a quick single-Pokémon fight
  const ROUTE_TRAINER_MAX_SQUAD = 3; // cap even late-run route trainers well below a full team
  // Encounters 2-4 get a beefed-up squad instead of the usual 1, a random
  // 3 or 4, ignoring the player's-party-size cap below (so it's guaranteed
  // every run, not just when the player has already caught enough Pokémon).
  const BEEFED_UP_ROUTE_ENCOUNTERS = [2, 3, 4];
  const BEEFED_UP_ROUTE_MIN_SQUAD = 3;
  const BEEFED_UP_ROUTE_MAX_SQUAD = 4;
  // The last 3 route trainers of the run (4, 5, then 6 Pokémon squads) also
  // ramp up in raw strength, not just headcount — each tier's BST band is
  // stronger than the last, so the 6-Pokémon trainer right before badge 8 is
  // the toughest route trainer the player faces all run.
  const ROUTE_FINAL_STRETCH_TIERS = [
    { minBst:280, maxBst:360 }, // 4-Pokémon squad
    { minBst:320, maxBst:430 }, // 5-Pokémon squad
    { minBst:380, maxBst:500 }, // 6-Pokémon squad — hardest route trainer of the run
  ];
  const MAX_PARTY_SIZE = 6; // active roster cap — overflow catches go to Storage
  const FALLBACK_MOVE = { name:"tackle", type:"normal", power:40, accuracy:100, damage_class:"physical" };
  const SHINY_CHANCE = 1/512;

  // Rare "stumbled upon something" event — rolled once per encounter, on
  // roughly the same order of rarity as running into a shiny (6 shiny rolls
  // per encounter at 1/512 each ≈ 1/85 aggregate chance of a shiny showing up).
  const ITEM_EVENT_CHANCE = 1/80;
  const FOUND_ITEM_POOL = [
    { invKey:'balls',       label:'Pokéballs',    min:2, max:3 },
    { invKey:'greatBalls',  label:'Great Balls',  min:1, max:2 },
    { invKey:'ultraBalls',  label:'Ultra Balls',  min:1, max:1 },
    { invKey:'berrySnack',  label:'Berry Snacks', min:1, max:2 },
    { invKey:'pokeTreat',   label:'Poke Treats',  min:1, max:1 },
    { invKey:'potions',     label:'Potions',      min:1, max:2 },
    { invKey:'revives',     label:'Revives',      min:1, max:1 },
  ];

  // Lucky Spin — a one-shot-per-run mini-event inside the Cruise Casino (see
  // below): a prize wheel, not a slot machine (that's the separate, full
  // Token Casino reachable from the main PokeStop menu). Picked with
  // pickWeighted() (like the Token Casino's reel symbols) rather than a
  // flat 1-in-N — `weight` controls both the odds and how big a slice of
  // the wheel it gets, computed by buildLuckyWheelGradient() at render time
  // (startDeg/centerDeg/endDeg are filled in there, not hand-authored here).
  // 2 separate "Nothing" entries (rather than one 2x-weighted one) so they
  // show as distinct slices around the wheel instead of one big dead zone.
  // Key Prize mirrors the Token Casino's Token Exchange (tokenExchangePool())
  // — a random shiny, fully-evolved Pokémon — at a much lower weight than
  // everything else, same "rare jackpot" spirit.
  const LUCKY_SPIN_OUTCOMES = [
    // Half the odds of every normal slice (5 vs 10) — a much bigger payout
    // (1000G, was 100G) earns the rarer odds.
    { key:'gold',      label:'1000G',    weight:5,  color:'var(--lime)' },
    { key:'revive',    label:'1x Revive',weight:10, color:'var(--water)' },
    { key:'starter',   label:'1x Starter', weight:10, color:'#ffd447' },
    { key:'nothing',   label:'Nothing',  weight:10, color:'#3a3a3a' },
    { key:'potion',    label:'1x Potion',weight:10, color:'#1a6fa8' },
    { key:'nothing',   label:'Nothing',  weight:10, color:'#3a3a3a' },
    // Also half the odds of the other normal slices, same as gold above.
    { key:'spinAgain', label:'Spin Again', weight:5, color:'#ffffff' },
    // Vivid/neon on purpose — this slice is meant to catch the eye even
    // though it's by far the smallest on the wheel (see weight below).
    { key:'keyPrize',  label:'Key Prize', weight:1, color:'#ff00e5' },
  ];
  const LUCKY_SPIN_EXTRA_TURNS = 5; // full rotations before landing, just for visual flourish

  // Lays out LUCKY_SPIN_OUTCOMES around the wheel proportional to `weight`
  // (bigger weight = bigger slice = better odds, all consistent with each
  // other), stamping startDeg/centerDeg/endDeg onto each outcome object for
  // spinLuckyWheel() to use, and returns the conic-gradient stop list.
  function buildLuckyWheelGradient(){
    const totalWeight = LUCKY_SPIN_OUTCOMES.reduce((sum,o) => sum + o.weight, 0);
    let cursor = 0;
    return LUCKY_SPIN_OUTCOMES.map(o => {
      const startDeg = cursor / totalWeight * 360;
      cursor += o.weight;
      const endDeg = cursor / totalWeight * 360;
      o.startDeg = startDeg;
      o.endDeg = endDeg;
      o.centerDeg = (startDeg + endDeg) / 2;
      return `${o.color} ${startDeg}deg ${endDeg}deg`;
    }).join(', ');
  }

  function renderLuckyWheelLegend(){
    const el = document.getElementById('luckyWheelLegend');
    if(!el) return;
    // One chip per distinct label — collapses the 3 "Nothing" slices (and
    // any other repeats) into a single legend entry instead of listing it 3 times.
    const seen = new Set();
    el.innerHTML = LUCKY_SPIN_OUTCOMES.filter(o => {
      if(seen.has(o.label)) return false;
      seen.add(o.label);
      return true;
    }).map(o => `<span class="lucky-wheel-legend-chip"><span class="lucky-wheel-legend-dot" style="background:${o.color};"></span>${o.label}</span>`).join('');
  }

  // ---------- POKESTOP CASINO (Token Slot Machine + Token Shop) ----------
  // Separate from the Cruise Casino above — unlocked once the endgame opens
  // (8th badge, or reaching the Cruise Ship, whichever comes first) and
  // reachable from every PokeStop visit from then on. Spins cost Gold;
  // payouts are a separate currency (Tokens) spent in the Token Shop below.
  const CASINO_SPIN_COST_GOLD = 50; // same cost per roll carried over from the old slot machine
  // Free Tokens for clearing a "boss" fight — Gym Leader, Rival, the Cruise
  // Ship's Captain, or an Elite Four member — on top of whatever the Token
  // Slot Machine pays out. See afterBattle().
  const CASINO_TOKENS_PER_BOSS_WIN = 5;
  const DICE_LOCK_INTERVAL = 650; // ms between each die locking, left to right
  const DICE_CYCLE_MS = 70; // how fast a die's face flickers while still "rolling"
  // Drawn as a 3x3 pip grid (see dieFaceHTML()) rather than a Unicode die
  // character (⚀-⚅) — those render as an unreadable placeholder glyph in
  // some fonts, illegible at any size. true = pip lit, index 0-8 reading
  // left-to-right, top-to-bottom (4 = center).
  const DICE_PIP_LAYOUTS = {
    1: [0,0,0, 0,1,0, 0,0,0],
    2: [1,0,0, 0,0,0, 0,0,1],
    3: [1,0,0, 0,1,0, 0,0,1],
    4: [1,0,1, 0,0,0, 1,0,1],
    5: [1,0,1, 0,1,0, 1,0,1],
    6: [1,0,1, 1,0,1, 1,0,1],
  };
  function dieFaceHTML(value){
    return DICE_PIP_LAYOUTS[value].map(on => `<span class="die-pip${on ? ' on' : ''}"></span>`).join('');
  }
  const DICE_PAYOUTS = { triple6:300, triple1:100, triple:30, straight:15, pair:6, none:0 };

  // Casino Token Shop — spend Tokens earned from the slot machine. The
  // Token Exchange is deliberately the priciest, hardest-to-reach item: a
  // random shiny, fully-evolved (non-Mythical, non-Legendary) Pokémon.
  // Prices rebased for the Lucky Dice mini-game's much higher EV/roll than
  // the old slot machine had (~6.6 vs ~0.39 Tokens per spin) — scaled to
  // keep the same relative reach as before against the new, larger typical
  // Token pool, not a flat multiple of the old prices.
  const TOKEN_SHOP_ITEMS = {
    potions: { label:"Potion", invKey:"potions", cost:85, desc:"" },
    revives: { label:"Revive", invKey:"revives", cost:135, desc:"" },
    tokenExchange: { label:"Key Prize", cost:250, isExchange:true, desc:"Sparkly." },
  };

  // Safari Zone Rock: risky pre-throw action (see SAFARI ZONE section below) —
  // on success it boosts the next Safari Ball throw; on failure the target flees.
  const SAFARI_ROCK_SUCCESS_CHANCE = 0.55;
  const SAFARI_ROCK_MODIFIER = 1.3;
  const BALL_BASE_FLEE_CHANCE = 0.15; // baseline chance a failed ball throw lets the target flee outright
  // Gold per battle now scales with the actual squad size fielded (see
  // computeBattleGold()) — these are per-Pokémon-defeated ranges, calibrated
  // so the old flat per-battle averages still roughly hold at typical squad sizes.
  const TRAINER_GOLD_MIN = 23; // +65%
  const TRAINER_GOLD_MAX = 35;
  const TRAINER_BALL_REWARD = 1; // every route trainer win also grants a free Pokéball
  // From the 3rd route trainer win onward, each subsequent route-trainer win
  // (never Gym/Elite/Cruise/Rival) has this chance to offer a 1-for-1 trade
  // — see the afterBattle() hook and openTradeOffer().
  const TRADE_OFFER_CHANCE = 0.35;
  const TRADE_OFFER_MIN_TRAINERS_BEATEN = 3;
  const GYM_GOLD_MIN = 30; // Gym Leader wins pay out more than route trainers; +65%
  const GYM_GOLD_MAX = 45;
  const POTION_HEAL_FRACTION = 0.5;  // heals this fraction of max HP
  const REVIVE_HP_FRACTION = 0.5;    // revived Pokémon comes back at this fraction of max HP
  // Per-battle usage caps — independent of how many the player is carrying
  // in inv.potions/inv.revives (see battle.potionsUsedThisBattle /
  // battle.revivesUsedThisBattle, reset whenever a battle starts).
  const MAX_POTIONS_PER_BATTLE = 2;
  const MAX_REVIVES_PER_BATTLE = 1;
  // Single battles only (Doubles have no bench to switch in from — see
  // startDoubleBattle()). Separate from the *forced* faint switch
  // (battle.awaitingSwitch/switchActivePokemon()), which is unlimited —
  // this caps voluntarily pulling out a still-healthy Pokémon.
  const MAX_VOLUNTARY_SWITCHES_PER_BATTLE = 1;
  // How long the player has to tap Potion/Revive between auto-battle turns
  // (was a flat 700ms gap — now that plus 1 extra second of reaction time).
  const ITEM_WINDOW_MS = 700 + 1000;

  // Ball throw modifiers — multiply directly against the target's base_species_rate.
  // Master Ball bypasses the formula entirely (guaranteed catch).
  const BALL_MODIFIERS = { balls:1.0, greatBalls:1.5, ultraBalls:2.0, masterBalls:Infinity };
  const BALL_LABELS = { balls:"Pokéball", greatBalls:"Great Ball", ultraBalls:"Ultra Ball", masterBalls:"Master Ball" };

  // Food items: single-use, stackable, bought at the PokeStop. Each boost is a
  // multiplicative catch-chance modifier; flee reduction only matters on a
  // failed throw (see BALL_BASE_FLEE_CHANCE).
  const FOOD_ITEMS = {
    berrySnack:  { label:"Berry Snack",  cost:50,  boost:1.10, fleeReduction:0,    noCritFlee:false },
    // Buffed relative to Berry Snack: at 3x the cost it should feel like a
    // real premium pick, not a marginal upgrade — 1.5x catch chance (was
    // 1.25x) and flee reduction raised to fully cancel BALL_BASE_FLEE_CHANCE
    // (0.15), so a failed throw can never lose the target outright this encounter.
    pokeTreat:   { label:"Poke Treat",   cost:150, boost:1.5, fleeReduction:0.15, noCritFlee:false },
  };

  // PokeStop shop (mid-run): one-off consumables added straight to the current run's inventory.
  // `category` sorts each item into one of the PokeStop's 3 shop tabs.
  const POKESTOP_SHOP_ITEMS = {
    balls:       { label:"Pokéball",     invKey:"balls",       cost:10,  category:"balls", desc:"Round and classic." },
    greatBalls:  { label:"Great Ball",   invKey:"greatBalls",  cost:25,  category:"balls", desc:"Still round." },
    ultraBalls:  { label:"Ultra Ball",   invKey:"ultraBalls",  cost:45,  category:"balls", desc:"More rounder I guess.." },
    berrySnack:  { label:"Berry Snack",  invKey:"berrySnack",  cost:50,  category:"items", desc:"Small catch-chance boost for one throw." },
    pokeTreat:   { label:"Poke Treat",   invKey:"pokeTreat",   cost:150, category:"items", desc:"Big 1.5x catch boost, target won't flee on a miss." },
    potions:     { label:"Potion",       invKey:"potions",     cost:15,  category:"items", lifetimeMax:8, desc:"Heals a Pokémon for half its max HP." },
    revives:     { label:"Revive",       invKey:"revives",     cost:30,  category:"items", lifetimeMax:3, desc:"Brings a fainted Pokémon back at half HP." },
    rerollTickets: { label:"Reroll Ticket", invKey:"rerollTickets", cost:40, category:"others", desc:"Rerolls the current wild encounter list." },
    safariTicket: { label:"Safari Zone Ticket", invKey:"safariTicket", cost:SAFARI_TICKET_COST, category:"others", instant:true, lockAfterBadges:8, desc:"One-time entry into the Safari Zone Sanctuary." },
  };
  // PokeStop prices scale with game mode, relative to Classic's listed cost
  // above (Nuzlocke's 1.5x is not stacked on top of Pro's 1.2x, each mode's
  // multiplier applies independently to the same base numbers).
  const SHOP_PRICE_MULTIPLIER = { classic:1, pro:1.2, nuzlocke:1.5 };
  function shopPrice(item){
    return Math.round(item.cost * (SHOP_PRICE_MULTIPLIER[gameMode] || 1));
  }

  const SHOP_TABS = [
    { key:"balls",  label:"Pokéballs" },
    { key:"items",  label:"Itens" },
    { key:"others", label:"Tickets" },
  ];

  // Icon art for the items we have matching PNGs for (assets/items/*.png).
  // Anything not listed here just renders with its text label, no icon.
  const ITEM_ICON_DIR = "assets/items";
  const ITEM_ICONS = {
    potions:     "potion.png",
    revives:     "revive.png",
    pokeTreat:   "poketreat.png",
    berrySnack:  "berry.png",
    masterBalls: "masterball.png",
    rerollTickets: "Reroll-ticket.png",
    safariTicket: "safari-ticket.png",
    computer: "Computer.png",
    tokenExchange: "Prize.png",
  };
  function itemIconHTML(invKey){
    const file = ITEM_ICONS[invKey];
    return file ? `<img class="item-icon" src="${ITEM_ICON_DIR}/${file}" alt="" onerror="this.style.display='none'">` : '';
  }

  // ---------- DATA (populated from /data/*.json) ----------
  let POKEMON = [];       // {id, name, types, bst, legendary, hp, attack, defense, sp_atk, sp_def, speed, base_species_rate}
  let POKEMON_BY_NAME = {};
  let MOVESETS = {};      // name -> [{name,type,power,accuracy,damage_class}, ...]
  // name -> next evolution's name, or an array of names for branching evolutions
  // (absent if none) — see evolutionOptionsFor(). Branches here are always
  // resolved by an equal-weight random roll (evolveRandomEligible()); there's
  // no player choice for a normal evolution, only for Mega Evolution below.
  let EVOLUTIONS = {};
  // base species name -> [mega form names], e.g. "charizard" -> ["charizard-mega-x","charizard-mega-y"].
  // Unlike EVOLUTIONS, a base with more than one Mega form here always means
  // the player picks which one via a popup (see openMegaFormChoice()) — Mega
  // Evolution is a deliberate, Mega-Stone-gated action, never a random roll.
  let MEGA_FORMS_BY_BASE = {};
  let STARTER_LINE_NAMES = new Set(); // every starter's base + stage1 + stage2 names — see loadData()
  // Base species names (e.g. "wormadam", "golem") that have 2+ *reachable*
  // alternate forms in this game — used only by displayName()'s generic
  // form-suffix handling, see loadData(). A base NOT in here means whatever
  // single form of it exists here is the only one the player can ever get,
  // so its slug suffix (e.g. "-disguised", "-full-belly") is just dropped
  // instead of shown as a pointless "(Form)".
  let MULTI_FORM_BASES = new Set();

  async function loadData(){
    const [list, movesets, evolutions] = await Promise.all([
      fetch('data/pokemon.json').then(r => r.json()),
      fetch('data/battle_moves.json').then(r => r.json()),
      fetch('data/evolutions.json').then(r => r.json()).catch(() => ({})),
    ]);
    POKEMON = list;
    POKEMON_BY_NAME = {};
    list.forEach(p => { POKEMON_BY_NAME[p.name] = p; });
    MOVESETS = movesets;
    EVOLUTIONS = evolutions;

    // data/battle_moves.json only ever kept attacking moves (nonzero power),
    // so none of the mainline games' real sleep-inducing moves — Sleep
    // Powder, Spore, Hypnosis, Sing, Lovely Kiss — are pure status moves
    // with 0 power, so they never made it in. Sleep only exists as a
    // mechanic once *something* can inflict it, so this hand-injects each
    // one onto its classic canon species (only if that species' moveset
    // was loaded and doesn't already have it) — see SLEEP_MOVE_DEFS /
    // MOVE_STATUS_EFFECTS for the rest of how Sleep itself works.
    Object.entries(SLEEP_MOVE_INJECTIONS).forEach(([species, moveName]) => {
      const set = MOVESETS[species];
      if(set && !set.some(m => m.name === moveName)){
        MOVESETS[species] = [...set, SLEEP_MOVE_DEFS[moveName]];
      }
    });

    // Mega forms with no generated artwork (neither normal nor shiny) — kept
    // out of MEGA_FORMS_BY_BASE below so Mega Evolution can never pick one.
    const MEGA_FORMS_MISSING_ART = new Set(["tatsugiri-curly-mega", "tatsugiri-droopy-mega"]);

    MEGA_FORMS_BY_BASE = {};
    list.forEach(p => {
      if(MEGA_FORMS_MISSING_ART.has(p.name)) return;
      let base = null;
      if(/-mega-(x|y|z)$/.test(p.name)) base = p.name.replace(/-mega-(x|y|z)$/, '');
      else if(p.name.endsWith('-mega')) base = p.name.slice(0, -5);
      if(base && POKEMON_BY_NAME[base]){
        (MEGA_FORMS_BY_BASE[base] = MEGA_FORMS_BY_BASE[base] || []).push(p.name);
      }
    });

    // Every starter's full line (base + stage 1 + stage 2) — none of these
    // can ever be caught, so the player's starter always feels unique. Walks
    // EVOLUTIONS forward exactly 2 steps from each of the 27 starter names.
    STARTER_LINE_NAMES = new Set();
    let stage = [...STARTERS];
    stage.forEach(n => STARTER_LINE_NAMES.add(n));
    for(let i = 0; i < 2; i++){
      const next = [];
      stage.forEach(name => {
        const raw = EVOLUTIONS[name];
        if(!raw) return;
        const options = Array.isArray(raw) ? raw : [raw];
        options.forEach(o => {
          if(POKEMON_BY_NAME[o] && !STARTER_LINE_NAMES.has(o)){
            STARTER_LINE_NAMES.add(o);
            next.push(o);
          }
        });
      });
      stage = next;
    }

    // A species name is "reachable" for this purpose if it can directly
    // appear in the wild (national-dex range, covers legendaries/mythicals
    // too since they get their own dedicated encounter pools) or shows up
    // as an evolution/regional-form-branch result — see displayName().
    const reachableNames = new Set();
    POKEMON.forEach(p => { if(p.id <= NATIONAL_DEX_MAX) reachableNames.add(p.name); });
    Object.values(EVOLUTIONS).forEach(v => (Array.isArray(v) ? v : [v]).forEach(n => reachableNames.add(n)));
    Object.values(REGIONAL_EVOLUTION_ALT).forEach(arr => arr.forEach(n => reachableNames.add(n)));

    const formNameCounts = {};
    reachableNames.forEach(name => {
      const dash = name.indexOf('-');
      if(dash <= 0) return;
      if(NAME_EXACT_OVERRIDES[name] || HYPHEN_IS_OFFICIAL_NAME.has(name) || COMPOUND_NAME_SLUGS.has(name)) return;
      if(/-mega(-(x|y|z))?$/.test(name)) return; // Mega handled by its own registry, not this one
      const base = name.slice(0, dash);
      formNameCounts[base] = (formNameCounts[base] || 0) + 1;
    });
    MULTI_FORM_BASES = new Set(Object.keys(formNameCounts).filter(base =>
      formNameCounts[base] >= 2 || reachableNames.has(base)
    ));
  }

  function rand(a,b){ return Math.random()*(b-a)+a; }
  function randInt(a,b){ return Math.floor(rand(a, b + 1)); } // inclusive both ends
  function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }
  function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
  function pickN(arr, n){
    const pool = [...arr];
    const out = [];
    while(out.length < n && pool.length){
      const i = Math.floor(Math.random()*pool.length);
      out.push(pool.splice(i,1)[0]);
    }
    return out;
  }
  function pickWeighted(items){
    const total = items.reduce((sum,i) => sum + i.weight, 0);
    let roll = Math.random() * total;
    for(const item of items){
      roll -= item.weight;
      if(roll <= 0) return item;
    }
    return items[items.length - 1];
  }
  function initials(name){ return name.split(/[\s-]+/).map(w=>w[0]).slice(0,2).join('').toUpperCase(); }
  function imagePath(mon){ return `${mon.is_shiny ? IMG_DIR_SHINY : IMG_DIR}/${mon.name}.png`; }

  // Converts an internal species key (used for image filenames, POKEMON_BY_NAME
  // lookups, etc. — never change what this returns for those) into what the
  // player should actually read. Mega forms are stored as e.g. "venusaur-mega"
  // or "charizard-mega-x" so the asset filenames match; this turns those into
  // "Mega Venusaur" / "Mega Charizard X". Any other string (including trainer
  // names, which also flow through some of these templates) passes through
  // unchanged.
  // A handful of species use a hyphen in PokeAPI's slug that's either part
  // of their real name verbatim, or needs punctuation a generic transform
  // can't produce — handled as exact overrides/pass-throughs in
  // displayName() before its generic form-suffix logic ever sees them.
  const NAME_EXACT_OVERRIDES = {
    'mime-jr': 'Mime Jr.',
    'mr-mime': 'Mr. Mime',
    'mr-rime': 'Mr. Rime',
    'type-null': 'Type: Null',
    'nidoran-f': 'Nidoran♀',
    'nidoran-m': 'Nidoran♂',
    'dudunsparce-two-segment': 'Dudunsparce',
    'dudunsparce-three-segment': 'Dudunsparce',
  };
  // The hyphen here IS the official spelling (Ho-Oh, Porygon-Z, the
  // Jangmo-o line, the Ruinous foursome) — left completely untouched; CSS
  // capitalize already renders these correctly.
  const HYPHEN_IS_OFFICIAL_NAME = new Set([
    'ho-oh', 'porygon-z', 'jangmo-o', 'hakamo-o', 'kommo-o',
    'chi-yu', 'chien-pao', 'ting-lu', 'wo-chien',
  ]);
  // Genuinely two-word species names where PokeAPI's slug uses '-' in place
  // of a space (the Paradox Pokémon, the 4 Tapu) — not a "form", so this
  // always becomes a plain space, never a "(Form)" parenthetical below.
  const COMPOUND_NAME_SLUGS = new Set([
    'brute-bonnet', 'flutter-mane', 'gouging-fire', 'great-tusk',
    'iron-boulder', 'iron-bundle', 'iron-crown', 'iron-hands', 'iron-jugulis',
    'iron-leaves', 'iron-moth', 'iron-thorns', 'iron-treads', 'iron-valiant',
    'raging-bolt', 'roaring-moon', 'sandy-shocks', 'scream-tail', 'slither-wing',
    'walking-wake', 'tapu-bulu', 'tapu-fini', 'tapu-koko', 'tapu-lele',
  ]);
  // Regional-form suffixes get a readable adjective instead of the raw region slug.
  const REGIONAL_FORM_LABELS = { alola:'Alolan', galar:'Galarian', hisui:'Hisuian', paldea:'Paldean' };

  function titleCaseWords(str){
    return str.split(/[- ]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  // Converts an internal species key (used for image filenames, POKEMON_BY_NAME
  // lookups, etc. — never change what this returns for those) into what the
  // player should actually read. Mega forms are stored as e.g. "venusaur-mega"
  // or "charizard-mega-x" so the asset filenames match; this turns those into
  // "Mega Venusaur" / "Mega Charizard X". Beyond Mega, PokeAPI's slug for any
  // Pokémon with alternate forms is "base-formsuffix" (e.g. "golem-alola",
  // "wormadam-plant", "mimikyu-disguised") — shown as just the base name when
  // this game has no OTHER reachable form of that species (see
  // MULTI_FORM_BASES, computed in loadData()), or "Base (Form)" when it does.
  // Any other string (including trainer names, which also flow through some
  // of these templates) passes through unchanged.
  function displayName(name){
    if(!name) return name;
    if(NAME_EXACT_OVERRIDES[name]) return NAME_EXACT_OVERRIDES[name];
    if(HYPHEN_IS_OFFICIAL_NAME.has(name)) return name;
    if(COMPOUND_NAME_SLUGS.has(name)) return titleCaseWords(name);

    const xy = name.match(/^(.+)-mega-(x|y)$/);
    if(xy) return `Mega ${xy[1]} ${xy[2].toUpperCase()}`;
    const z = name.match(/^(.+)-mega-z$/);
    if(z) return `Mega ${z[1]} Z`;
    if(name.endsWith('-mega')) return `Mega ${name.slice(0, -5)}`;

    // Generic PokeAPI "base-form" slug — only for known species (guards
    // against mangling some unrelated hyphenated string, e.g. a trainer name).
    const dash = name.indexOf('-');
    if(dash > 0 && POKEMON_BY_NAME[name]){
      const base = name.slice(0, dash);
      const suffix = name.slice(dash + 1);
      if(!MULTI_FORM_BASES.has(base)) return base;
      return `${base} (${REGIONAL_FORM_LABELS[suffix] || titleCaseWords(suffix)})`;
    }
    return name;
  }

  // Legendary/Mythical encounter reveal only — drops any "(Form)" qualifier
  // displayName() adds (e.g. Urshifu's "(Single Strike)"), since the intro is
  // a single dramatic reveal, not a form-disambiguation menu. Capitalizing
  // the first letter of lowercase base names (urshifu, necrozma, ho-oh, ...)
  // is handled by CSS (#legendaryIntroName's text-transform:capitalize) so
  // hyphenated official names (Ho-Oh, Chi-Yu, ...) keep their real casing.
  function legendaryEncounterName(name){
    return displayName(name).replace(/\s*\([^)]*\)\s*$/, '');
  }

  function typeChipsHTML(types){
    return types.map(t => `<span class="type-chip" style="background:color-mix(in srgb, ${TYPE_COLOR[t]} 30%, transparent); color:${TYPE_COLOR[t]}">${t}</span>`).join('');
  }

  // Compact type indicator for tight layouts (e.g. the 6-wide wild-encounter row).
  function typeDotsHTML(types){
    return types.map(t => `<span class="type-dot" style="background:${TYPE_COLOR[t]}" title="${t}"></span>`).join('');
  }

  function shinyTagHTML(mon){
    return mon.is_shiny ? '<span class="shiny-tag">✨ SHINY</span>' : '';
  }

  function avatarHTML(mon, sizeClass){
    const color = mon.types && mon.types[0] ? TYPE_COLOR[mon.types[0]] : 'var(--line)';
    return `<div class="avatar ${sizeClass||''} ${mon.is_shiny ? 'is-shiny' : ''}" style="background:color-mix(in srgb, ${color} 22%, var(--bg));">
      <img src="${imagePath(mon)}" alt="" onerror="this.style.display='none'">
      <span class="fallback" style="color:${color}">${initials(mon.name)}</span>
      ${mon.is_shiny ? '<span class="sparkle s1">✨</span><span class="sparkle s2">✨</span><span class="sparkle s3">✨</span>' : ''}
    </div>`;
  }

  // ---------- POKÉDEX POPUP (Computer screen — click any owned Pokémon) ----------
  const POKEDEX_STAT_FIELDS = [
    ['hp', 'HP'], ['attack', 'ATK'], ['defense', 'DEF'],
    ['sp_atk', 'SP.ATK'], ['sp_def', 'SP.DEF'], ['speed', 'SPD'],
  ];
  // Rough normalization for the stat bars — no real base stat in this game's
  // pool exceeds ~255, and anything past 200 is already elite, so bars stay
  // meaningfully different at the high end instead of all maxing out.
  const POKEDEX_STAT_BAR_MAX = 200;

  function pokedexStatRowsHTML(species){
    return POKEDEX_STAT_FIELDS.map(([field,label]) => {
      const val = species[field] || 0;
      const pct = Math.min(100, (val / POKEDEX_STAT_BAR_MAX) * 100);
      return `<div class="pokedex-stat-row">
        <span class="pokedex-stat-label">${label}</span>
        <div class="pokedex-stat-track"><div class="pokedex-stat-fill" style="width:${pct}%"></div></div>
        <span class="pokedex-stat-val">${val}</span>
      </div>`;
    }).join('');
  }

  function pokedexMovesHTML(mon){
    return movesFor(mon).map(m => `
      <div class="pokedex-move-row">
        <span class="pokedex-move-name" style="color:${TYPE_COLOR[m.type]}">${titleCaseWords(m.name)}</span>
        <span class="pokedex-move-meta">${m.damage_class} · ${m.power || '—'} PWR · ${m.accuracy}% ACC</span>
      </div>`).join('');
  }

  // Reuses typeEffectiveness() (the same battle-damage function, game.js
  // ~2484) from the other direction: instead of "this move vs. that
  // defender", it's "every possible attacking type vs. this Pokémon's
  // types" — no separate type-chart logic needed.
  function pokedexMatchupsHTML(defTypes){
    const weak = [], resist = [], immune = [];
    Object.keys(TYPE_CHART).forEach(atkType => {
      const eff = typeEffectiveness(atkType, defTypes);
      if(eff === 0) immune.push(atkType);
      else if(eff > 1) weak.push({ atkType, eff });
      else if(eff < 1) resist.push({ atkType, eff });
    });
    weak.sort((a,b) => b.eff - a.eff);
    resist.sort((a,b) => a.eff - b.eff);
    const section = (label, list) => list.length ? `
      <div class="pokedex-matchup-row">
        <span class="pokedex-section-label">${label}</span>
        <div class="pokedex-matchup-chips">${list.join('')}</div>
      </div>` : '';
    return section('WEAK TO', weak.map(w => typeChipsHTML([w.atkType])))
      + section('RESISTS', resist.map(r => typeChipsHTML([r.atkType])))
      + section('IMMUNE TO', immune.map(t => typeChipsHTML([t])));
  }

  function openPokedex(mon){
    const species = POKEMON_BY_NAME[mon.name] || mon;
    document.getElementById('pokedexBody').innerHTML = `
      <div class="pokedex-header">
        <div class="pokedex-portrait">${avatarHTML(mon)}</div>
        <div class="tn">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">✨</span>' : ''}</div>
        <div class="pokedex-types">${typeChipsHTML(mon.types)}</div>
      </div>
      <div class="team-mgmt-title" style="margin-top:10px;">Base Stats</div>
      <div class="pokedex-stats">${pokedexStatRowsHTML(species)}</div>
      <div class="team-mgmt-title" style="margin-top:10px;">Moves</div>
      <div class="pokedex-moves">${pokedexMovesHTML(mon)}</div>
      <div class="team-mgmt-title" style="margin-top:10px;">Type Matchups</div>
      <div class="pokedex-matchups">${pokedexMatchupsHTML(mon.types)}</div>
    `;
    document.getElementById('pokedexModal').classList.add('active');
  }

  function closePokedex(){
    document.getElementById('pokedexModal').classList.remove('active');
  }

  // Populates the shared "X evolved into Y!" reveal block, or hides it if
  // there's nothing to show. Used on both the PokeStop and Result screens.
  function renderEvolutionReveal(elId, evolution){
    const el = document.getElementById(elId);
    if(!el) return;
    if(!evolution){
      el.style.display = 'none';
      el.classList.remove('evolve-anim');
      return;
    }
    el.style.display = 'block';
    el.querySelector('.evo-from').innerHTML = avatarHTML(evolution.from,'avatar-sm');
    el.querySelector('.evo-to').innerHTML = avatarHTML(evolution.to,'avatar-sm');
    el.querySelector('.evolution-text').textContent = `${displayName(evolution.from.name)} evolved into ${displayName(evolution.to.name)}!`;
    el.classList.remove('evolve-anim');
    void el.offsetWidth; // restart the animation each time this reveal is (re-)shown
    el.classList.add('evolve-anim');
  }

  // ---------- STORAGE (best runs / highscores — falls back silently if unavailable) ----------
  // Composite score: badges matter most, then Elite Four wins (full 6-vs-6
  // battles, weighted well above a route trainer), then trainer wins, then
  // catches, then gold.
  function computeScore(run){
    return run.badges*100 + (run.eliteBeaten || 0)*60 + run.trainersBeaten*25 + run.caught.length*15 + run.goldEarned;
  }

  // Converts a `scores` row back into the shape the UI (renderBest,
  // renderRunDetail, normalizeMonRef) already expects — the run snapshot
  // lives in the `details` jsonb column, everything else is its own column.
  function rowToEntry(row){
    return {
      name: row.name,
      date: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      score: row.score,
      badges: row.badges,
      trainersBeaten: row.trainers_beaten,
      caughtCount: row.caught_count,
      goldEarned: row.gold_earned,
      ...(row.details || {}),
    };
  }

  // Which leaderboard tab is currently being viewed — shared between the
  // homepage top-10 block and the full #11-100 ranking screen, so switching
  // tabs on one carries over if the player opens the other next.
  let rankingMode = 'classic'; // 'classic' | 'pro' | 'nuzlocke'

  const RANKING_MODE_LABELS = { classic:'Classic', pro:'Pro', nuzlocke:'Nuzlocke' };

  function rankingTabsHTML(activeMode){
    return `
      <button class="ranking-tab ${activeMode === 'classic' ? 'active' : ''}" data-mode="classic">CLASSIC</button>
      <button class="ranking-tab ${activeMode === 'pro' ? 'active' : ''}" data-mode="pro">PRO</button>
      <button class="ranking-tab ${activeMode === 'nuzlocke' ? 'active' : ''}" data-mode="nuzlocke">NUZLOCKE</button>
    `;
  }

  // Queries the global top `limit` directly from Supabase (ORDER BY + LIMIT
  // run server-side, so we never pull the whole table down to slice it here).
  // Filtered to a single game mode — Classic and Pro never mix in a ranking.
  async function loadBest(limit = 10, mode = 'classic'){
    if(!supabaseClient) return [];
    try{
      const { data, error } = await supabaseClient
        .from('scores')
        .select('*')
        .eq('mode', mode)
        .order('score', { ascending: false })
        .limit(limit);
      if(error) throw error;
      return (data || []).map(rowToEntry);
    }catch(e){ return []; }
  }
  let bestListCache = []; // top 10 shown on the homepage, read by openRunDetail()

  // Renders one leaderboard row; `rank` is the 1-based position shown on the left.
  function bestRowHTML(r, rank, idx){
    return `
      <button class="best-row" data-idx="${idx}">
        <div class="best-rank">${rank}</div>
        <div class="best-name">${r.name || 'Player'} · ${r.badges} badge${r.badges===1?'':'s'} · ${r.caughtCount} caught</div>
        <div class="best-ovr">${r.score}</div>
      </button>`;
  }

  async function renderBest(){
    const tabsEl = document.getElementById('rankingTabs');
    if(tabsEl){
      tabsEl.innerHTML = rankingTabsHTML(rankingMode);
      tabsEl.querySelectorAll('.ranking-tab').forEach(btn => {
        btn.addEventListener('click', () => { rankingMode = btn.dataset.mode; renderBest(); });
      });
    }

    const list = await loadBest(10, rankingMode);
    bestListCache = list;
    const block = document.getElementById('bestBlock');
    const el = document.getElementById('bestList');
    const moreBtn = document.getElementById('viewFullRankingBtn');
    block.classList.add('active');
    if(!list.length){
      el.innerHTML = `<div class="best-title">No ${RANKING_MODE_LABELS[rankingMode] || 'Classic'} runs saved yet.</div>`;
      if(moreBtn) moreBtn.style.display = 'none';
      return;
    }
    el.innerHTML = list.map((r,i) => bestRowHTML(r, i+1, i)).join('');
    el.querySelectorAll('.best-row').forEach(row => {
      row.addEventListener('click', () => openRunDetail(Number(row.dataset.idx), 'home'));
    });
    if(moreBtn) moreBtn.style.display = list.length >= 10 ? 'block' : 'none';
  }

  // ---------- FULL RANKING (#11-100, opened from the homepage button) ----------
  let rankingListCache = []; // full top-100 list; ranks 11-100 are shown here

  async function renderFullRanking(){
    const el = document.getElementById('fullRankingScreen');
    el.innerHTML = `
      <div class="eyebrow">Global Leaderboard</div>
      <h1 class="section-h1">RANKING #11–100</h1>
      <div class="ranking-tabs" id="fullRankingTabs">${rankingTabsHTML(rankingMode)}</div>
      <div id="fullRankingList" class="best-title">Loading…</div>
      <div class="actions">
        <button class="btn-ghost" id="fullRankingBackBtn">BACK</button>
      </div>
    `;
    document.getElementById('fullRankingBackBtn').addEventListener('click', closeFullRanking);
    document.querySelectorAll('#fullRankingTabs .ranking-tab').forEach(btn => {
      btn.addEventListener('click', () => { rankingMode = btn.dataset.mode; renderFullRanking(); });
    });

    const list = await loadBest(100, rankingMode);
    rankingListCache = list;
    const listEl = document.getElementById('fullRankingList');
    const rest = list.slice(10);
    if(!rest.length){
      listEl.textContent = `Not enough ${RANKING_MODE_LABELS[rankingMode] || 'Classic'} runs yet. Check back once more players have set a highscore.`;
      return;
    }
    listEl.classList.remove('best-title');
    listEl.innerHTML = rest.map((r,i) => bestRowHTML(r, i+11, i+10)).join('');
    listEl.querySelectorAll('.best-row').forEach(row => {
      row.addEventListener('click', () => openRunDetail(Number(row.dataset.idx), 'ranking'));
    });
  }

  function openFullRanking(){
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('fullRankingScreen').classList.add('active');
    renderFullRanking();
  }

  function closeFullRanking(){
    document.getElementById('fullRankingScreen').classList.remove('active');
    document.getElementById('fullRankingScreen').innerHTML = '';
    document.getElementById('startScreen').style.display = 'block';
  }
  // ---------- HIGHSCORE NAME VALIDATION ----------
  // Highscores are only ever recorded when the player deliberately types a
  // name — leaving the field blank means the run is never sent to the
  // leaderboard at all (previously it silently saved as "Player", which
  // polluted the rankings with anonymous entries).

  // Strips anything that isn't a letter/number/space/basic punctuation as the
  // player types, without trimming — that also removes emoji, since they fall
  // outside the Unicode Letter/Number categories. Trimming happens separately,
  // only at submit time, so an interior space isn't eaten mid-keystroke.
  function stripDisallowedNameChars(raw){
    return (raw || '').normalize('NFC').replace(/[^\p{L}\p{N} '_-]/gu, '').slice(0, 20);
  }
  function sanitizeHighscoreName(raw){
    return stripDisallowedNameChars(raw).trim();
  }

  // Best-effort, non-exhaustive multi-language profanity/slur blocklist,
  // matched against a lowercased, accent-stripped, letters-only version of the
  // name so simple spacing/accent/casing tricks don't slip through. This is a
  // deterrent for a public leaderboard, not a complete moderation system.
  const PROFANITY_BLOCKLIST = [
    // English
    'fuck','shit','bitch','asshole','bastard','cunt','dick','pussy','whore','slut',
    'nigger','nigga','faggot','fag','retard','rape','cock','twat','wanker',
    // Spanish
    'puta','puto','mierda','pendejo','cabron','maricon','cono','joder','verga','chingar','chinga',
    // Portuguese
    'caralho','porra','buceta','viado','corno','arrombado','desgraca','piroca','cacete',
    // French
    'merde','putain','connard','salope','encule','enculer','batard','pute',
    // Italian
    'cazzo','stronzo','puttana','vaffanculo','merda','coglione',
    // German
    'scheisse','scheiss','arschloch','fotze','hurensohn','wichser',
    // Slurs / hate symbols that show up across many languages as-is
    'nazi','hitler','isis',
  ];
  function containsProfanity(name){
    const normalized = name
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    return PROFANITY_BLOCKLIST.some(word => normalized.includes(word));
  }

  // Records the run as a single row on the shared Supabase leaderboard and
  // reports whether it's a new all-time high score. The full snapshot (team,
  // badges, elite/legendary progress) goes into `details` so the player can
  // revisit a saved run from the homepage list, same as before.
  async function recordRun(run, playerName){
    const score = computeScore(run);
    const mode = (run.mode === 'pro' || run.mode === 'nuzlocke') ? run.mode : 'classic';

    let previousBest = -Infinity;
    let isFirstEver = true;
    if(supabaseClient){
      try{
        const { data, error } = await supabaseClient
          .from('scores')
          .select('score')
          .eq('mode', mode)
          .order('score', { ascending: false })
          .limit(1);
        if(error) throw error;
        isFirstEver = !data || data.length === 0;
        if(data && data.length) previousBest = data[0].score;
      }catch(e){ /* fall through: treat as unknown, still try to save */ }
    }

    const details = {
      starter: { name: run.starter.name, types: run.starter.types, is_shiny: !!run.starter.is_shiny },
      caught: run.caught.map(m => ({ name: m.name, types: m.types, is_shiny: !!m.is_shiny })),
      activeRoster: (run.activeRoster || []).map(m => ({ name: m.name, types: m.types, is_shiny: !!m.is_shiny })),
      trainerLoss: run.trainerLoss || null,
      champion: !!run.champion,
      beatenBadges: run.beatenBadges || [],
      eliteBeaten: run.eliteBeaten || 0,
      legendaryHandled: run.legendaryHandled || false,
      mythicalHandled: run.mythicalHandled || false,
      achievements: run.achievements || [],
    };

    // Score is no longer sent to the server — submit-score recomputes it
    // itself from these raw inputs (see supabase/functions/submit-score),
    // since a client-supplied score can't be trusted. Direct inserts into
    // `scores` are blocked by RLS; this Edge Function is the only path in.
    if(supabaseClient){
      try{
        const { error } = await supabaseClient.functions.invoke('submit-score', {
          body: {
            name: (playerName || 'Player').slice(0, 20),
            badges: run.badges,
            trainersBeaten: run.trainersBeaten,
            caughtCount: run.caught.length,
            goldEarned: run.goldEarned,
            mode,
            details,
          },
        });
        if(error) throw error;
      }catch(e){ /* offline / network failure: fail silently, matches prior behavior */ }
    }

    return { score, isNewBest: isFirstEver || score > previousBest };
  }

  // ---------- RUN DETAIL (revisit a saved high score) ----------
  let runDetailSource = 'home'; // 'home' or 'ranking' — where to return on close

  function openRunDetail(idx, source = 'home'){
    const entry = (source === 'ranking' ? rankingListCache : bestListCache)[idx];
    if(!entry) return;
    runDetailSource = source;
    if(source === 'ranking'){
      document.getElementById('fullRankingScreen').classList.remove('active');
    } else {
      document.getElementById('startScreen').style.display = 'none';
    }
    document.getElementById('runDetailScreen').classList.add('active');
    renderRunDetail(entry);
  }

  function closeRunDetail(){
    document.getElementById('runDetailScreen').classList.remove('active');
    document.getElementById('runDetailScreen').innerHTML = '';
    if(runDetailSource === 'ranking'){
      document.getElementById('fullRankingScreen').classList.add('active');
    } else {
      document.getElementById('startScreen').style.display = 'block';
    }
  }

  // Best-run entries saved before the run-detail feature existed only stored
  // a plain starter-name string and no `caught`/`types` data. Normalize any
  // mon reference (string or object) into a display-safe object so old
  // entries render instead of throwing mid-template.
  function normalizeMonRef(ref){
    if(!ref) return null;
    if(typeof ref === 'string'){
      return POKEMON_BY_NAME[ref] || { name: ref, types: ['normal'], is_shiny:false };
    }
    if(!ref.types || !ref.types.length) return { ...ref, types: ['normal'] };
    return ref;
  }

  function renderRunDetail(entry){
    const el = document.getElementById('runDetailScreen');
    const badgesEarned = new Set(entry.beatenBadges || []);
    const dateStr = entry.date ? new Date(entry.date).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' }) : '';

    const badgeGridHTML = BADGES.map(b => `
      <div class="badge-card mini ${badgesEarned.has(b.key) ? '' : 'locked'}">
        <img class="badge-icon" src="${BADGE_ICON_DIR}/${b.icon}" alt="" onerror="this.style.display='none'">
      </div>`).join('');

    const starterMon = normalizeMonRef(entry.starter);
    const caughtMons = (entry.caught || []).map(normalizeMonRef).filter(Boolean);

    const monSlotHTML = mon => `<div class="run-mon-slot">
      ${avatarHTML(mon,'avatar-sm')}
      <span class="tn">${displayName(mon.name)}${mon.is_shiny ? ' ✨' : ''}</span>
    </div>`;

    // Old saved runs (before activeRoster was tracked) can't tell active vs
    // storage apart — fall back to one combined list rather than guessing.
    const hasActiveRosterData = !!(entry.activeRoster && entry.activeRoster.length);
    let activeSectionHTML, storageSectionHTML;
    if(hasActiveRosterData){
      const activeMons = entry.activeRoster.map(normalizeMonRef).filter(Boolean);
      const activeNames = new Set(activeMons.map(m => m.name));
      const storageMons = caughtMons.filter(m => !activeNames.has(m.name));
      activeSectionHTML = `
        <div class="team-mgmt-title" style="margin-top:10px;">Active Team (last used this run)</div>
        <div class="run-detail-team-grid">${activeMons.map(monSlotHTML).join('') || '<div class="empty-note">Empty.</div>'}</div>`;
      storageSectionHTML = `
        <div class="team-mgmt-title" style="margin-top:10px;">Caught &amp; in Storage</div>
        <div class="run-detail-team-grid">${storageMons.length ? storageMons.map(monSlotHTML).join('') : '<div class="empty-note">Nothing else was caught this run.</div>'}</div>`;
    } else {
      const allMons = [starterMon, ...caughtMons].filter(Boolean);
      activeSectionHTML = `
        <div class="team-mgmt-title" style="margin-top:10px;">Team</div>
        <div class="run-detail-team-grid">${allMons.map(monSlotHTML).join('')}</div>`;
      storageSectionHTML = '';
    }

    const statTiles = [
      ['Badges', `${entry.badges}/${BADGES.length}`], ['Battles Won', entry.badges + entry.trainersBeaten],
      ['Caught', entry.caughtCount], ['Gold Earned', `${entry.goldEarned}G`, true],
    ].map(([label,count,isGold]) => `<div class="inv-chip"><span class="inv-count ${isGold ? 'gold-text' : ''}">${count}</span><span class="inv-label">${label}</span></div>`).join('');

    let statusLine;
    if(entry.champion) statusLine = `<span style="color:var(--lime)">Became Pokémon Champion, Elite Four cleared!${itemIconHTML('masterBalls').replace('item-icon', 'item-icon trophy-icon-inline')}</span>`;
    else if(entry.trainerLoss) statusLine = `Lost to ${entry.trainerLoss}.`;
    else if(entry.eliteBeaten > 0) statusLine = `Reached the Elite Four: ${entry.eliteBeaten}/4 beaten.`;
    else if(entry.legendaryHandled) statusLine = `Faced the Legendary (${entry.legendaryHandled === 'caught' ? 'caught it' : 'it fled'}).`;
    else if(entry.mythicalHandled) statusLine = `Faced the Mythical (${entry.mythicalHandled === 'caught' ? 'caught it' : 'it fled'}).`;
    else statusLine = 'Run ended before the endgame.';

    const achievements = entry.achievements || [];
    const achievementsHTML = achievements.length ? `
      <div class="achievements-strip">
        <div class="team-mgmt-title">Achievements Unlocked</div>
        <div class="achievements-grid">
          ${achievements.map(name => `<span class="achv-chip">${name.toUpperCase()}</span>`).join('')}
        </div>
      </div>` : '';

    el.innerHTML = `
      <div class="card foil-solid run-detail-card">
        <div class="card-inner">
          <div class="ovr-num">${entry.score}</div>
          <div class="ovr-label">SCORE</div>
          <div class="tier-name">${entry.name || 'Player'}${dateStr ? ` · ${dateStr}` : ''}</div>
          <div class="tier-flavor">${statusLine}</div>

          <div class="inv-strip" style="margin-top:12px;">${statTiles}</div>

          ${activeSectionHTML}
          ${achievementsHTML}
          ${storageSectionHTML}

          <div class="team-mgmt-title" style="margin-top:10px;">Badges Earned</div>
          <div class="badge-grid mini-grid run-detail-badge-grid">${badgeGridHTML}</div>

          <div class="divider"></div>
          <div class="credit-line">Started with <b>${starterMon ? starterMon.name : 'Unknown'}</b></div>
        </div>
      </div>
      <div class="actions">
        <button class="btn-ghost" id="runDetailBackBtn">BACK</button>
      </div>
    `;
    document.getElementById('runDetailBackBtn').addEventListener('click', closeRunDetail);
  }

  // ---------- META (persistent gold + shop upgrades) ----------
  // `recentWildNames` is a rolling FIFO of the last RECENT_WILD_CAP wild
  // species shown to the player across ALL runs (oldest first) — used to
  // soften the "every new run opens with the same handful of easy mons"
  // feeling, since seenWildNames (see below) resets to empty at the start
  // of every run and has no memory of previous ones.
  let META = { gold:0, extraBalls:0, recentWildNames: [] };

  function loadMeta(){
    try{
      const raw = localStorage.getItem('dondokomon:meta');
      if(raw) META = Object.assign(META, JSON.parse(raw));
    }catch(e){}
  }
  function saveMeta(){
    try{ localStorage.setItem('dondokomon:meta', JSON.stringify(META)); }catch(e){}
  }

  function renderGoldBadge(){
    const el = document.getElementById('goldBadge');
    if(el) el.textContent = `${META.gold}G`;
  }

  // ---------- ANONYMOUS GAMEPLAY ANALYTICS ----------
  // A random ID stored only in this browser, completely separate from the
  // leaderboard name the player types in — never shown anywhere, never
  // correlated with anything identifying. Lets analytics distinguish "one
  // player's 10 runs" from "10 players' 1 run each" without knowing who
  // anyone is.
  function getAnalyticsId(){
    try{
      let id = localStorage.getItem('dondokomon:analyticsId');
      if(!id){
        id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        localStorage.setItem('dondokomon:analyticsId', id);
      }
      return id;
    }catch(e){ return 'unknown'; }
  }

  // Per-run tallies of every item bought at the PokeStop and every item
  // actually consumed — the gap between the two (e.g. Revives bought but
  // never used) is exactly what tells us what's worth rebalancing.
  let itemsBought, itemsUsed, runStartedAt;
  function trackItemBought(invKey, qty){
    itemsBought[invKey] = (itemsBought[invKey] || 0) + (qty || 1);
  }
  function trackItemUsed(invKey, qty){
    itemsUsed[invKey] = (itemsUsed[invKey] || 0) + (qty || 1);
  }

  // Fire-and-forget: never awaited by a caller, never allowed to affect the
  // result screen if Supabase is unreachable or the insert fails.
  async function recordAnalytics(run, outcome){
    if(!supabaseClient) return;
    try{
      await supabaseClient.from('run_analytics').insert({
        analytics_id: getAnalyticsId(),
        outcome,
        duration_sec: runStartedAt ? Math.round((Date.now() - runStartedAt) / 1000) : null,
        badges: run.badges,
        caught_count: run.caught.length,
        gold_earned: run.goldEarned,
        bought_safari: !!(itemsBought.safariTicket),
        items_bought: itemsBought,
        items_used: itemsUsed,
      });
    }catch(e){ /* best-effort telemetry — never blocks or throws into the UI */ }
  }

  // ---------- GAME MODE (Classic / Pro / Nuzlocke) ----------
  // Chosen on the home screen, right before Start. Classic is the game as it
  // always was; Pro and Nuzlocke both hide every wild-encounter/starter card
  // behind a "mystery" cover until clicked, see renderWildChoices()/
  // renderStarterChoices()/isBlindMode(). Nuzlocke additionally adds
  // permadeath (see removeFaintedFromRoster()), pricier PokeStop restocks
  // (see shopPrice()), fewer Fishing casts, and drops Revives/the Cruise
  // Casino's Lucky Spin/Token Casino entirely.
  // Also tags the run's leaderboard row (see recordRun()) so the 3 modes
  // never mix scores in the ranking.
  let gameMode = 'classic'; // 'classic' | 'pro' | 'nuzlocke'

  // Pro and Nuzlocke share the "mystery card" blind-pick mechanic, only
  // Classic reveals starters/wild encounters up front.
  function isBlindMode(){
    return gameMode === 'pro' || gameMode === 'nuzlocke';
  }

  function setGameMode(mode){
    gameMode = mode;
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  // ---------- STARTER SELECT / RUN STATE ----------
  let starter, activeTeam, storage_, inv, encounterNum;
  let runTrainersBeaten, runBadges, runChampion, runGoldEarned, trainerLoss, legendaryHandled, mythicalHandled;
  let pendingEvolution; // set on a Gym Leader win, revealed on the next PokeStop screen
  let runBeatenBadges; // Set of badge keys already challenged (and beaten) this run
  let eliteIndex; // how many of the 4 Elite Four members have been beaten this run
  let eliteUsedNames; // Set of Pokémon names already fielded by an earlier Elite Four member this run — never repeated across the 4
  // Every species name ever shown in a wild-encounter list this run (caught
  // or not) — excluded from future encounter lists so nothing repeats
  // across different encounters. Reset only on a new run.
  let seenWildNames;
  let casinoTokens; // PokeStop Token Casino currency — per-run, spent in the Token Shop
  let firstGymBonusEncounterUsed; // one-time bonus wild encounter before the 1st Gym Leader challenge
  let legendaryBonusEncounterUsed; // one-time bonus wild encounter right before the Legendary battle
  let eliteBonusEncounterUsed; // one-time bonus wild encounter right before the Elite Four gauntlet
  let cruiseStageIndex; // null outside the Cruise Ship; 0-2 = next ship battle; 3 = rival is next
  let cruiseMiniEventUsed; // { fishing, slots } — each is a one-shot for the whole run, not per stop
  // Lifetime PokeStop-purchase counts, keyed by invKey — for items with a
  // `lifetimeMax` (Potions, Revives) this never decreases even as the item is
  // used/consumed, unlike inv[invKey] itself. Keeps the run-long healing
  // budget capped regardless of how many PokeStop stops the player visits.
  let shopBoughtCounts;
  // Per-run increase to an item's lifetimeMax, keyed by invKey — raised once
  // at the endgame (see ENDGAME_RESUPPLY_POTIONS/REVIVES) so the shop opens
  // up more Potions/Revives to *buy*, rather than handing them out for free.
  let shopLifetimeBonus;

  // ---------- HIDDEN ACHIEVEMENT TRACKING (see checkAchievements()) ----------
  // Counters/flags with no other natural home in the run state above, each
  // is purely additive bookkeeping for a single achievement condition and
  // never affects gameplay itself.
  let safariCatchCount;   // Pokémon caught inside the Safari Zone this run
  let fishingCatchCount;  // Pokémon caught via Fishing this run
  let evolvedSpeciesThisRun; // Set of species names (the "to" side) evolved into this run, normal or Mega, see recordEvolution()
  let playerStatusEffectsApplied; // times the player's own moves inflicted Poison/Sleep/Burn this run
  let eliteGauntletFlawless; // true unless any player Pokémon has fainted since the Elite Four gauntlet began
  let comebackKidAchieved; // set once any single battle this run was won after dropping to 1 living Pokémon at <20% HP
  let tokenExchangeBought; // the Casino Token Shop's shiny-exchange item was bought at least once this run
  let goldSpentOnSlots;    // cumulative Gold spent pulling the Token Casino's Slot Machine lever this run

  // ---------- RUN PERSISTENCE (resume an in-progress run across a refresh) ----------
  // Distinct key from the leaderboard (dondokomon:best) and META (dondokomon:meta)
  // on purpose — this is per-run scratch state, not shared/persistent data.
  const RUN_SAVE_KEY = 'dondokomon:currentRun';
  const RUN_SAVE_VERSION = 1;

  // Which screen to resume into. Only screens reachable from a self-contained
  // render function are checkpointed — short-lived actions (an active battle
  // turn, a catch-screen throw, a casino spin/fishing cast/safari step) are not:
  // refreshing mid-action resumes at the last checkpoint before that action
  // started, since none of those leave permanent, hard-to-regenerate state.
  let checkpointScreen = null;

  function serializeRun(){
    return {
      v: RUN_SAVE_VERSION,
      checkpointScreen,
      starter, activeTeam, storage_: storage_, inv, encounterNum,
      runTrainersBeaten, runBadges, runChampion, runGoldEarned, trainerLoss, legendaryHandled, mythicalHandled,
      runBeatenBadges: Array.from(runBeatenBadges || []),
      eliteIndex, eliteUsedNames: Array.from(eliteUsedNames || []),
      seenWildNames: Array.from(seenWildNames || []), casinoTokens, firstGymBonusEncounterUsed,
      legendaryBonusEncounterUsed, eliteBonusEncounterUsed, gameMode,
      cruiseStageIndex, cruiseMiniEventUsed, shopBoughtCounts, shopLifetimeBonus,
      itemsBought, itemsUsed, runStartedAt,
      pendingEvolution, activeEvolution, pokestopMode,
      wildChoices,
      hasComputerNotification, newArrivalNames,
      lastBattleTrainerName: (battle && battle.trainer) ? battle.trainer.name : null,
      safariCatchCount, fishingCatchCount,
      evolvedSpeciesThisRun: Array.from(evolvedSpeciesThisRun || []),
      playerStatusEffectsApplied, eliteGauntletFlawless, comebackKidAchieved,
      tokenExchangeBought, goldSpentOnSlots,
    };
  }

  // Called after every checkpointed screen renders (and after in-place
  // updates on those screens, e.g. a PokeStop purchase or a team swap) —
  // always re-saves under whatever screen is currently checked in.
  function persistRunState(){
    if(!checkpointScreen) return;
    const snapshot = serializeRun();
    try{ localStorage.setItem(RUN_SAVE_KEY, JSON.stringify(snapshot)); }catch(e){}
    // Fire-and-forget cloud checkpoint (see run_saves.js) — same snapshot as
    // the local save, so it can rebuild the run via the exact same
    // restoreRun() path. Never awaited: a slow/unreachable Supabase must
    // never delay or block anything the player is doing.
    if(typeof saveCheckpoint === 'function') saveCheckpoint(snapshot);
  }

  // "End Run" is only offered from the PokeStop, every other screen (an
  // encounter, a battle, Gym Select, Team management...) hides it, so
  // abandoning mid-fight or mid-pick isn't an option one screen away.
  function renderAbandonButton(screen){
    const btn = document.getElementById('abandonRunBtn');
    if(btn) btn.style.display = screen === 'pokestop' ? 'block' : 'none';
  }

  // Marks a new checkpoint (screen transition) and saves immediately.
  function checkpoint(screen){
    checkpointScreen = screen;
    persistRunState();
    renderAbandonButton(screen);
  }

  function clearRunState(){
    try{ localStorage.removeItem(RUN_SAVE_KEY); }catch(e){}
  }

  // Reads back a saved run. Returns null (never throws) if the key is
  // missing, unparseable, from an incompatible version, or missing a field
  // this version of the game depends on — any of those cases means the
  // caller should just start a fresh run instead of crashing.
  function loadSavedRun(){
    try{
      const raw = localStorage.getItem(RUN_SAVE_KEY);
      if(!raw) return null;
      const saved = JSON.parse(raw);
      if(!saved || typeof saved !== 'object') return null;
      if(saved.v !== RUN_SAVE_VERSION) return null;
      const validScreens = ['encounter', 'gymSelect', 'rivalChallenge', 'pokestop', 'team'];
      if(!validScreens.includes(saved.checkpointScreen)) return null;
      if(!saved.starter || !Array.isArray(saved.activeTeam) || !saved.inv) return null;
      return saved;
    }catch(e){ return null; }
  }

  // Rebuilds every module-level run variable from a saved snapshot, then
  // shows whichever screen was checkpointed.
  function restoreRun(saved){
    activeTeam = saved.activeTeam;
    storage_ = Array.isArray(saved.storage_) ? saved.storage_ : [];
    // finishEncounter() identifies the starter by object *reference*
    // (`m !== starter`), but a JSON round-trip always produces a fresh copy
    // that would no longer match anything in activeTeam/storage_ — repoint
    // `starter` at the matching element so that reference check still works.
    starter = [...activeTeam, ...storage_]
      .find(m => m.name === saved.starter.name && !!m.is_shiny === !!saved.starter.is_shiny)
      || saved.starter;
    inv = saved.inv;
    encounterNum = saved.encounterNum || 1;
    runTrainersBeaten = saved.runTrainersBeaten || 0;
    runBadges = saved.runBadges || 0;
    runChampion = !!saved.runChampion;
    runGoldEarned = saved.runGoldEarned || 0;
    trainerLoss = saved.trainerLoss || null;
    legendaryHandled = saved.legendaryHandled || false;
    mythicalHandled = saved.mythicalHandled || false;
    runBeatenBadges = new Set(saved.runBeatenBadges || []);
    eliteIndex = saved.eliteIndex || 0;
    eliteUsedNames = new Set(saved.eliteUsedNames || []);
    seenWildNames = new Set(saved.seenWildNames || []);
    casinoTokens = saved.casinoTokens || 0;
    firstGymBonusEncounterUsed = !!saved.firstGymBonusEncounterUsed;
    legendaryBonusEncounterUsed = !!saved.legendaryBonusEncounterUsed;
    eliteBonusEncounterUsed = !!saved.eliteBonusEncounterUsed;
    gameMode = (saved.gameMode === 'pro' || saved.gameMode === 'nuzlocke') ? saved.gameMode : 'classic';
    cruiseStageIndex = (typeof saved.cruiseStageIndex === 'number') ? saved.cruiseStageIndex : null;
    cruiseMiniEventUsed = saved.cruiseMiniEventUsed || { fishing:false, slots:false };
    shopBoughtCounts = saved.shopBoughtCounts || {};
    shopLifetimeBonus = saved.shopLifetimeBonus || {};
    itemsBought = saved.itemsBought || {};
    itemsUsed = saved.itemsUsed || {};
    runStartedAt = saved.runStartedAt || Date.now();
    pendingEvolution = saved.pendingEvolution || null;
    activeEvolution = saved.activeEvolution || null;
    pokestopMode = saved.pokestopMode;
    // Full battle state is never persisted (see serializeRun()) — this
    // rebuilds just enough of it for renderPokeStop()'s "You beat X" text.
    // Needed for every restore path, not just the 'pokestop' checkpoint:
    // both the Gym Select and Team screens have their own "back to PokeStop"
    // button that calls renderPokeStop() too, and it dereferences
    // battle.trainer.name unconditionally — without this, `battle` stays
    // undefined after a restore straight into either of those screens, and
    // that button throws instead of rendering (the screen goes blank).
    battle = { trainer: { name: saved.lastBattleTrainerName || 'them' } };
    wildChoices = saved.wildChoices || [];
    hasComputerNotification = !!saved.hasComputerNotification;
    newArrivalNames = Array.isArray(saved.newArrivalNames) ? saved.newArrivalNames : [];
    checkpointScreen = saved.checkpointScreen;
    safariCatchCount = saved.safariCatchCount || 0;
    fishingCatchCount = saved.fishingCatchCount || 0;
    evolvedSpeciesThisRun = new Set(saved.evolvedSpeciesThisRun || []);
    playerStatusEffectsApplied = saved.playerStatusEffectsApplied || 0;
    eliteGauntletFlawless = saved.eliteGauntletFlawless !== false;
    comebackKidAchieved = !!saved.comebackKidAchieved;
    tokenExchangeBought = !!saved.tokenExchangeBought;
    goldSpentOnSlots = saved.goldSpentOnSlots || 0;

    document.getElementById('startScreen').style.display = 'none';
    renderAbandonButton(checkpointScreen);

    if(checkpointScreen === 'encounter'){
      document.getElementById('encounterScreen').classList.add('active');
      renderWildChoices();
      renderRerollButton();
    } else if(checkpointScreen === 'gymSelect'){
      openGymSelect();
    } else if(checkpointScreen === 'rivalChallenge'){
      openRivalChallenge();
    } else if(checkpointScreen === 'pokestop'){
      document.getElementById('pokestopScreen').classList.add('active');
      renderPokeStop();
    } else if(checkpointScreen === 'team'){
      openTeamManagement();
    }
    renderComputerNotifDot();
  }

  // ---------- COMPUTER NOTIFICATION DOT ----------
  // Lets the player know something new is waiting in the Computer (a freshly
  // caught Pokémon, or a Mega Stone reward) without checking every visit.
  // Cleared the moment they actually open the Computer; the next new arrival
  // after that lights it up again.
  let hasComputerNotification = false;
  // Species names added since the player's last Computer visit — safe to key
  // by name alone since wildPool() already excludes any species the player
  // already owns (active or storage), so activeTeam+storage_ never contain
  // two entries with the same name at once.
  let newArrivalNames = [];

  function renderComputerNotifDot(){
    const dot = document.getElementById('computerNotifDot');
    if(dot) dot.classList.toggle('active', hasComputerNotification);
  }

  // `name` is optional — pass the species name when a specific new Pokémon
  // triggered this (so its row gets highlighted in the Computer), or omit it
  // for non-Pokémon rewards (e.g. a Mega Stone) that should still light up
  // the button dot without tagging any specific team row.
  function flagComputerNotification(name){
    hasComputerNotification = true;
    if(name && !newArrivalNames.includes(name)) newArrivalNames.push(name);
    renderComputerNotifDot();
    persistRunState();
  }

  function clearComputerNotification(){
    hasComputerNotification = false;
    newArrivalNames = [];
    renderComputerNotifDot();
    persistRunState();
  }

  function startGame(){
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('starterScreen').classList.add('active');
    renderStarterChoices();
  }

  // Groups the 27 starters (all 9 generations) by their primary type — every
  // one of them is Grass, Fire, or Water at the base stage — then picks one
  // random name from each group. Guarantees the 3 offered starters are
  // always of 3 distinct types (no two Fire starters, etc.), while still
  // drawing from the full cross-generation pool rather than a fixed trio.
  function pickStarterTrio(){
    const byType = {};
    STARTERS.forEach(name => {
      const mon = POKEMON_BY_NAME[name];
      if(!mon) return;
      const t = mon.types[0];
      (byType[t] = byType[t] || []).push(name);
    });
    const trio = Object.values(byType).map(names => pick(names));
    // Object.values above always yields Grass/Fire/Water in that fixed
    // order (STARTERS is grouped by type), which in Pro mode would let the
    // player infer a hidden card's type just from its position, so shuffle
    // so the slot order carries no information.
    return pickN(trio, trio.length);
  }

  let starterChoices = []; // current trio, indexed — lets Pro mode use data-idx instead of leaking data-name in the DOM

  function starterCardRevealHTML(mon){
    return `
      ${avatarHTML(mon)}
      <span class="c-name">${displayName(mon.name)}</span>
      <div class="c-types">${typeChipsHTML(mon.types)}</div>`;
  }

  function renderStarterChoices(){
    starterChoices = pickStarterTrio().map(n => POKEMON_BY_NAME[n]).filter(Boolean);
    const grid = document.getElementById('starterGrid');
    const pro = isBlindMode();
    grid.classList.remove('revealing');
    grid.innerHTML = starterChoices.map((mon,i) => `
      <button class="starter-card${pro ? ' mystery-card' : ''}" data-idx="${i}">
        ${pro ? mysteryCardHTML() : starterCardRevealHTML(mon)}
      </button>`).join('');
    grid.querySelectorAll('.starter-card').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        if(pro){
          if(grid.classList.contains('revealing')) return;
          grid.classList.add('revealing');
          revealProGrid(grid, '.starter-card', starterChoices, starterCardRevealHTML, idx, () => {
            grid.classList.remove('revealing');
            selectStarter(starterChoices[idx]);
          });
        } else {
          selectStarter(starterChoices[idx]);
        }
      });
    });
  }

  function selectStarter(mon){
    starter = mon;
    activeTeam = [mon];
    storage_ = [];
    // Gold is per-run spending money, not a meta-progression currency — any
    // leftover from a previous run must not carry into this new one.
    META.gold = STARTING_GOLD;
    saveMeta();
    inv = {
      balls: BASE_BALL_COUNT + META.extraBalls,
      greatBalls: 0, ultraBalls: 0, masterBalls: 0,
      berrySnack: 0, pokeTreat: 0,
      potions: 0, revives: 0,
      rerollTickets: BASE_REROLL_COUNT, // 1 free reroll per run; more can be bought at the PokeStop
      megaStone: 0,
    };
    encounterNum = 1;
    runTrainersBeaten = 0;
    runBadges = 0;
    runChampion = false;
    runGoldEarned = 0;
    trainerLoss = null;
    legendaryHandled = false; // false | 'caught' | 'fled'
    mythicalHandled = false; // false | 'caught' | 'fled'
    pendingEvolution = null;
    runBeatenBadges = new Set();
    eliteIndex = 0;
    eliteUsedNames = new Set();
    seenWildNames = new Set();
    casinoTokens = 0;
    firstGymBonusEncounterUsed = false;
    legendaryBonusEncounterUsed = false;
    eliteBonusEncounterUsed = false;
    cruiseStageIndex = null;
    cruiseMiniEventUsed = { fishing:false, slots:false };
    shopBoughtCounts = {};
    shopLifetimeBonus = {};
    itemsBought = {};
    itemsUsed = {};
    runStartedAt = Date.now();
    hasComputerNotification = false;
    newArrivalNames = [];
    safariCatchCount = 0;
    fishingCatchCount = 0;
    evolvedSpeciesThisRun = new Set();
    playerStatusEffectsApplied = 0;
    eliteGauntletFlawless = true;
    comebackKidAchieved = false;
    tokenExchangeBought = false;
    goldSpentOnSlots = 0;
    renderComputerNotifDot();

    document.getElementById('starterScreen').classList.remove('active');
    startEncounter();
  }

  // ---------- WILD ENCOUNTER ----------
  let wildChoices, target, pendingMultiplier, pendingFleeReduction, pendingNoCritFlee, catchBusy, encounterOver;

  // What to do once the current wild encounter resolves (catch, flee, or
  // walk away). Defaults to the route trainer fight; challengeBadge()
  // temporarily points this at the Gym battle for the one-time bonus
  // encounter before the player's first ever badge challenge.
  let postEncounterAction = () => startTrainerBattle();
  function proceedAfterEncounter(){
    const action = postEncounterAction;
    postEncounterAction = () => startTrainerBattle(); // reset to the default for next time
    action();
  }

  function wildPool(){
    return POKEMON.filter(p => !p.legendary && p.id <= NATIONAL_DEX_MAX
      && !PARADOX_POKEMON.includes(p.name)
      && !activeTeam.some(c => c.name === p.name)
      && !storage_.some(c => c.name === p.name));
  }

  // Wraps wildPool() for every genuine "catch"/reward mechanic (main wild
  // encounters, Safari Zone, Casino jackpot mon, Token Exchange) — a
  // starter's entire evolutionary line (base + stage 1 + stage 2) can never
  // be caught, so the player's own starter always stays unique. Battle-
  // opponent pools (trainers/gyms/Elite Four/Cruise/Rival) use wildPool()
  // directly and are unaffected — this is only about what can join the
  // player's team via catching.
  function catchablePool(){
    return wildPool().filter(p => !STARTER_LINE_NAMES.has(p.name));
  }

  // How many of the most-recently-shown wild species (across every run,
  // not just this one) to keep deprioritizing — see recentlySeenAcrossRuns().
  const RECENT_WILD_CAP = 150;

  function recentlySeenAcrossRuns(){
    return new Set(META.recentWildNames || []);
  }

  // Only used by the wild-encounter-list pipeline below (pickWildChoices,
  // ensureGenerationDiversity) — excludes every species already shown in
  // ANY encounter list this run, caught or not, so nothing repeats across
  // different encounters. Also *soft*-excludes species shown recently in
  // PAST runs (see markWildChoicesSeen()/META.recentWildNames), so starting
  // a fresh run doesn't immediately resurface the same easy-tier mons the
  // last run just did — falls back to including them if that would leave
  // too few options for a full encounter list.
  function freshWildPool(){
    const base = catchablePool().filter(p => !seenWildNames.has(p.name));
    const crossRunRecent = recentlySeenAcrossRuns();
    const deprioritized = base.filter(p => !crossRunRecent.has(p.name));
    return deprioritized.length >= WILD_COUNT ? deprioritized : base;
  }

  // Records every species just shown so it never appears in a future
  // encounter list this run, whether or not the player catches it. Also
  // pushes them onto the cross-run cooldown queue (META.recentWildNames),
  // trimmed to RECENT_WILD_CAP, oldest dropped first.
  function markWildChoicesSeen(list){
    if(list.length){
      const recent = (META.recentWildNames || []).filter(n => !list.some(mon => mon.name === n));
      list.forEach(mon => recent.push(mon.name));
      META.recentWildNames = recent.slice(-RECENT_WILD_CAP);
      saveMeta();
    }
    list.forEach(mon => seenWildNames.add(mon.name));
  }

  function wildEasyPool(){
    return freshWildPool().filter(p => (p.base_species_rate ?? 0) >= EASY_CATCH_RATE_MIN);
  }

  function wildStrongPool(){
    return freshWildPool().filter(p => p.bst >= WILD_STRONG_MIN_BST);
  }

  // Builds this encounter's wild choices (WILD_COUNT of them). Early on it's all easy-to-catch
  // Pokémon; as encounters go by, easy slots progressively give way to the
  // full pool (rarer, tougher catches), while always keeping at least one
  // easy option available. Past 4 badges earned this run, the ramp steepens
  // further and non-easy slots preferentially pull from the strong pool.
  function pickWildChoices(){
    const full = freshWildPool();
    const easy = wildEasyPool();

    let easySlots;
    if(encounterNum <= ALL_EASY_ENCOUNTERS) easySlots = WILD_COUNT;
    else easySlots = Math.max(MIN_EASY_SLOTS, WILD_COUNT - Math.floor((encounterNum - ALL_EASY_ENCOUNTERS + 1) / 2));
    if(runBadges >= BADGES_FOR_RARITY_RAMP) easySlots = Math.max(MIN_EASY_SLOTS, easySlots - 1);

    const chosenEasy = pickN(easy.length >= easySlots ? easy : full, easySlots);
    const usedNames = new Set(chosenEasy.map(m => m.name));
    const restCount = WILD_COUNT - chosenEasy.length;
    const restPool = full.filter(p => !usedNames.has(p.name));
    const strongPool = wildStrongPool().filter(p => !usedNames.has(p.name));
    const rest = runBadges >= BADGES_FOR_RARITY_RAMP && strongPool.length >= restCount
      ? pickN(strongPool, restCount)
      : pickN(restPool, restCount);

    const combined = pickN([...chosenEasy, ...rest], chosenEasy.length + rest.length); // shuffled combined order
    return ensureGenerationDiversity(combined);
  }

  // Bonus wild encounter right before the Legendary battle — Alola/Galar
  // Pokémon only, last evolution stage only (EVOLUTIONS[name] falsy means
  // nothing left to evolve into), no starters/legendaries (catchablePool()
  // already excludes both).
  function alolaGalarLastStagePool(){
    return catchablePool().filter(p => {
      const g = generationOf(p.id);
      return (g === 7 || g === 8) && !EVOLUTIONS[p.name];
    });
  }

  // Bonus wild encounter right before the Elite Four — the strongest (by
  // BST) Unova/Kalos/Paldea Pokémon, no starters/legendaries.
  function unovaKalosPaldeaStrongestPool(){
    const candidates = catchablePool().filter(p => {
      const g = generationOf(p.id);
      return g === 5 || g === 6 || g === 9;
    });
    return candidates.sort((a,b) => b.bst - a.bst).slice(0, WILD_COUNT);
  }

  // Shared driver for both bonus encounters above, shows a wild-encounter
  // picker like startEncounter(), but from a fixed curated pool instead of
  // the normal easy/full ramp, and resumes into `onDone` afterward instead
  // of the default trainer battle. Respects Pro/Nuzlocke's mystery cards
  // like any other encounter (see renderWildChoices()).
  function startCuratedBonusEncounter(pool, onDone){
    postEncounterAction = onDone;
    wildChoices = pickN(pool, Math.min(WILD_COUNT, pool.length)).map(mon =>
      Math.random() < SHINY_CHANCE ? { ...mon, is_shiny:true } : mon
    );
    markWildChoicesSeen(wildChoices);
    document.getElementById('encounterNum').textContent = encounterNum;
    document.getElementById('starterName').textContent = starter.name;
    revealWildEncounter();
  }

  // National Dex id ranges per generation — used only to guarantee variety
  // across a single encounter's shown list, not for anything else.
  const GENERATIONS = [
    { gen:1, minId:1,   maxId:151 },
    { gen:2, minId:152, maxId:251 },
    { gen:3, minId:252, maxId:386 },
    { gen:4, minId:387, maxId:493 },
    { gen:5, minId:494, maxId:649 },
    { gen:6, minId:650, maxId:721 },
    { gen:7, minId:722, maxId:809 },
    { gen:8, minId:810, maxId:905 },
    { gen:9, minId:906, maxId:1025 },
  ];
  function generationOf(id){
    const g = GENERATIONS.find(g => id >= g.minId && id <= g.maxId);
    return g ? g.gen : null;
  }

  // Fairness pass for wild encounters only (not the Legendary/Mythical picks,
  // which use their own separate pools entirely) — guarantees at least one
  // Pokémon from every generation shows up among the encounter's choices, so
  // no single generation dominates the list run after run. Fills any missing
  // generation by swapping out a slot from whichever generation currently
  // has the most duplicates, preferring an easy-to-catch replacement so it
  // doesn't undermine the early-game difficulty ramp.
  function ensureGenerationDiversity(list){
    const usedNames = new Set(list.map(m => m.name));
    const genCounts = {};
    list.forEach(m => { const g = generationOf(m.id); genCounts[g] = (genCounts[g] || 0) + 1; });
    const missingGens = GENERATIONS.map(g => g.gen).filter(g => !genCounts[g]);
    if(!missingGens.length) return list;

    const result = [...list];
    missingGens.forEach(missingGen => {
      const easyCandidates = wildEasyPool().filter(p => generationOf(p.id) === missingGen && !usedNames.has(p.name));
      const anyCandidates = freshWildPool().filter(p => generationOf(p.id) === missingGen && !usedNames.has(p.name));
      const candidatePool = easyCandidates.length ? easyCandidates : anyCandidates;
      if(!candidatePool.length) return; // nothing available for this generation right now
      const replacement = pick(candidatePool);

      // Swap into whichever slot belongs to the generation with the most
      // duplicates currently in the list (least impact on variety overall).
      let victimIdx = -1, victimGen = null, maxCount = 1;
      result.forEach((m,i) => {
        const g = generationOf(m.id);
        if(genCounts[g] > maxCount){ maxCount = genCounts[g]; victimIdx = i; victimGen = g; }
      });
      if(victimIdx === -1){ victimIdx = 0; victimGen = generationOf(result[0].id); }

      usedNames.delete(result[victimIdx].name);
      genCounts[victimGen]--;
      result[victimIdx] = replacement;
      usedNames.add(replacement.name);
      genCounts[missingGen] = (genCounts[missingGen] || 0) + 1;
    });
    return result;
  }


  function startEncounter(){
    document.getElementById('encounterNum').textContent = encounterNum;
    document.getElementById('starterName').textContent = starter.name;

    // Always show a wild Pokémon encounter before the trainer, even with no
    // Pokéballs left — the catch screen offers a "walk away" out in that case.
    wildChoices = pickWildChoices().map(mon =>
      Math.random() < SHINY_CHANCE ? { ...mon, is_shiny:true } : mon
    );
    markWildChoicesSeen(wildChoices);

    if(Math.random() < ITEM_EVENT_CHANCE){
      openItemFindEvent(revealWildEncounter);
    } else {
      revealWildEncounter();
    }
  }

  function revealWildEncounter(){
    document.getElementById('encounterScreen').classList.add('active');
    renderWildChoices();
    renderRerollButton();
  }

  function renderRerollButton(){
    const btn = document.getElementById('rerollBtn');
    if(!btn) return;
    // Pointless in Pro/Nuzlocke: the list it would reshuffle is hidden behind
    // mystery cards, so there's nothing to see before deciding to reroll.
    if(isBlindMode()){ btn.style.display = 'none'; return; }
    btn.style.display = '';
    btn.disabled = inv.rerollTickets <= 0;
    btn.textContent = `🔄 REROLL THIS LIST (${inv.rerollTickets} LEFT)`;
  }

  // Not for the starter pick — only the wild-encounter list. 1 free per run,
  // more can be bought as Reroll Tickets at the PokeStop.
  function rerollWildChoices(){
    if(inv.rerollTickets <= 0) return;
    inv.rerollTickets--;
    trackItemUsed('rerollTickets');
    wildChoices = pickWildChoices().map(mon =>
      Math.random() < SHINY_CHANCE ? { ...mon, is_shiny:true } : mon
    );
    markWildChoicesSeen(wildChoices);
    renderWildChoices();
    renderRerollButton();
  }

  // ---------- RANDOM EVENT: ITEM FIND ----------
  function openItemFindEvent(onContinue){
    const found = pick(FOUND_ITEM_POOL);
    const amount = randInt(found.min, found.max);
    inv[found.invKey] = (inv[found.invKey] || 0) + amount;

    document.getElementById('itemFindCard').innerHTML = `
      ${itemIconHTML(found.invKey)}
      <div class="item-find-name">+${amount} ${found.label}</div>
    `;
    document.getElementById('itemFindScreen').classList.add('active');

    const btn = document.getElementById('itemFindContinueBtn');
    btn.onclick = () => {
      document.getElementById('itemFindScreen').classList.remove('active');
      onContinue();
    };
  }

  // Pro mode's "mystery" card — no name, type, or art, so nothing about the
  // Pokémon underneath leaks into the DOM before it's actually picked.
  function mysteryCardHTML(){
    return `<div class="avatar mystery-avatar"><span class="mystery-mark">?</span></div>
      <span class="c-name">???</span>`;
  }

  function wildCardRevealHTML(mon){
    return `
      ${avatarHTML(mon)}
      <span class="c-name">${displayName(mon.name)}</span>
      <div class="c-types">${typeDotsHTML(mon.types)}</div>
      ${mon.is_shiny ? '<span class="shiny-dot" title="Shiny!">✨</span>' : ''}`;
  }

  // Pro mode reveal sequence: the card the player just clicked flips over
  // slowly with a highlighted border, then every other still-covered card
  // in the same grid flips over quickly right after, so the player sees
  // what they passed on. Calls `onDone` once every card has revealed.
  function revealProGrid(grid, cardSelector, choices, buildRevealHTML, clickedIdx, onDone){
    const cards = Array.from(grid.querySelectorAll(cardSelector));

    function reveal(btn, mon, selected){
      btn.classList.remove('mystery-card');
      btn.classList.toggle('selected-reveal', selected);
      btn.innerHTML = `<div class="card-reveal-content">${buildRevealHTML(mon)}</div>`;
      const content = btn.querySelector('.card-reveal-content');
      void content.offsetWidth; // force reflow so the transition actually plays
      content.classList.add('shown');
    }

    reveal(cards[clickedIdx], choices[clickedIdx], true);

    const OTHERS_DELAY = 550; // let the selected card's slow flip read first
    const OTHERS_STAGGER = 60;
    let otherCount = 0;
    cards.forEach((btn, i) => {
      if(i === clickedIdx) return;
      const delay = OTHERS_DELAY + otherCount * OTHERS_STAGGER;
      otherCount++;
      setTimeout(() => reveal(btn, choices[i], false), delay);
    });

    const REVEALED_PAUSE = 2000; // let the player look over everything before auto-advancing
    const totalTime = OTHERS_DELAY + otherCount * OTHERS_STAGGER + 300 + REVEALED_PAUSE;
    setTimeout(onDone, totalTime);
  }

  function renderWildChoices(){
    const grid = document.getElementById('wildGrid');
    const pro = isBlindMode();
    grid.classList.remove('revealing');
    grid.innerHTML = wildChoices.map((mon,i) => `
      <button class="wild-card${pro ? ' mystery-card' : ''}" data-idx="${i}">
        ${pro ? mysteryCardHTML() : wildCardRevealHTML(mon)}
      </button>`).join('');

    grid.querySelectorAll('.wild-card').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        if(pro){
          if(grid.classList.contains('revealing')) return;
          grid.classList.add('revealing');
          revealProGrid(grid, '.wild-card', wildChoices, wildCardRevealHTML, idx, () => {
            grid.classList.remove('revealing');
            selectWildTarget(wildChoices[idx]);
          });
        } else {
          selectWildTarget(wildChoices[idx]);
        }
      });
    });
    checkpoint('encounter');
  }

  function selectWildTarget(mon){
    target = mon;
    pendingMultiplier = 1;
    pendingFleeReduction = 0;
    pendingNoCritFlee = false;
    catchBusy = false;
    encounterOver = false;

    document.getElementById('encounterScreen').classList.remove('active');
    document.getElementById('catchScreen').classList.add('active');
    document.getElementById('catchStarterName').textContent = starter.name;
    document.getElementById('catchLog').innerHTML = '';
    document.getElementById('catchTarget').innerHTML = `
      ${avatarHTML(target)}
      <span class="c-name">${displayName(target.name)}</span>
      <div class="c-types">${typeChipsHTML(target.types)}</div>
      ${shinyTagHTML(target)}
    `;
    renderInventoryStrip();
    renderCatchActions();
  }

  function renderInventoryStrip(){
    const el = document.getElementById('catchInventory');
    if(!el) return;
    const entries = [['Balls', inv.balls, 'balls'], ['Great', inv.greatBalls, 'greatBalls'], ['Ultra', inv.ultraBalls, 'ultraBalls']];
    if(inv.masterBalls > 0) entries.push(['Master', inv.masterBalls, 'masterBalls']);
    entries.push(['Berry', inv.berrySnack, 'berrySnack'], ['Treat', inv.pokeTreat, 'pokeTreat']);
    el.innerHTML = entries.map(([label,count,key]) => `<div class="inv-chip">${itemIconHTML(key)}<span class="inv-count">${count}</span><span class="inv-label">${label}</span></div>`).join('');
  }

  function canThrow(){ return inv.balls > 0 || inv.greatBalls > 0 || inv.ultraBalls > 0 || inv.masterBalls > 0; }

  function renderCatchActions(){
    const busy = catchBusy || encounterOver;

    // The food-item boost (pendingMultiplier) applies to computeCatchChance()
    // regardless of which ball kind gets thrown next — show the "(BOOSTED)"
    // tag on every throwable ball, not just the Pokéball, so that's clear.
    // Master Ball is the one exception: it bypasses the formula entirely.
    const boostedTag = pendingMultiplier > 1 ? ' (BOOSTED)' : '';

    const throwBtn = document.getElementById('throwBtn');
    throwBtn.disabled = busy || inv.balls <= 0;
    throwBtn.textContent = `THROW POKÉBALL ×${inv.balls}${boostedTag}`;
    throwBtn.onclick = () => resolveThrow('balls');

    const greatBtn = document.getElementById('greatBallBtn');
    greatBtn.style.display = inv.greatBalls > 0 ? 'block' : 'none';
    greatBtn.disabled = busy || inv.greatBalls <= 0;
    greatBtn.textContent = `THROW GREAT BALL ×${inv.greatBalls}${boostedTag}`;
    greatBtn.onclick = () => resolveThrow('greatBalls');

    const ultraBtn = document.getElementById('ultraBallBtn');
    ultraBtn.style.display = inv.ultraBalls > 0 ? 'block' : 'none';
    ultraBtn.disabled = busy || inv.ultraBalls <= 0;
    ultraBtn.textContent = `THROW ULTRA BALL ×${inv.ultraBalls}${boostedTag}`;
    ultraBtn.onclick = () => resolveThrow('ultraBalls');

    const masterBtn = document.getElementById('masterBallBtn');
    masterBtn.style.display = inv.masterBalls > 0 ? 'block' : 'none';
    masterBtn.disabled = busy || inv.masterBalls <= 0;
    masterBtn.textContent = `THROW MASTER BALL ×${inv.masterBalls} (GUARANTEED)`;
    masterBtn.onclick = () => resolveThrow('masterBalls');

    Object.keys(FOOD_ITEMS).forEach(kind => {
      const btn = document.getElementById(`${kind}Btn`);
      if(!btn) return;
      btn.disabled = busy || inv[kind] <= 0;
      btn.innerHTML = `${itemIconHTML(kind)}${FOOD_ITEMS[kind].label} ×${inv[kind]}`;
      btn.onclick = () => useFoodItem(kind);
    });

    const walkAwayBtn = document.getElementById('walkAwayBtn');
    walkAwayBtn.style.display = canThrow() ? 'none' : 'block';
    walkAwayBtn.disabled = busy;
    walkAwayBtn.onclick = walkAway;

    const skipBtn = document.getElementById('skipCatchBtn');
    skipBtn.disabled = busy;
    skipBtn.onclick = skipCatch;
  }

  function walkAway(){
    if(catchBusy || encounterOver || canThrow()) return;
    catchBusy = true;
    appendCatchLog(`Out of Pokéballs: you leave ${displayName(target.name)} alone and move on.`);
    encounterOver = true;
    renderCatchActions();
    setTimeout(proceedAfterEncounter, 900);
  }

  // Lets the player give up on a catch attempt at any time, ball supply or
  // not, instead of being forced to burn through every Pokéball first.
  function skipCatch(){
    if(catchBusy || encounterOver) return;
    catchBusy = true;
    appendCatchLog(`You give up on ${displayName(target.name)} and move on.`);
    encounterOver = true;
    renderCatchActions();
    setTimeout(proceedAfterEncounter, 900);
  }

  // Only the latest line is shown — no piling up of prior attempts, keeps
  // the catch screen compact and scroll-free.
  function appendCatchLog(text){
    const wrap = document.getElementById('catchLog');
    wrap.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'catch-log-line';
    line.textContent = text;
    wrap.appendChild(line);
  }

  function useFoodItem(kind){
    if(catchBusy || encounterOver || inv[kind] <= 0) return;
    const item = FOOD_ITEMS[kind];
    inv[kind]--;
    trackItemUsed(kind);
    pendingMultiplier *= item.boost;
    pendingFleeReduction = Math.max(pendingFleeReduction, item.fleeReduction);
    if(item.noCritFlee) pendingNoCritFlee = true;
    renderInventoryStrip();
    renderCatchActions();
    appendCatchLog(`You used a ${item.label} on ${displayName(target.name)}. Catch chance up!`);
  }

  // catch_chance = base_species_rate × ball_modifier × (food multiplier stack).
  // Master Ball bypasses the formula entirely.
  function computeCatchChance(mon, kind){
    if(kind === 'masterBalls') return 1;
    const base = mon.base_species_rate ?? 0.3;
    return clamp(base * BALL_MODIFIERS[kind] * pendingMultiplier, 0, 1);
  }

  // Places a freshly caught Pokémon on the active team if there's room,
  // otherwise into Storage — active roster is always capped at 6.
  // `source`, when given, feeds the Safari Sharpshooter/Reel Deal achievement
  // counters, omitted for a normal wild-encounter catch, which counts toward
  // neither.
  function catchWildTarget(mon, source){
    if(activeTeam.length < MAX_PARTY_SIZE) activeTeam.push(mon);
    else storage_.push(mon);
    flagComputerNotification(mon.name);
    if(source === 'safari') safariCatchCount++;
    else if(source === 'fishing') fishingCatchCount++;
  }

  function resolveThrow(kind){
    if(catchBusy || encounterOver || inv[kind] <= 0) return;
    catchBusy = true;
    inv[kind]--;
    trackItemUsed(kind);

    const chance = computeCatchChance(target, kind);
    const fleeChance = pendingNoCritFlee ? 0 : Math.max(0, BALL_BASE_FLEE_CHANCE - pendingFleeReduction);
    pendingMultiplier = 1;
    pendingFleeReduction = 0;
    pendingNoCritFlee = false;

    renderInventoryStrip();
    renderCatchActions();
    appendCatchLog(`You threw a ${BALL_LABELS[kind]} at ${displayName(target.name)}...`);

    setTimeout(() => {
      const success = Math.random() < chance;
      if(success){
        catchWildTarget(target);
        appendCatchLog(`Gotcha! ${displayName(target.name)} was caught!`);
        encounterOver = true;
        renderCatchActions();
        setTimeout(proceedAfterEncounter, 900);
        return;
      }
      if(Math.random() < fleeChance){
        appendCatchLog(`${displayName(target.name)} broke free and fled!`);
        encounterOver = true;
        renderCatchActions();
        setTimeout(proceedAfterEncounter, 900);
        return;
      }
      if(canThrow()){
        appendCatchLog(`${displayName(target.name)} broke free! Still got balls left.`);
        catchBusy = false;
        renderCatchActions();
      } else {
        appendCatchLog(`${displayName(target.name)} broke free and ran off...`);
        encounterOver = true;
        renderCatchActions();
        setTimeout(proceedAfterEncounter, 900);
      }
    }, 700);
  }

  // ---------- CHAMPION ENDING (shown once, right after the 4th Elite Four win) ----------
  // Extends the existing end-of-run flow rather than replacing it: this
  // screen's own Continue button is what calls finishEncounter() to reach
  // the normal result screen. The Master Ball reward itself is already
  // granted in endBattle() the moment the 4th member falls (inv.masterBalls++).
  function openChampionEnding(){
    const el = document.getElementById('championScreen');
    el.classList.add('active');
    el.innerHTML = `
      <div class="eyebrow">⭐ Elite Four Cleared</div>
      <h1 class="section-h1">YOU ARE THE CHAMPION!</h1>
      <p class="tagline">All four Elite Four members have fallen. Your name enters the Hall of Fame.</p>
      <div class="champion-scene">
        <div class="champion-silhouettes">${ELITE_FOUR.map(() => '<span class="silhouette">👤</span>').join('')}</div>
        <img class="champion-masterball" src="${ITEM_ICON_DIR}/${ITEM_ICONS.masterBalls}" alt="Master Ball" onerror="this.style.display='none'">
      </div>
      <p class="tagline">As Champion, you're awarded a <b>Master Ball</b>, guaranteed to catch anything, no exceptions.</p>
      <button class="btn-primary" id="championContinueBtn" style="margin-top:16px;">CONTINUE</button>
    `;
    document.getElementById('championContinueBtn').addEventListener('click', () => {
      el.classList.remove('active');
      el.innerHTML = '';
      finishEncounter();
    });
  }

  function finishEncounter(){
    // Identify the starter by reference, not position, the Computer screen
    // lets the player reorder activeTeam, so the starter isn't always slot 0.
    const allCaught = [...activeTeam.filter(m => m !== starter), ...storage_];
    const run = {
      starter, caught: allCaught, trainersBeaten: runTrainersBeaten, badges: runBadges,
      champion: runChampion, trainerLoss, goldEarned: runGoldEarned,
      beatenBadges: Array.from(runBeatenBadges), eliteBeaten: eliteIndex, legendaryHandled, mythicalHandled,
      activeRoster: activeTeam.slice(), // the final active team, in order, for the spotlight + Hall of Fame card
      mode: gameMode,
      // Everything below feeds ACHIEVEMENT_DEFS only (see checkAchievements()),
      // nothing here affects scoring or any other part of the result screen.
      itemsUsed, safariCatchCount, fishingCatchCount,
      evolvedCount: evolvedSpeciesThisRun.size,
      playerStatusEffectsApplied, eliteGauntletFlawless, comebackKidAchieved,
      tokenExchangeBought, goldSpentOnSlots, metaGoldTotal: META.gold,
    };
    run.achievements = checkAchievements(run);
    renderResult(run);
  }

  // ---------- TRAINER BATTLE ----------
  let battle;

  function currentPartySize(){ return activeTeam.length; }

  // Hiker Anthony is always a Double Battle — 2 Pokémon a side, both active
  // and fighting at once, exactly like the Cruise Ship's First Mate Talise
  // fight (see CRUISE_SHIP_BATTLES / startDoubleBattle()/doubleBattleStep()).
  // Fixed at 2 regardless of run progress or party size, same as that fight —
  // a Double Battle's squad IS the whole roster for it, there's no bench.
  const DOUBLE_BATTLE_TRAINER_NAME = "Hiker Anthony";
  // Scheduled at a fixed encounter rather than left to the random archetype
  // pick, picking him randomly could land him as early as encounter 1,
  // before the player has caught a 2nd Pokémon to field for the Double
  // Battle. By encounter 5 the player has had several catches, so he's
  // excluded from the random pool everywhere else and forced here instead.
  const DOUBLE_BATTLE_ENCOUNTER_NUM = 5;

  function rollTrainer(){
    // The last 3 route trainers of the run (fought on the way to the 6th,
    // 7th, and 8th badges) get a bigger squad — a deterministic 4, then 5,
    // then 6 Pokémon — as a predictable final ramp-up before the endgame.
    // Before that, squad size climbs steadily: +1 for every 3 badges earned,
    // capped well below a full team.
    const finalStretchStart = BADGES_TO_UNLOCK_ENDGAME - 3;
    const isFinalStretch = runBadges >= finalStretchStart;

    let pool;
    if(isFinalStretch){
      // Squad size and raw strength both ramp together here — see
      // ROUTE_FINAL_STRETCH_TIERS. Clamped to the last tier (same pattern as
      // GYM_DIFFICULTY_TIERS below) since runBadges can reach/exceed
      // BADGES_TO_UNLOCK_ENDGAME while a route trainer is still in flight —
      // an unclamped index here used to read past the array's end and crash.
      const tier = ROUTE_FINAL_STRETCH_TIERS[Math.min(runBadges - finalStretchStart, ROUTE_FINAL_STRETCH_TIERS.length - 1)];
      pool = wildPool().filter(p => p.bst >= tier.minBst && p.bst <= tier.maxBst);
    } else {
      // The player's very first route trainer fight this run gets an extra-easy
      // cap, giving a fresh starter better odds before it's had a chance to grow.
      const maxBst = encounterNum === 1 ? FIRST_TRAINER_MAX_BST : LOW_TIER_MAX_BST;
      pool = wildPool().filter(p => p.bst <= maxBst);
    }

    // Forced at the scheduled encounter (as long as the player actually has
    // 2 Pokémon to field); the random pick below never lands on him otherwise.
    if(encounterNum === DOUBLE_BATTLE_ENCOUNTER_NUM && currentPartySize() >= 2){
      const name = DOUBLE_BATTLE_TRAINER_NAME;
      return { name, squad: pickN(pool, 2), isGym:false, isDouble:true, portraitFile: trainerPortraitFile(name) };
    }

    const name = pick(TRAINER_ARCHETYPES.filter(n => n !== DOUBLE_BATTLE_TRAINER_NAME));

    const squadSize = BEEFED_UP_ROUTE_ENCOUNTERS.includes(encounterNum)
      ? randInt(BEEFED_UP_ROUTE_MIN_SQUAD, BEEFED_UP_ROUTE_MAX_SQUAD)
      : isFinalStretch
        ? Math.min(4 + (runBadges - finalStretchStart), currentPartySize())
        : Math.min(
            ROUTE_TRAINER_SQUAD_SIZE + Math.floor(runBadges / 3),
            ROUTE_TRAINER_MAX_SQUAD,
            currentPartySize()
          );
    return { name, squad: pickN(pool, squadSize), isGym:false, portraitFile: trainerPortraitFile(name) };
  }

  // Dual-type Gym Leaders (badge.types.length === 2) can't field a squad
  // that's effectively mono-typed on their *first* listed type — at least 1
  // Pokémon must carry the 2nd specialty type, either alone or combined with
  // the 1st (a mon with both already satisfies "carries the 2nd type", so a
  // single check covers both cases the spec calls out). Re-rolls the whole
  // squad first (keeps the roll fair), then as a last resort widens the
  // search to every reachable Pokémon of that type and swaps one random
  // slot, rather than looping forever if the tier's own pool has none.
  const GYM_TYPE_RULE_MAX_REROLLS = 20;
  function ensureSecondTypeRepresented(squad, pool, secondType, squadSize){
    let attempt = squad;
    for(let i = 0; i < GYM_TYPE_RULE_MAX_REROLLS && !attempt.some(p => p.types.includes(secondType)); i++){
      attempt = pickN(pool, squadSize);
    }
    if(attempt.some(p => p.types.includes(secondType))) return attempt;
    const fallbackPool = wildPool().filter(p => p.types.includes(secondType));
    if(!fallbackPool.length) return attempt; // nothing in the whole game has this type — nothing more to do
    attempt[randInt(0, attempt.length - 1)] = pick(fallbackPool);
    return attempt;
  }

  // Difficulty comes from how many badges are already earned this run, not
  // from which badge was picked. Squad is type-matched to the badge when
  // possible; if too few Pokémon of that type fall in the strength band,
  // falls back to the untyped band pool rather than shrinking the squad.
  function rollBadgeGym(badge){
    const tier = GYM_DIFFICULTY_TIERS[Math.min(runBadges, GYM_DIFFICULTY_TIERS.length - 1)];
    const squadSize = Math.min(tier.squadSize, currentPartySize());
    const band = wildPool().filter(p => p.bst >= tier.minBst && p.bst <= tier.maxBst);
    const typed = band.filter(p => p.types.some(t => badge.types.includes(t)));
    const pool = typed.length >= squadSize ? typed : band;
    let squad = pickN(pool, squadSize);
    if(badge.types.length === 2) squad = ensureSecondTypeRepresented(squad, pool, badge.types[1], squadSize);
    return { name: badge.leaderName, squad, isGym:true, badgeKey: badge.key, badgeIcon: badge.icon, badgeTypes: badge.types };
  }

  function rollEliteMember(tier, isFinal){
    const band = wildPool().filter(p => p.bst >= tier.minBst && p.bst <= tier.maxBst && !PARADOX_POKEMON.includes(p.name));
    // Never repeat a Pokémon another Elite Four member already fielded this
    // run — falls back to the full band only if it's ever too small to fill
    // a 6-Pokémon squad without repeats (shouldn't happen in practice given
    // how wide/overlapping the tier bands are).
    const unused = band.filter(p => !eliteUsedNames.has(p.name));
    // Elite Four squads are always full strength (6 Pokémon) regardless of
    // the player's own active roster size — unlike route/gym trainers, they
    // never scale down to match the player.
    const squadSize = tier.squadSize;
    const pool = unused.length >= squadSize ? unused : band;
    const squad = pickN(pool, squadSize);

    // Every Elite Four member fields at least one Generation 9 Pokémon —
    // swapped in if the roll didn't already land one naturally.
    let gen9Idx = squad.findIndex(p => generationOf(p.id) === 9);
    if(gen9Idx === -1){
      const gen9Options = pool.filter(p => generationOf(p.id) === 9 && !squad.includes(p));
      const fallbackGen9 = gen9Options.length ? gen9Options : band.filter(p => generationOf(p.id) === 9 && !squad.includes(p));
      if(fallbackGen9.length){
        gen9Idx = 0;
        squad[gen9Idx] = pick(fallbackGen9);
      }
    }

    // The final Elite Four member also always fields one Mega-Evolved
    // Pokémon — the last real difficulty spike before Champion. Swapped into
    // a different slot than the Gen 9 pick above so both hold at once.
    if(isFinal){
      const megaCandidates = pool.filter(p => MEGA_FORMS_BY_BASE[p.name] && MEGA_FORMS_BY_BASE[p.name].length && !squad.includes(p));
      const allMegaCapable = megaCandidates.length ? megaCandidates
        : Object.keys(MEGA_FORMS_BY_BASE).map(n => POKEMON_BY_NAME[n]).filter(p => p && !squad.includes(p));
      if(allMegaCapable.length){
        const megaBase = pick(allMegaCapable);
        const megaForm = POKEMON_BY_NAME[pick(MEGA_FORMS_BY_BASE[megaBase.name])];
        let megaIdx = squad.length - 1;
        if(megaIdx === gen9Idx) megaIdx = Math.max(0, squad.length - 2);
        squad[megaIdx] = megaForm;
      }
    }

    squad.forEach(p => eliteUsedNames.add(p.name));
    return { name: tier.name, squad, isElite:true, isFinalElite: !!isFinal, portraitFile: eliteFourPortraitFile(tier.name) };
  }

  // Cruise Ship battles are all Water-type, falling back to the untyped
  // strength band if too few Water-types qualify (same pattern as gym badges).
  function rollCruiseBattle(tier){
    const pool = wildPool().filter(p => p.bst >= tier.minBst && p.bst <= tier.maxBst);
    const waterPool = pool.filter(p => p.types.includes('water'));
    // The Double Battle's 2-Pokémon squad is fixed, not scaled down to match
    // the player's roster (mirrors how Elite Four/Rival squads never shrink).
    const squadSize = tier.isDouble ? tier.squadSize : Math.min(tier.squadSize, currentPartySize());
    const finalPool = waterPool.length >= squadSize ? waterPool : pool;
    return { name: tier.name, squad: pickN(finalPool, squadSize), isCruise:true, isCaptain: !!tier.isCaptain, isDouble: !!tier.isDouble };
  }

  function rollCruiseRival(){
    const pool = wildPool().filter(p => p.bst >= CRUISE_RIVAL.minBst && p.bst <= CRUISE_RIVAL.maxBst);
    // Always the full 6, regardless of the player's own roster size — same
    // rule as the Elite Four (see rollEliteMember()): the Rival never scales
    // down to match the player.
    const squadSize = CRUISE_RIVAL.squadSize;
    const squad = pickN(pool, squadSize);

    // Fukugawa always fields a Mega Raichu (X or Y, picked at random each
    // run), replacing one squad slot. The rest of his team stays whatever
    // the roll above produced.
    const megaRaichuForm = POKEMON_BY_NAME[pick(MEGA_FORMS_BY_BASE['raichu'])];
    if(megaRaichuForm) squad[randInt(0, squad.length - 1)] = megaRaichuForm;

    return { name: CRUISE_RIVAL.name, squad, isRival:true, portraitFile: trainerPortraitFile(CRUISE_RIVAL.name) };
  }

  function movesFor(mon){
    const set = MOVESETS[mon.name];
    return set && set.length ? set : [FALLBACK_MOVE];
  }

  // ---------- STATUS EFFECTS ----------
  // A battler's `status` is either null (no condition) or a generic
  // { type, turnsRemaining? } shape — `turnsRemaining` is only set for
  // turn-limited effects (Sleep); poison/burn omit it and just last until
  // cured, fainted, or the battle ends. Only one status can be active at a
  // time (applying a new one while already statused is a no-op), matching
  // how the mainline games handle major status conditions.
  //
  // Move name -> chance (0-1) of inflicting a status on a successful hit.
  // Kept as a standalone lookup (by move name) rather than a field on the
  // generated data/battle_moves.json entries, since that file only carries
  // {name,type,power,accuracy,damage_class} and is regenerated from PokeAPI
  // by build_battle_moves.py — adding a field there would mean re-touching
  // every occurrence of every move across every Pokémon's moveset.
  //
  // Sleep-inducing moves (chance:1 — they always land the *status* once the
  // move itself hits, exactly like the mainline games; the move's own
  // `accuracy` is what can miss) don't exist anywhere in the loaded moveset
  // data at all — see SLEEP_MOVE_INJECTIONS/SLEEP_MOVE_DEFS below and their
  // use in loadData() for why and how they're hand-added.
  const MOVE_STATUS_EFFECTS = {
    'poison sting': { type:'poison', chance:0.3 },
    'poison fang':  { type:'poison', chance:0.3 },
    'poison jab':   { type:'poison', chance:0.3 },
    'poison tail':  { type:'poison', chance:0.1 },
    'poison gas':   { type:'poison', chance:0.9 },
    'poison powder':{ type:'poison', chance:0.9 },
    'smog':         { type:'poison', chance:0.4 },
    'sludge':       { type:'poison', chance:0.3 },
    'sludge bomb':  { type:'poison', chance:0.3 },
    'sludge wave':  { type:'poison', chance:0.1 },
    'gunk shot':    { type:'poison', chance:0.3 },
    'cross poison': { type:'poison', chance:0.1 },
    'twineedle':    { type:'poison', chance:0.2 },
    'toxic':        { type:'poison', chance:1 },
    // Burn — real per-hit chances from the mainline games (moves like
    // Overheat/Eruption/Blast Burn/Burn Up/Fusion Flare hit hard but have no
    // secondary burn chance in canon, so they're deliberately left out here).
    'fire blast':   { type:'burn', chance:0.1 },
    'fire punch':   { type:'burn', chance:0.1 },
    'flamethrower': { type:'burn', chance:0.1 },
    'flare blitz':  { type:'burn', chance:0.1 },
    'pyro ball':    { type:'burn', chance:0.1 },
    'sacred fire':  { type:'burn', chance:0.5 },
    'scald':        { type:'burn', chance:0.3 },
    // Sleep — always applies once the move itself lands (see SLEEP_MOVE_DEFS
    // for each move's real per-mainline-games accuracy).
    'sleep powder': { type:'sleep', chance:1 },
    'spore':        { type:'sleep', chance:1 },
    'hypnosis':     { type:'sleep', chance:1 },
    'sing':         { type:'sleep', chance:1 },
    'lovely kiss':  { type:'sleep', chance:1 },
  };

  // Which classic species get which sleep move hand-injected into their
  // moveset in loadData() (see the comment above MOVE_STATUS_EFFECTS) — one
  // real canon learner per line/family, not exhaustive.
  const SLEEP_MOVE_INJECTIONS = {
    oddish:'sleep powder', gloom:'sleep powder', vileplume:'sleep powder',
    exeggcute:'sleep powder', exeggutor:'sleep powder',
    paras:'spore', parasect:'spore', breloom:'spore',
    gastly:'hypnosis', haunter:'hypnosis', gengar:'hypnosis', drowzee:'hypnosis', hypno:'hypnosis',
    jigglypuff:'sing', wigglytuff:'sing', clefairy:'sing', clefable:'sing',
    jynx:'lovely kiss', smoochum:'lovely kiss',
  };
  // Real move data (power:0 — pure status moves deal no damage, see
  // computeDamage()) for each sleep move referenced above.
  const SLEEP_MOVE_DEFS = {
    'sleep powder': { name:'sleep powder', type:'grass',   power:0, accuracy:75,  damage_class:'status' },
    'spore':        { name:'spore',        type:'grass',   power:0, accuracy:100, damage_class:'status' },
    'hypnosis':     { name:'hypnosis',     type:'psychic', power:0, accuracy:60,  damage_class:'status' },
    'sing':         { name:'sing',         type:'normal',  power:0, accuracy:55,  damage_class:'status' },
    'lovely kiss':  { name:'lovely kiss',  type:'normal',  power:0, accuracy:75,  damage_class:'status' },
  };

  const POISON_DAMAGE_FRACTION = 1/8;
  const BURN_DAMAGE_FRACTION = 1/16;
  const SLEEP_MIN_TURNS = 1;
  const SLEEP_MAX_TURNS = 3;
  // Log verb for "X was ___!" when a status is first applied — see maybeApplyMoveStatus().
  const STATUS_APPLY_VERB = { poison:'poisoned', burn:'burned', sleep:'put to sleep' };

  function makeBattler(mon){
    const maxHp = Math.round((mon.hp || 45) * 2.2) + 30;
    return { mon, maxHp, hp: maxHp, moves: movesFor(mon), status: null };
  }

  // Rolls a move's status-effect chance against a battler that just got hit
  // by it. No-ops if the move has no associated effect, the target already
  // has a status, or the target just fainted from this same hit — matches
  // the mainline games (status can't be applied to something already fainted
  // or already afflicted).
  function maybeApplyMoveStatus(move, target, attacker){
    if(target.hp <= 0 || target.status) return;
    const effect = MOVE_STATUS_EFFECTS[move.name];
    if(!effect || Math.random() >= effect.chance) return;
    // Fire-types are immune to Burn in the mainline games, no matter which
    // move inflicts it or which side (player or enemy) is attacking — this
    // is the single choke point every burn-inflicting move goes through.
    if(effect.type === 'burn' && target.mon.types.includes('fire')){
      appendBattleLog(`It doesn't affect ${displayName(target.mon.name)}!`, '', 'status');
      return;
    }
    target.status = effect.type === 'sleep'
      ? { type:'sleep', turnsRemaining: randInt(SLEEP_MIN_TURNS, SLEEP_MAX_TURNS) }
      : { type: effect.type };
    if(effect.type === 'sleep' && attacker){
      if(!attacker.usedSleepMoveOn) attacker.usedSleepMoveOn = new Map();
      if(!attacker.usedSleepMoveOn.has(target)) attacker.usedSleepMoveOn.set(target, new Set());
      attacker.usedSleepMoveOn.get(target).add(move.name);
    }
    // Status Effect Specialist achievement, only counts the player's own
    // moves landing a status, not the enemy's.
    if(attacker && battle && battle.player.includes(attacker)) playerStatusEffectsApplied++;
    appendBattleLog(`${displayName(target.mon.name)} was ${STATUS_APPLY_VERB[effect.type] || effect.type}!`, '', `status-${effect.type}`);
  }

  // Checks whether `b` is asleep; if so, this consumes its whole turn (no
  // move, no damage) and ticks its remaining sleep turns down, clearing the
  // status and waking it up once that hits 0. Returns true when the turn
  // was consumed this way, so callers (resolveAttack/resolveDoubleAttack)
  // skip picking a move/dealing damage entirely for this exchange.
  function handleSleepTurn(b){
    if(!b.status || b.status.type !== 'sleep') return false;
    b.status.turnsRemaining--;
    if(b.status.turnsRemaining <= 0){
      b.status = null;
      appendBattleLog(`${displayName(b.mon.name)} woke up!`, '', 'status');
    } else {
      appendBattleLog(`${displayName(b.mon.name)} is fast asleep.`, '', 'status');
    }
    return true;
  }

  // Applies end-of-turn status damage (poison, burn) to a single battler.
  // Returns nothing — mutates hp directly, same as attack damage.
  function applyEndOfTurnStatus(b){
    if(!b || b.hp <= 0 || !b.status) return;
    if(b.status.type === 'poison' || b.status.type === 'burn'){
      const fraction = b.status.type === 'poison' ? POISON_DAMAGE_FRACTION : BURN_DAMAGE_FRACTION;
      const dmg = Math.max(1, Math.floor(b.maxHp * fraction));
      b.hp = Math.max(0, b.hp - dmg);
      const cause = b.status.type === 'poison' ? 'poison' : 'its burn';
      appendBattleLog(`${displayName(b.mon.name)} is hurt by ${cause}!`, `${dmg} damage`, `status-${b.status.type}`);
      if(b.hp <= 0){
        appendBattleLog(`${displayName(b.mon.name)} fainted!`, '', 'faint');
      }
    }
  }

  function typeEffectiveness(moveType, defTypes){
    return defTypes.reduce((mult,t) => mult * (TYPE_CHART[moveType] && TYPE_CHART[moveType][t] !== undefined ? TYPE_CHART[moveType][t] : 1), 1);
  }

  // Avoids picking a move that would land with 0x effectiveness against the
  // current foe (e.g. Normal into Ghost) as long as at least one other move
  // doesn't. If every move on the set is a 0x dud against this foe, there's
  // no way around it — falls back to the full moveset (and will repeat).
  function pickEffectiveMove(attacker, defender){
    const useful = attacker.moves.filter(m => typeEffectiveness(m.type, defender.mon.types) > 0);
    const pool = useful.length ? useful : attacker.moves;
    // Never repeat the exact same sleep-inducing move against a Pokémon it
    // already put to sleep once, a real trainer would switch it up rather
    // than trying the identical move on the same target again.
    const usedOnThisTarget = attacker.usedSleepMoveOn && attacker.usedSleepMoveOn.get(defender);
    const filtered = usedOnThisTarget
      ? pool.filter(m => !(MOVE_STATUS_EFFECTS[m.name]?.type === 'sleep' && usedOnThisTarget.has(m.name)))
      : pool;
    return pick(filtered.length ? filtered : pool);
  }

  const BURN_PHYSICAL_DAMAGE_MULTIPLIER = 0.5;

  function computeDamage(attacker, defender, move){
    const atkStat = move.damage_class === 'special' ? (attacker.mon.sp_atk || 40) : (attacker.mon.attack || 40);
    const defStat = move.damage_class === 'special' ? (defender.mon.sp_def || 40) : (defender.mon.defense || 40);
    const stab = attacker.mon.types.includes(move.type) ? 1.5 : 1;
    const eff = typeEffectiveness(move.type, defender.mon.types);
    const base = ((2*50/5 + 2) * move.power * (atkStat/Math.max(1,defStat))) / 50 + 2;
    const variance = rand(0.85, 1.0);
    // A burned attacker's physical moves (not special) deal half damage —
    // only touches this one multiplier, so nothing about an un-burned
    // attacker's damage changes.
    const burnPenalty = (attacker.status && attacker.status.type === 'burn' && move.damage_class === 'physical')
      ? BURN_PHYSICAL_DAMAGE_MULTIPLIER : 1;
    // Pure status moves (Sleep Powder, Hypnosis, etc.) have power:0 and
    // must deal zero damage — without this, the "+2" flat term above would
    // still round up to a stray 1-2 HP chip on a move that shouldn't touch
    // HP at all.
    const dmg = (eff === 0 || !move.power) ? 0 : Math.max(1, Math.floor(base * stab * eff * variance * burnPenalty));
    return { dmg, eff };
  }

  // EVOLUTIONS[name] is either a single next-species string, or — for
  // Pokémon with more than one real evolution (Eevee, Wurmple, Tyrogue,
  // Rockruff, etc.) — an array of candidate names. Normalizes either shape
  // into a list of valid, existing target names (never throws on a stale
  // or misspelled entry, just filters it out).
  function evolutionOptionsFor(name){
    const raw = EVOLUTIONS[name];
    if(!raw) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    return list.filter(n => POKEMON_BY_NAME[n]);
  }

  // Every regional-form evolution result we have real artwork for, keyed by
  // the standard (non-regional) evolution it substitutes — see
  // rollRegionalEvolution(). Some species (Meowth) have more than one
  // regional line, so the value is always an array.
  const REGIONAL_EVOLUTION_ALT = {
    persian: ["persian-alola", "perrserker"],
    arcanine: ["arcanine-hisui"],
    ninetales: ["ninetales-alola"],
    rapidash: ["rapidash-galar"],
    linoone: ["linoone-galar"],
    dugtrio: ["dugtrio-alola"],
    graveler: ["graveler-alola"],
    muk: ["muk-alola"],
    exeggutor: ["exeggutor-alola"],
    sandslash: ["sandslash-alola"],
    raticate: ["raticate-alola"],
    marowak: ["marowak-alola"],
    electrode: ["electrode-hisui"],
  };
  const REGIONAL_EVOLUTION_CHANCE = 0.35;

  // Rolled every time a Pokémon evolves — if the result it just landed on
  // has a known regional-form equivalent (Galar/Alola/Hisui), there's a 35%
  // chance to swap to that regional form instead. Once already on a
  // regional branch (e.g. Graveler-Alola → Golem-Alola), the next step's own
  // evolutions.json entry is a fixed single target, so this doesn't re-roll
  // an already-regional lineage back toward the normal one.
  function rollRegionalEvolution(evolvedBase){
    const alts = (REGIONAL_EVOLUTION_ALT[evolvedBase.name] || []).map(n => POKEMON_BY_NAME[n]).filter(Boolean);
    if(!alts.length || Math.random() >= REGIONAL_EVOLUTION_CHANCE) return evolvedBase;
    return pick(alts);
  }

  // On a Gym Leader win, one random Pokémon from the active roster that's
  // capable of evolving is picked to evolve. Replaces its slot in
  // `activeTeam` — never mutates the shared POKEMON data objects. Preserves
  // shininess. The reveal itself is shown on the next screen (PokeStop),
  // not here, so this just performs the evolution and returns the pair.
  // If nobody has a normal evolution left (the whole team is fully evolved),
  // there's simply nothing to evolve — Mega Evolution is never automatic,
  // only available via the Mega Stone (see useMegaStone()).
  function evolveRandomEligible(){
    const eligibleIdx = [];
    activeTeam.forEach((mon, idx) => {
      if(evolutionOptionsFor(mon.name).length) eligibleIdx.push(idx);
    });
    if(!eligibleIdx.length) return null;
    const idx = pick(eligibleIdx);
    const currentMon = activeTeam[idx];
    const evolvedBase = rollRegionalEvolution(POKEMON_BY_NAME[pick(evolutionOptionsFor(currentMon.name))]);
    const evolved = currentMon.is_shiny ? { ...evolvedBase, is_shiny:true } : evolvedBase;
    activeTeam[idx] = evolved;
    if(currentMon === starter) starter = evolved; // keep the starter reference current through evolution
    return { from: currentMon, to: evolved };
  }

  // Evolution Chain achievement bookkeeping, a Set naturally dedupes species
  // that evolve more than once in the same run (e.g. two separate Eevees).
  // No-op if `result` is null (nothing was eligible to evolve/Mega Evolve).
  function recordEvolution(result){
    if(result) evolvedSpeciesThisRun.add(result.to.name);
  }

  // ---------- MEGA EVOLUTION ----------
  function megaEligibleIdx(){
    const idxs = [];
    activeTeam.forEach((mon, idx) => {
      const forms = MEGA_FORMS_BY_BASE[mon.name];
      if(forms && forms.length) idxs.push(idx);
    });
    return idxs;
  }

  // `formName` picks which of the base's Mega forms to become — required
  // when there's more than one (Charizard/Mewtwo/Raichu X/Y, Garchomp/
  // Absol/Lucario's regular Mega vs. Mega Z): see useMegaStone(), which
  // routes those cases through openMegaFormChoice() instead of calling this
  // directly. Falls back to the only form there is when a base has just one.
  function performMegaEvolution(idx, formName){
    const currentMon = activeTeam[idx];
    const forms = MEGA_FORMS_BY_BASE[currentMon.name];
    if(!forms || !forms.length) return null;
    const chosenName = (formName && forms.includes(formName)) ? formName : forms[0];
    const evolvedBase = POKEMON_BY_NAME[chosenName];
    const evolved = currentMon.is_shiny ? { ...evolvedBase, is_shiny:true } : evolvedBase;
    activeTeam[idx] = evolved;
    if(currentMon === starter) starter = evolved;
    return { from: currentMon, to: evolved, isMega:true };
  }

  function startTrainerBattle(){
    beginBattle(rollTrainer());
  }

  // ---------- GYM BADGE SELECT ----------
  function openGymSelect(){
    closePokeStopScreen();
    document.getElementById('encounterScreen').classList.remove('active');
    document.getElementById('catchScreen').classList.remove('active');
    document.getElementById('gymSelectScreen').classList.add('active');
    renderGymSelect();
  }

  // Lets the player step back to the PokeStop (to buy/use items, check the
  // Computer, etc.) before committing to a Gym Leader — reopens the same
  // pre-Gym PokeStop screen they just came from, same as the Team screen's
  // own "back to PokeStop" button.
  function closeGymSelect(){
    document.getElementById('gymSelectScreen').classList.remove('active');
    openPokeStop(pokestopMode);
  }

  // Shows the player's current active roster (up to 6) — reusable wherever
  // it's useful to see your team before making a decision. No type line here
  // (unlike other roster displays) — this is only ever used on the Gym
  // Select screen, where dropping it lets the slots stretch to fill the
  // row's width instead of a fixed narrow column.
  function renderRosterStrip(elId){
    const el = document.getElementById(elId);
    if(!el) return;
    el.innerHTML = activeTeam.map(mon => `
      <div class="roster-slot">
        ${avatarHTML(mon,'avatar-sm')}
        <span class="tn">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">✨</span>' : ''}</span>
      </div>`).join('');
  }

  function renderGymSelect(){
    renderRosterStrip('gymSelectRoster');
    const grid = document.getElementById('badgeGrid');
    grid.innerHTML = BADGES.map(b => {
      const beaten = runBeatenBadges.has(b.key);
      return `<button class="badge-card ${beaten ? 'locked' : ''}" data-key="${b.key}" ${beaten ? 'disabled' : ''}>
        <img class="badge-icon" src="${BADGE_ICON_DIR}/${b.icon}" alt="" onerror="this.style.display='none'">
        <span class="c-name">${b.leaderName}</span>
        <div class="c-types">${typeChipsHTML(b.types)}</div>
        ${beaten ? '<span class="result-tag">BEATEN</span>' : ''}
      </button>`;
    }).join('');
    grid.querySelectorAll('.badge-card:not(.locked)').forEach(btn => {
      btn.addEventListener('click', () => challengeBadge(btn.dataset.key));
    });
    checkpoint('gymSelect');
  }

  function challengeBadge(key){
    const badge = BADGES.find(b => b.key === key);
    if(!badge || runBeatenBadges.has(key)) return;
    document.getElementById('gymSelectScreen').classList.remove('active');
    beginBattle(rollBadgeGym(badge));
  }

  // One-time, unrepeatable Legendary AND Mythical encounters. The Legendary
  // fight happens right after the 8th badge; the Mythical one happens later,
  // mid-Cruise (the ship's island stop between its 2nd and 3rd battles — see
  // the 'cruiseCasino' branch of renderPokeStop()). Both share the exact
  // same lore/picker screen (see index.html's legendaryIntroScreen) —
  // `introEncounterKind` is what tells the shared render/confirm functions
  // below which one is currently running. Each requires picking exactly 2
  // Pokémon (fewer only if the active team itself has fewer than 2) — a
  // restriction that applies to this single battle only, since `activeTeam`
  // itself is never modified.
  const LEGENDARY_SQUAD_CAP = 2;
  const MYTHICAL_SQUAD_CAP = 2;
  // One-time bump to the PokeStop's Potion/Revive lifetime purchase cap,
  // applied right as the endgame begins (after the Legendary encounter,
  // before Cruise/Elite Four) — the cap from the main campaign carries over,
  // so without this the player couldn't buy any more healing for the run's
  // hardest stretch even with gold in hand. Still costs gold like normal.
  const ENDGAME_RESUPPLY_POTIONS = 6;
  const ENDGAME_RESUPPLY_REVIVES = 2;
  let legendaryPendingMon = null;
  let legendarySelectedIdx = [];
  let introEncounterKind = 'legendary'; // 'legendary' | 'mythical' — which flow the shared screen below is currently running

  function startLegendaryBattle(){
    // Mythicals get their own dedicated encounter (see startMythicalBattle())
    // and are excluded here so the two never overlap.
    const legendaryPool = POKEMON.filter(p => p.legendary && p.id <= NATIONAL_DEX_MAX && !MYTHICAL_POKEMON.includes(p.name));
    const legendaryMon = pick(legendaryPool);
    openSpecialIntro(legendaryMon, 'legendary');
  }

  function startMythicalBattle(){
    const mythicalPool = POKEMON.filter(p => p.id <= NATIONAL_DEX_MAX && MYTHICAL_POKEMON.includes(p.name));
    const mythicalMon = pick(mythicalPool);
    openSpecialIntro(mythicalMon, 'mythical');
  }

  function specialLoreText(mon, kind){
    const typeLabel = mon.types.map(t => t[0].toUpperCase() + t.slice(1)).join('/');
    return kind === 'mythical'
      ? `Stranded on this remote island, a Mythical ${typeLabel}-type Pokémon, spoken of even among Legendaries, has been waiting. The ship only stopped for a few hours, so this is your only shot at it. Choose your team wisely.`
      : `A Legendary ${typeLabel}-type Pokémon of immense, rarely-witnessed power. Encounters like this happen once in a lifetime, so choose your team wisely.`;
  }

  function openSpecialIntro(mon, kind){
    introEncounterKind = kind;
    legendaryPendingMon = mon;
    legendarySelectedIdx = [];
    // Reached straight from a catch/encounter resolution (e.g. the
    // pre-Legendary bonus encounter) or from the PokeStop — either way,
    // whatever screen led here needs to be fully hidden first, or it shows
    // through underneath this one.
    hideAllRunScreens();
    document.getElementById('legendaryIntroEyebrow').textContent = kind === 'mythical' ? '🏝️ The Island Stirs...' : '🌟 A Legendary Stirs...';
    document.getElementById('legendaryIntroScreen').classList.add('active');
    renderLegendaryIntro();
  }

  function legendaryPickRequired(){
    const cap = introEncounterKind === 'mythical' ? MYTHICAL_SQUAD_CAP : LEGENDARY_SQUAD_CAP;
    return Math.min(cap, activeTeam.length);
  }

  function renderLegendaryIntro(){
    const mon = legendaryPendingMon;
    const required = legendaryPickRequired();

    document.getElementById('legendaryIntroName').textContent = legendaryEncounterName(mon.name);
    document.getElementById('legendaryIntroArt').innerHTML = avatarHTML(mon);
    document.getElementById('legendaryIntroTypes').innerHTML = typeChipsHTML(mon.types);
    document.getElementById('legendaryIntroDesc').textContent = specialLoreText(mon, introEncounterKind);

    const grid = document.getElementById('legendaryPickerGrid');
    grid.innerHTML = activeTeam.map((m, i) => {
      const selected = legendarySelectedIdx.includes(i);
      const disabled = !selected && legendarySelectedIdx.length >= required;
      return `<button class="legendary-pick-card ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}" data-idx="${i}" ${disabled ? 'disabled' : ''}>
        ${avatarHTML(m,'avatar-sm')}
        <span class="c-name">${displayName(m.name)}${m.is_shiny ? ' ✨' : ''}</span>
      </button>`;
    }).join('');
    grid.querySelectorAll('.legendary-pick-card').forEach(btn => {
      btn.addEventListener('click', () => toggleLegendaryPick(Number(btn.dataset.idx)));
    });

    document.getElementById('legendaryPickCount').textContent = `${legendarySelectedIdx.length}/${required} selected`;
    document.getElementById('legendaryBeginBtn').disabled = legendarySelectedIdx.length !== required;
  }

  function toggleLegendaryPick(idx){
    const required = legendaryPickRequired();
    const pos = legendarySelectedIdx.indexOf(idx);
    if(pos >= 0) legendarySelectedIdx.splice(pos, 1);
    else if(legendarySelectedIdx.length < required) legendarySelectedIdx.push(idx);
    renderLegendaryIntro();
  }

  function confirmLegendaryTeam(){
    const required = legendaryPickRequired();
    if(legendarySelectedIdx.length !== required) return;
    const chosen = legendarySelectedIdx.map(i => activeTeam[i]);
    const mon = legendaryPendingMon;
    const kind = introEncounterKind;
    document.getElementById('legendaryIntroScreen').classList.remove('active');
    beginBattle({ name: mon.name, squad: [mon], isGym:false, isLegendary: kind === 'legendary', isMythical: kind === 'mythical' }, chosen);
  }

  // Elite Four: four full 6-vs-6 battles fought back to back. Beating the
  // last one makes the player Champion.
  function startEliteBattle(){
    beginBattle(rollEliteMember(ELITE_FOUR[eliteIndex], eliteIndex === ELITE_FOUR.length - 1));
  }

  // ---------- CRUISE SHIP ----------
  // One-time cinematic screen right after the Legendary encounter — the
  // Cruise Ship is a mandatory endgame event now, so this just dramatizes
  // "you're going, right now" instead of a ticket purchase decision.
  function openCruiseTicketWonScreen(){
    document.getElementById('cruiseTicketWonScreen').classList.add('active');
  }

  function boardCruiseShip(){
    document.getElementById('cruiseTicketWonScreen').classList.remove('active');
    cruiseStageIndex = 0;
    startCruiseBattle();
  }

  function startCruiseBattle(){
    beginBattle(rollCruiseBattle(CRUISE_SHIP_BATTLES[cruiseStageIndex]));
  }

  function startCruiseRivalBattle(){
    beginBattle(rollCruiseRival());
  }

  // JRPG-style dialogue box shown right before the Rival battle — click
  // through each line, the last click leads straight into the battle.
  let rivalDialogueIndex;

  function openRivalChallenge(){
    rivalDialogueIndex = 0;
    document.getElementById('rivalChallengeScreen').classList.add('active');
    renderRivalDialogue();
  }

  function renderRivalDialogue(){
    document.getElementById('rivalDialogueBox').textContent = RIVAL_DIALOGUE[rivalDialogueIndex];
    const btn = document.getElementById('rivalDialogueNextBtn');
    btn.textContent = rivalDialogueIndex < RIVAL_DIALOGUE.length - 1 ? '▼' : 'BATTLE!';
    btn.onclick = advanceRivalDialogue;
    checkpoint('rivalChallenge');
  }

  function advanceRivalDialogue(){
    rivalDialogueIndex++;
    if(rivalDialogueIndex >= RIVAL_DIALOGUE.length){
      document.getElementById('rivalChallengeScreen').classList.remove('active');
      startCruiseRivalBattle();
      return;
    }
    renderRivalDialogue();
  }

  // `playerOverride`, when given, replaces the usual "whole active team"
  // squad for this one battle only (used by the Legendary encounter's 3-mon
  // pick) — activeTeam itself is never touched, so every other battle
  // before and after keeps using the player's full roster as normal.
  function battleSubText(opponent){
    if(opponent.isGym) return `Badge ${runBadges + 1}/${BADGES_TO_UNLOCK_ENDGAME} this run · ${opponent.squad.length} Pokémon.`;
    if(opponent.isLegendary) return `A wild Legendary appeared! One shot only, it won't come back this run.`;
    if(opponent.isMythical) return `🏝️ A wild Mythical appeared on the island! One shot only, it won't come back this run.`;
    if(opponent.isElite) return `Elite Four · Member ${eliteIndex + 1}/${ELITE_FOUR.length} · full ${opponent.squad.length}-vs-6 battle.`;
    if(opponent.isRival) return `🚢 Your rival challenges you aboard the Cruise Ship! ${opponent.squad.length} Pokémon.`;
    if(opponent.isDouble) return opponent.isCruise
      ? `🚢 Double Battle! 2 Pokémon a side, fighting at once.`
      : `⚔️ Double Battle! 2 Pokémon a side, fighting at once.`;
    if(opponent.isCruise) return `🚢 Cruise Ship battle! ${opponent.squad.length} Pokémon.`;
    return `Encounter ${encounterNum} · a route trainer wants to battle! ${opponent.squad.length} Pokémon.`;
  }

  // Stadium-style lead pick: before the opponent's first Pokémon is shown,
  // the player commits to who leads off. Doesn't affect who fights next once
  // the lead faints — that's still chosen live via renderTeamSwitchStrip().
  function beginBattle(opponent, playerOverride){
    revivePickerOpen = false; // reset in case a previous battle left it open
    potionPickerOpen = false;
    switchPickerOpen = false;
    const order = playerOverride || activeTeam.slice(0, MAX_PARTY_SIZE);
    if(opponent.isDouble){ openDoubleSquadSelect(opponent, order); return; }
    openLeadSelect(opponent, order);
  }

  // Double Battle squad pick: exactly 2 Pokémon, chosen by tapping cards —
  // those 2 are the entire roster for this fight (no bench, no switching;
  // matches the opponent's own fixed 2-Pokémon squad). Reuses the same
  // lead-select screen, just with multi-select instead of single-pick.
  let doubleSquadPicked = [];

  function openDoubleSquadSelect(opponent, order){
    document.getElementById('encounterScreen').classList.remove('active');
    document.getElementById('catchScreen').classList.remove('active');
    document.getElementById('leadSelectScreen').classList.add('active');
    document.getElementById('leadSelectEyebrow').textContent = displayName(opponent.name);
    doubleSquadPicked = [];
    renderDoubleSquadSelect(opponent, order);
  }

  // Picking a 2nd Pokémon no longer jumps straight into the battle — it just
  // arms the Confirm button below the grid, so the player gets a chance to
  // reconsider (toggle either pick off and choose someone else) before
  // actually committing to the pair.
  function renderDoubleSquadSelect(opponent, order){
    const remaining = 2 - doubleSquadPicked.length;
    document.getElementById('leadSelectSub').textContent =
      `${battleSubText(opponent)} Choose exactly 2 Pokémon to send out${remaining > 0 ? `, pick ${remaining} more` : ''}.`;

    const grid = document.getElementById('leadSelectGrid');
    grid.innerHTML = order.map((mon,i) => `
      <button class="wild-card ${doubleSquadPicked.includes(i) ? 'caught' : ''}" data-idx="${i}">
        ${avatarHTML(mon)}
        <span class="c-name">${displayName(mon.name)}${mon.is_shiny ? ' ✨' : ''}</span>
        <div class="c-types">${typeDotsHTML(mon.types)}</div>
      </button>`).join('');
    grid.querySelectorAll('.wild-card').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        const pos = doubleSquadPicked.indexOf(idx);
        if(pos >= 0){
          doubleSquadPicked.splice(pos, 1);
        } else if(doubleSquadPicked.length < 2){
          doubleSquadPicked.push(idx);
        }
        renderDoubleSquadSelect(opponent, order);
      });
    });

    const confirmBtn = document.getElementById('leadSelectConfirmBtn');
    confirmBtn.style.display = 'block';
    confirmBtn.disabled = doubleSquadPicked.length !== 2;
    confirmBtn.textContent = doubleSquadPicked.length === 2 ? 'CONFIRM TEAM' : `CONFIRM TEAM (${remaining} MORE TO PICK)`;
    confirmBtn.onclick = () => {
      if(doubleSquadPicked.length !== 2) return;
      const pair = doubleSquadPicked.map(i2 => order[i2]);
      document.getElementById('leadSelectScreen').classList.remove('active');
      confirmBtn.style.display = 'none';
      startDoubleBattle(opponent, pair);
    };
  }

  function openLeadSelect(opponent, order){
    document.getElementById('encounterScreen').classList.remove('active');
    document.getElementById('catchScreen').classList.remove('active');
    document.getElementById('leadSelectScreen').classList.add('active');
    document.getElementById('leadSelectConfirmBtn').style.display = 'none';

    document.getElementById('leadSelectEyebrow').textContent = displayName(opponent.name);
    document.getElementById('leadSelectSub').textContent =
      `${battleSubText(opponent)} Pick who goes out first, your opponent hasn't shown their hand yet.`;

    const portrait = document.getElementById('leadSelectPortrait');
    if(opponent.portraitFile){
      portrait.src = `${TRAINER_PORTRAIT_DIR}/${opponent.portraitFile}`;
      portrait.style.display = 'block';
    } else {
      portrait.style.display = 'none';
    }

    const grid = document.getElementById('leadSelectGrid');
    grid.innerHTML = order.map((mon,i) => `
      <button class="wild-card" data-idx="${i}">
        ${avatarHTML(mon)}
        <span class="c-name">${displayName(mon.name)}${mon.is_shiny ? ' ✨' : ''}</span>
        <div class="c-types">${typeDotsHTML(mon.types)}</div>
      </button>`).join('');
    grid.querySelectorAll('.wild-card').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('leadSelectScreen').classList.remove('active');
        startBattleWithLead(opponent, order, Number(btn.dataset.idx));
      });
    });
  }

  function startBattleWithLead(opponent, order, leadIdx){
    battle = {
      trainer: opponent,
      player: order.map(makeBattler),
      enemy: opponent.squad.map(makeBattler),
      pIdx: leadIdx, eIdx: 0,
      resolving: false,
      nextTimerId: null,
      awaitingSwitch: false,
      over: false,
      eliteAiPotionsUsed: 0, // Elite Four AI Potion uses this battle (max 2)
      eliteAiRevived: false, // final Elite Four member's one-time AI Revive
      eliteFaintedMon: null, // holds the final member's last-fainted squad member, awaiting a chance to be revived mid-battle
      eliteFaintedIdx: null, // that fallen member's own squad slot — revival goes back into this exact slot, never a new one
      firstTurnResolved: false, // gates the item-window ring — no countdown during turn 1's window
      potionsUsedThisBattle: 0, // player's own Potion cap this battle (see MAX_POTIONS_PER_BATTLE)
      revivesUsedThisBattle: 0, // player's own Revive cap this battle (see MAX_REVIVES_PER_BATTLE)
      voluntarySwitchesUsedThisBattle: 0, // see MAX_VOLUNTARY_SWITCHES_PER_BATTLE
    };

    document.getElementById('battleMoveLog').innerHTML = '';
    document.getElementById('battleContinueBtn').style.display = 'none';
    document.getElementById('battleScreen').classList.add('active');
    document.getElementById('battleScreen').classList.toggle('gym-battle', !!opponent.isGym);
    document.getElementById('battleScreen').classList.toggle('legendary-battle', !!opponent.isLegendary);
    document.getElementById('battleScreen').classList.toggle('elite-battle', !!opponent.isElite);
    document.getElementById('battleScreen').classList.toggle('cruise-battle', !!(opponent.isCruise || opponent.isRival));
    document.getElementById('battleScreen').classList.remove('double-battle');

    document.getElementById('battleHead').innerHTML = `
      ${trainerPortraitHTML(opponent)}
      <div class="battle-name">${displayName(opponent.name)}</div>
      <div class="battle-sub">${battleSubText(opponent)}</div>
    `;
    appendBattleLog(`${displayName(opponent.name)} sends out ${displayName(battle.enemy[0].mon.name)}!`, '', 'info');
    appendBattleLog(`Go, ${displayName(battle.player[battle.pIdx].mon.name)}!`, '', 'info');
    renderHpPanel();
    renderBattleControls();
    battle.nextTimerId = setTimeout(battleStep, 900);
  }

  // Double Battle start: both of the 2 chosen Pokémon are simultaneously
  // active for the whole fight — there's no bench, so unlike singles there's
  // no pIdx/eIdx and no forced-switch step when one faints (see
  // doubleBattleStep()/afterDoubleExchange()).
  function startDoubleBattle(opponent, pair){
    battle = {
      trainer: opponent,
      isDouble: true,
      player: pair.map(makeBattler),
      enemy: opponent.squad.map(makeBattler),
      resolving: false,
      nextTimerId: null,
      awaitingSwitch: false,
      over: false,
      eliteAiPotionsUsed: 0,
      eliteAiRevived: false,
      firstTurnResolved: false,
      potionsUsedThisBattle: 0,
      revivesUsedThisBattle: 0,
    };

    document.getElementById('battleMoveLog').innerHTML = '';
    document.getElementById('battleContinueBtn').style.display = 'none';
    document.getElementById('battleScreen').classList.add('active');
    document.getElementById('battleScreen').classList.remove('gym-battle', 'legendary-battle', 'elite-battle');
    document.getElementById('battleScreen').classList.add('double-battle');
    // The "cruise-battle" water tint (trainer name color, plus one of the two
    // rules setting the blue HP-card border — .double-battle alone already
    // covers that part) is only appropriate for an actual Cruise Ship fight,
    // not every Double Battle — e.g. Hiker Anthony's route-trainer one.
    document.getElementById('battleScreen').classList.toggle('cruise-battle', !!opponent.isCruise);

    document.getElementById('battleHead').innerHTML = `
      ${trainerPortraitHTML(opponent)}
      <div class="battle-name">${displayName(opponent.name)}</div>
      <div class="battle-sub">${battleSubText(opponent)}</div>
    `;
    appendBattleLog(`${displayName(opponent.name)} sends out ${displayName(battle.enemy[0].mon.name)} and ${displayName(battle.enemy[1].mon.name)}!`, '', 'info');
    appendBattleLog(`Go, ${displayName(battle.player[0].mon.name)} and ${displayName(battle.player[1].mon.name)}!`, '', 'info');
    renderHpPanel();
    renderBattleControls();
    battle.nextTimerId = setTimeout(doubleBattleStep, 900);
  }

  function appendBattleLog(title, sub, tag){
    const wrap = document.getElementById('battleMoveLog');
    const line = document.createElement('div');
    line.className = `log-line ${tag||''}`;
    line.innerHTML = `<div class="lg-move">${title}</div>${sub ? `<div class="lg-dmg">${sub}</div>` : ''}`;
    wrap.appendChild(line);
    line.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }

  // Small colored chip next to a battler's name showing an active status
  // condition (e.g. "PSN" for poison) — empty string when there's none.
  // Keyed by status type so adding Sleep later just needs a new label here.
  const STATUS_TAG_LABELS = { poison: 'PSN', burn: 'BRN', sleep: 'SLP' };
  function statusTagHTML(b){
    if(!b.status) return '';
    const label = STATUS_TAG_LABELS[b.status.type] || b.status.type.toUpperCase();
    return ` <span class="status-tag status-tag-${b.status.type}">${label}</span>`;
  }

  function renderHpPanel(){
    if(battle.isDouble){ renderDoubleHpPanel(); return; }
    const p = battle.player[battle.pIdx];
    const e = battle.enemy[battle.eIdx];
    if(!p || !e) return;
    const panel = document.getElementById('hpPanel');
    // The opponent's card shows one ball icon per Pokémon on their squad —
    // faded for the ones already eliminated — so the player can see at a
    // glance how many of the trainer's/Gym Leader's Pokémon are left.
    const foeBallsHTML = `<div class="foe-balls">${battle.enemy.map(b => `<span class="foe-ball ${b.hp <= 0 ? 'used' : ''}"></span>`).join('')}</div>`;
    panel.innerHTML = [
      { label:battle.trainer.name.toUpperCase(), b:e, balls:foeBallsHTML },
      { label:'YOUR POKÉMON', b:p, balls:'' },
    ].map(side => `
      <div class="hp-card">
        ${avatarHTML(side.b.mon,'avatar-sm')}
        <div class="hp-info">
          ${side.balls}
          <div class="hp-side-label">${side.label}</div>
          <div class="hp-name-row"><span>${displayName(side.b.mon.name)}${statusTagHTML(side.b)}</span><span>${Math.max(0,side.b.hp)}/${side.b.maxHp}</span></div>
          <div class="hp-bar-track"><div class="hp-bar-fill ${side.b.hp/side.b.maxHp < 0.25 ? 'low':''}" style="width:${Math.max(0,side.b.hp/side.b.maxHp*100)}%"></div></div>
        </div>
      </div>`).join('');
    renderTeamSwitchStrip();
    renderBattleItemsPanel();
  }

  // Both Pokémon on each side are simultaneously active for the whole fight
  // (no bench), so this just shows all 4 at once instead of one pair.
  function renderDoubleHpPanel(){
    const panel = document.getElementById('hpPanel');
    if(!panel) return;
    const cardHTML = (b, label) => `
      <div class="hp-card">
        ${avatarHTML(b.mon,'avatar-sm')}
        <div class="hp-info">
          <div class="hp-side-label">${label}</div>
          <div class="hp-name-row"><span>${displayName(b.mon.name)}${statusTagHTML(b)}</span><span>${Math.max(0,b.hp)}/${b.maxHp}</span></div>
          <div class="hp-bar-track"><div class="hp-bar-fill ${b.hp/b.maxHp < 0.25 ? 'low':''}" style="width:${Math.max(0,b.hp/b.maxHp*100)}%"></div></div>
        </div>
      </div>`;
    panel.innerHTML = `
      <div class="hp-double-row">
        ${cardHTML(battle.enemy[0], battle.trainer.name.toUpperCase())}
        ${cardHTML(battle.enemy[1], battle.trainer.name.toUpperCase())}
      </div>
      <div class="hp-double-row">
        ${cardHTML(battle.player[0], 'YOUR POKÉMON')}
        ${cardHTML(battle.player[1], 'YOUR POKÉMON')}
      </div>`;
    renderTeamSwitchStrip();
    renderBattleItemsPanel();
  }

  // ---------- MID-BATTLE TEAM SWITCH ----------
  // Shows all up to 6 roster slots from this battle's fixed player order
  // (`battle.player`, set once in beginBattle()). Switching is NOT free —
  // it's only offered as a forced choice right after the active Pokémon
  // faints (see promptForcedSwitch() in afterExchange()), so the player
  // picks who comes in next instead of it happening automatically.
  function renderTeamSwitchStrip(){
    const strip = document.getElementById('teamSwitchStrip');
    const prompt = document.getElementById('switchPrompt');
    if(!strip || !battle) return;
    // Double Battles have no bench to switch in from — both Pokémon fight
    // for the whole encounter, so there's nothing to show here.
    if(battle.isDouble){ strip.innerHTML = ''; if(prompt) prompt.style.display = 'none'; return; }
    if(prompt) prompt.style.display = battle.awaitingSwitch ? 'block' : 'none';
    const canSwitch = !battle.over && battle.awaitingSwitch;
    const slots = [];
    for(let i = 0; i < MAX_PARTY_SIZE; i++){
      const b = battle.player[i];
      if(!b){ slots.push('<div class="switch-slot empty"></div>'); continue; }
      const fainted = b.hp <= 0;
      const active = i === battle.pIdx;
      const clickable = canSwitch && !fainted;
      slots.push(`<button class="switch-slot ${active ? 'active' : ''} ${fainted ? 'fainted' : ''} ${clickable ? 'selectable' : ''}" data-idx="${i}" ${clickable ? '' : 'disabled'}>
        ${avatarHTML(b.mon,'avatar-sm')}
        <div class="switch-hp-track"><div class="switch-hp-fill ${b.hp/b.maxHp < 0.25 ? 'low':''}" style="width:${Math.max(0,b.hp/b.maxHp*100)}%"></div></div>
        ${fainted ? '<span class="switch-fainted-tag">OUT</span>' : ''}
      </button>`);
    }
    strip.innerHTML = slots.join('');
    strip.querySelectorAll('.switch-slot:not(.empty):not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => switchActivePokemon(Number(btn.dataset.idx)));
    });
  }

  // Pauses the auto-battle and waits for the player to pick who comes in
  // next — called only when the active Pokémon has just fainted and at
  // least one teammate is still standing.
  function promptForcedSwitch(){
    battle.awaitingSwitch = true;
    if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
    appendBattleLog(`Choose your next Pokémon!`, '', 'info');
    renderBattleControls();
    renderTeamSwitchStrip();
    renderBattleItemsPanel();
  }

  function switchActivePokemon(idx){
    if(!battle || battle.over || !battle.awaitingSwitch) return;
    const target = battle.player[idx];
    if(!target || target.hp <= 0) return;
    battle.pIdx = idx;
    battle.awaitingSwitch = false;
    appendBattleLog(`Go, ${displayName(target.mon.name)}!`, '', 'info');
    renderHpPanel();
    renderBattleControls();
    battle.nextTimerId = setTimeout(battleStep, ITEM_WINDOW_MS);
  }

  // ---------- BATTLE ITEMS (Potion / Revive — always visible, no Bag toggle) ----------
  function renderBattleControls(){
    // Potion/Revive availability is handled per-row in renderBattleItemsPanel().
  }

  // Potion always targets the current active Pokémon, shown side-by-side
  // with a single Revive card. Revive only lists ONE row — clicking USE
  // opens a picker of every fainted teammate so the player chooses who
  // comes back, instead of a row per fainted Pokémon.
  // Choosing who to revive pauses the auto-battle entirely — it only
  // resumes once the player picks a target or explicitly backs out via
  // "DON'T USE ITEM". `revivePickerOpen` is the single source of truth for
  // picker visibility, so renderBattleItemsPanel() can be called from
  // anywhere (switching Pokémon, HP updates, etc.) without ever silently
  // closing an open picker out from under the player.
  let revivePickerOpen = false;
  // Double Battle only: Potion has no single "the active Pokémon" to target
  // (both are active at once), so it opens its own picker, mirroring Revive's.
  let potionPickerOpen = false;
  // Single battles only — see openSwitchPicker()/confirmVoluntarySwitch().
  let switchPickerOpen = false;

  function renderBattleItemsPanel(){
    const panel = document.getElementById('bagPanel');
    if(!panel || !battle) return;
    const busy = battle.over || battle.resolving;

    if(battle.isDouble){
      const anyPickerOpen = revivePickerOpen || potionPickerOpen;
      const healable = battle.player.filter(b => b.hp > 0 && b.hp < b.maxHp);
      const potionCapped = battle.potionsUsedThisBattle >= MAX_POTIONS_PER_BATTLE;
      const canHeal = !busy && !anyPickerOpen && healable.length > 0 && inv.potions > 0 && !potionCapped;
      const faintedCount = battle.player.filter(b => b.hp <= 0).length;
      const reviveCapped = battle.revivesUsedThisBattle >= MAX_REVIVES_PER_BATTLE;
      // Permadeath means there's nothing left to revive in Nuzlocke, a
      // fainted Pokémon is already gone by the time this renders (see
      // removeFaintedFromRoster()).
      const isNuzlocke = gameMode === 'nuzlocke';
      const canRevive = !isNuzlocke && !busy && !anyPickerOpen && faintedCount > 0 && inv.revives > 0 && !reviveCapped;
      const timedWindowOpen = !busy && !anyPickerOpen && battle.firstTurnResolved;

      panel.innerHTML = `
        <div class="bag-items-row">
          ${timedWindowOpen ? `<div class="item-window-ring" style="animation-duration:${ITEM_WINDOW_MS}ms"></div>` : ''}
          <div class="bag-item-card">
            ${itemIconHTML('potions')}
            <div class="bag-item-name">Potion ×${inv.potions}</div>
            <div class="bag-item-desc">${potionCapped ? `Already used ${MAX_POTIONS_PER_BATTLE} this battle` : healable.length ? 'Pick who to heal' : 'Nobody needs healing'}</div>
            <button class="btn-ghost bag-use" id="usePotionBtn" ${canHeal ? '' : 'disabled'}>USE</button>
          </div>
          <div class="bag-item-card">
            ${itemIconHTML('revives')}
            <div class="bag-item-name">Revive ×${inv.revives}</div>
            <div class="bag-item-desc">${isNuzlocke ? 'Not allowed in Nuzlocke' : reviveCapped ? `Already used ${MAX_REVIVES_PER_BATTLE} this battle` : faintedCount ? 'Pick who comes back' : 'Nothing to revive'}</div>
            <button class="btn-ghost bag-use" id="useReviveBtn" ${canRevive ? '' : 'disabled'}>USE</button>
          </div>
        </div>
        <div class="revive-picker" id="revivePicker" style="display:${anyPickerOpen ? 'block' : 'none'};">
          ${potionPickerOpen ? potionPickerHTML() : revivePickerOpen ? revivePickerHTML() : ''}
        </div>
      `;
      document.getElementById('usePotionBtn').onclick = openPotionPicker;
      document.getElementById('useReviveBtn').onclick = openRevivePicker;
      if(potionPickerOpen) wirePotionPickerButtons();
      if(revivePickerOpen) wireRevivePickerButtons();
      return;
    }

    const activePlayer = battle.player[battle.pIdx];
    const potionCapped = battle.potionsUsedThisBattle >= MAX_POTIONS_PER_BATTLE;
    const canHeal = !busy && !revivePickerOpen && !switchPickerOpen && activePlayer && activePlayer.hp > 0 && activePlayer.hp < activePlayer.maxHp && inv.potions > 0 && !potionCapped;
    const faintedCount = battle.player.filter(b => b.hp <= 0).length;
    const reviveCapped = battle.revivesUsedThisBattle >= MAX_REVIVES_PER_BATTLE;
    const isNuzlocke = gameMode === 'nuzlocke';
    const canRevive = !isNuzlocke && !busy && !revivePickerOpen && !switchPickerOpen && faintedCount > 0 && inv.revives > 0 && !reviveCapped;
    const benchAliveCount = battle.player.filter((b,i) => b.hp > 0 && i !== battle.pIdx).length;
    const switchCapped = battle.voluntarySwitchesUsedThisBattle >= MAX_VOLUNTARY_SWITCHES_PER_BATTLE;
    const canSwitch = !busy && !revivePickerOpen && !switchPickerOpen && !battle.awaitingSwitch && benchAliveCount > 0 && !switchCapped;
    // The ring only makes sense while there's an actual pending auto-advance
    // timer to race against — not while busy, a picker is open, or a forced
    // switch is waiting (that one has no timeout at all).
    const timedWindowOpen = !busy && !revivePickerOpen && !switchPickerOpen && !battle.awaitingSwitch && battle.firstTurnResolved;

    panel.innerHTML = `
      <div class="bag-items-row three-cards">
        ${timedWindowOpen ? `<div class="item-window-ring" style="animation-duration:${ITEM_WINDOW_MS}ms"></div>` : ''}
        <div class="bag-item-card">
          ${itemIconHTML('potions')}
          <div class="bag-item-name">Potion ×${inv.potions}</div>
          <div class="bag-item-desc">${potionCapped ? `Already used ${MAX_POTIONS_PER_BATTLE} this battle` : `Heals ${activePlayer ? activePlayer.mon.name : 'your Pokémon'}`}</div>
          <button class="btn-ghost bag-use" id="usePotionBtn" ${canHeal ? '' : 'disabled'}>USE</button>
        </div>
        <div class="bag-item-card">
          ${itemIconHTML('revives')}
          <div class="bag-item-name">Revive ×${inv.revives}</div>
          <div class="bag-item-desc">${isNuzlocke ? 'Not allowed in Nuzlocke' : reviveCapped ? `Already used ${MAX_REVIVES_PER_BATTLE} this battle` : faintedCount ? 'Pick who comes back' : 'Nothing to revive'}</div>
          <button class="btn-ghost bag-use" id="useReviveBtn" ${canRevive ? '' : 'disabled'}>USE</button>
        </div>
        <div class="bag-item-card">
          <div class="bag-item-name">🔄 Switch</div>
          <div class="bag-item-desc">${switchCapped ? 'Already switched this battle' : benchAliveCount ? 'Swap your active Pokémon' : 'No one else able to fight'}</div>
          <button class="btn-ghost bag-use" id="useSwitchBtn" ${canSwitch ? '' : 'disabled'}>USE</button>
        </div>
      </div>
      <div class="revive-picker" id="revivePicker" style="display:${(revivePickerOpen || switchPickerOpen) ? 'block' : 'none'};">${revivePickerOpen ? revivePickerHTML() : switchPickerOpen ? switchPickerHTML() : ''}</div>
    `;
    document.getElementById('usePotionBtn').onclick = usePotion;
    document.getElementById('useReviveBtn').onclick = openRevivePicker;
    document.getElementById('useSwitchBtn').onclick = openSwitchPicker;
    if(revivePickerOpen) wireRevivePickerButtons();
    if(switchPickerOpen) wireSwitchPickerButtons();
  }

  function potionPickerHTML(){
    const damaged = battle.player.map((b,i) => ({ b, i })).filter(({b}) => b.hp > 0 && b.hp < b.maxHp);
    return `<div class="revive-picker-label">Choose who to heal:</div>` +
      damaged.map(({b,i}) => `<button class="btn-ghost revive-pick-btn" data-idx="${i}">${displayName(b.mon.name)}</button>`).join('') +
      `<button class="btn-ghost revive-cancel-btn" id="potionCancelBtn">DON'T USE ITEM</button>`;
  }

  function wirePotionPickerButtons(){
    const picker = document.getElementById('revivePicker');
    if(!picker) return;
    picker.querySelectorAll('.revive-pick-btn').forEach(btn => {
      btn.onclick = () => usePotionOn(Number(btn.dataset.idx));
    });
    const cancelBtn = document.getElementById('potionCancelBtn');
    if(cancelBtn) cancelBtn.onclick = closePotionPicker;
  }

  function openPotionPicker(){
    if(!battle || battle.over || battle.resolving || potionPickerOpen || revivePickerOpen) return;
    if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
    potionPickerOpen = true;
    renderBattleItemsPanel();
  }

  function closePotionPicker(resumeBattle){
    potionPickerOpen = false;
    renderBattleItemsPanel();
    if(resumeBattle !== false && battle && !battle.over){
      battle.nextTimerId = setTimeout(battleStep, ITEM_WINDOW_MS);
    }
  }

  function usePotionOn(idx){
    if(!battle || battle.over || battle.resolving) return;
    if(battle.potionsUsedThisBattle >= MAX_POTIONS_PER_BATTLE){
      appendBattleLog(`No more Potions allowed this battle!`, '', 'info');
      closePotionPicker();
      return;
    }
    const target = battle.player[idx];
    if(!target || target.hp <= 0 || target.hp >= target.maxHp || inv.potions <= 0) return;
    if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
    inv.potions--;
    battle.potionsUsedThisBattle++;
    trackItemUsed('potions');
    const healed = Math.round(target.maxHp * POTION_HEAL_FRACTION);
    target.hp = Math.min(target.maxHp, target.hp + healed);
    appendBattleLog(`Used a Potion on ${displayName(target.mon.name)}.`, `Recovered ${healed} HP.`, 'info');
    renderHpPanel();
    closePotionPicker();
  }

  function revivePickerHTML(){
    const fainted = battle.player.map((b,i) => ({ b, i })).filter(({b}) => b.hp <= 0);
    return `<div class="revive-picker-label">Choose who to revive:</div>` +
      fainted.map(({b,i}) => `<button class="btn-ghost revive-pick-btn" data-idx="${i}">${displayName(b.mon.name)}</button>`).join('') +
      `<button class="btn-ghost revive-cancel-btn" id="reviveCancelBtn">DON'T USE ITEM</button>`;
  }

  function wireRevivePickerButtons(){
    const picker = document.getElementById('revivePicker');
    if(!picker) return;
    picker.querySelectorAll('.revive-pick-btn').forEach(btn => {
      btn.onclick = () => useRevive(Number(btn.dataset.idx));
    });
    const cancelBtn = document.getElementById('reviveCancelBtn');
    if(cancelBtn) cancelBtn.onclick = closeRevivePicker;
  }

  function openRevivePicker(){
    if(!battle || battle.over || battle.resolving || revivePickerOpen) return;
    if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
    revivePickerOpen = true;
    renderBattleItemsPanel();
  }

  function closeRevivePicker(resumeBattle){
    revivePickerOpen = false;
    renderBattleItemsPanel();
    if(resumeBattle !== false && battle && !battle.over && !battle.awaitingSwitch){
      battle.nextTimerId = setTimeout(battleStep, ITEM_WINDOW_MS);
    }
  }

  // ---------- VOLUNTARY SWITCH (single battles only, 1 per battle) ----------
  // Separate from the *forced* switch after a faint (switchActivePokemon(),
  // battle.awaitingSwitch) — this lets the player pull out a still-healthy
  // Pokémon, capped by MAX_VOLUNTARY_SWITCHES_PER_BATTLE.
  function switchPickerHTML(){
    const bench = battle.player.map((b,i) => ({ b, i })).filter(({b,i}) => b.hp > 0 && i !== battle.pIdx);
    return `<div class="revive-picker-label">Choose who to send out:</div>` +
      bench.map(({b,i}) => `<button class="btn-ghost revive-pick-btn" data-idx="${i}">${displayName(b.mon.name)}</button>`).join('') +
      `<button class="btn-ghost revive-cancel-btn" id="switchCancelBtn">DON'T SWITCH</button>`;
  }

  function wireSwitchPickerButtons(){
    const picker = document.getElementById('revivePicker');
    if(!picker) return;
    picker.querySelectorAll('.revive-pick-btn').forEach(btn => {
      btn.onclick = () => confirmVoluntarySwitch(Number(btn.dataset.idx));
    });
    const cancelBtn = document.getElementById('switchCancelBtn');
    if(cancelBtn) cancelBtn.onclick = closeSwitchPicker;
  }

  function openSwitchPicker(){
    if(!battle || battle.over || battle.resolving || battle.isDouble || battle.awaitingSwitch || switchPickerOpen) return;
    if(battle.voluntarySwitchesUsedThisBattle >= MAX_VOLUNTARY_SWITCHES_PER_BATTLE) return;
    if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
    switchPickerOpen = true;
    renderBattleItemsPanel();
  }

  function closeSwitchPicker(resumeBattle){
    switchPickerOpen = false;
    renderBattleItemsPanel();
    if(resumeBattle !== false && battle && !battle.over && !battle.awaitingSwitch){
      battle.nextTimerId = setTimeout(battleStep, ITEM_WINDOW_MS);
    }
  }

  function confirmVoluntarySwitch(idx){
    if(!battle || battle.over || battle.isDouble) return;
    if(battle.voluntarySwitchesUsedThisBattle >= MAX_VOLUNTARY_SWITCHES_PER_BATTLE){
      appendBattleLog(`No more switches allowed this battle!`, '', 'info');
      closeSwitchPicker();
      return;
    }
    const target = battle.player[idx];
    if(!target || target.hp <= 0 || idx === battle.pIdx) return;
    battle.voluntarySwitchesUsedThisBattle++;
    switchPickerOpen = false;
    battle.pIdx = idx;
    appendBattleLog(`Go, ${displayName(target.mon.name)}!`, '', 'info');
    renderHpPanel(); // cascades into renderTeamSwitchStrip()/renderBattleItemsPanel()
    battle.nextTimerId = setTimeout(battleStep, ITEM_WINDOW_MS);
  }

  function usePotion(){
    if(!battle || battle.over || battle.resolving) return;
    if(battle.potionsUsedThisBattle >= MAX_POTIONS_PER_BATTLE){
      appendBattleLog(`No more Potions allowed this battle!`, '', 'info');
      return;
    }
    const activePlayer = battle.player[battle.pIdx];
    if(!activePlayer || activePlayer.hp <= 0 || activePlayer.hp >= activePlayer.maxHp || inv.potions <= 0) return;
    if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
    inv.potions--;
    battle.potionsUsedThisBattle++;
    trackItemUsed('potions');
    const healed = Math.round(activePlayer.maxHp * POTION_HEAL_FRACTION);
    activePlayer.hp = Math.min(activePlayer.maxHp, activePlayer.hp + healed);
    appendBattleLog(`Used a Potion on ${displayName(activePlayer.mon.name)}.`, `Recovered ${healed} HP.`, 'info');
    renderHpPanel();
    if(!battle.over && !battle.awaitingSwitch) battle.nextTimerId = setTimeout(battleStep, ITEM_WINDOW_MS);
  }

  function useRevive(idx){
    if(!battle || battle.over || battle.resolving) return;
    if(battle.revivesUsedThisBattle >= MAX_REVIVES_PER_BATTLE){
      appendBattleLog(`No more Revives allowed this battle!`, '', 'info');
      closeRevivePicker(!battle.awaitingSwitch);
      return;
    }
    const target = battle.player[idx];
    if(!target || target.hp > 0 || inv.revives <= 0) return;
    if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
    battle.revivesUsedThisBattle++;
    inv.revives--;
    trackItemUsed('revives');
    target.hp = Math.round(target.maxHp * REVIVE_HP_FRACTION);
    appendBattleLog(`${displayName(target.mon.name)} was revived!`, `Back up with ${target.hp} HP.`, 'info');
    if(idx === battle.pIdx && battle.awaitingSwitch){
      battle.awaitingSwitch = false; // reviving the just-fainted active mon brings it right back into action
    }
    renderHpPanel();
    closeRevivePicker(!battle.awaitingSwitch); // picking a target counts as the decision — resume, unless still awaiting a switch
  }

  function resolveAttack(turn){
    const { b, foe } = turn;
    if(b.hp <= 0 || foe.hp <= 0) return;
    if(handleSleepTurn(b)) return;
    const move = pickEffectiveMove(b, foe);
    const hit = Math.random()*100 < (move.accuracy ?? 100);
    if(!hit){
      appendBattleLog(`${displayName(b.mon.name)} used ${move.name}!`, `${displayName(b.mon.name)}'s attack missed!`, 'miss');
      return;
    }
    const { dmg, eff } = computeDamage(b, foe, move);
    foe.hp = Math.max(0, foe.hp - dmg);
    const effText = eff > 1 ? "It's super effective!" : (eff < 1 && eff > 0) ? "It's not very effective..." : eff === 0 ? "It had no effect..." : `${dmg} damage`;
    appendBattleLog(`${displayName(b.mon.name)} used ${move.name}!`, effText, 'hit');
    if(eff > 0) maybeApplyMoveStatus(move, foe, b);
    renderHpPanel();
    if(foe.hp <= 0){
      appendBattleLog(`${displayName(foe.mon.name)} fainted!`, '', 'faint');
    }
  }

  function battleStep(){
    if(battle.isDouble){ doubleBattleStep(); return; }
    const p = battle.player[battle.pIdx];
    const e = battle.enemy[battle.eIdx];
    if(!p || !e) return;
    battle.resolving = true;
    renderBattleControls();

    const pTurn = { b:p, foe:e };
    const eTurn = { b:e, foe:p };
    const pFirst = (p.mon.speed || 0) >= (e.mon.speed || 0);
    const turns = pFirst ? [pTurn, eTurn] : [eTurn, pTurn];

    let delay = 0;
    turns.forEach(turn => {
      setTimeout(() => resolveAttack(turn), delay);
      delay += 900;
    });
    setTimeout(afterExchange, delay);
  }

  // Elite Four trainers and Captain Sereia only: while their active Pokémon
  // is alive but in the HP bar's "red" zone (same <25% threshold the HP bar
  // itself uses — see the `< 0.25` check in renderHpPanel/renderTeamSwitchStrip),
  // they get a chance to Potion-heal it back up. Elite Four gets up to 2 uses
  // (55% first try, 45% second); Captain Sereia gets exactly 1 (55% try —
  // this is her only shot, one dramatic comeback moment, not a war of attrition).
  // A roll that doesn't trigger isn't "spent" — it can still fire again next
  // time HP dips into red.
  function maybeEnemyAiPotion(){
    const isElite = battle.trainer.isElite;
    const isCaptain = battle.trainer.isCaptain;
    if(!isElite && !isCaptain) return;
    const e = battle.enemy[battle.eIdx];
    if(!e || e.hp <= 0) return;
    const used = battle.eliteAiPotionsUsed || 0;
    const maxUses = isCaptain ? 1 : 2;
    if(used >= maxUses) return;
    if(e.hp / e.maxHp >= 0.25) return;
    const chance = used === 0 ? 0.55 : 0.45;
    if(Math.random() >= chance) return;
    const healed = Math.round(e.maxHp * POTION_HEAL_FRACTION);
    e.hp = Math.min(e.maxHp, e.hp + healed);
    battle.eliteAiPotionsUsed = used + 1;
    appendBattleLog(`${battle.trainer.name} used a Potion on ${displayName(e.mon.name)}!`, `Recovered ${healed} HP.`, 'info');
    renderHpPanel();
  }

  // Final Elite Four member only, one-time use: rather than reviving the
  // instant their Pokémon faints, they hold onto the fallen squad member and
  // get a per-turn chance to bring it back mid-battle instead — as long as
  // they still have a Pokémon standing (so it can only fire while they're
  // actively fighting on, never as a last-gasp move with nothing else left).
  // The revived Pokémon goes back into its own original squad slot (and
  // eIdx rewinds to fight it there) rather than being appended as an extra
  // 7th squad member — the full team, Mega included, is always exactly 6.
  function maybeEliteFinalRevive(){
    if(!battle.trainer.isFinalElite || battle.eliteAiRevived || !battle.eliteFaintedMon) return;
    const active = battle.enemy[battle.eIdx];
    if(!active || active.hp <= 0) return;
    if(Math.random() >= 0.2) return;
    const fallen = battle.eliteFaintedMon;
    const revived = { mon: fallen.mon, maxHp: fallen.maxHp, hp: Math.round(fallen.maxHp * REVIVE_HP_FRACTION), moves: fallen.moves };
    battle.enemy[battle.eliteFaintedIdx] = revived;
    battle.eIdx = battle.eliteFaintedIdx;
    battle.eliteAiRevived = true;
    battle.eliteFaintedMon = null;
    battle.eliteFaintedIdx = null;
    appendBattleLog(`${battle.trainer.name} revives ${displayName(revived.mon.name)} back into the fight!`, `Back up with ${revived.hp} HP.`, 'info');
    renderHpPanel();
  }

  // Comeback Kid achievement bookkeeping, call after each exchange with the
  // player's battler list. Whenever exactly one is still standing, records
  // the lowest HP fraction seen for it on `battle.minLastStandHpFrac`; if
  // that mon is still alive when the battle is later won, endBattle() reads
  // this back to see whether it dipped below the threshold at some point.
  const COMEBACK_KID_HP_THRESHOLD = 0.2;
  function trackLastStandHp(playerBattlers){
    const alive = playerBattlers.filter(b => b.hp > 0);
    if(alive.length !== 1) return;
    const frac = alive[0].hp / alive[0].maxHp;
    if(battle.minLastStandHpFrac === undefined || frac < battle.minLastStandHpFrac){
      battle.minLastStandHpFrac = frac;
    }
  }

  // Nuzlocke permadeath: a fainted Pokémon is removed from the persistent
  // roster the instant it faints, not just left at 0 HP for the rest of the
  // battle. `mon` is matched by reference against `activeTeam` (the same
  // object `makeBattler()` wrapped when the battle started), a no-op if it's
  // already gone (e.g. an earlier exchange this same battle already removed
  // it). Revives are disabled entirely in this mode (see
  // renderBattleItemsPanel()), so there's no race between "reviving it back"
  // and "erasing it forever" to worry about, once it faints, it's gone.
  function removeFaintedFromRoster(mon){
    if(gameMode !== 'nuzlocke') return;
    const idx = activeTeam.indexOf(mon);
    if(idx !== -1) activeTeam.splice(idx, 1);
  }

  function afterExchange(){
    battle.firstTurnResolved = true; // turn 1 is done — the item-window ring is allowed from here on
    maybeEnemyAiPotion();
    maybeEliteFinalRevive();

    // End-of-turn status damage (poison, today) — applied to whichever
    // Pokémon is currently active on each side, before the faint/team-wipe
    // checks below, so a poison-induced faint is caught by that same logic
    // instead of needing its own special case.
    applyEndOfTurnStatus(battle.player[battle.pIdx]);
    applyEndOfTurnStatus(battle.enemy[battle.eIdx]);
    renderHpPanel(); // reflects poison damage immediately, regardless of what happens next below

    // The active Pokémon fainting only loses the battle if EVERY Pokémon on
    // the team is down — not just because we've reached the end of the
    // array. If teammates are still standing, the player picks who's next.
    const activeFainted = battle.player[battle.pIdx].hp <= 0;
    const teamWiped = activeFainted && battle.player.every(b => b.hp <= 0);

    if(activeFainted) removeFaintedFromRoster(battle.player[battle.pIdx].mon);

    // Flawless Victory achievement, any faint during the Elite Four
    // gauntlet (across all 4 members) disqualifies it for this run.
    if(activeFainted && battle.trainer.isElite) eliteGauntletFlawless = false;
    trackLastStandHp(battle.player);

    if(battle.enemy[battle.eIdx].hp <= 0){
      // Stash the final Elite Four member's fallen Pokémon so it has a
      // chance to be revived on a later turn (see maybeEliteFinalRevive()),
      // then move on to the next squad member as normal either way.
      if(battle.trainer.isFinalElite && !battle.eliteAiRevived && !battle.eliteFaintedMon){
        const e = battle.enemy[battle.eIdx];
        battle.eliteFaintedMon = { mon: e.mon, maxHp: e.maxHp, moves: e.moves };
        battle.eliteFaintedIdx = battle.eIdx;
      }
      battle.eIdx++;
      if(battle.eIdx < battle.enemy.length){
        appendBattleLog(`${battle.trainer.name} sends out ${displayName(battle.enemy[battle.eIdx].mon.name)}!`, '', 'info');
      }
    }

    battle.resolving = false;

    if(teamWiped){ endBattle(false); return; }
    if(battle.eIdx >= battle.enemy.length){ endBattle(true); return; }
    if(activeFainted){ promptForcedSwitch(); return; }

    renderHpPanel();
    renderBattleControls();
    battle.nextTimerId = setTimeout(battleStep, ITEM_WINDOW_MS);
  }

  // ---------- DOUBLE BATTLE (2v2, both sides simultaneously active) ----------
  // No pIdx/eIdx, no bench, no forced switch — every alive combatant on both
  // sides acts once per exchange, resolved in speed order across all 4, each
  // picking a random alive opposing slot as its target (re-checked live, so a
  // target that faints mid-exchange doesn't get attacked twice).
  function doubleBattleStep(){
    battle.resolving = true;
    renderBattleControls();

    const combatants = [];
    battle.player.forEach((b,i) => { if(b.hp > 0) combatants.push({ side:'player', b, idx:i }); });
    battle.enemy.forEach((b,i) => { if(b.hp > 0) combatants.push({ side:'enemy', b, idx:i }); });
    combatants.sort((a,z) => (z.b.mon.speed || 0) - (a.b.mon.speed || 0));

    let delay = 0;
    combatants.forEach(c => {
      setTimeout(() => resolveDoubleAttack(c), delay);
      delay += 900;
    });
    setTimeout(afterDoubleExchange, delay);
  }

  function resolveDoubleAttack(c){
    if(!battle || battle.over || c.b.hp <= 0) return; // fainted earlier this exchange
    if(handleSleepTurn(c.b)) return;
    const oppositeArr = c.side === 'player' ? battle.enemy : battle.player;
    const aliveOpp = oppositeArr.filter(ob => ob.hp > 0);
    if(!aliveOpp.length) return; // whole opposing side already down — win/loss caught in afterDoubleExchange
    const foe = pick(aliveOpp);
    const move = pickEffectiveMove(c.b, foe);
    const hit = Math.random()*100 < (move.accuracy ?? 100);
    if(!hit){
      appendBattleLog(`${displayName(c.b.mon.name)} used ${move.name}!`, `${displayName(c.b.mon.name)}'s attack missed!`, 'miss');
      return;
    }
    const { dmg, eff } = computeDamage(c.b, foe, move);
    foe.hp = Math.max(0, foe.hp - dmg);
    const effText = eff > 1 ? "It's super effective!" : (eff < 1 && eff > 0) ? "It's not very effective..." : eff === 0 ? "It had no effect..." : `${dmg} damage`;
    appendBattleLog(`${displayName(c.b.mon.name)} used ${move.name} on ${displayName(foe.mon.name)}!`, effText, 'hit');
    if(eff > 0) maybeApplyMoveStatus(move, foe, c.b);
    renderHpPanel();
    if(foe.hp <= 0){
      appendBattleLog(`${displayName(foe.mon.name)} fainted!`, '', 'faint');
    }
  }

  function afterDoubleExchange(){
    battle.firstTurnResolved = true;
    battle.resolving = false;

    // Doubles has no single "active" slot per side — every Pokémon standing
    // is on the field at once, so end-of-turn status damage applies to all
    // of them, not just one.
    battle.player.forEach(applyEndOfTurnStatus);
    battle.enemy.forEach(applyEndOfTurnStatus);
    renderHpPanel();
    trackLastStandHp(battle.player);
    battle.player.forEach(b => { if(b.hp <= 0) removeFaintedFromRoster(b.mon); });

    const playerWiped = battle.player.every(b => b.hp <= 0);
    const enemyWiped = battle.enemy.every(b => b.hp <= 0);
    if(playerWiped){ endBattle(false); return; }
    if(enemyWiped){ endBattle(true); return; }

    renderHpPanel();
    renderBattleControls();
    battle.nextTimerId = setTimeout(doubleBattleStep, ITEM_WINDOW_MS);
  }

  function endBattle(won){
    battle.over = true;
    const isGym = battle.trainer.isGym;
    const isLegendary = battle.trainer.isLegendary;
    const isMythical = battle.trainer.isMythical;
    const isElite = battle.trainer.isElite;
    const isCruise = battle.trainer.isCruise;
    const isRival = battle.trainer.isRival;
    // Set only on a Gym win — routes to the "YOU WON!" popup (with the
    // badge) instead of logging the badge/evolution lines and showing the
    // normal bottom Continue button, see the bottom of this function.
    let gymWinInfo = null;
    appendBattleLog(
      won ? `${battle.trainer.name} is out of usable Pokémon. You won!` : `Your team fainted... ${battle.trainer.name} wins.`,
      '', won ? 'win' : 'out'
    );

    // Comeback Kid achievement, the run only needs this to have happened
    // once, in any single battle, so it's a one-way flag (never cleared).
    if(won && battle.minLastStandHpFrac !== undefined && battle.minLastStandHpFrac < COMEBACK_KID_HP_THRESHOLD){
      comebackKidAchieved = true;
    }

    if(isLegendary || isMythical){
      const handled = won ? 'caught' : 'fled';
      if(isLegendary) legendaryHandled = handled; else mythicalHandled = handled;
      if(won){
        const specialMon = battle.enemy[0].mon;
        storage_.push(specialMon);
        flagComputerNotification(specialMon.name);
        appendBattleLog(`${displayName(specialMon.name)} was defeated and sent to your Storage!`, '', 'win');
      } else {
        appendBattleLog(`${displayName(battle.enemy[0].mon.name)} fled! You won't get another shot at it this run.`, '', 'out');
      }
    } else if(won){
      if(isElite){
        eliteIndex++;
        const goldWon = randInt(ELITE_GOLD_MIN, ELITE_GOLD_MAX) * battle.trainer.squad.length;
        runGoldEarned += goldWon;
        META.gold += goldWon;
        saveMeta();
        appendBattleLog(`Elite Four member down! +${goldWon}G.`, '', 'win');
        pendingEvolution = evolveRandomEligible();
        recordEvolution(pendingEvolution);
        if(pendingEvolution){
          appendBattleLog(pendingEvolution.isMega ? `Something on your team is Mega Evolving...` : `Something on your team is evolving...`, '', 'win');
        }
        if(eliteIndex >= ELITE_FOUR.length){
          runChampion = true;
          inv.masterBalls = (inv.masterBalls || 0) + 1;
          appendBattleLog(`Champion reward: you received a Master Ball!`, '', 'win');
        }
      } else if(isCruise){
        cruiseStageIndex++;
        const goldWon = randInt(CRUISE_GOLD_MIN, CRUISE_GOLD_MAX) * battle.trainer.squad.length;
        runGoldEarned += goldWon;
        META.gold += goldWon;
        saveMeta();
        appendBattleLog(`${battle.trainer.name} is out of Pokémon! +${goldWon}G.`, '', 'win');
        if(battle.trainer.isCaptain){
          inv.megaStone = (inv.megaStone || 0) + 1;
          flagComputerNotification();
          appendBattleLog(`Captain Sereia hands you a Mega Stone!`, '', 'reward');
        }
      } else if(isRival){
        const goldWon = randInt(RIVAL_GOLD_MIN, RIVAL_GOLD_MAX) * battle.trainer.squad.length;
        runGoldEarned += goldWon;
        META.gold += goldWon;
        saveMeta();
        appendBattleLog(`You bested ${battle.trainer.name}! +${goldWon}G.`, '', 'win');
        pendingEvolution = evolveRandomEligible();
        recordEvolution(pendingEvolution);
        if(pendingEvolution){
          appendBattleLog(pendingEvolution.isMega ? `Something on your team is Mega Evolving...` : `Something on your team is evolving...`, '', 'win');
        }
      } else {
        const goldWon = (isGym ? randInt(GYM_GOLD_MIN, GYM_GOLD_MAX) : randInt(TRAINER_GOLD_MIN, TRAINER_GOLD_MAX)) * battle.trainer.squad.length;
        runGoldEarned += goldWon;
        META.gold += goldWon;
        saveMeta();
        if(isGym){
          runBadges++;
          runBeatenBadges.add(battle.trainer.badgeKey);
          pendingEvolution = evolveRandomEligible();
          recordEvolution(pendingEvolution);
          gymWinInfo = { goldWon, badgeKey: battle.trainer.badgeKey, pendingEvolution };
        } else {
          runTrainersBeaten++;
          inv.balls += TRAINER_BALL_REWARD;
          appendBattleLog(`You picked up ${goldWon}G and ${TRAINER_BALL_REWARD} Pokéball from the win.`, '', 'win');
        }
      }
    } else {
      trainerLoss = battle.trainer.name;
    }

    renderBattleControls();
    renderTeamSwitchStrip();
    renderBattleItemsPanel();
    if(gymWinInfo){
      openGymWinModal(gymWinInfo);
    } else {
      document.getElementById('battleContinueBtn').style.display = 'block';
      document.getElementById('battleContinueBtn').onclick = () => afterBattle(won);
    }
  }

  // Gym wins only: shows the badge just earned in a small popup instead of
  // logging "You earned a Badge!"/evolution lines to the battle log and
  // using the normal bottom Continue button — its own Continue button here
  // is what actually calls afterBattle() to move on.
  function openGymWinModal({ goldWon, badgeKey, pendingEvolution }){
    const badge = BADGES.find(b => b.key === badgeKey);
    const icon = document.getElementById('gymWinBadgeIcon');
    // Undoes any stale display:none left by onerror firing on the element's
    // initial empty src="" (a real <img src=""> resolves to the page's own
    // URL and errors immediately on load, well before this ever runs).
    icon.style.display = '';
    icon.src = badge ? `${BADGE_ICON_DIR}/${badge.icon}` : '';
    icon.alt = badge ? badge.leaderName : '';
    const evoNote = pendingEvolution
      ? `<br>${pendingEvolution.isMega ? 'Something on your team is Mega Evolving...' : 'Something on your team is evolving...'}`
      : '';
    document.getElementById('gymWinText').innerHTML = `You earned a Badge! <span class="gold-text">+${goldWon}G</span>${evoNote}`;
    document.getElementById('gymWinModal').classList.add('active');
  }

  function closeGymWinModal(){
    document.getElementById('gymWinModal').classList.remove('active');
    afterBattle(true);
  }

  function afterBattle(won){
    document.getElementById('battleScreen').classList.remove('active');
    document.getElementById('battleContinueBtn').style.display = 'none';
    const wasGym = battle.trainer.isGym;
    const wasLegendary = battle.trainer.isLegendary;
    const wasMythical = battle.trainer.isMythical;
    const wasElite = battle.trainer.isElite;
    const wasCruise = battle.trainer.isCruise;
    const wasRival = battle.trainer.isRival;

    if(wasMythical){
      // Win or lose, this always routes to a PokeStop stop (never ends the
      // run) — the next stop from there leads into the Legendary encounter.
      openPokeStop('mythical');
      return;
    }
    if(wasLegendary){
      // Endgame resupply: raises how many more Potions/Revives the PokeStop
      // shop will sell this run, as the player heads into the hardest
      // stretch (Cruise/Elite Four). Still has to be bought with gold —
      // this only lifts the lifetime purchase cap, it doesn't hand out items.
      shopLifetimeBonus.potions = (shopLifetimeBonus.potions || 0) + ENDGAME_RESUPPLY_POTIONS;
      shopLifetimeBonus.revives = (shopLifetimeBonus.revives || 0) + ENDGAME_RESUPPLY_REVIVES;
      // Win or lose, this always routes to a PokeStop stop (never ends the run).
      openPokeStop('legendary');
      return;
    }
    if(!won){
      finishEncounter();
      return;
    }
    if(wasGym || wasRival || wasElite || (wasCruise && battle.trainer.isCaptain)){
      casinoTokens += CASINO_TOKENS_PER_BOSS_WIN;
    }
    if(runChampion){
      // Beat all 4 Elite Four members — show the Champion ending screen
      // first; its own Continue button is what actually finishes the run.
      openChampionEnding();
      return;
    }
    if(wasElite){
      openPokeStop('preElite');
      return;
    }
    if(wasRival){
      openPokeStop('cruiseComplete');
      return;
    }
    if(wasCruise){
      openPokeStop('cruiseCasino');
      return;
    }
    // A plain route-trainer win (never a Gym win) can offer a trade before
    // moving on — see openTradeOffer().
    if(!wasGym && runTrainersBeaten >= TRADE_OFFER_MIN_TRAINERS_BEATEN && Math.random() < TRADE_OFFER_CHANCE){
      openTradeOffer(battle.trainer, () => openPokeStop('preGym'));
      return;
    }
    // renderPokeStop's 'postGym' branch detects when the 8th badge was just
    // earned and routes the continue button to the Legendary instead of the
    // next encounter.
    openPokeStop(wasGym ? 'postGym' : 'preGym');
  }

  // ---------- RANDOM EVENT: TRADE OFFER (route trainers only, see afterBattle()) ----------
  let tradeOfferMon, tradeOfferTrainerName, tradeOfferOnDone;
  let tradeGiveSelectedKind, tradeGiveSelectedIdx;

  function openTradeOffer(trainer, onDone){
    // catchablePool() already excludes legendaries (p.legendary), but not
    // mythicals — those get their own explicit exclusion, same as
    // tokenShopPool() (game.js:4337).
    tradeOfferMon = pick(catchablePool().filter(p => !MYTHICAL_POKEMON.includes(p.name)));
    tradeOfferTrainerName = trainer.name;
    tradeOfferOnDone = onDone;
    document.getElementById('tradeOfferHeading').textContent = `${trainer.name} wants to trade!`;
    renderTradeOfferBody(`
      <div class="trade-mon-showcase">
        ${avatarHTML(tradeOfferMon,'avatar-sm')}
        <span class="tn">${displayName(tradeOfferMon.name)}</span>
      </div>
      <p class="tagline">${trainer.name} is offering to trade you this Pokémon. Interested?</p>
      <div class="actions">
        <button class="btn-ghost" id="tradeDeclineBtn">DECLINE</button>
        <button class="btn-primary" id="tradeAcceptBtn">ACCEPT</button>
      </div>
    `);
    document.getElementById('tradeDeclineBtn').onclick = closeTradeOffer;
    document.getElementById('tradeAcceptBtn').onclick = renderTradeGivePhase;
    document.getElementById('tradeOfferScreen').classList.add('active');
  }

  function renderTradeOfferBody(html){
    document.getElementById('tradeOfferBody').innerHTML = html;
  }

  function closeTradeOffer(){
    document.getElementById('tradeOfferScreen').classList.remove('active');
    const onDone = tradeOfferOnDone;
    tradeOfferMon = null;
    tradeOfferTrainerName = null;
    tradeOfferOnDone = null;
    onDone();
  }

  function tradeGiveRowHTML(mon, kind, idx){
    const selected = tradeGiveSelectedKind === kind && tradeGiveSelectedIdx === idx;
    return `<div class="team-mgmt-row trade-give-row ${selected ? 'selected' : ''}" data-kind="${kind}" data-idx="${idx}">
      ${avatarHTML(mon,'avatar-sm')}
      <div class="team-mgmt-info">
        <span class="tn">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">✨</span>' : ''}</span>
        <span class="tt" style="color:${TYPE_COLOR[mon.types[0]]}">${mon.types.join(' / ')}</span>
      </div>
      <span class="tt">${kind === 'active' ? 'ACTIVE' : 'STORAGE'}</span>
    </div>`;
  }

  // Starter is excluded by reference (same guard renderResult/finishEncounter
  // already use for `allCaught`) — it never appears as something to give away.
  function renderTradeGivePhase(){
    tradeGiveSelectedKind = null;
    tradeGiveSelectedIdx = null;
    const rows = [
      ...activeTeam.map((mon,i) => mon === starter ? null : { mon, kind:'active', idx:i }),
      ...storage_.map((mon,i) => ({ mon, kind:'storage', idx:i })),
    ].filter(Boolean);

    renderTradeOfferBody(`
      <p class="tagline">Choose a Pokémon to give up in return.</p>
      <div id="tradeGiveGrid">${rows.map(r => tradeGiveRowHTML(r.mon, r.kind, r.idx)).join('')}</div>
      <div class="actions">
        <button class="btn-primary" id="tradeConfirmBtn" disabled>CONFIRM TRADE</button>
      </div>
    `);

    const confirmBtn = document.getElementById('tradeConfirmBtn');
    document.querySelectorAll('.trade-give-row').forEach(row => {
      row.addEventListener('click', () => {
        tradeGiveSelectedKind = row.dataset.kind;
        tradeGiveSelectedIdx = Number(row.dataset.idx);
        document.querySelectorAll('.trade-give-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        confirmBtn.disabled = false;
      });
    });
    confirmBtn.onclick = confirmTrade;
  }

  function confirmTrade(){
    if(tradeGiveSelectedKind === null) return;
    let givenMon;
    if(tradeGiveSelectedKind === 'active'){
      if(activeTeam.length <= 1) return; // must always keep at least 1 active Pokémon
      [givenMon] = activeTeam.splice(tradeGiveSelectedIdx, 1);
    } else {
      [givenMon] = storage_.splice(tradeGiveSelectedIdx, 1);
    }
    const receivedMon = tradeOfferMon;
    storage_.push(receivedMon);
    flagComputerNotification(receivedMon.name);

    renderTradeOfferBody(`
      <div class="evolution-reveal trade-swap-reveal" id="tradeSwapReveal" style="display:block;">
        <div class="evolution-stage">
          <div class="evo-mon evo-from">${avatarHTML(givenMon,'avatar-sm')}</div>
          <div class="evolution-arrow">⇄</div>
          <div class="evo-mon evo-to">${avatarHTML(receivedMon,'avatar-sm')}</div>
        </div>
        <div class="evolution-text">Traded away ${displayName(givenMon.name)} for ${displayName(receivedMon.name)}!</div>
      </div>
    `);
    const reveal = document.getElementById('tradeSwapReveal');
    void reveal.offsetWidth; // restart the shared evo-fade animation from scratch
    reveal.classList.add('evolve-anim');

    setTimeout(renderTradeThanksPhase, 2700);
  }

  function renderTradeThanksPhase(){
    renderTradeOfferBody(`
      <p class="tagline">${tradeOfferTrainerName} thanks you for the trade!</p>
      <button class="btn-primary" id="tradeContinueBtn">CONTINUE</button>
    `);
    document.getElementById('tradeContinueBtn').onclick = closeTradeOffer;
  }

  // ---------- RANDOM EVENT: LUCKY SPIN (Cruise Casino prize wheel) ----------
  let luckySpinOnDone, luckySpinUsed;

  function openLuckySpin(onDone){
    luckySpinOnDone = onDone;
    luckySpinUsed = false;
    document.getElementById('luckySpinLog').innerHTML = '';
    document.getElementById('luckySpinWinBanner').style.display = 'none';
    document.getElementById('luckySpinLeaveBtn').style.display = 'none';
    const spinBtn = document.getElementById('luckySpinBtn');
    spinBtn.style.display = 'block';
    spinBtn.disabled = false;
    spinBtn.textContent = 'SPIN THE WHEEL';
    const wheel = document.getElementById('luckyWheel');
    wheel.classList.remove('resetting');
    wheel.style.transition = 'none';
    wheel.style.transform = 'rotate(0deg)';
    wheel.style.background = `conic-gradient(${buildLuckyWheelGradient()})`;
    document.getElementById('luckyWheelPointer').classList.remove('landed');
    renderLuckyWheelLegend();
    document.getElementById('luckySpinScreen').classList.add('active');
    spinBtn.onclick = spinLuckyWheel;
    document.getElementById('luckySpinLeaveBtn').onclick = closeLuckySpin;
  }

  // Only the latest line is shown — no piling up of prior spins.
  function appendLuckySpinLog(text){
    const wrap = document.getElementById('luckySpinLog');
    wrap.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'catch-log-line';
    line.textContent = text;
    wrap.appendChild(line);
  }

  // A random starter reward skips the player's own already-owned starter(s)
  // — no point handing back a duplicate of what they already have.
  function pickLuckySpinStarter(){
    const owned = new Set([...activeTeam, ...storage_].map(m => m.name));
    const pool = STARTERS.filter(n => !owned.has(n));
    return POKEMON_BY_NAME[pick(pool.length ? pool : STARTERS)];
  }

  function applyLuckySpinReward(outcome){
    if(outcome.key === 'gold'){
      const amt = 1000;
      runGoldEarned += amt;
      META.gold += amt;
      saveMeta();
      return { text: `You win 1000G!`, jackpot:false };
    }
    if(outcome.key === 'revive'){
      inv.revives = (inv.revives || 0) + 1;
      return { text: `You win a Revive!`, jackpot:false };
    }
    if(outcome.key === 'potion'){
      inv.potions = (inv.potions || 0) + 1;
      return { text: `You win a Potion!`, jackpot:false };
    }
    if(outcome.key === 'starter'){
      const mon = pickLuckySpinStarter();
      if(activeTeam.length < MAX_PARTY_SIZE) activeTeam.push(mon); else storage_.push(mon);
      flagComputerNotification(mon.name);
      return { text: `🎉 Jackpot! A wild ${displayName(mon.name)} joins your team!`, jackpot:true };
    }
    // Same reward pool/rules as the Token Casino's Token Exchange
    // (tokenExchangePool()) — a random shiny, fully-evolved Pokémon — just
    // reached here through a far rarer wheel slice instead of spending Tokens.
    if(outcome.key === 'keyPrize'){
      const pool = tokenExchangePool();
      const won = pool.length ? { ...pick(pool), is_shiny:true } : null;
      if(!won) return { text: `Key Prize... but there was nothing left to give. Weird.`, jackpot:false };
      if(activeTeam.length < MAX_PARTY_SIZE) activeTeam.push(won); else storage_.push(won);
      flagComputerNotification(won.name);
      openShinyRevealModal(won);
      return { text: `✨ Key Prize! A shiny ${displayName(won.name)} joins your team!`, jackpot:true };
    }
    // Doesn't touch cruiseMiniEventUsed.slots — that's still flagged from the
    // very first spin this visit, this just lets the wheel spin once more
    // before the player leaves (see the `spinAgain` handling below).
    if(outcome.key === 'spinAgain'){
      return { text: `Spin Again! One more pull, on the house.`, jackpot:false, spinAgain:true };
    }
    return { text: `No prize this time, better luck next run!`, jackpot:false };
  }

  function spinLuckyWheel(){
    if(luckySpinUsed) return;
    luckySpinUsed = true;
    const spinBtn = document.getElementById('luckySpinBtn');
    spinBtn.disabled = true;

    const outcome = pickWeighted(LUCKY_SPIN_OUTCOMES);
    const wheel = document.getElementById('luckyWheel');
    const pointer = document.getElementById('luckyWheelPointer');
    const targetRotation = LUCKY_SPIN_EXTRA_TURNS * 360 + ((360 - outcome.centerDeg) % 360);
    // A gentle overshoot-then-settle curve, and a touch longer than before —
    // reads more like a real wheel winding down than an abrupt stop. Opacity
    // is included here too so the "Spin Again" reset fade (see .resetting
    // below) actually animates instead of snapping, since this inline value
    // overrides the CSS rule's own transition list.
    wheel.style.transition = 'transform 3.8s cubic-bezier(0.22, 0.85, 0.1, 1), opacity .22s ease';
    pointer.classList.remove('landed');
    void wheel.offsetWidth;
    wheel.style.transform = `rotate(${targetRotation}deg)`;

    setTimeout(() => {
      const { text, jackpot, spinAgain } = applyLuckySpinReward(outcome);
      appendLuckySpinLog(text);
      // A little bounce on the pointer right as the wheel settles — sells
      // the "it just landed" moment instead of the wheel just silently stopping.
      pointer.classList.add('landed');
      const banner = document.getElementById('luckySpinWinBanner');
      if(outcome.key !== 'nothing'){
        banner.textContent = jackpot ? '★ JACKPOT ★' : 'WINNER!';
        banner.style.display = 'block';
        banner.classList.remove('win-pop');
        void banner.offsetWidth;
        banner.classList.add('win-pop');
      }
      document.getElementById('luckySpinLeaveBtn').style.display = 'block';
      if(spinAgain){
        luckySpinUsed = false;
        spinBtn.disabled = false;
        spinBtn.textContent = 'SPIN AGAIN!';
        spinBtn.style.display = 'block';
        // Fades out, snaps back to 0deg while invisible, fades back in —
        // avoids the wheel visibly teleporting backwards before the next spin.
        wheel.classList.add('resetting');
        setTimeout(() => {
          wheel.style.transition = 'none';
          wheel.style.transform = 'rotate(0deg)';
          void wheel.offsetWidth;
          wheel.classList.remove('resetting');
        }, 260);
      } else {
        spinBtn.style.display = 'none';
      }
    }, 3800);
  }

  function closeLuckySpin(){
    document.getElementById('luckySpinScreen').classList.remove('active');
    const onDone = luckySpinOnDone;
    luckySpinOnDone = null;
    onDone();
  }

  // ---------- POKESTOP CASINO (Lucky Dice + Token Shop) ----------
  // Unlocked once the endgame opens — 8th badge, or reaching the Cruise Ship,
  // whichever comes first (in practice the Cruise Ship is only reachable
  // after the 8th badge anyway, so this is really just the badge check, kept
  // explicit to match the original request).
  function pokestopCasinoUnlocked(){
    // Nuzlocke drops the Token Casino entirely, no dice game, no Token Shop.
    if(gameMode === 'nuzlocke') return false;
    return runBadges >= BADGES_TO_UNLOCK_ENDGAME || cruiseStageIndex !== null;
  }

  function openPokestopCasino(){
    document.getElementById('pokestopScreen').classList.remove('active');
    document.getElementById('tokenCasinoScreen').classList.add('active');
    [0,1,2].forEach(die => {
      const el = document.getElementById(`tokenCasinoDie${die}`);
      el.innerHTML = dieFaceHTML(1);
      el.classList.remove('winning-roll');
    });
    document.getElementById('tokenCasinoWinBanner').style.display = 'none';
    document.getElementById('tokenCasinoPayout').textContent = '0';
    document.getElementById('tokenCasinoLog').innerHTML = '';
    document.getElementById('tokenCasinoSpinBtn').onclick = rollLuckyDice;
    document.getElementById('tokenCasinoBackBtn').onclick = closePokestopCasino;
    renderTokenCasinoState();
    renderTokenShop();
  }

  function closePokestopCasino(){
    document.getElementById('tokenCasinoScreen').classList.remove('active');
    document.getElementById('pokestopScreen').classList.add('active');
    renderPokeStop();
  }

  function renderTokenCasinoState(){
    const creditDisplay = document.getElementById('tokenCasinoCredit');
    if(creditDisplay) creditDisplay.textContent = casinoTokens;
    const goldBadge = document.getElementById('tokenCasinoGold');
    if(goldBadge) goldBadge.textContent = `${META.gold}G`;
    const spinBtn = document.getElementById('tokenCasinoSpinBtn');
    spinBtn.textContent = `ROLL THE DICE (${CASINO_SPIN_COST_GOLD}G)`;
    spinBtn.disabled = META.gold < CASINO_SPIN_COST_GOLD;
  }

  function appendTokenCasinoLog(text){
    const wrap = document.getElementById('tokenCasinoLog');
    wrap.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'catch-log-line';
    line.textContent = text;
    wrap.appendChild(line);
  }


  // Active only while a roll is in flight — null the rest of the time.
  let diceRollState = null;

  // Only one combination per roll (no overlapping-line concept like the old
  // slot machine had), so there's nothing to sum/double — straightforward
  // priority: triple 6s > triple 1s > any other triple > straight > pair.
  function evaluateDiceRoll(dice){
    const [a,b,c] = dice;
    if(a === b && b === c){
      if(a === 6) return { key:'triple6', payout:DICE_PAYOUTS.triple6 };
      if(a === 1) return { key:'triple1', payout:DICE_PAYOUTS.triple1 };
      return { key:'triple', payout:DICE_PAYOUTS.triple };
    }
    const sorted = [...dice].sort((x,y) => x - y);
    if(sorted[1] === sorted[0] + 1 && sorted[2] === sorted[1] + 1){
      return { key:'straight', payout:DICE_PAYOUTS.straight };
    }
    if(a === b || b === c || a === c) return { key:'pair', payout:DICE_PAYOUTS.pair };
    return { key:'none', payout:0 };
  }

  function rollLuckyDice(){
    if(diceRollState || META.gold < CASINO_SPIN_COST_GOLD) return;
    META.gold -= CASINO_SPIN_COST_GOLD;
    goldSpentOnSlots += CASINO_SPIN_COST_GOLD; // High Roller achievement
    saveMeta();

    document.getElementById('tokenCasinoSpinBtn').disabled = true;
    document.getElementById('tokenCasinoPayout').textContent = '0';
    document.getElementById('tokenCasinoWinBanner').style.display = 'none';
    document.querySelectorAll('.die-face.winning-roll').forEach(d => d.classList.remove('winning-roll'));
    renderTokenCasinoState();

    const finalDice = [randInt(1,6), randInt(1,6), randInt(1,6)];
    diceRollState = { finalDice, cycleTimers:[null,null,null], diceLocked:[false,false,false] };

    // Each die flickers through random faces independently while "rolling".
    for(let die = 0; die < 3; die++){
      const el = document.getElementById(`tokenCasinoDie${die}`);
      diceRollState.cycleTimers[die] = setInterval(() => {
        el.innerHTML = dieFaceHTML(randInt(1,6));
      }, DICE_CYCLE_MS);
    }

    // Auto-lock, left to right, with a short delay between each — same
    // suspense the old reels had.
    [0, 1, 2].forEach(die => {
      setTimeout(() => lockDie(die), DICE_LOCK_INTERVAL * (die + 1));
    });
  }

  // Locks one die onto its final face. Safe to call more than once — a die
  // already locked is a no-op. Once all 3 are locked, hands off to scoring.
  function lockDie(die){
    if(!diceRollState || diceRollState.diceLocked[die]) return;
    const { finalDice, cycleTimers, diceLocked } = diceRollState;
    clearInterval(cycleTimers[die]);
    diceLocked[die] = true;

    const el = document.getElementById(`tokenCasinoDie${die}`);
    el.classList.remove('spin-anim');
    void el.offsetWidth;
    el.classList.add('spin-anim');
    el.innerHTML = dieFaceHTML(finalDice[die]);

    if(diceLocked.every(Boolean)){
      setTimeout(() => finishDiceRoll(finalDice), 300);
    }
  }

  const DICE_RESULT_LOG = {
    triple6:  n => `⚅⚅⚅ TRIPLE 6s! JACKPOT! You win ${n} Tokens!`,
    triple1:  n => `⚀⚀⚀ Triple 1s! You win ${n} Tokens!`,
    triple:   n => `Triple! You win ${n} Tokens!`,
    straight: n => `Straight! You win ${n} Tokens!`,
    pair:     n => `Pair! You win ${n} Tokens!`,
    none:     () => `No match this time, better luck next roll.`,
  };

  function finishDiceRoll(finalDice){
    diceRollState = null;
    document.getElementById('tokenCasinoSpinBtn').disabled = false;

    const { key, payout } = evaluateDiceRoll(finalDice);
    const payoutDisplay = document.getElementById('tokenCasinoPayout');
    const banner = document.getElementById('tokenCasinoWinBanner');
    payoutDisplay.textContent = payout;

    if(payout > 0){
      casinoTokens += payout;
      [0,1,2].forEach(die => document.getElementById(`tokenCasinoDie${die}`).classList.add('winning-roll'));
      appendTokenCasinoLog(DICE_RESULT_LOG[key](payout));
      banner.textContent = key === 'triple6' ? '★ JACKPOT ★' : key === 'triple1' ? '★ BIG WIN ★' : 'WINNER!';
      banner.style.display = 'block';
      banner.classList.remove('win-pop');
      void banner.offsetWidth;
      banner.classList.add('win-pop');
    } else {
      banner.style.display = 'none';
      appendTokenCasinoLog(DICE_RESULT_LOG.none());
    }

    renderTokenCasinoState();
    renderTokenShop();
  }

  // "Stage 2" for the Token Exchange means a Pokémon reached by evolving
  // from something else, that doesn't itself evolve any further — i.e. a
  // fully-evolved, non-base form. Mythicals/Legendaries are already
  // excluded by wildPool()-style filtering below.
  function isFinalEvolutionStage(name){
    if(EVOLUTIONS[name]) return false; // still has somewhere further to evolve
    return Object.values(EVOLUTIONS).some(v => Array.isArray(v) ? v.includes(name) : v === name);
  }

  // True single-stage species only, no pre-evolution AND nothing to evolve
  // into (e.g. Tauros, Farfetch'd). Used by the Underdog achievement; unlike
  // isFinalEvolutionStage() above (which requires a pre-evolution to exist),
  // this requires the exact opposite on that side.
  function hasNoEvolutionaryRelations(name){
    const hasNext = !!EVOLUTIONS[name];
    const hasPre = Object.values(EVOLUTIONS).some(v => Array.isArray(v) ? v.includes(name) : v === name);
    return !hasNext && !hasPre;
  }

  function tokenExchangePool(){
    return catchablePool().filter(p => !MYTHICAL_POKEMON.includes(p.name) && isFinalEvolutionStage(p.name));
  }

  function renderTokenShop(){
    const grid = document.getElementById('tokenShopGrid');
    if(!grid) return;
    grid.innerHTML = Object.entries(TOKEN_SHOP_ITEMS).map(([key,item]) => {
      const affordable = casinoTokens >= item.cost;
      return `<div class="shop-row">
        <div class="shop-left">
          ${itemIconHTML(item.invKey || key)}
          <div class="shop-info">
            <div class="shop-name">${item.label}</div>
            <div class="shop-desc">${item.desc}</div>
          </div>
        </div>
        <button class="btn-ghost shop-buy" data-key="${key}" ${affordable ? '' : 'disabled'}>BUY · ${item.cost} Tokens</button>
      </div>`;
    }).join('');
    grid.querySelectorAll('.shop-buy').forEach(btn => {
      btn.addEventListener('click', () => buyTokenShopItem(btn.dataset.key));
    });
  }

  function buyTokenShopItem(key){
    const item = TOKEN_SHOP_ITEMS[key];
    if(!item || casinoTokens < item.cost) return;
    casinoTokens -= item.cost;
    if(item.isExchange){
      tokenExchangeBought = true; // Treasure Hunter achievement
      const pool = tokenExchangePool();
      const won = pool.length ? { ...pick(pool), is_shiny:true } : null;
      if(won){
        if(activeTeam.length < MAX_PARTY_SIZE) activeTeam.push(won); else storage_.push(won);
        flagComputerNotification(won.name);
        appendTokenCasinoLog(`✨ Token Exchange: a shiny ${displayName(won.name)} joins your team!`);
        openShinyRevealModal(won);
      }
    } else {
      inv[item.invKey] = (inv[item.invKey] || 0) + 1;
      appendTokenCasinoLog(`Exchanged Tokens for a ${item.label}.`);
    }
    renderTokenCasinoState();
    renderTokenShop();
  }

  // ---------- CRUISE CASINO MINI-EVENT: FISHING ----------
  let fishingCastsLeft, fishingOnDone, fishingBusy;
  // Suspense timings for the cast->tug->reveal sequence (see castFishingLine()/
  // renderFishingScene()) — purely presentational, doesn't touch the actual
  // catch odds (FISHING_CATCH_CHANCE), just makes every cast feel like it's
  // actually fighting something on the line before showing the result.
  const FISHING_CAST_ANIM_MS = 500;
  const FISHING_TUG_ANIM_MS = 900;

  function openFishing(onDone){
    fishingCastsLeft = gameMode === 'nuzlocke' ? NUZLOCKE_FISHING_CASTS : FISHING_CASTS;
    fishingOnDone = onDone;
    fishingBusy = false;
    document.getElementById('fishingLog').innerHTML = '';
    document.getElementById('fishingLeaveBtn').style.display = 'none';
    document.getElementById('fishingCastBtn').style.display = 'block';
    document.getElementById('fishingScreen').classList.add('active');
    renderFishingScene('idle');
    renderFishingState();
    document.getElementById('fishingCastBtn').onclick = castFishingLine;
    document.getElementById('fishingLeaveBtn').onclick = closeFishing;
  }

  // Rebuilds the `.fishing-scene` box for whichever beat of the cast sequence
  // we're in. `phase` drives both the markup and (via the CSS class of the
  // same name) which animation plays; restarting the animation on every call
  // uses the same "force reflow, then add the class" trick as
  // renderEvolutionReveal().
  function renderFishingScene(phase, mon){
    const scene = document.getElementById('fishingScene');
    if(!scene) return;
    if(phase === 'caught'){
      scene.innerHTML = `
        <div class="fishing-catch-reveal caught">
          <div class="fishing-catch-avatar">${avatarHTML(mon,'avatar-sm')}</div>
          <span class="fishing-catch-label">GOTCHA!</span>
        </div>`;
    } else if(phase === 'released'){
      scene.innerHTML = `
        <div class="fishing-catch-reveal released">
          <span class="fishing-splash">💦</span>
          <span class="fishing-catch-label">IT GOT AWAY...</span>
        </div>`;
    } else if(phase === 'tugging'){
      scene.innerHTML = `<span class="fishing-bobber">🎣</span><span class="fishing-tug-indicator">!</span>`;
    } else {
      scene.innerHTML = `<span class="fishing-bobber">🎣</span>`;
    }
    scene.className = 'fishing-scene';
    void scene.offsetWidth; // restart the phase's animation every time this is (re-)shown
    scene.classList.add(phase);
  }

  function renderFishingState(){
    document.getElementById('fishingCastsLeft').textContent = fishingCastsLeft;
    document.getElementById('fishingCastBtn').textContent = `CAST THE LINE (${fishingCastsLeft} LEFT)`;
    document.getElementById('fishingCastBtn').disabled = fishingCastsLeft <= 0;
  }

  // Only the latest line is shown — no piling up of prior casts. A
  // successful catch gets a highlighted (gold) treatment.
  function appendFishingLog(text, success){
    const wrap = document.getElementById('fishingLog');
    wrap.innerHTML = '';
    const line = document.createElement('div');
    line.className = `catch-log-line${success ? ' catch-log-success' : ''}`;
    line.textContent = text;
    wrap.appendChild(line);
  }

  function castFishingLine(){
    if(fishingCastsLeft <= 0 || fishingBusy) return;
    fishingCastsLeft--;
    fishingBusy = true;
    document.getElementById('fishingCastBtn').disabled = true;

    // Rolled up front so the reveal at the end of the animation is just
    // presenting an already-decided outcome, same odds as before.
    const success = Math.random() < FISHING_CATCH_CHANCE;
    const waterPool = wildPool().filter(p => !p.legendary && p.types.includes('water'));
    const caughtMon = success && waterPool.length ? pick(waterPool) : null;

    renderFishingScene('casting');
    setTimeout(() => {
      renderFishingScene('tugging');
      setTimeout(() => {
        if(caughtMon){
          catchWildTarget(caughtMon, 'fishing');
          renderFishingScene('caught', caughtMon);
          appendFishingLog(`Something bit! You reeled in a wild ${displayName(caughtMon.name)}, caught, no Pokéball needed!`, true);
        } else {
          renderFishingScene('released');
          appendFishingLog(success ? `You felt a tug, but it slipped away...` : `No bites this time...`);
        }
        fishingBusy = false;
        renderFishingState();
        if(fishingCastsLeft <= 0){
          document.getElementById('fishingCastBtn').style.display = 'none';
          document.getElementById('fishingLeaveBtn').style.display = 'block';
        }
      }, FISHING_TUG_ANIM_MS);
    }, FISHING_CAST_ANIM_MS);
  }

  function closeFishing(){
    document.getElementById('fishingScreen').classList.remove('active');
    const onDone = fishingOnDone;
    fishingOnDone = null;
    onDone();
  }

  // ---------- SAFARI ZONE (instant mini-event) ----------
  let safariBallsLeft, safariBerriesLeft, safariRocksLeft, safariEncounterNum, safariTargetMon,
    safariPendingMultiplier, safariBusy, safariEncounterOver, safariOnDone;

  function openSafariZone(onDone){
    safariBallsLeft = SAFARI_BALL_COUNT;
    safariBerriesLeft = SAFARI_BERRY_COUNT;
    safariRocksLeft = SAFARI_ROCK_COUNT;
    safariEncounterNum = 0;
    safariOnDone = onDone;
    document.getElementById('safariScreen').classList.add('active');
    document.getElementById('safariBallBtn').onclick = throwSafariBall;
    document.getElementById('safariBerryBtn').onclick = useSafariBerry;
    document.getElementById('safariRockBtn').onclick = useSafariRock;
    document.getElementById('safariLeaveBtn').onclick = closeSafariZone;
    startSafariEncounter();
  }

  function startSafariEncounter(){
    safariEncounterNum++;
    if(safariEncounterNum > SAFARI_ENCOUNTERS || safariBallsLeft <= 0){
      finishSafariZone();
      return;
    }
    safariTargetMon = pick(catchablePool());
    safariPendingMultiplier = 1;
    safariBusy = false;
    safariEncounterOver = false;
    document.getElementById('safariLog').innerHTML = '';
    document.getElementById('safariLeaveBtn').style.display = 'none';
    document.getElementById('safariTarget').innerHTML = `
      ${avatarHTML(safariTargetMon)}
      <span class="c-name">${displayName(safariTargetMon.name)}</span>
      <div class="c-types">${typeChipsHTML(safariTargetMon.types)}</div>
    `;
    renderSafariControls();
  }

  function renderSafariControls(){
    document.getElementById('safariEncounterNum').textContent = Math.min(safariEncounterNum, SAFARI_ENCOUNTERS);
    document.getElementById('safariBallsLeft').textContent = safariBallsLeft;
    document.getElementById('safariBerriesLeft').textContent = safariBerriesLeft;
    document.getElementById('safariRocksLeft').textContent = safariRocksLeft;
    const busy = safariBusy || safariEncounterOver;
    const ballBtn = document.getElementById('safariBallBtn');
    ballBtn.disabled = busy || safariBallsLeft <= 0;
    ballBtn.textContent = `THROW SAFARI BALL ×${safariBallsLeft}${safariPendingMultiplier > 1 ? ' (BOOSTED)' : ''}`;
    const berryBtn = document.getElementById('safariBerryBtn');
    berryBtn.disabled = busy || safariBerriesLeft <= 0;
    berryBtn.textContent = `SAFARI BERRY ×${safariBerriesLeft}`;
    const rockBtn = document.getElementById('safariRockBtn');
    rockBtn.disabled = busy || safariRocksLeft <= 0;
    rockBtn.textContent = `THROW ROCK ×${safariRocksLeft}`;
  }

  function appendSafariLog(text){
    const wrap = document.getElementById('safariLog');
    wrap.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'catch-log-line';
    line.textContent = text;
    wrap.appendChild(line);
  }

  function useSafariBerry(){
    if(safariBusy || safariEncounterOver || safariBerriesLeft <= 0) return;
    safariBerriesLeft--;
    safariPendingMultiplier *= SAFARI_BERRY_BOOST;
    appendSafariLog(`You tossed a Safari Berry at ${displayName(safariTargetMon.name)}. Catch chance up!`);
    renderSafariControls();
  }

  function useSafariRock(){
    if(safariBusy || safariEncounterOver || safariRocksLeft <= 0) return;
    safariBusy = true;
    safariRocksLeft--;
    renderSafariControls();
    appendSafariLog(`You threw a rock at ${displayName(safariTargetMon.name)}...`);

    setTimeout(() => {
      if(Math.random() < SAFARI_ROCK_SUCCESS_CHANCE){
        safariPendingMultiplier *= SAFARI_ROCK_MODIFIER;
        appendSafariLog(`${displayName(safariTargetMon.name)} is rattled! Next throw hits much harder.`);
        safariBusy = false;
        renderSafariControls();
      } else {
        appendSafariLog(`${displayName(safariTargetMon.name)} got spooked and fled!`);
        safariEncounterOver = true;
        renderSafariControls();
        setTimeout(startSafariEncounter, 900);
      }
    }, 700);
  }

  function throwSafariBall(){
    if(safariBusy || safariEncounterOver || safariBallsLeft <= 0) return;
    safariBusy = true;
    safariBallsLeft--;
    const chance = clamp((safariTargetMon.base_species_rate ?? 0.3) * SAFARI_BALL_MODIFIER * safariPendingMultiplier, 0, 1);
    safariPendingMultiplier = 1;
    renderSafariControls();
    appendSafariLog(`You threw a Safari Ball at ${displayName(safariTargetMon.name)}...`);

    setTimeout(() => {
      const success = Math.random() < chance;
      if(success){
        catchWildTarget(safariTargetMon, 'safari');
        appendSafariLog(`Gotcha! ${displayName(safariTargetMon.name)} was caught!`);
        safariEncounterOver = true;
        renderSafariControls();
        setTimeout(startSafariEncounter, 900);
        return;
      }
      if(safariBallsLeft <= 0 || Math.random() < SAFARI_FLEE_CHANCE){
        appendSafariLog(`${displayName(safariTargetMon.name)} fled into the brush!`);
        safariEncounterOver = true;
        renderSafariControls();
        setTimeout(startSafariEncounter, 900);
        return;
      }
      appendSafariLog(`${displayName(safariTargetMon.name)} broke free! Safari Balls left: ${safariBallsLeft}.`);
      safariBusy = false;
      renderSafariControls();
    }, 700);
  }

  function finishSafariZone(){
    appendSafariLog(`That's the end of your Safari Zone visit, heading back to the PokeStop.`);
    document.getElementById('safariBallBtn').style.display = 'none';
    document.getElementById('safariBerryBtn').style.display = 'none';
    document.getElementById('safariRockBtn').style.display = 'none';
    document.getElementById('safariLeaveBtn').style.display = 'block';
  }

  function closeSafariZone(){
    document.getElementById('safariScreen').classList.remove('active');
    document.getElementById('safariBallBtn').style.display = 'block';
    document.getElementById('safariBerryBtn').style.display = 'block';
    document.getElementById('safariRockBtn').style.display = 'block';
    const onDone = safariOnDone;
    safariOnDone = null;
    onDone();
  }

  // ---------- POKESTOP (unified mid-run stop: pre-Gym shop / post-Gym city / post-Legendary) ----------
  let pokestopMode; // 'preGym' | 'postGym' | 'legendary'
  let activeEvolution; // evolution reveal for this PokeStop visit, if any (survives re-renders)

  function openPokeStop(mode){
    // Reached from all over (post-battle, post-catch bonus encounters, the
    // Computer/Gym Select back buttons, etc.) — some of those callers already
    // hide their own screen first, but not all (e.g. a curated bonus
    // encounter's catch screen going straight into openPokeStop()), so this
    // hides everything unconditionally rather than trusting every call site.
    hideAllRunScreens();
    pokestopMode = mode;
    activeEvolution = pendingEvolution;
    pendingEvolution = null;
    document.getElementById('pokestopScreen').classList.add('active');
    renderPokeStop();
  }

  function closePokeStopScreen(){
    document.getElementById('pokestopScreen').classList.remove('active');
  }

  function renderPokeStop(){
    renderGoldBadge();
    renderEvolutionReveal('evolutionReveal', activeEvolution);

    // Only shown the one time the player lands here right after beating
    // Captain Sereia (the reward that grants the Mega Stone) — hidden for
    // every other PokeStop visit.
    const megaStoneHint = document.getElementById('megaStoneHintPopup');
    if(megaStoneHint) megaStoneHint.style.display = (pokestopMode === 'cruiseCasino' && battle && battle.trainer && battle.trainer.isCaptain) ? 'flex' : 'none';

    let heading, intro, continueLabel, continueFn;
    if(pokestopMode === 'preGym'){
      heading = 'GEAR UP FOR THE GYM';
      intro = `You beat <b>${battle.trainer.name}</b>. Stock up, then pick a Gym Leader to challenge. Gold: <span class="gold-text">${META.gold}G</span> · Badges: ${runBadges}/${BADGES_TO_UNLOCK_ENDGAME}`;
      continueLabel = 'CHOOSE A GYM LEADER';
      continueFn = () => {
        closePokeStopScreen();
        if(runBadges === 0 && !firstGymBonusEncounterUsed){
          // One-time bonus wild encounter right before the player's first
          // ever Gym Leader pick this run.
          firstGymBonusEncounterUsed = true;
          postEncounterAction = () => openGymSelect();
          startEncounter();
        } else {
          openGymSelect();
        }
      };
    } else if(pokestopMode === 'mythical'){
      // Reached mid-Cruise now (see the 'cruiseCasino' branch below) — the
      // ship stopped at a remote island for a few hours, right between the
      // 2nd and 3rd ship battles. Continuing always resumes the cruise
      // (cruiseStageIndex still points at the Captain fight).
      heading = 'THE ISLAND STIRRED...';
      intro = mythicalHandled === 'caught'
        ? `You defeated it! It's waiting in Storage, use the Computer to add it to your active team. Gold: <span class="gold-text">${META.gold}G</span>`
        : `It got away. That was your only shot at it this run. Gold: <span class="gold-text">${META.gold}G</span>`;
      continueLabel = 'RETURN TO THE SHIP';
      continueFn = () => { closePokeStopScreen(); startCruiseBattle(); };
    } else if(pokestopMode === 'legendary'){
      heading = 'A LEGENDARY STIRRED...';
      const resupplyNote = ` The road ahead is brutal, so the PokeStop is stocking up: ${ENDGAME_RESUPPLY_POTIONS} more Potions and ${ENDGAME_RESUPPLY_REVIVES} more Revives are now available to buy.`;
      intro = (legendaryHandled === 'caught'
        ? `You defeated it! It's waiting in Storage, use the Computer to add it to your active team. Gold: <span class="gold-text">${META.gold}G</span> · Badges: ${runBadges}`
        : `It got away. That was your only shot at it this run. Gold: <span class="gold-text">${META.gold}G</span> · Badges: ${runBadges}`) + resupplyNote;
      // The Cruise Ship is now a mandatory endgame event — no ticket to buy,
      // it's handed to the player automatically right here.
      continueLabel = 'CONTINUE';
      continueFn = () => { closePokeStopScreen(); openCruiseTicketWonScreen(); };
    } else if(pokestopMode === 'cruiseCasino'){
      // Right after the 2nd ship battle (First Mate's Double Battle) and
      // before the 3rd (the Captain), the ship makes an unplanned stop at a
      // remote island for a few hours — that's where the Mythical encounter
      // lives now, once per run, guaranteed (the Cruise Ship is mandatory).
      const islandStop = cruiseStageIndex === 2 && !mythicalHandled;
      const nextIsCaptain = cruiseStageIndex < CRUISE_SHIP_BATTLES.length && CRUISE_SHIP_BATTLES[cruiseStageIndex].isCaptain;
      const nextIsBattle = cruiseStageIndex < CRUISE_SHIP_BATTLES.length;
      heading = '🚢 CRUISE CASINO';
      intro = `You beat <b>${battle.trainer.name}</b>! Stock up, try your luck, or press on. Gold: <span class="gold-text">${META.gold}G</span>`;
      if(islandStop){
        intro += ` The ship's dropping anchor for a few hours near a remote island up ahead...`;
        continueLabel = '🏝️ EXPLORE THE ISLAND';
        continueFn = () => { closePokeStopScreen(); startMythicalBattle(); };
      } else {
        continueLabel = !nextIsBattle ? 'FACE YOUR RIVAL' : nextIsCaptain ? 'CHALLENGE THE CAPTAIN' : 'CHALLENGE THE SAILOR';
        continueFn = () => {
          closePokeStopScreen();
          if(cruiseStageIndex < CRUISE_SHIP_BATTLES.length) startCruiseBattle();
          else openRivalChallenge();
        };
      }
    } else if(pokestopMode === 'cruiseComplete'){
      heading = 'RIVAL DEFEATED!';
      intro = `You beat <b>${battle.trainer.name}</b> and it feels great. The ship docks, time to head for the Elite Four. Gold: <span class="gold-text">${META.gold}G</span>`;
      continueLabel = 'FACE THE ELITE FOUR';
      continueFn = () => {
        closePokeStopScreen();
        cruiseStageIndex = null;
        eliteIndex = 0;
        eliteGauntletFlawless = true; // Flawless Victory achievement, tracked across all 4 members
        if(!eliteBonusEncounterUsed){
          eliteBonusEncounterUsed = true;
          startCuratedBonusEncounter(unovaKalosPaldeaStrongestPool(), () => openPokeStop('finalElitePrep'));
        } else {
          startEliteBattle();
        }
      };
    } else if(pokestopMode === 'finalElitePrep'){
      heading = 'ONE LAST STOP...';
      intro = `Final restock before the gauntlet begins. Gold: <span class="gold-text">${META.gold}G</span>`;
      continueLabel = `CHALLENGE ${ELITE_FOUR[0].name.toUpperCase()}`;
      continueFn = () => { closePokeStopScreen(); startEliteBattle(); };
    } else if(pokestopMode === 'preElite'){
      heading = `ELITE FOUR · ${eliteIndex + 1}/${ELITE_FOUR.length}`;
      intro = `You beat <b>${battle.trainer.name}</b>! Full 6-vs-6 battles ahead, stock up. Gold: <span class="gold-text">${META.gold}G</span>`;
      continueLabel = eliteIndex + 1 < ELITE_FOUR.length ? `CHALLENGE ${ELITE_FOUR[eliteIndex].name.toUpperCase()}` : 'FACE THE FINAL ELITE FOUR MEMBER';
      continueFn = () => { closePokeStopScreen(); startEliteBattle(); };
    } else if(runBadges >= BADGES_TO_UNLOCK_ENDGAME && !legendaryHandled){
      heading = 'THE PATH OPENS...';
      intro = `You beat <b>${battle.trainer.name}</b> and earned your 8th Badge! A Legendary stirs ahead. Gold: <span class="gold-text">${META.gold}G</span> · Badges: ${runBadges}/${BADGES_TO_UNLOCK_ENDGAME}`;
      continueLabel = 'SEEK THE LEGENDARY';
      continueFn = () => {
        closePokeStopScreen();
        if(!legendaryBonusEncounterUsed){
          legendaryBonusEncounterUsed = true;
          startCuratedBonusEncounter(alolaGalarLastStagePool(), () => startLegendaryBattle());
        } else {
          startLegendaryBattle();
        }
      };
    } else {
      heading = 'RESTOCK & MOVE ON';
      intro = `You beat <b>${battle.trainer.name}</b> and earned a Badge! Gold: <span class="gold-text">${META.gold}G</span> · Badges: ${runBadges}/${BADGES_TO_UNLOCK_ENDGAME}`;
      continueLabel = 'HEAD TO THE NEXT ENCOUNTER';
      continueFn = () => { closePokeStopScreen(); encounterNum++; startEncounter(); };
    }

    document.getElementById('pokestopHeading').textContent = heading;
    document.getElementById('pokestopIntro').innerHTML = intro;
    const continueBtn = document.getElementById('pokestopContinueBtn');
    continueBtn.textContent = continueLabel;
    continueBtn.onclick = continueFn;

    const casinoBtn = document.getElementById('pokestopCasinoBtn');
    if(casinoBtn) casinoBtn.style.display = pokestopCasinoUnlocked() ? 'flex' : 'none';

    const cruiseNav = document.getElementById('cruiseCasinoNav');
    const inCruiseCasino = pokestopMode === 'cruiseCasino';
    cruiseNav.style.display = inCruiseCasino ? 'flex' : 'none';
    if(inCruiseCasino){
      // Each mini-event is a one-shot for the entire run (see cruiseMiniEventUsed
      // — only cleared on a fresh run, not on re-visiting the Cruise Casino).
      const fishingBtn = document.getElementById('cruiseFishingBtn');
      const slotsBtn = document.getElementById('cruiseSlotsBtn');
      fishingBtn.disabled = cruiseMiniEventUsed.fishing;
      // Nuzlocke drops Lucky Spin entirely, Fishing stays (with fewer casts, see openFishing()).
      slotsBtn.style.display = gameMode === 'nuzlocke' ? 'none' : '';
      slotsBtn.disabled = cruiseMiniEventUsed.slots;
      // Same "new thing to check out" notification dot as the Computer
      // button — shown until the player's first click this run, same
      // one-shot flag that already disables the button afterward.
      const fishingDot = document.getElementById('cruiseFishingNotifDot');
      const slotsDot = document.getElementById('cruiseSlotsNotifDot');
      if(fishingDot) fishingDot.classList.toggle('active', !cruiseMiniEventUsed.fishing);
      if(slotsDot) slotsDot.classList.toggle('active', !cruiseMiniEventUsed.slots);
      fishingBtn.onclick = () => {
        cruiseMiniEventUsed.fishing = true;
        closePokeStopScreen();
        openFishing(() => openPokeStop('cruiseCasino'));
      };
      slotsBtn.onclick = () => {
        cruiseMiniEventUsed.slots = true;
        closePokeStopScreen();
        openLuckySpin(() => openPokeStop('cruiseCasino'));
      };
    }

    renderInvGrid('pokestopInventory');
    renderPokestopShopTabs();
    renderPokestopShopGrid();
    checkpoint('pokestop');
  }

  // ---------- POKESTOP SHOP TABS (Pokéballs / Itens / Others) ----------
  let pokestopShopTab = 'balls';

  function renderPokestopShopTabs(){
    const el = document.getElementById('pokestopShopTabs');
    if(!el) return;
    el.innerHTML = SHOP_TABS.map(t => `<button class="shop-tab ${t.key === pokestopShopTab ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('');
    el.querySelectorAll('.shop-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        pokestopShopTab = btn.dataset.tab;
        renderPokestopShopTabs();
        renderPokestopShopGrid();
      });
    });
  }

  // An item's lifetimeMax plus any per-run bonus granted so far (see
  // ENDGAME_RESUPPLY_POTIONS/REVIVES) — undefined if the item has no lifetime cap.
  function effectiveLifetimeMax(item){
    if(!item.lifetimeMax) return undefined;
    return item.lifetimeMax + (shopLifetimeBonus[item.invKey] || 0);
  }

  function renderPokestopShopGrid(){
    const grid = document.getElementById('pokestopShopGrid');
    // Reroll Tickets reshuffle the wild-encounter list, useless in Pro/Nuzlocke
    // since that list is hidden behind mystery cards until picked, so there's
    // nothing to judge before spending gold on a reroll. Not sold there.
    // Revives aren't sold in Nuzlocke either, permadeath means a fainted
    // Pokémon is gone for good, so there's nothing left to revive.
    const items = Object.values(POKESTOP_SHOP_ITEMS).filter(item =>
      item.category === pokestopShopTab &&
      !(item.invKey === 'rerollTickets' && isBlindMode()) &&
      !(item.invKey === 'revives' && gameMode === 'nuzlocke')
    );
    grid.innerHTML = items.map(item => {
      const cost = shopPrice(item);
      const lifetimeBought = shopBoughtCounts[item.invKey] || 0;
      const lifetimeMax = effectiveLifetimeMax(item);
      const maxed = (item.max && inv[item.invKey] >= item.max) || (lifetimeMax !== undefined && lifetimeBought >= lifetimeMax);
      const locked = item.lockAfterBadges && runBadges >= item.lockAfterBadges;
      const subLabel = locked ? 'No longer available this run'
        : item.instant ? 'Special Sanctuary'
        : lifetimeMax !== undefined ? `Qty: ${inv[item.invKey]} · Bought ${lifetimeBought}/${lifetimeMax}`
        : `Qty: ${inv[item.invKey]}${item.max ? `/${item.max}` : ''}`;
      const disabled = maxed || locked || META.gold < cost;
      const label = maxed ? 'SOLD OUT' : locked ? 'CLOSED' : `BUY · ${cost}G`;
      return `<div class="shop-row">
        <div class="shop-left">
          ${itemIconHTML(item.invKey)}
          <div class="shop-info">
            <div class="shop-name">${item.label}</div>
            <div class="shop-desc">${item.desc || ''}</div>
            <div class="shop-level">${subLabel}</div>
          </div>
        </div>
        <button class="btn-ghost shop-buy" data-key="${item.invKey}" ${disabled ? 'disabled' : ''}>${label}</button>
      </div>`;
    }).join('');

    grid.querySelectorAll('.shop-buy').forEach(btn => {
      btn.addEventListener('click', () => buyPokeStopItem(btn.dataset.key));
    });
  }

  function buyPokeStopItem(invKey){
    const item = Object.values(POKESTOP_SHOP_ITEMS).find(i => i.invKey === invKey);
    const cost = shopPrice(item);
    if(META.gold < cost) return;
    if(item.max && inv[invKey] >= item.max) return;
    const lifetimeMax = effectiveLifetimeMax(item);
    if(lifetimeMax !== undefined && (shopBoughtCounts[invKey] || 0) >= lifetimeMax) return;
    if(item.lockAfterBadges && runBadges >= item.lockAfterBadges) return;
    META.gold -= cost;
    saveMeta();
    trackItemBought(invKey);
    if(item.instant){
      if(invKey === 'safariTicket'){
        const returnMode = pokestopMode;
        closePokeStopScreen();
        openSafariZone(() => openPokeStop(returnMode));
      }
      return;
    }
    inv[invKey]++;
    if(item.lifetimeMax) shopBoughtCounts[invKey] = (shopBoughtCounts[invKey] || 0) + 1;
    renderPokeStop();
  }

  // Starts as a flat black silhouette (see .shiny-reveal-avatar .avatar img
  // in CSS) and fades in to the real shiny colors after a short beat — the
  // ".revealed" class flip is what triggers the CSS transition.
  function openShinyRevealModal(mon){
    const avatarWrap = document.getElementById('shinyRevealAvatar');
    avatarWrap.classList.remove('revealed');
    avatarWrap.innerHTML = avatarHTML(mon);
    document.getElementById('shinyRevealText').textContent = `A shiny ${displayName(mon.name)} was waiting for you!`;
    document.getElementById('shinyRevealModal').classList.add('active');
    void avatarWrap.offsetWidth; // force layout so the black silhouette paints first
    setTimeout(() => avatarWrap.classList.add('revealed'), 450);
  }

  function closeShinyRevealModal(){
    document.getElementById('shinyRevealModal').classList.remove('active');
  }

  function openEndRunModal(){
    document.getElementById('endRunModal').classList.add('active');
  }

  function closeEndRunModal(){
    document.getElementById('endRunModal').classList.remove('active');
  }

  // Offered once at startup when there's no local save on this device but a
  // cloud checkpoint exists (see run_saves.js) — same restoreRun() path as
  // the local resume, since the saved shape is identical (serializeRun()).
  function openResumeCheckpointModal(cloudState){
    document.getElementById('resumeCheckpointModal').classList.add('active');
    document.getElementById('resumeCheckpointBtn').onclick = () => {
      document.getElementById('resumeCheckpointModal').classList.remove('active');
      restoreRun(cloudState);
    };
    document.getElementById('resumeCheckpointDismissBtn').onclick = () => {
      document.getElementById('resumeCheckpointModal').classList.remove('active');
      renderBest();
    };
  }

  // The "END RUN" button is reachable from any in-run screen (not just the
  // PokeStop), so hide every possible screen rather than just the PokeStop's.
  const RUN_SCREEN_IDS = [
    'encounterScreen', 'catchScreen', 'gymSelectScreen', 'rivalChallengeScreen',
    'leadSelectScreen', 'battleScreen', 'luckySpinScreen', 'tokenCasinoScreen', 'fishingScreen', 'safariScreen',
    'pokestopScreen', 'teamScreen', 'starterScreen', 'itemFindScreen',
    'legendaryIntroScreen', 'championScreen', 'cruiseTicketWonScreen', 'tradeOfferScreen',
  ];
  function hideAllRunScreens(){
    RUN_SCREEN_IDS.forEach(id => {
      const el = document.getElementById(id);
      if(el) el.classList.remove('active');
    });
  }

  function confirmEndRun(){
    closeEndRunModal();
    hideAllRunScreens();
    finishEncounter();
  }

  // Full inventory listing shared by the Computer (Bag) view and the PokeStop.
  function fullInventoryEntries(){
    const entries = [['Pokéballs', inv.balls, 'balls'], ['Great Balls', inv.greatBalls, 'greatBalls'], ['Ultra Balls', inv.ultraBalls, 'ultraBalls']];
    if(inv.masterBalls > 0) entries.push(['Master Balls', inv.masterBalls, 'masterBalls']);
    entries.push(
      ['Berry Snack', inv.berrySnack, 'berrySnack'], ['Poke Treat', inv.pokeTreat, 'pokeTreat'],
      ['Potions', inv.potions, 'potions'], ['Revives', inv.revives, 'revives'],
      ['Reroll Tickets', inv.rerollTickets, 'rerollTickets'],
    );
    if(inv.megaStone > 0) entries.push(['Mega Stones', inv.megaStone, 'megaStone']);
    return entries;
  }

  function renderInvGrid(elId){
    const el = document.getElementById(elId);
    if(!el) return;
    el.innerHTML = fullInventoryEntries().map(([label,count,key]) =>
      `<div class="inv-chip">
        <span class="inv-count">${count}</span>
        <span class="inv-label-row">${itemIconHTML(key)}<span class="inv-label">${label}</span></span>
      </div>`).join('');
  }

  // ---------- TEAM MANAGEMENT (active roster <-> Storage) ----------
  // Lives behind the PokeStop's "Computer" button — the classic PC box screen.
  function openTeamManagement(){
    closePokeStopScreen();
    document.getElementById('teamScreen').classList.add('active');
    renderTeamManagement();
    clearComputerNotification();
  }

  function closeTeamManagement(){
    document.getElementById('teamScreen').classList.remove('active');
    openPokeStop(pokestopMode);
  }

  // `kind` is 'active' or 'storage' — only the active team gets reorder
  // arrows (order there is also the order Pokémon are sent out battle to
  // battle); both kinds open the Pokédex popup on click (see openPokedex()).
  function teamRowHTML(mon, action, idx, disabled, kind){
    const isNew = newArrivalNames.includes(mon.name);
    const isActive = kind === 'active';
    const reorderHTML = isActive ? `
      <div class="reorder-btns">
        <button class="reorder-btn" data-reorder-idx="${idx}" data-dir="up" ${idx === 0 ? 'disabled' : ''} aria-label="Move up">▲</button>
        <button class="reorder-btn" data-reorder-idx="${idx}" data-dir="down" ${idx === activeTeam.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button>
      </div>` : '';
    return `<div class="team-mgmt-row ${isNew ? 'new-arrival' : ''}">
      <button class="team-mgmt-mon-info" data-poke-idx="${idx}" data-poke-kind="${kind}">
        ${avatarHTML(mon,'avatar-sm')}
        <div class="team-mgmt-info">
          <span class="tn">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">✨</span>' : ''}${isNew ? ' <span class="new-tag">NEW</span>' : ''}</span>
          <span class="tt" style="color:${TYPE_COLOR[mon.types[0]]}">${mon.types.join(' / ')}</span>
        </div>
      </button>
      ${reorderHTML}
      <button class="btn-ghost team-mgmt-btn" data-action="${action}" data-idx="${idx}" ${disabled ? 'disabled' : ''}>${action === 'deposit' ? 'DEPOSIT' : 'WITHDRAW'}</button>
    </div>`;
  }

  // Swaps two adjacent active-team members — same net effect the old
  // drag-and-drop reorder had, just via a tap instead of a hold-and-drag
  // gesture (which was unreliable on touch devices).
  function moveActiveMon(idx, dir){
    const swapWith = idx + (dir === 'up' ? -1 : 1);
    if(swapWith < 0 || swapWith >= activeTeam.length) return;
    [activeTeam[idx], activeTeam[swapWith]] = [activeTeam[swapWith], activeTeam[idx]];
    renderTeamManagement();
  }

  function renderTeamManagement(){
    document.getElementById('teamActiveCount').textContent = `${activeTeam.length}/${MAX_PARTY_SIZE}`;

    const activeEl = document.getElementById('teamActiveList');
    activeEl.innerHTML = activeTeam.map((mon,i) => teamRowHTML(mon, 'deposit', i, activeTeam.length <= 1, 'active')).join('');

    renderMegaEvolveSection();

    const storageEl = document.getElementById('teamStorageList');
    storageEl.innerHTML = storage_.length
      ? storage_.map((mon,i) => teamRowHTML(mon, 'withdraw', i, activeTeam.length >= MAX_PARTY_SIZE, 'storage')).join('')
      : '<div class="empty-note">Storage is empty.</div>';

    document.querySelectorAll('.team-mgmt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        if(btn.dataset.action === 'deposit') depositToStorage(idx); else withdrawFromStorage(idx);
      });
    });

    document.querySelectorAll('.reorder-btn').forEach(btn => {
      btn.addEventListener('click', () => moveActiveMon(Number(btn.dataset.reorderIdx), btn.dataset.dir));
    });

    document.querySelectorAll('.team-mgmt-mon-info').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.pokeIdx);
        openPokedex(btn.dataset.pokeKind === 'active' ? activeTeam[idx] : storage_[idx]);
      });
    });
    checkpoint('team');
  }

  // Only shown when the player actually has a Mega Stone and at least one
  // active-team member is Mega-capable — otherwise there's nothing to do here.
  function renderMegaEvolveSection(){
    const section = document.getElementById('megaEvolveSection');
    const idxs = megaEligibleIdx();
    document.getElementById('megaEvolveNote').style.display = 'none';
    if(inv.megaStone <= 0 || !idxs.length){
      section.style.display = 'none';
      return;
    }
    section.style.display = 'block';
    document.getElementById('megaStoneCount').textContent = inv.megaStone;
    const list = document.getElementById('megaEvolveList');
    list.innerHTML = idxs.map(idx => {
      const mon = activeTeam[idx];
      return `<div class="team-mgmt-row">
        ${avatarHTML(mon,'avatar-sm')}
        <div class="team-mgmt-info">
          <span class="tn">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">✨</span>' : ''}</span>
          <span class="tt" style="color:${TYPE_COLOR[mon.types[0]]}">${mon.types.join(' / ')}</span>
        </div>
        <button class="btn-ghost team-mgmt-btn" data-mega-idx="${idx}">MEGA EVOLVE</button>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-mega-idx]').forEach(btn => {
      btn.addEventListener('click', () => useMegaStone(Number(btn.dataset.megaIdx)));
    });
  }

  function useMegaStone(idx){
    if(inv.megaStone <= 0) return;
    const forms = MEGA_FORMS_BY_BASE[activeTeam[idx].name] || [];
    // More than one named Mega form (X/Y, or regular vs. Mega Z) is always a
    // deliberate player choice, never a random roll — see openMegaFormChoice().
    if(forms.length > 1){
      openMegaFormChoice(idx, forms);
      return;
    }
    applyMegaEvolution(idx, forms[0]);
  }

  function applyMegaEvolution(idx, formName){
    const result = performMegaEvolution(idx, formName);
    if(!result) return;
    inv.megaStone--;
    trackItemUsed('megaStone');
    recordEvolution(result);
    renderTeamManagement();
    const note = document.getElementById('megaEvolveNote');
    note.textContent = `${displayName(result.from.name)} Mega Evolved into ${displayName(result.to.name)}!`;
    note.style.display = 'block';
  }

  // ---------- MEGA EVOLUTION FORM CHOICE (X/Y, regular vs. Mega Z) ----------
  // Only reached when a base species has more than one named Mega form.
  // Branching *normal* evolutions (Eevee, Wurmple, etc.) never show this —
  // those are always resolved by an equal-weight random roll instead, see
  // evolveRandomEligible().
  let megaFormChoiceIdx = null;

  function openMegaFormChoice(idx, forms){
    megaFormChoiceIdx = idx;
    const mon = activeTeam[idx];
    document.getElementById('megaFormChoiceText').textContent =
      `${displayName(mon.name)} can Mega Evolve in more than one way. Choose a form:`;
    const grid = document.getElementById('megaFormChoiceGrid');
    grid.innerHTML = forms.map(formName => {
      const formMon = POKEMON_BY_NAME[formName];
      return `<button class="mega-form-choice-card" data-form="${formName}">
        ${avatarHTML(formMon, 'avatar-sm')}
        <span class="c-name">${displayName(formName)}</span>
      </button>`;
    }).join('');
    grid.querySelectorAll('.mega-form-choice-card').forEach(btn => {
      btn.addEventListener('click', () => {
        const chosenIdx = megaFormChoiceIdx;
        const chosenForm = btn.dataset.form;
        closeMegaFormChoice();
        applyMegaEvolution(chosenIdx, chosenForm);
      });
    });
    document.getElementById('megaFormChoiceModal').classList.add('active');
  }

  function closeMegaFormChoice(){
    document.getElementById('megaFormChoiceModal').classList.remove('active');
    megaFormChoiceIdx = null;
  }

  function depositToStorage(idx){
    if(activeTeam.length <= 1) return; // must always keep at least 1 active Pokémon
    const [mon] = activeTeam.splice(idx, 1);
    storage_.push(mon);
    renderTeamManagement();
  }

  function withdrawFromStorage(idx){
    if(activeTeam.length >= MAX_PARTY_SIZE) return; // must deposit first
    const [mon] = storage_.splice(idx, 1);
    activeTeam.push(mon);
    renderTeamManagement();
  }

  // ---------- RESULT ----------
  // ---------- HIDDEN ACHIEVEMENTS (checked once, at run end) ----------
  // Each entry is a self-contained { name, test(run) } pair. `test` reads
  // only fields already present on the `run` object built in
  // finishEncounter() (which mirrors/extends the module-level counters in
  // the "HIDDEN ACHIEVEMENT TRACKING" block above), so this whole table can
  // be reasoned about, and extended, without touching any other system.
  // Titles only, no descriptions, by design (see checkAchievements()).
  const ACHIEVEMENT_SAFARI_CATCH_MIN = 3;
  const ACHIEVEMENT_FISHING_CATCH_MIN = 3;
  const ACHIEVEMENT_EVOLUTION_CHAIN_MIN = 7; // "more than 7", strictly greater
  const ACHIEVEMENT_STATUS_SPECIALIST_MIN = 10;
  const ACHIEVEMENT_HIGH_ROLLER_GOLD_SPENT_MIN = 300;
  const ACHIEVEMENT_GOLD_DIGGER_MIN = 1000;

  const ACHIEVEMENT_DEFS = [
    {
      name: 'Iron Will',
      test: run => !run.itemsUsed.potions && !run.itemsUsed.revives,
    },
    {
      // Simplest workable rule: every mon on the final team shares a primary
      // type. Requires at least 2 Pokémon so a 1-mon team can't trivially
      // qualify.
      name: 'Pure Bloodline',
      test: run => run.activeRoster.length >= 2 &&
        run.activeRoster.every(m => m.types[0] === run.activeRoster[0].types[0]),
    },
    { name: 'Safari Sharpshooter', test: run => run.safariCatchCount >= ACHIEVEMENT_SAFARI_CATCH_MIN },
    { name: 'Lucky Shine', test: run => run.caught.some(m => m.is_shiny) },
    { name: 'Reel Deal', test: run => run.fishingCatchCount >= ACHIEVEMENT_FISHING_CATCH_MIN },
    { name: 'Evolution Chain', test: run => run.evolvedCount > ACHIEVEMENT_EVOLUTION_CHAIN_MIN },
    { name: 'Status Effect Specialist', test: run => run.playerStatusEffectsApplied >= ACHIEVEMENT_STATUS_SPECIALIST_MIN },
    // Only meaningful once the gauntlet is actually cleared (run.champion),
    // eliteGauntletFlawless otherwise just sits at its initial `true` for a
    // run that never reached the Elite Four at all.
    { name: 'Flawless Victory', test: run => run.champion && run.eliteGauntletFlawless },
    { name: 'Comeback Kid', test: run => run.comebackKidAchieved },
    { name: 'Treasure Hunter', test: run => run.tokenExchangeBought },
    { name: 'High Roller', test: run => run.goldSpentOnSlots >= ACHIEVEMENT_HIGH_ROLLER_GOLD_SPENT_MIN },
    { name: 'Gold Digger', test: run => run.metaGoldTotal >= ACHIEVEMENT_GOLD_DIGGER_MIN },
    {
      name: 'Underdog',
      test: run => run.champion && run.activeRoster.length > 0 &&
        run.activeRoster.every(m => hasNoEvolutionaryRelations(m.name)),
    },
  ];

  // Single choke point for achievement evaluation, called once, when the
  // run ends (win or loss), and returns just the unlocked titles for that
  // run. Nothing is persisted across runs.
  function checkAchievements(run){
    return ACHIEVEMENT_DEFS.filter(a => a.test(run)).map(a => a.name);
  }

  // Shared by the result screen and the shareable image card so the two
  // never drift out of sync.
  function computeTierMeta(run){
    if(run.champion){
      return { label:"POKÉMON CHAMPION", flavor:`The Legendary faced and all 4 Elite Four members defeated. You are the Champion!`, foil:"foil-perfect" };
    } else if(run.trainerLoss){
      return { label:"DEFEATED", flavor:`Lost to ${run.trainerLoss}. The run ends here.`, foil:"foil-defeat" };
    } else if(run.badges >= 3){
      return { label:"EXPEDITION LEGEND", flavor:`${run.badges} badges and ${run.trainersBeaten} trainers beaten before calling it.`, foil:"foil-perfect" };
    } else if(run.badges >= 1){
      return { label:"SOLID RUN", flavor:`${run.badges} badge${run.badges===1?'':'s'} earned, ${run.trainersBeaten} trainer${run.trainersBeaten===1?'':'s'} beaten along the way.`, foil:"foil-solid" };
    }
    return { label:"JUST GETTING STARTED", flavor:"Called it before the first Gym Leader.", foil:"foil-modest" };
  }

  async function renderResult(run){
    // The run is over the moment this screen shows (win, loss, or manual end)
    // — nothing left to resume, so drop the in-progress save. Clears both
    // the local save and the cloud checkpoint (see run_saves.js) here,
    // unconditionally, rather than only inside the "save highscore" flow —
    // that way an abandoned/closed tab on the result screen still can't be
    // "continued" later even if the player never clicks Save.
    clearRunState();
    if(typeof clearCheckpoint === 'function') clearCheckpoint();
    checkpointScreen = null;
    hasComputerNotification = false;
    newArrivalNames = [];
    renderAbandonButton(null);
    // Fire-and-forget: never awaited, never allowed to delay or break this
    // screen if Supabase is unreachable — see recordAnalytics().
    recordAnalytics(run, run.champion ? 'champion' : run.trainerLoss ? 'lost' : 'abandoned');
    const score = computeScore(run);
    const gotCatch = run.caught.length > 0;
    const battlesWon = run.trainersBeaten + run.badges;

    const tierMeta = computeTierMeta(run);

    const statTiles = [
      ['Badges', run.badges], ['Battles Won', battlesWon],
      ['Caught', run.caught.length], ['Money Earned', `${run.goldEarned}G`, true],
    ].map(([label,count,isGold]) => `<div class="inv-chip"><span class="inv-count ${isGold ? 'gold-text' : ''}">${count}</span><span class="inv-label">${label}</span></div>`).join('');

    const spotlightHTML = (run.activeRoster || []).map(mon => `
      <div class="spotlight-slot">
        ${avatarHTML(mon,'avatar-sm')}
        <span class="tn">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">✨</span>' : ''}</span>
      </div>`).join('');

    // Titles only, no descriptions, see checkAchievements(). Hidden entirely
    // when nothing unlocked this run, rather than showing an empty section.
    const achievements = run.achievements || [];
    const achievementsHTML = achievements.length ? `
      <div class="achievements-strip">
        <div class="team-spotlight-title">ACHIEVEMENTS UNLOCKED</div>
        <div class="achievements-grid">
          ${achievements.map(name => `<span class="achv-chip">${name.toUpperCase()}</span>`).join('')}
        </div>
      </div>` : '';

    const el = document.getElementById('resultScreen');
    el.classList.add('active');
    el.innerHTML = `
      <div class="card ${tierMeta.foil}">
        <div class="card-inner">
          <div class="new-best-tag" id="newBestTag" style="display:none;">NEW HIGH SCORE</div>
          <div class="ovr-num">${score}</div>
          <div class="ovr-label">SCORE</div>
          <div class="tier-name" style="color:${tierMeta.foil==='foil-perfect'?'var(--lime)':'var(--text)'}">${tierMeta.label}</div>
          <div class="tier-flavor">${tierMeta.flavor}</div>

          <div class="evolution-reveal" id="resultEvolutionReveal" style="display:none;">
            <div class="evolution-label">✨ EVOLUTION ✨</div>
            <div class="evolution-stage">
              <div class="evo-mon evo-from"></div>
              <div class="evolution-arrow">→</div>
              <div class="evo-mon evo-to"></div>
            </div>
            <div class="evolution-text"></div>
          </div>

          <div class="team-spotlight">
            <div class="team-spotlight-title">YOUR TEAM</div>
            <div class="team-spotlight-grid">${spotlightHTML}</div>
          </div>

          <div class="inv-strip" style="margin-top:16px;">${statTiles}</div>
          ${achievementsHTML}

          <div class="team-list">
            <div class="team-row">
              ${avatarHTML(run.starter,'avatar-sm')}
              <span class="tn">${displayName(run.starter.name)}</span>
              <span class="tt">STARTER</span>
            </div>
            ${run.caught.map(mon => `
              <div class="team-row">
                ${avatarHTML(mon,'avatar-sm')}
                <span class="tn">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">✨</span>' : ''}</span>
                <span class="tt" style="color:${TYPE_COLOR[mon.types[0]]}">${mon.types.join(' / ')}</span>
              </div>`).join('')}
          </div>
          ${!gotCatch ? '<div class="empty-note">No wild Pokémon joined the team this run.</div>' : ''}

          <div class="divider"></div>
          <div class="credit-line">
            Started with <b>${displayName(run.starter.name)}</b> · <span class="gold-text">${META.gold}G</span> total gold
            ${run.champion ? `<br><span style="color:var(--lime)">Awarded a Master Ball for becoming Champion!${itemIconHTML('masterBalls').replace('item-icon', 'item-icon trophy-icon-inline')}</span>` : ''}
          </div>
        </div>
      </div>

      ${run.champion ? `
      <div class="hof-card">
        <div class="hof-card-title">🏆 HALL OF FAME</div>
        <p class="hof-card-desc">Download a card of your championship run, team and achievements included.</p>
        <button class="btn-primary" id="downloadHofBtn">DOWNLOAD CARD</button>
        <div class="hof-status" id="hofStatus"></div>
      </div>` : ''}

      <div class="highscore-entry">
        <label for="playerNameInput" class="highscore-label">Write your name to save this run as a Highscore</label>
        <input type="text" id="playerNameInput" class="name-input" placeholder="Your name" maxlength="20" autocomplete="off">
        <div class="highscore-error" id="highscoreError" style="display:none; color:#ff6b6b; font-size:11px; margin-top:4px;"></div>
        <button class="btn-primary" id="saveHighscoreBtn">SAVE HIGHSCORE</button>
      </div>
      <div class="actions">
        <button class="btn-ghost" id="shareRunBtn">📸 SHARE</button>
        <button class="btn-ghost" id="againBtn">RUN IT BACK</button>
      </div>
      <div class="share-status" id="shareStatus"></div>
    `;

    renderEvolutionReveal('resultEvolutionReveal', pendingEvolution);
    pendingEvolution = null;

    // Strips emoji/symbols out of the name as the player types (without
    // trimming, so an interior space isn't eaten mid-keystroke) — final
    // trim + profanity check happens only at submit time, in saveHighscore().
    const nameInputEl = document.getElementById('playerNameInput');
    nameInputEl.addEventListener('input', () => {
      const stripped = stripDisallowedNameChars(nameInputEl.value);
      if(stripped !== nameInputEl.value) nameInputEl.value = stripped;
    });

    let saved = false;
    // Only ever records a Highscore if the player typed a name that passes
    // the profanity check — leaving the field blank (or entering something
    // blocked) means the run is simply never sent to the leaderboard, rather
    // than silently saving under a generic "Player" name.
    async function saveHighscore(){
      if(saved) return;
      const nameInput = document.getElementById('playerNameInput');
      const errorEl = document.getElementById('highscoreError');
      const name = sanitizeHighscoreName(nameInput.value);
      if(!name){
        if(errorEl){ errorEl.textContent = 'Enter a name to save this run as a Highscore.'; errorEl.style.display = 'block'; }
        return;
      }
      if(containsProfanity(name)){
        if(errorEl){ errorEl.textContent = "That name isn't allowed, please pick a different one."; errorEl.style.display = 'block'; }
        return;
      }
      saved = true;
      if(errorEl) errorEl.style.display = 'none';
      const { isNewBest } = await recordRun(run, name);
      nameInput.disabled = true;
      const saveBtn = document.getElementById('saveHighscoreBtn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'SAVED';
      if(isNewBest) document.getElementById('newBestTag').style.display = 'inline-block';
      renderBest();
    }
    document.getElementById('saveHighscoreBtn').addEventListener('click', saveHighscore);
    document.getElementById('againBtn').addEventListener('click', async () => {
      await saveHighscore(); // no-op if no valid name was ever entered — the run just isn't recorded
      el.classList.remove('active'); el.innerHTML = '';
      document.getElementById('startScreen').style.display = 'block';
      renderGoldBadge();
    });

    document.getElementById('shareRunBtn').addEventListener('click', () => shareRun(run, score));

    const hofBtn = document.getElementById('downloadHofBtn');
    if(hofBtn) hofBtn.addEventListener('click', () => downloadHallOfFame(run, score));

    renderBest();
  }

  // ---------- SHARE ----------
  function currentPlayerName(){
    const nameInput = document.getElementById('playerNameInput');
    const typed = nameInput ? sanitizeHighscoreName(nameInput.value) : '';
    return (typed && !containsProfanity(typed)) ? typed : 'Player';
  }

  function loadImageSafe(src){
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  // Greedy word-wrap for canvas text — ctx.font must already be set to the
  // size/weight the returned lines should be measured (and later drawn) at.
  function wrapCanvasText(ctx, text, maxWidth){
    const words = text.split(' ');
    const lines = [];
    let line = '';
    words.forEach(word => {
      const test = line ? `${line} ${word}` : word;
      if(ctx.measureText(test).width > maxWidth && line){
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    });
    if(line) lines.push(line);
    return lines;
  }

  // ---------- RESULT CARD (1080x1920 image, every run) ----------
  // Portrait 9:16 so it drops straight into Instagram Stories / WhatsApp
  // status without cropping. Built purely from in-game colors/assets — no
  // extra artwork needed (reuses the roster avatars + the Master Ball icon
  // for Champion runs). Shared by both the SHARE button (green/lime theme)
  // and the downloadable card (golden/shiny theme, see downloadHallOfFame) —
  // same layout throughout, only the accent palette and header text differ.
  async function buildResultCardCanvas(run, score, { golden = false } = {}){
    const W = 1080, H = 1920;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const tierMeta = computeTierMeta(run);
    const accent = golden ? '#ffd447' : '#c4f42a';
    const accentGlow = golden ? 'rgba(255,212,71,0.18)' : 'rgba(196,244,42,0.16)';

    // Background: same dark base as the app, plus two soft brand-color glows
    // (mirrors .start-visual's orb gradient) instead of a flat color.
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#12150f');
    bgGrad.addColorStop(1, '#0a0c0a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    const glow1 = ctx.createRadialGradient(W * 0.18, H * 0.12, 0, W * 0.18, H * 0.12, 640);
    glow1.addColorStop(0, accentGlow);
    glow1.addColorStop(1, 'rgba(196,244,42,0)');
    ctx.fillStyle = glow1;
    ctx.fillRect(0, 0, W, H);

    const glow2 = ctx.createRadialGradient(W * 0.85, H * 0.78, 0, W * 0.85, H * 0.78, 700);
    glow2.addColorStop(0, golden ? 'rgba(255,212,71,0.14)' : 'rgba(255,107,74,0.14)');
    glow2.addColorStop(1, 'rgba(255,107,74,0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 8;
    ctx.strokeRect(20, 20, W - 40, H - 40);

    ctx.textAlign = 'center';

    // ---- Header ----
    ctx.fillStyle = accent;
    ctx.font = 'bold 46px sans-serif';
    ctx.fillText('DONDOKOMON', W / 2, 130);
    ctx.fillStyle = '#8b9385';
    ctx.font = '30px sans-serif';
    ctx.fillText(golden ? '🏆 HALL OF FAME' : 'RUN COMPLETE', W / 2, 172);

    // ---- Score ----
    ctx.fillStyle = accent;
    ctx.font = 'bold 220px sans-serif';
    ctx.fillText(`${score}`, W / 2, 460);
    ctx.fillStyle = '#8b9385';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('FINAL SCORE', W / 2, 510);

    // ---- Tier label + flavor text (wrapped, capped so it never overflows) ----
    ctx.fillStyle = tierMeta.foil === 'foil-perfect' ? accent : '#eef0e7';
    ctx.font = 'bold 42px sans-serif';
    ctx.fillText(tierMeta.label, W / 2, 600);

    ctx.fillStyle = '#c8cdc0';
    ctx.font = '28px sans-serif';
    const flavorLines = wrapCanvasText(ctx, tierMeta.flavor, W - 160).slice(0, 3);
    let y = 650;
    flavorLines.forEach(line => { ctx.fillText(line, W / 2, y); y += 34; });

    // ---- Champion-only Master Ball badge ----
    if(run.champion){
      const mbImg = await loadImageSafe(`${ITEM_ICON_DIR}/${ITEM_ICONS.masterBalls}`);
      const badgeCY = y + 90;
      ctx.fillStyle = golden ? 'rgba(255,212,71,0.10)' : 'rgba(196,244,42,0.10)';
      ctx.beginPath();
      ctx.arc(W / 2, badgeCY, 80, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      ctx.stroke();
      if(mbImg) ctx.drawImage(mbImg, W / 2 - 56, badgeCY - 56, 112, 112);
      y = badgeCY + 90;
    } else {
      y += 20;
    }

    // ---- Team roster (up to 6, two rows of 3) ----
    const roster = (run.activeRoster && run.activeRoster.length ? run.activeRoster : [run.starter]).slice(0, 6);
    const imgs = await Promise.all(roster.map(mon => loadImageSafe(imagePath(mon))));
    const perRow = 3;
    const slotW = (W - 120) / perRow;
    const avatarR = 88;
    const rosterRowGap = 50; // vertical gap between roster rows (and below the last row), trimmed from 70 to leave room for the achievements section below
    const rosterTop = y + 90;
    roster.forEach((mon, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const rowCount = Math.min(perRow, roster.length - row * perRow);
      const rowW = rowCount * slotW;
      const rowStartX = (W - rowW) / 2;
      const cx = rowStartX + slotW * col + slotW / 2;
      const cy = rosterTop + row * (avatarR * 2 + rosterRowGap);
      ctx.fillStyle = '#12150f';
      ctx.beginPath();
      ctx.arc(cx, cy, avatarR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = mon.is_shiny ? '#ffd447' : '#23281f';
      ctx.lineWidth = 4;
      ctx.stroke();
      if(imgs[i]) ctx.drawImage(imgs[i], cx - avatarR + 10, cy - avatarR + 10, (avatarR - 10) * 2, (avatarR - 10) * 2);
      ctx.fillStyle = '#eef0e7';
      ctx.font = '24px sans-serif';
      ctx.fillText(displayName(mon.name), cx, cy + avatarR + 34);
    });
    const rosterRows = Math.ceil(roster.length / perRow);
    y = rosterTop + (rosterRows - 1) * (avatarR * 2 + rosterRowGap) + avatarR + rosterRowGap;

    // ---- Stat tiles: Badges / Caught / Gold (matches the ranking's trimmed stat set) ----
    const stats = [
      ['BADGES', `${run.badges}`],
      ['CAUGHT', `${run.caught.length}`],
      ['GOLD', `${run.goldEarned}G`],
    ];
    const tileW = (W - 160) / stats.length;
    stats.forEach(([label, value], i) => {
      const cx = 80 + tileW * i + tileW / 2;
      ctx.fillStyle = accent;
      ctx.font = 'bold 48px sans-serif';
      ctx.fillText(value, cx, y + 50);
      ctx.fillStyle = '#8b9385';
      ctx.font = '22px sans-serif';
      ctx.fillText(label, cx, y + 84);
    });
    y += 120;

    // ---- Earned badges row: only the gym badges actually won this run,
    // the un-earned ones are just skipped rather than shown locked/greyed. ----
    const earnedBadges = BADGES.filter(b => (run.beatenBadges || []).includes(b.key));
    if(earnedBadges.length){
      ctx.fillStyle = '#8b9385';
      ctx.font = '22px sans-serif';
      ctx.fillText('BADGES EARNED', W / 2, y);
      y += 40;
      const badgeImgs = await Promise.all(earnedBadges.map(b => loadImageSafe(`${BADGE_ICON_DIR}/${b.icon}`)));
      const bSize = 64, bGap = 20;
      const rowW = earnedBadges.length * bSize + (earnedBadges.length - 1) * bGap;
      const startX = (W - rowW) / 2;
      earnedBadges.forEach((b, i) => {
        const bx = startX + i * (bSize + bGap);
        if(badgeImgs[i]) ctx.drawImage(badgeImgs[i], bx, y, bSize, bSize);
      });
      y += bSize + 25;
    }

    // ---- Hidden achievements (titles only, no descriptions), compact,
    // wrapped and capped to whatever vertical room is left above the footer;
    // skipped entirely if there isn't enough room left to show anything
    // meaningful, so it can never overlap the footer below. ----
    const achievements = run.achievements || [];
    const footerFloorY = H - 165; // leaves clearance above the player-name footer line at H-130
    if(achievements.length && footerFloorY - y >= 60){
      ctx.fillStyle = '#8b9385';
      ctx.font = '22px sans-serif';
      ctx.fillText('ACHIEVEMENTS UNLOCKED', W / 2, y);
      y += 34;
      ctx.fillStyle = accent;
      ctx.font = 'bold 26px sans-serif';
      const maxWidth = W - 160;
      const lineHeight = 32;
      const availableLines = Math.max(1, Math.floor((footerFloorY - y) / lineHeight));
      const names = achievements.map(n => n.toUpperCase());
      let shown = [];
      for(const name of names){
        const candidate = [...shown, name].join('   ·   ');
        if(wrapCanvasText(ctx, candidate, maxWidth).length <= availableLines) shown.push(name);
        else break;
      }
      const remaining = names.length - shown.length;
      let achvText = shown.join('   ·   ');
      if(remaining > 0) achvText += `   +${remaining} MORE`;
      wrapCanvasText(ctx, achvText, maxWidth).slice(0, availableLines).forEach(line => {
        ctx.fillText(line, W / 2, y);
        y += lineHeight;
      });
    }

    // ---- Footer: player name + date/time run ended, then branding ----
    ctx.fillStyle = '#eef0e7';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(`${currentPlayerName()} · Starter: ${displayName(run.starter.name)}`, W / 2, H - 130);
    ctx.fillStyle = '#565f52';
    ctx.font = '24px sans-serif';
    const endedAt = new Date();
    ctx.fillText(`${endedAt.toLocaleDateString()} · ${endedAt.toLocaleTimeString()}`, W / 2, H - 92);
    ctx.fillStyle = '#3a4034';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('DONDOKOMON: CATCH \'EM', W / 2, H - 46);

    return canvas;
  }

  function canvasToBlob(canvas){
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }

  function downloadCanvasPng(canvas, filename){
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  // Shares an actual PNG file via the Web Share API (native share sheet —
  // WhatsApp/Instagram/etc. all accept image files there) when the browser
  // supports sharing files. Falls back to downloading the PNG (so the user
  // can attach it manually) wherever file-sharing isn't available — most
  // desktop browsers, since navigator.canShare({files}) is mobile-only today.
  async function shareRun(run, score){
    const status = document.getElementById('shareStatus');
    const btn = document.getElementById('shareRunBtn');
    if(btn) btn.disabled = true;
    if(status) status.textContent = 'Building your share image...';
    try{
      const canvas = await buildResultCardCanvas(run, score, { golden:false });
      const blob = await canvasToBlob(canvas);
      if(!blob) throw new Error('canvas-to-blob failed');
      const file = new File([blob], `dondokomon-run-${Date.now()}.png`, { type:'image/png' });
      const shareText = run.champion
        ? `${currentPlayerName()} just became Pokémon Champion in Dondokomon with a score of ${score}!`
        : `${currentPlayerName()} scored ${score} in Dondokomon!`;

      if(navigator.canShare && navigator.canShare({ files:[file] })){
        try{
          await navigator.share({ files:[file], title:'Dondokomon run', text: shareText });
          if(status) status.textContent = 'Shared!';
        }catch(e){
          // AbortError just means the user closed the share sheet — not a failure.
          if(e && e.name !== 'AbortError'){
            downloadCanvasPng(canvas, file.name);
            if(status) status.textContent = "Couldn't open the share sheet, image downloaded instead.";
          } else if(status){
            status.textContent = '';
          }
        }
      } else {
        // Desktop / unsupported browser: no native file share, so download
        // the image directly and let the player attach it themselves.
        downloadCanvasPng(canvas, file.name);
        if(status) status.textContent = 'Your browser can\'t share images directly, downloaded instead, ready to attach.';
      }
    }catch(e){
      if(status) status.textContent = 'Could not build the share image.';
      console.error(e);
    }
    if(btn) btn.disabled = false;
  }

  // ---------- HALL OF FAME CARD (downloadable, Champion runs only) ----------
  // Same layout/build as the share card (see buildResultCardCanvas) so the
  // two never look mismatched — this one just renders in the golden/shiny
  // palette to make it feel like the rarer, keepsake version of the card.

  async function downloadHallOfFame(run, score){
    const status = document.getElementById('hofStatus');
    const btn = document.getElementById('downloadHofBtn');
    if(btn) btn.disabled = true;
    if(status) status.textContent = 'Building your card...';
    try{
      const canvas = await buildResultCardCanvas(run, score, { golden:true });
      const link = document.createElement('a');
      link.download = `dondokomon-hall-of-fame-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      if(status) status.textContent = 'Downloaded!';
    }catch(e){
      if(status) status.textContent = 'Could not build the card.';
    }
    if(btn) btn.disabled = false;
  }

  // ---------- INIT ----------
  // ---------- DEV MODE (stage-jump panel, gated behind ?dev=1 + password) ----------
  // Not real security — this is a static site with no backend, so a
  // determined person can read the hash out of this file. It's only meant to
  // keep casual players from stumbling into the dev tools, not to protect
  // anything sensitive.
  const DEV_PASSWORD_HASH = '83cf8b609de60036a8277bd0e96135751bbc07eb234256d4b65b893360651bf2';
  const DEV_UNLOCK_KEY = 'dondokomon:devUnlocked';

  async function sha256Hex(str){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function showDevPanel(){
    const panel = document.getElementById('devPanel');
    if(panel) panel.style.display = 'block';
  }

  async function tryUnlockDevMode(){
    if(sessionStorage.getItem(DEV_UNLOCK_KEY) === '1'){ showDevPanel(); return; }
    const pass = window.prompt('Dev password:');
    if(pass == null) return;
    const hash = await sha256Hex(pass);
    if(hash === DEV_PASSWORD_HASH){
      sessionStorage.setItem(DEV_UNLOCK_KEY, '1');
      showDevPanel();
    } else {
      window.alert('Incorrect password.');
    }
  }

  // Populates a fresh, fully-stocked run (strong 6-mon team, maxed items and
  // gold) so any stage can be jumped into and actually played/tested, without
  // needing to earn that state through a normal run first.
  function devSeedRun(){
    gameMode = 'classic'; // dev jumps always show full info, never the Pro mystery cover
    const pool = POKEMON.filter(p => !p.legendary && p.id <= NATIONAL_DEX_MAX && !PARADOX_POKEMON.includes(p.name));
    const team = pickN(pool, 6);
    starter = team[0];
    activeTeam = team;
    storage_ = [];
    META.gold = 9999;
    saveMeta();
    inv = {
      balls: 99, greatBalls: 99, ultraBalls: 99, masterBalls: 5,
      berrySnack: 10, pokeTreat: 10,
      potions: 10, revives: 10,
      rerollTickets: 5,
      megaStone: 1,
    };
    encounterNum = 1;
    runTrainersBeaten = 0;
    runBadges = 0;
    runChampion = false;
    runGoldEarned = 0;
    trainerLoss = null;
    legendaryHandled = false;
    mythicalHandled = false;
    pendingEvolution = null;
    runBeatenBadges = new Set();
    eliteIndex = 0;
    eliteUsedNames = new Set();
    seenWildNames = new Set();
    casinoTokens = 500;
    firstGymBonusEncounterUsed = true;
    legendaryBonusEncounterUsed = true;
    eliteBonusEncounterUsed = true;
    cruiseStageIndex = null;
    cruiseMiniEventUsed = { fishing:false, slots:false };
    shopBoughtCounts = {};
    shopLifetimeBonus = {};
    itemsBought = {};
    itemsUsed = {};
    runStartedAt = Date.now();
    hasComputerNotification = false;
    newArrivalNames = [];
    safariCatchCount = 0;
    fishingCatchCount = 0;
    evolvedSpeciesThisRun = new Set();
    playerStatusEffectsApplied = 0;
    eliteGauntletFlawless = true;
    comebackKidAchieved = false;
    tokenExchangeBought = false;
    goldSpentOnSlots = 0;
  }

  // Seeds a fresh run then jumps straight into the requested stage —
  // reuses the same screen-transition functions the normal game flow calls,
  // so nothing about the target screen's own logic needs duplicating here.
  function devJump(kind){
    hideAllRunScreens();
    document.getElementById('startScreen').style.display = 'none';
    devSeedRun();
    // Battle-only jumps (legendary/cruise/mythical/rival/elite/champion)
    // never pass through checkpoint(), so default to hidden, same as any
    // other non-PokeStop screen, and let checkpoint() turn it on for the
    // jumps that do land on a checkpointed screen (encounter/gymSelect/pokestop).
    renderAbandonButton(null);

    if(kind === 'encounter'){
      startEncounter();
    } else if(kind === 'gymSelect'){
      pokestopMode = 'preGym';
      battle = { trainer: { name: 'Dev Trainer' } };
      openGymSelect();
    } else if(kind === 'legendary'){
      runBadges = BADGES_TO_UNLOCK_ENDGAME;
      startLegendaryBattle();
    } else if(kind === 'cruise'){
      runBadges = BADGES_TO_UNLOCK_ENDGAME;
      legendaryHandled = 'caught';
      cruiseStageIndex = 0;
      startCruiseBattle();
    } else if(kind === 'mythical'){
      runBadges = BADGES_TO_UNLOCK_ENDGAME;
      legendaryHandled = 'caught';
      cruiseStageIndex = 2;
      startMythicalBattle();
    } else if(kind === 'rival'){
      runBadges = BADGES_TO_UNLOCK_ENDGAME;
      legendaryHandled = 'caught'; mythicalHandled = 'caught';
      cruiseStageIndex = CRUISE_SHIP_BATTLES.length;
      openRivalChallenge();
    } else if(kind === 'elite'){
      runBadges = BADGES_TO_UNLOCK_ENDGAME;
      legendaryHandled = 'caught'; mythicalHandled = 'caught';
      eliteIndex = 0;
      startEliteBattle();
    } else if(kind === 'champion'){
      runBadges = BADGES_TO_UNLOCK_ENDGAME;
      legendaryHandled = 'caught'; mythicalHandled = 'caught';
      eliteIndex = ELITE_FOUR.length;
      runChampion = true;
      openChampionEnding();
    } else if(kind === 'pokestop'){
      battle = { trainer: { name: 'Dev Trainer' } };
      openPokeStop('preGym');
    } else if(kind === 'casino'){
      openPokestopCasino();
    } else if(kind === 'team'){
      pokestopMode = 'preGym';
      openTeamManagement();
    }
  }

  async function init(){
    loadMeta();
    try{
      await loadData();
    }catch(e){
      document.getElementById('startScreen').innerHTML = `
        <div class="eyebrow">Catching Simulator</div>
        <h1>COULDN'T LOAD DATA</h1>
        <p class="tagline">Make sure you're running this through a local server (e.g. VS Code's Live Server), not opening index.html directly. /data/*.json need to be fetched over http://.</p>
      `;
      console.error(e);
      return;
    }
    document.getElementById('startBtn').addEventListener('click', startGame);
    const MODE_HINTS = {
      classic: 'Classic: the game as you know it.',
      pro: 'Pro: wild encounters and starters are hidden until you pick one.',
      nuzlocke: 'Nuzlocke: Pro\'s blind picks, pricier PokeStop restocks, no Revives, no Casino, and a fainted Pokémon is gone for good.',
    };
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setGameMode(btn.dataset.mode);
        const hint = document.getElementById('modeHint');
        if(hint) hint.textContent = MODE_HINTS[btn.dataset.mode] || MODE_HINTS.classic;
      });
    });
    document.getElementById('rerollBtn').addEventListener('click', rerollWildChoices);
    document.getElementById('cruiseTicketWonBtn').addEventListener('click', boardCruiseShip);
    document.getElementById('pokestopEndRunBtn').addEventListener('click', openEndRunModal);
    document.getElementById('shinyRevealOkBtn').addEventListener('click', closeShinyRevealModal);
    document.getElementById('endRunConfirmBtn').addEventListener('click', confirmEndRun);
    document.getElementById('endRunCancelBtn').addEventListener('click', closeEndRunModal);
    document.getElementById('pokestopComputerBtn').addEventListener('click', openTeamManagement);
    document.getElementById('megaStoneHintClose').addEventListener('click', () => {
      document.getElementById('megaStoneHintPopup').style.display = 'none';
    });
    document.getElementById('megaFormChoiceCancelBtn').addEventListener('click', closeMegaFormChoice);
    document.getElementById('gymWinContinueBtn').addEventListener('click', closeGymWinModal);
    document.getElementById('pokedexCloseBtn').addEventListener('click', closePokedex);
    document.getElementById('pokestopCasinoBtn').addEventListener('click', openPokestopCasino);
    document.getElementById('teamBackBtn').addEventListener('click', closeTeamManagement);
    document.getElementById('gymSelectBackBtn').addEventListener('click', closeGymSelect);
    document.getElementById('viewFullRankingBtn').addEventListener('click', openFullRanking);
    document.getElementById('abandonRunBtn').addEventListener('click', openEndRunModal);
    document.getElementById('legendaryBeginBtn').addEventListener('click', confirmLegendaryTeam);
    document.getElementById('devJumpBtn').addEventListener('click', () => {
      devJump(document.getElementById('devJumpSelect').value);
    });
    if(new URLSearchParams(location.search).get('dev') === '1'){
      tryUnlockDevMode();
    }
    renderGoldBadge();

    const savedRun = loadSavedRun();
    if(savedRun){
      restoreRun(savedRun);
    } else {
      // No local save on this device/browser — check for a cloud checkpoint
      // (see run_saves.js) before falling back to the normal homepage. Only
      // relevant if the local save was lost/invalidated on this same
      // device; a different device gets a different device_id and won't see it.
      const cloudState = (typeof loadCheckpoint === 'function') ? await loadCheckpoint() : null;
      if(cloudState){
        openResumeCheckpointModal(cloudState);
      } else {
        renderBest();
      }
    }
  }

  document.addEventListener('DOMContentLoaded', init);

})();
