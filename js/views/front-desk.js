import { renderRoomGrid } from "../components/room-grid.js";
import { renderReservationsPanel } from "../components/reservations-panel.js";
import { openDataDialog } from "../components/data-dialog.js";

export const title = "Hotel Manager";

// One screen for the front desk: rooms at a glance, availability below, and
// the Incoming/Register sheets at the bottom in the thumb zone.
export function render() {
  const section = document.createElement("section");
  section.className = "stack";

  const head = document.createElement("div");
  head.className = "view__head";

  const heading = document.createElement("h2");
  heading.className = "view__title";
  heading.textContent = title;

  const dataButton = document.createElement("button");
  dataButton.type = "button";
  dataButton.className = "btn";
  dataButton.dataset.data = "";
  dataButton.setAttribute("aria-haspopup", "dialog");
  dataButton.textContent = "Data";
  dataButton.addEventListener("click", () => openDataDialog());

  head.append(heading, dataButton);
  section.append(head, renderRoomGrid(), renderReservationsPanel());
  return section;
}
