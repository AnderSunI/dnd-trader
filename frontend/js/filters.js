// ============================================================
// filters.js
// Фильтрация и сортировка торговцев/товаров
// Под current index.html
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

function getItemPriceGold(item) {
  if (item.buy_price_gold != null) return toNumber(item.buy_price_gold, 0);
  if (item.price_gold != null) return toNumber(item.price_gold, 0);
  return 0;
}

function getItems(trader) {
  return Array.isArray(trader?.items) ? trader.items : [];
}

// ------------------------------------------------------------
// 📥 READ FILTERS FROM DOM
// ------------------------------------------------------------
export function readFiltersFromDom() {
  return {
    traderSearch: document.getElementById("searchTrader")?.value?.trim() || "",
    traderType: document.getElementById("typeFilter")?.value || "all",
    region: document.getElementById("regionFilter")?.value || "all",
    playerLevel: toNumber(document.getElementById("playerLevelFilter")?.value, 0),
    minReputation: document.getElementById("minReputationFilter")?.value || "all",

    itemSearch: document.getElementById("searchInput")?.value?.trim() || "",
    minPrice: document.getElementById("minPrice")?.value || "",
    maxPrice: document.getElementById("maxPrice")?.value || "",
    rarity: document.getElementById("rarityFilter")?.value || "all",
    category: document.getElementById("categoryFilter")?.value || "all",
    magicOnly: !!document.getElementById("magicFilter")?.checked,
    sort: document.getElementById("sortFilter")?.value || "name_asc",
  };
}

// ------------------------------------------------------------
// 🔎 FILTER LOGIC
// ------------------------------------------------------------
function matchesTraderSearch(trader, traderSearch) {
  if (!traderSearch) return true;

  const needle = normalize(traderSearch);

  return (
    normalize(trader.name).includes(needle) ||
    normalize(trader.description).includes(needle) ||
    normalize(trader.type).includes(needle) ||
    normalize(trader.region).includes(needle) ||
    normalize(trader.settlement).includes(needle)
  );
}

function matchesTraderType(trader, traderType) {
  if (!traderType || traderType === "all") return true;
  return normalize(trader.type) === normalize(traderType);
}

function matchesRegion(trader, region) {
  if (!region || region === "all") return true;
  return normalize(trader.region) === normalize(region);
}

function matchesPlayerLevel(trader, playerLevel) {
  if (!playerLevel || playerLevel <= 0) return true;

  const min = toNumber(trader.level_min, 1);
  const max = toNumber(trader.level_max, 999);

  return playerLevel >= min && playerLevel <= max;
}

function matchesMinReputation(trader, minReputation) {
  if (!minReputation || minReputation === "all") return true;
  return toNumber(trader.reputation, 0) >= toNumber(minReputation, 0);
}

function matchesItemSearch(items, itemSearch) {
  if (!itemSearch) return true;

  const needle = normalize(itemSearch);

  return items.some((item) => {
    return (
      normalize(item.name).includes(needle) ||
      normalize(item.description).includes(needle) ||
      normalize(item.category).includes(needle) ||
      normalize(item.subcategory).includes(needle)
    );
  });
}

function matchesPrice(items, minPrice, maxPrice) {
  const hasMin = minPrice !== "" && minPrice != null;
  const hasMax = maxPrice !== "" && maxPrice != null;

  if (!hasMin && !hasMax) return true;

  const min = hasMin ? toNumber(minPrice, 0) : null;
  const max = hasMax ? toNumber(maxPrice, 999999999) : null;

  return items.some((item) => {
    const price = getItemPriceGold(item);

    if (min != null && price < min) return false;
    if (max != null && price > max) return false;

    return true;
  });
}

function matchesRarity(items, rarity) {
  if (!rarity || rarity === "all") return true;
  return items.some((item) => normalize(item.rarity) === normalize(rarity));
}

function matchesCategory(items, category) {
  if (!category || category === "all") return true;
  return items.some((item) => normalize(item.category) === normalize(category));
}

function matchesMagic(items, magicOnly) {
  if (!magicOnly) return true;
  return items.some((item) => !!item.is_magical);
}

