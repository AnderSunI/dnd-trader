// ============================================================
// app.js
// Главная логика приложения
// Связка:
// - render.js
// - filters.js
// - cabinet.js
// - backend API
// ============================================================

import {
  renderTraders,
  renderCart,
  renderInventory,
  openTraderModal,
} from "./render.js";

import {
  populateFilterOptions,
  applyFilters,
  bindFilterEvents,
} from "./filters.js";

import {
  initCabinet,
  loadCabinetAll,
  switchCabinetTab,
} from "./cabinet.js";

// ------------------------------------------------------------
// 🌐 GLOBAL STATE
// ------------------------------------------------------------
const STATE = {
  user: null,
  token: null,
  traders: [],
  cart: [],
  inventory: [],
};

// ------------------------------------------------------------
// 🧰 HELPERS
// ------------------------------------------------------------
function getAuthHeaders(withJson = false) {
  const headers = {};

  if (withJson) {
    headers["Content-Type"] = "application/json";
  }

  if (STATE.token) {
    headers.Authorization = `Bearer ${STATE.token}`;
  }

  return headers;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) {
    console.log(message);
    return;
  }

  toast.textContent = message;
  toast.classList.remove("hidden");

  setTimeout(() => {
    toast.classList.add("hidden");
  }, 2200);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function updateUserUI() {
  const guestWarning = document.getElementById("guestWarning");
  const logoutBtn = document.getElementById("logoutBtn");
  const showAuthBtn = document.getElementById("showAuthBtn");
  const authContainer = document.getElementById("authContainer");
  const userMoney = document.getElementById("user-money");
  const gmBadge = document.getElementById("gmBadge");

  if (STATE.user) {
    guestWarning?.classList.add("hidden");
    logoutBtn?.classList.remove("hidden");
    showAuthBtn?.classList.add("hidden");
    authContainer?.classList.add("hidden");

    if (userMoney) {
      userMoney.innerText = STATE.user.money_label || "0з";
    }

    const role = String(STATE.user.role || "").toLowerCase();
    if (gmBadge) {
      if (role === "gm" || role === "admin") {
        gmBadge.classList.remove("hidden");
      } else {
        gmBadge.classList.add("hidden");
      }
    }
  } else {
    guestWarning?.classList.remove("hidden");
    logoutBtn?.classList.add("hidden");
    showAuthBtn?.classList.remove("hidden");

    if (userMoney) {
      userMoney.innerText = "0з";
    }

    gmBadge?.classList.add("hidden");
  }
}

function updateInventoryCounter() {
  const count = Array.isArray(STATE.inventory)
    ? STATE.inventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
    : 0;

  const inventoryCount = document.getElementById("inventoryCount");
  const inventoryCountModal = document.getElementById("inventoryCountModal");

  if (inventoryCount) inventoryCount.innerText = String(count);
  if (inventoryCountModal) inventoryCountModal.innerText = String(count);
}

function updateCartCounter() {
  const count = Array.isArray(STATE.cart) ? STATE.cart.length : 0;

  const cartCount = document.getElementById("cartCount");
  const cartCountModal = document.getElementById("cartCountModal");

  if (cartCount) cartCount.innerText = String(count);
  if (cartCountModal) cartCountModal.innerText = String(count);
}

