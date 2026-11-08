import { getState } from "../store.js";
import { groupReservations } from "../reservations.js";
import { openIncomingDialog } from "../components/incoming-dialog.js";
import { openRegisterDialog } from "../components/register-dialog.js";
import { renderCalendar } from "../components/calendar.js";

export const title = "Reservations";

export function render() {
  const section = document.createElement("section");
  section.className = "stack";

  const heading = document.createElement("h2");
  heading.className = "view__title";
  heading.textContent = title;

  const state = getState();
  const rooms = state.rooms ?? [];
  const groups = groupReservations(state.reservations ?? []);
  const pending = groups.today.length + groups.incoming.length;
  const history = (state.register ?? []).length;

  section.append(heading, renderCalendar());
  if (pending === 0) {
    section.append(noPending(rooms.length > 0, history > 0));
  }

  // The page is the calendar; every pending booking and all history fold into
  // sheets below it, so the screen answers "who is arriving?" without a list
  // that grows with the calendar.
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
