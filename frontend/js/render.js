// ============================================================
// frontend/js/render.js
// Рендер фронта под RPG-визуал:
// - большие квадратные карточки торговцев
// - без кнопки "Открыть"
// - названия предметов окрашиваются по редкости
// - компактнее модалки и фильтры
// - без лишнего крестика в модалке торговца
// - скидка / репутация / эмодзи в нужных местах
// - совместим со старым index.html и текущим app.js
// ============================================================

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
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
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

function getFirstEl(...ids) {
  for (const id of ids) {
    const el = getEl(id);
    if (el) return el;
  }
  return null;
}

function showToast(message) {
  if (typeof window.showToast === "function") {
    window.showToast(message);
    return;
  }
  console.log(message);
}

// ------------------------------------------------------------
// 🌐 STATE BRIDGES
// ------------------------------------------------------------
function getTradersState() {
  return Array.isArray(window.__appStateTraders) ? window.__appStateTraders : [];
}

function getInventoryState() {
  return Array.isArray(window.__appStateInventory) ? window.__appStateInventory : [];
}

function getReservedState() {
  if (typeof window.getReservedItems === "function") {
    const items = window.getReservedItems();
    return Array.isArray(items) ? items : [];
  }
  return Array.isArray(window.__appStateReserved) ? window.__appStateReserved : [];
}

function getTraderById(traderId) {
  return (
    getTradersState().find((trader) => Number(trader?.id) === Number(traderId)) ||
    null
  );
}

function getTraderModalContent() {
  return getFirstEl("traderModalContent", "modalContent");
}

function getTradersContainer() {
  return getFirstEl(
    "traders-container",
    "tradersGrid",
    "tradersContainer",
    "traderGrid"
  );
}

function getCartContainer() {
  return getFirstEl(
    "cart-container",
    "cartItemsContainer",
    "cartItems",
    "cartContent",
    "cartList"
  );
}

function getInventoryContainer() {
  return getFirstEl(
    "inventory-container",
    "inventoryItemsContainer",
    "inventoryItems",
    "inventoryContent",
    "inventoryList"
  );
}

// ------------------------------------------------------------
// 💰 MONEY
// ------------------------------------------------------------
function formatMoneyParts(gold = 0, silver = 0, copper = 0) {
  const parts = [];
  if (Number(gold || 0)) parts.push(`${Number(gold)}з`);
  if (Number(silver || 0)) parts.push(`${Number(silver)}с`);
  if (Number(copper || 0)) parts.push(`${Number(copper)}м`);
  return parts.length ? parts.join(" ") : "0з";
}

function formatBuyPrice(item) {
  if (item?.buy_price_label) return item.buy_price_label;
  if (item?.price_label) return item.price_label;

  return formatMoneyParts(
    Number(item?.buy_price_gold ?? item?.price_gold ?? 0),
    Number(item?.buy_price_silver ?? item?.price_silver ?? 0),
    Number(item?.buy_price_copper ?? item?.price_copper ?? 0)
  );
}

function formatSellPrice(item) {
  if (item?.sell_price_label) return item.sell_price_label;

  const result = formatMoneyParts(
    Number(item?.sell_price_gold ?? 0),
    Number(item?.sell_price_silver ?? 0),
    Number(item?.sell_price_copper ?? 0)
  );

  return result === "0з" ? "—" : result;
}

// ------------------------------------------------------------
// 🧿 LOOKUPS / NORMALIZERS
// ------------------------------------------------------------
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

function rarityClass(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

  if (raw === "common") return "rarity-common";
  if (raw === "uncommon") return "rarity-uncommon";
  if (raw === "rare") return "rarity-rare";
  if (raw === "veryrare") return "rarity-veryrare";
  if (raw === "legendary") return "rarity-legendary";
  if (raw === "artifact") return "rarity-artifact";
  return "rarity-common";
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

function normalizeImageUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (raw.startsWith("/static/images/")) return raw;
  if (raw.startsWith("/static/")) {
    const file = raw.split("/").pop();
    return `/static/images/${file}`;
  }
  if (raw.startsWith("static/images/")) return `/${raw}`;
  if (raw.startsWith("static/")) {
    const file = raw.split("/").pop();
    return `/static/images/${file}`;
  }
  return `/static/images/${raw.replace(/^\/+/, "")}`;
}

