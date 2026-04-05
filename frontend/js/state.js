// frontend/js/state.js

// ============================================================
// 🧠 GLOBAL STATE
// ============================================================

export const state = {
  user: null,

  traders: [],
  inventory: [],

  cart: [],
  reserved: [],

  filters: {
    search: "",
    category: null,
    rarity: null,
  },

  ui: {
    selectedTraderId: null,
  },
};

// ============================================================
// 🛠 SETTERS
// ============================================================

export function setUser(user) {
  state.user = user;
}

export function setTraders(traders) {
  state.traders = traders;
}

export function setInventory(items) {
  state.inventory = items;
}

export function setSelectedTrader(traderId) {
  state.ui.selectedTraderId = traderId;
}

// ============================================================
// 🧾 GETTERS
// ============================================================

export function getSelectedTrader() {
  return state.traders.find(
    t => t.id === state.ui.selectedTraderId
  );
}
