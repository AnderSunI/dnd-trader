// ============================================================
// frontend/js/api.js
// Чистый API-модуль
// - без самоподключения
// - без циклических импортов
// - терпим к локалке / серверной раздаче
// - совместим с текущим app.js
// ============================================================

// ------------------------------------------------------------
// 🌐 CONFIG
// ------------------------------------------------------------
const TOKEN_KEY = "token";
const API_BASE_KEY = "apiBase";

function getStoredApiBase() {
  try {
    return localStorage.getItem(API_BASE_KEY) || "";
  } catch {
    return "";
  }
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}

function detectDefaultApiBase() {
  const explicit =
    normalizeBaseUrl(window.__API_BASE__) ||
    normalizeBaseUrl(getStoredApiBase());

  if (explicit) return explicit;

  const protocol = String(window.location?.protocol || "").toLowerCase();
  const hostname = String(window.location?.hostname || "").toLowerCase();
  const port = String(window.location?.port || "");

  const isFile = protocol === "file:";
  const isLiveServer =
    port === "5500" ||
    port === "5501" ||
    port === "5502" ||
    hostname === "127.0.0.1" ||
    hostname === "localhost";

  if (isFile || isLiveServer) {
    return "http://127.0.0.1:8000";
  }

  return "";
}

export const API_BASE = detectDefaultApiBase();

export function setApiBase(nextBase) {
  const normalized = normalizeBaseUrl(nextBase);
  try {
    if (normalized) {
      localStorage.setItem(API_BASE_KEY, normalized);
    } else {
      localStorage.removeItem(API_BASE_KEY);
    }
  } catch (_) {}
}

export function getApiBase() {
  return API_BASE;
}

