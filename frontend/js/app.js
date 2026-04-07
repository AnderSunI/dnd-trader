import {
  renderTraders,
  renderCart,
  renderInventory,
  openTraderModal,
} from "./render.js";

const GUEST_START_GOLD = "1000з";

const STATE = {
  token: localStorage.getItem("token") || "",
  user: null,
  traders: [],
  cart: [],
  reserved: [],
  inventory: [],
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

function formatMoneyParts(gold = 0, silver = 0, copper = 0) {
  const parts = [];
  if (gold) parts.push(`${gold}з`);
  if (silver) parts.push(`${silver}с`);
  if (copper) parts.push(`${copper}м`);
  return parts.length ? parts.join(" ") : "0з";
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

function getCollectionKey(traderId, itemId) {
  return `${traderId ?? "none"}:${Number(itemId)}`;
}

function findCollectionItemIndex(collection, traderId, itemId) {
  const key = getCollectionKey(traderId, itemId);
  return collection.findIndex(
    (entry) => getCollectionKey(entry.trader_id, entry.item_id || entry.id) === key
  );
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
      userMoney.innerText = STATE.user.money_label || GUEST_START_GOLD;
    }

    const role = String(STATE.user.role || "").toLowerCase();
    if (gmBadge) gmBadge.textContent = role === "gm" || role === "admin" ? "ГМ" : "Игрок";
  } else {
    guestWarning?.classList.remove("hidden");
    logoutBtn?.classList.add("hidden");
    showAuthBtn?.classList.remove("hidden");
    authContainer?.classList.add("hidden");

    if (gmBadge) gmBadge.textContent = "Игрок";
    if (userMoney) userMoney.innerText = GUEST_START_GOLD;
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
  const totalGold = STATE.cart.reduce(
    (sum, item) => sum + safeNumber(item.price_gold, 0) * safeNumber(item.quantity, 1),
    0
  );
  const totalSilver = STATE.cart.reduce(
    (sum, item) => sum + safeNumber(item.price_silver, 0) * safeNumber(item.quantity, 1),
    0
  );
  const totalCopper = STATE.cart.reduce(
    (sum, item) => sum + safeNumber(item.price_copper, 0) * safeNumber(item.quantity, 1),
    0
  );

  const label = formatMoneyParts(totalGold, totalSilver, totalCopper);

  if (getEl("cart-total")) getEl("cart-total").innerText = label;
  if (getEl("cartTotalModal")) getEl("cartTotalModal").innerText = label;
}

function renderAllLocalState() {
  renderCart(STATE.cart);
  renderInventory(STATE.inventory);
  updateCartCounter();
  updateCartTotalLabels();
  updateInventoryCounter();
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
  await openTraderModal(traderId);
};

window.addToCart = function (traderId, itemId, quantity = 1) {
  const item = getTraderItem(traderId, itemId);
  if (!item) {
    showToast("Предмет не найден");
    return;
  }

  const qty = Math.max(1, safeNumber(quantity, 1));
  const index = findCollectionItemIndex(STATE.cart, traderId, itemId);

  if (index >= 0) {
    STATE.cart[index].quantity = Math.max(1, safeNumber(STATE.cart[index].quantity, 1) + qty);
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

window.buyItem = async function (traderId, itemId, quantity = 1) {
  const item = getTraderItem(traderId, itemId);
  const qty = Math.max(1, safeNumber(quantity, 1));
  showToast(item ? `Покупка позже: ${item.name} × ${qty}` : `Купить: trader ${traderId}, item ${itemId}`);
};

window.sellItem = async function (itemId) {
  const item = STATE.inventory.find((entry) => Number(entry.id || entry.item_id) === Number(itemId));
  if (item) {
    showToast(`Продажа позже: ${item.name}`);
  } else {
    showToast(`Продажа позже: item ${itemId}`);
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
}

init().catch((err) => {
  console.error(err);
  showToast("Ошибка инициализации");
});