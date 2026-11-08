import { getState, subscribe, update } from "../store.js";
import {
  clearRegister,
  registerStatusLabel,
  removeRegisterEntry,
  reservationMeta,
  sortRegister,
} from "../reservations.js";

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
  } else if (request.kind === "clear") {
    (clearButton.hidden ? closeButton : clearButton).focus();
  } else {
    closeButton.focus();
  }
}

function render() {
  // The list is rebuilt wholesale. Remember a focused row button so an
  // unrelated store render (a ticker step, another tab) does not strand the
  // user on <body>; explicit actions set pendingFocus themselves.
  const active = document.activeElement;
  const retainedFocus =
    !pendingFocus &&
    active &&
    list.contains(active) &&
    active.hasAttribute("data-delete")
      ? { kind: "delete", id: active.dataset.id }
      : null;

  const entries = sortRegister(getState().register ?? []);

  // A record can disappear under the sheet (another tab, or a clear elsewhere);
  // never leave an arm pointing at something that is gone.
  if (armedId && !entries.some((entry) => entry.id === armedId)) {
    armedId = null;
  }
  if (entries.length === 0) armedClear = false;

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

  // The room only exists for check-ins; migration-era entries never had one
  // linked, so they simply omit the line.
  if (entry.roomName) {
    const room = document.createElement("p");
    room.className = "register-entry__room";
    room.textContent = entry.roomName;
    item.append(room);
  }

  item.append(when, remove);
  return item;
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
  pendingFocus = null;
  // The view repainted whenever an entry was deleted, so the button that
  // opened the sheet is a new element; find it by role-ish marker.
  document.querySelector("[data-register]")?.focus();
});

export function openRegisterDialog() {
  if (dialog.open) return;

  armedId = null;
  armedClear = false;
  pendingFocus = null;
  render();
  dialog.showModal();
  // Reading is the first job; Close is the safe way out.
  closeButton.focus();
}

document.body.append(dialog);
subscribe(render);
