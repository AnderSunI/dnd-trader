// ============================================================
// frontend/js/modules/traderActions.js
// Trader actions: фильтры, делегирование кликов, open/restock.
// ============================================================

const FILTER_CONTROL_IDS = [
  "searchInput",
  "itemSearchInput",
  "typeFilter",
  "regionFilter",
  "playerLevelFilter",
  "reputationFilter",
  "priceMin",
  "priceMax",
  "rarityFilter",
  "categoryFilter",
  "magicFilter",
  "sortFilter",
];

export function bindFilterEvents(getEl, rerenderTraders) {
  FILTER_CONTROL_IDS.forEach((id) => {
    const el = getEl(id);
    if (!el) return;
    el.addEventListener("input", rerenderTraders);
    el.addEventListener("change", rerenderTraders);
  });
}

export function bindTraderDelegation({ openTraderModal, restockTrader }) {
  document.addEventListener("click", async (event) => {
    const restockBtn = event.target.closest(".js-restock-trader[data-trader-id]");
    if (restockBtn) {
      event.preventDefault();
      event.stopPropagation();

      const traderId = Number(restockBtn.dataset.traderId);
      const reroll = String(restockBtn.dataset.reroll || "0") === "1";
      if (Number.isFinite(traderId)) {
        await restockTrader(traderId, reroll);
      }
      return;
    }

    const openBtn = event.target.closest("[data-open-trader-id]");
    if (openBtn) {
      event.preventDefault();
      event.stopPropagation();

      const traderId = Number(openBtn.dataset.openTraderId);
      if (Number.isFinite(traderId)) {
        await openTraderModal(traderId);
      }
      return;
    }

    const traderCard = event.target.closest("[data-trader-card-id]");
    if (traderCard) {
      const traderId = Number(traderCard.dataset.traderCardId);
      if (Number.isFinite(traderId)) {
        await openTraderModal(traderId);
      }
    }
  });

  document.addEventListener("keydown", async (event) => {
    const traderCard = event.target.closest("[data-trader-card-id]");
    if (!traderCard) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const traderId = Number(traderCard.dataset.traderCardId);
      if (Number.isFinite(traderId)) {
        await openTraderModal(traderId);
      }
    }
  });
}

export function createOpenTraderModalAction({
  state,
  refreshTraderById,
  syncGlobalStateBridges,
  renderOpenTraderModal,
  restoreTraderModalUiPrefs,
}) {
  return async function openTraderModal(traderId) {
    state.activeTraderId = Number(traderId);

    if (state.token) {
      await refreshTraderById(traderId);
    }

    syncGlobalStateBridges();
    await renderOpenTraderModal(traderId);
    restoreTraderModalUiPrefs();
  };
}

export function createRestockTraderAction({
  state,
  showToast,
  getEffectiveRole,
  getTraderById,
  safeNumber,
  getNextRestockStock,
  handleGuestRestockFlow,
  handleServerRestockFlow,
  apiRestockTrader,
  upsertTrader,
  refreshTraderById,
  syncBusyUiState,
  renderAllLocalState,
  openTraderModal,
}) {
  return async function restockTrader(traderId, reroll = false) {
    const id = Number(traderId);
    if (!Number.isFinite(id) || id <= 0) {
      showToast("Некорректный traderId для restock");
      return;
    }

    if (!state.token) {
      await handleGuestRestockFlow({
        traderId: id,
        reroll: Boolean(reroll),
        getEffectiveRole,
        getTraderById,
        safeNumber,
        getNextRestockStock,
        showToast,
        activeTraderId: state.activeTraderId,
        openTraderModal,
        renderAllLocalState,
      });
      return;
    }

    if (state.isBusy) return;

    state.isBusy = true;
    syncBusyUiState();

    try {
      await handleServerRestockFlow({
        traderId: id,
        reroll: Boolean(reroll),
        apiRestockTrader,
        upsertTrader,
        refreshTraderById,
        showToast,
        activeTraderId: state.activeTraderId,
        openTraderModal,
        renderAllLocalState,
      });
    } catch (error) {
      showToast(`Ошибка restock: ${error?.message || "не удалось обновить ассортимент"}`);
    } finally {
      state.isBusy = false;
      syncBusyUiState();
    }
  };
}
