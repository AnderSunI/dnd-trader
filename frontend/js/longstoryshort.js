// ============================================================
// frontend/js/longstoryshort.js
// Long Story Short (LSS)
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
      level: { name: "level", value: level },
      background: { name: "background", value: "" },
      playerName: { name: "playerName", value: "" },
      race: { name: "race", value: race },
      alignment: { name: "alignment", value: alignment },
      experience: { name: "experience", value: Math.max(0, toNumber(character?.experience, 0)) },
      size: { name: "size", value: "medium" },
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
  setLssValue(profile, "info.race", race, "race");
  setLssValue(profile, "info.background", background, "background");
  setLssValue(profile, "info.alignment", normalizeAlignment(sanitizePlainText(formData.alignment || "", { max: 50 })), "alignment");
  setLssValue(profile, "info.size", normalizeSize(formData.size || "medium"), "size");
  setLssValue(profile, "info.level", level, "level");
  setLssValue(profile, "info.experience", clampNumber(formData.experience, 0, null, 0), "experience");
  profile.proficiency = clampNumber(formData.proficiency, 0, 20, 2);

  STAT_DEFS.forEach(({ key }) => {
    const score = clampNumber(formData[`stat_${key}`], 1, 30, 10);
    profile.stats[key] = { ...(profile.stats[key] || {}), name: key, score, modifier: statMod(score), check: statMod(score) };
  });

  applyClassGuideToProfile(profile, { source: "quick-create" });
  applyRaceGuideToProfile(profile, { source: "quick-create" });
  applyBackgroundGuideToProfile(profile, { source: "quick-create" });

  profile.vitality = profile.vitality || {};
  profile.vitality["hp-current"] = preserveValueNode(profile.vitality["hp-current"], clampNumber(formData.hpCurrent, 0, 999, 10));
  profile.vitality["hp-max"] = preserveValueNode(profile.vitality["hp-max"], clampNumber(formData.hpMax, 1, 999, formData.hpCurrent || 10));
  profile.vitality["hp-temp"] = preserveValueNode(profile.vitality["hp-temp"], clampNumber(formData.hpTemp, 0, 999, 0));
  profile.vitality.ac = preserveValueNode(profile.vitality.ac, clampNumber(formData.ac, 0, 40, 10));
  profile.vitality.initiative = preserveValueNode(profile.vitality.initiative, formData.initiative === "" || formData.initiative === undefined ? statMod(clampNumber(formData.stat_dex, 1, 30, 10)) : toNumber(formData.initiative, 0));
  profile.vitality.speed = preserveValueNode(profile.vitality.speed, clampNumber(formData.speed, 0, 300, 30));
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
  next.info.race = preserveValueNode(next.info.race, String(unwrapValue(next.info.race, "") || "").trim(), "race");
  next.info.background = preserveValueNode(next.info.background, String(unwrapValue(next.info.background, "") || "").trim(), "background");
  next.info.alignment = preserveValueNode(next.info.alignment, normalizeAlignment(String(unwrapValue(next.info.alignment, "") || "").trim()), "alignment");
  next.info.size = preserveValueNode(next.info.size, normalizeSize(unwrapValue(next.info.size, "medium")), "size");
  next.info.experience = preserveValueNode(next.info.experience, Math.max(0, toNumber(unwrapValue(next.info.experience, 0), 0)), "experience");
  next.vitality = next.vitality || {};
  next.stats = next.stats || {};
  next.saves = next.saves || {};
  next.skills = next.skills || {};
  next.coins = next.coins || {};

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

function getLssRaceGuide(value) {
  return getGuideFromCollection(LSS_RACE_GUIDES, value);
}

function getLssBackgroundGuide(value) {
  return getGuideFromCollection(LSS_BACKGROUND_GUIDES, value);
}

function getLssRaceOptionsHtml() {
  return LSS_RACE_GUIDES.map((guide) => `<option value="${escapeHtml(guide.label)}"></option>`).join("");
}

