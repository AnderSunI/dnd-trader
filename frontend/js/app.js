import {
  renderTraders,
  renderCart,
  renderInventory,
  openTraderModal,
} from "./render.js";

const STATE = {
  token: localStorage.getItem("token") || "",
  user: null,
  traders: [],
  cart: [],
  inventory: [],
};

function debug(msg) {
  let box = document.getElementById("debugBox");
  if (!box) {
    box = document.createElement("pre");
    box.id = "debugBox";
    box.style.cssText =
      "position:fixed;left:10px;bottom:10px;z-index:99999;max-width:70vw;max-height:40vh;overflow:auto;background:#111;color:#0f0;padding:10px;border:2px solid #0f0;border-radius:8px;font:12px monospace;white-space:pre-wrap;";
    document.body.appendChild(box);
  }
  box.textContent += `${msg}\n`;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) {
    debug(`toast: ${message}`);
    return;
  }

  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.style.opacity = "1";

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.classList.add("hidden"), 300);
  }, 1800);
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) {
    debug(`modal not found: ${modalId}`);
    return;
  }
  modal.style.display = "block";
  debug(`opened modal: ${modalId}`);
}

function closeModal(modal) {
  if (modal) modal.style.display = "none";
}

function normalizeApiList(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  return [];
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

    if (userMoney) userMoney.innerText = STATE.user.money_label || "0з";

    const role = String(STATE.user.role || "").toLowerCase();
    if (gmBadge) {
      if (role === "gm" || role === "admin") gmBadge.classList.remove("hidden");
      else gmBadge.classList.add("hidden");
    }
  } else {
    guestWarning?.classList.remove("hidden");
    logoutBtn?.classList.add("hidden");
    showAuthBtn?.classList.remove("hidden");
    authContainer?.classList.add("hidden");
    gmBadge?.classList.add("hidden");
    if (userMoney) userMoney.innerText = "0з";
  }
}

function updateCartCounter() {
  const count = Array.isArray(STATE.cart)
    ? STATE.cart.reduce((sum, item) => sum + safeNumber(item.quantity, 1), 0)
    : 0;

  document.getElementById("cartCount")?.replaceChildren(document.createTextNode(String(count)));
  document.getElementById("cartCountModal")?.replaceChildren(document.createTextNode(String(count)));
}

function updateInventoryCounter() {
  const count = Array.isArray(STATE.inventory)
    ? STATE.inventory.reduce((sum, item) => sum + safeNumber(item.quantity, 0), 0)
    : 0;

  document.getElementById("inventoryCount")?.replaceChildren(document.createTextNode(String(count)));
  document.getElementById("inventoryCountModal")?.replaceChildren(document.createTextNode(String(count)));
}

