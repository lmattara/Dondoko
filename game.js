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

  const TRAINER_ARCHETYPES = [
    "Youngster Joey","Bug Catcher Rick","Lass Dana","Camper Liam",
    "Picnicker Erin","Fisherman Dale","Hiker Anthony","Cooltrainer Mia",
    "School Kid Alan","Rising Star Theo","Bird Keeper Roy","Ace Trainer Nadia",
    "Sailor Hank","Ranger Cass",
  ];

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
  const ELITE_FOUR = [
    { name:"Elite Four Corvax",  minBst:550, maxBst:620, squadSize:6 },
    { name:"Elite Four Seraphine", minBst:570, maxBst:640, squadSize:6 },
    { name:"Elite Four Draven",  minBst:590, maxBst:660, squadSize:6 },
    { name:"Elite Four Ilyra, the Unbeaten", minBst:610, maxBst:690, squadSize:6 },
  ];
  const ELITE_GOLD_MIN = 100;
  const ELITE_GOLD_MAX = 180;
  // Scarlet & Violet's Paradox Pokémon (10 Ancient, 10 Future) are strong
  // enough to qualify by BST alone, but are excluded from Elite Four squads.
  const PARADOX_POKEMON = [
    "great-tusk","scream-tail","brute-bonnet","flutter-mane","slither-wing",
    "sandy-shocks","roaring-moon","walking-wake","gouging-fire","raging-bolt",
    "iron-treads","iron-bundle","iron-hands","iron-jugulis","iron-moth",
    "iron-thorns","iron-valiant","iron-leaves","iron-boulder","iron-crown",
  ];

  // ---------- CRUISE SHIP (optional, ticket-gated side event) ----------
  // Bought at the PokeStop's Others tab. If bought, right after the
  // Legendary encounter (and before the Elite Four) the player boards the
  // ship: 3 water-type battles of rising difficulty, each followed by a
  // "Cruise Casino" PokeStop (Fishing + Slot Machine mini-events on top of
  // the normal shop), then a Rival battle before finally moving on.
  const CRUISE_TICKET_COST = 300;
  // The last battle is against Captain Sereia, who runs the ship — beating
  // her rewards a Full Revive and a Mega Stone.
  const CRUISE_SHIP_BATTLES = [
    { name:"Deckhand Milo",      minBst:300, maxBst:380, squadSize:2 },
    { name:"First Mate Talise",  minBst:420, maxBst:500, squadSize:3 },
    { name:"Captain Sereia",     minBst:520, maxBst:600, squadSize:4, isCaptain:true },
  ];
  const CRUISE_RIVAL = { name:"Your Rival", minBst:480, maxBst:580, squadSize:4 };
  const CRUISE_GOLD_MIN = 60;
  const CRUISE_GOLD_MAX = 140;
  const RIVAL_GOLD_MIN = 250;
  const RIVAL_GOLD_MAX = 400;

  // JRPG-style dialogue shown right before the Rival battle.
  const RIVAL_DIALOGUE = [
    "So... you actually made it this far. I'm almost impressed.",
    "But this is where your little adventure hits a wall — right here, on this ship.",
    "Let's settle this. No holding back!",
  ];

  const FISHING_CASTS = 5;
  const FISHING_CATCH_CHANCE = 0.18; // per cast — rare, but noticeably better odds than a shiny

  // ---------- SAFARI ZONE (instant mini-event, bought at the PokeStop) ----------
  // Unlike the Cruise Ship Ticket, this fires immediately on purchase: 3
  // back-to-back single-target catch encounters using their own dedicated
  // Safari Balls/Berries/Rocks (not the player's real inventory), then
  // straight back to the same PokeStop screen they bought it from.
  const SAFARI_TICKET_COST = 100;
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
  const WILD_COUNT = 12; // shown as two rows of 6
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
  const BASE_REROLL_COUNT = 1; // free wild-encounter rerolls per run (more buyable at the PokeStop)
  const NATIONAL_DEX_MAX = 1025; // excludes megas/gmax/regional-form duplicates from the pool
  const LOW_TIER_MAX_BST = 320; // caps how strong a route trainer's Pokémon can be
  const FIRST_TRAINER_MAX_BST = 220; // extra-easy cap for the player's very first route trainer fight
  const ROUTE_TRAINER_SQUAD_SIZE = 1; // route trainers are a quick single-Pokémon fight
  const ROUTE_TRAINER_MAX_SQUAD = 3; // cap even late-run route trainers well below a full team
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

  // Safari Zone Rock: risky pre-throw action (see SAFARI ZONE section below) —
  // on success it boosts the next Safari Ball throw; on failure the target flees.
  const SAFARI_ROCK_SUCCESS_CHANCE = 0.55;
  const SAFARI_ROCK_MODIFIER = 1.3;
  const BALL_BASE_FLEE_CHANCE = 0.15; // baseline chance a failed ball throw lets the target flee outright
  const TRAINER_GOLD_MIN = 25;  // 20 + 25%
  const TRAINER_GOLD_MAX = 63;  // 50 + 25%
  const TRAINER_BALL_REWARD = 1; // every route trainer win also grants a free Pokéball
  const GYM_GOLD_MIN = 40; // Gym Leader wins pay out more than route trainers
  const GYM_GOLD_MAX = 90;
  const POTION_HEAL_FRACTION = 0.5;  // heals this fraction of max HP
  const REVIVE_HP_FRACTION = 0.5;    // revived Pokémon comes back at this fraction of max HP

  // Ball throw modifiers — multiply directly against the target's base_species_rate.
  // Master Ball bypasses the formula entirely (guaranteed catch).
  const BALL_MODIFIERS = { balls:1.0, greatBalls:1.5, ultraBalls:2.0, masterBalls:Infinity };
  const BALL_LABELS = { balls:"Pokéball", greatBalls:"Great Ball", ultraBalls:"Ultra Ball", masterBalls:"Master Ball" };

  // Food items: single-use, stackable, bought at the PokeStop. Each boost is a
  // multiplicative catch-chance modifier; flee reduction only matters on a
  // failed throw (see BALL_BASE_FLEE_CHANCE).
  const FOOD_ITEMS = {
    berrySnack:  { label:"Berry Snack",  cost:50,  boost:1.10, fleeReduction:0,    noCritFlee:false },
    pokeTreat:   { label:"Poke Treat",   cost:150, boost:1.25, fleeReduction:0.10, noCritFlee:false },
  };

  // PokeStop shop (mid-run): one-off consumables added straight to the current run's inventory.
  // `category` sorts each item into one of the PokeStop's 3 shop tabs.
  const POKESTOP_SHOP_ITEMS = {
    balls:       { label:"Pokéball",     invKey:"balls",       cost:10,  category:"balls" },
    greatBalls:  { label:"Great Ball",   invKey:"greatBalls",  cost:25,  category:"balls" },
    ultraBalls:  { label:"Ultra Ball",   invKey:"ultraBalls",  cost:45,  category:"balls" },
    berrySnack:  { label:"Berry Snack",  invKey:"berrySnack",  cost:50,  category:"items" },
    pokeTreat:   { label:"Poke Treat",   invKey:"pokeTreat",   cost:150, category:"items" },
    potions:     { label:"Potion",       invKey:"potions",     cost:15,  category:"items" },
    revives:     { label:"Revive",       invKey:"revives",     cost:30,  category:"items" },
    rerollTickets: { label:"Reroll Ticket", invKey:"rerollTickets", cost:40, category:"others" },
    cruiseTicket: { label:"Cruise Ship Ticket", invKey:"cruiseTicket", cost:CRUISE_TICKET_COST, category:"others", max:1 },
    safariTicket: { label:"Safari Zone Ticket", invKey:"safariTicket", cost:SAFARI_TICKET_COST, category:"others", instant:true, lockAfterBadges:8 },
  };
  const SHOP_TABS = [
    { key:"balls",  label:"Pokéballs" },
    { key:"items",  label:"Itens" },
    { key:"others", label:"Others" },
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
  };
  function itemIconHTML(invKey){
    const file = ITEM_ICONS[invKey];
    return file ? `<img class="item-icon" src="${ITEM_ICON_DIR}/${file}" alt="" onerror="this.style.display='none'">` : '';
  }

  // ---------- DATA (populated from /data/*.json) ----------
  let POKEMON = [];       // {id, name, types, bst, legendary, hp, attack, defense, sp_atk, sp_def, speed, base_species_rate}
  let POKEMON_BY_NAME = {};
  let MOVESETS = {};      // name -> [{name,type,power,accuracy,damage_class}, ...]
  let EVOLUTIONS = {};    // name -> next evolution's name (absent if none)
  let MEGA_FORMS_BY_BASE = {}; // base species name -> [mega form names] (e.g. "charizard" -> ["charizard-mega-x","charizard-mega-y"])

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

    MEGA_FORMS_BY_BASE = {};
    list.forEach(p => {
      let base = null;
      if(p.name.endsWith('-mega')) base = p.name.slice(0, -5);
      else if(/-mega-(x|y)$/.test(p.name)) base = p.name.replace(/-mega-(x|y)$/, '');
      if(base && POKEMON_BY_NAME[base]){
        (MEGA_FORMS_BY_BASE[base] = MEGA_FORMS_BY_BASE[base] || []).push(p.name);
      }
    });
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
  // Composite score: badges matter most, then trainer wins, then catches, then gold.
  function computeScore(run){
    return run.badges*100 + run.trainersBeaten*25 + run.caught.length*15 + run.goldEarned;
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
    const starterName = typeof r.starter === 'string' ? r.starter : (r.starter && r.starter.name) || '?';
    return `
      <button class="best-row" data-idx="${idx}">
        <div class="best-rank">${rank}</div>
        <div class="best-name">${r.name || 'Player'} · ${starterName} · ${r.badges} badge${r.badges===1?'':'s'} · ${r.caughtCount} caught · <span class="gold-text">${r.goldEarned}G</span></div>
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
      listEl.textContent = 'Not enough runs yet — check back once more players have set a highscore.';
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
    if(entry.champion) statusLine = `<span style="color:var(--lime)">Became Pokémon Champion — Elite Four cleared!${itemIconHTML('masterBalls').replace('item-icon', 'item-icon trophy-icon-inline')}</span>`;
    else if(entry.trainerLoss) statusLine = `Lost to ${entry.trainerLoss}.`;
    else if(entry.eliteBeaten > 0) statusLine = `Reached the Elite Four — ${entry.eliteBeaten}/4 beaten.`;
    else if(entry.legendaryHandled) statusLine = `Faced the Legendary (${entry.legendaryHandled === 'caught' ? 'caught it' : 'it fled'}).`;
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
          <div class="credit-line">Started with <b>${starterMon ? starterMon.name : '—'}</b></div>
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

  // ---------- STARTER SELECT / RUN STATE ----------
  let starter, activeTeam, storage_, inv, encounterNum;
  let runTrainersBeaten, runBadges, runChampion, runGoldEarned, trainerLoss, legendaryHandled;
  let pendingEvolution; // set on a Gym Leader win, revealed on the next PokeStop screen
  let runBeatenBadges; // Set of badge keys already challenged (and beaten) this run
  let eliteIndex; // how many of the 4 Elite Four members have been beaten this run
  let firstGymBonusEncounterUsed; // one-time bonus wild encounter before the 1st Gym Leader challenge
  let cruiseStageIndex; // null outside the Cruise Ship; 0-2 = next ship battle; 3 = rival is next
  let cruiseMiniEventUsed; // { fishing, slots } — each resets fresh at every new Cruise Casino stop

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
      runTrainersBeaten, runBadges, runChampion, runGoldEarned, trainerLoss, legendaryHandled,
      runBeatenBadges: Array.from(runBeatenBadges || []),
      eliteIndex, firstGymBonusEncounterUsed,
      cruiseStageIndex, cruiseMiniEventUsed,
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
    try{ localStorage.setItem(RUN_SAVE_KEY, JSON.stringify(serializeRun())); }catch(e){}
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
    runBeatenBadges = new Set(saved.runBeatenBadges || []);
    eliteIndex = saved.eliteIndex || 0;
    firstGymBonusEncounterUsed = !!saved.firstGymBonusEncounterUsed;
    cruiseStageIndex = (typeof saved.cruiseStageIndex === 'number') ? saved.cruiseStageIndex : null;
    cruiseMiniEventUsed = saved.cruiseMiniEventUsed || { fishing:false, slots:false };
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
    inv = {
      balls: BASE_BALL_COUNT + META.extraBalls,
      greatBalls: 0, ultraBalls: 0, masterBalls: 0,
      berrySnack: 0, pokeTreat: 0,
      potions: 0, revives: 0, fullRevives: 0,
      rerollTickets: BASE_REROLL_COUNT, // 1 free reroll per run; more can be bought at the PokeStop
      cruiseTicket: 0,
      megaStone: 0,
    };
    encounterNum = 1;
    runTrainersBeaten = 0;
    runBadges = 0;
    runChampion = false;
    runGoldEarned = 0;
    trainerLoss = null;
    legendaryHandled = false; // false | 'caught' | 'fled'
    pendingEvolution = null;
    runBeatenBadges = new Set();
    eliteIndex = 0;
    firstGymBonusEncounterUsed = false;
    cruiseStageIndex = null;
    cruiseMiniEventUsed = { fishing:false, slots:false };
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
      && !activeTeam.some(c => c.name === p.name)
      && !storage_.some(c => c.name === p.name));
  }

  function wildEasyPool(){
    return wildPool().filter(p => (p.base_species_rate ?? 0) >= EASY_CATCH_RATE_MIN);
  }

  function wildStrongPool(){
    return wildPool().filter(p => p.bst >= WILD_STRONG_MIN_BST);
  }

  // Builds this encounter's 6 wild choices. Early on it's all easy-to-catch
  // Pokémon; as encounters go by, easy slots progressively give way to the
  // full pool (rarer, tougher catches), while always keeping at least one
  // easy option available. Past 4 badges earned this run, the ramp steepens
  // further and non-easy slots preferentially pull from the strong pool.
  function pickWildChoices(){
    const full = wildPool();
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

    return pickN([...chosenEasy, ...rest], chosenEasy.length + rest.length); // shuffled combined order
  }

  function startEncounter(){
    document.getElementById('encounterNum').textContent = encounterNum;
    document.getElementById('starterName').textContent = starter.name;

    // Always show a wild Pokémon encounter before the trainer, even with no
    // Pokéballs left — the catch screen offers a "walk away" out in that case.
    wildChoices = pickWildChoices().map(mon =>
      Math.random() < SHINY_CHANCE ? { ...mon, is_shiny:true } : mon
    );

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
    wildChoices = pickWildChoices().map(mon =>
      Math.random() < SHINY_CHANCE ? { ...mon, is_shiny:true } : mon
    );
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
    appendCatchLog(`Out of Pokéballs — you leave ${displayName(target.name)} alone and move on.`);
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
      <p class="tagline">As Champion, you're awarded a <b>Master Ball</b> — guaranteed to catch anything, no exceptions.</p>
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
      beatenBadges: Array.from(runBeatenBadges), eliteBeaten: eliteIndex, legendaryHandled,
      activeRoster: activeTeam.slice(), // the final active team, in order — for the spotlight + Hall of Fame card
    });
  }

  // ---------- TRAINER BATTLE ----------
  let battle;

  function currentPartySize(){ return activeTeam.length; }

  function rollTrainer(){
    // The player's very first route trainer fight this run gets an extra-easy
    // cap, giving a fresh starter better odds before it's had a chance to grow.
    const maxBst = encounterNum === 1 ? FIRST_TRAINER_MAX_BST : LOW_TIER_MAX_BST;
    const pool = wildPool().filter(p => p.bst <= maxBst);
    // Past 3 badges, route trainers start fielding more than 1 Pokémon —
    // +1 for every 3 badges earned, capped and still limited by party size.
    const squadSize = Math.min(
      ROUTE_TRAINER_SQUAD_SIZE + Math.floor(runBadges / 3),
      ROUTE_TRAINER_MAX_SQUAD,
      currentPartySize()
    );
    return { name: pick(TRAINER_ARCHETYPES), squad: pickN(pool, squadSize), isGym:false };
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
    const pool = wildPool().filter(p => p.bst >= tier.minBst && p.bst <= tier.maxBst && !PARADOX_POKEMON.includes(p.name));
    // Elite Four squads are always full strength (6 Pokémon) regardless of
    // the player's own active roster size — unlike route/gym trainers, they
    // never scale down to match the player.
    const squadSize = tier.squadSize;
    return { name: tier.name, squad: pickN(pool, squadSize), isElite:true, isFinalElite: !!isFinal };
  }

  // Cruise Ship battles are all Water-type, falling back to the untyped
  // strength band if too few Water-types qualify (same pattern as gym badges).
  function rollCruiseBattle(tier){
    const pool = wildPool().filter(p => p.bst >= tier.minBst && p.bst <= tier.maxBst);
    const waterPool = pool.filter(p => p.types.includes('water'));
    const squadSize = Math.min(tier.squadSize, currentPartySize());
    const finalPool = waterPool.length >= squadSize ? waterPool : pool;
    return { name: tier.name, squad: pickN(finalPool, squadSize), isCruise:true, isCaptain: !!tier.isCaptain };
  }

  function rollCruiseRival(){
    const pool = wildPool().filter(p => p.bst >= CRUISE_RIVAL.minBst && p.bst <= CRUISE_RIVAL.maxBst);
    const squadSize = Math.min(CRUISE_RIVAL.squadSize, currentPartySize());
    return { name: CRUISE_RIVAL.name, squad: pickN(pool, squadSize), isRival:true };
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
      const nextName = EVOLUTIONS[mon.name];
      if(nextName && POKEMON_BY_NAME[nextName]) eligibleIdx.push(idx);
    });
    if(!eligibleIdx.length) return rollRandomMegaEvolution();
    const idx = pick(eligibleIdx);
    const currentMon = activeTeam[idx];
    const evolvedBase = POKEMON_BY_NAME[EVOLUTIONS[currentMon.name]];
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

  // One-time, unrepeatable Legendary encounter — unlocked after the 8th
  // badge, gates access to the Elite Four. Shows a lore/intro screen first
  // and requires picking exactly 3 Pokémon (fewer only if the active team
  // itself has fewer than 3) — a restriction that applies to this single
  // battle only, since `activeTeam` itself is never modified.
  const LEGENDARY_SQUAD_CAP = 3;
  let legendaryPendingMon = null;
  let legendarySelectedIdx = [];

  function startLegendaryBattle(){
    const legendaryPool = POKEMON.filter(p => p.legendary && p.id <= NATIONAL_DEX_MAX);
    const legendaryMon = pick(legendaryPool);
    openLegendaryIntro(legendaryMon);
  }

  function legendaryLoreText(mon){
    const typeLabel = mon.types.map(t => t[0].toUpperCase() + t.slice(1)).join('/');
    return `A Legendary ${typeLabel}-type Pokémon of immense, rarely-witnessed power. Encounters like this happen once in a lifetime — choose your team wisely.`;
  }

  function openLegendaryIntro(mon){
    legendaryPendingMon = mon;
    legendarySelectedIdx = [];
    document.getElementById('legendaryIntroScreen').classList.add('active');
    renderLegendaryIntro();
  }

  function legendaryPickRequired(){
    return Math.min(LEGENDARY_SQUAD_CAP, activeTeam.length);
  }

  function renderLegendaryIntro(){
    const mon = legendaryPendingMon;
    const required = legendaryPickRequired();

    document.getElementById('legendaryIntroName').textContent = displayName(mon.name);
    document.getElementById('legendaryIntroArt').innerHTML = avatarHTML(mon);
    document.getElementById('legendaryIntroTypes').innerHTML = typeChipsHTML(mon.types);
    document.getElementById('legendaryIntroDesc').textContent = legendaryLoreText(mon);

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
    document.getElementById('legendaryIntroScreen').classList.remove('active');
    beginBattle({ name: mon.name, squad: [mon], isGym:false, isLegendary:true }, chosen);
  }

  // Elite Four: four full 6-vs-6 battles fought back to back. Beating the
  // last one makes the player Champion.
  function startEliteBattle(){
    beginBattle(rollEliteMember(ELITE_FOUR[eliteIndex], eliteIndex === ELITE_FOUR.length - 1));
  }

  // ---------- CRUISE SHIP ----------
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
  function beginBattle(opponent, playerOverride){
    revivePickerOpen = false; // reset in case a previous battle left it open
    const order = playerOverride || activeTeam.slice(0, MAX_PARTY_SIZE);
    battle = {
      trainer: opponent,
      player: order.map(makeBattler),
      enemy: opponent.squad.map(makeBattler),
      pIdx: 0, eIdx: 0,
      resolving: false,
      nextTimerId: null,
      awaitingSwitch: false,
      over: false,
      eliteAiPotionsUsed: 0, // Elite Four AI Potion uses this battle (max 2)
      eliteAiRevived: false, // final Elite Four member's one-time AI Revive
    };

    document.getElementById('encounterScreen').classList.remove('active');
    document.getElementById('catchScreen').classList.remove('active');
    document.getElementById('battleMoveLog').innerHTML = '';
    document.getElementById('battleContinueBtn').style.display = 'none';
    document.getElementById('battleScreen').classList.add('active');
    document.getElementById('battleScreen').classList.toggle('gym-battle', !!opponent.isGym);
    document.getElementById('battleScreen').classList.toggle('legendary-battle', !!opponent.isLegendary);
    document.getElementById('battleScreen').classList.toggle('elite-battle', !!opponent.isElite);
    document.getElementById('battleScreen').classList.toggle('cruise-battle', !!(opponent.isCruise || opponent.isRival));

    const subText = opponent.isGym
      ? `Badge ${runBadges + 1}/${BADGES_TO_UNLOCK_ENDGAME} this run · ${opponent.squad.length} Pokémon.`
      : opponent.isLegendary
        ? `A wild Legendary appeared! One shot only — it won't come back this run.`
        : opponent.isElite
          ? `Elite Four · Member ${eliteIndex + 1}/${ELITE_FOUR.length} · full ${opponent.squad.length}-vs-6 battle.`
          : opponent.isRival
            ? `🚢 Your rival challenges you aboard the Cruise Ship! ${opponent.squad.length} Pokémon.`
            : opponent.isCruise
              ? `🚢 Cruise Ship battle! ${opponent.squad.length} Pokémon.`
              : `Encounter ${encounterNum} · a route trainer wants to battle! ${opponent.squad.length} Pokémon.`;

    document.getElementById('battleHead').innerHTML = `
      <div class="battle-name">${displayName(opponent.name)}</div>
      <div class="battle-sub">${subText}</div>
    `;
    appendBattleLog(`${displayName(opponent.name)} sends out ${displayName(battle.enemy[0].mon.name)}!`, '', 'info');
    appendBattleLog(`Go, ${displayName(battle.player[0].mon.name)}!`, '', 'info');
    renderHpPanel();
    renderBattleControls();
    battle.nextTimerId = setTimeout(battleStep, 900);
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
    battle.nextTimerId = setTimeout(battleStep, 700);
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

  function renderBattleItemsPanel(){
    const panel = document.getElementById('bagPanel');
    if(!panel || !battle) return;
    const busy = battle.over || battle.resolving;
    const activePlayer = battle.player[battle.pIdx];
    const canHeal = !busy && !revivePickerOpen && activePlayer && activePlayer.hp > 0 && activePlayer.hp < activePlayer.maxHp && inv.potions > 0;
    const faintedCount = battle.player.filter(b => b.hp <= 0).length;
    const totalRevives = inv.revives + (inv.fullRevives || 0);
    const canRevive = !busy && !revivePickerOpen && faintedCount > 0 && totalRevives > 0;

    panel.innerHTML = `
      <div class="bag-items-row">
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
      battle.nextTimerId = setTimeout(battleStep, 700);
    }
  }

  function usePotion(){
    if(!battle || battle.over || battle.resolving) return;
    const activePlayer = battle.player[battle.pIdx];
    if(!activePlayer || activePlayer.hp <= 0 || activePlayer.hp >= activePlayer.maxHp || inv.potions <= 0) return;
    if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
    inv.potions--;
    const healed = Math.round(activePlayer.maxHp * POTION_HEAL_FRACTION);
    activePlayer.hp = Math.min(activePlayer.maxHp, activePlayer.hp + healed);
    appendBattleLog(`Used a Potion on ${displayName(activePlayer.mon.name)}.`, `Recovered ${healed} HP.`, 'info');
    renderHpPanel();
    if(!battle.over && !battle.awaitingSwitch) battle.nextTimerId = setTimeout(battleStep, 700);
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
      target.hp = target.maxHp;
      appendBattleLog(`${displayName(target.mon.name)} was fully revived!`, `Back up at full HP.`, 'info');
    } else {
      inv.revives--;
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
    battle.nextTimerId = setTimeout(battleStep, 700);
  }

  function endBattle(won){
    battle.over = true;
    const isGym = battle.trainer.isGym;
    const isLegendary = battle.trainer.isLegendary;
    const isElite = battle.trainer.isElite;
    const isCruise = battle.trainer.isCruise;
    const isRival = battle.trainer.isRival;
    appendBattleLog(
      won ? `${battle.trainer.name} is out of usable Pokémon. You won!` : `Your team fainted... ${battle.trainer.name} wins.`,
      '', won ? 'win' : 'out'
    );

    if(isLegendary){
      legendaryHandled = won ? 'caught' : 'fled';
      if(won){
        const legendaryMon = battle.enemy[0].mon;
        storage_.push(legendaryMon);
        flagComputerNotification(legendaryMon.name);
        appendBattleLog(`${displayName(legendaryMon.name)} was defeated and sent to your Storage!`, '', 'win');
      } else {
        appendBattleLog(`${displayName(battle.enemy[0].mon.name)} fled! You won't get another shot at it this run.`, '', 'out');
      }
    } else if(won){
      if(isElite){
        eliteIndex++;
        const goldWon = randInt(ELITE_GOLD_MIN, ELITE_GOLD_MAX);
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
        const goldWon = randInt(CRUISE_GOLD_MIN, CRUISE_GOLD_MAX);
        runGoldEarned += goldWon;
        META.gold += goldWon;
        saveMeta();
        appendBattleLog(`${battle.trainer.name} is out of Pokémon! +${goldWon}G.`, '', 'win');
        if(battle.trainer.isCaptain){
          inv.fullRevives = (inv.fullRevives || 0) + 1;
          inv.megaStone = (inv.megaStone || 0) + 1;
          flagComputerNotification();
          appendBattleLog(`Captain Sereia hands you a Full Revive and a Mega Stone!`, '', 'win');
        }
      } else if(isRival){
        const goldWon = randInt(RIVAL_GOLD_MIN, RIVAL_GOLD_MAX);
        runGoldEarned += goldWon;
        META.gold += goldWon;
        saveMeta();
        appendBattleLog(`You bested your rival! +${goldWon}G.`, '', 'win');
        pendingEvolution = evolveRandomEligible();
        if(pendingEvolution){
          appendBattleLog(pendingEvolution.isMega ? `Something on your team is Mega Evolving...` : `Something on your team is evolving...`, '', 'win');
        }
      } else {
        const goldWon = isGym ? randInt(GYM_GOLD_MIN, GYM_GOLD_MAX) : randInt(TRAINER_GOLD_MIN, TRAINER_GOLD_MAX);
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
    const wasElite = battle.trainer.isElite;
    const wasCruise = battle.trainer.isCruise;
    const wasRival = battle.trainer.isRival;

    if(wasLegendary){
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
      cruiseMiniEventUsed = { fishing:false, slots:false }; // fresh stop — both mini-events available again
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

      let text = `JACKPOT-ish! ${symbol.symbol}${symbol.symbol}${symbol.symbol} — you win ${goldWon}G!`;
      if(symbol.strongMon){
        const strongPool = wildPool().filter(p => p.bst >= CASINO_STRONG_MON_MIN_BST);
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
      appendCasinoLog(`${rolled.map(r=>r.symbol).join(' ')} — no match, better luck next pull.`);
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
        appendFishingLog(`Something bit! You reeled in a wild ${displayName(caughtMon.name)} — caught, no Pokéball needed!`, true);
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
    safariTargetMon = pick(wildPool());
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
    appendSafariLog(`That's the end of your Safari Zone visit — heading back to the PokeStop.`);
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
    } else if(pokestopMode === 'legendary'){
      heading = 'A LEGENDARY STIRRED...';
      intro = legendaryHandled === 'caught'
        ? `You defeated it! It's waiting in Storage — use the Computer to add it to your active team. Gold: <span class="gold-text">${META.gold}G</span> · Badges: ${runBadges}`
        : `It got away. That was your only shot at it this run. Gold: <span class="gold-text">${META.gold}G</span> · Badges: ${runBadges}`;
      if(inv.cruiseTicket > 0){
        continueLabel = '🚢 BOARD THE CRUISE SHIP';
        continueFn = () => { closePokeStopScreen(); cruiseStageIndex = 0; startCruiseBattle(); };
      } else {
        continueLabel = 'FACE THE ELITE FOUR';
        continueFn = () => { closePokeStopScreen(); eliteIndex = 0; startEliteBattle(); };
      }
    } else if(pokestopMode === 'cruiseCasino'){
      const nextIsCaptain = cruiseStageIndex < CRUISE_SHIP_BATTLES.length && CRUISE_SHIP_BATTLES[cruiseStageIndex].isCaptain;
      const nextIsBattle = cruiseStageIndex < CRUISE_SHIP_BATTLES.length;
      heading = '🚢 CRUISE CASINO';
      intro = `You beat <b>${battle.trainer.name}</b>! Stock up, try your luck, or press on. Gold: <span class="gold-text">${META.gold}G</span>`;
      continueLabel = !nextIsBattle ? 'FACE YOUR RIVAL' : nextIsCaptain ? 'CHALLENGE THE CAPTAIN' : 'CHALLENGE THE SAILOR';
      continueFn = () => {
        closePokeStopScreen();
        if(cruiseStageIndex < CRUISE_SHIP_BATTLES.length) startCruiseBattle();
        else openRivalChallenge();
      };
    } else if(pokestopMode === 'cruiseComplete'){
      heading = 'RIVAL DEFEATED!';
      intro = `You beat <b>${battle.trainer.name}</b> and it feels great. The ship docks — time to head for the Elite Four. Gold: <span class="gold-text">${META.gold}G</span>`;
      continueLabel = 'FACE THE ELITE FOUR';
      continueFn = () => { closePokeStopScreen(); cruiseStageIndex = null; eliteIndex = 0; startEliteBattle(); };
    } else if(pokestopMode === 'preElite'){
      heading = `ELITE FOUR · ${eliteIndex + 1}/${ELITE_FOUR.length}`;
      intro = `You beat <b>${battle.trainer.name}</b>! Full 6-vs-6 battles ahead — stock up. Gold: <span class="gold-text">${META.gold}G</span>`;
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

    const cruiseNav = document.getElementById('cruiseCasinoNav');
    const inCruiseCasino = pokestopMode === 'cruiseCasino';
    cruiseNav.style.display = inCruiseCasino ? 'flex' : 'none';
    if(inCruiseCasino){
      // Each mini-event is a one-shot per Cruise Casino stop — the flags are
      // reset only when a fresh stop begins (see afterBattle()'s wasCruise
      // branch), not when returning from the mini-event itself.
      const fishingBtn = document.getElementById('cruiseFishingBtn');
      const slotsBtn = document.getElementById('cruiseSlotsBtn');
      fishingBtn.disabled = cruiseMiniEventUsed.fishing;
      slotsBtn.disabled = cruiseMiniEventUsed.slots;
      fishingBtn.onclick = () => {
        cruiseMiniEventUsed.fishing = true;
        openFishing(() => openPokeStop('cruiseCasino'));
      };
      slotsBtn.onclick = () => {
        cruiseMiniEventUsed.slots = true;
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

  function renderPokestopShopGrid(){
    const grid = document.getElementById('pokestopShopGrid');
    const items = Object.values(POKESTOP_SHOP_ITEMS).filter(item => item.category === pokestopShopTab);
    grid.innerHTML = items.map(item => {
      const maxed = item.max && inv[item.invKey] >= item.max;
      const locked = item.lockAfterBadges && runBadges >= item.lockAfterBadges;
      const subLabel = locked ? 'No longer available this run' : item.instant ? 'One-time mini-event' : `Have: ${inv[item.invKey]}`;
      const disabled = maxed || locked || META.gold < item.cost;
      const label = maxed ? 'BOOKED' : locked ? 'CLOSED' : `BUY · ${item.cost}G`;
      return `<div class="shop-row">
        ${itemIconHTML(item.invKey)}
        <div class="shop-info">
          <div class="shop-name">${item.label}</div>
          <div class="shop-level">${subLabel}</div>
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
    if(item.lockAfterBadges && runBadges >= item.lockAfterBadges) return;
    META.gold -= item.cost;
    saveMeta();
    if(item.instant){
      if(invKey === 'safariTicket'){
        const returnMode = pokestopMode;
        closePokeStopScreen();
        openSafariZone(() => openPokeStop(returnMode));
      }
      return;
    }
    inv[invKey]++;
    renderPokeStop();
    if(invKey === 'cruiseTicket') openCruiseTicketModal();
  }

  function openCruiseTicketModal(){
    document.getElementById('cruiseTicketModal').classList.add('active');
  }

  function closeCruiseTicketModal(){
    document.getElementById('cruiseTicketModal').classList.remove('active');
  }

  function openEndRunModal(){
    document.getElementById('endRunModal').classList.add('active');
  }

  function closeEndRunModal(){
    document.getElementById('endRunModal').classList.remove('active');
  }

  // The "END RUN" button is reachable from any in-run screen (not just the
  // PokeStop), so hide every possible screen rather than just the PokeStop's.
  const RUN_SCREEN_IDS = [
    'encounterScreen', 'catchScreen', 'gymSelectScreen', 'rivalChallengeScreen',
    'battleScreen', 'casinoScreen', 'fishingScreen', 'safariScreen',
    'pokestopScreen', 'teamScreen', 'starterScreen', 'itemFindScreen',
    'legendaryIntroScreen', 'championScreen',
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
      `<div class="inv-chip">${itemIconHTML(key)}<span class="inv-count">${count}</span><span class="inv-label">${label}</span></div>`).join('');
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
  async function renderResult(run){
    // The run is over the moment this screen shows (win, loss, or manual end)
    // — nothing left to resume, so drop the in-progress save.
    clearRunState();
    checkpointScreen = null;
    hasComputerNotification = false;
    newArrivalNames = [];
    const abandonBtn = document.getElementById('abandonRunBtn');
    if(abandonBtn) abandonBtn.style.display = 'none';
    const score = computeScore(run);
    const gotCatch = run.caught.length > 0;
    const battlesWon = run.trainersBeaten + run.badges;

    let tierMeta;
    if(run.champion){
      tierMeta = { label:"POKÉMON CHAMPION", flavor:`The Legendary faced and all 4 Elite Four members defeated. You are the Champion!`, foil:"foil-perfect" };
    } else if(run.trainerLoss){
      tierMeta = { label:"DEFEATED", flavor:`Lost to ${run.trainerLoss}. The run ends here.`, foil:"foil-defeat" };
    } else if(run.badges >= 3){
      tierMeta = { label:"EXPEDITION LEGEND", flavor:`${run.badges} badges and ${run.trainersBeaten} trainers beaten before calling it.`, foil:"foil-perfect" };
    } else if(run.badges >= 1){
      tierMeta = { label:"SOLID RUN", flavor:`${run.badges} badge${run.badges===1?'':'s'} earned, ${run.trainersBeaten} trainer${run.trainersBeaten===1?'':'s'} beaten along the way.`, foil:"foil-solid" };
    } else {
      tierMeta = { label:"JUST GETTING STARTED", flavor:"Called it before the first Gym Leader.", foil:"foil-modest" };
    }

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
        <p class="hof-card-desc">Download a card of your championship run — team and achievements included.</p>
        <button class="btn-primary" id="downloadHofBtn">DOWNLOAD CARD</button>
        <div class="hof-status" id="hofStatus"></div>
      </div>` : ''}

      <div class="highscore-entry">
        <label for="playerNameInput" class="highscore-label">Write your name to save this run as a Highscore</label>
        <input type="text" id="playerNameInput" class="name-input" placeholder="Your name" maxlength="20">
        <button class="btn-primary" id="saveHighscoreBtn">SAVE HIGHSCORE</button>
      </div>
      <div class="actions">
        <button class="btn-ghost" id="shareRunBtn">SHARE</button>
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

  async function shareRun(run, score){
    const text = run.champion
      ? `${currentPlayerName()} just became Pokémon Champion in Dondokomon with a score of ${score}! 🏆 Starter: ${displayName(run.starter.name)}.`
      : `${currentPlayerName()} scored ${score} in Dondokomon — ${run.badges} badge${run.badges===1?'':'s'}, ${run.trainersBeaten} trainer${run.trainersBeaten===1?'':'s'} beaten. Starter: ${displayName(run.starter.name)}.`;
    const status = document.getElementById('shareStatus');
    if(navigator.share){
      try{
        await navigator.share({ text, title:'Dondokomon run' });
        return;
      }catch(e){ /* user cancelled or unsupported — fall through to clipboard */ }
    }
    try{
      await navigator.clipboard.writeText(text);
      if(status) status.textContent = 'Run summary copied to clipboard!';
    }catch(e){
      if(status) status.textContent = text;
    }
  }

  // ---------- HALL OF FAME CARD (downloadable, Champion runs only) ----------
  function loadImageSafe(src){
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

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
    ctx.fillText(`${currentPlayerName()} — Pokémon Champion`, W / 2, 130);

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
      `⚔️ Elite Four cleared — 4/4`,
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
        <p class="tagline">Make sure you're running this through a local server (e.g. VS Code's Live Server), not opening index.html directly — /data/*.json need to be fetched over http://.</p>
      `;
      console.error(e);
      return;
    }
    document.getElementById('startBtn').addEventListener('click', startGame);
    document.getElementById('rerollBtn').addEventListener('click', rerollWildChoices);
    document.getElementById('cruiseTicketModalOk').addEventListener('click', closeCruiseTicketModal);
    document.getElementById('pokestopEndRunBtn').addEventListener('click', openEndRunModal);
    document.getElementById('endRunConfirmBtn').addEventListener('click', confirmEndRun);
    document.getElementById('endRunCancelBtn').addEventListener('click', closeEndRunModal);
    document.getElementById('pokestopComputerBtn').addEventListener('click', openTeamManagement);
    document.getElementById('teamBackBtn').addEventListener('click', closeTeamManagement);
    document.getElementById('viewFullRankingBtn').addEventListener('click', openFullRanking);
    document.getElementById('abandonRunBtn').addEventListener('click', openEndRunModal);
    document.getElementById('legendaryBeginBtn').addEventListener('click', confirmLegendaryTeam);
    renderGoldBadge();

    const savedRun = loadSavedRun();
    if(savedRun){
      restoreRun(savedRun);
    } else {
      renderBest();
    }
  }

  document.addEventListener('DOMContentLoaded', init);

})();
