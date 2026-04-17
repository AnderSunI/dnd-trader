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
function normalizeMarker(marker, index = 0) {
  if (!marker || typeof marker !== "object") {
    return {
      id: makeId(`marker_${index}`),
      x: 50,
      y: 50,
      label: safeText(marker, "Метка"),
      color: "#98dfe3",
    };
  }

  return {
    id: marker.id || makeId(`marker_${index}`),
    x: clampPercent(marker.x ?? 50),
    y: clampPercent(marker.y ?? 50),
    label: safeText(marker.label || marker.name, "Метка"),
    color: safeText(marker.color, "#98dfe3") || "#98dfe3",
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

  let data = await apiGet([
    "/player/maps",
    "/maps/me",
    "/maps",
  ]);
  let source = "api";

  if (!data) {
    data = tryLoadFromWindow();
    source = "window";
  }

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

  const result = await apiWrite(
    ["/player/maps", "/maps/me", "/maps"],
    { maps: MAPS_STATE.maps },
    ["POST", "PUT", "PATCH"]
  );

  MAPS_STATE.source = result ? "api" : "local";
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

export function rotateMap(delta = 90) {
  MAPS_STATE.view.rotation = (MAPS_STATE.view.rotation + delta) % 360;
  syncToSharedState();
  applyMapTransform();
  updateViewportStatus();
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

  if (MAPS_STATE.view.markerMode) {
    viewport.style.cursor = "crosshair";
  } else if (MAPS_STATE.view.isDragging) {
    viewport.style.cursor = "grabbing";
  } else {
    viewport.style.cursor = "grab";
  }
}

function updateViewportStatus() {
  const info = getEl("mapViewportInfo");
  const active = getActiveMap();
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
    border-color:${escapeHtml(marker.color)};
    box-shadow:0 0 10px ${escapeHtml(marker.color)}55;
    background:${selected ? "rgba(20,35,42,0.98)" : "rgba(7,16,20,0.95)"};
    outline:${selected ? `2px solid ${escapeHtml(marker.color)}` : "none"};
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

// ------------------------------------------------------------
// 🎨 RENDER HELPERS
// ------------------------------------------------------------
function renderSummaryBar() {
  const active = getActiveMap();

  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="flex-between" style="align-items:center; gap:12px; flex-wrap:wrap;">
        <div class="trader-meta">
          <span class="meta-item">Карт: ${MAPS_STATE.maps.length}</span>
          <span class="meta-item">Источник: ${escapeHtml(MAPS_STATE.source)}</span>
          <span class="meta-item">Роль: ${escapeHtml(MAPS_STATE.role)}</span>
          ${
            active
              ? `<span class="meta-item">Активная: ${escapeHtml(active.name)}</span>`
              : `<span class="meta-item">Активная: нет</span>`
          }
        </div>

        <div class="cart-buttons">
          <button class="btn" type="button" id="mapsRefreshBtn">Обновить</button>
          <button class="btn btn-primary" type="button" id="mapsToggleCreateBtn">
            ${MAPS_STATE.ui.createOpen ? "Скрыть форму" : "＋ Новая карта"}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderCreateForm() {
  return `
    <div
      class="cabinet-block"
      id="mapsCreateBlock"
      style="${MAPS_STATE.ui.createOpen ? "" : "display:none;"} margin-bottom:12px;"
    >
      <h3>Новая карта</h3>

      <div class="collection-toolbar compact-collection-toolbar">
        <div class="filter-group">
          <label>Название</label>
          <input id="mapFormName" type="text" placeholder="Например: Мир Торана" />
        </div>

        <div class="filter-group" style="min-width:260px; flex:1 1 260px;">
          <label>Описание</label>
          <input id="mapFormDescription" type="text" placeholder="Краткое описание карты" />
        </div>

        <div class="filter-group">
          <label>Изображение</label>
          <input id="mapFormFile" type="file" accept="image/*" />
        </div>
      </div>

      <div class="modal-actions" style="margin-top:12px;">
        <button class="btn btn-success" type="button" id="mapFormSaveBtn">Сохранить</button>
        <button class="btn" type="button" id="mapFormCancelBtn">Скрыть</button>
      </div>
    </div>
  `;
}

function renderMapViewer() {
  const active = getActiveMap();

  if (!active) {
    return `
      <div class="cabinet-block">
        <h3>Просмотрщик карты</h3>
        <p>Активная карта не выбрана.</p>
      </div>
    `;
  }

  if (!active.image) {
    return `
      <div class="cabinet-block">
        <h3>${escapeHtml(active.name)}</h3>
        <p>У карты пока нет изображения.</p>
      </div>
    `;
  }

  const selectedMarker = getSelectedMarker();

  return `
    <div class="cabinet-block" style="margin-bottom:12px;">
      <div class="flex-between" style="align-items:flex-start; gap:12px; margin-bottom:10px; flex-wrap:wrap;">
        <div>
          <h3 style="margin-bottom:4px;">${escapeHtml(active.name)}</h3>
          ${
            active.description
              ? `<div class="muted">${escapeHtml(active.description)}</div>`
              : `<div class="muted">Без описания</div>`
          }
        </div>

        <div class="muted" id="mapViewportInfo">
          Zoom: ${escapeHtml(MAPS_STATE.view.zoom.toFixed(2))}
          • Rotate: ${escapeHtml(String(MAPS_STATE.view.rotation))}°
          • Pan: ${escapeHtml(String(Math.round(MAPS_STATE.view.panX)))}, ${escapeHtml(String(Math.round(MAPS_STATE.view.panY)))}
          • Метки: ${escapeHtml(String(active.markers.length))}
        </div>
      </div>

      <div
        id="mapStageViewport"
        class="map-stage-outer"
        style="
          position:relative;
          overflow:hidden;
          width:100%;
          min-height:540px;
          max-height:74vh;
          border:1px solid rgba(152,223,227,0.10);
          border-radius:18px;
          background:
            radial-gradient(circle at center, rgba(20,40,48,0.25), transparent 42%),
            rgba(4,12,16,0.62);
          padding:14px;
          display:flex;
          align-items:center;
          justify-content:center;
          user-select:none;
          touch-action:none;
        "
      >
        <div
          id="mapTransformLayer"
          style="
            position:relative;
            width:max-content;
            max-width:none;
            transform-origin:center center;
            will-change:transform;
          "
        >
          <img
            id="activeMapImage"
            src="${escapeHtml(active.image)}"
            alt="${escapeHtml(active.name)}"
            draggable="false"
            style="
              display:block;
              max-width:min(100%, 1200px);
              max-height:64vh;
              min-width:320px;
              border-radius:12px;
              user-select:none;
              pointer-events:auto;
            "
          />

          ${active.markers
            .map((marker) => {
              const isSelected = selectedMarker?.id === marker.id;

              return `
                <button
                  type="button"
                  class="map-marker-btn"
                  data-marker-id="${escapeHtml(marker.id)}"
                  style="
                    position:absolute;
                    transform:translate(-50%, -100%);
                    ${buildMarkerStyle(marker, isSelected)}
                    color:#e8f2f5;
                    border-radius:999px;
                    border:2px solid ${escapeHtml(marker.color)};
                    padding:5px 9px;
                    font-size:12px;
                    font-weight:700;
                    cursor:pointer;
                  "
                  title="${escapeHtml(marker.label)}"
                >
                  📍 ${escapeHtml(marker.label)}
                </button>
              `;
            })
            .join("")}
        </div>
      </div>

      <div class="collection-toolbar compact-collection-toolbar" style="margin-top:12px;">
        <div class="filter-group">
          <label>Управление</label>
          <div class="cart-buttons">
            <span class="muted">Перетаскивание, zoom и метки</span>
          </div>
        </div>

        <div class="filter-group">
          <label>Масштаб</label>
          <div class="cart-buttons">
            <button class="btn" type="button" id="mapZoomOutBtn">−</button>
            <button class="btn" type="button" id="mapZoomInBtn">＋</button>
            <button class="btn" type="button" id="mapResetViewBtn">Сброс</button>
          </div>
        </div>

        <div class="filter-group">
          <label>Поворот</label>
          <div class="cart-buttons">
            <button class="btn" type="button" id="mapRotateBtn">↻ 90°</button>
          </div>
        </div>

        <div class="filter-group">
          <label>Метки</label>
          <div class="cart-buttons">
            <button class="btn ${MAPS_STATE.view.markerMode ? "btn-primary" : ""}" type="button" id="mapMarkerModeBtn">
              ${MAPS_STATE.view.markerMode ? "Добавление: ВКЛ" : "Добавление: ВЫКЛ"}
            </button>
            ${
              active.markers.length
                ? `<button class="btn btn-danger" type="button" id="mapClearMarkersBtn">Очистить все</button>`
                : ""
            }
          </div>
        </div>
      </div>

      <div class="muted" style="margin-top:10px;">
        ${
          MAPS_STATE.view.markerMode
            ? "Режим меток включён. Кликни по карте, чтобы поставить новую метку."
            : "Зажми левую кнопку мыши и двигай карту. Колёсико мыши меняет масштаб."
        }
      </div>
    </div>
  `;
}

function renderMarkerEditor() {
  const active = getActiveMap();
  const marker = getSelectedMarker();

  if (!active) return "";

  return `
    <div class="cabinet-layout" style="grid-template-columns: minmax(0, 1fr) 340px; gap:12px; margin-bottom:12px;">
      <div class="cabinet-block">
        <h3>Список карт</h3>
        ${
          MAPS_STATE.maps.length
            ? `
              <div class="quest-list">
                ${MAPS_STATE.maps
                  .map((map) => {
                    const activeFlag = map.id === MAPS_STATE.activeMapId;

                    return `
                      <div class="quest-item">
                        <div class="flex-between" style="align-items:flex-start; gap:12px;">
                          <div style="flex:1 1 auto;">
                            <h4 style="margin-bottom:6px;">
                              ${activeFlag ? "🟢" : "🗺️"} ${escapeHtml(map.name)}
                            </h4>

                            ${
                              map.description
                                ? `<div>${escapeHtml(map.description)}</div>`
                                : `<div class="muted">Без описания</div>`
                            }

                            <div class="muted" style="margin-top:8px;">
                              Меток: ${map.markers.length}
                              • Обновлено: ${escapeHtml(formatDate(map.updated_at))}
                            </div>
                          </div>

                          <div class="cart-buttons">
                            <button class="btn" type="button" data-map-select="${escapeHtml(map.id)}">Открыть</button>
                            <button class="btn btn-danger" type="button" data-map-delete="${escapeHtml(map.id)}">Удалить</button>
                          </div>
                        </div>
                      </div>
                    `;
                  })
                  .join("")}
              </div>
            `
            : `<p>Карт пока нет.</p>`
        }
      </div>

      <div class="cabinet-block">
        <h3>Метки карты</h3>

        ${
          active.markers.length
            ? `
              <div style="max-height:240px; overflow:auto; margin-bottom:12px;">
                ${active.markers
                  .map((item) => {
                    const selected = marker?.id === item.id;
                    return `
                      <button
                        type="button"
                        data-marker-select="${escapeHtml(item.id)}"
                        class="btn ${selected ? "btn-primary" : ""}"
                        style="width:100%; justify-content:flex-start; text-align:left; margin-bottom:8px; border-radius:12px;"
                      >
                        <span style="display:inline-flex; width:12px; height:12px; border-radius:999px; background:${escapeHtml(item.color)}; margin-right:8px;"></span>
                        ${escapeHtml(item.label)}
                      </button>
                    `;
                  })
                  .join("")}
              </div>
            `
            : `<p class="muted">На этой карте пока нет меток.</p>`
        }

        ${
          marker
            ? `
              <div class="filter-group" style="margin-bottom:10px;">
                <label>Название метки</label>
                <input id="mapMarkerLabelInput" type="text" value="${escapeHtml(marker.label)}" />
              </div>

              <div class="filter-group" style="margin-bottom:10px;">
                <label>Цвет метки</label>
                <input
                  id="mapMarkerColorInput"
                  type="color"
                  value="${escapeHtml(marker.color || "#98dfe3")}"
                  style="height:42px; padding:6px;"
                />
              </div>

              <div class="modal-actions">
                <button class="btn btn-success" type="button" id="mapMarkerSaveBtn">Сохранить метку</button>
                <button class="btn btn-danger" type="button" id="mapMarkerDeleteBtn">Удалить метку</button>
              </div>

              <div class="muted" style="margin-top:10px;">
                Координаты: X ${Math.round(marker.x)}% • Y ${Math.round(marker.y)}%
              </div>
            `
            : `
              <div class="muted">
                Выбери метку из списка или кликни по ней на карте.  
                Для новой метки включи режим добавления и кликни по карте.
              </div>
            `
        }
      </div>
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
    ${renderSummaryBar()}
    ${renderCreateForm()}
    ${renderMapViewer()}
    ${renderMarkerEditor()}
  `;

  applyMapTransform();
  bindMapActions();
  syncToSharedState();
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

  const resetBtn = getEl("mapResetViewBtn");
  if (resetBtn) resetBtn.onclick = () => resetMapView(true);

  const markerModeBtn = getEl("mapMarkerModeBtn");
  if (markerModeBtn) markerModeBtn.onclick = () => toggleMarkerMode();

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
      MAPS_STATE.ui.selectedMarkerId = btn.dataset.markerId;
      renderMaps();
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

      await updateMarker(active.id, marker.id, {
        label: nextLabel,
        color: nextColor,
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
      if (MAPS_STATE.view.markerMode) return;
      if (event.button !== 0) return;

      MAPS_STATE.view.isDragging = true;
      MAPS_STATE.view.dragStartX = event.clientX;
      MAPS_STATE.view.dragStartY = event.clientY;
      MAPS_STATE.view.dragOriginX = MAPS_STATE.view.panX;
      MAPS_STATE.view.dragOriginY = MAPS_STATE.view.panY;
      MAPS_STATE.view.suppressClick = false;

      try {
        viewport.setPointerCapture(event.pointerId);
      } catch (_) {}

      applyMapTransform();
    };

    viewport.onpointermove = (event) => {
      if (!MAPS_STATE.view.isDragging) return;

      const dx = event.clientX - MAPS_STATE.view.dragStartX;
      const dy = event.clientY - MAPS_STATE.view.dragStartY;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        MAPS_STATE.view.suppressClick = true;
      }

      MAPS_STATE.view.panX = MAPS_STATE.view.dragOriginX + dx;
      MAPS_STATE.view.panY = MAPS_STATE.view.dragOriginY + dy;

      syncToSharedState();
      applyMapTransform();
      updateViewportStatus();
    };

    viewport.onpointerup = (event) => {
      MAPS_STATE.view.isDragging = false;
      try {
        viewport.releasePointerCapture(event.pointerId);
      } catch (_) {}
      applyMapTransform();
    };

    viewport.onpointercancel = (event) => {
      MAPS_STATE.view.isDragging = false;
      try {
        viewport.releasePointerCapture(event.pointerId);
      } catch (_) {}
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

      const marker = await addMarkerToActiveMap({
        x: coords.x,
        y: coords.y,
        label: `Метка ${active.markers.length + 1}`,
        color: "#98dfe3",
      });

      if (marker) {
        MAPS_STATE.ui.selectedMarkerId = marker.id;
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