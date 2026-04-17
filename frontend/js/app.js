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
    return parsed && typeof parsed === "object" ? parsed : null;
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

function getCollectionKey(traderId, itemId) {
  return `${traderId ?? "none"}:${Number(itemId)}`;
}

function findCollectionItemIndex(collection, traderId, itemId) {
  const key = getCollectionKey(traderId, itemId);
  return collection.findIndex(
    (entry) => getCollectionKey(entry.trader_id, entry.item_id || entry.id) === key
  );
}

function consumeCollectionEntry(collection, traderId, itemId, quantity = 1) {
  const index = findCollectionItemIndex(collection, traderId, itemId);
  if (index < 0) return null;

  const currentQty = Math.max(1, safeNumber(collection[index]?.quantity, 1));
  const delta = Math.max(1, safeNumber(quantity, 1));

  if (currentQty <= delta) {
    const [removed] = collection.splice(index, 1);
    return removed || null;
  }

  collection[index].quantity = currentQty - delta;
  return collection[index];
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

// ------------------------------------------------------------
// 🔎 FILTERS
// ------------------------------------------------------------
function populateFilterOptions(traders) {
  const typeFilter = getEl("typeFilter");
  const regionFilter = getEl("regionFilter");
  const categoryFilter = getEl("categoryFilter");

  if (typeFilter) {
    const types = [...new Set(traders.map((t) => t.type).filter(Boolean))].sort(
      (a, b) => String(a).localeCompare(String(b), "ru")
    );

    typeFilter.innerHTML = `<option value="">Все типы</option>`;
    for (const type of types) {
      const option = document.createElement("option");
      option.value = String(type);
      option.textContent = String(type);
      typeFilter.appendChild(option);
    }
  }

  if (regionFilter) {
    const regions = [...new Set(traders.map((t) => t.region).filter(Boolean))].sort(
      (a, b) => String(a).localeCompare(String(b), "ru")
    );

    regionFilter.innerHTML = `<option value="">Все регионы</option>`;
    for (const region of regions) {
      const option = document.createElement("option");
      option.value = String(region);
      option.textContent = String(region);
      regionFilter.appendChild(option);
    }
  }

  if (categoryFilter) {
    const categories = new Set();

    for (const trader of traders) {
      for (const item of trader.items || []) {
        const category = item.category || item.category_clean;
        if (category) categories.add(category);
      }
    }

    categoryFilter.innerHTML = `<option value="">Любая</option>`;
    for (const category of [...categories].sort((a, b) =>
      String(a).localeCompare(String(b), "ru")
    )) {
      const option = document.createElement("option");
      option.value = String(category);
      option.textContent = String(category);
      categoryFilter.appendChild(option);
    }
  }
}

function itemPassesFilters(item, filters) {
  const itemName = String(item.name || "").toLowerCase();
  const itemPrice = safeNumber(item.price_gold ?? item.buy_price_gold, 0);
  const itemCategory = String(item.category || item.category_clean || "");
  const itemRarity = String(item.rarity || "");
  const isMagical = Boolean(item.is_magical);

  if (filters.itemSearch && !itemName.includes(filters.itemSearch)) return false;
  if (filters.rarity && itemRarity !== filters.rarity) return false;
  if (filters.category && itemCategory !== filters.category) return false;
  if (filters.magicFilter === "magic" && !isMagical) return false;
  if (filters.magicFilter === "mundane" && isMagical) return false;
  if (filters.priceMin !== null && itemPrice < filters.priceMin) return false;
  if (filters.priceMax !== null && itemPrice > filters.priceMax) return false;

  return true;
}

function collectFilters() {
  return {
    traderSearch: String(getEl("searchInput")?.value || "").trim().toLowerCase(),
    itemSearch: String(getEl("itemSearchInput")?.value || "").trim().toLowerCase(),
    type: String(getEl("typeFilter")?.value || ""),
    region: String(getEl("regionFilter")?.value || ""),
    rarity: String(getEl("rarityFilter")?.value || ""),
    category: String(getEl("categoryFilter")?.value || ""),
    magicFilter: String(getEl("magicFilter")?.value || ""),
    playerLevel: safeNumber(getEl("playerLevelFilter")?.value, 0),
    reputation: safeNumber(getEl("reputationFilter")?.value, 0),
    priceMin: getEl("priceMin")?.value === "" ? null : safeNumber(getEl("priceMin")?.value, 0),
    priceMax: getEl("priceMax")?.value === "" ? null : safeNumber(getEl("priceMax")?.value, 0),
    sortValue: String(getEl("sortFilter")?.value || "name_asc"),
  };
}

function traderMatchesFilters(trader, filters) {
  if (filters.traderSearch) {
    const byName = String(trader.name || "").toLowerCase().includes(filters.traderSearch);
    const byDesc = String(trader.description || "").toLowerCase().includes(filters.traderSearch);
    if (!byName && !byDesc) return false;
  }

  if (filters.type && String(trader.type || "") !== filters.type) return false;
  if (filters.region && String(trader.region || "") !== filters.region) return false;
  if (filters.reputation && safeNumber(trader.reputation, 0) < filters.reputation) return false;

  if (filters.playerLevel > 0) {
    const min = safeNumber(trader.level_min, 0);
    const max = safeNumber(trader.level_max, 999);
    if (filters.playerLevel < min || filters.playerLevel > max) return false;
  }

  const items = Array.isArray(trader.items) ? trader.items : [];

  const noItemFilters =
    !filters.itemSearch &&
    !filters.rarity &&
    !filters.category &&
    !filters.magicFilter &&
    filters.priceMin === null &&
    filters.priceMax === null;

  if (noItemFilters) return true;

  return items.some((item) => itemPassesFilters(item, filters));
}

function sortTraders(traders, sortValue) {
  const list = [...traders];

  if (sortValue === "name_asc") {
    list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
  } else if (sortValue === "price_asc") {
    list.sort((a, b) => {
      const aMin = Math.min(
        ...(a.items || []).map((i) => safeNumber(i.price_gold ?? i.buy_price_gold, 0)),
        Infinity
      );
      const bMin = Math.min(
        ...(b.items || []).map((i) => safeNumber(i.price_gold ?? i.buy_price_gold, 0)),
        Infinity
      );
      return aMin - bMin;
    });
  } else if (sortValue === "price_desc") {
    list.sort((a, b) => {
      const aMax = Math.max(
        ...(a.items || []).map((i) => safeNumber(i.price_gold ?? i.buy_price_gold, 0)),
        0
      );
      const bMax = Math.max(
        ...(b.items || []).map((i) => safeNumber(i.price_gold ?? i.buy_price_gold, 0)),
        0
      );
      return bMax - aMax;
    });
  } else if (sortValue === "reputation_desc") {
    list.sort((a, b) => safeNumber(b.reputation, 0) - safeNumber(a.reputation, 0));
  }

  return list;
}

function rerenderTraders() {
  const filters = collectFilters();
  const filtered = sortTraders(
    STATE.traders.filter((trader) => traderMatchesFilters(trader, filters)),
    filters.sortValue
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
  populateFilterOptions(STATE.traders);
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
async function fetchMeSafe() {
  try {
    return await fetchMe();
  } catch {
    return null;
  }
}

async function handleLogin() {
  const email = String(getEl("loginEmail")?.value || "").trim();
  const password = String(getEl("loginPassword")?.value || "");

  if (!email || !password) {
    showToast("Введите email и пароль");
    return;
  }

  try {
    setBusy(true);

    const payload = await loginUser(email, password);
    STATE.token = localStorage.getItem("token") || "";

    const me = (await fetchMeSafe()) || payload?.user || payload?.me || null;
    STATE.user = me && typeof me === "object" ? me : { email };

    if (STATE.user.money_cp_total === undefined && STATE.user.money_label === undefined) {
      const fallbackMoney = normalizeMoneyFromPayload(payload);
      if (fallbackMoney) {
        STATE.user.money_cp_total = fallbackMoney.cp;
        STATE.user.money_label = fallbackMoney.label;
      }
    }

    persistUser();
    syncGlobalStateBridges();
    updateUserUI();

    await loadTraders();
    await loadInventoryFromServer();
    renderAllLocalState();
    await initCabinetModulesIfNeeded();

    showToast("Вход выполнен");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Ошибка входа");
  } finally {
    setBusy(false);
  }
}

async function handleRegister() {
  const email = String(getEl("loginEmail")?.value || "").trim();
  const password = String(getEl("loginPassword")?.value || "");

  if (!email || !password) {
    showToast("Введите email и пароль");
    return;
  }

  try {
    setBusy(true);
    await registerUser(email, password);
    showToast("Регистрация успешна. Теперь войдите.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Ошибка регистрации");
  } finally {
    setBusy(false);
  }
}

function handleLogout() {
  STATE.token = "";
  STATE.user = null;
  STATE.inventory = [];
  STATE.cart = [];
  STATE.reserved = [];

  logoutUser();
  clearPersistedUser();

  syncGlobalStateBridges();
  updateUserUI();
  renderAllLocalState();
  showToast("Вы вышли");
}

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
function bindToolbarButtons() {
  getEl("viewCartBtn")?.addEventListener("click", () => {
    renderCart(STATE.cart);
    updateCartCounter();
    updateCartTotalLabels();
    openModal("cartModal");
  });

  getEl("clearCartBtn")?.addEventListener("click", () => {
    if (!confirm("Очистить корзину полностью?")) return;
    STATE.cart = [];
    syncGlobalStateBridges();
    renderAllLocalState();
    showToast("Корзина очищена");
  });

  getEl("clearCartBtnModal")?.addEventListener("click", () => {
    if (!confirm("Очистить корзину полностью?")) return;
    STATE.cart = [];
    syncGlobalStateBridges();
    renderAllLocalState();
    showToast("Корзина очищена");
  });

  getEl("checkoutCartBtn")?.addEventListener("click", async () => {
    await window.checkoutCart();
  });

  getEl("viewInventoryBtn")?.addEventListener("click", () => {
    renderInventory(STATE.inventory);
    updateInventoryCounter();
    openModal("inventoryModal");
  });

  getEl("cabinetBtn")?.addEventListener("click", async () => {
    await initCabinetModulesIfNeeded();
    openCabinet();
  });

  getEl("refreshDataBtn")?.addEventListener("click", async () => {
    await loadTraders();
    if (STATE.token) await loadInventoryFromServer();
    renderAllLocalState();
    showToast("Данные обновлены");
  });
}

function bindAuthButtons() {
  getEl("showAuthBtn")?.addEventListener("click", () => {
    getEl("authContainer")?.classList.toggle("hidden");
  });

  getEl("logoutBtn")?.addEventListener("click", handleLogout);
  getEl("doLogin")?.addEventListener("click", handleLogin);
  getEl("doRegister")?.addEventListener("click", handleRegister);
}

function bindModalButtons() {
  document.querySelectorAll(".close").forEach((btn) => {
    if (btn.dataset.boundModalClose === "1") return;
    btn.dataset.boundModalClose = "1";

    btn.addEventListener("click", () => {
      closeModal(btn.closest(".modal"));
    });
  });

  window.addEventListener("click", (event) => {
    document.querySelectorAll(".modal").forEach((modal) => {
      if (event.target === modal) {
        closeModal(modal);
      }
    });
  });
}

function bindFilterEvents() {
  [
    "searchInput",
    "itemSearchInput",
    "typeFilter",
    "regionFilter",
    "playerLevelFilter",
    "reputationFilter",
    "priceMin",
    "priceMax",
    "rarityFilter",
    "categoryFilter",
    "magicFilter",
    "sortFilter",
  ].forEach((id) => {
    const el = getEl(id);
    if (!el) return;
    el.addEventListener("input", rerenderTraders);
    el.addEventListener("change", rerenderTraders);
  });
}

function bindTraderDelegation() {
  document.addEventListener("click", async (event) => {
    const openBtn = event.target.closest("[data-open-trader-id]");
    if (openBtn) {
      event.preventDefault();
      event.stopPropagation();

      const traderId = Number(openBtn.dataset.openTraderId);
      if (Number.isFinite(traderId)) {
        await window.openTraderModal(traderId);
      }
      return;
    }

    const traderCard = event.target.closest("[data-trader-card-id]");
    if (traderCard) {
      const traderId = Number(traderCard.dataset.traderCardId);
      if (Number.isFinite(traderId)) {
        await window.openTraderModal(traderId);
      }
    }
  });

  document.addEventListener("keydown", async (event) => {
    const traderCard = event.target.closest("[data-trader-card-id]");
    if (!traderCard) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const traderId = Number(traderCard.dataset.traderCardId);
      if (Number.isFinite(traderId)) {
        await window.openTraderModal(traderId);
      }
    }
  });
}

function bindMoneyControls() {
  const playerGoldInput = getEl("playerGoldInput");
  const updateGoldBtn = getEl("updateGoldBtn");
  const resetGoldBtn = getEl("resetGoldBtn");

  updateGoldBtn?.addEventListener("click", applyGuestMoneyUpdateFromInput);

  playerGoldInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyGuestMoneyUpdateFromInput();
    }
  });

  resetGoldBtn?.addEventListener("click", resetGuestMoney);
  syncMoneyControls();
}

