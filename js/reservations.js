import {
  DAY_BOUNDARY_HOUR,
  NIGHT_OF_HOUR,
  ROOM_TYPES,
  STAY_MAX_DAYS,
  STAY_MIN_DAYS,
  oosCoversNight,
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

// A booking holds a whole-number count of each room type. Records written
// before multi-room reservations carry one `roomType` instead; every reader
// goes through here so both shapes behave the same until migration runs.
export function reservationRoomCounts(record) {
  const counts = Object.fromEntries(ROOM_TYPES.map(({ value }) => [value, 0]));
  const source = record?.roomCounts;

  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const { value } of ROOM_TYPES) {
      const count = Number(source[value] ?? 0);
      counts[value] = Number.isInteger(count) && count > 0 ? count : 0;
    }
    return counts;
  }

  if (ROOM_TYPES.some(({ value }) => value === record?.roomType)) {
    counts[record.roomType] = 1;
  }
  return counts;
}

export function reservationRoomTotal(record) {
  const counts = reservationRoomCounts(record);
  return ROOM_TYPES.reduce((sum, { value }) => sum + counts[value], 0);
}

function joinWithAnd(parts) {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

// "3 Small rooms", "1 Suite and 2 Small rooms" — the one wording used by the
// list, register, dialogs and filter summary.
export function roomCountsLabel(counts) {
  const parts = ROOM_TYPES
    .filter(({ value }) => (counts?.[value] ?? 0) > 0)
    .map(({ value, label }) => {
      const count = counts[value];
      if (value === "suite") {
        return `${count} ${count === 1 ? "Suite" : "Suites"}`;
      }
      return `${count} ${label} ${count === 1 ? "room" : "rooms"}`;
    });

  return joinWithAnd(parts) || "No rooms";
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

  // The form sends one count per type. Reject fractions and negatives rather
  // than silently rounding them into a different booking.
  const counts =
    values.roomCounts ??
    (values.roomType ? { [values.roomType]: 1 } : {});
  let rooms = 0;
  for (const { value } of ROOM_TYPES) {
    const count = counts[value] ?? 0;
    if (!Number.isInteger(count) || count < 0) {
      return { field: "rooms", message: "Enter whole room counts." };
    }
    rooms += count;
  }

  if (rooms < 1) {
    return { field: "rooms", message: "Choose at least one room." };
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

// Upcoming first (soonest arrival), then the past with the most recent first.
// The Reservations view renders only today and incoming, but keeping the past
// last means migration/reconcile see the same stable order.
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
    `${roomCountsLabel(reservationRoomCounts(reservation))} · ` +
    `${formatDate(reservation.arrivalDate)} → ${formatDate(checkout)} · ${days}`
  );
}

// The register is history: every entry is a copy of the reservation at the
// moment it left the active list, plus why it left. Snapshots keep the past
// stable when a room is renamed or a booking would otherwise have been edited.
export const REGISTER_STATUS_LABELS = {
  checked_in: "Checked in",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export function registerStatusLabel(status) {
  return REGISTER_STATUS_LABELS[status] ?? status;
}

export function registerEntry(
  reservation,
  status,
  { registeredAt = new Date().toISOString(), assignedRooms = [] } = {},
) {
  const entry = {
    ...reservation,
    status,
    registeredAt,
    // Check-ins remember every room that took the stay; the room may be
    // renamed or deleted later, so the entry carries the names it had then.
    assignedRooms: assignedRooms.map(({ id, name, type }) => ({ id, name, type })),
  };

  return entry;
}

// Newest first. Equal stamps fall through to the host name so the order never
// jitters between renders.
export function sortRegister(register) {
  return [...register].sort((a, b) => {
    const aTime = new Date(a.registeredAt).getTime() || 0;
    const bTime = new Date(b.registeredAt).getTime() || 0;
    return (
      bTime - aTime ||
      (a.hostName ?? "").localeCompare(b.hostName ?? "", undefined, {
        sensitivity: "base",
      })
    );
  });
}

export function removeRegisterEntry(state, id) {
  const register = state.register ?? [];
  if (!register.some((entry) => entry.id === id)) return state;

  return {
    ...state,
    register: register.filter((entry) => entry.id !== id),
  };
}

export function clearRegister(state) {
  if ((state.register ?? []).length === 0) return state;
  return { ...state, register: [] };
}

// The three buckets the list can partition into, each already in display
// order: today by name (one date), incoming soonest first, past most recent
// first. The view renders only today and incoming; keeping past in the shape
// lets migration/reconcile share the same partition.
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
    roomCounts: reservationRoomCounts(values),
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
            roomCounts: reservationRoomCounts(values),
            arrivalDate: values.arrivalDate,
            days: Number(values.days),
            updatedAt: new Date().toISOString(),
          }
        : reservation,
    ),
  };
}

