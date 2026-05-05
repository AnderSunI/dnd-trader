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

import {
  apiGet,
  apiWrite as sharedApiWrite,
  buildUserScopedStorageKey,
  escapeHtml,
  formatTime,
  getCurrentRole,
  getEl,
  normalizeRole,
  safeText,
  showToast,
  trimText,
  tryParseJson,
} from "./shared.js";

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
async function apiWrite(urls, body, methods = ["POST", "PUT", "PATCH"]) {
  const result = await sharedApiWrite(urls, body, methods);
  if (result === null) {
    throw new Error("Failed to save notes");
  }
  return result;
}

function getLocalStorageKey() {
  return buildUserScopedStorageKey("playerNotes:");
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

  let data = await apiGet("/player/notes");
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
      "/player/notes",
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
function getNotesSummary() {
  const notesLength = getPlainTextLength(PLAYER_NOTES_STATE.notesRaw);
  const gmLength = getPlainTextLength(PLAYER_NOTES_STATE.gmOverlayRaw);
  const noteLines = docToPlainText(PLAYER_NOTES_STATE.notesRaw)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean).length;
  const hasGmMessage = Boolean(trimText(PLAYER_NOTES_STATE.gmOverlayText || PLAYER_NOTES_STATE.gmOverlayRaw));

  return {
    notesLength,
    gmLength,
    noteLines,
    hasGmMessage,
    role: PLAYER_NOTES_STATE.role,
    source: PLAYER_NOTES_STATE.source,
    lastSaved: formatTime(PLAYER_NOTES_STATE.lastSavedAt),
  };
}

function getSaveStateLabel() {
  if (PLAYER_NOTES_STATE.isSaving) return "Сохранение...";
  if (PLAYER_NOTES_STATE.lastSavedAt) return `Сохранено ${formatTime(PLAYER_NOTES_STATE.lastSavedAt)}`;
  if (PLAYER_NOTES_STATE.source === "local") return "Локальная копия";
  if (PLAYER_NOTES_STATE.source === "api") return "Синхронизировано";
  return "Черновик";
}

function renderNotesMetric(label, value, hint = "") {
  return `
    <div class="notes-ref-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
    </div>
  `;
}

function renderNotesHero() {
  const summary = getNotesSummary();
  const roleLabel = PLAYER_NOTES_STATE.role === "gm" ? "GM-доступ" : "Игрок";
  const syncLabel = getSaveStateLabel();

  return `
    <section class="cabinet-block notes-ref-hero">
      <div class="notes-ref-hero-main">
        <div class="notes-ref-kicker">Журнал игрока</div>
        <h3>Заметки кампании</h3>
        <p>
          Личный блок для планов, подозрений, контактов и улик. ГМ может добавить отдельное сообщение,
          которое увидит игрок, не ломая личные заметки.
        </p>
        <div class="notes-ref-hero-meta">
          <span>Источник: ${escapeHtml(summary.source)}</span>
          <span>Роль: ${escapeHtml(roleLabel)}</span>
          <span>${escapeHtml(syncLabel)}</span>
        </div>
      </div>
      <div class="notes-ref-hero-grid">
        ${renderNotesMetric("Символов", summary.notesLength, "личные заметки")}
        ${renderNotesMetric("Строк", summary.noteLines, "рабочие пункты")}
        ${renderNotesMetric("GM", summary.gmLength, summary.hasGmMessage ? "есть сообщение" : "пусто")}
        ${renderNotesMetric("Режим", roleLabel, "доступ")}
      </div>
    </section>
  `;
}

