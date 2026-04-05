// ============================================================
// frontend/js/render.js
// Весь рендер фронта.
// Никаких запросов к API здесь нет — только отображение.
// ============================================================

import {
  state,
  setSelectedTrader,
  getSelectedTrader,
  openCabinet,
  closeCabinet,
  setCabinetTab,
  setTraderTab,
  getCartCount,
} from "./state.js";

// ============================================================
// 🧰 ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================

// Безопасный HTML
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Безопасное число
function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Формат цены
export function formatPriceParts(gold = 0, silver = 0, copper = 0) {
  const g = toNumber(gold);
  const s = toNumber(silver);
  const c = toNumber(copper);

  const parts = [];
  if (g) parts.push(`${g}з`);
  if (s) parts.push(`${s}с`);
  if (c) parts.push(`${c}м`);

  return parts.length ? parts.join(" ") : "0з";
}

// Цена покупки
function getBuyPriceLabel(item) {
  if (item?.buy_price_label) return item.buy_price_label;

  return formatPriceParts(
    item?.buy_price_gold ?? item?.price_gold ?? 0,
    item?.buy_price_silver ?? item?.price_silver ?? 0,
    item?.buy_price_copper ?? item?.price_copper ?? 0
  );
}

// Цена продажи
function getSellPriceLabel(item) {
  if (item?.sell_price_label) return item.sell_price_label;

  return formatPriceParts(
    item?.sell_price_gold ?? 0,
    item?.sell_price_silver ?? 0,
    item?.sell_price_copper ?? 0
  );
}

// Редкость в css-класс
function getRarityClass(rarity) {
  const value = String(rarity || "common").trim().toLowerCase();

  if (value === "uncommon") return "rarity-uncommon";
  if (value === "rare") return "rarity-rare";
  if (value === "very rare") return "rarity-very-rare";
  if (value === "legendary") return "rarity-legendary";
  if (value === "artifact") return "rarity-artifact";
  return "rarity-common";
}

// Универсальный поиск контейнера по нескольким id
function getFirstElementByIds(ids) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
}

// Показать элемент
function show(el, display = "block") {
  if (el) el.style.display = display;
}

// Скрыть элемент
function hide(el) {
  if (el) el.style.display = "none";
}

// ============================================================
// 👤 USER / HEADER
// ============================================================

export function renderUserInfo(user) {
  const emailEl = getFirstElementByIds(["user-email", "userEmail"]);
  const moneyEl = getFirstElementByIds(["user-money", "playerGold", "goldDisplay"]);
  const goldInput = getFirstElementByIds(["playerGoldInput"]);

  if (emailEl) {
    emailEl.textContent = user?.email || "";
  }

  if (moneyEl) {
    if (user) {
      moneyEl.textContent = user.money_label || formatPriceParts(
        user.money_gold || 0,
        user.money_silver || 0,
        user.money_copper || 0
      );
    } else {
      moneyEl.textContent = "0з";
    }
  }

  if (goldInput) {
    goldInput.value = String(toNumber(user?.money_gold, 0));
  }
}

export function renderGuestState() {
  const guestWarning = getFirstElementByIds(["guestWarning", "guest-warning"]);
  const authContainer = getFirstElementByIds(["authContainer"]);
  const logoutBtn = getFirstElementByIds(["logoutBtn"]);
  const userInfo = getFirstElementByIds(["user-info", "userInfo"]);

  show(guestWarning, "flex");
  hide(authContainer);
  hide(logoutBtn);
  hide(userInfo);

  renderUserInfo(null);
}

export function renderAuthenticatedState(user) {
  const guestWarning = getFirstElementByIds(["guestWarning", "guest-warning"]);
  const authContainer = getFirstElementByIds(["authContainer"]);
  const logoutBtn = getFirstElementByIds(["logoutBtn"]);
  const userInfo = getFirstElementByIds(["user-info", "userInfo"]);

  hide(guestWarning);
  hide(authContainer);
  show(logoutBtn, "inline-block");
  show(userInfo, "flex");

  renderUserInfo(user);
}

// ============================================================
// 🧙 TRADERS LIST
// ============================================================