function withApiBase(url) {
  const raw = String(url || "").trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;

  const base = API_BASE;
  if (!base) return raw;

  return `${base}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

// ------------------------------------------------------------
// 🔐 AUTH HELPERS
// ------------------------------------------------------------
export function getAuthToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setAuthToken(token) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch (_) {}
}

export function isAuthenticated() {
  return Boolean(getAuthToken());
}

export function logoutUser() {
  setAuthToken("");
}

// ------------------------------------------------------------
// 🧰 CORE REQUEST
// ------------------------------------------------------------
function buildHeaders(extraHeaders = {}, body = undefined) {
  const headers = new Headers(extraHeaders || {});
  const token = getAuthToken();

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

async function parseResponse(response) {
  const text = await response.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractErrorMessage(payload, response) {
  if (typeof payload === "string" && payload.trim()) return payload;

  if (payload && typeof payload === "object") {
    return (
      payload.detail ||
      payload.message ||
      payload.error ||
      payload.msg ||
      `Ошибка запроса: ${response.status}`
    );
  }

  return `Ошибка запроса: ${response.status}`;
}

export async function apiRequest(url, options = {}) {
  const body = options.body;

  const response = await fetch(withApiBase(url), {
    ...options,
    headers: buildHeaders(options.headers, body),
  });

  const payload = await parseResponse(response);

  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, response));
  }

  return payload;
}

export async function apiGet(url) {
  return apiRequest(url, { method: "GET" });
}

export async function apiPost(url, data) {
  return apiRequest(url, {
    method: "POST",
    body: JSON.stringify(data ?? {}),
  });
}

export async function apiPut(url, data) {
  return apiRequest(url, {
    method: "PUT",
    body: JSON.stringify(data ?? {}),
  });
}

export async function apiPatch(url, data) {
  return apiRequest(url, {
    method: "PATCH",
    body: JSON.stringify(data ?? {}),
  });
}

export async function apiDelete(url) {
  return apiRequest(url, {
    method: "DELETE",
  });
}

// ------------------------------------------------------------
// 🔐 AUTH
// ------------------------------------------------------------
export async function loginUser(email, password) {
  const normalizedEmail = String(email || "").trim();
  const normalizedPassword = String(password || "");

  if (!normalizedEmail || !normalizedPassword) {
    throw new Error("Введите email и пароль");
  }

  const attempts = [
    () =>
      apiRequest(
        `/auth/login?email=${encodeURIComponent(normalizedEmail)}&password=${encodeURIComponent(normalizedPassword)}`,
        { method: "POST" }
      ),
    () =>
      apiPost("/auth/login", {
        email: normalizedEmail,
        password: normalizedPassword,
      }),
  ];

  let lastError = null;

  for (const attempt of attempts) {
    try {
      const payload = await attempt();

      const token =
        payload?.access_token ||
        payload?.token ||
        payload?.jwt ||
        payload?.data?.access_token ||
        "";

      if (token) {
        setAuthToken(token);
      }

      return payload;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Не удалось выполнить вход");
}

export async function registerUser(email, password) {
  const normalizedEmail = String(email || "").trim();
  const normalizedPassword = String(password || "");

  if (!normalizedEmail || !normalizedPassword) {
    throw new Error("Введите email и пароль");
  }

  const attempts = [
    () =>
      apiRequest(
        `/auth/register?email=${encodeURIComponent(normalizedEmail)}&password=${encodeURIComponent(normalizedPassword)}`,
        { method: "POST" }
      ),
    () =>
      apiPost("/auth/register", {
        email: normalizedEmail,
        password: normalizedPassword,
      }),
  ];

  let lastError = null;

  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Не удалось выполнить регистрацию");
}

export async function fetchMe() {
  const attempts = ["/auth/me", "/me", "/users/me"];

  for (const url of attempts) {
    try {
      const payload = await apiGet(url);
      if (payload && typeof payload === "object" && payload.user && typeof payload.user === "object") {
        return payload.user;
      }
      return payload;
    } catch (_) {}
  }

  throw new Error("Не удалось получить профиль пользователя");
}

export async function fetchProfile() {
  const payload = await apiGet("/profile/me");
  if (payload && typeof payload === "object" && payload.user && typeof payload.user === "object") {
    return payload.user;
  }
  return payload;
}

export async function updateProfile(data) {
  const payload = await apiPatch("/profile/me", data ?? {});
  if (payload && typeof payload === "object" && payload.user && typeof payload.user === "object") {
    return payload.user;
  }
  return payload;
}

export async function activateGmMode() {
  const payload = await apiPost("/gm/activate", {});
  if (payload && typeof payload === "object" && payload.user && typeof payload.user === "object") {
    return payload.user;
  }
  return payload;
}

export async function deactivateGmMode() {
  const payload = await apiPost("/gm/deactivate", {});
  if (payload && typeof payload === "object" && payload.user && typeof payload.user === "object") {
    return payload.user;
  }
  return payload;
}

// ------------------------------------------------------------
// 👤 ACCOUNT / SOCIAL
// ------------------------------------------------------------
export async function fetchAccount() {
  return apiGet("/account/me");
}

export async function updateAccount(data) {
  return apiPatch("/account/me", data ?? {});
}

export async function fetchAccountMedia() {
  return apiGet("/account/media");
}

export async function uploadAccountMedia(data) {
  return apiPost("/account/media/upload", data ?? {});
}

export async function setPrimaryAccountMedia(mediaId) {
  return apiPost(`/account/media/${encodeURIComponent(String(mediaId || ""))}/primary`, {});
}

export async function deleteAccountMedia(mediaId) {
  return apiDelete(`/account/media/${encodeURIComponent(String(mediaId || ""))}`);
}

export async function searchAccountUsers(query) {
  return apiGet(`/account/friends/search?q=${encodeURIComponent(String(query || "").trim())}`);
}

export async function fetchFriendsState() {
  return apiGet("/account/friends");
}

export async function sendFriendRequest(data) {
  return apiPost("/account/friends/requests", data ?? {});
}

export async function acceptFriendRequest(requestId) {
  return apiPost(`/account/friends/requests/${Number(requestId)}/accept`, {});
}

export async function rejectFriendRequest(requestId) {
  return apiPost(`/account/friends/requests/${Number(requestId)}/reject`, {});
}

export async function cancelFriendRequest(requestId) {
  return apiDelete(`/account/friends/requests/${Number(requestId)}`);
}

export async function removeFriend(friendUserId) {
  return apiDelete(`/account/friends/${Number(friendUserId)}`);
}

export async function fetchDirectConversations() {
  return apiGet("/account/chat/conversations");
}

export async function fetchDirectMessages(conversationId) {
  return apiGet(`/account/chat/conversations/${Number(conversationId)}/messages`);
}

export async function sendDirectMessage(friendUserId, body) {
  return apiPost(`/account/chat/direct/${Number(friendUserId)}/messages`, {
    body: String(body || ""),
  });
}

export async function markConversationRead(conversationId) {
  return apiPost(`/account/chat/conversations/${Number(conversationId)}/read`, {});
}

export async function transferToPlayer(data) {
  return apiPost("/account/trade/transfer", data ?? {});
}

// ------------------------------------------------------------
// 🏪 TRADERS
// ------------------------------------------------------------
export async function fetchTraders() {
  return apiGet("/traders");
}

export async function fetchTraderById(traderId) {
  return apiGet(`/traders/${Number(traderId)}`);
}

export async function restockTrader(traderId, { reroll = false } = {}) {
  const id = Number(traderId);
  const payload = { reroll: Boolean(reroll) };

  // Держим fallback-маршрут для совместимости старых стендов,
  // где мог использоваться /trader/{id}/restock вместо /traders/{id}/restock.
  const attempts = [
    () => apiPost(`/traders/${id}/restock`, payload),
    () => apiPost(`/trader/${id}/restock`, payload),
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Не удалось выполнить restock торговца");
}

// ------------------------------------------------------------
// 🎒 INVENTORY / TRADE
// ------------------------------------------------------------
export async function fetchPlayerInventory(traderId = null) {
  if (traderId !== null && traderId !== undefined && traderId !== "") {
    return apiGet(
      `/inventory/me?trader_id=${encodeURIComponent(String(traderId))}`
    );
  }

  return apiGet("/inventory/me");
}

export async function buyItem(itemId, traderId, quantity = 1) {
  return apiPost("/inventory/buy", {
    trader_id: Number(traderId),
    item_id: Number(itemId),
    quantity: Math.max(1, Number(quantity || 1)),
  });
}

export async function sellItem(itemId, traderId, quantity = 1) {
  return apiPost("/inventory/sell", {
    trader_id: Number(traderId),
    item_id: Number(itemId),
    quantity: Math.max(1, Number(quantity || 1)),
  });
}

// ------------------------------------------------------------
// 📖 LSS / PROFILE
// ------------------------------------------------------------
export async function fetchPlayerProfile() {
  const attempts = [
    "/player/profile",
    "/player/lss",
    "/lss/me",
    "/character/me",
    "/profile/me",
  ];

  for (const url of attempts) {
    try {
      return await apiGet(url);
    } catch (_) {}
  }

  return {};
}

// ------------------------------------------------------------
// 🧭 QUESTS
// ------------------------------------------------------------
export async function fetchPlayerQuests() {
  const attempts = ["/player/quests", "/quests/me", "/quests"];

  for (const url of attempts) {
    try {
      return await apiGet(url);
    } catch (_) {}
  }

  return { quests: [] };
}

// ------------------------------------------------------------
// 📝 NOTES
// ------------------------------------------------------------
export async function fetchPlayerNotes() {
  const attempts = ["/player/notes", "/notes/me", "/notes"];

  for (const url of attempts) {
    try {
      return await apiGet(url);
    } catch (_) {}
  }

  return {
    notes: "",
    history: [],
  };
}

export async function savePlayerNotes(notes) {
  const payload = {
    notes: String(notes ?? ""),
    player_notes: String(notes ?? ""),
  };

  const attempts = [
    () => apiPost("/player/notes", payload),
    () => apiPut("/player/notes", payload),
    () => apiPatch("/player/notes", payload),
    () => apiPost("/notes/me", payload),
    () => apiPut("/notes/me", payload),
    () => apiPatch("/notes/me", payload),
    () => apiPost("/notes", payload),
    () => apiPut("/notes", payload),
    () => apiPatch("/notes", payload),
  ];

  let lastError = null;

  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Не удалось сохранить заметки");
}

// ------------------------------------------------------------
// 🗺 MAP
// ------------------------------------------------------------
export async function fetchWorldMap() {
  const attempts = [
    "/world/map",
    "/player/map",
    "/map",
    "/maps/current",
    "/player/maps",
    "/maps/me",
    "/maps",
  ];

  for (const url of attempts) {
    try {
      return await apiGet(url);
    } catch (_) {}
  }

  return {};
}

// ------------------------------------------------------------
// 🌉 LEGACY BRIDGE
// ------------------------------------------------------------
window.apiModule = {
  API_BASE,
  getApiBase,
  setApiBase,
  getAuthToken,
  setAuthToken,
  isAuthenticated,
  logoutUser,
  apiRequest,
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  loginUser,
  registerUser,
  fetchMe,
  fetchProfile,
  updateProfile,
  activateGmMode,
  deactivateGmMode,
  fetchAccount,
  updateAccount,
  fetchAccountMedia,
  uploadAccountMedia,
  setPrimaryAccountMedia,
  deleteAccountMedia,
  searchAccountUsers,
  fetchFriendsState,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  removeFriend,
  fetchDirectConversations,
  fetchDirectMessages,
  sendDirectMessage,
  markConversationRead,
  transferToPlayer,
  apiDelete,
  fetchTraders,
  fetchTraderById,
  restockTrader,
  fetchPlayerInventory,
  buyItem,
  sellItem,
  fetchPlayerProfile,
  fetchPlayerQuests,
  fetchPlayerNotes,
  savePlayerNotes,
  fetchWorldMap,
};
