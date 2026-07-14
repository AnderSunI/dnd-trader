// Round 22: HP runtime — temporary HP, healing caps, concentration checks and serialized combat mutations.
// ============================================================
// frontend/js/master-room.js
// Active runtime module for Master Room.
// Round 51: LSS parsed-spell runtime bridge — expanded cards, live sync and spell-slot state.
// Round 50: combat stat resolver — LSS + equipment + effects -> current combat profile.
// Round 49: LSS combat profile bridge and compact/filterable table journal.
// Round 48: strict grid movement, token collision protection and debounced Bestiary search.
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

const MASTER_ROOM_VERSION = "round51-lss-spell-runtime-bridge";
const MASTER_ROOM_API_SYNC_ENABLED = false;
const MASTER_ROOM_LOBBY_ID = "__master_room_lobby__";
const MASTER_ROOM_BESTIARY_RESULT_LIMIT = 60;
const MASTER_ROOM_BESTIARY_CARD_LIMIT = 18;
let masterRoomBestiarySearchTimer = null;
let masterRoomJournalSearchTimer = null;
let masterRoomLssBridgeTimer = null;
let masterRoomLssBridgeBound = false;

// Round 47: Master Room больше не ждёт, пока модуль Бестиария сам откроют и прогреют.
// Для пула монстров у нас отдельный bridge: читаем тяжёлый seed напрямую и держим его только в памяти.
// В localStorage НЕ пишем весь файл, иначе можно убить квоту браузера.
const MASTER_ROOM_BESTIARY_BRIDGE_URLS = [
  "/static/data/bestiary_bestiari_preview.json",
  "/static/data/bestiary_normalized_round1.json",
  "/static/bestiary_bestiari_preview.json",
  "/data/bestiary_bestiari_preview.json",
];

// Round 37 design note:
// Master Room постепенно становится боевым/GM-узлом, где:
// - персонаж = LSS sheet + inventory/equipment + buffs/effects;
// - противник = Bestiary statblock + encounter overrides + items/buffs/effects.
// Этот файл пока НЕ считает всю механику предметов/бафов, а прокладывает навигацию
// и контекстные панели, чтобы позже подключить общий source-grants/equipment engine.
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
  { key: "notes", label: "Заметки", icon: "✎", hint: "игрок/GM" },
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
    diceDrawerOpen: false,
    selectedMemberId: "",
    selectedEventId: "",
    actionType: "attack",
    combatLogFilter: "all",
    combatHideSecondary: false,
    journalFilter: "all",
    journalQuery: "",
    journalActor: "all",
    journalVisibleCount: 36,
    // Round 40: выбранный монстр Бестиария для краткой сводки перед добавлением в бой.
    selectedBestiaryMonsterId: "",
    selectedCombatEntryId: "",
    selectedCombatTargetId: "",
    bestiaryMonsterSearch: "",
    bestiaryBridgeEntries: [],
    bestiaryBridgeLoaded: false,
    bestiaryBridgeLoading: false,
    bestiaryBridgeError: "",
    bestiaryBridgeSource: "",
    combatSetupOpen: false,
    selectedNoteId: "",
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
      diceDrawerOpen: MASTER_ROOM_STATE.ui.diceDrawerOpen,
      combatLogFilter: MASTER_ROOM_STATE.ui.combatLogFilter,
      combatHideSecondary: MASTER_ROOM_STATE.ui.combatHideSecondary,
      journalFilter: MASTER_ROOM_STATE.ui.journalFilter,
      journalActor: MASTER_ROOM_STATE.ui.journalActor,
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


function normalizeNotes(list = []) {
  const current = getCurrentUser();
  const fallbackAuthor = displayText(current?.nickname || current?.email, "Игрок");
  const source = Array.isArray(list)
    ? list
    : displayText(list, "")
      ? [{ text: displayText(list, ""), title: "Заметка стола", scope: "gm" }]
      : [];
  return safeArray(source).map((raw, index) => ({
    id: String(raw.id || raw.note_id || makeId(`note_${index}`)),
    title: safeText(raw.title || raw.name, index ? `Заметка ${index + 1}` : "Заметка"),
    text: safeText(raw.text || raw.body || raw.content || raw.description, ""),
    scope: safeText(raw.scope || raw.visibility || raw.mode, "gm"),
    author_id: String(raw.author_id || raw.user_id || current?.id || current?.email || ""),
    author: safeText(raw.author || raw.author_name || fallbackAuthor, fallbackAuthor),
    created_at: raw.created_at || new Date().toISOString(),
    updated_at: raw.updated_at || raw.created_at || new Date().toISOString(),
  })).filter((note) => note.title || note.text);
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
    // Round 42: контракт сцены/карты. Это ещё не полноценный VTT, но уже
    // место, где хранятся размеры карты, сетка, свет, видимость и базовая логика movement.
    scene_state: normalizeMasterScene(raw.scene_state || raw.scene_map || raw.map || {}, raw),
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
    notes: normalizeNotes(raw.notes || raw.gm_notes || raw.player_notes || []),
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
      speed: Math.max(0, safeNumber(raw.speed ?? profile.speed ?? profile.vitality?.speed, 30)),
      temp_hp: Math.max(0, safeNumber(raw.temp_hp ?? profile.temp_hp ?? profile.vitality?.["hp-temp"], 0)),
      initiative: safeNumber(raw.initiative ?? profile.initiative, 0),
      proficiency_bonus: Math.max(0, safeNumber(raw.proficiency_bonus ?? raw.proficiency ?? profile.proficiency_bonus ?? profile.proficiency, 2)),
      abilities: cloneCombatProfileValue(raw.abilities || raw.stats || profile.abilities || profile.stats, {}),
      saves: cloneCombatProfileValue(raw.saves || profile.saves, {}),
      skills: cloneCombatProfileValue(raw.skills || profile.skills, {}),
      attacks: safeArray(raw.attacks || profile.attacksList || profile.weaponsList),
      spells: sanitizeMasterCombatSpellCollection(raw.spells || profile.spellCards || profile.spellsCards || profile.spellsList),
      spell_slots: safeArray(raw.spell_slots || raw.spellSlots),
      spellcasting: cloneCombatProfileValue(raw.spellcasting, {}),
      combat_profile: cloneCombatProfileValue(raw.combat_profile || profile.combat_profile, {}),
      features: safeArray(raw.features || raw.traits),
      visibility: { ...DEFAULT_VISIBILITY, ...(raw.visibility || {}) },
      sheet: profile,
      inventory: safeArray(raw.inventory || profile.inventory || profile.items),
      equipped_items: safeArray(raw.equipped_items || raw.equippedItems || profile.equipped_items || profile.equippedItems),
      buffs: safeArray(raw.buffs || raw.effects || profile.buffs || profile.effects),
      debuffs: safeArray(raw.debuffs || profile.debuffs),
      conditions: safeArray(raw.conditions || raw.statuses || profile.conditions || profile.statuses),
      resistances: safeArray(raw.resistances || profile.resistances),
      vulnerabilities: safeArray(raw.vulnerabilities || profile.vulnerabilities),
      immunities: safeArray(raw.immunities || profile.immunities),
      source_kind: "lss",
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
    combat_type: safeText(raw.combat_type || raw.event_type || raw.type, ""),
    title: safeText(raw.title || raw.label, "Событие"),
    description: safeText(raw.description || raw.summary || raw.details, ""),
    actor: safeText(raw.actor || raw.actor_name || raw.author || raw.user, "system"),
    target_name: safeText(raw.target_name || raw.target, ""),
    entry_id: String(raw.entry_id || raw.actor_entry_id || ""),
    target_entry_id: String(raw.target_entry_id || ""),
    round: Math.max(0, safeNumber(raw.round, 0)),
    dice: safeText(raw.dice, ""),
    total: raw.total ?? raw.roll_total ?? null,
    damage: safeNumber(raw.damage, 0),
    damage_type: safeText(raw.damage_type, ""),
    outcome: safeText(raw.outcome, ""),
    turn_resource: safeText(raw.turn_resource, ""),
    created_at: raw.created_at || raw.time || new Date().toISOString(),
    scope: safeText(raw.scope || raw.visibility, "gm"),
  };
}


// Round 39 combat parent helpers:
// combat.js теперь умеет отдавать payload по ресурсам хода и подсказку nextIndex.
// Здесь Master Room сохраняет этот state в столе, чтобы логика не терялась после render.
function makeDefaultTurnResources(speed = 30) {
  const movement = Math.max(0, safeNumber(speed, 30));
  return {
    action_available: true,
    bonus_action_available: true,
    reaction_available: true,
    free_action_available: true,
    object_interaction_available: true,
    movement_total: movement,
    movement_used: 0,
    movement_remaining: movement,
  };
}

function readCombatBool(value, fallback = true) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    if (["1", "true", "yes", "да", "ready", "available", "доступно"].includes(raw)) return true;
    if (["0", "false", "no", "нет", "spent", "used", "done", "потрачено"].includes(raw)) return false;
  }
  return fallback;
}

function normalizeMasterTurnResources(source = {}, speed = 30) {
  const base = makeDefaultTurnResources(speed);
  const raw = source && typeof source === "object" ? source : {};
  const turn = raw.turn_resources || raw.turnResources || raw.resources || {};
  const total = Math.max(0, safeNumber(turn.movement_total ?? turn.movement ?? raw.speed ?? speed, base.movement_total));
  const used = Math.max(0, safeNumber(turn.movement_used ?? turn.used_movement, 0));
  const remaining = turn.movement_remaining === undefined
    ? Math.max(0, total - used)
    : Math.max(0, safeNumber(turn.movement_remaining, total));

  return {
    action_available: readCombatBool(turn.action_available ?? turn.action, base.action_available),
    bonus_action_available: readCombatBool(turn.bonus_action_available ?? turn.bonus_action ?? turn.bonus, base.bonus_action_available),
    reaction_available: readCombatBool(turn.reaction_available ?? turn.reaction, base.reaction_available),
    free_action_available: readCombatBool(turn.free_action_available ?? turn.free_action, base.free_action_available),
    object_interaction_available: readCombatBool(turn.object_interaction_available ?? turn.object_interaction, base.object_interaction_available),
    movement_total: total,
    movement_used: used,
    movement_remaining: remaining,
  };
}


// Round 44: базовая логика движения как у пошагового боя: скорость существа,
// состояние/дебаффы, рывок, отступление, трудная местность и остаток movement.
function normalizeCombatConditionKey(value = "") {
  const raw = displayText(value, "").toLowerCase();
  if (!raw) return "";
  if (raw.includes("dead") || raw.includes("мертв") || raw.includes("убит") || raw.includes("выбыл")) return "dead";
  if (raw.includes("down") || raw.includes("unconscious") || raw.includes("без созн") || raw.includes("нок")) return "unconscious";
  if (raw.includes("paraly") || raw.includes("паралич")) return "paralyzed";
  if (raw.includes("stun") || raw.includes("оглуш")) return "stunned";
  if (raw.includes("grappl") || raw.includes("схвачен") || raw.includes("захвачен")) return "grappled";
  if (raw.includes("restrain") || raw.includes("опутан") || raw.includes("скован")) return "restrained";
  if (raw.includes("prone") || raw.includes("леж") || raw.includes("сбит")) return "prone";
  if (raw.includes("slow") || raw.includes("замед")) return "slowed";
  if (raw.includes("difficult") || raw.includes("трудн") || raw.includes("сложн") || raw.includes("болот") || raw.includes("гряз")) return "difficult_terrain";
  if (raw.includes("haste") || raw.includes("ускор")) return "hasted";
  if (raw.includes("fly") || raw.includes("полет") || raw.includes("летит")) return "flying";
  if (raw.includes("disengage") || raw.includes("отступ")) return "disengaged";
  return raw.replace(/\s+/g, "_").slice(0, 40);
}

function getCombatConditionKeys(entry = {}) {
  const out = new Set();
  const push = (value) => {
    if (value === null || value === undefined || value === "") return;
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (typeof value === "object") {
      push(value.key || value.id || value.name || value.title || value.label || value.condition || value.type || value.status);
      return;
    }
    const key = normalizeCombatConditionKey(value);
    if (key) out.add(key);
  };
  push(entry.status);
  push(entry.conditions);
  push(entry.buffs);
  push(entry.effects);
  push(entry.debuffs);
  push(entry.turn_flags?.condition);
  return Array.from(out);
}

function terrainLooksDifficult(scene = {}, token = {}) {
  const haystack = [scene.terrain, scene.surface, scene.light, token.terrain].map((item) => displayText(item, "").toLowerCase()).join(" ");
  return ["difficult", "rough", "трудн", "сложн", "болот", "гряз", "лед", "камн", "завал"].some((word) => haystack.includes(word));
}

function getMovementRuleState(entry = {}, scene = {}) {
  const baseSpeed = Math.max(0, safeNumber(entry.speed, 30));
  const turn = normalizeMasterTurnResources(entry, baseSpeed);
  const token = normalizeCombatSceneToken(entry, 0, entry.type);
  const flags = entry.turn_flags && typeof entry.turn_flags === "object" ? entry.turn_flags : {};
  const conditions = getCombatConditionKeys(entry);
  const has = (key) => conditions.includes(key);
  const reasons = [];
  let effectiveSpeed = baseSpeed;
  let costMultiplier = 1;
  let hardStop = false;

  if (isDeadEnemyCombatEntry(entry) || has("dead") || has("unconscious") || has("paralyzed") || has("stunned")) {
    hardStop = true;
    effectiveSpeed = 0;
    reasons.push("движение заблокировано состоянием");
  }
  if (!hardStop && (has("grappled") || has("restrained"))) {
    hardStop = true;
    effectiveSpeed = 0;
    reasons.push("скорость 0: схвачен/скован");
  }
  if (!hardStop && has("slowed")) {
    effectiveSpeed = Math.max(0, Math.floor(effectiveSpeed / 2));
    reasons.push("замедление: скорость ×1/2");
  }
  if (!hardStop && has("hasted")) {
    effectiveSpeed = Math.max(effectiveSpeed, baseSpeed * 2);
    reasons.push("ускорение: скорость увеличена");
  }
  if (!hardStop && (has("difficult_terrain") || terrainLooksDifficult(scene, token))) {
    costMultiplier = 2;
    reasons.push("трудная местность: движение стоит ×2");
  }
  if (has("prone")) reasons.push("лежит: вставание стоит половину скорости");
  if (flags.dashed) reasons.push(`рывок уже применён: ${safeNumber(flags.dashed, 1)} раз`);
  if (flags.disengaged) reasons.push("отступление активно: без провокации атак возможности");

  return {
    baseSpeed,
    effectiveSpeed: Math.max(0, effectiveSpeed),
    movementTotal: safeNumber(turn.movement_total, baseSpeed),
    movementUsed: safeNumber(turn.movement_used, 0),
    movementRemaining: hardStop ? 0 : Math.max(0, safeNumber(turn.movement_remaining, effectiveSpeed)),
    costMultiplier,
    hardStop,
    hasProne: has("prone"),
    disengaged: Boolean(flags.disengaged),
    dashed: safeNumber(flags.dashed, 0),
    reasons,
    conditions,
    flags,
  };
}

function movementRuleBadges(rule = {}) {
  const items = [];
  items.push(`<span>скорость ${escapeHtml(String(rule.baseSpeed || 0))} фт.</span>`);
  if (safeNumber(rule.effectiveSpeed, 0) !== safeNumber(rule.baseSpeed, 0)) items.push(`<span>эффективно ${escapeHtml(String(rule.effectiveSpeed || 0))} фт.</span>`);
  if (safeNumber(rule.costMultiplier, 1) > 1) items.push(`<span>стоимость ×${escapeHtml(String(rule.costMultiplier))}</span>`);
  if (rule.disengaged) items.push(`<span>отступление</span>`);
  if (rule.hardStop) items.push(`<span>движение заблокировано</span>`);
  return `<div class="master-runtime-move-rule-badges">${items.join("")}</div>`;
}

function getMovementCost(distance = 5, rule = {}, direction = "e") {
  const dir = displayText(direction, "e").toLowerCase();
  const base = Math.max(0, safeNumber(distance, 5));
  const verticalOnly = dir === "up" || dir === "down";
  const multiplier = verticalOnly ? 1 : Math.max(1, safeNumber(rule.costMultiplier, 1));
  return Math.ceil(base * multiplier);
}

function spendMovementActionResource(turn = {}, resource = "action") {
  const next = { ...turn };
  if (resource === "action") {
    if (!next.action_available) return { ok: false, turn: next, message: "Основное действие уже потрачено" };
    next.action_available = false;
    return { ok: true, turn: next };
  }
  if (resource === "bonus_action") {
    if (!next.bonus_action_available) return { ok: false, turn: next, message: "Бонусное действие уже потрачено" };
    next.bonus_action_available = false;
    return { ok: true, turn: next };
  }
  if (resource === "reaction") {
    if (!next.reaction_available) return { ok: false, turn: next, message: "Реакция уже потрачена" };
    next.reaction_available = false;
    return { ok: true, turn: next };
  }
  return { ok: true, turn: next };
}

function removeCombatCondition(entry = {}, conditionKey = "") {
  const key = normalizeCombatConditionKey(conditionKey);
  entry.conditions = safeArray(entry.conditions).filter((item) => normalizeCombatConditionKey(item?.name || item?.title || item?.key || item) !== key);
  entry.buffs = safeArray(entry.buffs).filter((item) => normalizeCombatConditionKey(item?.name || item?.title || item?.key || item) !== key);
  entry.effects = safeArray(entry.effects).filter((item) => normalizeCombatConditionKey(item?.name || item?.title || item?.key || item) !== key);
  if (normalizeCombatConditionKey(entry.status) === key) entry.status = "ready";
  return entry;
}

function inferCombatEntityKind(entry = {}) {
  const kind = displayText(entry.entity_kind || entry.kind, "").toLowerCase();
  if (kind) return kind;
  const type = displayText(entry.type || entry.entry_type, "").toLowerCase();
  if (type === "enemy" || type === "monster") return "enemy";
  return "character";
}

function deriveMasterCombatStatus(entry = {}) {
  const raw = displayText(entry.status, "").trim().toLowerCase();
  const hpCurrent = safeNumber(entry.hp_current ?? entry.hp?.current, 1);
  const hpMax = safeNumber(entry.hp_max ?? entry.hp?.max, 0);
  if (hpMax > 0 && hpCurrent <= 0) {
    return inferCombatEntityKind(entry) === "enemy" ? "dead" : "down";
  }
  // Если существо снова получило HP, старый terminal-статус не должен навсегда
  // удерживать его мёртвым/лежащим после лечения или GM-воскрешения.
  if (["dead", "killed", "defeated", "down", "unconscious", "dying"].includes(raw)) return "ready";
  return raw || "ready";
}

function isDeadEnemyCombatEntry(entry = {}) {
  const kind = inferCombatEntityKind(entry);
  const status = displayText(entry.status, "").toLowerCase();
  return kind === "enemy" && (status === "dead" || status === "killed" || status === "defeated" || safeNumber(entry.hp_current, 1) <= 0);
}

function isEligibleCombatTurn(entry = {}) {
  // Врагов с 0 HP пропускаем. Игроков/персонажей с 0 HP оставляем в очереди:
  // позже сюда лягут спасброски смерти, помощь и лечение.
  return !isDeadEnemyCombatEntry(entry);
}

function resetCombatEntryTurnResources(entry = {}) {
  entry.turn_resources = makeDefaultTurnResources(safeNumber(entry.speed, 30));
  return entry;
}

function normalizeMasterScene(raw = {}, tableLike = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const tableScene = tableLike?.scene || tableLike?.active_scene || tableLike?.title || "Сцена боя";
  const width = Math.max(20, safeNumber(source.width ?? source.map_width ?? source.grid_width ?? 120, 120));
  const height = Math.max(20, safeNumber(source.height ?? source.map_height ?? source.grid_height ?? 80, 80));
  return {
    map_name: safeText(source.map_name || source.name || source.title || tableScene, tableScene),
    map_url: safeText(source.map_url || source.image_url || source.background_url || source.url, ""),
    grid_enabled: readCombatBool(source.grid_enabled ?? source.grid ?? true, true),
    grid_size_ft: Math.max(1, safeNumber(source.grid_size_ft ?? source.grid_size ?? source.cell_size ?? 5, 5)),
    width,
    height,
    visibility_mode: safeText(source.visibility_mode || source.fog_mode || "party", "party"),
    light: safeText(source.light || source.lighting || "обычное освещение", "обычное освещение"),
    terrain: safeText(source.terrain || source.surface || "обычная поверхность", "обычная поверхность"),
    elevation_mode: safeText(source.elevation_mode || "manual", "manual"),
    cover_mode: safeText(source.cover_mode || "manual", "manual"),
    zones: safeArray(source.zones || source.effects || source.areas),
  };
}

function normalizeCombatScene(raw = {}, table = null) {
  const base = normalizeMasterScene(table?.scene_state || {}, table || {});
  const source = raw && typeof raw === "object" ? raw : {};
  return normalizeMasterScene({ ...base, ...source }, table || {});
}

function normalizeCombatSceneToken(raw = {}, index = 0, type = "member") {
  const source = raw && typeof raw === "object" ? raw : {};
  const position = source.scene_state || source.position || source.map_position || source.scene || {};
  const isEnemy = String(type || source.type || source.entity_kind || "").toLowerCase().includes("enemy");
  const fallbackX = isEnemy ? 72 + ((index % 4) * 6) : 14 + ((index % 4) * 7);
  const fallbackY = isEnemy ? 22 + (Math.floor(index / 4) * 9) : 58 + (Math.floor(index / 4) * 8);
  return {
    x: safeNumber(position.x ?? position.grid_x ?? position.left ?? source.x ?? source.position_x, fallbackX),
    y: safeNumber(position.y ?? position.grid_y ?? position.top ?? source.y ?? source.position_y, fallbackY),
    z: safeNumber(position.z ?? position.height ?? position.elevation ?? source.z ?? source.elevation, 0),
    facing: safeText(position.facing || source.facing || "", ""),
    cover: safeText(position.cover || source.cover || "none", "none"),
    terrain: safeText(position.terrain || source.terrain || "normal", "normal"),
    visible_to_players: readCombatBool(position.visible_to_players ?? source.visible_to_players ?? (!isEnemy), !isEnemy),
    hidden: readCombatBool(position.hidden ?? source.hidden, false),
    movement_mode: safeText(position.movement_mode || source.movement_mode || "walk", "walk"),
  };
}

function clampSceneNumber(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, safeNumber(value, min)));
}

function getSceneGridSize(scene = {}) {
  return Math.max(1, safeNumber(scene.grid_size_ft, 5));
}

function snapSceneCoordinate(value, scene = {}, axis = "x") {
  const grid = getSceneGridSize(scene);
  const max = axis === "y" ? Math.max(grid, safeNumber(scene.height, 80)) : Math.max(grid, safeNumber(scene.width, 120));
  const snapped = Math.round(safeNumber(value, grid) / grid) * grid;
  return clampSceneNumber(snapped, 0, max);
}

function snapScenePosition(position = {}, scene = {}) {
  return {
    ...position,
    x: snapSceneCoordinate(position.x, scene, "x"),
    y: snapSceneCoordinate(position.y, scene, "y"),
    z: Math.round(safeNumber(position.z, 0) / getSceneGridSize(scene)) * getSceneGridSize(scene),
  };
}

function getCombatEntryFootprintCells(entry = {}) {
  const raw = displayText(
    entry.size || entry.creature_size || entry.snapshot?.size || entry.bestiary_summary?.size || entry.statblock?.size,
    "medium",
  ).toLowerCase();
  if (/(gargantuan|исполин|колосс)/i.test(raw)) return 4;
  if (/(huge|огромн)/i.test(raw)) return 3;
  if (/(large|больш)/i.test(raw)) return 2;
  return 1;
}

function getCombatEntryFootprintRect(entry = {}, position = {}, scene = {}) {
  const cells = getCombatEntryFootprintCells(entry);
  const footprint = cells * getSceneGridSize(scene);
  const half = footprint / 2;
  return {
    left: safeNumber(position.x, 0) - half,
    right: safeNumber(position.x, 0) + half,
    top: safeNumber(position.y, 0) - half,
    bottom: safeNumber(position.y, 0) + half,
    z: safeNumber(position.z, 0),
    cells,
    footprint,
  };
}

function sceneRectsOverlap(a, b, grid = 5) {
  if (Math.abs(safeNumber(a.z, 0) - safeNumber(b.z, 0)) >= Math.max(1, grid)) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function findCombatSceneCollision(entries = [], movingEntry = null, destination = {}, scene = {}) {
  if (!movingEntry) return null;
  const movingRect = getCombatEntryFootprintRect(movingEntry, destination, scene);
  return safeArray(entries).find((other) => {
    if (!other || String(other.entry_id || "") === String(movingEntry.entry_id || "")) return false;
    const otherPosition = snapScenePosition(normalizeCombatSceneToken(other, 0, other.type), scene);
    const otherRect = getCombatEntryFootprintRect(other, otherPosition, scene);
    return sceneRectsOverlap(movingRect, otherRect, getSceneGridSize(scene));
  }) || null;
}

function findNearestFreeScenePosition(entries = [], movingEntry = null, desired = {}, scene = {}) {
  const grid = getSceneGridSize(scene);
  const base = snapScenePosition(desired, scene);
  if (!findCombatSceneCollision(entries, movingEntry, base, scene)) return base;
  const maxRadius = Math.max(Math.ceil(safeNumber(scene.width, 120) / grid), Math.ceil(safeNumber(scene.height, 80) / grid));
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const candidate = snapScenePosition({ ...base, x: base.x + dx * grid, y: base.y + dy * grid }, scene);
        if (!findCombatSceneCollision(entries, movingEntry, candidate, scene)) return candidate;
      }
    }
  }
  return base;
}

function snapMovementDistance(distance = 5, scene = {}) {
  const grid = getSceneGridSize(scene);
  return Math.max(grid, Math.round(Math.max(1, safeNumber(distance, grid)) / grid) * grid);
}

function sceneTokenInitial(entry = {}) {
  const text = displayText(entry.name || entry.player_name, "?").trim();
  return escapeHtml((text[0] || "?").toUpperCase());
}

function normalizeCombat(raw = {}, table = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  const memberEntries = table ? safeArray(table.members).map((member, index) => {
    const entry = {
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
      status: displayText(member.status, "ready"),
      conditions: safeArray(member.conditions),
      source_kind: "lss",
      source: "lss",
      entity_kind: "character",
      sheet: cloneCombatProfileValue(member.sheet, {}),
      level: safeNumber(member.level, 1),
      class_name: displayText(member.class_name, ""),
      race: displayText(member.race, ""),
      temp_hp: safeNumber(member.temp_hp, 0),
      proficiency_bonus: safeNumber(member.proficiency_bonus, 2),
      abilities: cloneCombatProfileValue(member.abilities, {}),
      saves: cloneCombatProfileValue(member.saves, {}),
      skills: cloneCombatProfileValue(member.skills, {}),
      attacks: safeArray(member.attacks),
      spells: sanitizeMasterCombatSpellCollection(member.spells),
      spell_slots: normalizeMasterRuntimeSpellSlots(member.spell_slots),
      spells_meta: cloneCombatProfileValue(member.spells_meta, {}),
      spellcasting: cloneCombatProfileValue(member.spellcasting, {}),
      concentration: cloneCombatProfileValue(member.concentration, null),
      combat_profile: cloneCombatProfileValue(member.combat_profile, {}),
      features: safeArray(member.features),
      items: safeArray(member.inventory),
      inventory: safeArray(member.inventory),
      equipped_items: safeArray(member.equipped_items),
      buffs: safeArray(member.buffs),
      debuffs: safeArray(member.debuffs),
      resistances: safeArray(member.resistances),
      vulnerabilities: safeArray(member.vulnerabilities),
      immunities: safeArray(member.immunities),
      turn_flags: member.turn_flags && typeof member.turn_flags === "object" ? { ...member.turn_flags } : {},
      scene_state: normalizeCombatSceneToken(member, index, "member"),
    };
    entry.status = deriveMasterCombatStatus(entry);
    entry.turn_resources = normalizeMasterTurnResources(member, entry.speed);
    return entry;
  }) : [];

  const existing = safeArray(source.entries).map((entry, index) => {
    const type = safeText(entry.type || entry.entry_type, entry.membership_id ? "member" : "enemy");
    const normalized = {
      entry_id: String(entry.entry_id || entry.id || makeId(`combat_${index}`)),
      membership_id: entry.membership_id || null,
      type,
      name: displayText(entry.name, `Участник ${index + 1}`),
      player_name: displayText(entry.player_name, ""),
      portrait_url: displayText(entry.portrait_url || entry.avatar_url, ""),
      initiative: safeNumber(entry.initiative, 10),
      hp_current: safeNumber(entry.hp_current ?? entry.hp?.current, 10),
      hp_max: safeNumber(entry.hp_max ?? entry.hp?.max, 10),
      ac: safeNumber(entry.ac ?? entry.armor_class, 10),
      speed: safeNumber(entry.speed, 30),
      status: displayText(entry.status, "ready"),
      conditions: safeArray(entry.conditions),
      source_kind: displayText(entry.source_kind || entry.source, type === "enemy" ? "bestiary/manual" : "lss"),
      source: displayText(entry.source, type === "enemy" ? "manual" : "lss"),
      entity_kind: displayText(entry.entity_kind, type === "enemy" ? "enemy" : "character"),
      sheet: cloneCombatProfileValue(entry.sheet, {}),
      level: safeNumber(entry.level, 0),
      class_name: displayText(entry.class_name || entry.class, ""),
      race: displayText(entry.race || entry.species, ""),
      temp_hp: safeNumber(entry.temp_hp ?? entry.temporary_hp, 0),
      proficiency_bonus: safeNumber(entry.proficiency_bonus ?? entry.proficiency, 0),
      abilities: cloneCombatProfileValue(entry.abilities || entry.stats, {}),
      saves: cloneCombatProfileValue(entry.saves, {}),
      skills: cloneCombatProfileValue(entry.skills, {}),
      attacks: safeArray(entry.attacks || entry.actions),
      spells: sanitizeMasterCombatSpellCollection(entry.spells),
      spell_slots: normalizeMasterRuntimeSpellSlots(entry.spell_slots || entry.spellSlots),
      spells_meta: cloneCombatProfileValue(entry.spells_meta, {}),
      spellcasting: cloneCombatProfileValue(entry.spellcasting, {}),
      concentration: cloneCombatProfileValue(entry.concentration, null),
      combat_profile: cloneCombatProfileValue(entry.combat_profile, {}),
      features: safeArray(entry.features || entry.traits),
      items: safeArray(entry.items || entry.inventory || entry.equipment),
      inventory: safeArray(entry.inventory || entry.items),
      equipped_items: safeArray(entry.equipped_items || entry.equippedItems),
      buffs: safeArray(entry.buffs || entry.effects),
      debuffs: safeArray(entry.debuffs),
      resistances: safeArray(entry.resistances),
      vulnerabilities: safeArray(entry.vulnerabilities),
      immunities: safeArray(entry.immunities),
      turn_flags: entry.turn_flags && typeof entry.turn_flags === "object" ? { ...entry.turn_flags } : {},
      bestiary_id: displayText(entry.bestiary_id || entry.codex_id || entry.source_id, ""),
      snapshot: entry.snapshot || entry.bestiary_snapshot || null,
      scene_state: normalizeCombatSceneToken(entry, index, type),
    };
    normalized.status = deriveMasterCombatStatus(normalized);
    normalized.turn_resources = normalizeMasterTurnResources(entry, normalized.speed);
    return normalized;
  });

  const merged = existing.length ? existing : memberEntries;
  const safeTurnIndex = Math.max(0, Math.min(merged.length ? merged.length - 1 : 0, safeNumber(source.turn_index, 0)));
  return {
    active: Boolean(source.active || merged.length),
    round: Math.max(1, safeNumber(source.round, 1)),
    turn_index: safeTurnIndex,
    entries: merged,
    scene: normalizeCombatScene(source.scene || source.scene_state || source.map || source.battlemap || {}, table),
    log: safeArray(source.log).map((item, index) => ({
      id: String(item.id || makeId(`log_${index}`)),
      event_type: displayText(item.event_type || item.type, "note"),
      entry_id: displayText(item.entry_id || item.actor_entry_id, ""),
      target_entry_id: displayText(item.target_entry_id, ""),
      actor_name: displayText(item.actor_name || item.actor, "system"),
      target_name: displayText(item.target_name || item.target, ""),
      reason: displayText(item.reason || item.title, "Событие"),
      summary: displayText(item.summary || item.description, ""),
      dice: displayText(item.dice, ""),
      modifier: safeNumber(item.modifier, 0),
      roll_total: item.roll_total ?? item.total ?? null,
      total: item.total ?? item.roll_total ?? null,
      damage: safeNumber(item.damage, 0),
      damage_type: displayText(item.damage_type, ""),
      outcome: displayText(item.outcome, ""),
      turn_resource: displayText(item.turn_resource, ""),
      round: Math.max(1, safeNumber(item.round, source.round || 1)),
      scope: displayText(item.scope || item.visibility, "public"),
      created_at: item.created_at || new Date().toISOString(),
    })),
    environment: source.environment || {
      location: table?.scene || "Сцена боя",
      light: normalizeCombatScene(source.scene || source.scene_state || source.map || {}, table).light,
      surface: normalizeCombatScene(source.scene || source.scene_state || source.map || {}, table).terrain,
      features: "сетка/позиции/видимость хранятся в combat.scene",
    },
    last_roll: source.last_roll || null,
  };
}

function getActiveTable() {
  // Round 38: activeTableId может быть специальным значением лобби.
  // Раньше null сразу падал обратно на первый стол, поэтому кнопка “к столам”
  // визуально не возвращала в поиск/список столов.
  if (String(MASTER_ROOM_STATE.activeTableId || "") === MASTER_ROOM_LOBBY_ID) return null;
  if (!MASTER_ROOM_STATE.activeTableId) return MASTER_ROOM_STATE.tables[0] || null;
  return MASTER_ROOM_STATE.tables.find((table) => String(table.id) === String(MASTER_ROOM_STATE.activeTableId)) || MASTER_ROOM_STATE.tables[0] || null;
}

function canManageTable(table = getActiveTable()) {
  if (!table) return isGmRole();
  const user = getCurrentUser();
  const userId = String(user?.id || user?.email || "");
  return isGmRole() || String(table.owner_user_id || "") === userId;
}


function isVisibleAccessValue(value, canManage = false) {
  if (canManage) return true;
  const normalized = displayText(value, "party").toLowerCase();
  return ["public", "party", "player", "players", "open"].includes(normalized);
}

function canSeeMasterTab(tabKey, table = getActiveTable(), canManage = false) {
  if (!table) return tabKey === "table";
  if (canManage) return true;
  if (["table", "party", "characters"].includes(tabKey)) return true;
  if (tabKey === "access") return false;
  if (tabKey === "grants") return false;
  if (tabKey === "traders") return isVisibleAccessValue(table.access?.traders, false);
  if (tabKey === "combat") return isVisibleAccessValue(table.access?.combat, false);
  if (tabKey === "journal") return isVisibleAccessValue(table.access?.journal, false);
  if (tabKey === "notes") return isVisibleAccessValue(table.access?.notes, false);
  return true;
}

function getVisibleMasterTabs(table = getActiveTable(), canManage = false) {
  return MASTER_TABS.filter((tab) => canSeeMasterTab(tab.key, table, canManage));
}

function normalizeMasterActiveTab(table = getActiveTable(), canManage = false) {
  if (!table) return "table";
  const visible = getVisibleMasterTabs(table, canManage);
  const keys = new Set(visible.map((tab) => tab.key));
  if (!keys.has(MASTER_ROOM_STATE.activeTab)) MASTER_ROOM_STATE.activeTab = "table";
  return MASTER_ROOM_STATE.activeTab;
}

