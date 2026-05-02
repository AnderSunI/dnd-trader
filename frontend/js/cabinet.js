// ============================================================
// frontend/js/cabinet.js
// Личный кабинет игрока / ГМа
// - role-based вкладки
// - открытие / закрытие модалки
// - загрузка модулей кабинета
// - LSS отдельно
// - History отдельно через history.js
// - player notes отдельно через playerNotes.js
// - GM-only private notes прямо здесь, в cabinet.js
// - инвентарь кабинета + рабочая форма кастомного предмета
// - файлы игрока: local-first + попытка API + drag&drop сортировка
// - canonical Master Room implementation lives here
// ============================================================

import {
  getLssProfile,
  getLssRaw,
  loadLSS,
  renderLSS,
} from "./longstoryshort.js";

import {
  apiDelete,
  apiGet as apiClientGet,
  apiPatch as apiClientPatch,
  apiPost as apiClientPost,
  fetchAccount,
  fetchTraders,
  fetchProfile,
  updateProfile,
} from "./api.js";

import {
  loadAccountModule,
  renderAccountModule,
} from "./account.js";

import {
  loadHistory,
  renderHistory,
} from "./history.js";

import {
  loadMapData,
  renderMaps,
} from "./maps.js";

import {
  loadQuests,
  renderQuests,
} from "./quests.js";

import {
  loadPlayerNotes,
  renderNotes,
} from "./playerNotes.js";

import {
  loadCodex as loadBestiari,
  renderCodex as renderBestiari,
  getCodexState as getBestiariState,
} from "./bestiari.js";

import {
  apiGet,
  apiWrite as sharedApiWrite,
  escapeHtml,
  formatDateTime,
  formatTime,
  getCurrentRole,
  getCurrentUser,
  getEl,
  getHeaders,
  getToken,
  normalizeRole,
  safeArray,
  safeNumber,
  safeText as sharedSafeText,
  showToast,
  tryParseJson,
} from "./shared.js";

const CABINET_UI_STORAGE_KEY = "dnd-trader-cabinet-ui";

function readStoredCabinetUiState() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return {};
    return tryParseJson(window.localStorage.getItem(CABINET_UI_STORAGE_KEY)) || {};
  } catch (_) {
    return {};
  }
}

const STORED_CABINET_UI = readStoredCabinetUiState();

function readStoredCabinetUiFlag(key, fallback = false) {
  if (Object.prototype.hasOwnProperty.call(STORED_CABINET_UI, key)) {
    return Boolean(STORED_CABINET_UI[key]);
  }
  return Boolean(fallback);
}

// ------------------------------------------------------------
// 🌐 STATE
// ------------------------------------------------------------
const CABINET_STATE = {
  activeTab: "myaccount",
  role: "player",
  initialized: false,
  railCollapsed: readStoredCabinetUiFlag("cabinetRailCollapsed"),
};

const GM_NOTES_STATE = {
  loaded: false,
  source: "empty",
  text: "",
  raw: "",
  isSaving: false,
  lastSavedAt: null,
};

const CABINET_INVENTORY_STATE = {
  customFormOpen: false,
  filtersVisible: true,
};

const FILES_STATE = {
  loaded: false,
  source: "empty",
  items: [],
  draggedIndex: null,
  isSaving: false,
  lastSavedAt: null,
};

const MASTER_ROOM_STATE = {
  loaded: false,
  source: "empty",
  tables: [],
  activeTableId: "",
  createOpen: false,
  stageMode: "table",
  railCollapsed: readStoredCabinetUiFlag("masterRoomRailCollapsed"),
  heroCollapsed: readStoredCabinetUiFlag("masterRoomHeroCollapsed", true),
  sceneCollapsed: readStoredCabinetUiFlag("masterRoomSceneCollapsed"),
  journalCollapsed: readStoredCabinetUiFlag("masterRoomJournalCollapsed"),
  inviteQuery: "",
  userSearchResults: [],
  traderSearchQuery: "",
  traderSearchResults: [],
  itemSearchQuery: "",
  itemSearchResults: [],
  selectedTraderId: "",
  selectedItemId: "",
  grantQuantity: 1,
  allTraders: [],
  enemyCatalog: [],
  enemyQuery: "",
  characterPool: [],
  selectedCharacterPoolValue: "lss-current",
  combatDiceOpen: true,
  combatLogOpen: true,
  combatLogFilter: "all",
  combatHideSecondary: false,
  combatEventType: "roll",
  activeSheetMemberId: "",
  pollTimer: null,
  combatDiceType: "d20",
  combatLastRoll: null,
};

const CODEX_STATE = {
  query: "",
  category: "all",
  selectedId: "",
};

const CABINET_RUNTIME = {
  refreshing: false,
  pendingRefresh: false,
};

// ------------------------------------------------------------
// 🧰 HELPERS
// ------------------------------------------------------------
function persistCabinetUiState() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(
      CABINET_UI_STORAGE_KEY,
      JSON.stringify({
        cabinetRailCollapsed: Boolean(CABINET_STATE.railCollapsed),
        masterRoomRailCollapsed: Boolean(MASTER_ROOM_STATE.railCollapsed),
        masterRoomHeroCollapsed: Boolean(MASTER_ROOM_STATE.heroCollapsed),
        masterRoomSceneCollapsed: Boolean(MASTER_ROOM_STATE.sceneCollapsed),
        masterRoomJournalCollapsed: Boolean(MASTER_ROOM_STATE.journalCollapsed),
      })
    );
  } catch (_) {}
}

function getCabinetScrollRoot() {
  const modal = getEl("cabinetModal");
  return modal?.querySelector(".cabinet-modal-content") || document.scrollingElement || document.documentElement;
}

