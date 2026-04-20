// ============================================================
// frontend/js/master-room.js
// Master Room — отдельный модуль ГМ-стола / партии
// - только для ГМа
// - local-first + мягкая попытка API
// - создание нескольких столов
// - token / код стола
// - поиск игроков по нику / email по known-users пулу
// - ручное добавление игрока
// - выбор активного персонажа для участника
// - пресеты видимости: private / basic / sheet / full
// - shared traders
// - выдача золота / предметов (как журнал действий стола)
// - activity log
// - совместим с cabinet.js через container id="cabinet-masterroom"
// ============================================================

// ------------------------------------------------------------
// 🌐 STATE
// ------------------------------------------------------------
const MASTER_ROOM_STATE = {
  loaded: false,
  source: "empty",
  role: "player",

  tables: [],
  activeTableId: null,

  knownUsers: [],
  searchQuery: "",
  lastSearchResults: [],

  ui: {
    createOpen: false,
    memberCharacterDrafts: {},
    notesOpen: false,
  },
};

// ------------------------------------------------------------
// 🧰 HELPERS
// ------------------------------------------------------------
function getEl(id) {
  return document.getElementById(id);
}

function getSection(id) {
  return document.getElementById(id);
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
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
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

function isGm() {
  return MASTER_ROOM_STATE.role === "gm";
}

function makeId(prefix = "mr") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function makeToken(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function normalizeDate(value, fallback = Date.now()) {
  if (!value && value !== 0) return new Date(fallback).toISOString();

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return new Date(fallback).toISOString();
    return date.toISOString();
  } catch {
    return new Date(fallback).toISOString();
  }
}

function formatDateTime(value) {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Без даты";
    return date.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Без даты";
  }
}

function getStorageKey() {
  const user = getCurrentUser();
  const userKey =
    user?.email ||
    user?.id ||
    (getToken() ? "auth-user" : "guest");

  return `dnd_trader_master_room_${userKey}`;
}

function saveLocal(payload) {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(payload));
  } catch (_) {}
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) return null;
    return tryParseJson(raw);
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

  return null;
}

