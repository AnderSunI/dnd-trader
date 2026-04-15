// ============================================================
// frontend/js/state.js
// Shared state / bridge store
// - совместим со старой и новой модульной схемой
// - сам ничего не рендерит
// - не спорит с app.js, а даёт общий объект для модулей
// ============================================================

// ------------------------------------------------------------
// 🌐 ROOT STATE
// ------------------------------------------------------------
export const state = {
  // Пользователь / роль
  user: null,
  role: "player",

  // Торговцы / выбор торговца
  traders: [],
  selectedTraderId: null,

  // Игрок
  inventory: [],
  cart: [],
  reserved: [],

  // Фильтры
  filters: {
    search: "",
    itemSearch: "",
    category: "",
    region: "",
    traderType: "",
    rarity: "",
    magicFilter: "",
    minPrice: null,
    maxPrice: null,
    playerLevel: 0,
    reputation: 0,
    sort: "name_asc",
  },

  // UI
  ui: {
    cabinetOpen: false,
    activeCabinetTab: "inventory",
    activeTraderTab: "inventory",
    gmMode: false,
  },

  // Long Story Short
  lss: {
    raw: null,
    profile: null,
    source: "empty",
    stats: {},
    abilities: [],
    quests: [],
    history: [],
    notes: "",
  },

  // Карта
  map: {
    maps: [],
    activeMapId: null,
    markers: [],
    zoom: 1,
    rotation: 0,
    activeLayer: "world",
  },
};

// ------------------------------------------------------------
// 🧰 HELPERS
// ------------------------------------------------------------
function clone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : fallback;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeRole(role) {
  const raw = String(role || "").trim().toLowerCase();
  if (raw === "gm" || raw === "admin") return "gm";
  return "player";
}

function getItemId(item) {
  return Number(item?.item_id ?? item?.id ?? 0);
}

function getTraderId(item) {
  if (item?.trader_id === null || item?.trader_id === undefined) return null;
  const n = Number(item.trader_id);
  return Number.isFinite(n) ? n : null;
}

function getCollectionKey(itemOrTraderId, maybeItemId = null) {
  if (typeof itemOrTraderId === "object" && itemOrTraderId !== null) {
    return `${getTraderId(itemOrTraderId) ?? "none"}:${getItemId(itemOrTraderId)}`;
  }
  return `${itemOrTraderId ?? "none"}:${Number(maybeItemId ?? 0)}`;
}

function normalizeItem(item, quantityFallback = 1) {
  const normalized = {
    ...safeObject(item, {}),
    id: getItemId(item),
    item_id: getItemId(item),
    trader_id: getTraderId(item),
    quantity: Math.max(1, safeNumber(item?.quantity, quantityFallback)),
  };

  return normalized;
}

function syncWindowBridge() {
  window.__sharedState = state;
  window.__state = state;
}

// ------------------------------------------------------------
// 👤 USER / ROLE
// ------------------------------------------------------------
export function setUser(user) {
  state.user = user && typeof user === "object" ? clone(user) : null;

  const inferredRole =
    state.user?.role ??
    window.__appUserRole ??
    document.body?.dataset?.role ??
    state.role;

  state.role = normalizeRole(inferredRole);
  state.ui.gmMode = state.role === "gm";
  syncWindowBridge();
}

export function clearUser() {
  state.user = null;
  state.role = normalizeRole(window.__appUserRole || "player");
  state.ui.gmMode = state.role === "gm";
  syncWindowBridge();
}

export function setRole(role) {
  state.role = normalizeRole(role);
  state.ui.gmMode = state.role === "gm";
  syncWindowBridge();
}

export function setGmMode(enabled) {
  state.ui.gmMode = Boolean(enabled);
  state.role = enabled ? "gm" : "player";
  syncWindowBridge();
}

export function getRole() {
  return normalizeRole(state.role);
}

// ------------------------------------------------------------
// 🧙 TRADERS
// ------------------------------------------------------------
export function setTraders(traders) {
  state.traders = safeArray(traders).map((trader) => ({
    ...safeObject(trader, {}),
    id: Number(trader?.id ?? 0),
    items: safeArray(trader?.items).map((item) => normalizeItem(item)),
  }));
  syncWindowBridge();
}

export function getTraders() {
  return state.traders;
}

export function setSelectedTrader(traderId) {
  state.selectedTraderId = traderId === null || traderId === undefined
    ? null
    : Number(traderId);
  syncWindowBridge();
}