function getTraderImageUrl(trader) {
  const raw = String(
    trader?.image_url ||
      trader?.image ||
      trader?.portrait ||
      trader?.avatar ||
      ""
  ).trim();

  return normalizeImageUrl(raw);
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

function getTraderDiscountPercent(reputation) {
  const rep = Math.max(0, Math.min(100, Number(reputation || 0)));
  const ratio = rep / 100;
  const buyMultiplier = 1 - ((1 - 0.6667) * ratio);
  return Math.max(0, Math.round((1 - buyMultiplier) * 100));
}

function getTraderEmoji(type) {
  const raw = String(type || "").trim().toLowerCase();

  if (raw.includes("алх")) return "⚗️";
  if (raw.includes("книг")) return "📚";
  if (raw.includes("оруж")) return "🗡️";
  if (raw.includes("куз")) return "⚒️";
  if (raw.includes("кож")) return "🧥";
  if (raw.includes("пек")) return "🥖";
  if (raw.includes("мяс")) return "🥩";
  if (raw.includes("друид")) return "🌿";
  if (raw.includes("цирю")) return "✂️";
  if (raw.includes("тракт")) return "🍺";
  if (raw.includes("худож")) return "🎨";
  if (raw.includes("торгов")) return "🧳";
  return "🏪";
}

function getItemEmoji(item) {
  const category = String(item?.category_clean || item?.category || "").toLowerCase();
  const props = parseJsonObject(item?.properties);

  if (category.includes("weapon")) return "🗡️";
  if (category.includes("armor")) return "🛡️";
  if (category.includes("alchemy")) return "⚗️";
  if (category.includes("potion")) return "🧪";
  if (category.includes("food")) return "🍖";
  if (category.includes("drink")) return "🍷";
  if (category.includes("tool")) return "🧰";
  if (category.includes("scroll")) return "📜";
  if (category.includes("book")) return "📘";
  if (category.includes("accessory")) return "💍";
  if (props.damage) return "⚔️";
  if (props.healing) return "✨";
  if (item?.is_magical) return "🔮";
  return "📦";
}

function getRegionEmoji() {
  return "🌍";
}

function getSettlementEmoji() {
  return "🏘️";
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

function getItemPriceNumeric(item, context = "trader") {
  if (context === "inventory") {
    return (
      Number(item?.sell_price_gold || 0) +
      Number(item?.sell_price_silver || 0) / 100 +
      Number(item?.sell_price_copper || 0) / 10000
    );
  }

  return (
    Number(item?.buy_price_gold ?? item?.price_gold ?? 0) +
    Number(item?.buy_price_silver ?? item?.price_silver ?? 0) / 100 +
    Number(item?.buy_price_copper ?? item?.price_copper ?? 0) / 10000
  );
}

function getItemCharacteristics(item) {
  const props = parseJsonObject(item?.properties);
  const parts = [];

  if (props.damage) parts.push(`Урон: ${props.damage}`);
  if (props.damage_type) parts.push(`Тип: ${props.damage_type}`);
  if (props.ac) parts.push(`КД: ${props.ac}`);
  if (props.range) parts.push(`Дистанция: ${props.range}`);
  if (props.healing) parts.push(`Лечение: ${props.healing}`);
  if (props.special_properties) parts.push(`Свойства: ${props.special_properties}`);
  if (item?.weight) parts.push(`Вес: ${item.weight}`);
  if (item?.slot) parts.push(`Слот: ${item.slot}`);
  if (item?.is_magical) parts.push("Магический");
  if (item?.attunement) parts.push("Требует настройки");

  return parts.length ? parts.join(" • ") : "—";
}

function getItemShortDescription(item, maxLength = 110) {
  const text = String(
    item?.description || item?.rules_text || item?.effect || ""
  ).trim();

  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function getItemFullDescription(item) {
  const props = parseJsonObject(item?.properties);
  const requirements = parseJsonObject(item?.requirements);
  const lines = [];

  if (item?.description) lines.push(String(item.description));
  if (item?.description_ru && item.description_ru !== item?.description) {
    lines.push(String(item.description_ru));
  }
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
    lines.push(
      `Требования: ${reqKeys.map((k) => `${k}: ${requirements[k]}`).join(", ")}`
    );
  }

  if (!lines.length) {
    lines.push("Подробное описание пока отсутствует.");
  }

  return lines.join("\n\n");
}

// ------------------------------------------------------------
// 📖 DESCRIPTION MODAL
// ------------------------------------------------------------
function ensureDescriptionModal() {
  let modal = getEl("itemDescriptionModal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "itemDescriptionModal";
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-content">
        <span class="close">&times;</span>
        <div id="itemDescriptionContent"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const close = modal.querySelector(".close");
  if (close && !close.dataset.boundClose) {
    close.dataset.boundClose = "1";
    close.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }

  if (!modal.dataset.boundOverlay) {
    modal.dataset.boundOverlay = "1";
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        modal.style.display = "none";
      }
    });
  }

  return modal;
}

function openItemDescriptionModal(item, context = "trader") {
  const modal = ensureDescriptionModal();
  if (!modal) return;

  let content = getEl("itemDescriptionContent");
  if (!content) {
    content = document.createElement("div");
    content.id = "itemDescriptionContent";
    modal.querySelector(".modal-content")?.appendChild(content);
  }

  const priceText = context === "inventory" ? formatSellPrice(item) : formatBuyPrice(item);
  const rareClass = rarityClass(item?.rarity);
  const itemEmoji = getItemEmoji(item);

  content.innerHTML = `
    <h2 class="${escapeHtml(rareClass)}">${escapeHtml(itemEmoji)} ${escapeHtml(item?.name || "Без названия")}</h2>
    <div class="item-meta-block">
      <p><strong>💰 Цена:</strong> ${escapeHtml(priceText)}</p>
      <p><strong>🎖 Редкость:</strong> <span class="${escapeHtml(
        rareClass
      )}">${escapeHtml(normalizeRarity(item?.rarity))}</span></p>
      <p><strong>🛠 Качество:</strong> ${escapeHtml(normalizeQuality(item?.quality))}</p>
      <p><strong>📌 Характеристики:</strong> ${escapeHtml(getItemCharacteristics(item))}</p>
    </div>
    <pre class="item-description-pre">${escapeHtml(getItemFullDescription(item))}</pre>
  `;

  modal.style.display = "block";
}