// ------------------------------------------------------------
// 🛒 GLOBAL ACTIONS
// ------------------------------------------------------------
window.openTraderModal = async function (traderId) {
  STATE.activeTraderId = Number(traderId);

  if (STATE.token) {
    await refreshTraderById(traderId);
  }

  syncGlobalStateBridges();
  await renderOpenTraderModal(traderId);
};

window.openTrader = window.openTraderModal;

window.addToCart = function (traderId, itemId, quantity = 1) {
  const item = getTraderItem(traderId, itemId);
  if (!item) {
    showToast("Предмет не найден");
    return;
  }

  const qty = Math.max(1, safeNumber(quantity, 1));
  const available = Math.max(0, safeNumber(item.stock ?? item.quantity, 0));
  const index = findCollectionItemIndex(STATE.cart, traderId, itemId);
  const existingQty = index >= 0 ? Math.max(1, safeNumber(STATE.cart[index].quantity, 1)) : 0;
  const nextQty = existingQty + qty;

  if (available > 0 && nextQty > available) {
    showToast(`У торговца только ${available} шт.`);
    return;
  }

  if (index >= 0) {
    STATE.cart[index].quantity = nextQty;
  } else {
    STATE.cart.push(normalizeCollectionItem(traderId, item, qty));
  }

  syncGlobalStateBridges();
  renderAllLocalState();
  showToast(`В корзину добавлено: ${item.name} × ${qty}`);
};

