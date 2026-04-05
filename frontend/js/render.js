// frontend/js/filters.js

import { state } from "./state.js";

const categoryNames = {
  weapon: "Оружие",
  armor: "Броня",
  accessory: "Аксессуары",
  scrolls_books: "Свитки и книги",
  consumables: "Расходники",
  potions_elixirs: "Зелья и эликсиры",
  alchemy: "Алхимия",
  food_drink: "Еда и напитки",
  tools: "Инструменты",
  misc: "Разное",
};

function normalizeString(value) {
  return String(value || "").trim().toLowerCase();
}

function getItemNumericPrice(item) {
  const g = Number(item.buy_price_gold ?? item.price_gold ?? 0);
  const s = Number(item.buy_price_silver ?? item.price_silver ?? 0);
  const c = Number(item.buy_price_copper ?? item.price_copper ?? 0);
  return g + s / 100 + c / 10000;
}

export function populateFilterOptions(traders) {
  const typeSelect = document.getElementById("filterType");
  const regionSelect = document.getElementById("filterRegion");
  const categorySelect = document.getElementById("categoryFilter");

  if (!Array.isArray(traders)) return;

  const types = new Set();
  const regions = new Set();
  const categories = new Set();

  traders.forEach((trader) => {
    if (trader.type) types.add(trader.type);
    if (trader.region) regions.add(trader.region);

    (trader.items || []).forEach((item) => {
      if (item.category) categories.add(item.category);
    });
  });

  if (typeSelect) {
    typeSelect.innerHTML = `<option value="">Все типы</option>`;
    Array.from(types).sort((a, b) => a.localeCompare(b, "ru")).forEach((type) => {
      typeSelect.innerHTML += `<option value="${type}">${type}</option>`;
    });
  }

  if (regionSelect) {
    regionSelect.innerHTML = `<option value="">Все регионы</option>`;
    Array.from(regions).sort((a, b) => a.localeCompare(b, "ru")).forEach((region) => {
      regionSelect.innerHTML += `<option value="${region}">${region}</option>`;
    });
  }

  if (categorySelect) {
    categorySelect.innerHTML = `<option value="">Любая</option>`;
    Array.from(categories).sort((a, b) => a.localeCompare(b, "ru")).forEach((category) => {
      categorySelect.innerHTML += `<option value="${category}">${categoryNames[category] || category}</option>`;
    });
  }
}

export function readFiltersFromDom() {
  const searchTrader = document.getElementById("searchTrader")?.value || "";
  const filterType = document.getElementById("filterType")?.value || "";
  const filterRegion = document.getElementById("filterRegion")?.value || "";
  const filterLevel = Number(document.getElementById("filterLevel")?.value || 0);
  const reputationFilter = document.getElementById("reputationFilter")?.value || "";
  const searchItem = document.getElementById("searchItem")?.value || "";
  const priceMinRaw = document.getElementById("priceMin")?.value || "";
  const priceMaxRaw = document.getElementById("priceMax")?.value || "";
  const rarityFilter = document.getElementById("rarityFilter")?.value || "";
  const categoryFilter = document.getElementById("categoryFilter")?.value || "";
  const magicOnly = Boolean(document.getElementById("magicOnly")?.checked);
  const sortBy = document.getElementById("sortBy")?.value || "name";

  state.filters = {
    searchTrader,
    filterType,
    filterRegion,
    filterLevel,
    reputationFilter,
    searchItem,
    priceMin: priceMinRaw === "" ? null : Number(priceMinRaw),
    priceMax: priceMaxRaw === "" ? null : Number(priceMaxRaw),
    rarityFilter,
    categoryFilter,
    magicOnly,
    sortBy,
  };

  return state.filters;
}

function itemMatchesFilters(item, filters) {
  const itemSearch = normalizeString(filters.searchItem);
  const itemName = normalizeString(item.name);

  if (itemSearch && !itemName.includes(itemSearch)) return false;

  const price = getItemNumericPrice(item);
  if (filters.priceMin !== null && price < filters.priceMin) return false;
  if (filters.priceMax !== null && price > filters.priceMax) return false;
  if (filters.rarityFilter && item.rarity !== filters.rarityFilter) return false;
  if (filters.categoryFilter && item.category !== filters.categoryFilter) return false;
  if (filters.magicOnly && !item.is_magical) return false;

  return true;
}

export function getFilteredTraders(traders) {
  const filters = readFiltersFromDom();

  let filtered = (traders || []).filter((trader) => {
    const traderName = normalizeString(trader.name);

    if (filters.searchTrader && !traderName.includes(normalizeString(filters.searchTrader))) {
      return false;
    }
    if (filters.filterType && trader.type !== filters.filterType) return false;
    if (filters.filterRegion && trader.region !== filters.filterRegion) return false;

    if (filters.filterLevel > 0) {
      const min = Number(trader.level_min || 1);
      const max = Number(trader.level_max || 999);
      if (filters.filterLevel < min || filters.filterLevel > max) return false;
    }

    if (filters.reputationFilter) {
      const minRep = Number(filters.reputationFilter);
      if (Number(trader.reputation || 0) < minRep) return false;
    }

    const items = Array.isArray(trader.items) ? trader.items : [];
    return items.some((item) => itemMatchesFilters(item, filters));
  });

  if (filters.sortBy === "name") {
    filtered.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
  } else if (filters.sortBy === "reputation") {
    filtered.sort((a, b) => Number(b.reputation || 0) - Number(a.reputation || 0));
  } else if (filters.sortBy === "price_asc") {
    filtered.sort((a, b) => {
      const aMin = Math.min(...(a.items || []).map(getItemNumericPrice));
      const bMin = Math.min(...(b.items || []).map(getItemNumericPrice));
      return aMin - bMin;
    });
  } else if (filters.sortBy === "price_desc") {
    filtered.sort((a, b) => {
      const aMax = Math.max(...(a.items || []).map(getItemNumericPrice));
      const bMax = Math.max(...(b.items || []).map(getItemNumericPrice));
      return bMax - aMax;
    });
  }

  return filtered;
}

export function bindFilterEvents(onChange) {
  const ids = [
    "searchTrader",
    "filterType",
    "filterRegion",
    "filterLevel",
    "reputationFilter",
    "searchItem",
    "priceMin",
    "priceMax",
    "rarityFilter",
    "categoryFilter",
    "magicOnly",
    "sortBy",
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const eventName = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
    el.addEventListener(eventName, onChange);
  });
}