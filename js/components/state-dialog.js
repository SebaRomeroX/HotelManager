import { getState, subscribe, update } from "../store.js";
import { ROOM_STATES, updateRoom } from "../rooms.js";

const dialog = document.createElement("dialog");
dialog.className = "dialog";
dialog.setAttribute("aria-labelledby", "state-dialog-title");

dialog.innerHTML = `
  <header class="dialog__header">
    <h2 class="dialog__title" id="state-dialog-title">Room state</h2>
    <button class="btn" type="button" data-close>Close</button>
  </header>

  <div class="dialog__body">
    <p class="hint" data-room></p>

    <div class="state-list">
      ${ROOM_STATES.map(
        (state) => `
      <button
        class="state-row state-row--${state.value}"
        type="button"
        data-value="${state.value}"
      >
        <span class="state-row__dot"></span>
        <span class="state-row__label">${state.label}</span>
        <span class="state-row__check" aria-hidden="true">✓</span>
      </button>`,
      ).join("")}
    </div>
  </div>
`;

const roomLabel = dialog.querySelector("[data-room]");
const rows = [...dialog.querySelectorAll(".state-row")];

let activeRoomId = null;

function render() {
  if (!activeRoomId) return;

  const room = getState().rooms.find(
    (candidate) => candidate.id === activeRoomId,
  );
  if (!room) {
    dialog.close();
    return;
  }

  roomLabel.textContent = room.name;

  for (const row of rows) {
    if (row.dataset.value === room.state) {
      row.setAttribute("aria-current", "true");
    } else {
      row.removeAttribute("aria-current");
    }
  }
}

for (const row of rows) {
  row.addEventListener("click", () => {
    const roomId = activeRoomId;
    if (!roomId) return;

    update((state) => updateRoom(state, roomId, { state: row.dataset.value }));
    dialog.close();

    // The view repainted during update(), so the card that opened this sheet is
    // detached and the browser dropped focus to <body>. Put it back.
    document.querySelector(`.card[data-id="${roomId}"]`)?.focus();
  });
}

dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());

// A click on the backdrop lands on the dialog element itself.
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

dialog.addEventListener("close", () => {
  activeRoomId = null;
});

export function openStateDialog(roomId) {
  activeRoomId = roomId;
  if (!dialog.open) dialog.showModal();
  render();
}

document.body.append(dialog);
subscribe(render);
