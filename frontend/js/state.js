// Глобальное состояние приложения
export const state = {
    user: null,               // объект пользователя (email, gold, id)
    traders: [],              // список торговцев
    inventory: [],            // инвентарь игрока
    cart: [],                 // корзина
    reserved: [],             // зарезервированные предметы
    gmNotes: {},              // заметки ГМ
    cabinetData: { history: '', quests: [], files: [], playerNotes: '', mapImage: '' },
    userMode: 'player',       // 'player' или 'gm'
    filters: {
        searchTrader: '',
        filterType: '',
        filterRegion: '',
        filterLevel: 0,
        reputationFilter: '',
        searchItem: '',
        priceMin: null,
        priceMax: null,
        rarityFilter: '',
        categoryFilter: '',
        magicOnly: false,
        sortBy: 'name'
    }
};

export function setUser(user) { state.user = user; }
export function setTraders(traders) { state.traders = traders; }
export function setInventory(inventory) { state.inventory = inventory; }
export function setCart(cart) { state.cart = cart; }
export function setReserved(reserved) { state.reserved = reserved; }
export function setGmNotes(notes) { state.gmNotes = notes; }
export function setCabinetData(data) { state.cabinetData = data; }
export function setUserMode(mode) { state.userMode = mode; }