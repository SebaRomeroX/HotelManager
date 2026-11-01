import { getState } from "../store.js";
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
  manage.addEventListener("click", openRoomsDialog);

  section.append(heading, manage, roomCount(getState().rooms));
  return section;
}

function roomCount(rooms) {
  const status = document.createElement("p");

  if (rooms.length === 0) {
    status.className = "empty";
    status.textContent = "No rooms yet.";
    return status;
  }

  status.className = "hint";
  status.textContent =
    rooms.length === 1 ? "1 room" : `${rooms.length} rooms`;
  return status;
}
