import { getState, subscribe, update } from "../store.js";
import {
  ROOM_STATES,
  STAY_MAX_DAYS,
  STAY_MIN_DAYS,
  setRoomState,
} from "../rooms.js";

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

    <form class="days-form" data-days novalidate hidden>
      <div class="field">
        <label class="field__label" for="stay-days">Days</label>
        <input
          class="input input--days"
          id="stay-days"
          name="days"
          type="number"
          min="${STAY_MIN_DAYS}"
          max="${STAY_MAX_DAYS}"
          step="1"
          inputmode="numeric"
          autocomplete="off"
        >
      </div>

      <p class="error" data-days-error role="alert" hidden></p>

      <div class="form__actions">
        <button class="btn btn--primary" type="submit">Set occupied</button>
        <button class="btn" type="button" data-days-cancel>Cancel</button>
      </div>
    </form>
  </div>
`;

const roomLabel = dialog.querySelector("[data-room]");
const rows = [...dialog.querySelectorAll(".state-row")];
const daysForm = dialog.querySelector("[data-days]");
const daysInput = dialog.querySelector("#stay-days");
const daysError = dialog.querySelector("[data-days-error]");
const daysCancel = dialog.querySelector("[data-days-cancel]");

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

function hideDaysForm() {
  daysForm.hidden = true;
  daysError.hidden = true;
  daysError.textContent = "";
}

function focusCard(roomId) {
  // The view repainted during update(), so the card that opened this sheet is
  // detached and the browser dropped focus to <body>. Put it back.
  document.querySelector(`.card[data-id="${roomId}"]`)?.focus();
}

function commit(roomId, nextState, options) {
  update((state) => setRoomState(state, roomId, nextState, options));
  dialog.close();
  focusCard(roomId);
}

function showDaysForm(room) {
  daysForm.hidden = false;
  daysError.hidden = true;
  daysError.textContent = "";

  // Only seed on first reveal: re-tapping Occupied must not wipe what was typed.
  if (!daysInput.dataset.ready) {
    daysInput.value = room.stayDays ? String(room.stayDays) : "";
    daysInput.dataset.ready = "true";
  }

  daysInput.focus();
  daysInput.select();
}

for (const row of rows) {
  row.addEventListener("click", () => {
    const roomId = activeRoomId;
    if (!roomId) return;

    if (row.dataset.value === "occupied") {
      const room = getState().rooms.find((candidate) => candidate.id === roomId);
      if (room) showDaysForm(room);
      return;
    }

    commit(roomId, row.dataset.value);
  });
}

daysForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const roomId = activeRoomId;
  if (!roomId) return;

  const days = Number(daysInput.value);
  if (!Number.isInteger(days) || days < STAY_MIN_DAYS || days > STAY_MAX_DAYS) {
    daysError.textContent = `Enter a number of days between ${STAY_MIN_DAYS} and ${STAY_MAX_DAYS}.`;
    daysError.hidden = false;
    daysInput.focus();
    daysInput.select();
    return;
  }

  commit(roomId, "occupied", { days });
});

daysCancel.addEventListener("click", () => {
  hideDaysForm();
  dialog.querySelector('.state-row[data-value="occupied"]').focus();
});

dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());

// A click on the backdrop lands on the dialog element itself.
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

dialog.addEventListener("close", () => {
  activeRoomId = null;
  hideDaysForm();
  delete daysInput.dataset.ready;
});

export function openStateDialog(roomId) {
  activeRoomId = roomId;
  hideDaysForm();
  delete daysInput.dataset.ready;
  if (!dialog.open) dialog.showModal();
  render();
}

document.body.append(dialog);
subscribe(render);
