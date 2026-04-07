function safe(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseProps(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

function parseArray(raw) {
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

function getTraderImageUrl(trader) {
  const raw = String(trader?.image_url || "").trim();
  if (!raw) return "/static/images/default.png";
  return raw;
}

function getTraderQuality(reputation) {
  const rep = Number(reputation || 0);
  if (rep <= 1) return "Новичок";
  if (rep <= 3) return "Опытный";
  return "Мастер";
}

function getReputationStars(reputation) {
  const rep = Math.max(0, Math.min(5, Number(reputation || 0)));
  return "★".repeat(rep) + "☆".repeat(5 - rep);
}

function normalizeQuality(value) {
  const raw = String(value || "").trim().toLowerCase();

  if (!raw) return "Стандартное";
  if (raw === "standard") return "Стандартное";
  if (raw === "poor") return "Плохое";
  if (raw === "fine") return "Хорошее";
  if (raw === "excellent") return "Отличное";
  if (raw === "masterwork") return "Мастерское";

  if (raw === "common") return "Обычное";
  if (raw === "uncommon") return "Необычное";
  if (raw === "rare") return "Редкое";
  if (raw === "very rare") return "Очень редкое";
  if (raw === "legendary") return "Легендарное";
  if (raw === "artifact") return "Артефактное";

  return value || "Стандартное";
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

function formatPrice(item) {
  if (item.buy_price_label) return item.buy_price_label;
  if (item.price_label) return item.price_label;

  const gold = Number(item.price_gold || item.buy_price_gold || 0);
  const silver = Number(item.price_silver || item.buy_price_silver || 0);
  const copper = Number(item.price_copper || item.buy_price_copper || 0);

  const parts = [];
  if (gold) parts.push(`${gold}з`);
  if (silver) parts.push(`${silver}с`);
  if (copper) parts.push(`${copper}м`);

  return parts.length ? parts.join(" ") : "0з";
}

function formatSellPrice(item) {
  if (item.sell_price_label) return item.sell_price_label;

  const gold = Number(item.sell_price_gold || 0);
  const silver = Number(item.sell_price_silver || 0);
  const copper = Number(item.sell_price_copper || 0);

  const parts = [];
  if (gold) parts.push(`${gold}з`);
  if (silver) parts.push(`${silver}с`);
  if (copper) parts.push(`${copper}м`);

  return parts.length ? parts.join(" ") : "—";
}

function itemCharacteristics(item) {
  const props = parseProps(item.properties);
  const parts = [];

  if (props.damage) parts.push(`Урон: ${props.damage}`);
  if (props.damage_type) parts.push(`${props.damage_type}`);
  if (props.ac) parts.push(`КД: ${props.ac}`);
  if (props.range) parts.push(`Дистанция: ${props.range}`);
  if (props.healing) parts.push(`Лечение: ${props.healing}`);
  if (item.is_magical) parts.push("Магический");
  if (item.attunement) parts.push("Требует настройки");

  return parts.length ? parts.join(" | ") : "—";
}

function getDiscountLabel(reputation) {
  const rep = Number(reputation || 0);
  if (rep === 0) return "0%";
  return `${Math.round(rep)}%`;
}

function groupItemsByCategory(items) {
  const grouped = {};

  for (const item of items || []) {
    const category = item.category_clean || item.category || "Разное";
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(item);
  }

  return grouped;
}

function getPriceValue(item) {
  return (
    Number(item.price_gold || item.buy_price_gold || 0) +
    Number(item.price_silver || item.buy_price_silver || 0) / 100 +
    Number(item.price_copper || item.buy_price_copper || 0) / 10000
  );
}

function getItemFullDescription(item) {
  const props = parseProps(item.properties);
  const parts = [];

  if (item.description) parts.push(String(item.description));
  if (item.lore) parts.push(String(item.lore));
  if (item.effect) parts.push(`Эффект: ${item.effect}`);
  if (item.rules_text) parts.push(`Правила: ${item.rules_text}`);
  if (props.damage) parts.push(`Урон: ${props.damage}`);
  if (props.damage_type) parts.push(`Тип урона: ${props.damage_type}`);
  if (props.ac) parts.push(`КД: ${props.ac}`);
  if (props.range) parts.push(`Дистанция: ${props.range}`);
  if (props.healing) parts.push(`Лечение: ${props.healing}`);
  if (itemCharacteristics(item) !== "—") parts.push(itemCharacteristics(item));

  return parts.length ? parts.join("\n") : "Подробное описание пока отсутствует.";
}

function renderQtyControl(stock, initialQty = 1, itemId = 0) {
  const maxQty = Math.max(1, Number(stock || 0));
  const startQty = Math.min(Math.max(1, initialQty), maxQty);

  return `
    <div class="item-qty-box vertical-qty-box" data-max-qty="${maxQty}">
      <input
        class="qty-input"
        type="number"
        min="1"
        max="${maxQty}"
        step="1"
        value="${startQty}"
        data-qty-input="${itemId}"
      />
    </div>
  `;
}

function getQtyFromActionButton(button) {
  const rowScope =
    button.closest("tr") ||
    button.closest(".trader-grid-card") ||
    button.closest(".inventory-view-row") ||
    button.closest(".item-card-common");

  const qtyInput = rowScope?.querySelector(".qty-input");
  const qty = Number(qtyInput?.value || "1");

  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

function getCommonItemFiltersMarkup() {
  return `
    <div class="trader-inline-filters">
      <input class="item-search-inline" type="text" placeholder="Поиск" />
      <input class="price-min-inline" type="number" min="0" step="1" placeholder="Цена от" />
      <input class="price-max-inline" type="number" min="0" step="1" placeholder="Цена до" />

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

      <label class="magic-inline-wrap">
        <input class="magic-inline" type="checkbox" />
        Магия
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

function filterItems(items, wrapper) {
  const search = wrapper.querySelector(".item-search-inline")?.value?.trim().toLowerCase() || "";
  const min = wrapper.querySelector(".price-min-inline")?.value ?? "";
  const max = wrapper.querySelector(".price-max-inline")?.value ?? "";
  const rarity = wrapper.querySelector(".rarity-inline")?.value || "";
  const quality = wrapper.querySelector(".quality-inline")?.value || "";
  const magic = wrapper.querySelector(".magic-inline")?.checked || false;
  const sort = wrapper.querySelector(".sort-inline")?.value || "name";

  let filtered = [...items];

  filtered = filtered.filter((item) => {
    const name = String(item.name || "").toLowerCase();
    const price = getPriceValue(item);
    const itemRarity = String(item.rarity || "");
    const itemQuality = String(item.quality || "");
    const itemMagic = Boolean(item.is_magical);

    if (search && !name.includes(search)) return false;
    if (min !== "" && price < Number(min)) return false;
    if (max !== "" && price > Number(max)) return false;
    if (rarity && itemRarity !== rarity) return false;
    if (quality && itemQuality !== quality) return false;
    if (magic && !itemMagic) return false;

    return true;
  });

  if (sort === "name") {
    filtered.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
  } else if (sort === "price_asc") {
    filtered.sort((a, b) => getPriceValue(a) - getPriceValue(b));
  } else if (sort === "price_desc") {
    filtered.sort((a, b) => getPriceValue(b) - getPriceValue(a));
  }

  return filtered;
}

function renderItemActionButtons(item, context, contextId) {
  const itemId = Number(item.id || item.item_id);

  if (context === "trader") {
    return `
      <button class="btn btn-success buy-now-btn" type="button" data-trader-id="${contextId}" data-item-id="${itemId}">
        Купить
      </button>
      <button class="btn btn-primary add-cart-btn" type="button" data-trader-id="${contextId}" data-item-id="${itemId}">
        В корзину
      </button>
      <button class="btn btn-warning reserve-btn" type="button" data-trader-id="${contextId}" data-item-id="${itemId}">
        Резерв
      </button>
      <button class="btn btn-secondary item-details-btn" type="button" data-mode="trader" data-item-id="${itemId}">
        Полное описание
      </button>
    `;
  }

  if (context === "cart") {
    return `
      <button class="btn btn-secondary item-details-btn" type="button" data-mode="cart" data-item-id="${itemId}">
        Полное описание
      </button>
      <button class="btn btn-warning reserve-from-cart-btn" type="button" data-item-id="${itemId}" data-trader-id="${item.trader_id || ""}">
        В резерв
      </button>
      <button class="btn btn-danger remove-cart-btn" type="button" data-item-id="${itemId}" data-trader-id="${item.trader_id || ""}">
        Удалить
      </button>
    `;
  }

  if (context === "reserved") {
    return `
      <button class="btn btn-secondary item-details-btn" type="button" data-mode="reserved" data-item-id="${itemId}">
        Полное описание
      </button>
      <button class="btn btn-danger unreserve-btn" type="button" data-item-id="${itemId}" data-trader-id="${item.trader_id || ""}">
        Снять резерв
      </button>
    `;
  }

  if (context === "inventory") {
    return `
      <button class="btn btn-secondary item-details-btn" type="button" data-mode="inventory" data-item-id="${itemId}">
        Полное описание
      </button>
      <button class="btn btn-warning sell-item-btn" type="button" data-item-id="${itemId}">
        Продать
      </button>
      <button class="btn btn-danger remove-inventory-btn" type="button" data-item-id="${itemId}">
        Удалить
      </button>
    `;
  }

  return "";
}

function renderItemsTable(items, context, contextId) {
  return `
    <table class="trader-items-table">
      <thead>
        <tr>
          <th>Название</th>
          <th>Цена</th>
          <th>Редкость</th>
          <th>Качество</th>
          <th>Осталось</th>
          <th>Характеристики</th>
          <th>Кол-во</th>
          <th>Действие</th>
        </tr>
      </thead>
      <tbody>
        ${items
          .map((item) => {
            const itemId = Number(item.id || item.item_id);
            const stock = Number(item.stock ?? item.quantity ?? 0);

            return `
              <tr class="item-card-common">
                <td>${escapeHtml(item.name || "Без названия")}</td>
                <td>${escapeHtml(context === "inventory" ? formatSellPrice(item) : formatPrice(item))}</td>
                <td>${escapeHtml(normalizeRarity(item.rarity))}</td>
                <td>${escapeHtml(normalizeQuality(item.quality))}</td>
                <td>${escapeHtml(String(stock))}</td>
                <td>${escapeHtml(itemCharacteristics(item))}</td>
                <td>${renderQtyControl(stock, 1, itemId)}</td>
                <td><div class="item-actions">${renderItemActionButtons(item, context, contextId)}</div></td>
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
    <div class="trader-items-grid">
      ${items
        .map((item) => {
          const itemId = Number(item.id || item.item_id);
          const stock = Number(item.stock ?? item.quantity ?? 0);

          return `
            <div class="trader-grid-card item-card-common">
              <div class="trader-grid-title">${escapeHtml(item.name || "Без названия")}</div>
              <div class="trader-grid-price">${escapeHtml(context === "inventory" ? formatSellPrice(item) : formatPrice(item))}</div>
              <div class="trader-grid-meta">Редкость: ${escapeHtml(normalizeRarity(item.rarity))}</div>
              <div class="trader-grid-meta">Качество: ${escapeHtml(normalizeQuality(item.quality))}</div>
              <div class="trader-grid-meta">Осталось: ${escapeHtml(String(stock))}</div>
              <div class="trader-grid-meta">${escapeHtml(itemCharacteristics(item))}</div>
              <div class="trader-grid-qty">${renderQtyControl(stock, 1, itemId)}</div>
              <div class="item-actions">${renderItemActionButtons(item, context, contextId)}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderItemsInventoryView(items, context, contextId) {
  return `
    <div class="trader-items-inventory-view">
      ${items
        .map((item) => {
          const itemId = Number(item.id || item.item_id);
          const stock = Number(item.stock ?? item.quantity ?? 0);

          return `
            <div class="inventory-view-row item-card-common">
              <div class="inventory-view-main">
                <strong>${escapeHtml(item.name || "Без названия")}</strong>
                <span>${escapeHtml(context === "inventory" ? formatSellPrice(item) : formatPrice(item))}</span>
                <span>${escapeHtml(normalizeRarity(item.rarity))}</span>
                <span>${escapeHtml(normalizeQuality(item.quality))}</span>
                <span>Осталось: ${escapeHtml(String(stock))}</span>
              </div>
              <div class="inventory-view-qty">${renderQtyControl(stock, 1, itemId)}</div>
              <div class="item-actions">${renderItemActionButtons(item, context, contextId)}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderCommonItemsInto(container, items, context, contextId) {
  const wrapper = container.parentElement;
  if (!wrapper) return;

  const filtered = filterItems(items, wrapper);
  const mode = wrapper.querySelector(".view-mode-inline")?.value || "table";

  if (mode === "grid") {
    container.innerHTML = renderItemsGrid(filtered, context, contextId);
  } else if (mode === "inventory") {
    container.innerHTML = renderItemsInventoryView(filtered, context, contextId);
  } else {
    container.innerHTML = renderItemsTable(filtered, context, contextId);
  }
}

function setActiveTab(modalRoot, tab) {
  modalRoot.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });

  modalRoot.querySelectorAll(".tab-content").forEach((content) => {
    const isActive = content.id === `tab-${tab}`;
    content.classList.toggle("active", isActive);
    content.hidden = !isActive;
    content.style.display = isActive ? "" : "none";
  });
}

function bindModalTabSystem(modalRoot) {
  setActiveTab(modalRoot, "buy");

  modalRoot.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      setActiveTab(modalRoot, tab);
    });
  });
}

function setActiveCategory(modalRoot, cat) {
  modalRoot.querySelectorAll(".category-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.cat === cat);
  });

  modalRoot.querySelectorAll(".category-content").forEach((content) => {
    const isActive = content.dataset.cat === cat;
    content.classList.toggle("active", isActive);
    content.hidden = !isActive;
    content.style.display = isActive ? "" : "none";
  });
}

function bindCategoryTabs(modalRoot) {
  const first =
    modalRoot.querySelector(".category-tab.active")?.dataset.cat ||
    modalRoot.querySelector(".category-tab")?.dataset.cat;

  if (first) {
    setActiveCategory(modalRoot, first);
  }

  modalRoot.querySelectorAll(".category-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cat = btn.dataset.cat;
      setActiveCategory(modalRoot, cat);
    });
  });
}

