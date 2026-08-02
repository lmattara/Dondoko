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
  // the same face, every run. Not every Gym Leader has art yet (rollBadgeGym()
  // sets portraitFile regardless), so trainerPortraitHTML()'s onerror hides
  // the <img> for whichever ones are still missing a file.
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

  // Per-leader landscape (see assets/trainers/Gym Leaders/) — shared by the
  // Gym Select row (renderGymSelect()) and the battle header (startBattle())
  // so a Gym Leader's pick and their actual fight use the same backdrop.
  // Only a few leaders have one so far; onerror on the <img> just hides it.
  function gymLeaderBgPath(leaderName){
    const shortName = leaderName.replace(/^Gym Leader\s*/i, '');
    return `assets/trainers/${encodeURIComponent('Gym Leaders')}/${encodeURIComponent(shortName + '-Background.jpg')}`;
  }

  // Curated roster for Gym Leader Lumen (Fairy) — hand-picked instead of the
  // generic type-filter every other gym uses, so it excludes legendaries,
  // Paradox Pokémon, and regional forms even though those would otherwise
  // qualify by type (all three categories are excluded game-wide from every
  // trainer/gym pool; see wildPool()).
  const FAIRY_GYM_POOL = [
    "clefairy","clefable","jigglypuff","wigglytuff","cleffa","igglybuff",
    "togepi","togetic","snubbull","granbull","flabebe","floette","florges",
    "spritzee","aromatisse","swirlix","slurpuff","sylveon","comfey","milcery",
    "alcremie","fidough","dachsbun","marill","azumarill","ralts","kirlia",
    "gardevoir","azurill","mawile","mr-mime","mime-jr","togekiss",
    "cottonee","whimsicott","dedenne","carbink","klefki","primarina",
    "cutiefly","ribombee","morelull","shiinotic","hatterene","impidimp",
    "morgrem","grimmsnarl","tinkatink","tinkatuff","tinkaton",
  ];

  // Curated rosters for the other 9 Gym Leaders, same idea as FAIRY_GYM_POOL
  // above: cross-referenced Bulbapedia's per-type species lists against this
  // game's actual data (only keeps a species/form if it genuinely carries the
  // gym's type here — a few Bulbapedia entries only qualify via a Mega/Gmax
  // form, which doesn't count since those are excluded from every pool game-
  // wide) and against the same exclusions as the Fairy pool (no legendary,
  // no Paradox, no Totem/cosmetic/battle-only forms). Alola/Galar/Hisui/
  // Paldea regional forms are included wherever they carry the type,
  // sometimes alongside their non-regional counterpart (e.g. Growlithe and
  // Growlithe-Hisui both fit Ember's Fire theme). Dual-type gyms merge both
  // of their types' lists into one pool, matching either type being enough
  // to qualify (mirrors how mono-type Gym Leaders like Erika/Koga read in
  // the mainline games, not "must be both types at once").
  const DORAN_GYM_POOL = [
    "aerodactyl", "aggron", "amaura", "anorith", "arcanine-hisui", "archen",
    "archeops", "armaldo", "aron", "aurorus", "avalugg-hisui", "baltoy",
    "barbaracle", "barboach", "bastiodon", "binacle", "boldore", "bonsly",
    "camerupt", "carbink", "carkol", "carracosta", "claydol", "clodsire",
    "coalossal", "corsola", "cradily", "cranidos", "crustle", "cubone",
    "diggersby", "diglett", "diglett-alola", "donphan", "drednaw", "drilbur",
    "dugtrio", "dugtrio-alola", "dwebble", "excadrill", "flygon", "gabite",
    "garchomp", "garganacl", "gastrodon", "geodude", "geodude-alola", "gible",
    "gigalith", "gligar", "glimmet", "glimmora", "gliscor", "golem",
    "golem-alola", "golett", "golurk", "graveler", "graveler-alola",
    "growlithe-hisui", "hippopotas", "hippowdon", "kabuto", "kabutops",
    "klawf", "kleavor", "krokorok", "krookodile", "lairon", "larvitar",
    "lileep", "lunatone", "lycanroc-midday", "magcargo", "mamoswine",
    "marowak", "marshtomp", "minior-red-meteor", "mudbray", "mudsdale",
    "nacli", "naclstack", "nidoking", "nidoqueen", "nihilego", "nincada",
    "nosepass", "numel", "omanyte", "omastar", "onix", "palossand",
    "palpitoad", "phanpy", "piloswine", "probopass", "pupitar", "quagsire",
    "rampardos", "relicanth", "rhydon", "rhyhorn", "rhyperior", "rockruff",
    "roggenrola", "rolycoly", "runerigus", "sandaconda", "sandile",
    "sandshrew", "sandslash", "sandygast", "seismitoad", "shieldon",
    "shuckle", "silicobra", "solrock", "stakataka", "steelix", "stonjourner",
    "stunfisk", "stunfisk-galar", "sudowoodo", "swampert", "swinub",
    "tirtouga", "toedscool", "toedscruel", "torterra", "trapinch",
    "tyranitar", "tyrantrum", "tyrunt", "ursaluna", "vibrava", "whiscash",
    "wooper", "wooper-paldea", "yamask-galar",
  ];
  const EMBER_GYM_POOL = [
    "arcanine", "arcanine-hisui", "armarouge", "blacephalon", "blaziken",
    "braixen", "camerupt", "carkol", "centiskorch", "ceruledge", "chandelure",
    "charcadet", "charizard", "charmander", "charmeleon", "chimchar",
    "cinderace", "coalossal", "combusken", "crocalor", "cyndaquil",
    "darmanitan-standard", "darumaka", "delphox", "emboar", "fennekin",
    "flareon", "fletchinder", "fuecoco", "growlithe", "growlithe-hisui",
    "heatmor", "houndoom", "houndour", "incineroar", "infernape", "lampent",
    "larvesta", "litleo", "litten", "litwick", "magby", "magcargo", "magmar",
    "magmortar", "marowak-alola", "monferno", "ninetales", "numel",
    "oricorio-baile", "pansear", "pignite", "ponyta", "pyroar-male",
    "quilava", "raboot", "rapidash", "salandit", "salazzle", "scorbunny",
    "scovillain", "simisear", "sizzlipede", "skeledirge", "slugma",
    "talonflame", "tauros-paldea-blaze-breed", "tepig", "torchic", "torkoal",
    "torracat", "turtonator", "typhlosion", "typhlosion-hisui", "volcarona",
    "vulpix",
  ];
  const MARIN_GYM_POOL = [
    "alomomola", "araquanid", "arctovish", "arrokuda", "azumarill",
    "barbaracle", "barboach", "barraskewda", "basculegion-male",
    "basculin-red-striped", "bibarel", "binacle", "blastoise", "brionne",
    "bruxish", "buizel", "carracosta", "carvanha", "chewtle", "chinchou",
    "clamperl", "clauncher", "clawitzer", "cloyster", "corphish", "corsola",
    "cramorant", "crawdaunt", "croconaw", "dewgong", "dewott", "dewpider",
    "dondozo", "dracovish", "drednaw", "drizzile", "ducklett", "empoleon",
    "feebas", "feraligatr", "finizen", "finneon", "floatzel", "frillish-male",
    "froakie", "frogadier", "gastrodon", "goldeen", "golduck", "golisopod",
    "gorebyss", "greninja", "gyarados", "horsea", "huntail", "inteleon",
    "jellicent-male", "kabuto", "kabutops", "kingdra", "kingler", "krabby",
    "lanturn", "lapras", "lombre", "lotad", "ludicolo", "lumineon", "luvdisc",
    "magikarp", "mantine", "mantyke", "mareanie", "marill", "marshtomp",
    "milotic", "mudkip", "octillery", "omanyte", "omastar", "oshawott",
    "palafin-zero", "palpitoad", "panpour", "pelipper", "piplup", "politoed",
    "poliwag", "poliwhirl", "poliwrath", "popplio", "primarina", "prinplup",
    "psyduck", "pyukumuku", "quagsire", "quaquaval", "quaxly", "quaxwell",
    "qwilfish", "relicanth", "remoraid", "samurott", "samurott-hisui",
    "seadra", "seaking", "sealeo", "seel", "seismitoad", "sharpedo",
    "shellder", "shellos", "simipour", "skrelp", "slowbro", "slowking",
    "slowpoke", "sobble", "spheal", "squirtle", "starmie", "staryu",
    "surskit", "swampert", "swanna", "tatsugiri-curly",
    "tauros-paldea-aqua-breed", "tentacool", "tentacruel", "tirtouga",
    "totodile", "toxapex", "tympole", "vaporeon", "veluza", "wailmer",
    "wailord", "walrein", "wartortle", "whiscash", "wiglett", "wimpod",
    "wingull", "wishiwashi-solo", "wooper", "wugtrio",
  ];
  const VOLT_GYM_POOL = [
    "ampharos", "arctozolt", "bellibolt", "blitzle", "boltund", "charjabug",
    "chinchou", "dedenne", "dracozolt", "eelektrik", "eelektross",
    "electabuzz", "electivire", "electrike", "electrode", "electrode-hisui",
    "elekid", "emolga", "flaaffy", "galvantula", "geodude-alola",
    "golem-alola", "graveler-alola", "heliolisk", "helioptile", "jolteon",
    "joltik", "kilowattrel", "lanturn", "luxio", "luxray", "magnemite",
    "magneton", "magnezone", "manectric", "mareep", "minun",
    "morpeko-full-belly", "pachirisu", "pawmi", "pawmo", "pawmot", "pichu",
    "pikachu", "pincurchin", "plusle", "raichu", "raichu-alola", "rotom",
    "shinx", "stunfisk", "tadbulb", "togedemaru", "toxel", "toxtricity-amped",
    "tynamo", "vikavolt", "voltorb", "voltorb-hisui", "wattrel", "xurkitree",
    "yamper", "zebstrika",
  ];
  const THISTLE_GYM_POOL = [
    "abomasnow", "amoonguss", "appletun", "applin", "arbok", "arboliva",
    "ariados", "bayleef", "beedrill", "bellossom", "bellsprout", "bounsweet",
    "brambleghast", "bramblin", "breloom", "budew", "bulbasaur", "cacnea",
    "cacturne", "capsakid", "carnivine", "cherrim", "cherubi", "chesnaught",
    "chespin", "chikorita", "clodsire", "cottonee", "cradily", "croagunk",
    "crobat", "dartrix", "decidueye", "decidueye-hisui", "deerling",
    "dhelmise", "dipplin", "dolliv", "dragalge", "drapion", "dustox", "ekans",
    "eldegoss", "electrode-hisui", "exeggcute", "exeggutor",
    "exeggutor-alola", "ferroseed", "ferrothorn", "flapple", "floragato",
    "fomantis", "foongus", "garbodor", "gastly", "gengar", "glimmet",
    "glimmora", "gloom", "gogoat", "golbat", "gossifleur",
    "gourgeist-average", "grafaiai", "grimer", "grimer-alola", "grookey",
    "grotle", "grovyle", "gulpin", "haunter", "hoppip", "hydrapple",
    "ivysaur", "jumpluff", "kakuna", "kartana", "koffing", "leafeon",
    "leavanny", "lileep", "lilligant", "lilligant-hisui", "lombre", "lotad",
    "ludicolo", "lurantis", "maractus", "mareanie", "meganium", "meowscarada",
    "morelull", "muk", "muk-alola", "naganadel", "nidoking", "nidoqueen",
    "nidoran-f", "nidoran-m", "nidorina", "nidorino", "nihilego", "nuzleaf",
    "oddish", "overqwil", "pansage", "paras", "parasect", "petilil",
    "phantump", "poipole", "poltchageist", "pumpkaboo-average", "quilladin",
    "qwilfish", "qwilfish-hisui", "revavroom", "rillaboom", "roselia",
    "roserade", "rowlet", "salandit", "salazzle", "sawsbuck", "sceptile",
    "scolipede", "scovillain", "seedot", "serperior", "servine", "seviper",
    "sewaddle", "shiftry", "shiinotic", "shroodle", "shroomish", "simisage",
    "sinistcha", "skiddo", "skiploom", "skorupi", "skrelp", "skuntank",
    "slowbro-galar", "slowking-galar", "smoliv", "sneasel-hisui", "sneasler",
    "snivy", "snover", "spinarak", "sprigatito", "steenee", "stunky",
    "sunflora", "sunkern", "swadloon", "swalot", "tangela", "tangrowth",
    "tentacool", "tentacruel", "thwackey", "toedscool", "toedscruel",
    "torterra", "toxapex", "toxel", "toxicroak", "toxtricity-amped",
    "treecko", "trevenant", "tropius", "trubbish", "tsareena", "turtwig",
    "varoom", "venipede", "venomoth", "venonat", "venusaur", "victreebel",
    "vileplume", "voltorb-hisui", "weedle", "weepinbell", "weezing",
    "weezing-galar", "whimsicott", "whirlipede", "wooper-paldea",
    "wormadam-plant", "zubat",
  ];
  const GALE_GYM_POOL = [
    "abomasnow", "aerodactyl", "altaria", "amaura", "archen", "archeops",
    "arctibax", "arctovish", "arctozolt", "aurorus", "avalugg",
    "avalugg-hisui", "baxcalibur", "beartic", "beautifly", "bergmite",
    "bombirdier", "braviary", "braviary-hisui", "butterfree", "celesteela",
    "cetitan", "cetoddle", "charizard", "chatot", "cloyster", "combee",
    "corviknight", "corvisquire", "crabominable", "cramorant", "crobat",
    "cryogonal", "cubchoo", "darmanitan-galar-standard", "dartrix",
    "darumaka-galar", "delibird", "dewgong", "dodrio", "doduo", "dragonite",
    "drifblim", "drifloon", "ducklett", "eiscue-ice", "emolga", "farfetchd",
    "fearow", "flamigo", "fletchinder", "fletchling", "frigibax", "froslass",
    "frosmoth", "glaceon", "glalie", "gligar", "gliscor", "golbat",
    "gyarados", "hawlucha", "honchkrow", "hoothoot", "hoppip", "jumpluff",
    "jynx", "kilowattrel", "lapras", "ledian", "ledyba", "mamoswine",
    "mandibuzz", "mantine", "mantyke", "masquerain", "minior-red-meteor",
    "mothim", "mr-mime-galar", "mr-rime", "murkrow", "natu",
    "ninetales-alola", "ninjask", "noctowl", "noibat", "noivern",
    "oricorio-baile", "pelipper", "pidgeot", "pidgeotto", "pidgey", "pidove",
    "pikipek", "piloswine", "rookidee", "rowlet", "rufflet", "salamence",
    "sandshrew-alola", "sandslash-alola", "scyther", "sealeo", "sigilyph",
    "skarmory", "skiploom", "smoochum", "sneasel", "snom", "snorunt",
    "snover", "spearow", "spheal", "squawkabilly-green-plumage", "staraptor",
    "staravia", "starly", "swablu", "swanna", "swellow", "swinub", "swoobat",
    "taillow", "talonflame", "togekiss", "togetic", "toucannon", "tranquill",
    "tropius", "trumbeak", "unfezant", "vanillish", "vanillite", "vanilluxe",
    "vespiquen", "vivillon", "vullaby", "vulpix-alola", "walrein", "wattrel",
    "weavile", "wingull", "woobat", "xatu", "yanma", "yanmega", "zubat",
  ];
  const NYX_GYM_POOL = [
    "abra", "aegislash-shield", "alakazam", "annihilape", "armarouge",
    "baltoy", "banette", "basculegion-male", "beheeyem", "beldum",
    "blacephalon", "brambleghast", "bramblin", "braviary-hisui", "bronzong",
    "bronzor", "bruxish", "ceruledge", "chandelure", "chimecho", "chingling",
    "claydol", "cofagrigus", "corsola-galar", "cursola", "decidueye",
    "delphox", "dhelmise", "dottler", "doublade", "dragapult", "drakloak",
    "dreepy", "drifblim", "drifloon", "drowzee", "duosion", "dusclops",
    "dusknoir", "duskull", "elgyem", "espathra", "espeon", "espurr",
    "exeggcute", "exeggutor", "farigiraf", "flittle", "frillish-male",
    "froslass", "gallade", "gardevoir", "gastly", "gengar", "gholdengo",
    "gimmighoul", "girafarig", "golett", "golurk", "gothita", "gothitelle",
    "gothorita", "gourgeist-average", "greavard", "grumpig", "hatenna",
    "hatterene", "hattrem", "haunter", "honedge", "houndstone", "hypno",
    "indeedee-male", "inkay", "jellicent-male", "jynx", "kadabra", "kirlia",
    "lampent", "litwick", "lunatone", "malamar", "marowak-alola", "medicham",
    "meditite", "meowstic-male", "metagross", "metang", "mime-jr",
    "mimikyu-disguised", "misdreavus", "mismagius", "mr-mime",
    "mr-mime-galar", "mr-rime", "munna", "musharna", "natu", "oranguru",
    "orbeetle", "palossand", "phantump", "poltchageist", "polteageist",
    "ponyta-galar", "pumpkaboo-average", "rabsca", "raichu-alola", "ralts",
    "rapidash-galar", "reuniclus", "rotom", "runerigus", "sableye",
    "sandygast", "shedinja", "shuppet", "sigilyph", "sinistcha", "sinistea",
    "skeledirge", "slowbro", "slowbro-galar", "slowking", "slowking-galar",
    "slowpoke", "slowpoke-galar", "smoochum", "solosis", "solrock",
    "spiritomb", "spoink", "starmie", "swoobat", "trevenant",
    "typhlosion-hisui", "unown", "veluza", "wobbuffet", "woobat", "wynaut",
    "wyrdeer", "xatu", "yamask", "yamask-galar", "zoroark-hisui",
    "zorua-hisui",
  ];
  const ROOK_GYM_POOL = [
    "absol", "aegislash-shield", "aggron", "archaludon", "aron", "bastiodon",
    "beldum", "bisharp", "bombirdier", "bronzong", "bronzor", "cacturne",
    "carvanha", "celesteela", "copperajah", "corviknight", "crawdaunt",
    "cufant", "deino", "diglett-alola", "doublade", "drapion",
    "dugtrio-alola", "duraludon", "durant", "empoleon", "escavalier",
    "excadrill", "ferroseed", "ferrothorn", "forretress", "gholdengo",
    "goodra-hisui", "greninja", "grimer-alola", "grimmsnarl", "guzzlord",
    "honchkrow", "honedge", "houndoom", "houndour", "hydreigon", "impidimp",
    "incineroar", "inkay", "kartana", "kingambit", "klang", "klefki", "klink",
    "klinklang", "krokorok", "krookodile", "lairon", "liepard",
    "linoone-galar", "lokix", "lucario", "mabosstiff", "magnemite",
    "magneton", "magnezone", "malamar", "mandibuzz", "maschiff", "mawile",
    "meowscarada", "meowth-alola", "meowth-galar", "metagross", "metang",
    "mightyena", "morgrem", "morpeko-full-belly", "muk-alola", "murkrow",
    "nickit", "nuzleaf", "obstagoon", "orthworm", "overqwil", "pangoro",
    "pawniard", "perrserker", "persian-alola", "poochyena", "probopass",
    "purrloin", "qwilfish-hisui", "raticate-alola", "rattata-alola",
    "revavroom", "sableye", "samurott-hisui", "sandile", "sandshrew-alola",
    "sandslash-alola", "scizor", "scrafty", "scraggy", "sharpedo", "shieldon",
    "shiftry", "skarmory", "skuntank", "sliggoo-hisui", "sneasel",
    "spiritomb", "stakataka", "steelix", "stunfisk-galar", "stunky",
    "thievul", "tinkatink", "tinkaton", "tinkatuff", "togedemaru",
    "tyranitar", "umbreon", "varoom", "vullaby", "weavile", "zigzagoon-galar",
    "zoroark", "zorua", "zweilous",
  ];
  const WYRM_GYM_POOL = [
    "altaria", "appletun", "applin", "archaludon", "arctibax", "axew",
    "bagon", "baxcalibur", "cyclizar", "deino", "dipplin", "dracovish",
    "dracozolt", "dragalge", "dragapult", "dragonair", "dragonite",
    "drakloak", "drampa", "dratini", "dreepy", "druddigon", "duraludon",
    "exeggutor-alola", "flapple", "flygon", "fraxure", "frigibax", "gabite",
    "garchomp", "gible", "goodra", "goodra-hisui", "goomy", "guzzlord",
    "hakamo-o", "haxorus", "hydrapple", "hydreigon", "jangmo-o", "kingdra",
    "kommo-o", "naganadel", "noibat", "noivern", "salamence", "shelgon",
    "sliggoo", "sliggoo-hisui", "tatsugiri-curly", "turtonator", "tyrantrum",
    "tyrunt", "vibrava", "zweilous",
  ];

  // ---------- 8 ADDITIONAL GYM LEADERS (badge icons pending — see BADGES) ----------
  // Same convention as the 10 pools above: every species carrying either of
  // the badge's types, national-dex only, no Legendary/Mythical/Paradox/
  // Mega/Gigantamax. For the 6 dual-type ones below, true dual-type members
  // (carrying BOTH of the badge's types at once) are listed first — rare
  // within the pool (as few as 3, e.g. Mantis's Bug/Fighting), so keeping
  // them up front means a future trim never accidentally cuts them before
  // the far more common single-type members.
  const TALON_GYM_POOL = [
    "charizard", "butterfree", "pidgey", "pidgeotto", "pidgeot", "spearow",
    "fearow", "zubat", "golbat", "farfetchd", "doduo", "dodrio", "scyther",
    "gyarados", "aerodactyl", "dragonite", "hoothoot", "noctowl", "ledyba",
    "ledian", "crobat", "togetic", "natu", "xatu", "hoppip", "skiploom",
    "jumpluff", "yanma", "murkrow", "gligar", "delibird", "mantine",
    "skarmory", "beautifly", "taillow", "swellow", "wingull", "pelipper",
    "masquerain", "ninjask", "swablu", "altaria", "tropius", "salamence",
    "starly", "staravia", "staraptor", "mothim", "combee", "vespiquen",
    "drifloon", "drifblim", "honchkrow", "chatot", "mantyke", "togekiss",
    "yanmega", "gliscor", "pidove", "tranquill", "unfezant", "woobat",
    "swoobat", "sigilyph", "archen", "archeops", "ducklett", "swanna",
    "emolga", "rufflet", "braviary", "vullaby", "mandibuzz", "fletchling",
    "fletchinder", "talonflame", "vivillon", "hawlucha", "noibat", "noivern",
    "rowlet", "dartrix", "pikipek", "trumbeak", "toucannon",
    "oricorio-baile", "minior-red-meteor", "celesteela", "rookidee",
    "corvisquire", "corviknight", "cramorant", "squawkabilly-green-plumage",
    "wattrel", "kilowattrel", "bombirdier", "flamigo",
  ];
  const HOLLOW_GYM_POOL = [
    "phantump", "trevenant", "pumpkaboo-average", "gourgeist-average",
    "decidueye", "dhelmise", "bramblin", "brambleghast", "poltchageist",
    "sinistcha", "bulbasaur", "ivysaur", "venusaur", "oddish", "gloom",
    "vileplume", "paras", "parasect", "bellsprout", "weepinbell",
    "victreebel", "gastly", "haunter", "gengar", "exeggcute", "exeggutor",
    "tangela", "chikorita", "bayleef", "meganium", "bellossom", "hoppip",
    "skiploom", "jumpluff", "sunkern", "sunflora", "misdreavus", "treecko",
    "grovyle", "sceptile", "lotad", "lombre", "ludicolo", "seedot",
    "nuzleaf", "shiftry", "shroomish", "breloom", "shedinja", "sableye",
    "roselia", "cacnea", "cacturne", "lileep", "cradily", "shuppet",
    "banette", "duskull", "dusclops", "tropius", "turtwig", "grotle",
    "torterra", "budew", "roserade", "wormadam-plant", "cherubi", "cherrim",
    "drifloon", "drifblim", "mismagius", "spiritomb", "carnivine", "snover",
    "abomasnow", "tangrowth", "leafeon", "dusknoir", "froslass", "rotom",
    "snivy", "servine", "serperior", "pansage", "simisage", "sewaddle",
    "swadloon", "leavanny", "cottonee", "whimsicott", "petilil", "lilligant",
    "maractus", "yamask", "cofagrigus", "deerling", "sawsbuck", "foongus",
    "amoonguss", "frillish-male", "jellicent-male", "ferroseed",
    "ferrothorn", "litwick", "lampent", "chandelure", "golett", "golurk",
    "chespin", "quilladin", "chesnaught", "skiddo", "gogoat", "honedge",
    "doublade", "aegislash-shield", "rowlet", "dartrix", "fomantis",
    "lurantis", "morelull", "shiinotic", "bounsweet", "steenee", "tsareena",
    "sandygast", "palossand", "mimikyu-disguised", "kartana", "blacephalon",
    "grookey", "thwackey", "rillaboom", "gossifleur", "eldegoss", "applin",
    "flapple", "appletun", "sinistea", "polteageist", "cursola", "runerigus",
    "dreepy", "drakloak", "dragapult", "basculegion-male", "sprigatito",
    "floragato", "meowscarada", "skeledirge", "smoliv", "dolliv", "arboliva",
    "ceruledge", "toedscool", "toedscruel", "capsakid", "scovillain",
    "greavard", "houndstone", "annihilape", "gimmighoul", "gholdengo",
    "dipplin", "hydrapple",
  ];
  const BLIGHT_GYM_POOL = [
    "weedle", "kakuna", "beedrill", "venonat", "venomoth", "spinarak",
    "ariados", "dustox", "skorupi", "venipede", "whirlipede", "scolipede",
    "bulbasaur", "ivysaur", "venusaur", "caterpie", "metapod", "butterfree",
    "ekans", "arbok", "nidoran-f", "nidorina", "nidoqueen", "nidoran-m",
    "nidorino", "nidoking", "zubat", "golbat", "oddish", "gloom",
    "vileplume", "paras", "parasect", "bellsprout", "weepinbell",
    "victreebel", "tentacool", "tentacruel", "grimer", "muk", "gastly",
    "haunter", "gengar", "koffing", "weezing", "scyther", "pinsir", "ledyba",
    "ledian", "crobat", "yanma", "pineco", "forretress", "qwilfish",
    "scizor", "shuckle", "heracross", "wurmple", "silcoon", "beautifly",
    "cascoon", "surskit", "masquerain", "nincada", "ninjask", "shedinja",
    "volbeat", "illumise", "roselia", "gulpin", "swalot", "seviper",
    "anorith", "armaldo", "kricketot", "kricketune", "budew", "roserade",
    "burmy", "wormadam-plant", "mothim", "combee", "vespiquen", "stunky",
    "skuntank", "drapion", "croagunk", "toxicroak", "yanmega", "sewaddle",
    "swadloon", "leavanny", "dwebble", "crustle", "trubbish", "garbodor",
    "karrablast", "escavalier", "foongus", "amoonguss", "joltik",
    "galvantula", "shelmet", "accelgor", "durant", "larvesta", "volcarona",
    "scatterbug", "spewpa", "vivillon", "skrelp", "dragalge", "grubbin",
    "charjabug", "vikavolt", "cutiefly", "ribombee", "mareanie", "toxapex",
    "dewpider", "araquanid", "salandit", "salazzle", "wimpod", "golisopod",
    "nihilego", "buzzwole", "pheromosa", "poipole", "naganadel", "blipbug",
    "dottler", "orbeetle", "toxel", "toxtricity-amped", "sizzlipede",
    "centiskorch", "snom", "frosmoth", "kleavor", "sneasler", "overqwil",
    "tarountula", "spidops", "nymble", "lokix", "shroodle", "grafaiai",
    "rellor", "rabsca", "varoom", "revavroom", "glimmet", "glimmora",
    "clodsire",
  ];
  const REEF_GYM_POOL = [
    "omanyte", "omastar", "kabuto", "kabutops", "corsola", "relicanth",
    "tirtouga", "carracosta", "binacle", "barbaracle", "drednaw", "squirtle",
    "wartortle", "blastoise", "psyduck", "golduck", "poliwag", "poliwhirl",
    "poliwrath", "tentacool", "tentacruel", "geodude", "graveler", "golem",
    "slowpoke", "slowbro", "seel", "dewgong", "shellder", "cloyster", "onix",
    "krabby", "kingler", "rhyhorn", "rhydon", "horsea", "seadra", "goldeen",
    "seaking", "staryu", "starmie", "magikarp", "gyarados", "lapras",
    "vaporeon", "aerodactyl", "totodile", "croconaw", "feraligatr",
    "chinchou", "lanturn", "marill", "azumarill", "sudowoodo", "politoed",
    "wooper", "quagsire", "slowking", "qwilfish", "shuckle", "magcargo",
    "remoraid", "octillery", "mantine", "kingdra", "larvitar", "pupitar",
    "tyranitar", "mudkip", "marshtomp", "swampert", "lotad", "lombre",
    "ludicolo", "wingull", "pelipper", "surskit", "nosepass", "aron",
    "lairon", "aggron", "carvanha", "sharpedo", "wailmer", "wailord",
    "lunatone", "solrock", "barboach", "whiscash", "corphish", "crawdaunt",
    "lileep", "cradily", "anorith", "armaldo", "feebas", "milotic", "spheal",
    "sealeo", "walrein", "clamperl", "huntail", "gorebyss", "luvdisc",
    "piplup", "prinplup", "empoleon", "bibarel", "cranidos", "rampardos",
    "shieldon", "bastiodon", "buizel", "floatzel", "shellos", "gastrodon",
    "bonsly", "finneon", "lumineon", "mantyke", "rhyperior", "probopass",
    "oshawott", "dewott", "samurott", "panpour", "simipour", "roggenrola",
    "boldore", "gigalith", "tympole", "palpitoad", "seismitoad",
    "basculin-red-striped", "dwebble", "crustle", "archen", "archeops",
    "ducklett", "swanna", "frillish-male", "jellicent-male", "alomomola",
    "froakie", "frogadier", "greninja", "skrelp", "clauncher", "clawitzer",
    "tyrunt", "tyrantrum", "amaura", "aurorus", "carbink", "popplio",
    "brionne", "primarina", "rockruff", "lycanroc-midday", "wishiwashi-solo",
    "mareanie", "toxapex", "dewpider", "araquanid", "wimpod", "golisopod",
    "pyukumuku", "minior-red-meteor", "bruxish", "nihilego", "stakataka",
    "sobble", "drizzile", "inteleon", "chewtle", "rolycoly", "carkol",
    "coalossal", "cramorant", "arrokuda", "barraskewda", "stonjourner",
    "dracovish", "arctovish", "kleavor", "basculegion-male", "quaxly",
    "quaxwell", "quaquaval", "nacli", "naclstack", "garganacl", "klawf",
    "wiglett", "wugtrio", "finizen", "palafin-zero", "glimmet", "glimmora",
    "veluza", "dondozo", "tatsugiri-curly",
  ];
  // Pure Fighting types only (no Bug leftovers from when this was a
  // Bug/Fighting gym) — still includes every dual-type that carries
  // Fighting alongside something else (blaziken, gallade, lucario, etc.),
  // same as every other single-type gym pool in this file.
  const MANTIS_GYM_POOL = [
    "heracross", "buzzwole", "pheromosa", "mankey", "primeape", "poliwrath",
    "machop", "machoke", "machamp", "hitmonlee", "hitmonchan", "tyrogue",
    "hitmontop", "combusken", "blaziken", "breloom", "makuhita", "hariyama",
    "meditite", "medicham", "monferno", "infernape", "riolu", "lucario",
    "croagunk", "toxicroak", "gallade", "pignite", "emboar", "timburr",
    "gurdurr", "conkeldurr", "throh", "sawk", "scraggy", "scrafty",
    "mienfoo", "mienshao", "chesnaught", "pancham", "pangoro", "hawlucha",
    "crabrawler", "crabominable", "stufful", "bewear", "passimian",
    "hakamo-o", "kommo-o", "clobbopus", "grapploct", "sirfetchd", "falinks",
    "sneasler", "quaquaval", "pawmo", "pawmot", "flamigo", "annihilape",
  ];
  const IVORY_GYM_POOL = [
    "pidgey", "pidgeotto", "pidgeot", "rattata", "raticate", "spearow",
    "fearow", "jigglypuff", "wigglytuff", "meowth", "persian", "farfetchd",
    "doduo", "dodrio", "lickitung", "chansey", "kangaskhan", "tauros",
    "ditto", "eevee", "porygon", "snorlax", "sentret", "furret", "hoothoot",
    "noctowl", "igglybuff", "aipom", "girafarig", "dunsparce", "teddiursa",
    "ursaring", "porygon2", "stantler", "smeargle", "miltank", "blissey",
    "zigzagoon", "linoone", "taillow", "swellow", "slakoth", "vigoroth",
    "slaking", "whismur", "loudred", "exploud", "azurill", "skitty",
    "delcatty", "spinda", "swablu", "zangoose", "castform", "kecleon",
    "starly", "staravia", "staraptor", "bidoof", "bibarel", "ambipom",
    "buneary", "lopunny", "glameow", "purugly", "happiny", "chatot",
    "munchlax", "lickilicky", "porygon-z", "patrat", "watchog", "lillipup",
    "herdier", "stoutland", "pidove", "tranquill", "unfezant", "audino",
    "minccino", "cinccino", "deerling", "sawsbuck", "bouffalant", "rufflet",
    "braviary", "bunnelby", "diggersby", "fletchling", "litleo",
    "pyroar-male", "furfrou", "helioptile", "heliolisk", "pikipek",
    "trumbeak", "toucannon", "yungoos", "gumshoos", "stufful", "bewear",
    "oranguru", "komala", "drampa", "skwovet", "greedent", "wooloo",
    "dubwool", "obstagoon", "indeedee-male", "wyrdeer", "ursaluna",
    "lechonk", "oinkologne-male", "tandemaus", "maushold-family-of-four",
    "smoliv", "dolliv", "arboliva", "squawkabilly-green-plumage", "shroodle",
    "grafaiai", "cyclizar", "farigiraf", "dudunsparce-two-segment",
  ];
  const HEX_GYM_POOL = [
    "stunky", "skuntank", "drapion", "overqwil", "bulbasaur", "ivysaur",
    "venusaur", "weedle", "kakuna", "beedrill", "ekans", "arbok",
    "nidoran-f", "nidorina", "nidoqueen", "nidoran-m", "nidorino",
    "nidoking", "zubat", "golbat", "oddish", "gloom", "vileplume", "venonat",
    "venomoth", "bellsprout", "weepinbell", "victreebel", "tentacool",
    "tentacruel", "grimer", "muk", "gastly", "haunter", "gengar", "koffing",
    "weezing", "spinarak", "ariados", "crobat", "umbreon", "murkrow",
    "qwilfish", "sneasel", "houndour", "houndoom", "tyranitar", "poochyena",
    "mightyena", "dustox", "nuzleaf", "shiftry", "sableye", "roselia",
    "gulpin", "swalot", "carvanha", "sharpedo", "cacturne", "seviper",
    "crawdaunt", "absol", "budew", "roserade", "honchkrow", "spiritomb",
    "skorupi", "croagunk", "toxicroak", "weavile", "purrloin", "liepard",
    "venipede", "whirlipede", "scolipede", "sandile", "krokorok",
    "krookodile", "scraggy", "scrafty", "trubbish", "garbodor", "zorua",
    "zoroark", "foongus", "amoonguss", "pawniard", "bisharp", "vullaby",
    "mandibuzz", "deino", "zweilous", "hydreigon", "greninja", "pangoro",
    "inkay", "malamar", "skrelp", "dragalge", "incineroar", "mareanie",
    "toxapex", "salandit", "salazzle", "nihilego", "guzzlord", "poipole",
    "naganadel", "nickit", "thievul", "toxel", "toxtricity-amped",
    "impidimp", "morgrem", "grimmsnarl", "obstagoon", "morpeko-full-belly",
    "sneasler", "meowscarada", "lokix", "maschiff", "mabosstiff", "shroodle",
    "grafaiai", "bombirdier", "varoom", "revavroom", "glimmet", "glimmora",
    "clodsire", "kingambit",
  ];
  const FLOE_GYM_POOL = [
    "dewgong", "cloyster", "lapras", "spheal", "sealeo", "walrein",
    "arctovish", "squirtle", "wartortle", "blastoise", "psyduck", "golduck",
    "poliwag", "poliwhirl", "poliwrath", "tentacool", "tentacruel",
    "slowpoke", "slowbro", "seel", "shellder", "krabby", "kingler", "horsea",
    "seadra", "goldeen", "seaking", "staryu", "starmie", "jynx", "magikarp",
    "gyarados", "vaporeon", "omanyte", "omastar", "kabuto", "kabutops",
    "totodile", "croconaw", "feraligatr", "chinchou", "lanturn", "marill",
    "azumarill", "politoed", "wooper", "quagsire", "slowking", "qwilfish",
    "sneasel", "swinub", "piloswine", "corsola", "remoraid", "octillery",
    "delibird", "mantine", "kingdra", "smoochum", "mudkip", "marshtomp",
    "swampert", "lotad", "lombre", "ludicolo", "wingull", "pelipper",
    "surskit", "carvanha", "sharpedo", "wailmer", "wailord", "barboach",
    "whiscash", "corphish", "crawdaunt", "feebas", "milotic", "snorunt",
    "glalie", "clamperl", "huntail", "gorebyss", "relicanth", "luvdisc",
    "piplup", "prinplup", "empoleon", "bibarel", "buizel", "floatzel",
    "shellos", "gastrodon", "finneon", "lumineon", "mantyke", "snover",
    "abomasnow", "weavile", "glaceon", "mamoswine", "froslass", "oshawott",
    "dewott", "samurott", "panpour", "simipour", "tympole", "palpitoad",
    "seismitoad", "basculin-red-striped", "tirtouga", "carracosta",
    "ducklett", "swanna", "vanillite", "vanillish", "vanilluxe",
    "frillish-male", "jellicent-male", "alomomola", "cubchoo", "beartic",
    "cryogonal", "froakie", "frogadier", "greninja", "binacle", "barbaracle",
    "skrelp", "clauncher", "clawitzer", "amaura", "aurorus", "bergmite",
    "avalugg", "popplio", "brionne", "primarina", "crabominable",
    "wishiwashi-solo", "mareanie", "toxapex", "dewpider", "araquanid",
    "wimpod", "golisopod", "pyukumuku", "bruxish", "sobble", "drizzile",
    "inteleon", "chewtle", "drednaw", "cramorant", "arrokuda", "barraskewda",
    "mr-rime", "snom", "frosmoth", "eiscue-ice", "arctozolt", "dracovish",
    "basculegion-male", "quaxly", "quaxwell", "quaquaval", "wiglett",
    "wugtrio", "finizen", "palafin-zero", "cetoddle", "cetitan", "veluza",
    "dondozo", "tatsugiri-curly", "frigibax", "arctibax", "baxcalibur",
  ];

  // 18 Gym Badges total, each themed to a type (or type pair) with matching
  // badge art. Only 4 are offered per badge slot though — see gymChoicePool
  // / rollGymChoicePool() — so a single run only ever sees 8 of the 18.
  const BADGES = [
    { key:"normal",        icon:"normal.png",        leaderName:"Gym Leader Doran",  types:["rock","ground"], pool: DORAN_GYM_POOL },
    { key:"fire",          icon:"fire.png",           leaderName:"Gym Leader Ember",  types:["fire"], pool: EMBER_GYM_POOL },
    { key:"water",         icon:"water.png",          leaderName:"Gym Leader Marin",  types:["water"], pool: MARIN_GYM_POOL },
    { key:"electric",      icon:"eletric.png",        leaderName:"Gym Leader Volt",   types:["electric"], pool: VOLT_GYM_POOL },
    { key:"grass-poison",  icon:"grass-poison.png",   leaderName:"Gym Leader Thistle", types:["grass","poison"], pool: THISTLE_GYM_POOL },
    { key:"fairy",         icon:"fairy.png",          leaderName:"Gym Leader Lumen",  types:["fairy"], pool: FAIRY_GYM_POOL },
    { key:"ice-flying",    icon:"ice-flying.png",     leaderName:"Gym Leader Gale",   types:["ice","flying"], pool: GALE_GYM_POOL },
    { key:"ghost-psychic", icon:"ghost-psychic.png",  leaderName:"Gym Leader Nyx",    types:["ghost","psychic"], pool: NYX_GYM_POOL },
    { key:"steel-dark",    icon:"steel-dark.png",     leaderName:"Gym Leader Rook",   types:["steel","dark"], pool: ROOK_GYM_POOL },
    { key:"dragon",        icon:"Dragon.png",         leaderName:"Gym Leader Wyrm",   types:["dragon"], pool: WYRM_GYM_POOL },
    { key:"flying",        icon:"talon.png",          leaderName:"Gym Leader Talon",  types:["flying"], pool: TALON_GYM_POOL },
    { key:"ghost-grass",   icon:"hollow.png",         leaderName:"Gym Leader Hollow", types:["ghost","grass"], pool: HOLLOW_GYM_POOL },
    { key:"bug-poison",    icon:"Blight.png",         leaderName:"Gym Leader Blight", types:["bug","poison"], pool: BLIGHT_GYM_POOL },
    { key:"rock-water",    icon:"reef.png",           leaderName:"Gym Leader Reef",   types:["rock","water"], pool: REEF_GYM_POOL },
    { key:"bug-fighting",  icon:"Mantis.png",         leaderName:"Gym Leader Mantis", types:["fighting"], pool: MANTIS_GYM_POOL },
    { key:"plain",         icon:"ivory.png",          leaderName:"Gym Leader Ivory",  types:["normal"], pool: IVORY_GYM_POOL },
    { key:"poison-dark",   icon:"hex.png",            leaderName:"Gym Leader Hex",    types:["poison","dark"], pool: HEX_GYM_POOL },
    { key:"water-ice",     icon:"floe.png",           leaderName:"Gym Leader Floe",   types:["water","ice"], pool: FLOE_GYM_POOL },
  ];
  const BADGE_ICON_DIR = "assets/badges";

  // Difficulty scales with how many badges the player has already earned
  // this run (index = runBadges at challenge time), not with which specific
  // badge is picked — so badge #1 you choose is always easy, badge #8 is
  // always hard, regardless of type. Squad size is still capped by the
  // player's own party size at battle time.
  // Classic-only softening: Pro/Nuzlocke keep the full bands above, Classic
  // gets its gym/route BST bands cut ~9% and Elite Four's cut ~4% (kept
  // smaller so the Elite Four stays the real final gauntlet). Applied via
  // softenTierBst() at each read site rather than duplicating the arrays.
  const CLASSIC_GYM_ROUTE_BST_SOFTEN = 0.91;
  const CLASSIC_ELITE_FOUR_BST_SOFTEN = 0.96;
  function classicBstFactor(){ return gameMode === 'classic' ? CLASSIC_GYM_ROUTE_BST_SOFTEN : 1; }
  function classicEliteBstFactor(){ return gameMode === 'classic' ? CLASSIC_ELITE_FOUR_BST_SOFTEN : 1; }
  function softenTierBst(tier, factor){
    return factor === 1 ? tier : { ...tier, minBst: tier.minBst * factor, maxBst: tier.maxBst * factor };
  }

  const GYM_DIFFICULTY_TIERS = [
    { minBst:280, maxBst:360, squadSize:2 },
    { minBst:320, maxBst:400, squadSize:2 },
    { minBst:360, maxBst:440, squadSize:3 },
    { minBst:400, maxBst:470, squadSize:3 },
    { minBst:430, maxBst:480, squadSize:4 },
    { minBst:460, maxBst:510, squadSize:4 },
    { minBst:490, maxBst:540, squadSize:6 },
    { minBst:520, maxBst:570, squadSize:6 },
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
    { name:"Elite Four Seraphine", minBst:520, maxBst:575, squadSize:6 },
    // Nudged down from 550-610 — that band nearly fully overlapped Ilyra's
    // widened 560-700 pool (21 of her 22 non-legendary candidates also fell
    // in Draven's old band), making a repeat between them likely. 530-590
    // stays clear of the 600 BST pseudo-legendary cluster Ilyra leans on,
    // cutting that overlap roughly in half while tripling Draven's own pool.
    { name:"Elite Four Draven",  minBst:530, maxBst:570, squadSize:6 },
    { name:"Elite Four Ilyra, the Unbeaten", minBst:560, maxBst:650, squadSize:6 },
  ];
  // Ilyra-only bonus additions to the final Elite Four member's pool (see
  // rollEliteMember()'s isFinal branch) — the Musketeer/Tapu/Treasures of
  // Ruin trios, all otherwise excluded from every non-Legendary-encounter
  // battle by wildPool()'s p.legendary check. A random, occasional pick
  // alongside her usual roster, not a guarantee — same odds as any other
  // squad member in the widened 560-700 band.
  const ILYRA_BONUS_LEGENDARIES = [
    "cobalion", "terrakion", "virizion",
    "tapu-koko", "tapu-lele", "tapu-bulu", "tapu-fini",
    "wo-chien", "chien-pao", "ting-lu", "chi-yu",
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

  // Ditto, Smeargle, Cosmog, and Cosmoem have no real damaging move in any
  // mainline game (Wobbuffet/Wynaut/Pyukumuku were in the same boat but got
  // Counter/Mirror Coat hand-injected, see COUNTER_MOVE_DEFS, since those
  // two moves at least exist for them), so instead of fabricating a
  // non-canonical moveset for these 4, they're kept out of every
  // encounter/battle pool entirely, same treatment as the Gmax forms that
  // were already unreachable. Still valid entries in data/pokemon.json
  // (Mega/evolution lookups etc. don't care), just never dealt out.
  const NO_MOVESET_UNREACHABLE = ["ditto", "smeargle", "cosmog", "cosmoem"];

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
  // `portrait` is an explicit filename (not the usual trainerPortraitFile()
  // convention — none of these three match "exact display name + .png",
  // e.g. Sereia's is "CaptainSereia.png" with no space) for the in-battle
  // head art, same treatment route trainers already get.
  const CRUISE_SHIP_BATTLES = [
    { name:"Deckhand Milo",      minBst:300, maxBst:380, squadSize:4, portrait:"Milo-battle.png" },
    // A real Double Battle: exactly 2 Pokémon a side, both active and
    // fighting simultaneously — see startDoubleBattle()/doubleBattleStep().
    { name:"First Mate Thaise",  minBst:420, maxBst:500, squadSize:2, isDouble:true, portrait:"Thaise.png" },
    // Guaranteed Mega slot — see CAPTAIN_SEREIA_MEGA_POOL below.
    { name:"Captain Sereia",     minBst:490, maxBst:570, squadSize:6, isCaptain:true, portrait:"CaptainSereia.png" },
  ];
  // Captain Sereia's guaranteed Mega (see rollCruiseBattle()'s isCaptain
  // branch) — Tatsugiri only has official artwork for its "stretchy" form's
  // Mega (see MEGA_FORMS_MISSING_ART), so that's the one used here.
  const CAPTAIN_SEREIA_MEGA_POOL = ["starmie-mega", "sharpedo-mega", "gyarados-mega", "tatsugiri-stretchy-mega"];
  const CRUISE_RIVAL = { name:"Fukugawa", minBst:500, maxBst:580, squadSize:6 };
  // Fukugawa's signature Pokémon — first shown as a regular Absol at the
  // route-7 cameo (see RIVAL_CAMEO_ENCOUNTER_NUM), then Mega Evolved by the
  // time he's fought for real on the Cruise (see rollCruiseRival()), so it
  // reads as the same character's partner growing between encounters
  // instead of two unrelated random teams.
  const CRUISE_RIVAL_SIGNATURE_SPECIES = "absol";
  const CRUISE_RIVAL_SIGNATURE_MEGA = "absol-mega-z";
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
  // A loss here just ends the run (see afterBattle()'s `if(!won)` check,
  // which fires before the wasRival branch), so this only ever needs a win
  // reaction — shown right after the battle via openRivalPostBattleDialogue().
  const RIVAL_POST_BATTLE_DIALOGUE = [
    "...Tch. Fine. You win this one.",
    "Heh. Guess I underestimated you. Don't let it go to your head.",
    "Not bad. But the Elite Four will finish what I couldn't.",
  ];

  // The Rival's first appearance — a scripted route encounter instead of a
  // random trainer (see rollTrainer()'s special case), fixed at a specific
  // encounter number the same way DOUBLE_BATTLE_ENCOUNTER_NUM is. His squad
  // here always includes his signature Absol (see CRUISE_RIVAL_SIGNATURE_MEGA)
  // alongside one normally-rolled Pokémon.
  const RIVAL_CAMEO_ENCOUNTER_NUM = 7;
  const RIVAL_CAMEO_SQUAD_SIZE = 5;
  const RIVAL_FIRST_MEETING_DIALOGUE = [
    "Hold up. You're doing this Pokémon League thing too?",
    "Heh, small world. Name's Fukugawa, remember it.",
    "Let's see if you're actually any good.",
  ];
  // A loss here is just a normal route-trainer loss (ends the run, same as
  // any other) — this only ever needs a win reaction.
  const RIVAL_FIRST_MEETING_POST_DIALOGUE = [
    "...Huh. Not bad. Guess I'll have to try harder next time.",
    "Tch, lucky break. Don't get used to it.",
    "Alright, you've got my attention now. See you around.",
  ];

  // Same base cast count in every mode now that extra casts are a PokeStop
  // purchase (see fishingBait in POKESTOP_SHOP_ITEMS) rather than free.
  const BASE_FISHING_CASTS = 3;
  const FISHING_CATCH_CHANCE = 0.25; // per cast — rare, but noticeably better odds than a shiny

  // ---------- SAFARI ZONE (instant mini-event, bought at the PokeStop) ----------
  // Unlike the Cruise Ship Ticket, this fires immediately on purchase: 3
  // back-to-back single-target catch encounters using their own dedicated
  // Safari Balls/Berries/Rocks (not the player's real inventory), then
  // straight back to the same PokeStop screen they bought it from.
  const SAFARI_TICKET_COST = 250;

  // The actual roster, not a BST band — sourced from the real Safari Zones
  // across the mainline games (Kanto R/B/Y/FRLG, Hoenn R/S/E, Sinnoh's Great
  // Marsh D/P/Pt, Johto's HG/SS Safari Zone), merged and de-duplicated. Caps
  // out at Gyarados (540 BST); nothing here is a fully-evolved
  // pseudo-legendary (Dratini/Dragonair but not Dragonite, Larvitar but not
  // Tyranitar, Bagon/Shelgon but not Salamence, Gible but not Garchomp) —
  // that ceiling falls out naturally from using the real rosters instead of
  // a hand-picked BST cutoff.
  const SAFARI_ZONE_POOL = [
    'nidoran-f','nidoran-m','nidorina','nidorino','paras','parasect','venonat','venomoth','exeggcute','rhyhorn',
    'chansey','tangela','scyther','pinsir','doduo','dodrio','kangaskhan','tauros','seaking','magikarp',
    'poliwag','goldeen','psyduck','golduck','slowpoke','krabby','dratini','dragonair',
    'oddish','geodude','hoothoot','ledyba','spinarak','wooper','mareep','sunkern','pikachu','natu',
    'marill','pineco','snubbull','shuckle','remoraid','gloom','teddiursa','houndour','phanpy','quagsire',
    'xatu','octillery','girafarig','gligar','aipom','wobbuffet','heracross','stantler','miltank',
    'arbok','gyarados','noctowl','yanma','shroomish','azurill','roselia','gulpin','carvanha','barboach',
    'whiscash','kecleon','tropius','starly','staravia','bidoof','bibarel','budew','skorupi','drapion',
    'croagunk','toxicroak','carnivine',
    'pidgey','rattata','raticate','spearow','fearow','ekans','sandshrew','sandslash','clefairy','jigglypuff',
    'zubat','golbat','diglett','poliwhirl','abra','machop','machoke','bellsprout','weepinbell','graveler',
    'ponyta','slowbro','magnemite','magneton','farfetchd','grimer','muk','gastly','haunter','onix',
    'drowzee','hypno','kingler','voltorb','cubone','marowak','lickitung','koffing','weezing','rhydon',
    'mr-mime','electabuzz','magmar','lapras','ditto','sentret','furret','hoppip','skiploom','jumpluff',
    'murkrow','misdreavus','smeargle','larvitar','zigzagoon','linoone','lotad','lombre','seedot','nuzleaf',
    'surskit','masquerain','breloom','vigoroth','nosepass','aron','lairon','meditite','medicham','electrike',
    'manectric','volbeat','illumise','torkoal','spinda','trapinch','vibrava','cacnea','cacturne','zangoose',
    'seviper','lunatone','solrock','corphish','shuppet','banette','duskull','dusclops','chimecho','spheal',
    'sealeo','bagon','shelgon','beldum','metang','shinx','luxio','pachirisu','buizel','floatzel',
    'chingling','bronzor','bronzong','gible','riolu','hippopotas',
  ];
  // Same ownership/reachability filters catchablePool() applies, just
  // sourced from the curated list above instead of the full dex.
  function safariPool(){
    return SAFARI_ZONE_POOL.map(n => POKEMON_BY_NAME[n]).filter(p => p
      && !NO_MOVESET_UNREACHABLE.includes(p.name)
      && !activeTeam.some(c => c.name === p.name)
      && !storage_.some(c => c.name === p.name));
  }
  const SAFARI_BALL_COUNT = 15;
  const SAFARI_BERRY_COUNT = 5;
  const SAFARI_ENCOUNTERS = 3;
  const SAFARI_BALL_MODIFIER = 1.0;
  const SAFARI_BERRY_BOOST = 1.3;
  const SAFARI_BASE_IMG = "assets/pokemon-game-assets/Graphics/Battlebacks/grass_eve_base1.png";
  const SAFARI_BALL_ICON = "assets/pokemon-game-assets/Graphics/Items/SAFARIBALL.png";
  const SAFARI_BAIT_ICON = "assets/pokemon-game-assets/Graphics/Battle animations/safari_bait.png";
  const SAFARI_FLEE_CHANCE = 0.15;

  // ---------- MEGA EVOLUTION ----------
  // The only way to get one: the Mega Stone reward from beating Captain
  // Sereia, used deliberately from the Computer screen on any eligible
  // active-team member (see useMegaStone()). No passive/automatic chance —
  // Mega Evolution is a one-shot, player-chosen upgrade.

  const IMG_DIR = "pixel_pack/front-default";
  const IMG_DIR_SHINY = "pixel_pack/shiny";
  const IMG_DIR_BACK = "pixel_pack/back";
  const WILD_COUNT = 9; // shown as three rows of 3
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
  const NATIONAL_DEX_MAX = 1025; // excludes megas/gmax/battle-only forms from the pool (regional forms are let back in separately — see isRegionalForm())
  // Alola/Galar/Hisui/Paldea forms live above NATIONAL_DEX_MAX alongside
  // Mega/Gmax/battle-only forms (Rotom, Deoxys, etc.), so wildPool() needs
  // its own check to let just these back in as full recurring species —
  // catchable in the wild and fieldable by any trainer/gym, same as any
  // other reachable Pokémon. Excludes "-alola-cap" (Cosplay/Cap Pikachu are
  // cosmetic reskins, not a real regional form).
  const NON_SUFFIX_REGIONAL_FORMS = new Set([
    // darmanitan-galar-standard's suffix isn't last — Zen Mode (battle-only,
    // like base Darmanitan's own "-zen") stacks after it. Its own
    // darmanitan-galar-zen counterpart stays excluded, same as darmanitan-zen.
    'darmanitan-galar-standard',
    // Tauros' 3 Paldean breeds don't end in "-paldea" (breed name comes
    // after), unlike every other Paldean regional form (e.g. wooper-paldea).
    'tauros-paldea-combat-breed', 'tauros-paldea-blaze-breed', 'tauros-paldea-aqua-breed',
  ]);
  function isRegionalForm(name){
    if(name.includes('totem')) return false; // Totem forms (trial-boss-only, e.g. raticate-totem-alola) aren't a real regional form
    return /-(alola|galar|hisui|paldea)$/.test(name) || NON_SUFFIX_REGIONAL_FORMS.has(name);
  }
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
    { minBst:320, maxBst:410 }, // 5-Pokémon squad
    { minBst:380, maxBst:460 }, // 6-Pokémon squad — hardest route trainer of the run
  ];
  const MAX_PARTY_SIZE = 6; // active roster cap — overflow catches go to Storage
  const FALLBACK_MOVE = { name:"tackle", type:"normal", power:40, accuracy:100, damage_class:"physical" };
  const SHINY_CHANCE = 1/512;
  // Trainer squads get their own shiny rate, above the normal wild-encounter
  // one: Hill Challengers roll the highest (they're the "defend your title"
  // endgame loop), everyone else who fields a squad (route trainers, Gym
  // Leaders, Elite Four, Cruise Ship battles, Rival) rolls the standard
  // trainer rate. See rollTrainerShinySquad().
  const HILL_SHINY_CHANCE = SHINY_CHANCE * 1.20;
  const TRAINER_SHINY_CHANCE = SHINY_CHANCE * 1.10;

  // Species with no shiny artwork file at all (see imagePath()/IMG_DIR_SHINY)
  // -- mostly cosmetic/event variants (Cap Pikachu, starter Pikachu/Eevee),
  // battle-only forms (Mimikyu's busted disguise, Koraidon/Miraidon's
  // in-battle build/mode states), and 2 Mega forms already excluded from
  // Mega Evolution itself for the same reason (see MEGA_FORMS_MISSING_ART).
  // Every shiny roll in the game is gated through canBeShiny() below so none
  // of these can ever come up shiny and show a blank avatar.
  const NO_SHINY_ART = new Set([
    "meowstic-female", "pikachu-cosplay", "mimikyu-busted", "mimikyu-totem-busted",
    "pikachu-partner-cap", "pikachu-starter", "eevee-starter", "pikachu-world-cap",
    "zarude-dada", "dudunsparce-three-segment", "maushold-family-of-three",
    "koraidon-limited-build", "koraidon-sprinting-build", "koraidon-swimming-build",
    "koraidon-gliding-build", "miraidon-low-power-mode", "miraidon-drive-mode",
    "miraidon-aquatic-mode", "miraidon-glide-mode", "terapagos-stellar",
    "garchomp-mega-z", "magearna-original-mega", "tatsugiri-curly-mega", "tatsugiri-droopy-mega",
  ]);
  function canBeShiny(mon){ return !NO_SHINY_ART.has(mon.name); }

  // Applies a per-member shiny roll to a freshly-built trainer squad, used
  // by every squad-building roll that should get one (see TRAINER_SHINY_CHANCE
  // above for who). Returns a new array, never mutates the input squad.
  function rollTrainerShinySquad(squad, chance){
    return squad.map(p => (canBeShiny(p) && Math.random() < chance) ? { ...p, is_shiny:true } : p);
  }

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
  const DICE_PAYOUTS = { triple6:90, triple1:75, triple:30, straight:15, pair:6, none:0 };

  // Renders CREDIT/PAYOUT as LED-style digits cropped from the Slot Machine
  // pack's numbers.png (10 digits, 14px each, single row) instead of plain
  // text — zero-padded like the original cabinet's fixed-width display.
  function ledDigitsHTML(value, digits){
    const str = String(Math.max(0, Math.floor(value))).padStart(digits, '0').slice(-digits);
    return [...str].map(ch => `<span class="led-digit" style="background-position:-${Number(ch) * 14}px 0;"></span>`).join('');
  }

  // Casino Token Shop — spend Tokens earned from the slot machine. The
  // Token Exchange is deliberately the priciest, hardest-to-reach item: a
  // random shiny, fully-evolved (non-Mythical, non-Legendary) Pokémon.
  // Prices rebased for the Lucky Dice mini-game's much higher EV/roll than
  // the old slot machine had (~6.6 vs ~0.39 Tokens per spin) — scaled to
  // keep the same relative reach as before against the new, larger typical
  // Token pool, not a flat multiple of the old prices.
  const TOKEN_SHOP_ITEMS = {
    potions: { label:"Potion", invKey:"potions", cost:65, desc:"" },
    revives: { label:"Revive", invKey:"revives", cost:110, desc:"" },
    tokenExchange: { label:"Key Prize", cost:250, isExchange:true, desc:"Sparkly." },
  };

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
  // Potion/Revive have no per-battle usage cap — only limited by how many
  // the player is carrying in inv.potions/inv.revives, matching mainline.
  // Single battles only (Doubles have no bench to switch in from — see
  // startDoubleBattle()). Separate from the *forced* faint switch
  // (battle.awaitingSwitch/switchActivePokemon()), which is unlimited —
  // this caps voluntarily pulling out a still-healthy Pokémon.
  // Per-mode caps, eased for entry-level modes so new players aren't pushed
  // off early: Classic (full visibility, no permadeath) gets the most slack,
  // Pro a bit less since blind picks already make counter-switching riskier,
  // and Nuzlocke has no cap at all (permadeath plus no Revive makes any cap
  // too punishing to reliably reach the endgame with).
  const CLASSIC_MAX_VOLUNTARY_SWITCHES_PER_BATTLE = 3;
  const PRO_MAX_VOLUNTARY_SWITCHES_PER_BATTLE = 2;
  function maxVoluntarySwitchesPerBattle(){
    if(gameMode === 'nuzlocke') return Infinity;
    return gameMode === 'pro' ? PRO_MAX_VOLUNTARY_SWITCHES_PER_BATTLE : CLASSIC_MAX_VOLUNTARY_SWITCHES_PER_BATTLE;
  }
  // How long the player has to tap Potion/Revive between auto-battle turns
  // (was a flat 700ms gap — now that plus 1 extra second of reaction time).
  const ITEM_WINDOW_MS = 700 + 1000;

  // ---------- SPECIES SPECIAL ABILITIES ----------
  // Small, lore-flavored passive bonuses for a handful of Pokémon. Checked
  // by species name against activeTeam (the player's whole roster) for
  // anything that isn't tied to a specific ongoing battle; Audino's heal
  // proc is the one exception (see maybeAudinoHeal()) since it needs to
  // know about this battle's actual fainted/HP state, not just team
  // membership. Kept deliberately minor everywhere — a nudge, never a
  // build-defining strategic lever.
  function hasActiveSpecies(matchFn){
    return activeTeam.some(m => matchFn(m.name));
  }

  const GHOLDENGO_GOLD_BONUS = 1.05; // made of 999 coins
  function applyGoldBonus(amount){
    return hasActiveSpecies(n => n === 'gholdengo') ? Math.round(amount * GHOLDENGO_GOLD_BONUS) : amount;
  }

  const SMEARGLE_SHOP_DISCOUNT = 0.9; // "can learn any move, badly" — a jack of all trades

  const SHUCKLE_POTION_HEAL_BONUS = 1.1; // ferments berries inside its shell
  // Nuzlocke has no Revive at all, so its Potion is a full heal instead of
  // the usual half (functionally a Max Potion), while still sharing the
  // same inv.potions stock as every other mode. See usePotion().
  function potionHealFraction(){
    if(gameMode === 'nuzlocke') return 1;
    return hasActiveSpecies(n => n === 'shuckle') ? POTION_HEAL_FRACTION * SHUCKLE_POTION_HEAL_BONUS : POTION_HEAL_FRACTION;
  }

  const ALCREMIE_FOOD_BOOST_BONUS = 1.25; // made of cream and sweets

  const FEEBAS_MILOTIC_FISHING_BONUS = 1.2; // homebody of the water, hard to catch but easy to find
  // Applies to the Fishing mini-event's per-cast bite chance only (see
  // castFishingLine()) — the wild-encounter/catch-screen flow is unaffected.
  function fishingCatchChance(){
    return hasActiveSpecies(n => n === 'feebas' || n === 'milotic')
      ? FISHING_CATCH_CHANCE * FEEBAS_MILOTIC_FISHING_BONUS
      : FISHING_CATCH_CHANCE;
  }

  const DITTO_COPY_CHANCE = 0.10; // transforms into / copies whatever it's near

  const MUNCHLAX_SNORLAX_ITEM_CHANCE = 0.15; // perpetually hungry
  // Called once per battle win, regardless of trainer type — a small
  // chance of a free Berry Snack or Poke Treat, on top of whatever else
  // that win already rewards.
  function maybeGrantMunchlaxBonusItem(){
    const munchmon = ['munchlax', 'snorlax'].find(n => hasActiveSpecies(name => name === n));
    if(!munchmon) return;
    if(Math.random() >= MUNCHLAX_SNORLAX_ITEM_CHANCE) return;
    const kind = pick(['berrySnack', 'pokeTreat']);
    inv[kind] = (inv[kind] || 0) + 1;
    appendBattleLog(`${displayName(munchmon)}'s appetite pays off, found a free ${FOOD_ITEMS[kind].label}!`, '', 'win');
  }

  const AUDINO_HEAL_CHANCE = 0.12; // Pokémon Center/nurse-coded design
  const AUDINO_HEAL_FRACTION = 0.25;
  // Checked every turn (see afterExchange()) — Audino just needs to be on
  // this battle's roster and still standing, not necessarily the one
  // currently fighting. Heals whichever teammate (itself included) is
  // below half max HP by a modest amount, half of what an actual Potion
  // heals, so it's a nice occasional assist, not a replacement for one.
  function maybeAudinoHeal(){
    if(!battle || battle.over) return;
    const audino = battle.player.find(b => b.hp > 0 && (b.mon.name === 'audino' || b.mon.name === 'audino-mega'));
    if(!audino) return;
    if(Math.random() >= AUDINO_HEAL_CHANCE) return;
    const target = battle.player
      .filter(b => b.hp > 0 && b.hp / b.maxHp < 0.5)
      .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
    if(!target) return;
    const healed = Math.round(target.maxHp * AUDINO_HEAL_FRACTION);
    target.hp = Math.min(target.maxHp, target.hp + healed);
    appendBattleLog(`Audino tends to ${displayName(target.mon.name)}!`, `Recovered ${healed} HP.`, 'heal');
    renderHpPanel();
    flashPartySlot(battle.player.indexOf(audino));
  }

  // Briefly glows a party member's slot in the switch strip, used to call
  // out an ability proc (e.g. Audino's heal) the player might otherwise miss.
  function flashPartySlot(idx){
    const slot = document.querySelector(`#teamSwitchStrip .switch-slot[data-idx="${idx}"]`);
    if(!slot) return;
    slot.classList.remove('ability-flash');
    void slot.offsetWidth; // restart the animation if it's already mid-flash
    slot.classList.add('ability-flash');
  }

  const CHANSEY_BLISSEY_ITEM_CHANCE = 0.15; // nurse/caretaker Pokémon
  // Same "bonus item after any battle win" shape as Munchlax/Snorlax, but
  // medical items (Potion/Revive) instead of food, and its own independent
  // roll so having both on the team doesn't cancel either out.
  function maybeGrantChanseyBonusItem(){
    const nursemon = ['chansey', 'blissey'].find(n => hasActiveSpecies(name => name === n));
    if(!nursemon) return;
    if(Math.random() >= CHANSEY_BLISSEY_ITEM_CHANCE) return;
    const kind = pick(['potions', 'revives']);
    inv[kind] = (inv[kind] || 0) + 1;
    const label = kind === 'potions' ? 'Potion' : 'Revive';
    appendBattleLog(`${displayName(nursemon)} restocks the first-aid kit, found a free ${label}!`, '', 'win');
  }

  const TRUBBISH_GARBODOR_ITEM_CHANCE = 0.15; // formed from a pile of trash
  // Same shape again, this time digging up a spare Poké Ball/Great Ball.
  function maybeGrantTrubbishBonusItem(){
    const trashmon = ['trubbish', 'garbodor'].find(n => hasActiveSpecies(name => name === n));
    if(!trashmon) return;
    if(Math.random() >= TRUBBISH_GARBODOR_ITEM_CHANCE) return;
    const kind = pick(['balls', 'greatBalls']);
    inv[kind] = (inv[kind] || 0) + 1;
    const label = kind === 'balls' ? 'Pokéball' : 'Great Ball';
    appendBattleLog(`${displayName(trashmon)} digs a spare ${label} out of the trash!`, '', 'win');
  }

  const DELIBIRD_GOLD_CHANCE = 0.15; // canonically a gift-delivery Pokémon
  const DELIBIRD_GOLD_MIN = 20;
  const DELIBIRD_GOLD_MAX = 40;
  // A flat Gold "gift" after a win, distinct from Gholdengo's every-time
  // percentage bonus — this one is a chance-based fixed amount instead.
  function maybeGrantDelibirdGift(){
    if(!hasActiveSpecies(n => n === 'delibird')) return;
    if(Math.random() >= DELIBIRD_GOLD_CHANCE) return;
    const gift = randInt(DELIBIRD_GOLD_MIN, DELIBIRD_GOLD_MAX);
    runGoldEarned += gift;
    META.gold += gift;
    saveMeta();
    appendBattleLog(`Delibird hands you a gift, +${gift}G!`, '', 'win');
  }

  const KLEFKI_CATCH_BONUS = 1.05; // "unlocks" things — picks the lock a little
  // Nuzlocke: missing a catch or losing one to a flee is permanent (no
  // second pass at that species later), so both odds get a nudge in this
  // mode specifically. Stacks multiplicatively with Klefki like any other
  // catch-chance bonus.
  const NUZLOCKE_CATCH_CHANCE_BONUS = 1.02; // was 1.2 (a +20% bonus); cut the bonus itself by 15% relative (1.2*0.85=1.02), leaving only a +2% bonus
  const NUZLOCKE_BALL_FLEE_MULTIPLIER = 0.5;
  function catchChanceMultiplier(){
    let mult = hasActiveSpecies(n => n === 'klefki') ? KLEFKI_CATCH_BONUS : 1;
    if(gameMode === 'nuzlocke') mult *= NUZLOCKE_CATCH_CHANCE_BONUS;
    return mult;
  }
  function ballBaseFleeChance(){
    return gameMode === 'nuzlocke' ? BALL_BASE_FLEE_CHANCE * NUZLOCKE_BALL_FLEE_MULTIPLIER : BALL_BASE_FLEE_CHANCE;
  }

  const SABLEYE_TOKEN_BONUS = 1.10; // eats gems, lives in treasure-filled caves
  function applyTokenBonus(amount){
    return hasActiveSpecies(n => n === 'sableye') ? Math.round(amount * SABLEYE_TOKEN_BONUS) : amount;
  }

  const DUDUNSPARCE_REROLL_CHANCE = 0.10; // "lucky to even see one" folklore
  // Checked once per new wild encounter (see startEncounter()) — a small
  // chance of a completely free bonus Reroll Ticket for that encounter,
  // on top of whatever the player is already carrying.
  function maybeGrantDudunsparceReroll(){
    if(!hasActiveSpecies(n => n === 'dudunsparce' || n === 'dudunsparce-two-segment' || n === 'dudunsparce-three-segment')) return;
    if(Math.random() >= DUDUNSPARCE_REROLL_CHANCE) return;
    inv.rerollTickets = (inv.rerollTickets || 0) + 1;
    flagComputerNotification();
  }

  const FARFETCHD_NAMES = ['farfetchd', 'farfetchd-galar', 'sirfetchd'];
  const FARFETCHD_CRIT_CHANCE = 0.10; // its leek is literally its weapon
  const FARFETCHD_CRIT_MULTIPLIER = 1.5;
  // Only the player's own attacks can crit, and only with one of these on
  // the team — there's no baseline crit mechanic in this game otherwise,
  // this is a species-specific unlock, not a new universal battle rule.
  function isPlayerAttacker(attacker){
    return !!(battle && battle.player && battle.player.includes(attacker));
  }

  // Ball throw modifiers — multiply directly against the target's base_species_rate.
  // Master Ball bypasses the formula entirely (guaranteed catch).
  const BALL_MODIFIERS = { balls:1.0, greatBalls:1.5, ultraBalls:2.0, masterBalls:Infinity };
  const BALL_LABELS = { balls:"Pokéball", greatBalls:"Great Ball", ultraBalls:"Ultra Ball", masterBalls:"Master Ball" };

  // Food items: single-use, stackable, bought at the PokeStop. Each boost is a
  // multiplicative catch-chance modifier; flee reduction only matters on a
  // failed throw (see BALL_BASE_FLEE_CHANCE).
  const FOOD_ITEMS = {
    berrySnack:  { label:"Berry Snack",  cost:30,  boost:1.10, fleeReduction:0,    noCritFlee:false },
    // Buffed relative to Berry Snack: at 3x the cost it should feel like a
    // real premium pick, not a marginal upgrade — 1.5x catch chance (was
    // 1.25x) and flee reduction raised to fully cancel BALL_BASE_FLEE_CHANCE
    // (0.15), so a failed throw can never lose the target outright this encounter.
    pokeTreat:   { label:"Poke Treat",   cost:90, boost:1.5, fleeReduction:0.15, noCritFlee:false },
  };

  // PokeStop shop (mid-run): one-off consumables added straight to the current run's inventory.
  // `category` sorts each item into one of the PokeStop's 3 shop tabs.
  const POKESTOP_SHOP_ITEMS = {
    balls:       { label:"Pokéball",     invKey:"balls",       cost:10,  category:"balls", desc:"Round and classic." },
    greatBalls:  { label:"Great Ball",   invKey:"greatBalls",  cost:25,  category:"balls", desc:"Still round." },
    ultraBalls:  { label:"Ultra Ball",   invKey:"ultraBalls",  cost:45,  category:"balls", desc:"More rounder I guess.." },
    berrySnack:  { label:"Berry Snack",  invKey:"berrySnack",  cost:30,  category:"berries", desc:"Small catch-chance boost for one throw." },
    pokeTreat:   { label:"Poke Treat",   invKey:"pokeTreat",   cost:90, category:"berries", desc:"Big 1.5x catch boost, target won't flee on a miss." },
    potions:     { label:"Potion",       invKey:"potions",     cost:15,  category:"items", lifetimeMax:8, desc:"Heals a Pokémon for half its max HP." },
    revives:     { label:"Revive",       invKey:"revives",     cost:30,  category:"items", lifetimeMax:3, desc:"Brings a fainted Pokémon back at half HP." },
    rerollTickets: { label:"Reroll Ticket", invKey:"rerollTickets", cost:40, category:"others", desc:"Rerolls the current wild encounter list." },
    safariTicket: { label:"Safari Zone Ticket", invKey:"safariTicket", cost:SAFARI_TICKET_COST, category:"others", instant:true, lockAfterBadges:8, lifetimeMax:1, desc:"One visit to the Safari Zone." },
    // category:"fishing" (not one of SHOP_TABS' 4 keys below) keeps this out
    // of the PokeStop's own shop tabs entirely — it's only ever sold from
    // the Pesca Shop on the Fishing screen itself (see renderFishingShop()),
    // reusing this same entry (cost/lifetimeMax/lock rules) rather than
    // duplicating them.
    // No lifetimeMax — unlike the other one-off consumables here, Fishing
    // Bait can be bought as many times as the player has Gold for.
    fishingBait: { label:"Fishing Bait", invKey:"fishingBait", cost:30, category:"fishing", desc:"One more cast off the deck." },
  };
  // PokeStop prices scale with game mode, relative to Classic's listed cost
  // above (Nuzlocke's 1.5x is not stacked on top of Pro's 1.2x, each mode's
  // multiplier applies independently to the same base numbers).
  const SHOP_PRICE_MULTIPLIER = { classic:1, pro:1.2, nuzlocke:1.5 };
  function shopPrice(item){
    const smeargleDiscount = hasActiveSpecies(n => n === 'smeargle') ? SMEARGLE_SHOP_DISCOUNT : 1;
    return Math.round(item.cost * (SHOP_PRICE_MULTIPLIER[gameMode] || 1) * smeargleDiscount);
  }

  const SHOP_TABS = [
    { key:"balls",  label:"Pokéballs" },
    { key:"berries", label:"Berrys" },
    { key:"items",  label:"Itens" },
    { key:"others", label:"Tickets" },
  ];

  // Icon art for the items we have matching PNGs for (assets/items/*.png).
  // Anything not listed here just renders with its text label, no icon.
  const ITEM_ICON_DIR = "assets/items";
  const ITEM_ICONS = {
    balls:       "assets/pokeballs/pokeball.png",
    greatBalls:  "assets/pokeballs/greatball.png",
    ultraBalls:  "assets/pokeballs/ultraball.png",
    potions:     "assets/pokemon-game-assets/Graphics/Items/POTION.png",
    maxPotions:  "assets/pokemon-game-assets/Graphics/Items/MAXPOTION.png",
    revives:     "assets/pokemon-game-assets/Graphics/Items/REVIVE.png",
    pokeTreat:   "poketreat.png",
    berrySnack:  "berry.png",
    masterBalls: "masterball.png",
    rerollTickets: "Reroll-ticket.png",
    safariTicket: "safari-ticket.png",
    tokenExchange: "Prize.png",
    fishingBait: "bait.png",
  };
  function itemIconHTML(invKey){
    const file = ITEM_ICONS[invKey];
    if(!file) return '';
    const src = file.includes('/') ? file : `${ITEM_ICON_DIR}/${file}`;
    return `<img class="item-icon" src="${src}" alt="" onerror="this.style.display='none'">`;
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
  // base species name -> real Mega Stone icon filename (assets/mega_stones),
  // for the ~46 species whose Mega Evolution actually exists in the mainline
  // games. This game invents a lot of extra, fan-made Mega forms on top of
  // that (see the data files) — anything not listed here just falls back to
  // the generic MEGARING.png badge in teamBoxHTML() instead of a fabricated
  // stone icon. Charizard/Mewtwo have 2 real stones (X/Y) — the badge only
  // ever shows one representative icon regardless of which the player ends
  // up picking in openMegaFormChoice(), picking X arbitrarily.
  const MEGA_STONE_ICON_DIR = "assets/mega_stones";
  const MEGA_STONE_ICON_BY_BASE = {
    abomasnow: "abomasite.png", absol: "absolite.png", aerodactyl: "aerodactylite.png",
    aggron: "aggronite.png", alakazam: "alakazite.png", altaria: "altarianite.png",
    ampharos: "ampharosite.png", audino: "audinite.png", banette: "banettite.png",
    beedrill: "beedrillite.png", blastoise: "blastoisinite.png", blaziken: "blazikenite.png",
    camerupt: "cameruptite.png", charizard: "charizardite-x.png", diancie: "diancite.png",
    gallade: "galladite.png", garchomp: "garchompite.png", gardevoir: "gardevoirite.png",
    gengar: "gengarite.png", glalie: "glalitite.png", gyarados: "gyaradosite.png",
    heracross: "heracronite.png", houndoom: "houndoominite.png", kangaskhan: "kangaskhanite.png",
    latias: "latiasite.png", latios: "latiosite.png", lopunny: "lopunnite.png",
    lucario: "lucarionite.png", manectric: "manectite.png", mawile: "mawilite.png",
    medicham: "medichamite.png", metagross: "metagrossite.png", mewtwo: "mewtwonite-x.png",
    pidgeot: "pidgeotite.png", pinsir: "pinsirite.png", sableye: "sablenite.png",
    salamence: "salamencite.png", sceptile: "sceptilite.png", scizor: "scizorite.png",
    sharpedo: "sharpedonite.png", slowbro: "slowbronite.png", steelix: "steelixite.png",
    swampert: "swampertite.png", tyranitar: "tyranitarite.png", venusaur: "venusaurite.png",
  };
  function megaStoneIconPath(baseName){
    const file = MEGA_STONE_ICON_BY_BASE[baseName];
    return file ? `${MEGA_STONE_ICON_DIR}/${file}` : "assets/pokemon-game-assets/Graphics/Items/MEGARING.png";
  }
  let STARTER_LINE_NAMES = new Set(); // every starter's base + stage1 + stage2 names — see loadData()
  // Base species names (e.g. "wormadam", "golem") that have 2+ *reachable*
  // alternate forms in this game — used only by displayName()'s generic
  // form-suffix handling, see loadData(). A base NOT in here means whatever
  // single form of it exists here is the only one the player can ever get,
  // so its slug suffix (e.g. "-disguised", "-full-belly") is just dropped
  // instead of shown as a pointless "(Form)".
  let MULTI_FORM_BASES = new Set();
  // Every species name that is *some* evolution's result (i.e. not a
  // first-stage Pokemon) — flattened from EVOLUTIONS' values, branches
  // included. Used by rollInfiniteLoopTrainer() to keep weak base-forms out
  // of Hill Challenger squads. See loadData().
  let EVOLVED_NAMES = new Set();

  async function loadData(){
    const [list, moveNamesPerMon, movesTable, evolutions] = await Promise.all([
      fetch('data/pokemon.json').then(r => r.json()),
      fetch('data/battle_moves.json').then(r => r.json()),
      fetch('data/moves.json').then(r => r.json()),
      fetch('data/evolutions.json').then(r => r.json()).catch(() => ({})),
    ]);
    POKEMON = list;
    POKEMON_BY_NAME = {};
    list.forEach(p => { POKEMON_BY_NAME[p.name] = p; });
    // data/battle_moves.json only stores each Pokémon's move *names* now
    // (data/moves.json has the shared {type,power,accuracy,damage_class} per
    // name — see build_battle_moves.py) instead of repeating each move's full
    // body for every Pokémon that can learn it. Re-joined here into the same
    // {name,type,power,accuracy,damage_class}[] shape every other function
    // in this file already expects, so nothing downstream of MOVESETS changes.
    MOVESETS = {};
    Object.entries(moveNamesPerMon).forEach(([species, names]) => {
      MOVESETS[species] = names.map(name => ({ name, ...movesTable[name] }));
    });
    EVOLUTIONS = evolutions;

    EVOLVED_NAMES = new Set();
    Object.values(EVOLUTIONS).forEach(raw => {
      (Array.isArray(raw) ? raw : [raw]).forEach(name => EVOLVED_NAMES.add(name));
    });

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

    // Wobbuffet/Wynaut/Pyukumuku have no other real damaging move (see
    // COUNTER_MOVE_DEFS above), so unlike the Sleep injection this one
    // still applies even when MOVESETS[species] doesn't exist yet.
    COUNTER_MOVE_SPECIES.forEach(species => {
      const set = MOVESETS[species] || [];
      const withCounters = [...set];
      Object.keys(COUNTER_MOVE_DEFS).forEach(moveName => {
        if(!withCounters.some(m => m.name === moveName)) withCounters.push(COUNTER_MOVE_DEFS[moveName]);
      });
      MOVESETS[species] = withCounters;
    });

    // Mega forms with no generated artwork (neither normal nor shiny) — kept
    // out of MEGA_FORMS_BY_BASE below so Mega Evolution can never pick one.
    const MEGA_FORMS_MISSING_ART = new Set(["tatsugiri-curly-mega", "tatsugiri-droopy-mega"]);

    // Stripping "-mega" from the mega's name doesn't always land on a real
    // catchable base entry (e.g. "zygarde-mega" strips to "zygarde", but this
    // dataset only has the Forme-specific "zygarde-50"), which silently
    // orphaned the mega, no base ever pointed to it. Redirects those cases to
    // their actual base name instead.
    const MEGA_BASE_OVERRIDES = { zygarde: 'zygarde-50', pyroar: 'pyroar-male' };

    MEGA_FORMS_BY_BASE = {};
    list.forEach(p => {
      if(MEGA_FORMS_MISSING_ART.has(p.name)) return;
      let base = null;
      if(/-mega-(x|y|z)$/.test(p.name)) base = p.name.replace(/-mega-(x|y|z)$/, '');
      else if(p.name.endsWith('-mega')) base = p.name.slice(0, -5);
      if(base && MEGA_BASE_OVERRIDES[base]) base = MEGA_BASE_OVERRIDES[base];
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
  function initials(name){ return name.split(/[\s-]+/).map(w=>w[0]).slice(0,2).join('').toUpperCase(); }
  function imagePath(mon, variant){
    // Back sprites have no separate shiny set, so shinies fall back to the
    // regular back art there — front sprites are unaffected.
    if(variant === 'back') return `${IMG_DIR_BACK}/${mon.name}.png`;
    return `${mon.is_shiny ? IMG_DIR_SHINY : IMG_DIR}/${mon.name}.png`;
  }

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
    'mr-mime-galar': 'Galarian Mr. Mime',
    'mr-rime': 'Mr. Rime',
    'type-null': 'Type: Null',
    'nidoran-f': 'Nidoran♀',
    'nidoran-m': 'Nidoran♂',
    'dudunsparce-two-segment': 'Dudunsparce',
    'dudunsparce-three-segment': 'Dudunsparce',
    'darmanitan-galar-standard': 'Galarian Darmanitan',
    'tauros-paldea-combat-breed': 'Paldean Tauros (Combat Breed)',
    'tauros-paldea-blaze-breed': 'Paldean Tauros (Blaze Breed)',
    'tauros-paldea-aqua-breed': 'Paldean Tauros (Aqua Breed)',
  };
  // The hyphen here IS the official spelling (Ho-Oh, Porygon-Z, the
  // Jangmo-o line, the Ruinous foursome) — capitalized via capitalizeSegments()
  // above instead of titleCaseWords(), which would collapse the hyphen to a space.
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

  // Same idea as titleCaseWords() but keeps the original hyphens/spaces in
  // place instead of collapsing everything to spaces — for names where the
  // hyphen IS part of the official spelling (Ho-Oh, Porygon-Z, ...; see
  // HYPHEN_IS_OFFICIAL_NAME below), turning "ho-oh" into "Ho-Oh" rather than
  // titleCaseWords()'s "Ho Oh".
  function capitalizeSegments(str){
    return str.replace(/(^|[- ])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
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
    if(HYPHEN_IS_OFFICIAL_NAME.has(name)) return capitalizeSegments(name);
    if(COMPOUND_NAME_SLUGS.has(name)) return titleCaseWords(name);

    const xy = name.match(/^(.+)-mega-(x|y)$/);
    if(xy) return `Mega ${titleCaseWords(xy[1])} ${xy[2].toUpperCase()}`;
    const z = name.match(/^(.+)-mega-z$/);
    if(z) return `Mega ${titleCaseWords(z[1])} Z`;
    if(name.endsWith('-mega')) return `Mega ${titleCaseWords(name.slice(0, -5))}`;

    // Generic PokeAPI "base-form" slug — only for known species (guards
    // against mangling some unrelated hyphenated string, e.g. a trainer name).
    const dash = name.indexOf('-');
    if(dash > 0 && POKEMON_BY_NAME[name]){
      const base = name.slice(0, dash);
      const suffix = name.slice(dash + 1);
      // Regional forms read as "Alolan Ninetales", matching the mainline
      // games — everything else keeps the "Base (Form)" parenthetical.
      if(REGIONAL_FORM_LABELS[suffix]) return `${REGIONAL_FORM_LABELS[suffix]} ${titleCaseWords(base)}`;
      if(!MULTI_FORM_BASES.has(base)) return titleCaseWords(base);
      return `${titleCaseWords(base)} (${titleCaseWords(suffix)})`;
    }
    // Species slugs with no form suffix at all (the common case) are always
    // lowercase in POKEMON_BY_NAME — capitalize here so every Pokémon name
    // reads correctly everywhere, not just where a CSS text-transform happens
    // to be applied. Anything else (trainer names, etc.) passes through as-is.
    if(POKEMON_BY_NAME[name]) return titleCaseWords(name);
    return name;
  }

  // Legendary/Mythical encounter reveal only — drops any "(Form)" qualifier
  // displayName() adds (e.g. Urshifu's "(Single Strike)"), since the intro is
  // a single dramatic reveal, not a form-disambiguation menu. displayName()
  // itself already returns proper casing (Ho-Oh, Necrozma, ...).
  function legendaryEncounterName(name){
    return displayName(name).replace(/\s*\([^)]*\)\s*$/, '');
  }

  // Pokémon Essentials' icon_types.png — a single 96x32-per-frame vertical
  // strip (19 frames incl. an unused "???" placeholder at index 9) with the
  // type name already baked into the art, in this fixed order.
  const TYPE_ICON_SHEET = "assets/pokemon-game-assets/Graphics/UI/Pokedex/icon_types.png";
  const TYPE_ICON_INDEX = {
    normal:0, fighting:1, flying:2, poison:3, ground:4, rock:5, bug:6, ghost:7, steel:8,
    fire:10, water:11, grass:12, electric:13, psychic:14, ice:15, dragon:16, dark:17, fairy:18,
  };
  // `small` picks the compact .type-badge-sm variant (see style.css) for
  // tight layouts like the 6-wide wild-encounter row — same sheet, just
  // scaled down further, so the frame height used for background-position
  // has to match whichever CSS size is in play.
  function typeBadgeHTML(type, small){
    const idx = TYPE_ICON_INDEX[type];
    if(idx == null) return '';
    const frameH = small ? 12 : 13;
    return `<span class="type-badge${small ? ' type-badge-sm' : ''}" style="background-position-y:-${idx * frameH}px" title="${type}"></span>`;
  }

  function typeChipsHTML(types){
    return types.map(t => typeBadgeHTML(t, false)).join('');
  }

  // Compact type indicator for tight layouts (e.g. the 6-wide wild-encounter row).
  function typeDotsHTML(types){
    return types.map(t => typeBadgeHTML(t, true)).join('');
  }

  function shinyTagHTML(mon){
    return mon.is_shiny ? '<span class="shiny-tag">SHINY</span>' : '';
  }

  function avatarHTML(mon, sizeClass, spriteVariant, extraClass){
    const color = mon.types && mon.types[0] ? TYPE_COLOR[mon.types[0]] : 'var(--line)';
    return `<div class="avatar ${sizeClass||''} ${mon.is_shiny ? 'is-shiny' : ''} ${extraClass||''}">
      <img src="${imagePath(mon, spriteVariant)}" alt="" draggable="false" onload="this.nextElementSibling.style.display='none'" onerror="this.style.display='none'">
      <span class="fallback" style="color:${color}">${initials(mon.name)}</span>
      ${mon.is_shiny ? '<span class="sparkle s1"></span><span class="sparkle s2"></span><span class="sparkle s3"></span>' : ''}
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

  // Every species in mon's evolution family (base form through every
  // branch), in root-first order — walks EVOLUTIONS backward to find the
  // base form, then forward (breadth-first) to collect every descendant,
  // branches included (e.g. Eevee's whole family), each name only once.
  function evolutionFamilyOf(name){
    let root = name;
    for(let guard = 0; guard < 20; guard++){
      const prev = Object.keys(EVOLUTIONS).find(k => evolutionOptionsFor(k).includes(root));
      if(!prev) break;
      root = prev;
    }
    const seen = new Set();
    const order = [];
    const queue = [root];
    while(queue.length){
      const cur = queue.shift();
      if(seen.has(cur) || !POKEMON_BY_NAME[cur]) continue;
      seen.add(cur);
      order.push(cur);
      evolutionOptionsFor(cur).forEach(n => queue.push(n));
    }
    return order;
  }

  function pokedexEvolutionHTML(mon){
    const family = evolutionFamilyOf(mon.name);
    if(family.length <= 1) return '';
    return `
      <div class="team-mgmt-title" style="margin-top:10px;">Evolution Line</div>
      <div class="pokedex-evo-row">${family.map(n => `
        <div class="pokedex-evo-item ${n === mon.name ? 'current' : 'faded'}">
          ${avatarHTML(POKEMON_BY_NAME[n], 'avatar-sm')}
          <span class="tn">${displayName(n)}</span>
        </div>`).join('')}</div>
    `;
  }

  // `activeIdx` is this mon's index in activeTeam when opened from the Lab's
  // Active Team row (or the Mega badge wouldn't make sense to click through
  // to), null/undefined for Storage or anywhere else Pokédex is opened from
  // — Mega Evolution only ever applies to the active team.
  function openPokedex(mon, activeIdx){
    const species = POKEMON_BY_NAME[mon.name] || mon;
    const megaForms = activeIdx != null ? (MEGA_FORMS_BY_BASE[mon.name] || []) : [];
    const canMega = megaForms.length > 0 && inv.megaStone > 0;
    document.getElementById('pokedexBody').innerHTML = `
      <div class="pokedex-header">
        <div class="pokedex-portrait">${avatarHTML(mon)}</div>
        <div class="tn">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">SHINY</span>' : ''}</div>
        <div class="pokedex-types">${typeChipsHTML(mon.types)}</div>
      </div>
      ${canMega ? `<button class="btn-ghost pokedex-mega-btn" id="pokedexMegaBtn">MEGA EVOLVE (${inv.megaStone} Mega Stone${inv.megaStone === 1 ? '' : 's'} left)</button>` : ''}
      ${pokedexEvolutionHTML(mon)}
      <div class="team-mgmt-title" style="margin-top:10px;">Base Stats</div>
      <div class="pokedex-stats">${pokedexStatRowsHTML(species)}</div>
      <div class="team-mgmt-title" style="margin-top:10px;">Moves</div>
      <div class="pokedex-moves">${pokedexMovesHTML(mon)}</div>
      <div class="team-mgmt-title" style="margin-top:10px;">Type Matchups</div>
      <div class="pokedex-matchups">${pokedexMatchupsHTML(mon.types)}</div>
    `;
    if(canMega){
      document.getElementById('pokedexMegaBtn').addEventListener('click', () => {
        closePokedex();
        useMegaStone(activeIdx);
      });
    }
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
    el.querySelector('.evolution-text').innerHTML = `your <span class="evo-name-cap">${displayName(evolution.from.name)}</span> evolved to <span class="evo-name-cap">${displayName(evolution.to.name)}</span>!`;
    el.classList.remove('evolve-anim');
    void el.offsetWidth; // restart the animation each time this reveal is (re-)shown
    el.classList.add('evolve-anim');
  }

  // Mega Evolution (see applyMegaEvolution(), the only caller) is a
  // deliberate player action from the Pokédex (see openPokedex()'s Mega
  // Evolve button), not the same automatic roll a regular evolution gets —
  // reuses renderEvolutionReveal()'s from/to art in its own popup.
  function openMegaEvolutionModal(evolution){
    renderEvolutionReveal('megaEvolutionReveal', evolution);
    document.getElementById('megaEvolutionModal').classList.add('active');
  }

  function closeMegaEvolutionModal(){
    document.getElementById('megaEvolutionModal').classList.remove('active');
  }

  // ---------- STORAGE (best runs / highscores — falls back silently if unavailable) ----------
  // Composite score: badges matter most, then Elite Four wins (full 6-vs-6
  // battles, weighted well above a route trainer), then trainer wins, then
  // catches, then gold, then a small flat bonus per hidden achievement
  // unlocked (see ACHIEVEMENT_DEFS) so they add flavor without outweighing
  // actual run progression.
  const ACHIEVEMENT_SCORE_POINTS = 25;
  // Iron Nuzlocke alone is worth 4x every other achievement, a deliberate
  // exception since a whole permadeath run without a single loss is far
  // harder to pull off than any of the other hidden achievements.
  const ACHIEVEMENT_IRON_NUZLOCKE_SCORE_POINTS = 100;
  function achievementScorePoints(name){
    return name === 'Iron Nuzlocke' ? ACHIEVEMENT_IRON_NUZLOCKE_SCORE_POINTS : ACHIEVEMENT_SCORE_POINTS;
  }
  // Total Pokémon caught this run: the current roster (run.caught, active +
  // storage) plus anything that later fainted in Nuzlocke (run.nuzlockeGraveyard,
  // tracked separately from run.caught so it doesn't also show up under
  // "Caught & in Storage" in the run-detail view — see removeFaintedFromRoster()).
  function caughtCount(run){
    return run.caught.length + (run.nuzlockeGraveyard || []).length;
  }
  function computeScore(run){
    const achievementPoints = (run.achievements || []).reduce((sum, name) => sum + achievementScorePoints(name), 0);
    return run.badges*100 + (run.eliteBeaten || 0)*60 + run.trainersBeaten*25 + caughtCount(run)*15 + run.goldEarned
      + achievementPoints;
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
      finalTeam: row.final_team || [],
      hillDefenses: row.hill_defenses || 0,
      userId: row.user_id || null,
      ...(row.details || {}),
    };
  }

  // Current signed-in user's id, or null for a guest — used only to
  // highlight the player's own row(s) in the global ranking (see
  // bestRowHTML()); fetched fresh each render rather than cached, since it's
  // cheap (local session lookup, no network round-trip) and always current.
  async function getCurrentUserId(){
    if(!supabaseClient) return null;
    try{
      const { data: { session } } = await supabaseClient.auth.getSession();
      return session?.user?.id || null;
    }catch(e){ return null; }
  }

  // Ids of every accepted friend of the current signed-in user (see the
  // Friends section on profile.html) — used only to tag their rows in the
  // global ranking. Empty for a guest or a signed-in user with no friends yet.
  // 10+ total PvP battles (either direction, see profile.html's
  // RIVAL_BATTLE_THRESHOLD — kept in sync manually, no shared constant
  // since profile.html and game.js don't share any module) against the
  // same accepted friend flips their ranking tag from "FRIEND" to "RIVAL".
  const RIVAL_BATTLE_THRESHOLD = 10;

  async function getFriendUserIds(myId){
    if(!supabaseClient || !myId) return { friends: new Set(), rivals: new Set() };
    try{
      const { data } = await supabaseClient
        .from('friends')
        .select('requester_id, addressee_id')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${myId},addressee_id.eq.${myId}`);
      const friends = new Set();
      (data || []).forEach(row => {
        friends.add(row.requester_id === myId ? row.addressee_id : row.requester_id);
      });
      if(!friends.size) return { friends, rivals: new Set() };

      const { data: battleRows } = await supabaseClient
        .from('pvp_battles').select('challenger_id, opponent_id')
        .or(`challenger_id.eq.${myId},opponent_id.eq.${myId}`);
      const battleCounts = {};
      (battleRows || []).forEach(b => {
        const otherId = b.challenger_id === myId ? b.opponent_id : b.challenger_id;
        battleCounts[otherId] = (battleCounts[otherId] || 0) + 1;
      });
      const rivals = new Set([...friends].filter(id => (battleCounts[id] || 0) >= RIVAL_BATTLE_THRESHOLD));
      return { friends, rivals };
    }catch(e){ return { friends: new Set(), rivals: new Set() }; }
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

  // Current season's id (see the `seasons` table — ended_at null means
  // current), cached after the first lookup since it only changes when
  // someone manually starts a new season, never mid-session.
  let currentSeasonId;
  async function getCurrentSeasonId(){
    if(currentSeasonId !== undefined) return currentSeasonId;
    if(!supabaseClient) return (currentSeasonId = null);
    try{
      const { data } = await supabaseClient.from('seasons').select('id').is('ended_at', null)
        .order('id', { ascending:false }).limit(1).maybeSingle();
      currentSeasonId = data?.id ?? null;
    }catch(e){ currentSeasonId = null; }
    return currentSeasonId;
  }

  // Queries the global top `limit` directly from Supabase (ORDER BY + LIMIT
  // run server-side, so we never pull the whole table down to slice it here).
  // Filtered to a single game mode — Classic and Pro never mix in a ranking —
  // and to the current season, so an eventual new season starts its ranking
  // fresh instead of mixing with whatever came before.
  async function loadBest(limit = 10, mode = 'classic'){
    if(!supabaseClient) return [];
    try{
      const seasonId = await getCurrentSeasonId();
      let query = supabaseClient
        .from('scores')
        .select('*')
        .eq('mode', mode)
        .order('score', { ascending: false })
        .limit(limit);
      if(seasonId != null) query = query.eq('season_id', seasonId);
      const { data, error } = await query;
      if(error) throw error;
      return (data || []).map(rowToEntry);
    }catch(e){ return []; }
  }
  let bestListCache = []; // top 10 shown on the homepage, read by openRunDetail()

  // Escapes untrusted text before it's interpolated into innerHTML. Player
  // names come from the DB, and the server only validates length, not
  // characters, so this can't be skipped even though the client-side input
  // form restricts what a well-behaved player could type.
  function escapeHTML(s){
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[c]));
  }

  // Same progression title shown on profile.html/stats.html (mirrors their
  // trainerRankTitle exactly — this file, profile.html, and stats.html don't
  // share any module, so it's kept in sync by hand across all three). Badges
  // and Caught used to show right in the leaderboard row instead of this;
  // that detail still lives one click away on the run-detail card
  // (renderRunDetail()'s statTiles), this row is just the title now.
  function trainerRankTitle(runs){
    const unlockedCount = new Set(runs.flatMap(r =>
      (r.details && Array.isArray(r.details.achievements)) ? r.details.achievements : []
    )).size;
    const championRuns = runs.filter(r => r.details && r.details.champion).length;
    if(championRuns >= 10 && unlockedCount >= ACHIEVEMENT_DEFS.length) return 'Champion Class';
    if(championRuns >= 3 && unlockedCount >= 12) return 'Elite Trainer';
    if(championRuns >= 1 && unlockedCount >= 9) return 'Veteran Trainer';
    if(unlockedCount >= 6) return 'Ace Trainer';
    if(unlockedCount >= 3) return 'Trainer';
    return 'Rookie Trainer';
  }

  // One query for every distinct user_id in a leaderboard page, rather than
  // one per row — trainerRankTitle() needs a player's whole run history
  // (achievements unlocked + champion count across all their runs), not just
  // the single run shown in that row.
  async function fetchRankTitlesForUsers(userIds){
    const ids = [...new Set(userIds)].filter(Boolean);
    if(!supabaseClient || !ids.length) return new Map();
    try{
      const { data } = await supabaseClient.from('scores').select('user_id, details').in('user_id', ids);
      const runsByUser = {};
      (data || []).forEach(row => {
        if(!row.user_id) return;
        (runsByUser[row.user_id] = runsByUser[row.user_id] || []).push({ details: row.details });
      });
      const titles = new Map();
      ids.forEach(id => { if(runsByUser[id]) titles.set(id, trainerRankTitle(runsByUser[id])); });
      return titles;
    }catch(e){ return new Map(); }
  }

  // Renders one leaderboard row; `rank` is the 1-based position shown on the left.
  function bestRowHTML(r, rank, idx, isMine, isFriend, isRival, rankTitle){
    const tag = isMine ? ' <span class="best-mine-tag">YOU</span>'
      : isRival ? ' <span class="best-mine-tag best-rival-tag">RIVAL</span>'
      : isFriend ? ' <span class="best-mine-tag best-friend-tag">FRIEND</span>' : '';
    const rowClass = isMine ? ' best-row-mine' : isRival ? ' best-row-rival' : isFriend ? ' best-row-friend' : '';
    const titlePart = rankTitle ? ` · ${escapeHTML(rankTitle)}` : '';
    return `
      <button class="best-row${rowClass}" data-idx="${idx}">
        <div class="best-rank">${rank}</div>
        <div class="best-name">${escapeHTML(r.name || 'Player')}${tag}${titlePart}</div>
        <div class="best-ovr">${r.score}</div>
      </button>`;
  }

  // Populates the homepage "latest news" card from data/news.json (most
  // recent post = first array entry). Static JSON for now; if this ever
  // needs to be postable without a deploy, swap this fetch for a Supabase
  // query and keep the DOM/CSS as-is.
  async function loadNewsPreview(){
    const box = document.getElementById('newsPreview');
    if(!box) return;
    try{
      const posts = await fetch('data/news.json').then(r => r.json());
      const post = posts[0];
      if(!post) return;
      const excerptSource = post.intro || (post.sections && post.sections[0] && post.sections[0].items[0]) || '';
      const excerpt = excerptSource.length > 140 ? excerptSource.slice(0, 140).trim() + '…' : excerptSource;
      document.getElementById('newsPreviewImg').src = post.image;
      document.getElementById('newsPreviewImg').alt = post.imageCaption || '';
      document.getElementById('newsPreviewTitle').textContent = post.title;
      document.getElementById('newsPreviewDate').textContent = new Date(post.date).toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' });
      document.getElementById('newsPreviewExcerpt').textContent = excerpt;
      box.style.display = '';
    }catch(e){
      console.error('Failed to load news preview', e);
    }
  }

  // Wires up the homepage Google/Discord sign-in widget. Guest play needs no
  // account at all — this only reflects whichever Supabase Auth session (if
  // any) is currently active, so signing in/out never blocks the START flow.

  // Lights up the "My Profile" button's notif dot (see #profileNotifDot in
  // index.html) when there's something new waiting on the profile page:
  // this is the very first time this account has ever signed in (nothing
  // in localStorage yet marking a profile visit — cleared by profile.html
  // itself the moment they actually open it, see its own
  // rinne_profile_visited_* flag), or they have an incoming friend request
  // sitting unanswered. Guests never show a dot — there's no profile to check.
  async function updateProfileNotifDot(user){
    const dot = document.getElementById('profileNotifDot');
    if(!dot) return;
    if(!user || !supabaseClient){ dot.classList.remove('active'); return; }
    let hasNotification = !localStorage.getItem(`rinne_profile_visited_${user.id}`);
    if(!hasNotification){
      try{
        const { count } = await supabaseClient
          .from('friends')
          .select('requester_id', { count:'exact', head:true })
          .eq('status', 'pending')
          .eq('addressee_id', user.id);
        hasNotification = !!count;
      }catch(e){ /* leave hasNotification as-is if the request fails */ }
    }
    dot.classList.toggle('active', hasNotification);
  }

  function initAuthWidget(){
    const actions = document.getElementById('authActions');
    const signedInActions = document.getElementById('authSignedInActions');
    const signOutBtn = document.getElementById('authSignOutBtn');
    const guestStatusText = document.getElementById('guestStatusText');
    if(!supabaseClient || !actions) return;

    async function renderSession(session){
      const user = session && session.user;
      cachedAuthUserId = user ? user.id : null;
      // The player's chosen in-game nickname (public.profiles.game_name, set
      // via profile.html's "Edit" button — see the run-end auto-name-resolve
      // comment near autoResolvedPlayerName), NOT their Google/Discord account
      // name — those can differ (e.g. "Lucas Mattara" vs a nickname like
      // "Hocus Pocus").
      cachedPlayerDisplayName = null;
      if(user){
        try{
          const { data } = await supabaseClient.from('profiles').select('game_name').eq('user_id', user.id).maybeSingle();
          cachedPlayerDisplayName = data?.game_name || null;
        }catch(e){ /* fall back to the generic "YOUR POKÉMON" label */ }
      }
      // Re-derives which Continue Run offer (if any) is correct for whoever
      // is signed in *now*, every time — not just hiding a stale one. Needed
      // because right after an OAuth redirect back from Google/Discord, this
      // fires again once Supabase finishes parsing the session from the URL,
      // which can land a moment after init()'s own initial check already
      // ran (and possibly showed a guest/foreign save in that split second).
      // Just hiding the mismatched button here isn't enough, that account's
      // own save (e.g. its cloud checkpoint) still needs to be looked up and
      // offered instead — see refreshContinueRunOffer().
      await refreshContinueRunOffer();
      if(user){
        actions.style.display = 'none';
        signedInActions.style.display = '';
        if(guestStatusText) guestStatusText.style.display = 'none';
      } else {
        actions.style.display = '';
        signedInActions.style.display = 'none';
        if(guestStatusText) guestStatusText.style.display = '';
      }
      updateProfileNotifDot(user);
    }

    supabaseClient.auth.getSession().then(({ data }) => renderSession(data.session));
    supabaseClient.auth.onAuthStateChange((_event, session) => renderSession(session));

    document.getElementById('authGoogleBtn').addEventListener('click', () => {
      supabaseClient.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: window.location.origin + window.location.pathname } });
    });
    document.getElementById('authDiscordBtn').addEventListener('click', () => {
      supabaseClient.auth.signInWithOAuth({ provider:'discord', options:{ redirectTo: window.location.origin + window.location.pathname } });
    });
    signOutBtn.addEventListener('click', () => {
      document.getElementById('authSignOutModal').classList.add('active');
    });
    document.getElementById('authSignOutCancelBtn').addEventListener('click', () => {
      document.getElementById('authSignOutModal').classList.remove('active');
    });
    document.getElementById('authSignOutConfirmBtn').addEventListener('click', () => {
      document.getElementById('authSignOutModal').classList.remove('active');
      supabaseClient.auth.signOut();
    });
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
    const myId = await getCurrentUserId();
    const { friends: friendIds, rivals: rivalIds } = await getFriendUserIds(myId);
    const rankTitles = await fetchRankTitlesForUsers(list.map(r => r.userId));
    el.innerHTML = list.map((r,i) => bestRowHTML(r, i+1, i, r.userId && r.userId === myId, r.userId && friendIds.has(r.userId), r.userId && rivalIds.has(r.userId), r.userId ? rankTitles.get(r.userId) : null)).join('');
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
    const myId = await getCurrentUserId();
    const { friends: friendIds, rivals: rivalIds } = await getFriendUserIds(myId);
    const rankTitles = await fetchRankTitlesForUsers(rest.map(r => r.userId));
    listEl.innerHTML = rest.map((r,i) => bestRowHTML(r, i+11, i+10, r.userId && r.userId === myId, r.userId && friendIds.has(r.userId), r.userId && rivalIds.has(r.userId), r.userId ? rankTitles.get(r.userId) : null)).join('');
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
      nuzlockeGraveyard: (run.nuzlockeGraveyard || []).map(m => ({ name: m.name, types: m.types, is_shiny: !!m.is_shiny })),
      trainerLoss: run.trainerLoss || null,
      trainerLossMon: run.trainerLossMon || null,
      champion: !!run.champion,
      beatenBadges: run.beatenBadges || [],
      eliteBeaten: run.eliteBeaten || 0,
      legendaryHandled: run.legendaryHandled || false,
      mythicalHandled: run.mythicalHandled || false,
      achievements: run.achievements || [],
      // Not used by the mode-tab query (that's server-side, its own `mode`
      // column) — kept here too so renderRunDetail() can tell Nuzlocke runs
      // apart client-side (e.g. to show the fallen-Pokémon graveyard).
      mode,
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
            caughtCount: caughtCount(run),
            goldEarned: run.goldEarned,
            mode,
            details,
            finalTeam: run.finalTeamSpecies || [],
            hillDefenses: run.hillDefenses || 0,
            durationSec: runStartedAt ? currentActivePlaySec() : null,
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

    // Only the badges this run actually earned — with 18 Gym Leaders total
    // and only 8 ever offered per run (see rollGymChoicePool()), showing
    // the other 10 as permanently "locked" placeholders no longer means
    // anything (they were never even offered, not skipped), so they're
    // dropped entirely instead, same treatment the share-card image already
    // uses (see the canvas renderer's "earnedBadges" comment).
    const badgeGridHTML = BADGES.filter(b => badgesEarned.has(b.key)).map(b => `
      <div class="badge-card mini">
        <img class="badge-icon" src="${BADGE_ICON_DIR}/${b.icon}" alt="" onerror="this.style.display='none'">
      </div>`).join('');

    const starterMon = normalizeMonRef(entry.starter);
    const caughtMons = (entry.caught || []).map(normalizeMonRef).filter(Boolean);
    const graveyardMons = (entry.nuzlockeGraveyard || []).map(normalizeMonRef).filter(Boolean);

    const monSlotHTML = mon => `<div class="run-mon-slot">
      ${avatarHTML(mon,'avatar-sm')}
      <span class="tn">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">SHINY</span>' : ''}</span>
    </div>`;
    // Active Team only (not Storage/graveyard) stands on the same .lab-base
    // platform as the result screen's "Your Team" spotlight — see
    // spotlightHTML above renderResultScreen for the matching treatment.
    const activeBaseImg = entry.champion ? CHAMPION_BASE_IMG : LAB_BASE_IMG;
    const activeMonSlotHTML = mon => `<div class="run-mon-slot has-base">
      <div class="lab-sprite-wrap"><img class="lab-base" src="${activeBaseImg}" alt="" draggable="false">${avatarHTML(mon,'avatar-sm')}</div>
      <span class="tn">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">SHINY</span>' : ''}</span>
    </div>`;
    const faintedMonSlotHTML = mon => `<div class="run-mon-slot fainted-slot">
      ${avatarHTML(mon,'avatar-sm')}
      <span class="tn">${displayName(mon.name)}</span>
    </div>`;
    // Nuzlocke only — permadeath'd Pokémon, shown grayed out below the
    // surviving active team (see removeFaintedFromRoster()).
    const graveyardSectionHTML = (entry.mode === 'nuzlocke' && graveyardMons.length) ? `
      <div class="team-mgmt-title" style="margin-top:10px;">Fallen in Battle</div>
      <div class="run-detail-team-grid">${graveyardMons.map(faintedMonSlotHTML).join('')}</div>` : '';

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
        <div class="run-detail-team-grid active-team-grid" id="runDetailActiveTeamGrid">${activeMons.map(activeMonSlotHTML).join('') || '<div class="empty-note">Empty.</div>'}</div>`;
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

    // No Badges tile here — "Badges Earned" further down already shows them
    // as icons, so a second numeric count up top was redundant.
    const statTiles = [
      ['Battles Won', entry.badges + entry.trainersBeaten],
      // King of the Hill only, how many Hill Challengers this run's Top1
      // beat before the run ended, i.e. how long the title was defended.
      ...(entry.hillDefenses > 0 ? [['Hill Defenses', entry.hillDefenses]] : []),
      ['Caught', entry.caughtCount], ['Gold Earned', `${entry.goldEarned}G`, true],
    ].map(([label,count,isGold]) => `<div class="inv-chip"><span class="inv-count ${isGold ? 'gold-text' : ''}">${count}</span><span class="inv-label">${label}</span></div>`).join('');

    let statusLine;
    if(entry.champion) statusLine = `<span style="color:var(--lime)">Became Pokémon Champion, Elite Four cleared!</span>`;
    else if(entry.trainerLoss) statusLine = `Lost to ${entry.trainerLoss}.${entry.trainerLossMon ? ` Their ${entry.trainerLossMon} was the last one standing.` : ''}`;
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
          <div class="tier-name">${escapeHTML(entry.name || 'Player')}${dateStr ? ` · ${dateStr}` : ''}</div>
          <div class="tier-flavor">${statusLine}</div>

          <div class="inv-strip" style="margin-top:12px;">${statTiles}</div>

          ${activeSectionHTML}
          ${graveyardSectionHTML}
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
    groundSpritesOnBase('#runDetailActiveTeamGrid');
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

  // Small row of badge icons next to the Gold chip on every PokeStop — just
  // the ones actually earned this run (runBeatenBadges), growing by one icon
  // each time a Gym is beaten, not a fixed set of empty/filled slots.
  function renderPokestopBadgesRow(){
    const el = document.getElementById('pokestopBadgesRow');
    if(!el) return;
    el.innerHTML = BADGES.filter(b => runBeatenBadges && runBeatenBadges.has(b.key)).map(b =>
      `<img class="pokestop-badge-icon" src="${BADGE_ICON_DIR}/${b.icon}" alt="${escapeHTML(b.leaderName)}" title="${escapeHTML(b.leaderName)}" onerror="this.style.display='none'">`
    ).join('');
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
  // "Hours Played" (profile.html) needs actual active time, not wall-clock
  // since runStartedAt — a run left open (or resumed days later via
  // Continue Run) shouldn't count that idle gap. activePlaySec is the
  // persisted running total in seconds; activeSegmentStartedAt (never
  // persisted — a fresh page load is itself the start of a new active
  // segment) marks when the current visible/focused stretch began. See
  // currentActivePlaySec() and the visibilitychange listener in init().
  let activePlaySec, activeSegmentStartedAt;
  function currentActivePlaySec(){
    return (activePlaySec || 0) + Math.round((Date.now() - (activeSegmentStartedAt || Date.now())) / 1000);
  }
  // Signed-in player's saved Profile name (see renderResult()), used to
  // auto-record the Highscore and to fill in share text — null for guests
  // and for any account that hasn't set a name yet, either of which still
  // go through the manual highscore-entry input.
  let autoResolvedPlayerName = null;
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
        duration_sec: runStartedAt ? currentActivePlaySec() : null,
        badges: run.badges,
        caught_count: run.caught.length,
        gold_earned: run.goldEarned,
        bought_safari: !!(itemsBought.safariTicket),
        items_bought: itemsBought,
        items_used: itemsUsed,
      });
    }catch(e){ /* best-effort telemetry — never blocks or throws into the UI */ }
  }

  // ---------- BUG REPORT ----------
  // Small always-on button (see index.html) so a player can flag something
  // broken without leaving the game. Write-only on the DB side, same
  // anon-insert-only RLS shape as run_analytics (see
  // supabase/migrations/20260724160000_add_bug_reports.sql) — nobody can
  // read these back except from the Supabase dashboard.
  function openReportBugModal(){
    const textEl = document.getElementById('reportBugText');
    const statusEl = document.getElementById('reportBugStatus');
    const submitBtn = document.getElementById('reportBugSubmitBtn');
    textEl.value = '';
    statusEl.textContent = '';
    submitBtn.disabled = false;
    submitBtn.textContent = 'SEND REPORT';
    document.getElementById('reportBugModal').classList.add('active');
    textEl.focus();
  }

  function closeReportBugModal(){
    document.getElementById('reportBugModal').classList.remove('active');
  }

  async function submitBugReport(){
    const textEl = document.getElementById('reportBugText');
    const statusEl = document.getElementById('reportBugStatus');
    const submitBtn = document.getElementById('reportBugSubmitBtn');
    const message = textEl.value.trim();
    if(!message){
      statusEl.textContent = 'Write a quick description first.';
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'SENDING...';
    statusEl.textContent = '';
    try{
      if(!supabaseClient) throw new Error('no client');
      const { error } = await supabaseClient.from('bug_reports').insert({
        message: message.slice(0, 2000),
        analytics_id: getAnalyticsId(),
        game_mode: gameMode,
        screen: checkpointScreen || 'startScreen',
        run_badges: (typeof runBadges === 'number') ? runBadges : null,
        user_agent: navigator.userAgent,
      });
      if(error) throw error;
      statusEl.textContent = 'Thanks, sent!';
      setTimeout(closeReportBugModal, 900);
    }catch(e){
      submitBtn.disabled = false;
      submitBtn.textContent = 'SEND REPORT';
      statusEl.textContent = "Couldn't send, try again in a bit.";
    }
  }

  // ---------- GAME MODE (Classic / Pro / Nuzlocke) ----------
  // Chosen on the home screen, right before Start. Classic is the game as it
  // always was; Pro and Nuzlocke both hide every wild-encounter/starter card
  // behind a "mystery" cover until clicked, see renderWildChoices()/
  // renderStarterChoices()/isBlindMode(). Nuzlocke additionally adds
  // permadeath (see removeFaintedFromRoster()), pricier PokeStop restocks
  // (see shopPrice()), and drops Revives/the Cruise Casino's Lucky
  // Spin/Token Casino entirely.
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
  let runTrainersBeaten, runBadges, runChampion, runGoldEarned, trainerLoss, trainerLossMon, legendaryHandled, mythicalHandled;
  // King of the Hill: top1Defeated flips true on beating the mode's Top1 at
  // the Hill; hillDefenses counts infinite-loop trainer wins after that
  // (also folded into runTrainersBeaten, see endBattle()); infiniteLoopTrainerNum
  // is the next loop trainer's 1-based index, used to scale difficulty.
  let top1Defeated, hillDefenses, infiniteLoopTrainerNum;
  let hillChallengerUsedNames; // Set of Pokémon names already fielded by an earlier Hill Challenger this run — never repeated across the infinite loop
  let pendingEvolution; // set on a Gym Leader win, revealed on the next PokeStop screen
  let runBeatenBadges; // Set of badge keys already challenged (and beaten) this run
  // The 4 badge keys currently offered at Gym Select (see rollGymChoicePool())
  // — null means "needs a fresh roll", which happens once per stage (right
  // after a badge is beaten) rather than every visit, so leaving and coming
  // back to Gym Select without beating anything keeps the same 4 options.
  // Persisted across checkpoints (see serializeRun/restoreRun) so a refresh
  // can't be used to keep re-rolling for a more convenient set of 4.
  let gymChoicePool;
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
  let cruiseMiniEventUsed; // { fishing } — a "seen it before" flag for the notif dot; the button's actual open/closed state uses fishingCastsLeft below, see openFishing()
  // Persists across every PokeStop visit during the Cruise (unlike the old
  // one-shot model) so Fishing Bait bought after an earlier session still
  // buys more casts instead of being wasted on an event the player can no
  // longer reopen. Topped up (not overwritten) by openFishing().
  let fishingCastsLeft;
  // One-way flag, set once the Rival battle (the Cruise's last stop) is won
  // — see itemLocked(), which uses it to stop Fishing Bait from being sold
  // once Fishing itself can never be reopened again this run.
  let cruiseEnded;
  // Lifetime PokeStop-purchase counts, keyed by invKey — for items with a
  // `lifetimeMax` (Potions, Revives) this never decreases even as the item is
  // used/consumed, unlike inv[invKey] itself. Keeps the run-long healing
  // budget capped regardless of how many PokeStop stops the player visits.
  let shopBoughtCounts;
  // Per-run increase to an item's lifetimeMax, keyed by invKey — currently
  // never populated (no source of bonuses), kept only for save compatibility
  // with effectiveLifetimeMax()/older saves that still carry a value here.
  let shopLifetimeBonus;

  // ---------- HIDDEN ACHIEVEMENT TRACKING (see checkAchievements()) ----------
  // Counters/flags with no other natural home in the run state above, each
  // is purely additive bookkeeping for a single achievement condition and
  // never affects gameplay itself.
  let safariCatchCount;   // Pokémon caught inside the Safari Zone this run
  let fishingCatchCount;  // Pokémon caught via Fishing this run
  let evolvedSpeciesThisRun; // Set of species names (the "to" side) evolved into this run, normal or Mega, see recordEvolution()
  // Species name -> consecutive-miss count for evolveRandomEligible()'s pity
  // mechanic (see EVOLVE_PITY_THRESHOLD there): only counts up while that
  // species is both on the active team and eligible to evolve, so swapping
  // it into the box just pauses its counter instead of losing progress.
  let evolvePityMisses;
  // Species name at the moment each Pokémon actually joined the roster this
  // run (wild catch, Safari/Fishing, Legendary/Mythical win, Trade, Casino/
  // Token Exchange reward — see logCatch()) — unlike `caught` in
  // finishEncounter() (a snapshot of activeTeam/storage_ at run end), this
  // never changes if that individual later evolves, so "Most Caught" stats
  // (see stats.html/profile.html) reflect what was actually caught, not
  // whatever it turned into.
  let runCaughtLog;
  // The starter species as originally picked at selectStarter() — `starter`
  // itself gets reassigned in place if it evolves/Mega Evolves during the
  // run (see evolveRandomEligible()/performMegaEvolution()), so this is the
  // only record of the actual pick for "Most Picked Starter" stats.
  let starterOriginalName;
  let playerStatusEffectsApplied; // times the player's own moves inflicted Poison/Sleep/Burn this run
  let eliteGauntletFlawless; // true unless any player Pokémon has fainted since the Elite Four gauntlet began
  let comebackKidAchieved; // set once any single battle this run was won after dropping to 1 living Pokémon at <20% HP
  let perfectCatcher; // true unless a wild Pokémon has broken free/fled from a catch attempt this run (see resolveThrow())
  let goldSpentOnSlots;    // cumulative Gold spent pulling the Token Casino's Slot Machine lever this run
  // Nuzlocke only — Pokémon permadeath'd out of activeTeam this run (see
  // removeFaintedFromRoster()), kept around just for display (result screen
  // + run detail card show them grayed out below the surviving team), never
  // read by any other game logic.
  let nuzlockeGraveyard;

  // ---------- RUN PERSISTENCE (resume an in-progress run across a refresh) ----------
  // Distinct key from the leaderboard (dondokomon:best) and META (dondokomon:meta)
  // on purpose — this is per-run scratch state, not shared/persistent data.
  const RUN_SAVE_KEY = 'dondokomon:currentRun';
  const RUN_SAVE_VERSION = 1;

  // Current signed-in user id, or null for a guest — kept in sync live by
  // initAuthWidget()'s onAuthStateChange listener. The *local* save
  // (RUN_SAVE_KEY, a single localStorage key shared by anyone on this
  // device/browser) has no other concept of "whose run this is", so
  // serializeRun() stamps it on every save and init()'s Continue Run check
  // compares against it — signing out (or into a different account) must
  // not keep offering to resume a run that belongs to someone else on this
  // same device. The cloud checkpoint (run_saves.js) doesn't need this,
  // it's already keyed by account/device id server-side.
  let cachedAuthUserId = null;
  // Signed-in player's chosen in-game nickname (public.profiles.game_name,
  // not their Google/Discord account name), used in place of the generic
  // "YOUR POKÉMON" battle label when there is one — see initAuthWidget()'s
  // renderSession() (where it's kept in sync with the active session) and
  // renderHpPanel()/renderDoubleHpPanel().
  let cachedPlayerDisplayName = null;

  // Which screen to resume into. Only screens reachable from a self-contained
  // render function are checkpointed — short-lived actions (an active battle
  // turn, a catch-screen throw, a casino spin/fishing cast/safari step) are not:
  // refreshing mid-action resumes at the last checkpoint before that action
  // started, since none of those leave permanent, hard-to-regenerate state.
  let checkpointScreen = null;

  function serializeRun(){
    return {
      v: RUN_SAVE_VERSION,
      ownerId: cachedAuthUserId, // see cachedAuthUserId's own comment
      checkpointScreen,
      starter, activeTeam, storage_: storage_, inv, encounterNum,
      runTrainersBeaten, runBadges, runChampion, runGoldEarned, trainerLoss, trainerLossMon, legendaryHandled, mythicalHandled,
      runBeatenBadges: Array.from(runBeatenBadges || []),
      gymChoicePool,
      postEncounterActionKind,
      eliteIndex, eliteUsedNames: Array.from(eliteUsedNames || []),
      hillChallengerUsedNames: Array.from(hillChallengerUsedNames || []),
      seenWildNames: Array.from(seenWildNames || []), casinoTokens, firstGymBonusEncounterUsed,
      legendaryBonusEncounterUsed, eliteBonusEncounterUsed, gameMode,
      cruiseStageIndex, cruiseMiniEventUsed, fishingCastsLeft, cruiseEnded, shopBoughtCounts, shopLifetimeBonus,
      itemsBought, itemsUsed, runStartedAt, activePlaySec: currentActivePlaySec(),
      pendingEvolution, pokestopMode,
      wildChoices, rerollUsedThisEncounter,
      hasComputerNotification, newArrivalNames,
      lastBattleTrainerName: (battle && battle.trainer) ? battle.trainer.name : null,
      safariCatchCount, fishingCatchCount,
      evolvedSpeciesThisRun: Array.from(evolvedSpeciesThisRun || []),
      evolvePityMisses, runCaughtLog, starterOriginalName,
      playerStatusEffectsApplied, eliteGauntletFlawless, comebackKidAchieved, perfectCatcher,
      goldSpentOnSlots, nuzlockeGraveyard,
      top1Defeated, hillDefenses, infiniteLoopTrainerNum,
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

  // "End Run" is only offered from the PokeStop (and, once the infinite
  // loop starts, from that screen too, since there's no PokeStop access
  // left there for the player to end the run from otherwise) — every other
  // screen (an encounter, a battle, Gym Select, Team management...) hides
  // it, so abandoning mid-fight or mid-pick isn't an option one screen away.
  function renderAbandonButton(screen){
    const btn = document.getElementById('abandonRunBtn');
    if(btn) btn.style.display = (screen === 'pokestop' || screen === 'infiniteLoop') ? 'block' : 'none';
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

  // Marks the checkpoint stale the instant a battle is committed to (see
  // beginBattle()), since it rolls RNG (opponent squad) a refresh must never
  // let the player re-roll by resuming a pre-battle save. Deliberately
  // leaves the last real checkpoint's saved data untouched on disk though
  // (unlike the old version of this function, which deleted it outright) —
  // setting checkpointScreen to null just makes persistRunState() a no-op
  // for the rest of the battle (see its own `if(!checkpointScreen) return`
  // guard), so nothing mid-battle can overwrite that save. A refresh mid-
  // fight (or on any screen between here and the next checkpoint() call)
  // now resumes from that last real checkpoint instead of losing the whole
  // run — same outcome as a refresh mid-wild-encounter already had, just
  // applied to battles too.
  function invalidateCheckpoint(){
    checkpointScreen = null;
    renderAbandonButton(null);
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
      const validScreens = ['encounter', 'gymSelect', 'rivalChallenge', 'pokestop', 'team', 'hill', 'infiniteLoop'];
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
    trainerLossMon = saved.trainerLossMon || null;
    legendaryHandled = saved.legendaryHandled || false;
    mythicalHandled = saved.mythicalHandled || false;
    runBeatenBadges = new Set(saved.runBeatenBadges || []);
    // Array.isArray guard (not just `|| null`) so an older save from before
    // this field existed correctly falls back to null — the "needs a fresh
    // roll" state — rather than saving an unexpected shape.
    gymChoicePool = Array.isArray(saved.gymChoicePool) ? saved.gymChoicePool : null;
    setPostEncounterAction(POST_ENCOUNTER_ACTIONS[saved.postEncounterActionKind] ? saved.postEncounterActionKind : 'trainer');
    eliteIndex = saved.eliteIndex || 0;
    eliteUsedNames = new Set(saved.eliteUsedNames || []);
    hillChallengerUsedNames = new Set(saved.hillChallengerUsedNames || []);
    seenWildNames = new Set(saved.seenWildNames || []);
    casinoTokens = saved.casinoTokens || 0;
    firstGymBonusEncounterUsed = !!saved.firstGymBonusEncounterUsed;
    legendaryBonusEncounterUsed = !!saved.legendaryBonusEncounterUsed;
    eliteBonusEncounterUsed = !!saved.eliteBonusEncounterUsed;
    gameMode = (saved.gameMode === 'pro' || saved.gameMode === 'nuzlocke') ? saved.gameMode : 'classic';
    cruiseStageIndex = (typeof saved.cruiseStageIndex === 'number') ? saved.cruiseStageIndex : null;
    cruiseMiniEventUsed = saved.cruiseMiniEventUsed || { fishing:false };
    fishingCastsLeft = (typeof saved.fishingCastsLeft === 'number') ? saved.fishingCastsLeft : BASE_FISHING_CASTS;
    cruiseEnded = !!saved.cruiseEnded;
    shopBoughtCounts = saved.shopBoughtCounts || {};
    shopLifetimeBonus = saved.shopLifetimeBonus || {};
    itemsBought = saved.itemsBought || {};
    itemsUsed = saved.itemsUsed || {};
    runStartedAt = saved.runStartedAt || Date.now();
    activePlaySec = saved.activePlaySec || 0;
    activeSegmentStartedAt = Date.now(); // this page load is the start of a new active segment
    pendingEvolution = saved.pendingEvolution || null;
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
    rerollUsedThisEncounter = !!saved.rerollUsedThisEncounter;
    hasComputerNotification = !!saved.hasComputerNotification;
    newArrivalNames = Array.isArray(saved.newArrivalNames) ? saved.newArrivalNames : [];
    checkpointScreen = saved.checkpointScreen;
    safariCatchCount = saved.safariCatchCount || 0;
    fishingCatchCount = saved.fishingCatchCount || 0;
    evolvedSpeciesThisRun = new Set(saved.evolvedSpeciesThisRun || []);
    evolvePityMisses = saved.evolvePityMisses || {};
    runCaughtLog = Array.isArray(saved.runCaughtLog) ? saved.runCaughtLog : [];
    starterOriginalName = saved.starterOriginalName || (saved.starter && saved.starter.name) || null;
    playerStatusEffectsApplied = saved.playerStatusEffectsApplied || 0;
    eliteGauntletFlawless = saved.eliteGauntletFlawless !== false;
    comebackKidAchieved = !!saved.comebackKidAchieved;
    perfectCatcher = saved.perfectCatcher !== false;
    goldSpentOnSlots = saved.goldSpentOnSlots || 0;
    nuzlockeGraveyard = saved.nuzlockeGraveyard || [];
    top1Defeated = !!saved.top1Defeated;
    hillDefenses = saved.hillDefenses || 0;
    infiniteLoopTrainerNum = saved.infiniteLoopTrainerNum || 0;

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
    } else if(checkpointScreen === 'hill'){
      openHillIntro();
    } else if(checkpointScreen === 'infiniteLoop'){
      openInfiniteLoopScreen();
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

  // Set by showContinueRunButton() whenever there's a run to resume (local
  // or cloud) — Start A New Run checks this before doing anything, since
  // starting fresh would permanently erase it (see confirmStartNewRun()).
  let pendingContinueRun = null;

  // Reveals the "Continue Run" button under Start (see init()) — clicking
  // it resumes exactly where the run left off via the same restoreRun()
  // path a local or cloud checkpoint always used to auto-resume through.
  function showContinueRunButton(saved){
    pendingContinueRun = saved;
    const btn = document.getElementById('continueRunBtn');
    if(!btn) return;
    btn.style.display = 'block';
    btn.onclick = () => restoreRun(saved);
  }

  // Figures out (from scratch, every time) which run — if any — the
  // *currently* signed-in identity (cachedAuthUserId, already resolved by
  // the caller) should be offered to continue, and shows/hides the button
  // accordingly. Called both from init() and from every auth state change
  // (see initAuthWidget()'s renderSession()) — re-deriving instead of just
  // patching the previous state is what makes this safe even if a sign-in
  // finishes a moment after the page's first check already ran (the OAuth
  // redirect-back race that used to leave the wrong save offered).
  // Returns which of the two sources (if either) had something, so init()
  // can still gate the PvP-challenge auto-start on "nothing at all to lose".
  async function refreshContinueRunOffer(){
    const savedRun = loadSavedRun();
    const savedRunIsMine = savedRun && (savedRun.ownerId || null) === cachedAuthUserId;
    if(savedRunIsMine){
      showContinueRunButton(savedRun);
      return { anyLocalSave: true, cloudOffered: false };
    }
    const cloudState = (typeof loadCheckpoint === 'function') ? await loadCheckpoint() : null;
    if(cloudState){
      showContinueRunButton(cloudState);
    } else {
      pendingContinueRun = null;
      const btn = document.getElementById('continueRunBtn');
      if(btn) btn.style.display = 'none';
    }
    return { anyLocalSave: !!savedRun, cloudOffered: !!cloudState };
  }

  // Start Button's click handler — goes straight to starter selection
  // unless there's a run in progress to lose first, in which case it asks
  // for confirmation (see #startNewRunConfirmModal).
  function handleStartNewRunClick(){
    if(pendingContinueRun){
      document.getElementById('startNewRunConfirmModal').classList.add('active');
    } else {
      startGame();
    }
  }

  // Confirmed via #startNewRunConfirmModal — permanently erases the run
  // pendingContinueRun pointed at (both the local save and the cloud
  // checkpoint, see run_saves.js), same cleanup renderResult() does when a
  // run ends normally, then proceeds to starter selection.
  function confirmStartNewRun(){
    document.getElementById('startNewRunConfirmModal').classList.remove('active');
    clearRunState();
    if(typeof clearCheckpoint === 'function') clearCheckpoint();
    pendingContinueRun = null;
    const btn = document.getElementById('continueRunBtn');
    if(btn) btn.style.display = 'none';
    startGame();
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

  const STARTER_BASE_IMG = "assets/pokemon-game-assets/Graphics/Battlebacks/grass_base1.png";

  function starterCardRevealHTML(mon){
    return `
      <div class="lab-sprite-wrap"><img class="lab-base" src="${STARTER_BASE_IMG}" alt="" draggable="false">${avatarHTML(mon)}</div>
      <span class="c-name">${displayName(mon.name)}</span>
      <div class="c-types">${typeChipsHTML(mon.types)}</div>
      ${mon.is_shiny ? '<span class="shiny-dot" title="Shiny!"></span>' : ''}`;
  }

  function renderStarterChoices(){
    starterChoices = pickStarterTrio().map(n => POKEMON_BY_NAME[n]).filter(Boolean).map(mon =>
      (canBeShiny(mon) && Math.random() < SHINY_CHANCE) ? { ...mon, is_shiny:true } : mon
    );
    const grid = document.getElementById('starterGrid');
    const pro = isBlindMode();
    grid.classList.remove('revealing');
    grid.innerHTML = starterChoices.map((mon,i) => `
      <button class="starter-card${pro ? ' mystery-card' : ''}" data-idx="${i}">
        ${pro ? mysteryCardHTML() : starterCardRevealHTML(mon)}
      </button>`).join('');
    if(!pro) groundSpritesOnBase('#starterGrid');
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
    devGodModeRunActive = false; // a real run always clears any earlier God Mode test run's flag
    starter = mon;
    starterOriginalName = mon.name;
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
      fishingBait: 0,
      megaStone: 0,
      maxPotions: 0, // only ever granted by beating the Hill's Top1 or defending it in the infinite loop
    };
    encounterNum = 1;
    runTrainersBeaten = 0;
    runBadges = 0;
    runChampion = false;
    runGoldEarned = 0;
    trainerLoss = null;
    trainerLossMon = null;
    legendaryHandled = false; // false | 'caught' | 'fled'
    mythicalHandled = false; // false | 'caught' | 'fled'
    top1Defeated = false;
    hillDefenses = 0;
    infiniteLoopTrainerNum = 0;
    pendingEvolution = null;
    runBeatenBadges = new Set();
    gymChoicePool = null;
    eliteIndex = 0;
    eliteUsedNames = new Set();
    hillChallengerUsedNames = new Set();
    seenWildNames = new Set();
    casinoTokens = 0;
    firstGymBonusEncounterUsed = false;
    legendaryBonusEncounterUsed = false;
    eliteBonusEncounterUsed = false;
    cruiseStageIndex = null;
    cruiseMiniEventUsed = { fishing:false };
    shopBoughtCounts = {};
    shopLifetimeBonus = {};
    itemsBought = {};
    itemsUsed = {};
    runStartedAt = Date.now();
    activePlaySec = 0;
    activeSegmentStartedAt = Date.now();
    hasComputerNotification = false;
    newArrivalNames = [];
    safariCatchCount = 0;
    fishingCatchCount = 0;
    fishingCastsLeft = BASE_FISHING_CASTS;
    cruiseEnded = false;
    evolvedSpeciesThisRun = new Set();
    evolvePityMisses = {};
    runCaughtLog = [];
    starterOriginalName = null;
    playerStatusEffectsApplied = 0;
    eliteGauntletFlawless = true;
    comebackKidAchieved = false;
    perfectCatcher = true;
    goldSpentOnSlots = 0;
    nuzlockeGraveyard = []; // Nuzlocke only — see removeFaintedFromRoster()
    renderComputerNotifDot();

    document.getElementById('starterScreen').classList.remove('active');
    startEncounter();
  }

  // ---------- WILD ENCOUNTER ----------
  let wildChoices, target, pendingMultiplier, pendingFleeReduction, pendingNoCritFlee, catchBusy, encounterOver;
  // Which platform base the current wild-encounter grid's cards stand on —
  // grass by default, swapped to sand for the post-Legendary beach bonus
  // encounter (see startCuratedBonusEncounter()'s baseImg param).
  let wildEncounterBaseImg = STARTER_BASE_IMG;
  // Caps rerollWildChoices() at 1 use per encounter, regardless of how many
  // Reroll Tickets are stocked up — reset in revealWildEncounter() (the one
  // spot both a fresh encounter and a curated bonus encounter funnel
  // through), so it can't be reused by re-rolling repeatedly on one list.
  let rerollUsedThisEncounter = false;

  // What to do once the current wild encounter resolves (catch, flee, or
  // walk away). Defaults to the route trainer fight; challengeBadge()
  // temporarily points this at the Gym battle for the one-time bonus
  // encounter before the player's first ever badge challenge.
  // `postEncounterActionKind` mirrors `postEncounterAction` as a plain,
  // serializable label (see POST_ENCOUNTER_ACTIONS below) so a checkpoint
  // saved mid-encounter can rebuild the right closure on restore instead of
  // silently falling back to the trainer-battle default (the closure itself
  // can't survive a JSON round-trip).
  let postEncounterAction = () => startTrainerBattle();
  let postEncounterActionKind = 'trainer';
  const POST_ENCOUNTER_ACTIONS = {
    trainer: () => startTrainerBattle(),
    gymSelect: () => openGymSelect(),
    finalElitePrep: () => openPokeStop('finalElitePrep'),
    cruiseBattle: () => startCruiseBattle(),
    mythicalBattle: () => startMythicalBattle(),
  };
  function setPostEncounterAction(kind){
    postEncounterActionKind = kind;
    postEncounterAction = POST_ENCOUNTER_ACTIONS[kind];
  }
  function proceedAfterEncounter(){
    const action = postEncounterAction;
    setPostEncounterAction('trainer'); // reset to the default for next time
    action();
  }

  function wildPool(){
    return POKEMON.filter(p => !p.legendary && (p.id <= NATIONAL_DEX_MAX || isRegionalForm(p.name))
      && !PARADOX_POKEMON.includes(p.name)
      && !NO_MOVESET_UNREACHABLE.includes(p.name)
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
  // Jangmo-o's whole line is locked out of the wild/catch pool until the
  // player has beaten 6 gyms — after that any of the 3 can show up as normal.
  const KOMMO_O_LINE = new Set(['jangmo-o', 'hakamo-o', 'kommo-o']);
  const KOMMO_O_LINE_UNLOCK_BADGES = 6;
  function catchablePool(){
    const kommoOLocked = !runBeatenBadges || runBeatenBadges.size < KOMMO_O_LINE_UNLOCK_BADGES;
    return wildPool().filter(p => !STARTER_LINE_NAMES.has(p.name)
      && !(kommoOLocked && KOMMO_O_LINE.has(p.name)));
  }

  // How many of the most-recently-shown wild species (across every run,
  // not just this one) to keep deprioritizing — see recentlySeenAcrossRuns().
  const RECENT_WILD_CAP = 150;

  function recentlySeenAcrossRuns(){
    return new Set(META.recentWildNames || []);
  }

  // Only used by the wild-encounter-list pipeline below (pickWildChoices) —
  // excludes every species already shown in
  // ANY encounter list this run, caught or not, so nothing repeats across
  // different encounters. Also *soft*-excludes species shown recently in
  // PAST runs (see markWildChoicesSeen()/META.recentWildNames), so starting
  // a fresh run doesn't immediately resurface the same easy-tier mons the
  // last run just did — falls back to including them if that would leave
  // too few options for a full encounter list.
  function freshWildPool(){
    let base = catchablePool().filter(p => !seenWildNames.has(p.name));
    // Last-resort safety net: this run's "already shown" tracking should
    // never eat far enough into the catchable pool to leave fewer than a
    // full encounter's worth of options (e.g. heavy Reroll Ticket use before
    // rerollWildChoices() capped rerolls at 1/encounter could get there over
    // a long run). Rather than ever handing back a short wild-choice list,
    // wipe the this-run "seen" tracking and start it over from scratch.
    if(base.length < WILD_COUNT){
      seenWildNames = new Set();
      base = catchablePool();
    }
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
  //
  // One slot is drawn per generation (WILD_COUNT === GENERATIONS.length, see
  // below) directly, uniformly *within* that generation's pool, instead of the
  // old approach (draw WILD_COUNT at random from the whole pool, then patch in
  // whichever generations got missed). That old patch-up step still guaranteed
  // "one per gen" overall, but since generations vary a lot in easy-pool size
  // (e.g. Gen 1/3's ~100 easy species vs Gen 6/7's ~40), a missed generation
  // got filled by drawing from its own much smaller pool far more often than
  // its size alone would predict — so individual Gen 6/7 species kept
  // resurfacing noticeably more than Gen 1/3 ones. Assigning each generation
  // its own slot from the start removes that skew entirely.
  function pickWildChoices(){
    const full = freshWildPool();
    const easy = wildEasyPool();
    const strong = wildStrongPool();

    let easySlots;
    if(encounterNum <= ALL_EASY_ENCOUNTERS) easySlots = WILD_COUNT;
    else easySlots = Math.max(MIN_EASY_SLOTS, WILD_COUNT - Math.floor((encounterNum - ALL_EASY_ENCOUNTERS + 1) / 2));
    if(runBadges >= BADGES_FOR_RARITY_RAMP) easySlots = Math.max(MIN_EASY_SLOTS, easySlots - 1);
    const useStrongForRest = runBadges >= BADGES_FOR_RARITY_RAMP;

    // Random order decides both which generations get an "easy" slot (the
    // first `easySlots` of them) and the display order of the final list.
    const gensShuffled = pickN(GENERATIONS, GENERATIONS.length);
    const easyGens = new Set(gensShuffled.slice(0, easySlots).map(g => g.gen));

    const usedNames = new Set();
    const result = [];
    gensShuffled.forEach(g => {
      const tierPool = easyGens.has(g.gen) ? easy : (useStrongForRest ? strong : full);
      let candidates = tierPool.filter(p => generationOf(p.id) === g.gen && !usedNames.has(p.name));
      if(!candidates.length) candidates = full.filter(p => generationOf(p.id) === g.gen && !usedNames.has(p.name));
      if(!candidates.length) return; // nothing left for this generation this run — backfilled below
      const chosen = pick(candidates);
      usedNames.add(chosen.name);
      result.push(chosen);
    });

    // Safety net for the rare case a generation has nothing left at all this
    // run (same fallback freshWildPool() itself already relies on elsewhere).
    if(result.length < WILD_COUNT){
      const backfill = full.filter(p => !usedNames.has(p.name));
      pickN(backfill, WILD_COUNT - result.length).forEach(m => result.push(m));
    }
    return result;
  }

  // Bonus wild encounter right before the Mythical battle (post-8th-badge
  // story beat — swapped with Legendary, which now happens mid-Cruise
  // instead) — Alola/Galar Pokémon only, last evolution stage only
  // (EVOLUTIONS[name] falsy means nothing left to evolve into), capped at
  // ALOLA_GALAR_ENCOUNTER_MAX_BST so a pseudo-legendary like Kommo-o (600)
  // can't show up here, no starters/legendaries (catchablePool() already
  // excludes both). 450 only ever matched 9 species (fewer than WILD_COUNT,
  // so this encounter could never fill all 12 slots, worse still once any
  // of the 9 were already caught this run) — 490 keeps the same intent
  // (nothing pseudo-legendary-tier) while leaving enough candidates.
  const ALOLA_GALAR_ENCOUNTER_MAX_BST = 490;
  function alolaGalarLastStagePool(){
    return catchablePool().filter(p => {
      const g = generationOf(p.id);
      return (g === 7 || g === 8) && !EVOLUTIONS[p.name] && p.bst <= ALOLA_GALAR_ENCOUNTER_MAX_BST;
    });
  }

  // Bonus wild encounter right after resolving the Legendary on the Cruise
  // Ship's island stop, before rejoining the ship — beach/coastal Water-type
  // Pokémon only, same convention the Fishing mini-event already uses for
  // its own catch pool.
  const SAND_BASE_IMG = "assets/pokemon-game-assets/Graphics/Battlebacks/sand_base1.png";
  function beachEncounterPool(){
    return catchablePool().filter(p => p.types.includes('water'));
  }

  // Bonus wild encounter right before the Elite Four — a random draw from a
  // strong BST band, across every generation (no longer Unova/Kalos/Paldea-
  // only), no starters/legendaries. Was a flat "top 12 by BST" (so always
  // the exact same handful of species); now a band with both a floor and a
  // ceiling, sampled randomly, so who shows up actually varies run to run.
  const ELITE_BONUS_ENCOUNTER_MIN_BST = 390;
  const ELITE_BONUS_ENCOUNTER_MAX_BST = 530;
  function eliteBonusEncounterPool(){
    const candidates = catchablePool().filter(p =>
      p.bst >= ELITE_BONUS_ENCOUNTER_MIN_BST && p.bst <= ELITE_BONUS_ENCOUNTER_MAX_BST);
    return pickN(candidates, Math.min(WILD_COUNT, candidates.length));
  }

  // Shared driver for both bonus encounters above, shows a wild-encounter
  // picker like startEncounter(), but from a fixed curated pool instead of
  // the normal easy/full ramp, and resumes into `onDone` afterward instead
  // of the default trainer battle. Respects Pro/Nuzlocke's mystery cards
  // like any other encounter (see renderWildChoices()). `kind` is one of
  // POST_ENCOUNTER_ACTIONS' keys, so a checkpoint saved mid-encounter can
  // rebuild the follow-up action on restore.
  function startCuratedBonusEncounter(pool, kind, baseImg){
    wildEncounterBaseImg = baseImg || STARTER_BASE_IMG;
    setPostEncounterAction(kind);
    wildChoices = pickN(pool, Math.min(WILD_COUNT, pool.length)).map(mon =>
      (canBeShiny(mon) && Math.random() < SHINY_CHANCE) ? { ...mon, is_shiny:true } : mon
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


  function startEncounter(){
    document.getElementById('encounterNum').textContent = encounterNum;
    document.getElementById('starterName').textContent = starter.name;
    wildEncounterBaseImg = STARTER_BASE_IMG;

    // Always show a wild Pokémon encounter before the trainer, even with no
    // Pokéballs left — the catch screen offers a "walk away" out in that case.
    wildChoices = pickWildChoices().map(mon =>
      (canBeShiny(mon) && Math.random() < SHINY_CHANCE) ? { ...mon, is_shiny:true } : mon
    );
    markWildChoicesSeen(wildChoices);
    maybeGrantDudunsparceReroll();

    if(Math.random() < ITEM_EVENT_CHANCE){
      openItemFindEvent(revealWildEncounter);
    } else {
      revealWildEncounter();
    }
  }

  function revealWildEncounter(){
    rerollUsedThisEncounter = false;
    document.getElementById('encounterScreen').classList.add('active');
    renderWildChoices();
    renderRerollButton();
    // Checkpointed so abandoning here (closing the tab, hitting Back, or the
    // "back to homepage" logo elsewhere) and resuming later shows this exact
    // same wild list instead of silently re-rolling a brand new one — without
    // this, going home and back was a free, unlimited way to re-roll the
    // encounter (bypassing the Reroll Ticket economy) since every resume
    // used to fall back to the checkpoint *before* the encounter started.
    checkpoint('encounter');
  }

  function renderRerollButton(){
    const btn = document.getElementById('rerollBtn');
    if(!btn) return;
    // Pointless in Pro/Nuzlocke: the list it would reshuffle is hidden behind
    // mystery cards, so there's nothing to see before deciding to reroll.
    if(isBlindMode()){ btn.style.display = 'none'; return; }
    btn.style.display = '';
    btn.disabled = inv.rerollTickets <= 0 || rerollUsedThisEncounter;
    btn.textContent = 'Reroll';
  }

  // Not for the starter pick — only the wild-encounter list. 1 free per run,
  // more can be bought as Reroll Tickets at the PokeStop, but only 1 use is
  // ever allowed per single encounter (see rerollUsedThisEncounter) no
  // matter how many Tickets are stocked up.
  function rerollWildChoices(){
    if(inv.rerollTickets <= 0 || rerollUsedThisEncounter) return;
    inv.rerollTickets--;
    rerollUsedThisEncounter = true;
    trackItemUsed('rerollTickets');
    wildChoices = pickWildChoices().map(mon =>
      (canBeShiny(mon) && Math.random() < SHINY_CHANCE) ? { ...mon, is_shiny:true } : mon
    );
    markWildChoicesSeen(wildChoices);
    renderWildChoices();
    renderRerollButton();
    // Re-checkpoint with the post-reroll list + the now-spent rerollTickets/
    // rerollUsedThisEncounter, same reasoning as revealWildEncounter()'s own
    // checkpoint() call — otherwise going home right after a real reroll and
    // resuming would silently refund it (back to the pre-reroll checkpoint).
    checkpoint('encounter');
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
      <div class="lab-sprite-wrap"><img class="lab-base" src="${wildEncounterBaseImg}" alt="" draggable="false">${avatarHTML(mon)}</div>
      <span class="c-name">${displayName(mon.name)}</span>
      <div class="c-types">${typeDotsHTML(mon.types)}</div>
      ${mon.is_shiny ? '<span class="shiny-dot" title="Shiny!"></span>' : ''}`;
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
      groundSpritesOnBase(`#${grid.id}`); // no-op if this grid has no .lab-base cards (e.g. wild encounters)
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
    if(!pro) groundSpritesOnBase('#wildGrid');

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
    // Callers (revealWildEncounter()/rerollWildChoices()) checkpoint right
    // after this renders, so a refresh/"back to homepage" resumes into this
    // exact same wild list instead of re-rolling a new one — see their own
    // comments. Not checkpointed here directly since restoreRun()'s own
    // 'encounter' branch also calls this to redraw from already-restored
    // state, and re-checkpointing there would just rewrite the same save.
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
      <div class="lab-sprite-wrap">
        <img class="lab-base" src="${wildEncounterBaseImg}" alt="" draggable="false">
        ${avatarHTML(target)}
        <div class="ball-fx" id="ballFx"></div>
      </div>
      <span class="c-name">${displayName(target.name)}</span>
      <div class="c-types">${typeChipsHTML(target.types)}</div>
      ${shinyTagHTML(target)}
    `;
    groundSpritesOnBase('#catchScreen');
    renderCatchActions();
  }

  function canThrow(){ return inv.balls > 0 || inv.greatBalls > 0 || inv.ultraBalls > 0 || inv.masterBalls > 0; }

  // One clickable icon card per throwable/usable item — clicking a card
  // directly throws that ball or uses that food item, no separate button
  // rows. Master Ball only shows up once the player actually has one.
  const CATCH_ACTION_ITEMS = [
    { key:'balls',       label:'Balls' },
    { key:'greatBalls',  label:'Great' },
    { key:'ultraBalls',  label:'Ultra' },
    { key:'masterBalls', label:'Master' },
    { key:'berrySnack',  label:'Berry' },
    { key:'pokeTreat',   label:'Treat' },
  ];

  function renderCatchActions(){
    const busy = catchBusy || encounterOver;

    // The food-item boost (pendingMultiplier) applies to computeCatchChance()
    // regardless of which ball kind gets thrown next — flag every throwable
    // ball, not just the Pokéball, so that's clear. Master Ball is the one
    // exception: it bypasses the formula entirely.
    const boosted = pendingMultiplier > 1;

    const el = document.getElementById('catchActionRow');
    const items = CATCH_ACTION_ITEMS.filter(it => it.key !== 'masterBalls' || inv.masterBalls > 0);
    el.innerHTML = items.map(it => {
      const count = inv[it.key];
      const disabled = busy || count <= 0;
      const showBoost = boosted && it.key !== 'masterBalls' && it.key !== 'berrySnack' && it.key !== 'pokeTreat';
      return `<button class="catch-action-card" data-key="${it.key}" ${disabled ? 'disabled' : ''}>
        ${itemIconHTML(it.key)}
        <span class="inv-count">${count}</span>
        <span class="inv-label">${it.label}</span>
        ${showBoost ? '<span class="boost-tag">BOOST</span>' : ''}
      </button>`;
    }).join('');
    el.querySelectorAll('.catch-action-card').forEach(btn => {
      btn.onclick = () => {
        const key = btn.dataset.key;
        if(key === 'berrySnack' || key === 'pokeTreat') useFoodItem(key);
        else resolveThrow(key);
      };
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
    // Alcremie: made of sweets — Berry Snack/Poke Treat's own catch-chance
    // boost (the part over 1x) is 25% stronger, not the whole multiplier.
    const boost = hasActiveSpecies(n => n === 'alcremie')
      ? 1 + (item.boost - 1) * ALCREMIE_FOOD_BOOST_BONUS
      : item.boost;
    pendingMultiplier *= boost;
    pendingFleeReduction = Math.max(pendingFleeReduction, item.fleeReduction);
    if(item.noCritFlee) pendingNoCritFlee = true;
    renderCatchActions();
    appendCatchLog(`You used a ${item.label} on ${displayName(target.name)}. Catch chance up!`);
  }

  // catch_chance = base_species_rate × ball_modifier × (food multiplier stack).
  // Master Ball bypasses the formula entirely.
  function computeCatchChance(mon, kind){
    if(kind === 'masterBalls') return 1;
    const base = mon.base_species_rate ?? 0.3;
    return clamp(base * BALL_MODIFIERS[kind] * pendingMultiplier * catchChanceMultiplier(), 0, 1);
  }

  // Records a species name into runCaughtLog the instant it actually joins
  // the roster (wild catch, Trade, a battle/Casino/Token Exchange reward —
  // see every call site) — see runCaughtLog's own comment for why this has
  // to be separate from just reading `caught`/`activeTeam` at run end.
  function logCatch(name){
    if(runCaughtLog) runCaughtLog.push(name);
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
    logCatch(mon.name);
    if(source === 'safari') safariCatchCount++;
    else if(source === 'fishing') fishingCatchCount++;
    return maybeDittoCopy(mon);
  }

  // Ditto: transforms into / copies whatever it's near — a small chance a
  // Ditto on the team also duplicates whatever was just caught, straight
  // into Storage as a genuinely separate instance (never the same object
  // reference as the original catch). Returns the duplicate (so callers
  // can mention it in their own catch log), or null if it didn't trigger.
  function maybeDittoCopy(mon){
    if(!hasActiveSpecies(n => n === 'ditto')) return null;
    if(Math.random() >= DITTO_COPY_CHANCE) return null;
    const copy = { ...mon };
    storage_.push(copy);
    logCatch(copy.name);
    return copy;
  }

  // ---------- BALL-THROW VISUAL (catch screen + Safari Zone) ----------
  // Plays over #ballFx/#safariBallFx — see selectWildTarget()/
  // startSafariEncounter() for where those get (re)created each new target,
  // since both screens fully replace their target container's innerHTML per
  // encounter. Purely cosmetic: the actual catch-chance roll already
  // happened by the time this runs (single roll, no per-shake mechanic —
  // the shake frames just play through once as flavor either way), and
  // `onDone` fires once the sequence finishes so the caller can then reveal
  // the real outcome (log line, roster change, etc.) in sync with the ball
  // settling.
  //
  // Sheet: 28 ball types (columns) x 32 frames (rows) of 64x64 native,
  // displayed at 112x112 (scale 1.75 -> scaled sheet 3136x3584, one scaled
  // frame = 112x112) so it actually reads at a sane size next to the 260px
  // catch-screen sprite instead of looking like a tiny dot — see the
  // matching BALL_FX_FRAME-derived math in style.css's .ball-fx rules.
  // Row phases: 0-3 throw, 4-14 aspiration (11), 15-19 shake (5), 20-26
  // break/fail (7), 27-31 success (5).
  const BALL_FX_SHEET = "assets/pokemon-game-assets/all_pokeball_sprites_for_throw_animation_by_anarlaurendil_ddhnxzf.png";
  const BALL_FX_COL = { balls:0, greatBalls:1, ultraBalls:2, masterBalls:3, safariBalls:12 };
  const BALL_FX_FRAME = 112;
  function playBallThrowFx(fxId, kind, success, onDone){
    const el = document.getElementById(fxId);
    if(!el){ onDone(); return; }
    // Only the Pokémon's own sprite "enters" the ball during aspiration
    // (rolls/shrinks/fades toward it, like it's rolling across its own
    // .lab-base platform), not the base itself — targets .avatar specifically,
    // not the whole .lab-sprite-wrap. Stays hidden through the shake, and
    // only pops back out if the catch fails. Sits in the same .catch-target
    // as ballFx, so it's found relative to it rather than needing its own id.
    const targetWrap = el.closest('.catch-target');
    const sprite = targetWrap ? targetWrap.querySelector('.lab-sprite-wrap .avatar') : null;
    if(sprite) sprite.classList.remove('absorbing', 'released');
    const col = BALL_FX_COL[kind] ?? 0;
    el.style.backgroundImage = `url('${BALL_FX_SHEET}')`;
    el.style.backgroundPositionX = `-${col * BALL_FX_FRAME}px`;
    el.className = 'ball-fx throwing';
    setTimeout(() => {
      el.className = 'ball-fx aspirating';
      if(sprite) sprite.classList.add('absorbing');
      setTimeout(() => {
        el.className = 'ball-fx shaking';
        setTimeout(() => {
          if(success){
            // The 5-frame sparkle-burst plays once (its own .42s in
            // style.css — see .ball-fx-success-frames), then the ball drops
            // to a plain effect-free pose (.settled) and just sits there for
            // a full 2s so the "caught!" beat actually reads before moving
            // on, instead of staying frozen mid-sparkle-burst or rushing
            // past it. Never gets reset back to the base .ball-fx state here
            // — the next encounter's fresh innerHTML (selectWildTarget()/
            // startSafariEncounter()) replaces this element outright anyway.
            el.className = 'ball-fx success';
            setTimeout(() => {
              el.className = 'ball-fx settled';
              setTimeout(onDone, 2000);
            }, 420);
          } else {
            el.className = 'ball-fx breaking';
            if(sprite){ sprite.classList.remove('absorbing'); sprite.classList.add('released'); }
            setTimeout(() => {
              el.className = 'ball-fx breaking fade';
              setTimeout(() => { el.className = 'ball-fx'; el.style.backgroundPositionX = ''; onDone(); }, 220);
            }, 600);
          }
        }, 550);
      }, 680);
    }, 400);
  }

  function resolveThrow(kind){
    if(catchBusy || encounterOver || inv[kind] <= 0) return;
    catchBusy = true;
    inv[kind]--;
    trackItemUsed(kind);

    const chance = computeCatchChance(target, kind);
    const fleeChance = pendingNoCritFlee ? 0 : Math.max(0, ballBaseFleeChance() - pendingFleeReduction);
    pendingMultiplier = 1;
    pendingFleeReduction = 0;
    pendingNoCritFlee = false;

    renderCatchActions();
    appendCatchLog(`You threw a ${BALL_LABELS[kind]} at ${displayName(target.name)}...`);

    const success = Math.random() < chance;
    playBallThrowFx('ballFx', kind, success, () => {
      if(success){
        const dittoCopy = catchWildTarget(target);
        appendCatchLog(`Gotcha! ${displayName(target.name)} was caught!${dittoCopy ? ` Ditto transformed into a copy, a second ${displayName(target.name)} joins your team!` : ''}`);
        encounterOver = true;
        renderCatchActions();
        setTimeout(proceedAfterEncounter, 900);
        return;
      }
      if(Math.random() < fleeChance){
        appendCatchLog(`${displayName(target.name)} broke free and fled!`);
        encounterOver = true;
        perfectCatcher = false; // Perfectionist achievement
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
        perfectCatcher = false; // Perfectionist achievement
        renderCatchActions();
        setTimeout(proceedAfterEncounter, 900);
      }
    });
  }

  // ---------- CHAMPION ENDING (shown once, right after the 4th Elite Four win) ----------
  // Extends the existing end-of-run flow rather than replacing it: this
  // screen's own Continue button is what calls openHillIntro() to move on.
  // No item reward here anymore — beating the Elite Four earns entry into
  // the Hall of Fame itself, shown via the same staggered .hof-anim
  // team reveal used on the (also Champion-only) result screen spotlight.
  function openChampionEnding(){
    const el = document.getElementById('championScreen');
    el.classList.add('active');
    const spotlightHTML = activeTeam.map((mon, i) => `
      <div class="spotlight-slot has-base hof-anim" style="animation-delay:${i * HOF_STAGGER_MS}ms">
        <div class="lab-sprite-wrap"><img class="lab-base" src="${CHAMPION_BASE_IMG}" alt="" draggable="false">${avatarHTML(mon,'avatar-sm')}</div>
        <span class="tn">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">SHINY</span>' : ''}</span>
      </div>`).join('');
    el.innerHTML = `
      <div class="eyebrow">Elite Four Cleared</div>
        <p class="tagline">All four Elite Four members have fallen. <br> Your team enters the Hall of Fame.</p>
      <div class="hof-scene">
        <img class="hof-logo" src="assets/ui/HOF-Logo.png" alt="Hall of Fame" draggable="false">
            <br><br><br><br>
        <div class="team-spotlight-grid" id="championHofGrid">${spotlightHTML}</div>
      </div>
      <button class="btn-primary" id="championContinueBtn" style="margin-top:16px;">CONTINUE</button>
    `;
    groundSpritesOnBase('#championHofGrid');
    document.getElementById('championContinueBtn').addEventListener('click', () => {
      el.classList.remove('active');
      el.innerHTML = '';
      openHillIntro();
    });
  }

  // ---------- KING OF THE HILL ----------
  // Reached right after Elite Four instead of ending the run: a distant
  // silhouette turns out to be the mode's current #1 ranked player, rebuilt
  // as an AI opponent from their saved final_team species list. Winning
  // unlocks the King of the Hill achievement and leads into the infinite
  // loop (openInfiniteLoopScreen()); losing falls through to the normal
  // generic loss branch in afterBattle(), same as any other battle.
  async function openHillIntro(){
    const el = document.getElementById('hillIntroScreen');
    el.classList.add('active');
    el.innerHTML = `
      <div class="pokestop-header-row">
        <a class="pokestop-home-link" href="index.html" title="Back to Home">
          <img src="assets/website/Rinnelogo.png" alt="Rinne home" draggable="false" oncontextmenu="return false;">
        </a>
        <div class="pokestop-header-text">
          <div class="eyebrow">The Hill</div>
          <h1 class="section-h1">A LONE SILHOUETTE AWAITS</h1>
        </div>
      </div>
      <p class="tagline" id="hillIntroTagline">Someone is already standing at the top of the hill.</p>
      <div class="hill-scene"><img src="${TRAINER_PORTRAIT_DIR}/Champion-SIlhouette.jpg" alt="" onerror="this.style.display='none'"></div>
      <button class="btn-primary" id="hillClimbBtn" style="margin-top:16px;">CLIMB THE HILL</button>
    `;
    checkpoint('hill');
    document.getElementById('hillClimbBtn').addEventListener('click', async () => {
      const btn = document.getElementById('hillClimbBtn');
      btn.disabled = true;
      btn.textContent = 'CLIMBING...';
      const top1Row = await fetchHillTop1();
      let squad = top1Row && reconstructTop1Squad(top1Row);
      let top1Name, achievements, isFake;
      if(squad){
        top1Name = escapeHTML(top1Row.name || 'Champion');
        achievements = hillRowAchievements(top1Row);
        isFake = false;
      } else {
        // No usable ranking row yet (empty leaderboard, or a legacy row from
        // before final_team existed) — a fictitious opponent still needs a
        // face and a bragging-rights list, so it gets its own made-up name
        // and a handful of real achievement titles for flavor.
        const fallback = rollEliteMember(ELITE_FOUR[ELITE_FOUR.length - 1], true);
        squad = fallback.squad;
        const identity = fictitiousTop1Identity();
        top1Name = identity.name;
        achievements = identity.achievements;
        isFake = true;
      }
      renderHillReveal(top1Name, squad, achievements, isFake);
    });
  }

  function renderHillReveal(top1Name, squad, achievements, isFakeTop1){
    const el = document.getElementById('hillIntroScreen');
    el.innerHTML = `
      <div class="eyebrow">The Hill</div>
      <h1 class="section-h1">${top1Name} TURNS AROUND</h1>
      <div class="hill-scene"><img src="${TRAINER_PORTRAIT_DIR}/Champion-Reveal.jpg" alt="" onerror="this.style.display='none'"></div>
      <p class="tagline">"So you've come to challenge me for the title."</p>
      <button class="btn-primary" id="hillBeginBattleBtn" style="margin-top:16px;">BEGIN BATTLE</button>
    `;
    document.getElementById('hillBeginBattleBtn').addEventListener('click', () => {
      el.classList.remove('active');
      el.innerHTML = '';
      beginBattle({ name: top1Name, squad, isHillTop1: true, achievements: achievements || [], isFakeTop1: !!isFakeTop1 });
    });
  }

  // Made-up name + a handful of real achievement titles, only ever used when
  // there's no real ranking row to pull a Top1 from (empty leaderboard, or a
  // legacy score saved before final_team existed).
  const FAKE_TOP1_NAMES = ['Ash K.', 'Red', 'Leaf', 'Kris', 'Ethan', 'May', 'Dawn', 'Lucas', 'Hilbert', 'Serena', 'Elio', 'Nemona'];
  function fictitiousTop1Identity(){
    const pool = ACHIEVEMENT_DEFS.map(a => a.name);
    return { name: pick(FAKE_TOP1_NAMES), achievements: pickN(pool, Math.min(randInt(2, 4), pool.length)) };
  }

  // Fetches the mode's current #1 ranked player, applying the tie-break
  // rules (caughtCount, then shiny count, then achievement count, then
  // goldEarned) across the top-scoring batch, since a single "order by
  // score desc limit 1" query can't express a tie-break. Returns null (never
  // throws) if there's no ranking yet for this mode, or Supabase is unreachable.
  async function fetchHillTop1(){
    if(!supabaseClient) return null;
    try{
      const { data, error } = await supabaseClient
        .from('scores')
        .select('*')
        .eq('mode', gameMode)
        .order('score', { ascending: false })
        .limit(20);
      if(error) throw error;
      if(!data || !data.length) return null;
      const topScore = data[0].score;
      const tied = data.filter(r => r.score === topScore);
      tied.sort((a,b) => {
        if(b.caught_count !== a.caught_count) return b.caught_count - a.caught_count;
        const shinyDiff = hillRowShinyCount(b) - hillRowShinyCount(a);
        if(shinyDiff !== 0) return shinyDiff;
        const achDiff = hillRowAchievementCount(b) - hillRowAchievementCount(a);
        if(achDiff !== 0) return achDiff;
        return b.gold_earned - a.gold_earned;
      });
      return tied[0];
    }catch(e){ return null; }
  }

  function hillRowShinyCount(row){
    const details = row.details || {};
    const caught = Array.isArray(details.caught) ? details.caught : [];
    let count = caught.filter(m => m && m.is_shiny).length;
    if(details.starter && details.starter.is_shiny) count++;
    return count;
  }

  function hillRowAchievementCount(row){
    return hillRowAchievements(row).length;
  }

  function hillRowAchievements(row){
    const details = row.details || {};
    return Array.isArray(details.achievements) ? details.achievements : [];
  }

  // Maps the Top1's saved species names back to real Pokémon data, in the
  // same squad shape rollEliteMember()/rollCruiseBattle() already produce.
  // Returns null if the row predates this feature (empty/too-short
  // final_team) so the caller falls back to a fictitious opponent instead.
  // final_team is the real source going forward, but every score saved
  // before this feature shipped has it empty — details.activeRoster (the
  // run's actual final team, already stored for the result/run-detail
  // cards) is a legitimate stand-in for those legacy rows, so a Top1 who
  // hasn't submitted a new run yet still gets their own team here instead
  // of always falling back to a fictitious one. Only actually falls back
  // (returns null) if neither source has enough usable species — e.g. a
  // Nuzlocke loss where the whole team had already been wiped/graveyarded.
  function reconstructTop1Squad(row){
    const finalTeamNames = Array.isArray(row.final_team) ? row.final_team.slice(0, 6) : [];
    let mons = finalTeamNames.map(n => POKEMON_BY_NAME[n]).filter(Boolean);
    if(mons.length < 3){
      const activeRoster = Array.isArray(row.details && row.details.activeRoster) ? row.details.activeRoster : [];
      mons = activeRoster.slice(0, 6).map(m => POKEMON_BY_NAME[m && m.name]).filter(Boolean);
    }
    return mons.length >= 3 ? mons : null;
  }

  // ---------- INFINITE LOOP (post-King of the Hill) ----------
  // No PokeStop access at all from here on (no Computer, Lucky Dice, Token
  // Shop, Potion/Revive purchases) — this screen simply offers nothing but
  // the next fight and the END RUN button (reused from the PokeStop's,
  // see renderAbandonButton()).
  function openInfiniteLoopScreen(){
    const el = document.getElementById('infiniteLoopScreen');
    el.classList.add('active');
    el.innerHTML = `
      <div class="pokestop-header-row">
        <a class="pokestop-home-link" href="index.html" title="Back to Home">
          <img src="assets/website/Rinnelogo.png" alt="Rinne home" draggable="false" oncontextmenu="return false;">
        </a>
        <div class="pokestop-header-text">
          <div class="eyebrow">King of the Hill</div>
          <h1 class="section-h1">DEFEND YOUR TITLE</h1>
        </div>
      </div>
      <p class="tagline">Hill Defenses: <b>${hillDefenses}</b></p>
      <p class="tagline">Another challenger approaches. There's no PokeStop up here, just the next fight.</p>
      <button class="btn-primary" id="nextTrainerBtn" style="margin-top:16px;">NEXT TRAINER</button>
    `;
    checkpoint('infiniteLoop');
    document.getElementById('nextTrainerBtn').addEventListener('click', () => {
      // Without this, the loop screen stays .active underneath the battle
      // screen (they're just stacked divs, not mutually-exclusive overlays)
      // — the next trainer's fight would render with "DEFEND YOUR TITLE" and
      // its own NEXT TRAINER button still showing right below it.
      el.classList.remove('active');
      beginBattle(rollInfiniteLoopTrainer());
    });
  }

  // Escalating difficulty past Elite Four's toughest tier, with no upper
  // limit — each trainer's BST band climbs a fixed step above the last.
  // From the 2nd trainer on, one slot may be swapped for a Mega form (same
  // mechanic as the final Elite Four member); from the 3rd on, the pool
  // drops wildPool()'s legendary exclusion, so Legendaries/Mythicals become
  // eligible picks as a winning strategy, not guaranteed every fight.
  const INFINITE_LOOP_BST_STEP = 25;
  // Only evolved Pokemon (not a first-stage) or ones with BST > 500 qualify —
  // keeps weak base-forms that happened to roll into a high BST band (via
  // the "at least this strong" fallbacks below) out of Hill Challenger squads.
  const isHillWorthy = p => EVOLVED_NAMES.has(p.name) || p.bst > 500;
  function rollInfiniteLoopTrainer(){
    infiniteLoopTrainerNum++;
    const n = infiniteLoopTrainerNum;
    const baseTier = ELITE_FOUR[ELITE_FOUR.length - 1];
    const minBst = baseTier.minBst + INFINITE_LOOP_BST_STEP * n;
    const maxBst = baseTier.maxBst + INFINITE_LOOP_BST_STEP * n;
    // Legendaries/Mythicals never fill the base pool — their BST dwarfs the
    // non-legendary pool once bands climb this high, so allowing them in
    // here would silently turn the whole squad into Legendaries instead of
    // the single strategic pick applied below. p.legendary already covers
    // both (see MYTHICAL_POKEMON's own comment).
    let pool = POKEMON.filter(p => p.id <= NATIONAL_DEX_MAX && !PARADOX_POKEMON.includes(p.name)
      && !p.legendary && p.bst >= minBst && p.bst <= maxBst && isHillWorthy(p));
    // BST bands this high can run dry fast — fall back to "at least this
    // strong" rather than ever failing to fill a 6-Pokémon squad.
    if(pool.length < 6){
      pool = POKEMON.filter(p => p.id <= NATIONAL_DEX_MAX && !PARADOX_POKEMON.includes(p.name)
        && !p.legendary && p.bst >= minBst && isHillWorthy(p));
    }
    if(pool.length < 6){
      pool = POKEMON.filter(p => p.id <= NATIONAL_DEX_MAX && !PARADOX_POKEMON.includes(p.name) && !p.legendary && isHillWorthy(p));
    }
    // Absolute last resort, so a thin dex slice can never fail to fill a
    // 6-Pokemon squad — drops the evolved-or-500-BST rule only if nothing
    // else is left to pick from.
    if(pool.length < 6){
      pool = POKEMON.filter(p => p.id <= NATIONAL_DEX_MAX && !PARADOX_POKEMON.includes(p.name) && !p.legendary);
    }
    // High-BST bands are genuinely thin (barely a dozen species once they
    // climb past ~550), so without this, the same handful of "pseudo-
    // legendary" Pokémon (Salamence, Tyranitar, Dragonite...) end up facing
    // the player over and over across different Hill Challengers in the
    // same run. Same fallback pattern as rollEliteMember()'s eliteUsedNames:
    // prefer species this run's loop hasn't fielded yet, only fall back to
    // the full band if that's too small to fill a 6-Pokémon squad.
    const unusedPool = pool.filter(p => !hillChallengerUsedNames.has(p.name));
    const squad = pickN(unusedPool.length >= 6 ? unusedPool : pool, 6);

    let megaIdx = -1;
    if(n >= 2){
      const megaCandidates = pool.filter(p => MEGA_FORMS_BY_BASE[p.name] && MEGA_FORMS_BY_BASE[p.name].length && !squad.includes(p));
      // hillChallengerUsedNames stores the Mega FORM's own name (e.g.
      // "staraptor-mega"), since that's the actual squad member — checking
      // the base's name here would never match, letting the same Mega
      // reappear over and over (found via testing: Mega Alakazam/Staraptor
      // repeating within a handful of Hill Challengers).
      const unusedMegaCandidates = megaCandidates.filter(p =>
        !MEGA_FORMS_BY_BASE[p.name].some(formName => hillChallengerUsedNames.has(formName)));
      const allMegaCapable = unusedMegaCandidates.length ? unusedMegaCandidates
        : megaCandidates.length ? megaCandidates
        : Object.keys(MEGA_FORMS_BY_BASE).map(name => POKEMON_BY_NAME[name]).filter(p => p && !squad.includes(p));
      if(allMegaCapable.length){
        const megaBase = pick(allMegaCapable);
        const megaForm = POKEMON_BY_NAME[pick(MEGA_FORMS_BY_BASE[megaBase.name])];
        megaIdx = squad.length - 1;
        squad[megaIdx] = megaForm;
      }
    }

    // From the 3rd trainer on, exactly 1 slot may become a Legendary or
    // Mythical. From the 8th trainer on, more than one slot can — climbing
    // slowly to a cap of 3 so it never takes over the whole squad.
    const legendaryIdxs = [];
    if(n >= 3){
      const legendaryCount = n >= 8 ? Math.min(3, 2 + Math.floor((n - 8) / 4)) : 1;
      const legendaryPool = POKEMON.filter(p => p.id <= NATIONAL_DEX_MAX && p.legendary && !squad.includes(p) && !NO_MOVESET_UNREACHABLE.includes(p.name));
      const unusedLegendaryPool = legendaryPool.filter(p => !hillChallengerUsedNames.has(p.name));
      let pickPool = unusedLegendaryPool.length >= legendaryCount ? unusedLegendaryPool : legendaryPool;
      for(let i = squad.length - 2, placed = 0; i >= 0 && placed < legendaryCount && pickPool.length; i--){
        if(i === megaIdx) continue;
        const choice = pick(pickPool);
        squad[i] = choice;
        pickPool = pickPool.filter(p => p !== choice);
        legendaryIdxs.push(i);
        placed++;
      }
    }

    // From the 3rd trainer on, exactly 1 slot guaranteed to be a Paradox
    // Pokemon — a deliberate difficulty spike on top of the BST-band ramp
    // above, not just more of the same curve. From the 7th trainer on, 2 —
    // unlike the Legendary swap above, this is a hard cap, never climbs to
    // 3. Fills whichever slots the Mega/Legendary swaps above left
    // untouched, front to back, so all 3 special-slot mechanics can coexist
    // in one squad.
    if(n >= 3){
      const paradoxCount = n >= 7 ? 2 : 1;
      const paradoxPool = POKEMON.filter(p => PARADOX_POKEMON.includes(p.name) && !squad.includes(p));
      const unusedParadoxPool = paradoxPool.filter(p => !hillChallengerUsedNames.has(p.name));
      let pickPool = unusedParadoxPool.length >= paradoxCount ? unusedParadoxPool : paradoxPool;
      for(let i = 0, placed = 0; i < squad.length && placed < paradoxCount && pickPool.length; i++){
        if(i === megaIdx || legendaryIdxs.includes(i)) continue;
        const choice = pick(pickPool);
        squad[i] = choice;
        pickPool = pickPool.filter(p => p !== choice);
        placed++;
      }
    }

    squad.forEach(p => hillChallengerUsedNames.add(p.name));
    return { name: `Hill Challenger #${n}`, squad: rollTrainerShinySquad(squad, HILL_SHINY_CHANCE), isInfiniteLoop: true, hillChallengerNum: n };
  }

  function finishEncounter(){
    // Identify the starter by reference, not position, the Computer screen
    // lets the player reorder activeTeam, so the starter isn't always slot 0.
    const allCaught = [...activeTeam.filter(m => m !== starter), ...storage_];
    const run = {
      starter, caught: allCaught, trainersBeaten: runTrainersBeaten, badges: runBadges,
      champion: runChampion, trainerLoss, trainerLossMon, goldEarned: runGoldEarned,
      beatenBadges: Array.from(runBeatenBadges), eliteBeaten: eliteIndex, legendaryHandled, mythicalHandled,
      activeRoster: activeTeam.slice(), // the final active team, in order, for the spotlight + Hall of Fame card
      nuzlockeGraveyard: (nuzlockeGraveyard || []).slice(), // Nuzlocke only — shown grayed out on the result/run-detail cards
      mode: gameMode,
      // King of the Hill: the final active team's species (up to 6 names,
      // no level/moveset concept exists here), saved so whoever reaches the
      // Hill next can rebuild this run's roster as their opponent, and how
      // many infinite-loop trainers were beaten after dethroning the
      // previous Top1 (also already folded into trainersBeaten above).
      finalTeamSpecies: activeTeam.slice(0, 6).map(m => m.name),
      hillDefenses: hillDefenses || 0,
      // Species-at-acquisition-time bookkeeping only, for the "Most Caught"/
      // "Most Picked Starter" cross-run stats (stats.html/profile.html) —
      // see runCaughtLog/starterOriginalName's own comments for why these
      // can't just be derived from `caught`/`starter` above.
      caughtSpeciesLog: (runCaughtLog || []).slice(),
      starterSpeciesAtPick: starterOriginalName || starter.name,
      // Everything below feeds ACHIEVEMENT_DEFS only (see checkAchievements()),
      // nothing here affects scoring or any other part of the result screen.
      itemsUsed, safariCatchCount, fishingCatchCount,
      evolvedCount: evolvedSpeciesThisRun.size,
      playerStatusEffectsApplied, eliteGauntletFlawless, comebackKidAchieved, perfectCatcher,
      goldSpentOnSlots, top1Defeated: !!top1Defeated,
    };
    run.achievements = checkAchievements(run);
    renderResult(run);
  }

  // ---------- TRAINER BATTLE ----------
  let battle;

  function currentPartySize(){ return activeTeam.length; }

  // Hiker Anthony is always a Double Battle — 2 Pokémon a side, both active
  // and fighting at once, exactly like the Cruise Ship's First Mate Thaise
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

  // When a strength-bounded pool is too thin to fill a squad, widen by
  // picking the fallback pool's closest-BST members to the target ceiling
  // instead of silently fielding a smaller squad than intended (which is
  // what used to happen here) — same fix already applied to Gym squads
  // (see rollBadgeGym()'s closestByStrength), just for route trainers.
  function widenToClosestBst(thinPool, squadSize, targetBst, fallbackPool){
    if(thinPool.length >= squadSize) return thinPool;
    const closest = [...fallbackPool].sort((a,b) => Math.abs(a.bst - targetBst) - Math.abs(b.bst - targetBst));
    return closest.slice(0, Math.max(squadSize * 3, 8));
  }

  function rollTrainer(){
    // The last 3 route trainers of the run (fought on the way to the 6th,
    // 7th, and 8th badges) get a bigger squad — a deterministic 4, then 5,
    // then 6 Pokémon — as a predictable final ramp-up before the endgame.
    // Before that, squad size climbs steadily: +1 for every 3 badges earned,
    // capped well below a full team.
    const finalStretchStart = BADGES_TO_UNLOCK_ENDGAME - 3;
    const isFinalStretch = runBadges >= finalStretchStart;

    // Computed up front (rather than right before the final return, like
    // before) so widenToClosestBst() below can already size against it.
    const squadSize = BEEFED_UP_ROUTE_ENCOUNTERS.includes(encounterNum)
      ? randInt(BEEFED_UP_ROUTE_MIN_SQUAD, BEEFED_UP_ROUTE_MAX_SQUAD)
      : isFinalStretch
        ? Math.min(4 + (runBadges - finalStretchStart), currentPartySize())
        : Math.min(
            ROUTE_TRAINER_SQUAD_SIZE + Math.floor(runBadges / 3),
            ROUTE_TRAINER_MAX_SQUAD,
            currentPartySize()
          );

    let pool;
    if(isFinalStretch){
      // Squad size and raw strength both ramp together here — see
      // ROUTE_FINAL_STRETCH_TIERS. Clamped to the last tier (same pattern as
      // GYM_DIFFICULTY_TIERS below) since runBadges can reach/exceed
      // BADGES_TO_UNLOCK_ENDGAME while a route trainer is still in flight —
      // an unclamped index here used to read past the array's end and crash.
      const tier = softenTierBst(ROUTE_FINAL_STRETCH_TIERS[Math.min(runBadges - finalStretchStart, ROUTE_FINAL_STRETCH_TIERS.length - 1)], classicBstFactor());
      const band = wildPool().filter(p => p.bst >= tier.minBst && p.bst <= tier.maxBst);
      pool = widenToClosestBst(band, squadSize, tier.maxBst, wildPool());
    } else {
      // The player's very first route trainer fight this run gets an extra-easy
      // cap, giving a fresh starter better odds before it's had a chance to grow.
      const maxBst = (encounterNum === 1 ? FIRST_TRAINER_MAX_BST : LOW_TIER_MAX_BST) * classicBstFactor();
      const band = wildPool().filter(p => p.bst <= maxBst);
      pool = widenToClosestBst(band, squadSize, maxBst, wildPool());
    }

    // Forced at the scheduled encounter (as long as the player actually has
    // 2 Pokémon to field); the random pick below never lands on him otherwise.
    if(encounterNum === DOUBLE_BATTLE_ENCOUNTER_NUM && currentPartySize() >= 2){
      const name = DOUBLE_BATTLE_TRAINER_NAME;
      return { name, squad: rollTrainerShinySquad(pickN(pool, 2), TRAINER_SHINY_CHANCE), isGym:false, isDouble:true, portraitFile: trainerPortraitFile(name) };
    }

    // The Rival's first appearance (see RIVAL_CAMEO_ENCOUNTER_NUM) — always
    // fields his signature Absol regardless of this encounter's usual
    // strength band, plus RIVAL_CAMEO_SQUAD_SIZE-1 normally-rolled Pokémon
    // alongside it (scaled down if the player's own roster is thinner).
    // isRivalCameo (not isRival) keeps this out of every endgame-specific
    // branch isRival triggers (AI Potion, the Cruise-ending routing in
    // afterBattle(), etc.) — those only apply to the real Cruise fight.
    if(encounterNum === RIVAL_CAMEO_ENCOUNTER_NUM){
      const signature = POKEMON_BY_NAME[CRUISE_RIVAL_SIGNATURE_SPECIES];
      const restSize = Math.max(0, Math.min(RIVAL_CAMEO_SQUAD_SIZE, currentPartySize()) - 1);
      const rest = pickN(pool.filter(p => p.name !== CRUISE_RIVAL_SIGNATURE_SPECIES), restSize);
      const squad = signature ? [signature, ...rest] : rest;
      return { name: CRUISE_RIVAL.name, squad: rollTrainerShinySquad(squad, TRAINER_SHINY_CHANCE), isGym:false, isRivalCameo:true, portraitFile: trainerPortraitFile(CRUISE_RIVAL.name) };
    }

    const name = pick(TRAINER_ARCHETYPES.filter(n => n !== DOUBLE_BATTLE_TRAINER_NAME));
    return { name, squad: rollTrainerShinySquad(pickN(pool, squadSize), TRAINER_SHINY_CHANCE), isGym:false, portraitFile: trainerPortraitFile(name) };
  }

  // Dual-type Gym Leaders (badge.types.length === 2) can't field a squad
  // that's lopsided toward one of their two specialty types — at least half
  // the squad (rounded up) must carry EACH type, either alone or combined
  // with the other (a dual-type mon counts toward both quotas at once, so
  // e.g. a 3-mon squad only needs 1 dual-type + 1 of each pure type to
  // satisfy both "2 need Ice" and "2 need Flying"). Re-rolls the whole squad
  // first (keeps the roll fair), then as a last resort widens the search to
  // every reachable Pokémon of the short type and swaps in just enough
  // slots to hit quota, rather than looping forever if the tier's own pool
  // is thin on that type.
  const GYM_TYPE_RULE_MAX_REROLLS = 20;
  function ensureTypeBalance(squad, pool, types, squadSize, fallbackSource){
    if(types.length < 2) return squad; // mono-type gyms (e.g. Dragon) have nothing to balance
    const required = Math.ceil(squadSize / 2);
    const countWithType = (list, t) => list.filter(p => p.types.includes(t)).length;
    let attempt = squad;
    for(let i = 0; i < GYM_TYPE_RULE_MAX_REROLLS && types.some(t => countWithType(attempt, t) < required); i++){
      attempt = pickN(pool, squadSize);
    }
    types.forEach(t => {
      const deficit = required - countWithType(attempt, t);
      if(deficit <= 0) return;
      const fallbackPool = (fallbackSource || wildPool()).filter(p => p.types.includes(t));
      if(!fallbackPool.length) return; // nothing in the whole game has this type — nothing more to do
      // Swap members that don't already carry this type, so an existing
      // dual-type mon covering it (or the other type) is never bumped.
      const swappable = attempt.map((p, idx) => idx).filter(idx => !attempt[idx].types.includes(t));
      for(let k = 0; k < deficit && k < swappable.length; k++){
        attempt[swappable[k]] = pick(fallbackPool);
      }
    });
    return attempt;
  }

  // Difficulty comes from how many badges are already earned this run, not
  // from which badge was picked. Squad is type-matched to the badge when
  // possible; if too few Pokémon of that type fall in the strength band,
  // widens to every reachable Pokémon of that type (ignoring BST) before
  // ever falling back to the untyped band pool. A gym should never end up
  // fielding zero members of its own type(s) just because the tier's BST
  // slice happened to be thin on a scarce type like Fairy.
  function rollBadgeGym(badge){
    const tier = softenTierBst(GYM_DIFFICULTY_TIERS[Math.min(runBadges, GYM_DIFFICULTY_TIERS.length - 1)], classicBstFactor());
    const squadSize = Math.min(tier.squadSize, currentPartySize());
    // badge.pool (curated roster, e.g. FAIRY_GYM_POOL) replaces the generic
    // "every reachable Pokémon of this type" search — the whole pool is
    // already type-correct, so no further type filtering is applied on top.
    const eligible = badge.pool ? badge.pool.map(n => POKEMON_BY_NAME[n]).filter(Boolean) : wildPool();
    const band = eligible.filter(p => p.bst >= tier.minBst && p.bst <= tier.maxBst);
    const typed = badge.pool ? band : band.filter(p => p.types.some(t => badge.types.includes(t)));
    // A curated pool (e.g. VOLT_GYM_POOL) spans everything from baby
    // Pokémon to pseudo-legendaries, so when the tier's exact BST window is
    // too thin, widening straight to the WHOLE pool used to let a Pichu or
    // Krabby-tier mon land in the same squad as something 300+ BST above it
    // — closest-BST-first keeps the widened picks in the same strength
    // ballpark as the tier instead of just "any species with this typing".
    const closestByStrength = badge.pool
      ? [...eligible].sort((a,b) => Math.abs(a.bst - tier.maxBst) - Math.abs(b.bst - tier.maxBst))
      : null;
    const typedAnywhere = typed.length >= squadSize ? typed
      : badge.pool ? closestByStrength.slice(0, Math.max(squadSize * 3, 8))
      : wildPool().filter(p => p.types.some(t => badge.types.includes(t)));
    const pool = typedAnywhere.length >= squadSize ? typedAnywhere : band;
    // Dual-type Gyms fill as many slots as possible with Pokémon that carry
    // BOTH specialty types first (they satisfy both balance quotas below at
    // once), then pick the rest from the general pool — rather than picking
    // the whole squad blind and hoping ensureTypeBalance doesn't have to
    // patch it up after the fact.
    let squad;
    if(badge.types.length === 2){
      const dualPool = pool.filter(p => badge.types.every(t => p.types.includes(t)));
      const dualPicks = pickN(dualPool, Math.min(squadSize, dualPool.length));
      const restPool = pool.filter(p => !dualPicks.includes(p));
      const restPicks = pickN(restPool, squadSize - dualPicks.length);
      squad = pickN([...dualPicks, ...restPicks], dualPicks.length + restPicks.length); // reshuffle order
    } else {
      squad = pickN(pool, squadSize);
    }
    squad = ensureTypeBalance(squad, pool, badge.types, squadSize, badge.pool ? closestByStrength : undefined);
    return { name: badge.leaderName, squad: rollTrainerShinySquad(squad, TRAINER_SHINY_CHANCE), isGym:true, badgeKey: badge.key, badgeIcon: badge.icon, badgeTypes: badge.types, portraitFile: trainerPortraitFile(badge.leaderName) };
  }

  function rollEliteMember(tier, isFinal){
    const bonusLegendaries = isFinal
      ? ILYRA_BONUS_LEGENDARIES.map(n => POKEMON_BY_NAME[n]).filter(p => p && p.bst >= tier.minBst && p.bst <= tier.maxBst)
      : [];
    const band = [
      ...wildPool().filter(p => p.bst >= tier.minBst && p.bst <= tier.maxBst && !PARADOX_POKEMON.includes(p.name)),
      ...bonusLegendaries,
    ];
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
    return { name: tier.name, squad: rollTrainerShinySquad(squad, TRAINER_SHINY_CHANCE), isElite:true, isFinalElite: !!isFinal, portraitFile: eliteFourPortraitFile(tier.name) };
  }

  // Cruise Ship battles are all Water-type, falling back to the untyped
  // strength band if too few Water-types qualify (same pattern as gym
  // badges). Rolls the same shiny chance every other trainer squad does
  // (route trainers, Gyms, Elite Four, Rival) — these were the one
  // exception before, with no shiny chance at all.
  function rollCruiseBattle(tier){
    const pool = wildPool().filter(p => p.bst >= tier.minBst && p.bst <= tier.maxBst);
    const waterPool = pool.filter(p => p.types.includes('water'));
    // The Double Battle's 2-Pokémon squad is fixed, not scaled down to match
    // the player's roster (mirrors how Elite Four/Rival squads never shrink).
    const squadSize = tier.isDouble ? tier.squadSize : Math.min(tier.squadSize, currentPartySize());
    const finalPool = waterPool.length >= squadSize ? waterPool : pool;
    const squad = pickN(finalPool, squadSize);

    // Captain Sereia always fields one guaranteed Mega from her own pool
    // (see CAPTAIN_SEREIA_MEGA_POOL), replacing one squad slot — the rest
    // of her team stays whatever the roll above produced.
    if(tier.isCaptain){
      const megaForm = POKEMON_BY_NAME[pick(CAPTAIN_SEREIA_MEGA_POOL)];
      if(megaForm) squad[randInt(0, squad.length - 1)] = megaForm;
    }

    return { name: tier.name, squad: rollTrainerShinySquad(squad, TRAINER_SHINY_CHANCE), isCruise:true, isCaptain: !!tier.isCaptain, isDouble: !!tier.isDouble, portraitFile: tier.portrait };
  }

  function rollCruiseRival(){
    // Excludes his own signature species from the random roll below — it's
    // guaranteed its own slot (Mega Evolved) a few lines down, so it should
    // never also show up a 2nd time as a plain, non-Mega squad member.
    const pool = wildPool().filter(p => p.bst >= CRUISE_RIVAL.minBst && p.bst <= CRUISE_RIVAL.maxBst && p.name !== CRUISE_RIVAL_SIGNATURE_SPECIES);
    // Always the full 6, regardless of the player's own roster size — same
    // rule as the Elite Four (see rollEliteMember()): the Rival never scales
    // down to match the player.
    const squadSize = CRUISE_RIVAL.squadSize;
    const squad = pickN(pool, squadSize);

    // Fukugawa's signature Absol (see RIVAL_CAMEO_ENCOUNTER_NUM's earlier
    // route cameo, where it showed up as a regular Absol) always appears
    // here Mega Evolved, replacing one squad slot — same continuity beat
    // as Elite Four's guaranteed Mega slot, just tied to a specific species
    // instead of any random Mega-capable one.
    const megaForm = POKEMON_BY_NAME[CRUISE_RIVAL_SIGNATURE_MEGA];
    if(megaForm) squad[randInt(0, squad.length - 1)] = megaForm;

    return { name: CRUISE_RIVAL.name, squad: rollTrainerShinySquad(squad, TRAINER_SHINY_CHANCE), isRival:true, portraitFile: trainerPortraitFile(CRUISE_RIVAL.name) };
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

  // Wobbuffet/Wynaut/Pyukumuku's entire real damaging movepool, in the
  // mainline games — they have no fixed-power attacking move at all, only
  // Counter (reflects 2x the physical damage just taken) and Mirror Coat
  // (same, but special). data/battle_moves.json only ever kept fixed-power
  // moves, so these two never made it in and need hand-injecting the same
  // way SLEEP_MOVE_DEFS does. `power:0` here is real (not a placeholder,
  // unlike sleep moves) — see computeDamage()'s counterClass branch, which
  // computes the actual damage from tookDamageThisExchange instead of a
  // power stat. `priority:-5` matches the mainline games: these always
  // resolve last in the exchange regardless of Speed, so there's something
  // to reflect by the time they go off, see battleStep()'s priority-then-
  // Speed ordering. Only wired up for the single-battle path (battleStep/
  // resolveAttack): the one-off Double Battle event never sets
  // tookDamageThisExchange, so Counter/Mirror Coat there always just fails
  // instead of crashing, not worth the extra bookkeeping for one encounter.
  const COUNTER_MOVE_DEFS = {
    'counter':     { name:'counter',     type:'fighting', power:0, accuracy:100, damage_class:'physical', priority:-5, counterClass:'physical' },
    'mirror coat': { name:'mirror coat', type:'psychic',  power:0, accuracy:100, damage_class:'special',  priority:-5, counterClass:'special' },
  };
  const COUNTER_MOVE_SPECIES = ['wobbuffet', 'wynaut', 'pyukumuku'];

  const POISON_DAMAGE_FRACTION = 1/8;
  const BURN_DAMAGE_FRACTION = 1/16;
  const SLEEP_MIN_TURNS = 1;
  const SLEEP_MAX_TURNS = 3;
  // Log verb for "X was ___!" when a status is first applied — see maybeApplyMoveStatus().
  const STATUS_APPLY_VERB = { poison:'poisoned', burn:'burned', sleep:'put to sleep' };

  function makeBattler(mon){
    const maxHp = Math.round((mon.hp || 45) * 2.2) + 30;
    return { mon, maxHp, hp: maxHp, moves: movesFor(mon), status: null, godmode: !!mon.godmode };
  }

  // Rolls a move's status-effect chance against a battler that just got hit
  // by it. No-ops if the move has no associated effect, the target already
  // has a status, or the target just fainted from this same hit — matches
  // the mainline games (status can't be applied to something already fainted
  // or already afflicted).
  function maybeApplyMoveStatus(move, target, attacker){
    if(target.hp <= 0 || target.status || target.godmode) return;
    const effect = MOVE_STATUS_EFFECTS[move.name];
    if(!effect || Math.random() >= effect.chance) return;
    // Fire-types are immune to Burn in the mainline games, no matter which
    // move inflicts it or which side (player or enemy) is attacking — this
    // is the single choke point every burn-inflicting move goes through.
    if(effect.type === 'burn' && target.mon.types.includes('fire')){
      appendBattleLog(`It doesn't affect ${displayName(target.mon.name)}!`, '', 'status');
      return;
    }
    // Poison- and Steel-types are immune to Poison in the mainline games,
    // regardless of which move inflicts it — same choke point as the Burn
    // immunity above. (The eff>0 gate at each call site already screens out
    // most Poison-move-vs-Steel-target cases since that's a 0x matchup, but
    // not Poison-vs-Poison, which is only 0.5x, or a non-Poison-type move
    // that happens to carry a poison chance against a Steel-type target.)
    if(effect.type === 'poison' && (target.mon.types.includes('poison') || target.mon.types.includes('steel'))){
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
    if(!b || b.hp <= 0 || !b.status || b.godmode) return;
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

  // Chance per turn of reaching for a sleep move instead of attacking,
  // when one is available and would actually do something (target has no
  // status yet). Kept well under 1 so it doesn't crowd out attacking moves
  // and become the predictable "always sleep first" opener.
  const SLEEP_MOVE_TRY_CHANCE = 0.3;

  // Weighted random pick among damaging moves, weighted by expected damage
  // (power * STAB * effectiveness) so the hardest-hitting option comes up
  // most often without being deterministic. A fixed argmax would make the
  // AI repeat the exact same move every time against a given foe.
  // Effectiveness is cubed rather than applied linearly, so it dominates the
  // weight over raw power/accuracy: a super effective (2x) move outweighs a
  // same-power neutral one 8 to 1, and a resisted (0.5x) one barely
  // registers, matching how a real player would prioritize "what beats this
  // type" over "what number is bigger" while still leaving room for RNG.
  const EFFECTIVENESS_WEIGHT_EXPONENT = 3;

  // Shared by weightedPickByExpectedDamage() (AI move choice) and
  // computeDamage() (actual damage resolution) — both need the exact same
  // STAB/type-effectiveness numbers for a given attacker/defender/move, so
  // this is the one place that computes them instead of each duplicating
  // the same two lines.
  function stabAndEffectiveness(attacker, defender, move){
    const stab = attacker.mon.types.includes(move.type) ? 1.5 : 1;
    const eff = typeEffectiveness(move.type, defender.mon.types);
    return { stab, eff };
  }

  function weightedPickByExpectedDamage(attacker, defender, moves){
    const weights = moves.map(m => {
      const { stab, eff } = stabAndEffectiveness(attacker, defender, m);
      const accuracy = (m.accuracy ?? 100) / 100;
      return Math.max(0.01, (m.power || 0) * stab * accuracy * Math.pow(eff, EFFECTIVENESS_WEIGHT_EXPONENT));
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for(let i = 0; i < moves.length; i++){
      roll -= weights[i];
      if(roll <= 0) return moves[i];
    }
    return moves[moves.length - 1];
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
    const candidates = filtered.length ? filtered : pool;

    // Sparingly reach for a sleep move first, only while the target has no
    // status yet (a sleep move on an already-statused target is wasted).
    if(!defender.status){
      const sleepMoves = candidates.filter(m => MOVE_STATUS_EFFECTS[m.name]?.type === 'sleep');
      if(sleepMoves.length && Math.random() < SLEEP_MOVE_TRY_CHANCE) return pick(sleepMoves);
    }

    const damaging = candidates.filter(m => m.power > 0);
    if(!damaging.length) return pick(candidates);
    return weightedPickByExpectedDamage(attacker, defender, damaging);
  }

  const BURN_PHYSICAL_DAMAGE_MULTIPLIER = 0.5;

  function computeDamage(attacker, defender, move){
    // Dev-only God Mode battlers (see devGodModeRun()) — never a real, public
    // game state, gated behind the password-protected dev panel.
    if(defender.godmode) return { dmg: 0, eff: 1 };
    if(attacker.godmode) return { dmg: defender.hp, eff: 1 };

    // Counter/Mirror Coat (see COUNTER_MOVE_DEFS) have no fixed power at
    // all, they reflect 2x whatever physical/special damage the user itself
    // took this exchange (tracked as tookDamageThisExchange, set in
    // resolveAttack and cleared per exchange in battleStep). No qualifying
    // hit yet, or blocked by type immunity (e.g. Ghost vs Counter, Dark vs
    // Mirror Coat), and it just fails instead of dealing anything.
    if(move.counterClass){
      const eff = typeEffectiveness(move.type, defender.mon.types);
      const taken = attacker.tookDamageThisExchange;
      const canCounter = eff > 0 && taken && taken.class === move.counterClass;
      return { dmg: canCounter ? Math.max(1, taken.amount * 2) : 0, eff, crit:false, failed: !canCounter };
    }

    const atkStat = move.damage_class === 'special' ? (attacker.mon.sp_atk || 40) : (attacker.mon.attack || 40);
    const defStat = move.damage_class === 'special' ? (defender.mon.sp_def || 40) : (defender.mon.defense || 40);
    const { stab, eff } = stabAndEffectiveness(attacker, defender, move);
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
    //
    // Shedinja's Wonder Guard: only a super-effective move can deal direct
    // damage to it at all — anything neutral, resisted, or immune (eff <= 1)
    // just does nothing, no matter how strong. Its 1 HP means a
    // super-effective hit always KOs it anyway. This only blocks direct move
    // damage through computeDamage(); status conditions, weather chip
    // damage, and other indirect damage never go through here, so they still
    // hurt Shedinja normally, matching the real ability.
    const wonderGuardBlocks = defender.mon.name === 'shedinja' && eff <= 1;
    const canDeal = !(eff === 0 || !move.power || wonderGuardBlocks);
    // Farfetch'd/Sirfetch'd: the only source of crits in this game — there's
    // no baseline crit mechanic otherwise, so this only ever fires for the
    // player's own attacks, and only with one of these on the team.
    const isCrit = canDeal && isPlayerAttacker(attacker)
      && hasActiveSpecies(n => FARFETCHD_NAMES.includes(n)) && Math.random() < FARFETCHD_CRIT_CHANCE;
    const critMult = isCrit ? FARFETCHD_CRIT_MULTIPLIER : 1;
    const dmg = canDeal ? Math.max(1, Math.floor(base * stab * eff * variance * burnPenalty * critMult)) : 0;
    return { dmg, eff, crit: isCrit };
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
  //
  // Pity mechanic: a species eligible to evolve but passed over
  // EVOLVE_PITY_THRESHOLD times in a row (while on the active team) is
  // guaranteed to be picked next, instead of leaving some species to never
  // come up by bad luck alone across a whole run.
  const EVOLVE_PITY_THRESHOLD = 5;
  function evolveRandomEligible(){
    const eligibleIdx = [];
    activeTeam.forEach((mon, idx) => {
      if(evolutionOptionsFor(mon.name).length) eligibleIdx.push(idx);
    });
    if(!eligibleIdx.length) return null;

    const pityIdx = eligibleIdx.find(idx => (evolvePityMisses[activeTeam[idx].name] || 0) >= EVOLVE_PITY_THRESHOLD);
    const idx = pityIdx !== undefined ? pityIdx : pick(eligibleIdx);
    eligibleIdx.forEach(i => {
      if(i === idx) return;
      const name = activeTeam[i].name;
      evolvePityMisses[name] = (evolvePityMisses[name] || 0) + 1;
    });

    const currentMon = activeTeam[idx];
    delete evolvePityMisses[currentMon.name];
    const evolvedBase = rollRegionalEvolution(POKEMON_BY_NAME[pick(evolutionOptionsFor(currentMon.name))]);
    const evolved = (currentMon.is_shiny && canBeShiny(evolvedBase)) ? { ...evolvedBase, is_shiny:true } : evolvedBase;
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
    const evolved = (currentMon.is_shiny && canBeShiny(evolvedBase)) ? { ...evolvedBase, is_shiny:true } : evolvedBase;
    activeTeam[idx] = evolved;
    if(currentMon === starter) starter = evolved;
    return { from: currentMon, to: evolved, isMega:true };
  }

  function startTrainerBattle(){
    // The Rival's first appearance gets a dialogue beat first, "meeting" him
    // properly before the fight — see openRivalCameoIntro()/rollTrainer()'s
    // RIVAL_CAMEO_ENCOUNTER_NUM special case.
    if(encounterNum === RIVAL_CAMEO_ENCOUNTER_NUM){
      openRivalCameoIntro();
      return;
    }
    beginBattle(rollTrainer());
  }

  // ---------- GYM BADGE SELECT ----------
  // The 18 Gym Leaders split into a weaker and a stronger half, ranked by
  // each one's curated pool's average BST (see the "strongest gyms" pass
  // this was based on) — every gym in WEAK_GYM_KEYS comfortably fills its
  // squad within the first 4 badge tiers' BST bands, and every gym in
  // STRONG_GYM_KEYS comfortably fills the last 4's, with wide margin above
  // each tier's squad size (checked directly against the curated pools, not
  // just assumed). rollGymChoicePool() below only ever offers the weak half
  // for badges 1-4 and the strong half for badges 5-8, so the toughest Gym
  // choices are always saved for the toughest stretch of the run instead of
  // being left to chance.
  const WEAK_GYM_KEYS = [
    "water-ice", "electric", "ghost-grass", "water", "grass-poison",
    "bug-fighting", "plain", "fairy", "bug-poison",
  ];
  const STRONG_GYM_KEYS = [
    "dragon", "steel-dark", "fire", "normal", "ghost-psychic", "ice-flying",
    "rock-water", "poison-dark", "flying",
  ];

  // Picks the 4 Gym Leaders offered for the current stage — a fresh roll
  // only happens when gymChoicePool is null (see its own declaration), so
  // this only actually re-rolls right after a badge is beaten, not on every
  // Gym Select visit.
  function rollGymChoicePool(){
    const halfKeys = runBadges < 4 ? WEAK_GYM_KEYS : STRONG_GYM_KEYS;
    const remaining = BADGES.filter(b => halfKeys.includes(b.key) && !runBeatenBadges.has(b.key));
    gymChoicePool = pickN(remaining, Math.min(4, remaining.length)).map(b => b.key);
  }

  function openGymSelect(){
    closePokeStopScreen();
    document.getElementById('encounterScreen').classList.remove('active');
    document.getElementById('catchScreen').classList.remove('active');
    document.getElementById('gymSelectScreen').classList.add('active');
    if(!gymChoicePool) rollGymChoicePool();
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
    el.innerHTML = activeTeam.map((mon, idx) => `
      <button class="roster-slot" data-idx="${idx}">
        <div class="lab-sprite-wrap">
          <img class="lab-base" src="${LAB_BASE_IMG}" alt="" draggable="false">
          ${avatarHTML(mon,'avatar-sm')}
        </div>
        <span class="tn">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">SHINY</span>' : ''}</span>
      </button>`).join('');
    el.querySelectorAll('.roster-slot').forEach(btn => {
      btn.addEventListener('click', () => openPokedex(activeTeam[Number(btn.dataset.idx)]));
    });
    groundSpritesOnBase(`#${elId}`);
  }

  function renderGymSelect(){
    renderRosterStrip('gymSelectRoster');
    const grid = document.getElementById('badgeGrid');
    // Only ever the 4 in gymChoicePool (see rollGymChoicePool()), never the
    // full 18 — none of these 4 should ever already be beaten (a badge is
    // excluded from the very next roll the instant it's won), but the
    // filter is a harmless safety net against a stale/corrupted save.
    const offered = gymChoicePool.map(key => BADGES.find(b => b.key === key)).filter(b => b && !runBeatenBadges.has(b.key));
    grid.innerHTML = offered.map(b => {
      const bgPath = gymLeaderBgPath(b.leaderName);
      return `<button class="gym-leader-row" data-key="${b.key}">
        <div class="gym-leader-row-bg"><img src="${bgPath}" alt="" onerror="this.parentElement.style.display='none'"></div>
        <div class="gym-leader-portrait"><img src="${TRAINER_PORTRAIT_DIR}/${encodeURIComponent(trainerPortraitFile(b.leaderName))}" alt="" onerror="this.style.display='none'"></div>
        <span class="gym-leader-name">${b.leaderName}</span>
        <div class="gym-leader-badge">
          <div class="c-types">${typeChipsHTML(b.types)}</div>
          <img class="badge-icon" src="${BADGE_ICON_DIR}/${b.icon}" alt="" onerror="this.style.display='none'">
        </div>
      </button>`;
    }).join('');
    grid.querySelectorAll('.gym-leader-row').forEach(btn => {
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
  let legendaryPendingMon = null;
  let legendarySelectedIdx = [];
  let introEncounterKind = 'legendary'; // 'legendary' | 'mythical' — which flow the shared screen below is currently running
  // Cave backdrop for both the Legendary/Mythical intro screen (the wild
  // Pokémon's own portrait and the team picker grid) and the battle itself
  // (see battleBaseImg()).
  const LEGENDARY_BASE_IMG = "assets/pokemon-game-assets/Graphics/Battlebacks/cave2_base1.png";
  // Choose Your Lead screen only, for this same Legendary/Mythical encounter
  // (see openLeadSelect()) — a different cave plate than the intro/battle's
  // own LEGENDARY_BASE_IMG above.
  const LEGENDARY_LEAD_BASE_IMG = "assets/pokemon-game-assets/Graphics/Battlebacks/cave1_base1.png";

  function startLegendaryBattle(){
    // Mythicals get their own dedicated encounter (see startMythicalBattle())
    // and are excluded here so the two never overlap.
    const legendaryPool = POKEMON.filter(p => p.legendary && p.id <= NATIONAL_DEX_MAX && !MYTHICAL_POKEMON.includes(p.name) && !NO_MOVESET_UNREACHABLE.includes(p.name));
    let legendaryMon = pick(legendaryPool);
    if(canBeShiny(legendaryMon) && Math.random() < SHINY_CHANCE) legendaryMon = { ...legendaryMon, is_shiny:true };
    openSpecialIntro(legendaryMon, 'legendary');
  }

  function startMythicalBattle(){
    const mythicalPool = POKEMON.filter(p => p.id <= NATIONAL_DEX_MAX && MYTHICAL_POKEMON.includes(p.name));
    let mythicalMon = pick(mythicalPool);
    if(canBeShiny(mythicalMon) && Math.random() < SHINY_CHANCE) mythicalMon = { ...mythicalMon, is_shiny:true };
    openSpecialIntro(mythicalMon, 'mythical');
  }

  // Legendary now happens mid-Cruise (the island stop) and Mythical right
  // after the 8th badge (swapped positions) — the island-specific framing
  // moved to 'legendary' accordingly, species-correct wording unchanged.
  function specialLoreText(mon, kind){
    const typeLabel = mon.types.map(t => t[0].toUpperCase() + t.slice(1)).join('/');
    return kind === 'legendary'
      ? `Stranded on this remote island, a Legendary ${typeLabel}-type Pokémon of immense, rarely-witnessed power has been waiting. The ship only stopped for a few hours, so this is your only shot at it. Choose your team wisely.`
      : `A Mythical ${typeLabel}-type Pokémon, spoken of even among Legendaries, stirs nearby. Encounters like this happen once in a lifetime, so choose your team wisely.`;
  }

  // Hover-only decision aid for the team picker below (see renderLegendaryIntro()):
  // best offensive multiplier this teamMon can land on the wild Legendary/
  // Mythical, and the worst defensive multiplier it'll take back, reusing
  // typeEffectiveness() (the same battle-damage function) from both directions.
  function legendaryMatchupHTML(teamMon, wildMon){
    const atkMult = Math.max(...teamMon.types.map(t => typeEffectiveness(t, wildMon.types)));
    const defMult = Math.max(...wildMon.types.map(t => typeEffectiveness(t, teamMon.types)));
    const fmt = n => n === 0 ? '0' : n.toFixed(2).replace(/\.?0+$/, '');
    return `
      <div class="pick-tooltip-row ${atkMult > 1 ? 'good' : atkMult < 1 ? 'bad' : ''}">Deals ${fmt(atkMult)}x to ${displayName(wildMon.name)}</div>
      <div class="pick-tooltip-row ${defMult > 1 ? 'bad' : defMult < 1 ? 'good' : ''}">Takes ${fmt(defMult)}x from ${displayName(wildMon.name)}</div>
    `;
  }

  // Battle-scene equivalent of the Legendary/Mythical picker's hover tooltip
  // above — same types + matchup-multiplier readout, just hovering over a
  // battler's own HP card (see .hp-card-based:hover .pick-tooltip in CSS)
  // instead of a squad-pick card. `foes` is every currently-alive Pokémon on
  // the opposing side (just the 1 active one in a single battle, up to 2 in
  // a Double Battle) — each gets its own matchup block, labeled by name only
  // when there's more than one to disambiguate.
  function battleMatchupTooltipHTML(selfMon, foes){
    if(!foes || !foes.length) return '';
    const blocks = foes.map(foeMon => `
      ${foes.length > 1 ? `<div class="pick-tooltip-foe-label">vs ${displayName(foeMon.name)}</div>` : ''}
      ${legendaryMatchupHTML(selfMon, foeMon)}
    `).join('');
    return `<div class="c-types">${typeChipsHTML(selfMon.types)}</div>${blocks}`;
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
    document.getElementById('legendaryIntroEyebrow').textContent = kind === 'legendary' ? 'The Island Stirs...' : 'A Mythical Stirs...';
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
    document.getElementById('legendaryIntroArt').innerHTML = `<div class="lab-sprite-wrap"><img class="lab-base" src="${LEGENDARY_BASE_IMG}" alt="" draggable="false">${avatarHTML(mon)}</div>`;
    document.getElementById('legendaryIntroDesc').textContent = specialLoreText(mon, introEncounterKind);

    const grid = document.getElementById('legendaryPickerGrid');
    grid.innerHTML = activeTeam.map((m, i) => {
      const selected = legendarySelectedIdx.includes(i);
      const disabled = !selected && legendarySelectedIdx.length >= required;
      const species = POKEMON_BY_NAME[m.name] || m;
      return `<button class="legendary-pick-card ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}" data-idx="${i}" ${disabled ? 'disabled' : ''}>
        <div class="lab-sprite-wrap"><img class="lab-base" src="${LEGENDARY_BASE_IMG}" alt="" draggable="false">${avatarHTML(m,'avatar-sm')}</div>
        <span class="c-name">${displayName(m.name)}${m.is_shiny ? ' <span class="shiny-tag">SHINY</span>' : ''}</span>
        <div class="pick-tooltip">
          <div class="c-types">${typeChipsHTML(m.types)}</div>
          <div class="pokedex-stats">${pokedexStatRowsHTML(species)}</div>
          ${legendaryMatchupHTML(m, mon)}
        </div>
      </button>`;
    }).join('');
    groundSpritesOnBase('#legendaryIntroScreen');
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
    beginBattle(rollEliteMember(softenTierBst(ELITE_FOUR[eliteIndex], classicEliteBstFactor()), eliteIndex === ELITE_FOUR.length - 1));
  }

  // ---------- CRUISE SHIP ----------
  // One-time cinematic screen right after the Legendary encounter — the
  // Cruise Ship is a mandatory endgame event now, so this just dramatizes
  // "you're going, right now" instead of a ticket purchase decision.
  function openCruiseTicketWonScreen(){
    document.getElementById('cruiseTicketWonScreen').classList.add('active');
  }

  // Deckhand Milo's one-time "just boarded" flavor beat, shown before the
  // very first Cruise Ship battle — his portrait (assets/trainers/Milo.png)
  // is only ever used on this screen, not in-battle.
  const CRUISE_BOARDING_LINES = [
    "All aboard! First stop, open water, mind your footing.",
    "Ha, another passenger? Hope you brought your battle gear, this crossing isn't for tourists.",
    "Deckhand Milo, at your service. Let's see what you've got before we even leave the harbor.",
  ];

  function boardCruiseShip(){
    document.getElementById('cruiseTicketWonScreen').classList.remove('active');
    cruiseStageIndex = 0;
    openCruiseBoardingDialogue();
  }

  function openCruiseBoardingDialogue(){
    document.getElementById('cruiseBoardingDialogueBox').textContent = pick(CRUISE_BOARDING_LINES);
    document.getElementById('cruiseBoardingScreen').classList.add('active');
  }

  function confirmCruiseBoarding(){
    document.getElementById('cruiseBoardingScreen').classList.remove('active');
    startCruiseBattle();
  }

  function startCruiseBattle(){
    beginBattle(rollCruiseBattle(CRUISE_SHIP_BATTLES[cruiseStageIndex]));
  }

  function startCruiseRivalBattle(){
    beginBattle(rollCruiseRival());
  }

  // "🚢 Cruise Ship" only makes sense for the real Cruise Ship rival fight —
  // the earlier Route 7 cameo (openRivalCameoIntro()/
  // openRivalCameoPostBattleDialogue()) happens before the Cruise even
  // starts, so it hides this label entirely there instead of showing a
  // location that hasn't happened yet.
  function setRivalChallengeEyebrow(text){
    const el = document.getElementById('rivalChallengeEyebrow');
    el.textContent = text;
    el.style.display = text ? '' : 'none';
  }

  // JRPG-style dialogue box shown right before the Rival battle — click
  // through each line, the last click leads straight into the battle.
  let rivalDialogueIndex;

  function openRivalChallenge(){
    rivalDialogueIndex = 0;
    setRivalChallengeEyebrow('Cruise Ship');
    document.getElementById('rivalChallengeHeading').textContent = 'YOUR RIVAL APPEARS!';
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

  // Reuses the same portrait/dialogue-box screen as the pre-battle taunt
  // above, just for the single win reaction after beating the Rival — see
  // afterBattle()'s wasRival branch (the only caller). A loss here never
  // reaches this: afterBattle()'s `if(!won)` check ends the run first.
  function openRivalPostBattleDialogue(){
    // endBattle() (the only caller) never hides the battle screen itself —
    // it only does that for modal-overlay popups (openGymWinModal() etc.),
    // which are meant to float on top of it. rivalChallengeScreen is a full
    // page, not an overlay, so it has to be hidden explicitly here or both
    // screens render stacked on top of each other.
    document.getElementById('battleScreen').classList.remove('active');
    setRivalChallengeEyebrow('Cruise Ship');
    document.getElementById('rivalChallengeHeading').textContent = 'YOU DEFEATED FUKUGAWA!';
    document.getElementById('rivalDialogueBox').textContent = pick(RIVAL_POST_BATTLE_DIALOGUE);
    const btn = document.getElementById('rivalDialogueNextBtn');
    btn.textContent = 'CONTINUE';
    btn.onclick = () => {
      document.getElementById('rivalChallengeScreen').classList.remove('active');
      openPokeStop('cruiseComplete');
    };
    document.getElementById('rivalChallengeScreen').classList.add('active');
  }

  // The Rival's first appearance (see RIVAL_CAMEO_ENCOUNTER_NUM /
  // startTrainerBattle()) — reuses the same portrait/dialogue-box screen as
  // the Cruise Rival's taunt, just with its own dialogue and, at the end,
  // starts the actual cameo battle (rollTrainer()'s special case) instead
  // of the Cruise Rival fight. Not checkpointed, same as any other wild-
  // encounter-adjacent screen — a refresh here just falls back to the last
  // real checkpoint and replays up to this encounter again.
  let rivalCameoDialogueIndex;

  function openRivalCameoIntro(){
    rivalCameoDialogueIndex = 0;
    // Without this, the still-active encounter/catch screen from right
    // before this fight rendered underneath rivalChallengeScreen instead of
    // being replaced by it — every other screen transition that follows a
    // catch (openLeadSelect(), openGymSelect(), etc.) already hides both.
    document.getElementById('encounterScreen').classList.remove('active');
    document.getElementById('catchScreen').classList.remove('active');
    setRivalChallengeEyebrow('');
    document.getElementById('rivalChallengeHeading').textContent = 'A RIVAL APPEARS!';
    document.getElementById('rivalChallengeScreen').classList.add('active');
    renderRivalCameoIntro();
  }

  function renderRivalCameoIntro(){
    document.getElementById('rivalDialogueBox').textContent = RIVAL_FIRST_MEETING_DIALOGUE[rivalCameoDialogueIndex];
    const btn = document.getElementById('rivalDialogueNextBtn');
    btn.textContent = rivalCameoDialogueIndex < RIVAL_FIRST_MEETING_DIALOGUE.length - 1 ? '▼' : 'BATTLE!';
    btn.onclick = advanceRivalCameoIntro;
  }

  function advanceRivalCameoIntro(){
    rivalCameoDialogueIndex++;
    if(rivalCameoDialogueIndex >= RIVAL_FIRST_MEETING_DIALOGUE.length){
      document.getElementById('rivalChallengeScreen').classList.remove('active');
      beginBattle(rollTrainer());
      return;
    }
    renderRivalCameoIntro();
  }

  // Win reaction after the cameo fight — see endBattle()'s isRivalCameo
  // branch (the only caller). Its own Continue button is what actually
  // calls afterBattle() to move on, same pattern as openGymWinModal()/
  // openSpecialCaughtModal(). A loss never reaches this: afterBattle()'s
  // `if(!won)` check ends the run before any of this runs.
  function openRivalCameoPostBattleDialogue(){
    // See openRivalPostBattleDialogue()'s comment above — endBattle() (the
    // only caller) doesn't hide the battle screen itself.
    document.getElementById('battleScreen').classList.remove('active');
    setRivalChallengeEyebrow('');
    document.getElementById('rivalChallengeHeading').textContent = 'A RIVAL RECOGNIZES YOU';
    document.getElementById('rivalDialogueBox').textContent = pick(RIVAL_FIRST_MEETING_POST_DIALOGUE);
    const btn = document.getElementById('rivalDialogueNextBtn');
    btn.textContent = 'CONTINUE';
    btn.onclick = () => {
      document.getElementById('rivalChallengeScreen').classList.remove('active');
      afterBattle(true);
    };
    document.getElementById('rivalChallengeScreen').classList.add('active');
  }

  // `playerOverride`, when given, replaces the usual "whole active team"
  // squad for this one battle only (used by the Legendary encounter's 3-mon
  // pick) — activeTeam itself is never touched, so every other battle
  // before and after keeps using the player's full roster as normal.
  function battleSubText(opponent){
    if(opponent.isGym) return `Badge ${runBadges + 1}/${BADGES_TO_UNLOCK_ENDGAME} this run · ${opponent.squad.length} Pokémon.`;
    if(opponent.isLegendary) return `A wild Legendary appeared! One shot only, it won't come back this run.`;
    if(opponent.isMythical) return `A wild Mythical appeared on the island! One shot only, it won't come back this run.`;
    if(opponent.isElite) return `Elite Four · Member ${eliteIndex + 1}/${ELITE_FOUR.length} · full ${opponent.squad.length}-vs-6 battle.`;
    if(opponent.isRival) return `Your rival challenges you aboard the Cruise Ship! ${opponent.squad.length} Pokémon.`;
    if(opponent.isRivalCameo) return `Your rival wants a taste of what you can do. ${opponent.squad.length} Pokémon.`;
    // The "DOUBLE BATTLE!" title already says it (see openDoubleSquadSelect()),
    // so the subtext itself skips repeating it.
    if(opponent.isDouble) return `2 Pokémon a side, fighting at once.`;
    if(opponent.isCruise) return `Cruise Ship battle! ${opponent.squad.length} Pokémon.`;
    if(opponent.isHillTop1){
      return opponent.isFakeTop1
        ? 'A challenger for the throne.'
        : `Current #1 in the ${RANKING_MODE_LABELS[gameMode] || 'Classic'} ranking.`;
    }
    if(opponent.isInfiniteLoop) return `Defend your title! Hill Challenger #${infiniteLoopTrainerNum} · ${opponent.squad.length} Pokémon.`;
    return `Encounter ${encounterNum} · a route trainer wants to battle! ${opponent.squad.length} Pokémon.`;
  }

  // Absol: said to sense disasters before they happen — reveals the
  // opponent's actual lead (squad[0], the one they'll really send out
  // first) before a Gym or Elite Four fight, instead of the normal
  // "hasn't shown their hand yet" line.
  function absolCanSenseLead(opponent){
    // Still Absol once Mega Evolved (absol-mega / absol-mega-z), not just the
    // base form — same "-mega" name-matching gap maybeAudinoHeal() already
    // guards against for Audino (game.js:771).
    return (opponent.isGym || opponent.isElite) && opponent.squad && opponent.squad[0]
      && hasActiveSpecies(n => n === 'absol' || n.startsWith('absol-mega'));
  }

  function leadSelectHandText(opponent){
    return absolCanSenseLead(opponent)
      ? `Absol senses trouble, they're leading with ${displayName(opponent.squad[0].name)}!`
      : `Pick who goes out first, your opponent hasn't shown their hand yet.`;
  }

  // Pops up a modal showing the actual Pokémon the opponent will lead with,
  // so the "Absol senses trouble" line isn't just tiny text under the eyebrow.
  function openAbsolSenseModal(opponent){
    const lead = opponent.squad[0];
    document.getElementById('absolSenseAvatar').innerHTML = avatarHTML(lead);
    document.getElementById('absolSenseText').innerHTML =
      `Absol senses trouble, ${displayName(opponent.name)} is leading with <strong class="absol-sense-name">${displayName(lead.name)}</strong>!`;
    document.getElementById('absolSenseModal').classList.add('active');
  }

  function closeAbsolSenseModal(){
    document.getElementById('absolSenseModal').classList.remove('active');
  }

  // Stadium-style lead pick: before the opponent's first Pokémon is shown,
  // the player commits to who leads off. Doesn't affect who fights next once
  // the lead faints — that's still chosen live via renderTeamSwitchStrip().
  function beginBattle(opponent, playerOverride){
    // The opponent's squad (rollBadgeGym/rollTrainer/rollCruiseRival/etc.)
    // has already been rolled by the caller, so invalidate the checkpoint now
    // so a refresh mid-battle can't rewind to before that roll and try again.
    invalidateCheckpoint();
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
    // Only Hiker Anthony and First Mate Thaise ever set isDouble, so this
    // title swap and highlight never fire for a normal lead-select screen.
    document.getElementById('leadSelectTitle').textContent = 'DOUBLE BATTLE!';
    document.getElementById('leadSelectSub').classList.add('double-battle-alert');
    doubleSquadPicked = [];
    renderDoubleSquadSelect(opponent, order);
  }

  // Picking a 2nd Pokémon no longer jumps straight into the battle — it just
  // arms the Confirm button below the grid, so the player gets a chance to
  // reconsider (toggle either pick off and choose someone else) before
  // actually committing to the pair.
  function renderDoubleSquadSelect(opponent, order){
    const remaining = 2 - doubleSquadPicked.length;
    // Each sentence gets its own line inside the highlighted box, instead of
    // running together as one justified paragraph like every other opponent.
    const sentences = [
      ...battleSubText(opponent).split(/(?<=[.!])\s+/),
      `Choose exactly 2 Pokémon to send out${remaining > 0 ? `, pick ${remaining} more` : ''}.`,
    ];
    document.getElementById('leadSelectSub').innerHTML = sentences.join('<br>');

    const grid = document.getElementById('leadSelectGrid');
    grid.innerHTML = order.map((mon,i) => `
      <button class="wild-card ${doubleSquadPicked.includes(i) ? 'caught' : ''}" data-idx="${i}">
        <div class="lab-sprite-wrap"><img class="lab-base" src="${LAB_BASE_IMG}" alt="" draggable="false">${avatarHTML(mon)}</div>
        <span class="c-name">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">SHINY</span>' : ''}</span>
        <div class="c-types">${typeDotsHTML(mon.types)}</div>
      </button>`).join('');
    groundSpritesOnBase('#leadSelectGrid');
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

    // Undo the Double Battle title/highlight in case the last screen shown
    // was Hiker Anthony's or First Mate Thaise's proposal.
    document.getElementById('leadSelectTitle').textContent = 'CHOOSE YOUR LEAD';
    document.getElementById('leadSelectSub').classList.remove('double-battle-alert');

    document.getElementById('leadSelectEyebrow').textContent = displayName(opponent.name);
    document.getElementById('leadSelectSub').textContent =
      `${battleSubText(opponent)} ${leadSelectHandText(opponent)}`;

    const portrait = document.getElementById('leadSelectPortrait');
    if(opponent.portraitFile){
      portrait.src = `${TRAINER_PORTRAIT_DIR}/${opponent.portraitFile}`;
      portrait.style.display = 'block';
    } else {
      portrait.style.display = 'none';
    }

    pendingRouteBattleBg = isPlainRouteTrainer(opponent) ? randomRouteBattleBg() : null;
    const baseImg = (opponent.isLegendary || opponent.isMythical) ? LEGENDARY_LEAD_BASE_IMG
      : pendingRouteBattleBg ? ROUTE_TRAINER_BASE_IMGS[pendingRouteBattleBg]
      : LAB_BASE_IMG;
    const grid = document.getElementById('leadSelectGrid');
    grid.innerHTML = order.map((mon,i) => `
      <button class="wild-card" data-idx="${i}">
        <div class="lab-sprite-wrap"><img class="lab-base" src="${baseImg}" alt="" draggable="false">${avatarHTML(mon)}</div>
        <span class="c-name">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">SHINY</span>' : ''}</span>
        <div class="c-types">${typeDotsHTML(mon.types)}</div>
      </button>`).join('');
    groundSpritesOnBase('#leadSelectGrid');
    grid.querySelectorAll('.wild-card').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('leadSelectScreen').classList.remove('active');
        startBattleWithLead(opponent, order, Number(btn.dataset.idx));
      });
    });

    if(absolCanSenseLead(opponent)) openAbsolSenseModal(opponent);
  }

  // Plain route trainer battles — anything that isn't Gym/Cruise/Rival/
  // Elite/Legendary/Mythical/Hill, all of which get their own dedicated art
  // below — alternate between these two so route fights don't all look
  // identical, picked fresh each time a battle starts.
  const ROUTE_BATTLE_BACKGROUNDS = ["assets/Scenarios/battle-bg-route1.jpg", "assets/Scenarios/battle-bg-route2.jpg"];
  function randomRouteBattleBg(){ return pick(ROUTE_BATTLE_BACKGROUNDS); }
  function isPlainRouteTrainer(opponent){
    return !(opponent.isGym || opponent.isCruise || opponent.isRival || opponent.isElite || opponent.isLegendary || opponent.isMythical || opponent.isHillTop1 || opponent.isInfiniteLoop);
  }
  // Rolled once in openLeadSelect() (so the lead-select screen's platform
  // already matches whichever route bg the upcoming battle will use) and
  // consumed by startBattleWithLead() instead of rolling again there, so the
  // lead-select screen and the actual battle never disagree.
  let pendingRouteBattleBg = null;

  function startBattleWithLead(opponent, order, leadIdx){
    const routeBg = isPlainRouteTrainer(opponent) ? (pendingRouteBattleBg || randomRouteBattleBg()) : null;
    pendingRouteBattleBg = null;
    battle = {
      trainer: opponent,
      player: order.map(makeBattler),
      enemy: opponent.squad.map(makeBattler),
      pIdx: leadIdx, eIdx: 0,
      resolving: false,
      nextTimerId: null,
      awaitingSwitch: false,
      over: false,
      routeBg, // which of ROUTE_BATTLE_BACKGROUNDS this battle rolled, if any — see battleBaseImg()
      eliteAiPotionsUsed: 0, // Elite Four AI Potion uses this battle (max 2)
      eliteAiRevived: false, // final Elite Four member's one-time AI Revive
      eliteFaintCount: 0, // final member only, counts their own fainted Pokémon this battle, see the revive-on-2nd-faint logic in afterExchange()
      firstTurnResolved: false, // gates the item-window ring — no countdown during turn 1's window
      voluntarySwitchesUsedThisBattle: 0, // see maxVoluntarySwitchesPerBattle()
      noEffectStreak: 0, // consecutive exchanges where both sides' hits had no effect (see NO_EFFECT_STREAK_LIMIT)
    };

    document.getElementById('battleMoveLog').innerHTML = '';
    document.getElementById('battleContinueBtn').style.display = 'none';
    document.getElementById('battleScreen').classList.add('active');
    document.getElementById('battleScreen').classList.toggle('gym-battle', !!opponent.isGym);
    document.getElementById('battleScreen').classList.toggle('legendary-battle', !!(opponent.isLegendary || opponent.isMythical));
    document.getElementById('battleScreen').classList.toggle('elite-battle', !!opponent.isElite);
    document.getElementById('battleScreen').classList.toggle('cruise-battle', !!(opponent.isCruise || opponent.isRival));
    document.getElementById('battleScreen').classList.toggle('hill-battle', !!(opponent.isHillTop1 || opponent.isInfiniteLoop));
    document.getElementById('battleScreen').classList.remove('double-battle');
    // Gym Leaders get their own per-leader landscape (same art as the head
    // banner/Gym Select row) instead of the generic Route background — the
    // route1 layer stays underneath as a fallback for leaders without art.
    // Cruise Ship battles get a different scene per sequential stage
    // (cruiseStageIndex 0/1/2 -> cruise1/2/3.jpg, Captain Sereia is stage 2's
    // cruise3.jpg) instead of the CSS default's flat cruise1.jpg.
    document.getElementById('battleArena').style.backgroundImage = opponent.isGym
      ? `linear-gradient(rgba(5,8,7,.5), rgba(5,8,7,.5)), url('${gymLeaderBgPath(opponent.name)}'), url('assets/Scenarios/battle-bg-route1.jpg')`
      : opponent.isCruise
      ? `linear-gradient(rgba(5,8,7,.5), rgba(5,8,7,.5)), url('assets/Scenarios/battle-bg-cruise${Math.min(3, Math.max(1, (cruiseStageIndex || 0) + 1))}.jpg')`
      // Rival/Elite/Legendary/Mythical/Hill all get their own dedicated art
      // via the .cruise-battle/.elite-battle/.legendary-battle/.hill-battle
      // CSS classes toggled above — leave the inline style empty so those
      // rules apply instead of the random route pick below.
      : (opponent.isRival || opponent.isElite || opponent.isLegendary || opponent.isMythical || opponent.isHillTop1 || opponent.isInfiniteLoop) ? ''
      : `linear-gradient(rgba(5,8,7,.5), rgba(5,8,7,.5)), url('${battle.routeBg}')`;

    document.getElementById('battleHead').innerHTML = `
      ${trainerPortraitHTML(opponent)}
      <div class="battle-head-text">
        <div class="battle-name">${displayName(opponent.name)}</div>
      </div>
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
    document.getElementById('battleScreen').classList.add('double-battle');
    // The "cruise-battle" water tint (trainer name color, plus one of the two
    // rules setting the blue HP-card border — .double-battle alone already
    // covers that part) is only appropriate for an actual Cruise Ship fight,
    // not every Double Battle — e.g. Hiker Anthony's route-trainer one.
    document.getElementById('battleScreen').classList.toggle('cruise-battle', !!opponent.isCruise);
    document.getElementById('battleScreen').classList.remove('hill-battle');
    // First Mate Thaise (CRUISE_SHIP_BATTLES' isDouble entry) is a Cruise
    // Double Battle — same per-stage background as the singles fights above.
    document.getElementById('battleArena').style.backgroundImage = opponent.isCruise
      ? `linear-gradient(rgba(5,8,7,.5), rgba(5,8,7,.5)), url('assets/Scenarios/battle-bg-cruise${Math.min(3, Math.max(1, (cruiseStageIndex || 0) + 1))}.jpg')`
      : `linear-gradient(rgba(5,8,7,.5), rgba(5,8,7,.5)), url('${randomRouteBattleBg()}')`;

    document.getElementById('battleHead').innerHTML = `
      ${trainerPortraitHTML(opponent)}
      <div class="battle-head-text">
        <div class="battle-name">${displayName(opponent.name)}</div>
      </div>
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

  // Registered once at startup (see init()) — holding down the battle log
  // freezes the item-use countdown to the next exchange exactly where it
  // is (both the real timer and the .item-window-ring's CSS animation, see
  // body.battle-log-held in style.css), and picks back up with whatever
  // time was actually left, rather than the window quietly expiring the
  // instant the player lets go (which is what a naive "just skip battleStep
  // while held" approach did — the original ITEM_WINDOW_MS timer set by
  // scheduleNextTurn() kept running in the background regardless of hold
  // state, so it could fire moments after release with the window already
  // spent). Pointer events cover both mouse and touch in one set of listeners.
  function wireBattleLogHold(){
    const log = document.getElementById('battleMoveLog');
    if(!log) return;
    const hold = () => {
      if(battleLogHeld) return;
      battleLogHeld = true;
      log.classList.add('held');
      document.body.classList.add('battle-log-held');
      if(battle && battle.nextTimerId && battle.itemWindowStartedAt){
        clearTimeout(battle.nextTimerId);
        battle.nextTimerId = null;
        const elapsed = Date.now() - battle.itemWindowStartedAt;
        battle.pendingStepFn = battle.isDouble ? doubleBattleStep : battleStep;
        battle.pendingStepRemainingMs = Math.max(0, ITEM_WINDOW_MS - elapsed);
      }
    };
    const release = () => {
      if(!battleLogHeld) return;
      battleLogHeld = false;
      log.classList.remove('held');
      document.body.classList.remove('battle-log-held');
      if(battle && battle.pendingStepFn){
        const fn = battle.pendingStepFn;
        const remaining = battle.pendingStepRemainingMs;
        battle.pendingStepFn = null;
        // Re-stamped as if the window had started `remaining` ms ago, so a
        // second hold-release before it fires computes the right leftover
        // again instead of resetting to a fresh full window.
        battle.itemWindowStartedAt = Date.now() - (ITEM_WINDOW_MS - remaining);
        battle.nextTimerId = setTimeout(fn, remaining);
      }
    };
    log.addEventListener('pointerdown', hold);
    log.addEventListener('pointerup', release);
    log.addEventListener('pointerleave', release);
    log.addEventListener('pointercancel', release);
  }

  // Small badge next to a battler's name showing an active status condition
  // — empty string when there's none. Cropped from statuses.png, a 44x16-
  // per-frame vertical strip (SLP, PSN, BRN, PAR, FRZ, FNT, PKRS in that
  // order) — only the first 3 rows are used since those are the only
  // statuses this game has.
  const STATUS_ICON_ROW = { sleep:0, poison:1, burn:2 };
  const STATUS_LABELS = { poison: 'Poisoned', burn: 'Burned', sleep: 'Asleep' };
  function statusTagHTML(b){
    if(!b.status) return '';
    const row = STATUS_ICON_ROW[b.status.type];
    if(row == null) return '';
    const label = STATUS_LABELS[b.status.type] || b.status.type;
    return ` <span class="status-badge" style="background-position-y:-${row * 8}px" title="${label}"></span>`;
  }

  // Signed-in players see their own name instead of the generic label.
  function playerHpLabel(){
    return cachedPlayerDisplayName ? cachedPlayerDisplayName.toUpperCase() : 'YOUR POKÉMON';
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
    const baseImg = battleBaseImg(battle.trainer);
    panel.innerHTML = [
      { label:battle.trainer.name.toUpperCase(), b:e, balls:foeBallsHTML, variant:null, reverse:true, vsFoes:[p.mon] },
      { label:playerHpLabel(), b:p, balls:'', variant:'back', reverse:false, vsFoes:[e.mon] },
    ].map(side => `
      <div class="hp-card ${side.reverse ? 'hp-card-reverse' : ''} hp-card-based">
        <div class="lab-sprite-wrap">
          <img class="lab-base" src="${baseImg}" alt="" draggable="false">${avatarHTML(side.b.mon,'avatar-sm', side.variant)}
          <div class="pick-tooltip">${battleMatchupTooltipHTML(side.b.mon, side.vsFoes)}</div>
        </div>
        <div class="hp-info">
          ${side.balls}
          <div class="hp-side-label">${side.label}</div>
          <div class="hp-name-row"><span>${displayName(side.b.mon.name)}${statusTagHTML(side.b)}</span><span>${Math.max(0,side.b.hp)}/${side.b.maxHp}</span></div>
          <div class="hp-bar-track"><div class="hp-bar-fill ${side.b.hp/side.b.maxHp < 0.25 ? 'low':''}" style="width:${Math.max(0,side.b.hp/side.b.maxHp*100)}%"></div></div>
        </div>
      </div>`).join('');
    groundSpritesOnBase('#hpPanel');
    renderTeamSwitchStrip();
    renderBattleItemsPanel();
  }

  // Both Pokémon on each side are simultaneously active for the whole fight
  // (no bench), so this just shows all 4 at once instead of one pair.
  function renderDoubleHpPanel(){
    const panel = document.getElementById('hpPanel');
    if(!panel) return;
    const baseImg = battleBaseImg(battle.trainer);
    // While picking a Potion/Revive target, the eligible player card(s)
    // become clickable right on the card itself — no bench to highlight in
    // a Double Battle, so this is the double-battle equivalent of
    // renderTeamSwitchStrip()'s bench highlighting.
    const pickPotion = potionPickerOpen;
    const pickRevive = revivePickerOpen;
    const aliveMonsOf = side => (side === 'enemy' ? battle.player : battle.enemy).filter(b => b.hp > 0).map(b => b.mon);
    const cardHTML = (b, idx, label, variant, reverse, foes) => {
      const eligible = idx == null ? false : pickPotion ? (b.hp > 0 && b.hp < b.maxHp) : pickRevive ? b.hp <= 0 : false;
      return `
      <div class="hp-card ${reverse ? 'hp-card-reverse' : ''} hp-card-based ${eligible ? 'hp-card-pickable' : ''}" ${eligible ? `data-idx="${idx}"` : ''}>
        <div class="lab-sprite-wrap">
          <img class="lab-base" src="${baseImg}" alt="" draggable="false">${avatarHTML(b.mon,'avatar-sm', variant)}
          <div class="pick-tooltip">${battleMatchupTooltipHTML(b.mon, foes)}</div>
        </div>
        <div class="hp-info">
          <div class="hp-side-label">${label}</div>
          <div class="hp-name-row"><span>${displayName(b.mon.name)}${statusTagHTML(b)}</span><span>${Math.max(0,b.hp)}/${b.maxHp}</span></div>
          <div class="hp-bar-track"><div class="hp-bar-fill ${b.hp/b.maxHp < 0.25 ? 'low':''}" style="width:${Math.max(0,b.hp/b.maxHp*100)}%"></div></div>
        </div>
      </div>`;
    };
    panel.innerHTML = `
      <div class="hp-double-row">
        ${cardHTML(battle.enemy[0], null, battle.trainer.name.toUpperCase(), null, true, aliveMonsOf('enemy'))}
        ${cardHTML(battle.enemy[1], null, battle.trainer.name.toUpperCase(), null, true, aliveMonsOf('enemy'))}
      </div>
      <div class="hp-double-row">
        ${cardHTML(battle.player[0], 0, playerHpLabel(), 'back', false, aliveMonsOf('player'))}
        ${cardHTML(battle.player[1], 1, playerHpLabel(), 'back', false, aliveMonsOf('player'))}
      </div>`;
    groundSpritesOnBase('#hpPanel');
    panel.querySelectorAll('.hp-card-pickable').forEach(card => {
      const idx = Number(card.dataset.idx);
      card.addEventListener('click', () => {
        if(pickPotion) usePotionOn(idx);
        else if(pickRevive) useRevive(idx);
      });
    });
    renderTeamSwitchStrip();
    renderBattleItemsPanel();
  }

  // ---------- MID-BATTLE TEAM SWITCH ----------
  // Shows all up to 6 roster slots from this battle's fixed player order
  // (`battle.player`, set once in beginBattle()). Doubles as the target
  // picker for Revive and the voluntary Switch item too (see
  // renderBattleItemsPanel()) — whichever bench slots are actually eligible
  // for whatever's currently pending get highlighted and made clickable
  // right here, instead of a separate list of Pokémon names. A forced
  // switch (after the active Pokémon faints, see promptForcedSwitch()) and a
  // pending Revive can be pending at the same time (Revive can bring the
  // just-fainted lead back instead of switching), so each slot's action is
  // resolved independently rather than one single mode for the whole strip.
  function renderTeamSwitchStrip(){
    const strip = document.getElementById('teamSwitchStrip');
    const prompt = document.getElementById('switchPrompt');
    if(!strip || !battle) return;
    // Double Battles have no bench to switch in from — both Pokémon fight
    // for the whole encounter, so there's nothing to show here.
    if(battle.isDouble){ strip.innerHTML = ''; if(prompt) prompt.style.display = 'none'; return; }
    if(prompt) prompt.style.display = battle.awaitingSwitch ? 'block' : 'none';
    const forcedPick = !battle.over && battle.awaitingSwitch;
    const baseImg = battleBaseImg(battle.trainer);
    const actions = {};
    const slots = [];
    for(let i = 0; i < MAX_PARTY_SIZE; i++){
      const b = battle.player[i];
      if(!b){ slots.push('<div class="switch-slot empty"></div>'); continue; }
      const fainted = b.hp <= 0;
      const active = i === battle.pIdx;
      if(fainted && revivePickerOpen) actions[i] = () => useRevive(i);
      else if(!fainted && forcedPick) actions[i] = () => switchActivePokemon(i);
      else if(!fainted && !active && switchPickerOpen) actions[i] = () => confirmVoluntarySwitch(i);
      const clickable = !!actions[i];
      slots.push(`<button class="switch-slot ${active ? 'active' : ''} ${fainted ? 'fainted' : ''} ${clickable ? 'selectable' : ''}" data-idx="${i}" ${clickable ? '' : 'disabled'}>
        <div class="lab-sprite-wrap"><img class="lab-base" src="${baseImg}" alt="" draggable="false">${avatarHTML(b.mon,'avatar-sm')}</div>
        <div class="switch-hp-track"><div class="switch-hp-fill ${b.hp/b.maxHp < 0.25 ? 'low':''}" style="width:${Math.max(0,b.hp/b.maxHp*100)}%"></div></div>
        ${fainted ? '<span class="switch-fainted-tag">OUT</span>' : ''}
      </button>`);
    }
    strip.innerHTML = slots.join('');
    groundSpritesOnBase('#teamSwitchStrip');
    strip.querySelectorAll('.switch-slot.selectable').forEach(btn => {
      btn.addEventListener('click', actions[Number(btn.dataset.idx)]);
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
    scheduleNextTurn(battleStep);
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
  // Holding down the battle log (see wireBattleLogHold() in init()) pauses
  // the item-use countdown to the next exchange. Doesn't touch item/switch
  // pickers at all, those already pause on their own terms.
  let battleLogHeld = false;

  // Starts (or restarts) the ITEM_WINDOW_MS countdown to the next exchange,
  // stamping when it began so wireBattleLogHold() can work out exactly how
  // much of it is left if the player holds the battle log mid-countdown —
  // and hand that same remaining time back on release, instead of the
  // window silently expiring the instant they let go.
  function scheduleNextTurn(fn){
    battle.itemWindowStartedAt = Date.now();
    // Cleared right before fn() runs, not just on explicit cancel — otherwise
    // this id is left dangling (already fired) once the window elapses
    // naturally, and wireBattleLogHold()'s hold() reads that stale id as
    // "countdown still running" if the player holds the log during the
    // exchange that follows, scheduling a redundant extra battleStep() that
    // races the real one (see the report of the opponent attacking twice in
    // a row while the player's Pokemon never got a turn in).
    battle.nextTimerId = setTimeout(() => {
      battle.nextTimerId = null;
      fn();
    }, ITEM_WINDOW_MS);
  }

  function renderBattleItemsPanel(){
    const panel = document.getElementById('bagPanel');
    if(!panel || !battle) return;
    const busy = battle.over || battle.resolving;

    if(battle.isDouble){
      const healable = battle.player.filter(b => b.hp > 0 && b.hp < b.maxHp);
      const canHeal = !busy && !revivePickerOpen && (potionPickerOpen || (healable.length > 0 && inv.potions > 0));
      const faintedCount = battle.player.filter(b => b.hp <= 0).length;
      // Permadeath means there's nothing left to revive in Nuzlocke, a
      // fainted Pokémon is already gone by the time this renders (see
      // removeFaintedFromRoster()).
      const isNuzlocke = gameMode === 'nuzlocke';
      const canRevive = !isNuzlocke && !busy && !potionPickerOpen && (revivePickerOpen || (faintedCount > 0 && inv.revives > 0));
      const anyPickerOpen = revivePickerOpen || potionPickerOpen;
      const timedWindowOpen = !busy && !anyPickerOpen && battle.firstTurnResolved;

      panel.innerHTML = `
        <div class="bag-items-row">
          ${timedWindowOpen ? `<div class="item-window-ring" style="animation-duration:${ITEM_WINDOW_MS}ms"></div>` : ''}
          <button class="bag-item-card" id="usePotionBtn" ${canHeal ? '' : 'disabled'}>
            ${itemIconHTML('potions')}
            <span class="inv-count">${inv.potions}</span>
            <span class="inv-label">${isNuzlocke ? 'Max Potion' : 'Potion'}</span>
          </button>
          <button class="bag-item-card ${revivePickerOpen ? 'active-pick' : ''}" id="useReviveBtn" ${canRevive ? '' : 'disabled'}>
            ${itemIconHTML('revives')}
            <span class="inv-count">${inv.revives}</span>
            <span class="inv-label">Revive</span>
          </button>
        </div>
      `;
      const picker = document.getElementById('revivePicker');
      picker.style.display = anyPickerOpen ? 'block' : 'none';
      picker.innerHTML = `
        ${potionPickerOpen ? `<div class="revive-picker-label">Pick a damaged Pokémon above to heal.</div><button class="btn-ghost revive-cancel-btn" id="potionCancelBtn">CANCEL</button>` : ''}
        ${revivePickerOpen ? `<div class="revive-picker-label">Pick a fainted Pokémon above to revive.</div><button class="btn-ghost revive-cancel-btn" id="reviveCancelBtn">CANCEL</button>` : ''}
      `;
      document.getElementById('usePotionBtn').onclick = () => potionPickerOpen ? closePotionPicker() : openPotionPicker();
      document.getElementById('useReviveBtn').onclick = () => revivePickerOpen ? closeRevivePicker() : openRevivePicker();
      if(potionPickerOpen) wirePotionPickerButtons();
      if(revivePickerOpen) wireRevivePickerButtons();
      return;
    }

    const activePlayer = battle.player[battle.pIdx];
    const canHeal = !busy && !revivePickerOpen && !switchPickerOpen && activePlayer && activePlayer.hp > 0 && activePlayer.hp < activePlayer.maxHp && inv.potions > 0;
    const faintedCount = battle.player.filter(b => b.hp <= 0).length;
    const isNuzlocke = gameMode === 'nuzlocke';
    const canRevive = !isNuzlocke && !busy && !switchPickerOpen && (revivePickerOpen || (faintedCount > 0 && inv.revives > 0));
    const benchAliveCount = battle.player.filter((b,i) => b.hp > 0 && i !== battle.pIdx).length;
    const switchCapped = battle.voluntarySwitchesUsedThisBattle >= maxVoluntarySwitchesPerBattle();
    const canSwitch = !busy && !revivePickerOpen && !battle.awaitingSwitch && (switchPickerOpen || (benchAliveCount > 0 && !switchCapped));
    // Only ever shows up post-King of the Hill — before that inv.maxPotions
    // is always 0, so the card stays hidden and the grid stays 3-wide.
    const hasMaxPotion = (inv.maxPotions || 0) > 0;
    const canMaxHeal = !busy && !revivePickerOpen && !switchPickerOpen && activePlayer && activePlayer.hp > 0 && activePlayer.hp < activePlayer.maxHp && hasMaxPotion;
    // The ring only makes sense while there's an actual pending auto-advance
    // timer to race against — not while busy, a picker is open, or a forced
    // switch is waiting (that one has no timeout at all).
    const timedWindowOpen = !busy && !revivePickerOpen && !switchPickerOpen && !battle.awaitingSwitch && battle.firstTurnResolved;

    panel.innerHTML = `
      <div class="bag-items-row ${hasMaxPotion ? 'four-cards' : 'three-cards'}">
        ${timedWindowOpen ? `<div class="item-window-ring" style="animation-duration:${ITEM_WINDOW_MS}ms"></div>` : ''}
        <button class="bag-item-card" id="usePotionBtn" ${canHeal ? '' : 'disabled'}>
          ${itemIconHTML('potions')}
          <span class="inv-count">${inv.potions}</span>
          <span class="inv-label">${isNuzlocke ? 'Max Potion' : 'Potion'}</span>
        </button>
        <button class="bag-item-card ${revivePickerOpen ? 'active-pick' : ''}" id="useReviveBtn" ${canRevive ? '' : 'disabled'}>
          ${itemIconHTML('revives')}
          <span class="inv-count">${inv.revives}</span>
          <span class="inv-label">Revive</span>
        </button>
        <button class="bag-item-card ${switchPickerOpen ? 'active-pick' : ''}" id="useSwitchBtn" ${canSwitch ? '' : 'disabled'}>
          <div class="item-icon switch-icon">⇄</div>
          <span class="inv-label">Switch</span>
        </button>
        ${hasMaxPotion ? `
        <button class="bag-item-card" id="useMaxPotionBtn" ${canMaxHeal ? '' : 'disabled'}>
          ${itemIconHTML('maxPotions')}
          <span class="inv-count">${inv.maxPotions}</span>
          <span class="inv-label">Max Potion</span>
        </button>` : ''}
      </div>
    `;
    const picker = document.getElementById('revivePicker');
    picker.style.display = (revivePickerOpen || switchPickerOpen) ? 'block' : 'none';
    picker.innerHTML = `
      ${revivePickerOpen ? `<div class="revive-picker-label">Pick a fainted Pokémon on your bench.</div><button class="btn-ghost revive-cancel-btn" id="reviveCancelBtn">CANCEL</button>` : ''}
      ${switchPickerOpen ? `<div class="revive-picker-label">Pick who to send out from your bench.</div><button class="btn-ghost revive-cancel-btn" id="switchCancelBtn">CANCEL</button>` : ''}
    `;
    document.getElementById('usePotionBtn').onclick = usePotion;
    document.getElementById('useReviveBtn').onclick = () => revivePickerOpen ? closeRevivePicker() : openRevivePicker();
    document.getElementById('useSwitchBtn').onclick = () => switchPickerOpen ? closeSwitchPicker() : openSwitchPicker();
    if(hasMaxPotion) document.getElementById('useMaxPotionBtn').onclick = useMaxPotion;
    if(revivePickerOpen) wireRevivePickerButtons();
    if(switchPickerOpen) wireSwitchPickerButtons();
  }

  // Target picking for Potion (double battles only, no bench), Revive, and
  // Switch no longer lists Pokémon by name in the item panel — the eligible
  // targets highlight directly on their own card instead: the two active
  // Pokémon's own hp-card for Potion/Revive in a Double Battle (see
  // renderDoubleHpPanel()), or the bench strip for Revive/Switch in a single
  // battle (see renderTeamSwitchStrip()). Only a cancel button remains here.
  function wirePotionPickerButtons(){
    const cancelBtn = document.getElementById('potionCancelBtn');
    if(cancelBtn) cancelBtn.onclick = () => closePotionPicker();
  }

  function openPotionPicker(){
    if(!battle || battle.over || battle.resolving || potionPickerOpen || revivePickerOpen) return;
    if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
    potionPickerOpen = true;
    renderHpPanel(); // cascades into renderDoubleHpPanel() to highlight eligible targets
  }

  function closePotionPicker(resumeBattle){
    potionPickerOpen = false;
    renderHpPanel();
    if(resumeBattle !== false && battle && !battle.over){
      scheduleNextTurn(battleStep);
    }
  }

  function usePotionOn(idx){
    if(!battle || battle.over || battle.resolving) return;
    const target = battle.player[idx];
    if(!target || target.hp <= 0 || target.hp >= target.maxHp || inv.potions <= 0) return;
    if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
    inv.potions--;
    trackItemUsed('potions');
    const healed = Math.round(target.maxHp * potionHealFraction());
    target.hp = Math.min(target.maxHp, target.hp + healed);
    const potionLabel = gameMode === 'nuzlocke' ? 'Max Potion' : 'Potion';
    appendBattleLog(`Used a ${potionLabel} on ${displayName(target.mon.name)}.`, `Recovered ${healed} HP.`, 'item');
    renderHpPanel();
    closePotionPicker();
  }

  function wireRevivePickerButtons(){
    const cancelBtn = document.getElementById('reviveCancelBtn');
    if(cancelBtn) cancelBtn.onclick = () => closeRevivePicker();
  }

  function openRevivePicker(){
    if(!battle || battle.over || battle.resolving || revivePickerOpen) return;
    if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
    revivePickerOpen = true;
    renderHpPanel(); // cascades into renderTeamSwitchStrip()/renderDoubleHpPanel() to highlight eligible targets
  }

  function closeRevivePicker(resumeBattle){
    revivePickerOpen = false;
    renderHpPanel();
    if(resumeBattle !== false && battle && !battle.over && !battle.awaitingSwitch){
      scheduleNextTurn(battleStep);
    }
  }

  // ---------- VOLUNTARY SWITCH (single battles only) ----------
  // Separate from the *forced* switch after a faint (switchActivePokemon(),
  // battle.awaitingSwitch) — this lets the player pull out a still-healthy
  // Pokémon, per-mode capped by maxVoluntarySwitchesPerBattle().
  function wireSwitchPickerButtons(){
    const cancelBtn = document.getElementById('switchCancelBtn');
    if(cancelBtn) cancelBtn.onclick = () => closeSwitchPicker();
  }

  function openSwitchPicker(){
    if(!battle || battle.over || battle.resolving || battle.isDouble || battle.awaitingSwitch || switchPickerOpen) return;
    if(battle.voluntarySwitchesUsedThisBattle >= maxVoluntarySwitchesPerBattle()) return;
    if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
    switchPickerOpen = true;
    renderHpPanel(); // cascades into renderTeamSwitchStrip() to highlight eligible bench targets
  }

  function closeSwitchPicker(resumeBattle){
    switchPickerOpen = false;
    renderHpPanel();
    if(resumeBattle !== false && battle && !battle.over && !battle.awaitingSwitch){
      scheduleNextTurn(battleStep);
    }
  }

  function confirmVoluntarySwitch(idx){
    if(!battle || battle.over || battle.isDouble) return;
    if(battle.voluntarySwitchesUsedThisBattle >= maxVoluntarySwitchesPerBattle()){
      appendBattleLog(`No more switches allowed this battle!`, '', 'info');
      closeSwitchPicker();
      return;
    }
    const target = battle.player[idx];
    if(!target || target.hp <= 0 || idx === battle.pIdx) return;
    battle.voluntarySwitchesUsedThisBattle++;
    switchPickerOpen = false;
    battle.pIdx = idx;
    target.skipAttackThisTurn = true; // switching costs the turn, see resolveAttack()
    appendBattleLog(`Go, ${displayName(target.mon.name)}!`, '', 'info');
    renderHpPanel(); // cascades into renderTeamSwitchStrip()/renderBattleItemsPanel()
    scheduleNextTurn(battleStep);
  }

  function usePotion(){
    if(!battle || battle.over || battle.resolving) return;
    const activePlayer = battle.player[battle.pIdx];
    if(!activePlayer || activePlayer.hp <= 0 || activePlayer.hp >= activePlayer.maxHp || inv.potions <= 0) return;
    if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
    inv.potions--;
    trackItemUsed('potions');
    const healed = Math.round(activePlayer.maxHp * potionHealFraction());
    activePlayer.hp = Math.min(activePlayer.maxHp, activePlayer.hp + healed);
    const potionLabel = gameMode === 'nuzlocke' ? 'Max Potion' : 'Potion';
    appendBattleLog(`Used a ${potionLabel} on ${displayName(activePlayer.mon.name)}.`, `Recovered ${healed} HP.`, 'item');
    renderHpPanel();
    if(!battle.over && !battle.awaitingSwitch) scheduleNextTurn(battleStep);
  }

  // No per-battle cap — there's realistically only ever one or two of these
  // in inventory at a time, from King of the Hill wins, so the low supply
  // is the only limiter that matters.
  function useMaxPotion(){
    if(!battle || battle.over || battle.resolving) return;
    const activePlayer = battle.player[battle.pIdx];
    if(!activePlayer || activePlayer.hp <= 0 || activePlayer.hp >= activePlayer.maxHp || (inv.maxPotions || 0) <= 0) return;
    if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
    inv.maxPotions--;
    trackItemUsed('maxPotions');
    const healed = activePlayer.maxHp - activePlayer.hp;
    activePlayer.hp = activePlayer.maxHp;
    appendBattleLog(`Used a Max Potion on ${displayName(activePlayer.mon.name)}.`, `Fully healed, +${healed} HP.`, 'item');
    renderHpPanel();
    if(!battle.over && !battle.awaitingSwitch) scheduleNextTurn(battleStep);
  }

  function useRevive(idx){
    if(!battle || battle.over || battle.resolving) return;
    const target = battle.player[idx];
    if(!target || target.hp > 0 || inv.revives <= 0) return;
    if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
    inv.revives--;
    trackItemUsed('revives');
    target.hp = Math.round(target.maxHp * REVIVE_HP_FRACTION);
    appendBattleLog(`${displayName(target.mon.name)} was revived!`, `Back up with ${target.hp} HP.`, 'item');
    if(idx === battle.pIdx && battle.awaitingSwitch){
      battle.awaitingSwitch = false; // reviving the just-fainted active mon brings it right back into action
    }
    renderHpPanel();
    closeRevivePicker(!battle.awaitingSwitch); // picking a target counts as the decision — resume, unless still awaiting a switch
  }

  // If both sides land a hit that "has no effect" (pure type immunity, e.g.
  // Normal vs Ghost both ways) for this many exchanges in a row, neither
  // side can ever make progress on its own, so force Struggle next exchange,
  // exactly like the mainline games do once a Pokémon is out of usable
  // moves. This is the only place Struggle can ever come up, since this
  // game has no PP system otherwise.
  const NO_EFFECT_STREAK_LIMIT = 6;
  const STRUGGLE_RECOIL_FRACTION = 0.25;
  const STRUGGLE_MOVE = { name: 'Struggle', type: null, power: 50, accuracy: 100, damage_class: 'physical' };

  function resolveAttack(turn){
    const { b, foe, move } = turn;
    // Both sides' attacks are queued for the same exchange up front (see
    // battleStep()) — if the other side went first and just fainted this
    // one, its own queued attack has nothing left to do. Previously this
    // exited with zero log output, which (especially in a close/fast fight)
    // could read as "my Pokémon never attacks" when it's really just always
    // losing the speed race and getting KO'd before its turn comes up.
    if(b.hp <= 0){
      appendBattleLog(`${displayName(b.mon.name)} can't fight back — it already fainted this turn!`, '', 'info');
      return;
    }
    if(foe.hp <= 0) return; // target already down from something else this exchange — its own faint message already fired
    // Same rule as the mainline games: switching (voluntary, not a forced
    // replacement after a faint) uses up the whole turn, so whoever just
    // came in sits out the very next exchange instead of attacking
    // immediately — see confirmVoluntarySwitch()/maybeEnemyAiSwitch().
    if(b.skipAttackThisTurn){
      b.skipAttackThisTurn = false;
      appendBattleLog(`${displayName(b.mon.name)} can't attack right after switching in!`, '', 'info');
      return;
    }
    if(handleSleepTurn(b)){ b.lastAttackNoEffect = false; return; }
    const struggling = move === STRUGGLE_MOVE;
    const hit = Math.random()*100 < (move.accuracy ?? 100);
    if(!hit){
      appendBattleLog(`${displayName(b.mon.name)} used ${move.name}!`, `${displayName(b.mon.name)}'s attack missed!`, 'miss');
      b.lastAttackNoEffect = false;
      return;
    }
    const { dmg, eff, crit, failed } = computeDamage(b, foe, move);
    // Counter/Mirror Coat with nothing to reflect yet this exchange (or
    // blocked by type immunity) — same "connects but does nothing" beat as
    // a 0x hit, just with its own message instead of "It had no effect...".
    if(move.counterClass && failed){
      appendBattleLog(`${displayName(b.mon.name)} used ${move.name}!`, `But it failed!`, 'miss');
      b.lastAttackNoEffect = false;
      return;
    }
    foe.hp = Math.max(0, foe.hp - dmg);
    if(dmg > 0 && move.damage_class && !move.counterClass){
      foe.tookDamageThisExchange = { class: move.damage_class, amount: dmg };
    }
    b.lastAttackNoEffect = (eff === 0);
    const effText = eff > 1 ? "It's super effective!" : (eff < 1 && eff > 0) ? "It's not very effective..." : eff === 0 ? "It had no effect..." : `${dmg} damage`;
    appendBattleLog(`${displayName(b.mon.name)} used ${move.name}!`, `${crit ? 'Critical hit! ' : ''}${effText}`, 'hit');
    if(eff > 0) maybeApplyMoveStatus(move, foe, b);
    if(struggling && b.hp > 0){
      const recoil = Math.max(1, Math.floor(b.maxHp * STRUGGLE_RECOIL_FRACTION));
      b.hp = Math.max(0, b.hp - recoil);
      appendBattleLog(`${displayName(b.mon.name)} is hit by recoil!`, `${recoil} damage`, 'hit');
      if(b.hp <= 0) appendBattleLog(`${displayName(b.mon.name)} fainted!`, '', 'faint');
    }
    renderHpPanel();
    if(foe.hp <= 0){
      appendBattleLog(`${displayName(foe.mon.name)} fainted!`, '', 'faint');
    }
  }

  function battleStep(){
    if(!battle || battle.over) return;
    if(battle.isDouble){ doubleBattleStep(); return; }
    const p = battle.player[battle.pIdx];
    const e = battle.enemy[battle.eIdx];
    if(!p || !e) return;
    battle.resolving = true;
    renderBattleControls();

    // Cleared once per exchange, before either side's move resolves — see
    // computeDamage()'s counterClass branch, which reads this back on
    // whichever side (if any) opens with Counter/Mirror Coat.
    p.tookDamageThisExchange = null;
    e.tookDamageThisExchange = null;

    // Moves are picked for both sides up front (not lazily inside
    // resolveAttack anymore), because turn order now depends on move
    // priority, not just Speed, so it has to be known before deciding who
    // goes first — see COUNTER_MOVE_DEFS' priority:-5.
    const struggling = (battle.noEffectStreak || 0) >= NO_EFFECT_STREAK_LIMIT;
    const pMove = struggling ? STRUGGLE_MOVE : pickEffectiveMove(p, e);
    const eMove = struggling ? STRUGGLE_MOVE : pickEffectiveMove(e, p);

    const pTurn = { b:p, foe:e, move:pMove };
    const eTurn = { b:e, foe:p, move:eMove };
    const pPriority = pMove.priority || 0;
    const ePriority = eMove.priority || 0;
    const pFirst = pPriority !== ePriority
      ? pPriority > ePriority
      : (p.mon.speed || 0) >= (e.mon.speed || 0);
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
    // King of the Hill's Top1 reuses this exact threshold logic (25% HP
    // trigger, 55%/45% chance by use count), capped at 1 use like Captain
    // Sereia, and healing with a regular Potion like everyone else.
    const isHillTop1 = battle.trainer.isHillTop1;
    // Hill Challengers (the ongoing "defend your title" loop, not the Top1
    // fight itself) get their own Potion allowance, growing with the
    // fight number so each one is a tougher war of attrition than the last.
    const hillNum = battle.trainer.hillChallengerNum;
    // The Rival gets exactly 1 regular Potion (same 1-use cap as Captain
    // Sereia) — one dramatic comeback try, same as everyone else who isn't
    // Elite Four or the Hill's ongoing loop.
    const isRival = battle.trainer.isRival;
    if(!isElite && !isCaptain && !isHillTop1 && !hillNum && !isRival) return;
    const e = battle.enemy[battle.eIdx];
    if(!e || e.hp <= 0) return;
    const used = battle.eliteAiPotionsUsed || 0;
    const maxUses = isElite ? 2 : hillNum ? Math.min(4, 1 + Math.floor(hillNum / 3)) : 1;
    if(used >= maxUses) return;
    if(e.hp / e.maxHp >= 0.25) return;
    const chance = used === 0 ? 0.55 : 0.45;
    if(Math.random() >= chance) return;
    const healed = Math.round(e.maxHp * POTION_HEAL_FRACTION);
    e.hp = Math.min(e.maxHp, e.hp + healed);
    battle.eliteAiPotionsUsed = used + 1;
    appendBattleLog(`${battle.trainer.name} used a Potion on ${displayName(e.mon.name)}!`, `Recovered ${healed} HP.`, 'item');
    renderHpPanel();
  }

  // Top1: 60% chance once per battle to make an "intelligent" switch: swap
  // in a benched Pokémon that's type-favored against the player's current
  // active, or swap away from one that's clearly disadvantaged. Approximates
  // move type with the Pokémon's own types, since this game has no
  // move-selection AI to reason about otherwise. Hill Challengers reuse the
  // same logic but get more attempts as the fight number climbs.
  //
  // Higher-tier Gym Leaders (squad of 3+, i.e. GYM_DIFFICULTY_TIERS' 3rd
  // badge onward) get the same behavior too, capped at a single switch for
  // the whole fight — early Gyms (squad of 2) stay simple/dumb on purpose,
  // so the difficulty ramp still feels gradual instead of every Gym being
  // as sharp as the endgame right away.
  function maybeEnemyAiSwitch(){
    const isHillTop1 = battle.trainer.isHillTop1;
    const hillNum = battle.trainer.hillChallengerNum;
    const isSharpGym = battle.trainer.isGym && battle.enemy.length >= 3;
    if(!isHillTop1 && !hillNum && !isSharpGym) return;
    const maxSwitches = isHillTop1 ? 1 : hillNum ? Math.min(3, 1 + Math.floor(hillNum / 4)) : 1;
    const used = battle.hillAiSwitchesUsed || 0;
    if(used >= maxSwitches) return;
    const active = battle.enemy[battle.eIdx];
    const player = battle.player[battle.pIdx];
    if(!active || active.hp <= 0 || !player || player.hp <= 0) return;
    if(Math.random() >= 0.6) return;
    const bestAgainst = types => Math.max(...types.map(t => typeEffectiveness(t, player.mon.types)));
    const currentEff = bestAgainst(active.mon.types);
    const bench = battle.enemy.map((e,i) => ({ e, i })).filter(({e,i}) => i !== battle.eIdx && e.hp > 0);
    if(!bench.length) return;
    let best = null;
    bench.forEach(({e,i}) => {
      const eff = bestAgainst(e.mon.types);
      if(!best || eff > best.eff) best = { e, i, eff };
    });
    // Only switch if it's a real upgrade: the bench pick must be strictly
    // better than the active's current matchup. (Previously this also
    // allowed a switch whenever the active was disadvantaged, `currentEff <
    // 1`, even if every bench option was an equal or worse matchup — this
    // check alone already covers "escape a disadvantage" correctly, since a
    // neutral or better bench pick beats a resisted active either way.)
    if(best.eff <= currentEff) return;
    battle.hillAiSwitchesUsed = used + 1;
    battle.eIdx = best.i;
    best.e.skipAttackThisTurn = true; // switching costs the turn, see resolveAttack()
    appendBattleLog(`${battle.trainer.name} switches to ${displayName(best.e.mon.name)}!`, '', 'info');
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
    if(idx !== -1){
      activeTeam.splice(idx, 1);
      (nuzlockeGraveyard = nuzlockeGraveyard || []).push(mon);
    }
  }

  function afterExchange(){
    battle.firstTurnResolved = true; // turn 1 is done — the item-window ring is allowed from here on

    // Struggle deadlock tracking (see NO_EFFECT_STREAK_LIMIT above): only
    // extends the streak when both the active player mon and active enemy
    // mon just landed a hit that had no effect; anything else (a miss, real
    // damage, a switch, a faint) breaks the deadlock and resets it.
    const pActive = battle.player[battle.pIdx];
    const eActive = battle.enemy[battle.eIdx];
    battle.noEffectStreak = (pActive && eActive && pActive.hp > 0 && eActive.hp > 0
      && pActive.lastAttackNoEffect && eActive.lastAttackNoEffect)
      ? (battle.noEffectStreak || 0) + 1 : 0;

    maybeEnemyAiPotion();
    maybeEnemyAiSwitch();
    maybeAudinoHeal();

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
      // Final Elite Four member only, one-time use: their 2nd fainted
      // Pokémon this battle (never the 1st) revives instantly, right in its
      // own squad slot, at the exact moment it faints, no turn-by-turn
      // chance/wait like an earlier version of this had. Waiting let more
      // of the squad faint in the meantime, so by the time the revive
      // finally landed, eIdx had already moved past those now-stale 0-HP
      // slots, and walking back through them one silent/empty turn at a
      // time looked like the battle stalling out on dead Pokémon.
      let revivedInPlace = false;
      if(battle.trainer.isFinalElite && !battle.eliteAiRevived){
        battle.eliteFaintCount = (battle.eliteFaintCount || 0) + 1;
        if(battle.eliteFaintCount === 2){
          const revived = battle.enemy[battle.eIdx];
          revived.hp = Math.round(revived.maxHp * REVIVE_HP_FRACTION);
          battle.eliteAiRevived = true;
          appendBattleLog(`${battle.trainer.name} revives ${displayName(revived.mon.name)} back into the fight!`, `Back up with ${revived.hp} HP.`, 'item');
          revivedInPlace = true;
        }
      }
      if(!revivedInPlace){
        // Next alive slot by search, not a flat eIdx+1 — Hill Challenger/
        // Top1's AI switch (maybeEnemyAiSwitch()) can jump battle.eIdx to any
        // still-alive bench slot, ahead of or behind the current one, so a
        // simple increment could walk straight past Pokémon the AI switch
        // left alive further back and never come back for them. Finding the
        // next alive index instead means nobody is ever silently skipped,
        // regardless of what order the AI switched through. -1 (nobody left)
        // is handled below by the fresh enemyWiped check, not here.
        const nextIdx = battle.enemy.findIndex(b => b.hp > 0);
        if(nextIdx !== -1){
          battle.eIdx = nextIdx;
          appendBattleLog(`${battle.trainer.name} sends out ${displayName(battle.enemy[battle.eIdx].mon.name)}!`, '', 'info');
        }
      }
    }

    battle.resolving = false;

    // Ground truth for "has this trainer lost", same "every" check already
    // used for teamWiped above — computed fresh here (after any revive just
    // happened) rather than inferred from eIdx, which the AI switch above can
    // move around freely.
    const enemyWiped = battle.enemy.every(b => b.hp <= 0);
    // Checked in this order so a same-turn double-wipe (end-of-turn poison/
    // burn knocking out both sides' last Pokémon at once) resolves as a win,
    // not a loss — there's no real turn-order tiebreak for simultaneous KOs,
    // and this matches the game's existing player-friendly bias elsewhere
    // (see the speed-tie rule in battleStep(), `pFirst`).
    if(enemyWiped){ endBattle(true); return; }
    if(teamWiped){ endBattle(false); return; }
    if(activeFainted){ promptForcedSwitch(); return; }

    renderHpPanel();
    renderBattleControls();
    scheduleNextTurn(battleStep);
  }

  // ---------- DOUBLE BATTLE (2v2, both sides simultaneously active) ----------
  // No pIdx/eIdx, no bench, no forced switch — every alive combatant on both
  // sides acts once per exchange, resolved in speed order across all 4, each
  // picking a random alive opposing slot as its target (re-checked live, so a
  // target that faints mid-exchange doesn't get attacked twice).
  function doubleBattleStep(){
    if(!battle || battle.over) return;
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
    const { dmg, eff, crit } = computeDamage(c.b, foe, move);
    foe.hp = Math.max(0, foe.hp - dmg);
    const effText = eff > 1 ? "It's super effective!" : (eff < 1 && eff > 0) ? "It's not very effective..." : eff === 0 ? "It had no effect..." : `${dmg} damage`;
    appendBattleLog(`${displayName(c.b.mon.name)} used ${move.name} on ${displayName(foe.mon.name)}!`, `${crit ? 'Critical hit! ' : ''}${effText}`, 'hit');
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
    // Same-turn double-wipe resolves as a win — see the single-battle version
    // of this check above for why.
    if(enemyWiped){ endBattle(true); return; }
    if(playerWiped){ endBattle(false); return; }

    renderHpPanel();
    renderBattleControls();
    scheduleNextTurn(doubleBattleStep);
  }

  function endBattle(won){
    battle.over = true;
    const isGym = battle.trainer.isGym;
    const isLegendary = battle.trainer.isLegendary;
    const isMythical = battle.trainer.isMythical;
    const isElite = battle.trainer.isElite;
    const isCruise = battle.trainer.isCruise;
    const isRival = battle.trainer.isRival;
    const isRivalCameo = battle.trainer.isRivalCameo;
    const isHillTop1 = battle.trainer.isHillTop1;
    const isInfiniteLoop = battle.trainer.isInfiniteLoop;
    // Set only on a Gym win — routes to the "YOU WON!" popup (with the
    // badge) instead of logging the badge/evolution lines and showing the
    // normal bottom Continue button, see the bottom of this function.
    let gymWinInfo = null;
    // Set only when a Legendary/Mythical is caught — routes to the "joined
    // your team!" popup instead of the normal bottom Continue button, same
    // idea as gymWinInfo above.
    let specialCaughtMon = null;
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
        logCatch(specialMon.name);
        appendBattleLog(`${displayName(specialMon.name)} was defeated and sent to your Storage!`, '', 'win');
        specialCaughtMon = specialMon;
      } else {
        appendBattleLog(`${displayName(battle.enemy[0].mon.name)} fled! You won't get another shot at it this run.`, '', 'out');
      }
    } else if(won){
      maybeGrantMunchlaxBonusItem();
      maybeGrantChanseyBonusItem();
      maybeGrantTrubbishBonusItem();
      maybeGrantDelibirdGift();
      if(isHillTop1){
        top1Defeated = true;
        appendBattleLog(`You dethroned ${battle.trainer.name}! You are the new King of the Hill.`, '', 'win');
      } else if(isInfiniteLoop){
        hillDefenses++;
        runTrainersBeaten++;
        const goldWon = applyGoldBonus(randInt(ELITE_GOLD_MIN, ELITE_GOLD_MAX) * battle.trainer.squad.length);
        runGoldEarned += goldWon;
        META.gold += goldWon;
        saveMeta();
        appendBattleLog(`Hill defended! +${goldWon}G.`, '', 'win');
      } else if(isElite){
        eliteIndex++;
        const goldWon = applyGoldBonus(randInt(ELITE_GOLD_MIN, ELITE_GOLD_MAX) * battle.trainer.squad.length);
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
        }
      } else if(isCruise){
        cruiseStageIndex++;
        const goldWon = applyGoldBonus(randInt(CRUISE_GOLD_MIN, CRUISE_GOLD_MAX) * battle.trainer.squad.length);
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
        const goldWon = applyGoldBonus(randInt(RIVAL_GOLD_MIN, RIVAL_GOLD_MAX) * battle.trainer.squad.length);
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
        const goldWon = applyGoldBonus((isGym ? randInt(GYM_GOLD_MIN, GYM_GOLD_MAX) : randInt(TRAINER_GOLD_MIN, TRAINER_GOLD_MAX)) * battle.trainer.squad.length);
        runGoldEarned += goldWon;
        META.gold += goldWon;
        saveMeta();
        if(isGym){
          runBadges++;
          runBeatenBadges.add(battle.trainer.badgeKey);
          // Forces rollGymChoicePool() to roll a fresh 4 next time Gym
          // Select opens, now that this stage's badge is done.
          gymChoicePool = null;
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
      // Whichever enemy Pokémon was still standing when the player's whole
      // team went down — the "cause of defeat" shown on the result
      // screen/run history, not just who beat them. Doubles has no bench
      // (the whole squad is on-field), so any of its 2 members still above
      // 0 HP counts; singles only has the one currently active (battle.eIdx).
      const stillStanding = battle.isDouble
        ? battle.enemy.filter(e => e && e.hp > 0)
        : [battle.enemy[battle.eIdx]].filter(Boolean);
      trainerLossMon = stillStanding.length ? stillStanding.map(e => displayName(e.mon.name)).join(' & ') : null;
    }

    renderBattleControls();
    renderTeamSwitchStrip();
    renderBattleItemsPanel();
    if(gymWinInfo){
      openGymWinModal(gymWinInfo);
    } else if(specialCaughtMon){
      openSpecialCaughtModal(specialCaughtMon, isLegendary ? 'Legendary' : 'Mythical');
    } else if(isRivalCameo && won){
      openRivalCameoPostBattleDialogue();
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

  // Legendary/Mythical wins only: shows the caught Pokémon in a popup
  // instead of the normal bottom Continue button — its own Continue button
  // here is what actually calls afterBattle() to move on, same pattern as
  // openGymWinModal() above.
  function openSpecialCaughtModal(mon, kindLabel){
    document.getElementById('specialCaughtTitle').textContent = `${kindLabel.toUpperCase()} CAUGHT!`;
    document.getElementById('specialCaughtAvatar').innerHTML = avatarHTML(mon);
    document.getElementById('specialCaughtText').textContent = `${displayName(mon.name)} joined your team!`;
    document.getElementById('specialCaughtModal').classList.add('active');
  }

  function closeSpecialCaughtModal(){
    document.getElementById('specialCaughtModal').classList.remove('active');
    afterBattle(true);
  }

  // ---------- PVP CHALLENGES (async, offline — see profile.html) ----------
  // Which friend's user_id this PvP battle is being fought against, so
  // finishPvpBattle() knows who to log the result against — set right
  // before beginBattle() below, cleared the moment the result is recorded.
  let pvpOpponentId = null;

  // Entry point: reached from profile.html's "Challenge" button via
  // index.html?pvp=<friendUserId>, only on a clean homepage (see init() —
  // never mid-run). Reuses beginBattle() exactly like King of the Hill's
  // Top1 fight (reconstructTop1Squad) does: both squads are rebuilt from
  // saved species-name lists via POKEMON_BY_NAME, no cloning needed since
  // makeBattler() never mutates the mon objects it wraps.
  async function startPvpChallenge(friendUserId){
    if(!supabaseClient) return;
    const { data: { session } } = await supabaseClient.auth.getSession();
    const me = session && session.user;
    if(!me){
      alert('Sign in to challenge a friend.');
      return;
    }
    const [{ data: myTeamRow }, { data: friendTeamRow }, { data: friendProfile }] = await Promise.all([
      supabaseClient.from('pvp_teams').select('team').eq('user_id', me.id).maybeSingle(),
      supabaseClient.from('pvp_teams').select('team').eq('user_id', friendUserId).maybeSingle(),
      supabaseClient.from('profiles').select('game_name').eq('user_id', friendUserId).maybeSingle(),
    ]);
    const mySquad = (myTeamRow?.team || []).map(n => POKEMON_BY_NAME[n]).filter(Boolean);
    const friendSquad = (friendTeamRow?.team || []).map(n => POKEMON_BY_NAME[n]).filter(Boolean);
    if(!mySquad.length){
      alert("Set your PvP team on your Profile first, then challenge again.");
      return;
    }
    if(!friendSquad.length){
      alert("This friend hasn't set a PvP team yet.");
      return;
    }

    // No items at all in a PvP fight — zeroing the whole bag is simplest,
    // and matches a fresh run's own starting inv shape (see newRun()), so
    // every item-dependent battle-screen button (Potion/Revive) naturally
    // just doesn't render instead of needing its own isPvp check.
    inv = {
      balls: 0, greatBalls: 0, ultraBalls: 0, masterBalls: 0,
      berrySnack: 0, pokeTreat: 0, potions: 0, revives: 0,
      rerollTickets: 0, fishingBait: 0, megaStone: 0, maxPotions: 0,
    };
    gameMode = 'classic'; // avoids Nuzlocke-only side effects (permadeath, blind picks) leaking into an exhibition fight
    starter = mySquad[0];
    // Both start undefined until newRun()/restoreRun() ever run — a PvP
    // challenge deliberately skips both (see the guard in init()), so
    // without this, anything reading them mid-battle throws. In particular
    // computeDamage()'s Farfetch'd crit check (hasActiveSpecies() ->
    // activeTeam.some(...)) only ever runs for the PLAYER's own attacks
    // (isPlayerAttacker() gates it), so an undefined activeTeam silently
    // killed every one of the player's queued attacks via an uncaught
    // exception inside resolveAttack()'s setTimeout callback — the enemy's
    // attacks never touch that code path, so only they ever showed up in
    // the battle log. This is what that looked like from the outside.
    activeTeam = [];
    storage_ = [];
    pvpOpponentId = friendUserId;

    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('pvpEndBattleBtn').style.display = 'block';
    beginBattle({
      name: friendProfile?.game_name || 'Rival',
      squad: friendSquad,
      isPvp: true,
    }, mySquad);
  }

  async function finishPvpBattle(won){
    document.getElementById('battleScreen').classList.remove('active');
    document.getElementById('pvpEndBattleBtn').style.display = 'none';
    const opponentId = pvpOpponentId;
    const opponentName = battle.trainer.name;
    pvpOpponentId = null;

    if(supabaseClient && opponentId){
      try{
        const { data: { session } } = await supabaseClient.auth.getSession();
        const me = session && session.user;
        if(me){
          await supabaseClient.from('pvp_battles').insert({
            challenger_id: me.id,
            opponent_id: opponentId,
            winner_id: won ? me.id : opponentId,
          });
        }
      }catch(e){ console.error(e); }
    }
    renderPvpResult(won, opponentName);
  }

  // Walking away mid-fight (see pvpEndBattleBtn/pvpEndBattleModal) always
  // counts as a loss — stops the in-flight battleStep/afterExchange timer
  // first so a queued step can't still fire after finishPvpBattle() has
  // already torn the battle screen down.
  function forfeitPvpBattle(){
    if(battle){
      if(battle.nextTimerId){ clearTimeout(battle.nextTimerId); battle.nextTimerId = null; }
      battle.over = true;
    }
    finishPvpBattle(false);
  }

  function renderPvpResult(won, opponentName){
    const el = document.getElementById('pvpResultScreen');
    el.classList.add('active');
    el.innerHTML = `
      <div class="eyebrow">PvP Challenge</div>
      <h1 class="section-h1">${won ? 'VICTORY!' : 'DEFEATED'}</h1>
      <p class="tagline">${won
        ? `Your team beat ${escapeHTML(opponentName)}'s squad!`
        : `${escapeHTML(opponentName)}'s squad got the better of you this time.`}</p>
      <button class="btn-primary" id="pvpResultBackBtn" style="margin-top:16px;">BACK</button>
    `;
    document.getElementById('pvpResultBackBtn').addEventListener('click', () => {
      el.classList.remove('active');
      el.innerHTML = '';
      document.getElementById('startScreen').style.display = 'block';
      renderGoldBadge();
      renderBest();
    });
  }

  function afterBattle(won){
    if(battle.trainer.isPvp){
      finishPvpBattle(won);
      return;
    }
    document.getElementById('battleScreen').classList.remove('active');
    document.getElementById('battleContinueBtn').style.display = 'none';
    const wasGym = battle.trainer.isGym;
    const wasLegendary = battle.trainer.isLegendary;
    const wasMythical = battle.trainer.isMythical;
    const wasElite = battle.trainer.isElite;
    const wasCruise = battle.trainer.isCruise;
    const wasRival = battle.trainer.isRival;

    if(wasMythical){
      // Mythical now happens right after the 8th badge (swapped with
      // Legendary) — win or lose, straight to the Cruise Ticket, no
      // PokeStop screen in between (mirrors what wasLegendary used to do here).
      openCruiseTicketWonScreen();
      return;
    }
    if(wasLegendary){
      // Legendary now happens mid-Cruise (swapped with Mythical, see the
      // wasCruise branch below), just landing here mid-run instead of
      // pre-Cruise.
      // Win or lose, this always routes to a PokeStop stop (never ends the run).
      openPokeStop('legendary');
      return;
    }
    if(!won){
      finishEncounter();
      return;
    }
    if(battle.trainer.isHillTop1 || battle.trainer.isInfiniteLoop){
      // Both lead straight back into (or on to) the infinite loop — no
      // PokeStop, no casino tokens (there's no casino up here to spend them
      // in), the runChampion check below must never fire again for these,
      // it's already true from Elite Four and would otherwise incorrectly
      // reshow the Champion Ending screen on every single loop win.
      openInfiniteLoopScreen();
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
      // No PokeStop stop between Elite Four members — once you've challenged
      // the first one, it's genuinely battle after battle straight through
      // (matches the "no more stops" warning shown at Indigo Plateau). Gold
      // won and any evolution are already logged in the battle log above.
      startEliteBattle();
      return;
    }
    if(wasRival){
      // The Rival battle is the Cruise's last stop — once it's won, Fishing
      // is gone for the rest of the run (see itemLocked()), so buying more
      // Fishing Bait from here on would just be wasted gold.
      cruiseEnded = true;
      openRivalPostBattleDialogue();
      return;
    }
    if(wasCruise){
      // The 2nd ship battle (First Mate) is where the "island stop" used to
      // lead into Mythical — now it leads straight into Legendary instead
      // (swapped story positions), with no PokeStop/wild-encounter step in
      // between, guaranteed once per run the same way the old island stop was.
      if(cruiseStageIndex === 2 && !legendaryHandled){
        startLegendaryBattle();
        return;
      }
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
  // The 2-3 (or fewer, if the roster's that thin) Pokémon the trainer is
  // actually interested in for this trade — picked once, in openTradeOffer(),
  // not re-rolled if the player backs out to the accept/decline screen and
  // hits Accept again. Without this, a player could always give up their
  // single worst Pokémon for whatever's offered; now it's the trainer's
  // pick of eligible Pokémon, not the player's.
  let tradeGiveCandidates;

  function openTradeOffer(trainer, onDone){
    tradeOfferTrainerName = trainer.name;
    tradeOfferOnDone = onDone;
    // Starter is excluded by reference (same guard renderResult/finishEncounter
    // already use for `allCaught`) — it never appears as something to give away.
    const eligible = [
      ...activeTeam.map((mon,i) => mon === starter ? null : { mon, kind:'active', idx:i }),
      ...storage_.map((mon,i) => ({ mon, kind:'storage', idx:i })),
    ].filter(Boolean);
    tradeGiveCandidates = pickN(eligible, Math.min(randInt(2, 3), eligible.length));

    // The offered Pokémon's strength is banded around the give-candidates'
    // average BST (±20%), so the trade reads as a lateral swap instead of a
    // pure slot machine — catchablePool() already excludes legendaries, but
    // not mythicals, hence the extra filter (same as tokenShopPool()).
    // Falls back to the full catchable pool if that band's too thin.
    const catchable = catchablePool().filter(p => !MYTHICAL_POKEMON.includes(p.name));
    const avgBst = tradeGiveCandidates.reduce((sum, c) => sum + c.mon.bst, 0) / tradeGiveCandidates.length;
    const banded = catchable.filter(p => p.bst >= avgBst * 0.8 && p.bst <= avgBst * 1.2);
    tradeOfferMon = pick(banded.length ? banded : catchable);

    document.getElementById('tradeOfferHeading').textContent = `${trainer.name} wants to trade!`;
    renderTradeOfferPhase();
    document.getElementById('tradeOfferScreen').classList.add('active');
  }

  // The initial accept/decline screen, also re-shown by the give-phase's
  // BACK button (see renderTradeGivePhase()), so a player who already hit
  // ACCEPT can still back out and Decline before the trade actually executes
  // (confirmTrade() is the only point of no return).
  function renderTradeOfferPhase(){
    renderTradeOfferBody(`
      <div class="trade-mon-showcase">
        ${avatarHTML(tradeOfferMon,'avatar-sm')}
        <span class="tn">${displayName(tradeOfferMon.name)}</span>
      </div>
      <p class="tagline">${tradeOfferTrainerName} is offering to trade you this Pokémon. Interested?</p>
      <div class="actions">
        <button class="btn-ghost" id="tradeDeclineBtn">DECLINE</button>
        <button class="btn-primary" id="tradeAcceptBtn">ACCEPT</button>
      </div>
    `);
    document.getElementById('tradeDeclineBtn').onclick = closeTradeOffer;
    document.getElementById('tradeAcceptBtn').onclick = renderTradeGivePhase;
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
    tradeGiveCandidates = null;
    onDone();
  }

  function tradeGiveRowHTML(mon, kind, idx){
    const selected = tradeGiveSelectedKind === kind && tradeGiveSelectedIdx === idx;
    // <button>, not <div> — was a plain click-handled div with no keyboard
    // access or focus state at all (see style.css's .trade-give-row resets
    // for the button-default overrides needed to keep it looking the same).
    return `<button class="team-mgmt-row trade-give-row ${selected ? 'selected' : ''}" data-kind="${kind}" data-idx="${idx}">
      ${avatarHTML(mon,'avatar-sm')}
      <div class="team-mgmt-info">
        <span class="tn">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">SHINY</span>' : ''}</span>
        <span class="tt" style="color:${TYPE_COLOR[mon.types[0]]}">${mon.types.join(' / ')}</span>
      </div>
      <span class="tt">${kind === 'active' ? 'ACTIVE' : 'STORAGE'}</span>
    </button>`;
  }

  // Only ever shows tradeGiveCandidates (see openTradeOffer()) — the
  // trainer's pick of 2-3 Pokémon they're interested in, not the player's
  // whole roster, so the player can't always just give up their worst.
  function renderTradeGivePhase(){
    tradeGiveSelectedKind = null;
    tradeGiveSelectedIdx = null;

    renderTradeOfferBody(`
      <p class="tagline">${tradeOfferTrainerName} says: "I'd trade for one of these."</p>
      <div id="tradeGiveGrid">${tradeGiveCandidates.map(r => tradeGiveRowHTML(r.mon, r.kind, r.idx)).join('')}</div>
      <div class="actions">
        <button class="btn-ghost" id="tradeBackBtn">BACK</button>
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
    document.getElementById('tradeBackBtn').onclick = renderTradeOfferPhase;
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
    logCatch(receivedMon.name);

    // Reveal and "thanks for the trade" now share one screen — the reveal
    // banner never gets wiped away, the thanks text/button just fade in
    // underneath it once the swap animation has had time to play out.
    renderTradeOfferBody(`
      <div class="evolution-reveal trade-swap-reveal" id="tradeSwapReveal" style="display:block;">
        <div class="evolution-stage">
          <div class="evo-mon evo-from">${avatarHTML(givenMon,'avatar-sm')}</div>
          <div class="evolution-arrow">⇄</div>
          <div class="evo-mon evo-to">${avatarHTML(receivedMon,'avatar-sm')}</div>
        </div>
        <div class="evolution-text">Traded away <span class="evo-name-cap">${displayName(givenMon.name)}</span> for <span class="evo-name-cap">${displayName(receivedMon.name)}</span>!</div>
        <p class="tagline"><strong>${displayName(receivedMon.name)} was sent to your Computer storage!</strong></p>
      </div>
      <p class="tagline trade-thanks-text" id="tradeThanksText">${tradeOfferTrainerName} thanks you for the trade!</p><br>/
      <button class="btn-primary trade-thanks-continue" id="tradeContinueBtn">CONTINUE</button>
    `);
    const reveal = document.getElementById('tradeSwapReveal');
    void reveal.offsetWidth; // restart the shared evo-fade animation from scratch
    reveal.classList.add('evolve-anim');
    document.getElementById('tradeContinueBtn').onclick = closeTradeOffer;

    setTimeout(() => {
      document.getElementById('tradeThanksText').classList.add('shown');
      document.getElementById('tradeContinueBtn').classList.add('shown');
    }, 2700);
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
    document.getElementById('tokenCasinoLoseBanner').style.display = 'none';
    const payoutDisplay = document.getElementById('tokenCasinoPayout');
    payoutDisplay.classList.add('led');
    payoutDisplay.innerHTML = ledDigitsHTML(0, 5);
    document.getElementById('tokenCasinoSpinBtn').onclick = rollLuckyDice;
    document.getElementById('tokenCasinoSpin5Btn').onclick = () => rollLuckyDiceBatch(5);
    document.getElementById('tokenCasinoBackBtn').onclick = closePokestopCasino;
    showSingleDiceView();
    renderDiceLegend();
    renderTokenCasinoState();
    renderTokenShop();
  }

  function closePokestopCasino(){
    // A roll in flight has pending setInterval/setTimeout callbacks
    // (lockDie/finishDiceRoll) that would otherwise keep running against a
    // hidden screen and silently credit tokens after the player's already
    // back at the PokeStop — guarded off here, and the BACK button itself is
    // disabled for the same reason in renderTokenCasinoState() below.
    if(diceRollState) return;
    document.getElementById('tokenCasinoScreen').classList.remove('active');
    document.getElementById('pokestopScreen').classList.add('active');
    renderPokeStop();
  }

  function renderTokenCasinoState(){
    const creditDisplay = document.getElementById('tokenCasinoCredit');
    if(creditDisplay){
      creditDisplay.classList.add('led');
      creditDisplay.innerHTML = ledDigitsHTML(casinoTokens, 5);
    }
    const goldBadge = document.getElementById('tokenCasinoGold');
    if(goldBadge){
      goldBadge.classList.add('led');
      goldBadge.innerHTML = ledDigitsHTML(META.gold, 6);
    }
    const busy = !!diceRollState;
    const canAffordOne = META.gold >= CASINO_SPIN_COST_GOLD;
    const spinBtn = document.getElementById('tokenCasinoSpinBtn');
    spinBtn.innerHTML = `<span class="slot-icon-press"></span>ROLL THE DICE (${CASINO_SPIN_COST_GOLD}G)`;
    spinBtn.disabled = busy || !canAffordOne;
    // x5 only needs enough Gold for one roll — rollLuckyDiceBatch() rolls
    // as many as affordable and stops early, so the label reflects however
    // many rolls the player can actually afford right now (never below 1,
    // since the button is disabled entirely once gold can't cover even that).
    const spin5Btn = document.getElementById('tokenCasinoSpin5Btn');
    const affordableRolls = Math.max(1, Math.min(5, Math.floor(META.gold / CASINO_SPIN_COST_GOLD)));
    spin5Btn.innerHTML = `<span class="slot-icon-press"></span>ROLL x${affordableRolls} (${CASINO_SPIN_COST_GOLD * affordableRolls}G)`;
    spin5Btn.disabled = busy || !canAffordOne;
    const backBtn = document.getElementById('tokenCasinoBackBtn');
    if(backBtn) backBtn.disabled = busy;
    const insertPrompt = document.getElementById('tokenCasinoInsertPrompt');
    if(insertPrompt) insertPrompt.style.display = (!busy && !canAffordOne) ? 'block' : 'none';
  }

  function appendTokenCasinoLog(text){
    const wrap = document.getElementById('tokenCasinoLog');
    if(!wrap) return;
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
  // `label` names the exact combination rolled, shown under the WINNER
  // banner (see finishDiceRoll()) so the player can see what actually won.
  function evaluateDiceRoll(dice){
    const [a,b,c] = dice;
    if(a === b && b === c){
      if(a === 6) return { key:'triple6', payout:DICE_PAYOUTS.triple6, label:'Triple 6s' };
      if(a === 1) return { key:'triple1', payout:DICE_PAYOUTS.triple1, label:'Triple 1s' };
      return { key:'triple', payout:DICE_PAYOUTS.triple, label:`Triple ${a}s` };
    }
    const sorted = [...dice].sort((x,y) => x - y);
    if(sorted[1] === sorted[0] + 1 && sorted[2] === sorted[1] + 1){
      return { key:'straight', payout:DICE_PAYOUTS.straight, label:`Straight ${sorted.join('-')}` };
    }
    if(a === b || b === c || a === c){
      const pairValue = a === b ? a : (b === c ? b : a);
      return { key:'pair', payout:DICE_PAYOUTS.pair, label:`Pair of ${pairValue}s` };
    }
    return { key:'none', payout:0, label:null };
  }

  // Static reference table shown under the dice — built from DICE_PAYOUTS
  // directly so it can never drift out of sync with the actual payouts.
  function renderDiceLegend(){
    const el = document.getElementById('tokenCasinoDiceLegend');
    if(!el) return;
    const rows = [
      ['Triple 6s', DICE_PAYOUTS.triple6],
      ['Triple 1s', DICE_PAYOUTS.triple1],
      ['Any other triple', DICE_PAYOUTS.triple],
      ['Straight 1-2-3 ... 4-5-6', DICE_PAYOUTS.straight],
      ['Pair', DICE_PAYOUTS.pair],
    ];
    el.innerHTML = rows.map(([label,payout]) => `
      <div class="dice-legend-row">
        <span class="dice-legend-name">${label}</span>
        <span class="dice-legend-payout">${payout}</span>
      </div>`).join('');
  }

  // Toggles between the single-roll big dice and ROLL x5's small results
  // grid — the two share the same spot on the cabinet, only one is ever
  // shown at a time (see rollLuckyDice()/rollLuckyDiceBatch()).
  function showSingleDiceView(){
    document.getElementById('tokenCasinoDice').style.display = '';
    const grid = document.getElementById('tokenCasinoBatchGrid');
    grid.style.display = 'none';
    grid.innerHTML = '';
  }
  function showBatchDiceView(){
    document.getElementById('tokenCasinoDice').style.display = 'none';
    document.getElementById('tokenCasinoBatchGrid').style.display = 'flex';
  }

  function rollLuckyDice(){
    if(diceRollState || META.gold < CASINO_SPIN_COST_GOLD) return;
    META.gold -= CASINO_SPIN_COST_GOLD;
    goldSpentOnSlots += CASINO_SPIN_COST_GOLD; // High Roller achievement
    saveMeta();

    document.getElementById('tokenCasinoSpinBtn').disabled = true;
    document.getElementById('tokenCasinoPayout').classList.add('led');
    document.getElementById('tokenCasinoPayout').innerHTML = ledDigitsHTML(0, 5);
    document.getElementById('tokenCasinoWinBanner').style.display = 'none';
    document.getElementById('tokenCasinoLoseBanner').style.display = 'none';
    showSingleDiceView();
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

  function finishDiceRoll(finalDice){
    diceRollState = null;
    document.getElementById('tokenCasinoSpinBtn').disabled = false;

    const { payout: basePayout, label } = evaluateDiceRoll(finalDice);
    const payout = applyTokenBonus(basePayout);
    const payoutDisplay = document.getElementById('tokenCasinoPayout');
    const banner = document.getElementById('tokenCasinoWinBanner');
    payoutDisplay.classList.add('led');
    payoutDisplay.innerHTML = ledDigitsHTML(payout, 5);

    if(payout > 0){
      casinoTokens += payout;
      [0,1,2].forEach(die => document.getElementById(`tokenCasinoDie${die}`).classList.add('winning-roll'));
      appendTokenCasinoLog(`${label}! You win ${payout} Tokens!`);
      // The WIN icon already says "you won" — no separate WINNER!/JACKPOT
      // headline text anymore, just which combo actually hit (same logic
      // evaluateDiceRoll() used, not a separate guess at it).
      banner.innerHTML = `<div class="slot-icon-win"></div><div class="win-banner-combo">${label}</div>`;
      banner.style.display = 'flex';
      banner.classList.remove('win-pop');
      void banner.offsetWidth;
      banner.classList.add('win-pop');
    } else {
      banner.style.display = 'none';
      const loseBanner = document.getElementById('tokenCasinoLoseBanner');
      loseBanner.innerHTML = `<div class="slot-icon-lose"></div>`;
      loseBanner.style.display = 'flex';
      appendTokenCasinoLog(`No match this time, better luck next roll.`);
    }

    renderTokenCasinoState();
    renderTokenShop();
  }

  // How long between each row's fade-in in the batch results grid (see
  // rollLuckyDiceBatch()) — short enough that 5 rolls finish revealing
  // almost instantly, just enough to read as a cascade instead of a jump-cut.
  const DICE_BATCH_ROW_STAGGER_MS = 80;

  // Skips the roll-by-roll animation entirely (that's the whole point —
  // spinning one at a time N times a PokeStop was the "feels like a job"
  // complaint) and resolves every roll synchronously, then substitutes the
  // big dice for a small fading-in grid of every roll (see .dice-batch-grid
  // in style.css / showBatchDiceView()) plus a log line breaking down which
  // combos hit. Stops early if Gold runs out partway through instead of
  // requiring the full cost up front.
  function rollLuckyDiceBatch(times){
    if(diceRollState || META.gold < CASINO_SPIN_COST_GOLD) return;

    let totalPayout = 0, bestWin = null;
    const winCounts = {};
    const rolls = [];

    while(rolls.length < times && META.gold >= CASINO_SPIN_COST_GOLD){
      META.gold -= CASINO_SPIN_COST_GOLD;
      goldSpentOnSlots += CASINO_SPIN_COST_GOLD; // High Roller achievement
      const dice = [randInt(1,6), randInt(1,6), randInt(1,6)];
      const { payout: basePayout, label } = evaluateDiceRoll(dice);
      const payout = applyTokenBonus(basePayout);
      if(payout > 0){
        totalPayout += payout;
        casinoTokens += payout;
        winCounts[label] = (winCounts[label] || 0) + 1;
        if(!bestWin || payout > bestWin.payout) bestWin = { payout, label };
      }
      rolls.push({ dice, payout, label });
    }
    saveMeta();
    const rollsDone = rolls.length;

    showBatchDiceView();
    const grid = document.getElementById('tokenCasinoBatchGrid');
    grid.innerHTML = rolls.map((roll, i) => `
      <div class="dice-batch-row${roll.payout > 0 ? ' winning-row' : ''}" style="animation-delay:${i * DICE_BATCH_ROW_STAGGER_MS}ms">
        <div class="dice-batch-dice">
          ${roll.dice.map(v => `<div class="die-face mini">${dieFaceHTML(v)}</div>`).join('')}
        </div>
        <span class="dice-batch-result">${roll.payout > 0 ? `${roll.label} · +${roll.payout}T` : 'No match'}</span>
      </div>`).join('');

    const payoutDisplay = document.getElementById('tokenCasinoPayout');
    payoutDisplay.classList.add('led');
    payoutDisplay.innerHTML = ledDigitsHTML(totalPayout, 5);
    const banner = document.getElementById('tokenCasinoWinBanner');
    const loseBanner = document.getElementById('tokenCasinoLoseBanner');
    loseBanner.style.display = 'none';
    if(totalPayout > 0){
      banner.innerHTML = `<div class="slot-icon-win"></div><div class="win-banner-combo">Best: ${bestWin.label}</div>`;
      banner.style.display = 'flex';
      banner.classList.remove('win-pop');
      void banner.offsetWidth;
      banner.classList.add('win-pop');
    } else {
      banner.style.display = 'none';
      loseBanner.innerHTML = `<div class="slot-icon-lose"></div>`;
      loseBanner.style.display = 'flex';
    }

    const comboSummary = Object.entries(winCounts).map(([label,count]) => `${count}x ${label}`).join(', ');
    const shortfallNote = rollsDone < times ? ` (stopped after ${rollsDone}, not enough Gold for all ${times})` : '';
    appendTokenCasinoLog(
      totalPayout > 0
        ? `${rollsDone} rolls: ${comboSummary} — +${totalPayout} Tokens total${shortfallNote}`
        : `${rollsDone} rolls: no matches, better luck next time${shortfallNote}`
    );

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

  // Feeds the two guaranteed-shiny prizes (Lucky Spin's Key Prize, Token
  // Shop's Token Exchange), so canBeShiny() is filtered in here rather than
  // at each call site, no species without shiny art can ever be offered.
  function tokenExchangePool(){
    return catchablePool().filter(p => !MYTHICAL_POKEMON.includes(p.name) && isFinalEvolutionStage(p.name) && canBeShiny(p));
  }

  // Same row system as the PokeStop's own shop (renderPokestopShopGrid()) —
  // the whole row is the buy button, price + a status sublabel on the right,
  // instead of a separate "BUY" button next to a plain info row.
  function renderTokenShop(){
    const grid = document.getElementById('tokenShopGrid');
    if(!grid) return;
    grid.innerHTML = Object.entries(TOKEN_SHOP_ITEMS).map(([key,item]) => {
      const disabled = casinoTokens < item.cost;
      const subLabel = item.isExchange ? '' : `Qty: ${inv[item.invKey] || 0}`;
      return `<button class="shop-row" data-key="${key}" ${disabled ? 'disabled' : ''}>
        <div class="shop-left">
          ${itemIconHTML(item.invKey || key)}
          <div class="shop-info">
            <div class="shop-name">${item.label}</div>
            <div class="shop-desc">${item.desc}</div>
          </div>
        </div>
        <div class="shop-right">
          <span class="shop-price">${item.cost} Tokens</span>
          <span class="shop-level">${subLabel}</span>
        </div>
      </button>`;
    }).join('');
    grid.querySelectorAll('.shop-row').forEach(btn => {
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
        logCatch(won.name);
        appendTokenCasinoLog(`Token Exchange: a shiny ${displayName(won.name)} joins your team!`);
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
  let fishingOnDone, fishingBusy;
  // Suspense timings for the cast->tug->reveal sequence (see castFishingLine()/
  // renderFishingScene()) — purely presentational, doesn't touch the actual
  // catch odds (FISHING_CATCH_CHANCE), just makes every cast feel like it's
  // actually fighting something on the line before showing the result.
  const FISHING_CAST_ANIM_MS = 500;
  const FISHING_TUG_ANIM_MS = 900;

  function openFishing(onDone){
    // Fishing Bait bought at the PokeStop (see POKESTOP_SHOP_ITEMS) tops up
    // fishingCastsLeft rather than resetting it — Fishing can be reopened
    // any number of times during the Cruise (see the cruiseFishingBtn
    // handler below), so casts earned from an earlier session, or bait
    // bought after one, both still count.
    fishingCastsLeft += (inv.fishingBait || 0);
    inv.fishingBait = 0;
    persistRunState(); // save the bait fold-in immediately, don't wait for the next PokeStop checkpoint
    fishingOnDone = onDone;
    fishingBusy = false;
    document.getElementById('fishingLog').innerHTML = '';
    document.getElementById('fishingScreen').classList.add('active');
    renderFishingScene('idle');
    renderFishingState();
    renderFishingShop();
    document.getElementById('fishingCastBtn').onclick = castFishingLine;
    document.getElementById('fishingLeaveBtn').onclick = closeFishing;
  }

  // Rebuilds the `.fishing-scene` box for whichever beat of the cast sequence
  // we're in. `phase` drives both the markup and (via the CSS class of the
  // same name) which animation plays; restarting the animation on every call
  // uses the same "force reflow, then add the class" trick as
  // renderEvolutionReveal(). A catch reveals in its own popup instead of in
  // the scene (see openFishingCatchModal()), so 'caught' just settles the
  // scene back to the calm idle look.
  function renderFishingScene(phase){
    const scene = document.getElementById('fishingScene');
    if(!scene) return;
    // The pond and angler (see .fishing-pond/.fishing-angler in style.css)
    // are part of every phase's markup — which cast-sequence pose the
    // angler's in is driven purely by the CSS rule matching the phase class
    // added below, not by anything here.
    const pond = `<div class="fishing-pond"></div>`;
    const angler = `<div class="fishing-angler"></div>`;
    if(phase === 'released'){
      scene.innerHTML = `${pond}${angler}
        <div class="fishing-catch-reveal released">
          <span class="fishing-splash"></span>
        </div>`;
    } else if(phase === 'tugging'){
      scene.innerHTML = `${pond}${angler}<span class="fishing-bobber"></span><span class="fishing-tug-indicator">!</span>`;
    } else {
      scene.innerHTML = `${pond}${angler}<span class="fishing-bobber"></span>`;
    }
    scene.className = 'fishing-scene';
    void scene.offsetWidth; // restart the phase's animation every time this is (re-)shown
    scene.classList.add(phase);
  }

  // Catch reveal popup — black silhouette slowly fading in to full color
  // (same technique as openShinyRevealModal()'s reveal, just a slower fade
  // to read as "reeling it in" rather than an instant reveal). No platform
  // image under the sprite here, just the Pokémon itself.
  function openFishingCatchModal(mon){
    const avatarWrap = document.getElementById('fishingCatchAvatar');
    avatarWrap.classList.remove('revealed');
    avatarWrap.innerHTML = avatarHTML(mon);
    document.getElementById('fishingCatchName').textContent = displayName(mon.name);
    document.getElementById('fishingCatchModal').classList.add('active');
    void avatarWrap.offsetWidth; // force the black silhouette to paint first
    setTimeout(() => avatarWrap.classList.add('revealed'), 350);
  }

  function closeFishingCatchModal(){
    document.getElementById('fishingCatchModal').classList.remove('active');
  }

  function renderFishingState(){
    document.getElementById('fishingCastsLeft').textContent = fishingCastsLeft;
    document.getElementById('fishingCastBtn').textContent = `CAST THE LINE ${fishingCastsLeft}x`;
    document.getElementById('fishingCastBtn').disabled = fishingCastsLeft <= 0;
  }

  // Pesca Shop — same row markup/styling as the PokeStop's own shop
  // (renderPokestopShopGrid()) and the Token Casino's Token Shop, just a
  // single row for Fishing Bait, sold right here instead of back at the
  // PokeStop. Buying folds straight into fishingCastsLeft (not inv.
  // fishingBait — that fold-in only otherwise happens when openFishing()
  // itself runs) so the Cast button updates immediately without needing to
  // leave and reopen the screen.
  function renderFishingShop(){
    const grid = document.getElementById('fishingShopGrid');
    if(!grid) return;
    const item = POKESTOP_SHOP_ITEMS.fishingBait;
    const cost = shopPrice(item);
    const locked = cruiseEnded;
    const disabled = locked || META.gold < cost;
    const label = locked ? 'CLOSED' : `${cost}G`;
    const subLabel = locked ? 'No longer available this run' : `Qty: ${fishingCastsLeft}`;
    grid.innerHTML = `<button class="shop-row" id="fishingBaitBuyBtn" ${disabled ? 'disabled' : ''}>
      <div class="shop-left">
        ${itemIconHTML('fishingBait')}
        <div class="shop-info">
          <div class="shop-name">${item.label}</div>
          <div class="shop-desc">${item.desc}</div>
        </div>
      </div>
      <div class="shop-right">
        <span class="shop-price">${label}</span>
        <span class="shop-level">${subLabel}</span>
      </div>
    </button>`;
    const btn = document.getElementById('fishingBaitBuyBtn');
    if(btn) btn.addEventListener('click', (e) => buyFishingBait(e.clientX, e.clientY));
  }

  function buyFishingBait(x, y){
    const item = POKESTOP_SHOP_ITEMS.fishingBait;
    const cost = shopPrice(item);
    if(cruiseEnded || META.gold < cost) return;
    META.gold -= cost;
    saveMeta();
    trackItemBought('fishingBait');
    playShopBuyAnim(x, y);
    shopBoughtCounts.fishingBait = (shopBoughtCounts.fishingBait || 0) + 1;
    fishingCastsLeft += 1;
    persistRunState();
    renderFishingState();
    renderFishingShop();
  }

  // Only the latest line is shown — no piling up of prior casts. No
  // highlighted treatment even on a catch — that reveal now happens in its
  // own popup (see openFishingCatchModal()), so this stays a plain log line.
  function appendFishingLog(text){
    const wrap = document.getElementById('fishingLog');
    wrap.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'catch-log-line';
    line.textContent = text;
    wrap.appendChild(line);
  }

  function castFishingLine(){
    if(fishingCastsLeft <= 0 || fishingBusy) return;
    fishingCastsLeft--;
    persistRunState(); // save the spent cast right away — a refresh mid-animation must not refund it
    fishingBusy = true;
    document.getElementById('fishingCastBtn').disabled = true;

    // Rolled up front so the reveal at the end of the animation is just
    // presenting an already-decided outcome, same odds as before.
    const success = Math.random() < fishingCatchChance();
    // Paldean Tauros' Aqua Breed is Water-typed but it's a bull, not a fish
    // — excluded here so it can never actually turn up on the line.
    const waterPool = wildPool().filter(p => !p.legendary && p.types.includes('water') && !p.name.startsWith('tauros-paldea'));
    const caughtMon = success && waterPool.length ? pick(waterPool) : null;

    renderFishingScene('casting');
    setTimeout(() => {
      renderFishingScene('tugging');
      setTimeout(() => {
        if(caughtMon){
          const dittoCopy = catchWildTarget(caughtMon, 'fishing');
          renderFishingScene('caught');
          openFishingCatchModal(caughtMon);
          appendFishingLog(`Something bit! You reeled in a wild ${displayName(caughtMon.name)}, caught, no Pokéball needed!${dittoCopy ? ` Ditto copied it too!` : ''}`);
        } else {
          renderFishingScene('released');
          appendFishingLog(success ? `You felt a tug, but it slipped away...` : `No bites this time...`);
        }
        fishingBusy = false;
        renderFishingState(); // disables Cast on its own once fishingCastsLeft hits 0 — Back is always there now
      }, FISHING_TUG_ANIM_MS);
    }, FISHING_CAST_ANIM_MS);
  }

  function closeFishing(){
    closeFishingCatchModal(); // in case a catch reveal was left open
    document.getElementById('fishingScreen').classList.remove('active');
    const onDone = fishingOnDone;
    fishingOnDone = null;
    onDone();
  }

  // ---------- SAFARI ZONE (instant mini-event) ----------
  let safariBallsLeft, safariBerriesLeft, safariEncounterNum, safariTargetMon,
    safariPendingMultiplier, safariBusy, safariEncounterOver, safariOnDone;

  function openSafariZone(onDone){
    safariBallsLeft = SAFARI_BALL_COUNT;
    safariBerriesLeft = SAFARI_BERRY_COUNT;
    safariEncounterNum = 0;
    safariOnDone = onDone;
    document.getElementById('safariScreen').classList.add('active');
    document.getElementById('safariBallBtn').onclick = throwSafariBall;
    document.getElementById('safariBerryBtn').onclick = useSafariBerry;
    document.getElementById('safariSkipBtn').onclick = skipSafariEncounter;
    document.getElementById('safariLeaveBtn').onclick = closeSafariZone;
    startSafariEncounter();
  }

  function startSafariEncounter(){
    safariEncounterNum++;
    if(safariEncounterNum > SAFARI_ENCOUNTERS || safariBallsLeft <= 0){
      finishSafariZone();
      return;
    }
    // Falls back to the general catchable pool only if the curated Safari
    // roster is ever fully exhausted (every species in it already owned).
    const pool = safariPool();
    safariTargetMon = pick(pool.length ? pool : catchablePool());
    safariPendingMultiplier = 1;
    safariBusy = false;
    safariEncounterOver = false;
    document.getElementById('safariLog').innerHTML = '';
    document.getElementById('safariLeaveBtn').style.display = 'none';
    document.getElementById('safariTarget').innerHTML = `
      <div class="lab-sprite-wrap">
        <img class="lab-base" src="${SAFARI_BASE_IMG}" alt="" draggable="false">
        ${avatarHTML(safariTargetMon)}
        <div class="ball-fx" id="safariBallFx"></div>
      </div>
      <span class="c-name">${displayName(safariTargetMon.name)}</span>
      <div class="c-types">${typeChipsHTML(safariTargetMon.types)}</div>
    `;
    groundSpritesOnBase('#safariScreen');
    renderSafariControls();
  }

  function renderSafariControls(){
    const busy = safariBusy || safariEncounterOver;
    const boosted = safariPendingMultiplier > 1;
    const ballBtn = document.getElementById('safariBallBtn');
    ballBtn.disabled = busy || safariBallsLeft <= 0;
    ballBtn.innerHTML = `
      <img class="item-icon" src="${SAFARI_BALL_ICON}" alt="" onerror="this.style.display='none'">
      <span class="inv-count">${safariBallsLeft}</span>
      <span class="inv-label">Safari Ball</span>
      ${boosted ? '<span class="boost-tag">BOOST</span>' : ''}`;
    const berryBtn = document.getElementById('safariBerryBtn');
    berryBtn.disabled = busy || safariBerriesLeft <= 0;
    berryBtn.innerHTML = `
      <img class="item-icon" src="${SAFARI_BAIT_ICON}" alt="" onerror="this.style.display='none'">
      <span class="inv-count">${safariBerriesLeft}</span>
      <span class="inv-label">Safari Bait</span>`;
    document.getElementById('safariSkipBtn').disabled = busy;
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
    appendSafariLog(`You tossed Safari Bait at ${displayName(safariTargetMon.name)}. Catch chance up!`);
    renderSafariControls();
  }

  // Deliberately moves on without spending any Ball/Berry — still
  // counts against SAFARI_ENCOUNTERS like any other resolved encounter
  // (catch, flee, or ran out of balls all already do), just without
  // wasting a throw on a Pokémon the player doesn't want.
  function skipSafariEncounter(){
    if(safariBusy || safariEncounterOver) return;
    appendSafariLog(`You let ${displayName(safariTargetMon.name)} go.`);
    safariEncounterOver = true;
    renderSafariControls();
    setTimeout(startSafariEncounter, 900);
  }

  function throwSafariBall(){
    if(safariBusy || safariEncounterOver || safariBallsLeft <= 0) return;
    safariBusy = true;
    safariBallsLeft--;
    const chance = clamp((safariTargetMon.base_species_rate ?? 0.3) * SAFARI_BALL_MODIFIER * safariPendingMultiplier * catchChanceMultiplier(), 0, 1);
    safariPendingMultiplier = 1;
    renderSafariControls();
    appendSafariLog(`You threw a Safari Ball at ${displayName(safariTargetMon.name)}...`);

    const success = Math.random() < chance;
    playBallThrowFx('safariBallFx', 'safariBalls', success, () => {
      if(success){
        const dittoCopy = catchWildTarget(safariTargetMon, 'safari');
        appendSafariLog(`Gotcha! ${displayName(safariTargetMon.name)} was caught!${dittoCopy ? ` Ditto copied it too!` : ''}`);
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
    });
  }

  function finishSafariZone(){
    appendSafariLog(`That's the end of your Safari Zone visit, heading back to the PokeStop.`);
    document.getElementById('safariBallBtn').style.display = 'none';
    document.getElementById('safariBerryBtn').style.display = 'none';
    document.getElementById('safariSkipBtn').style.display = 'none';
    document.getElementById('safariLeaveBtn').style.display = 'block';
  }

  function closeSafariZone(){
    document.getElementById('safariScreen').classList.remove('active');
    document.getElementById('safariBallBtn').style.display = 'block';
    document.getElementById('safariBerryBtn').style.display = 'block';
    document.getElementById('safariSkipBtn').style.display = 'block';
    const onDone = safariOnDone;
    safariOnDone = null;
    onDone();
  }

  // ---------- POKESTOP (unified mid-run stop: pre-Gym shop / post-Gym city / post-Legendary) ----------
  let pokestopMode; // 'preGym' | 'postGym' | 'legendary'

  function openPokeStop(mode){
    // Reached from all over (post-battle, post-catch bonus encounters, the
    // Computer/Gym Select back buttons, etc.) — some of those callers already
    // hide their own screen first, but not all (e.g. a curated bonus
    // encounter's catch screen going straight into openPokeStop()), so this
    // hides everything unconditionally rather than trusting every call site.
    hideAllRunScreens();
    pokestopMode = mode;
    const freshEvolution = pendingEvolution;
    pendingEvolution = null;
    document.getElementById('pokestopScreen').classList.add('active');
    renderPokeStop();
    if(freshEvolution && typeof playEvolutionAnimation === 'function'){
      playEvolutionAnimation({
        spriteAtualUrl: imagePath(freshEvolution.from),
        spriteNovoUrl: imagePath(freshEvolution.to),
        // Canvas text can't pick up CSS text-transform:capitalize the way
        // every other name display on the site does, so it needs to be
        // title-cased explicitly here (displayName() itself returns the raw
        // lowercase slug for the common case, e.g. "nidorino").
        nomeDoMonstro: titleCaseWords(displayName(freshEvolution.from.name)),
        nomeNovoMonstro: titleCaseWords(displayName(freshEvolution.to.name)),
        tipoDoMonstro: (freshEvolution.from.types && freshEvolution.from.types[0]) || 'normal'
      });
    }
  }

  function closePokeStopScreen(){
    document.getElementById('pokestopScreen').classList.remove('active');
  }

  function renderPokeStop(){
    renderGoldBadge();
    renderPokestopBadgesRow();

    // Only shown the one time the player lands here right after beating
    // Captain Sereia (the reward that grants the Mega Stone) — hidden for
    // every other PokeStop visit.
    const megaStoneHint = document.getElementById('megaStoneHintPopup');
    if(megaStoneHint) megaStoneHint.style.display = (pokestopMode === 'cruiseCasino' && battle && battle.trainer && battle.trainer.isCaptain) ? 'flex' : 'none';

    let heading, intro, continueLabel, continueFn;
    // 8 badges is a hard cap, not just a minimum — once reached, a route
    // trainer win no longer reoffers Gym Select (falls through to the
    // Mythical-path/restock branches below instead, same as a Gym win
    // already did), so a run can never end up with more than 8 badges.
    if(pokestopMode === 'preGym' && runBadges < BADGES_TO_UNLOCK_ENDGAME){
      heading = 'GEAR UP FOR THE GYM';
      intro = `You beat <b>${battle.trainer.name}</b>.<br> Stock up, then pick a Gym Leader to challenge.`;
      continueLabel = 'CHOOSE A GYM LEADER';
      continueFn = () => {
        closePokeStopScreen();
        if(runBadges === 0 && !firstGymBonusEncounterUsed){
          // One-time bonus wild encounter right before the player's first
          // ever Gym Leader pick this run.
          firstGymBonusEncounterUsed = true;
          setPostEncounterAction('gymSelect');
          startEncounter();
        } else {
          openGymSelect();
        }
      };
    } else if(pokestopMode === 'legendary'){
      // Reached mid-Cruise now (swapped with Mythical, see the wasCruise
      // branch of afterBattle()) — the ship stopped at a remote island for
      // a few hours, right between the 2nd and 3rd ship battles. Continuing
      // leads into a bonus beach Wild Encounter before rejoining the ship,
      // instead of resuming the cruise directly.
      heading = 'A LEGENDARY STIRRED...';
      intro = (legendaryHandled === 'caught'
        ? `You defeated it! It's waiting in Storage, use the Computer to add it to your active team.`
        : `It got away. That was your only shot at it this run.`);
      continueLabel = 'EXPLORE THE BEACH';
      continueFn = () => { closePokeStopScreen(); startCuratedBonusEncounter(beachEncounterPool(), 'cruiseBattle', SAND_BASE_IMG); };
    } else if(pokestopMode === 'cruiseCasino'){
      // The old island-stop branch here (leading into the Mythical) is gone
      // — Legendary now takes that story beat directly from afterBattle()'s
      // wasCruise handling, before this screen ever renders (cruiseStageIndex
      // is never 2 by the time this branch is reached anymore).
      const nextIsCaptain = cruiseStageIndex < CRUISE_SHIP_BATTLES.length && CRUISE_SHIP_BATTLES[cruiseStageIndex].isCaptain;
      const nextIsBattle = cruiseStageIndex < CRUISE_SHIP_BATTLES.length;
      heading = 'CRUISE CASINO';
      intro = `You beat <b>${battle.trainer.name}</b>! Stock up, try your luck, or press on.`;
      continueLabel = !nextIsBattle ? 'FACE YOUR RIVAL' : nextIsCaptain ? 'CHALLENGE THE CAPTAIN' : 'CHALLENGE THE SAILOR';
      continueFn = () => {
        closePokeStopScreen();
        if(cruiseStageIndex < CRUISE_SHIP_BATTLES.length) startCruiseBattle();
        else openRivalChallenge();
      };
    } else if(pokestopMode === 'cruiseComplete'){
      heading = 'RIVAL DEFEATED!';
      intro = `You beat <b>${battle.trainer.name}</b> and it feels great. The ship docks, time to head for Indigo Plateau and the Elite Four.`;
      continueLabel = 'FACE THE ELITE FOUR';
      continueFn = () => {
        closePokeStopScreen();
        cruiseStageIndex = null;
        eliteIndex = 0;
        eliteGauntletFlawless = true; // Flawless Victory achievement, tracked across all 4 members
        if(!eliteBonusEncounterUsed){
          eliteBonusEncounterUsed = true;
          startCuratedBonusEncounter(eliteBonusEncounterPool(), 'finalElitePrep');
        } else {
          startEliteBattle();
        }
      };
    } else if(pokestopMode === 'finalElitePrep'){
      heading = '<img class="pokestop-heading-icon" src="assets/ui/IndigoPlateau-Icon.png" alt="" onerror="this.remove()"> INDIGO PLATEAU';
      intro = `You've arrived at Indigo Plateau, home of the Elite Four. This is your last stop, four full 6-vs-6 battles await, back to back, and <b>losing even one ends your run right here</b>. Stock up while you can.`;
      continueLabel = `CHALLENGE ${ELITE_FOUR[0].name.toUpperCase()}`;
      continueFn = () => { closePokeStopScreen(); startEliteBattle(); };
    } else if(runBadges >= BADGES_TO_UNLOCK_ENDGAME && !mythicalHandled){
      // Mythical and Legendary swapped story positions — Mythical fires here
      // now (via the same bonus wild encounter this beat always had);
      // Legendary now happens mid-Cruise instead (see the wasCruise branch
      // of afterBattle()).
      heading = 'THE PATH OPENS...';
      intro = `You beat <b>${battle.trainer.name}</b> and earned your 8th Badge! <br> A <b>Mythical</b> stirs ahead.`;
      continueLabel = 'SEEK THE MYTHICAL';
      continueFn = () => {
        closePokeStopScreen();
        if(!legendaryBonusEncounterUsed){
          legendaryBonusEncounterUsed = true;
          startCuratedBonusEncounter(alolaGalarLastStagePool(), 'mythicalBattle');
        } else {
          startMythicalBattle();
        }
      };
    } else {
      heading = 'RESTOCK & MOVE ON';
      intro = `You beat <b>${battle.trainer.name}</b> and earned a Badge!`;
      continueLabel = 'HEAD TO THE NEXT ENCOUNTER';
      continueFn = () => { closePokeStopScreen(); encounterNum++; startEncounter(); };
    }

    document.getElementById('pokestopHeading').innerHTML = heading;
    document.getElementById('pokestopIntro').innerHTML = intro;
    const continueBtn = document.getElementById('pokestopContinueBtn');
    continueBtn.textContent = continueLabel;
    continueBtn.onclick = continueFn;

    // All 3 nav rows (Lab/Casino/Fishing) are always shown now, on every
    // PokeStop — the ones not reachable yet just render dimmed/disabled
    // (the same native button:disabled style everywhere else uses) instead
    // of being hidden outright, so the list never shifts around.
    const casinoBtn = document.getElementById('pokestopCasinoBtn');
    if(casinoBtn) casinoBtn.disabled = !pokestopCasinoUnlocked();

    // Fishing only ever does anything on the Cruise Ship — same gate as the
    // Token Casino's own cruiseStageIndex check. Stays reachable regardless
    // of fishingCastsLeft — Fishing Bait is only ever sold from inside the
    // Fishing screen itself now (see renderFishingShop()), so the player
    // always needs a way back in to buy more, even at 0 casts.
    const onCruise = cruiseStageIndex !== null;
    const fishingBtn = document.getElementById('cruiseFishingBtn');
    fishingBtn.disabled = !onCruise || cruiseEnded;
    // Same "new thing to check out" notification dot as the Computer
    // button — shown until the player's first click this run. Tracks
    // cruiseMiniEventUsed.fishing purely as a "seen it before" flag now,
    // independent of whether the button is still enabled.
    const fishingDot = document.getElementById('cruiseFishingNotifDot');
    if(fishingDot) fishingDot.classList.toggle('active', onCruise && !cruiseMiniEventUsed.fishing);
    fishingBtn.onclick = () => {
      cruiseMiniEventUsed.fishing = true; // persisted by openFishing() right after this
      const returnMode = pokestopMode;
      closePokeStopScreen();
      openFishing(() => openPokeStop(returnMode));
    };

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

  // Whether an item is closed for the rest of the run, badge-count based
  // (item.lockAfterBadges, e.g. the Safari Ticket) or, for Fishing Bait
  // specifically, once the Cruise itself has ended (cruiseEnded) — Fishing
  // can never be reopened after that, so there's no reason to keep selling it.
  function itemLocked(item){
    if(item.lockAfterBadges && runBadges >= item.lockAfterBadges) return true;
    if(item.invKey === 'fishingBait' && cruiseEnded) return true;
    // Indigo Plateau is the last PokeStop stop of the run — it's Elite Four
    // battle after battle from here on, no more wild encounters to reroll.
    if(item.invKey === 'rerollTickets' && pokestopMode === 'finalElitePrep') return true;
    return false;
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
      const locked = itemLocked(item);
      const subLabel = locked ? 'No longer available this run'
        : item.instant ? 'Special Sanctuary'
        : lifetimeMax !== undefined ? `Qty: ${inv[item.invKey]} · Bought ${lifetimeBought}/${lifetimeMax}`
        : `Qty: ${inv[item.invKey]}${item.max ? `/${item.max}` : ''}`;
      const disabled = maxed || locked || META.gold < cost;
      const label = maxed ? 'SOLD OUT' : locked ? 'CLOSED' : `${cost}G`;
      // Nuzlocke's Potion is a full heal (see potionHealFraction()), shown
      // here as "Max Potion" so the shop listing matches what it actually does.
      const isNuzlockePotion = item.invKey === 'potions' && gameMode === 'nuzlocke';
      const shopName = isNuzlockePotion ? 'Max Potion' : item.label;
      const shopDesc = isNuzlockePotion ? 'Fully heals a Pokémon.' : (item.desc || '');
      return `<button class="shop-row" data-key="${item.invKey}" ${disabled ? 'disabled' : ''}>
        <div class="shop-left">
          ${itemIconHTML(item.invKey)}
          <div class="shop-info">
            <div class="shop-name">${shopName}</div>
            <div class="shop-desc">${shopDesc}</div>
          </div>
        </div>
        <div class="shop-right">
          <span class="shop-price">${label}</span>
          <span class="shop-level">${subLabel}</span>
        </div>
      </button>`;
    }).join('');

    grid.querySelectorAll('.shop-row').forEach(btn => {
      btn.addEventListener('click', (e) => buyPokeStopItem(btn.dataset.key, e.clientX, e.clientY));
    });
  }

  // A quick "+1" that rises and fades right where the player clicked —
  // appended to <body> as position:fixed (not a child of the shop row)
  // since renderPokeStop() below replaces the whole shop grid synchronously,
  // which would otherwise delete the animation before it ever plays.
  function playShopBuyAnim(x, y){
    if(x == null || y == null) return;
    const fx = document.createElement('span');
    fx.className = 'shop-buy-fx';
    fx.textContent = '+1';
    fx.style.left = `${x}px`;
    fx.style.top = `${y}px`;
    document.body.appendChild(fx);
    fx.addEventListener('animationend', () => fx.remove());
  }

  function buyPokeStopItem(invKey, x, y){
    const item = Object.values(POKESTOP_SHOP_ITEMS).find(i => i.invKey === invKey);
    const cost = shopPrice(item);
    if(META.gold < cost) return;
    if(item.max && inv[invKey] >= item.max) return;
    const lifetimeMax = effectiveLifetimeMax(item);
    if(lifetimeMax !== undefined && (shopBoughtCounts[invKey] || 0) >= lifetimeMax) return;
    if(itemLocked(item)) return;
    META.gold -= cost;
    saveMeta();
    trackItemBought(invKey);
    playShopBuyAnim(x, y);
    if(item.lifetimeMax) shopBoughtCounts[invKey] = (shopBoughtCounts[invKey] || 0) + 1;
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
  }

  // Starts as a flat black silhouette (see .shiny-reveal-avatar .avatar img
  // in CSS) and fades in to the real shiny colors after a short beat — the
  // ".revealed" class flip is what triggers the CSS transition. No platform
  // image under the sprite here, just the Pokémon itself.
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

  // The "END RUN" button is reachable from any in-run screen (not just the
  // PokeStop), so hide every possible screen rather than just the PokeStop's.
  const RUN_SCREEN_IDS = [
    'encounterScreen', 'catchScreen', 'gymSelectScreen', 'rivalChallengeScreen',
    'leadSelectScreen', 'battleScreen', 'tokenCasinoScreen', 'fishingScreen', 'safariScreen',
    'pokestopScreen', 'teamScreen', 'starterScreen', 'itemFindScreen',
    'legendaryIntroScreen', 'championScreen', 'cruiseTicketWonScreen', 'cruiseBoardingScreen', 'tradeOfferScreen',
    'hillIntroScreen', 'infiniteLoopScreen',
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

  // Storage is paginated, 10 per page — purely a browsing view (no cap on
  // how much Storage can actually hold), so the page count just grows with
  // however many Pokémon are in there. Each page gets its own background
  // art, cycling through the list if there are more pages than images.
  let storagePage = 0;
  const STORAGE_PAGE_SIZE = 10;
  const STORAGE_PAGE_BACKGROUNDS = ["assets/ui/Background-Lab.png", "assets/ui/Background-Lab1.png", "assets/ui/Background-Lab2.png", "assets/ui/Background-Lab4.png"];

  // A single shared box for both Active Team and Storage — click opens the
  // Pokédex, press-and-hold-drag moves it (see startTeamDrag()): dropped
  // within its own list it reorders, dropped on the other list it
  // deposits/withdraws, subject to moveTeamMon()'s room checks.
  // Test: Active Team boxes only (not Storage) show each Pokémon standing on
  // a battle-style platform base instead of a plain box. See
  // groundSpritesOnBase() for the part that makes the sprite's actual feet
  // (not the image's padded canvas) line up with the base's surface.
  const LAB_BASE_IMG = "assets/pokemon-game-assets/Graphics/Battlebacks/indoor1_base1.png";
  // Result screen's "Your Team" spotlight (and the Hall of Fame scene right
  // after the 4th Elite Four win, see openChampionEnding()) reuse the same
  // .lab-base platform treatment, swapping in this base only for a Champion
  // run/scene.
  const CHAMPION_BASE_IMG = "assets/pokemon-game-assets/Graphics/Battlebacks/champion1_base1.png";
  // Battle screens: the player's active/bench Pokémon stand on a platform
  // base too, picked by which event the current battle belongs to (plain
  // indoor gym/trainer fights, the Cruise Ship, or the Elite Four gauntlet
  // where each of the 4 members gets its own numbered base).
  const CRUISE_BATTLE_BASE_IMG = "assets/pokemon-game-assets/Graphics/Battlebacks/water_base1.png";
  // Captain Sereia (the Cruise Ship's final battle, CRUISE_SHIP_BATTLES'
  // isCaptain entry) gets her own base instead of the regular Cruise water one.
  const CRUISE_CAPTAIN_BASE_IMG = "assets/pokemon-game-assets/Graphics/Battlebacks/unused/blue1_base1.png";
  const ELITE_BATTLE_BASE_IMGS = [1,2,3,4].map(n => `assets/pokemon-game-assets/Graphics/Battlebacks/elite${n}_base1.png`);
  // Plain route trainer fights (see isPlainRouteTrainer()/ROUTE_BATTLE_BACKGROUNDS)
  // match their randomly-picked battle-bg-route1/2 backdrop with the grass
  // base that visually belongs to it, instead of the generic indoor platform.
  const ROUTE_TRAINER_BASE_IMGS = {
    "assets/Scenarios/battle-bg-route1.jpg": "assets/pokemon-game-assets/Graphics/Battlebacks/grass_base1.png",
    "assets/Scenarios/battle-bg-route2.jpg": "assets/pokemon-game-assets/Graphics/Battlebacks/grass_eve_base1.png",
  };
  function battleBaseImg(trainer){
    if(trainer && trainer.isCaptain) return CRUISE_CAPTAIN_BASE_IMG;
    if(trainer && trainer.isCruise) return CRUISE_BATTLE_BASE_IMG;
    if(trainer && trainer.isElite) return ELITE_BATTLE_BASE_IMGS[eliteIndex] || ELITE_BATTLE_BASE_IMGS[ELITE_BATTLE_BASE_IMGS.length - 1];
    if(trainer && (trainer.isLegendary || trainer.isMythical)) return LEGENDARY_BASE_IMG;
    if(battle && battle.routeBg && ROUTE_TRAINER_BASE_IMGS[battle.routeBg]) return ROUTE_TRAINER_BASE_IMGS[battle.routeBg];
    return LAB_BASE_IMG;
  }
  // Delay between each teammate's staggered .hof-anim pop-in.
  const HOF_STAGGER_MS = 220;

  function teamBoxHTML(mon, kind, idx){
    // Storage is art-only (no name) — the Active Team boxes are the ones
    // big enough to keep the name legible underneath.
    const nameHTML = kind === 'active'
      ? `<span class="tn">${displayName(mon.name)}</span>`
      : '';
    const baseHTML = kind === 'active' ? `<img class="lab-base" src="${LAB_BASE_IMG}" alt="" draggable="false">` : '';
    // Only the Active Team can Mega Evolve — a small badge replaces the old standalone
    // "Mega Evolution" list section, the actual action now lives inside this
    // Pokémon's own Pokédex entry instead (see openPokedex()).
    const canMega = kind === 'active' && inv.megaStone > 0 && (MEGA_FORMS_BY_BASE[mon.name] || []).length > 0;
    const megaBadgeHTML = canMega ? `<img class="mega-badge" src="${megaStoneIconPath(mon.name)}" alt="" draggable="false" title="Can Mega Evolve">` : '';
    return `<button class="team-box" data-kind="${kind}" data-idx="${idx}">
      <div class="lab-sprite-wrap">${baseHTML}${avatarHTML(mon,'avatar-sm')}${megaBadgeHTML}</div>
      ${nameHTML}
    </button>`;
  }

  // Fills out an Active Team row below 6 members with plain base platforms
  // in their would-be grid spot (index still `data-idx`-tagged, `.team-box`
  // still there for teamBoxIndexAt() to hit) so a Storage drag always has
  // a drop target lined up, instead of the grid just shrinking to however
  // many Pokémon are actually on the team. `.empty` keeps it out of the
  // drag/click wiring in renderTeamManagement() — nothing to drag or open.
  function emptyTeamSlotHTML(idx){
    // The blank `.tn` (name label) row is what a filled slot uses to reserve
    // its own height (see teamBoxHTML()) — without it here, a row made up
    // entirely of empty slots (e.g. team of 3) collapses shorter than a row
    // with real Pokémon in it instead of taking up the same space.
    return `<div class="team-box empty" data-kind="active" data-idx="${idx}">
      <div class="lab-sprite-wrap"><img class="lab-base" src="${LAB_BASE_IMG}" alt="" draggable="false"></div>
      <span class="tn">&nbsp;</span>
    </div>`;
  }

  // Every pixel_pack sprite sits on a fixed canvas with a different amount of
  // blank space below its actual feet (depends on the species' pose/height),
  // so lining sprites up flush with the base's surface needs each one's real
  // bottom edge, not the raw image's. Computed once per src via an offscreen
  // canvas alpha scan and cached forever — cheap (sprites are tiny) and only
  // ever run for the up to 6 Pokémon on screen in Active Team.
  const spriteBottomPadCache = new Map();
  function spriteBottomPadFraction(src){
    if(spriteBottomPadCache.has(src)) return spriteBottomPadCache.get(src);
    const promise = new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        try{
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          let lastOpaqueRow = -1;
          for(let y = canvas.height - 1; y >= 0 && lastOpaqueRow < 0; y--){
            for(let x = 0; x < canvas.width; x++){
              if(data[(y * canvas.width + x) * 4 + 3] > 8){ lastOpaqueRow = y; break; }
            }
          }
          resolve(lastOpaqueRow < 0 ? 0 : (canvas.height - 1 - lastOpaqueRow) / canvas.height);
        }catch(e){ resolve(0); } // canvas read failure (shouldn't happen for same-origin assets) -- just skip the shift
      };
      img.onerror = () => resolve(0);
      img.src = src;
    });
    spriteBottomPadCache.set(src, promise);
    return promise;
  }

  // Shifts each sprite in `containerSelector` down by its own blank-padding
  // amount so its actual feet land on its .lab-base platform instead of
  // floating at whatever height the padded source image happens to end at.
  // Used for the Lab's Active Team boxes, the Gym Select "Your Team" roster
  // strip, the starter-select cards, the result screen's team spotlight, and
  // the run-detail card's Active Team grid — anywhere a .lab-base sits
  // behind the avatar.
  async function groundSpritesOnBase(containerSelector){
    const boxes = document.querySelectorAll(`${containerSelector} .team-box, ${containerSelector} .roster-slot, ${containerSelector} .starter-card, ${containerSelector} .spotlight-slot, ${containerSelector} .run-mon-slot, ${containerSelector} .wild-card, ${containerSelector} .catch-target, ${containerSelector} .hp-card-based, ${containerSelector} .switch-slot, ${containerSelector} .legendary-pick-card, ${containerSelector} .legendary-portrait`);
    await Promise.all(Array.from(boxes).map(async box => {
      const img = box.querySelector('.avatar img');
      if(!img) return;
      const pad = await spriteBottomPadFraction(img.getAttribute('src'));
      // Set as a custom property (consumed by the .avatar img base rule and
      // the Legendary/Mythical idle-bounce keyframes in style.css) rather
      // than the transform property directly — a CSS animation on the same
      // element (see sprite-idle-bounce) always wins over an inline
      // transform, which was silently cancelling this grounding shift out
      // on the Legendary/Mythical intro portrait.
      img.style.setProperty('--ground-shift', pad > 0 ? `${(pad * 100).toFixed(2)}%` : '0%');
    }));
  }

  // The single entry point for every drag outcome: reorder within a list,
  // deposit Active -> Storage, or withdraw Storage -> Active. `toIdx` null
  // means "drop at the end" (dropped on empty space, not on another box).
  function moveTeamMon(fromKind, fromIdx, toKind, toIdx){
    const fromArr = fromKind === 'active' ? activeTeam : storage_;
    const toArr = toKind === 'active' ? activeTeam : storage_;
    if(fromKind === toKind && fromIdx === toIdx) return; // dropped on itself
    if(fromKind === 'active' && toKind === 'storage' && activeTeam.length <= 1) return; // must keep at least 1 active
    // Dropping a Storage Pokémon directly onto an occupied Active slot swaps
    // the two instead of requiring a free slot first — the dragged Pokémon
    // takes that spot and the one it landed on goes to Storage in its place.
    if(fromKind === 'storage' && toKind === 'active' && toIdx != null && activeTeam[toIdx]){
      const incoming = storage_.splice(fromIdx, 1)[0];
      const outgoing = activeTeam[toIdx];
      activeTeam[toIdx] = incoming;
      storage_.splice(fromIdx, 0, outgoing);
      renderTeamManagement();
      return;
    }
    if(fromKind === 'storage' && toKind === 'active' && activeTeam.length >= MAX_PARTY_SIZE) return; // no room
    const [mon] = fromArr.splice(fromIdx, 1);
    let insertAt = toIdx == null ? toArr.length : toIdx;
    if(fromKind === toKind && fromIdx < insertAt) insertAt--; // account for the removed slot shifting indices
    toArr.splice(insertAt, 0, mon);
    renderTeamManagement();
  }

  // Which team-box (if any) the point (x,y) lands on inside `container` —
  // lets a drop land at that exact position instead of always appending.
  function teamBoxIndexAt(container, x, y){
    for(const box of container.querySelectorAll('.team-box')){
      const r = box.getBoundingClientRect();
      if(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return Number(box.dataset.idx);
    }
    return null;
  }

  // Set true the instant a team-box drag actually moves (vs. a plain click)
  // — suppresses the click event pointerup would otherwise still fire on
  // the same button, which would pop the Pokédex open right after a
  // successful drag.
  let teamDragMoved = false;
  const TEAM_DRAG_THRESHOLD = 6; // px of pointer movement before a press counts as a drag
  const TEAM_DRAG_LERP = 0.35; // how fast the ghost catches up to the pointer each frame — lower = smoother trailing float, higher = snappier/1:1

  function startTeamDrag(downEvent, sourceEl, kind, idx){
    if(downEvent.button !== 0 && downEvent.pointerType === 'mouse') return;
    const startX = downEvent.clientX, startY = downEvent.clientY;
    let dragging = false;
    let ghost = null;
    let targetX = startX, targetY = startY;
    let ghostX = startX, ghostY = startY;
    let rafId = null;

    // Immediate feedback the instant a finger/cursor presses down, before
    // the drag threshold is even crossed — without this the press felt
    // inert right up until the item suddenly popped into a drag.
    sourceEl.classList.add('pressing');

    function tick(){
      ghostX += (targetX - ghostX) * TEAM_DRAG_LERP;
      ghostY += (targetY - ghostY) * TEAM_DRAG_LERP;
      if(ghost){
        ghost.style.left = `${ghostX}px`;
        ghost.style.top = `${ghostY}px`;
      }
      rafId = requestAnimationFrame(tick);
    }

    function overContainer(container, x, y){
      const rect = container.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    function onMove(ev){
      targetX = ev.clientX;
      targetY = ev.clientY;
      if(!dragging && Math.hypot(targetX - startX, targetY - startY) > TEAM_DRAG_THRESHOLD){
        dragging = true;
        teamDragMoved = true;
        sourceEl.classList.remove('pressing');
        sourceEl.classList.add('dragging');
        ghost = document.createElement('div');
        ghost.className = 'storage-drag-ghost';
        ghost.innerHTML = sourceEl.innerHTML;
        ghostX = targetX; ghostY = targetY;
        ghost.style.left = `${ghostX}px`;
        ghost.style.top = `${ghostY}px`;
        document.body.appendChild(ghost);
        requestAnimationFrame(() => ghost.classList.add('lifted')); // triggers the pop-in transition
        rafId = requestAnimationFrame(tick);
      }
      if(dragging){
        const activeList = document.getElementById('teamActiveList');
        const storageList = document.getElementById('teamStorageList');
        const overActive = overContainer(activeList, targetX, targetY);
        const overStorage = overContainer(storageList, targetX, targetY);
        const activeOk = kind === 'active' || activeTeam.length < MAX_PARTY_SIZE;
        const storageOk = kind === 'storage' || activeTeam.length > 1;
        activeList.classList.toggle('drag-over', overActive && activeOk);
        storageList.classList.toggle('drag-over', overStorage && storageOk);
      }
    }

    function onUp(ev){
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      sourceEl.classList.remove('pressing');
      if(rafId) cancelAnimationFrame(rafId);
      const activeList = document.getElementById('teamActiveList');
      const storageList = document.getElementById('teamStorageList');
      activeList.classList.remove('drag-over');
      storageList.classList.remove('drag-over');
      if(dragging){
        sourceEl.classList.remove('dragging');
        if(ghost){
          const g = ghost;
          g.classList.remove('lifted');
          g.classList.add('dropped');
          setTimeout(() => g.remove(), 160);
        }
        const x = ev.clientX, y = ev.clientY;
        let targetKind = null;
        if(overContainer(activeList, x, y)) targetKind = 'active';
        else if(overContainer(storageList, x, y)) targetKind = 'storage';
        if(targetKind){
          const targetContainer = targetKind === 'active' ? activeList : storageList;
          moveTeamMon(kind, idx, targetKind, teamBoxIndexAt(targetContainer, x, y));
        }
        setTimeout(() => { teamDragMoved = false; }, 0);
      }
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function renderTeamManagement(){
    // Same squad-count dots used in battle (foe-ball/foe-balls), lime for
    // each filled slot, dim for the rest.
    const ballStrip = document.getElementById('rosterBallStrip');
    if(ballStrip){
      ballStrip.innerHTML = Array.from({ length: MAX_PARTY_SIZE }, (_, i) =>
        `<span class="foe-ball${i >= activeTeam.length ? ' used' : ''}"></span>`
      ).join('');
    }

    // Always 6 slots in the grid — a Pokémon box for each active team member,
    // then plain base-platform placeholders for the rest, so the layout
    // (and every empty slot's drop target) stays fixed regardless of how
    // many Pokémon are actually on the team (see emptyTeamSlotHTML()).
    const activeEl = document.getElementById('teamActiveList');
    activeEl.innerHTML = Array.from({ length: MAX_PARTY_SIZE }, (_, i) =>
      i < activeTeam.length ? teamBoxHTML(activeTeam[i], 'active', i) : emptyTeamSlotHTML(i)
    ).join('');
    groundSpritesOnBase('#teamActiveList');

    const totalPages = Math.max(1, Math.ceil(storage_.length / STORAGE_PAGE_SIZE));
    storagePage = clamp(storagePage, 0, totalPages - 1);
    const pageStart = storagePage * STORAGE_PAGE_SIZE;

    const storageEl = document.getElementById('teamStorageList');
    storageEl.style.backgroundImage = `url('${STORAGE_PAGE_BACKGROUNDS[storagePage % STORAGE_PAGE_BACKGROUNDS.length]}')`;
    storageEl.innerHTML = storage_.length
      ? storage_.map((mon,i) => ({ mon, i })).slice(pageStart, pageStart + STORAGE_PAGE_SIZE)
          .map(({mon,i}) => teamBoxHTML(mon, 'storage', i)).join('')
      : '<div class="empty-note"></div>';

    const pageLabel = document.getElementById('storagePageLabel');
    if(pageLabel) pageLabel.textContent = `${storagePage + 1} / ${totalPages}`;
    const prevBtn = document.getElementById('storagePrevBtn');
    const nextBtn = document.getElementById('storageNextBtn');
    if(prevBtn){
      prevBtn.disabled = storagePage <= 0;
      prevBtn.onclick = () => { storagePage--; renderTeamManagement(); };
    }
    if(nextBtn){
      nextBtn.disabled = storagePage >= totalPages - 1;
      nextBtn.onclick = () => { storagePage++; renderTeamManagement(); };
    }

    [activeEl, storageEl].forEach(container => {
      container.querySelectorAll('.team-box:not(.empty)').forEach(btn => {
        const kind = btn.dataset.kind;
        const idx = Number(btn.dataset.idx);
        btn.addEventListener('pointerdown', (e) => startTeamDrag(e, btn, kind, idx));
        btn.addEventListener('click', () => {
          if(teamDragMoved) return; // suppress the click a drag's pointerup also fires
          openPokedex(kind === 'active' ? activeTeam[idx] : storage_[idx], kind === 'active' ? idx : null);
        });
      });
    });
    checkpoint('team');
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
    openMegaEvolutionModal(result);
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

  // ---------- RESULT ----------
  // ---------- HIDDEN ACHIEVEMENTS (checked once, at run end) ----------
  // Each entry is a self-contained { name, test(run) } pair. `test` reads
  // only fields already present on the `run` object built in
  // finishEncounter() (which mirrors/extends the module-level counters in
  // the "HIDDEN ACHIEVEMENT TRACKING" block above), so this whole table can
  // be reasoned about, and extended, without touching any other system.
  // Titles only, no descriptions, by design (see checkAchievements()).
  const ACHIEVEMENT_SAFARI_CATCH_MIN = 5;
  const ACHIEVEMENT_FISHING_CATCH_MIN = 5;
  const ACHIEVEMENT_EVOLUTION_CHAIN_MIN = 7; // "more than 7", strictly greater
  const ACHIEVEMENT_STATUS_SPECIALIST_MIN = 10;
  const ACHIEVEMENT_HIGH_ROLLER_GOLD_SPENT_MIN = 3000;
  // Checked against run.goldEarned (cumulative gold earned this run, never
  // reduced by spending), not an ending balance, so the bar sits higher than
  // a typical full Champion run's total income.
  const ACHIEVEMENT_GOLD_DIGGER_MIN = 15000;
  const ACHIEVEMENT_LUCKY_SHINE_MIN = 2;
  const ACHIEVEMENT_MASTER_OF_ONE_MIN = 5;

  const ACHIEVEMENT_DEFS = [
    {
      name: 'Iron Will',
      test: run => !run.itemsUsed.potions && !run.itemsUsed.revives,
    },
    {
      // Every mon on the final team shares a primary type. Requires at
      // least ACHIEVEMENT_MASTER_OF_ONE_MIN Pokémon so a small team can't
      // trivially qualify.
      name: 'Master of One',
      test: run => run.activeRoster.length >= ACHIEVEMENT_MASTER_OF_ONE_MIN &&
        run.activeRoster.every(m => m.types[0] === run.activeRoster[0].types[0]),
    },
    { name: 'Safari Sharpshooter', test: run => run.safariCatchCount >= ACHIEVEMENT_SAFARI_CATCH_MIN },
    // Counts the starter too (run.caught never includes it, see
    // finishEncounter()), not just other catches — a shiny starter should
    // still count toward the total.
    {
      name: 'Lucky Shine',
      test: run => run.caught.filter(m => m.is_shiny).length + (run.starter && run.starter.is_shiny ? 1 : 0) >= ACHIEVEMENT_LUCKY_SHINE_MIN,
    },
    { name: 'Reel Deal', test: run => run.fishingCatchCount >= ACHIEVEMENT_FISHING_CATCH_MIN },
    { name: 'Evolution Chain', test: run => run.evolvedCount > ACHIEVEMENT_EVOLUTION_CHAIN_MIN },
    { name: 'Status Effect Specialist', test: run => run.playerStatusEffectsApplied >= ACHIEVEMENT_STATUS_SPECIALIST_MIN },
    // Only meaningful once the gauntlet is actually cleared (run.champion),
    // eliteGauntletFlawless otherwise just sits at its initial `true` for a
    // run that never reached the Elite Four at all.
    { name: 'Flawless Victory', test: run => run.champion && run.eliteGauntletFlawless },
    { name: 'Comeback Kid', test: run => run.comebackKidAchieved },
    // Requires at least one catch so a run that never threw a single ball
    // can't trivially qualify off perfectCatcher's untouched default.
    { name: 'Perfectionist', test: run => run.perfectCatcher && run.caught.length > 0 },
    { name: 'High Roller', test: run => run.goldSpentOnSlots >= ACHIEVEMENT_HIGH_ROLLER_GOLD_SPENT_MIN },
    { name: 'Gold Digger', test: run => run.goldEarned >= ACHIEVEMENT_GOLD_DIGGER_MIN },
    {
      name: 'Underdog',
      test: run => run.champion && run.activeRoster.length > 0 &&
        run.activeRoster.every(m => hasNoEvolutionaryRelations(m.name)),
    },
    { name: 'King of the Hill', test: run => run.top1Defeated },
    // Nuzlocke only, run.mode is set at finishEncounter() time so this can't
    // be fooled by a live gameMode change between runs.
    {
      name: 'Iron Nuzlocke',
      test: run => run.mode === 'nuzlocke' && run.champion && (run.nuzlockeGraveyard || []).length === 0,
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
      return { label:"POKÉMON CHAMPION", flavor:`You are the Champion!`, foil:"foil-perfect" };
    } else if(run.trainerLoss){
      const causeText = run.trainerLossMon ? ` Their ${run.trainerLossMon} was the last one standing.` : '';
      return { label:"DEFEATED", flavor:`Lost to ${run.trainerLoss}. The run ends here.${causeText}`, foil:"foil-defeat" };
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
    // The homepage's "Continue Run" button (if it was ever shown this page
    // load) would otherwise keep dangling a reference to this exact run in
    // memory — clicking it calls restoreRun() on that in-memory object
    // directly, bypassing the fact the save was just wiped above, letting a
    // player "keep playing" a run that already ended (win, loss, or abandon).
    pendingContinueRun = null;
    const continueBtn = document.getElementById('continueRunBtn');
    if(continueBtn) continueBtn.style.display = 'none';
    // Fire-and-forget: never awaited, never allowed to delay or break this
    // screen if Supabase is unreachable — see recordAnalytics(). Skipped
    // entirely for a God Mode test run (devGodModeRun()) — that's not a
    // real play session and shouldn't pollute analytics.
    if(!devGodModeRunActive) recordAnalytics(run, run.champion ? 'champion' : run.trainerLoss ? 'lost' : 'abandoned');

    // Once a player has set an in-game name on their Profile (see
    // profile.html's "Edit" button, stored server-side in public.profiles —
    // see update-name), that name is used automatically — no more re-typing
    // a name and clicking Save Highscore every single run. Only guests /
    // accounts that haven't set a name yet still get the manual name-entry
    // flow below.
    autoResolvedPlayerName = null;
    if(supabaseClient && !devGodModeRunActive){
      try{
        const { data: { session } } = await supabaseClient.auth.getSession();
        if(session?.user){
          const { data } = await supabaseClient.from('profiles').select('game_name').eq('user_id', session.user.id).maybeSingle();
          autoResolvedPlayerName = data?.game_name || null;
        }
      }catch(e){ /* fall through to the manual name-entry flow */ }
    }

    const score = computeScore(run);
    const gotCatch = run.caught.length > 0;
    const battlesWon = run.trainersBeaten + run.badges;

    const tierMeta = computeTierMeta(run);

    // No Badges tile here — the run's badges are already shown further down
    // (the earned-badges row), so a second badge count up top was redundant.
    const statTiles = [
      ['Battles Won', battlesWon],
      ['Caught', caughtCount(run)], ['Money Earned', `${run.goldEarned}G`, true],
    ].map(([label,count,isGold]) => `<div class="inv-chip"><span class="inv-count ${isGold ? 'gold-text' : ''}">${count}</span><span class="inv-label">${label}</span></div>`).join('');

    const spotlightBaseImg = run.champion ? CHAMPION_BASE_IMG : LAB_BASE_IMG;
    // Champion only — each teammate pops in one at a time (staggered via
    // animation-delay, see .hof-anim/@keyframes hofReveal) instead of all
    // appearing at once, echoing the games' Hall of Fame induction scene.
    const spotlightHTML = (run.activeRoster || []).map((mon, i) => `
      <div class="spotlight-slot has-base${run.champion ? ' hof-anim' : ''}"${run.champion ? ` style="animation-delay:${i * HOF_STAGGER_MS}ms"` : ''}>
        <div class="lab-sprite-wrap"><img class="lab-base" src="${spotlightBaseImg}" alt="" draggable="false">${avatarHTML(mon,'avatar-sm')}</div>
        <span class="tn">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">SHINY</span>' : ''}</span>
      </div>`).join('');

    // Nuzlocke only — permadeath'd Pokémon (see removeFaintedFromRoster()),
    // shown grayed out below the surviving active team, never mixed into it.
    const graveyard = run.nuzlockeGraveyard || [];
    const graveyardHTML = (run.mode === 'nuzlocke' && graveyard.length) ? `
      <div class="team-spotlight graveyard-spotlight">
        <div class="team-spotlight-title">FALLEN IN BATTLE</div>
        <div class="team-spotlight-grid">${graveyard.map(mon => `
          <div class="spotlight-slot fainted-slot">
            ${avatarHTML(mon,'avatar-sm')}
            <span class="tn">${displayName(mon.name)}</span>
          </div>`).join('')}</div>
      </div>` : '';

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

          <div class="evolution-reveal" id="resultEvolutionReveal" style="display:none;">
            <div class="evolution-label">EVOLUTION</div>
            <div class="evolution-stage">
              <div class="evo-mon evo-from"></div>
              <div class="evolution-arrow">→</div>
              <div class="evo-mon evo-to"></div>
            </div>
            <div class="evolution-text"></div>
          </div>

          <div class="team-spotlight${run.champion ? ' hof' : ''}">
            <div class="team-spotlight-title">YOUR TEAM</div>
            <div class="team-spotlight-grid" id="resultTeamSpotlightGrid">${spotlightHTML}</div>
          </div>
          ${graveyardHTML}

          <div class="inv-strip" style="margin-top:16px;">${statTiles}</div>
          ${achievementsHTML}

          <div class="run-detail-team-grid active-team-grid" id="resultCaughtGrid">
            <div class="run-mon-slot">
              ${avatarHTML(run.starter,'avatar-sm')}
              <span class="tn">${displayName(run.starter.name)}</span>
            </div>
            ${run.caught.map(mon => `
              <div class="run-mon-slot">
                ${avatarHTML(mon,'avatar-sm')}
                <span class="tn">${displayName(mon.name)}${mon.is_shiny ? ' <span class="shiny-tag">SHINY</span>' : ''}</span>
              </div>`).join('')}
          </div>
          ${!gotCatch ? '<div class="empty-note">No wild Pokémon joined the team this run.</div>' : ''}

          <div class="divider"></div>
          <div class="credit-line">
            Started with <b>${displayName(run.starter.name)}</b> · <span class="gold-text">${META.gold}G</span> total gold
          </div>
        </div>
      </div>

      ${run.champion ? `
      <div class="hof-card">
        <div class="hof-card-title">HALL OF FAME</div>
        <p class="hof-card-desc">Download a card of your championship run, team and achievements included.</p>
        <button class="btn-primary" id="downloadHofBtn">DOWNLOAD CARD</button>
        <div class="hof-status" id="hofStatus"></div>
      </div>` : ''}

      ${devGodModeRunActive ? `
      <div class="highscore-entry">
        <p class="highscore-label">God Mode test run — not saveable to the real leaderboard.</p>
      </div>` : autoResolvedPlayerName ? `
      <div class="highscore-entry">
        <p class="highscore-label">Saved as <strong>${escapeHTML(autoResolvedPlayerName)}</strong></p>
      </div>` : `
      <div class="highscore-entry">
        <label for="playerNameInput" class="highscore-label">Write your name to save this run as a Highscore</label>
        <input type="text" id="playerNameInput" class="name-input" placeholder="Your name" maxlength="20" autocomplete="off">
        <div class="highscore-error" id="highscoreError" style="display:none; color:#ff6b6b; font-size:11px; margin-top:4px;"></div>
        <button class="btn-primary" id="saveHighscoreBtn">SAVE HIGHSCORE</button>
      </div>`}
      <div class="actions">
        <button class="btn-ghost" id="shareRunBtn">SHARE</button>
        <button class="btn-ghost" id="againBtn">RUN IT BACK</button>
      </div>
    `;

    renderEvolutionReveal('resultEvolutionReveal', pendingEvolution);
    pendingEvolution = null;
    groundSpritesOnBase('#resultTeamSpotlightGrid');

    // Strips emoji/symbols out of the name as the player types (without
    // trimming, so an interior space isn't eaten mid-keystroke) — final
    // trim + profanity check happens only at submit time, in saveHighscore().
    // The whole highscore-entry block (and this input) isn't rendered at all
    // for a God Mode test run, hence the guard.
    const nameInputEl = document.getElementById('playerNameInput');
    if(nameInputEl){
      nameInputEl.addEventListener('input', () => {
        const stripped = stripDisallowedNameChars(nameInputEl.value);
        if(stripped !== nameInputEl.value) nameInputEl.value = stripped;
      });
    }

    let saved = false;
    // With a Profile name set (autoResolvedPlayerName), the run is recorded
    // right away — no typing, no button. Otherwise this only ever records a
    // Highscore if the player typed a name that passes the profanity check;
    // leaving the field blank (or entering something blocked) means the run
    // is simply never sent to the leaderboard, rather than silently saving
    // under a generic "Player" name. Always a no-op for a God Mode test run
    // (see devGodModeRunActive) — that run is never submittable.
    async function saveHighscore(){
      if(saved || devGodModeRunActive) return;
      let name = autoResolvedPlayerName;
      let nameInput, errorEl;
      if(!name){
        nameInput = document.getElementById('playerNameInput');
        errorEl = document.getElementById('highscoreError');
        name = sanitizeHighscoreName(nameInput.value);
        if(!name){
          if(errorEl){ errorEl.textContent = 'Enter a name to save this run as a Highscore.'; errorEl.style.display = 'block'; }
          return;
        }
        if(containsProfanity(name)){
          if(errorEl){ errorEl.textContent = "That name isn't allowed, please pick a different one."; errorEl.style.display = 'block'; }
          return;
        }
      }
      saved = true;
      if(errorEl) errorEl.style.display = 'none';
      const { isNewBest } = await recordRun(run, name);
      if(nameInput){
        nameInput.disabled = true;
        const saveBtn = document.getElementById('saveHighscoreBtn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'SAVED';
      }
      if(isNewBest) document.getElementById('newBestTag').style.display = 'inline-block';
      renderBest();
    }
    const saveHighscoreBtnEl = document.getElementById('saveHighscoreBtn');
    if(saveHighscoreBtnEl) saveHighscoreBtnEl.addEventListener('click', saveHighscore);
    if(autoResolvedPlayerName) saveHighscore(); // account has a Profile name set — save immediately, no manual step
    document.getElementById('againBtn').addEventListener('click', async () => {
      await saveHighscore(); // no-op if no valid name was ever entered — the run just isn't recorded
      el.classList.remove('active'); el.innerHTML = '';
      document.getElementById('startScreen').style.display = 'block';
      renderGoldBadge();
    });

    document.getElementById('shareRunBtn').addEventListener('click', () => openShareOptionsModal(run, score));

    const hofBtn = document.getElementById('downloadHofBtn');
    if(hofBtn) hofBtn.addEventListener('click', () => downloadHallOfFame(run, score));

    renderBest();
  }

  // ---------- SHARE ----------
  function currentPlayerName(){
    if(autoResolvedPlayerName) return autoResolvedPlayerName;
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
  // extra artwork needed (reuses the roster avatars). Shared by both the
  // SHARE button (green/lime theme)
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
    ctx.fillText('RINNE', W / 2, 130);
    ctx.fillStyle = '#8b9385';
    ctx.font = '30px sans-serif';
    ctx.fillText(golden ? 'HALL OF FAME' : 'RUN COMPLETE', W / 2, 172);

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

    y += 20;

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
      // King of the Hill only, how many Hill Challengers were beaten
      // defending the title, same rule as the Run Detail card above.
      ...(run.hillDefenses > 0 ? [['HILL DEFENSES', `${run.hillDefenses}`]] : []),
      ['CAUGHT', `${caughtCount(run)}`],
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
    ctx.fillText('RINNE', W / 2, H - 46);

    return canvas;
  }

  // Synchronous PNG Blob from an already-rendered canvas. canvas.toBlob() is
  // async (a callback/Promise), which would force an await before the
  // navigator.share() call in shareScoreCard() below — Safari/Chrome both
  // silently refuse a files-share() call that isn't tied directly to the
  // click that triggered it, so toDataURL() (synchronous) is decoded by
  // hand here instead.
  function canvasToBlobSync(canvas){
    const dataURL = canvas.toDataURL('image/png');
    const base64 = dataURL.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for(let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: 'image/png' });
  }

  function downloadCanvasPng(canvas, filename){
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  // ---------- SHARE OPTIONS POPUP ----------
  // The game's own public URL — used as the `u` param Facebook's sharer
  // requires (it ignores a bare text-only share).
  const GAME_SHARE_URL = 'https://playrinne.com/';

  // WhatsApp/X/Facebook's web share links can only carry text (+ a URL) —
  // none of them accept an attached local file that way, and Instagram has
  // no share-by-URL at all. The only path that actually hands the real card
  // image (plus the message) straight to one of those apps is the OS-level
  // share sheet (navigator.share with a `files` array) — that's why it's the
  // big primary button here whenever the device supports it, the user picks
  // WhatsApp/Instagram/whichever from the system's own picker and the image
  // travels with it. Everything under "More options" is the fallback for
  // when that's not available (mostly desktop browsers): copies the image to
  // the clipboard (plus downloads it as backup), then opens the app/site
  // with a message ready to post — the user pastes (Ctrl+V) the image in.
  //
  // The card image is built once, up front, as soon as this popup opens —
  // not inside the button click handlers. navigator.share({files}) has to
  // fire synchronously off the actual click event (no awaited work first),
  // or Safari/Chrome silently refuse it as no longer tied to a real user
  // gesture, so every click handler wired below only ever does synchronous
  // work up to that call.
  function openShareOptionsModal(run, score){
    const canNativeShare = !!navigator.canShare;
    const nativeBtn = document.getElementById('shareNativeBtn');
    const moreBtn = document.getElementById('shareMoreOptionsBtn');
    const grid = document.getElementById('shareOptionsGrid');
    const intro = document.getElementById('shareOptionsIntro');
    const status = document.getElementById('shareOptionsStatus');

    const targets = [
      { key:'whatsapp',  label:'WhatsApp' },
      { key:'twitter',   label:'X (Twitter)' },
      { key:'facebook',  label:'Facebook' },
      { key:'instagram', label:'Instagram' },
      { key:'download',  label:'Download Only' },
    ];
    grid.innerHTML = targets.map(t => `<button class="btn-ghost share-option-btn" data-key="${t.key}" disabled>${t.label}</button>`).join('');

    nativeBtn.style.display = canNativeShare ? 'block' : 'none';
    nativeBtn.disabled = true;
    nativeBtn.textContent = 'PREPARING IMAGE...';
    nativeBtn.onclick = null;
    moreBtn.textContent = 'MORE OPTIONS ▾';
    moreBtn.style.display = canNativeShare ? 'block' : 'none';
    moreBtn.onclick = () => {
      const showing = grid.style.display !== 'none';
      grid.style.display = showing ? 'none' : 'grid';
      moreBtn.textContent = showing ? 'MORE OPTIONS ▾' : 'MORE OPTIONS ▴';
    };
    intro.textContent = canNativeShare
      ? 'Share the image and your message together to any app installed on your device.'
      : 'Opens the app with a message ready to post — the image is copied to your clipboard, just paste it (Ctrl+V) in.';
    // No native share on this device — the individual platform buttons are
    // the only option, so show them directly instead of hiding them behind
    // a "More options" toggle that would otherwise have nothing above it.
    grid.style.display = canNativeShare ? 'none' : 'grid';

    status.textContent = 'Preparing your share image...';
    document.getElementById('shareOptionsModal').classList.add('active');

    buildResultCardCanvas(run, score, { golden:false }).then(canvas => {
      status.textContent = '';
      nativeBtn.disabled = false;
      nativeBtn.textContent = 'SHARE (IMAGE + MESSAGE)';
      nativeBtn.onclick = () => shareScoreCard(canvas, run, score);
      grid.querySelectorAll('.share-option-btn').forEach(btn => {
        btn.disabled = false;
        btn.onclick = () => handleShareOption(btn.dataset.key, canvas, run, score);
      });
    }).catch(e => {
      console.error(e);
      status.textContent = 'Could not build the share image.';
    });
  }

  function closeShareOptionsModal(){
    document.getElementById('shareOptionsModal').classList.remove('active');
  }

  // Single reusable native-share entry point for the end-of-run score card.
  // `canvas` must already be fully rendered (see openShareOptionsModal()) —
  // this function does no awaited work before the navigator.share() calls
  // below, since that's what keeps them tied to the click that invoked this.
  //
  // Three tiers, in order:
  //  1. navigator.share supports file attachments -> one native OS share
  //     sheet call with the image, message and game link together; the user
  //     picks WhatsApp/Instagram/whichever installed app from that picker.
  //  2. navigator.share exists but can't take files (rare) -> share just
  //     {text,url} through that same native sheet, and still copy the image
  //     to the clipboard so it's pasteable into whatever the sheet opens.
  //  3. No navigator.share at all (most desktop browsers) -> clipboard-copy
  //     the image plus a plain download as backup.
  //
  // X's own web compose box (twitter.com/intent/tweet) has no parameter for
  // attaching an image at all, regardless of any of this — that's a
  // restriction on X's side, not something the Web Share API changes, so
  // the clipboard-paste flow (tiers 2/3) is the practical ceiling there.
  function shareScoreCard(canvas, run, score){
    const status = document.getElementById('shareOptionsStatus');
    const shareText = run.champion
      ? `${currentPlayerName()} just became Pokémon Champion in Rinne with a score of ${score}!`
      : `${currentPlayerName()} scored ${score} in Rinne!`;
    const file = new File([canvasToBlobSync(canvas)], `rinne-run-${Date.now()}.png`, { type:'image/png' });

    if(navigator.canShare && navigator.canShare({ files:[file] })){
      navigator.share({ title:'Rinne run', text: shareText, url: GAME_SHARE_URL, files:[file] })
        .then(() => {
          status.textContent = 'Shared!';
          setTimeout(closeShareOptionsModal, 800);
        })
        .catch(e => {
          // AbortError just means the user closed the share sheet — not a failure.
          if(e && e.name === 'AbortError'){ status.textContent = ''; return; }
          console.error(e);
          downloadCanvasPng(canvas, file.name);
          status.textContent = "Couldn't open the share sheet, image downloaded instead.";
        });
      return;
    }

    if(navigator.share){
      navigator.share({ title:'Rinne run', text: shareText, url: GAME_SHARE_URL })
        .catch(e => { if(!e || e.name !== 'AbortError') console.error(e); });
    }
    copyImageToClipboard(canvasToBlobSync(canvas)).then(copied => {
      downloadCanvasPng(canvas, file.name);
      status.textContent = copied
        ? 'Image copied — paste it (Ctrl+V) wherever you share.'
        : "Your device can't share images directly — downloaded instead.";
    });
  }

  // The individual platform buttons (WhatsApp/X/Facebook/Instagram/Download)
  // never touch navigator.share — each just opens that platform's own web
  // compose link (synchronously, off the same click) and separately makes
  // the image available via clipboard-copy + download, since none of these
  // links accept an attached file.
  function handleShareOption(key, canvas, run, score){
    const status = document.getElementById('shareOptionsStatus');
    // Ends with the game's own link so whoever receives it can find their
    // way here. Instagram never gets this text at all — Story posting has
    // no caption field reachable via a web link, it's the image alone.
    const shareText = (run.champion
      ? `${currentPlayerName()} just became Pokémon Champion in Rinne with a score of ${score}!`
      : `${currentPlayerName()} scored ${score} in Rinne!`) + `\n\n${GAME_SHARE_URL}`;
    const fileName = `rinne-run-${Date.now()}.png`;

    if(key === 'whatsapp'){
      window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
    } else if(key === 'twitter'){
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`, '_blank');
    } else if(key === 'facebook'){
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(GAME_SHARE_URL)}&quote=${encodeURIComponent(shareText)}`, '_blank');
    }
    // Instagram/Download-only have no compose link to open — image only.

    downloadCanvasPng(canvas, fileName);
    copyImageToClipboard(canvasToBlobSync(canvas)).then(copied => {
      const pasteHint = copied ? 'Image copied — paste it (Ctrl+V) into' : 'Image downloaded — attach it in';
      if(key === 'whatsapp') status.textContent = `${pasteHint} WhatsApp.`;
      else if(key === 'twitter') status.textContent = `${pasteHint} X.`;
      else if(key === 'facebook') status.textContent = `${pasteHint} Facebook.`;
      else if(key === 'instagram') status.textContent = copied
        ? 'Image copied — open Instagram, start a Story and paste it in.'
        : 'Image downloaded — open Instagram and post it to your Story.';
      else status.textContent = copied ? 'Image downloaded and copied to clipboard.' : 'Image downloaded.';
    });
  }

  // Clipboard image writes need a secure context and (in most browsers) a
  // supporting ClipboardItem constructor — Safari in particular is picky
  // about the write happening promptly after the user's click. Never
  // throws: a share flow must still work via plain download if this fails.
  async function copyImageToClipboard(blob){
    if(!navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === 'undefined') return false;
    try{
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      return true;
    }catch(e){ return false; }
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
      link.download = `rinne-hall-of-fame-${Date.now()}.png`;
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
  // needing to earn that state through a normal run first. `customTeam`, when
  // given (see parseDevCustomTeam()), replaces the usual random 6-mon roll —
  // lets a specific Pokemon (e.g. one with a per-species ability quirk) be
  // tested at any stage instead of re-rolling until it happens to show up.
  function devSeedRun(customTeam, mode){
    // Defaults to Classic (full info, no Pro mystery cover) unless the dev
    // panel's mode selector asks for Pro/Nuzlocke specifically, e.g. to
    // reproduce a mode-specific bug.
    gameMode = mode || 'classic';
    const pool = POKEMON.filter(p => !p.legendary && p.id <= NATIONAL_DEX_MAX && !PARADOX_POKEMON.includes(p.name));
    const team = (customTeam && customTeam.length) ? customTeam : pickN(pool, 6);
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
      fishingBait: 5,
      megaStone: 1,
    };
    encounterNum = 1;
    runTrainersBeaten = 0;
    runBadges = 0;
    runChampion = false;
    runGoldEarned = 0;
    trainerLoss = null;
    trainerLossMon = null;
    legendaryHandled = false;
    mythicalHandled = false;
    top1Defeated = false;
    hillDefenses = 0;
    infiniteLoopTrainerNum = 0;
    pendingEvolution = null;
    runBeatenBadges = new Set();
    gymChoicePool = null;
    eliteIndex = 0;
    eliteUsedNames = new Set();
    hillChallengerUsedNames = new Set();
    seenWildNames = new Set();
    casinoTokens = 500;
    // false (not true) on purpose — a real run starts with these false too,
    // and leaving them false here lets a dev jump naturally hit every
    // bonus-encounter-wrapped screen (e.g. the "path opens"/Mythical bonus,
    // the Indigo Plateau stop before Elite Four) instead of always skipping
    // straight past them. Only the 'rival'/'pathOpens'/etc. jumps that route
    // through these PokeStop screens are affected — jumps that start a
    // battle directly (legendary, mythical, elite, ...) never check these.
    firstGymBonusEncounterUsed = false;
    legendaryBonusEncounterUsed = false;
    eliteBonusEncounterUsed = false;
    cruiseStageIndex = null;
    cruiseMiniEventUsed = { fishing:false };
    shopBoughtCounts = {};
    shopLifetimeBonus = {};
    itemsBought = {};
    itemsUsed = {};
    runStartedAt = Date.now();
    activePlaySec = 0;
    activeSegmentStartedAt = Date.now();
    hasComputerNotification = false;
    newArrivalNames = [];
    safariCatchCount = 0;
    fishingCatchCount = 0;
    fishingCastsLeft = BASE_FISHING_CASTS;
    cruiseEnded = false;
    evolvedSpeciesThisRun = new Set();
    evolvePityMisses = {};
    runCaughtLog = [];
    starterOriginalName = null;
    playerStatusEffectsApplied = 0;
    eliteGauntletFlawless = true;
    comebackKidAchieved = false;
    perfectCatcher = true;
    goldSpentOnSlots = 0;
  }

  // True only for a run started via devGodModeRun() below — guards the
  // result screen's "SAVE HIGHSCORE" flow (and the analytics ping) so a
  // fake instant-win test run can never reach the real leaderboard.
  let devGodModeRunActive = false;

  // Not a real species — never added to POKEMON, so it can never appear in
  // any wild-encounter/catch pool for an actual player, only ever exists as
  // a battler built directly here. `godmode: true` is read by
  // computeDamage()/maybeApplyMoveStatus()/applyEndOfTurnStatus() to take no
  // damage, take no status, and one-shot whatever it hits.
  function makeGodmodeMon(){
    return {
      name: 'missingno', types: ['normal'],
      hp: 1, attack: 999, defense: 999, sp_atk: 999, sp_def: 999, speed: 999,
      bst: 999, id: -1,
      godmode: true,
    };
  }

  // Dev-panel-only "clear the whole game fast" tool: a full run from the
  // very start (same screen flow a real player goes through — encounter,
  // gym, endgame, everything) but with a 6-mon team that can't take damage
  // or status and one-shots every opponent, so a full run down to Champion
  // takes minutes of clicking instead of real play. Gated behind the same
  // password-protected dev panel as devJump() — never reachable without it.
  function devGodModeRun(){
    gameMode = 'classic';
    devGodModeRunActive = true;
    const team = [makeGodmodeMon(), makeGodmodeMon(), makeGodmodeMon(), makeGodmodeMon(), makeGodmodeMon(), makeGodmodeMon()];
    starter = team[0];
    activeTeam = team;
    storage_ = [];
    META.gold = 999999;
    saveMeta();
    inv = {
      balls: 99, greatBalls: 99, ultraBalls: 99, masterBalls: 99,
      berrySnack: 99, pokeTreat: 99,
      potions: 99, revives: 99,
      rerollTickets: 99,
      fishingBait: 99,
      megaStone: 99,
    };
    encounterNum = 1;
    runTrainersBeaten = 0;
    runBadges = 0;
    runChampion = false;
    runGoldEarned = 0;
    trainerLoss = null;
    trainerLossMon = null;
    legendaryHandled = false;
    mythicalHandled = false;
    top1Defeated = false;
    hillDefenses = 0;
    infiniteLoopTrainerNum = 0;
    pendingEvolution = null;
    runBeatenBadges = new Set();
    gymChoicePool = null;
    eliteIndex = 0;
    eliteUsedNames = new Set();
    hillChallengerUsedNames = new Set();
    seenWildNames = new Set();
    casinoTokens = 999999;
    firstGymBonusEncounterUsed = false;
    legendaryBonusEncounterUsed = false;
    eliteBonusEncounterUsed = false;
    cruiseStageIndex = null;
    cruiseMiniEventUsed = { fishing:false };
    shopBoughtCounts = {};
    shopLifetimeBonus = {};
    itemsBought = {};
    itemsUsed = {};
    runStartedAt = Date.now();
    activePlaySec = 0;
    activeSegmentStartedAt = Date.now();
    hasComputerNotification = false;
    newArrivalNames = [];
    safariCatchCount = 0;
    fishingCatchCount = 0;
    fishingCastsLeft = BASE_FISHING_CASTS;
    cruiseEnded = false;
    evolvedSpeciesThisRun = new Set();
    evolvePityMisses = {};
    runCaughtLog = [];
    starterOriginalName = null;
    playerStatusEffectsApplied = 0;
    eliteGauntletFlawless = true;
    comebackKidAchieved = false;
    perfectCatcher = true;
    goldSpentOnSlots = 0;

    hideAllRunScreens();
    document.getElementById('startScreen').style.display = 'none';
    startEncounter();
  }

  // Species names typed into #devCustomTeamInput (one per line, commas also
  // accepted), resolved against POKEMON_BY_NAME — unknown names are dropped,
  // not fatal, so a typo just leaves a smaller/emptier team instead of
  // blocking the jump. `invalid` lists whatever didn't resolve, so the caller
  // can surface it instead of failing silently.
  function parseDevCustomTeam(raw){
    const names = (raw || '').split(/[\n,]/).map(s => s.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean);
    const team = [];
    const invalid = [];
    names.slice(0, MAX_PARTY_SIZE).forEach(name => {
      const mon = POKEMON_BY_NAME[name];
      if(mon) team.push(mon);
      else invalid.push(name);
    });
    return { team, invalid };
  }

  // Seeds a fresh run then jumps straight into the requested stage, reusing
  // the same screen-transition functions the normal game flow calls, so
  // nothing about the target screen's own logic needs duplicating here.
  // `customTeam`, when given, is threaded into devSeedRun() instead of its
  // usual random roll (see parseDevCustomTeam()). `mode`, when given,
  // overrides devSeedRun()'s Classic default, e.g. to test a Pro/Nuzlocke
  // specific bug through the dev panel.
  function devJump(kind, customTeam, mode){
    if(kind === 'homepage'){
      // Doesn't seed a fake run at all (unlike every other kind below), just
      // backs out of whatever screen the dev tools are currently on and
      // shows the real homepage, same as the "RUN IT BACK" button does.
      hideAllRunScreens();
      document.getElementById('resultScreen').classList.remove('active');
      document.getElementById('runDetailScreen').classList.remove('active');
      document.getElementById('fullRankingScreen').classList.remove('active');
      document.getElementById('startScreen').style.display = 'block';
      renderAbandonButton(null);
      renderGoldBadge();
      renderBest();
      return;
    }
    hideAllRunScreens();
    document.getElementById('startScreen').style.display = 'none';
    devSeedRun(customTeam, mode);
    // Battle-only jumps (legendary/cruise/mythical/rival/elite/champion)
    // never pass through checkpoint(), so default to hidden, same as any
    // other non-PokeStop screen, and let checkpoint() turn it on for the
    // jumps that do land on a checkpointed screen (encounter/gymSelect/pokestop).
    renderAbandonButton(null);

    if(kind === 'encounter'){
      startEncounter();
    } else if(kind === 'rivalCameo'){
      // Lands right on the Rival's route-7 cameo (see RIVAL_CAMEO_ENCOUNTER_NUM)
      // without needing to actually play through 6 prior encounters.
      encounterNum = RIVAL_CAMEO_ENCOUNTER_NUM;
      startTrainerBattle();
    } else if(kind === 'gymSelect'){
      pokestopMode = 'preGym';
      battle = { trainer: { name: 'Dev Trainer' } };
      openGymSelect();
    } else if(kind === 'pathOpens'){
      // Lands right on the post-8th-badge "THE PATH OPENS..." PokeStop —
      // the start of the reordered Mythical/Legendary story stretch, so it
      // can be replayed without beating 8 badges first.
      runBadges = BADGES_TO_UNLOCK_ENDGAME;
      battle = { trainer: { name: 'Dev Trainer', isGym: true } };
      openPokeStop('postGym');
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
    } else if(kind === 'indigoPlateau'){
      // Lands on the "last stop" PokeStop right before the Elite Four
      // gauntlet begins — same state the real flow reaches via the
      // bonus wild encounter right after the Rival Challenge win.
      runBadges = BADGES_TO_UNLOCK_ENDGAME;
      legendaryHandled = 'caught'; mythicalHandled = 'caught';
      cruiseStageIndex = null;
      eliteIndex = 0;
      eliteGauntletFlawless = true;
      openPokeStop('finalElitePrep');
    } else if(kind === 'elite'){
      runBadges = BADGES_TO_UNLOCK_ENDGAME;
      legendaryHandled = 'caught'; mythicalHandled = 'caught';
      eliteIndex = 0;
      startEliteBattle();
    } else if(kind === 'eliteFinal'){
      // Lands right after the last Elite Four member has already been
      // beaten, straight into the Champion Ending -> Hill transition.
      runBadges = BADGES_TO_UNLOCK_ENDGAME;
      legendaryHandled = 'caught'; mythicalHandled = 'caught';
      eliteIndex = ELITE_FOUR.length;
      runChampion = true;
      openChampionEnding();
    } else if(kind === 'champion'){
      runBadges = BADGES_TO_UNLOCK_ENDGAME;
      legendaryHandled = 'caught'; mythicalHandled = 'caught';
      eliteIndex = ELITE_FOUR.length;
      runChampion = true;
      openChampionEnding();
    } else if(kind === 'hill'){
      runBadges = BADGES_TO_UNLOCK_ENDGAME;
      legendaryHandled = 'caught'; mythicalHandled = 'caught';
      eliteIndex = ELITE_FOUR.length;
      runChampion = true;
      openHillIntro();
    } else if(kind === 'hillGodmode'){
      // Same landing spot as 'hill', but with a full godmode (one-shot,
      // untouchable) team instead of devSeedRun()'s normal roll — lets the
      // King of the Hill fight and the infinite loop after it be blown
      // through instantly for testing, without playing a real run first.
      const team = [makeGodmodeMon(), makeGodmodeMon(), makeGodmodeMon(), makeGodmodeMon(), makeGodmodeMon(), makeGodmodeMon()];
      starter = team[0];
      activeTeam = team;
      storage_ = [];
      runBadges = BADGES_TO_UNLOCK_ENDGAME;
      legendaryHandled = 'caught'; mythicalHandled = 'caught';
      eliteIndex = ELITE_FOUR.length;
      runChampion = true;
      openHillIntro();
    } else if(kind === 'infiniteLoop'){
      runBadges = BADGES_TO_UNLOCK_ENDGAME;
      legendaryHandled = 'caught'; mythicalHandled = 'caught';
      eliteIndex = ELITE_FOUR.length;
      runChampion = true;
      top1Defeated = true;
      inv.maxPotions = 3;
      openInfiniteLoopScreen();
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

  // Pauses/resumes the "Hours Played" active-time tracker (see
  // currentActivePlaySec()) whenever the tab is hidden/shown — a background
  // tab or a minimized/locked phone shouldn't keep racking up playtime.
  // Registered once, for the whole session, independent of whether a run is
  // even in progress yet (harmless either way, only ever read at the point
  // a run's duration is actually computed).
  document.addEventListener('visibilitychange', () => {
    if(document.hidden){
      activePlaySec = currentActivePlaySec();
      persistRunState(); // flush now — a closed tab right after this never gets another chance to save
    } else {
      activeSegmentStartedAt = Date.now();
    }
  });

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
    wireBattleLogHold();
    document.getElementById('startBtn').addEventListener('click', handleStartNewRunClick);
    document.getElementById('startNewRunConfirmYesBtn').addEventListener('click', confirmStartNewRun);
    document.getElementById('startNewRunConfirmCancelBtn').addEventListener('click', () => {
      document.getElementById('startNewRunConfirmModal').classList.remove('active');
    });
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
    document.getElementById('cruiseBoardingContinueBtn').addEventListener('click', confirmCruiseBoarding);
    document.getElementById('pokestopEndRunBtn').addEventListener('click', openEndRunModal);
    document.getElementById('shinyRevealCloseBtn').addEventListener('click', closeShinyRevealModal);
    document.getElementById('fishingCatchCloseBtn').addEventListener('click', closeFishingCatchModal);
    document.getElementById('endRunConfirmBtn').addEventListener('click', confirmEndRun);
    document.getElementById('endRunCancelBtn').addEventListener('click', closeEndRunModal);
    document.getElementById('pvpEndBattleBtn').addEventListener('click', () => {
      document.getElementById('pvpEndBattleModal').classList.add('active');
    });
    document.getElementById('pvpEndBattleCancelBtn').addEventListener('click', () => {
      document.getElementById('pvpEndBattleModal').classList.remove('active');
    });
    document.getElementById('pvpEndBattleConfirmBtn').addEventListener('click', () => {
      document.getElementById('pvpEndBattleModal').classList.remove('active');
      forfeitPvpBattle();
    });
    document.getElementById('pokestopComputerBtn').addEventListener('click', openTeamManagement);
    document.getElementById('megaStoneHintClose').addEventListener('click', () => {
      document.getElementById('megaStoneHintPopup').style.display = 'none';
    });
    document.getElementById('megaFormChoiceCancelBtn').addEventListener('click', closeMegaFormChoice);
    document.getElementById('shareOptionsCancelBtn').addEventListener('click', closeShareOptionsModal);
    document.getElementById('gymWinContinueBtn').addEventListener('click', closeGymWinModal);
    document.getElementById('specialCaughtContinueBtn').addEventListener('click', closeSpecialCaughtModal);
    document.getElementById('megaEvolutionContinueBtn').addEventListener('click', closeMegaEvolutionModal);
    document.getElementById('absolSenseContinueBtn').addEventListener('click', closeAbsolSenseModal);
    document.getElementById('pokedexCloseBtn').addEventListener('click', closePokedex);
    document.getElementById('pokestopCasinoBtn').addEventListener('click', openPokestopCasino);
    document.getElementById('teamBackBtn').addEventListener('click', closeTeamManagement);
    document.getElementById('gymSelectBackBtn').addEventListener('click', closeGymSelect);
    document.getElementById('viewFullRankingBtn').addEventListener('click', openFullRanking);
    document.getElementById('abandonRunBtn').addEventListener('click', openEndRunModal);
    document.getElementById('reportBugBtn').addEventListener('click', openReportBugModal);
    document.getElementById('reportBugCloseBtn').addEventListener('click', closeReportBugModal);
    document.getElementById('reportBugSubmitBtn').addEventListener('click', submitBugReport);
    document.getElementById('legendaryBeginBtn').addEventListener('click', confirmLegendaryTeam);
    document.getElementById('devJumpBtn').addEventListener('click', () => {
      const statusEl = document.getElementById('devCustomTeamStatus');
      const { team, invalid } = parseDevCustomTeam(document.getElementById('devCustomTeamInput').value);
      statusEl.textContent = invalid.length ? `Not found, skipped: ${invalid.join(', ')}` : '';
      const modeSel = document.getElementById('devModeSelect');
      devJump(document.getElementById('devJumpSelect').value, team, modeSel ? modeSel.value : null);
    });
    const godModeBtn = document.getElementById('devGodModeBtn');
    if(godModeBtn) godModeBtn.addEventListener('click', devGodModeRun);
    if(new URLSearchParams(location.search).get('dev') === '1'){
      tryUnlockDevMode();
    }
    renderGoldBadge();
    loadNewsPreview();
    initAuthWidget();

    // Resolved before the save check below, so a signed-out (or differently
    // signed-in) player never gets offered someone else's local save on this
    // device — see cachedAuthUserId's own comment. initAuthWidget() also
    // fetches the session for its own label rendering, but that's fire-and-
    // forget, not guaranteed to land before this runs.
    try{
      const { data: { session } } = await supabaseClient.auth.getSession();
      cachedAuthUserId = session?.user?.id || null;
      cachedPlayerDisplayName = null;
      if(cachedAuthUserId){
        const { data } = await supabaseClient.from('profiles').select('game_name').eq('user_id', cachedAuthUserId).maybeSingle();
        cachedPlayerDisplayName = data?.game_name || null;
      }
    }catch(e){ cachedAuthUserId = null; cachedPlayerDisplayName = null; }

    // Always show the homepage/ranking first instead of auto-resuming
    // straight into a saved run — an active run (local or cloud) just adds
    // a "Continue Run" button under Start, see showContinueRunButton().
    renderBest();

    // Reached from profile.html's "Challenge" button (index.html?pvp=
    // <friendUserId>). Read once and immediately scrub it from the address
    // bar (history.replaceState, no reload) — otherwise the URL keeps
    // carrying the challenge forever, and anything that re-runs this init
    // logic later without a fresh navigation (a page reload, a shared
    // device where a different account signs in on the same tab, the link
    // getting bookmarked/shared) would silently re-fire someone else's
    // battle. Only the person who actually clicked Challenge, in the
    // moment they clicked it, ever sees this.
    const pvpChallengeId = new URLSearchParams(window.location.search).get('pvp');
    if(pvpChallengeId){
      const url = new URL(window.location.href);
      url.searchParams.delete('pvp');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }

    const { anyLocalSave, cloudOffered } = await refreshContinueRunOffer();
    if(!anyLocalSave && !cloudOffered){
      // Only fires here, on a genuinely clean homepage with no saved run at
      // all (not even one belonging to someone else on this device) and no
      // cloud checkpoint to resume, so a PvP exhibition fight can never
      // interrupt or overwrite real run progress.
      if(pvpChallengeId) startPvpChallenge(pvpChallengeId);
    }
  }

  document.addEventListener('DOMContentLoaded', init);

})();
