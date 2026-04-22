// ============================================================
// frontend/js/modules/restockHelpers.js
// Чистые helper-функции для restock-расчётов.
// ============================================================

export function normalizeStockValue(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.trunc(num));
}

export function getNextRestockStock({
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