function updateCartTotalLabels() {
  const totalGold = STATE.cart.reduce((sum, item) => {
    if (item.buy_price_gold != null) return sum + toNumber(item.buy_price_gold, 0);
    if (item.price_gold != null) return sum + toNumber(item.price_gold, 0);
    return sum;
  }, 0);

  const totalSilver = STATE.cart.reduce((sum, item) => {
    if (item.buy_price_silver != null) return sum + toNumber(item.buy_price_silver, 0);
    if (item.price_silver != null) return sum + toNumber(item.price_silver, 0);
    return sum;
  }, 0);

  const totalCopper = STATE.cart.reduce((sum, item) => {
    if (item.buy_price_copper != null) return sum + toNumber(item.buy_price_copper, 0);
    if (item.price_copper != null) return sum + toNumber(item.price_copper, 0);
    return sum;
  }, 0);

  const parts = [];
  if (totalGold) parts.push(`${totalGold}з`);
  if (totalSilver) parts.push(`${totalSilver}с`);
  if (totalCopper) parts.push(`${totalCopper}м`);
  if (!parts.length) parts.push("0з");

  const label = parts.join(" ");

  const cartTotal = document.getElementById("cart-total");
  const cartTotalModal = document.getElementById("cartTotalModal");

  if (cartTotal) cartTotal.innerText = label;
  if (cartTotalModal) cartTotalModal.innerText = label;
}

function renderAllLocalState() {
  renderCart(STATE.cart);
  renderInventory(STATE.inventory);
  updateCartCounter();
  updateCartTotalLabels();
  updateInventoryCounter();
}

function rerenderTraders() {
  const filtered = applyFilters(STATE.traders);
  renderTraders(filtered);
}

function findTraderById(traderId) {
  return STATE.traders.find((t) => Number(t.id) === Number(traderId)) || null;
}

function findTraderItem(traderId, itemId) {
  const trader = findTraderById(traderId);
  if (!trader || !Array.isArray(trader.items)) return null;
  return trader.items.find((item) => Number(item.id) === Number(itemId)) || null;
}

function getCartPayloadItem(traderId, itemId) {
  const item = findTraderItem(traderId, itemId);
  if (!item) return null;

  return {
    ...item,
    trader_id: traderId,
    item_id: itemId,
    price_label:
      item.buy_price_label ||
      item.price_label ||
      `${item.price_gold || 0}з`,
  };
}

