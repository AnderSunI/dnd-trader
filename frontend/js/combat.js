// ============================================================
// frontend/js/combat.js
// Battle UI renderer for Master Room.
// Owns only the combat surface; cabinet.js keeps API/data wiring.
// Round 29: reference battle screen + action composer + log journal.
// Round 33: action resolver MVP. Action type now changes the visible card,
// builds a readable reason, and can apply direct damage/healing via callbacks.
// Round 34: turn resources + defeated enemies. This is still not the final
// rules engine; it adds the combat-state contract for action/bonus/movement
// and makes dead enemies visually/turn-logically different from downed players.
// Round 35: attack-vs-AC MVP. The combat surface can now resolve weapon/monster
// attack rolls locally: d20 + attack bonus against target AC, roll damage on hit,
// call the parent HP callback, and write one readable journal line.
// Round 36: resource-first action picker. Actions are grouped by action economy,
// Round 37: focused resource picker. Only one resource panel is visible, GM tools are separate,
// Round 38: profile action catalog. Concrete attacks, spells and features from the
// resolved combat profile are shown directly; narrow-column layout no longer clips labels.
// Round 39: spell saves now roll against target modifiers, apply full/half/zero damage,
// Round 40: area metadata and multi-target spell resolution with one shared damage roll,
// respect resistance/immunity/vulnerability, and expose concentration checks to Master Room.
// movement bridges to the map panel, and the composer waits for an explicit action selection.
// spells/features are read from the LSS combat snapshot, GM tools are separated,
// spent resources are visible, and the local combat journal has useful filters.
// Full rules engine later: slots, reactions, effects and scene rules are persisted
// by the parent Master Room instead of only being represented in the UI.
// ============================================================

import {
  escapeHtml,
  formatTime,
  safeArray,
  safeNumber,
  safeText,
} from "./shared.js";

export const COMBAT_MODULE_VERSION = "combat-v12-spell-areas-multitarget";

const DICE_PRESETS = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];

const LOG_FILTERS = [
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

const ACTION_PRESETS = [
  // resource: which per-turn slot this action normally spends.
  // The parent Master Room callback can persist it later; for now we send it
  // in roll payloads and render the current availability.
  { key: "attack", label: "Атака", icon: "⚔", eventType: "attack", dice: "d20", reason: "Атака", resource: "action" },
  { key: "spell", label: "Заклинание", icon: "✦", eventType: "spell", dice: "d20", reason: "Заклинание", resource: "action" },
  { key: "damage", label: "Урон", icon: "🔥", eventType: "damage", dice: "1d8", reason: "Урон", resource: "none" },
  { key: "heal", label: "Лечение", icon: "✚", eventType: "heal", dice: "1d8", reason: "Лечение", resource: "none" },
  { key: "movement", label: "Движение", icon: "➜", eventType: "move", dice: "", reason: "Движение", resource: "movement" },
  { key: "save", label: "Спасбросок", icon: "🛡", eventType: "save", dice: "d20", reason: "Спасбросок", resource: "reaction" },
  { key: "check", label: "Проверка", icon: "◇", eventType: "check", dice: "d20", reason: "Проверка", resource: "action" },
  { key: "effect", label: "Эффект", icon: "☄", eventType: "effect", dice: "d20", reason: "Эффект / состояние", resource: "free_action" },
  { key: "note", label: "Заметка", icon: "✎", eventType: "note", dice: "d20", reason: "Заметка боя", resource: "none" },
];

const TURN_RESOURCE_OPTIONS = [
  { key: "action", label: "Основное действие", short: "Действие" },
  { key: "bonus_action", label: "Бонусное действие", short: "Бонус" },
  { key: "movement", label: "Движение", short: "Движение" },
  { key: "reaction", label: "Реакция", short: "Реакция" },
  { key: "free_action", label: "Свободное действие", short: "Своб." },
  { key: "object_interaction", label: "Взаимодействие с предметом", short: "Предмет" },
  { key: "none", label: "GM / без траты ресурса", short: "GM" },
];

const ABILITY_OPTIONS = [
  ["str", "Сила"],
  ["dex", "Ловкость"],
  ["con", "Телосложение"],
  ["int", "Интеллект"],
  ["wis", "Мудрость"],
  ["cha", "Харизма"],
];

const ACTION_MODE_COPY = {
  attack: { title: "Атака", hint: "d20 + бонус атаки против КД цели. При попадании урон бросается и применяется к выбранной цели после подтверждения." },
  spell: { title: "Заклинание", hint: "Выбери заклинание из LSS: ресурс, круг, дальность, атака или спасбросок и эффект подставятся из профиля персонажа." },
  damage: { title: "Урон", hint: "Прямое уменьшение HP выбранной цели. Если указано число урона — применится к цели и попадёт в журнал." },
  heal: { title: "Лечение", hint: "Прямое восстановление HP выбранной цели. Если указано число лечения — применится к цели и попадёт в журнал." },
  movement: { title: "Движение", hint: "Тратит доступные футы. Точное перемещение и проверку клеток выполняй на карте сцены; здесь фиксируется тип манёвра." },
  save: { title: "Спасбросок", hint: "d20 + модификатор выбранной характеристики против Сл. Авто-успех/провал сделаем после DC-engine." },
  check: { title: "Проверка", hint: "d20 + модификатор характеристики/навыка. Можно использовать для Атлетики, Скрытности, Анализа и т.д." },
  effect: { title: "Эффект", hint: "Записывает состояние, баф, дебаф или сценический эффект. Авто-длительности позже." },
  note: { title: "Заметка", hint: "Быстрая запись в журнал боя без расхода ресурса хода и без обязательного броска." },
  roll: { title: "Бросок", hint: "Свободный бросок куба без правил. Для быстрых GM-проверок." },
};

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

function normalizeScope(value) {
  const raw = String(value || "public").trim().toLowerCase();
  return ["public", "gm_only", "owner_only", "revealed"].includes(raw) ? raw : "public";
}

function normalizeEntryType(value, fallback = "member") {
  const raw = String(value || fallback).trim().toLowerCase();
  if (["enemy", "npc", "member"].includes(raw)) return raw;
  return fallback;
}

function normalizeEventType(value) {
  const raw = String(value || "note").trim().toLowerCase();
  if (["attack", "spell", "damage", "heal", "save", "check", "effect", "move", "roll", "turn", "round", "sync", "spawn", "note"].includes(raw)) {
    return raw;
  }
  return "note";
}

function resolveEntryId(entry, index = 0) {
  const direct = String(entry?.entry_id || "").trim();
  if (direct) return direct;
  if (entry?.membership_id) return `member:${entry.membership_id}`;
  if (entry?.id) return String(entry.id);
  return `entry:${index + 1}`;
}

function normalizeAbilities(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    str: safeNumber(source.str ?? source.strength ?? source.сила, 10),
    dex: safeNumber(source.dex ?? source.dexterity ?? source.ловкость, 10),
    con: safeNumber(source.con ?? source.constitution ?? source.телосложение, 10),
    int: safeNumber(source.int ?? source.intelligence ?? source.интеллект, 10),
    wis: safeNumber(source.wis ?? source.wisdom ?? source.мудрость, 10),
    cha: safeNumber(source.cha ?? source.charisma ?? source.харизма, 10),
  };
}

function getAbilityMod(score) {
  const mod = Math.floor((safeNumber(score, 10) - 10) / 2);
  return mod >= 0 ? `+${mod}` : String(mod);
}

function readBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    if (["1", "true", "yes", "да", "available", "ready"].includes(raw)) return true;
    if (["0", "false", "no", "нет", "spent", "used", "done"].includes(raw)) return false;
  }
  return fallback;
}

function normalizeTurnResources(source, speed = 30) {
  const data = source && typeof source === "object" ? source : {};
  const turn = data.turn_resources || data.turnResources || data.resources || data;
  const movementTotal = Math.max(0, safeNumber(turn.movement_total ?? turn.movement ?? turn.speed ?? speed, speed));
  const movementUsed = Math.max(0, safeNumber(turn.movement_used ?? turn.used_movement, 0));
  const explicitRemaining = turn.movement_remaining ?? turn.remaining_movement;
  const movementRemaining = Math.max(0, explicitRemaining === undefined ? movementTotal - movementUsed : safeNumber(explicitRemaining, movementTotal));

  return {
    action_available: readBool(turn.action_available ?? turn.action, true),
    bonus_action_available: readBool(turn.bonus_action_available ?? turn.bonus_action ?? turn.bonus, true),
    reaction_available: readBool(turn.reaction_available ?? turn.reaction, true),
    free_action_available: readBool(turn.free_action_available ?? turn.free_action, true),
    object_interaction_available: readBool(turn.object_interaction_available ?? turn.object_interaction, true),
    movement_total: movementTotal,
    movement_used: movementUsed,
    movement_remaining: movementRemaining,
  };
}

function deriveCombatStatus({ entryType, entityKind, hpCurrent, hpMax, rawStatus }) {
  const raw = String(rawStatus || "ready").trim().toLowerCase();
  if (["dead", "killed", "defeated", "down", "unconscious", "dying"].includes(raw)) return raw;
  const kind = String(entityKind || entryType || "").trim().toLowerCase();
  const hasHp = Number.isFinite(Number(hpMax)) && Number(hpMax) > 0;
  if (hasHp && Number(hpCurrent) <= 0) {
    if (kind === "enemy" || entryType === "enemy") return "dead";
    return "down";
  }
  return raw || "ready";
}

function isDeadEnemy(entry) {
  const status = String(entry?.status || "").trim().toLowerCase();
  const kind = String(entry?.entity_kind || entry?.entry_type || "").trim().toLowerCase();
  return (kind === "enemy" || entry?.entry_type === "enemy") && (status === "dead" || status === "killed" || status === "defeated" || safeNumber(entry?.hp_current, 1) <= 0);
}

function isTurnEligible(entry) {
  if (!entry) return false;
  // Dead enemies are skipped automatically. Downed players are intentionally
  // not skipped here: later they can use death saves / receive help.
  return !isDeadEnemy(entry);
}

function getTurnResourceMeta(key) {
  const raw = String(key || "none").trim();
  return TURN_RESOURCE_OPTIONS.find((item) => item.key === raw) || TURN_RESOURCE_OPTIONS.at(-1);
}

function getActionResource(actionKey) {
  return getActionPreset(actionKey).resource || "none";
}

export function normalizeCombatEntry(entry, index = 0) {
  const source = entry && typeof entry === "object" ? entry : {};
  const entryId = resolveEntryId(source, index);
  const entryType = normalizeEntryType(source.entry_type, source.membership_id ? "member" : "enemy");
  const hpMax = Math.max(0, safeNumber(source.hp_max ?? source.max_hp, 0));
  const hpCurrent = Math.max(0, safeNumber(source.hp_current ?? source.hp, hpMax));
  const temporaryHp = Math.max(0, safeNumber(source.temp_hp ?? source.temporary_hp, 0));
  const speed = Math.max(0, safeNumber(source.speed ?? source.walk_speed, 30));
  const entityKind = displayText(source.entity_kind || (entryType === "enemy" ? "enemy" : "player"), "player");
  const status = deriveCombatStatus({
    entryType,
    entityKind,
    hpCurrent: hpMax > 0 ? Math.min(hpCurrent, hpMax) : hpCurrent,
    hpMax,
    rawStatus: source.status,
  });
  const abilities = normalizeAbilities(source.abilities || source.stats || source.характеристики);

  return {
    entry_id: entryId,
    entry_type: entryType,
    membership_id: String(source.membership_id || ""),
    user_id: String(source.user_id || ""),
    selected_character_id: String(source.selected_character_id || ""),
    name: displayText(source.name, `Участник ${index + 1}`),
    role_in_table: displayText(source.role_in_table, "player"),
    entity_kind: entityKind,
    hp_current: hpMax > 0 ? Math.min(hpCurrent, hpMax) : hpCurrent,
    hp_max: hpMax,
    temp_hp: temporaryHp,
    ac: Math.max(0, safeNumber(source.ac ?? source.armor_class, 0)),
    initiative: safeNumber(source.initiative, 0),
    speed,
    status,
    notes: displayText(source.notes, ""),
    source: displayText(source.source, "table"),
    source_kind: displayText(source.source_kind || source.sourceKind, ""),
    bestiary_id: displayText(source.bestiary_id || source.bestiaryId, ""),
    bestiary_summary: source.bestiary_summary || source.bestiarySummary || null,
    snapshot: source.snapshot || null,
    items: safeArray(source.items || source.equipment),
    buffs: safeArray(source.buffs || source.effects),
    turn_flags: source.turn_flags && typeof source.turn_flags === "object" ? { ...source.turn_flags } : {},
    portrait_url: displayText(source.portrait_url || source.avatar_url, ""),
    level: Math.max(0, safeNumber(source.level, 0)),
    class_name: displayText(source.class_name || source.class, ""),
    race: displayText(source.race || source.species, ""),
    attacks: safeArray(source.attacks || source.actions),
    spells: safeArray(source.spells),
    spell_slots: safeArray(source.spell_slots || source.spellSlots),
    spellcasting: source.spellcasting && typeof source.spellcasting === "object" ? { ...source.spellcasting } : {},
    features: safeArray(source.features || source.traits || source.abilities_list),
    saves: source.saves && typeof source.saves === "object" ? { ...source.saves } : {},
    skills: source.skills && typeof source.skills === "object" ? { ...source.skills } : {},
    proficiency_bonus: Math.max(0, safeNumber(source.proficiency_bonus ?? source.proficiency, 0)),
    sheet: source.sheet && typeof source.sheet === "object" ? source.sheet : {},
    inventory: safeArray(source.inventory || source.items),
    equipped_items: safeArray(source.equipped_items || source.equippedItems),
    combat_profile: source.combat_profile && typeof source.combat_profile === "object" ? { ...source.combat_profile } : {},
    debuffs: safeArray(source.debuffs),
    conditions: safeArray(source.conditions || source.effects || source.statuses),
    abilities,
    resistances: safeArray(source.resistances),
    vulnerabilities: safeArray(source.vulnerabilities),
    immunities: safeArray(source.immunities),
    turn_resources: normalizeTurnResources(source, speed),
  };
}

export function normalizeCombatLogEntry(entry, index = 0) {
  const source = entry && typeof entry === "object" ? entry : {};
  const eventType = normalizeEventType(source.event_type || source.type);

  return {
    id: String(source.id || `combat-log-${index}`),
    entry_id: String(source.entry_id || "").trim(),
    target_entry_id: String(source.target_entry_id || "").trim(),
    actor_name: displayText(source.actor_name, "Система"),
    target_name: displayText(source.target_name, ""),
    type: eventType,
    event_type: eventType,
    dice: displayText(source.dice, ""),
    modifier: safeNumber(source.modifier, 0),
    roll_total: safeNumber(source.roll_total, 0),
    damage: safeNumber(source.damage, 0),
    damage_type: displayText(source.damage_type, ""),
    outcome: displayText(source.outcome, ""),
    visibility: normalizeScope(source.visibility),
    round: Math.max(1, safeNumber(source.round, 1)),
    reason: displayText(source.reason, ""),
    text: displayText(source.text, ""),
    created_at: source.created_at || source.at || new Date().toISOString(),
  };
}

export function normalizeCombatState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const entries = safeArray(source.entries).map((entry, index) => normalizeCombatEntry(entry, index));
  const sortedEntries = entries.slice().sort((a, b) => safeNumber(b.initiative, 0) - safeNumber(a.initiative, 0));
  const rawTurn = Math.max(0, safeNumber(source.turn_index, 0));

  return {
    active: Boolean(source.active),
    round: Math.max(1, safeNumber(source.round, 1)),
    turn_index: sortedEntries.length ? Math.min(rawTurn, sortedEntries.length - 1) : 0,
    updated_at: source.updated_at || new Date().toISOString(),
    entries: sortedEntries,
    log: safeArray(source.log).map((entry, index) => normalizeCombatLogEntry(entry, index)),
  };
}

function findNextEligibleTurnIndex(combat, startIndex = 0) {
  const entries = safeArray(combat?.entries);
  if (!entries.length) return { index: 0, roundDelta: 0, skippedIds: [] };
  const normalizedStart = Math.max(0, safeNumber(startIndex, 0));
  const skippedIds = [];

  for (let step = 0; step < entries.length; step += 1) {
    const rawIndex = normalizedStart + step;
    const index = rawIndex % entries.length;
    const entry = entries[index];
    if (isTurnEligible(entry)) {
      return { index, roundDelta: rawIndex >= entries.length ? 1 : 0, skippedIds };
    }
    if (entry?.entry_id) skippedIds.push(entry.entry_id);
  }

  return { index: Math.min(normalizedStart, entries.length - 1), roundDelta: 0, skippedIds };
}

function getCurrentTurnIndex(combat) {
  const entries = safeArray(combat?.entries);
  if (!entries.length) return 0;
  const rawIndex = Math.min(Math.max(0, safeNumber(combat?.turn_index, 0)), entries.length - 1);
  return findNextEligibleTurnIndex(combat, rawIndex).index;
}

function getCurrentTurnEntry(combat) {
  const entries = safeArray(combat?.entries);
  if (!entries.length) return null;
  return entries[getCurrentTurnIndex(combat)] || entries[0] || null;
}

function getEntryById(combat, entryId) {
  const id = String(entryId || "").trim();
  return safeArray(combat?.entries).find((entry) => String(entry.entry_id) === id) || null;
}

function getSuggestedTarget(combat, current) {
  const entries = safeArray(combat?.entries);
  const latestTargetId = safeArray(combat?.log).slice().reverse().find((entry) => entry?.target_entry_id)?.target_entry_id || "";
  const latestTarget = getEntryById(combat, latestTargetId);
  if (latestTarget) return latestTarget;
  const currentKind = String(current?.entity_kind || current?.entry_type || "").toLowerCase();
  const target = entries.find((entry) => {
    if (entry.entry_id === current?.entry_id) return false;
    const kind = String(entry.entity_kind || entry.entry_type || "").toLowerCase();
    if (currentKind === "enemy") return kind !== "enemy";
    return kind === "enemy" || entry.entry_type === "enemy";
  });
  return target || entries.find((entry) => entry.entry_id !== current?.entry_id) || current || null;
}

function getStatusMeta(status) {
  const raw = String(status || "ready").trim().toLowerCase();
  if (["dead", "killed", "defeated"].includes(raw)) return { label: "Выбыл", className: "is-dead" };
  if (["down", "unconscious", "dying"].includes(raw)) return { label: "Без сознания", className: "is-down" };
  if (["hidden", "stealthed"].includes(raw)) return { label: "Скрыт", className: "is-hidden" };
  if (["hostile", "enemy"].includes(raw)) return { label: "Враг", className: "is-hostile" };
  if (["done", "spent", "acted"].includes(raw)) return { label: "Ход завершён", className: "is-spent" };
  return { label: raw && raw !== "ready" ? raw : "Готов", className: "is-ready" };
}

function getEntityKindLabel(entry) {
  const raw = String(entry?.entity_kind || entry?.entry_type || "player").trim().toLowerCase();
  if (raw === "enemy") return "Враг";
  if (raw === "npc") return "NPC";
  if (raw === "gm") return "GM";
  if (raw === "ally") return "Союзник";
  return "Игрок";
}

function renderPortrait(entry, className = "combat-portrait") {
  const name = String(entry?.name || "?").trim();
  if (entry?.portrait_url) {
    return `<img src="${escapeHtml(entry.portrait_url)}" alt="${escapeHtml(name)}" class="${className}__img">`;
  }
  return `<span class="${className}__fallback">${escapeHtml((name || "?").slice(0, 1).toUpperCase())}</span>`;
}

function renderHpMeter(entry, className = "combat-hp-meter") {
  const hpMax = Math.max(0, safeNumber(entry?.hp_max, 0));
  const hpCurrent = Math.max(0, safeNumber(entry?.hp_current, 0));
  const pct = hpMax > 0 ? Math.max(0, Math.min(100, Math.round((hpCurrent / hpMax) * 100))) : 0;

  return `
    <div class="${className}" aria-label="HP ${escapeHtml(String(hpCurrent))}/${escapeHtml(String(hpMax))}">
      <span class="${className}__fill" style="width:${escapeHtml(String(pct))}%"></span>
    </div>
  `;
}

function getLogTone(entry) {
  const type = normalizeEventType(entry?.event_type || entry?.type);
  if (["damage", "attack", "move"].includes(type)) return "combat";
  if (type === "heal") return "heal";
  if (type === "effect") return "effect";
  if (["save", "roll"].includes(type)) return "dice";
  if (["turn", "round", "sync", "spawn"].includes(type)) return "system";
  return "note";
}

function getLogBucket(entry) {
  const type = normalizeEventType(entry?.event_type || entry?.type);
  if (type === "move") return "move";
  if (type === "attack") return "attack";
  if (type === "spell") return "spell";
  if (type === "damage" || type === "heal") return "hp";
  if (type === "effect") return "effect";
  if (type === "save" || type === "check" || type === "roll") return "dice";
  if (type === "turn" || type === "round" || type === "sync" || type === "spawn") return "system";
  return "note";
}

