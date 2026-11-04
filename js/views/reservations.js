import { getState } from "../store.js";
import {
  groupReservations,
  isPastReservation,
  relativeDayLabel,
  reservationMeta,
} from "../reservations.js";
import { openReservationDialog } from "../components/reservation-dialog.js";

export const title = "Reservations";

const GROUPS = [
  ["Today", "today"],
  ["Incoming", "incoming"],
  ["Past", "past"],
];

export function render() {
  const section = document.createElement("section");
  section.className = "stack";

  const heading = document.createElement("h2");
  heading.className = "view__title";
  heading.textContent = title;

  const create = document.createElement("button");
  create.type = "button";
  create.className = "btn btn--primary btn--block";
  create.textContent = "New reservation";
  create.dataset.newReservation = "";
  create.setAttribute("aria-haspopup", "dialog");
  create.addEventListener("click", () => openReservationDialog());

  const groups = groupReservations(getState().reservations ?? []);
  const total = GROUPS.reduce((count, [, key]) => count + groups[key].length, 0);

  section.append(heading, create);
  if (total === 0) {
    section.append(noReservations());
  } else {
    section.append(...GROUPS.map(([label, key]) => group(groups[key], label)).filter(Boolean));
  }
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

function noReservations() {
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = "No reservations yet.";
  return empty;
}
