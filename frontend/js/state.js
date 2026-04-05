// ============================================================
// frontend/js/state.js
// Центральное состояние фронтенда.
// Ничего не рендерит — только хранит данные.
// ============================================================

// Глобальное состояние приложения
export const state = {
  // Пользователь
  user: null,

  // Список всех торговцев
  traders: [],

  // Текущий выбранный торговец
  selectedTraderId: null,

  // Инвентарь игрока
  inventory: [],

  // Корзина
  cart: [],

  // Резерв товаров
  reserved: [],

  // Фильтры
  filters: {
    search: "",
    category: "all",
    region: "all",
    traderType: "all",
    rarity: "all",
    minPrice: null,
    maxPrice: null,
  },

  // Состояние интерфейса
  ui: {
    cabinetOpen: false,
    activeCabinetTab: "inventory",
    activeTraderTab: "inventory",
    gmMode: false,
  },

  // Long Story Short / персонаж
  lss: {
    stats: {},
    abilities: [],
    quests: [],
    history: [],
    notes: "",
  },

  // Карта
  map: {
    markers: [],
    zoom: 1,
    activeLayer: "world",
  },
};

// ============================================================
// 👤 USER
// ============================================================

// Установить пользователя
export function setUser(user) {
  state.user = user;
}

// Сбросить пользователя
export function clearUser() {
  state.user = null;
}

// ============================================================
// 🧙 TRADERS
// ============================================================

// Установить список торговцев
export function setTraders(traders) {
  state.traders = Array.isArray(traders) ? traders : [];
}

// Выбрать торговца
export function setSelectedTrader(traderId) {
  state.selectedTraderId = traderId;
}

// Сбросить выбранного торговца
export function clearSelectedTrader() {
  state.selectedTraderId = null;
}

// Получить текущего торговца
export function getSelectedTrader() {
  return (
    state.traders.find((trader) => trader.id === state.selectedTraderId) || null
  );
}

// ============================================================
// 🎒 INVENTORY
// ============================================================

// Установить инвентарь игрока
export function setInventory(items) {
  state.inventory = Array.isArray(items) ? items : [];
}

// Очистить инвентарь
export function clearInventory() {
  state.inventory = [];
}

// ============================================================
// 🛒 CART
// ============================================================

// Установить корзину целиком
export function setCart(items) {
  state.cart = Array.isArray(items) ? items : [];
}

// Добавить товар в корзину
export function addToCart(item, quantity = 1) {
  if (!item || !item.id) return;

  const existing = state.cart.find((cartItem) => cartItem.id === item.id);

  if (existing) {
    existing.quantity += quantity;
    return;
  }

  state.cart.push({
    ...item,
    quantity,
  });
}

// Удалить товар из корзины
export function removeFromCart(itemId) {
  state.cart = state.cart.filter((item) => item.id !== itemId);
}

// Изменить количество товара
export function updateCartQuantity(itemId, delta) {
  const item = state.cart.find((cartItem) => cartItem.id === itemId);

  if (!item) return;

  item.quantity += delta;

  if (item.quantity <= 0) {
    removeFromCart(itemId);
  }
}

// Очистить корзину
export function clearCart() {
  state.cart = [];
}

// Получить общее количество предметов в корзине
export function getCartCount() {
  return state.cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

// ============================================================
// 📦 RESERVED
// ============================================================

// Установить резерв
export function setReserved(items) {
  state.reserved = Array.isArray(items) ? items : [];
}

// Очистить резерв
export function clearReserved() {
  state.reserved = [];
}

// ============================================================
// 🗂️ FILTERS
// ============================================================

// Обновить один фильтр
export function updateFilter(key, value) {
  if (!(key in state.filters)) return;
  state.filters[key] = value;
}

// Установить сразу несколько фильтров
export function setFilters(nextFilters) {
  state.filters = {
    ...state.filters,
    ...(nextFilters || {}),
  };
}

// Сброс фильтров
export function resetFilters() {
  state.filters = {
    search: "",
    category: "all",
    region: "all",
    traderType: "all",
    rarity: "all",
    minPrice: null,
    maxPrice: null,
  };
}

// ============================================================
// 👤 CABINET
// ============================================================

// Открыть личный кабинет
export function openCabinet() {
  state.ui.cabinetOpen = true;
}

// Закрыть личный кабинет
export function closeCabinet() {
  state.ui.cabinetOpen = false;
}

// Переключить состояние кабинета
export function toggleCabinet() {
  state.ui.cabinetOpen = !state.ui.cabinetOpen;
}

// Сменить вкладку кабинета
export function setCabinetTab(tabName) {
  state.ui.activeCabinetTab = tabName;
}

// ============================================================
// 🏪 TRADER TABS
// ============================================================

// Сменить вкладку торговца
export function setTraderTab(tabName) {
  state.ui.activeTraderTab = tabName;
}

// ============================================================
// 📖 LSS
// ============================================================

// Установить данные персонажа
export function setLssData(data) {
  state.lss = {
    ...state.lss,
    ...(data || {}),
  };
}

// Частично обновить заметки LSS
export function setLssNotes(notes) {
  state.lss.notes = notes || "";
}

// ============================================================
// 🗺️ MAP
// ============================================================

// Установить данные карты
export function setMapData(data) {
  state.map = {
    ...state.map,
    ...(data || {}),
  };
}

// Установить zoom карты
export function setMapZoom(zoom) {
  state.map.zoom = zoom;
}

// Установить активный слой карты
export function setMapLayer(layerName) {
  state.map.activeLayer = layerName;
}

// ============================================================
// 🛡️ GM MODE
// ============================================================

// Переключение режима ГМа
export function setGmMode(enabled) {
  state.ui.gmMode = !!enabled;
}