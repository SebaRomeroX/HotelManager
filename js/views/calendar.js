import { getState } from "../store.js";
import { availabilityOn } from "../reservations.js";
import { emptySection } from "../components/empty.js";
import { openAvailabilityDialog } from "../components/availability-dialog.js";

export const title = "Calendar";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Monday-first, single letters — each cell's aria-label carries the full
// date, so the row is decoration for sighted users.
const DOW = ["M", "T", "W", "T", "F", "S", "S"];

// Which month is on screen: null follows today, so a repaint after a state
// write never yanks a browsed month back. Arrows set it, Today clears it.
let anchor = null;

function todayISO() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function isoOf(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function render() {
  const rooms = getState().rooms ?? [];
  if (rooms.length === 0) {
    return emptySection(title, "Add rooms to see availability.");
  }

  const now = new Date();
  const view = anchor ?? { year: now.getFullYear(), month: now.getMonth() };
  const first = new Date(view.year, view.month, 1);
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const today = todayISO();

  const section = document.createElement("section");
  section.className = "stack";

  const heading = document.createElement("h2");
  heading.className = "view__title";
  heading.textContent = title;

  const nav = document.createElement("div");
  nav.className = "cal-nav";

  const prev = navButton("prev", "‹", `Previous month`);
  const next = navButton("next", "›", `Next month`);

  const label = document.createElement("span");
  label.className = "cal-nav__label";
  label.textContent = `${MONTHS[view.month]} ${view.year}`;

  const todayButton = document.createElement("button");
  todayButton.type = "button";
  todayButton.className = "btn";
  todayButton.dataset.nav = "today";
  todayButton.textContent = "Today";
  // Only worth showing once you have browsed away from the live month.
  todayButton.hidden = anchor === null;
  todayButton.addEventListener("click", () => step("today", todayButton.closest("section")));

  nav.append(prev, label, next, todayButton);

  const dow = document.createElement("div");
  dow.className = "cal-dow";
  dow.setAttribute("aria-hidden", "true");
  dow.append(...DOW.map((letter) => {
    const cell = document.createElement("span");
    cell.textContent = letter;
    return cell;
  }));

  const grid = document.createElement("div");
  grid.className = "cal-grid";

  // (getDay() + 6) % 7 turns Sunday=0 into a Monday-first column index.
  const leading = (first.getDay() + 6) % 7;
  for (let i = 0; i < leading; i += 1) {
    grid.append(blank());
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    grid.append(dayCell(view, day, today));
  }

  const trailing = (7 - ((leading + daysInMonth) % 7)) % 7;
  for (let i = 0; i < trailing; i += 1) {
    grid.append(blank());
  }

  section.append(heading, nav, dow, grid);
  return section;
}

function navButton(which, glyph, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn cal-nav__arrow";
  button.dataset.nav = which;
  button.setAttribute("aria-label", label);
  button.textContent = glyph;
  button.addEventListener("click", () => step(which, button.closest("section")));
  return button;
}

// Repaint in place and hand focus back to the button just used — app.js's
// own render is not reachable from here, and losing focus on every arrow
// press would strand keyboard users.
function step(which, section) {
  const now = new Date();
  const current = anchor ?? { year: now.getFullYear(), month: now.getMonth() };

  if (which === "today") {
    anchor = null;
  } else {
    const shifted = new Date(current.year, current.month + (which === "next" ? 1 : -1), 1);
    anchor = { year: shifted.getFullYear(), month: shifted.getMonth() };
  }

  const fresh = render();
  section.replaceWith(fresh);
  // Today hides itself on the fresh render, so focus falls back to the nav's
  // first arrow instead of dropping to <body>.
  const target = fresh.querySelector(`[data-nav="${which}"]`);
  (target && !target.hidden ? target : fresh.querySelector('[data-nav="prev"]'))?.focus();
}

function blank() {
  const cell = document.createElement("span");
  cell.className = "cal-cell cal-cell--blank";
  cell.setAttribute("aria-hidden", "true");
  return cell;
}

function dayCell(view, day, today) {
  const iso = isoOf(view.year, view.month, day);
  const { free } = availabilityOn(getState(), iso);

  const cell = document.createElement("button");
  cell.type = "button";
  cell.className = "cal-cell";
  cell.dataset.date = iso;
  if (iso === today) cell.classList.add("cal-cell--today");
  if (iso < today) cell.classList.add("cal-cell--past");
  if (free === 0) cell.classList.add("cal-cell--full");
  cell.setAttribute(
    "aria-label",
    `${MONTHS[view.month]} ${day}, ${free} room${free === 1 ? "" : "s"} free — view details`,
  );
  cell.addEventListener("click", () => openAvailabilityDialog(iso, cell));

  const number = document.createElement("span");
  number.className = "cal-cell__day";
  number.textContent = String(day);

  const count = document.createElement("span");
  count.className = "cal-cell__free";
  count.textContent = String(free);

  cell.append(number, count);
  return cell;
}
