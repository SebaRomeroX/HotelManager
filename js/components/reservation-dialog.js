import { getState, update } from "../store.js";
import { ROOM_TYPES, STAY_MAX_DAYS, STAY_MIN_DAYS } from "../rooms.js";
import {
  RESERVATION_NAME_MAX,
  addReservation,
  arrivingRoomIds,
  bookableRoomTypes,
  checkInReservation,
  formatDate,
  isArrivingNow,
  isReadOnlyReservation,
  maxStayDaysForRequest,
  occupancyConflictForRooms,
  parseDate,
  removeReservation,
  reservationAvailabilityError,
  reservationError,
  reservationMeta,
  reservationRoomCounts,
  reservationRoomTotal,
  roomCountsLabel,
  updateReservation,
} from "../reservations.js";
import { announce } from "./announcer.js";

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
      <fieldset class="field field--group" data-rooms-field>
        <legend class="field__label">Rooms</legend>
        <div class="room-counts">
          ${ROOM_TYPES.map(
            (type) => `
          <label class="room-counts__field">
            <span>${type.label}</span>
            <input
              class="input room-counts__input"
              type="number"
              name="roomCount-${type.value}"
              data-room-count="${type.value}"
              min="0"
              step="1"
              inputmode="numeric"
              autocomplete="off"
              aria-label="${type.label} rooms"
            >
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
          aria-describedby="reservation-stay-hint"
          required
        >
        <p class="hint" id="reservation-stay-hint" data-stay-hint hidden></p>
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

      <div class="checkin" data-checkin hidden>
        <button class="btn btn--block" type="button" data-checkin-btn>
          Check in now
        </button>
        <p class="error" data-checkin-error role="alert" hidden></p>
      </div>

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
const stayHint = dialog.querySelector("[data-stay-hint]");
const roomsField = dialog.querySelector("[data-rooms-field]");
const checkinBlock = dialog.querySelector("[data-checkin]");
const checkinButton = dialog.querySelector("[data-checkin-btn]");
const checkinError = dialog.querySelector("[data-checkin-error]");

// Edit state is transient UI, so it stays here instead of going in the store.
let editingId = null;
let confirmingCancel = false;
// A filter-originated booking clears the calendar request only once the write
// has passed every check. Kept transient like the rest of the sheet state.
let beforeSave = null;
// Which control owns the visible error, so typing there can clear it.
let errorField = null;
// Date whose calendar cell takes focus after the sheet closes — a booking
// started from a day lands back on that day, not on the list.
let focusDate = null;
// Selector for a control outside the list that opened the sheet (for example
// the Incoming button); preferred over the calendar fallback.
let focusSelector = null;

// The room-count inputs are a group, not one named control. A "rooms" problem
// reaches all of them so the error is attached to every count.
function roomCountInputs() {
  return [...form.querySelectorAll("[data-room-count]")];
}

function controlsFor(name) {
  if (name === "rooms") return roomCountInputs();

  const control = form.elements[name];
  if (!control) return [];
  return typeof control.setAttribute === "function" ? [control] : [...control];
}

function focusField(name) {
  if (name === "rooms") {
    const inputs = roomCountInputs();
    (
      inputs.find((input) => !input.disabled && Number(input.value) > 0) ??
      inputs.find((input) => !input.disabled) ??
      inputs[0]
    )?.focus();
    return;
  }

  const [first, ...rest] = controlsFor(name);
  if (!first) return;
  (first.checked ? first : rest.find((input) => input.checked) ?? first).focus();
}

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

  for (const input of controlsFor(problem.field)) {
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", "reservation-error");
  }
}

// Typing can clear a problem, so stale red must go the moment a field changes.
function clearErrorFor(target) {
  const field = target.dataset.roomCount ? "rooms" : target.name;
  if (!errorText.hidden && field === errorField) setError(null);
}

function resetCancelConfirm() {
  confirmingCancel = false;
  cancelResButton.textContent = "Cancel reservation";
  cancelResButton.classList.remove("btn--armed");
}

function clearCheckinError() {
  checkinError.hidden = true;
  checkinError.textContent = "";
}

function roomTotals(rooms) {
  const totals = Object.fromEntries(ROOM_TYPES.map(({ value }) => [value, 0]));
  for (const room of rooms) {
    if (room.type in totals) totals[room.type] += 1;
  }
  return totals;
}

function readRoomCount(input) {
  const raw = input.value.trim();
  if (raw === "") return 0;

  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : NaN;
}

function roomCountsFromForm() {
  return Object.fromEntries(
    roomCountInputs().map((input) => [
      input.dataset.roomCount,
      readRoomCount(input),
    ]),
  );
}

function chosenRoomTotal(counts) {
  return ROOM_TYPES.reduce((sum, { value }) => {
    const count = counts[value];
    return sum + (Number.isInteger(count) && count > 0 ? count : 0);
  }, 0);
}

function setRoomCounts(counts) {
  for (const input of roomCountInputs()) {
    const count = Number(counts?.[input.dataset.roomCount] ?? 0);
    input.value = String(Number.isInteger(count) && count > 0 ? count : 0);
  }
}

// New bookings only: a type with no room left on the chosen date cannot be
// picked, so the form never offers a choice the guard would refuse. Edits keep
// every type live because the record's own hold must not hide its type.
// The duration hint always follows the whole request and date.
function syncAvailabilityHints() {
  if (readOnly()) {
    stayHint.hidden = true;
    return;
  }

  const state = getState();
  const current = editingId === null ? undefined : findEditing();
  const totals = roomTotals(state.rooms ?? []);
  const date = parseDate(dateInput.value);
  let bookable = null;

  if (editingId === null) {
    bookable = date ? bookableRoomTypes(state, dateInput.value, { current }) : null;

    for (const input of roomCountInputs()) {
      const type = input.dataset.roomCount;
      const unavailable =
        bookable !== null && (!bookable.includes(type) || (totals[type] ?? 0) === 0);
      input.disabled = unavailable;
      // A type that has no room on the new date must not keep a stale count.
      if (unavailable) input.value = "0";
    }
  } else {
    for (const input of roomCountInputs()) input.disabled = false;
  }

  const existing = current ? reservationRoomCounts(current) : null;
  for (const input of roomCountInputs()) {
    const type = input.dataset.roomCount;
    // Keep an edit's existing count selectable even if rooms were removed since
    // the booking; the guard can still refuse an impossible increase.
    const max = Math.max(totals[type] ?? 0, existing?.[type] ?? 0);
    input.max = String(max);
  }

  if (!date) {
    stayHint.hidden = true;
    return;
  }

  if (editingId === null && bookable.length === 0) {
    stayHint.textContent = `No rooms are free on ${formatDate(dateInput.value)}.`;
    stayHint.hidden = false;
    return;
  }

  const counts = roomCountsFromForm();
  if (chosenRoomTotal(counts) === 0) {
    stayHint.textContent = "Choose at least one room to see the longest stay.";
    stayHint.hidden = false;
    return;
  }

  const days = maxStayDaysForRequest(state, counts, dateInput.value, { current });
  if (days === 0) {
    stayHint.textContent =
      `This request cannot start on ${formatDate(dateInput.value)}.`;
  } else {
    stayHint.textContent =
      `Up to ${days} ${days === 1 ? "day" : "days"} for ` +
      `${roomCountsLabel(counts)} from ${formatDate(dateInput.value)}.`;
  }
  stayHint.hidden = false;
}

// Checked-in and past bookings are history: everything shows as text and only
// the two-step cancel stays live.
function readOnly() {
  const reservation = findEditing();
  return reservation !== undefined && isReadOnlyReservation(reservation);
}

function syncMode() {
  const editing = editingId !== null;
  const readonly = readOnly();
  const reservation = editing ? findEditing() : undefined;

  title.textContent = !editing
    ? "New reservation"
    : readonly
      ? reservation?.checkedInAt
        ? "Checked-in reservation"
        : "Past reservation"
      : "Edit reservation";
  actions.hidden = !editing;
  actions.classList.toggle("form__actions--single", readonly);
  editCancelButton.hidden = readonly;
  // The name belongs to the booking for good: show it as text, not a field.
  nameField.hidden = editing;
  hostHint.hidden = !editing;
  metaHint.hidden = !readonly;

  // Read-only hides the whole form: static lines instead of inputs.
  roomsField.hidden = readonly;
  dateInput.closest(".field").hidden = readonly;
  daysInput.closest(".field").hidden = readonly;
  addButton.hidden = readonly;

  if (editing) {
    hostHint.textContent = reservation ? `Host: ${reservation.hostName}` : "";
    if (readonly && reservation) metaHint.textContent = reservationMeta(reservation);
  }

  syncArrivalActions();
  resetCancelConfirm();
}

// The arrival choice follows the date in the form, not the stored booking: an
// edit whose date moves to today must offer check-in without reopening the
// sheet. Saving always keeps the booking pending; Check in now saves and then
// runs the same check-in the register uses.
function syncArrivalActions() {
  const arriving =
    !readOnly() && isArrivingNow({ arrivalDate: dateInput.value });

  addButton.textContent =
    editingId === null
      ? arriving
        ? "Save as arriving"
        : "Add reservation"
      : "Save changes";
  checkinBlock.hidden = !arriving;
  // A new booking cannot be checked in before it is valid enough to save.
  checkinButton.disabled = editingId === null && addButton.disabled;

  if (!arriving) {
    clearCheckinError();
  }
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
  clearCheckinError();

  // Reset leaves disabled alone and clears the count inputs, so write the
  // canonical zero request and let syncAvailabilityHints set today's limits.
  for (const input of roomCountInputs()) input.disabled = false;
  setRoomCounts({ small: 0, large: 0, suite: 0 });

  // A reservation books a night to come, so the picker opens on today and
  // refuses anything earlier at both the input and the validator.
  const today = todayISO();
  dateInput.min = today;
  dateInput.value = today;

  addButton.disabled = true;
  syncMode();
  syncAvailabilityHints();
}

function prefill() {
  const reservation = findEditing();
  if (!reservation) return;

  setRoomCounts(reservationRoomCounts(reservation));

  // Read-only never reaches here, so the date is always a night to come.
  dateInput.value = reservation.arrivalDate;
  daysInput.value = String(reservation.days);
  addButton.disabled = reservationRoomTotal(reservation) === 0;
  syncArrivalActions();
}

function readValues() {
  return {
    // Edit mode sends the stored name: the hint is not a field, so what the
    // validator sees is what is already on the record.
    hostName: editingId === null ? nameInput.value : findEditing()?.hostName ?? "",
    roomCounts: roomCountsFromForm(),
    arrivalDate: dateInput.value,
    days: daysInput.value,
  };
}

form.addEventListener("change", (event) => {
  if (event.target.name === "arrivalDate" || event.target.dataset.roomCount) {
    syncAvailabilityHints();
  }
  addButton.disabled = chosenRoomTotal(roomCountsFromForm()) === 0;
  syncArrivalActions();
  clearCheckinError();
  clearErrorFor(event.target);
});

form.addEventListener("input", (event) => {
  if (event.target.dataset.roomCount) {
    addButton.disabled = chosenRoomTotal(roomCountsFromForm()) === 0;
    syncArrivalActions();
  }
  clearCheckinError();
  clearErrorFor(event.target);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  // Belt: hidden fields should make this unreachable for a past booking.
  if (readOnly()) return;

  const values = readValues();
  const problem = reservationError(values, undefined, {
    // An unchanged date may sit inside the straddling no-show window.
    currentDate:
      editingId === null ? undefined : findEditing()?.arrivalDate,
  });

  if (problem) {
    setError(problem);
    focusField(problem.field);
    return;
  }

  setError(null);

  // No room could serve this type/date — shown before the write, refused by
  // the domain too, through the same function.
  const availability = reservationAvailabilityError(getState(), values, {
    current: editingId === null ? undefined : findEditing(),
  });
  if (availability) {
    setError(availability);
    focusField(availability.field);
    return;
  }

  if (editingId === null) {
    const before = getState();
    const after = addReservation(before, values);
    if (after === before) {
      setError({ field: "rooms", message: "This reservation could not be saved." });
      return;
    }
    // A filter-originated booking clears its search only now, with the write
    // already known to be valid. The store repaint then draws the normal view.
    beforeSave?.();
    update(() => after);
    announce(`Reservation saved for ${values.hostName}.`);
  } else {
    const id = editingId;
    const before = getState();
    const after = updateReservation(before, id, values);
    if (after === before) {
      setError({ field: "rooms", message: "This reservation could not be saved." });
      return;
    }
    update(() => after);
    announce(`Reservation updated for ${values.hostName}.`);
  }

  dialog.close();
});

editCancelButton.addEventListener("click", () => dialog.close());

checkinButton.addEventListener("click", () => {
  if (readOnly()) return;

  clearCheckinError();

  const values = readValues();
  const before = getState();
  const currentReservation = editingId === null ? undefined : findEditing();
  const problem = reservationError(values, undefined, {
    // An unchanged date may sit inside the straddling no-show window.
    currentDate: currentReservation?.arrivalDate,
  });
  if (problem) {
    setError(problem);
    focusField(problem.field);
    return;
  }

  if (!isArrivingNow({ arrivalDate: values.arrivalDate })) {
    // The 04:00 cutoff passed with the sheet open.
    checkinError.textContent = "The arrival window has passed.";
    checkinError.hidden = false;
    return;
  }

  const availability = reservationAvailabilityError(before, values, {
    current: currentReservation,
  });
  if (availability) {
    setError(availability);
    focusField(availability.field);
    return;
  }

  setError(null);

  // Build the save in a draft so a refused check-in writes nothing: the form
  // stays exactly as the desk left it and no half-saved booking appears.
  const now = new Date();
  let draft;
  let id = editingId;

  if (editingId === null) {
    draft = addReservation(before, values, now);
    const known = new Set((before.reservations ?? []).map((r) => r.id));
    id = (draft.reservations ?? []).find((r) => !known.has(r.id))?.id ?? null;
  } else {
    draft = updateReservation(before, editingId, values, now);
  }

  if (draft === before || id === null) {
    checkinError.textContent = "This reservation could not be saved.";
    checkinError.hidden = false;
    return;
  }

  const reservation = (draft.reservations ?? []).find(
    (candidate) => candidate.id === id,
  );
  if (!reservation) {
    checkinError.textContent = "This reservation could not be saved.";
    checkinError.hidden = false;
    return;
  }

  // Which rooms hold this booking in the draft — the domain re-derives them,
  // this is only to pick the right message when something is in the way.
  const needed = reservationRoomTotal(reservation);
  const roomIds = arrivingRoomIds(draft, id, now);

  if (roomIds.length < needed) {
    checkinError.textContent =
      needed === 1
        ? "No free room for this reservation right now."
        : `Only ${roomIds.length} of ${needed} rooms are free right now.`;
    checkinError.hidden = false;
    return;
  }

  const conflict = occupancyConflictForRooms(
    draft,
    roomIds,
    reservation.days,
    now,
    { exceptId: id },
  );
  if (conflict) {
    checkinError.textContent =
      `That stay overlaps ${conflict.hostName}'s arrival on ` +
      `${formatDate(conflict.arrivalDate)}.`;
    checkinError.hidden = false;
    return;
  }

  const after = checkInReservation(draft, id, now);

  if (after === draft) {
    // Belt: the domain refused for one of its own reasons.
    checkinError.textContent = "Those rooms are not free right now.";
    checkinError.hidden = false;
    return;
  }

  beforeSave?.();
  update(() => after);
  announce(`Checked in ${reservation.hostName}.`);
  dialog.close();
});

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
  const reservation = findEditing();
  update((state) => removeReservation(state, id));
  announce(`Reservation for ${reservation?.hostName ?? "the guest"} cancelled.`);
  dialog.close();
});

dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());

// A click on the backdrop lands on the dialog element itself.
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

dialog.addEventListener("close", () => {
  const returnTo = editingId;
  const date = focusDate;
  const selector = focusSelector;
  editingId = null;
  beforeSave = null;
  focusDate = null;
  focusSelector = null;
  resetForm();

  // Saving repaints the list, so both the opener and the rows are new
  // elements by now and the browser's own restoration finds nothing. After a
  // cancel the row is gone entirely — fall back to the rows or Close in the
  // sheet still open underneath, then to the sheet opener, then to the day it
  // was booked for, then to today's cell (none of these exist when browsing
  // another month). Rows can also live inside a closed sheet, so only a
  // laid-out row is a valid focus target.
  const rowCandidate =
    returnTo && document.querySelector(`.res-row[data-id="${returnTo}"]`);
  const row = rowCandidate?.getClientRects().length ? rowCandidate : null;
  const openDialog = document.querySelector("dialog[open]");
  const sheetFallback =
    openDialog?.querySelector(".res-row") ??
    openDialog?.querySelector("[data-close]") ??
    null;
  const returnTarget = selector ? document.querySelector(selector) : null;
  const target =
    row ??
    sheetFallback ??
    returnTarget ??
    document.querySelector(`.cal-cell[data-date="${date}"]`) ??
    document.querySelector(".cal-cell--today");
  target?.focus();
});

