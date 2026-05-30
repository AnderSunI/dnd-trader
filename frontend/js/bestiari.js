// ============================================================
// frontend/js/bestiari.js
// Bestiari / Энциклопедия D&D Trader
// - local-first база знаний по монстрам, богам, лору, механикам,
//   заклинаниям, предметам, классам, монстрам и прочим сущностям D&D
// - подготовлено под загрузку JSON / API, включая preserve-first бестиарий DnD.su
// - подробные карточки, кнопка полного описания и полного статблока
// ============================================================

const BESTIARI_STATE = {
  loaded: false,
  source: "empty",
  role: "player",
  query: "",
  category: "all",
  selectedId: "",
  entries: [],
  showFullDescription: false,
  showFullStats: false,
  editorOpen: false,
  importOpen: false,
  editorMode: "create",
  draft: null,
  sidebarScrollTop: 0,
  detailScrollTop: 0,
  modalScrollTop: 0,
  searchRenderTimer: null,
};

const BESTIARI_CATEGORY_LABELS = {
  all: "Всё",
  monsters: "Монстры",
  gods: "Боги",
  lore: "Лор",
  mechanics: "Механики",
  spells: "Заклинания",
  items: "Предметы",
  feats: "Черты",
  classes: "Классы",
  subclasses: "Подклассы",
  races: "Расы",
  factions: "Фракции",
  locations: "Локации",
  events: "События",
  conditions: "Состояния",
};

const BESTIARI_STORAGE_PREFIX = "dnd_trader_bestiari_";

const BESTIARI_MONSTER_SEED_URLS = [
  "/static/data/bestiary_bestiari_preview.json",
  "/static/data/bestiary_normalized_round1.json",
  "/static/bestiary_bestiari_preview.json",
  "/data/bestiary_bestiari_preview.json",
];

const BESTIARI_DEITY_SEED_URLS = [
  "/static/data/deities_normalized_round1_v2_clean.json",
  "/static/data/deities_rpg_fandom_round1_normalized_clean.json",
  "/static/deities_normalized_round1_v2_clean.json",
  "/data/deities_normalized_round1_v2_clean.json",
];

const BESTIARI_RACE_SEED_URLS = [
  "/static/data/races_bestiari_preview.json",
  "/static/data/races_normalized_round1.json",
  "/static/races_bestiari_preview.json",
  "/data/races_bestiari_preview.json",
];

const BESTIARI_CLASS_SEED_URLS = [
  "/static/data/classes_bestiari_preview.json",
  "/static/data/classes_normalized_round1.json",
  "/static/classes_bestiari_preview.json",
  "/data/classes_bestiari_preview.json",
];

const BESTIARI_FACTION_SEED_URLS = [
  "/static/data/factions_bestiari_preview.json",
  "/static/factions_bestiari_preview.json",
  "/data/factions_bestiari_preview.json",
];

const BESTIARI_CONDITION_SEED_URLS = [
  "/static/data/conditions_bestiari_preview.json",
  "/static/conditions_bestiari_preview.json",
  "/data/conditions_bestiari_preview.json",
];

const BESTIARI_MECHANIC_SEED_URLS = [
  "/static/data/mechanics_bestiari_preview.json",
  "/static/mechanics_bestiari_preview.json",
  "/data/mechanics_bestiari_preview.json",
];

const BESTIARI_LORE_SEED_URLS = [
  "/static/data/lore_bestiari_preview.json",
  "/static/lore_bestiari_preview.json",
  "/data/lore_bestiari_preview.json",
];

const BESTIARI_LOCATION_SEED_URLS = [
  "/static/data/locations_bestiari_preview.json",
  "/static/locations_bestiari_preview.json",
  "/data/locations_bestiari_preview.json",
];

const BESTIARI_SPELL_SEED_URLS = [
  "/static/data/spells_bestiari_preview.json",
  "/static/spells_bestiari_preview.json",
  "/data/spells_bestiari_preview.json",
];

const BESTIARI_FEAT_SEED_URLS = [
  "/static/data/feats_bestiari_preview.json",
  "/static/feats_bestiari_preview.json",
  "/data/feats_bestiari_preview.json",
];

const BESTIARI_ITEM_SEED_URLS = [
  "/static/data/phb_items_bestiari_preview.json",
  "/static/data/phb_items_normalized_round1.json",
  "/static/phb_items_bestiari_preview.json",
  "/data/phb_items_bestiari_preview.json",
];

const BESTIARI_MAGIC_ITEM_SEED_URLS = [
  "/static/data/dndsu_magic_items_bestiari_preview.json",
  "/static/data/dndsu_magic_items_normalized_round1.json",
  "/static/dndsu_magic_items_bestiari_preview.json",
  "/data/dndsu_magic_items_bestiari_preview.json",
];

const BESTIARI_DEFAULT_ENTRIES = [
  {
    id: "monster-goblin",
    category: "monsters",
    title: "Гоблин",
    subtitle: "Маленький гуманоид, нейтрально-злой",
    tags: ["монстр", "низкий CR", "засады"],
    source: "SRD / seed",
    summary:
      "Мелкий, подлый и опасный в группе противник, который полагается на численность, укрытия и грязные трюки.",
    body: [
      "Гоблины хороши как базовый враг ранней кампании, как дозорные, лазутчики, мародёры и часть более крупных враждебных фракций.",
      "Для ГМа это удобная сущность для настройки сложности: меняя экипировку, местность и поддержку, можно легко менять ощущение боя без полной замены монстра.",
    ],
    full_description: [
      "Гоблины редко действуют честно. Они ценят выживание выше славы и предпочитают удары из тени, ловушки, натравливание зверья и отступление туда, где их трудно преследовать.",
      "В лоре они полезны не только как 'мелкие враги', но и как индикатор того, насколько территория стала небезопасной: где появляются гоблины, там часто слабая власть, раздробленное пограничье или более страшная сила за спиной.",
    ],
    related: ["faction-tribes", "mechanic-advantage"],
    player_visible: true,
    gm_only: false,
    statblock: {
      level_like: "CR 1/4",
      size: "Маленький",
      type: "Гуманоид (гоблиноид)",
      alignment: "Нейтрально-злой",
      ac: "15 (кожаный доспех, щит)",
      hp: "7 (2к6)",
      speed: "30 фт",
      initiative: "+2",
      proficiency_bonus: "+2",
      abilities: {
        str: 8,
        dex: 14,
        con: 10,
        int: 10,
        wis: 8,
        cha: 8,
      },
      skills: ["Скрытность +6", "Атлетика +2"],
      senses: ["Тёмное зрение 60 фт", "Пассивное восприятие 9"],
      languages: ["Общий", "Гоблинский"],
      traits: [
        {
          name: "Проворный побег",
          text: "Гоблин может совершить Отход или Засаду бонусным действием в каждый свой ход.",
        },
      ],
      actions: [
        {
          name: "Ятаган",
          text: "Рукопашная атака оружием: +4 к попаданию, досягаемость 5 фт, одна цель. Попадание: 5 (1к6 + 2) рубящего урона.",
        },
        {
          name: "Короткий лук",
          text: "Дальнобойная атака оружием: +4 к попаданию, дистанция 80/320 фт, одна цель. Попадание: 5 (1к6 + 2) колющего урона.",
        },
      ],
    },
  },
  {
    id: "god-mystra",
    category: "gods",
    title: "Мистра",
    subtitle: "Божество магии во Forgotten Realms",
    tags: ["бог", "магия", "лорд лора"],
    source: "Forgotten Realms",
    summary:
      "Мистра связана с Плетением — самой тканью магии, через которую большинство смертных взаимодействуют с арканой.",
    body: [
      "Карточка божества в bestiari нужна не только для справки, но и как узел связей: храмы, культы, враги, запреты, артефакты и заклинания.",
    ],
    full_description: [
      "В магических кампаниях Мистра полезна как глобальная опорная точка мира. Через неё удобно объяснять нестабильность магии, ограничения арканы, катастрофы Плетения и культурное отношение к волшебству.",
      "Такую запись можно в будущем связывать с персонажами-магами, организациями, запретными школами магии и историческими событиями.",
    ],
    related: ["spell-fireball", "class-wizard"],
    player_visible: true,
    gm_only: false,
    info_panels: [
      { label: "Сфера влияния", value: "Магия, Плетение, аркана" },
      { label: "Мир", value: "Forgotten Realms" },
      { label: "Тип записи", value: "Божество" },
    ],
  },
  {
    id: "mechanic-advantage",
    category: "mechanics",
    title: "Преимущество и помеха",
    subtitle: "Базовая механика модификации броска d20",
    tags: ["механика", "ядро правил", "d20"],
    source: "PHB / SRD",
    summary:
      "Когда у существа есть преимущество, оно бросает d20 дважды и берёт лучший результат. При помехе — худший.",
    body: [
      "Эта карточка нужна отдельно от монстров и предметов, потому что игрок часто ищет именно правило, а не сущность мира.",
    ],
    full_description: [
      "Преимущество и помеха — одна из самых удобных для игрока систем модификации броска, потому что она не требует постоянного суммирования чисел. В bestiari это должна быть самостоятельная запись механики с короткой формулировкой, примерами и связанными сущностями.",
    ],
    related: ["monster-goblin"],
    player_visible: true,
    gm_only: false,
    mechanics: {
      short_rules: [
        "Преимущество: брось 2d20, возьми лучший.",
        "Помеха: брось 2d20, возьми худший.",
        "Несколько источников преимущества не складываются так же, как и несколько источников помехи.",
      ],
      examples: [
        "Невидимость может дать преимущество на атаку.",
        "Стрельба по цели в сильном укрытии может наложить помеху.",
      ],
    },
  },
  {
    id: "spell-fireball",
    category: "spells",
    title: "Огненный шар",
    subtitle: "3 круг, мощное заклинание области",
    tags: ["заклинание", "огонь", "урон"],
    source: "PHB",
    summary:
      "Классическое арканное заклинание, наносящее сильный урон по области и задающее тон боевой магии среднего уровня.",
    body: [
      "Это хороший пример карточки заклинания, где игроку нужна не только формула, но и понятное краткое объяснение назначения.",
    ],
    full_description: [
      "Заклинание создаёт взрыв огня в точке на дистанции и хорошо показывает философию арканного контроля пространства. В справочнике такую запись удобно связывать с классами, школой магии, типом урона, божествами магии и предметами, усиливающими огонь.",
    ],
    related: ["god-mystra", "class-wizard"],
    player_visible: true,
    gm_only: false,
    spell_data: {
      level: "3 круг",
      school: "Воплощение",
      casting_time: "1 действие",
      range: "150 фт",
      components: "В, С, М",
      duration: "Мгновенно",
      ritual: false,
      concentration: false,
      classes: ["Волшебник", "Чародей"],
      damage: "8к6 огнём",
      save: "Ловкость",
      higher_levels: "Урон увеличивается на 1к6 за каждый уровень ячейки выше 3.",
    },
  },
  {
    id: "item-bag-of-holding",
    category: "items",
    title: "Сумка хранения",
    subtitle: "Знаковый магический утилитарный предмет",
    tags: ["предмет", "магия", "инвентарь"],
    source: "DMG",
    summary:
      "Один из самых узнаваемых магических предметов, полезный и для игроков, и для экономики кампании.",
    body: [
      "Для D&D Trader эта запись особенно важна, потому что её можно напрямую связывать с логикой инвентаря, экипировки, торговцев и механиками хранения.",
    ],
    full_description: [
      "Такой предмет в bestiari — это уже не просто лорный текст, а карточка предмета со свойствами, условиями использования, возможными рисками и ссылками на смежные правила. Именно под это потом удобно подтягивать базу предметов из JSON и каноничных источников.",
    ],
    related: ["mechanic-advantage"],
    player_visible: true,
    gm_only: false,
    item_data: {
      rarity: "Необычный",
      type: "Чудесный предмет",
      slot: "Инвентарь / контейнер",
      attunement: "Не требуется",
      weight_lb: "15",
      value_gp: "—",
      properties: [
        "Вмещает существенно больше, чем выглядит снаружи",
        "Связана с темой переноски и логистики партии",
      ],
    },
  },
  {
    id: "class-wizard",
    category: "classes",
    title: "Волшебник",
    subtitle: "Арканный заклинатель, строящий силу на знаниях",
    tags: ["класс", "магия", "интеллект"],
    source: "PHB",
    summary:
      "Класс с широким доступом к заклинаниям, сильной связью с книгой заклинаний и высокой гибкостью подготовки.",
    body: [
      "В будущем такая запись должна уметь тянуть подклассы, прогрессию, базовые умения, рекомендуемые предметы и связанные механики.",
    ],
    related: ["spell-fireball", "god-mystra"],
    player_visible: true,
    gm_only: false,
    class_data: {
      hit_die: "к6",
      primary_ability: "Интеллект",
      proficiencies: ["Кинжалы", "Дротики", "Пращи", "Посохи", "Лёгкие арбалеты"],
      saves: ["Интеллект", "Мудрость"],
      core_features: ["Колдовство", "Восстановление заклинаний", "Книга заклинаний"],
    },
  },
  {
    id: "lore-spellplague",
    category: "lore",
    title: "Spellplague",
    subtitle: "Исторический катаклизм, связанный с магией",
    tags: ["лор", "история", "магия"],
    source: "Forgotten Realms",
    summary:
      "Пример большой лорной записи, где игроку нужен и короткий обзор, и возможность раскрыть длинный текст.",
    body: [
      "Катастрофы такого масштаба лучше хранить как отдельные сущности, а не как абзац внутри случайной статьи, потому что потом на них можно ссылаться из богов, локаций, классов и исторических записей.",
    ],
    full_description: [
      "Большие лорные записи должны поддерживать режим 'читать дальше', потому что игроку не всегда нужен весь текст сразу. Иногда он хочет только краткое объяснение, а иногда — полноценную историческую справку с последствиями, ключевыми участниками и влиянием на современный мир.",
      "Под такой формат bestiari удобно тянуть и самодельный лор кампании, и каноничный сеттинговый материал, не смешивая всё в одну бесконечную заметку.",
    ],
    related: ["god-mystra"],
    player_visible: true,
    gm_only: false,
  },
];

function getEl(id) {
  return document.getElementById(id);
}