function isLogVisible(entry, filter = "all", hideSecondary = false) {
  const bucket = getLogBucket(entry);
  if (hideSecondary && ["system", "note"].includes(bucket)) return false;
  if (filter === "all") return true;
  if (filter === "combat") return ["move", "attack", "spell", "hp", "effect", "dice"].includes(bucket);
  return bucket === filter;
}

function getLogIcon(entry) {
  const type = normalizeEventType(entry?.event_type || entry?.type);
  if (type === "attack") return "⚔";
  if (type === "spell") return "✦";
  if (type === "damage") return "🔥";
  if (type === "heal") return "✚";
  if (type === "move") return "➜";
  if (type === "save") return "🛡";
  if (type === "effect") return "✦";
  if (type === "check") return "◇";
  if (type === "roll") return "◆";
  if (type === "turn") return "➜";
  if (type === "round") return "◎";
  return "✎";
}

function getLogHeadline(entry) {
  const type = normalizeEventType(entry?.event_type || entry?.type);
  const actor = displayText(entry?.actor_name, "Участник");
  const target = displayText(entry?.target_name, "цель");
  if (entry?.text) return displayText(entry.text, "Событие боя");
  if (type === "turn") return `Ход: ${actor}`;
  if (type === "round") return `Раунд ${entry?.round || 1}`;
  if (type === "save") return `${actor} делает спасбросок`;
  if (type === "check") return `${actor} проходит проверку`;
  if (type === "spell") return `${actor} творит заклинание`;
  if (type === "move") return `${actor} перемещается`;
  if (type === "attack") return `${actor} атакует ${target}`;
  if (type === "damage") return `${displayText(entry?.target_name || entry?.actor_name, "Цель")} получает урон`;
  if (type === "heal") return `${actor} лечит ${target}`;
  if (type === "effect") return `${displayText(entry?.target_name || entry?.actor_name, "Цель")} получает эффект`;
  if (type === "roll") return `${actor} бросает ${displayText(entry?.dice, "куб")}`;
  return displayText(entry?.reason, "Событие боя");
}

function getOutcomeLabel(entry) {
  const outcome = String(entry?.outcome || "").trim();
  if (outcome) return outcome;
  const type = normalizeEventType(entry?.event_type || entry?.type);
  if (type === "heal" && Number(entry?.damage || 0) > 0) return `Исцелено ${entry.damage}`;
  if ((type === "damage" || type === "effect") && Number(entry?.damage || 0) > 0) {
    return `${entry.damage}${entry?.damage_type ? ` ${entry.damage_type}` : ""}`;
  }
  if (Number.isFinite(Number(entry?.roll_total)) && Number(entry.roll_total) > 0) return String(entry.roll_total);
  return "";
}

function renderEmptyCombat(canManage = false) {
  return `
    <div class="combat-module combat-ref combat-ref-empty" data-combat-module="${COMBAT_MODULE_VERSION}">
      <section class="combat-ref-empty-card">
        <div class="combat-ref-kicker">Боевой модуль</div>
        <h3>Бой ещё не собран</h3>
        <p>Выбери персонажей из стола, добавь монстров из Бестиария и запусти инициативу. Боевой экран сохранит журнал, броски, состояния и порядок ходов.</p>
        <div class="combat-ref-empty-grid">
          <div><strong>1</strong><span>Игроки из LSS</span></div>
          <div><strong>2</strong><span>Монстры из Бестиария</span></div>
          <div><strong>3</strong><span>Инициатива и лог</span></div>
        </div>
        ${canManage ? `<div class="combat-ref-empty-note">GM может добавить врагов в панели Master Room рядом с этим экраном.</div>` : `<div class="combat-ref-empty-note">Игрок увидит бой, когда мастер запустит сцену.</div>`}
      </section>
    </div>
  `;
}

function renderInitiativeTrack(combat, canManage) {
  const current = getCurrentTurnEntry(combat);
  const currentIndex = getCurrentTurnIndex(combat);
  const currentId = current?.entry_id || "";
  const entries = safeArray(combat.entries);

  if (!entries.length) return `<div class="combat-ref-initiative combat-ref-initiative-empty">Нет участников инициативы.</div>`;

  return `
    <section class="combat-ref-initiative-shell" data-combat-region="initiative">
      <button class="combat-ref-initiative-arrow" type="button" aria-label="Назад" disabled>‹</button>
      <div class="combat-ref-initiative-track">
        ${entries.map((entry, index) => {
          const active = entry.entry_id === currentId;
          const spent = index < currentIndex;
          const status = getStatusMeta(entry.status);
          const defeated = isDeadEnemy(entry);
          return `
            <button
              type="button"
              class="combat-ref-init-card ${active ? "is-active" : ""} ${spent ? "is-spent" : ""} ${defeated ? "is-defeated" : ""} ${escapeHtml(status.className)}"
              data-combat-action="focus-turn"
              data-combat-turn-index="${escapeHtml(String(index))}"
              ${canManage ? "" : "disabled"}
            >
              <span class="combat-ref-init-portrait">${renderPortrait(entry, "combat-ref-init-portrait")}</span>
              <span class="combat-ref-init-score">${defeated ? "✕" : escapeHtml(String(entry.initiative || 0))}</span>
              <span class="combat-ref-init-name">${escapeHtml(clampText(entry.name, 22))}</span>
            </button>
          `;
        }).join("")}
      </div>
      <button class="combat-ref-initiative-arrow" type="button" aria-label="Вперёд" disabled>›</button>
    </section>
  `;
}

function getResourceAvailability(resources, key) {
  const data = resources && typeof resources === "object" ? resources : {};
  if (key === "movement") return safeNumber(data.movement_remaining, 0) > 0;
  if (key === "action") return Boolean(data.action_available);
  if (key === "bonus_action") return Boolean(data.bonus_action_available);
  if (key === "reaction") return Boolean(data.reaction_available);
  if (key === "free_action") return Boolean(data.free_action_available);
  if (key === "object_interaction") return Boolean(data.object_interaction_available);
  return true;
}

function renderTurnResources(entry) {
  const resources = normalizeTurnResources(entry || {}, safeNumber(entry?.speed, 30));
  const chips = [
    { key: "movement", icon: "⇢", label: "Движение", value: `${resources.movement_remaining}/${resources.movement_total} фт.` },
    { key: "action", icon: "●", label: "Действие", value: resources.action_available ? "доступно" : "потрачено" },
    { key: "bonus_action", icon: "◆", label: "Бонус", value: resources.bonus_action_available ? "доступно" : "потрачено" },
    { key: "reaction", icon: "↶", label: "Реакция", value: resources.reaction_available ? "доступна" : "потрачена" },
    { key: "object_interaction", icon: "○", label: "Предмет", value: resources.object_interaction_available ? "доступно" : "потрачено" },
  ];

  return `
    <div class="combat-ref-turn-resources" title="Ресурсы текущего хода. Потраченные ресурсы становятся серыми и недоступными для выполнения.">
      ${chips.map((chip) => {
        const ready = getResourceAvailability(resources, chip.key);
        return `
          <span class="combat-ref-turn-resource ${ready ? "is-ready" : "is-spent"}" data-turn-resource="${escapeHtml(chip.key)}">
            <b aria-hidden="true">${escapeHtml(chip.icon)}</b>
            <strong>${escapeHtml(chip.label)}</strong>
            <em>${escapeHtml(chip.value)}</em>
          </span>
        `;
      }).join("")}
    </div>
  `;
}

function renderCurrentTurnBanner(current, target, combat, canManage) {
  if (!current) {
    return `
      <section class="combat-ref-turn-banner combat-ref-turn-banner-empty">
        <div class="combat-ref-kicker">Текущий ход</div>
        <h3>Нет активного участника</h3>
      </section>
    `;
  }

  return `
    <section class="combat-ref-turn-banner" data-combat-region="turn">
      <div class="combat-ref-turn-actor">
        <div class="combat-ref-turn-portrait">${renderPortrait(current, "combat-ref-turn-portrait")}</div>
        <div class="combat-ref-turn-copy">
          <div class="combat-ref-kicker">Текущий ход</div>
          <h3>${escapeHtml(current.name)}</h3>
          <div class="combat-ref-turn-meta">
            <span>${escapeHtml(getEntityKindLabel(current))}</span>
            ${current.class_name ? `<span>${escapeHtml(current.class_name)}</span>` : ""}
            ${current.level ? `<span>${escapeHtml(String(current.level))} ур.</span>` : ""}
            ${current.race ? `<span>${escapeHtml(current.race)}</span>` : ""}
          </div>
          ${renderHpMeter(current, "combat-ref-hp-meter")}
          ${renderTurnResources(current)}
        </div>
      </div>
      <div class="combat-ref-turn-stats">
        <div><span>КД</span><strong>${escapeHtml(String(current.ac || 0))}</strong></div>
        <div><span>ХП</span><strong>${escapeHtml(String(current.hp_current || 0))}/${escapeHtml(String(current.hp_max || 0))}</strong></div>
        <div><span>Скорость</span><strong>${escapeHtml(String(current.speed || 30))} фт.</strong></div>
      </div>
      <div class="combat-ref-turn-target">
        <span>Цель</span>
        <strong>${escapeHtml(target?.name || "Не выбрана")}</strong>
        <small>${target ? `КД ${escapeHtml(String(target.ac || 0))} • ${escapeHtml(String(target.hp_current || 0))}/${escapeHtml(String(target.hp_max || 0))} HP` : "Выбери цель в панели действий"}</small>
      </div>
      ${(() => {
        const next = findNextEligibleTurnIndex(combat, getCurrentTurnIndex(combat) + 1);
        const skipped = next.skippedIds.length ? ` • пропуск: ${next.skippedIds.length}` : "";
        const label = canManage ? `Завершить ход${skipped}` : "Передать ход";
        return `<button class="btn ${canManage ? "btn-primary" : ""} combat-ref-end-turn" type="button" data-combat-action="next-turn" data-combat-next-index="${escapeHtml(String(next.index))}" data-combat-round-delta="${escapeHtml(String(next.roundDelta))}" data-combat-skipped-ids="${escapeHtml(next.skippedIds.join(","))}">${escapeHtml(label)}</button>`;
      })()}
    </section>
  `;
}

function getActionPreset(keyOrEvent) {
  const raw = String(keyOrEvent || "").trim().toLowerCase();
  return ACTION_PRESETS.find((item) => item.key === raw || item.eventType === raw) || ACTION_PRESETS[0];
}

function renderAbilityOptions(selected = "") {
  const value = String(selected || "").trim().toLowerCase();
  return ABILITY_OPTIONS.map(([key, label]) => `<option value="${escapeHtml(key)}" ${value === key ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function formatDiceWithModifier(dice, modifier) {
  const base = String(dice || "d20").trim() || "d20";
  const mod = safeNumber(modifier, 0);
  if (!mod) return base;
  return `${base}${mod > 0 ? "+" : ""}${mod}`;
}


function pickFirstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSignedNumber(value, fallback = 0) {
  const text = String(value ?? "").replace("−", "-").trim();
  const match = text.match(/[+-]?\d+/);
  return match ? safeNumber(match[0], fallback) : fallback;
}

function normalizeDamageType(value) {
  const text = displayText(value, "").toLowerCase();
  const dictionary = [
    "рубящий", "колющий", "дробящий", "огонь", "холод", "кислота", "яд", "молния", "электричество",
    "звук", "силовой", "некротический", "излучение", "психический", "гром", "slashing", "piercing",
    "bludgeoning", "fire", "cold", "acid", "poison", "lightning", "thunder", "force", "necrotic", "radiant", "psychic",
  ];
  return dictionary.find((item) => text.includes(item)) || displayText(value, "");
}

function parseAttackFromText(textValue = "", fallbackName = "Атака") {
  const text = stripHtml(textValue);
  const attackBonusMatch = text.match(/([+−-]\s*\d+)\s*(?:к\s*попаданию|попадани|to\s*hit|hit)/i)
    || text.match(/(?:атака|attack|бонус)[^+−-]{0,28}([+−-]\s*\d+)/i)
    || text.match(/([+−-]\s*\d+)/);
  const damageMatch = text.match(/(\d+d\d+(?:\s*[+−-]\s*\d+)?)/i);
  const name = text.split(/[:—–-]/)[0]?.trim();
  const afterDamage = damageMatch ? text.slice(damageMatch.index + damageMatch[0].length, damageMatch.index + damageMatch[0].length + 48) : "";
  return {
    name: clampText(name || fallbackName, 52),
    attack_bonus: attackBonusMatch ? parseSignedNumber(attackBonusMatch[1] || attackBonusMatch[0], 0) : 0,
    damage_dice: damageMatch ? damageMatch[1].replace(/\s+/g, "") : "",
    damage_type: normalizeDamageType(afterDamage),
    source_text: text,
  };
}

function normalizeAttackOption(raw, index = 0) {
  const item = raw && typeof raw === "object" ? raw : {};
  const text = typeof raw === "string" ? raw : displayText(item.text || item.description || item.desc || item.action_text || item.summary || item.value || item.name || item.title, "");
  const parsed = parseAttackFromText(text, `Атака ${index + 1}`);
  const name = displayText(pickFirstDefined(item.name, item.title, item.label, item.attack_name, parsed.name), parsed.name || `Атака ${index + 1}`);
  const attackBonus = safeNumber(pickFirstDefined(item.attack_bonus, item.to_hit, item.hit_bonus, item.bonus, parsed.attack_bonus), parsed.attack_bonus || 0);
  const damageDice = displayText(pickFirstDefined(item.damage_dice, item.damage_roll, item.damage, item.roll, parsed.damage_dice), parsed.damage_dice || "").replace(/\s+/g, "");
  const damageType = displayText(pickFirstDefined(item.damage_type, item.type, parsed.damage_type), parsed.damage_type || "");

  return {
    id: displayText(item.id || item.slug || name, `attack-${index}`),
    name: clampText(name, 54),
    attack_bonus: attackBonus,
    damage_dice: damageDice,
    damage_type: damageType,
    source_text: text || parsed.source_text || "",
  };
}

function isPlausibleAttackOption(item) {
  const name = displayText(item?.name, "");
  const text = `${name} ${displayText(item?.source_text, "")}`.toLowerCase();
  const dice = displayText(item?.damage_dice, "").replace(/\s+/g, "");
  if (!name || name === "[object Object]" || /\{\s*["']/.test(name) || name.length > 84) return false;
  if (dice && !/^\d+d\d+(?:[+−-]\d+)?$/i.test(dice)) return false;
  const mechanical = Boolean(dice) || Number(item?.attack_bonus) !== 0;
  const vocabulary = /(атака|оруж|меч|лук|арбалет|копь|кинжал|топор|булав|когт|укус|щупаль|удар|выстрел|attack|melee|ranged|weapon|claw|bite|slam|bow)/i.test(text);
  return mechanical || vocabulary;
}

function getEntryAttacks(entry) {
  const source = entry && typeof entry === "object" ? entry : {};
  const raw = [
    ...safeArray(source.attacks),
    ...safeArray(source.actions),
    ...safeArray(source.combat_profile?.attacks),
    ...safeArray(source.snapshot?.attacks),
    ...safeArray(source.snapshot?.actions),
    ...safeArray(source.bestiary_summary?.attacks),
    ...safeArray(source.bestiary_summary?.actions),
  ];
  const options = raw
    .map((item, index) => normalizeAttackOption(item, index))
    .filter(isPlausibleAttackOption);
  const seen = new Set();
  return options.filter((item) => {
    const key = `${item.name}|${item.attack_bonus}|${item.damage_dice}|${item.damage_type}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 16);
}

function inferActionResource(value, fallback = "action") {
  const text = displayText(value, "").toLowerCase();
  if (/бонус|bonus/.test(text)) return "bonus_action";
  if (/реакц|reaction/.test(text)) return "reaction";
  if (/свобод|free/.test(text)) return "free_action";
  if (/взаимодейств|предмет|object interaction/.test(text)) return "object_interaction";
  if (/движ|movement/.test(text)) return "movement";
  return fallback;
}

function getSpellSlotState(entry, level = 0) {
  const normalizedLevel = Math.max(0, safeNumber(level, 0));
  const slot = safeArray(entry?.spell_slots).find((item) => safeNumber(item?.level ?? item?.circle ?? item?.spell_level, -1) === normalizedLevel);
  if (!slot || normalizedLevel === 0) return { level: normalizedLevel, total: 0, used: 0, remaining: Infinity };
  const total = Math.max(0, safeNumber(slot.total ?? slot.max ?? slot.value, 0));
  const used = Math.max(0, safeNumber(slot.used ?? slot.filled ?? slot.spent, 0));
  return { level: normalizedLevel, total, used, remaining: Math.max(0, total - used) };
}


function normalizeAbilityKey(value, fallback = "dex") {
  const raw = displayText(value, "").toLowerCase().replace(/ё/g, "е");
  const aliases = [
    ["str", /^(?:str|strength|сила|сил)$/i],
    ["dex", /^(?:dex|dexterity|ловкость|ловк|лвк)$/i],
    ["con", /^(?:con|constitution|телосложение|телосл|вын)$/i],
    ["int", /^(?:int|intelligence|интеллект|инт)$/i],
    ["wis", /^(?:wis|wisdom|мудрость|мдр)$/i],
    ["cha", /^(?:cha|charisma|харизма|хар)$/i],
  ];
  const found = aliases.find(([, pattern]) => pattern.test(raw.trim()));
  if (found) return found[0];
  const embedded = aliases.find(([, pattern]) => pattern.test(raw.replace(/[^a-zа-я]/gi, "")));
  return embedded?.[0] || fallback;
}

function getAbilityLabel(key) {
  return ABILITY_OPTIONS.find(([ability]) => ability === normalizeAbilityKey(key, key))?.[1] || String(key || "характеристика").toUpperCase();
}

function getNumericSaveValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const match = value.replace("−", "-").match(/[+-]?\d+/);
    return match ? safeNumber(match[0], 0) : null;
  }
  if (!value || typeof value !== "object") return null;
  const direct = value.total ?? value.modifier ?? value.mod ?? value.bonus ?? value.value ?? value.check;
  if (direct !== undefined && direct !== null && direct !== "") return safeNumber(direct, 0);
  return null;
}

