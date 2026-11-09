import { getState, subscribe, update } from "../store.js";
import {
  ROOM_STATES,
  STAY_MAX_DAYS,
  STAY_MIN_DAYS,
  roomStateText,
  setRoomState,
  typeLabel,
} from "../rooms.js";
import {
  arrivingAssignment,
  checkInReservation,
  checkoutDate,
  formatDate,
  occupancyConflict,
  removeReservation,
  reservationMeta,
} from "../reservations.js";

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

    <section class="arrival" data-arrival hidden>
      <h3 class="arrival__title">Arriving</h3>
      <p class="arrival__host" data-arrival-host></p>
      <p class="hint" data-arrival-meta></p>

      <div class="form__actions" data-arrival-actions>
        <button class="btn btn--primary" type="button" data-arrival-checkin>
          Check in
        </button>
        <button class="btn btn--danger" type="button" data-arrival-cancel>
          Cancel
        </button>
      </div>

      <div class="arrival__confirmation" data-arrival-confirmation hidden>
        <dl class="arrival__facts">
          <div>
            <dt>Host</dt>
            <dd data-fact-host></dd>
          </div>
          <div>
            <dt>Room</dt>
            <dd data-fact-room></dd>
          </div>
          <div>
            <dt>Room type</dt>
            <dd data-fact-type></dd>
          </div>
          <div>
            <dt>Arrives</dt>
            <dd data-fact-arrival></dd>
          </div>
          <div>
            <dt>Checks out</dt>
            <dd data-fact-checkout></dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd data-fact-days></dd>
          </div>
        </dl>

        <p class="error" data-arrival-error role="alert" hidden></p>

        <div class="form__actions">
          <button class="btn btn--primary" type="button" data-confirm-checkin>
            Confirm
          </button>
          <button class="btn" type="button" data-arrival-back>Back</button>
        </div>
      </div>
    </section>

    <div class="state-list" data-states>
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

const title = dialog.querySelector("#state-dialog-title");
const roomMeta = dialog.querySelector("[data-room]");
const arrival = dialog.querySelector("[data-arrival]");
const arrivalHost = dialog.querySelector("[data-arrival-host]");
const arrivalMeta = dialog.querySelector("[data-arrival-meta]");
const arrivalActions = dialog.querySelector("[data-arrival-actions]");
const arrivalCheckin = dialog.querySelector("[data-arrival-checkin]");
const arrivalCancel = dialog.querySelector("[data-arrival-cancel]");
const arrivalConfirmation = dialog.querySelector("[data-arrival-confirmation]");
const arrivalBack = dialog.querySelector("[data-arrival-back]");
const confirmCheckin = dialog.querySelector("[data-confirm-checkin]");
const arrivalError = dialog.querySelector("[data-arrival-error]");
const factHost = dialog.querySelector("[data-fact-host]");
const factRoom = dialog.querySelector("[data-fact-room]");
const factType = dialog.querySelector("[data-fact-type]");
const factArrival = dialog.querySelector("[data-fact-arrival]");
const factCheckout = dialog.querySelector("[data-fact-checkout]");
const factDays = dialog.querySelector("[data-fact-days]");
const states = dialog.querySelector("[data-states]");
const rows = [...dialog.querySelectorAll(".state-row")];
const daysForm = dialog.querySelector("[data-days]");
const daysInput = dialog.querySelector("#stay-days");
const daysError = dialog.querySelector("[data-days-error]");
const daysCancel = dialog.querySelector("[data-days-cancel]");

let activeRoomId = null;
// Arrival sheet state: the booking being acted on, whether its details are
// expanded, and whether Cancel has been armed.
let arrivalId = null;
let confirmingCancel = false;

function resetCancelArm() {
  confirmingCancel = false;
  arrivalCancel.textContent = "Cancel";
  arrivalCancel.classList.remove("btn--armed");
}

function resetArrival() {
  arrivalId = null;
  resetCancelArm();
  arrivalActions.hidden = false;
  arrivalConfirmation.hidden = true;
  arrivalError.hidden = true;
  arrivalError.textContent = "";
}

function startArrival(reservation) {
  resetArrival();
  arrivalId = reservation.id;
}

function fillArrival(reservation, room) {
  const days = reservation.days;

  arrivalHost.textContent = reservation.hostName;
  arrivalMeta.textContent = reservationMeta(reservation);

  factHost.textContent = reservation.hostName;
  factRoom.textContent = room.name;
  factType.textContent = typeLabel(reservation.roomType);
  factArrival.textContent = formatDate(reservation.arrivalDate);
  factCheckout.textContent = formatDate(
    checkoutDate(reservation.arrivalDate, days),
  );
  factDays.textContent = `${days} ${days === 1 ? "day" : "days"}`;
}

