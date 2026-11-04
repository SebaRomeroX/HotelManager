import { getState, update } from "../store.js";
import { ROOM_TYPES, STAY_MAX_DAYS, STAY_MIN_DAYS } from "../rooms.js";
import {
  RESERVATION_NAME_MAX,
  addReservation,
  isPastReservation,
  removeReservation,
  reservationError,
  reservationMeta,
  updateReservation,
} from "../reservations.js";

const dialog = document.createElement("dialog");
dialog.className = "dialog";
dialog.setAttribute("aria-labelledby", "reservation-dialog-title");

dialog.innerHTML = `
  <header class="dialog__header">
    <h2 class="dialog__title" id="reservation-dialog-title" data-title>New reservation</h2>
    <button class="btn" type="button" data-close>Close</button>
  </header>

  <div class="dialog__body">
    <form class="form" novalidate>
      <fieldset class="field field--group">
        <legend class="field__label">Room type</legend>
        <div class="segmented">
          ${ROOM_TYPES.map(
            (type) => `
          <label class="segmented__option">
            <input type="radio" name="roomType" value="${type.value}" required>
            <span>${type.label}</span>
          </label>`,
          ).join("")}
        </div>
      </fieldset>

      <div class="field">
        <label class="field__label" for="reservation-date">Arrives</label>
        <input
          class="input"
          id="reservation-date"
          name="arrivalDate"
          type="date"
          required
        >
      </div>

      <div class="field">
        <label class="field__label" for="reservation-days">Duration (days)</label>
        <input
          class="input input--days"
          id="reservation-days"
          name="days"
          type="number"
          min="${STAY_MIN_DAYS}"
          max="${STAY_MAX_DAYS}"
          step="1"
          inputmode="numeric"
          autocomplete="off"
          required
        >
      </div>

      <div class="field" data-name-field>
        <label class="field__label" for="reservation-name">Host name</label>
        <input
          class="input"
          id="reservation-name"
          name="hostName"
          type="text"
          maxlength="${RESERVATION_NAME_MAX}"
          autocomplete="off"
          required
        >
      </div>

      <p class="hint" data-host hidden></p>

      <p class="hint" data-meta hidden></p>

      <p class="error" id="reservation-error" role="alert" hidden></p>

      <button class="btn btn--primary btn--block" type="submit" disabled>
        Add reservation
      </button>

      <div class="form__actions" data-edit-actions hidden>
        <button class="btn" type="button" data-edit-cancel>Cancel</button>
        <button class="btn btn--danger" type="button" data-cancel-res>Cancel reservation</button>
      </div>
    </form>
  </div>
`;

const form = dialog.querySelector("form");
const title = dialog.querySelector("[data-title]");
const nameField = dialog.querySelector("[data-name-field]");
const nameInput = dialog.querySelector("#reservation-name");
const dateInput = dialog.querySelector("#reservation-date");
const daysInput = dialog.querySelector("#reservation-days");
const errorText = dialog.querySelector("#reservation-error");
const addButton = dialog.querySelector('button[type="submit"]');
const actions = dialog.querySelector("[data-edit-actions]");
const editCancelButton = dialog.querySelector("[data-edit-cancel]");
const cancelResButton = dialog.querySelector("[data-cancel-res]");
const hostHint = dialog.querySelector("[data-host]");
const metaHint = dialog.querySelector("[data-meta]");
const typeField = dialog.querySelector("fieldset");

// Edit state is transient UI, so it stays here instead of going in the store.
let editingId = null;
let confirmingCancel = false;
// Which control owns the visible error, so typing there can clear it.
let errorField = null;

function setError(problem) {
  errorField = problem?.field ?? null;

  if (!problem) {
    errorText.hidden = true;
    errorText.textContent = "";
    for (const input of form.querySelectorAll("[aria-invalid]")) {
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
    }
    return;
  }

  errorText.textContent = problem.message;
  errorText.hidden = false;

  const input = form.elements[problem.field];
  input?.setAttribute("aria-invalid", "true");
  input?.setAttribute("aria-describedby", "reservation-error");
}

// Typing can clear a problem, so stale red must go the moment a field changes.
function clearErrorFor(target) {
  if (!errorText.hidden && target.name === errorField) setError(null);
}

function resetCancelConfirm() {
  confirmingCancel = false;
  cancelResButton.textContent = "Cancel reservation";
  cancelResButton.classList.remove("btn--armed");
}

// A past booking is history: everything shows as text and only the two-step
// cancel stays live.
function readOnly() {
  const reservation = findEditing();
  return reservation !== undefined && isPastReservation(reservation);
}

