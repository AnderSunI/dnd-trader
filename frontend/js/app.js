// ============================================================
// frontend/js/app.js
// Центральный файл фронта.
// Совместим с:
// - index.html (текущий)
// - render.js
// - cabinet.js
// - api.js
// ============================================================

import {
  loginUser,
  registerUser,
  fetchMe,
  fetchTraders,
  fetchTraderById,
  restockTrader as apiRestockTrader,
  fetchPlayerInventory,
  buyItem as apiBuyItem,
  sellItem as apiSellItem,
  logoutUser,
} from "./api.js";

import {
  renderTraders,
  renderCart,
  renderInventory,
  openTraderModal as renderOpenTraderModal,
} from "./render.js";

import {
  initCabinet,
  openCabinet,
} from "./cabinet.js";

import * as questsModule from "./quests.js";
import * as playerNotesModule from "./playerNotes.js";
import {
  createInventoryActions,
  consumeCollectionEntry,
  findCartItemByTraderAndItemId,
  findCollectionItemIndex,
  findInventoryIndexByItemId,
  findInventoryItemById,
  findItemInCollectionById,
  getAvailableStock,
  getCartExistingQuantity,
  removeCollectionItem,
} from "./modules/inventoryActions.js";
import { getNextRestockStock } from "./modules/restockHelpers.js";
import { createTradeActions } from "./modules/tradeActions.js";
import { createAuthActions } from "./modules/authActions.js";
import {
  bindAuthButtons,
  bindModalButtons,
  bindMoneyControls,
  bindToolbarButtons,
} from "./modules/uiBindings.js";
import {
  handleGuestRestockFlow,
  handleServerRestockFlow,
} from "./modules/traderRestockFlow.js";
import {
  collectFilters,
  populateFilterOptions,
  sortTraders,
  traderMatchesFilters,
} from "./modules/traderFilters.js";
import {
  bindFilterEvents,
  bindTraderDelegation,
  createOpenTraderModalAction,
  createRestockTraderAction,
} from "./modules/traderActions.js";

// ------------------------------------------------------------
// 💰 MONEY SCALE
// 1 золото = 100 серебра
// 1 серебро = 100 меди
// ------------------------------------------------------------
const COPPER_IN_SILVER = 100;
const SILVER_IN_GOLD = 100;
const COPPER_IN_GOLD = COPPER_IN_SILVER * SILVER_IN_GOLD;

const GUEST_START_GOLD = 1000;
const GUEST_START_GOLD_CP = GUEST_START_GOLD * COPPER_IN_GOLD;

const GUEST_MONEY_STORAGE_KEY = "guestMoneyCp";
const GUEST_MONEY_STORAGE_VERSION_KEY = "guestMoneyCpVersion";
const GUEST_MONEY_STORAGE_VERSION = "2";
const GUEST_ROLE_STORAGE_KEY = "guestRoleMode";
const TRADER_MODAL_UI_PREFS_KEY = "traderModalUiPrefsV1";

// ------------------------------------------------------------
// 🌐 LOCAL APP STATE
// ------------------------------------------------------------
const STATE = {
  token: localStorage.getItem("token") || "",
  user: null,
  traders: [],
  cart: [],
  reserved: [],
  inventory: [],
  activeTraderId: null,
  isBusy: false,
  guestMoneyCp: initGuestMoneyCp(),
  guestRole: initGuestRole(),
};

// ------------------------------------------------------------
// 🧰 HELPERS
// ------------------------------------------------------------
function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getEl(id) {
  return document.getElementById(id);
}

