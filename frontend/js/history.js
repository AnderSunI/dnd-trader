// ============================================================
// frontend/js/history.js
// История действий сайта / персонажа / кампании
// - отдельный модуль кабинета
// - НЕ зависит от LSS
// - merge API + window + local
// - runtime bridge через CustomEvent("dnd:history:add")
// - совместим с window.historyModule.appendHistoryEntry(...)
// - готов под buy/sell/quests/map/files/notes/gm
// ============================================================

import {
  buildUserScopedStorageKey,
  escapeHtml,
  getEl,
  getSection,
  getHeaders,
  getToken,
  showToast,
  safeText,
  trimText,
  tryParseJson,
  normalizeDateInput,
  toIsoStringSafe,
} from "./shared.js";

// ------------------------------------------------------------
// 🌐 STATE
// ------------------------------------------------------------
const HISTORY_STATE = {
  entries: [],
  source: "empty",
  loaded: false,
  runtimeBound: false,
  filters: {
    scope: "all",
    search: "",
  },
};

// ------------------------------------------------------------
// 🧰 HELPERS
// ------------------------------------------------------------
function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getHistoryStorageKey() {
  return buildUserScopedStorageKey("dnd_trader_history_");
}

function formatDate(value) {
  const date = normalizeDateInput(value);
  if (!date) return "Без даты";

  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatTime(value) {
  const date = normalizeDateInput(value);
  if (!date) return "";

  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(value) {
  const date = normalizeDateInput(value);
  if (!date) return "Без времени";

  return `${formatDate(date)} • ${formatTime(date)}`;
}

function getScopeIcon(scope) {
  const map = {
    trade: "💰",
    inventory: "🎒",
    quests: "🧭",
    notes: "📝",
    map: "🗺️",
    files: "📁",
    auth: "🔐",
    system: "⚙️",
    lss: "📖",
    gm: "🛡️",
    misc: "📜",
  };

  return map[scope] || "📜";
}

function getScopeLabel(scope) {
  const map = {
    trade: "Торговля",
    inventory: "Инвентарь",
    quests: "Задания",
    notes: "Заметки",
    map: "Карта",
    files: "Файлы",
    auth: "Авторизация",
    system: "Система",
    lss: "LSS",
    gm: "ГМ",
    misc: "Прочее",
  };

  return map[scope] || "Прочее";
}

function normalizeScope(rawScope) {
  const raw = trimText(rawScope).toLowerCase();

  if (!raw) return "misc";

  if (
    raw.includes("buy") ||
    raw.includes("sell") ||
    raw.includes("trade") ||
    raw.includes("merchant") ||
    raw.includes("purchase")
  ) {
    return "trade";
  }

  if (
    raw.includes("inventory") ||
    raw.includes("item") ||
    raw.includes("loot") ||
    raw.includes("custom_item")
  ) {
    return "inventory";
  }

  if (
    raw.includes("quest") ||
    raw.includes("achievement") ||
    raw.includes("checkpoint") ||
    raw.includes("chronicle")
  ) {
    return "quests";
  }

  if (
    raw.includes("note") ||
    raw.includes("journal") ||
    raw.includes("memo")
  ) {
    return "notes";
  }

  if (
    raw.includes("map") ||
    raw.includes("marker") ||
    raw.includes("world")
  ) {
    return "map";
  }

  if (
    raw.includes("file") ||
    raw.includes("upload") ||
    raw.includes("attachment")
  ) {
    return "files";
  }

  if (
    raw.includes("login") ||
    raw.includes("register") ||
    raw.includes("auth") ||
    raw.includes("session")
  ) {
    return "auth";
  }

  if (
    raw.includes("lss") ||
    raw.includes("character") ||
    raw.includes("profile")
  ) {
    return "lss";
  }

  if (
    raw.includes("gm") ||
    raw.includes("master")
  ) {
    return "gm";
  }

  if (
    raw.includes("system") ||
    raw.includes("debug") ||
    raw.includes("sync")
  ) {
    return "system";
  }

  return "misc";
}

function inferScope(entry) {
  const raw =
    entry?.scope ||
    entry?.kind ||
    entry?.category ||
    entry?.source ||
    entry?.type ||
    entry?.action ||
    "";

  return normalizeScope(raw);
}

function inferActor(entry) {
  return trimText(
    entry?.actor ||
      entry?.user ||
      entry?.author ||
      entry?.by ||
      entry?.created_by ||
      ""
  );
}

function inferStatus(entry) {
  return trimText(
    entry?.status ||
      entry?.state ||
      ""
  );
}

function inferTimestamp(entry, index = 0) {
  return (
    entry?.created_at ||
    entry?.createdAt ||
    entry?.updated_at ||
    entry?.updatedAt ||
    entry?.timestamp ||
    entry?.time ||
    entry?.date ||
    entry?.at ||
    Date.now() - index * 1000
  );
}

function buildTradeMessage(entry) {
  const item =
    entry?.item_name ||
    entry?.item ||
    entry?.itemTitle ||
    entry?.name ||
    "";

  const trader =
    entry?.trader_name ||
    entry?.trader ||
    entry?.merchant ||
    "";

  const quantity =
    entry?.quantity ??
    entry?.qty ??
    "";

  const price =
    entry?.price_label ||
    entry?.total_label ||
    entry?.money_label ||
    entry?.price ||
    "";

  const parts = [];

  if (trimText(item)) parts.push(`Предмет: ${trimText(item)}`);
  if (String(quantity).trim()) parts.push(`Кол-во: ${quantity}`);
  if (trimText(trader)) parts.push(`Торговец: ${trimText(trader)}`);
  if (trimText(price)) parts.push(`Цена: ${trimText(price)}`);

  return parts.join(" • ");
}

function inferTitle(entry, scope) {
  const explicit =
    entry?.title ||
    entry?.label ||
    entry?.name ||
    entry?.event ||
    "";

  if (trimText(explicit)) return trimText(explicit);

  const action = trimText(entry?.action || entry?.type || "").toLowerCase();

  if (scope === "trade") {
    if (action.includes("buy")) return "Покупка";
    if (action.includes("sell")) return "Продажа";
    return "Торговая операция";
  }

  if (scope === "inventory") {
    if (action.includes("add")) return "Добавление предмета";
    if (action.includes("remove")) return "Удаление предмета";
    if (action.includes("custom")) return "Кастомный предмет";
    return "Изменение инвентаря";
  }

  if (scope === "quests") {
    if (action.includes("create")) return "Новое задание";
    if (action.includes("update")) return "Обновление задания";
    if (action.includes("complete")) return "Задание завершено";
    if (action.includes("checkpoint")) return "Обновление чекпоинта";
    return "Изменение задания";
  }

  if (scope === "notes") return "Изменение заметок";
  if (scope === "map") {
    if (action.includes("marker")) return "Изменение метки";
    if (action.includes("delete")) return "Удаление карты";
    if (action.includes("create")) return "Создание карты";
    return "Изменение карты";
  }
  if (scope === "files") return "Операция с файлами";
  if (scope === "auth") return "Событие авторизации";
  if (scope === "lss") return "Изменение профиля LSS";
  if (scope === "gm") return "Действие ГМа";
  if (scope === "system") return "Системное событие";

  return "Событие";
}

function inferMessage(entry, scope) {
  const explicit =
    entry?.message ||
    entry?.description ||
    entry?.details ||
    entry?.text ||
    entry?.summary ||
    "";

  if (trimText(explicit)) return trimText(explicit);

  if (scope === "trade") {
    const tradeMessage = buildTradeMessage(entry);
    if (tradeMessage) return tradeMessage;
  }

  if (scope === "inventory") {
    return trimText(
      [
        entry?.item_name ? `Предмет: ${entry.item_name}` : "",
        entry?.category ? `Категория: ${entry.category}` : "",
        String(entry?.quantity ?? entry?.qty ?? "").trim()
          ? `Кол-во: ${entry.quantity ?? entry.qty}`
          : "",
      ]
        .filter(Boolean)
        .join(" • ")
    );
  }

  if (scope === "quests") {
    return trimText(
      [
        entry?.quest_name ? `Задание: ${entry.quest_name}` : "",
        entry?.progress ? `Прогресс: ${entry.progress}` : "",
        entry?.reward ? `Награда: ${entry.reward}` : "",
      ]
        .filter(Boolean)
        .join(" • ")
    );
  }

  if (scope === "notes") {
    return trimText(
      entry?.note ||
      entry?.notes ||
      entry?.content ||
      ""
    );
  }

  if (scope === "map") {
    return trimText(
      [
        entry?.map_name ? `Карта: ${entry.map_name}` : "",
        entry?.marker_name ? `Метка: ${entry.marker_name}` : "",
        entry?.title && !entry?.map_name ? entry.title : "",
      ]
        .filter(Boolean)
        .join(" • ")
    );
  }

  if (scope === "files") {
    return trimText(
      [
        entry?.file_name ? `Файл: ${entry.file_name}` : "",
        entry?.size ? `Размер: ${entry.size}` : "",
      ]
        .filter(Boolean)
        .join(" • ")
    );
  }

  return "";
}

function buildSearchBlob(parts) {
  return parts
    .map((part) => trimText(part))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function buildEntryId(obj, index, timestamp) {
  return (
    obj?.id ||
    obj?._id ||
    obj?.uuid ||
    `history_${index}_${String(timestamp).replace(/[^\dT:-]/g, "_")}_${Math.random()
      .toString(36)
      .slice(2, 7)}`
  );
}

function buildDedupeKey(entry) {
  return [
    entry.scope,
    entry.title,
    entry.message,
    entry.actor,
    entry.status,
    toIsoStringSafe(entry.timestamp),
  ]
    .map((part) => trimText(part))
    .join("|")
    .toLowerCase();
}

function normalizeHistoryEntry(entry, index = 0) {
  if (
    typeof entry === "string" ||
    typeof entry === "number" ||
    typeof entry === "boolean"
  ) {
    const value = String(entry);
    const timestamp = Date.now() - index * 1000;

    return {
      id: `history_${index}_${timestamp}`,
      scope: "misc",
      icon: getScopeIcon("misc"),
      title: "Событие",
      message: value,
      actor: "",
      status: "",
      timestamp,
      raw: { message: value, timestamp },
      searchBlob: value.toLowerCase(),
      dedupeKey: `misc|событие|${value.toLowerCase()}|||`
    };
  }

  const obj = entry && typeof entry === "object" ? entry : {};
  const scope = inferScope(obj);
  const title = inferTitle(obj, scope);
  const message = inferMessage(obj, scope);
  const actor = inferActor(obj);
  const status = inferStatus(obj);
  const timestamp = inferTimestamp(obj, index);

  const normalized = {
    id: buildEntryId(obj, index, timestamp),
    scope,
    icon: getScopeIcon(scope),
    title,
    message,
    actor,
    status,
    timestamp,
    raw: obj,
    searchBlob: buildSearchBlob([
      title,
      message,
      actor,
      status,
      scope,
      obj?.item_name,
      obj?.trader_name,
      obj?.quest_name,
      obj?.map_name,
      obj?.marker_name,
      obj?.file_name,
    ]),
  };

  normalized.dedupeKey = buildDedupeKey(normalized);
  return normalized;
}

function normalizeHistoryEntries(entries) {
  return normalizeArray(entries)
    .map((entry, index) => normalizeHistoryEntry(entry, index))
    .sort((a, b) => {
      const ta = normalizeDateInput(a.timestamp)?.getTime() || 0;
      const tb = normalizeDateInput(b.timestamp)?.getTime() || 0;
      return tb - ta;
    });
}

function dedupeEntries(entries) {
  const seen = new Set();
  const result = [];

  entries.forEach((entry) => {
    const key = entry.dedupeKey || buildDedupeKey(entry);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(entry);
  });

  return result;
}

function persistHistoryToLocal() {
  try {
    localStorage.setItem(
      getHistoryStorageKey(),
      JSON.stringify(HISTORY_STATE.entries.map((entry) => entry.raw ?? entry))
    );
  } catch (_) {}
}

function clearLocalHistoryStorage() {
  try {
    localStorage.removeItem(getHistoryStorageKey());
  } catch (_) {}
}

// ------------------------------------------------------------
// 📡 LOADERS
// ------------------------------------------------------------
async function tryLoadHistoryFromProfileApi() {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await fetch("/player/profile", {
      headers: getHeaders(),
    });

    if (!res.ok) return null;

    const data = await res.json();

    if (Array.isArray(data?.history)) return data.history;
    if (Array.isArray(data?.profile?.history)) return data.profile.history;
    if (Array.isArray(data?.data?.history)) return data.data.history;
    if (Array.isArray(data?.profile?.data?.history)) return data.profile.data.history;

    return null;
  } catch (_) {
    return null;
  }
}

async function tryLoadHistoryFromNotesApi() {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await fetch("/player/notes", {
      headers: getHeaders(),
    });

    if (!res.ok) return null;

    const data = await res.json();

    if (Array.isArray(data?.history)) return data.history;
    if (Array.isArray(data?.data?.history)) return data.data.history;

    return null;
  } catch (_) {
    return null;
  }
}

function tryLoadHistoryFromWindow() {
  const candidates = [
    window.__appHistory,
    window.__APP_HISTORY__,
    window.__playerHistory,
    window.__PLAYER_HISTORY__,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return null;
}

function tryLoadHistoryFromLocal() {
  try {
    const raw = localStorage.getItem(getHistoryStorageKey());
    if (!raw) return null;

    const parsed = tryParseJson(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function loadHistory() {
  ensureHistoryRuntime();

  const profileEntries = await tryLoadHistoryFromProfileApi();
  const notesEntries = await tryLoadHistoryFromNotesApi();
  const windowEntries = tryLoadHistoryFromWindow();
  const localEntries = tryLoadHistoryFromLocal();

  const mergedRaw = [
    ...normalizeArray(profileEntries),
    ...normalizeArray(notesEntries),
    ...normalizeArray(windowEntries),
    ...normalizeArray(localEntries),
  ];

  if (!mergedRaw.length) {
    HISTORY_STATE.entries = [];
    HISTORY_STATE.source = "empty";
    HISTORY_STATE.loaded = true;
    return;
  }

  HISTORY_STATE.entries = dedupeEntries(normalizeHistoryEntries(mergedRaw));
  HISTORY_STATE.source = [
    profileEntries ? "profile_api" : "",
    notesEntries ? "notes_api" : "",
    windowEntries ? "window" : "",
    localEntries ? "local" : "",
  ]
    .filter(Boolean)
    .join(" + ") || "manual";
  HISTORY_STATE.loaded = true;

  persistHistoryToLocal();
}

// ------------------------------------------------------------
// 🧪 MANUAL DATA / RUNTIME EVENTS
// ------------------------------------------------------------
export function setHistoryData(entries, source = "manual") {
  ensureHistoryRuntime();

  HISTORY_STATE.entries = dedupeEntries(normalizeHistoryEntries(entries));
  HISTORY_STATE.source = source;
  HISTORY_STATE.loaded = true;
  persistHistoryToLocal();
}

export function clearHistoryData() {
  ensureHistoryRuntime();

  HISTORY_STATE.entries = [];
  HISTORY_STATE.source = "empty";
  HISTORY_STATE.loaded = false;
}

export function getHistoryData() {
  return HISTORY_STATE.entries;
}

export function appendHistoryEntry(entry, options = {}) {
  ensureHistoryRuntime();

  const {
    rerender = true,
    persistLocal = true,
    prepend = true,
  } = options || {};

  const normalized = normalizeHistoryEntry(entry, HISTORY_STATE.entries.length);
  const nextEntries = prepend
    ? [normalized, ...HISTORY_STATE.entries]
    : [...HISTORY_STATE.entries, normalized];

  HISTORY_STATE.entries = dedupeEntries(nextEntries);
  HISTORY_STATE.loaded = true;

  if (persistLocal) persistHistoryToLocal();
  if (rerender) renderHistory();

  return normalized;
}

function handleExternalHistoryEvent(event) {
  const detail = event?.detail;
  if (!detail || typeof detail !== "object") return;

  appendHistoryEntry(detail, {
    rerender: false,
    persistLocal: true,
    prepend: true,
  });
}

function ensureHistoryRuntime() {
  if (HISTORY_STATE.runtimeBound) return;

  HISTORY_STATE.runtimeBound = true;

  window.addEventListener("dnd:history:add", handleExternalHistoryEvent);

  window.addHistoryEntry = function addHistoryEntry(entry) {
    return appendHistoryEntry(entry, {
      rerender: false,
      persistLocal: true,
      prepend: true,
    });
  };
}

// ------------------------------------------------------------
// 🔎 FILTERS / SUMMARY
// ------------------------------------------------------------
function getFilteredEntries() {
  const scope = HISTORY_STATE.filters.scope || "all";
  const search = trimText(HISTORY_STATE.filters.search).toLowerCase();

  return HISTORY_STATE.entries.filter((entry) => {
    const scopeOk = scope === "all" ? true : entry.scope === scope;
    const searchOk = search ? entry.searchBlob.includes(search) : true;
    return scopeOk && searchOk;
  });
}

function getSummary(entries) {
  const summary = {
    total: entries.length,
    trade: 0,
    inventory: 0,
    quests: 0,
    notes: 0,
    map: 0,
    files: 0,
    auth: 0,
    system: 0,
    lss: 0,
    gm: 0,
    misc: 0,
  };

  entries.forEach((entry) => {
    if (summary[entry.scope] !== undefined) {
      summary[entry.scope] += 1;
    } else {
      summary.misc += 1;
    }
  });

  return summary;
}

function groupEntriesByDate(entries) {
  const groups = new Map();

  entries.forEach((entry) => {
    const key = formatDate(entry.timestamp);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(entry);
  });

  return Array.from(groups.entries()).map(([label, items]) => ({
    label,
    items,
  }));
}

// ------------------------------------------------------------
// 🎨 RENDER HELPERS
// ------------------------------------------------------------
function renderEmptyState() {
  return `
    <div class="cabinet-block">
      <h3>Последние действия</h3>
      <p>
        Журнал пока пуст. Когда подключим запись действий сайта, здесь будут
        покупки, продажи, изменения инвентаря, квестов, заметок, карты и файлов.
      </p>
    </div>
  `;
}

function renderSummaryBar(entries) {
  const summary = getSummary(entries);

  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="trader-meta">
        <span class="meta-item">Всего: ${summary.total}</span>
        <span class="meta-item">💰 ${summary.trade}</span>
        <span class="meta-item">🎒 ${summary.inventory}</span>
        <span class="meta-item">🧭 ${summary.quests}</span>
        <span class="meta-item">📝 ${summary.notes}</span>
        <span class="meta-item">🗺️ ${summary.map}</span>
        <span class="meta-item">📁 ${summary.files}</span>
        <span class="meta-item">🛡️ ${summary.gm}</span>
      </div>

      <div class="muted" style="margin-top:8px;">
        Источник: ${escapeHtml(HISTORY_STATE.source)}
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
          <input
            id="historySearchInput"
            type="text"
            placeholder="Поиск по журналу"
            value="${escapeHtml(HISTORY_STATE.filters.search)}"
          />
        </div>

        <div class="filter-group">
          <label>Раздел</label>
          <select id="historyScopeSelect">
            <option value="all" ${HISTORY_STATE.filters.scope === "all" ? "selected" : ""}>Все</option>
            <option value="trade" ${HISTORY_STATE.filters.scope === "trade" ? "selected" : ""}>Торговля</option>
            <option value="inventory" ${HISTORY_STATE.filters.scope === "inventory" ? "selected" : ""}>Инвентарь</option>
            <option value="quests" ${HISTORY_STATE.filters.scope === "quests" ? "selected" : ""}>Задания</option>
            <option value="notes" ${HISTORY_STATE.filters.scope === "notes" ? "selected" : ""}>Заметки</option>
            <option value="map" ${HISTORY_STATE.filters.scope === "map" ? "selected" : ""}>Карта</option>
            <option value="files" ${HISTORY_STATE.filters.scope === "files" ? "selected" : ""}>Файлы</option>
            <option value="auth" ${HISTORY_STATE.filters.scope === "auth" ? "selected" : ""}>Авторизация</option>
            <option value="lss" ${HISTORY_STATE.filters.scope === "lss" ? "selected" : ""}>LSS</option>
            <option value="gm" ${HISTORY_STATE.filters.scope === "gm" ? "selected" : ""}>ГМ</option>
            <option value="system" ${HISTORY_STATE.filters.scope === "system" ? "selected" : ""}>Система</option>
            <option value="misc" ${HISTORY_STATE.filters.scope === "misc" ? "selected" : ""}>Прочее</option>
          </select>
        </div>

        <div class="filter-group">
          <label>Действия</label>
          <div class="cart-buttons">
            <button class="btn" type="button" id="historyRefreshBtn">Обновить</button>
            <button class="btn btn-danger" type="button" id="historyClearLocalBtn">Очистить local</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderHistoryItem(entry) {
  return `
    <div class="quest-item">
      <div class="flex-between" style="align-items:flex-start; gap:12px;">
        <div style="flex:1 1 auto;">
          <h4 style="margin-bottom:6px;">
            ${escapeHtml(entry.icon)} ${escapeHtml(entry.title)}
          </h4>

          <div class="inv-item-details" style="margin-bottom:8px;">
            <span>${escapeHtml(getScopeLabel(entry.scope))}</span>
            ${
              entry.status
                ? `<span>${escapeHtml(entry.status)}</span>`
                : ""
            }
            ${
              entry.actor
                ? `<span>Автор: ${escapeHtml(entry.actor)}</span>`
                : ""
            }
          </div>

          ${
            entry.message
              ? `<div>${escapeHtml(entry.message)}</div>`
              : `<div class="muted">Без дополнительного описания.</div>`
          }
        </div>

        <div class="muted" style="white-space:nowrap;">
          ${escapeHtml(formatDateTime(entry.timestamp))}
        </div>
      </div>
    </div>
  `;
}

function renderTimeline(entries) {
  if (!entries.length) {
    return `
      <div class="cabinet-block">
        <p>По текущим фильтрам записей нет.</p>
      </div>
    `;
  }

  const groups = groupEntriesByDate(entries);

  return `
    <div class="quest-list">
      ${groups
        .map(
          (group) => `
            <div class="cabinet-block">
              <h3 style="margin-bottom:12px;">${escapeHtml(group.label)}</h3>
              <div class="quest-list">
                ${group.items.map(renderHistoryItem).join("")}
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

// ------------------------------------------------------------
// 🪄 BINDINGS
// ------------------------------------------------------------
function bindHistoryActions() {
  const searchInput = getEl("historySearchInput");
  if (searchInput && searchInput.dataset.boundHistorySearch !== "1") {
    searchInput.dataset.boundHistorySearch = "1";
    searchInput.addEventListener("input", () => {
      HISTORY_STATE.filters.search = searchInput.value || "";
      renderHistory();
    });
  }

  const scopeSelect = getEl("historyScopeSelect");
  if (scopeSelect && scopeSelect.dataset.boundHistoryScope !== "1") {
    scopeSelect.dataset.boundHistoryScope = "1";
    scopeSelect.addEventListener("change", () => {
      HISTORY_STATE.filters.scope = scopeSelect.value || "all";
      renderHistory();
    });
  }

  const refreshBtn = getEl("historyRefreshBtn");
  if (refreshBtn && refreshBtn.dataset.boundHistoryRefresh !== "1") {
    refreshBtn.dataset.boundHistoryRefresh = "1";
    refreshBtn.addEventListener("click", async () => {
      await loadHistory();
      renderHistory();
      showToast("История обновлена");
    });
  }

  const clearBtn = getEl("historyClearLocalBtn");
  if (clearBtn && clearBtn.dataset.boundHistoryClear !== "1") {
    clearBtn.dataset.boundHistoryClear = "1";
    clearBtn.addEventListener("click", () => {
      clearLocalHistoryStorage();

      HISTORY_STATE.entries = HISTORY_STATE.entries.filter((entry) => {
        return !entry.raw || typeof entry.raw !== "object" || entry.raw.__remote === true;
      });

      if (!HISTORY_STATE.entries.length) {
        HISTORY_STATE.source = "empty";
      }

      renderHistory();
      showToast("Local history очищена");
    });
  }
}

// ------------------------------------------------------------
// 📜 MAIN RENDER
// ------------------------------------------------------------
export function renderHistory() {
  ensureHistoryRuntime();

  const container = getSection("cabinet-history");
  if (!container) return;

  if (!HISTORY_STATE.loaded) {
    container.innerHTML = `
      <div class="cabinet-block">
        <h3>Последние действия</h3>
        <p>Журнал ещё не загружен.</p>
      </div>
    `;
    return;
  }

  if (!HISTORY_STATE.entries.length) {
    container.innerHTML = `
      ${renderFilters()}
      ${renderEmptyState()}
    `;
    bindHistoryActions();
    return;
  }

  const filtered = getFilteredEntries();

  container.innerHTML = `
    ${renderSummaryBar(HISTORY_STATE.entries)}
    ${renderFilters()}
    ${renderTimeline(filtered)}
  `;

  bindHistoryActions();
}

// ------------------------------------------------------------
// 🚀 INIT RUNTIME IMMEDIATELY
// ------------------------------------------------------------
ensureHistoryRuntime();

// ------------------------------------------------------------
// 🌉 LEGACY BRIDGE
// ------------------------------------------------------------
window.historyModule = {
  loadHistory,
  renderHistory,
  setHistoryData,
  clearHistoryData,
  getHistoryData,
  appendHistoryEntry,
};
