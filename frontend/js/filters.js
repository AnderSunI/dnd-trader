// ============================================================
// frontend/js/filters.js
// Фильтрация и сортировка торговцев/товаров
// - безопасен к пустому DOM
// - не ломает текущую страницу
// - умеет читать/сбрасывать фильтры
// - умеет фильтровать и сортировать список торговцев
// - умеет возвращать совпавшие товары по торговцу
// ============================================================

// ------------------------------------------------------------
// 🧰 HELPERS
// ------------------------------------------------------------
function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getItems(trader) {
  return Array.isArray(trader?.items) ? trader.items : [];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeRarityValue(value) {
  const raw = normalize(value);

  if (!raw) return "";
  if (raw === "veryrare" || raw === "very rare" || raw === "очень редкий") return "very rare";
  if (raw === "uncommon" || raw === "необычный") return "uncommon";
  if (raw === "common" || raw === "обычный") return "common";
  if (raw === "rare" || raw === "редкий") return "rare";
  if (raw === "legendary" || raw === "легендарный") return "legendary";
  if (raw === "artifact" || raw === "артефакт") return "artifact";
  if (raw === "epic" || raw === "эпик" || raw === "эпический") return "rare";

  return raw;
}

function normalizeCategoryValue(value) {
  return normalize(value);
}

function getItemPriceGold(item) {
  if (item?.buy_price_gold != null) return toNumber(item.buy_price_gold, 0);
  if (item?.price_gold != null) return toNumber(item.price_gold, 0);

  if (
    item?.buy_price_silver != null ||
    item?.buy_price_copper != null ||
    item?.price_silver != null ||
    item?.price_copper != null
  ) {
    const gold = toNumber(item?.buy_price_gold ?? item?.price_gold, 0);
    const silver = toNumber(item?.buy_price_silver ?? item?.price_silver, 0);
    const copper = toNumber(item?.buy_price_copper ?? item?.price_copper, 0);
    return gold + silver / 100 + copper / 10000;
  }

  return 0;
}

function getItemSearchBlob(item) {
  return [
    item?.name,
    item?.description,
    item?.category,
    item?.category_clean,
    item?.subcategory,
    item?.rarity,
    item?.properties,
    item?.effects,
  ]
    .map((x) => normalize(x))
    .filter(Boolean)
    .join(" ");
}

function getTraderSearchBlob(trader) {
  return [
    trader?.name,
    trader?.description,
    trader?.type,
    trader?.region,
    trader?.settlement,
    trader?.specialization,
    trader?.location_name,
    trader?.location_description,
  ]
    .map((x) => normalize(x))
    .filter(Boolean)
    .join(" ");
}

function getElementValue(id, fallback = "") {
  return document.getElementById(id)?.value ?? fallback;
}

// ------------------------------------------------------------
// 📥 READ / WRITE FILTERS FROM DOM
// ------------------------------------------------------------
export function readFiltersFromDom() {
  return {
    traderSearch: String(getElementValue("searchInput", "")).trim(),
    traderType: String(getElementValue("typeFilter", "")).trim(),
    region: String(getElementValue("regionFilter", "")).trim(),
    playerLevel: toNumber(getElementValue("playerLevelFilter", 0), 0),
    minReputation: String(getElementValue("reputationFilter", "")).trim(),

    itemSearch: String(getElementValue("itemSearchInput", "")).trim(),
    minPrice: String(getElementValue("priceMin", "")).trim(),
    maxPrice: String(getElementValue("priceMax", "")).trim(),
    rarity: String(getElementValue("rarityFilter", "")).trim(),
    category: String(getElementValue("categoryFilter", "")).trim(),
    magicFilter: String(getElementValue("magicFilter", "")).trim(),
    sort: String(getElementValue("sortFilter", "name_asc")).trim() || "name_asc",
  };
}

export function writeFiltersToDom(filters = {}) {
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };

  setValue("searchInput", filters.traderSearch ?? "");
  setValue("typeFilter", filters.traderType ?? "");
  setValue("regionFilter", filters.region ?? "");
  setValue("playerLevelFilter", filters.playerLevel ?? 0);
  setValue("reputationFilter", filters.minReputation ?? "");

  setValue("itemSearchInput", filters.itemSearch ?? "");
  setValue("priceMin", filters.minPrice ?? "");
  setValue("priceMax", filters.maxPrice ?? "");
  setValue("rarityFilter", filters.rarity ?? "");
  setValue("categoryFilter", filters.category ?? "");
  setValue("magicFilter", filters.magicFilter ?? "");
  setValue("sortFilter", filters.sort ?? "name_asc");
}

// ------------------------------------------------------------
// 🔎 FILTER LOGIC
// ------------------------------------------------------------
function matchesTraderSearch(trader, traderSearch) {
  if (!traderSearch) return true;
  return getTraderSearchBlob(trader).includes(normalize(traderSearch));
}

function matchesTraderType(trader, traderType) {
  if (!traderType) return true;
  return normalize(trader?.type) === normalize(traderType);
}