function renderEditorToolbar() {
  return `
    <div class="notes-ref-toolbar">
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

function renderPlayerEditorPanel() {
  return `
    <section class="cabinet-block notes-ref-panel notes-ref-editor-panel">
      <div class="notes-ref-panel-head">
        <div>
          <div class="notes-ref-kicker">Личный блок</div>
          <h4>Заметки игрока</h4>
          <p class="muted">Игрок всегда может редактировать эту часть. Автосохранение включается после ввода.</p>
        </div>
        <span class="notes-ref-status-pill">${escapeHtml(getSaveStateLabel())}</span>
      </div>

      <div class="notes-ref-editor-shell">
        <textarea
          id="playerNotesTextarea"
          rows="16"
          placeholder="Планы, подозрения, контакты, улики, маршруты, договорённости, обещания NPC..."
        >${escapeHtml(PLAYER_NOTES_STATE.notesText || PLAYER_NOTES_STATE.notesRaw || "")}</textarea>
      </div>

      ${renderEditorToolbar()}
    </section>
  `;
}

function renderGmOverlayPanel() {
  const hasContent = Boolean(trimText(PLAYER_NOTES_STATE.gmOverlayText || PLAYER_NOTES_STATE.gmOverlayRaw));
  const editable = PLAYER_NOTES_STATE.role === "gm";

  return `
    <section class="cabinet-block notes-ref-panel notes-ref-gm-panel ${hasContent ? "has-gm-message" : "is-empty"}">
      <div class="notes-ref-panel-head">
        <div>
          <div class="notes-ref-kicker">Сообщение мастера</div>
          <h4>Заметка от ГМа</h4>
          <p class="muted">
            ${editable
              ? "Этот блок видят и игрок, и ГМ. Редактировать может только ГМ."
              : "Этот блок содержит сообщение, подсказку или рамку от мастера."
            }
          </p>
        </div>
        <span class="notes-ref-status-pill ${hasContent ? "is-active" : ""}">
          ${hasContent ? "Есть сообщение" : "Пусто"}
        </span>
      </div>

      ${
        editable
          ? `
            <textarea
              id="gmOverlayTextarea"
              rows="10"
              placeholder="Сообщение от ГМа: подсказка, предупреждение, секретный контекст, рамка сцены..."
            >${escapeHtml(PLAYER_NOTES_STATE.gmOverlayText || PLAYER_NOTES_STATE.gmOverlayRaw || "")}</textarea>
          `
          : hasContent
            ? `
              <div class="notes-ref-gm-message">
                ${renderRichText(PLAYER_NOTES_STATE.gmOverlayRaw, "—")}
              </div>
            `
            : `
              <div class="notes-ref-empty-mini">
                <strong>ГМ пока ничего не оставил.</strong>
                <span>Когда появится подсказка или сообщение мастера, оно будет здесь.</span>
              </div>
            `
      }
    </section>
  `;
}

function renderPreviewPanel(title, content, fallback, className = "") {
  return `
    <section class="cabinet-block notes-ref-panel notes-ref-preview-panel ${escapeHtml(className)}">
      <div class="notes-ref-panel-head">
        <div>
          <div class="notes-ref-kicker">Предпросмотр</div>
          <h4>${escapeHtml(title)}</h4>
        </div>
      </div>
      <div class="notes-ref-rich-preview">
        ${renderRichText(content, fallback)}
      </div>
    </section>
  `;
}

function renderPlayerPreviewBlock() {
  const hasRich =
    typeof PLAYER_NOTES_STATE.notesRaw === "object" ||
    parseTipTapDoc(PLAYER_NOTES_STATE.notesRaw);

  if (!hasRich) return "";

  return renderPreviewPanel(
    "Форматированные заметки игрока",
    PLAYER_NOTES_STATE.notesRaw,
    "—",
    "notes-ref-player-preview"
  );
}

function renderGmPreviewBlock() {
  const hasRich =
    typeof PLAYER_NOTES_STATE.gmOverlayRaw === "object" ||
    parseTipTapDoc(PLAYER_NOTES_STATE.gmOverlayRaw);

  if (!hasRich) return "";

  return renderPreviewPanel(
    "Форматированное сообщение ГМа",
    PLAYER_NOTES_STATE.gmOverlayRaw,
    "—",
    "notes-ref-gm-preview"
  );
}

function renderNotesEmptyHint() {
  const hasNotes = Boolean(trimText(PLAYER_NOTES_STATE.notesText || PLAYER_NOTES_STATE.notesRaw));
  if (hasNotes) return "";

  return `
    <aside class="cabinet-block notes-ref-panel notes-ref-empty-hint">
      <div class="notes-ref-kicker">Быстрый старт</div>
      <h4>С чего начать?</h4>
      <ul>
        <li>Кто дал задание или слух?</li>
        <li>Что партия обещала сделать?</li>
        <li>Какие NPC, места или предметы важны?</li>
        <li>Что скрыто от остальных игроков?</li>
      </ul>
    </aside>
  `;
}

// ------------------------------------------------------------
// 🧱 MAIN RENDER
// ------------------------------------------------------------
export function renderNotes() {
  const container = getEl("cabinet-playernotes");
  if (!container) return;

  container.innerHTML = `
    <div class="notes-ref-shell" data-notes-role="${escapeHtml(PLAYER_NOTES_STATE.role)}">
      ${renderNotesHero()}

      <div class="notes-ref-layout">
        <main class="notes-ref-main-column">
          ${renderPlayerEditorPanel()}
          ${renderPlayerPreviewBlock()}
        </main>

        <aside class="notes-ref-side-column">
          ${renderGmOverlayPanel()}
          ${renderNotesEmptyHint()}
          ${renderGmPreviewBlock()}
        </aside>
      </div>
    </div>
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
