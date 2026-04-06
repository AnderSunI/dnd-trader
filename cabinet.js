// ============================================================
// frontend/js/cabinet.js
// Вся логика личного кабинета.
// ВАЖНО:
// UX должен оставаться как в main:
// одна кнопка "Личный кабинет"
// внутри вкладки:
// - LSS
// - история
// - квесты
// - карта
// - инвентарь
// - файлы
// - заметки
// ============================================================

import {
  state,
  openCabinet,
  closeCabinet,
  setCabinetTab,
  setLssData,
  setMapData,
} from "./state.js";

import {
  fetchPlayerProfile,
  fetchPlayerQuests,
  fetchPlayerNotes,
  savePlayerNotes,
  fetchWorldMap,
} from "./api.js";

import {
  renderCabinetContent,
} from "./render.js";

// ============================================================
// 🧰 HELPERS
// ============================================================

// Получить модалку кабинета
function getCabinetModal() {
  return document.getElementById("cabinetModal");
}

// Получить textarea заметок
function getPlayerNotesTextarea() {
  return document.getElementById("playerNotesTextarea");
}

// Безопасный callback
function safeCallback(fn, ...args) {
  if (typeof fn === "function") {
    fn(...args);
  }
}

// ============================================================
// 🚪 OPEN / CLOSE
// ============================================================

// Открыть кабинет
export function openCabinetModal() {
  const modal = getCabinetModal();
  if (!modal) return;

  openCabinet();
  modal.style.display = "block";

  renderCabinet();
}

// Закрыть кабинет
export function closeCabinetModal() {
  const modal = getCabinetModal();
  if (!modal) return;

  closeCabinet();
  modal.style.display = "none";
}

// Toggle
export function toggleCabinetModal() {
  if (state.ui.cabinetOpen) {
    closeCabinetModal();
  } else {
    openCabinetModal();
  }
}

// ============================================================
// 📑 TABS
// ============================================================

// Смена вкладки
export function switchCabinetTab(tabName) {
  setCabinetTab(tabName);
  renderCabinet();
}

// Перерисовать кабинет
export function renderCabinet() {
  renderCabinetContent();
}

// ============================================================
// 📖 DATA LOADERS
// ============================================================

// Загрузка LSS / профиля
export async function loadCabinetProfile() {
  try {
    const profile = await fetchPlayerProfile();
    setLssData(profile || {});
    renderCabinet();
    return profile;
  } catch (error) {
    console.error("Ошибка loadCabinetProfile:", error);
    return null;
  }
}

// Загрузка квестов
export async function loadCabinetQuests() {
  try {
    const quests = await fetchPlayerQuests();

    setLssData({
      quests: Array.isArray(quests?.quests)
        ? quests.quests
        : Array.isArray(quests)
          ? quests
          : [],
    });

    renderCabinet();
    return quests;
  } catch (error) {
    console.error("Ошибка loadCabinetQuests:", error);
    return null;
  }
}

// Загрузка заметок
export async function loadCabinetNotes() {
  try {
    const notes = await fetchPlayerNotes();

    setLssData({
      notes: notes?.notes || "",
      history: Array.isArray(notes?.history)
        ? notes.history
        : [],
    });

    renderCabinet();
    return notes;
  } catch (error) {
    console.error("Ошибка loadCabinetNotes:", error);
    return null;
  }
}

// Загрузка карты
export async function loadCabinetMap() {
  try {
    const map = await fetchWorldMap();
    setMapData(map || {});
    renderCabinet();
    return map;
  } catch (error) {
    console.error("Ошибка loadCabinetMap:", error);
    return null;
  }
}

// Полная загрузка кабинета
export async function loadCabinetData() {
  await loadCabinetProfile();
  await loadCabinetQuests();
  await loadCabinetNotes();
  await loadCabinetMap();

  renderCabinet();
}

// ============================================================
// 📝 NOTES
// ============================================================

// Сохранить заметки
export async function saveCabinetNotes() {
  const textarea = getPlayerNotesTextarea();
  if (!textarea) return false;

  try {
    await savePlayerNotes(textarea.value);

    setLssData({
      notes: textarea.value,
    });

    renderCabinet();
    return true;
  } catch (error) {
    console.error("Ошибка saveCabinetNotes:", error);
    return false;
  }
}

// ============================================================
// 🖱️ EVENTS
// ============================================================

// Привязка кнопки открытия
export function bindCabinetOpenButton() {
  const button = document.getElementById("cabinetBtn");
  if (!button) return;

  button.addEventListener("click", async () => {
    openCabinetModal();
    await loadCabinetData();
  });
}

// Привязка вкладок
export function bindCabinetTabs() {
  document.querySelectorAll("[data-cabinet-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      const tab = button.dataset.cabinetTab;
      switchCabinetTab(tab);

      // Ленивая догрузка данных по вкладкам
      if (tab === "lss" || tab === "history") {
        await loadCabinetProfile();
      }

      if (tab === "quests") {
        await loadCabinetQuests();
      }

      if (tab === "map") {
        await loadCabinetMap();
      }

      if (tab === "playernotes") {
        await loadCabinetNotes();
      }
    });
  });
}

// Кнопка сохранить заметки
export function bindCabinetSaveNotes() {
  const saveBtn = document.getElementById("savePlayerNotesBtn");
  if (!saveBtn) return;

  saveBtn.addEventListener("click", async () => {
    const ok = await saveCabinetNotes();

    if (ok && window.showToast) {
      window.showToast("Заметки сохранены");
    }
  });
}

// Закрытие по кнопке
export function bindCabinetCloseButtons() {
  const modal = getCabinetModal();
  if (!modal) return;

  modal.querySelectorAll(".close, .close-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeCabinetModal();
    });
  });

  window.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeCabinetModal();
    }
  });
}

// ============================================================
// 🚀 INIT
// ============================================================

// Инициализация модуля кабинета
export function initCabinetModule() {
  bindCabinetOpenButton();
  bindCabinetTabs();
  bindCabinetSaveNotes();
  bindCabinetCloseButtons();
}

// ============================================================
// 🌐 LEGACY BRIDGE
// ============================================================

// Чтобы старый main UX и inline html не ломались
window.cabinetModule = {
  openCabinetModal,
  closeCabinetModal,
  toggleCabinetModal,
  switchCabinetTab,
  loadCabinetData,
  saveCabinetNotes,
};