function scrollCabinetToTop() {
  const root = getCabinetScrollRoot();
  if (root && "scrollTo" in root) {
    root.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function scrollCabinetAnchor(anchor) {
  const key = String(anchor || "").trim();
  if (!key || key === "top") {
    scrollCabinetToTop();
    return;
  }

  const target = document.querySelector(`[data-cabinet-anchor="${key}"]`);
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function safeText(value, fallback = "—") {
  return sharedSafeText(value, fallback);
}

async function apiWrite(urls, body, methods = ["POST", "PUT", "PATCH"]) {
  const result = await sharedApiWrite(urls, body, methods);
  if (result === null) {
    throw new Error("Failed to save");
  }
  return result;
}

function clampText(value, maxLength = 120) {
  const text = safeText(value, "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}…` : text;
}

function getInventoryState() {
  if (Array.isArray(window.__appStateInventory)) {
    return window.__appStateInventory;
  }

  try {
    const raw = localStorage.getItem("dnd_inventory");
    const parsed = tryParseJson(raw);
    if (Array.isArray(parsed)) {
      window.__appStateInventory = parsed;
      return window.__appStateInventory;
    }
  } catch (_) {}

  window.__appStateInventory = [];
  return window.__appStateInventory;
}

function openModal(modal) {
  if (modal) modal.style.display = "block";
}

function closeModal(modal) {
  if (modal) modal.style.display = "none";
}

function emitCabinetHistory(detail) {
  const payload = {
    created_at: new Date().toISOString(),
    ...detail,
  };

  try {
    window.dispatchEvent(
      new CustomEvent("dnd:history:add", {
        detail: payload,
      })
    );
  } catch (_) {}

  try {
    if (window.historyModule?.appendHistoryEntry) {
      window.historyModule.appendHistoryEntry(payload, {
        rerender: false,
        persistLocal: true,
        prepend: true,
      });
    }
  } catch (_) {}
}

function syncCurrentUserProfile(userPatch = {}) {
  const currentUser = getCurrentUser() || {};
  const nextUser = {
    ...currentUser,
    ...(userPatch && typeof userPatch === "object" ? userPatch : {}),
  };

  window.__appUser = nextUser;
  window.__appUserRole = normalizeRole(nextUser.role || currentUser.role || "player");
  window.__userRole = window.__appUserRole;
  document.body.dataset.role = window.__appUserRole;

  try {
    localStorage.setItem("user", JSON.stringify(nextUser));
  } catch (_) {}

  try {
    window.dispatchEvent(
      new CustomEvent("dnd:role:changed", {
        detail: { role: window.__appUserRole, user: nextUser },
      })
    );
  } catch (_) {}

  try {
    window.dispatchEvent(
      new CustomEvent("dnd:user:updated", {
        detail: { user: nextUser },
      })
    );
  } catch (_) {}
}

function getUserScopedKey(base) {
  const user = getCurrentUser();
  const userKey =
    user?.email ||
    user?.id ||
    (getToken() ? "auth-user" : "guest");

  return `${base}:${userKey}`;
}

function rarityClass(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

  if (raw === "common") return "rarity-common";
  if (raw === "uncommon") return "rarity-uncommon";
  if (raw === "rare") return "rarity-rare";
  if (raw === "veryrare" || raw === "very rare") return "rarity-veryrare";
  if (raw === "legendary") return "rarity-legendary";
  if (raw === "artifact") return "rarity-artifact";
  return "rarity-common";
}

function formatPriceLabel(item) {
  if (item?.sell_price_label) return item.sell_price_label;
  if (item?.price_label) return item.price_label;

  const gold = safeNumber(item?.sell_price_gold ?? item?.price_gold ?? 0, 0);
  const silver = safeNumber(item?.sell_price_silver ?? item?.price_silver ?? 0, 0);
  const copper = safeNumber(item?.sell_price_copper ?? item?.price_copper ?? 0, 0);

  const parts = [];
  if (gold) parts.push(`${gold}з`);
  if (silver) parts.push(`${silver}с`);
  if (copper) parts.push(`${copper}м`);

  return parts.length ? parts.join(" ") : "—";
}

function moneyPartsToCp(gold = 0, silver = 0, copper = 0) {
  return Math.max(
    0,
    safeNumber(gold, 0) * 10000 +
      safeNumber(silver, 0) * 100 +
      safeNumber(copper, 0)
  );
}

function cpToMoneyParts(cp = 0) {
  const total = Math.max(0, safeNumber(cp, 0));
  const gold = Math.floor(total / 10000);
  const goldRest = total % 10000;
  const silver = Math.floor(goldRest / 100);
  const copper = goldRest % 100;
  return { gold, silver, copper };
}

function getInventoryCount(items) {
  return (Array.isArray(items) ? items : []).reduce(
    (sum, item) => sum + Math.max(1, safeNumber(item?.quantity, 1)),
    0
  );
}

function getNextCustomItemId(items) {
  const maxExisting = (Array.isArray(items) ? items : []).reduce((max, item) => {
    const id = Number(item?.item_id ?? item?.id ?? 0);
    return Number.isFinite(id) ? Math.max(max, id) : max;
  }, 1000000);

  return maxExisting + 1;
}

function normalizeQuality(value) {
  const raw = String(value || "").trim().toLowerCase();

  if (!raw) return "стандартное";
  if (raw === "good" || raw === "хорошее") return "хорошее";
  if (raw === "perfect" || raw === "идеальное") return "идеальное";
  return raw;
}

function normalizeRarityValue(value) {
  const raw = String(value || "").trim().toLowerCase();

  if (!raw) return "common";
  if (raw === "very rare" || raw === "veryrare") return "very rare";
  return raw;
}

async function readFileAsDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes) {
  const value = Math.max(0, safeNumber(bytes, 0));
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fileTypeLabel(type) {
  const raw = String(type || "").trim().toLowerCase();
  if (!raw) return "file";
  if (raw.includes("image")) return "image";
  if (raw.includes("pdf")) return "pdf";
  if (raw.includes("json")) return "json";
  if (raw.includes("text")) return "text";
  return raw;
}

// ------------------------------------------------------------
// 📑 TAB CONFIG
// ------------------------------------------------------------
function getVisibleTabsByRole(role) {
  const tabs = [
    { key: "myaccount", label: "👤 Мой аккаунт" },
    { key: "project", label: "💛 О проекте" },
    { key: "inventory", label: "🎒 Инвентарь" },
    { key: "lss", label: "📖 LSS" },
    { key: "history", label: "📜 История" },
    { key: "quests", label: "🧭 Задания" },
    { key: "map", label: "🗺️ Карта" },
    { key: "bestiari", label: "📚 Энциклопедия" },
    { key: "files", label: "📁 Файлы" },
    { key: "playernotes", label: "📝 Заметки" },
  ];

  tabs.push({ key: "masterroom", label: "🛡️ Master Room" });

  if (role === "gm") {
    tabs.push({ key: "gmnotes", label: "🛡️ Заметки ГМа" });
  }

  return tabs;
}

function getSectionIdForTab(tabName) {
  const map = {
    myaccount: "cabinet-myaccount",
    project: "cabinet-project",
    inventory: "cabinet-inventory",
    lss: "cabinet-lss",
    history: "cabinet-history",
    quests: "cabinet-quests",
    map: "cabinet-map",
    bestiari: "cabinet-bestiari",
    files: "cabinet-files",
    playernotes: "cabinet-playernotes",
    masterroom: "cabinet-masterroom",
    gmnotes: "cabinet-gmnotes",
  };

  return map[tabName] || "cabinet-inventory";
}

function hideAllCabinetSections() {
  [
    "cabinet-myaccount",
    "cabinet-project",
    "cabinet-inventory",
    "cabinet-lss",
    "cabinet-history",
    "cabinet-quests",
    "cabinet-map",
    "cabinet-bestiari",
    "cabinet-files",
    "cabinet-playernotes",
    "cabinet-masterroom",
    "cabinet-gmnotes",
  ].forEach((id) => {
    const el = getEl(id);
    if (el) el.classList.add("tab-hidden");
  });
}

function setActiveCabinetButton(tabName) {
  document.querySelectorAll("[data-cabinet-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.cabinetTab === tabName);
  });
}

function splitCabinetTabLabel(label) {
  const text = String(label || "").trim();
  const match = text.match(/^([^\s]+)\s+(.*)$/);
  if (!match) {
    return {
      icon: "•",
      text,
    };
  }

  return {
    icon: match[1] || "•",
    text: match[2] || text,
  };
}

function getCabinetActiveTabLabel() {
  return (
    getVisibleTabsByRole(CABINET_STATE.role).find((tab) => tab.key === CABINET_STATE.activeTab)?.label ||
    "Раздел"
  );
}

function applyCabinetModalLayout() {
  const modal = getEl("cabinetModal");
  if (!modal) return;

  const content =
    modal.querySelector(".cabinet-modal-content") ||
    modal.querySelector(".modal-content");

  const layout = modal.querySelector(".cabinet-layout");
  const sidebar = modal.querySelector(".cabinet-sidebar");
  const main = modal.querySelector(".cabinet-main");
  const closeBtn = content?.querySelector(".close");
  const isWorkspaceMode = CABINET_STATE.activeTab === "masterroom";
  const railCollapsed = Boolean(CABINET_STATE.railCollapsed);

  modal.dataset.cabinetLayoutMode = isWorkspaceMode ? "workspace" : "modal";
  modal.classList.toggle("cabinet-rail-collapsed", railCollapsed);

  if (content) {
    if (isWorkspaceMode) {
      content.style.position = "relative";
      content.style.width = "100%";
      content.style.maxWidth = "none";
      content.style.maxHeight = "calc(100vh - 16px)";
      content.style.minHeight = "calc(100vh - 16px)";
      content.style.margin = "0 auto";
      content.style.padding = "20px 20px 22px";
      content.style.overflow = "hidden auto";
    } else {
      const desktopWidth = window.innerWidth <= 900
        ? "calc(100vw - 20px)"
        : "calc(100vw - 24px)";

      content.style.position = "relative";
      content.style.width = `min(1680px, ${desktopWidth})`;
      content.style.maxWidth = "1680px";
      content.style.height = "calc(100vh - 24px)";
      content.style.maxHeight = "calc(100vh - 24px)";
      content.style.minHeight = "calc(100vh - 24px)";
      content.style.margin = "12px auto";
      content.style.padding = "14px";
      content.style.overflow = "hidden auto";
    }
  }

  if (layout) {
    layout.style.display = "grid";
    layout.style.gridTemplateColumns = isWorkspaceMode
      ? (window.innerWidth <= 1180 ? "1fr" : `${railCollapsed ? "76px" : "240px"} minmax(0, 1fr)`)
      : (window.innerWidth <= 1180 ? "1fr" : `${railCollapsed ? "68px" : "210px"} minmax(0, 1fr)`);
    layout.style.gap = isWorkspaceMode ? "16px" : "14px";
    layout.style.alignItems = "start";
  }

  if (sidebar) {
    sidebar.style.minWidth = "0";
    sidebar.style.padding = railCollapsed ? "10px 8px" : (isWorkspaceMode ? "16px 12px 14px" : "10px");
    sidebar.style.borderRadius = isWorkspaceMode ? "24px" : "18px";
  }

  if (main) {
    main.style.minWidth = "0";
  }

  if (closeBtn) {
    closeBtn.style.position = "absolute";
    closeBtn.style.top = "10px";
    closeBtn.style.right = "10px";
    closeBtn.style.left = "auto";
    closeBtn.style.zIndex = "8";
    closeBtn.style.width = "30px";
    closeBtn.style.height = "30px";
    closeBtn.style.minHeight = "30px";
    closeBtn.style.fontSize = "19px";
  }
}

function updateCabinetViewState(isOpen = false) {
  const body = document.body;
  if (!body) return;

  body.classList.toggle("cabinet-open", Boolean(isOpen));

  [
    "cabinet-tab-inventory",
    "cabinet-tab-myaccount",
    "cabinet-tab-project",
    "cabinet-tab-lss",
    "cabinet-tab-history",
    "cabinet-tab-quests",
    "cabinet-tab-map",
    "cabinet-tab-bestiari",
    "cabinet-tab-files",
    "cabinet-tab-playernotes",
    "cabinet-tab-gmnotes",
    "cabinet-tab-masterroom",
    "cabinet-masterroom-battle-focus",
  ].forEach((className) => body.classList.remove(className));

  if (isOpen && CABINET_STATE.activeTab) {
    body.classList.add(`cabinet-tab-${CABINET_STATE.activeTab}`);
  }
}

function getEquippedEntries() {
  const equipment = getEquipmentState();
  const result = [];

  EQUIPMENT_SLOT_CONFIG.forEach((slot) => {
    const itemId = Number(equipment?.[slot.key]?.itemId);
    const item = itemId ? findInventoryItemById(itemId) : null;

    if (item) {
      result.push({
        slotKey: slot.key,
        slotLabel: slot.label,
        item,
      });
    }
  });

  return result;
}

function renderEquippedItemsInlineSummary() {
  const equipped = getEquippedEntries();

  if (!equipped.length) {
    return `<div class="muted" style="font-size:0.82rem;">Ничего не надето. Открой слоты только когда они реально нужны.</div>`;
  }

  return `
    <div class="trader-meta" style="gap:6px; flex-wrap:wrap;">
      ${equipped
        .map((entry) => `
          <span class="meta-item" title="${escapeHtml(entry.slotLabel)}">
            ${escapeHtml(entry.slotLabel)}: ${escapeHtml(entry.item?.name || "Предмет")}
          </span>
        `)
        .join("")}
    </div>
  `;
}

function inventoryCategoryLabel(value) {
  const raw = String(value || "").trim().toLowerCase();

  const map = {
    accessory: "Аксессуары",
    alchemy: "Алхимия",
    armor: "Броня",
    consumables: "Расходники",
    food_drink: "Еда и напитки",
    misc: "Разное",
    potions_elixirs: "Зелья и эликсиры",
    tools: "Инструменты",
    weapon: "Оружие",
    "прочее": "Разное",
  };

  return map[raw] || safeText(value, "—");
}

function rarityLabel(value) {
  const raw = normalizeRarityValue(value);

  const map = {
    common: "Обычный",
    uncommon: "Необычный",
    rare: "Редкий",
    "very rare": "Очень редкий",
    legendary: "Легендарный",
    artifact: "Артефакт",
  };

  return map[raw] || safeText(value, "—");
}

// ------------------------------------------------------------
// 🏗️ SHELL
// ------------------------------------------------------------
function ensureCabinetStructure() {
  const modal = getEl("cabinetModal");
  if (!modal) return null;

  const tabButtons = getEl("cabinetTabButtons");
  const header = getEl("cabinetHeader");
  const main = modal.querySelector(".cabinet-main");

  if (!tabButtons || !header || !main) {
    console.warn("Cabinet DOM structure incomplete");
  }

  if (main && !getEl("cabinet-bestiari")) {
    const section = document.createElement("div");
    section.id = "cabinet-bestiari";
    section.className = "cabinet-section tab-hidden";
    main.appendChild(section);
  }

  if (main && !getEl("cabinet-masterroom")) {
    const section = document.createElement("div");
    section.id = "cabinet-masterroom";
    section.className = "cabinet-section tab-hidden";
    main.appendChild(section);
  }

  if (main && !getEl("cabinet-myaccount")) {
    const section = document.createElement("div");
    section.id = "cabinet-myaccount";
    section.className = "cabinet-section tab-hidden";
    main.insertBefore(section, header?.parentElement === main ? header.nextSibling : main.firstChild);
  }

  const accountSection = getEl("cabinet-myaccount");
  if (main && header?.parentElement === main && accountSection && accountSection.previousElementSibling !== header) {
    main.insertBefore(accountSection, header.nextSibling);
  }

  if (main && !getEl("cabinet-project")) {
    const section = document.createElement("div");
    section.id = "cabinet-project";
    section.className = "cabinet-section tab-hidden";
    const inventorySection = getEl("cabinet-inventory");
    if (inventorySection) {
      main.insertBefore(section, inventorySection);
    } else {
      main.appendChild(section);
    }
  }

  applyCabinetModalLayout();
  return modal;
}

function renderCabinetHeader() {
  const header = getEl("cabinetHeader");
  if (!header) return;

  const user = getCurrentUser();
  const role = CABINET_STATE.role === "gm" ? "ГМ" : "Игрок";
  const activeLabel = getCabinetActiveTabLabel();
  const nickname = safeText(user?.nickname || user?.email?.split?.("@")?.[0] || "", "");
  const displayName = safeText(user?.display_name || "", "");
  const bio = safeText(user?.bio || "", "");

  header.innerHTML = `
    <div class="cabinet-header-inner cabinet-header-shell">
      <div class="flex-between cabinet-header-layout">
        <div class="cabinet-header-copy">
          <div class="muted cabinet-header-kicker">Личный кабинет</div>
          <h2 class="cabinet-header-title">Кабинет персонажа</h2>
          <div class="muted cabinet-header-subtitle">
            Роль: <strong>${escapeHtml(role)}</strong>
            ${user?.email ? ` • ${escapeHtml(user.email)}` : ""}
          </div>
        </div>

        <div class="trader-meta cabinet-header-meta">
          <span class="meta-item">Раздел: ${escapeHtml(activeLabel)}</span>
          ${user?.nickname ? `<span class="meta-item">@${escapeHtml(user.nickname)}</span>` : ""}
          ${user?.display_name ? `<span class="meta-item">${escapeHtml(user.display_name)}</span>` : ""}
        </div>
      </div>
    </div>
  `;

  bindCabinetHeaderActions();
}

function renderCabinetTabs() {
  const root = getEl("cabinetTabButtons");
  if (!root) return;

  const tabs = getVisibleTabsByRole(CABINET_STATE.role);

  const tabButtonsHtml = tabs
    .map((tab) => {
      const active = tab.key === CABINET_STATE.activeTab;
      const parts = splitCabinetTabLabel(tab.label);

      return `
        <button
          class="btn cabinet-rail-btn ${active ? "active" : ""}"
          data-cabinet-tab="${escapeHtml(tab.key)}"
        >
          <span class="cabinet-rail-btn-inner">
            <span class="cabinet-rail-btn-icon">${escapeHtml(parts.icon)}</span>
            <span>${escapeHtml(parts.text)}</span>
          </span>
        </button>
      `;
    })
    .join("");

  root.innerHTML = `
    <button
      class="btn cabinet-rail-toggle-btn"
      type="button"
      id="cabinetRailToggleBtn"
      title="${CABINET_STATE.railCollapsed ? "Развернуть левую шторку" : "Свернуть левую шторку"}"
      aria-label="${CABINET_STATE.railCollapsed ? "Развернуть левую шторку" : "Свернуть левую шторку"}"
    >
      <span>${CABINET_STATE.railCollapsed ? "›" : "‹"}</span>
    </button>
    <div class="cabinet-tab-buttons-list">
      ${tabButtonsHtml}
    </div>
    ${
      getCurrentUser()
        ? `
          <div class="cabinet-sidebar-footer">
            <button class="btn btn-danger" type="button" id="cabinetSidebarLogoutBtn">
              Выйти из аккаунта
            </button>
          </div>
        `
        : ""
    }
  `;

  bindCabinetHeaderActions();
}

function bindCabinetHeaderActions() {
  const railToggleBtn = getEl("cabinetRailToggleBtn");
  if (railToggleBtn && railToggleBtn.dataset.boundCabinetRailToggle !== "1") {
    railToggleBtn.dataset.boundCabinetRailToggle = "1";
    railToggleBtn.addEventListener("click", () => {
      CABINET_STATE.railCollapsed = !CABINET_STATE.railCollapsed;
      persistCabinetUiState();
      applyCabinetModalLayout();
      renderCabinetTabs();
      bindCabinetTabs();
    });
  }

  const logoutBtn = getEl("cabinetSidebarLogoutBtn");
  if (logoutBtn && logoutBtn.dataset.boundCabinetLogout !== "1") {
    logoutBtn.dataset.boundCabinetLogout = "1";
    logoutBtn.addEventListener("click", () => {
      closeCabinet();
      document.getElementById("logoutBtn")?.click();
    });
  }
}

function renderProjectSupportTab() {
  const container = getEl("cabinet-project");
  if (!container) return;

  container.innerHTML = `
    <div class="cabinet-block" style="padding:16px 18px;">
      <div class="flex-between" style="align-items:flex-start; gap:14px; flex-wrap:wrap; margin-bottom:14px;">
        <div>
          <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em;">Проект</div>
          <h3 style="margin:4px 0 6px 0;">💛 Поддержать D&D Trader</h3>
          <div class="muted" style="font-size:0.86rem; max-width:780px;">
            D&D Trader растёт как companion-инструмент для стола: торговцы, кабинет, LSS, столы, бой и social-слой.
            Если хочешь поддержать развитие проекта, ссылка здесь.
          </div>
        </div>
        <a
          class="btn btn-primary"
          href="https://boosty.to/dnd_trader_undersuni"
          target="_blank"
          rel="noreferrer"
          style="text-decoration:none;"
        >
          🚀 Перейти на Boosty
        </a>
      </div>

      <div class="profile-grid cabinet-support-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px;">
        <div class="stat-box" style="padding:14px; min-height:auto;">
          <div class="muted">🧙 Что это</div>
          <div style="font-size:15px; font-weight:800; margin-top:6px;">Компаньон для D&D / BG3</div>
          <div class="muted" style="margin-top:8px; font-size:0.82rem;">Кабинет, столы, бой, LSS, торговцы и развитие в сторону живого party-tool.</div>
        </div>
        <div class="stat-box" style="padding:14px; min-height:auto;">
          <div class="muted">🛠 Сейчас в работе</div>
          <div style="font-size:15px; font-weight:800; margin-top:6px;">Master Room, LSS, social</div>
          <div class="muted" style="margin-top:8px; font-size:0.82rem;">Более удобный стол, синхронизация партии, боевой журнал и социальный слой.</div>
        </div>
        <div class="stat-box" style="padding:14px; min-height:auto;">
          <div class="muted">🤝 Как помочь</div>
          <div style="font-size:15px; font-weight:800; margin-top:6px;">Поддержка и фидбек</div>
          <div class="muted" style="margin-top:8px; font-size:0.82rem;">Подписка, идеи, баг-репорты и реальное использование проекта помогают быстрее развивать систему.</div>
        </div>
      </div>
    </div>
  `;
}

// ------------------------------------------------------------
// 📚 CODEX / ENCYCLOPEDIA
// ------------------------------------------------------------
const CODEX_CATEGORY_LABELS = {
  all: "Всё",
  monsters: "Монстры",
  gods: "Боги",
  lore: "Лор",
  spells: "Заклинания",
  items: "Предметы",
  classes: "Классы",
  factions: "Фракции",
};

const CODEX_ENTRIES = [
  {
    id: "monster-goblin",
    category: "monsters",
    title: "Гоблин",
    subtitle: "Мелкий рейдер и разведчик",
    tags: ["монстр", "гуманоид", "низкий CR"],
    summary: "Хитрый слабый противник, опасен числом, засадами и мобильностью.",
    body: [
      "Гоблины хороши как ранние противники и как живая часть мира: разведчики, мародёры, слуги сильных вождей.",
      "Для игрока это удобный пример существа, о котором полезно помнить: быстрый, трусливый, но неприятный при численном преимуществе.",
    ],
    hooks: ["Тактика: засады и отход", "Связь: банды, лагеря, пещеры"],
  },
  {
    id: "god-mystra",
    category: "gods",
    title: "Мистра",
    subtitle: "Богиня магии",
    tags: ["бог", "магия", "Забытые Королевства"],
    summary: "Одна из ключевых фигур мира, если кампания касается волшебства, арканума и магических катастроф.",
    body: [
      "Полезна как лорная точка входа в темы арканной магии, плетения и отношения мира к колдунам и волшебникам.",
      "Даже если потом база будет тянуться с бэка, модуль уже должен уметь хранить краткое описание, развёрнутый текст и связанные сущности.",
    ],
    hooks: ["Связанные темы: плетение", "Полезно для магов и сюжетов о магии"],
  },
  {
    id: "lore-spellplague",
    category: "lore",
    title: "Магическая Чума",
    subtitle: "Крупное катастрофическое событие мира",
    tags: ["событие", "катастрофа", "история мира"],
    summary: "Пример лорной записи о важном событии с влиянием на магию, историю и географию.",
    body: [
      "Такие статьи нужны не только ради текста, но и чтобы игрок мог быстро понять контекст мира без копания в внешних источниках.",
      "В будущем сюда логично подтянуть связанные места, богов, заклинания и последствия для кампании.",
    ],
    hooks: ["Связать с богами", "Связать с магией и локациями"],
  },
  {
    id: "spell-fireball",
    category: "spells",
    title: "Огненный шар",
    subtitle: "Классическая арканная взрывная магия",
    tags: ["заклинание", "3 круг", "урон огнём"],
    summary: "Образец карточки заклинания для будущей связки LSS, предметов и энциклопедии.",
    body: [
      "Пока это справочная запись, но потом такие записи можно подтягивать из БД по ID и показывать в чарнике, предметах и торговле.",
      "Важно, чтобы модуль уже сейчас умел разделять краткое описание и полную справку.",
    ],
    hooks: ["Школа: воплощение", "Тип урона: огонь"],
  },
  {
    id: "item-bag-of-holding",
    category: "items",
    title: "Сумка хранения",
    subtitle: "Знаковый магический предмет",
    tags: ["предмет", "утилита", "магия"],
    summary: "Пример записи предмета для будущей общей базы знаний по шмоту и магическим вещам.",
    body: [
      "Такие записи потом логично связать с инвентарём, торговцами и чарником, чтобы предмет можно было открыть и как объект, и как справочную статью.",
    ],
    hooks: ["Связать с торговлей", "Связать с инвентарём"],
  },
  {
    id: "class-wizard",
    category: "classes",
    title: "Волшебник",
    subtitle: "Арканный подготовленный заклинатель",
    tags: ["класс", "интеллект", "магия"],
    summary: "Шаблон записи класса: краткая роль, основная характеристика и сильные стороны.",
    body: [
      "Нужен не только для справки, но и как основа для будущего конструктора чарника: выбор класса, архетипов и рекомендаций.",
    ],
    hooks: ["Осн. характеристика: интеллект", "Связать с подклассами и спеллами"],
  },
  {
    id: "faction-harpers",
    category: "factions",
    title: "Арфисты",
    subtitle: "Тайная сеть агентов и идеалистов",
    tags: ["фракция", "организация", "сюжет"],
    summary: "Пример записи фракции, чтобы модуль не ограничивался только монстрами и предметами.",
    body: [
      "Фракции важны для квестов, лора, контактов и политических линий кампании.",
    ],
    hooks: ["Связать с NPC", "Связать с событиями и городами"],
  },
];

function ensureCodexStateDefaults() {
  CODEX_STATE.query ??= "";
  CODEX_STATE.category ??= "all";

  if (!CODEX_STATE.selectedId || !CODEX_ENTRIES.some((entry) => entry.id === CODEX_STATE.selectedId)) {
    CODEX_STATE.selectedId = CODEX_ENTRIES[0]?.id || "";
  }
}

function getFilteredCodexEntries() {
  ensureCodexStateDefaults();

  const query = CODEX_STATE.query.trim().toLowerCase();
  const category = CODEX_STATE.category;

  return CODEX_ENTRIES.filter((entry) => {
    if (category !== "all" && entry.category !== category) return false;
    if (!query) return true;

    const haystack = [
      entry.title,
      entry.subtitle,
      entry.summary,
      ...(entry.tags || []),
      ...(entry.body || []),
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

function getSelectedCodexEntry(entries) {
  if (!Array.isArray(entries) || !entries.length) return null;
  return entries.find((entry) => entry.id === CODEX_STATE.selectedId) || entries[0];
}

function renderCodex() {
  ensureCodexStateDefaults();

  const container = getEl("cabinet-codex");
  if (!container) return;

  const entries = getFilteredCodexEntries();
  const selected = getSelectedCodexEntry(entries);
  if (selected) CODEX_STATE.selectedId = selected.id;

  const categoryButtons = Object.entries(CODEX_CATEGORY_LABELS)
    .map(([key, label]) => {
      const active = CODEX_STATE.category === key ? "active" : "";
      return `
        <button
          class="btn ${active}"
          type="button"
          data-codex-category="${escapeHtml(key)}"
        >
          ${escapeHtml(label)}
        </button>
      `;
    })
    .join("");

  const listHtml = entries.length
    ? entries
        .map((entry) => {
          const active = selected?.id === entry.id ? "active" : "";
          const tagHtml = (entry.tags || [])
            .slice(0, 3)
            .map((tag) => `<span class="quality-badge">${escapeHtml(tag)}</span>`)
            .join("");

          return `
            <button
              type="button"
              class="btn ${active}"
              data-codex-entry="${escapeHtml(entry.id)}"
              style="width:100%; justify-content:flex-start; text-align:left; padding:10px 12px; border-radius:12px;"
            >
              <div style="display:flex; flex-direction:column; gap:6px; width:100%;">
                <div style="font-weight:800;">${escapeHtml(entry.title)}</div>
                <div class="muted">${escapeHtml(entry.subtitle || "")}</div>
                <div class="trader-meta">${tagHtml}</div>
              </div>
            </button>
          `;
        })
        .join("")
    : `
      <div class="cabinet-block">
        <p>Ничего не найдено. Попробуй другой запрос или категорию.</p>
      </div>
    `;

  const detailHtml = selected
    ? `
      <div class="cabinet-block">
        <div class="flex-between" style="align-items:flex-start; gap:12px; flex-wrap:wrap;">
          <div>
            <h3 style="margin:0 0 6px 0;">${escapeHtml(selected.title)}</h3>
            <div class="muted">${escapeHtml(selected.subtitle || "")}</div>
          </div>
          <div class="trader-meta">
            <span class="meta-item">Категория: ${escapeHtml(CODEX_CATEGORY_LABELS[selected.category] || selected.category)}</span>
          </div>
        </div>

        <div class="lss-rich-block" style="margin-top:12px;">
          <p>${escapeHtml(selected.summary || "")}</p>
        </div>

        ${(selected.body || [])
          .map((paragraph) => `<div class="lss-rich-block" style="margin-top:10px;"><p>${escapeHtml(paragraph)}</p></div>`)
          .join("")}

        ${(selected.hooks || []).length
          ? `
            <div class="cabinet-block" style="margin-top:12px;">
              <h4 style="margin:0 0 10px 0;">Связанные направления</h4>
              <div class="trader-meta">
                ${selected.hooks
                  .map((hook) => `<span class="meta-item">${escapeHtml(hook)}</span>`)
                  .join("")}
              </div>
            </div>
          `
          : ""}
      </div>
    `
    : `
      <div class="cabinet-block">
        <p>Выбери запись слева, чтобы открыть подробности.</p>
      </div>
    `;

  container.innerHTML = `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="flex-between" style="align-items:flex-start; gap:12px; flex-wrap:wrap;">
        <div>
          <h3 style="margin:0 0 6px 0;">📚 Энциклопедия мира</h3>
          <div class="muted">
            Каркас общей базы знаний по D&D: монстры, боги, события, предметы, заклинания, классы и фракции.
          </div>
        </div>
        <div class="trader-meta">
          <span class="meta-item">Записей: ${entries.length}</span>
          <span class="meta-item">Категория: ${escapeHtml(CODEX_CATEGORY_LABELS[CODEX_STATE.category] || "Всё")}</span>
        </div>
      </div>
    </div>

    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="collection-toolbar compact-collection-toolbar" style="gap:10px;">
        <div class="filter-group" style="min-width:260px; flex:1 1 260px;">
          <label>Поиск по базе знаний</label>
          <input id="codexSearchInput" type="text" placeholder="Монстр, бог, предмет, заклинание..." value="${escapeHtml(CODEX_STATE.query)}">
        </div>
        <div class="cart-buttons" style="align-items:flex-end; gap:8px; flex-wrap:wrap;">
          ${categoryButtons}
        </div>
      </div>
    </div>

    <div class="profile-grid" style="align-items:start; grid-template-columns:minmax(280px, 0.95fr) minmax(0, 1.55fr);">
      <div class="cabinet-block" style="display:flex; flex-direction:column; gap:8px; min-height:100%;">
        ${listHtml}
      </div>
      <div>${detailHtml}</div>
    </div>
  `;

  bindCodexActions();
}

function bindCodexActions() {
  const searchInput = getEl("codexSearchInput");
  if (searchInput && searchInput.dataset.boundCodexSearch !== "1") {
    searchInput.dataset.boundCodexSearch = "1";
    searchInput.addEventListener("input", () => {
      CODEX_STATE.query = searchInput.value || "";
      renderCodex();
    });
  }

  document.querySelectorAll("[data-codex-category]").forEach((btn) => {
    if (btn.dataset.boundCodexCategory === "1") return;
    btn.dataset.boundCodexCategory = "1";
    btn.addEventListener("click", () => {
      CODEX_STATE.category = btn.dataset.codexCategory || "all";
      const entries = getFilteredCodexEntries();
      CODEX_STATE.selectedId = entries[0]?.id || "";
      renderCodex();
    });
  });

  document.querySelectorAll("[data-codex-entry]").forEach((btn) => {
    if (btn.dataset.boundCodexEntry === "1") return;
    btn.dataset.boundCodexEntry = "1";
    btn.addEventListener("click", () => {
      CODEX_STATE.selectedId = btn.dataset.codexEntry || "";
      renderCodex();
    });
  });
}

// ------------------------------------------------------------
// 🎒 INVENTORY
// ------------------------------------------------------------
const EQUIPMENT_SLOT_CONFIG = [
  { key: "main_hand", label: "🗡 Основная рука", aliases: ["main_hand", "weapon", "main hand"] },
  { key: "off_hand", label: "🛡 Вторая рука", aliases: ["off_hand", "off hand", "shield"] },
  { key: "ranged", label: "🏹 Дальний бой", aliases: ["ranged", "bow", "crossbow"] },
  { key: "head", label: "⛑ Голова", aliases: ["head", "helmet", "helm", "hat"] },
  { key: "cloak", label: "🧥 Плащ", aliases: ["cloak", "cape"] },
  { key: "chest", label: "🛡 Броня", aliases: ["chest", "armor", "body", "torso"] },
  { key: "gloves", label: "🧤 Перчатки", aliases: ["gloves", "hands", "gauntlets"] },
  { key: "boots", label: "🥾 Обувь", aliases: ["boots", "feet", "shoes"] },
  { key: "amulet", label: "📿 Амулет", aliases: ["amulet", "neck"] },
  { key: "ring_1", label: "💍 Кольцо 1", aliases: ["ring", "ring_1", "ring1"] },
  { key: "ring_2", label: "💍 Кольцо 2", aliases: ["ring", "ring_2", "ring2"] },
];

function ensureCabinetInventoryStateDefaults() {
  CABINET_INVENTORY_STATE.customFormOpen ??= false;
  CABINET_INVENTORY_STATE.filtersVisible ??= false;
  CABINET_INVENTORY_STATE.search ??= "";
  CABINET_INVENTORY_STATE.rarity ??= "";
  CABINET_INVENTORY_STATE.magic ??= "";
  CABINET_INVENTORY_STATE.category ??= "";
  CABINET_INVENTORY_STATE.equippedOnly ??= false;
  CABINET_INVENTORY_STATE.sort ??= "name";
  CABINET_INVENTORY_STATE.viewMode ??= "table";
  CABINET_INVENTORY_STATE.equipmentVisible ??= false;
  CABINET_INVENTORY_STATE.slotSelections ??= {};
  CABINET_INVENTORY_STATE.equipment ??= loadEquipmentStateLocal();
}

function getEquipmentStorageKey() {
  return getUserScopedKey("cabinetEquipment");
}

function loadEquipmentStateLocal() {
  try {
    const raw = localStorage.getItem(getEquipmentStorageKey());
    const parsed = tryParseJson(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch (_) {}
  return {};
}

function saveEquipmentStateLocal() {
  try {
    localStorage.setItem(
      getEquipmentStorageKey(),
      JSON.stringify(CABINET_INVENTORY_STATE.equipment || {})
    );
  } catch (_) {}
}

function getEquipmentState() {
  ensureCabinetInventoryStateDefaults();
  return CABINET_INVENTORY_STATE.equipment;
}

function getInventoryItemId(item) {
  return Number(item?.item_id ?? item?.id ?? 0);
}

function findInventoryItemById(itemId) {
  return getInventoryState().find(
    (entry) => Number(entry?.item_id ?? entry?.id) === Number(itemId)
  ) || null;
}

function getSlotConfig(slotKey) {
  return EQUIPMENT_SLOT_CONFIG.find((slot) => slot.key === slotKey) || null;
}

function resolveSlotLabel(slotKey) {
  return getSlotConfig(slotKey)?.label || slotKey;
}

function getInventoryCategories(items) {
  return [...new Set((Array.isArray(items) ? items : [])
    .map((item) => String(item?.category || "").trim())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
}

function inferItemSlotOptions(item) {
  const rawSlot = String(item?.slot || item?.equip_slot || "").trim().toLowerCase();
  if (rawSlot) {
    const matched = EQUIPMENT_SLOT_CONFIG.filter((slot) =>
      slot.aliases.some((alias) => alias === rawSlot)
    );
    if (matched.length) return matched.map((slot) => slot.key);
  }

  const blob = [
    item?.name,
    item?.category,
    item?.type,
    item?.tags,
    item?.properties,
    item?.requirements,
  ]
    .flat()
    .join(" ")
    .toLowerCase();

  if (!blob) return ["main_hand"];

  if (/ring|кольц/.test(blob)) return ["ring_1", "ring_2"];
  if (/amulet|neck|ожерел|амулет|кулон/.test(blob)) return ["amulet"];
  if (/cloak|cape|плащ/.test(blob)) return ["cloak"];
  if (/boot|shoe|feet|сапог|ботин|обув/.test(blob)) return ["boots"];
  if (/glove|gauntlet|перчат|наруч/.test(blob)) return ["gloves"];
  if (/helmet|helm|head|hood|шлем|капюш|маск/.test(blob)) return ["head"];
  if (/armor|chest|robe|body|брон|доспех|кирас|одежд|мант/.test(blob)) return ["chest"];
  if (/shield|щит/.test(blob)) return ["off_hand"];
  if (/bow|crossbow|longbow|shortbow|арбалет|лук/.test(blob)) return ["ranged"];
  if (/staff|wand|dagger|sword|axe|mace|spear|hammer|weapon|посох|кинжал|меч|топор|булав|копь|молот/.test(blob)) {
    return ["main_hand", "off_hand"];
  }

  if (/accessory|jewel|jewelry|аксессуар|украш/.test(blob)) return ["amulet", "ring_1", "ring_2"];

  return ["main_hand"];
}

function getEquippedSlotForItem(itemId) {
  const equipment = getEquipmentState();
  return Object.entries(equipment).find(([, value]) => Number(value?.itemId) === Number(itemId))?.[0] || null;
}

function cleanupEquipmentState() {
  const equipment = getEquipmentState();
  let mutated = false;

  Object.keys(equipment).forEach((slotKey) => {
    const itemId = Number(equipment?.[slotKey]?.itemId);
    const item = findInventoryItemById(itemId);
    if (!item) {
      delete equipment[slotKey];
      mutated = true;
    }
  });

  if (mutated) saveEquipmentStateLocal();
}

function unequipItemFromAllSlots(itemId) {
  const equipment = getEquipmentState();
  let changed = false;

  Object.keys(equipment).forEach((slotKey) => {
    if (Number(equipment?.[slotKey]?.itemId) === Number(itemId)) {
      delete equipment[slotKey];
      changed = true;
    }
  });

  if (changed) saveEquipmentStateLocal();
  return changed;
}

function equipInventoryItem(itemId, slotKey) {
  const item = findInventoryItemById(itemId);
  if (!item) {
    showToast("Предмет не найден для экипировки");
    return false;
  }

  const allowed = inferItemSlotOptions(item);
  if (!allowed.includes(slotKey)) {
    showToast("Этот предмет нельзя надеть в выбранный слот");
    return false;
  }

  const equipment = getEquipmentState();
  unequipItemFromAllSlots(itemId);

  equipment[slotKey] = {
    itemId: Number(itemId),
    equippedAt: new Date().toISOString(),
  };

  saveEquipmentStateLocal();
  emitCabinetHistory({
    scope: "inventory",
    type: "equip_item",
    action: "equip_item",
    title: `Экипирован предмет: ${item?.name || "предмет"}`,
    message: `${item?.name || "Предмет"} надет в слот ${resolveSlotLabel(slotKey)}`,
    item_name: item?.name,
    slot: slotKey,
  });
  showToast(`Надето: ${item?.name || "предмет"} • ${resolveSlotLabel(slotKey)}`);
  return true;
}

function unequipSlot(slotKey) {
  const equipment = getEquipmentState();
  const itemId = Number(equipment?.[slotKey]?.itemId);
  const item = findInventoryItemById(itemId);
  if (!equipment?.[slotKey]) return false;

  delete equipment[slotKey];
  saveEquipmentStateLocal();
  emitCabinetHistory({
    scope: "inventory",
    type: "unequip_item",
    action: "unequip_item",
    title: `Снят предмет: ${item?.name || "предмет"}`,
    message: `${item?.name || "Предмет"} снят из слота ${resolveSlotLabel(slotKey)}`,
    item_name: item?.name,
    slot: slotKey,
  });
  showToast(`Снято: ${item?.name || "предмет"}`);
  return true;
}

function collectItemPassiveTexts(item) {
  const pieces = [];
  const pushValue = (value, label = "") => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((part) => pushValue(part, label));
      return;
    }
    if (typeof value === "object") {
      Object.values(value).forEach((part) => pushValue(part, label));
      return;
    }
    const text = String(value).trim();
    if (!text) return;
    pieces.push(label ? `${label}: ${text}` : text);
  };

  pushValue(item?.effect, "Эффект");
  pushValue(item?.abilities, "Способности");
  pushValue(item?.context_effects, "Контекст");
  pushValue(item?.condition_effects, "Условия");
  pushValue(item?.passive_effects, "Пассивно");
  pushValue(item?.properties, "Свойства");
  pushValue(item?.description, "Описание");

  return [...new Set(pieces)].filter(Boolean).slice(0, 4);
}

function renderEquippedEffectsTextSummary(effects, emptySlots) {
  if (!effects.length) {
    return `
      <div class="muted" style="font-size:0.82rem; line-height:1.45;">
        Сейчас ничего не надето. Пустых слотов: <strong>${emptySlots}</strong>. Когда наденешь предметы, тут появится обычная текстовая сводка по слотам и эффектам.
      </div>
    `;
  }

  const totalEffects = effects.reduce(
    (sum, entry) => sum + safeNumber(entry?.lines?.length, 0),
    0
  );
  const attunedCount = effects.filter((entry) => entry?.attunement).length;

  return `
    <div style="display:flex; flex-direction:column; gap:6px;">
      <div class="muted" style="font-size:0.82rem; line-height:1.45;">
        Надето предметов: <strong>${effects.length}</strong> из ${EQUIPMENT_SLOT_CONFIG.length}. Пустых слотов: <strong>${emptySlots}</strong>. Требуют настройки: <strong>${attunedCount}</strong>. Найдено эффектов: <strong>${totalEffects}</strong>.
      </div>

      ${effects
        .map((entry) => {
          const details = (entry?.lines || []).length
            ? entry.lines.join(" • ")
            : "Эффекты не заданы";
          const tail = entry?.attunement ? " Требует настройки." : "";

          return `
            <div class="muted" style="font-size:0.82rem; line-height:1.45;">
              <strong>${escapeHtml(entry.slot)}</strong> — ${escapeHtml(entry.itemName)}. ${escapeHtml(details)}${tail}
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderEquipmentPanel(items) {
  ensureCabinetInventoryStateDefaults();
  cleanupEquipmentState();

  const equipment = getEquipmentState();
  const effects = [];

  const slotsMarkup = EQUIPMENT_SLOT_CONFIG.map((slot) => {
    const equipped = equipment?.[slot.key];
    const item = equipped ? findInventoryItemById(equipped.itemId) : null;
    const itemId = getInventoryItemId(item);
    const rareClass = item ? rarityClass(item?.rarity) : "";
    const passiveLines = item ? collectItemPassiveTexts(item) : [];

    if (item) {
      effects.push({
        slot: slot.label,
        itemName: item?.name || "Предмет",
        lines: passiveLines,
        attunement: Boolean(item?.attunement),
      });
    }

    return `
      <div class="cabinet-block" style="padding:10px 12px; min-height:92px; display:flex; flex-direction:column; gap:6px; border-radius:16px;">
        <div class="flex-between" style="align-items:flex-start; gap:8px;">
          <strong style="font-size:0.86rem; line-height:1.15;">${escapeHtml(slot.label)}</strong>
          <span class="meta-item ${item ? escapeHtml(rareClass) : ""}" style="font-size:0.72rem;">${item ? escapeHtml(rarityLabel(item?.rarity)) : "Пусто"}</span>
        </div>

        ${item ? `
          <div class="${escapeHtml(rareClass)}" style="font-weight:800; line-height:1.2; font-size:0.86rem;">${escapeHtml(clampText(item?.name || "Предмет", 40))}</div>
          <div class="muted" style="font-size:0.78rem; line-height:1.3;">${escapeHtml(clampText((passiveLines || []).join(" • ") || "Эффекты не заданы", 96))}</div>
          <div class="cart-buttons" style="margin-top:auto; gap:6px; justify-content:flex-start;">
            <button class="btn" type="button" data-cabinet-open-desc="${escapeHtml(itemId)}" style="min-height:28px; padding:5px 8px; font-size:0.78rem;">Описание</button>
            <button class="btn btn-danger" type="button" data-cabinet-unequip-slot="${escapeHtml(slot.key)}" style="min-height:28px; padding:5px 8px; font-size:0.78rem;">Снять</button>
          </div>
        ` : `
          <div class="muted" style="font-size:0.8rem; line-height:1.3;">Ничего не надето.</div>
          <div class="muted" style="font-size:0.76rem; line-height:1.25; margin-top:auto;">Подходящий предмет можно надеть из списка ниже.</div>
        `}
      </div>
    `;
  }).join("");

  const equipped = getEquippedEntries();
  const emptySlots = Math.max(0, EQUIPMENT_SLOT_CONFIG.length - equipped.length);

  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
        <div>
          <h3 style="margin:0 0 4px 0; font-size:1rem;">🧷 Экипировка</h3>
          <div class="muted" style="font-size:0.8rem;">Сверху обычная текстовая сводка. Сами слоты открываются отдельным компактным блоком.</div>
        </div>

        <div class="cart-buttons">
          <button class="btn" type="button" id="cabinetToggleEquipmentBtn">${CABINET_INVENTORY_STATE.equipmentVisible ? "Скрыть слоты" : "Показать слоты"}</button>
        </div>
      </div>
    </div>

    <div class="cabinet-block" style="margin-bottom:12px; padding:10px 12px;">
      <h4 style="margin:0 0 8px 0; font-size:0.92rem;">✨ Что даёт надетое</h4>
      ${renderEquippedEffectsTextSummary(effects, emptySlots)}
    </div>

    ${CABINET_INVENTORY_STATE.equipmentVisible ? `
      <div class="cabinet-block" style="margin-bottom:12px; padding:10px 12px;">
        <h4 style="margin:0 0 8px 0; font-size:0.92rem;">Слоты экипировки</h4>
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px;">
          ${slotsMarkup}
        </div>
      </div>
    ` : ""}
  `;
}

function getCabinetFilteredInventory(items) {
  ensureCabinetInventoryStateDefaults();

  const search = String(CABINET_INVENTORY_STATE.search || "").trim().toLowerCase();
  const rarity = String(CABINET_INVENTORY_STATE.rarity || "").trim().toLowerCase();
  const magic = String(CABINET_INVENTORY_STATE.magic || "").trim().toLowerCase();
  const category = String(CABINET_INVENTORY_STATE.category || "").trim().toLowerCase();
  const equippedOnly = Boolean(CABINET_INVENTORY_STATE.equippedOnly);
  const sort = String(CABINET_INVENTORY_STATE.sort || "name");

  let result = Array.isArray(items) ? [...items] : [];

  if (search) {
    result = result.filter((item) => {
      const haystack = [
        item?.name,
        item?.category,
        item?.rarity,
        item?.description,
        item?.properties,
        item?.requirements,
      ].join(" ").toLowerCase();
      return haystack.includes(search);
    });
  }

  if (rarity) {
    result = result.filter((item) => normalizeRarityValue(item?.rarity) === rarity);
  }

  if (magic === "magic") {
    result = result.filter((item) => Boolean(item?.is_magical));
  }
  if (magic === "mundane") {
    result = result.filter((item) => !item?.is_magical);
  }

  if (category) {
    result = result.filter((item) => String(item?.category || "").trim().toLowerCase() === category);
  }

  if (equippedOnly) {
    result = result.filter((item) => Boolean(getEquippedSlotForItem(getInventoryItemId(item))));
  }

  if (sort === "price_asc") {
    result.sort((a, b) => moneyPartsToCp(a?.price_gold, a?.price_silver, a?.price_copper) - moneyPartsToCp(b?.price_gold, b?.price_silver, b?.price_copper));
  } else if (sort === "price_desc") {
    result.sort((a, b) => moneyPartsToCp(b?.price_gold, b?.price_silver, b?.price_copper) - moneyPartsToCp(a?.price_gold, a?.price_silver, a?.price_copper));
  } else if (sort === "rarity") {
    const order = { common: 1, uncommon: 2, rare: 3, 'very rare': 4, legendary: 5, artifact: 6 };
    result.sort((a, b) => (order[normalizeRarityValue(a?.rarity)] || 0) - (order[normalizeRarityValue(b?.rarity)] || 0));
  } else {
    result.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), "ru"));
  }

  return result;
}

function renderInventorySummary(items) {
  const equippedEntries = getEquippedEntries();
  const magicalCount = (Array.isArray(items) ? items : []).filter((item) => Boolean(item?.is_magical)).length;
  const customCount = (Array.isArray(items) ? items : []).filter((item) => Boolean(item?.is_custom)).length;

  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
        <div>
          <h3 style="margin:0 0 4px 0; font-size:1rem;">Инвентарь игрока</h3>
          <div class="muted" style="font-size:0.8rem;">Рабочий список предметов. Лишнее можно скрыть и оставить только нужные параметры.</div>
        </div>

        <div class="trader-meta" style="gap:6px; flex-wrap:wrap;">
          <span class="meta-item">🎒 Предметов: ${getInventoryCount(items)}</span>
          <span class="meta-item">✨ Магических: ${magicalCount}</span>
          <span class="meta-item">🛠 Custom: ${customCount}</span>
        </div>
      </div>

      <div>
        <div class="muted" style="font-size:0.74rem; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">Надето сейчас</div>
        ${renderEquippedItemsInlineSummary()}
      </div>
    </div>
  `;
}

function renderInventoryToolbar() {
  ensureCabinetInventoryStateDefaults();

  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="flex-between" style="align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
        <div class="cart-buttons" style="justify-content:flex-start; gap:6px;">
          <button class="btn" type="button" id="cabinetRefreshInventoryBtn">Обновить</button>
          <button class="btn" type="button" id="cabinetToggleInventoryFiltersBtn">${CABINET_INVENTORY_STATE.filtersVisible ? "Фильтры: скрыть" : "Фильтры: показать"}</button>
          <button class="btn btn-primary" type="button" id="cabinetAddCustomItemBtn">
            ${CABINET_INVENTORY_STATE.customFormOpen ? "Custom: скрыть" : "＋ Custom"}
          </button>
        </div>

        <div class="trader-meta" style="gap:6px; flex-wrap:wrap;">
          <span class="meta-item">Вид: ${escapeHtml(CABINET_INVENTORY_STATE.viewMode === "table" ? "Таблица" : CABINET_INVENTORY_STATE.viewMode === "grid" ? "Карточки" : "Список")}</span>
          ${CABINET_INVENTORY_STATE.equippedOnly ? `<span class="meta-item">Только надетое</span>` : ""}
          ${CABINET_INVENTORY_STATE.filtersVisible ? `<span class="meta-item">Фильтры открыты</span>` : ""}
        </div>
      </div>

      ${CABINET_INVENTORY_STATE.filtersVisible ? `
        <div class="collection-toolbar compact-collection-toolbar" style="margin-top:6px;">
          <div class="filter-group">
            <label>🔍 Поиск</label>
            <input id="cabinetInventorySearch" type="text" value="${escapeHtml(CABINET_INVENTORY_STATE.search)}" placeholder="Название, свойства, описание" />
          </div>

          <div class="filter-group">
            <label>🎖 Редкость</label>
            <select id="cabinetInventoryRarity">
              <option value="">Любая</option>
              <option value="common" ${CABINET_INVENTORY_STATE.rarity === "common" ? "selected" : ""}>Обычный</option>
              <option value="uncommon" ${CABINET_INVENTORY_STATE.rarity === "uncommon" ? "selected" : ""}>Необычный</option>
              <option value="rare" ${CABINET_INVENTORY_STATE.rarity === "rare" ? "selected" : ""}>Редкий</option>
              <option value="very rare" ${CABINET_INVENTORY_STATE.rarity === "very rare" ? "selected" : ""}>Очень редкий</option>
              <option value="legendary" ${CABINET_INVENTORY_STATE.rarity === "legendary" ? "selected" : ""}>Легендарный</option>
              <option value="artifact" ${CABINET_INVENTORY_STATE.rarity === "artifact" ? "selected" : ""}>Артефакт</option>
            </select>
          </div>

          <div class="filter-group">
            <label>✨ Магия</label>
            <select id="cabinetInventoryMagic">
              <option value="" ${CABINET_INVENTORY_STATE.magic === "" ? "selected" : ""}>Любая</option>
              <option value="magic" ${CABINET_INVENTORY_STATE.magic === "magic" ? "selected" : ""}>Только магические</option>
              <option value="mundane" ${CABINET_INVENTORY_STATE.magic === "mundane" ? "selected" : ""}>Только обычные</option>
            </select>
          </div>

          <div class="filter-group">
            <label>📦 Категория</label>
            <select id="cabinetInventoryCategory">
              <option value="">Любая</option>
              ${getInventoryCategories(getInventoryState())
                .map((category) => `<option value="${escapeHtml(category)}" ${String(CABINET_INVENTORY_STATE.category || "") === category ? "selected" : ""}>${escapeHtml(inventoryCategoryLabel(category))}</option>`)
                .join("")}
            </select>
          </div>

          <label class="inline-checkbox compact-inline-checkbox" style="margin-top:20px;">
            <input id="cabinetInventoryEquippedOnly" type="checkbox" ${CABINET_INVENTORY_STATE.equippedOnly ? "checked" : ""} />
            Только надетое
          </label>

          <div class="filter-group">
            <label>↕ Сортировка</label>
            <select id="cabinetInventorySort">
              <option value="name" ${CABINET_INVENTORY_STATE.sort === "name" ? "selected" : ""}>Название</option>
              <option value="price_asc" ${CABINET_INVENTORY_STATE.sort === "price_asc" ? "selected" : ""}>Дешёвые</option>
              <option value="price_desc" ${CABINET_INVENTORY_STATE.sort === "price_desc" ? "selected" : ""}>Дорогие</option>
              <option value="rarity" ${CABINET_INVENTORY_STATE.sort === "rarity" ? "selected" : ""}>Редкость</option>
            </select>
          </div>

          <div class="filter-group">
            <label>🧩 Вид</label>
            <select id="cabinetInventoryViewMode">
              <option value="inventory" ${CABINET_INVENTORY_STATE.viewMode === "inventory" ? "selected" : ""}>Список</option>
              <option value="table" ${CABINET_INVENTORY_STATE.viewMode === "table" ? "selected" : ""}>Таблица</option>
              <option value="grid" ${CABINET_INVENTORY_STATE.viewMode === "grid" ? "selected" : ""}>Карточки</option>
            </select>
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

function renderCustomItemForm() {
  if (!CABINET_INVENTORY_STATE.customFormOpen) return "";

  return `
    <div class="cabinet-block" id="cabinetCustomItemFormBlock" style="margin-bottom:12px;">
      <h3 style="margin:0 0 10px 0;">Кастомный предмет</h3>

      <div class="collection-toolbar compact-collection-toolbar">
        <div class="filter-group">
          <label>Название *</label>
          <input id="customItemName" type="text" placeholder="Например: Флакон чёрной крови" />
        </div>

        <div class="filter-group">
          <label>Количество</label>
          <input id="customItemQuantity" type="number" min="1" step="1" value="1" />
        </div>

        <div class="filter-group">
          <label>Категория</label>
          <input id="customItemCategory" type="text" value="прочее" />
        </div>

        <div class="filter-group">
          <label>Редкость</label>
          <select id="customItemRarity">
            <option value="common">common</option>
            <option value="uncommon">uncommon</option>
            <option value="rare">rare</option>
            <option value="very rare">very rare</option>
            <option value="legendary">legendary</option>
            <option value="artifact">artifact</option>
          </select>
        </div>

        <div class="filter-group">
          <label>Качество</label>
          <select id="customItemQuality">
            <option value="стандартное">стандартное</option>
            <option value="хорошее">хорошее</option>
            <option value="идеальное">идеальное</option>
          </select>
        </div>

        <div class="filter-group">
          <label>Слот</label>
          <select id="customItemEquipSlot">
            <option value="">Без слота</option>
            ${EQUIPMENT_SLOT_CONFIG.map((slot) => `<option value="${escapeHtml(slot.key)}">${escapeHtml(slot.label)}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="collection-toolbar compact-collection-toolbar">
        <div class="filter-group">
          <label>Цена (золото)</label>
          <input id="customItemPriceGold" type="number" min="0" step="1" value="0" />
        </div>

        <div class="filter-group">
          <label>Цена (серебро)</label>
          <input id="customItemPriceSilver" type="number" min="0" step="1" value="0" />
        </div>

        <div class="filter-group">
          <label>Цена (медь)</label>
          <input id="customItemPriceCopper" type="number" min="0" step="1" value="0" />
        </div>

        <div class="filter-group">
          <label>Вес</label>
          <input id="customItemWeight" type="number" min="0" step="0.1" value="0" />
        </div>

        <label class="inline-checkbox" style="margin-top:20px;">
          <input id="customItemMagical" type="checkbox" />
          <span>Магический</span>
        </label>

        <label class="inline-checkbox" style="margin-top:20px;">
          <input id="customItemAttunement" type="checkbox" />
          <span>Требует настройку</span>
        </label>
      </div>

      <div class="filter-group" style="margin-top:12px;">
        <label>Описание</label>
        <textarea id="customItemDescription" rows="4" placeholder="Краткое описание предмета"></textarea>
      </div>

      <div class="filter-group" style="margin-top:12px;">
        <label>Свойства / пассивки / механика</label>
        <textarea id="customItemProperties" rows="3" placeholder="Например: +1 к инициативе • иммунитет к яду • бонус к скрытности"></textarea>
      </div>

      <div class="filter-group" style="margin-top:12px;">
        <label>Требования</label>
        <textarea id="customItemRequirements" rows="2" placeholder="Например: только волшебник, уровень 5+"></textarea>
      </div>

      <div class="modal-actions" style="margin-top:12px; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-success" type="button" id="cabinetSaveCustomItemBtn">Добавить предмет</button>
        <button class="btn" type="button" id="cabinetResetCustomItemBtn">Сбросить</button>
      </div>

      <div class="muted" style="margin-top:10px;">
        Кастомные предметы сразу совместимы с инвентарём, описанием, продажей и новой системой экипировки.
      </div>
    </div>
  `;
}

function buildCustomItemFromForm() {
  const inventory = getInventoryState();
  const nextId = getNextCustomItemId(inventory);

  const name = safeText(getEl("customItemName")?.value, "").trim();
  const quantity = Math.max(1, safeNumber(getEl("customItemQuantity")?.value, 1));
  const category = safeText(getEl("customItemCategory")?.value, "прочее").trim() || "прочее";
  const rarity = normalizeRarityValue(getEl("customItemRarity")?.value || "common");
  const quality = normalizeQuality(getEl("customItemQuality")?.value || "стандартное");
  const weight = Math.max(0, safeNumber(getEl("customItemWeight")?.value, 0));
  const slot = safeText(getEl("customItemEquipSlot")?.value, "").trim();

  const priceGold = Math.max(0, safeNumber(getEl("customItemPriceGold")?.value, 0));
  const priceSilver = Math.max(0, safeNumber(getEl("customItemPriceSilver")?.value, 0));
  const priceCopper = Math.max(0, safeNumber(getEl("customItemPriceCopper")?.value, 0));

  const description = safeText(getEl("customItemDescription")?.value, "").trim();
  const properties = safeText(getEl("customItemProperties")?.value, "").trim();
  const requirements = safeText(getEl("customItemRequirements")?.value, "").trim();

  const isMagical = Boolean(getEl("customItemMagical")?.checked);
  const attunement = Boolean(getEl("customItemAttunement")?.checked);

  if (!name) throw new Error("Укажи название кастомного предмета");

  const baseCp = moneyPartsToCp(priceGold, priceSilver, priceCopper);
  const sellCp = baseCp > 0 ? Math.max(1, Math.floor(baseCp * 0.5)) : 0;
  const sellParts = cpToMoneyParts(sellCp);

  return {
    id: nextId,
    item_id: nextId,
    trader_id: null,
    local_id: `custom_${nextId}`,
    source: "cabinet_custom",
    is_custom: true,
    name,
    quantity,
    category,
    rarity,
    quality,
    weight,
    slot: slot || undefined,
    is_magical: isMagical,
    attunement,
    description,
    properties,
    requirements,
    price_gold: priceGold,
    price_silver: priceSilver,
    price_copper: priceCopper,
    base_price_gold: priceGold,
    base_price_silver: priceSilver,
    base_price_copper: priceCopper,
    sell_price_gold: sellParts.gold,
    sell_price_silver: sellParts.silver,
    sell_price_copper: sellParts.copper,
    stock: quantity,
  };
}

function resetCustomItemFormValues() {
  const defaults = {
    customItemName: "",
    customItemQuantity: "1",
    customItemCategory: "прочее",
    customItemRarity: "common",
    customItemQuality: "стандартное",
    customItemWeight: "0",
    customItemPriceGold: "0",
    customItemPriceSilver: "0",
    customItemPriceCopper: "0",
    customItemDescription: "",
    customItemProperties: "",
    customItemRequirements: "",
    customItemEquipSlot: "",
  };

  Object.entries(defaults).forEach(([id, value]) => {
    const el = getEl(id);
    if (el) el.value = value;
  });

  const magical = getEl("customItemMagical");
  if (magical) magical.checked = false;

  const attune = getEl("customItemAttunement");
  if (attune) attune.checked = false;
}

async function addCustomInventoryItem() {
  const inventory = getInventoryState();
  const customItem = buildCustomItemFromForm();

  const sameIndex = inventory.findIndex((entry) => {
    if (!entry?.is_custom) return false;
    return (
      String(entry.name || "").trim().toLowerCase() === customItem.name.toLowerCase() &&
      String(entry.category || "").trim().toLowerCase() === customItem.category.toLowerCase() &&
      String(entry.rarity || "").trim().toLowerCase() === customItem.rarity.toLowerCase() &&
      String(entry.description || "").trim() === customItem.description
    );
  });

  if (sameIndex >= 0) {
    inventory[sameIndex].quantity = Math.max(1, safeNumber(inventory[sameIndex].quantity, 1)) + customItem.quantity;
  } else {
    inventory.push(customItem);
  }

  syncInventoryToUi();
  await tryPersistInventoryToServer();
  renderCabinetInventory();

  emitCabinetHistory({
    scope: "inventory",
    type: "custom_item_add",
    action: "custom_item_add",
    title: `Добавлен кастомный предмет: ${customItem.name}`,
    message: [
      `Кол-во: ${customItem.quantity}`,
      `Категория: ${customItem.category}`,
      `Редкость: ${customItem.rarity}`,
      `Цена: ${formatPriceLabel(customItem)}`,
    ].join(" • "),
    item_name: customItem.name,
    category: customItem.category,
    quantity: customItem.quantity,
    price_label: formatPriceLabel(customItem),
  });

  showToast(`Добавлен кастомный предмет: ${customItem.name}`);
}

async function changeInventoryQuantity(itemId, delta) {
  const inventory = getInventoryState();
  const index = inventory.findIndex((entry) => Number(entry?.item_id ?? entry?.id) === Number(itemId));
  if (index < 0) {
    showToast("Предмет не найден");
    return;
  }

  inventory[index].quantity = Math.max(1, safeNumber(inventory[index].quantity, 1) + safeNumber(delta, 0));
  syncInventoryToUi();
  await tryPersistInventoryToServer();
  renderCabinetInventory();

  emitCabinetHistory({
    scope: "inventory",
    type: "inventory_quantity_update",
    action: "inventory_quantity_update",
    title: `Изменено количество: ${inventory[index].name || "предмет"}`,
    message: `Новое количество: ${inventory[index].quantity}`,
    item_name: inventory[index].name,
    quantity: inventory[index].quantity,
  });
}

async function removeInventoryEntryFromCabinet(itemId) {
  const inventory = getInventoryState();
  const index = inventory.findIndex((entry) => Number(entry?.item_id ?? entry?.id) === Number(itemId));
  if (index < 0) {
    showToast("Предмет не найден");
    return;
  }

  const [removed] = inventory.splice(index, 1);
  unequipItemFromAllSlots(itemId);

  syncInventoryToUi();
  await tryPersistInventoryToServer();
  renderCabinetInventory();

  emitCabinetHistory({
    scope: "inventory",
    type: "inventory_remove",
    action: "inventory_remove",
    title: `Удалён предмет: ${removed?.name || "предмет"}`,
    message: `Из инвентаря удалён ${removed?.name || "предмет"}`,
    item_name: removed?.name,
    quantity: removed?.quantity,
  });

  showToast(`Удалено из инвентаря: ${removed?.name || "предмет"}`);
}

function openCabinetItemDescription(item) {
  if (!item) {
    showToast("Описание предмета не найдено");
    return;
  }

  const modal = getEl("itemDescriptionModal");
  const root = getEl("itemDescriptionContent");
  if (!modal || !root) return;

  const rareClass = rarityClass(item?.rarity);
  const effects = collectItemPassiveTexts(item);
  const slotOptions = inferItemSlotOptions(item).map(resolveSlotLabel).join(", ");

  root.innerHTML = `
    <div class="trader-detail-section">
      <h2 class="${escapeHtml(rareClass)}" style="margin-bottom:8px;">${escapeHtml(item?.name || "Без названия")}</h2>

      <div class="inv-item-details" style="margin-bottom:10px;">
        <span class="${escapeHtml(rareClass)}">Редкость: ${escapeHtml(safeText(item?.rarity, "—"))}</span>
        <span>Категория: ${escapeHtml(safeText(item?.category, "—"))}</span>
        <span>Цена: ${escapeHtml(formatPriceLabel(item))}</span>
        <span>Количество: ${escapeHtml(safeText(item?.quantity, "1"))}</span>
        <span>Слоты: ${escapeHtml(slotOptions || "—")}</span>
        ${item?.attunement ? `<span>🔗 Требует настройку</span>` : ""}
        ${item?.is_magical ? `<span>✨ Магический</span>` : ""}
        ${item?.is_custom ? `<span>custom</span>` : ""}
      </div>

      ${item?.description ? `<div class="lss-rich-block" style="margin-bottom:10px;"><h4>Описание</h4><p>${escapeHtml(item.description)}</p></div>` : ""}
      ${item?.properties ? `<div class="lss-rich-block" style="margin-bottom:10px;"><h4>Свойства</h4><p>${escapeHtml(item.properties)}</p></div>` : ""}
      ${item?.requirements ? `<div class="lss-rich-block" style="margin-bottom:10px;"><h4>Требования</h4><p>${escapeHtml(item.requirements)}</p></div>` : ""}
      ${effects.length ? `<div class="lss-rich-block"><h4>Пассивки / эффекты</h4><p>${escapeHtml(effects.join(" • "))}</p></div>` : ""}
    </div>
  `;

  modal.style.display = "block";
}

function renderCabinetInventoryItemActions(item) {
  const itemId = getInventoryItemId(item);
  const equippedSlot = getEquippedSlotForItem(itemId);
  const allowedSlots = inferItemSlotOptions(item);
  const selectedSlot = CABINET_INVENTORY_STATE.slotSelections[itemId] || equippedSlot || allowedSlots[0] || "main_hand";

  const slotControl = allowedSlots.length > 1
    ? `
      <div class="filter-group" style="min-width:180px;">
        <label>Слот</label>
        <select data-cabinet-slot-select="${escapeHtml(itemId)}">
          ${allowedSlots
            .map((slotKey) => `<option value="${escapeHtml(slotKey)}" ${selectedSlot === slotKey ? "selected" : ""}>${escapeHtml(resolveSlotLabel(slotKey))}</option>`)
            .join("")}
        </select>
      </div>
    `
    : allowedSlots.length === 1
      ? `<div class="muted" style="font-size:0.8rem;">Слот: ${escapeHtml(resolveSlotLabel(allowedSlots[0]))}</div>`
      : `<div class="muted" style="font-size:0.8rem;">Без экипируемого слота</div>`;

  return `
    <div class="collection-toolbar compact-collection-toolbar" style="margin-top:8px; gap:6px; align-items:flex-end;">
      <div class="cart-buttons" style="gap:6px; justify-content:flex-start;">
        <button class="btn" type="button" data-cabinet-open-desc="${escapeHtml(itemId)}" style="min-height:28px; padding:5px 8px; font-size:0.78rem;">Описание</button>
        <button class="btn" type="button" data-cabinet-item-minus="${escapeHtml(itemId)}" style="min-height:28px; padding:5px 8px; font-size:0.78rem;">−1</button>
        <button class="btn" type="button" data-cabinet-item-plus="${escapeHtml(itemId)}" style="min-height:28px; padding:5px 8px; font-size:0.78rem;">＋1</button>
        <button class="btn btn-success" type="button" data-cabinet-sell-item="${escapeHtml(itemId)}" style="min-height:28px; padding:5px 8px; font-size:0.78rem;">Продать</button>
        <button class="btn btn-danger" type="button" data-cabinet-item-remove="${escapeHtml(itemId)}" style="min-height:28px; padding:5px 8px; font-size:0.78rem;">Удалить</button>
      </div>

      ${slotControl}

      <div class="cart-buttons" style="gap:6px;">
        ${allowedSlots.length ? `<button class="btn btn-primary" type="button" data-cabinet-equip-item="${escapeHtml(itemId)}" style="min-height:28px; padding:5px 8px; font-size:0.78rem;">${equippedSlot ? "Переэкипировать" : "Надеть"}</button>` : ""}
        ${equippedSlot ? `<button class="btn" type="button" data-cabinet-unequip-item="${escapeHtml(itemId)}" style="min-height:28px; padding:5px 8px; font-size:0.78rem;">Снять</button>` : ""}
      </div>
    </div>
  `;
}

function renderCabinetInventoryCard(item) {
  const rareClass = rarityClass(item?.rarity);
  const quantity = safeText(item?.quantity, "1");
  const rarity = rarityLabel(item?.rarity);
  const category = inventoryCategoryLabel(item?.category);
  const price = formatPriceLabel(item);
  const itemId = getInventoryItemId(item);
  const customBadge = item?.is_custom ? `<span class="meta-item">custom</span>` : "";
  const equippedSlot = getEquippedSlotForItem(itemId);
  const passiveShort = collectItemPassiveTexts(item).slice(0, 2).join(" • ");
  const shortDescription = clampText(item?.description, 120);

  return `
    <div class="inventory-item" style="padding:8px 0;">
      <div class="inventory-item-info">
        <div class="flex-between" style="align-items:flex-start; gap:8px; flex-wrap:wrap;">
          <div>
            <strong class="${escapeHtml(rareClass)}" style="font-size:0.92rem;">${escapeHtml(safeText(item?.name, "Без названия"))}</strong>
            <div class="inv-item-details" style="margin-top:4px; font-size:0.78rem; gap:5px 8px;">
              <span>Кол-во: ${escapeHtml(quantity)}</span>
              <span class="${escapeHtml(rareClass)}">Редкость: ${escapeHtml(rarity)}</span>
              <span>Категория: ${escapeHtml(category)}</span>
              <span>Цена: ${escapeHtml(price)}</span>
              ${item?.is_magical ? `<span>✨ магический</span>` : ""}
              ${item?.attunement ? `<span>🔗 настройка</span>` : ""}
              ${customBadge}
              ${equippedSlot ? `<span>🧷 ${escapeHtml(resolveSlotLabel(equippedSlot))}</span>` : ""}
            </div>
          </div>

          <div class="trader-meta" style="gap:6px;">
            ${equippedSlot ? `<span class="meta-item">Надето</span>` : ""}
          </div>
        </div>

        ${passiveShort ? `<div class="muted" style="margin-top:4px; font-size:0.78rem; line-height:1.28;">${escapeHtml(clampText(passiveShort, 110))}</div>` : ""}
        ${shortDescription ? `<div class="muted" style="margin-top:3px; font-size:0.78rem; line-height:1.28;">${escapeHtml(shortDescription)}</div>` : ""}

        ${renderCabinetInventoryItemActions(item)}
      </div>
    </div>
  `;
}

function renderCabinetInventoryGrid(items) {
  return `
    <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:10px;">
      ${items.map((item) => `<div class="cabinet-block" style="padding:10px 12px;">${renderCabinetInventoryCard(item)}</div>`).join("")}
    </div>
  `;
}

function renderCabinetInventoryTable(items) {
  return `
    <div class="table-wrap">
      <table class="items-table">
        <thead>
          <tr>
            <th>Предмет</th>
            <th>Редкость</th>
            <th>Кол-во</th>
            <th>Цена</th>
            <th>Слот</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => {
            const rareClass = rarityClass(item?.rarity);
            const itemId = getInventoryItemId(item);
            const equippedSlot = getEquippedSlotForItem(itemId);
            return `
              <tr>
                <td>
                  <div class="item-name ${escapeHtml(rareClass)}">${escapeHtml(safeText(item?.name, "Без названия"))}</div>
                  ${item?.description ? `<div class="muted" style="margin-top:3px; font-size:0.76rem; line-height:1.22;">${escapeHtml(clampText(item.description, 96))}</div>` : ""}
                </td>
                <td class="${escapeHtml(rareClass)}">${escapeHtml(safeText(item?.rarity, "—"))}</td>
                <td>${escapeHtml(safeText(item?.quantity, "1"))}</td>
                <td>${escapeHtml(formatPriceLabel(item))}</td>
                <td>${equippedSlot ? escapeHtml(resolveSlotLabel(equippedSlot)) : "—"}</td>
                <td>
                  <div class="item-actions item-actions-stack">
                    <button class="btn js-cabinet-desc" type="button" data-cabinet-open-desc="${escapeHtml(itemId)}">Описание</button>
                    <button class="btn" type="button" data-cabinet-item-minus="${escapeHtml(itemId)}">−1</button>
                    <button class="btn" type="button" data-cabinet-item-plus="${escapeHtml(itemId)}">＋1</button>
                    <button class="btn btn-success" type="button" data-cabinet-sell-item="${escapeHtml(itemId)}">Продать</button>
                    ${equippedSlot
                      ? `<button class="btn" type="button" data-cabinet-unequip-item="${escapeHtml(itemId)}">Снять</button>`
                      : `<button class="btn btn-primary" type="button" data-cabinet-equip-item="${escapeHtml(itemId)}">Надеть</button>`}
                    <button class="btn btn-danger" type="button" data-cabinet-item-remove="${escapeHtml(itemId)}">Удалить</button>
                  </div>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderInventoryList(items) {
  const filtered = getCabinetFilteredInventory(items);

  if (!filtered.length) {
    return `
      <div class="cabinet-block">
        <p>Ничего не найдено. Попробуй изменить фильтры или добавить кастомный предмет.</p>
      </div>
    `;
  }

  if (CABINET_INVENTORY_STATE.viewMode === "table") {
    return `<div class="cabinet-block">${renderCabinetInventoryTable(filtered)}</div>`;
  }

  if (CABINET_INVENTORY_STATE.viewMode === "grid") {
    return `<div class="cabinet-block">${renderCabinetInventoryGrid(filtered)}</div>`;
  }

  return `
    <div class="cabinet-block">
      <div class="inventory-list">
        ${filtered.map((item) => renderCabinetInventoryCard(item)).join("")}
      </div>
    </div>
  `;
}

function renderCabinetInventory() {
  const container = getEl("cabinet-inventory");
  if (!container) return;

  ensureCabinetInventoryStateDefaults();
  const inventory = getInventoryState();

  container.innerHTML = `
    ${renderInventorySummary(inventory)}
    ${renderInventoryToolbar()}
    ${renderEquipmentPanel(inventory)}
    ${renderCustomItemForm()}
    ${renderInventoryList(inventory)}
  `;

  bindInventoryActions();
}

function bindCabinetInventoryFilter(id, stateKey, normalizer = (value) => value) {
  const el = getEl(id);
  if (!el || el.dataset.boundCabinetInventoryFilter === "1") return;
  el.dataset.boundCabinetInventoryFilter = "1";
  el.addEventListener("input", () => {
    CABINET_INVENTORY_STATE[stateKey] = normalizer(el.value);
    renderCabinetInventory();
  });
  el.addEventListener("change", () => {
    CABINET_INVENTORY_STATE[stateKey] = normalizer(el.value);
    renderCabinetInventory();
  });
}

function bindInventoryActions() {
  ensureCabinetInventoryStateDefaults();

  const refreshBtn = getEl("cabinetRefreshInventoryBtn");
  if (refreshBtn && refreshBtn.dataset.boundRefreshInventory !== "1") {
    refreshBtn.dataset.boundRefreshInventory = "1";
    refreshBtn.addEventListener("click", () => {
      syncInventoryToUi();
      renderCabinetInventory();
      showToast("Инвентарь в кабинете обновлён");
    });
  }

  const addCustomBtn = getEl("cabinetAddCustomItemBtn");
  if (addCustomBtn && addCustomBtn.dataset.boundAddCustom !== "1") {
    addCustomBtn.dataset.boundAddCustom = "1";
    addCustomBtn.addEventListener("click", () => {
      CABINET_INVENTORY_STATE.customFormOpen = !CABINET_INVENTORY_STATE.customFormOpen;
      renderCabinetInventory();
    });
  }

  const toggleFiltersBtn = getEl("cabinetToggleInventoryFiltersBtn");
  if (toggleFiltersBtn && toggleFiltersBtn.dataset.boundToggleFilters !== "1") {
    toggleFiltersBtn.dataset.boundToggleFilters = "1";
    toggleFiltersBtn.addEventListener("click", () => {
      CABINET_INVENTORY_STATE.filtersVisible = !CABINET_INVENTORY_STATE.filtersVisible;
      renderCabinetInventory();
    });
  }

  const toggleEquipmentBtn = getEl("cabinetToggleEquipmentBtn");
  if (toggleEquipmentBtn && toggleEquipmentBtn.dataset.boundToggleEquipment !== "1") {
    toggleEquipmentBtn.dataset.boundToggleEquipment = "1";
    toggleEquipmentBtn.addEventListener("click", () => {
      CABINET_INVENTORY_STATE.equipmentVisible = !CABINET_INVENTORY_STATE.equipmentVisible;
      renderCabinetInventory();
    });
  }

  bindCabinetInventoryFilter("cabinetInventorySearch", "search", (value) => String(value || ""));
  bindCabinetInventoryFilter("cabinetInventoryRarity", "rarity", (value) => String(value || "").trim().toLowerCase());
  bindCabinetInventoryFilter("cabinetInventoryMagic", "magic", (value) => String(value || "").trim().toLowerCase());
  bindCabinetInventoryFilter("cabinetInventoryCategory", "category", (value) => String(value || "").trim().toLowerCase());
  bindCabinetInventoryFilter("cabinetInventorySort", "sort", (value) => String(value || "name"));
  bindCabinetInventoryFilter("cabinetInventoryViewMode", "viewMode", (value) => String(value || "inventory"));

  const equippedOnly = getEl("cabinetInventoryEquippedOnly");
  if (equippedOnly && equippedOnly.dataset.boundCabinetInventoryEquippedOnly !== "1") {
    equippedOnly.dataset.boundCabinetInventoryEquippedOnly = "1";
    equippedOnly.addEventListener("change", () => {
      CABINET_INVENTORY_STATE.equippedOnly = Boolean(equippedOnly.checked);
      renderCabinetInventory();
    });
  }

  const saveCustomBtn = getEl("cabinetSaveCustomItemBtn");
  if (saveCustomBtn && saveCustomBtn.dataset.boundSaveCustomItem !== "1") {
    saveCustomBtn.dataset.boundSaveCustomItem = "1";
    saveCustomBtn.addEventListener("click", async () => {
      try {
        await addCustomInventoryItem();
      } catch (error) {
        console.error(error);
        showToast(error?.message || "Не удалось добавить кастомный предмет");
      }
    });
  }

  const resetCustomBtn = getEl("cabinetResetCustomItemBtn");
  if (resetCustomBtn && resetCustomBtn.dataset.boundResetCustomItem !== "1") {
    resetCustomBtn.dataset.boundResetCustomItem = "1";
    resetCustomBtn.addEventListener("click", () => {
      resetCustomItemFormValues();
      showToast("Форма кастомного предмета очищена");
    });
  }

  document.querySelectorAll("[data-cabinet-item-plus]").forEach((btn) => {
    if (btn.dataset.boundCabinetItemPlus === "1") return;
    btn.dataset.boundCabinetItemPlus = "1";
    btn.addEventListener("click", async () => {
      await changeInventoryQuantity(Number(btn.dataset.cabinetItemPlus), 1);
    });
  });

  document.querySelectorAll("[data-cabinet-item-minus]").forEach((btn) => {
    if (btn.dataset.boundCabinetItemMinus === "1") return;
    btn.dataset.boundCabinetItemMinus = "1";
    btn.addEventListener("click", async () => {
      await changeInventoryQuantity(Number(btn.dataset.cabinetItemMinus), -1);
    });
  });

  document.querySelectorAll("[data-cabinet-item-remove]").forEach((btn) => {
    if (btn.dataset.boundCabinetItemRemove === "1") return;
    btn.dataset.boundCabinetItemRemove = "1";
    btn.addEventListener("click", async () => {
      const itemId = Number(btn.dataset.cabinetItemRemove);
      if (!confirm("Удалить предмет из инвентаря?")) return;
      await removeInventoryEntryFromCabinet(itemId);
    });
  });

  document.querySelectorAll("[data-cabinet-open-desc]").forEach((btn) => {
    if (btn.dataset.boundCabinetOpenDesc === "1") return;
    btn.dataset.boundCabinetOpenDesc = "1";
    btn.addEventListener("click", () => {
      const item = findInventoryItemById(Number(btn.dataset.cabinetOpenDesc));
      openCabinetItemDescription(item);
    });
  });

  document.querySelectorAll("[data-cabinet-slot-select]").forEach((select) => {
    if (select.dataset.boundCabinetSlotSelect === "1") return;
    select.dataset.boundCabinetSlotSelect = "1";
    select.addEventListener("change", () => {
      CABINET_INVENTORY_STATE.slotSelections[Number(select.dataset.cabinetSlotSelect)] = String(select.value || "main_hand");
    });
  });

  document.querySelectorAll("[data-cabinet-equip-item]").forEach((btn) => {
    if (btn.dataset.boundCabinetEquipItem === "1") return;
    btn.dataset.boundCabinetEquipItem = "1";
    btn.addEventListener("click", async () => {
      const itemId = Number(btn.dataset.cabinetEquipItem);
      const selectedSlot = CABINET_INVENTORY_STATE.slotSelections[itemId] || inferItemSlotOptions(findInventoryItemById(itemId))[0] || "main_hand";
      const ok = equipInventoryItem(itemId, selectedSlot);
      if (!ok) return;
      await tryPersistInventoryToServer();
      renderCabinetInventory();
    });
  });

  document.querySelectorAll("[data-cabinet-unequip-item]").forEach((btn) => {
    if (btn.dataset.boundCabinetUnequipItem === "1") return;
    btn.dataset.boundCabinetUnequipItem = "1";
    btn.addEventListener("click", async () => {
      const itemId = Number(btn.dataset.cabinetUnequipItem);
      const slotKey = getEquippedSlotForItem(itemId);
      if (!slotKey) return;
      unequipSlot(slotKey);
      await tryPersistInventoryToServer();
      renderCabinetInventory();
    });
  });

  document.querySelectorAll("[data-cabinet-unequip-slot]").forEach((btn) => {
    if (btn.dataset.boundCabinetUnequipSlot === "1") return;
    btn.dataset.boundCabinetUnequipSlot = "1";
    btn.addEventListener("click", async () => {
      unequipSlot(String(btn.dataset.cabinetUnequipSlot || ""));
      await tryPersistInventoryToServer();
      renderCabinetInventory();
    });
  });

  document.querySelectorAll("[data-cabinet-sell-item]").forEach((btn) => {
    if (btn.dataset.boundCabinetSellItem === "1") return;
    btn.dataset.boundCabinetSellItem = "1";
    btn.addEventListener("click", async () => {
      const itemId = Number(btn.dataset.cabinetSellItem);
      const item = findInventoryItemById(itemId);
      const itemQuantity = Math.max(1, safeNumber(item?.quantity, 1));
      const ok = confirm(`Продать 1 × ${item?.name || "предмет"}?`);
      if (!ok) return;
      const result = await window.sellItem?.(itemId, 1, { reopenTraderModal: false });
      if (!result?.success) return;
      if (itemQuantity <= 1) {
        unequipItemFromAllSlots(itemId);
      }
      renderCabinetInventory();
    });
  });
}


// ------------------------------------------------------------
// 📁 FILES
// ------------------------------------------------------------
function getFilesStorageKey() {
  return getUserScopedKey("cabinetFiles");
}

function saveFilesLocal(items) {
  try {
    localStorage.setItem(getFilesStorageKey(), JSON.stringify(items));
  } catch (_) {}
}

function loadFilesLocal() {
  try {
    const raw = localStorage.getItem(getFilesStorageKey());
    if (!raw) return null;
    const parsed = tryParseJson(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildFileId() {
  return `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCabinetFile(item, index = 0) {
  if (!item || typeof item !== "object") {
    return {
      id: buildFileId(),
      name: `file_${index + 1}`,
      dataUrl: "",
      type: "",
      size: 0,
      created_at: new Date().toISOString(),
    };
  }

  return {
    id: item.id || buildFileId(),
    name: safeText(item.name, `file_${index + 1}`),
    dataUrl: safeText(item.dataUrl || item.url || item.href || "", ""),
    type: safeText(item.type, ""),
    size: Math.max(0, safeNumber(item.size, 0)),
    created_at: safeText(item.created_at || item.createdAt, new Date().toISOString()),
  };
}

async function loadFiles() {
  let data = await apiGet([
    "/player/profile",
    "/profile/me",
    "/player/files",
    "/files",
  ]);
  let source = "api";

  let items = [];

  if (Array.isArray(data)) {
    items = data;
  } else if (Array.isArray(data?.files)) {
    items = data.files;
  } else if (Array.isArray(data?.cabinet_files)) {
    items = data.cabinet_files;
  } else if (Array.isArray(data?.player_files)) {
    items = data.player_files;
  } else if (Array.isArray(data?.profile?.files)) {
    items = data.profile.files;
  } else if (Array.isArray(data?.profile?.cabinet_files)) {
    items = data.profile.cabinet_files;
  }

  if (!items.length) {
    const local = loadFilesLocal();
    if (Array.isArray(local) && local.length) {
      items = local;
      source = "local";
    }
  }

  FILES_STATE.items = (Array.isArray(items) ? items : []).map(normalizeCabinetFile);
  FILES_STATE.loaded = true;
  FILES_STATE.source = FILES_STATE.items.length ? source : source === "api" ? "api" : "empty";
  FILES_STATE.draggedIndex = null;

  renderFiles();
}

async function saveFiles() {
  FILES_STATE.isSaving = true;
  saveFilesLocal(FILES_STATE.items);

  try {
    await apiWrite(
      ["/player/profile", "/profile/me", "/player/files", "/files"],
      {
        files: FILES_STATE.items,
        cabinet_files: FILES_STATE.items,
        player_files: FILES_STATE.items,
      },
      ["POST", "PUT", "PATCH"]
    );

    FILES_STATE.source = "api";
  } catch (_) {
    FILES_STATE.source = "local";
  }

  FILES_STATE.lastSavedAt = new Date().toISOString();
  FILES_STATE.isSaving = false;
}

async function handleFileUpload(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) {
    showToast("Файлы не выбраны");
    return;
  }

  const prepared = [];

  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file);

    prepared.push(
      normalizeCabinetFile({
        id: buildFileId(),
        name: file.name,
        dataUrl,
        type: file.type,
        size: file.size,
        created_at: new Date().toISOString(),
      })
    );
  }

  FILES_STATE.items = [...FILES_STATE.items, ...prepared];
  await saveFiles();
  renderFiles();

  prepared.forEach((file) => {
    emitCabinetHistory({
      scope: "files",
      type: "file_upload",
      action: "file_upload",
      title: `Загружен файл: ${file.name}`,
      message: `Тип: ${fileTypeLabel(file.type)} • Размер: ${formatBytes(file.size)}`,
      file_name: file.name,
      size: formatBytes(file.size),
    });
  });

  showToast(`Загружено файлов: ${prepared.length}`);
}

async function removeCabinetFile(fileId) {
  const index = FILES_STATE.items.findIndex((file) => file.id === fileId);
  if (index < 0) {
    showToast("Файл не найден");
    return;
  }

  const [removed] = FILES_STATE.items.splice(index, 1);
  await saveFiles();
  renderFiles();

  emitCabinetHistory({
    scope: "files",
    type: "file_delete",
    action: "file_delete",
    title: `Удалён файл: ${removed.name}`,
    message: `Размер: ${formatBytes(removed.size)}`,
    file_name: removed.name,
    size: formatBytes(removed.size),
  });

  showToast(`Удалён файл: ${removed.name}`);
}

async function moveCabinetFile(fromIndex, toIndex) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= FILES_STATE.items.length ||
    toIndex >= FILES_STATE.items.length
  ) {
    return;
  }

  const copy = [...FILES_STATE.items];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);

  FILES_STATE.items = copy;
  await saveFiles();
  renderFiles();

  emitCabinetHistory({
    scope: "files",
    type: "file_reorder",
    action: "file_reorder",
    title: `Изменён порядок файлов`,
    message: `Файл: ${moved.name}`,
    file_name: moved.name,
  });
}

function renderFilesToolbar() {
  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="flex-between" style="align-items:center; gap:12px; flex-wrap:wrap;">
        <div>
          <h3 style="margin:0 0 4px 0;">Файлы игрока</h3>
          <div class="muted">
            Local-first модуль. Можно загружать, скачивать, удалять и перетаскивать файлы.
          </div>
        </div>

        <div class="cart-buttons">
          <button class="btn" type="button" id="cabinetFilesRefreshBtn">Обновить</button>
          <button class="btn btn-primary" type="button" id="cabinetFilesUploadBtn">Загрузить</button>
          <input type="file" id="cabinetFileInput" multiple style="display:none;" />
        </div>
      </div>

      <div class="muted" style="margin-top:10px;">
        Источник: <strong>${escapeHtml(FILES_STATE.source)}</strong>
        • Файлов: <strong>${escapeHtml(String(FILES_STATE.items.length))}</strong>
        • Последнее сохранение: <strong>${escapeHtml(formatTime(FILES_STATE.lastSavedAt))}</strong>
      </div>
    </div>
  `;
}

function renderFilesList() {
  if (!FILES_STATE.items.length) {
    return `
      <div class="cabinet-block">
        <p>Файлов пока нет.</p>
      </div>
    `;
  }

  return `
    <div class="cabinet-block">
      <div class="inventory-list" id="cabinetFilesList">
        ${FILES_STATE.items
          .map((file, index) => {
            return `
              <div
                class="inventory-item cabinet-file-item"
                draggable="true"
                data-file-id="${escapeHtml(file.id)}"
                data-file-index="${escapeHtml(index)}"
              >
                <div class="inventory-item-info">
                  <strong>${escapeHtml(file.name)}</strong>

                  <div class="inv-item-details">
                    <span>Тип: ${escapeHtml(fileTypeLabel(file.type))}</span>
                    <span>Размер: ${escapeHtml(formatBytes(file.size))}</span>
                    <span>Добавлен: ${escapeHtml(formatDateTime(file.created_at))}</span>
                  </div>
                </div>

                <div class="cart-buttons">
                  <a
                    class="btn"
                    href="${escapeHtml(file.dataUrl)}"
                    download="${escapeHtml(file.name)}"
                  >
                    Скачать
                  </a>
                  <button class="btn btn-danger" type="button" data-file-remove="${escapeHtml(file.id)}">Удалить</button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>

      <div class="muted" style="margin-top:10px;">
        Можно перетаскивать файлы мышью, чтобы менять порядок.
      </div>
    </div>
  `;
}

function renderFiles() {
  const container = getEl("cabinet-files");
  if (!container) return;

  if (!FILES_STATE.loaded) {
    container.innerHTML = `
      ${renderFilesToolbar()}
      <div class="cabinet-block">
        <p>Модуль файлов ещё не загружен.</p>
      </div>
    `;
    bindFilesActions();
    return;
  }

  container.innerHTML = `
    ${renderFilesToolbar()}
    ${renderFilesList()}
  `;

  bindFilesActions();
}

function bindFilesActions() {
  const refreshBtn = getEl("cabinetFilesRefreshBtn");
  if (refreshBtn && refreshBtn.dataset.boundFilesRefresh !== "1") {
    refreshBtn.dataset.boundFilesRefresh = "1";
    refreshBtn.addEventListener("click", async () => {
      await loadFiles();
      showToast("Файлы обновлены");
    });
  }

  const uploadBtn = getEl("cabinetFilesUploadBtn");
  const input = getEl("cabinetFileInput");

  if (uploadBtn && uploadBtn.dataset.boundFilesUploadBtn !== "1") {
    uploadBtn.dataset.boundFilesUploadBtn = "1";
    uploadBtn.addEventListener("click", () => {
      input?.click();
    });
  }

  if (input && input.dataset.boundFilesInput !== "1") {
    input.dataset.boundFilesInput = "1";
    input.addEventListener("change", async () => {
      try {
        await handleFileUpload(input.files);
      } catch (error) {
        console.error(error);
        showToast("Не удалось загрузить файлы");
      } finally {
        input.value = "";
      }
    });
  }

  document.querySelectorAll("[data-file-remove]").forEach((btn) => {
    if (btn.dataset.boundFileRemove !== "1") {
      btn.dataset.boundFileRemove = "1";
      btn.addEventListener("click", async () => {
        const ok = confirm("Удалить файл?");
        if (!ok) return;

        const id = btn.dataset.fileRemove;
        await removeCabinetFile(id);
      });
    }
  });

  document.querySelectorAll(".cabinet-file-item").forEach((item) => {
    if (item.dataset.boundFileDrag !== "1") {
      item.dataset.boundFileDrag = "1";

      item.addEventListener("dragstart", (event) => {
        FILES_STATE.draggedIndex = Number(item.dataset.fileIndex);
        item.style.opacity = "0.45";
        try {
          event.dataTransfer.effectAllowed = "move";
        } catch (_) {}
      });

      item.addEventListener("dragend", () => {
        item.style.opacity = "";
        FILES_STATE.draggedIndex = null;
      });

      item.addEventListener("dragover", (event) => {
        event.preventDefault();
        item.style.outline = "1px dashed rgba(134, 203, 211, 0.35)";
      });

      item.addEventListener("dragleave", () => {
        item.style.outline = "";
      });

      item.addEventListener("drop", async (event) => {
        event.preventDefault();
        item.style.outline = "";

        const toIndex = Number(item.dataset.fileIndex);
        const fromIndex = Number(FILES_STATE.draggedIndex);

        await moveCabinetFile(fromIndex, toIndex);
      });
    }
  });
}

// ------------------------------------------------------------
// 🛡️ GM-ONLY NOTES
// ------------------------------------------------------------
function getGmNotesStorageKey() {
  return getUserScopedKey("gmPrivateNotes");
}

function saveLocalGmNotes(payload) {
  try {
    localStorage.setItem(getGmNotesStorageKey(), JSON.stringify(payload));
  } catch (_) {}
}

function loadLocalGmNotes() {
  try {
    const raw = localStorage.getItem(getGmNotesStorageKey());
    if (!raw) return null;
    return tryParseJson(raw);
  } catch {
    return null;
  }
}

function getGmNotesTextareaValue() {
  const textarea = getEl("gmPrivateNotesTextarea");
  if (!textarea) return GM_NOTES_STATE.text || "";
  return textarea.value ?? "";
}

async function loadGmNotes() {
  if (CABINET_STATE.role !== "gm") {
    GM_NOTES_STATE.loaded = true;
    GM_NOTES_STATE.source = "forbidden";
    GM_NOTES_STATE.text = "";
    GM_NOTES_STATE.raw = "";
    return "";
  }

  let data = await apiGet([
    "/player/notes",
    "/notes/me",
    "/notes",
  ]);
  let source = "api";

  let text = "";

  if (data) {
    text =
      safeText(
        data?.gm_private_notes ??
        data?.gm_private ??
        data?.gm_private_text ??
        data?.gm_internal_notes ??
        data?.private_gm_notes,
        ""
      );
  }

  if (!text) {
    const local = loadLocalGmNotes();
    if (local) {
      text = safeText(local.text ?? local.notes ?? "", "");
      source = "local";
    }
  }

  GM_NOTES_STATE.text = text;
  GM_NOTES_STATE.raw = text;
  GM_NOTES_STATE.loaded = true;
  GM_NOTES_STATE.source = text ? source : source === "api" ? "api" : "empty";

  saveLocalGmNotes({
    text: GM_NOTES_STATE.text,
    updated_at: GM_NOTES_STATE.lastSavedAt,
  });

  return GM_NOTES_STATE.text;
}

async function saveGmNotes() {
  if (CABINET_STATE.role !== "gm") {
    showToast("Недостаточно прав");
    return false;
  }

  const previousText = GM_NOTES_STATE.text || "";
  const nextText = getGmNotesTextareaValue();

  GM_NOTES_STATE.text = nextText;
  GM_NOTES_STATE.raw = nextText;
  GM_NOTES_STATE.isSaving = true;
  renderGmNotes();

  saveLocalGmNotes({
    text: nextText,
    updated_at: new Date().toISOString(),
  });

  try {
    await apiWrite(
      ["/player/notes", "/notes/me", "/notes"],
      {
        gm_private_notes: nextText,
        gm_private: nextText,
        gm_private_text: nextText,
        gm_internal_notes: nextText,
        private_gm_notes: nextText,
      },
      ["POST", "PUT", "PATCH"]
    );

    GM_NOTES_STATE.source = "api";
  } catch (_) {
    GM_NOTES_STATE.source = "local";
  }

  GM_NOTES_STATE.lastSavedAt = new Date().toISOString();
  GM_NOTES_STATE.isSaving = false;
  renderGmNotes();

  if (previousText !== nextText) {
    emitCabinetHistory({
      scope: "gm",
      type: "gm_private_notes_save",
      action: "gm_private_notes_save",
      title: "Обновлены приватные заметки ГМа",
      message: nextText
        ? `Символов: ${nextText.length}`
        : "Приватные заметки ГМа очищены",
    });
  }

  showToast("GM-only заметки сохранены");
  return true;
}

async function clearGmNotes() {
  if (CABINET_STATE.role !== "gm") {
    showToast("Недостаточно прав");
    return false;
  }

  GM_NOTES_STATE.text = "";
  GM_NOTES_STATE.raw = "";
  saveLocalGmNotes({
    text: "",
    updated_at: new Date().toISOString(),
  });

  try {
    await apiWrite(
      ["/player/notes", "/notes/me", "/notes"],
      {
        gm_private_notes: "",
        gm_private: "",
        gm_private_text: "",
        gm_internal_notes: "",
        private_gm_notes: "",
      },
      ["POST", "PUT", "PATCH"]
    );

    GM_NOTES_STATE.source = "api";
  } catch (_) {
    GM_NOTES_STATE.source = "local";
  }

  GM_NOTES_STATE.lastSavedAt = new Date().toISOString();
  renderGmNotes();

  emitCabinetHistory({
    scope: "gm",
    type: "gm_private_notes_clear",
    action: "gm_private_notes_clear",
    title: "Очищены приватные заметки ГМа",
    message: "GM-only блок очищен",
  });

  showToast("GM-only заметки очищены");
  return true;
}

function renderGmNotes() {
  const container = getEl("cabinet-gmnotes");
  if (!container) return;

  if (CABINET_STATE.role !== "gm") {
    container.innerHTML = `
      <div class="cabinet-block">
        <h3>Заметки ГМа</h3>
        <p>Недостаточно прав для просмотра.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="cabinet-block">
      <h3>Заметки ГМа</h3>

      <div class="muted" style="margin-bottom:10px;">
        Это <strong>приватный GM-only блок</strong>. Игрок эти заметки не видит.
        В отличие от вкладки <strong>«Заметки»</strong>, здесь можно хранить скрытые факты,
        планы сцен, последствия, секреты, крючки и служебные пометки.
      </div>

      <div class="muted" style="margin-bottom:10px;">
        Источник: <strong>${escapeHtml(GM_NOTES_STATE.source)}</strong>
        • Последнее сохранение: <strong>${escapeHtml(formatTime(GM_NOTES_STATE.lastSavedAt))}</strong>
      </div>

      <textarea
        id="gmPrivateNotesTextarea"
        rows="18"
        style="width:100%;"
        placeholder="Сюда ГМ может писать скрытые заметки, которые не должны видеть игроки"
      >${escapeHtml(GM_NOTES_STATE.text || "")}</textarea>

      <div class="modal-actions" style="margin-top:12px; gap:8px; flex-wrap:wrap;">
        <button id="saveGmNotesBtn" class="btn btn-success" ${GM_NOTES_STATE.isSaving ? "disabled" : ""}>
          ${GM_NOTES_STATE.isSaving ? "Сохраняю..." : "Сохранить"}
        </button>

        <button id="reloadGmNotesBtn" class="btn">Обновить</button>
        <button id="clearGmNotesBtn" class="btn btn-danger">Очистить</button>
      </div>
    </div>
  `;

  bindGmNotesActions();
}

function bindGmNotesActions() {
  const textarea = getEl("gmPrivateNotesTextarea");
  const saveBtn = getEl("saveGmNotesBtn");
  const reloadBtn = getEl("reloadGmNotesBtn");
  const clearBtn = getEl("clearGmNotesBtn");

  if (textarea && textarea.dataset.boundGmPrivateInput !== "1") {
    textarea.dataset.boundGmPrivateInput = "1";
    textarea.addEventListener("input", () => {
      GM_NOTES_STATE.text = textarea.value;
      GM_NOTES_STATE.raw = textarea.value;

      saveLocalGmNotes({
        text: GM_NOTES_STATE.text,
        updated_at: new Date().toISOString(),
      });
    });
  }

  if (saveBtn && saveBtn.dataset.boundGmPrivateSave !== "1") {
    saveBtn.dataset.boundGmPrivateSave = "1";
    saveBtn.addEventListener("click", async () => {
      await saveGmNotes();
    });
  }

  if (reloadBtn && reloadBtn.dataset.boundGmPrivateReload !== "1") {
    reloadBtn.dataset.boundGmPrivateReload = "1";
    reloadBtn.addEventListener("click", async () => {
      await loadGmNotes();
      renderGmNotes();
      showToast("GM-only заметки обновлены");
    });
  }

  if (clearBtn && clearBtn.dataset.boundGmPrivateClear !== "1") {
    clearBtn.dataset.boundGmPrivateClear = "1";
    clearBtn.addEventListener("click", async () => {
      const ok = confirm("Очистить приватные заметки ГМа?");
      if (!ok) return;
      await clearGmNotes();
    });
  }
}

// ------------------------------------------------------------
// 🛡️ MASTER ROOM
// ------------------------------------------------------------
function getMasterRoomStorageKey() {
  return getUserScopedKey("masterRoom");
}

function normalizeMasterRoomVisibility(value) {
  const raw = String(value || "").trim().toLowerCase();
  return ["private", "basic", "sheet", "full"].includes(raw) ? raw : "basic";
}

function normalizeMasterRoomScope(value) {
  const raw = String(value || "").trim().toLowerCase();
  return ["public", "gm_only", "owner_only", "revealed"].includes(raw) ? raw : "owner_only";
}

function normalizeMasterRoomRole(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "gm" ? "gm" : "player";
}

function masterRoomVisibilityLabel(value) {
  const preset = normalizeMasterRoomVisibility(value);
  if (preset === "private") return "owner only";
  if (preset === "sheet") return "sheet";
  if (preset === "full") return "full";
  return "public/basic";
}

function masterRoomScopeLabel(value) {
  const scope = normalizeMasterRoomScope(value);
  if (scope === "public") return "public";
  if (scope === "gm_only") return "GM only";
  if (scope === "revealed") return "revealed";
  return "owner only";
}

function getDefaultMasterRoomVisibilityMatrix(preset = "basic") {
  const normalized = normalizeMasterRoomVisibility(preset);
  if (normalized === "private") {
    return {
      identity: "owner_only",
      combat: "owner_only",
      stats: "owner_only",
      spells: "owner_only",
      inventory: "gm_only",
      equipment: "owner_only",
      notes: "gm_only",
      story: "owner_only",
    };
  }
  if (normalized === "sheet") {
    return {
      identity: "public",
      combat: "public",
      stats: "public",
      spells: "owner_only",
      inventory: "owner_only",
      equipment: "owner_only",
      notes: "gm_only",
      story: "owner_only",
    };
  }
  if (normalized === "full") {
    return {
      identity: "public",
      combat: "public",
      stats: "public",
      spells: "revealed",
      inventory: "revealed",
      equipment: "revealed",
      notes: "owner_only",
      story: "revealed",
    };
  }
  return {
    identity: "public",
    combat: "public",
    stats: "owner_only",
    spells: "owner_only",
    inventory: "gm_only",
    equipment: "owner_only",
    notes: "gm_only",
    story: "owner_only",
  };
}

function normalizeMasterRoomVisibilityMatrix(raw, preset = "basic") {
  const base = getDefaultMasterRoomVisibilityMatrix(preset);
  const source = raw && typeof raw === "object" ? raw : {};
  Object.keys(base).forEach((key) => {
    if (key in source) {
      base[key] = normalizeMasterRoomScope(source[key]);
    }
  });
  return base;
}

function getMasterRoomMemberVisibilityMatrix(member) {
  return normalizeMasterRoomVisibilityMatrix(member?.visibility_matrix, member?.visibility_preset);
}

function getMasterRoomVisibilitySections() {
  return [
    { key: "identity", label: "Identity" },
    { key: "combat", label: "Combat" },
    { key: "stats", label: "Stats" },
    { key: "spells", label: "Spells" },
    { key: "inventory", label: "Inventory" },
    { key: "equipment", label: "Equipment" },
    { key: "story", label: "Story" },
    { key: "notes", label: "Notes" },
  ];
}

function getMasterRoomVisibilityFieldGroups() {
  return [
    {
      key: "identity",
      label: "Профиль",
      fields: [
        { key: "name", label: "Имя" },
        { key: "portrait", label: "Портрет" },
        { key: "class_level_race", label: "Класс / уровень / раса" },
        { key: "background", label: "Предыстория / мировоззрение" },
      ],
    },
    {
      key: "combat",
      label: "Бой",
      fields: [
        { key: "hp", label: "HP" },
        { key: "ac", label: "AC" },
        { key: "initiative", label: "Инициатива" },
        { key: "conditions", label: "Состояния" },
      ],
    },
    {
      key: "stats",
      label: "Характеристики",
      fields: [
        { key: "abilities", label: "Базовые статы" },
        { key: "saves", label: "Спасброски" },
        { key: "skills", label: "Навыки" },
      ],
    },
    {
      key: "spells",
      label: "Заклинания",
      fields: [
        { key: "slots", label: "Ячейки" },
        { key: "prepared", label: "Подготовленные" },
        { key: "known", label: "Известные" },
      ],
    },
    {
      key: "inventory",
      label: "Инвентарь",
      fields: [
        { key: "items", label: "Предметы" },
        { key: "currency", label: "Валюта" },
        { key: "consumables", label: "Расходники" },
      ],
    },
    {
      key: "equipment",
      label: "Экипировка",
      fields: [
        { key: "weapons", label: "Оружие" },
        { key: "armor", label: "Броня" },
        { key: "attunement", label: "Настройка" },
      ],
    },
    {
      key: "story",
      label: "История",
      fields: [
        { key: "personality", label: "Личность" },
        { key: "quests", label: "Квесты" },
        { key: "relationships", label: "Связи" },
      ],
    },
    {
      key: "notes",
      label: "Секреты",
      fields: [
        { key: "gm_notes", label: "GM-заметки" },
        { key: "private_notes", label: "Личные заметки" },
        { key: "secrets", label: "Секреты" },
      ],
    },
  ];
}

function getMasterRoomMemberVisibilityFields(member) {
  const raw =
    member?.visibility_fields && typeof member.visibility_fields === "object"
      ? member.visibility_fields
      : member?.hidden_sections?.visibility_fields && typeof member.hidden_sections.visibility_fields === "object"
        ? member.hidden_sections.visibility_fields
        : {};
  const normalized = {};
  getMasterRoomVisibilityFieldGroups().forEach((group) => {
    const groupSource = raw[group.key] && typeof raw[group.key] === "object" ? raw[group.key] : {};
    normalized[group.key] = {};
    group.fields.forEach((field) => {
      const value = String(groupSource[field.key] || "").trim();
      normalized[group.key][field.key] = value ? normalizeMasterRoomScope(value) : "";
    });
  });
  return normalized;
}

function getMasterRoomFieldScope(member, groupKey, fieldKey) {
  const fields = getMasterRoomMemberVisibilityFields(member);
  const value = fields?.[groupKey]?.[fieldKey];
  if (value) return normalizeMasterRoomScope(value);
  const matrix = getMasterRoomMemberVisibilityMatrix(member);
  return normalizeMasterRoomScope(matrix[groupKey]);
}

function canEditMasterRoomMemberVisibility(member, table = getMasterRoomActiveTable()) {
  if (!member) return false;
  if (canManageMasterRoomTable(table)) return true;
  return String(member.user_id || "") === getCurrentUserId();
}

function countMasterRoomOpenVisibilityFields(member) {
  let open = 0;
  let total = 0;
  getMasterRoomVisibilityFieldGroups().forEach((group) => {
    group.fields.forEach((field) => {
      total += 1;
      const scope = getMasterRoomFieldScope(member, group.key, field.key);
      if (["public", "revealed"].includes(scope)) open += 1;
    });
  });
  return { open, total };
}

function canViewMasterRoomMemberField(member, groupKey, fieldKey, table = getMasterRoomActiveTable()) {
  if (!member) return false;
  if (canManageMasterRoomTable(table)) return true;
  const scope = getMasterRoomFieldScope(member, groupKey, fieldKey);
  if (["public", "revealed"].includes(scope)) return true;
  if (scope === "owner_only") {
    return String(member.user_id || "") === getCurrentUserId();
  }
  return false;
}

function renderMasterRoomLockedField(label, note = "Скрыто настройками видимости LSS.") {
  return `
    <div class="stat-box master-room-locked-field">
      <div class="muted">${escapeHtml(label)}</div>
      <div class="master-room-locked-field-copy">${escapeHtml(note)}</div>
    </div>
  `;
}

function resolveMasterRoomCharacterName(member, fallback = "") {
  const manual = String(member?.selected_character_name || "").trim();
  const lssName = String(member?.selected_character_lss_name || "").trim();
  const fallbackName = String(fallback || "").trim();
  return {
    value: manual || fallbackName || lssName || "Персонаж",
    source: manual ? "manual" : fallbackName ? "linked" : lssName ? "lss" : "fallback",
  };
}

function getMasterRoomEntityKindLabel(kind) {
  const normalized = String(kind || "").trim().toLowerCase();
  if (normalized === "enemy") return "Враг";
  if (normalized === "npc") return "NPC";
  if (normalized === "ally") return "Союзник";
  if (normalized === "gm") return "GM";
  return "Игрок";
}

function getMasterRoomCombatStatusMeta(status) {
  const raw = String(status || "ready").trim().toLowerCase();
  if (["dead", "killed"].includes(raw)) return { label: "Мёртв", className: "status-dead" };
  if (["down", "unconscious", "dying"].includes(raw)) return { label: "Без сознания", className: "status-down" };
  if (["hidden", "stealthed"].includes(raw)) return { label: "Скрыт", className: "status-hidden" };
  if (["hostile"].includes(raw)) return { label: "Hostile", className: "status-hostile" };
  return { label: raw || "Ready", className: "status-ready" };
}

function getMasterRoomCombatLogTone(entry) {
  const type = String(entry?.event_type || entry?.type || "note").trim().toLowerCase();
  if (["damage", "attack"].includes(type)) return "combat";
  if (type === "heal") return "heal";
  if (type === "effect") return "effect";
  if (["save", "roll"].includes(type)) return "dice";
  if (["turn", "round", "sync", "spawn"].includes(type)) return "system";
  return "note";
}

function getMasterRoomCombatLogFilterBucket(entry) {
  const tone = getMasterRoomCombatLogTone(entry);
  if (tone === "dice") return "dice";
  if (tone === "effect") return "effect";
  if (tone === "system" || tone === "note") return "system";
  return "combat";
}

function isMasterRoomCombatLogEntryVisible(entry, filter = "all", hideSecondary = false) {
  const bucket = getMasterRoomCombatLogFilterBucket(entry);
  if (hideSecondary && ["system", "note"].includes(bucket)) {
    return filter === "system" ? false : filter === "all" ? false : bucket === filter;
  }
  if (filter === "all") return true;
  return bucket === filter;
}

function getMasterRoomCombatLogAvatarMarkup(entry, combat) {
  const actorEntryId = String(entry?.entry_id || "").trim();
  const actorName = String(entry?.actor_name || "Система").trim();
  const sourceEntry = safeArray(combat?.entries).find((item) => String(item.entry_id || "") === actorEntryId);
  if (sourceEntry?.portrait_url) {
    return `<img src="${escapeHtml(sourceEntry.portrait_url)}" alt="${escapeHtml(actorName)}" class="master-room-combat-log-avatar-img">`;
  }
  return `<span class="master-room-combat-log-avatar-fallback">${escapeHtml((actorName || "?").slice(0, 1).toUpperCase())}</span>`;
}

function getMasterRoomCombatEntryPortraitMarkup(entry, nameFallback = "?", className = "master-room-combatant-portrait") {
  const name = String(entry?.name || nameFallback || "?").trim();
  if (entry?.portrait_url) {
    return `<img src="${escapeHtml(entry.portrait_url)}" alt="${escapeHtml(name)}" class="${escapeHtml(className)}-img">`;
  }
  return `<span class="${escapeHtml(className)}-fallback">${escapeHtml((name || "?").slice(0, 1).toUpperCase())}</span>`;
}

function getMasterRoomCombatLogTargetMarkup(entry, combat) {
  const targetId = String(entry?.target_entry_id || "").trim();
  const targetName = String(entry?.target_name || "Сцена").trim();
  const targetEntry = safeArray(combat?.entries).find((item) => String(item.entry_id || "") === targetId);
  if (!targetEntry) {
    return `<span class="master-room-combat-log-target-portrait-fallback">◇</span>`;
  }
  return getMasterRoomCombatEntryPortraitMarkup(targetEntry, targetName, "master-room-combat-log-target-portrait");
}

function getMasterRoomCombatEventIcon(entry) {
  const type = String(entry?.event_type || entry?.type || "note").trim().toLowerCase();
  if (type === "attack") return "⚔";
  if (type === "damage") return "◆";
  if (type === "heal") return "+";
  if (type === "save") return "🛡";
  if (type === "effect") return "✦";
  if (type === "roll") return "◈";
  if (type === "turn") return "↻";
  if (type === "round") return "∞";
  return "◇";
}

function getMasterRoomCombatLogHeadline(entry) {
  const type = String(entry?.event_type || entry?.type || "note").trim().toLowerCase();
  if (type === "turn") return entry?.text || `Ход: ${entry?.actor_name || "Участник"}`;
  if (type === "round") return entry?.text || `Раунд ${entry?.round || 1}`;
  if (type === "save") return entry?.text || `${entry?.actor_name || "Участник"} делает спасбросок`;
  if (type === "attack") return entry?.text || `${entry?.actor_name || "Участник"} атакует ${entry?.target_name || "цель"}`;
  if (type === "damage") return entry?.text || `${entry?.target_name || entry?.actor_name || "Цель"} получает урон`;
  if (type === "heal") return entry?.text || `${entry?.actor_name || "Участник"} лечит ${entry?.target_name || "цель"}`;
  if (type === "effect") return entry?.text || `${entry?.target_name || entry?.actor_name || "Цель"} получает эффект`;
  if (type === "roll") return entry?.text || `${entry?.actor_name || "Участник"} бросает ${entry?.dice || "куб"}`;
  return entry?.text || entry?.reason || "Системное событие";
}

function getMasterRoomCombatLogVerb(entry) {
  const type = String(entry?.event_type || entry?.type || "note").trim().toLowerCase();
  if (type === "attack") return "атака";
  if (type === "damage") return "урон";
  if (type === "heal") return "лечение";
  if (type === "save") return "спасбросок";
  if (type === "effect") return "эффект";
  if (type === "roll") return "бросок";
  if (type === "turn") return "ход";
  if (type === "round") return "раунд";
  return "событие";
}

function getMasterRoomCombatOutcomeLabel(entry) {
  const outcome = String(entry?.outcome || "").trim();
  if (outcome) return outcome;
  const type = String(entry?.event_type || entry?.type || "note").trim().toLowerCase();
  if (type === "heal" && Number(entry?.damage || 0) > 0) return `Исцелено ${entry.damage}`;
  if ((type === "damage" || type === "effect") && Number(entry?.damage || 0) > 0) {
    return `${entry.damage}${entry?.damage_type ? ` ${entry.damage_type}` : ""}`;
  }
  if (type === "save" && Number.isFinite(Number(entry?.roll_total))) return String(entry.roll_total);
  if ((type === "attack" || type === "roll") && Number.isFinite(Number(entry?.roll_total))) return String(entry.roll_total);
  return "";
}

function getMasterRoomCombatOutcomeClass(entry) {
  const text = String(getMasterRoomCombatOutcomeLabel(entry) || "").trim().toLowerCase();
  if (!text) return "";
  if (["попадание", "успех", "исцелено"].some((token) => text.includes(token))) return "success";
  if (["промах", "провал"].some((token) => text.includes(token))) return "failure";
  if (["урон", "огонь", "яд", "молни"].some((token) => text.includes(token))) return "danger";
  return "neutral";
}

function getMasterRoomMemberPortrait(member) {
  const sheet = member?.character_sheet && typeof member.character_sheet === "object" ? member.character_sheet : {};
  return String(sheet?.portrait_url || "").trim();
}

function renderMasterRoomHeroRoster(table) {
  const members = safeArray(table?.members).slice(0, 8);
  if (!members.length) {
    return `<div class="master-room-hero-roster-empty">Участники появятся после создания и приглашения в стол.</div>`;
  }

  return members.map((member) => {
    const portrait = getMasterRoomMemberPortrait(member);
    const resolved = resolveMasterRoomCharacterName(member, member?.display_name || member?.nickname || "Персонаж");
    const roleLabel = member?.role_in_table === "gm" ? "GM" : "Player";
    return `
      <div class="master-room-hero-roster-card">
        <div class="master-room-hero-roster-avatar">
          ${
            portrait
              ? `<img src="${escapeHtml(portrait)}" alt="${escapeHtml(resolved.value)}" class="master-room-hero-roster-avatar-img">`
              : `<span class="master-room-hero-roster-avatar-fallback">${escapeHtml((resolved.value || "?").slice(0, 1).toUpperCase())}</span>`
          }
        </div>
        <div class="master-room-hero-roster-copy">
          <strong>${escapeHtml(resolved.value)}</strong>
          <small>${escapeHtml(member?.nickname || member?.email || "Игрок")} • ${escapeHtml(roleLabel)}</small>
        </div>
      </div>
    `;
  }).join("");
}

function renderMasterRoomHeroSummary(table) {
  const members = safeArray(table?.members);
  const onlineCount = members.filter((member) => String(member?.status || "").trim().toLowerCase() !== "offline").length;
  const tradersCount = safeArray(table?.trader_accesses).length;
  const grantsCount = safeArray(table?.grants).length;

  return `
    <div class="master-room-hero-summary">
      <div class="master-room-hero-summary-card">
        <span>Игроков</span>
        <strong>${escapeHtml(String(members.filter((member) => member.role_in_table !== "gm").length))}</strong>
      </div>
      <div class="master-room-hero-summary-card">
        <span>Персонажей</span>
        <strong>${escapeHtml(String(members.length))}</strong>
      </div>
      <div class="master-room-hero-summary-card master-room-hero-summary-card-accent">
        <span>Онлайн</span>
        <strong>${escapeHtml(String(onlineCount))}/${escapeHtml(String(members.length || 0))}</strong>
      </div>
      <div class="master-room-hero-summary-card">
        <span>Торговцы</span>
        <strong>${escapeHtml(String(tradersCount))}</strong>
      </div>
      <div class="master-room-hero-summary-card">
        <span>Выдачи</span>
        <strong>${escapeHtml(String(grantsCount))}</strong>
      </div>
    </div>
  `;
}

function renderMasterRoomHeroQuickActions(canManageActive) {
  return `
    <div class="master-room-hero-quick-actions">
      <div class="master-room-hero-quick-action">
        <span>🕯️</span>
        <strong>${canManageActive ? "Инициатива" : "Сцена"}</strong>
        <small>${canManageActive ? "Очередь и старт боя" : "Текущий ритм стола"}</small>
      </div>
      <div class="master-room-hero-quick-action">
        <span>📖</span>
        <strong>${canManageActive ? "Сессия" : "Журнал"}</strong>
        <small>${canManageActive ? "События и статус" : "Последние события"}</small>
      </div>
      <div class="master-room-hero-quick-action">
        <span>🪶</span>
        <strong>${canManageActive ? "Ноты" : "Персонаж"}</strong>
        <small>${canManageActive ? "Секреты и заметки" : "Привязка из LSS"}</small>
      </div>
      <div class="master-room-hero-quick-action">
        <span>👥</span>
        <strong>${canManageActive ? "Персоны" : "Party"}</strong>
        <small>${canManageActive ? "Состав и доступы" : "Состав группы"}</small>
      </div>
    </div>
  `;
}

function renderMasterRoomVisibilityBoard(table, canManage) {
  if (!table) return "";

  const sections = getMasterRoomVisibilitySections();
  const members = safeArray(table.members);
  const currentMembership = getMasterRoomCurrentMembership(table);
  const visibleMembers = canManage ? members : (currentMembership ? [currentMembership] : []);
  const scopeCounts = {
    public: 0,
    revealed: 0,
    owner_only: 0,
    gm_only: 0,
  };

  visibleMembers.forEach((member) => {
    const matrix = getMasterRoomMemberVisibilityMatrix(member);
    sections.forEach((section) => {
      const scope = normalizeMasterRoomScope(matrix[section.key]);
      scopeCounts[scope] = (scopeCounts[scope] || 0) + 1;
    });
  });

  const playerVisibleCount = (scopeCounts.public || 0) + (scopeCounts.revealed || 0);
  const hiddenCount = (scopeCounts.owner_only || 0) + (scopeCounts.gm_only || 0);
  const currentMatrix = currentMembership ? getMasterRoomMemberVisibilityMatrix(currentMembership) : null;
  const currentOpenSections = currentMatrix
    ? sections.filter((section) => ["public", "revealed"].includes(normalizeMasterRoomScope(currentMatrix[section.key])))
    : [];

  return `
    <div class="cabinet-block master-room-visibility-board">
      <div class="master-room-panel-kicker">Слой видимости</div>
      <div class="master-room-visibility-board-grid">
        <div class="master-room-visibility-board-copy">
          <h4 class="master-room-section-title">${canManage ? "GM видит весь стол" : "Твой открытый слой стола"}</h4>
          <div class="muted master-room-command-copy">
            ${canManage
              ? "Игрокам показывается только раскрытая мастером информация. Секреты, заметки и закрытые разделы остаются в GM-слое."
              : "Ты видишь только раскрытые разделы своего персонажа, партии, боя и сцены."}
          </div>
        </div>
        <div class="master-room-visibility-meter master-room-visibility-meter-gm">
          <span>${canManage ? "GM layer" : "Table layer"}</span>
          <strong>${canManage ? "full" : escapeHtml(masterRoomVisibilityLabel(currentMembership?.visibility_preset || "basic"))}</strong>
        </div>
        <div class="master-room-visibility-meter">
          <span>${canManage ? "Открыто игрокам" : "Открыто тебе"}</span>
          <strong>${escapeHtml(String(canManage ? playerVisibleCount : currentOpenSections.length))}</strong>
        </div>
        <div class="master-room-visibility-meter master-room-visibility-meter-locked">
          <span>${canManage ? "Скрыто / личное" : "Закрыто мастером"}</span>
          <strong>${escapeHtml(String(canManage ? hiddenCount : Math.max(0, sections.length - currentOpenSections.length)))}</strong>
        </div>
      </div>
      <div class="master-room-visibility-chip-row">
        ${
          (canManage ? sections : currentOpenSections).slice(0, 8).map((section) => {
            const scope = currentMatrix ? normalizeMasterRoomScope(currentMatrix[section.key]) : "";
            return `<span class="master-room-visibility-chip">${escapeHtml(section.label)}${scope ? `: ${escapeHtml(masterRoomScopeLabel(scope))}` : ""}</span>`;
          }).join("")
        }
      </div>
    </div>
  `;
}

function renderMasterRoomTableSurface(table, canManage) {
  if (!table) return "";

  const members = safeArray(table.members);
  const currentMembership = getMasterRoomCurrentMembership(table);
  const visibleMembers = canManage ? members : (currentMembership ? [currentMembership, ...members.filter((member) => String(member.id || "") !== String(currentMembership.id || ""))] : members);
  const onlineCount = members.filter((member) => String(member?.status || "").trim().toLowerCase() !== "offline").length;
  const combat = normalizeMasterRoomCombat(table.combat);
  const openTraderCount = safeArray(table.trader_accesses).length;
  const grantCount = safeArray(table.grants).length;

  return `
    <section class="cabinet-block master-room-table-surface">
      <div class="master-room-table-surface-head">
        <div>
          <div class="master-room-panel-kicker">Virtual tabletop</div>
          <h3 class="master-room-table-surface-title">${escapeHtml(table.title || "Стол")}</h3>
          <div class="muted master-room-command-copy">
            ${canManage
              ? "GM-слой: сцена, партия, доступы, выдачи и бой в одном рабочем столе."
              : "Открытый слой стола: партия, твой LSS-персонаж, сцена и доступный бой."}
          </div>
        </div>
        <div class="master-room-table-surface-status">
          <span class="meta-item">онлайн ${escapeHtml(String(onlineCount))}/${escapeHtml(String(members.length))}</span>
          <span class="meta-item">${combat.active ? `бой R${escapeHtml(String(combat.round || 1))}` : "сцена"}</span>
          <span class="meta-item">${canManage ? "GM" : "player view"}</span>
        </div>
      </div>

      <div class="master-room-table-surface-body">
        <div class="master-room-map-board">
          <div class="master-room-map-board-frame">
            <div class="master-room-map-board-title">Сцена стола</div>
            <div class="master-room-map-token-ring">
              ${visibleMembers.slice(0, 8).map((member, index) => {
                const name = resolveMasterRoomCharacterName(member, member.display_name || member.nickname || member.email || "Игрок").value;
                const portrait = getMasterRoomMemberPortrait(member);
                const matrix = getMasterRoomMemberVisibilityMatrix(member);
                const openFields = getMasterRoomVisibilitySections().filter((section) => ["public", "revealed"].includes(normalizeMasterRoomScope(matrix[section.key]))).length;
                const isCurrent = currentMembership && String(currentMembership.id || "") === String(member.id || "");
                return `
                  <button class="master-room-map-token ${isCurrent ? "master-room-map-token-current" : ""}" type="button" data-master-room-open-sheet="${escapeHtml(member.id)}" style="--token-index:${index};">
                    <span class="master-room-map-token-avatar">
                      ${portrait
                        ? `<img src="${escapeHtml(portrait)}" alt="${escapeHtml(name)}">`
                        : `<span>${escapeHtml((name || "?").slice(0, 1).toUpperCase())}</span>`}
                    </span>
                    <span class="master-room-map-token-copy">
                      <strong>${escapeHtml(name)}</strong>
                      <small>${escapeHtml(canManage ? `${openFields}/8 открыто` : masterRoomVisibilityLabel(member.visibility_preset))}</small>
                    </span>
                  </button>
                `;
              }).join("") || `<div class="master-room-map-empty">За столом пока нет фишек игроков.</div>`}
            </div>
          </div>
        </div>

        <div class="master-room-table-tools">
          <div class="master-room-table-tool">
            <span>LSS</span>
            <strong>${escapeHtml(currentMembership?.selected_character_name || getCurrentLssCharacterName() || "не выбран")}</strong>
            <div class="master-room-table-tool-actions">
              <button class="btn btn-secondary master-room-mini-action-btn" type="button" data-master-room-open-lss="1">Открыть LSS</button>
              ${currentMembership ? `<button class="btn btn-secondary master-room-mini-action-btn" type="button" data-master-room-open-sheet="${escapeHtml(currentMembership.id)}">Видимость</button>` : ""}
            </div>
          </div>
          <div class="master-room-table-tool">
            <span>Торговцы</span>
            <strong>${escapeHtml(String(openTraderCount))}</strong>
          </div>
          <div class="master-room-table-tool">
            <span>Выдачи</span>
            <strong>${escapeHtml(String(grantCount))}</strong>
          </div>
          <div class="master-room-table-tool">
            <span>Кубы</span>
            <strong>${escapeHtml(MASTER_ROOM_STATE.combatDiceType || "d20")}</strong>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderMasterRoomSidebarPreview(table) {
  if (!table) {
    return `
      <div class="master-room-sidebar-preview-empty">
        Создай первый стол, чтобы появился состав, состояние сессии и права управления.
      </div>
    `;
  }

  const members = safeArray(table.members);
  const onlineCount = members.filter((member) => String(member?.status || "").trim().toLowerCase() !== "offline").length;
  const averageLevel = Math.max(1, Math.round(
    members.reduce((sum, member) => sum + Number(member?.character_sheet?.level || 0), 0) / Math.max(1, members.length)
  ));

  return `
    <div class="master-room-sidebar-preview-card">
      <div class="master-room-sidebar-preview-art"></div>
      <div class="master-room-sidebar-preview-title">${escapeHtml(table.title)}</div>
      <div class="master-room-sidebar-preview-meta">
        <span>Система: <strong>D&D 5e</strong></span>
        <span>Уровень: <strong>${escapeHtml(String(averageLevel))}</strong></span>
        <span>Доступ: <strong>По приглашению</strong></span>
        <span>Онлайн: <strong>${escapeHtml(String(onlineCount))}/${escapeHtml(String(members.length))}</strong></span>
      </div>
    </div>
  `;
}

function renderMasterRoomSidebarPlayers(table) {
  const members = safeArray(table?.members);
  if (!members.length) {
    return `<div class="master-room-sidebar-player-empty">Подключённые игроки появятся после создания стола.</div>`;
  }

  return members.map((member) => {
    const portrait = getMasterRoomMemberPortrait(member);
    const name = resolveMasterRoomCharacterName(member, member?.display_name || member?.nickname || "Игрок").value;
    const status = String(member?.status || "").trim().toLowerCase() === "offline" ? "Отошёл" : "Онлайн";
    const statusClass = status === "Онлайн" ? "online" : "away";
    return `
      <div class="master-room-sidebar-player">
        <div class="master-room-sidebar-player-avatar">
          ${
            portrait
              ? `<img src="${escapeHtml(portrait)}" alt="${escapeHtml(name)}" class="master-room-sidebar-player-avatar-img">`
              : `<span class="master-room-sidebar-player-avatar-fallback">${escapeHtml((name || "?").slice(0, 1).toUpperCase())}</span>`
          }
        </div>
        <div class="master-room-sidebar-player-copy">
          <strong>${escapeHtml(name)}</strong>
          <small>${escapeHtml(member?.role_in_table === "gm" ? "GM" : "Игрок")}</small>
        </div>
        <span class="master-room-sidebar-player-status master-room-sidebar-player-status-${statusClass}">${status}</span>
      </div>
    `;
  }).join("");
}

function renderMasterRoomUtilityBar(table, canManage, battleFocus, globalGmMode) {
  const combat = normalizeMasterRoomCombat(table?.combat);
  const activeMode = normalizeMasterRoomStageMode(MASTER_ROOM_STATE.stageMode, canManage);
  const modeLabel = getMasterRoomStageModes(canManage).find((mode) => mode.key === activeMode)?.label || "Стол";
  const roleLabel = canManage || globalGmMode ? "GM layer" : "Player layer";
  const nonBattleActions = table
    ? `
      <button class="btn ${activeMode === "table" ? "active" : ""}" type="button" data-master-room-stage-mode="table">Стол</button>
      <button class="btn ${activeMode === "party" ? "active" : ""}" type="button" data-master-room-stage-mode="party">Партия</button>
      <button class="btn ${activeMode === "lss" ? "active" : ""}" type="button" data-master-room-stage-mode="lss">LSS</button>
      <button class="btn ${activeMode === "combat" ? "active" : ""}" type="button" data-master-room-stage-mode="combat">Бой</button>
      <button class="btn ${activeMode === "journal" ? "active" : ""}" type="button" data-master-room-stage-mode="journal">Журнал</button>
      <button class="btn" type="button" data-master-room-reload-inline="1">Обновить</button>
      <button class="btn" type="button" data-master-room-switch-tab="myaccount">Кабинет</button>
    `
    : `
      <button class="btn btn-primary" type="button" data-master-room-scroll-anchor="create">Создать стол</button>
      <button class="btn" type="button" data-master-room-reload-inline="1">Обновить</button>
      <button class="btn" type="button" data-master-room-switch-tab="myaccount">Кабинет</button>
    `;

  return `
    <div class="cabinet-block master-room-anchor-bar" data-cabinet-anchor="top">
      <div class="master-room-anchor-copy">
        <div class="master-room-panel-kicker">${battleFocus ? "Battle tabletop" : "Virtual tabletop"}</div>
        <strong>${escapeHtml(table?.title || "Master Room")}</strong>
        <span>${escapeHtml(battleFocus ? `Раунд ${combat.round || 1}` : modeLabel)} • ${escapeHtml(roleLabel)}</span>
      </div>
      <div class="master-room-anchor-actions">
        <button class="btn master-room-anchor-icon" type="button" data-master-room-scroll-anchor="top" title="Наверх" aria-label="Наверх">↑</button>
        ${battleFocus ? `
          <button class="btn" type="button" data-master-room-scroll-anchor="battle">Бой</button>
          <button class="btn" type="button" data-master-room-scroll-anchor="scene">Контекст</button>
          <button class="btn" type="button" data-master-room-scroll-anchor="journal">Журнал</button>
          <button class="btn" type="button" data-master-room-switch-tab="myaccount">Аккаунт</button>
        ` : `
          ${nonBattleActions}
        `}
      </div>
    </div>
  `;
}

function renderMasterRoomFloatingNav(battleFocus) {
  return `
    <div class="master-room-floating-nav">
      <button class="btn master-room-anchor-icon" type="button" data-master-room-scroll-anchor="top" title="Наверх" aria-label="Наверх">↑</button>
      <button class="btn master-room-anchor-icon" type="button" data-master-room-scroll-anchor="${battleFocus ? "battle" : "scene"}" title="${battleFocus ? "К бою" : "К сцене"}" aria-label="${battleFocus ? "К бою" : "К сцене"}">${battleFocus ? "⚔" : "⌂"}</button>
    </div>
  `;
}

function renderMasterRoomCollapsedRail(table, canManage) {
  const membersCount = safeArray(table?.members).length;
  return `
    <div class="cabinet-block master-room-sidebar-panel master-room-rail-mini">
      <button class="btn master-room-anchor-icon" type="button" data-master-room-toggle-ui="rail" title="Развернуть столы" aria-label="Развернуть столы">›</button>
      <div class="master-room-rail-mini-mark">MR</div>
      <button class="btn master-room-anchor-icon" type="button" data-master-room-scroll-anchor="scene" title="Сцена" aria-label="Сцена">⌂</button>
      <button class="btn master-room-anchor-icon" type="button" data-master-room-scroll-anchor="modes" title="Режимы" aria-label="Режимы">☷</button>
      <button class="btn master-room-anchor-icon" type="button" data-master-room-scroll-anchor="journal" title="Журнал" aria-label="Журнал">≡</button>
      <div class="master-room-rail-mini-count" title="Столы">${escapeHtml(String(MASTER_ROOM_STATE.tables.length))}</div>
      <div class="master-room-rail-mini-count" title="Игроки">${escapeHtml(String(membersCount))}</div>
      <div class="master-room-rail-mini-role">${escapeHtml(canManage ? "GM" : "P")}</div>
    </div>
  `;
}

function getMasterRoomStageModes(canManage) {
  const modes = [
    { key: "table", label: "Стол", note: "сцена" },
    { key: "party", label: "Партия", note: "фишки" },
    { key: "lss", label: "LSS", note: "персонаж" },
    { key: "combat", label: "Бой", note: "инициатива" },
    { key: "journal", label: "Журнал", note: "события" },
  ];

  if (!canManage) return modes;

  return [
    modes[0],
    modes[1],
    modes[2],
    { key: "settings", label: "GM control", note: "стол" },
    { key: "access", label: "Торговцы", note: "доступ" },
    { key: "grants", label: "Выдача", note: "предметы" },
    modes[3],
    modes[4],
  ];
}

function normalizeMasterRoomStageMode(value, canManage) {
  const key = String(value || "table").trim().toLowerCase();
  const modes = getMasterRoomStageModes(canManage).map((mode) => mode.key);
  return modes.includes(key) ? key : "table";
}

function renderMasterRoomStageTabs(canManage) {
  const activeMode = normalizeMasterRoomStageMode(MASTER_ROOM_STATE.stageMode, canManage);
  return `
    <div class="master-room-stage-tabs" data-cabinet-anchor="modes">
      ${getMasterRoomStageModes(canManage).map((mode) => `
        <button
          class="btn ${activeMode === mode.key ? "active" : ""}"
          type="button"
          data-master-room-stage-mode="${escapeHtml(mode.key)}"
        >
          <span>${escapeHtml(mode.label)}</span>
          <small>${escapeHtml(mode.note)}</small>
        </button>
      `).join("")}
    </div>
  `;
}

function getMasterRoomJournalIcon(entry) {
  const type = String(entry?.event_type || entry?.type || "note").trim().toLowerCase();
  if (type === "attack" || type === "damage") return "⚔️";
  if (type === "heal") return "✨";
  if (type === "effect") return "🪄";
  if (type === "turn" || type === "round") return "🕯️";
  if (type === "roll" || type === "save") return "🎲";
  return "📜";
}

function renderMasterRoomEventJournal(table) {
  const entries = safeArray(table?.combat?.log).slice(-7).reverse();
  if (!entries.length) {
    return `
      <div class="master-room-event-journal-empty">
        Журнал пока пуст. Начни бой, добавь событие или бросок, чтобы здесь появился ритм сессии.
      </div>
    `;
  }

  return entries.map((entry) => `
    <div class="master-room-event-journal-entry">
      <div class="master-room-event-journal-icon">${getMasterRoomJournalIcon(entry)}</div>
      <div class="master-room-event-journal-copy">
        <strong>${escapeHtml(getMasterRoomCombatLogHeadline(entry))}</strong>
        <small>${escapeHtml(String(entry?.reason || entry?.text || "").trim() || "Событие журнала")}</small>
      </div>
      <div class="master-room-event-journal-time">${escapeHtml(formatTime(entry?.created_at || entry?.at || new Date().toISOString()))}</div>
    </div>
  `).join("");
}

function renderMasterRoomLiveOverview(table, canManage, options = {}) {
  if (!table) return "";

  const compact = Boolean(options.compact);
  const sceneCollapsed = Boolean(MASTER_ROOM_STATE.sceneCollapsed);
  const journalCollapsed = Boolean(MASTER_ROOM_STATE.journalCollapsed);
  const sceneContent = sceneCollapsed
    ? `
      <div class="cabinet-block master-room-collapsed-block">
        <div>
          <div class="master-room-panel-kicker">Scene hidden</div>
          <strong>Сцена стола скрыта</strong>
          <span>Фишки, видимость и поверхность стола остаются в данных, но не занимают экран.</span>
        </div>
        <button class="btn" type="button" data-master-room-toggle-ui="scene">Показать сцену</button>
      </div>
    `
    : `
      ${renderMasterRoomVisibilityBoard(table, canManage)}
      ${renderMasterRoomTableSurface(table, canManage)}
    `;

  return `
    <div class="master-room-live-grid ${compact ? "master-room-live-grid-compact" : ""}" data-cabinet-anchor="scene">
      <div class="master-room-live-primary">
        ${sceneContent}
      </div>
      <aside class="cabinet-block master-room-event-journal-panel ${journalCollapsed ? "master-room-event-journal-panel-collapsed" : ""}" data-cabinet-anchor="journal">
        ${journalCollapsed ? `
          <div>
            <div class="master-room-panel-kicker">Journal hidden</div>
            <h4 class="master-room-section-title">Журнал скрыт</h4>
            <div class="muted master-room-command-copy">События не удаляются, только убраны с первого экрана.</div>
          </div>
          <button class="btn master-room-event-journal-btn" type="button" data-master-room-toggle-ui="journal">Показать журнал</button>
        ` : `
          <div class="master-room-panel-kicker">Журнал событий</div>
          <div class="master-room-event-journal-head">
            <div>
              <h4 class="master-room-section-title">Последние события</h4>
              <div class="muted master-room-command-copy">Ключевые действия стола, боя и подключений.</div>
            </div>
          </div>
          <div class="master-room-event-journal-list">
            ${renderMasterRoomEventJournal(table)}
          </div>
          <button class="btn master-room-event-journal-btn" type="button" data-master-room-scroll-context="journal">Открыть полный журнал</button>
        `}
      </aside>
    </div>
  `;
}

function renderMasterRoomBattleBar(table, canManage, globalGmMode) {
  if (!table) return "";

  const combat = normalizeMasterRoomCombat(table.combat);
  const members = safeArray(table.members);
  const currentTurn = combat.entries[combat.turn_index] || null;
  const roleLabel = canManage || globalGmMode ? "GM" : "Player";

  return `
    <div class="cabinet-block master-room-battle-bar">
      <div class="master-room-battle-bar-copy">
        <div class="master-room-panel-kicker">Боевой режим</div>
        <h3 class="master-room-battle-bar-title">${escapeHtml(table.title || "Сцена стола")}</h3>
        <div class="master-room-battle-bar-meta">
          <span class="meta-item">${escapeHtml(roleLabel)}</span>
          <span class="meta-item">Раунд ${escapeHtml(String(combat.round || 1))}</span>
          <span class="meta-item">Ход: ${escapeHtml(currentTurn?.name || "не выбран")}</span>
          <span class="meta-item">Позиции: ${escapeHtml(String(combat.entries.length))}</span>
          <span class="meta-item">За столом: ${escapeHtml(String(members.length))}</span>
        </div>
      </div>
      <div class="cart-buttons master-room-battle-bar-actions">
        <button class="btn btn-secondary" type="button" data-master-room-scroll-context="table">Сцена / видимость</button>
        <button class="btn btn-secondary" type="button" data-master-room-open-lss="1">LSS</button>
        <button class="btn btn-secondary" type="button" data-master-room-switch-tab="myaccount">Мой аккаунт</button>
        <button class="btn btn-primary" type="button" data-master-room-reload-inline="1">Обновить</button>
      </div>
    </div>
  `;
}

function renderMasterRoomCommandStrip(table, canManage) {
  const combat = normalizeMasterRoomCombat(table?.combat);
  const membersCount = safeArray(table?.members).length;
  const traderCount = safeArray(table?.trader_accesses).length;
  const grantsCount = safeArray(table?.grants).length;
  const combatantsCount = safeArray(combat.entries).length;
  const actionModes = canManage
    ? [
        ["settings", "Настроить стол", "token / доступ"],
        ["party", "Партия", `${membersCount} за столом`],
        ["access", "Торговцы", `${traderCount} открыто`],
        ["grants", "Выдача", `${grantsCount} записей`],
        ["combat", combat.active ? "Продолжить бой" : "Собрать бой", `${combatantsCount} позиций`],
      ]
    : [
        ["party", "Партия", `${membersCount} за столом`],
        ["lss", "Мой LSS", getCurrentLssCharacterName() || "персонаж"],
        ["combat", combat.active ? "Бой" : "Подготовка", `${combatantsCount} позиций`],
        ["journal", "Журнал", `${safeArray(combat.log).length} событий`],
      ];

  return `
    <div class="cabinet-block master-room-stage-panel master-room-command-panel master-room-command-strip">
      <div class="flex-between master-room-section-head">
        <div>
          <div class="master-room-panel-kicker">${canManage ? "GM quick command" : "Player table layer"}</div>
          <h4 class="master-room-section-title">${escapeHtml(table?.title || "Стол")}</h4>
          <div class="muted master-room-command-copy">
            Первый экран держит сцену, видимость и фишки; глубокие настройки вынесены в режимы ниже.
          </div>
        </div>
        <div class="trader-meta cabinet-header-meta">
          <span class="meta-item">${escapeHtml(canManage ? "GM" : "Player")}</span>
          <span class="meta-item">${escapeHtml(table?.trader_access_mode === "restricted" ? "restricted traders" : "open traders")}</span>
          <span class="meta-item">R${escapeHtml(String(combat.round || 1))}</span>
        </div>
      </div>
      <div class="master-room-command-strip-grid">
        ${actionModes.map(([mode, title, note]) => `
          <button class="btn master-room-command-strip-btn" type="button" data-master-room-stage-mode="${escapeHtml(mode)}">
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(note)}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderMasterRoomCommandPanel(table, canManage) {
  if (!table) return "";

  if (!canManage) {
    return `
      <div class="cabinet-block master-room-stage-panel master-room-command-panel">
        <div class="master-room-panel-kicker">Player table layer</div>
        <div class="flex-between master-room-section-head">
          <div>
            <h3 class="master-room-command-title">${escapeHtml(table.title)}</h3>
            <div class="muted master-room-command-copy">Token: <strong>${escapeHtml(table.token)}</strong> • открытый слой стола</div>
          </div>
          <div class="trader-meta cabinet-header-meta">
            <span class="meta-item">Участников: ${safeArray(table.members).length}</span>
            <span class="meta-item">Твой персонаж: ${escapeHtml(getMasterRoomCurrentMembership(table)?.selected_character_name || getCurrentLssCharacterName() || "не выбран")}</span>
          </div>
        </div>
        <div class="muted">GM-слой скрыт. Здесь доступны только раскрытые мастером данные партии, персонажа, сцены и боя.</div>
      </div>
    `;
  }

  return `
    <div class="cabinet-block master-room-stage-panel master-room-command-panel">
      <div class="master-room-panel-kicker">GM table layer</div>
      <div class="flex-between master-room-section-head">
        <div>
          <h3 class="master-room-command-title">${escapeHtml(table.title)}</h3>
          <div class="muted master-room-command-copy">Token: <strong>${escapeHtml(table.token)}</strong> • источник: ${escapeHtml(MASTER_ROOM_STATE.source)}</div>
          <div class="master-room-command-lead">Виртуальная карта стола: партия, видимость разделов, доступы, выдачи, заметки мастера и живая сцена.</div>
        </div>
        <div class="trader-meta cabinet-header-meta">
          <span class="meta-item">Участников: ${safeArray(table.members).length}</span>
          <span class="meta-item">LSS ГМа: ${escapeHtml(getCurrentLssCharacterName() || "не выбран")}</span>
        </div>
      </div>
      <div class="master-room-command-overview">
        <div class="master-room-command-overview-card">
          <span>Статус</span>
          <strong>${escapeHtml(table.status || "active")}</strong>
        </div>
        <div class="master-room-command-overview-card">
          <span>Участники</span>
          <strong>${escapeHtml(String(safeArray(table.members).length))}</strong>
        </div>
        <div class="master-room-command-overview-card master-room-command-overview-card-accent">
          <span>Торговцы</span>
          <strong>${escapeHtml(String(safeArray(table.trader_accesses).length))}</strong>
        </div>
        <div class="master-room-command-overview-card">
          <span>Выдачи</span>
          <strong>${escapeHtml(String(safeArray(table.grants).length))}</strong>
        </div>
      </div>
      <div class="master-room-command-grid">
        <div class="master-room-command-zone">
          <div class="master-room-command-zone-head">
            <div>
              <div class="master-room-command-zone-kicker">Table settings</div>
              <h4 class="master-room-command-zone-title">Параметры карты</h4>
            </div>
          </div>
          <div class="profile-grid master-room-form-grid-compact">
            <div class="filter-group">
              <label>Название стола</label>
              <input id="masterRoomTableTitle" type="text" value="${escapeHtml(table.title)}">
            </div>
            <div class="filter-group">
              <label>Статус</label>
              <input id="masterRoomTableStatus" type="text" value="${escapeHtml(table.status)}">
            </div>
            <div class="filter-group master-room-form-span">
              <label>Заметки ГМа по столу</label>
              <textarea id="masterRoomTableNotes" rows="4" placeholder="Секреты кампании, правила стола, доступы...">${escapeHtml(table.notes || "")}</textarea>
            </div>
          </div>
          <div class="cart-buttons master-room-action-row">
            <button class="btn btn-primary" type="button" id="masterRoomSaveTableBtn">Сохранить стол</button>
          </div>
        </div>
        <div class="master-room-command-zone master-room-command-zone-side">
          <div class="master-room-command-zone-head">
            <div>
              <div class="master-room-command-zone-kicker">Recruitment</div>
              <h4 class="master-room-command-zone-title">Поиск и доступ</h4>
            </div>
          </div>
          <div class="collection-toolbar compact-collection-toolbar master-room-toolbar">
            <div class="filter-group master-room-toolbar-field">
              <label>Поиск игрока по нику / email</label>
              <input id="masterRoomInviteQuery" type="text" value="${escapeHtml(MASTER_ROOM_STATE.inviteQuery || "")}" placeholder="Например: andersun">
            </div>
          </div>
          <div id="masterRoomUserSearchResults" class="master-room-results-box">
            ${renderMasterRoomUserSearchResults(table)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderMasterRoomTableMode(table, canManage) {
  return `
    <div class="master-room-table-mode">
      ${renderMasterRoomLiveOverview(table, canManage)}
      <div class="master-room-table-mode-tools">
        ${renderMasterRoomCommandStrip(table, canManage)}
        ${renderMasterRoomDiceDock(table?.combat)}
      </div>
    </div>
  `;
}

function renderMasterRoomCombatStage(table, canManage, globalGmMode = false) {
  const combat = normalizeMasterRoomCombat(table?.combat);
  const hasEntries = safeArray(combat.entries).length > 0;

  return `
    <div class="master-room-combat-mode" data-cabinet-anchor="battle">
      ${hasEntries ? renderMasterRoomBattleBar(table, canManage, globalGmMode) : ""}
      <div class="master-room-combat-mode-grid">
        <div class="master-room-combat-mode-primary">
          ${renderMasterRoomDiceDock(table?.combat)}
          ${canManage && !hasEntries ? renderMasterRoomEnemyPanel(table) : ""}
          ${renderMasterRoomBattlePanel(table)}
        </div>
        <aside class="master-room-combat-mode-context">
          ${canManage && hasEntries ? renderMasterRoomEnemyPanel(table) : ""}
          <div class="cabinet-block master-room-stage-panel master-room-combat-context-card">
            <div class="master-room-panel-kicker">Table context</div>
            <h4 class="master-room-section-title">Сцена и партия</h4>
            <div class="muted master-room-command-copy">Бой остаётся режимом стола: можно быстро вернуться к фишкам, LSS и журналу.</div>
            <div class="master-room-command-strip-grid master-room-command-strip-grid-compact">
              <button class="btn master-room-command-strip-btn" type="button" data-master-room-stage-mode="table">
                <strong>Стол</strong>
                <span>сцена</span>
              </button>
              <button class="btn master-room-command-strip-btn" type="button" data-master-room-stage-mode="party">
                <strong>Партия</strong>
                <span>фишки</span>
              </button>
              <button class="btn master-room-command-strip-btn" type="button" data-master-room-stage-mode="journal">
                <strong>Журнал</strong>
                <span>лог</span>
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  `;
}

function renderMasterRoomJournalStage(table) {
  const combat = normalizeMasterRoomCombat(table?.combat);
  return `
    <div class="cabinet-block master-room-stage-panel master-room-journal-stage-panel" data-cabinet-anchor="journal">
      <div class="flex-between master-room-section-head">
        <div>
          <div class="master-room-panel-kicker">Session journal</div>
          <h4 class="master-room-section-title">Журнал стола</h4>
          <div class="muted master-room-command-copy">События сцены, боя, броски, выдачи и системные отметки в одном месте.</div>
        </div>
        <div class="trader-meta cabinet-header-meta">
          <span class="meta-item">${escapeHtml(String(safeArray(combat.log).length))} событий</span>
          <span class="meta-item">Раунд ${escapeHtml(String(combat.round || 1))}</span>
        </div>
      </div>
      <div class="master-room-journal-stage-grid">
        <div class="master-room-event-journal-list">
          ${renderMasterRoomEventJournal(table)}
        </div>
        <div class="master-room-combat-log master-room-combat-log-immersive">
          ${renderMasterRoomCombatLogPanel(combat)}
        </div>
      </div>
    </div>
  `;
}

function renderMasterRoomParticipantsStage(table, canManage) {
  return `
    ${renderMasterRoomPartyOverview(table)}
    ${canManage ? `
      <div class="cabinet-block master-room-stage-panel">
        <div class="flex-between master-room-section-head master-room-section-head-tight">
          <div>
            <div class="muted master-room-section-kicker">Партия</div>
            <h4 class="master-room-section-title">Игроки за столом</h4>
          </div>
          <span class="meta-item">${safeArray(table?.members).length}</span>
        </div>
        ${renderMasterRoomParticipants(table)}
      </div>
    ` : ""}
  `;
}

function renderMasterRoomNonBattleStage(table, canManage) {
  if (!table) return "";

  const mode = normalizeMasterRoomStageMode(MASTER_ROOM_STATE.stageMode, canManage);
  let content = "";

  if (mode === "party") {
    content = renderMasterRoomParticipantsStage(table, canManage);
  } else if (mode === "lss") {
    content = renderMasterRoomLssBridge(table);
  } else if (mode === "settings") {
    content = renderMasterRoomCommandPanel(table, canManage);
  } else if (mode === "access") {
    content = renderMasterRoomTraderAccesses(table);
  } else if (mode === "grants") {
    content = renderMasterRoomGrantPanel(table);
  } else if (mode === "combat") {
    content = renderMasterRoomCombatStage(table, canManage);
  } else if (mode === "journal") {
    content = renderMasterRoomJournalStage(table);
  } else {
    content = renderMasterRoomTableMode(table, canManage);
  }

  return `
    <div class="master-room-main-grid master-room-main-grid-stage-mode master-room-main-grid-stage-${escapeHtml(mode)}">
      <div class="master-room-main-primary">
        <div class="master-room-stage-grid">
          <div class="master-room-stage-mode-stack">
            ${content}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderMasterRoomEmptyTabletop(canManage) {
  return `
    <section class="cabinet-block master-room-empty-tabletop">
      <div class="master-room-empty-tabletop-main">
        <div class="master-room-panel-kicker">Virtual tabletop</div>
        <h3 class="master-room-empty-tabletop-title">Стол ещё не выбран</h3>
        <div class="master-room-empty-tabletop-copy">
          Создай комнату или открой существующую. Здесь появятся сцена, фишки игроков из LSS, слой видимости, бой, торговцы и выдачи предметов.
        </div>
        <div class="master-room-empty-map">
          <div class="master-room-empty-map-compass">✦</div>
          <div class="master-room-empty-map-node master-room-empty-map-node-gm">GM</div>
          <div class="master-room-empty-map-node master-room-empty-map-node-party">Party</div>
          <div class="master-room-empty-map-node master-room-empty-map-node-lss">LSS</div>
          <div class="master-room-empty-map-node master-room-empty-map-node-combat">Battle</div>
        </div>
      </div>
      <aside class="master-room-empty-side">
        <div class="master-room-empty-step">
          <span>1</span>
          <strong>Создать стол</strong>
          <small>Название, token и базовый слой доступа.</small>
        </div>
        <div class="master-room-empty-step">
          <span>2</span>
          <strong>Подключить LSS</strong>
          <small>Игрок выбирает персонажа и управляет раскрытием полей.</small>
        </div>
        <div class="master-room-empty-step">
          <span>3</span>
          <strong>Открыть сцену</strong>
          <small>${canManage ? "GM управляет боем, торговцами и выдачами." : "Игрок видит только раскрытый слой стола."}</small>
        </div>
      </aside>
    </section>
  `;
}

function normalizeMasterRoomCombat(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    active: Boolean(source.active),
    round: Math.max(1, safeNumber(source.round, 1)),
    turn_index: Math.max(0, safeNumber(source.turn_index, 0)),
    updated_at: source.updated_at || new Date().toISOString(),
    entries: safeArray(source.entries).map((entry, index) => ({
      entry_id: String(entry?.entry_id || (entry?.membership_id ? `member:${entry.membership_id}` : `enemy:${index + 1}`)),
      entry_type: String(entry?.entry_type || (entry?.membership_id ? "member" : "enemy")).trim(),
      membership_id: String(entry?.membership_id || ""),
      user_id: String(entry?.user_id || ""),
      selected_character_id: String(entry?.selected_character_id || ""),
      name: String(entry?.name || `Участник ${index + 1}`).trim(),
      role_in_table: normalizeMasterRoomRole(entry?.role_in_table),
      hp_current: Math.max(0, safeNumber(entry?.hp_current, 0)),
      hp_max: Math.max(0, safeNumber(entry?.hp_max, 0)),
      ac: Math.max(0, safeNumber(entry?.ac, 0)),
      initiative: safeNumber(entry?.initiative, 0),
      status: String(entry?.status || "ready").trim(),
      notes: String(entry?.notes || "").trim(),
      source: String(entry?.source || "table").trim(),
      enemy_ref: String(entry?.enemy_ref || "").trim(),
      portrait_url: String(entry?.portrait_url || "").trim(),
      level: Math.max(0, safeNumber(entry?.level, 0)),
      class_name: String(entry?.class_name || "").trim(),
      race: String(entry?.race || "").trim(),
      entity_kind: String(entry?.entity_kind || (entry?.entry_type === "enemy" ? "enemy" : "player")).trim(),
      visibility_preset: normalizeMasterRoomVisibility(entry?.visibility_preset),
      visibility_matrix: normalizeMasterRoomVisibilityMatrix(entry?.visibility_matrix, entry?.visibility_preset),
      abilities: entry?.abilities && typeof entry.abilities === "object" ? entry.abilities : {},
      attacks: safeArray(entry?.attacks),
      spells: safeArray(entry?.spells),
    })),
    log: safeArray(source.log).map((entry, index) => ({
      id: String(entry?.id || `combat_log_${index}`),
      membership_id: String(entry?.membership_id || ""),
      entry_id: String(entry?.entry_id || "").trim(),
      target_entry_id: String(entry?.target_entry_id || "").trim(),
      target_name: String(entry?.target_name || "").trim(),
      actor_name: String(entry?.actor_name || "Система").trim(),
      type: String(entry?.type || "note").trim(),
      event_type: String(entry?.event_type || entry?.type || "note").trim(),
      dice: String(entry?.dice || "").trim(),
      modifier: safeNumber(entry?.modifier, 0),
      roll_total: safeNumber(entry?.roll_total, 0),
      damage: safeNumber(entry?.damage, 0),
      damage_type: String(entry?.damage_type || "").trim(),
      outcome: String(entry?.outcome || "").trim(),
      visibility: normalizeMasterRoomScope(entry?.visibility),
      round: Math.max(1, safeNumber(entry?.round, 1)),
      reason: String(entry?.reason || "").trim(),
      text: String(entry?.text || "").trim(),
      created_at: entry?.created_at || new Date().toISOString(),
    })),
  };
}

function normalizeMasterRoomTable(table, index = 0) {
  const raw = table && typeof table === "object" ? table : {};
  return {
    id: String(raw.id || raw.table_id || `table_${index}`),
    owner_user_id: String(raw.owner_user_id || ""),
    title: String(raw.title || raw.name || `Стол ${index + 1}`).trim() || `Стол ${index + 1}`,
    token: String(raw.token || raw.code || "").trim(),
    status: String(raw.status || "active").trim() || "active",
    notes: String(raw.notes || "").trim(),
    trader_access_mode: String(raw.trader_access_mode || "open").trim() || "open",
    created_at: raw.created_at || new Date().toISOString(),
    updated_at: raw.updated_at || new Date().toISOString(),
    members: safeArray(raw.members).map((member, memberIndex) => ({
      id: String(member?.id || `member_${memberIndex}`),
      user_id: String(member?.user_id || ""),
      nickname: String(member?.nickname || member?.email || `Игрок ${memberIndex + 1}`).trim(),
      email: String(member?.email || "").trim(),
      display_name: String(member?.display_name || "").trim(),
      role_in_table: normalizeMasterRoomRole(member?.role_in_table),
      visibility_preset: normalizeMasterRoomVisibility(member?.visibility_preset),
      selected_character_id: String(member?.selected_character_id || ""),
      selected_character_name: String(member?.selected_character_name || "").trim(),
      selected_character_name_source: String(member?.selected_character_name_source || "").trim(),
      selected_character_lss_name: String(member?.selected_character_lss_name || "").trim(),
      notes: String(member?.notes || "").trim(),
      hidden_sections: member?.hidden_sections && typeof member.hidden_sections === "object"
        ? member.hidden_sections
        : {},
      visibility_matrix: normalizeMasterRoomVisibilityMatrix(member?.visibility_matrix, member?.visibility_preset),
      character_sheet: member?.character_sheet && typeof member.character_sheet === "object"
        ? member.character_sheet
        : {},
      joined_at: member?.joined_at || new Date().toISOString(),
    })),
    trader_accesses: safeArray(raw.trader_accesses).map((entry, traderIndex) => ({
      id: String(entry?.id || `access_${traderIndex}`),
      trader_id: Number(entry?.trader_id || entry?.id || 0),
      name: String(entry?.name || `Trader #${entry?.trader_id || traderIndex + 1}`).trim(),
      notes: String(entry?.notes || "").trim(),
      is_enabled: Boolean(entry?.is_enabled ?? true),
    })),
    grants: safeArray(raw.grants).map((entry, grantIndex) => ({
      id: String(entry?.id || `grant_${grantIndex}`),
      membership_id: String(entry?.membership_id || ""),
      target_user_id: String(entry?.target_user_id || ""),
      item_id: Number(entry?.item_id || 0),
      item_name: String(entry?.item_name || entry?.custom_name || "").trim(),
      quantity: Math.max(1, safeNumber(entry?.quantity, 1)),
      notes: String(entry?.notes || "").trim(),
      created_by_nickname: String(entry?.created_by_nickname || "").trim(),
      created_at: entry?.created_at || new Date().toISOString(),
    })),
    viewer_can_manage: Boolean(raw.viewer_can_manage),
    combat: normalizeMasterRoomCombat(raw.combat),
  };
}

function ensureMasterRoomDefaults() {
  MASTER_ROOM_STATE.tables = safeArray(MASTER_ROOM_STATE.tables).map((table, index) =>
    normalizeMasterRoomTable(table, index)
  );

  if (MASTER_ROOM_STATE.activeTableId && MASTER_ROOM_STATE.tables.some((table) => table.id === MASTER_ROOM_STATE.activeTableId)) {
    return;
  }

  MASTER_ROOM_STATE.activeTableId = MASTER_ROOM_STATE.tables[0]?.id || "";
}

function getMasterRoomActiveTable() {
  ensureMasterRoomDefaults();
  return MASTER_ROOM_STATE.tables.find((table) => table.id === MASTER_ROOM_STATE.activeTableId) || null;
}

function getCurrentLssCharacterName() {
  const profile = getLssProfile?.() || {};
  const raw = getLssRaw?.() || {};
  const rawEmbedded =
    raw && typeof raw?.data === "string"
      ? tryParseJson(raw.data) || {}
      : raw?.data && typeof raw.data === "object"
        ? raw.data
        : {};
  const shared = window.__sharedState?.lss?.profile || window.__sharedState?.lss?.raw || {};
  const direct = window.__LSS_EXPORT__ || window.__lssExport || {};
  return String(
    profile?.name ||
    profile?.info?.name ||
    raw?.name ||
    raw?.info?.name ||
    rawEmbedded?.name ||
    rawEmbedded?.info?.name ||
    shared?.name ||
    shared?.info?.name ||
    direct?.name ||
    direct?.info?.name ||
    ""
  ).trim();
}

function unwrapLssValue(node, fallback = "") {
  if (node == null) return fallback;
  if (["string", "number", "boolean"].includes(typeof node)) return node;
  if (typeof node === "object") {
    if ("value" in node) return unwrapLssValue(node.value, fallback);
    if ("score" in node) return unwrapLssValue(node.score, fallback);
  }
  return fallback;
}

function getCurrentLssCharacterSnapshot() {
  const profile = getLssProfile?.() || null;
  const raw = getLssRaw?.() || null;
  const rawEmbedded =
    raw && typeof raw?.data === "string"
      ? tryParseJson(raw.data) || null
      : raw?.data && typeof raw.data === "object"
        ? raw.data
        : null;
  const shared = window.__sharedState?.lss?.profile || window.__sharedState?.lss?.raw || {};
  const direct = window.__LSS_EXPORT__ || window.__lssExport || {};
  const source = (profile && typeof profile === "object" && Object.keys(profile).length
    ? profile
    : raw && typeof raw === "object" && Object.keys(raw).length
      ? rawEmbedded && typeof rawEmbedded === "object" && Object.keys(rawEmbedded).length
        ? rawEmbedded
        : raw
      : rawEmbedded && typeof rawEmbedded === "object" && Object.keys(rawEmbedded).length
        ? rawEmbedded
        : shared && typeof shared === "object" && Object.keys(shared).length
          ? shared
          : direct) || {};
  const info = source?.info && typeof source.info === "object" ? source.info : {};
  const vitality = source?.vitality && typeof source.vitality === "object" ? source.vitality : {};

  const hpMax = Math.max(1, safeNumber(unwrapLssValue(vitality["hp-max"] ?? vitality.hp_max ?? vitality.hpMax), 10));
  const hpCurrent = Math.max(0, safeNumber(unwrapLssValue(vitality["hp-current"] ?? vitality.hp_current ?? vitality.hpCurrent), hpMax));

  return {
    name: String(unwrapLssValue(source?.name) || unwrapLssValue(info?.name) || "").trim(),
    level: Math.max(1, safeNumber(unwrapLssValue(info?.level), 1)),
    class_name: String(unwrapLssValue(info?.charClass) || unwrapLssValue(info?.class) || "").trim(),
    race: String(unwrapLssValue(info?.race) || "").trim(),
    hp_current: hpCurrent,
    hp_max: hpMax,
    ac: Math.max(0, safeNumber(unwrapLssValue(vitality?.ac), 10)),
    initiative: safeNumber(unwrapLssValue(vitality?.initiative), 0),
  };
}

function getMasterRoomCharacterPool() {
  return safeArray(MASTER_ROOM_STATE.characterPool).map((entry) => ({
    id: Number(entry?.id || 0),
    name: String(entry?.name || "").trim(),
    class_name: String(entry?.class_name || "").trim(),
    level: safeNumber(entry?.level, 1),
    race: String(entry?.race || "").trim(),
    alignment: String(entry?.alignment || "").trim(),
  })).filter((entry) => entry.id > 0 && entry.name);
}

function getMasterRoomSelectedCharacterPoolEntry() {
  const value = String(MASTER_ROOM_STATE.selectedCharacterPoolValue || "").trim();
  if (!value.startsWith("character:")) return null;
  const id = safeNumber(value.split(":")[1], 0);
  if (!id) return null;
  return getMasterRoomCharacterPool().find((entry) => Number(entry.id) === id) || null;
}

function normalizeEnemyCatalogEntry(entry, index = 0) {
  const statblock = entry?.statblock && typeof entry.statblock === "object" ? entry.statblock : {};
  const abilities = statblock?.abilities && typeof statblock.abilities === "object" ? statblock.abilities : {};
  const attacks = safeArray(statblock?.actions).map((action, actionIndex) => ({
    id: String(action?.id || `${entry?.id || `enemy_${index}`}_action_${actionIndex}`),
    name: String(action?.name || `Действие ${actionIndex + 1}`).trim(),
    text: String(action?.text || "").trim(),
  }));
  const hpText = String(statblock?.hp || "").trim();
  const hpGuess = safeNumber((hpText.match(/\d+/) || [10])[0], 10);
  const acGuess = safeNumber(statblock?.ac, safeNumber((String(statblock?.ac || "").match(/\d+/) || [10])[0], 10));
  const initiativeGuess = safeNumber(statblock?.initiative, safeNumber((String(statblock?.initiative || "").match(/[+-]?\d+/) || [0])[0], 0));

  return {
    id: String(entry?.id || `enemy_${index}`),
    title: String(entry?.title || entry?.name || `Противник ${index + 1}`).trim(),
    subtitle: String(entry?.subtitle || "").trim(),
    summary: String(entry?.summary || "").trim(),
    source: String(entry?.source || "encyclopedia").trim(),
    hp: Math.max(1, hpGuess),
    ac: Math.max(0, acGuess),
    initiative: initiativeGuess,
    attacks,
    abilities,
    spells: [],
  };
}

async function ensureMasterRoomEnemyCatalog() {
  if (MASTER_ROOM_STATE.enemyCatalog.length) return MASTER_ROOM_STATE.enemyCatalog;

  try {
    await loadBestiari();
  } catch (_) {}

  const bestiariEntries = safeArray(getBestiariState?.()?.entries).filter((entry) => String(entry?.category || "") === "monsters");
  const fallbackEntries = safeArray(CODEX_ENTRIES).filter((entry) => String(entry?.category || "") === "monsters");
  const sourceEntries = bestiariEntries.length ? bestiariEntries : fallbackEntries;

  MASTER_ROOM_STATE.enemyCatalog = sourceEntries.map((entry, index) => normalizeEnemyCatalogEntry(entry, index));
  return MASTER_ROOM_STATE.enemyCatalog;
}

function getCurrentUserId() {
  return String(getCurrentUser()?.id || "").trim();
}

function hasGlobalGmMode() {
  return getCurrentRole() === "gm";
}

function getMasterRoomCurrentMembership(table) {
  const currentUserId = getCurrentUserId();
  return safeArray(table?.members).find((member) => String(member.user_id || "") === currentUserId) || null;
}

function canManageMasterRoomTable(table) {
  if (!table) return false;
  if (table.viewer_can_manage) return true;
  const currentUserId = getCurrentUserId();
  if (!currentUserId) return false;
  if (String(table.owner_user_id || "") === currentUserId) return true;
  const membership = getMasterRoomCurrentMembership(table);
  return String(membership?.role_in_table || "") === "gm";
}

function applyMasterRoomTableResponse(payload) {
  const table = payload?.table ? normalizeMasterRoomTable(payload.table, 0) : null;
  if (!table) return;

  const index = MASTER_ROOM_STATE.tables.findIndex((entry) => entry.id === table.id);
  if (index >= 0) {
    MASTER_ROOM_STATE.tables[index] = table;
  } else {
    MASTER_ROOM_STATE.tables = [table, ...MASTER_ROOM_STATE.tables];
  }
  MASTER_ROOM_STATE.activeTableId = table.id;
  MASTER_ROOM_STATE.source = "api";
  ensureMasterRoomDefaults();
  try {
    window.dispatchEvent(new CustomEvent("dnd:party:changed", { detail: { table } }));
  } catch (_) {}
}

function applyAndRenderMasterRoom(payload) {
  applyMasterRoomTableResponse(payload);
  renderMasterRoom();
}

function stopMasterRoomPolling() {
  if (MASTER_ROOM_STATE.pollTimer) {
    clearInterval(MASTER_ROOM_STATE.pollTimer);
    MASTER_ROOM_STATE.pollTimer = null;
  }
}

function ensureMasterRoomPolling() {
  stopMasterRoomPolling();
  if (CABINET_STATE.activeTab !== "masterroom" || !isCabinetOpen()) return;
  MASTER_ROOM_STATE.pollTimer = window.setInterval(async () => {
    try {
      const activeBefore = MASTER_ROOM_STATE.activeTableId;
      await loadMasterRoom({ silent: true });
      if (activeBefore) {
        MASTER_ROOM_STATE.activeTableId = activeBefore;
        ensureMasterRoomDefaults();
      }
      renderMasterRoom();
    } catch (_) {}
  }, 7000);
}

async function loadMasterRoomUsers(query) {
  const needle = String(query || "").trim();
  if (!needle) {
    MASTER_ROOM_STATE.userSearchResults = [];
    return [];
  }

  const data = await apiClientGet(`/gm/users/search?q=${encodeURIComponent(needle)}`);
  MASTER_ROOM_STATE.userSearchResults = safeArray(data?.users);
  return MASTER_ROOM_STATE.userSearchResults;
}

async function loadMasterRoomTraders(query) {
  const needle = String(query || "").trim();
  const data = await apiClientGet(`/gm/traders/search?q=${encodeURIComponent(needle)}`);
  MASTER_ROOM_STATE.traderSearchResults = safeArray(data?.traders);
  return MASTER_ROOM_STATE.traderSearchResults;
}

async function loadMasterRoomItems(query) {
  const needle = String(query || "").trim();
  const data = await apiClientGet(`/gm/items/search?q=${encodeURIComponent(needle)}`);
  MASTER_ROOM_STATE.itemSearchResults = safeArray(data?.items);
  return MASTER_ROOM_STATE.itemSearchResults;
}

async function loadMasterRoom(options = {}) {
  const silent = Boolean(options?.silent);
  MASTER_ROOM_STATE.loaded = true;
  try {
    const data = await apiClientGet("/gm/master-room");
    MASTER_ROOM_STATE.tables = safeArray(data?.tables).map((table, index) => normalizeMasterRoomTable(table, index));
    MASTER_ROOM_STATE.source = "api";
    ensureMasterRoomDefaults();
    MASTER_ROOM_STATE.createOpen = MASTER_ROOM_STATE.tables.length === 0;
    if (!MASTER_ROOM_STATE.allTraders.length) {
      const tradersPayload = await fetchTraders().catch(() => null);
      MASTER_ROOM_STATE.allTraders = safeArray(tradersPayload?.traders).map((trader) => ({
        id: Number(trader?.id || 0),
        name: String(trader?.name || "").trim(),
        type: String(trader?.type || "").trim(),
        region: String(trader?.region || "").trim(),
      })).filter((trader) => trader.id > 0);
    }
    if (!MASTER_ROOM_STATE.enemyCatalog.length) {
      await ensureMasterRoomEnemyCatalog();
    }
    if (!MASTER_ROOM_STATE.characterPool.length) {
      const accountPayload = await fetchAccount().catch(() => null);
      MASTER_ROOM_STATE.characterPool = safeArray(accountPayload?.characters);
    }
    if (!MASTER_ROOM_STATE.selectedCharacterPoolValue) {
      MASTER_ROOM_STATE.selectedCharacterPoolValue = "lss-current";
    }
  } catch (error) {
    MASTER_ROOM_STATE.tables = [];
    MASTER_ROOM_STATE.source = "error";
    MASTER_ROOM_STATE.createOpen = true;
    if (!silent) {
      showToast(error.message || "Не удалось загрузить Master Room");
    }
  }
  ensureMasterRoomPolling();
  renderMasterRoom();
  try {
    window.dispatchEvent(new CustomEvent("dnd:party:changed", { detail: { tables: MASTER_ROOM_STATE.tables } }));
  } catch (_) {}
  return MASTER_ROOM_STATE.tables;
}

function renderMasterRoomUserSearchResults(table) {
  if (!MASTER_ROOM_STATE.inviteQuery.trim()) return "";

  const existing = new Set(safeArray(table?.members).map((member) => String(member.user_id || "").trim()));
  const users = MASTER_ROOM_STATE.userSearchResults.filter((user) => !existing.has(String(user.id || "")));

  if (!users.length) {
    return `<div class="muted" style="font-size:0.8rem;">Совпадений не найдено.</div>`;
  }

  return users.map((user) => `
    <div class="cabinet-block" style="padding:10px 12px; margin-top:8px;">
      <div class="flex-between" style="gap:10px; flex-wrap:wrap;">
        <div>
          <div style="font-weight:800;">${escapeHtml(user.nickname || user.email || "Игрок")}</div>
          <div class="muted" style="font-size:0.8rem;">${escapeHtml(user.email || "")}</div>
        </div>
        <button class="btn btn-primary" type="button" data-master-room-add-user-id="${escapeHtml(String(user.id || ""))}">
          Добавить
        </button>
      </div>
    </div>
  `).join("");
}

function renderMasterRoomItemSearchResults() {
  return safeArray(MASTER_ROOM_STATE.itemSearchResults).map((item) => `
    <div class="cabinet-block" style="padding:10px 12px; margin-top:8px;">
      <div class="flex-between" style="gap:10px; flex-wrap:wrap;">
        <div>
          <div style="font-weight:800;">${escapeHtml(item.name || "Предмет")}</div>
          <div class="muted" style="font-size:0.8rem;">${escapeHtml(item.category || "")} ${item.rarity ? `• ${escapeHtml(item.rarity)}` : ""}</div>
        </div>
        <button class="btn btn-primary" type="button" data-master-room-grant-item-id="${escapeHtml(String(item.id || ""))}">
          Выдать
        </button>
      </div>
    </div>
  `).join("");
}

function patchMasterRoomResults(containerId, html) {
  const container = getEl(containerId);
  if (!container) return;
  container.innerHTML = html;
  bindMasterRoomActions();
}

function restoreMasterRoomInputCursor(inputId, cursor) {
  const nextInput = getEl(inputId);
  if (!nextInput) return;
  nextInput.focus();
  try {
    nextInput.setSelectionRange(cursor, cursor);
  } catch (_) {}
}

function getMasterRoomMemberById(table, memberId) {
  return safeArray(table?.members).find((entry) => String(entry.id || "") === String(memberId || ""));
}

function getMasterRoomCombatEntry(table, membershipId) {
  return safeArray(table?.combat?.entries).find((entry) => String(entry.membership_id || "") === String(membershipId || ""));
}

function getMasterRoomCombatEntryById(table, entryId) {
  return safeArray(table?.combat?.entries).find((entry) => String(entry.entry_id || "") === String(entryId || ""));
}

function renderMasterRoomVisibilityMatrix(member) {
  const matrix = getMasterRoomMemberVisibilityMatrix(member);
  return `
    <div class="master-room-visibility-matrix">
      ${getMasterRoomVisibilitySections().map((section) => `
        <label class="master-room-visibility-cell">
          <span>${escapeHtml(section.label)}</span>
          <select data-master-room-visibility-scope="${escapeHtml(member.id)}" data-master-room-visibility-key="${escapeHtml(section.key)}">
            ${["public", "gm_only", "owner_only", "revealed"].map((scope) => `
              <option value="${escapeHtml(scope)}" ${matrix[section.key] === scope ? "selected" : ""}>${escapeHtml(masterRoomScopeLabel(scope))}</option>
            `).join("")}
          </select>
        </label>
      `).join("")}
    </div>
  `;
}

function renderMasterRoomFieldVisibilityEditor(member) {
  const table = getMasterRoomActiveTable();
  const canEdit = canEditMasterRoomMemberVisibility(member, table);
  const matrix = getMasterRoomMemberVisibilityMatrix(member);
  const fields = getMasterRoomMemberVisibilityFields(member);
  const summary = countMasterRoomOpenVisibilityFields(member);
  const disabledAttr = canEdit ? "" : "disabled";

  return `
    <div class="master-room-field-visibility">
      <div class="flex-between master-room-field-visibility-head">
        <div>
          <div class="muted master-room-section-kicker">LSS visibility</div>
          <h5 class="master-room-field-visibility-title">Что видно за столом</h5>
          <div class="muted master-room-command-copy">
            ${canEdit
              ? "Настройка полей LSS-фишки: что раскрыто партии, что видно только владельцу, а что остаётся в GM-слое."
              : "Просмотр текущего слоя видимости. Менять его может владелец персонажа или GM стола."}
          </div>
        </div>
        <div class="master-room-visibility-meter master-room-field-visibility-summary">
          <span>Открыто партии</span>
          <strong>${escapeHtml(String(summary.open))}/${escapeHtml(String(summary.total))}</strong>
        </div>
      </div>
      <div class="master-room-field-visibility-grid">
        ${getMasterRoomVisibilityFieldGroups().map((group) => {
          const sectionScope = normalizeMasterRoomScope(matrix[group.key]);
          return `
            <section class="master-room-field-visibility-group">
              <div class="master-room-field-visibility-group-head">
                <strong>${escapeHtml(group.label)}</strong>
                <span>${escapeHtml(masterRoomScopeLabel(sectionScope))}</span>
              </div>
              <div class="master-room-field-visibility-list">
                ${group.fields.map((field) => {
                  const explicitScope = fields?.[group.key]?.[field.key] || "";
                  const resolvedScope = getMasterRoomFieldScope(member, group.key, field.key);
                  return `
                    <label class="master-room-field-visibility-row">
                      <span>
                        <strong>${escapeHtml(field.label)}</strong>
                        <small>${explicitScope ? escapeHtml(masterRoomScopeLabel(resolvedScope)) : `наследует: ${escapeHtml(masterRoomScopeLabel(sectionScope))}`}</small>
                      </span>
                      <select ${disabledAttr} data-master-room-field-visibility-member="${escapeHtml(member.id)}" data-master-room-field-visibility-group="${escapeHtml(group.key)}" data-master-room-field-visibility-key="${escapeHtml(field.key)}">
                        <option value="" ${explicitScope ? "" : "selected"}>inherit</option>
                        ${["public", "revealed", "owner_only", "gm_only"].map((scope) => `
                          <option value="${escapeHtml(scope)}" ${explicitScope === scope ? "selected" : ""}>${escapeHtml(masterRoomScopeLabel(scope))}</option>
                        `).join("")}
                      </select>
                    </label>
                  `;
                }).join("")}
              </div>
            </section>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderMasterRoomCharacterSheet(member) {
  const table = getMasterRoomActiveTable();
  const sheet = member?.character_sheet && typeof member.character_sheet === "object" ? member.character_sheet : {};
  const identity = sheet.identity && typeof sheet.identity === "object" ? sheet.identity : {};
  const combat = sheet.combat && typeof sheet.combat === "object" ? sheet.combat : {};
  const stats = sheet.stats && typeof sheet.stats === "object" ? sheet.stats : {};
  const story = sheet.story && typeof sheet.story === "object" ? sheet.story : {};
  const spells = sheet.spells && typeof sheet.spells === "object" ? sheet.spells : {};
  const inventory = sheet.inventory && typeof sheet.inventory === "object" ? sheet.inventory : {};
  const equipment = sheet.equipment && typeof sheet.equipment === "object" ? sheet.equipment : {};
  const notes = sheet.notes && typeof sheet.notes === "object" ? sheet.notes : {};

  const statEntries = Object.entries(stats).slice(0, 6);
  const inventoryEntries = safeArray(inventory.items).slice(0, 4);
  const equipmentEntries = safeArray(equipment.weapons || equipment.items).slice(0, 4);
  const spellSlots = Object.entries(spells.slots || {}).slice(0, 4);
  const noteEntries = safeArray(notes.entries).slice(0, 3);
  const canSee = (groupKey, fieldKey) => canViewMasterRoomMemberField(member, groupKey, fieldKey, table);
  const canSeeName = canSee("identity", "name");
  const canSeePortrait = canSee("identity", "portrait");
  const canSeeClass = canSee("identity", "class_level_race");
  const canSeeBackground = canSee("identity", "background");
  const canSeeHp = canSee("combat", "hp");
  const canSeeAc = canSee("combat", "ac");
  const canSeeInitiative = canSee("combat", "initiative");
  const canSeeStats = canSee("stats", "abilities");
  const canSeeSpells = canSee("spells", "slots") || canSee("spells", "prepared") || canSee("spells", "known");
  const canSeeInventory = canSee("inventory", "items") || canSee("inventory", "currency") || canSee("inventory", "consumables");
  const canSeeEquipment = canSee("equipment", "weapons") || canSee("equipment", "armor") || canSee("equipment", "attunement");
  const canSeeStory = canSee("story", "personality") || canSee("story", "quests") || canSee("story", "relationships");
  const canSeeNotes = canSee("notes", "gm_notes") || canSee("notes", "private_notes") || canSee("notes", "secrets");
  const visibleName = canSeeName
    ? (identity.name || member?.selected_character_name || member?.nickname || "Персонаж")
    : "Скрытый персонаж";
  const visibleClassLine = canSeeClass
    ? `${escapeHtml(identity.class_name || "class")} ${identity.subclass ? `• ${escapeHtml(identity.subclass)}` : ""} ${identity.race ? `• ${escapeHtml(identity.race)}` : ""}`
    : "Класс, уровень и раса скрыты";

  return `
    <div class="cabinet-block master-room-sheet-card">
      <div class="flex-between" style="gap:12px; align-items:flex-start; flex-wrap:wrap; margin-bottom:10px;">
        <div>
          <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em;">LSS-like sheet view</div>
          <h4 style="margin:4px 0 6px;">${escapeHtml(visibleName)}</h4>
          <div class="muted" style="font-size:0.82rem;">${visibleClassLine}</div>
        </div>
        <div class="trader-meta" style="gap:6px; flex-wrap:wrap;">
          ${canSeePortrait && sheet.portrait_url ? `<img src="${escapeHtml(sheet.portrait_url)}" alt="${escapeHtml(visibleName || "portrait")}" class="master-room-sheet-avatar">` : ""}
          ${canSeeHp && combat.hp_max ? `<span class="meta-item">HP ${escapeHtml(String(combat.hp_current || 0))}/${escapeHtml(String(combat.hp_max || 0))}</span>` : ""}
          ${canSeeAc && combat.ac ? `<span class="meta-item">AC ${escapeHtml(String(combat.ac || 0))}</span>` : ""}
          ${canSeeInitiative && (combat.initiative || combat.initiative === 0) ? `<span class="meta-item">Init ${escapeHtml(String(combat.initiative || 0))}</span>` : ""}
        </div>
      </div>
      <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px;">
        ${canSeeClass || canSeeBackground ? `<div class="stat-box" style="min-height:auto; padding:12px;">
          <div class="muted">Identity</div>
          <div style="margin-top:8px; font-size:0.86rem; line-height:1.55;">
            ${canSeeBackground && identity.background ? `${escapeHtml(identity.background)}<br>` : ""}
            ${canSeeBackground && identity.alignment ? `${escapeHtml(identity.alignment)}<br>` : ""}
            ${canSeeClass ? `lvl ${escapeHtml(String(identity.level || 1))}` : ""}
          </div>
        </div>` : renderMasterRoomLockedField("Identity")}
        ${statEntries.length && canSeeStats ? `
          <div class="stat-box" style="min-height:auto; padding:12px;">
            <div class="muted">Stats</div>
            <div class="master-room-mini-grid" style="margin-top:8px;">
              ${statEntries.map(([key, value]) => `<span class="meta-item">${escapeHtml(String(key).toUpperCase())}: ${escapeHtml(String(value))}</span>`).join("")}
            </div>
          </div>
        ` : statEntries.length ? renderMasterRoomLockedField("Stats") : ""}
        ${spellSlots.length && canSeeSpells ? `
          <div class="stat-box" style="min-height:auto; padding:12px;">
            <div class="muted">Spells</div>
            <div class="master-room-mini-grid" style="margin-top:8px;">
              ${spellSlots.map(([key, value]) => `<span class="meta-item">${escapeHtml(String(key))}: ${escapeHtml(String(value))}</span>`).join("")}
            </div>
          </div>
        ` : spellSlots.length ? renderMasterRoomLockedField("Spells") : ""}
        ${inventoryEntries.length && canSeeInventory ? `
          <div class="stat-box" style="min-height:auto; padding:12px;">
            <div class="muted">Inventory</div>
            <div style="margin-top:8px; font-size:0.84rem; line-height:1.5;">${inventoryEntries.map((item) => escapeHtml(item)).join("<br>")}</div>
          </div>
        ` : inventoryEntries.length ? renderMasterRoomLockedField("Inventory") : ""}
        ${equipmentEntries.length && canSeeEquipment ? `
          <div class="stat-box" style="min-height:auto; padding:12px;">
            <div class="muted">Equipment</div>
            <div style="margin-top:8px; font-size:0.84rem; line-height:1.5;">${equipmentEntries.map((item) => escapeHtml(item)).join("<br>")}</div>
          </div>
        ` : equipmentEntries.length ? renderMasterRoomLockedField("Equipment") : ""}
      </div>
      ${story.background || story.personality || noteEntries.length ? `
        <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; margin-top:10px;">
          ${story.background ? (canSeeStory ? `<div class="stat-box" style="min-height:auto; padding:12px;"><div class="muted">Background</div><div style="margin-top:8px; font-size:0.84rem; line-height:1.55;">${escapeHtml(clampText(story.background, 420))}</div></div>` : renderMasterRoomLockedField("Background")) : ""}
          ${story.personality ? (canSeeStory ? `<div class="stat-box" style="min-height:auto; padding:12px;"><div class="muted">Personality</div><div style="margin-top:8px; font-size:0.84rem; line-height:1.55;">${escapeHtml(clampText(story.personality, 320))}</div></div>` : renderMasterRoomLockedField("Personality")) : ""}
          ${noteEntries.length ? (canSeeNotes ? `<div class="stat-box" style="min-height:auto; padding:12px;"><div class="muted">Notes</div><div style="margin-top:8px; font-size:0.84rem; line-height:1.55;">${noteEntries.map((item) => escapeHtml(clampText(item, 160))).join("<br>")}</div></div>` : renderMasterRoomLockedField("Notes")) : ""}
        </div>
      ` : ""}
      ${renderMasterRoomFieldVisibilityEditor(member)}
    </div>
  `;
}

function renderMasterRoomParticipants(table) {
  if (!table?.members?.length) {
    return `<div class="cabinet-block"><p>Участников пока нет.</p></div>`;
  }

  const currentUserId = getCurrentUserId();
  const lss = getCurrentLssCharacterSnapshot();
  const canManage = canManageMasterRoomTable(table);
  const characterPoolOptions = getMasterRoomCharacterPool()
    .map((entry) => `<option value="${escapeHtml(String(entry.id))}">${escapeHtml(entry.name)}${entry.class_name ? ` • ${escapeHtml(entry.class_name)}` : ""}${entry.level ? ` • lvl ${escapeHtml(String(entry.level))}` : ""}</option>`)
    .join("");

  return table.members.map((member) => `
    <div class="cabinet-block" style="padding:12px; margin-bottom:10px;">
      <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
        <div>
          <div style="font-weight:800;">${escapeHtml(member.nickname)}</div>
          <div class="muted" style="font-size:0.8rem;">
            ${escapeHtml(member.email || "email не задан")}
            • ${member.role_in_table === "gm" ? "ГМ" : "Игрок"}
            ${String(member.user_id || "") === currentUserId ? " • это ты" : ""}
          </div>
        </div>
        <button class="btn btn-danger" type="button" data-master-room-remove-member="${escapeHtml(member.id)}">
          Убрать
        </button>
      </div>

      <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px;">
        <div class="filter-group">
          <label>Роль в столе</label>
          <select data-master-room-member-role="${escapeHtml(member.id)}">
            <option value="player" ${member.role_in_table === "player" ? "selected" : ""}>player</option>
            <option value="gm" ${member.role_in_table === "gm" ? "selected" : ""}>gm</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Видимость персонажа</label>
          <select data-master-room-member-visibility="${escapeHtml(member.id)}">
            <option value="private" ${member.visibility_preset === "private" ? "selected" : ""}>private</option>
            <option value="basic" ${member.visibility_preset === "basic" ? "selected" : ""}>basic</option>
            <option value="sheet" ${member.visibility_preset === "sheet" ? "selected" : ""}>sheet</option>
            <option value="full" ${member.visibility_preset === "full" ? "selected" : ""}>full</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Персонаж</label>
          <input type="text" value="${escapeHtml(member.selected_character_name || "")}" data-master-room-member-character="${escapeHtml(member.id)}" placeholder="Имя персонажа">
          <div class="muted" style="font-size:0.76rem; margin-top:6px;">Приоритет имени: ручное имя за столом → персонаж аккаунта → имя из LSS.</div>
          <div class="trader-meta" style="gap:6px; flex-wrap:wrap; margin-top:8px;">
            <span class="meta-item">${escapeHtml(member.selected_character_name_source || "fallback")}</span>
            ${member.selected_character_lss_name ? `<span class="meta-item">LSS: ${escapeHtml(member.selected_character_lss_name)}</span>` : ""}
          </div>
          ${
            String(member.user_id || "") === currentUserId && lss.name
              ? `<div class="cart-buttons" style="margin-top:8px; gap:6px;">
                  <button class="btn btn-primary" type="button" data-master-room-use-lss="${escapeHtml(member.id)}">Импорт из LSS</button>
                  <span class="meta-item">LSS: ${escapeHtml(lss.name)}${lss.class_name ? ` • ${escapeHtml(lss.class_name)}` : ""}${lss.level ? ` • lvl ${escapeHtml(String(lss.level))}` : ""}</span>
                </div>`
              : ""
          }
          ${
            String(member.user_id || "") === currentUserId && characterPoolOptions
              ? `<div class="filter-group" style="margin-top:8px;">
                  <label>Пул персонажей аккаунта</label>
                  <select data-master-room-member-character-select="${escapeHtml(member.id)}">
                    <option value="">Выбери персонажа</option>
                    ${characterPoolOptions}
                  </select>
                </div>`
              : ""
          }
        </div>
      </div>
      ${canManage ? `
        <div style="margin-top:10px;">
          <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:8px;">Visibility matrix</div>
          ${renderMasterRoomVisibilityMatrix(member)}
        </div>
      ` : ""}
    </div>
  `).join("");
}

function renderMasterRoomTraderAccesses(table) {
  const accesses = safeArray(table?.trader_accesses);
  const currentLabel = table?.trader_access_mode === "restricted" ? "restricted" : "open";
  const enabledIds = new Set(accesses.map((entry) => Number(entry?.trader_id || 0)));
  const availableTraderOptions = safeArray(MASTER_ROOM_STATE.allTraders).filter((trader) => !enabledIds.has(Number(trader.id || 0)));

  return `
    <div class="cabinet-block master-room-stage-panel master-room-ops-card">
      <div class="flex-between" style="gap:12px; flex-wrap:wrap;">
        <div>
          <h4 style="margin:0 0 6px 0;">Доступ к торговцам</h4>
          <div class="muted" style="font-size:0.82rem;">В режиме <strong>${escapeHtml(currentLabel)}</strong> игроки видят либо всех торговцев, либо только разрешённых ГМом.</div>
        </div>
        <div class="filter-group" style="min-width:180px;">
          <label>Режим доступа</label>
          <select id="masterRoomTraderAccessMode">
            <option value="open" ${table?.trader_access_mode !== "restricted" ? "selected" : ""}>open</option>
            <option value="restricted" ${table?.trader_access_mode === "restricted" ? "selected" : ""}>restricted</option>
          </select>
        </div>
      </div>

      <div class="collection-toolbar compact-collection-toolbar" style="margin-top:10px; align-items:end;">
        <div class="filter-group" style="min-width:280px; flex:1 1 280px;">
          <label>Добавить торговца в стол</label>
          <select id="masterRoomTraderSelect">
            <option value="">Выбери торговца</option>
            ${availableTraderOptions.map((trader) => `
              <option value="${escapeHtml(String(trader.id))}">
                ${escapeHtml(trader.name)}${trader.type ? ` • ${escapeHtml(trader.type)}` : ""}${trader.region ? ` • ${escapeHtml(trader.region)}` : ""}
              </option>
            `).join("")}
          </select>
        </div>
        <button class="btn btn-primary" type="button" id="masterRoomAddTraderBtn">Открыть доступ</button>
      </div>

      <div style="margin-top:10px;">
        ${accesses.length ? accesses.map((entry) => `
          <div class="cabinet-block" style="padding:10px 12px; margin-top:8px;">
            <div class="flex-between" style="gap:10px; flex-wrap:wrap;">
              <div>
                <div style="font-weight:800;">${escapeHtml(entry.name || "Торговец")}</div>
                <div class="muted" style="font-size:0.8rem;">ID: ${escapeHtml(String(entry.trader_id || ""))}</div>
              </div>
              <button class="btn btn-danger" type="button" data-master-room-remove-trader-id="${escapeHtml(String(entry.trader_id || ""))}">
                Закрыть доступ
              </button>
            </div>
          </div>
        `).join("") : `<div class="muted" style="margin-top:8px;">Разрешённых торговцев пока нет.</div>`}
      </div>
    </div>
  `;
}

function renderMasterRoomGrantPanel(table) {
  const playerOptions = safeArray(table?.members)
    .filter((member) => member.role_in_table !== "gm")
    .map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.nickname)}</option>`)
    .join("");

  return `
    <div class="cabinet-block master-room-stage-panel master-room-ops-card">
      <h4 style="margin:0 0 8px 0;">Ручная выдача предметов</h4>

      <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px;">
        <div class="filter-group">
          <label>Игрок</label>
          <select id="masterRoomGrantMemberId">
            <option value="">Выбери игрока</option>
            ${playerOptions}
          </select>
        </div>
        <div class="filter-group">
          <label>Количество</label>
          <input id="masterRoomGrantQuantity" type="number" min="1" step="1" value="${escapeHtml(String(MASTER_ROOM_STATE.grantQuantity || 1))}">
        </div>
        <div class="filter-group" style="grid-column:1 / -1;">
          <label>Найти предмет</label>
          <input id="masterRoomItemSearchInput" type="text" value="${escapeHtml(MASTER_ROOM_STATE.itemSearchQuery || "")}" placeholder="Название предмета">
        </div>
      </div>

      <div style="margin-top:8px;">
        <div id="masterRoomItemSearchResults">
        ${renderMasterRoomItemSearchResults()}
        </div>
      </div>

      <div style="margin-top:10px;">
        <h5 style="margin:0 0 8px 0;">Последние выдачи</h5>
        ${safeArray(table?.grants).length ? safeArray(table.grants).map((grant) => `
          <div class="cabinet-block" style="padding:10px 12px; margin-top:8px;">
            <div class="flex-between" style="gap:10px; flex-wrap:wrap;">
              <div>
                <div style="font-weight:800;">${escapeHtml(grant.item_name || "Предмет")}</div>
                <div class="muted" style="font-size:0.8rem;">×${escapeHtml(String(grant.quantity || 1))} • ${escapeHtml(formatDateTime(grant.created_at))}</div>
              </div>
              <div class="muted" style="font-size:0.8rem;">${escapeHtml(grant.created_by_nickname || "ГМ")}</div>
            </div>
          </div>
        `).join("") : `<div class="muted">Выдач пока нет.</div>`}
      </div>
    </div>
  `;
}

function renderMasterRoomLssBridge(table) {
  const snapshot = getCurrentLssCharacterSnapshot();
  const currentMember = safeArray(table?.members).find((member) => String(member.user_id || "") === getCurrentUserId());
  const characterPool = getMasterRoomCharacterPool();
  const selectedPoolEntry = getMasterRoomSelectedCharacterPoolEntry();
  const selectorValue = String(MASTER_ROOM_STATE.selectedCharacterPoolValue || "lss-current").trim() || "lss-current";

  return `
    <div class="cabinet-block master-room-stage-panel">
      <div class="flex-between master-room-section-head">
        <div>
          <div class="muted master-room-section-kicker">LSS</div>
          <h4 class="master-room-section-title">Активный персонаж игрока</h4>
          <div class="muted master-room-command-copy">Можно взять текущий LSS или выбрать персонажа из аккаунт-пула и привязать его к столу без ручного ввода.</div>
        </div>
        <div class="trader-meta cabinet-header-meta">
          <span class="meta-item">${snapshot.name || selectedPoolEntry?.name || "LSS не выбран"}</span>
          ${snapshot.class_name ? `<span class="meta-item">${escapeHtml(snapshot.class_name)}</span>` : ""}
          <span class="meta-item">HP ${escapeHtml(String(snapshot.hp_current || 0))}/${escapeHtml(String(snapshot.hp_max || 0))}</span>
        </div>
      </div>
      <div class="profile-grid master-room-lss-grid">
        <div class="filter-group">
          <label>Выбор персонажа для стола</label>
          <select id="masterRoomCharacterPoolSelect">
            <option value="lss-current" ${selectorValue === "lss-current" ? "selected" : ""}>Текущий LSS${snapshot.name ? ` • ${escapeHtml(snapshot.name)}` : ""}</option>
            ${characterPool.map((entry) => `
              <option value="character:${escapeHtml(String(entry.id))}" ${selectorValue === `character:${entry.id}` ? "selected" : ""}>
                ${escapeHtml(entry.name)}${entry.class_name ? ` • ${escapeHtml(entry.class_name)}` : ""}${entry.level ? ` • lvl ${escapeHtml(String(entry.level))}` : ""}
              </option>
            `).join("")}
          </select>
        </div>
        <div class="cart-buttons master-room-lss-actions">
          <button class="btn btn-primary" type="button" id="masterRoomApplyCharacterPoolBtn" ${currentMember ? "" : "disabled"}>Привязать к столу</button>
        </div>
      </div>
      ${
        snapshot.name || selectedPoolEntry
          ? `
            <div class="profile-grid master-room-stats-grid">
              <div class="stat-box master-room-stat-card"><div class="muted">Имя</div><div class="master-room-stat-value">${escapeHtml(snapshot.name || selectedPoolEntry?.name || "—")}</div></div>
              <div class="stat-box master-room-stat-card"><div class="muted">Класс</div><div class="master-room-stat-value">${escapeHtml(snapshot.class_name || selectedPoolEntry?.class_name || "—")}</div></div>
              <div class="stat-box master-room-stat-card"><div class="muted">Уровень</div><div class="master-room-stat-value">${escapeHtml(String(snapshot.level || selectedPoolEntry?.level || 1))}</div></div>
              <div class="stat-box master-room-stat-card"><div class="muted">Инициатива</div><div class="master-room-stat-value">${escapeHtml(String(snapshot.initiative || 0))}</div></div>
            </div>
          `
          : `<div class="muted">Сначала открой вкладку LSS и загрузи персонажа. После этого здесь появится подтверждение привязки к столу.</div>`
      }
      ${currentMember ? `<div class="master-room-sheet-wrap">${renderMasterRoomCharacterSheet(currentMember)}</div>` : ""}
    </div>
  `;
}

function renderMasterRoomPartyOverview(table) {
  const members = safeArray(table?.members);
  const activeSheetId = String(MASTER_ROOM_STATE.activeSheetMemberId || members[0]?.id || "").trim();
  const activeSheetMember = members.find((member) => String(member.id || "") === activeSheetId) || members[0] || null;
  return `
    <div class="cabinet-block master-room-stage-panel master-room-party-shell">
      <div class="flex-between master-room-section-head">
        <div>
          <div class="muted master-room-section-kicker">Партия</div>
          <h4 class="master-room-section-title">Состав стола</h4>
          <div class="muted master-room-command-copy">Как в RPG-хабе: сразу видно кто за столом, кем играет и какую роль держит.</div>
        </div>
        <span class="meta-item">${members.length}</span>
      </div>
      <div class="profile-grid master-room-party-grid">
        ${members.map((member) => `
          <div class="stat-box master-room-party-card">
            <div class="flex-between master-room-party-card-head">
              <div>
                <div class="master-room-party-card-title">${escapeHtml(resolveMasterRoomCharacterName(member, member.display_name || member.nickname).value)}</div>
                <div class="muted master-room-party-card-subtitle">${escapeHtml(member.nickname || member.email || "Игрок")}</div>
              </div>
              <span class="quality-badge master-room-party-badge">${member.role_in_table === "gm" ? "GM" : "Player"}</span>
            </div>
            <div class="trader-meta master-room-party-meta">
              <span class="meta-item">${escapeHtml(masterRoomVisibilityLabel(member.visibility_preset))}</span>
              <span class="meta-item">${resolveMasterRoomCharacterName(member, member.display_name || member.nickname).source === "manual" ? "ручное имя" : "linked/LSS имя"}</span>
            </div>
            <div class="cart-buttons master-room-action-row">
              <button class="btn ${String(member.id || "") === String(activeSheetMember?.id || "") ? "active" : ""}" type="button" data-master-room-open-sheet="${escapeHtml(member.id)}">Открыть sheet</button>
            </div>
          </div>
        `).join("")}
      </div>
      ${activeSheetMember ? `<div class="master-room-sheet-wrap">${renderMasterRoomCharacterSheet(activeSheetMember)}</div>` : ""}
    </div>
  `;
}

function renderMasterRoomDiceDock(combat) {
  const dieButtons = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];
  const last = MASTER_ROOM_STATE.combatLastRoll || combat?.log?.slice?.(-1)?.find?.((entry) => entry?.type === "roll") || null;
  return `
    <div class="master-room-dice-dock master-room-stage-panel">
      <div class="cabinet-block master-room-dice-panel">
        <div class="flex-between master-room-dice-head">
          <div>
            <div class="master-room-dice-title">🎲 Кубы</div>
            <div class="muted master-room-dice-copy">быстрый боевой бросок</div>
          </div>
          <button class="btn btn-secondary master-room-compact-btn" type="button" id="masterRoomDiceToggleBtn">
            ${MASTER_ROOM_STATE.combatDiceOpen ? "Скрыть" : "Открыть"}
          </button>
        </div>
        ${
          MASTER_ROOM_STATE.combatDiceOpen
            ? `
              <div class="cart-buttons master-room-dice-actions">
                ${dieButtons.map((die) => `
                  <button class="btn ${MASTER_ROOM_STATE.combatDiceType === die ? "btn-primary" : "btn-secondary"} master-room-die-btn" type="button" data-master-room-roll-die="${die}">
                    ${die.toUpperCase()}
                  </button>
                `).join("")}
              </div>
              <div class="muted master-room-dice-last">
                ${last ? `Последний: <strong>${escapeHtml(String(last.dice || last.type || "").toUpperCase())}</strong> → <strong>${escapeHtml(String(last.roll_total || last.result || "—"))}</strong>` : "Выбери куб"}
              </div>
            `
            : ""
        }
      </div>
    </div>
  `;
}

function renderMasterRoomEnemyPanel(table) {
  const combat = normalizeMasterRoomCombat(table?.combat);
  const query = String(MASTER_ROOM_STATE.enemyQuery || "").trim().toLowerCase();
  const catalog = safeArray(MASTER_ROOM_STATE.enemyCatalog).filter((entry) => {
    if (!query) return true;
    return [entry.title, entry.subtitle, entry.summary].join(" ").toLowerCase().includes(query);
  }).slice(0, 8);
  const enemies = combat.entries.filter((entry) => entry.entry_type === "enemy");

  return `
    <div class="cabinet-block master-room-stage-panel">
      <div class="flex-between" style="align-items:flex-start; gap:12px; flex-wrap:wrap; margin-bottom:10px;">
        <div>
          <div class="muted" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em;">Противники</div>
          <h4 style="margin:4px 0 6px;">Враги из энциклопедии или вручную</h4>
          <div class="muted" style="font-size:0.82rem;">Можно быстро добавить монстра из энциклопедии и сразу получить его боевые статы в журнале боя.</div>
        </div>
        <span class="meta-item">${enemies.length}</span>
      </div>
      <div class="profile-grid" style="grid-template-columns:minmax(260px,0.9fr) minmax(0,1.1fr); gap:12px;">
        <div>
          <div class="filter-group">
            <label>Найти монстра из энциклопедии</label>
            <input id="masterRoomEnemySearchInput" type="text" value="${escapeHtml(MASTER_ROOM_STATE.enemyQuery || "")}" placeholder="Гоблин, маг, дракон...">
          </div>
          <div style="margin-top:10px;">
            ${catalog.length ? catalog.map((entry) => `
              <div class="cabinet-block" style="padding:10px 12px; margin-top:8px;">
                <div class="flex-between" style="gap:10px; flex-wrap:wrap;">
                  <div>
                    <div style="font-weight:800;">${escapeHtml(entry.title)}</div>
                    <div class="muted" style="font-size:0.8rem;">HP ${escapeHtml(String(entry.hp))} • AC ${escapeHtml(String(entry.ac))} • Init ${escapeHtml(String(entry.initiative || 0))}</div>
                  </div>
                  <button class="btn btn-primary" type="button" data-master-room-add-enemy="${escapeHtml(entry.id)}">Добавить</button>
                </div>
              </div>
            `).join("") : `<div class="muted">Совпадений по энциклопедии нет.</div>`}
          </div>
        </div>
        <div>
          <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px;">
            <div class="filter-group">
              <label>Имя вручную</label>
              <input id="masterRoomManualEnemyName" type="text" placeholder="Наёмник, культист, варг">
            </div>
            <div class="filter-group">
              <label>HP</label>
              <input id="masterRoomManualEnemyHp" type="number" min="1" step="1" value="10">
            </div>
            <div class="filter-group">
              <label>AC</label>
              <input id="masterRoomManualEnemyAc" type="number" min="0" step="1" value="10">
            </div>
            <div class="filter-group">
              <label>Init</label>
              <input id="masterRoomManualEnemyInit" type="number" step="1" value="0">
            </div>
          </div>
          <div class="cart-buttons" style="margin-top:10px;">
            <button class="btn" type="button" id="masterRoomAddManualEnemyBtn">Добавить вручную</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderMasterRoomInitiativeTrack(combat) {
  const entries = safeArray(combat?.entries);
  if (!entries.length) {
    return `
      <div class="master-room-initiative-track">
        <div class="muted master-room-combat-copy">Очередь хода появится после сборки боя.</div>
      </div>
    `;
  }

  return `
    <div class="master-room-initiative-track">
      <div class="master-room-initiative-grid">
        <div class="master-room-initiative-control">
          <div class="master-room-initiative-title">Инициатива</div>
          <label class="master-room-initiative-sort">
            <span>Сортировка:</span>
            <select aria-label="Сортировка инициативы">
              <option>Инициатива</option>
            </select>
          </label>
        </div>
        <span class="master-room-initiative-arrow" aria-hidden="true">‹‹</span>
        <div>
          <div class="master-room-initiative-row">
            ${entries.map((entry, index) => {
              const active = index === combat.turn_index;
              const next = index === ((combat.turn_index + 1) % Math.max(entries.length, 1)) && !active;
              const portrait = entry.portrait_url
                ? `<img src="${escapeHtml(entry.portrait_url)}" alt="${escapeHtml(entry.name)}" class="master-room-initiative-avatar">`
                : `<span class="master-room-initiative-avatar master-room-initiative-avatar-fallback ${entry.entry_type === "enemy" ? "master-room-initiative-avatar-enemy" : "master-room-initiative-avatar-ally"}"><span>${escapeHtml((entry.name || "?").slice(0, 1).toUpperCase())}</span></span>`;
              return `
                <button
                  class="master-room-initiative-chip ${active ? "master-room-initiative-chip-active" : ""} ${next ? "master-room-initiative-chip-next" : ""} ${entry.entry_type === "enemy" ? "master-room-initiative-chip-enemy" : ""}"
                  type="button"
                  data-master-room-focus-turn="${escapeHtml(String(index))}"
                >
                  ${active ? `<span class="master-room-initiative-caret"></span>` : ""}
                  <span class="master-room-initiative-status">${entry.entry_type === "enemy" ? "✦" : "◆"}</span>
                  ${portrait}
                  <span class="master-room-initiative-score">${escapeHtml(String(entry.initiative || 0))}</span>
                  <span class="master-room-initiative-chip-body">
                    <strong>${escapeHtml(entry.name)}</strong>
                  </span>
                </button>
              `;
            }).join("")}
          </div>
        </div>
        <span class="master-room-initiative-arrow" aria-hidden="true">››</span>
      </div>
      <div class="master-room-initiative-now">
        <span></span>
        <div>Ход: <strong>${escapeHtml((combat.entries[combat.turn_index]?.name || "не выбран"))}</strong></div>
        <span></span>
      </div>
    </div>
  `;
}

function renderMasterRoomCombatLogPanel(combat) {
  const entries = safeArray(combat?.log).filter((entry) => isMasterRoomCombatLogEntryVisible(
    entry,
    MASTER_ROOM_STATE.combatLogFilter,
    MASTER_ROOM_STATE.combatHideSecondary
  ));
  if (!entries.length) {
    return `<div class="muted">Под выбранный фильтр пока нет событий.</div>`;
  }
  const ordered = entries.slice().reverse();
  return ordered.map((entry, index) => {
    const tone = getMasterRoomCombatLogTone(entry);
    const bucket = getMasterRoomCombatLogFilterBucket(entry);
    const outcome = getMasterRoomCombatOutcomeLabel(entry);
    const headline = getMasterRoomCombatLogHeadline(entry);
    const verb = getMasterRoomCombatLogVerb(entry);
    const label = String(entry?.event_type || entry?.type || "note").trim();
    const previousEntry = ordered[index - 1] || null;
    const roundChanged = !previousEntry || Number(previousEntry?.round || 0) !== Number(entry?.round || 0);
    const isTurnMarker = String(entry?.event_type || entry?.type || "").trim().toLowerCase() === "turn";
    const isRoundMarker = String(entry?.event_type || entry?.type || "").trim().toLowerCase() === "round";
    return `
      ${roundChanged ? `<div class="master-room-combat-log-divider"><span>Раунд ${escapeHtml(String(entry.round || 1))}</span></div>` : ""}
      ${isTurnMarker ? `<div class="master-room-combat-log-turn-divider"><span>Ход: ${escapeHtml(entry.actor_name || "Участник")}</span></div>` : ""}
      ${isRoundMarker ? "" : ""}
      <div class="master-room-combat-log-entry master-room-combat-log-entry-${escapeHtml(tone)} ${bucket === "system" ? "master-room-combat-log-entry-systemline" : ""}">
        <div class="master-room-combat-log-avatar">
          ${getMasterRoomCombatLogAvatarMarkup(entry, combat)}
        </div>
        <div class="master-room-combat-log-action-icon master-room-combat-log-action-icon-${escapeHtml(tone)}">
          ${escapeHtml(getMasterRoomCombatEventIcon(entry))}
        </div>
        <div class="master-room-combat-log-main">
          <div class="master-room-combat-log-rail">
            <div class="master-room-combat-log-actor">
              <strong>${escapeHtml(entry.actor_name || "Система")}</strong>
              <small>${escapeHtml(verb)}</small>
            </div>
            <div class="master-room-combat-log-arrow">→</div>
            <div class="master-room-combat-log-target-portrait">
              ${getMasterRoomCombatLogTargetMarkup(entry, combat)}
            </div>
            <div class="master-room-combat-log-target">
              ${entry.target_name ? `<strong>${escapeHtml(entry.target_name)}</strong>` : `<strong>Сцена</strong>`}
              <small>${escapeHtml(label)}</small>
            </div>
            ${outcome ? `<div class="master-room-combat-log-outcome master-room-combat-log-outcome-${escapeHtml(getMasterRoomCombatOutcomeClass(entry))}">${escapeHtml(outcome)}</div>` : ""}
            <div class="master-room-combat-log-meta">
              ${entry.dice ? `<span class="master-room-combat-log-dice">${escapeHtml(entry.dice.toUpperCase())}${entry.roll_total ? ` • ${escapeHtml(String(entry.roll_total))}` : ""}</span>` : ""}
              <span class="master-room-combat-log-time">R${escapeHtml(String(entry.round || 1))} • ${escapeHtml(formatDateTime(entry.created_at))}</span>
            </div>
          </div>
          <div class="master-room-combat-log-text">${escapeHtml(headline)}</div>
          <div class="master-room-combat-log-tags">
            <span class="meta-item">${escapeHtml(label)}</span>
            ${entry.reason ? `<span class="meta-item">${escapeHtml(entry.reason)}</span>` : ""}
            ${entry.damage ? `<span class="meta-item">${escapeHtml(String(entry.damage))}${entry.damage_type ? ` ${escapeHtml(entry.damage_type)}` : ""}</span>` : ""}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function renderMasterRoomDiceLogPanel(combat) {
  const entries = safeArray(combat?.log).filter((entry) => ["roll", "save", "attack"].includes(String(entry?.event_type || entry?.type || "").trim().toLowerCase()));
  if (!entries.length) {
    return `<div class="muted">Dice log пока пуст.</div>`;
  }
  return entries.slice().reverse().slice(0, 6).map((entry) => `
    <div class="master-room-dice-log-entry">
      <div class="master-room-dice-log-head">
        <strong>${escapeHtml(entry.actor_name || "Система")}</strong>
        <span class="master-room-combat-log-time">${escapeHtml(formatDateTime(entry.created_at))}</span>
      </div>
      <div class="master-room-dice-result-line">
        <span class="meta-item">${escapeHtml((entry.dice || entry.event_type || "roll").toUpperCase())}</span>
        <strong>${escapeHtml(String(entry.roll_total || 0))}</strong>
        <span class="muted">${escapeHtml(entry.modifier >= 0 ? `+${entry.modifier}` : String(entry.modifier || 0))}</span>
      </div>
      <div class="muted master-room-command-copy master-room-focus-copy">${escapeHtml(entry.text || entry.reason || "Бросок")}</div>
    </div>
  `).join("");
}

function renderMasterRoomLastRollDice(lastRoll) {
  const total = safeNumber(lastRoll?.roll_total || lastRoll?.result, 0);
  const dice = String(lastRoll?.dice || lastRoll?.event_type || "d20").trim();
  const values = total
    ? [Math.max(1, Math.floor(total / 2)), Math.max(1, total - Math.floor(total / 2))]
    : [0, 0, 0];
  return `
    <div class="master-room-last-roll-dice-row">
      <span class="master-room-last-roll-dice-label">${escapeHtml(dice)}</span>
      ${values.slice(0, 3).map((value) => `<span class="master-room-last-roll-poly">${escapeHtml(String(value || "—"))}</span>`).join("")}
      <span class="master-room-last-roll-equals">=</span>
    </div>
  `;
}

function getMasterRoomCombatantHealthClass(entry) {
  const max = Math.max(1, safeNumber(entry?.hp_max, 1));
  const current = Math.max(0, safeNumber(entry?.hp_current, 0));
  const ratio = current / max;
  if (ratio <= 0.25) return "danger";
  if (ratio <= 0.55) return "warn";
  return "ok";
}

function renderMasterRoomCombatantSummary(entry, table, currentTurn, canManage) {
  const isCurrentTurn = currentTurn && String(currentTurn.entry_id || "") === String(entry.entry_id || "");
  const linkedMember = entry.entry_type === "enemy" ? null : getMasterRoomMemberById(table, entry.membership_id);
  const resolvedName = entry.entry_type === "enemy"
    ? { value: entry.name, source: "enemy" }
    : resolveMasterRoomCharacterName(linkedMember, entry.name);
  const healthClass = getMasterRoomCombatantHealthClass(entry);
  const hpLabel = canManage || entry.entry_type !== "enemy"
    ? `${entry.hp_current}/${entry.hp_max}`
    : "hidden";

  return `
    <div class="master-room-combatant-row ${entry.entry_type === "enemy" ? "master-room-combatant-row-enemy" : ""} ${isCurrentTurn ? "master-room-combatant-row-active" : ""}">
      <div class="master-room-combatant-portrait">
        ${getMasterRoomCombatEntryPortraitMarkup(entry, resolvedName.value)}
      </div>
      <div class="master-room-combatant-row-main">
        <div class="master-room-combatant-row-title">${escapeHtml(resolvedName.value || entry.name || "Участник")}</div>
        <div class="master-room-combatant-row-subtitle">
          ${entry.entry_type === "enemy" ? escapeHtml(entry.source || "enemy") : escapeHtml(linkedMember?.nickname || "party")}
          ${isCurrentTurn ? " • ходит" : ""}
        </div>
      </div>
      <div class="master-room-combatant-row-stats">
        <span class="master-room-combatant-hp master-room-combatant-hp-${healthClass}">HP ${escapeHtml(String(hpLabel))}</span>
        <span>AC ${canManage || entry.entry_type !== "enemy" ? escapeHtml(String(entry.ac)) : "?"}</span>
        <span>Init ${escapeHtml(String(entry.initiative))}</span>
      </div>
    </div>
  `;
}

function renderMasterRoomBattlePanel(table) {
  const combat = normalizeMasterRoomCombat(table?.combat);
  const canManage = canManageMasterRoomTable(table);
  const currentTurn = combat.entries[combat.turn_index] || null;
  const currentUserId = getCurrentUserId();
  const lss = getCurrentLssCharacterSnapshot();
  const members = combat.entries.filter((entry) => entry.entry_type !== "enemy");
  const enemies = combat.entries.filter((entry) => entry.entry_type === "enemy");
  const currentMembership = getMasterRoomCurrentMembership(table);
  const nextTurn = combat.entries[(combat.turn_index + 1) % Math.max(combat.entries.length, 1)] || null;
  const visibleLogCount = safeArray(combat.log).filter((entry) => isMasterRoomCombatLogEntryVisible(
    entry,
    MASTER_ROOM_STATE.combatLogFilter,
    MASTER_ROOM_STATE.combatHideSecondary
  )).length;
  const lastRoll = MASTER_ROOM_STATE.combatLastRoll || safeArray(combat.log).slice().reverse().find((entry) => ["roll", "attack", "save"].includes(String(entry?.event_type || entry?.type || "").trim().toLowerCase())) || null;

  return `
    <div class="cabinet-block master-room-stage-panel master-room-battle-stage master-room-battle-shell master-room-battle-shell-game">
      <div class="flex-between master-room-section-head master-room-combat-hud">
        <div>
          <div class="muted master-room-section-kicker">Бой</div>
          <h4 class="master-room-section-title">Тактический режим стола</h4>
          <div class="muted master-room-command-copy">Главный слой: текущий ход, инициатива, лента событий и доступные действия.</div>
        </div>
        <div class="trader-meta cabinet-header-meta">
          <span class="meta-item">${combat.active ? "Бой активен" : "Подготовка"}</span>
          <span class="meta-item">Раунд ${escapeHtml(String(combat.round))}</span>
          <span class="meta-item">Ход: ${escapeHtml(currentTurn?.name || "—")}</span>
          <span class="meta-item">Дальше: ${escapeHtml(nextTurn?.name || "—")}</span>
          <button class="btn btn-secondary master-room-compact-btn" type="button" id="masterRoomCombatLogToggleBtn">
            ${MASTER_ROOM_STATE.combatLogOpen ? "Скрыть лог" : "Показать лог"}
          </button>
        </div>
      </div>

      <div class="master-room-battle-gap">
        ${renderMasterRoomInitiativeTrack(combat)}
      </div>

      <div class="profile-grid master-room-battle-grid master-room-battle-grid-shell">
        <div class="cabinet-block master-room-journal-shell master-room-battle-card">
          <div class="flex-between master-room-section-head">
            <div>
              <div class="muted master-room-section-kicker">Combat log</div>
              <h5 class="master-room-section-title">Лента событий боя</h5>
              <div class="muted master-room-command-copy">Текущие действия, броски, эффекты и смена фаз собираются в одну боевую ленту.</div>
            </div>
            <div class="trader-meta cabinet-header-meta">
              <span class="meta-item">${escapeHtml(String(visibleLogCount))} событий</span>
              <button class="btn btn-secondary master-room-compact-btn" type="button" data-master-room-combat-secondary-toggle="1">
                ${MASTER_ROOM_STATE.combatHideSecondary ? "Показать системные" : "Скрыть вторичное"}
              </button>
            </div>
          </div>
          <div class="account-hub-tab-row master-room-log-filter-row master-room-log-filter-shell">
            ${[
              ["all", "Все"],
              ["combat", "Бой"],
              ["dice", "Кубы"],
              ["effect", "Эффекты"],
              ["system", "Система"],
            ].map(([value, label]) => `
              <button class="btn ${MASTER_ROOM_STATE.combatLogFilter === value ? "active" : ""}" type="button" data-master-room-combat-filter="${escapeHtml(value)}">${escapeHtml(label)}</button>
            `).join("")}
          </div>
          ${
            MASTER_ROOM_STATE.combatLogOpen
              ? `<div class="master-room-combat-log master-room-combat-log-immersive">${renderMasterRoomCombatLogPanel(combat)}</div>`
              : `<div class="master-room-journal-empty">Журнал свернут. Открой лог, чтобы видеть последовательность боя.</div>`
          }
        </div>

        <div class="master-room-tactical-stack">
          <div class="cabinet-block master-room-tactical-card master-room-battle-card">
            <div class="master-room-panel-kicker">Раунд</div>
            <div class="master-room-round-card">
              <div class="master-room-round-orb">${escapeHtml(String(combat.round))}</div>
              <div class="master-room-round-infinity">/ ∞</div>
              <button class="btn master-room-round-next-btn" type="button" id="masterRoomCombatNextTurnQuickBtn" ${combat.entries.length ? "" : "disabled"}>↻ Следующий раунд</button>
            </div>
            <div class="master-room-round-meta">
              <span>Ходит: <strong>${escapeHtml(currentTurn?.name || "—")}</strong></span>
              <span>Союзники: <strong>${escapeHtml(String(members.length))}</strong></span>
              <span>Противники: <strong>${escapeHtml(String(enemies.length))}</strong></span>
            </div>
          </div>

          <div class="cabinet-block master-room-tactical-card master-room-battle-card">
            <div class="master-room-panel-kicker">Окружение</div>
            <div class="master-room-environment-list">
              <div class="master-room-environment-item">Локация: <strong>${escapeHtml(table?.title || "Сцена стола")}</strong></div>
              <div class="master-room-environment-item">Свет: <strong>${combat.active ? "Активная сцена" : "Подготовка к бою"}</strong></div>
              <div class="master-room-environment-item">Следом: <strong>${escapeHtml(nextTurn?.name || "ожидает выбора")}</strong></div>
              <div class="master-room-environment-item">Фаза: <strong>${escapeHtml(combat.active ? "боевой режим" : "лобби/сборка")}</strong></div>
            </div>
          </div>

          <div class="cabinet-block master-room-tactical-card master-room-battle-card">
            <div class="master-room-panel-kicker">Быстрые действия ${canManage ? "(GM)" : ""}</div>
            <div class="master-room-quick-actions-grid">
              <button class="btn btn-secondary" type="button" data-master-room-combat-quick-event="damage">⚔ Урон</button>
              <button class="btn btn-secondary" type="button" data-master-room-combat-quick-event="heal">✚ Исцеление</button>
              <button class="btn btn-secondary" type="button" data-master-room-combat-quick-event="effect">✦ Состояние</button>
              <button class="btn btn-secondary" type="button" data-master-room-combat-quick-event="save">🛡 Спасбросок</button>
              <button class="btn btn-secondary" type="button" data-master-room-combat-quick-event="roll">◇ Заметка</button>
              <button class="btn btn-secondary" type="button" data-master-room-combat-secondary-toggle="1">☰ Системные</button>
            </div>
          </div>

          <div class="cabinet-block master-room-tactical-card master-room-battle-card">
            <div class="flex-between master-room-dice-log-head master-room-dice-log-head-gap">
              <div>
                <div class="master-room-panel-kicker">Состав сцены</div>
                <div class="muted master-room-command-copy">${escapeHtml(String(combat.entries.length))} боевых позиций</div>
              </div>
            </div>
            <div class="master-room-combatants-compact-list">
              ${combat.entries.length
                ? combat.entries.map((entry) => renderMasterRoomCombatantSummary(entry, table, currentTurn, canManage)).join("")
                : `<div class="muted master-room-command-copy">Боевые позиции появятся после сборки боя.</div>`}
            </div>
          </div>

          <div class="cabinet-block master-room-tactical-card master-room-battle-card">
            <div class="flex-between master-room-dice-log-head master-room-dice-log-head-gap">
              <div>
                <div class="master-room-panel-kicker">Последний бросок</div>
                <div class="muted master-room-command-copy">Последняя механическая развязка сцены</div>
              </div>
            </div>
            <div class="master-room-last-roll-card">
              ${renderMasterRoomLastRollDice(lastRoll)}
              <div class="master-room-last-roll-total">${escapeHtml(String(lastRoll?.roll_total || lastRoll?.result || "—"))}</div>
              <div class="master-room-last-roll-note">${escapeHtml(lastRoll?.text || lastRoll?.reason || "Бросков пока нет")}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="master-room-battle-lower-grid">
        <details class="cabinet-block master-room-roster-shell master-room-battle-card master-room-roster-workspace master-room-combat-controls-panel master-room-combat-drawer">
          <summary class="master-room-combat-drawer-summary">
            <div>
              <div class="muted master-room-section-kicker">${canManage ? "Roster / GM controls" : "Roster"}</div>
              <h5 class="master-room-section-title">Боевые позиции</h5>
              <div class="muted master-room-command-copy">Состав сцены, текущий ход и видимые статы остаются частью виртуального стола.</div>
            </div>
            <div class="trader-meta cabinet-header-meta">
              <span class="meta-item">${escapeHtml(String(combat.entries.length))} в сцене</span>
              <span class="meta-item">Ход: ${escapeHtml(currentTurn?.name || "—")}</span>
              <span class="meta-item">Открыть</span>
            </div>
          </summary>

          ${
            canManage
              ? `
                <div class="cabinet-block master-room-phase-controls">
                  <div class="flex-between master-room-section-head">
                    <div>
                      <div class="muted master-room-section-kicker">Combat phase</div>
                      <h5 class="master-room-section-title">Фаза боя</h5>
                    </div>
                    <button class="btn btn-primary" type="button" id="masterRoomCombatBootstrapBtn">Собрать бой из стола</button>
                  </div>
                  <div class="profile-grid master-room-combat-toolbar master-room-form-grid-compact">
                    <div class="filter-group">
                      <label>Раунд</label>
                      <input id="masterRoomCombatRound" type="number" min="1" step="1" value="${escapeHtml(String(combat.round || 1))}">
                    </div>
                    <div class="filter-group">
                      <label>Текущий ход</label>
                      <select id="masterRoomCombatTurnIndex">
                        ${combat.entries.length
                          ? combat.entries.map((entry, index) => `
                              <option value="${escapeHtml(String(index))}" ${index === combat.turn_index ? "selected" : ""}>
                                ${escapeHtml(entry.name)}${entry.initiative ? ` • init ${escapeHtml(String(entry.initiative))}` : ""}
                              </option>
                            `).join("")
                          : `<option value="0">Нет боевых позиций</option>`}
                      </select>
                    </div>
                    <div class="filter-group">
                      <label>Статус</label>
                      <select id="masterRoomCombatActiveState">
                        <option value="inactive" ${combat.active ? "" : "selected"}>Подготовка</option>
                        <option value="active" ${combat.active ? "selected" : ""}>Активный бой</option>
                      </select>
                    </div>
                  </div>
                  <div class="cart-buttons master-room-action-row master-room-wrap-actions">
                    <button class="btn" type="button" id="masterRoomCombatSaveStateBtn">Сохранить фазу боя</button>
                    <button class="btn" type="button" id="masterRoomCombatNextTurnBtn" ${combat.entries.length ? "" : "disabled"}>Следующий ход</button>
                  </div>
                </div>
              `
              : `<div class="master-room-roster-player-note">Ты видишь боевые позиции в рамках раскрытого слоя стола. GM-only параметры противников остаются скрытыми.</div>`
          }

          <div class="master-room-battle-columns master-room-roster-columns">
            <div class="master-room-roster-column">
              <div class="muted master-room-column-kicker">Партия</div>
              ${members.length ? members.map((entry) => {
                const isCurrentTurn = currentTurn && String(currentTurn.entry_id || "") === String(entry.entry_id || "");
                const linkedMember = getMasterRoomMemberById(table, entry.membership_id);
                const canUseLss = String(linkedMember?.user_id || "") === currentUserId && lss.name;
                const resolvedName = resolveMasterRoomCharacterName(linkedMember, entry.name);
                return `
                  <div class="cabinet-block master-room-combatant-card ${isCurrentTurn ? "master-room-combatant-card-active" : ""} master-room-combatant-shell">
                    <div class="flex-between master-room-section-head">
                      <div>
                        <div class="master-room-combatant-title">${escapeHtml(resolvedName.value || entry.name || linkedMember?.nickname || "Участник")}</div>
                        <div class="muted master-room-combatant-copy">
                          ${escapeHtml(linkedMember?.nickname || "участник")} • ${escapeHtml(entry.role_in_table === "gm" ? "ГМ" : "Игрок")}
                          ${isCurrentTurn ? " • сейчас ход" : ""}
                        </div>
                      </div>
                      <div class="trader-meta cabinet-header-meta">
                        <span class="meta-item">HP ${escapeHtml(String(entry.hp_current))}/${escapeHtml(String(entry.hp_max))}</span>
                        <span class="meta-item">AC ${escapeHtml(String(entry.ac))}</span>
                        <span class="meta-item">Init ${escapeHtml(String(entry.initiative))}</span>
                        <span class="meta-item">${escapeHtml(masterRoomVisibilityLabel(linkedMember?.visibility_preset))}</span>
                      </div>
                    </div>
                    ${
                      canManage
                        ? `
                          <div class="profile-grid master-room-stats-grid">
                            <div class="filter-group">
                              <label>Имя</label>
                              <input id="masterRoomCombatName-${escapeHtml(entry.entry_id)}" type="text" value="${escapeHtml(entry.name)}">
                            </div>
                            <div class="filter-group">
                              <label>HP сейчас</label>
                              <input id="masterRoomCombatHpCurrent-${escapeHtml(entry.entry_id)}" type="number" min="0" step="1" value="${escapeHtml(String(entry.hp_current))}">
                            </div>
                            <div class="filter-group">
                              <label>HP макс</label>
                              <input id="masterRoomCombatHpMax-${escapeHtml(entry.entry_id)}" type="number" min="0" step="1" value="${escapeHtml(String(entry.hp_max))}">
                            </div>
                            <div class="filter-group">
                              <label>AC</label>
                              <input id="masterRoomCombatAc-${escapeHtml(entry.entry_id)}" type="number" min="0" step="1" value="${escapeHtml(String(entry.ac))}">
                            </div>
                            <div class="filter-group">
                              <label>Init</label>
                              <input id="masterRoomCombatInit-${escapeHtml(entry.entry_id)}" type="number" step="1" value="${escapeHtml(String(entry.initiative))}">
                            </div>
                            <div class="filter-group">
                              <label>Статус</label>
                              <input id="masterRoomCombatStatus-${escapeHtml(entry.entry_id)}" type="text" value="${escapeHtml(entry.status || "")}" placeholder="ready / down / hidden">
                            </div>
                          </div>
                          <div class="cart-buttons master-room-action-row master-room-wrap-actions">
                            <button class="btn btn-primary" type="button" data-master-room-combat-save="${escapeHtml(entry.entry_id)}">Сохранить</button>
                            <input id="masterRoomCombatDelta-${escapeHtml(entry.entry_id)}" class="master-room-delta-input" type="number" min="1" step="1" value="1">
                            <button class="btn btn-danger" type="button" data-master-room-combat-damage="${escapeHtml(entry.entry_id)}">Урон</button>
                            <button class="btn" type="button" data-master-room-combat-heal="${escapeHtml(entry.entry_id)}">Лечение</button>
                            ${canUseLss ? `<button class="btn" type="button" data-master-room-combat-use-lss="${escapeHtml(entry.entry_id)}">Взять статы из LSS</button>` : ""}
                          </div>
                        `
                        : `<div class="muted master-room-command-copy">${escapeHtml(`Персонаж за столом: ${resolvedName.source === "manual" ? "ручное имя стола" : "linked имя персонажа"} • статус ${entry.status || "ready"}`)}</div>`
                    }
                  </div>
                `;
              }).join("") : `<div class="muted">Партия ещё не собрана в бою.</div>`}
            </div>

            <div class="master-room-roster-column">
              <div class="muted master-room-column-kicker">Противники</div>
              ${enemies.length ? enemies.map((entry) => {
                const isCurrentTurn = currentTurn && String(currentTurn.entry_id || "") === String(entry.entry_id || "");
                return `
                  <div class="cabinet-block master-room-combatant-card master-room-combatant-card-enemy ${isCurrentTurn ? "master-room-combatant-card-active" : ""} master-room-combatant-shell">
                    <div class="flex-between master-room-section-head">
                      <div>
                        <div class="master-room-combatant-title">${escapeHtml(entry.name)}</div>
                        <div class="muted master-room-combatant-copy">${escapeHtml(entry.source || "enemy")} ${entry.enemy_ref ? `• ${escapeHtml(entry.enemy_ref)}` : ""}${isCurrentTurn ? " • сейчас ход" : ""}</div>
                      </div>
                      <div class="trader-meta cabinet-header-meta">
                        <span class="meta-item">${canManage ? `HP ${escapeHtml(String(entry.hp_current))}/${escapeHtml(String(entry.hp_max))}` : "HP hidden"}</span>
                        <span class="meta-item">${canManage ? `AC ${escapeHtml(String(entry.ac))}` : "AC hidden"}</span>
                        <span class="meta-item">Init ${escapeHtml(String(entry.initiative))}</span>
                      </div>
                    </div>
                    ${
                      canManage
                        ? `
                          <div class="profile-grid master-room-stats-grid">
                            <div class="filter-group">
                              <label>Имя</label>
                              <input id="masterRoomCombatName-${escapeHtml(entry.entry_id)}" type="text" value="${escapeHtml(entry.name)}">
                            </div>
                            <div class="filter-group">
                              <label>HP сейчас</label>
                              <input id="masterRoomCombatHpCurrent-${escapeHtml(entry.entry_id)}" type="number" min="0" step="1" value="${escapeHtml(String(entry.hp_current))}">
                            </div>
                            <div class="filter-group">
                              <label>HP макс</label>
                              <input id="masterRoomCombatHpMax-${escapeHtml(entry.entry_id)}" type="number" min="0" step="1" value="${escapeHtml(String(entry.hp_max))}">
                            </div>
                            <div class="filter-group">
                              <label>AC</label>
                              <input id="masterRoomCombatAc-${escapeHtml(entry.entry_id)}" type="number" min="0" step="1" value="${escapeHtml(String(entry.ac))}">
                            </div>
                            <div class="filter-group">
                              <label>Init</label>
                              <input id="masterRoomCombatInit-${escapeHtml(entry.entry_id)}" type="number" step="1" value="${escapeHtml(String(entry.initiative))}">
                            </div>
                            <div class="filter-group">
                              <label>Статус</label>
                              <input id="masterRoomCombatStatus-${escapeHtml(entry.entry_id)}" type="text" value="${escapeHtml(entry.status || "")}" placeholder="hostile / down / hidden">
                            </div>
                          </div>
                          <div class="cart-buttons master-room-action-row master-room-wrap-actions">
                            <button class="btn btn-primary" type="button" data-master-room-combat-save="${escapeHtml(entry.entry_id)}">Сохранить</button>
                            <input id="masterRoomCombatDelta-${escapeHtml(entry.entry_id)}" class="master-room-delta-input" type="number" min="1" step="1" value="1">
                            <button class="btn btn-danger" type="button" data-master-room-combat-damage="${escapeHtml(entry.entry_id)}">Урон</button>
                            <button class="btn" type="button" data-master-room-combat-heal="${escapeHtml(entry.entry_id)}">Лечение</button>
                            <button class="btn btn-danger" type="button" data-master-room-combat-remove="${escapeHtml(entry.entry_id)}">Убрать</button>
                          </div>
                        `
                        : `<div class="muted master-room-command-copy">Игрок видит тип события, очередь хода и логику боя, но без точных GM-only статов врага.</div>`
                    }
                    ${entry.attacks?.length ? `<div class="trader-meta master-room-party-meta">${entry.attacks.slice(0, 3).map((attack, attackIndex) => `<button class="btn" type="button" data-master-room-combat-attack="${escapeHtml(entry.entry_id)}" data-master-room-combat-attack-name="${escapeHtml(attack.name || `Атака ${attackIndex + 1}`)}">${escapeHtml(attack.name || `Атака ${attackIndex + 1}`)}</button>`).join("")}</div>` : ""}
                    ${
                      entry.spells?.length
                        ? `<div class="trader-meta master-room-party-meta">${entry.spells.slice(0, 3).map((spell, spellIndex) => `<button class="btn btn-secondary" type="button" data-master-room-combat-attack="${escapeHtml(entry.entry_id)}" data-master-room-combat-attack-name="${escapeHtml(spell.name || `Заклинание ${spellIndex + 1}`)}">${escapeHtml(spell.name || `Заклинание ${spellIndex + 1}`)}</button>`).join("")}</div>`
                        : ""
                    }
                  </div>
                `;
              }).join("") : `<div class="muted">Противники ещё не добавлены.</div>`}
            </div>
          </div>
        </details>

        <section class="cabinet-block master-room-action-console master-room-action-console-panel master-room-action-console-workspace">
          <div class="flex-between master-room-section-head master-room-section-head-tight">
            <div>
              <div class="muted master-room-section-kicker">Action console</div>
              <h5 class="master-room-action-console-title">Dice / действие / заклинание</h5>
            </div>
            <span class="meta-item">${escapeHtml(MASTER_ROOM_STATE.combatEventType || "roll")}</span>
          </div>
          <div class="profile-grid master-room-action-console-grid">
            <div class="filter-group">
              <label>Кто бросает</label>
              <select id="masterRoomCombatRollActor">
                <option value="">Система / вручную</option>
                ${combat.entries
                  .filter((entry) => canManage || String(entry.membership_id || "") === String(currentMembership?.id || ""))
                  .map((entry) => `
                  <option value="${escapeHtml(entry.entry_id)}">${escapeHtml(entry.name)}</option>
                `).join("")}
              </select>
            </div>
            <div class="filter-group">
              <label>Тип события</label>
              <select id="masterRoomCombatEventType">
                ${["roll", "attack", "damage", "heal", "save", "effect"].map((type) => `
                  <option value="${escapeHtml(type)}" ${MASTER_ROOM_STATE.combatEventType === type ? "selected" : ""}>${escapeHtml(type)}</option>
                `).join("")}
              </select>
            </div>
            <div class="filter-group">
              <label>Куб</label>
              <input id="masterRoomCombatRollDice" type="text" value="d20" placeholder="d20 / 2d6">
            </div>
            <div class="filter-group">
              <label>Модификатор</label>
              <input id="masterRoomCombatRollModifier" type="number" step="1" value="0">
            </div>
            <div class="filter-group">
              <label>Цель</label>
              <select id="masterRoomCombatTarget">
                <option value="">Без цели</option>
                ${combat.entries.map((entry) => `<option value="${escapeHtml(entry.entry_id)}">${escapeHtml(entry.name)}</option>`).join("")}
              </select>
            </div>
            <div class="filter-group">
              <label>Эффект / урон</label>
              <input id="masterRoomCombatDamage" type="number" min="0" step="1" value="0">
            </div>
            <div class="filter-group master-room-action-console-reason">
              <label>Причина / заклинание</label>
              <input id="masterRoomCombatRollReason" type="text" placeholder="Fire Bolt, атака, спасбросок, урон от ловушки...">
            </div>
          </div>
          <div class="cart-buttons master-room-action-row">
            <button class="btn btn-primary" type="button" id="masterRoomCombatRollBtn">Бросить</button>
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderMasterRoom() {
  const container = getEl("cabinet-masterroom");
  if (!container) return;

  ensureMasterRoomDefaults();

  const active = getMasterRoomActiveTable();
  const canManageActive = canManageMasterRoomTable(active);
  const createOpen = Boolean(MASTER_ROOM_STATE.createOpen);
  const globalGmMode = hasGlobalGmMode();
  const activeMembers = safeArray(active?.members);
  const activeGm = activeMembers.find((member) => member.role_in_table === "gm") || activeMembers[0] || null;
  const activeGmName = resolveMasterRoomCharacterName(activeGm, activeGm?.display_name || activeGm?.nickname || "GM");
  const activeGmPortrait = getMasterRoomMemberPortrait(activeGm);
  const heroOwnerName = active ? activeGmName.value : (globalGmMode ? "GM layer" : "Player layer");
  const heroOwnerInitial = (heroOwnerName || "T").slice(0, 1).toUpperCase();
  const activeCombat = active?.combat && typeof active.combat === "object" ? active.combat : null;
  const battleFocus = Boolean(activeCombat?.active && safeArray(activeCombat.entries).length);
  if (!battleFocus) {
    MASTER_ROOM_STATE.stageMode = normalizeMasterRoomStageMode(MASTER_ROOM_STATE.stageMode, canManageActive);
  }
  document.body?.classList.toggle("cabinet-masterroom-battle-focus", battleFocus);

  const tablesHtml = MASTER_ROOM_STATE.tables.length
    ? MASTER_ROOM_STATE.tables.map((table) => `
      <div class="cabinet-block master-room-table-card ${table.id === MASTER_ROOM_STATE.activeTableId ? "master-room-table-card-active" : ""}">
        <div class="master-room-table-card-head">
          <div class="master-room-table-card-copy">
            <div class="master-room-table-card-title">${escapeHtml(table.title)}</div>
            <div class="muted master-room-table-card-meta">token: ${escapeHtml(table.token)} • участников: ${safeArray(table.members).length}</div>
          </div>
          <div class="cart-buttons master-room-table-card-actions">
            <button class="btn ${table.id === MASTER_ROOM_STATE.activeTableId ? "active" : ""}" type="button" data-master-room-open="${escapeHtml(table.id)}">Открыть</button>
            ${canManageMasterRoomTable(table) ? `<button class="btn btn-danger" type="button" data-master-room-delete="${escapeHtml(table.id)}">Удалить</button>` : ""}
          </div>
        </div>
      </div>
    `).join("")
    : `<div class="cabinet-block"><p>Столов пока нет. Создай первый стол.</p></div>`;

  container.innerHTML = `
    <div class="master-room-mode-shell ${battleFocus ? "master-room-mode-shell-battle" : ""} ${MASTER_ROOM_STATE.railCollapsed ? "master-room-rail-collapsed" : ""}" data-cabinet-anchor="top">
      <div class="master-room-shell">
        <aside class="master-room-sidebar" data-cabinet-anchor="rail">
          ${MASTER_ROOM_STATE.railCollapsed ? renderMasterRoomCollapsedRail(active, canManageActive) : `
          <div class="cabinet-block master-room-sidebar-panel master-room-rail-panel">
            <div class="master-room-sidebar-topline">VIRTUAL TABLE</div>
            <div class="flex-between master-room-section-head master-room-section-head-tight">
              <div>
                <div class="muted master-room-section-kicker">Table rail</div>
                <h4 class="master-room-section-title">Столы и сцены</h4>
              </div>
              <span class="meta-item">${MASTER_ROOM_STATE.tables.length}</span>
            </div>
            <div class="master-room-sidebar-copy">
              Выбери виртуальный стол: здесь живут партия, сцена, бой и слой информации, который мастер раскрывает игрокам.
            </div>
            <div class="cart-buttons master-room-sidebar-actions">
              <button class="btn" type="button" id="masterRoomToggleCreateBtn">${createOpen ? "Скрыть создание" : "Создать стол"}</button>
              <button class="btn" type="button" id="masterRoomReloadBtn">Обновить</button>
            </div>
            ${renderMasterRoomSidebarPreview(active)}
            <div class="master-room-table-rail">
              ${tablesHtml}
            </div>
          </div>
          <div class="cabinet-block master-room-sidebar-panel master-room-sidebar-status">
            <div class="master-room-panel-kicker">Session state</div>
            <div class="master-room-sidebar-status-title">${escapeHtml(active?.status || (canManageActive ? "gm_control" : "lobby"))}</div>
            <div class="master-room-sidebar-status-copy">
              ${active
                ? `Активная карта: ${escapeHtml(active.title)}`
                : "Сейчас нет активного стола. Создай комнату или открой существующую."}
            </div>
            <div class="cabinet-block master-room-mode-note master-room-mode-state-${canManageActive || globalGmMode ? "control" : "lobby"}">
              ${
                canManageActive
                  ? `<strong>GM-слой активен.</strong> Ты видишь весь стол и решаешь, какие разделы раскрыты игрокам.`
                  : `Открыт player-слой. Видны только раскрытые мастером разделы стола, партии и боя.`
              }
            </div>
            <div class="master-room-sidebar-players">
              <div class="master-room-sidebar-players-head">
                <span>Подключённые игроки</span>
                <strong>${escapeHtml(String(activeMembers.length))}</strong>
              </div>
              <div class="master-room-sidebar-player-list">
                ${renderMasterRoomSidebarPlayers(active)}
              </div>
            </div>
          </div>
          `}
        </aside>

        <div class="master-room-stage">
          ${renderMasterRoomUtilityBar(active, canManageActive, battleFocus, globalGmMode)}

          ${MASTER_ROOM_STATE.heroCollapsed || battleFocus ? "" : `
          <div class="cabinet-block master-room-hero" data-cabinet-anchor="status">
            <div class="master-room-hero-backdrop">
              <div class="master-room-hero-topline">MASTER ROOM / ВИРТУАЛЬНЫЙ СТОЛ</div>
              <div class="master-room-hero-layout">
                <div class="master-room-hero-identity">
                  <div class="master-room-hero-portrait">
                    ${
                      activeGmPortrait
                        ? `<img src="${escapeHtml(activeGmPortrait)}" alt="${escapeHtml(heroOwnerName)}" class="master-room-hero-portrait-img">`
                        : `<span class="master-room-hero-portrait-fallback">${escapeHtml(heroOwnerInitial)}</span>`
                    }
                  </div>
                  <div class="master-room-hero-copy">
                    <h3 class="master-room-hero-title">${escapeHtml(active?.title || "Master Room")}</h3>
                    <div class="master-room-hero-subtitle">
                      Сеанс: ${escapeHtml(formatDateTime(active?.updated_at || active?.created_at || new Date().toISOString()))}
                      ${active?.token ? ` • ID стола: ${escapeHtml(active.token)}` : ""}
                    </div>
                    <div class="master-room-hero-owner-row">
                      <span class="master-room-hero-owner-chip">${escapeHtml(heroOwnerName)}</span>
                      <span class="master-room-hero-owner-badge">${canManageActive || globalGmMode ? "GM" : "Участник"}</span>
                      <span class="muted master-room-hero-owner-note">${canManageActive ? "Полный слой стола" : "Открытый слой игрока"}</span>
                    </div>
                  </div>
                </div>
                <div class="master-room-hero-status master-room-hero-status-panel">
                  ${active ? renderMasterRoomHeroSummary(active) : ""}
                  <div class="master-room-hero-roster">
                    ${active ? renderMasterRoomHeroRoster(active) : `<div class="master-room-hero-roster-empty">Нет активного стола.</div>`}
                  </div>
                  ${renderMasterRoomHeroQuickActions(canManageActive)}
                </div>
              </div>
            </div>
          </div>
          `}

          ${createOpen ? `
            <div class="cabinet-block master-room-create-panel" data-cabinet-anchor="create">
              <div class="profile-grid master-room-form-grid">
                <div class="filter-group">
                  <label>Название стола</label>
                  <input id="masterRoomCreateTitle" type="text" placeholder="Например: Подземелье Арканума">
                </div>
                <div class="filter-group">
                  <label>Token / код</label>
                  <input id="masterRoomCreateToken" type="text" placeholder="arcanum-party">
                </div>
              </div>
              <div class="cart-buttons master-room-action-row">
                <button class="btn btn-primary" type="button" id="masterRoomCreateBtn">Создать стол</button>
              </div>
            </div>
          ` : ""}

          ${active ? `
          ${
            battleFocus
              ? `
                ${renderMasterRoomCombatStage(active, canManageActive, globalGmMode)}
                <details class="cabinet-block master-room-battle-context-drawer">
                  <summary class="master-room-combat-drawer-summary">
                    <div>
                      <div class="muted master-room-section-kicker">Table context</div>
                      <h5 class="master-room-section-title">Сцена, видимость и журнал стола</h5>
                      <div class="muted master-room-command-copy">Дополнительный слой боя. Открывается только когда нужен контекст виртуального стола.</div>
                    </div>
                    <span class="meta-item">Открыть</span>
                  </summary>
                  <div class="master-room-battle-context" data-master-room-context="table">
                    ${renderMasterRoomLiveOverview(active, canManageActive, { compact: true })}
                  </div>
                </details>
              `
              : `
                ${renderMasterRoomStageTabs(canManageActive)}
                ${renderMasterRoomNonBattleStage(active, canManageActive)}
              `
          }
          ` : renderMasterRoomEmptyTabletop(canManageActive || globalGmMode)}
          ${renderMasterRoomFloatingNav(battleFocus)}
        </div>
      </div>
    </div>
  `;

  bindMasterRoomActions();
}

async function createMasterRoomTable(title, token) {
  const payload = await apiClientPost("/gm/tables", {
    title: String(title || "").trim(),
    token: String(token || "").trim(),
  });

  applyMasterRoomTableResponse(payload);
  MASTER_ROOM_STATE.createOpen = false;
  const lssName = getCurrentLssCharacterName();
  const active = getMasterRoomActiveTable();
  const currentMembership = safeArray(active?.members).find((member) => String(member.user_id || "") === getCurrentUserId());
  if (lssName && currentMembership && String(currentMembership.selected_character_name || "").trim() !== lssName) {
    await syncCurrentMemberFromLss(currentMembership.id, { includeCombat: false });
  }
  renderMasterRoom();

  emitCabinetHistory({
    scope: "gm",
    type: "master_room_create",
    action: "master_room_create",
    title: `Создан стол: ${payload?.table?.title || title}`,
    message: `Token: ${payload?.table?.token || token}`,
  });
}

async function deleteMasterRoomTable(tableId) {
  await apiDelete(`/gm/tables/${encodeURIComponent(String(tableId || ""))}`);
  MASTER_ROOM_STATE.tables = MASTER_ROOM_STATE.tables.filter((entry) => entry.id !== String(tableId || ""));
  MASTER_ROOM_STATE.activeTableId = MASTER_ROOM_STATE.tables[0]?.id || "";
  renderMasterRoom();
}

async function addMemberToMasterRoom(payload) {
  const active = getMasterRoomActiveTable();
  if (!active) {
    showToast("Сначала выбери стол");
    return;
  }

  const body = {};
  if (payload?.user_id) body.user_id = Number(payload.user_id);
  if (payload?.nickname) body.nickname = String(payload.nickname).trim();
  if (payload?.email) body.email = String(payload.email).trim();

  const result = await apiClientPost(`/gm/tables/${active.id}/members`, body);
  applyAndRenderMasterRoom(result);
}

async function removeMemberFromMasterRoom(memberId) {
  const active = getMasterRoomActiveTable();
  if (!active) return;

  await apiDelete(`/gm/tables/${encodeURIComponent(active.id)}/members/${encodeURIComponent(String(memberId || ""))}`);
  await loadMasterRoom();
}

async function patchMasterRoomMember(memberId, patch) {
  const active = getMasterRoomActiveTable();
  if (!active) return;

  const result = await apiClientPatch(
    `/gm/tables/${active.id}/members/${encodeURIComponent(String(memberId || ""))}`,
    patch
  );
  applyAndRenderMasterRoom(result);
}

async function syncCurrentMemberFromLss(memberId, { includeCombat = true } = {}) {
  const snapshot = getCurrentLssCharacterSnapshot();
  if (!snapshot.name) {
    showToast("LSS-персонаж сейчас не загружен");
    return;
  }

  await patchMasterRoomMember(memberId, {
    selected_character_name: snapshot.name,
  });

  if (includeCombat) {
    const active = getMasterRoomActiveTable();
    const combatEntry = getMasterRoomCombatEntry(active, memberId);
    if (combatEntry) {
      await patchMasterRoomCombatant(memberId, {
        name: snapshot.name,
        hp_current: snapshot.hp_current,
        hp_max: snapshot.hp_max,
        ac: snapshot.ac,
        initiative: snapshot.initiative,
        status: combatEntry.status || "ready",
      });
    }
  }
}

async function patchMasterRoomTable(patch) {
  const active = getMasterRoomActiveTable();
  if (!active) return;

  const result = await apiClientPatch(`/gm/tables/${active.id}`, patch);
  applyAndRenderMasterRoom(result);
}

async function bootstrapMasterRoomCombat() {
  const active = getMasterRoomActiveTable();
  if (!active) return;
  const result = await apiClientPost(`/gm/tables/${active.id}/combat/bootstrap`, {});
  applyAndRenderMasterRoom(result);
}

async function patchMasterRoomCombatState(patch) {
  const active = getMasterRoomActiveTable();
  if (!active) return;
  const result = await apiClientPatch(`/gm/tables/${active.id}/combat`, patch);
  applyAndRenderMasterRoom(result);
}

async function patchMasterRoomCombatant(memberId, patch) {
  const active = getMasterRoomActiveTable();
  if (!active) return;
  const result = await apiClientPatch(
    `/gm/tables/${active.id}/combat/members/${encodeURIComponent(String(memberId || ""))}`,
    patch
  );
  applyAndRenderMasterRoom(result);
}

async function patchMasterRoomCombatEntry(entryId, patch) {
  const active = getMasterRoomActiveTable();
  if (!active) return;
  const result = await apiClientPatch(
    `/gm/tables/${active.id}/combat/entries/${encodeURIComponent(String(entryId || ""))}`,
    patch
  );
  applyAndRenderMasterRoom(result);
}

async function rollMasterRoomCombat(payload) {
  const active = getMasterRoomActiveTable();
  if (!active) return;
  const result = await apiClientPost(`/gm/tables/${active.id}/combat/roll`, payload);
  MASTER_ROOM_STATE.combatLastRoll = result?.roll || null;
  applyAndRenderMasterRoom(result);
}

async function addEnemyToMasterRoomCombat(payload) {
  const active = getMasterRoomActiveTable();
  if (!active) return;
  const result = await apiClientPost(`/gm/tables/${active.id}/combat/enemies`, payload);
  applyAndRenderMasterRoom(result);
}

async function removeMasterRoomCombatEntry(entryId) {
  const active = getMasterRoomActiveTable();
  if (!active) return;
  await apiDelete(`/gm/tables/${encodeURIComponent(active.id)}/combat/entries/${encodeURIComponent(String(entryId || ""))}`);
  await loadMasterRoom();
}

async function addTraderAccessToMasterRoom(traderId) {
  const active = getMasterRoomActiveTable();
  if (!active) return;

  const result = await apiClientPost(`/gm/tables/${active.id}/trader-accesses`, {
    trader_id: Number(traderId),
  });
  applyAndRenderMasterRoom(result);
}

async function removeTraderAccessFromMasterRoom(traderId) {
  const active = getMasterRoomActiveTable();
  if (!active) return;

  await apiDelete(`/gm/tables/${encodeURIComponent(active.id)}/trader-accesses/${encodeURIComponent(String(traderId || ""))}`);
  await loadMasterRoom();
}

async function grantItemToMasterRoomMember(itemId) {
  const active = getMasterRoomActiveTable();
  const membershipId = String(getEl("masterRoomGrantMemberId")?.value || "").trim();
  const quantity = Math.max(1, safeNumber(getEl("masterRoomGrantQuantity")?.value, 1));

  if (!active) return;
  if (!membershipId) {
    showToast("Сначала выбери игрока");
    return;
  }

  const result = await apiClientPost(`/gm/tables/${active.id}/grants/item`, {
    membership_id: Number(membershipId),
    item_id: Number(itemId),
    quantity,
  });
  applyAndRenderMasterRoom(result);
}

function bindMasterRoomActions() {
  const toggleCreateBtn = getEl("masterRoomToggleCreateBtn");
  if (toggleCreateBtn && toggleCreateBtn.dataset.boundMasterRoomToggleCreate !== "1") {
    toggleCreateBtn.dataset.boundMasterRoomToggleCreate = "1";
    toggleCreateBtn.addEventListener("click", () => {
      MASTER_ROOM_STATE.createOpen = !MASTER_ROOM_STATE.createOpen;
      renderMasterRoom();
    });
  }

  const reloadBtn = getEl("masterRoomReloadBtn");
  if (reloadBtn && reloadBtn.dataset.boundMasterRoomReload !== "1") {
    reloadBtn.dataset.boundMasterRoomReload = "1";
    reloadBtn.addEventListener("click", async () => {
      try {
        await loadMasterRoom();
        showToast("Master Room обновлён");
      } catch (error) {
        showToast(error?.message || "Не удалось обновить Master Room");
      }
    });
  }

  document.querySelectorAll("[data-master-room-toggle-ui]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomToggleUi === "1") return;
    btn.dataset.boundMasterRoomToggleUi = "1";
    btn.addEventListener("click", () => {
      const key = String(btn.dataset.masterRoomToggleUi || "").trim();
      if (key === "rail") MASTER_ROOM_STATE.railCollapsed = !MASTER_ROOM_STATE.railCollapsed;
      if (key === "hero") MASTER_ROOM_STATE.heroCollapsed = !MASTER_ROOM_STATE.heroCollapsed;
      if (key === "scene") MASTER_ROOM_STATE.sceneCollapsed = !MASTER_ROOM_STATE.sceneCollapsed;
      if (key === "journal") MASTER_ROOM_STATE.journalCollapsed = !MASTER_ROOM_STATE.journalCollapsed;
      persistCabinetUiState();
      renderMasterRoom();
    });
  });

  document.querySelectorAll("[data-master-room-scroll-anchor]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomScrollAnchor === "1") return;
    btn.dataset.boundMasterRoomScrollAnchor = "1";
    btn.addEventListener("click", () => {
      const anchor = String(btn.dataset.masterRoomScrollAnchor || "").trim();
      const hasTarget = !anchor || anchor === "top" || Boolean(document.querySelector(`[data-cabinet-anchor="${anchor}"]`));
      if (!hasTarget && ["scene", "journal", "battle"].includes(anchor)) {
        if (anchor === "scene") MASTER_ROOM_STATE.stageMode = "table";
        if (anchor === "journal") MASTER_ROOM_STATE.stageMode = "journal";
        if (anchor === "battle") MASTER_ROOM_STATE.stageMode = "combat";
        renderMasterRoom();
        window.setTimeout(() => scrollCabinetAnchor(anchor), 0);
        return;
      }
      scrollCabinetAnchor(anchor);
    });
  });

  document.querySelectorAll("[data-master-room-stage-mode]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomStageMode === "1") return;
    btn.dataset.boundMasterRoomStageMode = "1";
    btn.addEventListener("click", () => {
      const active = getMasterRoomActiveTable();
      const canManage = canManageMasterRoomTable(active);
      MASTER_ROOM_STATE.stageMode = normalizeMasterRoomStageMode(btn.dataset.masterRoomStageMode, canManage);
      renderMasterRoom();
    });
  });

  const createBtn = getEl("masterRoomCreateBtn");
  if (createBtn && createBtn.dataset.boundMasterRoomCreate !== "1") {
    createBtn.dataset.boundMasterRoomCreate = "1";
    createBtn.addEventListener("click", async () => {
      const title = String(getEl("masterRoomCreateTitle")?.value || "").trim();
      const token = String(getEl("masterRoomCreateToken")?.value || "").trim();
      if (!title) {
        showToast("Укажи название стола");
        return;
      }
      try {
        await createMasterRoomTable(title, token || title);
      } catch (error) {
        showToast(error?.message || "Не удалось создать стол");
      }
    });
  }

  const inviteInput = getEl("masterRoomInviteQuery");
  if (inviteInput && inviteInput.dataset.boundMasterRoomInviteQuery !== "1") {
    inviteInput.dataset.boundMasterRoomInviteQuery = "1";
    inviteInput.addEventListener("input", async () => {
      const cursor = inviteInput.selectionStart ?? String(inviteInput.value || "").length;
      MASTER_ROOM_STATE.inviteQuery = inviteInput.value || "";
      await loadMasterRoomUsers(MASTER_ROOM_STATE.inviteQuery);
      const active = getMasterRoomActiveTable();
      patchMasterRoomResults("masterRoomUserSearchResults", renderMasterRoomUserSearchResults(active));
      restoreMasterRoomInputCursor("masterRoomInviteQuery", cursor);
    });
  }

  const saveTableBtn = getEl("masterRoomSaveTableBtn");
  if (saveTableBtn && saveTableBtn.dataset.boundMasterRoomSaveTable !== "1") {
    saveTableBtn.dataset.boundMasterRoomSaveTable = "1";
    saveTableBtn.addEventListener("click", async () => {
      try {
        await patchMasterRoomTable({
          title: String(getEl("masterRoomTableTitle")?.value || "").trim(),
          status: String(getEl("masterRoomTableStatus")?.value || "").trim(),
          notes: String(getEl("masterRoomTableNotes")?.value || "").trim(),
          trader_access_mode: String(getEl("masterRoomTraderAccessMode")?.value || "open").trim(),
        });
        showToast("Стол обновлён");
      } catch (error) {
        showToast(error?.message || "Не удалось обновить стол");
      }
    });
  }

  const traderAccessMode = getEl("masterRoomTraderAccessMode");
  if (traderAccessMode && traderAccessMode.dataset.boundMasterRoomTraderMode !== "1") {
    traderAccessMode.dataset.boundMasterRoomTraderMode = "1";
    traderAccessMode.addEventListener("change", async () => {
      await patchMasterRoomTable({
        trader_access_mode: String(traderAccessMode.value || "open").trim(),
      });
      showToast("Режим доступа к торговцам обновлён");
    });
  }

  const addTraderBtn = getEl("masterRoomAddTraderBtn");
  if (addTraderBtn && addTraderBtn.dataset.boundMasterRoomAddTraderBtn !== "1") {
    addTraderBtn.dataset.boundMasterRoomAddTraderBtn = "1";
    addTraderBtn.addEventListener("click", async () => {
      const traderId = safeNumber(getEl("masterRoomTraderSelect")?.value, 0);
      if (!traderId) {
        showToast("Сначала выбери торговца");
        return;
      }
      await addTraderAccessToMasterRoom(traderId);
      showToast("Доступ к торговцу открыт");
    });
  }

  const itemSearchInput = getEl("masterRoomItemSearchInput");
  if (itemSearchInput && itemSearchInput.dataset.boundMasterRoomItemSearch !== "1") {
    itemSearchInput.dataset.boundMasterRoomItemSearch = "1";
    itemSearchInput.addEventListener("input", async () => {
      const cursor = itemSearchInput.selectionStart ?? String(itemSearchInput.value || "").length;
      MASTER_ROOM_STATE.itemSearchQuery = itemSearchInput.value || "";
      await loadMasterRoomItems(MASTER_ROOM_STATE.itemSearchQuery);
      const active = getMasterRoomActiveTable();
      if (active) {
        patchMasterRoomResults("masterRoomItemSearchResults", renderMasterRoomItemSearchResults());
      }
      restoreMasterRoomInputCursor("masterRoomItemSearchInput", cursor);
    });
  }

  document.querySelectorAll("[data-master-room-open]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomOpen === "1") return;
    btn.dataset.boundMasterRoomOpen = "1";
    btn.addEventListener("click", () => {
      MASTER_ROOM_STATE.activeTableId = btn.dataset.masterRoomOpen || "";
      renderMasterRoom();
    });
  });

  document.querySelectorAll("[data-master-room-delete]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomDelete === "1") return;
    btn.dataset.boundMasterRoomDelete = "1";
    btn.addEventListener("click", async () => {
      const tableId = btn.dataset.masterRoomDelete || "";
      const table = MASTER_ROOM_STATE.tables.find((entry) => entry.id === tableId);
      const ok = confirm(`Удалить стол "${table?.title || "Стол"}"?`);
      if (!ok) return;
      await deleteMasterRoomTable(tableId);
    });
  });

  document.querySelectorAll("[data-master-room-add-user-id]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomAddUserId === "1") return;
    btn.dataset.boundMasterRoomAddUserId = "1";
    btn.addEventListener("click", async () => {
      await addMemberToMasterRoom({ user_id: btn.dataset.masterRoomAddUserId || "" });
      showToast("Игрок добавлен в стол");
    });
  });

  document.querySelectorAll("[data-master-room-remove-member]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomRemoveMember === "1") return;
    btn.dataset.boundMasterRoomRemoveMember = "1";
    btn.addEventListener("click", async () => {
      const memberId = btn.dataset.masterRoomRemoveMember || "";
      const active = getMasterRoomActiveTable();
      const member = getMasterRoomMemberById(active, memberId);
      const ok = confirm(`Убрать игрока "${member?.nickname || "игрок"}" из стола?`);
      if (!ok) return;
      await removeMemberFromMasterRoom(memberId);
    });
  });

  document.querySelectorAll("[data-master-room-member-visibility]").forEach((select) => {
    if (select.dataset.boundMasterRoomVisibility === "1") return;
    select.dataset.boundMasterRoomVisibility = "1";
    select.addEventListener("change", async () => {
      await patchMasterRoomMember(
        select.dataset.masterRoomMemberVisibility || "",
        { visibility_preset: normalizeMasterRoomVisibility(select.value) }
      );
      showToast("Видимость участника обновлена");
    });
  });

  document.querySelectorAll("[data-master-room-visibility-scope]").forEach((select) => {
    if (select.dataset.boundMasterRoomVisibilityScope === "1") return;
    select.dataset.boundMasterRoomVisibilityScope = "1";
    select.addEventListener("change", async () => {
      const active = getMasterRoomActiveTable();
      const member = getMasterRoomMemberById(active, select.dataset.masterRoomVisibilityScope || "");
      if (!member) return;
      const key = String(select.dataset.masterRoomVisibilityKey || "").trim();
      const matrix = {
        ...getMasterRoomMemberVisibilityMatrix(member),
        [key]: normalizeMasterRoomScope(select.value),
      };
      await patchMasterRoomMember(member.id, {
        hidden_sections: {
          ...(member.hidden_sections || {}),
          visibility_matrix: matrix,
        },
      });
      showToast("Visibility matrix обновлена");
    });
  });

  document.querySelectorAll("[data-master-room-field-visibility-member]").forEach((select) => {
    if (select.dataset.boundMasterRoomFieldVisibility === "1") return;
    select.dataset.boundMasterRoomFieldVisibility = "1";
    select.addEventListener("change", async () => {
      const active = getMasterRoomActiveTable();
      const member = getMasterRoomMemberById(active, select.dataset.masterRoomFieldVisibilityMember || "");
      if (!member || !canEditMasterRoomMemberVisibility(member, active)) return;

      const groupKey = String(select.dataset.masterRoomFieldVisibilityGroup || "").trim();
      const fieldKey = String(select.dataset.masterRoomFieldVisibilityKey || "").trim();
      if (!groupKey || !fieldKey) return;

      const fields = getMasterRoomMemberVisibilityFields(member);
      fields[groupKey] = { ...(fields[groupKey] || {}) };
      const nextValue = String(select.value || "").trim();
      if (nextValue) {
        fields[groupKey][fieldKey] = normalizeMasterRoomScope(nextValue);
      } else {
        delete fields[groupKey][fieldKey];
      }

      await patchMasterRoomMember(member.id, {
        hidden_sections: {
          ...(member.hidden_sections || {}),
          visibility_fields: fields,
        },
      });
      showToast("Видимость поля LSS обновлена");
    });
  });

  document.querySelectorAll("[data-master-room-member-role]").forEach((select) => {
    if (select.dataset.boundMasterRoomMemberRole === "1") return;
    select.dataset.boundMasterRoomMemberRole = "1";
    select.addEventListener("change", async () => {
      await patchMasterRoomMember(
        select.dataset.masterRoomMemberRole || "",
        { role_in_table: normalizeMasterRoomRole(select.value) }
      );
      showToast("Роль участника обновлена");
    });
  });

  document.querySelectorAll("[data-master-room-member-character]").forEach((input) => {
    if (input.dataset.boundMasterRoomCharacter === "1") return;
    input.dataset.boundMasterRoomCharacter = "1";
    input.addEventListener("change", async () => {
      await patchMasterRoomMember(
        input.dataset.masterRoomMemberCharacter || "",
        { selected_character_name: String(input.value || "").trim() }
      );
      showToast("Персонаж участника обновлён");
    });
  });

  document.querySelectorAll("[data-master-room-open-sheet]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomOpenSheet === "1") return;
    btn.dataset.boundMasterRoomOpenSheet = "1";
    btn.addEventListener("click", () => {
      MASTER_ROOM_STATE.activeSheetMemberId = btn.dataset.masterRoomOpenSheet || "";
      renderMasterRoom();
    });
  });

  document.querySelectorAll("[data-master-room-member-character-select]").forEach((select) => {
    if (select.dataset.boundMasterRoomMemberCharacterSelect === "1") return;
    select.dataset.boundMasterRoomMemberCharacterSelect = "1";
    select.addEventListener("change", async () => {
      const characterId = safeNumber(select.value, 0);
      if (!characterId) return;
      await patchMasterRoomMember(
        select.dataset.masterRoomMemberCharacterSelect || "",
        { selected_character_id: characterId }
      );
      showToast("Персонаж из пула привязан к участнику");
    });
  });

  document.querySelectorAll("[data-master-room-use-lss]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomUseLss === "1") return;
    btn.dataset.boundMasterRoomUseLss = "1";
    btn.addEventListener("click", async () => {
      await syncCurrentMemberFromLss(btn.dataset.masterRoomUseLss || "");
      showToast("Персонаж из LSS добавлен в стол");
    });
  });

  document.querySelectorAll("[data-master-room-open-lss]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomOpenLss === "1") return;
    btn.dataset.boundMasterRoomOpenLss = "1";
    btn.addEventListener("click", async () => {
      await switchCabinetTab("lss");
    });
  });

  document.querySelectorAll("[data-master-room-switch-tab]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomSwitchTab === "1") return;
    btn.dataset.boundMasterRoomSwitchTab = "1";
    btn.addEventListener("click", async () => {
      const tabName = String(btn.dataset.masterRoomSwitchTab || "").trim();
      if (!tabName) return;
      await switchCabinetTab(tabName);
    });
  });

  document.querySelectorAll("[data-master-room-reload-inline]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomReloadInline === "1") return;
    btn.dataset.boundMasterRoomReloadInline = "1";
    btn.addEventListener("click", async () => {
      try {
        await loadMasterRoom();
        showToast("Master Room обновлён");
      } catch (error) {
        showToast(error?.message || "Не удалось обновить Master Room");
      }
    });
  });

  document.querySelectorAll("[data-master-room-scroll-context]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomScrollContext === "1") return;
    btn.dataset.boundMasterRoomScrollContext = "1";
    btn.addEventListener("click", () => {
      const overview = btn.closest(".master-room-live-grid");
      const contextDrawer = document.querySelector(".master-room-battle-context-drawer");
      if (contextDrawer && "open" in contextDrawer) contextDrawer.open = true;
      const target = btn.dataset.masterRoomScrollContext === "journal"
        ? overview?.querySelector(".master-room-event-journal-panel")
          || document.querySelector(".master-room-battle-context .master-room-event-journal-panel")
          || document.querySelector(".master-room-event-journal-panel")
        : document.querySelector(".master-room-battle-context")
          || overview
          || document.querySelector(".master-room-live-grid");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  const characterPoolSelect = getEl("masterRoomCharacterPoolSelect");
  if (characterPoolSelect && characterPoolSelect.dataset.boundMasterRoomCharacterPool !== "1") {
    characterPoolSelect.dataset.boundMasterRoomCharacterPool = "1";
    characterPoolSelect.addEventListener("change", () => {
      MASTER_ROOM_STATE.selectedCharacterPoolValue = String(characterPoolSelect.value || "lss-current").trim() || "lss-current";
      renderMasterRoom();
    });
  }

  const applyCharacterPoolBtn = getEl("masterRoomApplyCharacterPoolBtn");
  if (applyCharacterPoolBtn && applyCharacterPoolBtn.dataset.boundMasterRoomApplyCharacter !== "1") {
    applyCharacterPoolBtn.dataset.boundMasterRoomApplyCharacter = "1";
    applyCharacterPoolBtn.addEventListener("click", async () => {
      const active = getMasterRoomActiveTable();
      const currentMember = safeArray(active?.members).find((member) => String(member.user_id || "") === getCurrentUserId());
      if (!currentMember) {
        showToast("Сначала зайди в стол как участник");
        return;
      }
      const selectedValue = String(MASTER_ROOM_STATE.selectedCharacterPoolValue || "lss-current").trim() || "lss-current";
      if (selectedValue === "lss-current") {
        await syncCurrentMemberFromLss(currentMember.id);
        showToast("Персонаж из LSS подтверждён для этого стола");
        return;
      }
      const selectedCharacter = getMasterRoomSelectedCharacterPoolEntry();
      if (!selectedCharacter) {
        showToast("Сначала выбери персонажа из пула");
        return;
      }
      await patchMasterRoomMember(currentMember.id, {
        selected_character_id: selectedCharacter.id,
      });
      showToast("Персонаж из пула привязан к столу");
    });
  }

  document.querySelectorAll("[data-master-room-remove-trader-id]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomRemoveTraderId === "1") return;
    btn.dataset.boundMasterRoomRemoveTraderId = "1";
    btn.addEventListener("click", async () => {
      await removeTraderAccessFromMasterRoom(btn.dataset.masterRoomRemoveTraderId || "");
      showToast("Доступ к торговцу закрыт");
    });
  });

  document.querySelectorAll("[data-master-room-grant-item-id]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomGrantItemId === "1") return;
    btn.dataset.boundMasterRoomGrantItemId = "1";
    btn.addEventListener("click", async () => {
      await grantItemToMasterRoomMember(btn.dataset.masterRoomGrantItemId || "");
      showToast("Предмет выдан игроку");
    });
  });

  const enemySearchInput = getEl("masterRoomEnemySearchInput");
  if (enemySearchInput && enemySearchInput.dataset.boundMasterRoomEnemySearch !== "1") {
    enemySearchInput.dataset.boundMasterRoomEnemySearch = "1";
    enemySearchInput.addEventListener("input", () => {
      const cursor = enemySearchInput.selectionStart ?? String(enemySearchInput.value || "").length;
      MASTER_ROOM_STATE.enemyQuery = enemySearchInput.value || "";
      const active = getMasterRoomActiveTable();
      if (active) {
        renderMasterRoom();
        restoreMasterRoomInputCursor("masterRoomEnemySearchInput", cursor);
      }
    });
  }

  document.querySelectorAll("[data-master-room-add-enemy]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomAddEnemy === "1") return;
    btn.dataset.boundMasterRoomAddEnemy = "1";
    btn.addEventListener("click", async () => {
      const enemyId = btn.dataset.masterRoomAddEnemy || "";
      const source = safeArray(MASTER_ROOM_STATE.enemyCatalog).find((entry) => entry.id === enemyId);
      if (!source) {
        showToast("Противник не найден");
        return;
      }
      await addEnemyToMasterRoomCombat({
        name: source.title,
        hp_current: source.hp,
        hp_max: source.hp,
        ac: source.ac,
        initiative: source.initiative,
        status: "hostile",
        source: source.source || "encyclopedia",
        enemy_ref: source.id,
        attacks: source.attacks || [],
        abilities: source.abilities || {},
        spells: source.spells || [],
      });
      showToast(`Противник добавлен: ${source.title}`);
    });
  });

  const addManualEnemyBtn = getEl("masterRoomAddManualEnemyBtn");
  if (addManualEnemyBtn && addManualEnemyBtn.dataset.boundMasterRoomAddManualEnemy !== "1") {
    addManualEnemyBtn.dataset.boundMasterRoomAddManualEnemy = "1";
    addManualEnemyBtn.addEventListener("click", async () => {
      const name = String(getEl("masterRoomManualEnemyName")?.value || "").trim();
      if (!name) {
        showToast("Укажи имя противника");
        return;
      }
      await addEnemyToMasterRoomCombat({
        name,
        hp_current: Math.max(1, safeNumber(getEl("masterRoomManualEnemyHp")?.value, 10)),
        hp_max: Math.max(1, safeNumber(getEl("masterRoomManualEnemyHp")?.value, 10)),
        ac: Math.max(0, safeNumber(getEl("masterRoomManualEnemyAc")?.value, 10)),
        initiative: safeNumber(getEl("masterRoomManualEnemyInit")?.value, 0),
        status: "hostile",
        source: "manual",
      });
      showToast(`Противник добавлен: ${name}`);
    });
  }

  const combatBootstrapBtn = getEl("masterRoomCombatBootstrapBtn");
  if (combatBootstrapBtn && combatBootstrapBtn.dataset.boundMasterRoomCombatBootstrap !== "1") {
    combatBootstrapBtn.dataset.boundMasterRoomCombatBootstrap = "1";
    combatBootstrapBtn.addEventListener("click", async () => {
      await bootstrapMasterRoomCombat();
      showToast("Боевой состав собран из участников стола");
    });
  }

  const combatSaveStateBtn = getEl("masterRoomCombatSaveStateBtn");
  if (combatSaveStateBtn && combatSaveStateBtn.dataset.boundMasterRoomCombatState !== "1") {
    combatSaveStateBtn.dataset.boundMasterRoomCombatState = "1";
    combatSaveStateBtn.addEventListener("click", async () => {
      await patchMasterRoomCombatState({
        round: Math.max(1, safeNumber(getEl("masterRoomCombatRound")?.value, 1)),
        turn_index: Math.max(0, safeNumber(getEl("masterRoomCombatTurnIndex")?.value, 0)),
        active: String(getEl("masterRoomCombatActiveState")?.value || "inactive") === "active",
      });
      showToast("Фаза боя обновлена");
    });
  }

  [getEl("masterRoomCombatNextTurnBtn"), getEl("masterRoomCombatNextTurnQuickBtn")].filter(Boolean).forEach((combatNextTurnBtn) => {
    if (combatNextTurnBtn.dataset.boundMasterRoomCombatNext === "1") return;
    combatNextTurnBtn.dataset.boundMasterRoomCombatNext = "1";
    combatNextTurnBtn.addEventListener("click", async () => {
      const active = getMasterRoomActiveTable();
      const combat = normalizeMasterRoomCombat(active?.combat);
      if (!combat.entries.length) {
        showToast("Сначала собери боевой состав");
        return;
      }
      const nextTurnIndex = (combat.turn_index + 1) % combat.entries.length;
      const nextRound = nextTurnIndex === 0 ? combat.round + 1 : combat.round;
      await patchMasterRoomCombatState({
        round: nextRound,
        turn_index: nextTurnIndex,
        active: true,
      });
      showToast("Ход передан дальше");
    });
  });

  document.querySelectorAll("[data-master-room-focus-turn]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomFocusTurn === "1") return;
    btn.dataset.boundMasterRoomFocusTurn = "1";
    btn.addEventListener("click", async () => {
      const turnIndex = Math.max(0, safeNumber(btn.dataset.masterRoomFocusTurn, 0));
      const active = getMasterRoomActiveTable();
      const combat = normalizeMasterRoomCombat(active?.combat);
      await patchMasterRoomCombatState({
        round: combat.round,
        turn_index: turnIndex,
        active: combat.active,
      });
      showToast("Текущий ход обновлён");
    });
  });

  const combatRollBtn = getEl("masterRoomCombatRollBtn");
  if (combatRollBtn && combatRollBtn.dataset.boundMasterRoomCombatRoll !== "1") {
    combatRollBtn.dataset.boundMasterRoomCombatRoll = "1";
    combatRollBtn.addEventListener("click", async () => {
      const actorEntryId = String(getEl("masterRoomCombatRollActor")?.value || "").trim();
      const eventType = String(getEl("masterRoomCombatEventType")?.value || "roll").trim();
      MASTER_ROOM_STATE.combatEventType = eventType;
      await rollMasterRoomCombat({
        entry_id: actorEntryId || null,
        target_entry_id: String(getEl("masterRoomCombatTarget")?.value || "").trim() || null,
        dice: String(getEl("masterRoomCombatRollDice")?.value || "d20").trim(),
        modifier: safeNumber(getEl("masterRoomCombatRollModifier")?.value, 0),
        damage: safeNumber(getEl("masterRoomCombatDamage")?.value, 0),
        event_type: eventType,
        reason: String(getEl("masterRoomCombatRollReason")?.value || "").trim(),
      });
      showToast("Бросок добавлен в лог боя");
    });
  }

  const combatEventType = getEl("masterRoomCombatEventType");
  if (combatEventType && combatEventType.dataset.boundMasterRoomCombatEventType !== "1") {
    combatEventType.dataset.boundMasterRoomCombatEventType = "1";
    combatEventType.addEventListener("change", () => {
      MASTER_ROOM_STATE.combatEventType = String(combatEventType.value || "roll").trim();
    });
  }

  document.querySelectorAll("[data-master-room-combat-quick-event]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomCombatQuickEvent === "1") return;
    btn.dataset.boundMasterRoomCombatQuickEvent = "1";
    btn.addEventListener("click", () => {
      const nextType = String(btn.dataset.masterRoomCombatQuickEvent || "roll").trim() || "roll";
      MASTER_ROOM_STATE.combatEventType = nextType;
      const eventTypeSelect = getEl("masterRoomCombatEventType");
      if (eventTypeSelect) eventTypeSelect.value = nextType;
      const reasonInput = getEl("masterRoomCombatRollReason");
      if (reasonInput && !String(reasonInput.value || "").trim()) {
        reasonInput.value = btn.textContent?.trim() || nextType;
      }
      document.querySelector(".master-room-action-console-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
      getEl("masterRoomCombatRollActor")?.focus?.();
    });
  });

  document.querySelectorAll("[data-master-room-combat-save]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomCombatSave === "1") return;
    btn.dataset.boundMasterRoomCombatSave = "1";
    btn.addEventListener("click", async () => {
      const entryId = btn.dataset.masterRoomCombatSave || "";
      const active = getMasterRoomActiveTable();
      const entry = getMasterRoomCombatEntryById(active, entryId);
      const patch = {
        name: String(getEl(`masterRoomCombatName-${entryId}`)?.value || "").trim(),
        hp_current: Math.max(0, safeNumber(getEl(`masterRoomCombatHpCurrent-${entryId}`)?.value, 0)),
        hp_max: Math.max(0, safeNumber(getEl(`masterRoomCombatHpMax-${entryId}`)?.value, 0)),
        ac: Math.max(0, safeNumber(getEl(`masterRoomCombatAc-${entryId}`)?.value, 0)),
        initiative: safeNumber(getEl(`masterRoomCombatInit-${entryId}`)?.value, 0),
        status: String(getEl(`masterRoomCombatStatus-${entryId}`)?.value || "").trim(),
      };
      if (entry?.entry_type === "enemy") {
        await patchMasterRoomCombatEntry(entryId, patch);
      } else {
        await patchMasterRoomCombatant(entry?.membership_id || "", patch);
      }
      showToast("Позиция боя обновлена");
    });
  });

  document.querySelectorAll("[data-master-room-combat-damage]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomCombatDamage === "1") return;
    btn.dataset.boundMasterRoomCombatDamage = "1";
    btn.addEventListener("click", async () => {
      const entryId = btn.dataset.masterRoomCombatDamage || "";
      const active = getMasterRoomActiveTable();
      const entry = getMasterRoomCombatEntryById(active, entryId);
      const delta = Math.max(1, safeNumber(getEl(`masterRoomCombatDelta-${entryId}`)?.value, 1));
      const nextHp = Math.max(0, safeNumber(entry?.hp_current, 0) - delta);
      if (entry?.entry_type === "enemy") {
        await patchMasterRoomCombatEntry(entryId, { hp_current: nextHp });
      } else {
        await patchMasterRoomCombatant(entry?.membership_id || "", { hp_current: nextHp });
      }
      showToast(`Урон применён: -${delta}`);
    });
  });

  document.querySelectorAll("[data-master-room-combat-heal]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomCombatHeal === "1") return;
    btn.dataset.boundMasterRoomCombatHeal = "1";
    btn.addEventListener("click", async () => {
      const entryId = btn.dataset.masterRoomCombatHeal || "";
      const active = getMasterRoomActiveTable();
      const entry = getMasterRoomCombatEntryById(active, entryId);
      const delta = Math.max(1, safeNumber(getEl(`masterRoomCombatDelta-${entryId}`)?.value, 1));
      const hpMax = Math.max(0, safeNumber(entry?.hp_max, 0));
      const nextHp = hpMax > 0
        ? Math.min(hpMax, safeNumber(entry?.hp_current, 0) + delta)
        : safeNumber(entry?.hp_current, 0) + delta;
      if (entry?.entry_type === "enemy") {
        await patchMasterRoomCombatEntry(entryId, { hp_current: nextHp });
      } else {
        await patchMasterRoomCombatant(entry?.membership_id || "", { hp_current: nextHp });
      }
      showToast(`Лечение применено: +${delta}`);
    });
  });

  document.querySelectorAll("[data-master-room-combat-use-lss]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomCombatUseLss === "1") return;
    btn.dataset.boundMasterRoomCombatUseLss = "1";
    btn.addEventListener("click", async () => {
      const entryId = btn.dataset.masterRoomCombatUseLss || "";
      const active = getMasterRoomActiveTable();
      const entry = getMasterRoomCombatEntryById(active, entryId);
      const membershipId = entry?.membership_id || "";
      await syncCurrentMemberFromLss(membershipId, { includeCombat: false });
      const snapshot = getCurrentLssCharacterSnapshot();
      await patchMasterRoomCombatant(membershipId, {
        name: snapshot.name,
        hp_current: snapshot.hp_current,
        hp_max: snapshot.hp_max,
        ac: snapshot.ac,
        initiative: snapshot.initiative,
      });
      showToast("Боевые статы подтянуты из LSS");
    });
  });

  const diceToggleBtn = getEl("masterRoomDiceToggleBtn");
  if (diceToggleBtn && diceToggleBtn.dataset.boundMasterRoomDiceToggle !== "1") {
    diceToggleBtn.dataset.boundMasterRoomDiceToggle = "1";
    diceToggleBtn.addEventListener("click", () => {
      MASTER_ROOM_STATE.combatDiceOpen = !MASTER_ROOM_STATE.combatDiceOpen;
      renderMasterRoom();
    });
  }

  const combatLogToggleBtn = getEl("masterRoomCombatLogToggleBtn");
  if (combatLogToggleBtn && combatLogToggleBtn.dataset.boundMasterRoomCombatLogToggle !== "1") {
    combatLogToggleBtn.dataset.boundMasterRoomCombatLogToggle = "1";
    combatLogToggleBtn.addEventListener("click", () => {
      MASTER_ROOM_STATE.combatLogOpen = !MASTER_ROOM_STATE.combatLogOpen;
      renderMasterRoom();
    });
  }

  document.querySelectorAll("[data-master-room-combat-filter]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomCombatFilter === "1") return;
    btn.dataset.boundMasterRoomCombatFilter = "1";
    btn.addEventListener("click", () => {
      MASTER_ROOM_STATE.combatLogFilter = String(btn.dataset.masterRoomCombatFilter || "all").trim() || "all";
      renderMasterRoom();
    });
  });

  document.querySelectorAll("[data-master-room-combat-secondary-toggle]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomCombatSecondary === "1") return;
    btn.dataset.boundMasterRoomCombatSecondary = "1";
    btn.addEventListener("click", () => {
      MASTER_ROOM_STATE.combatHideSecondary = !MASTER_ROOM_STATE.combatHideSecondary;
      renderMasterRoom();
    });
  });

  document.querySelectorAll("[data-master-room-roll-die]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomRollDie === "1") return;
    btn.dataset.boundMasterRoomRollDie = "1";
    btn.addEventListener("click", async () => {
      const die = String(btn.dataset.masterRoomRollDie || "d20").trim().toLowerCase();
      MASTER_ROOM_STATE.combatDiceType = die;
      const actorEntryId = String(getEl("masterRoomCombatRollActor")?.value || "").trim();
      await rollMasterRoomCombat({
        entry_id: actorEntryId || null,
        dice: die,
        modifier: 0,
        event_type: "roll",
        reason: "Быстрый бросок",
      });
      showToast(`Брошен ${die.toUpperCase()}`);
    });
  });

  document.querySelectorAll("[data-master-room-combat-remove]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomCombatRemove === "1") return;
    btn.dataset.boundMasterRoomCombatRemove = "1";
    btn.addEventListener("click", async () => {
      const entryId = btn.dataset.masterRoomCombatRemove || "";
      await removeMasterRoomCombatEntry(entryId);
      showToast("Позиция убрана из боя");
    });
  });

  document.querySelectorAll("[data-master-room-combat-attack]").forEach((btn) => {
    if (btn.dataset.boundMasterRoomCombatAttack === "1") return;
    btn.dataset.boundMasterRoomCombatAttack = "1";
    btn.addEventListener("click", async () => {
      const entryId = btn.dataset.masterRoomCombatAttack || "";
      const attackName = String(btn.dataset.masterRoomCombatAttackName || "Действие").trim();
      const rollDiceInput = getEl("masterRoomCombatRollDice");
      const rollReasonInput = getEl("masterRoomCombatRollReason");
      const rollActorSelect = getEl("masterRoomCombatRollActor");
      if (rollDiceInput) rollDiceInput.value = MASTER_ROOM_STATE.combatDiceType || "d20";
      if (rollReasonInput) rollReasonInput.value = attackName;
      const eventTypeSelect = getEl("masterRoomCombatEventType");
      if (eventTypeSelect) {
        eventTypeSelect.value = "attack";
        MASTER_ROOM_STATE.combatEventType = "attack";
      }
      if (rollActorSelect) rollActorSelect.value = entryId;
      await rollMasterRoomCombat({
        entry_id: entryId,
        dice: MASTER_ROOM_STATE.combatDiceType || "d20",
        modifier: 0,
        event_type: "attack",
        reason: attackName,
      });
      showToast(`В лог добавлено действие: ${attackName}`);
    });
  });
}


