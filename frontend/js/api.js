// ============================================================
// frontend/js/app.js
// Главный файл фронтенда.
// Связывает API + state + render.
// ============================================================

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
  fetchPlayerProfile,
  fetchPlayerQuests,
  fetchPlayerNotes,
  savePlayerNotes,
  fetchWorldMap,
} from "./api.js";

import {
  state,
  setUser,
  clearUser,
  setTraders,
  setInventory,
  addToCart,
  removeFromCart,
  updateCartQuantity,
  clearCart,
  setFilters,
  updateFilter,
  resetFilters,
  setLssData,
  setMapData,
  setGmMode,
} from "./state.js";

import {
  renderGuestState,
  renderAuthenticatedState,
  renderTraders,
  renderInventory,
  renderCart,
  renderCabinetContent,
  bindRenderUiEvents,
  openTrader,
} from "./render.js";

// ============================================================
// 🧰 ВСПОМОГАТЕЛЬНОЕ
// ============================================================

// Показать уведомление
function showToast(message) {
  const toast =
    document.getElementById("toast") ||
    document.getElementById("appToast");

  if (!toast) {
    console.log(message);
    return;
  }

  toast.textContent = message;
  toast.style.opacity = "1";
  toast.style.display = "block";

  setTimeout(() => {
    toast.style.opacity = "0";
  }, 2200);

  setTimeout(() => {
    toast.style.display = "none";
  }, 2600);
}

// Найти товар у торговца
function findTraderItem(traderId, itemId) {
  const trader = state.traders.find((t) => t.id === traderId);
  if (!trader || !Array.isArray(trader.items)) return null;
  return trader.items.find((item) => item.id === itemId) || null;
}

// Получить все элементы фильтров из DOM
function getFilterValuesFromDom() {
  return {
    search:
      document.getElementById("searchInput")?.value?.trim() ||
      document.getElementById("searchTrader")?.value?.trim() ||
      "",
    category:
      document.getElementById("categoryFilter")?.value ||
      "all",
    region:
      document.getElementById("regionFilter")?.value ||
      document.getElementById("filterRegion")?.value ||
      "all",
    traderType:
      document.getElementById("typeFilter")?.value ||
      document.getElementById("filterType")?.value ||
      "all",
    rarity:
      document.getElementById("rarityFilter")?.value ||
      "all",
    minPrice: document.getElementById("minPrice")?.value || null,
    maxPrice: document.getElementById("maxPrice")?.value || null,
  };
}

// Применить фильтры к торговцам
function getFilteredTraders() {
  let traders = [...state.traders];
  const filters = state.filters;

  const search = String(filters.search || "").toLowerCase().trim();

  if (search) {
    traders = traders.filter((trader) => {
      const inTrader =
        String(trader.name || "").toLowerCase().includes(search) ||
        String(trader.description || "").toLowerCase().includes(search);

      const inItems = Array.isArray(trader.items)
        ? trader.items.some((item) =>
            String(item.name || "").toLowerCase().includes(search)
          )
        : false;

      return inTrader || inItems;
    });
  }

  if (filters.category && filters.category !== "all") {
    traders = traders.filter((trader) =>
      Array.isArray(trader.items)
        ? trader.items.some((item) => item.category === filters.category)
        : false
    );
  }

  if (filters.region && filters.region !== "all") {
    traders = traders.filter(
      (trader) => String(trader.region || "") === String(filters.region)
    );
  }

  if (filters.traderType && filters.traderType !== "all") {
    traders = traders.filter(
      (trader) => String(trader.type || "") === String(filters.traderType)
    );
  }

  if (filters.rarity && filters.rarity !== "all") {
    traders = traders.filter((trader) =>
      Array.isArray(trader.items)
        ? trader.items.some((item) => String(item.rarity || "") === String(filters.rarity))
        : false
    );
  }

  const minPrice = filters.minPrice !== null && filters.minPrice !== ""
    ? Number(filters.minPrice)
    : null;
  const maxPrice = filters.maxPrice !== null && filters.maxPrice !== ""
    ? Number(filters.maxPrice)
    : null;

  if (minPrice !== null || maxPrice !== null) {
    traders = traders.filter((trader) => {
      if (!Array.isArray(trader.items)) return false;

      return trader.items.some((item) => {
        const value = Number(item.buy_price_gold ?? item.price_gold ?? 0);
        if (minPrice !== null && value < minPrice) return false;
        if (maxPrice !== null && value > maxPrice) return false;
        return true;
      });
    });
  }

  return traders;
}

// Обновить список торговцев на экране
function rerenderTraders() {
  renderTraders(getFilteredTraders());
}

// ============================================================
// 🔐 AUTH
// ============================================================