// Cancelling leaves the active list and enters the register. The record is
// copied, not moved in place: the register keeps what the booking was at the
// moment the desk cancelled it.
export function removeReservation(state, id, now = new Date()) {
  const reservations = state.reservations ?? [];
  const reservation = reservations.find((candidate) => candidate.id === id);
  if (!reservation) return state;

  return {
    ...state,
    reservations: reservations.filter((candidate) => candidate.id !== id),
    register: [
      registerEntry(reservation, "cancelled", {
        registeredAt: now.toISOString(),
      }),
      ...(state.register ?? []),
    ],
  };
}

// Can this room serve a booking arriving on arrivalDate? The one availability
// line, shared by every guard: not out of order for that night, and a live stay
// must end by the arrival morning's checkout line — 10:00 on D — so a
// back-to-back stay (A out at 10:00, B in the same day) still counts as free.
// An occupied room without a timer never frees, so it never serves. A timed
// OOS room frees itself on the first night its window no longer covers.
function roomServes(room, arrivalDate) {
  if (room.state === "oos") {
    const arrival = parseDate(arrivalDate);
    if (!arrival || oosCoversNight(room, startOfDay(arrival))) return false;
  }

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

// The booking a manual set-occupied would strand, or null. A single room is
// just the one-room case of the group check below.
export function occupancyConflict(
  state,
  roomId,
  days,
  now = new Date(),
  { exceptId = null } = {},
) {
  return occupancyConflictForRooms(state, [roomId], days, now, { exceptId });
}

// The group form of occupancyConflict. Taking several rooms at once must not
// leave another arriving booking without a vacant room, nor a future booking
// without enough rooms of its type on its arrival morning. Arrivals are counted
// per room because one booking may now hold several; futures are checked one
// booking at a time, the same looseness the single-room guard always had.
export function occupancyConflictForRooms(
  state,
  roomIds,
  days,
  now = new Date(),
  { exceptId = null } = {},
) {
  const rooms = state.rooms ?? [];
  const taking = new Set(roomIds);
  if (roomIds.length === 0) return null;
  if (roomIds.some((id) => !rooms.some((room) => room.id === id))) return null;

  const count = Number(days);
  if (!Number.isInteger(count) || count < STAY_MIN_DAYS || count > STAY_MAX_DAYS) {
    return null; // setRoomState refuses these anyway
  }

  const expiry = stayExpiry(now.toISOString(), count);
  const takenTypes = new Set(
    rooms.filter((room) => taking.has(room.id)).map((room) => room.type),
  );

  const arrivals = [];
  const futures = [];
  for (const reservation of state.reservations ?? []) {
    if (reservation.checkedInAt || reservation.id === exceptId) continue;

    if (isArrivingNow(reservation, now)) {
      arrivals.push(reservation);
    } else if (!isPastReservation(reservation, now)) {
      futures.push(reservation);
    }
  }

  for (const type of takenTypes) {
    const needed = arrivals.reduce(
      (sum, reservation) => sum + (reservationRoomCounts(reservation)[type] ?? 0),
      0,
    );
    if (needed === 0) continue;

    const vacantLeft = rooms.filter(
      (candidate) =>
        candidate.type === type &&
        candidate.state === "vacant" &&
        !taking.has(candidate.id),
    ).length;

    if (needed > vacantLeft) {
      const relevant = arrivals.filter(
        (reservation) => (reservationRoomCounts(reservation)[type] ?? 0) > 0,
      );
      relevant.sort(byArrival);
      return relevant[relevant.length - 1] ?? null;
    }
  }

  futures.sort(byArrival);
  for (const reservation of futures) {
    const line = parseDate(reservation.arrivalDate);
    line.setHours(DAY_BOUNDARY_HOUR, 0, 0, 0);
    if (expiry <= line) continue; // the taken rooms free up in time

    const wanted = reservationRoomCounts(reservation);
    for (const type of takenTypes) {
      const needed = wanted[type] ?? 0;
      if (needed === 0) continue;

      const available = rooms.filter(
        (candidate) =>
          candidate.type === type &&
          !taking.has(candidate.id) &&
          roomServes(candidate, reservation.arrivalDate),
      ).length;
      if (available < needed) return reservation;
    }
  }

  return null;
}

// The booking-side guard: refuse a reservation the property cannot sell. It
// walks every proposed night and compares demand (this booking plus the other
// pending bookings of the type) with supply (rooms of the type not out of
// order or held by a live stay that night). The old version only asked whether
// a room existed for the arrival night, so a later-night booking could quietly
// take the room another booking already held.
//
// current is the record being edited. Only nights it was not already
// overbooked on can refuse the edit, so a duplicate written before this guard
// can still be shortened or repaired instead of being frozen in place.
export function reservationAvailabilityError(state, values, { current } = {}) {
  const proposed = overbookedNights(state, values, {
    exceptId: current?.id ?? null,
  });
  if (proposed.length === 0) return null;

  const key = (shortage) => `${shortage.roomType}|${shortage.isoDate}`;

  if (current) {
    const existing = new Set(
      overbookedNights(state, current, { exceptId: current.id }).map(key),
    );
    const worsened = proposed.find((shortage) => !existing.has(key(shortage)));
    if (!worsened) return null;
    return capacityError(worsened);
  }

  return capacityError(proposed[0]);
}

function capacityError({ roomType, isoDate, left }) {
  const label = typeLabel(roomType);
  const message =
    left > 0
      ? `Only ${left} ${label} ${left === 1 ? "room is" : "rooms are"} free on ${formatDate(isoDate)}.`
      : `No ${label} rooms are free on ${formatDate(isoDate)}.`;

  return { field: "rooms", message };
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

// How many of the type's rooms can still be sold on this night: not out of
// order for it, and not held by a live stay that covers it.
function sellableOn(state, roomType, night) {
  return (state.rooms ?? []).filter(
    (room) =>
      room.type === roomType &&
      !oosCoversNight(room, night) &&
      !stayCoversNight(room, night),
  ).length;
}

// Pending rooms of the type already covering this night, ignoring the record
// being edited. A multi-room booking contributes its full count, not one.
// Checked-in records are skipped: their live stay already removes the room
// from supply.
function pendingOn(state, roomType, night, exceptId) {
  return (state.reservations ?? []).reduce((sum, reservation) => {
    if (reservation.checkedInAt || reservation.id === exceptId) return sum;

    const count = reservationRoomCounts(reservation)[roomType] ?? 0;
    if (count === 0) return sum;

    const arrival = parseDate(reservation.arrivalDate);
    return arrival !== null && occupiesNight(arrival, reservation.days, night)
      ? sum + count
      : sum;
  }, 0);
}

// Rooms still sellable for the type on this night once the other bookings are
// counted. Below 1, a new booking has nowhere to go.
function capacityLeftOn(state, roomType, night, exceptId) {
  return sellableOn(state, roomType, night) - pendingOn(state, roomType, night, exceptId);
}

// The room types that can start a booking on this date: at least one room of
// the type is still free after the other pending bookings that night. The
// record being edited is excluded, so an edit never hides its own type.
export function bookableRoomTypes(state, isoDate, { current } = {}) {
  const night = parseDate(isoDate);
  if (!night) return [];

  const exceptId = current?.id ?? null;
  return ROOM_TYPES.map(({ value }) => value).filter(
    (roomType) => capacityLeftOn(state, roomType, night, exceptId) > 0,
  );
}

// The longest stay this whole request can start on this date, capped at the
// year limit. Zero means not even the first night has enough rooms. Each extra
// night is tested against the same capacity line as the booking guard, so the
// hint can never promise a duration the form would refuse.
export function maxStayDaysForRequest(
  state,
  roomCounts,
  isoDate,
  { current } = {},
) {
  const arrival = parseDate(isoDate);
  if (!arrival) return 0;

  const counts = reservationRoomCounts({ roomCounts });
  const wanted = ROOM_TYPES.map(({ value }) => [value, counts[value]]).filter(
    ([, count]) => count > 0,
  );
  if (wanted.length === 0) return 0;

  const exceptId = current?.id ?? null;
  for (let days = 1; days <= STAY_MAX_DAYS; days += 1) {
    const night = new Date(arrival);
    night.setDate(night.getDate() + days - 1);
    if (
      wanted.some(
        ([roomType, count]) => capacityLeftOn(state, roomType, night, exceptId) < count,
      )
    ) {
      return days - 1;
    }
  }
  return STAY_MAX_DAYS;
}

// Single-type convenience for callers that predate multi-room requests.
export function maxStayDays(state, roomType, isoDate, { current } = {}) {
  return maxStayDaysForRequest(
    state,
    { [roomType]: 1 },
    isoDate,
    { current },
  );
}

// Which type/night pairs of the proposal would be over capacity, in stay
// order. The proposal itself counts as its full room count on every night.
function overbookedNights(state, values, { exceptId = null } = {}) {
  const arrival = parseDate(values.arrivalDate);
  const days = Number(values.days);
  if (
    !arrival ||
    !Number.isInteger(days) ||
    days < STAY_MIN_DAYS ||
    days > STAY_MAX_DAYS
  ) {
    return [];
  }

  const counts = reservationRoomCounts(values);
  const wanted = ROOM_TYPES.map(({ value }) => [value, counts[value]]).filter(
    ([, count]) => count > 0,
  );

  const over = [];
  for (let index = 0; index < days; index += 1) {
    const night = new Date(arrival);
    night.setDate(night.getDate() + index);

    for (const [roomType, count] of wanted) {
      const left = capacityLeftOn(state, roomType, night, exceptId);
      if (left < count) {
        over.push({
          roomType,
          isoDate: toISODate(night),
          left: Math.max(0, left),
        });
      }
    }
  }
  return over;
}

// How many rooms could still be sold for this date — the number every
// calendar cell shows. Per type: rooms not out of order for that night and not
// held by a live stay, minus the nights not-checked-in bookings cover; clamped
// at 0 so data written before the guards can never show -1. Checked-in records
// are skipped: their room's live stay already accounts them.
export function availabilityOn(state, isoDate) {
  const night = parseDate(isoDate);
  const rooms = state.rooms ?? [];

  const byType = ROOM_TYPES.map(({ value }) => {
    const owned = rooms.filter((room) => room.type === value);
    if (!night || owned.length === 0) {
      return { type: value, total: owned.length, free: 0 };
    }

    // Same supply and demand the booking guard walks, so a cell can never
    // disagree with what the form would accept.
    const sellable = sellableOn(state, value, night);
    const booked = pendingOn(state, value, night, null);

    return { type: value, total: owned.length, free: Math.max(0, sellable - booked) };
  });

  return {
    free: byType.reduce((sum, entry) => sum + entry.free, 0),
    total: byType.reduce((sum, entry) => sum + entry.total, 0),
    byType,
  };
}

// Whether a whole request — counts of rooms per type for `days` nights — can
// start on this date. Every requested type needs that many rooms free on every
// night of [arrival, arrival + days), checked against the same supply and
// demand the booking guard uses. Malformed requests never fit, so a half-typed
// filter cannot mark dates.
export function requestFitsOn(state, isoDate, { days, counts } = {}) {
  const arrival = parseDate(isoDate);
  const nights = Number(days);

  if (
    !arrival ||
    !Number.isInteger(nights) ||
    nights < STAY_MIN_DAYS ||
    nights > STAY_MAX_DAYS ||
    !counts ||
    typeof counts !== "object"
  ) {
    return false;
  }

  const wanted = ROOM_TYPES.map(({ value }) => [
    value,
    Number(counts[value] ?? 0),
  ]).filter(([, count]) => count > 0);

  if (wanted.length === 0) return false;
  if (wanted.some(([, count]) => !Number.isInteger(count))) return false;

  for (let index = 0; index < nights; index += 1) {
    const night = new Date(arrival);
    night.setDate(night.getDate() + index);
    if (
      wanted.some(
        ([roomType, count]) => capacityLeftOn(state, roomType, night) < count,
      )
    ) {
      return false;
    }
  }

  return true;
}

// Which free rooms each arriving booking holds, derived fresh on every render:
// nothing is stored, so occupying, OOS-ing or cleaning a held room simply
// moves the marker to the next free match with no write and no drift. A booking
// reserves as many rooms as its counts ask for; partial assignment is possible
// and checkInReservation refuses it. Order matters: the straddling no-show
// about to expire gets first pick, then the stable list order the sections
// already show; rooms follow sortRooms.
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
    const counts = reservationRoomCounts(reservation);

    for (const { value } of ROOM_TYPES) {
      for (let index = 0; index < counts[value]; index += 1) {
        const room = free.find(
          (candidate) =>
            candidate.type === value && !taken.has(candidate.id),
        );
        if (!room) break;

        taken.add(room.id);
        assignment.set(room.id, reservation);
      }
    }
  }

  return assignment;
}

