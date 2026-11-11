import { getState } from "../store.js";
import { ROOM_TYPES, STAY_MAX_DAYS, STAY_MIN_DAYS } from "../rooms.js";
import { availabilityOn, requestFitsOn } from "../reservations.js";
import { openAvailabilityDialog } from "./availability-dialog.js";

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

// The request under the calendar: how many rooms of each type for how many
// nights. Module level like anchor, so browsing months or a store repaint
// keeps it; a page reload resets it. `days` is null while the field is empty.
const request = {
  counts: { small: 0, large: 0, suite: 0 },
  days: STAY_MIN_DAYS,
};

// The Reservations screen owns the title; this block only supplies the grid.
// It is its own <section> so step() can replace just the calendar after a
// month change instead of the whole screen.
export function renderCalendar() {
  const section = document.createElement("section");
  section.className = "stack cal-block";

  const state = getState();
  const rooms = state.rooms ?? [];
  if (rooms.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Add rooms to see availability.";
    section.append(empty);
    return section;
  }

  clampRequest(roomTotals(rooms));

  const now = new Date();
  const view = anchor ?? { year: now.getFullYear(), month: now.getMonth() };
  const today = todayISO();

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
  // Keep the button in the row even on the live month. Removing it would move
  // the right arrow under the tap position, so a quick second tap would hit
  // Today and jump back instead of moving another month.
  todayButton.disabled = anchor === null;
  todayButton.addEventListener("click", () => step("today", todayButton.closest("section")));

  // Today sits between the month and the right arrow so the right arrow always
  // holds the far edge, even when Today appears after browsing away.
  nav.append(prev, label, todayButton, next);

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
  grid.append(...gridCells(view, today));

  section.append(nav, dow, grid, filterBlock(section, view, today));
  return section;
}

function todayISO() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function isoOf(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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

  const fresh = renderCalendar();
  section.replaceWith(fresh);
  // Today disables itself on the fresh render, so focus falls back to the
  // nav's first arrow instead of dropping to <body>.
  const target = fresh.querySelector(`[data-nav="${which}"]`);
  (target && !target.disabled ? target : fresh.querySelector('[data-nav="prev"]'))?.focus();
}

function blank() {
  const cell = document.createElement("span");
  cell.className = "cal-cell cal-cell--blank";
  cell.setAttribute("aria-hidden", "true");
  return cell;
}

function gridCells(view, today) {
  const first = new Date(view.year, view.month, 1);
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7;
  const cells = [];

  for (let i = 0; i < leading; i += 1) {
    cells.push(blank());
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(dayCell(view, day, today));
  }

  const trailing = (7 - ((leading + daysInMonth) % 7)) % 7;
  for (let i = 0; i < trailing; i += 1) {
    cells.push(blank());
  }

  return cells;
}

function dayCell(view, day, today) {
  const iso = isoOf(view.year, view.month, day);
  const state = getState();
  const { free, total } = availabilityOn(state, iso);
  const active = requestIsActive();
  const fits = active && iso >= today && requestFitsOn(state, iso, request);

  const cell = document.createElement("button");
  cell.type = "button";
  cell.className = "cal-cell";
  cell.dataset.date = iso;
  const isToday = iso === today;
  if (isToday) cell.classList.add("cal-cell--today");
  if (iso < today) cell.classList.add("cal-cell--past");

  if (active) {
    cell.classList.add(fits ? "cal-cell--fits" : "cal-cell--no-fit");
  } else if (free === 0) {
    cell.classList.add("cal-cell--full");
  } else if (free === total) {
    cell.classList.add("cal-cell--all-free");
  } else {
    cell.classList.add("cal-cell--some-free");
  }

  const base = isToday
    ? `Today, ${MONTHS[view.month]} ${day}`
    : `${MONTHS[view.month]} ${day}`;
  const action = isToday ? "view room states" : "view details";

  if (active) {
    cell.setAttribute(
      "aria-label",
      `${base}, ${fits ? "can start" : "cannot start"} ${requestLabel()} — ${action}`,
    );
  } else {
    cell.setAttribute(
      "aria-label",
      `${base}, ${free} room${free === 1 ? "" : "s"} free — ${action}`,
    );
  }
  cell.addEventListener("click", () => openAvailabilityDialog(iso, cell));

  const number = document.createElement("span");
  number.className = "cal-cell__day";
  number.textContent = String(day);
  cell.append(number);

  if (active) {
    const mark = document.createElement("span");
    mark.className = "cal-cell__fit";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = fits ? "✓" : "";
    cell.append(mark);
  } else {
    const count = document.createElement("span");
    count.className = "cal-cell__free";
    count.textContent = String(free);
    cell.append(count);
  }

  return cell;
}

// How many rooms of each type the hotel has, which caps the count fields.
function roomTotals(rooms) {
  const totals = Object.fromEntries(ROOM_TYPES.map(({ value }) => [value, 0]));
  for (const room of rooms) {
    if (room.type in totals) totals[room.type] += 1;
  }
  return totals;
}

// A removed room type or a shrinking supply must not leave an impossible
// request behind. Counts are clamped to the current totals; only an upper
// bound is applied to the duration so a field the user emptied stays empty.
function clampRequest(totals) {
  for (const { value } of ROOM_TYPES) {
    const count = request.counts[value];
    const max = totals[value] ?? 0;
    request.counts[value] = Number.isInteger(count)
      ? Math.min(Math.max(count, 0), max)
      : 0;
  }

  if (Number.isInteger(request.days) && request.days > STAY_MAX_DAYS) {
    request.days = STAY_MAX_DAYS;
  }
}

