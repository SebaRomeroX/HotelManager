import { getState, subscribe, update } from "../store.js";
import {
  ROOM_NAME_MAX,
  ROOM_TYPES,
  addRoom,
  hasRoomNamed,
  nextRoomName,
  typeLabel,
} from "../rooms.js";

const dialog = document.createElement("dialog");
dialog.className = "dialog";
dialog.setAttribute("aria-labelledby", "rooms-dialog-title");

dialog.innerHTML = `
  <header class="dialog__header">
    <h2 class="dialog__title" id="rooms-dialog-title">Manage Rooms</h2>
    <button class="btn" type="button" data-close>Close</button>
  </header>

  <div class="dialog__body">
    <form class="form" novalidate>
      <div class="field">
        <label class="field__label" for="room-name">Room name</label>
        <input
          class="input"
          id="room-name"
          name="roomName"
          type="text"
          maxlength="${ROOM_NAME_MAX}"
          autocomplete="off"
          required
        >
      </div>

      <fieldset class="field field--group">
        <legend class="field__label">Room type</legend>
        <div class="segmented">
          ${ROOM_TYPES.map(
            (type) => `
          <label class="segmented__option">
            <input type="radio" name="roomType" value="${type.value}" required>
            <span>${type.label}</span>
          </label>`,
          ).join("")}
        </div>
      </fieldset>

      <p class="error" id="room-error" role="alert" hidden></p>

      <button class="btn btn--primary btn--block" type="submit" disabled>
        Add room
      </button>
    </form>

    <section>
      <h3 class="dialog__subtitle" data-count></h3>
      <div class="chips" data-chips aria-live="polite"></div>
    </section>
  </div>
`;

const form = dialog.querySelector("form");
const nameInput = dialog.querySelector("#room-name");
const errorText = dialog.querySelector("#room-error");
const addButton = dialog.querySelector('button[type="submit"]');
const countLabel = dialog.querySelector("[data-count]");
const chipList = dialog.querySelector("[data-chips]");

function setError(message) {
  if (!message) {
    errorText.hidden = true;
    errorText.textContent = "";
    nameInput.removeAttribute("aria-invalid");
    nameInput.removeAttribute("aria-describedby");
    return;
  }

  errorText.textContent = message;
  errorText.hidden = false;
  nameInput.setAttribute("aria-invalid", "true");
  nameInput.setAttribute("aria-describedby", "room-error");
}

function syncSubmitState() {
  addButton.disabled = form.elements.roomType.value === "";
}

function resetForm() {
  form.reset();
  setError("");
  nameInput.value = nextRoomName(getState().rooms);
  syncSubmitState();
  nameInput.focus();
  nameInput.select();
}

function roomChip(room) {
  const chip = document.createElement("span");
  chip.className = "chip";

  const name = document.createElement("span");
  name.textContent = room.name;

  const type = document.createElement("span");
  type.className = "chip__type";
  type.textContent = typeLabel(room.type);

  chip.append(name, type);
  return chip;
}

function renderChips() {
  const { rooms } = getState();

  countLabel.textContent = rooms.length ? `Rooms (${rooms.length})` : "Rooms";

  if (rooms.length === 0) {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "No rooms yet.";
    chipList.replaceChildren(hint);
    return;
  }

  chipList.replaceChildren(...rooms.map(roomChip));
}

form.addEventListener("change", syncSubmitState);

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = nameInput.value.trim();
  const type = form.elements.roomType.value;

  if (!name) {
    setError("Give the room a name.");
    nameInput.focus();
    return;
  }

  if (!type) {
    setError("Choose a room type.");
    return;
  }

  if (hasRoomNamed(getState().rooms, name)) {
    setError(`There is already a room called ${name}.`);
    nameInput.focus();
    return;
  }

  setError("");
  update((state) => addRoom(state, { name, type }));
  resetForm();
});

dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());

// A click on the backdrop lands on the dialog element itself.
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

export function openRoomsDialog() {
  if (dialog.open) return;
  dialog.showModal();
  resetForm();
}

document.body.append(dialog);
subscribe(renderChips);
renderChips();
