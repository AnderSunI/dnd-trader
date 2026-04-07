import {
  renderTraders,
  renderCart,
  renderInventory,
  openTraderModal,
} from "./render.js";

const GUEST_START_GOLD_CP = 100000;

const STATE = {
  token: localStorage.getItem("token") || "",
  user: null,
  traders: [],
  cart: [],
  reserved: [],
  inventory: [],
  activeTraderId: null,
  isBusy: false,
  guestMoneyCp: Number(localStorage.getItem("guestMoneyCp") || GUEST_START_GOLD_CP),
};

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getEl(id) {
  return document.getElementById(id);
}

function normalizeApiList(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

function showToast(message) {
  const toast = getEl("toast");
  if (!toast) return;

  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.style.opacity = "1";

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.classList.add("hidden"), 300);
  }, 2200);
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
  const gold = Math.floor(total / 100);
  const silver = Math.floor((total % 100) / 10);
  const copper = total % 10;
  return { gold, silver, copper };
}

function moneyPartsToCp(gold = 0, silver = 0, copper = 0) {
  return Math.max(0, safeNumber(gold, 0) * 100 + safeNumber(silver, 0) * 10 + safeNumber(copper, 0));
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

function persistGuestMoney() {
  localStorage.setItem("guestMoneyCp", String(Math.max(0, safeNumber(STATE.guestMoneyCp, GUEST_START_GOLD_CP))));
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
    const cp = moneyPartsToCp(payload.money_gold, payload.money_silver, payload.money_copper);
    return {
      cp,
      label: payload.money_label || formatMoneyCp(cp),
    };
  }

  if (payload.gold !== undefined || payload.silver !== undefined || payload.copper !== undefined) {
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
  } else {
    STATE.guestMoneyCp = money.cp;
    persistGuestMoney();
  }
}

function getCurrentMoneyLabel() {
  if (STATE.user?.money_label) return STATE.user.money_label;
  if (STATE.user?.money_cp_total !== undefined) return formatMoneyCp(STATE.user.money_cp_total);
  return formatMoneyCp(STATE.guestMoneyCp);
}

function getCurrentMoneyCp() {
  if (STATE.user?.money_cp_total !== undefined) return Math.max(0, safeNumber(STATE.user.money_cp_total, 0));
  return Math.max(0, safeNumber(STATE.guestMoneyCp, GUEST_START_GOLD_CP));
}

