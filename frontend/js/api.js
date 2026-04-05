const API_BASE = '';

async function request(url, options = {}) {
    const token = localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(API_BASE + url, { ...options, headers });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
    }
    return response.json();
}

// Auth
export async function login(email, password) {
    return request(`/auth/login?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`, { method: 'POST' });
}
export async function register(email, password) {
    return request(`/auth/register?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`, { method: 'POST' });
}
export async function fetchMe() {
    return request('/auth/me');
}
export function logout() {
    localStorage.removeItem('token');
    window.location.reload();
}

// Traders
export async function fetchTraders() {
    return request('/traders');
}
export async function updateTraderGold(traderId, gold) {
    return request(`/traders/${traderId}/gold?gold=${gold}`, { method: 'PATCH' });
}
export async function restockTrader(traderId) {
    return request(`/traders/${traderId}/restock`, { method: 'POST' });
}

// Characters
export async function fetchCharacters() {
    return request('/characters');
}
export async function fetchCharacter(charId) {
    return request(`/characters/${charId}`);
}
export async function updateCharacter(charId, payload) {
    return request(`/characters/${charId}`, { method: 'PUT', body: JSON.stringify(payload) });
}
export async function createCharacter(name) {
    return request(`/characters?name=${encodeURIComponent(name)}`, { method: 'POST' });
}