function requestIsActive() {
  const rooms = ROOM_TYPES.reduce(
    (sum, { value }) => sum + (request.counts[value] ?? 0),
    0,
  );
  return (
    rooms > 0 &&
    Number.isInteger(request.days) &&
    request.days >= STAY_MIN_DAYS
  );
}

// A sentence-shaped summary, e.g. "1 Suite and 2 Small rooms for 3 days".
function requestLabel() {
  const parts = ROOM_TYPES
    .filter(({ value }) => (request.counts[value] ?? 0) > 0)
    .map(({ value, label }) => {
      const count = request.counts[value];
      if (value === "suite") {
        return `${count} ${count === 1 ? "Suite" : "Suites"}`;
      }
      return `${count} ${label} ${count === 1 ? "room" : "rooms"}`;
    });

  const days = request.days === 1 ? "day" : "days";
  return `${joinWithAnd(parts)} for ${request.days} ${days}`;
}

function joinWithAnd(parts) {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

function statusText(view, today) {
  if (!requestIsActive()) {
    return "Pick at least one room and a duration to mark arrival dates.";
  }

  const label = requestLabel();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  let matches = 0;

  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = isoOf(view.year, view.month, day);
    if (iso >= today && requestFitsOn(getState(), iso, request)) matches += 1;
  }

  if (matches === 0) return `No start date this month fits ${label}.`;
  return `${label} · ${matches} start date${matches === 1 ? "" : "s"} this month.`;
}

// The planning control below the grid. Changing an input repaints only the grid
// and the status line, so the field being typed in keeps focus; a store write
// replaces the whole calendar and rebuilds the fields from module state.
function filterBlock(section, view, today) {
  const state = getState();
  const totals = roomTotals(state.rooms ?? []);
  const block = document.createElement("div");
  block.className = "cal-filter";

  const head = document.createElement("div");
  head.className = "cal-filter__head";

  const title = document.createElement("h4");
  title.className = "cal-filter__title";
  title.textContent = "Find a stay";

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "btn cal-filter__clear";
  clear.dataset.calFilterClear = "";
  clear.textContent = "Clear";
  clear.hidden = !requestIsActive();
  clear.addEventListener("click", () => {
    request.counts = { small: 0, large: 0, suite: 0 };
    request.days = STAY_MIN_DAYS;
    const fresh = renderCalendar();
    section.replaceWith(fresh);
    // Clear hides itself once the request is gone; land focus on the first
    // control instead of dropping it to <body>.
    fresh.querySelector("[data-cal-filter-days]")?.focus();
  });

  head.append(title, clear);

  const counts = document.createElement("div");
  counts.className = "cal-filter__counts";

  for (const { value, label } of ROOM_TYPES) {
    const field = document.createElement("label");
    field.className = "cal-filter__field";

    const name = document.createElement("span");
    name.textContent = label;

    const input = document.createElement("input");
    input.className = "input cal-filter__count";
    input.type = "number";
    input.min = "0";
    input.max = String(totals[value] ?? 0);
    input.step = "1";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.dataset.calFilterCount = value;
    input.value = String(request.counts[value]);
    input.setAttribute("aria-label", `${label} rooms`);
    input.disabled = (totals[value] ?? 0) === 0;
    input.addEventListener("input", () => {
      request.counts[value] = readCount(input);
      repaintGrid(section, view, today);
    });

    field.append(name, input);
    counts.append(field);
  }

  const duration = document.createElement("label");
  duration.className = "cal-filter__duration";

  const durationName = document.createElement("span");
  durationName.textContent = "Duration (days)";

  const days = document.createElement("input");
  days.className = "input";
  days.type = "number";
  days.min = String(STAY_MIN_DAYS);
  days.max = String(STAY_MAX_DAYS);
  days.step = "1";
  days.inputMode = "numeric";
  days.autocomplete = "off";
  days.dataset.calFilterDays = "";
  days.value = request.days === null ? "" : String(request.days);
  days.addEventListener("input", () => {
    const raw = days.value.trim();
    if (raw === "") {
      request.days = null;
    } else {
      const value = Number(raw);
      if (!Number.isInteger(value) || value < STAY_MIN_DAYS) {
        // An incomplete or zero value marks nothing while it is typed.
        request.days = null;
      } else if (value > STAY_MAX_DAYS) {
        request.days = STAY_MAX_DAYS;
        days.value = String(STAY_MAX_DAYS);
      } else {
        request.days = value;
      }
    }
    repaintGrid(section, view, today);
  });

  duration.append(durationName, days);

  const status = document.createElement("p");
  status.className = "hint cal-filter__status";
  status.setAttribute("aria-live", "polite");
  status.textContent = statusText(view, today);

  block.append(head, counts, duration, status);
  return block;
}

// Empty means zero rooms wanted; an over-limit value is capped to the field's
// max and written back so the count and the request cannot disagree.
function readCount(input) {
  const raw = input.value.trim();
  if (raw === "") return 0;

  const value = Number(raw);
  const max = Number(input.max);
  if (!Number.isInteger(value) || value < 0) return 0;
  if (value > max) {
    input.value = String(max);
    return max;
  }
  return value;
}

function repaintGrid(section, view, today) {
  const grid = section.querySelector(".cal-grid");
  if (grid) grid.replaceChildren(...gridCells(view, today));

  const status = section.querySelector(".cal-filter__status");
  if (status) status.textContent = statusText(view, today);

  const clear = section.querySelector("[data-cal-filter-clear]");
  if (clear) clear.hidden = !requestIsActive();
}
