// frontend/js/playerNotes.js

import { state } from "./state.js";

export function loadPlayerNotes() {
  const notes = [
    { id: 1, text: "Первая заметка для игрока." },
    { id: 2, text: "Вторая заметка для игрока." },
  ];

  state.notes = notes;
  renderNotes(notes);
}

function renderNotes(notes) {
  const container = document.getElementById("playerNotesText");

  if (!container) return;

  container.innerHTML = notes
    .map((note) => `<div class="note-item">${note.text}</div>`)
    .join("");
}