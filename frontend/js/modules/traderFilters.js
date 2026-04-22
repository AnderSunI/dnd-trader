// ============================================================
// frontend/js/modules/traderFilters.js
// Локальная фильтрация/сортировка списка торговцев.
// ============================================================

function itemPassesFilters(item, filters, safeNumber) {
  const itemName = String(item.name || "").toLowerCase();
  const itemPrice = safeNumber(item.price_gold ?? item.buy_price_gold, 0);
  const itemCategory = String(item.category || item.category_clean || "");
  const itemRarity = String(item.rarity || "");
  const isMagical = Boolean(item.is_magical);

  if (filters.itemSearch && !itemName.includes(filters.itemSearch)) return false;
  if (filters.rarity && itemRarity !== filters.rarity) return false;
  if (filters.category && itemCategory !== filters.category) return false;
  if (filters.magicFilter === "magic" && !isMagical) return false;
  if (filters.magicFilter === "mundane" && isMagical) return false;
  if (filters.priceMin !== null && itemPrice < filters.priceMin) return false;
  if (filters.priceMax !== null && itemPrice > filters.priceMax) return false;

  return true;
}

export function populateFilterOptions(traders, getEl) {
  const typeFilter = getEl("typeFilter");
  if (typeFilter) {
    const types = [...new Set(traders.map((t) => t.type).filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b), "ru")
    );
    typeFilter.innerHTML = `<option value="">Все типы</option>`;
    for (const type of types) {
      const option = document.createElement("option");
      option.value = String(type);
      option.textContent = String(type);
      typeFilter.appendChild(option);
    }
  }

  const regionFilter = getEl("regionFilter");
  if (regionFilter) {
    const regions = [...new Set(traders.map((t) => t.region).filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b), "ru")
    );
    regionFilter.innerHTML = `<option value="">Все регионы</option>`;
    for (const region of regions) {
      const option = document.createElement("option");
      option.value = String(region);
      option.textContent = String(region);
      regionFilter.appendChild(option);
    }
  }

  const rarityFilter = getEl("rarityFilter");
  if (rarityFilter) {
    const rarities = new Set();
    for (const trader of traders) {
      for (const item of trader.items || []) {
        if (item.rarity) rarities.add(String(item.rarity));
      }
    }
    rarityFilter.innerHTML = `<option value="">Любая</option>`;
    for (const rarity of [...rarities].sort((a, b) => String(a).localeCompare(String(b), "ru"))) {
      const option = document.createElement("option");
      option.value = String(rarity);
      option.textContent = String(rarity);
      rarityFilter.appendChild(option);
    }
  }

  const categoryFilter = getEl("categoryFilter");
  if (categoryFilter) {
    const categories = new Set();
    for (const trader of traders) {
      for (const item of trader.items || []) {
        const category = item.category || item.category_clean;
        if (category) categories.add(String(category));
      }
    }
    categoryFilter.innerHTML = `<option value="">Любая</option>`;
    for (const category of [...categories].sort((a, b) =>
      String(a).localeCompare(String(b), "ru")
    )) {
      const option = document.createElement("option");
      option.value = String(category);
      option.textContent = String(category);
      categoryFilter.appendChild(option);
    }
  }
}

export function collectFilters(getEl, safeNumber) {
  return {
    traderSearch: String(getEl("searchInput")?.value || "").trim().toLowerCase(),
    itemSearch: String(getEl("itemSearchInput")?.value || "").trim().toLowerCase(),
    type: String(getEl("typeFilter")?.value || ""),
    region: String(getEl("regionFilter")?.value || ""),
    rarity: String(getEl("rarityFilter")?.value || ""),
    category: String(getEl("categoryFilter")?.value || ""),
    magicFilter: String(getEl("magicFilter")?.value || ""),
    playerLevel: safeNumber(getEl("playerLevelFilter")?.value, 0),
    reputation: safeNumber(getEl("reputationFilter")?.value, 0),
    priceMin: getEl("priceMin")?.value === "" ? null : safeNumber(getEl("priceMin")?.value, 0),
    priceMax: getEl("priceMax")?.value === "" ? null : safeNumber(getEl("priceMax")?.value, 0),
    sortValue: String(getEl("sortFilter")?.value || "name_asc"),
  };
}

export function traderMatchesFilters(trader, filters, safeNumber) {
  if (filters.traderSearch) {
    const byName = String(trader.name || "").toLowerCase().includes(filters.traderSearch);
    const byDesc = String(trader.description || "").toLowerCase().includes(filters.traderSearch);
    if (!byName && !byDesc) return false;
  }

  if (filters.type && String(trader.type || "") !== filters.type) return false;
  if (filters.region && String(trader.region || "") !== filters.region) return false;
  if (filters.reputation && safeNumber(trader.reputation, 0) < filters.reputation) return false;

  if (filters.playerLevel > 0) {
    const min = safeNumber(trader.level_min, 0);
    const max = safeNumber(trader.level_max, 999);
    if (filters.playerLevel < min || filters.playerLevel > max) return false;
  }

  const items = Array.isArray(trader.items) ? trader.items : [];

  const noItemFilters =
    !filters.itemSearch &&
    !filters.rarity &&
    !filters.category &&
    !filters.magicFilter &&
    filters.priceMin === null &&
    filters.priceMax === null;

  if (noItemFilters) return true;

  return items.some((item) => itemPassesFilters(item, filters, safeNumber));
}

export function sortTraders(traders, sortValue, safeNumber) {
  const list = [...traders];

  if (sortValue === "name_asc") {
    list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
  } else if (sortValue === "price_asc") {
    list.sort((a, b) => {
      const aMin = Math.min(
        ...(a.items || []).map((i) => safeNumber(i.price_gold ?? i.buy_price_gold, 0)),
        Infinity
      );
      const bMin = Math.min(
        ...(b.items || []).map((i) => safeNumber(i.price_gold ?? i.buy_price_gold, 0)),
        Infinity
      );
      return aMin - bMin;
    });
  } else if (sortValue === "price_desc") {
    list.sort((a, b) => {
      const aMax = Math.max(
        ...(a.items || []).map((i) => safeNumber(i.price_gold ?? i.buy_price_gold, 0)),
        0
      );
      const bMax = Math.max(
        ...(b.items || []).map((i) => safeNumber(i.price_gold ?? i.buy_price_gold, 0)),
        0
      );
      return bMax - aMax;
    });
  } else if (sortValue === "reputation_desc") {
    list.sort((a, b) => safeNumber(b.reputation, 0) - safeNumber(a.reputation, 0));
  }

  return list;
}
