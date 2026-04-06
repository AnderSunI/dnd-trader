// ============================================================
// render.js
// Отрисовка UI (main + trader + cart + inventory)
// ============================================================

// ------------------------------------------------------------
// 🧙 РЕНДЕР ТОРГОВЦЕВ (ГЛАВНЫЙ ЭКРАН)
// ------------------------------------------------------------
export function renderTraders(traders) {
  const container = document.getElementById("traders-container");
  if (!container) return;

  container.innerHTML = "";

  traders.forEach((trader) => {
    const card = document.createElement("div");
    card.className = "trader-card";

    card.innerHTML = `
      <img src="${trader.image_url || "/images/default.png"}" class="trader-image"/>
      <div class="trader-info">
        <h3>${trader.name}</h3>
        <p>${trader.description || ""}</p>
        <p>📍 ${trader.region || ""}</p>
        <p>⭐ Репутация: ${trader.reputation || 0}</p>
        <button class="btn btn-primary open-trader">Открыть</button>
      </div>
    `;

    card.querySelector(".open-trader").onclick = () => {
      openTraderModal(trader.id);
    };

    container.appendChild(card);
  });
}

// ------------------------------------------------------------
// 🏪 МОДАЛКА ТОРГОВЦА
// ------------------------------------------------------------
export async function openTraderModal(traderId) {
  const modal = document.getElementById("traderModal");
  const content = document.getElementById("modalContent");

  modal.style.display = "block";
  content.innerHTML = "Загрузка...";

  try {
    const res = await fetch(`/traders/${traderId}`);
    const trader = await res.json();

    content.innerHTML = `
      <h2>${trader.name}</h2>
      <p>${trader.description || ""}</p>

      <div class="trader-items">
        ${renderItems(trader.items || [], traderId)}
      </div>
    `;
  } catch (e) {
    content.innerHTML = "Ошибка загрузки";
  }
}

// ------------------------------------------------------------
// 📦 РЕНДЕР ПРЕДМЕТОВ
// ------------------------------------------------------------
export function renderItems(items, traderId) {
  if (!items.length) return "<p>Нет товаров</p>";

  return items
    .map(
      (item) => `
    <div class="item-row">
      <div class="item-name">${item.name}</div>
      <div class="item-price">${item.price_label || item.price_gold + "з"}</div>

      <div class="item-actions">
        <button onclick="window.buyItem(${traderId}, ${item.id})" class="btn btn-success">Купить</button>
        <button onclick="window.addToCart(${traderId}, ${item.id})" class="btn btn-primary">В корзину</button>
      </div>
    </div>
  `
    )
    .join("");
}

// ------------------------------------------------------------
// 🛒 КОРЗИНА
// ------------------------------------------------------------
export function renderCart(cart) {
  const container = document.getElementById("cart-container");
  if (!container) return;

  container.innerHTML = "";

  if (!cart.length) {
    container.innerHTML = "<p>Корзина пуста</p>";
    return;
  }

  cart.forEach((item) => {
    const row = document.createElement("div");
    row.className = "cart-row";

    row.innerHTML = `
      <div>${item.name}</div>
      <div>${item.price_label}</div>
      <button onclick="window.removeFromCart(${item.id})" class="btn btn-danger">Удалить</button>
    `;

    container.appendChild(row);
  });
}

// ------------------------------------------------------------
// 🎒 ИНВЕНТАРЬ
// ------------------------------------------------------------
export function renderInventory(items) {
  const container = document.getElementById("inventory-container");
  if (!container) return;

  container.innerHTML = "";

  if (!items.length) {
    container.innerHTML = "<p>Инвентарь пуст</p>";
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "inventory-row";

    row.innerHTML = `
      <div>${item.name}</div>
      <div>${item.quantity}</div>
      <button onclick="window.sellItem(${item.id})" class="btn btn-warning">Продать</button>
    `;

    container.appendChild(row);
  });
}

// ------------------------------------------------------------
// 👤 КАБИНЕТ (БАЗОВО)
// ------------------------------------------------------------
export function renderCabinet(profile) {
  const lss = document.getElementById("cabinet-lss");
  const quests = document.getElementById("cabinet-quests");
  const notes = document.getElementById("cabinet-playernotes");

  if (lss) {
    lss.innerHTML = `
      <h3>История</h3>
      <pre>${JSON.stringify(profile.history || [], null, 2)}</pre>
    `;
  }

  if (quests) {
    quests.innerHTML = `
      <h3>Задания</h3>
      <pre>${JSON.stringify(profile.quests || [], null, 2)}</pre>
    `;
  }

  if (notes) {
    notes.innerHTML = `
      <textarea id="playerNotesInput">${profile.notes || ""}</textarea>
    `;
  }
}

// ------------------------------------------------------------
// ❌ ЗАКРЫТИЕ МОДАЛОК
// ------------------------------------------------------------
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("close")) {
    e.target.closest(".modal").style.display = "none";
  }
});