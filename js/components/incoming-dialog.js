import { getState, subscribe } from "../store.js";
import { groupReservations } from "../reservations.js";
import { openReservationDialog } from "./reservation-dialog.js";
import { reservationRow } from "./reservation-row.js";

const dialog = document.createElement("dialog");
dialog.className = "dialog";
dialog.setAttribute("aria-labelledby", "incoming-dialog-title");

dialog.innerHTML = `
  <header class="dialog__header">
    <h2 class="dialog__title" id="incoming-dialog-title">Incoming</h2>
    <button class="btn" type="button" data-close>Close</button>
  </header>

  <div class="dialog__body">
    <p class="hint" data-summary hidden></p>

    <ul class="res-list" data-list></ul>

    <p class="empty" data-empty hidden>No incoming reservations.</p>
  </div>
`;

const closeButton = dialog.querySelector("[data-close]");
const summary = dialog.querySelector("[data-summary]");
const list = dialog.querySelector("[data-list]");
const empty = dialog.querySelector("[data-empty]");

function pendingReservations() {
  const groups = groupReservations(getState().reservations ?? []);
  // Today first (already name-sorted), then upcoming soonest first. The row's
  // day label still says "Today" / "In 2 days", so one list reads in order.
  return [...groups.today, ...groups.incoming];
}

function render() {
  const pending = pendingReservations();

  // The list is rebuilt wholesale; keep focus on the row the user was on when
  // an unrelated store render lands.
  const active = document.activeElement;
  const activeId = active && list.contains(active) ? active.dataset.id : null;

  summary.textContent = `${pending.length} ${pending.length === 1 ? "booking" : "bookings"}`;
  summary.hidden = pending.length === 0;
  list.hidden = pending.length === 0;
  empty.hidden = pending.length > 0;

  list.replaceChildren(
    ...pending.map((reservation) =>
      reservationRow(reservation, (booking) => {
        // The booking sheet stacks above this one. Keeping the list open lets
        // the row survive the save, so closing the sheet can return focus to
        // the exact row that opened it instead of the button behind it.
        openReservationDialog(booking.id, {
          focusSelector: "[data-incoming]",
        });
      }),
    ),
  );

  if (activeId) {
    const row = list.querySelector(`.res-row[data-id="${activeId}"]`);
    (row ?? closeButton).focus();
  }
}

closeButton.addEventListener("click", () => dialog.close());

// A click on the backdrop lands on the dialog element itself.
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

dialog.addEventListener("close", () => {
  // The view may have repainted, so find the button by its marker rather than
  // holding a stale reference.
  document.querySelector("[data-incoming]")?.focus();
});

export function openIncomingDialog() {
  if (dialog.open) return;

  render();
  dialog.showModal();
  (list.querySelector(".res-row") ?? closeButton).focus();
}

document.body.append(dialog);
subscribe(render);
