import {
  DAY_BOUNDARY_HOUR,
  NIGHT_OF_HOUR,
  ROOM_TYPES,
  STAY_MAX_DAYS,
  STAY_MIN_DAYS,
  setRoomState,
  sortRooms,
  stayExpiry,
  typeLabel,
} from "./rooms.js";

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
//
// currentDate is the arrival date already on the record. A booking inside its
// no-show window can straddle midnight — yesterday's reservation is still
// check-in-able until 04:00 — so an edit that does not move its date must not
// trip the past rule; any date the user does change must still be a night to
// come.
export function reservationError(values, today = new Date(), { currentDate } = {}) {
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
  // are not editable at all (see isReadOnlyReservation), so only a straddling
  // window's unchanged date can reach this rule.
  if (arrival < startOfDay(today) && values.arrivalDate !== currentDate) {
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

// When a booking for arrivalDate stops being a no-show candidate: 04:00 the
// morning after (NIGHT_OF_HOUR), so a check-in recorded in the small hours —
// exactly the arrivals the night-of rule exists for — still finds its room
// held. Unparseable dates have no window: they never qualify as arriving and
// never auto-cancel, leaving manual cancel as their way out.
function windowEnd(arrivalDate) {
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

  const end = windowEnd(reservation.arrivalDate);
  return now >= arrival && now < end;
}

// The one past line — consumed by sorting, grouping, the edit lock and the
// read-only sheet, so they can never disagree:
//   checked-in  → the calendar day it landed on; it leaves Today the day after
//   pending     → its arrival window (00:00 D … 04:00 D+1); a straddling
//                 booking is NOT past while that window holds
//   unparseable → past, landing in the read-only section where it can still
//                 be cancelled instead of sitting in Incoming forever
export function isPastReservation(reservation, now = new Date()) {
  const arrival = parseDate(reservation.arrivalDate);
  if (!arrival) return true;

  if (reservation.checkedInAt) return arrival < startOfDay(now);

  const end = windowEnd(reservation.arrivalDate);
  return now >= end;
}

// Checked-in stays are read-only: their duration lives on the room now and
// cannot be propagated back from here (see the roadmap TODO).
export function isReadOnlyReservation(reservation, now = new Date()) {
  return Boolean(reservation.checkedInAt) || isPastReservation(reservation, now);
}

// Upcoming first (soonest arrival), then the past with the most recent first —
// the front desk reads what is next without losing what just left. Equal dates
// fall through to the host name so the order never jitters between renders.
// "Past" is isPastReservation, so a booking inside its no-show window sorts
// with the upcoming ones — tomorrow's sections and this order cannot split.
export function sortReservations(reservations, today = new Date()) {
  return [...reservations].sort((a, b) => {
    const aPast = isPastReservation(a, today);
    const bPast = isPastReservation(b, today);
    if (aPast !== bPast) return aPast ? 1 : -1;

    // Unknown/garbage dates rank as oldest rather than newest: -1 would do
    // the opposite in the past half, so parseDate falls back to the epoch.
    const aDate = parseDate(a.arrivalDate) ?? new Date(0);
    const bDate = parseDate(b.arrivalDate) ?? new Date(0);
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

    // Not past, so the date parsed. Arrival at or before today's midnight
    // means today's own booking or one straddling the night inside its
    // no-show window — both still belong to Today, because both can still
    // be checked in right now.
    const arrival = parseDate(reservation.arrivalDate);
    if (arrival.getTime() <= todayStart.getTime()) {
      groups.today.push(reservation);
    } else {
      groups.incoming.push(reservation);
    }
  }

  return groups;
}

export function addReservation(state, values, today = new Date()) {
  if (reservationError(values, today)) return state;
  if (reservationAvailabilityError(state, values)) return state;

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
// Read-only records — past and checked-in — do not move at all.
export function updateReservation(state, id, values, today = new Date()) {
  const reservations = state.reservations ?? [];
  const current = reservations.find((reservation) => reservation.id === id);
  if (!current) return state;
  if (isReadOnlyReservation(current, today)) return state;

  const problem = reservationError(values, today, {
    currentDate: current.arrivalDate,
  });
  if (problem) return state;
  if (reservationAvailabilityError(state, values, { current })) return state;

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

// Can this room serve a booking arriving on arrivalDate? The one availability
// line, shared by every guard: not out of order, and a live stay must end by
// the arrival morning's checkout line — 10:00 on D — so a back-to-back stay
// (A out at 10:00, B in the same day) still counts as free. An occupied room
// without a timer never frees, so it never serves.
function roomServes(room, arrivalDate) {
  if (room.state === "oos") return false;

  if (room.state === "occupied") {
    if (!room.stayDays || !room.stayStartedAt) return false;

    const line = parseDate(arrivalDate);
    if (!line) return false;
    line.setHours(DAY_BOUNDARY_HOUR, 0, 0, 0);
    if (stayExpiry(room.stayStartedAt, room.stayDays) > line) return false;
  }

  return true;
}

function byArrival(a, b) {
  return (
    parseDate(a.arrivalDate).getTime() - parseDate(b.arrivalDate).getTime() ||
    a.hostName.localeCompare(b.hostName, undefined, { sensitivity: "base" })
  );
}

// The booking a manual set-occupied would strand, or null. Simulates X taking
// the stay from now, then asks for every booking X can no longer serve whether
// some other room still can:
//   in-window bookings hold a VACANT room right now — that is what the
//     OCCUPIED - ARRIVING marker is — so they are counted, not matched: one
//     vacant room short and the last booking in line is the one named
//   future bookings need a room whose stay ends by their 10:00 line
// Greedy and per-booking, the same standard arrivingAssignment holds itself.
// exceptId is the booking taking X right now (check-in): it is not left
// behind by its own move.
export function occupancyConflict(
  state,
  roomId,
  days,
  now = new Date(),
  { exceptId = null } = {},
) {
  const rooms = state.rooms ?? [];
  const room = rooms.find((candidate) => candidate.id === roomId);
  if (!room) return null;

  const count = Number(days);
  if (!Number.isInteger(count) || count < STAY_MIN_DAYS || count > STAY_MAX_DAYS) {
    return null; // setRoomState refuses these anyway
  }

  const expiry = stayExpiry(now.toISOString(), count);

  const arrivals = [];
  const futures = [];
  for (const reservation of state.reservations ?? []) {
    if (reservation.checkedInAt || reservation.id === exceptId) continue;
    if (reservation.roomType !== room.type) continue;

    if (isArrivingNow(reservation, now)) {
      arrivals.push(reservation);
    } else if (!isPastReservation(reservation, now)) {
      futures.push(reservation);
    }
  }

  if (arrivals.length > 0) {
    const vacantLeft = rooms.filter(
      (candidate) =>
        candidate.id !== roomId &&
        candidate.type === room.type &&
        candidate.state === "vacant",
    ).length;

    if (arrivals.length > vacantLeft) {
      arrivals.sort(byArrival);
      return arrivals[arrivals.length - 1];
    }
  }

  futures.sort(byArrival);
  for (const reservation of futures) {
    const line = parseDate(reservation.arrivalDate);
    line.setHours(DAY_BOUNDARY_HOUR, 0, 0, 0);
    if (expiry <= line) continue; // X frees up in time

    const saved = rooms.some(
      (candidate) =>
        candidate.id !== roomId &&
        candidate.type === room.type &&
        roomServes(candidate, reservation.arrivalDate),
    );
    if (!saved) return reservation;
  }

  return null;
}

// The booking-side guard: refuse a reservation no room could serve. Only the
// fields that decide availability — room type and arrival date — so an edit
// that moves neither (a duration tweak) is never refused by it, and a record
// that was already impossible before this guard existed can still be edited.
export function reservationAvailabilityError(state, values, { current } = {}) {
  if (
    current &&
    current.roomType === values.roomType &&
    current.arrivalDate === values.arrivalDate
  ) {
    return null;
  }

  const servable = (state.rooms ?? []).some(
    (room) => room.type === values.roomType && roomServes(room, values.arrivalDate),
  );
  if (servable) return null;

  return {
    field: "roomType",
    message: `No ${typeLabel(values.roomType)} room is free on ${formatDate(values.arrivalDate)}.`,
  };
}

// The nights a live stay occupies: from the calendar day it began (night-of
// included) up to — not including — its checkout day, which frees the room for
// that night. The end is exactly the booking guard's 10:00 line; the start
// exists so a stay that began yesterday does not paint last week red, which
// roomServes (written for arrivals of today or later) would. An occupied room
// with no timer never frees, so it covers everything.
function stayCoversNight(room, night) {
  if (room.state !== "occupied") return false;
  if (!room.stayDays || !room.stayStartedAt) return true;

  const expiry = stayExpiry(room.stayStartedAt, room.stayDays);
  // Invert expiry = arrivalDay + days at 10:00 — robust because it inverts
  // whatever rule produced it, without re-deriving the night-of line here.
  const start = new Date(expiry);
  start.setDate(start.getDate() - Number(room.stayDays));
  start.setHours(0, 0, 0, 0);
  const end = new Date(expiry);
  end.setHours(0, 0, 0, 0);

  return start <= night && night < end;
}

// A booking consumes the nights [arrival, arrival + days): checkout morning
// frees the room for that night — the guest leaves at 10:00, the room can be
// sold again.
function occupiesNight(arrival, days, night) {
  const end = new Date(arrival);
  end.setDate(end.getDate() + Number(days));
  return arrival <= night && night < end;
}

// How many rooms could still be sold for this date — the number every
// calendar cell shows. Per type: rooms not out of order and not held by a
// live stay, minus the nights not-checked-in bookings cover; clamped at 0 so
// data written before the guards can never show -1. Checked-in records are
// skipped: their room's live stay already accounts them.
export function availabilityOn(state, isoDate) {
  const night = parseDate(isoDate);
  const rooms = state.rooms ?? [];
  const reservations = state.reservations ?? [];

  const byType = ROOM_TYPES.map(({ value }) => {
    const owned = rooms.filter((room) => room.type === value);
    if (!night || owned.length === 0) {
      return { type: value, total: owned.length, free: 0 };
    }

    const sellable = owned.filter(
      (room) => room.state !== "oos" && !stayCoversNight(room, night),
    ).length;

    const booked = reservations.filter((reservation) => {
      if (reservation.checkedInAt || reservation.roomType !== value) return false;
      const arrival = parseDate(reservation.arrivalDate);
      return arrival !== null && occupiesNight(arrival, reservation.days, night);
    }).length;

    return { type: value, total: owned.length, free: Math.max(0, sellable - booked) };
  });

  return {
    free: byType.reduce((sum, entry) => sum + entry.free, 0),
    total: byType.reduce((sum, entry) => sum + entry.total, 0),
    byType,
  };
}

// Which free room each arriving booking holds, derived fresh on every render:
// nothing is stored, so occupying, OOS-ing or cleaning the held room simply
// moves the marker to the next free match with no write and no drift. Order
// matters: the straddling no-show about to expire gets first pick, then the
// stable list order the sections already show; rooms follow sortRooms.
export function arrivingAssignment(state, now = new Date()) {
  const assignment = new Map();

  const arriving = (state.reservations ?? [])
    .filter((reservation) => isArrivingNow(reservation, now))
    .sort((a, b) => {
      const aDate = parseDate(a.arrivalDate).getTime();
      const bDate = parseDate(b.arrivalDate).getTime();
      return (
        aDate - bDate ||
        a.hostName.localeCompare(b.hostName, undefined, { sensitivity: "base" })
      );
    });

  const free = sortRooms(state.rooms ?? []).filter((room) => room.state === "vacant");
  const taken = new Set();

  for (const reservation of arriving) {
    const room = free.find(
      (candidate) =>
        candidate.type === reservation.roomType && !taken.has(candidate.id),
    );
    if (!room) continue;

    taken.add(room.id);
    assignment.set(room.id, reservation);
  }

  return assignment;
}

// One state transition: the room takes the stay timer exactly as a manual
// set-occupied would — so the 10:00 boundary, the countdown label and the
// night-of rule all apply from now — and the reservation is stamped
// checked-in. Refuses (same reference) unless the booking is inside its
// arrival window and a free matching room is actually held for it.
export function checkInReservation(state, id, now = new Date()) {
  const reservation = (state.reservations ?? []).find(
    (candidate) => candidate.id === id,
  );
  if (!reservation || !isArrivingNow(reservation, now)) return state;

  let roomId = null;
  for (const [heldRoomId, held] of arrivingAssignment(state, now)) {
    if (held.id === id) {
      roomId = heldRoomId;
      break;
    }
  }
  if (roomId === null) return state;

  // The stay must not strand another booking — the same conflict the days
  // form shows an error for; here it is a same-reference refusal.
  if (occupancyConflict(state, roomId, reservation.days, now, { exceptId: id })) {
    return state;
  }

  const withStay = setRoomState(state, roomId, "occupied", {
    days: reservation.days,
    now,
  });
  // setRoomState refuses invalid day counts; never stamp a check-in the room
  // did not take.
  if (withStay === state) return state;

  return {
    ...withStay,
    reservations: withStay.reservations.map((candidate) =>
      candidate.id === id
        ? { ...candidate, checkedInAt: now.toISOString() }
        : candidate,
    ),
  };
}

function isNoShow(reservation, now) {
  if (reservation.checkedInAt) return false;

  const end = windowEnd(reservation.arrivalDate);
  return end !== null && now >= end;
}

// Drop bookings whose arrival window closed unvalidated. Same contract as
// reconcileExpiries: identical reference when nothing expired.
export function reconcileReservations(state, now = new Date()) {
  const reservations = state.reservations ?? [];
  const kept = reservations.filter(
    (reservation) => !isNoShow(reservation, now),
  );
  if (kept.length === reservations.length) return state;

  return { ...state, reservations: kept };
}

// Earliest moment reservations change on their own: midnight rolls the
// sections and starts new arrival windows, a cutoff expires a no-show.
// Past cutoffs are skipped — reconcile drops those before this ever matters.
export function nextReservationBoundary(state, now = new Date()) {
  const midnight = startOfDay(now);
  midnight.setDate(midnight.getDate() + 1);
  let best = midnight.getTime();

  for (const reservation of state.reservations ?? []) {
    if (reservation.checkedInAt) continue;

    const end = windowEnd(reservation.arrivalDate);
    if (!end) continue;

    const at = end.getTime();
    if (at > now.getTime() && at < best) best = at;
  }

  return best;
}

// randomUUID needs a secure context. Opening the app over plain HTTP on a LAN
// address still has to work, so fall back to a time-random id.
function newId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `res_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  );
}
