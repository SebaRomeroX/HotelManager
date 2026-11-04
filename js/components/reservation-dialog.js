import { update } from "../store.js";
import { ROOM_TYPES, STAY_MAX_DAYS, STAY_MIN_DAYS } from "../rooms.js";
import {
  RESERVATION_NAME_MAX,
  addReservation,
  reservationError,
} from "../reservations.js";

const dialog = document.createElement("dialog");
dialog.className = "dialog";
dialog.setAttribute("aria-labelledby", "reservation-dialog-title");

dialog.innerHTML = `
  <header class="dialog__header">
    <h2 class="dialog__title" id="reservation-dialog-title">New reservation</h2>
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

      <div class="field">
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

      <p class="error" id="reservation-error" role="alert" hidden></p>

      <button class="btn btn--primary btn--block" type="submit" disabled>
        Add reservation
      </button>
    </form>
  </div>
`;

const form = dialog.querySelector("form");
const nameInput = dialog.querySelector("#reservation-name");
const dateInput = dialog.querySelector("#reservation-date");
const daysInput = dialog.querySelector("#reservation-days");
const errorText = dialog.querySelector("#reservation-error");
const addButton = dialog.querySelector('button[type="submit"]');

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
}

form.addEventListener("change", (event) => {
  addButton.disabled = form.elements.roomType.value === "";
  clearErrorFor(event.target);
});

form.addEventListener("input", (event) => clearErrorFor(event.target));

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const values = {
    hostName: nameInput.value,
    roomType: form.elements.roomType.value,
    arrivalDate: dateInput.value,
    days: daysInput.value,
  };

  const problem = reservationError(values);
  if (problem) {
    setError(problem);
    form.elements[problem.field]?.focus();
    return;
  }

  setError(null);
  update((state) => addReservation(state, values));
  dialog.close();
});

dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());

// A click on the backdrop lands on the dialog element itself.
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

dialog.addEventListener("close", () => {
  // Saving repaints the view, so the button that opened this sheet is a new
  // element by now and the browser's own focus restoration finds nothing.
  document.querySelector("[data-new-reservation]")?.focus();
  resetForm();
});

export function openReservationDialog() {
  if (dialog.open) return;
  resetForm();
  dialog.showModal();
  nameInput.focus();
}

document.body.append(dialog);
