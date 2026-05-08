// ============================================================
// frontend/js/quests.js
// Задания / ачивки / чекпоинты / летопись кампании
// - отдельный модуль кабинета
// - local fallback + попытка API
// - фильтры
// - добавление / редактирование / удаление
// - статусы
// - чекпоинты
// - логирование в history.js
// - GM/player режим
// ============================================================

import {
  apiGet,
  apiWrite,
  buildUserScopedStorageKey,
  escapeHtml,
  formatDateTime,
  getCurrentRole,
  getCurrentUser,
  getEl,
  normalizeRole,
  safeText,
  showToast,
  trimText,
  tryParseJson,
} from "./shared.js";

// ------------------------------------------------------------
// 🌐 STATE
// ------------------------------------------------------------
const QUESTS_STATE = {
  loaded: false,
  source: "empty",
  role: "player",
  items: [],
  filters: {
    type: "all",
    status: "all",
    search: "",
  },
  ui: {
    formOpen: false,
    editingId: null,
    selectedId: null,
  },
};

// ------------------------------------------------------------
// 🧰 HELPERS
// ------------------------------------------------------------
function isGm() {
  return QUESTS_STATE.role === "gm";
}

function makeId(prefix = "quest") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeDate(value, fallback = Date.now()) {
  if (!value && value !== 0) return new Date(fallback).toISOString();

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? new Date(fallback).toISOString()
      : date.toISOString();
  }

  const str = String(value).trim();
  if (!str) return new Date(fallback).toISOString();

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();

  return new Date(fallback).toISOString();
}

function parseTags(raw) {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw
      .map((x) => String(x).trim())
      .filter(Boolean);
  }

  return String(raw)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function serializeTags(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .join(", ");
}

function normalizeCheckpoints(raw) {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw
      .map((checkpoint, index) => {
        if (typeof checkpoint === "string") {
          return {
            id: makeId(`cp_${index}`),
            text: checkpoint.trim(),
            done: false,
          };
        }

        if (checkpoint && typeof checkpoint === "object") {
          return {
            id: checkpoint.id || makeId(`cp_${index}`),
            text: safeText(checkpoint.text || checkpoint.title || checkpoint.name, "").trim(),
            done: Boolean(checkpoint.done || checkpoint.completed),
          };
        }

        return null;
      })
      .filter(Boolean)
      .filter((cp) => cp.text);
  }

  return String(raw)
    .split("\n")
    .map((x, index) => ({
      id: makeId(`cp_${index}`),
      text: x.trim(),
      done: false,
    }))
    .filter((cp) => cp.text);
}

function serializeCheckpoints(checkpoints) {
  return (Array.isArray(checkpoints) ? checkpoints : [])
    .map((cp) => String(cp?.text || "").trim())
    .filter(Boolean)
    .join("\n");
}


