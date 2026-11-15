import { getState, subscribe, update } from "../store.js";
import { STAY_MAX_DAYS, STAY_MIN_DAYS } from "../rooms.js";
import {
  checkOutRegisterEntry,
  checkedInStayDaysError,
  clearRegister,
  registerStatusLabel,
  removeRegisterEntry,
  reservationMeta,
  sortRegister,
  updateCheckedInStayDays,
} from "../reservations.js";
import { announce } from "./announcer.js";
import { clearFormError, showFormError } from "./form-error.js";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const dialog = document.createElement("dialog");
dialog.className = "dialog";
dialog.setAttribute("aria-labelledby", "register-dialog-title");

dialog.innerHTML = `
  <header class="dialog__header">
    <h2 class="dialog__title" id="register-dialog-title">Register</h2>
    <button class="btn" type="button" data-close>Close</button>
  </header>

  <div class="dialog__body">
    <p class="hint" data-summary hidden></p>

    <ul class="register-list" data-list></ul>

    <p class="empty" data-empty hidden>Register is empty.</p>

    <div class="register-clear" data-clear-wrap hidden>
      <button class="btn btn--danger btn--block" type="button" data-clear>
        Clear register
      </button>
    </div>
  </div>
`;

const closeButton = dialog.querySelector("[data-close]");
const summary = dialog.querySelector("[data-summary]");
const list = dialog.querySelector("[data-list]");
const empty = dialog.querySelector("[data-empty]");
const clearWrap = dialog.querySelector("[data-clear-wrap]");
const clearButton = dialog.querySelector("[data-clear]");

// Only one thing can be armed at a time. Both confirmations are transient UI,
// so they live here rather than in the store.
let armedId = null;
let armedClear = false;
// The checked-in entry whose duration form is open, if any.
let editingDaysId = null;
// What the user has typed. Null means "not touched yet", so an unrelated
// repaint re-seeds from the record but never wipes a draft.
let daysDraft = null;
// The control to focus after the list is rebuilt. Set just before a render
// that removes the control the user pressed, so focus never drops to <body>.
let pendingFocus = null;

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const year =
    date.getFullYear() === new Date().getFullYear()
      ? ""
      : `, ${date.getFullYear()}`;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}${year}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function applyFocus() {
  if (!pendingFocus) return;

  const request = pendingFocus;
  pendingFocus = null;
  const deletes = [...list.querySelectorAll("[data-delete]")];

  if (request.kind === "delete") {
    (deletes.find((button) => button.dataset.id === request.id) ?? closeButton).focus();
  } else if (request.kind === "delete-index") {
    const target = deletes[request.index] ?? deletes[request.index - 1];
    (target ?? closeButton).focus();
  } else if (request.kind === "checkout") {
    // The action disappears once the entry is checked out, so fall back to
    // that row's Delete, then Close.
    const checkouts = [...list.querySelectorAll("[data-checkout]")];
    const target =
      checkouts.find((button) => button.dataset.id === request.id) ??
      deletes.find((button) => button.dataset.id === request.id) ??
      closeButton;
    target.focus();
  } else if (request.kind === "days") {
    const toggles = [...list.querySelectorAll("[data-days]")];
    (toggles.find((button) => button.dataset.id === request.id) ?? closeButton).focus();
  } else if (request.kind === "days-input") {
    const inputs = [...list.querySelectorAll("[data-days-input]")];
    const input = inputs.find((candidate) => candidate.dataset.id === request.id);
    input?.focus();
    input?.select();
  } else if (request.kind === "clear") {
    (clearButton.hidden ? closeButton : clearButton).focus();
  } else {
    closeButton.focus();
  }
}