function canSeeMasterNote(note = {}, table = getActiveTable(), canManage = false) {
  if (canManage) return true;
  const scope = displayText(note.scope, "gm").toLowerCase();
  if (["public", "party", "open"].includes(scope)) return true;
  if (["gm", "master", "hidden", "private_gm"].includes(scope)) return false;
  if (["player", "private", "personal"].includes(scope)) {
    const user = getCurrentUser();
    const keys = [String(user?.id || ""), String(user?.email || ""), String(user?.nickname || "")].filter(Boolean);
    return keys.includes(String(note.author_id || "")) || keys.includes(String(note.author || ""));
  }
  return false;
}

function getVisibleMasterNotes(table = getActiveTable(), canManage = false) {
  return safeArray(table?.notes).filter((note) => canSeeMasterNote(note, table, canManage));
}

function canSeeMasterEvent(event = {}, table = getActiveTable(), canManage = false) {
  if (canManage) return true;
  const scope = displayText(event.scope || event.visibility, "public").toLowerCase();
  if (["gm", "master", "hidden", "private_gm"].includes(scope)) return false;
  if (["public", "party", "player", "players", "open"].includes(scope)) return true;
  return isVisibleAccessValue(table?.access?.journal, false);
}

function getVisibleMasterEvents(table = getActiveTable(), canManage = false) {
  return safeArray(table?.events).filter((event) => canSeeMasterEvent(event, table, canManage));
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

function unwrapCombatProfileValue(value, fallback = "") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value;
  for (const key of ["value", "current", "score", "total", "name", "label", "text"]) {
    if (value[key] !== undefined && value[key] !== value) return unwrapCombatProfileValue(value[key], fallback);
  }
  return value;
}

function cloneCombatProfileValue(value, fallback = {}) {
  if (!value || typeof value !== "object") return fallback;
  const seen = new WeakSet();
  try {
    return JSON.parse(JSON.stringify(value, (key, item) => {
      if (key === "__lssRoot") return undefined;
      if (item && typeof item === "object") {
        if (seen.has(item)) return undefined;
        seen.add(item);
      }
      return item;
    }));
  } catch (_) {
    if (Array.isArray(value)) return value.slice();
    return { ...value, __lssRoot: undefined };
  }
}

function getLssAbilityMap(profile = {}) {
  const stats = profile.stats || profile.abilities || {};
  const aliases = {
    str: ["str", "strength", "сила"],
    dex: ["dex", "dexterity", "ловкость"],
    con: ["con", "constitution", "телосложение"],
    int: ["int", "intelligence", "интеллект"],
    wis: ["wis", "wisdom", "мудрость"],
    cha: ["cha", "charisma", "харизма"],
  };
  const out = {};
  Object.entries(aliases).forEach(([code, keys]) => {
    const source = keys.map((key) => stats[key]).find((item) => item !== undefined) || {};
    const score = Math.max(1, safeNumber(unwrapCombatProfileValue(source.score ?? source.value ?? source, 10), 10));
    const explicit = unwrapCombatProfileValue(source.modifier ?? source.mod ?? source.check, null);
    const modifier = explicit === null || explicit === "" ? Math.floor((score - 10) / 2) : safeNumber(explicit, Math.floor((score - 10) / 2));
    out[code] = { score, modifier };
  });
  return out;
}

function isMasterExternalSpellObjectId(value) {
  return /^[a-f\d]{24}$/i.test(String(value || "").trim());
}


function sanitizeMasterCombatSpellCollection(value = []) {
  const list = safeArray(value);
  const seen = new Set();
  return list.filter((spell) => {
    if (typeof spell === "string" || typeof spell === "number") {
      const raw = String(spell || "").trim();
      if (!raw || isMasterExternalSpellObjectId(raw)) return false;
      const key = normalizeMasterSpellLookup(raw);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }
    if (!spell || typeof spell !== "object") return false;
    const readable = displayText(
      spell.name || spell.ru_name || spell.title || spell.label || spell.en_name || spell.enName,
      ""
    ).trim();
    const id = displayText(spell.id || spell.spell_id || spell.external_id || spell.externalId, "").trim();
    if ((!readable || isMasterExternalSpellObjectId(readable)) && (!id || isMasterExternalSpellObjectId(id))) return false;
    if (!readable || isMasterExternalSpellObjectId(readable)) return false;
    const key = `${normalizeMasterSpellLookup(readable)}|${safeNumber(spell.level ?? spell.circle ?? spell.spell_level, 0)}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeMasterRuntimeSpellSlots(value = []) {
  const byLevel = new Map();
  safeArray(value).forEach((slot) => {
    const source = slot && typeof slot === "object" ? slot : {};
    const level = Math.max(0, safeNumber(source.level ?? source.circle ?? source.spell_level, 0));
    if (level <= 0) return;
    const total = Math.max(0, safeNumber(source.total ?? source.max ?? source.value, 0));
    let used = source.used ?? source.spent ?? source.filled;
    if ((used === undefined || used === null || used === "") && source.remaining !== undefined) {
      used = Math.max(0, total - safeNumber(source.remaining, total));
    }
    used = Math.max(0, Math.min(total || Number.MAX_SAFE_INTEGER, safeNumber(used, 0)));
    const normalized = {
      ...cloneCombatProfileValue(source, {}),
      level,
      total,
      used,
      remaining: Math.max(0, total - used),
    };
    const previous = byLevel.get(level);
    if (!previous || normalized.total >= previous.total) byLevel.set(level, normalized);
  });
  return Array.from(byLevel.values()).sort((a, b) => a.level - b.level);
}

function syncMasterSpellSlotsIntoSheet(entry = {}) {
  const slots = normalizeMasterRuntimeSpellSlots(entry.spell_slots);
  entry.spell_slots = slots;
  const sheet = entry.sheet && typeof entry.sheet === "object" ? entry.sheet : null;
  if (!sheet) return;
  if (!sheet.spells || typeof sheet.spells !== "object" || Array.isArray(sheet.spells)) sheet.spells = {};
  slots.forEach((slot) => {
    const key = `slots-${slot.level}`;
    const old = sheet.spells[key] && typeof sheet.spells[key] === "object" ? sheet.spells[key] : {};
    sheet.spells[key] = {
      ...old,
      value: slot.total,
      filled: slot.used,
      remaining: slot.remaining,
    };
  });
}

function spendMasterCombatSpellSlot(entry = {}, levelValue = 0, amountValue = 1) {
  const level = Math.max(0, safeNumber(levelValue, 0));
  const amount = Math.max(1, safeNumber(amountValue, 1));
  if (level <= 0) return { ok: true, level: 0, total: 0, used: 0, remaining: Infinity, cantrip: true };
  const slots = normalizeMasterRuntimeSpellSlots(entry.spell_slots);
  const slot = slots.find((item) => item.level === level);
  if (!slot || slot.remaining < amount) {
    return { ok: false, level, total: slot?.total || 0, used: slot?.used || 0, remaining: slot?.remaining || 0 };
  }
  slot.used = Math.min(slot.total, slot.used + amount);
  slot.remaining = Math.max(0, slot.total - slot.used);
  entry.spell_slots = slots;
  syncMasterSpellSlotsIntoSheet(entry);
  return { ok: true, ...slot };
}

function findMasterCombatSpellDefinition(entry = {}, payload = {}) {
  const requestedId = displayText(payload.spell_id, "").trim();
  const requestedName = normalizeMasterSpellLookup(payload.spell_name || payload.reason || "");
  const candidates = sanitizeMasterCombatSpellCollection([
    ...safeArray(entry.spells),
    ...safeArray(entry.combat_profile?.spells),
    ...safeArray(entry.sheet?.spellCards),
    ...safeArray(entry.sheet?.spellsMeta?.cards),
    ...safeArray(entry.snapshot?.spells),
  ]);
  return candidates.find((spell) => {
    const source = spell && typeof spell === "object" ? spell : { name: spell };
    const id = displayText(source.id || source.spell_id || source.catalog_id || source.external_id, "").trim();
    const name = normalizeMasterSpellLookup(source.name || source.ru_name || source.title || source.label || "");
    return (requestedId && id === requestedId) || (requestedName && name === requestedName);
  }) || null;
}

function parseMasterEffectDurationRounds(value, fallback = 1) {
  const text = displayText(value, "").toLowerCase();
  const numeric = text.match(/(\\d+)\\s*(?:раунд|round)/i);
  if (numeric) return Math.max(1, safeNumber(numeric[1], fallback));
  if (/мину|minute/.test(text)) return 10;
  if (/час|hour/.test(text)) return 600;
  if (/до конца следующего хода|until the end of.*next turn/.test(text)) return 1;
  if (/до конца хода|until the end of.*turn/.test(text)) return 1;
  return Math.max(1, safeNumber(fallback, 1));
}

function isMasterHarmfulEffectText(value) {
  return /(ослеп|оглуш|парализ|скован|замед|испуган|очарован|отрав|горен|кровотеч|прокля|помех|debuff|stun|blind|paraly|restrain|slow|fright|charm|poison|burn|curse)/i.test(displayText(value, ""));
}

function removeMasterConcentration(table, sourceEntryId, reason = "") {
  const sourceId = String(sourceEntryId || "");
  if (!sourceId) return [];
  const removed = [];
  safeArray(table?.combat?.entries).forEach((entry) => {
    ["buffs", "debuffs"].forEach((field) => {
      entry[field] = safeArray(entry[field]).filter((effect) => {
        const match = Boolean(effect?.concentration) && String(effect?.source_entry_id || "") === sourceId;
        if (match) removed.push(effect);
        return !match;
      });
    });
  });
  const source = safeArray(table?.combat?.entries).find((entry) => String(entry.entry_id || "") === sourceId);
  if (source) source.concentration = null;
  if (removed.length && reason) {
    emitMasterEvent({
      type: "effect",
      title: "Концентрация завершена",
      description: reason,
      entry_id: sourceId,
      combat_type: "effect",
      scope: "public",
    });
  }
  return removed;
}

function applyMasterCombatEffect(table, source = {}, target = {}, payload = {}, spell = null) {
  if (!target?.entry_id) return null;
  const name = displayText(payload.effect_name || payload.spell_name || spell?.name || payload.reason, "Эффект");
  const description = displayText(payload.spell_effect || spell?.effect || spell?.description || payload.description, "");
  const durationText = displayText(payload.spell_duration || spell?.duration || payload.duration, "1 раунд");
  const concentration = Boolean(payload.spell_concentration ?? spell?.concentration);
  const effect = {
    id: makeId("effect"),
    name,
    description,
    source_entry_id: source.entry_id || null,
    source_name: source.name || "",
    target_entry_id: target.entry_id,
    spell_id: displayText(payload.spell_id || spell?.id || spell?.spell_id, ""),
    spell_level: Math.max(0, safeNumber(payload.spell_level ?? spell?.level, 0)),
    concentration,
    duration: durationText,
    remaining_rounds: parseMasterEffectDurationRounds(durationText, 1),
    tick_on: "end_turn",
    created_round: Math.max(1, safeNumber(table?.combat?.round, 1)),
    visibility: payload.scope || "public",
  };
  const harmful = isMasterHarmfulEffectText(`${name} ${description}`) || (source.entity_kind !== target.entity_kind && payload.spell_mode === "save");
  const field = harmful ? "debuffs" : "buffs";
  target[field] = [effect, ...safeArray(target[field]).filter((item) => String(item?.id || "") !== effect.id)].slice(0, 40);
  if (concentration && source?.entry_id) {
    removeMasterConcentration(table, source.entry_id, "Новое концентрационное заклинание заменило предыдущее.");
    // removeMasterConcentration also clears the just-created effect only if it was already attached;
    // attach it again after clearing previous concentration effects.
    target[field] = [effect, ...safeArray(target[field]).filter((item) => String(item?.id || "") !== effect.id)].slice(0, 40);
    source.concentration = {
      effect_id: effect.id,
      spell_id: effect.spell_id,
      spell_name: name,
      target_entry_id: target.entry_id,
      started_round: effect.created_round,
    };
  }
  return effect;
}

function tickMasterCombatEffectsForEntry(table, entry = null) {
  if (!entry) return [];
  const expired = [];
  ["buffs", "debuffs"].forEach((field) => {
    entry[field] = safeArray(entry[field]).filter((effect) => {
      if (!effect || typeof effect !== "object") return true;
      if (effect.tick_on && effect.tick_on !== "end_turn") return true;
      const remaining = safeNumber(effect.remaining_rounds, 0);
      if (remaining <= 0) return true;
      effect.remaining_rounds = remaining - 1;
      if (effect.remaining_rounds > 0) return true;
      expired.push(effect);
      return false;
    });
  });
  expired.forEach((effect) => {
    if (effect?.concentration && effect?.source_entry_id) {
      const source = safeArray(table?.combat?.entries).find((item) => String(item.entry_id || "") === String(effect.source_entry_id || ""));
      if (source && String(source.concentration?.effect_id || "") === String(effect.id || "")) source.concentration = null;
    }
  });
  if (expired.length) {
    emitMasterEvent({
      type: "effect",
      title: "Эффекты завершены",
      description: `${entry.name || "Участник"}: ${expired.map((item) => item.name || "эффект").join(", ")}`,
      entry_id: entry.entry_id || "",
      combat_type: "effect",
      scope: "public",
    });
  }
  return expired;
}

function applyMasterSpellRuntimeState(table, payload = {}, current = {}, target = {}) {
  const isSpell = displayText(payload.action_type || payload.event_type, "").toLowerCase() === "spell" || Boolean(payload.spell_name || payload.spell_id);
  if (!isSpell || !current?.entry_id) return { is_spell: false };
  const spell = findMasterCombatSpellDefinition(current, payload);
  const level = Math.max(0, safeNumber(payload.spell_level ?? spell?.level, 0));
  const slot = spendMasterCombatSpellSlot(current, level, 1);
  const concentration = Boolean(payload.spell_concentration ?? spell?.concentration);
  const mode = displayText(payload.spell_mode || spell?.mode, "effect").toLowerCase();
  const effectText = displayText(payload.spell_effect || spell?.effect || spell?.description, "");
  const shouldAttachEffect = Boolean(target?.entry_id) && (concentration || mode === "effect" || Boolean(effectText && !payload.damage_dice));
  const effect = shouldAttachEffect ? applyMasterCombatEffect(table, current, target, { ...payload, spell_concentration: concentration }, spell) : null;
  return {
    is_spell: true,
    spell,
    slot,
    effect,
    concentration,
    mode,
  };
}

function normalizeMasterSpellLookup(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»„“”\"'`]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLssSpellSlotsSnapshot(profile = {}, raw = {}) {
  const collected = new Map();
  const pushSlot = (levelValue, source = {}) => {
    const level = Math.max(0, safeNumber(levelValue ?? source.level ?? source.circle ?? source.spell_level, 0));
    if (!Number.isFinite(level) || level <= 0) return;
    const total = Math.max(0, safeNumber(unwrapCombatProfileValue(source.total ?? source.max ?? source.value, 0), 0));
    let used = source.used ?? source.spent ?? source.filled;
    if ((used === undefined || used === null || used === "") && source.remaining !== undefined) {
      used = Math.max(0, total - safeNumber(source.remaining, total));
    }
    used = Math.max(0, Math.min(total || Number.MAX_SAFE_INTEGER, safeNumber(unwrapCombatProfileValue(used, 0), 0)));
    const previous = collected.get(level);
    const normalized = { level, total, used, remaining: Math.max(0, total - used) };
    if (!previous || normalized.total > previous.total || (normalized.total === previous.total && normalized.used < previous.used)) {
      collected.set(level, normalized);
    }
  };

  const readSlotObject = (root) => {
    if (!root || typeof root !== "object") return;
    if (Array.isArray(root)) {
      root.forEach((slot) => pushSlot(slot?.level ?? slot?.circle ?? slot?.spell_level, slot || {}));
      return;
    }
    Object.entries(root).forEach(([key, value]) => {
      const match = String(key).match(/(?:slots?|spell)[-_]?(\d+)/i);
      if (match) pushSlot(Number(match[1]), value && typeof value === "object" ? value : { value });
    });
  };

  [
    profile?.spell_slots,
    profile?.spellSlots,
    profile?.spells,
    profile?.spellsMeta?.slots,
    raw?.spell_slots,
    raw?.spellSlots,
    raw?.spells,
    profile?.__lssRoot?.data?.spells,
    profile?.__lssRoot?.spells,
  ].forEach(readSlotObject);

  return Array.from(collected.values()).sort((a, b) => a.level - b.level);
}

function normalizeLssCombatSpell(spell, index = 0, preparedIds = new Set()) {
  if (typeof spell === "string" || typeof spell === "number") {
    const text = String(spell).trim();
    if (!text || isMasterExternalSpellObjectId(text)) return null;
    return {
      id: `lss-text-${index}-${normalizeMasterSpellLookup(text).replace(/\s+/g, "-")}`,
      name: text,
      level: 0,
      prepared: preparedIds.has(text),
      source_kind: "lss_text",
      bridge_confidence: "text-only",
    };
  }

  const source = spell && typeof spell === "object" ? spell : {};
  const rawName = source.name || source.ru_name || source.title || source.label || source.en_name || source.enName;
  const name = displayText(rawName, "").trim();
  if (!name || isMasterExternalSpellObjectId(name)) return null;

  const id = String(
    source.catalog_id || source.catalogId || source.id || source.spell_id || source.slug || source.key ||
    source.external_id || source.externalId || `lss-spell-${index}`
  );
  const externalId = String(source.external_id || source.externalId || "");
  const catalogId = String(source.catalog_id || source.catalogId || source.spell_id || source.id || "");
  const preparedKeys = [id, externalId, catalogId, name, normalizeMasterSpellLookup(name)].filter(Boolean);
  const isPrepared = source.prepared === undefined
    ? preparedKeys.some((key) => preparedIds.has(String(key)) || preparedIds.has(normalizeMasterSpellLookup(key)))
    : Boolean(source.prepared);

  const castingTime = displayText(source.casting_time || source.time || source.cast_time || source.activation || source.action_type, "");
  const actionType = displayText(source.action_type || source.activation || source.resource || castingTime, "action");
  const description = displayText(source.description || source.text || source.desc || source.effect || source.notes, "");
  const damage = displayText(source.damage || source.damage_dice || source.dice || source.formula, "");
  const damageType = displayText(source.damage_type || source.damageType || source.type_damage, "");
  const save = displayText(source.save || source.saving_throw || source.save_ability || source.saveAbility, "");
  const modeRaw = displayText(source.mode || source.spell_mode || source.mechanic, "").toLowerCase();
  const attack = Boolean(source.attack || source.spell_attack || source.requires_attack_roll || /attack|атака/.test(modeRaw));

  return {
    id,
    catalog_id: catalogId,
    external_id: externalId,
    name,
    level: Math.max(0, safeNumber(source.level ?? source.circle ?? source.spell_level, 0)),
    school: displayText(source.school || source.school_name, ""),
    casting_time: castingTime,
    action_type: actionType,
    range: displayText(source.range || source.distance, ""),
    duration: displayText(source.duration, ""),
    components: displayText(source.components, ""),
    description,
    effect: displayText(source.effect || description, ""),
    damage,
    damage_dice: displayText(source.damage_dice || source.damage || source.dice || source.formula, ""),
    damage_type: damageType,
    save,
    save_dc: safeNumber(source.save_dc ?? source.dc, 0),
    attack_bonus: safeNumber(source.attack_bonus ?? source.spell_attack_bonus, 0),
    attack,
    mode: modeRaw || (attack ? "attack" : save ? "save" : "effect"),
    concentration: Boolean(source.concentration),
    ritual: Boolean(source.ritual),
    prepared: isPrepared,
    classes: safeArray(source.classes || source.class_list || source.classList),
    source_kind: displayText(source.source_kind || source.source_type || source.source, "lss"),
    source_name: displayText(source.source_name || source.source, ""),
    source_url: displayText(source.source_url || source.url, ""),
    bridge_confidence: displayText(source.bridge_confidence, ""),
    raw: cloneCombatProfileValue(source, {}),
  };
}

function getLssSpellsSnapshot(profile = {}, raw = {}) {
  const preparedRaw = [
    profile?.spellsMeta?.prepared,
    profile?.spells?.prepared,
    profile?.preparedSpellIds,
    raw?.spellsMeta?.prepared,
    raw?.spells?.prepared,
    profile?.__lssRoot?.spells?.prepared,
  ].find((item) => Array.isArray(item)) || [];
  const bookRaw = [
    profile?.spellsMeta?.book,
    profile?.spells?.book,
    profile?.spellBookIds,
    raw?.spellsMeta?.book,
    raw?.spells?.book,
    profile?.__lssRoot?.spells?.book,
  ].find((item) => Array.isArray(item)) || [];
  const prepared = preparedRaw.map(String);
  const book = bookRaw.map(String);
  const preparedIds = new Set([
    ...prepared,
    ...prepared.map(normalizeMasterSpellLookup),
  ]);

  const candidates = [];
  const append = (value) => {
    if (!value) return;
    if (Array.isArray(value)) value.forEach((item) => candidates.push(item));
  };
  [
    profile.spellCards,
    profile.spellsCards,
    profile?.spellsMeta?.cards,
    profile?.spellsMeta?.preparedExpanded,
    profile?.spellsMeta?.bookExpanded,
    profile?.spellsMeta?.externalResolved,
    profile.preparedSpellsExpanded,
    profile.bookSpellsExpanded,
    profile.spellsExpanded,
    profile.spellbook,
    profile.spellsList,
    profile?.combat_profile?.spells,
    raw.spellCards,
    raw.spellsCards,
    raw?.spellsMeta?.cards,
    raw?.spellsMeta?.preparedExpanded,
    raw?.spellsMeta?.bookExpanded,
    raw?.spellsExpanded,
  ].forEach(append);

  // Only use primitive prepared/book values as a fallback when they are readable
  // names. Original LSS Mongo ObjectIds are preserved for diagnostics but never
  // rendered as fake spell names.
  if (!candidates.length) [...prepared, ...book].forEach((item) => {
    if (!isMasterExternalSpellObjectId(item)) candidates.push(item);
  });

  const merged = new Map();
  candidates.forEach((spell, index) => {
    const normalized = normalizeLssCombatSpell(spell, index, preparedIds);
    if (!normalized) return;
    const lookup = normalizeMasterSpellLookup(normalized.name);
    const key = String(normalized.catalog_id || normalized.external_id || lookup || normalized.id).toLowerCase();
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, normalized);
      return;
    }
    const previousScore = Object.values(previous).filter((value) => value !== "" && value !== null && value !== undefined && value !== false).length;
    const nextScore = Object.values(normalized).filter((value) => value !== "" && value !== null && value !== undefined && value !== false).length;
    merged.set(key, {
      ...(nextScore >= previousScore ? previous : normalized),
      ...(nextScore >= previousScore ? normalized : previous),
      prepared: Boolean(previous.prepared || normalized.prepared),
    });
  });

  return Array.from(merged.values()).sort((a, b) => {
    if (Boolean(a.prepared) !== Boolean(b.prepared)) return a.prepared ? -1 : 1;
    if (safeNumber(a.level, 0) !== safeNumber(b.level, 0)) return safeNumber(a.level, 0) - safeNumber(b.level, 0);
    return String(a.name).localeCompare(String(b.name), "ru");
  });
}
function getLssAttacksSnapshot(profile = {}) {
  const weapons = safeArray(profile.weaponsList || profile.weapons || profile.attacksList);
  return weapons.map((weapon, index) => {
    const source = weapon && typeof weapon === "object" ? weapon : { name: weapon };
    const ability = displayText(source.ability, "str").toLowerCase();
    const abilities = getLssAbilityMap(profile);
    const proficiency = Math.max(0, safeNumber(profile.proficiency || profile.proficiency_bonus, 2));
    const explicit = unwrapCombatProfileValue(source.mod?.value ?? source.mod ?? source.attack_bonus, null);
    const attackBonus = explicit === null || explicit === ""
      ? safeNumber(abilities[ability]?.modifier, 0) + (source.isProf ? proficiency : 0) + safeNumber(unwrapCombatProfileValue(source.modBonus, 0), 0)
      : safeNumber(String(explicit).replace(/[^\d+-]/g, ""), 0);
    return {
      id: String(source.id || source.item_id || `lss-attack-${index}`),
      name: displayName(unwrapCombatProfileValue(source.name, ""), `Атака ${index + 1}`),
      attack_bonus: attackBonus,
      damage: displayText(unwrapCombatProfileValue(source.dmg ?? source.damage, ""), ""),
      damage_type: displayText(source.damage_type || source.type, ""),
      ability,
      proficient: Boolean(source.isProf),
      range: displayText(source.range || source.reach, ""),
      notes: displayText(unwrapCombatProfileValue(source.notes, ""), ""),
      source_kind: "lss",
      raw: cloneCombatProfileValue(source, {}),
    };
  });
}

function getLssFeatureSnapshot(profile = {}) {
  const candidates = [profile.features, profile.class_features, profile.traits, profile.source_grants, profile.grants];
  const list = candidates.find((item) => Array.isArray(item) && item.length) || [];
  const normalized = safeArray(list).map((feature, index) => {
    if (typeof feature === "string") return { id: `feature-${index}`, name: feature, description: "", source_kind: "lss" };
    return {
      id: String(feature?.id || feature?.key || `feature-${index}`),
      name: displayName(feature?.name || feature?.title || feature?.label, `Особенность ${index + 1}`),
      description: displayText(feature?.description || feature?.text || feature?.details, ""),
      action_type: displayText(feature?.action_type || feature?.activation, ""),
      source_kind: displayText(feature?.source_kind || feature?.source, "lss"),
      raw: cloneCombatProfileValue(feature, {}),
    };
  });
  if (displayText(profile.attacks, "")) normalized.push({ id: "lss-features-text", name: "Классовые особенности", description: displayText(profile.attacks, ""), source_kind: "lss" });
  return normalized;
}


const MASTER_COMBAT_SKILL_ABILITY = {
  athletics: "str", "атлетика": "str",
  acrobatics: "dex", "акробатика": "dex",
  sleight_of_hand: "dex", sleight: "dex", "ловкость рук": "dex",
  stealth: "dex", "скрытность": "dex",
  arcana: "int", "магия": "int",
  history: "int", "история": "int",
  investigation: "int", "анализ": "int", "расследование": "int",
  nature: "int", "природа": "int",
  religion: "int", "религия": "int",
  animal_handling: "wis", "уход за животными": "wis",
  insight: "wis", "проницательность": "wis",
  medicine: "wis", "медицина": "wis",
  perception: "wis", "восприятие": "wis",
  survival: "wis", "выживание": "wis",
  deception: "cha", "обман": "cha",
  intimidation: "cha", "запугивание": "cha",
  performance: "cha", "выступление": "cha",
  persuasion: "cha", "убеждение": "cha",
};

const MASTER_ARMOR_NAME_RULES = [
  { re: /(shield|щит)/i, kind: "shield", bonus: 2, label: "Щит" },
  { re: /(studded\s*leather|кл[её]пан(?:ая|ой)?\s+кож)/i, kind: "light", base: 12, label: "Клёпаная кожаная броня" },
  { re: /(padded|ст[её]ган)/i, kind: "light", base: 11, label: "Стёганая броня" },
  { re: /(^|\s)(leather|кожан(?:ая|ой)?\s+брон)/i, kind: "light", base: 11, label: "Кожаная броня" },
  { re: /(half\s*plate|полулат)/i, kind: "medium", base: 15, label: "Полулаты" },
  { re: /(breastplate|кирас)/i, kind: "medium", base: 14, label: "Кираса" },
  { re: /(scale\s*mail|чешуйчат)/i, kind: "medium", base: 14, label: "Чешуйчатый доспех" },
  { re: /(chain\s*shirt|кольчужн(?:ая|ой)\s+рубах)/i, kind: "medium", base: 13, label: "Кольчужная рубаха" },
  { re: /(^|\s)(hide|шкурн)/i, kind: "medium", base: 12, label: "Шкурный доспех" },
  { re: /(plate\s*armor|полный\s+лат|латн(?:ый|ая)|доспехи?\s+латы)/i, kind: "heavy", base: 18, label: "Латы" },
  { re: /(splint|наборн(?:ый|ая)\s+доспех)/i, kind: "heavy", base: 17, label: "Наборный доспех" },
  { re: /(chain\s*mail|кольчужн(?:ый|ая)\s+доспех)/i, kind: "heavy", base: 16, label: "Кольчужный доспех" },
  { re: /(ring\s*mail|кольчат)/i, kind: "heavy", base: 14, label: "Кольчатый доспех" },
];

function normalizeMasterAbilityCode(value, fallback = "str") {
  const raw = displayText(value, fallback).toLowerCase().trim();
  const aliases = {
    str: ["str", "strength", "сила", "сил"],
    dex: ["dex", "dexterity", "ловкость", "лов"],
    con: ["con", "constitution", "телосложение", "тел"],
    int: ["int", "intelligence", "интеллект", "инт"],
    wis: ["wis", "wisdom", "мудрость", "мдр", "муд"],
    cha: ["cha", "charisma", "харизма", "хар"],
  };
  return Object.entries(aliases).find(([, list]) => list.some((item) => raw === item || raw.startsWith(`${item}:`) || raw.startsWith(`${item} `)))?.[0] || fallback;
}

function parseMasterSignedNumber(value, fallback = 0) {
  const direct = unwrapCombatProfileValue(value, null);
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  const match = displayText(direct, "").replace(/\s+/g, "").match(/[+-]?\d+(?:[.,]\d+)?/);
  return match ? safeNumber(match[0].replace(",", "."), fallback) : fallback;
}

function getMasterItemName(item = {}, fallback = "Предмет") {
  return displayName(item?.name || item?.title || item?.item_name || item?.label, fallback);
}

function getMasterItemText(item = {}) {
  return [
    getMasterItemName(item, ""), item?.category, item?.type, item?.item_type, item?.subtype,
    item?.slot, item?.equipment_slot, item?.properties, item?.tags, item?.description, item?.notes,
  ].map((value) => displayText(value, "")).filter(Boolean).join(" ").toLowerCase();
}

function isMasterItemEquipped(item = {}) {
  if (!item || typeof item !== "object") return false;
  if ([item.equipped, item.is_equipped, item.isEquipped, item.worn, item.is_worn].some((value) => value === true || value === 1 || String(value).toLowerCase() === "true")) return true;
  const state = displayText(item.state || item.status || item.location, "").toLowerCase();
  if (/(equipped|worn|надет|экипирован|в руке|основная рука|offhand|mainhand)/i.test(state)) return true;
  return Boolean(displayText(item.equipped_slot || item.equipment_slot || item.worn_slot, ""));
}

function collectMasterEquippedItems(profile = {}, raw = {}, inventory = []) {
  const explicit = [
    profile.equipped_items, profile.equippedItems, profile.equipment_items,
    raw.equipped_items, raw.equippedItems, raw.equipment_items,
  ].find((list) => Array.isArray(list) && list.length) || [];
  const inferred = safeArray(inventory).filter(isMasterItemEquipped);
  const source = [...safeArray(explicit), ...inferred];
  const seen = new Set();
  return source.map((item, index) => cloneCombatProfileValue(item, item)).filter((item, index) => {
    const key = String(item?.id || item?.item_id || item?.uuid || `${getMasterItemName(item, "item")}|${item?.slot || item?.equipment_slot || index}`).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getMasterArmorDescriptor(item = {}) {
  const text = getMasterItemText(item);
  const rule = MASTER_ARMOR_NAME_RULES.find((candidate) => candidate.re.test(text));
  const rawKind = displayText(item.armor_type || item.armour_type || item.weight_class || item.proficiency_type, "").toLowerCase();
  const kind = /(light|л[её]гк)/i.test(rawKind) ? "light"
    : /(medium|средн)/i.test(rawKind) ? "medium"
      : /(heavy|тяж[её]л)/i.test(rawKind) ? "heavy"
        : rule?.kind || "";
  const explicitBase = [item.base_ac, item.ac_base, item.armor_class_base, item.base_armor_class]
    .map((value) => parseMasterSignedNumber(value, 0)).find((value) => value > 0) || 0;
  const directAc = [item.armor_class, item.ac]
    .map((value) => parseMasterSignedNumber(value, 0)).find((value) => value > 0) || 0;
  const explicitBonus = parseMasterSignedNumber(item.ac_bonus ?? item.armor_class_bonus ?? item.defense_bonus, 0);
  const shield = kind === "shield" || /(shield|щит)/i.test(text);
  return {
    item,
    name: getMasterItemName(item),
    kind: shield ? "shield" : kind,
    base: explicitBase || (shield ? 0 : directAc) || safeNumber(rule?.base, 0),
    bonus: shield ? (explicitBonus || directAc || safeNumber(rule?.bonus, 2)) : explicitBonus,
    maxDex: item.max_dex_bonus === null || item.max_dex_bonus === undefined
      ? (kind === "medium" ? 2 : kind === "heavy" ? 0 : null)
      : parseMasterSignedNumber(item.max_dex_bonus, kind === "medium" ? 2 : 0),
    label: rule?.label || getMasterItemName(item),
  };
}

function getMasterEffectText(effect = {}) {
  if (typeof effect === "string") return effect;
  return [effect?.name, effect?.title, effect?.description, effect?.text, effect?.notes, effect?.effect]
    .map((value) => displayText(value, "")).filter(Boolean).join(" ");
}

function readMasterModifierField(source = {}, keys = []) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null && source?.[key] !== "") return parseMasterSignedNumber(source[key], 0);
    if (source?.modifiers?.[key] !== undefined) return parseMasterSignedNumber(source.modifiers[key], 0);
    if (source?.bonuses?.[key] !== undefined) return parseMasterSignedNumber(source.bonuses[key], 0);
    if (source?.stats?.[key] !== undefined) return parseMasterSignedNumber(source.stats[key], 0);
  }
  return 0;
}

function parseMasterEffectModifiers(effect = {}, direction = 1) {
  const source = effect && typeof effect === "object" ? effect : { name: effect };
  const text = getMasterEffectText(source);
  const signed = (value) => {
    const number = parseMasterSignedNumber(value, 0);
    if (!number) return 0;
    return direction < 0 && number > 0 ? -number : number;
  };
  const regexSigned = (patterns = []) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return signed(match[1]);
    }
    return 0;
  };
  const direct = {
    ac: signed(readMasterModifierField(source, ["ac_bonus", "armor_class_bonus", "ac", "armor_class"])),
    speed: signed(readMasterModifierField(source, ["speed_bonus", "movement_bonus", "speed", "movement"])),
    initiative: signed(readMasterModifierField(source, ["initiative_bonus", "initiative"])),
    attack: signed(readMasterModifierField(source, ["attack_bonus", "to_hit_bonus", "hit_bonus"])),
    damage: signed(readMasterModifierField(source, ["damage_bonus", "weapon_damage_bonus"])),
    spell_attack: signed(readMasterModifierField(source, ["spell_attack_bonus", "spell_hit_bonus"])),
    save_dc: signed(readMasterModifierField(source, ["save_dc_bonus", "spell_save_dc_bonus", "dc_bonus"])),
  };
  if (!direct.ac) direct.ac = regexSigned([/(?:\bAC\b|КД)\s*([+-]\s*\d+)/i]);
  if (!direct.speed) direct.speed = regexSigned([/(?:скорост\w*|movement|speed)\s*([+-]\s*\d+)/i]);
  if (!direct.initiative) direct.initiative = regexSigned([/(?:инициатив\w*|initiative)\s*([+-]\s*\d+)/i]);
  if (!direct.attack) direct.attack = regexSigned([/(?:бонус\s+атак\w*|attack(?:\s+roll)?s?)\s*([+-]\s*\d+)/i]);
  if (!direct.damage) direct.damage = regexSigned([/(?:урон\w*|damage)\s*([+-]\s*\d+)/i]);
  if (!direct.spell_attack) direct.spell_attack = regexSigned([/(?:атака\s+заклинани\w*|spell\s+attack)\s*([+-]\s*\d+)/i]);
  if (!direct.save_dc) direct.save_dc = regexSigned([/(?:Сл|DC)\s*([+-]\s*\d+)/i]);
  return direct;
}

