// ============================================================
// frontend/js/modules/uiBindings.js
// Common UI bindings extracted from app.js.
// ============================================================

export function bindToolbarButtons({
  getEl,
  state,
  renderCart,
  updateCartCounter,
  updateCartTotalLabels,
  openModal,
  syncGlobalStateBridges,
  renderAllLocalState,
  showToast,
  renderInventory,
  updateInventoryCounter,
  initCabinetModulesIfNeeded,
  openCabinet,
  loadTraders,
  loadInventoryFromServer,
}) {
  getEl("viewCartBtn")?.addEventListener("click", () => {
    renderCart(state.cart);
    updateCartCounter();
    updateCartTotalLabels();
    openModal("cartModal");
  });

  const clearCart = () => {
    if (!confirm("Очистить корзину полностью?")) return;
    state.cart = [];
    syncGlobalStateBridges();
    renderAllLocalState();
    showToast("Корзина очищена");
  };

  getEl("clearCartBtn")?.addEventListener("click", clearCart);
  getEl("clearCartBtnModal")?.addEventListener("click", clearCart);

  getEl("checkoutCartBtn")?.addEventListener("click", async () => {
    await window.checkoutCart();
  });

  getEl("viewInventoryBtn")?.addEventListener("click", () => {
    renderInventory(state.inventory);
    updateInventoryCounter();
    openModal("inventoryModal");
  });

  getEl("cabinetBtn")?.addEventListener("click", async () => {
    try {
      await initCabinetModulesIfNeeded();
      await openCabinet();
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Не удалось открыть личный кабинет");
    }
  });

  getEl("refreshDataBtn")?.addEventListener("click", async () => {
    await loadTraders();
    if (state.token) await loadInventoryFromServer();
    renderAllLocalState();
    showToast("Данные обновлены");
  });
}

export function bindAuthButtons({ getEl, handleLogout, handleLogin, handleRegister }) {
  getEl("showAuthBtn")?.addEventListener("click", () => {
    getEl("authContainer")?.classList.toggle("hidden");
  });

  getEl("logoutBtn")?.addEventListener("click", handleLogout);
  getEl("doLogin")?.addEventListener("click", handleLogin);
  getEl("doRegister")?.addEventListener("click", handleRegister);
}

export function bindModalButtons(closeModal) {
  document.querySelectorAll(".close").forEach((btn) => {
    if (btn.dataset.boundModalClose === "1") return;
    btn.dataset.boundModalClose = "1";
    btn.addEventListener("click", () => {
      closeModal(btn.closest(".modal"));
    });
  });

  window.addEventListener("click", (event) => {
    document.querySelectorAll(".modal").forEach((modal) => {
      if (event.target === modal) closeModal(modal);
    });
  });
}

export function bindMoneyControls({
  getEl,
  applyGuestMoneyUpdateFromInput,
  resetGuestMoney,
  syncMoneyControls,
}) {
  const playerGoldInput = getEl("playerGoldInput");
  const updateGoldBtn = getEl("updateGoldBtn");
  const resetGoldBtn = getEl("resetGoldBtn");

  updateGoldBtn?.addEventListener("click", applyGuestMoneyUpdateFromInput);
  playerGoldInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyGuestMoneyUpdateFromInput();
    }
  });

  resetGoldBtn?.addEventListener("click", resetGuestMoney);
  syncMoneyControls();
}