// ------------------------------------------------------------
// 🚪 OPEN / CLOSE
// ------------------------------------------------------------
export async function openCabinet() {
  const modal = ensureCabinetStructure();
  if (!modal) return;

  try {
    const profile = await fetchProfile();
    if (profile && typeof profile === "object") {
      syncCurrentUserProfile(profile);
    }
  } catch (_) {}

  CABINET_STATE.role = getCurrentRole();
  normalizeActiveTabForRole();
  renderCabinetHeader();
  renderCabinetTabs();
  bindCabinetTabs();
  bindCabinetActions();
  updateCabinetViewState(true);
  openModal(modal);
  try {
    await refreshCurrentCabinetTab();
  } catch (error) {
    console.error(error);
    showToast(error?.message || "Кабинет открыт с ошибкой загрузки модуля");
  }
}

export function closeCabinet() {
  const modal = getEl("cabinetModal");
  stopMasterRoomPolling();
  updateCabinetViewState(false);
  closeModal(modal);
}

// ------------------------------------------------------------
// 📑 TABS
// ------------------------------------------------------------
export async function switchCabinetTab(tabName) {
  CABINET_STATE.activeTab = tabName;
  if (tabName !== "masterroom") {
    stopMasterRoomPolling();
  }
  updateCabinetViewState(isCabinetOpen());
  applyCabinetModalLayout();
  renderCabinetHeader();

  hideAllCabinetSections();

  const targetId = getSectionIdForTab(tabName);
  const target = getEl(targetId);
  if (target) target.classList.remove("tab-hidden");

  setActiveCabinetButton(tabName);

  if (tabName === "inventory") {
    renderCabinetInventory();
    return;
  }

  if (tabName === "myaccount") {
    await loadAccountModule();
    renderAccountModule();
    return;
  }

  if (tabName === "project") {
    renderProjectSupportTab();
    return;
  }

  if (tabName === "lss") {
    await loadLSS();
    renderLSS();
    return;
  }

  if (tabName === "history") {
    await loadHistory();
    renderHistory();
    return;
  }

  if (tabName === "quests") {
    await loadQuests();
    renderQuests();
    return;
  }

  if (tabName === "map") {
    await loadMapData();
    renderMaps();
    return;
  }

  if (tabName === "bestiari") {
    await loadBestiari();
    renderBestiari();
    return;
  }

  if (tabName === "files") {
    await loadFiles();
    renderFiles();
    return;
  }

  if (tabName === "playernotes") {
    await loadPlayerNotes();
    renderNotes();
    return;
  }

  if (tabName === "masterroom") {
    await loadMasterRoom();
    renderMasterRoom();
    return;
  }

  if (tabName === "gmnotes") {
    await loadGmNotes();
    renderGmNotes();
  }
}