// Инициализация авторизации
async function initAuth() {
  if (!isAuthenticated()) {
    renderGuestState();
    return;
  }

  try {
    const data = await fetchMe();
    setUser(data.user || data);
    renderAuthenticatedState(state.user);

    // Если у пользователя есть роль/режим ГМа
    const role = String(state.user?.role || "").toLowerCase();
    const isGm = role === "gm" || role === "admin";
    setGmMode(isGm);
  } catch (error) {
    console.error("Ошибка initAuth:", error);
    logoutUser();
    clearUser();
    renderGuestState();
  }
}

// Логин
async function handleLogin(email, password) {
  try {
    const data = await loginUser(email, password);

    if (data?.user) {
      setUser(data.user);
    }

    renderAuthenticatedState(state.user);
    await loadInitialData();
    showToast("Вход выполнен");
  } catch (error) {
    console.error(error);
    showToast(`Ошибка входа: ${error.message}`);
  }
}

// Регистрация
async function handleRegister(email, password) {
  try {
    const data = await registerUser(email, password);

    if (data?.user) {
      setUser(data.user);
    }

    renderAuthenticatedState(state.user);
    await loadInitialData();
    showToast("Регистрация успешна");
  } catch (error) {
    console.error(error);
    showToast(`Ошибка регистрации: ${error.message}`);
  }
}

// Выход
function handleLogout() {
  logoutUser();
  clearUser();
  clearCart();
  renderGuestState();
  renderInventory([]);
  renderCart([]);
  location.reload();
}

// ============================================================
// 📦 ЗАГРУЗКА ДАННЫХ
// ============================================================

// Загрузка торговцев
async function loadTraders() {
  try {
    const data = await fetchTraders();
    const traders = Array.isArray(data?.traders) ? data.traders : (Array.isArray(data) ? data : []);
    setTraders(traders);
    rerenderTraders();
  } catch (error) {
    console.error("Ошибка загрузки торговцев:", error);
    showToast("Не удалось загрузить торговцев");
  }
}

// Загрузка инвентаря
async function loadInventory() {
  if (!isAuthenticated()) {
    setInventory([]);
    renderInventory([]);
    return;
  }

  try {
    const data = await fetchPlayerInventory();
    const items = Array.isArray(data?.items) ? data.items : [];
    setInventory(items);
    renderInventory(state.inventory);

    if (state.user) {
      const updatedUser = {
        ...state.user,
        money_gold: data?.money_gold ?? state.user.money_gold ?? 0,
        money_silver: data?.money_silver ?? state.user.money_silver ?? 0,
        money_copper: data?.money_copper ?? state.user.money_copper ?? 0,
        money_label: data?.money_label ?? state.user.money_label,
      };
      setUser(updatedUser);
      renderAuthenticatedState(state.user);
    }
  } catch (error) {
    console.error("Ошибка загрузки инвентаря:", error);
    showToast("Не удалось загрузить инвентарь");
  }
}

// Загрузка LSS / профиля
async function loadPlayerProfileData() {
  if (!isAuthenticated()) return;

  try {
    const profile = await fetchPlayerProfile();
    setLssData(profile || {});
  } catch (error) {
    console.error("Ошибка загрузки профиля:", error);
  }
}

// Загрузка квестов
async function loadQuestsData() {
  if (!isAuthenticated()) return;

  try {
    const quests = await fetchPlayerQuests();
    setLssData({
      quests: Array.isArray(quests?.quests) ? quests.quests : (Array.isArray(quests) ? quests : []),
    });
  } catch (error) {
    console.error("Ошибка загрузки квестов:", error);
  }
}

// Загрузка заметок
async function loadNotesData() {
  if (!isAuthenticated()) return;

  try {
    const notes = await fetchPlayerNotes();
    setLssData({
      notes: notes?.notes || "",
      history: Array.isArray(notes?.history) ? notes.history : [],
    });
  } catch (error) {
    console.error("Ошибка загрузки заметок:", error);
  }
}

// Загрузка карты
async function loadMapData() {
  try {
    const map = await fetchWorldMap();
    setMapData(map || {});
  } catch (error) {
    console.error("Ошибка загрузки карты:", error);
  }
}

// Полная инициализация данных
async function loadInitialData() {
  await loadTraders();
  await loadInventory();
  await loadPlayerProfileData();
  await loadQuestsData();
  await loadNotesData();
  await loadMapData();

  renderCart(state.cart);
  renderCabinetContent();
}

// ============================================================
// 🛒 КОРЗИНА
// ============================================================

// Добавить товар торговца в корзину
window.addTraderItemToCartAction = function (itemId, traderId) {
  const item = findTraderItem(traderId, itemId);
  if (!item) {
    showToast("Товар не найден");
    return;
  }

  addToCart(item, 1);
  renderCart(state.cart);
  showToast(`Добавлено в корзину: ${item.name}`);
};