// ------------------------------------------------------------
// 🔐 AUTH
// ------------------------------------------------------------
async function login(email, password) {
  const res = await fetch("/login", {
    method: "POST",
    headers: getAuthHeaders(true),
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    throw new Error("Ошибка входа");
  }

  const data = await res.json();

  STATE.token = data.access_token;
  STATE.user = data.user || null;

  localStorage.setItem("token", STATE.token);

  updateUserUI();
  showToast("Вход выполнен");
}

async function register(email, password) {
  const res = await fetch("/register", {
    method: "POST",
    headers: getAuthHeaders(true),
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    throw new Error("Ошибка регистрации");
  }

  const data = await res.json();

  STATE.token = data.access_token;
  STATE.user = data.user || null;

  localStorage.setItem("token", STATE.token);

  updateUserUI();
  showToast("Регистрация успешна");
}

async function loadMe() {
  if (!STATE.token) return;

  const res = await fetch("/me", {
    headers: getAuthHeaders(false),
  });

  if (!res.ok) {
    STATE.token = null;
    STATE.user = null;
    localStorage.removeItem("token");
    updateUserUI();
    return;
  }

  const data = await res.json();
  STATE.user = data.user || null;
  updateUserUI();
}

function logout() {
  STATE.token = null;
  STATE.user = null;
  STATE.inventory = [];
  STATE.cart = [];

  localStorage.removeItem("token");

  updateUserUI();
  renderAllLocalState();
  showToast("Вы вышли из аккаунта");
}

// ------------------------------------------------------------
// 🧙 LOAD TRADERS
// ------------------------------------------------------------
async function loadTraders() {
  try {
    const res = await fetch("/traders");
    if (!res.ok) throw new Error("Не удалось загрузить торговцев");

    const data = await res.json();
    STATE.traders = data.traders || [];

    populateFilterOptions(STATE.traders);
    rerenderTraders();
  } catch (e) {
    console.error("Ошибка загрузки торговцев", e);
    showToast("Ошибка загрузки торговцев");
  }
}

// ------------------------------------------------------------
// 🎒 LOAD INVENTORY
// ------------------------------------------------------------
async function loadInventory() {
  if (!STATE.token) {
    STATE.inventory = [];
    renderInventory([]);
    updateInventoryCounter();
    return;
  }

  try {
    const res = await fetch("/player/inventory", {
      headers: getAuthHeaders(false),
    });

    if (!res.ok) {
      throw new Error("Не удалось загрузить инвентарь");
    }

    const data = await res.json();
    STATE.inventory = data.items || [];

    renderInventory(STATE.inventory);
    updateInventoryCounter();
  } catch (e) {
    console.error("Ошибка загрузки инвентаря", e);
  }
}

// ------------------------------------------------------------
// 🛒 CART
// ------------------------------------------------------------
window.addToCart = function (traderId, itemId) {
  const cartItem = getCartPayloadItem(traderId, itemId);

  if (!cartItem) {
    showToast("Не удалось добавить товар");
    return;
  }

  const alreadyExists = STATE.cart.some(
    (item) =>
      Number(item.item_id || item.id) === Number(itemId) &&
      Number(item.trader_id) === Number(traderId)
  );

  if (alreadyExists) {
    showToast("Товар уже в корзине");
    return;
  }

  STATE.cart.push(cartItem);
  renderCart(STATE.cart);
  updateCartCounter();
  updateCartTotalLabels();
  showToast("Товар добавлен в корзину");
};

window.removeFromCart = function (itemId) {
  STATE.cart = STATE.cart.filter(
    (item) => Number(item.item_id || item.id) !== Number(itemId)
  );

  renderCart(STATE.cart);
  updateCartCounter();
  updateCartTotalLabels();
};

async function checkoutCart() {
  if (!STATE.token) {
    showToast("Нужно войти");
    return;
  }

  if (!STATE.cart.length) {
    showToast("Корзина пуста");
    return;
  }

  for (const item of STATE.cart) {
    const traderId = item.trader_id;
    const itemId = item.item_id || item.id;

    const res = await fetch("/buy", {
      method: "POST",
      headers: getAuthHeaders(true),
      body: JSON.stringify({
        trader_id: traderId,
        item_id: itemId,
        quantity: 1,
      }),
    });

    if (!res.ok) {
      console.error("Ошибка покупки товара:", item.name);
    }
  }

  STATE.cart = [];
  renderCart(STATE.cart);
  updateCartCounter();
  updateCartTotalLabels();

  await loadInventory();
  await loadTraders();
  await loadMe();

  showToast("Покупка завершена");
}

// ------------------------------------------------------------
// 💰 BUY / SELL
// ------------------------------------------------------------
window.buyItem = async function (traderId, itemId) {
  if (!STATE.token) {
    alert("Нужно войти");
    return;
  }

  const res = await fetch("/buy", {
    method: "POST",
    headers: getAuthHeaders(true),
    body: JSON.stringify({
      trader_id: traderId,
      item_id: itemId,
      quantity: 1,
    }),
  });

  if (!res.ok) {
    showToast("Ошибка покупки");
    return;
  }

  await loadInventory();
  await loadTraders();
  await loadMe();

  showToast("Предмет куплен");
};

window.sellItem = async function (itemId) {
  if (!STATE.token) {
    alert("Нужно войти");
    return;
  }

  const activeTraderId =
    window.__lastOpenedTraderId ||
    (STATE.traders.length ? STATE.traders[0].id : null);

  if (!activeTraderId) {
    showToast("Нет торговца для продажи");
    return;
  }

  const res = await fetch("/sell", {
    method: "POST",
    headers: getAuthHeaders(true),
    body: JSON.stringify({
      trader_id: activeTraderId,
      item_id: itemId,
      quantity: 1,
    }),
  });

  if (!res.ok) {
    showToast("Ошибка продажи");
    return;
  }

  await loadInventory();
  await loadTraders();
  await loadMe();

  showToast("Предмет продан");
};

// ------------------------------------------------------------
// 🖼 MODALS
// ------------------------------------------------------------
function bindModalButtons() {
  document.getElementById("viewInventoryBtn")?.addEventListener("click", () => {
    document.getElementById("inventoryModal").style.display = "block";
  });

  document.getElementById("viewCartBtn")?.addEventListener("click", () => {
    document.getElementById("cartModal").style.display = "block";
    renderCart(STATE.cart);
    updateCartCounter();
    updateCartTotalLabels();
  });

  document.getElementById("cabinetBtn")?.addEventListener("click", async () => {
    if (!STATE.token) {
      showToast("Нужно войти");
      return;
    }

    document.getElementById("cabinetModal").style.display = "block";
    switchCabinetTab("inventory");
    await loadCabinetAll();
  });

  document.getElementById("checkoutCartBtn")?.addEventListener("click", async () => {
    await checkoutCart();
  });

  document.getElementById("clearCartBtn")?.addEventListener("click", () => {
    STATE.cart = [];
    renderCart(STATE.cart);
    updateCartCounter();
    updateCartTotalLabels();
  });

  document.getElementById("clearCartBtnModal")?.addEventListener("click", () => {
    STATE.cart = [];
    renderCart(STATE.cart);
    updateCartCounter();
    updateCartTotalLabels();
  });

  document.getElementById("refreshDataBtn")?.addEventListener("click", async () => {
    await loadTraders();
    await loadInventory();
    await loadMe();
    showToast("Данные обновлены");
  });

  document.querySelectorAll(".close").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modal = btn.closest(".modal");
      if (modal) modal.style.display = "none";
    });
  });

  window.addEventListener("click", (e) => {
    document.querySelectorAll(".modal").forEach((modal) => {
      if (e.target === modal) {
        modal.style.display = "none";
      }
    });
  });
}