function normalizeApiList(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const candidates = [
    payload?.[key],
    payload?.items,
    payload?.results,
    payload?.data,
    payload?.data?.[key],
    payload?.data?.items,
    payload?.data?.results,
    key === "traders" ? payload?.trader_list : null,
    key === "traders" ? payload?.data?.trader_list : null,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function showToast(message) {
  const toast = getEl("toast");
  if (!toast) {
    console.log(message);
    return;
  }

  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.style.opacity = "1";
  toast.style.display = "block";

  setTimeout(() => {
    toast.style.opacity = "0";
  }, 2400);

  setTimeout(() => {
    toast.classList.add("hidden");
    toast.style.display = "none";
  }, 2800);
}

window.showToast = showToast;

function openModal(modalId) {
  const modal = getEl(modalId);
  if (modal) modal.style.display = "block";
}

function closeModal(modal) {
  if (modal) modal.style.display = "none";
}

function cpToMoneyParts(cp = 0) {
  const total = Math.max(0, safeNumber(cp, 0));
  const gold = Math.floor(total / COPPER_IN_GOLD);
  const remainderAfterGold = total % COPPER_IN_GOLD;
  const silver = Math.floor(remainderAfterGold / COPPER_IN_SILVER);
  const copper = remainderAfterGold % COPPER_IN_SILVER;
  return { gold, silver, copper };
}

function moneyPartsToCp(gold = 0, silver = 0, copper = 0) {
  return Math.max(
    0,
    safeNumber(gold, 0) * COPPER_IN_GOLD +
      safeNumber(silver, 0) * COPPER_IN_SILVER +
      safeNumber(copper, 0)
  );
}

function formatMoneyParts(gold = 0, silver = 0, copper = 0) {
  const parts = [];
  if (gold) parts.push(`${gold}з`);
  if (silver) parts.push(`${silver}с`);
  if (copper) parts.push(`${copper}м`);
  return parts.length ? parts.join(" ") : "0з";
}

function formatMoneyCp(cp = 0) {
  const { gold, silver, copper } = cpToMoneyParts(cp);
  return formatMoneyParts(gold, silver, copper);
}

function initGuestMoneyCp() {
  const raw = localStorage.getItem(GUEST_MONEY_STORAGE_KEY);

  if (raw === null || raw === undefined || raw === "") {
    localStorage.setItem(GUEST_MONEY_STORAGE_KEY, String(GUEST_START_GOLD_CP));
    localStorage.setItem(GUEST_MONEY_STORAGE_VERSION_KEY, GUEST_MONEY_STORAGE_VERSION);
    return GUEST_START_GOLD_CP;
  }

  const storedVersion = localStorage.getItem(GUEST_MONEY_STORAGE_VERSION_KEY);
  const cp = Math.max(0, safeNumber(raw, GUEST_START_GOLD_CP));

  if (storedVersion !== GUEST_MONEY_STORAGE_VERSION) {
    localStorage.setItem(GUEST_MONEY_STORAGE_KEY, String(cp));
    localStorage.setItem(GUEST_MONEY_STORAGE_VERSION_KEY, GUEST_MONEY_STORAGE_VERSION);
  }

  return cp;
}

function persistGuestMoney() {
  localStorage.setItem(
    GUEST_MONEY_STORAGE_KEY,
    String(Math.max(0, safeNumber(STATE.guestMoneyCp, GUEST_START_GOLD_CP)))
  );
  localStorage.setItem(GUEST_MONEY_STORAGE_VERSION_KEY, GUEST_MONEY_STORAGE_VERSION);
}

function initGuestRole() {
  const raw = String(localStorage.getItem(GUEST_ROLE_STORAGE_KEY) || "player")
    .trim()
    .toLowerCase();

  return raw === "gm" || raw === "admin" ? "gm" : "player";
}

function persistGuestRole() {
  localStorage.setItem(
    GUEST_ROLE_STORAGE_KEY,
    STATE.guestRole === "gm" ? "gm" : "player"
  );
}

function getDefaultTraderModalUiPrefs() {
  return {
    mainTab: "buy",
    buyCategory: "",
    buyViewMode: "table",
    sellViewMode: "table",
  };
}

function readTraderModalUiPrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRADER_MODAL_UI_PREFS_KEY) || "{}");
    const defaults = getDefaultTraderModalUiPrefs();
    const next = {
      ...defaults,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
    };

    next.mainTab = ["buy", "sell", "stats", "info"].includes(String(next.mainTab || ""))
      ? String(next.mainTab)
      : defaults.mainTab;

    next.buyCategory = String(next.buyCategory || "").trim();

    next.buyViewMode = ["table", "inventory", "grid"].includes(String(next.buyViewMode || ""))
      ? String(next.buyViewMode)
      : defaults.buyViewMode;

    next.sellViewMode = ["table", "inventory", "grid"].includes(String(next.sellViewMode || ""))
      ? String(next.sellViewMode)
      : defaults.sellViewMode;

    return next;
  } catch {
    return getDefaultTraderModalUiPrefs();
  }
}