function matchesRegion(trader, region) {
  if (!region) return true;
  return normalize(trader?.region) === normalize(region);
}

function matchesPlayerLevel(trader, playerLevel) {
  if (!playerLevel || playerLevel <= 0) return true;

  const min = toNumber(trader?.level_min, 0);
  const max = toNumber(trader?.level_max, 999);

  return playerLevel >= min && playerLevel <= max;
}

function matchesMinReputation(trader, minReputation) {
  if (minReputation === "" || minReputation == null) return true;
  return toNumber(trader?.reputation, 0) >= toNumber(minReputation, 0);
}

function matchesItemSearch(items, itemSearch) {
  if (!itemSearch) return true;
  const needle = normalize(itemSearch);
  return items.some((item) => getItemSearchBlob(item).includes(needle));
}

function matchesPrice(items, minPrice, maxPrice) {
  const hasMin = minPrice !== "" && minPrice != null;
  const hasMax = maxPrice !== "" && maxPrice != null;

  if (!hasMin && !hasMax) return true;

  const min = hasMin ? toNumber(minPrice, 0) : null;
  const max = hasMax ? toNumber(maxPrice, Number.MAX_SAFE_INTEGER) : null;

  return items.some((item) => {
    const price = getItemPriceGold(item);

    if (min != null && price < min) return false;
    if (max != null && price > max) return false;

    return true;
  });
}

function matchesRarity(items, rarity) {
  if (!rarity) return true;

  const target = normalizeRarityValue(rarity);
  return items.some((item) => normalizeRarityValue(item?.rarity) === target);
}

function matchesCategory(items, category) {
  if (!category) return true;

  const target = normalizeCategoryValue(category);
  return items.some((item) => {
    return (
      normalizeCategoryValue(item?.category) === target ||
      normalizeCategoryValue(item?.category_clean) === target
    );
  });
}

function matchesMagic(items, magicFilter) {
  if (!magicFilter) return true;

  if (magicFilter === "magic") {
    return items.some((item) => Boolean(item?.is_magical));
  }

  if (magicFilter === "mundane") {
    return items.some((item) => !Boolean(item?.is_magical));
  }

  return true;
}

function noItemFilters(filters) {
  return (
    !filters.itemSearch &&
    !filters.minPrice &&
    !filters.maxPrice &&
    !filters.rarity &&
    !filters.category &&
    !filters.magicFilter
  );
}

// ------------------------------------------------------------
// ✂️ FILTER TRADERS
// ------------------------------------------------------------
export function filterTraders(traders, filters = {}) {
  const traderList = Array.isArray(traders) ? traders : [];

  return traderList.filter((trader) => {
    const items = getItems(trader);

    if (!matchesTraderSearch(trader, filters.traderSearch)) return false;
    if (!matchesTraderType(trader, filters.traderType)) return false;
    if (!matchesRegion(trader, filters.region)) return false;
    if (!matchesPlayerLevel(trader, filters.playerLevel)) return false;
    if (!matchesMinReputation(trader, filters.minReputation)) return false;

    if (noItemFilters(filters)) return true;

    if (!matchesItemSearch(items, filters.itemSearch)) return false;
    if (!matchesPrice(items, filters.minPrice, filters.maxPrice)) return false;
    if (!matchesRarity(items, filters.rarity)) return false;
    if (!matchesCategory(items, filters.category)) return false;
    if (!matchesMagic(items, filters.magicFilter)) return false;

    return true;
  });
}

// ------------------------------------------------------------
// 🧩 MATCHED ITEMS BY TRADER
// ------------------------------------------------------------
export function getMatchedItemsForTrader(trader, filters = {}) {
  const items = getItems(trader);

  return items.filter((item) => {
    if (filters.itemSearch && !getItemSearchBlob(item).includes(normalize(filters.itemSearch))) {
      return false;
    }

    if (filters.minPrice || filters.maxPrice) {
      const price = getItemPriceGold(item);
      const hasMin = filters.minPrice !== "" && filters.minPrice != null;
      const hasMax = filters.maxPrice !== "" && filters.maxPrice != null;

      if (hasMin && price < toNumber(filters.minPrice, 0)) return false;
      if (hasMax && price > toNumber(filters.maxPrice, Number.MAX_SAFE_INTEGER)) return false;
    }

    if (filters.rarity) {
      if (normalizeRarityValue(item?.rarity) !== normalizeRarityValue(filters.rarity)) {
        return false;
      }
    }

    if (filters.category) {
      const itemCategory = normalizeCategoryValue(item?.category);
      const itemCategoryClean = normalizeCategoryValue(item?.category_clean);
      const target = normalizeCategoryValue(filters.category);

      if (itemCategory !== target && itemCategoryClean !== target) {
        return false;
      }
    }

    if (filters.magicFilter === "magic" && !Boolean(item?.is_magical)) return false;
    if (filters.magicFilter === "mundane" && Boolean(item?.is_magical)) return false;

    return true;
  });
}

