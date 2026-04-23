// ============================================================
// frontend/js/modules/traderRestockFlow.js
// Flow/helper-функции restock торговца.
// ============================================================

function normalizeStockValue(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.trunc(num));
}

function getNextRestockStock({
  baseStock,
  currentStock,
  reroll = false,
} = {}) {
  const base = Math.max(1, normalizeStockValue(baseStock, 1));
  const current = normalizeStockValue(currentStock, 0);

  if (reroll) {
    return Math.max(1, Math.round(base * (0.8 + Math.random() * 0.5)));
  }

  return Math.max(current, base);
}

export function applyLocalGuestRestockToTrader({
  trader,
  reroll = false,
  safeNumber,
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
