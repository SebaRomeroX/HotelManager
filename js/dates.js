import { NIGHT_OF_HOUR } from "./rooms.js";

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

export function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function toISODate(date) {
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

// When a booking for arrivalDate stops being a no-show candidate: 04:00 the
// morning after (NIGHT_OF_HOUR), so a check-in recorded in the small hours —
// exactly the arrivals the night-of rule exists for — still finds its room
// held. Unparseable dates have no window: they never qualify as arriving and
// never auto-cancel, leaving manual cancel as their way out.
export function noShowCutoff(arrivalDate) {
  const end = parseDate(arrivalDate);
  if (!end) return null;

  end.setDate(end.getDate() + 1);
  end.setHours(NIGHT_OF_HOUR, 0, 0, 0);
  return end;
}

// True while the booking is still waiting for its host: from 00:00 on its
// arrival date until 04:00 the next morning. Checked-in bookings never
// qualify — their room already took the stay.
export function isArrivingNow(reservation, now = new Date()) {
  if (reservation.checkedInAt) return false;

  const arrival = parseDate(reservation.arrivalDate);
  if (!arrival) return false;

  const end = noShowCutoff(reservation.arrivalDate);
  return now >= arrival && now < end;
}

// The one past line — consumed by sorting, grouping, the edit lock and the
// legacy read-only sheet, so they can never disagree:
//   checked-in  → the calendar day it landed on; new check-ins leave the
//                 active list for the register, so this only sees old records
//   pending     → its arrival window (00:00 D … 04:00 D+1); a straddling
//                 booking is NOT past while that window holds
//   unparseable → past, so migration and reconcile send it to the register
export function isPastReservation(reservation, now = new Date()) {
  const arrival = parseDate(reservation.arrivalDate);
  if (!arrival) return true;

  if (reservation.checkedInAt) return arrival < startOfDay(now);

  const end = noShowCutoff(reservation.arrivalDate);
  return now >= end;
}

// Checked-in stays are read-only: history lives in the register, and their
// duration belongs to the room now (see the roadmap TODO).
export function isReadOnlyReservation(reservation, now = new Date()) {
  return Boolean(reservation.checkedInAt) || isPastReservation(reservation, now);
}

// Day-level proximity label. Round, not divide: a DST day is 23 or 25 hours.
export function relativeDayLabel(arrivalDate, today = new Date()) {
  const arrival = parseDate(arrivalDate);
  if (!arrival) return "";

  const days = Math.round(
    (arrival.getTime() - startOfDay(today).getTime()) / 86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1) return `In ${days} days`;
  return `${-days} days ago`;
}