window.reserveItem = function (itemId, traderId = null, quantity = 1) {
  const qty = Math.max(1, safeNumber(quantity, 1));

  let item = null;
  let sourceTraderId = traderId;

  if (traderId != null) {
    item = getTraderItem(traderId, itemId);
  } else {
    item =
      STATE.cart.find((entry) => Number(entry.item_id || entry.id) === Number(itemId)) ||
      STATE.reserved.find((entry) => Number(entry.item_id || entry.id) === Number(itemId)) ||
      null;
    sourceTraderId = item?.trader_id ?? null;
  }

  if (!item) {
    showToast("Предмет для резерва не найден");
    return;
  }

  const index = findCollectionItemIndex(STATE.reserved, sourceTraderId, itemId);

  if (index >= 0) {
    STATE.reserved[index].quantity = Math.max(1, safeNumber(STATE.reserved[index].quantity, 1) + qty);
  } else {
    STATE.reserved.push(normalizeCollectionItem(sourceTraderId, item, qty));
  }

  syncGlobalStateBridges();
  renderCart(STATE.cart);
  showToast(`Зарезервировано: ${item.name} × ${qty}`);
};

window.unreserveItem = function (itemId, traderId = null) {
  const index = findCollectionItemIndex(STATE.reserved, traderId, itemId);
  if (index < 0) {
    showToast("Резерв не найден");
    return;
  }

  const [removed] = STATE.reserved.splice(index, 1);
  syncGlobalStateBridges();
  renderCart(STATE.cart);
  showToast(`Снят резерв: ${removed?.name || "предмет"}`);
};

