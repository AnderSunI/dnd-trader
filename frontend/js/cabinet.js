// ============================================================
// frontend/js/cabinet.js
// Личный кабинет игрока / ГМа
// - role-based вкладки
// - открытие / закрытие модалки
// - загрузка модулей кабинета
// - LSS отдельно
// - History отдельно через history.js
// - player notes отдельно через playerNotes.js
// - GM-only private notes прямо здесь, в cabinet.js
// - инвентарь кабинета + рабочая форма кастомного предмета
// - файлы игрока: local-first + попытка API + drag&drop сортировка
// ============================================================

import {
  loadLSS,
  renderLSS,
} from "./longstoryshort.js";

import {
  loadHistory,
  renderHistory,
} from "./history.js";

import {
  loadMapData,
  renderMaps,
} from "./maps.js";

import {
  loadQuests,
  renderQuests,
} from "./quests.js";

import {
  loadPlayerNotes,
  renderNotes,
} from "./playerNotes.js";

import {
  loadCodex as loadBestiari,
  renderCodex as renderBestiari,
} from "./bestiari.js";

// ------------------------------------------------------------
// 🌐 STATE
// ------------------------------------------------------------
const CABINET_STATE = {
  activeTab: "inventory",
  role: "player",
  initialized: false,
};

const GM_NOTES_STATE = {
  loaded: false,
  source: "empty",
  text: "",
  raw: "",
  isSaving: false,
  lastSavedAt: null,
};

const CABINET_INVENTORY_STATE = {
  customFormOpen: false,
};

const FILES_STATE = {
  loaded: false,
  source: "empty",
  items: [],
  draggedIndex: null,
  isSaving: false,
  lastSavedAt: null,
};

const CODEX_STATE = {
  query: "",
  category: "all",
  selectedId: "",
};

const CABINET_RUNTIME = {
  refreshing: false,
  pendingRefresh: false,
};

// ------------------------------------------------------------
// 🧰 HELPERS
// ------------------------------------------------------------
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

