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
  const ELITE_FOUR = [
    { name:"Elite Four Corvax",  minBst:480, maxBst:560, squadSize:6 },
    { name:"Elite Four Seraphine", minBst:500, maxBst:580, squadSize:6 },
    { name:"Elite Four Draven",  minBst:520, maxBst:600, squadSize:6 },
    { name:"Elite Four Ilyra, the Unbeaten", minBst:550, maxBst:600, squadSize:6 },
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
  // her rewards a Full Revive and a Mega Stone.
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
  // Two ways to get one: (1) the Mega Stone reward from beating Captain
  // Sereia, used deliberately from the Computer screen on any eligible
  // active-team member; (2) a small passive chance that fires instead of a
  // normal evolution whenever the whole active team is already fully
  // evolved (nothing left to normally evolve) and at least one team member
  // has a Mega form available.
  const MEGA_RANDOM_CHANCE = 0.2;

  const IMG_DIR = "pokemon_png_reduzido/official-artwork";
  const IMG_DIR_SHINY = "pokemon_png_reduzido/official-artwork-shiny";
  const WILD_COUNT = 16; // shown as four rows of 4
  // "Easy" wild Pokémon = a high base_species_rate (top ~44% of the non-legendary
  // pool). The first 2 encounters draw only from this pool; from encounter 3 on,
  // easy slots progressively give way to the unrestricted pool (which can include
  // rarer, lower catch-rate, higher-BST Pokémon), so difficulty ramps with progress.
  const EASY_CATCH_RATE_MIN = 0.3;
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

  // Slot machine — now a mini-event inside the Cruise Casino (see below),
  // reached via the Cruise Ship Ticket rather than an automatic per-run roll.
  const CASINO_SPINS = 3;
  const CASINO_STRONG_MON_MIN_BST = 550;
  // Weighted slot symbols — low weight = rare = big payout. Only the top
  // symbol (777) also awards a random strong Pokémon on a 3-of-a-kind.
  const SLOT_SYMBOLS = [
    { symbol:'🍒', weight:35, goldMin:20,  goldMax:40  },
    { symbol:'🍋', weight:28, goldMin:30,  goldMax:60  },
    { symbol:'🔔', weight:20, goldMin:50,  goldMax:90  },
    { symbol:'⭐', weight:11, goldMin:80,  goldMax:150 },
    { symbol:'💎', weight:5,  goldMin:150, goldMax:250 },
    { symbol:'7️⃣', weight:1,  goldMin:300, goldMax:500, strongMon:true },
  ];

  // ---------- POKESTOP CASINO (Token Slot Machine + Token Shop) ----------
  // Separate from the Cruise Casino above — unlocked once the endgame opens
  // (8th badge, or reaching the Cruise Ship, whichever comes first) and
  // reachable from every PokeStop visit from then on. Spins cost Gold;
  // payouts are a separate currency (Tokens) spent in the Token Shop below.
  const CASINO_SPIN_COST_GOLD = 25;
  const TOKEN_SLOT_REEL_STOP_INTERVAL = 650; // ms between each reel's auto-stop, left to right
  const TOKEN_SLOT_CYCLE_MS = 70; // how fast symbols flicker while a reel is still "spinning"
  // Weights below start from a 4-8% boost per tier over the initial design
  // (harder/rarer tiers got the bigger boost, so big wins are less
  // astronomically rare) — see supabase_rescore_existing_runs.sql sibling
  // discussion for the math; kept here as plain tuned numbers.
  const CASINO_TOKEN_SYMBOLS = [
    { symbol:'7️⃣', name:'seven',     weight:11,  payout:300 },
    { symbol:'🅁',  name:'rocket',    weight:32,  payout:100 },
    { symbol:'⚡',  name:'pikachu',   weight:64,  payout:15  },
    { symbol:'🦆',  name:'psyduck',   weight:85,  payout:15  },
    { symbol:'😴',  name:'slowpoke',  weight:85,  payout:15  },
    { symbol:'🧲',  name:'magnemite', weight:105, payout:8   },
    { symbol:'👻',  name:'gastly',    weight:105, payout:8   },
    { symbol:'🐚',  name:'shellder',  weight:126, payout:8   },
    { symbol:'⭐',  name:'staryu',    weight:126, payout:8   },
    { symbol:'🍒',  name:'cherry',    weight:312, payout:0   }, // handled specially — see resolveCasinoCherryPayout()
  ];
  const CASINO_CHERRY_1_PAYOUT = 4;
  const CASINO_CHERRY_2PLUS_PAYOUT = 6;

  // Casino Token Shop — spend Tokens earned from the slot machine. The
  // Token Exchange is deliberately the priciest, hardest-to-reach item: a
  // random shiny, fully-evolved (non-Mythical, non-Legendary) Pokémon.
  const TOKEN_SHOP_ITEMS = {
    potions: { label:"Potion", invKey:"potions", cost:25, desc:"" },
    revives: { label:"Revive", invKey:"revives", cost:55, desc:"" },
    tokenExchange: { label:"Key Prize", cost:125, isExchange:true, desc:"Sparkly." },
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
  const GYM_GOLD_MIN = 30; // Gym Leader wins pay out more than route trainers; +65%
  const GYM_GOLD_MAX = 45;
  const POTION_HEAL_FRACTION = 0.5;  // heals this fraction of max HP
  const REVIVE_HP_FRACTION = 0.5;    // revived Pokémon comes back at this fraction of max HP
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
  };
  function itemIconHTML(invKey){
    const file = ITEM_ICONS[invKey];
    return file ? `<img class="item-icon" src="${ITEM_ICON_DIR}/${file}" alt="" onerror="this.style.display='none'">` : '';
  }

  // ---------- DATA (populated from /data/*.json) ----------
  let POKEMON = [];       // {id, name, types, bst, legendary, hp, attack, defense, sp_atk, sp_def, speed, base_species_rate}
  let POKEMON_BY_NAME = {};
  let MOVESETS = {};      // name -> [{name,type,power,accuracy,damage_class}, ...]
  let EVOLUTIONS = {};    // name -> next evolution's name, or an array of names for branching evolutions (absent if none) — see evolutionOptionsFor()
  let MEGA_FORMS_BY_BASE = {}; // base species name -> [mega form names] (e.g. "charizard" -> ["charizard-mega-x","charizard-mega-y"])
  let STARTER_LINE_NAMES = new Set(); // every starter's base + stage1 + stage2 names — see loadData()

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

    // Mega forms with no generated artwork (neither normal nor shiny) — kept
    // out of MEGA_FORMS_BY_BASE below so Mega Evolution can never pick one.
    const MEGA_FORMS_MISSING_ART = new Set(["tatsugiri-curly-mega", "tatsugiri-droopy-mega"]);

    MEGA_FORMS_BY_BASE = {};
    list.forEach(p => {
      if(MEGA_FORMS_MISSING_ART.has(p.name)) return;
      let base = null;
      if(p.name.endsWith('-mega')) base = p.name.slice(0, -5);
      else if(/-mega-(x|y)$/.test(p.name)) base = p.name.replace(/-mega-(x|y)$/, '');
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
  function displayName(name){
    if(!name) return name;
    const xy = name.match(/^(.+)-mega-(x|y)$/);
    if(xy) return `Mega ${xy[1]} ${xy[2].toUpperCase()}`;
    if(name.endsWith('-mega')) return `Mega ${name.slice(0, -5)}`;
    return name;
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

  // Queries the global top `limit` directly from Supabase (ORDER BY + LIMIT
  // run server-side, so we never pull the whole table down to slice it here).
  async function loadBest(limit = 10){
    if(!supabaseClient) return [];
    try{
      const { data, error } = await supabaseClient
        .from('scores')
        .select('*')
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
    const list = await loadBest(10);
    bestListCache = list;
    const block = document.getElementById('bestBlock');
    const el = document.getElementById('bestList');
    const moreBtn = document.getElementById('viewFullRankingBtn');
    if(!list.length){ block.classList.remove('active'); return; }
    block.classList.add('active');
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
      <div id="fullRankingList" class="best-title">Loading…</div>
      <div class="actions">
        <button class="btn-ghost" id="fullRankingBackBtn">BACK</button>
      </div>
    `;
    document.getElementById('fullRankingBackBtn').addEventListener('click', closeFullRanking);

    const list = await loadBest(100);
    rankingListCache = list;
    const listEl = document.getElementById('fullRankingList');
    const rest = list.slice(10);
    if(!rest.length){
      listEl.textContent = 'Not enough runs yet. Check back once more players have set a highscore.';
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
  // Records the run as a single row on the shared Supabase leaderboard and
  // reports whether it's a new all-time high score. The full snapshot (team,
  // badges, elite/legendary progress) goes into `details` so the player can
  // revisit a saved run from the homepage list, same as before.
  async function recordRun(run, playerName){
    const score = computeScore(run);

    let previousBest = -Infinity;
    let isFirstEver = true;
    if(supabaseClient){
      try{
        const { data, error } = await supabaseClient
          .from('scores')
          .select('score')
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
    };

    if(supabaseClient){
      try{
        const { error } = await supabaseClient.from('scores').insert({
          name: (playerName || 'Player').slice(0, 20),
          score,
          badges: run.badges,
          trainers_beaten: run.trainersBeaten,
          caught_count: run.caught.length,
          gold_earned: run.goldEarned,
          details,
        });
        if(error) throw error;
      }catch(e){ /* offline / RLS / network failure: fail silently, matches prior behavior */ }
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
        <div class="team-mgmt-title" style="margin-top:14px;">Active Team (last used this run)</div>
        <div class="run-detail-team-grid">${activeMons.map(monSlotHTML).join('') || '<div class="empty-note">Empty.</div>'}</div>`;
      storageSectionHTML = `
        <div class="team-mgmt-title" style="margin-top:14px;">Caught &amp; in Storage</div>
        <div class="run-detail-team-grid">${storageMons.length ? storageMons.map(monSlotHTML).join('') : '<div class="empty-note">Nothing else was caught this run.</div>'}</div>`;
    } else {
      const allMons = [starterMon, ...caughtMons].filter(Boolean);
      activeSectionHTML = `
        <div class="team-mgmt-title" style="margin-top:14px;">Team</div>
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

    el.innerHTML = `
      <div class="card foil-solid run-detail-card">
        <div class="card-inner">
          <div class="ovr-num">${entry.score}</div>
          <div class="ovr-label">SCORE</div>
          <div class="tier-name">${entry.name || 'Player'}${dateStr ? ` · ${dateStr}` : ''}</div>
          <div class="tier-flavor">${statusLine}</div>

          <div class="inv-strip" style="margin-top:12px;">${statTiles}</div>

          ${activeSectionHTML}
          ${storageSectionHTML}

          <div class="team-mgmt-title" style="margin-top:14px;">Badges Earned</div>
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
  let META = { gold:0, extraBalls:0 };

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
      cruiseStageIndex, cruiseMiniEventUsed, shopBoughtCounts, shopLifetimeBonus,
      itemsBought, itemsUsed, runStartedAt,
      pendingEvolution, activeEvolution, pokestopMode,
      wildChoices,
      hasComputerNotification, newArrivalNames,
      lastBattleTrainerName: (battle && battle.trainer) ? battle.trainer.name : null,
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

  // Marks a new checkpoint (screen transition) and saves immediately.
  function checkpoint(screen){
    checkpointScreen = screen;
    persistRunState();
    const btn = document.getElementById('abandonRunBtn');
    if(btn) btn.style.display = 'block';
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
    wildChoices = saved.wildChoices || [];
    hasComputerNotification = !!saved.hasComputerNotification;
    newArrivalNames = Array.isArray(saved.newArrivalNames) ? saved.newArrivalNames : [];
    checkpointScreen = saved.checkpointScreen;

    document.getElementById('startScreen').style.display = 'none';
    const abandonBtn = document.getElementById('abandonRunBtn');
    if(abandonBtn) abandonBtn.style.display = 'block';

    if(checkpointScreen === 'encounter'){
      document.getElementById('encounterScreen').classList.add('active');
      renderWildChoices();
      renderRerollButton();
    } else if(checkpointScreen === 'gymSelect'){
      openGymSelect();
    } else if(checkpointScreen === 'rivalChallenge'){
      openRivalChallenge();
    } else if(checkpointScreen === 'pokestop'){
      // Rebuild just enough of `battle` for renderPokeStop()'s "You beat X"
      // text — full battle state is never persisted (see note above).
      battle = { trainer: { name: saved.lastBattleTrainerName || 'them' } };
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

  function renderStarterChoices(){
    const choices = pickN(STARTERS, 3).map(n => POKEMON_BY_NAME[n]).filter(Boolean);
    const grid = document.getElementById('starterGrid');
    grid.innerHTML = choices.map(mon => `
      <button class="starter-card" data-name="${mon.name}">
        ${avatarHTML(mon)}
        <span class="c-name">${displayName(mon.name)}</span>
        <div class="c-types">${typeChipsHTML(mon.types)}</div>
      </button>`).join('');
    grid.querySelectorAll('.starter-card').forEach(btn => {
      btn.addEventListener('click', () => selectStarter(POKEMON_BY_NAME[btn.dataset.name]));
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
      potions: 0, revives: 0, fullRevives: 0,
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
    cruiseStageIndex = null;
    cruiseMiniEventUsed = { fishing:false, slots:false };
    shopBoughtCounts = {};
    shopLifetimeBonus = {};
    itemsBought = {};
    itemsUsed = {};
    runStartedAt = Date.now();
    hasComputerNotification = false;
    newArrivalNames = [];
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

  // Only used by the wild-encounter-list pipeline below (pickWildChoices,
  // ensureGenerationDiversity) — excludes every species already shown in
  // ANY encounter list this run, caught or not, so nothing repeats across
  // different encounters.
  function freshWildPool(){
    return catchablePool().filter(p => !seenWildNames.has(p.name));
  }

  // Records every species just shown so it never appears in a future
  // encounter list this run, whether or not the player catches it.
  function markWildChoicesSeen(list){
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

  function renderWildChoices(){
    const grid = document.getElementById('wildGrid');
    grid.innerHTML = wildChoices.map((mon,i) => `
      <button class="wild-card" data-idx="${i}">
        ${avatarHTML(mon)}
        <span class="c-name">${displayName(mon.name)}</span>
        <div class="c-types">${typeDotsHTML(mon.types)}</div>
        ${mon.is_shiny ? '<span class="shiny-dot" title="Shiny!">✨</span>' : ''}
      </button>`).join('');

    grid.querySelectorAll('.wild-card').forEach(btn => {
      btn.addEventListener('click', () => selectWildTarget(wildChoices[Number(btn.dataset.idx)]));
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

    const throwBtn = document.getElementById('throwBtn');
    throwBtn.disabled = busy || inv.balls <= 0;
    throwBtn.textContent = `THROW POKÉBALL ×${inv.balls}${pendingMultiplier > 1 ? ' (BOOSTED)' : ''}`;
    throwBtn.onclick = () => resolveThrow('balls');

    const greatBtn = document.getElementById('greatBallBtn');
    greatBtn.style.display = inv.greatBalls > 0 ? 'block' : 'none';
    greatBtn.disabled = busy || inv.greatBalls <= 0;
    greatBtn.textContent = `THROW GREAT BALL ×${inv.greatBalls}`;
    greatBtn.onclick = () => resolveThrow('greatBalls');

    const ultraBtn = document.getElementById('ultraBallBtn');
    ultraBtn.style.display = inv.ultraBalls > 0 ? 'block' : 'none';
    ultraBtn.disabled = busy || inv.ultraBalls <= 0;
    ultraBtn.textContent = `THROW ULTRA BALL ×${inv.ultraBalls}`;
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
  function catchWildTarget(mon){
    if(activeTeam.length < MAX_PARTY_SIZE) activeTeam.push(mon);
    else storage_.push(mon);
    flagComputerNotification(mon.name);
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
    // Identify the starter by reference, not position — the Computer screen
    // lets the player reorder activeTeam, so the starter isn't always slot 0.
    const allCaught = [...activeTeam.filter(m => m !== starter), ...storage_];
    renderResult({
      starter, caught: allCaught, trainersBeaten: runTrainersBeaten, badges: runBadges,
      champion: runChampion, trainerLoss, goldEarned: runGoldEarned,
      beatenBadges: Array.from(runBeatenBadges), eliteBeaten: eliteIndex, legendaryHandled, mythicalHandled,
      activeRoster: activeTeam.slice(), // the final active team, in order — for the spotlight + Hall of Fame card
    });
  }

  // ---------- TRAINER BATTLE ----------
  let battle;

  function currentPartySize(){ return activeTeam.length; }

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
      // ROUTE_FINAL_STRETCH_TIERS.
      const tier = ROUTE_FINAL_STRETCH_TIERS[runBadges - finalStretchStart];
      pool = wildPool().filter(p => p.bst >= tier.minBst && p.bst <= tier.maxBst);
    } else {
      // The player's very first route trainer fight this run gets an extra-easy
      // cap, giving a fresh starter better odds before it's had a chance to grow.
      const maxBst = encounterNum === 1 ? FIRST_TRAINER_MAX_BST : LOW_TIER_MAX_BST;
      pool = wildPool().filter(p => p.bst <= maxBst);
    }

    const squadSize = isFinalStretch
      ? Math.min(4 + (runBadges - finalStretchStart), currentPartySize())
      : Math.min(
          ROUTE_TRAINER_SQUAD_SIZE + Math.floor(runBadges / 3),
          ROUTE_TRAINER_MAX_SQUAD,
          currentPartySize()
        );
    const name = pick(TRAINER_ARCHETYPES);
    return { name, squad: pickN(pool, squadSize), isGym:false, portraitFile: trainerPortraitFile(name) };
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
    return { name: badge.leaderName, squad: pickN(pool, squadSize), isGym:true, badgeKey: badge.key, badgeIcon: badge.icon, badgeTypes: badge.types };
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
    return { name: CRUISE_RIVAL.name, squad: pickN(pool, squadSize), isRival:true, portraitFile: trainerPortraitFile(CRUISE_RIVAL.name) };
  }

  function movesFor(mon){
    const set = MOVESETS[mon.name];
    return set && set.length ? set : [FALLBACK_MOVE];
  }

  function makeBattler(mon){
    const maxHp = Math.round((mon.hp || 45) * 2.2) + 30;
    return { mon, maxHp, hp: maxHp, moves: movesFor(mon) };
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
    return pick(useful.length ? useful : attacker.moves);
  }

  function computeDamage(attacker, defender, move){
    const atkStat = move.damage_class === 'special' ? (attacker.mon.sp_atk || 40) : (attacker.mon.attack || 40);
    const defStat = move.damage_class === 'special' ? (defender.mon.sp_def || 40) : (defender.mon.defense || 40);
    const stab = attacker.mon.types.includes(move.type) ? 1.5 : 1;
    const eff = typeEffectiveness(move.type, defender.mon.types);
    const base = ((2*50/5 + 2) * move.power * (atkStat/Math.max(1,defStat))) / 50 + 2;
    const variance = rand(0.85, 1.0);
    const dmg = eff === 0 ? 0 : Math.max(1, Math.floor(base * stab * eff * variance));
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
  // there's a small chance a Mega-capable team member spontaneously Mega
  // Evolves instead.
  function evolveRandomEligible(){
    const eligibleIdx = [];
    activeTeam.forEach((mon, idx) => {
      if(evolutionOptionsFor(mon.name).length) eligibleIdx.push(idx);
    });
    if(!eligibleIdx.length) return rollRandomMegaEvolution();
    const idx = pick(eligibleIdx);
    const currentMon = activeTeam[idx];
    const evolvedBase = rollRegionalEvolution(POKEMON_BY_NAME[pick(evolutionOptionsFor(currentMon.name))]);
    const evolved = currentMon.is_shiny ? { ...evolvedBase, is_shiny:true } : evolvedBase;
    activeTeam[idx] = evolved;
    if(currentMon === starter) starter = evolved; // keep the starter reference current through evolution
    return { from: currentMon, to: evolved };
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

  function performMegaEvolution(idx){
    const currentMon = activeTeam[idx];
    const forms = MEGA_FORMS_BY_BASE[currentMon.name];
    if(!forms || !forms.length) return null;
    const evolvedBase = POKEMON_BY_NAME[pick(forms)];
    const evolved = currentMon.is_shiny ? { ...evolvedBase, is_shiny:true } : evolvedBase;
    activeTeam[idx] = evolved;
    if(currentMon === starter) starter = evolved;
    return { from: currentMon, to: evolved, isMega:true };
  }

  // Passive chance, only rolled when nobody on the team has a normal
  // evolution left to trigger.
  function rollRandomMegaEvolution(){
    const idxs = megaEligibleIdx();
    if(!idxs.length || Math.random() >= MEGA_RANDOM_CHANCE) return null;
    return performMegaEvolution(pick(idxs));
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

  // Shows the player's current active roster (up to 6) — reusable wherever
  // it's useful to see your team before making a decision.
  function renderRosterStrip(elId){
    const el = document.getElementById(elId);
    if(!el) return;
    el.innerHTML = activeTeam.map(mon => `
      <div class="roster-slot">
        ${avatarHTML(mon,'avatar-sm')}
        <span class="tn">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">✨</span>' : ''}</span>
        <span class="tt" style="color:${TYPE_COLOR[mon.types[0]]}">${mon.types.join(' / ')}</span>
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
  // below which one is currently running. Each requires picking exactly 3
  // Pokémon (fewer only if the active team itself has fewer than 3) — a
  // restriction that applies to this single battle only, since `activeTeam`
  // itself is never modified.
  const LEGENDARY_SQUAD_CAP = 3;
  const MYTHICAL_SQUAD_CAP = 3;
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
      ? `Stranded on this remote island, a Mythical ${typeLabel}-type Pokémon — spoken of even among Legendaries — has been waiting. The ship only stopped for a few hours, so this is your only shot at it. Choose your team wisely.`
      : `A Legendary ${typeLabel}-type Pokémon of immense, rarely-witnessed power. Encounters like this happen once in a lifetime, so choose your team wisely.`;
  }

  function openSpecialIntro(mon, kind){
    introEncounterKind = kind;
    legendaryPendingMon = mon;
    legendarySelectedIdx = [];
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

    document.getElementById('legendaryIntroName').textContent = displayName(mon.name);
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
    if(opponent.isDouble) return `🚢 Double Battle! 2 Pokémon a side, fighting at once.`;
    if(opponent.isCruise) return `🚢 Cruise Ship battle! ${opponent.squad.length} Pokémon.`;
    return `Encounter ${encounterNum} · a route trainer wants to battle! ${opponent.squad.length} Pokémon.`;
  }

  // Stadium-style lead pick: before the opponent's first Pokémon is shown,
  // the player commits to who leads off. Doesn't affect who fights next once
  // the lead faints — that's still chosen live via renderTeamSwitchStrip().
  function beginBattle(opponent, playerOverride){
    revivePickerOpen = false; // reset in case a previous battle left it open
    potionPickerOpen = false;
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

  function renderDoubleSquadSelect(opponent, order){
    const remaining = 2 - doubleSquadPicked.length;
    document.getElementById('leadSelectSub').textContent =
      `${battleSubText(opponent)} Choose exactly 2 Pokémon to send out${remaining > 0 ? ` — pick ${remaining} more` : ''}.`;

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
        if(doubleSquadPicked.length === 2){
          const pair = doubleSquadPicked.map(i2 => order[i2]);
          document.getElementById('leadSelectScreen').classList.remove('active');
          startDoubleBattle(opponent, pair);
          return;
        }
        renderDoubleSquadSelect(opponent, order);
      });
    });
  }

  function openLeadSelect(opponent, order){
    document.getElementById('encounterScreen').classList.remove('active');
    document.getElementById('catchScreen').classList.remove('active');
    document.getElementById('leadSelectScreen').classList.add('active');

    document.getElementById('leadSelectEyebrow').textContent = displayName(opponent.name);
    document.getElementById('leadSelectSub').textContent =
      `${battleSubText(opponent)} Pick who goes out first — your opponent hasn't shown their hand yet.`;

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
      firstTurnResolved: false, // gates the item-window ring — no countdown during turn 1's window
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
    };

    document.getElementById('battleMoveLog').innerHTML = '';
    document.getElementById('battleContinueBtn').style.display = 'none';
    document.getElementById('battleScreen').classList.add('active');
    document.getElementById('battleScreen').classList.remove('gym-battle', 'legendary-battle', 'elite-battle');
    document.getElementById('battleScreen').classList.add('cruise-battle', 'double-battle');

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
      { label:'YOUR POKÉMON', b:p, balls:'' },
      { label:battle.trainer.name.toUpperCase(), b:e, balls:foeBallsHTML },
    ].map(side => `
      <div class="hp-card">
        ${avatarHTML(side.b.mon,'avatar-sm')}
        <div class="hp-info">
          <div class="hp-side-label">${side.label}</div>
          <div class="hp-name-row"><span>${displayName(side.b.mon.name)}</span><span>${Math.max(0,side.b.hp)}/${side.b.maxHp}</span></div>
          <div class="hp-bar-track"><div class="hp-bar-fill ${side.b.hp/side.b.maxHp < 0.25 ? 'low':''}" style="width:${Math.max(0,side.b.hp/side.b.maxHp*100)}%"></div></div>
          ${side.balls}
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
          <div class="hp-name-row"><span>${displayName(b.mon.name)}</span><span>${Math.max(0,b.hp)}/${b.maxHp}</span></div>
          <div class="hp-bar-track"><div class="hp-bar-fill ${b.hp/b.maxHp < 0.25 ? 'low':''}" style="width:${Math.max(0,b.hp/b.maxHp*100)}%"></div></div>
        </div>
      </div>`;
    panel.innerHTML = `
      <div class="hp-double-row">
        ${cardHTML(battle.player[0], 'YOUR POKÉMON')}
        ${cardHTML(battle.player[1], 'YOUR POKÉMON')}
      </div>
      <div class="hp-double-row">
        ${cardHTML(battle.enemy[0], battle.trainer.name.toUpperCase())}
        ${cardHTML(battle.enemy[1], battle.trainer.name.toUpperCase())}
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

  function renderBattleItemsPanel(){
    const panel = document.getElementById('bagPanel');
    if(!panel || !battle) return;
    const busy = battle.over || battle.resolving;

    if(battle.isDouble){
      const anyPickerOpen = revivePickerOpen || potionPickerOpen;
      const healable = battle.player.filter(b => b.hp > 0 && b.hp < b.maxHp);
      const canHeal = !busy && !anyPickerOpen && healable.length > 0 && inv.potions > 0;
      const faintedCount = battle.player.filter(b => b.hp <= 0).length;
      const totalRevives = inv.revives + (inv.fullRevives || 0);
      const canRevive = !busy && !anyPickerOpen && faintedCount > 0 && totalRevives > 0;
      const timedWindowOpen = !busy && !anyPickerOpen && battle.firstTurnResolved;

      panel.innerHTML = `
        <div class="bag-items-row">
          ${timedWindowOpen ? `<div class="item-window-ring" style="animation-duration:${ITEM_WINDOW_MS}ms"></div>` : ''}
          <div class="bag-item-card">
            ${itemIconHTML('potions')}
            <div class="bag-item-name">Potion ×${inv.potions}</div>
            <div class="bag-item-desc">${healable.length ? 'Pick who to heal' : 'Nobody needs healing'}</div>
            <button class="btn-ghost bag-use" id="usePotionBtn" ${canHeal ? '' : 'disabled'}>USE</button>
          </div>
          <div class="bag-item-card">
            ${itemIconHTML('revives')}
            <div class="bag-item-name">Revive ×${totalRevives}</div>
            <div class="bag-item-desc">${faintedCount ? 'Pick who comes back' : 'Nothing to revive'}</div>
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
    const canHeal = !busy && !revivePickerOpen && activePlayer && activePlayer.hp > 0 && activePlayer.hp < activePlayer.maxHp && inv.potions > 0;
    const faintedCount = battle.player.filter(b => b.hp <= 0).length;
    const totalRevives = inv.revives + (inv.fullRevives || 0);
    const canRevive = !busy && !revivePickerOpen && faintedCount > 0 && totalRevives > 0;
    // The ring only makes sense while there's an actual pending auto-advance
    // timer to race against — not while busy, the revive picker is open, or
    // a forced switch is waiting (that one has no timeout at all).
    const timedWindowOpen = !busy && !revivePickerOpen && !battle.awaitingSwitch && battle.firstTurnResolved;

    panel.innerHTML = `
      <div class="bag-items-row">
        ${timedWindowOpen ? `<div class="item-window-ring" style="animation-duration:${ITEM_WINDOW_MS}ms"></div>` : ''}
        <div class="bag-item-card">
          ${itemIconHTML('potions')}
          <div class="bag-item-name">Potion ×${inv.potions}</div>
          <div class="bag-item-desc">Heals ${activePlayer ? activePlayer.mon.name : 'your Pokémon'}</div>
          <button class="btn-ghost bag-use" id="usePotionBtn" ${canHeal ? '' : 'disabled'}>USE</button>
        </div>
        <div class="bag-item-card">
          ${itemIconHTML('revives')}
          <div class="bag-item-name">Revive ×${totalRevives}</div>
          <div class="bag-item-desc">${faintedCount ? 'Pick who comes back' : 'Nothing to revive'}</div>
          <button class="btn-ghost bag-use" id="useReviveBtn" ${canRevive ? '' : 'disabled'}>USE</button>
        </div>
      </div>
      <div class="revive-picker" id="revivePicker" style="display:${revivePickerOpen ? 'block' : 'none'};">${revivePickerOpen ? revivePickerHTML() : ''}</div>
    `;
    document.getElementById('usePotionBtn').onclick = usePotion;
    document.getElementById('useReviveBtn').onclick = openRevivePicker;
    if(revivePickerOpen) wireRevivePickerButtons();
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
    const target = battle.player[idx];
    if(!target || target.hp <= 0 || target.hp >= target.maxHp || inv.potions <= 0) return;
    if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
    inv.potions--;
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

  function usePotion(){
    if(!battle || battle.over || battle.resolving) return;
    const activePlayer = battle.player[battle.pIdx];
    if(!activePlayer || activePlayer.hp <= 0 || activePlayer.hp >= activePlayer.maxHp || inv.potions <= 0) return;
    if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
    inv.potions--;
    trackItemUsed('potions');
    const healed = Math.round(activePlayer.maxHp * POTION_HEAL_FRACTION);
    activePlayer.hp = Math.min(activePlayer.maxHp, activePlayer.hp + healed);
    appendBattleLog(`Used a Potion on ${displayName(activePlayer.mon.name)}.`, `Recovered ${healed} HP.`, 'info');
    renderHpPanel();
    if(!battle.over && !battle.awaitingSwitch) battle.nextTimerId = setTimeout(battleStep, ITEM_WINDOW_MS);
  }

  function useRevive(idx){
    if(!battle || battle.over || battle.resolving) return;
    const target = battle.player[idx];
    const hasFullRevive = (inv.fullRevives || 0) > 0;
    if(!target || target.hp > 0 || (!hasFullRevive && inv.revives <= 0)) return;
    if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
    // Full Revives (Captain Sereia's reward) are strictly better, so use one first if available.
    if(hasFullRevive){
      inv.fullRevives--;
      trackItemUsed('fullRevives');
      target.hp = target.maxHp;
      appendBattleLog(`${displayName(target.mon.name)} was fully revived!`, `Back up at full HP.`, 'info');
    } else {
      inv.revives--;
      trackItemUsed('revives');
      target.hp = Math.round(target.maxHp * REVIVE_HP_FRACTION);
      appendBattleLog(`${displayName(target.mon.name)} was revived!`, `Back up with ${target.hp} HP.`, 'info');
    }
    if(idx === battle.pIdx && battle.awaitingSwitch){
      battle.awaitingSwitch = false; // reviving the just-fainted active mon brings it right back into action
    }
    renderHpPanel();
    closeRevivePicker(!battle.awaitingSwitch); // picking a target counts as the decision — resume, unless still awaiting a switch
  }

  function resolveAttack(turn){
    const { b, foe } = turn;
    if(b.hp <= 0 || foe.hp <= 0) return;
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

  // Elite Four trainers only: while their active Pokémon is alive but in the
  // HP bar's "red" zone (same <25% threshold the HP bar itself uses — see
  // the `< 0.25` check in renderHpPanel/renderTeamSwitchStrip), they get a
  // chance to Potion-heal it back up. First use 55%, second use 45%, and
  // never more than 2 uses in the same battle. A roll that doesn't trigger
  // isn't "spent" — it can still fire again next time HP dips into red.
  function maybeEliteEnemyPotion(){
    if(!battle.trainer.isElite) return;
    const e = battle.enemy[battle.eIdx];
    if(!e || e.hp <= 0) return;
    const used = battle.eliteAiPotionsUsed || 0;
    if(used >= 2) return;
    if(e.hp / e.maxHp >= 0.25) return;
    const chance = used === 0 ? 0.55 : 0.45;
    if(Math.random() >= chance) return;
    const healed = Math.round(e.maxHp * POTION_HEAL_FRACTION);
    e.hp = Math.min(e.maxHp, e.hp + healed);
    battle.eliteAiPotionsUsed = used + 1;
    appendBattleLog(`${battle.trainer.name} used a Potion on ${displayName(e.mon.name)}!`, `Recovered ${healed} HP.`, 'info');
    renderHpPanel();
  }

  function afterExchange(){
    battle.firstTurnResolved = true; // turn 1 is done — the item-window ring is allowed from here on
    maybeEliteEnemyPotion();

    // The active Pokémon fainting only loses the battle if EVERY Pokémon on
    // the team is down — not just because we've reached the end of the
    // array. If teammates are still standing, the player picks who's next.
    const activeFainted = battle.player[battle.pIdx].hp <= 0;
    const teamWiped = activeFainted && battle.player.every(b => b.hp <= 0);

    if(battle.enemy[battle.eIdx].hp <= 0){
      // The final Elite Four member gets one 75%-chance Revive on their
      // fainted Pokémon (partial HP, same fraction the player's own Revive
      // item uses) instead of sending out their next squad member.
      if(battle.trainer.isFinalElite && !battle.eliteAiRevived && Math.random() < 0.75){
        battle.eliteAiRevived = true;
        const e = battle.enemy[battle.eIdx];
        e.hp = Math.round(e.maxHp * REVIVE_HP_FRACTION);
        appendBattleLog(`${battle.trainer.name} used a Revive on ${displayName(e.mon.name)}!`, `Back up with ${e.hp} HP.`, 'info');
      } else {
        battle.eIdx++;
        if(battle.eIdx < battle.enemy.length){
          appendBattleLog(`${battle.trainer.name} sends out ${displayName(battle.enemy[battle.eIdx].mon.name)}!`, '', 'info');
        }
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
    renderHpPanel();
    if(foe.hp <= 0){
      appendBattleLog(`${displayName(foe.mon.name)} fainted!`, '', 'faint');
    }
  }

  function afterDoubleExchange(){
    battle.firstTurnResolved = true;
    battle.resolving = false;

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
    appendBattleLog(
      won ? `${battle.trainer.name} is out of usable Pokémon. You won!` : `Your team fainted... ${battle.trainer.name} wins.`,
      '', won ? 'win' : 'out'
    );

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
          inv.fullRevives = (inv.fullRevives || 0) + 1;
          inv.megaStone = (inv.megaStone || 0) + 1;
          flagComputerNotification();
          appendBattleLog(`Captain Sereia hands you a Full Revive and a Mega Stone!`, '', 'reward');
        }
      } else if(isRival){
        const goldWon = randInt(RIVAL_GOLD_MIN, RIVAL_GOLD_MAX) * battle.trainer.squad.length;
        runGoldEarned += goldWon;
        META.gold += goldWon;
        saveMeta();
        appendBattleLog(`You bested ${battle.trainer.name}! +${goldWon}G.`, '', 'win');
        pendingEvolution = evolveRandomEligible();
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
          appendBattleLog(`You earned a Badge! +${goldWon}G too.`, '', 'win');
          pendingEvolution = evolveRandomEligible();
          if(pendingEvolution){
            appendBattleLog(pendingEvolution.isMega ? `Something on your team is Mega Evolving...` : `Something on your team is evolving...`, '', 'win');
          }
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
    document.getElementById('battleContinueBtn').style.display = 'block';
    document.getElementById('battleContinueBtn').onclick = () => afterBattle(won);
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
    // renderPokeStop's 'postGym' branch detects when the 8th badge was just
    // earned and routes the continue button to the Legendary instead of the
    // next encounter.
    openPokeStop(wasGym ? 'postGym' : 'preGym');
  }

  // ---------- RANDOM EVENT: CASINO / SLOT MACHINE ----------
  let casinoSpinsLeft, casinoOnDone;

  function openCasino(onDone){
    casinoSpinsLeft = CASINO_SPINS;
    casinoOnDone = onDone;
    document.getElementById('casinoLog').innerHTML = '';
    document.getElementById('slotWinBanner').style.display = 'none';
    document.getElementById('casinoLeaveBtn').style.display = 'none';
    document.getElementById('slotSpinBtn').style.display = 'block';
    document.getElementById('slotReels').querySelectorAll('.slot-reel').forEach(r => r.textContent = '?');
    document.getElementById('casinoScreen').classList.add('active');
    renderCasinoState();
    document.getElementById('slotSpinBtn').onclick = spinSlots;
    document.getElementById('casinoLeaveBtn').onclick = closeCasino;
  }

  function renderCasinoState(){
    document.getElementById('casinoSpinsLeft').textContent = casinoSpinsLeft;
    document.getElementById('slotSpinBtn').textContent = `PULL THE LEVER (${casinoSpinsLeft} LEFT)`;
    document.getElementById('slotSpinBtn').disabled = casinoSpinsLeft <= 0;
  }

  // Only the latest line is shown — no piling up of prior spins.
  function appendCasinoLog(text){
    const wrap = document.getElementById('casinoLog');
    wrap.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'catch-log-line';
    line.textContent = text;
    wrap.appendChild(line);
  }

  function spinSlots(){
    if(casinoSpinsLeft <= 0) return;
    casinoSpinsLeft--;

    const reelEls = document.querySelectorAll('#slotReels .slot-reel');
    const rolled = [pickWeighted(SLOT_SYMBOLS), pickWeighted(SLOT_SYMBOLS), pickWeighted(SLOT_SYMBOLS)];
    reelEls.forEach((el,i) => {
      el.classList.remove('spin-anim');
      void el.offsetWidth;
      el.classList.add('spin-anim');
      el.textContent = rolled[i].symbol;
    });

    const won = rolled[0].symbol === rolled[1].symbol && rolled[1].symbol === rolled[2].symbol;
    const banner = document.getElementById('slotWinBanner');

    if(won){
      const symbol = rolled[0];
      const goldWon = randInt(symbol.goldMin, symbol.goldMax);
      runGoldEarned += goldWon;
      META.gold += goldWon;
      saveMeta();

      let text = `JACKPOT-ish! ${symbol.symbol}${symbol.symbol}${symbol.symbol}, you win ${goldWon}G!`;
      if(symbol.strongMon){
        const strongPool = catchablePool().filter(p => p.bst >= CASINO_STRONG_MON_MIN_BST);
        const wonMon = strongPool.length ? pick(strongPool) : null;
        if(wonMon){
          if(activeTeam.length < MAX_PARTY_SIZE) activeTeam.push(wonMon); else storage_.push(wonMon);
          flagComputerNotification(wonMon.name);
          text = `🎉 TRIPLE 7s! ${goldWon}G AND a wild ${displayName(wonMon.name)} joins your team!`;
        }
      }
      appendCasinoLog(text);
      banner.textContent = won ? (symbol.strongMon ? '★ JACKPOT ★' : 'WINNER!') : '';
      banner.style.display = 'block';
      banner.classList.remove('win-pop');
      void banner.offsetWidth;
      banner.classList.add('win-pop');
    } else {
      appendCasinoLog(`${rolled.map(r=>r.symbol).join(' ')}, no match, better luck next pull.`);
    }

    renderCasinoState();
    if(casinoSpinsLeft <= 0){
      document.getElementById('slotSpinBtn').style.display = 'none';
      document.getElementById('casinoLeaveBtn').style.display = 'block';
    }
  }

  function closeCasino(){
    document.getElementById('casinoScreen').classList.remove('active');
    const onDone = casinoOnDone;
    casinoOnDone = null;
    onDone();
  }

  // ---------- POKESTOP CASINO (Token Slot Machine + Token Shop) ----------
  // Unlocked once the endgame opens — 8th badge, or reaching the Cruise Ship,
  // whichever comes first (in practice the Cruise Ship is only reachable
  // after the 8th badge anyway, so this is really just the badge check, kept
  // explicit to match the original request).
  function pokestopCasinoUnlocked(){
    return runBadges >= BADGES_TO_UNLOCK_ENDGAME || cruiseStageIndex !== null;
  }

  function openPokestopCasino(){
    document.getElementById('pokestopScreen').classList.remove('active');
    document.getElementById('tokenCasinoScreen').classList.add('active');
    document.getElementById('tokenCasinoGrid').querySelectorAll('.token-slot-cell').forEach(c => c.textContent = '?');
    document.getElementById('tokenCasinoWinBanner').style.display = 'none';
    document.getElementById('tokenCasinoPayout').textContent = '0';
    document.getElementById('tokenCasinoLog').innerHTML = '';
    document.getElementById('tokenCasinoSpinBtn').onclick = spinTokenSlots;
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
    spinBtn.textContent = `PULL THE LEVER (${CASINO_SPIN_COST_GOLD}G)`;
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

  // Cherries pay out by count present across the 3 reels (not a straight
  // 3-of-a-kind like every other symbol) — 1 cherry is a small consolation
  // payout, 2 or 3 is the next tier up. See the payout table this was
  // designed against for why cherries alone work this way.
  function resolveCasinoCherryPayout(rolled){
    const cherries = rolled.filter(r => r.name === 'cherry').length;
    if(cherries >= 2) return CASINO_CHERRY_2PLUS_PAYOUT;
    if(cherries === 1) return CASINO_CHERRY_1_PAYOUT;
    return 0;
  }

  // Active only while a spin is in flight — null the rest of the time.
  // Keeping this as shared state (rather than local closures per spin) is
  // what makes it easy to later let the STOP buttons call stopReel(reel)
  // directly instead of only the auto-stop timers below.
  let tokenSlotSpinState = null;

  function rollReelColumn(){
    return [pickWeighted(CASINO_TOKEN_SYMBOLS), pickWeighted(CASINO_TOKEN_SYMBOLS), pickWeighted(CASINO_TOKEN_SYMBOLS)];
  }

  function spinTokenSlots(){
    if(tokenSlotSpinState || META.gold < CASINO_SPIN_COST_GOLD) return;
    META.gold -= CASINO_SPIN_COST_GOLD;
    saveMeta();

    document.getElementById('tokenCasinoSpinBtn').disabled = true;
    document.getElementById('tokenCasinoPayout').textContent = '0';
    document.getElementById('tokenCasinoWinBanner').style.display = 'none';
    renderTokenCasinoState();

    const finalColumns = [rollReelColumn(), rollReelColumn(), rollReelColumn()];
    tokenSlotSpinState = {
      finalColumns,
      cycleTimers: [null, null, null],
      reelsLocked: [false, false, false],
    };

    // Each reel flickers through random symbols independently while "spinning".
    for(let reel = 0; reel < 3; reel++){
      const cells = document.querySelectorAll(`.token-slot-col[data-reel="${reel}"] .token-slot-cell`);
      tokenSlotSpinState.cycleTimers[reel] = setInterval(() => {
        cells.forEach(c => { c.textContent = pickWeighted(CASINO_TOKEN_SYMBOLS).symbol; });
      }, TOKEN_SLOT_CYCLE_MS);
    }

    // Auto-stop, left to right, with a short delay between each — this is
    // the "simplest first" mode requested. A manual stop just needs to call
    // stopReel(reel) earlier (e.g. from the disabled STOP buttons) instead.
    [0, 1, 2].forEach(reel => {
      setTimeout(() => stopReel(reel), TOKEN_SLOT_REEL_STOP_INTERVAL * (reel + 1));
    });
  }

  // Locks one reel onto its final 3 symbols. Safe to call more than once
  // (e.g. a manual stop racing the auto-stop timer) — a reel already locked
  // is a no-op. Once all 3 are locked, hands off to payline evaluation.
  function stopReel(reel){
    if(!tokenSlotSpinState || tokenSlotSpinState.reelsLocked[reel]) return;
    const { finalColumns, cycleTimers, reelsLocked } = tokenSlotSpinState;
    clearInterval(cycleTimers[reel]);
    reelsLocked[reel] = true;

    const cells = document.querySelectorAll(`.token-slot-col[data-reel="${reel}"] .token-slot-cell`);
    cells.forEach((c, rowIdx) => {
      c.classList.remove('spin-anim');
      void c.offsetWidth;
      c.classList.add('spin-anim');
      c.textContent = finalColumns[reel][rowIdx].symbol;
    });

    if(reelsLocked.every(Boolean)){
      setTimeout(() => finishTokenSlotSpin(finalColumns), 300);
    }
  }

  // Only the middle row (index 1 — the same row marked `.payline` in the
  // grid) counts. A straight 3-of-a-kind pays out per CASINO_TOKEN_SYMBOLS;
  // cherries are the one exception, paying by how many show up on that row
  // (1 or 2+) rather than needing all 3 to match — see resolveCasinoCherryPayout().
  function finishTokenSlotSpin(finalColumns){
    tokenSlotSpinState = null;
    document.getElementById('tokenCasinoSpinBtn').disabled = false;

    const paylineSymbols = [finalColumns[0][1], finalColumns[1][1], finalColumns[2][1]];
    const allMatch = paylineSymbols[0].name === paylineSymbols[1].name && paylineSymbols[1].name === paylineSymbols[2].name;
    const tokensWon = (allMatch && paylineSymbols[0].name !== 'cherry')
      ? paylineSymbols[0].payout
      : resolveCasinoCherryPayout(paylineSymbols);

    const payoutDisplay = document.getElementById('tokenCasinoPayout');
    const banner = document.getElementById('tokenCasinoWinBanner');
    payoutDisplay.textContent = tokensWon;

    if(tokensWon > 0){
      casinoTokens += tokensWon;
      appendTokenCasinoLog(`${paylineSymbols.map(s=>s.symbol).join(' ')} — you win ${tokensWon} Token${tokensWon===1?'':'s'}!`);
      banner.textContent = tokensWon >= 100 ? '★ JACKPOT ★' : 'WINNER!';
      banner.style.display = 'block';
      banner.classList.remove('win-pop');
      void banner.offsetWidth;
      banner.classList.add('win-pop');
    } else {
      banner.style.display = 'none';
      appendTokenCasinoLog(`${paylineSymbols.map(s=>s.symbol).join(' ')} — no match, better luck next pull.`);
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
          ${item.invKey ? itemIconHTML(item.invKey) : ''}
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
      const pool = tokenExchangePool();
      const won = pool.length ? { ...pick(pool), is_shiny:true } : null;
      if(won){
        if(activeTeam.length < MAX_PARTY_SIZE) activeTeam.push(won); else storage_.push(won);
        flagComputerNotification(won.name);
        appendTokenCasinoLog(`✨ Token Exchange: a shiny ${displayName(won.name)} joins your team!`);
      }
    } else {
      inv[item.invKey] = (inv[item.invKey] || 0) + 1;
      appendTokenCasinoLog(`Exchanged Tokens for a ${item.label}.`);
    }
    renderTokenCasinoState();
    renderTokenShop();
  }

  // ---------- CRUISE CASINO MINI-EVENT: FISHING ----------
  let fishingCastsLeft, fishingOnDone;

  function openFishing(onDone){
    fishingCastsLeft = FISHING_CASTS;
    fishingOnDone = onDone;
    document.getElementById('fishingLog').innerHTML = '';
    document.getElementById('fishingLeaveBtn').style.display = 'none';
    document.getElementById('fishingCastBtn').style.display = 'block';
    document.getElementById('fishingScreen').classList.add('active');
    renderFishingState();
    document.getElementById('fishingCastBtn').onclick = castFishingLine;
    document.getElementById('fishingLeaveBtn').onclick = closeFishing;
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
    if(fishingCastsLeft <= 0) return;
    fishingCastsLeft--;

    if(Math.random() < FISHING_CATCH_CHANCE){
      const waterPool = wildPool().filter(p => !p.legendary && p.types.includes('water'));
      const caughtMon = waterPool.length ? pick(waterPool) : null;
      if(caughtMon){
        catchWildTarget(caughtMon);
        appendFishingLog(`Something bit! You reeled in a wild ${displayName(caughtMon.name)}, caught, no Pokéball needed!`, true);
      } else {
        appendFishingLog(`You felt a tug, but it slipped away...`);
      }
    } else {
      appendFishingLog(`No bites this time...`);
    }

    renderFishingState();
    if(fishingCastsLeft <= 0){
      document.getElementById('fishingCastBtn').style.display = 'none';
      document.getElementById('fishingLeaveBtn').style.display = 'block';
    }
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
        catchWildTarget(safariTargetMon);
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
      continueFn = () => { closePokeStopScreen(); cruiseStageIndex = null; eliteIndex = 0; startEliteBattle(); };
    } else if(pokestopMode === 'preElite'){
      heading = `ELITE FOUR · ${eliteIndex + 1}/${ELITE_FOUR.length}`;
      intro = `You beat <b>${battle.trainer.name}</b>! Full 6-vs-6 battles ahead, stock up. Gold: <span class="gold-text">${META.gold}G</span>`;
      continueLabel = eliteIndex + 1 < ELITE_FOUR.length ? `CHALLENGE ${ELITE_FOUR[eliteIndex].name.toUpperCase()}` : 'FACE THE FINAL ELITE FOUR MEMBER';
      continueFn = () => { closePokeStopScreen(); startEliteBattle(); };
    } else if(runBadges >= BADGES_TO_UNLOCK_ENDGAME && !legendaryHandled){
      heading = 'THE PATH OPENS...';
      intro = `You beat <b>${battle.trainer.name}</b> and earned your 8th Badge! A Legendary stirs ahead. Gold: <span class="gold-text">${META.gold}G</span> · Badges: ${runBadges}/${BADGES_TO_UNLOCK_ENDGAME}`;
      continueLabel = 'SEEK THE LEGENDARY';
      continueFn = () => { closePokeStopScreen(); startLegendaryBattle(); };
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
    if(casinoBtn) casinoBtn.style.display = pokestopCasinoUnlocked() ? 'inline-block' : 'none';

    const cruiseNav = document.getElementById('cruiseCasinoNav');
    const inCruiseCasino = pokestopMode === 'cruiseCasino';
    cruiseNav.style.display = inCruiseCasino ? 'flex' : 'none';
    if(inCruiseCasino){
      // Each mini-event is a one-shot for the entire run (see cruiseMiniEventUsed
      // — only cleared on a fresh run, not on re-visiting the Cruise Casino).
      const fishingBtn = document.getElementById('cruiseFishingBtn');
      const slotsBtn = document.getElementById('cruiseSlotsBtn');
      fishingBtn.disabled = cruiseMiniEventUsed.fishing;
      slotsBtn.disabled = cruiseMiniEventUsed.slots;
      fishingBtn.onclick = () => {
        cruiseMiniEventUsed.fishing = true;
        closePokeStopScreen();
        openFishing(() => openPokeStop('cruiseCasino'));
      };
      slotsBtn.onclick = () => {
        cruiseMiniEventUsed.slots = true;
        closePokeStopScreen();
        openCasino(() => openPokeStop('cruiseCasino'));
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
    const items = Object.values(POKESTOP_SHOP_ITEMS).filter(item => item.category === pokestopShopTab);
    grid.innerHTML = items.map(item => {
      const lifetimeBought = shopBoughtCounts[item.invKey] || 0;
      const lifetimeMax = effectiveLifetimeMax(item);
      const maxed = (item.max && inv[item.invKey] >= item.max) || (lifetimeMax !== undefined && lifetimeBought >= lifetimeMax);
      const locked = item.lockAfterBadges && runBadges >= item.lockAfterBadges;
      const subLabel = locked ? 'No longer available this run'
        : item.instant ? 'Special Sanctuary'
        : lifetimeMax !== undefined ? `Qty: ${inv[item.invKey]} · Bought ${lifetimeBought}/${lifetimeMax}`
        : `Qty: ${inv[item.invKey]}${item.max ? `/${item.max}` : ''}`;
      const disabled = maxed || locked || META.gold < item.cost;
      const label = maxed ? 'SOLD OUT' : locked ? 'CLOSED' : `BUY · ${item.cost}G`;
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
    if(META.gold < item.cost) return;
    if(item.max && inv[invKey] >= item.max) return;
    const lifetimeMax = effectiveLifetimeMax(item);
    if(lifetimeMax !== undefined && (shopBoughtCounts[invKey] || 0) >= lifetimeMax) return;
    if(item.lockAfterBadges && runBadges >= item.lockAfterBadges) return;
    META.gold -= item.cost;
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
    'leadSelectScreen', 'battleScreen', 'casinoScreen', 'tokenCasinoScreen', 'fishingScreen', 'safariScreen',
    'pokestopScreen', 'teamScreen', 'starterScreen', 'itemFindScreen',
    'legendaryIntroScreen', 'championScreen', 'cruiseTicketWonScreen',
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
    if(inv.fullRevives > 0) entries.push(['Full Revives', inv.fullRevives, 'fullRevives']);
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

  function teamRowHTML(mon, action, idx, disabled, reorderable){
    const isNew = newArrivalNames.includes(mon.name);
    return `<div class="team-mgmt-row ${isNew ? 'new-arrival' : ''}" ${reorderable ? `draggable="true" data-active-idx="${idx}"` : ''}>
      ${reorderable ? '<span class="drag-handle">⠿</span>' : ''}
      ${avatarHTML(mon,'avatar-sm')}
      <div class="team-mgmt-info">
        <span class="tn">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">✨</span>' : ''}${isNew ? ' <span class="new-tag">NEW</span>' : ''}</span>
        <span class="tt" style="color:${TYPE_COLOR[mon.types[0]]}">${mon.types.join(' / ')}</span>
      </div>
      <button class="btn-ghost team-mgmt-btn" data-action="${action}" data-idx="${idx}" ${disabled ? 'disabled' : ''}>${action === 'deposit' ? 'DEPOSIT' : 'WITHDRAW'}</button>
    </div>`;
  }

  let teamDragIdx = null; // index within activeTeam currently being dragged, via the Computer screen

  function renderTeamManagement(){
    document.getElementById('teamActiveCount').textContent = `${activeTeam.length}/${MAX_PARTY_SIZE}`;

    const activeEl = document.getElementById('teamActiveList');
    activeEl.innerHTML = activeTeam.map((mon,i) => teamRowHTML(mon, 'deposit', i, activeTeam.length <= 1, activeTeam.length > 1)).join('');

    renderMegaEvolveSection();

    const storageEl = document.getElementById('teamStorageList');
    storageEl.innerHTML = storage_.length
      ? storage_.map((mon,i) => teamRowHTML(mon, 'withdraw', i, activeTeam.length >= MAX_PARTY_SIZE, false)).join('')
      : '<div class="empty-note">Storage is empty.</div>';

    document.querySelectorAll('.team-mgmt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        if(btn.dataset.action === 'deposit') depositToStorage(idx); else withdrawFromStorage(idx);
      });
    });

    // Click-hold-and-drag reordering of the active team — order here is also
    // the order Pokémon are sent out battle to battle.
    activeEl.querySelectorAll('.team-mgmt-row[data-active-idx]').forEach(row => {
      row.addEventListener('dragstart', () => {
        teamDragIdx = Number(row.dataset.activeIdx);
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => {
        teamDragIdx = null;
        row.classList.remove('dragging');
      });
      row.addEventListener('dragover', e => e.preventDefault());
      row.addEventListener('drop', e => {
        e.preventDefault();
        const dropIdx = Number(row.dataset.activeIdx);
        if(teamDragIdx === null || teamDragIdx === dropIdx) return;
        const [moved] = activeTeam.splice(teamDragIdx, 1);
        activeTeam.splice(dropIdx, 0, moved);
        teamDragIdx = null;
        renderTeamManagement();
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
    const result = performMegaEvolution(idx);
    if(!result) return;
    inv.megaStone--;
    trackItemUsed('megaStone');
    renderTeamManagement();
    const note = document.getElementById('megaEvolveNote');
    note.textContent = `${displayName(result.from.name)} Mega Evolved into ${displayName(result.to.name)}!`;
    note.style.display = 'block';
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
    const abandonBtn = document.getElementById('abandonRunBtn');
    if(abandonBtn) abandonBtn.style.display = 'none';
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
        <input type="text" id="playerNameInput" class="name-input" placeholder="Your name" maxlength="20">
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

    let saved = false;
    async function saveHighscore(){
      if(saved) return;
      saved = true;
      const nameInput = document.getElementById('playerNameInput');
      const name = (nameInput.value || '').trim().slice(0,20) || 'Player';
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
      await saveHighscore(); // fall back to a default name if the player skipped it
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
    const typed = nameInput ? (nameInput.value || '').trim().slice(0,20) : '';
    return typed || 'Player';
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

  // ---------- SHAREABLE RESULT CARD (1080x1920 image, every run) ----------
  // Portrait 9:16 so it drops straight into Instagram Stories / WhatsApp
  // status without cropping. Built purely from in-game colors/assets — no
  // extra artwork needed (reuses the roster avatars + the Master Ball icon
  // for Champion runs).
  async function buildShareCardCanvas(run, score){
    const W = 1080, H = 1920;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const tierMeta = computeTierMeta(run);

    // Background: same dark base as the app, plus two soft brand-color glows
    // (mirrors .start-visual's orb gradient) instead of a flat color.
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#12150f');
    bgGrad.addColorStop(1, '#0a0c0a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    const glow1 = ctx.createRadialGradient(W * 0.18, H * 0.12, 0, W * 0.18, H * 0.12, 640);
    glow1.addColorStop(0, 'rgba(196,244,42,0.16)');
    glow1.addColorStop(1, 'rgba(196,244,42,0)');
    ctx.fillStyle = glow1;
    ctx.fillRect(0, 0, W, H);

    const glow2 = ctx.createRadialGradient(W * 0.85, H * 0.78, 0, W * 0.85, H * 0.78, 700);
    glow2.addColorStop(0, 'rgba(255,107,74,0.14)');
    glow2.addColorStop(1, 'rgba(255,107,74,0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#c4f42a';
    ctx.lineWidth = 8;
    ctx.strokeRect(20, 20, W - 40, H - 40);

    ctx.textAlign = 'center';

    // ---- Header ----
    ctx.fillStyle = '#c4f42a';
    ctx.font = 'bold 46px sans-serif';
    ctx.fillText('DONDOKOMON', W / 2, 130);
    ctx.fillStyle = '#8b9385';
    ctx.font = '30px sans-serif';
    ctx.fillText('RUN COMPLETE', W / 2, 172);

    // ---- Score ----
    ctx.fillStyle = '#c4f42a';
    ctx.font = 'bold 220px sans-serif';
    ctx.fillText(`${score}`, W / 2, 460);
    ctx.fillStyle = '#8b9385';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('FINAL SCORE', W / 2, 510);

    // ---- Tier label + flavor text (wrapped, capped so it never overflows) ----
    ctx.fillStyle = tierMeta.foil === 'foil-perfect' ? '#c4f42a' : '#eef0e7';
    ctx.font = 'bold 42px sans-serif';
    ctx.fillText(tierMeta.label, W / 2, 600);

    ctx.fillStyle = '#c8cdc0';
    ctx.font = '28px sans-serif';
    const flavorLines = wrapCanvasText(ctx, tierMeta.flavor, W - 160).slice(0, 3);
    let y = 650;
    flavorLines.forEach(line => { ctx.fillText(line, W / 2, y); y += 38; });

    // ---- Champion-only Master Ball badge ----
    if(run.champion){
      const mbImg = await loadImageSafe(`${ITEM_ICON_DIR}/${ITEM_ICONS.masterBalls}`);
      const badgeCY = y + 90;
      ctx.fillStyle = 'rgba(196,244,42,0.10)';
      ctx.beginPath();
      ctx.arc(W / 2, badgeCY, 80, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c4f42a';
      ctx.lineWidth = 3;
      ctx.stroke();
      if(mbImg) ctx.drawImage(mbImg, W / 2 - 56, badgeCY - 56, 112, 112);
      y = badgeCY + 110;
    } else {
      y += 20;
    }

    // ---- Team roster (up to 6, two rows of 3) ----
    const roster = (run.activeRoster && run.activeRoster.length ? run.activeRoster : [run.starter]).slice(0, 6);
    const imgs = await Promise.all(roster.map(mon => loadImageSafe(imagePath(mon))));
    const perRow = 3;
    const slotW = (W - 120) / perRow;
    const avatarR = 88;
    const rosterTop = y + 90;
    roster.forEach((mon, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const rowCount = Math.min(perRow, roster.length - row * perRow);
      const rowW = rowCount * slotW;
      const rowStartX = (W - rowW) / 2;
      const cx = rowStartX + slotW * col + slotW / 2;
      const cy = rosterTop + row * (avatarR * 2 + 70);
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
    y = rosterTop + (rosterRows - 1) * (avatarR * 2 + 70) + avatarR + 70;

    // ---- Stat tiles: Badges / Caught / Gold (matches the ranking's trimmed stat set) ----
    const stats = [
      ['BADGES', `${run.badges}`],
      ['CAUGHT', `${run.caught.length}`],
      ['GOLD', `${run.goldEarned}G`],
    ];
    const tileW = (W - 160) / stats.length;
    stats.forEach(([label, value], i) => {
      const cx = 80 + tileW * i + tileW / 2;
      ctx.fillStyle = '#c4f42a';
      ctx.font = 'bold 48px sans-serif';
      ctx.fillText(value, cx, y + 50);
      ctx.fillStyle = '#8b9385';
      ctx.font = '22px sans-serif';
      ctx.fillText(label, cx, y + 84);
    });
    y += 150;

    // ---- Footer: player name + date, then branding ----
    ctx.fillStyle = '#eef0e7';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(`${currentPlayerName()} · Starter: ${displayName(run.starter.name)}`, W / 2, H - 130);
    ctx.fillStyle = '#565f52';
    ctx.font = '24px sans-serif';
    ctx.fillText(new Date().toLocaleDateString(), W / 2, H - 92);
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
      const canvas = await buildShareCardCanvas(run, score);
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

  async function buildHallOfFameCanvas(run, score){
    const W = 800, H = 1000;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, '#12150f');
    bgGrad.addColorStop(1, '#0a0c0a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#c4f42a';
    ctx.lineWidth = 6;
    ctx.strokeRect(12, 12, W - 24, H - 24);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#c4f42a';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText('🏆 HALL OF FAME', W / 2, 90);

    ctx.fillStyle = '#eef0e7';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(`${currentPlayerName()}: Pokémon Champion`, W / 2, 130);

    ctx.font = '15px sans-serif';
    ctx.fillStyle = '#8b9385';
    ctx.fillText(new Date().toLocaleDateString(), W / 2, 154);

    ctx.font = 'bold 60px sans-serif';
    ctx.fillStyle = '#c4f42a';
    ctx.fillText(`${score}`, W / 2, 235);
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#8b9385';
    ctx.fillText('FINAL SCORE', W / 2, 255);

    const roster = (run.activeRoster || []).slice(0, 6);
    const imgs = await Promise.all(roster.map(mon => loadImageSafe(imagePath(mon))));
    const slotW = W / Math.max(roster.length, 1);
    roster.forEach((mon, i) => {
      const cx = slotW * i + slotW / 2;
      const cy = 340;
      ctx.fillStyle = '#12150f';
      ctx.beginPath();
      ctx.arc(cx, cy, 50, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = mon.is_shiny ? '#ffd447' : '#23281f';
      ctx.lineWidth = 3;
      ctx.stroke();
      if(imgs[i]) ctx.drawImage(imgs[i], cx - 40, cy - 40, 80, 80);
      ctx.fillStyle = '#eef0e7';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(mon.name, cx, cy + 68);
    });

    let y = 460;
    ctx.textAlign = 'left';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = '#c4f42a';
    ctx.fillText('ACHIEVEMENTS', 50, y);
    y += 14;
    ctx.strokeStyle = '#23281f';
    ctx.beginPath();
    ctx.moveTo(50, y);
    ctx.lineTo(W - 50, y);
    ctx.stroke();
    y += 34;

    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#eef0e7';
    const achievements = [
      `🏅 ${run.badges} Gym Badge${run.badges===1?'':'s'} earned`,
      `🌟 Legendary encountered`,
      `⚔️ Elite Four cleared: 4/4`,
      `💰 ${run.goldEarned}G earned`,
      `🎯 ${run.caught.length} Pokémon caught`,
      `🥇 Started with ${displayName(run.starter.name)}`,
    ];
    achievements.forEach(line => { ctx.fillText(line, 50, y); y += 32; });

    ctx.textAlign = 'center';
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#565f52';
    ctx.fillText('DONDOKOMON', W / 2, H - 30);

    return canvas;
  }

  async function downloadHallOfFame(run, score){
    const status = document.getElementById('hofStatus');
    const btn = document.getElementById('downloadHofBtn');
    if(btn) btn.disabled = true;
    if(status) status.textContent = 'Building your card...';
    try{
      const canvas = await buildHallOfFameCanvas(run, score);
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
    document.getElementById('rerollBtn').addEventListener('click', rerollWildChoices);
    document.getElementById('cruiseTicketWonBtn').addEventListener('click', boardCruiseShip);
    document.getElementById('pokestopEndRunBtn').addEventListener('click', openEndRunModal);
    document.getElementById('endRunConfirmBtn').addEventListener('click', confirmEndRun);
    document.getElementById('endRunCancelBtn').addEventListener('click', closeEndRunModal);
    document.getElementById('pokestopComputerBtn').addEventListener('click', openTeamManagement);
    document.getElementById('megaStoneHintClose').addEventListener('click', () => {
      document.getElementById('megaStoneHintPopup').style.display = 'none';
    });
    document.getElementById('pokestopCasinoBtn').addEventListener('click', openPokestopCasino);
    document.getElementById('teamBackBtn').addEventListener('click', closeTeamManagement);
    document.getElementById('viewFullRankingBtn').addEventListener('click', openFullRanking);
    document.getElementById('abandonRunBtn').addEventListener('click', openEndRunModal);
    document.getElementById('legendaryBeginBtn').addEventListener('click', confirmLegendaryTeam);
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
