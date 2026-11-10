import { getState, subscribe } from "../store.js";
import { sortRooms, typeLabel } from "../rooms.js";
import {
  arrivingAssignment,
  availabilityOn,
  formatDate,
  parseDate,
} from "../reservations.js";
import { roomCardGrid } from "./room-card.js";
import { openReservationDialog } from "./reservation-dialog.js";

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];

const dialog = document.createElement("dialog");
dialog.className = "dialog";
dialog.setAttribute("aria-labelledby", "availability-dialog-title");

dialog.innerHTML = `
  <header class="dialog__header">
    <h2 class="dialog__title" id="availability-dialog-title" data-title></h2>
    <button class="btn" type="button" data-close>Close</button>
  </header>

  <div class="dialog__body">
    <p class="hint" data-summary></p>
    <div data-body></div>
    <button class="btn btn--primary btn--block" type="button" data-book>
      New reservation
    </button>
  </div>
`;

const title = dialog.querySelector("[data-title]");
const summary = dialog.querySelector("[data-summary]");
const body = dialog.querySelector("[data-body]");
const bookButton = dialog.querySelector("[data-book]");

// The date this sheet is showing — transient UI, not store state.
let isoDate = null;
// Which cell opened the sheet, so focus can land back on it after a repaint.
let lastCellDate = null;

function todayISO() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function refresh() {
  if (isoDate === null) return;

  const date = parseDate(isoDate);
  if (!date) return;

  const today = isoDate === todayISO();
  const state = getState();
  const { free, total, byType } = availabilityOn(state, isoDate);

  title.textContent = today
    ? `Today · ${formatDate(isoDate)}`
    : `${WEEKDAYS[date.getDay()]}, ${formatDate(isoDate)}`;
  summary.textContent = `${free} of ${total} rooms free`;

  // Today is the full room inventory: the main grid hides vacant rooms, so
  // this is where the desk finds and changes them. Other dates stay a
  // per-type availability breakdown.
  if (today) {
    const rooms = sortRooms(state.rooms ?? []);
    body.replaceChildren(
      rooms.length
        ? roomCardGrid(rooms, arrivingAssignment(state))
        : noRooms(),
    );
  } else {
    const list = document.createElement("ul");
    list.className = "avail-list";
    // Types nobody owns are noise in a breakdown of a night's inventory.
    list.append(
      ...byType
        .filter((entry) => entry.total > 0)
        .map((entry) => {
          const item = document.createElement("li");
          item.className = "avail-row";
          item.textContent =
            `${typeLabel(entry.type)} · ${entry.free} of ${entry.total} free`;
          return item;
        }),
    );
    body.replaceChildren(list);
  }

  // A past night cannot be booked; the reservation sheet would refuse it.
  bookButton.hidden = isoDate < todayISO();
}

function noRooms() {
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = "No rooms yet.";
  return empty;
}

bookButton.addEventListener("click", () => {
  const date = isoDate;
  // Focus belongs to the reservation sheet we are about to open, not back
  // on the calendar cell behind it.
  lastCellDate = null;
  dialog.close();
  if (date !== null) openReservationDialog(null, { arrivalDate: date });
});

dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());

// A click on the backdrop lands on the dialog element itself.
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

dialog.addEventListener("close", () => {
  isoDate = null;
  // Saving repaints the view, so the cell that opened this sheet is a new
  // element by now and the browser's own restoration finds nothing.
  const date = lastCellDate;
  lastCellDate = null;
  document.querySelector(`.cal-cell[data-date="${date}"]`)?.focus();
});

export function openAvailabilityDialog(dateISO, opener = null) {
  if (dialog.open) return;

  isoDate = dateISO;
  lastCellDate = opener?.dataset?.date ?? dateISO;
  refresh();
  dialog.showModal();
}

document.body.append(dialog);
// State can change while the sheet is open (a tick flips a room): keep the
// breakdown honest without any manual re-render wiring in the view.
subscribe(refresh);