function updateCartTotalLabels() {
  const totalGold = STATE.cart.reduce(
    (sum, item) => sum + safeNumber(item.price_gold ?? item.buy_price_gold, 0) * safeNumber(item.quantity, 1),
    0
  );
  const totalSilver = STATE.cart.reduce(
    (sum, item) => sum + safeNumber(item.price_silver ?? item.buy_price_silver, 0) * safeNumber(item.quantity, 1),
    0
  );
  const totalCopper = STATE.cart.reduce(
    (sum, item) => sum + safeNumber(item.price_copper ?? item.buy_price_copper, 0) * safeNumber(item.quantity, 1),
    0
  );

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

async function loadTraders() {
  debug("loadTraders:start");
  const res = await fetch("/traders");
  debug(`loadTraders:status ${res.status}`);
  if (!res.ok) throw new Error(`Ошибка загрузки торговцев: ${res.status}`);

  const data = await res.json();
  STATE.traders = normalizeApiList(data, "traders");
  debug(`loadTraders:count ${STATE.traders.length}`);
  renderTraders(STATE.traders);
}

function bindToolbarButtons() {
  debug("bindToolbarButtons:start");

  document.getElementById("viewCartBtn")?.addEventListener("click", () => {
    debug("click:viewCartBtn");
    renderCart(STATE.cart);
    updateCartCounter();
    updateCartTotalLabels();
    openModal("cartModal");
  });

  document.getElementById("clearCartBtn")?.addEventListener("click", () => {
    debug("click:clearCartBtn");
    STATE.cart = [];
    renderAllLocalState();
    showToast("Корзина очищена");
  });

  document.getElementById("clearCartBtnModal")?.addEventListener("click", () => {
    debug("click:clearCartBtnModal");
    STATE.cart = [];
    renderAllLocalState();
    showToast("Корзина очищена");
  });

  document.getElementById("viewInventoryBtn")?.addEventListener("click", () => {
    debug("click:viewInventoryBtn");
    renderInventory(STATE.inventory);
    updateInventoryCounter();
    openModal("inventoryModal");
  });

  document.getElementById("cabinetBtn")?.addEventListener("click", () => {
    debug("click:cabinetBtn");
    openModal("cabinetModal");
  });

  document.getElementById("refreshDataBtn")?.addEventListener("click", async () => {
    debug("click:refreshDataBtn");
    await loadTraders();
    showToast("Данные обновлены");
  });

  debug("bindToolbarButtons:done");
}

function bindAuthButtons() {
  debug("bindAuthButtons:start");

  document.getElementById("showAuthBtn")?.addEventListener("click", () => {
    debug("click:showAuthBtn");
    document.getElementById("authContainer")?.classList.toggle("hidden");
  });

  document.getElementById("logoutBtn")?.addEventListener("click", () => {
    debug("click:logoutBtn");
    STATE.token = "";
    STATE.user = null;
    localStorage.removeItem("token");
    updateUserUI();
    showToast("Вы вышли");
  });

  debug("bindAuthButtons:done");
}

function bindFilters() {
  debug("bindFilters:start");

  [
    "searchInput",
    "typeFilter",
    "regionFilter",
    "playerLevelFilter",
    "reputationFilter",
    "itemSearchInput",
    "priceFilter",
    "rarityFilter",
    "categoryFilter",
    "magicFilter",
    "sortFilter",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    const rerender = () => {
      debug(`filter:${id}`);
      renderTraders(STATE.traders);
    };

    el.addEventListener("input", rerender);
    el.addEventListener("change", rerender);
  });

  debug("bindFilters:done");
}

function bindModalButtons() {
  debug("bindModalButtons:start");

  document.querySelectorAll(".close").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modal = btn.closest(".modal");
      debug(`click:close ${modal?.id || "unknown"}`);
      closeModal(modal);
    });
  });

  window.addEventListener("click", (event) => {
    document.querySelectorAll(".modal").forEach((modal) => {
      if (event.target === modal) {
        debug(`overlayClose:${modal.id}`);
        closeModal(modal);
      }
    });
  });

  debug("bindModalButtons:done");
}

window.openTraderModal = async function (traderId) {
  debug(`window.openTraderModal:${traderId}`);
  await openTraderModal(traderId);
};

window.addToCart = function (traderId, itemId) {
  debug(`window.addToCart:${traderId}:${itemId}`);
  showToast(`В корзину: trader=${traderId}, item=${itemId}`);
};

window.buyItem = async function (traderId, itemId) {
  debug(`window.buyItem:${traderId}:${itemId}`);
  showToast(`Купить: trader=${traderId}, item=${itemId}`);
};

window.sellItem = async function (itemId) {
  debug(`window.sellItem:${itemId}`);
  showToast(`Продать: item=${itemId}`);
};

window.removeFromCart = function (itemId) {
  debug(`window.removeFromCart:${itemId}`);
  STATE.cart = STATE.cart.filter((item) => Number(item.item_id || item.id) !== Number(itemId));
  renderAllLocalState();
};

window.addEventListener("error", (e) => {
  debug(`JS ERROR: ${e.message} @ ${e.filename}:${e.lineno}`);
});

window.addEventListener("unhandledrejection", (e) => {
  debug(`PROMISE ERROR: ${e.reason}`);
});

async function init() {
  debug("init:start");
  bindAuthButtons();
  bindToolbarButtons();
  bindModalButtons();
  bindFilters();
  updateUserUI();
  renderAllLocalState();
  await loadTraders();
  debug("init:done");
}

init().catch((err) => {
  debug(`INIT CRASH: ${err?.stack || err}`);
});