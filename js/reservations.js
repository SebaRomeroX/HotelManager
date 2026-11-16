import {
  ROOM_TYPES,
  STAY_MAX_DAYS,
  STAY_MIN_DAYS,
  setRoomState,
  sortRooms,
  updateRoom,
} from "./rooms.js";
import {
  formatDate,
  isArrivingNow,
  isPastReservation,
  isReadOnlyReservation,
  noShowCutoff,
  parseDate,
  startOfDay,
} from "./dates.js";
import {
  reservationRoomCounts,
  reservationRoomTotal,
} from "./reservation-record.js";
import { registerEntry } from "./register.js";
import {
  occupancyConflictForRooms,
  reservationAvailabilityError,
} from "./capacity.js";

export const RESERVATION_NAME_MAX = 80;

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

// The arriving booking that holds this room, or null. A hand state change must
// not break a live hold: the booking is standing at the desk expecting this
// exact room, and moving it to OOS or cleaning would leave the arrival short.
export function arrivingHold(state, roomId, now = new Date()) {
  return arrivingAssignment(state, now).get(roomId) ?? null;
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

// The rooms a checked-in entry still holds: assigned, occupied, and started by
// this very check-in. Comparing the stay stamp is what stops an old entry from
// touching a room that has since been re-let.
function checkedInRoomIds(state, entry) {
  const assigned = new Set(
    (entry.assignedRooms ?? []).map(({ id }) => id),
  );

  return (state.rooms ?? [])
    .filter(
      (room) =>
        assigned.has(room.id) &&
        room.state === "occupied" &&
        room.stayStartedAt === entry.registeredAt,
    )
    .map((room) => room.id);
}

// A check-out uses the register's checked-in entry because the active list no
// longer holds in-house stays. Every room this check-in actually started goes
// to "To clean" now, and the entry records when the guest left. The status
// stays checked_in: it is how the booking left the active list, while
// checkedOutAt is the later housekeeping event. Already cleaned or otherwise
// changed rooms are left alone.
export function checkOutRegisterEntry(state, id, now = new Date()) {
  const register = state.register ?? [];
  const entry = register.find((candidate) => candidate.id === id);
  if (!entry || entry.status !== "checked_in" || entry.checkedOutAt) {
    return state;
  }

  let next = state;
  for (const roomId of checkedInRoomIds(state, entry)) {
    next = setRoomState(next, roomId, "dirty");
  }

  return {
    ...next,
    register: (next.register ?? register).map((candidate) =>
      candidate.id === id
        ? { ...candidate, checkedOutAt: now.toISOString() }
        : candidate,
    ),
  };
}

// Why a duration change to a checked-in stay cannot be applied, or null. The
// register entry is the booking record; its duration must still fit the
// rooms' shared timer and must not strand a later booking.
export function checkedInStayDaysError(state, id, days, now = new Date()) {
  const entry = (state.register ?? []).find((candidate) => candidate.id === id);
  if (!entry || entry.status !== "checked_in" || entry.checkedOutAt) {
    return "That stay is no longer active.";
  }

  const count = Number(days);
  if (!Number.isInteger(count) || count < STAY_MIN_DAYS || count > STAY_MAX_DAYS) {
    return `Enter a number of days between ${STAY_MIN_DAYS} and ${STAY_MAX_DAYS}.`;
  }

  const roomIds = checkedInRoomIds(state, entry);
  if (roomIds.length === 0) return "That stay has already ended.";

  const conflict = occupancyConflictForRooms(state, roomIds, count, now, {
    startedAt: entry.registeredAt,
  });
  if (conflict) {
    return (
      `That stay overlaps ${conflict.hostName}'s arrival on ` +
      `${formatDate(conflict.arrivalDate)}.`
    );
  }

  return null;
}

// Change the duration of a checked-in stay. The register record and every room
// timer it still holds move together, and the original stayStartedAt is kept so
// an extension counts from the arrival day instead of restarting the stay now.
export function updateCheckedInStayDays(state, id, days, now = new Date()) {
  if (checkedInStayDaysError(state, id, days, now)) return state;

  const entry = state.register.find((candidate) => candidate.id === id);
  const count = Number(days);
  const roomIds = new Set(checkedInRoomIds(state, entry));

  let next = state;
  let roomsChanged = false;
  for (const room of state.rooms ?? []) {
    if (!roomIds.has(room.id) || room.stayDays === count) continue;
    next = updateRoom(next, room.id, { stayDays: count });
    roomsChanged = true;
  }

  const daysChanged = entry.days !== count;
  if (!roomsChanged && !daysChanged) return state;

  return {
    ...next,
    register: (next.register ?? state.register).map((candidate) =>
      candidate.id === id ? { ...candidate, days: count } : candidate,
    ),
  };
}

// How old a finished register entry must be before "Clear old" may drop it.
// A month keeps recent history at hand while still bounding a store that never
// prunes on its own.
export const REGISTER_PRUNE_DAYS = 30;

// The entries a prune may remove. Checked-in stays stay in the register until
// they are checked out, however old they are: the entry is the only handle on
// a stay, and it is also how an early departure is recorded later. Finished
// events (cancelled, no-show and checked-out stays) retire after the window.
// The live-room guard is belt and braces: a closed entry should not own a room
// any more, and if it somehow does, history keeps it.
export function prunableRegisterEntries(state, now = new Date()) {
  const cutoff = now.getTime() - REGISTER_PRUNE_DAYS * 24 * 60 * 60 * 1000;

  return (state.register ?? []).filter((entry) => {
    if (entry.status === "checked_in" && !entry.checkedOutAt) return false;
    if (checkedInRoomIds(state, entry).length > 0) return false;

    // The clock starts when the record closed: a guest who arrived forty days
    // ago but left today has only just become history.
    const stamp = new Date(entry.checkedOutAt ?? entry.registeredAt).getTime();
    return Number.isFinite(stamp) && stamp < cutoff;
  });
}

export function pruneRegister(state, now = new Date()) {
  const drop = prunableRegisterEntries(state, now);
  if (drop.length === 0) return state;

  const ids = new Set(drop.map((entry) => entry.id));
  return {
    ...state,
    register: (state.register ?? []).filter((entry) => !ids.has(entry.id)),
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

// The domain is split by concern now: dates.js owns calendar math,
// capacity.js owns what the property can sell, register.js owns history
// snapshots and reservation-record.js owns the stored booking shape. This
// module keeps the booking lifecycle and re-exports the rest so every caller
// still has one import.
export {
  checkoutDate,
  formatDate,
  isArrivingNow,
  isPastReservation,
  isReadOnlyReservation,
  noShowCutoff,
  parseDate,
  relativeDayLabel,
} from "./dates.js";
export {
  reservationMeta,
  reservationRoomCounts,
  reservationRoomTotal,
  roomCountsLabel,
} from "./reservation-record.js";
export {
  REGISTER_FILTERS,
  REGISTER_STATUS_LABELS,
  clearRegister,
  filterRegisterEntries,
  registerCounts,
  registerEntry,
  registerStatusLabel,
  removeRegisterEntry,
  sortRegister,
} from "./register.js";
export {
  availabilityOn,
  bookableRoomTypes,
  maxStayDays,
  maxStayDaysForRequest,
  occupancyConflict,
  occupancyConflictForRooms,
  reservationAvailabilityError,
  requestFitsOn,
  roomRemovalConflict,
} from "./capacity.js";
