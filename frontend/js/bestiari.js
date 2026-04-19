// ============================================================
// frontend/js/bestiari.js
// Bestiari / Энциклопедия D&D Trader
// - local-first база знаний по монстрам, богам, лору, механикам,
//   заклинаниям, предметам, классам и прочим сущностям D&D
// - подготовлено под будущую загрузку из JSON / API
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
};

const BESTIARI_CATEGORY_LABELS = {
  all: "Всё",
  monsters: "Монстры",
  gods: "Боги",
  lore: "Лор",
  mechanics: "Механики",
  spells: "Заклинания",
  items: "Предметы",
  classes: "Классы",
  subclasses: "Подклассы",
  races: "Расы",
  factions: "Фракции",
  locations: "Локации",
  events: "События",
  conditions: "Состояния",
};

const BESTIARI_STORAGE_PREFIX = "dnd_trader_bestiari_";

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
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
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

function normalizeAbilities(raw = {}) {
  const source = raw || {};
  const fromLines = typeof raw === "string" ? parseKeyValueLines(raw) : {};
  const getValue = (keys, fallback = 10) => {
    for (const key of keys) {
      const direct = source[key];
      if (direct !== undefined && direct !== null && direct !== "") {
        const num = Number(direct);
        if (Number.isFinite(num)) return num;
      }
      const lineVal = fromLines[key];
      if (lineVal !== undefined) {
        const num = Number(lineVal);
        if (Number.isFinite(num)) return num;
      }
    }
    return fallback;
  };
  return {
    str: getValue(["str", "strength", "сила"]),
    dex: getValue(["dex", "dexterity", "ловкость"]),
    con: getValue(["con", "constitution", "телосложение"]),
    int: getValue(["int", "intelligence", "интеллект"]),
    wis: getValue(["wis", "wisdom", "мудрость"]),
    cha: getValue(["cha", "charisma", "харизма"]),
  };
}