export function bindCabinetTabs() {
  document.querySelectorAll("[data-cabinet-tab]").forEach((btn) => {
    if (btn.dataset.boundCabinetTab === "1") return;
    btn.dataset.boundCabinetTab = "1";

    btn.addEventListener("click", async () => {
      const tabName = btn.dataset.cabinetTab;
      await switchCabinetTab(tabName);
    });
  });
}

// ------------------------------------------------------------
// 🔘 ACTIONS
// ------------------------------------------------------------
function isCabinetOpen() {
  const modal = getEl("cabinetModal");
  if (!modal) return false;
  return modal.style.display === "block" || !modal.classList.contains("hidden");
}

function normalizeActiveTabForRole() {
  const visible = getVisibleTabsByRole(CABINET_STATE.role).map((tab) => tab.key);
  if (!visible.includes(CABINET_STATE.activeTab)) {
    CABINET_STATE.activeTab = "myaccount";
  }
}

async function refreshCurrentCabinetTab() {
  if (CABINET_RUNTIME.refreshing) {
    CABINET_RUNTIME.pendingRefresh = true;
    return;
  }

  CABINET_RUNTIME.refreshing = true;
  try {
    await switchCabinetTab(CABINET_STATE.activeTab);
  } finally {
    CABINET_RUNTIME.refreshing = false;
    if (CABINET_RUNTIME.pendingRefresh) {
      CABINET_RUNTIME.pendingRefresh = false;
      await refreshCurrentCabinetTab();
    }
  }
}