function setBusy(flag) {
  STATE.isBusy = Boolean(flag);

  [
    "checkoutCartBtn",
    "clearCartBtn",
    "clearCartBtnModal",
    "refreshDataBtn",
  ].forEach((id) => {
    const el = getEl(id);
    if (el) el.disabled = STATE.isBusy;
  });
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (STATE.token) {
    headers.set("Authorization", `Bearer ${STATE.token}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { detail: text };
    }
  }

  if (!response.ok) {
    const detail = payload?.detail || payload?.message || `Ошибка запроса: ${response.status}`;
    throw new Error(detail);
  }

  return payload;
}

function getTraderById(traderId) {
  return STATE.traders.find((t) => Number(t.id) === Number(traderId)) || null;
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
  };
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
    sell_price_gold: safeNumber(item.sell_price_gold, 0),
    sell_price_silver: safeNumber(item.sell_price_silver, 0),
    sell_price_copper: safeNumber(item.sell_price_copper, 0),
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

function getCartEntryTotalCp(item) {
  return moneyPartsToCp(item.price_gold, item.price_silver, item.price_copper) * Math.max(1, safeNumber(item.quantity, 1));
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
  if (safeNumber(item.sell_price_gold, 0) || safeNumber(item.sell_price_silver, 0) || safeNumber(item.sell_price_copper, 0)) {
    return item;
  }

  const trader = traderId != null ? getTraderById(traderId) : null;
  const reputation = safeNumber(trader?.reputation, 0);
  const baseCp = moneyPartsToCp(item.price_gold, item.price_silver, item.price_copper);
  const multiplier = Math.max(0.25, 0.5 - reputation * 0.01);
  const sellCp = Math.max(1, Math.floor(baseCp * multiplier));
  const parts = cpToMoneyParts(sellCp);

  item.sell_price_gold = parts.gold;
  item.sell_price_silver = parts.silver;
  item.sell_price_copper = parts.copper;
  item.sell_price_label = formatMoneyParts(parts.gold, parts.silver, parts.copper);
  return item;
}

function updateUserUI() {
  const guestWarning = getEl("guestWarning");
  const logoutBtn = getEl("logoutBtn");
  const showAuthBtn = getEl("showAuthBtn");
  const authContainer = getEl("authContainer");
  const userMoney = getEl("user-money");
  const gmBadge = getEl("gmBadge");

  if (STATE.user) {
    guestWarning?.classList.add("hidden");
    logoutBtn?.classList.remove("hidden");
    showAuthBtn?.classList.add("hidden");
    authContainer?.classList.add("hidden");

    if (userMoney) {
      userMoney.innerText = getCurrentMoneyLabel();
    }

    const role = String(STATE.user.role || "").toLowerCase();
    if (gmBadge) gmBadge.textContent = role === "gm" || role === "admin" ? "ГМ" : "Игрок";
  } else {
    guestWarning?.classList.remove("hidden");
    logoutBtn?.classList.add("hidden");
    showAuthBtn?.classList.remove("hidden");
    authContainer?.classList.add("hidden");

    if (gmBadge) gmBadge.textContent = "Игрок";
    if (userMoney) userMoney.innerText = getCurrentMoneyLabel();
  }
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
  renderCart(STATE.cart);
  renderInventory(STATE.inventory);
  updateCartCounter();
  updateCartTotalLabels();
  updateInventoryCounter();
  updateUserUI();
}

function populateFilterOptions(traders) {
  const typeFilter = getEl("typeFilter");
  const regionFilter = getEl("regionFilter");
  const categoryFilter = getEl("categoryFilter");

  if (typeFilter) {
    const types = [...new Set(traders.map((t) => t.type).filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b), "ru")
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
    const regions = [...new Set(traders.map((t) => t.region).filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b), "ru")
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
    for (const category of [...categories].sort((a, b) => String(a).localeCompare(String(b), "ru"))) {
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
      const aMin = Math.min(...(a.items || []).map((i) => safeNumber(i.price_gold ?? i.buy_price_gold, 0)), Infinity);
      const bMin = Math.min(...(b.items || []).map((i) => safeNumber(i.price_gold ?? i.buy_price_gold, 0)), Infinity);
      return aMin - bMin;
    });
  } else if (sortValue === "price_desc") {
    list.sort((a, b) => {
      const aMax = Math.max(...(a.items || []).map((i) => safeNumber(i.price_gold ?? i.buy_price_gold, 0)), 0);
      const bMax = Math.max(...(b.items || []).map((i) => safeNumber(i.price_gold ?? i.buy_price_gold, 0)), 0);
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
  renderTraders(filtered);
}

async function loadTraders() {
  const res = await fetch("/traders");
  if (!res.ok) throw new Error(`Ошибка загрузки торговцев: ${res.status}`);

  const data = await res.json();
  STATE.traders = normalizeApiList(data, "traders");
  populateFilterOptions(STATE.traders);
  rerenderTraders();
}

async function loadInventoryFromServer() {
  if (!STATE.token) return;

  try {
    const data = await apiFetch("/inventory/me");
    STATE.inventory = normalizeApiList(data, "items").map((item) => normalizeInventoryItem(item));
  } catch (error) {
    console.warn("Не удалось загрузить inventory из API:", error);
  }
}

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
    renderAllLocalState();
    showToast("Корзина очищена");
  });

  getEl("clearCartBtnModal")?.addEventListener("click", () => {
    if (!confirm("Очистить корзину полностью?")) return;
    STATE.cart = [];
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

  getEl("cabinetBtn")?.addEventListener("click", () => {
    openModal("cabinetModal");
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

  getEl("logoutBtn")?.addEventListener("click", () => {
    STATE.token = "";
    STATE.user = null;
    localStorage.removeItem("token");
    updateUserUI();
    showToast("Вы вышли");
  });

  getEl("doLogin")?.addEventListener("click", () => {
    showToast("Логин добьём следующим слоем");
  });

  getEl("doRegister")?.addEventListener("click", () => {
    showToast("Регистрацию добьём следующим слоем");
  });
}

function bindModalButtons() {
  document.querySelectorAll(".close").forEach((btn) => {
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

window.openTraderModal = async function (traderId) {
  STATE.activeTraderId = Number(traderId);
  await openTraderModal(traderId);
};

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

  showToast(`Зарезервировано: ${item.name} × ${qty}`);
  renderCart(STATE.cart);
};

window.unreserveItem = function (itemId, traderId = null) {
  const index =
    traderId != null
      ? findCollectionItemIndex(STATE.reserved, traderId, itemId)
      : STATE.reserved.findIndex((entry) => Number(entry.item_id || entry.id) === Number(itemId));

  if (index >= 0) {
    const [removed] = STATE.reserved.splice(index, 1);
    showToast(`Снят резерв: ${removed.name || "предмет"}`);
    renderCart(STATE.cart);
  }
};

window.getReservedItems = function () {
  return STATE.reserved;
};

window.getItemForDescription = function (itemId, mode = "", traderId = null) {
  const targetId = Number(itemId);

  if (mode === "trader" && traderId != null) {
    return getTraderItem(traderId, targetId);
  }

  if (mode === "cart") {
    return STATE.cart.find((item) => Number(item.item_id || item.id) === targetId) || null;
  }

  if (mode === "reserved") {
    return STATE.reserved.find((item) => Number(item.item_id || item.id) === targetId) || null;
  }

  if (mode === "inventory") {
    return STATE.inventory.find((item) => Number(item.id || item.item_id) === targetId) || null;
  }

  return (
    STATE.cart.find((item) => Number(item.item_id || item.id) === targetId) ||
    STATE.reserved.find((item) => Number(item.item_id || item.id) === targetId) ||
    STATE.inventory.find((item) => Number(item.id || item.item_id) === targetId) ||
    null
  );
};

window.showItemDescription = function (itemId, mode = "", traderId = null) {
  const item = window.getItemForDescription(itemId, mode, traderId);
  if (!item) {
    showToast("Описание предмета не найдено");
    return;
  }

  const lines = [
    `Название: ${item.name || "Без названия"}`,
    `Цена: ${item.price_label || item.buy_price_label || "—"}`,
    `Редкость: ${item.rarity || "—"}`,
    `Качество: ${item.quality || "—"}`,
    "",
    item.description || item.rules_text || item.effect || "Подробное описание пока отсутствует.",
  ];

  alert(lines.join("\n"));
};

function applyLocalBuy(traderId, itemId, quantity = 1) {
  const trader = getTraderById(traderId);
  const traderItem = getTraderItem(traderId, itemId);

  if (!trader || !traderItem) {
    throw new Error("Товар не найден у торговца");
  }

  const qty = Math.max(1, safeNumber(quantity, 1));
  const available = Math.max(0, safeNumber(traderItem.stock ?? traderItem.quantity, 0));
  if (available < qty) {
    throw new Error("Недостаточно товара у торговца");
  }

  const totalCp = moneyPartsToCp(
    traderItem.price_gold ?? traderItem.buy_price_gold,
    traderItem.price_silver ?? traderItem.buy_price_silver,
    traderItem.price_copper ?? traderItem.buy_price_copper
  ) * qty;

  if (getCurrentMoneyCp() < totalCp) {
    throw new Error("Недостаточно средств");
  }

  STATE.guestMoneyCp = Math.max(0, getCurrentMoneyCp() - totalCp);
  persistGuestMoney();

  const invIndex = STATE.inventory.findIndex((entry) => Number(entry.id || entry.item_id) === Number(itemId));
  if (invIndex >= 0) {
    STATE.inventory[invIndex].quantity = Math.max(1, safeNumber(STATE.inventory[invIndex].quantity, 1) + qty);
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
  return { totalCp, itemName: traderItem.name };
}

async function applyServerBuy(traderId, itemId, quantity = 1) {
  const payload = await apiFetch("/inventory/buy", {
    method: "POST",
    body: JSON.stringify({
      trader_id: Number(traderId),
      item_id: Number(itemId),
      quantity: Math.max(1, safeNumber(quantity, 1)),
    }),
  });

  updateUserMoneyFromPayload(payload);
  await loadInventoryFromServer();

  const traderItem = getTraderItem(traderId, itemId);
  if (traderItem) {
    const currentStock = Math.max(0, safeNumber(traderItem.stock ?? traderItem.quantity, 0));
    traderItem.stock = Math.max(0, currentStock - Math.max(1, safeNumber(quantity, 1)));
    traderItem.quantity = traderItem.stock;
  }

  return payload;
}

window.buyItem = async function (traderId, itemId, quantity = 1) {
  const item = getTraderItem(traderId, itemId);
  const qty = Math.max(1, safeNumber(quantity, 1));

  try {
    setBusy(true);
    if (STATE.token) {
      await applyServerBuy(traderId, itemId, qty);
    } else {
      applyLocalBuy(traderId, itemId, qty);
    }

    renderAllLocalState();
    rerenderTraders();
    if (STATE.activeTraderId != null) {
      await window.openTraderModal(STATE.activeTraderId);
    }
    showToast(`Куплено: ${item?.name || "предмет"} × ${qty}`);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Не удалось купить предмет");
  } finally {
    setBusy(false);
  }
};

window.checkoutCart = async function () {
  if (!Array.isArray(STATE.cart) || STATE.cart.length === 0) {
    showToast("Корзина пуста");
    return;
  }

  try {
    setBusy(true);

    const cartSnapshot = [...STATE.cart];
    for (const entry of cartSnapshot) {
      const traderId = Number(entry.trader_id);
      const itemId = Number(entry.item_id || entry.id);
      const quantity = Math.max(1, safeNumber(entry.quantity, 1));

      if (STATE.token) {
        await applyServerBuy(traderId, itemId, quantity);
      } else {
        applyLocalBuy(traderId, itemId, quantity);
      }
    }

    STATE.cart = [];
    renderAllLocalState();
    rerenderTraders();
    if (STATE.activeTraderId != null) {
      await window.openTraderModal(STATE.activeTraderId);
    }
    showToast("Заказ успешно оформлен");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Не удалось оформить заказ");
  } finally {
    setBusy(false);
  }
};

function applyLocalSell(itemId, traderId, quantity = 1) {
  const qty = Math.max(1, safeNumber(quantity, 1));
  const invIndex = STATE.inventory.findIndex((entry) => Number(entry.id || entry.item_id) === Number(itemId));
  if (invIndex < 0) {
    throw new Error("Предмет отсутствует в инвентаре");
  }

  const item = STATE.inventory[invIndex];
  if (safeNumber(item.quantity, 0) < qty) {
    throw new Error("Недостаточное количество предметов");
  }

  ensureGuestSellPrices(item, traderId);
  const rewardCp = getSellTotalCp(item, qty);
  STATE.guestMoneyCp = getCurrentMoneyCp() + rewardCp;
  persistGuestMoney();

  item.quantity -= qty;
  if (item.quantity <= 0) {
    STATE.inventory.splice(invIndex, 1);
  }

  const trader = getTraderById(traderId);
  if (trader) {
    const slot = getTraderItem(traderId, itemId);
    if (slot) {
      const nextQty = Math.max(0, safeNumber(slot.stock ?? slot.quantity, 0)) + qty;
      slot.stock = nextQty;
      slot.quantity = nextQty;
    } else {
      trader.items = Array.isArray(trader.items) ? trader.items : [];
      trader.items.push(normalizeCollectionItem(traderId, {
        ...item,
        stock: qty,
        quantity: qty,
      }, qty));
    }
  }

  return { rewardCp, itemName: item.name };
}

async function applyServerSell(itemId, traderId, quantity = 1) {
  const payload = await apiFetch("/inventory/sell", {
    method: "POST",
    body: JSON.stringify({
      trader_id: Number(traderId),
      item_id: Number(itemId),
      quantity: Math.max(1, safeNumber(quantity, 1)),
    }),
  });

  updateUserMoneyFromPayload(payload);
  await loadInventoryFromServer();

  const slot = getTraderItem(traderId, itemId);
  if (slot) {
    const nextQty = Math.max(0, safeNumber(slot.stock ?? slot.quantity, 0)) + Math.max(1, safeNumber(quantity, 1));
    slot.stock = nextQty;
    slot.quantity = nextQty;
  }

  return payload;
}

window.sellItem = async function (itemId) {
  const item = STATE.inventory.find((entry) => Number(entry.id || entry.item_id) === Number(itemId));
  if (!item) {
    showToast("Предмет не найден в инвентаре");
    return;
  }

  const traderId = item.trader_id ?? STATE.activeTraderId;
  if (!Number.isFinite(Number(traderId))) {
    showToast("Открой торговца, чтобы продать предмет");
    return;
  }

  try {
    setBusy(true);
    if (STATE.token) {
      await applyServerSell(itemId, traderId, 1);
    } else {
      applyLocalSell(itemId, traderId, 1);
    }

    renderAllLocalState();
    rerenderTraders();
    if (STATE.activeTraderId != null) {
      await window.openTraderModal(STATE.activeTraderId);
    }
    showToast(`Продано: ${item.name}`);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Не удалось продать предмет");
  } finally {
    setBusy(false);
  }
};

window.removeInventoryItem = function (itemId) {
  const index = STATE.inventory.findIndex((entry) => Number(entry.id || entry.item_id) === Number(itemId));
  if (index >= 0) {
    const [removed] = STATE.inventory.splice(index, 1);
    renderAllLocalState();
    showToast(`Удалён из инвентаря: ${removed.name || "предмет"}`);
  }
};

window.removeFromCart = function (itemId, traderId = null) {
  let index = -1;

  if (traderId !== null && traderId !== undefined && Number.isFinite(Number(traderId))) {
    index = findCollectionItemIndex(STATE.cart, traderId, itemId);
  } else {
    index = STATE.cart.findIndex((item) => Number(item.item_id || item.id) === Number(itemId));
  }

  if (index >= 0) {
    const [removed] = STATE.cart.splice(index, 1);
    renderAllLocalState();
    showToast(`Товар удалён из корзины: ${removed.name || "предмет"}`);
  }
};

async function init() {
  bindAuthButtons();
  bindToolbarButtons();
  bindModalButtons();
  bindFilterEvents();
  bindTraderDelegation();

  updateUserUI();
  renderAllLocalState();
  await loadTraders();
  await loadInventoryFromServer();
  renderAllLocalState();
}

init().catch((err) => {
  console.error(err);
  showToast("Ошибка инициализации");
});