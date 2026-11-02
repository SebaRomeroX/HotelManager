import { getState } from "../store.js";
import { DEFAULT_STATE, stateLabel, typeLabel } from "../rooms.js";
import { openRoomsDialog } from "../components/rooms-dialog.js";
import { openStateDialog } from "../components/state-dialog.js";

export const title = "Rooms";

export function render() {
  const section = document.createElement("section");
  section.className = "stack";

  const heading = document.createElement("h2");
  heading.className = "view__title";
  heading.textContent = title;

  const manage = document.createElement("button");
  manage.type = "button";
  manage.className = "btn btn--primary btn--block";
  manage.textContent = "Manage Rooms";
  manage.setAttribute("aria-haspopup", "dialog");
  manage.addEventListener("click", () => openRoomsDialog());

  const { rooms } = getState();

  section.append(heading, manage, rooms.length ? cardGrid(rooms) : noRooms());
  return section;
}

function cardGrid(rooms) {
  const grid = document.createElement("div");
  grid.className = "card-grid";
  grid.append(...rooms.map(roomCard));
  return grid;
}

function roomCard(room) {
  // Headings are not valid inside a button, so the card's name is a span; the
  // accessible name is set explicitly below.
  const card = document.createElement("button");
  card.type = "button";
  card.className = `card card--${room.state ?? DEFAULT_STATE}`;
  card.dataset.id = room.id;
  card.setAttribute(
    "aria-label",
    `${room.name}, ${typeLabel(room.type)}, ${stateLabel(room.state)} — set state`,
  );
  card.addEventListener("click", () => openStateDialog(room.id));

  const name = document.createElement("span");
  name.className = "card__name";
  name.textContent = room.name;

  const type = document.createElement("span");
  type.className = "card__type";
  type.textContent = typeLabel(room.type);

  const state = document.createElement("span");
  state.className = "card__state";

  const dot = document.createElement("span");
  dot.className = "state-dot";

  const label = document.createElement("span");
  label.textContent = stateLabel(room.state);

  state.append(dot, label);
  card.append(name, type, state);
  return card;
}

function noRooms() {
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = "No rooms yet.";
  return empty;
}