function render() {
  const entries = sortRegister(getState().register ?? []);

  // A record can disappear under the sheet (another tab, or a clear elsewhere);
  // never leave an arm or an open editor pointing at something that is gone.
  if (armedId && !entries.some((entry) => entry.id === armedId)) {
    armedId = null;
  }
  if (editingDaysId) {
    const editing = entries.find((entry) => entry.id === editingDaysId);
    if (!editing || editing.status !== "checked_in" || editing.checkedOutAt) {
      editingDaysId = null;
      daysDraft = null;
    }
  }
  if (entries.length === 0) armedClear = false;

  // The list is rebuilt wholesale. Remember a focused row control so an
  // unrelated store render (a ticker step, another tab) does not strand the
  // user on <body>; explicit actions set pendingFocus themselves.
  const active = document.activeElement;
  const action =
    active && list.contains(active)
      ? active.closest("[data-delete], [data-checkout], [data-days]")
      : null;
  const editingFocus =
    !pendingFocus && editingDaysId && active && list.contains(active)
      ? { kind: "days-input", id: editingDaysId }
      : null;
  const retainedFocus =
    !pendingFocus && action
      ? {
          kind: action.hasAttribute("data-delete")
            ? "delete"
            : action.hasAttribute("data-checkout")
              ? "checkout"
              : "days",
          id: action.dataset.id,
        }
      : editingFocus;

  summary.textContent = `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;
  summary.hidden = entries.length === 0;
  list.hidden = entries.length === 0;
  empty.hidden = entries.length > 0;
  clearWrap.hidden = entries.length === 0;

  clearButton.textContent = armedClear ? "Confirm clear" : "Clear register";
  clearButton.classList.toggle("btn--armed", armedClear);

  if (retainedFocus) pendingFocus = retainedFocus;
  list.replaceChildren(...entries.map(entryRow));
  applyFocus();
}

function entryRow(entry) {
  const item = document.createElement("li");
  item.className = "register-entry";
  item.dataset.id = entry.id;

  const head = document.createElement("div");
  head.className = "register-entry__head";

  const name = document.createElement("span");
  name.className = "register-entry__name";
  name.textContent = entry.hostName;

  const status = document.createElement("span");
  status.className = `register-status register-status--${entry.status}`;
  status.textContent = registerStatusLabel(entry.status);

  head.append(name, status);

  const meta = document.createElement("p");
  meta.className = "register-entry__meta";
  meta.textContent = reservationMeta(entry);

  const when = document.createElement("p");
  when.className = "register-entry__when";
  when.textContent =
    `${registerStatusLabel(entry.status)} ${formatWhen(entry.registeredAt)}`.trim();

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn btn--danger register-entry__delete";
  remove.dataset.delete = "";
  remove.dataset.id = entry.id;
  remove.textContent = armedId === entry.id ? "Sure?" : "Delete";
  remove.classList.toggle("btn--armed", armedId === entry.id);
  remove.setAttribute(
    "aria-label",
    armedId === entry.id
      ? `Confirm delete ${entry.hostName}`
      : `Delete ${entry.hostName}`,
  );
  remove.addEventListener("click", () => armOrDelete(entry.id));

  item.append(head, meta);

  // Check-ins carry every room in the reservation. Migration-era entries used
  // one roomName; keep that fallback so old history still names its room.
  const assigned = Array.isArray(entry.assignedRooms)
    ? entry.assignedRooms
    : [];
  const names = assigned.map((room) => room.name).filter(Boolean);
  if (names.length > 0) {
    const room = document.createElement("p");
    room.className = "register-entry__room";
    room.textContent =
      `${names.length === 1 ? "Room" : "Rooms"}: ${names.join(", ")}`;
    item.append(room);
  } else if (entry.roomName) {
    const room = document.createElement("p");
    room.className = "register-entry__room";
    room.textContent = `Room: ${entry.roomName}`;
    item.append(room);
  }

  item.append(when);

  if (entry.checkedOutAt) {
    const out = document.createElement("p");
    out.className = "register-entry__when register-entry__checkout-time";
    out.textContent = `Checked out ${formatWhen(entry.checkedOutAt)}`.trim();
    item.append(out);
  }

  if (
    editingDaysId === entry.id &&
    entry.status === "checked_in" &&
    !entry.checkedOutAt
  ) {
    item.append(daysForm(entry));
    return item;
  }

  const actions = document.createElement("div");
  actions.className = "register-entry__actions";

  // The room may have auto-cleaned at 10:00, but the entry still closes here:
  // review the in-house list and release every room this stay started.
  if (entry.status === "checked_in" && !entry.checkedOutAt) {
    if (hasActiveStay(entry)) {
      const changeDays = document.createElement("button");
      changeDays.type = "button";
      changeDays.className = "btn register-entry__days-toggle";
      changeDays.dataset.days = "";
      changeDays.dataset.id = entry.id;
      changeDays.textContent = "Change days";
      changeDays.setAttribute(
        "aria-label",
        `Change the stay duration for ${entry.hostName}`,
      );
      changeDays.addEventListener("click", () => openDaysEditor(entry.id));
      actions.append(changeDays);
    }

    const checkOut = document.createElement("button");
    checkOut.type = "button";
    checkOut.className = "btn register-entry__checkout";
    checkOut.dataset.checkout = "";
    checkOut.dataset.id = entry.id;
    checkOut.textContent = "Check out";
    checkOut.setAttribute("aria-label", `Check out ${entry.hostName}`);
    checkOut.addEventListener("click", () => checkOutEntry(entry.id));
    actions.append(checkOut);
  }

  actions.append(remove);
  item.append(actions);
  return item;
}

// Only an in-house stay with a live room timer can take a new duration. The
// register record is the booking, but the rooms are what the timer drives.
function hasActiveStay(entry) {
  const assigned = new Set(
    (entry.assignedRooms ?? []).map(({ id }) => id),
  );

  return (getState().rooms ?? []).some(
    (room) =>
      assigned.has(room.id) &&
      room.state === "occupied" &&
      room.stayStartedAt === entry.registeredAt,
  );
}

function openDaysEditor(id) {
  editingDaysId = id;
  daysDraft = null;
  pendingFocus = { kind: "days-input", id };
  render();
}

function daysForm(entry) {
  const form = document.createElement("form");
  form.className = "register-entry__days";
  form.noValidate = true;
  form.dataset.daysForm = "";
  form.dataset.id = entry.id;

  const field = document.createElement("div");
  field.className = "field register-entry__days-field";

  const label = document.createElement("label");
  label.className = "field__label";
  label.htmlFor = `stay-days-${entry.id}`;
  label.textContent = "Days";

  const input = document.createElement("input");
  input.className = "input";
  input.id = label.htmlFor;
  input.type = "number";
  input.inputMode = "numeric";
  input.min = String(STAY_MIN_DAYS);
  input.max = String(STAY_MAX_DAYS);
  input.step = "1";
  input.value = daysDraft ?? String(entry.days);
  input.dataset.daysInput = "";
  input.dataset.id = entry.id;

  field.append(label, input);

  const save = document.createElement("button");
  save.type = "submit";
  save.className = "btn";
  save.dataset.daysSave = "";
  save.textContent = "Save";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn";
  cancel.dataset.daysCancel = "";
  cancel.textContent = "Cancel";

  const error = document.createElement("p");
  error.className = "error";
  error.dataset.daysError = "";
  error.setAttribute("role", "alert");
  error.hidden = true;

  input.addEventListener("input", () => {
    daysDraft = input.value;
    clearFormError(error);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const days = Number(input.value);
    const problem = checkedInStayDaysError(getState(), entry.id, days);
    if (problem) {
      showFormError(error, problem);
      input.focus();
      input.select();
      return;
    }

    editingDaysId = null;
    daysDraft = null;
    pendingFocus = { kind: "days", id: entry.id };
    update((state) => updateCheckedInStayDays(state, entry.id, days));
    announce(
      `Stay for ${entry.hostName} is now ${days} ${days === 1 ? "day" : "days"}.`,
    );
  });

  cancel.addEventListener("click", () => {
    editingDaysId = null;
    daysDraft = null;
    pendingFocus = { kind: "days", id: entry.id };
    render();
  });

  form.append(field, save, cancel, error);
  return form;
}

function checkOutEntry(id) {
  const entry = (getState().register ?? []).find(
    (candidate) => candidate.id === id,
  );
  if (!entry) return;

  // The row keeps its Delete button, so focus has somewhere to land after the
  // Check out action removes itself.
  pendingFocus = { kind: "checkout", id };
  update((state) => checkOutRegisterEntry(state, id));
  announce(`Checked out ${entry.hostName}.`);
}

function armOrDelete(id) {
  if (armedId !== id) {
    armedId = id;
    armedClear = false;
    pendingFocus = { kind: "delete", id };
    render();
    return;
  }

  // Remember the row's place: after it is gone focus should land on the next
  // entry, then the previous one, then Close.
  const index = sortRegister(getState().register ?? []).findIndex(
    (entry) => entry.id === id,
  );
  armedId = null;
  pendingFocus = { kind: "delete-index", index };
  update((state) => removeRegisterEntry(state, id));
}

clearButton.addEventListener("click", () => {
  if (!armedClear) {
    armedClear = true;
    armedId = null;
    pendingFocus = { kind: "clear" };
    render();
    return;
  }

  armedClear = false;
  pendingFocus = { kind: "close" };
  update((state) => clearRegister(state));
});

closeButton.addEventListener("click", () => dialog.close());

// A click on the backdrop lands on the dialog element itself.
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

dialog.addEventListener("close", () => {
  armedId = null;
  armedClear = false;
  editingDaysId = null;
  daysDraft = null;
  pendingFocus = null;
  // The view repainted whenever an entry was deleted, so the button that
  // opened the sheet is a new element; find it by role-ish marker.
  document.querySelector("[data-register]")?.focus();
});

export function openRegisterDialog() {
  if (dialog.open) return;

  armedId = null;
  armedClear = false;
  editingDaysId = null;
  daysDraft = null;
  pendingFocus = null;
  render();
  dialog.showModal();
  // Reading is the first job; Close is the safe way out.
  closeButton.focus();
}

document.body.append(dialog);
subscribe(render);
