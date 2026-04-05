import { state, setCart, setReserved } from './state.js';
import { updateCharacter } from './api.js';
import { showToast, updateCartWidget, addToInventory } from './render.js';

export function addToCart(item, traderId, quantity = 1) {
    const existing = state.cart.find(i => i.traderId === traderId && i.itemId === item.id);
    if (existing) {
        existing.quantity += quantity;
    } else {
        state.cart.push({
            traderId, itemId: item.id, name: item.name,
            price_gold: item.buy_price_gold || item.price_gold,
            price_silver: item.buy_price_silver || item.price_silver,
            price_copper: item.buy_price_copper || item.price_copper,
            quantity, originalStock: item.stock,
            price_gold_orig: item.price_gold, price_silver_orig: item.price_silver, price_copper_orig: item.price_copper,
            weight: item.weight, rarity: item.rarity, is_magical: item.is_magical, quality: item.quality,
            description: item.description, category: item.category, properties: item.properties,
            requirements: item.requirements, attunement: item.attunement
        });
    }
    updateCartWidget();
    if (state.user) syncToServer();
}

export function removeFromCart(index) {
    state.cart.splice(index, 1);
    updateCartWidget();
    if (state.user) syncToServer();
}

export function updateCartQuantity(index, newQuantity) {
    if (newQuantity <= 0) removeFromCart(index);
    else { state.cart[index].quantity = newQuantity; updateCartWidget(); }
    if (state.user) syncToServer();
}

export function addToReserved(item, traderId, quantity = 1) {
    const existing = state.reserved.find(i => i.traderId === traderId && i.itemId === item.id);
    if (existing) existing.quantity += quantity;
    else state.reserved.push({ ...item, traderId, quantity });
    updateCartWidget();
    if (state.user) syncToServer();
}

export function removeFromReserved(index) {
    state.reserved.splice(index, 1);
    updateCartWidget();
    if (state.user) syncToServer();
}

export function clearCart() {
    state.cart = [];
    updateCartWidget();
    if (state.user) syncToServer();
}

async function syncToServer() {
    if (!state.user) return;
    try {
        await updateCharacter(state.user.currentCharacterId, {
            cart: state.cart,
            reserved: state.reserved,
            gold: state.user.gold
        });
    } catch(e) { console.error(e); }
}