// ------------------------------------------------------------
// 🔐 AUTH BUTTONS
// ------------------------------------------------------------
function bindAuthButtons() {
  document.getElementById("showAuthBtn")?.addEventListener("click", () => {
    const authContainer = document.getElementById("authContainer");
    if (!authContainer) return;
    authContainer.classList.toggle("hidden");
  });

  document.getElementById("doLogin")?.addEventListener("click", async () => {
    const email = document.getElementById("loginEmail")?.value?.trim();
    const password = document.getElementById("loginPassword")?.value;

    if (!email || !password) {
      showToast("Введите email и пароль");
      return;
    }

    try {
      await login(email, password);
      await loadMe();
      await loadInventory();
    } catch (e) {
      console.error(e);
      showToast("Ошибка входа");
    }
  });

  document.getElementById("doRegister")?.addEventListener("click", async () => {
    const email = document.getElementById("loginEmail")?.value?.trim();
    const password = document.getElementById("loginPassword")?.value;

    if (!email || !password) {
      showToast("Введите email и пароль");
      return;
    }

    try {
      await register(email, password);
      await loadMe();
      await loadInventory();
    } catch (e) {
      console.error(e);
      showToast("Ошибка регистрации");
    }
  });

  document.getElementById("logoutBtn")?.addEventListener("click", () => {
    logout();
  });
}

// ------------------------------------------------------------
// 🔗 FILTERS
// ------------------------------------------------------------
function bindFilters() {
  bindFilterEvents(() => {
    rerenderTraders();
  });
}

// ------------------------------------------------------------
// 🌍 GLOBAL BRIDGES
// ------------------------------------------------------------
window.openTraderModal = async function (traderId) {
  window.__lastOpenedTraderId = traderId;
  await openTraderModal(traderId);
};

window.showToast = showToast;

// ------------------------------------------------------------
// 🚀 INIT
// ------------------------------------------------------------
async function init() {
  STATE.token = localStorage.getItem("token");

  bindAuthButtons();
  bindModalButtons();
  bindFilters();
  initCabinet();

  updateUserUI();
  renderAllLocalState();

  if (STATE.token) {
    await loadMe();
    await loadInventory();
  }

  await loadTraders();
}

init();