function getLssBackgroundOptionsHtml() {
  return LSS_BACKGROUND_GUIDES.map((guide) => `<option value="${escapeHtml(guide.label)}"></option>`).join("");
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

function normalizeGuideLookup(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();
}

function getLssClassGuide(value) {
  return getGuideFromCollection(LSS_CLASS_GUIDES, value);
}

function getLssClassOptionsHtml() {
  return LSS_CLASS_GUIDES
    .map((guide) => `<option value="${escapeHtml(guide.label)}"></option>`)
    .join("");
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

function renderLssMechanicsSources(profile) {
  if (!profile) return "";
  const info = profile.info || {};
  const classGuide = getLssClassGuide(unwrapValue(info.charClass, ""));
  const raceGuide = getLssRaceGuide(unwrapValue(info.race, ""));
  const bgGuide = getLssBackgroundGuide(unwrapValue(info.background, ""));

  const rows = [
    classGuide ? { label: "Класс", title: classGuide.label, body: `d${classGuide.hitDie}, спасброски: ${formatStatList(classGuide.saves)}, важны: ${formatStatList(classGuide.primaryStats)}` } : { label: "Класс", title: "не распознан", body: "выбери класс из подсказки, чтобы LSS понял механику" },
    raceGuide ? { label: "Раса", title: raceGuide.label, body: `${raceGuide.size}, скорость ${raceGuide.speed} фт., бонусы: ${formatStatBonusMap(raceGuide.abilityBonuses)}` } : { label: "Раса", title: "не распознана", body: "пока нет механических бонусов расы" },
    bgGuide ? { label: "Предыстория", title: bgGuide.label, body: `навыки: ${formatSkillList(bgGuide.skills)}, инструменты/языки: ${[bgGuide.tools, bgGuide.languages].filter((x) => x && x !== "—").join("; ") || "—"}` } : { label: "Предыстория", title: "не распознана", body: "пока нет навыков/владений от предыстории" },
  ];

  return `
    <div class="lss-mechanics-sources" style="margin:0 0 12px 0; padding:12px; border:1px solid rgba(117,203,198,.18); border-radius:14px; background:rgba(5,12,18,.38);">
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start; flex-wrap:wrap; margin-bottom:8px;">
        <div>
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted, #9fb0b8);">Источники механики</div>
          <div style="font-weight:900; color:var(--gold, #d6b36a);">Что влияет на лист</div>
        </div>
        <div class="muted" style="font-size:12px; max-width:420px;">Сейчас это подсказки конструктора. Авто-сложение всех бонусов характеристик включим отдельным pass, чтобы не задваивать старые LSS-экспорты.</div>
      </div>
      <div class="profile-grid" style="gap:8px;">
        ${rows.map((row) => `
          <div class="meta-item" style="white-space:normal; align-items:flex-start;">
            <strong>${escapeHtml(row.label)}:</strong> ${escapeHtml(row.title)}<br>
            <span class="muted">${escapeHtml(row.body)}</span>
          </div>
        `).join("")}
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

      <div style="font-size:.88rem; line-height:1.38; color:var(--text, #e8eef2);">
        <div><strong>Роль:</strong> ${escapeHtml(guide.role)}</div>
        <div><strong>Магия:</strong> ${escapeHtml(magicLine)}</div>
        <div><strong>1 уровень:</strong> ${escapeHtml((guide.level1 || []).join(", ") || "зависит от сборки")}</div>
      </div>
      <div class="muted" style="margin-top:7px; font-size:.84rem; line-height:1.32;">💡 ${escapeHtml(guide.beginnerTip)}</div>
    </div>
  `;
}

function getExpectedLevelOneHp(guide, conScore = 10) {
  if (!guide) return 10;
  return Math.max(1, toNumber(guide.hitDie, 8) + statMod(toNumber(conScore, 10)));
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
    id: card.id || card._id || card.slug || `spell-${index}`,
    name: card.name || card.title || card.label || `Заклинание ${index + 1}`,
    level: card.level ?? card.circle ?? card.tier ?? "",
    school: card.school || card.schoolName || card.type || "",
    time: card.castingTime || card.time || card.castTime || "",
    range: card.range || card.distance || "",
    duration: card.duration || card.length || "",
    components: joinNonEmpty([card.components, card.materials]),
    description: card.description || card.text || card.effect || card.body || "",
    notes: card.notes || card.meta || "",
  };
}

// ------------------------------------------------------------
// 🔄 NORMALIZATION
// ------------------------------------------------------------
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
        spellsMeta: rawProfile.spells || {},
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

  const profile = normalizeProfile(raw);
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
  setLssValue(profile, "info.level", Math.max(1, toNumber(formData.level, unwrapValue(getNested(profile, "info.level", 1)))), "level");
  setLssValue(profile, "info.background", safeText(formData.background, unwrapValue(getNested(profile, "info.background", ""))), "background");
  setLssValue(profile, "info.race", safeText(formData.race, unwrapValue(getNested(profile, "info.race", ""))), "race");
  setLssValue(profile, "info.alignment", normalizeAlignment(safeText(formData.alignment, unwrapValue(getNested(profile, "info.alignment", "")))), "alignment");
  setLssValue(profile, "info.size", normalizeSize(formData.size || unwrapValue(getNested(profile, "info.size", "medium"))), "size");
  setLssValue(profile, "info.experience", Math.max(0, toNumber(formData.experience, unwrapValue(getNested(profile, "info.experience", 0)))), "experience");

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
  applyRaceGuideToProfile(profile, { source: "edit" });
  applyBackgroundGuideToProfile(profile, { source: "edit" });

  return profile;
}