export function clearSelectedTrader() {
  state.selectedTraderId = null;
  syncWindowBridge();
}

export function getSelectedTrader() {
  return (
    state.traders.find((trader) => Number(trader.id) === Number(state.selectedTraderId)) ||
    null
  );
}

export function upsertTrader(trader) {
  const normalized = {
    ...safeObject(trader, {}),
    id: Number(trader?.id ?? 0),
    items: safeArray(trader?.items).map((item) => normalizeItem(item)),
  };

  const index = state.traders.findIndex((entry) => Number(entry.id) === Number(normalized.id));

  if (index >= 0) {
    state.traders[index] = normalized;
  } else {
    state.traders.push(normalized);
  }

  syncWindowBridge();
  return normalized;
}

// ------------------------------------------------------------
// 🎒 INVENTORY
// ------------------------------------------------------------
export function setInventory(items) {
  state.inventory = safeArray(items).map((item) => normalizeItem(item));
  syncWindowBridge();
}

export function getInventory() {
  return state.inventory;
}

export function clearInventory() {
  state.inventory = [];
  syncWindowBridge();
}

export function addInventoryItem(item, quantity = 1) {
  const normalized = normalizeItem(item, quantity);
  const index = state.inventory.findIndex(
    (entry) =>
      getItemId(entry) === getItemId(normalized) &&
      getTraderId(entry) === getTraderId(normalized)
  );

  if (index >= 0) {
    state.inventory[index].quantity += Math.max(1, safeNumber(quantity, 1));
  } else {
    state.inventory.push(normalized);
  }

  syncWindowBridge();
}

export function removeInventoryItem(itemId, traderId = null) {
  const key = getCollectionKey(traderId, itemId);
  state.inventory = state.inventory.filter((item) => getCollectionKey(item) !== key);
  syncWindowBridge();
}

// ------------------------------------------------------------
// 🛒 CART
// ------------------------------------------------------------
export function setCart(items) {
  state.cart = safeArray(items).map((item) => normalizeItem(item));
  syncWindowBridge();
}

export function getCart() {
  return state.cart;
}

export function clearCart() {
  state.cart = [];
  syncWindowBridge();
}

export function addToCart(item, quantity = 1) {
  const normalized = normalizeItem(item, quantity);
  const key = getCollectionKey(normalized);

  const existing = state.cart.find((cartItem) => getCollectionKey(cartItem) === key);
  if (existing) {
    existing.quantity += Math.max(1, safeNumber(quantity, 1));
  } else {
    state.cart.push(normalized);
  }

  syncWindowBridge();
}

export function removeFromCart(itemId, traderId = null) {
  const key = getCollectionKey(traderId, itemId);
  state.cart = state.cart.filter((item) => getCollectionKey(item) !== key);
  syncWindowBridge();
}

export function updateCartQuantity(itemId, quantity, traderId = null) {
  const key = getCollectionKey(traderId, itemId);
  const nextQty = Math.max(1, safeNumber(quantity, 1));

  state.cart = state.cart.map((item) => {
    if (getCollectionKey(item) !== key) return item;
    return { ...item, quantity: nextQty };
  });

  syncWindowBridge();
}

// ------------------------------------------------------------
// 📦 RESERVED
// ------------------------------------------------------------
export function setReserved(items) {
  state.reserved = safeArray(items).map((item) => normalizeItem(item));
  syncWindowBridge();
}

export function getReserved() {
  return state.reserved;
}

export function clearReserved() {
  state.reserved = [];
  syncWindowBridge();
}

export function addReservedItem(item, quantity = 1) {
  const normalized = normalizeItem(item, quantity);
  const key = getCollectionKey(normalized);

  const existing = state.reserved.find((reservedItem) => getCollectionKey(reservedItem) === key);
  if (existing) {
    existing.quantity += Math.max(1, safeNumber(quantity, 1));
  } else {
    state.reserved.push(normalized);
  }

  syncWindowBridge();
}

export function removeReservedItem(itemId, traderId = null) {
  const key = getCollectionKey(traderId, itemId);
  state.reserved = state.reserved.filter((item) => getCollectionKey(item) !== key);
  syncWindowBridge();
}

// ------------------------------------------------------------
// 🔎 FILTERS
// ------------------------------------------------------------
const DEFAULT_FILTERS = {
  search: "",
  itemSearch: "",
  category: "",
  region: "",
  traderType: "",
  rarity: "",
  magicFilter: "",
  minPrice: null,
  maxPrice: null,
  playerLevel: 0,
  reputation: 0,
  sort: "name_asc",
};

