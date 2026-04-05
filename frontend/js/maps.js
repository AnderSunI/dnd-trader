// frontend/js/maps.js

import { state } from "./state.js";

// Массив карт
export function loadMapData() {
  const mapData = [
    { id: 1, name: "Мир Торана", description: "Великий мир, разделённый на континенты." },
    { id: 2, name: "Темные леса", description: "Место, где скрываются опасные существа." },
  ];

  state.maps = mapData;
  renderMaps(mapData);
}

// Рендеринг карт
function renderMaps(maps) {
  const container = document.getElementById("maps-container");

  if (!container) return;

  if (maps.length === 0) {
    container.innerHTML = "<p>Нет доступных карт.</p>";
    return;
  }

  container.innerHTML = maps.map((map) => {
    return `
      <div class="map-item" data-map-id="${map.id}">
        <h3>${map.name}</h3>
        <p>${map.description}</p>
        <button onclick="viewMap(${map.id})">Просмотр карты</button>
      </div>
    `;
  }).join("");
}

// Просмотр карты
export function viewMap(mapId) {
  const map = state.maps.find((m) => m.id === mapId);
  if (map) {
    alert(`Просмотр карты: ${map.name}`);
    // Заменим alert на рендер карты (можно добавить изображение или холст)
  }
}