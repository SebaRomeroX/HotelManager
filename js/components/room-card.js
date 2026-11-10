import { DEFAULT_STATE, stateLabel, typeLabel } from "../rooms.js";
import { openStateDialog } from "./state-dialog.js";

// One room, one tappable line: name left, state right. Shared by the main
// grid and the today sheet so the two can never show a room differently.
export function roomCard(room, arriving) {
  const stateText = arriving ? "Arriving" : stateLabel(room.state);

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
  card.addEventListener("click", () => openStateDialog(room.id, card));

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

export function roomCardGrid(rooms, held) {
  const grid = document.createElement("div");
  grid.className = "card-grid";
  grid.append(...rooms.map((room) => roomCard(room, held.get(room.id))));
  return grid;
}
