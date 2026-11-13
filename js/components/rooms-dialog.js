import { getState, subscribe, update } from "../store.js";
import {
  ROOM_NAME_MAX,
  ROOM_TYPES,
  addRoom,
  hasRoomNamed,
  nextRoomName,
  removeRoom,
  sortRooms,
  typeLabel,
  updateRoom,
} from "../rooms.js";
import { formatDate, roomRemovalConflict } from "../reservations.js";
import { announce } from "./announcer.js";

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

      <p class="hint" data-mode hidden></p>

      <p class="error" id="room-error" role="alert" hidden></p>

      <button class="btn btn--primary btn--block" type="submit" disabled>
        Add room
      </button>

      <div class="form__actions" data-actions hidden>
        <button class="btn" type="button" data-cancel>Cancel</button>
        <button class="btn btn--danger" type="button" data-delete>Delete</button>
      </div>
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
const cancelButton = dialog.querySelector("[data-cancel]");
const deleteButton = dialog.querySelector("[data-delete]");
const actions = dialog.querySelector("[data-actions]");
const modeHint = dialog.querySelector("[data-mode]");
const countLabel = dialog.querySelector("[data-count]");
const chipList = dialog.querySelector("[data-chips]");

// Edit state is transient UI, so it stays here instead of going in the store.
let editingId = null;
let confirmingDelete = false;

function setError(message, { invalid = true } = {}) {
  nameInput.removeAttribute("aria-invalid");
  nameInput.removeAttribute("aria-describedby");

  if (!message) {
    errorText.hidden = true;
    errorText.textContent = "";
    return;
  }

  errorText.textContent = message;
  errorText.hidden = false;

  if (invalid) {
    nameInput.setAttribute("aria-invalid", "true");
    nameInput.setAttribute("aria-describedby", "room-error");
  }
}

function syncSubmitState() {
  addButton.disabled = form.elements.roomType.value === "";
}

function resetDeleteConfirm() {
  confirmingDelete = false;
  deleteButton.textContent = "Delete";
  deleteButton.classList.remove("btn--armed");
}

function syncMode() {
  const editing = editingId !== null;

  addButton.textContent = editing ? "Save changes" : "Add room";
  actions.hidden = !editing;
  modeHint.hidden = !editing;

  if (editing) {
    const room = getState().rooms.find((candidate) => candidate.id === editingId);
    modeHint.textContent = room ? `Editing ${room.name}` : "";
  }

  resetDeleteConfirm();
}

function resetForm() {
  form.reset();
  setError("");
  nameInput.value = nextRoomName(getState().rooms);
  syncSubmitState();
  syncMode();
  nameInput.focus();
  nameInput.select();
}

function enterEdit(room) {
  editingId = room.id;
  form.reset();
  setError("");

  nameInput.value = room.name;
  const radio = form.querySelector(
    `input[name="roomType"][value="${room.type}"]`,
  );
  if (radio) radio.checked = true;

  syncSubmitState();
  syncMode();
  form.scrollIntoView({ block: "start" });
  nameInput.focus();
  nameInput.select();
}

function validate() {
  const name = nameInput.value.trim();
  const type = form.elements.roomType.value;

  if (!name) {
    setError("Give the room a name.");
    nameInput.focus();
    return null;
  }

  if (!type) {
    setError("Choose a room type.");
    return null;
  }

  // exceptId: renaming a room to its own name is not a duplicate.
  if (hasRoomNamed(getState().rooms, name, editingId)) {
    setError(`There is already a room called ${name}.`);
    nameInput.focus();
    return null;
  }

  setError("");
  return { name, type };
}

function roomChip(room) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip";
  chip.dataset.id = room.id;
  chip.setAttribute("aria-label", `Edit ${room.name}, ${typeLabel(room.type)}`);

  const name = document.createElement("span");
  name.textContent = room.name;

  const type = document.createElement("span");
  type.className = "chip__type";
  type.textContent = typeLabel(room.type);

  chip.append(name, type);
  return chip;
}

function renderChips() {
  const rooms = sortRooms(getState().rooms);

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

  const values = validate();
  if (!values) return;

  if (editingId === null) {
    update((state) => addRoom(state, values));
    announce(`${values.name} added.`);
  } else {
    update((state) => updateRoom(state, editingId, values));
    announce(`${values.name} saved.`);
    editingId = null;
  }

  resetForm();
});

chipList.addEventListener("click", (event) => {
  const chip = event.target.closest("button.chip");
  if (!chip) return;

  const room = getState().rooms.find((candidate) => candidate.id === chip.dataset.id);
  if (room) enterEdit(room);
});

cancelButton.addEventListener("click", () => {
  editingId = null;
  resetForm();
});

deleteButton.addEventListener("click", () => {
  if (editingId === null) return;

  const room = getState().rooms.find((candidate) => candidate.id === editingId);
  if (!room) return;

  if (!confirmingDelete) {
    confirmingDelete = true;
    deleteButton.textContent = "Confirm delete";
    deleteButton.classList.add("btn--armed");
    deleteButton.focus();
    return;
  }

  // Deleting the room can strand a pending booking that was sold against it.
  // The guard names the booking and the first night it would no longer fit.
  const conflict = roomRemovalConflict(getState(), editingId);
  if (conflict) {
    const { reservation, roomType, isoDate } = conflict;
    setError(
      `Cannot delete ${room.name}. ${reservation.hostName} still needs a ` +
        `${typeLabel(roomType)} room on ${formatDate(isoDate)}.`,
      { invalid: false },
    );
    resetDeleteConfirm();
    return;
  }

  const id = editingId;
  update((state) => removeRoom(state, id));
  announce(`${room.name} deleted.`);
  editingId = null;
  resetForm();
});

dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());

// A click on the backdrop lands on the dialog element itself.
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

export function openRoomsDialog() {
  if (dialog.open) return;
  editingId = null;
  dialog.showModal();
  resetForm();
}

document.body.append(dialog);
subscribe(renderChips);
renderChips();