// Изменить количество товара в корзине
window.updateCartQuantityAction = function (itemId, delta) {
  updateCartQuantity(itemId, delta);
  renderCart(state.cart);
};

// Удалить товар из корзины
window.removeCartItemAction = function (itemId) {
  removeFromCart(itemId);
  renderCart(state.cart);
};

// Очистить корзину
window.clearCartAction = function () {
  clearCart();
  renderCart(state.cart);
};

// ============================================================
// 💸 ПОКУПКА / ПРОДАЖА
// ============================================================

// Купить предмет
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

// Продать предмет
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

// ============================================================
// 🔎 ФИЛЬТРЫ
// ============================================================

// Прочитать фильтры из DOM
function readFiltersFromDom() {
  const values = getFilterValuesFromDom();
  setFilters(values);
}

// Сбросить фильтры UI
function resetFiltersInDom() {
  const ids = [
    "searchInput",
    "searchTrader",
    "categoryFilter",
    "regionFilter",
    "filterRegion",
    "typeFilter",
    "filterType",
    "rarityFilter",
    "minPrice",
    "maxPrice",
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    if (el.tagName === "SELECT") {
      el.value = "all";
    } else {
      el.value = "";
    }
  });

  resetFilters();
  rerenderTraders();
}

// ============================================================
// 📝 ЗАМЕТКИ
// ============================================================

// Сохранить заметки игрока
async function handleSavePlayerNotes() {
  const textarea = document.getElementById("playerNotesTextarea");
  if (!textarea) return;

  try {
    await savePlayerNotes(textarea.value);
    setLssData({ notes: textarea.value });
    renderCabinetContent();
    showToast("Заметки сохранены");
  } catch (error) {
    console.error(error);
    showToast(`Ошибка сохранения заметок: ${error.message}`);
  }
}

// ============================================================
// 🔘 UI EVENTS
// ============================================================

// Привязать кнопку auth form
function bindAuthUi() {
  const showAuthBtn = document.getElementById("showAuthBtn");
  const doLoginBtn = document.getElementById("doLogin");
  const doRegisterBtn = document.getElementById("doRegister");
  const logoutBtn = document.getElementById("logoutBtn");

  const loginEmail = document.getElementById("loginEmail");
  const loginPassword = document.getElementById("loginPassword");

  if (showAuthBtn) {
    showAuthBtn.addEventListener("click", () => {
      const authContainer = document.getElementById("authContainer");
      if (authContainer) {
        authContainer.style.display =
          authContainer.style.display === "block" ? "none" : "block";
      }
    });
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
}

// Привязать фильтры
function bindFiltersUi() {
  const filterIds = [
    "searchInput",
    "searchTrader",
    "categoryFilter",
    "regionFilter",
    "filterRegion",
    "typeFilter",
    "filterType",
    "rarityFilter",
    "minPrice",
    "maxPrice",
  ];

  filterIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    const eventName =
      el.tagName === "SELECT" ? "change" : "input";

    el.addEventListener(eventName, () => {
      readFiltersFromDom();
      rerenderTraders();
    });
  });

  const resetBtn = document.getElementById("resetFiltersBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      resetFiltersInDom();
      showToast("Фильтры сброшены");
    });
  }
}

// Привязать кнопки кабинета
function bindCabinetUi() {
  document.querySelectorAll("[data-cabinet-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      renderCabinetContent();
    });
  });

  const saveNotesBtn = document.getElementById("savePlayerNotesBtn");
  if (saveNotesBtn) {
    saveNotesBtn.addEventListener("click", handleSavePlayerNotes);
  }
}

// Привязать инвентарь / корзину
function bindInventoryCartUi() {
  const viewInventoryBtn = document.getElementById("viewInventoryBtn");
  if (viewInventoryBtn) {
    viewInventoryBtn.addEventListener("click", () => {
      const inventoryModal = document.getElementById("inventoryModal");
      if (inventoryModal) {
        inventoryModal.style.display = "block";
      }
    });
  }

  const clearCartBtn = document.getElementById("clearCartBtn");
  if (clearCartBtn) {
    clearCartBtn.addEventListener("click", () => {
      window.clearCartAction();
    });
  }
}

// Привязать глобальный openTrader
window.openTrader = openTrader;

// ============================================================
// 🚀 INIT
// ============================================================

// Запуск приложения
async function initApp() {
  bindRenderUiEvents();
  bindAuthUi();
  bindFiltersUi();
  bindCabinetUi();
  bindInventoryCartUi();

  await initAuth();
  await loadInitialData();
}

initApp();