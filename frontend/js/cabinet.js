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
// ============================================================

import {
  loadLSS,
  renderLSS,
} from "./longstoryshort.js";

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

// ------------------------------------------------------------
// 🌐 STATE
// ------------------------------------------------------------
const CABINET_STATE = {
  activeTab: "inventory",
  role: "player",
  initialized: false,
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
};

const FILES_STATE = {
  loaded: false,
  source: "empty",
  items: [],
  draggedIndex: null,
  isSaving: false,
  lastSavedAt: null,
};

// ------------------------------------------------------------
// 🧰 HELPERS
// ------------------------------------------------------------
function getEl(id) {
  return document.getElementById(id);
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

function safeText(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

function formatTime(value) {
  if (!value) return "—";

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function formatDateTime(value) {
  if (!value) return "—";

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
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

  throw new Error("Failed to save");
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
    { key: "inventory", label: "🎒 Инвентарь" },
    { key: "lss", label: "📖 LSS" },
    { key: "history", label: "📜 История" },
    { key: "quests", label: "🧭 Задания" },
    { key: "map", label: "🗺️ Карта" },
    { key: "files", label: "📁 Файлы" },
    { key: "playernotes", label: "📝 Заметки" },
  ];

  if (role === "gm") {
    tabs.push({ key: "gmnotes", label: "🛡️ Заметки ГМа" });
  }

  return tabs;
}

function getSectionIdForTab(tabName) {
  const map = {
    inventory: "cabinet-inventory",
    lss: "cabinet-lss",
    history: "cabinet-history",
    quests: "cabinet-quests",
    map: "cabinet-map",
    files: "cabinet-files",
    playernotes: "cabinet-playernotes",
    gmnotes: "cabinet-gmnotes",
  };

  return map[tabName] || "cabinet-inventory";
}

function hideAllCabinetSections() {
  [
    "cabinet-inventory",
    "cabinet-lss",
    "cabinet-history",
    "cabinet-quests",
    "cabinet-map",
    "cabinet-files",
    "cabinet-playernotes",
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

// ------------------------------------------------------------
// 🏗️ SHELL
// ------------------------------------------------------------
function ensureCabinetStructure() {
  const modal = getEl("cabinetModal");
  if (!modal) return null;

  const tabButtons = getEl("cabinetTabButtons");
  const header = getEl("cabinetHeader");

  if (!tabButtons || !header) {
    console.warn("Cabinet DOM structure incomplete");
  }

  return modal;
}

function renderCabinetHeader() {
  const header = getEl("cabinetHeader");
  if (!header) return;

  const user = getCurrentUser();
  const role = CABINET_STATE.role === "gm" ? "ГМ" : "Игрок";

  header.innerHTML = `
    <div class="cabinet-header-inner">
      <div class="flex-between">
        <div>
          <h2 style="margin:0;">Кабинет персонажа</h2>
          <div class="muted">
            Роль: <strong>${escapeHtml(role)}</strong>
            ${user?.email ? ` • ${escapeHtml(user.email)}` : ""}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCabinetTabs() {
  const root = getEl("cabinetTabButtons");
  if (!root) return;

  const tabs = getVisibleTabsByRole(CABINET_STATE.role);

  root.innerHTML = tabs
    .map((tab) => {
      const active = tab.key === CABINET_STATE.activeTab ? "active" : "";
      return `
        <button class="btn ${active}" data-cabinet-tab="${escapeHtml(tab.key)}">
          ${escapeHtml(tab.label)}
        </button>
      `;
    })
    .join("");
}

// ------------------------------------------------------------
// 🎒 INVENTORY
// ------------------------------------------------------------
function syncInventoryToUi() {
  const inventory = getInventoryState();

  try {
    localStorage.setItem("dnd_inventory", JSON.stringify(inventory));
  } catch (_) {}

  window.__appStateInventory = inventory;

  if (window.__appState && Array.isArray(window.__appState.inventory)) {
    window.__appState.inventory = inventory;
  }

  if (window.__sharedState && Array.isArray(window.__sharedState.inventory)) {
    window.__sharedState.inventory = inventory;
  }

  const inventoryCount = getEl("inventoryCount");
  if (inventoryCount) {
    inventoryCount.textContent = String(getInventoryCount(inventory));
  }

  try {
    if (window.renderModule?.renderInventory) {
      window.renderModule.renderInventory(inventory);
    }
  } catch (_) {}
}

async function tryPersistInventoryToServer() {
  const token = getToken();
  if (!token) return false;

  const inventory = getInventoryState();

  try {
    await apiWrite(
      ["/player/profile", "/profile/me", "/player/inventory", "/inventory"],
      { inventory },
      ["POST", "PUT", "PATCH"]
    );
    return true;
  } catch (_) {
    return false;
  }
}

function renderInventoryToolbar() {
  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="flex-between" style="align-items:center; gap:12px; flex-wrap:wrap;">
        <div>
          <h3 style="margin:0 0 4px 0;">Инвентарь игрока</h3>
          <div class="muted">Дублирует текущий игровой инвентарь внутри кабинета.</div>
        </div>

        <div class="cart-buttons">
          <button class="btn" type="button" id="cabinetRefreshInventoryBtn">Обновить</button>
          <button class="btn btn-primary" type="button" id="cabinetAddCustomItemBtn">
            ${CABINET_INVENTORY_STATE.customFormOpen ? "Скрыть форму" : "＋ Кастомный предмет"}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderCustomItemForm() {
  if (!CABINET_INVENTORY_STATE.customFormOpen) return "";

  return `
    <div class="cabinet-block" id="cabinetCustomItemFormBlock" style="margin-bottom:12px;">
      <h3>Кастомный предмет</h3>

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
          <label>Вес</label>
          <input id="customItemWeight" type="number" min="0" step="0.1" value="0" />
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
        <label>Свойства / свойства механики</label>
        <textarea id="customItemProperties" rows="3" placeholder="Например: одноразовый, кровь, некротика, алхимия"></textarea>
      </div>

      <div class="filter-group" style="margin-top:12px;">
        <label>Требования</label>
        <textarea id="customItemRequirements" rows="2" placeholder="Например: только волшебник, только ГМ, уровень 5+"></textarea>
      </div>

      <div class="modal-actions" style="margin-top:12px; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-success" type="button" id="cabinetSaveCustomItemBtn">Добавить предмет</button>
        <button class="btn" type="button" id="cabinetResetCustomItemBtn">Сбросить</button>
      </div>

      <div class="muted" style="margin-top:10px;">
        Часть параметров выставляется автоматически: local/custom ID, цены продажи, source и дефолтные поля для совместимости.
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

  const priceGold = Math.max(0, safeNumber(getEl("customItemPriceGold")?.value, 0));
  const priceSilver = Math.max(0, safeNumber(getEl("customItemPriceSilver")?.value, 0));
  const priceCopper = Math.max(0, safeNumber(getEl("customItemPriceCopper")?.value, 0));

  const description = safeText(getEl("customItemDescription")?.value, "").trim();
  const properties = safeText(getEl("customItemProperties")?.value, "").trim();
  const requirements = safeText(getEl("customItemRequirements")?.value, "").trim();

  const isMagical = Boolean(getEl("customItemMagical")?.checked);
  const attunement = Boolean(getEl("customItemAttunement")?.checked);

  if (!name) {
    throw new Error("Укажи название кастомного предмета");
  }

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
    inventory[sameIndex].quantity =
      Math.max(1, safeNumber(inventory[sameIndex].quantity, 1)) +
      Math.max(1, safeNumber(customItem.quantity, 1));
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
  const index = inventory.findIndex(
    (entry) => Number(entry?.item_id ?? entry?.id) === Number(itemId)
  );

  if (index < 0) {
    showToast("Предмет не найден");
    return;
  }

  inventory[index].quantity = Math.max(
    1,
    safeNumber(inventory[index].quantity, 1) + safeNumber(delta, 0)
  );

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
  const index = inventory.findIndex(
    (entry) => Number(entry?.item_id ?? entry?.id) === Number(itemId)
  );

  if (index < 0) {
    showToast("Предмет не найден");
    return;
  }

  const [removed] = inventory.splice(index, 1);

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

function renderInventoryList(items) {
  if (!items.length) {
    return `
      <div class="cabinet-block">
        <p>Инвентарь пока пуст.</p>
      </div>
    `;
  }

  return `
    <div class="cabinet-block">
      <div class="inventory-list">
        ${items
          .map((item) => {
            const rareClass = rarityClass(item?.rarity);
            const quantity = safeText(item?.quantity, "1");
            const rarity = safeText(item?.rarity, "—");
            const category = safeText(item?.category, "—");
            const price = formatPriceLabel(item);
            const itemId = Number(item?.item_id ?? item?.id);
            const customBadge = item?.is_custom
              ? `<span class="meta-item">custom</span>`
              : "";

            return `
              <div class="inventory-item">
                <div class="inventory-item-info">
                  <strong class="${escapeHtml(rareClass)}">${escapeHtml(
                    safeText(item?.name, "Без названия")
                  )}</strong>

                  <div class="inv-item-details">
                    <span>Кол-во: ${escapeHtml(quantity)}</span>
                    <span class="${escapeHtml(rareClass)}">Редкость: ${escapeHtml(rarity)}</span>
                    <span>Категория: ${escapeHtml(category)}</span>
                    <span>Цена: ${escapeHtml(price)}</span>
                    ${item?.is_magical ? `<span>✨ магический</span>` : ""}
                    ${item?.attunement ? `<span>🔗 настройка</span>` : ""}
                    ${customBadge}
                  </div>

                  ${
                    item?.description
                      ? `<div class="muted" style="margin-top:6px;">${escapeHtml(item.description)}</div>`
                      : ""
                  }
                </div>

                <div class="cart-buttons">
                  <button class="btn" type="button" data-cabinet-item-minus="${escapeHtml(itemId)}">−1</button>
                  <button class="btn" type="button" data-cabinet-item-plus="${escapeHtml(itemId)}">＋1</button>
                  <button class="btn btn-danger" type="button" data-cabinet-item-remove="${escapeHtml(itemId)}">Удалить</button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderCabinetInventory() {
  const container = getEl("cabinet-inventory");
  if (!container) return;

  const inventory = getInventoryState();

  container.innerHTML = `
    ${renderInventoryToolbar()}
    ${renderCustomItemForm()}
    ${renderInventoryList(inventory)}
  `;

  bindInventoryActions();
}

function bindInventoryActions() {
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
      const itemId = Number(btn.dataset.cabinetItemPlus);
      await changeInventoryQuantity(itemId, 1);
    });
  });

  document.querySelectorAll("[data-cabinet-item-minus]").forEach((btn) => {
    if (btn.dataset.boundCabinetItemMinus === "1") return;
    btn.dataset.boundCabinetItemMinus = "1";

    btn.addEventListener("click", async () => {
      const itemId = Number(btn.dataset.cabinetItemMinus);
      await changeInventoryQuantity(itemId, -1);
    });
  });

  document.querySelectorAll("[data-cabinet-item-remove]").forEach((btn) => {
    if (btn.dataset.boundCabinetItemRemove === "1") return;
    btn.dataset.boundCabinetItemRemove = "1";

    btn.addEventListener("click", async () => {
      const itemId = Number(btn.dataset.cabinetItemRemove);
      const ok = confirm("Удалить предмет из инвентаря?");
      if (!ok) return;
      await removeInventoryEntryFromCabinet(itemId);
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
// 🚪 OPEN / CLOSE
// ------------------------------------------------------------
export function openCabinet() {
  const modal = ensureCabinetStructure();
  if (!modal) return;

  CABINET_STATE.role = getCurrentRole();
  renderCabinetHeader();
  renderCabinetTabs();
  bindCabinetTabs();
  bindCabinetActions();
  switchCabinetTab(CABINET_STATE.activeTab);
  openModal(modal);
}

export function closeCabinet() {
  const modal = getEl("cabinetModal");
  closeModal(modal);
}

// ------------------------------------------------------------
// 📑 TABS
// ------------------------------------------------------------
export async function switchCabinetTab(tabName) {
  CABINET_STATE.activeTab = tabName;

  hideAllCabinetSections();

  const targetId = getSectionIdForTab(tabName);
  const target = getEl(targetId);
  if (target) target.classList.remove("tab-hidden");

  setActiveCabinetButton(tabName);

  if (tabName === "inventory") {
    renderCabinetInventory();
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
export function bindCabinetActions() {
  const closeBtn = getEl("cabinetModal")?.querySelector(".close");
  if (closeBtn && closeBtn.dataset.boundCabinetClose !== "1") {
    closeBtn.dataset.boundCabinetClose = "1";
    closeBtn.addEventListener("click", () => closeCabinet());
  }
}

export async function loadCabinetAll() {
  renderCabinetInventory();

  await loadLSS();
  renderLSS();

  await loadHistory();
  renderHistory();

  await loadQuests();
  renderQuests();

  await loadMapData();
  renderMaps();

  await loadPlayerNotes();
  renderNotes();

  await loadFiles();
  renderFiles();

  if (CABINET_STATE.role === "gm") {
    await loadGmNotes();
  }
  renderGmNotes();
}

export function initCabinet() {
  const modal = ensureCabinetStructure();
  if (!modal) return;

  CABINET_STATE.role = getCurrentRole();

  renderCabinetHeader();
  renderCabinetTabs();
  renderCabinetInventory();
  renderFiles();
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