async function syncCabinetUiFromRoleChange() {
  const nextRole = getCurrentRole();
  const roleChanged = CABINET_STATE.role !== nextRole;
  CABINET_STATE.role = nextRole;

  normalizeActiveTabForRole();
  renderCabinetHeader();
  renderCabinetTabs();
  bindCabinetTabs();

  if (isCabinetOpen() || roleChanged) {
    await refreshCurrentCabinetTab();
  }
}

export function bindCabinetActions() {
  const modal = getEl("cabinetModal");
  const closeBtn = modal?.querySelector(".close");

  if (closeBtn && closeBtn.dataset.boundCabinetClose !== "1") {
    closeBtn.dataset.boundCabinetClose = "1";
    closeBtn.addEventListener("click", () => closeCabinet());
  }

  if (modal && modal.dataset.boundCabinetRoleSync !== "1") {
    modal.dataset.boundCabinetRoleSync = "1";

    window.addEventListener("dnd:role:changed", async () => {
      await syncCabinetUiFromRoleChange();
    });

    window.addEventListener("dnd:app:state-synced", async () => {
      if (!isCabinetOpen()) return;

      if (CABINET_STATE.activeTab === "inventory") {
        renderCabinetInventory();
        return;
      }

      if (CABINET_STATE.activeTab === "map") {
        await loadMapData();
        renderMaps();
        return;
      }

      if (CABINET_STATE.activeTab === "bestiari") {
        await loadBestiari();
        renderBestiari();
        return;
      }

      if (CABINET_STATE.activeTab === "masterroom") {
        await loadMasterRoom();
        renderMasterRoom();
        return;
      }

      if (CABINET_STATE.activeTab === "lss") {
        await loadLSS();
        renderLSS();
      }
    });
  }
}

