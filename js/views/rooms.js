import { getState } from "../store.js";
import { typeLabel } from "../rooms.js";
import { openRoomsDialog } from "../components/rooms-dialog.js";

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
  const card = document.createElement("article");
  card.className = "card";

  const name = document.createElement("h3");
  name.className = "card__name";
  name.textContent = room.name;

  const type = document.createElement("p");
  type.className = "card__type";
  type.textContent = typeLabel(room.type);

  card.append(name, type);
  return card;
}

function noRooms() {
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = "No rooms yet.";
  return empty;
}
