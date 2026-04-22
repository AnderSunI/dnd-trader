// ============================================================
// frontend/js/modules/authActions.js
// Auth actions (login/register/logout + safe fetch me).
// ============================================================

export function createAuthActions({
  state,
  getEl,
  showToast,
  setBusy,
  loginUser,
  registerUser,
  fetchMe,
  logoutUser,
  clearPersistedUser,
  persistUser,
  normalizeMoneyFromPayload,
  syncGlobalStateBridges,
  updateUserUI,
  loadTraders,
  loadInventoryFromServer,
  renderAllLocalState,
  initCabinetModulesIfNeeded,
}) {
  async function fetchMeSafe() {
    try {
      return await fetchMe();
    } catch {
      return null;
    }
  }

  async function handleLogin() {
    const email = String(getEl("loginEmail")?.value || "").trim();
    const password = String(getEl("loginPassword")?.value || "");

    if (!email || !password) {
      showToast("Введите email и пароль");
      return;
    }

    try {
      setBusy(true);

      const payload = await loginUser(email, password);
      state.token = localStorage.getItem("token") || "";

      const me = (await fetchMeSafe()) || payload?.user || payload?.me || null;
      state.user = me && typeof me === "object" ? me : { email };

      if (state.user.money_cp_total === undefined && state.user.money_label === undefined) {
        const fallbackMoney = normalizeMoneyFromPayload(payload);
        if (fallbackMoney) {
          state.user.money_cp_total = fallbackMoney.cp;
          state.user.money_label = fallbackMoney.label;
        }
      }

      persistUser();
      syncGlobalStateBridges();
      updateUserUI();

      await loadTraders();
      await loadInventoryFromServer();
      renderAllLocalState();
      await initCabinetModulesIfNeeded();

      showToast("Вход выполнен");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Ошибка входа");
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister() {
    const email = String(getEl("loginEmail")?.value || "").trim();
    const password = String(getEl("loginPassword")?.value || "");

    if (!email || !password) {
      showToast("Введите email и пароль");
      return;
    }

    try {
      setBusy(true);
      await registerUser(email, password);
      showToast("Регистрация успешна. Теперь войдите.");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Ошибка регистрации");
    } finally {
      setBusy(false);
    }
  }

  function handleLogout() {
    state.token = "";
    state.user = null;
    state.inventory = [];
    state.cart = [];
    state.reserved = [];

    logoutUser();
    clearPersistedUser();

    syncGlobalStateBridges();
    updateUserUI();
    renderAllLocalState();
    showToast("Вы вышли");
  }

  return {
    fetchMeSafe,
    handleLogin,
    handleRegister,
    handleLogout,
  };
}