function collectEditFormData() {
  const fields = [
    "name",
    "charClass",
    "charSubclass",
    "level",
    "background",
    "race",
    "alignment",
    "size",
    "experience",
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

  const characterPool = getLssCharacterPool();
  const hasProfile = Boolean(LSS_STATE.profile);

  return `
    <div class="cabinet-block lss-ref-topbar lss-ref-topbar-compact">
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
        ${hasProfile ? `<button class="btn btn-success" type="button" id="lssSaveNowBtn">💾 Сохранить</button>` : ""}
        ${hasProfile ? `<button class="btn btn-secondary" type="button" id="lssSaveAsNewBtn">＋ Копией</button>` : ""}
        ${hasProfile ? `<button class="btn btn-danger" type="button" id="lssClearDataBtn">Очистить</button>` : ""}
      </div>

      <div class="lss-ref-source-pill">Источник: ${escapeHtml(sourceLabel)}</div>
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
  const map = { class: "класс", background: "предыстория", race: "раса", manual: "вручную", import: "импорт" };
  return map[String(source || "").toLowerCase()] || String(source || "вручную");
}

function renderProficiencyChoice({ id, checked, label, hint = "", source = "", kind = "skill", modifier = null }) {
  const active = checked ? "btn-primary" : "btn-secondary";
  const activeStyle = checked
    ? "color:#06151a; font-weight:900; text-shadow:none;"
    : "";
  const hintStyle = checked
    ? "font-size:0.68rem; color:rgba(6,21,26,.72); font-weight:900;"
    : "font-size:0.68rem;";
  const sourcePill = source ? `<small class="meta-item" style="margin-left:auto; ${checked ? "color:#06313a; border-color:rgba(6,49,58,.22); background:rgba(255,255,255,.18);" : ""}">${escapeHtml(getProficiencySourceLabel(source))}</small>` : "";
  const modPill = modifier !== null && modifier !== undefined ? `<strong style="margin-left:auto; min-width:42px; text-align:center; font-size:1rem; ${checked ? "color:#06151a;" : "color:var(--text,#e8eef2);"}">${escapeHtml(formatSigned(modifier))}</strong>` : "";
  return `
    <label class="lss-prof-choice btn ${active}" title="${escapeHtml(label)}" style="display:flex; align-items:center; gap:8px; justify-content:flex-start; text-align:left; min-height:42px; white-space:normal; ${activeStyle}">
      <input id="${escapeHtml(id)}" type="checkbox" style="display:none;" ${checked ? "checked" : ""} data-lss-prof-kind="${escapeHtml(kind)}">
      <span style="font-size:1.05rem; min-width:14px;">${checked ? "✓" : "+"}</span>
      <span style="min-width:0; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(label)}</span>
      ${hint ? `<small class="muted" style="${hintStyle}">${escapeHtml(hint)}</small>` : ""}
      ${modPill || sourcePill}
      ${modPill && sourcePill ? sourcePill : ""}
    </label>
  `;
}

function renderAbilityFormulaHint(profile) {
  const p = profile || {};
  const dexMod = getStatModifier(p, "dex");
  const pb = getProficiencyBonus(p);
  return `
    <div class="lss-editor-checks-block" style="margin:10px 0 12px;">
      <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:8px;">Как считаются значения</div>
      <div class="profile-grid" style="gap:8px;">
        <div class="meta-item" style="white-space:normal;"><strong>Инициатива:</strong> Ловкость ${escapeHtml(formatSigned(dexMod))}, можно править вручную.</div>
        <div class="meta-item" style="white-space:normal;"><strong>Навык:</strong> модификатор характеристики + ${escapeHtml(formatSigned(pb))} если есть владение.</div>
        <div class="meta-item" style="white-space:normal;"><strong>Спасбросок:</strong> модификатор характеристики + владение, если отмечено.</div>
      </div>
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
          <div class="muted" style="font-size:0.82rem;">Редактирование в sheet-режиме: читаемо, секционно и без огромной стены полей.</div>
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
      ${renderLssMechanicsSources(p)}

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
            <div class="filter-group"><label>Класс</label><input id="lssEdit_charClass" type="text" list="lssEditClassOptions" maxlength="40" data-lss-text="short" value="${escapeHtml(safeText(unwrapValue(info.charClass, ""), ""))}" /></div>
            <datalist id="lssEditClassOptions">${getLssClassOptionsHtml()}</datalist>
            <div class="filter-group"><label>Подкласс</label><input id="lssEdit_charSubclass" type="text" maxlength="60" data-lss-text="short" value="${escapeHtml(safeText(unwrapValue(info.charSubclass, ""), ""))}" placeholder="если уже доступен по уровню" /></div>
            <div class="filter-group"><label>Уровень</label><input id="lssEdit_level" ${numericInputAttrs(1, 20)} value="${escapeHtml(safeText(unwrapValue(info.level, "1"), "1"))}" /></div>
            <div class="filter-group"><label>Раса</label><input id="lssEdit_race" type="text" list="lssEditRaceOptions" maxlength="40" data-lss-text="short" value="${escapeHtml(safeText(unwrapValue(info.race, ""), ""))}" /></div><datalist id="lssEditRaceOptions">${getLssRaceOptionsHtml()}</datalist>
            <div class="filter-group"><label>Предыстория</label><input id="lssEdit_background" type="text" list="lssEditBackgroundOptions" maxlength="50" data-lss-text="short" value="${escapeHtml(safeText(unwrapValue(info.background, ""), ""))}" /></div><datalist id="lssEditBackgroundOptions">${getLssBackgroundOptionsHtml()}</datalist>
            <div class="filter-group"><label>Мировоззрение</label><select id="lssEdit_alignment">${getAlignmentOptionsHtml(unwrapValue(info.alignment, ""))}</select></div>
            <div class="filter-group"><label>Размер</label><select id="lssEdit_size">${getSizeOptionsHtml(unwrapValue(info.size, "medium"))}</select></div>
            <div class="filter-group"><label>Опыт</label><input id="lssEdit_experience" ${numericInputAttrs(0)} value="${escapeHtml(safeText(unwrapValue(info.experience, "0"), "0"))}" /></div>
          </div>
          ${renderLssClassGuidanceCard(unwrapValue(info.charClass, ""), { mode: "edit" })}

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
          <div class="profile-grid">
            <div class="filter-group"><label>HP текущие</label><input id="lssEdit_hpCurrent" ${numericInputAttrs(0)} value="${escapeHtml(safeText(unwrapValue(vitality["hp-current"], "0"), "0"))}" /></div>
            <div class="filter-group"><label>HP максимум</label><input id="lssEdit_hpMax" ${numericInputAttrs(1)} value="${escapeHtml(safeText(unwrapValue(vitality["hp-max"], "1"), "1"))}" /></div>
            <div class="filter-group"><label>HP временные</label><input id="lssEdit_hpTemp" ${numericInputAttrs(0)} value="${escapeHtml(safeText(unwrapValue(vitality["hp-temp"], "0"), "0"))}" /></div>
            <div class="filter-group"><label>КБ</label><input id="lssEdit_ac" ${numericInputAttrs(0)} value="${escapeHtml(safeText(unwrapValue(vitality.ac, "10"), "10"))}" /></div>
            <div class="filter-group"><label>Скорость, фт.</label><input id="lssEdit_speed" ${numericInputAttrs(0)} value="${escapeHtml(safeText(unwrapValue(vitality.speed, "30"), "30"))}" /></div>
            <div class="filter-group"><label>Инициатива <small>авто от Ловкости</small></label><input id="lssEdit_initiative" type="number" inputmode="numeric" value="${escapeHtml(String(getInitiativeModifier(p)))}" data-auto-value="${escapeHtml(String(getDexInitiative(p)))}" /><input id="lssEdit_initiativeAuto" type="hidden" value="${String(unwrapValue(vitality.initiative, "")) === "" ? "1" : "0"}"><small class="muted">Авто сейчас: ${escapeHtml(formatSigned(getDexInitiative(p)))}. Можно вписать вручную.</small></div>
            <div class="filter-group"><label>Бонус владения</label><input id="lssEdit_proficiency" ${numericInputAttrs(0)} value="${escapeHtml(String(getProficiencyBonus(p)))}" /></div>
          </div>
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
            <div class="lss-editor-check-grid lss-editor-check-grid-stats">
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
            <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:8px;">Навыки с владением</div>
            <div class="lss-editor-check-grid">
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
}

function applyQuickClassDefaults() {
  const classInput = getSection("lssQuickCreateClass");
  const guide = getLssClassGuide(classInput?.value || "");
  const levelInput = getSection("lssQuickCreateLevel");
  const proficiencyInput = getSection("lssQuickCreateProficiency");
  const hpInput = getSection("lssQuickCreateHp");
  const hpMaxInput = getSection("lssQuickCreateHpMax");
  const conInput = getSection("lssQuickCreateStat_con");

  if (proficiencyInput) {
    proficiencyInput.value = String(getProficiencyBonusByLevel(levelInput?.value || 1));
  }

  if (!guide) return;

  const conScore = toNumber(conInput?.value, 10);
  const expectedHp = getExpectedLevelOneHp(guide, conScore);
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
  const quickClassInput = getSection("lssQuickCreateClass");
  const quickLevelInput = getSection("lssQuickCreateLevel");
  const quickConInput = getSection("lssQuickCreateStat_con");
  const quickRaceInput = getSection("lssQuickCreateRace");
  const editClassInput = getSection("lssEdit_charClass");
  const editLevelInput = getSection("lssEdit_level");

  if (quickClassInput && quickClassInput.dataset.classGuideBound !== "1") {
    quickClassInput.dataset.classGuideBound = "1";
    quickClassInput.addEventListener("input", () => {
      refreshClassGuidePanel("lssQuickCreateClass", "lssQuickClassGuide");
      applyQuickClassDefaults();
      applyQuickDexDefaults();
    });
    quickClassInput.addEventListener("change", () => {
      refreshClassGuidePanel("lssQuickCreateClass", "lssQuickClassGuide");
      applyQuickClassDefaults();
      applyQuickDexDefaults();
    });
  }

  [quickLevelInput, quickConInput, editLevelInput].forEach((input) => {
    if (!input || input.dataset.classGuideBound === "1") return;
    input.dataset.classGuideBound = "1";
    input.addEventListener("input", () => {
      refreshClassGuidePanel("lssQuickCreateClass", "lssQuickClassGuide");
      refreshClassGuidePanel("lssEdit_charClass", "lssEditClassGuide");
      applyQuickClassDefaults();
      applyQuickDexDefaults();
    });
    input.addEventListener("change", () => {
      refreshClassGuidePanel("lssQuickCreateClass", "lssQuickClassGuide");
      refreshClassGuidePanel("lssEdit_charClass", "lssEditClassGuide");
      applyQuickClassDefaults();
      applyQuickDexDefaults();
    });
  });


  if (quickRaceInput && quickRaceInput.dataset.raceDefaultsBound !== "1") {
    quickRaceInput.dataset.raceDefaultsBound = "1";
    quickRaceInput.addEventListener("input", applyQuickRaceDefaults);
    quickRaceInput.addEventListener("change", applyQuickRaceDefaults);
  }


  if (editClassInput && editClassInput.dataset.classGuideBound !== "1") {
    editClassInput.dataset.classGuideBound = "1";
    editClassInput.addEventListener("input", () => refreshClassGuidePanel("lssEdit_charClass", "lssEditClassGuide"));
    editClassInput.addEventListener("change", () => refreshClassGuidePanel("lssEdit_charClass", "lssEditClassGuide"));
  }

  refreshClassGuidePanel("lssQuickCreateClass", "lssQuickClassGuide");
  refreshClassGuidePanel("lssEdit_charClass", "lssEditClassGuide");
  applyQuickRaceDefaults();
  applyQuickDexDefaults();
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
        race: getSection("lssQuickCreateRace")?.value,
        level: getSection("lssQuickCreateLevel")?.value,
        background: getSection("lssQuickCreateBackground")?.value,
        alignment: getSection("lssQuickCreateAlignment")?.value,
        experience: getSection("lssQuickCreateExperience")?.value,
        proficiency: getSection("lssQuickCreateProficiency")?.value,
        hpCurrent: getSection("lssQuickCreateHp")?.value,
        hpMax: getSection("lssQuickCreateHpMax")?.value || getSection("lssQuickCreateHp")?.value,
        ac: getSection("lssQuickCreateAc")?.value,
        initiative: getSection("lssQuickCreateInitiative")?.value,
        speed: getSection("lssQuickCreateSpeed")?.value,
        size: getSection("lssQuickCreateSize")?.value || "medium",
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
}

// ------------------------------------------------------------
// 🎨 SMALL RENDER HELPERS
// ------------------------------------------------------------
function renderEmptyState() {
  return `
    <div class="cabinet-block lss-ref-empty-state lss-ref-create-state">
      <div class="lss-ref-empty-copy">
        <div class="lss-ref-kicker">LSS constructor</div>
        <h3>Создай игрового персонажа</h3>
        <p>Имя персонажа станет основой для профиля игрока и пула персонажей Master Room. После создания лист сохраняется локально и синхронизируется в аккаунт, если ты авторизован.</p>
      </div>

      <div class="lss-ref-starter-card">
        <div class="lss-ref-starter-grid lss-ref-starter-grid-wide">
          <div class="filter-group lss-ref-field-main"><label>Имя персонажа</label><input id="lssQuickCreateName" type="text" autocomplete="off" maxlength="60" data-lss-text="name" placeholder="Например: Торен"></div>
          <div class="filter-group"><label>Класс</label><input id="lssQuickCreateClass" type="text" list="lssClassOptions" autocomplete="off" maxlength="40" data-lss-text="short" placeholder="Волшебник"></div>
          <datalist id="lssClassOptions">${getLssClassOptionsHtml()}</datalist>
          <div class="filter-group"><label>Подкласс</label><input id="lssQuickCreateSubclass" type="text" autocomplete="off" maxlength="60" data-lss-text="short" placeholder="можно позже"></div>
          <div class="filter-group"><label>Раса</label><input id="lssQuickCreateRace" type="text" list="lssRaceOptions" autocomplete="off" maxlength="40" data-lss-text="short" placeholder="Человек"></div><datalist id="lssRaceOptions">${getLssRaceOptionsHtml()}</datalist>
          <div class="filter-group"><label>Размер</label><select id="lssQuickCreateSize">${getSizeOptionsHtml("medium")}</select></div>
          <div class="filter-group"><label>Предыстория</label><input id="lssQuickCreateBackground" type="text" list="lssBackgroundOptions" autocomplete="off" maxlength="50" data-lss-text="short" placeholder="Дворянин"></div><datalist id="lssBackgroundOptions">${getLssBackgroundOptionsHtml()}</datalist>
          <div class="filter-group"><label>Мировоззрение</label><select id="lssQuickCreateAlignment">${getAlignmentOptionsHtml("")}</select></div>
          <div class="filter-group"><label>Уровень</label><input id="lssQuickCreateLevel" ${numericInputAttrs(1, 20)} value="1"></div>
          <div class="filter-group"><label>Опыт</label><input id="lssQuickCreateExperience" ${numericInputAttrs(0)} value="0"></div>
          <div class="filter-group"><label>Бонус владения</label><input id="lssQuickCreateProficiency" ${numericInputAttrs(0)} value="2"></div>
          <div class="filter-group"><label>HP текущие</label><input id="lssQuickCreateHp" ${numericInputAttrs(1)} value="10"></div>
          <div class="filter-group"><label>HP максимум</label><input id="lssQuickCreateHpMax" ${numericInputAttrs(1)} value="10"></div>
          <div class="filter-group"><label>КБ</label><input id="lssQuickCreateAc" ${numericInputAttrs(1)} value="10"></div>
          <div class="filter-group"><label>Инициатива <small>авто от Ловкости</small></label><input id="lssQuickCreateInitiative" type="number" inputmode="numeric" value="0" data-auto-value="0"><small class="muted">Можно править вручную.</small></div>
          <div class="filter-group"><label>Скорость, фт.</label><input id="lssQuickCreateSpeed" ${numericInputAttrs(0)} value="30"></div>
        </div>

        ${renderLssClassGuidanceCard("", { mode: "quick" })}

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
    <div class="cabinet-block lss-ref-dice-dock" style="margin:10px 0 12px; position:relative; z-index:3;">
      <div class="flex-between" style="gap:8px; align-items:center;">
        <div>
          <div style="font-weight:800; font-size:14px;">🎲 Кубы</div>
          <div class="muted" style="font-size:11px;">быстрый бросок без сохранения листа</div>
        </div>
        <button class="btn btn-secondary" type="button" id="lssDiceToggleInlineBtn">Скрыть</button>
      </div>
      <div class="cart-buttons lss-ref-dice-buttons">
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
        <div><b>Кость хитов:</b> ${escapeHtml(String(unwrapValue(vitality["hit-die"], "—")))}</div>
        <div><b>Кости хитов (тек.):</b> ${escapeHtml(String(unwrapValue(vitality["hp-dice-current"], "0")))}</div>
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
  return `
    <div class="cabinet-block" style="padding:12px;">
      <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <div>
          <h3 style="margin:0 0 4px 0;">Навыки</h3>
          <div class="muted" style="font-size:12px;">✓ = владение; клик по навыку переключает ручное владение</div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:10px; align-items:start;">
        ${STAT_DEFS.map(({ key, label }) => {
          const statMod = getStatModifier(profile, key);
          const skills = getSkillsByStat(profile, key);
          const profCount = skills.filter(([skillKey]) => isSkillProficient(profile, skillKey)).length;
          return `
            <div class="stat-box" style="padding:10px; min-width:0; border-radius:16px; min-height:auto;">
              <div class="flex-between" style="align-items:flex-start; gap:8px; margin-bottom:8px;">
                <div>
                  <div style="font-weight:800; line-height:1.1;">${escapeHtml(label)}</div>
                  <div class="muted" style="font-size:12px; margin-top:3px;">мод. ${escapeHtml(formatSigned(statMod))} • знач. ${escapeHtml(String(getStatScore(profile, key)))}</div>
                </div>
                <span class="quality-badge" style="padding:2px 7px; min-height:auto;">владений ${escapeHtml(String(profCount))}</span>
              </div>
              ${skills.length ? `
                <div style="display:flex; flex-direction:column; gap:6px; min-width:0;">
                  ${skills.map(([skillKey]) => {
                    const skillLabel = SKILL_LABELS[skillKey] || capitalizeRu(skillKey);
                    const value = getSkillModifier(profile, skillKey);
                    const prof = isSkillProficient(profile, skillKey);
                    return `
                      <label class="inline-checkbox" style="display:flex; align-items:center; justify-content:space-between; gap:10px; min-height:auto; padding:7px 9px; border-radius:10px; border:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.03); cursor:pointer;">
                        <span style="display:flex; align-items:center; gap:8px; min-width:0; overflow:hidden;">
                          <input type="checkbox" data-lss-skill-prof="${escapeHtml(skillKey)}" ${prof ? "checked" : ""} />
                          <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(skillLabel)}</span>
                        </span>
                        <strong style="font-size:15px;">${escapeHtml(formatSigned(value))}</strong>
                      </label>
                    `;
                  }).join("")}
                </div>
              ` : `<div class="muted" style="font-size:13px;">Нет навыков на этой характеристике.</div>`}
            </div>
          `;
        }).join("")}
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
        <div class="stat-box lss-mini-box"><div class="muted">Кость хитов</div><div style="font-size:16px;font-weight:800;">${escapeHtml(String(unwrapValue(vitality["hit-die"], "—")))}</div></div>
        <div class="stat-box lss-mini-box"><div class="muted">Кости</div><div style="font-size:16px;font-weight:800;">${escapeHtml(String(unwrapValue(vitality["hp-dice-current"], "0")))}</div></div>
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


function renderSpellCards(profile) {
  const expanded = getSpellCardsExpanded(profile).map(normalizeSpellCard);
  const prepared = getPreparedSpellIds(profile);
  const book = getBookSpellIds(profile);

  if (expanded.length) {
    return `
      <div class="cabinet-block" style="padding:12px;">
        <div class="flex-between" style="align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
          <h3 style="margin:0;">Карточки заклинаний</h3>
          <div class="trader-meta" style="gap:6px;">
            <span class="meta-item">Подготовлено: ${escapeHtml(String(prepared.length))}</span>
            <span class="meta-item">В книге: ${escapeHtml(String(book.length))}</span>
          </div>
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:10px;">
          ${expanded
            .map(
              (spell) => `
                <div class="lss-rich-block" style="padding:10px 12px;">
                  <div class="flex-between" style="align-items:flex-start; gap:8px; margin-bottom:8px;">
                    <h4 style="margin:0;">${escapeHtml(String(spell.name))}</h4>
                    ${prepared.includes(spell.id) ? `<span class="quality-badge" style="padding:2px 7px; min-height:auto;">подготовлено</span>` : ``}
                  </div>

                  <div class="inv-item-details" style="margin-bottom:8px; gap:6px;">
                    ${spell.level !== "" ? `<span>Круг: ${escapeHtml(String(spell.level))}</span>` : ""}
                    ${spell.school ? `<span>${escapeHtml(String(spell.school))}</span>` : ""}
                    ${spell.time ? `<span>${escapeHtml(String(spell.time))}</span>` : ""}
                    ${spell.range ? `<span>${escapeHtml(String(spell.range))}</span>` : ""}
                    ${spell.duration ? `<span>${escapeHtml(String(spell.duration))}</span>` : ""}
                  </div>

                  ${spell.components ? `<div class="muted" style="margin-bottom:8px; font-size:12px;">${escapeHtml(String(spell.components))}</div>` : ""}
                  ${spell.description ? `<div style="font-size:14px; line-height:1.45;">${escapeHtml(String(spell.description))}</div>` : `<div class="muted">Описание пока не загружено.</div>`}
                  ${spell.notes ? `<div class="muted" style="margin-top:8px; font-size:12px;">${escapeHtml(String(spell.notes))}</div>` : ""}
                </div>
              `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  return `
    <div class="cabinet-block" style="padding:12px;">
      <div class="flex-between" style="align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <h3 style="margin:0;">Карточки заклинаний</h3>
        <div class="trader-meta" style="gap:6px;">
          <span class="meta-item">Подготовлено: ${escapeHtml(String(prepared.length))}</span>
          <span class="meta-item">В книге: ${escapeHtml(String(book.length))}</span>
        </div>
      </div>
      <div class="muted">Развёрнутые карточки пока не загружены.</div>
    </div>
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

  const normalizedRaw = normalizeLssProfileForSave(normalizeProfile(cloneData(raw)) || cloneData(raw));
  LSS_STATE.raw = cloneData(normalizedRaw);
  LSS_STATE.profile = normalizeProfile(cloneData(normalizedRaw));
  LSS_STATE.source = source;
  broadcastLssProfile(LSS_STATE.profile);
  if (!LSS_TAB_DEFS.some((tab) => tab.key === LSS_STATE.activeTab)) {
    LSS_STATE.activeTab = "overview";
  }

  if (persistLocal) {
    saveLocalLssRaw(LSS_STATE.raw);
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