function emitMasterRoomHistory(event) {
  const detail = {
    scope: "gm",
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

function getLssProfile() {
  try {
    if (window.lssModule?.getLssProfile) {
      return window.lssModule.getLssProfile();
    }
  } catch (_) {}
  return null;
}

function getLssCharacterName() {
  const profile = getLssProfile();
  if (!profile) return "";
  return trimText(profile?.name || profile?.info?.name || "");
}

function getKnownUsersCandidates() {
  const currentUser = getCurrentUser();

  const sources = [
    window.__appKnownUsers,
    window.__knownUsers,
    window.__users,
    window.__playerDirectory,
    currentUser
      ? [
          {
            user_id: currentUser.id || currentUser.user_id || null,
            nickname:
              currentUser.nickname ||
              currentUser.username ||
              currentUser.display_name ||
              currentUser.name ||
              currentUser.email ||
              "",
            email: currentUser.email || "",
            display_name:
              currentUser.display_name ||
              currentUser.name ||
              currentUser.nickname ||
              "",
          },
        ]
      : [],
    MASTER_ROOM_STATE.knownUsers,
    MASTER_ROOM_STATE.tables.flatMap((table) => safeArray(table.members)),
  ];

  return sources.flatMap((entry) => safeArray(entry));
}

function normalizeKnownUser(user, index = 0) {
  if (!user || typeof user !== "object") {
    const value = trimText(user);
    return {
      id: makeId(`known_${index}`),
      user_id: null,
      nickname: value || `Игрок ${index + 1}`,
      email: "",
      display_name: value || `Игрок ${index + 1}`,
    };
  }

  const nickname = trimText(
    user.nickname ||
      user.username ||
      user.display_name ||
      user.name ||
      user.email ||
      ""
  );

  return {
    id: user.id || user.user_id || makeId(`known_${index}`),
    user_id: user.user_id || user.id || null,
    nickname: nickname || `Игрок ${index + 1}`,
    email: trimText(user.email || ""),
    display_name: trimText(
      user.display_name ||
        user.name ||
        nickname
    ),
  };
}

function dedupeKnownUsers(users) {
  const seen = new Set();
  const out = [];

  users.forEach((user, index) => {
    const normalized = normalizeKnownUser(user, index);
    const key = [
      normalized.user_id || "",
      normalized.nickname.toLowerCase(),
      normalized.email.toLowerCase(),
    ].join("|");

    if (!normalized.nickname && !normalized.email) return;
    if (seen.has(key)) return;

    seen.add(key);
    out.push(normalized);
  });

  return out.sort((a, b) =>
    String(a.nickname).localeCompare(String(b.nickname), "ru")
  );
}

function visibilityPresetLabel(preset) {
  const map = {
    private: "Приватно",
    basic: "База",
    sheet: "Лист",
    full: "Полный доступ",
  };
  return map[preset] || "База";
}

function typeIcon(kind) {
  const map = {
    table_create: "🧩",
    table_delete: "🗑️",
    member_add: "➕",
    member_remove: "➖",
    member_visibility: "👁️",
    member_character: "🧙",
    gold_grant: "🪙",
    item_grant: "🎁",
    trader_share_add: "🏪",
    trader_share_remove: "🚫",
    note: "📝",
  };
  return map[kind] || "📜";
}

function normalizeActivityEntry(entry, index = 0) {
  if (!entry || typeof entry !== "object") {
    return {
      id: makeId(`activity_${index}`),
      type: "note",
      title: trimText(entry) || "Событие",
      message: "",
      created_at: normalizeDate(Date.now() - index * 1000),
      actor: "",
    };
  }

  return {
    id: entry.id || makeId(`activity_${index}`),
    type: trimText(entry.type) || "note",
    title: trimText(entry.title) || "Событие",
    message: trimText(entry.message) || "",
    created_at: normalizeDate(entry.created_at || entry.timestamp || Date.now() - index * 1000),
    actor: trimText(entry.actor) || "",
  };
}

function normalizeMember(member, index = 0) {
  const nickname = trimText(
    member?.nickname ||
      member?.username ||
      member?.display_name ||
      member?.name ||
      member?.email ||
      `Игрок ${index + 1}`
  );

  return {
    id: member?.id || makeId(`member_${index}`),
    user_id: member?.user_id || member?.id || null,
    nickname,
    email: trimText(member?.email || ""),
    role_in_table: trimText(member?.role_in_table || "player") || "player",
    joined_at: normalizeDate(member?.joined_at || Date.now() - index * 1000),
    visibility_preset: trimText(member?.visibility_preset || "basic") || "basic",
    selected_character_id: trimText(member?.selected_character_id || ""),
    selected_character_name: trimText(member?.selected_character_name || member?.character_name || ""),
    notes: trimText(member?.notes || ""),
  };
}

function normalizeTable(table, index = 0) {
  return {
    id: table?.id || makeId(`table_${index}`),
    title: trimText(table?.title || table?.name || `Стол ${index + 1}`),
    token: trimText(table?.token || table?.code || makeToken()),
    status: trimText(table?.status || "active") || "active",
    notes: trimText(table?.notes || ""),
    shared_traders: safeArray(table?.shared_traders)
      .map((entry) => trimText(entry))
      .filter(Boolean),
    members: safeArray(table?.members).map((member, memberIndex) =>
      normalizeMember(member, memberIndex)
    ),
    activity: safeArray(table?.activity).map((entry, entryIndex) =>
      normalizeActivityEntry(entry, entryIndex)
    ),
    created_at: normalizeDate(table?.created_at || Date.now() - index * 1000),
    updated_at: normalizeDate(table?.updated_at || Date.now() - index * 1000),
  };
}

function normalizeTableList(list) {
  return safeArray(list)
    .map((table, index) => normalizeTable(table, index))
    .sort((a, b) => {
      const ta = new Date(a.updated_at).getTime();
      const tb = new Date(b.updated_at).getTime();
      return tb - ta;
    });
}

function getActiveTable() {
  return MASTER_ROOM_STATE.tables.find((table) => table.id === MASTER_ROOM_STATE.activeTableId) || null;
}

function refreshKnownUsersPool() {
  MASTER_ROOM_STATE.knownUsers = dedupeKnownUsers(getKnownUsersCandidates());
  MASTER_ROOM_STATE.lastSearchResults = getKnownUserSearchResults(MASTER_ROOM_STATE.searchQuery);
}

function getKnownUserSearchResults(query) {
  const needle = trimText(query).toLowerCase();
  if (!needle) return MASTER_ROOM_STATE.knownUsers.slice(0, 8);

  return MASTER_ROOM_STATE.knownUsers
    .filter((user) => {
      const blob = [
        user.nickname,
        user.email,
        user.display_name,
      ]
        .join(" ")
        .toLowerCase();

      return blob.includes(needle);
    })
    .slice(0, 12);
}

// ------------------------------------------------------------
// 📥 LOAD / SAVE
// ------------------------------------------------------------
function tryLoadFromWindow() {
  const candidates = [
    window.__MASTER_ROOM_DATA__,
    window.__masterRoomData,
    window.__GM_TABLES__,
    window.__gmTables,
  ];

  for (const candidate of candidates) {
    if (candidate) return candidate;
  }

  return null;
}

export async function loadMasterRoom() {
  MASTER_ROOM_STATE.role = getCurrentRole();

  let data = await apiGet([
    "/gm/master-room",
    "/master-room/me",
    "/gm/tables",
    "/tables/gm",
  ]);
  let source = "api";

  if (!data) {
    data = tryLoadFromWindow();
    source = "window";
  }

  if (!data) {
    data = loadLocal();
    source = "local";
  }

  const tables = Array.isArray(data)
    ? data
    : safeArray(data?.tables);

  MASTER_ROOM_STATE.tables = normalizeTableList(tables);
  MASTER_ROOM_STATE.loaded = true;
  MASTER_ROOM_STATE.source = MASTER_ROOM_STATE.tables.length ? source : "empty";
  MASTER_ROOM_STATE.activeTableId =
    MASTER_ROOM_STATE.tables[0]?.id || null;

  MASTER_ROOM_STATE.searchQuery = "";
  refreshKnownUsersPool();

  renderMasterRoom();
  return MASTER_ROOM_STATE.tables;
}

export async function saveMasterRoom() {
  saveLocal({
    tables: MASTER_ROOM_STATE.tables,
  });

  const result = await apiWrite(
    ["/gm/master-room", "/master-room/me", "/gm/tables", "/tables/gm"],
    { tables: MASTER_ROOM_STATE.tables },
    ["POST", "PUT", "PATCH"]
  );

  MASTER_ROOM_STATE.source = result ? "api" : "local";
  return true;
}

export function getMasterRoomData() {
  return {
    tables: MASTER_ROOM_STATE.tables,
    activeTableId: MASTER_ROOM_STATE.activeTableId,
    source: MASTER_ROOM_STATE.source,
    role: MASTER_ROOM_STATE.role,
  };
}

export function setMasterRoomData(payload = {}) {
  MASTER_ROOM_STATE.tables = normalizeTableList(payload?.tables);
  MASTER_ROOM_STATE.activeTableId =
    payload?.activeTableId ||
    MASTER_ROOM_STATE.tables[0]?.id ||
    null;
  MASTER_ROOM_STATE.loaded = true;
  MASTER_ROOM_STATE.source = trimText(payload?.source || "manual") || "manual";
  refreshKnownUsersPool();
  renderMasterRoom();
}

export function clearMasterRoomData() {
  MASTER_ROOM_STATE.tables = [];
  MASTER_ROOM_STATE.activeTableId = null;
  MASTER_ROOM_STATE.loaded = true;
  MASTER_ROOM_STATE.source = "empty";
  MASTER_ROOM_STATE.searchQuery = "";
  MASTER_ROOM_STATE.lastSearchResults = [];
  saveLocal({ tables: [] });
  renderMasterRoom();
}

// ------------------------------------------------------------
// 🧱 CRUD
// ------------------------------------------------------------
function patchTable(tableId, patchFn) {
  let changed = null;

  MASTER_ROOM_STATE.tables = MASTER_ROOM_STATE.tables.map((table) => {
    if (table.id !== tableId) return table;

    changed = normalizeTable(
      {
        ...patchFn(table),
        updated_at: new Date().toISOString(),
      },
      0
    );

    return changed;
  });

  refreshKnownUsersPool();
  return changed;
}

function addActivityToTable(tableId, entry) {
  patchTable(tableId, (table) => ({
    ...table,
    activity: [
      normalizeActivityEntry(
        {
          ...entry,
          id: makeId("activity"),
          created_at: new Date().toISOString(),
        },
        0
      ),
      ...safeArray(table.activity),
    ].slice(0, 120),
  }));
}

export async function createMasterTable(payload = {}) {
  const currentUser = getCurrentUser();
  const currentNickname = trimText(
    currentUser?.nickname ||
      currentUser?.username ||
      currentUser?.display_name ||
      currentUser?.name ||
      currentUser?.email ||
      "ГМ"
  );

  const table = normalizeTable(
    {
      id: makeId("table"),
      title: trimText(payload.title || "Новый стол"),
      token: trimText(payload.token || makeToken()),
      status: "active",
      notes: trimText(payload.notes || ""),
      shared_traders: [],
      members: [
        {
          id: makeId("member_gm"),
          user_id: currentUser?.id || currentUser?.user_id || null,
          nickname: currentNickname,
          email: trimText(currentUser?.email || ""),
          role_in_table: "gm",
          visibility_preset: "full",
          selected_character_name: getLssCharacterName(),
          selected_character_id: "",
          joined_at: new Date().toISOString(),
        },
      ],
      activity: [
        {
          type: "table_create",
          title: "Стол создан",
          message: `Создан стол "${trimText(payload.title || "Новый стол")}"`,
          actor: currentNickname,
          created_at: new Date().toISOString(),
        },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    0
  );

  MASTER_ROOM_STATE.tables = [table, ...MASTER_ROOM_STATE.tables];
  MASTER_ROOM_STATE.activeTableId = table.id;
  MASTER_ROOM_STATE.ui.createOpen = false;

  refreshKnownUsersPool();
  await saveMasterRoom();
  renderMasterRoom();

  emitMasterRoomHistory({
    type: "table_create",
    action: "table_create",
    title: `Создан стол: ${table.title}`,
    message: `Код доступа: ${table.token}`,
  });

  showToast("Стол создан");
  return table;
}

export async function deleteMasterTable(tableId) {
  const table = MASTER_ROOM_STATE.tables.find((entry) => entry.id === tableId) || null;
  MASTER_ROOM_STATE.tables = MASTER_ROOM_STATE.tables.filter((entry) => entry.id !== tableId);

  if (MASTER_ROOM_STATE.activeTableId === tableId) {
    MASTER_ROOM_STATE.activeTableId = MASTER_ROOM_STATE.tables[0]?.id || null;
  }

  refreshKnownUsersPool();
  await saveMasterRoom();
  renderMasterRoom();

  if (table) {
    emitMasterRoomHistory({
      type: "table_delete",
      action: "table_delete",
      title: `Удалён стол: ${table.title}`,
      message: `Код: ${table.token}`,
    });
  }

  showToast("Стол удалён");
}

export function selectMasterTable(tableId) {
  MASTER_ROOM_STATE.activeTableId = tableId;
  renderMasterRoom();
}

export async function updateTableNotes(tableId, notes) {
  patchTable(tableId, (table) => ({
    ...table,
    notes: trimText(notes),
  }));

  await saveMasterRoom();
  renderMasterRoom();

  emitMasterRoomHistory({
    type: "note",
    action: "table_note_update",
    title: "Обновлены заметки стола",
    message: trimText(notes) || "Заметки очищены",
  });
}

export async function addMemberToTable(tableId, memberPayload) {
  const table = MASTER_ROOM_STATE.tables.find((entry) => entry.id === tableId);
  if (!table) return null;

  const nickname = trimText(
    memberPayload?.nickname ||
      memberPayload?.username ||
      memberPayload?.display_name ||
      memberPayload?.name ||
      memberPayload?.email ||
      ""
  );

  if (!nickname) {
    showToast("Укажи ник игрока");
    return null;
  }

  const email = trimText(memberPayload?.email || "");
  const existing = safeArray(table.members).find((member) => {
    const sameNick = member.nickname.toLowerCase() === nickname.toLowerCase();
    const sameEmail = email && member.email.toLowerCase() === email.toLowerCase();
    return sameNick || sameEmail;
  });

  if (existing) {
    showToast("Игрок уже есть в этом столе");
    return existing;
  }

  const member = normalizeMember(
    {
      id: makeId("member"),
      user_id: memberPayload?.user_id || memberPayload?.id || null,
      nickname,
      email,
      role_in_table: "player",
      visibility_preset: "basic",
      selected_character_name: trimText(memberPayload?.selected_character_name || ""),
      selected_character_id: trimText(memberPayload?.selected_character_id || ""),
      joined_at: new Date().toISOString(),
    },
    0
  );

  patchTable(tableId, (currentTable) => ({
    ...currentTable,
    members: [...currentTable.members, member],
  }));

  MASTER_ROOM_STATE.knownUsers = dedupeKnownUsers([...MASTER_ROOM_STATE.knownUsers, member]);
  MASTER_ROOM_STATE.lastSearchResults = getKnownUserSearchResults(MASTER_ROOM_STATE.searchQuery);

  addActivityToTable(tableId, {
    type: "member_add",
    title: "Игрок добавлен",
    message: `${member.nickname}${member.email ? ` • ${member.email}` : ""}`,
    actor: getCurrentUser()?.nickname || getCurrentUser()?.email || "ГМ",
  });

  await saveMasterRoom();
  renderMasterRoom();

  emitMasterRoomHistory({
    type: "member_add",
    action: "member_add",
    title: `Игрок добавлен в стол`,
    message: member.nickname,
  });

  showToast("Игрок добавлен");
  return member;
}

export async function removeMemberFromTable(tableId, memberId) {
  const table = MASTER_ROOM_STATE.tables.find((entry) => entry.id === tableId);
  const member = table?.members.find((entry) => entry.id === memberId) || null;
  if (!table || !member) return;

  patchTable(tableId, (currentTable) => ({
    ...currentTable,
    members: currentTable.members.filter((entry) => entry.id !== memberId),
  }));

  addActivityToTable(tableId, {
    type: "member_remove",
    title: "Игрок удалён",
    message: member.nickname,
    actor: getCurrentUser()?.nickname || getCurrentUser()?.email || "ГМ",
  });

  await saveMasterRoom();
  renderMasterRoom();

  emitMasterRoomHistory({
    type: "member_remove",
    action: "member_remove",
    title: `Игрок удалён из стола`,
    message: member.nickname,
  });

  showToast("Игрок удалён");
}

export async function updateMemberVisibility(tableId, memberId, preset) {
  const label = visibilityPresetLabel(preset);

  patchTable(tableId, (table) => ({
    ...table,
    members: table.members.map((member) =>
      member.id === memberId
        ? normalizeMember(
            {
              ...member,
              visibility_preset: preset,
            },
            0
          )
        : member
    ),
  }));

  addActivityToTable(tableId, {
    type: "member_visibility",
    title: "Изменён доступ",
    message: label,
    actor: getCurrentUser()?.nickname || getCurrentUser()?.email || "ГМ",
  });

  await saveMasterRoom();
  renderMasterRoom();

  emitMasterRoomHistory({
    type: "member_visibility",
    action: "member_visibility",
    title: "Изменён пресет видимости",
    message: label,
  });
}

export async function updateMemberCharacter(tableId, memberId, payload = {}) {
  const characterName = trimText(payload.selected_character_name || "");
  const characterId = trimText(payload.selected_character_id || "");

  patchTable(tableId, (table) => ({
    ...table,
    members: table.members.map((member) =>
      member.id === memberId
        ? normalizeMember(
            {
              ...member,
              selected_character_name: characterName,
              selected_character_id: characterId,
            },
            0
          )
        : member
    ),
  }));

  addActivityToTable(tableId, {
    type: "member_character",
    title: "Выбран персонаж",
    message: characterName || "Персонаж очищен",
    actor: getCurrentUser()?.nickname || getCurrentUser()?.email || "ГМ",
  });

  await saveMasterRoom();
  renderMasterRoom();

  emitMasterRoomHistory({
    type: "member_character",
    action: "member_character",
    title: "Изменён активный персонаж",
    message: characterName || "Персонаж снят",
  });
}

export async function grantGoldToMember(tableId, memberId, amount, reason = "") {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    showToast("Укажи корректное количество золота");
    return;
  }

  const table = MASTER_ROOM_STATE.tables.find((entry) => entry.id === tableId);
  const member = table?.members.find((entry) => entry.id === memberId) || null;
  if (!table || !member) return;

  addActivityToTable(tableId, {
    type: "gold_grant",
    title: "Выдано золото",
    message: `${member.nickname} • ${numericAmount} зм${reason ? ` • ${trimText(reason)}` : ""}`,
    actor: getCurrentUser()?.nickname || getCurrentUser()?.email || "ГМ",
  });

  await saveMasterRoom();
  renderMasterRoom();

  emitMasterRoomHistory({
    type: "gold_grant",
    action: "gold_grant",
    title: "ГМ выдал золото",
    message: `${member.nickname} • ${numericAmount} зм`,
  });

  showToast("Выдача золота записана в журнал");
}

export async function grantItemToMember(tableId, memberId, itemName, quantity = 1, reason = "") {
  const normalizedItemName = trimText(itemName);
  const qty = Math.max(1, Number(quantity) || 1);

  if (!normalizedItemName) {
    showToast("Укажи название предмета");
    return;
  }

  const table = MASTER_ROOM_STATE.tables.find((entry) => entry.id === tableId);
  const member = table?.members.find((entry) => entry.id === memberId) || null;
  if (!table || !member) return;

  addActivityToTable(tableId, {
    type: "item_grant",
    title: "Выдан предмет",
    message: `${member.nickname} • ${normalizedItemName} ×${qty}${reason ? ` • ${trimText(reason)}` : ""}`,
    actor: getCurrentUser()?.nickname || getCurrentUser()?.email || "ГМ",
  });

  await saveMasterRoom();
  renderMasterRoom();

  emitMasterRoomHistory({
    type: "item_grant",
    action: "item_grant",
    title: "ГМ выдал предмет",
    message: `${member.nickname} • ${normalizedItemName} ×${qty}`,
  });

  showToast("Выдача предмета записана в журнал");
}

export async function addSharedTraderToTable(tableId, traderName) {
  const normalized = trimText(traderName);
  if (!normalized) {
    showToast("Укажи торговца");
    return;
  }

  const table = MASTER_ROOM_STATE.tables.find((entry) => entry.id === tableId);
  if (!table) return;

  if (table.shared_traders.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) {
    showToast("Этот торговец уже открыт для стола");
    return;
  }

  patchTable(tableId, (currentTable) => ({
    ...currentTable,
    shared_traders: [...currentTable.shared_traders, normalized],
  }));

  addActivityToTable(tableId, {
    type: "trader_share_add",
    title: "Открыт торговец",
    message: normalized,
    actor: getCurrentUser()?.nickname || getCurrentUser()?.email || "ГМ",
  });

  await saveMasterRoom();
  renderMasterRoom();

  emitMasterRoomHistory({
    type: "trader_share_add",
    action: "trader_share_add",
    title: "Открыт торговец для стола",
    message: normalized,
  });

  showToast("Торговец добавлен");
}

export async function removeSharedTraderFromTable(tableId, traderName) {
  const normalized = trimText(traderName);
  if (!normalized) return;

  patchTable(tableId, (currentTable) => ({
    ...currentTable,
    shared_traders: currentTable.shared_traders.filter(
      (entry) => entry.toLowerCase() !== normalized.toLowerCase()
    ),
  }));

  addActivityToTable(tableId, {
    type: "trader_share_remove",
    title: "Торговец закрыт",
    message: normalized,
    actor: getCurrentUser()?.nickname || getCurrentUser()?.email || "ГМ",
  });

  await saveMasterRoom();
  renderMasterRoom();

  emitMasterRoomHistory({
    type: "trader_share_remove",
    action: "trader_share_remove",
    title: "Торговец скрыт для стола",
    message: normalized,
  });

  showToast("Торговец удалён");
}

// ------------------------------------------------------------
// 🎨 RENDER HELPERS
// ------------------------------------------------------------
function renderSummaryBar() {
  const active = getActiveTable();
  const totalMembers = MASTER_ROOM_STATE.tables.reduce(
    (sum, table) => sum + safeArray(table.members).filter((member) => member.role_in_table === "player").length,
    0
  );

  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="trader-meta">
        <span class="meta-item">Столов: ${MASTER_ROOM_STATE.tables.length}</span>
        <span class="meta-item">Игроков: ${totalMembers}</span>
        <span class="meta-item">Источник: ${escapeHtml(MASTER_ROOM_STATE.source)}</span>
        <span class="meta-item">Роль: ${escapeHtml(MASTER_ROOM_STATE.role)}</span>
        ${active ? `<span class="meta-item">Активный стол: ${escapeHtml(active.title)}</span>` : ""}
      </div>
      <div class="muted" style="margin-top:8px;">
        Master Room — каркас ГМ-стола: состав партии, персонажи, права видимости, журнал действий и выдача наград.
      </div>
    </div>
  `;
}

function renderCreatePanel() {
  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="flex-between" style="align-items:center; gap:10px; flex-wrap:wrap;">
        <div>
          <h3 style="margin:0 0 6px;">Создание стола</h3>
          <div class="muted">ГМ создаёт стол, задаёт имя и код подключения.</div>
        </div>
        <div class="cart-buttons">
          <button type="button" class="btn btn-primary" id="masterRoomToggleCreateBtn">
            ${MASTER_ROOM_STATE.ui.createOpen ? "Скрыть форму" : "➕ Новый стол"}
          </button>
        </div>
      </div>

      <div id="masterRoomCreateWrap" style="${MASTER_ROOM_STATE.ui.createOpen ? 'margin-top:12px;' : 'display:none;'}">
        <div class="profile-grid">
          <div class="filter-group">
            <label for="masterRoomCreateTitle">Название стола</label>
            <input id="masterRoomCreateTitle" type="text" placeholder="Например: Пепельный поход" />
          </div>
          <div class="filter-group">
            <label for="masterRoomCreateToken">Код / token</label>
            <input id="masterRoomCreateToken" type="text" placeholder="Оставь пустым для автогенерации" />
          </div>
        </div>

        <div class="filter-group" style="margin-top:10px;">
          <label for="masterRoomCreateNotes">Заметка ГМа</label>
          <textarea id="masterRoomCreateNotes" rows="4" placeholder="Краткая цель стола, сеттинг, правила доступа..."></textarea>
        </div>

        <div class="modal-actions" style="margin-top:12px;">
          <button type="button" class="btn btn-success" id="masterRoomCreateSubmitBtn">Создать стол</button>
        </div>
      </div>
    </div>
  `;
}

function renderTablesList() {
  if (!MASTER_ROOM_STATE.tables.length) {
    return `
      <div class="cabinet-block" style="margin-bottom:12px;">
        <h3 style="margin-bottom:8px;">Столы</h3>
        <div class="muted">Пока нет ни одного стола. Создай первый, и дальше уже собирай в него игроков.</div>
      </div>
    `;
  }

  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <h3 style="margin-bottom:10px;">Столы ГМа</h3>
      <div class="trader-list-mini">
        ${MASTER_ROOM_STATE.tables
          .map((table) => {
            const isActive = table.id === MASTER_ROOM_STATE.activeTableId;
            const playersCount = table.members.filter((member) => member.role_in_table === "player").length;

            return `
              <div class="collection-wrapper" style="margin-bottom:10px; border:${isActive ? '1px solid rgba(214,181,122,0.28)' : '1px solid rgba(255,255,255,0.05)'};">
                <div class="flex-between" style="align-items:flex-start; gap:12px; flex-wrap:wrap;">
                  <div style="min-width:0; flex:1 1 320px;">
                    <div class="trader-name" style="font-size:1rem;">${escapeHtml(table.title)}</div>
                    <div class="trader-meta" style="margin-top:8px;">
                      <span class="meta-item">Код: ${escapeHtml(table.token)}</span>
                      <span class="meta-item">Игроков: ${playersCount}</span>
                      <span class="meta-item">Создан: ${escapeHtml(formatDateTime(table.created_at))}</span>
                    </div>
                  </div>

                  <div class="cart-buttons">
                    <button type="button" class="btn ${isActive ? 'btn-secondary' : 'btn-primary'}" data-master-room-select-table="${escapeHtml(table.id)}">
                      ${isActive ? "Открыт" : "Открыть"}
                    </button>
                    <button type="button" class="btn btn-warning" data-master-room-copy-token="${escapeHtml(table.id)}">Копировать код</button>
                    <button type="button" class="btn btn-danger" data-master-room-delete-table="${escapeHtml(table.id)}">Удалить</button>
                  </div>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderSearchResults() {
  const results = MASTER_ROOM_STATE.lastSearchResults;

  if (!MASTER_ROOM_STATE.searchQuery) {
    return `<div class="muted" style="margin-top:8px;">Начни вводить ник или email, чтобы искать игроков.</div>`;
  }

  if (!results.length) {
    return `<div class="muted" style="margin-top:8px;">Совпадений не найдено. Можно добавить игрока вручную.</div>`;
  }

  return `
    <div style="margin-top:10px; display:grid; gap:8px;">
      ${results
        .map(
          (user) => `
            <div class="collection-wrapper" style="padding:10px 12px;">
              <div class="flex-between" style="align-items:center; gap:10px; flex-wrap:wrap;">
                <div>
                  <div class="trader-name" style="font-size:0.96rem;">${escapeHtml(user.nickname)}</div>
                  <div class="muted" style="font-size:12px;">
                    ${escapeHtml(user.email || "email не указан")}
                    ${user.display_name && user.display_name !== user.nickname ? ` • ${escapeHtml(user.display_name)}` : ""}
                  </div>
                </div>
                <div class="cart-buttons">
                  <button type="button" class="btn btn-success" data-master-room-add-known-user="${escapeHtml(user.id)}">Добавить в стол</button>
                </div>
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderMembersTable(table) {
  const players = safeArray(table?.members);

  if (!players.length) {
    return `<div class="muted">В этом столе пока нет участников.</div>`;
  }

  return `
    <div class="items-table-container">
      <table class="items-table">
        <thead>
          <tr>
            <th>Игрок</th>
            <th>Email</th>
            <th>Роль</th>
            <th>Персонаж</th>
            <th>Видимость</th>
            <th>Дата входа</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${players
            .map((member) => {
              const memberDraft =
                MASTER_ROOM_STATE.ui.memberCharacterDrafts[member.id] ??
                member.selected_character_name ??
                "";

              return `
                <tr>
                  <td>
                    <strong>${escapeHtml(member.nickname)}</strong>
                  </td>
                  <td>${escapeHtml(member.email || "—")}</td>
                  <td>${member.role_in_table === "gm" ? "ГМ" : "Игрок"}</td>
                  <td style="min-width:220px;">
                    <div class="filter-group" style="gap:6px;">
                      <input
                        type="text"
                        value="${escapeHtml(memberDraft)}"
                        data-master-room-character-input="${escapeHtml(member.id)}"
                        placeholder="Имя активного персонажа"
                      />
                      <div class="cart-buttons" style="justify-content:flex-start;">
                        <button type="button" class="btn btn-primary" data-master-room-save-character="${escapeHtml(member.id)}">Сохранить</button>
                        <button type="button" class="btn btn-secondary" data-master-room-use-lss="${escapeHtml(member.id)}">Взять из LSS</button>
                      </div>
                    </div>
                  </td>
                  <td style="min-width:180px;">
                    <select data-master-room-visibility="${escapeHtml(member.id)}" ${member.role_in_table === 'gm' ? 'disabled' : ''}>
                      <option value="private" ${member.visibility_preset === "private" ? "selected" : ""}>Приватно</option>
                      <option value="basic" ${member.visibility_preset === "basic" ? "selected" : ""}>База</option>
                      <option value="sheet" ${member.visibility_preset === "sheet" ? "selected" : ""}>Лист</option>
                      <option value="full" ${member.visibility_preset === "full" ? "selected" : ""}>Полный доступ</option>
                    </select>
                  </td>
                  <td>${escapeHtml(formatDateTime(member.joined_at))}</td>
                  <td>
                    ${
                      member.role_in_table === "gm"
                        ? `<span class="quality-badge">Нельзя удалить</span>`
                        : `<button type="button" class="btn btn-danger" data-master-room-remove-member="${escapeHtml(member.id)}">Удалить</button>`
                    }
                  </td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderActiveTable(table) {
  if (!table) {
    return `
      <div class="cabinet-block">
        <h3 style="margin-bottom:8px;">Активный стол</h3>
        <div class="muted">Выбери существующий стол или создай новый.</div>
      </div>
    `;
  }

  const playerOptions = table.members
    .filter((member) => member.role_in_table !== "gm")
    .map(
      (member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.nickname)}</option>`
    )
    .join("");

  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="flex-between" style="align-items:flex-start; gap:12px; flex-wrap:wrap;">
        <div>
          <h3 style="margin:0 0 8px;">${escapeHtml(table.title)}</h3>
          <div class="trader-meta">
            <span class="meta-item">Код: ${escapeHtml(table.token)}</span>
            <span class="meta-item">Статус: ${escapeHtml(table.status)}</span>
            <span class="meta-item">Обновлён: ${escapeHtml(formatDateTime(table.updated_at))}</span>
          </div>
        </div>
        <div class="cart-buttons">
          <button type="button" class="btn btn-warning" data-master-room-copy-token="${escapeHtml(table.id)}">Копировать код</button>
        </div>
      </div>

      <div class="profile-grid" style="margin-top:12px;">
        <div class="collection-wrapper">
          <h4 style="margin-bottom:8px;">Поиск игрока</h4>
          <div class="filter-group">
            <label for="masterRoomPlayerSearch">Ник / email</label>
            <input id="masterRoomPlayerSearch" type="text" value="${escapeHtml(MASTER_ROOM_STATE.searchQuery)}" placeholder="Например: AndersunI" />
          </div>
          ${renderSearchResults()}
        </div>

        <div class="collection-wrapper">
          <h4 style="margin-bottom:8px;">Добавить вручную</h4>
          <div class="profile-grid">
            <div class="filter-group">
              <label for="masterRoomManualNickname">Ник игрока</label>
              <input id="masterRoomManualNickname" type="text" placeholder="nickname" />
            </div>
            <div class="filter-group">
              <label for="masterRoomManualEmail">Email</label>
              <input id="masterRoomManualEmail" type="text" placeholder="email@example.com" />
            </div>
          </div>
          <div class="modal-actions" style="margin-top:10px;">
            <button type="button" class="btn btn-success" id="masterRoomManualAddBtn">Добавить игрока</button>
          </div>
        </div>
      </div>

      <div class="collection-wrapper" style="margin-top:12px;">
        <h4 style="margin-bottom:8px;">Участники стола</h4>
        ${renderMembersTable(table)}
      </div>

      <div class="profile-grid" style="margin-top:12px;">
        <div class="collection-wrapper">
          <h4 style="margin-bottom:8px;">Shared traders</h4>
          <div class="filter-group">
            <label for="masterRoomTraderInput">Торговец / id / название</label>
            <input id="masterRoomTraderInput" type="text" placeholder="Например: garlen_harlaturl" />
          </div>
          <div class="modal-actions" style="margin-top:10px;">
            <button type="button" class="btn btn-success" id="masterRoomAddTraderBtn">Открыть торговца</button>
          </div>

          <div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:8px;">
            ${
              table.shared_traders.length
                ? table.shared_traders
                    .map(
                      (trader) => `
                        <span class="meta-item" style="gap:8px;">
                          ${escapeHtml(trader)}
                          <button
                            type="button"
                            class="btn btn-danger"
                            data-master-room-remove-trader="${escapeHtml(trader)}"
                            style="min-height:26px; padding:4px 8px;"
                          >×</button>
                        </span>
                      `
                    )
                    .join("")
                : `<span class="muted">Пока нет открытых торговцев для этого стола.</span>`
            }
          </div>
        </div>

        <div class="collection-wrapper">
          <h4 style="margin-bottom:8px;">ГМ-действия</h4>
          <div class="profile-grid">
            <div class="filter-group">
              <label for="masterRoomGoldTarget">Кому выдать золото</label>
              <select id="masterRoomGoldTarget">
                <option value="">Выбери игрока</option>
                ${playerOptions}
              </select>
            </div>
            <div class="filter-group">
              <label for="masterRoomGoldAmount">Сколько золота</label>
              <input id="masterRoomGoldAmount" type="number" min="1" step="1" placeholder="100" />
            </div>
          </div>
          <div class="filter-group" style="margin-top:8px;">
            <label for="masterRoomGoldReason">Причина</label>
            <input id="masterRoomGoldReason" type="text" placeholder="Награда за квест / лут / компенсация" />
          </div>
          <div class="modal-actions" style="margin-top:10px;">
            <button type="button" class="btn btn-warning" id="masterRoomGrantGoldBtn">Выдать золото</button>
          </div>

          <div class="profile-grid" style="margin-top:14px;">
            <div class="filter-group">
              <label for="masterRoomItemTarget">Кому выдать предмет</label>
              <select id="masterRoomItemTarget">
                <option value="">Выбери игрока</option>
                ${playerOptions}
              </select>
            </div>
            <div class="filter-group">
              <label for="masterRoomItemQty">Кол-во</label>
              <input id="masterRoomItemQty" type="number" min="1" step="1" value="1" />
            </div>
          </div>
          <div class="filter-group" style="margin-top:8px;">
            <label for="masterRoomItemName">Название предмета</label>
            <input id="masterRoomItemName" type="text" placeholder="Например: Амулет пепла" />
          </div>
          <div class="filter-group" style="margin-top:8px;">
            <label for="masterRoomItemReason">Причина</label>
            <input id="masterRoomItemReason" type="text" placeholder="Награда / выдача ГМа / тест" />
          </div>
          <div class="modal-actions" style="margin-top:10px;">
            <button type="button" class="btn btn-success" id="masterRoomGrantItemBtn">Выдать предмет</button>
          </div>
        </div>
      </div>

      <div class="collection-wrapper" style="margin-top:12px;">
        <div class="flex-between" style="align-items:center; gap:10px; flex-wrap:wrap;">
          <h4 style="margin:0;">Заметки стола</h4>
          <button type="button" class="btn btn-secondary" id="masterRoomToggleNotesBtn">
            ${MASTER_ROOM_STATE.ui.notesOpen ? "Скрыть" : "Показать"}
          </button>
        </div>

        <div id="masterRoomNotesWrap" style="${MASTER_ROOM_STATE.ui.notesOpen ? 'margin-top:10px;' : 'display:none;'}">
          <textarea id="masterRoomNotesTextarea" rows="5" placeholder="Секреты кампании, правила стола, доступы, напоминания...">${escapeHtml(table.notes || "")}</textarea>
          <div class="modal-actions" style="margin-top:10px;">
            <button type="button" class="btn btn-primary" id="masterRoomSaveNotesBtn">Сохранить заметки</button>
          </div>
        </div>
      </div>

      <div class="collection-wrapper" style="margin-top:12px;">
        <h4 style="margin-bottom:8px;">Журнал действий стола</h4>
        ${
          table.activity.length
            ? `
              <div style="display:grid; gap:8px;">
                ${table.activity
                  .map(
                    (entry) => `
                      <div class="collection-wrapper" style="padding:10px 12px;">
                        <div class="flex-between" style="align-items:flex-start; gap:10px; flex-wrap:wrap;">
                          <div style="min-width:0; flex:1 1 260px;">
                            <div style="font-weight:800; color:#f0f5f7;">
                              ${escapeHtml(typeIcon(entry.type))} ${escapeHtml(entry.title)}
                            </div>
                            ${entry.message ? `<div class="muted" style="margin-top:6px;">${escapeHtml(entry.message)}</div>` : ""}
                          </div>
                          <div class="muted" style="font-size:12px; text-align:right;">
                            ${escapeHtml(formatDateTime(entry.created_at))}
                            ${entry.actor ? `<br />${escapeHtml(entry.actor)}` : ""}
                          </div>
                        </div>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            `
            : `<div class="muted">Журнал пока пуст.</div>`
        }
      </div>
    </div>
  `;
}

function renderEmptyState() {
  return `
    <div class="cabinet-block">
      <h3 style="margin-bottom:8px;">🛡️ Master Room</h3>
      <div class="muted">
        Это отдельный ГМ-модуль для управления столами, составом партии, привязкой персонажей и журналом действий.
      </div>
    </div>
  `;
}

function renderPlayerLock() {
  return `
    <div class="cabinet-block">
      <h3 style="margin-bottom:8px;">🛡️ Master Room</h3>
      <div class="muted">
        Этот модуль сейчас открыт только для ГМа. Для игроков позже можно сделать облегчённый режим: выбор персонажа, вход по коду, просмотр разрешённых полей.
      </div>
    </div>
  `;
}

// ------------------------------------------------------------
// 🎨 MAIN RENDER
// ------------------------------------------------------------
export function renderMasterRoom() {
  const container = getSection("cabinet-masterroom");
  if (!container) return;

  if (!MASTER_ROOM_STATE.loaded) {
    container.innerHTML = renderEmptyState();
    return;
  }

  if (!isGm()) {
    container.innerHTML = renderPlayerLock();
    return;
  }

  const active = getActiveTable();

  container.innerHTML = `
    ${renderSummaryBar()}
    ${renderCreatePanel()}
    ${renderTablesList()}
    ${renderActiveTable(active)}
  `;

  bindMasterRoomActions();
}

// ------------------------------------------------------------
// 🔗 BINDINGS
// ------------------------------------------------------------
function bindMasterRoomActions() {
  const toggleCreateBtn = getEl("masterRoomToggleCreateBtn");
  if (toggleCreateBtn && toggleCreateBtn.dataset.bound !== "1") {
    toggleCreateBtn.dataset.bound = "1";
    toggleCreateBtn.addEventListener("click", () => {
      MASTER_ROOM_STATE.ui.createOpen = !MASTER_ROOM_STATE.ui.createOpen;
      renderMasterRoom();
    });
  }

  const createBtn = getEl("masterRoomCreateSubmitBtn");
  if (createBtn && createBtn.dataset.bound !== "1") {
    createBtn.dataset.bound = "1";
    createBtn.addEventListener("click", async () => {
      const title = trimText(getEl("masterRoomCreateTitle")?.value || "");
      const token = trimText(getEl("masterRoomCreateToken")?.value || "");
      const notes = trimText(getEl("masterRoomCreateNotes")?.value || "");

      if (!title) {
        showToast("Укажи название стола");
        return;
      }

      await createMasterTable({ title, token, notes });
    });
  }

  document.querySelectorAll("[data-master-room-select-table]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const tableId = btn.dataset.masterRoomSelectTable || "";
      selectMasterTable(tableId);
    });
  });

  document.querySelectorAll("[data-master-room-copy-token]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const tableId = btn.dataset.masterRoomCopyToken || "";
      const table = MASTER_ROOM_STATE.tables.find((entry) => entry.id === tableId);
      if (!table) return;

      try {
        await navigator.clipboard.writeText(table.token);
        showToast("Код стола скопирован");
      } catch {
        showToast(`Код стола: ${table.token}`);
      }
    });
  });

  document.querySelectorAll("[data-master-room-delete-table]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const tableId = btn.dataset.masterRoomDeleteTable || "";
      const table = MASTER_ROOM_STATE.tables.find((entry) => entry.id === tableId);
      if (!table) return;

      if (!confirm(`Удалить стол "${table.title}"?`)) return;
      await deleteMasterTable(tableId);
    });
  });

  const searchInput = getEl("masterRoomPlayerSearch");
  if (searchInput && searchInput.dataset.bound !== "1") {
    searchInput.dataset.bound = "1";
    searchInput.addEventListener("input", () => {
      MASTER_ROOM_STATE.searchQuery = searchInput.value || "";
      MASTER_ROOM_STATE.lastSearchResults = getKnownUserSearchResults(MASTER_ROOM_STATE.searchQuery);
      renderMasterRoom();
    });
  }

  document.querySelectorAll("[data-master-room-add-known-user]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const active = getActiveTable();
      if (!active) return;

      const userId = btn.dataset.masterRoomAddKnownUser || "";
      const user = MASTER_ROOM_STATE.knownUsers.find((entry) => String(entry.id) === String(userId));
      if (!user) return;

      await addMemberToTable(active.id, user);
    });
  });

  const manualAddBtn = getEl("masterRoomManualAddBtn");
  if (manualAddBtn && manualAddBtn.dataset.bound !== "1") {
    manualAddBtn.dataset.bound = "1";
    manualAddBtn.addEventListener("click", async () => {
      const active = getActiveTable();
      if (!active) return;

      const nickname = trimText(getEl("masterRoomManualNickname")?.value || "");
      const email = trimText(getEl("masterRoomManualEmail")?.value || "");

      await addMemberToTable(active.id, { nickname, email });

      const nicknameInput = getEl("masterRoomManualNickname");
      const emailInput = getEl("masterRoomManualEmail");
      if (nicknameInput) nicknameInput.value = "";
      if (emailInput) emailInput.value = "";
    });
  }

  document.querySelectorAll("[data-master-room-character-input]").forEach((input) => {
    if (input.dataset.bound === "1") return;
    input.dataset.bound = "1";
    input.addEventListener("input", () => {
      const memberId = input.dataset.masterRoomCharacterInput || "";
      MASTER_ROOM_STATE.ui.memberCharacterDrafts[memberId] = input.value || "";
    });
  });

  document.querySelectorAll("[data-master-room-save-character]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const active = getActiveTable();
      if (!active) return;

      const memberId = btn.dataset.masterRoomSaveCharacter || "";
      const draft = trimText(MASTER_ROOM_STATE.ui.memberCharacterDrafts[memberId] || "");
      await updateMemberCharacter(active.id, memberId, {
        selected_character_name: draft,
      });
    });
  });

  document.querySelectorAll("[data-master-room-use-lss]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const active = getActiveTable();
      if (!active) return;

      const memberId = btn.dataset.masterRoomUseLss || "";
      const lssName = getLssCharacterName();

      if (!lssName) {
        showToast("LSS-персонаж сейчас не загружен");
        return;
      }

      MASTER_ROOM_STATE.ui.memberCharacterDrafts[memberId] = lssName;
      await updateMemberCharacter(active.id, memberId, {
        selected_character_name: lssName,
      });
    });
  });

  document.querySelectorAll("[data-master-room-visibility]").forEach((select) => {
    if (select.dataset.bound === "1") return;
    select.dataset.bound = "1";
    select.addEventListener("change", async () => {
      const active = getActiveTable();
      if (!active) return;

      const memberId = select.dataset.masterRoomVisibility || "";
      const preset = select.value || "basic";
      await updateMemberVisibility(active.id, memberId, preset);
    });
  });

  document.querySelectorAll("[data-master-room-remove-member]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const active = getActiveTable();
      if (!active) return;

      const memberId = btn.dataset.masterRoomRemoveMember || "";
      const member = active.members.find((entry) => entry.id === memberId);
      if (!member) return;

      if (!confirm(`Удалить игрока "${member.nickname}" из стола?`)) return;
      await removeMemberFromTable(active.id, memberId);
    });
  });

  const addTraderBtn = getEl("masterRoomAddTraderBtn");
  if (addTraderBtn && addTraderBtn.dataset.bound !== "1") {
    addTraderBtn.dataset.bound = "1";
    addTraderBtn.addEventListener("click", async () => {
      const active = getActiveTable();
      if (!active) return;

      const traderName = trimText(getEl("masterRoomTraderInput")?.value || "");
      await addSharedTraderToTable(active.id, traderName);

      const input = getEl("masterRoomTraderInput");
      if (input) input.value = "";
    });
  }

  document.querySelectorAll("[data-master-room-remove-trader]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const active = getActiveTable();
      if (!active) return;

      const traderName = btn.dataset.masterRoomRemoveTrader || "";
      await removeSharedTraderFromTable(active.id, traderName);
    });
  });

  const grantGoldBtn = getEl("masterRoomGrantGoldBtn");
  if (grantGoldBtn && grantGoldBtn.dataset.bound !== "1") {
    grantGoldBtn.dataset.bound = "1";
    grantGoldBtn.addEventListener("click", async () => {
      const active = getActiveTable();
      if (!active) return;

      const memberId = trimText(getEl("masterRoomGoldTarget")?.value || "");
      const amount = Number(getEl("masterRoomGoldAmount")?.value || 0);
      const reason = trimText(getEl("masterRoomGoldReason")?.value || "");

      if (!memberId) {
        showToast("Выбери игрока");
        return;
      }

      await grantGoldToMember(active.id, memberId, amount, reason);
    });
  }

  const grantItemBtn = getEl("masterRoomGrantItemBtn");
  if (grantItemBtn && grantItemBtn.dataset.bound !== "1") {
    grantItemBtn.dataset.bound = "1";
    grantItemBtn.addEventListener("click", async () => {
      const active = getActiveTable();
      if (!active) return;

      const memberId = trimText(getEl("masterRoomItemTarget")?.value || "");
      const itemName = trimText(getEl("masterRoomItemName")?.value || "");
      const qty = Number(getEl("masterRoomItemQty")?.value || 1);
      const reason = trimText(getEl("masterRoomItemReason")?.value || "");

      if (!memberId) {
        showToast("Выбери игрока");
        return;
      }

      await grantItemToMember(active.id, memberId, itemName, qty, reason);
    });
  }

  const toggleNotesBtn = getEl("masterRoomToggleNotesBtn");
  if (toggleNotesBtn && toggleNotesBtn.dataset.bound !== "1") {
    toggleNotesBtn.dataset.bound = "1";
    toggleNotesBtn.addEventListener("click", () => {
      MASTER_ROOM_STATE.ui.notesOpen = !MASTER_ROOM_STATE.ui.notesOpen;
      renderMasterRoom();
    });
  }

  const saveNotesBtn = getEl("masterRoomSaveNotesBtn");
  if (saveNotesBtn && saveNotesBtn.dataset.bound !== "1") {
    saveNotesBtn.dataset.bound = "1";
    saveNotesBtn.addEventListener("click", async () => {
      const active = getActiveTable();
      if (!active) return;

      const notes = trimText(getEl("masterRoomNotesTextarea")?.value || "");
      await updateTableNotes(active.id, notes);
      showToast("Заметки стола сохранены");
    });
  }
}

// ------------------------------------------------------------
// 🚀 INIT
// ------------------------------------------------------------
export async function initMasterRoom() {
  await loadMasterRoom();
  renderMasterRoom();
}

// ------------------------------------------------------------
// 🌉 LEGACY BRIDGE
// ------------------------------------------------------------
window.masterRoomModule = {
  loadMasterRoom,
  renderMasterRoom,
  saveMasterRoom,
  initMasterRoom,
  getMasterRoomData,
  setMasterRoomData,
  clearMasterRoomData,
  createMasterTable,
  deleteMasterTable,
  selectMasterTable,
  addMemberToTable,
  removeMemberFromTable,
  updateMemberVisibility,
  updateMemberCharacter,
  grantGoldToMember,
  grantItemToMember,
  addSharedTraderToTable,
  removeSharedTraderFromTable,
};
