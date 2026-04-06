import { loadLSS } from "./longstoryshort.js";

// ============================================================
// cabinet.js
// Личный кабинет:
// - открытие / закрытие
// - вкладки
// - квесты
// - карта
// - заметки игрока
// - LSS вынесен в longstoryshort.js
// ============================================================

// ------------------------------------------------------------
// 🌐 STATE
// ------------------------------------------------------------
const CABINET_STATE = {
  quests: [],
  notes: "",
  map: null,
  activeTab: "inventory",
};

// ------------------------------------------------------------
// 🧰 HELPERS
// ------------------------------------------------------------
function getToken() {
  return localStorage.getItem("token") || "";
}

function getHeaders(withJson = false) {
  const headers = {};
  const token = getToken();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (withJson) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

function safeText(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  if (typeof window.showToast === "function") {
    window.showToast(message);
    return;
  }

  const toast = document.getElementById("toast");
  if (!toast) {
    console.log(message);
    return;
  }

  toast.textContent = message;
  toast.classList.remove("hidden");

  setTimeout(() => {
    toast.classList.add("hidden");
  }, 2200);
}

function getSection(id) {
  return document.getElementById(id);
}

function hideAllCabinetSections() {
  [
    "cabinet-inventory",
    "cabinet-lss",
    "cabinet-history",
    "cabinet-quests",
    "cabinet-map",
    "cabinet-files",
    "cabinet-playernotes",
    "cabinet-gmnotes",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add("tab-hidden");
    }
  });
}

function setActiveCabinetButton(tabName) {
  document.querySelectorAll("[data-cabinet-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.cabinetTab === tabName);
  });
}

function getSectionIdForTab(tabName) {
  const map = {
    inventory: "cabinet-inventory",
    lss: "cabinet-lss",
    history: "cabinet-history",
    quests: "cabinet-quests",
    map: "cabinet-map",
    files: "cabinet-files",
    playernotes: "cabinet-playernotes",
    gmnotes: "cabinet-gmnotes",
  };

  return map[tabName] || "cabinet-inventory";
}

// ------------------------------------------------------------
// 🚪 OPEN / CLOSE
// ------------------------------------------------------------
export function openCabinet() {
  const modal = document.getElementById("cabinetModal");
  if (modal) {
    modal.style.display = "block";
  }
}

export function closeCabinet() {
  const modal = document.getElementById("cabinetModal");
  if (modal) {
    modal.style.display = "none";
  }
}

// ------------------------------------------------------------
// 📑 TABS
// ------------------------------------------------------------
export function switchCabinetTab(tabName) {
  CABINET_STATE.activeTab = tabName;

  hideAllCabinetSections();

  const targetId = getSectionIdForTab(tabName);
  const target = document.getElementById(targetId);
  if (target) {
    target.classList.remove("tab-hidden");
  }

  setActiveCabinetButton(tabName);
}

export function bindCabinetTabs() {
  document.querySelectorAll("[data-cabinet-tab]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tabName = btn.dataset.cabinetTab;
      switchCabinetTab(tabName);

      if (tabName === "lss" || tabName === "history") {
        await loadLSS();
      }

      if (tabName === "quests") {
        await loadQuests();
      }

      if (tabName === "map") {
        await loadMap();
      }

      if (tabName === "playernotes") {
        await loadNotes();
      }

      if (tabName === "files") {
        renderFiles();
      }

      if (tabName === "gmnotes") {
        renderGmNotes();
      }
    });
  });
}

// ------------------------------------------------------------
// 📜 QUESTS
// ------------------------------------------------------------
export async function loadQuests() {
  const token = getToken();
  if (!token) return;

  const res = await fetch("/player/quests", {
    headers: getHeaders(),
  });

  if (!res.ok) {
    showToast("Ошибка загрузки заданий");
    return;
  }

  const data = await res.json();
  CABINET_STATE.quests = Array.isArray(data.quests) ? data.quests : [];

  renderQuests();
}