function collectMasterEffectModifiers(buffs = [], debuffs = []) {
  const total = { ac: 0, speed: 0, initiative: 0, attack: 0, damage: 0, spell_attack: 0, save_dc: 0 };
  const sources = [];
  const consume = (effect, direction, kind) => {
    const mods = parseMasterEffectModifiers(effect, direction);
    const applied = Object.entries(mods).filter(([, value]) => value !== 0);
    if (!applied.length) return;
    applied.forEach(([key, value]) => { total[key] += value; });
    sources.push({ name: displayName(effect?.name || effect?.title || effect, kind === "debuff" ? "Дебафф" : "Бафф"), kind, modifiers: mods });
  };
  safeArray(buffs).forEach((effect) => consume(effect, 1, "buff"));
  safeArray(debuffs).forEach((effect) => consume(effect, -1, "debuff"));
  return { total, sources };
}

function normalizeMasterSavingThrows(profile = {}, abilities = {}, proficiencyBonus = 2) {
  const source = profile.saves && typeof profile.saves === "object" ? profile.saves : {};
  const profText = displayText(profile.saving_throw_proficiencies || profile.save_proficiencies || profile.proficiencies?.saves, "").toLowerCase();
  const out = {};
  Object.keys(abilities).forEach((code) => {
    const aliases = { str: ["str", "strength", "сила"], dex: ["dex", "dexterity", "ловкость"], con: ["con", "constitution", "телосложение"], int: ["int", "intelligence", "интеллект"], wis: ["wis", "wisdom", "мудрость"], cha: ["cha", "charisma", "харизма"] }[code] || [code];
    const rawSave = aliases.map((key) => source[key]).find((value) => value !== undefined);
    const saveObject = rawSave && typeof rawSave === "object" ? rawSave : {};
    const explicit = rawSave === undefined ? null : parseMasterSignedNumber(saveObject.total ?? saveObject.value ?? saveObject.modifier ?? saveObject.bonus ?? rawSave, null);
    const proficient = Boolean(saveObject.proficient ?? saveObject.isProf ?? saveObject.is_proficient) || aliases.some((key) => profText.includes(key));
    const abilityMod = safeNumber(abilities[code]?.modifier, 0);
    out[code] = {
      total: explicit === null ? abilityMod + (proficient ? proficiencyBonus : 0) : safeNumber(explicit, abilityMod),
      proficient,
      ability: code,
    };
  });
  return out;
}

function normalizeMasterSkills(profile = {}, abilities = {}, proficiencyBonus = 2) {
  const source = profile.skills && typeof profile.skills === "object" ? profile.skills : {};
  const out = {};
  Object.entries(source).forEach(([key, value]) => {
    const normalizedKey = key.toLowerCase().trim();
    const skill = value && typeof value === "object" ? value : {};
    const ability = normalizeMasterAbilityCode(skill.ability || MASTER_COMBAT_SKILL_ABILITY[normalizedKey] || "wis", "wis");
    const proficient = Boolean(skill.proficient ?? skill.isProf ?? skill.is_proficient);
    const expertise = Boolean(skill.expertise ?? skill.isExpertise);
    const explicit = parseMasterSignedNumber(skill.total ?? skill.value ?? skill.modifier ?? skill.bonus ?? value, null);
    const base = safeNumber(abilities[ability]?.modifier, 0) + (proficient ? proficiencyBonus : 0) + (expertise ? proficiencyBonus : 0);
    out[key] = { total: explicit === null ? base : safeNumber(explicit, base), ability, proficient, expertise };
  });
  return out;
}

function looksLikeMasterWeapon(item = {}) {
  const text = getMasterItemText(item);
  return Boolean(item.damage || item.dmg || item.damage_dice || item.weapon_damage || item.attack_bonus || item.to_hit)
    || /(weapon|оруж|меч|лук|арбалет|кинжал|топор|молот|булав|копь|посох|рапир|дубин|sword|bow|crossbow|dagger|axe|mace|spear|staff)/i.test(text);
}

function buildMasterItemAttack(item = {}, index = 0, abilities = {}, proficiencyBonus = 2, effectModifiers = {}) {
  if (!looksLikeMasterWeapon(item)) return null;
  const text = getMasterItemText(item);
  const ranged = /(ranged|дальнобойн|лук|арбалет|bow|crossbow)/i.test(text);
  const finesse = /(finesse|фехтовальн|рапир|кинжал|rapier|dagger)/i.test(text);
  const ability = normalizeMasterAbilityCode(item.ability || item.attack_ability || (ranged || finesse ? "dex" : "str"), ranged || finesse ? "dex" : "str");
  const proficient = item.proficient === false || item.isProf === false ? false : true;
  const explicitAttack = item.attack_bonus ?? item.to_hit ?? item.hit_bonus ?? item.mod?.value ?? item.mod;
  const abilityMod = safeNumber(abilities[ability]?.modifier, 0);
  const attackBonus = explicitAttack === undefined || explicitAttack === null || explicitAttack === ""
    ? abilityMod + (proficient ? proficiencyBonus : 0) + safeNumber(effectModifiers.attack, 0)
    : parseMasterSignedNumber(explicitAttack, abilityMod + (proficient ? proficiencyBonus : 0)) + safeNumber(effectModifiers.attack, 0);
  const damage = displayText(item.damage_dice || item.weapon_damage || item.dmg || item.damage, "");
  return {
    id: String(item.id || item.item_id || item.uuid || `equipment-attack-${index}`),
    name: getMasterItemName(item, `Оружие ${index + 1}`),
    attack_bonus: attackBonus,
    damage: damage || String(Math.max(1, 1 + abilityMod + safeNumber(effectModifiers.damage, 0))),
    damage_type: displayText(item.damage_type || item.weapon_damage_type, ""),
    ability,
    proficient,
    range: displayText(item.range || item.reach, ranged ? "дальняя" : "5 фт."),
    notes: displayText(item.notes || item.description, ""),
    source_kind: "equipment",
    item_id: item.id || item.item_id || null,
    raw: cloneCombatProfileValue(item, {}),
  };
}

function mergeMasterCombatAttacks(existing = [], equippedItems = [], abilities = {}, proficiencyBonus = 2, effectModifiers = {}) {
  const source = [...safeArray(existing)];
  safeArray(equippedItems).forEach((item, index) => {
    const attack = buildMasterItemAttack(item, index, abilities, proficiencyBonus, effectModifiers);
    if (attack) source.push(attack);
  });
  if (!source.length) {
    const strength = safeNumber(abilities.str?.modifier, 0);
    source.push({
      id: "unarmed-strike",
      name: "Безоружный удар",
      attack_bonus: strength + proficiencyBonus + safeNumber(effectModifiers.attack, 0),
      damage: String(Math.max(1, 1 + strength + safeNumber(effectModifiers.damage, 0))),
      damage_type: "дробящий",
      ability: "str",
      proficient: true,
      range: "5 фт.",
      source_kind: "rules",
    });
  }
  const seen = new Set();
  return source.map((attack, index) => {
    const item = attack && typeof attack === "object" ? { ...attack } : { name: displayText(attack, `Атака ${index + 1}`) };
    const key = `${displayText(item.id, "")}|${displayText(item.name, "")}|${displayText(item.damage || item.damage_dice, "")}`.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    if (item.attack_bonus !== undefined) item.attack_bonus = safeNumber(item.attack_bonus, 0) + (item.source_kind === "equipment" ? 0 : safeNumber(effectModifiers.attack, 0));
    return item;
  }).filter(Boolean);
}

function resolveMasterLssCombatProfile(base = {}, profile = {}, raw = {}) {
  const abilities = base.abilities || getLssAbilityMap(profile);
  const dexMod = safeNumber(abilities.dex?.modifier, 0);
  const proficiencyBonus = Math.max(0, safeNumber(base.proficiency_bonus, 2));
  const inventory = safeArray(base.inventory);
  const equippedItems = collectMasterEquippedItems(profile, raw, inventory);
  const armor = equippedItems.map(getMasterArmorDescriptor);
  const bodyArmor = armor.filter((item) => item.kind && item.kind !== "shield" && item.base > 0)
    .map((item) => {
      const dexContribution = item.kind === "heavy" ? 0 : item.maxDex === null ? dexMod : Math.min(dexMod, item.maxDex);
      return { ...item, total: item.base + dexContribution };
    })
    .sort((a, b) => b.total - a.total)[0] || null;
  const shield = armor.filter((item) => item.kind === "shield").sort((a, b) => b.bonus - a.bonus)[0] || null;
  const passiveAcItems = armor.filter((item) => item.kind !== "shield" && !item.base && item.bonus)
    .reduce((sum, item) => sum + safeNumber(item.bonus, 0), 0);
  const unarmoredAc = 10 + dexMod;
  const equipmentAc = (bodyArmor ? bodyArmor.total : unarmoredAc) + safeNumber(shield?.bonus, 0) + passiveAcItems;
  const explicitAcRaw = profile.ac ?? raw.ac ?? profile.armor_class ?? raw.armor_class ?? profile.vitality?.ac ?? raw.vitality?.ac;
  const explicitAc = explicitAcRaw === undefined || explicitAcRaw === null || explicitAcRaw === "" ? 0 : Math.max(0, parseMasterSignedNumber(explicitAcRaw, 0));
  const effects = collectMasterEffectModifiers(base.buffs, base.debuffs);
  const baseAc = Math.max(unarmoredAc, equipmentAc, explicitAc || 0);
  const finalAc = Math.max(0, baseAc + safeNumber(effects.total.ac, 0));
  const explicitSpeed = Math.max(0, safeNumber(base.speed, 30));
  const finalSpeed = Math.max(0, explicitSpeed + safeNumber(effects.total.speed, 0));
  const explicitInitiativeRaw = profile.initiative ?? raw.initiative ?? profile.vitality?.initiative ?? raw.vitality?.initiative;
  const initiativeBase = explicitInitiativeRaw === undefined || explicitInitiativeRaw === null || explicitInitiativeRaw === ""
    ? dexMod
    : parseMasterSignedNumber(explicitInitiativeRaw, dexMod);
  const finalInitiative = initiativeBase + safeNumber(effects.total.initiative, 0);
  const spellAbility = normalizeMasterAbilityCode(base.spellcasting?.ability || profile?.spellsInfo?.base?.code || profile?.spellcasting?.ability || "int", "int");
  const spellModifier = safeNumber(abilities[spellAbility]?.modifier, 0);
  const explicitSpellAttack = base.spellcasting?.attack_bonus ?? base.spellcasting?.spell_attack;
  const explicitSaveDc = base.spellcasting?.save_dc ?? base.spellcasting?.spell_save_dc;
  const spellcasting = {
    ...cloneCombatProfileValue(base.spellcasting, {}),
    ability: spellAbility,
    attack_bonus: (explicitSpellAttack === undefined || explicitSpellAttack === null || explicitSpellAttack === ""
      ? spellModifier + proficiencyBonus
      : parseMasterSignedNumber(explicitSpellAttack, spellModifier + proficiencyBonus)) + safeNumber(effects.total.spell_attack, 0),
    save_dc: (explicitSaveDc === undefined || explicitSaveDc === null || explicitSaveDc === ""
      ? 8 + spellModifier + proficiencyBonus
      : parseMasterSignedNumber(explicitSaveDc, 8 + spellModifier + proficiencyBonus)) + safeNumber(effects.total.save_dc, 0),
  };
  const saves = normalizeMasterSavingThrows({ ...profile, saves: base.saves }, abilities, proficiencyBonus);
  const skills = normalizeMasterSkills({ ...profile, skills: base.skills }, abilities, proficiencyBonus);
  const attacks = mergeMasterCombatAttacks(base.attacks, equippedItems, abilities, proficiencyBonus, effects.total);
  const warnings = [];
  if (!equippedItems.length) warnings.push("Не найдены предметы со статусом «экипировано»: КД рассчитан от явного значения LSS или 10 + Ловкость.");
  if (!bodyArmor && explicitAc <= 10) warnings.push("Броня не распознана; используется бездоспешный КД.");
  if (!safeArray(base.spells).length) warnings.push("В боевом профиле нет развёрнутых заклинаний LSS.");
  const acSources = [
    { label: "Без брони", value: unarmoredAc },
    bodyArmor ? { label: bodyArmor.label, value: bodyArmor.total } : null,
    shield ? { label: shield.label, value: shield.bonus, additive: true } : null,
    passiveAcItems ? { label: "Прочие предметы", value: passiveAcItems, additive: true } : null,
    explicitAc ? { label: "Явный КД LSS", value: explicitAc } : null,
    effects.total.ac ? { label: "Баффы/дебаффы", value: effects.total.ac, additive: true } : null,
  ].filter(Boolean);
  return {
    ...base,
    ac: finalAc,
    speed: finalSpeed,
    initiative: finalInitiative,
    saves,
    skills,
    attacks,
    spellcasting,
    equipped_items: equippedItems,
    combat_profile: {
      version: "round50",
      resolved_at: new Date().toISOString(),
      final: {
        ac: finalAc,
        speed: finalSpeed,
        initiative: finalInitiative,
        proficiency_bonus: proficiencyBonus,
        spell_attack: spellcasting.attack_bonus,
        spell_save_dc: spellcasting.save_dc,
      },
      armor: {
        unarmored_ac: unarmoredAc,
        explicit_ac: explicitAc || null,
        body: bodyArmor ? { name: bodyArmor.name, kind: bodyArmor.kind, base: bodyArmor.base, total: bodyArmor.total } : null,
        shield: shield ? { name: shield.name, bonus: shield.bonus } : null,
        sources: acSources,
      },
      effects,
      attacks: attacks.map((attack) => ({ id: attack.id, name: attack.name, attack_bonus: attack.attack_bonus, damage: attack.damage || attack.damage_dice, damage_type: attack.damage_type, source_kind: attack.source_kind })),
      equipped_items: equippedItems.map((item) => ({ id: item.id || item.item_id || null, name: getMasterItemName(item), slot: displayText(item.slot || item.equipment_slot || item.equipped_slot, "") })),
      warnings,
    },
  };
}

function getLssSnapshot() {
  const profile = getLssProfile?.() || {};
  const raw = getLssRaw?.() || {};
  const info = profile.info || raw.info || {};
  const vitality = profile.vitality || raw.vitality || {};
  const hp = profile.hp || raw.hp || {};
  const abilities = getLssAbilityMap(profile);
  const proficiencyBonus = Math.max(0, safeNumber(unwrapCombatProfileValue(profile.proficiency ?? profile.proficiency_bonus, 2), 2));
  const spellAbility = normalizeMasterAbilityCode(profile?.spellsInfo?.base?.code || profile?.spellcasting?.ability, "int");
  const spellModifier = safeNumber(abilities[spellAbility]?.modifier, 0);
  const sheet = cloneCombatProfileValue(Object.keys(profile).length ? profile : raw, {});
  const inventory = safeArray(profile.inventory || profile.items || raw.inventory || raw.items).map((item) => cloneCombatProfileValue(item, item));
  const equippedItems = collectMasterEquippedItems(profile, raw, inventory);
  const buffs = safeArray(profile.buffs || profile.effects || raw.buffs || raw.effects).map((item) => cloneCombatProfileValue(item, item));
  const debuffs = safeArray(profile.debuffs || raw.debuffs).map((item) => cloneCombatProfileValue(item, item));
  const hpCurrent = safeNumber(unwrapCombatProfileValue(profile.hp_current ?? raw.hp_current ?? hp.current ?? vitality["hp-current"], 10), 10);
  const hpMax = Math.max(1, safeNumber(unwrapCombatProfileValue(profile.hp_max ?? raw.hp_max ?? hp.max ?? vitality["hp-max"], 10), 10));
  const speed = Math.max(0, safeNumber(unwrapCombatProfileValue(profile.speed ?? raw.speed ?? vitality.speed, 30), 30));
  const initiative = safeNumber(unwrapCombatProfileValue(profile.initiative ?? raw.initiative ?? vitality.initiative, abilities.dex?.modifier || 0), abilities.dex?.modifier || 0);
  const ac = Math.max(0, safeNumber(unwrapCombatProfileValue(profile.ac ?? raw.ac ?? profile.armor_class ?? raw.armor_class ?? vitality.ac, 0), 0));
  const spells = getLssSpellsSnapshot(profile, raw);
  const base = {
    name: displayText(profile.name || raw.name || unwrapCombatProfileValue(info.name, ""), ""),
    class_name: displayText(profile.class_name || raw.class_name || unwrapCombatProfileValue(info.class || info.class_name || info.charClass, ""), ""),
    subclass: displayText(profile.subclass || raw.subclass || unwrapCombatProfileValue(info.subclass || info.charSubclass, ""), ""),
    race: displayText(profile.race || raw.race || unwrapCombatProfileValue(info.race, ""), ""),
    subrace: displayText(profile.subrace || raw.subrace || unwrapCombatProfileValue(info.subrace, ""), ""),
    level: Math.max(1, safeNumber(unwrapCombatProfileValue(profile.level || raw.level || info.level, 1), 1)),
    portrait_url: displayText(profile.portrait_url || raw.portrait_url || profile.avatar_url || raw.avatar_url || profile.portrait, ""),
    hp_current: Math.max(0, Math.min(hpCurrent, hpMax)),
    hp_max: hpMax,
    temp_hp: Math.max(0, safeNumber(unwrapCombatProfileValue(profile.temp_hp ?? vitality["hp-temp"], 0), 0)),
    ac,
    speed,
    initiative,
    proficiency_bonus: proficiencyBonus,
    abilities,
    saves: cloneCombatProfileValue(profile.saves || raw.saves, {}),
    skills: cloneCombatProfileValue(profile.skills || raw.skills, {}),
    attacks: getLssAttacksSnapshot(profile),
    spells,
    spell_slots: getLssSpellSlotsSnapshot(profile, raw),
    spells_meta: cloneCombatProfileValue(profile?.spellsMeta || raw?.spellsMeta, {}),
    spellcasting: {
      ability: spellAbility,
      attack_bonus: spellModifier + proficiencyBonus,
      save_dc: 8 + spellModifier + proficiencyBonus,
    },
    features: getLssFeatureSnapshot(profile),
    inventory,
    equipped_items: equippedItems,
    buffs,
    debuffs,
    conditions: safeArray(profile.conditions || profile.statuses || raw.conditions),
    resistances: safeArray(profile.resistances || raw.resistances),
    vulnerabilities: safeArray(profile.vulnerabilities || raw.vulnerabilities),
    immunities: safeArray(profile.immunities || raw.immunities),
    sheet,
  };
  return resolveMasterLssCombatProfile(base, profile, raw);
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

function extractBestiaryBridgeEntries(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== "object") return [];

  const directKeys = ["entries", "items", "results", "data", "monsters", "creatures", "list"];
  for (const key of directKeys) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      const nested = extractBestiaryBridgeEntries(value);
      if (nested.length) return nested;
    }
  }

  for (const value of Object.values(payload)) {
    if (Array.isArray(value) && value.some((item) => item && typeof item === "object")) return value;
  }

  return [];
}

function getBestiaryBridgeStatusText() {
  const count = safeArray(MASTER_ROOM_STATE.ui.bestiaryBridgeEntries).length;
  if (MASTER_ROOM_STATE.ui.bestiaryBridgeLoading) return `загружаю seed монстров… ${count ? `${count} уже есть` : ""}`.trim();
  if (MASTER_ROOM_STATE.ui.bestiaryBridgeLoaded) return `bridge активен: ${count} записей`;
  if (MASTER_ROOM_STATE.ui.bestiaryBridgeError) return `bridge ошибка: ${MASTER_ROOM_STATE.ui.bestiaryBridgeError}`;
  return "bridge ещё не загружен";
}

function publishBestiaryBridgeEntries(entries = [], source = "") {
  const list = safeArray(entries).filter((entry) => entry && typeof entry === "object");
  MASTER_ROOM_STATE.ui.bestiaryBridgeEntries = list;
  MASTER_ROOM_STATE.ui.bestiaryBridgeLoaded = Boolean(list.length);
  MASTER_ROOM_STATE.ui.bestiaryBridgeLoading = false;
  MASTER_ROOM_STATE.ui.bestiaryBridgeError = list.length ? "" : (MASTER_ROOM_STATE.ui.bestiaryBridgeError || "пустой seed");
  MASTER_ROOM_STATE.ui.bestiaryBridgeSource = source || MASTER_ROOM_STATE.ui.bestiaryBridgeSource || "runtime";
  try {
    window.__dndTraderMasterRoomBestiaryPool = list;
    window.__masterRoomBestiaryMonsterPool = list;
  } catch (_) {}
  return list;
}

async function loadBestiaryBridgeEntries(options = {}) {
  if (MASTER_ROOM_STATE.ui.bestiaryBridgeLoaded && safeArray(MASTER_ROOM_STATE.ui.bestiaryBridgeEntries).length) {
    return MASTER_ROOM_STATE.ui.bestiaryBridgeEntries;
  }
  if (MASTER_ROOM_STATE.ui.bestiaryBridgePromise) return MASTER_ROOM_STATE.ui.bestiaryBridgePromise;

  MASTER_ROOM_STATE.ui.bestiaryBridgeLoading = true;
  MASTER_ROOM_STATE.ui.bestiaryBridgeError = "";

  const promise = (async () => {
    for (const url of MASTER_ROOM_BESTIARY_BRIDGE_URLS) {
      try {
        const res = await fetch(url, { cache: "default" });
        if (!res.ok) continue;
        const payload = await res.json();
        const entries = extractBestiaryBridgeEntries(payload);
        const monsters = dedupeMonsterEntries(entries);
        if (monsters.length) {
          publishBestiaryBridgeEntries(monsters, url);
          if (options.toast !== false) showToast(`Пул монстров загружен: ${monsters.length}`);
          return monsters;
        }
      } catch (err) {
        MASTER_ROOM_STATE.ui.bestiaryBridgeError = err?.message || "не удалось прочитать seed";
      }
    }

    MASTER_ROOM_STATE.ui.bestiaryBridgeLoading = false;
    MASTER_ROOM_STATE.ui.bestiaryBridgeLoaded = false;
    MASTER_ROOM_STATE.ui.bestiaryBridgeError = MASTER_ROOM_STATE.ui.bestiaryBridgeError || "seed не найден";
    if (options.toast !== false) showToast("Пул монстров не загрузился: seed Бестиария не найден");
    return [];
  })();

  MASTER_ROOM_STATE.ui.bestiaryBridgePromise = promise;
  try {
    const result = await promise;
    return result;
  } finally {
    MASTER_ROOM_STATE.ui.bestiaryBridgePromise = null;
    MASTER_ROOM_STATE.ui.bestiaryBridgeLoading = false;
    if (options.renderWhenDone) renderMasterRoomStable(options.focusSelector || "#masterRuntimeEnemySearch");
  }
}

function queueBestiaryBridgeLoad(options = {}) {
  if (MASTER_ROOM_STATE.ui.bestiaryBridgeLoaded || MASTER_ROOM_STATE.ui.bestiaryBridgeLoading) return;
  window.setTimeout(() => {
    loadBestiaryBridgeEntries({ renderWhenDone: true, toast: false, ...options }).catch((err) => {
      MASTER_ROOM_STATE.ui.bestiaryBridgeLoading = false;
      MASTER_ROOM_STATE.ui.bestiaryBridgeError = err?.message || "ошибка загрузки";
      renderMasterRoomStable(options.focusSelector || "#masterRuntimeEnemySearch");
    });
  }, 0);
}

function getKnownBestiaryEntries() {
  const pushUnique = (target, value) => {
    const list = Array.isArray(value) ? value : Array.isArray(value?.entries) ? value.entries : Array.isArray(value?.items) ? value.items : [];
    list.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") return;
      const id = getBestiaryEntryId(entry, index);
      if (!target.some((item, itemIndex) => getBestiaryEntryId(item, itemIndex) === id)) target.push(entry);
    });
  };

  const out = [];
  pushUnique(out, MASTER_ROOM_STATE.ui.bestiaryBridgeEntries);
  try { pushUnique(out, window.__dndTraderMasterRoomBestiaryPool); } catch (_) {}
  try { pushUnique(out, window.__masterRoomBestiaryMonsterPool); } catch (_) {}
  try {
    const state = getCodexState?.();
    pushUnique(out, state?.entries || state);
  } catch (_) {}

  [
    window.__appStateBestiary,
    window.__appBestiaryEntries,
    window.__appState?.bestiary,
    window.__appState?.bestiary?.entries,
    window.__appState?.codex,
    window.__appState?.codex?.entries,
    window.__sharedState?.bestiary,
    window.__sharedState?.codex,
  ].forEach((candidate) => pushUnique(out, candidate));

  try {
    const user = getCurrentUser();
    const suffix = user?.id || user?.email || user?.nickname || "guest";
    [
      `dnd_trader_bestiary_${suffix}`,
      `dnd_trader_bestiari_${suffix}`,
      `dnd_trader_codex_${suffix}`,
      "dnd_trader_bestiary",
      "dnd_trader_bestiari",
      "dnd_trader_codex",
    ].forEach((key) => pushUnique(out, tryParseJson(localStorage.getItem(key))));

    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i) || "";
      const lower = key.toLowerCase();
      if (!lower.includes("bestiary") && !lower.includes("bestiari") && !lower.includes("codex")) continue;
      pushUnique(out, tryParseJson(localStorage.getItem(key)));
      if (out.length > 1000) break;
    }
  } catch (_) {}

  return out;
}

function isProbablyMonsterEntry(entry = {}) {
  const category = displayText(entry.category || entry.type || entry.creature_type, "").toLowerCase();
  const source = displayText(entry.source || entry.source_name || entry.book || "", "").toLowerCase();
  const title = displayText(entry.title || entry.name || entry.label, "").toLowerCase();
  const tags = safeArray(entry.tags).map((tag) => displayText(tag, "").toLowerCase());
  const monsterWords = ["monster", "monsters", "creature", "creatures", "npc", "enemy", "beast", "undead", "humanoid", "монстр", "монстры", "существо", "существа", "враг", "нпс", "зверь", "нежить", "гуманоид"];
  const blockedWords = [
    "spell", "spells", "item", "items", "weapon", "armor", "feat", "background", "class", "race", "mechanic", "mechanics", "rule", "rules", "god", "gods", "deity", "pantheon",
    "заклин", "предмет", "оруж", "брон", "черта", "класс", "раса", "механик", "правил", "бог", "боги", "бож", "пантеон",
  ];
  const hasMonsterWord = [category, source, title, ...tags].some((part) => monsterWords.some((word) => part.includes(word)));
  const hasBlockedWord = [category, source, ...tags].some((part) => blockedWords.some((word) => part.includes(word)));
  if (hasBlockedWord && !hasMonsterWord) return false;
  if (hasMonsterWord) return true;

  const statSources = [entry, entry.stats, entry.statblock, entry.monster_data, entry.creature_data, entry.mechanics].filter(Boolean);
  const hasStatblock = Boolean(entry.statblock || entry.monster_data || entry.creature_data || entry.challenge || entry.cr || entry.challenge_rating);
  const hasCombatStats = statSources.some((sourceObj) => [sourceObj.hp, sourceObj.hit_points, sourceObj.hp_max, sourceObj.ac, sourceObj.armor_class, sourceObj.speed, sourceObj.actions, sourceObj.attacks, sourceObj.senses, sourceObj.challenge, sourceObj.cr]
    .some((value) => value !== undefined && value !== null && value !== ""));
  return hasStatblock || hasCombatStats;
}

function getBestiaryMonsterDedupeKey(entry = {}, index = 0) {
  const summary = buildBestiaryCombatSummary(entry || {});
  return [
    displayText(summary.name || getBestiaryEntryName(entry, `monster_${index}`), "").toLowerCase().replace(/\s+/g, " ").trim(),
    safeNumber(summary.ac, 0),
    safeNumber(summary.hp, 0),
    safeNumber(summary.speed, 0),
    displayText(summary.challenge, "").toLowerCase(),
  ].join("|");
}

function dedupeMonsterEntries(entries = []) {
  const seen = new Set();
  const out = [];
  safeArray(entries).forEach((entry, index) => {
    if (!isProbablyMonsterEntry(entry)) return;
    const key = getBestiaryMonsterDedupeKey(entry, index);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  });
  return out;
}

function getKnownMonsterEntries() {
  return dedupeMonsterEntries(getKnownBestiaryEntries());
}

function stripCombatCloneSuffix(name = "") {
  return displayText(name, "").replace(/\s+#\d+$/u, "").trim();
}

function makeCombatCloneName(table, baseName = "Монстр", sourceId = "") {
  const combat = normalizeCombat(table?.combat, table);
  const base = stripCombatCloneSuffix(baseName) || "Монстр";
  const same = safeArray(combat.entries).filter((entry) => {
    const sameSource = sourceId && String(entry.bestiary_id || entry.source_id || "") === String(sourceId);
    return sameSource || stripCombatCloneSuffix(entry.name).toLowerCase() === base.toLowerCase();
  });
  return same.length ? `${base} #${same.length + 1}` : base;
}

function getBestiaryEntryId(entry = {}, index = 0) {
  return String(entry.id || entry.entry_id || entry.slug || entry.url || entry.title || entry.name || `bestiary_${index}`);
}

function getBestiaryEntryName(entry = {}, fallback = "Монстр") {
  return displayName(entry.title || entry.name || entry.label, fallback);
}

function readNumberLike(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "object") {
    const direct = value.value ?? value.current ?? value.max ?? value.total ?? value.amount ?? value.number ?? value.base;
    if (direct !== undefined && direct !== value) return readNumberLike(direct, fallback);
    const nested = value.hp ?? value.ac ?? value.speed ?? value.initiative;
    if (nested !== undefined && nested !== value) return readNumberLike(nested, fallback);
  }
  const text = displayText(value, "");
  const match = text.match(/-?\d+/);
  return match ? safeNumber(match[0], fallback) : fallback;
}