function showToast(message) {
  if (typeof window.showToast === "function") {
    window.showToast(message);
    return;
  }
  console.log(message);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeText(value, fallback = "") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeRole(role) {
  const raw = String(role || "").trim().toLowerCase();
  return raw === "gm" || raw === "admin" ? "gm" : "player";
}

function getCurrentRole() {
  return normalizeRole(
    window.__appUserRole ||
      window.__userRole ||
      window.__appUser?.role ||
      document.body?.dataset?.role ||
      "player"
  );
}

function getCurrentUser() {
  return window.__appUser || null;
}

function getStorageKey() {
  const user = getCurrentUser();
  const userKey = user?.email || user?.id || (localStorage.getItem("token") ? "auth-user" : "guest");
  return `${BESTIARI_STORAGE_PREFIX}${userKey}`;
}

function getHeaders(withJson = false) {
  const headers = {};
  const token = localStorage.getItem("token") || "";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (withJson) headers["Content-Type"] = "application/json";
  return headers;
}

async function apiGet(urls) {
  const list = Array.isArray(urls) ? urls : [urls];
  for (const url of list) {
    try {
      const res = await fetch(url, { headers: getHeaders() });
      if (!res.ok) continue;
      return await res.json();
    } catch (_) {}
  }
  return null;
}

function makeId(prefix = "entry") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function normalizeTextBlock(value) {
  if (value === null || value === undefined || value === "") return [];

  if (Array.isArray(value)) {
    return value
      .flatMap((item) => normalizeTextBlock(item))
      .map((item) => String(item || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((item) => !/^\[object Object\]$/i.test(item));
  }

  if (typeof value === "object") {
    const candidates = [];

    if (value.raw_text !== undefined) candidates.push(value.raw_text);
    if (value.mechanics_text !== undefined) candidates.push(value.mechanics_text);
    if (value.summary !== undefined) candidates.push(value.summary);
    if (value.text !== undefined) candidates.push(value.text);
    if (value.description !== undefined) candidates.push(value.description);
    if (value.body !== undefined) candidates.push(value.body);
    if (value.full_description !== undefined) candidates.push(value.full_description);
    if (value.paragraphs !== undefined) candidates.push(value.paragraphs);
    if (value.lines !== undefined) candidates.push(value.lines);
    if (value.short_rules !== undefined) candidates.push(value.short_rules);
    if (value.rules !== undefined) candidates.push(value.rules);

    if (value.section_buckets && typeof value.section_buckets === "object") {
      for (const bucket of Object.values(value.section_buckets)) {
        if (Array.isArray(bucket)) candidates.push(bucket);
        else if (bucket && typeof bucket === "object") {
          if (bucket.raw_lines !== undefined) candidates.push(bucket.raw_lines);
          if (bucket.lines !== undefined) candidates.push(bucket.lines);
          if (bucket.text !== undefined) candidates.push(bucket.text);
        }
      }
    }

    return candidates
      .flatMap((item) => normalizeTextBlock(item))
      .map((item) => String(item || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((item) => !/^\[object Object\]$/i.test(item));
  }

  return String(value || "")
    .split(/\n{2,}|\r?\n/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((item) => !/^\[object Object\]$/i.test(item));
}

function parseKeyValueLines(value) {
  const lines = normalizeTextBlock(value);
  const map = {};
  for (const line of lines) {
    const [key, ...rest] = line.split(":");
    if (!key || !rest.length) continue;
    map[key.trim().toLowerCase()] = rest.join(":").trim();
  }
  return map;
}

function normalizeAbilityScoreValue(value, fallback = 10) {
  if (value && typeof value === "object") {
    const score = value.score ?? value.value ?? value.base ?? value.raw;
    const num = Number(String(score).match(/\d{1,2}/)?.[0] ?? score);
    return Number.isFinite(num) ? num : fallback;
  }
  const num = Number(String(value ?? "").match(/\d{1,2}/)?.[0] ?? value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeAbilities(raw = {}) {
  const source = raw || {};
  const fromLines = typeof raw === "string" ? parseKeyValueLines(raw) : {};
  const getValue = (keys, fallback = 10) => {
    for (const key of keys) {
      const direct = source[key];
      if (direct !== undefined && direct !== null && direct !== "") {
        return normalizeAbilityScoreValue(direct, fallback);
      }
      const lineVal = fromLines[key];
      if (lineVal !== undefined) {
        return normalizeAbilityScoreValue(lineVal, fallback);
      }
    }
    return fallback;
  };
  return {
    str: getValue(["str", "strength", "сила", "сил"]),
    dex: getValue(["dex", "dexterity", "ловкость", "лов"]),
    con: getValue(["con", "constitution", "телосложение", "тел"]),
    int: getValue(["int", "intelligence", "интеллект", "инт"]),
    wis: getValue(["wis", "wisdom", "мудрость", "мдр"]),
    cha: getValue(["cha", "charisma", "харизма", "хар"]),
  };
}

function normalizeMonsterNamedEntries(value, fallbackName = "Элемент") {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string") return item;
      const name = safeText(item?.name || item?.title || fallbackName);
      const text = safeText(item?.text || item?.body || item?.description || item?.raw_text || "");
      return {
        ...item,
        name,
        text,
      };
    }).filter((item) => typeof item === "string" ? item.trim() : (item.name || item.text));
  }
  return normalizeTextBlock(value).map((text) => ({ name: fallbackName, text }));
}

function normalizeStatblock(raw = null) {
  if (!raw || typeof raw !== "object") return null;

  const sta = raw.size_type_alignment && typeof raw.size_type_alignment === "object"
    ? raw.size_type_alignment
    : {};
  const challenge = raw.challenge && typeof raw.challenge === "object"
    ? raw.challenge
    : {};

  const meaningfulKeys = [
    "level_like", "cr", "challenge_rating", "challenge", "size", "type", "alignment", "size_type_alignment",
    "ac", "armor_class", "hp", "hit_points", "speed", "initiative", "proficiency_bonus", "pb",
    "abilities", "stats", "saves", "saving_throws", "skills", "senses", "languages",
    "vulnerabilities", "damage_vulnerabilities", "resistances", "damage_resistances", "immunities", "damage_immunities", "conditions_immunity", "condition_immunities",
    "traits", "actions", "bonus_actions", "reactions", "legendary_actions", "mythic_actions", "lair_actions", "lair_effects", "regional_effects",
  ];
  const hasMeaningfulData = meaningfulKeys.some((key) => {
    const value = raw[key];
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return String(value ?? "").trim().length > 0;
  });
  if (!hasMeaningfulData) return null;

  const challengeValue = safeText(challenge.value || raw.cr || raw.challenge_rating || raw.level_like);
  const xp = safeText(challenge.xp || challenge.experience || "");
  const abilities = raw.abilities || raw.stats ? normalizeAbilities(raw.abilities || raw.stats || {}) : null;

  return {
    level_like: safeText(raw.level_like || (challengeValue ? `CR ${challengeValue}` : raw.cr || raw.challenge_rating)),
    cr: challengeValue,
    xp,
    size: safeText(raw.size || sta.size),
    type: safeText(raw.type || sta.type),
    alignment: safeText(raw.alignment || sta.alignment),
    size_type_raw: safeText(sta.raw),
    ac: safeText(raw.ac || raw.armor_class),
    hp: safeText(raw.hp || raw.hit_points),
    speed: safeText(raw.speed),
    initiative: safeText(raw.initiative),
    proficiency_bonus: safeText(raw.proficiency_bonus || raw.pb),
    abilities,
    saves: normalizeTextBlock(raw.saves || raw.saving_throws),
    skills: normalizeTextBlock(raw.skills),
    senses: normalizeTextBlock(raw.senses),
    languages: normalizeTextBlock(raw.languages),
    vulnerabilities: normalizeTextBlock(raw.vulnerabilities || raw.damage_vulnerabilities),
    resistances: normalizeTextBlock(raw.resistances || raw.damage_resistances),
    immunities: normalizeTextBlock(raw.immunities || raw.damage_immunities),
    conditions_immunity: normalizeTextBlock(raw.conditions_immunity || raw.condition_immunities),
    traits: normalizeMonsterNamedEntries(raw.traits, "Особенность"),
    actions: normalizeMonsterNamedEntries(raw.actions, "Действие"),
    bonus_actions: normalizeMonsterNamedEntries(raw.bonus_actions, "Бонусное действие"),
    reactions: normalizeMonsterNamedEntries(raw.reactions, "Реакция"),
    legendary_actions: normalizeMonsterNamedEntries(raw.legendary_actions, "Легендарное действие"),
    mythic_actions: normalizeMonsterNamedEntries(raw.mythic_actions, "Мифическое действие"),
    lair_actions: normalizeMonsterNamedEntries(raw.lair_actions, "Действие логова"),
    lair_effects: normalizeMonsterNamedEntries(raw.lair_effects, "Эффект логова"),
    regional_effects: normalizeMonsterNamedEntries(raw.regional_effects, "Региональный эффект"),
  };
}

function normalizeEntry(raw = {}) {
  const category = Object.prototype.hasOwnProperty.call(BESTIARI_CATEGORY_LABELS, raw.category)
    ? raw.category
    : "lore";

  return {
    id: safeText(raw.id, makeId(category)),
    category,
    title: safeText(raw.title, "Без названия"),
    subtitle: safeText(raw.subtitle),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String).filter(Boolean) : splitCsv(raw.tags),
    source: safeText(raw.source),
    source_url: safeText(raw.source_url || raw.sourceUrl || raw.url),
    summary: safeText(raw.summary),
    body: normalizeTextBlock(raw.body),
    full_description: normalizeTextBlock(raw.full_description || raw.fullBody || raw.long_text),
    related: Array.isArray(raw.related) ? raw.related.map(String).filter(Boolean) : splitCsv(raw.related),
    player_visible: raw.player_visible !== false,
    gm_only: raw.gm_only === true,
    info_panels: Array.isArray(raw.info_panels) ? raw.info_panels : [],
    statblock: normalizeStatblock(raw.statblock),
    spell_data: raw.spell_data && typeof raw.spell_data === "object" ? raw.spell_data : null,
    item_data: raw.item_data && typeof raw.item_data === "object" ? raw.item_data : null,
    class_data: raw.class_data && typeof raw.class_data === "object" ? raw.class_data : null,
    mechanics: raw.mechanics && typeof raw.mechanics === "object" ? raw.mechanics : null,
    monster_data: raw.monster_data && typeof raw.monster_data === "object" ? raw.monster_data : null,
    deity_data: raw.deity_data && typeof raw.deity_data === "object" ? raw.deity_data : null,
    race_data: raw.race_data && typeof raw.race_data === "object" ? raw.race_data : null,
    review_status: safeText(raw.review_status || raw.reviewStatus),
    review: raw.review && typeof raw.review === "object" ? raw.review : null,
    quality: raw.quality && typeof raw.quality === "object" ? raw.quality : null,
    section_buckets: raw.section_buckets && typeof raw.section_buckets === "object" ? raw.section_buckets : null,
    site_noise_lines: Array.isArray(raw.site_noise_lines) ? raw.site_noise_lines.map(String).filter(Boolean) : [],
    classification_flags: Array.isArray(raw.classification_flags) ? raw.classification_flags.map(String).filter(Boolean) : [],
    raw_fields: raw.raw_fields && typeof raw.raw_fields === "object" ? raw.raw_fields : null,
  };
}

function compactList(value, limit = 0) {
  const arr = Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : splitCsv(value);
  const safe = limit > 0 ? arr.slice(0, limit) : arr;
  return safe.join(", ");
}

function normalizeSourceToString(source) {
  if (!source) return "";
  if (typeof source === "string") return source;
  if (typeof source === "object") {
    return [source.site, source.page_title, source.url].filter(Boolean).join(" / ");
  }
  return String(source);
}

function cleanDraftSummary(value, fallback = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.includes("Черновая карточка божества")) return fallback;
  return text;
}

function splitLoreParagraphs(value, fallback = "") {
  const text = cleanDraftSummary(value, fallback);
  if (!text) return [];

  const sentences = text.split(/(?<=[.!?…])\s+/).map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + " " + sentence).trim().length <= 520) {
      current = (current + " " + sentence).trim();
    } else {
      if (current) chunks.push(current);
      current = sentence;
    }
  }

  if (current) chunks.push(current);
  return chunks.length ? chunks.slice(0, 4) : [text];
}

function shortenForSummary(value, maxLength = 260) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

const BESTIARI_VALUE_LABELS = {
  lawful_good: "законно-добрый",
  neutral_good: "нейтрально-добрый",
  chaotic_good: "хаотично-добрый",
  lawful_neutral: "законно-нейтральный",
  neutral: "нейтральный",
  chaotic_neutral: "хаотично-нейтральный",
  lawful_evil: "законно-злой",
  neutral_evil: "нейтрально-злой",
  chaotic_evil: "хаотично-злой",
  needs_rewrite: "требует вычитки",
  forgotten_realms: "Забытые Королевства",
  deity_fields: "поля божества",
  domains_are_legacy_or_mixed: "домены источника не 5e",
  domains_need_manual_5e_mapping: "домены требуют ручной сверки",
  alignment_matrix_detected: "мировоззрение требует сверки",
  needs_manual_alignment: "мировоззрение требует ручной сверки",
  missing_or_weak_intro_summary: "описание требует выжимки",
  knowledge: "Знание",
  arcana: "Аркана",
  life: "Жизнь",
  light: "Свет",
  nature: "Природа",
  tempest: "Буря",
  trickery: "Обман",
  war: "Война",
  death: "Смерть",
  forge: "Кузня",
  grave: "Могила",
  order: "Порядок",
  peace: "Мир",
  twilight: "Сумерки",
};

function localizeCodexValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return BESTIARI_VALUE_LABELS[raw] || raw.replaceAll("_", " ");
}

function localizeDomainList(value) {
  const arr = Array.isArray(value) ? value : splitCsv(value);
  return arr.map((item) => localizeCodexValue(item)).filter(Boolean).join(", ");
}

