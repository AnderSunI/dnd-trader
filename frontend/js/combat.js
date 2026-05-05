// ============================================================
// frontend/js/combat.js
// Battle UI renderer for Master Room.
// Owns only the combat surface; cabinet.js keeps API/data wiring.
// Round 29: reference battle screen + action composer + log journal.
// ============================================================

import {
  escapeHtml,
  formatTime,
  safeArray,
  safeNumber,
  safeText,
} from "./shared.js";

export const COMBAT_MODULE_VERSION = "combat-v3-round32-density";

const DICE_PRESETS = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];

const LOG_FILTERS = [
  { key: "all", label: "Все" },
  { key: "combat", label: "Бой" },
  { key: "dice", label: "Кубы" },
  { key: "effect", label: "Эффекты" },
  { key: "system", label: "Система" },
];

const ACTION_PRESETS = [
  { key: "attack", label: "Атака", icon: "⚔", eventType: "attack", dice: "d20", reason: "Атака" },
  { key: "spell", label: "Заклинание", icon: "✦", eventType: "attack", dice: "d20", reason: "Атака заклинанием" },
  { key: "damage", label: "Урон", icon: "🔥", eventType: "damage", dice: "1d8", reason: "Урон" },
  { key: "heal", label: "Лечение", icon: "✚", eventType: "heal", dice: "1d8", reason: "Лечение" },
  { key: "save", label: "Спасбросок", icon: "🛡", eventType: "save", dice: "d20", reason: "Спасбросок" },
  { key: "check", label: "Проверка", icon: "◇", eventType: "roll", dice: "d20", reason: "Проверка характеристики" },
  { key: "effect", label: "Эффект", icon: "☄", eventType: "effect", dice: "d20", reason: "Эффект / состояние" },
  { key: "note", label: "Заметка", icon: "✎", eventType: "note", dice: "d20", reason: "Заметка боя" },
];

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
  if (["attack", "damage", "heal", "save", "effect", "roll", "turn", "round", "sync", "spawn", "note"].includes(raw)) {
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

export function normalizeCombatEntry(entry, index = 0) {
  const source = entry && typeof entry === "object" ? entry : {};
  const entryId = resolveEntryId(source, index);
  const entryType = normalizeEntryType(source.entry_type, source.membership_id ? "member" : "enemy");
  const hpMax = Math.max(0, safeNumber(source.hp_max ?? source.max_hp, 0));
  const hpCurrent = Math.max(0, safeNumber(source.hp_current ?? source.hp, hpMax));
  const temporaryHp = Math.max(0, safeNumber(source.temp_hp ?? source.temporary_hp, 0));
  const abilities = normalizeAbilities(source.abilities || source.stats || source.характеристики);

  return {
    entry_id: entryId,
    entry_type: entryType,
    membership_id: String(source.membership_id || ""),
    user_id: String(source.user_id || ""),
    selected_character_id: String(source.selected_character_id || ""),
    name: displayText(source.name, `Участник ${index + 1}`),
    role_in_table: displayText(source.role_in_table, "player"),
    entity_kind: displayText(source.entity_kind || (entryType === "enemy" ? "enemy" : "player"), "player"),
    hp_current: hpMax > 0 ? Math.min(hpCurrent, hpMax) : hpCurrent,
    hp_max: hpMax,
    temp_hp: temporaryHp,
    ac: Math.max(0, safeNumber(source.ac ?? source.armor_class, 0)),
    initiative: safeNumber(source.initiative, 0),
    speed: Math.max(0, safeNumber(source.speed ?? source.walk_speed, 30)),
    status: displayText(source.status, "ready"),
    notes: displayText(source.notes, ""),
    source: displayText(source.source, "table"),
    portrait_url: displayText(source.portrait_url || source.avatar_url, ""),
    level: Math.max(0, safeNumber(source.level, 0)),
    class_name: displayText(source.class_name || source.class, ""),
    race: displayText(source.race || source.species, ""),
    attacks: safeArray(source.attacks || source.actions),
    spells: safeArray(source.spells),
    conditions: safeArray(source.conditions || source.effects || source.statuses),
    abilities,
    resistances: safeArray(source.resistances),
    vulnerabilities: safeArray(source.vulnerabilities),
    immunities: safeArray(source.immunities),
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

function getCurrentTurnEntry(combat) {
  const entries = safeArray(combat?.entries);
  if (!entries.length) return null;
  const index = Math.min(Math.max(0, safeNumber(combat?.turn_index, 0)), entries.length - 1);
  return entries[index] || entries[0] || null;
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
  if (["damage", "attack"].includes(type)) return "combat";
  if (type === "heal") return "heal";
  if (type === "effect") return "effect";
  if (["save", "roll"].includes(type)) return "dice";
  if (["turn", "round", "sync", "spawn"].includes(type)) return "system";
  return "note";
}

function getLogBucket(entry) {
  const tone = getLogTone(entry);
  if (tone === "dice") return "dice";
  if (tone === "effect") return "effect";
  if (["system", "note"].includes(tone)) return "system";
  return "combat";
}

function isLogVisible(entry, filter = "all", hideSecondary = false) {
  const bucket = getLogBucket(entry);
  if (hideSecondary && ["system", "note"].includes(bucket)) return false;
  return filter === "all" || bucket === filter;
}

function getLogIcon(entry) {
  const type = normalizeEventType(entry?.event_type || entry?.type);
  if (type === "attack") return "⚔";
  if (type === "damage") return "🔥";
  if (type === "heal") return "✚";
  if (type === "save") return "🛡";
  if (type === "effect") return "✦";
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
  const currentId = current?.entry_id || "";
  const entries = safeArray(combat.entries);

  if (!entries.length) return `<div class="combat-ref-initiative combat-ref-initiative-empty">Нет участников инициативы.</div>`;

  return `
    <section class="combat-ref-initiative-shell" data-combat-region="initiative">
      <button class="combat-ref-initiative-arrow" type="button" aria-label="Назад" disabled>‹</button>
      <div class="combat-ref-initiative-track">
        ${entries.map((entry, index) => {
          const active = entry.entry_id === currentId;
          const spent = index < safeNumber(combat.turn_index, 0);
          const status = getStatusMeta(entry.status);
          return `
            <button
              type="button"
              class="combat-ref-init-card ${active ? "is-active" : ""} ${spent ? "is-spent" : ""} ${escapeHtml(status.className)}"
              data-combat-action="focus-turn"
              data-combat-turn-index="${escapeHtml(String(index))}"
              ${canManage ? "" : "disabled"}
            >
              <span class="combat-ref-init-portrait">${renderPortrait(entry, "combat-ref-init-portrait")}</span>
              <span class="combat-ref-init-score">${escapeHtml(String(entry.initiative || 0))}</span>
              <span class="combat-ref-init-name">${escapeHtml(clampText(entry.name, 22))}</span>
            </button>
          `;
        }).join("")}
      </div>
      <button class="combat-ref-initiative-arrow" type="button" aria-label="Вперёд" disabled>›</button>
    </section>
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
      ${canManage ? `<button class="btn btn-primary combat-ref-end-turn" type="button" data-combat-action="next-turn">Завершить ход</button>` : `<button class="btn combat-ref-end-turn" type="button" data-combat-action="next-turn">Передать ход</button>`}
    </section>
  `;
}

function renderActionCards() {
  return `
    <section class="combat-ref-actions" data-combat-region="actions">
      <div class="combat-ref-section-head">
        <div>
          <div class="combat-ref-kicker">Действия</div>
          <h4>Что делает участник</h4>
        </div>
      </div>
      <div class="combat-ref-action-grid">
        ${ACTION_PRESETS.map((action) => `
          <button
            class="combat-ref-action-card"
            type="button"
            data-combat-action="action-template"
            data-combat-template-event="${escapeHtml(action.eventType)}"
            data-combat-template-dice="${escapeHtml(action.dice)}"
            data-combat-template-reason="${escapeHtml(action.reason)}"
          >
            <span>${escapeHtml(action.icon)}</span>
            <strong>${escapeHtml(action.label)}</strong>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function renderCombatLog(combat, options) {
  const filter = String(options.logFilter || "all").trim() || "all";
  const hideSecondary = Boolean(options.hideSecondary);
  const log = safeArray(combat.log).filter((entry) => isLogVisible(entry, filter, hideSecondary)).slice(-90).reverse();

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

  return `
    <section class="combat-ref-side-card combat-ref-composer" data-combat-region="composer">
      <div class="combat-ref-section-head">
        <div>
          <div class="combat-ref-kicker">Бросок / действие</div>
          <h4>Карточка действия</h4>
        </div>
      </div>
      <div class="combat-ref-roll-form">
        <label>
          <span>Кто действует</span>
          <select data-combat-roll-field="actor_entry_id">
            <option value="">Система / GM</option>
            ${entries.map((entry) => `<option value="${escapeHtml(entry.entry_id)}" ${entry.entry_id === currentId ? "selected" : ""}>${escapeHtml(entry.name)}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Цель</span>
          <select data-combat-roll-field="target_entry_id">
            <option value="">Без цели</option>
            ${entries.map((entry) => `<option value="${escapeHtml(entry.entry_id)}" ${entry.entry_id === targetId ? "selected" : ""}>${escapeHtml(entry.name)}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Тип</span>
          <select data-combat-roll-field="event_type">
            <option value="roll">Бросок</option>
            <option value="attack">Атака</option>
            <option value="damage">Урон</option>
            <option value="heal">Лечение</option>
            <option value="save">Спасбросок</option>
            <option value="effect">Эффект</option>
            <option value="note">Заметка</option>
          </select>
        </label>
        <div class="combat-ref-roll-inline">
          <label><span>Куб</span><input type="text" value="${escapeHtml(options.diceType || "d20")}" data-combat-roll-field="dice"></label>
          <label><span>Мод.</span><input type="number" value="0" data-combat-roll-field="modifier"></label>
          <label><span>Урон/леч.</span><input type="number" min="0" value="0" data-combat-roll-field="damage"></label>
        </div>
        <label>
          <span>Описание</span>
          <input type="text" placeholder="Например: атака длинным мечом" data-combat-roll-field="reason">
        </label>
        <button class="btn btn-primary combat-ref-roll-submit" type="button" data-combat-action="roll">Бросить / записать</button>
      </div>
      <div class="combat-ref-dice-row">
        ${DICE_PRESETS.map((die) => `<button class="combat-ref-die ${String(options.diceType || "d20") === die ? "is-active" : ""}" type="button" data-combat-action="quick-die" data-combat-die="${escapeHtml(die)}">${escapeHtml(die.toUpperCase())}</button>`).join("")}
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
          return `
            <article class="combat-ref-roster-card ${escapeHtml(status.className)}" data-combat-entry="${escapeHtml(entry.entry_id)}">
              <div class="combat-ref-roster-top">
                <div class="combat-ref-roster-portrait">${renderPortrait(entry, "combat-ref-roster-portrait")}</div>
                <div>
                  <strong>${escapeHtml(entry.name)}</strong>
                  <small>${escapeHtml(getEntityKindLabel(entry))} • ${escapeHtml(status.label)}</small>
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
          ${renderActionCards()}
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

function getRollPayload(root) {
  const read = (field, fallback = "") => {
    const input = root.querySelector(`[data-combat-roll-field="${field}"]`);
    return input ? input.value : fallback;
  };

  return {
    entry_id: String(read("actor_entry_id", "")).trim() || null,
    target_entry_id: String(read("target_entry_id", "")).trim() || null,
    event_type: String(read("event_type", "roll")).trim() || "roll",
    dice: String(read("dice", "d20")).trim() || "d20",
    modifier: safeNumber(read("modifier", 0), 0),
    damage: Math.max(0, safeNumber(read("damage", 0), 0)),
    reason: String(read("reason", "")).trim(),
  };
}

function setRollField(root, field, value) {
  const input = root.querySelector(`[data-combat-roll-field="${field}"]`);
  if (!input) return;
  input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
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

export function bindCombatModule(root, callbacks = {}) {
  if (!root) return;

  root.querySelectorAll("[data-combat-action]").forEach((control) => {
    if (control.dataset.boundCombatAction === "1") return;
    control.dataset.boundCombatAction = "1";

    control.addEventListener("click", () => {
      const action = String(control.dataset.combatAction || "").trim();
      const entryId = String(control.dataset.combatEntryId || "").trim();

      if (action === "next-turn" || action === "end-turn") invoke(callbacks, "onNextTurn", {});
      if (action === "focus-turn") {
        invoke(callbacks, "onFocusTurn", { turnIndex: Math.max(0, safeNumber(control.dataset.combatTurnIndex, 0)) });
      }
      if (action === "log-filter") {
        invoke(callbacks, "onLogFilter", { filter: String(control.dataset.combatLogFilter || "all").trim() || "all" });
      }
      if (action === "toggle-secondary") invoke(callbacks, "onToggleSecondary", {});
      if (action === "quick-die") {
        const die = String(control.dataset.combatDie || "d20").trim() || "d20";
        setRollField(root, "dice", die);
        invoke(callbacks, "onRoll", { ...getRollPayload(root), dice: die, event_type: "roll", reason: "Быстрый бросок" });
      }
      if (action === "action-template") {
        setRollField(root, "event_type", String(control.dataset.combatTemplateEvent || "roll"));
        setRollField(root, "dice", String(control.dataset.combatTemplateDice || "d20"));
        setRollField(root, "reason", String(control.dataset.combatTemplateReason || ""));
      }
      if (action === "roll") invoke(callbacks, "onRoll", getRollPayload(root));
      if (action === "damage") invoke(callbacks, "onDamage", { entryId, delta: getDelta(root, entryId) });
      if (action === "heal") invoke(callbacks, "onHeal", { entryId, delta: getDelta(root, entryId) });
      if (action === "save-combatant") {
        invoke(callbacks, "onSaveCombatant", { entryId, patch: getCombatantPatch(root, entryId) });
      }
      if (action === "remove-entry") invoke(callbacks, "onRemoveEntry", { entryId });
    });
  });
}

export function mountCombatModule(root, options = {}) {
  if (!root) return;
  root.innerHTML = renderCombatModule(options);
  bindCombatModule(root, options.callbacks || {});
}
