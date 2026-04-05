// ============================================================
// frontend/js/cart.js
// Вся логика корзины.
// Здесь:
// - добавление
// - удаление
// - checkout
// - batch purchase
// - totals
// ============================================================

import {
  state,
  addToCart,
  removeFromCart,
  updateCartQuantity,
  clearCart,
} from "./state.js";

import {
  buyItem,
} from "./api.js";

import {
  renderCart,
} from "./render.js";

// ============================================================
// 🧰 ВСПОМОГАТЕЛЬНОЕ
// ============================================================

// Безопасное число
function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Найти товар в корзине
export function findCartItem(itemId) {
  return state.cart.find((item) => item.id === itemId) || null;
}

// Есть ли товар в корзине
export function hasCartItem(itemId) {
  return !!findCartItem(itemId);
}

// ============================================================
// ➕ ДОБАВЛЕНИЕ
// ============================================================

// Добавить предмет в корзину
export function addItemToCart(item, quantity = 1) {
  if (!item || !item.id) return false;

  addToCart(item, quantity);
  renderCart(state.cart);
  return true;
}

// Добавить товар торговца в корзину
export function addTraderItemToCart(traderId, itemId) {
  const trader = state.traders.find((t) => t.id === traderId);
  if (!trader || !Array.isArray(trader.items)) return false;

  const item = trader.items.find((i) => i.id === itemId);
  if (!item) return false;

  return addItemToCart(item, 1);
}

// ============================================================
// ➖ УДАЛЕНИЕ
// ============================================================

// Удалить один товар
export function removeItemFromCart(itemId) {
  removeFromCart(itemId);
  renderCart(state.cart);
}

// Удалить всё
export function clearEntireCart() {
  clearCart();
  renderCart(state.cart);
}

// ============================================================
// 🔢 QUANTITY
// ============================================================

// Увеличить количество
export function increaseCartQuantity(itemId, amount = 1) {
  updateCartQuantity(itemId, Math.abs(amount));
  renderCart(state.cart);
}

// Уменьшить количество
export function decreaseCartQuantity(itemId, amount = 1) {
  updateCartQuantity(itemId, -Math.abs(amount));
  renderCart(state.cart);
}

// Установить точное количество
export function setCartItemQuantity(itemId, quantity) {
  const item = findCartItem(itemId);
  if (!item) return;

  const target = Math.max(0, toNumber(quantity, 1));
  const delta = target - toNumber(item.quantity, 1);

  updateCartQuantity(itemId, delta);
  renderCart(state.cart);
}

// ============================================================
// 💰 TOTALS
// ============================================================

// Подсчитать общую сумму корзины
export function calculateCartTotals() {
  let gold = 0;
  let silver = 0;
  let copper = 0;

  state.cart.forEach((item) => {
    const qty = toNumber(item.quantity, 1);

    gold += toNumber(item.buy_price_gold ?? item.price_gold ?? 0) * qty;
    silver += toNumber(item.buy_price_silver ?? item.price_silver ?? 0) * qty;
    copper += toNumber(item.buy_price_copper ?? item.price_copper ?? 0) * qty;
  });

  // Нормализация меди/серебра
  silver += Math.floor(copper / 100);
  copper = copper % 100;

  gold += Math.floor(silver / 100);
  silver = silver % 100;

  return {
    gold,
    silver,
    copper,
    label: `${gold}з ${silver}с ${copper}м`,
  };
}

// Получить количество позиций
export function getCartItemsCount() {
  return state.cart.reduce(
    (sum, item) => sum + toNumber(item.quantity, 1),
    0
  );
}

// ============================================================
// 🛒 CHECKOUT
// ============================================================

// Купить один cart item
async function checkoutSingleCartItem(item) {
  const traderId =
    item.trader_id ||
    item.owner_trader_id ||
    state.selectedTraderId;

  if (!traderId) {
    throw new Error(`Не найден trader_id для ${item.name}`);
  }

  const quantity = toNumber(item.quantity, 1);

  await buyItem(item.id, traderId, quantity);
}

// Купить всю корзину
export async function checkoutCart() {
  if (!state.cart.length) {
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

  // Важно: делаем копию массива,
  // чтобы можно было безопасно очищать
  const itemsToBuy = [...state.cart];

  for (const item of itemsToBuy) {
    try {
      await checkoutSingleCartItem(item);
      purchased += 1;
    } catch (error) {
      failed += 1;
      errors.push(`${item.name}: ${error.message}`);
      console.error("Ошибка checkout:", error);
    }
  }

  // Если всё успешно — чистим корзину
  if (failed === 0) {
    clearEntireCart();
  } else {
    renderCart(state.cart);
  }

  return {
    success: failed === 0,
    purchased,
    failed,
    errors,
  };
}

// ============================================================
// 💸 QUICK BUY
// ============================================================

// Быстрая покупка без открытия карточки
export async function quickBuy(traderId, itemId, quantity = 1) {
  const trader = state.traders.find((t) => t.id === traderId);
  if (!trader) {
    throw new Error("Торговец не найден");
  }

  const item = trader.items?.find((i) => i.id === itemId);
  if (!item) {
    throw new Error("Товар не найден");
  }

  await buyItem(itemId, traderId, quantity);
  return true;
}

// ============================================================
// 🌐 GLOBAL ACTIONS
// ============================================================

// Чтобы старый main UX не ломался
window.cartModule = {
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
};