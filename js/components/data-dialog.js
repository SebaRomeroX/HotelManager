import {
  exportState,
  getStorageStatus,
  parseBackup,
  replaceState,
} from "../store.js";
import { datedFilename, downloadText } from "../download.js";

const dialog = document.createElement("dialog");
dialog.className = "dialog";
dialog.setAttribute("aria-labelledby", "data-dialog-title");

dialog.innerHTML = `
  <header class="dialog__header">
    <h2 class="dialog__title" id="data-dialog-title">Saved data</h2>
    <button class="btn" type="button" data-close>Close</button>
  </header>

  <div class="dialog__body">
    <section class="data-section">
      <h3 class="dialog__subtitle">Export</h3>
      <p class="hint">
        Download every room, booking and history entry as one JSON file.
        Keep it somewhere safe.
      </p>
      <button class="btn btn--block" type="button" data-export>
        Export data
      </button>
    </section>

    <section class="data-section">
      <h3 class="dialog__subtitle">Restore</h3>
      <p class="hint">
        Replace everything in this browser with a file exported from this
        app. The current data is replaced, not merged.
      </p>
      <button class="btn btn--block" type="button" data-choose>
        Choose a file
      </button>
      <input type="file" accept="application/json,.json" hidden data-file>
      <p class="error" role="alert" data-error hidden></p>
      <div class="restore-confirm" data-confirm hidden>
        <p class="hint" data-confirm-text></p>
        <div class="form__actions">
          <button class="btn" type="button" data-cancel>Cancel</button>
          <button class="btn btn--danger" type="button" data-replace>
            Replace data
          </button>
        </div>
      </div>
      <p class="hint" role="status" data-success hidden></p>
    </section>
  </div>
`;

const closeButton = dialog.querySelector("[data-close]");
const exportButton = dialog.querySelector("[data-export]");
const chooseButton = dialog.querySelector("[data-choose]");
const fileInput = dialog.querySelector("[data-file]");
const errorText = dialog.querySelector("[data-error]");
const confirm = dialog.querySelector("[data-confirm]");
const confirmText = dialog.querySelector("[data-confirm-text]");
const cancelButton = dialog.querySelector("[data-cancel]");
const replaceButton = dialog.querySelector("[data-replace]");
const successText = dialog.querySelector("[data-success]");

// The parsed file waiting for confirmation. Nothing is written until Replace
// data is pressed, so a wrong file never overwrites the desk.
let pendingState = null;

function summary(state) {
  const rooms = state.rooms.length;
  const bookings = state.reservations.length;
  const history = state.register.length;

  return (
    `${rooms} ${rooms === 1 ? "room" : "rooms"}, ` +
    `${bookings} ${bookings === 1 ? "booking" : "bookings"} and ` +
    `${history} ${history === 1 ? "history entry" : "history entries"}`
  );
}

function setError(message) {
  if (message) {
    successText.textContent = "";
    successText.hidden = true;
  }
  errorText.textContent = message ?? "";
  errorText.hidden = !message;
}

function resetRestore() {
  pendingState = null;
  fileInput.value = "";
  setError("");
  confirm.hidden = true;
  confirmText.textContent = "";
  chooseButton.hidden = false;
  successText.textContent = "";
  successText.hidden = true;
}

function showConfirm(fileName, state) {
  pendingState = state;
  setError("");
  successText.hidden = true;
  confirmText.textContent =
    `Replace all current data with ${fileName}? ` +
    `The file has ${summary(state)}. This cannot be undone.`;
  confirm.hidden = false;
  chooseButton.hidden = true;
  cancelButton.focus();
}

function showFailure(message) {
  pendingState = null;
  confirm.hidden = true;
  confirmText.textContent = "";
  chooseButton.hidden = false;
  setError(message);
  chooseButton.focus();
}

exportButton.addEventListener("click", () => {
  // While a payload is unreadable the in-memory desk is empty, so exporting it
  // would be misleading. The recovery banner holds the raw copy instead.
  if (getStorageStatus().kind === "unreadable") {
    setError(
      "The saved copy is unreadable. Close this sheet and use Download " +
        "saved data in the banner above.",
    );
    return;
  }

  setError("");
  downloadText(exportState(), datedFilename("hotelmanager-data"));
});

chooseButton.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  resetRestore();

  let text;
  try {
    text = await file.text();
  } catch {
    showFailure("That file could not be read.");
    fileInput.value = "";
    return;
  }

  try {
    showConfirm(file.name, parseBackup(text));
  } catch (error) {
    showFailure(
      error instanceof Error ? error.message : "That file could not be read.",
    );
  } finally {
    // Selecting the same file again should fire change again.
    fileInput.value = "";
  }
});

cancelButton.addEventListener("click", () => {
  resetRestore();
  chooseButton.focus();
});

replaceButton.addEventListener("click", () => {
  if (!pendingState) return;

  const restored = pendingState;
  pendingState = null;
  confirm.hidden = true;
  confirmText.textContent = "";
  chooseButton.hidden = false;

  replaceState(restored);
  successText.textContent =
    getStorageStatus().kind === "ok"
      ? `Data restored: ${summary(restored)}.`
      : "Data loaded in this tab, but it could not be saved. Keep this tab " +
        "open and fix the saving problem first.";
  successText.hidden = false;
  closeButton.focus();
});

closeButton.addEventListener("click", () => dialog.close());

// A click on the backdrop lands on the dialog element itself.
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

dialog.addEventListener("close", () => {
  resetRestore();
  // The view may have repainted after a restore, so find the opener by marker.
  document.querySelector("[data-data]")?.focus();
});

export function openDataDialog() {
  if (dialog.open) return;

  resetRestore();
  dialog.showModal();
  exportButton.focus();
}

document.body.append(dialog);