export function setFilters(filters) {
  state.filters = {
    ...DEFAULT_FILTERS,
    ...safeObject(filters, {}),
  };
  syncWindowBridge();
}

export function updateFilter(key, value) {
  state.filters[key] = value;
  syncWindowBridge();
}

export function resetFilters() {
  state.filters = { ...DEFAULT_FILTERS };
  syncWindowBridge();
}

export function getFilters() {
  return state.filters;
}

// ------------------------------------------------------------
// 🖥 UI
// ------------------------------------------------------------
export function setCabinetOpen(isOpen) {
  state.ui.cabinetOpen = Boolean(isOpen);
  syncWindowBridge();
}

export function setActiveCabinetTab(tabName) {
  state.ui.activeCabinetTab = String(tabName || "inventory");
  syncWindowBridge();
}

export function setActiveTraderTab(tabName) {
  state.ui.activeTraderTab = String(tabName || "inventory");
  syncWindowBridge();
}

export function getUiState() {
  return state.ui;
}

// ------------------------------------------------------------
// 📖 LSS
// ------------------------------------------------------------
export function setLssData(payload) {
  const data = safeObject(payload, null);

  state.lss = {
    ...state.lss,
    raw: data ? clone(data.raw ?? data) : null,
    profile: data ? clone(data.profile ?? data) : null,
    source: safeText(data?.source, data ? "manual" : "empty"),
    stats: safeObject(data?.stats, safeObject(data?.profile?.stats, {})),
    abilities: safeArray(data?.abilities),
    quests: safeArray(data?.quests),
    history: safeArray(data?.history),
    notes: safeText(data?.notes, ""),
  };

  syncWindowBridge();
}

export function clearLssData() {
  state.lss = {
    raw: null,
    profile: null,
    source: "empty",
    stats: {},
    abilities: [],
    quests: [],
    history: [],
    notes: "",
  };
  syncWindowBridge();
}

export function getLssData() {
  return state.lss;
}

// ------------------------------------------------------------
// 🗺 MAP
// ------------------------------------------------------------
export function setMapData(payload) {
  const data = safeObject(payload, {});

  state.map = {
    ...state.map,
    ...clone(data),
    maps: safeArray(data.maps ?? state.map.maps),
    markers: safeArray(data.markers ?? state.map.markers),
    zoom: safeNumber(data.zoom ?? state.map.zoom, 1),
    rotation: safeNumber(data.rotation ?? state.map.rotation, 0),
    activeLayer: safeText(data.activeLayer ?? state.map.activeLayer, "world"),
  };

  syncWindowBridge();
}

export function clearMapData() {
  state.map = {
    maps: [],
    activeMapId: null,
    markers: [],
    zoom: 1,
    rotation: 0,
    activeLayer: "world",
  };
  syncWindowBridge();
}

export function getMapData() {
  return state.map;
}

// ------------------------------------------------------------
// 🔄 GLOBAL SYNC
// ------------------------------------------------------------
export function syncStateFromGlobals() {
  if (window.__appUser !== undefined) {
    state.user = window.__appUser;
  }

  if (Array.isArray(window.__appStateTraders)) {
    state.traders = window.__appStateTraders;
  }

  if (Array.isArray(window.__appStateInventory)) {
    state.inventory = window.__appStateInventory;
  }

  if (Array.isArray(window.__appCartState)) {
    state.cart = window.__appCartState;
  }

  if (Array.isArray(window.__appStateReserved)) {
    state.reserved = window.__appStateReserved;
  }

  state.role = normalizeRole(
    window.__appUserRole ||
    window.__userRole ||
    document.body?.dataset?.role ||
    state.role
  );
  state.ui.gmMode = state.role === "gm";

  syncWindowBridge();
}

export function resetState() {
  state.user = null;
  state.role = "player";
  state.traders = [];
  state.selectedTraderId = null;
  state.inventory = [];
  state.cart = [];
  state.reserved = [];
  state.filters = { ...DEFAULT_FILTERS };
  state.ui = {
    cabinetOpen: false,
    activeCabinetTab: "inventory",
    activeTraderTab: "inventory",
    gmMode: false,
  };
  clearLssData();
  clearMapData();
  syncWindowBridge();
}

// ------------------------------------------------------------
// 🌉 INIT BRIDGE
// ------------------------------------------------------------
syncWindowBridge();