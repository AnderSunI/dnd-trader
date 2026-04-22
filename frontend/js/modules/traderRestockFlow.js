// ============================================================
// frontend/js/modules/traderRestockFlow.js
// Flow/helper-функции restock торговца.
// ============================================================

export function applyLocalGuestRestockToTrader({
  trader,
  reroll = false,
  safeNumber,
  getNextRestockStock,
} = {}) {
  if (!trader || !Array.isArray(trader.items)) return false;

  for (const item of trader.items) {
    const baseStock = Math.max(1, safeNumber(item.stock_orig ?? item.stock, 1));
    const currentStock = Math.max(0, safeNumber(item.stock ?? item.quantity, 0));

    const nextStock = getNextRestockStock({
      baseStock,
      currentStock,
      reroll,
    });

    item.stock = nextStock;
    item.quantity = nextStock;
  }

  return true;
}

export async function handleGuestRestockFlow({
  traderId,
  reroll = false,
  getEffectiveRole,
  getTraderById,
  safeNumber,
  getNextRestockStock,
  showToast,
  activeTraderId,
  openTraderModal,
  renderAllLocalState,
} = {}) {
  if (getEffectiveRole() !== "gm") {
    showToast("В гостевом режиме restock доступен только ГМу");
    return;
  }

  const trader = getTraderById(traderId);
  const updated = applyLocalGuestRestockToTrader({
    trader,
    reroll: Boolean(reroll),
    safeNumber,
    getNextRestockStock,
  });

  if (!updated) {
    showToast("Торговец для restock не найден");
    return;
  }

  showToast(`Локальный restock выполнен (${reroll ? "реролл" : "обновление"})`);
  if (activeTraderId === traderId) {
    await openTraderModal(traderId);
  } else {
    renderAllLocalState();
  }
}

export async function handleServerRestockFlow({
  traderId,
  reroll = false,
  apiRestockTrader,
  upsertTrader,
  refreshTraderById,
  showToast,
  activeTraderId,
  openTraderModal,
  renderAllLocalState,
} = {}) {
  const payload = await apiRestockTrader(traderId, { reroll: Boolean(reroll) });
  const traderFromPayload = payload?.trader;

  if (traderFromPayload && typeof traderFromPayload === "object") {
    upsertTrader(traderFromPayload);
  } else {
    await refreshTraderById(traderId);
  }

  const modeLabel = reroll ? "реролл" : "обновление";
  showToast(`Ассортимент обновлён (${modeLabel})`);

  if (activeTraderId === traderId) {
    await openTraderModal(traderId);
  } else {
    renderAllLocalState();
  }
}