// ------------------------------------------------------------
// 🔢 QTY
// ------------------------------------------------------------
function renderQtyInput(maxQty, itemId, initial = 1, disabled = false) {
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
      ${disabled ? "disabled" : ""}
    />
  `;
}

function getQtyFromButton(button, fallback = 1) {
  const row = button.closest("[data-item-id-row]");
  if (!row) return Math.max(1, Number(fallback || 1));

  const input = row.querySelector(".qty-input");
  if (!input) return Math.max(1, Number(fallback || 1));

  const max = Number(input.max || fallback || 1);
  const value = Number(input.value || fallback || 1);

  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(Math.max(1, value), Math.max(1, max));
}

// ------------------------------------------------------------
// 🗂 LABELS
// ------------------------------------------------------------
function categoryLabel(value) {
  const map = {
    accessory: "💍 Аксессуары",
    alchemy: "⚗️ Алхимия",
    armor: "🛡️ Броня",
    consumables: "🧰 Расходники",
    food_drink: "🍖 Еда и напитки",
    misc: "📦 Разное",
    potions_elixirs: "🧪 Зелья и эликсиры",
    scrolls_books: "📜 Свитки и книги",
    tools: "🛠️ Инструменты",
    weapon: "🗡️ Оружие",
  };
  return map[String(value || "").trim()] || `📦 ${String(value || "Разное")}`;
}

function specializationPreview(trader) {
  const specs = parseJsonArray(trader?.specialization).filter(Boolean);
  if (!specs.length) return "ассортимент";
  return specs.slice(0, 4).join(", ");
}

// ------------------------------------------------------------
// 🔎 INLINE FILTERS
// ------------------------------------------------------------
function getCompactCollectionFiltersMarkup(context = "trader") {
  return `
    <div class="collection-toolbar compact-collection-toolbar">
      <div class="filter-group">
        <label>🔍 Поиск</label>
        <input type="text" class="item-search-inline" placeholder="Название предмета" />
      </div>

      <div class="filter-group">
        <label>💰 Цена</label>
        <div class="price-range">
          <input type="number" class="price-min-inline" placeholder="от" min="0" />
          <input type="number" class="price-max-inline" placeholder="до" min="0" />
        </div>
      </div>

      <div class="filter-group">
        <label>🎖 Редкость</label>
        <select class="rarity-inline">
          <option value="">Любая</option>
          <option value="common">Обычный</option>
          <option value="uncommon">Необычный</option>
          <option value="rare">Редкий</option>
          <option value="very rare">Очень редкий</option>
          <option value="legendary">Легендарный</option>
          <option value="artifact">Артефакт</option>
        </select>
      </div>

      ${
        context !== "inventory"
          ? `
      <label class="inline-checkbox compact-inline-checkbox">
        <input type="checkbox" class="magic-inline" />
        🔮 Магия
      </label>
      `
          : ""
      }

      <div class="filter-group">
        <label>↕ Сортировка</label>
        <select class="sort-inline">
          <option value="name">Название</option>
          <option value="price_asc">Дешёвые</option>
          <option value="price_desc">Дорогие</option>
        </select>
      </div>

      <div class="filter-group">
        <label>🧩 Вид</label>
        <select class="view-mode-inline">
          <option value="table">Таблица</option>
          <option value="inventory">Список</option>
          <option value="grid">Карточки</option>
        </select>
      </div>
    </div>
  `;
}

function filterCollectionItems(items, wrapper, context = "trader") {
  const search =
    wrapper.querySelector(".item-search-inline")?.value?.trim().toLowerCase() || "";
  const min = wrapper.querySelector(".price-min-inline")?.value ?? "";
  const max = wrapper.querySelector(".price-max-inline")?.value ?? "";
  const rarity = wrapper.querySelector(".rarity-inline")?.value || "";
  const magic = wrapper.querySelector(".magic-inline")?.checked || false;
  const sort = wrapper.querySelector(".sort-inline")?.value || "name";

  let filtered = [...(items || [])].filter((item) => {
    const name = String(item?.name || "").toLowerCase();
    const price = getItemPriceNumeric(item, context);
    const itemRarity = String(item?.rarity || "");
    const isMagical = Boolean(item?.is_magical);

    if (search && !name.includes(search)) return false;
    if (min !== "" && price < Number(min)) return false;
    if (max !== "" && price > Number(max)) return false;
    if (rarity && itemRarity !== rarity) return false;
    if (magic && !isMagical) return false;

    return true;
  });

  if (sort === "name") {
    filtered.sort((a, b) =>
      String(a?.name || "").localeCompare(String(b?.name || ""), "ru")
    );
  } else if (sort === "price_asc") {
    filtered.sort((a, b) => getItemPriceNumeric(a, context) - getItemPriceNumeric(b, context));
  } else if (sort === "price_desc") {
    filtered.sort((a, b) => getItemPriceNumeric(b, context) - getItemPriceNumeric(a, context));
  }

  return filtered;
}

// ------------------------------------------------------------
// 🎮 ITEM ACTIONS
// ------------------------------------------------------------
function renderItemActions(item, context, contextId) {
  const itemId = getItemId(item);
  const traderId = contextId != null ? Number(contextId) : "";
  const stock = getTraderStock(item);
  const owned = getOwnedQuantity(item);

  if (context === "trader") {
    const disabled = stock <= 0;
    return `
      <div class="item-actions item-actions-stack">
        <button class="btn btn-success js-buy-item" data-item-id="${itemId}" data-trader-id="${traderId}" ${
          disabled ? "disabled" : ""
        }>
          🛒 ${disabled ? "Нет в наличии" : "Купить"}
        </button>
        <button class="btn btn-primary js-add-cart" data-item-id="${itemId}" data-trader-id="${traderId}" ${
          disabled ? "disabled" : ""
        }>🎒 В корзину</button>
        <button class="btn btn-warning js-reserve-item" data-item-id="${itemId}" data-trader-id="${traderId}" ${
          disabled ? "disabled" : ""
        }>📌 Резерв</button>
        <button class="btn js-open-desc" data-item-id="${itemId}" data-trader-id="${traderId}" data-context="trader">📖 Описание</button>
      </div>
    `;
  }

  if (context === "cart") {
    return `
      <div class="item-actions item-actions-stack">
        <button class="btn js-open-desc" data-item-id="${itemId}" data-context="cart">📖 Описание</button>
        <button class="btn btn-warning js-reserve-from-cart" data-item-id="${itemId}" data-trader-id="${traderId}">📌 В резерв</button>
        <button class="btn btn-danger js-remove-cart" data-item-id="${itemId}" data-trader-id="${traderId}">🗑 Удалить</button>
      </div>
    `;
  }

  if (context === "reserved") {
    return `
      <div class="item-actions item-actions-stack">
        <button class="btn js-open-desc" data-item-id="${itemId}" data-context="reserved">📖 Описание</button>
        <button class="btn btn-danger js-unreserve" data-item-id="${itemId}" data-trader-id="${traderId}">❌ Снять резерв</button>
      </div>
    `;
  }

  if (context === "inventory") {
    const disabled = owned <= 0;
    return `
      <div class="item-actions item-actions-stack">
        <button class="btn js-open-desc" data-item-id="${itemId}" data-context="inventory">📖 Описание</button>
        <button class="btn btn-success js-sell-item" data-item-id="${itemId}" ${
          disabled ? "disabled" : ""
        }>💰 Продать</button>
        <button class="btn btn-danger js-remove-inventory" data-item-id="${itemId}">🗑 Удалить</button>
      </div>
    `;
  }

  return "";
}

// ------------------------------------------------------------
// 🧱 ITEM RENDERS
// ------------------------------------------------------------
function renderItemsTable(items, context, contextId) {
  if (!items?.length) {
    return `<div class="trader-detail-section"><p>Ничего не найдено.</p></div>`;
  }

  return `
    <div class="items-table-container compact-items-table">
      <table class="items-table">
        <thead>
          <tr>
            <th>Предмет</th>
            <th>Цена</th>
            <th>Редкость</th>
            <th>Качество</th>
            <th>${context === "inventory" ? "Кол-во" : "Остаток"}</th>
            <th>Кратко</th>
            <th>Шт</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${(items || [])
            .map((item) => {
              const itemId = getItemId(item);
              const amount =
                context === "inventory" ? getOwnedQuantity(item) : getTraderStock(item);
              const maxQty = Math.max(1, amount || 1);
              const priceText =
                context === "inventory" ? formatSellPrice(item) : formatBuyPrice(item);
              const rareClass = rarityClass(item?.rarity);
              const qtyDisabled = amount <= 0;
              const itemEmoji = getItemEmoji(item);

              return `
                <tr data-item-id-row="${itemId}" class="${escapeHtml(rareClass)}">
                  <td>
                    <div class="item-name ${escapeHtml(rareClass)}">${escapeHtml(itemEmoji)} ${escapeHtml(item?.name || "Без названия")}</div>
                  </td>
                  <td>${escapeHtml(priceText)}</td>
                  <td><span class="${escapeHtml(rareClass)}">${escapeHtml(
                    normalizeRarity(item?.rarity)
                  )}</span></td>
                  <td>${escapeHtml(normalizeQuality(item?.quality))}</td>
                  <td>${escapeHtml(String(amount))}</td>
                  <td>${escapeHtml(getItemShortDescription(item) || getItemCharacteristics(item))}</td>
                  <td>${renderQtyInput(maxQty, itemId, 1, qtyDisabled)}</td>
                  <td class="add-cell">${renderItemActions(item, context, contextId)}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderItemsGrid(items, context, contextId) {
  if (!items?.length) {
    return `<div class="trader-detail-section"><p>Ничего не найдено.</p></div>`;
  }

  return `
    <div class="traders-grid compact-modal-grid">
      ${(items || [])
        .map((item) => {
          const itemId = getItemId(item);
          const amount =
            context === "inventory" ? getOwnedQuantity(item) : getTraderStock(item);
          const maxQty = Math.max(1, amount || 1);
          const priceText =
            context === "inventory" ? formatSellPrice(item) : formatBuyPrice(item);
          const rareClass = rarityClass(item?.rarity);
          const qtyDisabled = amount <= 0;
          const itemEmoji = getItemEmoji(item);

          return `
            <div class="trader-card item-card-common ${escapeHtml(
              rareClass
            )}" data-item-id-row="${itemId}">
              <div class="trader-info">
                <div class="trader-name ${escapeHtml(rareClass)}">${escapeHtml(itemEmoji)} ${escapeHtml(item?.name || "Без названия")}</div>
                <div class="trader-type">💰 ${escapeHtml(priceText)}</div>
                <div class="trader-meta">
                  <span class="meta-item ${escapeHtml(rareClass)}">${escapeHtml(
                    normalizeRarity(item?.rarity)
                  )}</span>
                  <span class="meta-item">🛠 ${escapeHtml(
                    normalizeQuality(item?.quality)
                  )}</span>
                  <span class="meta-item">${
                    context === "inventory" ? "🎒 Количество" : "📦 Осталось"
                  }: ${escapeHtml(String(amount))}</span>
                </div>
                <div class="trader-desc">${escapeHtml(
                  getItemShortDescription(item) || getItemCharacteristics(item)
                )}</div>
                <div style="margin-top:10px;">${renderQtyInput(
                  maxQty,
                  itemId,
                  1,
                  qtyDisabled
                )}</div>
                <div style="margin-top:10px;">${renderItemActions(
                  item,
                  context,
                  contextId
                )}</div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderItemsInventoryList(items, context, contextId) {
  if (!items?.length) {
    return `<div class="trader-detail-section"><p>Ничего не найдено.</p></div>`;
  }

  return `
    <div class="inventory-items-list">
      ${(items || [])
        .map((item) => {
          const itemId = getItemId(item);
          const amount =
            context === "inventory" ? getOwnedQuantity(item) : getTraderStock(item);
          const maxQty = Math.max(1, amount || 1);
          const priceText =
            context === "inventory" ? formatSellPrice(item) : formatBuyPrice(item);
          const rareClass = rarityClass(item?.rarity);
          const qtyDisabled = amount <= 0;
          const itemEmoji = getItemEmoji(item);

          return `
            <div class="inventory-item" data-item-id-row="${itemId}">
              <div class="inventory-item-info">
                <strong class="${escapeHtml(rareClass)}">${escapeHtml(
                  itemEmoji
                )} ${escapeHtml(item?.name || "Без названия")}</strong>
                <div>💰 ${escapeHtml(priceText)}</div>
                <div class="inv-item-details">
                  <span class="${escapeHtml(rareClass)}">🎖 ${escapeHtml(
                    normalizeRarity(item?.rarity)
                  )}</span>
                  <span>🛠 ${escapeHtml(normalizeQuality(item?.quality))}</span>
                  <span>${
                    context === "inventory" ? "🎒 Количество" : "📦 Осталось"
                  }: ${escapeHtml(String(amount))}</span>
                </div>
                <div class="trader-desc" style="margin-top:6px;">
                  ${escapeHtml(getItemShortDescription(item) || getItemCharacteristics(item))}
                </div>
              </div>

              <div class="inventory-item-controls">
                <div class="inventory-item-qty">
                  ${renderQtyInput(maxQty, itemId, 1, qtyDisabled)}
                </div>
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

  const filtered = filterCollectionItems(items, wrapper, context);
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
      ".item-search-inline, .price-min-inline, .price-max-inline, .rarity-inline, .magic-inline, .sort-inline, .view-mode-inline"
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
    const category = String(item?.category_clean || item?.category || "misc");
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(item);
  }
  return grouped;
}

// ------------------------------------------------------------
// 🧑‍💼 TRADER MODAL BLOCKS
// ------------------------------------------------------------
function buildTraderHeader(trader) {
  const specialization =
    parseJsonArray(trader?.specialization).join(", ") ||
    safe(trader?.specialization, "—");

  const imageUrl = getTraderImageUrl(trader);
  const hasImage = Boolean(imageUrl);

  const repStars = getReputationStars(trader?.reputation);
  const repTitle = getTraderQuality(trader?.reputation);
  const currentDiscount = getTraderDiscountPercent(trader?.reputation);
  const traderEmoji = getTraderEmoji(trader?.type);

  return `
    <div class="trader-modal-header">
      ${
        hasImage
          ? `
        <div class="trader-modal-image-wrap">
          <img class="trader-modal-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(
              trader?.name || "Торговец"
            )}" />
        </div>
      `
          : ""
      }

      <div class="trader-modal-info">
        <div class="trader-header-title-row">
          <h2>${escapeHtml(traderEmoji)} ${escapeHtml(trader?.name || "Безымянный торговец")}</h2>
        </div>

        <div class="trader-meta trader-modal-meta">
          <span class="meta-item">${escapeHtml(traderEmoji)} ${escapeHtml(trader?.type || "—")}</span>
          <span class="meta-item">${getRegionEmoji()} ${escapeHtml(trader?.region || "—")}</span>
          <span class="meta-item">${getSettlementEmoji()} ${escapeHtml(trader?.settlement || "—")}</span>
          <span class="meta-item">⭐ ${escapeHtml(repStars)}</span>
        </div>

        <div class="trader-detail-section trader-reputation-box">
          <p><strong>⭐ Репутация:</strong> ${escapeHtml(repTitle)}</p>
          <p><strong>💸 Текущая скидка:</strong> ${escapeHtml(String(currentDiscount))}%</p>
          <p><strong>🎯 Специализация:</strong> ${escapeHtml(specialization)}</p>
          <p><strong>💰 Золото торговца:</strong> ${escapeHtml(
            String(trader?.money_label || trader?.gold_label || trader?.gold || "—")
          )}</p>
        </div>

        <div class="trader-detail-section">
          <p><strong>📜 Описание:</strong> ${escapeHtml(trader?.description || "—")}</p>
        </div>
      </div>
    </div>
  `;
}

function buildTraderStats(trader) {
  const stats = parseJsonObject(trader?.stats);
  const abilities = parseJsonArray(trader?.abilities);
  const possessions = parseJsonArray(trader?.possessions);
  const race = trader?.race || "—";
  const className = trader?.class_name || trader?.class || "—";
  const level = trader?.trader_level || trader?.level || "—";

  const statsHtml = Object.keys(stats).length
    ? `
      <div class="stats-grid">
        <div class="stat-item"><strong>🧬 Раса</strong><span>${escapeHtml(String(
          race
        ))}</span></div>
        <div class="stat-item"><strong>🎓 Класс</strong><span>${escapeHtml(String(
          className
        ))}</span></div>
        <div class="stat-item"><strong>📈 Уровень</strong><span>${escapeHtml(String(
          level
        ))}</span></div>
        ${Object.entries(stats)
          .map(
            ([key, value]) => `
          <div class="stat-item">
            <strong>${escapeHtml(String(key).toUpperCase())}</strong>
            <span>${escapeHtml(String(value))}</span>
          </div>
        `
          )
          .join("")}
      </div>
    `
    : `
      <div class="stats-grid">
        <div class="stat-item"><strong>🧬 Раса</strong><span>${escapeHtml(String(
          race
        ))}</span></div>
        <div class="stat-item"><strong>🎓 Класс</strong><span>${escapeHtml(String(
          className
        ))}</span></div>
        <div class="stat-item"><strong>📈 Уровень</strong><span>${escapeHtml(String(
          level
        ))}</span></div>
      </div>
    `;

  return `
    <div class="trader-detail-section">
      <h4>⚔️ Статы</h4>
      ${statsHtml}
    </div>
    ${
      abilities.length
        ? `
      <div class="trader-detail-section">
        <h4>✨ Способности</h4>
        <ul>${abilities
          .map((a) => `<li>${escapeHtml(String(a))}</li>`)
          .join("")}</ul>
      </div>
    `
        : ""
    }
    ${
      possessions.length
        ? `
      <div class="trader-detail-section">
        <h4>🎒 Личные вещи</h4>
        <ul>${possessions
          .map((p) => `<li>${escapeHtml(String(p))}</li>`)
          .join("")}</ul>
      </div>
    `
        : ""
    }
  `;
}

function buildTraderInfo(trader) {
  return `
    <div class="trader-detail-section">
      <h4>📜 Описание</h4>
      <p>${escapeHtml(trader?.description || "Описание отсутствует")}</p>
    </div>

    <div class="trader-detail-section">
      <h4>🎯 Специализация</h4>
      <p>${escapeHtml(
        parseJsonArray(trader?.specialization).join(", ") ||
          safe(trader?.specialization, "—")
      )}</p>
    </div>

    <div class="trader-detail-section">
      <h4>🗣️ Особенности</h4>
      <p>${escapeHtml(safe(trader?.personality, "—"))}</p>
    </div>

    <div class="trader-detail-section">
      <h4>📌 Слухи / квесты</h4>
      <p>${escapeHtml(safe(trader?.rumors, "—"))}</p>
    </div>
  `;
}

function buildTraderTabs(grouped, trader) {
  const categoryNames = Object.keys(grouped);

  const buyTabs = categoryNames
    .map(
      (category, index) => `
      <button class="category-tab ${index === 0 ? "active" : ""}" data-cat="${escapeHtml(
        category
      )}">
        ${escapeHtml(categoryLabel(category))}
      </button>
    `
    )
    .join("");

  const buyContents = categoryNames
    .map(
      (category, index) => `
      <div class="category-content ${index === 0 ? "active" : ""}" data-cat="${escapeHtml(
        category
      )}" ${index === 0 ? "" : 'style="display:none" hidden'}>
        <div class="collection-wrapper">
          ${getCompactCollectionFiltersMarkup("trader")}
          <div class="collection-items-container"></div>
        </div>
      </div>
    `
    )
    .join("");

  return `
    <div class="tab-bar">
      <button class="tab-btn active" data-main-tab="buy">🎒 Товары</button>
      <button class="tab-btn" data-main-tab="sell">💰 Продажа</button>
      <button class="tab-btn" data-main-tab="stats">⚔️ Статы</button>
      <button class="tab-btn" data-main-tab="info">📜 Информация</button>
    </div>

    <div id="tab-buy" class="tab-content active" style="display:block;">
      ${
        categoryNames.length
          ? `<div class="category-tabs tab-bar">${buyTabs}</div>${buyContents}`
          : `<p>У торговца нет товаров.</p>`
      }
    </div>

    <div id="tab-sell" class="tab-content" style="display:none;">
      <div id="sellSection">
        <h3>💰 Продажа торговцу</h3>
        <div class="collection-wrapper">
          ${getCompactCollectionFiltersMarkup("inventory")}
          <div class="collection-items-container" id="sellItemsContainer"></div>
        </div>
      </div>
    </div>

    <div id="tab-stats" class="tab-content" style="display:none;">
      ${buildTraderStats(trader)}
    </div>

    <div id="tab-info" class="tab-content" style="display:none;">
      ${buildTraderInfo(trader)}
    </div>
  `;
}

// ------------------------------------------------------------
// 🎛 MODAL BINDING
// ------------------------------------------------------------
function bindTraderModal(modal, trader) {
  if (!modal || !trader) return;

  const modalContent = getTraderModalContent();
  if (!modalContent) return;

  const grouped = groupItemsByCategory(trader.items || []);
  const inventoryItems = getInventoryState();

  modalContent.querySelectorAll(".collection-items-container").forEach((container) => {
    const categoryContent = container.closest(".category-content");
    if (!categoryContent) return;
    const category = categoryContent.dataset.cat;
    const items = grouped[category] || [];
    bindCollectionFilters(categoryContent, items, "trader", trader.id);
  });

  const sellContainer = getEl("sellItemsContainer");
  if (sellContainer) {
    bindCollectionFilters(sellContainer.parentElement, inventoryItems, "inventory", trader.id);
  }

  if (modal.dataset.boundRenderModal === "1") return;
  modal.dataset.boundRenderModal = "1";

  modal.addEventListener("click", async (event) => {
    const closeBtn = event.target.closest(".js-close-trader-modal");
    if (closeBtn) {
      modal.style.display = "none";
      return;
    }

    const tabBtn = event.target.closest(".tab-btn[data-main-tab]");
    if (tabBtn) {
      const tabName = tabBtn.dataset.mainTab;

      modal.querySelectorAll(".tab-btn[data-main-tab]").forEach((btn) => {
        btn.classList.toggle("active", btn === tabBtn);
      });

      modal.querySelectorAll(".tab-content").forEach((tab) => {
        const active = tab.id === `tab-${tabName}`;
        tab.classList.toggle("active", active);
        tab.style.display = active ? "block" : "none";
      });

      return;
    }

    const catBtn = event.target.closest(".category-tab[data-cat]");
    if (catBtn) {
      const cat = catBtn.dataset.cat;
      const buyTab = modal.querySelector("#tab-buy");

      buyTab?.querySelectorAll(".category-tab").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.cat === cat);
      });

      buyTab?.querySelectorAll(".category-content").forEach((content) => {
        const active = content.dataset.cat === cat;
        content.classList.toggle("active", active);
        content.style.display = active ? "block" : "none";
        if (!active) content.setAttribute("hidden", "hidden");
        else content.removeAttribute("hidden");
      });

      return;
    }

    const buyBtn = event.target.closest(".js-buy-item");
    if (buyBtn) {
      const qty = getQtyFromButton(buyBtn, 1);
      await window.buyItem?.(Number(buyBtn.dataset.traderId), Number(buyBtn.dataset.itemId), qty);
      return;
    }

    const addCartBtn = event.target.closest(".js-add-cart");
    if (addCartBtn) {
      const qty = getQtyFromButton(addCartBtn, 1);
      window.addToCart?.(Number(addCartBtn.dataset.traderId), Number(addCartBtn.dataset.itemId), qty);
      return;
    }

    const reserveBtn = event.target.closest(".js-reserve-item");
    if (reserveBtn) {
      const qty = getQtyFromButton(reserveBtn, 1);
      window.reserveItem?.(Number(reserveBtn.dataset.itemId), Number(reserveBtn.dataset.traderId), qty);
      return;
    }

    const reserveFromCartBtn = event.target.closest(".js-reserve-from-cart");
    if (reserveFromCartBtn) {
      window.reserveItem?.(
        Number(reserveFromCartBtn.dataset.itemId),
        Number(reserveFromCartBtn.dataset.traderId),
        1
      );
      window.removeFromCart?.(
        Number(reserveFromCartBtn.dataset.itemId),
        Number(reserveFromCartBtn.dataset.traderId)
      );
      return;
    }

    const removeCartBtn = event.target.closest(".js-remove-cart");
    if (removeCartBtn) {
      window.removeFromCart?.(
        Number(removeCartBtn.dataset.itemId),
        Number(removeCartBtn.dataset.traderId)
      );
      return;
    }

    const unreserveBtn = event.target.closest(".js-unreserve");
    if (unreserveBtn) {
      window.unreserveItem?.(
        Number(unreserveBtn.dataset.itemId),
        Number(unreserveBtn.dataset.traderId)
      );
      return;
    }

    const sellBtn = event.target.closest(".js-sell-item");
    if (sellBtn) {
      const qty = getQtyFromButton(sellBtn, 1);
      await window.sellItem?.(Number(sellBtn.dataset.itemId), qty);
      return;
    }

    const removeInventoryBtn = event.target.closest(".js-remove-inventory");
    if (removeInventoryBtn) {
      window.removeInventoryItem?.(Number(removeInventoryBtn.dataset.itemId));
      return;
    }

    const openDescBtn = event.target.closest(".js-open-desc");
    if (openDescBtn) {
      const itemId = Number(openDescBtn.dataset.itemId);
      const context = String(openDescBtn.dataset.context || "trader");
      const traderId = openDescBtn.dataset.traderId ? Number(openDescBtn.dataset.traderId) : trader.id;

      const item = window.getItemForDescription?.(itemId, context, traderId);
      if (item) {
        openItemDescriptionModal(item, context);
      } else {
        showToast("Описание предмета не найдено");
      }
    }
  });

  if (!modal.dataset.boundOverlayClose) {
    modal.dataset.boundOverlayClose = "1";
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        modal.style.display = "none";
      }
    });
  }
}

// ------------------------------------------------------------
// 🧑‍💼 TRADER MODAL OPEN
// ------------------------------------------------------------
export async function openTraderModal(traderId) {
  const trader = getTraderById(traderId);
  const modal = getEl("traderModal");
  const modalContent = getTraderModalContent();

  if (!trader || !modal || !modalContent) {
    showToast("Не удалось открыть торговца");
    return;
  }

  const grouped = groupItemsByCategory(trader.items || []);

  modalContent.innerHTML = `
    <div class="trader-modal-layout">
      ${buildTraderHeader(trader)}
      ${buildTraderTabs(grouped, trader)}
    </div>
  `;

  modal.dataset.traderId = String(trader.id);
  modal.style.display = "block";

  bindTraderModal(modal, trader);
}

// ------------------------------------------------------------
// 🏪 TRADER CARDS
// ------------------------------------------------------------
function buildTraderCard(trader) {
  const imageUrl = getTraderImageUrl(trader);
  const hasImage = Boolean(imageUrl);
  const repTitle = getTraderQuality(trader?.reputation);
  const repStars = getReputationStars(trader?.reputation);
  const traderEmoji = getTraderEmoji(trader?.type);
  const preview = specializationPreview(trader);

  return `
    <article
      class="trader-card trader-card-clickable"
      data-trader-card-id="${escapeHtml(String(trader.id))}"
      tabindex="0"
      role="button"
      aria-label="Открыть торговца ${escapeHtml(trader?.name || "торговец")}"
    >
      ${
        hasImage
          ? `<div class="trader-card-image-wrap">
              <img class="trader-card-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(
                trader?.name || "Торговец"
              )}">
            </div>`
          : `<div class="trader-card-image-wrap trader-card-image-fallback">${escapeHtml(traderEmoji)}</div>`
      }

      <div class="trader-info">
        <div class="trader-name">${escapeHtml(traderEmoji)} ${escapeHtml(trader?.name || "Безымянный торговец")}</div>
        <div class="trader-type">${escapeHtml(trader?.type || "—")}</div>

        <div class="trader-meta">
          <span class="meta-item">${getRegionEmoji()} ${escapeHtml(trader?.region || "—")}</span>
          <span class="meta-item">${getSettlementEmoji()} ${escapeHtml(trader?.settlement || "—")}</span>
          <span class="meta-item">⭐ ${escapeHtml(repStars)}</span>
        </div>

        <div class="trader-desc">
          ${escapeHtml(trader?.description || "Описание отсутствует")}
        </div>

        <div class="trader-meta trader-meta-footer">
          <span class="meta-item">🎯 ${escapeHtml(preview)}</span>
          <span class="meta-item">🏷️ ${escapeHtml(repTitle)}</span>
        </div>
      </div>
    </article>
  `;
}

export function renderTraders(traders) {
  const container = getTradersContainer();
  if (!container) return;

  container.classList.add("traders-grid");

  if (!traders?.length) {
    container.innerHTML = `
      <div class="trader-detail-section">
        <p>Торговцы не найдены.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = traders.map((trader) => buildTraderCard(trader)).join("");
}

// ------------------------------------------------------------
// 🛒 CART
// ------------------------------------------------------------
function renderReservedBlock(items) {
  if (!items?.length) {
    return `
      <div class="trader-detail-section">
        <h3>📌 Резерв</h3>
        <p>Резерв пуст.</p>
      </div>
    `;
  }

  return `
    <div class="trader-detail-section">
      <h3>📌 Резерв</h3>
      ${renderItemsInventoryList(items, "reserved", null)}
    </div>
  `;
}

export function renderCart(items) {
  const container = getCartContainer();
  if (!container) return;

  const reserved = getReservedState();

  container.innerHTML = `
    <div class="collection-wrapper">
      ${getCompactCollectionFiltersMarkup("cart")}
      <div class="collection-items-container">
        ${
          items?.length
            ? renderItemsInventoryList(items, "cart", null)
            : `<div class="trader-detail-section"><p>Корзина пуста.</p></div>`
        }
      </div>
    </div>

    <div style="margin-top:16px;">
      ${renderReservedBlock(reserved)}
    </div>
  `;

  const wrapper = container.querySelector(".collection-wrapper");
  const itemsContainer = container.querySelector(".collection-items-container");
  if (wrapper && itemsContainer) {
    bindCollectionFilters(wrapper, items || [], "cart", null);
  }
}

// ------------------------------------------------------------
// 🎒 INVENTORY
// ------------------------------------------------------------
export function renderInventory(items) {
  const container = getInventoryContainer();
  if (!container) return;

  container.innerHTML = `
    <div class="collection-wrapper">
      ${getCompactCollectionFiltersMarkup("inventory")}
      <div class="collection-items-container">
        ${
          items?.length
            ? renderItemsInventoryList(items, "inventory", null)
            : `<div class="trader-detail-section"><p>Инвентарь пуст.</p></div>`
        }
      </div>
    </div>
  `;

  const wrapper = container.querySelector(".collection-wrapper");
  const itemsContainer = container.querySelector(".collection-items-container");
  if (wrapper && itemsContainer) {
    bindCollectionFilters(wrapper, items || [], "inventory", null);
  }
}

// ------------------------------------------------------------
// 🌉 LEGACY BRIDGE
// ------------------------------------------------------------
window.renderModule = {
  renderTraders,
  renderCart,
  renderInventory,
  openTraderModal,
};
window.openTraderModal = openTraderModal;