import { renderRoomGrid } from "../components/room-grid.js";
import { renderReservationsPanel } from "../components/reservations-panel.js";

export const title = "Hotel Manager";

// One screen for the front desk: rooms at a glance, availability below, and
// the Incoming/Register sheets at the bottom in the thumb zone.
export function render() {
  const section = document.createElement("section");
  section.className = "stack";

  const heading = document.createElement("h2");
  heading.className = "view__title";
  heading.textContent = title;

  section.append(heading, renderRoomGrid(), renderReservationsPanel());
  return section;
}