function safeText(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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

function getCurrentUser() {
  return window.__appUser || null;
}

function getInventoryState() {
  if (Array.isArray(window.__appStateInventory)) {
    return window.__appStateInventory;
  }

  try {
    const raw = localStorage.getItem("dnd_inventory");
    const parsed = tryParseJson(raw);
    if (Array.isArray(parsed)) {
      window.__appStateInventory = parsed;
      return window.__appStateInventory;
    }
  } catch (_) {}

  window.__appStateInventory = [];
  return window.__appStateInventory;
}

function openModal(modal) {
  if (modal) modal.style.display = "block";
}

function closeModal(modal) {
  if (modal) modal.style.display = "none";
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

function formatDateTime(value) {
  if (!value) return "—";

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

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

  throw new Error("Failed to save");
}

function emitCabinetHistory(detail) {
  const payload = {
    created_at: new Date().toISOString(),
    ...detail,
  };

  try {
    window.dispatchEvent(
      new CustomEvent("dnd:history:add", {
        detail: payload,
      })
    );
  } catch (_) {}

  try {
    if (window.historyModule?.appendHistoryEntry) {
      window.historyModule.appendHistoryEntry(payload, {
        rerender: false,
        persistLocal: true,
        prepend: true,
      });
    }
  } catch (_) {}
}

function getUserScopedKey(base) {
  const user = getCurrentUser();
  const userKey =
    user?.email ||
    user?.id ||
    (getToken() ? "auth-user" : "guest");

  return `${base}:${userKey}`;
}

function rarityClass(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

  if (raw === "common") return "rarity-common";
  if (raw === "uncommon") return "rarity-uncommon";
  if (raw === "rare") return "rarity-rare";
  if (raw === "veryrare" || raw === "very rare") return "rarity-veryrare";
  if (raw === "legendary") return "rarity-legendary";
  if (raw === "artifact") return "rarity-artifact";
  return "rarity-common";
}

function formatPriceLabel(item) {
  if (item?.sell_price_label) return item.sell_price_label;
  if (item?.price_label) return item.price_label;

  const gold = safeNumber(item?.sell_price_gold ?? item?.price_gold ?? 0, 0);
  const silver = safeNumber(item?.sell_price_silver ?? item?.price_silver ?? 0, 0);
  const copper = safeNumber(item?.sell_price_copper ?? item?.price_copper ?? 0, 0);

  const parts = [];
  if (gold) parts.push(`${gold}з`);
  if (silver) parts.push(`${silver}с`);
  if (copper) parts.push(`${copper}м`);

  return parts.length ? parts.join(" ") : "—";
}

function moneyPartsToCp(gold = 0, silver = 0, copper = 0) {
  return Math.max(
    0,
    safeNumber(gold, 0) * 10000 +
      safeNumber(silver, 0) * 100 +
      safeNumber(copper, 0)
  );
}

function cpToMoneyParts(cp = 0) {
  const total = Math.max(0, safeNumber(cp, 0));
  const gold = Math.floor(total / 10000);
  const goldRest = total % 10000;
  const silver = Math.floor(goldRest / 100);
  const copper = goldRest % 100;
  return { gold, silver, copper };
}

function getInventoryCount(items) {
  return (Array.isArray(items) ? items : []).reduce(
    (sum, item) => sum + Math.max(1, safeNumber(item?.quantity, 1)),
    0
  );
}

function getNextCustomItemId(items) {
  const maxExisting = (Array.isArray(items) ? items : []).reduce((max, item) => {
    const id = Number(item?.item_id ?? item?.id ?? 0);
    return Number.isFinite(id) ? Math.max(max, id) : max;
  }, 1000000);

  return maxExisting + 1;
}

function normalizeQuality(value) {
  const raw = String(value || "").trim().toLowerCase();

  if (!raw) return "стандартное";
  if (raw === "good" || raw === "хорошее") return "хорошее";
  if (raw === "perfect" || raw === "идеальное") return "идеальное";
  return raw;
}

function normalizeRarityValue(value) {
  const raw = String(value || "").trim().toLowerCase();

  if (!raw) return "common";
  if (raw === "very rare" || raw === "veryrare") return "very rare";
  return raw;
}

async function readFileAsDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes) {
  const value = Math.max(0, safeNumber(bytes, 0));
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fileTypeLabel(type) {
  const raw = String(type || "").trim().toLowerCase();
  if (!raw) return "file";
  if (raw.includes("image")) return "image";
  if (raw.includes("pdf")) return "pdf";
  if (raw.includes("json")) return "json";
  if (raw.includes("text")) return "text";
  return raw;
}

// ------------------------------------------------------------
// 📑 TAB CONFIG
// ------------------------------------------------------------
function getVisibleTabsByRole(role) {
  const tabs = [
    { key: "inventory", label: "🎒 Инвентарь" },
    { key: "lss", label: "📖 LSS" },
    { key: "history", label: "📜 История" },
    { key: "quests", label: "🧭 Задания" },
    { key: "map", label: "🗺️ Карта" },
    { key: "bestiari", label: "📚 Энциклопедия" },
    { key: "files", label: "📁 Файлы" },
    { key: "playernotes", label: "📝 Заметки" },
  ];

  if (role === "gm") {
    tabs.push({ key: "gmnotes", label: "🛡️ Заметки ГМа" });
  }

  return tabs;
}

function getSectionIdForTab(tabName) {
  const map = {
    inventory: "cabinet-inventory",
    lss: "cabinet-lss",
    history: "cabinet-history",
    quests: "cabinet-quests",
    map: "cabinet-map",
    bestiari: "cabinet-bestiari",
    files: "cabinet-files",
    playernotes: "cabinet-playernotes",
    gmnotes: "cabinet-gmnotes",
  };

  return map[tabName] || "cabinet-inventory";
}

function hideAllCabinetSections() {
  [
    "cabinet-inventory",
    "cabinet-lss",
    "cabinet-history",
    "cabinet-quests",
    "cabinet-map",
    "cabinet-bestiari",
    "cabinet-files",
    "cabinet-playernotes",
    "cabinet-gmnotes",
  ].forEach((id) => {
    const el = getEl(id);
    if (el) el.classList.add("tab-hidden");
  });
}

function setActiveCabinetButton(tabName) {
  document.querySelectorAll("[data-cabinet-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.cabinetTab === tabName);
  });
}

// ------------------------------------------------------------
// 🏗️ SHELL
// ------------------------------------------------------------
function ensureCabinetStructure() {
  const modal = getEl("cabinetModal");
  if (!modal) return null;

  const tabButtons = getEl("cabinetTabButtons");
  const header = getEl("cabinetHeader");
  const main = modal.querySelector(".cabinet-main");

  if (!tabButtons || !header || !main) {
    console.warn("Cabinet DOM structure incomplete");
  }

  if (main && !getEl("cabinet-bestiari")) {
    const section = document.createElement("div");
    section.id = "cabinet-bestiari";
    section.className = "cabinet-section tab-hidden";
    main.appendChild(section);
  }

  return modal;
}

function renderCabinetHeader() {
  const header = getEl("cabinetHeader");
  if (!header) return;

  const user = getCurrentUser();
  const role = CABINET_STATE.role === "gm" ? "ГМ" : "Игрок";

  header.innerHTML = `
    <div class="cabinet-header-inner">
      <div class="flex-between">
        <div>
          <h2 style="margin:0;">Кабинет персонажа</h2>
          <div class="muted">
            Роль: <strong>${escapeHtml(role)}</strong>
            ${user?.email ? ` • ${escapeHtml(user.email)}` : ""}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCabinetTabs() {
  const root = getEl("cabinetTabButtons");
  if (!root) return;

  const tabs = getVisibleTabsByRole(CABINET_STATE.role);

  root.innerHTML = tabs
    .map((tab) => {
      const active = tab.key === CABINET_STATE.activeTab ? "active" : "";
      return `
        <button class="btn ${active}" data-cabinet-tab="${escapeHtml(tab.key)}">
          ${escapeHtml(tab.label)}
        </button>
      `;
    })
    .join("");
}

// ------------------------------------------------------------
// 📚 CODEX / ENCYCLOPEDIA
// ------------------------------------------------------------
const CODEX_CATEGORY_LABELS = {
  all: "Всё",
  monsters: "Монстры",
  gods: "Боги",
  lore: "Лор",
  spells: "Заклинания",
  items: "Предметы",
  classes: "Классы",
  factions: "Фракции",
};

const CODEX_ENTRIES = [
  {
    id: "monster-goblin",
    category: "monsters",
    title: "Гоблин",
    subtitle: "Мелкий рейдер и разведчик",
    tags: ["монстр", "гуманоид", "низкий CR"],
    summary: "Хитрый слабый противник, опасен числом, засадами и мобильностью.",
    body: [
      "Гоблины хороши как ранние противники и как живая часть мира: разведчики, мародёры, слуги сильных вождей.",
      "Для игрока это удобный пример существа, о котором полезно помнить: быстрый, трусливый, но неприятный при численном преимуществе.",
    ],
    hooks: ["Тактика: засады и отход", "Связь: банды, лагеря, пещеры"],
  },
  {
    id: "god-mystra",
    category: "gods",
    title: "Мистра",
    subtitle: "Богиня магии",
    tags: ["бог", "магия", "Забытые Королевства"],
    summary: "Одна из ключевых фигур мира, если кампания касается волшебства, арканума и магических катастроф.",
    body: [
      "Полезна как лорная точка входа в темы арканной магии, плетения и отношения мира к колдунам и волшебникам.",
      "Даже если потом база будет тянуться с бэка, модуль уже должен уметь хранить краткое описание, развёрнутый текст и связанные сущности.",
    ],
    hooks: ["Связанные темы: плетение", "Полезно для магов и сюжетов о магии"],
  },
  {
    id: "lore-spellplague",
    category: "lore",
    title: "Магическая Чума",
    subtitle: "Крупное катастрофическое событие мира",
    tags: ["событие", "катастрофа", "история мира"],
    summary: "Пример лорной записи о важном событии с влиянием на магию, историю и географию.",
    body: [
      "Такие статьи нужны не только ради текста, но и чтобы игрок мог быстро понять контекст мира без копания в внешних источниках.",
      "В будущем сюда логично подтянуть связанные места, богов, заклинания и последствия для кампании.",
    ],
    hooks: ["Связать с богами", "Связать с магией и локациями"],
  },
  {
    id: "spell-fireball",
    category: "spells",
    title: "Огненный шар",
    subtitle: "Классическая арканная взрывная магия",
    tags: ["заклинание", "3 круг", "урон огнём"],
    summary: "Образец карточки заклинания для будущей связки LSS, предметов и энциклопедии.",
    body: [
      "Пока это справочная запись, но потом такие записи можно подтягивать из БД по ID и показывать в чарнике, предметах и торговле.",
      "Важно, чтобы модуль уже сейчас умел разделять краткое описание и полную справку.",
    ],
    hooks: ["Школа: воплощение", "Тип урона: огонь"],
  },
  {
    id: "item-bag-of-holding",
    category: "items",
    title: "Сумка хранения",
    subtitle: "Знаковый магический предмет",
    tags: ["предмет", "утилита", "магия"],
    summary: "Пример записи предмета для будущей общей базы знаний по шмоту и магическим вещам.",
    body: [
      "Такие записи потом логично связать с инвентарём, торговцами и чарником, чтобы предмет можно было открыть и как объект, и как справочную статью.",
    ],
    hooks: ["Связать с торговлей", "Связать с инвентарём"],
  },
  {
    id: "class-wizard",
    category: "classes",
    title: "Волшебник",
    subtitle: "Арканный подготовленный заклинатель",
    tags: ["класс", "интеллект", "магия"],
    summary: "Шаблон записи класса: краткая роль, основная характеристика и сильные стороны.",
    body: [
      "Нужен не только для справки, но и как основа для будущего конструктора чарника: выбор класса, архетипов и рекомендаций.",
    ],
    hooks: ["Осн. характеристика: интеллект", "Связать с подклассами и спеллами"],
  },
  {
    id: "faction-harpers",
    category: "factions",
    title: "Арфисты",
    subtitle: "Тайная сеть агентов и идеалистов",
    tags: ["фракция", "организация", "сюжет"],
    summary: "Пример записи фракции, чтобы модуль не ограничивался только монстрами и предметами.",
    body: [
      "Фракции важны для квестов, лора, контактов и политических линий кампании.",
    ],
    hooks: ["Связать с NPC", "Связать с событиями и городами"],
  },
];

function ensureCodexStateDefaults() {
  CODEX_STATE.query ??= "";
  CODEX_STATE.category ??= "all";

  if (!CODEX_STATE.selectedId || !CODEX_ENTRIES.some((entry) => entry.id === CODEX_STATE.selectedId)) {
    CODEX_STATE.selectedId = CODEX_ENTRIES[0]?.id || "";
  }
}

function getFilteredCodexEntries() {
  ensureCodexStateDefaults();

  const query = CODEX_STATE.query.trim().toLowerCase();
  const category = CODEX_STATE.category;

  return CODEX_ENTRIES.filter((entry) => {
    if (category !== "all" && entry.category !== category) return false;
    if (!query) return true;

    const haystack = [
      entry.title,
      entry.subtitle,
      entry.summary,
      ...(entry.tags || []),
      ...(entry.body || []),
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

function getSelectedCodexEntry(entries) {
  if (!Array.isArray(entries) || !entries.length) return null;
  return entries.find((entry) => entry.id === CODEX_STATE.selectedId) || entries[0];
}

function renderCodex() {
  ensureCodexStateDefaults();

  const container = getEl("cabinet-codex");
  if (!container) return;

  const entries = getFilteredCodexEntries();
  const selected = getSelectedCodexEntry(entries);
  if (selected) CODEX_STATE.selectedId = selected.id;

  const categoryButtons = Object.entries(CODEX_CATEGORY_LABELS)
    .map(([key, label]) => {
      const active = CODEX_STATE.category === key ? "active" : "";
      return `
        <button
          class="btn ${active}"
          type="button"
          data-codex-category="${escapeHtml(key)}"
        >
          ${escapeHtml(label)}
        </button>
      `;
    })
    .join("");

  const listHtml = entries.length
    ? entries
        .map((entry) => {
          const active = selected?.id === entry.id ? "active" : "";
          const tagHtml = (entry.tags || [])
            .slice(0, 3)
            .map((tag) => `<span class="quality-badge">${escapeHtml(tag)}</span>`)
            .join("");

          return `
            <button
              type="button"
              class="btn ${active}"
              data-codex-entry="${escapeHtml(entry.id)}"
              style="width:100%; justify-content:flex-start; text-align:left; padding:10px 12px; border-radius:12px;"
            >
              <div style="display:flex; flex-direction:column; gap:6px; width:100%;">
                <div style="font-weight:800;">${escapeHtml(entry.title)}</div>
                <div class="muted">${escapeHtml(entry.subtitle || "")}</div>
                <div class="trader-meta">${tagHtml}</div>
              </div>
            </button>
          `;
        })
        .join("")
    : `
      <div class="cabinet-block">
        <p>Ничего не найдено. Попробуй другой запрос или категорию.</p>
      </div>
    `;

  const detailHtml = selected
    ? `
      <div class="cabinet-block">
        <div class="flex-between" style="align-items:flex-start; gap:12px; flex-wrap:wrap;">
          <div>
            <h3 style="margin:0 0 6px 0;">${escapeHtml(selected.title)}</h3>
            <div class="muted">${escapeHtml(selected.subtitle || "")}</div>
          </div>
          <div class="trader-meta">
            <span class="meta-item">Категория: ${escapeHtml(CODEX_CATEGORY_LABELS[selected.category] || selected.category)}</span>
          </div>
        </div>

        <div class="lss-rich-block" style="margin-top:12px;">
          <p>${escapeHtml(selected.summary || "")}</p>
        </div>

        ${(selected.body || [])
          .map((paragraph) => `<div class="lss-rich-block" style="margin-top:10px;"><p>${escapeHtml(paragraph)}</p></div>`)
          .join("")}

        ${(selected.hooks || []).length
          ? `
            <div class="cabinet-block" style="margin-top:12px;">
              <h4 style="margin:0 0 10px 0;">Связанные направления</h4>
              <div class="trader-meta">
                ${selected.hooks
                  .map((hook) => `<span class="meta-item">${escapeHtml(hook)}</span>`)
                  .join("")}
              </div>
            </div>
          `
          : ""}
      </div>
    `
    : `
      <div class="cabinet-block">
        <p>Выбери запись слева, чтобы открыть подробности.</p>
      </div>
    `;

  container.innerHTML = `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="flex-between" style="align-items:flex-start; gap:12px; flex-wrap:wrap;">
        <div>
          <h3 style="margin:0 0 6px 0;">📚 Энциклопедия мира</h3>
          <div class="muted">
            Каркас общей базы знаний по D&D: монстры, боги, события, предметы, заклинания, классы и фракции.
          </div>
        </div>
        <div class="trader-meta">
          <span class="meta-item">Записей: ${entries.length}</span>
          <span class="meta-item">Категория: ${escapeHtml(CODEX_CATEGORY_LABELS[CODEX_STATE.category] || "Всё")}</span>
        </div>
      </div>
    </div>

    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="collection-toolbar compact-collection-toolbar" style="gap:10px;">
        <div class="filter-group" style="min-width:260px; flex:1 1 260px;">
          <label>Поиск по базе знаний</label>
          <input id="codexSearchInput" type="text" placeholder="Монстр, бог, предмет, заклинание..." value="${escapeHtml(CODEX_STATE.query)}">
        </div>
        <div class="cart-buttons" style="align-items:flex-end; gap:8px; flex-wrap:wrap;">
          ${categoryButtons}
        </div>
      </div>
    </div>

    <div class="profile-grid" style="align-items:start; grid-template-columns:minmax(280px, 0.95fr) minmax(0, 1.55fr);">
      <div class="cabinet-block" style="display:flex; flex-direction:column; gap:8px; min-height:100%;">
        ${listHtml}
      </div>
      <div>${detailHtml}</div>
    </div>
  `;

  bindCodexActions();
}

function bindCodexActions() {
  const searchInput = getEl("codexSearchInput");
  if (searchInput && searchInput.dataset.boundCodexSearch !== "1") {
    searchInput.dataset.boundCodexSearch = "1";
    searchInput.addEventListener("input", () => {
      CODEX_STATE.query = searchInput.value || "";
      renderCodex();
    });
  }

  document.querySelectorAll("[data-codex-category]").forEach((btn) => {
    if (btn.dataset.boundCodexCategory === "1") return;
    btn.dataset.boundCodexCategory = "1";
    btn.addEventListener("click", () => {
      CODEX_STATE.category = btn.dataset.codexCategory || "all";
      const entries = getFilteredCodexEntries();
      CODEX_STATE.selectedId = entries[0]?.id || "";
      renderCodex();
    });
  });

  document.querySelectorAll("[data-codex-entry]").forEach((btn) => {
    if (btn.dataset.boundCodexEntry === "1") return;
    btn.dataset.boundCodexEntry = "1";
    btn.addEventListener("click", () => {
      CODEX_STATE.selectedId = btn.dataset.codexEntry || "";
      renderCodex();
    });
  });
}

// ------------------------------------------------------------
// 🎒 INVENTORY
// ------------------------------------------------------------
const EQUIPMENT_SLOT_CONFIG = [
  { key: "main_hand", label: "🗡 Основная рука", aliases: ["main_hand", "weapon", "main hand"] },
  { key: "off_hand", label: "🛡 Вторая рука", aliases: ["off_hand", "off hand", "shield"] },
  { key: "ranged", label: "🏹 Дальний бой", aliases: ["ranged", "bow", "crossbow"] },
  { key: "head", label: "⛑ Голова", aliases: ["head", "helmet", "helm", "hat"] },
  { key: "cloak", label: "🧥 Плащ", aliases: ["cloak", "cape"] },
  { key: "chest", label: "🛡 Броня", aliases: ["chest", "armor", "body", "torso"] },
  { key: "gloves", label: "🧤 Перчатки", aliases: ["gloves", "hands", "gauntlets"] },
  { key: "boots", label: "🥾 Обувь", aliases: ["boots", "feet", "shoes"] },
  { key: "amulet", label: "📿 Амулет", aliases: ["amulet", "neck"] },
  { key: "ring_1", label: "💍 Кольцо 1", aliases: ["ring", "ring_1", "ring1"] },
  { key: "ring_2", label: "💍 Кольцо 2", aliases: ["ring", "ring_2", "ring2"] },
];

function ensureCabinetInventoryStateDefaults() {
  CABINET_INVENTORY_STATE.customFormOpen ??= false;
  CABINET_INVENTORY_STATE.search ??= "";
  CABINET_INVENTORY_STATE.rarity ??= "";
  CABINET_INVENTORY_STATE.magic ??= "";
  CABINET_INVENTORY_STATE.category ??= "";
  CABINET_INVENTORY_STATE.equippedOnly ??= false;
  CABINET_INVENTORY_STATE.sort ??= "name";
  CABINET_INVENTORY_STATE.viewMode ??= "inventory";
  CABINET_INVENTORY_STATE.equipmentVisible ??= true;
  CABINET_INVENTORY_STATE.slotSelections ??= {};
  CABINET_INVENTORY_STATE.equipment ??= loadEquipmentStateLocal();
}

function getEquipmentStorageKey() {
  return getUserScopedKey("cabinetEquipment");
}

function loadEquipmentStateLocal() {
  try {
    const raw = localStorage.getItem(getEquipmentStorageKey());
    const parsed = tryParseJson(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch (_) {}
  return {};
}

function saveEquipmentStateLocal() {
  try {
    localStorage.setItem(
      getEquipmentStorageKey(),
      JSON.stringify(CABINET_INVENTORY_STATE.equipment || {})
    );
  } catch (_) {}
}

function getEquipmentState() {
  ensureCabinetInventoryStateDefaults();
  return CABINET_INVENTORY_STATE.equipment;
}

function getInventoryItemId(item) {
  return Number(item?.item_id ?? item?.id ?? 0);
}

function findInventoryItemById(itemId) {
  return getInventoryState().find(
    (entry) => Number(entry?.item_id ?? entry?.id) === Number(itemId)
  ) || null;
}

function getSlotConfig(slotKey) {
  return EQUIPMENT_SLOT_CONFIG.find((slot) => slot.key === slotKey) || null;
}

function resolveSlotLabel(slotKey) {
  return getSlotConfig(slotKey)?.label || slotKey;
}

function getInventoryCategories(items) {
  return [...new Set((Array.isArray(items) ? items : [])
    .map((item) => String(item?.category || "").trim())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
}

function inferItemSlotOptions(item) {
  const rawSlot = String(item?.slot || item?.equip_slot || "").trim().toLowerCase();
  if (rawSlot) {
    const matched = EQUIPMENT_SLOT_CONFIG.filter((slot) =>
      slot.aliases.some((alias) => alias === rawSlot)
    );
    if (matched.length) return matched.map((slot) => slot.key);
  }

  const blob = [
    item?.name,
    item?.category,
    item?.type,
    item?.tags,
    item?.properties,
    item?.requirements,
  ]
    .flat()
    .join(" ")
    .toLowerCase();

  if (!blob) return ["main_hand"];

  if (/ring|кольц/.test(blob)) return ["ring_1", "ring_2"];
  if (/amulet|neck|ожерел|амулет|кулон/.test(blob)) return ["amulet"];
  if (/cloak|cape|плащ/.test(blob)) return ["cloak"];
  if (/boot|shoe|feet|сапог|ботин|обув/.test(blob)) return ["boots"];
  if (/glove|gauntlet|перчат|наруч/.test(blob)) return ["gloves"];
  if (/helmet|helm|head|hood|шлем|капюш|маск/.test(blob)) return ["head"];
  if (/armor|chest|robe|body|брон|доспех|кирас|одежд|мант/.test(blob)) return ["chest"];
  if (/shield|щит/.test(blob)) return ["off_hand"];
  if (/bow|crossbow|longbow|shortbow|арбалет|лук/.test(blob)) return ["ranged"];
  if (/staff|wand|dagger|sword|axe|mace|spear|hammer|weapon|посох|кинжал|меч|топор|булав|копь|молот/.test(blob)) {
    return ["main_hand", "off_hand"];
  }

  if (/accessory|jewel|jewelry|аксессуар|украш/.test(blob)) return ["amulet", "ring_1", "ring_2"];

  return ["main_hand"];
}

function getEquippedSlotForItem(itemId) {
  const equipment = getEquipmentState();
  return Object.entries(equipment).find(([, value]) => Number(value?.itemId) === Number(itemId))?.[0] || null;
}

function cleanupEquipmentState() {
  const equipment = getEquipmentState();
  let mutated = false;

  Object.keys(equipment).forEach((slotKey) => {
    const itemId = Number(equipment?.[slotKey]?.itemId);
    const item = findInventoryItemById(itemId);
    if (!item) {
      delete equipment[slotKey];
      mutated = true;
    }
  });

  if (mutated) saveEquipmentStateLocal();
}

function unequipItemFromAllSlots(itemId) {
  const equipment = getEquipmentState();
  let changed = false;

  Object.keys(equipment).forEach((slotKey) => {
    if (Number(equipment?.[slotKey]?.itemId) === Number(itemId)) {
      delete equipment[slotKey];
      changed = true;
    }
  });

  if (changed) saveEquipmentStateLocal();
  return changed;
}

function equipInventoryItem(itemId, slotKey) {
  const item = findInventoryItemById(itemId);
  if (!item) {
    showToast("Предмет не найден для экипировки");
    return false;
  }

  const allowed = inferItemSlotOptions(item);
  if (!allowed.includes(slotKey)) {
    showToast("Этот предмет нельзя надеть в выбранный слот");
    return false;
  }

  const equipment = getEquipmentState();
  unequipItemFromAllSlots(itemId);

  equipment[slotKey] = {
    itemId: Number(itemId),
    equippedAt: new Date().toISOString(),
  };

  saveEquipmentStateLocal();
  emitCabinetHistory({
    scope: "inventory",
    type: "equip_item",
    action: "equip_item",
    title: `Экипирован предмет: ${item?.name || "предмет"}`,
    message: `${item?.name || "Предмет"} надет в слот ${resolveSlotLabel(slotKey)}`,
    item_name: item?.name,
    slot: slotKey,
  });
  showToast(`Надето: ${item?.name || "предмет"} • ${resolveSlotLabel(slotKey)}`);
  return true;
}

function unequipSlot(slotKey) {
  const equipment = getEquipmentState();
  const itemId = Number(equipment?.[slotKey]?.itemId);
  const item = findInventoryItemById(itemId);
  if (!equipment?.[slotKey]) return false;

  delete equipment[slotKey];
  saveEquipmentStateLocal();
  emitCabinetHistory({
    scope: "inventory",
    type: "unequip_item",
    action: "unequip_item",
    title: `Снят предмет: ${item?.name || "предмет"}`,
    message: `${item?.name || "Предмет"} снят из слота ${resolveSlotLabel(slotKey)}`,
    item_name: item?.name,
    slot: slotKey,
  });
  showToast(`Снято: ${item?.name || "предмет"}`);
  return true;
}

function collectItemPassiveTexts(item) {
  const pieces = [];
  const pushValue = (value, label = "") => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((part) => pushValue(part, label));
      return;
    }
    if (typeof value === "object") {
      Object.values(value).forEach((part) => pushValue(part, label));
      return;
    }
    const text = String(value).trim();
    if (!text) return;
    pieces.push(label ? `${label}: ${text}` : text);
  };

  pushValue(item?.effect, "Эффект");
  pushValue(item?.abilities, "Способности");
  pushValue(item?.context_effects, "Контекст");
  pushValue(item?.condition_effects, "Условия");
  pushValue(item?.passive_effects, "Пассивно");
  pushValue(item?.properties, "Свойства");
  pushValue(item?.description, "Описание");

  return [...new Set(pieces)].filter(Boolean).slice(0, 4);
}

function renderEquipmentPanel(items) {
  ensureCabinetInventoryStateDefaults();
  cleanupEquipmentState();

  const equipment = getEquipmentState();
  const effects = [];

  const slotsMarkup = EQUIPMENT_SLOT_CONFIG.map((slot) => {
    const equipped = equipment?.[slot.key];
    const item = equipped ? findInventoryItemById(equipped.itemId) : null;
    const itemId = getInventoryItemId(item);
    const rareClass = item ? rarityClass(item?.rarity) : "";
    const passiveLines = item ? collectItemPassiveTexts(item) : [];

    if (item) {
      effects.push({
        slot: slot.label,
        itemName: item?.name || "Предмет",
        lines: passiveLines,
        attunement: Boolean(item?.attunement),
      });
    }

    return `
      <div class="cabinet-block" style="padding:12px; min-height:148px; display:flex; flex-direction:column; gap:8px;">
        <div class="flex-between" style="align-items:flex-start; gap:8px;">
          <strong>${escapeHtml(slot.label)}</strong>
          ${item ? `<span class="meta-item ${escapeHtml(rareClass)}">${escapeHtml(safeText(item?.rarity, "common"))}</span>` : `<span class="meta-item">пусто</span>`}
        </div>

        ${item ? `
          <div>
            <div class="${escapeHtml(rareClass)}" style="font-weight:800; line-height:1.25;">${escapeHtml(item?.name || "Предмет")}</div>
            <div class="inv-item-details" style="margin-top:6px;">
              <span>Цена: ${escapeHtml(formatPriceLabel(item))}</span>
              <span>Категория: ${escapeHtml(safeText(item?.category, "—"))}</span>
            </div>
          </div>

          ${passiveLines.length ? `
            <div class="muted" style="font-size:0.82rem; line-height:1.35;">${escapeHtml(passiveLines.join(" • "))}</div>
          ` : `<div class="muted" style="font-size:0.82rem;">Эффекты не заданы.</div>`}

          <div class="cart-buttons" style="margin-top:auto;">
            <button class="btn" type="button" data-cabinet-open-desc="${escapeHtml(itemId)}">📖 Описание</button>
            <button class="btn btn-danger" type="button" data-cabinet-unequip-slot="${escapeHtml(slot.key)}">Снять</button>
          </div>
        ` : `
          <div class="muted" style="margin-top:10px;">Ничего не надето.</div>
          <div class="muted" style="font-size:0.82rem; margin-top:auto;">Совместимые предметы из инвентаря можно надеть прямо из списка ниже.</div>
        `}
      </div>
    `;
  }).join("");

  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="flex-between" style="align-items:flex-start; gap:12px; flex-wrap:wrap;">
        <div>
          <h3 style="margin:0 0 4px 0;">🧷 Экипировка</h3>
          <div class="muted">BG3-подобные слоты поверх обычного инвентаря. Пока local-first, но уже готово под дальнейший бэк.</div>
        </div>

        <div class="cart-buttons">
          <button class="btn" type="button" id="cabinetToggleEquipmentBtn">${CABINET_INVENTORY_STATE.equipmentVisible ? "Скрыть слоты" : "Показать слоты"}</button>
        </div>
      </div>
    </div>

    ${CABINET_INVENTORY_STATE.equipmentVisible ? `
      <div class="profile-grid" style="margin-bottom:12px; grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.9fr); align-items:start; gap:12px;">
        <div>
          <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px;">
            ${slotsMarkup}
          </div>
        </div>

        <div class="cabinet-block" style="padding:12px;">
          <h3 style="margin:0 0 10px 0;">✨ Что даёт надетое</h3>

          <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:8px; margin-bottom:10px;">
            <div class="stat-box" style="min-height:auto; padding:10px;">
              <div class="muted">Надето</div>
              <div style="font-size:18px; font-weight:800;">${effects.length}</div>
            </div>
            <div class="stat-box" style="min-height:auto; padding:10px;">
              <div class="muted">С настройкой</div>
              <div style="font-size:18px; font-weight:800;">${effects.filter((entry) => entry?.attunement).length}</div>
            </div>
            <div class="stat-box" style="min-height:auto; padding:10px;">
              <div class="muted">Эффектов</div>
              <div style="font-size:18px; font-weight:800;">${effects.reduce((sum, entry) => sum + safeNumber(entry?.lines?.length, 0), 0)}</div>
            </div>
          </div>

          ${effects.length ? effects.map((entry) => `
            <div class="lss-rich-block" style="margin-bottom:10px;">
              <h4 style="margin-bottom:6px;">${escapeHtml(entry.slot)} • ${escapeHtml(entry.itemName)}</h4>
              <div class="muted" style="line-height:1.4;">${escapeHtml((entry.lines || []).join(" • ") || "Эффекты не заданы")}</div>
            </div>
          `).join("") : `<div class="muted">Слоты пока пусты. Надень предметы из инвентаря, чтобы увидеть эффекты и пассивки.</div>`}
        </div>
      </div>
    ` : ""}
  `;
}

function getCabinetFilteredInventory(items) {
  ensureCabinetInventoryStateDefaults();

  const search = String(CABINET_INVENTORY_STATE.search || "").trim().toLowerCase();
  const rarity = String(CABINET_INVENTORY_STATE.rarity || "").trim().toLowerCase();
  const magic = String(CABINET_INVENTORY_STATE.magic || "").trim().toLowerCase();
  const category = String(CABINET_INVENTORY_STATE.category || "").trim().toLowerCase();
  const equippedOnly = Boolean(CABINET_INVENTORY_STATE.equippedOnly);
  const sort = String(CABINET_INVENTORY_STATE.sort || "name");

  let result = Array.isArray(items) ? [...items] : [];

  if (search) {
    result = result.filter((item) => {
      const haystack = [
        item?.name,
        item?.category,
        item?.rarity,
        item?.description,
        item?.properties,
        item?.requirements,
      ].join(" ").toLowerCase();
      return haystack.includes(search);
    });
  }

  if (rarity) {
    result = result.filter((item) => normalizeRarityValue(item?.rarity) === rarity);
  }

  if (magic === "magic") {
    result = result.filter((item) => Boolean(item?.is_magical));
  }
  if (magic === "mundane") {
    result = result.filter((item) => !item?.is_magical);
  }

  if (category) {
    result = result.filter((item) => String(item?.category || "").trim().toLowerCase() === category);
  }

  if (equippedOnly) {
    result = result.filter((item) => Boolean(getEquippedSlotForItem(getInventoryItemId(item))));
  }

  if (sort === "price_asc") {
    result.sort((a, b) => moneyPartsToCp(a?.price_gold, a?.price_silver, a?.price_copper) - moneyPartsToCp(b?.price_gold, b?.price_silver, b?.price_copper));
  } else if (sort === "price_desc") {
    result.sort((a, b) => moneyPartsToCp(b?.price_gold, b?.price_silver, b?.price_copper) - moneyPartsToCp(a?.price_gold, a?.price_silver, a?.price_copper));
  } else if (sort === "rarity") {
    const order = { common: 1, uncommon: 2, rare: 3, 'very rare': 4, legendary: 5, artifact: 6 };
    result.sort((a, b) => (order[normalizeRarityValue(a?.rarity)] || 0) - (order[normalizeRarityValue(b?.rarity)] || 0));
  } else {
    result.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), "ru"));
  }

  return result;
}

