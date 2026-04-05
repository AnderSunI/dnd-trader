// frontend/js/longStoryShort.js

import { state } from "./state.js";

// Данные истории
export function loadStory() {
  const story = [
    {
      id: 1,
      title: "Встреча с торговцем",
      description: "Вы встретили торговца, который рассказал вам о скрытом лесу...",
      reward: "100 золота",
      completed: false,
    },
    {
      id: 2,
      title: "Задание: Убийство дракона",
      description: "Дракон, угрожающий деревне, был побежден вами...",
      reward: "1000 золота, новое оружие",
      completed: false,
    },
  ];

  state.story = story;
  renderStory(story);
}

// Рендеринг истории
function renderStory(story) {
  const container = document.getElementById("story-container");

  if (!container) return;

  if (story.length === 0) {
    container.innerHTML = "<p>Нет доступных историй.</p>";
    return;
  }

  container.innerHTML = story
    .map((event) => {
      const status = event.completed ? "Выполнен" : "Не выполнен";
      return `
        <div class="story-item" data-story-id="${event.id}">
          <h3>${event.title}</h3>
          <p>${event.description}</p>
          <p>Награда: ${event.reward}</p>
          <p>Статус: ${status}</p>
          <button onclick="markStoryAsCompleted(${event.id})">Завершить событие</button>
        </div>
      `;
    })
    .join("");
}

// Обновление статуса истории
export function markStoryAsCompleted(storyId) {
  const event = state.story.find((e) => e.id === storyId);
  if (event) {
    event.completed = true;
    renderStory(state.story);
  }
}