function syncMode() {
  const editing = editingId !== null;
  const readonly = readOnly();

  title.textContent = !editing
    ? "New reservation"
    : readonly
      ? "Past reservation"
      : "Edit reservation";
  addButton.textContent = editing ? "Save changes" : "Add reservation";
  actions.hidden = !editing;
  actions.classList.toggle("form__actions--single", readonly);
  editCancelButton.hidden = readonly;
  // The name belongs to the booking for good: show it as text, not a field.
  nameField.hidden = editing;
  hostHint.hidden = !editing;
  metaHint.hidden = !readonly;

  // Read-only hides the whole form: static lines instead of inputs.
  typeField.hidden = readonly;
  dateInput.closest(".field").hidden = readonly;
  daysInput.closest(".field").hidden = readonly;
  addButton.hidden = readonly;

  if (editing) {
    const reservation = findEditing();
    hostHint.textContent = reservation ? `Host: ${reservation.hostName}` : "";
    if (readonly && reservation) metaHint.textContent = reservationMeta(reservation);
  }

  resetCancelConfirm();
}

function findEditing() {
  return (getState().reservations ?? []).find(
    (reservation) => reservation.id === editingId,
  );
}

function todayISO() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function resetForm() {
  form.reset();
  setError(null);

  // A reservation books a night to come, so the picker opens on today and
  // refuses anything earlier at both the input and the validator.
  const today = todayISO();
  dateInput.min = today;
  dateInput.value = today;

  addButton.disabled = true;
  syncMode();
}

function prefill() {
  const reservation = findEditing();
  if (!reservation) return;

  const radio = form.querySelector(
    `input[name="roomType"][value="${reservation.roomType}"]`,
  );
  if (radio) radio.checked = true;

  // Read-only never reaches here, so the date is always a night to come.
  dateInput.value = reservation.arrivalDate;
  daysInput.value = String(reservation.days);
  addButton.disabled = false;
}

function readValues() {
  return {
    // Edit mode sends the stored name: the hint is not a field, so what the
    // validator sees is what is already on the record.
    hostName: editingId === null ? nameInput.value : findEditing()?.hostName ?? "",
    roomType: form.elements.roomType.value,
    arrivalDate: dateInput.value,
    days: daysInput.value,
  };
}

form.addEventListener("change", (event) => {
  addButton.disabled = form.elements.roomType.value === "";
  clearErrorFor(event.target);
});

form.addEventListener("input", (event) => clearErrorFor(event.target));

form.addEventListener("submit", (event) => {
  event.preventDefault();

  // Belt: hidden fields should make this unreachable for a past booking.
  if (readOnly()) return;

  const values = readValues();
  const problem = reservationError(values);

  if (problem) {
    setError(problem);
    form.elements[problem.field]?.focus();
    return;
  }

  setError(null);

  if (editingId === null) {
    update((state) => addReservation(state, values));
  } else {
    const id = editingId;
    update((state) => updateReservation(state, id, values));
  }

  dialog.close();
});

editCancelButton.addEventListener("click", () => dialog.close());

cancelResButton.addEventListener("click", () => {
  if (editingId === null) return;

  if (!confirmingCancel) {
    confirmingCancel = true;
    cancelResButton.textContent = "Confirm cancel";
    cancelResButton.classList.add("btn--armed");
    cancelResButton.focus();
    return;
  }

  const id = editingId;
  update((state) => removeReservation(state, id));
  dialog.close();
});

dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());

// A click on the backdrop lands on the dialog element itself.
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

dialog.addEventListener("close", () => {
  const returnTo = editingId;
  editingId = null;
  resetForm();

  // Saving repaints the list, so both the opener and the rows are new
  // elements by now and the browser's own restoration finds nothing. After a
  // cancel the row is gone entirely — fall back to the screen's button.
  const row =
    returnTo && document.querySelector(`.res-row[data-id="${returnTo}"]`);
  (row ?? document.querySelector("[data-new-reservation]"))?.focus();
});

export function openReservationDialog(reservationId = null) {
  if (dialog.open) return;

  editingId = reservationId;
  if (editingId !== null && !findEditing()) {
    editingId = null;
    return;
  }

  const readonly = readOnly();
  resetForm();
  if (editingId !== null && !readonly) prefill();

  dialog.showModal();
  if (editingId === null) {
    nameInput.focus();
  } else if (!readonly) {
    // First checked radio, else the first one: a comma selector alone would
    // return the topmost option regardless of which one is checked.
    const typeRadio =
      form.querySelector('input[name="roomType"]:checked') ??
      form.querySelector('input[name="roomType"]');
    typeRadio?.focus();
  }
  // Read-only leaves the browser's own focus on the header Close button.
}

document.body.append(dialog);