window.removeFromCart = function (itemId, traderId = null) {
  const index = findCollectionItemIndex(STATE.cart, traderId, itemId);
  if (index < 0) {
    showToast("Предмет в корзине не найден");
    return;
  }

  const [removed] = STATE.cart.splice(index, 1);
  syncGlobalStateBridges();
  renderAllLocalState();
  showToast(`Удалено из корзины: ${removed?.name || "предмет"}`);
};

window.clearCartAction = function () {
  STATE.cart = [];
  syncGlobalStateBridges();
  renderAllLocalState();
  showToast("Корзина очищена");
};

window.removeInventoryItem = function (itemId) {
  const index = STATE.inventory.findIndex(
    (entry) => Number(entry.id || entry.item_id) === Number(itemId)
  );

  if (index < 0) {
    showToast("Предмет не найден в инвентаре");
    return;
  }

  const target = STATE.inventory[index];
  if (!confirm(`Удалить из инвентаря ${target?.name || "предмет"}?`)) return;

  const [removed] = STATE.inventory.splice(index, 1);
  syncGlobalStateBridges();
  renderAllLocalState();
  showToast(`Удалено из инвентаря: ${removed?.name || "предмет"}`);
};

window.getItemForDescription = function (itemId, context = "trader", traderId = null) {
  const numericId = Number(itemId);

  if (context === "inventory") {
    return (
      STATE.inventory.find((item) => Number(item.id || item.item_id) === numericId) || null
    );
  }

  if (context === "cart") {
    return (
      STATE.cart.find((item) => Number(item.id || item.item_id) === numericId) || null
    );
  }

  if (context === "reserved") {
    return (
      STATE.reserved.find((item) => Number(item.id || item.item_id) === numericId) || null
    );
  }

  if (traderId != null) {
    return getTraderItem(traderId, numericId);
  }

  for (const trader of STATE.traders) {
    const found = getTraderItem(trader.id, numericId);
    if (found) return found;
  }

  return null;
};