function buildTraderImage(trader) {
  const imageUrl = trader.image_url || trader.image || "";

  if (!imageUrl) {
    return `<div class="trader-image">🏪</div>`;
  }

  return `
    <div class="trader-image"
         style="background-image:url('${escapeHtml(imageUrl)}'); background-size:cover; background-position:center;">
    </div>
  `;
}

function buildTraderMeta(trader) {
  const parts = [];

  if (trader.type) {
    parts.push(`<span class="meta-item">🧾 ${escapeHtml(trader.type)}</span>`);
  }

  if (trader.region) {
    parts.push(`<span class="meta-item">🌍 ${escapeHtml(trader.region)}</span>`);
  }

  if (trader.settlement) {
    parts.push(`<span class="meta-item">🏘️ ${escapeHtml(trader.settlement)}</span>`);
  }

  if (trader.reputation != null) {
    parts.push(`<span class="meta-item">⭐ ${escapeHtml(trader.reputation)}</span>`);
  }

  if (trader.level_min != null && trader.level_max != null) {
    parts.push(
      `<span class="meta-item">🎚️ ${escapeHtml(trader.level_min)}–${escapeHtml(trader.level_max)}</span>`
    );
  }

  return parts.join("");
}

function buildTraderPreviewItems(trader) {
  const items = Array.isArray(trader.items) ? trader.items : [];
  const preview = items.slice(0, 5);

  if (!preview.length) {
    return `<div class="more-items">Нет товаров</div>`;
  }

  return `
    <div class="items-list">
      <div class="items-title">📦 Товары:</div>
      <ul class="items">
        ${preview.map((item) => `<li>${escapeHtml(item.name)}</li>`).join("")}
      </ul>
      ${items.length > 5 ? `<div class="more-items">и ещё ${items.length - 5}...</div>` : ""}
    </div>
  `;
}

