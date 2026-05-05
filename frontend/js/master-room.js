// ============================================================
// frontend/js/master-room.js
// Active runtime module for Master Room.
// Round 30: extracted from cabinet runtime into a dedicated module.
// Owns table lobby, party, access, grants, journal and combat embed.
// cabinet.js only mounts this module into #cabinet-masterroom.
// ============================================================

import {
  apiGet,
  apiWrite,
  buildUserScopedStorageKey,
  escapeHtml,
  formatDateTime,
  formatTime,
  getCurrentRole,
  getCurrentUser,
  getSection,
  normalizeRole,
  safeArray,
  safeNumber,
  safeText,
  showToast,
  trimText,
  tryParseJson,
} from "./shared.js";

import {
  getLssProfile,
  getLssRaw,
} from "./longstoryshort.js";

import {
  bindCombatModule,
  renderCombatModule,
} from "./combat.js";

import {
  getCodexState,
} from "./bestiari.js";

const MASTER_ROOM_VERSION = "round33-api-noise-guard";
const MASTER_ROOM_API_SYNC_ENABLED = false;
const STORAGE_PREFIX = "dnd_trader_master_room_runtime_";
const UI_STORAGE_KEY = "dnd_trader_master_room_ui";

const MASTER_TABS = [
  { key: "table", label: "Стол", icon: "♛", hint: "лобби и сцена" },
  { key: "party", label: "Партия", icon: "⚜", hint: "игроки и LSS" },
  { key: "characters", label: "Персонажи", icon: "◈", hint: "листы и статы" },
  { key: "access", label: "Доступы", icon: "▣", hint: "видимость" },
  { key: "traders", label: "Торговцы", icon: "◍", hint: "сцены и скидки" },
  { key: "grants", label: "Выдача", icon: "✦", hint: "предметы и золото" },
  { key: "combat", label: "Бой", icon: "⚔", hint: "инициатива" },
  { key: "journal", label: "Журнал", icon: "☷", hint: "события" },
];

const DEFAULT_VISIBILITY = {
  sheet: "party",
  inventory: "hidden",
  stats: "party",
  biography: "hidden",
  notes: "hidden",
  combat: "party",
};

const MASTER_ROOM_STATE = {
  loaded: false,
  source: "empty",
  role: "player",
  tables: [],
  activeTableId: null,
  activeTab: "table",
  joinToken: "",
  searchQuery: "",
  ui: {
    createOpen: false,
    quickActionsOpen: false,
    selectedMemberId: "",
    selectedEventId: "",
    actionType: "attack",
  },
};

function isGmRole() {
  return normalizeRole(getCurrentRole()) === "gm";
}

function getUserKey() {
  const user = getCurrentUser();
  return String(user?.id || user?.email || user?.nickname || "guest");
}

function makeId(prefix = "mr") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function makeToken(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function displayText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const joined = value.map((item) => displayText(item, "")).filter(Boolean).join(", ");
    return joined || fallback;
  }
  if (typeof value === "object") {
    const direct = value.name || value.title || value.label || value.value || value.text || value.ru || value.en;
    if (direct && direct !== value) return displayText(direct, fallback);
    try {
      const compact = JSON.stringify(value);
      return compact && compact !== "{}" ? compact.slice(0, 160) : fallback;
    } catch (_) {
      return fallback;
    }
  }
  return safeText(value, fallback);
}

function clampText(value, maxLength = 120) {
  const text = displayText(value, "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function displayName(value, fallback = "Без названия") {
  return clampText(displayText(value, fallback), 80) || fallback;
}

function readUiState() {
  try {
    const parsed = tryParseJson(localStorage.getItem(UI_STORAGE_KEY));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeUiState() {
  try {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({
      activeTab: MASTER_ROOM_STATE.activeTab,
      activeTableId: MASTER_ROOM_STATE.activeTableId,
      quickActionsOpen: MASTER_ROOM_STATE.ui.quickActionsOpen,
    }));
  } catch (_) {}
}

function getStorageKey() {
  return buildUserScopedStorageKey(STORAGE_PREFIX);
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(getStorageKey());
    return raw ? tryParseJson(raw) : null;
  } catch (_) {
    return null;
  }
}

function saveLocal() {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify({ tables: MASTER_ROOM_STATE.tables }));
  } catch (_) {}
}

async function persistMasterRoom() {
  saveLocal();
  writeUiState();

  // Сейчас у backend нет bulk-save endpoint для всего runtime-состояния Master Room.
  // Старый вариант пробовал POST/PUT/PATCH в несколько несуществующих/несовместимых URL,
  // из-за чего консоль забивалась 404/405/422. Пока держим Master Room local-first.
  if (!MASTER_ROOM_API_SYNC_ENABLED) {
    MASTER_ROOM_STATE.source = "local";
    return true;
  }

  const payload = { tables: MASTER_ROOM_STATE.tables };
  const result = await apiWrite("/gm/master-room", payload, ["PATCH"]);

  MASTER_ROOM_STATE.source = result ? "api" : "local";
  return true;
}

function emitMasterEvent(event = {}) {
  const table = getActiveTable();
  const detail = {
    id: event.id || makeId("event"),
    scope: event.scope || "gm",
    type: event.type || "system",
    title: displayText(event.title, "Событие стола"),
    description: displayText(event.description, ""),
    actor: displayText(event.actor || getCurrentUser()?.nickname || getCurrentUser()?.email, "system"),
    table_id: table?.id || "",
    table_title: table?.title || "",
    created_at: event.created_at || new Date().toISOString(),
    ...event,
  };

  if (table) {
    table.events = [detail, ...safeArray(table.events)].slice(0, 80);
    if (detail.type === "combat" || detail.type === "roll" || detail.type === "damage" || detail.type === "heal") {
      table.combat = normalizeCombat(table.combat, table);
      table.combat.log = [combatLogFromEvent(detail), ...safeArray(table.combat.log)].slice(0, 120);
    }
  }

  try {
    window.dispatchEvent(new CustomEvent("dnd:history:add", { detail }));
  } catch (_) {}

  try {
    if (window.historyModule?.appendHistoryEntry) {
      window.historyModule.appendHistoryEntry(detail, {
        rerender: false,
        persistLocal: true,
        prepend: true,
      });
    }
  } catch (_) {}
}

function combatLogFromEvent(event = {}) {
  return {
    id: event.id || makeId("log"),
    event_type: event.combat_type || event.type || "note",
    actor_name: displayText(event.actor, "system"),
    target_name: displayText(event.target_name, ""),
    reason: displayText(event.title, "Событие"),
    summary: displayText(event.description || event.title, ""),
    total: event.total ?? null,
    dice: event.dice || "",
    scope: event.scope || "public",
    created_at: event.created_at || new Date().toISOString(),
  };
}

function normalizeTable(raw = {}, index = 0) {
  const currentUser = getCurrentUser();
  const ownerId = String(raw.owner_user_id || raw.owner_id || raw.created_by || currentUser?.id || currentUser?.email || "owner");
  const id = String(raw.id || raw.table_id || makeId(`table_${index}`));
  const table = {
    id,
    title: safeText(raw.title || raw.name, index ? `Стол ${index + 1}` : "Новый стол"),
    token: safeText(raw.token || raw.join_code || makeToken(), ""),
    campaign: safeText(raw.campaign || raw.campaign_name, "Кампания"),
    scene: safeText(raw.scene || raw.active_scene, "Сцена не выбрана"),
    scene_description: safeText(raw.scene_description || raw.description, ""),
    status: safeText(raw.status, "active"),
    owner_user_id: ownerId,
    owner_label: safeText(raw.owner_label || raw.owner_name || currentUser?.nickname || currentUser?.email, "GM"),
    created_at: raw.created_at || new Date().toISOString(),
    updated_at: raw.updated_at || new Date().toISOString(),
    members: normalizeMembers(raw.members || raw.players || raw.party || []),
    traders: normalizeTraders(raw.traders || raw.shared_traders || []),
    grants: normalizeGrants(raw.grants || raw.rewards || []),
    access: normalizeAccess(raw.access || raw.visibility || {}),
    events: safeArray(raw.events || raw.journal || raw.log).map(normalizeEvent),
    combat: null,
    notes: displayText(raw.notes, ""),
  };
  table.combat = normalizeCombat(raw.combat, table);
  return table;
}

function normalizeMembers(list = []) {
  return safeArray(list).map((raw, index) => {
    const profile = raw.profile || raw.character || {};
    const name = displayText(
      raw.nickname || raw.display_name || raw.name || raw.email || profile.name || profile.info?.name,
      `Игрок ${index + 1}`
    );
    return {
      id: String(raw.id || raw.member_id || raw.user_id || makeId(`member_${index}`)),
      user_id: raw.user_id || raw.id || null,
      nickname: name,
      email: displayText(raw.email, ""),
      role: displayText(raw.role, index === 0 ? "leader" : "player"),
      online: raw.online ?? raw.is_online ?? index < 3,
      selected_character_name: displayText(raw.selected_character_name || profile.name || profile.info?.name, name),
      portrait_url: displayText(raw.portrait_url || raw.avatar_url || profile.portrait_url || profile.avatar_url, ""),
      level: safeNumber(raw.level || profile.level || profile.info?.level, 1),
      class_name: displayText(raw.class_name || raw.class || profile.class_name || profile.info?.class, "Персонаж"),
      race: displayText(raw.race || profile.race || profile.info?.race, ""),
      hp_current: safeNumber(raw.hp_current ?? profile.hp_current ?? profile.hp?.current, 10),
      hp_max: safeNumber(raw.hp_max ?? profile.hp_max ?? profile.hp?.max, 10),
      mp_current: safeNumber(raw.mp_current ?? profile.mp_current ?? profile.mp?.current, 0),
      mp_max: safeNumber(raw.mp_max ?? profile.mp_max ?? profile.mp?.max, 0),
      ac: safeNumber(raw.ac ?? raw.armor_class ?? profile.ac ?? profile.armor_class, 10),
      initiative: safeNumber(raw.initiative ?? profile.initiative, 0),
      visibility: { ...DEFAULT_VISIBILITY, ...(raw.visibility || {}) },
      sheet: profile,
      notes: displayText(raw.notes, ""),
    };
  });
}