function uniqueCompactValues(values = [], limit = 8) {
  const out = [];
  for (const value of values) {
    const clean = String(value || "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    if (!out.some((item) => item.toLowerCase() === clean.toLowerCase())) out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}

function getDeityPublicTags(entry, limit = 6) {
  const data = entry?.deity_data || {};
  const values = [
    ...(Array.isArray(data.portfolio) ? data.portfolio : []),
    ...(Array.isArray(data.domains_5e_candidate) ? data.domains_5e_candidate.map(localizeCodexValue) : []),
    data.alignment_clean ? localizeCodexValue(data.alignment_clean) : "",
  ].filter(Boolean);
  return uniqueCompactValues(values, limit);
}

function getDeitySourceLink(entry) {
  const raw = String(entry?.source_url || "").trim();
  if (raw && /^https?:\/\//i.test(raw)) return raw;
  if (entry?.source && /^https?:\/\//i.test(String(entry.source))) return String(entry.source).trim();
  return "";
}


function normalizeDeityFullLore(raw = {}) {
  const lore = raw.full_lore && typeof raw.full_lore === "object" ? raw.full_lore : null;
  const cleanLoreLine = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const cleanLoreParagraphs = (value) => {
    if (Array.isArray(value)) {
      return value.map(cleanLoreLine).filter((text) => text.length > 24);
    }
    return String(value || "")
      .split(/\n{2,}|\r?\n/)
      .map(cleanLoreLine)
      .filter((text) => text.length > 24);
  };

  const sectionsRaw = Array.isArray(raw.lore_sections)
    ? raw.lore_sections
    : Array.isArray(lore?.sections)
      ? lore.sections
      : [];

  const sections = sectionsRaw
    .map((section) => {
      const title = cleanLoreLine(section?.title || section?.heading || section?.name || "Раздел");
      const paragraphs = cleanLoreParagraphs(section?.paragraphs || section?.items || section?.lines);
      const text = paragraphs.length
        ? paragraphs.join("\n\n")
        : cleanLoreLine(section?.text || section?.body || section?.content || "");
      return {
        title,
        text,
        paragraphs: paragraphs.length ? paragraphs : cleanLoreParagraphs(text),
      };
    })
    .filter((section) => section.title && (section.text.length > 24 || section.paragraphs.length));

  const paragraphsRaw = Array.isArray(raw.full_description_paragraphs)
    ? raw.full_description_paragraphs
    : Array.isArray(lore?.paragraphs)
      ? lore.paragraphs
      : [];

  const paragraphs = cleanLoreParagraphs(paragraphsRaw);

  return {
    available: Boolean(raw.full_lore_available || lore?.available || sections.length || paragraphs.length),
    sections,
    paragraphs,
    dogma: cleanLoreLine(raw.dogma_draft || lore?.dogma || ""),
    church: cleanLoreLine(raw.church_draft || lore?.church || ""),
    rituals: cleanLoreLine(raw.rituals_draft || lore?.rituals || ""),
    history: cleanLoreLine(raw.history_draft || lore?.history || ""),
  };
}
function dedupeLoreParagraphs(paragraphs = []) {
  const seen = new Set();
  const out = [];

  for (const paragraph of paragraphs) {
    const clean = String(paragraph || "").replace(/\s+/g, " ").trim();
    if (!clean || clean.length < 24) continue;
    const key = clean.toLowerCase().slice(0, 180);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }

  return out;
}

function buildDeityInfoPanels(raw = {}) {
  const panels = [];
  const push = (label, value) => {
    const safe = String(value || "").replace(/\s+/g, " ").trim();
    if (safe) panels.push({ label, value: safe });
  };

  push("Тип", "Божество");
  push("Мировоззрение", localizeCodexValue(raw.alignment_clean || raw.alignment_raw));
  push("Сферы", compactList(raw.portfolio));
  push("Домены 5e", localizeDomainList(raw.domains_5e_candidate));
  push("План", raw.home_plane);
  push("Символ", raw.symbol);
  push("Прихожане", compactList(raw.worshippers));
  push("Союзники", compactList(raw.allies));
  push("Враги", compactList(raw.enemies));

  return panels;
}

function convertDeityToBestiariEntry(raw = {}) {
  const slug = safeText(raw.slug || raw.en_name || raw.ru_name, makeId("god"));
  const title = safeText(raw.ru_name || raw.title, "Безымянное божество");
  const titles = compactList(raw.titles, 3);
  const portfolio = compactList(raw.portfolio, 5);
  const subtitle = [titles, portfolio, localizeCodexValue(raw.alignment_clean)].filter(Boolean).join(" • ") || "Божество Forgotten Realms";
  const fallback = portfolio
    ? `Божество Forgotten Realms. Сферы влияния: ${portfolio}.`
    : "Божество Forgotten Realms. Карточка создана из чернового lore-слоя и требует ручной выжимки.";
  const paragraphs = splitLoreParagraphs(raw.player_summary_draft, fallback);
  const fullLore = normalizeDeityFullLore(raw);
  const fullLoreParagraphs = dedupeLoreParagraphs([
    ...fullLore.paragraphs,
    ...fullLore.sections.flatMap((section) => {
      const sectionParagraphs = Array.isArray(section.paragraphs) && section.paragraphs.length
        ? section.paragraphs
        : section.text
          ? [section.text]
          : [];
      return sectionParagraphs.map((paragraph, index) => index === 0 ? `${section.title}: ${paragraph}` : paragraph);
    }),
  ]);
  const source = normalizeSourceToString(raw.source) || "RPG Fandom RU / Forgotten Realms";
  const sourceUrl = raw.source?.url || raw.source_url || "";
  const related = [
    ...(Array.isArray(raw.allies) ? raw.allies : []),
    ...(Array.isArray(raw.enemies) ? raw.enemies : []),
  ].map(String).filter(Boolean);

  return {
    id: `god-${slug}`,
    category: "gods",
    title,
    subtitle,
    tags: Array.isArray(raw.tags) ? raw.tags : ["бог", "божество", "forgotten_realms", "5e14"],
    source,
    source_url: sourceUrl,
    summary: shortenForSummary(paragraphs[0] || fallback),
    body: paragraphs.length ? [paragraphs[0]] : [fallback],
    full_description: fullLoreParagraphs.length ? fullLoreParagraphs : paragraphs.slice(1),
    related: [...new Set(related)].slice(0, 12),
    player_visible: raw.visibility?.player_summary !== false,
    gm_only: false,
    info_panels: buildDeityInfoPanels(raw),
    statblock: null,
    deity_data: {
      ru_name: title,
      en_name: raw.en_name || "",
      titles: Array.isArray(raw.titles) ? raw.titles : [],
      portfolio: Array.isArray(raw.portfolio) ? raw.portfolio : [],
      alignment_clean: raw.alignment_clean || "",
      alignment_raw: raw.alignment_raw || "",
      domains_5e_candidate: Array.isArray(raw.domains_5e_candidate) ? raw.domains_5e_candidate : [],
      domains_legacy_raw: Array.isArray(raw.domains_legacy_raw || raw.domains) ? (raw.domains_legacy_raw || raw.domains) : [],
      domains_unresolved: Array.isArray(raw.domains_unresolved) ? raw.domains_unresolved : [],
      worshippers: Array.isArray(raw.worshippers) ? raw.worshippers : [],
      allies: Array.isArray(raw.allies) ? raw.allies : [],
      enemies: Array.isArray(raw.enemies) ? raw.enemies : [],
      home_plane: raw.home_plane || "",
      symbol: raw.symbol || "",
      setting: raw.setting || "",
      classification_flags: Array.isArray(raw.classification_flags) ? raw.classification_flags : [],
      rewrite_needed: raw.rewrite_needed !== false,
      review_status: raw.review_status || "needs_rewrite",
      full_lore: fullLore,
    },
    review_status: raw.review_status || "needs_rewrite",
    classification_flags: Array.isArray(raw.classification_flags) ? raw.classification_flags : [],
    raw_fields: raw.raw_fields && typeof raw.raw_fields === "object" ? raw.raw_fields : null,
  };
}

function isDeitySeedItem(item = {}) {
  return item?.type === "deity" ||
    item?.entity_type === "deity" ||
    item?.category === "gods" ||
    Array.isArray(item?.portfolio) ||
    Array.isArray(item?.domains_5e_candidate) ||
    Array.isArray(item?.worshippers) ||
    Boolean(item?.alignment_clean || item?.alignment_raw || item?.home_plane || item?.symbol);
}

function isRaceSeedItem(item = {}) {
  const section = String(item?.category_section || "").toLowerCase();
  const id = String(item?.id || "").toLowerCase();
  return item?.type === "race" ||
    item?.entity_type === "race" ||
    item?.category === "races" ||
    id.startsWith("race-") ||
    section.includes("расы") ||
    section.includes("происхождения");
}

function cleanRaceTextList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];

  for (const value of values) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }

  return out;
}

function filterRaceSpellRefs(refs = []) {
  const seen = new Set();
  const out = [];

  for (const ref of Array.isArray(refs) ? refs : []) {
    const path = String(ref?.path || "").trim();
    const title = String(ref?.title || "").replace(/\s+/g, " ").trim();
    if (!path || path === "/spells/" || !title || title.toLowerCase() === "заклинания") continue;
    const key = `${path}|${title}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, url: String(ref?.url || ""), path });
  }

  return out;
}

function raceSectionToLine(section = {}, limitParagraphs = 4) {
  const title = String(section?.title || "").replace(/\s+/g, " ").trim();
  const paragraphs = cleanRaceTextList(section?.paragraphs || [])
    .filter((paragraph) => !paragraph.startsWith("Источник:"))
    .slice(0, limitParagraphs);

  if (!title || !paragraphs.length) return "";
  return `${title}: ${paragraphs.join(" ")}`;
}

function buildRaceInfoPanels(raw = {}, isOrigin = false) {
  const quality = raw.quality || {};
  const panels = [];
  const push = (label, value) => {
    const safe = String(value || "").replace(/\s+/g, " ").trim();
    if (safe) panels.push({ label, value: safe });
  };

  push("EN", raw.en_name);
  push("Источник", normalizeSourceToString(raw.source) || compactList(raw.source_tags));
  push("Тип", isOrigin ? "Происхождение" : "Раса");
  push("Статус", raw.review_status || "needs_cleaning");
  push("Секций", quality.section_count);
  push("Особенностей", quality.trait_count);

  return panels;
}

function convertRaceToBestiariEntry(raw = {}) {
  const slug = safeText(raw.slug || raw.en_name || raw.ru_name, makeId("race"));
  const title = safeText(raw.ru_name || raw.title_ru || raw.title || raw.title_raw, "Безымянная раса");
  const enName = safeText(raw.en_name || raw.title_en);
  const sourceTags = Array.isArray(raw.source_tags) ? raw.source_tags.map(String).filter(Boolean) : [];
  const sectionName = safeText(raw.category_section || raw.section);
  const isOrigin = sectionName === "Происхождения" || /origin|lineage/i.test(String(raw.type || ""));
  const sections = Array.isArray(raw.sections) ? raw.sections : [];
  const traits = Array.isArray(raw.traits_round1) ? raw.traits_round1 : [];
  const spellRefs = filterRaceSpellRefs(raw.spell_refs_round1 || raw.spell_refs || []);
  const source = normalizeSourceToString(raw.source) || "DnD.su";
  const sourceUrl = raw.source_url || raw.url || "";

  let intro = [];
  for (const section of sections) {
    const titleLower = String(section?.title || "").toLowerCase();
    const paragraphs = cleanRaceTextList(section?.paragraphs || [])
      .filter((paragraph) => !paragraph.startsWith("Источник:"));
    if (paragraphs.length && (titleLower.includes(String(raw.ru_name || "").toLowerCase()) || !intro.length)) {
      intro = paragraphs.slice(0, 3);
      if (titleLower.includes(String(raw.ru_name || "").toLowerCase())) break;
    }
  }

  const fallback = `${title} — черновая карточка ${isOrigin ? "происхождения" : "расы"} из round1. Нужен clean-pass.`;
  const summary = shortenForSummary(intro[0] || fallback);
  const fullDescription = sections
    .map((section) => raceSectionToLine(section, 4))
    .filter(Boolean)
    .filter((line) => !line.startsWith("Комментарии:") && !line.startsWith("Галерея:"))
    .slice(0, 28);

  const featureLines = [];
  const seenFeatureLines = new Set();
  for (const trait of traits) {
    const name = String(trait?.name || "").replace(/\s+/g, " ").trim();
    const traitText = String(trait?.text || "").replace(/\s+/g, " ").trim();
    if (!name || !traitText) continue;
    const line = `${name}. ${traitText}`;
    const key = line.toLowerCase().slice(0, 180);
    if (seenFeatureLines.has(key)) continue;
    seenFeatureLines.add(key);
    featureLines.push(line);
  }

  return {
    id: raw.id || `race-${slug}`,
    category: "races",
    title,
    subtitle: isOrigin ? "Происхождение / lineage" : "Раса / происхождение D&D 5e",
    tags: [isOrigin ? "происхождение" : "раса", "dnd.su", ...sourceTags],
    source,
    source_url: sourceUrl,
    summary,
    body: intro.length ? [intro[0]] : [fallback],
    full_description: fullDescription.length ? fullDescription : intro.slice(1),
    related: spellRefs.map((ref) => ref.title).filter(Boolean),
    player_visible: raw.visibility?.player_summary !== false,
    gm_only: false,
    info_panels: buildRaceInfoPanels(raw, isOrigin),
    mechanics: {
      short_rules: featureLines.slice(0, 14),
      examples: [],
    },
    race_data: {
      ru_name: title,
      en_name: enName,
      source_tags: sourceTags,
      source_path: raw.source_path || raw.path || "",
      is_origin: isOrigin,
      quality: raw.quality || {},
      spell_refs_round1: spellRefs,
    },
    review_status: raw.review_status || "needs_cleaning",
    raw_fields: raw.raw_fields && typeof raw.raw_fields === "object" ? raw.raw_fields : null,
  };
}

function isClassSeedItem(item = {}) {
  return item?.entity_type === "class" || item?.type === "class" || Boolean(item?.class_data);
}

function classSectionToLine(section = {}, limit = 4) {
  const title = String(section?.title || "").replace(/\s+/g, " ").trim();
  const paragraphs = Array.isArray(section?.paragraphs)
    ? section.paragraphs.map((item) => String(item || "").replace(/\s+/g, " ").trim()).filter(Boolean)
    : [];
  if (!title || !paragraphs.length) return "";
  return `${title}: ${paragraphs.slice(0, limit).join(" ")}`;
}

function normalizeClassFeatureLine(feature = {}) {
  const name = String(feature?.name || "").replace(/\s+/g, " ").trim();
  const text = String(feature?.text || "").replace(/\s+/g, " ").trim();
  if (!name || !text) return "";
  return `${name}. ${text}`;
}

function buildClassInfoPanels(raw = {}, classData = {}) {
  const quality = raw.quality || {};
  const subclasses = Array.isArray(classData.subclasses_round1) ? classData.subclasses_round1 : [];
  return [
    { label: "EN", value: raw.en_name || classData.en_name || "—" },
    { label: "Источник", value: raw.source || "—" },
    { label: "Тип", value: "Класс" },
    { label: "Кость хитов", value: classData.hit_die || "—" },
    { label: "Подклассов", value: String(subclasses.length || quality.subclass_count || "—") },
    { label: "Статус", value: raw.review_status || "needs_cleaning" },
  ];
}

function convertClassToBestiariEntry(raw = {}) {
  const sourceTags = Array.isArray(raw.source_tags) ? raw.source_tags.map(String).filter(Boolean) : [];
  const sections = Array.isArray(raw.sections) ? raw.sections : [];
  const rawClassData = raw.class_data && typeof raw.class_data === "object" ? raw.class_data : {};
  const features = Array.isArray(rawClassData.features_round1) ? rawClassData.features_round1 : [];
  const subclasses = Array.isArray(rawClassData.subclasses_round1) ? rawClassData.subclasses_round1 : [];
  const spellRefs = Array.isArray(raw.spell_refs_round1)
    ? raw.spell_refs_round1.filter((ref) => ref?.path && ref.path !== "/spells/")
    : [];

  const title = raw.ru_name || raw.title_ru || raw.title || "Без названия";
  const enName = raw.en_name || raw.title_en || "";
  const slug = raw.slug || makeId(title);
  const source = raw.source || "DnD.su";
  const sourceUrl = raw.source_url || raw.url || "";
  const intro = Array.isArray(raw.intro_paragraphs)
    ? raw.intro_paragraphs.map((item) => String(item || "").replace(/\s+/g, " ").trim()).filter(Boolean)
    : [];

  const fallback = `${title} — черновая карточка класса из round1. Нужен clean-pass.`;
  const summary = shortenForSummary(intro[0] || fallback, 420);
  const fullDescription = sections
    .map((section) => classSectionToLine(section, 4))
    .filter(Boolean)
    .filter((line) => !line.startsWith("Комментарии:") && !line.startsWith("Галерея:"))
    .slice(0, 32);

  const featureLines = [];
  const seen = new Set();
  for (const feature of features) {
    const line = normalizeClassFeatureLine(feature);
    const key = line.toLowerCase().slice(0, 220);
    if (!line || seen.has(key)) continue;
    seen.add(key);
    featureLines.push(line);
  }

  const classData = {
    ru_name: title,
    en_name: enName,
    source_tags: sourceTags,
    source_path: raw.source_path || raw.path || "",
    hit_die: rawClassData.hit_die || "",
    progression_tables_round1: Array.isArray(rawClassData.progression_tables_round1) ? rawClassData.progression_tables_round1 : [],
    features_round1: features,
    subclasses_round1: subclasses,
    spell_refs_round1: spellRefs,
    quality: raw.quality || {},
    ui_hints: rawClassData.ui_hints || { subclass_display: "horizontal_tabs" },
  };

  return {
    id: raw.id || `class-${slug}`,
    category: "classes",
    title,
    subtitle: "Класс D&D 5e",
    tags: ["класс", "dnd.su", ...sourceTags],
    source,
    source_url: sourceUrl,
    summary,
    body: intro.length ? intro.slice(0, 3) : [fallback],
    full_description: fullDescription.length ? fullDescription : intro.slice(1),
    related: spellRefs.map((ref) => ref.title).filter(Boolean),
    player_visible: raw.visibility?.player_summary !== false,
    gm_only: false,
    info_panels: buildClassInfoPanels(raw, classData),
    mechanics: {
      short_rules: featureLines.slice(0, 16),
      examples: [],
    },
    class_data: classData,
    review_status: raw.review_status || "needs_cleaning",
    raw_fields: raw.raw_fields && typeof raw.raw_fields === "object" ? raw.raw_fields : null,
  };
}


function isMonsterSeedItem(item = {}) {
  return item?.type === "monster" ||
    item?.entity_type === "monster" ||
    item?.category === "monsters" ||
    Boolean(item?.monster_data) ||
    Boolean(item?.statblock?.challenge || item?.statblock?.armor_class || item?.statblock?.hit_points || item?.actions || item?.legendary_actions || item?.mythic_actions);
}

function normalizeMonsterEntryList(value = []) {
  return normalizeMonsterNamedEntries(value).map((item) => {
    if (typeof item === "string") return item;
    return {
      name: safeText(item.name || item.title || "Элемент"),
      text: safeText(item.text || item.body || item.description || ""),
      raw_lines: Array.isArray(item.raw_lines) ? item.raw_lines.map(String).filter(Boolean) : [],
      damage_types_detected: Array.isArray(item.damage_types_detected) ? item.damage_types_detected : [],
      conditions_detected: Array.isArray(item.conditions_detected) ? item.conditions_detected : [],
    };
  });
}

function buildMonsterInfoPanels(raw = {}, statblock = {}) {
  const panels = [];
  const push = (label, value) => {
    const safe = Array.isArray(value) ? value.join(", ") : String(value || "").replace(/\s+/g, " ").trim();
    if (safe) panels.push({ label, value: safe });
  };

  const challenge = statblock.challenge && typeof statblock.challenge === "object" ? statblock.challenge : {};
  const sta = statblock.size_type_alignment && typeof statblock.size_type_alignment === "object" ? statblock.size_type_alignment : {};

  push("EN", raw.en_name);
  push("Источник", raw.source_code || raw.source_book || raw.source);
  push("Опасность", challenge.value || raw.cr || raw.challenge_rating);
  push("КД", statblock.armor_class || statblock.ac);
  push("Хиты", statblock.hit_points || statblock.hp);
  push("Скорость", statblock.speed);
  push("Размер/тип", sta.raw || [sta.size, sta.type].filter(Boolean).join(" "));
  push("Языки", statblock.languages);

  return panels;
}

function convertMonsterToBestiariEntry(raw = {}) {
  const title = safeText(raw.title || raw.ru_name || raw.name, "Безымянный монстр");
  const enName = safeText(raw.en_name || raw.title_en);
  const sourceCode = safeText(raw.source_code || raw.source || "");
  const source = safeText(raw.source || (sourceCode ? `DnD.su / ${sourceCode}` : "DnD.su / Бестиарий"));
  const sourceUrl = safeText(raw.source_url || raw.url || raw.sourceUrl);
  const rawStatblock = raw.statblock && typeof raw.statblock === "object" ? raw.statblock : {};
  const challenge = rawStatblock.challenge && typeof rawStatblock.challenge === "object" ? rawStatblock.challenge : {};
  const sta = rawStatblock.size_type_alignment && typeof rawStatblock.size_type_alignment === "object" ? rawStatblock.size_type_alignment : {};
  const crText = challenge.value ? `CR ${challenge.value}` : safeText(raw.cr || rawStatblock.cr || "CR ?");
  const typeBits = sta.raw || [sta.size, sta.type, sta.alignment].filter(Boolean).join(" ");
  const description = normalizeTextBlock(raw.description_paragraphs || raw.full_description || raw.body);
  const summary = safeText(raw.summary || description[0] || "Монстр из бестиария DnD.su. Сырой текст сохранён в raw/review слое.");
  const traits = normalizeMonsterEntryList(raw.traits || rawStatblock.traits || []);
  const actions = normalizeMonsterEntryList(raw.actions || rawStatblock.actions || []);
  const bonusActions = normalizeMonsterEntryList(raw.bonus_actions || rawStatblock.bonus_actions || []);
  const reactions = normalizeMonsterEntryList(raw.reactions || rawStatblock.reactions || []);
  const legendaryActions = normalizeMonsterEntryList(raw.legendary_actions || rawStatblock.legendary_actions || []);
  const mythicActions = normalizeMonsterEntryList(raw.mythic_actions || rawStatblock.mythic_actions || []);
  const lairActions = normalizeMonsterEntryList(raw.lair_actions || rawStatblock.lair_actions || []);
  const lairEffects = normalizeMonsterEntryList(raw.lair_effects || rawStatblock.lair_effects || []);
  const regionalEffects = normalizeMonsterEntryList(raw.regional_effects || rawStatblock.regional_effects || []);
  const statblock = {
    ...rawStatblock,
    traits,
    actions,
    bonus_actions: bonusActions,
    reactions,
    legendary_actions: legendaryActions,
    mythic_actions: mythicActions,
    lair_actions: lairActions,
    lair_effects: lairEffects,
    regional_effects: regionalEffects,
  };
  const review = raw.review && typeof raw.review === "object" ? raw.review : null;
  const quality = raw.quality && typeof raw.quality === "object" ? raw.quality : null;
  const detected = raw.detected && typeof raw.detected === "object" ? raw.detected : {};

  return {
    id: raw.id || makeStableMonsterId(title, enName, sourceCode),
    category: "monsters",
    title,
    subtitle: safeText(raw.subtitle || [crText, typeBits, sourceCode].filter(Boolean).join(" • ")),
    tags: Array.isArray(raw.tags) ? raw.tags : ["monster", "bestiary", sourceCode, sta.type, challenge.value ? `cr-${challenge.value}` : ""].filter(Boolean),
    source,
    source_url: sourceUrl,
    summary: shortenForSummary(summary, 360),
    body: description.length ? description.slice(0, 1) : [summary],
    full_description: description.slice(1),
    related: [],
    player_visible: raw.player_visible !== false,
    gm_only: raw.gm_only === true,
    info_panels: Array.isArray(raw.info_panels) ? raw.info_panels : buildMonsterInfoPanels(raw, rawStatblock),
    statblock,
    monster_data: {
      ru_name: title,
      en_name: enName,
      source_code: sourceCode,
      source_book: raw.source_book || "",
      source_group: raw.source_group || "",
      detected,
      quality,
      review,
      section_buckets: raw.section_buckets || null,
      site_noise_count: Array.isArray(raw.site_noise_lines) ? raw.site_noise_lines.length : 0,
    },
    review,
    quality,
    section_buckets: raw.section_buckets || null,
    site_noise_lines: Array.isArray(raw.site_noise_lines) ? raw.site_noise_lines : [],
    review_status: review?.needs_review ? review.priority || "needs_review" : safeText(raw.review_status || "parsed_round1"),
    raw_fields: raw.raw && typeof raw.raw === "object" ? raw.raw : (raw.raw_fields && typeof raw.raw_fields === "object" ? raw.raw_fields : null),
  };
}

function makeStableMonsterId(title = "", enName = "", sourceCode = "") {
  const raw = ["monster", sourceCode, title, enName].filter(Boolean).join("-");
  const slug = raw
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return slug || makeId("monster");
}


function getItemNameRu(raw = {}) {
  if (raw.ru_name) return safeText(raw.ru_name);
  if (raw.name && typeof raw.name === "object") return safeText(raw.name.ru || raw.name.en || raw.name.original);
  return safeText(raw.name || raw.title || "Предмет");
}

function getItemNameEn(raw = {}) {
  if (raw.en_name) return safeText(raw.en_name);
  if (raw.name && typeof raw.name === "object") return safeText(raw.name.en || raw.name.original);
  return "";
}

function isItemSeedItem(raw = {}) {
  return (
    raw?.entity_type === "item" ||
    raw?.source_family === "dndsu_phb" ||
    raw?.source_family === "dndsu_magic_items" ||
    raw?.source?.family === "dndsu_magic_items" ||
    raw?.metadata?.source_family === "dndsu_magic_items" ||
    raw?.ui_category ||
    raw?.item_data
  );
}

function formatItemPrice(raw = {}) {
  const price = raw.price || raw.item_data?.price || {};
  if (price.raw) return safeText(price.raw);
  if (price.gp !== undefined && price.gp !== null) return `${price.gp} зм`;
  if (price.value !== undefined && price.value !== null) return `${price.value} зм`;
  if (price.average_gp !== undefined && price.average_gp !== null) return `${price.average_gp} зм`;
  if (price.range_min_gp !== undefined && price.range_min_gp !== null && price.range_max_gp !== undefined && price.range_max_gp !== null) {
    return `${price.range_min_gp}–${price.range_max_gp} зм`;
  }
  if (price.range_min_gp !== undefined && price.range_min_gp !== null) return `от ${price.range_min_gp} зм`;
  if (raw.value_gp !== undefined && raw.value_gp !== null) return `${raw.value_gp} зм`;
  return "";
}

function formatItemWeight(raw = {}) {
  const weight = raw.weight || raw.item_data?.weight || {};
  if (weight.raw) return safeText(weight.raw);
  if (weight.lb !== undefined && weight.lb !== null) return `${weight.lb} фнт.`;
  if (raw.weight_lb !== undefined && raw.weight_lb !== null) return `${raw.weight_lb} фнт.`;
  return "";
}

function convertItemToBestiariEntry(raw = {}) {
  const title = getItemNameRu(raw);
  const enName = getItemNameEn(raw);
  const uiCategory = safeText(raw.ui_category || raw.item_data?.ui_category || "Предметы");
  const displayGroup = safeText(raw.display_group || raw.item_data?.display_group || "Снаряжение");
  const subtype = safeText(raw.item_subtype || raw.item_data?.item_subtype || raw.source_category_clean || raw.source_category || "item");
  const sourceCode = safeText(raw.source_code || raw.source?.source_code || raw.source?.book || raw.source?.code || raw.source_book || raw.item_data?.source_code || "source");
  const sourceFamily = safeText(raw.source_family || raw.source?.family || raw.metadata?.source_family || raw.item_data?.source_family || "dndsu_phb");
  const rarityLabel = raw.rarity_visual?.label || raw.rarity_display || raw.rarity || raw.rarity_key || raw.item_data?.rarity || "Обычный";
  const rarity = safeText(rarityLabel);
  const rarityColor = raw.rarity_color || raw.rarity_visual?.color || raw.item_data?.rarity_color || "";
  const priceText = formatItemPrice(raw);
  const weightText = formatItemWeight(raw);
  const descriptionFull = raw.description_full || {};
  const descriptionValue =
    descriptionFull.raw_text ||
    (typeof raw.description === "string" ? raw.description : raw.description?.raw_text) ||
    raw.full_description ||
    raw.body ||
    [];
  const descriptionLines = normalizeTextBlock(descriptionValue);
  const mechanicsText =
    descriptionFull.mechanics_text ||
    (typeof raw.description === "object" ? raw.description?.mechanics_text || raw.description?.mechanics : null) ||
    raw.mechanics?.short_rules ||
    raw.mechanics?.rules ||
    raw.mechanics?.text ||
    [];
  const mechanics = normalizeTextBlock(mechanicsText);
  const summary = safeText(
    raw.summary ||
      (typeof raw.description === "object" ? raw.description?.summary : "") ||
      descriptionFull.summary ||
      descriptionLines[0]
  ) || [uiCategory, displayGroup, priceText, weightText].filter(Boolean).join(" • ");
  const bodyLines = descriptionLines.length ? descriptionLines : (mechanics.length ? mechanics : [summary].filter(Boolean));
  const rawLineCount = normalizeTextBlock(raw.raw_preserved?.page_lines || raw.raw_preserved?.description_lines || bodyLines).length;
  const attunement = raw.equip?.attunement || raw.attunement || raw.item_data?.equip?.attunement || null;
  const attunementRequired = Boolean(attunement?.required || attunement === true || raw.attunement_required === true);
  const attunementLabel = attunementRequired ? (attunement?.source_text || attunement?.raw || "Да") : "Нет";
  const tags = [
    "item",
    sourceFamily === "dndsu_magic_items" ? "magic-item" : "phb",
    sourceFamily,
    sourceCode,
    uiCategory,
    displayGroup,
    subtype,
    rarity,
    rarityColor,
    ...(Array.isArray(raw.tags) ? raw.tags : []),
    ...(Array.isArray(raw.keywords) ? raw.keywords : []),
  ].filter(Boolean);

  return normalizeEntry({
    id: safeText(raw.id, makeId("item")),
    category: "items",
    title,
    subtitle: [uiCategory, displayGroup, rarity, priceText, weightText].filter(Boolean).join(" • "),
    tags,
    source: [sourceFamily, sourceCode].filter(Boolean).join(" / "),
    source_url: raw.source_url || raw.url || raw.source?.url || raw.links?.source_links?.[0]?.url || "",
    summary,
    body: bodyLines,
    full_description: [],
    related: [enName].filter(Boolean),
    quality: {
      line_count: rawLineCount || bodyLines.length || 0,
      raw_source: sourceFamily,
      preserved: Boolean(raw.raw_preserved || bodyLines.length),
    },
    section_buckets: raw.mechanics?.section_buckets || null,
    site_noise_lines: Array.isArray(raw.raw_preserved?.site_noise_lines) ? raw.raw_preserved.site_noise_lines : [],
    item_data: {
      type: [uiCategory, displayGroup, subtype].filter(Boolean).join(" / "),
      ui_category: uiCategory,
      display_group: displayGroup,
      item_subtype: subtype,
      source_category_raw: raw.source_category_raw || null,
      source_category_clean: raw.source_category_clean || null,
      rarity,
      rarity_key: raw.rarity || raw.rarity_key || null,
      rarity_color: rarityColor || null,
      rarity_rank: raw.rarity_rank ?? null,
      rarity_visual: raw.rarity_visual || null,
      source_family: sourceFamily,
      source_code: sourceCode,
      price: raw.price || null,
      price_raw: priceText,
      value_gp: raw.price?.gp ?? raw.price?.value ?? raw.price?.average_gp ?? raw.value_gp ?? null,
      weight: raw.weight || null,
      weight_raw: weightText,
      weight_lb: raw.weight?.lb ?? raw.weight_lb ?? null,
      slot: raw.equip?.slot || raw.slot || "—",
      attunement: attunementLabel,
      armor: raw.armor || null,
      weapon: raw.weapon || null,
      tool: raw.tool || null,
      equip: raw.equip || null,
      use: raw.use || null,
      flags: raw.flags || null,
      review: raw.review || null,
      mechanics: raw.mechanics && typeof raw.mechanics === "object" ? raw.mechanics : null,
      links: raw.links && typeof raw.links === "object" ? raw.links : null,
      raw_preserved: raw.raw_preserved && typeof raw.raw_preserved === "object" ? raw.raw_preserved : null,
      properties: [
        ...(raw.weapon?.properties_raw ? [raw.weapon.properties_raw] : []),
        ...(Array.isArray(raw.weapon?.properties) ? raw.weapon.properties : []),
        ...(Array.isArray(raw.tool?.contents_guess) ? raw.tool.contents_guess.slice(0, 8) : []),
        ...(raw.price?.raw ? [`Цена источника: ${raw.price.raw}`] : []),
        ...(attunementRequired ? [`Настройка: ${attunementLabel}`] : []),
      ].filter(Boolean),
    },
    review: raw.review || null,
    raw_fields: raw,
  });
}

function convertUnknownSeedItemToBestiariEntry(item = {}) {
  if (isMonsterSeedItem(item)) return convertMonsterToBestiariEntry(item);
  if (isDeitySeedItem(item)) return convertDeityToBestiariEntry(item);
  if (isRaceSeedItem(item)) return convertRaceToBestiariEntry(item);
  if (isClassSeedItem(item)) return convertClassToBestiariEntry(item);
  if (isItemSeedItem(item)) return convertItemToBestiariEntry(item);
  return item;
}

function extractBestiariEntriesFromSeed(payload) {
  if (!payload) return [];

  if (Array.isArray(payload)) {
    return payload.map(convertUnknownSeedItemToBestiariEntry);
  }

  if (Array.isArray(payload.entries)) {
    return payload.entries.map(convertUnknownSeedItemToBestiariEntry);
  }

  if ((payload.entity_type === "monster_collection" || payload.entity_type === "bestiari_preview_collection") && Array.isArray(payload.items)) {
    return payload.items.map(convertMonsterToBestiariEntry);
  }

  if (payload.entity_type === "deity" && Array.isArray(payload.items)) {
    return payload.items.map(convertDeityToBestiariEntry);
  }

  if (payload.entity_type === "race_collection" && Array.isArray(payload.items)) {
    return payload.items.map(convertRaceToBestiariEntry);
  }

  if (payload.entity_type === "class_collection" && Array.isArray(payload.items)) {
    return payload.items.map(convertClassToBestiariEntry);
  }

  if ((payload.entity_type === "item_collection" || ["dndsu_phb", "dndsu_magic_items"].includes(payload.metadata?.source_family)) && Array.isArray(payload.items)) {
    return payload.items.map(convertItemToBestiariEntry);
  }

  if (Array.isArray(payload.items)) {
    return payload.items.map(convertUnknownSeedItemToBestiariEntry);
  }

  return [];
}

async function loadFirstAvailableBestiariSeed(urls = [], label = "seed") {
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const payload = await res.json();
      const entries = extractBestiariEntriesFromSeed(payload);
      if (entries.length) {
        console.info(`[bestiari] loaded ${entries.length} ${label} entries from ${url}`);
        return entries;
      }
    } catch (err) {
      console.debug(`[bestiari] ${label} seed unavailable: ${url}`, err);
    }
  }

  return [];
}

async function loadExternalBestiariSeeds() {
  const monsterSeeds = await loadFirstAvailableBestiariSeed(BESTIARI_MONSTER_SEED_URLS, "monster");
  const deitySeeds = await loadFirstAvailableBestiariSeed(BESTIARI_DEITY_SEED_URLS, "deity");
  const raceSeeds = await loadFirstAvailableBestiariSeed(BESTIARI_RACE_SEED_URLS, "race");
  const classSeeds = await loadFirstAvailableBestiariSeed(BESTIARI_CLASS_SEED_URLS, "class");
  const factionSeeds = await loadFirstAvailableBestiariSeed(BESTIARI_FACTION_SEED_URLS, "faction");
  const conditionSeeds = await loadFirstAvailableBestiariSeed(BESTIARI_CONDITION_SEED_URLS, "condition");
  const mechanicSeeds = await loadFirstAvailableBestiariSeed(BESTIARI_MECHANIC_SEED_URLS, "mechanic");
  const loreSeeds = await loadFirstAvailableBestiariSeed(BESTIARI_LORE_SEED_URLS, "lore");
  const locationSeeds = await loadFirstAvailableBestiariSeed(BESTIARI_LOCATION_SEED_URLS, "location");
  const spellSeeds = await loadFirstAvailableBestiariSeed(BESTIARI_SPELL_SEED_URLS, "spell");
  const featSeeds = await loadFirstAvailableBestiariSeed(BESTIARI_FEAT_SEED_URLS, "feat");
  const itemSeeds = await loadFirstAvailableBestiariSeed(BESTIARI_ITEM_SEED_URLS, "item");
  const magicItemSeeds = await loadFirstAvailableBestiariSeed(BESTIARI_MAGIC_ITEM_SEED_URLS, "magic item");

  return [...monsterSeeds, ...deitySeeds, ...raceSeeds, ...classSeeds, ...factionSeeds, ...conditionSeeds, ...mechanicSeeds, ...loreSeeds, ...locationSeeds, ...spellSeeds, ...featSeeds, ...itemSeeds, ...magicItemSeeds].map(normalizeEntry);
}

function mergeEntryLists(...lists) {
  const map = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const entry = normalizeEntry(raw);
      if (!entry.id) continue;
      map.set(entry.id, entry);
    }
  }
  return [...map.values()];
}


function saveLocalEntries() {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify({ entries: BESTIARI_STATE.entries || [] }));
  } catch (_) {}
}

function loadLocalEntries() {
  try {
    const raw = localStorage.getItem(getStorageKey());
    const parsed = tryParseJson(raw);
    if (parsed && Array.isArray(parsed.entries)) return parsed.entries;
  } catch (_) {}
  return null;
}

function ensureEntries() {
  if (!Array.isArray(BESTIARI_STATE.entries)) BESTIARI_STATE.entries = [];
}

function getVisibleEntries() {
  ensureEntries();
  const role = BESTIARI_STATE.role;
  const query = BESTIARI_STATE.query.trim().toLowerCase();
  const category = BESTIARI_STATE.category;

  return BESTIARI_STATE.entries
    .filter((entry) => {
      if (role !== "gm") {
        if (entry.gm_only) return false;
        if (entry.player_visible === false) return false;
      }
      if (category !== "all" && entry.category !== category) return false;
      if (!query) return true;

      const haystack = [
        entry.title,
        entry.subtitle,
        entry.summary,
        ...(entry.body || []),
        ...(entry.full_description || []),
        ...(entry.tags || []),
        ...(entry.related || []),
        ...(entry.deity_data?.portfolio || []),
        ...(entry.deity_data?.worshippers || []),
        ...(entry.deity_data?.allies || []),
        ...(entry.deity_data?.enemies || []),
        ...(entry.deity_data?.domains_5e_candidate || []),
        ...(entry.deity_data?.domains_legacy_raw || []),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    })
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));
}

function getSelectedEntry(entries = null) {
  const list = entries || getVisibleEntries();
  const found = list.find((entry) => entry.id === BESTIARI_STATE.selectedId);
  return found || list[0] || null;
}

function countByCategory(entries) {
  const stats = {};
  for (const entry of entries) {
    stats[entry.category] = (stats[entry.category] || 0) + 1;
  }
  return stats;
}

function getAbilityMod(score) {
  const val = Number(score);
  if (!Number.isFinite(val)) return "—";
  const mod = Math.floor((val - 10) / 2);
  return mod >= 0 ? `+${mod}` : String(mod);
}

function truncateText(value, maxLength = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function compactMetaChip(label, value) {
  if (!value) return "";
  return `<span class="meta-item"><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}</span>`;
}

function exportJson() {
  try {
    const blob = new Blob([
      JSON.stringify({ entries: BESTIARI_STATE.entries || [] }, null, 2),
    ], { type: "application/json;charset=utf-8" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dnd-trader-bestiari.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("📦 Bestiari экспортирован в JSON");
  } catch {
    showToast("Не удалось экспортировать JSON");
  }
}

function openEditor(mode, entry = null) {
  BESTIARI_STATE.editorOpen = true;
  BESTIARI_STATE.editorMode = mode;
  const base = normalizeEntry(entry || {});
  BESTIARI_STATE.draft = {
    ...base,
    body: (base.body || []).join("\n\n"),
    full_description: (base.full_description || []).join("\n\n"),
    tags: (base.tags || []).join(", "),
    related: (base.related || []).join(", "),
    statblock_text: base.statblock
      ? [
          `ac: ${base.statblock.ac || ""}`,
          `hp: ${base.statblock.hp || ""}`,
          `speed: ${base.statblock.speed || ""}`,
          `size: ${base.statblock.size || ""}`,
          `type: ${base.statblock.type || ""}`,
          `alignment: ${base.statblock.alignment || ""}`,
          `str: ${base.statblock.abilities?.str ?? 10}`,
          `dex: ${base.statblock.abilities?.dex ?? 10}`,
          `con: ${base.statblock.abilities?.con ?? 10}`,
          `int: ${base.statblock.abilities?.int ?? 10}`,
          `wis: ${base.statblock.abilities?.wis ?? 10}`,
          `cha: ${base.statblock.abilities?.cha ?? 10}`,
        ].join("\n")
      : "",
    mechanics_text: base.mechanics
      ? JSON.stringify(base.mechanics, null, 2)
      : "",
  };
}

function closeEditor() {
  BESTIARI_STATE.editorOpen = false;
  BESTIARI_STATE.draft = null;
}

function deleteEntry(entryId) {
  const entry = BESTIARI_STATE.entries.find((item) => item.id === entryId);
  if (!entry) return;

  if (!window.confirm(`Удалить запись «${entry.title}»?`)) return;

  BESTIARI_STATE.entries = BESTIARI_STATE.entries.filter((item) => item.id !== entryId);
  saveLocalEntries();
  const visible = getVisibleEntries();
  BESTIARI_STATE.selectedId = visible[0]?.id || "";
  renderCodex();
  showToast("🗑️ Запись удалена");
}

function readDraftFromForm() {
  const body = getEl("bestiariDraftBody")?.value || "";
  const fullDescription = getEl("bestiariDraftFullDescription")?.value || "";
  const mechanicsText = getEl("bestiariDraftMechanics")?.value || "";

  const mechanicsParsed = mechanicsText.trim() ? tryParseJson(mechanicsText) : null;

  return normalizeEntry({
    id: getEl("bestiariDraftId")?.value || makeId("entry"),
    category: getEl("bestiariDraftCategory")?.value || "lore",
    title: getEl("bestiariDraftTitle")?.value || "Без названия",
    subtitle: getEl("bestiariDraftSubtitle")?.value || "",
    source: getEl("bestiariDraftSource")?.value || "",
    tags: splitCsv(getEl("bestiariDraftTags")?.value || ""),
    related: splitCsv(getEl("bestiariDraftRelated")?.value || ""),
    summary: getEl("bestiariDraftSummary")?.value || "",
    body,
    full_description: fullDescription,
    player_visible: Boolean(getEl("bestiariDraftPlayerVisible")?.checked),
    gm_only: Boolean(getEl("bestiariDraftGmOnly")?.checked),
    statblock: getEl("bestiariDraftStatblock")?.value?.trim()
      ? {
          ...parseKeyValueLines(getEl("bestiariDraftStatblock")?.value || ""),
          abilities: parseKeyValueLines(getEl("bestiariDraftStatblock")?.value || ""),
        }
      : null,
    mechanics: mechanicsParsed,
  });
}

function saveDraft() {
  const draft = readDraftFromForm();
  const existingIndex = BESTIARI_STATE.entries.findIndex((entry) => entry.id === draft.id);

  if (existingIndex >= 0) {
    BESTIARI_STATE.entries.splice(existingIndex, 1, draft);
  } else {
    BESTIARI_STATE.entries.unshift(draft);
  }

  saveLocalEntries();
  BESTIARI_STATE.selectedId = draft.id;
  closeEditor();
  renderCodex();
  showToast("💾 Запись bestiari сохранена");
}

async function applyImportJson(rawJson) {
  const parsed = tryParseJson(rawJson);
  if (!parsed) {
    showToast("JSON не распознан");
    return;
  }

  let entries = [];
  if (Array.isArray(parsed)) entries = parsed;
  else if (Array.isArray(parsed.entries)) entries = parsed.entries;
  else if (Array.isArray(parsed.data)) entries = parsed.data;
  else {
    showToast("Не найден массив записей для импорта");
    return;
  }

  BESTIARI_STATE.entries = entries.map(normalizeEntry);
  saveLocalEntries();
  BESTIARI_STATE.source = "import";
  BESTIARI_STATE.selectedId = BESTIARI_STATE.entries[0]?.id || "";
  BESTIARI_STATE.importOpen = false;
  renderCodex();
  showToast("📥 Bestiari импортирован");
}


function getCategoryIcon(category) {
  const icons = {
    all: "◆",
    monsters: "☠",
    gods: "✦",
    lore: "✥",
    mechanics: "⚙",
    spells: "✧",
    items: "◈",
    feats: "✦",
    classes: "⚔",
    subclasses: "◇",
    races: "◎",
    factions: "♜",
    locations: "⌖",
    events: "✹",
    conditions: "◌",
  };
  return icons[category] || "◆";
}

function getEntryPrimaryImage(entry) {
  return String(
    entry?.image_url ||
      entry?.image ||
      entry?.portrait ||
      entry?.art ||
      entry?.media?.image ||
      entry?.media?.portrait ||
      ""
  ).trim();
}

function getEntryCrLabel(entry) {
  return String(
    entry?.statblock?.level_like ||
      (entry?.statblock?.cr ? `CR ${entry.statblock.cr}` : "") ||
      entry?.statblock?.cr ||
      entry?.cr ||
      entry?.spell_data?.level ||
      entry?.item_data?.rarity ||
      entry?.feat_data?.source_code ||
      entry?.class_data?.hit_die ||
      (entry?.deity_data ? "Лор" : "—")
  ).trim();
}

function getEntryTypeLabel(entry) {
  return String(
    entry?.statblock?.type ||
      entry?.item_data?.type ||
      entry?.spell_data?.school ||
      entry?.feat_data?.source ||
      entry?.class_data?.primary_ability ||
      entry?.deity_data?.setting ||
      entry?.subtitle ||
      BESTIARI_CATEGORY_LABELS[entry?.category] ||
      entry?.category ||
      "Запись"
  ).trim();
}

function getEntryAlignmentLabel(entry) {
  return String(
    entry?.statblock?.alignment ||
      entry?.spell_data?.save ||
      entry?.item_data?.attunement ||
      localizeCodexValue(entry?.deity_data?.alignment_clean || entry?.deity_data?.alignment_raw) ||
      entry?.source ||
      "—"
  ).trim();
}

function getEntryTags(entry, limit = 5) {
  if (entry?.deity_data) {
    const deityTags = getDeityPublicTags(entry, limit);
    if (deityTags.length) return deityTags;
  }
  const raw = Array.isArray(entry?.tags) ? entry.tags : [];
  return raw
    .map((tag) => localizeCodexValue(tag))
    .filter((tag) => tag && !["бог", "божество", "forgotten realms", "5e14", "5e"].includes(String(tag).toLowerCase()))
    .slice(0, limit);
}

function getStatblockMetric(entry, key, fallback = "—") {
  const sb = entry?.statblock || {};
  const value = sb[key];
  if (Array.isArray(value)) return value.join(", ") || fallback;
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function getKnowledgeProgress(entries) {
  const total = Array.isArray(entries) ? entries.length : 0;
  const visible = (entries || []).filter((entry) => entry?.player_visible !== false).length;
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((visible / total) * 100)));
}

function renderBestiariDrawer(title, content, options = {}) {
  if (!content) return "";
  const openAttr = options.open ? " open" : "";
  const icon = options.icon || "✦";
  const meta = options.meta ? `<span class="bestiari-ref-drawer-meta">${escapeHtml(options.meta)}</span>` : "";
  return `
    <details class="bestiari-ref-drawer ${options.className || ""}"${openAttr}>
      <summary>
        <span class="bestiari-ref-drawer-icon">${escapeHtml(icon)}</span>
        <span class="bestiari-ref-drawer-title">${escapeHtml(title)}</span>
        ${meta}
      </summary>
      <div class="bestiari-ref-drawer-body">
        ${content}
      </div>
    </details>
  `;
}

function renderBestiariInfoGrid(items, className = "") {
  const safeItems = (items || []).filter((item) => item && item.value !== undefined && item.value !== null && item.value !== "");
  if (!safeItems.length) return "";
  return `
    <div class="bestiari-ref-info-grid ${className}">
      ${safeItems.map((item) => `
        <div class="bestiari-ref-info-tile">
          <span>${escapeHtml(item.label || "—")}</span>
          <strong>${escapeHtml(item.value || "—")}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function renderBestiariTags(entry, limit = 8) {
  const tags = getEntryTags(entry, limit);
  if (!tags.length) return "";
  return `<div class="bestiari-ref-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>`;
}

function renderEntryImage(entry) {
  const imageUrl = getEntryPrimaryImage(entry);
  const icon = getCategoryIcon(entry?.category);
  if (imageUrl) {
    return `
      <div class="bestiari-ref-portrait bestiari-ref-portrait-image">
        <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(entry.title || "codex image")}">
        <span class="bestiari-ref-portrait-badge">${escapeHtml(icon)}</span>
      </div>
    `;
  }
  return `
    <div class="bestiari-ref-portrait bestiari-ref-portrait-fallback">
      <span class="bestiari-ref-portrait-rune">${escapeHtml(icon)}</span>
      <span class="bestiari-ref-portrait-label">${escapeHtml(BESTIARI_CATEGORY_LABELS[entry?.category] || "Codex")}</span>
    </div>
  `;
}

function renderSideStatPanel(entry) {
  if (!entry) return "";

  if (entry.deity_data) {
    const data = entry.deity_data;
    const sourceUrl = getDeitySourceLink(entry);
    const core = [
      { label: "Сферы", value: compactList(data.portfolio, 5) || "—" },
      { label: "Мировоззрение", value: localizeCodexValue(data.alignment_clean || data.alignment_raw) || "требует сверки" },
      { label: "Домены 5e", value: localizeDomainList(data.domains_5e_candidate) || "требуют сверки" },
      { label: "План", value: data.home_plane || "—" },
      { label: "Прихожане", value: compactList(data.worshippers, 4) || "—" },
      { label: "Символ", value: data.symbol || "—" },
    ];
    return `
      <aside class="bestiari-ref-right-rail bestiari-ref-right-rail-deity">
        <section class="bestiari-ref-rail-card bestiari-ref-deity-rail-card">
          <div class="bestiari-ref-rail-title">Лор божества</div>
          ${renderBestiariInfoGrid(core, "bestiari-ref-rail-info")}
          ${sourceUrl ? `
            <div class="bestiari-ref-source-action">
              <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Открыть полную страницу источника</a>
            </div>
          ` : ""}
        </section>
        ${renderSideSourcesPanel(entry)}
      </aside>
    `;
  }

  const sb = entry.statblock || {};
  const abilityItems = sb.abilities ? [
    ["СИЛ", sb.abilities.str ?? 10],
    ["ЛОВ", sb.abilities.dex ?? 10],
    ["ТЕЛ", sb.abilities.con ?? 10],
    ["ИНТ", sb.abilities.int ?? 10],
    ["МДР", sb.abilities.wis ?? 10],
    ["ХАР", sb.abilities.cha ?? 10],
  ] : [];

  const core = [];
  if (sb.ac) core.push({ label: "Класс брони", value: sb.ac });
  if (sb.hp) core.push({ label: "Хиты", value: sb.hp });
  if (sb.speed) core.push({ label: "Скорость", value: sb.speed });
  if (sb.initiative) core.push({ label: "Инициатива", value: sb.initiative });
  if (entry.spell_data) {
    core.push(
      { label: "Круг", value: entry.spell_data.level || "—" },
      { label: "Школа", value: entry.spell_data.school || "—" },
      { label: "Дистанция", value: entry.spell_data.range || "—" },
      { label: "Спасбросок", value: entry.spell_data.save || "—" }
    );
  }
  if (entry.item_data) {
    core.push(
      { label: "Тип", value: entry.item_data.type || "—" },
      { label: "Редкость", value: entry.item_data.rarity || "—" },
      { label: "Слот", value: entry.item_data.slot || "—" },
      { label: "Настройка", value: entry.item_data.attunement || "—" }
    );
  }

  return `
    <aside class="bestiari-ref-right-rail">
      <section class="bestiari-ref-rail-card">
        <div class="bestiari-ref-rail-title">Игровые характеристики</div>
        ${abilityItems.length ? `
          <div class="bestiari-ref-ability-mini-grid">
            ${abilityItems.map(([label, score]) => `
              <div>
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(String(score))}</strong>
                <small>${escapeHtml(getAbilityMod(score))}</small>
              </div>
            `).join("")}
          </div>
        ` : ""}
        ${renderBestiariInfoGrid(core.slice(0, 8), "bestiari-ref-rail-info")}
      </section>

      ${renderSideLootPanel(entry)}
      ${renderSideSourcesPanel(entry)}
    </aside>
  `;
}

function renderSideLootPanel(entry) {
  const loot = Array.isArray(entry?.loot) ? entry.loot : [];
  const rewards = Array.isArray(entry?.rewards) ? entry.rewards : [];
  const itemProps = Array.isArray(entry?.item_data?.properties) ? entry.item_data.properties.slice(0, 4) : [];
  const combined = [...loot, ...rewards, ...itemProps].slice(0, 6);
  if (!combined.length && !entry?.item_data) return "";
  return `
    <section class="bestiari-ref-rail-card">
      <div class="bestiari-ref-rail-title">Добыча / свойства</div>
      <div class="bestiari-ref-loot-grid">
        ${(combined.length ? combined : ["Нет данных"])
          .map((item) => `<span>${escapeHtml(typeof item === "string" ? item : item?.name || item?.title || "Трофей")}</span>`)
          .join("")}
      </div>
    </section>
  `;
}

function renderSideSourcesPanel(entry) {
  const isDeity = Boolean(entry?.deity_data);
  const sourceUrl = getDeitySourceLink(entry);
  const sources = [entry?.source, ...(Array.isArray(entry?.sources) ? entry.sources : [])]
    .filter(Boolean)
    .map((source) => String(source || "").trim())
    .filter((source) => source && !/^https?:\/\//i.test(source));
  const related = Array.isArray(entry?.related) ? entry.related.slice(0, 4) : [];

  return `
    <section class="bestiari-ref-rail-card">
      <div class="bestiari-ref-rail-title">${isDeity ? "Источник и связи" : "Источники знаний"}</div>
      <div class="bestiari-ref-source-list">
        ${(sources.length ? sources : [isDeity ? "RPG Fandom / Forgotten Realms" : "Локальная база"])
          .slice(0, 3)
          .map((source) => `<div><span>◈</span><strong>${escapeHtml(source)}</strong></div>`)
          .join("")}
      </div>
      ${sourceUrl ? `<div class="bestiari-ref-source-action"><a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Открыть источник</a></div>` : ""}
      ${related.length ? `<div class="bestiari-ref-related-mini">${related.map((item) => `<button type="button" data-bestiari-related="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}</div>` : ""}
    </section>
  `;
}

function renderCategoryButtons(entries) {
  const stats = countByCategory(entries);
  const categoryOrder = ["monsters", "gods", "events", "items", "spells", "feats", "locations", "lore", "mechanics", "classes", "races", "factions", "conditions"];
  const allButton = `
    <button
      class="bestiari-ref-category ${BESTIARI_STATE.category === "all" ? "active" : ""}"
      type="button"
      data-bestiari-category="all"
    >
      <span>${escapeHtml(getCategoryIcon("all"))}</span>
      <strong>Все</strong>
      <em>${entries.length}</em>
    </button>
  `;
  const buttons = categoryOrder
    .filter((key) => BESTIARI_CATEGORY_LABELS[key])
    .map((key) => {
      const active = BESTIARI_STATE.category === key ? "active" : "";
      const count = stats[key] || 0;
      return `
        <button
          class="bestiari-ref-category ${active}"
          type="button"
          data-bestiari-category="${escapeHtml(key)}"
        >
          <span>${escapeHtml(getCategoryIcon(key))}</span>
          <strong>${escapeHtml(BESTIARI_CATEGORY_LABELS[key])}</strong>
          <em>${count}</em>
        </button>
      `;
    })
    .join("");
  return `${allButton}${buttons}`;
}


function renderEditorPanel() {
  if (!BESTIARI_STATE.editorOpen || !BESTIARI_STATE.draft) return "";
  const d = BESTIARI_STATE.draft;

  return renderBestiariDrawer(
    BESTIARI_STATE.editorMode === "edit" ? "Редактор записи" : "Новая запись",
    `
      <input id="bestiariDraftId" type="hidden" value="${escapeHtml(d.id)}">

      <div class="bestiari-ref-editor-grid">
        <div class="filter-group">
          <label>Категория</label>
          <select id="bestiariDraftCategory">
            ${Object.entries(BESTIARI_CATEGORY_LABELS)
              .filter(([key]) => key !== "all")
              .map(([key, label]) => `<option value="${escapeHtml(key)}" ${d.category === key ? "selected" : ""}>${escapeHtml(label)}</option>`)
              .join("")}
          </select>
        </div>
        <div class="filter-group bestiari-ref-editor-wide">
          <label>Название</label>
          <input id="bestiariDraftTitle" type="text" value="${escapeHtml(d.title)}">
        </div>
        <div class="filter-group">
          <label>Источник</label>
          <input id="bestiariDraftSource" type="text" value="${escapeHtml(d.source)}">
        </div>
        <div class="filter-group bestiari-ref-editor-wide">
          <label>Подзаголовок</label>
          <input id="bestiariDraftSubtitle" type="text" value="${escapeHtml(d.subtitle)}">
        </div>
        <div class="filter-group">
          <label>Теги</label>
          <input id="bestiariDraftTags" type="text" value="${escapeHtml(d.tags)}" placeholder="монстр, огонь, магия">
        </div>
        <div class="filter-group">
          <label>Связанные ID</label>
          <input id="bestiariDraftRelated" type="text" value="${escapeHtml(d.related)}" placeholder="spell-fireball, class-wizard">
        </div>
        <div class="filter-group bestiari-ref-editor-full">
          <label>Краткая сводка</label>
          <textarea id="bestiariDraftSummary" rows="3">${escapeHtml(d.summary)}</textarea>
        </div>
        <div class="filter-group">
          <label>Основное описание</label>
          <textarea id="bestiariDraftBody" rows="6">${escapeHtml(d.body)}</textarea>
        </div>
        <div class="filter-group">
          <label>Полное описание</label>
          <textarea id="bestiariDraftFullDescription" rows="6">${escapeHtml(d.full_description)}</textarea>
        </div>
        <div class="filter-group">
          <label>Статблок (key: value)</label>
          <textarea id="bestiariDraftStatblock" rows="8" placeholder="ac: 15&#10;hp: 120 (16к10+32)&#10;speed: 30 фт&#10;str: 18">${escapeHtml(d.statblock_text)}</textarea>
        </div>
        <div class="filter-group">
          <label>Доп. механики / JSON</label>
          <textarea id="bestiariDraftMechanics" rows="8" placeholder='{"short_rules":["..."],"examples":["..."]}'>${escapeHtml(d.mechanics_text)}</textarea>
        </div>
      </div>

      <div class="bestiari-ref-editor-footer">
        <label class="inline-checkbox"><input id="bestiariDraftPlayerVisible" type="checkbox" ${d.player_visible ? "checked" : ""}> Видно игроку</label>
        <label class="inline-checkbox"><input id="bestiariDraftGmOnly" type="checkbox" ${d.gm_only ? "checked" : ""}> GM-only</label>
        <span class="bestiari-ref-editor-spacer"></span>
        <button class="btn btn-success" type="button" id="bestiariSaveDraftBtn">Сохранить</button>
        <button class="btn" type="button" id="bestiariCancelDraftBtn">Отмена</button>
      </div>
    `,
    { open: true, icon: "✎", className: "bestiari-ref-editor-drawer", meta: BESTIARI_STATE.editorMode === "edit" ? "правка" : "создание" }
  );
}


function renderImportPanel() {
  if (!BESTIARI_STATE.importOpen) return "";
  return renderBestiariDrawer(
    "Импорт базы знаний",
    `
      <div class="filter-group">
        <label>Вставь JSON</label>
        <textarea id="bestiariImportTextarea" rows="10" placeholder="{&quot;entries&quot;:[...]}"></textarea>
      </div>
      <div class="modal-actions bestiari-ref-import-actions">
        <button class="btn btn-success" type="button" id="bestiariApplyImportBtn">Применить JSON</button>
        <button class="btn" type="button" id="bestiariCloseImportBtn">Закрыть</button>
      </div>
    `,
    { open: true, icon: "⇩", className: "bestiari-ref-import-drawer", meta: "JSON" }
  );
}


function renderEntryList(entries, selected) {
  if (!entries.length) {
    return `
      <div class="bestiari-ref-empty">
        <div class="bestiari-ref-empty-icon">◇</div>
        <strong>Ничего не найдено</strong>
        <span>Попробуй другой запрос, категорию или импортируй записи.</span>
      </div>
    `;
  }

  return `
    <div class="bestiari-ref-list">
      ${entries
        .map((entry) => {
          const active = entry.id === selected?.id ? "active" : "";
          const icon = getCategoryIcon(entry.category);
          const summary = truncateText(entry.summary || entry.body?.[0] || "", 80);
          const cr = getEntryCrLabel(entry);
          return `
            <button
              class="bestiari-ref-row ${active}"
              type="button"
              data-bestiari-entry="${escapeHtml(entry.id)}"
            >
              <span class="bestiari-ref-row-icon">${escapeHtml(icon)}</span>
              <span class="bestiari-ref-row-copy">
                <span class="bestiari-ref-row-title">${escapeHtml(entry.title)}</span>
                <span class="bestiari-ref-row-subtitle">${escapeHtml(cr)} • ${escapeHtml(getEntryTypeLabel(entry))}</span>
                ${summary ? `<span class="bestiari-ref-row-summary">${escapeHtml(summary)}</span>` : ""}
              </span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}


function renderInfoPanels(entry) {
  const panels = Array.isArray(entry.info_panels) ? entry.info_panels : [];
  const extraPanels = [];

  if (entry.spell_data) {
    extraPanels.push(
      { label: "Круг", value: entry.spell_data.level || "—" },
      { label: "Школа", value: entry.spell_data.school || "—" },
      { label: "Дистанция", value: entry.spell_data.range || "—" },
      { label: "Время", value: entry.spell_data.casting_time || "—" }
    );
  }
  if (entry.item_data) {
    extraPanels.push(
      { label: "Редкость", value: entry.item_data.rarity || "—" },
      { label: "Тип", value: entry.item_data.type || "—" },
      { label: "Слот", value: entry.item_data.slot || "—" },
      { label: "Настройка", value: entry.item_data.attunement || "—" }
    );
  }
  if (entry.class_data) {
    extraPanels.push(
      { label: "Кость хитов", value: entry.class_data.hit_die || "—" },
      { label: "Осн. хар-ка", value: entry.class_data.primary_ability || "—" },
      { label: "Спасброски", value: (entry.class_data.saves || []).join(", ") || "—" },
      { label: "Ключевые черты", value: (entry.class_data.core_features || []).slice(0, 2).join(", ") || "—" }
    );
  }
  if (entry.statblock) {
    extraPanels.push(
      { label: "КД", value: entry.statblock.ac || "—" },
      { label: "Хиты", value: entry.statblock.hp || "—" },
      { label: "Скорость", value: entry.statblock.speed || "—" },
      { label: "Размер", value: entry.statblock.size || "—" },
      { label: "Тип", value: entry.statblock.type || "—" },
      { label: "Чувства", value: (entry.statblock.senses || []).join(", ") || "—" },
      { label: "Языки", value: (entry.statblock.languages || []).join(", ") || "—" }
    );
  }

  const merged = [...panels, ...extraPanels].filter((item) => item && item.value);
  return renderBestiariInfoGrid(merged.slice(0, 8));
}


function renderAbilities(statblock) {
  if (!statblock?.abilities) return "";
  const labels = [
    ["str", "СИЛ"],
    ["dex", "ЛОВ"],
    ["con", "ТЕЛ"],
    ["int", "ИНТ"],
    ["wis", "МДР"],
    ["cha", "ХАР"],
  ];
  return `
    <div class="bestiari-ref-ability-grid">
      ${labels.map(([key, label]) => {
        const rawScore = statblock.abilities[key] ?? 10;
        const score = rawScore && typeof rawScore === "object" ? rawScore.score ?? rawScore.value ?? 10 : rawScore;
        const mod = rawScore && typeof rawScore === "object" && rawScore.modifier !== undefined
          ? (Number(rawScore.modifier) >= 0 ? `+${Number(rawScore.modifier)}` : String(rawScore.modifier))
          : getAbilityMod(score);
        return `
          <div>
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(String(score))}</strong>
            <small>${escapeHtml(mod)}</small>
          </div>
        `;
      }).join("")}
    </div>
  `;
}


function renderNamedList(title, items) {
  if (!items || !items.length) return "";
  return renderBestiariDrawer(
    title,
    `<div class="bestiari-ref-named-list">
      ${items.map((item) => {
        if (typeof item === "string") {
          return `<div><span>•</span><p>${escapeHtml(item)}</p></div>`;
        }
        return `
          <div>
            <span>✦</span>
            <p><strong>${escapeHtml(item.name || "Элемент")}</strong>${item.text ? `<br>${escapeHtml(item.text)}` : ""}</p>
          </div>
        `;
      }).join("")}
    </div>`,
    { icon: "☰", meta: String(items.length) }
  );
}


function renderStatblock(entry) {
  if (entry?.deity_data) return "";
  const sb = entry.statblock;
  if (!sb) return "";
  const expanded = BESTIARI_STATE.showFullStats;

  const baseMeta = [
    sb.size && `Размер: ${sb.size}`,
    sb.type && `Тип: ${sb.type}`,
    sb.alignment && `Мировоззрение: ${sb.alignment}`,
    sb.senses?.length ? `Чувства: ${sb.senses.join(", ")}` : "",
    sb.languages?.length ? `Языки: ${sb.languages.join(", ")}` : "",
  ].filter(Boolean);

  const coreGrid = renderBestiariInfoGrid([
    { label: "КД", value: sb.ac || "—" },
    { label: "Хиты", value: sb.hp || "—" },
    { label: "Скорость", value: sb.speed || "—" },
    { label: "Опасность", value: sb.cr ? `CR ${sb.cr}` : sb.level_like || "—" },
    { label: "Бонус мастерства", value: sb.proficiency_bonus || "—" },
    { label: "Опыт", value: sb.xp || "—" },
  ], "bestiari-ref-monster-core-grid");

  const content = `
    ${baseMeta.length ? `<div class="bestiari-ref-meta-line">${baseMeta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
    ${coreGrid}
    ${renderAbilities(sb)}
    ${expanded ? `
      ${renderNamedList("Спасброски", sb.saves || [])}
      ${renderNamedList("Навыки", sb.skills || [])}
      ${renderNamedList("Сопротивления", sb.resistances || [])}
      ${renderNamedList("Иммунитеты", sb.immunities || [])}
      ${renderNamedList("Уязвимости", sb.vulnerabilities || [])}
      ${renderNamedList("Иммунитеты к состояниям", sb.conditions_immunity || [])}
      ${renderNamedList("Особенности", sb.traits || [])}
      ${renderNamedList("Действия", sb.actions || [])}
      ${renderNamedList("Бонусные действия", sb.bonus_actions || [])}
      ${renderNamedList("Реакции", sb.reactions || [])}
      ${renderNamedList("Легендарные действия", sb.legendary_actions || [])}
      ${renderNamedList("Мифические действия", sb.mythic_actions || [])}
      ${renderNamedList("Действия логова", sb.lair_actions || [])}
      ${renderNamedList("Эффекты логова", sb.lair_effects || [])}
      ${renderNamedList("Региональные эффекты", sb.regional_effects || [])}
    ` : ""}
    <div class="bestiari-ref-inline-actions">
      <button class="btn" type="button" id="bestiariToggleStatsBtn">${expanded ? "Скрыть полный статблок" : "Показать полный статблок"}</button>
    </div>
  `;

  return renderBestiariDrawer("Статблок", content, { open: true, icon: "☠", meta: getEntryCrLabel(entry), className: "bestiari-ref-statblock-drawer" });
}


function renderMechanics(entry) {
  if (!entry.mechanics) return "";
  const shortRules = Array.isArray(entry.mechanics.short_rules) ? entry.mechanics.short_rules : [];
  const examples = Array.isArray(entry.mechanics.examples) ? entry.mechanics.examples : [];
  const content = `
    ${shortRules.length ? `<div class="bestiari-ref-named-list">${shortRules.map((item) => `<div><span>•</span><p>${escapeHtml(item)}</p></div>`).join("")}</div>` : ""}
    ${examples.length ? renderBestiariDrawer("Примеры", `<div class="bestiari-ref-named-list">${examples.map((item) => `<div><span>◇</span><p>${escapeHtml(item)}</p></div>`).join("")}</div>`, { icon: "◇", meta: String(examples.length) }) : ""}
  `;
  return renderBestiariDrawer("Механика", content, { open: false, icon: "⚙", meta: String(shortRules.length || 0) });
}


function renderFullDescription(entry) {
  const mainBody = Array.isArray(entry.body) ? entry.body.filter(Boolean) : [];
  const fullBody = Array.isArray(entry.full_description) ? entry.full_description.filter(Boolean) : [];
  const isDeity = Boolean(entry?.deity_data);

  if (isDeity) {
    const fullLore = entry.deity_data?.full_lore || {};
    const fullLoreParagraphs = dedupeLoreParagraphs(Array.isArray(fullLore.paragraphs) ? fullLore.paragraphs : []);
    const fullLoreSections = Array.isArray(fullLore.sections)
      ? fullLore.sections
          .map((section) => {
            const title = String(section?.title || "Раздел").replace(/\s+/g, " ").trim();
            const paragraphs = dedupeLoreParagraphs(
              Array.isArray(section?.paragraphs) && section.paragraphs.length
                ? section.paragraphs
                : section?.text
                  ? String(section.text).split(/\n{2,}|\r?\n/)
                  : []
            );
            return { title, paragraphs };
          })
          .filter((section) => section.title && section.paragraphs.length)
      : [];
    const hasFullLore = Boolean(fullLore.available && (fullLoreParagraphs.length || fullLoreSections.length || fullBody.length));
    const sourceUrl = getDeitySourceLink(entry);

    const contentParts = [];

    if (fullLoreParagraphs.length) {
      contentParts.push(`
        <div class="bestiari-ref-description-flow bestiari-ref-description-flow-deity bestiari-ref-deity-lead-flow">
          ${fullLoreParagraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
        </div>
      `);
    }

    if (fullLoreSections.length) {
      contentParts.push(`
        <div class="bestiari-ref-deity-full-sections">
          ${fullLoreSections.map((section) => `
            <section class="bestiari-ref-deity-full-section">
              <h4>${escapeHtml(section.title || "Раздел")}</h4>
              <div class="bestiari-ref-description-flow bestiari-ref-description-flow-deity">
                ${section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
              </div>
            </section>
          `).join("")}
        </div>
      `);
    }

    if (!contentParts.length) {
      const allText = dedupeLoreParagraphs(hasFullLore ? fullBody : [...mainBody, ...fullBody]);
      contentParts.push(allText.length
        ? `<div class="bestiari-ref-description-flow bestiari-ref-description-flow-deity">${allText
            .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
            .join("")}</div>`
        : `<div class="bestiari-ref-description-flow bestiari-ref-description-flow-deity"><p>Описание пока не заполнено. Для этой карточки нужен отдельный canon-pass.</p></div>`);
    }

    const dogmaBlock = fullLore.dogma
      ? renderBestiariDrawer("Догма / учение", `<div class="bestiari-ref-description-flow bestiari-ref-description-flow-deity"><p>${escapeHtml(fullLore.dogma)}</p></div>`, { open: false, icon: "☉", meta: "черновик" })
      : "";

    const churchBlock = fullLore.church
      ? renderBestiariDrawer("Церковь и культ", `<div class="bestiari-ref-description-flow bestiari-ref-description-flow-deity"><p>${escapeHtml(fullLore.church)}</p></div>`, { open: false, icon: "⚜", meta: "черновик" })
      : "";

    const sourceHint = `<div class="bestiari-ref-source-hint bestiari-ref-source-hint-deity">
      <span>${hasFullLore ? "Полный lore-текст подтянут из источника как черновик. Его ещё нужно вычитать под стиль D&D Trader." : "В локальном JSON пока только краткая выжимка. Для настоящего фулла запусти round2 full-lore enricher."}</span>
      ${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Открыть страницу источника</a>` : ""}
    </div>`;

    return renderBestiariDrawer("Описание божества", `${contentParts.join("")}${dogmaBlock}${churchBlock}${sourceHint}`, {
      open: true,
      icon: "✥",
      meta: hasFullLore ? "полный черновик" : "краткий черновик",
      className: "bestiari-ref-deity-description-drawer"
    });
  }

  const isItem = Boolean(entry?.item_data);
  const hasLong = fullBody.length > 0 || mainBody.length > 1;
  const expanded = isItem ? true : BESTIARI_STATE.showFullDescription;
  const textToRender = expanded
    ? [...mainBody, ...fullBody]
    : mainBody.length
      ? [mainBody[0]]
      : fullBody.length
        ? [fullBody[0]]
        : [];

  const textHtml = textToRender.length
    ? `<div class="bestiari-ref-description-flow ${isItem ? "bestiari-ref-description-flow-item" : ""}">${textToRender
        .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
        .join("")}</div>`
    : `<div class="bestiari-ref-description-flow"><p>Описание пока не заполнено.</p></div>`;

  const action = hasLong && !isItem
    ? `<div class="bestiari-ref-inline-actions"><button class="btn" type="button" id="bestiariToggleDescriptionBtn">${expanded ? "Свернуть описание" : "Полное описание"}</button></div>`
    : "";

  return renderBestiariDrawer(isItem ? "Описание предмета" : "Описание", `${textHtml}${action}`, {
    open: true,
    icon: "✥",
    meta: isItem ? (hasLong ? "полный текст" : "кратко") : (hasLong ? "есть полный текст" : "кратко"),
    className: isItem ? "bestiari-ref-item-description-drawer" : ""
  });
}

function getSpellComponentsText(data = {}) {
  const explicit = String(data.components_display || data.componentsDisplay || "").trim();
  if (explicit && !/^\[object object\]$/i.test(explicit)) return explicit;

  const components = data.components;
  if (!components) return "—";
  if (typeof components === "string") {
    const text = components.trim();
    return text && !/^\[object object\]$/i.test(text) ? text : "—";
  }
  if (typeof components === "object") {
    const flags = [];
    if (components.v) flags.push("В");
    if (components.s) flags.push("С");
    if (components.m) flags.push("М");
    let text = String(components.display || components.raw || flags.join(", ") || "").trim();
    const material = String(components.material || components.reagents || data.reagents || "").trim();
    if (material && text && !text.includes(material)) text += ` (${material})`;
    if (!text && material) text = `М (${material})`;
    return text || "—";
  }
  return String(components || "—");
}

function getSpellHigherLevelLines(data = {}) {
  const raw = data.higher_levels || data.higherLevels || data.upcast || [];
  const lines = Array.isArray(raw) ? raw : String(raw || "").split(/\n{2,}|\r?\n/);
  return lines
    .map((item) => String(item || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^на больших уровнях\.?$/i.test(line) && !/^на более высоких уровнях\.?$/i.test(line));
}

function renderSpellTagGroup(values = [], className = "") {
  const list = Array.isArray(values) ? values : splitCsv(values);
  const cleaned = list.map((item) => String(item || "").trim()).filter(Boolean);
  if (!cleaned.length) return "";
  return `<div class="bestiari-ref-tags ${className}">${cleaned.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`;
}

function renderSpellSection(entry) {
  const data = entry.spell_data;
  if (!data) return "";

  const higherLevels = getSpellHigherLevelLines(data);
  const componentsText = getSpellComponentsText(data);
  const classes = Array.isArray(data.classes) ? data.classes : splitCsv(data.classes);
  const subclasses = Array.isArray(data.subclasses) ? data.subclasses : splitCsv(data.subclasses);

  const content = `
    ${renderBestiariInfoGrid([
      { label: "Время", value: data.casting_time || "—" },
      { label: "Дистанция", value: data.range || "—" },
      { label: "Компоненты", value: componentsText || "—" },
      { label: "Длительность", value: data.duration || "—" },
      { label: "Концентрация", value: data.concentration ? "Да" : "Нет" },
      { label: "Ритуал", value: data.ritual ? "Да" : "Нет" },
      { label: "Урон / эффект", value: data.damage || (Array.isArray(data.damage_types_round1) ? data.damage_types_round1.join(", ") : "—") || "—" },
      { label: "Спасбросок", value: data.save || (Array.isArray(data.saving_throws_round1) ? data.saving_throws_round1.join(", ") : "—") || "—" },
    ])}
    ${renderSpellTagGroup(classes, "bestiari-ref-spell-class-tags")}
    ${renderSpellTagGroup(subclasses, "bestiari-ref-spell-subclass-tags")}
    ${higherLevels.length ? `
      <div class="bestiari-ref-spell-upcast">
        <div class="bestiari-ref-kicker">На больших уровнях</div>
        <div class="bestiari-ref-description-flow">
          ${higherLevels.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
        </div>
      </div>
    ` : ""}
  `;
  return renderBestiariDrawer("Параметры заклинания", content, { icon: "✧", meta: data.level || "spell" });
}

function renderItemSection(entry) {
  const data = entry.item_data;
  if (!data) return "";

  const armor = data.armor || {};
  const weapon = data.weapon || {};
  const tool = data.tool || {};
  const equip = data.equip || {};
  const use = data.use || {};
  const reviewFlags = Array.isArray(data.review?.flags) ? data.review.flags : [];

  const armorRows = data.armor ? [
    { label: "КД", value: armor.armor_class_text || armor.armor_class || armor.ac_bonus || "—" },
    { label: "Тип брони", value: armor.armor_type || "—" },
    { label: "Сила", value: armor.strength_required || "—" },
    { label: "Скрытность", value: armor.stealth_disadvantage ? "Помеха" : "—" },
  ] : [];

  const weaponRows = data.weapon ? [
    { label: "Урон", value: weapon.damage?.raw || [weapon.damage?.dice, weapon.damage?.type].filter(Boolean).join(" ") || "—" },
    { label: "Роль", value: weapon.combat_role || "—" },
    { label: "Владение", value: weapon.proficiency_group || "—" },
    { label: "Свойства", value: weapon.properties_raw || (Array.isArray(weapon.properties) ? weapon.properties.join(", ") : "—") },
  ] : [];

  const toolContents = Array.isArray(tool.contents_guess) ? tool.contents_guess : [];
  const links = data.links && typeof data.links === "object" ? data.links : {};
  const spellLinks = Array.isArray(links.spell_links) ? links.spell_links : [];
  const inlineLinks = Array.isArray(links.inline_links) ? links.inline_links : [];
  const sectionBuckets = data.mechanics?.section_buckets && typeof data.mechanics.section_buckets === "object" ? data.mechanics.section_buckets : {};
  const mechanicsHighlights = [];
  for (const [bucketKey, bucket] of Object.entries(sectionBuckets)) {
    const bucketLines = normalizeTextBlock(bucket?.raw_lines || bucket?.lines || bucket);
    if (!bucketLines.length) continue;
    mechanicsHighlights.push(`${bucketKey}: ${bucketLines.slice(0, 3).join(" / ")}`);
  }

  const content = `
    ${renderBestiariInfoGrid([
      { label: "Категория", value: data.ui_category || data.type || "—" },
      { label: "Группа", value: data.display_group || "—" },
      { label: "Подтип", value: data.item_subtype || "—" },
      { label: "Источник", value: [data.source_family, data.source_code].filter(Boolean).join(" / ") || "—" },
      { label: "Редкость", value: data.rarity || "—" },
      { label: "Цена", value: data.price_raw || data.value_gp || "—" },
      { label: "Вес", value: data.weight_raw || data.weight_lb || "—" },
      { label: "Слот", value: data.slot || equip.slot || "—" },
      { label: "Использование", value: use.action_type || "—" },
      { label: "Расходник", value: use.consumable ? "Да" : "Нет" },
    ])}
    ${armorRows.length ? renderBestiariDrawer("Броня / защита", renderBestiariInfoGrid(armorRows), { icon: "🛡", meta: armor.armor_type || "armor", open: true }) : ""}
    ${weaponRows.length ? renderBestiariDrawer("Оружие / атака", renderBestiariInfoGrid(weaponRows), { icon: "⚔", meta: weapon.weapon_family || "weapon", open: true }) : ""}
    ${toolContents.length ? renderBestiariDrawer("Состав / содержимое", `<div class="bestiari-ref-named-list">${toolContents.map((item) => `<div><span>•</span><p>${escapeHtml(item)}</p></div>`).join("")}</div>`, { icon: "☑", meta: String(toolContents.length), open: true }) : ""}
    ${mechanicsHighlights.length ? renderBestiariDrawer("Выделенная механика", `<div class="bestiari-ref-named-list">${mechanicsHighlights.map((item) => `<div><span>✦</span><p>${escapeHtml(item)}</p></div>`).join("")}</div>`, { icon: "✦", meta: String(mechanicsHighlights.length), open: false }) : ""}
    ${spellLinks.length || inlineLinks.length ? renderBestiariDrawer("Связи источника", `<div class="bestiari-ref-named-list">${[...spellLinks, ...inlineLinks].slice(0, 24).map((item) => `<div><span>⇄</span><p>${escapeHtml(item?.title || item?.label || item?.name || item?.url || item)}</p></div>`).join("")}</div>`, { icon: "⇄", meta: String(spellLinks.length + inlineLinks.length), open: false }) : ""}
    ${(data.properties || []).length ? `<div class="bestiari-ref-named-list">${data.properties.map((item) => `<div><span>•</span><p>${escapeHtml(item)}</p></div>`).join("")}</div>` : ""}
    ${reviewFlags.length ? renderBestiariDrawer("Review", `<div class="bestiari-ref-named-list">${reviewFlags.map((item) => `<div><span>!</span><p>${escapeHtml(item)}</p></div>`).join("")}</div>`, { icon: "!", meta: String(reviewFlags.length), open: false }) : ""}
  `;
  return renderBestiariDrawer("Параметры предмета", content, { icon: "◈", meta: data.rarity || "item", open: true });
}


function getClassSubclassGroups(subclasses = []) {
  const groups = [
    { key: "official", label: "Официальные", hint: "книги", items: [] },
    { key: "ua", label: "Unearthed Arcana", hint: "UA", items: [] },
    { key: "homebrew", label: "Homebrew", hint: "черновики", items: [] },
    { key: "other", label: "Прочее", hint: "проверить", items: [] },
  ];
  const byKey = new Map(groups.map((group) => [group.key, group]));

  for (const subclass of subclasses) {
    const rawStatus = String(subclass?.status || "").toLowerCase().trim();
    const key = byKey.has(rawStatus) ? rawStatus : "other";
    byKey.get(key).items.push(subclass);
  }

  return groups.filter((group) => group.items.length);
}

function getClassSubclassStatusLabel(status) {
  const raw = String(status || "").toLowerCase().trim();
  if (raw === "official") return "официальный";
  if (raw === "ua") return "UA";
  if (raw === "homebrew") return "Homebrew";
  return raw || "проверить";
}

function renderClassSubclassFeature(feature = {}) {
  const name = safeText(feature.name, "Умение");
  const level = feature.level !== undefined && feature.level !== null && feature.level !== ""
    ? `${feature.level} ур.`
    : "";
  const paragraphs = Array.isArray(feature.paragraphs)
    ? feature.paragraphs.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const text = paragraphs.length ? paragraphs.join(" ") : safeText(feature.text);

  return `
    <article class="bestiari-ref-class-feature-card">
      <div class="bestiari-ref-class-feature-head">
        <strong>${escapeHtml(name)}</strong>
        ${level ? `<span>${escapeHtml(level)}</span>` : ""}
      </div>
      ${text ? `<p>${escapeHtml(text)}</p>` : ""}
    </article>
  `;
}

function renderClassSubclassDetail(subclass = {}, groupKey = "", index = 0, isActive = false) {
  const name = safeText(subclass.name, "Подкласс");
  const status = getClassSubclassStatusLabel(subclass.status);
  const paragraphs = Array.isArray(subclass.paragraphs)
    ? subclass.paragraphs.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const features = Array.isArray(subclass.features_round1) ? subclass.features_round1 : [];
  const summary = safeText(subclass.summary) || paragraphs[0] || "Описание подкласса пока не выделено.";

  return `
    <section
      class="bestiari-ref-class-subclass-detail ${isActive ? "is-active" : ""}"
      data-class-subclass-detail="${escapeHtml(groupKey)}"
      data-class-subclass-index="${escapeHtml(index)}"
    >
      <div class="bestiari-ref-class-subclass-hero">
        <div>
          <span>${escapeHtml(status)}</span>
          <h4>${escapeHtml(name)}</h4>
        </div>
        <small>${escapeHtml(String(features.length || 0))} умений</small>
      </div>
      <div class="bestiari-ref-description-flow bestiari-ref-class-subclass-text">
        ${paragraphs.length
          ? paragraphs.slice(0, 5).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")
          : `<p>${escapeHtml(summary)}</p>`}
      </div>
      ${features.length ? `
        <div class="bestiari-ref-class-feature-grid">
          ${features.map((feature) => renderClassSubclassFeature(feature)).join("")}
        </div>
      ` : `
        <div class="bestiari-ref-class-subclass-empty">Умения подкласса пока не выделились в round1. Нужен clean/hotfix-pass.</div>
      `}
    </section>
  `;
}

function renderClassSubclasses(entry) {
  const data = entry.class_data || {};
  const subclasses = Array.isArray(data.subclasses_round1) ? data.subclasses_round1 : [];
  if (!subclasses.length) {
    return renderBestiariDrawer(
      "Подклассы",
      `<div class="bestiari-ref-class-subclass-empty">
        В этом round1 подклассы не выделились отдельными сущностями. Текст может быть в полном описании, но нужен отдельный parser hotfix/clean-pass.
      </div>`,
      { icon: "◇", meta: "0", open: false, className: "bestiari-ref-class-subclasses-drawer" }
    );
  }

  const groups = getClassSubclassGroups(subclasses);
  const activeGroup = groups[0]?.key || "official";

  const content = `
    <div class="bestiari-ref-class-subclasses" data-class-subclasses-root>
      <div class="bestiari-ref-class-subclass-group-tabs" role="tablist" aria-label="Типы подклассов">
        ${groups.map((group, groupIndex) => `
          <button
            type="button"
            class="${group.key === activeGroup ? "is-active" : ""}"
            data-class-subclass-group="${escapeHtml(group.key)}"
          >
            <strong>${escapeHtml(group.label)}</strong>
            <span>${escapeHtml(String(group.items.length))}</span>
          </button>
        `).join("")}
      </div>

      ${groups.map((group) => `
        <div class="bestiari-ref-class-subclass-panel ${group.key === activeGroup ? "is-active" : ""}" data-class-subclass-panel="${escapeHtml(group.key)}">
          <div class="bestiari-ref-class-subclass-rail" role="tablist" aria-label="${escapeHtml(group.label)}">
            ${group.items.map((subclass, index) => `
              <button
                type="button"
                class="${index === 0 ? "is-active" : ""}"
                data-class-subclass-chip="${escapeHtml(group.key)}"
                data-class-subclass-index="${escapeHtml(index)}"
              >
                <span>${escapeHtml(subclass.name || "Подкласс")}</span>
                <small>${escapeHtml(String((subclass.features_round1 || []).length || 0))}</small>
              </button>
            `).join("")}
          </div>
          <div class="bestiari-ref-class-subclass-details">
            ${group.items.map((subclass, index) => renderClassSubclassDetail(subclass, group.key, index, index === 0)).join("")}
          </div>
        </div>
      `).join("")}
    </div>
  `;

  return renderBestiariDrawer("Подклассы", content, {
    icon: "◇",
    meta: `${subclasses.length} / tabs`,
    open: true,
    className: "bestiari-ref-class-subclasses-drawer"
  });
}

function normalizeClassTableRowsForRender(table = {}) {
  const rawRows = Array.isArray(table.rows) ? table.rows : [];
  const rows = rawRows
    .map((row) => Array.isArray(row)
      ? row.map((cell) => String(cell ?? "").replace(/\s+/g, " ").trim())
      : [])
    .filter((row) => row.some(Boolean));

  const maxCols = Math.max(...rows.map((row) => row.length), 0);
  if (!maxCols) return [];

  return rows.map((row) => Array.from({ length: maxCols }, (_, index) => row[index] || ""));
}

function isClassTableHeaderContinuation(row = [], rowIndex = 0, rows = []) {
  if (rowIndex !== 1 || rows.length < 4) return false;
  const filled = row.map((cell) => String(cell || "").trim()).filter(Boolean);
  if (!filled.length) return false;
  const numericLike = filled.filter((cell) => /^\d+$/.test(cell) || /^[—-]+$/.test(cell)).length;
  return numericLike >= Math.max(3, Math.floor(filled.length * 0.7));
}

function getClassTableLabel(table = {}, index = 0, isPrimary = false) {
  const explicit = safeText(table.title || table.caption);
  if (explicit) return explicit;
  if (isPrimary) return "Прогрессия по уровням";
  const kind = safeText(table.kind);
  if (kind && kind !== "table" && kind !== "progression_or_feature_table") return kind;
  return `Таблица ${index + 1}`;
}

function renderClassTableHtml(table = {}, index = 0, isPrimary = false) {
  const rows = normalizeClassTableRowsForRender(table);
  if (!rows.length) return "";

  const title = getClassTableLabel(table, index, isPrimary);
  const headerCount = isClassTableHeaderContinuation(rows[1], 1, rows) ? 2 : 1;
  const headerRows = rows.slice(0, headerCount);
  const bodyRows = rows.slice(headerCount);
  const rowCount = bodyRows.length || rows.length;
  const colCount = rows[0]?.length || 0;

  return `
    <section class="bestiari-ref-class-table-card ${isPrimary ? "is-primary" : ""}">
      <div class="bestiari-ref-class-table-title">
        <div>
          <span>${escapeHtml(isPrimary ? "основная таблица" : "round1 table")}</span>
          <strong>${escapeHtml(title)}</strong>
        </div>
        <div class="bestiari-ref-class-table-actions">
          <small>${escapeHtml(String(rowCount))} строк · ${escapeHtml(String(colCount))} колонок</small>
          <button class="bestiari-ref-class-table-fullscreen-btn" type="button" data-class-table-fullscreen title="Открыть таблицу крупно" aria-label="Открыть таблицу крупно">
            ⤢
          </button>
        </div>
      </div>
      <div class="bestiari-ref-class-table-scroll">
        <table class="bestiari-ref-class-table">
          <thead>
            ${headerRows.map((row) => `
              <tr>${row.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr>
            `).join("")}
          </thead>
          <tbody>
            ${bodyRows.map((row) => `
              <tr>${row.map((cell) => `<td>${escapeHtml(cell || "—")}</td>`).join("")}</tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function getPrimaryClassProgressionTable(tables = []) {
  const usable = tables.filter((item) => Array.isArray(item?.rows) && item.rows.length >= 3);
  if (!usable.length) return null;
  return usable.find((item) => {
    const firstRows = (item.rows || []).slice(0, 3).flat().join(" ").toLowerCase();
    return firstRows.includes("уровень") && firstRows.includes("бонус") && firstRows.includes("умения");
  }) || usable[0];
}

function renderClassProgression(data = {}) {
  const tables = Array.isArray(data.progression_tables_round1) ? data.progression_tables_round1 : [];
  const usableTables = tables.filter((item) => Array.isArray(item?.rows) && item.rows.length >= 3);
  if (!usableTables.length) return "";

  const primary = getPrimaryClassProgressionTable(usableTables);
  const extraTables = usableTables.filter((item) => item !== primary).slice(0, 8);
  const primaryRows = normalizeClassTableRowsForRender(primary);
  const primaryBodyRows = primaryRows.slice(isClassTableHeaderContinuation(primaryRows[1], 1, primaryRows) ? 2 : 1);

  const content = `
    <div class="bestiari-ref-class-progression-stack">
      ${renderClassTableHtml(primary, 0, true)}
      ${extraTables.length ? `
        <details class="bestiari-ref-class-extra-tables">
          <summary>
            <span>Дополнительные таблицы round1</span>
            <strong>${escapeHtml(String(extraTables.length))}</strong>
          </summary>
          <div class="bestiari-ref-class-extra-table-list">
            ${extraTables.map((table, index) => renderClassTableHtml(table, index + 1, false)).join("")}
          </div>
        </details>
      ` : ""}
    </div>
  `;

  return renderBestiariDrawer("Таблица прогрессии", content, {
    icon: "▦",
    meta: `${primaryBodyRows.length || "—"} уровней`,
    open: true,
    className: "bestiari-ref-class-progression-drawer"
  });
}

function renderClassFeatures(data = {}) {
  const features = Array.isArray(data.features_round1) ? data.features_round1 : [];
  if (!features.length) return "";
  const content = `
    <div class="bestiari-ref-class-feature-grid bestiari-ref-class-core-feature-grid">
      ${features.slice(0, 28).map((feature) => renderClassSubclassFeature(feature)).join("")}
    </div>
  `;
  return renderBestiariDrawer("Классовые умения", content, {
    icon: "✦",
    meta: String(features.length),
    open: false,
    className: "bestiari-ref-class-features-drawer"
  });
}

function renderClassSection(entry) {
  const data = entry.class_data;
  if (!data) return "";

  const content = `
    ${renderBestiariInfoGrid([
      { label: "Кость хитов", value: data.hit_die || "—" },
      { label: "EN", value: data.en_name || "—" },
      { label: "Источник", value: (data.source_tags || []).join(", ") || entry.source || "—" },
      { label: "Подклассов", value: String((data.subclasses_round1 || []).length || "—") },
    ], "bestiari-ref-class-info-grid")}
    ${renderClassProgression(data)}
    ${renderClassSubclasses(entry)}
    ${renderClassFeatures(data)}
  `;

  return renderBestiariDrawer("Параметры класса", content, {
    icon: "⚔",
    meta: data.hit_die || "class",
    open: true,
    className: "bestiari-ref-class-section-drawer"
  });
}


function renderDeitySection(entry) {
  const data = entry.deity_data;
  if (!data) return "";

  const listBlock = (title, items, icon = "•", options = {}) => {
    const safe = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!safe.length) return "";
    const localizedItems = options.localize
      ? safe.map((item) => localizeCodexValue(item))
      : safe;
    return renderBestiariDrawer(
      title,
      `<div class="bestiari-ref-named-list">
        ${localizedItems.map((item) => `<div><span>${escapeHtml(icon)}</span><p>${escapeHtml(item)}</p></div>`).join("")}
      </div>`,
      { icon, meta: String(safe.length), open: options.open === true }
    );
  };

  const flags = Array.isArray(data.classification_flags) ? data.classification_flags : [];
  const technical = [
    ...(Array.isArray(data.domains_legacy_raw) ? data.domains_legacy_raw.map((item) => `RAW домен: ${item}`) : []),
    ...(Array.isArray(data.domains_unresolved) ? data.domains_unresolved.map((item) => `Проверить домен: ${item}`) : []),
    ...flags.map((flag) => localizeCodexValue(flag)),
  ];

  const content = `
    ${renderBestiariInfoGrid([
      { label: "Имя EN", value: data.en_name || "—" },
      { label: "Мировоззрение", value: localizeCodexValue(data.alignment_clean || data.alignment_raw) || "—" },
      { label: "Домашний план", value: data.home_plane || "—" },
      { label: "Символ", value: data.symbol || "—" },
      { label: "Сеттинг", value: data.setting || "Forgotten Realms" },
      { label: "Статус", value: localizeCodexValue(data.review_status || entry.review_status || "needs_rewrite") },
    ])}
    ${listBlock("Сферы влияния", data.portfolio, "✦", { open: true })}
    ${listBlock("Прихожане", data.worshippers, "◇")}
    ${listBlock("Домены 5e", data.domains_5e_candidate, "⚙", { localize: true })}
    ${listBlock("Союзники", data.allies, "+")}
    ${listBlock("Враги", data.enemies, "×")}
    ${technical.length ? renderBestiariDrawer("Служебное / проверить", `<div class="bestiari-ref-named-list">${technical.map((item) => `<div><span>!</span><p>${escapeHtml(item)}</p></div>`).join("")}</div>`, { icon: "!", meta: String(technical.length), open: false }) : ""}
  `;

  return renderBestiariDrawer("Карточка божества", content, { open: true, icon: "✦", meta: "lore" });
}


function renderMonsterReview(entry) {
  if (!entry?.monster_data && !entry?.review && !entry?.section_buckets) return "";
  const review = entry.review || entry.monster_data?.review || {};
  const quality = entry.quality || entry.monster_data?.quality || {};
  const buckets = entry.section_buckets || entry.monster_data?.section_buckets || {};
  const rawActionCount = buckets?.actions?.raw_lines?.length || 0;
  const rawLegendaryCount = buckets?.legendary_actions?.raw_lines?.length || 0;
  const rawMythicCount = buckets?.mythic_actions?.raw_lines?.length || 0;
  const categories = Array.isArray(review.categories) ? review.categories : [];
  const flags = Array.isArray(review.flags) ? review.flags : [];
  const needsReview = review.needs_review ? "Да" : "Нет";

  const isItemReview = Boolean(entry.item_data);
  const itemRaw = entry.item_data?.raw_preserved || {};
  const itemDescriptionLines = normalizeTextBlock(itemRaw.description_lines || entry.body || entry.full_description);
  const itemSourceLines = normalizeTextBlock(itemRaw.page_lines || itemRaw.item_block_lines || []);
  const content = isItemReview ? `
    ${renderBestiariInfoGrid([
      { label: "Review", value: needsReview },
      { label: "Приоритет", value: review.priority || "—" },
      { label: "Строк описания", value: itemDescriptionLines.length || quality.line_count || "—" },
      { label: "Строк источника", value: itemSourceLines.length || quality.line_count || "—" },
      { label: "Site noise", value: entry.site_noise_lines?.length || itemRaw.site_noise_lines?.length || "—" },
    ])}
    ${categories.length ? renderNamedList("Категории проверки", categories) : ""}
    ${flags.length ? renderNamedList("Флаги", flags) : ""}
    ${review.policy ? `<div class="bestiari-ref-source-hint"><span>${escapeHtml(review.policy)}</span></div>` : ""}
  ` : `
    ${renderBestiariInfoGrid([
      { label: "Review", value: needsReview },
      { label: "Приоритет", value: review.priority || "—" },
      { label: "Строк raw", value: quality.line_count || "—" },
      { label: "Raw действий", value: rawActionCount || "—" },
      { label: "Raw легендарок", value: rawLegendaryCount || "—" },
      { label: "Raw мифических", value: rawMythicCount || "—" },
      { label: "Site noise", value: entry.site_noise_lines?.length || entry.monster_data?.site_noise_count || "—" },
    ])}
    ${categories.length ? renderNamedList("Категории проверки", categories) : ""}
    ${flags.length ? renderNamedList("Флаги", flags) : ""}
    ${review.policy ? `<div class="bestiari-ref-source-hint"><span>${escapeHtml(review.policy)}</span></div>` : ""}
  `;

  return renderBestiariDrawer("Review / raw-first", content, {
    icon: "!",
    meta: review.priority || "round1",
    open: false,
    className: "bestiari-ref-monster-review-drawer"
  });
}

function renderRelated(entry) {
  if (!entry.related?.length) return "";
  return renderBestiariDrawer(
    "Связанные сущности",
    `<div class="bestiari-ref-related-list">${entry.related.map((rel) => `<button type="button" data-bestiari-related="${escapeHtml(rel)}">${escapeHtml(rel)}</button>`).join("")}</div>`,
    { icon: "⇄", meta: String(entry.related.length) }
  );
}


function renderEntryDetail(entry) {
  if (!entry) {
    return `
      <div class="bestiari-ref-detail-empty">
        <div class="bestiari-ref-empty-icon">◇</div>
        <strong>Выбери запись</strong>
        <span>Карточка сущности откроется здесь: краткое описание, игровые данные, источники и связи.</span>
      </div>
    `;
  }

  return `
    <div class="bestiari-ref-entry-shell">
      <section class="bestiari-ref-main-card">
        <div class="bestiari-ref-main-head">
          ${renderEntryImage(entry)}
          <div class="bestiari-ref-main-copy">
            <div class="bestiari-ref-kicker">${escapeHtml(BESTIARI_CATEGORY_LABELS[entry.category] || entry.category || "Codex")}</div>
            <h3>${escapeHtml(entry.title)}</h3>
            ${entry.subtitle ? `<p class="muted">${escapeHtml(entry.subtitle)}</p>` : ""}
            <div class="bestiari-ref-main-badges">
              <span>${escapeHtml(getEntryCrLabel(entry))}</span>
              <span>${escapeHtml(getEntryTypeLabel(entry))}</span>
              <span>${escapeHtml(getEntryAlignmentLabel(entry))}</span>
              ${entry.gm_only ? `<span>GM-only</span>` : ""}
              ${entry.player_visible === false ? `<span>Скрыто от игрока</span>` : ""}
            </div>
            ${renderBestiariTags(entry, 8)}
          </div>
          <div class="bestiari-ref-main-actions">
            <button class="btn" type="button" id="bestiariEditEntryBtn">Редактировать</button>
            <button class="btn btn-danger" type="button" id="bestiariDeleteEntryBtn">Удалить</button>
          </div>
        </div>

        ${entry.summary ? `<div class="bestiari-ref-summary-text">${escapeHtml(entry.summary)}</div>` : ""}
        ${renderInfoPanels(entry)}
        ${renderFullDescription(entry)}
        ${renderDeitySection(entry)}
        ${renderStatblock(entry)}
        ${renderMonsterReview(entry)}
        ${renderSpellSection(entry)}
        ${renderItemSection(entry)}
        ${renderClassSection(entry)}
        ${renderMechanics(entry)}
        ${renderRelated(entry)}
      </section>
      ${renderSideStatPanel(entry)}
    </div>
  `;
}



function getBestiariModalScrollElement() {
  return document.querySelector("#cabinetModal .modal-content") ||
    document.querySelector("#cabinetModal") ||
    document.scrollingElement ||
    document.documentElement;
}

function captureBestiariScrollSnapshot() {
  const sidebar = document.querySelector(".bestiari-ref-sidebar");
  const detail = document.querySelector(".bestiari-ref-detail");
  const modalScroll = getBestiariModalScrollElement();

  return {
    sidebarTop: sidebar ? sidebar.scrollTop : BESTIARI_STATE.sidebarScrollTop || 0,
    detailTop: detail ? detail.scrollTop : BESTIARI_STATE.detailScrollTop || 0,
    modalTop: modalScroll ? modalScroll.scrollTop : BESTIARI_STATE.modalScrollTop || 0,
  };
}

function restoreBestiariScrollSnapshot(snapshot = {}) {
  requestAnimationFrame(() => {
    const sidebar = document.querySelector(".bestiari-ref-sidebar");
    const detail = document.querySelector(".bestiari-ref-detail");
    const modalScroll = getBestiariModalScrollElement();

    if (sidebar) sidebar.scrollTop = Number(snapshot.sidebarTop || 0);
    if (detail) detail.scrollTop = Number(snapshot.detailTop || 0);
    if (modalScroll) modalScroll.scrollTop = Number(snapshot.modalTop || 0);
  });
}

function rememberBestiariScrollPositions() {
  const snapshot = captureBestiariScrollSnapshot();
  BESTIARI_STATE.sidebarScrollTop = snapshot.sidebarTop;
  BESTIARI_STATE.detailScrollTop = snapshot.detailTop;
  BESTIARI_STATE.modalScrollTop = snapshot.modalTop;
  return snapshot;
}

function closeBestiariClassTableLightbox() {
  const active = document.querySelector(".bestiari-class-table-lightbox");
  if (active) active.remove();
  document.body.classList.remove("has-bestiari-table-fullscreen");
}

function openBestiariClassTableLightbox(card) {
  const tableScroll = card.querySelector(".bestiari-ref-class-table-scroll");
  if (!tableScroll) return;

  closeBestiariClassTableLightbox();

  const titleEl = card.querySelector(".bestiari-ref-class-table-title strong");
  const metaEl = card.querySelector(".bestiari-ref-class-table-actions small");
  const title = titleEl?.textContent?.trim() || "Таблица класса";
  const meta = metaEl?.textContent?.trim() || "";
  const clonedScroll = tableScroll.cloneNode(true);

  const overlay = document.createElement("div");
  overlay.className = "bestiari-class-table-lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = `
    <div class="bestiari-class-table-lightbox-panel" role="document">
      <div class="bestiari-class-table-lightbox-head">
        <div>
          <span>таблица класса</span>
          <strong>${escapeHtml(title)}</strong>
          ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
        </div>
        <button class="bestiari-class-table-lightbox-close" type="button" aria-label="Закрыть таблицу">×</button>
      </div>
      <div class="bestiari-class-table-lightbox-body"></div>
    </div>
  `;

  overlay.querySelector(".bestiari-class-table-lightbox-body")?.appendChild(clonedScroll);
  overlay.querySelector(".bestiari-class-table-lightbox-close")?.addEventListener("click", closeBestiariClassTableLightbox);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeBestiariClassTableLightbox();
  });

  document.body.appendChild(overlay);
  document.body.classList.add("has-bestiari-table-fullscreen");
}


function rememberBestiariFocusSnapshot() {
  const active = document.activeElement;
  if (!active || !active.id || !active.closest?.(".bestiari-ref-shell")) return null;
  const isTextControl = active.matches?.("input, textarea, select");
  if (!isTextControl) return null;
  return {
    id: active.id,
    value: typeof active.value === "string" ? active.value : "",
    selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : null,
    selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : null,
  };
}

function restoreBestiariFocusSnapshot(snapshot) {
  if (!snapshot?.id) return;
  requestAnimationFrame(() => {
    const el = document.getElementById(snapshot.id);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (typeof el.setSelectionRange === "function" && snapshot.selectionStart !== null) {
      try {
        const valueLength = String(el.value || "").length;
        const start = Math.min(snapshot.selectionStart, valueLength);
        const end = Math.min(snapshot.selectionEnd ?? start, valueLength);
        el.setSelectionRange(start, end);
      } catch (_) {}
    }
  });
}

function bindActions() {
  const searchInput = getEl("bestiariSearchInput");
  if (searchInput && searchInput.dataset.boundBestiariSearch !== "1") {
    searchInput.dataset.boundBestiariSearch = "1";
    searchInput.addEventListener("input", () => {
      BESTIARI_STATE.query = searchInput.value || "";
      if (BESTIARI_STATE.searchRenderTimer) window.clearTimeout(BESTIARI_STATE.searchRenderTimer);
      BESTIARI_STATE.searchRenderTimer = window.setTimeout(() => {
        BESTIARI_STATE.searchRenderTimer = null;
        renderCodex({ preserveScroll: true, preserveFocus: true });
      }, 80);
    });
  }

  const newBtn = getEl("bestiariNewEntryBtn");
  if (newBtn && newBtn.dataset.boundBestiariNew !== "1") {
    newBtn.dataset.boundBestiariNew = "1";
    newBtn.addEventListener("click", () => {
      openEditor("create");
      renderCodex();
    });
  }

  const importBtn = getEl("bestiariImportBtn");
  if (importBtn && importBtn.dataset.boundBestiariImport !== "1") {
    importBtn.dataset.boundBestiariImport = "1";
    importBtn.addEventListener("click", () => {
      BESTIARI_STATE.importOpen = !BESTIARI_STATE.importOpen;
      renderCodex();
    });
  }

  const exportBtn = getEl("bestiariExportBtn");
  if (exportBtn && exportBtn.dataset.boundBestiariExport !== "1") {
    exportBtn.dataset.boundBestiariExport = "1";
    exportBtn.addEventListener("click", () => exportJson());
  }

  const applyImportBtn = getEl("bestiariApplyImportBtn");
  if (applyImportBtn && applyImportBtn.dataset.boundBestiariApplyImport !== "1") {
    applyImportBtn.dataset.boundBestiariApplyImport = "1";
    applyImportBtn.addEventListener("click", async () => {
      const raw = getEl("bestiariImportTextarea")?.value || "";
      await applyImportJson(raw);
    });
  }

  const closeImportBtn = getEl("bestiariCloseImportBtn");
  if (closeImportBtn && closeImportBtn.dataset.boundBestiariCloseImport !== "1") {
    closeImportBtn.dataset.boundBestiariCloseImport = "1";
    closeImportBtn.addEventListener("click", () => {
      BESTIARI_STATE.importOpen = false;
      renderCodex();
    });
  }

  const saveDraftBtn = getEl("bestiariSaveDraftBtn");
  if (saveDraftBtn && saveDraftBtn.dataset.boundBestiariSave !== "1") {
    saveDraftBtn.dataset.boundBestiariSave = "1";
    saveDraftBtn.addEventListener("click", () => saveDraft());
  }

  const cancelDraftBtn = getEl("bestiariCancelDraftBtn");
  if (cancelDraftBtn && cancelDraftBtn.dataset.boundBestiariCancel !== "1") {
    cancelDraftBtn.dataset.boundBestiariCancel = "1";
    cancelDraftBtn.addEventListener("click", () => {
      closeEditor();
      renderCodex();
    });
  }

  document.querySelectorAll("[data-bestiari-category]").forEach((btn) => {
    if (btn.dataset.boundBestiariCategory === "1") return;
    btn.dataset.boundBestiariCategory = "1";
    btn.addEventListener("click", () => {
      BESTIARI_STATE.category = btn.dataset.bestiariCategory || "all";
      BESTIARI_STATE.showFullDescription = false;
      BESTIARI_STATE.showFullStats = false;
      BESTIARI_STATE.selectedId = getVisibleEntries()[0]?.id || "";
      renderCodex();
    });
  });

  document.querySelectorAll("[data-bestiari-entry]").forEach((btn) => {
    if (btn.dataset.boundBestiariEntry === "1") return;
    btn.dataset.boundBestiariEntry = "1";
    btn.addEventListener("click", () => {
      BESTIARI_STATE.selectedId = btn.dataset.bestiariEntry || "";
      BESTIARI_STATE.showFullDescription = false;
      BESTIARI_STATE.showFullStats = false;
      renderCodex({ preserveScroll: true });
    });
  });

  const selected = getSelectedEntry();

  const editBtn = getEl("bestiariEditEntryBtn");
  if (editBtn && editBtn.dataset.boundBestiariEdit !== "1") {
    editBtn.dataset.boundBestiariEdit = "1";
    editBtn.addEventListener("click", () => {
      if (!selected) return;
      openEditor("edit", selected);
      renderCodex();
    });
  }

  const deleteBtn = getEl("bestiariDeleteEntryBtn");
  if (deleteBtn && deleteBtn.dataset.boundBestiariDelete !== "1") {
    deleteBtn.dataset.boundBestiariDelete = "1";
    deleteBtn.addEventListener("click", () => {
      if (!selected) return;
      deleteEntry(selected.id);
    });
  }

  const toggleDescriptionBtn = getEl("bestiariToggleDescriptionBtn");
  if (toggleDescriptionBtn && toggleDescriptionBtn.dataset.boundBestiariToggleDescription !== "1") {
    toggleDescriptionBtn.dataset.boundBestiariToggleDescription = "1";
    toggleDescriptionBtn.addEventListener("click", () => {
      BESTIARI_STATE.showFullDescription = !BESTIARI_STATE.showFullDescription;
      renderCodex({ preserveScroll: true });
    });
  }

  const toggleStatsBtn = getEl("bestiariToggleStatsBtn");
  if (toggleStatsBtn && toggleStatsBtn.dataset.boundBestiariToggleStats !== "1") {
    toggleStatsBtn.dataset.boundBestiariToggleStats = "1";
    toggleStatsBtn.addEventListener("click", () => {
      BESTIARI_STATE.showFullStats = !BESTIARI_STATE.showFullStats;
      renderCodex({ preserveScroll: true });
    });
  }

  document.querySelectorAll("[data-class-subclass-group]").forEach((btn) => {
    if (btn.dataset.boundClassSubclassGroup === "1") return;
    btn.dataset.boundClassSubclassGroup = "1";
    btn.addEventListener("click", () => {
      const root = btn.closest("[data-class-subclasses-root]");
      const groupKey = btn.dataset.classSubclassGroup || "";
      if (!root || !groupKey) return;

      root.querySelectorAll("[data-class-subclass-group]").forEach((item) => {
        item.classList.toggle("is-active", item === btn);
      });

      root.querySelectorAll("[data-class-subclass-panel]").forEach((panel) => {
        panel.classList.toggle("is-active", panel.dataset.classSubclassPanel === groupKey);
      });

      const activePanel = root.querySelector(`[data-class-subclass-panel="${CSS.escape(groupKey)}"]`);
      const firstChip = activePanel?.querySelector("[data-class-subclass-chip]");
      if (firstChip) firstChip.click();
    });
  });

  document.querySelectorAll("[data-class-subclass-chip]").forEach((btn) => {
    if (btn.dataset.boundClassSubclassChip === "1") return;
    btn.dataset.boundClassSubclassChip = "1";
    btn.addEventListener("click", () => {
      const panel = btn.closest("[data-class-subclass-panel]");
      const groupKey = btn.dataset.classSubclassChip || "";
      const index = btn.dataset.classSubclassIndex || "0";
      if (!panel || !groupKey) return;

      panel.querySelectorAll("[data-class-subclass-chip]").forEach((item) => {
        item.classList.toggle("is-active", item === btn);
      });

      panel.querySelectorAll("[data-class-subclass-detail]").forEach((detail) => {
        detail.classList.toggle(
          "is-active",
          detail.dataset.classSubclassDetail === groupKey && detail.dataset.classSubclassIndex === index
        );
      });
    });
  });

  document.querySelectorAll("[data-class-table-fullscreen]").forEach((btn) => {
    if (btn.dataset.boundClassTableFullscreen === "1") return;
    btn.dataset.boundClassTableFullscreen = "1";
    btn.addEventListener("click", () => {
      const card = btn.closest(".bestiari-ref-class-table-card");
      if (!card) return;
      openBestiariClassTableLightbox(card);
    });
  });

  if (document.body.dataset.boundBestiariTableFullscreenEsc !== "1") {
    document.body.dataset.boundBestiariTableFullscreenEsc = "1";
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeBestiariClassTableLightbox();
    });
  }

  document.querySelectorAll("[data-bestiari-related]").forEach((btn) => {
    if (btn.dataset.boundBestiariRelated === "1") return;
    btn.dataset.boundBestiariRelated = "1";
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.bestiariRelated || "";
      const target = BESTIARI_STATE.entries.find((entry) => entry.id === targetId || entry.title === targetId);
      if (!target) {
        BESTIARI_STATE.query = targetId;
      } else {
        BESTIARI_STATE.selectedId = target.id;
        BESTIARI_STATE.category = "all";
      }
      BESTIARI_STATE.showFullDescription = false;
      BESTIARI_STATE.showFullStats = false;
      renderCodex({ preserveScroll: true });
    });
  });
}

export async function loadCodex() {
  BESTIARI_STATE.role = getCurrentRole();

  const defaultEntries = BESTIARI_DEFAULT_ENTRIES.map(normalizeEntry);
  const localEntriesRaw = loadLocalEntries();
  const localEntries = Array.isArray(localEntriesRaw) && localEntriesRaw.length
    ? localEntriesRaw.map(normalizeEntry)
    : [];
  const externalSeedEntries = await loadExternalBestiariSeeds();

  BESTIARI_STATE.entries = mergeEntryLists(
    defaultEntries,
    localEntries,
    externalSeedEntries
  );

  if (externalSeedEntries.length) {
    BESTIARI_STATE.source = localEntries.length ? "local + external-seed" : "seed + external-seed";
  } else if (localEntries.length) {
    BESTIARI_STATE.source = "local";
  } else {
    BESTIARI_STATE.source = "seed";
  }

  saveLocalEntries();
  BESTIARI_STATE.loaded = true;
  BESTIARI_STATE.selectedId = BESTIARI_STATE.selectedId || BESTIARI_STATE.entries[0]?.id || "";
  return BESTIARI_STATE;
}

export function renderCodex(options = {}) {
  const container = getEl("cabinet-bestiari") || getEl("cabinet-codex");
  if (!container) return;

  const preserveScroll = options && options.preserveScroll === true;
  const preserveFocus = options && options.preserveFocus === true;
  const scrollSnapshot = preserveScroll ? rememberBestiariScrollPositions() : null;
  const focusSnapshot = preserveFocus ? rememberBestiariFocusSnapshot() : null;

  const entries = getVisibleEntries();
  const selected = getSelectedEntry(entries);
  if (selected) BESTIARI_STATE.selectedId = selected.id;

  const visibleCount = entries.length;
  const totalCount = Array.isArray(BESTIARI_STATE.entries) ? BESTIARI_STATE.entries.length : 0;
  const stats = countByCategory(BESTIARI_STATE.entries || []);
  const progress = getKnowledgeProgress(BESTIARI_STATE.entries || []);

  container.innerHTML = `
    <div class="bestiari-ref-shell" data-cabinet-anchor="top">
      <section class="bestiari-ref-topbar">
        <div class="bestiari-ref-title-block">
          <div class="bestiari-ref-kicker">Энциклопедия</div>
          <h3>Справочник мира</h3>
        </div>
        <label class="bestiari-ref-global-search">
          <span>⌕</span>
          <input id="bestiariSearchInput" type="text" value="${escapeHtml(BESTIARI_STATE.query)}" placeholder="Поиск по энциклопедии...">
          <kbd>Ctrl + K</kbd>
        </label>
        <div class="bestiari-ref-top-metrics">
          <span><strong>${visibleCount} / ${totalCount}</strong><small>записей</small></span>
          <span><strong>${progress}%</strong><small>знаний</small></span>
          <span><strong>${Object.keys(stats).length}</strong><small>категорий</small></span>
        </div>
      </section>

      <section class="bestiari-ref-category-bar" data-cabinet-anchor="filters">
        ${renderCategoryButtons(BESTIARI_STATE.entries || [])}
      </section>

      <section class="bestiari-ref-tools-drawer">
        ${renderBestiariDrawer(
          "Управление базой",
          `<div class="bestiari-ref-tools-row">
            <button class="btn btn-primary" type="button" id="bestiariNewEntryBtn">＋ Новая запись</button>
            <button class="btn" type="button" id="bestiariImportBtn">Импорт</button>
            <button class="btn" type="button" id="bestiariExportBtn">Экспорт</button>
            <span class="bestiari-ref-tool-note">Источник: ${escapeHtml(BESTIARI_STATE.source)} • роль: ${escapeHtml(BESTIARI_STATE.role)}</span>
          </div>`,
          { icon: "⚙", meta: "редактирование" }
        )}
      </section>

      ${renderImportPanel()}
      ${renderEditorPanel()}

      <section class="bestiari-ref-layout" data-cabinet-anchor="list">
        <aside class="bestiari-ref-sidebar">
          <div class="bestiari-ref-sidebar-head">
            <div>
              <div class="bestiari-ref-kicker">${escapeHtml(BESTIARI_CATEGORY_LABELS[BESTIARI_STATE.category] || "Записи")}</div>
              <strong>${visibleCount} записей</strong>
            </div>
            <span>${escapeHtml(BESTIARI_STATE.query ? "поиск" : "каталог")}</span>
          </div>
          ${renderEntryList(entries, selected)}
        </aside>
        <main class="bestiari-ref-detail" data-cabinet-anchor="details">
          ${renderEntryDetail(selected)}
        </main>
      </section>
    </div>
  `;

  bindActions();
  if (scrollSnapshot) restoreBestiariScrollSnapshot(scrollSnapshot);
  if (focusSnapshot) restoreBestiariFocusSnapshot(focusSnapshot);
}


export function getCodexState() {
  return BESTIARI_STATE;
}
