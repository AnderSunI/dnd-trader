import { state } from './state.js';
import { renderTraders } from './render.js';

export function populateFilters() {
    const types = new Set(), regions = new Set(), categories = new Set();
    state.traders.forEach(t => {
        if (t.type) types.add(t.type);
        if (t.region) regions.add(t.region);
        t.items.forEach(i => { if (i.category) categories.add(i.category); });
    });
    const typeSel = document.getElementById('filterType');
    if (typeSel) {
        typeSel.innerHTML = '<option value="">Все типы</option>' + Array.from(types).sort().map(t => `<option value="${t}">${t}</option>`).join('');
    }
    const regionSel = document.getElementById('filterRegion');
    if (regionSel) {
        regionSel.innerHTML = '<option value="">Все регионы</option>' + Array.from(regions).sort().map(r => `<option value="${r}">${r}</option>`).join('');
    }
    const catSel = document.getElementById('categoryFilter');
    if (catSel) {
        catSel.innerHTML = '<option value="">Любая</option>' + Array.from(categories).sort().map(c => `<option value="${c}">${c}</option>`).join('');
    }
}

export function getFilteredTraders() {
    let filtered = [...state.traders];
    const f = state.filters;
    if (f.searchTrader) filtered = filtered.filter(t => t.name.toLowerCase().includes(f.searchTrader.toLowerCase()));
    if (f.filterType) filtered = filtered.filter(t => t.type === f.filterType);
    if (f.filterRegion) filtered = filtered.filter(t => t.region === f.filterRegion);
    if (f.filterLevel > 0) filtered = filtered.filter(t => (t.level_min || 1) <= f.filterLevel && (t.level_max || 999) >= f.filterLevel);
    if (f.reputationFilter) filtered = filtered.filter(t => t.reputation >= parseInt(f.reputationFilter));
    if (f.searchItem) {
        filtered = filtered.filter(t => t.items.some(i => i.name.toLowerCase().includes(f.searchItem.toLowerCase())));
    }
    // ценовые фильтры, редкость, категория, магия – аналогично
    return filtered;
}

export function bindFilterEvents() {
    const ids = ['searchTrader', 'filterType', 'filterRegion', 'filterLevel', 'reputationFilter', 'searchItem', 'priceMin', 'priceMax', 'rarityFilter', 'categoryFilter', 'magicOnly', 'sortBy'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => { renderTraders(); });
    });
}