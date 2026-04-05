// frontend/js/app.js

import {
  loginUser,
  registerUser,
  fetchMe,
  fetchTraders,
  fetchPlayerInventory,
  buyItem,
  sellItem,
  logoutUser,
  isAuthenticated,
} from "./api.js";

import {
  state,
  setUser,
  setTraders,
  setInventory,
} from "./state.js";

import {
  renderUserInfo,
  renderTraders,
  renderInventory,
  openTrader,
  openInventoryModal,
} from "./render.js";

import {
  populateFilterOptions,
  getFilteredTraders,
  bindFilterEvents,
} from "./filters.js";

function showGuestState() {
  const guestBlock = document.getElementById("guestWarning");
  const authContainer = document.getElementById("authContainer");
  const logoutBtn = document.getElementById("logoutBtn");

  if (guestBlock) guestBlock.style.display = "flex";
  if (authContainer) authContainer.style.display = "none";
  if (logoutBtn) logoutBtn.style.display = "none";

  renderUserInfo(null);
}

function showAuthForm() {
  const guestBlock = document.getElementById("guestWarning");
  const authContainer = document.getElementById("authContainer");
  const logoutBtn = document.getElementById("logoutBtn");

  if (guestBlock) guestBlock.style.display = "none";
  if (authContainer) authContainer.style.display = "block";
  if (logoutBtn) logoutBtn.style.display = "none";
}

function showUserState(user) {
  const guestBlock = document.getElementById("guestWarning");
  const authContainer = document.getElementById("authContainer");
  const logoutBtn = document.getElementById("logoutBtn");

  if (guestBlock) guestBlock.style.display = "none";
  if (authContainer) authContainer.style.display = "none";
  if (logoutBtn) logoutBtn.style.display = "inline-block";

  renderUserInfo(user);
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) {
    console.log(message);
    return;
  }

  toast.textContent = message;
  toast.style.opacity = "1";

  setTimeout(() => {
    toast.style.opacity = "0";
  }, 2200);
}

function rerenderTradersWithFilters() {
  const filtered = getFilteredTraders(state.traders);
  renderTraders(filtered);
}

async function initAuth() {
  if (!isAuthenticated()) {
    showGuestState();
    return;
  }

  try {
    const data = await fetchMe();
    setUser(data.user);
    showUserState(state.user);
  } catch (error) {
    console.error("Auth init error:", error);
    logoutUser();
    showGuestState();
  }
}

async function handleLogin(email, password) {
  try {
    const data = await loginUser(email, password);
    setUser(data.user);
    showUserState(state.user);
    await loadInitialData();
    showToast("Вход выполнен");
  } catch (error) {
    console.error(error);
    showToast(`Ошибка входа: ${error.message}`);
  }
}

async function handleRegister(email, password) {
  try {
    const data = await registerUser(email, password);
    setUser(data.user);
    showUserState(state.user);
    await loadInitialData();
    showToast("Регистрация успешна");
  } catch (error) {
    console.error(error);
    showToast(`Ошибка регистрации: ${error.message}`);
  }
}

function handleLogout() {
  logoutUser();
  location.reload();
}

async function loadTraders() {
  try {
    const data = await fetchTraders();
    setTraders(data.traders || data || []);
    populateFilterOptions(state.traders);
    rerenderTradersWithFilters();
  } catch (error) {
    console.error("Ошибка загрузки торговцев:", error);
    showToast("Не удалось загрузить торговцев");
  }
}

async function loadInventory() {
  if (!isAuthenticated()) {
    setInventory([]);
    renderInventory(state.inventory);
    return;
  }

  try {
    const data = await fetchPlayerInventory();
    setInventory(data.items || []);
    renderInventory(state.inventory);

    if (state.user) {
      const updatedUser = {
        ...state.user,
        money_cp_total: data.money_cp_total,
        money_gold: data.money_gold,
        money_silver: data.money_silver,
        money_copper: data.money_copper,
        money_label: data.money_label,
      };

      setUser(updatedUser);
      showUserState(state.user);
    }
  } catch (error) {
    console.error("Ошибка загрузки инвентаря:", error);
    showToast("Не удалось загрузить инвентарь");
  }
}

async function loadInitialData() {
  await loadTraders();
  await loadInventory();
}

window.buyItemAction = async function (itemId, traderId, quantity = 1) {
  try {
    await buyItem(itemId, traderId, quantity);
    await loadInventory();
    await loadTraders();
    showToast("Покупка выполнена");
  } catch (error) {
    console.error(error);
    showToast(`Ошибка покупки: ${error.message}`);
  }
};

window.sellItemAction = async function (itemId, traderId, quantity = 1) {
  try {
    await sellItem(itemId, traderId, quantity);
    await loadInventory();
    await loadTraders();
    showToast("Продажа выполнена");
  } catch (error) {
    console.error(error);
    showToast(`Ошибка продажи: ${error.message}`);
  }
};

window.openTrader = openTrader;

function bindUiEvents() {
  const showAuthBtn = document.getElementById("showAuthBtn");
  const doLoginBtn = document.getElementById("doLogin");
  const doRegisterBtn = document.getElementById("doRegister");
  const logoutBtn = document.getElementById("logoutBtn");
  const viewInventoryBtn = document.getElementById("viewInventoryBtn");

  const loginEmail = document.getElementById("loginEmail");
  const loginPassword = document.getElementById("loginPassword");

  if (showAuthBtn) {
    showAuthBtn.addEventListener("click", showAuthForm);
  }

  if (doLoginBtn) {
    doLoginBtn.addEventListener("click", async () => {
      const email = loginEmail?.value?.trim() || "";
      const password = loginPassword?.value || "";

      if (!email || !password) {
        showToast("Введите email и пароль");
        return;
      }

      await handleLogin(email, password);
    });
  }

  if (doRegisterBtn) {
    doRegisterBtn.addEventListener("click", async () => {
      const email = loginEmail?.value?.trim() || "";
      const password = loginPassword?.value || "";

      if (!email || !password) {
        showToast("Введите email и пароль");
        return;
      }

      await handleRegister(email, password);
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", handleLogout);
  }

  if (viewInventoryBtn) {
    viewInventoryBtn.addEventListener("click", () => {
      openInventoryModal();
    });
  }

  bindFilterEvents(() => {
    rerenderTradersWithFilters();
  });

  document.querySelectorAll(".close").forEach((closeBtn) => {
    closeBtn.addEventListener("click", () => {
      const modal = closeBtn.closest(".modal");
      if (modal) modal.style.display = "none";
    });
  });

  window.addEventListener("click", (event) => {
    document.querySelectorAll(".modal").forEach((modal) => {
      if (event.target === modal) {
        modal.style.display = "none";
      }
    });
  });
}

async function initApp() {
  bindUiEvents();
  await initAuth();
  await loadInitialData();
}

initApp();