function bindCategoryFilters(modalRoot, grouped, traderId) {
  const allSections = Array.from(modalRoot.querySelectorAll(".category-content"));

  Object.entries(grouped).forEach(([category, items]) => {
    const section = allSections.find((node) => node.dataset.cat === String(category));
    if (!section) return;

    const container = section.querySelector(".items-table-container");
    if (!container) return;

    const rerender = () => renderCommonItemsInto(container, items, "trader", traderId);

    section
      .querySelectorAll(
        ".item-search-inline, .price-min-inline, .price-max-inline, .rarity-inline, .quality-inline, .magic-inline, .sort-inline, .view-mode-inline"
      )
      .forEach((control) => {
        control.addEventListener("input", rerender);
        control.addEventListener("change", rerender);
      });

    rerender();
  });
}

function bindCollectionFilters(root, items, context, contextId) {
  const container = root.querySelector(".collection-items-container");
  if (!container) return;

  const rerender = () => renderCommonItemsInto(container, items, context, contextId);

  root
    .querySelectorAll(
      ".item-search-inline, .price-min-inline, .price-max-inline, .rarity-inline, .quality-inline, .magic-inline, .sort-inline, .view-mode-inline"
    )
    .forEach((control) => {
      control.addEventListener("input", rerender);
      control.addEventListener("change", rerender);
    });

  rerender();
}

