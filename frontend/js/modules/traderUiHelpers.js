// ============================================================
// frontend/js/modules/traderUiHelpers.js
// LEGACY REFERENCE
// Restock button markup now lives in render.js next to the modal template.
// Keep this file only until the next cleanup pass removes it.
// ============================================================

export function normalizeTraderIdForMarkup(traderId) {
  const id = Number(traderId);
  return Number.isFinite(id) ? id : 0;
}

export function buildRestockButtonsMarkup(traderId) {
  const normalizedId = normalizeTraderIdForMarkup(traderId);
  return `
    <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
      <button
        class="btn btn-primary js-restock-trader"
        data-trader-id="${normalizedId}"
        data-reroll="0"
      >🔄 Обновить ассортимент</button>
      <button
        class="btn btn-warning js-restock-trader"
        data-trader-id="${normalizedId}"
        data-reroll="1"
      >🎲 Реролл ассортимента</button>
    </div>
  `;
}