export async function loadCabinetAll() {
  CABINET_STATE.role = getCurrentRole();
  normalizeActiveTabForRole();

  renderCabinetHeader();
  renderCabinetTabs();
  bindCabinetTabs();

  renderCabinetInventory();
  await loadAccountModule();
  renderAccountModule();
  renderProjectSupportTab();

  await loadLSS();
  renderLSS();

  await loadHistory();
  renderHistory();

  await loadQuests();
  renderQuests();

  await loadMapData();
  renderMaps();

  await loadBestiari();
  renderBestiari();

  await loadPlayerNotes();
  renderNotes();

  await loadFiles();
  renderFiles();

  if (CABINET_STATE.role === "gm") {
    await loadMasterRoom();
    renderMasterRoom();
    await loadGmNotes();
  }
  renderGmNotes();
}

export function initCabinet() {
  const modal = ensureCabinetStructure();
  if (!modal) return;

  CABINET_STATE.role = getCurrentRole();
  normalizeActiveTabForRole();

  renderCabinetHeader();
  renderCabinetTabs();
  renderCabinetInventory();
  renderBestiari();
  renderFiles();
  if (CABINET_STATE.role === "gm") {
    renderMasterRoom();
  }
  renderAccountModule();
  renderGmNotes();

  bindCabinetTabs();
  bindCabinetActions();

  if (!modal.dataset.boundCabinetOverlay) {
    modal.dataset.boundCabinetOverlay = "1";
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeCabinet();
      }
    });
  }

  CABINET_STATE.initialized = true;
}

// ------------------------------------------------------------
// 🌉 LEGACY BRIDGE
// ------------------------------------------------------------
window.cabinetModule = {
  openCabinet,
  closeCabinet,
  switchCabinetTab,
  loadCabinetAll,
  initCabinet,
};