export function openReservationDialog(reservationId = null, options = {}) {
  if (dialog.open) return;

  editingId = reservationId;
  if (editingId !== null && !findEditing()) {
    editingId = null;
    return;
  }

  const readonly = readOnly();
  resetForm();
  focusDate = options.arrivalDate ?? findEditing()?.arrivalDate ?? null;
  focusSelector = options.focusSelector ?? null;
  beforeSave = options.beforeSave ?? null;

  // Calendar shortcut: start a booking for the night that was tapped. A past
  // date would be refused by the validator anyway — min already says no.
  if (editingId === null) {
    if (options.arrivalDate && options.arrivalDate >= dateInput.min) {
      dateInput.value = options.arrivalDate;
    }
    if (options.roomCounts) {
      setRoomCounts(reservationRoomCounts({ roomCounts: options.roomCounts }));
    }
    const days = Number(options.days);
    if (Number.isInteger(days) && days >= STAY_MIN_DAYS && days <= STAY_MAX_DAYS) {
      daysInput.value = String(days);
    }
  } else if (!readonly) {
    prefill();
  }

  syncAvailabilityHints();
  addButton.disabled = chosenRoomTotal(roomCountsFromForm()) === 0;
  syncArrivalActions();
  dialog.showModal();
  if (editingId === null) {
    nameInput.focus();
  } else if (!readonly) {
    if (!checkinBlock.hidden) {
      // The host is standing at the desk: the sheet's first action is the one
      // they came for.
      checkinButton.focus();
    } else {
      // The counts are the first editable part of the stay.
      roomCountInputs()[0]?.focus();
    }
  }
  // Read-only leaves the browser's own focus on the header Close button.
}

document.body.append(dialog);
