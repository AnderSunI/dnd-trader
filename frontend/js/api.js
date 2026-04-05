// frontend/js/api.js

const API_BASE = "";

// ============================================================
// 🔐 TOKEN STORAGE
// ============================================================

const TOKEN_KEY = "dnd_trader_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (!token) return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated() {
  return Boolean(getToken());
}

// ============================================================
// 🧰 BASE REQUEST
// ============================================================

async function request(path, options = {}) {
  const token = getToken();

  const headers = {
    ...(options.headers || {}),
  };

  // Если body не FormData — ставим JSON
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  let data = null;

  try {
    data = await response.json();
  } catch (e) {
    data = null;
  }

  if (!response.ok) {
    const message =
      data?.detail ||
      data?.message ||
      `HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
}

// ============================================================
// 🔐 AUTH
// ============================================================

export async function registerUser(email, password) {
  const data = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
    }),
  });

  if (data?.access_token) {
    setToken(data.access_token);
  }

  return data;
}

export async function loginUser(email, password) {
  const formData = new URLSearchParams();
  formData.append("username", email);
  formData.append("password", password);

  const response = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  let data = null;

  try {
    data = await response.json();
  } catch (e) {
    data = null;
  }

  if (!response.ok) {
    const message =
      data?.detail ||
      data?.message ||
      `HTTP ${response.status}`;
    throw new Error(message);
  }

  if (data?.access_token) {
    setToken(data.access_token);
  }

  return data;
}

export async function fetchMe() {
  return request("/auth/me");
}

export function logoutUser() {
  clearToken();
}

// ============================================================
// 🧑‍💼 TRADERS
// ============================================================

export async function fetchTraders() {
  return request("/traders");
}

// ============================================================
// 🎒 INVENTORY
// ============================================================

export async function fetchPlayerInventory(traderId = null) {
  const query = traderId ? `?trader_id=${encodeURIComponent(traderId)}` : "";
  return request(`/inventory/player${query}`);
}

export async function buyItem(itemId, traderId, quantity = 1) {
  const query = new URLSearchParams({
    item_id: String(itemId),
    trader_id: String(traderId),
    quantity: String(quantity),
  });

  return request(`/inventory/buy?${query.toString()}`, {
    method: "POST",
  });
}

export async function sellItem(itemId, traderId, quantity = 1) {
  const query = new URLSearchParams({
    item_id: String(itemId),
    trader_id: String(traderId),
    quantity: String(quantity),
  });

  return request(`/inventory/sell?${query.toString()}`, {
    method: "POST",
  });
}

// ============================================================
// 🔧 ADMIN
// ============================================================

export async function adminReset() {
  return request("/admin/reset", {
    method: "POST",
  });
}

export async function adminRelinkItems() {
  return request("/admin/relink-items", {
    method: "POST",
  });
}

export async function fetchSeedPreview() {
  return request("/admin/seed-preview");
}