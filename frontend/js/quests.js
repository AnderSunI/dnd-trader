// frontend/js/quests.js

import { state } from "./state.js";

// Массив заданий
export function loadQuests() {
  const quests = [
    { id: 1, name: "Простой квест", description: "Принести 10 растений.", reward: "100 золота", completed: false },
    { id: 2, name: "Сложный квест", description: "Убить дракона.", reward: "1000 золота, новое оружие", completed: false },
  ];

  state.quests = quests;
  renderQuests(quests);
}

// Рендеринг заданий
function renderQuests(quests) {
  const container = document.getElementById("task-list");

  if (!container) return;

  if (quests.length === 0) {
    container.innerHTML = "<p>Нет доступных квестов.</p>";
    return;
  }

  container.innerHTML = quests.map((quest) => {
    const status = quest.completed ? "Выполнен" : "Не выполнен";
    return `
      <div class="quest-item" data-quest-id="${quest.id}">
        <h3>${quest.name}</h3>
        <p>${quest.description}</p>
        <p>Награда: ${quest.reward}</p>
        <p>Статус: ${status}</p>
        <button onclick="markQuestAsCompleted(${quest.id})">Завершить квест</button>
      </div>
    `;
  }).join("");
}

// Завершение квеста
export function markQuestAsCompleted(questId) {
  const quest = state.quests.find((q) => q.id === questId);
  if (quest) {
    quest.completed = true;
    renderQuests(state.quests);
  }
}