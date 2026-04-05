import { state, setUser, setTraders, setInventory, setCart, setReserved, setGmNotes, setCabinetData, setUserMode } from './state.js';
import { login, register, fetchMe, fetchTraders, fetchCharacter, updateCharacter, logout } from './api.js';
import { renderTraders, updateCartWidget, updateInventoryWidget, showToast, openTraderModal, renderInventoryModal, renderCartModal, renderCabinetModal } from './render.js';
import { populateFilters, bindFilterEvents } from './filters.js';
import { clearCart } from './cart.js';

async function initAuth() {
    const token = localStorage.getItem('token');
    if (!token) {
        document.getElementById('guestWarning').style.display = 'flex';
        document.getElementById('authContainer').style.display = 'none';
        return;
    }
    try {
        const me = await fetchMe();
        setUser(me);
        const chars = await fetchCharacters();
        if (chars.length) {
            const char = await fetchCharacter(chars[0].id);
            setUser({ ...me, ...char, currentCharacterId: char.id });
            setInventory(char.inventory || []);
            setCart(char.cart || []);
            setReserved(char.reserved || []);
            setGmNotes(char.gm_notes || {});
            setCabinetData(char.cabinet_data || {});
            updateCartWidget();
            updateInventoryWidget();
        }
        document.getElementById('authContainer').style.display = 'none';
        document.getElementById('guestWarning').style.display = 'none';
        document.getElementById('logoutBtn').style.display = 'inline-block';
    } catch(e) {
        console.error(e);
        logout();
    }
}

async function loadTraders() {
    const data = await fetchTraders();
    setTraders(data);
    populateFilters();
    renderTraders();
}

function bindUI() {
    document.getElementById('doLogin').onclick = async () => {
        const email = document.getElementById('loginEmail').value;
        const pwd = document.getElementById('loginPassword').value;
        try {
            const data = await login(email, pwd);
            localStorage.setItem('token', data.access_token);
            await initAuth();
            await loadTraders();
            showToast('Добро пожаловать!');
        } catch(e) { showToast('Ошибка входа'); }
    };
    document.getElementById('doRegister').onclick = async () => {
        const email = document.getElementById('loginEmail').value;
        const pwd = document.getElementById('loginPassword').value;
        try {
            await register(email, pwd);
            showToast('Регистрация успешна, теперь войдите');
        } catch(e) { showToast('Ошибка регистрации'); }
    };
    document.getElementById('logoutBtn').onclick = logout;
    document.getElementById('showAuthBtn').onclick = () => {
        document.getElementById('guestWarning').style.display = 'none';
        document.getElementById('authContainer').style.display = 'block';
    };
    document.getElementById('viewCartBtn').onclick = () => renderCartModal();
    document.getElementById('clearCartBtn').onclick = () => { clearCart(); showToast('Корзина очищена'); };
    document.getElementById('viewInventoryBtn').onclick = () => renderInventoryModal();
    document.getElementById('cabinetBtn').onclick = () => renderCabinetModal();
    document.getElementById('modeSwitch').onclick = () => {
        setUserMode(state.userMode === 'player' ? 'gm' : 'player');
        document.getElementById('modeSwitch').innerText = state.userMode === 'player' ? '👤 Игрок' : '🎭 ГМ';
        showToast(`Режим: ${state.userMode === 'player' ? 'Игрок' : 'ГМ'}`);
    };
    bindFilterEvents();
    document.querySelectorAll('.close').forEach(c => c.onclick = () => {
        document.getElementById('traderModal').style.display = 'none';
        document.getElementById('cartModal').style.display = 'none';
        document.getElementById('inventoryModal').style.display = 'none';
        document.getElementById('cabinetModal').style.display = 'none';
    });
}

async function init() {
    bindUI();
    await initAuth();
    await loadTraders();
}

init();