// Every room the derived assignment holds for one booking, in room order.
export function arrivingRoomIds(state, id, now = new Date()) {
  return [...arrivingAssignment(state, now)]
    .filter(([, held]) => held.id === id)
    .map(([roomId]) => roomId);
}

// One state transition: every assigned room takes the stay timer exactly as a
// manual set-occupied would — so the 10:00 boundary, the countdown label and
// the night-of rule all apply from now — and the booking moves into the
// register as checked-in. Refuses (same reference) unless the booking is inside
// its arrival window and every room it asks for is actually held for it.
export function checkInReservation(state, id, now = new Date()) {
  const reservation = (state.reservations ?? []).find(
    (candidate) => candidate.id === id,
  );
  if (!reservation || !isArrivingNow(reservation, now)) return state;

  const needed = reservationRoomTotal(reservation);
  const roomIds = arrivingRoomIds(state, id, now);
  if (needed === 0 || roomIds.length < needed) return state;

  // The stay must not strand another booking — the same conflict the days
  // form shows an error for; here it is a same-reference refusal.
  if (
    occupancyConflictForRooms(state, roomIds, reservation.days, now, {
      exceptId: id,
    })
  ) {
    return state;
  }

  const days = Number(reservation.days);
  if (!Number.isInteger(days) || days < STAY_MIN_DAYS || days > STAY_MAX_DAYS) {
    return state;
  }

  let withStays = state;
  for (const roomId of roomIds) {
    withStays = setRoomState(withStays, roomId, "occupied", { days, now });
  }

  const assignedRooms = roomIds
    .map((roomId) => (withStays.rooms ?? []).find((room) => room.id === roomId))
    .filter(Boolean);

  return {
    ...withStays,
    // Check-in is a hand-over to housekeeping: the booking is history now. The
    // rooms' live stays carry occupancy from here.
    reservations: withStays.reservations.filter(
      (candidate) => candidate.id !== id,
    ),
    register: [
      registerEntry(reservation, "checked_in", {
        registeredAt: now.toISOString(),
        assignedRooms,
      }),
      ...(withStays.register ?? []),
    ],
  };
}

