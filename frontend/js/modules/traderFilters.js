// ============================================================
// frontend/js/modules/traderFilters.js
// Локальная фильтрация/сортировка списка торговцев.
// ============================================================

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRarityValue(value) {
  const raw = normalizeText(value);

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
  return normalizeText(value);
}

function getTraderItems(trader) {
  return Array.isArray(trader?.items) ? trader.items : [];
}

function getItemPriceGold(item, safeNumber) {
  if (item?.buy_price_gold != null) return safeNumber(item.buy_price_gold, 0);
  if (item?.price_gold != null) return safeNumber(item.price_gold, 0);

  if (
    item?.buy_price_silver != null ||
    item?.buy_price_copper != null ||
    item?.price_silver != null ||
    item?.price_copper != null
  ) {
    const gold = safeNumber(item?.buy_price_gold ?? item?.price_gold, 0);
    const silver = safeNumber(item?.buy_price_silver ?? item?.price_silver, 0);
    const copper = safeNumber(item?.buy_price_copper ?? item?.price_copper, 0);
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
    .map((part) => normalizeText(part))
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
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(" ");
}

function itemPassesFilters(item, filters, safeNumber) {
  const itemSearchBlob = getItemSearchBlob(item);
  const itemPrice = getItemPriceGold(item, safeNumber);
  const itemCategory = normalizeCategoryValue(item.category || item.category_clean || "");
  const itemRarity = normalizeRarityValue(item.rarity || "");
  const isMagical = Boolean(item.is_magical);

  if (filters.itemSearch && !itemSearchBlob.includes(filters.itemSearch)) return false;
  if (filters.rarity && itemRarity !== normalizeRarityValue(filters.rarity)) return false;
  if (filters.category && itemCategory !== normalizeCategoryValue(filters.category)) return false;
  if (filters.magicFilter === "magic" && !isMagical) return false;
  if (filters.magicFilter === "mundane" && isMagical) return false;
  if (filters.priceMin !== null && itemPrice < filters.priceMin) return false;
  if (filters.priceMax !== null && itemPrice > filters.priceMax) return false;

  return true;
}

export function populateFilterOptions(traders, getEl) {
  const traderList = Array.isArray(traders) ? traders : [];

  const typeFilter = getEl("typeFilter");
  if (typeFilter) {
    const current = String(typeFilter.value || "");
    const types = [...new Set(traderList.map((t) => t?.type).filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b), "ru")
    );
    typeFilter.innerHTML = `<option value="">Все типы</option>`;
    for (const type of types) {
      const option = document.createElement("option");
      option.value = String(type);
      option.textContent = String(type);
      typeFilter.appendChild(option);
    }
    typeFilter.value = types.includes(current) ? current : "";
  }

  const regionFilter = getEl("regionFilter");
  if (regionFilter) {
    const current = String(regionFilter.value || "");
    const regions = [...new Set(traderList.map((t) => t?.region).filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b), "ru")
    );
    regionFilter.innerHTML = `<option value="">Все регионы</option>`;
    for (const region of regions) {
      const option = document.createElement("option");
      option.value = String(region);
      option.textContent = String(region);
      regionFilter.appendChild(option);
    }
    regionFilter.value = regions.includes(current) ? current : "";
  }

  const rarityFilter = getEl("rarityFilter");
  if (rarityFilter) {
    const current = String(rarityFilter.value || "");
    const rarities = new Set();
    for (const trader of traderList) {
      for (const item of getTraderItems(trader)) {
        const rarity = normalizeRarityValue(item?.rarity);
        if (rarity) rarities.add(rarity);
      }
    }
    rarityFilter.innerHTML = `<option value="">Любая</option>`;
    for (const rarity of [...rarities].sort((a, b) => String(a).localeCompare(String(b), "ru"))) {
      const option = document.createElement("option");
      option.value = String(rarity);
      option.textContent = String(rarity);
      rarityFilter.appendChild(option);
    }
    rarityFilter.value = [...rarities].includes(normalizeRarityValue(current)) ? normalizeRarityValue(current) : "";
  }

  const categoryFilter = getEl("categoryFilter");
  if (categoryFilter) {
    const current = String(categoryFilter.value || "");
    const categories = new Set();
    for (const trader of traderList) {
      for (const item of getTraderItems(trader)) {
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
    categoryFilter.value = [...categories].includes(current) ? current : "";
  }
}

export function collectFilters(getEl, safeNumber) {
  return {
    traderSearch: normalizeText(getEl("searchInput")?.value || ""),
    itemSearch: normalizeText(getEl("itemSearchInput")?.value || ""),
    type: String(getEl("typeFilter")?.value || ""),
    region: String(getEl("regionFilter")?.value || ""),
    rarity: normalizeRarityValue(getEl("rarityFilter")?.value || ""),
    category: normalizeCategoryValue(getEl("categoryFilter")?.value || ""),
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
    if (!getTraderSearchBlob(trader).includes(filters.traderSearch)) return false;
  }

  if (filters.type && String(trader.type || "") !== filters.type) return false;
  if (filters.region && String(trader.region || "") !== filters.region) return false;
  if (filters.reputation && safeNumber(trader.reputation, 0) < filters.reputation) return false;

  if (filters.playerLevel > 0) {
    const min = safeNumber(trader.level_min, 0);
    const max = safeNumber(trader.level_max, 999);
    if (filters.playerLevel < min || filters.playerLevel > max) return false;
  }

  const items = getTraderItems(trader);

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
    list.sort((a, b) => normalizeText(a.name).localeCompare(normalizeText(b.name), "ru"));
  } else if (sortValue === "price_asc") {
    list.sort((a, b) => {
      const aMin = Math.min(
        ...getTraderItems(a).map((i) => getItemPriceGold(i, safeNumber)),
        Infinity
      );
      const bMin = Math.min(
        ...getTraderItems(b).map((i) => getItemPriceGold(i, safeNumber)),
        Infinity
      );
      return aMin - bMin;
    });
  } else if (sortValue === "price_desc") {
    list.sort((a, b) => {
      const aMax = Math.max(
        ...getTraderItems(a).map((i) => getItemPriceGold(i, safeNumber)),
        0
      );
      const bMax = Math.max(
        ...getTraderItems(b).map((i) => getItemPriceGold(i, safeNumber)),
        0
      );
      return bMax - aMax;
    });
  } else if (sortValue === "reputation_desc") {
    list.sort((a, b) => safeNumber(b.reputation, 0) - safeNumber(a.reputation, 0));
  }

  return list;
}
