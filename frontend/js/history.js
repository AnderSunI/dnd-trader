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
  selectedEntryId: "",
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
const HISTORY_SCOPE_FILTERS = [
  { key: "all", label: "Все", shortLabel: "Все", icon: "✦" },
  { key: "trade", label: "Торговля", shortLabel: "Торг", icon: "💰" },
  { key: "inventory", label: "Инвентарь", shortLabel: "Инв.", icon: "🎒" },
  { key: "quests", label: "Задания", shortLabel: "Квест", icon: "🧭" },
  { key: "notes", label: "Заметки", shortLabel: "Заметки", icon: "📝" },
  { key: "map", label: "Карта", shortLabel: "Карта", icon: "🗺️" },
  { key: "files", label: "Файлы", shortLabel: "Файлы", icon: "📁" },
  { key: "auth", label: "Входы", shortLabel: "Auth", icon: "🔐" },
  { key: "gm", label: "ГМ", shortLabel: "GM", icon: "🛡️" },
  { key: "system", label: "Система", shortLabel: "Сист.", icon: "⚙️" },
  { key: "misc", label: "Прочее", shortLabel: "Другое", icon: "📜" },
];

function getScopeFilterMeta(scope) {
  return HISTORY_SCOPE_FILTERS.find((entry) => entry.key === scope) || HISTORY_SCOPE_FILTERS[0];
}

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

function getSelectedEntry(entries = HISTORY_STATE.entries) {
  return (
    entries.find((entry) => String(entry.id) === String(HISTORY_STATE.selectedEntryId)) ||
    entries[0] ||
    null
  );
}

function ensureSelectedEntry(filteredEntries) {
  if (!filteredEntries.length) {
    HISTORY_STATE.selectedEntryId = "";
    return null;
  }

  const selected = getSelectedEntry(filteredEntries);
  HISTORY_STATE.selectedEntryId = selected?.id || filteredEntries[0].id;
  return selected || filteredEntries[0];
}

function getLastEventLabel() {
  const first = HISTORY_STATE.entries[0];
  if (!first) return "нет событий";
  return formatDateTime(first.timestamp);
}