function showArrivalError(message) {
  arrivalError.textContent = message;
  arrivalError.hidden = false;
  confirmCheckin.focus();
}

function render() {
  if (!activeRoomId) return;

  const room = getState().rooms.find(
    (candidate) => candidate.id === activeRoomId,
  );
  if (!room) {
    dialog.close();
    return;
  }

  // The hold is derived, so it appears and disappears with the assignment —
  // including under this sheet if the store changes while it is open.
  const arriving = arrivingAssignment(getState()).get(activeRoomId);

  title.textContent = room.name;
  roomMeta.textContent =
    `${typeLabel(room.type)} · ` +
    (arriving ? "Arriving" : roomStateText(room));

  if (arriving) {
    if (arriving.id !== arrivalId) startArrival(arriving);
    fillArrival(arriving, room);
    arrival.hidden = false;
    // A held room's only useful actions are the arrival ones: check the host
    // in, or cancel and release the room. State edits would be a detour.
    states.hidden = true;
    hideDaysForm();
    return;
  }

  if (arrivalId !== null) resetArrival();
  arrival.hidden = true;
  states.hidden = false;

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

arrivalCheckin.addEventListener("click", () => {
  if (!arrivalId) return;
  resetCancelArm();
  arrivalActions.hidden = true;
  arrivalConfirmation.hidden = false;
  arrivalError.hidden = true;
  arrivalError.textContent = "";
  confirmCheckin.focus();
});

arrivalBack.addEventListener("click", () => {
  resetCancelArm();
  arrivalConfirmation.hidden = true;
  arrivalActions.hidden = false;
  arrivalError.hidden = true;
  arrivalError.textContent = "";
  arrivalCheckin.focus();
});

confirmCheckin.addEventListener("click", () => {
  const id = arrivalId;
  const roomId = activeRoomId;
  if (!id || !roomId) return;

  const before = getState();
  const reservation = (before.reservations ?? []).find(
    (candidate) => candidate.id === id,
  );
  if (!reservation) {
    showArrivalError("This booking is no longer available.");
    return;
  }

  const heldRoomId = [...arrivingAssignment(before)].find(
    ([, held]) => held.id === id,
  )?.[0];
  if (heldRoomId === undefined) {
    showArrivalError(`No free ${typeLabel(reservation.roomType)} room right now.`);
    return;
  }

  const conflict = occupancyConflict(before, heldRoomId, reservation.days, new Date(), {
    exceptId: id,
  });
  if (conflict) {
    showArrivalError(
      `That stay overlaps ${conflict.hostName}'s arrival on ` +
        `${formatDate(conflict.arrivalDate)}.`,
    );
    return;
  }

  const after = checkInReservation(before, id);
  if (after === before) {
    showArrivalError(`No free ${typeLabel(reservation.roomType)} room right now.`);
    return;
  }

  update(() => after);
  dialog.close();
  focusCard(roomId);
});

arrivalCancel.addEventListener("click", () => {
  const id = arrivalId;
  const roomId = activeRoomId;
  if (!id || !roomId) return;

  if (!confirmingCancel) {
    confirmingCancel = true;
    arrivalCancel.textContent = "Sure?";
    arrivalCancel.classList.add("btn--armed");
    arrivalCancel.focus();
    return;
  }

  update((state) => removeReservation(state, id));
  dialog.close();
  focusCard(roomId);
});

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

  // The stay must not eat a room some booking is counting on. Same-reference
  // refusal in the domain; here it is the message.
  const conflict = occupancyConflict(getState(), roomId, days);
  if (conflict) {
    daysError.textContent =
      `That stay overlaps ${conflict.hostName}'s arrival on ` +
      `${formatDate(conflict.arrivalDate)}.`;
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
  resetArrival();
  hideDaysForm();
  delete daysInput.dataset.ready;
  title.textContent = "Room state";
});

export function openStateDialog(roomId) {
  activeRoomId = roomId;
  resetArrival();
  hideDaysForm();
  delete daysInput.dataset.ready;
  if (!dialog.open) dialog.showModal();
  render();
  // The host is standing at the desk: the sheet's first action is the one
  // they came for.
  if (arrivalId !== null) arrivalCheckin.focus();
}

document.body.append(dialog);
subscribe(render);