function normalizeTraders(list = []) {
  return safeArray(list).map((raw, index) => {
    if (typeof raw === "string") {
      return { id: makeId(`trader_${index}`), name: raw, status: "open", scene: "", reputation: 0 };
    }
    return {
      id: String(raw.id || raw.trader_id || makeId(`trader_${index}`)),
      name: displayText(raw.name || raw.title, `Торговец ${index + 1}`),
      type: displayText(raw.type || raw.specialty, "Торговец"),
      status: displayText(raw.status, "open"),
      scene: displayText(raw.scene || raw.location, ""),
      reputation: safeNumber(raw.reputation || raw.rep, 0),
      portrait_url: displayText(raw.portrait_url || raw.image, ""),
    };
  });
}

function normalizeGrants(list = []) {
  return safeArray(list).map((raw, index) => ({
    id: String(raw.id || makeId(`grant_${index}`)),
    target_member_id: String(raw.target_member_id || raw.member_id || ""),
    target_name: displayText(raw.target_name || raw.member_name, ""),
    type: displayText(raw.type, raw.gold ? "gold" : "item"),
    item_name: displayText(raw.item_name || raw.name, ""),
    quantity: safeNumber(raw.quantity || raw.qty, 1),
    gold: safeNumber(raw.gold || raw.amount, 0),
    reason: displayText(raw.reason, ""),
    created_at: raw.created_at || new Date().toISOString(),
  }));
}

function normalizeAccess(raw = {}) {
  return {
    scene: safeText(raw.scene, "party"),
    map: safeText(raw.map, "party"),
    quests: safeText(raw.quests, "party"),
    notes: safeText(raw.notes, "hidden"),
    inventory: safeText(raw.inventory, "hidden"),
    combat: safeText(raw.combat, "party"),
    journal: safeText(raw.journal, "party"),
    traders: safeText(raw.traders, "party"),
    bestiary: safeText(raw.bestiary, "hidden"),
  };
}

function normalizeEvent(raw = {}) {
  return {
    id: String(raw.id || makeId("event")),
    type: safeText(raw.type || raw.scope, "system"),
    title: safeText(raw.title || raw.label, "Событие"),
    description: safeText(raw.description || raw.summary || raw.details, ""),
    actor: safeText(raw.actor || raw.author || raw.user, "system"),
    created_at: raw.created_at || raw.time || new Date().toISOString(),
    scope: safeText(raw.scope, "gm"),
  };
}

function normalizeCombat(raw = {}, table = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  const memberEntries = table ? safeArray(table.members).map((member, index) => ({
    entry_id: `member:${member.id}`,
    membership_id: member.id,
    type: "member",
    name: member.selected_character_name || member.nickname,
    player_name: member.nickname,
    portrait_url: member.portrait_url,
    initiative: safeNumber(member.initiative, 0) + (20 - index),
    hp_current: safeNumber(member.hp_current, 10),
    hp_max: safeNumber(member.hp_max, 10),
    ac: safeNumber(member.ac, 10),
    speed: safeNumber(member.speed, 30),
    status: "",
    conditions: [],
  })) : [];

  const existing = safeArray(source.entries).map((entry, index) => ({
    entry_id: String(entry.entry_id || entry.id || makeId(`combat_${index}`)),
    membership_id: entry.membership_id || null,
    type: safeText(entry.type, "enemy"),
    name: displayText(entry.name, `Участник ${index + 1}`),
    player_name: displayText(entry.player_name, ""),
    portrait_url: displayText(entry.portrait_url || entry.avatar_url, ""),
    initiative: safeNumber(entry.initiative, 10),
    hp_current: safeNumber(entry.hp_current ?? entry.hp?.current, 10),
    hp_max: safeNumber(entry.hp_max ?? entry.hp?.max, 10),
    ac: safeNumber(entry.ac ?? entry.armor_class, 10),
    speed: safeNumber(entry.speed, 30),
    status: displayText(entry.status, ""),
    conditions: safeArray(entry.conditions),
  }));

  const merged = existing.length ? existing : memberEntries;
  return {
    active: Boolean(source.active || merged.length),
    round: Math.max(1, safeNumber(source.round, 1)),
    turn_index: Math.max(0, safeNumber(source.turn_index, 0)),
    entries: merged,
    log: safeArray(source.log).map((item, index) => ({
      id: String(item.id || makeId(`log_${index}`)),
      event_type: displayText(item.event_type || item.type, "note"),
      actor_name: displayText(item.actor_name || item.actor, "system"),
      target_name: displayText(item.target_name || item.target, ""),
      reason: displayText(item.reason || item.title, "Событие"),
      summary: displayText(item.summary || item.description, ""),
      dice: displayText(item.dice, ""),
      total: item.total ?? null,
      scope: displayText(item.scope, "public"),
      created_at: item.created_at || new Date().toISOString(),
    })),
    environment: source.environment || {
      location: table?.scene || "Сцена боя",
      light: "обычное освещение",
      surface: "обычная поверхность",
      features: "без особых условий",
    },
    last_roll: source.last_roll || null,
  };
}

function getActiveTable() {
  return MASTER_ROOM_STATE.tables.find((table) => String(table.id) === String(MASTER_ROOM_STATE.activeTableId)) || MASTER_ROOM_STATE.tables[0] || null;
}

function canManageTable(table = getActiveTable()) {
  if (!table) return isGmRole();
  const user = getCurrentUser();
  const userId = String(user?.id || user?.email || "");
  return isGmRole() || String(table.owner_user_id || "") === userId;
}

function getCurrentMember(table = getActiveTable()) {
  const user = getCurrentUser();
  const userKeys = [String(user?.id || ""), String(user?.email || ""), String(user?.nickname || "")].filter(Boolean);
  return safeArray(table?.members).find((member) =>
    userKeys.includes(String(member.user_id || "")) ||
    userKeys.includes(String(member.email || "")) ||
    userKeys.includes(String(member.nickname || ""))
  ) || null;
}

function getLssSnapshot() {
  const profile = getLssProfile?.() || {};
  const raw = getLssRaw?.() || {};
  const info = profile.info || raw.info || {};
  const hp = profile.hp || raw.hp || {};
  return {
    name: displayText(profile.name || raw.name || info.name, ""),
    class_name: displayText(profile.class_name || raw.class_name || info.class || info.class_name, ""),
    race: displayText(profile.race || raw.race || info.race, ""),
    level: safeNumber(profile.level || raw.level || info.level, 1),
    portrait_url: displayText(profile.portrait_url || raw.portrait_url || profile.avatar_url || raw.avatar_url, ""),
    hp_current: safeNumber(profile.hp_current ?? raw.hp_current ?? hp.current, 10),
    hp_max: safeNumber(profile.hp_max ?? raw.hp_max ?? hp.max, 10),
    ac: safeNumber(profile.ac ?? raw.ac ?? profile.armor_class ?? raw.armor_class, 10),
    initiative: safeNumber(profile.initiative ?? raw.initiative, 0),
    sheet: profile && Object.keys(profile).length ? profile : raw,
  };
}

function getKnownTraders() {
  const candidates = [
    window.__appFilteredTraders,
    window.__appStateTraders,
    window.__appState?.traders,
  ];
  const list = candidates.find((item) => Array.isArray(item) && item.length) || [];
  return safeArray(list).map((trader, index) => normalizeTraders([{ ...trader, id: trader.id || trader.trader_id || `known_trader_${index}` }])[0]);
}

function getKnownInventoryItems() {
  const candidates = [
    window.__appStateInventory,
    window.__appState?.inventory,
    window.__sharedState?.inventory,
  ];
  const list = candidates.find((item) => Array.isArray(item) && item.length) || [];
  return safeArray(list).map((item, index) => ({
    id: String(item.id || item.item_id || item.uuid || `inventory_item_${index}`),
    name: displayText(item.name || item.title || item.item_name, `Предмет ${index + 1}`),
    category: displayText(item.category || item.type || item.item_type, "Предмет"),
    rarity: displayText(item.rarity || item.quality, ""),
    quantity: safeNumber(item.quantity || item.qty || item.count, 1),
    raw: item,
  }));
}

function getKnownBestiaryEntries() {
  try {
    const state = getCodexState?.();
    const entries = safeArray(state?.entries);
    if (entries.length) return entries;
  } catch (_) {}
  try {
    const user = getCurrentUser();
    const key = `dnd_trader_bestiari_${user?.id || user?.email || user?.nickname || "guest"}`;
    const parsed = tryParseJson(localStorage.getItem(key));
    if (Array.isArray(parsed?.entries)) return parsed.entries;
  } catch (_) {}
  return [];
}

function getKnownMonsterEntries() {
  return getKnownBestiaryEntries().filter((entry) => {
    const category = displayText(entry.category || entry.type, "").toLowerCase();
    const tags = safeArray(entry.tags).map((tag) => displayText(tag, "").toLowerCase());
    return ["monster", "monsters", "creature", "creatures", "монстр", "монстры", "существо", "существа"].includes(category) || tags.some((tag) => tag.includes("монстр") || tag.includes("creature"));
  });
}