export function renderQuests() {
  const container = getSection("cabinet-quests");
  if (!container) return;

  if (!CABINET_STATE.quests.length) {
    container.innerHTML = `
      <div class="cabinet-block">
        <h3>Задания</h3>
        <p>Активных заданий пока нет.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="cabinet-block">
      <h3>Задания</h3>
      <div class="quest-list">
        ${CABINET_STATE.quests
          .map((quest, index) => {
            if (typeof quest === "string") {
              return `<div class="quest-entry">${index + 1}. ${escapeHtml(quest)}</div>`;
            }

            return `
              <div class="quest-entry">
                <strong>${escapeHtml(safeText(quest.name || quest.title, `Квест ${index + 1}`))}</strong>
                <div>${escapeHtml(safeText(quest.description || ""))}</div>
                <div><em>Статус: ${escapeHtml(safeText(quest.status || (quest.completed ? "выполнен" : "активен")))}</em></div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

// ------------------------------------------------------------
// 🗺️ MAP
// ------------------------------------------------------------
export async function loadMap() {
  const token = getToken();
  if (!token) return;

  const res = await fetch("/world/map", {
    headers: getHeaders(),
  });

  if (!res.ok) {
    showToast("Ошибка загрузки карты");
    return;
  }

  const data = await res.json();
  CABINET_STATE.map = data || {};

  renderMap();
}

export function renderMap() {
  const container = getSection("cabinet-map");
  if (!container) return;

  const map = CABINET_STATE.map || {};

  container.innerHTML = `
    <div class="cabinet-block">
      <h3>Карта</h3>
      <div class="map-meta">
        <div><strong>Слой:</strong> ${escapeHtml(safeText(map.activeLayer || map.active_layer, "world"))}</div>
        <div><strong>Масштаб:</strong> ${escapeHtml(safeText(map.zoom, "1"))}</div>
        <div><strong>Маркеров:</strong> ${Array.isArray(map.markers) ? map.markers.length : 0}</div>
      </div>

      <div class="map-placeholder" style="margin-top:12px; padding:16px; border:1px solid #555; border-radius:8px;">
        Здесь будет интерактивная карта. Основа под модуль уже готова.
      </div>
    </div>
  `;
}

// ------------------------------------------------------------
// 📝 PLAYER NOTES
// ------------------------------------------------------------
export async function loadNotes() {
  const token = getToken();
  if (!token) return;

  const res = await fetch("/player/notes", {
    headers: getHeaders(),
  });

  if (!res.ok) {
    showToast("Ошибка загрузки заметок");
    return;
  }

  const data = await res.json();
  CABINET_STATE.notes = data.notes || "";

  renderPlayerNotes();
}

export function renderPlayerNotes() {
  const container = getSection("cabinet-playernotes");
  if (!container) return;

  container.innerHTML = `
    <div class="cabinet-block">
      <h3>Заметки игрока</h3>
      <textarea id="playerNotesInput" rows="12" style="width:100%;">${escapeHtml(CABINET_STATE.notes || "")}</textarea>
    </div>
  `;
}

export async function savePlayerNotes() {
  const textarea = document.getElementById("playerNotesInput");
  if (!textarea) return;

  const token = getToken();
  if (!token) {
    showToast("Нужно войти");
    return;
  }

  const res = await fetch("/player/notes", {
    method: "POST",
    headers: getHeaders(true),
    body: JSON.stringify({
      notes: textarea.value,
    }),
  });

  if (!res.ok) {
    showToast("Ошибка сохранения заметок");
    return;
  }

  CABINET_STATE.notes = textarea.value;
  showToast("Заметки сохранены");
}

// ------------------------------------------------------------
// 📁 FILES
// ------------------------------------------------------------
export function renderFiles() {
  const container = getSection("cabinet-files");
  if (!container) return;

  container.innerHTML = `
    <div class="cabinet-block">
      <h3>Файлы</h3>
      <p>Файлы пока не загружены.</p>
    </div>
  `;
}

// ------------------------------------------------------------
// 🛡️ GM NOTES
// ------------------------------------------------------------
export function renderGmNotes() {
  const container = getSection("cabinet-gmnotes");
  if (!container) return;

  container.innerHTML = `
    <div class="cabinet-block">
      <h3>Заметки ГМ</h3>
      <p>Секция подготовлена. Логика GM-only будет подключена позже.</p>
    </div>
  `;
}

// ------------------------------------------------------------
// 🔘 ACTIONS
// ------------------------------------------------------------
export function bindCabinetActions() {
  const saveBtn = document.getElementById("savePlayerNotesBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      await savePlayerNotes();
    });
  }
}

export async function loadCabinetAll() {
  await loadLSS();
  await loadQuests();
  await loadMap();
  await loadNotes();
  renderFiles();
  renderGmNotes();
}

export function initCabinet() {
  bindCabinetTabs();
  bindCabinetActions();
  switchCabinetTab("inventory");
}

// ------------------------------------------------------------
// 🌉 LEGACY BRIDGE
// ------------------------------------------------------------
window.cabinetModule = {
  openCabinet,
  closeCabinet,
  switchCabinetTab,
  loadCabinetAll,
  loadQuests,
  loadMap,
  loadNotes,
  savePlayerNotes,
};