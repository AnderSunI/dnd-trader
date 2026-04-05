// ============================================================
// frontend/js/filters.js
// Вся логика фильтрации и поиска.
// Ничего не запрашивает с сервера — только работает с state.
// ============================================================

import {
  state,
  setFilters,
  resetFilters,
} from "./state.js";

// ============================================================
// 🧰 ВСПОМОГАТЕЛЬНОЕ
// ============================================================

// Нормализация строки для поиска
function normalizeString(value) {
  return String(value || "").trim().toLowerCase();
}

// Безопасное число
function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Получить "золотую" цену предмета для фильтрации
function getItemGoldValue(item) {
  return toNumber(item.buy_price_gold ?? item.price_gold ?? 0, 0);
}

// Есть ли совпадение по тексту
function traderMatchesSearch(trader, search) {
  if (!search) return true;

  const traderName = normalizeString(trader.name);
  const traderDesc = normalizeString(trader.description);
  const traderType = normalizeString(trader.type);
  const traderRegion = normalizeString(trader.region);

  const directMatch =
    traderName.includes(search) ||
    traderDesc.includes(search) ||
    traderType.includes(search) ||
    traderRegion.includes(search);

  if (directMatch) return true;

  const items = Array.isArray(trader.items) ? trader.items : [];

  return items.some((item) => {
    const itemName = normalizeString(item.name);
    const itemDesc = normalizeString(item.description);
    const itemCategory = normalizeString(item.category);
    return (
      itemName.includes(search) ||
      itemDesc.includes(search) ||
      itemCategory.includes(search)
    );
  });
}

// Есть ли у торговца предметы нужной категории
function traderMatchesCategory(trader, category) {
  if (!category || category === "all") return true;

  const items = Array.isArray(trader.items) ? trader.items : [];
  return items.some((item) => String(item.category || "") === String(category));
}

// Есть ли у торговца предметы нужной редкости
function traderMatchesRarity(trader, rarity) {
  if (!rarity || rarity === "all") return true;

  const items = Array.isArray(trader.items) ? trader.items : [];
  return items.some((item) => String(item.rarity || "") === String(rarity));
}

// Совпадает ли регион
function traderMatchesRegion(trader, region) {
  if (!region || region === "all") return true;
  return String(trader.region || "") === String(region);
}

// Совпадает ли тип торговца
function traderMatchesType(trader, traderType) {
  if (!traderType || traderType === "all") return true;
  return String(trader.type || "") === String(traderType);
}

// Подходит ли по диапазону цен
function traderMatchesPriceRange(trader, minPrice, maxPrice) {
  if (minPrice == null && maxPrice == null) return true;

  const items = Array.isArray(trader.items) ? trader.items : [];
  if (!items.length) return false;

  return items.some((item) => {
    const value = getItemGoldValue(item);

    if (minPrice != null && value < minPrice) return false;
    if (maxPrice != null && value > maxPrice) return false;

    return true;
  });
}

// ============================================================
// 📥 ЧТЕНИЕ ФИЛЬТРОВ ИЗ DOM
// ============================================================

// Считать текущие фильтры из HTML
export function readFiltersFromDom() {
  const nextFilters = {
    search:
      document.getElementById("searchInput")?.value?.trim() ||
      document.getElementById("searchTrader")?.value?.trim() ||
      "",
    category:
      document.getElementById("categoryFilter")?.value ||
      "all",
    region:
      document.getElementById("regionFilter")?.value ||
      document.getElementById("filterRegion")?.value ||
      "all",
    traderType:
      document.getElementById("typeFilter")?.value ||
      document.getElementById("filterType")?.value ||
      "all",
    rarity:
      document.getElementById("rarityFilter")?.value ||
      "all",
    minPrice: document.getElementById("minPrice")?.value || null,
    maxPrice: document.getElementById("maxPrice")?.value || null,
  };

  setFilters(nextFilters);
  return state.filters;
}

// ============================================================
// 🔎 ПРИМЕНЕНИЕ ФИЛЬТРОВ
// ============================================================

// Получить отфильтрованный список торговцев
export function getFilteredTraders(traders = state.traders) {
  const filters = state.filters || {};

  const search = normalizeString(filters.search);
  const category = filters.category;
  const region = filters.region;
  const traderType = filters.traderType;
  const rarity = filters.rarity;

  const minPrice =
    filters.minPrice !== null &&
    filters.minPrice !== undefined &&
    filters.minPrice !== ""
      ? Number(filters.minPrice)
      : null;

  const maxPrice =
    filters.maxPrice !== null &&
    filters.maxPrice !== undefined &&
    filters.maxPrice !== ""
      ? Number(filters.maxPrice)
      : null;

  return (Array.isArray(traders) ? traders : []).filter((trader) => {
    if (!traderMatchesSearch(trader, search)) return false;
    if (!traderMatchesCategory(trader, category)) return false;
    if (!traderMatchesRegion(trader, region)) return false;
    if (!traderMatchesType(trader, traderType)) return false;
    if (!traderMatchesRarity(trader, rarity)) return false;
    if (!traderMatchesPriceRange(trader, minPrice, maxPrice)) return false;

    return true;
  });
}

// ============================================================
// 🧹 СБРОС ФИЛЬТРОВ В DOM
// ============================================================

// Очистить поля фильтров в HTML
export function resetFiltersInDom() {
  const ids = [
    "searchInput",
    "searchTrader",
    "categoryFilter",
    "regionFilter",
    "filterRegion",
    "typeFilter",
    "filterType",
    "rarityFilter",
    "minPrice",
    "maxPrice",
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    if (el.tagName === "SELECT") {
      el.value = "all";
    } else {
      el.value = "";
    }
  });

  resetFilters();
}

// ============================================================
// 🎛 ПРИВЯЗКА СОБЫТИЙ
// ============================================================

// Навесить обработчики на фильтры
export function bindFilterEvents(onChange) {
  const ids = [
    "searchInput",
    "searchTrader",
    "categoryFilter",
    "regionFilter",
    "filterRegion",
    "typeFilter",
    "filterType",
    "rarityFilter",
    "minPrice",
    "maxPrice",
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    const eventName = el.tagName === "SELECT" ? "change" : "input";

    el.addEventListener(eventName, () => {
      readFiltersFromDom();
      if (typeof onChange === "function") {
        onChange();
      }
    });
  });

  const resetBtn = document.getElementById("resetFiltersBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      resetFiltersInDom();
      if (typeof onChange === "function") {
        onChange();
      }
    });
  }
}