function renderInventorySummary(items) {
  const equippedCount = (Array.isArray(items) ? items : []).filter((item) => Boolean(getEquippedSlotForItem(getInventoryItemId(item)))).length;
  const magicalCount = (Array.isArray(items) ? items : []).filter((item) => Boolean(item?.is_magical)).length;
  const customCount = (Array.isArray(items) ? items : []).filter((item) => Boolean(item?.is_custom)).length;

  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="trader-meta">
        <span class="meta-item">🎒 Предметов: ${getInventoryCount(items)}</span>
        <span class="meta-item">🧷 Надето: ${equippedCount}</span>
        <span class="meta-item">✨ Магических: ${magicalCount}</span>
        <span class="meta-item">🛠 Custom: ${customCount}</span>
      </div>
    </div>
  `;
}

function renderInventoryToolbar() {
  ensureCabinetInventoryStateDefaults();

  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="flex-between" style="align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:10px;">
        <div>
          <h3 style="margin:0 0 4px 0;">Инвентарь игрока</h3>
          <div class="muted">Теперь это не заглушка: те же действия, что и в основном модуле, плюс кастомные предметы и экипировка по слотам.</div>
        </div>

        <div class="cart-buttons">
          <button class="btn" type="button" id="cabinetRefreshInventoryBtn">Обновить</button>
          <button class="btn btn-primary" type="button" id="cabinetAddCustomItemBtn">
            ${CABINET_INVENTORY_STATE.customFormOpen ? "Скрыть форму" : "＋ Кастомный предмет"}
          </button>
        </div>
      </div>

      <div class="collection-toolbar compact-collection-toolbar">
        <div class="filter-group">
          <label>🔍 Поиск</label>
          <input id="cabinetInventorySearch" type="text" value="${escapeHtml(CABINET_INVENTORY_STATE.search)}" placeholder="Название, свойства, описание" />
        </div>

        <div class="filter-group">
          <label>🎖 Редкость</label>
          <select id="cabinetInventoryRarity">
            <option value="">Любая</option>
            <option value="common" ${CABINET_INVENTORY_STATE.rarity === "common" ? "selected" : ""}>common</option>
            <option value="uncommon" ${CABINET_INVENTORY_STATE.rarity === "uncommon" ? "selected" : ""}>uncommon</option>
            <option value="rare" ${CABINET_INVENTORY_STATE.rarity === "rare" ? "selected" : ""}>rare</option>
            <option value="very rare" ${CABINET_INVENTORY_STATE.rarity === "very rare" ? "selected" : ""}>very rare</option>
            <option value="legendary" ${CABINET_INVENTORY_STATE.rarity === "legendary" ? "selected" : ""}>legendary</option>
            <option value="artifact" ${CABINET_INVENTORY_STATE.rarity === "artifact" ? "selected" : ""}>artifact</option>
          </select>
        </div>

        <div class="filter-group">
          <label>✨ Магия</label>
          <select id="cabinetInventoryMagic">
            <option value="" ${CABINET_INVENTORY_STATE.magic === "" ? "selected" : ""}>Любая</option>
            <option value="magic" ${CABINET_INVENTORY_STATE.magic === "magic" ? "selected" : ""}>Только магические</option>
            <option value="mundane" ${CABINET_INVENTORY_STATE.magic === "mundane" ? "selected" : ""}>Только обычные</option>
          </select>
        </div>

        <div class="filter-group">
          <label>📦 Категория</label>
          <select id="cabinetInventoryCategory">
            <option value="">Любая</option>
            ${getInventoryCategories(getInventoryState()).map((category) => `<option value="${escapeHtml(category)}" ${String(CABINET_INVENTORY_STATE.category || "") === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
          </select>
        </div>

        <label class="inline-checkbox compact-inline-checkbox" style="margin-top:20px;">
          <input id="cabinetInventoryEquippedOnly" type="checkbox" ${CABINET_INVENTORY_STATE.equippedOnly ? "checked" : ""} />
          Только надетое
        </label>

        <div class="filter-group">
          <label>↕ Сортировка</label>
          <select id="cabinetInventorySort">
            <option value="name" ${CABINET_INVENTORY_STATE.sort === "name" ? "selected" : ""}>Название</option>
            <option value="price_asc" ${CABINET_INVENTORY_STATE.sort === "price_asc" ? "selected" : ""}>Дешёвые</option>
            <option value="price_desc" ${CABINET_INVENTORY_STATE.sort === "price_desc" ? "selected" : ""}>Дорогие</option>
            <option value="rarity" ${CABINET_INVENTORY_STATE.sort === "rarity" ? "selected" : ""}>Редкость</option>
          </select>
        </div>

        <div class="filter-group">
          <label>🧩 Вид</label>
          <select id="cabinetInventoryViewMode">
            <option value="inventory" ${CABINET_INVENTORY_STATE.viewMode === "inventory" ? "selected" : ""}>Список</option>
            <option value="table" ${CABINET_INVENTORY_STATE.viewMode === "table" ? "selected" : ""}>Таблица</option>
            <option value="grid" ${CABINET_INVENTORY_STATE.viewMode === "grid" ? "selected" : ""}>Карточки</option>
          </select>
        </div>
      </div>
    </div>
  `;
}

function renderCustomItemForm() {
  if (!CABINET_INVENTORY_STATE.customFormOpen) return "";

  return `
    <div class="cabinet-block" id="cabinetCustomItemFormBlock" style="margin-bottom:12px;">
      <h3>Кастомный предмет</h3>

      <div class="collection-toolbar compact-collection-toolbar">
        <div class="filter-group">
          <label>Название *</label>
          <input id="customItemName" type="text" placeholder="Например: Флакон чёрной крови" />
        </div>

        <div class="filter-group">
          <label>Количество</label>
          <input id="customItemQuantity" type="number" min="1" step="1" value="1" />
        </div>

        <div class="filter-group">
          <label>Категория</label>
          <input id="customItemCategory" type="text" value="прочее" />
        </div>

        <div class="filter-group">
          <label>Редкость</label>
          <select id="customItemRarity">
            <option value="common">common</option>
            <option value="uncommon">uncommon</option>
            <option value="rare">rare</option>
            <option value="very rare">very rare</option>
            <option value="legendary">legendary</option>
            <option value="artifact">artifact</option>
          </select>
        </div>

        <div class="filter-group">
          <label>Качество</label>
          <select id="customItemQuality">
            <option value="стандартное">стандартное</option>
            <option value="хорошее">хорошее</option>
            <option value="идеальное">идеальное</option>
          </select>
        </div>

        <div class="filter-group">
          <label>Слот</label>
          <select id="customItemEquipSlot">
            <option value="">Без слота</option>
            ${EQUIPMENT_SLOT_CONFIG.map((slot) => `<option value="${escapeHtml(slot.key)}">${escapeHtml(slot.label)}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="collection-toolbar compact-collection-toolbar">
        <div class="filter-group">
          <label>Цена (золото)</label>
          <input id="customItemPriceGold" type="number" min="0" step="1" value="0" />
        </div>

        <div class="filter-group">
          <label>Цена (серебро)</label>
          <input id="customItemPriceSilver" type="number" min="0" step="1" value="0" />
        </div>

        <div class="filter-group">
          <label>Цена (медь)</label>
          <input id="customItemPriceCopper" type="number" min="0" step="1" value="0" />
        </div>

        <div class="filter-group">
          <label>Вес</label>
          <input id="customItemWeight" type="number" min="0" step="0.1" value="0" />
        </div>

        <label class="inline-checkbox" style="margin-top:20px;">
          <input id="customItemMagical" type="checkbox" />
          <span>Магический</span>
        </label>

        <label class="inline-checkbox" style="margin-top:20px;">
          <input id="customItemAttunement" type="checkbox" />
          <span>Требует настройку</span>
        </label>
      </div>

      <div class="filter-group" style="margin-top:12px;">
        <label>Описание</label>
        <textarea id="customItemDescription" rows="4" placeholder="Краткое описание предмета"></textarea>
      </div>

      <div class="filter-group" style="margin-top:12px;">
        <label>Свойства / пассивки / механика</label>
        <textarea id="customItemProperties" rows="3" placeholder="Например: +1 к инициативе • иммунитет к яду • бонус к скрытности"></textarea>
      </div>

      <div class="filter-group" style="margin-top:12px;">
        <label>Требования</label>
        <textarea id="customItemRequirements" rows="2" placeholder="Например: только волшебник, уровень 5+"></textarea>
      </div>

      <div class="modal-actions" style="margin-top:12px; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-success" type="button" id="cabinetSaveCustomItemBtn">Добавить предмет</button>
        <button class="btn" type="button" id="cabinetResetCustomItemBtn">Сбросить</button>
      </div>

      <div class="muted" style="margin-top:10px;">
        Кастомные предметы сразу совместимы с инвентарём, описанием, продажей и новой системой экипировки.
      </div>
    </div>
  `;
}

function buildCustomItemFromForm() {
  const inventory = getInventoryState();
  const nextId = getNextCustomItemId(inventory);

  const name = safeText(getEl("customItemName")?.value, "").trim();
  const quantity = Math.max(1, safeNumber(getEl("customItemQuantity")?.value, 1));
  const category = safeText(getEl("customItemCategory")?.value, "прочее").trim() || "прочее";
  const rarity = normalizeRarityValue(getEl("customItemRarity")?.value || "common");
  const quality = normalizeQuality(getEl("customItemQuality")?.value || "стандартное");
  const weight = Math.max(0, safeNumber(getEl("customItemWeight")?.value, 0));
  const slot = safeText(getEl("customItemEquipSlot")?.value, "").trim();

  const priceGold = Math.max(0, safeNumber(getEl("customItemPriceGold")?.value, 0));
  const priceSilver = Math.max(0, safeNumber(getEl("customItemPriceSilver")?.value, 0));
  const priceCopper = Math.max(0, safeNumber(getEl("customItemPriceCopper")?.value, 0));

  const description = safeText(getEl("customItemDescription")?.value, "").trim();
  const properties = safeText(getEl("customItemProperties")?.value, "").trim();
  const requirements = safeText(getEl("customItemRequirements")?.value, "").trim();

  const isMagical = Boolean(getEl("customItemMagical")?.checked);
  const attunement = Boolean(getEl("customItemAttunement")?.checked);

  if (!name) throw new Error("Укажи название кастомного предмета");

  const baseCp = moneyPartsToCp(priceGold, priceSilver, priceCopper);
  const sellCp = baseCp > 0 ? Math.max(1, Math.floor(baseCp * 0.5)) : 0;
  const sellParts = cpToMoneyParts(sellCp);

  return {
    id: nextId,
    item_id: nextId,
    trader_id: null,
    local_id: `custom_${nextId}`,
    source: "cabinet_custom",
    is_custom: true,
    name,
    quantity,
    category,
    rarity,
    quality,
    weight,
    slot: slot || undefined,
    is_magical: isMagical,
    attunement,
    description,
    properties,
    requirements,
    price_gold: priceGold,
    price_silver: priceSilver,
    price_copper: priceCopper,
    base_price_gold: priceGold,
    base_price_silver: priceSilver,
    base_price_copper: priceCopper,
    sell_price_gold: sellParts.gold,
    sell_price_silver: sellParts.silver,
    sell_price_copper: sellParts.copper,
    stock: quantity,
  };
}

function resetCustomItemFormValues() {
  const defaults = {
    customItemName: "",
    customItemQuantity: "1",
    customItemCategory: "прочее",
    customItemRarity: "common",
    customItemQuality: "стандартное",
    customItemWeight: "0",
    customItemPriceGold: "0",
    customItemPriceSilver: "0",
    customItemPriceCopper: "0",
    customItemDescription: "",
    customItemProperties: "",
    customItemRequirements: "",
    customItemEquipSlot: "",
  };

  Object.entries(defaults).forEach(([id, value]) => {
    const el = getEl(id);
    if (el) el.value = value;
  });

  const magical = getEl("customItemMagical");
  if (magical) magical.checked = false;

  const attune = getEl("customItemAttunement");
  if (attune) attune.checked = false;
}

async function addCustomInventoryItem() {
  const inventory = getInventoryState();
  const customItem = buildCustomItemFromForm();

  const sameIndex = inventory.findIndex((entry) => {
    if (!entry?.is_custom) return false;
    return (
      String(entry.name || "").trim().toLowerCase() === customItem.name.toLowerCase() &&
      String(entry.category || "").trim().toLowerCase() === customItem.category.toLowerCase() &&
      String(entry.rarity || "").trim().toLowerCase() === customItem.rarity.toLowerCase() &&
      String(entry.description || "").trim() === customItem.description
    );
  });

  if (sameIndex >= 0) {
    inventory[sameIndex].quantity = Math.max(1, safeNumber(inventory[sameIndex].quantity, 1)) + customItem.quantity;
  } else {
    inventory.push(customItem);
  }

  syncInventoryToUi();
  await tryPersistInventoryToServer();
  renderCabinetInventory();

  emitCabinetHistory({
    scope: "inventory",
    type: "custom_item_add",
    action: "custom_item_add",
    title: `Добавлен кастомный предмет: ${customItem.name}`,
    message: [
      `Кол-во: ${customItem.quantity}`,
      `Категория: ${customItem.category}`,
      `Редкость: ${customItem.rarity}`,
      `Цена: ${formatPriceLabel(customItem)}`,
    ].join(" • "),
    item_name: customItem.name,
    category: customItem.category,
    quantity: customItem.quantity,
    price_label: formatPriceLabel(customItem),
  });

  showToast(`Добавлен кастомный предмет: ${customItem.name}`);
}

async function changeInventoryQuantity(itemId, delta) {
  const inventory = getInventoryState();
  const index = inventory.findIndex((entry) => Number(entry?.item_id ?? entry?.id) === Number(itemId));
  if (index < 0) {
    showToast("Предмет не найден");
    return;
  }

  inventory[index].quantity = Math.max(1, safeNumber(inventory[index].quantity, 1) + safeNumber(delta, 0));
  syncInventoryToUi();
  await tryPersistInventoryToServer();
  renderCabinetInventory();

  emitCabinetHistory({
    scope: "inventory",
    type: "inventory_quantity_update",
    action: "inventory_quantity_update",
    title: `Изменено количество: ${inventory[index].name || "предмет"}`,
    message: `Новое количество: ${inventory[index].quantity}`,
    item_name: inventory[index].name,
    quantity: inventory[index].quantity,
  });
}

async function removeInventoryEntryFromCabinet(itemId) {
  const inventory = getInventoryState();
  const index = inventory.findIndex((entry) => Number(entry?.item_id ?? entry?.id) === Number(itemId));
  if (index < 0) {
    showToast("Предмет не найден");
    return;
  }

  const [removed] = inventory.splice(index, 1);
  unequipItemFromAllSlots(itemId);

  syncInventoryToUi();
  await tryPersistInventoryToServer();
  renderCabinetInventory();

  emitCabinetHistory({
    scope: "inventory",
    type: "inventory_remove",
    action: "inventory_remove",
    title: `Удалён предмет: ${removed?.name || "предмет"}`,
    message: `Из инвентаря удалён ${removed?.name || "предмет"}`,
    item_name: removed?.name,
    quantity: removed?.quantity,
  });

  showToast(`Удалено из инвентаря: ${removed?.name || "предмет"}`);
}

function openCabinetItemDescription(item) {
  if (!item) {
    showToast("Описание предмета не найдено");
    return;
  }

  const modal = getEl("itemDescriptionModal");
  const root = getEl("itemDescriptionContent");
  if (!modal || !root) return;

  const rareClass = rarityClass(item?.rarity);
  const effects = collectItemPassiveTexts(item);
  const slotOptions = inferItemSlotOptions(item).map(resolveSlotLabel).join(", ");

  root.innerHTML = `
    <div class="trader-detail-section">
      <h2 class="${escapeHtml(rareClass)}" style="margin-bottom:8px;">${escapeHtml(item?.name || "Без названия")}</h2>

      <div class="inv-item-details" style="margin-bottom:10px;">
        <span class="${escapeHtml(rareClass)}">Редкость: ${escapeHtml(safeText(item?.rarity, "—"))}</span>
        <span>Категория: ${escapeHtml(safeText(item?.category, "—"))}</span>
        <span>Цена: ${escapeHtml(formatPriceLabel(item))}</span>
        <span>Количество: ${escapeHtml(safeText(item?.quantity, "1"))}</span>
        <span>Слоты: ${escapeHtml(slotOptions || "—")}</span>
        ${item?.attunement ? `<span>🔗 Требует настройку</span>` : ""}
        ${item?.is_magical ? `<span>✨ Магический</span>` : ""}
        ${item?.is_custom ? `<span>custom</span>` : ""}
      </div>

      ${item?.description ? `<div class="lss-rich-block" style="margin-bottom:10px;"><h4>Описание</h4><p>${escapeHtml(item.description)}</p></div>` : ""}
      ${item?.properties ? `<div class="lss-rich-block" style="margin-bottom:10px;"><h4>Свойства</h4><p>${escapeHtml(item.properties)}</p></div>` : ""}
      ${item?.requirements ? `<div class="lss-rich-block" style="margin-bottom:10px;"><h4>Требования</h4><p>${escapeHtml(item.requirements)}</p></div>` : ""}
      ${effects.length ? `<div class="lss-rich-block"><h4>Пассивки / эффекты</h4><p>${escapeHtml(effects.join(" • "))}</p></div>` : ""}
    </div>
  `;

  modal.style.display = "block";
}

function renderCabinetInventoryItemActions(item) {
  const itemId = getInventoryItemId(item);
  const equippedSlot = getEquippedSlotForItem(itemId);
  const allowedSlots = inferItemSlotOptions(item);
  const selectedSlot = CABINET_INVENTORY_STATE.slotSelections[itemId] || equippedSlot || allowedSlots[0] || "main_hand";

  return `
    <div class="cart-buttons" style="margin-top:10px; flex-wrap:wrap;">
      <button class="btn" type="button" data-cabinet-open-desc="${escapeHtml(itemId)}">📖 Описание</button>
      <button class="btn btn-success" type="button" data-cabinet-sell-item="${escapeHtml(itemId)}">💰 Продать</button>
      <button class="btn btn-danger" type="button" data-cabinet-item-remove="${escapeHtml(itemId)}">🗑 Удалить</button>
      <button class="btn" type="button" data-cabinet-item-minus="${escapeHtml(itemId)}">−1</button>
      <button class="btn" type="button" data-cabinet-item-plus="${escapeHtml(itemId)}">＋1</button>
    </div>

    <div class="collection-toolbar compact-collection-toolbar" style="margin-top:10px; padding:0; background:none; border:none;">
      <div class="filter-group" style="min-width:220px;">
        <label>Слот экипировки</label>
        <select data-cabinet-slot-select="${escapeHtml(itemId)}">
          ${allowedSlots.map((slotKey) => `<option value="${escapeHtml(slotKey)}" ${selectedSlot === slotKey ? "selected" : ""}>${escapeHtml(resolveSlotLabel(slotKey))}</option>`).join("")}
        </select>
      </div>

      <div class="cart-buttons" style="align-self:flex-end;">
        <button class="btn btn-primary" type="button" data-cabinet-equip-item="${escapeHtml(itemId)}">${equippedSlot ? "Переэкипировать" : "Надеть"}</button>
        ${equippedSlot ? `<button class="btn" type="button" data-cabinet-unequip-item="${escapeHtml(itemId)}">Снять</button>` : ""}
      </div>
    </div>
  `;
}

function renderCabinetInventoryCard(item) {
  const rareClass = rarityClass(item?.rarity);
  const quantity = safeText(item?.quantity, "1");
  const rarity = safeText(item?.rarity, "—");
  const category = safeText(item?.category, "—");
  const price = formatPriceLabel(item);
  const itemId = getInventoryItemId(item);
  const customBadge = item?.is_custom ? `<span class="meta-item">custom</span>` : "";
  const equippedSlot = getEquippedSlotForItem(itemId);
  const passiveShort = collectItemPassiveTexts(item).slice(0, 2).join(" • ");

  return `
    <div class="inventory-item">
      <div class="inventory-item-info">
        <strong class="${escapeHtml(rareClass)}">${escapeHtml(safeText(item?.name, "Без названия"))}</strong>

        <div class="inv-item-details">
          <span>Кол-во: ${escapeHtml(quantity)}</span>
          <span class="${escapeHtml(rareClass)}">Редкость: ${escapeHtml(rarity)}</span>
          <span>Категория: ${escapeHtml(category)}</span>
          <span>Цена: ${escapeHtml(price)}</span>
          ${item?.is_magical ? `<span>✨ магический</span>` : ""}
          ${item?.attunement ? `<span>🔗 настройка</span>` : ""}
          ${customBadge}
          ${equippedSlot ? `<span>🧷 ${escapeHtml(resolveSlotLabel(equippedSlot))}</span>` : ""}
        </div>

        ${item?.description ? `<div class="muted" style="margin-top:6px;">${escapeHtml(item.description)}</div>` : ""}
        ${passiveShort ? `<div class="muted" style="margin-top:6px;">${escapeHtml(passiveShort)}</div>` : ""}

        ${renderCabinetInventoryItemActions(item)}
      </div>
    </div>
  `;
}

function renderCabinetInventoryGrid(items) {
  return `
    <div class="profile-grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px;">
      ${items.map((item) => `<div class="cabinet-block" style="padding:12px;">${renderCabinetInventoryCard(item)}</div>`).join("")}
    </div>
  `;
}

function renderCabinetInventoryTable(items) {
  return `
    <div class="table-wrap">
      <table class="items-table">
        <thead>
          <tr>
            <th>Предмет</th>
            <th>Редкость</th>
            <th>Кол-во</th>
            <th>Цена</th>
            <th>Слот</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => {
            const rareClass = rarityClass(item?.rarity);
            const itemId = getInventoryItemId(item);
            const equippedSlot = getEquippedSlotForItem(itemId);
            return `
              <tr>
                <td>
                  <div class="item-name ${escapeHtml(rareClass)}">${escapeHtml(safeText(item?.name, "Без названия"))}</div>
                  ${item?.description ? `<div class="muted" style="margin-top:4px; font-size:0.8rem;">${escapeHtml(item.description)}</div>` : ""}
                </td>
                <td class="${escapeHtml(rareClass)}">${escapeHtml(safeText(item?.rarity, "—"))}</td>
                <td>${escapeHtml(safeText(item?.quantity, "1"))}</td>
                <td>${escapeHtml(formatPriceLabel(item))}</td>
                <td>${equippedSlot ? escapeHtml(resolveSlotLabel(equippedSlot)) : "—"}</td>
                <td>
                  <div class="item-actions item-actions-stack">
                    <button class="btn js-cabinet-desc" type="button" data-cabinet-open-desc="${escapeHtml(itemId)}">📖</button>
                    <button class="btn" type="button" data-cabinet-item-minus="${escapeHtml(itemId)}">−1</button>
                    <button class="btn" type="button" data-cabinet-item-plus="${escapeHtml(itemId)}">＋1</button>
                    <button class="btn btn-success" type="button" data-cabinet-sell-item="${escapeHtml(itemId)}">💰</button>
                    <button class="btn btn-primary" type="button" data-cabinet-equip-item="${escapeHtml(itemId)}">🧷</button>
                    <button class="btn btn-danger" type="button" data-cabinet-item-remove="${escapeHtml(itemId)}">🗑</button>
                  </div>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderInventoryList(items) {
  const filtered = getCabinetFilteredInventory(items);

  if (!filtered.length) {
    return `
      <div class="cabinet-block">
        <p>Ничего не найдено. Попробуй изменить фильтры или добавить кастомный предмет.</p>
      </div>
    `;
  }

  if (CABINET_INVENTORY_STATE.viewMode === "table") {
    return `<div class="cabinet-block">${renderCabinetInventoryTable(filtered)}</div>`;
  }

  if (CABINET_INVENTORY_STATE.viewMode === "grid") {
    return `<div class="cabinet-block">${renderCabinetInventoryGrid(filtered)}</div>`;
  }

  return `
    <div class="cabinet-block">
      <div class="inventory-list">
        ${filtered.map((item) => renderCabinetInventoryCard(item)).join("")}
      </div>
    </div>
  `;
}

function renderCabinetInventory() {
  const container = getEl("cabinet-inventory");
  if (!container) return;

  ensureCabinetInventoryStateDefaults();
  const inventory = getInventoryState();

  container.innerHTML = `
    ${renderInventoryToolbar()}
    ${renderEquipmentPanel(inventory)}
    ${renderCustomItemForm()}
    ${renderInventoryList(inventory)}
  `;

  bindInventoryActions();
}

function bindCabinetInventoryFilter(id, stateKey, normalizer = (value) => value) {
  const el = getEl(id);
  if (!el || el.dataset.boundCabinetInventoryFilter === "1") return;
  el.dataset.boundCabinetInventoryFilter = "1";
  el.addEventListener("input", () => {
    CABINET_INVENTORY_STATE[stateKey] = normalizer(el.value);
    renderCabinetInventory();
  });
  el.addEventListener("change", () => {
    CABINET_INVENTORY_STATE[stateKey] = normalizer(el.value);
    renderCabinetInventory();
  });
}

function bindInventoryActions() {
  ensureCabinetInventoryStateDefaults();

  const refreshBtn = getEl("cabinetRefreshInventoryBtn");
  if (refreshBtn && refreshBtn.dataset.boundRefreshInventory !== "1") {
    refreshBtn.dataset.boundRefreshInventory = "1";
    refreshBtn.addEventListener("click", () => {
      syncInventoryToUi();
      renderCabinetInventory();
      showToast("Инвентарь в кабинете обновлён");
    });
  }

  const addCustomBtn = getEl("cabinetAddCustomItemBtn");
  if (addCustomBtn && addCustomBtn.dataset.boundAddCustom !== "1") {
    addCustomBtn.dataset.boundAddCustom = "1";
    addCustomBtn.addEventListener("click", () => {
      CABINET_INVENTORY_STATE.customFormOpen = !CABINET_INVENTORY_STATE.customFormOpen;
      renderCabinetInventory();
    });
  }

  const toggleEquipmentBtn = getEl("cabinetToggleEquipmentBtn");
  if (toggleEquipmentBtn && toggleEquipmentBtn.dataset.boundToggleEquipment !== "1") {
    toggleEquipmentBtn.dataset.boundToggleEquipment = "1";
    toggleEquipmentBtn.addEventListener("click", () => {
      CABINET_INVENTORY_STATE.equipmentVisible = !CABINET_INVENTORY_STATE.equipmentVisible;
      renderCabinetInventory();
    });
  }

  bindCabinetInventoryFilter("cabinetInventorySearch", "search", (value) => String(value || ""));
  bindCabinetInventoryFilter("cabinetInventoryRarity", "rarity", (value) => String(value || "").trim().toLowerCase());
  bindCabinetInventoryFilter("cabinetInventoryMagic", "magic", (value) => String(value || "").trim().toLowerCase());
  bindCabinetInventoryFilter("cabinetInventoryCategory", "category", (value) => String(value || "").trim().toLowerCase());
  bindCabinetInventoryFilter("cabinetInventorySort", "sort", (value) => String(value || "name"));
  bindCabinetInventoryFilter("cabinetInventoryViewMode", "viewMode", (value) => String(value || "inventory"));

  const equippedOnly = getEl("cabinetInventoryEquippedOnly");
  if (equippedOnly && equippedOnly.dataset.boundCabinetInventoryEquippedOnly !== "1") {
    equippedOnly.dataset.boundCabinetInventoryEquippedOnly = "1";
    equippedOnly.addEventListener("change", () => {
      CABINET_INVENTORY_STATE.equippedOnly = Boolean(equippedOnly.checked);
      renderCabinetInventory();
    });
  }

  const saveCustomBtn = getEl("cabinetSaveCustomItemBtn");
  if (saveCustomBtn && saveCustomBtn.dataset.boundSaveCustomItem !== "1") {
    saveCustomBtn.dataset.boundSaveCustomItem = "1";
    saveCustomBtn.addEventListener("click", async () => {
      try {
        await addCustomInventoryItem();
      } catch (error) {
        console.error(error);
        showToast(error?.message || "Не удалось добавить кастомный предмет");
      }
    });
  }

  const resetCustomBtn = getEl("cabinetResetCustomItemBtn");
  if (resetCustomBtn && resetCustomBtn.dataset.boundResetCustomItem !== "1") {
    resetCustomBtn.dataset.boundResetCustomItem = "1";
    resetCustomBtn.addEventListener("click", () => {
      resetCustomItemFormValues();
      showToast("Форма кастомного предмета очищена");
    });
  }

  document.querySelectorAll("[data-cabinet-item-plus]").forEach((btn) => {
    if (btn.dataset.boundCabinetItemPlus === "1") return;
    btn.dataset.boundCabinetItemPlus = "1";
    btn.addEventListener("click", async () => {
      await changeInventoryQuantity(Number(btn.dataset.cabinetItemPlus), 1);
    });
  });

  document.querySelectorAll("[data-cabinet-item-minus]").forEach((btn) => {
    if (btn.dataset.boundCabinetItemMinus === "1") return;
    btn.dataset.boundCabinetItemMinus = "1";
    btn.addEventListener("click", async () => {
      await changeInventoryQuantity(Number(btn.dataset.cabinetItemMinus), -1);
    });
  });

  document.querySelectorAll("[data-cabinet-item-remove]").forEach((btn) => {
    if (btn.dataset.boundCabinetItemRemove === "1") return;
    btn.dataset.boundCabinetItemRemove = "1";
    btn.addEventListener("click", async () => {
      const itemId = Number(btn.dataset.cabinetItemRemove);
      if (!confirm("Удалить предмет из инвентаря?")) return;
      await removeInventoryEntryFromCabinet(itemId);
    });
  });

  document.querySelectorAll("[data-cabinet-open-desc]").forEach((btn) => {
    if (btn.dataset.boundCabinetOpenDesc === "1") return;
    btn.dataset.boundCabinetOpenDesc = "1";
    btn.addEventListener("click", () => {
      const item = findInventoryItemById(Number(btn.dataset.cabinetOpenDesc));
      openCabinetItemDescription(item);
    });
  });

  document.querySelectorAll("[data-cabinet-slot-select]").forEach((select) => {
    if (select.dataset.boundCabinetSlotSelect === "1") return;
    select.dataset.boundCabinetSlotSelect = "1";
    select.addEventListener("change", () => {
      CABINET_INVENTORY_STATE.slotSelections[Number(select.dataset.cabinetSlotSelect)] = String(select.value || "main_hand");
    });
  });

  document.querySelectorAll("[data-cabinet-equip-item]").forEach((btn) => {
    if (btn.dataset.boundCabinetEquipItem === "1") return;
    btn.dataset.boundCabinetEquipItem = "1";
    btn.addEventListener("click", async () => {
      const itemId = Number(btn.dataset.cabinetEquipItem);
      const selectedSlot = CABINET_INVENTORY_STATE.slotSelections[itemId] || inferItemSlotOptions(findInventoryItemById(itemId))[0] || "main_hand";
      const ok = equipInventoryItem(itemId, selectedSlot);
      if (!ok) return;
      await tryPersistInventoryToServer();
      renderCabinetInventory();
    });
  });

  document.querySelectorAll("[data-cabinet-unequip-item]").forEach((btn) => {
    if (btn.dataset.boundCabinetUnequipItem === "1") return;
    btn.dataset.boundCabinetUnequipItem = "1";
    btn.addEventListener("click", async () => {
      const itemId = Number(btn.dataset.cabinetUnequipItem);
      const slotKey = getEquippedSlotForItem(itemId);
      if (!slotKey) return;
      unequipSlot(slotKey);
      await tryPersistInventoryToServer();
      renderCabinetInventory();
    });
  });

  document.querySelectorAll("[data-cabinet-unequip-slot]").forEach((btn) => {
    if (btn.dataset.boundCabinetUnequipSlot === "1") return;
    btn.dataset.boundCabinetUnequipSlot = "1";
    btn.addEventListener("click", async () => {
      unequipSlot(String(btn.dataset.cabinetUnequipSlot || ""));
      await tryPersistInventoryToServer();
      renderCabinetInventory();
    });
  });

  document.querySelectorAll("[data-cabinet-sell-item]").forEach((btn) => {
    if (btn.dataset.boundCabinetSellItem === "1") return;
    btn.dataset.boundCabinetSellItem = "1";
    btn.addEventListener("click", async () => {
      const itemId = Number(btn.dataset.cabinetSellItem);
      const item = findInventoryItemById(itemId);
      const itemQuantity = Math.max(1, safeNumber(item?.quantity, 1));
      const ok = confirm(`Продать 1 × ${item?.name || "предмет"}?`);
      if (!ok) return;
      const result = await window.sellItem?.(itemId, 1, { reopenTraderModal: false });
      if (!result?.success) return;
      if (itemQuantity <= 1) {
        unequipItemFromAllSlots(itemId);
      }
      renderCabinetInventory();
    });
  });
}


// ------------------------------------------------------------
// 📁 FILES
// ------------------------------------------------------------
function getFilesStorageKey() {
  return getUserScopedKey("cabinetFiles");
}

function saveFilesLocal(items) {
  try {
    localStorage.setItem(getFilesStorageKey(), JSON.stringify(items));
  } catch (_) {}
}

function loadFilesLocal() {
  try {
    const raw = localStorage.getItem(getFilesStorageKey());
    if (!raw) return null;
    const parsed = tryParseJson(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildFileId() {
  return `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCabinetFile(item, index = 0) {
  if (!item || typeof item !== "object") {
    return {
      id: buildFileId(),
      name: `file_${index + 1}`,
      dataUrl: "",
      type: "",
      size: 0,
      created_at: new Date().toISOString(),
    };
  }

  return {
    id: item.id || buildFileId(),
    name: safeText(item.name, `file_${index + 1}`),
    dataUrl: safeText(item.dataUrl || item.url || item.href || "", ""),
    type: safeText(item.type, ""),
    size: Math.max(0, safeNumber(item.size, 0)),
    created_at: safeText(item.created_at || item.createdAt, new Date().toISOString()),
  };
}

async function loadFiles() {
  let data = await apiGet([
    "/player/profile",
    "/profile/me",
    "/player/files",
    "/files",
  ]);
  let source = "api";

  let items = [];

  if (Array.isArray(data)) {
    items = data;
  } else if (Array.isArray(data?.files)) {
    items = data.files;
  } else if (Array.isArray(data?.cabinet_files)) {
    items = data.cabinet_files;
  } else if (Array.isArray(data?.player_files)) {
    items = data.player_files;
  } else if (Array.isArray(data?.profile?.files)) {
    items = data.profile.files;
  } else if (Array.isArray(data?.profile?.cabinet_files)) {
    items = data.profile.cabinet_files;
  }

  if (!items.length) {
    const local = loadFilesLocal();
    if (Array.isArray(local) && local.length) {
      items = local;
      source = "local";
    }
  }

  FILES_STATE.items = (Array.isArray(items) ? items : []).map(normalizeCabinetFile);
  FILES_STATE.loaded = true;
  FILES_STATE.source = FILES_STATE.items.length ? source : source === "api" ? "api" : "empty";
  FILES_STATE.draggedIndex = null;

  renderFiles();
}

async function saveFiles() {
  FILES_STATE.isSaving = true;
  saveFilesLocal(FILES_STATE.items);

  try {
    await apiWrite(
      ["/player/profile", "/profile/me", "/player/files", "/files"],
      {
        files: FILES_STATE.items,
        cabinet_files: FILES_STATE.items,
        player_files: FILES_STATE.items,
      },
      ["POST", "PUT", "PATCH"]
    );

    FILES_STATE.source = "api";
  } catch (_) {
    FILES_STATE.source = "local";
  }

  FILES_STATE.lastSavedAt = new Date().toISOString();
  FILES_STATE.isSaving = false;
}

async function handleFileUpload(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) {
    showToast("Файлы не выбраны");
    return;
  }

  const prepared = [];

  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file);

    prepared.push(
      normalizeCabinetFile({
        id: buildFileId(),
        name: file.name,
        dataUrl,
        type: file.type,
        size: file.size,
        created_at: new Date().toISOString(),
      })
    );
  }

  FILES_STATE.items = [...FILES_STATE.items, ...prepared];
  await saveFiles();
  renderFiles();

  prepared.forEach((file) => {
    emitCabinetHistory({
      scope: "files",
      type: "file_upload",
      action: "file_upload",
      title: `Загружен файл: ${file.name}`,
      message: `Тип: ${fileTypeLabel(file.type)} • Размер: ${formatBytes(file.size)}`,
      file_name: file.name,
      size: formatBytes(file.size),
    });
  });

  showToast(`Загружено файлов: ${prepared.length}`);
}

async function removeCabinetFile(fileId) {
  const index = FILES_STATE.items.findIndex((file) => file.id === fileId);
  if (index < 0) {
    showToast("Файл не найден");
    return;
  }

  const [removed] = FILES_STATE.items.splice(index, 1);
  await saveFiles();
  renderFiles();

  emitCabinetHistory({
    scope: "files",
    type: "file_delete",
    action: "file_delete",
    title: `Удалён файл: ${removed.name}`,
    message: `Размер: ${formatBytes(removed.size)}`,
    file_name: removed.name,
    size: formatBytes(removed.size),
  });

  showToast(`Удалён файл: ${removed.name}`);
}

async function moveCabinetFile(fromIndex, toIndex) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= FILES_STATE.items.length ||
    toIndex >= FILES_STATE.items.length
  ) {
    return;
  }

  const copy = [...FILES_STATE.items];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);

  FILES_STATE.items = copy;
  await saveFiles();
  renderFiles();

  emitCabinetHistory({
    scope: "files",
    type: "file_reorder",
    action: "file_reorder",
    title: `Изменён порядок файлов`,
    message: `Файл: ${moved.name}`,
    file_name: moved.name,
  });
}

function renderFilesToolbar() {
  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="flex-between" style="align-items:center; gap:12px; flex-wrap:wrap;">
        <div>
          <h3 style="margin:0 0 4px 0;">Файлы игрока</h3>
          <div class="muted">
            Local-first модуль. Можно загружать, скачивать, удалять и перетаскивать файлы.
          </div>
        </div>

        <div class="cart-buttons">
          <button class="btn" type="button" id="cabinetFilesRefreshBtn">Обновить</button>
          <button class="btn btn-primary" type="button" id="cabinetFilesUploadBtn">Загрузить</button>
          <input type="file" id="cabinetFileInput" multiple style="display:none;" />
        </div>
      </div>

      <div class="muted" style="margin-top:10px;">
        Источник: <strong>${escapeHtml(FILES_STATE.source)}</strong>
        • Файлов: <strong>${escapeHtml(String(FILES_STATE.items.length))}</strong>
        • Последнее сохранение: <strong>${escapeHtml(formatTime(FILES_STATE.lastSavedAt))}</strong>
      </div>
    </div>
  `;
}

function renderFilesList() {
  if (!FILES_STATE.items.length) {
    return `
      <div class="cabinet-block">
        <p>Файлов пока нет.</p>
      </div>
    `;
  }

  return `
    <div class="cabinet-block">
      <div class="inventory-list" id="cabinetFilesList">
        ${FILES_STATE.items
          .map((file, index) => {
            return `
              <div
                class="inventory-item cabinet-file-item"
                draggable="true"
                data-file-id="${escapeHtml(file.id)}"
                data-file-index="${escapeHtml(index)}"
              >
                <div class="inventory-item-info">
                  <strong>${escapeHtml(file.name)}</strong>

                  <div class="inv-item-details">
                    <span>Тип: ${escapeHtml(fileTypeLabel(file.type))}</span>
                    <span>Размер: ${escapeHtml(formatBytes(file.size))}</span>
                    <span>Добавлен: ${escapeHtml(formatDateTime(file.created_at))}</span>
                  </div>
                </div>

                <div class="cart-buttons">
                  <a
                    class="btn"
                    href="${escapeHtml(file.dataUrl)}"
                    download="${escapeHtml(file.name)}"
                  >
                    Скачать
                  </a>
                  <button class="btn btn-danger" type="button" data-file-remove="${escapeHtml(file.id)}">Удалить</button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>

      <div class="muted" style="margin-top:10px;">
        Можно перетаскивать файлы мышью, чтобы менять порядок.
      </div>
    </div>
  `;
}

function renderFiles() {
  const container = getEl("cabinet-files");
  if (!container) return;

  if (!FILES_STATE.loaded) {
    container.innerHTML = `
      ${renderFilesToolbar()}
      <div class="cabinet-block">
        <p>Модуль файлов ещё не загружен.</p>
      </div>
    `;
    bindFilesActions();
    return;
  }

  container.innerHTML = `
    ${renderFilesToolbar()}
    ${renderFilesList()}
  `;

  bindFilesActions();
}

function bindFilesActions() {
  const refreshBtn = getEl("cabinetFilesRefreshBtn");
  if (refreshBtn && refreshBtn.dataset.boundFilesRefresh !== "1") {
    refreshBtn.dataset.boundFilesRefresh = "1";
    refreshBtn.addEventListener("click", async () => {
      await loadFiles();
      showToast("Файлы обновлены");
    });
  }

  const uploadBtn = getEl("cabinetFilesUploadBtn");
  const input = getEl("cabinetFileInput");

  if (uploadBtn && uploadBtn.dataset.boundFilesUploadBtn !== "1") {
    uploadBtn.dataset.boundFilesUploadBtn = "1";
    uploadBtn.addEventListener("click", () => {
      input?.click();
    });
  }

  if (input && input.dataset.boundFilesInput !== "1") {
    input.dataset.boundFilesInput = "1";
    input.addEventListener("change", async () => {
      try {
        await handleFileUpload(input.files);
      } catch (error) {
        console.error(error);
        showToast("Не удалось загрузить файлы");
      } finally {
        input.value = "";
      }
    });
  }

  document.querySelectorAll("[data-file-remove]").forEach((btn) => {
    if (btn.dataset.boundFileRemove !== "1") {
      btn.dataset.boundFileRemove = "1";
      btn.addEventListener("click", async () => {
        const ok = confirm("Удалить файл?");
        if (!ok) return;

        const id = btn.dataset.fileRemove;
        await removeCabinetFile(id);
      });
    }
  });

  document.querySelectorAll(".cabinet-file-item").forEach((item) => {
    if (item.dataset.boundFileDrag !== "1") {
      item.dataset.boundFileDrag = "1";

      item.addEventListener("dragstart", (event) => {
        FILES_STATE.draggedIndex = Number(item.dataset.fileIndex);
        item.style.opacity = "0.45";
        try {
          event.dataTransfer.effectAllowed = "move";
        } catch (_) {}
      });

      item.addEventListener("dragend", () => {
        item.style.opacity = "";
        FILES_STATE.draggedIndex = null;
      });

      item.addEventListener("dragover", (event) => {
        event.preventDefault();
        item.style.outline = "1px dashed rgba(134, 203, 211, 0.35)";
      });

      item.addEventListener("dragleave", () => {
        item.style.outline = "";
      });

      item.addEventListener("drop", async (event) => {
        event.preventDefault();
        item.style.outline = "";

        const toIndex = Number(item.dataset.fileIndex);
        const fromIndex = Number(FILES_STATE.draggedIndex);

        await moveCabinetFile(fromIndex, toIndex);
      });
    }
  });
}

// ------------------------------------------------------------
// 🛡️ GM-ONLY NOTES
// ------------------------------------------------------------
function getGmNotesStorageKey() {
  return getUserScopedKey("gmPrivateNotes");
}

function saveLocalGmNotes(payload) {
  try {
    localStorage.setItem(getGmNotesStorageKey(), JSON.stringify(payload));
  } catch (_) {}
}

function loadLocalGmNotes() {
  try {
    const raw = localStorage.getItem(getGmNotesStorageKey());
    if (!raw) return null;
    return tryParseJson(raw);
  } catch {
    return null;
  }
}

function getGmNotesTextareaValue() {
  const textarea = getEl("gmPrivateNotesTextarea");
  if (!textarea) return GM_NOTES_STATE.text || "";
  return textarea.value ?? "";
}

async function loadGmNotes() {
  if (CABINET_STATE.role !== "gm") {
    GM_NOTES_STATE.loaded = true;
    GM_NOTES_STATE.source = "forbidden";
    GM_NOTES_STATE.text = "";
    GM_NOTES_STATE.raw = "";
    return "";
  }

  let data = await apiGet([
    "/player/notes",
    "/notes/me",
    "/notes",
  ]);
  let source = "api";

  let text = "";

  if (data) {
    text =
      safeText(
        data?.gm_private_notes ??
        data?.gm_private ??
        data?.gm_private_text ??
        data?.gm_internal_notes ??
        data?.private_gm_notes,
        ""
      );
  }

  if (!text) {
    const local = loadLocalGmNotes();
    if (local) {
      text = safeText(local.text ?? local.notes ?? "", "");
      source = "local";
    }
  }

  GM_NOTES_STATE.text = text;
  GM_NOTES_STATE.raw = text;
  GM_NOTES_STATE.loaded = true;
  GM_NOTES_STATE.source = text ? source : source === "api" ? "api" : "empty";

  saveLocalGmNotes({
    text: GM_NOTES_STATE.text,
    updated_at: GM_NOTES_STATE.lastSavedAt,
  });

  return GM_NOTES_STATE.text;
}

async function saveGmNotes() {
  if (CABINET_STATE.role !== "gm") {
    showToast("Недостаточно прав");
    return false;
  }

  const previousText = GM_NOTES_STATE.text || "";
  const nextText = getGmNotesTextareaValue();

  GM_NOTES_STATE.text = nextText;
  GM_NOTES_STATE.raw = nextText;
  GM_NOTES_STATE.isSaving = true;
  renderGmNotes();

  saveLocalGmNotes({
    text: nextText,
    updated_at: new Date().toISOString(),
  });

  try {
    await apiWrite(
      ["/player/notes", "/notes/me", "/notes"],
      {
        gm_private_notes: nextText,
        gm_private: nextText,
        gm_private_text: nextText,
        gm_internal_notes: nextText,
        private_gm_notes: nextText,
      },
      ["POST", "PUT", "PATCH"]
    );

    GM_NOTES_STATE.source = "api";
  } catch (_) {
    GM_NOTES_STATE.source = "local";
  }

  GM_NOTES_STATE.lastSavedAt = new Date().toISOString();
  GM_NOTES_STATE.isSaving = false;
  renderGmNotes();

  if (previousText !== nextText) {
    emitCabinetHistory({
      scope: "gm",
      type: "gm_private_notes_save",
      action: "gm_private_notes_save",
      title: "Обновлены приватные заметки ГМа",
      message: nextText
        ? `Символов: ${nextText.length}`
        : "Приватные заметки ГМа очищены",
    });
  }

  showToast("GM-only заметки сохранены");
  return true;
}

async function clearGmNotes() {
  if (CABINET_STATE.role !== "gm") {
    showToast("Недостаточно прав");
    return false;
  }

  GM_NOTES_STATE.text = "";
  GM_NOTES_STATE.raw = "";
  saveLocalGmNotes({
    text: "",
    updated_at: new Date().toISOString(),
  });

  try {
    await apiWrite(
      ["/player/notes", "/notes/me", "/notes"],
      {
        gm_private_notes: "",
        gm_private: "",
        gm_private_text: "",
        gm_internal_notes: "",
        private_gm_notes: "",
      },
      ["POST", "PUT", "PATCH"]
    );

    GM_NOTES_STATE.source = "api";
  } catch (_) {
    GM_NOTES_STATE.source = "local";
  }

  GM_NOTES_STATE.lastSavedAt = new Date().toISOString();
  renderGmNotes();

  emitCabinetHistory({
    scope: "gm",
    type: "gm_private_notes_clear",
    action: "gm_private_notes_clear",
    title: "Очищены приватные заметки ГМа",
    message: "GM-only блок очищен",
  });

  showToast("GM-only заметки очищены");
  return true;
}

function renderGmNotes() {
  const container = getEl("cabinet-gmnotes");
  if (!container) return;

  if (CABINET_STATE.role !== "gm") {
    container.innerHTML = `
      <div class="cabinet-block">
        <h3>Заметки ГМа</h3>
        <p>Недостаточно прав для просмотра.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="cabinet-block">
      <h3>Заметки ГМа</h3>

      <div class="muted" style="margin-bottom:10px;">
        Это <strong>приватный GM-only блок</strong>. Игрок эти заметки не видит.
        В отличие от вкладки <strong>«Заметки»</strong>, здесь можно хранить скрытые факты,
        планы сцен, последствия, секреты, крючки и служебные пометки.
      </div>

      <div class="muted" style="margin-bottom:10px;">
        Источник: <strong>${escapeHtml(GM_NOTES_STATE.source)}</strong>
        • Последнее сохранение: <strong>${escapeHtml(formatTime(GM_NOTES_STATE.lastSavedAt))}</strong>
      </div>

      <textarea
        id="gmPrivateNotesTextarea"
        rows="18"
        style="width:100%;"
        placeholder="Сюда ГМ может писать скрытые заметки, которые не должны видеть игроки"
      >${escapeHtml(GM_NOTES_STATE.text || "")}</textarea>

      <div class="modal-actions" style="margin-top:12px; gap:8px; flex-wrap:wrap;">
        <button id="saveGmNotesBtn" class="btn btn-success" ${GM_NOTES_STATE.isSaving ? "disabled" : ""}>
          ${GM_NOTES_STATE.isSaving ? "Сохраняю..." : "Сохранить"}
        </button>

        <button id="reloadGmNotesBtn" class="btn">Обновить</button>
        <button id="clearGmNotesBtn" class="btn btn-danger">Очистить</button>
      </div>
    </div>
  `;

  bindGmNotesActions();
}

function bindGmNotesActions() {
  const textarea = getEl("gmPrivateNotesTextarea");
  const saveBtn = getEl("saveGmNotesBtn");
  const reloadBtn = getEl("reloadGmNotesBtn");
  const clearBtn = getEl("clearGmNotesBtn");

  if (textarea && textarea.dataset.boundGmPrivateInput !== "1") {
    textarea.dataset.boundGmPrivateInput = "1";
    textarea.addEventListener("input", () => {
      GM_NOTES_STATE.text = textarea.value;
      GM_NOTES_STATE.raw = textarea.value;

      saveLocalGmNotes({
        text: GM_NOTES_STATE.text,
        updated_at: new Date().toISOString(),
      });
    });
  }

  if (saveBtn && saveBtn.dataset.boundGmPrivateSave !== "1") {
    saveBtn.dataset.boundGmPrivateSave = "1";
    saveBtn.addEventListener("click", async () => {
      await saveGmNotes();
    });
  }

  if (reloadBtn && reloadBtn.dataset.boundGmPrivateReload !== "1") {
    reloadBtn.dataset.boundGmPrivateReload = "1";
    reloadBtn.addEventListener("click", async () => {
      await loadGmNotes();
      renderGmNotes();
      showToast("GM-only заметки обновлены");
    });
  }

  if (clearBtn && clearBtn.dataset.boundGmPrivateClear !== "1") {
    clearBtn.dataset.boundGmPrivateClear = "1";
    clearBtn.addEventListener("click", async () => {
      const ok = confirm("Очистить приватные заметки ГМа?");
      if (!ok) return;
      await clearGmNotes();
    });
  }
}

// ------------------------------------------------------------
// 🚪 OPEN / CLOSE
// ------------------------------------------------------------
export async function openCabinet() {
  const modal = ensureCabinetStructure();
  if (!modal) return;

  CABINET_STATE.role = getCurrentRole();
  normalizeActiveTabForRole();
  renderCabinetHeader();
  renderCabinetTabs();
  bindCabinetTabs();
  bindCabinetActions();
  openModal(modal);
  await refreshCurrentCabinetTab();
}

export function closeCabinet() {
  const modal = getEl("cabinetModal");
  closeModal(modal);
}

// ------------------------------------------------------------
// 📑 TABS
// ------------------------------------------------------------
export async function switchCabinetTab(tabName) {
  CABINET_STATE.activeTab = tabName;

  hideAllCabinetSections();

  const targetId = getSectionIdForTab(tabName);
  const target = getEl(targetId);
  if (target) target.classList.remove("tab-hidden");

  setActiveCabinetButton(tabName);

  if (tabName === "inventory") {
    renderCabinetInventory();
    return;
  }

  if (tabName === "lss") {
    await loadLSS();
    renderLSS();
    return;
  }

  if (tabName === "history") {
    await loadHistory();
    renderHistory();
    return;
  }

  if (tabName === "quests") {
    await loadQuests();
    renderQuests();
    return;
  }

  if (tabName === "map") {
    await loadMapData();
    renderMaps();
    return;
  }

  if (tabName === "bestiari") {
    await loadBestiari();
    renderBestiari();
    return;
  }

  if (tabName === "files") {
    await loadFiles();
    renderFiles();
    return;
  }

  if (tabName === "playernotes") {
    await loadPlayerNotes();
    renderNotes();
    return;
  }

  if (tabName === "gmnotes") {
    await loadGmNotes();
    renderGmNotes();
  }
}

export function bindCabinetTabs() {
  document.querySelectorAll("[data-cabinet-tab]").forEach((btn) => {
    if (btn.dataset.boundCabinetTab === "1") return;
    btn.dataset.boundCabinetTab = "1";

    btn.addEventListener("click", async () => {
      const tabName = btn.dataset.cabinetTab;
      await switchCabinetTab(tabName);
    });
  });
}

// ------------------------------------------------------------
// 🔘 ACTIONS
// ------------------------------------------------------------
function isCabinetOpen() {
  const modal = getEl("cabinetModal");
  if (!modal) return false;
  return modal.style.display === "block" || !modal.classList.contains("hidden");
}

function normalizeActiveTabForRole() {
  const visible = getVisibleTabsByRole(CABINET_STATE.role).map((tab) => tab.key);
  if (!visible.includes(CABINET_STATE.activeTab)) {
    CABINET_STATE.activeTab = "inventory";
  }
}

async function refreshCurrentCabinetTab() {
  if (CABINET_RUNTIME.refreshing) {
    CABINET_RUNTIME.pendingRefresh = true;
    return;
  }

  CABINET_RUNTIME.refreshing = true;
  try {
    await switchCabinetTab(CABINET_STATE.activeTab);
  } finally {
    CABINET_RUNTIME.refreshing = false;
    if (CABINET_RUNTIME.pendingRefresh) {
      CABINET_RUNTIME.pendingRefresh = false;
      await refreshCurrentCabinetTab();
    }
  }
}

async function syncCabinetUiFromRoleChange() {
  const nextRole = getCurrentRole();
  const roleChanged = CABINET_STATE.role !== nextRole;
  CABINET_STATE.role = nextRole;

  normalizeActiveTabForRole();
  renderCabinetHeader();
  renderCabinetTabs();
  bindCabinetTabs();

  if (isCabinetOpen() || roleChanged) {
    await refreshCurrentCabinetTab();
  }
}

export function bindCabinetActions() {
  const modal = getEl("cabinetModal");
  const closeBtn = modal?.querySelector(".close");

  if (closeBtn && closeBtn.dataset.boundCabinetClose !== "1") {
    closeBtn.dataset.boundCabinetClose = "1";
    closeBtn.addEventListener("click", () => closeCabinet());
  }

  if (modal && modal.dataset.boundCabinetRoleSync !== "1") {
    modal.dataset.boundCabinetRoleSync = "1";

    window.addEventListener("dnd:role:changed", async () => {
      await syncCabinetUiFromRoleChange();
    });

    window.addEventListener("dnd:app:state-synced", async () => {
      if (!isCabinetOpen()) return;

      if (CABINET_STATE.activeTab === "inventory") {
        renderCabinetInventory();
        return;
      }

      if (CABINET_STATE.activeTab === "map") {
        await loadMapData();
        renderMaps();
        return;
      }

      if (CABINET_STATE.activeTab === "bestiari") {
        await loadBestiari();
        renderBestiari();
        return;
      }

      if (CABINET_STATE.activeTab === "lss") {
        await loadLSS();
        renderLSS();
      }
    });
  }
}

export async function loadCabinetAll() {
  CABINET_STATE.role = getCurrentRole();
  normalizeActiveTabForRole();

  renderCabinetHeader();
  renderCabinetTabs();
  bindCabinetTabs();

  renderCabinetInventory();

  await loadLSS();
  renderLSS();

  await loadHistory();
  renderHistory();

  await loadQuests();
  renderQuests();

  await loadMapData();
  renderMaps();

  await loadBestiari();
  renderBestiari();

  await loadPlayerNotes();
  renderNotes();

  await loadFiles();
  renderFiles();

  if (CABINET_STATE.role === "gm") {
    await loadGmNotes();
  }
  renderGmNotes();
}

export function initCabinet() {
  const modal = ensureCabinetStructure();
  if (!modal) return;

  CABINET_STATE.role = getCurrentRole();
  normalizeActiveTabForRole();

  renderCabinetHeader();
  renderCabinetTabs();
  renderCabinetInventory();
  renderBestiari();
  renderFiles();
  renderGmNotes();

  bindCabinetTabs();
  bindCabinetActions();

  if (!modal.dataset.boundCabinetOverlay) {
    modal.dataset.boundCabinetOverlay = "1";
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeCabinet();
      }
    });
  }

  CABINET_STATE.initialized = true;
}

// ------------------------------------------------------------
// 🌉 LEGACY BRIDGE
// ------------------------------------------------------------
window.cabinetModule = {
  openCabinet,
  closeCabinet,
  switchCabinetTab,
  loadCabinetAll,
  initCabinet,
};