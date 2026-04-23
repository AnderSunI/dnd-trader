// ============================================================
// frontend/js/modules/inventoryActions.js
// Inventory/cart/reserved actions + shared inventory helpers.
// ============================================================

function normalizePositiveInt(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.trunc(num));
}

export function getCollectionKey(traderId, itemId) {
  return `${traderId ?? "none"}:${Number(itemId)}`;
}

export function findCollectionItemIndex(collection, traderId, itemId) {
  const key = getCollectionKey(traderId, itemId);
  return collection.findIndex(
    (entry) => getCollectionKey(entry.trader_id, entry.item_id || entry.id) === key
  );
}

export function consumeCollectionEntry(collection, traderId, itemId, quantity = 1) {
  const index = findCollectionItemIndex(collection, traderId, itemId);
  if (index < 0) return null;

  const currentQty = normalizePositiveInt(collection[index]?.quantity, 1);
  const delta = normalizePositiveInt(quantity, 1);

  if (currentQty <= delta) {
    const [removed] = collection.splice(index, 1);
    return removed || null;
  }

  collection[index].quantity = currentQty - delta;
  return collection[index];
}

export function removeCollectionItem(collection, itemId, traderId = null) {
  const index = findCollectionItemIndex(collection, traderId, itemId);
  if (index < 0) return null;
  const [removed] = collection.splice(index, 1);
  return removed || null;
}

export function findCartItemByTraderAndItemId(cart, traderId, itemId) {
  return (
    cart.find(
      (entry) =>
        Number(entry.trader_id) === Number(traderId) &&
        Number(entry.item_id || entry.id) === Number(itemId)
    ) || null
  );
}

export function getAvailableStock(item, safeNumber) {
  return Math.max(0, safeNumber(item?.stock ?? item?.quantity, 0));
}

export function getCartExistingQuantity(cart, traderId, itemId, safeNumber) {
  const index = findCollectionItemIndex(cart, traderId, itemId);
  if (index < 0) return { index: -1, quantity: 0 };
  return {
    index,
    quantity: Math.max(1, safeNumber(cart[index]?.quantity, 1)),
  };
}

export function findItemInCollectionById(collection, numericId) {
  return collection.find((item) => Number(item.id || item.item_id) === numericId) || null;
}

export function findInventoryIndexByItemId(inventory, itemId) {
  return inventory.findIndex((entry) => Number(entry.id || entry.item_id) === Number(itemId));
}

export function findInventoryItemById(inventory, itemId) {
  return inventory.find((entry) => Number(entry.id || entry.item_id) === Number(itemId)) || null;
}

export function createInventoryActions({
  state,
  safeNumber,
  showToast,
  syncGlobalStateBridges,
  renderAllLocalState,
  renderCart,
  getTraderItem,
  normalizeCollectionItem,
}) {
  function addToCart(traderId, itemId, quantity = 1) {
    const item = getTraderItem(traderId, itemId);
    if (!item) {
      showToast("Предмет не найден");
      return;
    }

    const qty = Math.max(1, safeNumber(quantity, 1));
    const available = getAvailableStock(item, safeNumber);
    const { index, quantity: existingQty } = getCartExistingQuantity(
      state.cart,
      traderId,
      itemId,
      safeNumber
    );
    const nextQty = existingQty + qty;

    if (available > 0 && nextQty > available) {
      showToast(`У торговца только ${available} шт.`);
      return;
    }

    if (index >= 0) {
      state.cart[index].quantity = nextQty;
    } else {
      state.cart.push(normalizeCollectionItem(traderId, item, qty));
    }

    syncGlobalStateBridges();
    renderAllLocalState();
    showToast(`В корзину добавлено: ${item.name} × ${qty}`);
  }

  function reserveItem(itemId, traderId = null, quantity = 1) {
    const qty = Math.max(1, safeNumber(quantity, 1));

    let item = null;
    let sourceTraderId = traderId;

    if (traderId != null) {
      item = getTraderItem(traderId, itemId);
    } else {
      item =
        state.cart.find((entry) => Number(entry.item_id || entry.id) === Number(itemId)) ||
        state.reserved.find((entry) => Number(entry.item_id || entry.id) === Number(itemId)) ||
        null;
      sourceTraderId = item?.trader_id ?? null;
    }

    if (!item) {
      showToast("Предмет для резерва не найден");
      return;
    }

    const index = findCollectionItemIndex(state.reserved, sourceTraderId, itemId);
    if (index >= 0) {
      state.reserved[index].quantity = Math.max(
        1,
        safeNumber(state.reserved[index].quantity, 1) + qty
      );
    } else {
      state.reserved.push(normalizeCollectionItem(sourceTraderId, item, qty));
    }

    syncGlobalStateBridges();
    renderCart(state.cart);
    showToast(`Зарезервировано: ${item.name} × ${qty}`);
  }

  function unreserveItem(itemId, traderId = null) {
    const removed = removeCollectionItem(state.reserved, itemId, traderId);
    if (!removed) {
      showToast("Резерв не найден");
      return;
    }

    syncGlobalStateBridges();
    renderCart(state.cart);
    showToast(`Снят резерв: ${removed?.name || "предмет"}`);
  }

  function removeFromCart(itemId, traderId = null) {
    const removed = removeCollectionItem(state.cart, itemId, traderId);
    if (!removed) {
      showToast("Предмет в корзине не найден");
      return;
    }

    syncGlobalStateBridges();
    renderAllLocalState();
    showToast(`Удалено из корзины: ${removed?.name || "предмет"}`);
  }

  function clearCartAction() {
    state.cart = [];
    syncGlobalStateBridges();
    renderAllLocalState();
    showToast("Корзина очищена");
  }

  function removeInventoryItem(itemId) {
    const index = state.inventory.findIndex(
      (entry) => Number(entry.id || entry.item_id) === Number(itemId)
    );

    if (index < 0) {
      showToast("Предмет не найден в инвентаре");
      return;
    }

    const target = state.inventory[index];
    if (!confirm(`Удалить из инвентаря ${target?.name || "предмет"}?`)) return;

    const [removed] = state.inventory.splice(index, 1);
    syncGlobalStateBridges();
    renderAllLocalState();
    showToast(`Удалено из инвентаря: ${removed?.name || "предмет"}`);
  }

  function getItemForDescription(itemId, context = "trader", traderId = null) {
    const numericId = Number(itemId);

    if (context === "inventory") return findItemInCollectionById(state.inventory, numericId);
    if (context === "cart") return findItemInCollectionById(state.cart, numericId);
    if (context === "reserved") return findItemInCollectionById(state.reserved, numericId);
    if (traderId != null) return getTraderItem(traderId, numericId);

    for (const trader of state.traders) {
      const found = getTraderItem(trader.id, numericId);
      if (found) return found;
    }

    return null;
  }

  return {
    addToCart,
    reserveItem,
    unreserveItem,
    removeFromCart,
    clearCartAction,
    removeInventoryItem,
    getItemForDescription,
  };
}