// ------------------------------------------------------------
// ✂️ FILTER TRADERS
// ------------------------------------------------------------
export function filterTraders(traders, filters) {
  return (Array.isArray(traders) ? traders : []).filter((trader) => {
    const items = getItems(trader);

    if (!matchesTraderSearch(trader, filters.traderSearch)) return false;
    if (!matchesTraderType(trader, filters.traderType)) return false;
    if (!matchesRegion(trader, filters.region)) return false;
    if (!matchesPlayerLevel(trader, filters.playerLevel)) return false;
    if (!matchesMinReputation(trader, filters.minReputation)) return false;

    if (!matchesItemSearch(items, filters.itemSearch)) return false;
    if (!matchesPrice(items, filters.minPrice, filters.maxPrice)) return false;
    if (!matchesRarity(items, filters.rarity)) return false;
    if (!matchesCategory(items, filters.category)) return false;
    if (!matchesMagic(items, filters.magicOnly)) return false;

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

function getTraderBestRarityTier(trader) {
  const items = getItems(trader);
  if (!items.length) return 0;
  return Math.max(...items.map((item) => toNumber(item.rarity_tier, 0)));
}

export function sortTraders(traders, sortKey) {
  const list = [...(Array.isArray(traders) ? traders : [])];

  list.sort((a, b) => {
    if (sortKey === "name_desc") {
      return normalize(b.name).localeCompare(normalize(a.name), "ru");
    }

    if (sortKey === "price_asc") {
      return getTraderMinPrice(a) - getTraderMinPrice(b);
    }

    if (sortKey === "price_desc") {
      return getTraderMinPrice(b) - getTraderMinPrice(a);
    }

    if (sortKey === "rarity_asc") {
      return getTraderBestRarityTier(a) - getTraderBestRarityTier(b);
    }

    return normalize(a.name).localeCompare(normalize(b.name), "ru");
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

  const types = [...new Set(traderList.map((t) => t.type).filter(Boolean))].sort();
  const regions = [...new Set(traderList.map((t) => t.region).filter(Boolean))].sort();

  const categories = [
    ...new Set(
      traderList.flatMap((t) => getItems(t).map((i) => i.category).filter(Boolean))
    ),
  ].sort();

  if (typeSelect) {
    const current = typeSelect.value || "all";
    typeSelect.innerHTML = `<option value="all">Все типы</option>` +
      types.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");
    typeSelect.value = types.includes(current) ? current : "all";
  }

  if (regionSelect) {
    const current = regionSelect.value || "all";
    regionSelect.innerHTML = `<option value="all">Все регионы</option>` +
      regions.map((region) => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`).join("");
    regionSelect.value = regions.includes(current) ? current : "all";
  }

  if (categorySelect) {
    const current = categorySelect.value || "all";
    categorySelect.innerHTML = `<option value="all">Любая</option>` +
      categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
    categorySelect.value = categories.includes(current) ? current : "all";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ------------------------------------------------------------
// 🧹 RESET
// ------------------------------------------------------------
export function resetFiltersDom() {
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };

  setValue("searchTrader", "");
  setValue("typeFilter", "all");
  setValue("regionFilter", "all");
  setValue("playerLevelFilter", 0);
  setValue("minReputationFilter", "all");

  setValue("searchInput", "");
  setValue("minPrice", "");
  setValue("maxPrice", "");
  setValue("rarityFilter", "all");
  setValue("categoryFilter", "all");
  setValue("sortFilter", "name_asc");

  const magic = document.getElementById("magicFilter");
  if (magic) magic.checked = false;
}

// ------------------------------------------------------------
// 🔗 MAIN APPLY
// ------------------------------------------------------------
export function applyFilters(traders) {
  const filters = readFiltersFromDom();
  const filtered = filterTraders(traders, filters);
  const sorted = sortTraders(filtered, filters.sort);
  return sorted;
}

// ------------------------------------------------------------
// 🎛 BIND EVENTS
// ------------------------------------------------------------
export function bindFilterEvents(onChange) {
  const ids = [
    "searchTrader",
    "typeFilter",
    "regionFilter",
    "playerLevelFilter",
    "minReputationFilter",
    "searchInput",
    "minPrice",
    "maxPrice",
    "rarityFilter",
    "categoryFilter",
    "magicFilter",
    "sortFilter",
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    const eventName =
      el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";

    el.addEventListener(eventName, () => {
      if (typeof onChange === "function") onChange();
    });
  });

  const resetBtn = document.getElementById("resetFiltersBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      resetFiltersDom();
      if (typeof onChange === "function") onChange();
    });
  }
}