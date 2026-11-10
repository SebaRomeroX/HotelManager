import { getState } from "../store.js";
import { sortRooms } from "../rooms.js";
import { arrivingAssignment } from "../reservations.js";
import { openRoomsDialog } from "./rooms-dialog.js";
import { roomCardGrid } from "./room-card.js";

// The operational half of the single screen: the rooms that need attention as
// tappable cards, with today's arriving booking painted over its real state.
// Vacant rooms are hidden here because the today sheet is the full inventory.
export function renderRoomGrid() {
  const section = document.createElement("section");
  section.className = "stack";
  section.setAttribute("aria-labelledby", "rooms-title");

  const head = document.createElement("div");
  head.className = "section-head";

  const heading = document.createElement("h3");
  heading.className = "section-title";
  heading.id = "rooms-title";
  heading.textContent = "Rooms";

  const manage = document.createElement("button");
  manage.type = "button";
  manage.className = "btn";
  manage.textContent = "Manage";
  manage.setAttribute("aria-haspopup", "dialog");
  manage.setAttribute("aria-label", "Manage rooms");
  manage.addEventListener("click", () => openRoomsDialog());

  head.append(heading, manage);

  // Derived, never stored: a held room keeps its real state underneath and
  // the marker follows the reservation wherever the free rooms move.
  const state = getState();
  const held = arrivingAssignment(state);
  const rooms = sortRooms(state.rooms);
  // A held room is vacant underneath but operationally active, so it stays.
  const active = rooms.filter(
    (room) => room.state !== "vacant" || held.has(room.id),
  );

  section.append(head, gridContent(rooms.length, active, held));
  return section;
}

function gridContent(total, active, held) {
  if (total === 0) return noRooms();
  if (active.length === 0) return allVacant();
  return roomCardGrid(active, held);
}

function noRooms() {
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = "No rooms yet.";
  return empty;
}

function allVacant() {
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent =
    "All rooms are vacant — tap today's date in the calendar.";
  return empty;
}
