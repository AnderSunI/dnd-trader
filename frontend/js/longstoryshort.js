// ============================================================
// frontend/js/longstoryshort.js
// Long Story Short (LSS)
// Round 20: original LSS spell bridge + parsed spell catalog.
// External spell ObjectIds are preserved, readable names are restored from the sheet,
// and our parsed spell datasets can be searched/added directly to the character.
// Raw Mongo-like IDs are never shown as spell names.
// - просмотр персонажа
// - импорт JSON / файла
// - локальное сохранение
// - базовое редактирование полей
// - явная загрузка фото: ссылка + локальный файл
// - история отделена и больше не смешивается с LSS
// ============================================================

import {
  apiPost,
  fetchAccount,
  updateAccount,
} from "./api.js";

// ------------------------------------------------------------
// 🌐 STATE
// ------------------------------------------------------------
const LSS_STATE = {
  raw: null,
  profile: null,
  source: "empty",
  characterPool: [],
  selectedCharacterId: "",
  importPanelOpen: false,
  editPanelOpen: false,
  activeTab: "overview",
  constructorMode: "quick",
  dicePanelOpen: false,
  diceType: "d20",
  lastRoll: null,
  constructorRules: null,
  constructorRulesStatus: "fallback",
  constructorRulesSource: "встроенный fallback",
  constructorRulesLoadedAt: null,
  constructorFeats: [],
  constructorFeatsStatus: "fallback",
  constructorFeatsSource: "не загружено",
  parsedSpellCatalog: [],
  parsedSpellCatalogStatus: "idle",
  parsedSpellCatalogSource: "",
  parsedSpellCatalogLoadedAt: null,
  spellCatalogQuery: "",
  spellCatalogLimit: 36,
  quickAppliedAbilityBonusKey: "",
  externalSpellBridge: {
    status: "idle",
    source: "",
    externalCount: 0,
    resolvedCount: 0,
    hintCount: 0,
    unresolvedIds: [],
  },
};

// ------------------------------------------------------------
// 🧰 HELPERS
// ------------------------------------------------------------
function getToken() {
  return localStorage.getItem("token") || "";
}

function getHeaders() {
  const token = getToken();
  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function getSection(id) {
  return document.getElementById(id);
}

function safe(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return value;
}

function safeText(value, fallback = "") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function safeParseJsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumber(value, min = null, max = null, fallback = 0) {
  let n = toNumber(value, fallback);
  if (min !== null && min !== undefined) n = Math.max(Number(min), n);
  if (max !== null && max !== undefined) n = Math.min(Number(max), n);
  return n;
}

function sanitizePlainText(value, options = {}) {
  const max = options.max ?? 80;
  const allowNumbers = options.allowNumbers !== false;
  const allowPunctuation = options.allowPunctuation !== false;
  let text = String(value ?? "")
    .replace(/[<>`{}\[\]\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!allowNumbers) text = text.replace(/[0-9]/g, "");
  if (!allowPunctuation) text = text.replace(/[!?@#$%^&*_+=|~;:,.\/]/g, "");
  return text.slice(0, max);
}

function sanitizeNumericText(value, options = {}) {
  const min = options.min ?? null;
  const max = options.max ?? null;
  const fallback = options.fallback ?? 0;
  const integer = options.integer !== false;
  let raw = String(value ?? "").replace(/[^0-9+\-.]/g, "");
  if (integer) raw = raw.replace(/(?!^)[+\-]/g, "").replace(/\..*$/, "");
  const n = clampNumber(raw, min, max, fallback);
  return integer ? String(Math.trunc(n)) : String(n);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  if (typeof window.showToast === "function") {
    window.showToast(message);
    return;
  }
  console.log(message);
}


const LSS_CONSTRUCTOR_RULES_URLS = [
  "static/data/lss_constructor_rules.json",
  "/static/data/lss_constructor_rules.json",
  "frontend/static/data/lss_constructor_rules.json",
];

const LSS_FEATS_URLS = [
  "static/data/feats_bestiari_preview.json",
  "/static/data/feats_bestiari_preview.json",
  "frontend/static/data/feats_bestiari_preview.json",
];

// Our parsed spell sources. The first existing/valid file wins.
// spells_bestiari_preview.json is the source already used by the rules builder;
// spells.master.json is supported for the later canonical pipeline.
const LSS_PARSED_SPELL_URLS = [
  "static/data/spells.master.json",
  "/static/data/spells.master.json",
  "frontend/static/data/spells.master.json",
  "static/data/spells_bestiari_preview.json",
  "/static/data/spells_bestiari_preview.json",
  "frontend/static/data/spells_bestiari_preview.json",
  "static/data/spells_master.json",
  "/static/data/spells_master.json",
  "frontend/static/data/spells_master.json",
];

let LSS_CONSTRUCTOR_RULES_LOAD_PROMISE = null;
let LSS_FEATS_LOAD_PROMISE = null;
let LSS_PARSED_SPELL_LOAD_PROMISE = null;
let LSS_SPELL_INDEX_CACHE = null;
let LSS_SPELL_SEARCH_TIMER = null;

function validateLssConstructorRules(data) {
  return Boolean(
    data &&
    typeof data === "object" &&
    data.classes &&
    typeof data.classes === "object" &&
    data.races &&
    typeof data.races === "object" &&
    data.backgrounds &&
    typeof data.backgrounds === "object"
  );
}

async function loadLssConstructorRules() {
  if (LSS_CONSTRUCTOR_RULES_LOAD_PROMISE) return LSS_CONSTRUCTOR_RULES_LOAD_PROMISE;

  LSS_CONSTRUCTOR_RULES_LOAD_PROMISE = (async () => {
    LSS_STATE.constructorRulesStatus = "loading";

    for (const url of LSS_CONSTRUCTOR_RULES_URLS) {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) continue;
        const data = await response.json();
        if (!validateLssConstructorRules(data)) continue;

        LSS_STATE.constructorRules = data;
        LSS_STATE.constructorRulesStatus = "loaded";
        LSS_STATE.constructorRulesSource = url;
        LSS_STATE.constructorRulesLoadedAt = new Date().toISOString();
        return data;
      } catch (err) {
        // LSS не должен падать, если rules-json ещё не собран или лежит по другому пути.
      }
    }

    LSS_STATE.constructorRules = null;
    LSS_STATE.constructorRulesStatus = "fallback";
    LSS_STATE.constructorRulesSource = "встроенный fallback";
    LSS_STATE.constructorRulesLoadedAt = null;
    return null;
  })();

  return LSS_CONSTRUCTOR_RULES_LOAD_PROMISE;
}

async function ensureLssConstructorRulesLoaded() {
  return loadLssConstructorRules();
}



function looksLikeParsedSpell(entry) {
  if (!entry || typeof entry !== "object") return false;
  const data = entry.spell_data && typeof entry.spell_data === "object" ? entry.spell_data : entry;
  const name = data.ru_name || data.name || data.title || entry.title || data.en_name;
  return Boolean(name && (data.level !== undefined || data.school || data.casting_time || data.classes || entry.mechanics));
}

function flattenParsedSpellPayload(payload) {
  const candidates = [
    payload?.spells,
    payload?.entries,
    payload?.items,
    payload?.results,
    payload?.data?.spells,
    payload?.data?.entries,
    payload?.data?.items,
    payload?.data,
    payload,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) {
      const list = candidate.filter(looksLikeParsedSpell);
      if (list.length) return list;
    }
    if (typeof candidate === "object") {
      const list = Object.entries(candidate)
        .map(([key, value]) => value && typeof value === "object" ? { __catalogKey: key, ...value } : null)
        .filter(looksLikeParsedSpell);
      if (list.length) return list;
    }
  }
  return [];
}

function normalizeParsedSpellSourceEntry(entry = {}, index = 0) {
  const data = entry.spell_data && typeof entry.spell_data === "object" ? entry.spell_data : entry;
  const mechanics = entry.mechanics && typeof entry.mechanics === "object" ? entry.mechanics : {};
  const components = data.components && typeof data.components === "object" ? data.components : {};
  const id = String(data.id || entry.id || entry._id || entry.__catalogKey || `parsed-spell-${index}`).trim();
  const name = safeText(data.ru_name || data.name || entry.title || data.title || data.label || data.en_name, "").trim();
  if (!name) return null;
  return {
    ...entry,
    ...data,
    id,
    ru_name: name,
    en_name: safeText(data.en_name || entry.en_name || entry.enName, ""),
    level: data.level ?? data.circle ?? data.spell_level ?? 0,
    school: data.school || data.school_ru || "",
    casting_time: data.casting_time || data.castingTime || data.time || "",
    range: data.range || data.distance || "",
    duration: data.duration || "",
    components_display: data.components_display || components.display || "",
    components,
    concentration: Boolean(data.concentration),
    ritual: Boolean(data.ritual),
    classes: normalizeArray(data.classes || mechanics.classes || []),
    subclasses: normalizeArray(data.subclasses || mechanics.subclasses || []),
    damage_types: normalizeArray(mechanics.damage_types || data.damage_types || []),
    conditions: normalizeArray(mechanics.conditions || data.conditions || []),
    saving_throws: normalizeArray(mechanics.saving_throws || data.saving_throws || []),
    summary: safeText(entry.summary || mechanics.short_rules || data.summary || data.description, ""),
    source: data.source || entry.source || "parsed-spells",
    source_url: entry.source_url || data.source_url || "",
    source_kind: "parsed-spell-catalog",
  };
}

async function loadLssParsedSpellCatalog() {
  if (LSS_PARSED_SPELL_LOAD_PROMISE) return LSS_PARSED_SPELL_LOAD_PROMISE;
  LSS_PARSED_SPELL_LOAD_PROMISE = (async () => {
    LSS_STATE.parsedSpellCatalogStatus = "loading";
    for (const url of LSS_PARSED_SPELL_URLS) {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) continue;
        const payload = await response.json();
        const entries = flattenParsedSpellPayload(payload)
          .map(normalizeParsedSpellSourceEntry)
          .filter(Boolean);
        if (!entries.length) continue;
        LSS_STATE.parsedSpellCatalog = entries;
        LSS_STATE.parsedSpellCatalogStatus = "loaded";
        LSS_STATE.parsedSpellCatalogSource = url;
        LSS_STATE.parsedSpellCatalogLoadedAt = new Date().toISOString();
        LSS_SPELL_INDEX_CACHE = null;
        return entries;
      } catch (_) {
        // Try the next known path. LSS remains usable without the optional full catalog.
      }
    }
    // Compact rules still contain our parsed spell subset, so this is a grounded fallback.
    const rulesEntries = asSpellCatalogEntries(LSS_STATE.constructorRules?.spells)
      .map(normalizeParsedSpellSourceEntry)
      .filter(Boolean);
    LSS_STATE.parsedSpellCatalog = rulesEntries;
    LSS_STATE.parsedSpellCatalogStatus = rulesEntries.length ? "rules-fallback" : "missing";
    LSS_STATE.parsedSpellCatalogSource = rulesEntries.length ? (LSS_STATE.constructorRulesSource || "lss_constructor_rules.json") : "каталог не найден";
    LSS_STATE.parsedSpellCatalogLoadedAt = rulesEntries.length ? new Date().toISOString() : null;
    LSS_SPELL_INDEX_CACHE = null;
    return rulesEntries;
  })();
  return LSS_PARSED_SPELL_LOAD_PROMISE;
}

async function ensureLssParsedSpellCatalogLoaded() {
  return loadLssParsedSpellCatalog();
}

// ------------------------------------------------------------
// 🔗 ORIGINAL LSS SPELL-ID BRIDGE
// ------------------------------------------------------------
// Original Long Story Short exports may keep only Mongo-like spell IDs in the
// outer `spells.prepared/book` block. The exported character body contains slots,
// but often no expanded cards. We resolve only against grounded local data:
// 1) direct/legacy IDs from lss_constructor_rules.json;
// 2) an optional user map in localStorage;
// 3) exact spell-name hints preserved in rich-text blocks.
// Unknown IDs stay in bridge diagnostics and are not rendered as fake names.
const LSS_EXTERNAL_SPELL_MAP_STORAGE_KEY = "dnd_trader_lss_external_spell_map";

function normalizeLssSpellLookup(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»„“”\"'`]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isOriginalLssSpellObjectId(value) {
  return /^[a-f\d]{24}$/i.test(String(value || "").trim());
}

function asSpellCatalogEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return Object.values(value).filter((item) => item && typeof item === "object");
  return [];
}

function collectLssSpellAliasIds(spell = {}) {
  const out = [];
  const push = (value) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (typeof value === "object") {
      [value.id, value._id, value.value, value.key, value.external_id, value.lss_id].forEach(push);
      return;
    }
    const text = String(value).trim();
    if (text && !out.includes(text)) out.push(text);
  };
  [
    spell.id,
    spell._id,
    spell.spell_id,
    spell.external_id,
    spell.externalId,
    spell.lss_id,
    spell.lssId,
    spell.mongo_id,
    spell.mongoId,
    spell.legacy_id,
    spell.legacyId,
    spell.legacy_ids,
    spell.legacyIds,
    spell.external_ids,
    spell.externalIds,
    spell.alias_ids,
    spell.aliasIds,
    spell.aliases,
    spell.source_ids,
    spell.sourceIds,
  ].forEach(push);
  return out;
}

function getLssSpellCatalogIndexes() {
  const rules = LSS_STATE.constructorRules;
  const parsed = Array.isArray(LSS_STATE.parsedSpellCatalog) ? LSS_STATE.parsedSpellCatalog : [];
  if (LSS_SPELL_INDEX_CACHE?.rules === rules && LSS_SPELL_INDEX_CACHE?.parsed === parsed) return LSS_SPELL_INDEX_CACHE;

  const rulesEntries = asSpellCatalogEntries(rules?.spells).map(normalizeParsedSpellSourceEntry).filter(Boolean);
  const entries = [];
  const dedupe = new Map();
  [...rulesEntries, ...parsed].forEach((spell) => {
    const key = String(spell.id || normalizeLssSpellLookup(spell.ru_name || spell.name || spell.en_name));
    if (!key) return;
    const previous = dedupe.get(key);
    // Prefer the richer parsed master/preview entry over the compact rules copy.
    dedupe.set(key, previous ? { ...previous, ...spell } : spell);
  });
  entries.push(...dedupe.values());

  const byId = new Map();
  const byName = new Map();
  entries.forEach((spell) => {
    collectLssSpellAliasIds(spell).forEach((id) => byId.set(String(id), spell));
    [spell.ru_name, spell.name, spell.title, spell.label, spell.en_name, spell.enName]
      .map(normalizeLssSpellLookup)
      .filter(Boolean)
      .forEach((name) => byName.set(name, spell));
  });

  const sources = [
    parsed.length ? LSS_STATE.parsedSpellCatalogSource : "",
    rulesEntries.length ? (LSS_STATE.constructorRulesSource || "lss_constructor_rules.json") : "",
  ].filter(Boolean);
  LSS_SPELL_INDEX_CACHE = {
    rules,
    parsed,
    entries,
    byId,
    byName,
    source: sources.join(" + ") || "каталог заклинаний не загружен",
  };
  return LSS_SPELL_INDEX_CACHE;
}

function findCatalogSpellByHint(indexes, hint) {
  const lookup = normalizeLssSpellLookup(hint?.lookup || hint?.name || hint);
  if (!lookup) return null;
  const exact = indexes.byName.get(lookup);
  if (exact) return exact;
  const candidates = indexes.entries.filter((spell) => {
    const names = [spell.ru_name, spell.name, spell.title, spell.en_name].map(normalizeLssSpellLookup).filter(Boolean);
    return names.some((name) => name === lookup || (lookup.length >= 5 && (name.startsWith(lookup) || lookup.startsWith(name))));
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function readExternalLssSpellMap(profile = {}) {
  const result = {};
  const merge = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    Object.entries(value).forEach(([externalId, target]) => {
      const key = String(externalId || "").trim();
      if (key && target !== null && target !== undefined && target !== "") result[key] = target;
    });
  };
  merge(profile?.spellsMeta?.externalResolved);
  merge(profile?.spellsMeta?.external_resolved);
  merge(profile?.externalSpellMap);
  merge(profile?.__lssRoot?.spells?.externalResolved);
  try {
    const stored = JSON.parse(localStorage.getItem(LSS_EXTERNAL_SPELL_MAP_STORAGE_KEY) || "{}");
    merge(stored);
  } catch (_) {}
  return result;
}

function getRichTextPlainLines(node, options = {}) {
  const onlyMarked = options.onlyMarked || "";
  const lines = [];
  const walk = (value, current = []) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, current));
      return;
    }
    if (typeof value !== "object") return;
    const marks = Array.isArray(value.marks) ? value.marks.map((mark) => String(mark?.type || "")) : [];
    if (value.type === "text" && value.text) {
      if (!onlyMarked || marks.includes(onlyMarked)) current.push(String(value.text));
    }
    if (Array.isArray(value.content)) {
      const local = [];
      value.content.forEach((item) => walk(item, local));
      const text = local.join("").replace(/\s+/g, " ").trim();
      if (text && ["paragraph", "listItem", "heading"].includes(String(value.type || ""))) lines.push(text);
      if (text && !["paragraph", "listItem", "heading"].includes(String(value.type || ""))) current.push(text);
    }
  };
  walk(node, []);
  return Array.from(new Set(lines.map((line) => line.trim()).filter(Boolean)));
}

function getRichTextMarkedTexts(node, markType = "italic") {
  const out = [];
  const walk = (value) => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value !== "object") return;
    const marks = Array.isArray(value.marks) ? value.marks.map((mark) => String(mark?.type || "")) : [];
    if (value.type === "text" && value.text && marks.includes(markType)) {
      const text = String(value.text).replace(/\s+/g, " ").trim();
      if (text && !out.includes(text)) out.push(text);
    }
    if (Array.isArray(value.content)) value.content.forEach(walk);
  };
  walk(node);
  return out;
}

function getOriginalLssSpellNameHints(profile = {}) {
  const textBlocks = profile?.text && typeof profile.text === "object" ? profile.text : {};
  const hints = [];
  const push = (name, level = null, source = "text") => {
    const cleaned = String(name || "")
      .replace(/^[-–—•\s]+/, "")
      .replace(/\s+[-–—:].*$/, "")
      .replace(/\s+/g, " ")
      .trim();
    const lookup = normalizeLssSpellLookup(cleaned);
    if (!lookup || cleaned.length < 2 || cleaned.length > 90) return;
    // In prose blocks a lowercase italic fragment is usually a reference
    // (for example “огненного шара”), not another spell owned by the character.
    if (source === "text.attacks" && /^[а-яёa-z]/.test(cleaned)) return;
    if (!hints.some((item) => item.lookup === lookup)) hints.push({ name: cleaned, lookup, level, source });
  };

  Object.entries(textBlocks).forEach(([key, block]) => {
    const match = String(key).match(/^spells-level-(\d+)$/i);
    if (!match) return;
    const level = Number(match[1]);
    const doc = block?.value?.data || block?.data || block;
    getRichTextPlainLines(doc).forEach((line) => push(line, level, key));
  });

  // Old/original sheets often kept a readable personal spell list in the
  // "attacks" text block even when card mode exported only ObjectIds.
  const attacksDoc = textBlocks?.attacks?.value?.data || textBlocks?.attacks?.data || textBlocks?.attacks;
  getRichTextMarkedTexts(attacksDoc, "italic").forEach((line) => push(line, null, "text.attacks"));

  return hints.slice(0, 48);
}

function normalizeCatalogSpellForLss(spell = {}, options = {}) {
  const externalId = String(options.externalId || spell.external_id || spell.id || spell._id || "").trim();
  const level = Math.max(0, toNumber(options.level ?? spell.level ?? spell.circle ?? spell.spell_level, 0));
  const name = safeText(spell.ru_name || spell.name || spell.title || spell.label || spell.en_name, "Заклинание");
  const damageTypes = Array.isArray(spell.damage_types) ? spell.damage_types.join(", ") : safeText(spell.damage_type, "");
  return {
    id: externalId || String(spell.id || spell._id || `spell-${normalizeLssSpellLookup(name)}`),
    catalog_id: String(spell.id || spell._id || ""),
    external_id: options.externalId ? String(options.externalId) : "",
    name,
    ru_name: name,
    en_name: safeText(spell.en_name || spell.enName, ""),
    level,
    school: safeText(spell.school || spell.school_ru, ""),
    casting_time: safeText(spell.casting_time || spell.castingTime || spell.time, ""),
    time: safeText(spell.casting_time || spell.castingTime || spell.time, ""),
    range: safeText(spell.range || spell.distance, ""),
    duration: safeText(spell.duration, ""),
    components: safeText(spell.components_display || spell.components?.display || spell.components, ""),
    description: safeText(spell.description || spell.summary || spell.text || spell.short_rules, ""),
    summary: safeText(spell.summary || spell.description, ""),
    damage_type: damageTypes,
    concentration: Boolean(spell.concentration),
    ritual: Boolean(spell.ritual),
    prepared: Boolean(options.prepared),
    source_kind: options.sourceKind || "lss_catalog_bridge",
    bridge_confidence: options.confidence || "catalog",
  };
}

function collectOriginalSpellIdArray(profile, key) {
  const roots = [
    profile?.spellsMeta,
    profile?.__lssRoot?.spells,
    LSS_STATE.raw?.spells,
    profile?.externalSpells,
  ];
  const out = [];
  roots.forEach((root) => {
    const values = root && Array.isArray(root[key]) ? root[key] : [];
    values.forEach((value) => {
      const id = String(value || "").trim();
      if (id && !out.includes(id)) out.push(id);
    });
  });
  return out;
}

function hydrateOriginalLssSpellExport(profile) {
  if (!profile || typeof profile !== "object") return profile;
  const meta = profile.spellsMeta && typeof profile.spellsMeta === "object" ? profile.spellsMeta : {};
  const prepared = collectOriginalSpellIdArray(profile, "prepared");
  const book = collectOriginalSpellIdArray(profile, "book");
  const externalIds = Array.from(new Set([...prepared, ...book].filter(isOriginalLssSpellObjectId)));
  const indexes = getLssSpellCatalogIndexes();
  const manual = readExternalLssSpellMap(profile);
  const preparedSet = new Set(prepared);
  const hints = getOriginalLssSpellNameHints(profile);
  const cards = [];
  const unresolvedIds = [];
  const existingLists = [
    profile.spellCards,
    profile.spellsCards,
    meta.cards,
    meta.preparedExpanded,
    meta.bookExpanded,
    profile.preparedSpellsExpanded,
    profile.bookSpellsExpanded,
    profile.spellsExpanded,
    profile.spellbook,
    profile.spellsList,
  ];
  const addCard = (card) => {
    if (!card || typeof card !== "object") return;
    const normalized = card.name || card.ru_name || card.title || card.en_name
      ? normalizeCatalogSpellForLss(card, {
          externalId: card.external_id || "",
          prepared: Boolean(card.prepared),
          confidence: card.bridge_confidence || "existing-card",
          sourceKind: card.source_kind || "existing-card",
        })
      : null;
    if (!normalized?.name) return;
    const catalogKey = String(normalized.catalog_id || card.catalog_id || "");
    const externalKey = String(normalized.external_id || card.external_id || "");
    const nameKey = normalizeLssSpellLookup(normalized.name);
    const foundIndex = cards.findIndex((item) => {
      if (catalogKey && String(item.catalog_id || "") === catalogKey) return true;
      if (externalKey && String(item.external_id || "") === externalKey) return true;
      return normalizeLssSpellLookup(item.name) === nameKey;
    });
    if (foundIndex >= 0) cards[foundIndex] = { ...cards[foundIndex], ...normalized, prepared: cards[foundIndex].prepared || normalized.prepared };
    else cards.push(normalized);
  };

  existingLists.forEach((list) => {
    if (Array.isArray(list)) list.forEach(addCard);
  });

  externalIds.forEach((externalId) => {
    let spell = indexes.byId.get(externalId);
    let confidence = spell ? "legacy-id" : "";
    const mapped = manual[externalId];
    if (!spell && mapped !== undefined) {
      if (mapped && typeof mapped === "object") {
        spell = mapped;
        confidence = "manual-card";
      } else {
        const target = String(mapped || "").trim();
        spell = indexes.byId.get(target) || indexes.byName.get(normalizeLssSpellLookup(target));
        confidence = spell ? "manual-map" : "";
      }
    }
    if (spell) addCard(normalizeCatalogSpellForLss(spell, { externalId, prepared: preparedSet.has(externalId), confidence }));
    else unresolvedIds.push(externalId);
  });

  // Text hints are useful even after the old ObjectIds were already lost by a
  // previous local save. This is the key fallback for existing installations.
  const canOrderMap = unresolvedIds.length > 0 && hints.length === unresolvedIds.length;
  hints.forEach((hint, index) => {
    const catalogSpell = findCatalogSpellByHint(indexes, hint);
    const linkedExternalId = canOrderMap ? unresolvedIds[index] : "";
    if (catalogSpell) {
      addCard(normalizeCatalogSpellForLss(catalogSpell, {
        externalId: linkedExternalId,
        prepared: linkedExternalId ? preparedSet.has(linkedExternalId) : true,
        level: hint.level ?? catalogSpell.level,
        sourceKind: "lss_text_catalog_hint",
        confidence: linkedExternalId ? "ordered-text-hint" : "exact-name-hint",
      }));
    } else {
      addCard({
        id: linkedExternalId || `lss-text-${hint.lookup.replace(/\s+/g, "-")}`,
        external_id: linkedExternalId,
        name: hint.name,
        ru_name: hint.name,
        level: Math.max(0, toNumber(hint.level, 0)),
        prepared: linkedExternalId ? preparedSet.has(linkedExternalId) : true,
        source_kind: "lss_text_hint",
        bridge_confidence: linkedExternalId ? "ordered-text-hint" : "text-only",
        description: `Название сохранено в ${hint.source}; механическая карточка пока не сопоставлена с нашим каталогом.`,
      });
    }
  });

  const linkedIds = new Set(cards.map((card) => String(card.external_id || "")).filter(Boolean));
  const stillUnresolved = unresolvedIds.filter((id) => !linkedIds.has(id));
  const resolvedPrepared = cards.filter((card) => card.prepared || preparedSet.has(String(card.external_id || card.id)));
  const nextMeta = {
    ...meta,
    mode: meta.mode || profile?.__lssRoot?.spells?.mode || "cards",
    prepared,
    book,
    cards,
    preparedExpanded: resolvedPrepared,
    bookExpanded: cards,
    externalBridge: {
      source: indexes.source,
      external_count: externalIds.length,
      resolved_count: cards.length,
      hint_count: hints.length,
      unresolved_ids: stillUnresolved,
      catalog_count: indexes.entries.length,
      note: "ObjectId оригинального LSS не считается названием. Карточки берутся из нашего parsed-каталога или из читаемых подсказок листа.",
    },
  };
  profile.spellsMeta = nextMeta;
  profile.spellCards = cards;
  profile.spellsExpanded = cards;
  LSS_STATE.externalSpellBridge = {
    status: stillUnresolved.length ? (cards.length ? "partial" : "unresolved") : (cards.length ? "resolved" : "idle"),
    source: indexes.source,
    externalCount: externalIds.length,
    resolvedCount: cards.length,
    hintCount: hints.length,
    unresolvedIds: stillUnresolved,
  };
  return profile;
}

function validateLssFeatPayload(data) {
  return Boolean(data && typeof data === "object" && Array.isArray(data.entries));
}

function normalizeLssFeatEntry(entry = {}) {
  const mechanics = entry.mechanics || {};
  const featData = entry.feat_data || {};
  const abilityIncreases = Array.isArray(mechanics.ability_increases)
    ? mechanics.ability_increases
    : (Array.isArray(featData.ability_increases_round1) ? featData.ability_increases_round1 : []);
  const requirements = normalizeArray(mechanics.requirements?.length ? mechanics.requirements : featData.requirements);
  const shortRules = normalizeArray(mechanics.short_rules?.length ? mechanics.short_rules : entry.body).slice(0, 4);
  return {
    id: entry.id || featData.id || normalizeGuideLookup(entry.title || featData.ru_name || featData.en_name),
    label: entry.title || featData.ru_name || entry.name || "Черта",
    enName: featData.en_name || "",
    source: entry.source_url || entry.source || featData.source || "feats_bestiari_preview.json",
    sourceCode: featData.source_code || "",
    requirements,
    affects: normalizeArray(mechanics.affects?.length ? mechanics.affects : featData.affects_round1),
    abilityIncreases,
    shortRules,
    summary: entry.summary || shortRules[0] || "",
    raw: entry,
  };
}

function normalizeLssRulesFeatEntry(entry = {}) {
  const raw = entry || {};
  const shortRules = normalizeArray(raw.short_rules || raw.shortRules || raw.rules).slice(0, 5);
  return {
    id: raw.id || normalizeGuideLookup(raw.ru_name || raw.label || raw.name || raw.en_name),
    label: raw.ru_name || raw.label || raw.name || raw.title || raw.id || "Черта",
    enName: raw.en_name || raw.enName || "",
    source: raw.source_url || raw.source || "lss_constructor_rules.json",
    sourceCode: raw.source_code || raw.sourceCode || "",
    requirements: normalizeArray(raw.requirements),
    affects: normalizeArray(raw.affects),
    abilityIncreases: normalizeArray(raw.ability_increases || raw.abilityIncreases),
    shortRules,
    sourceGrants: normalizeArray(raw.source_grants || raw.sourceGrants),
    summary: raw.summary || shortRules[0] || "",
    raw,
  };
}

function getLssRulesFeatList() {
  const rules = getLssRules();
  const feats = rules?.feats;
  if (!feats || typeof feats !== "object") return [];
  const values = Array.isArray(feats) ? feats : Object.values(feats);
  return values.map(normalizeLssRulesFeatEntry).filter((feat) => feat.id && feat.label);
}

async function loadLssConstructorFeats() {
  if (LSS_FEATS_LOAD_PROMISE) return LSS_FEATS_LOAD_PROMISE;

  LSS_FEATS_LOAD_PROMISE = (async () => {
    LSS_STATE.constructorFeatsStatus = "loading";
    for (const url of LSS_FEATS_URLS) {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) continue;
        const data = await response.json();
        if (!validateLssFeatPayload(data)) continue;
        LSS_STATE.constructorFeats = data.entries.map(normalizeLssFeatEntry).filter((feat) => feat.id && feat.label);
        LSS_STATE.constructorFeatsStatus = "loaded";
        LSS_STATE.constructorFeatsSource = url;
        return LSS_STATE.constructorFeats;
      } catch (_) {
        // Черты — дополнительный слой. Если файл не найден, конструктор остаётся рабочим.
      }
    }
    LSS_STATE.constructorFeats = [];
    LSS_STATE.constructorFeatsStatus = "fallback";
    LSS_STATE.constructorFeatsSource = "не загружено";
    return [];
  })();

  return LSS_FEATS_LOAD_PROMISE;
}

async function ensureLssFeatRulesLoaded() {
  return loadLssConstructorFeats();
}

function getLssFeatList() {
  const rulesFeats = getLssRulesFeatList();
  if (rulesFeats.length) return rulesFeats;
  return Array.isArray(LSS_STATE.constructorFeats) ? LSS_STATE.constructorFeats : [];
}

function getLssFeatByValue(value) {
  const raw = normalizeGuideLookup(value);
  if (!raw) return null;
  return getLssFeatList().find((feat) => {
    return [feat.id, feat.label, feat.enName].some((candidate) => normalizeGuideLookup(candidate) === raw);
  }) || null;
}

function getLssFeatsStatusLabel() {
  const rulesFeats = getLssRulesFeatList();
  if (rulesFeats.length) return `черты: ${rulesFeats.length}`;
  if (LSS_STATE.constructorFeatsStatus === "loaded") return `черты: ${getLssFeatList().length}`;
  if (LSS_STATE.constructorFeatsStatus === "loading") return "черты: загрузка";
  return "черты: fallback";
}

function getLssRules() {
  return validateLssConstructorRules(LSS_STATE.constructorRules) ? LSS_STATE.constructorRules : null;
}

function getLssRulesStatusLabel() {
  if (LSS_STATE.constructorRulesStatus === "loaded") {
    const rules = getLssRules();
    const report = rules?.build_report || {};
    const classes = toNumber(report.classes, Object.keys(rules?.classes || {}).length);
    const races = toNumber(report.races, Object.keys(rules?.races || {}).length);
    const backgrounds = toNumber(report.backgrounds, Object.keys(rules?.backgrounds || {}).length);
    return `rules JSON: ${classes} кл. / ${races} рас / ${backgrounds} пред. / ${getLssFeatsStatusLabel()}`;
  }
  if (LSS_STATE.constructorRulesStatus === "loading") return "rules: загрузка";
  return "rules: fallback";
}

function getLssRulesMap(section) {
  const rules = getLssRules();
  const map = rules?.[section];
  return map && typeof map === "object" ? map : null;
}

function getLssRulesLookup(section) {
  const rules = getLssRules();
  const map = rules?.lookup?.[section];
  return map && typeof map === "object" ? map : null;
}

function sortLssGuideList(list) {
  return [...(list || [])].sort((a, b) => String(a.label || a.ru_name || a.name || "").localeCompare(String(b.label || b.ru_name || b.name || ""), "ru"));
}

function sourceFromRulesItem(item, fallback = "lss_constructor_rules.json") {
  return item?.source_url || item?.source || fallback;
}

function parseHitDieFaces(value, fallback = 8) {
  const raw = String(value ?? "").toLowerCase();
  const match = raw.match(/d?\s*(4|6|8|10|12)/);
  return match ? Number(match[1]) : clampNumber(value, 4, 12, fallback);
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && String(item).trim() !== "");
  if (typeof value === "string" && value.trim()) return value.split(/[,;]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function pickRulesObjectByValue(map, lookup, value, names = []) {
  const raw = normalizeGuideLookup(value);
  if (!raw || !map) return null;

  const lookupId = lookup?.[raw];
  if (lookupId && map[lookupId]) return map[lookupId];
  if (map[value]) return map[value];
  if (map[raw]) return map[raw];

  return Object.values(map).find((item) => {
    if (!item) return false;
    const candidates = [item.id, item.ru_name, item.en_name, item.name, item.label, ...names.map((name) => item?.[name])];
    return candidates.some((candidate) => normalizeGuideLookup(candidate) === raw);
  }) || null;
}

function rulesClassToGuide(item) {
  if (!item) return null;
  const prof = item.proficiencies || {};
  const spellcasting = item.spellcasting || {};
  const level1 = item.progression_by_level?.["1"]?.features || [];
  return {
    id: item.id || item.class_id || normalizeGuideLookup(item.ru_name || item.en_name || item.name),
    label: item.ru_name || item.name || item.en_name || item.id || "Класс",
    aliases: [item.id, item.en_name, item.ru_name].filter(Boolean),
    hitDie: item.hit_die_faces || parseHitDieFaces(item.hit_die, 8),
    saves: normalizeArray(item.saving_throws),
    primaryStats: normalizeArray(item.primary_abilities),
    armor: normalizeArray(prof.armor).join(", ") || "—",
    weapons: normalizeArray(prof.weapons).join(", ") || "—",
    tools: normalizeArray(prof.tools).join(", ") || "—",
    spellcasting: Boolean(spellcasting.has_spellcasting),
    spellAbility: spellcasting.ability || "",
    spellType: spellcasting.type || "заклинания",
    spellListId: spellcasting.spell_list_id || "",
    spellRefCount: toNumber(spellcasting.spell_ref_count, 0),
    role: item.role || prof.skills_text || "см. полное описание класса в Бестиарии",
    beginnerTip: item.beginner_tip || "LSS подтянул механику класса из rules JSON; полный текст класса открыт в Бестиарии.",
    level1,
    sourceGrants: normalizeArray(item.source_grants || item.grants || []),
    subclassChoiceLevel: toNumber(item.subclass_choice_level, null),
    subclasses: Array.isArray(item.subclasses) ? item.subclasses : [],
    progressionByLevel: item.progression_by_level || {},
    source: sourceFromRulesItem(item),
    sourceKind: "rules-json",
    raw: item,
  };
}

function rulesRaceToGuide(item) {
  if (!item) return null;
  const asi = item.ability_score_increase || {};
  const traits = normalizeArray(item.traits).map((trait) => typeof trait === "string" ? trait : trait?.name).filter(Boolean).slice(0, 8);
  const languages = item.languages && Object.keys(item.languages || {}).length
    ? Object.values(item.languages).join(", ")
    : "см. Бестиарий";
  return {
    id: item.id || normalizeGuideLookup(item.ru_name || item.en_name || item.name),
    label: item.ru_name || item.name || item.en_name || item.id || "Раса",
    aliases: [item.id, item.en_name, item.ru_name].filter(Boolean),
    size: normalizeSize(item.size?.value || item.size?.raw || item.size || "medium"),
    speed: toNumber(item.speed?.walk_ft, 30),
    abilityBonuses: normalizeAbilityBonusMap(asi.fixed || extractAbilityBonusesFromText(asi.raw || "")),
    abilityBonusesRaw: asi.raw || "",
    languages,
    traits,
    sourceGrants: normalizeArray(item.source_grants || item.grants || []),
    subraces: getRulesSubraceOptionsFromRaceItem(item, { source: sourceFromRulesItem(item) }),
    source: sourceFromRulesItem(item),
    sourceKind: "rules-json",
    raw: item,
  };
}

function rulesBackgroundToGuide(item) {
  if (!item) return null;
  const skills = normalizeArray(item.skill_proficiencies).map(normalizeSkillKeyFromAny).filter(Boolean);
  return {
    id: item.id || normalizeGuideLookup(item.ru_name || item.en_name || item.name),
    label: item.ru_name || item.name || item.en_name || item.id || "Предыстория",
    aliases: [item.id, item.en_name, item.ru_name].filter(Boolean),
    skills,
    tools: normalizeArray(item.tool_proficiencies).join(", ") || "—",
    languages: normalizeArray(item.languages).join(", ") || "—",
    feature: item.feature?.name || item.feature || "—",
    equipment: item.equipment_raw || "",
    sourceGrants: normalizeArray(item.source_grants || item.grants || []),
    source: sourceFromRulesItem(item),
    sourceKind: "rules-json",
    raw: item,
  };
}

function rulesSubclassToGuide(item, classGuide = null) {
  if (!item) return null;
  return {
    id: item.id || normalizeGuideLookup(item.name || item.ru_name || item.label),
    label: item.name || item.ru_name || item.label || item.id || "Подкласс",
    aliases: [item.id, item.name, item.ru_name].filter(Boolean),
    source: item.source_url || classGuide?.source || "lss_constructor_rules.json",
    sourceGroup: item.source_group || item.group || "подкласс",
    note: item.source_group || item.group || "",
    abilityBonuses: normalizeAbilityBonusMap(item.ability_bonuses || extractAbilityBonusesFromText(item.ability_score_increase?.raw || item.ability_score_increase || "")),
    abilityBonusesRaw: item.ability_score_increase?.raw || item.ability_score_increase || "",
    featuresByLevel: item.features_by_level || {},
    sourceGrants: normalizeArray(item.source_grants || item.grants || []),
    raw: item,
  };
}

function rulesSubraceToGuide(item, raceGuide = null) {
  if (!item) return null;
  const label = item.name || item.ru_name || item.label || item.title || item.en_name || item.id || "Подраса";
  const fullItem = item?.ability_score_increase ? item : (getRulesRawRaceItemByValue(label) || item);
  const asi = fullItem?.ability_score_increase || {};
  const traits = normalizeArray(fullItem?.traits).map((trait) => typeof trait === "string" ? trait : trait?.name).filter(Boolean).slice(0, 8);
  return {
    id: fullItem.id || item.id || normalizeGuideLookup(label),
    label: fullItem.ru_name || fullItem.name || label,
    aliases: [fullItem.id, item.id, item.name, item.ru_name, item.en_name, item.label, item.title, fullItem.ru_name, fullItem.en_name].filter(Boolean),
    source: fullItem.source_url || item.source_url || item.url || raceGuide?.source || "lss_constructor_rules.json",
    sourceGroup: item.group_title || item.source_group || item.group || "варианты расы",
    note: item.group_title || item.relationship_guess || item.note || (fullItem?.source ? String(fullItem.source) : "вариант из rules JSON"),
    abilityBonuses: normalizeAbilityBonusMap(asi.fixed || extractAbilityBonusesFromText(asi.raw || "")),
    abilityBonusesRaw: asi.raw || "",
    traits,
    sourceGrants: normalizeArray(fullItem.source_grants || item.source_grants || fullItem.grants || item.grants || []),
    reviewFlags: normalizeArray(fullItem.review_flags || item.review_flags || []),
    raw: fullItem || item,
  };
}

function getRulesSubraceOptionsFromRaceItem(item, raceGuide = null) {
  const direct = Array.isArray(item?.subrace_options) ? item.subrace_options : [];
  const linked = Array.isArray(item?.variant_refs) ? item.variant_refs : [];
  return [...direct, ...linked].map((entry) => rulesSubraceToGuide(entry, raceGuide)).filter(Boolean);
}

function normalizeSkillKeyFromAny(value) {
  const raw = normalizeGuideLookup(value);
  if (!raw) return "";
  if (SKILL_BASE_STATS[raw]) return raw;
  const found = Object.entries(SKILL_LABELS).find(([key, label]) => normalizeGuideLookup(label) === raw || normalizeGuideLookup(key) === raw);
  return found?.[0] || raw;
}


const DND_XP_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

function getXpProgressData(profile) {
  const info = profile?.info || {};
  const level = Math.max(1, toNumber(unwrapValue(info?.level, 1), 1));
  const xp = Math.max(0, toNumber(unwrapValue(info?.experience, 0), 0));
  const floor = DND_XP_THRESHOLDS[Math.min(level - 1, DND_XP_THRESHOLDS.length - 1)] ?? 0;
  const next = DND_XP_THRESHOLDS[Math.min(level, DND_XP_THRESHOLDS.length - 1)] ?? null;
  const percent = next && next > floor ? Math.max(0, Math.min(100, ((xp - floor) / (next - floor)) * 100)) : 100;
  return { level, xp, floor, next, percent };
}

function getSpellQuickSummary(profile) {
  const ability = getSpellcastingAbility(profile);
  const attack = getSpellAttackBonus(profile);
  const saveDc = getSpellSaveDc(profile);
  const slots = getSpellSlots(profile);
  const totalSlots = slots.reduce((sum, slot) => sum + toNumber(slot.total, 0), 0);
  const freeSlots = slots.reduce((sum, slot) => sum + Math.max(0, toNumber(slot.total, 0) - toNumber(slot.filled, 0)), 0);
  return {
    ability,
    attack,
    saveDc,
    totalSlots,
    freeSlots,
  };
}

function rollSelectedDie(type) {
  const match = String(type || '').match(/d(\d+)/i);
  const sides = match ? Number(match[1]) : 20;
  const result = Math.floor(Math.random() * sides) + 1;
  LSS_STATE.diceType = `d${sides}`;
  LSS_STATE.lastRoll = { type: `d${sides}`, result, at: Date.now() };
  return LSS_STATE.lastRoll;
}

function updateLssProfile(mutator, toastMessage = '') {
  if (!LSS_STATE.profile) return;
  const nextProfile = cloneData(LSS_STATE.profile || {});
  mutator(nextProfile);
  setLssData(nextProfile, { persistLocal: true, source: 'manual' });
  renderLSS();
  if (toastMessage) showToast(toastMessage);
}

function quickAdjustHp(delta) {
  const current = Math.max(0, toNumber(unwrapValue(LSS_STATE.profile?.vitality?.['hp-current'], 0), 0));
  const next = Math.max(0, current + delta);
  if (!confirm(`Изменить текущие хиты: ${current} → ${next}?`)) return;
  updateLssProfile((profile) => {
    profile.vitality = profile.vitality || {};
    profile.vitality['hp-current'] = preserveValueNode(profile.vitality['hp-current'], next);
  }, 'Хиты обновлены');
}

function quickSetHp() {
  const current = Math.max(0, toNumber(unwrapValue(LSS_STATE.profile?.vitality?.['hp-current'], 0), 0));
  const raw = prompt('Текущие хиты персонажа', String(current));
  if (raw === null) return;
  const next = Math.max(0, toNumber(raw, current));
  if (!confirm(`Сохранить текущие хиты: ${current} → ${next}?`)) return;
  updateLssProfile((profile) => {
    profile.vitality = profile.vitality || {};
    profile.vitality['hp-current'] = preserveValueNode(profile.vitality['hp-current'], next);
  }, 'Хиты обновлены');
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function cloneData(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function unwrapValue(node, fallback = "") {
  if (node === null || node === undefined) return fallback;

  if (
    typeof node === "string" ||
    typeof node === "number" ||
    typeof node === "boolean"
  ) {
    return node;
  }

  if (typeof node === "object") {
    if ("value" in node) return unwrapValue(node.value, fallback);
    if ("score" in node) return unwrapValue(node.score, fallback);
    if ("filled" in node && Object.keys(node).length === 1) {
      return unwrapValue(node.filled, fallback);
    }
  }

  return fallback;
}

function capitalizeRu(value) {
  const str = String(value || "");
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getNested(obj, path, fallback = null) {
  try {
    const value = path.split(".").reduce((acc, key) => acc?.[key], obj);
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function setNested(obj, path, value) {
  const keys = path.split(".");
  let current = obj;

  keys.forEach((key, index) => {
    const isLast = index === keys.length - 1;

    if (isLast) {
      current[key] = value;
      return;
    }

    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }

    current = current[key];
  });
}

function statMod(score) {
  return Math.floor((toNumber(score, 10) - 10) / 2);
}

function formatSigned(num) {
  const n = toNumber(num, 0);
  return n >= 0 ? `+${n}` : `${n}`;
}

function joinNonEmpty(values, separator = ", ") {
  return values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(separator);
}

function normalizeSize(value) {
  const key = normalizeSizeKey(value || "medium");
  const option = LSS_SIZE_OPTIONS.find((item) => item.value === key);
  return option?.label || safe(value, "Средний");
}

const LSS_SIZE_OPTIONS = [
  { value: "tiny", label: "Крошечный" },
  { value: "small", label: "Маленький" },
  { value: "medium", label: "Средний" },
  { value: "large", label: "Большой" },
  { value: "huge", label: "Огромный" },
  { value: "gargantuan", label: "Гигантский" },
];

const LSS_ALIGNMENT_OPTIONS = [
  "Законно-добрый",
  "Нейтрально-добрый",
  "Хаотично-добрый",
  "Законно-нейтральный",
  "Истинно нейтральный",
  "Хаотично-нейтральный",
  "Законно-злой",
  "Нейтрально-злой",
  "Хаотично-злой",
  "Не выбрано",
];

function normalizeAlignment(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const lookup = raw.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();
  const aliases = {
    "lawful good": "Законно-добрый",
    "законно добрый": "Законно-добрый",
    "neutral good": "Нейтрально-добрый",
    "нейтрально добрый": "Нейтрально-добрый",
    "chaotic good": "Хаотично-добрый",
    "хаотично добрый": "Хаотично-добрый",
    "lawful neutral": "Законно-нейтральный",
    "законно нейтральный": "Законно-нейтральный",
    "true neutral": "Истинно нейтральный",
    "neutral": "Истинно нейтральный",
    "истинно нейтральный": "Истинно нейтральный",
    "нейтральный": "Истинно нейтральный",
    "chaotic neutral": "Хаотично-нейтральный",
    "хаотично нейтральный": "Хаотично-нейтральный",
    "lawful evil": "Законно-злой",
    "законно злой": "Законно-злой",
    "neutral evil": "Нейтрально-злой",
    "нейтрально злой": "Нейтрально-злой",
    "chaotic evil": "Хаотично-злой",
    "хаотично злой": "Хаотично-злой",
    "не выбрано": "",
  };
  return aliases[lookup] ?? raw;
}

function getAlignmentOptionsHtml(value = "") {
  const normalized = normalizeAlignment(value);
  const options = ["", ...LSS_ALIGNMENT_OPTIONS];
  return options.map((label) => {
    const display = label || "Выбери мировоззрение";
    const selected = (label || "") === normalized ? "selected" : "";
    return `<option value="${escapeHtml(label)}" ${selected}>${escapeHtml(display)}</option>`;
  }).join("");
}

const LSS_ALIGNMENT_GRID = [
  [
    { value: "Законно-добрый", short: "ЗД", note: "кодекс + добро" },
    { value: "Нейтрально-добрый", short: "НД", note: "помощь без догм" },
    { value: "Хаотично-добрый", short: "ХД", note: "свобода + добро" },
  ],
  [
    { value: "Законно-нейтральный", short: "ЗН", note: "правила прежде всего" },
    { value: "Истинно нейтральный", short: "ИН", note: "баланс / своё дело" },
    { value: "Хаотично-нейтральный", short: "ХН", note: "свобода без цепей" },
  ],
  [
    { value: "Законно-злой", short: "ЗЗ", note: "порядок + выгода" },
    { value: "Нейтрально-злой", short: "НЗ", note: "выгода без правил" },
    { value: "Хаотично-злой", short: "ХЗ", note: "разрушение / воля" },
  ],
];

function renderLssAlignmentGrid(fieldId, value = "") {
  const normalized = normalizeAlignment(value);
  const rows = LSS_ALIGNMENT_GRID.map((row) => `
    <div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px;">
      ${row.map((item) => {
        const active = normalizeAlignment(item.value) === normalized;
        return `
          <button
            class="btn ${active ? "btn-primary" : "btn-secondary"}"
            type="button"
            data-lss-alignment-target="${escapeHtml(fieldId)}"
            data-lss-alignment-value="${escapeHtml(item.value)}"
            title="${escapeHtml(item.value)}"
            style="min-height:48px; padding:7px 9px; display:flex; flex-direction:column; align-items:flex-start; justify-content:center; gap:3px; text-align:left; ${active ? "box-shadow:0 0 0 1px rgba(133,226,239,.65), 0 0 16px rgba(80,190,210,.22);" : ""}"
          >
            <span data-lss-alignment-short="1" style="font-weight:900; letter-spacing:.04em; color:${active ? "rgba(4,24,31,.96)" : "rgba(231,241,244,.96)"};">${escapeHtml(item.short)}</span>
            <span data-lss-alignment-note="1" style="font-size:.70rem; line-height:1.12; font-weight:800; color:${active ? "rgba(19,54,64,.92)" : "rgba(163,179,185,.92)"};">${escapeHtml(item.note)}</span>
          </button>
        `;
      }).join("")}
    </div>
  `).join("");

  return `
    <input id="${escapeHtml(fieldId)}" type="hidden" value="${escapeHtml(normalized)}" />
    <div class="lss-alignment-grid" data-lss-alignment-grid="${escapeHtml(fieldId)}" style="display:grid; gap:6px; margin-top:6px;">
      ${rows}
      <button class="btn btn-secondary" type="button" data-lss-alignment-target="${escapeHtml(fieldId)}" data-lss-alignment-value="" style="justify-content:center; min-height:34px;">Сбросить мировоззрение</button>
    </div>
    <div class="muted" style="font-size:.72rem; margin-top:6px;">Выбор RP-оси: закон ↔ хаос и добро ↔ зло. На механику класса не влияет.</div>
  `;
}

function setLssAlignmentButtonVisual(button, active) {
  if (!button) return;
  button.classList.toggle("btn-primary", Boolean(active));
  button.classList.toggle("btn-secondary", !active);
  button.style.boxShadow = active ? "0 0 0 1px rgba(133,226,239,.65), 0 0 16px rgba(80,190,210,.22)" : "";
  const shortLabel = button.querySelector("[data-lss-alignment-short]");
  const noteLabel = button.querySelector("[data-lss-alignment-note]");
  if (shortLabel) shortLabel.style.color = active ? "rgba(4,24,31,.96)" : "rgba(231,241,244,.96)";
  if (noteLabel) noteLabel.style.color = active ? "rgba(19,54,64,.92)" : "rgba(163,179,185,.92)";
}

function bindLssAlignmentPickers() {
  document.querySelectorAll("[data-lss-alignment-target]").forEach((button) => {
    if (button.dataset.alignmentBound === "1") return;
    button.dataset.alignmentBound = "1";
    button.addEventListener("click", () => {
      const targetId = button.dataset.lssAlignmentTarget || "";
      const input = getSection(targetId);
      if (!input) return;
      input.value = normalizeAlignment(button.dataset.lssAlignmentValue || "");
      const grid = button.closest("[data-lss-alignment-grid]");
      if (!grid) return;
      grid.querySelectorAll("[data-lss-alignment-target]").forEach((node) => {
        const active = normalizeAlignment(node.dataset.lssAlignmentValue || "") === input.value && input.value;
        setLssAlignmentButtonVisual(node, Boolean(active));
      });
    });
  });
}

function normalizeSizeKey(value) {
  const raw = String(value || "").trim().toLowerCase();
  const aliases = {
    tiny: "tiny",
    "крошечный": "tiny",
    "крошечная": "tiny",
    small: "small",
    "маленький": "small",
    "маленькая": "small",
    medium: "medium",
    "средний": "medium",
    "средняя": "medium",
    large: "large",
    "большой": "large",
    "большая": "large",
    huge: "huge",
    "огромный": "huge",
    "огромная": "huge",
    gargantuan: "gargantuan",
    "гигантский": "gargantuan",
    "гигантская": "gargantuan",
  };
  return aliases[raw] || raw || "medium";
}

function getSizeOptionsHtml(value = "medium") {
  const selectedKey = normalizeSizeKey(value || "medium");
  return LSS_SIZE_OPTIONS.map((option) => `
    <option value="${escapeHtml(option.value)}" ${option.value === selectedKey ? "selected" : ""}>${escapeHtml(option.label)}</option>
  `).join("");
}

function getLocalStorageKey() {
  const user = window.__appUser;
  const userKey =
    user?.email ||
    user?.id ||
    (getToken() ? "auth-user" : "guest");

  return `lssData:${userKey}`;
}

function getLocalStorageKeys() {
  const keys = [getLocalStorageKey(), "lssData:last"];
  if (getToken()) keys.push("lssData:auth-user");
  else keys.push("lssData:guest");
  return [...new Set(keys)];
}

function saveLocalLssRaw(raw) {
  try {
    const serialized = JSON.stringify(raw);
    getLocalStorageKeys().forEach((key) => {
      localStorage.setItem(key, serialized);
    });
  } catch (_) {}
}

function loadLocalLssRaw() {
  try {
    for (const key of getLocalStorageKeys()) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = tryParseJson(raw);
      if (parsed) return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function clearLocalLssRaw() {
  try {
    getLocalStorageKeys().forEach((key) => localStorage.removeItem(key));
  } catch (_) {}
}

function getLssCharacterPool() {
  return Array.isArray(LSS_STATE.characterPool) ? LSS_STATE.characterPool : [];
}


function lssEditDomKey(key) {
  return String(key || "")
    .trim()
    .replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getProfileName(profile) {
  return String(
    unwrapValue(profile?.name, "") ||
    unwrapValue(profile?.info?.name, "") ||
    "Персонаж"
  ).trim() || "Персонаж";
}

function getProfileCharacterId(profile = null) {
  const candidate =
    profile?.__dndTraderCharacterId ||
    profile?.character_id ||
    LSS_STATE.selectedCharacterId ||
    "";
  const id = Number(candidate);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function numericInputAttrs(min = null, max = null, step = 1) {
  const parts = ['type="number"', 'inputmode="numeric"', 'autocomplete="off"'];
  if (min !== null && min !== undefined) parts.push(`min="${escapeHtml(String(min))}"`);
  if (max !== null && max !== undefined) parts.push(`max="${escapeHtml(String(max))}"`);
  if (step !== null && step !== undefined) parts.push(`step="${escapeHtml(String(step))}"`);
  return parts.join(" ");
}

function preserveValueNode(previous, value, name = "") {
  if (previous && typeof previous === "object" && !Array.isArray(previous)) {
    return {
      ...previous,
      ...(name ? { name } : previous.name ? { name: previous.name } : {}),
      value,
    };
  }
  return name ? { name, value } : { value };
}

function setLssValue(profile, path, value, name = "") {
  setNested(profile, path, preserveValueNode(getNested(profile, path, null), value, name));
}

function getCoins(profile) {
  const coins = profile?.coins && typeof profile.coins === "object" ? profile.coins : {};
  return {
    pp: toNumber(unwrapValue(coins.pp, 0), 0),
    gp: toNumber(unwrapValue(coins.gp, 0), 0),
    ep: toNumber(unwrapValue(coins.ep, 0), 0),
    sp: toNumber(unwrapValue(coins.sp, 0), 0),
    cp: toNumber(unwrapValue(coins.cp, 0), 0),
  };
}

function extractProfileStatsForAccount(profile) {
  const result = {};
  STAT_DEFS.forEach(({ key }) => {
    result[key] = Math.max(1, Math.min(30, toNumber(getNested(profile, `stats.${key}.score`, 10), 10)));
  });
  return result;
}

function buildAccountCharacterPayload(profile, options = {}) {
  const normalized = normalizeLssProfileForSave(profile);
  const id = getProfileCharacterId(normalized);
  const payload = {
    name: getProfileName(normalized),
    class_name: String(unwrapValue(normalized?.info?.charClass, "") || "").trim(),
    level: Math.max(1, toNumber(unwrapValue(normalized?.info?.level, 1), 1)),
    race: String(unwrapValue(normalized?.info?.race, "") || "").trim(),
    alignment: String(unwrapValue(normalized?.info?.alignment, "") || "").trim(),
    experience: Math.max(0, toNumber(unwrapValue(normalized?.info?.experience, 0), 0)),
    stats: extractProfileStatsForAccount(normalized),
    data: {
      lss: normalized,
      lss_updated_at: new Date().toISOString(),
      lss_source: String(LSS_STATE.source || "manual"),
    },
    make_active: options.makeActive !== false,
  };
  if (id && !options.createNew) payload.id = id;
  return payload;
}

async function syncLssCharacterToAccount(profile, options = {}) {
  if (!getToken()) {
    return { profile, payload: null, account: null, skipped: true };
  }

  const payload = buildAccountCharacterPayload(profile, options);

  try {
    const accountPayload = await apiPost("/account/characters", payload);
    const character = accountPayload?.character || accountPayload?.showcase?.active_character || null;
    const characterId = Number(character?.id || accountPayload?.user?.active_character_id || payload.id || 0);
    const nextProfile = cloneData(profile || {});

    if (Number.isFinite(characterId) && characterId > 0) {
      nextProfile.__dndTraderCharacterId = characterId;
      nextProfile.character_id = characterId;
      LSS_STATE.selectedCharacterId = String(characterId);
    }

    if (Array.isArray(accountPayload?.characters)) {
      LSS_STATE.characterPool = accountPayload.characters;
    }

    if (accountPayload?.user && typeof accountPayload.user === "object") {
      window.__appUser = {
        ...(window.__appUser || {}),
        ...accountPayload.user,
      };
    }

    try {
      window.dispatchEvent(new CustomEvent("dnd:account:changed", { detail: accountPayload }));
      window.dispatchEvent(new CustomEvent("dnd:lss:character-synced", { detail: { character, account: accountPayload } }));
    } catch (_) {}

    return { profile: nextProfile, payload, account: accountPayload, skipped: false };
  } catch (error) {
    console.warn("LSS character sync unavailable:", error);
    return { profile, payload, account: null, skipped: false, error };
  }
}

function buildBlankProfileFromCharacter(character = {}) {
  const name = String(character?.name || "Персонаж").trim() || "Персонаж";
  const className = String(character?.class_name || "").trim();
  const level = Math.max(1, toNumber(character?.level, 1));
  const race = String(character?.race || "").trim();
  const alignment = String(character?.alignment || "").trim();
  const statsSource = character?.stats && typeof character.stats === "object" ? character.stats : {};
  const stats = {};

  STAT_DEFS.forEach(({ key }) => {
    const raw = statsSource[key];
    const score = Math.max(1, Math.min(30, toNumber(typeof raw === "object" ? raw?.score : raw, 10)));
    stats[key] = { name: key, score, modifier: statMod(score), check: statMod(score) };
  });

  const skills = {};
  Object.entries(SKILL_BASE_STATS).forEach(([skillKey, baseStat]) => {
    skills[skillKey] = { baseStat, name: skillKey, isProf: 0 };
  });

  return {
    __dndTraderCharacterId: Number(character?.id || 0) || undefined,
    character_id: Number(character?.id || 0) || undefined,
    name,
    info: {
      name: { name: "name", value: name },
      charClass: { name: "charClass", value: className },
      charSubclass: { name: "charSubclass", value: "" },
      subrace: { name: "subrace", value: "" },
      level: { name: "level", value: level },
      background: { name: "background", value: "" },
      playerName: { name: "playerName", value: "" },
      race: { name: "race", value: race },
      alignment: { name: "alignment", value: alignment },
      experience: { name: "experience", value: Math.max(0, toNumber(character?.experience, 0)) },
      size: { name: "size", value: "medium" },
      statsMethod: { name: "statsMethod", value: "manual" },
      multiclass: { name: "multiclass", value: "" },
      multiclassEnabled: { name: "multiclassEnabled", value: false },
    },
    subInfo: {
      age: { name: "age", value: "" },
      height: { name: "height", value: "" },
      weight: { name: "weight", value: "" },
      eyes: { name: "eyes", value: "" },
      skin: { name: "skin", value: "" },
      hair: { name: "hair", value: "" },
    },
    proficiency: 2,
    stats,
    saves: STAT_DEFS.reduce((acc, { key }) => ({ ...acc, [key]: { name: key, isProf: false } }), {}),
    skills,
    vitality: {
      "hp-current": { value: 10 },
      "hp-max": { value: 10 },
      "hp-temp": { value: 0 },
      speed: { value: 30 },
      initiative: { value: 0 },
      ac: { value: 10 },
      "hit-die": { value: "d8" },
      "hp-dice-current": { value: 1 },
    },
    spellsInfo: { base: { name: "base", value: "", code: "int" }, save: { name: "save", value: "" }, mod: { name: "mod", value: "" } },
    spells: {},
    coins: {
      pp: { value: 0 },
      gp: { value: 0 },
      ep: { value: 0 },
      sp: { value: 0 },
      cp: { value: 0 },
    },
    conditions: [],
    weaponsList: [],
    appearance: "",
    background: "",
    personality: "",
    ideals: "",
    bonds: "",
    flaws: "",
    equipment: "",
    allies: "",
    quests: "",
    attacks: "",
    prof: "",
    "notes-1": "",
    "notes-2": "",
  };
}


function buildStarterProfileFromForm(formData = {}) {
  const name = sanitizePlainText(formData.name || "", { max: 60, allowNumbers: false }) || "Новый персонаж";
  const charClass = sanitizePlainText(formData.charClass || "", { max: 40 });
  const race = sanitizePlainText(formData.race || "", { max: 40 });
  const background = sanitizePlainText(formData.background || "", { max: 50 });
  const subrace = sanitizePlainText(formData.subrace || "", { max: 60 });
  const level = clampNumber(formData.level, 1, 20, 1);
  const selectedId = Number(LSS_STATE.selectedCharacterId || 0) || 0;

  const profile = buildBlankProfileFromCharacter({
    id: selectedId || undefined,
    name,
    class_name: charClass,
    level,
    race,
    alignment: normalizeAlignment(sanitizePlainText(formData.alignment || "", { max: 50 })),
    experience: toNumber(formData.experience, 0),
  });

  profile.name = name;
  setLssValue(profile, "info.name", name, "name");
  setLssValue(profile, "info.charClass", charClass, "charClass");
  setLssValue(profile, "info.charSubclass", sanitizePlainText(formData.charSubclass || "", { max: 60 }), "charSubclass");
  setLssValue(profile, "info.subrace", subrace, "subrace");
  setLssValue(profile, "info.race", race, "race");
  setLssValue(profile, "info.background", background, "background");
  setLssValue(profile, "info.alignment", normalizeAlignment(sanitizePlainText(formData.alignment || "", { max: 50 })), "alignment");
  setLssValue(profile, "info.size", normalizeSize(formData.size || "medium"), "size");
  setLssValue(profile, "info.level", level, "level");
  setLssValue(profile, "info.experience", clampNumber(formData.experience, 0, null, 0), "experience");
  setLssValue(profile, "info.statsMethod", normalizeStatsMethod(formData.statsMethod || "manual"), "statsMethod");
  setLssValue(profile, "info.multiclass", sanitizePlainText(formData.multiclass || "", { max: 120 }), "multiclass");
  setLssValue(profile, "info.multiclassEnabled", Boolean(formData.multiclassEnabled), "multiclassEnabled");
  profile.proficiency = clampNumber(formData.proficiency, 0, 20, 2);

  STAT_DEFS.forEach(({ key }) => {
    const score = clampNumber(formData[`stat_${key}`], 1, 30, 10);
    profile.stats[key] = { ...(profile.stats[key] || {}), name: key, score, modifier: statMod(score), check: statMod(score) };
  });

  applyClassGuideToProfile(profile, { source: "quick-create" });
  applySubclassGuideToProfile(profile, { source: "quick-create" });
  applyRaceGuideToProfile(profile, { source: "quick-create" });
  applySubraceGuideToProfile(profile, { source: "quick-create" });
  applyBackgroundGuideToProfile(profile, { source: "quick-create" });

  profile.vitality = profile.vitality || {};
  profile.vitality["hp-current"] = preserveValueNode(profile.vitality["hp-current"], clampNumber(formData.hpCurrent, 0, 999, 10));
  profile.vitality["hp-max"] = preserveValueNode(profile.vitality["hp-max"], clampNumber(formData.hpMax, 1, 999, formData.hpCurrent || 10));
  profile.vitality["hp-temp"] = preserveValueNode(profile.vitality["hp-temp"], clampNumber(formData.hpTemp, 0, 999, 0));
  profile.vitality["hit-die"] = preserveValueNode(profile.vitality["hit-die"], normalizeHitDie(formData.hitDie, getHitDieValue(profile)), "hit-die");
  profile.vitality["hp-dice-current"] = preserveValueNode(profile.vitality["hp-dice-current"], clampNumber(formData.hitDiceCurrent, 0, 99, level), "hp-dice-current");
  profile.vitality["hp-mode"] = preserveValueNode(profile.vitality["hp-mode"], normalizeHpMode(formData.hpMode || "manual"), "hp-mode");
  profile.vitality.ac = preserveValueNode(profile.vitality.ac, clampNumber(formData.ac, 0, 40, 10));
  profile.vitality.initiative = preserveValueNode(profile.vitality.initiative, formData.initiative === "" || formData.initiative === undefined ? statMod(clampNumber(formData.stat_dex, 1, 30, 10)) : toNumber(formData.initiative, 0));
  profile.vitality.speed = preserveValueNode(profile.vitality.speed, clampNumber(formData.speed, 0, 300, 30));
  profile.ability_improvements = safeParseJsonArray(formData.abilityImprovements, []);
  profile.feats = safeParseJsonArray(formData.feats, []);
  profile.__createdInDndTrader = true;

  return profile;
}

function normalizeLssProfileForSave(profile) {
  const next = cloneData(profile || {});
  const name = getProfileName(next);
  next.name = name;
  next.info = next.info || {};
  next.info.name = preserveValueNode(next.info.name, name, "name");
  next.info.level = preserveValueNode(next.info.level, Math.max(1, toNumber(unwrapValue(next.info.level, 1), 1)), "level");
  next.info.charClass = preserveValueNode(next.info.charClass, String(unwrapValue(next.info.charClass, "") || "").trim(), "charClass");
  next.info.charSubclass = preserveValueNode(next.info.charSubclass, String(unwrapValue(next.info.charSubclass, "") || "").trim(), "charSubclass");
  next.info.subrace = preserveValueNode(next.info.subrace, String(unwrapValue(next.info.subrace, "") || "").trim(), "subrace");
  next.info.race = preserveValueNode(next.info.race, String(unwrapValue(next.info.race, "") || "").trim(), "race");
  next.info.background = preserveValueNode(next.info.background, String(unwrapValue(next.info.background, "") || "").trim(), "background");
  next.info.alignment = preserveValueNode(next.info.alignment, normalizeAlignment(String(unwrapValue(next.info.alignment, "") || "").trim()), "alignment");
  next.info.size = preserveValueNode(next.info.size, normalizeSize(unwrapValue(next.info.size, "medium")), "size");
  next.info.experience = preserveValueNode(next.info.experience, Math.max(0, toNumber(unwrapValue(next.info.experience, 0), 0)), "experience");
  next.info.statsMethod = preserveValueNode(next.info.statsMethod, normalizeStatsMethod(unwrapValue(next.info.statsMethod, "manual")), "statsMethod");
  next.info.multiclass = preserveValueNode(next.info.multiclass, String(unwrapValue(next.info.multiclass, "") || "").trim(), "multiclass");
  next.info.multiclassEnabled = preserveValueNode(next.info.multiclassEnabled, Boolean(unwrapValue(next.info.multiclassEnabled, false)), "multiclassEnabled");
  next.ability_improvements = Array.isArray(next.ability_improvements) ? next.ability_improvements : [];
  next.feats = Array.isArray(next.feats) ? next.feats : [];
  next.vitality = next.vitality || {};
  next.stats = next.stats || {};
  next.saves = next.saves || {};
  next.skills = next.skills || {};
  next.coins = next.coins || {};
  next.vitality["hit-die"] = preserveValueNode(next.vitality["hit-die"], normalizeHitDie(next.vitality["hit-die"], getHitDieValue(next)), "hit-die");
  next.vitality["hp-dice-current"] = preserveValueNode(next.vitality["hp-dice-current"], Math.max(0, toNumber(unwrapValue(next.vitality["hp-dice-current"], 0), 0)), "hp-dice-current");
  next.vitality["hp-mode"] = preserveValueNode(next.vitality["hp-mode"], normalizeHpMode(unwrapValue(next.vitality["hp-mode"], "manual")), "hp-mode");

  STAT_DEFS.forEach(({ key }) => {
    const prev = next.stats[key] && typeof next.stats[key] === "object" ? next.stats[key] : {};
    const score = Math.max(1, Math.min(30, toNumber(prev.score ?? prev.value ?? next.stats[key], 10)));
    next.stats[key] = { ...prev, name: prev.name || key, score, modifier: statMod(score), check: statMod(score) };
    next.saves[key] = { ...(next.saves[key] || {}), name: key, isProf: Boolean(next.saves[key]?.isProf) };
  });

  Object.entries(SKILL_BASE_STATS).forEach(([skillKey, baseStat]) => {
    const prev = next.skills[skillKey] && typeof next.skills[skillKey] === "object" ? next.skills[skillKey] : {};
    next.skills[skillKey] = { ...prev, baseStat: prev.baseStat || baseStat, name: prev.name || skillKey, isProf: toNumber(prev.isProf, 0) > 0 ? 1 : 0 };
  });

  next.updatedAt = new Date().toISOString();
  return next;
}

function broadcastLssProfile(profile) {
  try {
    window.__LSS_EXPORT__ = cloneData(profile);
    window.__PLAYER_LSS__ = cloneData(profile);
    window.__sharedState = window.__sharedState || {};
    window.__sharedState.lss = {
      ...(window.__sharedState.lss || {}),
      raw: cloneData(profile),
      profile: cloneData(profile),
      updatedAt: Date.now(),
    };
    window.dispatchEvent(new CustomEvent("dnd:lss:updated", { detail: { profile: cloneData(profile) } }));
  } catch (_) {}
}

async function loadLssCharacterPool() {
  if (!getToken()) {
    LSS_STATE.characterPool = [];
    LSS_STATE.selectedCharacterId = "";
    return [];
  }

  try {
    const payload = await fetchAccount();
    LSS_STATE.characterPool = Array.isArray(payload?.characters) ? payload.characters : [];
    LSS_STATE.selectedCharacterId = String(
      payload?.user?.active_character_id ||
      LSS_STATE.selectedCharacterId ||
      LSS_STATE.characterPool[0]?.id ||
      ""
    ).trim();
  } catch (_) {
    LSS_STATE.characterPool = [];
  }

  return getLssCharacterPool();
}

// ------------------------------------------------------------
// 📝 RICH TEXT / TIPTAP
// ------------------------------------------------------------
function extractTipTapDoc(value) {
  if (!value) return null;

  if (value?.type === "doc" && Array.isArray(value.content)) {
    return value;
  }

  if (value?.data?.type === "doc" && Array.isArray(value.data.content)) {
    return value.data;
  }

  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    if (parsed) return extractTipTapDoc(parsed);
  }

  return null;
}

function tiptapInline(nodes = []) {
  return (nodes || [])
    .map((node) => {
      if (!node) return "";

      if (node.type === "text") {
        let text = escapeHtml(node.text || "");
        const marks = Array.isArray(node.marks) ? node.marks : [];

        marks.forEach((mark) => {
          const type = mark?.type;
          if (type === "bold") text = `<strong>${text}</strong>`;
          else if (type === "italic") text = `<em>${text}</em>`;
          else if (type === "underline") text = `<u>${text}</u>`;
          else if (type === "strike") text = `<s>${text}</s>`;
          else if (type === "link") {
            const href = escapeHtml(mark?.attrs?.href || "#");
            text = `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`;
          }
        });

        return text;
      }

      if (node.type === "hardBreak") return "<br />";

      return tiptapNode(node);
    })
    .join("");
}

function tiptapNode(node) {
  if (!node || typeof node !== "object") return "";

  if (node.type === "paragraph") {
    const content = tiptapInline(node.content || []);
    return `<p>${content || "&nbsp;"}</p>`;
  }

  if (node.type === "bulletList") {
    return `<ul>${(node.content || []).map(tiptapNode).join("")}</ul>`;
  }

  if (node.type === "orderedList") {
    const start = node.attrs?.start
      ? ` start="${Number(node.attrs.start)}"`
      : "";
    return `<ol${start}>${(node.content || []).map(tiptapNode).join("")}</ol>`;
  }

  if (node.type === "listItem") {
    return `<li>${(node.content || []).map(tiptapNode).join("")}</li>`;
  }

  if (node.type === "heading") {
    const level = Math.min(Math.max(Number(node.attrs?.level || 3), 1), 6);
    return `<h${level}>${tiptapInline(node.content || [])}</h${level}>`;
  }

  if (node.type === "blockquote") {
    return `<blockquote>${(node.content || []).map(tiptapNode).join("")}</blockquote>`;
  }

  if (node.type === "text") {
    return tiptapInline([node]);
  }

  return (node.content || []).map(tiptapNode).join("");
}

function renderRichText(value, fallback = "—") {
  const doc = extractTipTapDoc(value);
  if (!doc) {
    const plain = safe(
      typeof value === "string" ? value : unwrapValue(value, fallback),
      fallback
    );
    return `<p>${escapeHtml(String(plain))}</p>`;
  }

  return (doc.content || []).map(tiptapNode).join("") || `<p>${escapeHtml(fallback)}</p>`;
}

// ------------------------------------------------------------
// 🖼 IMAGE / META
// ------------------------------------------------------------
function unwrapImageCandidate(value) {
  if (!value) return "";

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "object") {
    const nestedCandidates = [
      value.url,
      value.src,
      value.href,
      value.path,
      value.value,
      value.image,
      value.imageUrl,
      value.avatar,
      value.avatarUrl,
      value.portrait,
      value.photo,
      value.file,
      value.data,
    ];

    for (const candidate of nestedCandidates) {
      const resolved = unwrapImageCandidate(candidate);
      if (resolved) return resolved;
    }
  }

  return "";
}

function normalizeImageUrl(url) {
  const raw = unwrapImageCandidate(url);
  if (!raw) return "";

  if (
    raw.startsWith("http://") ||
    raw.startsWith("https://") ||
    raw.startsWith("data:image/") ||
    raw.startsWith("blob:") ||
    raw.startsWith("file:")
  ) {
    return raw;
  }

  if (raw.startsWith("/")) return raw;
  if (raw.startsWith("./")) return raw.slice(1);
  if (raw.startsWith("../")) return raw;
  if (raw.startsWith("static/")) return `/${raw}`;

  return `/static/images/${raw.replace(/^\/+/, "")}`;
}

function getPortraitUrl(profile) {
  const root = profile?.__lssRoot || LSS_STATE.raw || {};
  const rootParsedData =
    typeof root?.data === "string" ? tryParseJson(root.data) : root?.data;

  const candidates = [
    profile?.portrait,
    profile?.portraitUrl,
    profile?.image,
    profile?.imageUrl,
    profile?.avatar,
    profile?.avatarUrl,
    profile?.photo,
    profile?.photoUrl,
    profile?.picture,
    profile?.pictureUrl,
    profile?.pictures?.portrait,
    profile?.pictures?.image,
    profile?.media?.portrait,
    profile?.media?.image,
    profile?.art?.portrait,
    profile?.art?.image,
    profile?.assets?.portrait,
    profile?.assets?.avatar,
    profile?.visual?.portrait,
    profile?.visual?.avatar,
    profile?.info?.portrait,
    profile?.info?.image,
    profile?.cover,
    profile?.coverUrl,
    profile?.exportMeta?.portrait,

    root?.portrait,
    root?.portraitUrl,
    root?.image,
    root?.imageUrl,
    root?.avatar,
    root?.avatarUrl,
    root?.photo,
    root?.photoUrl,
    root?.picture,
    root?.pictureUrl,
    root?.media?.portrait,
    root?.media?.image,

    rootParsedData?.portrait,
    rootParsedData?.portraitUrl,
    rootParsedData?.image,
    rootParsedData?.imageUrl,
    rootParsedData?.avatar,
    rootParsedData?.avatarUrl,
    rootParsedData?.photo,
    rootParsedData?.photoUrl,
    rootParsedData?.picture,
    rootParsedData?.pictureUrl,
    rootParsedData?.media?.portrait,
    rootParsedData?.media?.image,
  ];

  const found = candidates
    .map((candidate) => normalizeImageUrl(candidate))
    .find(Boolean);

  return found || "";
}

function getEdition(profile) {
  return (
    safe(profile?.exportMeta?.edition, "") ||
    safe(profile?.edition, "") ||
    safe(LSS_STATE.raw?.edition, "")
  );
}

function getTagList(profile) {
  const rawTags =
    profile?.exportMeta?.tags ||
    profile?.tags ||
    LSS_STATE.raw?.tags ||
    [];
  return Array.isArray(rawTags) ? rawTags.filter(Boolean) : [];
}

function applyPortraitToProfile(profile, portraitValue) {
  if (!profile || typeof profile !== "object") return profile;
  const next = cloneData(profile);
  next.portrait = portraitValue || "";
  return next;
}

async function readFileAsDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать изображение"));
    reader.readAsDataURL(file);
  });
}

// ------------------------------------------------------------
// 📊 STATS / SKILLS / SAVES
// ------------------------------------------------------------
function getProficiencyBonus(profile) {
  return toNumber(profile?.proficiency, 2);
}

function getStatScore(profile, key) {
  return toNumber(getNested(profile, `stats.${key}.score`, 10), 10);
}

function getStatModifier(profile, key) {
  const score = getStatScore(profile, key);
  const derived = statMod(score);
  const direct = getNested(profile, `stats.${key}.modifier`, null);

  if (direct !== null && direct !== undefined && direct !== "") {
    const directNum = toNumber(direct, derived);
    if (Math.abs(directNum - derived) <= 1) {
      return directNum;
    }
  }

  return derived;
}

function getDexInitiative(profile) {
  return getStatModifier(profile, "dex");
}

function getInitiativeModifier(profile) {
  const raw = unwrapValue(profile?.vitality?.initiative, "");
  if (raw === "" || raw === null || raw === undefined) return getDexInitiative(profile);
  return toNumber(raw, getDexInitiative(profile));
}

function hasSaveProficiency(profile, key) {
  return Boolean(getNested(profile, `saves.${key}.isProf`, false));
}

function getSaveModifier(profile, key) {
  const base = getStatModifier(profile, key);
  return hasSaveProficiency(profile, key)
    ? base + getProficiencyBonus(profile)
    : base;
}

function getSkillModifier(profile, skillKey) {
  const skill = getNested(profile, `skills.${skillKey}`, {});
  const baseStat = skill?.baseStat || "int";
  const prof = toNumber(skill?.isProf, 0);
  const baseMod = getStatModifier(profile, baseStat);
  const proficiency = getProficiencyBonus(profile);

  return baseMod + prof * proficiency;
}

function isSkillProficient(profile, skillKey) {
  return toNumber(getNested(profile, `skills.${skillKey}.isProf`, 0), 0) > 0;
}

function getPassivePerception(profile) {
  return 10 + getSkillModifier(profile, "perception");
}

function getPassiveInsight(profile) {
  return 10 + getSkillModifier(profile, "insight");
}

function getPassiveInvestigation(profile) {
  return 10 + getSkillModifier(profile, "investigation");
}

const STAT_DEFS = [
  { key: "str", label: "Сила" },
  { key: "dex", label: "Ловкость" },
  { key: "con", label: "Телосложение" },
  { key: "int", label: "Интеллект" },
  { key: "wis", label: "Мудрость" },
  { key: "cha", label: "Харизма" },
];

const SKILL_LABELS = {
  acrobatics: "Акробатика",
  athletics: "Атлетика",
  perception: "Восприятие",
  survival: "Выживание",
  performance: "Выступление",
  intimidation: "Запугивание",
  history: "История",
  "sleight of hand": "Ловкость рук",
  arcana: "Магия",
  medicine: "Медицина",
  deception: "Обман",
  nature: "Природа",
  insight: "Проницательность",
  religion: "Религия",
  stealth: "Скрытность",
  persuasion: "Убеждение",
  "animal handling": "Уход за животными",
  investigation: "Анализ",
};

const SKILL_BASE_STATS = {
  athletics: "str",
  acrobatics: "dex",
  "sleight of hand": "dex",
  stealth: "dex",
  arcana: "int",
  history: "int",
  investigation: "int",
  nature: "int",
  religion: "int",
  "animal handling": "wis",
  insight: "wis",
  medicine: "wis",
  perception: "wis",
  survival: "wis",
  deception: "cha",
  intimidation: "cha",
  performance: "cha",
  persuasion: "cha",
};


const STAT_LABELS = Object.fromEntries(STAT_DEFS.map(({ key, label }) => [key, label]));
const STAT_SHORT_LABELS = {
  str: "СИЛ",
  dex: "ЛОВ",
  con: "ТЕЛ",
  int: "ИНТ",
  wis: "МДР",
  cha: "ХАР",
};

function getStatShortLabel(key) {
  return STAT_SHORT_LABELS[key] || String(key || "").toUpperCase();
}

function formatStatBonusMap(bonuses = {}) {
  const entries = Object.entries(bonuses || {})
    .filter(([, value]) => Number(value) !== 0)
    .map(([key, value]) => `${STAT_LABELS[key] || key} ${Number(value) > 0 ? "+" : ""}${value}`);
  return entries.length ? entries.join(", ") : "без бонусов к характеристикам";
}


function normalizeAbilityBonusMap(bonuses = {}) {
  const result = {};
  Object.entries(bonuses || {}).forEach(([key, value]) => {
    const statKey = normalizeStatKeyFromText(key);
    const number = Number(value);
    if (!statKey || !Number.isFinite(number) || number === 0) return;
    result[statKey] = (result[statKey] || 0) + number;
  });
  return result;
}

function normalizeStatKeyFromText(value) {
  const raw = normalizeGuideLookup(value);
  if (!raw) return "";
  const map = {
    str: ["str", "strength", "сила", "силы", "сил", "силе"],
    dex: ["dex", "dexterity", "ловкость", "ловкости", "лов", "ловке"],
    con: ["con", "constitution", "телосложение", "телосложения", "тел", "выносливость"],
    int: ["int", "intelligence", "интеллект", "интеллекта", "инт"],
    wis: ["wis", "wisdom", "мудрость", "мудрости", "мдр"],
    cha: ["cha", "charisma", "харизма", "харизмы", "хар"],
  };
  return Object.entries(map).find(([, aliases]) => aliases.some((alias) => normalizeGuideLookup(alias) === raw))?.[0] || "";
}

function extractAbilityBonusesFromText(text = "") {
  const raw = String(text || "");
  if (!raw.trim()) return {};
  const result = {};
  const statAliases = [
    ["str", "Сил(?:а|ы|е)?"],
    ["dex", "Ловкост(?:ь|и|ью)?"],
    ["con", "Телосложени(?:е|я|ю|ем)?"],
    ["int", "Интеллект(?:а|у|ом)?"],
    ["wis", "Мудрост(?:ь|и|ью)?"],
    ["cha", "Харизм(?:а|ы|е|ой)?"],
  ];
  statAliases.forEach(([key, pattern]) => {
    const regex = new RegExp(String.raw`${pattern}[^.]{0,80}?(?:увеличива(?:ет|ется|ются)|повыша(?:ет|ется|ются)|\+)[^0-9+\-]{0,24}([+\-]?\d+)`, "ig");
    let match;
    while ((match = regex.exec(raw))) {
      const number = Number(match[1]);
      if (Number.isFinite(number) && number !== 0) result[key] = Math.max(result[key] || 0, number);
    }
  });
  const allStatsMatch = raw.match(/всех характеристик[^0-9]{0,40}([+\-]?\d+)/i) || raw.match(/кажд(?:ая|ой|ую) характеристик(?:а|и)?[^0-9]{0,40}([+\-]?\d+)/i);
  if (allStatsMatch) {
    const number = Number(allStatsMatch[1]);
    if (Number.isFinite(number) && number !== 0) STAT_DEFS.forEach(({ key }) => { result[key] = number; });
  }
  return normalizeAbilityBonusMap(result);
}

function mergeAbilityBonusMaps(...maps) {
  const result = {};
  maps.forEach((map) => {
    Object.entries(normalizeAbilityBonusMap(map || {})).forEach(([key, value]) => {
      result[key] = (result[key] || 0) + Number(value || 0);
    });
  });
  return result;
}

function hasAbilityBonuses(map = {}) {
  return Object.values(map || {}).some((value) => Number(value) !== 0);
}

function getGuideSourceAbilityBonuses(guide) {
  const result = {};
  getGuideSourceGrants(guide).forEach((grant) => {
    if (!grant || grant.type !== "ability_bonus") return;
    const statKey = normalizeStatKeyFromText(grant.ability || grant.stat || grant.name || "");
    const value = Number(grant.value);
    if (!statKey || !Number.isFinite(value) || value === 0) return;
    result[statKey] = (result[statKey] || 0) + value;
  });
  return normalizeAbilityBonusMap(result);
}

function getGuideAbilityBonuses(guide) {
  if (!guide) return {};
  const structured = mergeAbilityBonusMaps(guide.abilityBonuses || {}, getGuideSourceAbilityBonuses(guide));
  if (hasAbilityBonuses(structured)) return structured;
  return extractAbilityBonusesFromText(guide.abilityBonusesRaw || "");
}

const LSS_RACE_GUIDES = [
  { id: "human", label: "Человек", aliases: ["human", "человек", "люди"], size: "Средний", speed: 30, abilityBonuses: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }, languages: "Общий + ещё 1 язык", traits: ["Универсальность"] },
  { id: "elf", label: "Эльф", aliases: ["elf", "эльф", "эльфийка"], size: "Средний", speed: 30, abilityBonuses: { dex: 2 }, languages: "Общий, эльфийский", traits: ["Тёмное зрение", "Наследие фей", "Транс"] },
  { id: "dwarf", label: "Дварф", aliases: ["dwarf", "дварф", "дворф", "гном дворф"], size: "Средний", speed: 25, abilityBonuses: { con: 2 }, languages: "Общий, дварфийский", traits: ["Тёмное зрение", "Дварфийская стойкость", "Знание камня"] },
  { id: "halfling", label: "Полурослик", aliases: ["halfling", "полурослик", "халфлинг"], size: "Маленький", speed: 25, abilityBonuses: { dex: 2 }, languages: "Общий, полуросличий", traits: ["Удачливый", "Храбрый", "Проворство полурослика"] },
  { id: "gnome", label: "Гном", aliases: ["gnome", "гном"], size: "Маленький", speed: 25, abilityBonuses: { int: 2 }, languages: "Общий, гномий", traits: ["Тёмное зрение", "Гномья хитрость"] },
  { id: "half-elf", label: "Полуэльф", aliases: ["half elf", "half-elf", "полуэльф", "полуэльфийка"], size: "Средний", speed: 30, abilityBonuses: { cha: 2 }, languages: "Общий, эльфийский + ещё 1", traits: ["Тёмное зрение", "Наследие фей", "Универсальные навыки"] },
  { id: "half-orc", label: "Полуорк", aliases: ["half orc", "half-orc", "полуорк", "полуорчиха"], size: "Средний", speed: 30, abilityBonuses: { str: 2, con: 1 }, languages: "Общий, орочий", traits: ["Тёмное зрение", "Непоколебимая стойкость", "Свирепые атаки"] },
  { id: "tiefling", label: "Тифлинг", aliases: ["tiefling", "тифлинг", "тифлингша"], size: "Средний", speed: 30, abilityBonuses: { cha: 2, int: 1 }, languages: "Общий, инфернальный", traits: ["Тёмное зрение", "Адское сопротивление", "Наследие"] },
  { id: "dragonborn", label: "Драконорождённый", aliases: ["dragonborn", "драконорожденный", "драконорождённый"], size: "Средний", speed: 30, abilityBonuses: { str: 2, cha: 1 }, languages: "Общий, драконий", traits: ["Дыхание дракона", "Сопротивление стихии"] },
];

const LSS_BACKGROUND_GUIDES = [
  { id: "acolyte", label: "Прислужник", aliases: ["acolyte", "прислужник", "служитель"], skills: ["insight", "religion"], tools: "—", languages: "+2 языка", feature: "Приют верующих" },
  { id: "charlatan", label: "Шарлатан", aliases: ["charlatan", "шарлатан"], skills: ["deception", "sleight of hand"], tools: "Набор для подделки, набор для грима", languages: "—", feature: "Фальшивая личность" },
  { id: "criminal", label: "Преступник", aliases: ["criminal", "преступник", "криминал"], skills: ["deception", "stealth"], tools: "Игровой набор, воровские инструменты", languages: "—", feature: "Криминальный контакт" },
  { id: "folk-hero", label: "Народный герой", aliases: ["folk hero", "народный герой", "герой народа"], skills: ["animal handling", "survival"], tools: "Ремесленный инструмент, транспорт", languages: "—", feature: "Гостеприимство простолюдинов" },
  { id: "guild-artisan", label: "Гильдейский ремесленник", aliases: ["guild artisan", "гильдейский ремесленник", "ремесленник"], skills: ["insight", "persuasion"], tools: "Ремесленный инструмент", languages: "+1 язык", feature: "Членство в гильдии" },
  { id: "noble", label: "Дворянин", aliases: ["noble", "дворянин", "дворянка"], skills: ["history", "persuasion"], tools: "Игровой набор", languages: "+1 язык", feature: "Положение привилегии" },
  { id: "outlander", label: "Чужеземец", aliases: ["outlander", "чужеземец", "скиталец"], skills: ["athletics", "survival"], tools: "Музыкальный инструмент", languages: "+1 язык", feature: "Странник" },
  { id: "sage", label: "Мудрец", aliases: ["sage", "мудрец", "учёный", "ученый"], skills: ["arcana", "history"], tools: "—", languages: "+2 языка", feature: "Исследователь" },
  { id: "sailor", label: "Моряк", aliases: ["sailor", "моряк", "морячка"], skills: ["athletics", "perception"], tools: "Навигаторские инструменты, транспорт водный", languages: "—", feature: "Проход на корабле" },
  { id: "soldier", label: "Солдат", aliases: ["soldier", "солдат", "военный"], skills: ["athletics", "intimidation"], tools: "Игровой набор, транспорт", languages: "—", feature: "Воинское звание" },
  { id: "urchin", label: "Беспризорник", aliases: ["urchin", "беспризорник", "уличный"], skills: ["sleight of hand", "stealth"], tools: "Воровские инструменты, набор для грима", languages: "—", feature: "Городские тайны" },
];

function getGuideFromCollection(collection, value) {
  const raw = normalizeGuideLookup(value);
  if (!raw) return null;
  return collection.find((guide) => {
    if (normalizeGuideLookup(guide.label) === raw || normalizeGuideLookup(guide.id) === raw) return true;
    return (guide.aliases || []).some((alias) => normalizeGuideLookup(alias) === raw);
  }) || null;
}

function getRulesRawRaceItemByValue(value) {
  const map = getLssRulesMap("races");
  const lookup = getLssRulesLookup("race_by_name");
  return pickRulesObjectByValue(map, lookup, value);
}

function getRulesRaceGuide(value) {
  const item = getRulesRawRaceItemByValue(value);
  return rulesRaceToGuide(item);
}

function getRulesBackgroundGuide(value) {
  const map = getLssRulesMap("backgrounds");
  const lookup = getLssRulesLookup("background_by_name");
  const item = pickRulesObjectByValue(map, lookup, value);
  return rulesBackgroundToGuide(item);
}

function getLssRaceGuide(value) {
  return getRulesRaceGuide(value) || getGuideFromCollection(LSS_RACE_GUIDES, value);
}

function getLssBackgroundGuide(value) {
  return getRulesBackgroundGuide(value) || getGuideFromCollection(LSS_BACKGROUND_GUIDES, value);
}

function getRulesRaceList() {
  const map = getLssRulesMap("races");
  if (!map) return [];
  return sortLssGuideList(Object.values(map).map(rulesRaceToGuide).filter(Boolean));
}

function getRulesBackgroundList() {
  const map = getLssRulesMap("backgrounds");
  if (!map) return [];
  return sortLssGuideList(Object.values(map).map(rulesBackgroundToGuide).filter(Boolean));
}

function getLssRaceOptionsHtml() {
  const rulesList = getRulesRaceList();
  const list = rulesList.length ? rulesList : LSS_RACE_GUIDES;
  return list.map((guide) => `<option value="${escapeHtml(guide.label)}"></option>`).join("");
}

function isLssGuideValueSelected(guide, selected = "") {
  const raw = normalizeGuideLookup(selected);
  if (!raw) return false;
  if (normalizeGuideLookup(guide?.label) === raw || normalizeGuideLookup(guide?.id) === raw) return true;
  return (guide?.aliases || []).some((alias) => normalizeGuideLookup(alias) === raw);
}

function getLssRaceSelectOptionsHtml(selected = "") {
  const rulesList = getRulesRaceList();
  const list = rulesList.length ? rulesList : LSS_RACE_GUIDES;
  const options = [`<option value="">Выбери расу</option>`];
  list.forEach((guide) => {
    const isSelected = isLssGuideValueSelected(guide, selected) ? "selected" : "";
    const sourceMark = guide?.sourceKind === "rules-json" ? "" : "";
    options.push(`<option value="${escapeHtml(guide.label)}" ${isSelected}>${escapeHtml(guide.label + sourceMark)}</option>`);
  });
  return options.join("");
}

function getLssBackgroundOptionsHtml() {
  const rulesList = getRulesBackgroundList();
  const list = rulesList.length ? rulesList : LSS_BACKGROUND_GUIDES;
  return list.map((guide) => `<option value="${escapeHtml(guide.label)}"></option>`).join("");
}

const LSS_CLASS_GUIDES = [
  {
    id: "barbarian",
    label: "Варвар",
    aliases: ["barbarian", "варвар", "варвары"],
    hitDie: 12,
    saves: ["str", "con"],
    primaryStats: ["str", "con", "dex"],
    armor: "Лёгкая и средняя броня, щиты",
    weapons: "Простое и воинское оружие",
    spellcasting: false,
    role: "жирный фронтлайн, ярость, силовые проверки",
    beginnerTip: "Сначала держи высокими Силу и Телосложение. Ловкость помогает КБ и инициативе.",
    level1: ["Ярость", "Защита без доспехов"],
  },
  {
    id: "bard",
    label: "Бард",
    aliases: ["bard", "бард", "барды"],
    hitDie: 8,
    saves: ["dex", "cha"],
    primaryStats: ["cha", "dex", "con"],
    armor: "Лёгкая броня",
    weapons: "Простое оружие, ручные арбалеты, длинные мечи, рапиры, короткие мечи",
    spellcasting: true,
    spellAbility: "cha",
    spellType: "полный заклинатель",
    role: "баффы, контроль, социальные сцены, поддержка",
    beginnerTip: "Харизма — твой мотор. Держи Ловкость и Телосложение не просевшими, чтобы не падать от первого чиха.",
    level1: ["Вдохновение барда", "Использование заклинаний"],
  },
  {
    id: "cleric",
    label: "Жрец",
    aliases: ["cleric", "жрец", "жрица", "клирик", "клерик"],
    hitDie: 8,
    saves: ["wis", "cha"],
    primaryStats: ["wis", "con", "str"],
    armor: "Лёгкая и средняя броня, щиты",
    weapons: "Простое оружие",
    spellcasting: true,
    spellAbility: "wis",
    spellType: "подготовленный полный заклинатель",
    role: "лечение, защита, священный урон, поддержка",
    beginnerTip: "Мудрость усиливает заклинания. Телосложение помогает держать концентрацию.",
    level1: ["Использование заклинаний", "Божественный домен"],
  },
  {
    id: "druid",
    label: "Друид",
    aliases: ["druid", "друид", "друидка"],
    hitDie: 8,
    saves: ["int", "wis"],
    primaryStats: ["wis", "con", "dex"],
    armor: "Лёгкая и средняя броня, щиты без металлического вайба",
    weapons: "Друидское оружие: посох, серп, копьё и близкие варианты",
    spellcasting: true,
    spellAbility: "wis",
    spellType: "подготовленный полный заклинатель",
    role: "контроль, лечение, природа, формы зверей позже",
    beginnerTip: "Мудрость — главное. Телосложение и Ловкость делают тебя живее в бою.",
    level1: ["Друидический язык", "Использование заклинаний"],
  },
  {
    id: "fighter",
    label: "Воин",
    aliases: ["fighter", "воин", "боец", "воитель", "воительница"],
    hitDie: 10,
    saves: ["str", "con"],
    primaryStats: ["str", "con", "dex"],
    armor: "Вся броня и щиты",
    weapons: "Простое и воинское оружие",
    spellcasting: false,
    role: "надёжный боец, оружие, броня, много атак позже",
    beginnerTip: "Выбери стиль: Сила для тяжёлого оружия/брони или Ловкость для дальнего боя/лёгкого билда.",
    level1: ["Боевой стиль", "Второе дыхание"],
  },
  {
    id: "monk",
    label: "Монах",
    aliases: ["monk", "монах", "монахиня"],
    hitDie: 8,
    saves: ["str", "dex"],
    primaryStats: ["dex", "wis", "con"],
    armor: "Без брони и щитов",
    weapons: "Простое оружие и короткие мечи",
    spellcasting: false,
    role: "мобильность, удары, контроль позиции",
    beginnerTip: "Ловкость и Мудрость дают урон/КБ. Телосложение нужно, чтобы не стать бумажным ниндзя.",
    level1: ["Защита без доспехов", "Боевые искусства"],
  },
  {
    id: "paladin",
    label: "Паладин",
    aliases: ["paladin", "паладин", "паладинка"],
    hitDie: 10,
    saves: ["wis", "cha"],
    primaryStats: ["str", "cha", "con"],
    armor: "Вся броня и щиты",
    weapons: "Простое и воинское оружие",
    spellcasting: true,
    spellAbility: "cha",
    spellType: "полузаклинатель со 2 уровня",
    role: "танк, бурст, ауры, святая кувалда по проблемам",
    beginnerTip: "Сила бьёт, Харизма питает ауры и заклинания, Телосложение держит тебя на ногах.",
    level1: ["Божественное чувство", "Наложение рук"],
  },
  {
    id: "ranger",
    label: "Следопыт",
    aliases: ["ranger", "следопыт", "рейнджер"],
    hitDie: 10,
    saves: ["str", "dex"],
    primaryStats: ["dex", "wis", "con"],
    armor: "Лёгкая и средняя броня, щиты",
    weapons: "Простое и воинское оружие",
    spellcasting: true,
    spellAbility: "wis",
    spellType: "полузаклинатель со 2 уровня",
    role: "выживание, разведка, дальний бой, охота",
    beginnerTip: "Ловкость обычно решает атаку и КБ, Мудрость — навыки и заклинания.",
    level1: ["Избранный враг", "Исследователь природы"],
  },
  {
    id: "rogue",
    label: "Плут",
    aliases: ["rogue", "плут", "вор", "разбойник", "разбойница"],
    hitDie: 8,
    saves: ["dex", "int"],
    primaryStats: ["dex", "con", "cha"],
    armor: "Лёгкая броня",
    weapons: "Простое оружие, ручные арбалеты, длинные мечи, рапиры, короткие мечи",
    spellcasting: false,
    role: "скрытность, взлом, точный урон, экспертиза",
    beginnerTip: "Ловкость — главный стат. Скрытность, Ловкость рук и Восприятие почти всегда полезны.",
    level1: ["Экспертиза", "Скрытая атака", "Воровской жаргон"],
  },
  {
    id: "sorcerer",
    label: "Чародей",
    aliases: ["sorcerer", "чародей", "чародейка", "сорк", "сорцерер"],
    hitDie: 6,
    saves: ["con", "cha"],
    primaryStats: ["cha", "con", "dex"],
    armor: "Без брони",
    weapons: "Кинжалы, дротики, пращи, посохи, лёгкие арбалеты",
    spellcasting: true,
    spellAbility: "cha",
    spellType: "полный заклинатель",
    role: "магия через Харизму, гибкие заклинания, сильный каст",
    beginnerTip: "Харизма — урон и сложность спасбросков. Телосложение помогает концентрации.",
    level1: ["Использование заклинаний", "Чародейское происхождение"],
  },
  {
    id: "warlock",
    label: "Колдун",
    aliases: ["warlock", "колдун", "ведьмак", "варлок"],
    hitDie: 8,
    saves: ["wis", "cha"],
    primaryStats: ["cha", "con", "dex"],
    armor: "Лёгкая броня",
    weapons: "Простое оружие",
    spellcasting: true,
    spellAbility: "cha",
    spellType: "магия договора, мало ячеек, но они быстро восстанавливаются",
    role: "стабильный магический урон, договор, странные силы",
    beginnerTip: "Харизма — главное. Eldritch Blast-логика: меньше ячеек, больше стабильности.",
    level1: ["Покровитель", "Магия договора"],
  },
  {
    id: "wizard",
    label: "Волшебник",
    aliases: ["wizard", "волшебник", "волшебница", "маг", "магичка"],
    hitDie: 6,
    saves: ["int", "wis"],
    primaryStats: ["int", "dex", "con"],
    armor: "Без брони",
    weapons: "Кинжалы, дротики, пращи, посохи, лёгкие арбалеты",
    spellcasting: true,
    spellAbility: "int",
    spellType: "подготовка из книги заклинаний",
    role: "контроль, урон, утилити, самая широкая магическая коробка инструментов",
    beginnerTip: "Интеллект — главный. Ловкость даёт КБ, Телосложение помогает выжить и держать концентрацию.",
    level1: ["Использование заклинаний", "Магическое восстановление"],
  },
  {
    id: "artificer",
    label: "Изобретатель",
    aliases: ["artificer", "изобретатель", "артифисер", "артефактор"],
    hitDie: 8,
    saves: ["con", "int"],
    primaryStats: ["int", "con", "dex"],
    armor: "Лёгкая и средняя броня, щиты",
    weapons: "Простое оружие",
    spellcasting: true,
    spellAbility: "int",
    spellType: "полузаклинатель через Интеллект",
    role: "магия через инструменты, ремесло, поддержка, инфузии позже",
    beginnerTip: "Интеллект — механика и заклинания. Телосложение и Ловкость помогают жить.",
    level1: ["Магическое ремесло", "Использование заклинаний"],
  },
];


// Compact constructor choices are sourced from current bestiary preview data.
// We keep only labels/ids here: full mechanics remain in Энциклопедия/Бестиарий.
const LSS_SUBCLASS_GUIDES = {
  "bard": [
    {
      "id": "kollegiya_doblesti",
      "label": "Коллегия доблести",
      "sourceGroup": "Коллегии бардов",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "kollegiya_znaniy",
      "label": "Коллегия знаний",
      "sourceGroup": "Коллегии бардов",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "kollegiya_mechey",
      "label": "Коллегия мечей",
      "sourceGroup": "Коллегии бардов",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "kollegiya_ocharovaniya",
      "label": "Коллегия очарования",
      "sourceGroup": "Коллегии бардов",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "kollegiya_shepotov",
      "label": "Коллегия шёпотов",
      "sourceGroup": "Коллегии бардов",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "kollegiya_krasnorechiya",
      "label": "Коллегия красноречия",
      "sourceGroup": "Коллегии бардов",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "kollegiya_sozidaniya",
      "label": "Коллегия созидания",
      "sourceGroup": "Коллегии бардов",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "kollegiya_duhov",
      "label": "Коллегия духов",
      "sourceGroup": "Коллегии бардов",
      "source": "bestiary/classes_bestiari_preview"
    }
  ],
  "barbarian": [
    {
      "id": "put_berserka",
      "label": "Путь берсерка",
      "sourceGroup": "Пути дикости",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "put_totemnogo_voina",
      "label": "Путь тотемного воина",
      "sourceGroup": "Пути дикости",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "put_bushuyuschego_v_boyu",
      "label": "Путь бушующего в бою",
      "sourceGroup": "Пути дикости",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "put_predka_hranitelya",
      "label": "Путь предка-хранителя",
      "sourceGroup": "Пути дикости",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "put_fanatika",
      "label": "Путь фанатика",
      "sourceGroup": "Пути дикости",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "put_dikoy_magii",
      "label": "Путь дикой магии",
      "sourceGroup": "Пути дикости",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "put_velikana",
      "label": "Путь великана",
      "sourceGroup": "Пути дикости",
      "source": "bestiary/classes_bestiari_preview"
    }
  ],
  "fighter": [
    {
      "id": "master_boevyh_iskusstv",
      "label": "Мастер боевых искусств",
      "sourceGroup": "Воинские архетипы",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "misticheskiy_rytsar",
      "label": "Мистический рыцарь",
      "sourceGroup": "Воинские архетипы",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "chempion",
      "label": "Чемпион",
      "sourceGroup": "Воинские архетипы",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "rytsar_purpurnogo_drakona",
      "label": "Рыцарь Пурпурного дракона",
      "sourceGroup": "Воинские архетипы",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "kavalerist",
      "label": "Кавалерист",
      "sourceGroup": "Воинские архетипы",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "misticheskiy_luchnik",
      "label": "Мистический лучник",
      "sourceGroup": "Воинские архетипы",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "samuray",
      "label": "Самурай",
      "sourceGroup": "Воинские архетипы",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "rytsar_eha",
      "label": "Рыцарь Эха",
      "sourceGroup": "Воинские архетипы",
      "source": "bestiary/classes_bestiari_preview"
    }
  ],
  "wizard": [
    {
      "id": "shkola_voploscheniya",
      "label": "Школа Воплощения",
      "sourceGroup": "Магические традиции",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "shkola_vyzova",
      "label": "Школа Вызова",
      "sourceGroup": "Магические традиции",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "shkola_illyuzii",
      "label": "Школа Иллюзии",
      "sourceGroup": "Магические традиции",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "shkola_nekromantii",
      "label": "Школа Некромантии",
      "sourceGroup": "Магические традиции",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "shkola_ocharovaniya",
      "label": "Школа Очарования",
      "sourceGroup": "Магические традиции",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "shkola_preobrazovaniya",
      "label": "Школа Преобразования",
      "sourceGroup": "Магические традиции",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "shkola_proritsaniya",
      "label": "Школа Прорицания",
      "sourceGroup": "Магические традиции",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "voennaya_magiya",
      "label": "Военная магия",
      "sourceGroup": "Магические традиции",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "magiya_hronurgii",
      "label": "Магия хронургии",
      "sourceGroup": "Магические традиции",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "magiya_graviturgii",
      "label": "Магия гравитургии",
      "sourceGroup": "Магические традиции",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "orden_pistsov",
      "label": "Орден писцов",
      "sourceGroup": "Магические традиции",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "pesn_klinka",
      "label": "Песнь клинка",
      "sourceGroup": "Магические традиции",
      "source": "bestiary/classes_bestiari_preview"
    }
  ],
  "druid": [
    {
      "id": "krug_zemli",
      "label": "Круг земли",
      "sourceGroup": "Круги друидов",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "krug_luny",
      "label": "Круг луны",
      "sourceGroup": "Круги друидов",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "krug_pastyrya",
      "label": "Круг пастыря",
      "sourceGroup": "Круги друидов",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "krug_snov",
      "label": "Круг снов",
      "sourceGroup": "Круги друидов",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "krug_dikogo_ognya",
      "label": "Круг дикого огня",
      "sourceGroup": "Круги друидов",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "krug_zvezd",
      "label": "Круг звёзд",
      "sourceGroup": "Круги друидов",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "krug_spor",
      "label": "Круг спор",
      "sourceGroup": "Круги друидов",
      "source": "bestiary/classes_bestiari_preview"
    }
  ],
  "cleric": [
    {
      "id": "domen_buri",
      "label": "Домен бури",
      "sourceGroup": "Божественные домены",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_voyny",
      "label": "Домен войны",
      "sourceGroup": "Божественные домены",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_zhizni",
      "label": "Домен жизни",
      "sourceGroup": "Божественные домены",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_znaniy",
      "label": "Домен знаний",
      "sourceGroup": "Божественные домены",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_obmana",
      "label": "Домен обмана",
      "sourceGroup": "Божественные домены",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_prirody",
      "label": "Домен природы",
      "sourceGroup": "Божественные домены",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_sveta",
      "label": "Домен света",
      "sourceGroup": "Божественные домены",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_smerti",
      "label": "Домен смерти",
      "sourceGroup": "Божественные домены",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_magii",
      "label": "Домен магии",
      "sourceGroup": "Божественные домены",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_kuzni",
      "label": "Домен кузни",
      "sourceGroup": "Божественные домены",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_upokoeniya",
      "label": "Домен упокоения",
      "sourceGroup": "Божественные домены",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_mira",
      "label": "Домен мира",
      "sourceGroup": "Божественные домены",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_poryadka",
      "label": "Домен порядка",
      "sourceGroup": "Божественные домены",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_sumerek",
      "label": "Домен сумерек",
      "sourceGroup": "Божественные домены",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "oketra_domen_splochennosti",
      "label": "Окетра: Домен сплочённости",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "ronas_domen_sily",
      "label": "Ронас: Домен силы",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "bontu_domen_ambitsiy",
      "label": "Бонту: Домен амбиций",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "hazoret_domen_rveniya",
      "label": "Хазорет: Домен рвения",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_goroda",
      "label": "Домен города",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_zaschity",
      "label": "Домен защиты",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_sudby",
      "label": "Домен судьбы",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_razuma",
      "label": "Домен разума",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_verhovnyh_vladyk",
      "label": "Домен Верховных владык",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_krovi",
      "label": "Домен крови",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_luny",
      "label": "Домен луны",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_uzhasa",
      "label": "Домен ужаса",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_inkvizitsii",
      "label": "Домен инквизиции",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_stremleniya",
      "label": "Домен стремления",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_stihiy",
      "label": "Домен стихий",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_istrebleniya",
      "label": "Домен Истребления",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_apokalipsisa",
      "label": "Домен апокалипсиса",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_goloda",
      "label": "Домен голода",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_gory",
      "label": "Домен горы",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_drakona",
      "label": "Домен дракона",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_koshki",
      "label": "Домен кошки",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_labirinta",
      "label": "Домен лабиринта",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_mehanizmov",
      "label": "Домен механизмов",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_okeana",
      "label": "Домен океана",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_ohoty",
      "label": "Домен охоты",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_piva",
      "label": "Домен пива",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_prorochestva",
      "label": "Домен пророчества",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_pustoty",
      "label": "Домен пустоты",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_puteshestviya",
      "label": "Домен путешествия",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_skorosti",
      "label": "Домен скорости",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_spravedlivosti",
      "label": "Домен справедливости",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_tmy",
      "label": "Домен тьмы",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_hranitelya",
      "label": "Домен Хранителя",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_nochi",
      "label": "Домен ночи",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "domen_obschiny",
      "label": "Домен общины",
      "sourceGroup": "Божественные домены из «Plane Shift: Amonkhet»",
      "source": "bestiary/classes_bestiari_preview"
    }
  ],
  "artificer": [
    {
      "id": "alhimik",
      "label": "Алхимик",
      "sourceGroup": "Специализации изобретателя",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "artillerist",
      "label": "Артиллерист",
      "sourceGroup": "Специализации изобретателя",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "boevoy_kuznets",
      "label": "Боевой кузнец",
      "sourceGroup": "Специализации изобретателя",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "bronnik",
      "label": "Бронник",
      "sourceGroup": "Специализации изобретателя",
      "source": "bestiary/classes_bestiari_preview"
    }
  ],
  "warlock": [
    {
      "id": "arhifeya",
      "label": "Архифея",
      "sourceGroup": "Потусторонние покровители",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "ischadie",
      "label": "Исчадие",
      "sourceGroup": "Потусторонние покровители",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "velikiy_drevniy",
      "label": "Великий Древний",
      "sourceGroup": "Потусторонние покровители",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "bessmertnyy",
      "label": "Бессмертный",
      "sourceGroup": "Потусторонние покровители",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "vedmovskoy_klinok",
      "label": "Ведьмовской клинок",
      "sourceGroup": "Потусторонние покровители",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "nebozhitel",
      "label": "Небожитель",
      "sourceGroup": "Потусторонние покровители",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "bezdonnyy",
      "label": "Бездонный",
      "sourceGroup": "Потусторонние покровители",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "geniy",
      "label": "Гений",
      "sourceGroup": "Потусторонние покровители",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "nezhit",
      "label": "Нежить",
      "sourceGroup": "Потусторонние покровители",
      "source": "bestiary/classes_bestiari_preview"
    }
  ],
  "monk": [
    {
      "id": "put_otkrytoy_ladoni",
      "label": "Путь открытой ладони",
      "sourceGroup": "МОНАШЕСКИЕ ОРДЕНЫ",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "put_teni",
      "label": "Путь тени",
      "sourceGroup": "МОНАШЕСКИЕ ОРДЕНЫ",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "put_chetyreh_stihiy",
      "label": "Путь четырёх стихий",
      "sourceGroup": "МОНАШЕСКИЕ ОРДЕНЫ",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "put_dolgoy_smerti",
      "label": "Путь долгой смерти",
      "sourceGroup": "МОНАШЕСКИЕ ОРДЕНЫ",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "put_kenseya",
      "label": "Путь кэнсэя",
      "sourceGroup": "МОНАШЕСКИЕ ОРДЕНЫ",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "put_pyanogo_mastera",
      "label": "Путь пьяного мастера",
      "sourceGroup": "МОНАШЕСКИЕ ОРДЕНЫ",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "put_solnechnoy_dushi",
      "label": "Путь солнечной души",
      "sourceGroup": "МОНАШЕСКИЕ ОРДЕНЫ",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "put_miloserdiya",
      "label": "Путь милосердия",
      "sourceGroup": "МОНАШЕСКИЕ ОРДЕНЫ",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "put_voshodyaschego_drakona",
      "label": "Путь восходящего дракона",
      "sourceGroup": "МОНАШЕСКИЕ ОРДЕНЫ",
      "source": "bestiary/classes_bestiari_preview"
    }
  ],
  "paladin": [
    {
      "id": "klyatva_predannosti",
      "label": "Клятва преданности",
      "sourceGroup": "НАРУШЕНИЕ КЛЯТВЫ",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "klyatva_drevnih",
      "label": "Клятва древних",
      "sourceGroup": "НАРУШЕНИЕ КЛЯТВЫ",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "klyatva_mesti",
      "label": "Клятва мести",
      "sourceGroup": "НАРУШЕНИЕ КЛЯТВЫ",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "klyatvoprestupnik",
      "label": "Клятвопреступник",
      "sourceGroup": "НАРУШЕНИЕ КЛЯТВЫ",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "klyatva_korony",
      "label": "Клятва короны",
      "sourceGroup": "НАРУШЕНИЕ КЛЯТВЫ",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "klyatva_iskupleniya",
      "label": "Клятва искупления",
      "sourceGroup": "НАРУШЕНИЕ КЛЯТВЫ",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "klyatva_pokoreniya",
      "label": "Клятва покорения",
      "sourceGroup": "НАРУШЕНИЕ КЛЯТВЫ",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "klyatva_slavy",
      "label": "Клятва славы",
      "sourceGroup": "НАРУШЕНИЕ КЛЯТВЫ",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "klyatva_smotriteley",
      "label": "Клятва смотрителей",
      "sourceGroup": "НАРУШЕНИЕ КЛЯТВЫ",
      "source": "bestiary/classes_bestiari_preview"
    }
  ],
  "rogue": [
    {
      "id": "vor",
      "label": "Вор",
      "sourceGroup": "Архетипы плута",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "ubiytsa",
      "label": "Убийца",
      "sourceGroup": "Архетипы плута",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "duelyant",
      "label": "Дуэлянт",
      "sourceGroup": "Архетипы плута",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "kombinator",
      "label": "Комбинатор",
      "sourceGroup": "Архетипы плута",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "skaut",
      "label": "Скаут",
      "sourceGroup": "Архетипы плута",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "syschik",
      "label": "Сыщик",
      "sourceGroup": "Архетипы плута",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "fantom",
      "label": "Фантом",
      "sourceGroup": "Архетипы плута",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "klinok_dushi",
      "label": "Клинок души",
      "sourceGroup": "Архетипы плута",
      "source": "bestiary/classes_bestiari_preview"
    }
  ],
  "ranger": [
    {
      "id": "ohotnik",
      "label": "Охотник",
      "sourceGroup": "Архетипы следопыта",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "povelitel_zverey",
      "label": "Повелитель зверей",
      "sourceGroup": "Архетипы следопыта",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "sputniki_povelitelya_zverey",
      "label": "Спутники повелителя зверей",
      "sourceGroup": "Архетипы следопыта",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "strannik_gorizonta",
      "label": "Странник горизонта",
      "sourceGroup": "Архетипы следопыта",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "sumrachnyy_ohotnik",
      "label": "Сумрачный охотник",
      "sourceGroup": "Архетипы следопыта",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "ubiytsa_chudovisch",
      "label": "Убийца чудовищ",
      "sourceGroup": "Архетипы следопыта",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "strannik_fey",
      "label": "Странник фей",
      "sourceGroup": "Архетипы следопыта",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "hranitel_roya",
      "label": "Хранитель роя",
      "sourceGroup": "Архетипы следопыта",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "naezdnik_na_dreyke",
      "label": "Наездник на дрейке",
      "sourceGroup": "Архетипы следопыта",
      "source": "bestiary/classes_bestiari_preview"
    }
  ],
  "sorcerer": [
    {
      "id": "nasledie_drakoney_krovi",
      "label": "Наследие драконьей крови",
      "sourceGroup": "Происхождения чародея",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "dikaya_magiya",
      "label": "Дикая магия",
      "sourceGroup": "Происхождения чародея",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "bozhestvennaya_dusha",
      "label": "Божественная душа",
      "sourceGroup": "Происхождения чародея",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "tenevaya_magiya",
      "label": "Теневая магия",
      "sourceGroup": "Происхождения чародея",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "shtormovoe_koldovstvo",
      "label": "Штормовое колдовство",
      "sourceGroup": "Происхождения чародея",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "aberrantnyy_razum",
      "label": "Аберрантный разум",
      "sourceGroup": "Происхождения чародея",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "zavodnaya_dusha",
      "label": "Заводная душа",
      "sourceGroup": "Происхождения чародея",
      "source": "bestiary/classes_bestiari_preview"
    },
    {
      "id": "lunnoe_charodeystvo",
      "label": "Лунное чародейство",
      "sourceGroup": "Происхождения чародея",
      "source": "bestiary/classes_bestiari_preview"
    }
  ]
};

const LSS_SUBRACE_GUIDES = {
  "human": [
    {
      "id": "human-standard",
      "label": "Обычный человек",
      "source": "bestiary/races_bestiari_preview",
      "note": "PHB базовый вариант: +1 ко всем характеристикам"
    },
    {
      "id": "human-variant",
      "label": "Вариант человека",
      "source": "lss-rules-review",
      "note": "Опциональное правило: черта + навыки, автосбор позже"
    }
  ],
  "elf": [
    {
      "id": "high-elf",
      "label": "Высший эльф",
      "source": "bestiary/races_bestiari_preview",
      "note": "+1 Интеллект, заговор волшебника"
    },
    {
      "id": "wood-elf",
      "label": "Лесной эльф",
      "source": "bestiary/races_bestiari_preview",
      "note": "+1 Мудрость, скорость 35 фт."
    },
    {
      "id": "drow",
      "label": "Тёмный эльф (дроу)",
      "aliases": [
        "Дроу"
      ],
      "source": "bestiary/races_bestiari_preview",
      "note": "+1 Харизма, магия дроу"
    }
  ],
  "dwarf": [
    {
      "id": "hill-dwarf",
      "label": "Холмовой дварф",
      "source": "lss-rules-review",
      "note": "+1 Мудрость, +1 HP за уровень"
    },
    {
      "id": "mountain-dwarf",
      "label": "Горный дварф",
      "source": "lss-rules-review",
      "note": "+2 Сила, владение лёгкой/средней бронёй"
    },
    {
      "id": "duergar",
      "label": "Дуэргар",
      "source": "bestiary/races_bestiari_preview",
      "note": "вариант из справочника, требует проверки стола"
    }
  ],
  "gnome": [
    {
      "id": "forest-gnome",
      "label": "Лесной гном",
      "source": "bestiary/races_bestiari_preview",
      "note": "+1 Ловкость, малая иллюзия"
    },
    {
      "id": "rock-gnome",
      "label": "Скальный гном",
      "source": "bestiary/races_bestiari_preview",
      "note": "+1 Телосложение, ремесленные знания"
    },
    {
      "id": "deep-gnome",
      "label": "Глубинный гном (свирфнеблин)",
      "source": "bestiary/races_bestiari_preview",
      "note": "вариант из справочника"
    }
  ],
  "halfling": [
    {
      "id": "lightfoot-halfling",
      "label": "Легконогий",
      "source": "bestiary/races_bestiari_preview",
      "note": "+1 Харизма, скрытность за существами"
    },
    {
      "id": "stout-halfling",
      "label": "Коренастый",
      "source": "bestiary/races_bestiari_preview",
      "note": "+1 Телосложение, стойкость к ядам"
    }
  ],
  "half-elf": [
    {
      "id": "half-elf-standard",
      "label": "Обычный полуэльф",
      "source": "bestiary/races_bestiari_preview",
      "note": "Харизма +2 и два других +1 на выбор"
    },
    {
      "id": "half-elf-faerun",
      "label": "Полуэльф Фаэруна (SCAG)",
      "source": "bestiary/races_bestiari_preview",
      "note": "вариант из справочника, требует проверки стола"
    }
  ],
  "tiefling": [
    {
      "id": "tiefling-standard",
      "label": "Обычный тифлинг",
      "source": "bestiary/races_bestiari_preview",
      "note": "PHB наследие, Харизма +2, Интеллект +1"
    }
  ],
  "dragonborn": [
    {
      "id": "dragonborn-standard",
      "label": "Обычный драконорождённый",
      "source": "bestiary/races_bestiari_preview",
      "note": "тип дракона лучше вынести отдельным полем позже"
    },
    {
      "id": "chromatic-dragonborn",
      "label": "Цветной драконорождённый (FTD)",
      "source": "bestiary/races_bestiari_preview",
      "note": "вариант из справочника, требует проверки стола"
    },
    {
      "id": "metallic-dragonborn",
      "label": "Металлический драконорождённый (FTD)",
      "source": "bestiary/races_bestiari_preview",
      "note": "вариант из справочника, требует проверки стола"
    },
    {
      "id": "gem-dragonborn",
      "label": "Самоцветный драконорождённый (FTD)",
      "source": "bestiary/races_bestiari_preview",
      "note": "вариант из справочника, требует проверки стола"
    }
  ],
  "half-orc": [
    {
      "id": "half-orc-standard",
      "label": "Обычный полуорк",
      "source": "bestiary/races_bestiari_preview",
      "note": "Сила +2, Телосложение +1"
    }
  ]
};


function normalizeGuideLookup(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();
}

function getRulesClassGuide(value) {
  const map = getLssRulesMap("classes");
  const lookup = getLssRulesLookup("class_by_name");
  const item = pickRulesObjectByValue(map, lookup, value);
  return rulesClassToGuide(item);
}

function getLssClassGuide(value) {
  return getRulesClassGuide(value) || getGuideFromCollection(LSS_CLASS_GUIDES, value);
}

function getRulesClassList() {
  const map = getLssRulesMap("classes");
  if (!map) return [];
  return sortLssGuideList(Object.values(map).map(rulesClassToGuide).filter(Boolean));
}

function getLssClassOptionsHtml() {
  const rulesList = getRulesClassList();
  const list = rulesList.length ? rulesList : LSS_CLASS_GUIDES;
  return list
    .map((guide) => `<option value="${escapeHtml(guide.label)}"></option>`)
    .join("");
}

function renderLssPreservedChoiceOption(selected = "", matched = false, label = "Сохранено вручную") {
  const value = String(selected || "").trim();
  if (!value || matched) return "";
  return `<option value="${escapeHtml(value)}" selected>${escapeHtml(value)} • ${escapeHtml(label)}</option>`;
}

function getLssClassSelectOptionsHtml(selected = "") {
  const rulesList = getRulesClassList();
  const list = rulesList.length ? rulesList : LSS_CLASS_GUIDES;
  const options = [`<option value="">Выбери класс</option>`];
  let matched = false;
  list.forEach((guide) => {
    const isSelected = isLssGuideValueSelected(guide, selected);
    if (isSelected) matched = true;
    options.push(`<option value="${escapeHtml(guide.label)}" ${isSelected ? "selected" : ""}>${escapeHtml(guide.label)}</option>`);
  });
  options.push(renderLssPreservedChoiceOption(selected, matched));
  return options.join("");
}

function getLssBackgroundSelectOptionsHtml(selected = "") {
  const rulesList = getRulesBackgroundList();
  const list = rulesList.length ? rulesList : LSS_BACKGROUND_GUIDES;
  const options = [`<option value="">Выбери предысторию</option>`];
  let matched = false;
  list.forEach((guide) => {
    const isSelected = isLssGuideValueSelected(guide, selected);
    if (isSelected) matched = true;
    options.push(`<option value="${escapeHtml(guide.label)}" ${isSelected ? "selected" : ""}>${escapeHtml(guide.label)}</option>`);
  });
  options.push(renderLssPreservedChoiceOption(selected, matched));
  return options.join("");
}

function getLssSubclassesForClass(className) {
  const guide = getLssClassGuide(className);
  if (!guide) return [];
  if (Array.isArray(guide.subclasses) && guide.subclasses.length) {
    return sortLssGuideList(guide.subclasses.map((item) => rulesSubclassToGuide(item, guide)).filter(Boolean));
  }
  return Array.isArray(LSS_SUBCLASS_GUIDES[guide.id]) ? LSS_SUBCLASS_GUIDES[guide.id] : [];
}

function getLssSubclassGuide(className, subclassName) {
  const raw = normalizeGuideLookup(subclassName);
  if (!raw) return null;
  return getLssSubclassesForClass(className).find((item) => {
    if (normalizeGuideLookup(item.label) === raw || normalizeGuideLookup(item.id) === raw) return true;
    return (item.aliases || []).some((alias) => normalizeGuideLookup(alias) === raw);
  }) || null;
}

function getLssSubclassOptionsHtml(className) {
  return getLssSubclassesForClass(className)
    .map((item) => `<option value="${escapeHtml(item.label)}"></option>`)
    .join("");
}

function getLssSubclassSelectOptionsHtml(className, selected = "") {
  const subclasses = getLssSubclassesForClass(className);
  const label = className ? "Подкласс не выбран" : "Сначала выбери класс";
  const options = [`<option value="">${escapeHtml(label)}</option>`];
  let matched = false;
  subclasses.forEach((item) => {
    const isSelected = isLssGuideValueSelected(item, selected);
    if (isSelected) matched = true;
    options.push(`<option value="${escapeHtml(item.label)}" ${isSelected ? "selected" : ""}>${escapeHtml(item.label)}</option>`);
  });
  options.push(renderLssPreservedChoiceOption(selected, matched));
  return options.join("");
}

function getLssSubracesForRace(raceName) {
  const guide = getLssRaceGuide(raceName);
  if (!guide) return [];
  if (Array.isArray(guide.subraces) && guide.subraces.length) {
    return sortLssGuideList(guide.subraces);
  }
  return Array.isArray(LSS_SUBRACE_GUIDES[guide.id]) ? LSS_SUBRACE_GUIDES[guide.id] : [];
}

function getLssSubraceGuide(raceName, subraceName) {
  const raw = normalizeGuideLookup(subraceName);
  if (!raw) return null;
  return getLssSubracesForRace(raceName).find((item) => {
    if (normalizeGuideLookup(item.label) === raw || normalizeGuideLookup(item.id) === raw) return true;
    return (item.aliases || []).some((alias) => normalizeGuideLookup(alias) === raw);
  }) || null;
}

function getLssSubraceOptionsHtml(raceName) {
  return getLssSubracesForRace(raceName)
    .map((item) => `<option value="${escapeHtml(item.label)}"></option>`)
    .join("");
}

function getLssSubraceSelectOptionsHtml(raceName, selected = "") {
  const subraces = getLssSubracesForRace(raceName);
  const label = raceName ? "Подраса не выбрана" : "Сначала выбери расу";
  const options = [`<option value="">${escapeHtml(label)}</option>`];
  let matched = false;
  subraces.forEach((item) => {
    const isSelected = isLssGuideValueSelected(item, selected);
    if (isSelected) matched = true;
    options.push(`<option value="${escapeHtml(item.label)}" ${isSelected ? "selected" : ""}>${escapeHtml(item.label)}</option>`);
  });
  options.push(renderLssPreservedChoiceOption(selected, matched));
  return options.join("");
}

function getLssSourceLabel(source) {
  const raw = String(source || "").toLowerCase();
  if (raw.includes("lss_constructor_rules")) return "LSS rules JSON";
  if (raw.includes("dnd.su/class") || raw.includes("bestiary/classes")) return "Бестиарий: классы";
  if (raw.includes("dnd.su/race") || raw.includes("bestiary/races")) return "Бестиарий: расы";
  if (raw.includes("dnd.su/background") || raw.includes("background")) return "Бестиарий: предыстории";
  if (raw.includes("lss-rules")) return "LSS rules review";
  return source ? String(source) : "локальный справочник LSS";
}

function renderLssChoiceHint(title, item, fallback = "") {
  if (!item && !fallback) return "";
  const text = item?.note || item?.sourceGroup || fallback;
  const source = item?.source ? ` • ${getLssSourceLabel(item.source)}` : "";
  return `
    <div class="meta-item" style="white-space:normal; justify-content:flex-start; margin-top:6px; font-size:.78rem;">
      <strong>${escapeHtml(title)}:</strong>&nbsp;${escapeHtml(text || "выбрано вручную")}${escapeHtml(source)}
    </div>
  `;
}

function renderLssSubclassHint(className, subclassName, level = 1) {
  const guide = getLssClassGuide(className);
  if (!guide) return renderLssChoiceHint("Подкласс", null, "сначала выбери класс");
  const unlock = getSubclassUnlockLevel(guide.id);
  const current = Math.max(1, toNumber(level, 1));
  const item = getLssSubclassGuide(className, subclassName);
  const status = current >= unlock ? `доступен с ${unlock} уровня` : `откроется на ${unlock} уровне`;
  if (item) return renderLssChoiceHint("Подкласс", item, status);
  return renderLssChoiceHint("Подкласс", null, `${status}; можно оставить пустым или вписать свой вариант стола`);
}

function renderLssSubraceHint(raceName, subraceName) {
  const raceGuide = getLssRaceGuide(raceName);
  if (!raceGuide) return renderLssChoiceHint("Подраса", null, "сначала выбери расу");
  const item = getLssSubraceGuide(raceName, subraceName);
  if (item) return renderLssChoiceHint("Подраса", item, "подраса выбрана");
  const count = getLssSubracesForRace(raceName).length;
  return renderLssChoiceHint("Подраса", null, count ? `есть ${count} вариантов из справочника; можно выбрать позже` : "для этой расы подраса не обязательна");
}

function getProficiencyBonusByLevel(level) {
  const lvl = Math.max(1, Math.min(20, toNumber(level, 1)));
  return 2 + Math.floor((lvl - 1) / 4);
}

function formatStatList(keys = []) {
  return keys.map((key) => STAT_LABELS[key] || String(key || "").toUpperCase()).join(", ");
}

function formatSkillList(keys = []) {
  return (keys || []).map((key) => SKILL_LABELS[key] || capitalizeRu(key)).join(", ");
}

function getSubclassUnlockLevel(classId) {
  const guide = getLssClassGuide(classId);
  if (guide?.subclassChoiceLevel) return guide.subclassChoiceLevel;
  const levels = {
    cleric: 1,
    sorcerer: 1,
    warlock: 1,
    wizard: 2,
    druid: 2,
    bard: 3,
    barbarian: 3,
    fighter: 3,
    monk: 3,
    paladin: 3,
    ranger: 3,
    rogue: 3,
    artificer: 3,
  };
  return levels[classId] || 3;
}

function getSubclassHint(className, level = 1) {
  const guide = getLssClassGuide(className);
  if (!guide) return "выбери класс, чтобы понять, когда открывается подкласс";
  const unlock = getSubclassUnlockLevel(guide.id);
  const current = Math.max(1, toNumber(level, 1));
  if (current >= unlock) return `подкласс уже доступен: выбери архетип/домен/школу по ${unlock} уровню`;
  return `подкласс откроется на ${unlock} уровне`;
}

function readLssChoiceControlValue(id, fallback = "") {
  const el = getSection(id);
  const rawValue = String(el?.value || "").trim();
  if (rawValue) return rawValue;

  // На случай старых select/input состояний: если value пустой, но выбранная опция не placeholder,
  // берём видимый текст. Это защищает панели источников от "выбери расу" при уже выбранном значении.
  if (el?.tagName === "SELECT") {
    const opt = el.selectedOptions?.[0];
    const text = String(opt?.textContent || "").replace(/•\s*сохранено вручную/i, "").trim();
    const placeholder = /^(выбери|сначала|подкласс не выбран|подраса не выбрана|предыстория не выбрана)/i;
    if (text && !placeholder.test(text)) return text;
  }

  return String(fallback || "").trim();
}

function getLssChoiceControlIds(mode = "quick") {
  const isEdit = mode === "edit";
  return {
    className: isEdit ? "lssEdit_charClass" : "lssQuickCreateClass",
    subclassName: isEdit ? "lssEdit_charSubclass" : "lssQuickCreateSubclass",
    raceName: isEdit ? "lssEdit_race" : "lssQuickCreateRace",
    subraceName: isEdit ? "lssEdit_subrace" : "lssQuickCreateSubrace",
    backgroundName: isEdit ? "lssEdit_background" : "lssQuickCreateBackground",
  };
}

function syncLssChoiceSnapshot(mode = "quick") {
  const ids = getLssChoiceControlIds(mode);
  const snapshot = {};
  Object.entries(ids).forEach(([key, id]) => {
    snapshot[key] = readLssChoiceControlValue(id, "");
  });
  if (mode === "edit") LSS_STATE.editChoiceSnapshot = snapshot;
  else LSS_STATE.quickChoiceSnapshot = snapshot;
  return snapshot;
}

function getFormSelectionContext(mode = "quick") {
  const isEdit = mode === "edit";
  const info = LSS_STATE.profile?.info || {};
  const snapshot = mode === "edit" ? (LSS_STATE.editChoiceSnapshot || {}) : (LSS_STATE.quickChoiceSnapshot || {});
  const ids = getLssChoiceControlIds(mode);
  return {
    mode,
    className: readLssChoiceControlValue(ids.className, snapshot.className || unwrapValue(info.charClass, "")),
    subclassName: readLssChoiceControlValue(ids.subclassName, snapshot.subclassName || unwrapValue(info.charSubclass, "")),
    raceName: readLssChoiceControlValue(ids.raceName, snapshot.raceName || unwrapValue(info.race, "")),
    subraceName: readLssChoiceControlValue(ids.subraceName, snapshot.subraceName || unwrapValue(info.subrace, "")),
    backgroundName: readLssChoiceControlValue(ids.backgroundName, snapshot.backgroundName || unwrapValue(info.background, "")),
  };
}

function getSelectedMechanicsGuides(mode = "quick") {
  const ctx = getFormSelectionContext(mode);
  return {
    ...ctx,
    classGuide: getLssClassGuide(ctx.className),
    subclassGuide: getLssSubclassGuide(ctx.className, ctx.subclassName),
    raceGuide: getLssRaceGuide(ctx.raceName),
    subraceGuide: getLssSubraceGuide(ctx.raceName, ctx.subraceName),
    backgroundGuide: getLssBackgroundGuide(ctx.backgroundName),
  };
}

function getCurrentSourceAbilityBonuses(mode = "quick") {
  const guides = getSelectedMechanicsGuides(mode);
  return mergeAbilityBonusMaps(
    getGuideAbilityBonuses(guides.raceGuide),
    getGuideAbilityBonuses(guides.subraceGuide),
    getGuideAbilityBonuses(guides.backgroundGuide),
    getGuideAbilityBonuses(guides.subclassGuide)
  );
}

function getSourceBonusKey(mode = "quick") {
  const guides = getSelectedMechanicsGuides(mode);
  const bonuses = getCurrentSourceAbilityBonuses(mode);
  return [guides.raceName, guides.subraceName, guides.backgroundName, guides.subclassName, JSON.stringify(bonuses)].join("|");
}

const LSS_GRANT_TYPE_LABELS = {
  ability_bonus: "Характеристика",
  ability_bonus_choice: "Характеристика на выбор",
  skill_proficiency: "Навык",
  saving_throw_proficiency: "Спасбросок",
  armor_proficiency: "Броня",
  weapon_proficiency: "Оружие",
  tool_proficiency: "Инструмент",
  language: "Язык",
  hit_die: "Кость хитов",
  spellcasting: "Заклинания",
  size: "Размер",
  speed: "Скорость",
  movement: "Передвижение",
  background_feature: "Особенность",
  equipment_raw: "Снаряжение",
  class_feature: "Фича класса",
  subclass_feature: "Фича подкласса",
  spell_grant: "Заклинание",
  feat_rule: "Черта",
};

const LSS_DIRECT_MECHANICAL_GRANT_TYPES = new Set([
  "ability_bonus",
  "ability_bonus_choice",
  "skill_proficiency",
  "saving_throw_proficiency",
  "armor_proficiency",
  "weapon_proficiency",
  "tool_proficiency",
  "language",
  "hit_die",
  "spellcasting",
  "size",
  "speed",
  "movement",
  "background_feature",
  "equipment_raw",
  "class_feature",
  "subclass_feature",
  "spell_grant",
  "feat_rule",
]);

const LSS_LORE_ONLY_HINT_RE = /(сходство|идея владения|блестящ|заключение пугает|возраст|мировоззрение|характер|имена|рост|вес|внешн|обыча|культура|общество|описание|происхождени[ея])/i;
const LSS_MECHANICAL_TEXT_HINT_RE = /(увелич|\+\s*\d|скорост|летать|пол[её]т|плаван|лазань|т[её]мное зрение|видение|сопротив|владе|владение|урон|атака|заклин|сотвор|наклады|спасброс|преимуществ|помех|действие|бонусным действием|реакци|язык|навык|инструмент|доспех|оруж|размер|класс доспеха|кб|хит|исцел|состояни)/i;

function getGuideSourceGrants(guide) {
  if (!guide) return [];
  const raw = guide.raw || {};
  return normalizeArray([
    ...normalizeArray(guide.sourceGrants),
    ...normalizeArray(raw.source_grants),
    ...normalizeArray(raw.grants),
  ]);
}

function lssGrantLooksMechanical(grant) {
  if (!grant) return false;
  const type = String(grant.type || "").trim();
  if (LSS_DIRECT_MECHANICAL_GRANT_TYPES.has(type) && type !== "feature") return true;
  const name = String(grant.name || "").trim();
  const raw = String(grant.raw || grant.text || grant.text_preview || "").trim();
  const confidence = String(grant.confidence || "").toLowerCase();
  const kind = String(grant.kind || "").toLowerCase();
  if (type === "feature") {
    if (["age", "alignment", "personality", "lore", "description", "culture"].includes(kind)) return false;
    if (/^у вас, как/i.test(name)) return false;
    if (LSS_LORE_ONLY_HINT_RE.test(name) && !LSS_MECHANICAL_TEXT_HINT_RE.test(raw)) return false;
    return LSS_MECHANICAL_TEXT_HINT_RE.test(`${name} ${raw}`) || confidence === "structured";
  }
  return LSS_MECHANICAL_TEXT_HINT_RE.test(`${name} ${raw}`);
}

function lssGrantReviewHint(grant) {
  const flags = normalizeArray(grant?.review_flags || grant?.flags);
  const confidence = String(grant?.confidence || grant?.candidate_confidence || "");
  if (flags.length || /review|candidate|low/i.test(confidence)) return " ⚠";
  return "";
}

function formatLssGrantLabel(grant) {
  if (!grant) return "";
  const type = String(grant.type || "feature");
  const name = String(grant.name || grant.value || grant.raw || "").trim();
  const value = grant.value ?? grant.raw ?? "";
  if (type === "ability_bonus") {
    const stat = STAT_LABELS[grant.ability] || String(grant.ability || "Характеристика").toUpperCase();
    const bonus = Number(grant.value || 0);
    return `${stat} ${bonus >= 0 ? "+" : ""}${bonus}${lssGrantReviewHint(grant)}`;
  }
  if (type === "ability_bonus_choice") return `+${escapeHtml(String(grant.value || 1))} к характеристике на выбор${lssGrantReviewHint(grant)}`;
  if (type === "size") return `Размер: ${normalizeSize(value || "medium")}${lssGrantReviewHint(grant)}`;
  if (type === "speed") return `Скорость: ${grant.walk_ft || grant.value || value || "—"} фт.${lssGrantReviewHint(grant)}`;
  if (type === "movement") return `${name || "Передвижение"}${lssGrantReviewHint(grant)}`;
  if (type === "saving_throw_proficiency") return `Спасбросок: ${STAT_LABELS[grant.ability] || name || value}${lssGrantReviewHint(grant)}`;
  if (type === "skill_proficiency") return `Навык: ${SKILL_LABELS[normalizeSkillKeyFromAny(value || name)] || name || value}${lssGrantReviewHint(grant)}`;
  if (type === "armor_proficiency") return `Броня: ${name || value}${lssGrantReviewHint(grant)}`;
  if (type === "weapon_proficiency") return `Оружие: ${name || value}${lssGrantReviewHint(grant)}`;
  if (type === "tool_proficiency") return `Инструмент: ${name || value}${lssGrantReviewHint(grant)}`;
  if (type === "language") {
    const text = String(name || value || "").trim();
    const normalized = normalizeGuideLookup(text);
    if (!text || normalized === "языки" || normalized === "язык" || normalized.includes("выберите")) {
      return `Язык: требуется выбор${lssGrantReviewHint(grant)}`;
    }
    return `Язык: ${text}${lssGrantReviewHint(grant)}`;
  }
  if (type === "hit_die") return `Кость хитов: ${name === "Кость хитов" ? value : (value || name)}${lssGrantReviewHint(grant)}`;
  if (type === "spellcasting") return `Заклинания: ${STAT_LABELS[grant.ability] || grant.ability || name || "есть"}${lssGrantReviewHint(grant)}`;
  if (type === "background_feature") return `Особенность: ${name || "предыстории"}${lssGrantReviewHint(grant)}`;
  if (type === "equipment_raw") return `Снаряжение: ${String(value || name).slice(0, 80)}${String(value || name).length > 80 ? "…" : ""}${lssGrantReviewHint(grant)}`;
  if (type === "class_feature" || type === "subclass_feature") return `${name || LSS_GRANT_TYPE_LABELS[type]}${lssGrantReviewHint(grant)}`;
  if (type === "spell_grant") return `Заклинание: ${name || value}${lssGrantReviewHint(grant)}`;
  if (type === "feat_rule") return `${name || "Правило черты"}${lssGrantReviewHint(grant)}`;
  return `${name || LSS_GRANT_TYPE_LABELS[type] || type}${lssGrantReviewHint(grant)}`;
}

function getLssMechanicalGrants(guide, options = {}) {
  const limit = options.limit || 16;
  const includeReviewCandidates = Boolean(options.includeReviewCandidates);
  const grants = getGuideSourceGrants(guide)
    .filter((grant) => lssGrantLooksMechanical(grant))
    .filter((grant) => includeReviewCandidates || !/low_order_based_review/i.test(String(grant.candidate_confidence || "")) || grant.type === "ability_bonus");
  const seen = new Set();
  const list = [];
  grants.forEach((grant) => {
    const label = formatLssGrantLabel(grant);
    const key = normalizeGuideLookup(String(label).replace(/\s*⚠\s*$/g, ""));
    if (!label || seen.has(key)) return;
    seen.add(key);
    list.push({ ...grant, label });
  });
  return list.slice(0, limit);
}

function getLssReviewGrantCount(guide) {
  return getGuideSourceGrants(guide).filter((grant) => {
    const flags = normalizeArray(grant?.review_flags || grant?.flags);
    const confidence = String(grant?.confidence || grant?.candidate_confidence || "").toLowerCase();
    return flags.length || confidence.includes("review") || confidence.includes("candidate") || confidence.includes("low");
  }).length;
}

function renderLssGrantBadges(guide, empty = "механика не распознана", options = {}) {
  const list = getLssMechanicalGrants(guide, options);
  if (!list.length) {
    const reviewCount = getLssReviewGrantCount(guide);
    const suffix = reviewCount ? ` • ${reviewCount} спорн. в audit` : "";
    return `<span class="muted">${escapeHtml(empty + suffix)}</span>`;
  }
  return list.map((grant) => `<span class="meta-item" title="${escapeHtml(grant.raw || grant.text_preview || grant.name || "")}" style="white-space:normal; justify-content:flex-start; align-items:flex-start;">${escapeHtml(grant.label)}</span>`).join("");
}

function renderLssSourceGrantCard(title, guide, empty, options = {}) {
  const label = guide?.label || options.fallbackLabel || "—";
  const reviewCount = getLssReviewGrantCount(guide);
  const reviewBadge = reviewCount ? `<span class="muted" style="font-size:11px;">${reviewCount} review</span>` : "";
  return `
    <div class="meta-item" style="white-space:normal; display:block; padding:9px 10px; border-radius:13px;">
      <div style="display:flex; justify-content:space-between; gap:8px; align-items:center; margin-bottom:6px;"><strong>${escapeHtml(title)}:</strong><span class="muted" style="font-size:11px;">${escapeHtml(label)}</span>${reviewBadge}</div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">${renderLssGrantBadges(guide, empty, options)}</div>
    </div>
  `;
}

function renderLssSourceBonusesPanel(mode = "quick") {
  const guides = getSelectedMechanicsGuides(mode);
  const bonuses = getCurrentSourceAbilityBonuses(mode);
  const bonusText = hasAbilityBonuses(bonuses) ? formatStatBonusMap(bonuses) : "нет безопасных структурных бонусов";
  return `
    <div id="${mode === "edit" ? "lssEditSourceBonuses" : "lssQuickSourceBonuses"}" class="lss-source-bonus-panel" style="margin:10px 0 12px; padding:12px; border:1px solid rgba(117,203,198,.18); border-radius:16px; background:rgba(5,12,18,.34);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
        <div>
          <div style="font-weight:900; color:var(--gold, #d6b36a);">Что даёт выбор</div>
          <div class="muted" style="font-size:12px;">LSS показывает только механические grants из compact rules JSON. Лор и сомнительные куски остаются в Бестиарии/audit.</div>
        </div>
        <div class="meta-item" style="white-space:normal; justify-content:flex-start;"><strong>Статы:</strong>&nbsp;${escapeHtml(bonusText)}</div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:8px;">
        ${renderLssSourceGrantCard("Класс", guides.classGuide, "выбери класс")}
        ${renderLssSourceGrantCard("Подкласс", guides.subclassGuide, guides.subclassGuide ? "фичи подкласса пока только текстом" : "выбери подкласс или дождись уровня выбора", { fallbackLabel: getSubclassHint(guides.className, getLssFormLevel(mode)) })}
        ${renderLssSourceGrantCard("Раса", guides.raceGuide, "выбери расу")}
        ${renderLssSourceGrantCard("Подраса", guides.subraceGuide, guides.subraceGuide ? "для варианта нет безопасной механики" : "если у расы есть варианты — выбери")}
        ${renderLssSourceGrantCard("Предыстория", guides.backgroundGuide, "выбери предысторию")}
      </div>
      ${mode === "quick" ? `<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-top:10px;"><button class="btn btn-secondary" type="button" id="lssQuickApplySourceBonusesBtn" ${hasAbilityBonuses(bonuses) ? "" : "disabled"}>＋ Применить бонусы к статам</button><span class="muted" style="font-size:12px;">Автоприменение выключено: сначала показываем источник, затем применяем по кнопке.</span></div>` : `<div class="muted" style="font-size:12px; margin-top:8px;">В редакторе источники показываются без автоприменения, чтобы не задвоить импортированные листы.</div>`}
    </div>
  `;
}

function refreshLssSourceBonusesPanel(mode = "quick") {
  const id = mode === "edit" ? "lssEditSourceBonuses" : "lssQuickSourceBonuses";
  const panel = getSection(id);
  if (!panel) return;
  const temp = document.createElement("div");
  temp.innerHTML = renderLssSourceBonusesPanel(mode).trim();
  const next = temp.firstElementChild;
  if (next) panel.replaceWith(next);
  bindLssConstructorRuleButtons();
  refreshLssRulesProgressionPanel(mode);
}

function getLssFormLevel(mode = "quick") {
  const input = getSection(mode === "edit" ? "lssEdit_level" : "lssQuickCreateLevel");
  const fallback = unwrapValue(LSS_STATE.profile?.info?.level, 1);
  return Math.max(1, Math.min(20, toNumber(input?.value || fallback, 1)));
}

function getLssRuleSourcePath(key = "spells_preview") {
  const rules = getLssRules();
  const sources = rules?.sources || {};
  return sources?.[key] || "lss_constructor_rules.json";
}

function getLssRulesSpellsMap() {
  const map = getLssRulesMap("spells");
  return map && typeof map === "object" ? map : {};
}

function normalizeSpellLevelValue(value) {
  if (value === 0 || value === "0") return 0;
  const raw = String(value ?? "").toLowerCase().trim();
  if (!raw) return null;
  if (raw.includes("заговор") || raw.includes("cantrip") || raw.includes("фокус")) return 0;
  const n = toNumber(raw, null);
  return Number.isFinite(n) ? Math.max(0, Math.min(9, n)) : null;
}

function getSpellMaxLevelForClass(classGuide, level = 1) {
  if (!classGuide?.spellcasting) return -1;
  const lvl = Math.max(1, Math.min(20, toNumber(level, 1)));
  const type = String(classGuide.spellType || classGuide.raw?.spellcasting?.type || "").toLowerCase();
  const id = String(classGuide.id || classGuide.raw?.id || "").toLowerCase();

  if (id === "paladin" || id === "ranger" || type.includes("полузаклин") || type.includes("half")) {
    if (lvl < 2) return 0;
    if (lvl < 5) return 1;
    if (lvl < 9) return 2;
    if (lvl < 13) return 3;
    if (lvl < 17) return 4;
    return 5;
  }

  if (id === "artificer") {
    if (lvl < 5) return 1;
    if (lvl < 9) return 2;
    if (lvl < 13) return 3;
    if (lvl < 17) return 4;
    return 5;
  }

  if (id === "warlock" || type.includes("договор") || type.includes("pact")) {
    if (lvl < 3) return 1;
    if (lvl < 5) return 2;
    if (lvl < 7) return 3;
    if (lvl < 9) return 4;
    return 5;
  }

  return Math.max(1, Math.min(9, Math.ceil(lvl / 2)));
}

function spellMatchesClass(spell, classGuide) {
  if (!spell || !classGuide) return false;
  const classNames = [classGuide.id, classGuide.label, classGuide.raw?.ru_name, classGuide.raw?.en_name]
    .filter(Boolean)
    .map(normalizeGuideLookup);
  const classes = normalizeArray(spell.classes || spell.class_names || spell.raw?.classes || []);
  return classes.some((item) => classNames.includes(normalizeGuideLookup(item)));
}

function getLssKnownClassSpells(classGuide, level = 1, limit = 16) {
  if (!classGuide?.spellcasting) return [];
  const spellsMap = getLssRulesSpellsMap();
  const maxSpellLevel = getSpellMaxLevelForClass(classGuide, level);
  const links = Array.isArray(classGuide.raw?.spell_links) ? classGuide.raw.spell_links : [];
  const linked = links
    .map((link) => spellsMap?.[link.spell_id] || null)
    .filter(Boolean);

  let list = linked.length ? linked : Object.values(spellsMap).filter((spell) => spellMatchesClass(spell, classGuide));
  list = list.filter((spell) => {
    const spellLevel = normalizeSpellLevelValue(spell.level);
    if (spellLevel === null) return true;
    return spellLevel === 0 || spellLevel <= maxSpellLevel;
  });

  const seen = new Set();
  return list
    .filter((spell) => {
      const key = spell.id || spell.ru_name || spell.en_name;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const la = normalizeSpellLevelValue(a.level) ?? 99;
      const lb = normalizeSpellLevelValue(b.level) ?? 99;
      if (la !== lb) return la - lb;
      return String(a.ru_name || a.en_name || a.id || "").localeCompare(String(b.ru_name || b.en_name || b.id || ""), "ru");
    })
    .slice(0, limit);
}

function formatLssSpellLevel(value) {
  const lvl = normalizeSpellLevelValue(value);
  if (lvl === 0) return "заговор";
  if (lvl === null) return "?";
  return `${lvl} круг`;
}

function getFeatureTextList(row) {
  if (!row) return [];
  if (Array.isArray(row.features) && row.features.length) return row.features.map((item) => String(item || "").trim()).filter(Boolean);
  if (row.features_raw) return splitTextToBadges(row.features_raw, 8);
  return [];
}

function splitTextToBadges(value, limit = 8) {
  const raw = String(value || "").trim();
  if (!raw || raw === "—" || raw === "-") return [];
  return raw
    .split(/[,;•]+/)
    .map((item) => item.trim().replace(/[.]+$/, ""))
    .filter(Boolean)
    .slice(0, limit);
}

function renderLssMiniBadges(items = [], empty = "—", options = {}) {
  const list = normalizeArray(items).slice(0, options.limit || 10);
  if (!list.length) return `<span class="muted">${escapeHtml(empty)}</span>`;
  return list.map((item) => `<span class="meta-item" style="white-space:normal; justify-content:flex-start; align-items:flex-start;">${escapeHtml(String(item))}</span>`).join("");
}

function getClassFeaturesUpToLevel(classGuide, level = 1) {
  const progression = classGuide?.progressionByLevel || classGuide?.raw?.progression_by_level || {};
  const lvl = Math.max(1, Math.min(20, toNumber(level, 1)));
  const rows = [];
  for (let i = 1; i <= lvl; i += 1) {
    const row = progression[String(i)] || progression[i];
    const features = getFeatureTextList(row);
    if (features.length) rows.push({ level: i, features, row });
  }
  return rows;
}

function getCurrentClassLevelFeatures(classGuide, level = 1) {
  const progression = classGuide?.progressionByLevel || classGuide?.raw?.progression_by_level || {};
  const row = progression[String(Math.max(1, Math.min(20, toNumber(level, 1))))];
  return getFeatureTextList(row);
}

function getNextClassLevelFeatures(classGuide, level = 1) {
  const nextLevel = Math.min(20, Math.max(1, toNumber(level, 1)) + 1);
  if (nextLevel === Math.max(1, toNumber(level, 1))) return [];
  const progression = classGuide?.progressionByLevel || classGuide?.raw?.progression_by_level || {};
  return getFeatureTextList(progression[String(nextLevel)]);
}

function getSubclassFeaturesUpToLevel(subclassGuide, level = 1) {
  const featuresByLevel = subclassGuide?.featuresByLevel || subclassGuide?.raw?.features_by_level || {};
  const lvl = Math.max(1, Math.min(20, toNumber(level, 1)));
  const rows = [];
  Object.entries(featuresByLevel || {}).forEach(([levelKey, features]) => {
    const featureLevel = toNumber(levelKey, null);
    if (!Number.isFinite(featureLevel) || featureLevel > lvl) return;
    const list = Array.isArray(features)
      ? features.map((feat) => feat?.name || feat?.text_preview || feat?.id || feat).filter(Boolean).slice(0, 8)
      : splitTextToBadges(features, 8);
    if (list.length) rows.push({ level: featureLevel, features: list });
  });
  return rows.sort((a, b) => a.level - b.level);
}

function formatLssProgressionRows(rows = [], empty = "пока нет структурных данных") {
  if (!rows.length) return `<div class="muted" style="font-size:12px;">${escapeHtml(empty)}</div>`;
  return rows.slice(-6).map((row) => `
    <div class="meta-item" style="white-space:normal; display:block; padding:8px 10px; border-radius:12px;">
      <strong>${escapeHtml(String(row.level))} ур.:</strong>
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">${renderLssMiniBadges(row.features, "—", { limit: 8 })}</div>
    </div>
  `).join("");
}

function renderLssRulesProgressionPanel(mode = "quick") {
  const guides = getSelectedMechanicsGuides(mode);
  const level = getLssFormLevel(mode);
  const classRows = getClassFeaturesUpToLevel(guides.classGuide, level);
  const currentFeatures = getCurrentClassLevelFeatures(guides.classGuide, level);
  const nextFeatures = getNextClassLevelFeatures(guides.classGuide, level);
  const subclassRows = getSubclassFeaturesUpToLevel(guides.subclassGuide, level);
  const backgroundSkills = guides.backgroundGuide?.skills?.map((skill) => SKILL_LABELS[skill] || skill) || [];
  const backgroundFeature = guides.backgroundGuide?.feature && guides.backgroundGuide.feature !== "—" ? guides.backgroundGuide.feature : "черта/особенность предыстории в Бестиарии";
  const spells = getLssKnownClassSpells(guides.classGuide, level, 14);
  const maxSpellLevel = getSpellMaxLevelForClass(guides.classGuide, level);
  const spellSource = getLssRuleSourcePath("spells_preview");
  const classSpellLinks = toNumber(guides.classGuide?.spellRefCount, guides.classGuide?.raw?.spell_links?.length || 0);

  const spellBlock = guides.classGuide?.spellcasting
    ? `
      <div class="meta-item" style="white-space:normal; display:block; padding:8px 10px; border-radius:12px;">
        <strong>База:</strong> ${escapeHtml(STAT_LABELS[guides.classGuide.spellAbility] || guides.classGuide.spellAbility || "—")} • максимум сейчас: ${maxSpellLevel <= 0 ? "заговоры/особое" : escapeHtml(`${maxSpellLevel} круг`)}
        <div class="muted" style="font-size:12px; margin-top:4px;">Доступно по списку класса: ${escapeHtml(String(classSpellLinks))} ссылок. Показаны заговоры и круги до текущего уровня.</div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:7px;">
          ${spells.length ? spells.map((spell) => `<span class="meta-item" style="white-space:normal;">${escapeHtml(spell.ru_name || spell.en_name || spell.id)} <span class="muted">${escapeHtml(formatLssSpellLevel(spell.level))}</span></span>`).join("") : `<span class="muted">список заклинаний пока не найден в rules.spells/class.spell_links</span>`}
        </div>
      </div>
    `
    : `<div class="muted" style="font-size:12px;">У выбранного класса нет базового заклинательства. Заклинания могут появиться от подкласса, расы, предметов или фитов позже.</div>`;

  return `
    <div id="${mode === "edit" ? "lssEditProgressionPanel" : "lssQuickProgressionPanel"}" class="lss-progression-panel" style="margin:10px 0 12px; padding:12px; border:1px solid rgba(199,162,91,.20); border-radius:16px; background:linear-gradient(135deg, rgba(6,17,25,.68), rgba(9,23,31,.40));">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <div>
          <div style="font-weight:900; color:var(--gold,#d6b36a);">Уровень, источники и заклинания</div>
          <div class="muted" style="font-size:12px;">Смотрит на класс/уровень/расу/подрасу/предысторию и показывает, что уже должно быть на листе.</div>
        </div>
        <div class="meta-item"><strong>${escapeHtml(String(level))}</strong>&nbsp;уровень</div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:10px;">
        <div style="display:grid; gap:7px; align-content:start;">
          <div style="font-weight:900;">Класс по уровням</div>
          <div class="meta-item" style="white-space:normal; display:block; padding:8px 10px; border-radius:12px;"><strong>Текущий уровень:</strong><div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">${renderLssMiniBadges(currentFeatures, "на этом уровне в JSON нет отдельной строки")}</div></div>
          <div class="meta-item" style="white-space:normal; display:block; padding:8px 10px; border-radius:12px;"><strong>Следующий уровень:</strong><div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">${renderLssMiniBadges(nextFeatures, "дальше данных нет или 20 уровень")}</div></div>
          <details>
            <summary class="muted" style="cursor:pointer; font-size:12px;">Показать полученное до текущего уровня</summary>
            <div style="display:grid; gap:7px; margin-top:7px;">${formatLssProgressionRows(classRows)}</div>
          </details>
        </div>
        <div style="display:grid; gap:7px; align-content:start;">
          <div style="font-weight:900;">Источники персонажа</div>
          <div class="meta-item" style="white-space:normal; display:block; padding:8px 10px; border-radius:12px;"><strong>Подкласс:</strong> ${escapeHtml(guides.subclassGuide?.label || getSubclassHint(guides.className, level))}<div style="display:grid; gap:6px; margin-top:7px;">${formatLssProgressionRows(subclassRows, "выбери подкласс или дождись уровня выбора")}</div></div>
          ${renderLssSourceGrantCard("Раса", guides.raceGuide, "выбери расу", { limit: 8 })}
          ${renderLssSourceGrantCard("Подраса", guides.subraceGuide, guides.subraceGuide ? "нет безопасной механики" : "не выбрана", { limit: 8 })}
          <div class="meta-item" style="white-space:normal; display:block; padding:8px 10px; border-radius:12px;"><strong>Предыстория:</strong> ${escapeHtml(guides.backgroundGuide?.label || "—")} • ${escapeHtml(backgroundFeature)}<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">${renderLssGrantBadges(guides.backgroundGuide, backgroundSkills.length ? "" : "навыки/фичи не распознаны", { limit: 8 })}</div></div>
        </div>
        <div style="display:grid; gap:7px; align-content:start;">
          <div style="font-weight:900;">Заклинания</div>
          ${spellBlock}
        </div>
      </div>
    </div>
  `;
}

function refreshLssRulesProgressionPanel(mode = "quick") {
  const id = mode === "edit" ? "lssEditProgressionPanel" : "lssQuickProgressionPanel";
  const panel = getSection(id);
  if (!panel) return;
  const temp = document.createElement("div");
  temp.innerHTML = renderLssRulesProgressionPanel(mode).trim();
  const next = temp.firstElementChild;
  if (next) panel.replaceWith(next);
}

function getProgressionRowForLevel(classGuide, level) {
  const lvl = String(clampNumber(level, 1, 20, 1));
  return classGuide?.progressionByLevel?.[lvl] || classGuide?.raw?.progression_by_level?.[lvl] || null;
}

function getProgressionFeatureText(row) {
  if (!row || typeof row !== "object") return "";
  return String(row["Умения"] || row.features_raw || row.features || row.abilities || "");
}

function rowHasAsiOpportunity(row) {
  const text = normalizeGuideLookup(getProgressionFeatureText(row));
  return Boolean(text && (text.includes("увеличение характеристик") || text.includes("повышение характеристик") || text.includes("ability score improvement")));
}

function getAsiMilestoneLevels(classGuide) {
  const rows = classGuide?.progressionByLevel || classGuide?.raw?.progression_by_level || {};
  const levels = Object.entries(rows || {})
    .filter(([, row]) => rowHasAsiOpportunity(row))
    .map(([level]) => toNumber(level, null))
    .filter((level) => Number.isFinite(level))
    .sort((a, b) => a - b);
  if (levels.length) return levels;
  return [4, 8, 12, 16, 19];
}

function getCurrentAsiContext(mode = "quick") {
  const isEdit = mode === "edit";
  const ctx = getFormSelectionContext(mode);
  const fallbackLevel = unwrapValue(LSS_STATE.profile?.info?.level, 1);
  const levelValue = getSection(isEdit ? "lssEdit_level" : "lssQuickCreateLevel")?.value || fallbackLevel;
  const level = clampNumber(levelValue, 1, 20, 1);
  const className = ctx.className || unwrapValue(LSS_STATE.profile?.info?.charClass, "");
  const classGuide = getLssClassGuide(className);
  const currentRow = getProgressionRowForLevel(classGuide, level);
  const milestones = getAsiMilestoneLevels(classGuide);
  const available = rowHasAsiOpportunity(currentRow);
  const nextLevel = milestones.find((lvl) => lvl > level) || null;
  return { className, level, classGuide, currentRow, milestones, available, nextLevel };
}

function getStatSelectOptionsHtml(selected = "") {
  return STAT_DEFS.map(({ key, label }) => `<option value="${escapeHtml(key)}" ${key === selected ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function formatFeatAbilityIncreases(feat) {
  const parts = [];
  (feat?.abilityIncreases || []).forEach((inc) => {
    const amount = toNumber(inc.amount, 0);
    const abilities = normalizeArray(inc.abilities).map((key) => STAT_LABELS[key] || key).join(" / ");
    if (amount && abilities) parts.push(`${abilities} +${amount}`);
    else if (inc.text) parts.push(String(inc.text));
  });
  return parts.join("; ");
}

function getFeatOptionsHtml(selected = "") {
  const feats = getLssFeatList();
  if (!feats.length) return `<option value="">Черты не загружены</option>`;
  const chosen = normalizeGuideLookup(selected);
  return [
    `<option value="">Выбери черту</option>`,
    ...feats.map((feat) => {
      const meta = formatFeatAbilityIncreases(feat) || (feat.requirements?.length ? `треб.: ${feat.requirements.join(", ")}` : feat.sourceCode || "");
      const label = meta ? `${feat.label} — ${meta}` : feat.label;
      const isSelected = chosen && [feat.id, feat.label, feat.enName].some((candidate) => normalizeGuideLookup(candidate) === chosen);
      return `<option value="${escapeHtml(feat.id)}" ${isSelected ? "selected" : ""}>${escapeHtml(label)}</option>`;
    }),
  ].join("");
}

function renderLssSelectedFeatPreview(prefix = "lssQuick") {
  const featId = getSection(`${prefix}FeatChoice`)?.value || "";
  const feat = getLssFeatByValue(featId);
  if (!feat) return `<div id="${prefix}FeatPreview" class="muted" style="font-size:12px; margin-top:6px;">Выбери черту — здесь появится краткое “что даёт”.</div>`;
  const requirements = normalizeArray(feat.requirements).join(", ") || "без явных требований в данных";
  const ability = formatFeatAbilityIncreases(feat);
  const rawRules = normalizeArray(feat.shortRules || feat.short_rules || feat.rules || feat.raw?.short_rules).slice(0, 4);
  const grants = normalizeArray(feat.sourceGrants || feat.raw?.source_grants)
    .filter(lssGrantLooksMechanical)
    .map(formatLssGrantLabel)
    .filter(Boolean)
    .filter((label, index, array) => array.findIndex((other) => normalizeGuideLookup(other) === normalizeGuideLookup(label)) === index)
    .slice(0, 7);
  const badges = grants.length ? grants : [ability, ...rawRules].filter(Boolean).slice(0, 7);
  return `
    <div id="${prefix}FeatPreview" class="meta-item" style="white-space:normal; display:block; padding:8px 10px; border-radius:12px; margin-top:6px;">
      <strong>${escapeHtml(feat.label)}:</strong> <span class="muted">требования: ${escapeHtml(requirements)}</span>
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">${renderLssMiniBadges(badges, "механика черты пока не распознана", { limit: 7 })}</div>
    </div>
  `;
}

function refreshLssSelectedFeatPreview(prefix = "lssQuick") {
  const preview = getSection(`${prefix}FeatPreview`);
  if (!preview) return;
  const temp = document.createElement("div");
  temp.innerHTML = renderLssSelectedFeatPreview(prefix).trim();
  const next = temp.firstElementChild;
  if (next) preview.replaceWith(next);
}

function renderExistingAsiFeatSummary(profile = LSS_STATE.profile) {
  const asi = Array.isArray(profile?.ability_improvements) ? profile.ability_improvements : [];
  const feats = Array.isArray(profile?.feats) ? profile.feats : [];
  if (!asi.length && !feats.length) return `<span class="muted">ещё не применялись</span>`;
  const badges = [
    ...asi.map((item) => {
      const bonuses = item.bonuses ? formatStatBonusMap(item.bonuses) : "ASI";
      return `ур. ${item.level || "?"}: ${bonuses}`;
    }),
    ...feats.map((item) => `черта: ${item.name || item.label || item.feat_id || "—"}`),
  ];
  return renderLssMiniBadges(badges, "—", { limit: 8 });
}

function renderLssAsiFeatPanel(mode = "quick") {
  const id = mode === "edit" ? "lssEditAsiFeatPanel" : "lssQuickAsiFeatPanel";
  const ctx = getCurrentAsiContext(mode);
  const loadedFeats = getLssFeatList().length;
  const prefix = mode === "edit" ? "lssEdit" : "lssQuick";
  const selectedFeatValue = getSection(`${prefix}FeatChoice`)?.value || "";
  const classLabel = ctx.classGuide?.label || ctx.className || "класс не выбран";
  const milestonesText = ctx.milestones.length ? ctx.milestones.map((lvl) => lvl === ctx.level ? `ур. ${lvl} сейчас` : `ур. ${lvl}`).join(" • ") : "не найдено в прогрессии";
  const status = ctx.available
    ? `На ${ctx.level} уровне есть Увеличение характеристик / Черта.`
    : (ctx.nextLevel ? `Следующее окно ASI/черты: ${ctx.nextLevel} уровень.` : "Для текущего уровня окно ASI/черты не найдено.");
  return `
    <div id="${id}" class="lss-asi-feat-panel" style="margin:10px 0 12px; padding:12px; border:1px solid rgba(199,162,91,.22); border-radius:16px; background:linear-gradient(135deg, rgba(13,27,35,.68), rgba(5,12,18,.36));">
      <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
        <div>
          <div style="font-weight:900; color:var(--gold,#d6b36a);">ASI / Черты</div>
          <div class="muted" style="font-size:12px;">${escapeHtml(classLabel)} • ${escapeHtml(status)}</div>
        </div>
        <div class="trader-meta" style="gap:6px; justify-content:flex-end;">
          <span class="meta-item">${escapeHtml(getLssFeatsStatusLabel())}</span>
          <span class="meta-item">окон: ${escapeHtml(String(ctx.milestones.length))}</span>
        </div>
      </div>
      <div class="profile-grid" style="gap:8px; grid-template-columns:repeat(auto-fit,minmax(190px,1fr));">
        <div class="meta-item" style="white-space:normal; display:block; padding:8px 10px; border-radius:12px;"><strong>Уровни:</strong><div style="margin-top:5px;">${escapeHtml(milestonesText)}</div></div>
        <div class="meta-item" style="white-space:normal; display:block; padding:8px 10px; border-radius:12px;"><strong>Уже применено:</strong><div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:5px;">${renderExistingAsiFeatSummary(mode === "edit" ? LSS_STATE.profile : null)}</div></div>
      </div>
      <div class="profile-grid" style="gap:8px; margin-top:10px; grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
        <div class="filter-group"><label>Выбор</label><select id="${prefix}AsiChoice"><option value="asi-two">+2 к одной характеристике</option><option value="asi-split">+1/+1 к двум характеристикам</option><option value="feat">Взять черту</option></select></div>
        <div class="filter-group"><label>Характеристика 1</label><select id="${prefix}AsiStat1">${getStatSelectOptionsHtml("str")}</select></div>
        <div class="filter-group"><label>Характеристика 2</label><select id="${prefix}AsiStat2">${getStatSelectOptionsHtml("dex")}</select></div>
        <div class="filter-group" style="min-width:220px;"><label>Черта</label><select id="${prefix}FeatChoice" ${loadedFeats ? "" : "disabled"}>${getFeatOptionsHtml(selectedFeatValue)}</select></div>
      </div>
      ${renderLssSelectedFeatPreview(prefix)}
      <input id="${prefix}AppliedAsiRecords" type="hidden" value="${escapeHtml(JSON.stringify(mode === "edit" ? (LSS_STATE.profile?.ability_improvements || []) : []))}">
      <input id="${prefix}SelectedFeats" type="hidden" value="${escapeHtml(JSON.stringify(mode === "edit" ? (LSS_STATE.profile?.feats || []) : []))}">
      <div class="modal-actions" style="margin-top:10px; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-secondary" type="button" id="${prefix}ApplyAsiFeatBtn" ${ctx.available || mode === "edit" ? "" : "disabled"}>＋ Применить ASI / черту</button>
        <span class="muted" style="font-size:12px;">${mode === "quick" ? "Запишется в создаваемый лист." : "В редакторе применяет сразу и сохраняет источник в листе."}</span>
      </div>
    </div>
  `;
}

function refreshLssAsiFeatPanel(mode = "quick") {
  const id = mode === "edit" ? "lssEditAsiFeatPanel" : "lssQuickAsiFeatPanel";
  const panel = getSection(id);
  if (!panel) return;
  const temp = document.createElement("div");
  temp.innerHTML = renderLssAsiFeatPanel(mode).trim();
  const next = temp.firstElementChild;
  if (next) panel.replaceWith(next);
  bindLssConstructorRuleButtons();
}

function getCurrentFormStatValue(mode, statKey) {
  const id = mode === "edit" ? `lssEdit_stat_${statKey}` : `lssQuickCreateStat_${statKey}`;
  return clampNumber(getSection(id)?.value, 1, 30, 10);
}

function setCurrentFormStatValue(mode, statKey, value) {
  const id = mode === "edit" ? `lssEdit_stat_${statKey}` : `lssQuickCreateStat_${statKey}`;
  const input = getSection(id);
  if (input) input.value = String(clampNumber(value, 1, 30, 10));
}

function pushJsonHiddenArray(id, item, duplicateKey = "source_key") {
  const input = getSection(id);
  if (!input) return [];
  const list = safeParseJsonArray(input.value, []);
  const key = item?.[duplicateKey];
  if (key && list.some((old) => old?.[duplicateKey] === key)) return list;
  list.push(item);
  input.value = JSON.stringify(list);
  return list;
}

function applyAsiFeatToForm(mode = "quick") {
  const prefix = mode === "edit" ? "lssEdit" : "lssQuick";
  const ctx = getCurrentAsiContext(mode);
  const choice = getSection(`${prefix}AsiChoice`)?.value || "asi-two";
  const stat1 = getSection(`${prefix}AsiStat1`)?.value || "str";
  const stat2 = getSection(`${prefix}AsiStat2`)?.value || "dex";
  const sourceKey = `${ctx.classGuide?.id || ctx.className || "class"}:level-${ctx.level}:asi-feat`;

  if (choice === "feat") {
    const feat = getLssFeatByValue(getSection(`${prefix}FeatChoice`)?.value || "");
    if (!feat) {
      showToast("Выбери черту из списка");
      return;
    }
    const record = { feat_id: feat.id, name: feat.label, source: "class_level", class_id: ctx.classGuide?.id || "", level: ctx.level, source_key: `${sourceKey}:${feat.id}` };
    const list = pushJsonHiddenArray(`${prefix}SelectedFeats`, record, "source_key");
    if (mode === "edit" && LSS_STATE.profile) {
      LSS_STATE.profile.feats = list;
      const featureText = `Черта (${ctx.classGuide?.label || "класс"} ${ctx.level}): ${feat.label}`;
      const existing = safeText(getSection("lssEdit_features")?.value, "");
      if (getSection("lssEdit_features") && !existing.includes(featureText)) getSection("lssEdit_features").value = [existing, featureText].filter(Boolean).join("\n");
      applyEditFormLive(`Черта применена: ${feat.label}`);
    } else {
      showToast(`Черта выбрана: ${feat.label}`);
    }
    refreshLssAsiFeatPanel(mode);
    return;
  }

  const bonuses = {};
  if (choice === "asi-split") {
    bonuses[stat1] = (bonuses[stat1] || 0) + 1;
    bonuses[stat2] = (bonuses[stat2] || 0) + 1;
  } else {
    bonuses[stat1] = 2;
  }

  Object.entries(bonuses).forEach(([statKey, bonus]) => {
    setCurrentFormStatValue(mode, statKey, getCurrentFormStatValue(mode, statKey) + bonus);
  });
  const record = { source: "class_level", class_id: ctx.classGuide?.id || "", class_name: ctx.classGuide?.label || ctx.className || "", level: ctx.level, type: choice, bonuses, source_key: `${sourceKey}:${choice}:${Object.entries(bonuses).map(([k, v]) => `${k}${v}`).join("-")}` };
  const list = pushJsonHiddenArray(`${prefix}AppliedAsiRecords`, record, "source_key");
  if (mode === "edit" && LSS_STATE.profile) {
    LSS_STATE.profile.ability_improvements = list;
    applyEditFormLive(`ASI применено: ${formatStatBonusMap(bonuses)}`);
  } else {
    applyQuickDexDefaults();
    showToast(`ASI применено: ${formatStatBonusMap(bonuses)}`);
  }
  refreshLssAsiFeatPanel(mode);
}

function applyQuickSourceAbilityBonuses() {
  const bonuses = getCurrentSourceAbilityBonuses("quick");
  if (!hasAbilityBonuses(bonuses)) {
    showToast("Для выбранных источников нет структурных бонусов к статам");
    return;
  }
  const key = getSourceBonusKey("quick");
  if (LSS_STATE.quickAppliedAbilityBonusKey === key) {
    showToast("Эти бонусы уже применены");
    return;
  }
  STAT_DEFS.forEach(({ key: statKey }) => {
    const input = getSection(`lssQuickCreateStat_${statKey}`);
    const bonus = Number(bonuses[statKey] || 0);
    if (!input || !bonus) return;
    input.value = String(Math.max(1, Math.min(30, toNumber(input.value, 10) + bonus)));
  });
  LSS_STATE.quickAppliedAbilityBonusKey = key;
  applyQuickDexDefaults();
  showToast(`Бонусы применены: ${formatStatBonusMap(bonuses)}`);
}

function renderLssMechanicsSources(profile) {
  if (!profile) return "";
  const info = profile.info || {};
  const classGuide = getLssClassGuide(unwrapValue(info.charClass, ""));
  const raceGuide = getLssRaceGuide(unwrapValue(info.race, ""));
  const bgGuide = getLssBackgroundGuide(unwrapValue(info.background, ""));
  const subclassGuide = getLssSubclassGuide(unwrapValue(info.charClass, ""), unwrapValue(info.charSubclass, ""));
  const subraceGuide = getLssSubraceGuide(unwrapValue(info.race, ""), unwrapValue(info.subrace, ""));

  const rows = [
    classGuide ? { label: "Класс", body: `${classGuide.label} • d${classGuide.hitDie} • спасы ${formatStatList(classGuide.saves)}`, source: getLssSourceLabel(classGuide.source) } : { label: "Класс", body: "не распознан", source: "—" },
    subclassGuide ? { label: "Подкласс", body: subclassGuide.label, source: getLssSourceLabel(subclassGuide.source) } : { label: "Подкласс", body: getSubclassHint(unwrapValue(info.charClass, ""), unwrapValue(info.level, 1)), source: "LSS rules" },
    raceGuide ? { label: "Раса", body: `${raceGuide.label} • ${raceGuide.size} • ${raceGuide.speed} фт. • ${raceGuide.abilityBonusesRaw || formatStatBonusMap(getGuideAbilityBonuses(raceGuide))}`, source: getLssSourceLabel(raceGuide.source) } : { label: "Раса", body: "не распознана", source: "—" },
    subraceGuide ? { label: "Подраса", body: `${subraceGuide.label}${subraceGuide.abilityBonusesRaw ? ` • ${subraceGuide.abilityBonusesRaw}` : (subraceGuide.note ? ` • ${subraceGuide.note}` : "")}`, source: getLssSourceLabel(subraceGuide.source) } : { label: "Подраса", body: "можно выбрать позже", source: "LSS rules" },
    bgGuide ? { label: "Предыстория", body: `${bgGuide.label} • навыки: ${formatSkillList(bgGuide.skills)}`, source: getLssSourceLabel(bgGuide.source) } : { label: "Предыстория", body: "не распознана", source: "—" },
  ];

  return `
    <div class="lss-mechanics-sources" style="margin:10px 0 12px 0; padding:10px 12px; border:1px solid rgba(117,203,198,.16); border-radius:14px; background:rgba(5,12,18,.30);">
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:8px;">
        <div style="font-weight:900; color:var(--gold, #d6b36a);">Источники механики</div>
        <div class="muted" style="font-size:12px;">${escapeHtml(getLssRulesStatusLabel())}; полный текст живёт в Бестиарии</div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:8px;">
        ${rows.map((row) => `<div class="meta-item" style="white-space:normal; justify-content:flex-start; align-items:flex-start;"><strong>${escapeHtml(row.label)}:</strong>&nbsp;${escapeHtml(row.body)} <span class="muted" style="font-size:.72rem;">• ${escapeHtml(row.source)}</span></div>`).join("")}
      </div>
    </div>
  `;
}

function renderLssClassGuidanceCard(className, options = {}) {
  const guide = getLssClassGuide(className);
  const mode = options.mode || "quick";
  const id = mode === "edit" ? "lssEditClassGuide" : "lssQuickClassGuide";
  const level = options.level ?? getSection("lssQuickCreateLevel")?.value ?? getSection("lssEdit_level")?.value ?? 1;

  if (!guide) {
    return `
      <div class="lss-constructor-guide" id="${id}" style="margin:10px 0; padding:11px 12px; border:1px solid rgba(199,162,91,.24); border-radius:14px; background:rgba(5,12,18,.48);">
        <div style="font-weight:900; color:var(--gold, #d6b36a); margin-bottom:4px;">🧭 Проводник создания</div>
        <div class="muted" style="font-size:.86rem; line-height:1.35;">Выбери класс из подсказки — LSS покажет кость хитов, важные характеристики, спасброски, владения, магию и когда откроется подкласс.</div>
      </div>
    `;
  }

  const subclassHint = getSubclassHint(guide.label, level);
  const magicLine = guide.spellcasting
    ? `${guide.spellType || "заклинания"}; база — ${STAT_LABELS[guide.spellAbility] || guide.spellAbility}`
    : "без базового заклинательства";

  return `
    <div class="lss-constructor-guide" id="${id}" style="margin:10px 0; padding:12px; border:1px solid rgba(199,162,91,.32); border-radius:14px; background:linear-gradient(135deg, rgba(7,18,27,.86), rgba(14,29,38,.58)); box-shadow:0 10px 24px rgba(0,0,0,.16);">
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start; flex-wrap:wrap; margin-bottom:8px;">
        <div>
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted, #9fb0b8);">Проводник класса</div>
          <div style="font-weight:900; color:var(--gold, #d6b36a); font-size:1.02rem; line-height:1.1;">${escapeHtml(guide.label)}</div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
          <span class="meta-item">d${escapeHtml(String(guide.hitDie))}</span>
          <span class="meta-item">${guide.spellcasting ? "магия" : "без магии"}</span>
        </div>
      </div>

      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
        <span class="meta-item" style="white-space:normal;"><strong>Важны:</strong> ${escapeHtml(formatStatList(guide.primaryStats))}</span>
        <span class="meta-item" style="white-space:normal;"><strong>Спасы:</strong> ${escapeHtml(formatStatList(guide.saves))}</span>
        <span class="meta-item" style="white-space:normal;"><strong>Подкласс:</strong> ${escapeHtml(subclassHint)}</span>
      </div>

      <div style="display:flex; gap:6px; flex-wrap:wrap; font-size:.84rem; line-height:1.25; color:var(--text, #e8eef2);">
        <span class="meta-item" style="white-space:normal;"><strong>Роль:</strong> ${escapeHtml(guide.role)}</span>
        <span class="meta-item" style="white-space:normal;"><strong>Магия:</strong> ${escapeHtml(magicLine)}</span>
      </div>
      <div class="muted" style="margin-top:7px; font-size:.78rem; line-height:1.28;">💡 ${escapeHtml(guide.beginnerTip)}</div>
    </div>
  `;
}

function getExpectedLevelOneHp(guide, conScore = 10) {
  if (!guide) return 10;
  return Math.max(1, toNumber(guide.hitDie, 8) + statMod(toNumber(conScore, 10)));
}

const LSS_HIT_DIE_OPTIONS = ["d4", "d6", "d8", "d10", "d12"];

const LSS_HP_MODE_OPTIONS = [
  { value: "manual", label: "Вручную" },
  { value: "average", label: "Среднее по правилам" },
  { value: "roll", label: "Броском" },
];

const LSS_STATS_METHOD_OPTIONS = [
  { value: "manual", label: "Вручную" },
  { value: "standard-array", label: "Стандартный набор" },
  { value: "point-buy", label: "Покупка очков 27" },
  { value: "roll-4d6", label: "Броски 4к6 без меньшей" },
];

const LSS_STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const LSS_POINT_BUY_STARTER_ARRAY = [15, 14, 13, 12, 10, 8];

const LSS_MULTICLASS_RULES = {
  barbarian: { label: "Варвар", all: [{ stat: "str", min: 13 }] },
  bard: { label: "Бард", all: [{ stat: "cha", min: 13 }] },
  cleric: { label: "Жрец", all: [{ stat: "wis", min: 13 }] },
  druid: { label: "Друид", all: [{ stat: "wis", min: 13 }] },
  fighter: { label: "Воин", any: [{ stat: "str", min: 13 }, { stat: "dex", min: 13 }] },
  monk: { label: "Монах", all: [{ stat: "dex", min: 13 }, { stat: "wis", min: 13 }] },
  paladin: { label: "Паладин", all: [{ stat: "str", min: 13 }, { stat: "cha", min: 13 }] },
  ranger: { label: "Следопыт", all: [{ stat: "dex", min: 13 }, { stat: "wis", min: 13 }] },
  rogue: { label: "Плут", all: [{ stat: "dex", min: 13 }] },
  sorcerer: { label: "Чародей", all: [{ stat: "cha", min: 13 }] },
  warlock: { label: "Колдун", all: [{ stat: "cha", min: 13 }] },
  wizard: { label: "Волшебник", all: [{ stat: "int", min: 13 }] },
  artificer: { label: "Изобретатель", all: [{ stat: "int", min: 13 }] },
};

function normalizeHitDie(value, fallback = "d8") {
  const raw = String(unwrapValue(value, fallback) || fallback).trim().toLowerCase();
  const match = raw.match(/d?\s*(4|6|8|10|12)/);
  if (!match) return fallback;
  return `d${match[1]}`;
}

function normalizeHpMode(value, fallback = "manual") {
  const raw = String(unwrapValue(value, fallback) || fallback).trim().toLowerCase();
  return LSS_HP_MODE_OPTIONS.some((item) => item.value === raw) ? raw : fallback;
}

function normalizeStatsMethod(value, fallback = "manual") {
  const raw = String(unwrapValue(value, fallback) || fallback).trim().toLowerCase();
  return LSS_STATS_METHOD_OPTIONS.some((item) => item.value === raw) ? raw : fallback;
}

function getHitDieOptionsHtml(selected = "d8") {
  const current = normalizeHitDie(selected, "d8");
  return LSS_HIT_DIE_OPTIONS.map((die) => `<option value="${die}" ${die === current ? "selected" : ""}>${die}</option>`).join("");
}

function getHpModeOptionsHtml(selected = "manual") {
  const current = normalizeHpMode(selected, "manual");
  return LSS_HP_MODE_OPTIONS.map((item) => `<option value="${item.value}" ${item.value === current ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
}

function getStatsMethodOptionsHtml(selected = "manual") {
  const current = normalizeStatsMethod(selected, "manual");
  return LSS_STATS_METHOD_OPTIONS.map((item) => `<option value="${item.value}" ${item.value === current ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
}

function getHitDieValue(profile) {
  const explicit = unwrapValue(profile?.vitality?.["hit-die"], "");
  if (explicit) return normalizeHitDie(explicit, "d8");
  const guide = getLssClassGuide(unwrapValue(profile?.info?.charClass, ""));
  return guide ? `d${guide.hitDie}` : "d8";
}

function getHpModeValue(profile) {
  return normalizeHpMode(unwrapValue(profile?.vitality?.["hp-mode"], "manual"), "manual");
}

function getHitDieAverage(dieSize) {
  const n = toNumber(dieSize, 8);
  const fixed = { 4: 3, 6: 4, 8: 5, 10: 6, 12: 7 };
  return fixed[n] || Math.floor(n / 2) + 1;
}

function getAverageHpForLevel(hitDie, level, conMod = 0) {
  const dieSize = toNumber(String(hitDie || "d8").replace("d", ""), 8);
  const lvl = Math.max(1, Math.min(20, toNumber(level, 1)));
  const first = Math.max(1, dieSize + conMod);
  const perLevel = Math.max(1, getHitDieAverage(dieSize) + conMod);
  return Math.max(1, first + Math.max(0, lvl - 1) * perLevel);
}

function rollDieSize(dieSize) {
  return Math.floor(Math.random() * Math.max(1, toNumber(dieSize, 8))) + 1;
}

function rollStat4d6DropLowest() {
  const rolls = Array.from({ length: 4 }, () => rollDieSize(6)).sort((a, b) => b - a);
  return rolls.slice(0, 3).reduce((sum, n) => sum + n, 0);
}

function getHpFormulaPreview(profile) {
  const level = Math.max(1, toNumber(unwrapValue(profile?.info?.level, 1), 1));
  const conMod = getStatModifier(profile, "con");
  const hitDie = getHitDieValue(profile);
  const dieSize = toNumber(hitDie.replace("d", ""), 8);
  const expectedFirst = Math.max(1, dieSize + conMod);
  const averageHp = getAverageHpForLevel(hitDie, level, conMod);
  const maxHp = toNumber(unwrapValue(profile?.vitality?.["hp-max"], 0), 0);
  const mode = getHpModeValue(profile);
  const modeLabel = LSS_HP_MODE_OPTIONS.find((item) => item.value === mode)?.label || "Вручную";
  return {
    hitDie,
    level,
    conMod,
    expectedFirst,
    averageHp,
    maxHp,
    mode,
    modeLabel,
    text: level > 1
      ? `1 ур.: ${hitDie} + Тел ${formatSigned(conMod)}; дальше среднее ${getHitDieAverage(dieSize)} + Тел за уровень ≈ ${averageHp} HP`
      : `${hitDie} + Тел ${formatSigned(conMod)} на 1 уровне ≈ ${expectedFirst} HP`,
  };
}

function getStatMethodValue(profile) {
  return normalizeStatsMethod(unwrapValue(profile?.info?.statsMethod, "manual"), "manual");
}

function getSuggestedStatsForClass(className, method = "standard-array") {
  const guide = getLssClassGuide(className);
  const values = normalizeStatsMethod(method, "standard-array") === "point-buy"
    ? [...LSS_POINT_BUY_STARTER_ARRAY]
    : [...LSS_STANDARD_ARRAY];
  const priority = [...(guide?.primaryStats || []), ...STAT_DEFS.map((item) => item.key)]
    .filter((key, index, arr) => arr.indexOf(key) === index);
  const result = {};
  priority.forEach((key, index) => {
    result[key] = values[index] ?? 10;
  });
  STAT_DEFS.forEach(({ key }) => {
    if (!result[key]) result[key] = 10;
  });
  return result;
}

function getRolledStats() {
  const result = {};
  STAT_DEFS.forEach(({ key }) => {
    result[key] = rollStat4d6DropLowest();
  });
  return result;
}

function formatMulticlassRequirement(req) {
  const statKey = req.stat || req.ability;
  return `${STAT_LABELS[statKey] || String(statKey).toUpperCase()} ${req.min}+`;
}

function getLssMulticlassRule(classId) {
  const id = getLssClassGuide(classId)?.id || classId;
  const rulesMap = getLssRules()?.rules?.multiclass_requirements || {};
  const fromRules = rulesMap[id];
  if (fromRules?.rules) {
    const mapped = fromRules.rules.map((req) => ({ stat: req.ability || req.stat, min: req.min }));
    const label = getLssClassGuide(id)?.label || LSS_MULTICLASS_RULES[id]?.label || id;
    return fromRules.mode === "any" ? { label, any: mapped } : { label, all: mapped };
  }
  return LSS_MULTICLASS_RULES[id] || LSS_MULTICLASS_RULES[classId];
}

function getMulticlassRuleText(classId) {
  const rule = getLssMulticlassRule(classId);
  if (!rule) return "выбери класс, чтобы увидеть требования мультикласса";
  if (Array.isArray(rule.any)) return rule.any.map(formatMulticlassRequirement).join(" или ");
  return (rule.all || []).map(formatMulticlassRequirement).join(" и ");
}

function evaluateMulticlassRule(profile, classId) {
  const rule = getLssMulticlassRule(classId);
  if (!rule) return { ok: false, text: "нет правила" };
  const check = (req) => getStatScore(profile, req.stat || req.ability) >= req.min;
  const ok = Array.isArray(rule.any) ? rule.any.some(check) : (rule.all || []).every(check);
  return { ok, text: getMulticlassRuleText(classId) };
}

function getAcFormulaPreview(profile) {
  const dexMod = getStatModifier(profile, "dex");
  const ac = toNumber(unwrapValue(profile?.vitality?.ac, 10), 10);
  return {
    ac,
    dexMod,
    text: `Сейчас КБ хранится итогом: ${ac}. Формулу брони подключим позже: база/броня + щит + Ловкость + бонусы.`,
  };
}

function applyClassGuideToProfile(profile, options = {}) {
  const guide = getLssClassGuide(unwrapValue(profile?.info?.charClass, ""));
  if (!profile || !guide) return profile;

  profile.vitality = profile.vitality || {};
  profile.spellsInfo = profile.spellsInfo || {};
  profile.saves = profile.saves || {};

  profile.__lssClassGuide = {
    id: guide.id,
    label: guide.label,
    appliedAt: new Date().toISOString(),
  };

  profile.vitality["hit-die"] = preserveValueNode(profile.vitality["hit-die"], `d${guide.hitDie}`);
  guide.saves.forEach((key) => {
    profile.saves[key] = { ...(profile.saves[key] || {}), name: key, isProf: true, source: profile.saves[key]?.source || "class" };
  });

  if (guide.spellcasting && guide.spellAbility) {
    profile.spellsInfo.base = {
      ...(profile.spellsInfo.base || {}),
      name: "base",
      value: STAT_LABELS[guide.spellAbility] || guide.spellAbility,
      code: guide.spellAbility,
    };
  } else if (!guide.spellcasting && !unwrapValue(profile.spellsInfo?.base, "")) {
    profile.spellsInfo.base = { ...(profile.spellsInfo.base || {}), name: "base", value: "", code: "" };
  }

  const classLine = [
    `${guide.label}: d${guide.hitDie} кость хитов`,
    `важные характеристики: ${formatStatList(guide.primaryStats)}`,
    `спасброски: ${formatStatList(guide.saves)}`,
    guide.spellcasting ? `заклинания: ${guide.spellType}; база — ${STAT_LABELS[guide.spellAbility] || guide.spellAbility}` : "заклинания: нет базового заклинательства",
  ].join("; ");

  if (!String(profile.prof || "").trim()) {
    profile.prof = `Класс: ${classLine}. Броня: ${guide.armor}. Оружие: ${guide.weapons}.`;
  }

  if (!String(profile.attacks || "").trim()) {
    profile.attacks = `Стартовые черты класса: ${(guide.level1 || []).join(", ") || "уточнить по подклассу/уровню"}.`;
  }

  return profile;
}

function applySubclassGuideToProfile(profile, options = {}) {
  const className = unwrapValue(profile?.info?.charClass, "");
  const subclassName = unwrapValue(profile?.info?.charSubclass, "");
  const guide = getLssClassGuide(className);
  const subclass = getLssSubclassGuide(className, subclassName);
  if (!profile || !guide) return profile;

  profile.__lssMechanics = profile.__lssMechanics || {};
  profile.__lssMechanics.subclass = {
    id: subclass?.id || "",
    label: subclass?.label || String(subclassName || ""),
    class_id: guide.id,
    class_label: guide.label,
    unlock_level: getSubclassUnlockLevel(guide.id),
    source: subclass?.source || "manual_or_pending",
    note: subclass?.sourceGroup || subclass?.note || "",
  };

  return profile;
}

function applyRaceGuideToProfile(profile, options = {}) {
  const guide = getLssRaceGuide(unwrapValue(profile?.info?.race, ""));
  if (!profile || !guide) return profile;

  profile.info = profile.info || {};
  profile.vitality = profile.vitality || {};
  profile.__lssRaceGuide = {
    id: guide.id,
    label: guide.label,
    appliedAt: new Date().toISOString(),
  };

  const currentSize = String(unwrapValue(profile.info.size, "") || "").trim();
  if (!currentSize || currentSize.toLowerCase() === "medium") {
    setLssValue(profile, "info.size", guide.size, "size");
  }

  const currentSpeed = toNumber(unwrapValue(profile.vitality.speed, 0), 0);
  if (!currentSpeed || currentSpeed === 30) {
    profile.vitality.speed = preserveValueNode(profile.vitality.speed, guide.speed);
  }

  profile.__lssMechanics = profile.__lssMechanics || {};
  profile.__lssMechanics.race = {
    id: guide.id,
    label: guide.label,
    abilityBonuses: guide.abilityBonuses || {},
    traits: guide.traits || [],
    languages: guide.languages || "",
  };

  return profile;
}

function applySubraceGuideToProfile(profile, options = {}) {
  const raceName = unwrapValue(profile?.info?.race, "");
  const subraceName = unwrapValue(profile?.info?.subrace, "");
  const raceGuide = getLssRaceGuide(raceName);
  const subrace = getLssSubraceGuide(raceName, subraceName);
  if (!profile || !raceGuide) return profile;

  profile.__lssMechanics = profile.__lssMechanics || {};
  profile.__lssMechanics.subrace = {
    id: subrace?.id || "",
    label: subrace?.label || String(subraceName || ""),
    race_id: raceGuide.id,
    race_label: raceGuide.label,
    source: subrace?.source || "manual_or_pending",
    note: subrace?.note || "",
  };

  return profile;
}

function applyBackgroundGuideToProfile(profile, options = {}) {
  const guide = getLssBackgroundGuide(unwrapValue(profile?.info?.background, ""));
  if (!profile || !guide) return profile;

  profile.skills = profile.skills || {};
  profile.__lssBackgroundGuide = {
    id: guide.id,
    label: guide.label,
    appliedAt: new Date().toISOString(),
  };

  (guide.skills || []).forEach((skillKey) => {
    const baseStat = SKILL_BASE_STATS[skillKey] || "int";
    profile.skills[skillKey] = {
      ...(profile.skills[skillKey] || {}),
      baseStat,
      name: skillKey,
      isProf: 1,
      source: profile.skills[skillKey]?.source || "background",
    };
  });

  profile.__lssMechanics = profile.__lssMechanics || {};
  profile.__lssMechanics.background = {
    id: guide.id,
    label: guide.label,
    skills: guide.skills || [],
    tools: guide.tools || "",
    languages: guide.languages || "",
    feature: guide.feature || "",
  };

  return profile;
}

function getSkillBaseStat(skillKey, profile = null) {
  return getNested(profile, `skills.${skillKey}.baseStat`, SKILL_BASE_STATS[skillKey] || "int");
}

function toggleSkillProficiency(skillKey, enabled) {
  if (!skillKey) return;
  updateLssProfile((profile) => {
    profile.skills = profile.skills || {};
    const prev = profile.skills[skillKey] || {};
    profile.skills[skillKey] = {
      ...prev,
      baseStat: prev.baseStat || getSkillBaseStat(skillKey, profile),
      isProf: enabled ? 1 : 0,
      source: enabled ? (prev.source || "manual") : prev.source,
    };
  }, enabled ? "Владение навыком включено" : "Владение навыком отключено");
}

function getSkillsByStat(profile, statKey) {
  const skills = profile?.skills || {};
  const merged = { ...skills };

  Object.entries(SKILL_BASE_STATS).forEach(([skillKey, baseStat]) => {
    if (String(baseStat || "") !== String(statKey || "")) return;
    if (!merged[skillKey] || typeof merged[skillKey] !== "object") {
      merged[skillKey] = { baseStat, isProf: 0 };
    } else if (!merged[skillKey].baseStat) {
      merged[skillKey] = { ...merged[skillKey], baseStat };
    }
  });

  return Object.entries(merged)
    .filter(([, skill]) => String(skill?.baseStat || "") === statKey)
    .sort((a, b) => {
      const aLabel = SKILL_LABELS[a[0]] || capitalizeRu(a[0]);
      const bLabel = SKILL_LABELS[b[0]] || capitalizeRu(b[0]);
      return aLabel.localeCompare(bLabel, "ru");
    });
}

// ------------------------------------------------------------
// ⚔️ SPELLCASTING / WEAPONS
// ------------------------------------------------------------
function getSpellcastingAbilityCode(profile) {
  const code = String(getNested(profile, "spellsInfo.base.code", "int") || "int")
    .trim()
    .toLowerCase();
  return ["str", "dex", "con", "int", "wis", "cha"].includes(code)
    ? code
    : "int";
}

function getSpellcastingAbility(profile) {
  const map = {
    str: "Сила",
    dex: "Ловкость",
    con: "Телосложение",
    int: "Интеллект",
    wis: "Мудрость",
    cha: "Харизма",
  };
  return map[getSpellcastingAbilityCode(profile)] || "Интеллект";
}

function getSpellAttackBonus(profile) {
  const abilityCode = getSpellcastingAbilityCode(profile);
  return getStatModifier(profile, abilityCode) + getProficiencyBonus(profile);
}

function getSpellSaveDc(profile) {
  return 8 + getSpellAttackBonus(profile);
}

function getSpellSlots(profile) {
  const spells = profile?.spells || {};
  return Object.keys(spells)
    .filter((key) => key.startsWith("slots-"))
    .map((key) => {
      const level = key.replace("slots-", "");
      const entry = spells[key] || {};
      return {
        level,
        total: toNumber(entry.value, 0),
        filled: toNumber(entry.filled, 0),
      };
    })
    .filter((slot) => slot.total > 0 || slot.filled > 0)
    .sort((a, b) => Number(a.level) - Number(b.level));
}

function getPreparedSpellIds(profile) {
  return Array.isArray(profile?.spellsMeta?.prepared)
    ? profile.spellsMeta.prepared
    : Array.isArray(profile?.spells?.prepared)
      ? profile.spells.prepared
      : Array.isArray(profile?.preparedSpellIds)
        ? profile.preparedSpellIds
        : [];
}

function getBookSpellIds(profile) {
  return Array.isArray(profile?.spellsMeta?.book)
    ? profile.spellsMeta.book
    : Array.isArray(profile?.spells?.book)
      ? profile.spells.book
      : Array.isArray(profile?.spellBookIds)
        ? profile.spellBookIds
        : [];
}

function getSpellDisplayMode(profile) {
  return (
    safe(profile?.spellsMeta?.mode, "") ||
    safe(profile?.spells?.mode, "") ||
    safe(LSS_STATE.raw?.spells?.mode, "") ||
    "list"
  );
}

function weaponAttackBonus(profile, weapon) {
  const ability = String(weapon?.ability || "str").toLowerCase();
  const abilityMod = getStatModifier(profile, ability);
  const prof = weapon?.isProf ? getProficiencyBonus(profile) : 0;
  const extra = toNumber(weapon?.modBonus?.value ?? weapon?.modBonus ?? 0, 0);
  const computed = abilityMod + prof + extra;

  const explicitRaw = weapon?.mod?.value;
  if (explicitRaw !== undefined && explicitRaw !== null && explicitRaw !== "") {
    const cleaned = String(explicitRaw).replace(/[^\d+-]/g, "");
    const explicit = toNumber(cleaned, computed);

    if (explicit === 0 && computed !== 0) return computed;
    if (Math.abs(explicit - computed) <= 1) return explicit;
  }

  return computed;
}

function normalizeWeaponDamage(weapon) {
  return safe(unwrapValue(weapon?.dmg, "—"), "—");
}

function normalizeWeaponName(weapon) {
  return safe(unwrapValue(weapon?.name, "Без названия"), "Без названия");
}

function getSpellCardsExpanded(profile) {
  const candidates = [
    profile?.spellCards,
    profile?.spellsCards,
    profile?.spellsMeta?.cards,
    profile?.spellsMeta?.preparedExpanded,
    profile?.spellsMeta?.bookExpanded,
    profile?.preparedSpellsExpanded,
    profile?.bookSpellsExpanded,
    profile?.spellsExpanded,
    profile?.spellbook,
    profile?.spellsList,
    LSS_STATE.raw?.spellCards,
    LSS_STATE.raw?.spellsCards,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }

  return [];
}

function normalizeSpellCard(card, index = 0) {
  if (!card || typeof card !== "object") {
    return {
      id: `spell-${index}`,
      name: `Заклинание ${index + 1}`,
      level: "",
      school: "",
      time: "",
      range: "",
      duration: "",
      components: "",
      description: "",
      notes: "",
    };
  }

  return {
    id: card.id || card.external_id || card._id || card.slug || `spell-${index}`,
    catalogId: card.catalog_id || card.id || card._id || "",
    externalId: card.external_id || "",
    name: card.name || card.ru_name || card.title || card.label || card.en_name || `Заклинание ${index + 1}`,
    level: card.level ?? card.circle ?? card.tier ?? card.spell_level ?? "",
    school: card.school || card.schoolName || card.school_ru || card.type || "",
    time: card.casting_time || card.castingTime || card.time || card.castTime || "",
    range: card.range || card.distance || "",
    duration: card.duration || card.length || "",
    components: joinNonEmpty([card.components_display, card.components?.display, card.components, card.materials]),
    description: card.description || card.summary || card.text || card.effect || card.body || "",
    notes: card.notes || card.meta || (card.bridge_confidence ? `bridge: ${card.bridge_confidence}` : ""),
    prepared: Boolean(card.prepared),
    sourceKind: card.source_kind || "",
  };
}

// ------------------------------------------------------------
// 🔄 NORMALIZATION
// ------------------------------------------------------------
function extractOriginalLssSpellMeta(rawProfile) {
  if (!rawProfile || typeof rawProfile !== "object") return {};
  const roots = [
    rawProfile.spellsMeta,
    rawProfile.spells,
    rawProfile.__lssRoot?.spells,
  ];
  if (typeof rawProfile.data === "string") roots.unshift(rawProfile.spells);
  const result = {};
  roots.forEach((root) => {
    if (!root || typeof root !== "object" || Array.isArray(root)) return;
    if (Array.isArray(root.prepared)) result.prepared = Array.from(new Set([...(result.prepared || []), ...root.prepared.map(String)]));
    if (Array.isArray(root.book)) result.book = Array.from(new Set([...(result.book || []), ...root.book.map(String)]));
    if (root.mode && !result.mode) result.mode = root.mode;
    if (root.edition && !result.edition) result.edition = root.edition;
    if (Array.isArray(root.cards)) result.cards = root.cards;
    if (Array.isArray(root.preparedExpanded)) result.preparedExpanded = root.preparedExpanded;
    if (Array.isArray(root.bookExpanded)) result.bookExpanded = root.bookExpanded;
  });
  return result;
}

function mergeOriginalLssSpellMeta(profile, rawProfile) {
  if (!profile || typeof profile !== "object") return profile;
  const extracted = extractOriginalLssSpellMeta(rawProfile);
  profile.spellsMeta = { ...(profile.spellsMeta || {}), ...extracted };
  return profile;
}

function normalizeProfile(rawProfile) {
  if (!rawProfile || typeof rawProfile !== "object") return null;

  if (rawProfile.info && rawProfile.stats && rawProfile.vitality) {
    return {
      ...rawProfile,
      spellsMeta: rawProfile.spellsMeta || rawProfile.spells || {},
      __lssRoot: rawProfile.__lssRoot || rawProfile,
    };
  }

  if (rawProfile.profile && typeof rawProfile.profile === "object") {
    return normalizeProfile(rawProfile.profile);
  }

  if (typeof rawProfile.data === "string") {
    const parsed = tryParseJson(rawProfile.data);
    if (parsed && typeof parsed === "object") {
      return {
        ...parsed,
        spellsMeta: { ...(parsed.spellsMeta || {}), ...extractOriginalLssSpellMeta(rawProfile) },
        exportMeta: {
          tags: rawProfile.tags || [],
          edition: rawProfile.edition || "",
        },
        __lssRoot: rawProfile,
      };
    }
  }

  return {
    ...rawProfile,
    __lssRoot: rawProfile,
  };
}

// ------------------------------------------------------------
// 📡 LOAD PROFILE
// ------------------------------------------------------------
async function tryLoadFromApi() {
  const urls = [
    "/player/profile",
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: getHeaders() });
      if (!res.ok) continue;

      const data = await res.json();
      if (!data) continue;

      const profilePayload = data.profile || data.character || data.lss || data;
      const lssBlock = profilePayload?.data?.lss || profilePayload?.data?.lss_profile || null;
      if (lssBlock && typeof lssBlock === "object") {
        const next = cloneData(lssBlock);
        const characterId = Number(profilePayload?.character_id || profilePayload?.id || 0);
        if (Number.isFinite(characterId) && characterId > 0) {
          next.__dndTraderCharacterId = characterId;
          next.character_id = characterId;
          LSS_STATE.selectedCharacterId = String(characterId);
        }
        return next;
      }

      return profilePayload;
    } catch (_) {}
  }

  return null;
}

function tryLoadFromWindow() {
  const candidates = [
    window.__LSS_EXPORT__,
    window.__lssExport,
    window.__PLAYER_LSS__,
    window.__playerLss,
    window.__CHARACTER_EXPORT__,
    window.__characterExport,
  ];

  for (const candidate of candidates) {
    if (candidate) return candidate;
  }

  return null;
}

function tryLoadFromLocal() {
  return loadLocalLssRaw();
}

export async function loadLSS() {
  await ensureLssConstructorRulesLoaded();
  await ensureLssParsedSpellCatalogLoaded();
  await ensureLssFeatRulesLoaded();
  await loadLssCharacterPool();

  let raw = tryLoadFromLocal();
  let source = raw ? "local" : "empty";

  if (!raw) {
    raw = await tryLoadFromApi();
    source = "api";
  }

  if (!raw) {
    raw = tryLoadFromWindow();
    source = "window";
  }

  if (!raw) {
    LSS_STATE.raw = null;
    LSS_STATE.profile = null;
    LSS_STATE.source = "empty";
    return;
  }

  const profile = hydrateOriginalLssSpellExport(mergeOriginalLssSpellMeta(normalizeProfile(raw), raw));
  const characterId = getProfileCharacterId(profile);
  if (characterId) LSS_STATE.selectedCharacterId = String(characterId);

  LSS_STATE.raw = raw;
  LSS_STATE.profile = profile;
  LSS_STATE.source = source;
}

// ------------------------------------------------------------
// 🛠 EDIT HELPERS
// ------------------------------------------------------------
function ensureEditableProfileBase() {
  const profile = cloneData(LSS_STATE.profile || {});
  if (!profile.info) profile.info = {};
  if (!profile.subInfo) profile.subInfo = {};
  if (!profile.vitality) profile.vitality = {};
  if (!profile.stats) profile.stats = {};
  if (!profile.saves) profile.saves = {};
  if (!profile.skills) profile.skills = {};
  if (!profile.spells) profile.spells = {};
  return profile;
}

function applyBasicFormToProfile(formData) {
  const profile = ensureEditableProfileBase();

  profile.name = safeText(formData.name, getProfileName(profile));
  setLssValue(profile, "info.name", profile.name, "name");
  setLssValue(profile, "info.charClass", safeText(formData.charClass, unwrapValue(getNested(profile, "info.charClass", ""))), "charClass");
  setLssValue(profile, "info.charSubclass", safeText(formData.charSubclass, unwrapValue(getNested(profile, "info.charSubclass", ""))), "charSubclass");
  setLssValue(profile, "info.subrace", safeText(formData.subrace, unwrapValue(getNested(profile, "info.subrace", ""))), "subrace");
  setLssValue(profile, "info.level", Math.max(1, toNumber(formData.level, unwrapValue(getNested(profile, "info.level", 1)))), "level");
  setLssValue(profile, "info.background", safeText(formData.background, unwrapValue(getNested(profile, "info.background", ""))), "background");
  setLssValue(profile, "info.race", safeText(formData.race, unwrapValue(getNested(profile, "info.race", ""))), "race");
  setLssValue(profile, "info.alignment", normalizeAlignment(safeText(formData.alignment, unwrapValue(getNested(profile, "info.alignment", "")))), "alignment");
  setLssValue(profile, "info.size", normalizeSize(formData.size || unwrapValue(getNested(profile, "info.size", "medium"))), "size");
  setLssValue(profile, "info.experience", Math.max(0, toNumber(formData.experience, unwrapValue(getNested(profile, "info.experience", 0)))), "experience");
  setLssValue(profile, "info.statsMethod", normalizeStatsMethod(formData.statsMethod || unwrapValue(getNested(profile, "info.statsMethod", "manual"))), "statsMethod");
  setLssValue(profile, "info.multiclass", safeText(formData.multiclass, unwrapValue(getNested(profile, "info.multiclass", ""))), "multiclass");
  setLssValue(profile, "info.multiclassEnabled", Boolean(formData.multiclassEnabled), "multiclassEnabled");
  profile.ability_improvements = safeParseJsonArray(formData.abilityImprovements, Array.isArray(profile.ability_improvements) ? profile.ability_improvements : []);
  profile.feats = safeParseJsonArray(formData.feats, Array.isArray(profile.feats) ? profile.feats : []);

  setLssValue(profile, "subInfo.age", safeText(formData.age, unwrapValue(getNested(profile, "subInfo.age", ""))), "age");
  setLssValue(profile, "subInfo.height", safeText(formData.height, unwrapValue(getNested(profile, "subInfo.height", ""))), "height");
  setLssValue(profile, "subInfo.weight", safeText(formData.weight, unwrapValue(getNested(profile, "subInfo.weight", ""))), "weight");
  setLssValue(profile, "subInfo.eyes", safeText(formData.eyes, unwrapValue(getNested(profile, "subInfo.eyes", ""))), "eyes");
  setLssValue(profile, "subInfo.skin", safeText(formData.skin, unwrapValue(getNested(profile, "subInfo.skin", ""))), "skin");
  setLssValue(profile, "subInfo.hair", safeText(formData.hair, unwrapValue(getNested(profile, "subInfo.hair", ""))), "hair");

  profile.proficiency = Math.max(0, toNumber(formData.proficiency, profile.proficiency || 2));
  profile.vitality = profile.vitality || {};
  profile.vitality["hp-current"] = preserveValueNode(profile.vitality["hp-current"], Math.max(0, toNumber(formData.hpCurrent, unwrapValue(profile.vitality["hp-current"], 0))));
  profile.vitality["hp-max"] = preserveValueNode(profile.vitality["hp-max"], Math.max(1, toNumber(formData.hpMax, unwrapValue(profile.vitality["hp-max"], 1))));
  profile.vitality["hp-temp"] = preserveValueNode(profile.vitality["hp-temp"], Math.max(0, toNumber(formData.hpTemp, unwrapValue(profile.vitality["hp-temp"], 0))));
  profile.vitality["hit-die"] = preserveValueNode(profile.vitality["hit-die"], normalizeHitDie(formData.hitDie, getHitDieValue(profile)), "hit-die");
  profile.vitality["hp-dice-current"] = preserveValueNode(profile.vitality["hp-dice-current"], Math.max(0, toNumber(formData.hitDiceCurrent, unwrapValue(profile.vitality["hp-dice-current"], 0))), "hp-dice-current");
  profile.vitality["hp-mode"] = preserveValueNode(profile.vitality["hp-mode"], normalizeHpMode(formData.hpMode || unwrapValue(profile.vitality["hp-mode"], "manual")), "hp-mode");
  profile.vitality.ac = preserveValueNode(profile.vitality.ac, Math.max(0, toNumber(formData.ac, unwrapValue(profile.vitality.ac, 10))));
  profile.vitality.speed = preserveValueNode(profile.vitality.speed, Math.max(0, toNumber(formData.speed, unwrapValue(profile.vitality.speed, 30))));
  profile.vitality.initiative = preserveValueNode(profile.vitality.initiative, toNumber(formData.initiative, unwrapValue(profile.vitality.initiative, getDexInitiative(profile))));

  profile.stats = profile.stats || {};
  STAT_DEFS.forEach(({ key }) => {
    const score = Math.max(1, Math.min(30, toNumber(formData[`stat_${key}`], getNested(profile, `stats.${key}.score`, 10))));
    profile.stats[key] = { ...(profile.stats[key] || {}), name: key, score, modifier: statMod(score), check: statMod(score) };
  });

  if (formData.initiative === "" || formData.initiative === undefined || formData.initiativeAuto === "1") {
    profile.vitality.initiative = preserveValueNode(profile.vitality.initiative, getDexInitiative(profile));
  }

  profile.saves = profile.saves || {};
  STAT_DEFS.forEach(({ key }) => {
    profile.saves[key] = { ...(profile.saves[key] || {}), name: key, isProf: Boolean(formData.saves?.[key]), source: formData.saves?.[key] ? (profile.saves[key]?.source || "manual") : profile.saves[key]?.source };
  });

  profile.skills = profile.skills || {};
  Object.entries(SKILL_BASE_STATS).forEach(([skillKey, baseStat]) => {
    profile.skills[skillKey] = { ...(profile.skills[skillKey] || {}), baseStat, name: skillKey, isProf: formData.skills?.[skillKey] ? 1 : 0, source: formData.skills?.[skillKey] ? (profile.skills[skillKey]?.source || "manual") : profile.skills[skillKey]?.source };
  });

  profile.coins = profile.coins || {};
  ["pp", "gp", "ep", "sp", "cp"].forEach((coin) => {
    profile.coins[coin] = preserveValueNode(profile.coins[coin], Math.max(0, toNumber(formData[`coin_${coin}`], unwrapValue(profile.coins[coin], 0))));
  });

  profile.portrait = safeText(formData.portrait, profile.portrait || "");
  profile.appearance = safeText(formData.appearance, profile.appearance || "");
  profile.background = safeText(formData.backgroundText, profile.background || "");
  profile.personality = safeText(formData.personality, profile.personality || "");
  profile.ideals = safeText(formData.ideals, profile.ideals || "");
  profile.bonds = safeText(formData.bonds, profile.bonds || "");
  profile.flaws = safeText(formData.flaws, profile.flaws || "");
  profile.equipment = safeText(formData.equipment, profile.equipment || "");
  profile.prof = safeText(formData.proficiencies, profile.prof || "");
  profile.allies = safeText(formData.allies, profile.allies || "");
  profile.quests = safeText(formData.goals, profile.quests || "");
  profile.attacks = safeText(formData.features, profile.attacks || "");
  profile["notes-1"] = safeText(formData.notes1, profile["notes-1"] || "");
  profile["notes-2"] = safeText(formData.notes2, profile["notes-2"] || "");

  applyClassGuideToProfile(profile, { source: "edit" });
  applySubclassGuideToProfile(profile, { source: "edit" });
  applyRaceGuideToProfile(profile, { source: "edit" });
  applySubraceGuideToProfile(profile, { source: "edit" });
  applyBackgroundGuideToProfile(profile, { source: "edit" });

  return profile;
}

function collectEditFormData() {
  const fields = [
    "name",
    "charClass",
    "charSubclass",
    "subrace",
    "level",
    "background",
    "race",
    "alignment",
    "size",
    "experience",
    "statsMethod",
    "multiclass",
    "AppliedAsiRecords",
    "SelectedFeats",
    "age",
    "height",
    "weight",
    "eyes",
    "skin",
    "hair",
    "proficiency",
    "hpCurrent",
    "hpMax",
    "hpTemp",
    "hitDie",
    "hitDiceCurrent",
    "hpMode",
    "ac",
    "speed",
    "initiative",
    "initiativeAuto",
    "stat_str",
    "stat_dex",
    "stat_con",
    "stat_int",
    "stat_wis",
    "stat_cha",
    "coin_pp",
    "coin_gp",
    "coin_ep",
    "coin_sp",
    "coin_cp",
    "portrait",
    "appearance",
    "backgroundText",
    "personality",
    "ideals",
    "bonds",
    "flaws",
    "equipment",
    "proficiencies",
    "allies",
    "goals",
    "features",
    "notes1",
    "notes2",
  ];

  const result = { saves: {}, skills: {} };
  fields.forEach((key) => {
    result[key] = safeText(getSection(`lssEdit_${key}`)?.value, "");
  });
  result.multiclassEnabled = Boolean(getSection("lssEdit_multiclassEnabled")?.checked);
  result.abilityImprovements = getSection("lssEditAppliedAsiRecords")?.value || result.AppliedAsiRecords || "[]";
  result.feats = getSection("lssEditSelectedFeats")?.value || result.SelectedFeats || "[]";

  STAT_DEFS.forEach(({ key }) => {
    result.saves[key] = Boolean(getSection(`lssEdit_save_${key}`)?.checked);
  });

  Object.keys(SKILL_BASE_STATS).forEach((skillKey) => {
    result.skills[skillKey] = Boolean(getSection(`lssEdit_skill_${lssEditDomKey(skillKey)}`)?.checked);
  });

  return result;
}

function setPortraitFieldValue(value) {
  const input = getSection("lssEdit_portrait");
  if (input) input.value = value || "";
}

function savePortraitImmediately(portraitValue) {
  if (!LSS_STATE.profile) {
    showToast("Сначала загрузи LSS-данные");
    return;
  }

  const nextProfile = applyPortraitToProfile(LSS_STATE.profile, portraitValue || "");
  setLssData(nextProfile, { persistLocal: true, source: "manual" });
  LSS_STATE.editPanelOpen = true;
  renderLSS();
}

async function handlePortraitFile(file) {
  if (!file) return;

  if (!file.type?.startsWith("image/")) {
    showToast("Выбери файл изображения");
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    savePortraitImmediately(dataUrl);
    showToast("Фото персонажа загружено");
  } catch (error) {
    console.error(error);
    showToast("Не удалось загрузить фото");
  }
}

// ------------------------------------------------------------
// 🎨 IMPORT / EDIT PANELS
// ------------------------------------------------------------
function getPrettyRawPreview() {
  if (!LSS_STATE.raw) return "";
  try {
    return JSON.stringify(LSS_STATE.raw, null, 2);
  } catch {
    return "";
  }
}


function renderTopToolbar() {
  const sourceLabel = {
    empty: "пусто",
    local: "локально",
    api: "аккаунт",
    manual: "ручной ввод",
    window: "window",
  }[String(LSS_STATE.source || "empty").toLowerCase()] || String(LSS_STATE.source || "нет данных");

  const rulesLabel = getLssRulesStatusLabel();
  const characterPool = getLssCharacterPool();
  const hasProfile = Boolean(LSS_STATE.profile);

  return `
    <div class="cabinet-block lss-ref-topbar lss-ref-topbar-compact" style="position:static !important; top:auto !important; z-index:auto !important;">
      <div class="lss-ref-brand">
        <div class="lss-ref-mark">✦</div>
        <div>
          <div class="lss-ref-title">LSS</div>
          <div class="lss-ref-subtitle">Long Story Short</div>
        </div>
      </div>

      <div class="lss-ref-top-actions">
        ${characterPool.length ? `
          <div class="lss-ref-character-pool">
            <label for="lssCharacterPoolSelect">Персонаж</label>
            <select id="lssCharacterPoolSelect">
              ${characterPool.map((entry) => `
                <option value="${escapeHtml(String(entry.id))}" ${String(LSS_STATE.selectedCharacterId || "") === String(entry.id) ? "selected" : ""}>
                  ${escapeHtml(entry.name || "Персонаж")}${entry.class_name ? ` • ${escapeHtml(entry.class_name)}` : ""}${entry.level ? ` • ур. ${escapeHtml(String(entry.level))}` : ""}
                </option>
              `).join("")}
            </select>
            <button class="btn btn-secondary" type="button" id="lssApplyCharacterPoolBtn">Взять</button>
          </div>
        ` : ""}
        <button class="btn btn-primary" type="button" id="lssToggleImportBtn">${LSS_STATE.importPanelOpen ? "Скрыть JSON" : "📁 Загрузить"}</button>
        <button class="btn btn-secondary" type="button" id="lssToggleEditBtn">${LSS_STATE.editPanelOpen ? "Скрыть конструктор" : hasProfile ? "🛠 Конструктор" : "✨ Создать"}</button>
        <button class="btn btn-secondary" type="button" id="lssDiceToggleBtn" ${hasProfile ? "" : "disabled"}>${LSS_STATE.dicePanelOpen ? "Скрыть кубы" : "🎲 Кубы"}</button>
        ${hasProfile ? `<button class="btn btn-success" type="button" id="lssSaveNowBtn">💾 Сохранить лист</button>` : ""}
        ${hasProfile ? `<button class="btn btn-secondary" type="button" id="lssSaveAsNewBtn">＋ Новая копия</button>` : ""}
        ${hasProfile ? `<button class="btn btn-danger" type="button" id="lssClearDataBtn">Очистить</button>` : ""}
      </div>

      <div class="lss-ref-source-pill" title="${escapeHtml(LSS_STATE.constructorRulesSource || "")}">Источник: ${escapeHtml(sourceLabel)} • ${escapeHtml(rulesLabel)}</div>
    </div>
  `;
}

function renderImportPanel() {
  return `
    <div class="cabinet-block" id="lssImportPanel" style="${LSS_STATE.importPanelOpen ? "" : "display:none;"} margin-bottom:12px;">
      <h4 style="margin-bottom:10px;">Импорт LSS</h4>

      <div class="filter-group" style="margin-bottom:10px;">
        <label for="lssJsonTextarea">Вставь JSON экспорт LSS</label>
        <textarea
          id="lssJsonTextarea"
          rows="10"
          placeholder='Сюда можно вставить JSON целиком'
        >${escapeHtml(LSS_STATE.importPanelOpen ? getPrettyRawPreview() : "")}</textarea>
      </div>

      <div class="modal-actions" style="margin-top:10px; flex-wrap:wrap; gap:8px;">
        <button class="btn btn-success" type="button" id="lssApplyJsonBtn">Применить JSON</button>
        <button class="btn" type="button" id="lssOpenFileBtn">Загрузить JSON-файл</button>
        <input
          id="lssFileInput"
          type="file"
          accept=".json,application/json,text/plain"
          style="display:none;"
        />
      </div>

      <div class="muted" style="margin-top:10px;">
        Поддерживается экспорт LSS целиком. Сырые технические поля в пользовательском слое стараемся не показывать.
      </div>
    </div>
  `;
}


function renderLssSheetChecklist(profile) {
  if (!profile) return "";
  const info = profile.info || {};
  const vitality = profile.vitality || {};
  const checks = [];
  const add = (status, label, note) => checks.push({ status, label, note });
  const has = (value) => String(unwrapValue(value, "") || "").trim().length > 0;

  add(has(profile.name) ? "ok" : "bad", "Имя", has(profile.name) ? "есть" : "нужно назвать персонажа");
  add(has(info.charClass) ? "ok" : "bad", "Класс", has(info.charClass) ? "выбран" : "без класса конструктор не поймёт механику");
  add(has(info.race) ? "ok" : "warn", "Раса", has(info.race) ? "выбрана" : "можно заполнить позже");
  add(toNumber(unwrapValue(info.level, 0), 0) > 0 ? "ok" : "bad", "Уровень", `ур. ${Math.max(1, toNumber(unwrapValue(info.level, 1), 1))}`);
  add(toNumber(unwrapValue(vitality["hp-max"], 0), 0) > 0 ? "ok" : "bad", "HP", toNumber(unwrapValue(vitality["hp-max"], 0), 0) > 0 ? "есть максимум" : "нужен максимум хитов");
  add(toNumber(unwrapValue(vitality.ac, 0), 0) > 0 ? "ok" : "warn", "КБ", toNumber(unwrapValue(vitality.ac, 0), 0) > 0 ? "есть" : "поставь базовую защиту");

  const guide = getLssClassGuide(unwrapValue(info.charClass, ""));
  if (guide) {
    const weakStats = (guide.primaryStats || []).filter((key) => getStatScore(profile, key) < 12);
    add(weakStats.length ? "warn" : "ok", "Важные характеристики", weakStats.length ? `низко: ${formatStatList(weakStats)}` : "основа выглядит живой");
  } else {
    add("warn", "Проводник класса", "выбери класс из подсказки для автопомощи");
  }

  const icon = { ok: "✓", warn: "!", bad: "×" };
  const color = { ok: "#86efac", warn: "#facc15", bad: "#fb7185" };

  return `
    <div class="lss-constructor-checklist" style="margin:0 0 12px 0; padding:12px; border:1px solid rgba(117,203,198,.22); border-radius:14px; background:rgba(5,12,18,.48);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
        <div>
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted, #9fb0b8);">Проверка листа</div>
          <div style="font-weight:900; color:var(--gold, #d6b36a);">Что уже собрано</div>
        </div>
        <div class="muted" style="font-size:12px; max-width:360px;">Это не валидатор всех правил D&D, а навигатор: показывает, что новичок мог забыть перед игрой.</div>
      </div>
      <div class="profile-grid" style="gap:8px;">
        ${checks.map((check) => `
          <div class="meta-item" style="white-space:normal; display:flex; gap:8px; align-items:flex-start;">
            <span style="color:${color[check.status]}; font-weight:900;">${icon[check.status]}</span>
            <span><strong>${escapeHtml(check.label)}:</strong> ${escapeHtml(check.note)}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}


function getProficiencySourceLabel(source) {
  const map = { class: "класс", background: "предыстория", race: "раса", subrace: "подраса", manual: "вручную", import: "импорт", item: "предмет" };
  return map[String(source || "").toLowerCase()] || String(source || "вручную");
}

function getProficiencySourceIcon(source, checked = false) {
  const raw = String(source || (checked ? "manual" : "")).toLowerCase();
  const map = { class: "🎓", background: "📜", race: "🧬", subrace: "🧬", manual: "⚙", import: "📥", item: "🎒" };
  return map[raw] || (checked ? "⚙" : "");
}

function renderProficiencyChoice({ id, checked, label, hint = "", source = "", kind = "skill", modifier = null }) {
  const active = checked ? "btn-primary" : "btn-secondary";
  const sourceLabel = getProficiencySourceLabel(source || (checked ? "manual" : ""));
  const sourceIcon = getProficiencySourceIcon(source, checked);
  const modifierHtml = modifier !== null && modifier !== undefined
    ? `<strong class="lss-prof-mod" style="font-size:1rem; line-height:1; ${checked ? "color:#06151a;" : "color:var(--text,#e8eef2);"}">${escapeHtml(formatSigned(modifier))}</strong>`
    : "";
  const hintHtml = hint ? `<span class="lss-prof-hint" style="font-size:0.68rem; font-weight:900; opacity:.78; ${checked ? "color:rgba(6,21,26,.78);" : ""}">${escapeHtml(hint)}</span>` : "";
  const sourceHtml = sourceIcon ? `<span class="lss-prof-source" title="Источник: ${escapeHtml(sourceLabel)}" style="font-size:.82rem; line-height:1; opacity:.9; ${checked ? "color:rgba(6,21,26,.78);" : "color:var(--muted,#9fb0b8);"}">${escapeHtml(sourceIcon)}</span>` : "";

  return `
    <label class="lss-prof-choice btn ${active}" title="${escapeHtml(label)} • ${escapeHtml(sourceLabel || "клик = ручное владение")}" style="display:grid; grid-template-columns:auto minmax(0,1fr) auto; grid-template-areas:'mark name mod' 'mark meta mod'; column-gap:8px; row-gap:2px; align-items:center; justify-content:stretch; text-align:left; min-height:46px; white-space:normal; padding:8px 10px; overflow:visible; ${checked ? "color:#06151a; font-weight:900; text-shadow:none;" : ""}">
      <input id="${escapeHtml(id)}" type="checkbox" style="display:none;" ${checked ? "checked" : ""} data-lss-prof-kind="${escapeHtml(kind)}">
      <span style="grid-area:mark; font-size:1.05rem; min-width:16px; text-align:center;">${checked ? "✓" : "+"}</span>
      <span style="grid-area:name; min-width:0; white-space:normal; overflow:visible; text-overflow:clip; line-height:1.12;">${escapeHtml(label)}</span>
      <span style="grid-area:meta; min-width:0; display:flex; gap:6px; align-items:center; flex-wrap:wrap; line-height:1.05;">${hintHtml}${sourceHtml}</span>
      <span style="grid-area:mod; min-width:36px; text-align:right;">${modifierHtml}</span>
    </label>
  `;
}

function renderVitalsFormulaSummary(profile) {
  const hp = getHpFormulaPreview(profile);
  const ac = getAcFormulaPreview(profile);
  return `
    <div class="lss-editor-checks-block" style="margin:10px 0 12px;">
      <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:8px;">Формулы боя</div>
      <div class="profile-grid" style="gap:8px;">
        <div class="meta-item" style="white-space:normal; align-items:flex-start;"><strong>HP:</strong>&nbsp; ${escapeHtml(hp.text)}. Максимум сейчас: ${escapeHtml(String(hp.maxHp || "—"))}. Метод: ${escapeHtml(hp.modeLabel)}.</div>
        <div class="meta-item" style="white-space:normal; align-items:flex-start;"><strong>КБ:</strong>&nbsp; ${escapeHtml(ac.text)}</div>
      </div>
    </div>
  `;
}

function renderAbilityFormulaHint(profile) {
  const p = profile || {};
  const dexMod = getStatModifier(p, "dex");
  const pb = getProficiencyBonus(p);
  return `
    <div class="lss-editor-checks-block" style="margin:10px 0 12px;">
      <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:8px;">Как считаются проверки</div>
      <div class="profile-grid" style="gap:8px;">
        <div class="meta-item" style="white-space:normal;"><strong>Инициатива:</strong> Ловкость ${escapeHtml(formatSigned(dexMod))}, можно править вручную.</div>
        <div class="meta-item" style="white-space:normal;"><strong>Навык:</strong> модификатор характеристики + ${escapeHtml(formatSigned(pb))} если есть владение.</div>
        <div class="meta-item" style="white-space:normal;"><strong>Спасбросок:</strong> модификатор характеристики + владение, если отмечено.</div>
      </div>
    </div>
  `;
}

function renderStatsRulePanel(profile, mode = "edit") {
  const p = profile || {};
  const method = getStatMethodValue(p);
  const targetPrefix = mode === "quick" ? "lssQuick" : "lssEdit";
  return `
    <div class="lss-editor-checks-block" style="margin:10px 0 12px; padding:10px 12px; border:1px solid rgba(117,203,198,.16); border-radius:14px; background:rgba(5,12,18,.28);">
      <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
        <div>
          <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em;">Правила характеристик</div>
          <div style="font-weight:900; color:var(--gold,#d6b36a);">Как получены статы</div>
        </div>
        <div class="modal-actions" style="gap:6px; margin:0;">
          <button class="btn btn-secondary" type="button" id="${targetPrefix}ApplyStatsBtn">Стандарт под класс</button>
          <button class="btn btn-secondary" type="button" id="${targetPrefix}RollStatsBtn">🎲 4к6</button>
        </div>
      </div>
      <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px;">
        <div class="filter-group"><label>Метод</label><select id="${mode === "quick" ? "lssQuickCreateStatsMethod" : "lssEdit_statsMethod"}">${getStatsMethodOptionsHtml(method)}</select></div>
        <div class="meta-item" style="white-space:normal; align-items:flex-start;"><strong>Стандарт:</strong>&nbsp;15, 14, 13, 12, 10, 8 — кнопка раскидывает по важным статам класса.</div>
        <div class="meta-item" style="white-space:normal; align-items:flex-start;"><strong>Покупка очков:</strong>&nbsp;пока сохраняем метод и даём безопасный шаблон; полный бюджет 27 отдельным data-pass.</div>
        <div class="meta-item" style="white-space:normal; align-items:flex-start;"><strong>Броски:</strong>&nbsp;4к6, убрать меньшую, сумма трёх. Результат сразу попадает в поля.</div>
      </div>
    </div>
  `;
}

function renderHpRulePanel(profile, mode = "edit") {
  const hp = getHpFormulaPreview(profile);
  const prefix = mode === "quick" ? "lssQuick" : "lssEdit";
  return `
    <div class="lss-editor-checks-block" style="margin:10px 0 12px; padding:10px 12px; border:1px solid rgba(199,162,91,.18); border-radius:14px; background:rgba(5,12,18,.28);">
      <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
        <div>
          <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em;">Правила HP</div>
          <div style="font-weight:900; color:var(--gold,#d6b36a);">Среднее / бросок / ручное</div>
        </div>
        <div class="modal-actions" style="gap:6px; margin:0;">
          <button class="btn btn-secondary" type="button" id="${prefix}ApplyAverageHpBtn">≈ Среднее</button>
          <button class="btn btn-secondary" type="button" id="${prefix}RollHpBtn">🎲 Бросить прирост</button>
        </div>
      </div>
      <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px;">
        <div class="filter-group"><label>Метод HP</label><select id="${mode === "quick" ? "lssQuickCreateHpMode" : "lssEdit_hpMode"}">${getHpModeOptionsHtml(hp.mode)}</select></div>
        <div class="meta-item" style="white-space:normal; align-items:flex-start;"><strong>Формула:</strong>&nbsp;${escapeHtml(hp.text)}</div>
        <div class="meta-item" style="white-space:normal; align-items:flex-start;"><strong>Текущий максимум:</strong>&nbsp;${escapeHtml(String(hp.maxHp || "—"))}. Метод: ${escapeHtml(hp.modeLabel)}.</div>
      </div>
    </div>
  `;
}

function renderMulticlassPanel(profile) {
  const p = profile || {};
  const info = p.info || {};
  const enabled = Boolean(unwrapValue(info.multiclassEnabled, false));
  const mainGuide = getLssClassGuide(unwrapValue(info.charClass, ""));
  const mainRule = mainGuide ? evaluateMulticlassRule(p, mainGuide.id) : null;
  const currentText = safeText(unwrapValue(info.multiclass, ""), "");
  const ruleRows = (getRulesClassList().length ? getRulesClassList() : LSS_CLASS_GUIDES).map((guide) => {
    const result = evaluateMulticlassRule(p, guide.id);
    const marker = result.ok ? "✓" : "•";
    return `<span class="meta-item" style="white-space:normal; ${result.ok ? "border-color:rgba(134,239,172,.32);" : ""}">${marker} ${escapeHtml(guide.label)}: ${escapeHtml(result.text)}</span>`;
  }).join("");

  return `
    <div class="lss-editor-checks-block" style="margin:10px 0 12px; padding:10px 12px; border:1px solid rgba(117,203,198,.16); border-radius:14px; background:rgba(5,12,18,.28);">
      <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
        <div>
          <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em;">Мультикласс</div>
          <div style="font-weight:900; color:var(--gold,#d6b36a);">Дополнительные классы</div>
        </div>
        <label class="btn ${enabled ? "btn-primary" : "btn-secondary"}" style="cursor:pointer;">
          <input id="lssEdit_multiclassEnabled" type="checkbox" style="display:none;" ${enabled ? "checked" : ""}>
          ${enabled ? "✓ Мультикласс включён" : "＋ Мультикласс"}
        </label>
      </div>
      <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:8px;">
        <div class="filter-group"><label>Классы и уровни</label><input id="lssEdit_multiclass" type="text" maxlength="120" data-lss-text="short" value="${escapeHtml(currentText)}" placeholder="Напр.: Воин 2 / Волшебник 3"></div>
        <div class="meta-item" style="white-space:normal; align-items:flex-start;"><strong>Главный класс:</strong>&nbsp;${escapeHtml(mainGuide?.label || "не выбран")} ${mainRule ? `• требования: ${escapeHtml(mainRule.text)} ${mainRule.ok ? "✓" : "не выполнены"}` : ""}</div>
        <div class="meta-item" style="white-space:normal; align-items:flex-start;"><strong>Важно:</strong>&nbsp;сейчас это безопасная заготовка правил. Ячейки заклинаний и прогресс классов подключим после data-layer.</div>
      </div>
      <details style="margin-top:8px;">
        <summary class="muted" style="cursor:pointer;">Показать требования ко всем классам</summary>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">${ruleRows}</div>
      </details>
    </div>
  `;
}

function renderDerivedProficiencySummary(profile) {
  const p = profile || {};
  const classGuide = getLssClassGuide(unwrapValue(p?.info?.charClass, ""));
  const raceGuide = getLssRaceGuide(unwrapValue(p?.info?.race, ""));
  const backgroundGuide = getLssBackgroundGuide(unwrapValue(p?.info?.background, ""));
  const rows = [];
  if (classGuide) rows.push(`Класс: спасброски ${formatStatList(classGuide.saves)}, броня — ${classGuide.armor || "—"}, оружие — ${classGuide.weapons || "—"}`);
  if (raceGuide) rows.push(`Раса: размер ${raceGuide.size}, скорость ${raceGuide.speed} фт., языки — ${raceGuide.languages || "—"}`);
  if (backgroundGuide) rows.push(`Предыстория: навыки ${formatSkillList(backgroundGuide.skills)}, инструменты/языки — ${joinNonEmpty([backgroundGuide.tools, backgroundGuide.languages], "; ") || "—"}`);
  if (!rows.length) return "";
  return `
    <div class="lss-editor-checks-block" style="margin-bottom:12px;">
      <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:8px;">Владения от источников</div>
      <div style="display:grid; gap:8px;">
        ${rows.map((row) => `<div class="meta-item" style="white-space:normal; justify-content:flex-start;">${escapeHtml(row)}</div>`).join("")}
      </div>
      <div class="muted" style="margin-top:8px; font-size:0.76rem;">Кнопки ниже — не сырой чеклист: ✓ уже есть владение, + можно вручную добавить. При сохранении класс/раса/предыстория снова подставят свои владения.</div>
    </div>
  `;
}

function renderEditPanel(profile) {
  const p = profile || {};
  const info = p.info || {};
  const subInfo = p.subInfo || {};
  const vitality = p.vitality || {};
  const coins = getCoins(p);
  const portraitUrl = getPortraitUrl(p);

  return `
    <div class="cabinet-block lss-editor-shell" id="lssEditPanel" style="${LSS_STATE.editPanelOpen ? "" : "display:none;"} margin-bottom:12px;">
      <div class="flex-between" style="align-items:flex-start; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
        <div>
          <h4 style="margin:0 0 6px 0;">Конструктор LSS</h4>
          <div class="muted" style="font-size:0.82rem;">Конструктор: выбираем основу, а механика подтягивается из LSS-cache, совместимого с данными Бестиария.</div>
        </div>
        <div class="lss-jump-rail">
          <button class="btn btn-secondary" type="button" data-lss-jump="lssEditIdentity">Основа</button>
          <button class="btn btn-secondary" type="button" data-lss-jump="lssEditVitals">Бой</button>
          <button class="btn btn-secondary" type="button" data-lss-jump="lssEditPortrait">Портрет</button>
          <button class="btn btn-secondary" type="button" data-lss-jump="lssEditStory">Лор</button>
          <button class="btn btn-secondary" type="button" data-lss-jump="lssEditNotes">Заметки</button>
        </div>
      </div>

      ${renderLssSheetChecklist(p)}

      <div class="lss-editor-grid">
        <section class="lss-editor-section" id="lssEditIdentity">
          <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
            <div>
              <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em;">Паспорт</div>
              <div style="font-weight:800; margin-top:4px;">Основа персонажа</div>
            </div>
            <span class="meta-item">ядро листа</span>
          </div>
          <div class="profile-grid">
            <div class="filter-group"><label>Имя</label><input id="lssEdit_name" type="text" maxlength="60" data-lss-text="name" value="${escapeHtml(safeText(unwrapValue(p.name, ""), ""))}" /></div>
            <div class="filter-group"><label>Класс</label><select id="lssEdit_charClass" data-lss-text="short">${getLssClassSelectOptionsHtml(unwrapValue(info.charClass, ""))}</select></div>
            <div class="filter-group"><label>Подкласс</label><select id="lssEdit_charSubclass" data-lss-text="short">${getLssSubclassSelectOptionsHtml(unwrapValue(info.charClass, ""), unwrapValue(info.charSubclass, ""))}</select><div id="lssEditSubclassHint">${renderLssSubclassHint(unwrapValue(info.charClass, ""), unwrapValue(info.charSubclass, ""), unwrapValue(info.level, 1))}</div></div>
            <div class="filter-group"><label>Уровень</label><input id="lssEdit_level" ${numericInputAttrs(1, 20)} value="${escapeHtml(safeText(unwrapValue(info.level, "1"), "1"))}" /></div>
            <div class="filter-group"><label>Раса</label><select id="lssEdit_race" data-lss-text="short">${getLssRaceSelectOptionsHtml(unwrapValue(info.race, ""))}</select></div>
            <div class="filter-group"><label>Подраса / вариант</label><select id="lssEdit_subrace" data-lss-text="short">${getLssSubraceSelectOptionsHtml(unwrapValue(info.race, ""), unwrapValue(info.subrace, ""))}</select><div id="lssEditSubraceHint">${renderLssSubraceHint(unwrapValue(info.race, ""), unwrapValue(info.subrace, ""))}</div></div>
            <div class="filter-group"><label>Предыстория</label><select id="lssEdit_background" data-lss-text="short">${getLssBackgroundSelectOptionsHtml(unwrapValue(info.background, ""))}</select></div>
            <div class="filter-group lss-ref-field-main"><label>Мировоззрение / моральная ось</label>${renderLssAlignmentGrid("lssEdit_alignment", unwrapValue(info.alignment, ""))}</div>
            <div class="filter-group"><label>Размер</label><select id="lssEdit_size">${getSizeOptionsHtml(unwrapValue(info.size, "medium"))}</select></div>
            <div class="filter-group"><label>Опыт</label><input id="lssEdit_experience" ${numericInputAttrs(0)} value="${escapeHtml(safeText(unwrapValue(info.experience, "0"), "0"))}" /></div>
          </div>
          ${renderMulticlassPanel(p)}
          ${renderLssMechanicsSources(p)}
          ${renderLssClassGuidanceCard(unwrapValue(info.charClass, ""), { mode: "edit" })}
          ${renderLssRulesProgressionPanel("edit")}
          ${renderLssAsiFeatPanel("edit")}

          <div class="profile-grid" style="margin-top:12px;">
            <div class="filter-group"><label>Возраст</label><input id="lssEdit_age" type="text" inputmode="numeric" value="${escapeHtml(safeText(unwrapValue(subInfo.age, ""), ""))}" /></div>
            <div class="filter-group"><label>Рост</label><input id="lssEdit_height" type="text" inputmode="decimal" value="${escapeHtml(safeText(unwrapValue(subInfo.height, ""), ""))}" /></div>
            <div class="filter-group"><label>Вес</label><input id="lssEdit_weight" type="text" inputmode="decimal" value="${escapeHtml(safeText(unwrapValue(subInfo.weight, ""), ""))}" /></div>
            <div class="filter-group"><label>Глаза</label><input id="lssEdit_eyes" type="text" value="${escapeHtml(safeText(unwrapValue(subInfo.eyes, ""), ""))}" /></div>
            <div class="filter-group"><label>Кожа</label><input id="lssEdit_skin" type="text" value="${escapeHtml(safeText(unwrapValue(subInfo.skin, ""), ""))}" /></div>
            <div class="filter-group"><label>Волосы</label><input id="lssEdit_hair" type="text" value="${escapeHtml(safeText(unwrapValue(subInfo.hair, ""), ""))}" /></div>
          </div>
        </section>

        <section class="lss-editor-section" id="lssEditVitals">
          <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
            <div>
              <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em;">Бой</div>
              <div style="font-weight:800; margin-top:4px;">Живучесть и темп</div>
            </div>
            <span class="meta-item">HP / AC / Init</span>
          </div>
          <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));">
            <div class="filter-group"><label>HP текущие</label><input id="lssEdit_hpCurrent" ${numericInputAttrs(0)} value="${escapeHtml(safeText(unwrapValue(vitality["hp-current"], "0"), "0"))}" /></div>
            <div class="filter-group"><label>HP максимум</label><input id="lssEdit_hpMax" ${numericInputAttrs(1)} value="${escapeHtml(safeText(unwrapValue(vitality["hp-max"], "1"), "1"))}" /></div>
            <div class="filter-group"><label>Временные HP</label><input id="lssEdit_hpTemp" ${numericInputAttrs(0)} value="${escapeHtml(safeText(unwrapValue(vitality["hp-temp"], "0"), "0"))}" /></div>
            <div class="filter-group"><label>Кость хитов класса</label><select id="lssEdit_hitDie">${getHitDieOptionsHtml(getHitDieValue(p))}</select><small class="muted">тип кости: d6/d8/d10...</small></div>
            <div class="filter-group"><label>Кости отдыха</label><input id="lssEdit_hitDiceCurrent" ${numericInputAttrs(0)} value="${escapeHtml(safeText(unwrapValue(vitality["hp-dice-current"], unwrapValue(info.level, "1")), "1"))}" /><small class="muted">сколько костей хитов доступно</small></div>
            <div class="filter-group"><label>КБ итоговая</label><input id="lssEdit_ac" ${numericInputAttrs(0)} value="${escapeHtml(safeText(unwrapValue(vitality.ac, "10"), "10"))}" /></div>
            <div class="filter-group"><label>Скорость, фт.</label><input id="lssEdit_speed" ${numericInputAttrs(0)} value="${escapeHtml(safeText(unwrapValue(vitality.speed, "30"), "30"))}" /></div>
            <div class="filter-group"><label>Инициатива <small>авто от Ловкости</small></label><input id="lssEdit_initiative" type="number" inputmode="numeric" value="${escapeHtml(String(getInitiativeModifier(p)))}" data-auto-value="${escapeHtml(String(getDexInitiative(p)))}" /><input id="lssEdit_initiativeAuto" type="hidden" value="${String(unwrapValue(vitality.initiative, "")) === "" ? "1" : "0"}"><small class="muted">Авто сейчас: ${escapeHtml(formatSigned(getDexInitiative(p)))}. Можно вписать вручную.</small></div>
            <div class="filter-group"><label>Бонус владения</label><input id="lssEdit_proficiency" ${numericInputAttrs(0)} value="${escapeHtml(String(getProficiencyBonus(p)))}" /></div>
          </div>
          ${renderHpRulePanel(p, "edit")}
          ${renderVitalsFormulaSummary(p)}
          ${renderStatsRulePanel(p, "edit")}
          <div class="profile-grid" style="margin-top:12px;">
            <div class="filter-group"><label>Сила <small>STR</small></label><input id="lssEdit_stat_str" ${numericInputAttrs(1, 30)} value="${escapeHtml(String(unwrapValue(p?.stats?.str?.score, 10)))}" /></div>
            <div class="filter-group"><label>Ловкость <small>DEX</small></label><input id="lssEdit_stat_dex" ${numericInputAttrs(1, 30)} value="${escapeHtml(String(unwrapValue(p?.stats?.dex?.score, 10)))}" /></div>
            <div class="filter-group"><label>Телосложение <small>CON</small></label><input id="lssEdit_stat_con" ${numericInputAttrs(1, 30)} value="${escapeHtml(String(unwrapValue(p?.stats?.con?.score, 10)))}" /></div>
            <div class="filter-group"><label>Интеллект <small>INT</small></label><input id="lssEdit_stat_int" ${numericInputAttrs(1, 30)} value="${escapeHtml(String(unwrapValue(p?.stats?.int?.score, 10)))}" /></div>
            <div class="filter-group"><label>Мудрость <small>WIS</small></label><input id="lssEdit_stat_wis" ${numericInputAttrs(1, 30)} value="${escapeHtml(String(unwrapValue(p?.stats?.wis?.score, 10)))}" /></div>
            <div class="filter-group"><label>Харизма <small>CHA</small></label><input id="lssEdit_stat_cha" ${numericInputAttrs(1, 30)} value="${escapeHtml(String(unwrapValue(p?.stats?.cha?.score, 10)))}" /></div>
          </div>

          ${renderAbilityFormulaHint(p)}

          ${renderDerivedProficiencySummary(p)}

          <div class="lss-editor-checks-block">
            <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:8px;">Спасброски с владением</div>
            <div class="lss-editor-check-grid lss-editor-check-grid-stats" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:8px;">
              ${STAT_DEFS.map(({ key, label }) => renderProficiencyChoice({
                id: `lssEdit_save_${key}`,
                checked: hasSaveProficiency(p, key),
                label,
                hint: key.toUpperCase(),
                source: getNested(p, `saves.${key}.source`, hasSaveProficiency(p, key) ? "class" : ""),
                kind: "save",
                modifier: getSaveModifier(p, key),
              })).join("")}
            </div>
          </div>

          <div class="lss-editor-checks-block">
            <div class="flex-between" style="align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:8px;"><div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em;">Навыки с владением</div><div class="muted" style="font-size:0.76rem;">+ добавляет владение сразу; ⚙ = вручную</div></div>
            <div class="lss-editor-check-grid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px;">
              ${Object.entries(SKILL_BASE_STATS).map(([skillKey, baseStat]) => renderProficiencyChoice({
                id: `lssEdit_skill_${lssEditDomKey(skillKey)}`,
                checked: isSkillProficient(p, skillKey),
                label: SKILL_LABELS[skillKey] || skillKey,
                hint: getStatShortLabel(baseStat),
                source: getNested(p, `skills.${skillKey}.source`, isSkillProficient(p, skillKey) ? "manual" : ""),
                kind: "skill",
                modifier: getSkillModifier(p, skillKey),
              })).join("")}
            </div>
          </div>

          <div class="lss-editor-checks-block">
            <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:8px;">Монеты</div>
            <div class="profile-grid">
              <div class="filter-group"><label>Платина</label><input id="lssEdit_coin_pp" ${numericInputAttrs(0)} value="${escapeHtml(String(coins.pp))}" /></div>
              <div class="filter-group"><label>Золото</label><input id="lssEdit_coin_gp" ${numericInputAttrs(0)} value="${escapeHtml(String(coins.gp))}" /></div>
              <div class="filter-group"><label>Электрум</label><input id="lssEdit_coin_ep" ${numericInputAttrs(0)} value="${escapeHtml(String(coins.ep))}" /></div>
              <div class="filter-group"><label>Серебро</label><input id="lssEdit_coin_sp" ${numericInputAttrs(0)} value="${escapeHtml(String(coins.sp))}" /></div>
              <div class="filter-group"><label>Медь</label><input id="lssEdit_coin_cp" ${numericInputAttrs(0)} value="${escapeHtml(String(coins.cp))}" /></div>
            </div>
          </div>
        </section>

        <section class="lss-editor-section" id="lssEditPortrait">
          <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
            <div>
              <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em;">Портрет</div>
              <div style="font-weight:800; margin-top:4px;">Внешний вид персонажа</div>
            </div>
          </div>
          <div class="profile-grid" style="align-items:start;">
            <div>
              ${
                portraitUrl
                  ? `
                    <div class="trader-modal-image-wrap" style="max-width:220px;">
                      <img
                        class="trader-modal-image"
                        src="${escapeHtml(portraitUrl)}"
                        alt="Фото персонажа"
                        loading="lazy"
                        referrerpolicy="no-referrer"
                        onerror="this.closest('.trader-modal-image-wrap')?.insertAdjacentHTML('afterend','<div class=&quot;stat-box&quot; style=&quot;min-height:220px;display:flex;align-items:center;justify-content:center;font-size:48px;&quot;>🧙</div>'); this.closest('.trader-modal-image-wrap')?.remove();"
                      />
                    </div>
                  `
                  : `<div class="stat-box" style="min-height:220px;display:flex;align-items:center;justify-content:center;font-size:48px;">🧙</div>`
              }
            </div>
            <div>
              <div class="filter-group">
                <label>Ссылка на фото / data:image</label>
                <input id="lssEdit_portrait" type="text" value="${escapeHtml(safeText(portraitUrl, ""))}" placeholder="https://... или data:image/..." />
              </div>
              <div class="modal-actions" style="margin-top:10px;">
                <button class="btn btn-primary" type="button" id="lssPickImageBtn">Выбрать фото</button>
                <button class="btn" type="button" id="lssApplyPortraitBtn">Применить ссылку</button>
                <button class="btn btn-danger" type="button" id="lssClearImageBtn">Убрать фото</button>
                <input id="lssImageFileInput" type="file" accept="image/*" style="display:none;" />
              </div>
              <div class="muted" style="margin-top:10px;">Можно вставить ссылку на картинку или выбрать локальный файл. Локальное фото сохранится в браузере.</div>
            </div>
          </div>
        </section>

        <section class="lss-editor-section" id="lssEditStory">
          <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
            <div>
              <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em;">Лор</div>
              <div style="font-weight:800; margin-top:4px;">История и личность</div>
            </div>
            <span class="meta-item">RP слой</span>
          </div>
          <div class="filter-group"><label>Внешность</label><textarea id="lssEdit_appearance" rows="4">${escapeHtml(safeText(p.appearance, ""))}</textarea></div>
          <div class="filter-group" style="margin-top:12px;"><label>Предыстория / лор</label><textarea id="lssEdit_backgroundText" rows="4">${escapeHtml(safeText(p.background, ""))}</textarea></div>
          <div class="profile-grid" style="margin-top:12px;">
            <div class="filter-group"><label>Личность</label><textarea id="lssEdit_personality" rows="4">${escapeHtml(safeText(p.personality, ""))}</textarea></div>
            <div class="filter-group"><label>Идеалы</label><textarea id="lssEdit_ideals" rows="4">${escapeHtml(safeText(p.ideals, ""))}</textarea></div>
            <div class="filter-group"><label>Привязанности</label><textarea id="lssEdit_bonds" rows="4">${escapeHtml(safeText(p.bonds, ""))}</textarea></div>
            <div class="filter-group"><label>Изъяны</label><textarea id="lssEdit_flaws" rows="4">${escapeHtml(safeText(p.flaws, ""))}</textarea></div>
          </div>
        </section>

        <section class="lss-editor-section" id="lssEditLoadout">
          <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
            <div>
              <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em;">Лист</div>
              <div style="font-weight:800; margin-top:4px;">Снаряжение и особенности</div>
            </div>
          </div>
          <div class="profile-grid">
            <div class="filter-group"><label>Снаряжение</label><textarea id="lssEdit_equipment" rows="4">${escapeHtml(safeText(p.equipment, ""))}</textarea></div>
            <div class="filter-group"><label>Владения / языки</label><textarea id="lssEdit_proficiencies" rows="4">${escapeHtml(safeText(p.prof, ""))}</textarea></div>
            <div class="filter-group"><label>Союзники</label><textarea id="lssEdit_allies" rows="4">${escapeHtml(safeText(p.allies, ""))}</textarea></div>
            <div class="filter-group"><label>Цели / задачи</label><textarea id="lssEdit_goals" rows="4">${escapeHtml(safeText(p.quests, ""))}</textarea></div>
          </div>
          <div class="filter-group" style="margin-top:12px;"><label>Особенности / классовые черты</label><textarea id="lssEdit_features" rows="4">${escapeHtml(safeText(p.attacks, ""))}</textarea></div>
        </section>

        <section class="lss-editor-section" id="lssEditNotes">
          <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
            <div>
              <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em;">Заметки</div>
              <div style="font-weight:800; margin-top:4px;">Свободные поля</div>
            </div>
          </div>
          <div class="profile-grid">
            <div class="filter-group"><label>Заметка 1</label><textarea id="lssEdit_notes1" rows="4">${escapeHtml(safeText(p["notes-1"], ""))}</textarea></div>
            <div class="filter-group"><label>Заметка 2</label><textarea id="lssEdit_notes2" rows="4">${escapeHtml(safeText(p["notes-2"], ""))}</textarea></div>
          </div>
        </section>
      </div>

      <div class="modal-actions" style="margin-top:12px;">
        <button class="btn btn-success" type="button" id="lssSaveEditBtn">Сохранить персонажа в профиль</button>
        <button class="btn btn-secondary" type="button" id="lssSaveAsNewBottomBtn">Сохранить как нового</button>
        <button class="btn btn-secondary" type="button" data-lss-jump-top="1">Наверх</button>
      </div>

      <div class="muted" style="margin-top:10px;">
        Сохраняются основа персонажа, боевые цифры, характеристики, спасброски, навыки, монеты и текстовые блоки. Сложные оружие/заклинания из импортированного JSON не стираются.
      </div>
    </div>
  `;
}

async function readFileAsText(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsText(file);
  });
}


function refreshClassGuidePanel(inputId, panelId) {
  const input = getSection(inputId);
  const panel = getSection(panelId);
  if (!input || !panel) return;
  const mode = panelId.includes("Edit") ? "edit" : "quick";
  const levelValue = mode === "edit" ? getSection("lssEdit_level")?.value : getSection("lssQuickCreateLevel")?.value;
  const html = renderLssClassGuidanceCard(input.value || "", { mode, level: levelValue });
  const temp = document.createElement("div");
  temp.innerHTML = html.trim();
  const next = temp.firstElementChild;
  if (next) panel.replaceWith(next);
  refreshLssDependentChoiceLists(mode);
}

function refreshLssDependentChoiceLists(mode = "edit") {
  const isEdit = mode === "edit";
  const classInput = getSection(isEdit ? "lssEdit_charClass" : "lssQuickCreateClass");
  const raceInput = getSection(isEdit ? "lssEdit_race" : "lssQuickCreateRace");
  const subclassList = getSection(isEdit ? "lssEditSubclassOptions" : "lssQuickSubclassOptions");
  const subclassControl = getSection(isEdit ? "lssEdit_charSubclass" : "lssQuickCreateSubclass");
  const subraceDatalist = getSection(isEdit ? "lssEditSubraceOptions" : "lssQuickSubraceOptions");
  const subraceControl = getSection(isEdit ? "lssEdit_subrace" : "lssQuickCreateSubrace");

  const className = readLssChoiceControlValue(isEdit ? "lssEdit_charClass" : "lssQuickCreateClass", "");
  const currentSubclass = readLssChoiceControlValue(isEdit ? "lssEdit_charSubclass" : "lssQuickCreateSubclass", "");
  if (subclassList) subclassList.innerHTML = getLssSubclassOptionsHtml(className);
  if (subclassControl?.tagName === "SELECT") {
    subclassControl.innerHTML = getLssSubclassSelectOptionsHtml(className, currentSubclass);
    if (currentSubclass && !getLssSubclassGuide(className, currentSubclass)) {
      subclassControl.value = "";
    } else {
      subclassControl.value = currentSubclass;
    }
  }

  const raceName = readLssChoiceControlValue(isEdit ? "lssEdit_race" : "lssQuickCreateRace", "");
  const currentSubrace = readLssChoiceControlValue(isEdit ? "lssEdit_subrace" : "lssQuickCreateSubrace", "");
  if (subraceDatalist) subraceDatalist.innerHTML = getLssSubraceOptionsHtml(raceName);
  if (subraceControl?.tagName === "SELECT") {
    subraceControl.innerHTML = getLssSubraceSelectOptionsHtml(raceName, currentSubrace);
    if (currentSubrace && !getLssSubraceGuide(raceName, currentSubrace)) {
      subraceControl.value = "";
    } else {
      subraceControl.value = currentSubrace;
    }
  }

  refreshLssChoiceHintBlocks(mode);
}

function refreshLssChoiceHintBlocks(mode = "quick") {
  const isEdit = mode === "edit";
  const ctx = getFormSelectionContext(mode);
  const level = getLssFormLevel(mode);

  const subclassHint = getSection(isEdit ? "lssEditSubclassHint" : "lssQuickSubclassHint");
  if (subclassHint) {
    subclassHint.innerHTML = renderLssSubclassHint(ctx.className, ctx.subclassName, level);
  }

  const subraceHint = getSection(isEdit ? "lssEditSubraceHint" : "lssQuickSubraceHint");
  if (subraceHint) {
    subraceHint.innerHTML = renderLssSubraceHint(ctx.raceName, ctx.subraceName);
  }
}

function scheduleLssConstructorDerivedRefresh(mode = "quick") {
  const key = mode === "edit" ? "editConstructorRefreshTimer" : "quickConstructorRefreshTimer";
  if (LSS_STATE[key]) window.clearTimeout(LSS_STATE[key]);
  LSS_STATE[key] = window.setTimeout(() => {
    syncLssChoiceSnapshot(mode);
    refreshLssChoiceHintBlocks(mode);
    refreshLssSourceBonusesPanel(mode);
    refreshLssRulesProgressionPanel(mode);
    refreshLssAsiFeatPanel(mode);
    LSS_STATE[key] = null;
  }, 0);
}

function bindLssConstructorDelegatedRefresh() {
  if (LSS_STATE.constructorDelegatedRefreshBound === "1") return;
  LSS_STATE.constructorDelegatedRefreshBound = "1";
  const handle = (event) => {
    const target = event.target;
    if (!target?.id) return;
    const id = String(target.id);
    const isQuick = id.startsWith("lssQuickCreate");
    const isEdit = id.startsWith("lssEdit_");
    if (!isQuick && !isEdit) return;
    const mode = isEdit ? "edit" : "quick";

    if (id === "lssQuickCreateClass") {
      refreshClassGuidePanel("lssQuickCreateClass", "lssQuickClassGuide");
      refreshLssDependentChoiceLists("quick");
      applyQuickClassDefaults();
      applyQuickDexDefaults();
      LSS_STATE.quickAppliedAbilityBonusKey = "";
    } else if (id === "lssQuickCreateRace") {
      LSS_STATE.quickAppliedAbilityBonusKey = "";
      applyQuickRaceDefaults();
    } else if (id === "lssEdit_charClass") {
      refreshClassGuidePanel("lssEdit_charClass", "lssEditClassGuide");
      refreshLssDependentChoiceLists("edit");
    } else if (id === "lssEdit_race") {
      refreshLssDependentChoiceLists("edit");
    }

    scheduleLssConstructorDerivedRefresh(mode);
  };
  document.addEventListener("change", handle);
  document.addEventListener("input", handle);
}

function applyEditFormLive(toastMessage = "Лист обновлён локально") {
  if (!getSection("lssEditPanel") || !LSS_STATE.profile) return;
  const nextProfile = normalizeLssProfileForSave(applyBasicFormToProfile(collectEditFormData()));
  setLssData(nextProfile, { persistLocal: true, source: "manual" });
  LSS_STATE.editPanelOpen = true;
  renderLSS();
  if (toastMessage) showToast(toastMessage);
}

function applyQuickClassDefaults() {
  const classInput = getSection("lssQuickCreateClass");
  const guide = getLssClassGuide(classInput?.value || "");
  const levelInput = getSection("lssQuickCreateLevel");
  const proficiencyInput = getSection("lssQuickCreateProficiency");
  const hpInput = getSection("lssQuickCreateHp");
  const hpMaxInput = getSection("lssQuickCreateHpMax");
  const hitDieSelect = getSection("lssQuickCreateHitDie");
  const hitDiceInput = getSection("lssQuickCreateHitDiceCurrent");
  const conInput = getSection("lssQuickCreateStat_con");

  if (proficiencyInput) {
    proficiencyInput.value = String(getProficiencyBonusByLevel(levelInput?.value || 1));
  }

  if (!guide) return;

  if (hitDieSelect) hitDieSelect.value = `d${guide.hitDie}`;
  if (hitDiceInput && (!String(hitDiceInput.value || "").trim() || hitDiceInput.value === "1" || hitDiceInput.dataset.autoValue === hitDiceInput.value)) {
    const levelValue = Math.max(1, toNumber(levelInput?.value || 1, 1));
    hitDiceInput.value = String(levelValue);
    hitDiceInput.dataset.autoValue = String(levelValue);
  }

  const conScore = toNumber(conInput?.value, 10);
  const hpMode = normalizeHpMode(getSection("lssQuickCreateHpMode")?.value || "average", "average");
  const levelValueForHp = Math.max(1, toNumber(levelInput?.value || 1, 1));
  const expectedHp = hpMode === "average"
    ? getAverageHpForLevel(`d${guide.hitDie}`, levelValueForHp, statMod(conScore))
    : getExpectedLevelOneHp(guide, conScore);
  const currentClass = String(classInput?.value || "").trim();
  const previousClass = classInput?.dataset?.appliedClass || "";
  const classChanged = currentClass && currentClass !== previousClass;

  const canTouchHp = (el) => {
    if (!el) return false;
    const value = String(el.value || "").trim();
    return classChanged || value === "" || value === "10" || value === String(el.dataset.autoValue || "");
  };

  if (canTouchHp(hpInput)) {
    hpInput.value = String(expectedHp);
    hpInput.dataset.autoValue = String(expectedHp);
  }
  if (canTouchHp(hpMaxInput)) {
    hpMaxInput.value = String(expectedHp);
    hpMaxInput.dataset.autoValue = String(expectedHp);
  }

  if (classInput) classInput.dataset.appliedClass = currentClass;
}

function applyQuickDexDefaults() {
  const dexInput = getSection("lssQuickCreateStat_dex");
  const initiativeInput = getSection("lssQuickCreateInitiative");
  if (!dexInput || !initiativeInput) return;
  const autoValue = statMod(clampNumber(dexInput.value, 1, 30, 10));
  const previousAuto = String(initiativeInput.dataset.autoValue ?? "");
  const current = String(initiativeInput.value ?? "");
  if (initiativeInput.dataset.manual !== "1" || current === previousAuto || current === "") {
    initiativeInput.value = String(autoValue);
  }
  initiativeInput.dataset.autoValue = String(autoValue);
}

function applyQuickRaceDefaults() {
  const raceInput = getSection("lssQuickCreateRace");
  const sizeSelect = getSection("lssQuickCreateSize");
  const speedInput = getSection("lssQuickCreateSpeed");
  refreshLssDependentChoiceLists("quick");
  const guide = getLssRaceGuide(raceInput?.value || "");
  if (!guide) return;

  if (sizeSelect) {
    const option = LSS_SIZE_OPTIONS.find((item) => item.label === guide.size);
    sizeSelect.value = option?.value || normalizeSizeKey(guide.size || "medium");
  }

  if (speedInput) {
    const current = String(speedInput.value || "").trim();
    if (!current || current === "30" || current === String(speedInput.dataset.autoValue || "")) {
      speedInput.value = String(guide.speed || 30);
      speedInput.dataset.autoValue = String(guide.speed || 30);
    }
  }
}


function getFormHpContext(mode = "quick") {
  const isEdit = mode === "edit";
  const className = getSection(isEdit ? "lssEdit_charClass" : "lssQuickCreateClass")?.value || unwrapValue(LSS_STATE.profile?.info?.charClass, "");
  const hitDie = normalizeHitDie(getSection(isEdit ? "lssEdit_hitDie" : "lssQuickCreateHitDie")?.value || "d8", "d8");
  const level = clampNumber(getSection(isEdit ? "lssEdit_level" : "lssQuickCreateLevel")?.value || unwrapValue(LSS_STATE.profile?.info?.level, 1), 1, 20, 1);
  const conScore = clampNumber(getSection(isEdit ? "lssEdit_stat_con" : "lssQuickCreateStat_con")?.value || getNested(LSS_STATE.profile, "stats.con.score", 10), 1, 30, 10);
  const guide = getLssClassGuide(className);
  return { className, hitDie: guide ? `d${guide.hitDie}` : hitDie, level, conScore, conMod: statMod(conScore) };
}

function setFormHpValues(mode = "quick", hpMax, hpMode = "average") {
  const isEdit = mode === "edit";
  const hpInput = getSection(isEdit ? "lssEdit_hpCurrent" : "lssQuickCreateHp");
  const hpMaxInput = getSection(isEdit ? "lssEdit_hpMax" : "lssQuickCreateHpMax");
  const hpModeSelect = getSection(isEdit ? "lssEdit_hpMode" : "lssQuickCreateHpMode");
  if (hpMaxInput) hpMaxInput.value = String(Math.max(1, toNumber(hpMax, 1)));
  if (hpInput) hpInput.value = String(Math.max(1, toNumber(hpMax, 1)));
  if (hpModeSelect) hpModeSelect.value = normalizeHpMode(hpMode, "average");
  if (isEdit) applyEditFormLive(hpMode === "roll" ? "HP увеличены броском" : "HP пересчитаны по среднему");
}

function applyAverageHpToForm(mode = "quick") {
  const ctx = getFormHpContext(mode);
  const hp = getAverageHpForLevel(ctx.hitDie, ctx.level, ctx.conMod);
  setFormHpValues(mode, hp, "average");
}

function rollHpGrowthToForm(mode = "quick") {
  const ctx = getFormHpContext(mode);
  const dieSize = toNumber(String(ctx.hitDie).replace("d", ""), 8);
  const currentMaxInput = getSection(mode === "edit" ? "lssEdit_hpMax" : "lssQuickCreateHpMax");
  const current = Math.max(1, toNumber(currentMaxInput?.value, getAverageHpForLevel(ctx.hitDie, Math.max(1, ctx.level - 1), ctx.conMod)));
  const roll = rollDieSize(dieSize);
  const gain = Math.max(1, roll + ctx.conMod);
  setFormHpValues(mode, current + gain, "roll");
  showToast(`HP бросок: ${ctx.hitDie}=${roll}, Тел ${formatSigned(ctx.conMod)}, прирост ${gain}`);
}

function setStatsFields(mode = "quick", stats = {}, method = "standard-array") {
  const isEdit = mode === "edit";
  STAT_DEFS.forEach(({ key }) => {
    const input = getSection(isEdit ? `lssEdit_stat_${key}` : `lssQuickCreateStat_${key}`);
    if (input && stats[key]) input.value = String(stats[key]);
  });
  const methodSelect = getSection(isEdit ? "lssEdit_statsMethod" : "lssQuickCreateStatsMethod");
  if (methodSelect) methodSelect.value = normalizeStatsMethod(method, "standard-array");
  applyQuickDexDefaults();
  if (isEdit) applyEditFormLive(method === "roll-4d6" ? "Характеристики брошены" : "Характеристики распределены под класс");
}

function applySuggestedStatsToForm(mode = "quick") {
  const isEdit = mode === "edit";
  const className = getSection(isEdit ? "lssEdit_charClass" : "lssQuickCreateClass")?.value || "";
  const method = getSection(isEdit ? "lssEdit_statsMethod" : "lssQuickCreateStatsMethod")?.value || "standard-array";
  setStatsFields(mode, getSuggestedStatsForClass(className, method), method);
}

function rollStatsToForm(mode = "quick") {
  setStatsFields(mode, getRolledStats(), "roll-4d6");
}

function bindLssConstructorRuleButtons() {
  const pairs = [
    ["lssQuickApplyAverageHpBtn", () => applyAverageHpToForm("quick")],
    ["lssEditApplyAverageHpBtn", () => applyAverageHpToForm("edit")],
    ["lssQuickRollHpBtn", () => rollHpGrowthToForm("quick")],
    ["lssEditRollHpBtn", () => rollHpGrowthToForm("edit")],
    ["lssQuickApplyStatsBtn", () => applySuggestedStatsToForm("quick")],
    ["lssEditApplyStatsBtn", () => applySuggestedStatsToForm("edit")],
    ["lssQuickRollStatsBtn", () => rollStatsToForm("quick")],
    ["lssEditRollStatsBtn", () => rollStatsToForm("edit")],
    ["lssQuickApplySourceBonusesBtn", () => applyQuickSourceAbilityBonuses()],
    ["lssQuickApplyAsiFeatBtn", () => applyAsiFeatToForm("quick")],
    ["lssEditApplyAsiFeatBtn", () => applyAsiFeatToForm("edit")],
  ];

  pairs.forEach(([id, handler]) => {
    const btn = getSection(id);
    if (!btn || btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", handler);
  });

  const multiToggle = getSection("lssEdit_multiclassEnabled");
  if (multiToggle && multiToggle.dataset.bound !== "1") {
    multiToggle.dataset.bound = "1";
    multiToggle.addEventListener("change", () => applyEditFormLive(multiToggle.checked ? "Мультикласс включён" : "Мультикласс выключен"));
  }

  ["lssQuickCreateHpMode", "lssEdit_hpMode"].forEach((id) => {
    const select = getSection(id);
    if (!select || select.dataset.bound === "1") return;
    select.dataset.bound = "1";
    select.addEventListener("change", () => {
      if (select.value === "average") applyAverageHpToForm(id.includes("Edit") ? "edit" : "quick");
    });
  });

  [
    ["lssQuickFeatChoice", "lssQuick"],
    ["lssEditFeatChoice", "lssEdit"],
  ].forEach(([id, prefix]) => {
    const select = getSection(id);
    if (!select || select.dataset.featPreviewBound === "1") return;
    select.dataset.featPreviewBound = "1";
    select.addEventListener("change", () => refreshLssSelectedFeatPreview(prefix));
  });
}

function bindLssInputGuards() {
  document.querySelectorAll("input[data-lss-text]").forEach((input) => {
    if (!input || input.dataset.lssGuardBound === "1") return;
    input.dataset.lssGuardBound = "1";
    input.addEventListener("input", () => {
      const kind = input.dataset.lssText || "short";
      const before = input.value;
      const next = sanitizePlainText(before, {
        max: kind === "name" ? 60 : 80,
        allowNumbers: kind !== "name",
        allowPunctuation: true,
      });
      if (before !== next) input.value = next;
    });
  });

  document.querySelectorAll('input[type="number"]').forEach((input) => {
    if (!input || input.dataset.lssNumberBound === "1") return;
    input.dataset.lssNumberBound = "1";
    input.addEventListener("blur", () => {
      const min = input.min !== "" ? Number(input.min) : null;
      const max = input.max !== "" ? Number(input.max) : null;
      input.value = sanitizeNumericText(input.value, { min, max, fallback: min ?? 0 });
    });
  });

  const bindAutoInitiative = (dexId, initiativeId, hiddenAutoId = "") => {
    const dexInput = getSection(dexId);
    const initiativeInput = getSection(initiativeId);
    const hiddenAuto = hiddenAutoId ? getSection(hiddenAutoId) : null;
    if (!dexInput || !initiativeInput || initiativeInput.dataset.lssInitiativeBound === "1") return;
    initiativeInput.dataset.lssInitiativeBound = "1";
    initiativeInput.addEventListener("input", () => {
      initiativeInput.dataset.manual = "1";
      if (hiddenAuto) hiddenAuto.value = "0";
    });
    dexInput.addEventListener("input", () => {
      const autoValue = statMod(clampNumber(dexInput.value, 1, 30, 10));
      const previousAuto = String(initiativeInput.dataset.autoValue ?? "");
      const current = String(initiativeInput.value ?? "");
      const canAuto = initiativeInput.dataset.manual !== "1" || current === previousAuto || current === "";
      initiativeInput.dataset.autoValue = String(autoValue);
      if (canAuto) {
        initiativeInput.value = String(autoValue);
        if (hiddenAuto) hiddenAuto.value = "1";
      }
    });
  };

  bindAutoInitiative("lssQuickCreateStat_dex", "lssQuickCreateInitiative");
  bindAutoInitiative("lssEdit_stat_dex", "lssEdit_initiative", "lssEdit_initiativeAuto");
}

function validateQuickCreateForm() {
  const errors = [];
  const name = sanitizePlainText(getSection("lssQuickCreateName")?.value || "", { max: 60, allowNumbers: false });
  const level = clampNumber(getSection("lssQuickCreateLevel")?.value, 1, 20, 1);
  const hp = clampNumber(getSection("lssQuickCreateHp")?.value, 1, 999, 10);
  const hpMax = clampNumber(getSection("lssQuickCreateHpMax")?.value, 1, 999, hp);
  const ac = clampNumber(getSection("lssQuickCreateAc")?.value, 1, 40, 10);

  if (!name) errors.push("имя без цифр и мусора");
  if (hp > hpMax) errors.push("текущие HP не могут быть выше максимума");
  if (level < 1 || level > 20) errors.push("уровень должен быть 1–20");
  if (ac < 1 || ac > 40) errors.push("КБ должна быть в разумном диапазоне");

  STAT_DEFS.forEach(({ key, label }) => {
    const score = clampNumber(getSection(`lssQuickCreateStat_${key}`)?.value, 1, 30, 10);
    if (score < 1 || score > 30) errors.push(`${label}: значение 1–30`);
  });

  return errors;
}

function validateEditFormData(formData = {}) {
  const errors = [];
  const name = sanitizePlainText(formData.name || "", { max: 60, allowNumbers: false });
  const level = clampNumber(formData.level, 1, 20, 1);
  const hpCurrent = clampNumber(formData.hpCurrent, 0, 999, 0);
  const hpMax = clampNumber(formData.hpMax, 1, 999, 1);

  if (!name) errors.push("укажи имя персонажа буквами");
  if (level < 1 || level > 20) errors.push("уровень должен быть 1–20");
  if (hpCurrent > hpMax) errors.push("текущие HP не могут быть выше максимума");

  STAT_DEFS.forEach(({ key, label }) => {
    const score = clampNumber(formData[`stat_${key}`], 1, 30, 10);
    if (score < 1 || score > 30) errors.push(`${label}: значение 1–30`);
  });

  return errors;
}

function bindLssClassGuideInputs() {
  bindLssConstructorDelegatedRefresh();
  syncLssChoiceSnapshot("quick");
  syncLssChoiceSnapshot("edit");
  const quickClassInput = getSection("lssQuickCreateClass");
  const quickLevelInput = getSection("lssQuickCreateLevel");
  const quickConInput = getSection("lssQuickCreateStat_con");
  const quickRaceInput = getSection("lssQuickCreateRace");
  const quickSubclassInput = getSection("lssQuickCreateSubclass");
  const quickSubraceInput = getSection("lssQuickCreateSubrace");
  const quickBackgroundInput = getSection("lssQuickCreateBackground");
  const editClassInput = getSection("lssEdit_charClass");
  const editRaceInput = getSection("lssEdit_race");
  const editSubclassInput = getSection("lssEdit_charSubclass");
  const editSubraceInput = getSection("lssEdit_subrace");
  const editLevelInput = getSection("lssEdit_level");

  if (quickClassInput && quickClassInput.dataset.classGuideBound !== "1") {
    quickClassInput.dataset.classGuideBound = "1";
    quickClassInput.addEventListener("input", () => {
      refreshClassGuidePanel("lssQuickCreateClass", "lssQuickClassGuide");
      refreshLssDependentChoiceLists("quick");
      applyQuickClassDefaults();
      applyQuickDexDefaults();
      LSS_STATE.quickAppliedAbilityBonusKey = "";
      refreshLssSourceBonusesPanel("quick");
      refreshLssRulesProgressionPanel("quick");
      refreshLssAsiFeatPanel("quick");
    });
    quickClassInput.addEventListener("change", () => {
      refreshClassGuidePanel("lssQuickCreateClass", "lssQuickClassGuide");
      refreshLssDependentChoiceLists("quick");
      applyQuickClassDefaults();
      applyQuickDexDefaults();
      LSS_STATE.quickAppliedAbilityBonusKey = "";
      refreshLssSourceBonusesPanel("quick");
      refreshLssRulesProgressionPanel("quick");
      refreshLssAsiFeatPanel("quick");
    });
  }

  [quickLevelInput, quickConInput, editLevelInput].forEach((input) => {
    if (!input || input.dataset.classGuideBound === "1") return;
    input.dataset.classGuideBound = "1";
    input.addEventListener("input", () => {
      refreshClassGuidePanel("lssQuickCreateClass", "lssQuickClassGuide");
      refreshClassGuidePanel("lssEdit_charClass", "lssEditClassGuide");
      refreshLssDependentChoiceLists("edit");
      applyQuickClassDefaults();
      applyQuickDexDefaults();
      refreshLssSourceBonusesPanel("quick");
      refreshLssRulesProgressionPanel("quick");
      refreshLssAsiFeatPanel("quick");
    });
    input.addEventListener("change", () => {
      refreshClassGuidePanel("lssQuickCreateClass", "lssQuickClassGuide");
      refreshClassGuidePanel("lssEdit_charClass", "lssEditClassGuide");
      refreshLssDependentChoiceLists("edit");
      applyQuickClassDefaults();
      applyQuickDexDefaults();
      refreshLssSourceBonusesPanel("quick");
      refreshLssRulesProgressionPanel("quick");
      refreshLssAsiFeatPanel("quick");
    });
  });


  if (quickRaceInput && quickRaceInput.dataset.raceDefaultsBound !== "1") {
    quickRaceInput.dataset.raceDefaultsBound = "1";
    const onQuickRaceChange = () => {
      LSS_STATE.quickAppliedAbilityBonusKey = "";
      applyQuickRaceDefaults();
      syncLssChoiceSnapshot("quick");
      refreshLssSourceBonusesPanel("quick");
      refreshLssRulesProgressionPanel("quick");
      refreshLssAsiFeatPanel("quick");
    };
    quickRaceInput.addEventListener("input", onQuickRaceChange);
    quickRaceInput.addEventListener("change", onQuickRaceChange);
  }


  if (quickBackgroundInput && quickBackgroundInput.dataset.backgroundChoiceBound !== "1") {
    quickBackgroundInput.dataset.backgroundChoiceBound = "1";
    const onQuickBackgroundChange = () => {
      LSS_STATE.quickAppliedAbilityBonusKey = "";
      refreshLssSourceBonusesPanel("quick");
      refreshLssRulesProgressionPanel("quick");
      refreshLssAsiFeatPanel("quick");
    };
    quickBackgroundInput.addEventListener("input", onQuickBackgroundChange);
    quickBackgroundInput.addEventListener("change", onQuickBackgroundChange);
  }


  if (editClassInput && editClassInput.dataset.classGuideBound !== "1") {
    editClassInput.dataset.classGuideBound = "1";
    editClassInput.addEventListener("input", () => {
      refreshClassGuidePanel("lssEdit_charClass", "lssEditClassGuide");
      refreshLssDependentChoiceLists("edit");
    });
    editClassInput.addEventListener("change", () => {
      refreshClassGuidePanel("lssEdit_charClass", "lssEditClassGuide");
      refreshLssDependentChoiceLists("edit");
    });
  }

  if (editRaceInput && editRaceInput.dataset.raceDefaultsBound !== "1") {
    editRaceInput.dataset.raceDefaultsBound = "1";
    editRaceInput.addEventListener("input", () => refreshLssDependentChoiceLists("edit"));
    editRaceInput.addEventListener("change", () => refreshLssDependentChoiceLists("edit"));
  }

  [quickSubclassInput, quickSubraceInput, editSubclassInput, editSubraceInput].forEach((input) => {
    if (!input || input.dataset.choiceHintBound === "1") return;
    input.dataset.choiceHintBound = "1";
    input.addEventListener("change", () => {
      const mode = input.id.includes("Edit") ? "edit" : "quick";
      if (mode === "quick") LSS_STATE.quickAppliedAbilityBonusKey = "";
      refreshLssDependentChoiceLists(mode);
      syncLssChoiceSnapshot(mode);
      refreshLssSourceBonusesPanel(mode);
      refreshLssRulesProgressionPanel(mode);
      refreshLssAsiFeatPanel(mode);
    });
  });

  refreshClassGuidePanel("lssQuickCreateClass", "lssQuickClassGuide");
  refreshClassGuidePanel("lssEdit_charClass", "lssEditClassGuide");
  applyQuickRaceDefaults();
  applyQuickDexDefaults();
  syncLssChoiceSnapshot("quick");
  syncLssChoiceSnapshot("edit");
  refreshLssSourceBonusesPanel("quick");
  refreshLssRulesProgressionPanel("quick");
  refreshLssAsiFeatPanel("quick");
  refreshLssAsiFeatPanel("edit");
}


function buildSavedProfileFromEditor() {
  const formData = collectEditFormData();
  const editErrors = validateEditFormData(formData);
  if (editErrors.length) {
    showToast(`Проверь лист: ${editErrors[0]}`);
    return null;
  }
  if (!String(formData.name || "").trim()) {
    showToast("Укажи имя персонажа перед сохранением");
    getSection("lssEdit_name")?.focus?.();
    return null;
  }
  return normalizeLssProfileForSave(applyBasicFormToProfile(formData));
}

async function saveCurrentLssProfile(options = {}) {
  if (!LSS_STATE.profile) {
    showToast("Сначала создай или загрузи персонажа");
    return;
  }
  let nextProfile = getSection("lssEditPanel") ? buildSavedProfileFromEditor() : normalizeLssProfileForSave(cloneData(LSS_STATE.profile));
  if (!nextProfile) return;

  if (options.createNew) {
    delete nextProfile.__dndTraderCharacterId;
    delete nextProfile.character_id;
    if (nextProfile.info) delete nextProfile.info.character_id;
  }

  const syncResult = await syncLssCharacterToAccount(nextProfile, { makeActive: true, createNew: Boolean(options.createNew) });
  nextProfile = normalizeLssProfileForSave(syncResult.profile || nextProfile);

  setLssData(nextProfile, { persistLocal: true, source: "manual" });
  LSS_STATE.editPanelOpen = true;
  renderLSS();
  if (options.createNew) {
    showToast(syncResult.error ? "Копия сохранена локально, но аккаунт не синхронизирован" : "Персонаж сохранён как новая копия");
  } else {
    showToast(syncResult.error ? "LSS сохранён локально, но аккаунт не синхронизирован" : "Персонаж сохранён в профиль и пул Master Room");
  }
}

function bindLssSpellCatalogActions() {
  const search = getSection("lssSpellCatalogSearch");
  if (search && search.dataset.bound !== "1") {
    search.dataset.bound = "1";
    search.addEventListener("input", () => {
      LSS_STATE.spellCatalogQuery = search.value || "";
      clearTimeout(LSS_SPELL_SEARCH_TIMER);
      LSS_SPELL_SEARCH_TIMER = setTimeout(() => {
        const results = getSection("lssSpellCatalogResults");
        if (!results || !LSS_STATE.profile) return;
        results.innerHTML = renderParsedSpellCatalogResults(LSS_STATE.profile, LSS_STATE.spellCatalogQuery);
        bindLssSpellCatalogActions();
      }, 140);
    });
  }

  document.querySelectorAll("[data-lss-spell-add]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const ok = addCatalogSpellToProfile(btn.dataset.lssSpellAdd, btn.dataset.lssSpellPrepared === "1");
      if (!ok) return showToast("Заклинание не найдено в нашем каталоге");
      renderLSS();
      showToast(btn.dataset.lssSpellPrepared === "1" ? "Заклинание добавлено и подготовлено" : "Заклинание добавлено в книгу");
    });
  });

  document.querySelectorAll("[data-lss-spell-toggle-prepared]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      toggleProfileSpellPrepared(btn.dataset.lssSpellTogglePrepared);
      renderLSS();
    });
  });

  document.querySelectorAll("[data-lss-spell-remove]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      if (!confirm("Удалить это заклинание из книги и подготовленных?")) return;
      removeProfileSpell(btn.dataset.lssSpellRemove);
      renderLSS();
      showToast("Заклинание удалено");
    });
  });
}

function bindLssActions() {
  const toggleImportBtn = getSection("lssToggleImportBtn");
  const toggleEditBtn = getSection("lssToggleEditBtn");
  const clearBtn = getSection("lssClearDataBtn");
  const applyBtn = getSection("lssApplyJsonBtn");
  const openFileBtn = getSection("lssOpenFileBtn");
  const fileInput = getSection("lssFileInput");
  const jsonTextarea = getSection("lssJsonTextarea");
  const saveEditBtn = getSection("lssSaveEditBtn");
  const saveNowBtn = getSection("lssSaveNowBtn");
  const saveAsNewBtn = getSection("lssSaveAsNewBtn");
  const saveAsNewBottomBtn = getSection("lssSaveAsNewBottomBtn");
  const characterPoolSelect = getSection("lssCharacterPoolSelect");
  const applyCharacterPoolBtn = getSection("lssApplyCharacterPoolBtn");

  const pickImageBtn = getSection("lssPickImageBtn");
  const applyPortraitBtn = getSection("lssApplyPortraitBtn");
  const clearImageBtn = getSection("lssClearImageBtn");
  const imageFileInput = getSection("lssImageFileInput");
  const quickCreateBtn = getSection("lssQuickCreateBtn");
  const emptyImportBtn = getSection("lssEmptyImportBtn");

  if (quickCreateBtn && quickCreateBtn.dataset.bound !== "1") {
    quickCreateBtn.dataset.bound = "1";
    quickCreateBtn.addEventListener("click", async () => {
      const quickErrors = validateQuickCreateForm();
      if (quickErrors.length) {
        showToast(`Проверь создание: ${quickErrors[0]}`);
        return;
      }

      const name = sanitizePlainText(getSection("lssQuickCreateName")?.value || "", { max: 60, allowNumbers: false });
      if (!name) {
        showToast("Сначала дай персонажу имя");
        getSection("lssQuickCreateName")?.focus?.();
        return;
      }

      const form = {
        name,
        charClass: getSection("lssQuickCreateClass")?.value,
        charSubclass: getSection("lssQuickCreateSubclass")?.value,
        subrace: getSection("lssQuickCreateSubrace")?.value,
        race: getSection("lssQuickCreateRace")?.value,
        level: getSection("lssQuickCreateLevel")?.value,
        background: getSection("lssQuickCreateBackground")?.value,
        alignment: getSection("lssQuickCreateAlignment")?.value,
        experience: getSection("lssQuickCreateExperience")?.value,
        statsMethod: getSection("lssQuickCreateStatsMethod")?.value,
        proficiency: getSection("lssQuickCreateProficiency")?.value,
        hpCurrent: getSection("lssQuickCreateHp")?.value,
        hpMax: getSection("lssQuickCreateHpMax")?.value || getSection("lssQuickCreateHp")?.value,
        hpTemp: getSection("lssQuickCreateHpTemp")?.value,
        hitDie: getSection("lssQuickCreateHitDie")?.value,
        hitDiceCurrent: getSection("lssQuickCreateHitDiceCurrent")?.value,
        hpMode: getSection("lssQuickCreateHpMode")?.value,
        ac: getSection("lssQuickCreateAc")?.value,
        initiative: getSection("lssQuickCreateInitiative")?.value,
        speed: getSection("lssQuickCreateSpeed")?.value,
        size: getSection("lssQuickCreateSize")?.value || "medium",
        abilityImprovements: getSection("lssQuickAppliedAsiRecords")?.value || "[]",
        feats: getSection("lssQuickSelectedFeats")?.value || "[]",
      };
      STAT_DEFS.forEach(({ key }) => {
        form[`stat_${key}`] = getSection(`lssQuickCreateStat_${key}`)?.value;
      });

      let profile = normalizeLssProfileForSave(buildStarterProfileFromForm(form));
      const syncResult = await syncLssCharacterToAccount(profile, { makeActive: true });
      profile = normalizeLssProfileForSave(syncResult.profile || profile);

      setLssData(profile, { persistLocal: true, source: "manual" });
      LSS_STATE.editPanelOpen = true;
      LSS_STATE.activeTab = "overview";
      renderLSS();
      showToast(syncResult.error ? "Персонаж создан локально, но аккаунт не синхронизирован" : "Персонаж создан и сохранён в профиль");
    });
  }

  if (emptyImportBtn && emptyImportBtn.dataset.bound !== "1") {
    emptyImportBtn.dataset.bound = "1";
    emptyImportBtn.addEventListener("click", () => {
      LSS_STATE.importPanelOpen = true;
      renderLSS();
      setTimeout(() => getSection("lssImportPanel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    });
  }

  if (characterPoolSelect && characterPoolSelect.dataset.bound !== "1") {
    characterPoolSelect.dataset.bound = "1";
    characterPoolSelect.addEventListener("change", () => {
      LSS_STATE.selectedCharacterId = String(characterPoolSelect.value || "").trim();
    });
  }

  if (applyCharacterPoolBtn && applyCharacterPoolBtn.dataset.bound !== "1") {
    applyCharacterPoolBtn.dataset.bound = "1";
    applyCharacterPoolBtn.addEventListener("click", async () => {
      const character = getLssCharacterPool().find((entry) => String(entry?.id || "") === String(LSS_STATE.selectedCharacterId || ""));
      if (!character) {
        showToast("Сначала выбери персонажа из пула");
        return;
      }

      const nextProfile = LSS_STATE.profile
        ? cloneData(LSS_STATE.profile)
        : buildBlankProfileFromCharacter(character);

      nextProfile.__dndTraderCharacterId = Number(character.id || 0) || nextProfile.__dndTraderCharacterId;
      nextProfile.character_id = Number(character.id || 0) || nextProfile.character_id;
      nextProfile.name = character.name || nextProfile.name || "Персонаж";
      nextProfile.info = nextProfile.info || {};
      nextProfile.info.charClass = { ...(nextProfile.info.charClass || {}), name: "charClass", value: character.class_name || "" };
      nextProfile.info.level = { ...(nextProfile.info.level || {}), name: "level", value: Math.max(1, toNumber(character.level, 1)) };
      nextProfile.info.race = { ...(nextProfile.info.race || {}), name: "race", value: character.race || "" };
      nextProfile.info.alignment = { ...(nextProfile.info.alignment || {}), name: "alignment", value: character.alignment || "" };

      setLssData(normalizeLssProfileForSave(nextProfile), { persistLocal: true, source: "manual" });
      try {
        await updateAccount({ active_character_id: Number(character.id) });
      } catch (_) {}
      renderLSS();
      showToast("Персонаж из пула подставлен в LSS");
    });
  }

  if (toggleImportBtn && toggleImportBtn.dataset.bound !== "1") {
    toggleImportBtn.dataset.bound = "1";
    toggleImportBtn.addEventListener("click", () => {
      LSS_STATE.importPanelOpen = !LSS_STATE.importPanelOpen;
      renderLSS();
    });
  }

  if (toggleEditBtn && toggleEditBtn.dataset.bound !== "1") {
    toggleEditBtn.dataset.bound = "1";
    toggleEditBtn.addEventListener("click", () => {
      if (!LSS_STATE.profile) {
        const nextProfile = buildStarterProfileFromForm({ name: "Новый персонаж", level: 1, hpCurrent: 10, hpMax: 10, ac: 10, speed: "30" });
        setLssData(nextProfile, { persistLocal: true, source: "manual" });
      }
      LSS_STATE.editPanelOpen = !LSS_STATE.editPanelOpen;
      renderLSS();
      if (LSS_STATE.editPanelOpen) {
        setTimeout(() => {
          getSection("lssEditPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 0);
      }
    });
  }

  if (clearBtn && clearBtn.dataset.bound !== "1") {
    clearBtn.dataset.bound = "1";
    clearBtn.addEventListener("click", () => {
      const ok = confirm("Очистить текущие LSS-данные?");
      if (!ok) return;
      clearLssData();
      LSS_STATE.importPanelOpen = false;
      LSS_STATE.editPanelOpen = false;
      renderLSS();
      showToast("LSS-данные очищены");
    });
  }

  if (applyBtn && applyBtn.dataset.bound !== "1") {
    applyBtn.dataset.bound = "1";
    applyBtn.addEventListener("click", () => {
      const rawText = jsonTextarea?.value?.trim() || "";
      if (!rawText) {
        showToast("Вставь JSON экспорт LSS");
        return;
      }

      const parsed = tryParseJson(rawText);
      if (!parsed || typeof parsed !== "object") {
        showToast("JSON не распознан");
        return;
      }

      setLssData(parsed, { persistLocal: true, source: "manual" });
      LSS_STATE.importPanelOpen = false;
      renderLSS();
      showToast("LSS-данные загружены");
    });
  }

  if (openFileBtn && openFileBtn.dataset.bound !== "1") {
    openFileBtn.dataset.bound = "1";
    openFileBtn.addEventListener("click", () => {
      fileInput?.click();
    });
  }

  if (fileInput && fileInput.dataset.bound !== "1") {
    fileInput.dataset.bound = "1";
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      try {
        const text = await readFileAsText(file);
        const parsed = tryParseJson(text);

        if (!parsed || typeof parsed !== "object") {
          showToast("Файл не содержит валидный JSON");
          return;
        }

        setLssData(parsed, { persistLocal: true, source: "manual" });
        LSS_STATE.importPanelOpen = false;
        renderLSS();
        showToast("LSS-файл загружен");
      } catch (error) {
        console.error(error);
        showToast("Не удалось загрузить файл");
      } finally {
        fileInput.value = "";
      }
    });
  }

  if (saveNowBtn && saveNowBtn.dataset.bound !== "1") {
    saveNowBtn.dataset.bound = "1";
    saveNowBtn.addEventListener("click", () => saveCurrentLssProfile({ createNew: false }));
  }

  [saveAsNewBtn, saveAsNewBottomBtn].forEach((btn) => {
    if (!btn || btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => saveCurrentLssProfile({ createNew: true }));
  });

  if (saveEditBtn && saveEditBtn.dataset.bound !== "1") {
    saveEditBtn.dataset.bound = "1";
    saveEditBtn.addEventListener("click", () => saveCurrentLssProfile({ createNew: false }));
  }

  [getSection("lssDiceToggleBtn"), getSection("lssDiceToggleInlineBtn")].forEach((btn) => {
    if (!btn || btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      if (!LSS_STATE.profile) return;
      LSS_STATE.dicePanelOpen = !LSS_STATE.dicePanelOpen;
      renderLSS();
    });
  });

  document.querySelectorAll("[data-lss-roll-die]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const die = btn.dataset.lssRollDie || "d20";
      const roll = rollSelectedDie(die);
      renderLSS();
      showToast(`Бросок ${String(roll.type).toUpperCase()}: ${roll.result}`);
    });
  });

  [getSection("lssQuickEditBtn"), getSection("lssQuickEditBtnCompact")].forEach((quickEditBtn) => {
    if (!quickEditBtn || quickEditBtn.dataset.bound === "1") return;
    quickEditBtn.dataset.bound = "1";
    quickEditBtn.addEventListener("click", () => {
      if (!LSS_STATE.profile) return;
      LSS_STATE.editPanelOpen = !LSS_STATE.editPanelOpen;
      renderLSS();
      if (LSS_STATE.editPanelOpen) {
        setTimeout(() => {
          getSection("lssEditPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 0);
      }
    });
  });

  document.querySelectorAll("[data-lss-hp-action]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const action = btn.dataset.lssHpAction;
      if (action === "minus") quickAdjustHp(-1);
      else if (action === "plus") quickAdjustHp(1);
      else if (action === "set") quickSetHp();
    });
  });

  document.querySelectorAll("[data-lss-tab]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      LSS_STATE.activeTab = btn.dataset.lssTab || "overview";
      renderLSS();
    });
  });

  document.querySelectorAll("[data-lss-jump]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.lssJump || "";
      getSection(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  document.querySelectorAll("[data-lss-jump-top]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const section = getSection("cabinet-lss");
      const container = section?.closest?.(".modal-content");
      if (container && "scrollTo" in container) {
        container.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        section?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  document.querySelectorAll("[data-lss-prof-kind]").forEach((input) => {
    if (input.dataset.bound === "1") return;
    input.dataset.bound = "1";
    input.addEventListener("change", () => {
      applyEditFormLive(input.checked ? "Владение добавлено" : "Владение убрано");
    });
  });

  document.querySelectorAll("[data-lss-skill-prof]").forEach((input) => {
    if (input.dataset.bound === "1") return;
    input.dataset.bound = "1";
    input.addEventListener("change", () => {
      const skillKey = input.dataset.lssSkillProf || "";
      toggleSkillProficiency(skillKey, Boolean(input.checked));
    });
  });

  if (pickImageBtn && pickImageBtn.dataset.bound !== "1") {
    pickImageBtn.dataset.bound = "1";
    pickImageBtn.addEventListener("click", () => {
      imageFileInput?.click();
    });
  }

  if (imageFileInput && imageFileInput.dataset.bound !== "1") {
    imageFileInput.dataset.bound = "1";
    imageFileInput.addEventListener("change", async () => {
      const file = imageFileInput.files?.[0];
      if (!file) return;

      try {
        await handlePortraitFile(file);
      } finally {
        imageFileInput.value = "";
      }
    });
  }

  if (applyPortraitBtn && applyPortraitBtn.dataset.bound !== "1") {
    applyPortraitBtn.dataset.bound = "1";
    applyPortraitBtn.addEventListener("click", () => {
      const value = safeText(getSection("lssEdit_portrait")?.value, "").trim();

      if (!value) {
        showToast("Вставь ссылку на изображение или выбери файл");
        return;
      }

      savePortraitImmediately(value);
      showToast("Фото персонажа обновлено");
    });
  }

  if (clearImageBtn && clearImageBtn.dataset.bound !== "1") {
    clearImageBtn.dataset.bound = "1";
    clearImageBtn.addEventListener("click", () => {
      setPortraitFieldValue("");
      savePortraitImmediately("");
      showToast("Фото персонажа удалено");
    });
  }

  bindLssInputGuards();
  bindLssClassGuideInputs();
  bindLssAlignmentPickers();
  bindLssConstructorRuleButtons();
  bindLssSpellCatalogActions();
}

// ------------------------------------------------------------
// 🎨 SMALL RENDER HELPERS
// ------------------------------------------------------------
function renderEmptyState() {
  return `
    <div class="cabinet-block lss-ref-empty-state lss-ref-create-state" style="display:block;">
      <div class="lss-ref-empty-copy" style="max-width:none; padding:14px 18px 10px; border-right:0; border-bottom:1px solid rgba(117,203,198,.12); margin-bottom:14px;">
        <div class="lss-ref-kicker">LSS constructor</div>
        <h3 style="margin-bottom:6px;">Создай игрового персонажа</h3>
        <p style="max-width:880px; margin-bottom:0;">Выбери основу персонажа — класс, расу, подрасу и предысторию. LSS берёт механику из rules JSON, а полный текст остаётся в Бестиарии.</p>
      </div>

      <div class="lss-ref-starter-card" style="max-width:none;">
        <div class="lss-ref-starter-grid lss-ref-starter-grid-wide" style="align-items:start;">
          <div class="filter-group lss-ref-field-main"><label>Имя персонажа</label><input id="lssQuickCreateName" type="text" autocomplete="off" maxlength="60" data-lss-text="name" placeholder="Например: Торен"></div>
          <div class="filter-group"><label>Класс</label><select id="lssQuickCreateClass" data-lss-text="short">${getLssClassSelectOptionsHtml("")}</select></div>
          <div class="filter-group"><label>Подкласс</label><select id="lssQuickCreateSubclass" data-lss-text="short">${getLssSubclassSelectOptionsHtml("", "")}</select><div id="lssQuickSubclassHint">${renderLssSubclassHint("", "", 1)}</div></div>
          <div class="filter-group"><label>Раса</label><select id="lssQuickCreateRace" data-lss-text="short">${getLssRaceSelectOptionsHtml("")}</select></div>
          <div class="filter-group"><label>Подраса / вариант</label><select id="lssQuickCreateSubrace" data-lss-text="short">${getLssSubraceSelectOptionsHtml("", "")}</select><div id="lssQuickSubraceHint">${renderLssSubraceHint("", "")}</div></div>
          <div class="filter-group"><label>Размер</label><select id="lssQuickCreateSize">${getSizeOptionsHtml("medium")}</select></div>
          <div class="filter-group"><label>Предыстория</label><select id="lssQuickCreateBackground" data-lss-text="short">${getLssBackgroundSelectOptionsHtml("")}</select></div>
        </div>

        <div class="lss-ref-create-core-grid" style="display:grid; grid-template-columns:minmax(280px,0.95fr) minmax(440px,1.55fr); gap:12px; align-items:start; margin-top:12px;">
          <div class="filter-group" style="margin:0;"><label>Мировоззрение / моральная ось</label>${renderLssAlignmentGrid("lssQuickCreateAlignment", "")}</div>
          <div class="lss-ref-starter-grid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; align-items:start; margin:0;">
            <div class="filter-group"><label>Уровень</label><input id="lssQuickCreateLevel" ${numericInputAttrs(1, 20)} value="1"></div>
            <div class="filter-group"><label>Опыт</label><input id="lssQuickCreateExperience" ${numericInputAttrs(0)} value="0"></div>
            <div class="filter-group"><label>Бонус владения</label><input id="lssQuickCreateProficiency" ${numericInputAttrs(0)} value="2"></div>
            <div class="filter-group"><label>HP текущие</label><input id="lssQuickCreateHp" ${numericInputAttrs(1)} value="10"></div>
            <div class="filter-group"><label>HP максимум</label><input id="lssQuickCreateHpMax" ${numericInputAttrs(1)} value="10"></div>
            <div class="filter-group"><label>Временные HP</label><input id="lssQuickCreateHpTemp" ${numericInputAttrs(0)} value="0"></div>
            <div class="filter-group"><label>Кость хитов класса</label><select id="lssQuickCreateHitDie">${getHitDieOptionsHtml("d8")}</select></div>
            <div class="filter-group"><label>Кости отдыха</label><input id="lssQuickCreateHitDiceCurrent" ${numericInputAttrs(0)} value="1"></div>
            <div class="filter-group"><label>КБ</label><input id="lssQuickCreateAc" ${numericInputAttrs(1)} value="10"></div>
            <div class="filter-group"><label>Инициатива <small>авто от Ловкости</small></label><input id="lssQuickCreateInitiative" type="number" inputmode="numeric" value="0" data-auto-value="0"><small class="muted">Можно править вручную.</small></div>
            <div class="filter-group"><label>Скорость, фт.</label><input id="lssQuickCreateSpeed" ${numericInputAttrs(0)} value="30"></div>
          </div>
        </div>

        ${renderLssClassGuidanceCard("", { mode: "quick" })}
        ${renderLssSourceBonusesPanel("quick")}
        ${renderLssRulesProgressionPanel("quick")}
        ${renderLssAsiFeatPanel("quick")}
        ${renderHpRulePanel({ info: { level: { value: 1 } }, vitality: { "hit-die": { value: "d8" }, "hp-mode": { value: "average" }, "hp-max": { value: 10 } }, stats: { con: { score: 10 } } }, "quick")}
        ${renderStatsRulePanel({ info: { statsMethod: { value: "standard-array" } } }, "quick")}

        <div class="lss-ref-starter-stats">
          ${STAT_DEFS.map(({ key, label }) => `
            <div class="filter-group">
              <label>${escapeHtml(label)}</label>
              <input id="lssQuickCreateStat_${escapeHtml(key)}" ${numericInputAttrs(1, 30)} value="10">
            </div>
          `).join("")}
        </div>

        <div class="modal-actions lss-ref-starter-actions">
          <button class="btn btn-success" type="button" id="lssQuickCreateBtn">Создать и сохранить персонажа</button>
          <button class="btn btn-primary" type="button" id="lssEmptyImportBtn">Загрузить JSON</button>
        </div>
        <div class="muted">После создания откроется конструктор. Авторизованный пользователь получит персонажа в “Мой аккаунт → Персонажи” и в пуле Master Room.</div>
      </div>
    </div>
  `;
}


function renderDiceDock() {
  if (!LSS_STATE.profile || !LSS_STATE.dicePanelOpen) return "";
  const last = LSS_STATE.lastRoll;
  const dieButtons = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];

  return `
    <div class="cabinet-block lss-ref-dice-dock" style="margin:10px 0 12px; position:relative; z-index:3; overflow:visible;">
      <div class="flex-between" style="gap:8px; align-items:center;">
        <div>
          <div style="font-weight:800; font-size:14px;">🎲 Кубы</div>
          <div class="muted" style="font-size:11px;">быстрый бросок без сохранения листа</div>
        </div>
        <button class="btn btn-secondary" type="button" id="lssDiceToggleInlineBtn">Скрыть</button>
      </div>
      <div class="cart-buttons lss-ref-dice-buttons" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:10px;">
        ${dieButtons.map((die) => `
          <button class="btn ${LSS_STATE.diceType === die ? "btn-primary" : "btn-secondary"}" type="button" data-lss-roll-die="${die}">
            ${die.toUpperCase()}
          </button>
        `).join("")}
      </div>
      <div class="muted" style="margin-top:8px; font-size:12px;">
        ${last ? `Последний: <strong>${escapeHtml(String(last.type).toUpperCase())}</strong> → <strong>${escapeHtml(String(last.result))}</strong>` : "Выбери куб"}
      </div>
    </div>
  `;
}


function renderHero(profile) {
  const name = unwrapValue(profile?.name, "Без имени");
  const info = profile?.info || {};
  const vitality = profile?.vitality || {};
  const portraitUrl = getPortraitUrl(profile);
  const hpCurrent = unwrapValue(vitality["hp-current"], "—");
  const hpMax = unwrapValue(vitality["hp-max"], "—");
  const hpTemp = unwrapValue(vitality["hp-temp"], "0");
  const xp = getXpProgressData(profile);
  const spell = getSpellQuickSummary(profile);
  const deathSuccesses = Math.max(0, toNumber(unwrapValue(vitality?.deathSuccesses, 0), 0));
  const deathFails = Math.max(0, toNumber(unwrapValue(vitality?.deathFails, 0), 0));
  const conditions = joinNonEmpty([
    unwrapValue(profile?.conditions, ""),
    unwrapValue(vitality?.conditions, ""),
  ]);

  return `
    <section class="cabinet-block lss-ref-hero-card">
      <div class="lss-ref-portrait-frame">
        ${portraitUrl ? `
          <img class="lss-ref-portrait" src="${escapeHtml(portraitUrl)}" alt="${escapeHtml(String(name))}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'; this.closest('.lss-ref-portrait-frame')?.classList.add('lss-ref-portrait-empty');" />
        ` : `<div class="lss-ref-portrait-fallback">🧙</div>`}
        <button class="lss-ref-photo-btn" type="button" id="lssQuickEditBtnCompact" title="Открыть конструктор">📷</button>
      </div>

      <div class="lss-ref-identity-panel">
        <div class="lss-ref-kicker">Персонаж</div>
        <div class="lss-ref-name-row">
          <h2>${escapeHtml(String(name))}</h2>
          <button class="lss-ref-edit-name" type="button" id="lssQuickEditBtn" title="Редактировать персонажа">✎</button>
        </div>
        <div class="lss-ref-level-row">
          <div class="lss-ref-level-badge"><span>Уровень</span><strong>${escapeHtml(String(unwrapValue(info?.level, "1")))}</strong></div>
          <div class="lss-ref-xp-line">
            <div class="lss-ref-xp-text">${escapeHtml(String(xp.xp))}${xp.next ? ` / ${escapeHtml(String(xp.next))} ОП` : " ОП"}</div>
            <div class="lss-ref-xp-track"><i style="width:${escapeHtml(String(xp.percent.toFixed(2)))}%;"></i></div>
          </div>
        </div>
        <div class="lss-ref-tags">
          <span>${escapeHtml(String(unwrapValue(info?.background, "—")))}</span>
          <span>${escapeHtml(String(unwrapValue(info?.charClass, "—")))}</span>
          <span>${escapeHtml(String(unwrapValue(info?.race, "—")))}</span>
          ${unwrapValue(info?.alignment, "") ? `<span>${escapeHtml(String(unwrapValue(info?.alignment, "")))}</span>` : ""}
          ${conditions ? `<span class="lss-ref-tag-warning">${escapeHtml(conditions)}</span>` : ""}
        </div>
      </div>

      <div class="lss-ref-combat-panel">
        <div class="lss-ref-combat-stat"><span>Класс защиты</span><strong>${escapeHtml(String(unwrapValue(vitality?.ac, "—")))}</strong></div>
        <div class="lss-ref-combat-stat"><span>Инициатива</span><strong>${escapeHtml(formatSigned(getInitiativeModifier(profile)))}</strong></div>
        <div class="lss-ref-combat-stat"><span>Скорость</span><strong>${escapeHtml(String(unwrapValue(vitality?.speed, "—")))}</strong></div>
        <div class="lss-ref-hp-block">
          <div class="lss-ref-hp-title">Хиты</div>
          <div class="lss-ref-hp-value">${escapeHtml(String(hpCurrent))} / ${escapeHtml(String(hpMax))}</div>
          <div class="lss-ref-hp-track"><i style="width:${escapeHtml(String(Math.max(0, Math.min(100, (toNumber(hpCurrent,0) / Math.max(1,toNumber(hpMax,1))) * 100)).toFixed(2)))}%;"></i></div>
          <div class="lss-ref-hp-actions">
            <button class="btn btn-secondary" type="button" data-lss-hp-action="minus">−1</button>
            <button class="btn btn-secondary" type="button" data-lss-hp-action="plus">+1</button>
            <button class="btn btn-secondary" type="button" data-lss-hp-action="set">✎</button>
          </div>
        </div>
        <div class="lss-ref-mini-row">
          <span>Врем. HP <b>${escapeHtml(String(hpTemp))}</b></span>
          <span>СЛ <b>${escapeHtml(String(spell.saveDc))}</b></span>
          <span>Атака <b>${escapeHtml(formatSigned(spell.attack))}</b></span>
        </div>
        <div class="lss-ref-death-row">
          <span>Спасброски смерти</span>
          <span class="lss-ref-death-dots">${[0,1,2].map((i) => `<i class="${i < deathSuccesses ? "is-on" : ""}"></i>`).join("")}</span>
          <span class="lss-ref-death-dots lss-ref-death-fails">${[0,1,2].map((i) => `<i class="${i < deathFails ? "is-on" : ""}"></i>`).join("")}</span>
        </div>
      </div>
    </section>
  `;
}

function renderCombatSummary(profile) {
  const vitality = profile?.vitality || {};
  const conditions = joinNonEmpty([
    unwrapValue(profile?.conditions, ""),
    unwrapValue(vitality?.conditions, ""),
  ]);
  const deathSuccesses = unwrapValue(vitality?.deathSuccesses, 0);
  const deathFails = unwrapValue(vitality?.deathFails, 0);

  return `
    <div class="cabinet-block">
      <h3>Боевая сводка</h3>
      <div class="profile-grid">
        <div><b>Текущие хиты:</b> ${escapeHtml(String(unwrapValue(vitality["hp-current"], "—")))}</div>
        <div><b>Максимум хитов:</b> ${escapeHtml(String(unwrapValue(vitality["hp-max"], "—")))}</div>
        <div><b>Временные хиты:</b> ${escapeHtml(String(unwrapValue(vitality["hp-temp"], "0")))}</div>
        <div><b>Кость класса:</b> ${escapeHtml(String(unwrapValue(vitality["hit-die"], "—")))}</div>
        <div><b>Кости отдыха:</b> ${escapeHtml(String(unwrapValue(vitality["hp-dice-current"], "0")))}</div>
        <div><b>Бонус мастерства:</b> ${escapeHtml(formatSigned(getProficiencyBonus(profile)))}</div>
        <div><b>Пассивное восприятие:</b> ${escapeHtml(String(getPassivePerception(profile)))}</div>
        <div><b>Спасброски от смерти:</b> ${escapeHtml(String(deathSuccesses))} / ${escapeHtml(String(deathFails))}</div>
        ${
          conditions
            ? `<div><b>Состояния:</b> ${escapeHtml(conditions)}</div>`
            : ""
        }
      </div>
    </div>
  `;
}

function renderStats(profile) {
  return `
    <div class="cabinet-block">
      <h3>Характеристики и спасброски</h3>
      <div class="stats-grid">
        ${STAT_DEFS.map(({ key, label }) => {
          const score = getStatScore(profile, key);
          const mod = getStatModifier(profile, key);
          const save = getSaveModifier(profile, key);
          const profMark = hasSaveProficiency(profile, key) ? "★" : "•";

          return `
            <div class="stat-box">
              <div><b>${escapeHtml(label)}</b></div>
              <div style="font-size:20px;margin-top:4px;">${escapeHtml(formatSigned(mod))}</div>
              <div class="muted">Значение: ${escapeHtml(String(score))}</div>
              <div style="margin-top:8px;">
                ${profMark} Спасбросок: ${escapeHtml(formatSigned(save))}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderSkills(profile) {
  return `
    <div class="cabinet-block">
      <h3>Навыки</h3>
      <div class="profile-grid">
        ${STAT_DEFS.map(({ key, label }) => {
          const skills = getSkillsByStat(profile, key);
          return `
            <div class="lss-rich-block">
              <h4 style="margin-bottom:8px;">${escapeHtml(label)}</h4>
              ${
                skills.length
                  ? skills
                      .map(([skillKey]) => {
                        const skillLabel = SKILL_LABELS[skillKey] || capitalizeRu(skillKey);
                        const value = getSkillModifier(profile, skillKey);
                        const profMark = isSkillProficient(profile, skillKey) ? "★" : "•";
                        return `
                          <div style="margin-bottom:6px;">
                            ${profMark} ${escapeHtml(skillLabel)}:
                            <strong>${escapeHtml(formatSigned(value))}</strong>
                          </div>
                        `;
                      })
                      .join("")
                  : `<div class="muted">Нет навыков на этой характеристике.</div>`
              }
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderWeapons(profile) {
  const weapons = Array.isArray(profile?.weaponsList) ? profile.weaponsList : [];

  return `
    <div class="cabinet-block">
      <h3>Оружие и боевые приёмы</h3>
      ${
        weapons.length
          ? `
            <div class="inventory-list">
              ${weapons
                .map((weapon) => {
                  const name = normalizeWeaponName(weapon);
                  const dmg = normalizeWeaponDamage(weapon);
                  const mod = weaponAttackBonus(profile, weapon);
                  const notes = unwrapValue(weapon?.notes, "");
                  const ability = String(weapon?.ability || "").toUpperCase();

                  return `
                    <div class="inventory-item">
                      <div class="inventory-item-info">
                        <strong>${escapeHtml(String(name))}</strong>
                        <div class="inv-item-details">
                          <span>Атака: ${escapeHtml(formatSigned(mod))}</span>
                          <span>Урон: ${escapeHtml(String(dmg))}</span>
                          ${ability ? `<span>Хар-ка: ${escapeHtml(ability)}</span>` : ""}
                          ${weapon?.isProf ? `<span>Владение</span>` : ""}
                        </div>
                        ${
                          notes
                            ? `<div class="muted" style="margin-top:6px;">${escapeHtml(String(notes))}</div>`
                            : ""
                        }
                      </div>
                    </div>
                  `;
                })
                .join("")}
            </div>
          `
          : `<p>Оружие не заполнено.</p>`
      }
    </div>
  `;
}

function renderFeatures(profile) {
  return `
    <div class="cabinet-block">
      <h3>Классовые / видовые особенности</h3>
      <div class="lss-rich-block">
        ${renderRichText(profile?.attacks, "Особенности пока не заполнены.")}
      </div>
    </div>
  `;
}

function renderAppearance(profile) {
  const appearance = profile?.appearance;
  const subInfo = profile?.subInfo || {};

  return `
    <div class="cabinet-block">
      <h3>Внешность</h3>
      <div class="profile-grid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:8px;">
        <div class="stat-box lss-mini-box"><div class="muted">Возраст</div><div style="font-size:16px;font-weight:800;">${escapeHtml(String(unwrapValue(subInfo?.age, "—")))}</div></div>
        <div class="stat-box lss-mini-box"><div class="muted">Рост</div><div style="font-size:16px;font-weight:800;">${escapeHtml(String(unwrapValue(subInfo?.height, "—")))}</div></div>
        <div class="stat-box lss-mini-box"><div class="muted">Вес</div><div style="font-size:16px;font-weight:800;">${escapeHtml(String(unwrapValue(subInfo?.weight, "—")))}</div></div>
        <div class="stat-box lss-mini-box"><div class="muted">Глаза</div><div style="font-size:14px;font-weight:800;">${escapeHtml(String(unwrapValue(subInfo?.eyes, "—")))}</div></div>
      </div>

      <div style="display:grid; grid-template-columns:minmax(0,1.15fr) minmax(260px,0.85fr); gap:12px; margin-top:12px; align-items:start;">
        <div class="lss-rich-block">
          <h4>Общее описание</h4>
          ${renderRichText(appearance, "Описание внешности отсутствует.")}
        </div>
        <div style="display:flex; flex-direction:column; gap:12px; min-width:0;">
          <div class="lss-rich-block">
            <h4>Кожа</h4>
            <p>${escapeHtml(String(unwrapValue(subInfo?.skin, "—")))}</p>
          </div>
          <div class="lss-rich-block">
            <h4>Волосы</h4>
            <p>${escapeHtml(String(unwrapValue(subInfo?.hair, "—")))}</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderBackground(profile) {
  return `
    <div class="cabinet-block">
      <h3>Предыстория и характер</h3>
      <div style="display:flex; flex-direction:column; gap:12px; min-width:0;">
        <div style="display:grid; grid-template-columns:minmax(0,1.2fr) minmax(0,1fr); gap:12px; align-items:start;">
          <div class="lss-rich-block">
            <h4>Предыстория</h4>
            ${renderRichText(profile?.background, "Предыстория не заполнена.")}
          </div>
          <div class="lss-rich-block">
            <h4>Личность</h4>
            ${renderRichText(profile?.personality, "Не заполнено")}
          </div>
        </div>
        <div class="profile-grid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px;">
          <div class="lss-rich-block">
            <h4>Идеалы</h4>
            ${renderRichText(profile?.ideals, "Не заполнено")}
          </div>
          <div class="lss-rich-block">
            <h4>Привязанности</h4>
            ${renderRichText(profile?.bonds, "Не заполнено")}
          </div>
          <div class="lss-rich-block">
            <h4>Изъяны</h4>
            ${renderRichText(profile?.flaws, "Не заполнено")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAlliesAndGoals(profile) {
  const prof = profile?.prof;
  const allies = profile?.allies;
  const goals = profile?.quests;

  return `
    <div class="cabinet-block">
      <h3>Союзники, владения и цели</h3>
      <div class="profile-grid">
        <div class="lss-rich-block">
          <h4>Владения и языки</h4>
          ${renderRichText(prof, "Не заполнено")}
        </div>

        <div class="lss-rich-block">
          <h4>Союзники и организации</h4>
          ${renderRichText(allies, "Не заполнено")}
        </div>

        <div class="lss-rich-block">
          <h4>Цели и задачи</h4>
          ${renderRichText(goals, "Не заполнено")}
        </div>
      </div>
    </div>
  `;
}


const LSS_TAB_DEFS = [
  { key: "overview", label: "Обзор", icon: "⌘" },
  { key: "attacks", label: "Бой", icon: "⚔" },
  { key: "skills", label: "Навыки", icon: "✦" },
  { key: "abilities", label: "Черты", icon: "✹" },
  { key: "equipment", label: "Снаряжение", icon: "◈" },
  { key: "personality", label: "Личность", icon: "◌" },
  { key: "goals", label: "Цели", icon: "◎" },
  { key: "notes", label: "Заметки", icon: "✎" },
  { key: "spells", label: "Заклинания", icon: "✧" },
];


function renderQuickSummary(profile) {
  const vitality = profile?.vitality || {};
  const conditions = joinNonEmpty([
    unwrapValue(profile?.conditions, ""),
    unwrapValue(vitality?.conditions, ""),
  ]);
  const coins = parseCoins(profile);

  return `
    <div class="cabinet-block" style="padding:12px;">
      <h3 style="margin:0 0 10px 0;">Краткая сводка</h3>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(118px,1fr)); gap:8px;">
        <div class="stat-box" style="padding:10px; min-height:auto;"><div class="muted">Хиты</div><div style="font-size:18px;font-weight:800; margin-top:6px;">${escapeHtml(String(unwrapValue(vitality["hp-current"], "—")))} / ${escapeHtml(String(unwrapValue(vitality["hp-max"], "—")))}</div></div>
        <div class="stat-box" style="padding:10px; min-height:auto;"><div class="muted">КБ</div><div style="font-size:18px;font-weight:800; margin-top:6px;">${escapeHtml(String(unwrapValue(vitality?.ac, "—")))}</div></div>
        <div class="stat-box" style="padding:10px; min-height:auto;"><div class="muted">Инициатива</div><div style="font-size:18px;font-weight:800; margin-top:6px;">${escapeHtml(formatSigned(getInitiativeModifier(profile)))}</div></div>
        <div class="stat-box" style="padding:10px; min-height:auto;"><div class="muted">Скорость</div><div style="font-size:18px;font-weight:800; margin-top:6px;">${escapeHtml(String(unwrapValue(vitality?.speed, "—")))}</div></div>
        <div class="stat-box" style="padding:10px; min-height:auto;"><div class="muted">Мастерство</div><div style="font-size:18px;font-weight:800; margin-top:6px;">${escapeHtml(formatSigned(getProficiencyBonus(profile)))}</div></div>
        <div class="stat-box" style="padding:10px; min-height:auto;"><div class="muted">Пассивное восприятие</div><div style="font-size:18px;font-weight:800; margin-top:6px;">${escapeHtml(String(getPassivePerception(profile)))}</div></div>
      </div>
      ${(conditions || coins) ? `
        <div class="trader-meta" style="margin-top:10px; gap:6px;">
          ${conditions ? `<span class="meta-item">⚠️ ${escapeHtml(conditions)}</span>` : ""}
          ${coins ? Object.entries(coins).filter(([, value]) => String(value || "").trim()).map(([key, value]) => `<span class="meta-item">${escapeHtml(String(key).toUpperCase())}: ${escapeHtml(String(value))}</span>`).join("") : ""}
        </div>
      ` : ""}
    </div>
  `;
}


function renderStatsCompact(profile) {
  return `
    <div class="cabinet-block" style="padding:12px;">
      <div class="flex-between" style="align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <h3 style="margin:0;">Характеристики</h3>
        <div class="muted" style="font-size:12px;">значение • модификатор • спасбросок</div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(132px,1fr)); gap:8px;">
        ${STAT_DEFS.map(({ key, label }) => {
          const score = getStatScore(profile, key);
          const mod = getStatModifier(profile, key);
          const save = getSaveModifier(profile, key);
          const profMark = hasSaveProficiency(profile, key) ? "★" : "•";

          return `
            <div class="stat-box" style="min-height:auto; padding:10px 11px; border-radius:14px;">
              <div class="flex-between" style="align-items:flex-start; gap:8px;">
                <div style="font-weight:800; line-height:1.1;">${escapeHtml(label)}</div>
                <span class="quality-badge" style="padding:2px 7px; min-height:auto;">${escapeHtml(formatSigned(mod))}</span>
              </div>
              <div style="font-size:24px; font-weight:900; margin-top:8px; line-height:1;">${escapeHtml(String(score))}</div>
              <div class="muted" style="margin-top:6px; font-size:12px;">${profMark} спасбросок ${escapeHtml(formatSigned(save))}</div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}


function renderSkillsFlat(profile) {
  const skillRows = Object.entries(SKILL_BASE_STATS).map(([skillKey, baseStat]) => {
    const skillLabel = SKILL_LABELS[skillKey] || capitalizeRu(skillKey);
    const value = getSkillModifier(profile, skillKey);
    const prof = isSkillProficient(profile, skillKey);
    const statLabel = getStatShortLabel(baseStat);
    const source = getNested(profile, `skills.${skillKey}.source`, prof ? "manual" : "");
    const sourceIcon = getProficiencySourceIcon(source, prof);
    const sourceTitle = getProficiencySourceLabel(source || (prof ? "manual" : ""));
    return `
      <label class="inline-checkbox" title="${escapeHtml(skillLabel)} • ${escapeHtml(sourceTitle || "клик = ручное владение")}" style="display:grid; grid-template-columns:auto minmax(0,1fr) auto; grid-template-areas:'check name value' 'check meta value'; column-gap:9px; row-gap:2px; align-items:center; min-height:46px; padding:8px 10px; border-radius:13px; border:1px solid ${prof ? "rgba(117,203,198,.42)" : "rgba(255,255,255,0.06)"}; background:${prof ? "linear-gradient(135deg, rgba(117,203,198,.28), rgba(117,203,198,.12))" : "rgba(255,255,255,0.03)"}; cursor:pointer;">
        <input type="checkbox" data-lss-skill-prof="${escapeHtml(skillKey)}" ${prof ? "checked" : ""} style="grid-area:check;">
        <span style="grid-area:name; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:800;">${escapeHtml(skillLabel)}</span>
        <span class="muted" style="grid-area:meta; font-size:12px; display:flex; gap:6px; align-items:center; min-width:0; overflow:hidden;"><b>${escapeHtml(statLabel)}</b>${sourceIcon ? `<span title="Источник: ${escapeHtml(sourceTitle)}">${escapeHtml(sourceIcon)}</span>` : ""}</span>
        <strong style="grid-area:value; font-size:16px; text-align:right;">${escapeHtml(formatSigned(value))}</strong>
      </label>
    `;
  }).join("");

  return `
    <div class="cabinet-block" style="padding:12px;">
      <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <div>
          <h3 style="margin:0 0 4px 0;">Навыки</h3>
          <div class="muted" style="font-size:12px;">клик по навыку сразу переключает ручное владение; источник показан значком</div>
        </div>
        <span class="meta-item">⚙ ручное • 📜 предыстория • 🎓 класс</span>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:8px; align-items:start;">
        ${skillRows}
      </div>
    </div>
  `;
}


function renderPassiveSenses(profile) {
  return `
    <div class="cabinet-block" style="padding:12px; min-height:auto;">
      <h4 style="margin:0 0 10px 0;">Пассивные чувства</h4>
      <div class="lss-skill-stack" style="gap:6px;">
        <div class="lss-inline-row" style="padding:8px 10px;"><span>Восприятие</span><strong>${escapeHtml(String(getPassivePerception(profile)))}</strong></div>
        <div class="lss-inline-row" style="padding:8px 10px;"><span>Проницательность</span><strong>${escapeHtml(String(getPassiveInsight(profile)))}</strong></div>
        <div class="lss-inline-row" style="padding:8px 10px;"><span>Анализ</span><strong>${escapeHtml(String(getPassiveInvestigation(profile)))}</strong></div>
      </div>
    </div>
  `;
}


function renderStatesAndResources(profile) {
  const vitality = profile?.vitality || {};
  const conditions = joinNonEmpty([
    unwrapValue(profile?.conditions, ""),
    unwrapValue(vitality?.conditions, ""),
  ]);
  const deathSuccesses = unwrapValue(vitality?.deathSuccesses, 0);
  const deathFails = unwrapValue(vitality?.deathFails, 0);
  const coins = parseCoins(profile);

  return `
    <div class="cabinet-block" style="padding:12px; min-height:auto;">
      <h4 style="margin:0 0 10px 0;">Состояния и ресурсы</h4>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(112px,1fr)); gap:8px;">
        <div class="stat-box lss-mini-box"><div class="muted">Врем. HP</div><div style="font-size:16px;font-weight:800;">${escapeHtml(String(unwrapValue(vitality["hp-temp"], "0")))}</div></div>
        <div class="stat-box lss-mini-box"><div class="muted">Кость класса</div><div style="font-size:16px;font-weight:800;">${escapeHtml(String(unwrapValue(vitality["hit-die"], "—")))}</div></div>
        <div class="stat-box lss-mini-box"><div class="muted">Кости отдыха</div><div style="font-size:16px;font-weight:800;">${escapeHtml(String(unwrapValue(vitality["hp-dice-current"], "0")))}</div></div>
        <div class="stat-box lss-mini-box"><div class="muted">Смерть</div><div style="font-size:16px;font-weight:800;">${escapeHtml(String(deathSuccesses))} / ${escapeHtml(String(deathFails))}</div></div>
      </div>
      ${(conditions || coins) ? `
        <div class="trader-meta" style="margin-top:10px; gap:6px;">
          ${conditions ? `<span class="meta-item">⚠️ ${escapeHtml(conditions)}</span>` : ""}
          ${coins ? Object.entries(coins).filter(([, value]) => String(value || "").trim()).map(([key, value]) => `<span class="meta-item">${escapeHtml(String(key).toUpperCase())}: ${escapeHtml(String(value))}</span>`).join("") : ""}
        </div>
      ` : `<div class="muted" style="margin-top:10px; font-size:12px;">Состояния и ресурсы не заданы.</div>`}
    </div>
  `;
}


function renderProfAndLanguages(profile) {
  return `
    <div class="cabinet-block" style="padding:12px; min-height:auto;">
      <h4 style="margin:0 0 10px 0;">Владения и языки</h4>
      <div class="lss-rich-block" style="padding:10px 12px;">${renderRichText(profile?.prof, "Не заполнено")}</div>
    </div>
  `;
}


function renderOverviewSupportGrid(profile) {
  return `
    <div style="display:flex; flex-direction:column; gap:10px; min-width:0;">
      ${renderStatesAndResources(profile)}
      ${renderPassiveSenses(profile)}
      ${renderProfAndLanguages(profile)}
    </div>
  `;
}


function renderOverviewTab(profile) {
  return `
    <div class="lss-ref-overview-grid">
      <div class="lss-ref-overview-main">
        ${renderQuickSummary(profile)}
        ${renderStatsCompact(profile)}
      </div>
      <aside class="lss-ref-overview-side">
        ${renderOverviewSupportGrid(profile)}
      </aside>
    </div>
  `;
}


function renderLssTabs() {
  const active = LSS_STATE.activeTab || "overview";
  return `
    <nav class="cabinet-block lss-ref-tabs" aria-label="LSS tabs">
      ${LSS_TAB_DEFS.map((tab) => `
        <button class="lss-ref-tab ${tab.key === active ? "active" : ""}" type="button" data-lss-tab="${escapeHtml(tab.key)}" aria-selected="${tab.key === active ? "true" : "false"}">
          <span class="lss-ref-tab-icon">${escapeHtml(tab.icon || "•")}</span>
          <span>${escapeHtml(tab.label)}</span>
        </button>
      `).join("")}
    </nav>
  `;
}

function renderActiveLssTab(profile) {
  const active = LSS_STATE.activeTab || "overview";
  switch (active) {
    case "attacks":
      return `
        ${renderWeapons(profile)}
        <div class="cabinet-block">
          <h3>Атаки и боевые заметки</h3>
          <div class="lss-rich-block">${renderRichText(profile?.attacks, "Нет дополнительных заметок по атакам.")}</div>
        </div>
      `;
    case "skills":
      return `
        ${renderSkillsFlat(profile)}
        ${renderPassiveSenses(profile)}
      `;
    case "abilities":
      return renderFeatures(profile);
    case "equipment":
      return renderEquipment(profile);
    case "personality":
      return `
        ${renderAppearance(profile)}
        ${renderBackground(profile)}
      `;
    case "goals":
      return renderAlliesAndGoals(profile);
    case "notes":
      return renderNotes(profile);
    case "spells":
      return `
        ${renderSpellcasting(profile)}
        ${renderSpellCards(profile)}
      `;
    case "overview":
    default:
      return renderOverviewTab(profile);
  }
}

function parseCoins(profile) {
  const coins = {
    mm: unwrapValue(profile?.coins?.mm, ""),
    sm: unwrapValue(profile?.coins?.sm, ""),
    zm: unwrapValue(profile?.coins?.zm, ""),
    em: unwrapValue(profile?.coins?.em, ""),
    pm: unwrapValue(profile?.coins?.pm, ""),
  };

  const hasAny = Object.values(coins).some((value) => String(value || "").trim());
  return hasAny ? coins : null;
}

function renderEquipment(profile) {
  const equipment = profile?.equipment;
  const coins = parseCoins(profile);

  return `
    <div class="cabinet-block">
      <h3>Снаряжение</h3>
      ${
        coins
          ? `
            <div class="trader-meta" style="margin-bottom:12px;">
              ${Object.entries(coins)
                .filter(([, value]) => String(value || "").trim())
                .map(
                  ([key, value]) =>
                    `<span class="meta-item">${escapeHtml(key.toUpperCase())}: ${escapeHtml(String(value))}</span>`
                )
                .join("")}
            </div>
          `
          : ""
      }
      <div class="lss-rich-block">
        ${renderRichText(equipment, "Снаряжение не заполнено.")}
      </div>
    </div>
  `;
}

function getNoteBlocks(profile) {
  return Object.keys(profile || {})
    .filter((key) => /^notes-\d+$/.test(key))
    .sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]))
    .map((key) => ({
      key,
      title: `Заметка ${key.split("-")[1]}`,
      value: profile[key],
    }))
    .filter((entry) => entry.value);
}


function renderNotes(profile) {
  const notes = getNoteBlocks(profile);

  return `
    <div class="cabinet-block" style="padding:12px;">
      <h3 style="margin:0 0 10px 0;">Заметки персонажа</h3>
      ${
        notes.length
          ? `
            ${bridgeStatus}
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:10px;">
              ${notes
                .map(
                  (note) => `
                    <div class="lss-rich-block" style="padding:10px 12px;">
                      <h4 style="margin:0 0 8px 0;">${escapeHtml(note.title)}</h4>
                      ${renderRichText(note.value, "Пусто")}
                    </div>
                  `
                )
                .join("")}
            </div>
          `
          : `<p>Заметки пока не заполнены.</p>`
      }
    </div>
  `;
}


function renderSpellcasting(profile) {
  const ability = getSpellcastingAbility(profile);
  const attack = getSpellAttackBonus(profile);
  const saveDc = getSpellSaveDc(profile);
  const slots = getSpellSlots(profile);

  return `
    <div class="cabinet-block" style="padding:12px;">
      <h3 style="margin:0 0 10px 0;">Заклинания</h3>

      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:8px;">
        <div class="stat-box" style="padding:10px; min-height:auto;"><div class="muted">Базовая характеристика</div><div style="font-size:17px;font-weight:800; margin-top:6px;">${escapeHtml(ability)}</div></div>
        <div class="stat-box" style="padding:10px; min-height:auto;"><div class="muted">Атака заклинанием</div><div style="font-size:17px;font-weight:800; margin-top:6px;">${escapeHtml(formatSigned(attack))}</div></div>
        <div class="stat-box" style="padding:10px; min-height:auto;"><div class="muted">СЛ спасброска</div><div style="font-size:17px;font-weight:800; margin-top:6px;">${escapeHtml(String(saveDc))}</div></div>
      </div>

      <div style="margin-top:12px;">
        <div style="font-weight:800; margin-bottom:8px;">Ячейки заклинаний</div>
        ${
          slots.length
            ? `
              <div style="display:grid; margin-top:0; grid-template-columns:repeat(auto-fit,minmax(104px,1fr)); gap:8px;">
                ${slots
                  .map(
                    (slot) => `
                      <div class="stat-box lss-mini-box" style="padding:9px 10px; min-height:auto;">
                        <div class="muted">${escapeHtml(String(slot.level))}-й круг</div>
                        <div style="font-size:15px;font-weight:800;">${escapeHtml(String(Math.max(0, slot.total - slot.filled)))} / ${escapeHtml(String(slot.total))}</div>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            `
            : `<p style="margin-top:8px;">Ячейки пока не заполнены.</p>`
        }
      </div>
    </div>
  `;
}


function getSpellCatalogClassNeedles(profile) {
  return [
    unwrapValue(profile?.info?.charClass, ""),
    unwrapValue(profile?.info?.charSubclass, ""),
  ].map(normalizeLssSpellLookup).filter(Boolean);
}

function getSpellCatalogSuggestions(profile, query = "", limit = null) {
  const indexes = getLssSpellCatalogIndexes();
  const lookup = normalizeLssSpellLookup(query);
  const classNeedles = getSpellCatalogClassNeedles(profile);
  const level = Math.max(1, toNumber(unwrapValue(profile?.info?.level, 1), 1));
  const maxLevel = Math.max(0, Math.min(9, Math.ceil(level / 2)));
  const prepared = new Set(getPreparedSpellIds(profile).map(String));
  const book = new Set(getBookSpellIds(profile).map(String));
  return indexes.entries
    .map((spell) => {
      const name = safeText(spell.ru_name || spell.name || spell.title || spell.en_name, "");
      const haystack = normalizeLssSpellLookup([name, spell.en_name, spell.school, ...(spell.classes || [])].join(" "));
      const classes = normalizeArray(spell.classes).map(normalizeLssSpellLookup);
      const classMatch = classNeedles.some((needle) => classes.some((cls) => cls.includes(needle) || needle.includes(cls)));
      const spellLevel = normalizeSpellLevelValue(spell.level) ?? 0;
      const score = (classMatch ? 30 : 0) + (spellLevel <= maxLevel ? 10 : 0) + (prepared.has(String(spell.id)) ? 4 : 0) + (book.has(String(spell.id)) ? 3 : 0);
      return { spell, name, haystack, classMatch, spellLevel, score };
    })
    .filter((item) => item.name && (!lookup || item.haystack.includes(lookup)))
    .sort((a, b) => {
      if (lookup) {
        const aExact = normalizeLssSpellLookup(a.name) === lookup ? 1 : 0;
        const bExact = normalizeLssSpellLookup(b.name) === lookup ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
      }
      if (a.score !== b.score) return b.score - a.score;
      if (a.spellLevel !== b.spellLevel) return a.spellLevel - b.spellLevel;
      return a.name.localeCompare(b.name, "ru");
    })
    .slice(0, limit || LSS_STATE.spellCatalogLimit || 36);
}

function isSpellAlreadyInProfile(profile, spell) {
  const ids = new Set([...getBookSpellIds(profile), ...getPreparedSpellIds(profile)].map(String));
  if (ids.has(String(spell.id))) return true;
  const lookup = normalizeLssSpellLookup(spell.ru_name || spell.name || spell.en_name);
  return getSpellCardsExpanded(profile).some((card) => normalizeLssSpellLookup(card.name || card.ru_name || card.title) === lookup);
}

function renderParsedSpellCatalogResults(profile, query = LSS_STATE.spellCatalogQuery) {
  const suggestions = getSpellCatalogSuggestions(profile, query);
  if (!suggestions.length) return `<div class="muted" style="padding:10px 2px;">По запросу ничего не найдено в нашем parsed-каталоге.</div>`;
  return suggestions.map(({ spell, name, spellLevel }) => {
    const exists = isSpellAlreadyInProfile(profile, spell);
    const classes = normalizeArray(spell.classes).slice(0, 4).join(", ");
    return `
      <div class="lss-rich-block" style="padding:9px 10px; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:center;">
        <div style="min-width:0;">
          <div style="font-weight:900; overflow-wrap:anywhere;">${escapeHtml(name)}</div>
          <div class="muted" style="font-size:12px; margin-top:3px;">${spellLevel === 0 ? "заговор" : `${escapeHtml(String(spellLevel))} круг`}${spell.school ? ` • ${escapeHtml(String(spell.school))}` : ""}${classes ? ` • ${escapeHtml(classes)}` : ""}</div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
          ${exists ? `<span class="meta-item">уже добавлено</span>` : `
            <button class="btn btn-secondary" type="button" data-lss-spell-add="${escapeHtml(String(spell.id))}" data-lss-spell-prepared="0">В книгу</button>
            <button class="btn btn-primary" type="button" data-lss-spell-add="${escapeHtml(String(spell.id))}" data-lss-spell-prepared="1">＋ Подготовить</button>
          `}
        </div>
      </div>`;
  }).join("");
}

function renderParsedSpellCatalog(profile) {
  const indexes = getLssSpellCatalogIndexes();
  const statusLabel = LSS_STATE.parsedSpellCatalogStatus === "loaded"
    ? `parsed-каталог: ${indexes.entries.length}`
    : LSS_STATE.parsedSpellCatalogStatus === "rules-fallback"
      ? `compact rules: ${indexes.entries.length}`
      : LSS_STATE.parsedSpellCatalogStatus === "loading" ? "каталог загружается…" : "каталог не найден";
  return `
    <details class="cabinet-block" id="lssParsedSpellCatalogPanel" open style="padding:12px; margin-top:12px;">
      <summary style="cursor:pointer; font-weight:900; color:var(--gold,#d6b36a);">Наши парсенные заклинания <span class="muted" style="font-weight:600;">• ${escapeHtml(statusLabel)}</span></summary>
      <div style="margin-top:10px;">
        <div class="muted" style="font-size:12px; margin-bottom:8px;">Источник: ${escapeHtml(LSS_STATE.parsedSpellCatalogSource || "—")}. Добавленные карточки сразу уходят в combat profile и Master Room.</div>
        <input id="lssSpellCatalogSearch" class="input" type="search" autocomplete="off" placeholder="Название, школа, класс…" value="${escapeHtml(LSS_STATE.spellCatalogQuery || "")}" style="width:100%; margin-bottom:10px;">
        <div id="lssSpellCatalogResults" style="display:grid; gap:8px; max-height:520px; overflow:auto; padding-right:4px;">
          ${renderParsedSpellCatalogResults(profile)}
        </div>
      </div>
    </details>`;
}

function findProfileSpellCard(profile, id) {
  const raw = String(id || "");
  return getSpellCardsExpanded(profile).find((card) => [card.id, card.catalog_id, card.external_id, card._id].map(String).includes(raw)) || null;
}

function addCatalogSpellToProfile(spellId, prepared = false) {
  const indexes = getLssSpellCatalogIndexes();
  const spell = indexes.byId.get(String(spellId)) || indexes.entries.find((entry) => String(entry.id) === String(spellId));
  if (!spell || !LSS_STATE.profile) return false;
  const profile = cloneData(LSS_STATE.profile);
  const card = normalizeCatalogSpellForLss(spell, { prepared, sourceKind: "parsed-spell-catalog", confidence: "catalog-selected" });
  profile.spellsMeta = profile.spellsMeta && typeof profile.spellsMeta === "object" ? profile.spellsMeta : {};
  const cards = getSpellCardsExpanded(profile).map((item) => ({ ...item }));
  const lookup = normalizeLssSpellLookup(card.name);
  const existingIndex = cards.findIndex((item) => String(item.catalog_id || item.id || "") === String(card.catalog_id || card.id) || normalizeLssSpellLookup(item.name || item.ru_name) === lookup);
  if (existingIndex >= 0) cards[existingIndex] = { ...cards[existingIndex], ...card, prepared: Boolean(prepared || cards[existingIndex].prepared) };
  else cards.push(card);
  const book = Array.from(new Set([...(profile.spellsMeta.book || []).map(String), String(card.catalog_id || card.id)]));
  const preparedIds = Array.from(new Set([...(profile.spellsMeta.prepared || []).map(String), ...(prepared ? [String(card.catalog_id || card.id)] : [])]));
  profile.spellsMeta = { ...profile.spellsMeta, cards, bookExpanded: cards, preparedExpanded: cards.filter((item) => item.prepared || preparedIds.includes(String(item.catalog_id || item.id))), book, prepared: preparedIds };
  profile.spellCards = cards;
  profile.spellsExpanded = cards;
  setLssData(profile, { persistLocal: true, source: "manual" });
  return true;
}

function toggleProfileSpellPrepared(spellId) {
  if (!LSS_STATE.profile) return;
  const profile = cloneData(LSS_STATE.profile);
  const card = findProfileSpellCard(profile, spellId);
  if (!card) return;
  profile.spellsMeta = profile.spellsMeta && typeof profile.spellsMeta === "object" ? profile.spellsMeta : {};
  const canonicalId = String(card.catalog_id || card.id || card.external_id || spellId);
  const prepared = new Set((profile.spellsMeta.prepared || []).map(String));
  const isPrepared = prepared.has(canonicalId) || Boolean(card.prepared);
  if (isPrepared) prepared.delete(canonicalId); else prepared.add(canonicalId);
  const cards = getSpellCardsExpanded(profile).map((item) => {
    const itemId = String(item.catalog_id || item.id || item.external_id || "");
    return itemId === canonicalId ? { ...item, prepared: !isPrepared } : item;
  });
  profile.spellsMeta = { ...profile.spellsMeta, prepared: Array.from(prepared), cards, preparedExpanded: cards.filter((item) => item.prepared || prepared.has(String(item.catalog_id || item.id || item.external_id || ""))), bookExpanded: cards };
  profile.spellCards = cards;
  profile.spellsExpanded = cards;
  setLssData(profile, { persistLocal: true, source: "manual" });
}

function removeProfileSpell(spellId) {
  if (!LSS_STATE.profile) return;
  const profile = cloneData(LSS_STATE.profile);
  const card = findProfileSpellCard(profile, spellId);
  if (!card) return;
  const canonicalIds = new Set([card.id, card.catalog_id, card.external_id, spellId].filter(Boolean).map(String));
  const cards = getSpellCardsExpanded(profile).filter((item) => ![item.id, item.catalog_id, item.external_id].filter(Boolean).map(String).some((id) => canonicalIds.has(id)));
  profile.spellsMeta = profile.spellsMeta && typeof profile.spellsMeta === "object" ? profile.spellsMeta : {};
  profile.spellsMeta = {
    ...profile.spellsMeta,
    cards,
    book: (profile.spellsMeta.book || []).map(String).filter((id) => !canonicalIds.has(id)),
    prepared: (profile.spellsMeta.prepared || []).map(String).filter((id) => !canonicalIds.has(id)),
    preparedExpanded: cards.filter((item) => item.prepared),
    bookExpanded: cards,
  };
  profile.spellCards = cards;
  profile.spellsExpanded = cards;
  setLssData(profile, { persistLocal: true, source: "manual" });
}

function renderSpellCards(profile) {
  const expanded = getSpellCardsExpanded(profile).map(normalizeSpellCard);
  const prepared = getPreparedSpellIds(profile).map(String);
  const book = getBookSpellIds(profile).map(String);
  const bridge = profile?.spellsMeta?.externalBridge || {};
  const unresolvedCount = Array.isArray(bridge.unresolved_ids) ? bridge.unresolved_ids.length : 0;
  const bridgeStatus = (bridge.external_count || bridge.hint_count)
    ? `<div class="lss-rich-block" style="padding:9px 11px; margin-bottom:10px; border-style:dashed;">
         <strong>Совместимость с оригинальным LSS:</strong> ${escapeHtml(String(bridge.resolved_count || 0))} карточек восстановлено.
         <div class="muted" style="margin-top:5px;">Внешних ID: ${escapeHtml(String(bridge.external_count || 0))} • читаемых подсказок: ${escapeHtml(String(bridge.hint_count || 0))} • наш каталог: ${escapeHtml(String(bridge.catalog_count || getLssSpellCatalogIndexes().entries.length))}.</div>
         ${unresolvedCount ? `<div class="muted" style="margin-top:5px;">Не сопоставлено ID: ${escapeHtml(String(unresolvedCount))}. Они сохранены, но не показываются как названия.</div>` : ""}
       </div>`
    : "";

  const cardsBlock = expanded.length ? `
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:10px;">
      ${expanded.map((spell) => {
        const canonicalId = String(spell.catalogId || spell.id || spell.externalId);
        const isPrepared = spell.prepared || prepared.includes(canonicalId) || (spell.externalId && prepared.includes(String(spell.externalId)));
        return `
          <div class="lss-rich-block" style="padding:10px 12px; display:flex; flex-direction:column; min-height:180px;">
            <div class="flex-between" style="align-items:flex-start; gap:8px; margin-bottom:8px;">
              <h4 style="margin:0; overflow-wrap:anywhere;">${escapeHtml(String(spell.name))}</h4>
              ${isPrepared ? `<span class="quality-badge" style="padding:2px 7px; min-height:auto;">подготовлено</span>` : `<span class="meta-item" style="padding:2px 7px; min-height:auto;">в книге</span>`}
            </div>
            <div class="inv-item-details" style="margin-bottom:8px; gap:6px;">
              ${spell.level !== "" ? `<span>${Number(spell.level) === 0 ? "Заговор" : `Круг: ${escapeHtml(String(spell.level))}`}</span>` : ""}
              ${spell.school ? `<span>${escapeHtml(String(spell.school))}</span>` : ""}
              ${spell.time ? `<span>${escapeHtml(String(spell.time))}</span>` : ""}
              ${spell.range ? `<span>${escapeHtml(String(spell.range))}</span>` : ""}
              ${spell.duration ? `<span>${escapeHtml(String(spell.duration))}</span>` : ""}
            </div>
            ${spell.components ? `<div class="muted" style="margin-bottom:8px; font-size:12px;">${escapeHtml(String(spell.components))}</div>` : ""}
            ${spell.description ? `<div style="font-size:14px; line-height:1.45; flex:1;">${escapeHtml(String(spell.description))}</div>` : `<div class="muted" style="flex:1;">Описание пока не загружено.</div>`}
            ${spell.notes ? `<div class="muted" style="margin-top:8px; font-size:11px;">${escapeHtml(String(spell.notes))}</div>` : ""}
            <div style="display:flex; gap:7px; flex-wrap:wrap; margin-top:10px;">
              <button class="btn btn-secondary" type="button" data-lss-spell-toggle-prepared="${escapeHtml(canonicalId)}">${isPrepared ? "Убрать из подготовленных" : "Подготовить"}</button>
              <button class="btn btn-secondary" type="button" data-lss-spell-remove="${escapeHtml(canonicalId)}">Удалить</button>
            </div>
          </div>`;
      }).join("")}
    </div>` : `<div class="muted">Карточек пока нет. Ниже можно восстановить читаемые названия из оригинального листа или добавить заклинания из нашего parsed-каталога.</div>`;

  return `
    <div class="cabinet-block" style="padding:12px;">
      <div class="flex-between" style="align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <h3 style="margin:0;">Карточки заклинаний</h3>
        <div class="trader-meta" style="gap:6px;">
          <span class="meta-item">Карточек: ${escapeHtml(String(expanded.length))}</span>
          <span class="meta-item">Подготовлено: ${escapeHtml(String(prepared.length))}</span>
          <span class="meta-item">В книге: ${escapeHtml(String(book.length))}</span>
        </div>
      </div>
      ${bridgeStatus}
      ${cardsBlock}
    </div>
    ${renderParsedSpellCatalog(profile)}
  `;
}

// ------------------------------------------------------------
// 🧱 MAIN LSS RENDER
// ------------------------------------------------------------
export function renderLSS() {
  const container = getSection("cabinet-lss");
  if (!container) return;

  const profile = LSS_STATE.profile;

  container.innerHTML = `
    ${renderTopToolbar()}
    ${profile ? renderDiceDock() : ""}
    ${renderImportPanel()}
    ${profile ? renderEditPanel(profile) : ""}
    ${
      profile
        ? `
          <div class="lss-root lss-ref-root">
            <div id="lssHeroSection">${renderHero(profile)}</div>
            <div id="lssTabsSection">${renderLssTabs()}</div>
            <div id="lssActivePanel" class="lss-ref-active-panel">${renderActiveLssTab(profile)}</div>
          </div>
        `
        : renderEmptyState()
    }
  `;

  bindLssActions();
}

// ------------------------------------------------------------
// 📜 HISTORY STUB
// ------------------------------------------------------------
export function renderHistory() {
  const container = getSection("cabinet-history");
  if (!container) return;

  container.innerHTML = `
    <div class="cabinet-block">
      <h3>📜 История</h3>
      <p>
        История сайта и транзакций больше не рендерится из LSS-модуля.
        Этот раздел оставлен совместимым только временно, пока не вынесем
        отдельный <code>history.js</code>.
      </p>
    </div>
  `;
}

// ------------------------------------------------------------
// 🔧 OPTIONAL BRIDGE HELPERS
// ------------------------------------------------------------
export function getLssProfile() {
  return LSS_STATE.profile;
}

export function getLssRaw() {
  return LSS_STATE.raw;
}

export function setLssData(raw, options = {}) {
  const {
    persistLocal = true,
    source = "manual",
  } = options || {};

  const inputRaw = cloneData(raw);
  const normalizedProfile = mergeOriginalLssSpellMeta(normalizeProfile(inputRaw) || inputRaw, inputRaw);
  const normalizedRaw = normalizeLssProfileForSave(normalizedProfile);
  LSS_STATE.raw = cloneData(normalizedRaw);
  LSS_STATE.profile = hydrateOriginalLssSpellExport(mergeOriginalLssSpellMeta(normalizeProfile(cloneData(normalizedRaw)), inputRaw));
  LSS_STATE.source = source;
  broadcastLssProfile(LSS_STATE.profile);
  if (!LSS_TAB_DEFS.some((tab) => tab.key === LSS_STATE.activeTab)) {
    LSS_STATE.activeTab = "overview";
  }

  if (persistLocal) {
    saveLocalLssRaw(LSS_STATE.raw);
  }

  // setLssData remains synchronous for compatibility. The richer parsed catalog
  // hydrates in a second safe pass when it was not loaded yet.
  if (LSS_STATE.parsedSpellCatalogStatus === "idle" || LSS_STATE.parsedSpellCatalogStatus === "loading") {
    ensureLssParsedSpellCatalogLoaded().then(() => {
      if (!LSS_STATE.profile) return;
      LSS_STATE.profile = hydrateOriginalLssSpellExport(LSS_STATE.profile);
      LSS_STATE.raw = normalizeLssProfileForSave(LSS_STATE.profile);
      if (persistLocal) saveLocalLssRaw(LSS_STATE.raw);
      broadcastLssProfile(LSS_STATE.profile);
      if (LSS_STATE.activeTab === "spells") renderLSS();
    }).catch(() => {});
  }
}

export function clearLssData(options = {}) {
  const { persistLocal = true } = options || {};

  LSS_STATE.raw = null;
  LSS_STATE.profile = null;
  LSS_STATE.source = "empty";
  LSS_STATE.activeTab = "overview";

  if (persistLocal) {
    clearLocalLssRaw();
  }
}

export async function initLSS() {
  await ensureLssConstructorRulesLoaded();
  await ensureLssFeatRulesLoaded();
  await loadLSS();
  renderLSS();
}

// ------------------------------------------------------------
// 🌉 LEGACY BRIDGE
// ------------------------------------------------------------
window.lssModule = {
  loadLSS,
  renderLSS,
  renderHistory,
  getLssProfile,
  getLssRaw,
  setLssData,
  clearLssData,
  initLSS,
};