function isNoShow(reservation, now) {
  if (reservation.checkedInAt) return false;

  const end = noShowCutoff(reservation.arrivalDate);
  return end !== null && now >= end;
}

// Move bookings whose arrival window closed unvalidated into the register as
// no-shows, newest event first. Same contract as reconcileExpiries: identical
// reference when nothing expired.
export function reconcileReservations(state, now = new Date()) {
  const reservations = state.reservations ?? [];
  const expired = reservations.filter((reservation) =>
    isNoShow(reservation, now),
  );
  if (expired.length === 0) return state;

  const kept = reservations.filter(
    (reservation) => !isNoShow(reservation, now),
  );
  const entries = expired.map((reservation) =>
    registerEntry(reservation, "no_show", {
      // Record when the booking actually lapsed, not when the tab woke up.
      registeredAt:
        noShowCutoff(reservation.arrivalDate)?.toISOString() ??
        now.toISOString(),
    }),
  );

  return {
    ...state,
    reservations: kept,
    register: [...entries, ...(state.register ?? [])],
  };
}

// Earliest moment reservations change on their own: midnight rolls the
// sections and starts new arrival windows, a cutoff closes a no-show.
// Past cutoffs are skipped — migration/reconcile move those first.
export function nextReservationBoundary(state, now = new Date()) {
  const midnight = startOfDay(now);
  midnight.setDate(midnight.getDate() + 1);
  let best = midnight.getTime();

  for (const reservation of state.reservations ?? []) {
    if (reservation.checkedInAt) continue;

    const end = noShowCutoff(reservation.arrivalDate);
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
