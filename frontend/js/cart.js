// ============================================================
// frontend/js/cart.js
// Корзина под текущую модульную схему.
// Не тащит отдельный state.js, а работает через глобальные
// window-экшены, которые поднимает app.js.
// ============================================================

// ------------------------------------------------------------
// 🧰 HELPERS
// ------------------------------------------------------------
function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getReservedItemsSafe() {
  if (typeof window.getReservedItems === "function") {
    const items = window.getReservedItems();
    return Array.isArray(items) ? items : [];
  }
  return [];
}

function getItemId(item) {
  return Number(item?.item_id ?? item?.id ?? 0);
}

function getTraderId(item) {
  return Number(item?.trader_id ?? item?.owner_trader_id ?? item?.traderId ?? 0);
}

function formatMoneyParts(gold = 0, silver = 0, copper = 0) {
  const parts = [];
  if (Number(gold || 0)) parts.push(`${Number(gold)}з`);
  if (Number(silver || 0)) parts.push(`${Number(silver)}с`);
  if (Number(copper || 0)) parts.push(`${Number(copper)}м`);
  return parts.length ? parts.join(" ") : "0з";
}

function normalizeMoney(gold = 0, silver = 0, copper = 0) {
  let g = toNumber(gold, 0);
  let s = toNumber(silver, 0);
  let c = toNumber(copper, 0);

  s += Math.floor(c / 100);
  c %= 100;

  g += Math.floor(s / 100);
  s %= 100;

  return { gold: g, silver: s, copper: c };
}

function getBuyPriceParts(item) {
  return normalizeMoney(
    item?.buy_price_gold ?? item?.price_gold ?? 0,
    item?.buy_price_silver ?? item?.price_silver ?? 0,
    item?.buy_price_copper ?? item?.price_copper ?? 0
  );
}

function formatItemPrice(item) {
  const { gold, silver, copper } = getBuyPriceParts(item);
  return formatMoneyParts(gold, silver, copper);
}

function showToast(message) {
  if (typeof window.showToast === "function") {
    window.showToast(message);
    return;
  }
  console.log(message);
}

// ------------------------------------------------------------
// 🔎 ACCESSORS
// ------------------------------------------------------------
export function getCartItems() {
  if (Array.isArray(window.__appCartState)) {
    return window.__appCartState;
  }
  return [];
}

export function setCartItemsReference(items) {
  window.__appCartState = Array.isArray(items) ? items : [];
}

export function findCartItem(itemId, traderId = null) {
  const targetItemId = Number(itemId);
  const targetTraderId =
    traderId !== null && traderId !== undefined ? Number(traderId) : null;

  return (
    getCartItems().find((item) => {
      const sameItem = getItemId(item) === targetItemId;
      if (!sameItem) return false;
      if (targetTraderId === null) return true;
      return getTraderId(item) === targetTraderId;
    }) || null
  );
}

export function hasCartItem(itemId, traderId = null) {
  return !!findCartItem(itemId, traderId);
}

// ------------------------------------------------------------
// ➕ ДОБАВЛЕНИЕ
// ------------------------------------------------------------
export function addItemToCart(item, quantity = 1) {
  const itemId = getItemId(item);
  const traderId = getTraderId(item);

  if (!itemId || !traderId) return false;
  if (typeof window.addToCart !== "function") return false;

  window.addToCart(traderId, itemId, Math.max(1, toNumber(quantity, 1)));
  return true;
}

export function addTraderItemToCart(traderId, itemId, quantity = 1) {
  if (typeof window.addToCart !== "function") return false;
  window.addToCart(
    Number(traderId),
    Number(itemId),
    Math.max(1, toNumber(quantity, 1))
  );
  return true;
}

// ------------------------------------------------------------
// ➖ УДАЛЕНИЕ
// ------------------------------------------------------------
export function removeItemFromCart(itemId, traderId = null) {
  if (typeof window.removeFromCart !== "function") return false;
  window.removeFromCart(Number(itemId), traderId != null ? Number(traderId) : null);
  return true;
}

export function clearEntireCart() {
  const items = [...getCartItems()];
  if (!items.length) return true;

  if (typeof window.removeFromCart !== "function") return false;

  for (const item of items) {
    window.removeFromCart(getItemId(item), getTraderId(item));
  }

  return true;
}

// ------------------------------------------------------------
// 🔢 QUANTITY
// ------------------------------------------------------------
export function increaseCartQuantity(itemId, traderId = null, amount = 1) {
  const item = findCartItem(itemId, traderId);
  if (!item) return false;

  const qty = toNumber(item.quantity, 1) + Math.abs(toNumber(amount, 1));

  if (typeof window.addToCart === "function") {
    const delta = qty - toNumber(item.quantity, 1);
    if (delta > 0) {
      window.addToCart(getTraderId(item), getItemId(item), delta);
      return true;
    }
  }

  return false;
}

export function decreaseCartQuantity(itemId, traderId = null, amount = 1) {
  const item = findCartItem(itemId, traderId);
  if (!item) return false;

  const current = toNumber(item.quantity, 1);
  const target = current - Math.abs(toNumber(amount, 1));

  if (target <= 0) {
    return removeItemFromCart(getItemId(item), getTraderId(item));
  }

  // У app.js нет отдельного set/update quantity, поэтому пересобираем позицию:
  removeItemFromCart(getItemId(item), getTraderId(item));
  addTraderItemToCart(getTraderId(item), getItemId(item), target);

  return true;
}