function getEntryAgeLabel(value) {
  const date = normalizeDateInput(value);
  if (!date) return "—";

  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "только что";
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))} мин. назад`;
  if (diff < 86_400_000) return `${Math.max(1, Math.round(diff / 3_600_000))} ч. назад`;
  return `${Math.max(1, Math.round(diff / 86_400_000))} дн. назад`;
}

function buildRawDetailRows(entry) {
  const raw = entry?.raw && typeof entry.raw === "object" ? entry.raw : {};
  const keys = [
    "action",
    "type",
    "item_name",
    "trader_name",
    "quest_name",
    "map_name",
    "marker_name",
    "file_name",
    "quantity",
    "price_label",
    "reward",
    "previous_status",
    "checkpoint",
  ];

  return keys
    .map((key) => {
      const value = raw?.[key];
      if (value === null || value === undefined || value === "") return "";
      return `
        <div class="history-ref-detail-row">
          <span>${escapeHtml(key)}</span>
          <strong>${escapeHtml(String(value))}</strong>
        </div>
      `;
    })
    .filter(Boolean)
    .join("");
}

// ------------------------------------------------------------
// 🎨 RENDER HELPERS
// ------------------------------------------------------------
function renderEmptyState() {
  return `
    <section class="cabinet-block history-ref-empty">
      <div class="history-ref-empty-icon">📜</div>
      <div>
        <h3>Журнал действий пока пуст</h3>
        <p>
          История собирает не рукописные заметки, а автоматические события сайта:
          покупки, продажи, задания, карту, заметки, файлы, входы и действия ГМа.
        </p>
        <div class="history-ref-empty-hint">
          Соверши действие в торговле, карте, заданиях или заметках — запись появится здесь.
        </div>
      </div>
    </section>
  `;
}

function renderHero(entries) {
  const summary = getSummary(entries);
  const activeScope = getScopeFilterMeta(HISTORY_STATE.filters.scope || "all");

  return `
    <section class="cabinet-block history-ref-hero">
      <div class="history-ref-hero-main">
        <div class="history-ref-kicker">Activity log</div>
        <h2>История действий</h2>
        <p>
          Автоматический журнал того, что происходило в проекте: покупки, продажи,
          изменения заданий, карты, заметок, файлов и GM-события.
        </p>
        <div class="history-ref-hero-meta">
          <span>Источник: <strong>${escapeHtml(HISTORY_STATE.source)}</strong></span>
          <span>Фильтр: <strong>${escapeHtml(activeScope.label)}</strong></span>
          <span>Последнее: <strong>${escapeHtml(getLastEventLabel())}</strong></span>
        </div>
      </div>

      <div class="history-ref-hero-stats">
        <div class="history-ref-stat-card history-ref-stat-card-main">
          <span>Всего событий</span>
          <strong>${escapeHtml(String(summary.total))}</strong>
        </div>
        <div class="history-ref-stat-card"><span>Торговля</span><strong>${escapeHtml(String(summary.trade))}</strong></div>
        <div class="history-ref-stat-card"><span>Задания</span><strong>${escapeHtml(String(summary.quests))}</strong></div>
        <div class="history-ref-stat-card"><span>Карта</span><strong>${escapeHtml(String(summary.map))}</strong></div>
      </div>
    </section>
  `;
}

function renderScopeTabs(entries) {
  const summary = getSummary(entries);
  const activeScope = HISTORY_STATE.filters.scope || "all";

  return `
    <section class="cabinet-block history-ref-scope-panel">
      <div class="history-ref-scope-tabs">
        ${HISTORY_SCOPE_FILTERS.map((scope) => {
          const count = scope.key === "all" ? summary.total : summary[scope.key] || 0;
          const active = activeScope === scope.key;
          return `
            <button
              type="button"
              class="history-ref-scope-tab ${active ? "active" : ""}"
              data-history-scope="${escapeHtml(scope.key)}"
            >
              <span class="history-ref-scope-icon">${escapeHtml(scope.icon)}</span>
              <span class="history-ref-scope-label">${escapeHtml(scope.shortLabel || scope.label)}</span>
              <strong>${escapeHtml(String(count))}</strong>
            </button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderFilters() {
  return `
    <section class="cabinet-block history-ref-toolbar">
      <label class="history-ref-search" for="historySearchInput">
        <span>⌕</span>
        <input
          id="historySearchInput"
          type="search"
          placeholder="Найти покупку, квест, метку, заметку, торговца..."
          value="${escapeHtml(HISTORY_STATE.filters.search)}"
        />
      </label>

      <label class="history-ref-select-wrap" for="historyScopeSelect">
        <span>Раздел</span>
        <select id="historyScopeSelect">
          ${HISTORY_SCOPE_FILTERS.map((scope) => `
            <option value="${escapeHtml(scope.key)}" ${HISTORY_STATE.filters.scope === scope.key ? "selected" : ""}>
              ${escapeHtml(scope.label)}
            </option>
          `).join("")}
        </select>
      </label>

      <div class="history-ref-actions">
        <button class="btn" type="button" id="historyRefreshBtn">Обновить</button>
        <button class="btn btn-danger" type="button" id="historyClearLocalBtn">Очистить local</button>
      </div>
    </section>
  `;
}

function renderHistoryItem(entry) {
  const active = String(entry.id) === String(HISTORY_STATE.selectedEntryId);
  const scopeLabel = getScopeLabel(entry.scope);

  return `
    <button
      type="button"
      class="history-ref-item ${active ? "active" : ""} history-ref-item-${escapeHtml(entry.scope)}"
      data-history-entry="${escapeHtml(entry.id)}"
    >
      <span class="history-ref-item-node">${escapeHtml(entry.icon)}</span>
      <span class="history-ref-item-body">
        <span class="history-ref-item-topline">
          <strong>${escapeHtml(entry.title)}</strong>
          <em>${escapeHtml(getEntryAgeLabel(entry.timestamp))}</em>
        </span>
        <span class="history-ref-item-message">
          ${entry.message ? escapeHtml(entry.message) : "Без дополнительного описания."}
        </span>
        <span class="history-ref-item-meta">
          <span>${escapeHtml(scopeLabel)}</span>
          ${entry.status ? `<span>${escapeHtml(entry.status)}</span>` : ""}
          ${entry.actor ? `<span>${escapeHtml(entry.actor)}</span>` : ""}
        </span>
      </span>
      <span class="history-ref-item-time">${escapeHtml(formatTime(entry.timestamp))}</span>
    </button>
  `;
}

function renderTimeline(entries) {
  if (!entries.length) {
    return `
      <section class="cabinet-block history-ref-empty history-ref-empty-filtered">
        <div class="history-ref-empty-icon">⌕</div>
        <div>
          <h3>По текущим фильтрам ничего нет</h3>
          <p>Смени раздел или поисковый запрос, чтобы увидеть другие события журнала.</p>
        </div>
      </section>
    `;
  }

  const groups = groupEntriesByDate(entries);

  return `
    <section class="history-ref-timeline">
      ${groups
        .map(
          (group) => `
            <div class="history-ref-date-group">
              <div class="history-ref-date-label">${escapeHtml(group.label)}</div>
              <div class="history-ref-list">
                ${group.items.map(renderHistoryItem).join("")}
              </div>
            </div>
          `
        )
        .join("")}
    </section>
  `;
}

function renderDetailPanel(entry) {
  if (!entry) {
    return `
      <aside class="cabinet-block history-ref-detail-panel">
        <div class="history-ref-detail-empty">Выбери событие, чтобы увидеть детали.</div>
      </aside>
    `;
  }

  const rawRows = buildRawDetailRows(entry);

  return `
    <aside class="cabinet-block history-ref-detail-panel history-ref-detail-${escapeHtml(entry.scope)}">
      <div class="history-ref-detail-head">
        <div class="history-ref-detail-icon">${escapeHtml(entry.icon)}</div>
        <div>
          <div class="history-ref-kicker">${escapeHtml(getScopeLabel(entry.scope))}</div>
          <h3>${escapeHtml(entry.title)}</h3>
          <p>${escapeHtml(formatDateTime(entry.timestamp))}</p>
        </div>
      </div>

      <div class="history-ref-detail-message">
        ${entry.message ? escapeHtml(entry.message) : "Подробности события не переданы."}
      </div>

      <div class="history-ref-detail-grid">
        <div class="history-ref-detail-row"><span>Раздел</span><strong>${escapeHtml(getScopeLabel(entry.scope))}</strong></div>
        <div class="history-ref-detail-row"><span>Статус</span><strong>${escapeHtml(entry.status || "—")}</strong></div>
        <div class="history-ref-detail-row"><span>Автор</span><strong>${escapeHtml(entry.actor || "—")}</strong></div>
        <div class="history-ref-detail-row"><span>Источник</span><strong>${escapeHtml(HISTORY_STATE.source || "—")}</strong></div>
        ${rawRows}
      </div>

      <details class="history-ref-raw-details">
        <summary>Raw событие</summary>
        <pre>${escapeHtml(JSON.stringify(entry.raw || {}, null, 2))}</pre>
      </details>
    </aside>
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

  document.querySelectorAll("[data-history-scope]").forEach((btn) => {
    if (btn.dataset.boundHistoryScopeTab === "1") return;
    btn.dataset.boundHistoryScopeTab = "1";
    btn.addEventListener("click", () => {
      HISTORY_STATE.filters.scope = btn.dataset.historyScope || "all";
      renderHistory();
    });
  });

  document.querySelectorAll("[data-history-entry]").forEach((btn) => {
    if (btn.dataset.boundHistoryEntry === "1") return;
    btn.dataset.boundHistoryEntry = "1";
    btn.addEventListener("click", () => {
      HISTORY_STATE.selectedEntryId = btn.dataset.historyEntry || "";
      renderHistory();
    });
  });

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
      const ok = confirm("Очистить локально сохранённую историю? Удалятся только local-записи в браузере.");
      if (!ok) return;

      clearLocalHistoryStorage();
      HISTORY_STATE.entries = [];
      HISTORY_STATE.source = "empty";
      HISTORY_STATE.selectedEntryId = "";
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
      <section class="cabinet-block history-ref-empty">
        <div class="history-ref-empty-icon">📜</div>
        <div>
          <h3>История действий</h3>
          <p>Журнал ещё не загружен.</p>
        </div>
      </section>
    `;
    return;
  }

  if (!HISTORY_STATE.entries.length) {
    container.innerHTML = `
      <div class="history-ref-shell history-ref-shell-empty">
        ${renderHero(HISTORY_STATE.entries)}
        ${renderFilters()}
        ${renderEmptyState()}
      </div>
    `;
    bindHistoryActions();
    return;
  }

  const filtered = getFilteredEntries();
  const selected = ensureSelectedEntry(filtered);

  container.innerHTML = `
    <div class="history-ref-shell">
      ${renderHero(HISTORY_STATE.entries)}
      ${renderScopeTabs(HISTORY_STATE.entries)}
      ${renderFilters()}
      <div class="history-ref-layout">
        ${renderTimeline(filtered)}
        ${renderDetailPanel(selected)}
      </div>
    </div>
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
