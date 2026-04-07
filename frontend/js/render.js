function safe(value, fallback = "") {
  return value === null || value === undefined ? fallback : value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseJsonObject(raw) {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseJsonArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function getEl(id) {
  return document.getElementById(id);
}

function firstExistingSelector(selectors) {
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    if (node) return node;
  }
  return null;
}

function formatMoneyParts(gold = 0, silver = 0, copper = 0) {
  const parts = [];
  if (Number(gold || 0)) parts.push(`${Number(gold)}з`);
  if (Number(silver || 0)) parts.push(`${Number(silver)}с`);
  if (Number(copper || 0)) parts.push(`${Number(copper)}м`);
  return parts.length ? parts.join(" ") : "0з";
}

function formatPrice(item) {
  if (item?.buy_price_label) return item.buy_price_label;
  if (item?.price_label) return item.price_label;

  const gold = Number(item?.price_gold ?? item?.buy_price_gold ?? 0);
  const silver = Number(item?.price_silver ?? item?.buy_price_silver ?? 0);
  const copper = Number(item?.price_copper ?? item?.buy_price_copper ?? 0);

  return formatMoneyParts(gold, silver, copper);
}

function formatSellPrice(item) {
  if (item?.sell_price_label) return item.sell_price_label;

  const gold = Number(item?.sell_price_gold ?? 0);
  const silver = Number(item?.sell_price_silver ?? 0);
  const copper = Number(item?.sell_price_copper ?? 0);

  const result = formatMoneyParts(gold, silver, copper);
  return result === "0з" ? "—" : result;
}

function normalizeRarity(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "Обычный";
  if (raw === "common") return "Обычный";
  if (raw === "uncommon") return "Необычный";
  if (raw === "rare") return "Редкий";
  if (raw === "very rare") return "Очень редкий";
  if (raw === "legendary") return "Легендарный";
  if (raw === "artifact") return "Артефакт";
  return value || "Обычный";
}

function normalizeQuality(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "Стандартное";
  if (raw === "standard") return "Стандартное";
  if (raw === "poor") return "Плохое";
  if (raw === "fine") return "Хорошее";
  if (raw === "excellent") return "Отличное";
  if (raw === "masterwork") return "Мастерское";
  return value || "Стандартное";
}

function getTraderImageUrl(trader) {
  const raw = String(trader?.image_url || "").trim();
  return raw || "/static/images/default.png";
}

function getReputationStars(reputation) {
  const rep = Math.max(0, Math.min(5, Number(reputation || 0)));
  return "★".repeat(rep) + "☆".repeat(5 - rep);
}

function getTraderQuality(reputation) {
  const rep = Number(reputation || 0);
  if (rep <= 1) return "Новичок";
  if (rep <= 3) return "Опытный";
  return "Мастер";
}

function itemCharacteristics(item) {
  const props = parseJsonObject(item?.properties);
  const parts = [];

  if (props.damage) parts.push(`Урон: ${props.damage}`);
  if (props.damage_type) parts.push(`Тип: ${props.damage_type}`);
  if (props.ac) parts.push(`КД: ${props.ac}`);
  if (props.range) parts.push(`Дистанция: ${props.range}`);
  if (props.healing) parts.push(`Лечение: ${props.healing}`);
  if (props.special_properties) parts.push(`Свойства: ${props.special_properties}`);
  if (item?.is_magical) parts.push("Магический");
  if (item?.attunement) parts.push("Требует настройки");

  return parts.length ? parts.join(" • ") : "—";
}

function getItemFullDescription(item) {
  const props = parseJsonObject(item?.properties);
  const requirements = parseJsonObject(item?.requirements);
  const lines = [];

  if (item?.description) lines.push(String(item.description));
  if (item?.description_ru && item.description_ru !== item?.description) lines.push(String(item.description_ru));
  if (item?.lore) lines.push(`Лор: ${item.lore}`);
  if (item?.effect) lines.push(`Эффект: ${item.effect}`);
  if (item?.rules_text) lines.push(`Правила: ${item.rules_text}`);
  if (props.damage) lines.push(`Урон: ${props.damage}`);
  if (props.damage_type) lines.push(`Тип урона: ${props.damage_type}`);
  if (props.ac) lines.push(`КД: ${props.ac}`);
  if (props.range) lines.push(`Дистанция: ${props.range}`);
  if (props.healing) lines.push(`Лечение: ${props.healing}`);
  if (props.special_properties) lines.push(`Свойства: ${props.special_properties}`);

  const reqKeys = Object.keys(requirements || {});
  if (reqKeys.length) {
    lines.push(`Требования: ${reqKeys.map((k) => `${k}: ${requirements[k]}`).join(", ")}`);
  }

  if (!lines.length) {
    lines.push("Подробное описание пока отсутствует.");
  }

  return lines.join("\n\n");
}

function getItemId(item) {
  return Number(item?.item_id ?? item?.id ?? 0);
}

function getTraderStock(item) {
  return Math.max(0, Number(item?.stock ?? item?.quantity ?? 0));
}

function getOwnedQuantity(item) {
  return Math.max(0, Number(item?.quantity ?? 0));
}

function renderQtyControl(maxQty, itemId, initial = 1) {
  const safeMax = Math.max(1, Number(maxQty || 1));
  const value = Math.min(Math.max(1, Number(initial || 1)), safeMax);

  return `
    <input
      type="number"
      class="qty-input"
      data-item-id="${itemId}"
      min="1"
      max="${safeMax}"
      step="1"
      value="${value}"
    />
  `;
}

function getQtyFromButton(button, fallback = 1) {
  const row = button.closest("[data-item-id-row]");
  if (!row) return fallback;

  const input = row.querySelector(".qty-input");
  const max = Number(input?.max || fallback || 1);
  const value = Number(input?.value || fallback || 1);

  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(Math.max(1, value), Math.max(1, max));
}

function ensureDescriptionModal() {
  let modal = getEl("itemDescriptionModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "itemDescriptionModal";
  modal.className = "modal";
  modal.style.display = "none";
  modal.innerHTML = `
    <div class="modal-content item-description-modal-content">
      <span class="close item-description-close">&times;</span>
      <div id="itemDescriptionContent"></div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector(".item-description-close")?.addEventListener("click", () => {
    modal.style.display = "none";
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.style.display = "none";
    }
  });

  return modal;
}

function openItemDescriptionModal(item, context = "trader") {
  const modal = ensureDescriptionModal();
  const content = modal.querySelector("#itemDescriptionContent");
  if (!content) return;

  const priceText = context === "inventory" ? formatSellPrice(item) : formatPrice(item);

  content.innerHTML = `
    <h2>${escapeHtml(item?.name || "Без названия")}</h2>
    <div class="item-meta-block">
      <p><strong>Цена:</strong> ${escapeHtml(priceText)}</p>
      <p><strong>Редкость:</strong> ${escapeHtml(normalizeRarity(item?.rarity))}</p>
      <p><strong>Качество:</strong> ${escapeHtml(normalizeQuality(item?.quality))}</p>
      <p><strong>Характеристики:</strong> ${escapeHtml(itemCharacteristics(item))}</p>
    </div>
    <pre class="item-description-pre">${escapeHtml(getItemFullDescription(item))}</pre>
  `;

  modal.style.display = "block";
}

function getCollectionFiltersMarkup() {
  return `
    <div class="collection-toolbar">
      <input type="text" class="item-search-inline" placeholder="Поиск предмета" />
      <input type="number" class="price-min-inline" placeholder="Цена от" min="0" />
      <input type="number" class="price-max-inline" placeholder="Цена до" min="0" />
      <select class="rarity-inline">
        <option value="">Редкость</option>
        <option value="common">Обычный</option>
        <option value="uncommon">Необычный</option>
        <option value="rare">Редкий</option>
        <option value="very rare">Очень редкий</option>
        <option value="legendary">Легендарный</option>
        <option value="artifact">Артефакт</option>
      </select>
      <select class="quality-inline">
        <option value="">Качество</option>
        <option value="standard">Стандартное</option>
        <option value="poor">Плохое</option>
        <option value="fine">Хорошее</option>
        <option value="excellent">Отличное</option>
        <option value="masterwork">Мастерское</option>
      </select>
      <label class="inline-checkbox">
        <input type="checkbox" class="magic-inline" />
        Только магические
      </label>
      <select class="sort-inline">
        <option value="name">От А до Я</option>
        <option value="price_asc">Цены сначала дешёвые</option>
        <option value="price_desc">Цены сначала дорогие</option>
      </select>
      <select class="view-mode-inline">
        <option value="table">Таблица</option>
        <option value="grid">Сетка</option>
        <option value="inventory">Инвентарь</option>
      </select>
    </div>
  `;
}

function getPriceNumeric(item, context = "trader") {
  if (context === "inventory") {
    return (
      Number(item?.sell_price_gold || 0) +
      Number(item?.sell_price_silver || 0) / 100 +
      Number(item?.sell_price_copper || 0) / 10000
    );
  }

  return (
    Number(item?.price_gold ?? item?.buy_price_gold ?? 0) +
    Number(item?.price_silver ?? item?.buy_price_silver ?? 0) / 100 +
    Number(item?.price_copper ?? item?.buy_price_copper ?? 0) / 10000
  );
}

function filterItems(items, wrapper, context = "trader") {
  const search = wrapper.querySelector(".item-search-inline")?.value?.trim().toLowerCase() || "";
  const min = wrapper.querySelector(".price-min-inline")?.value ?? "";
  const max = wrapper.querySelector(".price-max-inline")?.value ?? "";
  const rarity = wrapper.querySelector(".rarity-inline")?.value || "";
  const quality = wrapper.querySelector(".quality-inline")?.value || "";
  const magic = wrapper.querySelector(".magic-inline")?.checked || false;
  const sort = wrapper.querySelector(".sort-inline")?.value || "name";

  let filtered = [...(items || [])].filter((item) => {
    const name = String(item?.name || "").toLowerCase();
    const price = getPriceNumeric(item, context);
    const itemRarity = String(item?.rarity || "");
    const itemQuality = String(item?.quality || "");
    const isMagical = Boolean(item?.is_magical);

    if (search && !name.includes(search)) return false;
    if (min !== "" && price < Number(min)) return false;
    if (max !== "" && price > Number(max)) return false;
    if (rarity && itemRarity !== rarity) return false;
    if (quality && itemQuality !== quality) return false;
    if (magic && !isMagical) return false;

    return true;
  });

  if (sort === "name") {
    filtered.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), "ru"));
  } else if (sort === "price_asc") {
    filtered.sort((a, b) => getPriceNumeric(a, context) - getPriceNumeric(b, context));
  } else if (sort === "price_desc") {
    filtered.sort((a, b) => getPriceNumeric(b, context) - getPriceNumeric(a, context));
  }

  return filtered;
}

function renderItemActions(item, context, contextId) {
  const itemId = getItemId(item);
  const traderId = contextId != null ? Number(contextId) : "";

  if (context === "trader") {
    return `
      <div class="item-actions">
        <button class="btn btn-success js-buy-item" data-item-id="${itemId}" data-trader-id="${traderId}">Купить</button>
        <button class="btn btn-primary js-add-cart" data-item-id="${itemId}" data-trader-id="${traderId}">В корзину</button>
        <button class="btn btn-warning js-reserve-item" data-item-id="${itemId}" data-trader-id="${traderId}">Резерв</button>
        <button class="btn js-open-desc" data-item-id="${itemId}" data-trader-id="${traderId}" data-context="trader">Полное описание</button>
      </div>
    `;
  }

  if (context === "cart") {
    return `
      <div class="item-actions">
        <button class="btn js-open-desc" data-item-id="${itemId}" data-context="cart">Полное описание</button>
        <button class="btn btn-warning js-reserve-from-cart" data-item-id="${itemId}" data-trader-id="${traderId}">В резерв</button>
        <button class="btn btn-danger js-remove-cart" data-item-id="${itemId}" data-trader-id="${traderId}">Удалить</button>
      </div>
    `;
  }

  if (context === "reserved") {
    return `
      <div class="item-actions">
        <button class="btn js-open-desc" data-item-id="${itemId}" data-context="reserved">Полное описание</button>
        <button class="btn btn-danger js-unreserve" data-item-id="${itemId}" data-trader-id="${traderId}">Снять резерв</button>
      </div>
    `;
  }

  if (context === "inventory") {
    return `
      <div class="item-actions">
        <button class="btn js-open-desc" data-item-id="${itemId}" data-context="inventory">Полное описание</button>
        <button class="btn btn-success js-sell-item" data-item-id="${itemId}">Продать</button>
        <button class="btn btn-danger js-remove-inventory" data-item-id="${itemId}">Удалить</button>
      </div>
    `;
  }

  return "";
}

function renderItemsTable(items, context, contextId) {
  return `
    <table class="items-table-common">
      <thead>
        <tr>
          <th>Название</th>
          <th>Цена</th>
          <th>Редкость</th>
          <th>Качество</th>
          <th>${context === "inventory" ? "Количество" : "Осталось"}</th>
          <th>Характеристики</th>
          <th>Кол-во</th>
          <th>Действие</th>
        </tr>
      </thead>
      <tbody>
        ${(items || [])
          .map((item) => {
            const itemId = getItemId(item);
            const amount = context === "inventory" ? getOwnedQuantity(item) : getTraderStock(item);
            const maxQty = Math.max(1, amount || 1);
            const priceText = context === "inventory" ? formatSellPrice(item) : formatPrice(item);

            return `
              <tr data-item-id-row="${itemId}">
                <td>${escapeHtml(item?.name || "Без названия")}</td>
                <td>${escapeHtml(priceText)}</td>
                <td>${escapeHtml(normalizeRarity(item?.rarity))}</td>
                <td>${escapeHtml(normalizeQuality(item?.quality))}</td>
                <td>${escapeHtml(String(amount))}</td>
                <td>${escapeHtml(itemCharacteristics(item))}</td>
                <td>${renderQtyControl(maxQty, itemId, 1)}</td>
                <td>${renderItemActions(item, context, contextId)}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderItemsGrid(items, context, contextId) {
  return `
    <div class="items-grid-common">
      ${(items || [])
        .map((item) => {
          const itemId = getItemId(item);
          const amount = context === "inventory" ? getOwnedQuantity(item) : getTraderStock(item);
          const maxQty = Math.max(1, amount || 1);
          const priceText = context === "inventory" ? formatSellPrice(item) : formatPrice(item);

          return `
            <div class="trader-grid-card item-card-common" data-item-id-row="${itemId}">
              <div class="item-card-title">${escapeHtml(item?.name || "Без названия")}</div>
              <div class="item-card-price">${escapeHtml(priceText)}</div>
              <div class="item-card-meta">Редкость: ${escapeHtml(normalizeRarity(item?.rarity))}</div>
              <div class="item-card-meta">Качество: ${escapeHtml(normalizeQuality(item?.quality))}</div>
              <div class="item-card-meta">${context === "inventory" ? "Количество" : "Осталось"}: ${escapeHtml(String(amount))}</div>
              <div class="item-card-meta">${escapeHtml(itemCharacteristics(item))}</div>
              <div class="item-card-qty">${renderQtyControl(maxQty, itemId, 1)}</div>
              ${renderItemActions(item, context, contextId)}
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderItemsInventoryList(items, context, contextId) {
  return `
    <div class="inventory-view-list">
      ${(items || [])
        .map((item) => {
          const itemId = getItemId(item);
          const amount = context === "inventory" ? getOwnedQuantity(item) : getTraderStock(item);
          const maxQty = Math.max(1, amount || 1);
          const priceText = context === "inventory" ? formatSellPrice(item) : formatPrice(item);

          return `
            <div class="inventory-view-row" data-item-id-row="${itemId}">
              <div class="inventory-view-main">
                <div class="inventory-view-name">${escapeHtml(item?.name || "Без названия")}</div>
                <div class="inventory-view-price">${escapeHtml(priceText)}</div>
                <div class="inventory-view-meta">${escapeHtml(normalizeRarity(item?.rarity))} • ${escapeHtml(normalizeQuality(item?.quality))}</div>
                <div class="inventory-view-meta">${context === "inventory" ? "Количество" : "Осталось"}: ${escapeHtml(String(amount))}</div>
              </div>
              <div class="inventory-view-controls">
                ${renderQtyControl(maxQty, itemId, 1)}
                ${renderItemActions(item, context, contextId)}
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderCollectionInto(container, items, context, contextId) {
  const wrapper = container.closest(".collection-wrapper");
  if (!wrapper) return;

  const filtered = filterItems(items, wrapper, context);
  const viewMode = wrapper.querySelector(".view-mode-inline")?.value || "table";

  if (viewMode === "grid") {
    container.innerHTML = renderItemsGrid(filtered, context, contextId);
  } else if (viewMode === "inventory") {
    container.innerHTML = renderItemsInventoryList(filtered, context, contextId);
  } else {
    container.innerHTML = renderItemsTable(filtered, context, contextId);
  }
}

function bindCollectionFilters(root, items, context, contextId) {
  const wrapper = root.closest(".collection-wrapper") || root.querySelector(".collection-wrapper");
  const container =
    root.querySelector(".collection-items-container") ||
    root.querySelector(".items-table-container");

  if (!wrapper || !container) return;

  const rerender = () => renderCollectionInto(container, items, context, contextId);

  wrapper
    .querySelectorAll(
      ".item-search-inline, .price-min-inline, .price-max-inline, .rarity-inline, .quality-inline, .magic-inline, .sort-inline, .view-mode-inline"
    )
    .forEach((control) => {
      if (control.dataset.bound === "1") return;
      control.dataset.bound = "1";
      control.addEventListener("input", rerender);
      control.addEventListener("change", rerender);
    });

  rerender();
}

function groupItemsByCategory(items) {
  const grouped = {};
  for (const item of items || []) {
    const category = String(item?.category_clean || item?.category || "Разное");
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(item);
  }
  return grouped;
}

function ensureTraderModal() {
  let modal = getEl("traderModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "traderModal";
    modal.className = "modal";
    modal.style.display = "none";
    modal.innerHTML = `<div class="modal-content" id="traderModalContent"></div>`;
    document.body.appendChild(modal);
  }

  if (!modal.dataset.boundClose) {
    modal.dataset.boundClose = "1";
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        modal.style.display = "none";
      }
    });
  }

  return modal;
}

function buildTraderHeader(trader) {
  return `
    <div class="trader-modal-header">
      <div class="trader-modal-header-left">
        <img class="trader-modal-image" src="${escapeHtml(getTraderImageUrl(trader))}" alt="${escapeHtml(trader?.name || "Торговец")}" />
      </div>
      <div class="trader-modal-header-right">
        <div class="trader-modal-topbar">
          <h2>${escapeHtml(trader?.name || "Безымянный торговец")}</h2>
          <button class="close js-close-trader-modal">&times;</button>
        </div>
        <p><strong>Тип:</strong> ${escapeHtml(trader?.type || "—")}</p>
        <p><strong>Регион:</strong> ${escapeHtml(trader?.region || "—")}</p>
        <p><strong>Поселение:</strong> ${escapeHtml(trader?.settlement || "—")}</p>
        <p><strong>Репутация:</strong> ${escapeHtml(getReputationStars(trader?.reputation))} (${escapeHtml(getTraderQuality(trader?.reputation))})</p>
        <p><strong>Золото торговца:</strong> ${escapeHtml(String(trader?.gold ?? "—"))}</p>
        <p><strong>Описание:</strong> ${escapeHtml(trader?.description || "—")}</p>
      </div>
    </div>
  `;
}

function buildTraderTabs(grouped) {
  const categoryNames = Object.keys(grouped);
  if (!categoryNames.length) {
    return `
      <div class="trader-modal-body">
        <div class="collection-wrapper">
          ${getCollectionFiltersMarkup()}
          <div class="collection-items-container"><p>У торговца нет товаров.</p></div>
        </div>
      </div>
    `;
  }

  const tabs = categoryNames
    .map((category, index) => {
      return `
        <button class="category-tab ${index === 0 ? "active" : ""}" data-cat="${escapeHtml(category)}">
          ${escapeHtml(category)}
        </button>
      `;
    })
    .join("");

  const contents = categoryNames
    .map((category, index) => {
      return `
        <div class="category-content ${index === 0 ? "active" : ""}" data-cat="${escapeHtml(category)}" ${index === 0 ? "" : 'style="display:none" hidden'}>
          <div class="collection-wrapper">
            ${getCollectionFiltersMarkup()}
            <div class="items-table-container collection-items-container"></div>
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="trader-modal-body">
      <div class="category-tabs">${tabs}</div>
      <div class="category-sections">${contents}</div>
    </div>
  `;
}

function bindTraderModal(modal, trader) {
  if (!modal.dataset.actionsBound) {
    modal.dataset.actionsBound = "1";

    modal.addEventListener("click", async (event) => {
      const closeBtn = event.target.closest(".js-close-trader-modal");
      if (closeBtn) {
        modal.style.display = "none";
        return;
      }

      const tabBtn = event.target.closest(".category-tab");
      if (tabBtn) {
        const cat = tabBtn.dataset.cat;
        modal.querySelectorAll(".category-tab").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.cat === cat);
        });
        modal.querySelectorAll(".category-content").forEach((content) => {
          const active = content.dataset.cat === cat;
          content.classList.toggle("active", active);
          content.hidden = !active;
          content.style.display = active ? "" : "none";
        });
        return;
      }

      const buyBtn = event.target.closest(".js-buy-item");
      if (buyBtn) {
        const qty = getQtyFromButton(buyBtn, 1);
        const traderId = Number(buyBtn.dataset.traderId);
        const itemId = Number(buyBtn.dataset.itemId);
        await window.buyItem?.(traderId, itemId, qty);
        return;
      }

      const addCartBtn = event.target.closest(".js-add-cart");
      if (addCartBtn) {
        const qty = getQtyFromButton(addCartBtn, 1);
        const traderId = Number(addCartBtn.dataset.traderId);
        const itemId = Number(addCartBtn.dataset.itemId);
        window.addToCart?.(traderId, itemId, qty);
        return;
      }

      const reserveBtn = event.target.closest(".js-reserve-item");
      if (reserveBtn) {
        const qty = getQtyFromButton(reserveBtn, 1);
        const traderId = Number(reserveBtn.dataset.traderId);
        const itemId = Number(reserveBtn.dataset.itemId);
        window.reserveItem?.(itemId, traderId, qty);
        return;
      }

      const descBtn = event.target.closest(".js-open-desc");
      if (descBtn) {
        const itemId = Number(descBtn.dataset.itemId);
        const context = descBtn.dataset.context || "trader";
        const traderId = descBtn.dataset.traderId ? Number(descBtn.dataset.traderId) : trader?.id;
        const item = window.getItemForDescription?.(itemId, context, traderId);
        if (item) {
          openItemDescriptionModal(item, context);
        }
      }
    });
  }

  const grouped = groupItemsByCategory(trader?.items || []);
  Object.entries(grouped).forEach(([category, items]) => {
    const section = modal.querySelector(`.category-content[data-cat="${CSS.escape(category)}"]`);
    if (!section) return;
    bindCollectionFilters(section, items, "trader", trader.id);
  });
}

export function renderTraders(traders) {
  const container =
    firstExistingSelector([
      "#tradersContainer",
      "#tradersGrid",
      "#tradersList",
      "#traders-root",
      ".traders-container",
      ".traders-grid",
    ]) || document.body;

  container.innerHTML = `
    <div class="traders-grid-rendered">
      ${(traders || [])
        .map((trader) => {
          const spec = parseJsonArray(trader?.specialization).join(", ");
          return `
            <div class="trader-card" data-trader-card-id="${Number(trader?.id || 0)}" tabindex="0" role="button">
              <div class="trader-card-image-wrap">
                <img class="trader-card-image" src="${escapeHtml(getTraderImageUrl(trader))}" alt="${escapeHtml(trader?.name || "Торговец")}" />
              </div>
              <div class="trader-card-body">
                <h3>${escapeHtml(trader?.name || "Безымянный торговец")}</h3>
                <p><strong>Тип:</strong> ${escapeHtml(trader?.type || "—")}</p>
                <p><strong>Регион:</strong> ${escapeHtml(trader?.region || "—")}</p>
                <p><strong>Репутация:</strong> ${escapeHtml(getReputationStars(trader?.reputation))}</p>
                <p><strong>Специализация:</strong> ${escapeHtml(spec || "—")}</p>
                <button class="btn btn-primary" data-open-trader-id="${Number(trader?.id || 0)}">Открыть торговца</button>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function bindCollectionActionDelegation(root, context) {
  if (!root || root.dataset.boundActions === "1") return;
  root.dataset.boundActions = "1";

  root.addEventListener("click", async (event) => {
    const descBtn = event.target.closest(".js-open-desc");
    if (descBtn) {
      const itemId = Number(descBtn.dataset.itemId);
      const traderId = descBtn.dataset.traderId ? Number(descBtn.dataset.traderId) : null;
      const item = window.getItemForDescription?.(itemId, context, traderId);
      if (item) openItemDescriptionModal(item, context);
      return;
    }

    const reserveBtn = event.target.closest(".js-reserve-from-cart");
    if (reserveBtn) {
      const qty = getQtyFromButton(reserveBtn, 1);
      const itemId = Number(reserveBtn.dataset.itemId);
      const traderId = Number(reserveBtn.dataset.traderId || 0);
      window.reserveItem?.(itemId, traderId, qty);
      return;
    }

    const removeCartBtn = event.target.closest(".js-remove-cart");
    if (removeCartBtn) {
      const itemId = Number(removeCartBtn.dataset.itemId);
      const traderId = Number(removeCartBtn.dataset.traderId || 0);
      window.removeFromCart?.(itemId, traderId);
      return;
    }

    const unreserveBtn = event.target.closest(".js-unreserve");
    if (unreserveBtn) {
      const itemId = Number(unreserveBtn.dataset.itemId);
      const traderId = Number(unreserveBtn.dataset.traderId || 0);
      window.unreserveItem?.(itemId, traderId);
      return;
    }

    const sellBtn = event.target.closest(".js-sell-item");
    if (sellBtn) {
      const itemId = Number(sellBtn.dataset.itemId);
      await window.sellItem?.(itemId);
      return;
    }

    const removeInvBtn = event.target.closest(".js-remove-inventory");
    if (removeInvBtn) {
      const itemId = Number(removeInvBtn.dataset.itemId);
      window.removeInventoryItem?.(itemId);
    }
  });
}

export function renderCart(items) {
  const listContainer =
    firstExistingSelector([
      "#cartItemsContainer",
      "#cartItems",
      "#cart-items",
      ".cart-items-container",
    ]);

  const modalContainer =
    firstExistingSelector([
      "#cartModalItems",
      "#cartModalBody",
      "#cartModalContentItems",
      ".cart-modal-items",
    ]);

  const reservedItems = window.getReservedItems?.() || [];

  const cartMarkup = `
    <div class="collection-wrapper">
      ${getCollectionFiltersMarkup()}
      <div class="collection-items-container"></div>
    </div>
  `;

  if (listContainer) listContainer.innerHTML = cartMarkup;
  if (modalContainer) modalContainer.innerHTML = cartMarkup;

  const apply = (root, contextItems, contextName) => {
    if (!root) return;
    bindCollectionActionDelegation(root, contextName);
    bindCollectionFilters(root, contextItems, contextName, null);
  };

  apply(listContainer, items || [], "cart");
  apply(modalContainer, items || [], "cart");

  const reservedContainer = firstExistingSelector([
    "#reservedItemsContainer",
    "#reservedItems",
    ".reserved-items-container",
  ]);

  if (reservedContainer) {
    reservedContainer.innerHTML = `
      <div class="collection-wrapper">
        ${getCollectionFiltersMarkup()}
        <div class="collection-items-container"></div>
      </div>
    `;
    bindCollectionActionDelegation(reservedContainer, "reserved");
    bindCollectionFilters(reservedContainer, reservedItems, "reserved", null);
  }
}

export function renderInventory(items) {
  const inventoryContainer =
    firstExistingSelector([
      "#inventoryItemsContainer",
      "#inventoryItems",
      "#inventory-items",
      ".inventory-items-container",
    ]);

  const inventoryModalContainer =
    firstExistingSelector([
      "#inventoryModalItems",
      "#inventoryModalBody",
      ".inventory-modal-items",
    ]);

  const markup = `
    <div class="collection-wrapper">
      ${getCollectionFiltersMarkup()}
      <div class="collection-items-container"></div>
    </div>
  `;

  if (inventoryContainer) inventoryContainer.innerHTML = markup;
  if (inventoryModalContainer) inventoryModalContainer.innerHTML = markup;

  const apply = (root) => {
    if (!root) return;
    bindCollectionActionDelegation(root, "inventory");
    bindCollectionFilters(root, items || [], "inventory", null);
  };

  apply(inventoryContainer);
  apply(inventoryModalContainer);
}

export async function openTraderModal(traderId) {
  const response = await fetch(`/traders/${Number(traderId)}`);
  if (!response.ok) {
    window.showToast?.("Не удалось загрузить торговца");
    return;
  }

  const payload = await response.json();
  const trader = payload?.trader || payload;

  const modal = ensureTraderModal();
  let content = modal.querySelector("#traderModalContent");
  if (!content) {
    modal.innerHTML = `<div class="modal-content" id="traderModalContent"></div>`;
    content = modal.querySelector("#traderModalContent");
  }

  const grouped = groupItemsByCategory(trader?.items || []);
  content.innerHTML = `
    ${buildTraderHeader(trader)}
    ${buildTraderTabs(grouped)}
  `;

  bindTraderModal(modal, trader);
  modal.style.display = "block";
}