function ensureItemDescriptionModal() {
  let modal = document.getElementById("itemDescriptionModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "itemDescriptionModal";
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-content modal-large">
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

function openItemDescriptionModal(item) {
  const modal = ensureItemDescriptionModal();
  const content = modal.querySelector("#itemDescriptionContent");
  if (!content) return;

  content.innerHTML = `
    <h2>${escapeHtml(item.name || "Без названия")}</h2>
    <p><strong>Цена:</strong> ${escapeHtml(formatPrice(item))}</p>
    <p><strong>Редкость:</strong> ${escapeHtml(normalizeRarity(item.rarity))}</p>
    <p><strong>Качество:</strong> ${escapeHtml(normalizeQuality(item.quality))}</p>
    <pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(getItemFullDescription(item))}</pre>
  `;

  modal.style.display = "block";
}

function bindItemActionHandlers(root, context) {
  root.addEventListener("click", (event) => {
    const detailsBtn = event.target.closest(".item-details-btn");
    if (detailsBtn) {
      const itemId = Number(detailsBtn.dataset.itemId);
      const mode = detailsBtn.dataset.mode || context;
      if (typeof window.getItemForDescription === "function") {
        const item = window.getItemForDescription(itemId, mode);
        if (item) {
          openItemDescriptionModal(item);
          return;
        }
      }
      if (typeof window.showItemDescription === "function") {
        window.showItemDescription(itemId, mode);
      }
      return;
    }

    const removeCartBtn = event.target.closest(".remove-cart-btn");
    if (removeCartBtn) {
      const itemId = Number(removeCartBtn.dataset.itemId);
      const traderIdRaw = removeCartBtn.dataset.traderId;
      const traderId = traderIdRaw === "" ? null : Number(traderIdRaw);

      if (confirm("Удалить предмет из корзины?")) {
        if (typeof window.removeFromCart === "function") {
          window.removeFromCart(itemId, traderId);
        }
      }
      return;
    }

    const reserveFromCartBtn = event.target.closest(".reserve-from-cart-btn");
    if (reserveFromCartBtn) {
      const itemId = Number(reserveFromCartBtn.dataset.itemId);
      const traderIdRaw = reserveFromCartBtn.dataset.traderId;
      const traderId = traderIdRaw === "" ? null : Number(traderIdRaw);

      if (typeof window.reserveItem === "function") {
        window.reserveItem(itemId, traderId, 1);
      }
      return;
    }

    const unreserveBtn = event.target.closest(".unreserve-btn");
    if (unreserveBtn) {
      const itemId = Number(unreserveBtn.dataset.itemId);
      const traderIdRaw = unreserveBtn.dataset.traderId;
      const traderId = traderIdRaw === "" ? null : Number(traderIdRaw);

      if (confirm("Снять резерв с предмета?")) {
        if (typeof window.unreserveItem === "function") {
          window.unreserveItem(itemId, traderId);
        }
      }
      return;
    }

    const sellBtn = event.target.closest(".sell-item-btn");
    if (sellBtn) {
      const itemId = Number(sellBtn.dataset.itemId);
      if (confirm("Продать этот предмет?")) {
        if (typeof window.sellItem === "function") {
          window.sellItem(itemId);
        }
      }
      return;
    }

    const removeInventoryBtn = event.target.closest(".remove-inventory-btn");
    if (removeInventoryBtn) {
      const itemId = Number(removeInventoryBtn.dataset.itemId);
      if (confirm("Удалить предмет из инвентаря?")) {
        if (typeof window.removeInventoryItem === "function") {
          window.removeInventoryItem(itemId);
        }
      }
    }
  });
}

function bindTraderModalActions(modalRoot, traderId) {
  modalRoot.addEventListener("click", async (event) => {
    const addBtn = event.target.closest(".add-cart-btn");
    if (addBtn) {
      const tId = Number(addBtn.dataset.traderId);
      const itemId = Number(addBtn.dataset.itemId);
      const qty = getQtyFromActionButton(addBtn);

      if (
        Number.isFinite(tId) &&
        Number.isFinite(itemId) &&
        typeof window.addToCart === "function"
      ) {
        window.addToCart(tId, itemId, qty);
      }
      return;
    }

    const buyBtn = event.target.closest(".buy-now-btn");
    if (buyBtn) {
      const tId = Number(buyBtn.dataset.traderId);
      const itemId = Number(buyBtn.dataset.itemId);
      const qty = getQtyFromActionButton(buyBtn);

      if (
        Number.isFinite(tId) &&
        Number.isFinite(itemId) &&
        typeof window.buyItem === "function"
      ) {
        window.buyItem(tId, itemId, qty);
      }
      return;
    }

    const reserveBtn = event.target.closest(".reserve-btn");
    if (reserveBtn) {
      const tId = Number(reserveBtn.dataset.traderId);
      const itemId = Number(reserveBtn.dataset.itemId);
      const qty = getQtyFromActionButton(reserveBtn);

      if (
        Number.isFinite(tId) &&
        Number.isFinite(itemId) &&
        typeof window.reserveItem === "function"
      ) {
        window.reserveItem(itemId, tId, qty);
      }
      return;
    }

    const detailsBtn = event.target.closest(".item-details-btn");
    if (detailsBtn) {
      const itemId = Number(detailsBtn.dataset.itemId);
      if (typeof window.getItemForDescription === "function") {
        const item = window.getItemForDescription(itemId, "trader", traderId);
        if (item) {
          openItemDescriptionModal(item);
          return;
        }
      }
    }

    const restockBtn = event.target.closest("#restockBtn");
    if (restockBtn) {
      restockBtn.disabled = true;

      try {
        const res = await fetch(`/traders/${traderId}/restock`, {
          method: "POST",
        });

        if (!res.ok) {
          throw new Error("restock failed");
        }

        if (typeof window.showToast === "function") {
          window.showToast("Ассортимент обновлён");
        }

        await openTraderModal(traderId);
      } catch (error) {
        console.error(error);

        if (typeof window.showToast === "function") {
          window.showToast("Не удалось обновить ассортимент");
        }
      } finally {
        restockBtn.disabled = false;
      }
    }
  });
}

export function renderTraders(traders) {
  const container = document.getElementById("traders-container");
  if (!container) return;

  if (!Array.isArray(traders) || !traders.length) {
    container.innerHTML = `<p style="text-align:center;">Торговцы не найдены.</p>`;
    return;
  }

  container.innerHTML = traders
    .map((trader) => {
      const traderId = Number(trader.id);
      const imageUrl = getTraderImageUrl(trader);
      const quality = getTraderQuality(trader.reputation);
      const stars = getReputationStars(trader.reputation);
      const previewItems = Array.isArray(trader.items) ? trader.items.slice(0, 4) : [];
      const moreCount = Array.isArray(trader.items) ? Math.max(trader.items.length - 4, 0) : 0;

      return `
        <article
          class="trader-card trader-card-stable"
          data-trader-card-id="${traderId}"
          role="button"
          tabindex="0"
          aria-label="Открыть торговца ${escapeHtml(safe(trader.name, "Без имени"))}"
        >
          <div class="trader-card-media">
            <img
              src="${escapeHtml(imageUrl)}"
              alt="${escapeHtml(trader.name || "Торговец")}"
              class="trader-card-photo"
            />
          </div>

          <div class="trader-card-body">
            <div class="trader-name">${escapeHtml(safe(trader.name, "Без имени"))}</div>

            <div class="trader-type">
              ${escapeHtml(safe(trader.type, "Торговец"))}
              <span class="trader-quality">${escapeHtml(quality)}</span>
            </div>

            <div class="trader-meta">
              ${trader.region ? `<span class="meta-item">🌍 ${escapeHtml(trader.region)}</span>` : ""}
              ${trader.settlement ? `<span class="meta-item">🏘️ ${escapeHtml(trader.settlement)}</span>` : ""}
              ${
                trader.level_min != null
                  ? `<span class="meta-item">🎚️ ${escapeHtml(`${safe(trader.level_min, "—")}–${safe(trader.level_max, "∞")}`)}</span>`
                  : ""
              }
              <span class="meta-item">⭐ ${escapeHtml(stars)}</span>
            </div>

            <div class="trader-desc">
              ${escapeHtml(String(trader.description || "").trim() || "Описание отсутствует")}
            </div>

            <div class="items-list">
              <div class="items-title">📦 Витрина:</div>
              ${
                previewItems.length
                  ? `
                    <ul class="items">
                      ${previewItems.map((item) => `<li>${escapeHtml(item.name || "Без названия")}</li>`).join("")}
                    </ul>
                    ${moreCount > 0 ? `<div class="more-items">и ещё ${escapeHtml(String(moreCount))}...</div>` : ""}
                  `
                  : `<div class="more-items">Нет товаров</div>`
              }
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

export async function openTraderModal(traderId) {
  const modal = document.getElementById("traderModal");
  const content = document.getElementById("modalContent");

  if (!modal || !content) return;

  modal.style.display = "block";
  content.innerHTML = `<div class="loading-state">Загрузка торговца...</div>`;

  try {
    const res = await fetch(`/traders/${traderId}`);
    if (!res.ok) throw new Error(`Ошибка загрузки торговца: ${res.status}`);

    const payload = await res.json();
    const trader = payload.trader || payload;

    if (!trader) {
      content.innerHTML = `<div class="error-state">Торговец не найден.</div>`;
      return;
    }

    const imageUrl = getTraderImageUrl(trader);
    const grouped = groupItemsByCategory(trader.items || []);
    const categories = Object.keys(grouped);
    const firstCategory = categories[0] || "Разное";

    const catTabs = categories.length
      ? categories
          .map(
            (cat, index) => `
              <button class="category-tab ${index === 0 ? "active" : ""}" data-cat="${escapeHtml(cat)}">
                ${escapeHtml(cat)}
              </button>
            `
          )
          .join("")
      : `<button class="category-tab active" data-cat="Разное">Разное</button>`;

    const catContents = categories.length
      ? categories
          .map(
            (cat, index) => `
              <div class="category-content ${index === 0 ? "active" : ""}" data-cat="${escapeHtml(cat)}" ${index === 0 ? "" : "hidden"}>
                ${getCommonItemFiltersMarkup()}
                <div class="items-table-container"></div>
              </div>
            `
          )
          .join("")
      : `
        <div class="category-content active" data-cat="${escapeHtml(firstCategory)}">
          ${getCommonItemFiltersMarkup()}
          <div class="items-table-container"></div>
        </div>
      `;

    const race = safe(trader.race, "—");
    const className = safe(trader.class_name, "—");
    const level = safe(trader.level, trader.level_min || "—");
    const stats = parseProps(trader.stats);
    const abilities = parseArray(trader.abilities);
    const possessions = parseArray(trader.possessions);

    const statsHtml = `
      <div class="stats-grid">
        <div class="stat-item"><strong>Раса</strong><span>${escapeHtml(race)}</span></div>
        <div class="stat-item"><strong>Класс</strong><span>${escapeHtml(className)}</span></div>
        <div class="stat-item"><strong>Уровень</strong><span>${escapeHtml(String(level))}</span></div>
        ${Object.entries(stats)
          .map(
            ([k, v]) => `
              <div class="stat-item">
                <strong>${escapeHtml(String(k).toUpperCase())}</strong>
                <span>${escapeHtml(String(v))}</span>
              </div>
            `
          )
          .join("")}
      </div>

      ${
        abilities.length
          ? `<div><strong>Способности:</strong><ul>${abilities.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul></div>`
          : ""
      }

      ${
        possessions.length
          ? `<div><strong>Личные вещи:</strong><ul>${possessions.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul></div>`
          : ""
      }
    `;

    const infoHtml =
      trader.personality || possessions.length || trader.rumors
        ? `
          <div>
            ${
              trader.personality
                ? `<div class="trader-detail-section"><h4>🧠 Особенности</h4><p>${escapeHtml(trader.personality)}</p></div>`
                : ""
            }
            ${
              possessions.length
                ? `<div class="trader-detail-section"><h4>🎒 Личные вещи</h4><ul>${possessions.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul></div>`
                : ""
            }
            ${
              trader.rumors
                ? `<div class="trader-detail-section"><h4>🔍 Слухи / Квесты</h4><p>${escapeHtml(trader.rumors)}</p></div>`
                : ""
            }
          </div>
        `
        : `<p>Нет дополнительной информации.</p>`;

    const notesHtml = `
      <div class="gm-notes">
        <label>📝 Заметки ГМ:</label>
        <textarea id="gmNote-${trader.id}" placeholder="Ваши заметки о торговце."></textarea>
      </div>
    `;

    const sellHtml = `
      <div id="sellSection">
        <h3>💰 Продажа торговцу</h3>
        <p>Продажа будет подключена следующим слоем.</p>
      </div>
    `;

    content.innerHTML = `
      <h2>${escapeHtml(safe(trader.name, "Без имени"))}</h2>

      <div class="trader-modal-header">
        ${
          trader.image_url
            ? `
              <div class="trader-modal-image-wrap">
                <img
                  src="${escapeHtml(imageUrl)}"
                  alt="${escapeHtml(trader.name || "Торговец")}"
                  class="trader-modal-image"
                />
              </div>
            `
            : ""
        }

        <div class="trader-modal-main-info">
          <p><strong>Тип:</strong> ${escapeHtml(safe(trader.type, "—"))}</p>
          <p><strong>Регион:</strong> ${escapeHtml(safe(trader.region, "—"))} | ${escapeHtml(safe(trader.settlement, "—"))}</p>
          <p><strong>Уровни:</strong> ${escapeHtml(`${safe(trader.level_min, "—")}–${safe(trader.level_max, "∞")}`)}</p>
          <p>
            <strong>Репутация:</strong>
            <span id="traderReputation-${trader.id}">${escapeHtml(String(safe(trader.reputation, 0)))}</span>
            (${escapeHtml(getReputationStars(trader.reputation))})
            — <strong>Скидка: ${escapeHtml(getDiscountLabel(trader.reputation))}</strong>
          </p>
          <p>${escapeHtml(safe(trader.description, ""))}</p>
        </div>
      </div>

      <button id="restockBtn" class="btn btn-primary" style="margin:10px 0;">🔄 Обновить ассортимент</button>

      <div class="tab-bar trader-main-tabs">
        <button class="tab-btn active" data-tab="buy">Товары</button>
        <button class="tab-btn" data-tab="sell">Продажа</button>
        <button class="tab-btn" data-tab="stats">Статистика</button>
        <button class="tab-btn" data-tab="info">Информация</button>
        <button class="tab-btn" data-tab="notes">Заметки ГМ</button>
      </div>

      <div id="tab-buy" class="tab-content active">
        <div class="tab-bar category-tabs">${catTabs}</div>
        ${catContents}
      </div>

      <div id="tab-sell" class="tab-content" hidden style="display:none;">
        ${sellHtml}
      </div>

      <div id="tab-stats" class="tab-content" hidden style="display:none;">
        ${statsHtml}
      </div>

      <div id="tab-info" class="tab-content" hidden style="display:none;">
        ${infoHtml}
      </div>

      <div id="tab-notes" class="tab-content" hidden style="display:none;">
        ${notesHtml}
      </div>
    `;

    bindModalTabSystem(content);
    bindCategoryTabs(content);
    bindCategoryFilters(content, grouped, traderId);
    bindTraderModalActions(content, traderId);
  } catch (error) {
    console.error(error);
    content.innerHTML = `<div class="error-state">Ошибка загрузки торговца.</div>`;
  }
}

export function renderCart(cart) {
  const container = document.getElementById("cart-container");
  if (!container) return;

  const reserved = Array.isArray(window.getReservedItems?.())
    ? window.getReservedItems()
    : [];

  if ((!Array.isArray(cart) || !cart.length) && !reserved.length) {
    container.innerHTML = "<p>Корзина пуста</p>";
    return;
  }

  container.innerHTML = `
    <div class="collection-view collection-cart">
      <div class="tab-bar collection-tabs">
        <button class="tab-btn active" data-collection-tab="cart">Корзина</button>
        <button class="tab-btn" data-collection-tab="reserved">Зарезервировано</button>
      </div>

      <div class="collection-tab-content active" data-collection-panel="cart">
        ${getCommonItemFiltersMarkup()}
        <div class="collection-items-container"></div>
      </div>

      <div class="collection-tab-content reserved-panel" data-collection-panel="reserved" hidden style="display:none;">
        ${getCommonItemFiltersMarkup()}
        <div class="collection-items-container reserved-items-container"></div>
      </div>
    </div>
  `;

  const root = container.firstElementChild;
  const panels = root.querySelectorAll(".collection-tab-content");
  const tabs = root.querySelectorAll("[data-collection-tab]");

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.collectionTab;

      tabs.forEach((b) => b.classList.toggle("active", b.dataset.collectionTab === target));
      panels.forEach((panel) => {
        const active = panel.dataset.collectionPanel === target;
        panel.classList.toggle("active", active);
        panel.hidden = !active;
        panel.style.display = active ? "" : "none";
      });
    });
  });

  const cartPanel = root.querySelector('[data-collection-panel="cart"]');
  const reservedPanel = root.querySelector('[data-collection-panel="reserved"]');

  if (cartPanel) bindCollectionFilters(cartPanel, cart, "cart", "cart");
  if (reservedPanel) bindCollectionFilters(reservedPanel, reserved, "reserved", "reserved");

  bindItemActionHandlers(container, "cart");
}

export function renderInventory(items) {
  const container = document.getElementById("inventory-container");
  const cabinetInventory = document.getElementById("cabinet-inventory");

  const list = Array.isArray(items) ? items : [];

  if (!list.length) {
    if (container) container.innerHTML = "<p>Инвентарь пуст</p>";
    if (cabinetInventory) {
      cabinetInventory.innerHTML = `
        <div class="cabinet-block">
          <h3>Инвентарь</h3>
          <p>Инвентарь пуст</p>
        </div>
      `;
    }
    return;
  }

  if (container) {
    container.innerHTML = `
      <div class="collection-view collection-inventory">
        ${getCommonItemFiltersMarkup()}
        <div class="collection-items-container"></div>
      </div>
    `;

    bindCollectionFilters(container.firstElementChild, list, "inventory", "inventory");
    bindItemActionHandlers(container, "inventory");
  }

  if (cabinetInventory) {
    cabinetInventory.innerHTML = `
      <div class="cabinet-block">
        <h3>Инвентарь</h3>
        <div class="cabinet-inventory-list">
          ${list
            .map(
              (item) => `
                <div class="cabinet-inventory-row">
                  <span><strong>${escapeHtml(safe(item.name, "Без названия"))}</strong></span>
                  <span>Кол-во: ${escapeHtml(String(safe(item.quantity, 0)))}</span>
                  <span>Продажа: ${escapeHtml(formatSellPrice(item))}</span>
                </div>
              `
            )
            .join("")}
        </div>
      </div>
    `;
  }
}