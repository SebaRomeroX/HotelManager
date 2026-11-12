import { getState } from "../store.js";
import { groupReservations } from "../reservations.js";
import { openIncomingDialog } from "./incoming-dialog.js";
import { openRegisterDialog } from "./register-dialog.js";
import { renderCalendar } from "./calendar.js";

// The planning half of the single screen: availability plus the two sheets
// that hold every pending booking and all history.
export function renderReservationsPanel() {
  const section = document.createElement("section");
  section.className = "stack reservations-panel";
  section.setAttribute("aria-labelledby", "reservations-title");

  const heading = document.createElement("h3");
  heading.className = "section-title";
  heading.id = "reservations-title";
  heading.textContent = "Reservations";

  const state = getState();
  const rooms = state.rooms ?? [];
  const groups = groupReservations(state.reservations ?? []);
  const pending = groups.today.length + groups.incoming.length;
  const history = (state.register ?? []).length;

  section.append(heading, renderCalendar());
  if (pending === 0) {
    section.append(noPending(rooms.length > 0, history > 0));
  }

  // Every pending booking and all history fold into sheets, so the screen
  // answers "who is arriving?" without a list that grows with the calendar.
  const actions = document.createElement("div");
  actions.className = "list-actions";
  actions.append(incomingButton(pending), registerButton(history));
  section.append(actions);
  return section;
}

function incomingButton(count) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn--block";
  button.dataset.incoming = "";
  button.setAttribute("aria-haspopup", "dialog");
  button.textContent = `Incoming (${count})`;
  button.addEventListener("click", () => openIncomingDialog());
  return button;
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

function noPending(hasRooms, hasHistory) {
  const empty = document.createElement("p");
  empty.className = "empty";
  if (hasHistory) {
    empty.textContent = "No pending reservations.";
  } else if (hasRooms) {
    empty.textContent = "No reservations yet — tap a day above to book.";
  } else {
    empty.textContent = "No reservations yet.";
  }
  return empty;
}