export function renderTraders(traders) {
  const container = getFirstElementByIds([
    "traders-container",
    "tradersGrid",
    "traders-list",
    "tradersList",
  ]);

  if (!container) return;

  if (!Array.isArray(traders) || traders.length === 0) {
    container.innerHTML = `<p style="text-align:center;">Торговцы не найдены.</p>`;
    return;
  }

  container.innerHTML = traders
    .map((trader) => {
      return `
        <div class="trader-card" data-trader-id="${trader.id}">
          ${buildTraderImage(trader)}
          <div class="trader-info">
            <div class="trader-name">${escapeHtml(trader.name || "Безымянный торговец")}</div>
            <div class="trader-type">${escapeHtml(trader.specialization_label || trader.specialization || trader.type || "")}</div>
            <div class="trader-desc">${escapeHtml(trader.description || "")}</div>
            <div class="trader-meta">
              ${buildTraderMeta(trader)}
            </div>
            ${buildTraderPreviewItems(trader)}
            <div class="trader-actions">
              <button class="primary open-trader-btn" data-trader-id="${trader.id}">
                Открыть
              </button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll(".open-trader-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const traderId = Number(button.dataset.traderId);
      openTrader(traderId);
    });
  });

  container.querySelectorAll(".trader-card").forEach((card) => {
    card.addEventListener("click", () => {
      const traderId = Number(card.dataset.traderId);
      openTrader(traderId);
    });
  });
}

// ============================================================
// 🏪 TRADER MODAL
// ============================================================

function renderTraderTabButtons() {
  const active = state.ui.activeTraderTab || "inventory";

  const tabs = [
    { key: "inventory", label: "Товары" },
    { key: "info", label: "Инфо" },
    { key: "lore", label: "Лор" },
  ];

  return `
    <div class="trader-tabs">
      ${tabs.map((tab) => `
        <button class="trader-tab-btn ${active === tab.key ? "active" : ""}" data-trader-tab="${tab.key}">
          ${tab.label}
        </button>
      `).join("")}
    </div>
  `;
}

function renderTraderInventoryTab(trader) {
  const items = Array.isArray(trader.items) ? trader.items : [];

  if (!items.length) {
    return `<p>У торговца нет товаров.</p>`;
  }

  return `
    <div class="trader-items-grid">
      ${items.map((item) => `
        <div class="trader-item-card">
          <div class="item-top">
            <span class="rarity-badge ${getRarityClass(item.rarity)}">
              ${escapeHtml(item.rarity || "common")}
            </span>
          </div>

          <div class="item-name">${escapeHtml(item.name)}</div>

          ${item.description ? `<div class="item-desc">${escapeHtml(item.description)}</div>` : ""}

          <div class="item-meta">
            <div>📦 ${escapeHtml(item.category || "misc")}</div>
            <div>⭐ ${escapeHtml(item.quality || "стандартное")}</div>
            <div>💰 ${escapeHtml(getBuyPriceLabel(item))}</div>
            <div>📉 Продажа: ${escapeHtml(getSellPriceLabel(item))}</div>
            <div>🧮 Осталось: ${escapeHtml(item.stock ?? 0)}</div>
          </div>

          <div class="item-actions">
            <button class="success trader-buy-btn"
                    data-item-id="${item.id}"
                    data-trader-id="${trader.id}">
              Купить
            </button>
            <button class="secondary trader-add-cart-btn"
                    data-item-id="${item.id}"
                    data-trader-id="${trader.id}">
              В корзину
            </button>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderTraderInfoTab(trader) {
  return `
    <div class="trader-info-tab">
      <p><strong>Имя:</strong> ${escapeHtml(trader.name || "—")}</p>
      <p><strong>Тип:</strong> ${escapeHtml(trader.type || "—")}</p>
      <p><strong>Специализация:</strong> ${escapeHtml(trader.specialization_label || trader.specialization || "—")}</p>
      <p><strong>Регион:</strong> ${escapeHtml(trader.region || "—")}</p>
      <p><strong>Поселение:</strong> ${escapeHtml(trader.settlement || "—")}</p>
      <p><strong>Репутация:</strong> ${escapeHtml(trader.reputation ?? 0)}</p>
      <p><strong>Уровень:</strong> ${escapeHtml(trader.level_min ?? 1)}–${escapeHtml(trader.level_max ?? 10)}</p>
      <p><strong>Описание:</strong> ${escapeHtml(trader.description || "—")}</p>
    </div>
  `;
}

function renderTraderLoreTab(trader) {
  const race = trader.race || "—";
  const className = trader.class_name || trader.class || "—";
  const personality = trader.personality || "—";
  const notes = trader.notes || trader.lore || "";

  return `
    <div class="trader-lore-tab">
      <p><strong>Раса:</strong> ${escapeHtml(race)}</p>
      <p><strong>Класс:</strong> ${escapeHtml(className)}</p>
      <p><strong>Характер:</strong> ${escapeHtml(personality)}</p>
      <p><strong>Лор:</strong> ${escapeHtml(notes || "—")}</p>
    </div>
  `;
}

function renderTraderTabContent(trader) {
  const active = state.ui.activeTraderTab || "inventory";

  if (active === "info") {
    return renderTraderInfoTab(trader);
  }

  if (active === "lore") {
    return renderTraderLoreTab(trader);
  }

  return renderTraderInventoryTab(trader);
}

export function openTrader(traderId) {
  setSelectedTrader(traderId);
  setTraderTab("inventory");

  const trader = getSelectedTrader();
  if (!trader) return;

  const modal = getFirstElementByIds(["traderModal", "merchantModal"]);
  const content = getFirstElementByIds(["modalContent", "traderModalContent", "merchantModalContent"]);

  if (!modal || !content) return;

  content.innerHTML = `
    <div class="trader-modal-header">
      <h2>${escapeHtml(trader.name || "Торговец")}</h2>
      ${trader.image_url ? `
        <img src="${escapeHtml(trader.image_url)}"
             alt="${escapeHtml(trader.name || "Торговец")}"
             class="trader-modal-image">
      ` : ""}
    </div>

    ${renderTraderTabButtons()}
    <div id="trader-tab-content">
      ${renderTraderTabContent(trader)}
    </div>
  `;

  bindTraderModalEvents();
  show(modal, "block");
}

export function rerenderOpenTraderModal() {
  const trader = getSelectedTrader();
  if (!trader) return;

  const content = getFirstElementByIds(["modalContent", "traderModalContent", "merchantModalContent"]);
  if (!content) return;

  const tabContent = content.querySelector("#trader-tab-content");
  if (!tabContent) return;

  tabContent.innerHTML = renderTraderTabContent(trader);
  bindTraderModalEvents();
}

function bindTraderModalEvents() {
  document.querySelectorAll(".trader-tab-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const tabName = button.dataset.traderTab;
      setTraderTab(tabName);
      rerenderOpenTraderModal();
    });
  });

  document.querySelectorAll(".trader-buy-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = Number(button.dataset.itemId);
      const traderId = Number(button.dataset.traderId);

      if (window.buyItemAction) {
        window.buyItemAction(itemId, traderId, 1);
      }
    });
  });

  document.querySelectorAll(".trader-add-cart-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = Number(button.dataset.itemId);
      const traderId = Number(button.dataset.traderId);

      if (window.addTraderItemToCartAction) {
        window.addTraderItemToCartAction(itemId, traderId);
      }
    });
  });
}

// ============================================================
// 🎒 INVENTORY
// ============================================================

export function renderInventory(items) {
  const container = getFirstElementByIds([
    "inventory-container",
    "inventoryList",
    "inventory-list",
  ]);

  const inventoryCount = getFirstElementByIds([
    "inventoryCount",
    "inventory-count",
  ]);

  const totalCount = Array.isArray(items)
    ? items.reduce((sum, item) => sum + toNumber(item.quantity, 0), 0)
    : 0;

  if (inventoryCount) {
    inventoryCount.textContent = String(totalCount);
  }

  if (!container) return;

  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = `<p>Инвентарь пуст.</p>`;
    return;
  }

  container.innerHTML = items
    .map((item) => `
      <div class="inventory-item">
        <div class="inventory-item-info">
          <strong>${escapeHtml(item.name)}</strong> x ${escapeHtml(item.quantity || 0)}
          <div>📦 ${escapeHtml(item.category || "misc")}</div>
          <div>⭐ ${escapeHtml(item.rarity || "common")}</div>
          <div>💰 Продажа: ${escapeHtml(getSellPriceLabel(item))}</div>
        </div>
        <div class="inventory-item-actions">
          <button class="danger inventory-sell-btn"
                  data-item-id="${item.id}"
                  data-trader-id="${item.trader_id || state.selectedTraderId || ""}">
            Продать
          </button>
        </div>
      </div>
    `)
    .join("");

  container.querySelectorAll(".inventory-sell-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = Number(button.dataset.itemId);
      const traderId = Number(button.dataset.traderId);

      if (window.sellItemAction) {
        window.sellItemAction(itemId, traderId, 1);
      }
    });
  });
}

export function openInventoryModal() {
  const modal = getFirstElementByIds(["inventoryModal"]);
  if (!modal) return;
  show(modal, "block");
}

// ============================================================
// 🛒 CART
// ============================================================

export function renderCart(cart) {
  const container = getFirstElementByIds([
    "cart-container",
    "cartItems",
    "cart-items",
  ]);

  const badge = getFirstElementByIds([
    "cartCount",
    "cart-count",
  ]);

  const totalLabel = getFirstElementByIds([
    "cart-total",
    "cartTotal",
  ]);

  if (badge) {
    badge.textContent = String(getCartCount());
  }

  if (!container) return;

  if (!Array.isArray(cart) || cart.length === 0) {
    container.innerHTML = `<p>Корзина пуста.</p>`;
    if (totalLabel) {
      totalLabel.textContent = "Итого: 0з";
    }
    return;
  }

  let totalGold = 0;
  let totalSilver = 0;
  let totalCopper = 0;

  cart.forEach((item) => {
    const qty = toNumber(item.quantity, 1);
    totalGold += toNumber(item.buy_price_gold ?? item.price_gold ?? 0) * qty;
    totalSilver += toNumber(item.buy_price_silver ?? item.price_silver ?? 0) * qty;
    totalCopper += toNumber(item.buy_price_copper ?? item.price_copper ?? 0) * qty;
  });

  if (totalLabel) {
    totalLabel.textContent = `Итого: ${formatPriceParts(totalGold, totalSilver, totalCopper)}`;
  }

  container.innerHTML = cart
    .map((item) => `
      <div class="cart-item">
        <div class="cart-item-info">
          <strong>${escapeHtml(item.name)}</strong> x ${escapeHtml(item.quantity || 1)}
          <div>💰 ${escapeHtml(getBuyPriceLabel(item))}</div>
        </div>
        <div class="cart-item-actions">
          <button class="success cart-plus-btn" data-item-id="${item.id}">+</button>
          <button class="warning cart-minus-btn" data-item-id="${item.id}">-</button>
          <button class="danger cart-remove-btn" data-item-id="${item.id}">Удалить</button>
        </div>
      </div>
    `)
    .join("");

  container.querySelectorAll(".cart-plus-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = Number(button.dataset.itemId);
      if (window.updateCartQuantityAction) {
        window.updateCartQuantityAction(itemId, +1);
      }
    });
  });

  container.querySelectorAll(".cart-minus-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = Number(button.dataset.itemId);
      if (window.updateCartQuantityAction) {
        window.updateCartQuantityAction(itemId, -1);
      }
    });
  });

  container.querySelectorAll(".cart-remove-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = Number(button.dataset.itemId);
      if (window.removeCartItemAction) {
        window.removeCartItemAction(itemId);
      }
    });
  });
}

// ============================================================
// 👤 CABINET
// ============================================================

function cabinetSectionIds() {
  return [
    "cabinet-history",
    "cabinet-quests",
    "cabinet-map",
    "cabinet-inventory",
    "cabinet-files",
    "cabinet-playernotes",
    "cabinet-gmnotes",
    "cabinet-lss",
  ];
}

function cabinetTabToSectionId(tabName) {
  const map = {
    history: "cabinet-history",
    quests: "cabinet-quests",
    map: "cabinet-map",
    inventory: "cabinet-inventory",
    files: "cabinet-files",
    playernotes: "cabinet-playernotes",
    gmnotes: "cabinet-gmnotes",
    lss: "cabinet-lss",
  };

  return map[tabName] || "cabinet-inventory";
}

export function openCabinetModal() {
  const modal = getFirstElementByIds(["cabinetModal"]);
  if (!modal) return;

  openCabinet();
  show(modal, "block");
  renderCabinet();
}

export function closeCabinetModal() {
  const modal = getFirstElementByIds(["cabinetModal"]);
  if (!modal) return;

  closeCabinet();
  hide(modal);
}

export function switchCabinetTab(tabName) {
  setCabinetTab(tabName);
  renderCabinet();
}

export function renderCabinet() {
  const modal = getFirstElementByIds(["cabinetModal"]);
  if (!modal) return;

  const activeTab = state.ui.activeCabinetTab || "inventory";
  const activeSectionId = cabinetTabToSectionId(activeTab);

  cabinetSectionIds().forEach((id) => {
    const section = document.getElementById(id);
    if (!section) return;

    if (id === activeSectionId) {
      show(section, "block");
    } else {
      hide(section);
    }
  });

  document.querySelectorAll("[data-cabinet-tab]").forEach((button) => {
    const isActive = button.dataset.cabinetTab === activeTab;
    button.classList.toggle("active", isActive);
  });
}

// ============================================================
// 📖 LSS / HISTORY / QUESTS / MAP / NOTES
// ============================================================

export function renderLssSection() {
  const container = getFirstElementByIds(["cabinet-lss"]);
  if (!container) return;

  const lss = state.lss || {};
  const stats = lss.stats || {};

  container.innerHTML = `
    <div class="cabinet-section-inner">
      <h3>Long Story Short</h3>

      <div class="lss-stats-grid">
        <div>Сила: ${escapeHtml(stats.strength ?? "—")}</div>
        <div>Ловкость: ${escapeHtml(stats.dexterity ?? "—")}</div>
        <div>Телосложение: ${escapeHtml(stats.constitution ?? "—")}</div>
        <div>Интеллект: ${escapeHtml(stats.intelligence ?? "—")}</div>
        <div>Мудрость: ${escapeHtml(stats.wisdom ?? "—")}</div>
        <div>Харизма: ${escapeHtml(stats.charisma ?? "—")}</div>
      </div>

      <div class="lss-notes-block">
        <h4>Заметки персонажа</h4>
        <div>${escapeHtml(lss.notes || "Пока пусто")}</div>
      </div>
    </div>
  `;
}

export function renderHistorySection() {
  const container = getFirstElementByIds(["cabinet-history"]);
  if (!container) return;

  const history = Array.isArray(state.lss.history) ? state.lss.history : [];

  if (!history.length) {
    container.innerHTML = `<p>История пока пуста.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="cabinet-section-inner">
      <h3>История</h3>
      ${history.map((entry) => `
        <div class="history-entry">
          ${escapeHtml(entry.title || entry.text || entry)}
        </div>
      `).join("")}
    </div>
  `;
}

export function renderQuestsSection() {
  const container = getFirstElementByIds(["cabinet-quests"]);
  if (!container) return;

  const quests = Array.isArray(state.lss.quests) ? state.lss.quests : [];

  if (!quests.length) {
    container.innerHTML = `<p>Квестов пока нет.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="cabinet-section-inner">
      <h3>Квесты</h3>
      ${quests.map((quest) => `
        <div class="quest-entry">
          <div><strong>${escapeHtml(quest.name || "Без названия")}</strong></div>
          <div>${escapeHtml(quest.description || "")}</div>
          <div>Статус: ${escapeHtml(quest.status || (quest.completed ? "выполнен" : "активен"))}</div>
        </div>
      `).join("")}
    </div>
  `;
}

export function renderMapSection() {
  const container = getFirstElementByIds(["cabinet-map"]);
  if (!container) return;

  const map = state.map || {};

  container.innerHTML = `
    <div class="cabinet-section-inner">
      <h3>Карта</h3>
      <div>Текущий слой: ${escapeHtml(map.activeLayer || "world")}</div>
      <div>Масштаб: ${escapeHtml(map.zoom || 1)}</div>
      <div class="map-placeholder">Здесь будет карта</div>
    </div>
  `;
}

export function renderFilesSection() {
  const container = getFirstElementByIds(["cabinet-files"]);
  if (!container) return;

  container.innerHTML = `
    <div class="cabinet-section-inner">
      <h3>Файлы</h3>
      <p>Здесь будут файлы игрока.</p>
    </div>
  `;
}

export function renderPlayerNotesSection() {
  const container = getFirstElementByIds(["cabinet-playernotes"]);
  if (!container) return;

  container.innerHTML = `
    <div class="cabinet-section-inner">
      <h3>Заметки игрока</h3>
      <textarea id="playerNotesTextarea" rows="8" style="width:100%;">${escapeHtml(state.lss.notes || "")}</textarea>
    </div>
  `;
}

export function renderGmNotesSection() {
  const container = getFirstElementByIds(["cabinet-gmnotes"]);
  if (!container) return;

  container.innerHTML = `
    <div class="cabinet-section-inner">
      <h3>Заметки ГМа</h3>
      <p>Секция доступна только ГМу.</p>
    </div>
  `;
}

// Полный рендер кабинета
export function renderCabinetContent() {
  renderLssSection();
  renderHistorySection();
  renderQuestsSection();
  renderMapSection();
  renderFilesSection();
  renderPlayerNotesSection();
  renderGmNotesSection();
  renderInventory(state.inventory);
  renderCabinet();
}

// ============================================================
// 🔘 ОБЩИЕ UI-СОБЫТИЯ
// ============================================================

export function bindRenderUiEvents() {
  const cabinetBtn = getFirstElementByIds(["cabinetBtn"]);
  if (cabinetBtn) {
    cabinetBtn.addEventListener("click", () => {
      openCabinetModal();
    });
  }

  document.querySelectorAll("[data-cabinet-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      switchCabinetTab(button.dataset.cabinetTab);
    });
  });

  document.querySelectorAll(".close").forEach((closeBtn) => {
    closeBtn.addEventListener("click", () => {
      const modal = closeBtn.closest(".modal");
      if (modal) {
        hide(modal);
      }
    });
  });

  document.querySelectorAll(".close-btn").forEach((closeBtn) => {
    closeBtn.addEventListener("click", () => {
      const modal = closeBtn.closest(".modal");
      if (modal) {
        hide(modal);
      }
    });
  });

  window.addEventListener("click", (event) => {
    document.querySelectorAll(".modal").forEach((modal) => {
      if (event.target === modal) {
        hide(modal);
      }
    });
  });
}