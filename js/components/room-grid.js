import { getState } from "../store.js";
import {
  DEFAULT_STATE,
  roomStateText,
  sortRooms,
  typeLabel,
} from "../rooms.js";
import { arrivingAssignment } from "../reservations.js";
import { openRoomsDialog } from "./rooms-dialog.js";
import { openStateDialog } from "./state-dialog.js";

// The operational half of the single screen: every room as a tappable card,
// with today's arriving booking painted over its real state.
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

  section.append(head, rooms.length ? cardGrid(rooms, held) : noRooms());
  return section;
}

function cardGrid(rooms, held) {
  const grid = document.createElement("div");
  grid.className = "card-grid";
  grid.append(...rooms.map((room) => roomCard(room, held.get(room.id))));
  return grid;
}

function roomCard(room, arriving) {
  const stateText = arriving
    ? `Arriving - ${arriving.hostName}`
    : roomStateText(room);

  // Headings are not valid inside a button, so the card's name is a span; the
  // accessible name is set explicitly below.
  const card = document.createElement("button");
  card.type = "button";
  card.className =
    `card card--${room.state ?? DEFAULT_STATE}` +
    (arriving ? " card--arriving" : "");
  card.dataset.id = room.id;
  card.setAttribute(
    "aria-label",
    arriving
      ? `${room.name}, ${typeLabel(room.type)}, Arriving for ` +
          `${arriving.hostName} — check in`
      : `${room.name}, ${typeLabel(room.type)}, ${stateText} — set state`,
  );
  card.addEventListener("click", () => openStateDialog(room.id));

  const name = document.createElement("span");
  name.className = "card__name";
  name.textContent = room.name;

  const state = document.createElement("span");
  state.className = "card__state";

  const dot = document.createElement("span");
  dot.className = "state-dot";

  const label = document.createElement("span");
  label.textContent = stateText;

  state.append(dot, label);
  card.append(name, state);
  return card;
}

function noRooms() {
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = "No rooms yet.";
  return empty;
}
