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
const AUTH_INVALID_EVENT = "dnd:auth:invalid";
const AUTH_EXPIRED_MESSAGE = "Сессия истекла. Войдите заново.";

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
  const explicit = normalizeBaseUrl(window.__API_BASE__);
  if (explicit) return explicit;

  const protocol = String(window.location?.protocol || "").toLowerCase();
  const hostname = String(window.location?.hostname || "").toLowerCase();
  const port = String(window.location?.port || "");

  const isFile = protocol === "file:";
  const isBackendServedFrontend =
    (protocol === "http:" || protocol === "https:") &&
    (hostname === "127.0.0.1" || hostname === "localhost") &&
    port === "8000";
  const isLiveServer =
    port === "5500" ||
    port === "5501" ||
    port === "5502";

  if (isBackendServedFrontend) {
    return "";
  }

  const stored = normalizeBaseUrl(getStoredApiBase());
  if (stored) return stored;

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

function clearStoredAuthSession(reason = "auth-invalid") {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem("user");
  } catch (_) {}

  try {
    window.dispatchEvent(
      new CustomEvent(AUTH_INVALID_EVENT, {
        detail: {
          reason,
          message: AUTH_EXPIRED_MESSAGE,
        },
      })
    );
  } catch (_) {}
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
  const isAuthEndpoint = /^\/?auth\/(login|register|token)\b/i.test(String(url || ""));
  const hadAuthToken = Boolean(getAuthToken()) && !isAuthEndpoint;

  const response = await fetch(withApiBase(url), {
    ...options,
    headers: buildHeaders(options.headers, body),
  });

  const payload = await parseResponse(response);

  if (!response.ok) {
    const message = extractErrorMessage(payload, response);
    if (response.status === 401 && hadAuthToken) {
      clearStoredAuthSession(message);
      throw new Error(AUTH_EXPIRED_MESSAGE);
    }
    throw new Error(message);
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

  const payload = await apiPost("/auth/login", {
    email: normalizedEmail,
    password: normalizedPassword,
  });

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
}

export async function registerUser(email, password) {
  const normalizedEmail = String(email || "").trim();
  const normalizedPassword = String(password || "");

  if (!normalizedEmail || !normalizedPassword) {
    throw new Error("Введите email и пароль");
  }

  return apiPost("/auth/register", {
    email: normalizedEmail,
    password: normalizedPassword,
  });
}

export async function fetchMe() {
  const payload = await apiGet("/auth/me");
  if (payload && typeof payload === "object" && payload.user && typeof payload.user === "object") {
    return payload.user;
  }
  return payload;
}

export async function fetchProfile() {
  const payload = await apiGet("/auth/me");
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

export async function saveAccountCharacter(data) {
  return apiPost("/account/characters", data ?? {});
}

export async function updateAccountCharacter(characterId, data) {
  return apiPatch(`/account/characters/${Number(characterId)}`, data ?? {});
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


function getClientMoneyCpTotal() {
  try {
    const direct = Number(window.__appMoneyCpTotal);
    if (Number.isFinite(direct) && direct >= 0) return Math.floor(direct);

    const state = window.__appState || {};
    const userMoney = Number(state?.user?.money_cp_total);
    if (Number.isFinite(userMoney) && userMoney >= 0) return Math.floor(userMoney);

    const guestMoney = Number(state?.guestMoneyCp);
    if (Number.isFinite(guestMoney) && guestMoney >= 0) return Math.floor(guestMoney);

    const bridgeUserMoney = Number(window.__appUser?.money_cp_total);
    if (Number.isFinite(bridgeUserMoney) && bridgeUserMoney >= 0) return Math.floor(bridgeUserMoney);
  } catch (_) {}

  return null;
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
  const payload = {
    trader_id: Number(traderId),
    item_id: Number(itemId),
    quantity: Math.max(1, Number(quantity || 1)),
  };

  const clientMoneyCpTotal = getClientMoneyCpTotal();
  if (clientMoneyCpTotal !== null) {
    payload.client_money_cp_total = clientMoneyCpTotal;
  }

  return apiPost("/inventory/buy", payload);
}

export async function sellItem(itemId, traderId, quantity = 1) {
  return apiPost("/inventory/sell", {
    trader_id: Number(traderId),
    item_id: Number(itemId),
    quantity: Math.max(1, Number(quantity || 1)),
  });
}

export async function updatePlayerMoney(moneyCpTotal) {
  const cp = Math.max(0, Math.floor(Number(moneyCpTotal || 0)));
  const payload = { money_cp_total: cp };

  const attempts = [
    () => apiPost("/inventory/money", payload),
    () => apiPatch("/inventory/money", payload),
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Не удалось синхронизировать золото");
}

// ------------------------------------------------------------
// 📖 LSS / PROFILE
// ------------------------------------------------------------
export async function fetchPlayerProfile() {
  return apiGet("/player/profile");
}

// ------------------------------------------------------------
// 🧭 QUESTS
// ------------------------------------------------------------
export async function fetchPlayerQuests() {
  return apiGet("/player/quests");
}

// ------------------------------------------------------------
// 📝 NOTES
// ------------------------------------------------------------
export async function fetchPlayerNotes() {
  return apiGet("/player/notes");
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
  return apiGet("/world/map");
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
  updatePlayerMoney,
  fetchPlayerProfile,
  fetchPlayerQuests,
  fetchPlayerNotes,
  savePlayerNotes,
  fetchWorldMap,
};