function normalizeQuestImportList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const candidates = [
    payload.quests,
    payload.items,
    payload.data,
    payload.data?.quests,
    payload.data?.items,
    payload.profile?.quests,
    payload.profile?.data?.quests,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function getQuestUpdatedTime(item) {
  const time = new Date(item?.updated_at || item?.updatedAt || item?.created_at || item?.createdAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function mergeQuestCollections(primary = [], secondary = []) {
  const byId = new Map();

  [...normalizeQuestList(secondary), ...normalizeQuestList(primary)].forEach((item) => {
    const id = String(item?.id || "").trim() || makeId("quest_merge");
    const previous = byId.get(id);

    if (!previous || getQuestUpdatedTime(item) >= getQuestUpdatedTime(previous)) {
      byId.set(id, {
        ...(previous || {}),
        ...item,
        id,
      });
    }
  });

  return normalizeQuestList(Array.from(byId.values()));
}

function saveLocalBackup(items) {
  try {
    const key = `${getStorageKey()}_backup_${Date.now()}`;
    localStorage.setItem(key, JSON.stringify(items));
    const prefix = `${getStorageKey()}_backup_`;
    const backupKeys = Object.keys(localStorage)
      .filter((entryKey) => entryKey.startsWith(prefix))
      .sort();

    while (backupKeys.length > 5) {
      const oldKey = backupKeys.shift();
      if (oldKey) localStorage.removeItem(oldKey);
    }
  } catch (_) {}
}

function buildAutoCheckpointTexts({ type, title, description } = {}) {
  const normalizedType = safeText(type, "quest").toLowerCase();
  const cleanTitle = safeText(title, "").trim();
  const cleanDescription = safeText(description, "").trim();
  const hasNamedTarget = cleanTitle && cleanTitle !== "Без названия";

  if (normalizedType === "achievement") {
    return [
      "Уточнить условие достижения",
      "Выполнить требование",
      "Зафиксировать результат в журнале",
      "Выдать награду или отметить прогресс",
    ];
  }

  if (normalizedType === "checkpoint") {
    return [
      "Добраться до точки",
      "Проверить обстановку",
      "Отметить результат для партии",
    ];
  }

  if (normalizedType === "chronicle") {
    return [
      "Записать событие",
      "Уточнить последствия для мира или партии",
      "Связать запись с персонажами, локацией или заданием",
    ];
  }

  const targetLine = hasNamedTarget
    ? `Разобраться с задачей: ${cleanTitle}`
    : "Разобраться с задачей";

  const investigationLine = cleanDescription
    ? "Проверить зацепки из описания"
    : "Собрать информацию и зацепки";

  return [
    targetLine,
    investigationLine,
    "Найти ключевого НПС, место или предмет",
    "Принять решение / завершить столкновение",
    "Вернуться за наградой или обновить журнал",
  ];
}

function buildAutoCheckpoints(input = {}) {
  return buildAutoCheckpointTexts(input).map((text, index) => ({
    id: makeId(`cp_auto_${index}`),
    text,
    done: false,
  }));
}

function getQuestFormAutoCheckpoints() {
  const type = safeText(getEl("questFormType")?.value, "quest").toLowerCase();
  const title = safeText(getEl("questFormTitle")?.value, "").trim();
  const description = safeText(getEl("questFormDescription")?.value, "").trim();

  return buildAutoCheckpointTexts({
    type,
    title,
    description,
  });
}

function typeLabel(type) {
  const map = {
    quest: "Задание",
    achievement: "Ачивка",
    checkpoint: "Чекпоинт",
    chronicle: "Летопись",
  };

  return map[type] || "Запись";
}

function statusLabel(status) {
  const map = {
    active: "Активно",
    completed: "Завершено",
    failed: "Провалено",
    hidden: "Скрыто",
  };

  return map[status] || "Активно";
}

function statusClass(status) {
  const map = {
    active: "quality-badge",
    completed: "quality-badge rarity-uncommon",
    failed: "quality-badge rarity-artifact",
    hidden: "quality-badge rarity-common",
  };

  return map[status] || "quality-badge";
}

function typeIcon(type) {
  const map = {
    quest: "🧭",
    achievement: "🏆",
    checkpoint: "📍",
    chronicle: "📜",
  };

  return map[type] || "📜";
}

function getStorageKey() {
  return buildUserScopedStorageKey("dnd_trader_quests_");
}

function saveLocal(items) {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(items));
  } catch (_) {}
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) return null;
    const parsed = tryParseJson(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeQuestItem(item, index = 0) {
  if (!item || typeof item !== "object") {
    return {
      id: makeId(`quest_${index}`),
      type: "chronicle",
      title: "Запись",
      description: safeText(item, ""),
      reward: "",
      status: "active",
      tags: [],
      author: "",
      checkpoints: [],
      created_at: normalizeDate(Date.now() - index * 1000),
      updated_at: normalizeDate(Date.now() - index * 1000),
    };
  }

  const type = safeText(item.type || item.kind || item.entry_type, "quest")
    .toLowerCase()
    .trim();

  const status = safeText(item.status || item.state, "active")
    .toLowerCase()
    .trim();

  return {
    id: item.id || item._id || item.uuid || makeId(`quest_${index}`),
    type: ["quest", "achievement", "checkpoint", "chronicle"].includes(type)
      ? type
      : "quest",
    title: safeText(item.title || item.name || item.quest_name, "Без названия"),
    description: safeText(item.description || item.text || item.content || item.summary, ""),
    reward: safeText(item.reward, ""),
    status: ["active", "completed", "failed", "hidden"].includes(status)
      ? status
      : "active",
    tags: parseTags(item.tags),
    author: safeText(item.author || item.actor || item.created_by, ""),
    checkpoints: normalizeCheckpoints(item.checkpoints),
    created_at: normalizeDate(item.created_at || item.createdAt || item.date || item.timestamp),
    updated_at: normalizeDate(item.updated_at || item.updatedAt || item.date || item.timestamp),
  };
}

function normalizeQuestList(list) {
  return (Array.isArray(list) ? list : [])
    .map((item, index) => normalizeQuestItem(item, index))
    .sort((a, b) => {
      const ta = new Date(a.updated_at).getTime();
      const tb = new Date(b.updated_at).getTime();
      return tb - ta;
    });
}

function buildSearchBlob(item) {
  return [
    item.title,
    item.description,
    item.reward,
    item.author,
    item.type,
    item.status,
    ...(item.tags || []),
    ...(item.checkpoints || []).map((cp) => cp.text),
  ]
    .join(" ")
    .toLowerCase();
}

function getQuestById(questId) {
  return QUESTS_STATE.items.find((item) => item.id === questId) || null;
}

function closeQuestForm() {
  QUESTS_STATE.ui.formOpen = false;
  QUESTS_STATE.ui.editingId = null;
}

function openCreateQuestForm() {
  QUESTS_STATE.ui.formOpen = true;
  QUESTS_STATE.ui.editingId = null;
}

function openEditQuestForm(questId) {
  QUESTS_STATE.ui.formOpen = true;
  QUESTS_STATE.ui.editingId = questId;
}

function getEditingQuest() {
  return QUESTS_STATE.ui.editingId
    ? getQuestById(QUESTS_STATE.ui.editingId)
    : null;
}

function emitQuestHistory(event) {
  const detail = {
    scope: "quests",
    created_at: new Date().toISOString(),
    ...event,
  };

  try {
    window.dispatchEvent(
      new CustomEvent("dnd:history:add", {
        detail,
      })
    );
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

function setItemsAndKeepSort(items) {
  QUESTS_STATE.items = normalizeQuestList(items);
}

function patchQuest(questId, patchFn) {
  let changed = null;

  const nextItems = QUESTS_STATE.items.map((item) => {
    if (item.id !== questId) return item;

    changed = normalizeQuestItem(
      {
        ...patchFn(item),
        updated_at: new Date().toISOString(),
      },
      0
    );

    return changed;
  });

  setItemsAndKeepSort(nextItems);
  return changed;
}

// ------------------------------------------------------------
// 📥 LOAD
// ------------------------------------------------------------
function tryLoadFromWindow() {
  const candidates = [
    window.__QUESTS_DATA__,
    window.__questsData,
    window.__PLAYER_QUESTS__,
    window.__playerQuests,
  ];

  for (const candidate of candidates) {
    if (candidate) return candidate;
  }

  return null;
}

export async function loadQuests() {
  QUESTS_STATE.role = getCurrentRole();

  const apiData = await apiGet("/player/quests");
  const localData = loadLocal();
  const windowData = tryLoadFromWindow();

  const apiItems = normalizeQuestImportList(apiData);
  const localItems = normalizeQuestImportList(localData);
  const windowItems = normalizeQuestImportList(windowData);

  let source = "empty";
  let items = [];

  if (apiItems.length && localItems.length) {
    items = mergeQuestCollections(apiItems, localItems);
    source = "api+local";
  } else if (apiItems.length) {
    items = normalizeQuestList(apiItems);
    source = "api";
  } else if (localItems.length) {
    items = normalizeQuestList(localItems);
    source = apiData ? "local-preserved" : "local";
  } else if (windowItems.length) {
    items = normalizeQuestList(windowItems);
    source = "window";
  } else {
    items = [];
    source = apiData ? "api-empty" : "empty";
  }

  QUESTS_STATE.items = normalizeQuestList(items);
  QUESTS_STATE.loaded = true;
  QUESTS_STATE.source = QUESTS_STATE.items.length ? source : "empty";

  if (QUESTS_STATE.items.length) {
    saveLocal(QUESTS_STATE.items);
  }

  renderQuests();
  return QUESTS_STATE.items;
}

// ------------------------------------------------------------
// 💾 SAVE
// ------------------------------------------------------------
export async function saveQuests(options = {}) {
  const {
    allowEmpty = false,
    silent = false,
  } = options || {};

  const safeItems = normalizeQuestList(QUESTS_STATE.items);
  QUESTS_STATE.items = safeItems;

  saveLocalBackup(safeItems);
  saveLocal(safeItems);

  const payload = {
    quests: safeItems,
    merge: false,
    allow_empty: Boolean(allowEmpty),
    client_updated_at: new Date().toISOString(),
  };

  const result = await apiWrite(
    "/player/quests",
    payload,
    ["POST", "PUT", "PATCH"]
  );

  if (!result) {
    QUESTS_STATE.source = "local";
    if (!silent) {
      showToast("Сервер заданий не ответил — сохранено локально");
    }
    return false;
  }

  const serverItems = normalizeQuestImportList(result);
  if (serverItems.length || safeItems.length === 0) {
    QUESTS_STATE.items = normalizeQuestList(serverItems);
    saveLocal(QUESTS_STATE.items);
  }

  QUESTS_STATE.source = "api";
  return true;
}

// ------------------------------------------------------------
// ➕ CRUD
// ------------------------------------------------------------
export async function addQuestEntry(entry) {
  const normalized = normalizeQuestItem({
    ...entry,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  setItemsAndKeepSort([normalized, ...QUESTS_STATE.items]);

  await saveQuests({ silent: true });
  renderQuests();

  emitQuestHistory({
    type: "quest_create",
    action: "quest_create",
    title: `Добавлена запись: ${normalized.title}`,
    message: normalized.description || `${typeLabel(normalized.type)} создана`,
    quest_name: normalized.title,
    status: normalized.status,
    reward: normalized.reward,
  });

  showToast("Запись добавлена");
  return normalized;
}

export async function updateQuestEntry(questId, patch) {
  const prev = getQuestById(questId);
  if (!prev) return null;

  const changed = patchQuest(questId, (item) => ({
    ...item,
    ...patch,
  }));

  await saveQuests({ silent: true });
  renderQuests();

  if (changed) {
    emitQuestHistory({
      type: "quest_update",
      action: "quest_update",
      title: `Обновлена запись: ${changed.title}`,
      message: changed.description || "Данные записи изменены",
      quest_name: changed.title,
      status: changed.status,
      reward: changed.reward,
      previous_status: prev.status,
    });

    showToast("Запись обновлена");
  }

  return changed;
}

export async function deleteQuestEntry(questId) {
  const quest = getQuestById(questId);

  setItemsAndKeepSort(QUESTS_STATE.items.filter((item) => item.id !== questId));

  if (QUESTS_STATE.ui.editingId === questId) {
    closeQuestForm();
  }

  await saveQuests({ allowEmpty: QUESTS_STATE.items.length === 0, silent: true });
  renderQuests();

  if (quest) {
    emitQuestHistory({
      type: "quest_delete",
      action: "quest_delete",
      title: `Удалена запись: ${quest.title}`,
      message: quest.description || "Запись удалена",
      quest_name: quest.title,
      status: quest.status,
      reward: quest.reward,
    });
  }

  showToast("Запись удалена");
}

export async function updateQuestStatus(questId, nextStatus) {
  const prev = getQuestById(questId);
  if (!prev) return null;

  const changed = patchQuest(questId, (item) => ({
    ...item,
    status: nextStatus,
  }));

  await saveQuests({ silent: true });
  renderQuests();

  if (changed) {
    emitQuestHistory({
      type: "quest_status",
      action: "quest_status",
      title: `Статус записи: ${changed.title}`,
      message: `${statusLabel(prev.status)} → ${statusLabel(changed.status)}`,
      quest_name: changed.title,
      status: changed.status,
      previous_status: prev.status,
    });

    showToast("Статус обновлён");
  }

  return changed;
}

export async function toggleCheckpoint(questId, checkpointId) {
  const current = getQuestById(questId);
  if (!current) return null;

  let changedCheckpoint = null;

  const changed = patchQuest(questId, (item) => {
    const checkpoints = item.checkpoints.map((cp) => {
      if (cp.id !== checkpointId) return cp;

      changedCheckpoint = {
        ...cp,
        done: !cp.done,
      };

      return changedCheckpoint;
    });

    return {
      ...item,
      checkpoints,
    };
  });

  await saveQuests();
  renderQuests();

  if (changed && changedCheckpoint) {
    emitQuestHistory({
      type: "quest_checkpoint",
      action: "quest_checkpoint",
      title: `Чекпоинт обновлён: ${changed.title}`,
      message: `${changedCheckpoint.done ? "Выполнен" : "Снят"} чекпоинт: ${changedCheckpoint.text}`,
      quest_name: changed.title,
      status: changed.status,
      checkpoint: changedCheckpoint.text,
    });

    showToast("Чекпоинт обновлён");
  }

  return changed;
}

// legacy alias
export async function markQuestAsCompleted(questId) {
  await updateQuestStatus(questId, "completed");
}

// ------------------------------------------------------------
// 🔎 FILTERS
// ------------------------------------------------------------
function getFilteredItems() {
  const search = String(QUESTS_STATE.filters.search || "").trim().toLowerCase();
  const type = QUESTS_STATE.filters.type || "all";
  const status = QUESTS_STATE.filters.status || "all";

  return QUESTS_STATE.items.filter((item) => {
    const typeOk = type === "all" ? true : item.type === type;
    const statusOk = status === "all" ? true : item.status === status;
    const searchOk = search ? buildSearchBlob(item).includes(search) : true;

    return typeOk && statusOk && searchOk;
  });
}

function getSummary(items) {
  return {
    total: items.length,
    active: items.filter((item) => item.status === "active").length,
    completed: items.filter((item) => item.status === "completed").length,
    failed: items.filter((item) => item.status === "failed").length,
    hidden: items.filter((item) => item.status === "hidden").length,
  };
}


function statusTone(status) {
  const raw = safeText(status, "active").toLowerCase();
  if (raw === "completed") return "success";
  if (raw === "failed") return "danger";
  if (raw === "hidden") return "muted";
  return "active";
}

function typeTone(type) {
  const raw = safeText(type, "quest").toLowerCase();
  if (raw === "achievement") return "gold";
  if (raw === "checkpoint") return "cyan";
  if (raw === "chronicle") return "violet";
  return "quest";
}

function getQuestProgress(item) {
  const checkpoints = Array.isArray(item?.checkpoints) ? item.checkpoints : [];
  if (!checkpoints.length) {
    const status = safeText(item?.status, "active").toLowerCase();
    return {
      total: 0,
      done: status === "completed" ? 1 : 0,
      percent: status === "completed" ? 100 : status === "failed" ? 100 : 0,
      label: statusLabel(status),
    };
  }

  const done = checkpoints.filter((cp) => Boolean(cp?.done)).length;
  const total = checkpoints.length;
  const percent = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  return {
    total,
    done,
    percent,
    label: `${done}/${total}`,
  };
}

function getHeroQuest(items = []) {
  const list = Array.isArray(items) ? items : [];
  return (
    list.find((item) => item.status === "active") ||
    list.find((item) => item.status !== "hidden") ||
    list[0] ||
    null
  );
}

function getSelectedQuest(items = QUESTS_STATE.items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;

  const selected = QUESTS_STATE.ui.selectedId
    ? list.find((item) => String(item.id) === String(QUESTS_STATE.ui.selectedId))
    : null;

  return selected || getHeroQuest(list);
}

function ensureSelectedQuest(items = QUESTS_STATE.items) {
  const selected = getSelectedQuest(items);
  QUESTS_STATE.ui.selectedId = selected?.id || null;
  return selected;
}

function selectQuestEntry(questId) {
  QUESTS_STATE.ui.selectedId = questId || null;
}

function getQuestGoals(item) {
  const checkpoints = Array.isArray(item?.checkpoints) ? item.checkpoints : [];
  if (checkpoints.length) return checkpoints;
  const description = safeText(item?.description, "").trim();
  if (!description) return [];
  return description
    .split(/[.;\n\r]+/)
    .map((part, index) => ({
      id: `${item.id || "quest"}_goal_${index}`,
      text: part.trim(),
      done: false,
    }))
    .filter((goal) => goal.text)
    .slice(0, 4);
}

function renderQuestMetric(label, value, tone = "default") {
  return `
    <div class="quest-ref-metric quest-ref-metric-${escapeHtml(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `;
}

function renderQuestArtwork(item, variant = "card") {
  const title = safeText(item?.title, "Задание");
  const type = safeText(item?.type, "quest");
  const icon = typeIcon(type);
  const image = safeText(item?.image || item?.cover || item?.art || item?.thumbnail || "", "").trim();
  const style = image ? ` style="background-image:url('${escapeHtml(image)}')"` : "";

  return `
    <div class="quest-ref-art quest-ref-art-${escapeHtml(variant)} ${image ? "has-image" : "is-placeholder"}"${style} aria-label="Иллюстрация: ${escapeHtml(title)}">
      <div class="quest-ref-art-overlay"></div>
      <div class="quest-ref-art-icon">${escapeHtml(icon)}</div>
      <span>${escapeHtml(typeLabel(type))}</span>
    </div>
  `;
}

// ------------------------------------------------------------
// 🎨 RENDER HELPERS
// ------------------------------------------------------------
function renderSummaryBar(items) {
  const summary = getSummary(items);
  const heroQuest = getSelectedQuest(items) || getHeroQuest(items);
  const heroProgress = getQuestProgress(heroQuest || {});
  const heroTitle = heroQuest?.title || "Задания и летопись";
  const heroDescription = heroQuest?.description || "Задания, ачивки, чекпоинты и хроника партии внутри кабинета.";

  return `
    <section class="quest-ref-hero quest-ref-hero-v39 cabinet-block" data-cabinet-always-open="1">
      <div class="quest-ref-hero-main">
        <div class="quest-ref-kicker">Журнал заданий</div>
        <h2>Задания</h2>
        <p>${escapeHtml(heroDescription)}</p>
        <div class="quest-ref-hero-meta quest-ref-hero-meta-v39">
          <span class="quest-ref-pill quest-ref-pill-source">Источник: ${escapeHtml(QUESTS_STATE.source)}</span>
          <span class="quest-ref-pill quest-ref-pill-role">Роль: ${escapeHtml(QUESTS_STATE.role)}</span>
          ${isGm()
            ? `<button class="btn btn-primary quest-ref-create-main" type="button" id="questsHeroCreateBtn">＋ Создать</button>`
            : `<span class="quest-ref-pill quest-ref-pill-locked">Создание: GM-only</span>`}
        </div>
      </div>

      <div class="quest-ref-metrics quest-ref-metrics-v39" aria-label="Сводка заданий">
        ${renderQuestMetric("Всего", summary.total, "default")}
        ${renderQuestMetric("Активные", summary.active, "active")}
        ${renderQuestMetric("Завершено", summary.completed, "success")}
        ${renderQuestMetric("Провалено", summary.failed, "danger")}
        ${renderQuestMetric("Скрыто", summary.hidden, "muted")}
      </div>

      <aside class="quest-ref-hero-card quest-ref-active-card quest-ref-active-card-v39">
        <div class="quest-ref-card-kicker">Активная запись</div>
        <h3>${escapeHtml(heroTitle)}</h3>
        <div class="quest-ref-progress-line">
          <span style="width:${escapeHtml(String(heroProgress.percent))}%"></span>
        </div>
        <div class="quest-ref-progress-meta">
          <span>${escapeHtml(heroQuest ? typeLabel(heroQuest.type) : "Нет записей")}</span>
          <strong>${escapeHtml(heroProgress.label)}</strong>
        </div>
      </aside>
    </section>
  `;
}


function renderFilters() {
  const summary = getSummary(QUESTS_STATE.items);
  const statusTabs = [
    ["all", "Все", summary.total, "◈"],
    ["active", "Активные", summary.active, "✦"],
    ["completed", "Завершённые", summary.completed, "✓"],
    ["failed", "Проваленные", summary.failed, "!"],
    ["hidden", "Архив", summary.hidden, "◇"],
  ];

  return `
    <section class="quest-ref-toolbar quest-ref-toolbar-v39 cabinet-block" data-cabinet-always-open="1">
      <div class="quest-ref-toolbar-head quest-ref-toolbar-head-v39">
        <div>
          <div class="quest-ref-kicker">Поиск и фильтры</div>
          <h3>Журнал заданий</h3>
        </div>
        <div class="quest-ref-toolbar-actions">
          ${isGm()
            ? `<button class="btn btn-primary" type="button" id="questsToggleFormBtn">${QUESTS_STATE.ui.formOpen ? "Скрыть форму" : "＋ Новая запись"}</button>`
            : `<span class="quest-ref-gm-note">Создание только для ГМа</span>`}
          <button class="btn" type="button" id="questsRefreshBtn">Обновить</button>
        </div>
      </div>

      <div class="quest-ref-filter-grid quest-ref-filter-grid-v39">
        <label class="filter-group quest-ref-filter-field quest-ref-filter-search">
          <span>Поиск</span>
          <input id="questsSearchInput" type="text" placeholder="Название, тег, награда..." value="${escapeHtml(QUESTS_STATE.filters.search)}" />
        </label>

        <label class="filter-group quest-ref-filter-field">
          <span>Тип</span>
          <select id="questsTypeFilter">
            <option value="all" ${QUESTS_STATE.filters.type === "all" ? "selected" : ""}>Все типы</option>
            <option value="quest" ${QUESTS_STATE.filters.type === "quest" ? "selected" : ""}>Задания</option>
            <option value="achievement" ${QUESTS_STATE.filters.type === "achievement" ? "selected" : ""}>Ачивки</option>
            <option value="checkpoint" ${QUESTS_STATE.filters.type === "checkpoint" ? "selected" : ""}>Чекпоинты</option>
            <option value="chronicle" ${QUESTS_STATE.filters.type === "chronicle" ? "selected" : ""}>Летопись</option>
          </select>
        </label>

        <label class="filter-group quest-ref-filter-field">
          <span>Статус</span>
          <select id="questsStatusFilter">
            <option value="all" ${QUESTS_STATE.filters.status === "all" ? "selected" : ""}>Все</option>
            <option value="active" ${QUESTS_STATE.filters.status === "active" ? "selected" : ""}>Активно</option>
            <option value="completed" ${QUESTS_STATE.filters.status === "completed" ? "selected" : ""}>Завершено</option>
            <option value="failed" ${QUESTS_STATE.filters.status === "failed" ? "selected" : ""}>Провалено</option>
            <option value="hidden" ${QUESTS_STATE.filters.status === "hidden" ? "selected" : ""}>Скрыто</option>
          </select>
        </label>
      </div>

      <div class="quest-ref-status-tabs quest-ref-status-tabs-v39" role="tablist" aria-label="Статусы заданий">
        ${statusTabs.map(([key, label, count, icon]) => `
          <button
            type="button"
            class="quest-ref-status-tab ${QUESTS_STATE.filters.status === key ? "active" : ""}"
            data-quest-status-filter="${escapeHtml(key)}"
          >
            <span>${escapeHtml(icon)}</span>
            <strong>${escapeHtml(label)}</strong>
            <em>${escapeHtml(String(count))}</em>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}


function renderForm() {
  if (!isGm()) return "";

  const editing = getEditingQuest();
  const isEditing = Boolean(editing);

  const item = editing || {
    type: "quest",
    status: "active",
    title: "",
    reward: "",
    tags: [],
    description: "",
    checkpoints: [],
  };

  return `
    <section class="quest-ref-form cabinet-block" id="questsCreateBlock" data-cabinet-always-open="1" data-cabinet-no-disclosure="1" ${QUESTS_STATE.ui.formOpen ? "" : "hidden"}>
      <div class="quest-ref-form-head">
        <div>
          <div class="quest-ref-kicker">GM editor</div>
          <h3>${isEditing ? "Редактирование записи" : "Новая запись"}</h3>
          <p class="muted">Создание и правка записей остаются доступными только ГМу.</p>
        </div>
        ${isEditing ? `<span class="quest-ref-pill">Редактируется: ${escapeHtml(item.title)}</span>` : `<span class="quest-ref-pill">Новая запись</span>`}
      </div>

      <div class="quest-ref-form-grid">
        <label class="filter-group">
          <span>Тип</span>
          <select id="questFormType">
            <option value="quest" ${item.type === "quest" ? "selected" : ""}>Задание</option>
            <option value="achievement" ${item.type === "achievement" ? "selected" : ""}>Ачивка</option>
            <option value="checkpoint" ${item.type === "checkpoint" ? "selected" : ""}>Чекпоинт</option>
            <option value="chronicle" ${item.type === "chronicle" ? "selected" : ""}>Летопись</option>
          </select>
        </label>

        <label class="filter-group">
          <span>Статус</span>
          <select id="questFormStatus">
            <option value="active" ${item.status === "active" ? "selected" : ""}>Активно</option>
            <option value="completed" ${item.status === "completed" ? "selected" : ""}>Завершено</option>
            <option value="failed" ${item.status === "failed" ? "selected" : ""}>Провалено</option>
            <option value="hidden" ${item.status === "hidden" ? "selected" : ""}>Скрыто</option>
          </select>
        </label>

        <label class="filter-group quest-ref-form-wide">
          <span>Название</span>
          <input id="questFormTitle" type="text" placeholder="Название записи" value="${escapeHtml(item.title)}" />
        </label>

        <label class="filter-group">
          <span>Награда</span>
          <input id="questFormReward" type="text" placeholder="Награда / результат" value="${escapeHtml(item.reward)}" />
        </label>

        <label class="filter-group">
          <span>Теги</span>
          <input id="questFormTags" type="text" placeholder="через запятую" value="${escapeHtml(serializeTags(item.tags))}" />
        </label>

        <label class="filter-group quest-ref-form-full">
          <span>Описание</span>
          <textarea id="questFormDescription" rows="5" placeholder="Что произошло, зачем это важно, что изменилось...">${escapeHtml(item.description)}</textarea>
        </label>

        <label class="filter-group quest-ref-form-full quest-ref-checkpoint-builder">
          <span>Чекпоинты / подзадачи</span>
          <textarea id="questFormCheckpoints" rows="4" placeholder="Найти след&#10;Поговорить с НПС&#10;Вернуться в лагерь">${escapeHtml(serializeCheckpoints(item.checkpoints))}</textarea>
          <div class="quest-ref-checkpoint-builder-actions">
            <button class="btn btn-secondary" type="button" id="questFormGenerateCheckpointsBtn">✨ Автоэтапы как в BG3</button>
            <small>Если оставить поле пустым, этапы создадутся автоматически при сохранении.</small>
          </div>
        </label>
      </div>

      <div class="quest-ref-form-actions">
        <button class="btn btn-success" type="button" id="questFormSaveBtn">${isEditing ? "Сохранить изменения" : "Сохранить"}</button>
        <button class="btn" type="button" id="questFormCancelBtn">Скрыть</button>
      </div>
    </section>
  `;
}

function renderCheckpoints(item) {
  if (!item.checkpoints?.length) return "";

  const progress = getQuestProgress(item);

  return `
    <div class="quest-ref-checkpoints">
      <div class="quest-ref-checkpoints-head">
        <span>Чекпоинты</span>
        <strong>${escapeHtml(progress.label)}</strong>
      </div>
      <div class="quest-ref-progress-line quest-ref-progress-line-small">
        <span style="width:${escapeHtml(String(progress.percent))}%"></span>
      </div>
      <div class="quest-ref-checkpoint-list">
        ${item.checkpoints
          .map(
            (cp) => `
              <label class="quest-ref-checkpoint ${cp.done ? "quest-ref-checkpoint-done" : ""}">
                <input
                  type="checkbox"
                  class="quest-checkpoint-toggle"
                  data-quest-id="${escapeHtml(item.id)}"
                  data-checkpoint-id="${escapeHtml(cp.id)}"
                  ${cp.done ? "checked" : ""}
                />
                <span>${escapeHtml(cp.text)}</span>
              </label>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderQuestCard(item) {
  const progress = getQuestProgress(item);
  const tone = statusTone(item.status);
  const kind = typeTone(item.type);
  const selected = String(QUESTS_STATE.ui.selectedId || "") === String(item.id);

  return `
    <article
      class="quest-ref-card quest-ref-card-v39 quest-ref-card-${escapeHtml(tone)} quest-ref-kind-${escapeHtml(kind)} ${selected ? "quest-ref-card-selected" : ""}"
      data-quest-id="${escapeHtml(item.id)}"
      data-quest-select="${escapeHtml(item.id)}"
    >
      ${renderQuestArtwork(item, "card")}

      <div class="quest-ref-card-main">
        <div class="quest-ref-card-topline">
          <div class="quest-ref-card-titleblock">
            <div class="quest-ref-card-kicker">${escapeHtml(typeLabel(item.type))}</div>
            <h3>${escapeHtml(item.title)}</h3>
          </div>
          <span class="quest-ref-status quest-ref-status-${escapeHtml(tone)}">${escapeHtml(statusLabel(item.status))}</span>
        </div>

        <p class="quest-ref-card-description">${escapeHtml(item.description || "Описание отсутствует.")}</p>

        <div class="quest-ref-card-meta quest-ref-card-meta-v39">
          ${item.reward ? `<span>Награда: ${escapeHtml(item.reward)}</span>` : ""}
          ${item.author ? `<span>Автор: ${escapeHtml(item.author)}</span>` : ""}
          <span>Этап: ${escapeHtml(progress.label)}</span>
        </div>
      </div>

      <aside class="quest-ref-card-side quest-ref-card-side-v39">
        <div class="quest-ref-card-progress-inline">
          <div class="quest-ref-progress-line quest-ref-progress-line-small">
            <span style="width:${escapeHtml(String(progress.percent))}%"></span>
          </div>
          <strong>${escapeHtml(String(progress.percent))}%</strong>
        </div>
        <span class="quest-ref-card-date">${escapeHtml(formatDateTime(item.updated_at || item.created_at))}</span>
        ${isGm() ? `<button class="btn quest-ref-card-mini-edit" type="button" data-quest-edit="${escapeHtml(item.id)}">Редакт.</button>` : ""}
      </aside>
    </article>
  `;
}


function renderQuestDetailPanel(item) {
  if (!item) {
    return `
      <aside class="quest-ref-detail quest-ref-detail-v39 cabinet-block" data-cabinet-always-open="1" data-cabinet-no-disclosure="1">
        <div class="quest-ref-detail-empty">
          <div class="quest-ref-empty-icon">◇</div>
          <div>
            <div class="quest-ref-kicker">Активная запись</div>
            <h3>Нет выбранного задания</h3>
            <p>${isGm() ? "Создай первую запись, и здесь появятся цели, этапы и награды." : "Когда ГМ создаст записи, здесь появятся детали выбранного задания."}</p>
          </div>
        </div>
      </aside>
    `;
  }

  const progress = getQuestProgress(item);
  const goals = getQuestGoals(item);
  const tone = statusTone(item.status);

  return `
    <aside class="quest-ref-detail quest-ref-detail-v39 cabinet-block quest-ref-detail-${escapeHtml(tone)}" data-cabinet-always-open="1" data-cabinet-no-disclosure="1">
      ${renderQuestArtwork(item, "detail")}

      <div class="quest-ref-detail-hero">
        <div>
          <div class="quest-ref-kicker">${escapeHtml(typeLabel(item.type))}</div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.description || "Описание отсутствует.")}</p>
        </div>
        <span class="quest-ref-status quest-ref-status-${escapeHtml(tone)}">${escapeHtml(statusLabel(item.status))}</span>
      </div>

      <div class="quest-ref-detail-tags">
        ${item.reward ? `<span>Награда: ${escapeHtml(item.reward)}</span>` : ""}
        ${item.author ? `<span>Автор: ${escapeHtml(item.author)}</span>` : ""}
        <span>Обновлено: ${escapeHtml(formatDateTime(item.updated_at || item.created_at))}</span>
      </div>

      <div class="quest-ref-detail-grid quest-ref-detail-grid-v39">
        <section class="quest-ref-detail-card">
          <h4>Цели задания</h4>
          ${goals.length
            ? `<div class="quest-ref-detail-goals">${goals.map((goal) => `
                <label class="quest-ref-detail-goal ${goal.done ? "done" : ""}">
                  ${Array.isArray(item.checkpoints) && item.checkpoints.some((cp) => cp.id === goal.id)
                    ? `<input type="checkbox" class="quest-checkpoint-toggle" data-quest-id="${escapeHtml(item.id)}" data-checkpoint-id="${escapeHtml(goal.id)}" ${goal.done ? "checked" : ""} />`
                    : `<span class="quest-ref-detail-goal-dot">${goal.done ? "✓" : "○"}</span>`}
                  <span>${escapeHtml(goal.text)}</span>
                </label>
              `).join("")}</div>`
            : `<p class="muted">Цели ещё не описаны.</p>`}
        </section>

        <section class="quest-ref-detail-card quest-ref-stage-card">
          <h4>Этап выполнения</h4>
          <div class="quest-ref-detail-progress-value">${escapeHtml(progress.label)}</div>
          <div class="quest-ref-progress-line"><span style="width:${escapeHtml(String(progress.percent))}%"></span></div>
          <div class="muted">Прогресс: ${escapeHtml(String(progress.percent))}%</div>
        </section>
      </div>

      ${item.tags?.length ? `<div class="quest-ref-detail-tags quest-ref-detail-tags-bottom">${item.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}

      <div class="quest-ref-detail-actions">
        ${isGm()
          ? `
            <button class="btn" type="button" data-quest-edit="${escapeHtml(item.id)}">Редактировать</button>
            <button class="btn quest-status-btn" type="button" data-quest-id="${escapeHtml(item.id)}" data-next-status="active">Активно</button>
            <button class="btn quest-status-btn" type="button" data-quest-id="${escapeHtml(item.id)}" data-next-status="completed">Завершить</button>
            <button class="btn quest-status-btn" type="button" data-quest-id="${escapeHtml(item.id)}" data-next-status="failed">Провалить</button>
            <button class="btn quest-status-btn" type="button" data-quest-id="${escapeHtml(item.id)}" data-next-status="hidden">В архив</button>
            <button class="btn btn-danger quest-delete-btn" type="button" data-quest-id="${escapeHtml(item.id)}">Удалить</button>
          `
          : `<span class="quest-ref-gm-note">Редактирование доступно только ГМу</span>`}
      </div>
    </aside>
  `;
}


function renderEmptyState() {
  return `
    <section class="quest-ref-empty cabinet-block">
      <div class="quest-ref-empty-icon">◇</div>
      <div>
        <div class="quest-ref-kicker">Пустой журнал</div>
        <h3>Задания и летопись пока не заполнены</h3>
        <p>${isGm() ? "Нажми «＋ Новая запись» сверху, чтобы создать первое задание, ачивку или хронику." : "Ты сейчас в роли игрока. Создание записей доступно только ГМу; когда ГМ добавит задания, они появятся здесь."}</p>
        ${isGm()
          ? `<button class="btn btn-primary" type="button" id="questsEmptyCreateBtn">＋ Создать первую запись</button>`
          : `<span class="quest-ref-pill quest-ref-pill-locked">Создание: GM-only</span>`}
      </div>
    </section>
  `;
}

// ------------------------------------------------------------
// 🧱 MAIN RENDER
// ------------------------------------------------------------
export function renderQuests() {
  const container = getEl("cabinet-quests");
  if (!container) return;

  if (!QUESTS_STATE.loaded) {
    container.innerHTML = `
      <div class="quest-ref-shell quest-ref-loading">
        <section class="quest-ref-empty cabinet-block">
          <div class="quest-ref-empty-icon">◇</div>
          <div>
            <div class="quest-ref-kicker">Загрузка</div>
            <h3>Задания</h3>
            <p>Модуль ещё не загружен.</p>
          </div>
        </section>
      </div>
    `;
    return;
  }

  const filtered = getFilteredItems();
  const selected = ensureSelectedQuest(filtered.length ? filtered : QUESTS_STATE.items);

  container.innerHTML = `
    <div class="quest-ref-shell quest-ref-shell-reference quest-ref-v39 quest-ref-v41 quest-ref-round94" data-quest-source="${escapeHtml(QUESTS_STATE.source)}" data-quest-role="${escapeHtml(QUESTS_STATE.role)}">
      ${renderSummaryBar(QUESTS_STATE.items)}
      ${renderFilters()}
      ${renderForm()}
      <div class="quest-ref-workspace" data-cabinet-always-open="1" data-cabinet-no-disclosure="1">
        <main class="quest-ref-list-panel quest-ref-list-panel-round94">
          ${filtered.length ? `<div class="quest-ref-list">${filtered.map(renderQuestCard).join("")}</div>` : renderEmptyState()}
        </main>
        ${renderQuestDetailPanel(filtered.length ? getSelectedQuest(filtered) : selected)}
      </div>
    </div>
  `;

  bindQuestActions();
}

// ------------------------------------------------------------
// 🎛 ACTIONS
// ------------------------------------------------------------
function bindQuestActions() {
  const searchInput = getEl("questsSearchInput");
  const typeFilter = getEl("questsTypeFilter");
  const statusFilter = getEl("questsStatusFilter");
  const refreshBtn = getEl("questsRefreshBtn");
  const toggleFormBtn = getEl("questsToggleFormBtn");
  const heroCreateBtn = getEl("questsHeroCreateBtn");
  const emptyCreateBtn = getEl("questsEmptyCreateBtn");
  const saveBtn = getEl("questFormSaveBtn");
  const cancelBtn = getEl("questFormCancelBtn");
  const generateCheckpointsBtn = getEl("questFormGenerateCheckpointsBtn");

  if (searchInput && searchInput.dataset.boundQuestSearch !== "1") {
    searchInput.dataset.boundQuestSearch = "1";
    searchInput.addEventListener("input", () => {
      QUESTS_STATE.filters.search = searchInput.value || "";
      renderQuests();
    });
  }

  if (typeFilter && typeFilter.dataset.boundQuestType !== "1") {
    typeFilter.dataset.boundQuestType = "1";
    typeFilter.addEventListener("change", () => {
      QUESTS_STATE.filters.type = typeFilter.value || "all";
      renderQuests();
    });
  }

  if (statusFilter && statusFilter.dataset.boundQuestStatus !== "1") {
    statusFilter.dataset.boundQuestStatus = "1";
    statusFilter.addEventListener("change", () => {
      QUESTS_STATE.filters.status = statusFilter.value || "all";
      renderQuests();
    });
  }

  if (refreshBtn && refreshBtn.dataset.boundQuestRefresh !== "1") {
    refreshBtn.dataset.boundQuestRefresh = "1";
    refreshBtn.addEventListener("click", async () => {
      await loadQuests();
      showToast("Задания обновлены");
    });
  }

  if (toggleFormBtn && toggleFormBtn.dataset.boundQuestFormToggle !== "1") {
    toggleFormBtn.dataset.boundQuestFormToggle = "1";
    toggleFormBtn.addEventListener("click", () => {
      if (QUESTS_STATE.ui.formOpen) {
        closeQuestForm();
      } else {
        openCreateQuestForm();
      }
      renderQuests();
    });
  }

  [heroCreateBtn, emptyCreateBtn].forEach((btn) => {
    if (!btn || btn.dataset.boundQuestCreateShortcut === "1") return;
    btn.dataset.boundQuestCreateShortcut = "1";
    btn.addEventListener("click", () => {
      openCreateQuestForm();
      renderQuests();
      window.setTimeout(() => getEl("questFormTitle")?.focus(), 0);
    });
  });

  document.querySelectorAll("[data-quest-status-filter]").forEach((btn) => {
    if (btn.dataset.boundQuestStatusFilter === "1") return;
    btn.dataset.boundQuestStatusFilter = "1";
    btn.addEventListener("click", () => {
      QUESTS_STATE.filters.status = btn.dataset.questStatusFilter || "all";
      renderQuests();
    });
  });

  document.querySelectorAll("[data-quest-select]").forEach((node) => {
    if (node.dataset.boundQuestSelect === "1") return;
    node.dataset.boundQuestSelect = "1";
    node.addEventListener("click", (event) => {
      if (event.target.closest("button, input, select, textarea, a, label")) return;
      selectQuestEntry(node.dataset.questSelect);
      renderQuests();
    });
  });

  if (cancelBtn && cancelBtn.dataset.boundQuestFormCancel !== "1") {
    cancelBtn.dataset.boundQuestFormCancel = "1";
    cancelBtn.addEventListener("click", () => {
      closeQuestForm();
      renderQuests();
    });
  }

  if (generateCheckpointsBtn && generateCheckpointsBtn.dataset.boundQuestGenerateCheckpoints !== "1") {
    generateCheckpointsBtn.dataset.boundQuestGenerateCheckpoints = "1";
    generateCheckpointsBtn.addEventListener("click", () => {
      const textarea = getEl("questFormCheckpoints");
      if (!textarea) return;

      const generated = getQuestFormAutoCheckpoints();
      textarea.value = generated.join("\n");
      showToast("Автоэтапы добавлены");
    });
  }

  if (saveBtn && saveBtn.dataset.boundQuestFormSave !== "1") {
    saveBtn.dataset.boundQuestFormSave = "1";
    saveBtn.addEventListener("click", async () => {
      const type = safeText(getEl("questFormType")?.value, "quest").toLowerCase();
      const status = safeText(getEl("questFormStatus")?.value, "active").toLowerCase();
      const title = safeText(getEl("questFormTitle")?.value, "").trim();
      const reward = safeText(getEl("questFormReward")?.value, "").trim();
      const tags = parseTags(getEl("questFormTags")?.value);
      const description = safeText(getEl("questFormDescription")?.value, "").trim();
      let checkpoints = normalizeCheckpoints(getEl("questFormCheckpoints")?.value);
      if (!checkpoints.length) {
        checkpoints = buildAutoCheckpoints({
          type,
          title,
          description,
        });
      }
      const author =
        safeText(window.__appUser?.email, "") ||
        safeText(window.__appUser?.id, "") ||
        "";

      if (!title) {
        showToast("Нужно заполнить название записи");
        return;
      }

      if (QUESTS_STATE.ui.editingId) {
        const changed = await updateQuestEntry(QUESTS_STATE.ui.editingId, {
          type,
          status,
          title,
          reward,
          tags,
          description,
          checkpoints,
          author,
        });
        selectQuestEntry(changed?.id || QUESTS_STATE.ui.editingId);
      } else {
        const created = await addQuestEntry({
          type,
          status,
          title,
          reward,
          tags,
          description,
          checkpoints,
          author,
        });
        selectQuestEntry(created?.id);
      }

      closeQuestForm();
      renderQuests();
    });
  }

  document.querySelectorAll(".quest-status-btn").forEach((btn) => {
    if (btn.dataset.boundQuestStatusBtn === "1") return;
    btn.dataset.boundQuestStatusBtn = "1";

    btn.addEventListener("click", async () => {
      const questId = btn.dataset.questId;
      const nextStatus = btn.dataset.nextStatus || "active";
      await updateQuestStatus(questId, nextStatus);
    });
  });

  document.querySelectorAll(".quest-delete-btn").forEach((btn) => {
    if (btn.dataset.boundQuestDeleteBtn === "1") return;
    btn.dataset.boundQuestDeleteBtn = "1";

    btn.addEventListener("click", async () => {
      const questId = btn.dataset.questId;
      const ok = confirm("Удалить запись?");
      if (!ok) return;
      await deleteQuestEntry(questId);
      if (String(QUESTS_STATE.ui.selectedId || "") === String(questId)) {
        QUESTS_STATE.ui.selectedId = null;
      }
    });
  });

  document.querySelectorAll("[data-quest-edit]").forEach((btn) => {
    if (btn.dataset.boundQuestEditBtn === "1") return;
    btn.dataset.boundQuestEditBtn = "1";

    btn.addEventListener("click", () => {
      openEditQuestForm(btn.dataset.questEdit);
      renderQuests();
    });
  });

  document.querySelectorAll(".quest-checkpoint-toggle").forEach((checkbox) => {
    if (checkbox.dataset.boundQuestCheckpoint === "1") return;
    checkbox.dataset.boundQuestCheckpoint = "1";

    checkbox.addEventListener("change", async () => {
      const questId = checkbox.dataset.questId;
      const checkpointId = checkbox.dataset.checkpointId;
      await toggleCheckpoint(questId, checkpointId);
    });
  });
}

// ------------------------------------------------------------
// 🌉 LEGACY BRIDGE
// ------------------------------------------------------------
window.questsModule = {
  loadQuests,
  renderQuests,
  saveQuests,
  addQuestEntry,
  updateQuestEntry,
  deleteQuestEntry,
  updateQuestStatus,
  toggleCheckpoint,
  markQuestAsCompleted,
  selectQuestEntry,
};