// ------------------------------------------------------------
// 💸 BUY / SELL
// ------------------------------------------------------------
function applyLocalBuy(traderId, itemId, quantity = 1) {
  const trader = getTraderById(traderId);
  const traderItem = getTraderItem(traderId, itemId);
  const qty = Math.max(1, safeNumber(quantity, 1));

  if (!trader || !traderItem) {
    throw new Error("Предмет или торговец не найден");
  }

  const available = Math.max(0, safeNumber(traderItem.stock ?? traderItem.quantity, 0));
  if (available < qty) {
    throw new Error(`У торговца только ${available} шт.`);
  }

  const totalCp =
    moneyPartsToCp(
      traderItem.buy_price_gold ?? traderItem.price_gold,
      traderItem.buy_price_silver ?? traderItem.price_silver,
      traderItem.buy_price_copper ?? traderItem.price_copper
    ) * qty;

  const currentMoneyCp = getCurrentMoneyCp();
  if (currentMoneyCp < totalCp) {
    throw new Error("Недостаточно средств");
  }

  STATE.guestMoneyCp = Math.max(0, currentMoneyCp - totalCp);
  persistGuestMoney();

  const traderMoneyCp = getTraderMoneyCp(trader) + totalCp;
  setTraderMoneyCp(trader, traderMoneyCp);

  const invIndex = STATE.inventory.findIndex(
    (entry) => Number(entry.id || entry.item_id) === Number(itemId)
  );

  if (invIndex >= 0) {
    STATE.inventory[invIndex].quantity =
      Math.max(1, safeNumber(STATE.inventory[invIndex].quantity, 1) + qty);
    ensureGuestSellPrices(STATE.inventory[invIndex], traderId);
  } else {
    const newItem = normalizeInventoryItem({
      ...traderItem,
      quantity: qty,
      trader_id: traderId,
    });
    ensureGuestSellPrices(newItem, traderId);
    STATE.inventory.push(newItem);
  }

  traderItem.stock = available - qty;
  traderItem.quantity = available - qty;

  const result = {
    totalCp,
    totalLabel: formatMoneyCp(totalCp),
    playerMoneyCp: STATE.guestMoneyCp,
    playerMoneyLabel: formatMoneyCp(STATE.guestMoneyCp),
    traderMoneyCp,
    traderMoneyLabel: trader.gold_label || formatMoneyCp(traderMoneyCp),
    traderStock: traderItem.stock,
    itemName: traderItem.name,
    qty,
  };

  logTradeSnapshot("BUY_OK", result);
  syncGlobalStateBridges();
  return result;
}

