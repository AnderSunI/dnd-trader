import { state } from "./state.js";
import { buyItem, sellItem, fetchPlayerInventory } from "./api.js";

export function showToast(msg) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.style.opacity = "1";
    setTimeout(() => toast.style.opacity = "0", 2000);
}

export function renderUserInfo(user) {
    const el = document.getElementById("userInfo");
    if (!user) el.innerHTML = "<span>Не авторизован</span>";
    else el.innerHTML = `<span>${user.email} | ${user.money_label}</span>`;
}

export function renderTraders() {
    const container = document.getElementById("tradersGrid");
    if (!container) return;
    if (!state.traders.length) { container.innerHTML = "<p>Загрузка...</p>"; return; }
    container.innerHTML = state.traders.map(t => `
        <div class="trader-card" data-id="${t.id}">
            <h3>${t.name}</h3>
            <p>${t.type} | ${t.region} | Репутация: ${t.reputation}</p>
            <p>${t.description?.slice(0, 100)}</p>
            <button class="primary open-trader" data-id="${t.id}">Открыть лавку</button>
        </div>
    `).join("");
    document.querySelectorAll(".open-trader").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = parseInt(btn.dataset.id);
            const trader = state.traders.find(t => t.id === id);
            if (trader) openTraderModal(trader);
        });
    });
}

export async function openTraderModal(trader) {
    const modal = document.getElementById("traderModal");
    const content = document.getElementById("traderContent");
    content.innerHTML = `<h2>${trader.name}</h2><p>${trader.description}</p><div id="traderItemsList"></div>`;
    const itemsDiv = document.getElementById("traderItemsList");
    itemsDiv.innerHTML = trader.items.map(item => `
        <div class="trader-item" data-item-id="${item.id}" data-price-gold="${item.buy_price_gold}" data-price-silver="${item.buy_price_silver}" data-price-copper="${item.buy_price_copper}">
            <strong>${item.name}</strong> - ${item.buy_price_label}
            <button class="buy-btn">Купить</button>
            ${state.inventory.find(i => i.item_id === item.id) ? `<button class="sell-btn">Продать</button>` : ""}
        </div>
    `).join("");
    itemsDiv.querySelectorAll(".buy-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const div = btn.closest(".trader-item");
            const itemId = parseInt(div.dataset.itemId);
            try {
                await buyItem(itemId, trader.id, 1);
                await refreshInventory();
                showToast("Куплено!");
            } catch(err) { showToast("Ошибка: " + err.message); }
        });
    });
    itemsDiv.querySelectorAll(".sell-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const div = btn.closest(".trader-item");
            const itemId = parseInt(div.dataset.itemId);
            try {
                await sellItem(itemId, trader.id, 1);
                await refreshInventory();
                showToast("Продано!");
            } catch(err) { showToast("Ошибка: " + err.message); }
        });
    });
    modal.style.display = "block";
    document.querySelectorAll("#traderModal .close").forEach(c => c.onclick = () => modal.style.display = "none");
}

export async function openInventoryModal() {
    await refreshInventory();
    const modal = document.getElementById("inventoryModal");
    const content = document.getElementById("inventoryContent");
    if (!state.inventory.length) content.innerHTML = "<p>Инвентарь пуст</p>";
    else {
        content.innerHTML = state.inventory.map(it => `
            <div>${it.name} x${it.quantity} - ${it.base_price_label}</div>
        `).join("");
    }
    modal.style.display = "block";
    document.querySelectorAll("#inventoryModal .close").forEach(c => c.onclick = () => modal.style.display = "none");
}

async function refreshInventory() {
    const data = await fetchPlayerInventory();
    state.inventory = data.items || [];
    renderUserInfo(state.user);
}