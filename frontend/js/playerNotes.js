// ============================================================
// frontend/js/playerNotes.js
// Заметки игрока внутри кабинета
// - загрузка / сохранение
// - local fallback
// - autosave
// - preview rich-text
// - блок сообщения / заметки от ГМа
// - игрок видит обе зоны
// - игрок редактирует только свои заметки
// - ГМ редактирует и свои заметки для игрока, и заметки игрока
// - пишет события в history.js
// ============================================================

// ------------------------------------------------------------
// 🌐 STATE
// ------------------------------------------------------------
const PLAYER_NOTES_STATE = {
  role: "player",
  loaded: false,
  source: "empty",

  notesRaw: "",
  notesText: "",
  gmOverlayRaw: "",
  gmOverlayText: "",

  autosaveTimer: null,
  isSaving: false,
  lastSavedAt: null,
  lastSavedSnapshot: "",
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

function getEl(id) {
  return document.getElementById(id);
}

function showToast(message) {
  if (typeof window.showToast === "function") {
    window.showToast(message);
    return;
  }
  console.log(message);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeText(value, fallback = "") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function trimText(value) {
  return String(value ?? "").trim();
}

function normalizeRole(role) {
  const raw = String(role || "").trim().toLowerCase();
  if (raw === "gm" || raw === "admin") return "gm";
  return "player";
}

function getCurrentRole() {
  return normalizeRole(
    window.__appUserRole ||
      window.__userRole ||
      window.__appUser?.role ||
      document.body?.dataset?.role ||
      "player"
  );
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function apiGet(urls) {
  const list = Array.isArray(urls) ? urls : [urls];

  for (const url of list) {
    try {
      const res = await fetch(url, { headers: getHeaders() });
      if (!res.ok) continue;
      return await res.json();
    } catch (_) {}
  }

  return null;
}

async function apiWrite(urls, body, methods = ["POST", "PUT", "PATCH"]) {
  const list = Array.isArray(urls) ? urls : [urls];

  for (const method of methods) {
    for (const url of list) {
      try {
        const res = await fetch(url, {
          method,
          headers: getHeaders(true),
          body: JSON.stringify(body),
        });

        if (!res.ok) continue;
        return await res.json().catch(() => ({}));
      } catch (_) {}
    }
  }

  throw new Error("Failed to save notes");
}

function getLocalStorageKey() {
  const user = window.__appUser;
  const userKey =
    user?.email ||
    user?.id ||
    (getToken() ? "auth-user" : "guest");

  return `playerNotes:${userKey}`;
}

function saveLocalState(payload) {
  try {
    localStorage.setItem(getLocalStorageKey(), JSON.stringify(payload));
  } catch (_) {}
}

function loadLocalState() {
  try {
    const raw = localStorage.getItem(getLocalStorageKey());
    if (!raw) return null;
    return tryParseJson(raw);
  } catch {
    return null;
  }
}

function snapshotState() {
  return JSON.stringify({
    notesRaw: PLAYER_NOTES_STATE.notesRaw,
    gmOverlayRaw: PLAYER_NOTES_STATE.gmOverlayRaw,
  });
}

function emitNotesHistory(event) {
  const detail = {
    scope: "notes",
    created_at: new Date().toISOString(),
    ...event,
  };

  try {
    window.dispatchEvent(
      new CustomEvent("dnd:history:add", {
        detail,
      })
    );
  } catch (_) {}

  try {
    if (window.historyModule?.appendHistoryEntry) {
      window.historyModule.appendHistoryEntry(detail, {
        rerender: false,
        persistLocal: true,
        prepend: true,
      });
    }
  } catch (_) {}
}

// ------------------------------------------------------------
// 📝 RICH TEXT PARSING
// ------------------------------------------------------------
function parseTipTapDoc(value) {
  if (!value) return null;

  if (
    typeof value === "object" &&
    value?.type === "doc" &&
    Array.isArray(value?.content)
  ) {
    return value;
  }

  if (
    typeof value === "object" &&
    value?.data?.type === "doc" &&
    Array.isArray(value?.data?.content)
  ) {
    return value.data;
  }

  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    if (parsed) return parseTipTapDoc(parsed);
  }

  return null;
}

function docToPlainText(value) {
  if (!value) return "";

  if (typeof value === "string") return value;

  const doc = parseTipTapDoc(value);
  if (!doc) return safeText(value, "");

  const collect = (nodes = []) =>
    nodes
      .map((node) => {
        if (!node) return "";

        if (node.type === "text") return node.text || "";
        if (node.type === "hardBreak") return "\n";

        const inner = collect(node.content || []);
        if (
          node.type === "paragraph" ||
          node.type === "heading" ||
          node.type === "listItem" ||
          node.type === "blockquote"
        ) {
          return `${inner}\n`;
        }

        return inner;
      })
      .join("");

  return collect(doc.content || []).replace(/\n{3,}/g, "\n\n").trim();
}

function renderInline(nodes = []) {
  return (nodes || [])
    .map((node) => {
      if (!node) return "";

      if (node.type === "text") {
        let text = escapeHtml(node.text || "");
        const marks = Array.isArray(node.marks) ? node.marks : [];

        marks.forEach((mark) => {
          const type = mark?.type;
          if (type === "bold") text = `<strong>${text}</strong>`;
          else if (type === "italic") text = `<em>${text}</em>`;
          else if (type === "underline") text = `<u>${text}</u>`;
          else if (type === "strike") text = `<s>${text}</s>`;
          else if (type === "link") {
            const href = escapeHtml(mark?.attrs?.href || "#");
            text = `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`;
          }
        });

        return text;
      }

      if (node.type === "hardBreak") return "<br />";

      return renderNode(node);
    })
    .join("");
}

function renderNode(node) {
  if (!node || typeof node !== "object") return "";

  if (node.type === "paragraph") {
    return `<p>${renderInline(node.content || []) || "&nbsp;"}</p>`;
  }

  if (node.type === "bulletList") {
    return `<ul>${(node.content || []).map(renderNode).join("")}</ul>`;
  }

  if (node.type === "orderedList") {
    const start = node.attrs?.start ? ` start="${Number(node.attrs.start)}"` : "";
    return `<ol${start}>${(node.content || []).map(renderNode).join("")}</ol>`;
  }

  if (node.type === "listItem") {
    return `<li>${(node.content || []).map(renderNode).join("")}</li>`;
  }

  if (node.type === "heading") {
    const level = Math.min(Math.max(Number(node.attrs?.level || 3), 1), 6);
    return `<h${level}>${renderInline(node.content || [])}</h${level}>`;
  }

  if (node.type === "blockquote") {
    return `<blockquote>${(node.content || []).map(renderNode).join("")}</blockquote>`;
  }

  if (node.type === "text") {
    return renderInline([node]);
  }

  return (node.content || []).map(renderNode).join("");
}

function renderRichText(value, fallback = "—") {
  const doc = parseTipTapDoc(value);

  if (!doc) {
    const text = safeText(value, fallback);
    return `<p>${escapeHtml(text)}</p>`;
  }

  return (doc.content || []).map(renderNode).join("") || `<p>${escapeHtml(fallback)}</p>`;
}

function getPlainTextLength(value) {
  return docToPlainText(value).trim().length;
}

function formatTime(value) {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

// ------------------------------------------------------------
// 📥 LOAD
// ------------------------------------------------------------
function tryLoadFromWindow() {
  const candidates = [
    window.__PLAYER_NOTES__,
    window.__playerNotes,
    window.__NOTES_DATA__,
    window.__notesData,
  ];

  for (const candidate of candidates) {
    if (candidate) return candidate;
  }

  return null;
}

function normalizeLoadedData(data) {
  const notesRaw =
    data?.notes ??
    data?.player_notes ??
    data?.text ??
    data?.content ??
    "";

  const gmOverlayRaw =
    data?.gm_notes ??
    data?.gm_overlay ??
    data?.gmMessage ??
    "";

  return {
    notesRaw,
    notesText: docToPlainText(notesRaw),
    gmOverlayRaw,
    gmOverlayText: docToPlainText(gmOverlayRaw),
  };
}

export async function loadPlayerNotes() {
  PLAYER_NOTES_STATE.role = getCurrentRole();

  let data = await apiGet([
    "/player/notes",
    "/notes/me",
    "/notes",
  ]);
  let source = "api";

  if (!data) {
    data = tryLoadFromWindow();
    source = "window";
  }

  if (!data) {
    const localState = loadLocalState();

    if (localState) {
      PLAYER_NOTES_STATE.notesRaw = localState.notesRaw ?? localState.notes ?? "";
      PLAYER_NOTES_STATE.notesText =
        localState.notesText ?? docToPlainText(PLAYER_NOTES_STATE.notesRaw);
      PLAYER_NOTES_STATE.gmOverlayRaw = localState.gmOverlayRaw ?? "";
      PLAYER_NOTES_STATE.gmOverlayText =
        localState.gmOverlayText ?? docToPlainText(PLAYER_NOTES_STATE.gmOverlayRaw);
      PLAYER_NOTES_STATE.loaded = true;
      PLAYER_NOTES_STATE.source = "local";
      PLAYER_NOTES_STATE.lastSavedSnapshot = snapshotState();
      renderNotes();
      return PLAYER_NOTES_STATE.notesText;
    }

    PLAYER_NOTES_STATE.notesRaw = "";
    PLAYER_NOTES_STATE.notesText = "";
    PLAYER_NOTES_STATE.gmOverlayRaw = "";
    PLAYER_NOTES_STATE.gmOverlayText = "";
    PLAYER_NOTES_STATE.loaded = true;
    PLAYER_NOTES_STATE.source = "empty";
    PLAYER_NOTES_STATE.lastSavedSnapshot = snapshotState();
    renderNotes();
    return "";
  }

  const normalized = normalizeLoadedData(data);

  PLAYER_NOTES_STATE.notesRaw = normalized.notesRaw;
  PLAYER_NOTES_STATE.notesText = normalized.notesText;
  PLAYER_NOTES_STATE.gmOverlayRaw = normalized.gmOverlayRaw;
  PLAYER_NOTES_STATE.gmOverlayText = normalized.gmOverlayText;
  PLAYER_NOTES_STATE.loaded = true;
  PLAYER_NOTES_STATE.source = source;
  PLAYER_NOTES_STATE.lastSavedSnapshot = snapshotState();

  saveLocalState({
    notesRaw: PLAYER_NOTES_STATE.notesRaw,
    notesText: PLAYER_NOTES_STATE.notesText,
    gmOverlayRaw: PLAYER_NOTES_STATE.gmOverlayRaw,
    gmOverlayText: PLAYER_NOTES_STATE.gmOverlayText,
  });

  renderNotes();
  return PLAYER_NOTES_STATE.notesText;
}

// ------------------------------------------------------------
// 🧱 STATE SYNC
// ------------------------------------------------------------
function readNotesFromInputs() {
  const notesArea = getEl("playerNotesTextarea");
  const gmArea = getEl("gmOverlayTextarea");

  PLAYER_NOTES_STATE.notesRaw = safeText(notesArea?.value, "");
  PLAYER_NOTES_STATE.notesText = docToPlainText(PLAYER_NOTES_STATE.notesRaw);

  if (PLAYER_NOTES_STATE.role === "gm") {
    PLAYER_NOTES_STATE.gmOverlayRaw = safeText(gmArea?.value, "");
    PLAYER_NOTES_STATE.gmOverlayText = docToPlainText(PLAYER_NOTES_STATE.gmOverlayRaw);
  }
}

function updateInputValuesFromState() {
  const notesArea = getEl("playerNotesTextarea");
  const gmArea = getEl("gmOverlayTextarea");

  if (notesArea) {
    notesArea.value = safeText(PLAYER_NOTES_STATE.notesText || PLAYER_NOTES_STATE.notesRaw, "");
  }

  if (gmArea) {
    gmArea.value = safeText(PLAYER_NOTES_STATE.gmOverlayText || PLAYER_NOTES_STATE.gmOverlayRaw, "");
  }
}

function persistLocalSnapshot() {
  saveLocalState({
    notesRaw: PLAYER_NOTES_STATE.notesRaw,
    notesText: PLAYER_NOTES_STATE.notesText,
    gmOverlayRaw: PLAYER_NOTES_STATE.gmOverlayRaw,
    gmOverlayText: PLAYER_NOTES_STATE.gmOverlayText,
  });
}

// ------------------------------------------------------------
// 💾 SAVE
// ------------------------------------------------------------
export async function savePlayerNotes(options = {}) {
  const {
    silent = false,
    skipHistory = false,
  } = options || {};

  readNotesFromInputs();

  const nextSnapshot = snapshotState();
  if (
    nextSnapshot === PLAYER_NOTES_STATE.lastSavedSnapshot &&
    PLAYER_NOTES_STATE.loaded
  ) {
    if (!silent) {
      showToast("Изменений нет");
    }
    return true;
  }

  PLAYER_NOTES_STATE.isSaving = true;
  renderNotes();

  const prevNotes = PLAYER_NOTES_STATE.notesText;
  const prevGm = PLAYER_NOTES_STATE.gmOverlayText;

  try {
    await apiWrite(
      ["/player/notes", "/notes/me", "/notes"],
      {
        notes: PLAYER_NOTES_STATE.notesRaw,
        player_notes: PLAYER_NOTES_STATE.notesRaw,
        gm_notes: PLAYER_NOTES_STATE.gmOverlayRaw,
        gm_overlay: PLAYER_NOTES_STATE.gmOverlayRaw,
        gmMessage: PLAYER_NOTES_STATE.gmOverlayRaw,
      },
      ["POST", "PUT", "PATCH"]
    );

    PLAYER_NOTES_STATE.source = "api";
  } catch (_) {
    PLAYER_NOTES_STATE.source = "local";
  }

  PLAYER_NOTES_STATE.notesText = docToPlainText(PLAYER_NOTES_STATE.notesRaw);
  PLAYER_NOTES_STATE.gmOverlayText = docToPlainText(PLAYER_NOTES_STATE.gmOverlayRaw);
  PLAYER_NOTES_STATE.lastSavedAt = new Date().toISOString();
  PLAYER_NOTES_STATE.lastSavedSnapshot = snapshotState();

  persistLocalSnapshot();

  PLAYER_NOTES_STATE.isSaving = false;
  renderNotes();

  if (!skipHistory) {
    if (prevNotes !== PLAYER_NOTES_STATE.notesText) {
      emitNotesHistory({
        type: "player_notes_save",
        action: "player_notes_save",
        title: "Обновлены заметки игрока",
        message: PLAYER_NOTES_STATE.notesText
          ? `Символов: ${PLAYER_NOTES_STATE.notesText.length}`
          : "Заметки игрока очищены",
      });
    }

    if (prevGm !== PLAYER_NOTES_STATE.gmOverlayText) {
      emitNotesHistory({
        scope: "gm",
        type: "gm_overlay_save",
        action: "gm_overlay_save",
        title: "Обновлено сообщение от ГМа",
        message: PLAYER_NOTES_STATE.gmOverlayText
          ? `Символов: ${PLAYER_NOTES_STATE.gmOverlayText.length}`
          : "Сообщение ГМа очищено",
      });
    }
  }

  if (!silent) {
    showToast("Заметки сохранены");
  }

  return true;
}

function queueAutosave() {
  if (PLAYER_NOTES_STATE.autosaveTimer) {
    clearTimeout(PLAYER_NOTES_STATE.autosaveTimer);
  }

  PLAYER_NOTES_STATE.autosaveTimer = setTimeout(() => {
    savePlayerNotes({ silent: true });
  }, 900);
}

// ------------------------------------------------------------
// 🧱 RENDER HELPERS
// ------------------------------------------------------------
function renderStatsBar() {
  const notesLength = getPlainTextLength(PLAYER_NOTES_STATE.notesRaw);
  const gmLength = getPlainTextLength(PLAYER_NOTES_STATE.gmOverlayRaw);

  return `
    <div class="muted" style="margin-bottom:10px;">
      Источник: <strong>${escapeHtml(PLAYER_NOTES_STATE.source)}</strong>
      • Символов игрока: <strong>${escapeHtml(String(notesLength))}</strong>
      • Сообщение ГМа: <strong>${escapeHtml(String(gmLength))}</strong>
      • Роль: <strong>${escapeHtml(PLAYER_NOTES_STATE.role)}</strong>
      • Последнее сохранение: <strong>${escapeHtml(formatTime(PLAYER_NOTES_STATE.lastSavedAt))}</strong>
    </div>
  `;
}

function renderPlayerPreviewBlock() {
  const hasRich =
    typeof PLAYER_NOTES_STATE.notesRaw === "object" ||
    parseTipTapDoc(PLAYER_NOTES_STATE.notesRaw);

  if (!hasRich) return "";

  return `
    <div class="cabinet-block" style="margin-top:12px;">
      <h4>Предпросмотр форматированных заметок игрока</h4>
      <div class="lss-rich-block">
        ${renderRichText(PLAYER_NOTES_STATE.notesRaw, "—")}
      </div>
    </div>
  `;
}

function renderGmPreviewBlock() {
  const hasRich =
    typeof PLAYER_NOTES_STATE.gmOverlayRaw === "object" ||
    parseTipTapDoc(PLAYER_NOTES_STATE.gmOverlayRaw);

  if (!hasRich) return "";

  return `
    <div class="cabinet-block" style="margin-top:12px;">
      <h4>Предпросмотр сообщения ГМа</h4>
      <div class="lss-rich-block">
        ${renderRichText(PLAYER_NOTES_STATE.gmOverlayRaw, "—")}
      </div>
    </div>
  `;
}

function renderGmOverlayBlock() {
  const hasContent = Boolean(trimText(PLAYER_NOTES_STATE.gmOverlayText || PLAYER_NOTES_STATE.gmOverlayRaw));
  const editable = PLAYER_NOTES_STATE.role === "gm";

  return `
    <div class="cabinet-block" style="margin-top:12px;">
      <h4>Сообщение / заметка от ГМа</h4>

      ${
        editable
          ? `
            <div class="muted" style="margin-bottom:8px;">
              Этот блок видят и игрок, и ГМ. Редактировать может только ГМ.
            </div>

            <textarea
              id="gmOverlayTextarea"
              rows="7"
              placeholder="Здесь ГМ может оставить сообщение, подсказку, предупреждение или скрытую рамку для игрока"
            >${escapeHtml(PLAYER_NOTES_STATE.gmOverlayText || PLAYER_NOTES_STATE.gmOverlayRaw || "")}</textarea>
          `
          : hasContent
            ? `
              <div class="lss-rich-block">
                ${renderRichText(PLAYER_NOTES_STATE.gmOverlayRaw, "—")}
              </div>
            `
            : `
              <div class="muted">ГМ пока ничего не оставил.</div>
            `
      }
    </div>
  `;
}

function renderToolbar() {
  return `
    <div class="modal-actions" style="margin-top:12px; gap:8px; flex-wrap:wrap;">
      <button id="savePlayerNotesBtn" class="btn btn-success" ${PLAYER_NOTES_STATE.isSaving ? "disabled" : ""}>
        ${PLAYER_NOTES_STATE.isSaving ? "Сохраняю..." : "Сохранить"}
      </button>

      <button id="reloadPlayerNotesBtn" class="btn">Обновить</button>
      <button id="clearPlayerNotesBtn" class="btn btn-danger">Очистить заметки игрока</button>
      ${
        PLAYER_NOTES_STATE.role === "gm"
          ? `<button id="clearGmOverlayBtn" class="btn btn-danger">Очистить сообщение ГМа</button>`
          : ""
      }
    </div>
  `;
}

// ------------------------------------------------------------
// 🧱 MAIN RENDER
// ------------------------------------------------------------
export function renderNotes() {
  const container = getEl("cabinet-playernotes");
  if (!container) return;

  container.innerHTML = `
    <div class="cabinet-block">
      <h3>Заметки игрока</h3>
      ${renderStatsBar()}

      <div class="muted" style="margin-bottom:8px;">
        Личный блок игрока. Игрок всегда может редактировать эту часть.
      </div>

      <textarea
        id="playerNotesTextarea"
        rows="12"
        placeholder="Сюда можно писать свои заметки, планы, подозрения, контакты, улики и всё полезное по кампании"
      >${escapeHtml(PLAYER_NOTES_STATE.notesText || PLAYER_NOTES_STATE.notesRaw || "")}</textarea>

      ${renderToolbar()}
    </div>

    ${renderGmOverlayBlock()}
    ${renderPlayerPreviewBlock()}
    ${renderGmPreviewBlock()}
  `;

  bindNotesActions();
}

// ------------------------------------------------------------
// 🎛 ACTIONS
// ------------------------------------------------------------
function bindNotesActions() {
  const notesArea = getEl("playerNotesTextarea");
  const gmArea = getEl("gmOverlayTextarea");
  const saveBtn = getEl("savePlayerNotesBtn");
  const reloadBtn = getEl("reloadPlayerNotesBtn");
  const clearBtn = getEl("clearPlayerNotesBtn");
  const clearGmBtn = getEl("clearGmOverlayBtn");

  if (notesArea && notesArea.dataset.boundPlayerNotes !== "1") {
    notesArea.dataset.boundPlayerNotes = "1";
    notesArea.addEventListener("input", () => {
      PLAYER_NOTES_STATE.notesRaw = notesArea.value;
      PLAYER_NOTES_STATE.notesText = notesArea.value;
      queueAutosave();
    });
  }

  if (gmArea && gmArea.dataset.boundGmOverlay !== "1") {
    gmArea.dataset.boundGmOverlay = "1";
    gmArea.addEventListener("input", () => {
      if (PLAYER_NOTES_STATE.role !== "gm") return;
      PLAYER_NOTES_STATE.gmOverlayRaw = gmArea.value;
      PLAYER_NOTES_STATE.gmOverlayText = gmArea.value;
      queueAutosave();
    });
  }

  if (saveBtn && saveBtn.dataset.boundSaveNotes !== "1") {
    saveBtn.dataset.boundSaveNotes = "1";
    saveBtn.addEventListener("click", async () => {
      await savePlayerNotes();
    });
  }

  if (reloadBtn && reloadBtn.dataset.boundReloadNotes !== "1") {
    reloadBtn.dataset.boundReloadNotes = "1";
    reloadBtn.addEventListener("click", async () => {
      await loadPlayerNotes();
      showToast("Заметки обновлены");
    });
  }

  if (clearBtn && clearBtn.dataset.boundClearNotes !== "1") {
    clearBtn.dataset.boundClearNotes = "1";
    clearBtn.addEventListener("click", async () => {
      const ok = confirm("Очистить заметки игрока?");
      if (!ok) return;

      PLAYER_NOTES_STATE.notesRaw = "";
      PLAYER_NOTES_STATE.notesText = "";
      updateInputValuesFromState();
      await savePlayerNotes({ silent: false });
      emitNotesHistory({
        type: "player_notes_clear",
        action: "player_notes_clear",
        title: "Очищены заметки игрока",
        message: "Личный блок игрока был очищен",
      });
    });
  }

  if (clearGmBtn && clearGmBtn.dataset.boundClearGmNotes !== "1") {
    clearGmBtn.dataset.boundClearGmNotes = "1";
    clearGmBtn.addEventListener("click", async () => {
      if (PLAYER_NOTES_STATE.role !== "gm") return;

      const ok = confirm("Очистить сообщение ГМа для игрока?");
      if (!ok) return;

      PLAYER_NOTES_STATE.gmOverlayRaw = "";
      PLAYER_NOTES_STATE.gmOverlayText = "";
      updateInputValuesFromState();
      await savePlayerNotes({ silent: false });
      emitNotesHistory({
        scope: "gm",
        type: "gm_overlay_clear",
        action: "gm_overlay_clear",
        title: "Очищено сообщение ГМа",
        message: "Блок сообщения для игрока был очищен",
      });
    });
  }
}

// ------------------------------------------------------------
// 🚀 INIT
// ------------------------------------------------------------
export async function initPlayerNotes() {
  await loadPlayerNotes();
  renderNotes();
}

// ------------------------------------------------------------
// 🌉 LEGACY BRIDGE
// ------------------------------------------------------------
window.playerNotesModule = {
  loadPlayerNotes,
  renderNotes,
  savePlayerNotes,
  initPlayerNotes,
};