function pickBestiaryValue(entry = {}, paths = [], fallback = "") {
  for (const path of paths) {
    const parts = String(path).split(".").filter(Boolean);
    let cur = entry;
    let ok = true;
    for (const part of parts) {
      if (!cur || typeof cur !== "object" || !(part in cur)) {
        ok = false;
        break;
      }
      cur = cur[part];
    }
    if (ok && cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return fallback;
}

function extractBestiaryList(entry = {}, paths = [], limit = 8) {
  const out = [];
  const push = (value) => {
    if (out.length >= limit) return;
    if (value === null || value === undefined || value === "") return;
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (typeof value === "object") {
      const title = value.name || value.title || value.label || value.action || value.attack || value.trait || value.feature;
      const note = value.summary || value.description || value.text || value.value || value.damage || value.effect;
      const text = [displayText(title, ""), displayText(note, "")].filter(Boolean).join(" — ");
      if (text) push(text);
      return;
    }
    const text = clampText(value, 90);
    if (text && !out.some((item) => item.toLowerCase() === text.toLowerCase())) out.push(text);
  };
  paths.forEach((path) => push(pickBestiaryValue(entry, [path], "")));
  return out.slice(0, limit);
}

function buildBestiaryCombatSummary(entry = {}) {
  const stats = entry?.stats || entry?.statblock || entry?.monster_data || entry?.creature_data || entry?.mechanics || {};
  const hpRaw = pickBestiaryValue(entry, ["hp", "hit_points", "hp_max", "stats.hp", "statblock.hp", "monster_data.hp", "mechanics.hp"], stats.hp || "");
  const hp = Math.max(1, readNumberLike(hpRaw, 10));
  const ac = Math.max(0, readNumberLike(pickBestiaryValue(entry, ["ac", "armor_class", "stats.ac", "stats.armor_class", "statblock.ac", "monster_data.ac", "mechanics.ac"], stats.ac ?? stats.armor_class), 10));
  const speed = Math.max(0, readNumberLike(pickBestiaryValue(entry, ["speed", "movement", "stats.speed", "statblock.speed", "monster_data.speed", "mechanics.speed"], stats.speed), 30));
  const initiative = readNumberLike(pickBestiaryValue(entry, ["initiative", "stats.initiative", "statblock.initiative", "dex_mod", "stats.dex_mod"], stats.initiative), 0);
  const challenge = displayText(pickBestiaryValue(entry, ["challenge", "cr", "challenge_rating", "stats.challenge", "statblock.cr", "monster_data.cr"], ""), "");
  const type = displayText(pickBestiaryValue(entry, ["creature_type", "type", "category", "stats.type", "statblock.type", "monster_data.type"], ""), "");
  const size = displayText(pickBestiaryValue(entry, ["size", "stats.size", "statblock.size", "monster_data.size"], ""), "");
  const alignment = displayText(pickBestiaryValue(entry, ["alignment", "stats.alignment", "statblock.alignment"], ""), "");
  const senses = extractBestiaryList(entry, ["senses", "stats.senses", "statblock.senses", "monster_data.senses", "mechanics.senses"], 4);
  const attacks = extractBestiaryList(entry, ["attacks", "actions", "stats.actions", "statblock.actions", "monster_data.actions", "mechanics.actions"], 6);
  const traits = extractBestiaryList(entry, ["traits", "features", "special_traits", "stats.traits", "statblock.traits", "monster_data.traits", "mechanics.traits", "mechanics.features"], 6);
  const saves = extractBestiaryList(entry, ["saves", "saving_throws", "stats.saves", "statblock.saves", "mechanics.saves"], 4);
  const skills = extractBestiaryList(entry, ["skills", "stats.skills", "statblock.skills", "mechanics.skills"], 5);
  return {
    id: getBestiaryEntryId(entry),
    name: getBestiaryEntryName(entry),
    type,
    size,
    alignment,
    hp,
    hp_raw: displayText(hpRaw, ""),
    ac,
    speed,
    initiative,
    challenge,
    senses,
    attacks,
    traits,
    saves,
    skills,
    source: displayText(entry.source || entry.source_name || entry.source_title || entry.book || entry.category, "Бестиарий"),
  };
}

function renderBestiaryChip(label, value = "") {
  const text = value ? `${label}: ${value}` : label;
  return `<span class="master-runtime-bestiary-chip">${escapeHtml(text)}</span>`;
}

function renderBestiaryMonsterSummary(entry) {
  if (!entry) {
    return `
      <section class="master-runtime-bestiary-summary master-runtime-empty">
        <div class="master-runtime-bestiary-summary-head">
          <div><h4>Монстр не выбран</h4><small>Открой Бестиарий или выбери запись из списка.</small></div>
        </div>
        <div class="master-runtime-bestiary-summary-actions">
          <button class="btn" type="button" data-master-runtime-action="open-bestiary">Открыть Бестиарий</button>
        </div>
      </section>
    `;
  }
  const summary = buildBestiaryCombatSummary(entry);
  const meta = [summary.size, summary.type, summary.alignment, summary.challenge ? `CR ${summary.challenge}` : ""].filter(Boolean).join(" • ");
  const chips = [
    ...summary.attacks.slice(0, 4).map((item) => renderBestiaryChip("Атака", item)),
    ...summary.traits.slice(0, 4).map((item) => renderBestiaryChip("Особенность", item)),
    ...summary.senses.slice(0, 2).map((item) => renderBestiaryChip("Чувства", item)),
    ...summary.saves.slice(0, 2).map((item) => renderBestiaryChip("Спас", item)),
    ...summary.skills.slice(0, 2).map((item) => renderBestiaryChip("Навык", item)),
  ];
  return `
    <section class="master-runtime-bestiary-summary" data-master-runtime-bestiary-summary="${escapeHtml(summary.id)}">
      <div class="master-runtime-bestiary-summary-head">
        <div>
          <h4>${escapeHtml(summary.name)}</h4>
          <small>${escapeHtml(meta || summary.source || "Бестиарий")}</small>
        </div>
        <small>snapshot в бой</small>
      </div>
      <div class="master-runtime-bestiary-stat-grid">
        <div class="master-runtime-bestiary-stat"><small>КД</small><strong>${escapeHtml(String(summary.ac || "—"))}</strong></div>
        <div class="master-runtime-bestiary-stat"><small>HP</small><strong>${escapeHtml(String(summary.hp || "—"))}</strong></div>
        <div class="master-runtime-bestiary-stat"><small>Скорость</small><strong>${escapeHtml(summary.speed ? `${summary.speed} фт.` : "—")}</strong></div>
        <div class="master-runtime-bestiary-stat"><small>Инициатива</small><strong>${escapeHtml(summary.initiative ? `+${summary.initiative}` : "+0")}</strong></div>
      </div>
      <div class="master-runtime-bestiary-chips">
        ${chips.length ? chips.join("") : renderBestiaryChip("Механика не распознана — смотри полную карточку")}
      </div>
      <p class="master-runtime-bestiary-review-note">Краткая сводка не заменяет Бестиарий: в бой добавляется отдельный экземпляр, который можно усилить сценой, бафами, предметами или ручными правками.</p>
      <div class="master-runtime-bestiary-summary-actions">
        <button class="btn btn-primary" type="button" data-master-runtime-action="add-selected-enemy">Добавить в бой</button>
        <button class="btn" type="button" data-master-runtime-action="open-bestiary">Открыть полную карточку</button>
      </div>
    </section>
  `;
}

function renderMonsterOptions(items, selectedId = "", placeholder = "Выбрать монстра") {
  const opts = [`<option value="">${escapeHtml(placeholder)}</option>`];
  safeArray(items).forEach((item, index) => {
    const id = getBestiaryEntryId(item, index);
    const label = getBestiaryEntryName(item, id || placeholder);
    opts.push(`<option value="${escapeHtml(id)}" ${String(id) === String(selectedId) ? "selected" : ""}>${escapeHtml(label)}</option>`);
  });
  return opts.join("");
}


function renderMonsterCards(items = [], selectedId = "") {
  const list = safeArray(items).slice(0, MASTER_ROOM_BESTIARY_CARD_LIMIT);
  if (!list.length) {
    return `
      <div class="master-runtime-bestiary-card-list empty">
        <div class="master-runtime-empty">Пул монстров не найден. Открой Бестиарий или добавь вручную — тут нужен экспорт/массив statblock'ов.</div>
      </div>
    `;
  }
  return `
    <div class="master-runtime-bestiary-card-list">
      ${list.map((entry, index) => {
        const id = getBestiaryEntryId(entry, index);
        const summary = buildBestiaryCombatSummary(entry);
        const active = String(id) === String(selectedId);
        return `
          <button class="master-runtime-bestiary-card ${active ? "active" : ""}" type="button" data-master-runtime-action="select-bestiary-monster" data-bestiary-id="${escapeHtml(id)}">
            <strong>${escapeHtml(summary.name || `Монстр ${index + 1}`)}</strong>
            <small>КД ${escapeHtml(String(summary.ac || "—"))} • HP ${escapeHtml(String(summary.hp || "—"))} • ${escapeHtml(summary.speed ? `${summary.speed} фт.` : "скорость —")}</small>
            <em>${escapeHtml([summary.size, summary.type, summary.challenge ? `CR ${summary.challenge}` : ""].filter(Boolean).join(" • ") || "statblock")}</em>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function filterMonsterEntries(monsters = []) {
  const query = displayText(MASTER_ROOM_STATE.ui.bestiaryMonsterSearch, "").toLowerCase();
  if (!query) return safeArray(monsters);
  return safeArray(monsters).filter((entry, index) => {
    const haystack = [
      getBestiaryEntryId(entry, index),
      getBestiaryEntryName(entry, ""),
      displayText(entry.category || entry.type || entry.creature_type, ""),
      displayText(entry.en_name || entry.english_name || "", ""),
      displayText(entry.subtitle || entry.summary || "", ""),
      displayText(entry.source || entry.source_name || entry.source_code, ""),
      ...safeArray(entry.tags).map((tag) => displayText(tag, "")),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}


function getBestiaryMonsterSelection() {
  const allMonsters = getKnownMonsterEntries();
  const matchedMonsters = filterMonsterEntries(allMonsters);
  const monsters = matchedMonsters.slice(0, MASTER_ROOM_BESTIARY_RESULT_LIMIT);
  let selectedId = MASTER_ROOM_STATE.ui.selectedBestiaryMonsterId || "";
  let selectedMonster = matchedMonsters.find((entry, index) => String(getBestiaryEntryId(entry, index)) === String(selectedId)) || null;
  if (!selectedMonster && matchedMonsters[0]) {
    selectedMonster = matchedMonsters[0];
    selectedId = getBestiaryEntryId(selectedMonster, 0);
    MASTER_ROOM_STATE.ui.selectedBestiaryMonsterId = selectedId;
  }
  return { allMonsters, matchedMonsters, monsters, selectedId, selectedMonster };
}

function bindBestiaryPickerDomActions(host) {
  if (!host) return;
  const select = host.querySelector("#masterRuntimeEnemySelect");
  if (select && select.dataset.boundBestiarySelect !== "1" && select.dataset.boundBestiarySelectLocal !== "1") {
    select.dataset.boundBestiarySelectLocal = "1";
    select.addEventListener("change", () => {
      MASTER_ROOM_STATE.ui.selectedBestiaryMonsterId = select.value || "";
      refreshBestiaryPickerDom(host);
    });
  }
  host.querySelectorAll('[data-master-runtime-action="select-bestiary-monster"]').forEach((button) => {
    if (button.dataset.boundBestiaryCardLocal === "1") return;
    button.dataset.boundBestiaryCardLocal = "1";
    button.addEventListener("click", () => {
      MASTER_ROOM_STATE.ui.selectedBestiaryMonsterId = button.dataset.bestiaryId || "";
      refreshBestiaryPickerDom(host);
    });
  });
}

function refreshBestiaryPickerDom(root = null) {
  if (typeof document === "undefined") return;
  const host = root || getSection("cabinet-masterroom");
  if (!host) return;
  const activeInput = host.querySelector("#masterRuntimeEnemySearch");
  const hadFocus = document.activeElement === activeInput;
  const selectionStart = hadFocus ? activeInput.selectionStart : null;
  const selectionEnd = hadFocus ? activeInput.selectionEnd : null;
  const { allMonsters, matchedMonsters, monsters, selectedId, selectedMonster } = getBestiaryMonsterSelection();

  const select = host.querySelector("#masterRuntimeEnemySelect");
  if (select) {
    select.innerHTML = renderMonsterOptions(monsters, selectedId, monsters.length ? "Выбрать монстра" : "Бестиарий пуст");
    select.value = selectedId || "";
  }

  const status = host.querySelector("[data-master-runtime-bestiary-status]") || host.querySelector(".master-runtime-bestiary-bridge-status");
  if (status) {
    const limited = matchedMonsters.length > monsters.length ? ` • первые ${monsters.length}` : "";
    status.textContent = `${getBestiaryBridgeStatusText()} • найдено ${matchedMonsters.length} из ${allMonsters.length}${limited}`;
  }

  const cardsSlot = host.querySelector("[data-master-runtime-bestiary-cards]");
  if (cardsSlot) cardsSlot.innerHTML = renderMonsterCards(monsters, selectedId);
  else {
    const cards = host.querySelector(".master-runtime-bestiary-card-list");
    if (cards) cards.outerHTML = renderMonsterCards(monsters, selectedId);
  }

  const summarySlot = host.querySelector("[data-master-runtime-bestiary-summary-slot]");
  if (summarySlot) summarySlot.innerHTML = renderBestiaryMonsterSummary(selectedMonster);
  else {
    const summary = host.querySelector(".master-runtime-bestiary-summary");
    if (summary) summary.outerHTML = renderBestiaryMonsterSummary(selectedMonster);
  }

  bindBestiaryPickerDomActions(host);
  if (hadFocus && activeInput) {
    try {
      activeInput.focus({ preventScroll: true });
      if (selectionStart !== null && selectionEnd !== null) activeInput.setSelectionRange(selectionStart, selectionEnd);
    } catch (_) {}
  }
}

function setBestiarySearchQuery(value = "") {
  // Round 48: только сохраняем строку. Фильтрация/DOM-обновление идут после debounce,
  // иначе 2–3 тысячи statblock'ов перебирались на каждую введённую букву.
  MASTER_ROOM_STATE.ui.bestiaryMonsterSearch = value || "";
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
  const summary = buildBestiaryCombatSummary(entry || {});
  return {
    entry_id: makeId("enemy"),
    type: "enemy",
    entity_kind: "enemy",
    name: summary.name || "Монстр",
    player_name: "Бестиарий",
    portrait_url: displayText(entry?.image || entry?.portrait_url || entry?.avatar_url, ""),
    initiative: rollDie(20) + safeNumber(summary.initiative, 0),
    hp_current: summary.hp || 10,
    hp_max: summary.hp || 10,
    ac: summary.ac || 10,
    speed: summary.speed || 30,
    status: "ready",
    conditions: [],
    source: "bestiary",
    source_kind: "bestiary",
    bestiary_id: summary.id,
    bestiary_summary: summary,
    snapshot: entry,
    items: safeArray(entry?.items || entry?.equipment),
    buffs: safeArray(entry?.buffs || entry?.effects),
    class_name: [summary.size, summary.type].filter(Boolean).join(" • "),
    race: summary.type || displayText(entry?.creature_type || entry?.category, ""),
    attacks: summary.attacks,
    abilities: entry?.abilities || entry?.stats || entry?.statblock || {},
    turn_flags: {},
    scene_state: normalizeCombatSceneToken(entry, 0, "enemy"),
    turn_resources: makeDefaultTurnResources(summary.speed || 30),
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
    temp_hp: lss.temp_hp,
    ac: lss.ac,
    speed: lss.speed,
    initiative: lss.initiative,
    proficiency_bonus: lss.proficiency_bonus,
    abilities: lss.abilities,
    saves: lss.saves,
    skills: lss.skills,
    attacks: lss.attacks,
    spells: lss.spells,
    spell_slots: lss.spell_slots,
    spells_meta: lss.spells_meta,
    spellcasting: lss.spellcasting,
    combat_profile: lss.combat_profile,
    features: lss.features,
    visibility: { ...DEFAULT_VISIBILITY },
    sheet: lss.sheet || {},
    inventory: lss.inventory,
    equipped_items: lss.equipped_items,
    buffs: lss.buffs,
    debuffs: lss.debuffs,
    conditions: lss.conditions,
    resistances: lss.resistances,
    vulnerabilities: lss.vulnerabilities,
    immunities: lss.immunities,
    source_kind: "lss",
    notes: "",
  };
}

function applyLssSnapshotToMember(member, lss = getLssSnapshot()) {
  if (!member || !lss) return member;
  const hasProfile = Boolean(lss.name || (lss.sheet && Object.keys(lss.sheet).length));
  if (!hasProfile) return member;
  member.selected_character_name = lss.name || member.selected_character_name;
  member.portrait_url = lss.portrait_url || member.portrait_url;
  member.level = lss.level || member.level;
  member.class_name = lss.class_name || member.class_name;
  member.race = lss.race || member.race;
  member.hp_current = lss.hp_current;
  member.hp_max = lss.hp_max;
  member.temp_hp = lss.temp_hp;
  member.ac = lss.ac;
  member.speed = lss.speed;
  member.initiative = lss.initiative;
  member.proficiency_bonus = lss.proficiency_bonus;
  member.abilities = lss.abilities;
  member.saves = lss.saves;
  member.skills = lss.skills;
  member.attacks = lss.attacks;
  member.spells = sanitizeMasterCombatSpellCollection(lss.spells);
  member.spell_slots = normalizeMasterRuntimeSpellSlots(lss.spell_slots);
  member.spells_meta = lss.spells_meta;
  member.spellcasting = lss.spellcasting;
  member.combat_profile = lss.combat_profile;
  member.features = lss.features;
  member.inventory = lss.inventory;
  member.equipped_items = lss.equipped_items;
  member.buffs = lss.buffs;
  member.debuffs = lss.debuffs;
  member.conditions = lss.conditions;
  member.resistances = lss.resistances;
  member.vulnerabilities = lss.vulnerabilities;
  member.immunities = lss.immunities;
  member.sheet = lss.sheet;
  return member;
}

function ensureCurrentUserInTable(table) {
  if (!table) return;
  const existing = getCurrentMember(table);
  if (existing) {
    applyLssSnapshotToMember(existing);
    return;
  }
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


function ensureMasterRoomRuntimeStylePatch() {
  // Round 37: временный layout-patch внутри JS, потому что Master Room ещё активно
  // перестраивается. Когда структура стабилизируется, эти правила стоит перенести
  // в frontend/css/modules/master-room.css и объединить с общими стилями LSS/GM UI.
  if (typeof document === "undefined") return;
  if (document.getElementById("master-room-runtime-round37-style")) return;
  const style = document.createElement("style");
  style.id = "master-room-runtime-round37-style";
  style.textContent = String.raw`
    .master-runtime-shell[data-master-runtime] .master-runtime-hero-actions-context {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
      align-items: center;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-hero-actions-context .btn {
      width: auto !important;
      min-width: 0;
      min-height: 36px;
      padding: 8px 12px;
      flex: 0 0 auto;
      white-space: nowrap;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-inline-quick-actions {
      padding: 14px 16px;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-inline-quick-actions .master-runtime-panel-head {
      margin-bottom: 10px;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-quick-grid,
    .master-runtime-shell[data-master-runtime] .master-runtime-context-grid {
      display: flex !important;
      flex-wrap: wrap;
      grid-template-columns: none !important;
      gap: 10px;
      align-items: stretch;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-context-grid .btn,
    .master-runtime-shell[data-master-runtime] .master-runtime-action-chip {
      width: auto !important;
      min-width: 118px;
      max-width: 220px;
      min-height: 38px;
      padding: 9px 13px;
      flex: 0 1 auto;
      line-height: 1.1;
      white-space: normal;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-stage-combat-round32 {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
      align-items: start;
      gap: 16px;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-combat-host-round32 {
      min-width: 0;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-round32 {
      grid-column: 1 / -1;
      position: static !important;
      padding: 0;
      overflow: hidden;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-round32 > summary {
      cursor: pointer;
      list-style: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      color: var(--gold, #e9c978);
      text-transform: uppercase;
      letter-spacing: .08em;
      font-weight: 800;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-round32 > summary::-webkit-details-marker {
      display: none;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      padding: 0 16px 16px;
      align-items: end;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-grid .master-runtime-bridge-note,
    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-actions {
      grid-column: 1 / -1;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-grid label {
      margin: 0;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-grid .btn {
      width: auto !important;
      min-height: 40px;
      padding: 9px 13px;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-grid .btn-primary {
      min-width: 220px;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-compact-events .master-runtime-mini-journal-head {
      width: 100%;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      padding: 0;
      font: inherit;
      text-align: left;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-compact-events .master-runtime-mini-journal-head:hover span,
    .master-runtime-shell[data-master-runtime] .master-runtime-compact-events .master-runtime-mini-journal-head:focus-visible span {
      color: var(--teal-2, #9be5ed);
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-compact-events [data-master-runtime-action="open-journal"] {
      width: auto !important;
      min-width: 150px;
      margin-top: 8px;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-dice-drawer {
      position: static !important;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-dice-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-dice-grid .btn {
      width: auto !important;
      min-height: 38px;
      padding: 8px 10px;
    }

    .master-runtime-shell[data-master-runtime] .combat-ref .combat-ref-main,
    .master-runtime-shell[data-master-runtime] .combat-layout,
    .master-runtime-shell[data-master-runtime] .combat-main-grid {
      min-width: 0;
    }

    .master-runtime-shell[data-master-runtime] .combat-ref-side-card,
    .master-runtime-shell[data-master-runtime] .combat-dice-panel,
    .master-runtime-shell[data-master-runtime] .combat-tactical-card {
      position: static !important;
    }



    .master-runtime-shell[data-master-runtime] .master-runtime-hero-clean {
      align-items: center;
      gap: 18px;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-hero-clean .master-runtime-hero-stats {
      margin-left: auto;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-inline-exit {
      border: 1px solid rgba(159, 225, 232, .22);
      background: rgba(3, 15, 19, .42);
      color: rgba(235, 246, 247, .78);
      border-radius: 999px;
      padding: 3px 9px;
      font-size: 12px;
      font-weight: 800;
      cursor: pointer;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-inline-exit:hover,
    .master-runtime-shell[data-master-runtime] .master-runtime-inline-exit:focus-visible {
      color: #061015;
      background: linear-gradient(180deg, #c7f6ff, #78c7d1);
      outline: none;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-layout {
      align-items: start;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-stage-combat-round32 {
      grid-template-columns: minmax(0, 1fr) minmax(300px, 380px);
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-rail-combat .master-runtime-context-grid {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      gap: 8px;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-rail-combat .master-runtime-action-chip,
    .master-runtime-shell[data-master-runtime] .master-runtime-rail-combat .master-runtime-context-grid .btn {
      min-width: 0 !important;
      width: 100% !important;
      min-height: 38px;
      padding: 8px 10px;
      font-size: 13px;
      border-radius: 14px;
      white-space: normal;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-round32 {
      margin-top: 12px;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-round32:not([open]) > summary {
      padding: 12px 14px;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-actions .btn {
      min-width: 0 !important;
      width: auto !important;
      flex: 0 1 auto;
      padding-inline: 12px;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-grid > .btn,
    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-grid > label {
      min-width: 0;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-mini-journal-open {
      width: 100%;
      border: 1px solid rgba(159, 225, 232, .24);
      background: rgba(7, 21, 27, .58);
      color: rgba(236, 247, 248, .9);
      border-radius: 14px;
      padding: 9px 11px;
      margin: 8px 0 10px;
      font-weight: 900;
      cursor: pointer;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-mini-journal-open:hover,
    .master-runtime-shell[data-master-runtime] .master-runtime-mini-journal-open:focus-visible {
      background: linear-gradient(180deg, #c7f6ff, #75c7d1);
      color: #061015;
      outline: none;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-event-list.compact {
      cursor: pointer;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-event-list.compact:hover .master-runtime-event-row {
      border-color: rgba(159, 225, 232, .22);
    }
    @media (max-width: 1280px) {
      .master-runtime-shell[data-master-runtime] .master-runtime-stage-combat-round32 {
        grid-template-columns: 1fr;
      }

      .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 760px) {
      .master-runtime-shell[data-master-runtime] .master-runtime-context-grid .btn,
      .master-runtime-shell[data-master-runtime] .master-runtime-action-chip,
      .master-runtime-shell[data-master-runtime] .master-runtime-hero-actions-context .btn {
        flex: 1 1 100%;
        max-width: none;
      }

      .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-grid {
        grid-template-columns: 1fr;
      }
    }
  `;


  style.textContent += String.raw`

    /* Round 37: убираем визуальный мусор вокруг Master Room, не трогая parent-модалку руками.
       Если тонкая верхняя линия всё ещё останется, значит она живёт выше #cabinet-masterroom
       и её надо будет переносить в общий cabinet/modal CSS. */
    #cabinet-masterroom::before,
    #cabinet-masterroom .master-runtime-shell::before,
    #cabinet-masterroom .master-runtime-inline-quick-actions:empty {
      display: none !important;
      content: none !important;
    }

    .master-runtime-shell[data-master-runtime] {
      margin-top: 0 !important;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-subline {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-inline-exit,
    .master-runtime-shell[data-master-runtime] .master-runtime-inline-lobby {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid rgba(141, 222, 232, .28);
      background: rgba(8, 17, 22, .76);
      color: rgba(244, 231, 194, .92);
      font-weight: 800;
      cursor: pointer;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-grid {
      display: grid !important;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      align-items: end;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-actions {
      grid-column: 1 / -1;
      display: flex !important;
      flex-wrap: wrap;
      gap: 8px;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-actions .btn,
    .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-grid > .btn {
      width: auto !important;
      min-height: 38px;
      padding: 8px 12px;
      flex: 0 0 auto;
    }

    .master-runtime-shell[data-master-runtime] .combat-ref-action-grid {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(138px, 1fr));
      gap: 8px;
      max-width: 100%;
    }

    .master-runtime-shell[data-master-runtime] .combat-ref-action-card {
      min-width: 0 !important;
      width: 100% !important;
      padding: 9px 10px !important;
      gap: 8px !important;
      overflow: hidden;
      cursor: pointer;
    }

    .master-runtime-shell[data-master-runtime] .combat-ref-action-card strong {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: clamp(13px, .9vw, 15px);
      line-height: 1.1;
    }

    .master-runtime-shell[data-master-runtime] .combat-ref-action-card span {
      flex: 0 0 34px;
      width: 34px;
      height: 34px;
    }

    .master-runtime-shell[data-master-runtime] .combat-ref-filter,
    .master-runtime-shell[data-master-runtime] .master-runtime-mini-journal-open,
    .master-runtime-shell[data-master-runtime] .master-runtime-event-list.compact {
      cursor: pointer;
      pointer-events: auto;
    }

    @media (max-width: 1360px) {
      .master-runtime-shell[data-master-runtime] .master-runtime-combat-setup-grid {
        grid-template-columns: 1fr;
      }
    }
  `;


  style.textContent += String.raw`
    /* Round 38: боевой блок действий должен быть рабочей карточкой, а не узкой
       невнятной колонкой. Это runtime-слой до выноса в master-room.css/combat.css. */
    .master-runtime-shell[data-master-runtime] .combat-ref-layout {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) minmax(360px, 430px) !important;
      align-items: start !important;
      gap: 16px !important;
    }

    .master-runtime-shell[data-master-runtime] .combat-ref-side {
      display: flex !important;
      flex-direction: column !important;
      gap: 12px !important;
      align-self: start !important;
      min-height: 0 !important;
      height: auto !important;
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
      padding: 0 !important;
      pointer-events: auto !important;
    }

    .master-runtime-shell[data-master-runtime] .combat-ref-target-card { order: 1; }
    .master-runtime-shell[data-master-runtime] .combat-ref-actions { order: 2; }
    .master-runtime-shell[data-master-runtime] .combat-ref-composer { order: 3; }
    .master-runtime-shell[data-master-runtime] .combat-ref-last-roll-card { order: 4; }
    .master-runtime-shell[data-master-runtime] .combat-ref-env-card { order: 5; }

    .master-runtime-shell[data-master-runtime] .combat-ref-actions,
    .master-runtime-shell[data-master-runtime] .combat-ref-composer,
    .master-runtime-shell[data-master-runtime] .combat-ref-target-card,
    .master-runtime-shell[data-master-runtime] .combat-ref-last-roll-card,
    .master-runtime-shell[data-master-runtime] .combat-ref-env-card {
      width: 100% !important;
      max-width: none !important;
      position: static !important;
      pointer-events: auto !important;
    }

    .master-runtime-shell[data-master-runtime] .combat-ref-action-grid {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      gap: 10px !important;
    }

    .master-runtime-shell[data-master-runtime] .combat-ref-action-card {
      min-width: 0 !important;
      min-height: 58px !important;
      width: 100% !important;
      padding: 10px 12px !important;
      overflow: visible !important;
      cursor: pointer !important;
      pointer-events: auto !important;
      position: relative !important;
      z-index: 3 !important;
    }

    .master-runtime-shell[data-master-runtime] .combat-ref-action-card > * {
      pointer-events: none !important;
    }

    .master-runtime-shell[data-master-runtime] .combat-ref-action-card strong {
      display: block !important;
      min-width: 0 !important;
      overflow: visible !important;
      text-overflow: clip !important;
      white-space: normal !important;
      font-size: 15px !important;
      line-height: 1.12 !important;
    }

    .master-runtime-shell[data-master-runtime] .combat-ref-action-card span {
      flex: 0 0 38px !important;
      width: 38px !important;
      height: 38px !important;
    }

    .master-runtime-shell[data-master-runtime] .combat-ref-composer .combat-ref-roll-form {
      display: grid !important;
      gap: 10px !important;
    }

    .master-runtime-shell[data-master-runtime] .combat-ref-action-mode[hidden] {
      display: none !important;
    }

    .master-runtime-shell[data-master-runtime] .combat-ref-action-mode:not([hidden]) {
      display: block !important;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-lobby-tools {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      margin: 12px 0 0;
    }

    .master-runtime-shell[data-master-runtime] .master-runtime-lobby-search {
      min-height: 42px;
    }

    @media (max-width: 1280px) {
      .master-runtime-shell[data-master-runtime] .combat-ref-layout {
        grid-template-columns: 1fr !important;
      }
    }
  `;


  style.textContent += String.raw`
    /* Round 40: краткая сводка монстра из Бестиария перед добавлением в бой.
       Пишем поверх текущих CSS, потому что Master Room ещё собирается модульно. */
    #cabinet-masterroom .master-runtime-bestiary-picker {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: minmax(180px, .7fr) minmax(220px, 1fr);
      gap: 10px;
      align-items: end;
    }

    #cabinet-masterroom .master-runtime-bestiary-summary {
      grid-column: 1 / -1;
      display: grid;
      gap: 10px;
      padding: 12px;
      border: 1px solid rgba(159, 225, 232, .16);
      border-radius: 18px;
      background: linear-gradient(135deg, rgba(10, 25, 31, .82), rgba(7, 13, 17, .64));
    }

    #cabinet-masterroom .master-runtime-bestiary-summary-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    #cabinet-masterroom .master-runtime-bestiary-summary-head h4 {
      margin: 0;
      color: var(--gold, #f4e0a4);
      font-size: 18px;
      line-height: 1.1;
    }

    #cabinet-masterroom .master-runtime-bestiary-summary-head small {
      color: rgba(227, 242, 243, .62);
      font-weight: 800;
    }

    #cabinet-masterroom .master-runtime-bestiary-stat-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }

    #cabinet-masterroom .master-runtime-bestiary-stat {
      min-height: 54px;
      padding: 9px 10px;
      border: 1px solid rgba(159, 225, 232, .12);
      border-radius: 14px;
      background: rgba(3, 12, 16, .52);
    }

    #cabinet-masterroom .master-runtime-bestiary-stat small {
      display: block;
      color: rgba(176, 197, 199, .72);
      text-transform: uppercase;
      letter-spacing: .06em;
      font-size: 10px;
      margin-bottom: 3px;
    }

    #cabinet-masterroom .master-runtime-bestiary-stat strong {
      display: block;
      color: #f8ecc8;
      font-size: 16px;
      line-height: 1.1;
    }

    #cabinet-masterroom .master-runtime-bestiary-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    #cabinet-masterroom .master-runtime-bestiary-chip {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      max-width: 100%;
      padding: 5px 9px;
      border-radius: 999px;
      border: 1px solid rgba(159, 225, 232, .14);
      background: rgba(231, 207, 139, .07);
      color: rgba(242, 236, 216, .9);
      font-size: 12px;
      font-weight: 800;
    }

    #cabinet-masterroom .master-runtime-bestiary-summary-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    #cabinet-masterroom .master-runtime-bestiary-summary-actions .btn {
      width: auto !important;
      min-height: 38px;
      padding: 8px 12px;
    }

    #cabinet-masterroom .master-runtime-bestiary-review-note {
      margin: 0;
      color: rgba(178, 199, 201, .78);
      font-size: 12px;
      line-height: 1.35;
    }

    @media (max-width: 900px) {
      #cabinet-masterroom .master-runtime-bestiary-picker,
      #cabinet-masterroom .master-runtime-bestiary-stat-grid {
        grid-template-columns: 1fr;
      }
    }
  `;

  style.textContent += String.raw`
    /* Round 42: сцена/мини-карта как контракт для movement, line-of-sight, высоты и укрытий. */
    #cabinet-masterroom .master-runtime-scene-mini-panel {
      display: grid;
      gap: 10px;
    }

    #cabinet-masterroom .master-runtime-scene-map {
      position: relative;
      min-height: 170px;
      overflow: hidden;
      border: 1px solid rgba(159, 225, 232, .16);
      border-radius: 18px;
      background: radial-gradient(circle at 30% 22%, rgba(74, 168, 181, .2), transparent 34%), linear-gradient(135deg, rgba(7, 19, 26, .94), rgba(4, 8, 12, .92));
      background-size: cover;
      background-position: center;
      box-shadow: inset 0 0 0 1px rgba(244, 214, 140, .04);
    }

    #cabinet-masterroom .master-runtime-scene-map.full {
      grid-column: 1 / -1;
      min-height: 260px;
    }

    #cabinet-masterroom .master-runtime-scene-map.has-grid::after {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: .28;
      background-image: linear-gradient(rgba(159, 225, 232, .12) 1px, transparent 1px), linear-gradient(90deg, rgba(159, 225, 232, .12) 1px, transparent 1px);
      background-size: 24px 24px;
    }

    #cabinet-masterroom .master-runtime-scene-map-meta {
      position: absolute;
      left: 10px;
      top: 10px;
      z-index: 4;
      display: grid;
      gap: 2px;
      max-width: calc(100% - 20px);
      padding: 7px 9px;
      border: 1px solid rgba(244, 214, 140, .16);
      border-radius: 12px;
      background: rgba(3, 10, 14, .72);
      backdrop-filter: blur(6px);
    }

    #cabinet-masterroom .master-runtime-scene-map-meta strong {
      color: #f4e0a4;
      font-size: 12px;
      line-height: 1.1;
    }

    #cabinet-masterroom .master-runtime-scene-map-meta small {
      color: rgba(225, 242, 243, .68);
      font-size: 11px;
    }

    #cabinet-masterroom .master-runtime-map-token {
      position: absolute;
      z-index: 5;
      transform: translate(-50%, -50%);
      width: var(--master-token-size, 30px);
      height: var(--master-token-size, 30px);
      border-radius: 999px;
      border: 1px solid rgba(244, 214, 140, .7);
      background: radial-gradient(circle at 30% 25%, rgba(255, 255, 255, .28), rgba(36, 105, 116, .92));
      color: #061015;
      font-weight: 1000;
      cursor: pointer;
      box-shadow: 0 8px 18px rgba(0, 0, 0, .42);
    }

    #cabinet-masterroom .master-runtime-map-token.enemy {
      border-radius: 10px;
      background: radial-gradient(circle at 30% 25%, rgba(255, 255, 255, .22), rgba(137, 56, 48, .94));
      color: #fff0df;
    }

    #cabinet-masterroom .master-runtime-map-token.dead {
      opacity: .45;
      filter: grayscale(.7);
      text-decoration: line-through;
    }

    #cabinet-masterroom .master-runtime-map-token.is-hidden {
      opacity: .36;
      border-style: dashed;
    }

    #cabinet-masterroom .master-runtime-scene-map-empty {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: rgba(225, 242, 243, .58);
      font-weight: 800;
      text-align: center;
      padding: 20px;
    }

    #cabinet-masterroom .master-runtime-scene-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      color: rgba(225, 242, 243, .62);
      font-size: 12px;
      font-weight: 800;
    }

    #cabinet-masterroom .master-runtime-scene-contract-panel {
      grid-column: 1 / -1;
      display: grid;
      gap: 12px;
      padding: 12px;
      border: 1px solid rgba(159, 225, 232, .16);
      border-radius: 18px;
      background: linear-gradient(135deg, rgba(10, 25, 31, .78), rgba(7, 13, 17, .56));
    }

    #cabinet-masterroom .master-runtime-scene-contract-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      align-items: end;
    }

    #cabinet-masterroom .master-runtime-scene-token-editor {
      display: grid;
      gap: 8px;
    }

    #cabinet-masterroom .master-runtime-scene-token-row {
      display: grid;
      grid-template-columns: minmax(140px, 1fr) repeat(3, minmax(70px, 90px)) minmax(110px, 140px) minmax(92px, auto) auto;
      gap: 8px;
      align-items: end;
      padding: 8px;
      border: 1px solid rgba(159, 225, 232, .1);
      border-radius: 14px;
      background: rgba(3, 10, 14, .38);
    }

    #cabinet-masterroom .master-runtime-scene-visible-toggle {
      display: flex;
      min-height: 38px;
      align-items: center;
      gap: 7px;
      white-space: nowrap;
      color: rgba(225, 242, 243, .8);
      font-weight: 800;
    }

    @media (max-width: 1100px) {
      #cabinet-masterroom .master-runtime-scene-contract-grid,
      #cabinet-masterroom .master-runtime-scene-token-row {
        grid-template-columns: 1fr 1fr;
      }
    }

    @media (max-width: 720px) {
      #cabinet-masterroom .master-runtime-scene-contract-grid,
      #cabinet-masterroom .master-runtime-scene-token-row {
        grid-template-columns: 1fr;
      }
    }
  `;

  style.textContent += String.raw`
    /* Round 43: ручное движение токена по сцене без полноценного VTT-движка. */
    #cabinet-masterroom .master-runtime-movement-panel {
      display: grid;
      gap: 10px;
    }

    #cabinet-masterroom .master-runtime-movement-status {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    #cabinet-masterroom .master-runtime-movement-status > div {
      padding: 8px 10px;
      border: 1px solid rgba(159, 225, 232, .12);
      border-radius: 13px;
      background: rgba(3, 10, 14, .42);
    }

    #cabinet-masterroom .master-runtime-movement-status small,
    #cabinet-masterroom .master-runtime-move-distance {
      color: rgba(225, 242, 243, .66);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .05em;
    }

    #cabinet-masterroom .master-runtime-movement-status strong {
      display: block;
      margin-top: 2px;
      color: #f7e7b0;
      font-size: 14px;
    }

    #cabinet-masterroom .master-runtime-move-distance {
      display: grid;
      gap: 5px;
    }

    #cabinet-masterroom .master-runtime-move-distance input {
      width: 100%;
    }

    #cabinet-masterroom .master-runtime-move-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 7px;
    }

    #cabinet-masterroom .master-runtime-move-btn,
    #cabinet-masterroom .master-runtime-move-center,
    #cabinet-masterroom .master-runtime-move-height .btn {
      min-width: 0 !important;
      width: 100% !important;
      min-height: 36px;
      padding: 7px 8px;
      text-align: center;
    }

    #cabinet-masterroom .master-runtime-move-center {
      display: grid;
      place-items: center;
      border: 1px solid rgba(244, 214, 140, .12);
      border-radius: 12px;
      color: rgba(244, 214, 140, .7);
      background: rgba(231, 207, 139, .05);
      font-weight: 1000;
    }

    #cabinet-masterroom .master-runtime-move-height {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 7px;
    }

    #cabinet-masterroom .master-runtime-move-free {
      display: flex;
      align-items: center;
      gap: 7px;
      color: rgba(225, 242, 243, .74);
      font-size: 12px;
      font-weight: 800;
    }

    /* Round 44: правила движения, рывок/отступление и видимый пул Бестиария. */
    #cabinet-masterroom .master-runtime-move-rule-badges,
    #cabinet-masterroom .master-runtime-move-rule-reasons,
    #cabinet-masterroom .master-runtime-move-maneuvers {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    #cabinet-masterroom .master-runtime-move-rule-badges span,
    #cabinet-masterroom .master-runtime-move-rule-reasons span {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 4px 8px;
      border: 1px solid rgba(159, 225, 232, .13);
      border-radius: 999px;
      background: rgba(3, 10, 14, .48);
      color: rgba(225, 242, 243, .78);
      font-size: 11px;
      font-weight: 850;
    }

    #cabinet-masterroom .master-runtime-move-maneuvers .btn {
      width: auto !important;
      min-width: 0 !important;
      min-height: 34px;
      padding: 7px 10px;
      white-space: nowrap;
    }

    #cabinet-masterroom .master-runtime-bestiary-card-list {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      max-height: 220px;
      overflow: auto;
      padding-right: 4px;
    }

    #cabinet-masterroom .master-runtime-bestiary-card {
      display: grid;
      gap: 4px;
      min-height: 76px;
      padding: 9px 10px;
      text-align: left;
      border: 1px solid rgba(159, 225, 232, .12);
      border-radius: 14px;
      background: rgba(3, 10, 14, .46);
      color: rgba(225, 242, 243, .86);
      cursor: pointer;
    }

    #cabinet-masterroom .master-runtime-bestiary-card.active {
      border-color: rgba(244, 214, 140, .5);
      background: linear-gradient(135deg, rgba(231, 207, 139, .13), rgba(24, 95, 108, .16));
      box-shadow: inset 0 0 0 1px rgba(244, 214, 140, .1);
    }

    #cabinet-masterroom .master-runtime-bestiary-card strong {
      color: #f4e0a4;
      font-size: 13px;
      line-height: 1.15;
    }

    #cabinet-masterroom .master-runtime-bestiary-card small,
    #cabinet-masterroom .master-runtime-bestiary-card em {
      color: rgba(225, 242, 243, .66);
      font-size: 11px;
      font-style: normal;
      line-height: 1.2;
    }

    #cabinet-masterroom .master-runtime-scene-contract-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      grid-column: 1 / -1;
    }

    #cabinet-masterroom .master-runtime-scene-contract-actions .btn {
      width: auto !important;
      min-height: 36px;
      padding: 7px 11px;
    }

    @media (max-width: 980px) {
      #cabinet-masterroom .master-runtime-bestiary-card-list {
        grid-template-columns: 1fr;
      }
    }
  `;


  style.textContent += String.raw`
    /* Round 45: hover-preview маршрута и защита от мисклика. */
    #cabinet-masterroom .master-runtime-route-preview-svg {
      position: absolute;
      inset: 0;
      z-index: 3;
      width: 100%;
      height: 100%;
      pointer-events: none;
      opacity: 0;
      transition: opacity .12s ease;
    }

    #cabinet-masterroom .master-runtime-scene-map.has-route-preview .master-runtime-route-preview-svg {
      opacity: 1;
    }

    #cabinet-masterroom .master-runtime-route-preview-svg line {
      stroke: rgba(147, 231, 242, .92);
      stroke-width: 1.2;
      stroke-dasharray: 3 2;
      filter: drop-shadow(0 0 5px rgba(77, 210, 226, .58));
    }

    #cabinet-masterroom .master-runtime-route-preview-svg circle {
      fill: rgba(244, 214, 140, .96);
      stroke: rgba(3, 10, 14, .8);
      stroke-width: .6;
      filter: drop-shadow(0 0 8px rgba(244, 214, 140, .52));
    }

    #cabinet-masterroom .master-runtime-scene-map.route-preview-bad .master-runtime-route-preview-svg line {
      stroke: rgba(245, 112, 101, .9);
    }

    #cabinet-masterroom .master-runtime-scene-map.route-preview-bad .master-runtime-route-preview-svg circle {
      fill: rgba(245, 112, 101, .94);
    }

    #cabinet-masterroom .master-runtime-route-preview-card {
      position: absolute;
      z-index: 6;
      max-width: min(270px, 70%);
      transform: translate(8px, -50%);
      padding: 7px 9px;
      border: 1px solid rgba(159, 225, 232, .24);
      border-radius: 12px;
      background: rgba(3, 10, 14, .88);
      color: rgba(235, 250, 252, .92);
      font-size: 11px;
      font-weight: 800;
      line-height: 1.25;
      box-shadow: 0 10px 26px rgba(0, 0, 0, .34);
      pointer-events: none;
    }

    #cabinet-masterroom .master-runtime-scene-map.route-preview-bad .master-runtime-route-preview-card,
    #cabinet-masterroom .master-runtime-move-preview-status.bad {
      border-color: rgba(245, 112, 101, .42);
      color: #ffd0ca;
    }

    #cabinet-masterroom .master-runtime-move-preview-status {
      padding: 8px 10px;
      border: 1px solid rgba(159, 225, 232, .16);
      border-radius: 12px;
      background: rgba(3, 10, 14, .5);
      color: rgba(225, 242, 243, .86);
      font-size: 12px;
      font-weight: 850;
      line-height: 1.3;
    }

    #cabinet-masterroom .master-runtime-move-btn:hover:not(:disabled),
    #cabinet-masterroom .master-runtime-move-btn:focus-visible:not(:disabled) {
      outline: 1px solid rgba(244, 214, 140, .48);
      box-shadow: 0 0 0 3px rgba(244, 214, 140, .08), 0 0 22px rgba(77, 210, 226, .14);
    }
  `;



  style.textContent += String.raw`
    /* Round 46: боевой фокус, токены и пул монстров без визуального шума. */
    #cabinet-masterroom .master-runtime-map-token.is-current-turn {
      z-index: 8;
      border-color: rgba(112, 230, 243, .98) !important;
      box-shadow: 0 0 0 3px rgba(112, 230, 243, .18), 0 0 28px rgba(112, 230, 243, .42) !important;
      filter: saturate(1.18) brightness(1.12);
      transform: translate(-50%, -50%) scale(1.08);
    }

    #cabinet-masterroom .master-runtime-map-token.is-current-turn::after {
      content: "";
      position: absolute;
      inset: -9px;
      border: 1px solid rgba(244, 214, 140, .5);
      border-radius: inherit;
      animation: masterRuntimePulse46 1.45s ease-in-out infinite;
      pointer-events: none;
    }

    #cabinet-masterroom .master-runtime-map-token.is-current-target {
      z-index: 7;
      border-color: rgba(246, 170, 104, .86) !important;
      box-shadow: 0 0 0 3px rgba(246, 170, 104, .14), 0 0 20px rgba(246, 170, 104, .28) !important;
    }

    #cabinet-masterroom .master-runtime-map-token.is-muted-turn:not(.dead):not(.is-hidden) {
      opacity: .58;
      filter: grayscale(.26) saturate(.78) brightness(.9);
    }

    #cabinet-masterroom .master-runtime-map-token.dead,
    #cabinet-masterroom .master-runtime-map-token.defeated,
    #cabinet-masterroom .master-runtime-map-token.killed {
      opacity: .34 !important;
      filter: grayscale(.82) brightness(.72) !important;
      border-style: dashed !important;
    }

    #cabinet-masterroom .master-runtime-map-token.dead span::after,
    #cabinet-masterroom .master-runtime-map-token.defeated span::after,
    #cabinet-masterroom .master-runtime-map-token.killed span::after {
      content: " ✕";
      color: #ff9d93;
      font-size: 10px;
    }

    #cabinet-masterroom .combat-ref-init-card:not(.is-active):not(.is-defeated) {
      opacity: .58;
      filter: grayscale(.28) saturate(.74);
    }

    #cabinet-masterroom .combat-ref-init-card.is-active {
      border-color: rgba(112, 230, 243, .96) !important;
      box-shadow: 0 0 0 3px rgba(112, 230, 243, .13), 0 0 28px rgba(112, 230, 243, .25) !important;
      filter: saturate(1.16) brightness(1.08);
    }

    #cabinet-masterroom .combat-ref-init-card.is-defeated {
      opacity: .36 !important;
      filter: grayscale(.82) brightness(.68) !important;
    }

    #cabinet-masterroom .combat-ref-roster-card:not(.is-defeated) {
      transition: opacity .12s ease, filter .12s ease, border-color .12s ease;
    }

    #cabinet-masterroom .master-runtime-bestiary-card-list {
      scroll-margin-top: 110px;
    }

    @keyframes masterRuntimePulse46 {
      0%, 100% { opacity: .3; transform: scale(.95); }
      50% { opacity: .9; transform: scale(1.06); }
    }
  `;



  style.textContent += String.raw`
    /* Round 47: локальный поиск Бестиария без полного rerender + единая плашка выбранного токена. */
    #cabinet-masterroom .master-runtime-bestiary-picker,
    #cabinet-masterroom .master-runtime-bestiary-card-list,
    #cabinet-masterroom .master-runtime-bestiary-summary {
      scroll-margin-top: 140px;
    }

    #cabinet-masterroom .master-runtime-bestiary-card-list {
      max-height: 260px;
      overflow: auto;
      overscroll-behavior: contain;
      padding-right: 6px;
    }

    #cabinet-masterroom .master-runtime-bestiary-card-list::-webkit-scrollbar {
      width: 8px;
    }

    #cabinet-masterroom .master-runtime-bestiary-card-list::-webkit-scrollbar-thumb {
      background: rgba(159, 225, 232, .28);
      border-radius: 999px;
    }

    #cabinet-masterroom .master-runtime-map-token.is-selected-combatant {
      z-index: 7;
      border-color: rgba(244, 214, 140, .9) !important;
      box-shadow: 0 0 0 3px rgba(244, 214, 140, .16), 0 0 20px rgba(244, 214, 140, .24) !important;
      filter: saturate(1.04) brightness(1.06);
    }

    #cabinet-masterroom .master-runtime-selected-combat-panel {
      background: linear-gradient(135deg, rgba(7, 22, 28, .94), rgba(11, 36, 45, .84));
    }

    #cabinet-masterroom .master-runtime-selected-combat-head {
      display: grid;
      grid-template-columns: 46px 1fr;
      gap: 10px;
      align-items: center;
      margin-bottom: 10px;
    }

    #cabinet-masterroom .master-runtime-selected-combat-avatar {
      width: 46px;
      height: 46px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(244, 214, 140, .28);
      border-radius: 14px;
      background: rgba(3, 10, 14, .48);
      overflow: hidden;
    }

    #cabinet-masterroom .master-runtime-selected-combat-head strong {
      display: block;
      color: var(--gold, #ead7a0);
      font-size: 17px;
      line-height: 1.1;
    }

    #cabinet-masterroom .master-runtime-selected-combat-head small,
    #cabinet-masterroom .master-runtime-selected-combat-panel .small {
      color: rgba(216, 232, 235, .68);
    }

    #cabinet-masterroom .master-runtime-selected-combat-stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }

    #cabinet-masterroom .master-runtime-selected-combat-stats > div {
      padding: 8px 9px;
      border: 1px solid rgba(159, 225, 232, .14);
      border-radius: 12px;
      background: rgba(2, 12, 16, .44);
    }

    #cabinet-masterroom .master-runtime-selected-combat-stats small {
      display: block;
      color: rgba(216, 232, 235, .6);
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: .04em;
    }

    #cabinet-masterroom .master-runtime-selected-combat-stats strong {
      color: rgba(255, 246, 211, .96);
      font-size: 16px;
    }

    #cabinet-masterroom .master-runtime-selected-combat-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 8px 0;
    }

    #cabinet-masterroom .master-runtime-selected-combat-chips span {
      max-width: 100%;
      padding: 5px 8px;
      border: 1px solid rgba(244, 214, 140, .18);
      border-radius: 999px;
      background: rgba(244, 214, 140, .07);
      color: rgba(255, 246, 211, .9);
      font-size: 11px;
      font-weight: 850;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    #cabinet-masterroom .master-runtime-selected-combat-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 10px;
    }

    #cabinet-masterroom .master-runtime-selected-combat-actions .btn:first-child:last-child,
    #cabinet-masterroom .master-runtime-selected-combat-actions .btn:nth-child(3) {
      grid-column: 1 / -1;
    }
  `;
  document.head.appendChild(style);
}

function ensureMasterRoomJournalStylePatch() {
  if (document.getElementById("master-room-journal-round49-style")) return;
  const style = document.createElement("style");
  style.id = "master-room-journal-round49-style";
  style.textContent = String.raw`
    #cabinet-masterroom .master-runtime-stage-journal-filtered {
      grid-template-columns: minmax(0, 1.45fr) minmax(280px, .55fr);
      align-items: start;
    }
    #cabinet-masterroom .master-runtime-journal-list-panel,
    #cabinet-masterroom .master-runtime-journal-details-panel { min-width: 0; }
    #cabinet-masterroom .master-runtime-journal-toolbar {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) minmax(170px, .45fr) auto;
      gap: 10px;
      align-items: end;
      margin-bottom: 10px;
    }
    #cabinet-masterroom .master-runtime-journal-toolbar label { display: grid; gap: 5px; min-width: 0; }
    #cabinet-masterroom .master-runtime-journal-toolbar label > span {
      color: rgba(239, 204, 126, .92);
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    #cabinet-masterroom .master-runtime-journal-filter-row {
      display: flex;
      gap: 7px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    #cabinet-masterroom .master-runtime-journal-filter {
      min-height: 34px;
      padding: 6px 11px;
      border: 1px solid rgba(239, 204, 126, .22);
      border-radius: 999px;
      background: rgba(3, 12, 16, .48);
      color: rgba(236, 239, 232, .78);
      font-weight: 850;
      cursor: pointer;
    }
    #cabinet-masterroom .master-runtime-journal-filter:hover,
    #cabinet-masterroom .master-runtime-journal-filter.active {
      border-color: rgba(93, 220, 236, .72);
      background: rgba(18, 102, 116, .34);
      color: #f7efd2;
      box-shadow: 0 0 0 1px rgba(93, 220, 236, .12) inset;
    }
    #cabinet-masterroom .master-runtime-event-list-compact {
      max-height: min(62vh, 720px);
      overflow: auto;
      padding-right: 4px;
      scrollbar-gutter: stable;
    }
    #cabinet-masterroom .master-runtime-event-list-compact .master-runtime-event-row {
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 12px;
      text-align: left;
    }
    #cabinet-masterroom .master-runtime-event-row.active {
      border-color: rgba(93, 220, 236, .62);
      background: linear-gradient(90deg, rgba(17, 98, 112, .24), rgba(6, 18, 24, .58));
    }
    #cabinet-masterroom .master-runtime-event-copy { min-width: 0; display: grid; gap: 2px; }
    #cabinet-masterroom .master-runtime-event-copy strong,
    #cabinet-masterroom .master-runtime-event-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #cabinet-masterroom .master-runtime-event-kicker {
      color: rgba(239, 204, 126, .82);
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    #cabinet-masterroom .master-runtime-journal-more { width: 100%; margin-top: 10px; }
    #cabinet-masterroom .master-runtime-journal-detail-head { display: flex; justify-content: space-between; gap: 10px; color: rgba(239, 204, 126, .9); font-weight: 900; }
    #cabinet-masterroom .master-runtime-journal-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 12px 0; }
    #cabinet-masterroom .master-runtime-journal-facts > div { display: grid; gap: 3px; padding: 9px; border: 1px solid rgba(93, 220, 236, .14); border-radius: 12px; background: rgba(3, 12, 16, .38); }
    #cabinet-masterroom .master-runtime-journal-facts small { color: rgba(180, 195, 197, .65); text-transform: uppercase; font-size: 10px; font-weight: 900; }
    @media (max-width: 1100px) {
      #cabinet-masterroom .master-runtime-stage-journal-filtered { grid-template-columns: 1fr; }
      #cabinet-masterroom .master-runtime-journal-toolbar { grid-template-columns: 1fr 1fr; }
      #cabinet-masterroom .master-runtime-journal-toolbar .btn { grid-column: 1 / -1; }
    }
  `;
  document.head.appendChild(style);
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



function openCabinetTarget(tabName, label = "раздел") {
  const ok = switchToCabinetTab(tabName);
  if (!ok) showToast(`Не удалось открыть ${label}`);
  return ok;
}

function renderContextNavButtons(context = "table", canManage = false) {
  // Контекстная навигация Master Room. Это не новая бизнес-логика, а мост к уже
  // существующим модулям кабинета: LSS, Инвентарь, Карта, Бестиарий, Выдача.
  // Позже сюда подключим общий engine: actor = sheet + items + buffs/effects.
  const common = [
    ["open-lss", "📖 LSS"],
    ["open-inventory", "🎒 Инвентарь"],
    ["open-map", "🗺 Карта"],
  ];
  const byContext = {
    combat: [["open-bestiary-pool", "🐲 Пул монстров"], ["toggle-dice-drawer", "🎲 Кубы"], ["open-journal", "☷ Журнал"], ...(canManage ? [["open-bestiary-pool", "＋ Монстр"], ["add-enemy", "＋ Вручную"], ["start-combat", "⚔ Инициатива"]] : [])],
    grants: [["open-inventory", "🎒 Инвентарь"], ...(canManage ? [["create-custom-grant-item", "＋ Custom"], ["grant-reward", "✦ Выдать"]] : [])],
    traders: [["open-inventory", "🎒 Каталог"], ["open-map", "🗺 Сцена"], ...(canManage ? [["add-trader", "＋ Торговец"]] : [])],
    table: [["open-map", "🗺 Карта"], ["open-inventory", "🎒 Предметы"], ["open-lss", "📖 LSS"]],
    party: [["open-lss", "📖 LSS"], ["open-inventory", "🎒 Снаряжение"], ...(canManage ? [["add-current-user", "＋ Себя/LSS"]] : [])],
    characters: [["open-lss", "📖 LSS"], ["open-inventory", "🎒 Снаряжение"], ...(canManage ? [["add-current-user", "＋ Себя/LSS"]] : [])],
    access: [["open-map", "🗺 Карта"], ...(canManage ? [["save-access", "▣ Сохранить"]] : [])],
    journal: [["open-combat", "⚔ Бой"], ["open-map", "🗺 Карта"]],
  };
  const actions = byContext[context] || common;
  const unique = [];
  const seen = new Set();
  [...actions, ...common].forEach(([action, label]) => {
    if (seen.has(action)) return;
    seen.add(action);
    unique.push([action, label]);
  });
  return unique.map(([action, label]) => `<button class="btn master-runtime-action-chip" type="button" data-master-runtime-action="${escapeHtml(action)}">${escapeHtml(label)}</button>`).join("");
}

function renderActorModelHint(context = "combat") {
  // Не выводим это как правило D&D, это техническая подсказка для нас/GM:
  // откуда в будущем будут считаться КД, атаки, бафы и эффекты.
  const copy = context === "combat"
    ? "Персонаж: LSS + снаряжение + бафы. Противник: Бестиарий + модификаторы сцены."
    : "Master Room связывает LSS, инвентарь, карту, торговцев и журнал без ручного дубляжа.";
  return `<p class="master-runtime-muted master-runtime-bridge-note">${escapeHtml(copy)}</p>`;
}

function renderCombatSceneMap(combat = {}, { compact = false, canManage = false } = {}) {
  const scene = normalizeCombatScene(combat.scene || {});
  const entries = safeArray(combat.entries);
  const current = getCurrentCombatEntry(combat);
  const latestLog = safeArray(combat.log)[0] || {};
  const selectedEntryId = displayText(MASTER_ROOM_STATE.ui.selectedCombatEntryId, "");
  const latestTargetId = displayText(MASTER_ROOM_STATE.ui.selectedCombatTargetId || combat.target_entry_id || combat.last_roll?.target_entry_id || latestLog.target_entry_id, "");
  const width = Math.max(1, safeNumber(scene.width, 120));
  const height = Math.max(1, safeNumber(scene.height, 80));
  const tokens = entries.map((entry, index) => {
    const token = snapScenePosition(normalizeCombatSceneToken(entry, index, entry.type), scene);
    const xPct = clampSceneNumber(token.x, 0, width) / width * 100;
    const yPct = clampSceneNumber(token.y, 0, height) / height * 100;
    const footprintCells = getCombatEntryFootprintCells(entry);
    const stateClass = isDeadEnemyCombatEntry(entry) ? "dead" : displayText(entry.status, "ready").toLowerCase();
    const isCurrent = String(entry.entry_id || "") === String(current?.entry_id || "");
    const isTarget = latestTargetId && String(entry.entry_id || "") === String(latestTargetId);
    const isSelected = selectedEntryId && String(entry.entry_id || "") === String(selectedEntryId);
    const focusClass = isCurrent ? "is-current-turn" : isTarget ? "is-current-target" : isSelected ? "is-selected-combatant" : "is-muted-turn";
    const hiddenClass = token.hidden || (!canManage && !token.visible_to_players) ? "is-hidden" : "";
    return `
      <button class="master-runtime-map-token ${escapeHtml(entry.type || "member")} ${escapeHtml(stateClass)} ${focusClass} ${hiddenClass}"
        type="button"
        style="left:${xPct.toFixed(2)}%;top:${yPct.toFixed(2)}%;--master-token-size:${Math.min(74, 30 * footprintCells)}px"
        title="${escapeHtml(entry.name || "Участник")} • ${isCurrent ? "текущий ход • " : ""}${isTarget ? "цель • " : ""}клетка X${escapeHtml(String(Math.round(token.x)))} Y${escapeHtml(String(Math.round(token.y)))} • размер ${footprintCells}×${footprintCells} • высота ${escapeHtml(String(token.z || 0))}"
        data-master-runtime-focus-combatant="${escapeHtml(entry.entry_id || "")}">
        <span>${sceneTokenInitial(entry)}</span>
      </button>
    `;
  }).join("");

  const bg = scene.map_url
    ? `style="background-image: linear-gradient(rgba(3, 10, 14, .35), rgba(3, 10, 14, .68)), url('${escapeHtml(scene.map_url)}')"`
    : "";
  return `
    <div class="master-runtime-scene-map ${compact ? "compact" : "full"} ${scene.grid_enabled ? "has-grid" : ""}" ${bg}>
      <svg class="master-runtime-route-preview-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line data-master-runtime-route-line x1="0" y1="0" x2="0" y2="0"></line>
        <circle data-master-runtime-route-end cx="0" cy="0" r="1.6"></circle>
      </svg>
      <div class="master-runtime-route-preview-card" data-master-runtime-route-card hidden></div>
      <div class="master-runtime-scene-map-meta">
        <strong>${escapeHtml(scene.map_name || "Карта сцены")}</strong>
        <small>${escapeHtml(String(scene.grid_size_ft || 5))} фт. • ${escapeHtml(scene.light || "свет")}</small>
      </div>
      ${tokens || `<div class="master-runtime-scene-map-empty">Участники появятся здесь после старта боя.</div>`}
    </div>
  `;
}

function renderCombatSceneMiniPanel(table, canManage = false) {
  const combat = normalizeCombat(table?.combat, table);
  const scene = normalizeCombatScene(combat.scene, table);
  return `
    <section class="master-runtime-panel master-runtime-scene-mini-panel">
      <div class="master-runtime-panel-head"><span>Мини-карта сцены</span><small>${escapeHtml(scene.visibility_mode || "party")}</small></div>
      ${renderCombatSceneMap(combat, { compact: true, canManage })}
      <div class="master-runtime-scene-legend">
        <span>● игрок/LSS</span><span>◆ враг</span><span>◎ текущий ход</span><span>✕ выбыл</span>
      </div>
      <p class="master-runtime-muted">Позиция, видимость, высота и укрытие. Движение хода ниже уже двигает токен и тратит movement.</p>
    </section>
  `;
}


function getLatestCombatTargetId(combat = {}) {
  const latestLog = safeArray(combat.log)[0] || {};
  return displayText(MASTER_ROOM_STATE.ui.selectedCombatTargetId || combat.target_entry_id || combat.last_roll?.target_entry_id || latestLog.target_entry_id, "");
}

function getSelectedCombatEntry(table = null) {
  const combat = normalizeCombat(table?.combat, table);
  const entries = safeArray(combat.entries);
  if (!entries.length) return null;
  const selectedId = MASTER_ROOM_STATE.ui.selectedCombatEntryId || getLatestCombatTargetId(combat);
  return entries.find((entry) => String(entry.entry_id || "") === String(selectedId || "")) || getCurrentCombatEntry(combat) || entries[0] || null;
}

function renderCombatSelectedPanel(table, canManage = false) {
  const combat = normalizeCombat(table?.combat, table);
  const entries = safeArray(combat.entries);
  const current = getCurrentCombatEntry(combat);
  const targetId = getLatestCombatTargetId(combat);
  const entry = getSelectedCombatEntry(table);
  if (!entry) {
    return `
      <section class="master-runtime-panel master-runtime-selected-combat-panel">
        <div class="master-runtime-panel-head"><span>Выбор сцены</span><small>нет токена</small></div>
        <p class="master-runtime-muted">Кликни токен на карте или добавь участника боя.</p>
      </section>
    `;
  }
  const token = snapScenePosition(normalizeCombatSceneToken(entry, entries.indexOf(entry), entry.type), normalizeCombatScene(combat.scene, table));
  const isCurrent = String(entry.entry_id || "") === String(current?.entry_id || "");
  const isTarget = targetId && String(entry.entry_id || "") === String(targetId);
  const summary = entry.source_kind === "bestiary" || entry.entity_kind === "enemy" ? buildBestiaryCombatSummary(entry.snapshot || entry.bestiary_summary || entry) : null;
  const attacks = safeArray(entry.attacks || summary?.attacks).slice(0, 3);
  const conditions = safeArray(entry.conditions || entry.buffs || entry.effects).slice(0, 5);
  const resolvedProfile = entry.combat_profile && typeof entry.combat_profile === "object" ? entry.combat_profile : {};
  const resolvedFinal = resolvedProfile.final || {};
  const armorSources = safeArray(resolvedProfile.armor?.sources).slice(0, 5);
  const profileChips = [
    entry.proficiency_bonus ? `Мастерство +${entry.proficiency_bonus}` : "",
    resolvedFinal.spell_attack ? `Спелл ${resolvedFinal.spell_attack > 0 ? "+" : ""}${resolvedFinal.spell_attack}` : "",
    resolvedFinal.spell_save_dc ? `Сл ${resolvedFinal.spell_save_dc}` : "",
  ].filter(Boolean);
  const spellSlots = normalizeMasterRuntimeSpellSlots(entry.spell_slots);
  const spellSlotChips = spellSlots.map((slot) => `${slot.level} круг ${slot.remaining}/${slot.total}`);
  const runtimeEffects = [...safeArray(entry.buffs), ...safeArray(entry.debuffs)].filter((item) => item && typeof item === "object").slice(0, 8);
  const concentrationLabel = entry.concentration?.spell_name || entry.concentration?.name || "";
  return `
    <section class="master-runtime-panel master-runtime-selected-combat-panel" data-master-runtime-selected-combat="${escapeHtml(entry.entry_id || "")}">
      <div class="master-runtime-panel-head">
        <span>Выбрано</span>
        <small>${escapeHtml(isCurrent ? "текущий ход" : isTarget ? "цель" : getEntityKindLabelForMaster(entry))}</small>
      </div>
      <div class="master-runtime-selected-combat-head">
        <div class="master-runtime-selected-combat-avatar">${renderAvatar(entry.portrait_url, entry.name, "master-runtime-row-avatar")}</div>
        <div>
          <strong>${escapeHtml(entry.name || "Участник")}</strong>
          <small>${escapeHtml(getEntityKindLabelForMaster(entry))}${entry.source_kind ? ` • ${escapeHtml(entry.source_kind)}` : ""}</small>
        </div>
      </div>
      <div class="master-runtime-selected-combat-stats">
        <div><small>КД</small><strong>${escapeHtml(String(entry.ac || 10))}</strong></div>
        <div><small>HP</small><strong>${escapeHtml(String(entry.hp_current || 0))}/${escapeHtml(String(entry.hp_max || 0))}</strong></div>
        <div><small>Скорость</small><strong>${escapeHtml(String(entry.speed || 30))} фт.</strong></div>
        <div><small>Позиция</small><strong>X${escapeHtml(String(Math.round(token.x)))} Y${escapeHtml(String(Math.round(token.y)))} Z${escapeHtml(String(Math.round(token.z || 0)))}</strong></div>
      </div>
      ${attacks.length ? `<div class="master-runtime-selected-combat-chips">${attacks.map((item) => `<span>${escapeHtml(clampText(item, 80))}</span>`).join("")}</div>` : ""}
      ${conditions.length ? `<div class="master-runtime-selected-combat-chips muted">${conditions.map((item) => `<span>${escapeHtml(displayText(item?.name || item?.label || item, ""))}</span>`).join("")}</div>` : `<p class="master-runtime-muted small">Состояния/бафы не указаны.</p>`}
      ${runtimeEffects.length ? `<div class="master-runtime-selected-combat-chips muted">${runtimeEffects.map((item) => `<span>${escapeHtml(`${displayText(item.name, "Эффект")}${safeNumber(item.remaining_rounds, 0) > 0 ? ` • ${item.remaining_rounds} р.` : ""}`)}</span>`).join("")}</div>` : ""}
      ${profileChips.length ? `<div class="master-runtime-selected-combat-chips">${profileChips.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
      ${spellSlotChips.length ? `<div class="master-runtime-selected-combat-chips">${spellSlotChips.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
      ${concentrationLabel ? `<p class="master-runtime-muted small"><strong>Концентрация:</strong> ${escapeHtml(concentrationLabel)}</p>` : ""}
      ${armorSources.length ? `
        <details class="master-runtime-selected-combat-breakdown">
          <summary>Расчёт КД и профиля</summary>
          <div>${armorSources.map((item) => `<p><span>${escapeHtml(item.label || "Источник")}</span><strong>${item.additive && safeNumber(item.value, 0) > 0 ? "+" : ""}${escapeHtml(String(item.value ?? ""))}</strong></p>`).join("")}</div>
          ${safeArray(resolvedProfile.warnings).length ? `<small>${escapeHtml(safeArray(resolvedProfile.warnings).join(" • "))}</small>` : ""}
        </details>
      ` : ""}
      <div class="master-runtime-selected-combat-actions">
        <button class="btn" type="button" data-master-runtime-action="set-combat-selected" data-entry-id="${escapeHtml(entry.entry_id || "")}">Фокус</button>
        <button class="btn" type="button" data-master-runtime-action="set-combat-target" data-entry-id="${escapeHtml(entry.entry_id || "")}" ${isCurrent ? "disabled" : ""}>Сделать целью</button>
        ${canManage ? `<button class="btn" type="button" data-master-runtime-action="set-combat-turn-entry" data-entry-id="${escapeHtml(entry.entry_id || "")}">Ход сюда</button>` : ""}
      </div>
      <p class="master-runtime-muted small">Эта плашка меняется от выбранного токена. Пул монстров и редактор сцены ниже не должны быть главным боевым фокусом.</p>
    </section>
  `;
}

function getEntityKindLabelForMaster(entry = {}) {
  const raw = displayText(entry.entity_kind || entry.entry_type || entry.type, "").toLowerCase();
  if (raw === "enemy") return "Враг";
  if (raw === "npc") return "NPC";
  if (raw === "ally") return "Союзник";
  return "Персонаж";
}

function getCurrentCombatEntry(combat = {}) {
  const entries = safeArray(combat.entries);
  if (!entries.length) return null;
  const index = Math.max(0, Math.min(entries.length - 1, safeNumber(combat.turn_index, 0)));
  return entries[index] || entries[0] || null;
}

function canControlCombatEntry(table, entry, canManage = false) {
  if (!entry) return false;
  if (canManage) return true;
  if (entry.type === "enemy" || entry.entity_kind === "enemy") return false;
  const member = getCurrentMember(table);
  const user = getCurrentUser();
  const keys = [
    String(member?.id || ""),
    String(member?.user_id || ""),
    String(member?.email || ""),
    String(member?.nickname || ""),
    String(member?.selected_character_name || ""),
    String(user?.id || ""),
    String(user?.email || ""),
    String(user?.nickname || ""),
  ].filter(Boolean);
  return keys.includes(String(entry.membership_id || "")) || keys.includes(String(entry.player_name || "")) || keys.includes(String(entry.name || ""));
}

function movementDirectionLabel(direction = "") {
  return ({
    n: "север", s: "юг", e: "восток", w: "запад",
    ne: "северо-восток", nw: "северо-запад", se: "юго-восток", sw: "юго-запад",
    up: "вверх", down: "вниз",
  })[String(direction || "").toLowerCase()] || "движение";
}

function getMovementDelta(direction = "e", distance = 5) {
  const step = Math.max(0, safeNumber(distance, 5));
  const key = String(direction || "e").toLowerCase();
  const deltas = {
    n: { x: 0, y: -step, z: 0 },
    s: { x: 0, y: step, z: 0 },
    e: { x: step, y: 0, z: 0 },
    w: { x: -step, y: 0, z: 0 },
    ne: { x: step, y: -step, z: 0 },
    nw: { x: -step, y: -step, z: 0 },
    se: { x: step, y: step, z: 0 },
    sw: { x: -step, y: step, z: 0 },
    up: { x: 0, y: 0, z: step },
    down: { x: 0, y: 0, z: -step },
  };
  return deltas[key] || deltas.e;
}


function buildMovementPreview(table, payload = {}) {
  const combat = normalizeCombat(table?.combat, table);
  const scene = normalizeCombatScene(combat.scene, table);
  const entries = safeArray(combat.entries);
  const fallbackEntry = getCurrentCombatEntry(combat);
  const entry = entries.find((item) => String(item.entry_id) === String(payload.entryId || payload.entry_id || "")) || fallbackEntry;
  if (!entry) return null;

  const requestedDistance = Math.max(1, safeNumber(payload.distance, scene.grid_size_ft || 5));
  const rawDistance = snapMovementDistance(requestedDistance, scene);
  const direction = displayText(payload.direction, "e").toLowerCase();
  const rule = getMovementRuleState(entry, scene);
  const freeMove = Boolean(payload.freeMove || payload.free_move);
  const cost = getMovementCost(rawDistance, rule, direction);
  const delta = getMovementDelta(direction, rawDistance);
  const token = snapScenePosition(normalizeCombatSceneToken(entry, 0, entry.type), scene);
  const from = {
    x: token.x,
    y: token.y,
    z: token.z,
  };
  const unclampedTo = snapScenePosition({
    x: safeNumber(token.x, 0) + delta.x,
    y: safeNumber(token.y, 0) + delta.y,
    z: safeNumber(token.z, 0) + delta.z,
  }, scene);
  const to = {
    x: clampSceneNumber(unclampedTo.x, 0, scene.width),
    y: clampSceneNumber(unclampedTo.y, 0, scene.height),
    z: unclampedTo.z,
  };
  const boundaryBlocked = direction !== "up" && direction !== "down" && to.x === from.x && to.y === from.y;
  const collision = findCombatSceneCollision(entries, entry, to, scene);
  const resourceOk = freeMove || (!rule.hardStop && cost <= rule.movementRemaining && isEligibleCombatTurn(entry));
  const ok = resourceOk && !boundaryBlocked && !collision;
  let message = `${entry.name || "Участник"}: ${movementDirectionLabel(direction)} ${rawDistance} фт. • стоит ${cost} фт. • осталось ${rule.movementRemaining}/${rule.movementTotal} фт.`;
  if (requestedDistance !== rawDistance) message += ` • шаг привязан к сетке ${getSceneGridSize(scene)} фт.`;
  if (freeMove) message = `${entry.name || "Участник"}: ${movementDirectionLabel(direction)} ${rawDistance} фт. • GM-перестановка без траты движения`;
  if (rule.hardStop && !freeMove) message = rule.reasons[0] || "Движение заблокировано состоянием";
  else if (cost > rule.movementRemaining && !freeMove) message = `Не хватает движения: нужно ${cost} фт., осталось ${rule.movementRemaining} фт.`;
  else if (boundaryBlocked) message = "Дальше край карты: токен остаётся в текущей клетке";
  else if (collision) message = `Клетка занята: ${collision.name || "другой участник"}. Токены не могут стоять друг на друге.`;

  return {
    entryId: entry.entry_id || "",
    entryName: entry.name || "Участник",
    direction,
    directionLabel: movementDirectionLabel(direction),
    requestedDistance,
    distance: rawDistance,
    cost,
    remaining: rule.movementRemaining,
    total: rule.movementTotal,
    freeMove,
    ok,
    message,
    collisionEntryId: collision?.entry_id || "",
    collisionName: collision?.name || "",
    from,
    to,
    fromPct: { x: from.x / Math.max(1, scene.width) * 100, y: from.y / Math.max(1, scene.height) * 100 },
    toPct: { x: to.x / Math.max(1, scene.width) * 100, y: to.y / Math.max(1, scene.height) * 100 },
  };
}

function updateMovementPreviewDom(root, preview) {
  if (!root || !preview) return;
  root.querySelectorAll(".master-runtime-scene-map").forEach((map) => {
    const line = map.querySelector("[data-master-runtime-route-line]");
    const end = map.querySelector("[data-master-runtime-route-end]");
    const card = map.querySelector("[data-master-runtime-route-card]");
    if (!line || !end || !card) return;
    line.setAttribute("x1", String(preview.fromPct.x));
    line.setAttribute("y1", String(preview.fromPct.y));
    line.setAttribute("x2", String(preview.toPct.x));
    line.setAttribute("y2", String(preview.toPct.y));
    end.setAttribute("cx", String(preview.toPct.x));
    end.setAttribute("cy", String(preview.toPct.y));
    card.hidden = false;
    card.textContent = preview.message;
    card.style.left = `${Math.max(4, Math.min(82, preview.toPct.x))}%`;
    card.style.top = `${Math.max(8, Math.min(82, preview.toPct.y))}%`;
    map.classList.toggle("has-route-preview", true);
    map.classList.toggle("route-preview-bad", !preview.ok);
  });

  const status = root.querySelector("[data-master-runtime-move-preview-status]");
  if (status) {
    status.hidden = false;
    status.textContent = preview.message;
    status.classList.toggle("bad", !preview.ok);
  }
}

function clearMovementPreviewDom(root) {
  if (!root) return;
  root.querySelectorAll(".master-runtime-scene-map").forEach((map) => {
    const card = map.querySelector("[data-master-runtime-route-card]");
    if (card) {
      card.hidden = true;
      card.textContent = "";
    }
    map.classList.remove("has-route-preview", "route-preview-bad");
  });
  const status = root.querySelector("[data-master-runtime-move-preview-status]");
  if (status) {
    status.hidden = true;
    status.textContent = "";
    status.classList.remove("bad");
  }
}

function confirmMasterAction(message = "Подтвердить действие?") {
  if (typeof window === "undefined" || typeof window.confirm !== "function") return true;
  return window.confirm(message);
}

function confirmMovementPreview(preview) {
  if (!preview) return false;
  return confirmMasterAction(`${preview.ok ? "Подтвердить движение" : "Движение невозможно"}\n\n${preview.message}\n\nОткуда: X${Math.round(preview.from.x)} Y${Math.round(preview.from.y)} Z${Math.round(preview.from.z || 0)}\nКуда: X${Math.round(preview.to.x)} Y${Math.round(preview.to.y)} Z${Math.round(preview.to.z || 0)}`);
}

function combatPayloadConfirmText(table, payload = {}) {
  const combat = normalizeCombat(table?.combat, table);
  const actor = safeArray(combat.entries).find((entry) => String(entry.entry_id) === String(payload.entry_id || payload.actor_entry_id || "")) || combat.entries?.[combat.turn_index] || {};
  const target = safeArray(combat.entries).find((entry) => String(entry.entry_id) === String(payload.target_entry_id || "")) || {};
  const type = displayText(payload.action_type || payload.event_type, "действие");
  const lines = [
    `Участник: ${payload.actor_name || actor.name || "—"}`,
    target?.name || payload.target_name ? `Цель: ${payload.target_name || target.name}` : "Цель: —",
    `Тип: ${type}`,
    payload.reason ? `Описание: ${payload.reason}` : "",
    payload.damage ? `Урон/леч.: ${payload.damage}` : "",
    payload.dice ? `Куб: ${payload.dice}` : "",
  ].filter(Boolean);
  return `Подтвердить действие?\n\n${lines.join("\n")}`;
}

function hpPatchConfirmText(table, entryId, delta, type = "damage") {
  const combat = normalizeCombat(table?.combat, table);
  const entry = safeArray(combat.entries).find((item) => String(item.entry_id) === String(entryId));
  if (!entry) return "Подтвердить изменение HP?";
  const current = safeNumber(entry.hp_current, 0);
  const max = safeNumber(entry.hp_max, current || 1);
  const next = Math.max(0, Math.min(max, current + delta));
  const label = type === "heal" ? "лечение" : "урон";
  return `Подтвердить ${label}?\n\nЦель: ${entry.name || "—"}\nHP: ${current}/${max} → ${next}/${max}\nИзменение: ${delta > 0 ? "+" : ""}${delta}`;
}

function renderCombatMovementPanel(table, canManage = false) {
  const combat = normalizeCombat(table?.combat, table);
  const scene = normalizeCombatScene(combat.scene, table);
  const entry = getCurrentCombatEntry(combat);
  if (!entry) {
    return `
      <section class="master-runtime-panel master-runtime-movement-panel">
        <div class="master-runtime-panel-head"><span>Движение</span><small>нет инициативы</small></div>
        <p class="master-runtime-muted">Сначала собери инициативу, создай сцену или добавь монстра из Бестиария.</p>
      </section>
    `;
  }

  const token = normalizeCombatSceneToken(entry, 0, entry.type);
  const turn = normalizeMasterTurnResources(entry, entry.speed);
  const rule = getMovementRuleState(entry, scene);
  const step = Math.max(1, safeNumber(scene.grid_size_ft, 5));
  const previewCost = getMovementCost(step, rule, "e");
  const allowed = canControlCombatEntry(table, entry, canManage) && isEligibleCombatTurn(entry) && !rule.hardStop;
  const disabled = allowed ? "" : "disabled";
  const canAction = allowed && turn.action_available;
  const canBonus = allowed && turn.bonus_action_available;
  const canStand = allowed && rule.hasProne && rule.movementRemaining >= Math.ceil(Math.max(rule.effectiveSpeed || rule.baseSpeed || step, step) / 2);
  const directionButtons = [
    ["nw", "↖"], ["n", "↑"], ["ne", "↗"],
    ["w", "←"], ["stay", "●"], ["e", "→"],
    ["sw", "↙"], ["s", "↓"], ["se", "↘"],
  ].map(([dir, label]) => dir === "stay"
    ? `<span class="master-runtime-move-center">${label}</span>`
    : `<button class="btn master-runtime-move-btn" type="button" title="Наведи — покажу маршрут и стоимость. Клик — подтверждение движения." data-master-runtime-action="move-combat-token" data-move-dir="${dir}" data-entry-id="${escapeHtml(entry.entry_id)}" ${disabled}>${label}</button>`
  ).join("");

  const reasons = rule.reasons.length
    ? `<div class="master-runtime-move-rule-reasons">${rule.reasons.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`
    : `<div class="master-runtime-move-rule-reasons"><span>обычное движение</span></div>`;

  return `
    <section class="master-runtime-panel master-runtime-movement-panel">
      <div class="master-runtime-panel-head"><span>Движение хода</span><small>${escapeHtml(entry.name || "участник")}</small></div>
      <div class="master-runtime-movement-status">
        <div><small>Осталось</small><strong>${escapeHtml(String(rule.movementRemaining))}/${escapeHtml(String(rule.movementTotal))} фт.</strong></div>
        <div><small>Скорость</small><strong>${escapeHtml(String(rule.effectiveSpeed))} фт. <small>из ${escapeHtml(String(rule.baseSpeed))}</small></strong></div>
        <div><small>Позиция</small><strong>X${escapeHtml(String(Math.round(token.x)))} Y${escapeHtml(String(Math.round(token.y)))} Z${escapeHtml(String(Math.round(token.z || 0)))}</strong></div>
        <div><small>Шаг стоит</small><strong>${escapeHtml(String(previewCost))} фт.</strong></div>
      </div>
      ${movementRuleBadges(rule)}
      ${reasons}
      <div class="master-runtime-move-maneuvers">
        <button class="btn" type="button" data-master-runtime-action="combat-move-maneuver" data-move-maneuver="dash_action" data-entry-id="${escapeHtml(entry.entry_id)}" ${canAction ? "" : "disabled"}>Рывок действием</button>
        <button class="btn" type="button" data-master-runtime-action="combat-move-maneuver" data-move-maneuver="dash_bonus" data-entry-id="${escapeHtml(entry.entry_id)}" ${canBonus ? "" : "disabled"}>Рывок бонусом</button>
        <button class="btn" type="button" data-master-runtime-action="combat-move-maneuver" data-move-maneuver="disengage_action" data-entry-id="${escapeHtml(entry.entry_id)}" ${canAction ? "" : "disabled"}>Отступление действием</button>
        <button class="btn" type="button" data-master-runtime-action="combat-move-maneuver" data-move-maneuver="disengage_bonus" data-entry-id="${escapeHtml(entry.entry_id)}" ${canBonus ? "" : "disabled"}>Отступление бонусом</button>
        <button class="btn" type="button" data-master-runtime-action="combat-move-maneuver" data-move-maneuver="stand_prone" data-entry-id="${escapeHtml(entry.entry_id)}" ${canStand ? "" : "disabled"}>Встать</button>
      </div>
      <label class="master-runtime-move-distance">Шаг, фт.<input id="masterRuntimeMoveDistance" type="number" min="1" value="${escapeHtml(String(step))}" ${disabled}></label>
      <div class="master-runtime-move-grid">${directionButtons}</div>
      <div class="master-runtime-move-preview-status" data-master-runtime-move-preview-status hidden></div>
      <div class="master-runtime-move-height">
        <button class="btn" type="button" data-master-runtime-action="move-combat-token" data-move-dir="up" data-entry-id="${escapeHtml(entry.entry_id)}" ${disabled}>Высота +</button>
        <button class="btn" type="button" data-master-runtime-action="move-combat-token" data-move-dir="down" data-entry-id="${escapeHtml(entry.entry_id)}" ${disabled}>Высота −</button>
      </div>
      <label class="master-runtime-move-free"><input id="masterRuntimeMoveFree" type="checkbox" ${canManage ? "" : "disabled"}> GM: не тратить движение</label>
      <p class="master-runtime-muted">Движение проверяет скорость, остаток футов, трудную местность и блокирующие состояния. Рывок добавляет скорость, отступление ставит флаг до конца хода.</p>
    </section>
  `;
}

function renderCombatSceneContractPanel(table, combat, canManage = false) {
  const scene = normalizeCombatScene(combat?.scene, table);
  const entries = safeArray(combat?.entries);
  const rows = entries.map((entry, index) => {
    const token = normalizeCombatSceneToken(entry, index, entry.type);
    const deadMark = isDeadEnemyCombatEntry(entry) ? " ✕" : displayText(entry.status, "") === "down" ? " ↓" : "";
    return `
      <div class="master-runtime-scene-token-row">
        <strong>${escapeHtml(entry.name || "Участник")}${deadMark}</strong>
        <label>X<input type="number" step="${escapeHtml(String(scene.grid_size_ft))}" data-master-runtime-scene-entry-field="x" data-entry-id="${escapeHtml(entry.entry_id)}" value="${escapeHtml(String(Math.round(snapSceneCoordinate(token.x, scene, "x"))))}" ${canManage ? "" : "disabled"}></label>
        <label>Y<input type="number" step="${escapeHtml(String(scene.grid_size_ft))}" data-master-runtime-scene-entry-field="y" data-entry-id="${escapeHtml(entry.entry_id)}" value="${escapeHtml(String(Math.round(snapSceneCoordinate(token.y, scene, "y"))))}" ${canManage ? "" : "disabled"}></label>
        <label>Высота<input type="number" step="${escapeHtml(String(scene.grid_size_ft))}" data-master-runtime-scene-entry-field="z" data-entry-id="${escapeHtml(entry.entry_id)}" value="${escapeHtml(String(Math.round(token.z || 0)))}" ${canManage ? "" : "disabled"}></label>
        <label>Укрытие
          <select data-master-runtime-scene-entry-field="cover" data-entry-id="${escapeHtml(entry.entry_id)}" ${canManage ? "" : "disabled"}>
            ${["none", "half", "three_quarters", "full"].map((value) => `<option value="${value}" ${token.cover === value ? "selected" : ""}>${escapeHtml(coverLabel(value))}</option>`).join("")}
          </select>
        </label>
        <label class="master-runtime-scene-visible-toggle"><input type="checkbox" data-master-runtime-scene-entry-visible="${escapeHtml(entry.entry_id)}" ${token.visible_to_players ? "checked" : ""} ${canManage ? "" : "disabled"}> игрокам</label>
        ${canManage ? `<button class="btn" type="button" data-master-runtime-action="center-combat-token" data-entry-id="${escapeHtml(entry.entry_id)}">в центр</button>` : ""}
      </div>
    `;
  }).join("");

  return `
    <section class="master-runtime-scene-contract-panel">
      <div class="master-runtime-panel-head"><span>Сцена / движение / видимость</span><small>map contract</small></div>
      <div class="master-runtime-scene-contract-grid">
        <label>Карта<input id="masterRuntimeCombatSceneMapName" value="${escapeHtml(scene.map_name)}" ${canManage ? "" : "disabled"}></label>
        <label>Ширина, фт.<input id="masterRuntimeCombatSceneWidth" type="number" min="20" value="${escapeHtml(String(scene.width))}" ${canManage ? "" : "disabled"}></label>
        <label>Высота, фт.<input id="masterRuntimeCombatSceneHeight" type="number" min="20" value="${escapeHtml(String(scene.height))}" ${canManage ? "" : "disabled"}></label>
        <label>Клетка, фт.<input id="masterRuntimeCombatSceneGrid" type="number" min="1" value="${escapeHtml(String(scene.grid_size_ft))}" ${canManage ? "" : "disabled"}></label>
        <label>Свет<input id="masterRuntimeCombatSceneLight" value="${escapeHtml(scene.light)}" ${canManage ? "" : "disabled"}></label>
        <label>Поверхность<input id="masterRuntimeCombatSceneTerrain" value="${escapeHtml(scene.terrain)}" ${canManage ? "" : "disabled"}></label>
        <label>Видимость
          <select id="masterRuntimeCombatSceneVisibility" ${canManage ? "" : "disabled"}>
            ${["party", "public", "gm"].map((value) => `<option value="${value}" ${scene.visibility_mode === value ? "selected" : ""}>${escapeHtml(sceneVisibilityLabel(value))}</option>`).join("")}
          </select>
        </label>
        ${canManage ? `<button class="btn btn-primary" type="button" data-master-runtime-action="save-combat-scene">Сохранить карту сцены</button>` : ""}
      </div>
      ${canManage ? `
        <div class="master-runtime-scene-contract-actions">
          <button class="btn" type="button" data-master-runtime-action="seed-combat-scene">Создать/расставить сцену</button>
          <button class="btn" type="button" data-master-runtime-action="start-combat">Собрать LSS в бой</button>
          <button class="btn" type="button" data-master-runtime-action="add-selected-enemy">Добавить выбранного монстра</button>
        </div>
      ` : ""}
      ${renderCombatSceneMap(combat, { compact: false, canManage })}
      <div class="master-runtime-scene-token-editor">
        ${rows || `<div class="master-runtime-empty">Сначала собери инициативу или добавь монстра.</div>`}
      </div>
    </section>
  `;
}

function coverLabel(value = "none") {
  const map = { none: "нет", half: "1/2", three_quarters: "3/4", full: "полное" };
  return map[value] || value || "нет";
}

function sceneVisibilityLabel(value = "party") {
  const map = { party: "партия", public: "публично", gm: "только GM" };
  return map[value] || value || "партия";
}

function renderCompactEventPanel(table, limit = 4) {
  const events = getVisibleMasterEvents(table, canManageTable(table)).slice(0, limit);
  return `
    <section class="master-runtime-panel master-runtime-compact-events">
      <button class="master-runtime-panel-head master-runtime-mini-journal-head" type="button" data-master-runtime-action="open-journal" title="Открыть полный журнал событий">
        <span>Журнал</span><small>${escapeHtml(String(safeArray(table?.events).length))}</small>
      </button>
      <button class="master-runtime-mini-journal-open" type="button" data-master-runtime-action="open-journal">
        Открыть полный журнал
      </button>
      <div class="master-runtime-event-list compact" data-master-runtime-action="open-journal" role="button" tabindex="0" title="Открыть журнал">
        ${events.length ? events.map(renderEventRow).join("") : `<div class="master-runtime-muted">Событий пока нет.</div>`}
      </div>
    </section>
  `;
}

function renderDiceDrawer(table) {
  const combat = normalizeCombat(table?.combat, table);
  const open = MASTER_ROOM_STATE.ui.diceDrawerOpen;
  return `
    <details class="master-runtime-panel master-runtime-dice-drawer" ${open ? "open" : ""}>
      <summary>🎲 Кубы <small>${combat.last_roll ? escapeHtml(`${combat.last_roll.total} ${combat.last_roll.dice || ""}`) : "быстро"}</small></summary>
      <div class="master-runtime-dice-grid">
        ${["d4", "d6", "d8", "d10", "d12", "d20", "d100"].map((die) => `
          <button class="btn" type="button" data-master-runtime-roll-die="${die}">${die.toUpperCase()}</button>
        `).join("")}
      </div>
      <div class="master-runtime-last-roll">
        ${combat.last_roll ? `<strong>${escapeHtml(String(combat.last_roll.total))}</strong><span>${escapeHtml(combat.last_roll.dice || "")}</span>` : `<span>Последний бросок появится здесь.</span>`}
      </div>
    </details>
  `;
}

function renderShellHeader(table, canManage) {
  const members = safeArray(table?.members);
  const combat = normalizeCombat(table?.combat, table);
  // Round 37: убрали верхнюю командную линию из hero. Быстрые команды теперь
  // живут в контексте вкладки, а hero остаётся спокойной паспортной шапкой стола.
  return `
    <header class="master-runtime-hero master-runtime-hero-clean">
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
            <span>${canManage ? "GM layer" : "player layer"}</span>
            <button class="master-runtime-inline-lobby" type="button" data-master-runtime-action="back-to-table-list">← к столам</button>
            <button class="master-runtime-inline-exit" type="button" data-master-runtime-action="exit-to-cabinet">← в кабинет</button>
          </div>
        </div>
      </div>
      <div class="master-runtime-hero-stats">
        ${renderMetric("Сессия", table ? "активна" : "нет", "●")}
        ${renderMetric("Онлайн", members.filter((m) => m.online).length, "◉")}
        ${renderMetric("Сцена", clampText(table?.scene || "—", 22), "✦")}
        ${renderMetric("Раунд", combat.active ? combat.round : "—", "⚔")}
      </div>
    </header>
  `;
}

function renderTableTabs(table = getActiveTable(), canManage = false) {
  const tabs = getVisibleMasterTabs(table, canManage);
  return `
    <nav class="master-runtime-tabs" aria-label="Master Room tabs">
      ${tabs.map((tab) => `
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
        <div class="master-runtime-lobby-tools">
          <input class="master-runtime-lobby-search" id="masterRuntimeTableSearch" placeholder="Поиск по столам / кампании / коду" value="${escapeHtml(MASTER_ROOM_STATE.searchQuery || "")}">
          <button class="btn" type="button" data-master-runtime-action="clear-table-search">Сбросить</button>
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
  const query = String(MASTER_ROOM_STATE.searchQuery || "").trim().toLowerCase();
  const allTables = MASTER_ROOM_STATE.tables;
  const tables = query
    ? allTables.filter((table) => [table.title, table.campaign, table.scene, table.token].some((value) => String(value || "").toLowerCase().includes(query)))
    : allTables;
  if (!allTables.length) return `<div class="master-runtime-empty">Пока нет столов. Создай первый или введи код приглашения.</div>`;
  if (!tables.length) return `<div class="master-runtime-empty">По этому поиску столы не найдены.</div>`;
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
  // Round 37: rail оставлен только там, где он реально помогает.
  // На небоевых вкладках не держим сбоку журнал/кубы/GM-команды: это дублирует
  // вкладки и ломает фокус. Для игрока GM-инструменты не рендерятся.
  const tab = MASTER_ROOM_STATE.activeTab || "table";
  if (!table) return "";
  if (tab !== "combat") return "";

  return `
    <aside class="master-runtime-rail master-runtime-rail-context master-runtime-rail-combat">
      ${canManage ? `
        <section class="master-runtime-panel master-runtime-context-panel">
          <div class="master-runtime-panel-head"><span>GM-инструменты боя</span><small>скрыто от игроков</small></div>
          <div class="master-runtime-quick-grid master-runtime-context-grid">
            ${renderContextNavButtons("combat", canManage)}
          </div>
          ${renderActorModelHint("combat")}
        </section>
      ` : `
        <section class="master-runtime-panel master-runtime-context-panel">
          <div class="master-runtime-panel-head"><span>Ход боя</span><small>player layer</small></div>
          <p class="master-runtime-muted">Игрок видит только открытую сцену, свой ход и публичный журнал.</p>
        </section>
      `}
      ${renderCombatSceneMiniPanel(table, canManage)}
      ${renderCombatSelectedPanel(table, canManage)}
      ${renderCombatMovementPanel(table, canManage)}
      ${renderDiceDrawer(table)}
      ${renderCompactEventPanel(table, 4)}
    </aside>
  `;
}

const MASTER_JOURNAL_FILTERS = [
  { key: "all", label: "Все" },
  { key: "combat", label: "Бой" },
  { key: "move", label: "Мувы" },
  { key: "attack", label: "Атаки" },
  { key: "spell", label: "Спеллы" },
  { key: "hp", label: "HP" },
  { key: "effect", label: "Эффекты" },
  { key: "dice", label: "Кубы/проверки" },
  { key: "system", label: "Система" },
  { key: "note", label: "Заметки" },
];

function getMasterJournalCategory(event = {}) {
  const raw = displayText(event.combat_type || event.event_type || event.type, "system").toLowerCase();
  if (["move", "movement", "dash", "disengage"].includes(raw)) return "move";
  if (["attack", "weapon_attack", "melee", "ranged"].includes(raw)) return "attack";
  if (["spell", "spell_attack", "cast"].includes(raw)) return "spell";
  if (["damage", "heal", "healing", "hp"].includes(raw)) return "hp";
  if (["effect", "condition", "buff", "debuff", "trap", "zone"].includes(raw)) return "effect";
  if (["roll", "check", "save", "saving_throw", "dice"].includes(raw)) return "dice";
  if (["note", "notes"].includes(raw) || String(event.type || "").toLowerCase() === "note") return "note";
  if (["turn", "round", "combat", "spawn", "death", "down"].includes(raw)) return "combat";
  return "system";
}

function getMasterJournalCategoryLabel(category = "system") {
  return MASTER_JOURNAL_FILTERS.find((item) => item.key === category)?.label || "Система";
}

function getMasterJournalActors(events = []) {
  const values = new Set();
  safeArray(events).forEach((event) => {
    const actor = displayText(event.actor || event.actor_name, "");
    if (actor && actor !== "system") values.add(actor);
  });
  return Array.from(values).sort((a, b) => a.localeCompare(b, "ru"));
}

function masterJournalEventMatchesFilter(event = {}, filter = "all") {
  const category = getMasterJournalCategory(event);
  if (filter === "all") return true;
  if (filter === "combat") return ["combat", "move", "attack", "spell", "hp", "effect", "dice"].includes(category);
  return category === filter;
}

function getFilteredMasterEvents(table = getActiveTable(), canManage = false) {
  const events = getVisibleMasterEvents(table, canManage);
  const filter = displayText(MASTER_ROOM_STATE.ui.journalFilter, "all");
  const query = displayText(MASTER_ROOM_STATE.ui.journalQuery, "").toLowerCase();
  const actor = displayText(MASTER_ROOM_STATE.ui.journalActor, "all");
  return events.filter((event) => {
    if (!masterJournalEventMatchesFilter(event, filter)) return false;
    const eventActor = displayText(event.actor || event.actor_name, "");
    if (actor !== "all" && eventActor !== actor) return false;
    if (!query) return true;
    const haystack = [
      event.title,
      event.description,
      event.actor,
      event.target_name,
      event.combat_type,
      event.type,
      event.dice,
      event.outcome,
      event.damage_type,
    ].map((value) => displayText(value, "").toLowerCase()).join(" ");
    return haystack.includes(query);
  });
}

function renderMasterJournalRows(table, canManage = false) {
  const filtered = getFilteredMasterEvents(table, canManage);
  const limit = Math.max(12, safeNumber(MASTER_ROOM_STATE.ui.journalVisibleCount, 36));
  const visible = filtered.slice(0, limit);
  return {
    filtered,
    visible,
    html: visible.length ? visible.map(renderEventRow).join("") : `<div class="master-runtime-empty">По выбранным фильтрам событий нет.</div>`,
  };
}

function renderMasterJournalDetails(table, canManage = false) {
  const events = getFilteredMasterEvents(table, canManage);
  const event = events.find((item) => String(item.id) === String(MASTER_ROOM_STATE.ui.selectedEventId)) || events[0];
  if (!event) return `<p class="master-runtime-muted">Выбери событие в журнале.</p>`;
  const category = getMasterJournalCategory(event);
  const facts = [
    event.actor ? ["Кто", event.actor] : null,
    event.target_name ? ["Цель", event.target_name] : null,
    event.round ? ["Раунд", event.round] : null,
    event.dice ? ["Куб", event.dice] : null,
    event.total !== null && event.total !== undefined ? ["Итог", event.total] : null,
    event.damage ? ["HP", `${event.damage}${event.damage_type ? ` ${event.damage_type}` : ""}`] : null,
    event.turn_resource ? ["Ресурс", event.turn_resource] : null,
    event.outcome ? ["Результат", event.outcome] : null,
  ].filter(Boolean);
  return `
    <div class="master-runtime-journal-detail-head">
      <span>${escapeHtml(getMasterJournalCategoryLabel(category))}</span>
      <time>${escapeHtml(formatDateTime(event.created_at))}</time>
    </div>
    <h3>${escapeHtml(event.title)}</h3>
    <p>${escapeHtml(event.description || "Без подробностей")}</p>
    ${facts.length ? `<div class="master-runtime-journal-facts">${facts.map(([label, value]) => `<div><small>${escapeHtml(String(label))}</small><strong>${escapeHtml(String(value))}</strong></div>`).join("")}</div>` : ""}
    <small>${escapeHtml(event.scope || "public")}</small>
  `;
}

function bindMasterJournalEventRows(root, table, canManage) {
  root.querySelectorAll("[data-master-runtime-event]").forEach((btn) => {
    if (btn.dataset.boundMasterEvent === "1") return;
    btn.dataset.boundMasterEvent = "1";
    btn.addEventListener("click", () => {
      MASTER_ROOM_STATE.ui.selectedEventId = btn.dataset.masterRuntimeEvent || "";
      root.querySelectorAll("[data-master-runtime-event]").forEach((row) => row.classList.toggle("active", row === btn));
      const details = root.querySelector("[data-master-journal-details]");
      if (details) details.innerHTML = renderMasterJournalDetails(table, canManage);
    });
  });
}

function refreshMasterJournalDom(root, table, canManage = false) {
  if (!root || !table) return;
  const rows = renderMasterJournalRows(table, canManage);
  const list = root.querySelector("[data-master-journal-list]");
  if (list) list.innerHTML = rows.html;
  const count = root.querySelector("[data-master-journal-count]");
  if (count) count.textContent = `${rows.visible.length} из ${rows.filtered.length}`;
  const more = root.querySelector("[data-master-journal-more]");
  if (more) {
    more.hidden = rows.visible.length >= rows.filtered.length;
    more.textContent = `Показать ещё (${Math.min(36, Math.max(0, rows.filtered.length - rows.visible.length))})`;
  }
  const details = root.querySelector("[data-master-journal-details]");
  if (details) details.innerHTML = renderMasterJournalDetails(table, canManage);
  root.querySelectorAll("[data-master-journal-filter]").forEach((btn) => btn.classList.toggle("active", btn.dataset.masterJournalFilter === MASTER_ROOM_STATE.ui.journalFilter));
  bindMasterJournalEventRows(root, table, canManage);
}

function renderEventRow(event) {
  const category = getMasterJournalCategory(event);
  const actor = displayText(event.actor || event.actor_name, "system");
  const target = displayText(event.target_name, "");
  const meta = [actor !== "system" ? actor : "", target ? `→ ${target}` : "", event.round ? `Раунд ${event.round}` : ""].filter(Boolean).join(" • ");
  return `
    <button class="master-runtime-event-row master-runtime-event-${escapeHtml(category)} ${String(event.id) === String(MASTER_ROOM_STATE.ui.selectedEventId) ? "active" : ""}" type="button" data-master-runtime-event="${escapeHtml(event.id)}">
      <span class="master-runtime-event-icon">${eventIcon(event.combat_type || event.type)}</span>
      <span class="master-runtime-event-copy">
        <span class="master-runtime-event-kicker">${escapeHtml(getMasterJournalCategoryLabel(category))}${meta ? ` • ${escapeHtml(meta)}` : ""}</span>
        <strong>${escapeHtml(event.title)}</strong>
        <small>${escapeHtml(clampText(event.description || actor, 110))}</small>
      </span>
      <time>${escapeHtml(formatTime(event.created_at))}</time>
    </button>
  `;
}

function eventIcon(type) {
  const value = displayText(type, "system").toLowerCase();
  const map = {
    combat: "⚔", turn: "➜", round: "◎", spawn: "＋",
    move: "➜", movement: "➜", attack: "⚔", spell: "✦",
    roll: "◇", check: "◇", save: "🛡", damage: "🔥", heal: "✚",
    effect: "◌", buff: "↑", debuff: "↓", trap: "⚠",
    grant: "✦", table: "♛", access: "▣", note: "✎", system: "◉",
  };
  return map[value] || "•";
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
        <div class="master-runtime-actions-row master-runtime-context-actions-row">
          ${renderContextNavButtons("table", canManage)}
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
      <div class="master-runtime-card-actions">
        ${canManage ? `<button class="btn" type="button" data-master-runtime-action="sync-member-lss" data-member-id="${escapeHtml(member.id)}">Связать LSS</button>` : ""}
        <button class="btn" type="button" data-master-runtime-action="open-lss">Открыть LSS</button>
        <button class="btn" type="button" data-master-runtime-action="open-inventory">Снаряжение</button>
      </div>
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
      <div class="master-runtime-actions-row master-runtime-context-actions-row">
        <button class="btn" type="button" data-master-runtime-action="open-lss">Открыть LSS</button>
        <button class="btn" type="button" data-master-runtime-action="open-inventory">Инвентарь</button>
        <button class="btn" type="button" data-master-runtime-tab-shortcut="combat">В бой</button>
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
        <p>Торговцы берутся из проекта, а будущий склад будет считаться от роли, уровня, навыка торговли и доступных item sources.</p>
        <div class="master-runtime-quick-grid master-runtime-context-grid">
          <button class="btn" type="button" data-master-runtime-action="open-inventory">Каталог предметов</button>
          <button class="btn" type="button" data-master-runtime-action="open-map">Сцена/карта</button>
          <button class="btn" type="button" data-master-runtime-tab-shortcut="journal">Журнал событий</button>
        </div>
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
        <div class="master-runtime-actions-row master-runtime-context-actions-row">
          <button class="btn" type="button" data-master-runtime-action="open-inventory">Открыть инвентарь</button>
          <button class="btn" type="button" data-master-runtime-action="open-map">Карта/сцена</button>
        </div>
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
  if (canManage) queueBestiaryBridgeLoad({ focusSelector: "#masterRuntimeEnemySearch" });
  const { allMonsters, monsters, selectedId, selectedMonster } = getBestiaryMonsterSelection();
  table.combat = combat;
  return `
    <div class="master-runtime-stage master-runtime-stage-combat master-runtime-stage-combat-round32">
      <section class="master-runtime-combat-host master-runtime-combat-host-round32">
        ${renderCombatModule({
          table,
          combat,
          canManage,
          tableTitle: table.title,
          logFilter: MASTER_ROOM_STATE.ui.combatLogFilter || "all",
          hideSecondary: Boolean(MASTER_ROOM_STATE.ui.combatHideSecondary),
          diceType: "d20",
          environment: combat.environment,
        })}
      </section>
      ${canManage ? `
        <details class="master-runtime-panel master-runtime-combat-setup master-runtime-combat-setup-round32" ${(!safeArray(combat.entries).length || MASTER_ROOM_STATE.ui.combatSetupOpen) ? "open" : ""}>
          <summary><span>Подготовка боя</span><small>GM • LSS + инвентарь + карта + бестиарий</small></summary>
          <div class="master-runtime-combat-setup-grid">
            <div class="master-runtime-combat-setup-actions">
              <button class="btn" type="button" data-master-runtime-action="open-lss">LSS партии</button>
              <button class="btn" type="button" data-master-runtime-action="open-inventory">Инвентарь/эффекты</button>
              <button class="btn" type="button" data-master-runtime-action="open-map">Карта боя</button>
              <button class="btn" type="button" data-master-runtime-action="open-bestiary-pool">Пул монстров</button>
              <button class="btn" type="button" data-master-runtime-action="open-bestiary">Полный Бестиарий</button>
            </div>
            ${renderActorModelHint("combat")}
            <button class="btn btn-primary" type="button" data-master-runtime-action="start-combat">Собрать инициативу из LSS</button>
            <div class="master-runtime-bestiary-picker">
              <label>Поиск монстра
                <input id="masterRuntimeEnemySearch" placeholder="Имя, тип, источник" value="${escapeHtml(MASTER_ROOM_STATE.ui.bestiaryMonsterSearch || "")}">
              </label>
              <label>Монстр из Бестиария
                <select id="masterRuntimeEnemySelect">
                  ${renderMonsterOptions(monsters, selectedMonster ? getBestiaryEntryId(selectedMonster) : "", monsters.length ? "Выбрать монстра" : "Бестиарий пуст")}
                </select>
              </label>
              <div class="master-runtime-scene-contract-actions">
                <button class="btn btn-primary" type="button" data-master-runtime-action="add-selected-enemy" ${selectedMonster ? "" : "disabled"}>Добавить выбранного</button>
                <button class="btn" type="button" data-master-runtime-action="open-bestiary">Открыть Бестиарий</button>
                <button class="btn" type="button" data-master-runtime-action="refresh-bestiary-pool">Обновить пул</button>
              </div>
              <div class="master-runtime-bestiary-bridge-status" data-master-runtime-bestiary-status>${escapeHtml(getBestiaryBridgeStatusText())} • показано ${escapeHtml(String(monsters.length))} из ${escapeHtml(String(allMonsters.length))}</div>
            </div>
            <div data-master-runtime-bestiary-cards>${renderMonsterCards(monsters, selectedMonster ? getBestiaryEntryId(selectedMonster) : "")}</div>
            <div data-master-runtime-bestiary-summary-slot>${renderBestiaryMonsterSummary(selectedMonster)}</div>
            ${renderCombatSceneContractPanel(table, combat, canManage)}
            <button class="btn" type="button" data-master-runtime-action="add-enemy">Добавить вручную</button>
            <button class="btn" type="button" data-master-runtime-action="clear-combat-log">Очистить лог</button>
          </div>
        </details>
      ` : ""}
    </div>
  `;
}

function renderJournalStage(table, canManage = false) {
  const allEvents = getVisibleMasterEvents(table, canManage);
  const actors = getMasterJournalActors(allEvents);
  const rows = renderMasterJournalRows(table, canManage);
  return `
    <div class="master-runtime-stage master-runtime-stage-journal master-runtime-stage-journal-filtered">
      <section class="master-runtime-panel master-runtime-journal-list-panel">
        <div class="master-runtime-panel-head"><span>Журнал стола</span><small data-master-journal-count>${escapeHtml(String(rows.visible.length))} из ${escapeHtml(String(rows.filtered.length))}</small></div>
        <div class="master-runtime-journal-toolbar">
          <label class="master-runtime-journal-search"><span>Поиск</span><input id="masterRuntimeJournalSearch" value="${escapeHtml(MASTER_ROOM_STATE.ui.journalQuery || "")}" placeholder="Участник, мув, атака, цель..."></label>
          <label><span>Участник</span><select id="masterRuntimeJournalActor"><option value="all">Все участники</option>${actors.map((actor) => `<option value="${escapeHtml(actor)}" ${MASTER_ROOM_STATE.ui.journalActor === actor ? "selected" : ""}>${escapeHtml(actor)}</option>`).join("")}</select></label>
          <button class="btn" type="button" data-master-journal-clear>Сбросить</button>
        </div>
        <div class="master-runtime-journal-filter-row">
          ${MASTER_JOURNAL_FILTERS.map((item) => `<button class="master-runtime-journal-filter ${MASTER_ROOM_STATE.ui.journalFilter === item.key ? "active" : ""}" type="button" data-master-journal-filter="${escapeHtml(item.key)}">${escapeHtml(item.label)}</button>`).join("")}
        </div>
        <div class="master-runtime-event-list large master-runtime-event-list-compact" data-master-journal-list>${rows.html}</div>
        <button class="btn master-runtime-journal-more" type="button" data-master-journal-more ${rows.visible.length >= rows.filtered.length ? "hidden" : ""}>Показать ещё (${Math.min(36, Math.max(0, rows.filtered.length - rows.visible.length))})</button>
      </section>
      <aside class="master-runtime-panel master-runtime-journal-details-panel">
        <div class="master-runtime-panel-head"><span>Детали события</span><small>${canManage ? "GM видит всё" : "только открытое"}</small></div>
        <div data-master-journal-details>${renderMasterJournalDetails(table, canManage)}</div>
      </aside>
    </div>
  `;
}

function renderSelectedEvent(table, canManage = false) {
  return renderMasterJournalDetails(table, canManage);
}


function noteScopeLabel(scope = "gm") {
  const value = displayText(scope, "gm").toLowerCase();
  if (value === "gm" || value === "master" || value === "private_gm") return "GM";
  if (value === "player" || value === "private" || value === "personal") return "Личная";
  if (value === "party") return "Партия";
  if (value === "public" || value === "open") return "Публичная";
  return value || "Заметка";
}

function renderNotesStage(table, canManage = false) {
  const notes = getVisibleMasterNotes(table, canManage);
  const user = getCurrentUser();
  const scopeOptions = canManage
    ? [["gm", "GM: скрыто от игроков"], ["party", "Партия"], ["public", "Публично"]]
    : [["player", "Личная заметка"], ["party", "Партия"]];
  return `
    <div class="master-runtime-stage master-runtime-stage-notes">
      <section class="master-runtime-panel master-runtime-notes-list-panel">
        <div class="master-runtime-panel-head">
          <span>${canManage ? "Заметки мастера" : "Заметки игрока"}</span>
          <small>${escapeHtml(String(notes.length))} видимых</small>
        </div>
        <div class="master-runtime-note-list">
          ${notes.length ? notes.map((note) => `
            <button class="master-runtime-note-card ${String(note.id) === String(MASTER_ROOM_STATE.ui.selectedNoteId) ? "active" : ""}" type="button" data-master-runtime-note="${escapeHtml(note.id)}">
              <span>${escapeHtml(noteScopeLabel(note.scope))}</span>
              <strong>${escapeHtml(note.title || "Заметка")}</strong>
              <small>${escapeHtml(clampText(note.text || "Без текста", 120))}</small>
              <time>${escapeHtml(formatTime(note.updated_at || note.created_at))}</time>
            </button>
          `).join("") : `<div class="master-runtime-empty">Видимых заметок пока нет.</div>`}
        </div>
      </section>
      <aside class="master-runtime-panel master-runtime-note-editor-panel">
        <div class="master-runtime-panel-head">
          <span>Новая заметка</span>
          <small>${canManage ? "GM layer" : "player layer"}</small>
        </div>
        <label>Заголовок<input id="masterRuntimeNoteTitle" placeholder="Например: секрет NPC / мысль персонажа"></label>
        <label>Видимость
          <select id="masterRuntimeNoteScope">
            ${scopeOptions.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("")}
          </select>
        </label>
        <label>Текст<textarea id="masterRuntimeNoteText" rows="6" placeholder="Запиши сцену, секрет, план игрока или подсказку GM"></textarea></label>
        <button class="btn btn-primary" type="button" data-master-runtime-action="add-note">Сохранить заметку</button>
        <p class="master-runtime-muted">GM-заметки не видны игрокам. Личные заметки игрока видит только автор и мастер. Позже этот режим можно связать с модулем «Заметки».</p>
      </aside>
    </div>
  `;
}

async function addMasterNote(table) {
  if (!table) return;
  const root = getSection("cabinet-masterroom");
  const title = trimText(root?.querySelector("#masterRuntimeNoteTitle")?.value || "");
  const text = trimText(root?.querySelector("#masterRuntimeNoteText")?.value || "");
  const requestedScope = trimText(root?.querySelector("#masterRuntimeNoteScope")?.value || "");
  const canManage = canManageTable(table);
  if (!title && !text) return showToast("Пустую заметку сохранять не будем");
  const user = getCurrentUser();
  const scope = canManage ? (requestedScope || "gm") : (requestedScope === "party" ? "party" : "player");
  const note = normalizeNotes([{
    title: title || "Заметка",
    text,
    scope,
    author_id: user?.id || user?.email || user?.nickname || "",
    author: user?.nickname || user?.email || (canManage ? "GM" : "Игрок"),
  }])[0];
  table.notes = [note, ...safeArray(table.notes)];
  emitMasterEvent({
    type: "note",
    title: canManage && scope === "gm" ? "GM заметка" : "Заметка стола",
    description: note.title,
    actor: note.author,
    scope: scope === "gm" ? "gm" : scope === "player" ? "player" : "party",
  });
  await persistMasterRoom();
  renderMasterRoom();
}

function renderInlineQuickActions(table, canManage) {
  // Round 37: старую широкую полосу “Команды сцены” отключили.
  // Контекстные действия теперь рендерятся в боевом rail или внутри конкретной вкладки,
  // чтобы не появлялась бесполезная линия над Master Room.
  void table;
  void canManage;
  return "";
}


function renderRestrictedStage(table, canManage = false) {
  return `
    <section class="master-runtime-panel master-runtime-restricted-stage">
      <div class="master-runtime-panel-head"><span>Скрытый слой</span><small>${canManage ? "GM" : "player"}</small></div>
      <p>Эта вкладка скрыта правилами видимости стола. Игрок видит только открытые части сцены, партии, боя, журнала и заметок.</p>
      ${canManage ? `<button class="btn" type="button" data-master-runtime-action="save-access">Открыть настройки доступов</button>` : `<button class="btn" type="button" data-master-runtime-action="open-journal">Открыть доступный журнал</button>`}
    </section>
  `;
}

function renderActiveStage(table, canManage) {
  if (!table) return renderLobby();
  if (!canSeeMasterTab(MASTER_ROOM_STATE.activeTab, table, canManage)) return renderRestrictedStage(table, canManage);
  if (MASTER_ROOM_STATE.activeTab === "party") return renderPartyStage(table, canManage);
  if (MASTER_ROOM_STATE.activeTab === "characters") return renderCharactersStage(table, canManage);
  if (MASTER_ROOM_STATE.activeTab === "access") return renderAccessStage(table, canManage);
  if (MASTER_ROOM_STATE.activeTab === "traders") return renderTradersStage(table, canManage);
  if (MASTER_ROOM_STATE.activeTab === "grants") return renderGrantsStage(table, canManage);
  if (MASTER_ROOM_STATE.activeTab === "combat") return renderCombatStage(table, canManage);
  if (MASTER_ROOM_STATE.activeTab === "journal") return renderJournalStage(table, canManage);
  if (MASTER_ROOM_STATE.activeTab === "notes") return renderNotesStage(table, canManage);
  return renderTableOverview(table, canManage);
}

export async function loadMasterRoom() {
  MASTER_ROOM_STATE.role = getCurrentRole();
  const ui = readUiState();
  MASTER_ROOM_STATE.activeTab = ui.activeTab || MASTER_ROOM_STATE.activeTab || "table";
  MASTER_ROOM_STATE.activeTableId = ui.activeTableId || MASTER_ROOM_STATE.activeTableId;
  MASTER_ROOM_STATE.ui.quickActionsOpen = false;
  MASTER_ROOM_STATE.ui.diceDrawerOpen = Boolean(ui.diceDrawerOpen);
  MASTER_ROOM_STATE.ui.combatLogFilter = ui.combatLogFilter || MASTER_ROOM_STATE.ui.combatLogFilter || "all";
  MASTER_ROOM_STATE.ui.combatHideSecondary = Boolean(ui.combatHideSecondary);
  MASTER_ROOM_STATE.ui.journalFilter = ui.journalFilter || MASTER_ROOM_STATE.ui.journalFilter || "all";
  MASTER_ROOM_STATE.ui.journalActor = ui.journalActor || MASTER_ROOM_STATE.ui.journalActor || "all";

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

  if (String(MASTER_ROOM_STATE.activeTableId || "") !== MASTER_ROOM_LOBBY_ID) {
    if (!MASTER_ROOM_STATE.activeTableId || !MASTER_ROOM_STATE.tables.some((table) => String(table.id) === String(MASTER_ROOM_STATE.activeTableId))) {
      MASTER_ROOM_STATE.activeTableId = MASTER_ROOM_STATE.tables[0]?.id || null;
    }
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

function captureMasterViewport(focusSelector = "") {
  if (typeof document === "undefined") return null;
  const root = getSection("cabinet-masterroom");
  const active = document.activeElement;
  const activeSelector = focusSelector || (active?.id ? `#${active.id}` : "");
  return {
    winX: typeof window !== "undefined" ? window.scrollX : 0,
    winY: typeof window !== "undefined" ? window.scrollY : 0,
    docTop: document.scrollingElement?.scrollTop || 0,
    rootTop: root?.scrollTop || 0,
    parentTop: root?.parentElement?.scrollTop || 0,
    activeSelector,
    selectionStart: Number.isFinite(active?.selectionStart) ? active.selectionStart : null,
    selectionEnd: Number.isFinite(active?.selectionEnd) ? active.selectionEnd : null,
  };
}

function restoreMasterViewport(snapshot = null) {
  if (!snapshot || typeof document === "undefined") return;
  const apply = () => {
    const root = getSection("cabinet-masterroom");
    if (document.scrollingElement) document.scrollingElement.scrollTop = snapshot.docTop || 0;
    if (root) root.scrollTop = snapshot.rootTop || 0;
    if (root?.parentElement) root.parentElement.scrollTop = snapshot.parentTop || 0;
    if (typeof window !== "undefined" && typeof window.scrollTo === "function") window.scrollTo(snapshot.winX || 0, snapshot.winY || 0);
    if (snapshot.activeSelector) {
      const next = getSection("cabinet-masterroom")?.querySelector(snapshot.activeSelector);
      if (next && typeof next.focus === "function") {
        next.focus({ preventScroll: true });
        if (typeof next.setSelectionRange === "function") {
          const start = snapshot.selectionStart ?? String(next.value || "").length;
          const end = snapshot.selectionEnd ?? start;
          try { next.setSelectionRange(start, end); } catch (_) {}
        }
      }
    }
  };
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(apply);
  else setTimeout(apply, 0);
}

function renderMasterRoomStable(focusSelector = "") {
  const snapshot = captureMasterViewport(focusSelector);
  renderMasterRoom();
  restoreMasterViewport(snapshot);
}

export function renderMasterRoom() {
  const container = getSection("cabinet-masterroom");
  if (!container) return;
  ensureMasterRoomRuntimeStylePatch();
  ensureMasterRoomJournalStylePatch();

  if (!MASTER_ROOM_STATE.loaded) {
    container.innerHTML = `<div class="master-runtime-shell"><div class="master-runtime-empty">Master Room загружается...</div></div>`;
    return;
  }

  const activeTable = getActiveTable();
  if (activeTable) ensureCurrentUserInTable(activeTable);
  const canManage = canManageTable(activeTable);
  normalizeMasterActiveTab(activeTable, canManage);

  container.innerHTML = `
    <div class="master-runtime-shell" data-master-runtime="${MASTER_ROOM_VERSION}" data-master-stage="${escapeHtml(MASTER_ROOM_STATE.activeTab)}">
      ${activeTable ? renderShellHeader(activeTable, canManage) : ""}
      ${activeTable ? renderTableTabs(activeTable, canManage) : ""}
      ${activeTable ? renderInlineQuickActions(activeTable, canManage) : ""}
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
    // combat.js вызывает несколько callbacks подряд и не ждёт Promise. Сериализация
    // не даёт HP, концентрации, ресурсу и журналу перетирать состояние друг друга.
    onNextTurn: (payload) => enqueueMasterCombatMutation(() => advanceTurn(table, payload)),
    onFocusTurn: ({ turnIndex }) => enqueueMasterCombatMutation(() => setTurn(table, turnIndex)),
    onRoll: (payload) => enqueueMasterCombatMutation(() => addCombatRoll(table, payload)),
    onDamage: (payload = {}) => enqueueMasterCombatMutation(() => patchCombatHp(
      table,
      payload.entryId,
      -Math.abs(safeNumber(payload.delta, 0)),
      "damage",
      {
        damageType: payload.damageType || "",
        // У resolved-атаки/спелла наличие damageType означает, что подтверждение
        // уже было в combat.js. Ручной GM-урон остаётся с защитой от мисклика.
        skipConfirm: Object.prototype.hasOwnProperty.call(payload, "damageType"),
        source: payload.source || "combat",
      },
    )),
    onHeal: (payload = {}) => enqueueMasterCombatMutation(() => patchCombatHp(
      table,
      payload.entryId,
      Math.abs(safeNumber(payload.delta, 0)),
      "heal",
      { skipConfirm: Boolean(payload.confirmed), source: payload.source || "combat" },
    )),
    onConcentrationCheck: (payload = {}) => enqueueMasterCombatMutation(() => handleMasterConcentrationCheck(table, payload)),
    onSpendTurnResource: (payload) => enqueueMasterCombatMutation(() => spendCombatTurnResource(table, payload)),
    onSaveCombatant: ({ entryId, patch }) => enqueueMasterCombatMutation(() => patchCombatEntry(table, entryId, patch)),
    onRemoveEntry: ({ entryId }) => enqueueMasterCombatMutation(() => removeCombatEntry(table, entryId)),
    onLogFilter: ({ filter }) => {
      MASTER_ROOM_STATE.ui.combatLogFilter = filter || "all";
      writeUiState();
      renderMasterRoom();
    },
    onToggleSecondary: () => {
      MASTER_ROOM_STATE.ui.combatHideSecondary = !MASTER_ROOM_STATE.ui.combatHideSecondary;
      writeUiState();
      renderMasterRoom();
    },
  });
}

async function advanceTurn(table, payload = {}) {
  table.combat = normalizeCombat(table.combat, table);
  const entries = safeArray(table.combat.entries);
  if (!entries.length) {
    await persistMasterRoom();
    renderMasterRoom();
    return;
  }

  const count = entries.length;
  const currentIndex = Math.max(0, Math.min(count - 1, safeNumber(table.combat.turn_index, 0)));
  const leavingEntry = entries[currentIndex] || null;
  tickMasterCombatEffectsForEntry(table, leavingEntry);
  let nextIndex = Number.isFinite(Number(payload.nextIndex)) ? safeNumber(payload.nextIndex, currentIndex + 1) : currentIndex + 1;
  let roundDelta = Math.max(0, safeNumber(payload.roundDelta, 0));
  const skipped = new Set(safeArray(payload.skippedIds));

  if (!Number.isFinite(nextIndex) || nextIndex < 0) nextIndex = currentIndex + 1;
  let guard = 0;
  while (guard < count) {
    if (nextIndex >= count) {
      nextIndex = 0;
      roundDelta += 1;
    }
    const candidate = entries[nextIndex];
    if (isEligibleCombatTurn(candidate)) break;
    if (candidate?.entry_id) skipped.add(String(candidate.entry_id));
    nextIndex += 1;
    guard += 1;
  }

  if (guard >= count && !isEligibleCombatTurn(entries[nextIndex])) {
    table.combat.active = false;
    emitMasterEvent({ type: "combat", title: "Бой завершён", description: "Не осталось активных врагов/ходов", combat_type: "end" });
  } else {
    if (roundDelta > 0) {
      table.combat.round = Math.max(1, safeNumber(table.combat.round, 1) + roundDelta);
      emitMasterEvent({ type: "combat", title: "Новый раунд", description: `Раунд ${table.combat.round}`, combat_type: "round" });
    }
    table.combat.turn_index = Math.max(0, Math.min(count - 1, nextIndex));
    const current = table.combat.entries[table.combat.turn_index];
    if (current) resetCombatEntryTurnResources(current);
    const skippedText = skipped.size ? `; пропущено: ${Array.from(skipped).length}` : "";
    emitMasterEvent({ type: "combat", title: "Следующий ход", description: `${current?.name || ""}${skippedText}`, combat_type: "turn" });
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

async function spendCombatTurnResource(table, payload = {}) {
  table.combat = normalizeCombat(table.combat, table);
  const entry = table.combat.entries.find((item) => String(item.entry_id) === String(payload.entryId || payload.entry_id || ""));
  if (!entry) return;

  const resource = displayText(payload.resource, "none");
  const amount = Math.max(0, safeNumber(payload.amount, 1));
  const turn = normalizeMasterTurnResources(entry, entry.speed);

  if (resource === "movement") {
    const cost = amount || 0;
    turn.movement_used = Math.max(0, safeNumber(turn.movement_used, 0) + cost);
    turn.movement_remaining = Math.max(0, safeNumber(turn.movement_total, entry.speed) - turn.movement_used);
  } else if (resource === "action") {
    turn.action_available = false;
  } else if (resource === "bonus_action") {
    turn.bonus_action_available = false;
  } else if (resource === "reaction") {
    turn.reaction_available = false;
  } else if (resource === "free_action") {
    turn.free_action_available = false;
  } else if (resource === "object_interaction") {
    turn.object_interaction_available = false;
  }

  entry.turn_resources = turn;
  // Не спамим основной журнал отдельной строкой на каждый ресурс: сам бросок/действие
  // уже пишет лог. Здесь только сохраняем state для последующего render.
  await persistMasterRoom();
}

async function moveCombatToken(table, payload = {}) {
  table.combat = normalizeCombat(table.combat, table);
  const scene = normalizeCombatScene(table.combat.scene, table);
  const entries = safeArray(table.combat.entries);
  const fallbackEntry = getCurrentCombatEntry(table.combat);
  const entry = entries.find((item) => String(item.entry_id) === String(payload.entryId || payload.entry_id || "")) || fallbackEntry;
  if (!entry) return;
  if (!isEligibleCombatTurn(entry)) return showToast("Этот участник не может двигаться: он выбыл или без активного хода");

  const requestedDistance = Math.max(1, safeNumber(payload.distance, scene.grid_size_ft || 5));
  const rawDistance = snapMovementDistance(requestedDistance, scene);
  const direction = displayText(payload.direction, "e").toLowerCase();
  const rule = getMovementRuleState(entry, scene);
  const freeMove = Boolean(payload.freeMove || payload.free_move);
  const cost = getMovementCost(rawDistance, rule, direction);

  if (!freeMove) {
    if (rule.hardStop) return showToast(rule.reasons[0] || "Движение заблокировано состоянием");
    if (cost > rule.movementRemaining) return showToast(`Не хватает движения: нужно ${cost} фт., осталось ${rule.movementRemaining} фт.`);
  }

  const delta = getMovementDelta(direction, rawDistance);
  const token = snapScenePosition(normalizeCombatSceneToken(entry, 0, entry.type), scene);
  const from = { x: token.x, y: token.y, z: token.z || 0 };
  const destination = snapScenePosition({
    ...token,
    x: safeNumber(token.x, 0) + delta.x,
    y: safeNumber(token.y, 0) + delta.y,
    z: safeNumber(token.z, 0) + delta.z,
  }, scene);
  if (direction !== "up" && direction !== "down" && destination.x === from.x && destination.y === from.y) {
    return showToast("Дальше край карты: токен остаётся в текущей клетке");
  }
  const collision = findCombatSceneCollision(entries, entry, destination, scene);
  if (collision) return showToast(`Клетка занята: ${collision.name || "другой участник"}`);

  entry.scene_state = destination;

  if (!freeMove && cost > 0) {
    const turn = normalizeMasterTurnResources(entry, entry.speed);
    turn.movement_used = Math.max(0, safeNumber(turn.movement_used, 0) + cost);
    turn.movement_remaining = Math.max(0, safeNumber(turn.movement_total, entry.speed) - turn.movement_used);
    entry.turn_resources = turn;
  }

  const toText = `X${Math.round(destination.x)} Y${Math.round(destination.y)} Z${Math.round(destination.z || 0)}`;
  const fromText = `X${Math.round(from.x)} Y${Math.round(from.y)} Z${Math.round(from.z || 0)}`;
  const ruleText = freeMove ? "без траты движения" : `стоимость ${cost} фт.${rule.costMultiplier > 1 ? " (трудная местность)" : ""}`;
  emitMasterEvent({
    type: "combat",
    title: "Движение",
    description: `${entry.name || "Участник"}: ${movementDirectionLabel(direction)} ${rawDistance} фт. • ${fromText} → ${toText} • ${ruleText}`,
    actor: entry.name || "Участник",
    combat_type: "move",
    scope: destination.visible_to_players ? "public" : "gm",
  });

  await persistMasterRoom();
  renderMasterRoom();
}

async function applyCombatMovementManeuver(table, payload = {}) {
  table.combat = normalizeCombat(table.combat, table);
  const scene = normalizeCombatScene(table.combat.scene, table);
  const entries = safeArray(table.combat.entries);
  const entry = entries.find((item) => String(item.entry_id) === String(payload.entryId || payload.entry_id || "")) || getCurrentCombatEntry(table.combat);
  if (!entry) return;
  if (!isEligibleCombatTurn(entry)) return showToast("Участник выбыл и не может делать манёвр");

  const maneuver = displayText(payload.maneuver, "").toLowerCase();
  const rule = getMovementRuleState(entry, scene);
  let turn = normalizeMasterTurnResources(entry, entry.speed);
  const flags = entry.turn_flags && typeof entry.turn_flags === "object" ? { ...entry.turn_flags } : {};
  let title = "Манёвр";
  let description = "";

  if (maneuver === "dash_action" || maneuver === "dash_bonus") {
    const resource = maneuver === "dash_bonus" ? "bonus_action" : "action";
    const spent = spendMovementActionResource(turn, resource);
    if (!spent.ok) return showToast(spent.message);
    turn = spent.turn;
    const add = Math.max(0, rule.effectiveSpeed || rule.baseSpeed || safeNumber(entry.speed, 30));
    turn.movement_total = Math.max(0, safeNumber(turn.movement_total, entry.speed) + add);
    turn.movement_remaining = Math.max(0, safeNumber(turn.movement_remaining, 0) + add);
    flags.dashed = safeNumber(flags.dashed, 0) + 1;
    title = "Рывок";
    description = `${entry.name || "Участник"}: +${add} фт. движения (${resource === "bonus_action" ? "бонусное действие" : "основное действие"})`;
  } else if (maneuver === "disengage_action" || maneuver === "disengage_bonus") {
    const resource = maneuver === "disengage_bonus" ? "bonus_action" : "action";
    const spent = spendMovementActionResource(turn, resource);
    if (!spent.ok) return showToast(spent.message);
    turn = spent.turn;
    flags.disengaged = true;
    title = "Отступление";
    description = `${entry.name || "Участник"}: отступление активно до конца хода (${resource === "bonus_action" ? "бонусное действие" : "основное действие"})`;
  } else if (maneuver === "stand_prone") {
    if (!rule.hasProne) return showToast("Участник не лежит");
    const standCost = Math.ceil(Math.max(rule.effectiveSpeed || rule.baseSpeed || safeNumber(entry.speed, 30), 0) / 2);
    if (standCost > rule.movementRemaining) return showToast(`Не хватает движения, чтобы встать: нужно ${standCost} фт.`);
    turn.movement_used = Math.max(0, safeNumber(turn.movement_used, 0) + standCost);
    turn.movement_remaining = Math.max(0, safeNumber(turn.movement_total, entry.speed) - turn.movement_used);
    removeCombatCondition(entry, "prone");
    title = "Встать";
    description = `${entry.name || "Участник"}: встал, потрачено ${standCost} фт. движения`;
  } else {
    return showToast("Неизвестный манёвр движения");
  }

  entry.turn_resources = turn;
  entry.turn_flags = flags;
  emitMasterEvent({ type: "combat", title, description, actor: entry.name || "Участник", combat_type: "move", scope: "public" });
  await persistMasterRoom();
  renderMasterRoom();
}

async function seedCombatScene(table) {
  if (!table) return;
  table.combat = normalizeCombat(table.combat, table);
  const scene = normalizeCombatScene(table.combat.scene, table);
  scene.map_name = displayText(scene.map_name || table.scene || table.title, "Сцена боя");
  scene.width = Math.max(60, safeNumber(scene.width, 120));
  scene.height = Math.max(40, safeNumber(scene.height, 80));
  scene.grid_enabled = true;
  scene.grid_size_ft = Math.max(1, safeNumber(scene.grid_size_ft, 5));
  table.combat.scene = scene;
  table.scene_state = scene;
  const placedEntries = [];
  table.combat.entries = safeArray(table.combat.entries).map((entry, index) => {
    const isEnemy = inferCombatEntityKind(entry) === "enemy";
    const desired = {
      ...normalizeCombatSceneToken(entry, index, entry.type),
      x: (isEnemy ? Math.round(scene.width * .68) : Math.round(scene.width * .24)) + ((index % 3) * scene.grid_size_ft),
      y: Math.round(scene.height * (isEnemy ? .35 : .65)) + (Math.floor(index / 3) * scene.grid_size_ft),
      z: 0,
    };
    const freePosition = findNearestFreeScenePosition(placedEntries, entry, desired, scene);
    entry.scene_state = { ...normalizeCombatSceneToken(entry, index, entry.type), ...freePosition };
    placedEntries.push(entry);
    return entry;
  });
  table.combat.active = true;
  emitMasterEvent({ type: "combat", title: "Сцена создана", description: `${scene.map_name}: ${scene.width}×${scene.height} фт., клетка ${scene.grid_size_ft} фт.`, combat_type: "scene" });
  await persistMasterRoom();
  renderMasterRoom();
}

async function addCombatRoll(table, payload = {}) {
  if (!payload?.skip_confirm && !payload?.confirmed) {
    const eventTypeForConfirm = displayText(payload.event_type || payload.type, "roll").toLowerCase();
    const hasImmediateHpPatch = ["damage", "heal"].includes(eventTypeForConfirm) && safeNumber(payload.damage, 0) > 0;
    if (!hasImmediateHpPatch && !confirmMasterAction(combatPayloadConfirmText(table, payload))) return;
  }
  table.combat = normalizeCombat(table.combat, table);
  const rawEventType = displayText(payload.event_type || payload.type, "roll");
  const current = table.combat.entries.find((entry) => String(entry.entry_id) === String(payload.entry_id || payload.actor_entry_id || "")) || table.combat.entries[table.combat.turn_index] || {};
  const target = table.combat.entries.find((entry) => String(entry.entry_id) === String(payload.target_entry_id || "")) || table.combat.entries.find((entry) => entry.entry_id !== current.entry_id) || {};
  const spellRuntime = applyMasterSpellRuntimeState(table, payload, current, target);
  const journalEventType = spellRuntime.is_spell
    ? "spell"
    : payload.action_type === "attack"
      ? "attack"
      : rawEventType;
  const resolvedPayload = rawEventType === "note" || payload.skip_roll || payload.attack_total !== undefined || payload.outcome;
  const result = resolvedPayload
    ? {
        dice: displayText(payload.dice, ""),
        rolls: safeArray(payload.attack_roll?.rolls || payload.rolls),
        modifier: safeNumber(payload.modifier ?? payload.attack_bonus, 0),
        total: payload.attack_total ?? payload.roll_total ?? null,
      }
    : parseDice(payload.dice || "d20");
  const createdAt = new Date().toISOString();
  const summary = resolvedPayload
    ? displayText(payload.summary || payload.description || payload.reason, journalEventType === "spell" ? "Заклинание" : "Событие боя")
    : `${result.rolls.join(" + ")}${result.modifier ? ` ${result.modifier > 0 ? "+" : "-"} ${Math.abs(result.modifier)}` : ""} = ${result.total}`;
  const lastRoll = {
    ...result,
    actor_name: payload.actor_name || current.name || "Участник",
    target_name: payload.target_name || target.name || "",
    reason: payload.reason || (journalEventType === "spell" ? payload.spell_name || "Заклинание" : rawEventType === "note" ? "Заметка боя" : "Бросок"),
    event_type: journalEventType,
    created_at: createdAt,
  };
  table.combat.last_roll = lastRoll;
  const slotText = spellRuntime.is_spell && spellRuntime.slot?.ok && spellRuntime.slot.level > 0
    ? ` • ячейка ${spellRuntime.slot.level} круга: ${spellRuntime.slot.remaining}/${spellRuntime.slot.total}`
    : spellRuntime.is_spell && spellRuntime.slot && !spellRuntime.slot.ok
      ? ` • нет ячейки ${spellRuntime.slot.level} круга`
      : "";
  const concentrationText = spellRuntime.concentration ? " • концентрация" : "";
  table.combat.log = [{
    id: makeId("log"),
    event_type: lastRoll.event_type,
    entry_id: current.entry_id || payload.entry_id || "",
    target_entry_id: target.entry_id || payload.target_entry_id || "",
    actor_name: lastRoll.actor_name,
    target_name: lastRoll.target_name,
    reason: `${lastRoll.reason}${slotText}${concentrationText}`,
    dice: result.dice,
    total: result.total,
    summary,
    scope: payload.scope || "public",
    turn_resource: payload.turn_resource || "none",
    round: Math.max(1, safeNumber(table.combat.round, 1)),
    modifier: safeNumber(payload.modifier, result.modifier || 0),
    roll_total: payload.roll_total ?? result.total,
    damage: safeNumber(payload.damage, 0),
    damage_type: displayText(payload.damage_type, ""),
    outcome: displayText(payload.outcome, ""),
    spell_id: displayText(payload.spell_id, ""),
    spell_name: displayText(payload.spell_name, ""),
    spell_level: Math.max(0, safeNumber(payload.spell_level, 0)),
    spell_slot_remaining: spellRuntime.slot?.remaining ?? null,
    concentration: Boolean(spellRuntime.concentration),
    effect_id: spellRuntime.effect?.id || null,
    created_at: lastRoll.created_at,
  }, ...safeArray(table.combat.log)].slice(0, 120);
  emitMasterEvent({
    type: rawEventType === "note" && !spellRuntime.is_spell ? "note" : journalEventType === "spell" ? "spell" : "roll",
    title: lastRoll.reason,
    description: `${lastRoll.actor_name}${result.total === null ? "" : `: ${result.total}`}${slotText}${concentrationText}`,
    actor: lastRoll.actor_name,
    target_name: lastRoll.target_name,
    entry_id: current.entry_id || payload.entry_id || "",
    target_entry_id: target.entry_id || payload.target_entry_id || "",
    round: Math.max(1, safeNumber(table.combat.round, 1)),
    dice: result.dice,
    total: result.total,
    combat_type: lastRoll.event_type,
    turn_resource: payload.turn_resource || "none",
    damage: safeNumber(payload.damage, 0),
    damage_type: displayText(payload.damage_type, ""),
    outcome: displayText(payload.outcome, ""),
    spell_level: Math.max(0, safeNumber(payload.spell_level, 0)),
    spell_slot_remaining: spellRuntime.slot?.remaining ?? null,
    concentration: Boolean(spellRuntime.concentration),
    scope: payload.scope || "public",
  });
  await persistMasterRoom();
  renderMasterRoom();
}


const MASTER_COMBAT_HP_DEDUPE_WINDOW_MS = 650;
const MASTER_COMBAT_HP_RECENT = new Map();
const MASTER_COMBAT_CONCENTRATION_RECENT = new Map();
let MASTER_COMBAT_MUTATION_QUEUE = Promise.resolve();

function enqueueMasterCombatMutation(task) {
  const run = () => Promise.resolve().then(task);
  MASTER_COMBAT_MUTATION_QUEUE = MASTER_COMBAT_MUTATION_QUEUE.then(run, run);
  return MASTER_COMBAT_MUTATION_QUEUE;
}

function isRecentMasterCombatMutation(store, key, windowMs = MASTER_COMBAT_HP_DEDUPE_WINDOW_MS) {
  const now = Date.now();
  const previous = safeNumber(store.get(key), 0);
  store.set(key, now);
  if (store.size > 160) {
    Array.from(store.entries()).forEach(([storedKey, timestamp]) => {
      if (now - safeNumber(timestamp, 0) > windowMs * 4) store.delete(storedKey);
    });
  }
  return previous > 0 && now - previous < windowMs;
}

function masterCombatConditionName(value) {
  return normalizeCombatConditionKey(value?.name || value?.title || value?.key || value);
}

function setMasterCombatTerminalConditions(entry = {}) {
  const terminal = new Set(["dead", "killed", "defeated", "down", "unconscious", "dying"]);
  const retained = safeArray(entry.conditions).filter((condition) => !terminal.has(masterCombatConditionName(condition)));
  const status = deriveMasterCombatStatus(entry);
  if (status === "dead") retained.push("dead");
  if (status === "down") retained.push("down");
  entry.conditions = Array.from(new Set(retained.map((item) => typeof item === "string" ? item : item)));
  entry.status = status;
  return entry;
}

function syncMasterCombatHpMirrors(table, entry = {}) {
  const hpCurrent = Math.max(0, safeNumber(entry.hp_current, 0));
  const hpMax = Math.max(1, safeNumber(entry.hp_max, 1));
  const tempHp = Math.max(0, safeNumber(entry.temp_hp, 0));

  if (entry.combat_profile && typeof entry.combat_profile === "object") {
    entry.combat_profile.hp_current = hpCurrent;
    entry.combat_profile.hp_max = hpMax;
    entry.combat_profile.temp_hp = tempHp;
    entry.combat_profile.status = entry.status;
  }

  if (entry.sheet && typeof entry.sheet === "object") {
    if (!entry.sheet.vitality || typeof entry.sheet.vitality !== "object") entry.sheet.vitality = {};
    const vitality = entry.sheet.vitality;
    const writeValue = (key, value) => {
      const old = vitality[key] && typeof vitality[key] === "object" ? vitality[key] : {};
      vitality[key] = { ...old, value };
    };
    writeValue("hp-current", hpCurrent);
    writeValue("hp-max", hpMax);
    writeValue("hp-temp", tempHp);
    vitality.isDying = entry.status === "down";
  }

  if (entry.membership_id) {
    const member = safeArray(table?.members).find((item) => String(item.id || "") === String(entry.membership_id || ""));
    if (member) {
      member.hp_current = hpCurrent;
      member.hp_max = hpMax;
      member.temp_hp = tempHp;
      member.status = entry.status;
      member.conditions = cloneCombatProfileValue(entry.conditions, []);
    }
  }
}

function appendMasterCombatHpLog(table, payload = {}) {
  table.combat = normalizeCombat(table.combat, table);
  const createdAt = new Date().toISOString();
  const type = payload.type === "heal" ? "heal" : "damage";
  const title = type === "heal" ? "Лечение" : "Урон";
  const parts = [];
  if (type === "damage") {
    parts.push(`заявлено ${Math.max(0, safeNumber(payload.requested, 0))}`);
    if (safeNumber(payload.temp_absorbed, 0) > 0) parts.push(`временные HP −${payload.temp_absorbed}`);
    parts.push(`обычные HP −${Math.max(0, safeNumber(payload.hp_applied, 0))}`);
  } else {
    parts.push(`восстановлено ${Math.max(0, safeNumber(payload.hp_applied, 0))}`);
    if (safeNumber(payload.requested, 0) > safeNumber(payload.hp_applied, 0)) parts.push("лишнее лечение отсечено максимумом HP");
  }
  const statusMark = payload.status === "dead" ? " ✕" : payload.status === "down" ? " ↓" : "";
  const summary = `${payload.name || "Цель"}${statusMark}: ${parts.join(" • ")} • HP ${payload.hp_current}/${payload.hp_max}${payload.temp_hp > 0 ? ` • временные ${payload.temp_hp}` : ""}${payload.damage_type ? ` • ${payload.damage_type}` : ""}`;
  const logEntry = {
    id: makeId("log"),
    event_type: type,
    entry_id: payload.entry_id || "",
    target_entry_id: payload.entry_id || "",
    actor_name: payload.source_name || "",
    target_name: payload.name || "",
    reason: title,
    summary,
    scope: payload.scope || "public",
    turn_resource: "none",
    round: Math.max(1, safeNumber(table.combat.round, 1)),
    damage: type === "damage" ? Math.max(0, safeNumber(payload.hp_applied, 0) + safeNumber(payload.temp_absorbed, 0)) : 0,
    healing: type === "heal" ? Math.max(0, safeNumber(payload.hp_applied, 0)) : 0,
    damage_type: payload.damage_type || "",
    hp_before: payload.hp_before,
    hp_after: payload.hp_current,
    temp_hp_before: payload.temp_hp_before,
    temp_hp_after: payload.temp_hp,
    status: payload.status || "",
    created_at: createdAt,
  };
  table.combat.log = [logEntry, ...safeArray(table.combat.log)].slice(0, 160);
  table.combat.last_hp_change = cloneCombatProfileValue(logEntry, {});
  emitMasterEvent({
    type,
    title,
    description: summary,
    target_name: payload.name || "",
    target_entry_id: payload.entry_id || "",
    round: logEntry.round,
    combat_type: type,
    damage: logEntry.damage,
    healing: logEntry.healing,
    damage_type: payload.damage_type || "",
    scope: payload.scope || "public",
  });
  return logEntry;
}

async function patchCombatHp(table, entryId, delta, type = "damage", options = {}) {
  table.combat = normalizeCombat(table.combat, table);
  const entry = table.combat.entries.find((item) => String(item.entry_id || "") === String(entryId || ""));
  if (!entry) return { ok: false, reason: "entry_not_found" };

  const mode = type === "heal" || safeNumber(delta, 0) > 0 ? "heal" : "damage";
  const requested = Math.max(0, Math.abs(safeNumber(delta, 0)));
  if (requested <= 0) return { ok: false, reason: "zero" };

  const dedupeKey = [mode, entry.entry_id, requested, displayText(options.damageType, "").toLowerCase()].join("|");
  if (isRecentMasterCombatMutation(MASTER_COMBAT_HP_RECENT, dedupeKey)) {
    console.warn("Master Room: duplicate HP mutation ignored", dedupeKey);
    return { ok: false, reason: "duplicate" };
  }

  const signedDelta = mode === "heal" ? requested : -requested;
  if (!options.skipConfirm && !confirmMasterAction(hpPatchConfirmText(table, entryId, signedDelta, mode))) {
    return { ok: false, reason: "cancelled" };
  }

  const hpMax = Math.max(1, safeNumber(entry.hp_max, 1));
  const hpBefore = Math.max(0, Math.min(hpMax, safeNumber(entry.hp_current, 0)));
  const tempBefore = Math.max(0, safeNumber(entry.temp_hp, 0));
  const wasEligible = isEligibleCombatTurn(entry);
  let hpApplied = 0;
  let tempAbsorbed = 0;

  if (mode === "damage") {
    tempAbsorbed = Math.min(tempBefore, requested);
    const remainingDamage = Math.max(0, requested - tempAbsorbed);
    entry.temp_hp = Math.max(0, tempBefore - tempAbsorbed);
    const hpAfter = Math.max(0, hpBefore - remainingDamage);
    hpApplied = hpBefore - hpAfter;
    entry.hp_current = hpAfter;
  } else {
    const hpAfter = Math.min(hpMax, hpBefore + requested);
    hpApplied = hpAfter - hpBefore;
    entry.hp_current = hpAfter;
    entry.temp_hp = tempBefore;
  }

  entry.hp_max = hpMax;
  setMasterCombatTerminalConditions(entry);
  syncMasterCombatHpMirrors(table, entry);
  const result = {
    ok: true,
    type: mode,
    entry_id: entry.entry_id,
    name: entry.name || "Цель",
    requested,
    hp_before: hpBefore,
    hp_current: entry.hp_current,
    hp_max: hpMax,
    hp_applied: hpApplied,
    temp_hp_before: tempBefore,
    temp_hp: entry.temp_hp,
    temp_absorbed: tempAbsorbed,
    damage_type: displayText(options.damageType, ""),
    status: entry.status,
    scope: options.scope || "public",
    source_name: options.sourceName || "",
  };
  entry.last_hp_change = cloneCombatProfileValue(result, {});
  appendMasterCombatHpLog(table, result);

  const current = table.combat.entries[table.combat.turn_index];
  const becameDeadCurrentEnemy = wasEligible
    && isDeadEnemyCombatEntry(entry)
    && String(current?.entry_id || "") === String(entry.entry_id || "");
  if (becameDeadCurrentEnemy) {
    await advanceTurn(table, { skippedIds: [entry.entry_id] });
    return result;
  }

  await persistMasterRoom();
  renderMasterRoom();
  return result;
}

function appendMasterConcentrationLog(table, entry = {}, payload = {}, broken = false, spellName = "") {
  table.combat = normalizeCombat(table.combat, table);
  const createdAt = new Date().toISOString();
  const dc = Math.max(10, safeNumber(payload.dc, 10));
  const total = safeNumber(payload.total, 0);
  const summary = `${entry.name || "Участник"}: ${total} против Сл ${dc} — ${broken ? "концентрация сорвана" : "концентрация сохранена"}${spellName ? ` (${spellName})` : ""}`;
  const logEntry = {
    id: makeId("log"),
    event_type: "check",
    combat_type: "concentration",
    entry_id: entry.entry_id || "",
    target_entry_id: entry.entry_id || "",
    actor_name: entry.name || "",
    target_name: entry.name || "",
    reason: "Проверка концентрации",
    summary,
    dice: payload.dice || "d20",
    total,
    dc,
    outcome: broken ? "провал" : "успех",
    damage: Math.max(0, safeNumber(payload.damage, 0)),
    scope: "public",
    turn_resource: "reaction",
    round: Math.max(1, safeNumber(table.combat.round, 1)),
    created_at: createdAt,
  };
  table.combat.log = [logEntry, ...safeArray(table.combat.log)].slice(0, 160);
  emitMasterEvent({
    type: "roll",
    title: "Проверка концентрации",
    description: summary,
    actor: entry.name || "",
    entry_id: entry.entry_id || "",
    round: logEntry.round,
    dice: logEntry.dice,
    total,
    combat_type: "check",
    outcome: logEntry.outcome,
    scope: "public",
  });
  return logEntry;
}

async function handleMasterConcentrationCheck(table, payload = {}) {
  table.combat = normalizeCombat(table.combat, table);
  const entryId = payload.entryId || payload.entry_id;
  const entry = table.combat.entries.find((item) => String(item.entry_id || "") === String(entryId || ""));
  if (!entry) return { ok: false, reason: "entry_not_found" };

  const dedupeKey = [entry.entry_id, safeNumber(payload.dc, 10), safeNumber(payload.total, 0), Boolean(payload.success), safeNumber(payload.damage, 0)].join("|");
  if (isRecentMasterCombatMutation(MASTER_COMBAT_CONCENTRATION_RECENT, dedupeKey)) {
    return { ok: false, reason: "duplicate" };
  }

  const active = entry.concentration && typeof entry.concentration === "object" ? entry.concentration : null;
  if (!active) return { ok: false, reason: "not_concentrating" };
  const success = payload.success !== undefined
    ? Boolean(payload.success)
    : safeNumber(payload.total, 0) >= Math.max(10, safeNumber(payload.dc, 10));
  const spellName = displayText(active.spell_name || active.name, "Заклинание");
  entry.last_concentration_check = {
    dc: Math.max(10, safeNumber(payload.dc, 10)),
    total: safeNumber(payload.total, 0),
    success,
    damage: Math.max(0, safeNumber(payload.damage, 0)),
    created_at: new Date().toISOString(),
  };

  if (!success) {
    removeMasterConcentration(table, entry.entry_id, `${entry.name || "Участник"} не удержал ${spellName}.`);
  }
  appendMasterConcentrationLog(table, entry, payload, !success, spellName);
  await persistMasterRoom();
  renderMasterRoom();
  return { ok: true, success, broken: !success, spell_name: spellName };
}

async function patchCombatEntry(table, entryId, patch = {}) {
  table.combat = normalizeCombat(table.combat, table);
  const entry = table.combat.entries.find((item) => String(item.entry_id) === String(entryId));
  if (!entry) return;

  const scalarText = ["name", "status", "class_name", "race"];
  scalarText.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(patch, field)) entry[field] = safeText(patch[field], entry[field]);
  });
  const scalarNumber = ["hp_current", "hp_max", "temp_hp", "ac", "initiative", "speed", "proficiency_bonus"];
  scalarNumber.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(patch, field)) entry[field] = safeNumber(patch[field], entry[field]);
  });
  const arrayFields = [
    "spell_slots", "spells", "attacks", "features", "buffs", "debuffs", "conditions",
    "resistances", "vulnerabilities", "immunities", "inventory", "items", "equipped_items",
  ];
  arrayFields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) return;
    entry[field] = field === "spell_slots"
      ? normalizeMasterRuntimeSpellSlots(patch[field])
      : field === "spells"
        ? sanitizeMasterCombatSpellCollection(patch[field])
        : safeArray(cloneCombatProfileValue(patch[field], []));
  });
  const objectFields = ["spellcasting", "combat_profile", "turn_resources", "turn_flags", "scene_state", "sheet", "concentration"];
  objectFields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) return;
    entry[field] = patch[field] === null ? null : cloneCombatProfileValue(patch[field], entry[field] || {});
  });
  entry.hp_max = Math.max(1, safeNumber(entry.hp_max, 1));
  entry.hp_current = Math.max(0, Math.min(entry.hp_max, safeNumber(entry.hp_current, 0)));
  entry.temp_hp = Math.max(0, safeNumber(entry.temp_hp, 0));
  entry.speed = Math.max(0, safeNumber(entry.speed, 0));
  entry.status = deriveMasterCombatStatus(entry);
  syncMasterSpellSlotsIntoSheet(entry);
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
  if (!confirmMasterAction(`Добавить ручного врага?\n\n${trimText(name)}\nКД 14 • HP 18 • скорость 30 фт.`)) return;
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
    source_kind: "manual",
    entity_kind: "enemy",
    items: [],
    buffs: [],
    scene_state: normalizeCombatSceneToken({ type: "enemy" }, safeArray(table.combat.entries).length, "enemy"),
    turn_resources: makeDefaultTurnResources(30),
  });
  table.combat.active = true;
  emitMasterEvent({ type: "combat", title: "Добавлен враг", description: name, combat_type: "spawn" });
  await persistMasterRoom();
  renderMasterRoom();
}

async function startCombat(table) {
  const currentMember = getCurrentMember(table);
  if (currentMember) applyLssSnapshotToMember(currentMember);
  safeArray(table?.members).forEach((member) => {
    if (member === currentMember || member?.source_kind === "lss") {
      const resolved = member === currentMember ? getLssSnapshot() : null;
      if (resolved) applyLssSnapshotToMember(member, resolved);
    }
  });
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
    speed: safeNumber(member.speed, 30),
    temp_hp: safeNumber(member.temp_hp, 0),
    status: "",
    conditions: safeArray(member.conditions),
    source_kind: "lss",
    entity_kind: "character",
    level: safeNumber(member.level, 1),
    class_name: displayText(member.class_name, ""),
    race: displayText(member.race, ""),
    proficiency_bonus: safeNumber(member.proficiency_bonus, 2),
    abilities: cloneCombatProfileValue(member.abilities, {}),
    saves: cloneCombatProfileValue(member.saves, {}),
    skills: cloneCombatProfileValue(member.skills, {}),
    attacks: safeArray(member.attacks),
    spells: sanitizeMasterCombatSpellCollection(member.spells),
    spell_slots: normalizeMasterRuntimeSpellSlots(member.spell_slots),
    spells_meta: cloneCombatProfileValue(member.spells_meta, {}),
    spellcasting: cloneCombatProfileValue(member.spellcasting, {}),
    combat_profile: cloneCombatProfileValue(member.combat_profile, {}),
    features: safeArray(member.features),
    sheet: cloneCombatProfileValue(member.sheet, {}),
    items: safeArray(member.inventory),
    inventory: safeArray(member.inventory),
    equipped_items: safeArray(member.equipped_items),
    buffs: safeArray(member.buffs),
    debuffs: safeArray(member.debuffs),
    resistances: safeArray(member.resistances),
    vulnerabilities: safeArray(member.vulnerabilities),
    immunities: safeArray(member.immunities),
    scene_state: normalizeCombatSceneToken(member, index, "member"),
    turn_resources: makeDefaultTurnResources(safeNumber(member.speed, 30)),
  })).sort((a, b) => safeNumber(b.initiative, 0) - safeNumber(a.initiative, 0));
  table.combat.round = 1;
  table.combat.turn_index = 0;
  if (table.combat.entries[0]) resetCombatEntryTurnResources(table.combat.entries[0]);
  emitMasterEvent({ type: "combat", title: "Бой начат", description: `${table.combat.entries.length} участников`, combat_type: "turn" });
  await persistMasterRoom();
  renderMasterRoom();
}

function bindMasterRoomActions() {
  const root = getSection("cabinet-masterroom");
  if (!root) return;

  const tableSearch = root.querySelector("#masterRuntimeTableSearch");
  if (tableSearch && tableSearch.dataset.boundTableSearch !== "1") {
    tableSearch.dataset.boundTableSearch = "1";
    tableSearch.addEventListener("input", () => {
      MASTER_ROOM_STATE.searchQuery = tableSearch.value || "";
      renderMasterRoomStable("#masterRuntimeTableSearch");
    });
  }

  const enemySearch = root.querySelector("#masterRuntimeEnemySearch");
  if (enemySearch && enemySearch.dataset.boundBestiarySearch !== "1") {
    enemySearch.dataset.boundBestiarySearch = "1";
    enemySearch.addEventListener("input", () => {
      setBestiarySearchQuery(enemySearch.value || "");
      if (masterRoomBestiarySearchTimer) clearTimeout(masterRoomBestiarySearchTimer);
      masterRoomBestiarySearchTimer = setTimeout(async () => {
        if (!MASTER_ROOM_STATE.ui.bestiaryBridgeLoaded && !MASTER_ROOM_STATE.ui.bestiaryBridgeLoading) {
          try { await loadBestiaryBridgeEntries({ renderWhenDone: false, toast: false }); } catch (_) {}
        }
        refreshBestiaryPickerDom(root);
      }, 180);
    });
  }

  const enemySelect = root.querySelector("#masterRuntimeEnemySelect");
  if (enemySelect && enemySelect.dataset.boundBestiarySelect !== "1") {
    enemySelect.dataset.boundBestiarySelect = "1";
    enemySelect.addEventListener("change", () => {
      MASTER_ROOM_STATE.ui.selectedBestiaryMonsterId = enemySelect.value || "";
      refreshBestiaryPickerDom(root);
    });
  }

  const activeJournalTable = getActiveTable();
  const activeJournalCanManage = canManageTable(activeJournalTable);
  const journalSearch = root.querySelector("#masterRuntimeJournalSearch");
  if (journalSearch && journalSearch.dataset.boundJournalSearch !== "1") {
    journalSearch.dataset.boundJournalSearch = "1";
    journalSearch.addEventListener("input", () => {
      MASTER_ROOM_STATE.ui.journalQuery = journalSearch.value || "";
      MASTER_ROOM_STATE.ui.journalVisibleCount = 36;
      if (masterRoomJournalSearchTimer) clearTimeout(masterRoomJournalSearchTimer);
      masterRoomJournalSearchTimer = setTimeout(() => refreshMasterJournalDom(root, activeJournalTable, activeJournalCanManage), 120);
    });
  }
  const journalActor = root.querySelector("#masterRuntimeJournalActor");
  if (journalActor && journalActor.dataset.boundJournalActor !== "1") {
    journalActor.dataset.boundJournalActor = "1";
    journalActor.addEventListener("change", () => {
      MASTER_ROOM_STATE.ui.journalActor = journalActor.value || "all";
      MASTER_ROOM_STATE.ui.journalVisibleCount = 36;
      writeUiState();
      refreshMasterJournalDom(root, activeJournalTable, activeJournalCanManage);
    });
  }
  root.querySelectorAll("[data-master-journal-filter]").forEach((btn) => {
    if (btn.dataset.boundJournalFilter === "1") return;
    btn.dataset.boundJournalFilter = "1";
    btn.addEventListener("click", () => {
      MASTER_ROOM_STATE.ui.journalFilter = btn.dataset.masterJournalFilter || "all";
      MASTER_ROOM_STATE.ui.journalVisibleCount = 36;
      writeUiState();
      refreshMasterJournalDom(root, activeJournalTable, activeJournalCanManage);
    });
  });
  const journalClear = root.querySelector("[data-master-journal-clear]");
  if (journalClear && journalClear.dataset.boundJournalClear !== "1") {
    journalClear.dataset.boundJournalClear = "1";
    journalClear.addEventListener("click", () => {
      MASTER_ROOM_STATE.ui.journalFilter = "all";
      MASTER_ROOM_STATE.ui.journalQuery = "";
      MASTER_ROOM_STATE.ui.journalActor = "all";
      MASTER_ROOM_STATE.ui.journalVisibleCount = 36;
      const search = root.querySelector("#masterRuntimeJournalSearch");
      const actor = root.querySelector("#masterRuntimeJournalActor");
      if (search) search.value = "";
      if (actor) actor.value = "all";
      writeUiState();
      refreshMasterJournalDom(root, activeJournalTable, activeJournalCanManage);
    });
  }
  const journalMore = root.querySelector("[data-master-journal-more]");
  if (journalMore && journalMore.dataset.boundJournalMore !== "1") {
    journalMore.dataset.boundJournalMore = "1";
    journalMore.addEventListener("click", () => {
      MASTER_ROOM_STATE.ui.journalVisibleCount = Math.max(36, safeNumber(MASTER_ROOM_STATE.ui.journalVisibleCount, 36)) + 36;
      refreshMasterJournalDom(root, activeJournalTable, activeJournalCanManage);
    });
  }
  bindMasterJournalEventRows(root, activeJournalTable, activeJournalCanManage);

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

  root.querySelectorAll("[data-master-runtime-note]").forEach((btn) => {
    if (btn.dataset.boundMasterNote === "1") return;
    btn.dataset.boundMasterNote = "1";
    btn.addEventListener("click", () => {
      MASTER_ROOM_STATE.ui.selectedNoteId = btn.dataset.masterRuntimeNote || "";
      renderMasterRoom();
    });
  });

  root.querySelectorAll("[data-master-runtime-event]").forEach((btn) => {
    if (btn.dataset.boundMasterEvent === "1") return;
    btn.dataset.boundMasterEvent = "1";
    btn.addEventListener("click", () => {
      MASTER_ROOM_STATE.ui.selectedEventId = btn.dataset.masterRuntimeEvent || "";
      if (MASTER_ROOM_STATE.activeTab !== "journal") {
        MASTER_ROOM_STATE.activeTab = "journal";
        writeUiState();
        renderMasterRoom();
        return;
      }
      root.querySelectorAll("[data-master-runtime-event]").forEach((row) => row.classList.toggle("active", row === btn));
      const details = root.querySelector("[data-master-journal-details]");
      const table = getActiveTable();
      if (details && table) details.innerHTML = renderMasterJournalDetails(table, canManageTable(table));
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


  root.querySelectorAll("[data-master-runtime-focus-combatant]").forEach((btn) => {
    if (btn.dataset.boundCombatFocus === "1") return;
    btn.dataset.boundCombatFocus = "1";
    btn.addEventListener("click", () => {
      const table = getActiveTable();
      if (!table) return;
      table.combat = normalizeCombat(table.combat, table);
      const entryId = btn.dataset.masterRuntimeFocusCombatant || "";
      const current = getCurrentCombatEntry(table.combat);
      MASTER_ROOM_STATE.ui.selectedCombatEntryId = entryId;
      if (entryId && String(entryId) !== String(current?.entry_id || "")) {
        MASTER_ROOM_STATE.ui.selectedCombatTargetId = entryId;
        table.combat.target_entry_id = entryId;
      }
      writeUiState();
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

  root.querySelectorAll("[data-master-runtime-scene-entry-field]").forEach((field) => {
    if (field.dataset.boundSceneField === "1") return;
    field.dataset.boundSceneField = "1";
    field.addEventListener("change", async () => {
      const table = getActiveTable();
      if (!table) return;
      table.combat = normalizeCombat(table.combat, table);
      const entry = safeArray(table.combat.entries).find((item) => String(item.entry_id) === String(field.dataset.entryId || ""));
      if (!entry) return;
      const scene = normalizeCombatScene(table.combat.scene, table);
      entry.scene_state = snapScenePosition(normalizeCombatSceneToken(entry, 0, entry.type), scene);
      const key = field.dataset.masterRuntimeSceneEntryField || "x";
      if (["x", "y", "z"].includes(key)) {
        const candidate = snapScenePosition({ ...entry.scene_state, [key]: safeNumber(field.value, entry.scene_state[key] || 0) }, scene);
        const collision = findCombatSceneCollision(table.combat.entries, entry, candidate, scene);
        if (collision) {
          showToast(`Клетка занята: ${collision.name || "другой участник"}`);
          renderMasterRoom();
          return;
        }
        entry.scene_state = candidate;
      } else {
        entry.scene_state[key] = field.value;
      }
      await persistMasterRoom();
      renderMasterRoom();
    });
  });

  root.querySelectorAll("[data-master-runtime-scene-entry-visible]").forEach((field) => {
    if (field.dataset.boundSceneVisible === "1") return;
    field.dataset.boundSceneVisible = "1";
    field.addEventListener("change", async () => {
      const table = getActiveTable();
      if (!table) return;
      table.combat = normalizeCombat(table.combat, table);
      const entry = safeArray(table.combat.entries).find((item) => String(item.entry_id) === String(field.dataset.masterRuntimeSceneEntryVisible || ""));
      if (!entry) return;
      entry.scene_state = normalizeCombatSceneToken(entry, 0, entry.type);
      entry.scene_state.visible_to_players = Boolean(field.checked);
      entry.scene_state.hidden = !field.checked;
      await persistMasterRoom();
      renderMasterRoom();
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


  root.querySelectorAll('[data-master-runtime-action="move-combat-token"]').forEach((btn) => {
    if (btn.dataset.boundMovePreview === "1") return;
    btn.dataset.boundMovePreview = "1";
    const showPreview = () => {
      const table = getActiveTable();
      if (!table) return;
      const distance = safeNumber(root.querySelector("#masterRuntimeMoveDistance")?.value, table.combat?.scene?.grid_size_ft || 5);
      const freeMove = Boolean(root.querySelector("#masterRuntimeMoveFree")?.checked);
      const preview = buildMovementPreview(table, {
        entryId: btn.dataset.entryId || "",
        direction: btn.dataset.moveDir || "e",
        distance,
        freeMove,
      });
      updateMovementPreviewDom(root, preview);
    };
    btn.addEventListener("mouseenter", showPreview);
    btn.addEventListener("focus", showPreview);
    btn.addEventListener("mouseleave", () => clearMovementPreviewDom(root));
    btn.addEventListener("blur", () => clearMovementPreviewDom(root));
  });

  root.querySelectorAll("[data-master-runtime-action]").forEach((btn) => {
    if (btn.dataset.boundMasterAction === "1") return;
    btn.dataset.boundMasterAction = "1";
    btn.addEventListener("click", async () => {
      const action = btn.dataset.masterRuntimeAction || "";
      const table = getActiveTable();
      if (action === "open-journal") {
        MASTER_ROOM_STATE.activeTab = "journal";
        writeUiState();
        renderMasterRoom();
        return;
      }
      if (action === "exit-to-cabinet") {
        switchToCabinetTab("myaccount");
        return;
      }
      if (action === "back-to-table-list") {
        MASTER_ROOM_STATE.activeTableId = MASTER_ROOM_LOBBY_ID;
        MASTER_ROOM_STATE.activeTab = "table";
        MASTER_ROOM_STATE.ui.diceDrawerOpen = false;
        writeUiState();
        renderMasterRoom();
        return;
      }
      if (action === "exit-to-dashboard") {
        MASTER_ROOM_STATE.activeTableId = MASTER_ROOM_LOBBY_ID;
        MASTER_ROOM_STATE.activeTab = "table";
        writeUiState();
        renderMasterRoom();
        return;
      }
      if (action === "open-inventory") {
        openCabinetTarget("inventory", "инвентарь");
        return;
      }
      if (action === "open-map") {
        openCabinetTarget("map", "карту");
        return;
      }
      if (action === "open-lss") {
        openCabinetTarget("lss", "LSS");
        return;
      }
      if (action === "toggle-dice-drawer") {
        MASTER_ROOM_STATE.ui.diceDrawerOpen = !MASTER_ROOM_STATE.ui.diceDrawerOpen;
        writeUiState();
        renderMasterRoom();
        return;
      }
      if (action === "clear-table-search") {
        MASTER_ROOM_STATE.searchQuery = "";
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
        applyLssSnapshotToMember(member);
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
      if (action === "add-note" && table) {
        await addMasterNote(table);
        return;
      }
      if (action === "select-bestiary-monster") {
        MASTER_ROOM_STATE.ui.selectedBestiaryMonsterId = btn.dataset.bestiaryId || "";
        refreshBestiaryPickerDom(root);
        return;
      }
      if (action === "refresh-bestiary-pool") {
        await loadBestiaryBridgeEntries({ renderWhenDone: false, toast: true });
        showToast(`Пул Бестиария: ${getKnownMonsterEntries().length} монстров`);
        refreshBestiaryPickerDom(root);
        return;
      }

      if (action === "set-combat-selected" && table) {
        MASTER_ROOM_STATE.ui.selectedCombatEntryId = btn.dataset.entryId || "";
        writeUiState();
        renderMasterRoom();
        return;
      }
      if (action === "set-combat-target" && table) {
        table.combat = normalizeCombat(table.combat, table);
        MASTER_ROOM_STATE.ui.selectedCombatTargetId = btn.dataset.entryId || "";
        MASTER_ROOM_STATE.ui.selectedCombatEntryId = btn.dataset.entryId || MASTER_ROOM_STATE.ui.selectedCombatEntryId || "";
        table.combat.target_entry_id = MASTER_ROOM_STATE.ui.selectedCombatTargetId;
        await persistMasterRoom();
        renderMasterRoom();
        return;
      }
      if (action === "set-combat-turn-entry" && table) {
        table.combat = normalizeCombat(table.combat, table);
        const entryId = btn.dataset.entryId || "";
        const index = safeArray(table.combat.entries).findIndex((entry) => String(entry.entry_id || "") === String(entryId));
        if (index < 0) return;
        table.combat.turn_index = index;
        MASTER_ROOM_STATE.ui.selectedCombatEntryId = entryId;
        if (table.combat.entries[index]) resetCombatEntryTurnResources(table.combat.entries[index]);
        await persistMasterRoom();
        renderMasterRoom();
        return;
      }
      if (action === "combat-move-maneuver" && table) {
        const maneuverLabel = btn.textContent?.trim() || "манёвр";
        if (!confirmMasterAction(`Подтвердить манёвр?\n\n${maneuverLabel}`)) return;
        await applyCombatMovementManeuver(table, {
          entryId: btn.dataset.entryId || "",
          maneuver: btn.dataset.moveManeuver || "",
        });
        return;
      }
      if (action === "move-combat-token" && table) {
        const distance = safeNumber(root.querySelector("#masterRuntimeMoveDistance")?.value, table.combat?.scene?.grid_size_ft || 5);
        const freeMove = Boolean(root.querySelector("#masterRuntimeMoveFree")?.checked);
        const preview = buildMovementPreview(table, {
          entryId: btn.dataset.entryId || "",
          direction: btn.dataset.moveDir || "e",
          distance,
          freeMove,
        });
        updateMovementPreviewDom(root, preview);
        if (!preview) return;
        if (!preview.ok) {
          showToast(preview.message);
          return;
        }
        if (!confirmMovementPreview(preview)) return;
        clearMovementPreviewDom(root);
        await moveCombatToken(table, {
          entryId: btn.dataset.entryId || "",
          direction: btn.dataset.moveDir || "e",
          distance,
          freeMove,
        });
        return;
      }
      if (action === "seed-combat-scene" && table) {
        await seedCombatScene(table);
        return;
      }
      if (action === "save-combat-scene" && table) {
        table.combat = normalizeCombat(table.combat, table);
        const nextScene = normalizeCombatScene({
          ...table.combat.scene,
          map_name: trimText(root.querySelector("#masterRuntimeCombatSceneMapName")?.value || table.combat.scene?.map_name || table.scene),
          width: safeNumber(root.querySelector("#masterRuntimeCombatSceneWidth")?.value, table.combat.scene?.width || 120),
          height: safeNumber(root.querySelector("#masterRuntimeCombatSceneHeight")?.value, table.combat.scene?.height || 80),
          grid_size_ft: safeNumber(root.querySelector("#masterRuntimeCombatSceneGrid")?.value, table.combat.scene?.grid_size_ft || 5),
          light: trimText(root.querySelector("#masterRuntimeCombatSceneLight")?.value || table.combat.scene?.light || "обычное освещение"),
          terrain: trimText(root.querySelector("#masterRuntimeCombatSceneTerrain")?.value || table.combat.scene?.terrain || "обычная поверхность"),
          visibility_mode: root.querySelector("#masterRuntimeCombatSceneVisibility")?.value || table.combat.scene?.visibility_mode || "party",
        }, table);
        table.combat.scene = nextScene;
        table.scene_state = nextScene;
        const placedEntries = [];
        table.combat.entries = safeArray(table.combat.entries).map((entry, index) => {
          const desired = snapScenePosition(normalizeCombatSceneToken(entry, index, entry.type), nextScene);
          entry.scene_state = findNearestFreeScenePosition(placedEntries, entry, desired, nextScene);
          placedEntries.push(entry);
          return entry;
        });
        emitMasterEvent({ type: "combat", title: "Карта сцены обновлена", description: `${nextScene.map_name}: ${nextScene.width}×${nextScene.height} фт., клетка ${nextScene.grid_size_ft} фт. • токены привязаны к сетке`, combat_type: "scene" });
        await persistMasterRoom();
        renderMasterRoom();
        return;
      }
      if (action === "center-combat-token" && table) {
        table.combat = normalizeCombat(table.combat, table);
        const scene = normalizeCombatScene(table.combat.scene, table);
        const entry = safeArray(table.combat.entries).find((item) => String(item.entry_id) === String(btn.dataset.entryId || ""));
        if (!entry) return;
        entry.scene_state = normalizeCombatSceneToken(entry, 0, entry.type);
        entry.scene_state = findNearestFreeScenePosition(
          table.combat.entries,
          entry,
          { ...entry.scene_state, x: scene.width / 2, y: scene.height / 2, z: 0 },
          scene,
        );
        await persistMasterRoom();
        renderMasterRoom();
        return;
      }
      if (action === "start-combat" && table) await startCombat(table);
      if (action === "open-combat" && table) {
        MASTER_ROOM_STATE.activeTab = "combat";
        await startCombat(table);
      }
      if (action === "open-bestiary-pool") {
        MASTER_ROOM_STATE.activeTab = "combat";
        MASTER_ROOM_STATE.ui.combatSetupOpen = true;
        writeUiState();
        queueBestiaryBridgeLoad({ focusSelector: "#masterRuntimeEnemySearch" });
        renderMasterRoomStable("#masterRuntimeEnemySearch");
        setTimeout(() => {
          const input = getSection("cabinet-masterroom")?.querySelector("#masterRuntimeEnemySearch");
          try { input?.focus({ preventScroll: true }); } catch (_) {}
        }, 30);
        return;
      }
      if (action === "open-bestiary") {
        openCabinetTarget("bestiari", "Бестиарий");
        return;
      }
      if (action === "add-selected-enemy" && table) {
        const selectedId = root.querySelector("#masterRuntimeEnemySelect")?.value || MASTER_ROOM_STATE.ui.selectedBestiaryMonsterId || "";
        const monsters = filterMonsterEntries(getKnownMonsterEntries());
        const entry = monsters.find((item, index) => String(getBestiaryEntryId(item, index)) === String(selectedId)) || monsters[0];
        if (!entry) return showToast("Выбери монстра из Бестиария");
        const summary = buildBestiaryCombatSummary(entry);
        if (!confirmMasterAction(`Добавить монстра из Бестиария?\n\n${summary.name || "Монстр"}\nКД ${summary.ac || "—"} • HP ${summary.hp || "—"} • скорость ${summary.speed || "—"} фт.`)) return;
        table.combat = normalizeCombat(table.combat, table);
        const enemy = bestiaryEntryToCombatEnemy(entry);
        enemy.name = makeCombatCloneName(table, enemy.name, enemy.bestiary_id || summary.id);
        const scene = normalizeCombatScene(table.combat.scene, table);
        const desired = normalizeCombatSceneToken(enemy, table.combat.entries.length, enemy.type);
        enemy.scene_state = findNearestFreeScenePosition(table.combat.entries, enemy, desired, scene);
        table.combat.entries.push(enemy);
        table.combat.entries.sort((a, b) => safeNumber(b.initiative, 0) - safeNumber(a.initiative, 0));
        table.combat.active = true;
        MASTER_ROOM_STATE.ui.selectedBestiaryMonsterId = getBestiaryEntryId(entry);
        emitMasterEvent({ type: "combat", title: "Монстр из Бестиария", description: `${enemy.name}: КД ${enemy.ac}, HP ${enemy.hp_max}, скорость ${enemy.speed} фт.`, combat_type: "spawn" });
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


function applyLssSnapshotToCombatEntry(entry, lss = getLssSnapshot()) {
  if (!entry || !lss) return entry;
  const preserve = {
    hp_current: entry.hp_current,
    hp_max: entry.hp_max,
    temp_hp: entry.temp_hp,
    scene_state: cloneCombatProfileValue(entry.scene_state, {}),
    turn_resources: cloneCombatProfileValue(entry.turn_resources, {}),
    turn_flags: cloneCombatProfileValue(entry.turn_flags, {}),
    status: entry.status,
    conditions: safeArray(entry.conditions),
  };
  entry.name = lss.name || entry.name;
  entry.class_name = lss.class_name || entry.class_name;
  entry.race = lss.race || entry.race;
  entry.level = lss.level || entry.level;
  entry.portrait_url = lss.portrait_url || entry.portrait_url;
  entry.ac = lss.ac;
  entry.speed = lss.speed;
  entry.initiative = lss.initiative;
  entry.proficiency_bonus = lss.proficiency_bonus;
  entry.abilities = cloneCombatProfileValue(lss.abilities, {});
  entry.saves = cloneCombatProfileValue(lss.saves, {});
  entry.skills = cloneCombatProfileValue(lss.skills, {});
  entry.attacks = safeArray(lss.attacks);
  entry.spells = sanitizeMasterCombatSpellCollection(lss.spells);
  entry.spell_slots = normalizeMasterRuntimeSpellSlots(lss.spell_slots);
  entry.spells_meta = cloneCombatProfileValue(lss.spells_meta, {});
  entry.spellcasting = cloneCombatProfileValue(lss.spellcasting, {});
  entry.combat_profile = cloneCombatProfileValue(lss.combat_profile, {});
  entry.features = safeArray(lss.features);
  entry.inventory = safeArray(lss.inventory);
  entry.equipped_items = safeArray(lss.equipped_items);
  entry.buffs = safeArray(lss.buffs);
  entry.debuffs = safeArray(lss.debuffs);
  entry.resistances = safeArray(lss.resistances);
  entry.vulnerabilities = safeArray(lss.vulnerabilities);
  entry.immunities = safeArray(lss.immunities);
  entry.sheet = cloneCombatProfileValue(lss.sheet, {});
  Object.assign(entry, preserve);
  return entry;
}

async function syncActiveMasterRoomLssRuntime(options = {}) {
  const table = getActiveTable();
  if (!table) return;
  const lss = getLssSnapshot();
  if (!lss?.name && !safeArray(lss?.spells).length) return;
  const member = getCurrentMember(table);
  if (member) applyLssSnapshotToMember(member, lss);
  table.combat = normalizeCombat(table.combat, table);
  safeArray(table.combat.entries).forEach((entry) => {
    const belongsToMember = member && String(entry.membership_id || "") === String(member.id || "");
    const isCurrentLss = String(entry.source_kind || "").toLowerCase() === "lss" && (!member || belongsToMember || String(entry.name || "") === String(member.selected_character_name || lss.name || ""));
    if (belongsToMember || isCurrentLss) applyLssSnapshotToCombatEntry(entry, lss);
  });
  if (options.persist !== false) await persistMasterRoom();
  if (options.render !== false) renderMasterRoomStable();
}

function bindMasterRoomLssRuntimeBridge() {
  if (masterRoomLssBridgeBound || typeof window === "undefined") return;
  masterRoomLssBridgeBound = true;
  window.addEventListener("dnd:lss:updated", () => {
    if (masterRoomLssBridgeTimer) clearTimeout(masterRoomLssBridgeTimer);
    masterRoomLssBridgeTimer = setTimeout(() => {
      syncActiveMasterRoomLssRuntime({ persist: true, render: MASTER_ROOM_STATE.activeTab === "combat" }).catch(() => {});
    }, 120);
  });
}

export async function initMasterRoom() {
  bindMasterRoomLssRuntimeBridge();
  await loadMasterRoom();
  await syncActiveMasterRoomLssRuntime({ persist: false, render: false });
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
