// ============================================================
// frontend/js/modules/tradeActions.js
// Buy/sell/checkout actions + trade UI helpers.
// ============================================================

export function confirmTradeAction(actionLabel, itemName, quantity) {
  return confirm(`${actionLabel} ${itemName} × ${quantity}?`);
}

export function buildCheckoutResult({
  success = false,
  purchased = 0,
  failed = 0,
  errors = [],
} = {}) {
  return { success, purchased, failed, errors };
}

export function formatCheckoutItemError(entry, error) {
  const itemName = entry?.name || "предмет";
  const message = error?.message || "";
  return message || `Ошибка покупки: ${itemName}`;
}

export function buildServerBuySnapshot({
  playerMoneyLabel,
  trader,
  traderItem,
  payload,
} = {}) {
  return {
    playerMoneyLabel: playerMoneyLabel || "",
    traderMoneyLabel: trader?.money_label || trader?.gold_label || String(trader?.gold || "—"),
    traderStock: traderItem?.stock ?? traderItem?.quantity ?? "—",
    payload,
  };
}

export function getBuyConfirmItem({
  traderId,
  itemId,
  cart = [],
  getTraderItem,
  findCartItemByTraderAndItemId,
} = {}) {
  const fromTrader = typeof getTraderItem === "function" ? getTraderItem(traderId, itemId) : null;
  return fromTrader || findCartItemByTraderAndItemId(cart, traderId, itemId);
}

