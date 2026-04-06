// ============================================================
// longstoryshort.js
// LSS (лист персонажа + история)
// Работает внутри cabinetModal → вкладка
// ============================================================

// ------------------------------------------------------------
// 🌐 STATE
// ------------------------------------------------------------
let LSS_STATE = {
  profile: null,
};

// ------------------------------------------------------------
// 🧰 HELPERS
// ------------------------------------------------------------
function getToken() {
  return localStorage.getItem("token") || "";
}

function getHeaders() {
  const token = getToken();
  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function safe(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return value;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// ------------------------------------------------------------
// 📡 LOAD PROFILE
// ------------------------------------------------------------
export async function loadLSS() {
  const token = getToken();
  if (!token) return;

  const res = await fetch("/player/profile", {
    headers: getHeaders(),
  });

  if (!res.ok) {
    console.error("Ошибка загрузки LSS");
    return;
  }

  const data = await res.json();
  LSS_STATE.profile = data.profile || data;

  renderLSS();
  renderHistory();
}

// ------------------------------------------------------------
// 🧙 РЕНДЕР ПЕРСОНАЖА (LSS)
// ------------------------------------------------------------
export function renderLSS() {
  const container = document.getElementById("cabinet-lss");
  if (!container) return;

  const p = LSS_STATE.profile || {};
  const stats = p.stats || {};

  container.innerHTML = `
    <div class="cabinet-block">
      <h3>📖 Персонаж (LSS)</h3>

      <div class="profile-grid">
        <div><b>Имя:</b> ${escapeHtml(safe(p.name))}</div>
        <div><b>Класс:</b> ${escapeHtml(safe(p.class_name))}</div>
        <div><b>Уровень:</b> ${safe(p.level)}</div>
        <div><b>Раса:</b> ${escapeHtml(safe(p.race))}</div>
        <div><b>Мировоззрение:</b> ${escapeHtml(safe(p.alignment))}</div>
        <div><b>Опыт:</b> ${safe(p.experience)}</div>
      </div>

      <h4>⚔️ Характеристики</h4>
      <div class="stats-grid">
        <div>STR: ${safe(stats.str)}</div>
        <div>DEX: ${safe(stats.dex)}</div>
        <div>CON: ${safe(stats.con)}</div>
        <div>INT: ${safe(stats.int)}</div>
        <div>WIS: ${safe(stats.wis)}</div>
        <div>CHA: ${safe(stats.cha)}</div>
      </div>
    </div>
  `;
}

// ------------------------------------------------------------
// 📜 ИСТОРИЯ
// ------------------------------------------------------------
export function renderHistory() {
  const container = document.getElementById("cabinet-history");
  if (!container) return;

  const history = LSS_STATE.profile?.history || [];

  if (!history.length) {
    container.innerHTML = `
      <div class="cabinet-block">
        <h3>📜 История</h3>
        <p>История пуста</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="cabinet-block">
      <h3>📜 История</h3>

      <div class="history-list">
        ${history
          .map(
            (entry, i) => `
          <div class="history-entry">
            <b>${i + 1}.</b> ${escapeHtml(
              typeof entry === "string" ? entry : entry.text || entry.title
            )}
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `;
}