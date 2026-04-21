// ============================================================
// frontend/js/shared.js
// Общие утилиты для кабинетных модулей
// - DOM helpers
// - auth headers
// - localStorage helpers
// - soft API wrappers
// - date / text formatting
// ============================================================

export function getEl(id) {
  return document.getElementById(id);
}

export function getSection(id) {
  return document.getElementById(id);
}

export function getToken() {
  return localStorage.getItem("token") || "";
}

export function getHeaders(withJson = false) {
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

export function showToast(message) {
  if (typeof window.showToast === "function") {
    window.showToast(message);
    return;
  }

  console.log(message);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function safeText(value, fallback = "") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

export function trimText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function normalizeRole(role) {
  const raw = String(role || "").trim().toLowerCase();
  if (raw === "gm" || raw === "admin") return "gm";
  return "player";
}

export function getCurrentRole() {
  return normalizeRole(
    window.__appUserRole ||
      window.__userRole ||
      window.__appUser?.role ||
      document.body?.dataset?.role ||
      "player"
  );
}

export function getCurrentUser() {
  return window.__appUser || null;
}

export function buildUserScopedStorageKey(prefix) {
  const user = getCurrentUser();
  const userKey =
    user?.email ||
    user?.id ||
    (getToken() ? "auth-user" : "guest");

  return `${prefix}${userKey}`;
}

export function readLocalJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = tryParseJson(raw);
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function writeLocalJson(key, payload) {
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (_) {}
}

export async function apiGet(urls) {
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

export async function apiWrite(urls, body, methods = ["POST", "PUT", "PATCH"]) {
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

export function normalizeDateInput(value) {
  if (!value && value !== 0) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const str = String(value).trim();
  if (!str) return null;

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const asNumber = Number(str);
  if (Number.isFinite(asNumber)) {
    const date = new Date(asNumber);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

export function toIsoStringSafe(value, fallback = Date.now()) {
  const normalized = normalizeDateInput(value);
  if (normalized) return normalized.toISOString();

  const fb = normalizeDateInput(fallback);
  return fb ? fb.toISOString() : new Date().toISOString();
}

export function formatTime(value) {
  const date = normalizeDateInput(value);
  if (!date) return "—";

  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTime(value) {
  const date = normalizeDateInput(value);
  if (!date) return "—";

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