async function applyServerBuy(traderId, itemId, quantity = 1) {
  const traderBeforeCp = getTraderMoneyCp(getTraderById(traderId));
  const traderItemBefore = getTraderItem(traderId, itemId);
  const itemBuyCp = traderItemBefore
    ? moneyPartsToCp(
        traderItemBefore.buy_price_gold ?? traderItemBefore.price_gold,
        traderItemBefore.buy_price_silver ?? traderItemBefore.price_silver,
        traderItemBefore.buy_price_copper ?? traderItemBefore.price_copper
      ) * Math.max(1, safeNumber(quantity, 1))
    : 0;

  const payload = await apiBuyItem(itemId, traderId, quantity);

  updateUserMoneyFromPayload(payload);
  patchTraderFromTradePayload(traderId, itemId, payload, quantity, "buy");

  await loadInventoryFromServer();
  await refreshTraderById(traderId);

  const payloadTraderMoney = getTraderMoneyFromTradePayload(payload);
  const trader = getTraderById(traderId);
  if (trader) {
    if (payloadTraderMoney) {
      setTraderMoneyCp(trader, payloadTraderMoney.cp);
    } else if (itemBuyCp > 0) {
      setTraderMoneyCp(trader, traderBeforeCp + itemBuyCp);
    }
  }

  syncGlobalStateBridges();
  return payload;
}

window.buyItem = async function (traderId, itemId, quantity = 1, options = {}) {
  const qty = Math.max(1, safeNumber(quantity, 1));
  const settings = options && typeof options === "object" ? options : {};
  const source = String(settings.source || "trader");
  const skipConfirm = Boolean(settings.skipConfirm);

  if (!skipConfirm) {
    const item = getTraderItem(traderId, itemId) || STATE.cart.find((entry) => Number(entry.trader_id) === Number(traderId) && Number(entry.item_id || entry.id) === Number(itemId));
    const itemName = item?.name || "предмет";
    if (!confirm(`Купить ${itemName} × ${qty}?`)) {
      return { cancelled: true };
    }
  }

  try {
    setBusy(true);

    let snapshot = null;

    if (STATE.token) {
      const payload = await applyServerBuy(traderId, itemId, qty);
      snapshot = {
        playerMoneyLabel: getCurrentMoneyLabel(),
        traderMoneyLabel:
          getTraderById(traderId)?.money_label ||
          getTraderById(traderId)?.gold_label ||
          String(getTraderById(traderId)?.gold || "—"),
        traderStock:
          getTraderItem(traderId, itemId)?.stock ??
          getTraderItem(traderId, itemId)?.quantity ??
          "—",
        payload,
      };
    } else {
      snapshot = applyLocalBuy(traderId, itemId, qty);
    }

    if (source === "cart") {
      consumeCollectionEntry(STATE.cart, traderId, itemId, qty);
    }
    if (source === "reserved") {
      consumeCollectionEntry(STATE.reserved, traderId, itemId, qty);
    }

    renderAllLocalState();
    rerenderTraders();
    await syncOpenTraderModalIfVisible(STATE.activeTraderId ?? traderId);

    showToast(
      `Покупка успешна${snapshot?.playerMoneyLabel ? ` • Ваше золото: ${snapshot.playerMoneyLabel}` : ""}`
    );
    return snapshot;
  } catch (error) {
    console.error(error);
    showToast(error.message || "Ошибка покупки");
    throw error;
  } finally {
    setBusy(false);
  }
};

function applyLocalSell(itemId, quantity = 1) {
  const invIndex = STATE.inventory.findIndex(
    (entry) => Number(entry.id || entry.item_id) === Number(itemId)
  );

  if (invIndex < 0) {
    throw new Error("Предмет не найден в инвентаре");
  }

  const item = STATE.inventory[invIndex];
  const qty = Math.max(1, safeNumber(quantity, 1));
  const owned = Math.max(0, safeNumber(item.quantity, 0));

  if (owned < qty) {
    throw new Error(`У вас только ${owned} шт.`);
  }

  const trader = item.trader_id != null ? getTraderById(item.trader_id) : null;
  const totalCp = getSellTotalCp(item, qty);

  STATE.guestMoneyCp = Math.max(0, getCurrentMoneyCp() + totalCp);
  persistGuestMoney();

  if (trader) {
    const traderMoneyCp = Math.max(0, getTraderMoneyCp(trader) - totalCp);
    setTraderMoneyCp(trader, traderMoneyCp);

    const traderItem = getTraderItem(trader.id, itemId);
    if (traderItem) {
      traderItem.stock = Math.max(0, safeNumber(traderItem.stock ?? traderItem.quantity, 0) + qty);
      traderItem.quantity = traderItem.stock;
    }
  }

  if (owned === qty) {
    STATE.inventory.splice(invIndex, 1);
  } else {
    STATE.inventory[invIndex].quantity = owned - qty;
  }

  const result = {
    totalCp,
    totalLabel: formatMoneyCp(totalCp),
    playerMoneyCp: STATE.guestMoneyCp,
    playerMoneyLabel: formatMoneyCp(STATE.guestMoneyCp),
    itemName: item.name,
    qty,
  };

  logTradeSnapshot("SELL_OK", result);
  syncGlobalStateBridges();
  return result;
}