function getEntrySaveModifier(entry, abilityValue = "dex") {
  const ability = normalizeAbilityKey(abilityValue, "dex");
  const saveSources = [entry?.saves, entry?.combat_profile?.saves, entry?.snapshot?.saves, entry?.sheet?.saves];
  for (const source of saveSources) {
    if (!source || typeof source !== "object") continue;
    const record = source[ability] ?? source[{ str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" }[ability]];
    const explicit = getNumericSaveValue(record);
    if (explicit !== null) return explicit;
    if (record && typeof record === "object" && readBool(record.isProf ?? record.proficient ?? record.is_proficient, false)) {
      const score = safeNumber(entry?.abilities?.[ability], 10);
      return Math.floor((score - 10) / 2) + Math.max(0, safeNumber(entry?.proficiency_bonus, 0));
    }
  }
  const score = safeNumber(entry?.abilities?.[ability], 10);
  return Math.floor((score - 10) / 2);
}

function normalizeSaveSuccessResult(value, text = "") {
  const raw = displayText(value, "").toLowerCase();
  const combined = `${raw} ${displayText(text, "").toLowerCase()}`;
  if (/half|половин|половину|half damage|half as much/.test(combined)) return "half";
  if (/full|полный урон|same damage/.test(combined)) return "full";
  if (/none|no damage|без урона|не получает урон|никакого урона/.test(combined)) return "none";
  return "none";
}

function normalizeDamageTrait(value) {
  return displayText(value, "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/электричеств|lightning/g, "молния")
    .replace(/thunder/g, "гром")
    .replace(/fire/g, "огонь")
    .replace(/cold/g, "холод")
    .replace(/acid/g, "кислота")
    .replace(/poison/g, "яд")
    .replace(/necrotic/g, "некротический")
    .replace(/radiant/g, "излучение")
    .replace(/psychic/g, "психический")
    .replace(/force/g, "силовой")
    .replace(/slashing/g, "рубящий")
    .replace(/piercing/g, "колющий")
    .replace(/bludgeoning/g, "дробящий")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

function parseTraitList(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeDamageTrait(item?.name || item?.label || item)).filter(Boolean);
  if (value && typeof value === "object") return Object.entries(value).filter(([, enabled]) => Boolean(enabled)).map(([key]) => normalizeDamageTrait(key)).filter(Boolean);
  return displayText(value, "").split(/[,;/|]+/).map(normalizeDamageTrait).filter(Boolean);
}

function traitMatchesDamage(list, damageType) {
  const key = normalizeDamageTrait(damageType);
  if (!key) return false;
  return parseTraitList(list).some((item) => item === key || item.includes(key) || key.includes(item));
}

function applyDamageTraits(amountValue, damageType, traits = {}) {
  const original = Math.max(0, safeNumber(amountValue, 0));
  if (!original || !normalizeDamageTrait(damageType)) return { original, total: original, multiplier: 1, reason: "" };
  const immune = traitMatchesDamage(traits.immunities, damageType);
  const resistant = traitMatchesDamage(traits.resistances, damageType);
  const vulnerable = traitMatchesDamage(traits.vulnerabilities, damageType);
  if (immune) return { original, total: 0, multiplier: 0, reason: "иммунитет" };
  if (resistant && vulnerable) return { original, total: original, multiplier: 1, reason: "сопротивление и уязвимость взаимно отменились" };
  if (resistant) return { original, total: Math.floor(original / 2), multiplier: 0.5, reason: "сопротивление" };
  if (vulnerable) return { original, total: original * 2, multiplier: 2, reason: "уязвимость" };
  return { original, total: original, multiplier: 1, reason: "" };
}

function getEntryDamageTraits(entry = {}) {
  return {
    resistances: safeArray(entry.resistances || entry.combat_profile?.resistances || entry.snapshot?.resistances),
    immunities: safeArray(entry.immunities || entry.combat_profile?.immunities || entry.snapshot?.immunities),
    vulnerabilities: safeArray(entry.vulnerabilities || entry.combat_profile?.vulnerabilities || entry.snapshot?.vulnerabilities),
  };
}

function renderEntryMechanicalOptionData(entry = {}) {
  const traits = getEntryDamageTraits(entry);
  return [
    ["save-str", getEntrySaveModifier(entry, "str")],
    ["save-dex", getEntrySaveModifier(entry, "dex")],
    ["save-con", getEntrySaveModifier(entry, "con")],
    ["save-int", getEntrySaveModifier(entry, "int")],
    ["save-wis", getEntrySaveModifier(entry, "wis")],
    ["save-cha", getEntrySaveModifier(entry, "cha")],
    ["resistances", JSON.stringify(traits.resistances)],
    ["immunities", JSON.stringify(traits.immunities)],
    ["vulnerabilities", JSON.stringify(traits.vulnerabilities)],
    ["concentrating", entry?.concentration ? "1" : "0"],
  ].map(([key, value]) => `data-${key}="${escapeHtml(String(value))}"`).join(" ");
}

function isOpaqueSpellIdentifier(value) {
  const raw = String(value || "").trim();
  return /^[a-f0-9]{20,}$/i.test(raw) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(raw);
}


function normalizeSpellAreaShape(value, text = "") {
  const raw = `${displayText(value, "")} ${displayText(text, "")}`.toLowerCase().replace(/ё/g, "е");
  if (/конус|cone/.test(raw)) return "cone";
  if (/линия|line/.test(raw)) return "line";
  if (/куб|cube/.test(raw)) return "cube";
  if (/сфера|радиус|radius|sphere|круг|circle|цилиндр|cylinder/.test(raw)) return "radius";
  return "single";
}

function inferSpellAreaSize(value, text = "") {
  const explicit = safeNumber(value, 0);
  if (explicit > 0) return explicit;
  const raw = `${displayText(text, "")}`.replace(/ё/g, "е");
  const patterns = [
    /(?:радиус(?:ом)?|radius)\s*(\d+)\s*(?:фт|фут|feet|foot)?/i,
    /(\d+)\s*(?:-?футов(?:ый|ая|ое)?|-?foot|-?feet)\s*(?:радиус|radius|сфера|sphere|конус|cone|линия|line|куб|cube)/i,
    /(?:сфера|sphere|конус|cone|линия|line|куб|cube)[^\d]{0,18}(\d+)\s*(?:фт|фут|feet|foot)/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) return Math.max(0, safeNumber(match[1], 0));
  }
  return 0;
}

function normalizeSpellTargeting(item = {}, description = "") {
  const raw = `${displayText(item.target_type || item.targeting || item.targets || item.area, "")} ${description}`.toLowerCase();
  const shape = normalizeSpellAreaShape(item.area_shape || item.shape || item.area, raw);
  const areaSize = inferSpellAreaSize(item.area_size || item.radius || item.size_ft || item.area_feet, raw);
  const maxTargets = Math.max(1, safeNumber(item.max_targets || item.target_count || item.targets_count, shape === "single" ? 1 : 99));
  const affects = /союз|ally|friendly/.test(raw) && !/враг|enemy|hostile/.test(raw)
    ? "allies"
    : /враг|enemy|hostile/.test(raw) && !/союз|ally|friendly/.test(raw)
      ? "enemies"
      : "any";
  return {
    shape,
    area_size: areaSize,
    max_targets: maxTargets,
    affects,
    is_area: shape !== "single" || maxTargets > 1,
  };
}

function getEntryTeam(entry = {}) {
  const kind = String(entry.entity_kind || entry.entry_type || entry.kind || "").toLowerCase();
  if (["enemy", "monster", "npc", "hostile"].includes(kind)) return "enemy";
  return "ally";
}

function renderSpellMultiTargetSelector(entries = [], current = null, target = null, spell = {}) {
  const currentId = String(current?.entry_id || "");
  const targetId = String(target?.entry_id || "");
  const living = safeArray(entries).filter((entry) => entry && String(entry.entry_id || "") !== currentId && !isDeadEnemy(entry));
  if (!living.length) return `<div class="combat-ref-target-picker-empty">Нет доступных целей.</div>`;
  return `
    <div class="combat-ref-spell-targeting" data-combat-spell-targeting>
      <div class="combat-ref-spell-targeting-head">
        <div><strong>Цели и область</strong><small>Выбери одну или несколько целей. Ресурс и ячейка тратятся один раз.</small></div>
        <div class="combat-ref-target-tools">
          <button type="button" data-combat-action="multi-target-team" data-combat-target-team="enemy">Враги</button>
          <button type="button" data-combat-action="multi-target-team" data-combat-target-team="ally">Союзники</button>
          <button type="button" data-combat-action="multi-target-clear">Сбросить</button>
        </div>
      </div>
      <div class="combat-ref-roll-inline combat-ref-area-controls">
        <label><span>Форма</span><select data-combat-roll-field="spell_area_shape">
          <option value="single" ${spell.area_shape === "single" ? "selected" : ""}>одна цель</option>
          <option value="radius" ${spell.area_shape === "radius" ? "selected" : ""}>радиус / сфера</option>
          <option value="cone" ${spell.area_shape === "cone" ? "selected" : ""}>конус</option>
          <option value="line" ${spell.area_shape === "line" ? "selected" : ""}>линия</option>
          <option value="cube" ${spell.area_shape === "cube" ? "selected" : ""}>куб</option>
        </select></label>
        <label><span>Размер, фт.</span><input type="number" min="0" step="5" value="${escapeHtml(String(spell.area_size || 0))}" data-combat-roll-field="spell_area_size"></label>
        <label><span>Макс. целей</span><input type="number" min="1" max="99" value="${escapeHtml(String(spell.max_targets || 1))}" data-combat-roll-field="spell_max_targets"></label>
      </div>
      <div class="combat-ref-multi-target-list" data-combat-multi-target-list>
        ${living.map((entry) => {
          const checked = String(entry.entry_id) === targetId;
          const traits = getEntryDamageTraits(entry);
          return `<label class="combat-ref-multi-target ${checked ? "is-selected" : ""}" data-combat-multi-target-row data-target-team="${escapeHtml(getEntryTeam(entry))}">
            <input type="checkbox" value="${escapeHtml(entry.entry_id)}" data-combat-multi-target-checkbox ${checked ? "checked" : ""}
              data-target-name="${escapeHtml(entry.name || "Цель")}" data-target-ac="${escapeHtml(String(entry.ac || 0))}"
              data-target-save-str="${escapeHtml(String(getEntrySaveModifier(entry, "str")))}" data-target-save-dex="${escapeHtml(String(getEntrySaveModifier(entry, "dex")))}"
              data-target-save-con="${escapeHtml(String(getEntrySaveModifier(entry, "con")))}" data-target-save-int="${escapeHtml(String(getEntrySaveModifier(entry, "int")))}"
              data-target-save-wis="${escapeHtml(String(getEntrySaveModifier(entry, "wis")))}" data-target-save-cha="${escapeHtml(String(getEntrySaveModifier(entry, "cha")))}"
              data-target-resistances="${escapeHtml(JSON.stringify(traits.resistances))}" data-target-immunities="${escapeHtml(JSON.stringify(traits.immunities))}"
              data-target-vulnerabilities="${escapeHtml(JSON.stringify(traits.vulnerabilities))}" data-target-concentrating="${entry.concentration ? "1" : "0"}">
            <span>${renderPortrait(entry, "combat-ref-multi-target-avatar")}</span>
            <strong>${escapeHtml(entry.name || "Цель")}</strong>
            <small>КД ${escapeHtml(String(entry.ac || 0))} • ${escapeHtml(String(entry.hp_current || 0))}/${escapeHtml(String(entry.hp_max || 0))} HP</small>
          </label>`;
        }).join("")}
      </div>
      <div class="combat-ref-target-count" data-combat-target-count>Выбрано: ${targetId ? 1 : 0}</div>
    </div>`;
}

function normalizeSpellOption(raw, index = 0, entry = null) {
  const item = raw && typeof raw === "object" ? raw : { name: raw };
  const description = displayText(item.description || item.text || item.desc || item.effect, "");
  const resolvedName = displayText(item.name || item.title || item.ru_name || item.label || item.resolved_name || item.catalog_name, "");
  const name = isOpaqueSpellIdentifier(resolvedName) ? "" : (resolvedName || `Заклинание ${index + 1}`);
  const level = Math.max(0, safeNumber(item.level ?? item.circle ?? item.spell_level, 0));
  const activation = displayText(item.action_type || item.activation || item.casting_time || item.time || item.cast_time, "Действие");
  const resource = inferActionResource(activation, "action");
  const damageText = displayText(item.damage || item.damage_dice || item.dice || item.effect, "");
  const parsed = parseAttackFromText(`${name}: ${damageText} ${description}`, name);
  const saveText = displayText(item.save || item.saving_throw || item.save_ability, "");
  const explicitMode = displayText(item.mode || item.spell_mode, "").toLowerCase();
  const mode = explicitMode || (Boolean(item.attack || item.spell_attack || item.requires_attack_roll) ? "attack" : saveText ? "save" : "effect");
  const spellcasting = entry?.spellcasting && typeof entry.spellcasting === "object" ? entry.spellcasting : {};
  const attackBonus = safeNumber(item.attack_bonus ?? item.spell_attack_bonus ?? spellcasting.attack_bonus ?? spellcasting.spell_attack ?? spellcasting.attack, 0);
  const saveDc = Math.max(0, safeNumber(item.save_dc ?? item.dc ?? spellcasting.save_dc ?? spellcasting.spell_save_dc ?? spellcasting.dc, 0));
  const slot = getSpellSlotState(entry, level);
  const targeting = normalizeSpellTargeting(item, `${description} ${damageText}`);
  return {
    id: displayText(item.id || item.spell_id || item.slug || item.key, `spell-${index}`),
    name: clampText(name, 72),
    level,
    school: displayText(item.school, ""),
    activation,
    resource,
    mode: ["attack", "save", "effect"].includes(mode) ? mode : "effect",
    range: displayText(item.range || item.distance, ""),
    duration: displayText(item.duration, ""),
    concentration: Boolean(item.concentration),
    ritual: Boolean(item.ritual),
    prepared: item.prepared === undefined ? true : Boolean(item.prepared),
    damage_dice: displayText(item.damage_dice || item.damage || parsed.damage_dice, "").replace(/\s+/g, ""),
    damage_type: displayText(item.damage_type || parsed.damage_type, ""),
    effect: clampText(description || damageText, 220),
    save_ability: normalizeAbilityKey(saveText || item.save_stat || item.ability, "dex"),
    save_success: normalizeSaveSuccessResult(item.save_success || item.on_save || item.success_result || (item.half_on_save ? "half" : ""), `${description} ${damageText}`),
    attack_bonus: attackBonus,
    save_dc: saveDc,
    source_kind: displayText(item.source_kind || item.source, entry?.source_kind || "lss"),
    area_shape: targeting.shape,
    area_size: targeting.area_size,
    max_targets: targeting.max_targets,
    affects: targeting.affects,
    is_area: targeting.is_area,
    slot,
  };
}

function getEntrySpells(entry) {
  const source = entry && typeof entry === "object" ? entry : {};
  const raw = [
    ...safeArray(source.spells),
    ...safeArray(source.combat_profile?.spells),
    ...safeArray(source.combat_profile?.spellbook),
    ...safeArray(source.sheet?.spellsList),
    ...safeArray(source.sheet?.spellCards),
    ...safeArray(source.snapshot?.spells),
  ];
  const seen = new Set();
  return raw.map((item, index) => normalizeSpellOption(item, index, source)).filter((spell) => {
    const key = `${spell.id}|${spell.name}|${spell.level}`.toLowerCase();
    if (!spell.name || isOpaqueSpellIdentifier(spell.name) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, "ru"));
}

function normalizeFeatureOption(raw, index = 0) {
  const item = raw && typeof raw === "object" ? raw : { name: raw };
  const name = displayText(item.name || item.title || item.label, `Особенность ${index + 1}`);
  const description = displayText(item.description || item.text || item.details || item.desc, "");
  const activation = displayText(item.action_type || item.activation || item.casting_time || item.resource, "");
  return {
    id: displayText(item.id || item.key || item.slug, `feature-${index}`),
    name: clampText(name, 64),
    description: clampText(description, 180),
    activation,
    resource: inferActionResource(`${activation} ${description}`, "free_action"),
  };
}

function getEntryFeatures(entry) {
  const raw = [
    ...safeArray(entry?.features),
    ...safeArray(entry?.snapshot?.features),
    ...safeArray(entry?.bestiary_summary?.features),
  ];
  const seen = new Set();
  return raw.map(normalizeFeatureOption).filter((feature) => {
    const key = `${feature.name}|${feature.resource}`.toLowerCase();
    if (!feature.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 18);
}

function hasEntryFeature(entry, pattern) {
  return getEntryFeatures(entry).some((feature) => pattern.test(`${feature.name} ${feature.description}`));
}

function renderSpellPresetSelect(current) {
  const spells = getEntrySpells(current);
  if (!spells.length) {
    return `<label><span>Заклинание из LSS</span><select data-combat-roll-field="spell_preset"><option value="">В LSS нет доступных заклинаний — ручной ввод</option></select></label>`;
  }
  return `
    <label>
      <span>Заклинание из LSS</span>
      <select data-combat-roll-field="spell_preset">
        ${spells.map((spell, index) => {
          const levelLabel = spell.level ? `${spell.level} круг` : "заговор";
          const slotLabel = spell.level && Number.isFinite(spell.slot.remaining) ? ` • ячеек ${spell.slot.remaining}/${spell.slot.total}` : "";
          return `
            <option
              value="${escapeHtml(String(index))}"
              data-spell-id="${escapeHtml(spell.id)}"
              data-spell-name="${escapeHtml(spell.name)}"
              data-spell-level="${escapeHtml(String(spell.level))}"
              data-spell-resource="${escapeHtml(spell.resource)}"
              data-spell-mode="${escapeHtml(spell.mode)}"
              data-spell-range="${escapeHtml(spell.range)}"
              data-spell-duration="${escapeHtml(spell.duration)}"
              data-spell-effect="${escapeHtml(spell.effect)}"
              data-spell-damage-dice="${escapeHtml(spell.damage_dice)}"
              data-spell-damage-type="${escapeHtml(spell.damage_type)}"
              data-spell-attack-bonus="${escapeHtml(String(spell.attack_bonus || 0))}"
              data-spell-save-dc="${escapeHtml(String(spell.save_dc || 0))}"
              data-spell-save-ability="${escapeHtml(spell.save_ability || "dex")}"
              data-spell-save-result="${escapeHtml(spell.save_success || "none")}"
              data-spell-concentration="${spell.concentration ? "1" : "0"}"
              data-spell-activation="${escapeHtml(spell.activation)}"
              data-spell-slot-remaining="${escapeHtml(String(spell.slot.remaining))}"
              data-spell-area-shape="${escapeHtml(spell.area_shape || "single")}"
              data-spell-area-size="${escapeHtml(String(spell.area_size || 0))}"
              data-spell-max-targets="${escapeHtml(String(spell.max_targets || 1))}"
              data-spell-affects="${escapeHtml(spell.affects || "any")}"
              ${index === 0 ? "selected" : ""}
            >${escapeHtml(spell.name)} • ${escapeHtml(levelLabel)} • ${escapeHtml(getTurnResourceMeta(spell.resource).short)}${escapeHtml(slotLabel)}${spell.prepared ? " • подготовлено" : ""}</option>
          `;
        }).join("")}
      </select>
    </label>
  `;
}

function renderAttackPresetSelect(current) {
  const attacks = getEntryAttacks(current);
  if (!attacks.length) {
    return `<label><span>Атака из источника</span><select data-combat-roll-field="attack_preset"><option value="">ручной ввод</option></select></label>`;
  }
  return `
    <label>
      <span>Атака из источника</span>
      <select data-combat-roll-field="attack_preset">
        <option value="">ручной ввод</option>
        ${attacks.map((attack, index) => `
          <option
            value="${escapeHtml(String(index))}"
            data-attack-id="${escapeHtml(attack.id)}"
            data-attack-name="${escapeHtml(attack.name)}"
            data-attack-bonus="${escapeHtml(String(attack.attack_bonus || 0))}"
            data-damage-dice="${escapeHtml(attack.damage_dice || "")}"
            data-damage-type="${escapeHtml(attack.damage_type || "")}"
            title="${escapeHtml(clampText(attack.source_text || attack.name, 180))}"
            ${index === 0 ? "selected" : ""}
          >${escapeHtml(attack.name)}${attack.attack_bonus ? ` • ${attack.attack_bonus > 0 ? "+" : ""}${escapeHtml(String(attack.attack_bonus))}` : ""}${attack.damage_dice ? ` • ${escapeHtml(attack.damage_dice)}` : ""}</option>
        `).join("")}
      </select>
    </label>
  `;
}

function renderActionModePanel(mode, current, target, entries = []) {
  const actorName = current?.name || "участник";
  const targetName = target?.name || "цель";
  const targetAc = safeNumber(target?.ac, 0);
  const modeCopy = ACTION_MODE_COPY[mode] || ACTION_MODE_COPY.roll;

  const panelHeader = `
    <div class="combat-ref-action-mode-head">
      <strong>${escapeHtml(modeCopy.title)}</strong>
      <small>${escapeHtml(modeCopy.hint)}</small>
    </div>
  `;

  if (mode === "attack") {
    const defaultAttack = getEntryAttacks(current)[0] || {};
    return `
      <div class="combat-ref-action-mode" data-combat-action-mode="attack">
        ${panelHeader}
        ${renderAttackPresetSelect(current)}
        <div class="combat-ref-roll-inline">
          <label><span>Приём/оружие</span><input type="text" value="${escapeHtml(defaultAttack.name || "")}" placeholder="Длинный меч / когти / арбалет" data-combat-roll-field="attack_name"></label>
          <label><span>Бонус атаки</span><input type="number" value="${escapeHtml(String(defaultAttack.attack_bonus ?? 0))}" data-combat-roll-field="attack_bonus"></label>
        </div>
        <div class="combat-ref-roll-inline">
          <label><span>Кость урона</span><input type="text" value="${escapeHtml(defaultAttack.damage_dice || "1d8")}" data-combat-roll-field="damage_dice"></label>
          <label><span>Тип урона</span><input type="text" value="${escapeHtml(defaultAttack.damage_type || "")}" placeholder="рубящий / огонь" data-combat-roll-field="damage_type"></label>
        </div>
        <p class="combat-ref-action-mode-note">${escapeHtml(actorName)} атакует ${escapeHtml(targetName)}. Проверка попадания: d20 + бонус атаки${targetAc ? ` против КД ${targetAc}` : " против КД цели"}. Нат. 20 = крит, нат. 1 = промах.</p>
      </div>
    `;
  }

  if (mode === "spell") {
    const defaultSpell = getEntrySpells(current)[0] || {};
    const spellcasting = current?.spellcasting && typeof current.spellcasting === "object" ? current.spellcasting : {};
    return `
      <div class="combat-ref-action-mode" data-combat-action-mode="spell" hidden>
        ${panelHeader}
        ${renderSpellPresetSelect(current)}
        <input type="hidden" value="${escapeHtml(defaultSpell.id || "")}" data-combat-roll-field="spell_id">
        <input type="hidden" value="${escapeHtml(defaultSpell.resource || "action")}" data-combat-roll-field="spell_resource">
        <input type="hidden" value="${escapeHtml(defaultSpell.range || "")}" data-combat-roll-field="spell_range">
        <input type="hidden" value="${escapeHtml(defaultSpell.duration || "")}" data-combat-roll-field="spell_duration">
        <input type="hidden" value="${escapeHtml(defaultSpell.activation || "")}" data-combat-roll-field="spell_activation">
        <input type="hidden" value="${defaultSpell.concentration ? "1" : "0"}" data-combat-roll-field="spell_concentration">
        <div class="combat-ref-roll-inline">
          <label><span>Название</span><input type="text" value="${escapeHtml(defaultSpell.name || "")}" placeholder="Выбери заклинание из LSS" data-combat-roll-field="spell_name"></label>
          <label><span>Круг</span><input type="number" min="0" max="9" value="${escapeHtml(String(defaultSpell.level ?? 0))}" data-combat-roll-field="spell_level"></label>
        </div>
        <div class="combat-ref-roll-inline">
          <label><span>Режим</span><select data-combat-roll-field="spell_mode"><option value="attack" ${defaultSpell.mode === "attack" ? "selected" : ""}>атака заклинанием</option><option value="save" ${defaultSpell.mode === "save" ? "selected" : ""}>спасбросок цели</option><option value="effect" ${!defaultSpell.mode || defaultSpell.mode === "effect" ? "selected" : ""}>эффект без броска</option></select></label>
          <label><span>Бонус атаки</span><input type="number" value="${escapeHtml(String(defaultSpell.attack_bonus ?? spellcasting.attack_bonus ?? 0))}" data-combat-roll-field="spell_attack_bonus"></label>
          <label><span>Сл / DC</span><input type="number" min="0" value="${escapeHtml(String(defaultSpell.save_dc ?? spellcasting.save_dc ?? 0))}" data-combat-roll-field="save_dc"></label>
        </div>
        <div class="combat-ref-roll-inline">
          <label><span>Спасбросок цели</span><select data-combat-roll-field="spell_save_ability">${renderAbilityOptions(defaultSpell.save_ability || "dex")}</select></label>
          <label><span>При успехе</span><select data-combat-roll-field="spell_save_result"><option value="none" ${defaultSpell.save_success !== "half" && defaultSpell.save_success !== "full" ? "selected" : ""}>без урона</option><option value="half" ${defaultSpell.save_success === "half" ? "selected" : ""}>половина урона</option><option value="full" ${defaultSpell.save_success === "full" ? "selected" : ""}>полный урон</option></select></label>
          <label><span>Режим броска цели</span><select data-combat-roll-field="save_roll_mode"><option value="normal">обычный</option><option value="advantage">с преимуществом</option><option value="disadvantage">с помехой</option></select></label>
        </div>
        <div class="combat-ref-roll-inline">
          <label><span>Кость урона</span><input type="text" value="${escapeHtml(defaultSpell.damage_dice || "")}" placeholder="например 8d6" data-combat-roll-field="damage_dice"></label>
          <label><span>Тип урона</span><input type="text" value="${escapeHtml(defaultSpell.damage_type || "")}" placeholder="огонь / холод" data-combat-roll-field="damage_type"></label>
        </div>
        ${renderSpellMultiTargetSelector(entries, current, target, defaultSpell)}
        <label><span>Эффект</span><input type="text" value="${escapeHtml(defaultSpell.effect || "")}" placeholder="описание эффекта, область, состояние" data-combat-roll-field="spell_effect"></label>
        <div class="combat-ref-spell-meta" data-combat-spell-meta>${defaultSpell.name ? `${escapeHtml(defaultSpell.activation || "Действие")} • ${escapeHtml(defaultSpell.range || "дальность не указана")}${defaultSpell.concentration ? " • концентрация" : ""}` : "Выбери заклинание: время, ресурс, дальность и параметры подставятся из LSS."}</div>
      </div>
    `;
  }

  if (mode === "movement") {
    return `
      <div class="combat-ref-action-mode" data-combat-action-mode="movement" hidden>
        ${panelHeader}
        <div class="combat-ref-roll-inline">
          <label><span>Дистанция, фт.</span><input type="number" min="0" value="0" data-combat-roll-field="movement_cost"></label>
          <label><span>Тип движения</span><input type="text" value="" placeholder="шаг / рывок / полёт / лазание" data-combat-roll-field="movement_type"></label>
        </div>
        <p class="combat-ref-action-mode-note">Сейчас движение пишется в журнал и отправляет resource=movement. Позже это свяжется с мини-картой, высотой, укрытиями и видимостью.</p>
      </div>
    `;
  }

  if (mode === "save") {
    return `
      <div class="combat-ref-action-mode" data-combat-action-mode="save" hidden>
        ${panelHeader}
        <div class="combat-ref-roll-inline">
          <label><span>Характеристика</span><select data-combat-roll-field="ability">${renderAbilityOptions("dex")}</select></label>
          <label><span>Сл</span><input type="number" min="0" value="0" data-combat-roll-field="save_dc"></label>
        </div>
      </div>
    `;
  }

  if (mode === "check") {
    return `
      <div class="combat-ref-action-mode" data-combat-action-mode="check" hidden>
        ${panelHeader}
        <div class="combat-ref-roll-inline">
          <label><span>Характеристика</span><select data-combat-roll-field="ability">${renderAbilityOptions("str")}</select></label>
          <label><span>Навык</span><input type="text" value="" placeholder="Атлетика / Скрытность" data-combat-roll-field="skill_name"></label>
        </div>
      </div>
    `;
  }

  if (mode === "damage" || mode === "heal") {
    return `
      <div class="combat-ref-action-mode" data-combat-action-mode="${escapeHtml(mode)}" hidden>
        ${panelHeader}
        <p class="combat-ref-action-mode-note">Число в поле “Урон/леч.” будет применено к выбранной цели. Куб нужен для записи броска в журнал.</p>
      </div>
    `;
  }

  if (mode === "effect") {
    return `
      <div class="combat-ref-action-mode" data-combat-action-mode="effect" hidden>
        ${panelHeader}
        <div class="combat-ref-roll-inline">
          <label><span>Состояние</span><input type="text" value="" placeholder="Горение / Ослеплён / Баф" data-combat-roll-field="effect_name"></label>
          <label><span>Длительность</span><input type="text" value="" placeholder="1 раунд / сцена" data-combat-roll-field="duration"></label>
        </div>
      </div>
    `;
  }

  if (mode === "note") {
    return `
      <div class="combat-ref-action-mode" data-combat-action-mode="note" hidden>
        ${panelHeader}
        <p class="combat-ref-action-mode-note">Заметка отправляется в журнал без расхода действия. Используй для решений GM, описаний и ручных уточнений боя.</p>
      </div>
    `;
  }

  return `
    <div class="combat-ref-action-mode" data-combat-action-mode="roll" hidden>
      ${panelHeader}
    </div>
  `;
}

function renderActionModePanels(current, target, entries = []) {
  return ["attack", "spell", "damage", "heal", "movement", "save", "check", "effect", "note", "roll"].map((mode) => renderActionModePanel(mode, current, target, entries)).join("");
}


function getResourceUiMeta(resources, key) {
  const ready = key === "none" ? true : getResourceAvailability(resources, key);
  const movementRemaining = safeNumber(resources?.movement_remaining, 0);
  const movementTotal = safeNumber(resources?.movement_total, 0);
  const map = {
    action: {
      icon: ready ? "●" : "✓",
      label: "Действие",
      value: ready ? "доступно" : "потрачено",
      state: ready ? "ready" : "spent",
    },
    bonus_action: {
      icon: ready ? "◆" : "✓",
      label: "Бонус",
      value: ready ? "доступен" : "потрачен",
      state: ready ? "ready" : "spent",
    },
    movement: {
      icon: movementRemaining > 0 ? "⇢" : "✓",
      label: "Движение",
      value: `${movementRemaining}/${movementTotal} фт.`,
      state: movementRemaining > 0 ? "ready" : "spent",
    },
    reaction: {
      icon: ready ? "↶" : "✓",
      label: "Реакция",
      value: ready ? "доступна" : "потрачена",
      state: ready ? "ready" : "spent",
    },
    free_action: {
      icon: ready ? "◇" : "✓",
      label: "Свободное",
      value: ready ? "доступно" : "потрачено",
      state: ready ? "ready" : "spent",
    },
    object_interaction: {
      icon: ready ? "○" : "✓",
      label: "Предмет",
      value: ready ? "доступно" : "потрачено",
      state: ready ? "ready" : "spent",
    },
    none: {
      icon: "GM",
      label: "GM",
      value: "не тратит ресурс",
      state: "gm",
    },
  };
  return { ...(map[key] || map.action), ready };
}


function renderActionChoice(options = {}, resources = {}) {
  const mode = options.mode || options.key || "effect";
  const eventType = options.eventType || getActionPreset(mode).eventType || "effect";
  const resource = options.resource || getActionResource(mode) || "none";
  const ready = resource === "none" ? true : getResourceAvailability(resources, resource);
  const disabled = Boolean(options.disabled || !ready);
  const detail = options.detail || "";
  const label = options.label || getActionPreset(mode).label || "Действие";
  return `
    <button
      type="button"
      class="combat-ref-action-choice ${options.kind ? `is-${escapeHtml(options.kind)}` : ""}"
      data-combat-action="action-template"
      data-combat-template-action="${escapeHtml(mode)}"
      data-combat-template-event="${escapeHtml(eventType)}"
      data-combat-template-resource="${escapeHtml(resource)}"
      data-combat-template-label="${escapeHtml(label)}"
      data-combat-template-dice="${escapeHtml(options.dice ?? getActionPreset(mode).dice ?? "d20")}"
      data-combat-template-reason="${escapeHtml(options.reason || label || getActionPreset(mode).reason || "Действие")}"
      ${options.spellResource ? `data-combat-template-spell-resource="${escapeHtml(options.spellResource)}"` : ""}
      ${options.spellId ? `data-combat-template-spell-id="${escapeHtml(options.spellId)}"` : ""}
      ${options.attackId ? `data-combat-template-attack-id="${escapeHtml(options.attackId)}"` : ""}
      ${options.attackName ? `data-combat-template-attack-name="${escapeHtml(options.attackName)}"` : ""}
      ${options.attackBonus !== undefined ? `data-combat-template-attack-bonus="${escapeHtml(String(options.attackBonus))}"` : ""}
      ${options.damageDice ? `data-combat-template-damage-dice="${escapeHtml(options.damageDice)}"` : ""}
      ${options.damageType ? `data-combat-template-damage-type="${escapeHtml(options.damageType)}"` : ""}
      ${options.effectName ? `data-combat-template-effect-name="${escapeHtml(options.effectName)}"` : ""}
      ${options.movementType ? `data-combat-template-movement-type="${escapeHtml(options.movementType)}"` : ""}
      ${disabled ? "disabled" : ""}
      title="${escapeHtml(options.hint || (ready ? "Выбрать действие" : "Ресурс уже потрачен"))}"
    >
      <span aria-hidden="true">${escapeHtml(options.icon || getActionPreset(mode).icon || "◇")}</span>
      <strong>${escapeHtml(label)}</strong>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : `<small>${ready ? "доступно" : "недоступно"}</small>`}
    </button>
  `;
}

function formatSignedValue(value = 0) {
  const number = safeNumber(value, 0);
  return number >= 0 ? `+${number}` : String(number);
}

function renderActionSubhead(title, meta = "") {
  return `<div class="combat-ref-action-subhead"><strong>${escapeHtml(title)}</strong>${meta ? `<small>${escapeHtml(meta)}</small>` : ""}</div>`;
}

function renderAttackChoices(current, resource, resources) {
  const attacks = getEntryAttacks(current).slice(0, 8);
  if (!attacks.length) {
    return renderActionChoice({
      mode: "attack",
      resource,
      label: "Ручная атака",
      icon: "⚔",
      detail: "параметры вводятся в карточке",
      reason: "Атака",
      kind: "attack",
    }, resources);
  }
  return attacks.map((attack) => {
    const parts = [
      `${formatSignedValue(attack.attack_bonus)} к попаданию`,
      attack.damage_dice ? `${attack.damage_dice}${attack.damage_type ? ` ${attack.damage_type}` : ""}` : "урон не указан",
    ];
    return renderActionChoice({
      mode: "attack",
      resource,
      label: attack.name,
      icon: "⚔",
      detail: parts.join(" • "),
      reason: attack.name,
      attackId: attack.id,
      attackName: attack.name,
      attackBonus: attack.attack_bonus,
      damageDice: attack.damage_dice,
      damageType: attack.damage_type,
      hint: `${attack.name}: ${parts.join("; ")}`,
      kind: "attack",
    }, resources);
  }).join("");
}

function renderSpellChoices(current, resource, resources) {
  const spells = getEntrySpells(current).filter((spell) => spell.resource === resource).slice(0, 10);
  if (!spells.length) return "";
  return spells.map((spell) => {
    const slot = spell.level > 0 && Number.isFinite(spell.slot?.remaining)
      ? ` • ячеек ${spell.slot.remaining}/${spell.slot.total}`
      : "";
    const level = spell.level > 0 ? `${spell.level} круг` : "заговор";
    const mechanic = spell.mode === "attack"
      ? `${formatSignedValue(spell.attack_bonus)} атака`
      : spell.mode === "save"
        ? `Сл ${spell.save_dc || "?"}${spell.save_ability ? ` ${spell.save_ability}` : ""}`
        : "эффект";
    return renderActionChoice({
      mode: "spell",
      eventType: "spell",
      resource,
      spellResource: resource,
      spellId: spell.id,
      label: spell.name,
      icon: spell.level > 0 ? "✦" : "✧",
      detail: `${level} • ${mechanic}${slot}`,
      reason: spell.name,
      disabled: spell.level > 0 && Number.isFinite(spell.slot?.remaining) && spell.slot.remaining <= 0,
      hint: [spell.activation, spell.range, spell.effect].filter(Boolean).join(" • ") || spell.name,
      kind: "spell",
    }, resources);
  }).join("");
}


function renderFeatureChoices(current, resource, resources) {
  return getEntryFeatures(current)
    .filter((feature) => feature.resource === resource)
    .slice(0, 5)
    .map((feature) => renderActionChoice({
      mode: "effect",
      eventType: "effect",
      resource,
      icon: "✦",
      label: feature.name,
      detail: clampText(feature.description || feature.activation, 54),
      reason: feature.name,
      effectName: feature.name,
      hint: feature.description || feature.activation || feature.name,
    }, resources)).join("");
}


function renderResourceActionGroup(current, resource, canManage, resources) {
  const spells = getEntrySpells(current).filter((spell) => spell.resource === resource);
  const features = renderFeatureChoices(current, resource, resources);
  const attacks = getEntryAttacks(current);
  const nimbleEscape = hasEntryFeature(current, /(проворн\w*\s+побег|nimble\s+escape)/i);
  let body = "";

  if (resource === "action") {
    body = [
      renderActionSubhead("Атаки", attacks.length ? `${attacks.length} из боевого профиля` : "ручной режим"),
      renderAttackChoices(current, resource, resources),
      renderActionSubhead("Заклинания", spells.length ? `${spells.length} доступно` : "нет в профиле"),
      spells.length
        ? renderSpellChoices(current, resource, resources)
        : `<div class="combat-ref-resource-empty is-compact"><strong>Нет заклинаний-действий</strong><span>Синхронизируй LSS или проверь подготовленные заклинания персонажа.</span></div>`,
      renderActionSubhead("Стандартные действия"),
      renderActionChoice({
        mode: "check",
        resource,
        label: "Проверка",
        icon: "◇",
        detail: "навык / характеристика",
      }, resources),
      renderActionChoice({
        mode: "movement",
        eventType: "move",
        resource,
        label: "Рывок",
        icon: "⇢",
        detail: "+ базовая скорость",
        reason: "Рывок действием",
        movementType: "Рывок",
      }, resources),
      renderActionChoice({
        mode: "effect",
        eventType: "effect",
        resource,
        label: "Отступление",
        icon: "↝",
        detail: "не провоцирует атаку",
        reason: "Отступление действием",
        effectName: "Отступление",
      }, resources),
      renderActionChoice({
        mode: "effect",
        eventType: "effect",
        resource,
        label: "Уклонение",
        icon: "◈",
        detail: "защитный эффект",
        reason: "Уклонение",
        effectName: "Уклонение",
      }, resources),
      features ? renderActionSubhead("Особенности") : "",
      features,
    ].join("");
  } else if (resource === "bonus_action") {
    body = [
      spells.length ? renderActionSubhead("Бонусные заклинания", `${spells.length} доступно`) : "",
      renderSpellChoices(current, resource, resources),
      nimbleEscape ? renderActionSubhead("Особенности") : "",
      nimbleEscape
        ? renderActionChoice({
            mode: "effect",
            eventType: "effect",
            resource,
            label: "Отступление",
            icon: "↝",
            detail: "Проворный побег",
            reason: "Проворный побег: Отступление",
            effectName: "Отступление",
          }, resources)
        : "",
      nimbleEscape
        ? renderActionChoice({
            mode: "check",
            eventType: "check",
            resource,
            label: "Скрыться",
            icon: "◌",
            detail: "Проворный побег",
            reason: "Проворный побег: Скрыться",
          }, resources)
        : "",
      features,
    ].join("");
  } else if (resource === "movement") {
    const movementRemaining = safeNumber(resources.movement_remaining, 0);
    body = `
      <div class="combat-ref-movement-bridge">
        <div>
          <strong>${escapeHtml(String(movementRemaining))} фт. движения осталось</strong>
          <span>Маршрут, сетка, коллизии, высота и подтверждение находятся в панели «Движение хода».</span>
        </div>
        <button type="button" class="btn" data-combat-action="focus-movement">Открыть движение</button>
      </div>
    `;
  } else if (resource === "reaction") {
    body = [
      spells.length ? renderActionSubhead("Заклинания-реакции", `${spells.length} доступно`) : "",
      renderSpellChoices(current, resource, resources),
      features ? renderActionSubhead("Особенности") : "",
      features,
      renderActionSubhead("Ручная реакция"),
      renderActionChoice({
        mode: "save",
        eventType: "save",
        resource,
        label: "Реакция / спасбросок",
        icon: "↶",
        detail: "после внешнего триггера",
        reason: "Реакция",
      }, resources),
    ].join("");
  } else if (resource === "free_action") {
    body = features;
  } else if (resource === "object_interaction") {
    body = renderActionChoice({
      mode: "effect",
      eventType: "effect",
      resource,
      label: "Взаимодействие",
      icon: "○",
      detail: "дверь / предмет / рычаг",
      reason: "Взаимодействие с предметом",
      effectName: "Взаимодействие с предметом",
    }, resources);
  } else if (resource === "none" && canManage) {
    body = [
      renderActionChoice({ mode: "damage", eventType: "damage", resource: "none", label: "Урон", icon: "🔥", detail: "прямое изменение HP" }, resources),
      renderActionChoice({ mode: "heal", eventType: "heal", resource: "none", label: "Лечение", icon: "✚", detail: "прямое изменение HP" }, resources),
      renderActionChoice({ mode: "effect", eventType: "effect", resource: "none", label: "Эффект", icon: "☄", detail: "баф / дебаф / состояние" }, resources),
      renderActionChoice({ mode: "note", eventType: "note", resource: "none", label: "Заметка", icon: "✎", detail: "запись без ресурса" }, resources),
    ].join("");
  }

  return body || `
    <div class="combat-ref-resource-empty">
      <strong>Нет доступных действий</strong>
      <span>${escapeHtml(current?.name || "Участник")} не получил действий этого типа из LSS, Бестиария, предметов или эффектов.</span>
    </div>
  `;
}

function renderActionCards(current, canManage) {
  const resources = normalizeTurnResources(current || {}, safeNumber(current?.speed, 30));
  const resourceKeys = ["action", "bonus_action", "movement", "reaction", "free_action", "object_interaction"];

  return `
    <section class="combat-ref-actions combat-ref-resource-picker" data-combat-region="actions" data-combat-selected-action="attack" data-combat-selected-resource="action">
      <style data-combat-resource-picker-style>
        .combat-ref-resource-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:10px 0}
        .combat-ref-resource-tab{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;align-items:center;min-height:54px;padding:8px 10px;border:1px solid rgba(150,204,211,.18);border-radius:13px;background:rgba(3,13,17,.48);color:inherit;text-align:left;cursor:pointer}
        .combat-ref-resource-tab>span{grid-row:1/3;display:grid;place-items:center;width:26px;height:26px;border-radius:999px;border:1px solid rgba(218,183,108,.2);font-size:15px;color:#e8ca83}
        .combat-ref-resource-tab strong{min-width:0;font-size:12px;line-height:1.2;overflow-wrap:anywhere}
        .combat-ref-resource-tab small{min-width:0;font-size:10px;line-height:1.25;color:rgba(220,235,236,.58);overflow-wrap:anywhere}
        .combat-ref-resource-tab.is-active{border-color:rgba(93,220,234,.82);background:rgba(26,111,124,.26);box-shadow:0 0 0 2px rgba(93,220,234,.09)}
        .combat-ref-resource-tab.is-spent{filter:saturate(.35);opacity:.52}
        .combat-ref-resource-tab.is-spent>span{border-color:rgba(124,145,149,.18);color:#8fa0a3}
        .combat-ref-resource-actions{display:grid;grid-template-columns:1fr;gap:8px}
        .combat-ref-resource-actions[hidden]{display:none!important}
        .combat-ref-action-choice{display:grid;grid-template-columns:38px minmax(0,1fr);grid-template-rows:auto auto;gap:2px 9px;align-items:center;min-height:64px;padding:9px 10px;border:1px solid rgba(218,183,108,.18);border-radius:13px;background:rgba(4,12,16,.5);color:inherit;text-align:left;cursor:pointer}
        .combat-ref-action-choice>span{grid-row:1/3;display:grid;place-items:center;width:36px;height:36px;border:1px solid rgba(218,183,108,.18);border-radius:11px;color:#ead08d}
        .combat-ref-action-choice strong{display:block;min-width:0;font-size:13px;line-height:1.25;overflow-wrap:anywhere}
        .combat-ref-action-choice small{display:block;min-width:0;color:rgba(220,233,234,.58);font-size:10px;line-height:1.35;overflow-wrap:anywhere}
        .combat-ref-action-choice:hover:not(:disabled),.combat-ref-action-choice.is-active{border-color:rgba(93,220,234,.78);background:rgba(28,111,123,.24)}
        .combat-ref-action-choice:disabled{cursor:not-allowed;filter:saturate(.25);opacity:.38}
        .combat-ref-resource-empty{grid-column:1/-1;display:grid;gap:4px;padding:14px;border:1px dashed rgba(145,194,201,.18);border-radius:13px;color:rgba(220,233,234,.62)}
        .combat-ref-resource-empty strong{color:#e6d5aa}.combat-ref-resource-empty.is-compact{padding:10px 12px}.combat-ref-action-subhead{grid-column:1/-1;display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-top:5px;padding:5px 2px 2px;color:#e8ca83}.combat-ref-action-subhead strong{font-size:11px;letter-spacing:.06em;text-transform:uppercase}.combat-ref-action-subhead small{color:rgba(220,233,234,.5);font-size:10px}.combat-ref-action-profile{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:8px 0 2px;padding:9px 10px;border:1px solid rgba(141,222,232,.16);border-radius:12px;background:rgba(12,55,63,.14)}.combat-ref-action-profile strong{margin-right:auto;color:#f0d693}.combat-ref-action-profile span{padding:4px 7px;border:1px solid rgba(150,204,211,.14);border-radius:999px;color:rgba(230,241,242,.72);font-size:10px}
        .combat-ref-action-live{margin-top:8px;padding:8px 10px;border:1px solid rgba(141,222,232,.16);border-radius:12px;background:rgba(3,12,16,.44);color:rgba(231,242,243,.78);font-size:12px;font-weight:800}
        .combat-ref-composer-resource{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px;padding:8px 10px;border:1px solid rgba(141,222,232,.16);border-radius:12px;background:rgba(17,76,84,.16)}
        .combat-ref-composer-resource strong{color:#f0d693}
        .combat-ref-spell-targeting{display:grid;gap:9px;padding:10px;border:1px solid rgba(93,220,234,.18);border-radius:13px;background:rgba(8,35,41,.34)}
        .combat-ref-spell-targeting-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.combat-ref-spell-targeting-head>div:first-child{display:grid;gap:2px}.combat-ref-spell-targeting-head strong{color:#ead08d}.combat-ref-spell-targeting-head small{color:rgba(220,233,234,.58);font-size:10px}
        .combat-ref-target-tools{display:flex;flex-wrap:wrap;gap:5px}.combat-ref-target-tools button{padding:5px 8px;border:1px solid rgba(145,194,201,.18);border-radius:8px;background:rgba(5,16,20,.72);color:rgba(230,241,242,.74);font-size:10px;cursor:pointer}.combat-ref-target-tools button:hover{border-color:rgba(93,220,234,.6)}
        .combat-ref-multi-target-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;max-height:240px;overflow:auto;padding-right:2px}.combat-ref-multi-target{display:grid;grid-template-columns:30px minmax(0,1fr);grid-template-rows:auto auto;gap:1px 7px;align-items:center;padding:7px;border:1px solid rgba(145,194,201,.13);border-radius:10px;background:rgba(2,10,13,.44);cursor:pointer}.combat-ref-multi-target input{position:absolute;opacity:0;pointer-events:none}.combat-ref-multi-target>span{grid-row:1/3}.combat-ref-multi-target strong{font-size:11px;overflow-wrap:anywhere}.combat-ref-multi-target small{font-size:9px;color:rgba(220,233,234,.52)}.combat-ref-multi-target.is-selected{border-color:rgba(93,220,234,.72);background:rgba(22,94,105,.24);box-shadow:inset 0 0 0 1px rgba(93,220,234,.11)}.combat-ref-multi-target-avatar{width:28px;height:28px;border-radius:8px;overflow:hidden}.combat-ref-multi-target-avatar img{width:100%;height:100%;object-fit:cover}.combat-ref-target-count{font-size:10px;color:rgba(220,233,234,.62)}
        .combat-ref-spell-meta{padding:8px 10px;border:1px dashed rgba(145,194,201,.18);border-radius:11px;color:rgba(220,233,234,.68);font-size:11px}
        .combat-ref-turn-resource b{font-style:normal}
        .combat-ref-turn-resource.is-spent{opacity:.42;filter:saturate(.25)}
        .combat-ref-turn-resource.is-spent b:after{content:" ×";color:#e87970}
        .combat-ref-action-mode-head{display:grid;gap:4px;margin-bottom:10px}
        .combat-ref-action-mode-head strong{display:block;color:#f0d693;font-size:14px;line-height:1.2}
        .combat-ref-action-mode-head small{display:block;color:rgba(224,237,238,.7);font-size:11px;line-height:1.45}
        .combat-ref-movement-bridge{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px;border:1px solid rgba(93,220,234,.2);border-radius:13px;background:rgba(15,71,80,.16)}
        .combat-ref-movement-bridge>div{display:grid;gap:3px}
        .combat-ref-movement-bridge span{color:rgba(220,233,234,.62);font-size:11px;line-height:1.35}
        .combat-ref-gm-drawer{margin-top:10px;border:1px solid rgba(218,183,108,.18);border-radius:13px;background:rgba(29,19,8,.15)}
        .combat-ref-gm-drawer>summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 13px;cursor:pointer;color:#e8cb85;font-weight:900;list-style:none}
        .combat-ref-gm-drawer>summary::-webkit-details-marker{display:none}
        .combat-ref-gm-drawer>summary small{color:rgba(222,232,233,.52);font-size:10px;font-weight:700}
        .combat-ref-gm-tools{padding:0 10px 10px}
        .combat-ref-composer-awaiting{display:grid;gap:5px;padding:13px;border:1px dashed rgba(145,194,201,.2);border-radius:12px;color:rgba(221,234,235,.68)}
        .combat-ref-composer-awaiting strong{color:#ead39a}
        .combat-ref-composer.is-awaiting-action [data-combat-composer-body]{display:none!important}
        .combat-ref-composer:not(.is-awaiting-action) [data-combat-composer-awaiting]{display:none!important}
        .master-runtime-movement-panel.is-combat-focus-flash{animation:combatMovementFocus 1.15s ease}
        @keyframes combatMovementFocus{0%,100%{box-shadow:0 0 0 0 rgba(90,220,235,0)}35%{box-shadow:0 0 0 3px rgba(90,220,235,.36)}}
        @media(max-width:1180px){.combat-ref-resource-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:760px){.combat-ref-resource-tabs,.combat-ref-resource-actions,.combat-ref-multi-target-list{grid-template-columns:1fr}.combat-ref-movement-bridge{align-items:stretch;flex-direction:column}.combat-ref-spell-targeting-head{flex-direction:column}}
      </style>

      <div class="combat-ref-section-head">
        <div>
          <div class="combat-ref-kicker">Экономика хода</div>
          <h4>1. Ресурс → 2. Действие → 3. Подтверждение</h4>
        </div>
      </div>

      ${(() => {
        const attacks = getEntryAttacks(current);
        const spells = getEntrySpells(current);
        const finalProfile = current?.combat_profile?.final || {};
        const spellAttack = safeNumber(current?.spellcasting?.attack_bonus ?? finalProfile.spell_attack, 0);
        const spellDc = safeNumber(current?.spellcasting?.save_dc ?? finalProfile.spell_save_dc, 0);
        return `<div class="combat-ref-action-profile"><strong>${escapeHtml(current?.name || "Участник")}</strong><span>КД ${escapeHtml(String(current?.ac || 0))}</span><span>атак ${escapeHtml(String(attacks.length))}</span><span>спеллов ${escapeHtml(String(spells.length))}</span>${spellAttack ? `<span>спелл ${escapeHtml(formatSignedValue(spellAttack))}</span>` : ""}${spellDc ? `<span>Сл ${escapeHtml(String(spellDc))}</span>` : ""}</div>`;
      })()}

      <div class="combat-ref-resource-tabs" role="tablist" aria-label="Ресурсы хода">
        ${resourceKeys.map((key, index) => {
          const meta = getResourceUiMeta(resources, key);
          return `
            <button
              class="combat-ref-resource-tab ${index === 0 ? "is-active" : ""} is-${escapeHtml(meta.state)}"
              type="button"
              role="tab"
              aria-selected="${index === 0 ? "true" : "false"}"
              data-combat-action="resource-tab"
              data-combat-resource-key="${escapeHtml(key)}"
              data-combat-resource-ready="${meta.ready ? "1" : "0"}"
            >
              <span>${escapeHtml(meta.icon)}</span>
              <strong>${escapeHtml(meta.label)}</strong>
              <small>${escapeHtml(meta.value)}</small>
            </button>
          `;
        }).join("")}
      </div>

      ${resourceKeys.map((key, index) => `
        <div
          class="combat-ref-resource-actions"
          role="tabpanel"
          data-combat-resource-actions="${escapeHtml(key)}"
          ${index === 0 ? "" : "hidden"}
        >${renderResourceActionGroup(current, key, canManage, resources)}</div>
      `).join("")}

      ${canManage ? `
        <details class="combat-ref-gm-drawer">
          <summary><span>GM-вмешательство</span><small>не тратит ресурсы персонажа</small></summary>
          <div class="combat-ref-resource-actions combat-ref-gm-tools" data-combat-resource-actions="none">
            ${renderResourceActionGroup(current, "none", canManage, resources)}
          </div>
        </details>
      ` : ""}

      <div class="combat-ref-action-live" data-combat-action-live aria-live="polite">
        Действие доступно. Выбери конкретную атаку, заклинание, проверку или боевой манёвр.
      </div>
    </section>
  `;
}

function renderCombatLog(combat, options) {
  const filter = String(options.logFilter || "all").trim() || "all";
  const hideSecondary = Boolean(options.hideSecondary);
  const log = safeArray(combat.log).filter((entry) => isLogVisible(entry, filter, hideSecondary)).slice(-30).reverse();

  return `
    <section class="combat-ref-log-panel" data-combat-region="log">
      <div class="combat-ref-section-head combat-ref-section-head-sticky">
        <div>
          <div class="combat-ref-kicker">Журнал боя</div>
          <h4>Броски, урон, эффекты</h4>
        </div>
        <div class="combat-ref-log-filters">
          ${LOG_FILTERS.map((item) => `
            <button class="combat-ref-filter ${filter === item.key ? "is-active" : ""}" type="button" data-combat-action="log-filter" data-combat-log-filter="${escapeHtml(item.key)}">${escapeHtml(item.label)}</button>
          `).join("")}
          <button class="combat-ref-filter ${hideSecondary ? "is-active" : ""}" type="button" data-combat-action="toggle-secondary">Скрыть вторичное</button>
        </div>
      </div>
      <div class="combat-ref-log-list">
        ${log.length ? log.map((entry) => {
          const tone = getLogTone(entry);
          const outcome = getOutcomeLabel(entry);
          return `
            <article class="combat-ref-log-entry combat-ref-log-entry-${escapeHtml(tone)}">
              <div class="combat-ref-log-avatar">${escapeHtml(getLogIcon(entry))}</div>
              <div class="combat-ref-log-main">
                <div class="combat-ref-log-title">${escapeHtml(getLogHeadline(entry))}</div>
                <div class="combat-ref-log-meta">
                  <span>${escapeHtml(formatTime(entry.created_at))}</span>
                  <span>Раунд ${escapeHtml(String(entry.round || combat.round || 1))}</span>
                  ${entry.dice ? `<span>${escapeHtml(entry.dice)}${entry.modifier ? ` ${entry.modifier > 0 ? "+" : ""}${escapeHtml(String(entry.modifier))}` : ""}</span>` : ""}
                  ${entry.visibility && entry.visibility !== "public" ? `<span>${escapeHtml(entry.visibility)}</span>` : ""}
                </div>
              </div>
              ${outcome ? `<div class="combat-ref-log-outcome">${escapeHtml(outcome)}</div>` : ""}
            </article>
          `;
        }).join("") : `<div class="combat-ref-empty-row">Лог боя пуст. Первый бросок появится здесь.</div>`}
      </div>
    </section>
  `;
}

function renderTargetPanel(combat, target, canManage) {
  const abilities = target?.abilities || {};
  const conditions = safeArray(target?.conditions).filter(Boolean);
  const quickDelta = target ? `
    <div class="combat-ref-target-adjust">
      <input type="number" min="1" value="1" data-combat-delta-entry="${escapeHtml(target.entry_id)}" aria-label="Количество">
      <button class="btn" type="button" data-combat-action="damage" data-combat-entry-id="${escapeHtml(target.entry_id)}">Урон</button>
      <button class="btn" type="button" data-combat-action="heal" data-combat-entry-id="${escapeHtml(target.entry_id)}">Лечение</button>
    </div>
  ` : "";

  return `
    <section class="combat-ref-side-card combat-ref-target-card" data-combat-region="target">
      <div class="combat-ref-section-head">
        <div>
          <div class="combat-ref-kicker">Цель</div>
          <h4>${escapeHtml(target?.name || "Не выбрана")}</h4>
        </div>
      </div>
      ${target ? `
        <div class="combat-ref-target-hero">
          <div class="combat-ref-target-portrait">${renderPortrait(target, "combat-ref-target-portrait")}</div>
          <div class="combat-ref-target-stats">
            <div><span>КД</span><strong>${escapeHtml(String(target.ac || 0))}</strong></div>
            <div><span>ХП</span><strong>${escapeHtml(String(target.hp_current || 0))}/${escapeHtml(String(target.hp_max || 0))}</strong></div>
            <div><span>СК</span><strong>${escapeHtml(String(target.speed || 30))} фт.</strong></div>
          </div>
        </div>
        ${renderHpMeter(target, "combat-ref-hp-meter")}
        <div class="combat-ref-target-meta">
          <span>${escapeHtml(getEntityKindLabel(target))}</span>
          ${target.race ? `<span>${escapeHtml(target.race)}</span>` : ""}
          ${target.class_name ? `<span>${escapeHtml(target.class_name)}</span>` : ""}
        </div>
        ${conditions.length ? `
          <div class="combat-ref-condition-list">
            ${conditions.slice(0, 6).map((item) => `<span>${escapeHtml(String(item?.label || item?.name || item))}</span>`).join("")}
          </div>
        ` : `<div class="muted">Состояния не указаны.</div>`}
        <details class="combat-ref-drawer">
          <summary>Характеристики</summary>
          <div class="combat-ref-ability-grid">
            ${[
              ["СИЛ", abilities.str], ["ЛВК", abilities.dex], ["ВЫН", abilities.con],
              ["ИНТ", abilities.int], ["МДР", abilities.wis], ["ХАР", abilities.cha],
            ].map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(String(value || 10))}</strong><em>${escapeHtml(getAbilityMod(value || 10))}</em></div>`).join("")}
          </div>
        </details>
        ${canManage ? quickDelta : ""}
      ` : `<div class="combat-ref-empty-row">Выбери цель в панели действия или в инициативе.</div>`}
    </section>
  `;
}

function renderEnvironmentPanel(options = {}) {
  const table = options.table || {};
  const scene = table.scene || table.active_scene || {};
  const sceneTitle = scene.title || scene.name || table.scene_title || table.title || "Сцена боя";
  const light = scene.light || scene.lighting || "обычный свет";
  const surface = scene.surface || "местность не указана";
  const features = scene.features || scene.description || "укрытия, дистанции и помехи задаёт мастер";

  return `
    <section class="combat-ref-side-card combat-ref-env-card">
      <div class="combat-ref-kicker">Окружение</div>
      <h4>${escapeHtml(sceneTitle)}</h4>
      <ul>
        <li><strong>Свет:</strong> ${escapeHtml(light)}</li>
        <li><strong>Поверхность:</strong> ${escapeHtml(surface)}</li>
        <li><strong>Особенности:</strong> ${escapeHtml(clampText(features, 120))}</li>
      </ul>
    </section>
  `;
}

function renderLastRollPanel(combat) {
  const latestRoll = safeArray(combat.log).filter((entry) => getLogBucket(entry) === "dice" || entry.dice || entry.roll_total).at(-1);
  const total = latestRoll ? getOutcomeLabel(latestRoll) || latestRoll.roll_total || latestRoll.dice || "—" : "—";
  const parts = latestRoll?.dice ? String(latestRoll.dice).replace(/\s+/g, "").split(/[,+]/).filter(Boolean).slice(0, 4) : [];
  return `
    <section class="combat-ref-side-card combat-ref-last-roll-card">
      <div class="combat-ref-kicker">Последний бросок</div>
      <div class="combat-ref-last-roll-main">
        ${parts.length ? parts.map((part) => `<span>${escapeHtml(part)}</span>`).join("") : `<span>—</span>`}
        <strong>= ${escapeHtml(String(total))}</strong>
      </div>
      <small>${latestRoll ? escapeHtml(getLogHeadline(latestRoll)) : "Бросков пока нет"}</small>
    </section>
  `;
}


function renderActionComposer(combat, current, target, options = {}) {
  const entries = safeArray(combat.entries);
  const currentId = current?.entry_id || "";
  const targetId = target?.entry_id || "";
  const initialPreset = getActionPreset(options.actionType || "attack");
  const resourceMeta = getTurnResourceMeta(initialPreset.resource || "action");

  return `
    <section class="combat-ref-side-card combat-ref-composer" data-combat-region="composer" data-combat-composer="1" data-selected-action-choice="Атака">
      <div class="combat-ref-section-head">
        <div>
          <div class="combat-ref-kicker">Выполнение</div>
          <h4>Выбранное действие</h4>
        </div>
      </div>

      <div class="combat-ref-composer-awaiting" data-combat-composer-awaiting>
        <strong>Сначала выбери действие</strong>
        <span>Карточка откроется здесь и покажет актёра, цель, расчёт, расход ресурса и подтверждение.</span>
      </div>

      <div data-combat-composer-body>
        <div class="combat-ref-composer-resource">
          <span>Тратится ресурс</span>
          <strong data-combat-composer-resource-label>${escapeHtml(resourceMeta.label)}</strong>
        </div>
        <div class="combat-ref-action-summary" data-combat-action-summary>
          <strong>${escapeHtml(ACTION_MODE_COPY[initialPreset.key]?.title || "Действие")}</strong>
          <span>${escapeHtml(ACTION_MODE_COPY[initialPreset.key]?.hint || "Выбери действие выше.")}</span>
        </div>
        <div class="combat-ref-roll-form">
          <input type="hidden" value="${escapeHtml(initialPreset.key)}" data-combat-roll-field="action_type">
          <input type="hidden" value="${escapeHtml(initialPreset.resource || "action")}" data-combat-roll-field="turn_resource">
          <input type="hidden" value="${escapeHtml(initialPreset.eventType || "attack")}" data-combat-roll-field="event_type">

          <label>
            <span>Кто действует</span>
            <select data-combat-roll-field="actor_entry_id">
              <option value="">Система / GM</option>
              ${entries.map((entry) => `
                <option
                  value="${escapeHtml(entry.entry_id)}"
                  data-ac="${escapeHtml(String(entry.ac || 0))}"
                  data-hp="${escapeHtml(String(entry.hp_current || 0))}"
                  data-kind="${escapeHtml(String(entry.entity_kind || entry.entry_type || ""))}"
                  ${renderEntryMechanicalOptionData(entry)}
                  ${entry.entry_id === currentId ? "selected" : ""}
                >${escapeHtml(entry.name)}</option>
              `).join("")}
            </select>
          </label>

          <label>
            <span>Цель</span>
            <select data-combat-roll-field="target_entry_id">
              <option value="">Без цели</option>
              ${entries.map((entry) => `
                <option
                  value="${escapeHtml(entry.entry_id)}"
                  data-ac="${escapeHtml(String(entry.ac || 0))}"
                  data-hp="${escapeHtml(String(entry.hp_current || 0))}"
                  data-kind="${escapeHtml(String(entry.entity_kind || entry.entry_type || ""))}"
                  ${renderEntryMechanicalOptionData(entry)}
                  ${entry.entry_id === targetId ? "selected" : ""}
                >${escapeHtml(entry.name)}</option>
              `).join("")}
            </select>
          </label>

          <div class="combat-ref-action-mode-stack">${renderActionModePanels(current, target, entries)}</div>

          <div class="combat-ref-roll-inline" data-combat-generic-roll-row>
            <label data-combat-dice-control>
              <span>Куб</span>
              <input type="text" value="${escapeHtml(initialPreset.dice || options.diceType || "d20")}" data-combat-roll-field="dice">
            </label>
            <label data-combat-mod-control>
              <span>Мод.</span>
              <input type="number" value="0" data-combat-roll-field="modifier">
            </label>
            <label data-combat-damage-control>
              <span>Урон/леч.</span>
              <input type="number" min="0" value="0" data-combat-roll-field="damage">
            </label>
          </div>

          <label>
            <span>Описание</span>
            <input type="text" placeholder="Что происходит" value="${escapeHtml(initialPreset.reason || "")}" data-combat-roll-field="reason">
          </label>

          <button class="btn btn-primary combat-ref-roll-submit" type="button" data-combat-action="roll" data-combat-submit-label>
            Выполнить атаку
          </button>
        </div>

        <div class="combat-ref-dice-row" data-combat-quick-dice>
          ${DICE_PRESETS.map((die) => `
            <button
              class="combat-ref-die ${String(initialPreset.dice || options.diceType || "d20") === die ? "is-active" : ""}"
              type="button"
              data-combat-action="quick-die"
              data-combat-die="${escapeHtml(die)}"
            >${escapeHtml(die.toUpperCase())}</button>
          `).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderRosterDrawer(combat, canManage) {
  const entries = safeArray(combat.entries);
  return `
    <details class="combat-ref-roster-drawer" ${entries.length <= 4 ? "open" : ""}>
      <summary>
        <span>Участники боя</span>
        <em>${escapeHtml(String(entries.length))}</em>
      </summary>
      <div class="combat-ref-roster-grid">
        ${entries.map((entry) => {
          const status = getStatusMeta(entry.status);
          const defeated = isDeadEnemy(entry);
          return `
            <article class="combat-ref-roster-card ${defeated ? "is-defeated" : ""} ${escapeHtml(status.className)}" data-combat-entry="${escapeHtml(entry.entry_id)}">
              <div class="combat-ref-roster-top">
                <div class="combat-ref-roster-portrait">${renderPortrait(entry, "combat-ref-roster-portrait")}</div>
                <div>
                  <strong>${defeated ? "✕ " : ""}${escapeHtml(entry.name)}</strong>
                  <small>${escapeHtml(getEntityKindLabel(entry))} • ${escapeHtml(status.label)}${defeated ? " • пропуск хода" : ""}</small>
                </div>
              </div>
              ${renderHpMeter(entry, "combat-ref-hp-meter")}
              <div class="combat-ref-roster-stats">
                <span>HP ${escapeHtml(String(entry.hp_current))}/${escapeHtml(String(entry.hp_max))}</span>
                <span>КД ${escapeHtml(String(entry.ac))}</span>
                <span>Init ${escapeHtml(String(entry.initiative))}</span>
              </div>
              ${canManage ? `
                <details class="combat-ref-drawer combat-ref-roster-edit">
                  <summary>Редактировать</summary>
                  <div class="combat-ref-roster-edit-grid">
                    <input type="text" value="${escapeHtml(entry.name)}" data-combat-field-entry="${escapeHtml(entry.entry_id)}" data-combat-field="name" aria-label="Имя">
                    <input type="number" min="0" value="${escapeHtml(String(entry.hp_current))}" data-combat-field-entry="${escapeHtml(entry.entry_id)}" data-combat-field="hp_current" aria-label="HP">
                    <input type="number" min="0" value="${escapeHtml(String(entry.hp_max))}" data-combat-field-entry="${escapeHtml(entry.entry_id)}" data-combat-field="hp_max" aria-label="HP max">
                    <input type="number" min="0" value="${escapeHtml(String(entry.ac))}" data-combat-field-entry="${escapeHtml(entry.entry_id)}" data-combat-field="ac" aria-label="AC">
                    <input type="number" value="${escapeHtml(String(entry.initiative))}" data-combat-field-entry="${escapeHtml(entry.entry_id)}" data-combat-field="initiative" aria-label="Initiative">
                    <input type="text" value="${escapeHtml(entry.status)}" data-combat-field-entry="${escapeHtml(entry.entry_id)}" data-combat-field="status" aria-label="Status">
                  </div>
                  <div class="combat-ref-roster-actions">
                    <input type="number" min="1" value="1" data-combat-delta-entry="${escapeHtml(entry.entry_id)}" aria-label="Delta">
                    <button class="btn" type="button" data-combat-action="damage" data-combat-entry-id="${escapeHtml(entry.entry_id)}">Урон</button>
                    <button class="btn" type="button" data-combat-action="heal" data-combat-entry-id="${escapeHtml(entry.entry_id)}">Лечение</button>
                    <button class="btn btn-primary" type="button" data-combat-action="save-combatant" data-combat-entry-id="${escapeHtml(entry.entry_id)}">Сохранить</button>
                    <button class="btn btn-danger" type="button" data-combat-action="remove-entry" data-combat-entry-id="${escapeHtml(entry.entry_id)}">Убрать</button>
                  </div>
                </details>
              ` : ""}
            </article>
          `;
        }).join("")}
      </div>
    </details>
  `;
}

export function renderCombatModule(options = {}) {
  const combat = normalizeCombatState(options.combat);
  const tableTitle = String(options.tableTitle || options.table?.title || "Battle").trim();
  const canManage = Boolean(options.canManage);

  if (!combat.entries.length && !combat.active) return renderEmptyCombat(canManage);

  const current = getCurrentTurnEntry(combat);
  const target = getSuggestedTarget(combat, current);

  return `
    <div class="combat-module combat-ref" data-combat-module="${COMBAT_MODULE_VERSION}" data-combat-active="${combat.active ? "1" : "0"}">
      <header class="combat-ref-header">
        <div>
          <div class="combat-ref-kicker">Master Room / Бой</div>
          <h3>${escapeHtml(tableTitle)}</h3>
          <div class="combat-ref-header-sub">Пошаговый экран: инициатива, действия, кубы и журнал боя.</div>
        </div>
        <div class="combat-ref-header-stats">
          <div><span>Раунд</span><strong>${escapeHtml(String(combat.round || 1))}</strong></div>
          <div><span>Участников</span><strong>${escapeHtml(String(combat.entries.length))}</strong></div>
          <div><span>Статус</span><strong>${escapeHtml(combat.active ? "Активен" : "Пауза")}</strong></div>
        </div>
      </header>

      ${renderInitiativeTrack(combat, canManage)}
      ${renderCurrentTurnBanner(current, target, combat, canManage)}

      <div class="combat-ref-layout">
        <main class="combat-ref-main">
          ${renderCombatLog(combat, { logFilter: options.logFilter, hideSecondary: options.hideSecondary })}
          ${renderRosterDrawer(combat, canManage)}
        </main>
        <aside class="combat-ref-side">
          ${renderTargetPanel(combat, target, canManage)}
          ${renderEnvironmentPanel(options)}
          ${renderActionCards(current, canManage)}
          ${renderActionComposer(combat, current, target, { diceType: options.diceType })}
          ${renderLastRollPanel(combat)}
        </aside>
      </div>
    </div>
  `;
}

function getCombatantPatch(root, entryId) {
  const read = (field, fallback = "") => {
    const input = Array.from(root.querySelectorAll("[data-combat-field-entry]")).find((item) =>
      String(item.dataset.combatFieldEntry || "") === String(entryId || "") &&
      String(item.dataset.combatField || "") === field
    );
    return input ? input.value : fallback;
  };

  return {
    name: String(read("name")).trim(),
    hp_current: Math.max(0, safeNumber(read("hp_current"), 0)),
    hp_max: Math.max(0, safeNumber(read("hp_max"), 0)),
    ac: Math.max(0, safeNumber(read("ac"), 0)),
    initiative: safeNumber(read("initiative"), 0),
    status: String(read("status")).trim(),
  };
}

function buildActionReason(payload = {}) {
  const eventType = String(payload.eventType || "roll").trim();
  const actionType = String(payload.actionType || eventType).trim();
  const base = String(payload.baseReason || "").trim();
  const target = payload.targetName ? ` → ${payload.targetName}` : "";
  const extra = payload.extra || {};

  if (eventType === "attack") {
    const name = extra.attack_name || base || "Атака";
    const bonus = safeNumber(extra.attack_bonus, 0);
    const damage = extra.damage_dice ? `; урон ${extra.damage_dice}${extra.damage_type ? ` ${extra.damage_type}` : ""}` : "";
    return `${name}${target}; попадание d20${bonus ? ` ${bonus > 0 ? "+" : ""}${bonus}` : ""}${damage}`;
  }
  if (eventType === "spell") {
    const name = extra.spell_name || base || "Заклинание";
    const level = Number(extra.spell_level || 0) > 0 ? ` ${extra.spell_level} круг` : " заговор/0 круг";
    const mode = extra.spell_mode ? `; режим: ${extra.spell_mode}` : "";
    const dc = extra.save_dc ? `; Сл ${extra.save_dc}` : "";
    const effect = extra.spell_effect ? `; ${extra.spell_effect}` : "";
    return `${name}${target};${level}${mode}${dc}${effect}`;
  }
  if (eventType === "move") {
    const cost = safeNumber(extra.movement_cost, 0);
    const movementType = extra.movement_type ? ` (${extra.movement_type})` : "";
    return `${base || "Движение"}${cost ? `: ${cost} фт.` : ""}${movementType}`;
  }
  if (eventType === "check") {
    const ability = extra.ability_label || extra.ability || "характеристика";
    const skill = extra.skill_name ? ` / ${extra.skill_name}` : "";
    return `${base || "Проверка"}: ${ability}${skill}`;
  }
  if (eventType === "save") {
    const ability = extra.ability_label || extra.ability || "характеристика";
    const dc = extra.save_dc ? ` против Сл ${extra.save_dc}` : "";
    return `${base || "Спасбросок"}: ${ability}${dc}`;
  }
  if (eventType === "damage") {
    return `${base || "Урон"}${target}${payload.damage ? `: ${payload.damage}` : ""}`;
  }
  if (eventType === "heal") {
    return `${base || "Лечение"}${target}${payload.damage ? `: ${payload.damage}` : ""}`;
  }
  if (eventType === "effect") {
    const name = extra.effect_name || base || "Эффект";
    const duration = extra.duration ? ` (${extra.duration})` : "";
    return `${name}${target}${duration}`;
  }
  if (eventType === "note") return base || "Заметка боя";
  return base || ACTION_MODE_COPY[actionType]?.title || "Бросок";
}

function getRollPayload(root) {
  const read = (field, fallback = "") => {
    const input = root.querySelector(`[data-combat-roll-field="${field}"]`);
    return input ? input.value : fallback;
  };
  const optionLabel = (field) => {
    const input = root.querySelector(`[data-combat-roll-field="${field}"]`);
    if (!input || !input.options) return "";
    return input.options[input.selectedIndex]?.textContent?.trim() || "";
  };
  const optionData = (field, key, fallback = "") => {
    const input = root.querySelector(`[data-combat-roll-field="${field}"]`);
    if (!input || !input.options) return fallback;
    return input.options[input.selectedIndex]?.dataset?.[key] ?? fallback;
  };
  const optionJson = (field, key, fallback = []) => {
    const raw = optionData(field, key, "");
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch (_error) {
      return fallback;
    }
  };

  const eventType = String(read("event_type", "roll")).trim() || "roll";
  const actionType = String(read("action_type", eventType)).trim() || eventType;
  const turnResource = String(read("turn_resource", getActionResource(actionType))).trim() || "none";
  const modifier = safeNumber(read("modifier", 0), 0);
  const dice = formatDiceWithModifier(read("dice", "d20"), modifier);
  const damage = Math.max(0, safeNumber(read("damage", 0), 0));
  const targetName = optionLabel("target_entry_id");
  const actorName = optionLabel("actor_entry_id");
  const targetAc = Math.max(0, safeNumber(optionData("target_entry_id", "ac", 0), 0));
  const targetHp = Math.max(0, safeNumber(optionData("target_entry_id", "hp", 0), 0));
  const actorKind = String(optionData("actor_entry_id", "kind", "")).trim();
  const targetKind = String(optionData("target_entry_id", "kind", "")).trim();

  const extra = {
    action_type: actionType,
    attack_name: String(read("attack_name", "")).trim(),
    attack_bonus: safeNumber(read("attack_bonus", 0), 0),
    damage_dice: String(read("damage_dice", "")).trim(),
    damage_type: String(read("damage_type", "")).trim(),
    spell_id: String(read("spell_id", "")).trim(),
    spell_name: String(read("spell_name", "")).trim(),
    spell_level: safeNumber(read("spell_level", 0), 0),
    spell_mode: String(read("spell_mode", "")).trim(),
    spell_effect: String(read("spell_effect", "")).trim(),
    spell_attack_bonus: safeNumber(read("spell_attack_bonus", 0), 0),
    spell_resource: String(read("spell_resource", "")).trim(),
    spell_range: String(read("spell_range", "")).trim(),
    spell_duration: String(read("spell_duration", "")).trim(),
    spell_activation: String(read("spell_activation", "")).trim(),
    spell_concentration: readBool(read("spell_concentration", "0"), false),
    spell_save_ability: normalizeAbilityKey(read("spell_save_ability", read("ability", "dex")), "dex"),
    spell_save_result: String(read("spell_save_result", "none")).trim() || "none",
    spell_area_shape: String(read("spell_area_shape", "single")).trim() || "single",
    spell_area_size: Math.max(0, safeNumber(read("spell_area_size", 0), 0)),
    spell_max_targets: Math.max(1, safeNumber(read("spell_max_targets", 1), 1)),
    save_roll_mode: String(read("save_roll_mode", "normal")).trim() || "normal",
    save_dc: safeNumber(read("save_dc", 0), 0),
    ability: String(read("ability", "")).trim(),
    ability_label: optionLabel("ability"),
    skill_name: String(read("skill_name", "")).trim(),
    effect_name: String(read("effect_name", "")).trim(),
    duration: String(read("duration", "")).trim(),
    movement_cost: Math.max(0, safeNumber(read("movement_cost", 0), 0)),
    movement_type: String(read("movement_type", "")).trim(),
    target_ac: targetAc,
    target_hp: targetHp,
    actor_kind: actorKind,
    target_kind: targetKind,
    target_save_modifier: safeNumber(optionData("target_entry_id", `save${normalizeAbilityKey(read("spell_save_ability", read("ability", "dex")), "dex").replace(/^./, (char) => char.toUpperCase())}`, 0), 0),
    target_con_save_modifier: safeNumber(optionData("target_entry_id", "saveCon", 0), 0),
    target_resistances: optionJson("target_entry_id", "resistances", []),
    target_immunities: optionJson("target_entry_id", "immunities", []),
    target_vulnerabilities: optionJson("target_entry_id", "vulnerabilities", []),
    target_concentrating: optionData("target_entry_id", "concentrating", "0") === "1",
  };

  const selectedTargets = Array.from(root.querySelectorAll("[data-combat-multi-target-checkbox]:checked")).map((input) => {
    const data = input.dataset || {};
    const jsonList = (key) => {
      try { const parsed = JSON.parse(data[key] || "[]"); return Array.isArray(parsed) ? parsed : []; } catch (_error) { return []; }
    };
    const ability = normalizeAbilityKey(read("spell_save_ability", read("ability", "dex")), "dex");
    const saveKey = `targetSave${ability.replace(/^./, (char) => char.toUpperCase())}`;
    return {
      entry_id: String(input.value || "").trim(),
      name: String(data.targetName || "Цель"),
      ac: Math.max(0, safeNumber(data.targetAc, 0)),
      save_modifier: safeNumber(data[saveKey], 0),
      con_save_modifier: safeNumber(data.targetSaveCon, 0),
      resistances: jsonList("targetResistances"),
      immunities: jsonList("targetImmunities"),
      vulnerabilities: jsonList("targetVulnerabilities"),
      concentrating: data.targetConcentrating === "1",
    };
  }).filter((item) => item.entry_id);

  return {
    entry_id: String(read("actor_entry_id", "")).trim() || null,
    actor_name: actorName || null,
    target_entry_id: String(read("target_entry_id", "")).trim() || null,
    target_name: targetName || null,
    target_entry_ids: selectedTargets.map((item) => item.entry_id),
    target_names: selectedTargets.map((item) => item.name),
    multi_targets: selectedTargets,
    event_type: eventType,
    turn_resource: turnResource,
    dice,
    modifier,
    damage,
    movement_cost: extra.movement_cost || 0,
    reason: buildActionReason({ eventType, actionType, baseReason: String(read("reason", "")).trim(), targetName, actorName, extra, damage }),
    ...extra,
  };
}

function setRollField(root, field, value, options = {}) {
  const input = root.querySelector(`[data-combat-roll-field="${field}"]`);
  if (!input) return false;

  const nextValue = value === null || value === undefined ? "" : String(value);
  const currentValue = input.value === null || input.value === undefined ? "" : String(input.value);

  // Не генерируем change, если поле уже содержит это значение. Иначе event_type
  // вызывает updateComposerMode(), который снова меняет event_type и зацикливает DOM-события.
  if (currentValue === nextValue) return false;

  input.value = nextValue;
  if (options.emit !== false) {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return true;
}

function getDelta(root, entryId) {
  const input = Array.from(root.querySelectorAll("[data-combat-delta-entry]")).find((item) =>
    String(item.dataset.combatDeltaEntry || "") === String(entryId || "")
  );
  return Math.max(1, safeNumber(input?.value, 1));
}

function invoke(callbacks, name, payload) {
  const fn = callbacks && typeof callbacks[name] === "function" ? callbacks[name] : null;
  if (!fn) return;
  Promise.resolve(fn(payload)).catch((error) => {
    console.error(`Combat callback failed: ${name}`, error);
  });
}


function syncResourcePickerState(root, resourceKey = "action") {
  const key = String(resourceKey || "action").trim() || "action";
  root.querySelectorAll("[data-combat-resource-key]").forEach((tab) => {
    const active = String(tab.dataset.combatResourceKey || "") === key;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });

  root.querySelectorAll("[data-combat-resource-actions]").forEach((group) => {
    // GM-инструменты живут в отдельном drawer и не участвуют в табах экономики хода.
    if (group.classList.contains("combat-ref-gm-tools")) return;
    group.hidden = String(group.dataset.combatResourceActions || "") !== key;
  });

  const region = root.querySelector('[data-combat-region="actions"]');
  if (region && key !== "none") region.dataset.combatSelectedResource = key;
}

function isResourceReadyInPicker(root, resourceKey) {
  const key = String(resourceKey || "none");
  if (key === "none") return true;
  const tab = root.querySelector(`[data-combat-resource-key="${key}"]`);
  return !tab || String(tab.dataset.combatResourceReady || "1") !== "0";
}

function syncActionCardState(root, modeValue) {
  const mode = getActionPreset(modeValue).key || String(modeValue || "attack");
  const composer = root.querySelector("[data-combat-composer]");
  const selectedResource = String(composer?.querySelector('[data-combat-roll-field="turn_resource"]')?.value || getActionPreset(mode).resource || "action");
  const selectedChoice = String(composer?.dataset.selectedActionChoice || "");
  const preset = getActionPreset(mode);
  const resource = getTurnResourceMeta(selectedResource);

  root.querySelectorAll('[data-combat-action="action-template"]').forEach((card) => {
    const cardMode = String(card.dataset.combatTemplateAction || card.dataset.combatTemplateEvent || "roll");
    const cardResource = String(card.dataset.combatTemplateResource || getActionResource(cardMode));
    const cardChoice = String(card.dataset.combatTemplateLabel || card.dataset.combatTemplateReason || card.textContent || "").trim();
    const active = cardMode === mode && cardResource === selectedResource && (!selectedChoice || cardChoice === selectedChoice);
    card.classList.toggle("is-active", active);
    card.setAttribute("aria-pressed", active ? "true" : "false");
  });

  const region = root.querySelector('[data-combat-region="actions"]');
  if (region) region.dataset.combatSelectedAction = mode;
  if (selectedResource !== "none") syncResourcePickerState(root, selectedResource);

  const live = root.querySelector("[data-combat-action-live]");
  if (live) live.textContent = `Выбрано: ${preset.label || ACTION_MODE_COPY[mode]?.title || "Действие"} • ${resource.label.toLowerCase()}. Настрой параметры в карточке выполнения.`;
}

function setComposerAwaitingAction(root, resourceKey = "action") {
  const composer = root.querySelector("[data-combat-composer]");
  if (!composer) return;
  const resource = getTurnResourceMeta(resourceKey);
  composer.classList.add("is-awaiting-action");
  delete composer.dataset.selectedActionChoice;

  const label = composer.querySelector("[data-combat-composer-resource-label]");
  if (label) label.textContent = resource.label;

  const awaiting = composer.querySelector("[data-combat-composer-awaiting]");
  if (awaiting) {
    const movementText = resourceKey === "movement"
      ? "Используй отдельную панель движения: там есть маршрут, стоимость, сетка, коллизии и подтверждение."
      : `Выбран ресурс «${resource.label}». Теперь выбери доступное действие выше.`;
    awaiting.innerHTML = `<strong>${escapeHtml(resource.label)}</strong><span>${escapeHtml(movementText)}</span>`;
  }

  root.querySelectorAll('[data-combat-action="action-template"]').forEach((card) => {
    card.classList.remove("is-active");
    card.setAttribute("aria-pressed", "false");
  });

  const live = root.querySelector("[data-combat-action-live]");
  if (live) live.textContent = resourceKey === "movement"
    ? "Движение выбрано. Открой панель движения и укажи маршрут."
    : `${resource.label}: выбери конкретное действие.`;
}

function focusExternalMovementPanel(root) {
  const panel = document.querySelector(".master-runtime-movement-panel");
  const live = root.querySelector("[data-combat-action-live]");
  if (!panel) {
    if (live) live.textContent = "Панель движения не найдена. Открой правую колонку Master Room.";
    return;
  }
  panel.classList.remove("is-combat-focus-flash");
  void panel.offsetWidth;
  panel.classList.add("is-combat-focus-flash");
  panel.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  window.setTimeout(() => panel.classList.remove("is-combat-focus-flash"), 1300);
  if (live) live.textContent = "Панель движения открыта: наведи на маршрут, проверь стоимость и подтверди перемещение.";
}


function updateComposerMode(root, modeValue, options = {}) {
  const composer = root.querySelector("[data-combat-composer]");
  if (!composer || composer.dataset.updatingComposerMode === "1") return;
  composer.dataset.updatingComposerMode = "1";
  try {
    const mode = getActionPreset(modeValue).key || String(modeValue || "roll");
    const preset = getActionPreset(mode);
    const modeCopy = ACTION_MODE_COPY[mode] || ACTION_MODE_COPY.roll;
    const explicitResource = String(options.resource || "").trim();
    const selectedResource = explicitResource || String(composer.querySelector('[data-combat-roll-field="turn_resource"]')?.value || preset.resource || "none");

    setRollField(composer, "action_type", mode, { emit: false });
    setRollField(composer, "turn_resource", selectedResource, { emit: false });
    if (preset.eventType) setRollField(composer, "event_type", preset.eventType, { emit: false });

    composer.querySelectorAll("[data-combat-action-mode]").forEach((panel) => {
      panel.hidden = String(panel.dataset.combatActionMode || "") !== mode;
    });

    const summary = composer.querySelector("[data-combat-action-summary]");
    if (summary) summary.innerHTML = `<strong>${escapeHtml(modeCopy.title)}</strong><span>${escapeHtml(modeCopy.hint)}</span>`;
    const resourceLabel = composer.querySelector("[data-combat-composer-resource-label]");
    if (resourceLabel) resourceLabel.textContent = getTurnResourceMeta(selectedResource).label;

    const diceModes = ["attack", "spell", "save", "check", "roll"];
    const damageModes = ["attack", "spell", "damage", "heal"];
    const diceControl = composer.querySelector("[data-combat-dice-control]");
    const modControl = composer.querySelector("[data-combat-mod-control]");
    const damageControl = composer.querySelector("[data-combat-damage-control]");
    const quickDice = composer.querySelector("[data-combat-quick-dice]");
    if (diceControl) diceControl.hidden = !diceModes.includes(mode);
    if (modControl) modControl.hidden = !diceModes.includes(mode);
    if (damageControl) damageControl.hidden = !damageModes.includes(mode);
    if (quickDice) quickDice.hidden = !diceModes.includes(mode);

    const submit = composer.querySelector("[data-combat-submit-label]");
    if (submit) {
      const labels = { attack: "Выполнить атаку", spell: "Наложить заклинание", damage: "Применить урон", heal: "Применить лечение", movement: "Записать движение", save: "Сделать спасбросок", check: "Сделать проверку", effect: "Применить эффект", note: "Записать заметку" };
      submit.textContent = labels[mode] || "Выполнить действие";
    }

    syncActionCardState(root, mode);
    composer.dataset.activeActionMode = mode;
  } finally {
    delete composer.dataset.updatingComposerMode;
  }
}

function rollOneDie(sides = 20) {
  const normalized = Math.max(2, safeNumber(sides, 20));
  return Math.floor(Math.random() * normalized) + 1;
}

function rollDiceExpression(expression = "d20", options = {}) {
  const text = String(expression || "d20").trim().toLowerCase().replace(/\s+/g, "");
  const match = text.match(/^(\d*)d(\d+)(?:([+−-])(\d+))?$/);
  if (!match) {
    const fallback = rollOneDie(20);
    return { dice: text || "d20", rolls: [fallback], modifier: 0, total: fallback, valid: false };
  }
  const count = Math.max(1, Math.min(20, safeNumber(match[1] || 1, 1)));
  const sides = Math.max(2, safeNumber(match[2], 20));
  const sign = match[3] === "-" || match[3] === "−" ? -1 : 1;
  const modifier = match[4] ? sign * safeNumber(match[4], 0) : 0;
  const multiplier = options.critical ? 2 : 1;
  const rolls = Array.from({ length: count * multiplier }, () => rollOneDie(sides));
  return {
    dice: text,
    rolls,
    modifier,
    total: rolls.reduce((sum, value) => sum + value, 0) + modifier,
    valid: true,
    critical: Boolean(options.critical),
  };
}

function formatRollParts(result) {
  if (!result) return "—";
  const rolls = safeArray(result.rolls).join(" + ") || "0";
  const modifier = safeNumber(result.modifier, 0);
  return `${rolls}${modifier ? ` ${modifier > 0 ? "+" : "-"} ${Math.abs(modifier)}` : ""} = ${safeNumber(result.total, 0)}`;
}

function confirmCombatAction(message) {
  if (typeof window === "undefined" || typeof window.confirm !== "function") return true;
  return window.confirm(message);
}

function resolveAttackPayload(payload = {}) {
  const attackBonus = safeNumber(payload.attack_bonus, 0);
  const targetAc = Math.max(0, safeNumber(payload.target_ac, 0));
  const attackRoll = rollDiceExpression("d20");
  const natural = safeNumber(attackRoll.rolls?.[0], 0);
  const attackTotal = natural + attackBonus;
  const naturalMiss = natural === 1;
  const naturalCrit = natural === 20;
  const hasTargetAc = targetAc > 0;
  const hit = !naturalMiss && (naturalCrit || !hasTargetAc || attackTotal >= targetAc);
  const damageRoll = hit && payload.damage_dice ? rollDiceExpression(payload.damage_dice, { critical: naturalCrit }) : null;
  const rawDamageTotal = damageRoll ? Math.max(0, safeNumber(damageRoll.total, 0)) : Math.max(0, safeNumber(payload.damage, 0));
  const damageTraits = applyDamageTraits(rawDamageTotal, payload.damage_type, {
    resistances: payload.target_resistances,
    immunities: payload.target_immunities,
    vulnerabilities: payload.target_vulnerabilities,
  });
  const damageTotal = hit ? damageTraits.total : 0;
  const attackName = displayText(payload.attack_name || payload.reason || "Атака", "Атака");
  const targetText = displayText(payload.target_name, "цель");
  const actorText = displayText(payload.actor_name, "Участник");
  const damageType = displayText(payload.damage_type, "");
  const acText = hasTargetAc ? `КД ${targetAc}` : "КД не задан";
  const outcome = naturalMiss ? "автопромах" : naturalCrit ? "критическое попадание" : hit ? "попадание" : "промах";
  const traitText = damageTraits.reason ? ` → ${damageTotal} (${damageTraits.reason})` : "";
  const damageText = hit && damageRoll
    ? `; урон ${formatRollParts(damageRoll)}${traitText}${damageType ? ` ${damageType}` : ""}${naturalCrit ? " (крит: кости удвоены)" : ""}`
    : hit && rawDamageTotal
      ? `; урон ${rawDamageTotal}${traitText}${damageType ? ` ${damageType}` : ""}`
      : "";
  const reason = `${actorText}: ${attackName} → ${targetText}; d20 ${natural}${attackBonus ? ` ${attackBonus > 0 ? "+" : "-"} ${Math.abs(attackBonus)}` : ""} = ${attackTotal} против ${acText}: ${outcome}${damageText}`;

  return {
    ...payload,
    event_type: "attack",
    dice: `d20${attackBonus ? `${attackBonus > 0 ? "+" : ""}${attackBonus}` : ""}`,
    modifier: attackBonus,
    attack_roll: attackRoll,
    attack_total: attackTotal,
    natural_roll: natural,
    target_ac: targetAc,
    hit,
    critical: naturalCrit,
    outcome,
    damage_roll: damageRoll,
    full_damage: rawDamageTotal,
    damage: damageTotal,
    damage_type: damageType,
    damage_adjustment: damageTraits.reason,
    concentration_check: resolveConcentrationAfterDamage(payload, damageTotal),
    reason,
  };
}

function resolveSpellAttackPayload(payload = {}) {
  const mode = String(payload.spell_mode || "").trim().toLowerCase();
  if (mode !== "attack") return payload;
  const spellName = displayText(payload.spell_name || payload.reason || "Заклинание", "Заклинание");
  return resolveAttackPayload({
    ...payload,
    event_type: "spell",
    action_type: "spell",
    attack_name: spellName,
    attack_bonus: safeNumber(payload.spell_attack_bonus ?? payload.attack_bonus, 0),
    damage_dice: payload.damage_dice || parseAttackFromText(payload.spell_effect || "", spellName).damage_dice || "",
    damage_type: payload.damage_type || normalizeDamageType(payload.spell_effect || ""),
  });
}


function rollD20WithMode(modeValue = "normal") {
  const mode = String(modeValue || "normal").toLowerCase();
  const first = rollOneDie(20);
  if (!['advantage', 'disadvantage'].includes(mode)) return { mode: 'normal', rolls: [first], natural: first };
  const second = rollOneDie(20);
  const natural = mode === 'advantage' ? Math.max(first, second) : Math.min(first, second);
  return { mode, rolls: [first, second], natural };
}

function resolveConcentrationAfterDamage(payload, damage) {
  if (!payload.target_concentrating || damage <= 0) return null;
  const dc = Math.max(10, Math.floor(damage / 2));
  const modifier = safeNumber(payload.target_con_save_modifier ?? payload.target_save_modifier, 0);
  const roll = rollD20WithMode('normal');
  const total = roll.natural + modifier;
  return {
    required: true,
    dc,
    modifier,
    rolls: roll.rolls,
    natural: roll.natural,
    total,
    success: total >= dc,
  };
}

function resolveSpellSavePayload(payload = {}) {
  const dc = Math.max(0, safeNumber(payload.save_dc, 0));
  const ability = normalizeAbilityKey(payload.spell_save_ability || payload.ability, 'dex');
  const modifier = safeNumber(payload.target_save_modifier, 0);
  const saveRoll = rollD20WithMode(payload.save_roll_mode || 'normal');
  const saveTotal = saveRoll.natural + modifier;
  const success = dc > 0 ? saveTotal >= dc : false;
  const hasSharedDamage = payload.full_damage_override !== undefined && payload.full_damage_override !== null;
  const rawDamage = hasSharedDamage ? null : payload.damage_dice
    ? rollDiceExpression(payload.damage_dice)
    : null;
  const fullDamage = hasSharedDamage
    ? Math.max(0, safeNumber(payload.full_damage_override, 0))
    : rawDamage ? Math.max(0, safeNumber(rawDamage.total, 0)) : Math.max(0, safeNumber(payload.damage, 0));
  const successRule = ['half', 'none', 'full'].includes(payload.spell_save_result) ? payload.spell_save_result : 'none';
  const afterSave = success
    ? successRule === 'half'
      ? Math.floor(fullDamage / 2)
      : successRule === 'full'
        ? fullDamage
        : 0
    : fullDamage;
  const damageTraits = applyDamageTraits(afterSave, payload.damage_type, {
    resistances: payload.target_resistances,
    immunities: payload.target_immunities,
    vulnerabilities: payload.target_vulnerabilities,
  });
  const finalDamage = damageTraits.total;
  const spellName = displayText(payload.spell_name || payload.reason, 'Заклинание');
  const actor = displayText(payload.actor_name, 'Участник');
  const target = displayText(payload.target_name, 'цель');
  const modeText = saveRoll.mode === 'advantage' ? ' с преимуществом' : saveRoll.mode === 'disadvantage' ? ' с помехой' : '';
  const rollsText = saveRoll.rolls.join(' / ');
  const successText = success ? 'успех' : 'провал';
  const damageRollText = payload.shared_damage_text || (rawDamage ? formatRollParts(rawDamage) : String(fullDamage || 0));
  const saveDamageText = fullDamage > 0
    ? `; урон ${damageRollText}${success ? successRule === 'half' ? ` → половина ${afterSave}` : successRule === 'none' ? ' → 0' : ` → ${afterSave}` : ''}${damageTraits.reason ? ` → ${finalDamage} (${damageTraits.reason})` : ''}${payload.damage_type ? ` ${payload.damage_type}` : ''}`
    : '';
  const reason = `${actor}: ${spellName} → ${target}; спасбросок ${getAbilityLabel(ability)}${modeText}: d20 ${rollsText}${modifier ? ` ${modifier > 0 ? '+' : '-'} ${Math.abs(modifier)}` : ''} = ${saveTotal} против Сл ${dc}: ${successText}${saveDamageText}`;
  const concentrationCheck = resolveConcentrationAfterDamage({
    ...payload,
    target_con_save_modifier: safeNumber(payload.target_con_save_modifier ?? (ability === 'con' ? modifier : 0), 0),
  }, finalDamage);
  return {
    ...payload,
    event_type: 'spell',
    action_type: 'spell',
    spell_mode: 'save',
    save_ability: ability,
    save_modifier: modifier,
    save_roll: saveRoll,
    save_total: saveTotal,
    save_success: success,
    outcome: success ? 'успешный спасбросок' : 'провал спасброска',
    roll_total: saveTotal,
    modifier,
    dice: `d20${modifier ? `${modifier > 0 ? '+' : ''}${modifier}` : ''}`,
    full_damage: fullDamage,
    damage_before_traits: afterSave,
    damage_roll: rawDamage,
    damage: finalDamage,
    damage_adjustment: damageTraits.reason,
    concentration_check: concentrationCheck,
    reason,
  };
}


function normalizePayloadTarget(target = {}, payload = {}) {
  return {
    ...payload,
    target_entry_id: target.entry_id,
    target_name: target.name,
    target_ac: target.ac,
    target_save_modifier: target.save_modifier,
    target_con_save_modifier: target.con_save_modifier,
    target_resistances: target.resistances,
    target_immunities: target.immunities,
    target_vulnerabilities: target.vulnerabilities,
    target_concentrating: target.concentrating,
  };
}

function resolveSpellSaveMultiPayload(payload = {}) {
  const targets = safeArray(payload.multi_targets).slice(0, Math.max(1, safeNumber(payload.spell_max_targets, 99)));
  const sharedRoll = payload.damage_dice ? rollDiceExpression(payload.damage_dice) : null;
  const sharedDamage = sharedRoll ? Math.max(0, safeNumber(sharedRoll.total, 0)) : Math.max(0, safeNumber(payload.damage, 0));
  const sharedText = sharedRoll ? formatRollParts(sharedRoll) : String(sharedDamage || 0);
  const results = targets.map((target) => resolveSpellSavePayload({
    ...normalizePayloadTarget(target, payload),
    full_damage_override: sharedDamage,
    shared_damage_text: sharedText,
  }));
  const actor = displayText(payload.actor_name, "Участник");
  const spellName = displayText(payload.spell_name || payload.reason, "Заклинание");
  const compact = results.map((result) => `${result.target_name}: ${result.save_success ? "успех" : "провал"}${result.damage > 0 ? `, ${result.damage} урона` : ", без урона"}`).join("; ");
  return {
    ...payload,
    event_type: "spell",
    action_type: "spell",
    target_entry_id: results[0]?.target_entry_id || payload.target_entry_id,
    target_name: results.map((item) => item.target_name).join(", "),
    target_results: results,
    full_damage: sharedDamage,
    damage_roll: sharedRoll,
    damage: results.reduce((sum, item) => sum + Math.max(0, safeNumber(item.damage, 0)), 0),
    outcome: `${results.filter((item) => !item.save_success).length} провалили, ${results.filter((item) => item.save_success).length} спаслись`,
    reason: `${actor}: ${spellName}; область ${payload.spell_area_shape || "radius"}${payload.spell_area_size ? ` ${payload.spell_area_size} фт.` : ""}; общий бросок урона ${sharedText}; ${compact}`,
    skip_roll: true,
  };
}

function invokeResolvedSpellSaveMulti(callbacks, payload) {
  const resolved = resolveSpellSaveMultiPayload(payload);
  if (!resolved.target_results.length) {
    window.alert("Выбери хотя бы одну цель для области заклинания.");
    return;
  }
  const lines = resolved.target_results.map((item) => `${item.target_name}: ${item.save_success ? "успех" : "провал"}${item.damage ? ` → ${item.damage} урона` : " → 0"}`);
  if (!confirmCombatAction(`Подтвердить заклинание по ${resolved.target_results.length} целям?\n\n${resolved.spell_name || "Заклинание"}\n${lines.join("\n")}`)) return;

  if (resolved.turn_resource && resolved.turn_resource !== "none" && resolved.entry_id) {
    invoke(callbacks, "onSpendTurnResource", { entryId: resolved.entry_id, resource: resolved.turn_resource, actionType: "spell", amount: 1 });
  }
  resolved.target_results.forEach((item) => {
    if (item.target_entry_id && item.damage > 0) invoke(callbacks, "onDamage", { entryId: item.target_entry_id, delta: item.damage, damageType: item.damage_type });
    if (item.concentration_check) invoke(callbacks, "onConcentrationCheck", { entryId: item.target_entry_id, ...item.concentration_check, source: "damage", damage: item.damage });
  });
  invoke(callbacks, "onRoll", {
    ...resolved,
    summary: resolved.reason,
    description: resolved.reason,
    confirmed: true,
    skip_confirm: true,
    skip_roll: true,
  });
}

function invokeResolvedMultiSpellAttack(callbacks, payload) {
  const targets = safeArray(payload.multi_targets).slice(0, Math.max(1, safeNumber(payload.spell_max_targets, 99)));
  const results = targets.map((target) => resolveSpellAttackPayload(normalizePayloadTarget(target, payload)));
  if (!results.length) {
    window.alert("Выбери хотя бы одну цель.");
    return;
  }
  const lines = results.map((item) => `${item.target_name}: ${item.hit ? item.critical ? "крит" : "попадание" : "промах"}${item.damage ? ` → ${item.damage} урона` : ""}`);
  if (!confirmCombatAction(`Подтвердить атаки заклинанием по ${results.length} целям?\n\n${lines.join("\n")}`)) return;
  if (payload.turn_resource && payload.turn_resource !== "none" && payload.entry_id) invoke(callbacks, "onSpendTurnResource", { entryId: payload.entry_id, resource: payload.turn_resource, actionType: "spell", amount: 1 });
  results.forEach((item) => {
    if (item.hit && item.target_entry_id && item.damage > 0) invoke(callbacks, "onDamage", { entryId: item.target_entry_id, delta: item.damage, damageType: item.damage_type });
    if (item.concentration_check) invoke(callbacks, "onConcentrationCheck", { entryId: item.target_entry_id, ...item.concentration_check, source: "damage", damage: item.damage });
  });
  const reason = `${payload.actor_name || "Участник"}: ${payload.spell_name || "Заклинание"}; ${lines.join("; ")}`;
  invoke(callbacks, "onRoll", {
    ...payload,
    event_type: "spell",
    action_type: "spell",
    target_entry_id: results[0]?.target_entry_id || null,
    target_name: results.map((item) => item.target_name).join(", "),
    target_results: results,
    damage: results.reduce((sum, item) => sum + Math.max(0, safeNumber(item.damage, 0)), 0),
    outcome: `${results.filter((item) => item.hit).length}/${results.length} попаданий`,
    reason,
    summary: reason,
    description: reason,
    confirmed: true,
    skip_confirm: true,
    skip_roll: true,
  });
}

function invokeResolvedSpellSave(callbacks, payload) {
  const resolved = resolveSpellSavePayload(payload);
  const concentrationText = resolved.concentration_check
    ? `\nКонцентрация цели: ${resolved.concentration_check.total} против Сл ${resolved.concentration_check.dc} — ${resolved.concentration_check.success ? 'сохранена' : 'сорвана'}`
    : '';
  if (!confirmCombatAction(`Подтвердить заклинание со спасброском?\n\n${resolved.reason}${concentrationText}`)) return;

  if (resolved.turn_resource && resolved.turn_resource !== 'none' && resolved.entry_id) {
    invoke(callbacks, 'onSpendTurnResource', {
      entryId: resolved.entry_id,
      resource: resolved.turn_resource,
      actionType: 'spell',
      amount: 1,
    });
  }
  if (resolved.target_entry_id && resolved.damage > 0) {
    invoke(callbacks, 'onDamage', { entryId: resolved.target_entry_id, delta: resolved.damage, damageType: resolved.damage_type });
  }
  if (resolved.concentration_check) {
    invoke(callbacks, 'onConcentrationCheck', {
      entryId: resolved.target_entry_id,
      ...resolved.concentration_check,
      source: 'damage',
      damage: resolved.damage,
    });
  }
  invoke(callbacks, 'onRoll', {
    ...resolved,
    summary: resolved.reason,
    description: resolved.reason,
    skip_confirm: true,
    confirmed: true,
    skip_roll: true,
  });
}

function invokeResolvedAttack(callbacks, payload) {
  const resolved = payload.event_type === "spell" && String(payload.spell_mode || "").toLowerCase() === "attack"
    ? resolveSpellAttackPayload(payload)
    : resolveAttackPayload(payload);
  const confirmText = `Подтвердить ${resolved.event_type === "spell" ? "атаку заклинанием" : "атаку"}?\n\n${resolved.reason}`;
  if (!confirmCombatAction(confirmText)) return;

  if (resolved.turn_resource && resolved.turn_resource !== "none" && resolved.entry_id) {
    invoke(callbacks, "onSpendTurnResource", {
      entryId: resolved.entry_id,
      resource: resolved.turn_resource,
      actionType: resolved.action_type || resolved.event_type,
      amount: 1,
    });
  }

  if (resolved.hit && resolved.target_entry_id && resolved.damage > 0) {
    invoke(callbacks, "onDamage", { entryId: resolved.target_entry_id, delta: resolved.damage, damageType: resolved.damage_type });
  }
  if (resolved.concentration_check) {
    invoke(callbacks, "onConcentrationCheck", {
      entryId: resolved.target_entry_id,
      ...resolved.concentration_check,
      source: "damage",
      damage: resolved.damage,
    });
  }

  invoke(callbacks, "onRoll", {
    ...resolved,
    event_type: resolved.event_type,
    type: resolved.event_type,
    summary: resolved.reason,
    description: resolved.reason,
    reason: resolved.reason,
    skip_confirm: true,
    confirmed: true,
    skip_roll: true,
  });
}

function bindAttackPresetControls(root) {
  const composer = root.querySelector("[data-combat-composer]");
  if (!composer || composer.dataset.boundAttackPresets === "1") return;
  composer.dataset.boundAttackPresets = "1";
  composer.querySelectorAll('[data-combat-roll-field="attack_preset"]').forEach((select) => {
    select.addEventListener("change", () => {
      const option = select.options?.[select.selectedIndex];
      if (!option) return;
      const name = option.dataset.attackName || "";
      const bonus = option.dataset.attackBonus || "0";
      const damageDice = option.dataset.damageDice || "";
      const damageType = option.dataset.damageType || "";
      if (name) setRollField(composer, "attack_name", name);
      setRollField(composer, "attack_bonus", bonus);
      if (damageDice) setRollField(composer, "damage_dice", damageDice);
      if (damageType) setRollField(composer, "damage_type", damageType);
      setRollField(composer, "reason", name || "Атака");
    });
  });
}

function applySpellPreset(root, select) {
  const composer = root.querySelector("[data-combat-composer]");
  const option = select?.options?.[select.selectedIndex];
  if (!composer || !option || !option.dataset.spellName) return false;
  const data = option.dataset;
  setRollField(composer, "spell_id", data.spellId || "", { emit: false });
  setRollField(composer, "spell_name", data.spellName || "", { emit: false });
  setRollField(composer, "spell_level", data.spellLevel || "0", { emit: false });
  setRollField(composer, "spell_resource", data.spellResource || "action", { emit: false });
  setRollField(composer, "spell_mode", data.spellMode || "effect", { emit: false });
  setRollField(composer, "spell_range", data.spellRange || "", { emit: false });
  setRollField(composer, "spell_duration", data.spellDuration || "", { emit: false });
  setRollField(composer, "spell_activation", data.spellActivation || "", { emit: false });
  setRollField(composer, "spell_effect", data.spellEffect || "", { emit: false });
  setRollField(composer, "damage_dice", data.spellDamageDice || "", { emit: false });
  setRollField(composer, "damage_type", data.spellDamageType || "", { emit: false });
  setRollField(composer, "spell_attack_bonus", data.spellAttackBonus || "0", { emit: false });
  setRollField(composer, "save_dc", data.spellSaveDc || "0", { emit: false });
  setRollField(composer, "spell_save_ability", data.spellSaveAbility || "dex", { emit: false });
  setRollField(composer, "spell_save_result", data.spellSaveResult || "none", { emit: false });
  setRollField(composer, "spell_concentration", data.spellConcentration === "1" ? "1" : "0", { emit: false });
  setRollField(composer, "spell_area_shape", data.spellAreaShape || "single", { emit: false });
  setRollField(composer, "spell_area_size", data.spellAreaSize || "0", { emit: false });
  setRollField(composer, "spell_max_targets", data.spellMaxTargets || "1", { emit: false });
  setRollField(composer, "turn_resource", data.spellResource || "action", { emit: false });
  setRollField(composer, "reason", data.spellName || "Заклинание", { emit: false });
  const meta = composer.querySelector("[data-combat-spell-meta]");
  if (meta) {
    const parts = [data.spellActivation || getTurnResourceMeta(data.spellResource || "action").label, data.spellRange || "дальность не указана", data.spellDuration || ""];
    if (data.spellConcentration === "1") parts.push("концентрация");
    const remaining = Number(data.spellSlotRemaining);
    if (Number.isFinite(remaining) && remaining !== Infinity && Number(data.spellLevel || 0) > 0) parts.push(`ячеек осталось: ${remaining}`);
    meta.textContent = parts.filter(Boolean).join(" • ");
  }
  updateComposerMode(root, "spell", { resource: data.spellResource || "action" });
  return true;
}

function selectAttackById(root, attackId, fallback = {}) {
  const composer = root.querySelector("[data-combat-composer]");
  const select = composer?.querySelector('[data-combat-roll-field="attack_preset"]');
  if (!composer) return false;
  const id = String(attackId || "").trim();
  if (select && id) {
    const index = Array.from(select.options || []).findIndex((option) => String(option.dataset.attackId || option.value || "") === id);
    if (index >= 0) {
      select.selectedIndex = index;
      const option = select.options[index];
      setRollField(composer, "attack_name", option.dataset.attackName || fallback.name || "Атака", { emit: false });
      setRollField(composer, "attack_bonus", option.dataset.attackBonus || fallback.bonus || "0", { emit: false });
      setRollField(composer, "damage_dice", option.dataset.damageDice || fallback.damageDice || "", { emit: false });
      setRollField(composer, "damage_type", option.dataset.damageType || fallback.damageType || "", { emit: false });
      setRollField(composer, "reason", option.dataset.attackName || fallback.name || "Атака", { emit: false });
      return true;
    }
  }
  setRollField(composer, "attack_name", fallback.name || "Атака", { emit: false });
  setRollField(composer, "attack_bonus", fallback.bonus ?? "0", { emit: false });
  setRollField(composer, "damage_dice", fallback.damageDice || "", { emit: false });
  setRollField(composer, "damage_type", fallback.damageType || "", { emit: false });
  setRollField(composer, "reason", fallback.name || "Атака", { emit: false });
  return Boolean(fallback.name || fallback.damageDice);
}

function selectSpellById(root, spellId, resourceKey = "action") {
  const select = root.querySelector('[data-combat-roll-field="spell_preset"]');
  if (!select?.options?.length) return false;
  const id = String(spellId || "").trim();
  const resource = String(resourceKey || "action");
  let index = -1;
  if (id) index = Array.from(select.options).findIndex((option) => String(option.dataset.spellId || option.value || "") === id);
  if (index < 0) index = Array.from(select.options).findIndex((option) => option.dataset.spellResource === resource && option.dataset.spellName);
  if (index < 0) return false;
  select.selectedIndex = index;
  return applySpellPreset(root, select);
}

function selectFirstSpellForResource(root, resourceKey) {
  const select = root.querySelector('[data-combat-roll-field="spell_preset"]');
  if (!select?.options?.length) return false;
  const key = String(resourceKey || "action");
  const index = Array.from(select.options).findIndex((option) => option.dataset.spellResource === key && option.dataset.spellName);
  if (index < 0) return false;
  select.selectedIndex = index;
  return applySpellPreset(root, select);
}

function bindSpellPresetControls(root) {
  const composer = root.querySelector("[data-combat-composer]");
  if (!composer || composer.dataset.boundSpellPresets === "1") return;
  composer.dataset.boundSpellPresets = "1";
  composer.querySelectorAll('[data-combat-roll-field="spell_preset"]').forEach((select) => {
    select.addEventListener("change", () => applySpellPreset(root, select));
    const activeMode = String(composer.querySelector('[data-combat-roll-field="action_type"]')?.value || "attack");
    if (activeMode === "spell" && select.options?.[select.selectedIndex]?.dataset?.spellName) applySpellPreset(root, select);
  });
}

function bindComposerModeControls(root) {
  const composer = root.querySelector("[data-combat-composer]");
  if (!composer || composer.dataset.boundComposerMode === "1") return;
  composer.dataset.boundComposerMode = "1";

  const eventSelect = composer.querySelector('[data-combat-roll-field="event_type"]');
  eventSelect?.addEventListener("change", () => {
    if (composer.dataset.updatingComposerMode === "1") return;
    const preset = getActionPreset(eventSelect.value);
    updateComposerMode(root, preset.key || eventSelect.value, { resource: preset.resource || "none" });
  });

  const actionType = composer.querySelector('[data-combat-roll-field="action_type"]')?.value || "attack";
  updateComposerMode(root, actionType);
}

function handleCombatAction(root, control, callbacks = {}) {
  const action = String(control.dataset.combatAction || "").trim();
  const entryId = String(control.dataset.combatEntryId || "").trim();

  if (action === "next-turn" || action === "end-turn") {
    invoke(callbacks, "onNextTurn", {
      nextIndex: Math.max(0, safeNumber(control.dataset.combatNextIndex, 0)),
      roundDelta: Math.max(0, safeNumber(control.dataset.combatRoundDelta, 0)),
      skippedIds: String(control.dataset.combatSkippedIds || "").split(",").filter(Boolean),
    });
    return;
  }
  if (action === "focus-turn") {
    invoke(callbacks, "onFocusTurn", { turnIndex: Math.max(0, safeNumber(control.dataset.combatTurnIndex, 0)) });
    return;
  }
  if (action === "log-filter") {
    invoke(callbacks, "onLogFilter", { filter: String(control.dataset.combatLogFilter || "all").trim() || "all" });
    return;
  }
  if (action === "toggle-secondary") {
    invoke(callbacks, "onToggleSecondary", {});
    return;
  }
  if (action === "quick-die") {
    const die = String(control.dataset.combatDie || "d20").trim() || "d20";
    setRollField(root, "dice", die, { emit: false });
    invoke(callbacks, "onRoll", { ...getRollPayload(root), dice: die, event_type: "roll", reason: "Быстрый бросок" });
    return;
  }
  if (action === "resource-tab") {
    const resource = String(control.dataset.combatResourceKey || "action").trim() || "action";
    syncResourcePickerState(root, resource);
    setRollField(root, "turn_resource", resource, { emit: false });
    setComposerAwaitingAction(root, resource);
    if (resource === "movement") focusExternalMovementPanel(root);
    return;
  }
  if (action === "focus-movement") {
    syncResourcePickerState(root, "movement");
    setRollField(root, "turn_resource", "movement", { emit: false });
    setComposerAwaitingAction(root, "movement");
    focusExternalMovementPanel(root);
    return;
  }
  if (action === "action-template") {
    const actionType = String(control.dataset.combatTemplateAction || control.dataset.combatTemplateEvent || "roll");
    const resource = String(control.dataset.combatTemplateResource || getActionResource(actionType) || "none");
    if (!isResourceReadyInPicker(root, resource)) {
      window.alert(`${getTurnResourceMeta(resource).label} уже потрачено.`);
      return;
    }
    setRollField(root, "action_type", actionType, { emit: false });
    setRollField(root, "event_type", String(control.dataset.combatTemplateEvent || "roll"), { emit: false });
    setRollField(root, "turn_resource", resource, { emit: false });
    setRollField(root, "dice", String(control.dataset.combatTemplateDice || "d20"), { emit: false });
    setRollField(root, "reason", String(control.dataset.combatTemplateReason || ""), { emit: false });
    const composer = root.querySelector("[data-combat-composer]");
    if (composer) {
      composer.classList.remove("is-awaiting-action");
      composer.dataset.selectedActionChoice = String(control.dataset.combatTemplateLabel || control.dataset.combatTemplateReason || control.textContent || actionType).trim();
    }
    if (control.dataset.combatTemplateEffectName) setRollField(root, "effect_name", control.dataset.combatTemplateEffectName, { emit: false });
    if (control.dataset.combatTemplateMovementType) setRollField(root, "movement_type", control.dataset.combatTemplateMovementType, { emit: false });
    if (resource !== "none") syncResourcePickerState(root, resource);
    updateComposerMode(root, actionType, { resource });
    if (actionType === "attack") {
      selectAttackById(root, control.dataset.combatTemplateAttackId, {
        name: control.dataset.combatTemplateAttackName || control.dataset.combatTemplateLabel || "Атака",
        bonus: control.dataset.combatTemplateAttackBonus || "0",
        damageDice: control.dataset.combatTemplateDamageDice || "",
        damageType: control.dataset.combatTemplateDamageType || "",
      });
    }
    if (actionType === "spell") {
      selectSpellById(root, control.dataset.combatTemplateSpellId, control.dataset.combatTemplateSpellResource || resource);
    }

    if (composer) {
      composer.classList.remove("is-action-selected");
      void composer.offsetWidth;
      composer.classList.add("is-action-selected");
    }
    root.dispatchEvent(new CustomEvent("combat:action-selected", { bubbles: true, detail: { actionType, eventType: String(control.dataset.combatTemplateEvent || "roll"), resource } }));
    return;
  }
  if (action === "multi-target-team") {
    const team = String(control.dataset.combatTargetTeam || "");
    root.querySelectorAll("[data-combat-multi-target-row]").forEach((row) => {
      const input = row.querySelector("[data-combat-multi-target-checkbox]");
      if (!input) return;
      input.checked = String(row.dataset.targetTeam || "") === team;
      row.classList.toggle("is-selected", input.checked);
    });
    updateMultiTargetCount(root);
    return;
  }
  if (action === "multi-target-clear") {
    root.querySelectorAll("[data-combat-multi-target-checkbox]").forEach((input) => { input.checked = false; input.closest("[data-combat-multi-target-row]")?.classList.remove("is-selected"); });
    updateMultiTargetCount(root);
    return;
  }
  if (action === "roll") {
    const payload = getRollPayload(root);
    if (!isResourceReadyInPicker(root, payload.turn_resource)) {
      window.alert(`${getTurnResourceMeta(payload.turn_resource).label} уже потрачено. Заверши ход или выбери другой доступный ресурс.`);
      return;
    }
    const spellSelect = root.querySelector('[data-combat-roll-field="spell_preset"]');
    const spellOption = spellSelect?.options?.[spellSelect.selectedIndex];
    if (payload.event_type === "spell" && payload.spell_level > 0 && spellOption && Number(spellOption.dataset.spellSlotRemaining) <= 0) {
      window.alert(`Нет свободных ячеек ${payload.spell_level} круга.`);
      return;
    }
    const spellTargets = safeArray(payload.multi_targets);
    if (payload.event_type === "spell" && String(payload.spell_mode || "").toLowerCase() === "save") {
      if (spellTargets.length > 1 || (payload.spell_area_shape && payload.spell_area_shape !== "single")) {
        if (!spellTargets.length) { window.alert("Для области заклинания выбери хотя бы одну цель."); return; }
        invokeResolvedSpellSaveMulti(callbacks, payload);
        return;
      }
      if (!payload.target_entry_id && !spellTargets.length) {
        window.alert("Для заклинания со спасброском выбери цель.");
        return;
      }
      if (!payload.target_entry_id && spellTargets[0]) {
        Object.assign(payload, normalizePayloadTarget(spellTargets[0], payload));
      }
      if (safeNumber(payload.save_dc, 0) <= 0) {
        window.alert("У заклинания не задана Сл спасброска.");
        return;
      }
      invokeResolvedSpellSave(callbacks, payload);
      return;
    }
    if (payload.event_type === "spell" && String(payload.spell_mode || "").toLowerCase() === "attack" && spellTargets.length > 1) {
      invokeResolvedMultiSpellAttack(callbacks, payload);
      return;
    }
    if (payload.event_type === "attack" || (payload.event_type === "spell" && String(payload.spell_mode || "").toLowerCase() === "attack")) {
      if (!payload.target_entry_id && spellTargets[0]) Object.assign(payload, normalizePayloadTarget(spellTargets[0], payload));
      invokeResolvedAttack(callbacks, payload);
      return;
    }
    if (payload.event_type === "damage" && payload.target_entry_id && payload.damage > 0) {
      invoke(callbacks, "onDamage", { entryId: payload.target_entry_id, delta: payload.damage });
    }
    if (payload.event_type === "heal" && payload.target_entry_id && payload.damage > 0) {
      invoke(callbacks, "onHeal", { entryId: payload.target_entry_id, delta: payload.damage });
    }
    if (payload.turn_resource && payload.turn_resource !== "none" && payload.entry_id) {
      invoke(callbacks, "onSpendTurnResource", {
        entryId: payload.entry_id,
        resource: payload.turn_resource,
        actionType: payload.action_type || payload.event_type,
        amount: payload.turn_resource === "movement" ? safeNumber(payload.movement_cost, 0) : 1,
      });
    }
    invoke(callbacks, "onRoll", payload);
    return;
  }
  if (action === "damage") {
    invoke(callbacks, "onDamage", { entryId, delta: getDelta(root, entryId) });
    return;
  }
  if (action === "heal") {
    invoke(callbacks, "onHeal", { entryId, delta: getDelta(root, entryId) });
    return;
  }
  if (action === "save-combatant") {
    invoke(callbacks, "onSaveCombatant", { entryId, patch: getCombatantPatch(root, entryId) });
    return;
  }
  if (action === "remove-entry") invoke(callbacks, "onRemoveEntry", { entryId });
}


function updateMultiTargetCount(root) {
  const checked = Array.from(root.querySelectorAll("[data-combat-multi-target-checkbox]:checked"));
  root.querySelectorAll("[data-combat-multi-target-row]").forEach((row) => row.classList.toggle("is-selected", Boolean(row.querySelector("[data-combat-multi-target-checkbox]:checked"))));
  const counter = root.querySelector("[data-combat-target-count]");
  if (counter) counter.textContent = `Выбрано: ${checked.length}`;
  const maxInput = root.querySelector('[data-combat-roll-field="spell_max_targets"]');
  const maxTargets = Math.max(1, safeNumber(maxInput?.value, 99));
  if (checked.length > maxTargets) {
    const overflow = checked.slice(maxTargets);
    overflow.forEach((input) => { input.checked = false; input.closest("[data-combat-multi-target-row]")?.classList.remove("is-selected"); });
    if (counter) counter.textContent = `Выбрано: ${maxTargets} (лимит)`;
  }
}

function bindMultiTargetControls(root) {
  if (!root || root.dataset.boundMultiTargets === "1") return;
  root.dataset.boundMultiTargets = "1";
  root.addEventListener("change", (event) => {
    const input = event.target?.closest?.("[data-combat-multi-target-checkbox]");
    if (!input) return;
    updateMultiTargetCount(root);
  });
  updateMultiTargetCount(root);
}

export function bindCombatModule(root, callbacks = {}) {
  if (!root) return;
  bindComposerModeControls(root);
  bindAttackPresetControls(root);
  bindMultiTargetControls(root);
  bindSpellPresetControls(root);

  // Делегирование вместо обработчика на каждой карточке. Это переживает
  // локальные DOM-обновления и гарантирует, что клик по иконке/тексту внутри
  // кнопки попадёт в один и тот же обработчик.
  root.__combatCallbacks = callbacks;
  if (root.dataset.boundCombatDelegation !== "1") {
    root.dataset.boundCombatDelegation = "1";
    root.addEventListener("click", (event) => {
      const control = event.target instanceof Element ? event.target.closest("[data-combat-action]") : null;
      if (!control || !root.contains(control)) return;
      event.preventDefault();
      handleCombatAction(root, control, root.__combatCallbacks || {});
    });
  }

  const actionType = root.querySelector('[data-combat-roll-field="action_type"]')?.value || "attack";
  const resource = root.querySelector('[data-combat-roll-field="turn_resource"]')?.value || "action";
  syncResourcePickerState(root, resource);
  syncActionCardState(root, actionType);
}

export function mountCombatModule(root, options = {}) {
  if (!root) return;
  root.innerHTML = renderCombatModule(options);
  bindCombatModule(root, options.callbacks || {});
}