export function setCartItemQuantity(itemId, traderId = null, quantity = 1) {
  const item = findCartItem(itemId, traderId);
  if (!item) return false;

  const target = Math.max(0, toNumber(quantity, 1));

  removeItemFromCart(getItemId(item), getTraderId(item));

  if (target > 0) {
    addTraderItemToCart(getTraderId(item), getItemId(item), target);
  }

  return true;
}

// ------------------------------------------------------------
// 💰 TOTALS
// ------------------------------------------------------------
export function calculateCartTotals() {
  let gold = 0;
  let silver = 0;
  let copper = 0;

  getCartItems().forEach((item) => {
    const qty = Math.max(1, toNumber(item.quantity, 1));
    const price = getBuyPriceParts(item);

    gold += price.gold * qty;
    silver += price.silver * qty;
    copper += price.copper * qty;
  });

  const normalized = normalizeMoney(gold, silver, copper);

  return {
    gold: normalized.gold,
    silver: normalized.silver,
    copper: normalized.copper,
    label: formatMoneyParts(normalized.gold, normalized.silver, normalized.copper),
  };
}

export function getCartItemsCount() {
  return getCartItems().reduce(
    (sum, item) => sum + Math.max(1, toNumber(item.quantity, 1)),
    0
  );
}

// ------------------------------------------------------------
// 🛒 CHECKOUT
// ------------------------------------------------------------
async function checkoutSingleCartItem(item) {
  const traderId = getTraderId(item);
  const itemId = getItemId(item);
  const quantity = Math.max(1, toNumber(item.quantity, 1));

  if (!traderId) {
    throw new Error(`Не найден trader_id для ${item?.name || "предмета"}`);
  }

  if (typeof window.buyItem !== "function") {
    throw new Error("Функция покупки не подключена");
  }

  await window.buyItem(traderId, itemId, quantity);
}

export async function checkoutCart() {
  const cartItems = [...getCartItems()];

  if (!cartItems.length) {
    return {
      success: false,
      purchased: 0,
      failed: 0,
      errors: ["Корзина пуста"],
    };
  }

  const errors = [];
  let purchased = 0;
  let failed = 0;

  for (const item of cartItems) {
    try {
      await checkoutSingleCartItem(item);
      purchased += 1;
    } catch (error) {
      failed += 1;
      errors.push(`${item?.name || "Предмет"}: ${error.message}`);
      console.error("Ошибка checkout:", error);
    }
  }

  return {
    success: failed === 0,
    purchased,
    failed,
    errors,
  };
}

// ------------------------------------------------------------
// 💸 QUICK BUY
// ------------------------------------------------------------
export async function quickBuy(traderId, itemId, quantity = 1) {
  if (typeof window.buyItem !== "function") {
    throw new Error("Функция покупки не подключена");
  }

  await window.buyItem(
    Number(traderId),
    Number(itemId),
    Math.max(1, toNumber(quantity, 1))
  );
  return true;
}

// ------------------------------------------------------------
// 📌 RESERVE
// ------------------------------------------------------------
export function reserveCartItem(itemId, traderId = null, quantity = 1) {
  const item = findCartItem(itemId, traderId);
  if (!item) return false;

  if (typeof window.reserveItem !== "function") return false;

  window.reserveItem(
    getItemId(item),
    getTraderId(item),
    Math.max(1, toNumber(quantity, 1))
  );

  return true;
}

export function unreserveCartItem(itemId, traderId = null) {
  if (typeof window.unreserveItem !== "function") return false;
  window.unreserveItem(
    Number(itemId),
    traderId != null ? Number(traderId) : null
  );
  return true;
}

export function getReservedCount() {
  return getReservedItemsSafe().reduce(
    (sum, item) => sum + Math.max(1, toNumber(item.quantity, 1)),
    0
  );
}

// ------------------------------------------------------------
// 🧾 SUMMARY
// ------------------------------------------------------------
export function getCartSummary() {
  const totals = calculateCartTotals();

  return {
    count: getCartItemsCount(),
    reservedCount: getReservedCount(),
    totals,
    items: getCartItems(),
    reserved: getReservedItemsSafe(),
  };
}

// ------------------------------------------------------------
// 🔘 UI HELPERS
// ------------------------------------------------------------
export function syncCartUiCounters() {
  const summary = getCartSummary();

  const cartCount = document.getElementById("cartCount");
  const cartCountModal = document.getElementById("cartCountModal");
  const cartTotal = document.getElementById("cart-total");
  const cartTotalModal = document.getElementById("cartTotalModal");

  if (cartCount) cartCount.textContent = String(summary.count);
  if (cartCountModal) cartCountModal.textContent = String(summary.count);
  if (cartTotal) cartTotal.textContent = summary.totals.label;
  if (cartTotalModal) cartTotalModal.textContent = summary.totals.label;
}

export function notifyCheckoutResult(result) {
  if (!result?.success) {
    if (Array.isArray(result?.errors) && result.errors.length) {
      showToast(result.errors[0]);
    } else {
      showToast("Не удалось оформить заказ");
    }
    return;
  }

  showToast(`Оформлено позиций: ${result.purchased}`);
}

// ------------------------------------------------------------
// 🌐 GLOBAL ACTIONS
// ------------------------------------------------------------
window.cartModule = {
  getCartItems,
  setCartItemsReference,
  findCartItem,
  hasCartItem,
  addItemToCart,
  addTraderItemToCart,
  removeItemFromCart,
  clearEntireCart,
  increaseCartQuantity,
  decreaseCartQuantity,
  setCartItemQuantity,
  calculateCartTotals,
  getCartItemsCount,
  checkoutCart,
  quickBuy,
  reserveCartItem,
  unreserveCartItem,
  getReservedCount,
  getCartSummary,
  syncCartUiCounters,
  notifyCheckoutResult,
};