import {
  isPastReservation,
  relativeDayLabel,
  reservationMeta,
} from "../reservations.js";

// One row shape for the live list and the Incoming sheet, so host, stay and
// day label can never drift between the two places a booking appears.
export function reservationRow(reservation, onOpen) {
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
  button.addEventListener("click", () => onOpen(reservation));

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
