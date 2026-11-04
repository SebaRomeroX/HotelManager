import { getState } from "../store.js";
import { typeLabel } from "../rooms.js";
import {
  checkoutDate,
  formatDate,
  relativeDayLabel,
  sortReservations,
} from "../reservations.js";
import { openReservationDialog } from "../components/reservation-dialog.js";

export const title = "Reservations";

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

  const reservations = sortReservations(getState().reservations ?? []);

  section.append(heading, create, reservations.length ? list(reservations) : noReservations());
  return section;
}

function list(reservations) {
  const ul = document.createElement("ul");
  ul.className = "res-list";
  ul.append(...reservations.map(row));
  return ul;
}

function row(reservation) {
  const item = document.createElement("li");

  const checkout = checkoutDate(reservation.arrivalDate, reservation.days);
  const range = `${formatDate(reservation.arrivalDate)} → ${formatDate(checkout)}`;
  const days = `${reservation.days} ${reservation.days === 1 ? "day" : "days"}`;
  const dayLabel = relativeDayLabel(reservation.arrivalDate);

  // Headings are not valid inside a button, so the name is a span; the
  // accessible name is set explicitly below — same pattern as room cards.
  const button = document.createElement("button");
  button.type = "button";
  button.className = "res-row";
  button.dataset.id = reservation.id;
  button.setAttribute(
    "aria-label",
    `${reservation.hostName}, ${typeLabel(reservation.roomType)}, ${range}, ${days}, ${dayLabel} — edit`,
  );
  button.addEventListener("click", () => openReservationDialog(reservation.id));

  const main = document.createElement("span");
  main.className = "res-row__main";

  const name = document.createElement("span");
  name.className = "res-row__name";
  name.textContent = reservation.hostName;

  const meta = document.createElement("span");
  meta.className = "res-row__meta";
  meta.textContent = `${typeLabel(reservation.roomType)} · ${range} · ${days}`;

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