// ------------------------------------------------------------
// 📊 SORT
// ------------------------------------------------------------
function getTraderMinPrice(trader) {
  const items = getItems(trader);
  if (!items.length) return 0;
  return Math.min(...items.map(getItemPriceGold));
}

function getTraderMaxPrice(trader) {
  const items = getItems(trader);
  if (!items.length) return 0;
  return Math.max(...items.map(getItemPriceGold));
}

export function sortTraders(traders, sortKey = "name_asc") {
  const list = [...(Array.isArray(traders) ? traders : [])];

  list.sort((a, b) => {
    if (sortKey === "price_asc") {
      return getTraderMinPrice(a) - getTraderMinPrice(b);
    }

    if (sortKey === "price_desc") {
      return getTraderMaxPrice(b) - getTraderMaxPrice(a);
    }

    if (sortKey === "reputation_desc") {
      return toNumber(b?.reputation, 0) - toNumber(a?.reputation, 0);
    }

    return normalize(a?.name).localeCompare(normalize(b?.name), "ru");
  });

  return list;
}

// ------------------------------------------------------------
// 🧾 OPTIONS BUILDERS
// ------------------------------------------------------------
export function populateFilterOptions(traders) {
  const traderList = Array.isArray(traders) ? traders : [];

  const typeSelect = document.getElementById("typeFilter");
  const regionSelect = document.getElementById("regionFilter");
  const categorySelect = document.getElementById("categoryFilter");

  const types = [...new Set(traderList.map((t) => t?.type).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), "ru")
  );

  const regions = [...new Set(traderList.map((t) => t?.region).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), "ru")
  );

  const categories = [
    ...new Set(
      traderList.flatMap((t) =>
        getItems(t)
          .map((i) => i?.category || i?.category_clean)
          .filter(Boolean)
      )
    ),
  ].sort((a, b) => String(a).localeCompare(String(b), "ru"));

  if (typeSelect) {
    const current = typeSelect.value || "";
    typeSelect.innerHTML =
      `<option value="">Все типы</option>` +
      types
        .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`)
        .join("");
    typeSelect.value = types.includes(current) ? current : "";
  }

  if (regionSelect) {
    const current = regionSelect.value || "";
    regionSelect.innerHTML =
      `<option value="">Все регионы</option>` +
      regions
        .map((region) => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`)
        .join("");
    regionSelect.value = regions.includes(current) ? current : "";
  }

  if (categorySelect) {
    const current = categorySelect.value || "";
    categorySelect.innerHTML =
      `<option value="">Любая</option>` +
      categories
        .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
        .join("");
    categorySelect.value = categories.includes(current) ? current : "";
  }
}

// ------------------------------------------------------------
// 🧹 RESET
// ------------------------------------------------------------
export function resetFiltersDom() {
  writeFiltersToDom({
    traderSearch: "",
    traderType: "",
    region: "",
    playerLevel: 0,
    minReputation: "",
    itemSearch: "",
    minPrice: "",
    maxPrice: "",
    rarity: "",
    category: "",
    magicFilter: "",
    sort: "name_asc",
  });
}

// ------------------------------------------------------------
// 🔗 MAIN APPLY
// ------------------------------------------------------------
export function applyFilters(traders) {
  const filters = readFiltersFromDom();
  const filtered = filterTraders(traders, filters);
  const sorted = sortTraders(filtered, filters.sort);

  return {
    filters,
    filtered,
    sorted,
  };
}

// ------------------------------------------------------------
// 🎛 BIND EVENTS
// ------------------------------------------------------------
export function bindFilterEvents(onChange) {
  const ids = [
    "searchInput",
    "typeFilter",
    "regionFilter",
    "playerLevelFilter",
    "reputationFilter",
    "itemSearchInput",
    "priceMin",
    "priceMax",
    "rarityFilter",
    "categoryFilter",
    "magicFilter",
    "sortFilter",
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.dataset.filtersBound === "1") return;

    el.dataset.filtersBound = "1";

    const trigger = () => {
      if (typeof onChange === "function") onChange(readFiltersFromDom());
    };

    el.addEventListener("input", trigger);
    el.addEventListener("change", trigger);
  });

  const resetBtn = document.getElementById("resetFiltersBtn");
  if (resetBtn && resetBtn.dataset.filtersBound !== "1") {
    resetBtn.dataset.filtersBound = "1";
    resetBtn.addEventListener("click", () => {
      resetFiltersDom();
      if (typeof onChange === "function") onChange(readFiltersFromDom());
    });
  }
}

// ------------------------------------------------------------
// 🌉 LEGACY BRIDGE
// ------------------------------------------------------------
window.filtersModule = {
  readFiltersFromDom,
  writeFiltersToDom,
  filterTraders,
  sortTraders,
  populateFilterOptions,
  resetFiltersDom,
  applyFilters,
  bindFilterEvents,
  getMatchedItemsForTrader,
};