function persistTraderModalUiPrefs(nextPrefs = {}) {
  try {
    const merged = {
      ...readTraderModalUiPrefs(),
      ...(nextPrefs && typeof nextPrefs === "object" ? nextPrefs : {}),
    };
    localStorage.setItem(TRADER_MODAL_UI_PREFS_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return getDefaultTraderModalUiPrefs();
  }
}

function getTraderModalElement() {
  return getEl("traderModal");
}

function rememberTraderModalMainTab(tabName) {
  persistTraderModalUiPrefs({ mainTab: String(tabName || "buy") });
}

function rememberTraderModalBuyCategory(categoryName) {
  persistTraderModalUiPrefs({ buyCategory: String(categoryName || "").trim() });
}

function rememberTraderModalViewMode(mode, scope = "buy") {
  const nextMode = ["table", "inventory", "grid"].includes(String(mode || ""))
    ? String(mode)
    : "table";

  if (scope === "sell") {
    persistTraderModalUiPrefs({ sellViewMode: nextMode });
    return;
  }

  persistTraderModalUiPrefs({ buyViewMode: nextMode });
}

function triggerControlChange(control) {
  if (!control) return;
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

function applyTraderModalViewModes(modal, prefs) {
  if (!modal) return;

  modal
    .querySelectorAll('#tab-buy .category-content .view-mode-inline')
    .forEach((select) => {
      if (select.value !== prefs.buyViewMode) {
        select.value = prefs.buyViewMode;
        triggerControlChange(select);
      }
    });

  modal
    .querySelectorAll('#tab-sell .view-mode-inline')
    .forEach((select) => {
      if (select.value !== prefs.sellViewMode) {
        select.value = prefs.sellViewMode;
        triggerControlChange(select);
      }
    });
}

function restoreTraderModalUiPrefs(modal = null) {
  const targetModal = modal || getTraderModalElement();
  if (!targetModal) return;

  const prefs = readTraderModalUiPrefs();

  applyTraderModalViewModes(targetModal, prefs);

  const tabBtn =
    targetModal.querySelector(`.tab-btn[data-main-tab="${prefs.mainTab}"]`) ||
    targetModal.querySelector('.tab-btn[data-main-tab="buy"]');

  if (tabBtn) {
    tabBtn.click();
  }

  const buyCategoryButtons = [...targetModal.querySelectorAll('#tab-buy .category-tab[data-cat]')];
  if (buyCategoryButtons.length) {
    const categoryBtn =
      buyCategoryButtons.find((btn) => String(btn.dataset.cat || "") === prefs.buyCategory) ||
      buyCategoryButtons[0];

    if (categoryBtn) {
      categoryBtn.click();
    }
  }

  applyTraderModalViewModes(targetModal, prefs);
}

function bindTraderModalUiPersistence() {
  const modal = getTraderModalElement();
  if (!modal || modal.dataset.boundUiPrefs === "1") return;

  modal.dataset.boundUiPrefs = "1";

  modal.addEventListener("click", (event) => {
    const tabBtn = event.target.closest(".tab-btn[data-main-tab]");
    if (tabBtn) {
      rememberTraderModalMainTab(tabBtn.dataset.mainTab);
      return;
    }

    const categoryBtn = event.target.closest(".category-tab[data-cat]");
    if (categoryBtn) {
      rememberTraderModalBuyCategory(categoryBtn.dataset.cat);
    }
  });

  modal.addEventListener("change", (event) => {
    const viewSelect = event.target.closest(".view-mode-inline");
    if (!viewSelect) return;

    const scope = viewSelect.closest("#tab-sell") ? "sell" : "buy";
    rememberTraderModalViewMode(viewSelect.value, scope);
  });
}

function getEffectiveRole() {
  const userRole = String(STATE.user?.role || "").trim().toLowerCase();
  if (userRole === "gm" || userRole === "admin") return "gm";
  if (STATE.user) return "player";
  return STATE.guestRole === "gm" ? "gm" : "player";
}

function isGuestMode() {
  return !(STATE.token && STATE.user);
}

function persistUser() {
  try {
    localStorage.setItem("user", JSON.stringify(STATE.user || null));
  } catch (_) {}
}

function restoreUserFromLocalStorage() {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.user && typeof parsed.user === "object") {
      return parsed.user;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearPersistedUser() {
  localStorage.removeItem("user");
}

function normalizeMoneyFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;

  if (payload.money_cp_total !== undefined) {
    const cp = Math.max(0, safeNumber(payload.money_cp_total, 0));
    return {
      cp,
      label: payload.money_label || formatMoneyCp(cp),
    };
  }

  if (
    payload.money_gold !== undefined ||
    payload.money_silver !== undefined ||
    payload.money_copper !== undefined
  ) {
    const cp = moneyPartsToCp(
      payload.money_gold,
      payload.money_silver,
      payload.money_copper
    );
    return {
      cp,
      label: payload.money_label || formatMoneyCp(cp),
    };
  }

  if (
    payload.gold !== undefined ||
    payload.silver !== undefined ||
    payload.copper !== undefined
  ) {
    const cp = moneyPartsToCp(payload.gold, payload.silver, payload.copper);
    return {
      cp,
      label: payload.money_label || formatMoneyCp(cp),
    };
  }

  return null;
}

function updateUserMoneyFromPayload(payload) {
  const money = normalizeMoneyFromPayload(payload);
  if (!money) return;

  if (STATE.user) {
    STATE.user.money_cp_total = money.cp;
    STATE.user.money_label = money.label;
    persistUser();
  } else {
    STATE.guestMoneyCp = money.cp;
    persistGuestMoney();
  }

  syncMoneyControls();
}

function getCurrentMoneyLabel() {
  if (STATE.user?.money_label) return STATE.user.money_label;
  if (STATE.user?.money_cp_total !== undefined) {
    return formatMoneyCp(STATE.user.money_cp_total);
  }
  return formatMoneyCp(STATE.guestMoneyCp);
}

function getCurrentMoneyCp() {
  if (STATE.user?.money_cp_total !== undefined) {
    return Math.max(0, safeNumber(STATE.user.money_cp_total, 0));
  }
  return Math.max(0, safeNumber(STATE.guestMoneyCp, GUEST_START_GOLD_CP));
}

function getCurrentMoneyGoldValue() {
  const { gold } = cpToMoneyParts(getCurrentMoneyCp());
  return gold;
}

function setGuestMoneyFromGold(goldValue) {
  const normalizedGold = Math.max(0, Math.floor(safeNumber(goldValue, GUEST_START_GOLD)));
  STATE.guestMoneyCp = moneyPartsToCp(normalizedGold, 0, 0);
  persistGuestMoney();
}

function getTraderMoneyCp(trader) {
  if (!trader) return 0;

  if (trader.money_cp_total !== undefined && trader.money_cp_total !== null) {
    return Math.max(0, safeNumber(trader.money_cp_total, 0));
  }

  if (trader.gold_numeric !== undefined && trader.gold_numeric !== null) {
    return moneyPartsToCp(trader.gold_numeric, 0, 0);
  }

  if (
    trader.gold !== undefined ||
    trader.silver !== undefined ||
    trader.copper !== undefined
  ) {
    return moneyPartsToCp(
      safeNumber(trader.gold, 0),
      safeNumber(trader.silver, 0),
      safeNumber(trader.copper, 0)
    );
  }

  return 0;
}

function setTraderMoneyCp(trader, cp) {
  if (!trader) return;

  const normalizedCp = Math.max(0, safeNumber(cp, 0));
  const parts = cpToMoneyParts(normalizedCp);
  const label = formatMoneyParts(parts.gold, parts.silver, parts.copper);

  trader.money_cp_total = normalizedCp;
  trader.gold_numeric = parts.gold;
  trader.gold = parts.gold;
  trader.silver = parts.silver;
  trader.copper = parts.copper;
  trader.money_gold = parts.gold;
  trader.money_silver = parts.silver;
  trader.money_copper = parts.copper;
  trader.gold_label = label;
  trader.money_label = label;
}

function logTradeSnapshot(action, payload) {
  console.log(`[TRADE:${action}]`, payload);
}

function setAppLoadingStatus(message) {
  try {
    if (typeof window.__setAppLoadingStatus === "function") {
      window.__setAppLoadingStatus(String(message || "Загрузка..."));
    }
  } catch (_) {}
}

function hideAppLoadingOverlay() {
  try {
    if (typeof window.__hideAppLoadingOverlay === "function") {
      window.__hideAppLoadingOverlay();
    }
  } catch (_) {}
}

async function syncOpenTraderModalIfVisible(preferredTraderId = null) {
  const modal = getEl("traderModal");
  if (!modal || modal.style.display !== "block") return;

  const targetId = preferredTraderId != null
    ? Number(preferredTraderId)
    : Number(STATE.activeTraderId);

  if (!Number.isFinite(targetId)) return;
  await renderOpenTraderModal(targetId);
  restoreTraderModalUiPrefs();
}

// ------------------------------------------------------------
// 🔗 GLOBAL BRIDGES
// ------------------------------------------------------------
function syncGlobalStateBridges() {
  const effectiveRole = getEffectiveRole();

  window.__appState = STATE;
  window.__appCartState = STATE.cart;
  window.__appStateInventory = STATE.inventory;
  window.__appStateReserved = STATE.reserved;
  window.__appStateTraders = STATE.traders;
  window.__appUser = STATE.user;
  window.__appUserRole = effectiveRole;
  window.__userRole = effectiveRole;

  document.body.dataset.role = effectiveRole;

  window.getReservedItems = () => STATE.reserved;
}

function syncMoneyControls() {
  const playerGoldInput = getEl("playerGoldInput");
  const updateGoldBtn = getEl("updateGoldBtn");
  const resetGoldBtn = getEl("resetGoldBtn");
  const userMoney = getEl("user-money");

  const goldValue = getCurrentMoneyGoldValue();
  const moneyLabel = getCurrentMoneyLabel();
  const guestMode = isGuestMode();

  if (playerGoldInput) {
    playerGoldInput.value = String(goldValue);
    playerGoldInput.disabled = !guestMode || STATE.isBusy;
    playerGoldInput.title = guestMode ? "Текущее золото в гостевом режиме" : moneyLabel;
  }

  if (updateGoldBtn) {
    updateGoldBtn.disabled = !guestMode || STATE.isBusy;
  }

  if (resetGoldBtn) {
    resetGoldBtn.disabled = !guestMode || STATE.isBusy;
  }

  if (userMoney) {
    userMoney.classList.remove("hidden");
    userMoney.textContent = moneyLabel;
  }
}

function applyGuestMoneyUpdateFromInput() {
  if (!isGuestMode()) {
    showToast("Тестовое золото доступно только в гостевом режиме");
    syncMoneyControls();
    return;
  }

  const playerGoldInput = getEl("playerGoldInput");
  if (!playerGoldInput) return;

  const inputGold = Math.max(0, Math.floor(safeNumber(playerGoldInput.value, GUEST_START_GOLD)));
  setGuestMoneyFromGold(inputGold);
  renderAllLocalState();
  syncMoneyControls();

  logTradeSnapshot("UPDATE_GOLD", {
    goldInput: inputGold,
    moneyCp: getCurrentMoneyCp(),
    moneyLabel: getCurrentMoneyLabel(),
  });

  showToast(`Ваше золото обновлено: ${getCurrentMoneyLabel()}`);
}

function resetGuestMoney() {
  if (!isGuestMode()) {
    showToast("Сброс тестового золота доступен только в гостевом режиме");
    syncMoneyControls();
    return;
  }

  setGuestMoneyFromGold(GUEST_START_GOLD);
  renderAllLocalState();
  syncMoneyControls();

  logTradeSnapshot("RESET_GOLD", {
    moneyCp: getCurrentMoneyCp(),
    moneyLabel: getCurrentMoneyLabel(),
  });

  showToast(`Золото сброшено: ${getCurrentMoneyLabel()}`);
}

function setBusy(flag) {
  STATE.isBusy = Boolean(flag);

  [
    "checkoutCartBtn",
    "clearCartBtn",
    "clearCartBtnModal",
    "refreshDataBtn",
    "doLogin",
    "doRegister",
    "updateGoldBtn",
    "resetGoldBtn",
  ].forEach((id) => {
    const el = getEl(id);
    if (!el) return;

    if (id === "updateGoldBtn" || id === "resetGoldBtn") {
      el.disabled = STATE.isBusy || !isGuestMode();
      return;
    }

    el.disabled = STATE.isBusy;
  });

  const playerGoldInput = getEl("playerGoldInput");
  if (playerGoldInput) {
    playerGoldInput.disabled = STATE.isBusy || !isGuestMode();
  }
}

// ------------------------------------------------------------
// 📦 NORMALIZERS
// ------------------------------------------------------------
function normalizeTraderItem(item) {
  const stock = Math.max(0, safeNumber(item?.stock ?? item?.quantity ?? 0, 0));

  const priceGold = safeNumber(item?.price_gold ?? item?.buy_price_gold, 0);
  const priceSilver = safeNumber(item?.price_silver ?? item?.buy_price_silver, 0);
  const priceCopper = safeNumber(item?.price_copper ?? item?.buy_price_copper, 0);

  return {
    ...item,
    id: Number(item?.id || item?.item_id),
    item_id: Number(item?.item_id || item?.id),
    stock,
    quantity: stock,
    price_gold: priceGold,
    price_silver: priceSilver,
    price_copper: priceCopper,
    buy_price_gold: safeNumber(item?.buy_price_gold ?? priceGold, 0),
    buy_price_silver: safeNumber(item?.buy_price_silver ?? priceSilver, 0),
    buy_price_copper: safeNumber(item?.buy_price_copper ?? priceCopper, 0),
    sell_price_gold: safeNumber(item?.sell_price_gold, 0),
    sell_price_silver: safeNumber(item?.sell_price_silver, 0),
    sell_price_copper: safeNumber(item?.sell_price_copper, 0),
    category: item?.category || item?.category_clean || "",
  };
}

function normalizeTrader(trader) {
  const normalized = {
    ...trader,
    id: Number(trader?.id),
    reputation: safeNumber(trader?.reputation, 0),
    level_min: safeNumber(trader?.level_min, 0),
    level_max: safeNumber(trader?.level_max, 999),
    items: Array.isArray(trader?.items)
      ? trader.items.map((item) => normalizeTraderItem(item))
      : [],
  };

  const traderMoneyCp =
    trader?.money_cp_total !== undefined
      ? Math.max(0, safeNumber(trader.money_cp_total, 0))
      : moneyPartsToCp(
          safeNumber(trader?.gold, 0),
          safeNumber(trader?.silver, 0),
          safeNumber(trader?.copper, 0)
        );

  setTraderMoneyCp(normalized, traderMoneyCp);
  return normalized;
}

function normalizeInventoryItem(item) {
  return {
    ...item,
    id: Number(item.id || item.item_id),
    item_id: Number(item.item_id || item.id),
    trader_id: item.trader_id != null ? Number(item.trader_id) : null,
    quantity: Math.max(1, safeNumber(item.quantity, 1)),
    price_gold: safeNumber(item.price_gold, 0),
    price_silver: safeNumber(item.price_silver, 0),
    price_copper: safeNumber(item.price_copper, 0),
    buy_price_gold: safeNumber(item.buy_price_gold ?? item.price_gold, 0),
    buy_price_silver: safeNumber(item.buy_price_silver ?? item.price_silver, 0),
    buy_price_copper: safeNumber(item.buy_price_copper ?? item.price_copper, 0),
    sell_price_gold: safeNumber(item.sell_price_gold, 0),
    sell_price_silver: safeNumber(item.sell_price_silver, 0),
    sell_price_copper: safeNumber(item.sell_price_copper, 0),
  };
}

function getTraderById(traderId) {
  return STATE.traders.find((t) => Number(t.id) === Number(traderId)) || null;
}

function upsertTrader(trader) {
  if (!trader) return null;

  const normalized = normalizeTrader(trader);
  const index = STATE.traders.findIndex(
    (entry) => Number(entry.id) === Number(normalized.id)
  );

  if (index >= 0) {
    STATE.traders[index] = normalized;
  } else {
    STATE.traders.push(normalized);
  }

  syncGlobalStateBridges();
  return normalized;
}

async function refreshTraderById(traderId) {
  const id = Number(traderId);
  if (!Number.isFinite(id)) return null;

  try {
    const payload = await fetchTraderById(id);
    const trader = payload?.trader || payload;
    if (!trader || typeof trader !== "object") return null;
    return upsertTrader(trader);
  } catch (error) {
    console.warn("Не удалось обновить торговца по API:", error);
    return null;
  }
}

function getTraderItem(traderId, itemId) {
  const trader = getTraderById(traderId);
  if (!trader || !Array.isArray(trader.items)) return null;
  return trader.items.find((item) => Number(item.id) === Number(itemId)) || null;
}

function getCollectionItemPriceFields(item) {
  const priceGold = safeNumber(item.price_gold ?? item.buy_price_gold, 0);
  const priceSilver = safeNumber(item.price_silver ?? item.buy_price_silver, 0);
  const priceCopper = safeNumber(item.price_copper ?? item.buy_price_copper, 0);

  return {
    price_gold: priceGold,
    price_silver: priceSilver,
    price_copper: priceCopper,
  };
}

function normalizeCollectionItem(traderId, item, quantity = 1) {
  const { price_gold, price_silver, price_copper } = getCollectionItemPriceFields(item);

  return {
    ...item,
    id: Number(item.id || item.item_id),
    item_id: Number(item.item_id || item.id),
    trader_id: traderId != null ? Number(traderId) : null,
    quantity: Math.max(1, safeNumber(quantity, 1)),
    price_gold,
    price_silver,
    price_copper,
    buy_price_gold: safeNumber(item.buy_price_gold ?? price_gold, 0),
    buy_price_silver: safeNumber(item.buy_price_silver ?? price_silver, 0),
    buy_price_copper: safeNumber(item.buy_price_copper ?? price_copper, 0),
    stock: Math.max(0, safeNumber(item.stock ?? item.quantity, 0)),
  };
}

function getTraderMoneyFromTradePayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return normalizeMoneyFromPayload({
    money_cp_total: payload.trader_money_cp ?? payload.trader_cp_total ?? undefined,
    money_gold: payload.trader_money_gold ?? payload.trader_gold ?? undefined,
    money_silver: payload.trader_money_silver ?? payload.trader_silver ?? undefined,
    money_copper: payload.trader_money_copper ?? payload.trader_copper ?? undefined,
    money_label: payload.trader_money_label ?? payload.trader_gold_label ?? undefined,
  });
}

function getCartEntryTotalCp(item) {
  return (
    moneyPartsToCp(item.price_gold, item.price_silver, item.price_copper) *
    Math.max(1, safeNumber(item.quantity, 1))
  );
}

function getCartTotalCp() {
  return STATE.cart.reduce((sum, item) => sum + getCartEntryTotalCp(item), 0);
}

function getCartTotalUnits() {
  return STATE.cart.reduce(
    (sum, entry) => sum + Math.max(1, safeNumber(entry.quantity, 1)),
    0
  );
}

function getSellTotalCp(item, quantity = 1) {
  const priceCp = moneyPartsToCp(
    item.sell_price_gold ?? 0,
    item.sell_price_silver ?? 0,
    item.sell_price_copper ?? 0
  );
  return priceCp * Math.max(1, safeNumber(quantity, 1));
}

function ensureGuestSellPrices(item, traderId = null) {
  if (
    safeNumber(item.sell_price_gold, 0) ||
    safeNumber(item.sell_price_silver, 0) ||
    safeNumber(item.sell_price_copper, 0)
  ) {
    return item;
  }

  const trader = traderId != null ? getTraderById(traderId) : null;
  const reputation = Math.max(0, Math.min(100, safeNumber(trader?.reputation, 0)));
  const baseCp = moneyPartsToCp(item.price_gold, item.price_silver, item.price_copper);

  const multiplier = 0.5 + (0.3 * (reputation / 100));
  const sellCp = Math.max(1, Math.round(baseCp * multiplier));
  const parts = cpToMoneyParts(sellCp);

  item.sell_price_gold = parts.gold;
  item.sell_price_silver = parts.silver;
  item.sell_price_copper = parts.copper;
  item.sell_price_label = formatMoneyParts(parts.gold, parts.silver, parts.copper);

  return item;
}

function patchTraderFromTradePayload(traderId, itemId, payload, quantity, action) {
  const trader = getTraderById(traderId);
  if (!trader || !payload || typeof payload !== "object") return;

  const traderItem = getTraderItem(traderId, itemId);
  const delta = Math.max(1, safeNumber(quantity, 1));

  const traderMoney = normalizeMoneyFromPayload({
    money_cp_total: payload.trader_money_cp ?? payload.trader_cp_total ?? undefined,
    money_gold: payload.trader_money_gold ?? payload.trader_gold ?? undefined,
    money_silver: payload.trader_money_silver ?? payload.trader_silver ?? undefined,
    money_copper: payload.trader_money_copper ?? payload.trader_copper ?? undefined,
    money_label: payload.trader_money_label ?? payload.trader_gold_label ?? undefined,
  });

  if (traderMoney) {
    setTraderMoneyCp(trader, traderMoney.cp);
  } else {
    const itemMoneyCp = traderItem
      ? (action === "sell"
          ? getSellTotalCp(traderItem, delta)
          : moneyPartsToCp(
              traderItem.buy_price_gold ?? traderItem.price_gold,
              traderItem.buy_price_silver ?? traderItem.price_silver,
              traderItem.buy_price_copper ?? traderItem.price_copper
            ) * delta)
      : 0;

    if (itemMoneyCp > 0) {
      const currentTraderMoneyCp = getTraderMoneyCp(trader);
      const nextTraderMoneyCp = action === "sell"
        ? Math.max(0, currentTraderMoneyCp - itemMoneyCp)
        : currentTraderMoneyCp + itemMoneyCp;

      setTraderMoneyCp(trader, nextTraderMoneyCp);
    }
  }

  if (traderItem) {
    if (payload.trader_stock !== undefined) {
      const stock = Math.max(0, safeNumber(payload.trader_stock, 0));
      traderItem.stock = stock;
      traderItem.quantity = stock;
    } else {
      if (action === "buy") {
        const nextStock = Math.max(0, safeNumber(traderItem.stock ?? traderItem.quantity, 0) - delta);
        traderItem.stock = nextStock;
        traderItem.quantity = nextStock;
      } else if (action === "sell") {
        const nextStock = Math.max(0, safeNumber(traderItem.stock ?? traderItem.quantity, 0) + delta);
        traderItem.stock = nextStock;
        traderItem.quantity = nextStock;
      }
    }
  }

  syncGlobalStateBridges();
}

// ------------------------------------------------------------
// 👤 UI STATE
// ------------------------------------------------------------
function updateUserUI() {
  const guestWarning = getEl("guestWarning");
  const logoutBtn = getEl("logoutBtn");
  const showAuthBtn = getEl("showAuthBtn");
  const authContainer = getEl("authContainer");
  const userMoney = getEl("user-money");
  const gmBadge = getEl("gmBadge");

  const effectiveRole = getEffectiveRole();
  const roleText = effectiveRole === "gm" ? "🎭 ГМ" : "👤 Игрок";

  if (STATE.user) {
    guestWarning?.classList.add("hidden");
    logoutBtn?.classList.remove("hidden");
    showAuthBtn?.classList.add("hidden");
    authContainer?.classList.add("hidden");

    if (userMoney) {
      userMoney.classList.remove("hidden");
      userMoney.innerText = getCurrentMoneyLabel();
    }

    if (gmBadge) {
      gmBadge.textContent = roleText;
      gmBadge.title = "Роль берётся из аккаунта";
      gmBadge.style.cursor = "default";
      gmBadge.dataset.mode = "account";
    }
  } else {
    guestWarning?.classList.remove("hidden");
    logoutBtn?.classList.add("hidden");
    showAuthBtn?.classList.remove("hidden");
    authContainer?.classList.add("hidden");

    if (userMoney) {
      userMoney.classList.remove("hidden");
      userMoney.innerText = getCurrentMoneyLabel();
    }

    if (gmBadge) {
      gmBadge.textContent = roleText;
      gmBadge.title = "Клик для переключения Игрок / ГМ";
      gmBadge.style.cursor = "pointer";
      gmBadge.dataset.mode = "guest-switch";
    }
  }

  syncMoneyControls();
  syncGlobalStateBridges();
}

function updateCartCounter() {
  const count = Array.isArray(STATE.cart)
    ? STATE.cart.reduce((sum, item) => sum + safeNumber(item.quantity, 1), 0)
    : 0;

  if (getEl("cartCount")) getEl("cartCount").innerText = String(count);
  if (getEl("cartCountModal")) getEl("cartCountModal").innerText = String(count);
}

function updateInventoryCounter() {
  const count = Array.isArray(STATE.inventory)
    ? STATE.inventory.reduce((sum, item) => sum + safeNumber(item.quantity, 0), 0)
    : 0;

  if (getEl("inventoryCount")) getEl("inventoryCount").innerText = String(count);
  if (getEl("inventoryCountModal")) getEl("inventoryCountModal").innerText = String(count);
}

function updateCartTotalLabels() {
  const label = formatMoneyCp(getCartTotalCp());

  if (getEl("cart-total")) getEl("cart-total").innerText = label;
  if (getEl("cartTotalModal")) getEl("cartTotalModal").innerText = label;
}

function renderAllLocalState() {
  syncGlobalStateBridges();
  renderCart(STATE.cart);
  renderInventory(STATE.inventory);
  updateCartCounter();
  updateCartTotalLabels();
  updateInventoryCounter();
  updateUserUI();
}

function applyExternalUserUpdate(user) {
  if (!user || typeof user !== "object") return;
  STATE.user = {
    ...(STATE.user && typeof STATE.user === "object" ? STATE.user : {}),
    ...user,
  };
  persistUser();
  syncGlobalStateBridges();
  updateUserUI();
}

// ------------------------------------------------------------
// 🔎 FILTERS
// ------------------------------------------------------------
function rerenderTraders() {
  const filters = collectFilters(getEl, safeNumber);
  const filtered = sortTraders(
    STATE.traders.filter((trader) => traderMatchesFilters(trader, filters, safeNumber)),
    filters.sortValue,
    safeNumber
  );
  syncGlobalStateBridges();
  renderTraders(filtered);
}

// ------------------------------------------------------------
// 📥 LOADERS
// ------------------------------------------------------------
async function loadTraders() {
  const data = await fetchTraders();
  STATE.traders = normalizeApiList(data, "traders").map((trader) => normalizeTrader(trader));
  populateFilterOptions(STATE.traders, getEl);
  syncGlobalStateBridges();
  rerenderTraders();
}

async function loadInventoryFromServer() {
  if (!STATE.token) return;

  try {
    const data = await fetchPlayerInventory();
    STATE.inventory = normalizeApiList(data, "items").map((item) => normalizeInventoryItem(item));
    updateUserMoneyFromPayload(data);
    syncGlobalStateBridges();
  } catch (error) {
    console.warn("Не удалось загрузить inventory из API:", error);
  }
}

// ------------------------------------------------------------
// 🔐 AUTH
// ------------------------------------------------------------
const {
  fetchMeSafe,
  handleLogin,
  handleRegister,
  handleLogout,
} = createAuthActions({
  state: STATE,
  getEl,
  showToast,
  setBusy,
  loginUser,
  registerUser,
  fetchMe,
  logoutUser,
  clearPersistedUser,
  persistUser,
  normalizeMoneyFromPayload,
  syncGlobalStateBridges,
  updateUserUI,
  loadTraders,
  loadInventoryFromServer,
  renderAllLocalState,
  initCabinetModulesIfNeeded,
});

// ------------------------------------------------------------
// 🧾 CABINET
// ------------------------------------------------------------
let cabinetModulesInitialized = false;

async function initCabinetModulesIfNeeded() {
  syncGlobalStateBridges();

  if (!cabinetModulesInitialized) {
    initCabinet();
    cabinetModulesInitialized = true;
  }

  try {
    await Promise.allSettled([
      typeof questsModule?.loadQuests === "function"
        ? questsModule.loadQuests()
        : Promise.resolve(),
      typeof playerNotesModule?.loadPlayerNotes === "function"
        ? playerNotesModule.loadPlayerNotes()
        : Promise.resolve(),
    ]);
  } catch (_) {}
}

// ------------------------------------------------------------
// 🎭 TEMP ROLE SWITCH
// ------------------------------------------------------------
async function toggleGuestRole() {
  if (!isGuestMode()) {
    showToast("После авторизации роль берётся из аккаунта");
    return;
  }

  STATE.guestRole = STATE.guestRole === "gm" ? "player" : "gm";
  persistGuestRole();

  syncGlobalStateBridges();
  updateUserUI();
  rerenderTraders();

  const cabinetModal = getEl("cabinetModal");
  if (cabinetModal && cabinetModal.style.display === "block") {
    await initCabinetModulesIfNeeded();
    openCabinet();
  }

  if (STATE.activeTraderId != null) {
    await window.openTraderModal(STATE.activeTraderId);
  }

  showToast(STATE.guestRole === "gm" ? "Режим ГМа включён" : "Режим игрока включён");
}

function bindRoleSwitchButton() {
  const gmBadge = getEl("gmBadge");
  if (!gmBadge || gmBadge.dataset.boundRoleSwitch === "1") return;

  gmBadge.dataset.boundRoleSwitch = "1";
  gmBadge.addEventListener("click", async () => {
    await toggleGuestRole();
  });
}

// ------------------------------------------------------------
// 🔘 BINDINGS
// ------------------------------------------------------------

// ------------------------------------------------------------
// 🛒 GLOBAL ACTIONS
// ------------------------------------------------------------
// Маршрут открытия модалки торговца:
// 1) фиксируем activeTraderId
// 2) если есть токен — подтягиваем свежие данные с сервера
// 3) рендерим модалку
// 4) восстанавливаем UI-предпочтения (вкладки/вид)
window.openTraderModal = createOpenTraderModalAction({
  state: STATE,
  refreshTraderById,
  syncGlobalStateBridges,
  renderOpenTraderModal,
  restoreTraderModalUiPrefs,
});

window.openTrader = window.openTraderModal;

window.restockTrader = createRestockTraderAction({
  state: STATE,
  showToast,
  getEffectiveRole,
  getTraderById,
  safeNumber,
  getNextRestockStock,
  handleGuestRestockFlow,
  handleServerRestockFlow,
  apiRestockTrader,
  upsertTrader,
  refreshTraderById,
  syncBusyUiState,
  renderAllLocalState,
  openTraderModal: window.openTraderModal,
});

Object.assign(
  window,
  createInventoryActions({
    state: STATE,
    safeNumber,
    showToast,
    syncGlobalStateBridges,
    renderAllLocalState,
    renderCart,
    getTraderItem,
    normalizeCollectionItem,
  })
);

// ------------------------------------------------------------
// 💸 BUY / SELL
// ------------------------------------------------------------
Object.assign(
  window,
  createTradeActions({
    state: STATE,
    safeNumber,
    moneyPartsToCp,
    formatMoneyCp,
    getCurrentMoneyCp,
    getCurrentMoneyLabel,
    getTraderById,
    getTraderItem,
    getTraderMoneyCp,
    setTraderMoneyCp,
    findInventoryIndexByItemId,
    findInventoryItemById,
    getSellTotalCp,
    normalizeInventoryItem,
    ensureGuestSellPrices,
    persistGuestMoney,
    apiBuyItem,
    apiSellItem,
    updateUserMoneyFromPayload,
    patchTraderFromTradePayload,
    loadInventoryFromServer,
    refreshTraderById,
    getTraderMoneyFromTradePayload,
    setBusy,
    renderAllLocalState,
    rerenderTraders,
    syncOpenTraderModalIfVisible,
    showToast,
    logTradeSnapshot,
    syncGlobalStateBridges,
    findCartItemByTraderAndItemId,
    consumeCollectionEntry,
    getCartTotalUnits,
  })
);

// ------------------------------------------------------------
// 🚀 INIT
// ------------------------------------------------------------
async function initApp() {
  setAppLoadingStatus("Поднимаем интерфейс...");

  try {
    STATE.user = restoreUserFromLocalStorage();
    STATE.token = localStorage.getItem("token") || "";

    syncGlobalStateBridges();
    updateUserUI();

    bindToolbarButtons({
      getEl,
      state: STATE,
      renderCart,
      updateCartCounter,
      updateCartTotalLabels,
      openModal,
      syncGlobalStateBridges,
      renderAllLocalState,
      showToast,
      renderInventory,
      updateInventoryCounter,
      initCabinetModulesIfNeeded,
      openCabinet,
      loadTraders,
      loadInventoryFromServer,
    });
    bindAuthButtons({ getEl, handleLogout, handleLogin, handleRegister });
    bindModalButtons(closeModal);
    bindFilterEvents(getEl, rerenderTraders);
    bindTraderDelegation({
      openTraderModal: window.openTraderModal,
      restockTrader: window.restockTrader,
    });
    bindMoneyControls({
      getEl,
      applyGuestMoneyUpdateFromInput,
      resetGuestMoney,
      syncMoneyControls,
    });
    bindRoleSwitchButton();
    bindTraderModalUiPersistence();

    window.addEventListener("dnd:user:updated", (event) => {
      applyExternalUserUpdate(event?.detail?.user);
    });

    if (STATE.token && !STATE.user) {
      setAppLoadingStatus("Проверяем профиль...");
      const me = await fetchMeSafe();
      if (me && typeof me === "object") {
        STATE.user = me;
        persistUser();
        syncGlobalStateBridges();
        updateUserUI();
      }
    }

    try {
      setAppLoadingStatus("Загружаем торговцев...");
      await loadTraders();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Не удалось загрузить торговцев");
    }

    if (STATE.token) {
      setAppLoadingStatus("Синхронизируем инвентарь...");
      await loadInventoryFromServer();
    }

    setAppLoadingStatus("Подготавливаем кабинет...");
    renderAllLocalState();
    await initCabinetModulesIfNeeded();
  } finally {
    renderAllLocalState();
    hideAppLoadingOverlay();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp, { once: true });
} else {
  initApp();
}
