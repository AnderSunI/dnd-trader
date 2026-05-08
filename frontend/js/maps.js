// ============================================================
// frontend/js/maps.js
// Карта внутри кабинета
// - список карт
// - выбор активной карты
// - загрузка изображения карты
// - локальные маркеры
// - zoom / rotate / reset
// - drag / pan мышью
// - центрированная карта
// - инструменты снизу
// - редактор меток: имя + цвет
// - local fallback + попытка API
// ============================================================

import { state } from "./state.js";

// ------------------------------------------------------------
// 🌐 STATE
// ------------------------------------------------------------
const MAPS_STATE = {
  loaded: false,
  source: "empty",
  role: "player",

  maps: [],
  activeMapId: null,

  ui: {
    createOpen: false,
    selectedMarkerId: null,
    activeFilter: "all",
    searchQuery: "",
    pendingMarkerLabel: "",
    pendingMarkerKind: "marker",
    pendingMarkerColor: "#98dfe3",
    fullscreen: false,
  },

  view: {
    zoom: 1,
    rotation: 0,
    panX: 0,
    panY: 0,
    markerMode: false,

    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragOriginX: 0,
    dragOriginY: 0,
    suppressClick: false,

    activePointerId: null,
    dragMode: "",
    dragMarkerId: null,
    dragMarkerStartX: 0,
    dragMarkerStartY: 0,
    dragMarkerPreviewX: null,
    dragMarkerPreviewY: null,
  },
};

// ------------------------------------------------------------
// 🧰 HELPERS
// ------------------------------------------------------------
function getEl(id) {
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

function makeId(prefix = "map") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

function formatDate(value) {
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

function clampPercent(value) {
  return Math.max(0, Math.min(100, safeNumber(value, 50)));
}

function normalizeImageUrl(url) {
  const raw = safeText(url, "").trim();
  if (!raw) return "";

  if (
    raw.startsWith("http://") ||
    raw.startsWith("https://") ||
    raw.startsWith("data:image/") ||
    raw.startsWith("blob:") ||
    raw.startsWith("file:")
  ) {
    return raw;
  }

  if (raw.startsWith("/")) return raw;
  if (raw.startsWith("static/")) return `/${raw}`;

  return raw;
}

function emitMapHistory(action, payload = {}) {
  try {
    window.dispatchEvent(
      new CustomEvent("dnd:history:add", {
        detail: {
          scope: "map",
          action,
          created_at: new Date().toISOString(),
          ...payload,
        },
      })
    );
  } catch (_) {}
}

function isGm() {
  return MAPS_STATE.role === "gm";
}

function getStorageKey() {
  const user = getCurrentUser();
  const userKey =
    user?.email ||
    user?.id ||
    (getToken() ? "auth-user" : "guest");

  return `dnd_trader_maps_${userKey}`;
}

function saveLocalMaps(payload) {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(payload));
  } catch (_) {}
}

function loadLocalMaps() {
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

async function readFileAsDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать файл карты"));
    reader.readAsDataURL(file);
  });
}

// ------------------------------------------------------------
// 🗺️ NORMALIZATION
// ------------------------------------------------------------

function normalizeMarkerKind(value, fallback = "event") {
  const raw = String(value || fallback || "event").trim().toLowerCase();
  const aliases = {
    city: "city",
    town: "city",
    settlement: "city",
    город: "city",
    trader: "trader",
    merchant: "trader",
    торговец: "trader",
    quest: "quest",
    квест: "quest",
    задание: "quest",
    camp: "camp",
    лагерь: "camp",
    dungeon: "dungeon",
    подземелье: "dungeon",
    ruin: "dungeon",
    event: "event",
    событие: "event",
    marker: "marker",
    метка: "marker",
  };
  return aliases[raw] || (MAP_CATEGORY_FILTERS.some(([key]) => key === raw) ? raw : fallback || "event");
}

function normalizeStringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (entry && typeof entry === "object") {
          return safeText(entry.name || entry.title || entry.label || entry.text || "", "").trim();
        }
        return safeText(entry, "").trim();
      })
      .filter(Boolean);
  }
  return String(value)
    .split(/[;,\n\r]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function serializeStringList(list) {
  return (Array.isArray(list) ? list : [])
    .map((entry) => safeText(entry, "").trim())
    .filter(Boolean)
    .join(", ");
}
function normalizeMarker(marker, index = 0) {
  if (!marker || typeof marker !== "object") {
    return {
      id: makeId(`marker_${index}`),
      x: 50,
      y: 50,
      label: safeText(marker, "Метка"),
      color: "#98dfe3",
      kind: "marker",
      description: "",
      area: "",
      threat: "Низкий",
      reputation: "Неизвестно",
      traders: [],
      quests: [],
      events: [],
      notes: "",
    };
  }

  const kind = normalizeMarkerKind(marker.kind || marker.type || marker.category, "marker");

  return {
    id: marker.id || makeId(`marker_${index}`),
    x: clampPercent(marker.x ?? 50),
    y: clampPercent(marker.y ?? 50),
    label: safeText(marker.label || marker.name || marker.title, "Метка"),
    color: safeText(marker.color, "#98dfe3") || "#98dfe3",
    kind,
    type: kind,
    description: safeText(marker.description || marker.text || marker.note, ""),
    area: safeText(marker.area || marker.region || marker.location || ""),
    threat: safeText(marker.threat || marker.danger || "Низкий"),
    reputation: safeText(marker.reputation || marker.reputation_label || "Неизвестно"),
    traders: normalizeStringList(marker.traders || marker.merchants || marker.vendors),
    quests: normalizeStringList(marker.quests || marker.tasks),
    events: normalizeStringList(marker.events),
    notes: safeText(marker.notes || marker.gm_notes || ""),
  };
}

function normalizeMapItem(item, index = 0) {
  if (!item || typeof item !== "object") {
    return {
      id: makeId(`map_${index}`),
      name: `Карта ${index + 1}`,
      description: "",
      image: "",
      markers: [],
      created_at: normalizeDate(Date.now() - index * 1000),
      updated_at: normalizeDate(Date.now() - index * 1000),
    };
  }

  return {
    id: item.id || item._id || item.uuid || makeId(`map_${index}`),
    name: safeText(item.name || item.title, `Карта ${index + 1}`),
    description: safeText(item.description || item.text || "", ""),
    image: normalizeImageUrl(item.image || item.imageUrl || item.src || ""),
    markers: Array.isArray(item.markers)
      ? item.markers.map((marker, markerIndex) => normalizeMarker(marker, markerIndex))
      : [],
    created_at: normalizeDate(item.created_at || item.createdAt || Date.now() - index * 1000),
    updated_at: normalizeDate(item.updated_at || item.updatedAt || Date.now() - index * 1000),
  };
}

function normalizeMapList(list) {
  return (Array.isArray(list) ? list : []).map((item, index) =>
    normalizeMapItem(item, index)
  );
}

function buildDefaultMap() {
  return normalizeMapItem({
    id: "default_world_map",
    name: "Карта мира",
    description: "Долина Дессарин",
    image: "",
    markers: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, 0);
}

function getActiveMap() {
  return MAPS_STATE.maps.find((map) => map.id === MAPS_STATE.activeMapId) || null;
}

function getSelectedMarker() {
  const active = getActiveMap();
  if (!active) return null;
  return (
    active.markers.find((marker) => marker.id === MAPS_STATE.ui.selectedMarkerId) ||
    null
  );
}

function getSelectedDisplayMarker(active = getActiveMap(), markers = null) {
  const real = getSelectedMarker();
  if (real) return real;
  const displayMarkers = markers || getDisplayMarkers(active);
  return displayMarkers.find((marker) => marker.id === MAPS_STATE.ui.selectedMarkerId) || displayMarkers[0] || null;
}

function isFallbackMarker(marker) {
  return String(marker?.id || "").startsWith("fallback_");
}

function ensureSelectedMarkerIsValid() {
  const active = getActiveMap();
  if (!active) {
    MAPS_STATE.ui.selectedMarkerId = null;
    return;
  }

  if (
    MAPS_STATE.ui.selectedMarkerId &&
    active.markers.some((marker) => marker.id === MAPS_STATE.ui.selectedMarkerId)
  ) {
    return;
  }

  MAPS_STATE.ui.selectedMarkerId = active.markers[0]?.id || null;
}

function syncToSharedState() {
  const active = getActiveMap();

  state.map = {
    ...(state.map || {}),
    maps: MAPS_STATE.maps,
    activeMapId: MAPS_STATE.activeMapId,
    markers: active?.markers || [],
    zoom: MAPS_STATE.view.zoom,
    rotation: MAPS_STATE.view.rotation,
    panX: MAPS_STATE.view.panX,
    panY: MAPS_STATE.view.panY,
    markerMode: MAPS_STATE.view.markerMode,
    selectedMarkerId: MAPS_STATE.ui.selectedMarkerId,
    activeFilter: MAPS_STATE.ui.activeFilter,
    searchQuery: MAPS_STATE.ui.searchQuery,
    activeLayer: "world",
  };
}

// ------------------------------------------------------------
// 📥 LOAD
// ------------------------------------------------------------
function tryLoadFromWindow() {
  const candidates = [
    window.__MAPS_DATA__,
    window.__mapsData,
    window.__PLAYER_MAPS__,
    window.__playerMaps,
  ];

  for (const candidate of candidates) {
    if (candidate) return candidate;
  }

  return null;
}

export async function loadMapData() {
  MAPS_STATE.role = getCurrentRole();

  let data = tryLoadFromWindow();
  let source = "window";

  if (!data) {
    data = loadLocalMaps();
    source = "local";
  }

  let maps = [];

  if (Array.isArray(data)) {
    maps = data;
  } else if (Array.isArray(data?.maps)) {
    maps = data.maps;
  } else if (Array.isArray(data?.items)) {
    maps = data.items;
  }

  MAPS_STATE.maps = normalizeMapList(maps);
  if (!MAPS_STATE.maps.length) {
    MAPS_STATE.maps = [buildDefaultMap()];
    source = "default";
  }
  MAPS_STATE.loaded = true;
  MAPS_STATE.source = MAPS_STATE.maps.length ? source : "empty";
  MAPS_STATE.activeMapId = MAPS_STATE.maps[0]?.id || null;

  ensureSelectedMarkerIsValid();
  syncToSharedState();
  renderMaps();

  return MAPS_STATE.maps;
}

// ------------------------------------------------------------
// 💾 SAVE
// ------------------------------------------------------------
export async function saveMapData() {
  saveLocalMaps({
    maps: MAPS_STATE.maps,
  });

  MAPS_STATE.source = "local";
  syncToSharedState();
  return true;
}

// ------------------------------------------------------------
// ➕ CRUD
// ------------------------------------------------------------
export async function createMapEntry(payload) {
  const item = normalizeMapItem({
    ...payload,
    id: makeId("map"),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  MAPS_STATE.maps = [item, ...MAPS_STATE.maps];
  MAPS_STATE.activeMapId = item.id;
  MAPS_STATE.ui.createOpen = false;
  resetMapView(false);
  ensureSelectedMarkerIsValid();

  await saveMapData();
  renderMaps();
  emitMapHistory("map_create", { title: item.name, mapId: item.id });
  showToast("Карта добавлена");
}

export async function deleteMapEntry(mapId) {
  const current = getActiveMap();
  const deletingActive = current?.id === mapId;
  const deletingMap = MAPS_STATE.maps.find((map) => map.id === mapId);

  MAPS_STATE.maps = MAPS_STATE.maps.filter((map) => map.id !== mapId);

  if (deletingActive) {
    MAPS_STATE.activeMapId = MAPS_STATE.maps[0]?.id || null;
    resetMapView(false);
  }

  ensureSelectedMarkerIsValid();
  await saveMapData();
  renderMaps();

  emitMapHistory("map_delete", {
    title: deletingMap?.name || "Карта",
    mapId,
  });

  showToast("Карта удалена");
}

export function selectMap(mapId) {
  MAPS_STATE.activeMapId = mapId;
  resetMapView(false);
  ensureSelectedMarkerIsValid();
  syncToSharedState();
  renderMaps();
}

function patchActiveMap(patchFn) {
  const active = getActiveMap();
  if (!active) return null;

  let updatedMap = null;

  MAPS_STATE.maps = MAPS_STATE.maps.map((map) => {
    if (map.id !== active.id) return map;
    updatedMap = normalizeMapItem(
      {
        ...patchFn(map),
        updated_at: new Date().toISOString(),
      },
      0
    );
    return updatedMap;
  });

  ensureSelectedMarkerIsValid();
  syncToSharedState();
  return updatedMap;
}

export async function addMarkerToActiveMap(marker) {
  const active = getActiveMap();
  if (!active) return null;

  const markerItem = normalizeMarker({
    ...marker,
    id: makeId("marker"),
  });

  patchActiveMap((map) => ({
    ...map,
    markers: [...map.markers, markerItem],
  }));

  MAPS_STATE.ui.selectedMarkerId = markerItem.id;

  await saveMapData();
  renderMaps();

  emitMapHistory("marker_create", {
    title: markerItem.label,
    mapId: active.id,
    markerId: markerItem.id,
  });

  return markerItem;
}

export async function updateMarker(mapId, markerId, patch) {
  let nextMarker = null;

  MAPS_STATE.maps = MAPS_STATE.maps.map((map) => {
    if (map.id !== mapId) return map;

    return {
      ...map,
      markers: map.markers.map((marker) => {
        if (marker.id !== markerId) return marker;
        nextMarker = normalizeMarker(
          {
            ...marker,
            ...patch,
          },
          0
        );
        return nextMarker;
      }),
      updated_at: new Date().toISOString(),
    };
  });

  await saveMapData();
  renderMaps();

  if (nextMarker) {
    emitMapHistory("marker_update", {
      title: nextMarker.label,
      mapId,
      markerId,
    });
  }

  return nextMarker;
}

export async function updateMarkerLabel(mapId, markerId, nextLabel) {
  return updateMarker(mapId, markerId, {
    label: safeText(nextLabel, "Метка"),
  });
}

export async function updateMarkerColor(mapId, markerId, nextColor) {
  return updateMarker(mapId, markerId, {
    color: safeText(nextColor, "#98dfe3") || "#98dfe3",
  });
}

export async function deleteMarker(mapId, markerId) {
  let removedMarker = null;

  MAPS_STATE.maps = MAPS_STATE.maps.map((map) => {
    if (map.id !== mapId) return map;

    removedMarker = map.markers.find((marker) => marker.id === markerId) || null;

    return {
      ...map,
      markers: map.markers.filter((marker) => marker.id !== markerId),
      updated_at: new Date().toISOString(),
    };
  });

  if (MAPS_STATE.ui.selectedMarkerId === markerId) {
    MAPS_STATE.ui.selectedMarkerId = null;
  }

  ensureSelectedMarkerIsValid();
  await saveMapData();
  renderMaps();

  emitMapHistory("marker_delete", {
    title: removedMarker?.label || "Метка",
    mapId,
    markerId,
  });
}

export async function clearAllMarkers(mapId) {
  MAPS_STATE.maps = MAPS_STATE.maps.map((map) => {
    if (map.id !== mapId) return map;

    return {
      ...map,
      markers: [],
      updated_at: new Date().toISOString(),
    };
  });

  MAPS_STATE.ui.selectedMarkerId = null;
  await saveMapData();
  renderMaps();

  emitMapHistory("marker_clear_all", {
    title: "Очистка меток",
    mapId,
  });
}

// ------------------------------------------------------------
// 🔍 VIEW
// ------------------------------------------------------------
function clampZoom(value) {
  return Math.max(0.4, Math.min(4, value));
}

export function zoomMap(delta) {
  MAPS_STATE.view.zoom = clampZoom(MAPS_STATE.view.zoom + delta);
  syncToSharedState();
  applyMapTransform();
  updateViewportStatus();
}

export function setMapRotation(value = 0) {
  const next = Math.round(safeNumber(value, 0));
  MAPS_STATE.view.rotation = ((next % 360) + 360) % 360;
  syncToSharedState();
  applyMapTransform();
  updateViewportStatus();
}

function rotateMap(delta = 90) {
  setMapRotation(MAPS_STATE.view.rotation + delta);
}

export function resetMapView(rerender = true) {
  MAPS_STATE.view.zoom = 1;
  MAPS_STATE.view.rotation = 0;
  MAPS_STATE.view.panX = 0;
  MAPS_STATE.view.panY = 0;
  MAPS_STATE.view.markerMode = false;

  MAPS_STATE.view.isDragging = false;
  MAPS_STATE.view.dragStartX = 0;
  MAPS_STATE.view.dragStartY = 0;
  MAPS_STATE.view.dragOriginX = 0;
  MAPS_STATE.view.dragOriginY = 0;
  MAPS_STATE.view.suppressClick = false;
  MAPS_STATE.view.activePointerId = null;
  MAPS_STATE.view.dragMode = "";
  MAPS_STATE.view.dragMarkerId = null;
  MAPS_STATE.view.dragMarkerStartX = 0;
  MAPS_STATE.view.dragMarkerStartY = 0;
  MAPS_STATE.view.dragMarkerPreviewX = null;
  MAPS_STATE.view.dragMarkerPreviewY = null;

  syncToSharedState();

  if (rerender) {
    renderMaps();
  } else {
    applyMapTransform();
    updateViewportStatus();
  }
}

export function toggleMarkerMode(forceValue = null) {
  MAPS_STATE.view.markerMode =
    forceValue === null
      ? !MAPS_STATE.view.markerMode
      : Boolean(forceValue);

  renderMaps();
}

function applyMapTransform() {
  const layer = getEl("mapTransformLayer");
  const viewport = getEl("mapStageViewport");
  if (!layer || !viewport) return;

  layer.style.transform = `
    translate(${MAPS_STATE.view.panX}px, ${MAPS_STATE.view.panY}px)
    scale(${MAPS_STATE.view.zoom})
    rotate(${MAPS_STATE.view.rotation}deg)
  `.replace(/\s+/g, " ").trim();

  viewport.style.setProperty("--map-compass-rotation", `${MAPS_STATE.view.rotation}deg`);

  if (MAPS_STATE.view.markerMode) {
    viewport.style.cursor = "crosshair";
  } else if (MAPS_STATE.view.dragMode === "marker") {
    viewport.style.cursor = "grabbing";
  } else if (MAPS_STATE.view.isDragging) {
    viewport.style.cursor = "grabbing";
  } else {
    viewport.style.cursor = "grab";
  }
}

function updateViewportStatus() {
  const info = getEl("mapViewportInfo");
  const active = getActiveMap();

  const rotateLabel = getEl("mapRotateBtn")?.querySelector("span");
  if (rotateLabel) {
    rotateLabel.textContent = `${MAPS_STATE.view.rotation}°`;
  }

  const rotationValue = getEl("mapRotationValue");
  if (rotationValue) {
    rotationValue.textContent = `${MAPS_STATE.view.rotation}°`;
  }

  const rotationRange = getEl("mapRotationRange");
  if (rotationRange && String(rotationRange.value) !== String(MAPS_STATE.view.rotation)) {
    rotationRange.value = String(MAPS_STATE.view.rotation);
  }

  const zoomMarker = getEl("mapZoomLevelMarker");
  if (zoomMarker) {
    const left = Math.round(((MAPS_STATE.view.zoom - 0.4) / 3.6) * 100);
    zoomMarker.style.left = `${Math.max(0, Math.min(100, left))}%`;
  }

  const viewport = getEl("mapStageViewport");
  if (viewport) {
    viewport.style.setProperty("--map-compass-rotation", `${MAPS_STATE.view.rotation}deg`);
  }

  if (!info || !active) return;

  info.textContent =
    `Zoom: ${MAPS_STATE.view.zoom.toFixed(2)} • ` +
    `Rotate: ${MAPS_STATE.view.rotation}° • ` +
    `Pan: ${Math.round(MAPS_STATE.view.panX)}, ${Math.round(MAPS_STATE.view.panY)} • ` +
    `Метки: ${active.markers.length}`;
}

function buildMarkerStyle(marker, selected = false) {
  return `
    left:${marker.x}%;
    top:${marker.y}%;
    color:${escapeHtml(marker.color)};
    --marker-glow:${escapeHtml(marker.color)}66;
    outline:${selected ? `2px solid ${escapeHtml(marker.color)}66` : "none"};
  `;
}

function getMarkerCoordsFromClick(event, imageEl) {
  const rect = imageEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;

  return {
    x: clampPercent(x),
    y: clampPercent(y),
  };
}

function setInteractionState(mode = "") {
  MAPS_STATE.view.dragMode = mode;
}

function resetInteractionState() {
  MAPS_STATE.view.isDragging = false;
  MAPS_STATE.view.dragStartX = 0;
  MAPS_STATE.view.dragStartY = 0;
  MAPS_STATE.view.dragOriginX = 0;
  MAPS_STATE.view.dragOriginY = 0;
  MAPS_STATE.view.suppressClick = false;
  MAPS_STATE.view.activePointerId = null;
  MAPS_STATE.view.dragMode = "";
  MAPS_STATE.view.dragMarkerId = null;
  MAPS_STATE.view.dragMarkerStartX = 0;
  MAPS_STATE.view.dragMarkerStartY = 0;
  MAPS_STATE.view.dragMarkerPreviewX = null;
  MAPS_STATE.view.dragMarkerPreviewY = null;
}

function getDraggedMarkerPreview() {
  if (!MAPS_STATE.view.dragMarkerId) return null;
  if (
    MAPS_STATE.view.dragMarkerPreviewX === null ||
    MAPS_STATE.view.dragMarkerPreviewY === null
  ) {
    return null;
  }

  return {
    id: MAPS_STATE.view.dragMarkerId,
    x: clampPercent(MAPS_STATE.view.dragMarkerPreviewX),
    y: clampPercent(MAPS_STATE.view.dragMarkerPreviewY),
  };
}

function getRenderableMarker(marker) {
  const preview = getDraggedMarkerPreview();

  if (preview && preview.id === marker.id) {
    return {
      ...marker,
      x: preview.x,
      y: preview.y,
    };
  }

  return marker;
}

function updateDraggedMarkerPreviewOnDom() {
  const markerId = MAPS_STATE.view.dragMarkerId;
  if (!markerId) return;

  const preview = getDraggedMarkerPreview();
  if (!preview) return;

  const btn = document.querySelector(`.map-marker-btn[data-marker-id="${markerId}"]`);
  if (!btn) return;

  btn.style.left = `${preview.x}%`;
  btn.style.top = `${preview.y}%`;

  const coordsInfo = getEl("mapMarkerCoordsInfo");
  if (coordsInfo) {
    coordsInfo.textContent = `Координаты: X ${Math.round(preview.x)}% • Y ${Math.round(preview.y)}%`;
  }
}

async function commitDraggedMarker() {
  const active = getActiveMap();
  const markerId = MAPS_STATE.view.dragMarkerId;
  const preview = getDraggedMarkerPreview();

  if (!active || !markerId || !preview) {
    resetInteractionState();
    applyMapTransform();
    return;
  }

  const current = active.markers.find((marker) => marker.id === markerId);
  const movedEnough =
    current &&
    (Math.abs(preview.x - current.x) > 0.2 || Math.abs(preview.y - current.y) > 0.2);

  if (movedEnough) {
    await updateMarker(active.id, markerId, {
      x: preview.x,
      y: preview.y,
    });
    showToast("Метка перемещена");
    return;
  }

  MAPS_STATE.ui.selectedMarkerId = markerId;
  resetInteractionState();
  renderMaps();
}

// ------------------------------------------------------------
// 🎨 RENDER HELPERS
// ------------------------------------------------------------
const MAP_CATEGORY_FILTERS = [
  ["all", "Все"],
  ["city", "Города"],
  ["trader", "Торговцы"],
  ["quest", "Квесты"],
  ["camp", "Лагеря"],
  ["dungeon", "Подземелья"],
  ["event", "События"],
];

const MAP_FALLBACK_MARKERS = [
  { id: "fallback_city", x: 48, y: 48, label: "Аэрего Кейллин", color: "#d6b57a", kind: "city", description: "Крупный торговый и политический центр долины.", threat: "Низкий", reputation: "Дружественный (+40%)", traders: ["Лирана Торн", "Гримм Бочонок", "Мистра Вейн"], quests: ["Слухи о предателе", "Золотые контракты"], events: ["Ярмарка в Дессарине"] },
  { id: "fallback_keep", x: 61, y: 22, label: "Крепость Северного Дозора", color: "#9bd7ef", kind: "city", description: "Северная сторожевая крепость и военный перевал.", threat: "Средний", reputation: "Нейтрально", traders: ["Интендант Варн"], quests: ["Патруль на перевале"], events: [] },
  { id: "fallback_swamp", x: 52, y: 75, label: "Болотные топи", color: "#8ed58f", kind: "quest", description: "Затопленные тропы, где пропадают караваны.", threat: "Средний", reputation: "Неизвестно", traders: [], quests: ["Следы в тине", "Гнилой алтарь"], events: ["Туман сгущается"] },
  { id: "fallback_dungeon", x: 38, y: 61, label: "Подземелье Тарн", color: "#b394ee", kind: "dungeon", description: "Руины старой башни и вход в нижние залы.", threat: "Высокий", reputation: "Опасная зона", traders: [], quests: ["Ключ подземелья"], events: ["Шёпот из глубины"] },
  { id: "fallback_camp", x: 74, y: 30, label: "Лагерь на перевале", color: "#f0a765", kind: "camp", description: "Временная стоянка партии и караванщиков.", threat: "Низкий", reputation: "Безопасно", traders: ["Полевой снабженец"], quests: [], events: ["Ночной дозор"] },
  { id: "fallback_trader", x: 82, y: 58, label: "Торговая застава", color: "#d6b57a", kind: "trader", description: "Малая застава с обменом припасов и слухов.", threat: "Низкий", reputation: "Дружественный", traders: ["Бродячий меняла", "Скупщик трофеев"], quests: ["Доставка ящиков"], events: [] },
  { id: "fallback_event", x: 27, y: 39, label: "Мрачнолесье", color: "#8ed58f", kind: "event", description: "Граница леса, где часто меняются тропы.", threat: "Средний", reputation: "Тревожно", traders: [], quests: ["Пропавший следопыт"], events: ["Стая у дороги"] },
];

function getMarkerSearchBlob(marker, active = null) {
  return [
    marker?.label,
    marker?.name,
    marker?.kind,
    marker?.type,
    marker?.description,
    marker?.area,
    marker?.threat,
    marker?.reputation,
    active?.name,
    active?.description,
    ...(Array.isArray(marker?.traders) ? marker.traders : []),
    ...(Array.isArray(marker?.quests) ? marker.quests : []),
    ...(Array.isArray(marker?.events) ? marker.events : []),
  ]
    .map((entry) => safeText(entry, "").toLowerCase())
    .filter(Boolean)
    .join(" ");
}

function filterDisplayMarkers(markers, active = null) {
  const filter = MAPS_STATE.ui.activeFilter || "all";
  const search = safeText(MAPS_STATE.ui.searchQuery, "").trim().toLowerCase();

  return (Array.isArray(markers) ? markers : []).filter((marker) => {
    const kind = normalizeMarkerKind(marker?.kind || marker?.type, "marker");
    if (filter && filter !== "all" && kind !== filter) return false;
    if (search && !getMarkerSearchBlob(marker, active).includes(search)) return false;
    return true;
  });
}

function getDisplayMarkers(active) {
  const sourceMarkers = active?.markers?.length
    ? active.markers.map((marker, index) => ({
        ...marker,
        kind: normalizeMarkerKind(marker.kind || marker.type, ["city", "trader", "quest", "camp", "dungeon", "event"][index % 6]),
      }))
    : MAP_FALLBACK_MARKERS;

  return filterDisplayMarkers(sourceMarkers, active);
}

function getMarkerKindIcon(kind = "") {
  const map = {
    city: "⌂",
    trader: "⚖",
    quest: "✦",
    camp: "⌁",
    dungeon: "◆",
    event: "✹",
    marker: "✦",
  };
  return map[kind] || "✦";
}

function getMarkerKindLabel(kind = "") {
  const map = {
    city: "Город",
    trader: "Торговая точка",
    quest: "Задание",
    camp: "Лагерь",
    dungeon: "Руины / Подземелье",
    event: "Событие",
    marker: "Метка",
  };
  return map[normalizeMarkerKind(kind, "marker")] || "Метка";
}

function getActiveLocation(active, markers) {
  const marker = getSelectedDisplayMarker(active, markers);
  const name = marker?.label || active?.name || "Карта мира";

  return {
    name,
    type: getMarkerKindLabel(marker?.kind || marker?.type),
    area: marker?.area || active?.description || "Долина Дессарин",
    reputation: marker?.reputation || (isGm() ? "Контролируется мастером" : "Неизвестно"),
    threat: marker?.threat || (marker?.kind === "dungeon" || marker?.kind === "event" ? "Средний" : "Низкий"),
    description: marker?.description || active?.description || "Выберите метку или создайте новую, чтобы заполнить детали локации.",
    marker,
  };
}

function renderMapCompass() {
  return `
    <div class="map-compass map-stage-control" aria-label="Компас и быстрый поворот карты">
      <i aria-hidden="true"></i>
      <button class="map-compass-btn map-compass-n map-stage-control" type="button" data-map-rotate-to="0" title="Север сверху">N</button>
      <button class="map-compass-btn map-compass-e map-stage-control" type="button" data-map-rotate-to="90" title="Восток сверху">E</button>
      <button class="map-compass-btn map-compass-s map-stage-control" type="button" data-map-rotate-to="180" title="Юг сверху">S</button>
      <button class="map-compass-btn map-compass-w map-stage-control" type="button" data-map-rotate-to="270" title="Запад сверху">W</button>
      <button class="map-compass-center map-stage-control" type="button" data-map-rotate-to="0" title="Сбросить поворот">✦</button>
    </div>
  `;
}

function renderFallbackMapTexture() {
  return `
    <div class="map-fallback-texture" aria-hidden="true">
      <span class="map-region-label map-region-label-main">Долина Дессарин</span>
      <span class="map-region-label map-region-label-west">Мрачнолесье</span>
      <span class="map-region-label map-region-label-east">Сумеречный лес</span>
      <span class="map-route map-route-a"></span>
      <span class="map-route map-route-b"></span>
      <span class="map-route map-route-c"></span>
    </div>
  `;
}

function renderMapMarkerButton(marker, selectedMarker) {
  const isSelected = selectedMarker?.id === marker.id;
  const isFallback = String(marker.id || "").startsWith("fallback_");

  return `
    <button
      type="button"
      class="map-marker-btn map-world-marker ${isSelected ? "map-world-marker-active" : ""} ${isFallback ? "map-world-marker-preview" : ""}"
      data-marker-id="${escapeHtml(marker.id)}"
      style="${buildMarkerStyle(marker, isSelected)}"
      title="${escapeHtml(marker.label)}"
    >
      <span class="map-world-marker-icon">${escapeHtml(getMarkerKindIcon(marker.kind))}</span>
      <span class="map-world-marker-label">${escapeHtml(marker.label)}</span>
    </button>
  `;
}

function renderSummaryBar() {
  const active = getActiveMap();

  return `
    <div class="map-reference-head">
      <div class="map-title-block">
        <h2>Карта мира <span>ⓘ</span></h2>
        <p>Исследуйте мир, находите торговцев, выполняйте квесты и расширяйте влияние.</p>
      </div>

      <label class="map-search" for="mapSearchInput">
        <span>⌕</span>
        <input id="mapSearchInput" type="search" placeholder="Поиск локации, торговца, квеста..." value="${escapeHtml(MAPS_STATE.ui.searchQuery)}" />
      </label>

      <div class="map-head-actions">
        <button class="btn" type="button" id="mapsRefreshBtn">Обновить</button>
        <button class="btn btn-primary" type="button" id="mapsToggleCreateBtn">
          ${MAPS_STATE.ui.createOpen ? "Скрыть" : "＋ Новая карта"}
        </button>
      </div>
    </div>

    <details class="map-control-drawer map-filter-drawer">
      <summary>
        <span>Фильтры и режимы карты</span>
        <strong>${escapeHtml(MAPS_STATE.ui.activeFilter === "all" ? "Все метки" : getMarkerKindLabel(MAPS_STATE.ui.activeFilter))}</strong>
      </summary>
      <div class="map-filter-row">
        <div class="map-filter-tabs">
          ${MAP_CATEGORY_FILTERS.map(([key, label]) => `
            <button class="map-filter-tab ${MAPS_STATE.ui.activeFilter === key ? "active" : ""}" type="button" data-map-filter="${escapeHtml(key)}">
              <span>${escapeHtml(getMarkerKindIcon(key))}</span>
              ${escapeHtml(label)}
            </button>
          `).join("")}
        </div>

        <div class="map-filter-actions">
          <button class="map-filter-tab" type="button" id="mapMarkerModeBtn">
            <span>★</span>
            ${MAPS_STATE.view.markerMode ? "Маркер: ВКЛ" : "Мой маркер"}
          </button>
          <button class="map-filter-tab" type="button" id="mapResetFiltersBtn">
            <span>☷</span>
            Сброс
          </button>
        </div>
      </div>
    </details>

  `;
}

function renderCreateForm() {
  return `
    <div
      class="map-create-panel"
      id="mapsCreateBlock"
      ${MAPS_STATE.ui.createOpen ? "" : "hidden"}
    >
      <div class="map-panel-title">Новая карта</div>

      <div class="map-create-grid">
        <label class="filter-group">
          <span>Название</span>
          <input id="mapFormName" type="text" placeholder="Например: Мир Торана" />
        </label>

        <label class="filter-group">
          <span>Описание</span>
          <input id="mapFormDescription" type="text" placeholder="Краткое описание карты" />
        </label>

        <label class="filter-group">
          <span>Изображение</span>
          <input id="mapFormFile" type="file" accept="image/*" />
        </label>
      </div>

      <div class="map-create-actions">
        <button class="btn btn-success" type="button" id="mapFormSaveBtn">Сохранить</button>
        <button class="btn" type="button" id="mapFormCancelBtn">Скрыть</button>
      </div>
    </div>
  `;
}

function renderActiveMarkersDock(markers, selectedMarker) {
  const visible = (Array.isArray(markers) ? markers : []).slice(0, 18);

  return `
    <details class="map-active-markers-dock map-stage-control">
      <summary class="map-active-markers-dock-head map-stage-control">
        <span>Метки</span>
        <strong>${escapeHtml(String(visible.length))}</strong>
      </summary>
      <div class="map-active-markers-scroll map-stage-control">
        ${visible.length
          ? visible.map((marker) => `
            <button
              type="button"
              data-marker-select="${escapeHtml(marker.id)}"
              class="map-active-marker-chip map-stage-control ${selectedMarker?.id === marker.id ? "active" : ""}"
              title="${escapeHtml(marker.label)}"
            >
              <span>${escapeHtml(getMarkerKindIcon(marker.kind))}</span>
              <strong>${escapeHtml(marker.label)}</strong>
            </button>
          `).join("")
          : `<div class="muted">Метки не найдены</div>`}
      </div>
    </details>
  `;
}

function renderMapStage(active, markers, selectedMarker) {
  const hasImage = Boolean(active?.image);
  const zoomPercent = Math.round(((MAPS_STATE.view.zoom - 0.4) / 3.6) * 100);

  return `
    <div class="map-stage-shell">
      <div
        id="mapStageViewport"
        class="map-stage-outer ${hasImage ? "map-stage-outer-image" : "map-stage-outer-fallback"}"
      >
        ${renderMapCompass()}

        <div id="mapTransformLayer" class="map-transform-layer">
          ${
            hasImage
              ? `<img
                  id="activeMapImage"
                  class="map-active-image"
                  src="${escapeHtml(active.image)}"
                  alt="${escapeHtml(active.name)}"
                  draggable="false"
                />`
              : `<div id="activeMapImage" class="map-fallback-board" role="img" aria-label="${escapeHtml(active?.name || "Карта мира")}">${renderFallbackMapTexture()}</div>`
          }

          ${markers.map((marker) => renderMapMarkerButton(getRenderableMarker(marker), selectedMarker)).join("")}
        </div>

        ${renderActiveMarkersDock(markers, selectedMarker)}

        <div class="map-zoom-dock map-stage-control" data-map-control="zoom">
          <button class="btn map-stage-control" type="button" id="mapZoomOutBtn" aria-label="Отдалить карту">−</button>
          <div class="map-zoom-track" aria-hidden="true">
            <span id="mapZoomLevelMarker" style="left:${zoomPercent}%;"></span>
          </div>
          <button class="btn map-stage-control" type="button" id="mapZoomInBtn" aria-label="Приблизить карту">＋</button>
        </div>

        <button class="map-world-chip map-stage-control" type="button" id="mapResetViewBtn">Сброс вида</button>

        <div class="map-stage-actions map-stage-control">
          <button
            class="map-fullscreen-toggle map-stage-control"
            type="button"
            id="mapFullscreenBtn"
            title="${MAPS_STATE.ui.fullscreen ? "Вернуться к обычному режиму" : "Открыть карту на весь экран"}"
          >${MAPS_STATE.ui.fullscreen ? "⤡ Выйти" : "⛶ Карта"}</button>

          <details class="map-stage-controls-drawer map-stage-control" id="mapStageControlsDrawer">
            <summary class="map-stage-control">⚙ Управление</summary>
            <div class="map-stage-controls-panel map-stage-control">
              <section class="map-rotation-dock map-stage-control">
                <div class="map-rotation-head">
                  <span>Поворот</span>
                  <strong id="mapRotationValue">${escapeHtml(String(MAPS_STATE.view.rotation || 0))}°</strong>
                </div>
                <input
                  id="mapRotationRange"
                  class="map-rotation-range map-stage-control"
                  type="range"
                  min="0"
                  max="359"
                  step="1"
                  value="${escapeHtml(String(MAPS_STATE.view.rotation || 0))}"
                  aria-label="Поворот карты в градусах"
                />
                <button class="map-rotate-button map-stage-control" type="button" id="mapRotateBtn">↻ 90°</button>
              </section>

              <section class="map-legend-panel map-stage-control" id="mapLegendDrawer">
                <div class="map-stage-panel-title">🧭 Легенда</div>
                <div class="map-legend-content">
                  ${MAP_CATEGORY_FILTERS.filter(([key]) => key !== "all").map(([key, label]) => `
                    <button type="button" class="map-legend-row map-stage-control" data-map-filter="${escapeHtml(key)}">
                      <span>${escapeHtml(getMarkerKindIcon(key))}</span>
                      <strong>${escapeHtml(label)}</strong>
                      <small>${escapeHtml(getMarkerKindLabel(key))}</small>
                    </button>
                  `).join("")}
                </div>
              </section>
            </div>
          </details>
        </div>
      </div>
    </div>
  `;
}


function getPendingMarkerDraft(active = getActiveMap()) {
  const nameFromInput = safeText(getEl("mapQuickMarkerLabelInput")?.value, "").trim();
  const kindFromInput = safeText(getEl("mapQuickMarkerKindInput")?.value, "").trim();
  const colorFromInput = safeText(getEl("mapQuickMarkerColorInput")?.value, "").trim();

  const label = nameFromInput || safeText(MAPS_STATE.ui.pendingMarkerLabel, "").trim() || `Метка ${(active?.markers?.length || 0) + 1}`;
  const kind = normalizeMarkerKind(kindFromInput || MAPS_STATE.ui.pendingMarkerKind || "marker", "marker");
  const color = colorFromInput || MAPS_STATE.ui.pendingMarkerColor || "#98dfe3";

  return { label, kind, color };
}

function renderQuickMarkerCreate(active) {
  const draft = getPendingMarkerDraft(active);
  const modeText = MAPS_STATE.view.markerMode ? "Кликни по карте" : "Добавить метку";

  return `
    <section class="map-location-card map-quick-marker-panel ${MAPS_STATE.view.markerMode ? "map-quick-marker-panel-active" : ""}">
      <div class="map-card-heading">
        <span>Быстрая метка</span>
        <strong>${MAPS_STATE.view.markerMode ? "ожидает клика" : "готово"}</strong>
      </div>
      <div class="map-quick-marker-grid">
        <label class="filter-group map-quick-marker-name">
          <span>Название</span>
          <input id="mapQuickMarkerLabelInput" type="text" value="${escapeHtml(MAPS_STATE.ui.pendingMarkerLabel || "")}" placeholder="Например: Тайный проход" />
        </label>
        <label class="filter-group">
          <span>Тип</span>
          <select id="mapQuickMarkerKindInput">
            ${MAP_CATEGORY_FILTERS.filter(([key]) => key !== "all").map(([key, label]) => `<option value="${escapeHtml(key)}" ${draft.kind === key ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
            <option value="marker" ${draft.kind === "marker" ? "selected" : ""}>Своя метка</option>
          </select>
        </label>
        <label class="filter-group map-quick-marker-color">
          <span>Цвет</span>
          <input id="mapQuickMarkerColorInput" type="color" value="${escapeHtml(draft.color)}" />
        </label>
      </div>
      <div class="map-location-actions map-quick-marker-actions">
        <button class="btn btn-primary" type="button" id="mapQuickAddMarkerBtn">${escapeHtml(modeText)}</button>
        <button class="btn" type="button" id="mapQuickCancelMarkerBtn" ${MAPS_STATE.view.markerMode ? "" : "disabled"}>Отмена</button>
      </div>
      <div class="muted map-quick-marker-note">
        1) Введи название. 2) Нажми «Добавить метку». 3) Кликни по карте — редактор откроется справа.
      </div>
    </section>
  `;
}

function renderSelectedMarkerQuickEditor(marker, realMarker) {
  if (!marker) {
    return `
      <section class="map-location-card map-marker-quick-editor map-marker-quick-editor-empty map-marker-quick-editor-round96">
        <div class="map-card-heading">
          <span>Редактор метки</span>
          <strong>нет выбора</strong>
        </div>
        <div class="muted">Выбери метку справа или создай новую через блок «Быстрая метка».</div>
      </section>
    `;
  }

  if (!realMarker) {
    return `
      <section class="map-location-card map-marker-quick-editor map-marker-quick-editor-preview map-marker-quick-editor-round96">
        <div class="map-card-heading">
          <span>Редактор метки</span>
          <strong>demo</strong>
        </div>
        <div class="muted">Это демонстрационная точка. Чтобы редактировать название, цвет и связи, создай пользовательскую метку.</div>
      </section>
    `;
  }

  return `
    <section class="map-location-card map-marker-quick-editor map-marker-quick-editor-round96">
      <div class="map-card-heading">
        <span>Редактор метки</span>
        <strong>${escapeHtml(getMarkerKindLabel(marker.kind))}</strong>
      </div>
      <div class="map-marker-edit-grid map-marker-edit-grid-compact">
        <label class="filter-group">
          <span>Название</span>
          <input id="mapMarkerLabelInput" type="text" value="${escapeHtml(marker.label)}" />
        </label>
        <label class="filter-group">
          <span>Тип</span>
          <select id="mapMarkerKindInput">
            ${MAP_CATEGORY_FILTERS.filter(([key]) => key !== "all").map(([key, label]) => `<option value="${escapeHtml(key)}" ${normalizeMarkerKind(marker.kind) === key ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
            <option value="marker" ${normalizeMarkerKind(marker.kind) === "marker" ? "selected" : ""}>Своя метка</option>
          </select>
        </label>
        <label class="filter-group">
          <span>Цвет</span>
          <input id="mapMarkerColorInput" type="color" value="${escapeHtml(marker.color || "#98dfe3")}" />
        </label>
        <label class="filter-group">
          <span>Угроза</span>
          <select id="mapMarkerThreatInput">
            ${["Низкий", "Средний", "Высокий", "Критический"].map((value) => `<option value="${escapeHtml(value)}" ${String(marker.threat || "") === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}
          </select>
        </label>
      </div>
      <label class="filter-group map-marker-quick-full">
        <span>Описание / заметка</span>
        <textarea id="mapMarkerDescriptionInput" rows="3" placeholder="Что это за место, почему оно важно, что тут происходит...">${escapeHtml(marker.description || "")}</textarea>
      </label>
      <div class="map-marker-edit-grid map-marker-edit-grid-compact">
        <label class="filter-group">
          <span>Регион</span>
          <input id="mapMarkerAreaInput" type="text" value="${escapeHtml(marker.area || "")}" placeholder="Например: Долина Дессарин" />
        </label>
        <label class="filter-group">
          <span>Репутация</span>
          <input id="mapMarkerReputationInput" type="text" value="${escapeHtml(marker.reputation || "")}" placeholder="Например: Дружественный" />
        </label>
      </div>
      <details class="map-side-section map-marker-links-drawer">
        <summary><span>Связи метки</span><strong>${escapeHtml(String((marker.traders || []).length + (marker.quests || []).length + (marker.events || []).length))}</strong></summary>
        <div class="map-marker-edit-grid map-marker-edit-grid-compact">
          <label class="filter-group">
            <span>Торговцы</span>
            <input id="mapMarkerTradersInput" type="text" value="${escapeHtml(serializeStringList(marker.traders))}" placeholder="через запятую" />
          </label>
          <label class="filter-group">
            <span>Квесты</span>
            <input id="mapMarkerQuestsInput" type="text" value="${escapeHtml(serializeStringList(marker.quests))}" placeholder="через запятую" />
          </label>
        </div>
        <label class="filter-group map-marker-quick-full">
          <span>События</span>
          <input id="mapMarkerEventsInput" type="text" value="${escapeHtml(serializeStringList(marker.events))}" placeholder="через запятую" />
        </label>
      </details>
      <div class="map-create-actions map-marker-quick-actions">
        <button class="btn btn-success" type="button" id="mapMarkerSaveBtn">Сохранить</button>
        <button class="btn" type="button" id="mapCenterSelectedBtnEditor">Центрировать</button>
        <button class="btn btn-danger" type="button" id="mapMarkerDeleteBtn">Удалить</button>
      </div>
      <div class="map-marker-coords" id="mapMarkerCoordsInfo">X ${Math.round(marker.x)}% • Y ${Math.round(marker.y)}%</div>
    </section>
  `;
}

function renderLocationRail(active, markers) {
  const location = getActiveLocation(active, markers);
  const marker = location.marker;
  const previewImage = active?.image || "/static/images/background.jpg";
  const traders = Array.isArray(marker?.traders) ? marker.traders : [];
  const quests = Array.isArray(marker?.quests) ? marker.quests : [];
  const events = Array.isArray(marker?.events) ? marker.events : [];
  const realMarker = marker && !isFallbackMarker(marker);
  const eventMarkers = markers.filter((item) => normalizeMarkerKind(item.kind, "marker") === "event");

  return `
    <aside class="map-location-rail map-location-rail-clean map-location-rail-round96">
      <section class="map-location-card map-location-card-main map-combined-panel map-location-card-round96">
        <div class="map-location-image">
          <img src="${escapeHtml(previewImage)}" alt="${escapeHtml(location.name)}" />
        </div>

        <div class="map-location-title-row">
          <h3>${escapeHtml(location.name)}</h3>
          <span>${escapeHtml(location.type)}</span>
        </div>

        <div class="map-location-meta">
          <p>◉ ${escapeHtml(location.area)}</p>
          <p>✙ Репутация: <strong>${escapeHtml(location.reputation)}</strong></p>
          <p>♢ Уровень угрозы: <strong>${escapeHtml(location.threat)}</strong></p>
          ${marker ? `<p>⌖ Координаты: <strong>X ${Math.round(marker.x)}% • Y ${Math.round(marker.y)}%</strong></p>` : ""}
        </div>

        <p class="map-location-copy">${escapeHtml(location.description)}</p>

        <div class="map-location-actions map-location-actions-clean">
          <button class="btn" type="button" id="mapCenterSelectedBtn" ${marker ? "" : "disabled"}>Центрировать</button>
          <button class="btn" type="button" id="mapShareLocationBtn" ${marker ? "" : "disabled"}>Скопировать</button>
        </div>

        ${renderQuickMarkerCreate(active)}
        ${renderSelectedMarkerQuickEditor(marker, realMarker)}

        ${!realMarker && marker ? `<div class="map-demo-note">Это демонстрационная точка. Чтобы редактировать детали, создай свою метку на карте.</div>` : ""}

        <div class="map-side-stack-clean">
          <details class="map-side-section">
            <summary><span>Метки и события</span><strong>${markers.length}/${eventMarkers.length}</strong></summary>
            <div class="map-compact-list map-compact-list-clean">
              ${markers.length
                ? markers.slice(0, 10).map((item) => `
                  <button type="button" data-marker-select="${escapeHtml(item.id)}" class="map-side-marker-row ${marker?.id === item.id ? "active" : ""}">
                    <span>${escapeHtml(getMarkerKindIcon(item.kind))}</span>
                    <div>
                      <strong>${escapeHtml(item.label)}</strong>
                      <small>${escapeHtml(getMarkerKindLabel(item.kind))}${Array.isArray(item.events) && item.events.length ? ` • событий: ${item.events.length}` : ""}</small>
                    </div>
                  </button>
                `).join("")
                : `<div class="muted">По текущему фильтру меток нет.</div>`}
            </div>
          </details>

          <details class="map-side-section">
            <summary><span>Торговцы</span><strong>${traders.length}</strong></summary>
            <div class="map-compact-list map-compact-list-clean">
              ${traders.length
                ? traders.map((name, index) => `
                  <div class="map-compact-row">
                    <img src="/static/images/${escapeHtml(["kaylessa", "grund", "minthra", "eldras"][index % 4])}.jpg" alt="${escapeHtml(name)}" />
                    <div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(index === 0 ? "Связанный торговец" : "Локационный NPC")}</small></div>
                  </div>
                `).join("")
                : `<div class="muted">К этой точке торговцы пока не привязаны.</div>`}
            </div>
            <button class="map-card-link" type="button" id="mapAddTraderToMarkerBtn" ${realMarker ? "" : "disabled"}>Добавить торговца</button>
          </details>

          <details class="map-side-section">
            <summary><span>Квесты</span><strong>${quests.length}</strong></summary>
            <div class="map-quest-list">
              ${quests.length
                ? quests.map((quest, index) => `<div><span>${index % 2 ? "✧" : "✦"}</span><p>${escapeHtml(quest)}<small>${escapeHtml(marker?.kind === "quest" ? "Основная цель" : "Связанная запись")}</small></p></div>`).join("")
                : `<div class="muted">Квесты пока не привязаны.</div>`}
            </div>
            <button class="map-card-link" type="button" id="mapAddQuestToMarkerBtn" ${realMarker ? "" : "disabled"}>Добавить квест</button>
          </details>

          <details class="map-side-section">
            <summary><span>События выбранной точки</span><strong>${events.length}</strong></summary>
            <div class="map-event-row map-event-row-clean">
              ${events.length
                ? events.map((eventName) => `<div><span>✹</span><strong>${escapeHtml(eventName)}</strong><small>активно</small></div>`).join("")
                : `<div class="muted">Событий у выбранной точки пока нет.</div>`}
            </div>
            <button class="map-card-link" type="button" id="mapAddEventToMarkerBtn" ${realMarker ? "" : "disabled"}>Добавить событие</button>
          </details>
        </div>
      </section>
    </aside>
  `;
}

function renderMapViewer() {
  const active = getActiveMap();
  const displayMap = active || {
    id: "fallback-map",
    name: "Карта мира",
    description: "Долина Дессарин",
    image: "",
    markers: [],
    updated_at: new Date().toISOString(),
  };
  const markers = getDisplayMarkers(active);
  const selectedMarker = getSelectedDisplayMarker(active, markers);

  return `
    <div class="map-reference-layout map-reference-layout-round96">
      <main class="map-main-panel map-main-panel-round96">
        ${renderSummaryBar()}
        ${renderCreateForm()}
        <div id="mapViewportInfo" class="map-viewport-info" hidden></div>
        ${renderMapStage(displayMap, markers, selectedMarker)}
        ${renderMapBottomPanels(markers)}
        <details class="map-control-drawer map-marker-editor-drawer">
          <summary>
            <span>Настройки карт и меток</span>
            <strong>${escapeHtml(String(active?.markers?.length || 0))}</strong>
          </summary>
          ${renderMarkerEditor()}
        </details>
      </main>

      ${renderLocationRail(displayMap, markers)}
    </div>
  `;
}

function renderMapBottomPanels(markers) {
  const active = getActiveMap();
  const selected = getSelectedDisplayMarker(active, markers);
  const questMarkers = markers.filter((marker) => normalizeMarkerKind(marker.kind, "marker") === "quest").slice(0, 4);
  const eventMarkers = markers.filter((marker) => normalizeMarkerKind(marker.kind, "marker") === "event").slice(0, 3);
  const visibleMarkers = questMarkers.length ? questMarkers : markers.slice(0, 4);

  return `
    <div class="map-bottom-grid">
      <section class="map-bottom-card">
        <div class="map-card-heading">
          <span>Активные точки на карте</span>
          <strong>${markers.length}</strong>
        </div>
        <div class="map-bottom-row">
          ${visibleMarkers.length
            ? visibleMarkers.map((marker) => `
              <button type="button" data-marker-select="${escapeHtml(marker.id)}" class="${selected?.id === marker.id ? "active" : ""}">
                <span>${escapeHtml(getMarkerKindIcon(marker.kind))}</span>
                <strong>${escapeHtml(marker.label)}</strong>
                <small>${escapeHtml(getMarkerKindLabel(marker.kind))}</small>
              </button>
            `).join("")
            : `<div class="muted">По текущему фильтру точек нет.</div>`}
        </div>
      </section>

      <section class="map-bottom-card">
        <div class="map-card-heading">
          <span>События</span>
          <strong>${eventMarkers.length}</strong>
        </div>
        <div class="map-event-row">
          ${eventMarkers.length
            ? eventMarkers.map((marker) => `<button type="button" data-marker-select="${escapeHtml(marker.id)}"><span>${escapeHtml(getMarkerKindIcon(marker.kind))}</span><strong>${escapeHtml(marker.label)}</strong><small>${escapeHtml(marker.threat || "событие")}</small></button>`).join("")
            : `<div><span>✹</span><strong>${escapeHtml(selected?.events?.[0] || "Нет активных событий")}</strong><small>${escapeHtml(selected ? selected.label : "выберите метку")}</small></div>`}
          <button type="button" id="mapAddEventToMarkerBtnBottom" ${selected && !isFallbackMarker(selected) ? "" : "disabled"}>Добавить событие</button>
        </div>
      </section>
    </div>
  `;
}

function renderMarkerEditor() {
  const active = getActiveMap();
  if (!active) return "";

  return `
    <div class="map-management-grid map-management-grid-compact">
      <section class="map-location-card">
        <div class="map-card-heading">
          <span>Карты кампании</span>
          <strong>${MAPS_STATE.maps.length}</strong>
        </div>
        ${
          MAPS_STATE.maps.length
            ? `
              <div class="map-list-stack">
                ${MAPS_STATE.maps
                  .map((map) => {
                    const activeFlag = map.id === MAPS_STATE.activeMapId;
                    return `
                      <div class="map-list-row ${activeFlag ? "map-list-row-active" : ""}">
                        <div>
                          <strong>${activeFlag ? "●" : "○"} ${escapeHtml(map.name)}</strong>
                          <small>${escapeHtml(map.description || "Без описания")} • Меток: ${map.markers.length} • ${escapeHtml(formatDate(map.updated_at))}</small>
                        </div>
                        <div>
                          <button class="btn" type="button" data-map-select="${escapeHtml(map.id)}">Открыть</button>
                          <button class="btn btn-danger" type="button" data-map-delete="${escapeHtml(map.id)}" ${map.id === "default_world_map" ? "disabled" : ""}>Удалить</button>
                        </div>
                      </div>
                    `;
                  })
                  .join("")}
              </div>
            `
            : `<p class="muted">Карт пока нет. Добавь первую карту через кнопку сверху.</p>`
        }
      </section>
      <section class="map-location-card">
        <div class="map-card-heading">
          <span>Очистка меток</span>
          <strong>${active.markers.length}</strong>
        </div>
        <p class="muted">Редактирование выбранной метки теперь находится справа от карты, чтобы не листать вниз.</p>
        <div class="map-create-actions">
          <button class="btn btn-danger" type="button" id="mapClearMarkersBtn" ${active.markers.length ? "" : "disabled"}>Очистить все пользовательские метки</button>
        </div>
      </section>
    </div>
  `;
}

// ------------------------------------------------------------
// 🧱 MAIN RENDER
// ------------------------------------------------------------
export function renderMaps() {
  const container = getEl("cabinet-map");
  if (!container) return;

  ensureSelectedMarkerIsValid();

  container.innerHTML = `
    ${renderMapViewer()}
  `;

  applyMapTransform();
  bindMapActions();
  ensureMapKeyboardShortcuts();
  ensureMapFullscreenEvents();
  syncToSharedState();
}

// ------------------------------------------------------------
// 🎛 ACTION HELPERS
// ------------------------------------------------------------
function centerOnMarker(marker = getSelectedDisplayMarker()) {
  if (!marker) return;
  const viewport = getEl("mapStageViewport");
  const rect = viewport?.getBoundingClientRect();
  if (!rect?.width || !rect?.height) {
    MAPS_STATE.view.panX = 0;
    MAPS_STATE.view.panY = 0;
  } else {
    MAPS_STATE.view.panX = (50 - safeNumber(marker.x, 50)) * (rect.width / 100) * MAPS_STATE.view.zoom;
    MAPS_STATE.view.panY = (50 - safeNumber(marker.y, 50)) * (rect.height / 100) * MAPS_STATE.view.zoom;
  }
  MAPS_STATE.ui.selectedMarkerId = marker.id;
  syncToSharedState();
  applyMapTransform();
  updateViewportStatus();
  showToast("Карта центрирована по метке");
}

async function copySelectedLocation() {
  const active = getActiveMap();
  const marker = getSelectedDisplayMarker(active, getDisplayMarkers(active));
  if (!marker) return;
  const text = `${marker.label} • ${getMarkerKindLabel(marker.kind)} • X ${Math.round(marker.x)}% / Y ${Math.round(marker.y)}%`;
  try {
    await navigator.clipboard.writeText(text);
    showToast("Локация скопирована");
  } catch (_) {
    showToast(text);
  }
}

async function addValueToSelectedMarker(field, promptTitle) {
  const active = getActiveMap();
  const marker = getSelectedMarker();
  if (!active || !marker) return;

  const value = safeText(prompt(promptTitle, ""), "").trim();
  if (!value) return;

  const prev = Array.isArray(marker[field]) ? marker[field] : [];
  await updateMarker(active.id, marker.id, {
    [field]: [...prev, value],
  });
  showToast("Данные метки обновлены");
}


let mapKeyboardShortcutsBound = false;

function handleMapKeyboardShortcut(event) {
  if (event.key !== "Escape") return;
  if (!MAPS_STATE.ui.fullscreen) return;

  event.preventDefault();
  toggleMapFullscreen(false);
}

function ensureMapKeyboardShortcuts() {
  if (mapKeyboardShortcutsBound) return;
  document.addEventListener("keydown", handleMapKeyboardShortcut);
  mapKeyboardShortcutsBound = true;
}

function getNativeFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
}

function requestNativeFullscreen(element) {
  if (!element) return Promise.reject(new Error("fullscreen target missing"));
  const fn =
    element.requestFullscreen ||
    element.webkitRequestFullscreen ||
    element.msRequestFullscreen;
  if (!fn) return Promise.reject(new Error("fullscreen api unavailable"));
  const result = fn.call(element);
  return result && typeof result.then === "function" ? result : Promise.resolve();
}

function exitNativeFullscreen() {
  const fn =
    document.exitFullscreen ||
    document.webkitExitFullscreen ||
    document.msExitFullscreen;
  if (!fn) return Promise.resolve();
  const result = fn.call(document);
  return result && typeof result.then === "function" ? result : Promise.resolve();
}

function setMapFullscreenButtonState(isFullscreen) {
  const btn = getEl("mapFullscreenBtn");
  if (!btn) return;
  btn.textContent = isFullscreen ? "⤡ Выйти" : "⛶ Карта";
  btn.title = isFullscreen ? "Вернуться к обычному режиму" : "Открыть карту на весь экран";
  btn.classList.toggle("active", Boolean(isFullscreen));
}

function syncMapFullscreenStateFromBrowser() {
  const stage = getEl("mapStageViewport");
  const activeElement = getNativeFullscreenElement();
  const isFullscreen = Boolean(stage && activeElement === stage);

  MAPS_STATE.ui.fullscreen = isFullscreen;
  document.body.classList.toggle("map-native-fullscreen-active", isFullscreen);
  setMapFullscreenButtonState(isFullscreen);
  resetInteractionState();
  applyMapTransform();
  updateViewportStatus();
}

let mapFullscreenEventsBound = false;
function ensureMapFullscreenEvents() {
  if (mapFullscreenEventsBound) return;
  document.addEventListener("fullscreenchange", syncMapFullscreenStateFromBrowser);
  document.addEventListener("webkitfullscreenchange", syncMapFullscreenStateFromBrowser);
  document.addEventListener("MSFullscreenChange", syncMapFullscreenStateFromBrowser);
  mapFullscreenEventsBound = true;
}

function toggleMapFullscreen(force = null) {
  const stage = getEl("mapStageViewport");
  const activeElement = getNativeFullscreenElement();
  const currentlyFullscreen = Boolean(stage && activeElement === stage);
  const nextValue = typeof force === "boolean" ? force : !currentlyFullscreen;

  resetInteractionState();

  if (nextValue) {
    MAPS_STATE.view.panX = 0;
    MAPS_STATE.view.panY = 0;
    MAPS_STATE.view.zoom = 1;
    MAPS_STATE.ui.fullscreen = true;
    document.body.classList.add("map-native-fullscreen-active");
    setMapFullscreenButtonState(true);
    applyMapTransform();
    updateViewportStatus();

    requestNativeFullscreen(stage)
      .then(() => {
        syncMapFullscreenStateFromBrowser();
      })
      .catch((error) => {
        console.warn("Map fullscreen failed", error);
        MAPS_STATE.ui.fullscreen = false;
        document.body.classList.remove("map-native-fullscreen-active");
        setMapFullscreenButtonState(false);
        showToast("Браузер не дал открыть полноэкранный режим");
      });
    return;
  }

  MAPS_STATE.ui.fullscreen = false;
  document.body.classList.remove("map-native-fullscreen-active");
  setMapFullscreenButtonState(false);

  if (currentlyFullscreen) {
    exitNativeFullscreen()
      .catch((error) => console.warn("Map fullscreen exit failed", error))
      .finally(() => {
        syncMapFullscreenStateFromBrowser();
      });
  } else {
    applyMapTransform();
    updateViewportStatus();
  }
}

function isMapStageControlTarget(target) {
  return Boolean(
    target?.closest?.(
      ".map-stage-control, .map-zoom-dock, .map-world-chip, .map-rotate-button, .map-stage-controls-drawer, .map-stage-controls-panel, .map-legend-drawer, .map-active-markers-dock, .map-control-drawer, .map-filter-drawer, .map-marker-editor-drawer, button, input, select, textarea, label, summary, details"
    )
  );
}

// ------------------------------------------------------------
// 🎛 ACTIONS
// ------------------------------------------------------------
function bindMapActions() {
  const refreshBtn = getEl("mapsRefreshBtn");
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      await loadMapData();
      showToast("Карты обновлены");
    };
  }

  const searchInput = getEl("mapSearchInput");
  if (searchInput) {
    searchInput.oninput = () => {
      MAPS_STATE.ui.searchQuery = searchInput.value || "";
      renderMaps();
    };
  }

  document.querySelectorAll("[data-map-filter]").forEach((btn) => {
    btn.onclick = () => {
      MAPS_STATE.ui.activeFilter = btn.dataset.mapFilter || "all";
      MAPS_STATE.ui.selectedMarkerId = null;
      renderMaps();
    };
  });

  const resetFiltersBtn = getEl("mapResetFiltersBtn");
  if (resetFiltersBtn) {
    resetFiltersBtn.onclick = () => {
      MAPS_STATE.ui.activeFilter = "all";
      MAPS_STATE.ui.searchQuery = "";
      MAPS_STATE.ui.selectedMarkerId = null;
      renderMaps();
    };
  }

  const toggleCreateBtn = getEl("mapsToggleCreateBtn");
  if (toggleCreateBtn) {
    toggleCreateBtn.onclick = () => {
      MAPS_STATE.ui.createOpen = !MAPS_STATE.ui.createOpen;
      renderMaps();
    };
  }

  const cancelBtn = getEl("mapFormCancelBtn");
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      MAPS_STATE.ui.createOpen = false;
      renderMaps();
    };
  }

  const saveBtn = getEl("mapFormSaveBtn");
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const name = safeText(getEl("mapFormName")?.value, "").trim();
      const description = safeText(getEl("mapFormDescription")?.value, "").trim();
      const fileInput = getEl("mapFormFile");
      const file = fileInput?.files?.[0];

      if (!name) {
        showToast("Укажи название карты");
        return;
      }

      let image = "";
      if (file) {
        try {
          image = await readFileAsDataUrl(file);
        } catch (error) {
          console.error(error);
          showToast("Не удалось прочитать файл карты");
          return;
        }
      }

      await createMapEntry({
        name,
        description,
        image,
        markers: [],
      });
    };
  }

  const zoomInBtn = getEl("mapZoomInBtn");
  if (zoomInBtn) zoomInBtn.onclick = () => zoomMap(0.15);

  const zoomOutBtn = getEl("mapZoomOutBtn");
  if (zoomOutBtn) zoomOutBtn.onclick = () => zoomMap(-0.15);

  const rotateBtn = getEl("mapRotateBtn");
  if (rotateBtn) rotateBtn.onclick = () => rotateMap(90);

  const rotationRange = getEl("mapRotationRange");
  if (rotationRange) {
    rotationRange.oninput = () => setMapRotation(rotationRange.value);
    rotationRange.onchange = () => setMapRotation(rotationRange.value);
  }

  document.querySelectorAll("[data-map-rotate-to]").forEach((btn) => {
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      setMapRotation(btn.dataset.mapRotateTo || 0);
    };
  });

  const resetBtn = getEl("mapResetViewBtn");
  if (resetBtn) resetBtn.onclick = () => resetMapView(true);

  const fullscreenBtn = getEl("mapFullscreenBtn");
  if (fullscreenBtn) {
    fullscreenBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleMapFullscreen();
    };
  }

  const markerModeBtn = getEl("mapMarkerModeBtn");
  if (markerModeBtn) markerModeBtn.onclick = () => toggleMarkerMode();

  const quickLabelInput = getEl("mapQuickMarkerLabelInput");
  if (quickLabelInput) {
    quickLabelInput.oninput = () => {
      MAPS_STATE.ui.pendingMarkerLabel = quickLabelInput.value || "";
    };
  }

  const quickKindInput = getEl("mapQuickMarkerKindInput");
  if (quickKindInput) {
    quickKindInput.onchange = () => {
      MAPS_STATE.ui.pendingMarkerKind = normalizeMarkerKind(quickKindInput.value || "marker", "marker");
    };
  }

  const quickColorInput = getEl("mapQuickMarkerColorInput");
  if (quickColorInput) {
    quickColorInput.oninput = () => {
      MAPS_STATE.ui.pendingMarkerColor = quickColorInput.value || "#98dfe3";
    };
  }

  const quickAddMarkerBtn = getEl("mapQuickAddMarkerBtn");
  if (quickAddMarkerBtn) {
    quickAddMarkerBtn.onclick = () => {
      const draft = getPendingMarkerDraft();
      MAPS_STATE.ui.pendingMarkerLabel = draft.label;
      MAPS_STATE.ui.pendingMarkerKind = draft.kind;
      MAPS_STATE.ui.pendingMarkerColor = draft.color;
      toggleMarkerMode(true);
      showToast("Теперь кликни по карте, чтобы поставить метку");
    };
  }

  const quickCancelMarkerBtn = getEl("mapQuickCancelMarkerBtn");
  if (quickCancelMarkerBtn) {
    quickCancelMarkerBtn.onclick = () => {
      toggleMarkerMode(false);
      showToast("Режим добавления метки выключен");
    };
  }

  const clearMarkersBtn = getEl("mapClearMarkersBtn");
  if (clearMarkersBtn) {
    clearMarkersBtn.onclick = async () => {
      const active = getActiveMap();
      if (!active) return;

      const ok = confirm("Очистить все метки на активной карте?");
      if (!ok) return;

      await clearAllMarkers(active.id);
      showToast("Метки очищены");
    };
  }

  document.querySelectorAll("[data-map-select]").forEach((btn) => {
    btn.onclick = () => {
      selectMap(btn.dataset.mapSelect);
    };
  });

  document.querySelectorAll("[data-map-delete]").forEach((btn) => {
    btn.onclick = async () => {
      const mapId = btn.dataset.mapDelete;
      const ok = confirm("Удалить карту?");
      if (!ok) return;
      await deleteMapEntry(mapId);
    };
  });

  document.querySelectorAll("[data-marker-select]").forEach((btn) => {
    btn.onclick = () => {
      MAPS_STATE.ui.selectedMarkerId = btn.dataset.markerSelect;
      renderMaps();
    };
  });

  document.querySelectorAll(".map-marker-btn").forEach((btn) => {
    btn.onclick = (event) => {
      event.stopPropagation();

      if (MAPS_STATE.view.suppressClick) {
        MAPS_STATE.view.suppressClick = false;
        return;
      }

      MAPS_STATE.ui.selectedMarkerId = btn.dataset.markerId;
      renderMaps();
    };

    btn.onpointerdown = (event) => {
      if (MAPS_STATE.view.markerMode) return;
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();

      const active = getActiveMap();
      const markerId = btn.dataset.markerId;
      const marker =
        active?.markers.find((item) => item.id === markerId) || null;

      if (!marker) return;

      MAPS_STATE.ui.selectedMarkerId = markerId;
      MAPS_STATE.view.isDragging = true;
      MAPS_STATE.view.activePointerId = event.pointerId;
      MAPS_STATE.view.dragStartX = event.clientX;
      MAPS_STATE.view.dragStartY = event.clientY;
      MAPS_STATE.view.dragMarkerId = markerId;
      MAPS_STATE.view.dragMarkerStartX = marker.x;
      MAPS_STATE.view.dragMarkerStartY = marker.y;
      MAPS_STATE.view.dragMarkerPreviewX = marker.x;
      MAPS_STATE.view.dragMarkerPreviewY = marker.y;
      MAPS_STATE.view.suppressClick = false;
      setInteractionState("marker");

      try {
        viewport?.setPointerCapture(event.pointerId);
      } catch (_) {}

      updateDraggedMarkerPreviewOnDom();
      applyMapTransform();
    };
  });

  const markerSaveBtn = getEl("mapMarkerSaveBtn");
  if (markerSaveBtn) {
    markerSaveBtn.onclick = async () => {
      const active = getActiveMap();
      const marker = getSelectedMarker();
      if (!active || !marker) return;

      const nextLabel = safeText(getEl("mapMarkerLabelInput")?.value, "").trim() || "Метка";
      const nextColor = safeText(getEl("mapMarkerColorInput")?.value, "#98dfe3") || "#98dfe3";
      const nextKind = normalizeMarkerKind(getEl("mapMarkerKindInput")?.value || marker.kind, "marker");
      const nextDescription = safeText(getEl("mapMarkerDescriptionInput")?.value, "");
      const nextArea = safeText(getEl("mapMarkerAreaInput")?.value, "").trim();
      const nextThreat = safeText(getEl("mapMarkerThreatInput")?.value, "Низкий") || "Низкий";
      const nextReputation = safeText(getEl("mapMarkerReputationInput")?.value, "").trim();
      const nextTraders = getEl("mapMarkerTradersInput") ? normalizeStringList(getEl("mapMarkerTradersInput")?.value || "") : marker.traders;
      const nextQuests = getEl("mapMarkerQuestsInput") ? normalizeStringList(getEl("mapMarkerQuestsInput")?.value || "") : marker.quests;
      const nextEvents = getEl("mapMarkerEventsInput") ? normalizeStringList(getEl("mapMarkerEventsInput")?.value || "") : marker.events;

      await updateMarker(active.id, marker.id, {
        label: nextLabel,
        color: nextColor,
        kind: nextKind,
        type: nextKind,
        description: nextDescription,
        area: nextArea,
        threat: nextThreat,
        reputation: nextReputation,
        traders: nextTraders,
        quests: nextQuests,
        events: nextEvents,
      });

      showToast("Метка обновлена");
    };
  }

  const markerDeleteBtn = getEl("mapMarkerDeleteBtn");
  if (markerDeleteBtn) {
    markerDeleteBtn.onclick = async () => {
      const active = getActiveMap();
      const marker = getSelectedMarker();
      if (!active || !marker) return;

      const ok = confirm(`Удалить метку «${marker.label}»?`);
      if (!ok) return;

      await deleteMarker(active.id, marker.id);
      showToast("Метка удалена");
    };
  }


  [getEl("mapCenterSelectedBtn"), getEl("mapCenterSelectedBtnEditor")].filter(Boolean).forEach((btn) => {
    btn.onclick = () => centerOnMarker();
  });

  const shareLocationBtn = getEl("mapShareLocationBtn");
  if (shareLocationBtn) shareLocationBtn.onclick = () => copySelectedLocation();

  [getEl("mapAddTraderToMarkerBtn")].filter(Boolean).forEach((btn) => {
    btn.onclick = () => addValueToSelectedMarker("traders", "Название торговца для этой метки");
  });

  [getEl("mapAddQuestToMarkerBtn")].filter(Boolean).forEach((btn) => {
    btn.onclick = () => addValueToSelectedMarker("quests", "Название квеста для этой метки");
  });

  [getEl("mapAddEventToMarkerBtn"), getEl("mapAddEventToMarkerBtnBottom")].filter(Boolean).forEach((btn) => {
    btn.onclick = () => addValueToSelectedMarker("events", "Название события для этой метки");
  });

  const viewport = getEl("mapStageViewport");
  const image = getEl("activeMapImage");

  if (viewport) {
    viewport.onwheel = (event) => {
      event.preventDefault();
      const delta = event.deltaY < 0 ? 0.12 : -0.12;
      zoomMap(delta);
    };

    viewport.onpointerdown = (event) => {
      const targetMarker = event.target.closest(".map-marker-btn");
      if (targetMarker) return;
      if (isMapStageControlTarget(event.target)) return;
      if (MAPS_STATE.view.markerMode) return;
      if (event.button !== 0) return;

      MAPS_STATE.view.isDragging = true;
      MAPS_STATE.view.activePointerId = event.pointerId;
      MAPS_STATE.view.dragStartX = event.clientX;
      MAPS_STATE.view.dragStartY = event.clientY;
      MAPS_STATE.view.dragOriginX = MAPS_STATE.view.panX;
      MAPS_STATE.view.dragOriginY = MAPS_STATE.view.panY;
      MAPS_STATE.view.suppressClick = false;
      setInteractionState("pan");

      try {
        viewport.setPointerCapture(event.pointerId);
      } catch (_) {}

      applyMapTransform();
    };

    viewport.onpointermove = (event) => {
      if (!MAPS_STATE.view.isDragging) return;

      const dx = event.clientX - MAPS_STATE.view.dragStartX;
      const dy = event.clientY - MAPS_STATE.view.dragStartY;

      if (MAPS_STATE.view.dragMode === "marker") {
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          MAPS_STATE.view.suppressClick = true;
        }

        const coords = image ? getMarkerCoordsFromClick(event, image) : null;
        if (!coords) return;

        MAPS_STATE.view.dragMarkerPreviewX = coords.x;
        MAPS_STATE.view.dragMarkerPreviewY = coords.y;
        updateDraggedMarkerPreviewOnDom();
        return;
      }

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        MAPS_STATE.view.suppressClick = true;
      }

      MAPS_STATE.view.panX = MAPS_STATE.view.dragOriginX + dx;
      MAPS_STATE.view.panY = MAPS_STATE.view.dragOriginY + dy;

      syncToSharedState();
      applyMapTransform();
      updateViewportStatus();
    };

    viewport.onpointerup = async () => {
      const pointerId = MAPS_STATE.view.activePointerId;

      try {
        if (pointerId !== null && pointerId !== undefined) {
          viewport.releasePointerCapture(pointerId);
        }
      } catch (_) {}

      if (MAPS_STATE.view.dragMode === "marker") {
        await commitDraggedMarker();
        return;
      }

      resetInteractionState();
      applyMapTransform();
    };

    viewport.onpointercancel = () => {
      const pointerId = MAPS_STATE.view.activePointerId;

      try {
        if (pointerId !== null && pointerId !== undefined) {
          viewport.releasePointerCapture(pointerId);
        }
      } catch (_) {}

      resetInteractionState();
      applyMapTransform();
    };
  }

  if (image) {
    image.onclick = async (event) => {
      if (!MAPS_STATE.view.markerMode) return;
      if (MAPS_STATE.view.suppressClick) {
        MAPS_STATE.view.suppressClick = false;
        return;
      }

      const active = getActiveMap();
      if (!active) return;

      const coords = getMarkerCoordsFromClick(event, image);
      if (!coords) return;

      const draft = getPendingMarkerDraft(active);
      const marker = await addMarkerToActiveMap({
        x: coords.x,
        y: coords.y,
        label: draft.label,
        color: draft.color,
        kind: draft.kind,
        type: draft.kind,
        description: "",
        area: active.description || "",
        threat: "Низкий",
        reputation: "Неизвестно",
        traders: [],
        quests: [],
        events: [],
      });

      if (marker) {
        MAPS_STATE.ui.selectedMarkerId = marker.id;
        MAPS_STATE.view.markerMode = false;
        MAPS_STATE.ui.pendingMarkerLabel = "";
        renderMaps();
        showToast("Метка добавлена");
      }
    };
  }
}

// ------------------------------------------------------------
// 🚀 INIT
// ------------------------------------------------------------
export async function initMaps() {
  await loadMapData();
  renderMaps();
}

// ------------------------------------------------------------
// 🌉 LEGACY BRIDGE
// ------------------------------------------------------------
window.mapsModule = {
  loadMapData,
  renderMaps,
  saveMapData,
  createMapEntry,
  deleteMapEntry,
  selectMap,
  zoomMap,
  rotateMap,
  setMapRotation,
  resetMapView,
  toggleMarkerMode,
  addMarkerToActiveMap,
  updateMarker,
  updateMarkerLabel,
  updateMarkerColor,
  deleteMarker,
  clearAllMarkers,
  initMaps,
};