function renderOptions(items, selectedId = "", placeholder = "Выбрать") {
  const opts = [`<option value="">${escapeHtml(placeholder)}</option>`];
  safeArray(items).forEach((item) => {
    const id = displayText(item.id || item.entry_id || item.title || item.name, "");
    const label = displayText(item.name || item.title, id || placeholder);
    opts.push(`<option value="${escapeHtml(id)}" ${String(id) === String(selectedId) ? "selected" : ""}>${escapeHtml(label)}</option>`);
  });
  return opts.join("");
}

function bestiaryEntryToCombatEnemy(entry) {
  const stats = entry?.stats || entry?.statblock || {};
  const hp = entry?.hp || entry?.hit_points || stats.hp || {};
  const name = displayText(entry?.title || entry?.name, "Монстр");
  return {
    entry_id: makeId("enemy"),
    type: "enemy",
    entity_kind: "enemy",
    name,
    player_name: "Бестиарий",
    portrait_url: displayText(entry?.image || entry?.portrait_url || entry?.avatar_url, ""),
    initiative: rollDie(20) + safeNumber(entry?.initiative || stats.initiative, 0),
    hp_current: safeNumber(hp.current ?? hp.value ?? entry?.hp_current ?? entry?.hp_max ?? stats.hp_current, 10),
    hp_max: safeNumber(hp.max ?? hp.value ?? entry?.hp_max ?? stats.hp_max, 10),
    ac: safeNumber(entry?.ac ?? entry?.armor_class ?? stats.ac ?? stats.armor_class, 10),
    speed: safeNumber(entry?.speed ?? stats.speed, 30),
    status: "ready",
    conditions: [],
    source: "bestiary",
    class_name: displayText(entry?.subtitle || entry?.type, ""),
    race: displayText(entry?.creature_type || entry?.category, ""),
    attacks: safeArray(entry?.actions || entry?.attacks),
    abilities: entry?.abilities || entry?.stats || {},
  };
}

function memberFromCurrentUser() {
  const user = getCurrentUser();
  const lss = getLssSnapshot();
  return {
    id: makeId("member"),
    user_id: user?.id || user?.email || makeId("user"),
    nickname: displayText(user?.nickname || user?.display_name || user?.email, "Игрок"),
    email: safeText(user?.email, ""),
    role: "leader",
    online: true,
    selected_character_name: lss.name || displayText(user?.nickname || user?.email, "Персонаж"),
    portrait_url: lss.portrait_url || displayText(user?.avatar_url, ""),
    level: lss.level || 1,
    class_name: lss.class_name || "Персонаж",
    race: lss.race || "",
    hp_current: lss.hp_current,
    hp_max: lss.hp_max,
    ac: lss.ac,
    initiative: lss.initiative,
    visibility: { ...DEFAULT_VISIBILITY },
    sheet: lss.sheet || {},
    notes: "",
  };
}

function ensureCurrentUserInTable(table) {
  if (!table) return;
  const existing = getCurrentMember(table);
  if (existing) return;
  table.members = [memberFromCurrentUser(), ...safeArray(table.members)];
}

function hpPercent(entry) {
  const max = Math.max(1, safeNumber(entry.hp_max, 1));
  return Math.max(0, Math.min(100, Math.round((safeNumber(entry.hp_current, 0) / max) * 100)));
}

function rollDie(sides = 20) {
  return Math.floor(Math.random() * sides) + 1;
}

function parseDice(expression = "d20") {
  const text = String(expression || "d20").trim().toLowerCase();
  const match = text.match(/^(\d*)d(\d+)(?:\s*([+-])\s*(\d+))?$/);
  if (!match) return { dice: text, rolls: [rollDie(20)], modifier: 0, total: rollDie(20) };
  const count = Math.max(1, safeNumber(match[1] || 1, 1));
  const sides = Math.max(2, safeNumber(match[2], 20));
  const sign = match[3] === "-" ? -1 : 1;
  const modifier = match[4] ? sign * safeNumber(match[4], 0) : 0;
  const rolls = Array.from({ length: Math.min(count, 20) }, () => rollDie(sides));
  const total = rolls.reduce((sum, value) => sum + value, 0) + modifier;
  return { dice: text, rolls, modifier, total };
}

function stageLabel(key) {
  return MASTER_TABS.find((tab) => tab.key === key)?.label || "Стол";
}

function renderAvatar(src, label, className = "master-runtime-avatar") {
  if (src) return `<img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" class="${escapeHtml(className)}-img">`;
  const fallbackLetter = displayText(label, "?").slice(0, 1).toUpperCase();
  return `<span class="${escapeHtml(className)}-fallback">${escapeHtml(fallbackLetter)}</span>`;
}

function renderMetric(label, value, icon = "◇") {
  return `
    <div class="master-runtime-metric">
      <span>${escapeHtml(icon)}</span>
      <div>
        <strong>${escapeHtml(displayText(value, "—"))}</strong>
        <small>${escapeHtml(label)}</small>
      </div>
    </div>
  `;
}

function switchToCabinetTab(tabName = "myaccount") {
  try {
    if (window.cabinetModule?.switchCabinetTab) {
      window.cabinetModule.switchCabinetTab(tabName);
      return true;
    }
  } catch (_) {}

  try {
    const target = document.querySelector(`[data-cabinet-tab="${tabName}"]`) || document.querySelector('[data-cabinet-tab="myaccount"]');
    if (target) {
      target.click();
      return true;
    }
  } catch (_) {}

  return false;
}


function renderShellHeader(table, canManage) {
  const members = safeArray(table?.members);
  const combat = normalizeCombat(table?.combat, table);
  return `
    <header class="master-runtime-hero">
      <div class="master-runtime-brand">
        <div class="master-runtime-gm-avatar">
          ${renderAvatar(getCurrentUser()?.avatar_url || table?.members?.[0]?.portrait_url || "", table?.owner_label || "GM", "master-runtime-gm-avatar")}
          <span>${canManage ? "GM" : "PLAYER"}</span>
        </div>
        <div>
          <div class="master-runtime-kicker">Master Room</div>
          <h2>${escapeHtml(table?.title || "Стол не выбран")}</h2>
          <div class="master-runtime-subline">
            <span>${escapeHtml(table?.campaign || "Кампания")}</span>
            <span>•</span>
            <span>ID: ${escapeHtml(table?.token || "—")}</span>
            <span>•</span>
            <span>${canManage ? "полный доступ" : "player layer"}</span>
          </div>
        </div>
      </div>
      <div class="master-runtime-hero-stats">
        ${renderMetric("Сессия", table ? "активна" : "нет", "●")}
        ${renderMetric("Онлайн", members.filter((m) => m.online).length, "◉")}
        ${renderMetric("Сцена", clampText(table?.scene || "—", 22), "✦")}
        ${renderMetric("Раунд", combat.active ? combat.round : "—", "⚔")}
      </div>
      <div class="master-runtime-hero-actions">
        <button class="btn master-runtime-quick-toggle" type="button" data-master-runtime-action="toggle-quick-actions">⚡ Быстрые действия</button>
        <button class="btn master-runtime-exit-btn" type="button" data-master-runtime-action="exit-to-cabinet">← В кабинет</button>
      </div>
    </header>
  `;
}

function renderTableTabs() {
  return `
    <nav class="master-runtime-tabs" aria-label="Master Room tabs">
      ${MASTER_TABS.map((tab) => `
        <button class="master-runtime-tab ${MASTER_ROOM_STATE.activeTab === tab.key ? "active" : ""}" type="button" data-master-runtime-tab="${escapeHtml(tab.key)}">
          <span>${escapeHtml(tab.icon)}</span>
          <strong>${escapeHtml(tab.label)}</strong>
          <small>${escapeHtml(tab.hint)}</small>
        </button>
      `).join("")}
    </nav>
  `;
}

function renderLobby() {
  return `
    <div class="master-runtime-lobby">
      <section class="master-runtime-lobby-card master-runtime-lobby-card-main">
        <div class="master-runtime-kicker">Лобби стола</div>
        <h2>Создай стол или присоединись к кампании</h2>
        <p>Выбери LSS-персонажа, собери партию и открой сцену. Мастер видит всё; игроки видят только разрешённый слой.</p>
        <div class="master-runtime-lobby-actions">
          <button class="btn btn-primary" type="button" data-master-runtime-action="quick-create-table">Создать быстрый стол</button>
          <button class="btn" type="button" data-master-runtime-action="toggle-create">Создать подробно</button>
        </div>
      </section>
      <section class="master-runtime-lobby-card">
        <div class="master-runtime-kicker">Присоединиться</div>
        <h3>Код стола</h3>
        <input id="masterRuntimeJoinToken" value="${escapeHtml(MASTER_ROOM_STATE.joinToken)}" placeholder="Например: A7K2M9QX">
        <button class="btn btn-primary" type="button" data-master-runtime-action="join-table">Войти в стол</button>
      </section>
      ${renderCreateDrawer()}
      ${renderTableList(true)}
    </div>
  `;
}

function renderCreateDrawer() {
  const open = MASTER_ROOM_STATE.ui.createOpen;
  return `
    <details class="master-runtime-drawer" ${open ? "open" : ""}>
      <summary>Создание стола</summary>
      <div class="master-runtime-form-grid">
        <label>Название стола<input id="masterRuntimeCreateTitle" placeholder="Подземелье Арканума"></label>
        <label>Кампания<input id="masterRuntimeCreateCampaign" placeholder="Тени Лираэля"></label>
        <label>Сцена<input id="masterRuntimeCreateScene" placeholder="Зал древних стражей"></label>
        <label>Код<input id="masterRuntimeCreateToken" placeholder="автоматически"></label>
        <label class="span-2">Описание сцены<textarea id="masterRuntimeCreateDescription" rows="3" placeholder="Кратко: где партия, что видно, что скрыто..."></textarea></label>
      </div>
      <div class="master-runtime-actions-row">
        <button class="btn btn-primary" type="button" data-master-runtime-action="create-table">Создать стол</button>
        <button class="btn" type="button" data-master-runtime-action="toggle-create">Скрыть</button>
      </div>
    </details>
  `;
}