export function createTradeActions(deps) {
  const {
    state,
    safeNumber,
    moneyPartsToCp,
    formatMoneyCp,
    getCurrentMoneyCp,
    getCurrentMoneyLabel,
    getTraderById,
    getTraderItem,
    getTraderMoneyCp,
    setTraderMoneyCp,
    findInventoryIndexByItemId,
    findInventoryItemById,
    getSellTotalCp,
    normalizeInventoryItem,
    ensureGuestSellPrices,
    persistGuestMoney,
    apiBuyItem,
    apiSellItem,
    updateUserMoneyFromPayload,
    patchTraderFromTradePayload,
    loadInventoryFromServer,
    refreshTraderById,
    getTraderMoneyFromTradePayload,
    setBusy,
    renderAllLocalState,
    rerenderTraders,
    syncOpenTraderModalIfVisible,
    showToast,
    logTradeSnapshot,
    syncGlobalStateBridges,
    findCartItemByTraderAndItemId,
    consumeCollectionEntry,
    getCartTotalUnits,
  } = deps;

  function applyLocalBuy(traderId, itemId, quantity = 1) {
    const trader = getTraderById(traderId);
    const traderItem = getTraderItem(traderId, itemId);
    const qty = Math.max(1, safeNumber(quantity, 1));

    if (!trader || !traderItem) throw new Error("Предмет или торговец не найден");

    const available = Math.max(0, safeNumber(traderItem.stock ?? traderItem.quantity, 0));
    if (available < qty) throw new Error(`У торговца только ${available} шт.`);

    const totalCp =
      moneyPartsToCp(
        traderItem.buy_price_gold ?? traderItem.price_gold,
        traderItem.buy_price_silver ?? traderItem.price_silver,
        traderItem.buy_price_copper ?? traderItem.price_copper
      ) * qty;

    const currentMoneyCp = getCurrentMoneyCp();
    if (currentMoneyCp < totalCp) throw new Error("Недостаточно средств");

    state.guestMoneyCp = Math.max(0, currentMoneyCp - totalCp);
    persistGuestMoney();

    const traderMoneyCp = getTraderMoneyCp(trader) + totalCp;
    setTraderMoneyCp(trader, traderMoneyCp);

    const invIndex = findInventoryIndexByItemId(state.inventory, itemId);
    if (invIndex >= 0) {
      state.inventory[invIndex].quantity = Math.max(
        1,
        safeNumber(state.inventory[invIndex].quantity, 1) + qty
      );
      ensureGuestSellPrices(state.inventory[invIndex], traderId);
    } else {
      const newItem = normalizeInventoryItem({
        ...traderItem,
        quantity: qty,
        trader_id: traderId,
      });
      ensureGuestSellPrices(newItem, traderId);
      state.inventory.push(newItem);
    }

    traderItem.stock = available - qty;
    traderItem.quantity = available - qty;

    const result = {
      totalCp,
      totalLabel: formatMoneyCp(totalCp),
      playerMoneyCp: state.guestMoneyCp,
      playerMoneyLabel: formatMoneyCp(state.guestMoneyCp),
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
      if (payloadTraderMoney) setTraderMoneyCp(trader, payloadTraderMoney.cp);
      else if (itemBuyCp > 0) setTraderMoneyCp(trader, traderBeforeCp + itemBuyCp);
    }

    syncGlobalStateBridges();
    return payload;
  }

  async function buyItem(traderId, itemId, quantity = 1, options = {}) {
    const qty = Math.max(1, safeNumber(quantity, 1));
    const settings = options && typeof options === "object" ? options : {};
    const source = String(settings.source || "trader");
    const skipConfirm = Boolean(settings.skipConfirm);

    if (!skipConfirm) {
      const item = getBuyConfirmItem({
        traderId,
        itemId,
        cart: state.cart,
        getTraderItem,
        findCartItemByTraderAndItemId,
      });
      const itemName = item?.name || "предмет";
      if (!confirmTradeAction("Купить", itemName, qty)) return { cancelled: true };
    }

    try {
      setBusy(true);
      let snapshot = null;

      if (state.token) {
        const payload = await applyServerBuy(traderId, itemId, qty);
        snapshot = buildServerBuySnapshot({
          playerMoneyLabel: getCurrentMoneyLabel(),
          trader: getTraderById(traderId),
          traderItem: getTraderItem(traderId, itemId),
          payload,
        });
      } else {
        snapshot = applyLocalBuy(traderId, itemId, qty);
      }

      if (source === "cart") consumeCollectionEntry(state.cart, traderId, itemId, qty);
      consumeCollectionEntry(state.reserved, traderId, itemId, qty);

      renderAllLocalState();
      rerenderTraders();
      await syncOpenTraderModalIfVisible(state.activeTraderId ?? traderId);

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
  }

  function applyLocalSell(itemId, quantity = 1) {
    const invIndex = findInventoryIndexByItemId(state.inventory, itemId);
    if (invIndex < 0) throw new Error("Предмет не найден в инвентаре");

    const item = state.inventory[invIndex];
    const qty = Math.max(1, safeNumber(quantity, 1));
    const owned = Math.max(0, safeNumber(item.quantity, 0));
    if (owned < qty) throw new Error(`У вас только ${owned} шт.`);

    const trader = item.trader_id != null ? getTraderById(item.trader_id) : null;
    const totalCp = getSellTotalCp(item, qty);

    state.guestMoneyCp = Math.max(0, getCurrentMoneyCp() + totalCp);
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

    if (owned === qty) state.inventory.splice(invIndex, 1);
    else state.inventory[invIndex].quantity = owned - qty;

    const result = {
      totalCp,
      totalLabel: formatMoneyCp(totalCp),
      playerMoneyCp: state.guestMoneyCp,
      playerMoneyLabel: formatMoneyCp(state.guestMoneyCp),
      itemName: item.name,
      qty,
    };

    logTradeSnapshot("SELL_OK", result);
    syncGlobalStateBridges();
    return result;
  }

  async function applyServerSell(itemId, quantity = 1) {
    const inventoryEntry = findInventoryItemById(state.inventory, itemId);
    const traderId = inventoryEntry?.trader_id ?? null;
    const traderBeforeCp = traderId != null ? getTraderMoneyCp(getTraderById(traderId)) : 0;
    const sellDeltaCp = inventoryEntry ? getSellTotalCp(inventoryEntry, quantity) : 0;

    const payload = await apiSellItem(itemId, traderId, quantity);
    updateUserMoneyFromPayload(payload);

    if (traderId != null) patchTraderFromTradePayload(traderId, itemId, payload, quantity, "sell");
    await loadInventoryFromServer();

    if (traderId != null) {
      await refreshTraderById(traderId);
      const payloadTraderMoney = getTraderMoneyFromTradePayload(payload);
      const trader = getTraderById(traderId);
      if (trader) {
        if (payloadTraderMoney) setTraderMoneyCp(trader, payloadTraderMoney.cp);
        else if (sellDeltaCp > 0) setTraderMoneyCp(trader, Math.max(0, traderBeforeCp - sellDeltaCp));
      }
    }

    syncGlobalStateBridges();
    return payload;
  }

  async function sellItem(itemId, quantity = 1, options = {}) {
    const qty = Math.max(1, safeNumber(quantity, 1));
    const settings = options && typeof options === "object" ? options : {};
    const skipConfirm = Boolean(settings.skipConfirm);

    if (!skipConfirm) {
      const item = findInventoryItemById(state.inventory, itemId);
      const itemName = item?.name || "предмет";
      if (!confirmTradeAction("Продать", itemName, qty)) return { cancelled: true };
    }

    try {
      setBusy(true);
      if (state.token) await applyServerSell(itemId, qty);
      else applyLocalSell(itemId, qty);

      renderAllLocalState();
      rerenderTraders();
      await syncOpenTraderModalIfVisible(state.activeTraderId);
      showToast(`Продажа успешна • Ваше золото: ${getCurrentMoneyLabel()}`);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Ошибка продажи");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function checkoutCart() {
    if (!Array.isArray(state.cart) || !state.cart.length) {
      showToast("Корзина пуста");
      return buildCheckoutResult({ errors: ["Корзина пуста"] });
    }

    const totalItems = getCartTotalUnits();
    if (!confirm(`Оформить корзину? Позиций: ${state.cart.length}, предметов: ${totalItems}.`)) {
      return buildCheckoutResult({ errors: ["cancelled"] });
    }

    const items = [...state.cart];
    const errors = [];
    let purchased = 0;

    for (const entry of items) {
      try {
        await buyItem(entry.trader_id, entry.item_id || entry.id, entry.quantity, {
          skipConfirm: true,
          source: "cart",
        });
        purchased += 1;
      } catch (error) {
        errors.push(formatCheckoutItemError(entry, error));
      }
    }

    renderAllLocalState();
    return buildCheckoutResult({
      success: errors.length === 0,
      purchased,
      failed: errors.length,
      errors,
    });
  }

  return { buyItem, sellItem, checkoutCart };
}
