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
  },
};

// ------------------------------------------------------------
// 🧰 HELPERS
// ------------------------------------------------------------
function getEl(id) {
  return document.getElementById(id);
}

function getToken() {
  return localStorage.getItem("token") || "";
}

function getHeaders(withJson = false) {
  const headers = {};
  const token = getToken();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (withJson) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
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

function trimText(value) {
  return String(value ?? "").trim();
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
  if (raw === "gm" || raw === "admin") return "gm";
  return "player";
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

function formatDateTime(value) {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Без даты";

    return date.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Без даты";
  }
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
  const user = getCurrentUser();
  const userKey =
    user?.email ||
    user?.id ||
    (getToken() ? "auth-user" : "guest");

  return `dnd_trader_quests_${userKey}`;
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
// 📡 API
// ------------------------------------------------------------
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

async function apiWrite(urls, body, methods = ["POST", "PUT", "PATCH"]) {
  const list = Array.isArray(urls) ? urls : [urls];

  for (const method of methods) {
    for (const url of list) {
      try {
        const res = await fetch(url, {
          method,
          headers: getHeaders(true),
          body: JSON.stringify(body),
        });

        if (!res.ok) continue;
        return await res.json().catch(() => ({}));
      } catch (_) {}
    }
  }

  return null;
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

  let data = await apiGet([
    "/player/quests",
    "/quests/me",
    "/quests",
  ]);
  let source = "api";

  if (!data) {
    data = tryLoadFromWindow();
    source = "window";
  }

  if (!data) {
    data = loadLocal();
    source = "local";
  }

  let items = [];

  if (Array.isArray(data)) {
    items = data;
  } else if (Array.isArray(data?.quests)) {
    items = data.quests;
  } else if (Array.isArray(data?.items)) {
    items = data.items;
  } else if (Array.isArray(data?.data?.quests)) {
    items = data.data.quests;
  }

  QUESTS_STATE.items = normalizeQuestList(items);
  QUESTS_STATE.loaded = true;
  QUESTS_STATE.source = QUESTS_STATE.items.length ? source : "empty";

  renderQuests();
  return QUESTS_STATE.items;
}

// ------------------------------------------------------------
// 💾 SAVE
// ------------------------------------------------------------
export async function saveQuests() {
  saveLocal(QUESTS_STATE.items);

  const payload = {
    quests: QUESTS_STATE.items,
  };

  const result = await apiWrite(
    ["/player/quests", "/quests/me", "/quests"],
    payload,
    ["POST", "PUT", "PATCH"]
  );

  QUESTS_STATE.source = result ? "api" : "local";
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

  await saveQuests();
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

  await saveQuests();
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

  await saveQuests();
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

  await saveQuests();
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

// ------------------------------------------------------------
// 🎨 RENDER HELPERS
// ------------------------------------------------------------
function renderSummaryBar(items) {
  const summary = getSummary(items);

  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="trader-meta">
        <span class="meta-item">Всего: ${summary.total}</span>
        <span class="meta-item">Активные: ${summary.active}</span>
        <span class="meta-item">Завершённые: ${summary.completed}</span>
        <span class="meta-item">Проваленные: ${summary.failed}</span>
        <span class="meta-item">Скрытые: ${summary.hidden}</span>
      </div>
      <div class="muted" style="margin-top:8px;">
        Источник: ${escapeHtml(QUESTS_STATE.source)} • Роль: ${escapeHtml(QUESTS_STATE.role)}
      </div>
    </div>
  `;
}

function renderFilters() {
  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="collection-toolbar compact-collection-toolbar">
        <div class="filter-group">
          <label>Поиск</label>
          <input id="questsSearchInput" type="text" placeholder="Найти запись" value="${escapeHtml(
            QUESTS_STATE.filters.search
          )}" />
        </div>

        <div class="filter-group">
          <label>Тип</label>
          <select id="questsTypeFilter">
            <option value="all" ${QUESTS_STATE.filters.type === "all" ? "selected" : ""}>Все</option>
            <option value="quest" ${QUESTS_STATE.filters.type === "quest" ? "selected" : ""}>Задания</option>
            <option value="achievement" ${QUESTS_STATE.filters.type === "achievement" ? "selected" : ""}>Ачивки</option>
            <option value="checkpoint" ${QUESTS_STATE.filters.type === "checkpoint" ? "selected" : ""}>Чекпоинты</option>
            <option value="chronicle" ${QUESTS_STATE.filters.type === "chronicle" ? "selected" : ""}>Летопись</option>
          </select>
        </div>

        <div class="filter-group">
          <label>Статус</label>
          <select id="questsStatusFilter">
            <option value="all" ${QUESTS_STATE.filters.status === "all" ? "selected" : ""}>Все</option>
            <option value="active" ${QUESTS_STATE.filters.status === "active" ? "selected" : ""}>Активно</option>
            <option value="completed" ${QUESTS_STATE.filters.status === "completed" ? "selected" : ""}>Завершено</option>
            <option value="failed" ${QUESTS_STATE.filters.status === "failed" ? "selected" : ""}>Провалено</option>
            <option value="hidden" ${QUESTS_STATE.filters.status === "hidden" ? "selected" : ""}>Скрыто</option>
          </select>
        </div>

        <div class="filter-group">
          <label>Действия</label>
          <div class="cart-buttons">
            <button class="btn" type="button" id="questsRefreshBtn">Обновить</button>
            ${
              isGm()
                ? `<button class="btn btn-primary" type="button" id="questsToggleFormBtn">${QUESTS_STATE.ui.formOpen ? "Скрыть форму" : "＋ Добавить"}</button>`
                : ""
            }
          </div>
        </div>
      </div>
    </div>
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
    <div class="cabinet-block" id="questsCreateBlock" style="${QUESTS_STATE.ui.formOpen ? "display:block;" : "display:none;"} margin-bottom:12px;">
      <h3>${isEditing ? "Редактирование записи" : "Новая запись"}</h3>

      <div class="collection-toolbar compact-collection-toolbar">
        <div class="filter-group">
          <label>Тип</label>
          <select id="questFormType">
            <option value="quest" ${item.type === "quest" ? "selected" : ""}>Задание</option>
            <option value="achievement" ${item.type === "achievement" ? "selected" : ""}>Ачивка</option>
            <option value="checkpoint" ${item.type === "checkpoint" ? "selected" : ""}>Чекпоинт</option>
            <option value="chronicle" ${item.type === "chronicle" ? "selected" : ""}>Летопись</option>
          </select>
        </div>

        <div class="filter-group">
          <label>Статус</label>
          <select id="questFormStatus">
            <option value="active" ${item.status === "active" ? "selected" : ""}>Активно</option>
            <option value="completed" ${item.status === "completed" ? "selected" : ""}>Завершено</option>
            <option value="failed" ${item.status === "failed" ? "selected" : ""}>Провалено</option>
            <option value="hidden" ${item.status === "hidden" ? "selected" : ""}>Скрыто</option>
          </select>
        </div>

        <div class="filter-group">
          <label>Название</label>
          <input id="questFormTitle" type="text" placeholder="Название записи" value="${escapeHtml(item.title)}" />
        </div>

        <div class="filter-group">
          <label>Награда</label>
          <input id="questFormReward" type="text" placeholder="Награда / результат" value="${escapeHtml(item.reward)}" />
        </div>

        <div class="filter-group" style="grid-column: span 2;">
          <label>Теги</label>
          <input id="questFormTags" type="text" placeholder="через запятую" value="${escapeHtml(serializeTags(item.tags))}" />
        </div>
      </div>

      <div class="filter-group" style="margin-top:12px;">
        <label>Описание</label>
        <textarea id="questFormDescription" rows="5" placeholder="Что произошло, зачем это важно, что изменилось...">${escapeHtml(item.description)}</textarea>
      </div>

      <div class="filter-group" style="margin-top:12px;">
        <label>Чекпоинты (каждый с новой строки)</label>
        <textarea id="questFormCheckpoints" rows="4" placeholder="Найти след&#10;Поговорить с НПС&#10;Вернуться в лагерь">${escapeHtml(serializeCheckpoints(item.checkpoints))}</textarea>
      </div>

      <div class="modal-actions" style="margin-top:12px;">
        <button class="btn btn-success" type="button" id="questFormSaveBtn">${isEditing ? "Сохранить изменения" : "Сохранить"}</button>
        <button class="btn" type="button" id="questFormCancelBtn">Скрыть</button>
      </div>

      ${
        isEditing
          ? `<div class="muted" style="margin-top:10px;">Редактируется: ${escapeHtml(item.title)}</div>`
          : ""
      }
    </div>
  `;
}

function renderCheckpoints(item) {
  if (!item.checkpoints?.length) return "";

  return `
    <div style="margin-top:10px;">
      <div class="muted" style="margin-bottom:6px;">Чекпоинты</div>
      <div class="quest-list">
        ${item.checkpoints
          .map(
            (cp) => `
              <label class="inline-checkbox" style="min-height:auto;">
                <input
                  type="checkbox"
                  class="quest-checkpoint-toggle"
                  data-quest-id="${escapeHtml(item.id)}"
                  data-checkpoint-id="${escapeHtml(cp.id)}"
                  ${cp.done ? "checked" : ""}
                />
                <span ${cp.done ? 'style="text-decoration:line-through; opacity:0.75;"' : ""}>
                  ${escapeHtml(cp.text)}
                </span>
              </label>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderQuestCard(item) {
  return `
    <div class="quest-item" data-quest-id="${escapeHtml(item.id)}">
      <div class="flex-between" style="align-items:flex-start; gap:12px;">
        <div style="flex:1 1 auto;">
          <h3 style="margin-bottom:8px;">
            ${escapeHtml(typeIcon(item.type))} ${escapeHtml(item.title)}
          </h3>

          <div class="inv-item-details" style="margin-bottom:8px;">
            <span>${escapeHtml(typeLabel(item.type))}</span>
            <span class="${escapeHtml(statusClass(item.status))}">${escapeHtml(statusLabel(item.status))}</span>
            ${
              item.reward
                ? `<span>Награда: ${escapeHtml(item.reward)}</span>`
                : ""
            }
            ${
              item.author
                ? `<span>Автор: ${escapeHtml(item.author)}</span>`
                : ""
            }
          </div>

          ${
            item.description
              ? `<p>${escapeHtml(item.description)}</p>`
              : `<p class="muted">Описание отсутствует.</p>`
          }

          ${
            item.tags?.length
              ? `
                <div class="trader-meta" style="margin-top:8px;">
                  ${item.tags
                    .map((tag) => `<span class="meta-item">${escapeHtml(tag)}</span>`)
                    .join("")}
                </div>
              `
              : ""
          }

          ${renderCheckpoints(item)}

          <div class="muted" style="margin-top:10px;">
            Создано: ${escapeHtml(formatDateTime(item.created_at))}
            ${
              item.updated_at && item.updated_at !== item.created_at
                ? ` • Обновлено: ${escapeHtml(formatDateTime(item.updated_at))}`
                : ""
            }
          </div>
        </div>

        <div class="cart-buttons" style="align-items:flex-start;">
          ${
            isGm()
              ? `
                <button class="btn quest-status-btn" type="button" data-quest-id="${escapeHtml(item.id)}" data-next-status="active">Активно</button>
                <button class="btn quest-status-btn" type="button" data-quest-id="${escapeHtml(item.id)}" data-next-status="completed">Готово</button>
                <button class="btn quest-status-btn" type="button" data-quest-id="${escapeHtml(item.id)}" data-next-status="failed">Фейл</button>
                <button class="btn quest-status-btn" type="button" data-quest-id="${escapeHtml(item.id)}" data-next-status="hidden">Скрыть</button>
                <button class="btn" type="button" data-quest-edit="${escapeHtml(item.id)}">Редакт.</button>
                <button class="btn btn-danger quest-delete-btn" type="button" data-quest-id="${escapeHtml(item.id)}">Удалить</button>
              `
              : ""
          }
        </div>
      </div>
    </div>
  `;
}

function renderEmptyState() {
  return `
    <div class="cabinet-block">
      <h3>Задания и летопись</h3>
      <p>Записей пока нет.</p>
      ${
        isGm()
          ? `<div class="muted">Добавь первую запись через кнопку «Добавить».</div>`
          : `<div class="muted">Когда ГМ создаст записи, они появятся здесь.</div>`
      }
    </div>
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
      <div class="cabinet-block">
        <h3>Задания</h3>
        <p>Модуль ещё не загружен.</p>
      </div>
    `;
    return;
  }

  const filtered = getFilteredItems();

  container.innerHTML = `
    ${renderSummaryBar(QUESTS_STATE.items)}
    ${renderFilters()}
    ${renderForm()}
    ${
      filtered.length
        ? `<div class="quest-list">${filtered.map(renderQuestCard).join("")}</div>`
        : renderEmptyState()
    }
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
  const saveBtn = getEl("questFormSaveBtn");
  const cancelBtn = getEl("questFormCancelBtn");

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

  if (cancelBtn && cancelBtn.dataset.boundQuestFormCancel !== "1") {
    cancelBtn.dataset.boundQuestFormCancel = "1";
    cancelBtn.addEventListener("click", () => {
      closeQuestForm();
      renderQuests();
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
      const checkpoints = normalizeCheckpoints(getEl("questFormCheckpoints")?.value);
      const author =
        safeText(window.__appUser?.email, "") ||
        safeText(window.__appUser?.id, "") ||
        "";

      if (!title) {
        showToast("Нужно заполнить название записи");
        return;
      }

      if (QUESTS_STATE.ui.editingId) {
        await updateQuestEntry(QUESTS_STATE.ui.editingId, {
          type,
          status,
          title,
          reward,
          tags,
          description,
          checkpoints,
          author,
        });
      } else {
        await addQuestEntry({
          type,
          status,
          title,
          reward,
          tags,
          description,
          checkpoints,
          author,
        });
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
};