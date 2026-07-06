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
  loadingPromise: null,
  // Ленивая загрузка seed-данных по разделам.
  // Справочник больше не тянет монстров/предметы/заклинания на холодном старте.
  loadedSeedCategories: new Set(),
  loadingSeedCategories: new Set(),
  seedCategoryPromises: new Map(),
  allSeedCategoriesLoaded: false,
};

// Быстрые настройки производительности энциклопедии.
// Не рендерим тысячи строк списка за один ввод: это убирает лаг и потерю фокуса поиска.
const BESTIARI_LIST_RENDER_LIMIT = 120;
const BESTIARI_SEARCH_RENDER_DELAY_MS = 220;
// На холодном старте подтягиваем только лёгкие и часто нужные разделы.
// Тяжёлые монстры/предметы/заклинания грузятся при открытии раздела или поиске.
const BESTIARI_INITIAL_LAZY_CATEGORIES = ["classes", "races", "backgrounds"];

// round153_class_css_restore: class UI UX guardrails
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
  backgrounds: "Происхождения",
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

const BESTIARI_BACKGROUND_SEED_URLS = [
  "/static/data/backgrounds_bestiari_preview.json",
  "/static/backgrounds_bestiari_preview.json",
  "/data/backgrounds_bestiari_preview.json",
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


function normalizeMonsterXpText(value) {
  const raw = safeText(value);
  if (!raw) return "";
  const digits = raw.replace(/[\s\u00a0\u202f]+/g, "").match(/\d+/)?.[0] || "";
  if (!digits) return raw;
  const formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return /опыт/i.test(raw) ? `${formatted} опыта` : `${formatted} опыта`;
}

function extractMonsterXpFromText(value) {
  const text = Array.isArray(value)
    ? value.join("\n")
    : value && typeof value === "object"
      ? Object.values(value).map((item) => Array.isArray(item) ? item.join(" ") : String(item || "")).join("\n")
      : String(value || "");
  if (!text.trim()) return "";

  const patterns = [
    /Опасность\s*[:\s]*(?:CR\s*)?\d+(?:\/\d+)?[^\n(]*\(([\d\s\u00a0\u202f]+)\s*опыта\)/i,
    /(?:CR\s*)?\d+(?:\/\d+)?\s*\(([\d\s\u00a0\u202f]+)\s*опыта\)/i,
    /([\d\s\u00a0\u202f]{4,})\s*опыта/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return normalizeMonsterXpText(match[1]);
  }
  return "";
}

function getMonsterXpTextFromSources(raw = {}, challenge = {}) {
  const directCandidates = [
    challenge?.xp,
    challenge?.experience,
    raw?.xp,
    raw?.experience,
    raw?.challenge_xp,
    raw?.statblock?.xp,
    raw?.statblock?.experience,
    raw?.statblock?.challenge?.xp,
    raw?.statblock?.challenge?.experience,
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeMonsterXpText(candidate);
    if (normalized) return normalized;
  }

  const candidates = [
    challenge?.raw,
    challenge?.text,
    raw?.challenge,
    raw?.challenge_text,
    raw?.danger,
    raw?.cr_text,
    raw?.statblock?.challenge,
    raw?.statblock?.challenge_raw,
    raw?.raw?.challenge,
    raw?.raw?.danger,
    raw?.raw_text,
  ];

  if (Array.isArray(raw?.info_panels)) {
    for (const panel of raw.info_panels) {
      candidates.push(`${panel?.label || ""} ${panel?.value || ""}`);
    }
  }

  for (const key of ["page_lines", "raw_lines", "lines", "statblock_lines"]) {
    if (Array.isArray(raw?.[key])) candidates.push(raw[key].slice(0, 80).join("\n"));
    if (Array.isArray(raw?.raw?.[key])) candidates.push(raw.raw[key].slice(0, 80).join("\n"));
    if (Array.isArray(raw?.raw_preserved?.[key])) candidates.push(raw.raw_preserved[key].slice(0, 80).join("\n"));
  }

  for (const candidate of candidates) {
    const extracted = extractMonsterXpFromText(candidate);
    if (extracted) return extracted;
  }

  return "";
}

const MONSTER_SUPPLEMENTAL_SECTION_RE = /^(?:персонализация дракона|опционально\s*:|описание\b|источник\s*:|драконы и врожд[её]нное колдовство)\b/i;

function isMonsterSupplementalBreakEntry(entry = {}) {
  const name = typeof entry === "string" ? entry : safeText(entry?.name || entry?.title || "");
  const text = typeof entry === "string" ? entry : safeText(entry?.text || entry?.body || entry?.description || "");
  const head = [name, text].filter(Boolean).join("\n").trim();
  return MONSTER_SUPPLEMENTAL_SECTION_RE.test(head);
}

function splitMonsterEntriesAtSupplementalBreak(entries = []) {
  const main = [];
  const supplemental = [];
  let inSupplemental = false;

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!inSupplemental && isMonsterSupplementalBreakEntry(entry)) {
      inSupplemental = true;
    }
    if (inSupplemental) supplemental.push(entry);
    else main.push(entry);
  }

  return { main, supplemental };
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
  const xp = getMonsterXpTextFromSources(raw, challenge);
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
    background_data: raw.background_data && typeof raw.background_data === "object" ? raw.background_data : null,
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

function normalizeRaceSourceRefs(refs = []) {
  const seen = new Set();
  const out = [];

  for (const ref of Array.isArray(refs) ? refs : []) {
    const title = String(ref?.title || ref?.name || ref?.ru_name || "").replace(/\s+/g, " ").trim();
    const url = String(ref?.url || ref?.source_url || "").trim();
    const path = String(ref?.path || ref?.source_path || "").trim();
    if (!title && !url && !path) continue;
    if (/^заклинания$/i.test(title) || path === "/spells/") continue;
    const key = `${title}|${url}|${path}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...ref, title, url, path });
  }

  return out;
}

function getRaceRoundData(raw = {}) {
  return raw.race_data && typeof raw.race_data === "object" ? raw.race_data : {};
}

function getRaceTraits(raw = {}) {
  const data = getRaceRoundData(raw);
  return getClassArray(
    data.traits_round2 ||
    data.traits_round1 ||
    raw.traits_round2 ||
    raw.traits_round1 ||
    raw.traits ||
    []
  );
}

function getRaceVariants(raw = {}) {
  const data = getRaceRoundData(raw);
  return getClassArray(
    data.variants_round2 ||
    data.variant_refs_round2 ||
    raw.variants_round2 ||
    raw.variant_refs_round2 ||
    raw.variants ||
    []
  );
}

function getRaceTables(raw = {}) {
  const data = getRaceRoundData(raw);
  return getClassArray(data.tables_round2 || raw.tables_round2 || raw.tables || []);
}

function getRaceSpellRefs(raw = {}) {
  const data = getRaceRoundData(raw);
  return normalizeRaceSourceRefs(
    data.spell_refs_round2 ||
    data.spell_refs_round1 ||
    raw.spell_refs_round2 ||
    raw.spell_refs_round1 ||
    raw.spell_refs ||
    []
  );
}

function normalizeRaceTrait(trait = {}, fallbackIndex = 0) {
  if (typeof trait === "string") {
    return {
      name: `Особенность ${fallbackIndex + 1}`,
      kind: "feature",
      text: trait.replace(/\s+/g, " ").trim(),
    };
  }

  const name = getClassText(trait.name || trait.title || trait.label || trait.trait_name, `Особенность ${fallbackIndex + 1}`);
  const kind = getClassText(trait.kind || trait.type || trait.group || "feature", "feature");
  const text = getClassText(trait.text || trait.description || trait.summary || trait.content || trait.body || trait.rules, "");

  return { ...trait, name, kind, text };
}

function normalizeRaceVariant(variant = {}, fallbackIndex = 0) {
  if (typeof variant === "string") {
    return {
      title: variant.replace(/\s+/g, " ").trim() || `Вариант ${fallbackIndex + 1}`,
      relationship_guess: "variant",
      group_title: "Варианты",
      text: "",
    };
  }

  return {
    ...variant,
    title: getClassText(variant.title || variant.name || variant.ru_name || variant.label, `Вариант ${fallbackIndex + 1}`),
    relationship_guess: getClassText(variant.relationship_guess || variant.relationship || variant.kind || "variant", "variant"),
    group_title: getClassText(variant.group_title || variant.group || variant.source_section || variant.section_title || "", ""),
    text: getClassText(variant.text || variant.description || variant.summary || variant.body || "", ""),
    url: getClassText(variant.url || variant.source_url || "", ""),
  };
}

function getRaceKindLabel(kind = "") {
  const key = String(kind || "").toLowerCase();
  const labels = {
    ability_score_increase: "характеристики",
    age: "возраст",
    alignment: "мировоззрение",
    size: "размер",
    speed: "скорость",
    darkvision: "зрение",
    languages: "языки",
    proficiency: "владение",
    resistance: "сопротивление",
    spellcasting_or_magic: "магия",
    choice: "выбор",
    feature: "особенность",
  };
  return labels[key] || kind || "особенность";
}

function convertRaceToBestiariEntry(raw = {}) {
  const roundData = getRaceRoundData(raw);
  const slug = safeText(raw.slug || roundData.slug || roundData.race_id || raw.en_name || roundData.en_name || raw.ru_name || raw.title, makeId("race"));
  const title = safeText(raw.ru_name || roundData.ru_name || raw.title_ru || raw.title || raw.title_raw, "Безымянная раса");
  const enName = safeText(raw.en_name || roundData.en_name || raw.title_en);
  const sourceTags = Array.isArray(raw.source_tags)
    ? raw.source_tags.map(String).filter(Boolean)
    : Array.isArray(roundData.source_tags)
      ? roundData.source_tags.map(String).filter(Boolean)
      : [];
  const sectionName = safeText(raw.category_section || raw.section);
  const isOrigin = Boolean(roundData.is_origin) || sectionName === "Происхождения" || /origin|lineage/i.test(String(raw.type || raw.subtitle || ""));
  const sections = Array.isArray(raw.sections) ? raw.sections : [];
  const traits = getRaceTraits(raw);
  const variants = getRaceVariants(raw);
  const tables = getRaceTables(raw);
  const spellRefs = getRaceSpellRefs(raw);
  const source = normalizeSourceToString(raw.source) || normalizeSourceToString(roundData.source) || "DnD.su";
  const sourceUrl = raw.source_url || raw.url || roundData.source_url || "";

  let intro = normalizeTextBlock(raw.body || raw.intro_paragraphs || []);
  if (!intro.length) {
    for (const section of sections) {
      const titleLower = String(section?.title || "").toLowerCase();
      const paragraphs = cleanRaceTextList(section?.paragraphs || [])
        .filter((paragraph) => !paragraph.startsWith("Источник:"));
      if (paragraphs.length && (titleLower.includes(String(raw.ru_name || raw.title || "").toLowerCase()) || !intro.length)) {
        intro = paragraphs.slice(0, 3);
        if (titleLower.includes(String(raw.ru_name || raw.title || "").toLowerCase())) break;
      }
    }
  }

  const fallback = `${title} — карточка ${isOrigin ? "происхождения" : "расы"} D&D 5e из round2.`;
  const summary = shortenForSummary(raw.summary || intro[0] || fallback);
  const fullDescription = normalizeTextBlock(raw.full_description).length
    ? normalizeTextBlock(raw.full_description)
    : sections
      .map((section) => raceSectionToLine(section, 4))
      .filter(Boolean)
      .filter((line) => !line.startsWith("Комментарии:") && !line.startsWith("Галерея:"))
      .slice(0, 40);

  const featureLines = [];
  const seenFeatureLines = new Set();
  for (const trait of traits) {
    const normalized = normalizeRaceTrait(trait, featureLines.length);
    if (!normalized.name || !normalized.text) continue;
    const line = `${normalized.name}. ${normalized.text}`;
    const key = line.toLowerCase().slice(0, 180);
    if (seenFeatureLines.has(key)) continue;
    seenFeatureLines.add(key);
    featureLines.push(line);
  }

  return {
    id: raw.id || `race-${slug}`,
    category: "races",
    title,
    subtitle: raw.subtitle || (isOrigin ? "Происхождение / lineage" : "Раса / происхождение D&D 5e"),
    tags: [isOrigin ? "происхождение" : "раса", "dnd.su", ...sourceTags, ...(roundData.is_variant ? ["вариант"] : [])].filter(Boolean),
    source,
    source_url: sourceUrl,
    summary,
    body: intro.length ? intro.slice(0, 3) : [fallback],
    full_description: fullDescription.length ? fullDescription : intro.slice(1),
    related: [
      ...variants.map((ref) => ref.title || ref.name || "").filter(Boolean),
      ...spellRefs.map((ref) => ref.title || "").filter(Boolean),
    ].slice(0, 32),
    player_visible: raw.player_visible !== false && raw.visibility?.player_summary !== false,
    gm_only: raw.gm_only === true,
    info_panels: Array.isArray(raw.info_panels) && raw.info_panels.length ? raw.info_panels : buildRaceInfoPanels({ ...raw, quality: raw.quality || roundData.quality || {} }, isOrigin),
    mechanics: {
      short_rules: featureLines.slice(0, 24),
      examples: [],
    },
    race_data: {
      ...roundData,
      race_id: roundData.race_id || raw.race_id || raw.id || `race-${slug}`,
      ru_name: title,
      en_name: enName,
      source_tags: sourceTags,
      source_path: roundData.source_path || raw.source_path || raw.path || "",
      is_origin: isOrigin,
      is_variant: Boolean(roundData.is_variant),
      variant_of: roundData.variant_of || raw.variant_of || "",
      family_id: roundData.family_id || raw.family_id || "",
      quality: raw.quality || roundData.quality || {},
      traits_round1: traits,
      traits_round2: traits,
      variants_round2: variants,
      variant_refs_round2: variants,
      tables_round2: tables,
      spell_refs_round1: spellRefs,
      spell_refs_round2: spellRefs,
      traits_by_kind: roundData.traits_by_kind || {},
      lss_ready: roundData.lss_ready || {},
    },
    review_status: raw.review_status || "needs_cleaning",
    quality: raw.quality || roundData.quality || null,
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
  const monsterXpText = getMonsterXpTextFromSources(raw, challenge);
  const normalizedChallenge = {
    ...(challenge && typeof challenge === "object" ? challenge : {}),
    value: safeText(challenge.value || raw.cr || raw.challenge_rating || rawStatblock.cr || rawStatblock.challenge_rating),
    xp: monsterXpText || safeText(challenge.xp || challenge.experience || raw.xp || raw.experience),
    raw: safeText(challenge.raw || raw.challenge_text || rawStatblock.challenge_raw),
  };
  const sta = rawStatblock.size_type_alignment && typeof rawStatblock.size_type_alignment === "object" ? rawStatblock.size_type_alignment : {};
  const crText = challenge.value ? `CR ${challenge.value}` : safeText(raw.cr || rawStatblock.cr || "CR ?");
  const typeBits = sta.raw || [sta.size, sta.type, sta.alignment].filter(Boolean).join(" ");
  const description = normalizeTextBlock(raw.description_paragraphs || raw.full_description || raw.body);
  const summary = safeText(raw.summary || description[0] || "Монстр из бестиария DnD.su. Сырой текст сохранён в raw/review слое.");
  const traits = normalizeMonsterEntryList(raw.traits || rawStatblock.traits || []);
  const actions = normalizeMonsterEntryList(raw.actions || rawStatblock.actions || []);
  const bonusActions = normalizeMonsterEntryList(raw.bonus_actions || rawStatblock.bonus_actions || []);
  const reactions = normalizeMonsterEntryList(raw.reactions || rawStatblock.reactions || []);
  let legendaryActions = normalizeMonsterEntryList(raw.legendary_actions || rawStatblock.legendary_actions || []);
  let mythicActions = normalizeMonsterEntryList(raw.mythic_actions || rawStatblock.mythic_actions || []);
  const lairActions = normalizeMonsterEntryList(raw.lair_actions || rawStatblock.lair_actions || []);
  const lairEffects = normalizeMonsterEntryList(raw.lair_effects || rawStatblock.lair_effects || []);
  const regionalEffects = normalizeMonsterEntryList(raw.regional_effects || rawStatblock.regional_effects || []);
  const supplementalEntries = [];
  const legendarySplit = splitMonsterEntriesAtSupplementalBreak(legendaryActions);
  legendaryActions = legendarySplit.main;
  supplementalEntries.push(...legendarySplit.supplemental.map((item) => ({ ...item, source_section: "legendary_actions" })));
  const mythicSplit = splitMonsterEntriesAtSupplementalBreak(mythicActions);
  mythicActions = mythicSplit.main;
  supplementalEntries.push(...mythicSplit.supplemental.map((item) => ({ ...item, source_section: "mythic_actions" })));
  const statblock = {
    ...rawStatblock,
    challenge: normalizedChallenge,
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
      supplemental_entries: supplementalEntries,
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
      const res = await fetch(url, { cache: "default" });
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

const BESTIARI_SEED_GROUPS = [
  { category: "monsters", label: "monster", urls: BESTIARI_MONSTER_SEED_URLS },
  { category: "gods", label: "deity", urls: BESTIARI_DEITY_SEED_URLS },
  { category: "races", label: "race", urls: BESTIARI_RACE_SEED_URLS },
  { category: "backgrounds", label: "background", urls: BESTIARI_BACKGROUND_SEED_URLS },
  { category: "classes", label: "class", urls: BESTIARI_CLASS_SEED_URLS },
  { category: "factions", label: "faction", urls: BESTIARI_FACTION_SEED_URLS },
  { category: "conditions", label: "condition", urls: BESTIARI_CONDITION_SEED_URLS },
  { category: "mechanics", label: "mechanic", urls: BESTIARI_MECHANIC_SEED_URLS },
  { category: "lore", label: "lore", urls: BESTIARI_LORE_SEED_URLS },
  { category: "locations", label: "location", urls: BESTIARI_LOCATION_SEED_URLS },
  { category: "spells", label: "spell", urls: BESTIARI_SPELL_SEED_URLS },
  { category: "feats", label: "feat", urls: BESTIARI_FEAT_SEED_URLS },
  { category: "items", label: "item", urls: BESTIARI_ITEM_SEED_URLS },
  { category: "items", label: "magic item", urls: BESTIARI_MAGIC_ITEM_SEED_URLS },
];

function getBestiariSeedCategories() {
  return [...new Set(BESTIARI_SEED_GROUPS.map((group) => group.category))];
}

function getBestiariSeedGroupsForCategory(category) {
  return BESTIARI_SEED_GROUPS.filter((group) => group.category === category);
}

function isBestiariSeedCategoryLoaded(category) {
  if (!category || category === "all") return BESTIARI_STATE.allSeedCategoriesLoaded === true;
  return BESTIARI_STATE.loadedSeedCategories instanceof Set && BESTIARI_STATE.loadedSeedCategories.has(category);
}

function isBestiariSeedCategoryLoading(category) {
  if (!category || category === "all") {
    return BESTIARI_STATE.loadingSeedCategories instanceof Set && BESTIARI_STATE.loadingSeedCategories.size > 0;
  }
  return BESTIARI_STATE.loadingSeedCategories instanceof Set && BESTIARI_STATE.loadingSeedCategories.has(category);
}

function markBestiariSourceAsLazySeed() {
  const current = String(BESTIARI_STATE.source || "");
  if (current.includes("lazy-seed")) return;
  BESTIARI_STATE.source = current && current !== "empty" ? `${current} + lazy-seed` : "lazy-seed";
}

function mergeEntriesIntoBestiariState(entries = []) {
  if (!Array.isArray(entries) || !entries.length) return;
  BESTIARI_STATE.entries = mergeEntryLists(BESTIARI_STATE.entries || [], entries);
  markBestiariSourceAsLazySeed();
}

async function loadBestiariSeedCategory(category, options = {}) {
  if (!category || category === "all") return [];
  if (isBestiariSeedCategoryLoaded(category)) return [];

  if (BESTIARI_STATE.seedCategoryPromises instanceof Map && BESTIARI_STATE.seedCategoryPromises.has(category)) {
    return BESTIARI_STATE.seedCategoryPromises.get(category);
  }

  const groups = getBestiariSeedGroupsForCategory(category);
  if (!groups.length) {
    BESTIARI_STATE.loadedSeedCategories.add(category);
    return [];
  }

  BESTIARI_STATE.loadingSeedCategories.add(category);
  const promise = (async () => {
    const loadedGroups = await Promise.all(
      groups.map((group) => loadFirstAvailableBestiariSeed(group.urls, group.label))
    );
    const entries = loadedGroups.flat().map(normalizeEntry);
    mergeEntriesIntoBestiariState(entries);
    BESTIARI_STATE.loadedSeedCategories.add(category);
    return entries;
  })();

  BESTIARI_STATE.seedCategoryPromises.set(category, promise);

  try {
    const result = await promise;
    if (options.renderWhenDone) {
      if (!BESTIARI_STATE.selectedId) BESTIARI_STATE.selectedId = getVisibleEntries()[0]?.id || "";
      renderCodex({ preserveScroll: true, preserveFocus: true });
    }
    return result;
  } catch (err) {
    console.warn(`[bestiari] lazy category failed: ${category}`, err);
    return [];
  } finally {
    BESTIARI_STATE.loadingSeedCategories.delete(category);
    BESTIARI_STATE.seedCategoryPromises.delete(category);
  }
}

async function loadBestiariSeedCategories(categories = [], options = {}) {
  const unique = [...new Set((categories || []).filter((category) => category && category !== "all"))];
  if (!unique.length) return [];
  const renderWhenDone = options.renderWhenDone === true;
  const loaded = await Promise.all(
    unique.map((category) => loadBestiariSeedCategory(category, { ...options, renderWhenDone: false }))
  );
  const result = loaded.flat();
  if (renderWhenDone) {
    if (!BESTIARI_STATE.selectedId) BESTIARI_STATE.selectedId = getVisibleEntries()[0]?.id || "";
    renderCodex({ preserveScroll: true, preserveFocus: true });
  }
  return result;
}

async function loadAllBestiariSeedCategories(options = {}) {
  if (BESTIARI_STATE.allSeedCategoriesLoaded) return [];
  const categories = getBestiariSeedCategories();
  const loaded = await loadBestiariSeedCategories(categories, options);
  const stillLoading = categories.some((category) => isBestiariSeedCategoryLoading(category));
  const allLoaded = categories.every((category) => isBestiariSeedCategoryLoaded(category));
  BESTIARI_STATE.allSeedCategoriesLoaded = allLoaded && !stillLoading;
  return loaded;
}

async function ensureBestiariSeedsForCurrentView(options = {}) {
  const category = BESTIARI_STATE.category || "all";
  const query = String(BESTIARI_STATE.query || "").trim();

  if (category && category !== "all") {
    return loadBestiariSeedCategory(category, options);
  }

  // В режиме "Все" не тянем весь справочник сразу.
  // Но если пользователь реально ищет по всем разделам, после двух символов
  // догружаем остальные seed-файлы фоном и перерисовываем список.
  if (query.length >= 2) {
    return loadAllBestiariSeedCategories(options);
  }

  return [];
}

function queueInitialBestiariSeedWarmup() {
  window.setTimeout(() => {
    loadBestiariSeedCategories(BESTIARI_INITIAL_LAZY_CATEGORIES, { renderWhenDone: true });
  }, 0);
}

async function loadExternalBestiariSeeds() {
  // Совместимость для старого кода/отладки: полная загрузка всех seed-файлов.
  // Основной путь теперь ленивый: loadBestiariSeedCategory / ensureBestiariSeedsForCurrentView.
  return loadAllBestiariSeedCategories();
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

function getBestiariSearchText(entry = {}) {
  if (typeof entry._searchText === "string") return entry._searchText;

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

  // Кэшируем поисковую строку, чтобы ввод в поиске не пересобирал большой текст заново.
  entry._searchText = haystack;
  return haystack;
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

      return getBestiariSearchText(entry).includes(query);
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
    backgrounds: "◌",
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
  const categoryOrder = ["monsters", "gods", "events", "items", "spells", "feats", "locations", "lore", "mechanics", "classes", "races", "backgrounds", "factions", "conditions"];
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
      const loading = isBestiariSeedCategoryLoading(key);
      const loaded = isBestiariSeedCategoryLoaded(key);
      const countLabel = loading ? "…" : (count || loaded ? String(count) : "—");
      return `
        <button
          class="bestiari-ref-category ${active} ${loading ? "is-loading" : ""} ${loaded ? "is-loaded" : "is-lazy"}"
          type="button"
          data-bestiari-category="${escapeHtml(key)}"
          title="${escapeHtml(loaded ? "Раздел загружен" : loading ? "Раздел загружается" : "Раздел загрузится при открытии")}"
        >
          <span>${escapeHtml(getCategoryIcon(key))}</span>
          <strong>${escapeHtml(BESTIARI_CATEGORY_LABELS[key])}</strong>
          <em>${escapeHtml(countLabel)}</em>
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
  const category = BESTIARI_STATE.category || "all";
  const query = String(BESTIARI_STATE.query || "").trim();
  const categoryLoading = isBestiariSeedCategoryLoading(category);
  const categoryLoaded = isBestiariSeedCategoryLoaded(category);

  if (!entries.length) {
    if (category !== "all" && !categoryLoaded) {
      return `
        <div class="bestiari-ref-empty">
          <div class="bestiari-ref-empty-icon">◇</div>
          <strong>${categoryLoading ? "Загружаем раздел" : "Раздел ещё не загружен"}</strong>
          <span>${categoryLoading ? "Данные подтягиваются из JSON без перезагрузки страницы." : "Нажми кнопку ниже или просто подожди — раздел догрузится лениво."}</span>
          ${categoryLoading ? "" : `<button class="btn btn-primary" type="button" data-bestiari-load-category="${escapeHtml(category)}">Загрузить ${escapeHtml(BESTIARI_CATEGORY_LABELS[category] || "раздел")}</button>`}
        </div>
      `;
    }

    if (category === "all" && query.length >= 2 && !BESTIARI_STATE.allSeedCategoriesLoaded) {
      return `
        <div class="bestiari-ref-empty">
          <div class="bestiari-ref-empty-icon">⌕</div>
          <strong>${isBestiariSeedCategoryLoading("all") ? "Ищем по всем разделам" : "Поиск расширяется"}</strong>
          <span>Для глобального поиска справочник догружает тяжёлые разделы фоном.</span>
        </div>
      `;
    }

    return `
      <div class="bestiari-ref-empty">
        <div class="bestiari-ref-empty-icon">◇</div>
        <strong>Ничего не найдено</strong>
        <span>Попробуй другой запрос, категорию или импортируй записи.</span>
      </div>
    `;
  }

  const visibleRows = entries.slice(0, BESTIARI_LIST_RENDER_LIMIT);
  const hiddenCount = Math.max(0, entries.length - visibleRows.length);

  return `
    <div class="bestiari-ref-list">
      ${visibleRows
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
      ${hiddenCount ? `
        <div class="bestiari-ref-empty">
          <strong>Показаны первые ${visibleRows.length}</strong>
          <span>Ещё ${hiddenCount} записей скрыто ради скорости. Уточни поиск или категорию.</span>
        </div>
      ` : ""}
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

  const formatItemValue = (value) => {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value === "number") return String(value);
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((item) => formatItemValue(item)).filter(Boolean).join(", ");
    if (typeof value === "object") {
      if (value.raw) return String(value.raw);
      if (value.label) return String(value.label);
      if (value.text) return String(value.text);
      if (value.name) return String(value.name);
      if (value.average_gp) return `${value.average_gp} зм`;
      if (value.value_gp) return `${value.value_gp} зм`;
      if (value.range_min_gp || value.range_max_gp) {
        const left = value.range_min_gp || "?";
        const right = value.range_max_gp || "?";
        return `${left}–${right} зм`;
      }
    }
    return "";
  };

  const rarity = formatItemValue(data.rarity || data.rarity_visual || data.rarity_raw) || "—";
  const type = formatItemValue(data.type || data.item_type || data.category) || "—";
  const slot = formatItemValue(data.slot || data.equipment_slot) || "—";
  const attunement = formatItemValue(data.attunement || data.requires_attunement) || "—";
  const weight = formatItemValue(data.weight_lb || data.weight || data.weight_raw) || "—";
  const price = formatItemValue(data.price || data.price_raw || data.cost || data.value_gp) || "—";
  const source = formatItemValue(data.source || entry.source) || "—";

  const properties = Array.isArray(data.properties)
    ? data.properties.filter(Boolean)
    : [];

  const propertyText = (item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") return item.text || item.name || item.title || item.label || "";
    return "";
  };

  const propertiesHtml = properties.length
    ? `
      <div class="bestiari-ref-item-properties-title">Свойства / механика</div>
      <div class="bestiari-ref-named-list bestiari-ref-item-properties">
        ${properties
          .map((item) => propertyText(item))
          .filter(Boolean)
          .map((item) => `<div><span>•</span><p>${escapeHtml(item)}</p></div>`)
          .join("")}
      </div>
    `
    : `<div class="bestiari-ref-item-empty-note">Свойства предмета пока не вынесены отдельно. Проверь описание и raw/source при необходимости.</div>`;

  const content = `
    <div class="bestiari-ref-item-sheet">
      ${renderBestiariInfoGrid([
        { label: "Тип", value: type },
        { label: "Редкость", value: rarity },
        { label: "Слот", value: slot },
        { label: "Настройка", value: attunement },
        { label: "Вес", value: weight },
        { label: "Стоимость", value: price },
        { label: "Источник", value: source },
      ], "bestiari-ref-item-info-grid")}
      ${propertiesHtml}
    </div>
  `;

  return renderBestiariDrawer("Параметры предмета", content, {
    icon: "◈",
    meta: rarity || "item",
    open: true,
    className: "bestiari-ref-item-drawer"
  });
}

function getClassArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && item !== "");
  if (value && typeof value === "object") return Object.values(value).filter((item) => item !== null && item !== undefined && item !== "");
  return [];
}

function getClassText(value, fallback = "") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).replace(/\s+/g, " ").trim();
  }
  if (Array.isArray(value)) {
    return value.map((item) => getClassText(item)).filter(Boolean).join("; ");
  }
  if (typeof value === "object") {
    return getClassText(value.text || value.description || value.name || value.title || value.label || value.value, fallback);
  }
  return fallback;
}

function getClassStableKey(value, fallback = "class-section") {
  const raw = getClassText(value, fallback).toLowerCase();
  const key = raw
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return key || fallback;
}

function renderClassFallbackNote(text) {
  return `<div class="bestiari-ref-class-subclass-warning">${escapeHtml(text)}</div>`;
}

function normalizeClassTable(table = {}, index = 0) {
  if (!table) return null;

  const source = Array.isArray(table) ? { rows: table } : table;
  const title = getClassText(
    source.title || source.name || source.caption || source.table_title || source.section_title,
    index === 0 ? "Таблица прогрессии" : `Таблица ${index + 1}`
  );
  const meta = getClassText(source.meta || source.note || source.source || source.subtitle || source.kind, "");

  let headers = getClassArray(source.headers || source.columns || source.header || source.thead);
  let rows = getClassArray(source.rows || source.body || source.data || source.tbody || source.values);

  if (!headers.length && rows.length && Array.isArray(rows[0])) {
    headers = rows[0];
    rows = rows.slice(1);
  }

  if (!headers.length && rows.length && rows[0] && typeof rows[0] === "object" && !Array.isArray(rows[0])) {
    headers = Object.keys(rows[0]);
  }

  headers = headers.map((header, headerIndex) => {
    if (typeof header === "string" || typeof header === "number") return String(header).trim() || `Колонка ${headerIndex + 1}`;
    return getClassText(header.label || header.name || header.title || header.key, `Колонка ${headerIndex + 1}`);
  });

  const normalizedRows = rows
    .map((row) => {
      if (Array.isArray(row)) return row.map((cell) => getClassText(cell, "—"));
      if (row && typeof row === "object") {
        return headers.map((header) => {
          const direct = row[header];
          if (direct !== undefined) return getClassText(direct, "—");

          const lowerHeader = String(header || "").toLowerCase();
          const matchedKey = Object.keys(row).find((key) => String(key).toLowerCase() === lowerHeader);
          if (matchedKey) return getClassText(row[matchedKey], "—");

          return "—";
        });
      }
      return [getClassText(row, "—")];
    })
    .filter((row) => row.some((cell) => String(cell || "").trim()));

  if (!headers.length && normalizedRows.length) {
    const width = Math.max(...normalizedRows.map((row) => row.length));
    headers = Array.from({ length: width }, (_, i) => `Колонка ${i + 1}`);
  }

  if (!headers.length || !normalizedRows.length) return null;

  return { title, meta, headers, rows: normalizedRows };
}

function scoreMainClassProgressionTable(table = {}) {
  const headersText = getClassArray(table.headers).map((item) => getClassText(item)).join(" ").toLowerCase();
  const titleText = getClassText(table.title || "").toLowerCase();
  const metaText = getClassText(table.meta || "").toLowerCase();
  const firstHeader = getClassText(getClassArray(table.headers)[0] || "").toLowerCase();
  const rowCount = getClassArray(table.rows).length;

  let score = 0;
  if (/уров|level/.test(headersText)) score += 5;
  if (/бонус\s*мастер|proficiency/.test(headersText)) score += 5;
  if (/умени|features?/.test(headersText)) score += 4;
  if (/ячейк|заклинан|spell slots?|spells known|cantrips?/.test(headersText)) score += 2;
  if (rowCount >= 18 && rowCount <= 22) score += 5;
  if (/прогресс|progression/.test(titleText)) score += 3;
  if (/таблица\s+прогресс|class\s+table/.test(titleText)) score += 3;
  if (/progression_or_feature_table/.test(metaText)) score += 1;

  if (/^к\s?\d+|^d\s?\d+|^1к|^1d/.test(firstHeader)) score -= 8;
  if (/эффект|effect|амбици|эксцентрич|книга|стихия|создаваем|заклинани[ея]$/.test(headersText) && rowCount < 18) score -= 4;
  if (/таблица\s+\d+/.test(titleText) && !/прогресс/.test(titleText)) score -= 2;

  return score;
}

function splitClassProgressionTables(data = {}) {
  const tables = getClassArray(data.progression_tables_round1 || data.progression_tables || data.progression)
    .map((table, index) => {
      const normalized = normalizeClassTable(table, index);
      if (!normalized) return null;
      return {
        ...normalized,
        sourceIndex: index,
        key: getClassStableKey(`${normalized.title || "table"}-${index}`, `class-table-${index}`),
        score: scoreMainClassProgressionTable(normalized),
      };
    })
    .filter(Boolean);

  if (!tables.length) return { main: [], additional: [], all: [] };

  const mainCandidate = tables
    .slice()
    .sort((a, b) => b.score - a.score || a.sourceIndex - b.sourceIndex)[0];

  const hasReliableMain = mainCandidate && mainCandidate.score >= 8;
  const main = hasReliableMain ? [mainCandidate] : [tables[0]];
  const mainKeys = new Set(main.map((table) => table.key));
  const additional = tables.filter((table) => !mainKeys.has(table.key));

  return { main, additional, all: tables };
}

function renderClassTableCard(table, index = 0, options = {}) {
  const label = options.label || "таблица";
  const primaryClass = options.primary || index === 0 ? "is-primary" : "";
  const meta = [table.meta, options.note].filter(Boolean).join(" · ");

  return `
    <article class="bestiari-ref-class-table-card ${primaryClass}" data-class-table-card="${escapeHtml(table.key || String(index))}">
      <div class="bestiari-ref-class-table-title">
        <div>
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(table.title || `Таблица ${index + 1}`)}</strong>
        </div>
        <div class="bestiari-ref-class-table-actions">
          ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
          <button class="bestiari-ref-class-table-fullscreen-btn" type="button" data-class-table-fullscreen="1" aria-label="Открыть таблицу во весь экран">⛶</button>
        </div>
      </div>
      <div class="bestiari-ref-class-table-scroll">
        <table class="bestiari-ref-class-table">
          <thead>
            <tr>${table.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${table.rows.map((row) => `
              <tr>
                ${table.headers.map((_, i) => `<td>${escapeHtml(row[i] ?? "—")}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderClassTableTabbedBlock(tables = [], options = {}) {
  const safeTables = getClassArray(tables);
  if (!safeTables.length) return "";
  if (safeTables.length === 1) {
    return `<div class="bestiari-ref-class-progression-stack">${renderClassTableCard(safeTables[0], 0, options)}</div>`;
  }

  const rootClass = options.rootClass || "bestiari-ref-class-table-tabs-block";
  const label = options.label || "таблица";

  return `
    <div class="${escapeHtml(rootClass)}" data-class-table-tabs-root="1">
      <div class="bestiari-ref-class-progression-tabs bestiari-ref-class-subclass-group-tabs">
        ${safeTables.map((table, index) => `
          <button class="${index === 0 ? "is-active" : ""}" type="button" data-class-table-tab="${escapeHtml(table.key)}">
            ${escapeHtml(table.title || `Таблица ${index + 1}`)} <span>${escapeHtml(String(index + 1))}</span>
          </button>
        `).join("")}
      </div>
      <div class="bestiari-ref-class-progression-stack" data-class-table-panels="1">
        ${safeTables.map((table, index) => `
          <section class="bestiari-ref-class-table-panel ${index === 0 ? "is-active" : ""}" data-class-table-panel="${escapeHtml(table.key)}" ${index === 0 ? "" : "hidden"}>
            ${renderClassTableCard(table, index, { ...options, label })}
          </section>
        `).join("")}
      </div>
    </div>
  `;
}

function renderClassProgression(data = {}) {
  const { main, additional, all } = splitClassProgressionTables(data);

  if (!all.length) {
    return renderBestiariDrawer(
      "Прогрессия класса",
      renderClassFallbackNote("Таблицы прогрессии пока не найдены в class_data. Raw сохранён, нужен отдельный clean-pass по классам."),
      {
        icon: "▦",
        meta: "нет таблиц",
        open: false,
        className: "bestiari-ref-class-progression-drawer",
      }
    );
  }

  const content = `
    ${additional.length ? `<div class="bestiari-ref-class-table-hint">Показана основная таблица прогрессии класса. Ещё ${escapeHtml(String(additional.length))} вспомогательных таблиц вынесено ниже в отдельный свернутый блок, чтобы не превращать класс в простыню.</div>` : ""}
    ${renderClassTableTabbedBlock(main, { label: "прогрессия", primary: true, rootClass: "bestiari-ref-class-main-progression" })}
  `;

  return renderBestiariDrawer("Прогрессия класса", content, {
    icon: "▦",
    meta: additional.length ? `1 + ${additional.length}` : "1",
    open: true,
    className: "bestiari-ref-class-progression-drawer",
  });
}

function renderClassAdditionalTables(data = {}) {
  const { additional } = splitClassProgressionTables(data);
  if (!additional.length) return "";

  const content = `
    <div class="bestiari-ref-class-table-hint">Это не основная прогрессия класса, а таблицы из особенностей, опциональных правил, подклассов, случайных эффектов или списков заклинаний. Они сохранены, но по умолчанию свернуты.</div>
    ${renderClassTableTabbedBlock(additional, { label: "доп. таблица", rootClass: "bestiari-ref-class-extra-tables" })}
  `;

  return renderBestiariDrawer("Дополнительные таблицы класса", content, {
    icon: "▥",
    meta: String(additional.length),
    open: false,
    className: "bestiari-ref-class-extra-tables-drawer",
  });
}

function normalizeClassFeature(feature = {}, fallbackIndex = 0) {
  if (typeof feature === "string") {
    return {
      name: `Особенность ${fallbackIndex + 1}`,
      level: "—",
      text: feature.replace(/\s+/g, " ").trim(),
    };
  }

  const name = getClassText(feature.name || feature.title || feature.label || feature.feature_name, `Особенность ${fallbackIndex + 1}`);
  const level = getClassText(feature.level || feature.lvl || feature.character_level || feature.available_at || feature.required_level, "—");
  const text = getClassText(
    feature.text || feature.description || feature.summary || feature.content || feature.body || feature.rules,
    ""
  );

  return { name, level, text };
}

function renderClassFeatureCards(features = [], limit = null) {
  const safeFeatures = getClassArray(features)
    .map((feature, index) => normalizeClassFeature(feature, index))
    .filter((feature) => feature.name || feature.text);

  const sliced = limit ? safeFeatures.slice(0, limit) : safeFeatures;
  if (!sliced.length) return "";

  return `
    <div class="bestiari-ref-class-feature-grid">
      ${sliced.map((feature) => `
        <article class="bestiari-ref-class-feature-card">
          <div class="bestiari-ref-class-feature-head">
            <strong>${escapeHtml(feature.name || "Особенность")}</strong>
            <span>${escapeHtml(feature.level || "—")}</span>
          </div>
          ${feature.text ? `<p>${escapeHtml(feature.text)}</p>` : ""}
        </article>
      `).join("")}
    </div>
  `;
}

function getSubclassName(subclass = {}, index = 0) {
  return getClassText(subclass.name || subclass.ru_name || subclass.title || subclass.label || subclass.subclass_name, `Подкласс ${index + 1}`);
}

function getSubclassGroup(subclass = {}) {
  const rawLabels = [];
  const pushLabel = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(pushLabel);
      return;
    }
    if (typeof value === "object") {
      pushLabel(value.name || value.title || value.label || value.value || value.text || value.code || value.slug);
      return;
    }
    const text = String(value || "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    if (text) rawLabels.push(text);
  };

  pushLabel(subclass.group);
  pushLabel(subclass.source_group);
  pushLabel(subclass.subclass_group);
  pushLabel(subclass.origin_group);
  pushLabel(subclass.bucket);
  pushLabel(subclass.category_bucket);
  pushLabel(subclass.source_type);
  pushLabel(subclass.origin);
  pushLabel(subclass.source);
  pushLabel(subclass.source_code);
  pushLabel(subclass.source_title);
  pushLabel(subclass.book);
  pushLabel(subclass.parent);
  pushLabel(subclass.category);
  pushLabel(subclass.type);
  pushLabel(subclass.tags);
  pushLabel(subclass.source_tags);
  pushLabel(subclass.flags);

  const haystack = rawLabels.join(" | ").toLowerCase();
  if (subclass.is_homebrew === true || /хоум\s*брю|home\s*brew|homebrew|custom|пользовательск|самодельн/.test(haystack)) return "Хоумбрю";
  if (/unearthed|arcana|\bua\b|playtest|плейтест|архив|неофициальн|unofficial/.test(haystack)) return "UA / unofficial";
  if (/critical role|tal[’']?dorei|explorer.*wildemount|mercers?/.test(haystack)) return "Сторонние / партнёрские";
  if (/official|player'?s handbook|player’s handbook|\bphb\b|xanathar|xgte|tasha|tcoe|scag|dmg|mordenkainen|fizban|van richten|strixhaven|spelljammer|planescape|eberron|ravnica|theros|dragonlance|официальн/.test(haystack)) return "Официальные";

  const explicit = rawLabels.find((label) => !/^(class|subclass|подкласс|подклассы|dnd\.su|dndsu|d&d|5e|класс)$/i.test(label));
  return explicit || "Без группы / clean-pass";
}

function getSubclassSummary(subclass = {}) {
  const paragraphs = getClassArray(subclass.paragraphs || subclass.sections || subclass.description_blocks)
    .map((item) => getClassText(item))
    .filter(Boolean);
  return getClassText(
    subclass.summary || subclass.description || subclass.text || subclass.intro || subclass.body,
    paragraphs.join(" ")
  );
}

function getSubclassFeatures(subclass = {}) {
  return getClassArray(
    subclass.features || subclass.features_round1 || subclass.class_features || subclass.abilities || subclass.traits || subclass.progression
  );
}

function renderClassSubclasses(entry = {}) {
  const data = entry.class_data || {};
  const subclasses = getClassArray(data.subclasses_round1 || data.subclasses || entry.subclasses);

  if (!subclasses.length) {
    return renderBestiariDrawer(
      "Подклассы",
      renderClassFallbackNote("Подклассы пока не вынесены в class_data. Если в raw они есть — нужен следующий enrichment/cleanup-pass."),
      {
        icon: "◇",
        meta: "0",
        open: false,
        className: "bestiari-ref-class-subclasses-drawer",
      }
    );
  }

  const grouped = new Map();
  subclasses.forEach((subclass, index) => {
    const groupTitle = getSubclassGroup(subclass);
    const key = getClassStableKey(groupTitle, `group-${index}`);
    if (!grouped.has(key)) grouped.set(key, { key, title: groupTitle, items: [] });
    grouped.get(key).items.push({ subclass, index });
  });

  const groups = Array.from(grouped.values());
  const content = `
    <div class="bestiari-ref-class-subclasses" data-class-subclasses-root="1">
      <div class="bestiari-ref-class-subclass-group-tabs">
        ${groups.map((group, index) => `
          <button class="${index === 0 ? "is-active" : ""}" type="button" data-class-subclass-group="${escapeHtml(group.key)}">
            ${escapeHtml(group.title)} <span>${escapeHtml(String(group.items.length))}</span>
          </button>
        `).join("")}
      </div>

      ${groups.map((group, groupIndex) => `
        <section class="bestiari-ref-class-subclass-panel ${groupIndex === 0 ? "is-active" : ""}" data-class-subclass-panel="${escapeHtml(group.key)}">
          <div class="bestiari-ref-class-subclass-rail">
            ${group.items.map(({ subclass, index }, itemIndex) => `
              <button class="${itemIndex === 0 ? "is-active" : ""}" type="button" data-class-subclass-chip="${escapeHtml(group.key)}" data-class-subclass-index="${escapeHtml(String(index))}">
                ${escapeHtml(getSubclassName(subclass, index))}
                ${getClassText(subclass.level || subclass.available_at || subclass.required_level) ? `<small>${escapeHtml(getClassText(subclass.level || subclass.available_at || subclass.required_level))}</small>` : ""}
              </button>
            `).join("")}
          </div>

          ${group.items.map(({ subclass, index }, itemIndex) => {
            const name = getSubclassName(subclass, index);
            const summary = getSubclassSummary(subclass);
            const features = getSubclassFeatures(subclass);
            const level = getClassText(subclass.level || subclass.available_at || subclass.required_level || subclass.source || "");
            return `
              <article class="bestiari-ref-class-subclass-detail ${itemIndex === 0 ? "is-active" : ""}" data-class-subclass-detail="${escapeHtml(group.key)}" data-class-subclass-index="${escapeHtml(String(index))}">
                <div class="bestiari-ref-class-subclass-hero">
                  <div>
                    <span>подкласс</span>
                    <h4>${escapeHtml(name)}</h4>
                  </div>
                  ${level ? `<small>${escapeHtml(level)}</small>` : ""}
                </div>
                ${summary ? `<p class="bestiari-ref-summary-text">${escapeHtml(summary)}</p>` : ""}
                ${renderClassFeatureCards(features, 12) || renderClassFallbackNote("Для этого подкласса пока нет вынесенных особенностей. Проверь raw/описание источника.")}
              </article>
            `;
          }).join("")}
        </section>
      `).join("")}
    </div>
  `;

  return renderBestiariDrawer("Подклассы", content, {
    icon: "◇",
    meta: String(subclasses.length),
    open: true,
    className: "bestiari-ref-class-subclasses-drawer",
  });
}

function renderClassFeatures(data = {}) {
  const features = getClassArray(data.features_round1 || data.features || data.class_features);
  const content = renderClassFeatureCards(features, 18) || renderClassFallbackNote("Особенности класса пока не структурированы. Raw сохранён; нужен clean-pass по features_round1.");

  return renderBestiariDrawer("Особенности класса", content, {
    icon: "✦",
    meta: String(features.length || 0),
    open: Boolean(features.length),
    className: "bestiari-ref-class-features-drawer",
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
    ${renderClassAdditionalTables(data)}
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

function renderRaceTraitCards(traits = [], limit = null) {
  const safeTraits = getClassArray(traits)
    .map((trait, index) => normalizeRaceTrait(trait, index))
    .filter((trait) => trait.name || trait.text);
  const sliced = limit ? safeTraits.slice(0, limit) : safeTraits;
  if (!sliced.length) return "";

  return `
    <div class="bestiari-ref-race-trait-grid">
      ${sliced.map((trait) => `
        <article class="bestiari-ref-race-trait-card">
          <div class="bestiari-ref-race-trait-head">
            <strong>${escapeHtml(trait.name || "Особенность")}</strong>
            <span>${escapeHtml(getRaceKindLabel(trait.kind))}</span>
          </div>
          ${trait.text ? `<p>${escapeHtml(trait.text)}</p>` : ""}
        </article>
      `).join("")}
    </div>
  `;
}

function splitRaceVariants(variants = []) {
  const normalized = getClassArray(variants)
    .map((variant, index) => normalizeRaceVariant(variant, index))
    .filter((variant) => variant.title);

  const mechanical = [];
  const lore = [];

  normalized.forEach((variant) => {
    const relation = String(variant.relationship_guess || "").toLowerCase();
    if (relation.includes("ethnicity") || relation.includes("lore")) lore.push(variant);
    else mechanical.push(variant);
  });

  return { mechanical, lore, all: normalized };
}

function normalizeRaceVariantLookup(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\b(scag|rlw|mtf|mot|egw|ftd|ua|hb)\b/gi, " ")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getRaceVariantLookupStems(value = "") {
  return normalizeRaceVariantLookup(value)
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length > 2)
    .map((word) => {
      let normalized = word
        .replace(/(ыми|ими|ого|ему|ому|ыми|ими|ая|яя|ые|ие|ый|ий|ой|ое|ее|ых|их|ам|ям|ов|ев|ей|а|я|ы|и)$/u, "");
      if (normalized.length < 4) normalized = word;
      return normalized.slice(0, Math.min(normalized.length, 8));
    });
}

function raceVariantTextMatches(variantTitle = "", candidateTitle = "", candidateFullText = "") {
  const variantKey = normalizeRaceVariantLookup(variantTitle);
  const titleKey = normalizeRaceVariantLookup(candidateTitle);
  const fullKey = normalizeRaceVariantLookup(candidateFullText);
  if (!variantKey || (!titleKey && !fullKey)) return false;

  if (titleKey && (titleKey === variantKey || titleKey.includes(variantKey) || variantKey.includes(titleKey))) return true;

  const stems = getRaceVariantLookupStems(variantTitle);
  if (stems.length) {
    const titleStemHit = titleKey && stems.every((stem) => titleKey.includes(stem));
    if (titleStemHit) return true;

    const usefulStemCount = stems.filter((stem) => stem.length >= 4).length;
    if (usefulStemCount >= 2 && stems.filter((stem) => fullKey.includes(stem)).length >= usefulStemCount) return true;
    if (usefulStemCount === 1 && stems.some((stem) => stem.length >= 5 && titleKey.includes(stem))) return true;
  }

  return false;
}

function getRaceVariantDetail(variant = {}, options = {}) {
  const title = getClassText(variant.title || variant.name || variant.ru_name || "", "");
  const directText = getClassText(variant.text || variant.description || variant.summary || variant.body || "", "");
  if (directText) {
    return {
      title,
      text: directText,
      source: variant.group_title || variant.source || "",
      found: true,
    };
  }

  const entry = options.entry || {};
  const fullDescription = getClassArray(entry.full_description || entry.fullDescription || []);
  const groupTitle = getClassText(variant.group_title || variant.group || "", "");
  const candidates = [];

  fullDescription.forEach((line, index) => {
    const text = getClassText(line, "");
    if (!text) return;
    const colonIndex = text.indexOf(":");
    const heading = colonIndex > -1 ? text.slice(0, colonIndex).trim() : "";
    const body = colonIndex > -1 ? text.slice(colonIndex + 1).trim() : text;
    const isTitleMatch = raceVariantTextMatches(title, heading || text, text);
    const isGroupMatch = groupTitle && raceVariantTextMatches(groupTitle, heading || text, text) && normalizeRaceVariantLookup(text).includes(normalizeRaceVariantLookup(title));
    if (!isTitleMatch && !isGroupMatch) return;

    let score = 0;
    if (isTitleMatch) score += 10;
    if (heading && normalizeRaceVariantLookup(heading) === normalizeRaceVariantLookup(title)) score += 20;
    if (body.length > 80) score += 4;
    if (index < 16) score += 1;
    candidates.push({ heading: heading || title, body, text, score });
  });

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best) {
    const text = best.body || best.text;
    return {
      title: best.heading || title,
      text: text.length > 1200 ? `${text.slice(0, 1200).trim()}…` : text,
      source: groupTitle,
      found: true,
    };
  }

  return {
    title,
    text: "Этот вариант найден в источнике как разновидность/подраса, но отдельный текст варианта пока не вынесен в структурированное поле. Полное описание сохранено в общей карточке расы; для финального LSS-pass нужно будет ещё разнести особенности вариантов по отдельным блокам.",
    source: groupTitle,
    found: false,
  };
}

function renderRaceVariantCards(variants = [], options = {}) {
  const safeVariants = getClassArray(variants)
    .map((variant, index) => normalizeRaceVariant(variant, index))
    .filter((variant) => variant.title);
  if (!safeVariants.length) return "";

  const icon = options.icon || "◇";
  return `
    <div class="bestiari-ref-race-variant-grid ${options.lore ? "is-lore" : ""}">
      ${safeVariants.map((variant, index) => {
        const detail = getRaceVariantDetail(variant, options);
        return `
          <article class="bestiari-ref-race-variant-card ${detail.found ? "has-detail" : "has-soft-detail"}">
            <button class="bestiari-ref-race-variant-trigger" type="button" data-race-variant-toggle="${escapeHtml(String(index))}" aria-expanded="false">
              <span class="bestiari-ref-race-variant-mark">${escapeHtml(icon)}</span>
              <span class="bestiari-ref-race-variant-main">
                <span class="bestiari-ref-race-variant-title">${escapeHtml(variant.title)}</span>
                ${variant.group_title ? `<small>${escapeHtml(variant.group_title)}</small>` : ""}
                ${variant.text ? `<p>${escapeHtml(variant.text)}</p>` : ""}
                <em>${detail.found ? "Нажми, чтобы раскрыть описание" : "Нажми, чтобы показать заметку"}</em>
              </span>
            </button>
            <div class="bestiari-ref-race-variant-detail" data-race-variant-detail hidden>
              ${detail.title && detail.title !== variant.title ? `<strong>${escapeHtml(detail.title)}</strong>` : ""}
              <p>${escapeHtml(detail.text)}</p>
              ${variant.url ? `<a href="${escapeHtml(variant.url)}" target="_blank" rel="noreferrer">Источник</a>` : ""}
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderRaceTables(data = {}) {
  const tables = getClassArray(data.tables_round2 || data.tables || [])
    .map((table, index) => {
      const normalized = normalizeClassTable(table, index);
      if (!normalized) return null;
      return {
        ...normalized,
        key: getClassStableKey(`${normalized.title || "race-table"}-${index}`, `race-table-${index}`),
      };
    })
    .filter(Boolean);

  if (!tables.length) return "";

  return renderBestiariDrawer(
    "Таблицы расы / происхождения",
    `<div class="bestiari-ref-class-table-hint">Сохранённые таблицы источника: имена, лорные варианты, случайные черты, метки или опциональные материалы. Они свернуты, чтобы карточка не превращалась в простыню.</div>${renderClassTableTabbedBlock(tables, { label: "таблица", rootClass: "bestiari-ref-race-extra-tables" })}`,
    {
      icon: "▥",
      meta: String(tables.length),
      open: false,
      className: "bestiari-ref-race-tables-drawer",
    }
  );
}

function renderRaceSpellRefs(data = {}) {
  const refs = normalizeRaceSourceRefs(data.spell_refs_round2 || data.spell_refs_round1 || []);
  if (!refs.length) return "";

  return renderBestiariDrawer(
    "Связанные заклинания",
    `<div class="bestiari-ref-related-list bestiari-ref-race-spell-list">${refs.map((ref) => `<button type="button" data-bestiari-related="${escapeHtml(ref.title)}">${escapeHtml(ref.title)}</button>`).join("")}</div>`,
    {
      icon: "✧",
      meta: String(refs.length),
      open: false,
      className: "bestiari-ref-race-spells-drawer",
    }
  );
}


function renderRaceLoreDrawer(entry = {}) {
  const body = getClassArray(entry.body || []).filter(Boolean);
  const full = getClassArray(entry.full_description || entry.fullDescription || []).filter(Boolean);
  const paragraphs = [...body.slice(1), ...full]
    .map((item) => getClassText(item, ""))
    .filter(Boolean)
    .slice(0, 32);

  if (!paragraphs.length) return "";

  return renderBestiariDrawer(
    "Полный лор / текст источника",
    `<div class="bestiari-ref-description-flow bestiari-ref-race-lore-flow">
      ${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
    </div>`,
    {
      icon: "✥",
      meta: `${paragraphs.length} блоков`,
      open: false,
      className: "bestiari-ref-race-lore-drawer",
    }
  );
}

function renderRaceVariantTraitReview(data = {}) {
  const assigned = getClassArray(data.variant_traits_round2 || []);
  const unassigned = getClassArray(data.variant_traits_unassigned_round2 || []);
  const traits = [...assigned, ...unassigned];
  if (!traits.length) return "";

  const content = `
    <div class="bestiari-ref-class-table-hint">Эти особенности уже отделены от базовой расы, но ещё не все безопасно привязаны к конкретной разновидности. Для игрока по умолчанию они свернуты, чтобы не смешивать базу и подрасы.</div>
    ${renderRaceTraitCards(traits, 24)}
  `;

  return renderBestiariDrawer("Особенности разновидностей / review", content, {
    icon: "◇",
    meta: String(traits.length),
    open: false,
    className: "bestiari-ref-race-variant-traits-drawer",
  });
}

function renderRaceSection(entry) {
  const data = entry.race_data;
  if (!data) return "";

  const allTraits = getClassArray(data.traits_round2 || data.traits_round1 || []);
  const baseTraitsRaw = getClassArray(data.base_traits_round2 || data.base_traits || []);
  const traits = baseTraitsRaw.length ? baseTraitsRaw : allTraits;
  const variants = getClassArray(data.variants_round2 || data.variant_refs_round2 || []);
  const { mechanical, lore } = splitRaceVariants(variants);
  const lss = data.lss_ready || {};
  const spellCount = getClassArray(data.spell_refs_round2 || data.spell_refs_round1 || []).length;
  const tableCount = getClassArray(data.tables_round2 || data.tables || []).length;
  const variantTraitCount = getClassArray(data.variant_traits_round2 || []).length + getClassArray(data.variant_traits_unassigned_round2 || []).length;

  const lssCore = [
    lss.ability_score_increase?.display || lss.ability_score_increase?.text || "",
    lss.size?.display || lss.size?.text || "",
    lss.speed?.display || lss.speed?.text || "",
    lss.darkvision?.display || lss.darkvision?.text || "",
    lss.languages?.display || lss.languages?.text || "",
  ].filter(Boolean);

  const content = `
    <div class="bestiari-ref-race-compact-note">
      <strong>Короткая карточка</strong>
      <span>По умолчанию показаны только базовые правила расы. Лор, таблицы, заклинания и спорные особенности разновидностей свернуты ниже.</span>
    </div>

    ${renderBestiariInfoGrid([
      { label: "База", value: `${traits.length || 0} особенностей` },
      { label: "Разновидности", value: String(mechanical.length || 0) },
      { label: "Лор-варианты", value: String(lore.length || 0) },
      { label: "Дополнительно", value: [spellCount ? `${spellCount} закл.` : "", tableCount ? `${tableCount} табл.` : ""].filter(Boolean).join(" · ") || "—" },
    ], "bestiari-ref-race-info-grid bestiari-ref-race-info-grid-compact")}

    ${lssCore.length ? `<div class="bestiari-ref-race-lss-note"><strong>LSS-ready:</strong><span>${escapeHtml(lssCore.join(" · "))}</span></div>` : ""}

    ${traits.length ? renderBestiariDrawer("Базовые особенности расы", renderRaceTraitCards(traits, 12), {
      icon: "✦",
      meta: String(traits.length),
      open: true,
      className: "bestiari-ref-race-traits-drawer is-base-traits",
    }) : ""}

    ${mechanical.length ? renderBestiariDrawer("Разновидности / подрасы", renderRaceVariantCards(mechanical, { icon: "◇", entry, data }), {
      icon: "◇",
      meta: String(mechanical.length),
      open: true,
      className: "bestiari-ref-race-variants-drawer",
    }) : ""}

    ${lore.length ? renderBestiariDrawer("Этносы / лорные варианты", renderRaceVariantCards(lore, { icon: "◎", lore: true, entry, data }), {
      icon: "◎",
      meta: String(lore.length),
      open: false,
      className: "bestiari-ref-race-lore-variants-drawer",
    }) : ""}

    ${variantTraitCount ? renderRaceVariantTraitReview(data) : ""}
    ${renderRaceLoreDrawer(entry)}
    ${renderRaceSpellRefs(data)}
    ${renderRaceTables(data)}
  `;

  return renderBestiariDrawer("Параметры расы", content, {
    icon: "◎",
    meta: variants.length ? `${traits.length} + ${variants.length}` : String(traits.length || "race"),
    open: true,
    className: "bestiari-ref-race-section-drawer is-condensed-race-card",
  });
}


function getBackgroundList(value) {
  return getClassArray(value).map((item) => getClassText(item, "")).filter(Boolean);
}

function renderBackgroundValueCard(label, value, options = {}) {
  const list = Array.isArray(value) ? value.filter(Boolean) : getBackgroundList(value);
  const raw = !Array.isArray(value) ? getClassText(value, "") : "";
  if (!list.length && !raw) return "";
  const content = list.length
    ? `<div class="bestiari-ref-background-chip-list">${list.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`
    : `<p>${escapeHtml(raw)}</p>`;
  return `
    <article class="bestiari-ref-background-field-card ${options.wide ? "is-wide" : ""}">
      <strong>${escapeHtml(label)}</strong>
      ${content}
    </article>
  `;
}

function renderBackgroundFields(data = {}) {
  const fields = data.fields || {};
  const skillGuess = getClassArray(fields.skill_proficiencies_guess || []);
  const toolGuess = getClassArray(fields.tool_proficiencies_guess || []);
  const languageGuess = getClassArray(fields.languages_guess || []);
  const equipmentGuess = getClassArray(fields.equipment_guess || []);
  const equipmentRaw = getClassText(fields.equipment_raw || "", "");

  const cards = [
    renderBackgroundValueCard("Навыки", skillGuess.length ? skillGuess : fields.skill_proficiencies_raw),
    renderBackgroundValueCard("Инструменты", toolGuess.length ? toolGuess : fields.tool_proficiencies_raw),
    renderBackgroundValueCard("Языки", languageGuess.length ? languageGuess : fields.languages_raw),
    renderBackgroundValueCard("Снаряжение", equipmentGuess.length ? equipmentGuess : equipmentRaw, { wide: true }),
  ].filter(Boolean);

  if (!cards.length) return "";
  return `<div class="bestiari-ref-background-field-grid">${cards.join("")}</div>`;
}

function renderBackgroundFeature(data = {}) {
  const feature = data.feature || {};
  const name = getClassText(feature.name || feature.title || "", "");
  const text = getClassText(feature.text || "", "");
  if (!name && !text) return "";

  return renderBestiariDrawer(
    name ? `Умение: ${name}` : "Умение предыстории",
    `<div class="bestiari-ref-background-feature">
      ${text ? `<p>${escapeHtml(text)}</p>` : `<p class="muted">Текст умения сохранён в полном источнике, но не был уверенно выделен.</p>`}
    </div>`,
    {
      icon: "✦",
      meta: "feature",
      open: true,
      className: "bestiari-ref-background-feature-drawer",
    }
  );
}

function renderBackgroundVariants(data = {}) {
  const variants = getClassArray(data.variants_round1 || data.variants || []).filter((variant) => variant && typeof variant === "object");
  if (!variants.length) return "";
  const content = `
    <div class="bestiari-ref-background-variant-list">
      ${variants.map((variant) => `
        <article class="bestiari-ref-background-variant-card">
          <strong>${escapeHtml(variant.title || variant.name || "Вариант")}</strong>
          ${variant.text ? `<p>${escapeHtml(variant.text)}</p>` : ""}
        </article>
      `).join("")}
    </div>
  `;
  return renderBestiariDrawer("Варианты / разновидности", content, {
    icon: "◇",
    meta: String(variants.length),
    open: false,
    className: "bestiari-ref-background-variants-drawer",
  });
}

function renderBackgroundTablesBlock(title, tables, options = {}) {
  const normalized = getClassArray(tables)
    .map((table, index) => normalizeClassTable(table, index))
    .filter(Boolean)
    .map((table, index) => ({
      ...table,
      key: getClassStableKey(`${title}-${table.title || "table"}-${index}`, `background-table-${index}`),
    }));
  if (!normalized.length) return "";

  return renderBestiariDrawer(
    title,
    `<div class="bestiari-ref-class-table-hint">${escapeHtml(options.hint || "Таблицы сохранены из источника и свернуты, чтобы карточка не превращалась в простыню.")}</div>${renderClassTableTabbedBlock(normalized, { label: "таблица", rootClass: "bestiari-ref-background-tables" })}`,
    {
      icon: options.icon || "▥",
      meta: String(normalized.length),
      open: options.open === true,
      className: options.className || "bestiari-ref-background-tables-drawer",
    }
  );
}

function renderBackgroundFullTextDrawer(entry = {}) {
  const lines = getClassArray(entry.full_description || entry.fullDescription || [])
    .map((line) => getClassText(line, ""))
    .filter(Boolean)
    .slice(0, 28);
  if (!lines.length) return "";
  return renderBestiariDrawer(
    "Полный текст источника",
    `<div class="bestiari-ref-description-flow bestiari-ref-background-full-flow">${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</div>`,
    {
      icon: "✥",
      meta: `${lines.length} блоков`,
      open: false,
      className: "bestiari-ref-background-full-drawer",
    }
  );
}

function renderBackgroundSection(entry) {
  const data = entry.background_data;
  if (!data) return "";

  const fields = data.fields || {};
  const feature = data.feature || {};
  const variants = getClassArray(data.variants_round1 || []);
  const personalityTables = getClassArray(data.personality_tables_round1 || []);
  const optionTables = getClassArray(data.option_tables_round1 || []);
  const otherTables = getClassArray(data.other_tables_round1 || []);
  const flags = getClassArray(data.lss_ready?.review_flags || entry.quality?.flags || []);

  const skills = getClassArray(fields.skill_proficiencies_guess || []);
  const tools = getClassArray(fields.tool_proficiencies_guess || []);
  const languages = getClassArray(fields.languages_guess || []);
  const equipmentRaw = getClassText(fields.equipment_raw || "", "");

  const content = `
    <div class="bestiari-ref-background-compact-note">
      <strong>Короткая карточка</strong>
      <span>По умолчанию показаны только LSS-важные поля: навыки, инструменты, снаряжение и умение. Таблицы личности и полный текст свернуты ниже.</span>
    </div>

    ${renderBestiariInfoGrid([
      { label: "Навыки", value: skills.length ? String(skills.length) : (fields.skill_proficiencies_raw ? "есть" : "—") },
      { label: "Инструменты", value: tools.length ? String(tools.length) : (fields.tool_proficiencies_raw ? "есть" : "—") },
      { label: "Языки", value: languages.length ? String(languages.length) : (fields.languages_raw ? "есть" : "—") },
      { label: "Снаряжение", value: equipmentRaw ? "есть" : "—" },
      { label: "Умение", value: feature?.name || feature?.title || "—" },
      { label: "Таблицы", value: String(personalityTables.length + optionTables.length + otherTables.length || 0) },
    ], "bestiari-ref-background-info-grid")}

    ${renderBackgroundFields(data)}
    ${renderBackgroundFeature(data)}
    ${renderBackgroundVariants(data)}
    ${renderBackgroundTablesBlock("Персонализация", personalityTables, { icon: "◇", open: false, hint: "Черты характера, идеалы, привязанности и слабости для LSS/ролеплея." })}
    ${renderBackgroundTablesBlock("Специализация / выбор", optionTables, { icon: "▦", open: false, hint: "Таблицы вроде амплуа артиста, специализации мудреца, преступной специальности и других выборов." })}
    ${renderBackgroundTablesBlock("Дополнительные таблицы", otherTables, { icon: "▥", open: false })}
    ${flags.length ? renderBestiariDrawer("Проверить / clean-pass", `<div class="bestiari-ref-named-list">${flags.map((flag) => `<div><span>!</span><p>${escapeHtml(flag)}</p></div>`).join("")}</div>`, { icon: "!", meta: String(flags.length), open: false, className: "bestiari-ref-background-flags-drawer" }) : ""}
    ${renderBackgroundFullTextDrawer(entry)}
  `;

  return renderBestiariDrawer("Параметры происхождения", content, {
    icon: "◌",
    meta: feature?.name || "background",
    open: true,
    className: "bestiari-ref-background-section-drawer",
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



function renderMonsterSupplementalSections(entry) {
  const supplemental = Array.isArray(entry?.monster_data?.supplemental_entries)
    ? entry.monster_data.supplemental_entries
    : [];
  if (!supplemental.length) return "";

  const content = `
    <div class="bestiari-ref-named-list bestiari-ref-monster-supplemental-list">
      ${supplemental.map((item) => {
        if (typeof item === "string") return `<div><span>◇</span><p>${escapeHtml(item)}</p></div>`;
        const source = item.source_section ? `<em>${escapeHtml(item.source_section)}</em>` : "";
        return `
          <div>
            <span>◇</span>
            <p>
              <strong>${escapeHtml(item.name || item.title || "Дополнительный материал")}</strong>
              ${source}
              ${item.text ? `<br>${escapeHtml(item.text)}` : ""}
            </p>
          </div>
        `;
      }).join("")}
    </div>
    <div class="bestiari-ref-source-hint"><span>Вынесено из боевого статблока: parser round1 сохранил текст, но это не легендарные/мифические действия.</span></div>
  `;

  return renderBestiariDrawer("Лор / опциональные материалы", content, {
    icon: "◇",
    meta: String(supplemental.length),
    open: false,
    className: "bestiari-ref-monster-supplemental-drawer",
  });
}



function normalizeMonsterRawFallbackLine(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function getMonsterRawFallbackBuckets(entry = {}) {
  if (!entry || entry.category !== "monsters") return [];

  const buckets = entry.section_buckets || entry.monster_data?.section_buckets || {};
  const monsterRaw = entry.monster_data?.raw_preserved || entry.monster_data?.raw || {};
  const rawFields = entry.raw_fields || {};
  const collected = [];
  const seen = new Set();

  const pushBucket = (label, lines, maxLines = 220) => {
    const normalized = normalizeTextBlock(lines)
      .map(normalizeMonsterRawFallbackLine)
      .filter(Boolean)
      .filter((line) => !/^свернуть$/i.test(line))
      .filter((line) => !/^развернуть$/i.test(line))
      .filter((line) => !/^комментар/i.test(line))
      .filter((line) => !/^оставить комментар/i.test(line))
      .slice(0, maxLines);

    const unique = [];
    for (const line of normalized) {
      const key = `${label}::${line.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(line);
    }
    if (unique.length) collected.push({ label, lines: unique });
  };

  const bucketMap = [
    ["Базовый статблок", buckets.core?.raw_lines || buckets.statblock?.raw_lines || buckets.header?.raw_lines],
    ["Особенности", buckets.traits?.raw_lines],
    ["Действия", buckets.actions?.raw_lines],
    ["Бонусные действия", buckets.bonus_actions?.raw_lines],
    ["Реакции", buckets.reactions?.raw_lines],
    ["Легендарные действия", buckets.legendary_actions?.raw_lines],
    ["Мифические действия", buckets.mythic_actions?.raw_lines],
    ["Действия логова", buckets.lair_actions?.raw_lines],
    ["Региональные эффекты", buckets.regional_effects?.raw_lines],
  ];

  for (const [label, lines] of bucketMap) pushBucket(label, lines);

  const fallbackRawLines = [
    monsterRaw.statblock_lines,
    monsterRaw.raw_lines,
    monsterRaw.page_lines,
    rawFields.statblock_lines,
    rawFields.raw_lines,
    rawFields.page_lines,
    entry.raw_lines,
  ];

  if (!collected.length) {
    for (const lines of fallbackRawLines) {
      const normalized = normalizeTextBlock(lines);
      if (normalized.length) {
        const startIndex = normalized.findIndex((line) => /^(класс доспеха|хиты|скорость|сил\b|действия|особенности|легендарные действия|мифические действия)/i.test(String(line || "").trim()));
        pushBucket("Сырой статблок", startIndex >= 0 ? normalized.slice(startIndex) : normalized, 260);
        break;
      }
    }
  }

  return collected;
}

function isMonsterRawFallbackUseful(entry = {}, buckets = []) {
  if (!buckets.length) return false;
  const sb = entry.statblock || {};
  const normalizedCount = [
    sb.traits,
    sb.actions,
    sb.bonus_actions,
    sb.reactions,
    sb.legendary_actions,
    sb.mythic_actions,
    sb.lair_actions,
    sb.regional_effects,
  ].reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);

  const rawLineCount = buckets.reduce((sum, bucket) => sum + (bucket.lines?.length || 0), 0);
  const needsReview = Boolean(entry.review?.needs_review || entry.monster_data?.review?.needs_review);
  return rawLineCount >= 8 && (normalizedCount <= 3 || needsReview || rawLineCount > normalizedCount * 3);
}

function renderMonsterRawStatblockFallback(entry) {
  const buckets = getMonsterRawFallbackBuckets(entry);
  if (!isMonsterRawFallbackUseful(entry, buckets)) return "";

  const total = buckets.reduce((sum, bucket) => sum + (bucket.lines?.length || 0), 0);
  const content = `
    <div class="bestiari-ref-monster-raw-note">
      <strong>Raw-first:</strong>
      <span>Parser round1 не обязан идеально разложить сложного монстра. Этот блок показывает сохранённый сырой статблок, чтобы не потерять действия, легендарки и механику до clean-pass.</span>
    </div>
    <div class="bestiari-ref-monster-raw-block">
      ${buckets.map((bucket) => `
        <section class="bestiari-ref-monster-raw-section">
          <h4>${escapeHtml(bucket.label || "Секция")}</h4>
          <div class="bestiari-ref-monster-raw-lines">
            ${(bucket.lines || []).map((line, index) => {
              const isHeading = /^(действия|бонусные действия|реакции|легендарные действия|мифические действия|действия логова|региональные эффекты|особенности|класс доспеха|хиты|скорость|сил\b|лов\b|тел\b|инт\b|мдр\b|хар\b)/i.test(line);
              return `<div class="bestiari-ref-monster-raw-line ${isHeading ? "is-heading" : ""}"><b>${escapeHtml(String(index + 1).padStart(2, "0"))}</b><span>${escapeHtml(line)}</span></div>`;
            }).join("")}
          </div>
        </section>
      `).join("")}
    </div>
  `;

  return renderBestiariDrawer("Сырой статблок / не терять механику", content, {
    icon: "☠",
    meta: `${total} строк`,
    open: true,
    className: "bestiari-ref-monster-raw-drawer",
  });
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
        ${entry.category === "races" || entry.category === "backgrounds" ? "" : renderFullDescription(entry)}
        ${renderDeitySection(entry)}
        ${renderStatblock(entry)}
        ${renderMonsterRawStatblockFallback(entry)}
        ${renderMonsterSupplementalSections(entry)}
        ${renderMonsterReview(entry)}
        ${renderSpellSection(entry)}
        ${renderItemSection(entry)}
        ${renderClassSection(entry)}
        ${renderRaceSection(entry)}
        ${renderBackgroundSection(entry)}
        ${entry.category === "classes" || entry.category === "races" || entry.category === "backgrounds" ? "" : renderMechanics(entry)}
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
      BESTIARI_STATE.searchRenderTimer = window.setTimeout(async () => {
        BESTIARI_STATE.searchRenderTimer = null;
        renderCodex({ preserveScroll: true, preserveFocus: true });
        await ensureBestiariSeedsForCurrentView({ renderWhenDone: true });
      }, BESTIARI_SEARCH_RENDER_DELAY_MS);
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
    btn.addEventListener("click", async () => {
      BESTIARI_STATE.category = btn.dataset.bestiariCategory || "all";
      BESTIARI_STATE.showFullDescription = false;
      BESTIARI_STATE.showFullStats = false;
      BESTIARI_STATE.selectedId = getVisibleEntries()[0]?.id || "";
      renderCodex();
      await ensureBestiariSeedsForCurrentView({ renderWhenDone: true });
      BESTIARI_STATE.selectedId = getVisibleEntries()[0]?.id || BESTIARI_STATE.selectedId || "";
      renderCodex({ preserveScroll: true });
    });
  });

  document.querySelectorAll("[data-bestiari-load-category]").forEach((btn) => {
    if (btn.dataset.boundBestiariLoadCategory === "1") return;
    btn.dataset.boundBestiariLoadCategory = "1";
    btn.addEventListener("click", async () => {
      const category = btn.dataset.bestiariLoadCategory || BESTIARI_STATE.category || "all";
      BESTIARI_STATE.category = category;
      renderCodex({ preserveScroll: true });
      await loadBestiariSeedCategory(category, { renderWhenDone: true });
      BESTIARI_STATE.selectedId = getVisibleEntries()[0]?.id || BESTIARI_STATE.selectedId || "";
      renderCodex({ preserveScroll: true });
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

  document.querySelectorAll("[data-class-table-tab]").forEach((btn) => {
    if (btn.dataset.boundClassTableTab === "1") return;
    btn.dataset.boundClassTableTab = "1";
    btn.addEventListener("click", () => {
      const root = btn.closest("[data-class-table-tabs-root]");
      const tableKey = btn.dataset.classTableTab || "";
      if (!root || !tableKey) return;

      root.querySelectorAll("[data-class-table-tab]").forEach((item) => {
        item.classList.toggle("is-active", item === btn);
      });

      root.querySelectorAll("[data-class-table-panel]").forEach((panel) => {
        const isActive = panel.dataset.classTablePanel === tableKey;
        panel.classList.toggle("is-active", isActive);
        panel.hidden = !isActive;
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

  document.querySelectorAll("[data-race-variant-toggle]").forEach((btn) => {
    if (btn.dataset.boundRaceVariantToggle === "1") return;
    btn.dataset.boundRaceVariantToggle = "1";
    btn.addEventListener("click", () => {
      const card = btn.closest(".bestiari-ref-race-variant-card");
      const grid = btn.closest(".bestiari-ref-race-variant-grid");
      const detail = card?.querySelector("[data-race-variant-detail]");
      if (!card || !detail) return;

      const shouldOpen = detail.hidden;
      grid?.querySelectorAll(".bestiari-ref-race-variant-card").forEach((item) => {
        const itemDetail = item.querySelector("[data-race-variant-detail]");
        const itemButton = item.querySelector("[data-race-variant-toggle]");
        if (item !== card && itemDetail) {
          item.classList.remove("is-active");
          itemDetail.hidden = true;
          itemButton?.setAttribute("aria-expanded", "false");
        }
      });

      card.classList.toggle("is-active", shouldOpen);
      detail.hidden = !shouldOpen;
      btn.setAttribute("aria-expanded", String(shouldOpen));
    });
  });

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

  if (BESTIARI_STATE.loaded && Array.isArray(BESTIARI_STATE.entries) && BESTIARI_STATE.entries.length) {
    return BESTIARI_STATE;
  }

  if (BESTIARI_STATE.loadingPromise) {
    return BESTIARI_STATE.loadingPromise;
  }

  BESTIARI_STATE.loadingPromise = (async () => {
    const defaultEntries = BESTIARI_DEFAULT_ENTRIES.map(normalizeEntry);
    const localEntriesRaw = loadLocalEntries();
    const localEntries = Array.isArray(localEntriesRaw) && localEntriesRaw.length
      ? localEntriesRaw.map(normalizeEntry)
      : [];
    BESTIARI_STATE.entries = mergeEntryLists(
      defaultEntries,
      localEntries
    );

    BESTIARI_STATE.source = localEntries.length ? "local + seed + lazy" : "seed + lazy";

    // Не пишем весь внешний справочник обратно в localStorage при каждой загрузке.
    // Это раньше могло давать лишний фриз на холодном старте энциклопедии.
    BESTIARI_STATE.loaded = true;
    BESTIARI_STATE.selectedId = BESTIARI_STATE.selectedId || BESTIARI_STATE.entries[0]?.id || "";

    // Лёгкий прогрев: классы/расы/происхождения догружаются фоном.
    // Монстры/предметы/заклинания не грузятся до открытия раздела или поиска.
    queueInitialBestiariSeedWarmup();
    return BESTIARI_STATE;
  })();

  try {
    return await BESTIARI_STATE.loadingPromise;
  } finally {
    BESTIARI_STATE.loadingPromise = null;
  }
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
