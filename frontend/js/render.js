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
        <article class="trader-card trader-card-stable">
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
                      ${previewItems
                        .map((item) => `<li>${escapeHtml(item.name || "Без названия")}</li>`)
                        .join("")}
                    </ul>
                    ${moreCount > 0 ? `<div class="more-items">и ещё ${escapeHtml(String(moreCount))}...</div>` : ""}
                  `
                  : `<div class="more-items">Нет товаров</div>`
              }
            </div>

            <div class="trader-card-actions">
              <button
                class="btn btn-primary trader-open-btn"
                type="button"
                onclick="window.openTraderModal(${traderId})"
              >
                Открыть торговца
              </button>
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

    content.innerHTML = `
      <div class="trader-modal-header">
        <div class="trader-modal-image-wrap">
          <img
            src="${escapeHtml(imageUrl)}"
            alt="${escapeHtml(trader.name || "Торговец")}"
            class="trader-modal-image"
          />
        </div>

        <div class="trader-modal-main-info">
          <h2>${escapeHtml(safe(trader.name, "Без имени"))}</h2>

          <div class="trader-modal-meta">
            <p><strong>Тип:</strong> ${escapeHtml(safe(trader.type, "—"))}</p>
            <p><strong>Регион:</strong> ${escapeHtml(safe(trader.region, "—"))}${trader.settlement ? ` | ${escapeHtml(trader.settlement)}` : ""}</p>
            <p><strong>Уровни:</strong> ${escapeHtml(`${safe(trader.level_min, "—")}–${safe(trader.level_max, "—")}`)}</p>
            <p><strong>Репутация:</strong> ${escapeHtml(String(safe(trader.reputation, 0)))}</p>
          </div>

          <p class="trader-modal-description">
            ${escapeHtml(safe(trader.description, ""))}
          </p>
        </div>
      </div>

      <div class="trader-items-section">
        <h3>Товары</h3>
        ${renderItems(trader.items || [], traderId)}
      </div>
    `;
  } catch (error) {
    console.error(error);
    content.innerHTML = `<div class="error-state">Ошибка загрузки торговца.</div>`;
  }
}

export function renderItems(items, traderId) {
  if (!Array.isArray(items) || !items.length) {
    return `<p>Нет товаров</p>`;
  }

  return `
    <div class="trader-items-table-wrap">
      <table class="trader-items-table">
        <thead>
          <tr>
            <th>Название</th>
            <th>Цена</th>
            <th>Редкость</th>
            <th>Качество</th>
            <th>Осталось</th>
            <th>Характеристики</th>
            <th>Действие</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map((item) => {
              const itemId = Number(item.id);
              const stock = Number(item.stock ?? item.quantity ?? 0);

              return `
                <tr>
                  <td>${escapeHtml(item.name || "Без названия")}</td>
                  <td>${escapeHtml(formatPrice(item))}</td>
                  <td>${escapeHtml(item.rarity || "common")}</td>
                  <td>${escapeHtml(item.quality || "стандартное")}</td>
                  <td>${escapeHtml(String(stock))}</td>
                  <td>${escapeHtml(itemCharacteristics(item))}</td>
                  <td>
                    <div class="item-actions">
                      <button class="btn btn-success" onclick="window.buyItem(${traderId}, ${itemId})" type="button">
                        Купить
                      </button>
                      <button class="btn btn-primary" onclick="window.addToCart(${traderId}, ${itemId})" type="button">
                        В корзину
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function renderCart(cart) {
  const container = document.getElementById("cart-container");
  if (!container) return;

  container.innerHTML = "";

  if (!Array.isArray(cart) || !cart.length) {
    container.innerHTML = "<p>Корзина пуста</p>";
    return;
  }

  cart.forEach((item) => {
    const row = document.createElement("div");
    row.className = "cart-item";

    const id = Number(item.item_id || item.id);

    row.innerHTML = `
      <div class="cart-item-info">
        <strong>${escapeHtml(safe(item.name, "Без названия"))}</strong>
        <div class="cart-item-price">${escapeHtml(safe(item.price_label, formatPrice(item)))}</div>
      </div>
      <div class="cart-item-controls">
        <button class="remove-btn" onclick="window.removeFromCart(${id})" type="button">Удалить</button>
      </div>
    `;

    container.appendChild(row);
  });
}

export function renderInventory(items) {
  const container = document.getElementById("inventory-container");
  const cabinetInventory = document.getElementById("cabinet-inventory");

  if (container) container.innerHTML = "";

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
    list.forEach((item) => {
      const row = document.createElement("div");
      row.className = "inventory-item";

      row.innerHTML = `
        <div class="inventory-item-info">
          <strong>${escapeHtml(safe(item.name, "Без названия"))}</strong>
          <div>Кол-во: ${escapeHtml(String(safe(item.quantity, 0)))}</div>
          <div>Продажа: ${escapeHtml(formatSellPrice(item))}</div>
        </div>
        <div class="inventory-item-controls">
          <button class="btn btn-warning" onclick="window.sellItem(${Number(item.id)})" type="button">
            Продать
          </button>
        </div>
      `;

      container.appendChild(row);
    });
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