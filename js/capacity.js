import {
  DAY_BOUNDARY_HOUR,
  ROOM_TYPES,
  STAY_MAX_DAYS,
  STAY_MIN_DAYS,
  oosCoversNight,
  stayExpiry,
  typeLabel,
} from "./rooms.js";
import {
  formatDate,
  isArrivingNow,
  isPastReservation,
  parseDate,
  startOfDay,
  toISODate,
} from "./dates.js";
import { reservationRoomCounts } from "./reservation-record.js";

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
// startedAt is the original check-in stamp when extending an in-house stay. It
// keeps the expiry on the stay's own arrival day instead of restarting the
// count from now, which would overstate how long the rooms are held.
export function occupancyConflictForRooms(
  state,
  roomIds,
  days,
  now = new Date(),
  { exceptId = null, startedAt = null } = {},
) {
  const rooms = state.rooms ?? [];
  const taking = new Set(roomIds);
  if (roomIds.length === 0) return null;
  if (roomIds.some((id) => !rooms.some((room) => room.id === id))) return null;

  const count = Number(days);
  if (!Number.isInteger(count) || count < STAY_MIN_DAYS || count > STAY_MAX_DAYS) {
    return null; // setRoomState refuses these anyway
  }

  const expiry = stayExpiry(startedAt ?? now.toISOString(), count);
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

// Deleting a room removes supply a pending booking may already have been sold
// against, and unlike retyping or renaming it cannot be repaired by editing
// the room again. Walk every pending booking, in arrival order, against the
// desk without the room and return the first booking (and the night) that
// would no longer fit. Checked-in stays are skipped because their room is
// already out of supply; history entries are snapshots that keep their room
// names on purpose, so they can never block a delete.
export function roomRemovalConflict(state, roomId, now = new Date()) {
  const room = (state.rooms ?? []).find((candidate) => candidate.id === roomId);
  if (!room) return null;

  const without = {
    ...state,
    rooms: state.rooms.filter((candidate) => candidate.id !== roomId),
  };

  const pending = (state.reservations ?? [])
    .filter(
      (reservation) =>
        !reservation.checkedInAt && !isPastReservation(reservation, now),
    )
    .sort(byArrival);

  for (const reservation of pending) {
    const arrival = parseDate(reservation.arrivalDate);
    const days = Number(reservation.days);
    if (!arrival || !Number.isInteger(days) || days < 1) continue;

    const counts = reservationRoomCounts(reservation);
    const wanted = ROOM_TYPES.map(({ value }) => value).filter(
      (roomType) => (counts[roomType] ?? 0) > 0,
    );

    for (let index = 0; index < days; index += 1) {
      const night = new Date(arrival);
      night.setDate(night.getDate() + index);

      for (const roomType of wanted) {
        const left = capacityLeftOn(without, roomType, night, reservation.id);
        if (left < (counts[roomType] ?? 0)) {
          return { reservation, roomType, isoDate: toISODate(night) };
        }
      }
    }
  }

  return null;
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