async function applyServerSell(itemId, quantity = 1) {
  const inventoryEntry = STATE.inventory.find(
    (entry) => Number(entry.id || entry.item_id) === Number(itemId)
  );

  const traderId = inventoryEntry?.trader_id ?? null;
  const traderBeforeCp = traderId != null ? getTraderMoneyCp(getTraderById(traderId)) : 0;
  const sellDeltaCp = inventoryEntry ? getSellTotalCp(inventoryEntry, quantity) : 0;

  const payload = await apiSellItem(itemId, traderId, quantity);

  updateUserMoneyFromPayload(payload);

  if (traderId != null) {
    patchTraderFromTradePayload(
      traderId,
      itemId,
      payload,
      quantity,
      "sell"
    );
  }

  await loadInventoryFromServer();

  if (traderId != null) {
    await refreshTraderById(traderId);
    const payloadTraderMoney = getTraderMoneyFromTradePayload(payload);
    const trader = getTraderById(traderId);
    if (trader) {
      if (payloadTraderMoney) {
        setTraderMoneyCp(trader, payloadTraderMoney.cp);
      } else if (sellDeltaCp > 0) {
        setTraderMoneyCp(trader, Math.max(0, traderBeforeCp - sellDeltaCp));
      }
    }
  }

  syncGlobalStateBridges();
  return payload;
}

window.sellItem = async function (itemId, quantity = 1, options = {}) {
  const qty = Math.max(1, safeNumber(quantity, 1));
  const settings = options && typeof options === "object" ? options : {};
  const skipConfirm = Boolean(settings.skipConfirm);

  if (!skipConfirm) {
    const item = STATE.inventory.find((entry) => Number(entry.id || entry.item_id) === Number(itemId));
    const itemName = item?.name || "предмет";
    if (!confirm(`Продать ${itemName} × ${qty}?`)) {
      return { cancelled: true };
    }
  }

  try {
    setBusy(true);

    if (STATE.token) {
      await applyServerSell(itemId, qty);
    } else {
      applyLocalSell(itemId, qty);
    }

    renderAllLocalState();
    rerenderTraders();
    await syncOpenTraderModalIfVisible(STATE.activeTraderId);

    showToast(`Продажа успешна • Ваше золото: ${getCurrentMoneyLabel()}`);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Ошибка продажи");
    throw error;
  } finally {
    setBusy(false);
  }
};

window.checkoutCart = async function () {
  if (!Array.isArray(STATE.cart) || !STATE.cart.length) {
    showToast("Корзина пуста");
    return { success: false, purchased: 0, failed: 0, errors: ["Корзина пуста"] };
  }

  const totalItems = STATE.cart.reduce((sum, entry) => sum + Math.max(1, safeNumber(entry.quantity, 1)), 0);
  if (!confirm(`Оформить корзину? Позиций: ${STATE.cart.length}, предметов: ${totalItems}.`)) {
    return { success: false, purchased: 0, failed: 0, errors: ["cancelled"] };
  }

  const items = [...STATE.cart];
  const errors = [];
  let purchased = 0;

  for (const entry of items) {
    try {
      await window.buyItem(entry.trader_id, entry.item_id || entry.id, entry.quantity, {
        skipConfirm: true,
        source: "cart",
      });
      purchased += 1;
    } catch (error) {
      errors.push(error.message || `Ошибка: ${entry.name || "предмет"}`);
    }
  }

  renderAllLocalState();

  return {
    success: errors.length === 0,
    purchased,
    failed: errors.length,
    errors,
  };
};

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

    bindToolbarButtons();
    bindAuthButtons();
    bindModalButtons();
    bindFilterEvents();
    bindTraderDelegation();
    bindMoneyControls();
    bindRoleSwitchButton();

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