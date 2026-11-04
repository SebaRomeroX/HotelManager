import { ROOM_TYPES, STAY_MAX_DAYS, STAY_MIN_DAYS, typeLabel } from "./rooms.js";

export const RESERVATION_NAME_MAX = 80;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// "2026-11-05" as a local date. new Date("2026-11-05") would parse as UTC
// midnight and shift a day west of Greenwich; the round-trip check rejects
// impossible inputs like 2026-02-30, whose components roll over instead.
export function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;

  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function toISODate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// Checkout is arrival + duration in calendar days, derived never stored — the
// same rule as a stay's expiry: two copies of one date cannot drift.
export function checkoutDate(arrivalDate, days) {
  const arrival = parseDate(arrivalDate);
  const count = Number(days);
  if (!arrival || !Number.isInteger(count)) return null;

  arrival.setDate(arrival.getDate() + count);
  return toISODate(arrival);
}

export function formatDate(value) {
  const date = parseDate(value);
  if (!date) return value ?? "";
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

// The first problem with a set of values, as { field, message } where field
// names a form control; null when valid. Shared by the dialog (to show and
// focus the error) and addReservation/updateReservation (to refuse the write),
// so the two can never disagree about what is acceptable.
export function reservationError(values, today = new Date()) {
  const hostName = (values.hostName ?? "").trim();
  if (!hostName) return { field: "hostName", message: "Give the host a name." };
  if (hostName.length > RESERVATION_NAME_MAX) {
    return { field: "hostName", message: "That host name is too long." };
  }

  if (!ROOM_TYPES.some((type) => type.value === values.roomType)) {
    return { field: "roomType", message: "Choose a room type." };
  }

  const arrival = parseDate(values.arrivalDate);
  if (!arrival) {
    return { field: "arrivalDate", message: "Enter a valid arrival date." };
  }

  // A reservation books a night to come; stays that already happened are
  // recorded by the room itself, not by a backfilled booking. Past bookings
  // are not editable at all (see isPastReservation), so no edit path can ever
  // trip this rule with an unchanged date.
  if (arrival < startOfDay(today)) {
    return { field: "arrivalDate", message: "The arrival date can't be in the past." };
  }

  const days = Number(values.days);
  if (!Number.isInteger(days) || days < STAY_MIN_DAYS || days > STAY_MAX_DAYS) {
    return {
      field: "days",
      message: `Enter a number of days between ${STAY_MIN_DAYS} and ${STAY_MAX_DAYS}.`,
    };
  }

  return null;
}

// Past means the arrival date has passed — the same line the sections draw,
// so a row sitting in Past can never be edited from under it. An unparseable
// date counts as past too: a corrupt entry lands in the read-only section
// where it can still be cancelled, instead of sitting in Incoming forever.
export function isPastReservation(reservation, today = new Date()) {
  const arrival = parseDate(reservation.arrivalDate);
  return !arrival || arrival < startOfDay(today);
}

// Upcoming first (soonest arrival), then the past with the most recent first —
// the front desk reads what is next without losing what just left. Equal dates
// fall through to the host name so the order never jitters between renders.
export function sortReservations(reservations, today = new Date()) {
  const todayStart = startOfDay(today);

  return [...reservations].sort((a, b) => {
    const aDate = parseDate(a.arrivalDate) ?? new Date(0);
    const bDate = parseDate(b.arrivalDate) ?? new Date(0);

    const aPast = aDate < todayStart;
    const bPast = bDate < todayStart;
    if (aPast !== bPast) return aPast ? 1 : -1;

    const direction = aPast ? -1 : 1;
    return (
      (aDate.getTime() - bDate.getTime()) * direction ||
      a.hostName.localeCompare(b.hostName, undefined, { sensitivity: "base" })
    );
  });
}

// Day-level proximity label. Round, not divide: a DST day is 23 or 25 hours.
export function relativeDayLabel(arrivalDate, today = new Date()) {
  const arrival = parseDate(arrivalDate);
  if (!arrival) return "";

  const days = Math.round((arrival.getTime() - startOfDay(today).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1) return `In ${days} days`;
  return `${-days} days ago`;
}

// The meta line shared by the list row and the read-only sheet, so what a
// reservation looks like in both places comes from one place.
export function reservationMeta(reservation) {
  const checkout = checkoutDate(reservation.arrivalDate, reservation.days);
  const days = `${reservation.days} ${reservation.days === 1 ? "day" : "days"}`;
  return (
    `${typeLabel(reservation.roomType)} · ` +
    `${formatDate(reservation.arrivalDate)} → ${formatDate(checkout)} · ${days}`
  );
}

// The three sections of the list, each already in display order: today by
// name (one date), incoming soonest first, past most recent first. One sort
// then a stable partition keeps section order and row order from drifting
// apart, and both draw the past line through isPastReservation.
export function groupReservations(reservations, today = new Date()) {
  const sorted = sortReservations(reservations, today);
  const todayStart = startOfDay(today);
  const groups = { today: [], incoming: [], past: [] };

  for (const reservation of sorted) {
    if (isPastReservation(reservation, today)) {
      groups.past.push(reservation);
      continue;
    }

    // Not past, so the date parsed — compare it against today's midnight.
    const arrival = parseDate(reservation.arrivalDate);
    if (arrival.getTime() === todayStart.getTime()) {
      groups.today.push(reservation);
    } else {
      groups.incoming.push(reservation);
    }
  }

  return groups;
}

export function addReservation(state, values, today = new Date()) {
  if (reservationError(values, today)) return state;

  const reservation = {
    id: newId(),
    hostName: values.hostName.trim(),
    roomType: values.roomType,
    arrivalDate: values.arrivalDate,
    days: Number(values.days),
    createdAt: new Date().toISOString(),
  };

  // Written before the reservations slot existed: keep the append working.
  const reservations = state.reservations ?? [];
  return { ...state, reservations: [...reservations, reservation] };
}

// The host name is deliberately absent: who the booking belongs to is fixed
// at creation, so only the stay details (and the record stamp) can move.
// A past booking's stay details do not move either — it is history.
export function updateReservation(state, id, values, today = new Date()) {
  const reservations = state.reservations ?? [];
  const current = reservations.find((reservation) => reservation.id === id);
  if (!current) return state;
  if (isPastReservation(current, today)) return state;

  const problem = reservationError(values, today);
  if (problem) return state;

  return {
    ...state,
    reservations: reservations.map((reservation) =>
      reservation.id === id
        ? {
            ...reservation,
            roomType: values.roomType,
            arrivalDate: values.arrivalDate,
            days: Number(values.days),
            updatedAt: new Date().toISOString(),
          }
        : reservation,
    ),
  };
}

export function removeReservation(state, id) {
  const reservations = state.reservations ?? [];
  if (!reservations.some((reservation) => reservation.id === id)) return state;

  return {
    ...state,
    reservations: reservations.filter((reservation) => reservation.id !== id),
  };
}

// randomUUID needs a secure context. Opening the app over plain HTTP on a LAN
// address still has to work, so fall back to a time-random id.
function newId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `res_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  );
}
