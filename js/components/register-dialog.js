import { getState, subscribe, update } from "../store.js";
import { STAY_MAX_DAYS, STAY_MIN_DAYS } from "../rooms.js";
import {
  REGISTER_FILTERS,
  REGISTER_PRUNE_DAYS,
  checkOutRegisterEntry,
  checkedInStayDaysError,
  clearRegisterHistory,
  filterRegisterEntries,
  isOpenRegisterEntry,
  pruneRegister,
  prunableRegisterEntries,
  registerCounts,
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

    <div class="register-filter" data-filters role="group" aria-label="Filter register" hidden></div>

    <ul class="register-list" data-list></ul>

    <p class="empty" data-empty hidden>Register is empty.</p>

    <div class="register-clear" data-clear-wrap hidden>
      <button class="btn btn--danger btn--block" type="button" data-prune hidden>
        Clear old
      </button>
      <button class="btn btn--danger btn--block" type="button" data-clear>
        Clear history
      </button>
    </div>
  </div>
`;

const closeButton = dialog.querySelector("[data-close]");
const summary = dialog.querySelector("[data-summary]");
const filters = dialog.querySelector("[data-filters]");
const list = dialog.querySelector("[data-list]");
const empty = dialog.querySelector("[data-empty]");
const clearWrap = dialog.querySelector("[data-clear-wrap]");
const pruneButton = dialog.querySelector("[data-prune]");
const clearButton = dialog.querySelector("[data-clear]");

// Four chips at 360px wrap onto a second row, so they only appear once the
// list stops fitting one comfortable scan. The active filter keeps them
// visible after a prune shrinks the list, so it can always be cleared.
const FILTER_THRESHOLD = 8;

// Only one thing can be armed at a time. All confirmations are transient UI,
// so they live here rather than in the store.
let armedId = null;
let armedClear = false;
let armedPrune = false;
let armedCheckoutId = null;
// "all" or one of REGISTER_FILTERS' stored statuses.
let activeFilter = "all";
// The checked-in entry whose duration form is open, if any.
let editingDaysId = null;
// What the user has typed. Null means "not touched yet", so an unrelated
// repaint re-seeds from the record but never wipes a draft.
let daysDraft = null;
// The control to focus after the list is rebuilt. Set just before a render
// that removes the control the user pressed, so focus never drops to <body>.
let pendingFocus = null;

// Announced filter names read naturally in a sentence; the visible labels stay
// title-cased for the chips and the status badges.
const FILTER_ANNOUNCE = {
  all: "all",
  checked_in: "checked-in",
  cancelled: "cancelled",
  no_show: "no-show",
};

// The chips are built once and updated in place, so a repaint never steals
// focus from the filter the user just pressed.
const filterButtons = new Map();
for (const { value, label } of REGISTER_FILTERS) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "register-filter__option";
  button.dataset.filter = value;

  const name = document.createElement("span");
  name.textContent = label;

  const count = document.createElement("span");
  count.className = "register-filter__count";

  button.append(name, count);
  button.addEventListener("click", () => {
    if (activeFilter === value) return;

    activeFilter = value;
    armedId = null;
    armedClear = false;
    armedPrune = false;
    armedCheckoutId = null;
    editingDaysId = null;
    daysDraft = null;
    render();

    const all = sortRegister(getState().register ?? []);
    const shown = filterRegisterEntries(all, value).length;
    announce(
      value === "all"
        ? `Showing all ${all.length} ${all.length === 1 ? "entry" : "entries"}.`
        : `Showing ${shown} ${FILTER_ANNOUNCE[value]} ${shown === 1 ? "entry" : "entries"}.`,
    );
  });

  filterButtons.set(value, { button, count });
  filters.append(button);
}

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
  } else if (request.kind === "prune") {
    // The button removes itself once nothing is old enough; fall back to the
    // clear button, then Close.
    if (!pruneButton.hidden) pruneButton.focus();
    else (clearWrap.hidden ? closeButton : clearButton).focus();
  } else if (request.kind === "clear") {
    (clearButton.hidden ? closeButton : clearButton).focus();
  } else {
    closeButton.focus();
  }
}

function render() {
  const state = getState();
  const all = sortRegister(state.register ?? []);
  const total = all.length;
  const counts = registerCounts(all);
  const entries = filterRegisterEntries(all, activeFilter);
  const prunable = prunableRegisterEntries(state);
  // Live stays are never cleared or deleted: the register entry is the only
  // handle on the guest while the rooms are still occupied.
  const openCount = all.filter(isOpenRegisterEntry).length;
  const closedCount = total - openCount;

  // A record can disappear under the sheet (another tab, or a clear elsewhere);
  // never leave an arm or an open editor pointing at something that is gone.
  if (armedId && !all.some((entry) => entry.id === armedId)) {
    armedId = null;
  }
  if (armedCheckoutId) {
    const checkout = all.find((entry) => entry.id === armedCheckoutId);
    if (!checkout || checkout.status !== "checked_in" || checkout.checkedOutAt) {
      armedCheckoutId = null;
    }
  }
  if (editingDaysId) {
    const editing = all.find((entry) => entry.id === editingDaysId);
    if (!editing || editing.status !== "checked_in" || editing.checkedOutAt) {
      editingDaysId = null;
      daysDraft = null;
    }
  }
  if (closedCount === 0) {
    armedClear = false;
    armedPrune = false;
  }
  if (armedPrune && prunable.length === 0) armedPrune = false;

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

  summary.textContent =
    activeFilter === "all"
      ? `${total} ${total === 1 ? "entry" : "entries"}`
      : `${entries.length} of ${total} entries`;
  summary.hidden = total === 0;

  const showFilters =
    total > 0 && (total > FILTER_THRESHOLD || activeFilter !== "all");
  filters.hidden = !showFilters;
  for (const [value, { button, count }] of filterButtons) {
    button.setAttribute("aria-pressed", String(value === activeFilter));
    count.textContent = String(counts[value]);
  }

  list.hidden = entries.length === 0;
  empty.hidden = entries.length > 0;
  empty.textContent =
    total === 0 ? "Register is empty." : "No entries match this filter.";
  clearWrap.hidden = closedCount === 0;

  pruneButton.hidden = prunable.length === 0;
  pruneButton.textContent = armedPrune
    ? `Confirm clear ${prunable.length} old`
    : `Clear old (${prunable.length})`;
  pruneButton.setAttribute(
    "aria-label",
    armedPrune
      ? `Confirm clearing ${prunable.length} old ${prunable.length === 1 ? "entry" : "entries"}`
      : `Clear ${prunable.length} finished ${prunable.length === 1 ? "entry" : "entries"} older than ${REGISTER_PRUNE_DAYS} days`,
  );
  pruneButton.classList.toggle("btn--armed", armedPrune);

  clearButton.textContent = armedClear ? "Confirm clear" : "Clear history";
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

    // Checking out frees every room and stamps the close time, and it cannot
    // be undone, so it arms like the other destructive actions: the first tap
    // asks, the second commits.
    const checkoutArmed = armedCheckoutId === entry.id;
    const checkOut = document.createElement("button");
    checkOut.type = "button";
    checkOut.className = "btn register-entry__checkout";
    checkOut.classList.toggle("btn--danger", checkoutArmed);
    checkOut.classList.toggle("btn--armed", checkoutArmed);
    checkOut.dataset.checkout = "";
    checkOut.dataset.id = entry.id;
    checkOut.textContent = checkoutArmed ? "Confirm check out" : "Check out";
    checkOut.setAttribute(
      "aria-label",
      checkoutArmed
        ? `Confirm checking out ${entry.hostName}`
        : `Check out ${entry.hostName}`,
    );
    checkOut.addEventListener("click", () => armOrCheckOut(entry.id));
    actions.append(checkOut);
  }

  // An open stay has no Delete: check out first, then retire the record. That
  // keeps the only handle on the guest from disappearing while the rooms are
  // still occupied.
  if (!isOpenRegisterEntry(entry)) actions.append(remove);
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
  armedCheckoutId = null;
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

function armOrCheckOut(id) {
  if (armedCheckoutId !== id) {
    armedCheckoutId = id;
    armedId = null;
    armedClear = false;
    armedPrune = false;
    editingDaysId = null;
    daysDraft = null;
    pendingFocus = { kind: "checkout", id };
    render();
    return;
  }

  checkOutEntry(id);
}

function checkOutEntry(id) {
  const entry = (getState().register ?? []).find(
    (candidate) => candidate.id === id,
  );
  if (!entry) return;

  armedCheckoutId = null;
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
    armedPrune = false;
    armedCheckoutId = null;
    pendingFocus = { kind: "delete", id };
    render();
    return;
  }

  // Remember the row's place among the rows that still have a Delete button:
  // open stays do not, and focus is index-based over the buttons.
  const index = filterRegisterEntries(
    sortRegister(getState().register ?? []),
    activeFilter,
  )
    .filter((entry) => !isOpenRegisterEntry(entry))
    .findIndex((entry) => entry.id === id);
  armedId = null;
  pendingFocus = { kind: "delete-index", index };
  update((state) => removeRegisterEntry(state, id));
}

clearButton.addEventListener("click", () => {
  if (!armedClear) {
    armedClear = true;
    armedId = null;
    armedPrune = false;
    armedCheckoutId = null;
    pendingFocus = { kind: "clear" };
    render();
    return;
  }

  const register = getState().register ?? [];
  const kept = register.filter(isOpenRegisterEntry).length;
  const removed = register.length - kept;
  armedClear = false;
  pendingFocus = { kind: "close" };
  if (removed === 0) {
    render();
    return;
  }

  update((state) => clearRegisterHistory(state));
  announce(
    kept === 0
      ? `Cleared ${removed} history ${removed === 1 ? "entry" : "entries"}.`
      : `Cleared ${removed} history ${removed === 1 ? "entry" : "entries"}. ` +
          `Kept ${kept} in-house ${kept === 1 ? "stay" : "stays"}.`,
  );
});

// "Clear old" is a second destructive bulk action with the same two-step
// guard. It only ever drops finished entries past the prune window; the
// candidates are recomputed at confirm time, so a stale count cannot delete
// something that changed while the button was armed.
pruneButton.addEventListener("click", () => {
  if (!armedPrune) {
    armedPrune = true;
    armedClear = false;
    armedId = null;
    armedCheckoutId = null;
    pendingFocus = { kind: "prune" };
    render();
    return;
  }

  const removed = prunableRegisterEntries(getState()).length;
  armedPrune = false;
  pendingFocus = { kind: "prune" };
  if (removed === 0) {
    render();
    return;
  }

  update((state) => pruneRegister(state));
  announce(
    `Removed ${removed} old ${removed === 1 ? "entry" : "entries"}.`,
  );
});

closeButton.addEventListener("click", () => dialog.close());

// A click on the backdrop lands on the dialog element itself.
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

dialog.addEventListener("close", () => {
  armedId = null;
  armedClear = false;
  armedPrune = false;
  armedCheckoutId = null;
  activeFilter = "all";
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
  armedPrune = false;
  armedCheckoutId = null;
  activeFilter = "all";
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
