import { getState } from "../store.js";
import {
  groupReservations,
  isPastReservation,
  relativeDayLabel,
  reservationMeta,
} from "../reservations.js";
import { openReservationDialog } from "../components/reservation-dialog.js";
import { openRegisterDialog } from "../components/register-dialog.js";
import { renderCalendar } from "../components/calendar.js";

export const title = "Reservations";

const GROUPS = [
  ["Today", "today"],
  ["Incoming", "incoming"],
];

export function render() {
  const section = document.createElement("section");
  section.className = "stack";

  const heading = document.createElement("h2");
  heading.className = "view__title";
  heading.textContent = title;

  const state = getState();
  const rooms = state.rooms ?? [];
  const groups = groupReservations(state.reservations ?? []);
  const total = GROUPS.reduce((count, [, key]) => count + groups[key].length, 0);

  section.append(heading, renderCalendar());
  if (total === 0) {
    section.append(noReservations(rooms.length > 0));
  } else {
    section.append(...GROUPS.map(([label, key]) => group(groups[key], label)).filter(Boolean));
  }
  section.append(registerButton((state.register ?? []).length));
  return section;
}

// Empty groups vanish entirely rather than showing a heading over nothing.
function group(reservations, label) {
  if (reservations.length === 0) return null;

  const block = document.createElement("section");
  block.className = "res-group";

  const id = `res-group-${label.toLowerCase()}`;
  block.setAttribute("aria-labelledby", id);

  const heading = document.createElement("h3");
  heading.className = "res-group__title";
  heading.id = id;
  heading.textContent = label;

  const ul = document.createElement("ul");
  ul.className = "res-list";
  ul.append(...reservations.map(row));

  block.append(heading, ul);
  return block;
}

function row(reservation) {
  const item = document.createElement("li");
  const dayLabel = relativeDayLabel(reservation.arrivalDate);
  const past = isPastReservation(reservation);

  // Headings are not valid inside a button, so the name is a span; the
  // accessible name is set explicitly below — same pattern as room cards.
  const button = document.createElement("button");
  button.type = "button";
  button.className = "res-row";
  button.dataset.id = reservation.id;
  button.setAttribute(
    "aria-label",
    `${reservation.hostName}, ${reservationMeta(reservation)}, ` +
      `${dayLabel} — ${past ? "view" : "edit"}`,
  );
  button.addEventListener("click", () => openReservationDialog(reservation.id));

  const main = document.createElement("span");
  main.className = "res-row__main";

  const name = document.createElement("span");
  name.className = "res-row__name";
  name.textContent = reservation.hostName;

  const meta = document.createElement("span");
  meta.className = "res-row__meta";
  meta.textContent = reservationMeta(reservation);

  main.append(name, meta);

  const day = document.createElement("span");
  day.className = "res-row__day";
  day.textContent = dayLabel;

  button.append(main, day);
  item.append(button);
  return item;
}

// History sits below the live list, never mixed into it: the register is a
// place to look something up, not a section to scan with today's arrivals.
function registerButton(count) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn--block";
  button.dataset.register = "";
  button.setAttribute("aria-haspopup", "dialog");
  button.textContent = `Register (${count})`;
  button.addEventListener("click", () => openRegisterDialog());
  return button;
}

function noReservations(calendarVisible) {
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = calendarVisible
    ? "No reservations yet — tap a day above to book."
    : "No reservations yet.";
  return empty;
}