function normalizeStatblock(raw = {}) {
  if (!raw || typeof raw !== "object") return null;
  const abilities = normalizeAbilities(raw.abilities || raw.stats || {});
  return {
    level_like: safeText(raw.level_like || raw.cr || raw.challenge_rating),
    size: safeText(raw.size),
    type: safeText(raw.type),
    alignment: safeText(raw.alignment),
    ac: safeText(raw.ac),
    hp: safeText(raw.hp),
    speed: safeText(raw.speed),
    initiative: safeText(raw.initiative),
    proficiency_bonus: safeText(raw.proficiency_bonus || raw.pb),
    abilities,
    saves: normalizeTextBlock(raw.saves),
    skills: normalizeTextBlock(raw.skills),
    senses: normalizeTextBlock(raw.senses),
    languages: normalizeTextBlock(raw.languages),
    vulnerabilities: normalizeTextBlock(raw.vulnerabilities),
    resistances: normalizeTextBlock(raw.resistances),
    immunities: normalizeTextBlock(raw.immunities),
    conditions_immunity: normalizeTextBlock(raw.conditions_immunity),
    traits: Array.isArray(raw.traits) ? raw.traits : normalizeTextBlock(raw.traits).map((text) => ({ name: "Особенность", text })),
    actions: Array.isArray(raw.actions) ? raw.actions : normalizeTextBlock(raw.actions).map((text) => ({ name: "Действие", text })),
    bonus_actions: Array.isArray(raw.bonus_actions) ? raw.bonus_actions : normalizeTextBlock(raw.bonus_actions).map((text) => ({ name: "Бонусное действие", text })),
    reactions: Array.isArray(raw.reactions) ? raw.reactions : normalizeTextBlock(raw.reactions).map((text) => ({ name: "Реакция", text })),
    legendary_actions: Array.isArray(raw.legendary_actions) ? raw.legendary_actions : normalizeTextBlock(raw.legendary_actions).map((text) => ({ name: "Легендарное действие", text })),
    lair_actions: Array.isArray(raw.lair_actions) ? raw.lair_actions : normalizeTextBlock(raw.lair_actions).map((text) => ({ name: "Действие логова", text })),
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
  };
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

function renderCategoryButtons(entries) {
  const stats = countByCategory(entries);
  return Object.entries(BESTIARI_CATEGORY_LABELS)
    .map(([key, label]) => {
      const active = BESTIARI_STATE.category === key ? "active" : "";
      const count = key === "all" ? entries.length : stats[key] || 0;
      return `
        <button
          class="btn ${active}"
          type="button"
          data-bestiari-category="${escapeHtml(key)}"
          style="min-height:34px; padding:7px 11px; border-radius:10px;"
        >
          ${escapeHtml(label)} <span style="opacity:.78;">${count}</span>
        </button>
      `;
    })
    .join("");
}

function renderEditorPanel() {
  if (!BESTIARI_STATE.editorOpen || !BESTIARI_STATE.draft) return "";
  const d = BESTIARI_STATE.draft;

  return `
    <div class="cabinet-block" style="margin-bottom:12px; padding:14px;">
      <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
        <div>
          <h4 style="margin:0 0 4px 0;">🛠 Редактор записи</h4>
          <div class="muted">Компактная форма для ручного добавления или правки записи.</div>
        </div>
        <div class="cart-buttons">
          <button class="btn btn-success" type="button" id="bestiariSaveDraftBtn">Сохранить</button>
          <button class="btn" type="button" id="bestiariCancelDraftBtn">Отмена</button>
        </div>
      </div>

      <input id="bestiariDraftId" type="hidden" value="${escapeHtml(d.id)}">

      <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px;">
        <div class="filter-group">
          <label>Категория</label>
          <select id="bestiariDraftCategory">
            ${Object.entries(BESTIARI_CATEGORY_LABELS)
              .filter(([key]) => key !== "all")
              .map(([key, label]) => `<option value="${escapeHtml(key)}" ${d.category === key ? "selected" : ""}>${escapeHtml(label)}</option>`)
              .join("")}
          </select>
        </div>
        <div class="filter-group">
          <label>Название</label>
          <input id="bestiariDraftTitle" type="text" value="${escapeHtml(d.title)}">
        </div>
        <div class="filter-group">
          <label>Подзаголовок</label>
          <input id="bestiariDraftSubtitle" type="text" value="${escapeHtml(d.subtitle)}">
        </div>
        <div class="filter-group">
          <label>Источник</label>
          <input id="bestiariDraftSource" type="text" value="${escapeHtml(d.source)}">
        </div>
      </div>

      <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; margin-top:10px;">
        <div class="filter-group">
          <label>Теги</label>
          <input id="bestiariDraftTags" type="text" value="${escapeHtml(d.tags)}" placeholder="монстр, огонь, магия">
        </div>
        <div class="filter-group">
          <label>Связанные ID</label>
          <input id="bestiariDraftRelated" type="text" value="${escapeHtml(d.related)}" placeholder="spell-fireball, class-wizard">
        </div>
      </div>

      <div class="filter-group" style="margin-top:10px;">
        <label>Краткая сводка</label>
        <textarea id="bestiariDraftSummary" rows="3">${escapeHtml(d.summary)}</textarea>
      </div>

      <div class="profile-grid" style="grid-template-columns:1fr 1fr; gap:10px; margin-top:10px;">
        <div class="filter-group">
          <label>Основное описание</label>
          <textarea id="bestiariDraftBody" rows="6">${escapeHtml(d.body)}</textarea>
        </div>
        <div class="filter-group">
          <label>Полное описание</label>
          <textarea id="bestiariDraftFullDescription" rows="6">${escapeHtml(d.full_description)}</textarea>
        </div>
      </div>

      <div class="profile-grid" style="grid-template-columns:1fr 1fr; gap:10px; margin-top:10px;">
        <div class="filter-group">
          <label>Статблок (key: value)</label>
          <textarea id="bestiariDraftStatblock" rows="8" placeholder="ac: 15&#10;hp: 120 (16к10+32)&#10;speed: 30 фт, полёт 60 фт&#10;str: 18&#10;dex: 14&#10;con: 15&#10;int: 10&#10;wis: 12&#10;cha: 16">${escapeHtml(d.statblock_text)}</textarea>
        </div>
        <div class="filter-group">
          <label>Доп. механики / JSON</label>
          <textarea id="bestiariDraftMechanics" rows="8" placeholder='{"short_rules":["..."],"examples":["..."]}'>${escapeHtml(d.mechanics_text)}</textarea>
        </div>
      </div>

      <div class="trader-meta" style="margin-top:10px; gap:10px;">
        <label class="inline-checkbox"><input id="bestiariDraftPlayerVisible" type="checkbox" ${d.player_visible ? "checked" : ""}> Видно игроку</label>
        <label class="inline-checkbox"><input id="bestiariDraftGmOnly" type="checkbox" ${d.gm_only ? "checked" : ""}> GM-only</label>
      </div>
    </div>
  `;
}

function renderImportPanel() {
  if (!BESTIARI_STATE.importOpen) return "";
  return `
    <div class="cabinet-block" style="margin-bottom:12px; padding:14px;">
      <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <div>
          <h4 style="margin:0 0 4px 0;">Импорт базы знаний</h4>
          <div class="muted">Поддерживается массив записей или объект вида { entries: [...] }.</div>
        </div>
      </div>
      <div class="filter-group">
        <label>Вставь JSON</label>
        <textarea id="bestiariImportTextarea" rows="10" placeholder="{\"entries\":[...]}"></textarea>
      </div>
      <div class="modal-actions" style="margin-top:10px; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-success" type="button" id="bestiariApplyImportBtn">Применить JSON</button>
        <button class="btn" type="button" id="bestiariCloseImportBtn">Закрыть</button>
      </div>
    </div>
  `;
}

function renderEntryList(entries, selected) {
  if (!entries.length) {
    return `<div class="cabinet-block"><p>Ничего не найдено. Попробуй другой запрос или категорию.</p></div>`;
  }

  return `
    <div style="display:flex; flex-direction:column; gap:8px;">
      ${entries
        .map((entry) => {
          const active = entry.id === selected?.id ? "active" : "";
          const tags = (entry.tags || [])
            .slice(0, 3)
            .map((tag) => `<span class="quality-badge">${escapeHtml(tag)}</span>`)
            .join("");
          const summary = truncateText(entry.summary || entry.body?.[0] || "", 110);

          return `
            <button
              class="btn ${active}"
              type="button"
              data-bestiari-entry="${escapeHtml(entry.id)}"
              style="width:100%; justify-content:flex-start; text-align:left; padding:9px 10px; border-radius:10px; min-height:auto;"
            >
              <div style="display:flex; flex-direction:column; gap:5px; width:100%; min-width:0;">
                <div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start;">
                  <div style="font-weight:800; line-height:1.2;">${escapeHtml(entry.title)}</div>
                  <span class="meta-item" style="white-space:nowrap;">${escapeHtml(BESTIARI_CATEGORY_LABELS[entry.category] || entry.category)}</span>
                </div>
                ${entry.subtitle ? `<div class="muted" style="font-size:12px; line-height:1.25;">${escapeHtml(entry.subtitle)}</div>` : ""}
                ${summary ? `<div class="muted" style="font-size:12px; line-height:1.3;">${escapeHtml(summary)}</div>` : ""}
                ${tags ? `<div class="trader-meta" style="gap:6px;">${tags}</div>` : ""}
              </div>
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
      { label: "КБ", value: entry.statblock.ac || "—" },
      { label: "HP", value: entry.statblock.hp || "—" },
      { label: "Скорость", value: entry.statblock.speed || "—" },
      { label: "CR / уровень", value: entry.statblock.level_like || "—" }
    );
  }

  const merged = [...panels, ...extraPanels].filter((item) => item && item.value);
  if (!merged.length) return "";

  return `
    <div class="profile-grid" style="margin-top:10px; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:8px;">
      ${merged
        .slice(0, 8)
        .map((item) => `
          <div class="stat-box" style="min-height:auto; padding:10px;">
            <div class="muted" style="font-size:11px;">${escapeHtml(item.label)}</div>
            <div style="margin-top:4px; font-weight:700; font-size:13px; line-height:1.25;">${escapeHtml(item.value)}</div>
          </div>
        `)
        .join("")}
    </div>
  `;
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
    <div class="cabinet-block" style="margin-top:10px; padding:12px;">
      <h4 style="margin:0 0 8px 0;">Характеристики</h4>
      <div class="stats-grid" style="gap:8px; grid-template-columns:repeat(6,minmax(0,1fr));">
        ${labels.map(([key, label]) => {
          const score = statblock.abilities[key] ?? 10;
          return `
            <div class="stat-box" style="min-height:auto; padding:10px 8px;">
              <div style="font-size:11px;"><b>${label}</b></div>
              <div style="font-size:18px; margin-top:3px; font-weight:800;">${score}</div>
              <div class="muted" style="font-size:11px;">${getAbilityMod(score)}</div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderNamedList(title, items) {
  if (!items || !items.length) return "";
  return `
    <div class="cabinet-block" style="margin-top:10px; padding:12px;">
      <h4 style="margin:0 0 8px 0;">${escapeHtml(title)}</h4>
      <div class="lss-rich-block" style="padding:10px 12px;">
        ${items.map((item) => {
          if (typeof item === "string") {
            return `<div style="margin-bottom:6px; line-height:1.35;">• ${escapeHtml(item)}</div>`;
          }
          return `
            <div style="margin-bottom:8px; line-height:1.35;">
              <div style="font-weight:700; margin-bottom:3px;">${escapeHtml(item.name || "Элемент")}</div>
              <div>${escapeHtml(item.text || "")}</div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderStatblock(entry) {
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

  return `
    <div class="cabinet-block" style="margin-top:10px; padding:12px;">
      <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap;">
        <div>
          <h4 style="margin:0 0 4px 0;">Статблок</h4>
          <div class="muted">Краткая боевая сводка и разворот по кнопке.</div>
        </div>
        <div class="cart-buttons">
          <button class="btn" type="button" id="bestiariToggleStatsBtn">${expanded ? "Скрыть детали" : "Полные статы"}</button>
        </div>
      </div>

      ${baseMeta.length ? `<div class="trader-meta" style="margin-top:8px; gap:6px;">${baseMeta.map((item) => `<span class="meta-item">${escapeHtml(item)}</span>`).join("")}</div>` : ""}
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
        ${renderNamedList("Действия логова", sb.lair_actions || [])}
      ` : ""}
    </div>
  `;
}

function renderMechanics(entry) {
  if (!entry.mechanics) return "";
  const shortRules = Array.isArray(entry.mechanics.short_rules) ? entry.mechanics.short_rules : [];
  const examples = Array.isArray(entry.mechanics.examples) ? entry.mechanics.examples : [];

  return `
    <div class="cabinet-block" style="margin-top:10px; padding:12px;">
      <h4 style="margin:0 0 8px 0;">Механика</h4>
      ${shortRules.length ? `<div class="lss-rich-block" style="padding:10px 12px;">${shortRules.map((item) => `<div style="margin-bottom:6px; line-height:1.35;">• ${escapeHtml(item)}</div>`).join("")}</div>` : ""}
      ${examples.length ? `<div class="lss-rich-block" style="margin-top:8px; padding:10px 12px;"><div style="font-weight:700; margin-bottom:6px;">Примеры</div>${examples.map((item) => `<div style="margin-bottom:6px; line-height:1.35;">• ${escapeHtml(item)}</div>`).join("")}</div>` : ""}
    </div>
  `;
}

function renderFullDescription(entry) {
  const mainBody = entry.body || [];
  const fullBody = entry.full_description || [];
  const hasLong = fullBody.length > 0 || mainBody.length > 1;
  const expanded = BESTIARI_STATE.showFullDescription;
  const textToRender = expanded
    ? [...mainBody, ...fullBody]
    : mainBody.length
      ? [mainBody[0]]
      : fullBody.length
        ? [fullBody[0]]
        : [];

  const textHtml = textToRender.length
    ? textToRender
        .map((paragraph) => `<div class="lss-rich-block" style="margin-top:8px; padding:10px 12px;"><p>${escapeHtml(paragraph)}</p></div>`)
        .join("")
    : `<div class="lss-rich-block" style="margin-top:8px; padding:10px 12px;"><p>Описание пока не заполнено.</p></div>`;

  return `
    <div class="cabinet-block" style="margin-top:10px; padding:12px;">
      <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap;">
        <div>
          <h4 style="margin:0 0 4px 0;">Описание</h4>
          <div class="muted">Краткая подача по умолчанию, полный текст по кнопке.</div>
        </div>
        ${hasLong ? `<div class="cart-buttons"><button class="btn" type="button" id="bestiariToggleDescriptionBtn">${expanded ? "Свернуть" : "Развернуть"}</button></div>` : ""}
      </div>
      ${textHtml}
    </div>
  `;
}

function renderSpellSection(entry) {
  const data = entry.spell_data;
  if (!data) return "";

  return `
    <div class="cabinet-block" style="margin-top:10px; padding:12px;">
      <h4 style="margin:0 0 8px 0;">Параметры заклинания</h4>
      <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px;">
        <div><b>Время:</b> ${escapeHtml(data.casting_time || "—")}</div>
        <div><b>Дистанция:</b> ${escapeHtml(data.range || "—")}</div>
        <div><b>Компоненты:</b> ${escapeHtml(data.components || "—")}</div>
        <div><b>Длительность:</b> ${escapeHtml(data.duration || "—")}</div>
        <div><b>Концентрация:</b> ${escapeHtml(data.concentration ? "Да" : "Нет")}</div>
        <div><b>Ритуал:</b> ${escapeHtml(data.ritual ? "Да" : "Нет")}</div>
        <div><b>Урон / эффект:</b> ${escapeHtml(data.damage || "—")}</div>
        <div><b>Спасбросок:</b> ${escapeHtml(data.save || "—")}</div>
      </div>
      ${(data.classes || []).length ? `<div class="trader-meta" style="margin-top:8px; gap:6px;">${data.classes.map((c) => `<span class="meta-item">${escapeHtml(c)}</span>`).join("")}</div>` : ""}
      ${data.higher_levels ? `<div class="lss-rich-block" style="margin-top:8px; padding:10px 12px;"><p>${escapeHtml(data.higher_levels)}</p></div>` : ""}
    </div>
  `;
}

function renderItemSection(entry) {
  const data = entry.item_data;
  if (!data) return "";
  return `
    <div class="cabinet-block" style="margin-top:10px; padding:12px;">
      <h4 style="margin:0 0 8px 0;">Параметры предмета</h4>
      <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px;">
        <div><b>Тип:</b> ${escapeHtml(data.type || "—")}</div>
        <div><b>Редкость:</b> ${escapeHtml(data.rarity || "—")}</div>
        <div><b>Слот:</b> ${escapeHtml(data.slot || "—")}</div>
        <div><b>Настройка:</b> ${escapeHtml(data.attunement || "—")}</div>
        <div><b>Вес (lb):</b> ${escapeHtml(data.weight_lb || "—")}</div>
        <div><b>Стоимость:</b> ${escapeHtml(data.value_gp || "—")}</div>
      </div>
      ${(data.properties || []).length ? `<div class="lss-rich-block" style="margin-top:8px; padding:10px 12px;">${data.properties.map((item) => `<div style="margin-bottom:6px; line-height:1.35;">• ${escapeHtml(item)}</div>`).join("")}</div>` : ""}
    </div>
  `;
}

function renderClassSection(entry) {
  const data = entry.class_data;
  if (!data) return "";
  return `
    <div class="cabinet-block" style="margin-top:10px; padding:12px;">
      <h4 style="margin:0 0 8px 0;">Параметры класса</h4>
      <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px;">
        <div><b>Кость хитов:</b> ${escapeHtml(data.hit_die || "—")}</div>
        <div><b>Осн. характеристика:</b> ${escapeHtml(data.primary_ability || "—")}</div>
      </div>
      ${(data.proficiencies || []).length ? `<div class="lss-rich-block" style="margin-top:8px; padding:10px 12px;"><div style="font-weight:700; margin-bottom:6px;">Владения</div>${data.proficiencies.map((item) => `<div style="margin-bottom:6px; line-height:1.35;">• ${escapeHtml(item)}</div>`).join("")}</div>` : ""}
      ${(data.core_features || []).length ? `<div class="lss-rich-block" style="margin-top:8px; padding:10px 12px;"><div style="font-weight:700; margin-bottom:6px;">Ключевые черты</div>${data.core_features.map((item) => `<div style="margin-bottom:6px; line-height:1.35;">• ${escapeHtml(item)}</div>`).join("")}</div>` : ""}
    </div>
  `;
}

function renderRelated(entry) {
  if (!entry.related?.length) return "";
  return `
    <div class="cabinet-block" style="margin-top:10px; padding:12px;">
      <h4 style="margin:0 0 8px 0;">Связанные сущности</h4>
      <div class="trader-meta" style="gap:6px;">
        ${entry.related.map((rel) => `<span class="meta-item">${escapeHtml(rel)}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderEntryDetail(entry) {
  if (!entry) {
    return `<div class="cabinet-block"><p>Выбери запись слева, чтобы открыть её карточку.</p></div>`;
  }

  return `
    <div class="cabinet-block" style="padding:14px;">
      <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap;">
        <div style="min-width:0;">
          <h3 style="margin:0 0 4px 0; line-height:1.15;">${escapeHtml(entry.title)}</h3>
          ${entry.subtitle ? `<div class="muted" style="font-size:13px;">${escapeHtml(entry.subtitle)}</div>` : ""}
        </div>
        <div class="cart-buttons">
          <button class="btn" type="button" id="bestiariEditEntryBtn">Редактировать</button>
          <button class="btn btn-danger" type="button" id="bestiariDeleteEntryBtn">Удалить</button>
        </div>
      </div>

      <div class="trader-meta" style="margin-top:8px; gap:6px;">
        <span class="meta-item">${escapeHtml(BESTIARI_CATEGORY_LABELS[entry.category] || entry.category)}</span>
        ${entry.source ? `<span class="meta-item">Источник: ${escapeHtml(entry.source)}</span>` : ""}
        ${entry.gm_only ? `<span class="meta-item">GM-only</span>` : ""}
        ${entry.player_visible === false ? `<span class="meta-item">Скрыто от игрока</span>` : ""}
      </div>

      ${(entry.tags || []).length ? `<div class="trader-meta" style="margin-top:8px; gap:6px;">${entry.tags.map((tag) => `<span class="quality-badge">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      ${entry.summary ? `<div class="lss-rich-block" style="margin-top:8px; padding:10px 12px;"><p>${escapeHtml(entry.summary)}</p></div>` : ""}

      ${renderInfoPanels(entry)}
      ${renderStatblock(entry)}
      ${renderSpellSection(entry)}
      ${renderItemSection(entry)}
      ${renderClassSection(entry)}
      ${renderMechanics(entry)}
      ${renderFullDescription(entry)}
      ${renderRelated(entry)}
    </div>
  `;
}

function bindActions() {
  const searchInput = getEl("bestiariSearchInput");
  if (searchInput && searchInput.dataset.boundBestiariSearch !== "1") {
    searchInput.dataset.boundBestiariSearch = "1";
    searchInput.addEventListener("input", () => {
      BESTIARI_STATE.query = searchInput.value || "";
      renderCodex();
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
      renderCodex();
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
      renderCodex();
    });
  }

  const toggleStatsBtn = getEl("bestiariToggleStatsBtn");
  if (toggleStatsBtn && toggleStatsBtn.dataset.boundBestiariToggleStats !== "1") {
    toggleStatsBtn.dataset.boundBestiariToggleStats = "1";
    toggleStatsBtn.addEventListener("click", () => {
      BESTIARI_STATE.showFullStats = !BESTIARI_STATE.showFullStats;
      renderCodex();
    });
  }
}

export async function loadCodex() {
  BESTIARI_STATE.role = getCurrentRole();

  const apiData = await apiGet([
    "/bestiari",
    "/codex",
    "/api/bestiari",
    "/api/codex",
  ]);

  if (Array.isArray(apiData?.entries)) {
    BESTIARI_STATE.entries = apiData.entries.map(normalizeEntry);
    BESTIARI_STATE.source = "api";
  } else if (Array.isArray(apiData)) {
    BESTIARI_STATE.entries = apiData.map(normalizeEntry);
    BESTIARI_STATE.source = "api";
  } else {
    const localEntries = loadLocalEntries();
    if (Array.isArray(localEntries) && localEntries.length) {
      BESTIARI_STATE.entries = localEntries.map(normalizeEntry);
      BESTIARI_STATE.source = "local";
    } else {
      BESTIARI_STATE.entries = BESTIARI_DEFAULT_ENTRIES.map(normalizeEntry);
      BESTIARI_STATE.source = "seed";
      saveLocalEntries();
    }
  }

  BESTIARI_STATE.loaded = true;
  BESTIARI_STATE.selectedId = BESTIARI_STATE.selectedId || BESTIARI_STATE.entries[0]?.id || "";
  return BESTIARI_STATE;
}

export function renderCodex() {
  const container = getEl("cabinet-bestiari") || getEl("cabinet-codex");
  if (!container) return;

  const entries = getVisibleEntries();
  const selected = getSelectedEntry(entries);
  if (selected) BESTIARI_STATE.selectedId = selected.id;

  const visibleCount = entries.length;
  const totalCount = Array.isArray(BESTIARI_STATE.entries) ? BESTIARI_STATE.entries.length : 0;

  container.innerHTML = `
    <div class="cabinet-block" style="margin-bottom:12px; padding:14px;">
      <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap;">
        <div>
          <h3 style="margin:0 0 4px 0;">📚 Энциклопедия</h3>
          <div class="muted">Компактный справочник по монстрам, лору, механикам, предметам и заклинаниям.</div>
        </div>
        <div class="cart-buttons">
          <button class="btn btn-primary" type="button" id="bestiariNewEntryBtn">＋ Запись</button>
          <button class="btn" type="button" id="bestiariImportBtn">Импорт</button>
          <button class="btn" type="button" id="bestiariExportBtn">Экспорт</button>
        </div>
      </div>

      <div class="collection-toolbar compact-collection-toolbar" style="gap:10px; align-items:flex-end; margin:12px 0 0 0;">
        <div class="filter-group" style="min-width:240px; flex:1 1 240px;">
          <label>Поиск по справочнику</label>
          <input id="bestiariSearchInput" type="text" value="${escapeHtml(BESTIARI_STATE.query)}" placeholder="Монстр, бог, предмет, механика...">
        </div>
        <div class="cart-buttons" style="align-items:flex-end; gap:6px; flex-wrap:wrap;">
          ${renderCategoryButtons(entries)}
        </div>
      </div>

      <div class="trader-meta" style="margin-top:10px; gap:6px;">
        <span class="meta-item">Показано: ${visibleCount}</span>
        <span class="meta-item">Всего: ${totalCount}</span>
        <span class="meta-item">Источник: ${escapeHtml(BESTIARI_STATE.source)}</span>
        <span class="meta-item">Роль: ${escapeHtml(BESTIARI_STATE.role)}</span>
      </div>
    </div>

    ${renderImportPanel()}
    ${renderEditorPanel()}

    <div class="profile-grid" style="align-items:start; grid-template-columns:minmax(260px, 0.82fr) minmax(0, 1.38fr); gap:12px;">
      <div class="cabinet-block" style="padding:10px; display:flex; flex-direction:column; gap:8px; max-height:72vh; overflow:auto;">
        ${renderEntryList(entries, selected)}
      </div>
      <div>
        ${renderEntryDetail(selected)}
      </div>
    </div>
  `;

  bindActions();
}

export function getCodexState() {
  return BESTIARI_STATE;
}