function renderTableList(compact = false) {
  const tables = MASTER_ROOM_STATE.tables;
  if (!tables.length) return `<div class="master-runtime-empty">Пока нет столов. Создай первый или введи код приглашения.</div>`;
  return `
    <section class="master-runtime-table-list ${compact ? "compact" : ""}">
      <div class="master-runtime-section-head">
        <div><span>Столы</span><strong>${escapeHtml(String(tables.length))}</strong></div>
      </div>
      <div class="master-runtime-table-list-grid">
        ${tables.map((table) => `
          <button class="master-runtime-table-card ${String(table.id) === String(MASTER_ROOM_STATE.activeTableId) ? "active" : ""}" type="button" data-master-runtime-table="${escapeHtml(table.id)}">
            <span>${escapeHtml(table.title)}</span>
            <small>${escapeHtml(table.scene || "Сцена")}</small>
            <em>${escapeHtml(safeArray(table.members).length)} участников</em>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function renderRightRail(table, canManage) {
  const combat = normalizeCombat(table?.combat, table);
  const events = safeArray(table?.events).slice(0, 5);
  return `
    <aside class="master-runtime-rail">
      <section class="master-runtime-panel">
        <div class="master-runtime-panel-head"><span>Журнал событий</span><small>${escapeHtml(String(safeArray(table?.events).length))}</small></div>
        <div class="master-runtime-event-list compact">
          ${events.length ? events.map(renderEventRow).join("") : `<div class="master-runtime-muted">Событий пока нет.</div>`}
        </div>
        <button class="btn" type="button" data-master-runtime-tab-shortcut="journal">Открыть полный журнал</button>
      </section>
      <section class="master-runtime-panel master-runtime-quick-panel ${MASTER_ROOM_STATE.ui.quickActionsOpen ? "open" : ""}">
        <div class="master-runtime-panel-head"><span>Быстрые действия</span><small>${canManage ? "GM" : "player"}</small></div>
        <div class="master-runtime-quick-grid">
          ${canManage ? `
            <button class="btn" type="button" data-master-runtime-action="open-combat">Инициатива</button>
            <button class="btn" type="button" data-master-runtime-action="add-enemy">Добавить врага</button>
            <button class="btn" type="button" data-master-runtime-tab-shortcut="grants">Выдать предмет</button>
            <button class="btn" type="button" data-master-runtime-action="clear-combat-log">Очистить журнал</button>
          ` : `
            <button class="btn" type="button" data-master-runtime-tab-shortcut="combat">Открыть бой</button>
            <button class="btn" type="button" data-master-runtime-tab-shortcut="party">Партия</button>
            <button class="btn" type="button" data-master-runtime-tab-shortcut="journal">Журнал</button>
          `}
        </div>
      </section>
      <section class="master-runtime-panel">
        <div class="master-runtime-panel-head"><span>Кубы</span><small>быстро</small></div>
        <div class="master-runtime-dice-grid">
          ${["d4", "d6", "d8", "d10", "d12", "d20", "d100"].map((die) => `
            <button class="btn" type="button" data-master-runtime-roll-die="${die}">${die.toUpperCase()}</button>
          `).join("")}
        </div>
        <div class="master-runtime-last-roll">
          ${combat.last_roll ? `<strong>${escapeHtml(String(combat.last_roll.total))}</strong><span>${escapeHtml(combat.last_roll.dice || "")}</span>` : `<span>Последний бросок появится здесь.</span>`}
        </div>
      </section>
    </aside>
  `;
}

function renderEventRow(event) {
  return `
    <button class="master-runtime-event-row" type="button" data-master-runtime-event="${escapeHtml(event.id)}">
      <span class="master-runtime-event-icon">${eventIcon(event.type)}</span>
      <span><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(clampText(event.description || event.actor, 62))}</small></span>
      <time>${escapeHtml(formatTime(event.created_at))}</time>
    </button>
  `;
}

function eventIcon(type) {
  const map = { combat: "⚔", roll: "◇", damage: "🔥", heal: "✚", grant: "✦", table: "♛", access: "▣", system: "◉" };
  return map[type] || "•";
}

function renderTableOverview(table, canManage) {
  const members = safeArray(table.members);
  return `
    <div class="master-runtime-stage master-runtime-stage-table">
      <section class="master-runtime-panel master-runtime-scene-card">
        <div class="master-runtime-panel-head"><span>Текущий стол</span>${canManage ? `<button class="btn" type="button" data-master-runtime-action="save-scene">Сохранить сцену</button>` : ""}</div>
        <div class="master-runtime-scene-grid">
          <div class="master-runtime-scene-image"><span>✦</span></div>
          <div class="master-runtime-scene-copy">
            <label>Название<input id="masterRuntimeSceneTitle" value="${escapeHtml(table.title)}" ${canManage ? "" : "disabled"}></label>
            <label>Активная сцена<input id="masterRuntimeSceneName" value="${escapeHtml(table.scene)}" ${canManage ? "" : "disabled"}></label>
            <label>Описание<textarea id="masterRuntimeSceneDescription" rows="4" ${canManage ? "" : "disabled"}>${escapeHtml(table.scene_description || "")}</textarea></label>
          </div>
        </div>
      </section>
      <section class="master-runtime-panel">
        <div class="master-runtime-panel-head"><span>Обзор стола</span><small>${escapeHtml(table.token)}</small></div>
        <div class="master-runtime-overview-grid">
          ${renderMetric("Игроки", members.length, "⚜")}
          ${renderMetric("Онлайн", members.filter((m) => m.online).length, "●")}
          ${renderMetric("Доступы", Object.keys(table.access || {}).length, "▣")}
          ${renderMetric("Торговцы", safeArray(table.traders).length, "◍")}
          ${renderMetric("Выдачи", safeArray(table.grants).length, "✦")}
          ${renderMetric("События", safeArray(table.events).length, "☷")}
        </div>
      </section>
      ${renderPlayerLayerPreview(table, canManage)}
      ${renderTableList()}
    </div>
  `;
}

function renderPlayerLayerPreview(table, canManage) {
  const members = safeArray(table.members).slice(0, 5);
  return `
    <section class="master-runtime-panel master-runtime-player-layer">
      <div class="master-runtime-panel-head"><span>Player Layer Preview</span><small>что видят игроки</small></div>
      <div class="master-runtime-player-layer-grid">
        <div>
          <strong>Сцена</strong>
          <p>${escapeHtml(table.scene || "Сцена не выбрана")}</p>
          <small>${escapeHtml(clampText(table.scene_description || "Описание сцены скрыто или не заполнено.", 120))}</small>
        </div>
        <div>
          <strong>Партия</strong>
          <div class="master-runtime-mini-roster">${members.map((m) => `<span>${renderAvatar(m.portrait_url, m.nickname, "master-runtime-mini-avatar")} ${escapeHtml(m.selected_character_name || m.nickname)}</span>`).join("")}</div>
        </div>
        <div>
          <strong>Открытая информация</strong>
          <ul>
            <li>Сцена: ${escapeHtml(accessLabel(table.access.scene))}</li>
            <li>Карта: ${escapeHtml(accessLabel(table.access.map))}</li>
            <li>Журнал: ${escapeHtml(accessLabel(table.access.journal))}</li>
          </ul>
        </div>
      </div>
    </section>
  `;
}

function accessLabel(value) {
  const map = { public: "открыто", party: "по сцене", hidden: "скрыто", gm: "только GM" };
  return map[value] || value || "—";
}

function renderPartyStage(table, canManage) {
  const members = safeArray(table.members);
  return `
    <div class="master-runtime-stage master-runtime-stage-party">
      <section class="master-runtime-panel master-runtime-party-grid-panel">
        <div class="master-runtime-panel-head">
          <span>Текущая партия</span>
          ${canManage ? `<button class="btn" type="button" data-master-runtime-action="add-current-user">Добавить себя/LSS</button>` : ""}
        </div>
        <div class="master-runtime-party-grid">
          ${members.length ? members.map((member) => renderMemberCard(member, canManage)).join("") : `<div class="master-runtime-empty">В партии пока никого нет.</div>`}
          ${canManage ? `<button class="master-runtime-invite-slot" type="button" data-master-runtime-action="add-manual-member">＋<span>Пригласить игрока</span></button>` : ""}
        </div>
      </section>
      ${renderSelectedMemberPanel(table, canManage)}
    </div>
  `;
}

function renderMemberCard(member, canManage) {
  return `
    <article class="master-runtime-member-card ${String(member.id) === String(MASTER_ROOM_STATE.ui.selectedMemberId) ? "active" : ""}">
      <button type="button" data-master-runtime-select-member="${escapeHtml(member.id)}">
        <div class="master-runtime-member-avatar">${renderAvatar(member.portrait_url, member.nickname, "master-runtime-member-avatar")}</div>
        <div class="master-runtime-member-copy">
          <strong>${escapeHtml(member.selected_character_name || member.nickname)}</strong>
          <span>${escapeHtml(member.class_name)} ${escapeHtml(member.level)} ур.</span>
          <small>${member.online ? "● онлайн" : "○ офлайн"}</small>
        </div>
        <div class="master-runtime-member-level">${escapeHtml(String(member.level || 1))}</div>
      </button>
      <div class="master-runtime-bars">
        <span><em style="width:${hpPercent(member)}%"></em></span>
        <small>HP ${escapeHtml(String(member.hp_current))} / ${escapeHtml(String(member.hp_max))}</small>
      </div>
      ${canManage ? `<button class="btn" type="button" data-master-runtime-action="sync-member-lss" data-member-id="${escapeHtml(member.id)}">Связать LSS</button>` : ""}
    </article>
  `;
}

function renderSelectedMemberPanel(table, canManage) {
  const selected = safeArray(table.members).find((m) => String(m.id) === String(MASTER_ROOM_STATE.ui.selectedMemberId)) || safeArray(table.members)[0];
  if (!selected) return `<section class="master-runtime-panel"><div class="master-runtime-empty">Выбери участника.</div></section>`;
  return `
    <section class="master-runtime-panel master-runtime-selected-member">
      <div class="master-runtime-panel-head"><span>Выбранный участник</span><small>${escapeHtml(selected.role)}</small></div>
      <div class="master-runtime-selected-layout">
        <div class="master-runtime-selected-portrait">${renderAvatar(selected.portrait_url, selected.nickname, "master-runtime-selected-portrait")}</div>
        <div>
          <h3>${escapeHtml(selected.selected_character_name || selected.nickname)}</h3>
          <p>${escapeHtml(selected.race)} • ${escapeHtml(selected.class_name)} • ${escapeHtml(String(selected.level))} ур.</p>
          <div class="master-runtime-stat-line"><span>КД ${escapeHtml(String(selected.ac))}</span><span>Иниц. ${escapeHtml(String(selected.initiative))}</span><span>HP ${escapeHtml(String(selected.hp_current))}/${escapeHtml(String(selected.hp_max))}</span></div>
        </div>
      </div>
      <details class="master-runtime-drawer"><summary>Видимость для игроков</summary>${renderVisibilityEditor(selected, canManage)}</details>
      ${canManage ? `<button class="btn btn-danger" type="button" data-master-runtime-remove-member="${escapeHtml(selected.id)}">Удалить из стола</button>` : ""}
    </section>
  `;
}

function renderVisibilityEditor(member, canManage) {
  const fields = [
    ["sheet", "Лист"], ["inventory", "Инвентарь"], ["stats", "Статы"], ["biography", "Биография"], ["notes", "Заметки"], ["combat", "Бой"],
  ];
  return `
    <div class="master-runtime-access-grid">
      ${fields.map(([key, label]) => `
        <label>${escapeHtml(label)}
          <select data-master-runtime-member-visibility="${escapeHtml(member.id)}" data-visibility-key="${escapeHtml(key)}" ${canManage ? "" : "disabled"}>
            ${["party", "hidden", "public", "gm"].map((value) => `<option value="${value}" ${member.visibility?.[key] === value ? "selected" : ""}>${escapeHtml(accessLabel(value))}</option>`).join("")}
          </select>
        </label>
      `).join("")}
    </div>
  `;
}

function renderCharactersStage(table, canManage) {
  return `
    <div class="master-runtime-stage master-runtime-stage-characters">
      ${renderPartyStage(table, canManage)}
    </div>
  `;
}

function renderAccessStage(table, canManage) {
  const fields = [
    ["scene", "Описание сцены"], ["map", "Карты и маркеры"], ["quests", "Задания"], ["notes", "Заметки"], ["inventory", "Инвентарь"], ["combat", "Бой"], ["journal", "Журнал"], ["traders", "Торговцы"], ["bestiary", "Бестиарий"],
  ];
  return `
    <div class="master-runtime-stage master-runtime-stage-access">
      <section class="master-runtime-panel">
        <div class="master-runtime-panel-head"><span>Матрица видимости</span><small>${canManage ? "редактирование" : "просмотр"}</small></div>
        <div class="master-runtime-access-grid large">
          ${fields.map(([key, label]) => `
            <label>${escapeHtml(label)}
              <select data-master-runtime-access="${escapeHtml(key)}" ${canManage ? "" : "disabled"}>
                ${["party", "hidden", "public", "gm"].map((value) => `<option value="${value}" ${table.access?.[key] === value ? "selected" : ""}>${escapeHtml(accessLabel(value))}</option>`).join("")}
              </select>
            </label>
          `).join("")}
        </div>
      </section>
      <aside class="master-runtime-panel">
        <div class="master-runtime-panel-head"><span>Правило</span><small>GM layer</small></div>
        <p>Мастер видит всё. Игроки видят только то, что открыто настройками стола и личной видимостью персонажа.</p>
        ${canManage ? `<button class="btn btn-primary" type="button" data-master-runtime-action="save-access">Сохранить доступы</button>` : ""}
      </aside>
    </div>
  `;
}

function renderTradersStage(table, canManage) {
  const knownTraders = getKnownTraders();
  const linkedIds = new Set(safeArray(table.traders).map((trader) => String(trader.source_id || trader.id)));
  const available = knownTraders.filter((trader) => !linkedIds.has(String(trader.source_id || trader.id)));
  return `
    <div class="master-runtime-stage master-runtime-stage-traders master-runtime-stage-traders-round32">
      <section class="master-runtime-panel master-runtime-data-panel">
        <div class="master-runtime-panel-head"><span>Торговцы текущего списка</span><small>${escapeHtml(String(safeArray(table.traders).length))}</small></div>
        ${canManage ? `
          <div class="master-runtime-inline-add master-runtime-trader-add">
            <label>Из известных торговцев
              <select id="masterRuntimeTraderSelect">
                ${renderOptions(available, "", available.length ? "Выбрать торговца" : "Нет доступных торговцев")}
              </select>
            </label>
            <label>Кастомный / временный
              <input id="masterRuntimeTraderCustom" placeholder="Имя торговца, если его ещё нет в базе">
            </label>
            <button class="btn btn-primary" type="button" data-master-runtime-action="add-trader">Добавить к столу</button>
          </div>
        ` : ""}
        <div class="master-runtime-list master-runtime-trader-list">
          ${safeArray(table.traders).length ? safeArray(table.traders).map((trader) => `
            <article class="master-runtime-list-row master-runtime-trader-row">
              <span>${renderAvatar(trader.portrait_url, trader.name, "master-runtime-row-avatar")}</span>
              <div><strong>${escapeHtml(displayName(trader.name))}</strong><small>${escapeHtml(displayText(trader.type, "Торговец"))} • ${escapeHtml(displayText(trader.scene || table.scene, "сцена не назначена"))}</small></div>
              <em>${escapeHtml(trader.status === "open" ? "Открыт" : "Скрыт")}</em>
              ${canManage ? `<button class="btn" type="button" data-master-runtime-remove-trader="${escapeHtml(trader.id)}">Убрать</button>` : ""}
            </article>
          `).join("") : `<div class="master-runtime-empty">Торговцы пока не привязаны к столу. Добавь их из текущего списка торговцев проекта.</div>`}
        </div>
      </section>
      <aside class="master-runtime-panel master-runtime-helper-panel">
        <div class="master-runtime-panel-head"><span>Логика</span><small>не поле руками</small></div>
        <p>Торговцы берутся из уже загруженного списка проекта. Кастомное поле нужно только для временного NPC, которого ещё нет в базе.</p>
        <button class="btn" type="button" data-master-runtime-tab-shortcut="journal">Открыть журнал событий</button>
      </aside>
    </div>
  `;
}

function renderGrantsStage(table, canManage) {
  const inventoryItems = getKnownInventoryItems();
  return `
    <div class="master-runtime-stage master-runtime-stage-grants master-runtime-stage-grants-round32">
      <section class="master-runtime-panel master-runtime-grant-panel">
        <div class="master-runtime-panel-head"><span>Выдача предметов</span><small>${canManage ? "GM" : "только просмотр"}</small></div>
        ${canManage ? `
          <div class="master-runtime-form-grid master-runtime-grant-grid">
            <label>Игрок<select id="masterRuntimeGrantTarget">${safeArray(table.members).map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(displayName(member.selected_character_name || member.nickname))}</option>`).join("")}</select></label>
            <label>Предмет из инвентаря
              <select id="masterRuntimeGrantKnownItem">
                ${renderOptions(inventoryItems, "", inventoryItems.length ? "Выбрать известный предмет" : "Инвентарь пуст")}
              </select>
            </label>
            <label>Кастомный предмет<input id="masterRuntimeGrantItem" placeholder="Например: Ключ от подземелья"></label>
            <label>Кол-во<input id="masterRuntimeGrantQty" type="number" min="1" value="1"></label>
            <label>Золото<input id="masterRuntimeGrantGold" type="number" min="0" value="0"></label>
            <label class="span-2">Причина<input id="masterRuntimeGrantReason" placeholder="Награда за квест / находка / GM выдача"></label>
          </div>
          <div class="master-runtime-actions-row">
            <button class="btn" type="button" data-master-runtime-action="create-custom-grant-item">＋ Создать кастомный предмет</button>
            <button class="btn btn-primary" type="button" data-master-runtime-action="grant-reward">Выдать</button>
          </div>
        ` : `<p>Выдачи управляются мастером.</p>`}
      </section>
      <section class="master-runtime-panel master-runtime-grant-log-panel">
        <div class="master-runtime-panel-head"><span>Последние выдачи</span><small>${escapeHtml(String(safeArray(table.grants).length))}</small></div>
        <div class="master-runtime-list">${safeArray(table.grants).length ? safeArray(table.grants).slice(0, 10).map((grant) => `<div class="master-runtime-list-row"><span>✦</span><div><strong>${escapeHtml(displayText(grant.item_name || `${grant.gold} золота`, "Награда"))}</strong><small>${escapeHtml(displayText(grant.target_name, "участник"))} • ${escapeHtml(displayText(grant.reason, "без причины"))}</small></div><time>${escapeHtml(formatTime(grant.created_at))}</time></div>`).join("") : `<div class="master-runtime-empty">Выдач пока нет.</div>`}</div>
      </section>
    </div>
  `;
}

function renderCombatStage(table, canManage) {
  const combat = normalizeCombat(table.combat, table);
  const monsters = getKnownMonsterEntries();
  table.combat = combat;
  return `
    <div class="master-runtime-stage master-runtime-stage-combat master-runtime-stage-combat-round32">
      <section class="master-runtime-combat-host master-runtime-combat-host-round32">
        ${renderCombatModule({
          table,
          combat,
          canManage,
          tableTitle: table.title,
          logFilter: "all",
          hideSecondary: false,
          diceType: "d20",
          environment: combat.environment,
        })}
      </section>
      ${canManage ? `
        <aside class="master-runtime-panel master-runtime-combat-setup master-runtime-combat-setup-round32">
          <div class="master-runtime-panel-head"><span>Подготовка боя</span><small>GM</small></div>
          <div class="master-runtime-combat-setup-grid">
            <button class="btn btn-primary" type="button" data-master-runtime-action="start-combat">Собрать инициативу из LSS</button>
            <label>Монстр из Бестиария
              <select id="masterRuntimeEnemySelect">
                ${renderOptions(monsters, "", monsters.length ? "Выбрать монстра" : "Бестиарий пуст")}
              </select>
            </label>
            <button class="btn" type="button" data-master-runtime-action="add-selected-enemy">Добавить из Бестиария</button>
            <button class="btn" type="button" data-master-runtime-action="open-bestiary">Открыть Бестиарий</button>
            <button class="btn" type="button" data-master-runtime-action="add-enemy">Добавить вручную</button>
            <button class="btn" type="button" data-master-runtime-action="clear-combat-log">Очистить лог</button>
          </div>
        </aside>
      ` : ""}
    </div>
  `;
}

function renderJournalStage(table) {
  const events = safeArray(table.events);
  return `
    <div class="master-runtime-stage master-runtime-stage-journal">
      <section class="master-runtime-panel">
        <div class="master-runtime-panel-head"><span>Журнал стола</span><small>${escapeHtml(String(events.length))}</small></div>
        <div class="master-runtime-event-list large">
          ${events.length ? events.map(renderEventRow).join("") : `<div class="master-runtime-empty">Журнал пока пуст.</div>`}
        </div>
      </section>
      <aside class="master-runtime-panel">
        <div class="master-runtime-panel-head"><span>Детали события</span></div>
        ${renderSelectedEvent(table)}
      </aside>
    </div>
  `;
}

function renderSelectedEvent(table) {
  const event = safeArray(table.events).find((item) => String(item.id) === String(MASTER_ROOM_STATE.ui.selectedEventId)) || safeArray(table.events)[0];
  if (!event) return `<p class="master-runtime-muted">Выбери событие в журнале.</p>`;
  return `<h3>${escapeHtml(event.title)}</h3><p>${escapeHtml(event.description || "Без подробностей")}</p><small>${escapeHtml(formatDateTime(event.created_at))} • ${escapeHtml(event.actor)}</small>`;
}

function renderActiveStage(table, canManage) {
  if (!table) return renderLobby();
  if (MASTER_ROOM_STATE.activeTab === "party") return renderPartyStage(table, canManage);
  if (MASTER_ROOM_STATE.activeTab === "characters") return renderCharactersStage(table, canManage);
  if (MASTER_ROOM_STATE.activeTab === "access") return renderAccessStage(table, canManage);
  if (MASTER_ROOM_STATE.activeTab === "traders") return renderTradersStage(table, canManage);
  if (MASTER_ROOM_STATE.activeTab === "grants") return renderGrantsStage(table, canManage);
  if (MASTER_ROOM_STATE.activeTab === "combat") return renderCombatStage(table, canManage);
  if (MASTER_ROOM_STATE.activeTab === "journal") return renderJournalStage(table);
  return renderTableOverview(table, canManage);
}

export async function loadMasterRoom() {
  MASTER_ROOM_STATE.role = getCurrentRole();
  const ui = readUiState();
  MASTER_ROOM_STATE.activeTab = ui.activeTab || MASTER_ROOM_STATE.activeTab || "table";
  MASTER_ROOM_STATE.activeTableId = ui.activeTableId || MASTER_ROOM_STATE.activeTableId;
  MASTER_ROOM_STATE.ui.quickActionsOpen = Boolean(ui.quickActionsOpen);

  let data = null;
  let source = "local";

  // Не пробуем несуществующие URL. Если backend-sync включат позже — достаточно одного
  // реального GET /gm/master-room, без каскада 404/405 в DevTools.
  if (MASTER_ROOM_API_SYNC_ENABLED) {
    data = await apiGet("/gm/master-room");
    source = data ? "api" : "local";
  }

  if (!data) {
    data = loadLocal();
    source = "local";
  }

  const tables = Array.isArray(data) ? data : safeArray(data?.tables);
  MASTER_ROOM_STATE.tables = tables.map(normalizeTable);
  MASTER_ROOM_STATE.loaded = true;
  MASTER_ROOM_STATE.source = MASTER_ROOM_STATE.tables.length ? source : "empty";

  if (!MASTER_ROOM_STATE.activeTableId || !MASTER_ROOM_STATE.tables.some((table) => String(table.id) === String(MASTER_ROOM_STATE.activeTableId))) {
    MASTER_ROOM_STATE.activeTableId = MASTER_ROOM_STATE.tables[0]?.id || null;
  }

  return MASTER_ROOM_STATE.tables;
}

export async function saveMasterRoom() {
  return persistMasterRoom();
}

export function getMasterRoomData() {
  return {
    tables: MASTER_ROOM_STATE.tables,
    activeTableId: MASTER_ROOM_STATE.activeTableId,
    activeTab: MASTER_ROOM_STATE.activeTab,
    source: MASTER_ROOM_STATE.source,
  };
}

export function setMasterRoomData(payload = {}) {
  MASTER_ROOM_STATE.tables = safeArray(payload.tables).map(normalizeTable);
  MASTER_ROOM_STATE.activeTableId = payload.activeTableId || MASTER_ROOM_STATE.tables[0]?.id || null;
  MASTER_ROOM_STATE.activeTab = payload.activeTab || MASTER_ROOM_STATE.activeTab || "table";
  MASTER_ROOM_STATE.loaded = true;
  MASTER_ROOM_STATE.source = payload.source || "manual";
  renderMasterRoom();
}

export function clearMasterRoomData() {
  MASTER_ROOM_STATE.tables = [];
  MASTER_ROOM_STATE.activeTableId = null;
  MASTER_ROOM_STATE.loaded = true;
  MASTER_ROOM_STATE.source = "empty";
  saveLocal();
  renderMasterRoom();
}

export async function createMasterTable(payload = {}) {
  const currentUser = getCurrentUser();
  const table = normalizeTable({
    id: makeId("table"),
    title: payload.title || "Новый стол",
    token: payload.token || makeToken(),
    campaign: payload.campaign || "Кампания",
    scene: payload.scene || "Стартовая сцена",
    scene_description: payload.scene_description || payload.description || "",
    owner_user_id: currentUser?.id || currentUser?.email || "owner",
    owner_label: currentUser?.nickname || currentUser?.email || "GM",
    members: [memberFromCurrentUser()],
    events: [{ type: "table", title: "Создан стол", description: payload.title || "Новый стол", actor: currentUser?.nickname || "GM" }],
  });
  MASTER_ROOM_STATE.tables = [table, ...MASTER_ROOM_STATE.tables];
  MASTER_ROOM_STATE.activeTableId = table.id;
  MASTER_ROOM_STATE.activeTab = "table";
  emitMasterEvent({ type: "table", title: "Создан стол", description: table.title, actor: table.owner_label });
  await persistMasterRoom();
  renderMasterRoom();
  return table;
}

export async function deleteMasterTable(tableId) {
  MASTER_ROOM_STATE.tables = MASTER_ROOM_STATE.tables.filter((table) => String(table.id) !== String(tableId));
  MASTER_ROOM_STATE.activeTableId = MASTER_ROOM_STATE.tables[0]?.id || null;
  await persistMasterRoom();
  renderMasterRoom();
}

export function selectMasterTable(tableId) {
  MASTER_ROOM_STATE.activeTableId = tableId;
  writeUiState();
  renderMasterRoom();
}

export function renderMasterRoom() {
  const container = getSection("cabinet-masterroom");
  if (!container) return;

  if (!MASTER_ROOM_STATE.loaded) {
    container.innerHTML = `<div class="master-runtime-shell"><div class="master-runtime-empty">Master Room загружается...</div></div>`;
    return;
  }

  const activeTable = getActiveTable();
  if (activeTable) ensureCurrentUserInTable(activeTable);
  const canManage = canManageTable(activeTable);

  container.innerHTML = `
    <div class="master-runtime-shell" data-master-runtime="${MASTER_ROOM_VERSION}" data-master-stage="${escapeHtml(MASTER_ROOM_STATE.activeTab)}">
      ${activeTable ? renderShellHeader(activeTable, canManage) : ""}
      ${activeTable ? renderTableTabs() : ""}
      <div class="master-runtime-layout ${activeTable ? "" : "no-table"}">
        <main class="master-runtime-main">
          ${renderActiveStage(activeTable, canManage)}
        </main>
        ${activeTable ? renderRightRail(activeTable, canManage) : ""}
      </div>
    </div>
  `;

  bindMasterRoomActions();
  bindCombatIfNeeded(activeTable, canManage);
}

function bindCombatIfNeeded(table, canManage) {
  if (!table || MASTER_ROOM_STATE.activeTab !== "combat") return;
  const root = getSection("cabinet-masterroom")?.querySelector(".combat-ref");
  bindCombatModule(root, {
    onNextTurn: async () => advanceTurn(table),
    onFocusTurn: async ({ turnIndex }) => setTurn(table, turnIndex),
    onRoll: async (payload) => addCombatRoll(table, payload),
    onDamage: async ({ entryId, delta }) => patchCombatHp(table, entryId, -Math.abs(safeNumber(delta, 0)), "damage"),
    onHeal: async ({ entryId, delta }) => patchCombatHp(table, entryId, Math.abs(safeNumber(delta, 0)), "heal"),
    onSaveCombatant: async ({ entryId, patch }) => patchCombatEntry(table, entryId, patch),
    onRemoveEntry: async ({ entryId }) => removeCombatEntry(table, entryId),
    onLogFilter: () => {},
    onToggleSecondary: () => {},
  });
}

async function advanceTurn(table) {
  table.combat = normalizeCombat(table.combat, table);
  const count = table.combat.entries.length || 1;
  table.combat.turn_index += 1;
  if (table.combat.turn_index >= count) {
    table.combat.turn_index = 0;
    table.combat.round += 1;
    emitMasterEvent({ type: "combat", title: "Новый раунд", description: `Раунд ${table.combat.round}`, combat_type: "round" });
  } else {
    const current = table.combat.entries[table.combat.turn_index];
    emitMasterEvent({ type: "combat", title: "Следующий ход", description: current?.name || "", combat_type: "turn" });
  }
  await persistMasterRoom();
  renderMasterRoom();
}

async function setTurn(table, turnIndex) {
  table.combat = normalizeCombat(table.combat, table);
  table.combat.turn_index = Math.max(0, Math.min(safeArray(table.combat.entries).length - 1, safeNumber(turnIndex, 0)));
  await persistMasterRoom();
  renderMasterRoom();
}

async function addCombatRoll(table, payload = {}) {
  table.combat = normalizeCombat(table.combat, table);
  const result = parseDice(payload.dice || "d20");
  const current = table.combat.entries[table.combat.turn_index] || {};
  const target = table.combat.entries.find((entry) => entry.entry_id !== current.entry_id) || {};
  const lastRoll = {
    ...result,
    actor_name: current.name || "Участник",
    target_name: payload.target_name || target.name || "",
    reason: payload.reason || "Бросок",
    event_type: payload.event_type || "roll",
    created_at: new Date().toISOString(),
  };
  table.combat.last_roll = lastRoll;
  table.combat.log = [{
    id: makeId("log"),
    event_type: lastRoll.event_type,
    actor_name: lastRoll.actor_name,
    target_name: lastRoll.target_name,
    reason: lastRoll.reason,
    dice: result.dice,
    total: result.total,
    summary: `${result.rolls.join(" + ")}${result.modifier ? ` ${result.modifier > 0 ? "+" : "-"} ${Math.abs(result.modifier)}` : ""} = ${result.total}`,
    scope: payload.scope || "public",
    created_at: lastRoll.created_at,
  }, ...safeArray(table.combat.log)].slice(0, 120);
  emitMasterEvent({ type: "roll", title: lastRoll.reason, description: `${lastRoll.actor_name}: ${result.total}`, total: result.total, dice: result.dice, combat_type: lastRoll.event_type });
  await persistMasterRoom();
  renderMasterRoom();
}

async function patchCombatHp(table, entryId, delta, type = "damage") {
  table.combat = normalizeCombat(table.combat, table);
  const entry = table.combat.entries.find((item) => String(item.entry_id) === String(entryId));
  if (!entry) return;
  entry.hp_current = Math.max(0, Math.min(entry.hp_max, safeNumber(entry.hp_current, 0) + delta));
  emitMasterEvent({ type, title: type === "heal" ? "Лечение" : "Урон", description: `${entry.name}: ${Math.abs(delta)} (${entry.hp_current}/${entry.hp_max})`, target_name: entry.name, combat_type: type });
  await persistMasterRoom();
  renderMasterRoom();
}

async function patchCombatEntry(table, entryId, patch = {}) {
  table.combat = normalizeCombat(table.combat, table);
  const entry = table.combat.entries.find((item) => String(item.entry_id) === String(entryId));
  if (!entry) return;
  Object.assign(entry, {
    name: safeText(patch.name, entry.name),
    hp_current: safeNumber(patch.hp_current, entry.hp_current),
    hp_max: safeNumber(patch.hp_max, entry.hp_max),
    ac: safeNumber(patch.ac, entry.ac),
    initiative: safeNumber(patch.initiative, entry.initiative),
    status: safeText(patch.status, entry.status),
  });
  await persistMasterRoom();
  renderMasterRoom();
}

async function removeCombatEntry(table, entryId) {
  table.combat = normalizeCombat(table.combat, table);
  table.combat.entries = table.combat.entries.filter((entry) => String(entry.entry_id) !== String(entryId));
  await persistMasterRoom();
  renderMasterRoom();
}

async function addEnemy(table) {
  table.combat = normalizeCombat(table.combat, table);
  const name = prompt("Имя врага", "Гоблин-разведчик");
  if (!name) return;
  table.combat.entries.push({
    entry_id: makeId("enemy"),
    type: "enemy",
    name: trimText(name),
    initiative: rollDie(20),
    hp_current: 18,
    hp_max: 18,
    ac: 14,
    speed: 30,
    status: "",
    conditions: [],
  });
  table.combat.active = true;
  emitMasterEvent({ type: "combat", title: "Добавлен враг", description: name, combat_type: "spawn" });
  await persistMasterRoom();
  renderMasterRoom();
}

async function startCombat(table) {
  table.combat = normalizeCombat({}, table);
  table.combat.active = true;
  table.combat.entries = safeArray(table.members).map((member, index) => ({
    entry_id: `member:${member.id}`,
    membership_id: member.id,
    type: "member",
    name: member.selected_character_name || member.nickname,
    player_name: member.nickname,
    portrait_url: member.portrait_url,
    initiative: rollDie(20) + safeNumber(member.initiative, 0),
    hp_current: member.hp_current,
    hp_max: member.hp_max,
    ac: member.ac,
    speed: 30,
    status: "",
    conditions: [],
  })).sort((a, b) => safeNumber(b.initiative, 0) - safeNumber(a.initiative, 0));
  table.combat.round = 1;
  table.combat.turn_index = 0;
  emitMasterEvent({ type: "combat", title: "Бой начат", description: `${table.combat.entries.length} участников`, combat_type: "turn" });
  await persistMasterRoom();
  renderMasterRoom();
}

function bindMasterRoomActions() {
  const root = getSection("cabinet-masterroom");
  if (!root) return;

  root.querySelectorAll("[data-master-runtime-tab]").forEach((btn) => {
    if (btn.dataset.boundMasterRuntime === "1") return;
    btn.dataset.boundMasterRuntime = "1";
    btn.addEventListener("click", () => {
      MASTER_ROOM_STATE.activeTab = btn.dataset.masterRuntimeTab || "table";
      writeUiState();
      renderMasterRoom();
    });
  });

  root.querySelectorAll("[data-master-runtime-tab-shortcut]").forEach((btn) => {
    if (btn.dataset.boundMasterShortcut === "1") return;
    btn.dataset.boundMasterShortcut = "1";
    btn.addEventListener("click", () => {
      MASTER_ROOM_STATE.activeTab = btn.dataset.masterRuntimeTabShortcut || "table";
      writeUiState();
      renderMasterRoom();
    });
  });

  root.querySelectorAll("[data-master-runtime-table]").forEach((btn) => {
    if (btn.dataset.boundMasterTable === "1") return;
    btn.dataset.boundMasterTable = "1";
    btn.addEventListener("click", () => selectMasterTable(btn.dataset.masterRuntimeTable || ""));
  });

  root.querySelectorAll("[data-master-runtime-event]").forEach((btn) => {
    if (btn.dataset.boundMasterEvent === "1") return;
    btn.dataset.boundMasterEvent = "1";
    btn.addEventListener("click", () => {
      MASTER_ROOM_STATE.ui.selectedEventId = btn.dataset.masterRuntimeEvent || "";
      MASTER_ROOM_STATE.activeTab = "journal";
      renderMasterRoom();
    });
  });

  root.querySelectorAll("[data-master-runtime-select-member]").forEach((btn) => {
    if (btn.dataset.boundMasterMember === "1") return;
    btn.dataset.boundMasterMember = "1";
    btn.addEventListener("click", () => {
      MASTER_ROOM_STATE.ui.selectedMemberId = btn.dataset.masterRuntimeSelectMember || "";
      renderMasterRoom();
    });
  });

  root.querySelectorAll("[data-master-runtime-roll-die]").forEach((btn) => {
    if (btn.dataset.boundMasterDie === "1") return;
    btn.dataset.boundMasterDie = "1";
    btn.addEventListener("click", async () => {
      const table = getActiveTable();
      if (!table) return;
      await addCombatRoll(table, { dice: btn.dataset.masterRuntimeRollDie || "d20", reason: "Быстрый бросок" });
    });
  });

  root.querySelectorAll("[data-master-runtime-member-visibility]").forEach((select) => {
    if (select.dataset.boundVisibility === "1") return;
    select.dataset.boundVisibility = "1";
    select.addEventListener("change", async () => {
      const table = getActiveTable();
      const member = safeArray(table?.members).find((item) => String(item.id) === String(select.dataset.masterRuntimeMemberVisibility));
      if (!member) return;
      member.visibility = { ...DEFAULT_VISIBILITY, ...(member.visibility || {}) };
      member.visibility[select.dataset.visibilityKey || "sheet"] = select.value;
      await persistMasterRoom();
    });
  });

  root.querySelectorAll("[data-master-runtime-access]").forEach((select) => {
    if (select.dataset.boundAccess === "1") return;
    select.dataset.boundAccess = "1";
    select.addEventListener("change", async () => {
      const table = getActiveTable();
      if (!table) return;
      table.access[select.dataset.masterRuntimeAccess || "scene"] = select.value;
      await persistMasterRoom();
    });
  });

  root.querySelectorAll("[data-master-runtime-remove-member]").forEach((btn) => {
    if (btn.dataset.boundRemoveMember === "1") return;
    btn.dataset.boundRemoveMember = "1";
    btn.addEventListener("click", async () => {
      const table = getActiveTable();
      if (!table) return;
      table.members = safeArray(table.members).filter((member) => String(member.id) !== String(btn.dataset.masterRuntimeRemoveMember));
      await persistMasterRoom();
      renderMasterRoom();
    });
  });

  root.querySelectorAll("[data-master-runtime-remove-trader]").forEach((btn) => {
    if (btn.dataset.boundRemoveTrader === "1") return;
    btn.dataset.boundRemoveTrader = "1";
    btn.addEventListener("click", async () => {
      const table = getActiveTable();
      if (!table) return;
      table.traders = safeArray(table.traders).filter((trader) => String(trader.id) !== String(btn.dataset.masterRuntimeRemoveTrader));
      await persistMasterRoom();
      renderMasterRoom();
    });
  });

  root.querySelectorAll("[data-master-runtime-action]").forEach((btn) => {
    if (btn.dataset.boundMasterAction === "1") return;
    btn.dataset.boundMasterAction = "1";
    btn.addEventListener("click", async () => {
      const action = btn.dataset.masterRuntimeAction || "";
      const table = getActiveTable();
      if (action === "exit-to-cabinet") {
        switchToCabinetTab("myaccount");
        return;
      }
      if (action === "exit-to-dashboard") {
        MASTER_ROOM_STATE.activeTab = "table";
        writeUiState();
        renderMasterRoom();
        return;
      }
      if (action === "toggle-create") {
        MASTER_ROOM_STATE.ui.createOpen = !MASTER_ROOM_STATE.ui.createOpen;
        renderMasterRoom();
      }
      if (action === "toggle-quick-actions") {
        MASTER_ROOM_STATE.ui.quickActionsOpen = !MASTER_ROOM_STATE.ui.quickActionsOpen;
        writeUiState();
        renderMasterRoom();
      }
      if (action === "quick-create-table") {
        await createMasterTable({ title: "Новый стол", campaign: "Кампания", scene: "Стартовая сцена" });
      }
      if (action === "create-table") {
        await createMasterTable({
          title: trimText(root.querySelector("#masterRuntimeCreateTitle")?.value || ""),
          campaign: trimText(root.querySelector("#masterRuntimeCreateCampaign")?.value || ""),
          scene: trimText(root.querySelector("#masterRuntimeCreateScene")?.value || ""),
          token: trimText(root.querySelector("#masterRuntimeCreateToken")?.value || ""),
          scene_description: trimText(root.querySelector("#masterRuntimeCreateDescription")?.value || ""),
        });
      }
      if (action === "join-table") {
        const token = trimText(root.querySelector("#masterRuntimeJoinToken")?.value || MASTER_ROOM_STATE.joinToken || "").toUpperCase();
        if (!token) return showToast("Введи код стола");
        let found = MASTER_ROOM_STATE.tables.find((item) => String(item.token).toUpperCase() === token);
        if (!found) {
          found = normalizeTable({ title: `Стол ${token}`, token, members: [memberFromCurrentUser()] });
          MASTER_ROOM_STATE.tables.unshift(found);
        } else {
          ensureCurrentUserInTable(found);
        }
        MASTER_ROOM_STATE.activeTableId = found.id;
        await persistMasterRoom();
        renderMasterRoom();
      }
      if (action === "save-scene" && table) {
        table.title = trimText(root.querySelector("#masterRuntimeSceneTitle")?.value || table.title);
        table.scene = trimText(root.querySelector("#masterRuntimeSceneName")?.value || table.scene);
        table.scene_description = trimText(root.querySelector("#masterRuntimeSceneDescription")?.value || table.scene_description);
        table.updated_at = new Date().toISOString();
        emitMasterEvent({ type: "table", title: "Сцена обновлена", description: table.scene });
        await persistMasterRoom();
        renderMasterRoom();
      }
      if (action === "add-current-user" && table) {
        ensureCurrentUserInTable(table);
        await persistMasterRoom();
        renderMasterRoom();
      }
      if (action === "add-manual-member" && table) {
        const name = prompt("Имя игрока", "Новый игрок");
        if (!name) return;
        table.members.push(normalizeMembers([{ nickname: name, selected_character_name: name }])[0]);
        await persistMasterRoom();
        renderMasterRoom();
      }
      if (action === "sync-member-lss" && table) {
        const member = safeArray(table.members).find((item) => String(item.id) === String(btn.dataset.memberId));
        if (!member) return;
        const lss = getLssSnapshot();
        member.selected_character_name = lss.name || member.selected_character_name;
        member.portrait_url = lss.portrait_url || member.portrait_url;
        member.level = lss.level || member.level;
        member.class_name = lss.class_name || member.class_name;
        member.race = lss.race || member.race;
        member.hp_current = lss.hp_current;
        member.hp_max = lss.hp_max;
        member.ac = lss.ac;
        member.initiative = lss.initiative;
        member.sheet = lss.sheet;
        await persistMasterRoom();
        renderMasterRoom();
      }
      if (action === "add-trader" && table) {
        const knownId = root.querySelector("#masterRuntimeTraderSelect")?.value || "";
        const customName = trimText(root.querySelector("#masterRuntimeTraderCustom")?.value || "");
        const known = getKnownTraders().find((trader) => String(trader.id) === String(knownId));
        const payload = known
          ? { ...known, source_id: known.id, scene: known.scene || table.scene }
          : { name: customName, type: "Торговец", scene: table.scene };
        if (!payload.name) return showToast("Выбери торговца или введи имя временного NPC");
        table.traders.push(normalizeTraders([payload])[0]);
        emitMasterEvent({ type: "table", title: "Торговец добавлен к столу", description: payload.name });
        await persistMasterRoom();
        renderMasterRoom();
      }
      if (action === "create-custom-grant-item") {
        const input = root.querySelector("#masterRuntimeGrantItem");
        const name = prompt("Название кастомного предмета", input?.value || "Кастомный предмет");
        if (input && name) input.value = name;
        return;
      }
      if (action === "grant-reward" && table) {
        const memberId = root.querySelector("#masterRuntimeGrantTarget")?.value || "";
        const member = safeArray(table.members).find((item) => String(item.id) === String(memberId));
        const knownItemId = root.querySelector("#masterRuntimeGrantKnownItem")?.value || "";
        const knownItem = getKnownInventoryItems().find((item) => String(item.id) === String(knownItemId));
        const itemName = trimText(root.querySelector("#masterRuntimeGrantItem")?.value || "") || knownItem?.name || "";
        const qty = safeNumber(root.querySelector("#masterRuntimeGrantQty")?.value, 1);
        const gold = safeNumber(root.querySelector("#masterRuntimeGrantGold")?.value, 0);
        const reason = trimText(root.querySelector("#masterRuntimeGrantReason")?.value || "");
        if (!itemName && !gold) return showToast("Выбери предмет, создай кастомный предмет или укажи золото");
        const grant = normalizeGrants([{ target_member_id: memberId, target_name: member?.selected_character_name || member?.nickname || "", item_name: itemName, quantity: qty, gold, reason }])[0];
        table.grants = [grant, ...safeArray(table.grants)];
        emitMasterEvent({ type: "grant", title: "GM выдал награду", description: itemName || `${gold} золота`, actor: getCurrentUser()?.nickname || "GM" });
        await persistMasterRoom();
        renderMasterRoom();
      }
      if (action === "start-combat" && table) await startCombat(table);
      if (action === "open-combat" && table) {
        MASTER_ROOM_STATE.activeTab = "combat";
        await startCombat(table);
      }
      if (action === "open-bestiary") {
        switchToCabinetTab("bestiari");
        return;
      }
      if (action === "add-selected-enemy" && table) {
        const selectedId = root.querySelector("#masterRuntimeEnemySelect")?.value || "";
        const entry = getKnownMonsterEntries().find((item) => String(item.id || item.title || item.name) === String(selectedId));
        if (!entry) return showToast("Выбери монстра из Бестиария");
        table.combat = normalizeCombat(table.combat, table);
        table.combat.entries.push(bestiaryEntryToCombatEnemy(entry));
        table.combat.entries.sort((a, b) => safeNumber(b.initiative, 0) - safeNumber(a.initiative, 0));
        table.combat.active = true;
        emitMasterEvent({ type: "combat", title: "Монстр из Бестиария", description: displayText(entry.title || entry.name, "Монстр"), combat_type: "spawn" });
        await persistMasterRoom();
        renderMasterRoom();
        return;
      }
      if (action === "add-enemy" && table) await addEnemy(table);
      if (action === "clear-combat-log" && table) {
        table.combat = normalizeCombat(table.combat, table);
        table.combat.log = [];
        await persistMasterRoom();
        renderMasterRoom();
      }
      if (action === "save-access" && table) {
        emitMasterEvent({ type: "access", title: "Доступы обновлены", description: "Правила видимости сохранены" });
        await persistMasterRoom();
        showToast("Доступы сохранены");
      }
    });
  });
}

export async function initMasterRoom() {
  await loadMasterRoom();
  renderMasterRoom();
}

window.masterRoomModule = {
  loadMasterRoom,
  renderMasterRoom,
  saveMasterRoom,
  initMasterRoom,
  getMasterRoomData,
  setMasterRoomData,
  clearMasterRoomData,
  createMasterTable,
  deleteMasterTable,
  selectMasterTable,
};
