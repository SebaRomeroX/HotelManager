import test from "node:test";
import assert from "node:assert/strict";

import {
  CLEANING_MINUTES,
  DAY_BOUNDARY_HOUR,
  OOS_MAX_DAYS,
  OOS_MAX_HOURS,
  STAY_MAX_DAYS,
  cleaningMinutesLeft,
  nextCleaningStep,
  nextOosStep,
  oosCoversNight,
  oosRemainingLabel,
  oosUntilFromDuration,
  reconcileExpiries,
  remainingDays,
  roomStateText,
  setRoomState,
  sortRooms,
  stayExpiry,
} from "../js/rooms.js";

import {
  addReservation,
  arrivingAssignment,
  arrivingRoomIds,
  availabilityOn,
  bookableRoomTypes,
  checkInReservation,
  checkoutDate,
  clearRegister,
  formatDate,
  groupReservations,
  isArrivingNow,
  isPastReservation,
  maxStayDays,
  maxStayDaysForRequest,
  nextReservationBoundary,
  noShowCutoff,
  occupancyConflict,
  occupancyConflictForRooms,
  parseDate,
  reconcileReservations,
  registerEntry,
  registerStatusLabel,
  relativeDayLabel,
  removeRegisterEntry,
  removeReservation,
  requestFitsOn,
  reservationAvailabilityError,
  reservationError,
  reservationMeta,
  reservationRoomCounts,
  reservationRoomTotal,
  roomCountsLabel,
  roomRemovalConflict,
  sortRegister,
  sortReservations,
  updateReservation,
} from "../js/reservations.js";

import { migrate } from "../js/store.js";

// All dates are local, like the app. A UTC parse would shift in some zones.
const NOW = new Date(2026, 10, 12, 12, 0, 0, 0);

function isoOf(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function iso(offsetDays, base = NOW) {
  const date = new Date(base);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return isoOf(date);
}

function at(month, day, hour = 12, minute = 0) {
  return new Date(2026, month - 1, day, hour, minute, 0, 0);
}

function room(name, type, state = "vacant", extra = {}) {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    type,
    state,
    ...extra,
  };
}

function defaultRooms() {
  return [
    room("Small 1", "small"),
    room("Small 2", "small"),
    room("Small 3", "small"),
    room("Large 1", "large"),
    room("Suite 1", "suite"),
  ];
}

function makeState({ rooms = defaultRooms(), reservations = [], register = [] } = {}) {
  return { version: 4, rooms, reservations, register };
}

function booking({
  id = "res-1",
  hostName = "Guest",
  counts = { small: 1 },
  arrivalDate = iso(1),
  days = 1,
  ...rest
} = {}) {
  return {
    id,
    hostName,
    roomCounts: { small: 0, large: 0, suite: 0, ...counts },
    arrivalDate,
    days,
    createdAt: NOW.toISOString(),
    ...rest,
  };
}

// ---------------------------------------------------------------- dates

test("parseDate accepts real local dates and rejects rolled-over ones", () => {
  const date = parseDate("2026-11-12");
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 10);
  assert.equal(date.getDate(), 12);

  assert.equal(parseDate("2026-02-30"), null);
  assert.equal(parseDate("2026-13-01"), null);
  assert.equal(parseDate("12/11/2026"), null);
  assert.equal(parseDate(null), null);
});

test("checkoutDate adds nights and formatDate shortens month names", () => {
  assert.equal(checkoutDate("2026-11-12", 4), "2026-11-16");
  assert.equal(checkoutDate("2026-11-12", 1), "2026-11-13");
  assert.equal(checkoutDate("not-a-date", 2), null);
  assert.equal(formatDate("2026-11-12"), "Nov 12");
  assert.equal(formatDate("garbage"), "garbage");
});

test("relativeDayLabel names today, tomorrow and a past day", () => {
  assert.equal(relativeDayLabel(iso(0), NOW), "Today");
  assert.equal(relativeDayLabel(iso(1), NOW), "Tomorrow");
  assert.equal(relativeDayLabel(iso(3), NOW), "In 3 days");
  assert.equal(relativeDayLabel(iso(-1), NOW), "Yesterday");
  assert.equal(relativeDayLabel(iso(-3), NOW), "3 days ago");
  assert.equal(relativeDayLabel("garbage", NOW), "");
});

// ------------------------------------------------------- room count shape

test("legacy roomType records read as one room of that type", () => {
  const counts = reservationRoomCounts({ roomType: "large" });
  assert.deepEqual(counts, { small: 0, large: 1, suite: 0 });
  assert.equal(reservationRoomTotal({ roomType: "large" }), 1);
});

test("reservation counts tolerate invalid values but never invent rooms", () => {
  assert.deepEqual(
    reservationRoomCounts({ roomCounts: { small: 2, large: -1, suite: 1.5 } }),
    { small: 2, large: 0, suite: 0 },
  );
  assert.equal(reservationRoomTotal({ roomCounts: { small: 2, suite: 3 } }), 5);
  assert.equal(reservationRoomTotal({}), 0);
});

test("roomCountsLabel uses one wording for every count shape", () => {
  assert.equal(roomCountsLabel({ small: 1 }), "1 Small room");
  assert.equal(roomCountsLabel({ small: 3 }), "3 Small rooms");
  assert.equal(roomCountsLabel({ suite: 1 }), "1 Suite");
  assert.equal(roomCountsLabel({ suite: 2 }), "2 Suites");
  assert.equal(
    roomCountsLabel({ small: 2, suite: 1 }),
    "2 Small rooms and 1 Suite",
  );
  assert.equal(
    roomCountsLabel({ small: 1, large: 2, suite: 1 }),
    "1 Small room, 2 Large rooms and 1 Suite",
  );
  assert.equal(roomCountsLabel({}), "No rooms");
});

// --------------------------------------------------------- reservations

test("reservationError accepts a normal multi-room request", () => {
  assert.equal(
    reservationError(
      {
        hostName: "Group",
        roomCounts: { small: 2, large: 0, suite: 1 },
        arrivalDate: iso(1),
        days: "3",
      },
      NOW,
    ),
    null,
  );
});

test("reservationError rejects missing names, impossible counts and dates", () => {
  const base = {
    hostName: "Guest",
    roomCounts: { small: 1 },
    arrivalDate: iso(1),
    days: 1,
  };

  assert.equal(reservationError({ ...base, hostName: "  " }, NOW).field, "hostName");
  assert.equal(
    reservationError({ ...base, hostName: "x".repeat(81) }, NOW).field,
    "hostName",
  );
  assert.equal(
    reservationError({ ...base, roomCounts: { small: 0 } }, NOW).field,
    "rooms",
  );
  assert.equal(
    reservationError({ ...base, roomCounts: { small: 1.5 } }, NOW).field,
    "rooms",
  );
  assert.equal(
    reservationError({ ...base, roomCounts: { small: -1 } }, NOW).field,
    "rooms",
  );
  assert.equal(
    reservationError({ ...base, arrivalDate: "2026-02-30" }, NOW).field,
    "arrivalDate",
  );
  assert.equal(
    reservationError({ ...base, arrivalDate: iso(-1) }, NOW).field,
    "arrivalDate",
  );
  assert.equal(reservationError({ ...base, days: 0 }, NOW).field, "days");
  assert.equal(reservationError({ ...base, days: 366 }, NOW).field, "days");
});

test("an unchanged past arrival is allowed inside the no-show window", () => {
  const straddling = iso(-1);
  const values = {
    hostName: "Late",
    roomCounts: { small: 1 },
    arrivalDate: straddling,
    days: 1,
  };

  assert.equal(
    reservationError(values, NOW, { currentDate: straddling }),
    null,
  );
  assert.equal(
    reservationError({ ...values, arrivalDate: iso(-2) }, NOW, {
      currentDate: straddling,
    }).field,
    "arrivalDate",
  );
});

test("addReservation stores counts, trims the name and refuses overbooking", () => {
  const state = makeState();
  const added = addReservation(
    state,
    {
      hostName: "  Group  ",
      roomCounts: { small: 2, large: 0, suite: 1 },
      arrivalDate: iso(1),
      days: "3",
    },
    NOW,
  );

  assert.equal(added.reservations.length, 1);
  assert.equal(added.reservations[0].hostName, "Group");
  assert.deepEqual(added.reservations[0].roomCounts, {
    small: 2,
    large: 0,
    suite: 1,
  });
  assert.equal(added.reservations[0].days, 3);

  const refused = addReservation(
    state,
    {
      hostName: "Too many",
      roomCounts: { small: 4 },
      arrivalDate: iso(1),
      days: 1,
    },
    NOW,
  );
  assert.equal(refused, state);
});

test("updateReservation changes only the stay details", () => {
  const state = makeState({
    reservations: [booking({ counts: { small: 2 }, arrivalDate: iso(2), days: 2 })],
  });
  const id = state.reservations[0].id;

  const updated = updateReservation(
    state,
    id,
    {
      hostName: "ignored",
      roomCounts: { small: 1, suite: 1 },
      arrivalDate: iso(3),
      days: "4",
    },
    NOW,
  );

  assert.equal(updated.reservations.length, 1);
  assert.equal(updated.reservations[0].hostName, "Guest");
  assert.deepEqual(updated.reservations[0].roomCounts, {
    small: 1,
    large: 0,
    suite: 1,
  });
  assert.equal(updated.reservations[0].arrivalDate, iso(3));
  assert.equal(updated.reservations[0].days, 4);
  assert.equal(state.reservations[0].days, 2);
});

test("read-only, missing and invalid reservations do not move", () => {
  const state = makeState({
    reservations: [
      booking({ id: "past", arrivalDate: iso(-3), days: 1 }),
      booking({ id: "history", arrivalDate: iso(1), checkedInAt: NOW.toISOString() }),
    ],
  });

  for (const id of ["past", "history", "missing"]) {
    const next = updateReservation(
      state,
      id,
      {
        hostName: "Guest",
        roomCounts: { small: 1 },
        arrivalDate: iso(4),
        days: 1,
      },
      NOW,
    );
    assert.equal(next, state);
  }

  const invalid = updateReservation(
    state,
    "past",
    { hostName: "", roomCounts: { small: 1 }, arrivalDate: iso(4), days: 1 },
    NOW,
  );
  assert.equal(invalid, state);
});

test("cancelling copies the booking into the register and frees its rooms", () => {
  const state = makeState({
    reservations: [booking({ counts: { small: 2, suite: 1 }, arrivalDate: iso(1) })],
  });
  const removed = removeReservation(state, "res-1", NOW);

  assert.equal(removed.reservations.length, 0);
  assert.equal(removed.register.length, 1);
  assert.equal(removed.register[0].status, "cancelled");
  assert.equal(removed.register[0].roomCounts.small, 2);
  assert.equal(registerStatusLabel("cancelled"), "Cancelled");
  assert.equal(availabilityOn(removed, iso(1)).free, 5);
  assert.equal(removeReservation(state, "missing", NOW), state);
});

test("reservationMeta carries rooms, dates and duration", () => {
  const meta = reservationMeta(
    booking({ counts: { small: 3 }, arrivalDate: "2026-11-12", days: 4 }),
  );
  assert.equal(meta, "3 Small rooms · Nov 12 → Nov 16 · 4 days");
});

// ----------------------------------------------------------- availability

test("availability counts rooms free per type and per night", () => {
  const state = makeState({
    reservations: [booking({ counts: { small: 3 }, arrivalDate: iso(1), days: 4 })],
  });

  const arrival = availabilityOn(state, iso(1));
  assert.equal(arrival.free, 2);
  assert.equal(arrival.total, 5);
  assert.deepEqual(
    arrival.byType.find((entry) => entry.type === "small"),
    { type: "small", total: 3, free: 0 },
  );

  const lastNight = availabilityOn(state, iso(4));
  assert.equal(lastNight.byType.find((entry) => entry.type === "small").free, 0);

  const checkout = availabilityOn(state, iso(5));
  assert.equal(checkout.byType.find((entry) => entry.type === "small").free, 3);
});

test("pending demand sums each booking's counts, not its record count", () => {
  const oneGroup = makeState({
    reservations: [booking({ counts: { small: 2 }, arrivalDate: iso(0), days: 1 })],
  });
  const twoSingles = makeState({
    reservations: [
      booking({ id: "a", counts: { small: 1 }, arrivalDate: iso(0), days: 1 }),
      booking({ id: "b", counts: { small: 1 }, arrivalDate: iso(0), days: 1 }),
    ],
  });

  assert.equal(availabilityOn(oneGroup, iso(0)).free, availabilityOn(twoSingles, iso(0)).free);
  assert.equal(availabilityOn(oneGroup, iso(0)).byType[0].free, 1);
});

test("out-of-order rooms leave supply for the nights they cover", () => {
  const until = oosUntilFromDuration(2, "days", NOW);
  const state = makeState({
    rooms: [
      room("Small 1", "small", "oos", {
        oosUntil: until.toISOString(),
        oosUnit: "days",
      }),
      room("Small 2", "small"),
    ],
  });

  assert.equal(availabilityOn(state, iso(0)).byType[0].free, 1);
  assert.equal(availabilityOn(state, iso(1)).byType[0].free, 1);
  assert.equal(availabilityOn(state, iso(2)).byType[0].free, 2);
});

test("availability clamps overbooked data at zero instead of going negative", () => {
  const state = makeState({
    rooms: [room("Small 1", "small"), room("Small 2", "small")],
    reservations: [booking({ counts: { small: 5 }, arrivalDate: iso(0), days: 2 })],
  });

  const today = availabilityOn(state, iso(0));
  assert.equal(today.byType[0].free, 0);
  assert.equal(today.free, 0);
});

test("availability with an invalid date reports totals but no free rooms", () => {
  const result = availabilityOn(makeState(), "garbage");
  assert.equal(result.total, 5);
  assert.equal(result.free, 0);
});

test("bookableRoomTypes drops sold-out types and respects the current edit", () => {
  const state = makeState({
    reservations: [booking({ id: "edit", counts: { small: 3 }, arrivalDate: iso(1) })],
  });

  assert.deepEqual(bookableRoomTypes(state, iso(1)), ["large", "suite"]);
  assert.deepEqual(
    bookableRoomTypes(state, iso(1), { current: state.reservations[0] }),
    ["small", "large", "suite"],
  );
  assert.deepEqual(bookableRoomTypes(state, "garbage"), []);
});

test("reservationAvailabilityError names the type and date that is short", () => {
  const state = makeState({
    rooms: [room("Small 1", "small"), room("Small 2", "small")],
  });
  const problem = reservationAvailabilityError(state, {
    hostName: "Guest",
    roomCounts: { small: 3 },
    arrivalDate: iso(1),
    days: 1,
  });

  assert.equal(problem.field, "rooms");
  assert.match(problem.message, /Only 2 Small rooms are free/);
});

test("requestFitsOn checks every requested room on every night", () => {
  const state = makeState({
    reservations: [booking({ counts: { small: 2 }, arrivalDate: iso(2), days: 1 })],
  });

  assert.equal(
    requestFitsOn(state, iso(0), { days: 2, counts: { small: 2 } }),
    true,
  );
  assert.equal(
    requestFitsOn(state, iso(0), { days: 4, counts: { small: 2 } }),
    false,
  );
  assert.equal(
    requestFitsOn(state, iso(2), { days: 1, counts: { small: 3 } }),
    false,
  );
});

test("requestFitsOn refuses malformed or empty requests", () => {
  const state = makeState();
  assert.equal(requestFitsOn(state, iso(0), { days: 0, counts: { small: 1 } }), false);
  assert.equal(requestFitsOn(state, iso(0), { days: 1, counts: {} }), false);
  assert.equal(requestFitsOn(state, iso(0), { days: 1, counts: { small: 1.5 } }), false);
  assert.equal(requestFitsOn(state, "garbage", { days: 1, counts: { small: 1 } }), false);
  assert.equal(requestFitsOn(state, iso(0), undefined), false);
});

test("maxStayDaysForRequest stops at the first night that cannot hold the group", () => {
  const state = makeState({
    reservations: [booking({ counts: { small: 2 }, arrivalDate: iso(2), days: 1 })],
  });

  assert.equal(maxStayDaysForRequest(state, { small: 3 }, iso(0)), 2);
  assert.equal(maxStayDaysForRequest(state, { small: 4 }, iso(0)), 0);
  assert.equal(maxStayDaysForRequest(state, { small: 1 }, iso(0)), STAY_MAX_DAYS);
  assert.equal(maxStayDays(state, "small", iso(0)), STAY_MAX_DAYS);
});

// -------------------------------------------------------------- arrivals

test("arrivingAssignment holds every requested room for the first booking", () => {
  const state = makeState({
    reservations: [booking({ counts: { small: 3 }, arrivalDate: iso(0), days: 2 })],
  });

  const assignment = arrivingAssignment(state, NOW);
  assert.equal(assignment.size, 3);
  assert.equal([...assignment.values()].every((held) => held.id === "res-1"), true);
  assert.deepEqual(arrivingRoomIds(state, "res-1", NOW), [
    "small-1",
    "small-2",
    "small-3",
  ]);
});

test("check-in is atomic across the whole reservation", () => {
  const state = makeState({
    reservations: [
      booking({ counts: { small: 3 }, arrivalDate: iso(0), days: 2 }),
    ],
  });
  const checkedIn = checkInReservation(state, "res-1", NOW);

  assert.equal(checkedIn.reservations.length, 0);
  assert.equal(checkedIn.rooms.filter((candidate) => candidate.state === "occupied").length, 3);
  assert.equal(checkedIn.register.length, 1);
  assert.equal(checkedIn.register[0].status, "checked_in");
  assert.deepEqual(
    checkedIn.register[0].assignedRooms.map(({ name }) => name),
    ["Small 1", "Small 2", "Small 3"],
  );

  // Pure transition: the source booking and rooms are untouched.
  assert.equal(state.reservations.length, 1);
  assert.equal(state.rooms.filter((candidate) => candidate.state === "occupied").length, 0);
});

test("check-in refuses future, missing and partially available bookings", () => {
  const future = makeState({
    reservations: [booking({ arrivalDate: iso(1) })],
  });
  assert.equal(checkInReservation(future, "res-1", NOW), future);

  const missing = makeState();
  assert.equal(checkInReservation(missing, "missing", NOW), missing);

  const partial = makeState({
    rooms: [room("Small 1", "small"), room("Small 2", "small")],
    reservations: [booking({ counts: { small: 3 }, arrivalDate: iso(0) })],
  });
  assert.equal(checkInReservation(partial, "res-1", NOW), partial);
});

test("check-in refuses a stay that would strand a later booking", () => {
  const state = makeState({
    reservations: [
      booking({ id: "now", counts: { small: 2 }, arrivalDate: iso(0), days: 5 }),
      booking({ id: "later", counts: { small: 2 }, arrivalDate: iso(3), days: 1 }),
    ],
  });

  assert.equal(checkInReservation(state, "now", NOW), state);
  const conflict = occupancyConflictForRooms(
    state,
    ["small-1", "small-2"],
    5,
    NOW,
    { exceptId: "now" },
  );
  assert.equal(conflict.id, "later");
});

test("the single-room occupancy guard delegates to the group guard", () => {
  const state = makeState({
    rooms: [room("Small 1", "small")],
    reservations: [booking({ counts: { small: 1 }, arrivalDate: iso(3), days: 1 })],
  });

  assert.equal(occupancyConflict(state, "small-1", 5, NOW).id, "res-1");
  assert.equal(occupancyConflict(state, "missing", 5, NOW), null);
  assert.equal(occupancyConflictForRooms(state, [], 5, NOW), null);
  assert.equal(occupancyConflictForRooms(state, ["small-1"], 0, NOW), null);
});

// ---------------------------------------------------- destructive edits

test("deleting a room a pending booking still needs is refused", () => {
  const state = makeState({
    rooms: [room("Small 1", "small")],
    reservations: [
      booking({
        hostName: "Ada Lovelace",
        counts: { small: 1 },
        arrivalDate: iso(2),
        days: 2,
      }),
    ],
  });

  const conflict = roomRemovalConflict(state, "small-1", NOW);
  assert.equal(conflict.reservation.id, "res-1");
  assert.equal(conflict.reservation.hostName, "Ada Lovelace");
  assert.equal(conflict.roomType, "small");
  assert.equal(conflict.isoDate, iso(2));
});

test("the removal guard checks every night of the booking", () => {
  const state = makeState({
    rooms: [room("Small 1", "small"), room("Small 2", "small")],
    reservations: [
      booking({
        id: "long",
        hostName: "Ada",
        counts: { small: 1 },
        arrivalDate: iso(1),
        days: 3,
      }),
      booking({
        id: "later",
        hostName: "Bo",
        counts: { small: 1 },
        arrivalDate: iso(3),
        days: 1,
      }),
    ],
  });

  // Both rooms fit until the third night, where both bookings need one.
  const conflict = roomRemovalConflict(state, "small-1", NOW);
  assert.equal(conflict.reservation.id, "long");
  assert.equal(conflict.isoDate, iso(3));
});

test("a room can go when enough supply remains and history is ignored", () => {
  const state = makeState({
    rooms: [room("Small 1", "small"), room("Small 2", "small")],
    reservations: [booking({ counts: { small: 1 }, arrivalDate: iso(2) })],
    register: [
      {
        id: "history-1",
        hostName: "Past Guest",
        roomCounts: { small: 0, large: 0, suite: 1 },
        arrivalDate: iso(-3),
        days: 1,
        status: "cancelled",
        registeredAt: NOW.toISOString(),
        assignedRooms: [{ id: "suite-1", name: "Suite 1", type: "suite" }],
      },
    ],
  });

  assert.equal(roomRemovalConflict(state, "small-1", NOW), null);
  assert.equal(roomRemovalConflict(state, "missing", NOW), null);
});

// ---------------------------------------------------------- reconciliation

test("no-show reconciliation moves only lapsed bookings", () => {
  const state = makeState({
    reservations: [
      booking({ id: "late", arrivalDate: iso(-1), days: 1 }),
      booking({ id: "future", arrivalDate: iso(2), days: 1 }),
    ],
  });

  const next = reconcileReservations(state, NOW);
  assert.deepEqual(next.reservations.map(({ id }) => id), ["future"]);
  assert.equal(next.register.length, 1);
  assert.equal(next.register[0].status, "no_show");
  assert.equal(next.register[0].registeredAt, noShowCutoff(iso(-1)).toISOString());
  assert.equal(reconcileReservations(next, NOW), next);
});

test("isArrivingNow is the 00:00 to 04:00-next-day window", () => {
  const reservation = booking({ arrivalDate: "2026-11-12", days: 1 });
  assert.equal(isArrivingNow(reservation, at(11, 12, 0, 0)), true);
  assert.equal(isArrivingNow(reservation, at(11, 12, 23, 59)), true);
  assert.equal(isArrivingNow(reservation, at(11, 13, 3, 59)), true);
  assert.equal(isArrivingNow(reservation, at(11, 13, 4, 0)), false);
  assert.equal(isArrivingNow({ ...reservation, checkedInAt: NOW.toISOString() }, NOW), false);
});

test("the next reservation boundary is midnight tonight", () => {
  assert.equal(
    new Date(nextReservationBoundary(makeState(), NOW)).toISOString(),
    at(11, 13, 0, 0).toISOString(),
  );
});

test("isPastReservation follows the same cutoff as reconciliation", () => {
  assert.equal(isPastReservation(booking({ arrivalDate: iso(0) }), NOW), false);
  assert.equal(isPastReservation(booking({ arrivalDate: iso(-1) }), NOW), true);
  assert.equal(isPastReservation(booking({ arrivalDate: "garbage" }), NOW), true);
});

// ------------------------------------------------------- register and list

test("registerEntry snapshots assigned room names and types", () => {
  const entry = registerEntry(
    booking({ counts: { small: 1 } }),
    "checked_in",
    {
      registeredAt: NOW.toISOString(),
      assignedRooms: [{ id: "small-1", name: "Small 1", type: "small", extra: "ignored" }],
    },
  );

  assert.deepEqual(entry.assignedRooms, [
    { id: "small-1", name: "Small 1", type: "small" },
  ]);
  assert.equal(entry.status, "checked_in");
});

test("register helpers sort newest first and remove only existing entries", () => {
  const entries = [
    { id: "old", hostName: "A", registeredAt: at(11, 10, 12).toISOString() },
    { id: "new", hostName: "B", registeredAt: at(11, 12, 12).toISOString() },
    { id: "tie", hostName: "C", registeredAt: at(11, 12, 12).toISOString() },
  ];

  assert.deepEqual(sortRegister(entries).map(({ id }) => id), ["new", "tie", "old"]);

  const state = makeState({ register: entries });
  const removed = removeRegisterEntry(state, "old");
  assert.deepEqual(removed.register.map(({ id }) => id), ["new", "tie"]);
  assert.equal(removeRegisterEntry(state, "missing"), state);

  const cleared = clearRegister(state);
  assert.deepEqual(cleared.register, []);
  assert.equal(clearRegister(cleared), cleared);
});

test("groupReservations separates today, incoming and past", () => {
  const state = makeState({
    reservations: [
      booking({ id: "today-b", hostName: "B", arrivalDate: iso(0) }),
      booking({ id: "today-a", hostName: "A", arrivalDate: iso(0) }),
      booking({ id: "incoming", arrivalDate: iso(2) }),
      booking({ id: "past", arrivalDate: iso(-2) }),
    ],
  });
  const groups = groupReservations(state.reservations, NOW);

  assert.deepEqual(groups.today.map(({ id }) => id), ["today-a", "today-b"]);
  assert.deepEqual(groups.incoming.map(({ id }) => id), ["incoming"]);
  assert.deepEqual(groups.past.map(({ id }) => id), ["past"]);
});

test("sortReservations puts upcoming first and past most-recent first", () => {
  const list = [
    booking({ id: "future-2", arrivalDate: iso(4) }),
    booking({ id: "past-1", arrivalDate: iso(-4) }),
    booking({ id: "future-1", arrivalDate: iso(2) }),
    booking({ id: "past-2", arrivalDate: iso(-1) }),
  ];

  assert.deepEqual(
    sortReservations(list, NOW).map(({ id }) => id),
    ["future-1", "future-2", "past-2", "past-1"],
  );
});

// ------------------------------------------------------- room timers

test("setRoomState writes exactly one timer family", () => {
  const base = makeState({ rooms: [room("Small 1", "small")] });
  const id = "small-1";

  const occupied = setRoomState(base, id, "occupied", { days: 2, now: NOW });
  assert.equal(occupied.rooms[0].state, "occupied");
  assert.equal(occupied.rooms[0].stayDays, 2);
  assert.equal(occupied.rooms[0].stayStartedAt, NOW.toISOString());
  assert.equal(occupied.rooms[0].cleaningStartedAt, undefined);

  const cleaning = setRoomState(occupied, id, "cleaning", { now: NOW });
  assert.equal(cleaning.rooms[0].state, "cleaning");
  assert.equal(cleaning.rooms[0].stayDays, undefined);
  assert.equal(cleaning.rooms[0].cleaningStartedAt, NOW.toISOString());

  const oos = setRoomState(cleaning, id, "oos", { now: NOW });
  assert.equal(oos.rooms[0].state, "oos");
  assert.equal(oos.rooms[0].oosUntil, undefined);
  assert.equal(oos.rooms[0].cleaningStartedAt, undefined);

  const vacant = setRoomState(oos, id, "vacant", { now: NOW });
  assert.equal(vacant.rooms[0].state, "vacant");
  assert.equal(vacant.rooms[0].oosUntil, undefined);
});

test("setRoomState refuses impossible durations without touching the room", () => {
  const state = makeState({ rooms: [room("Small 1", "small")] });
  for (const days of [0, 1.5, 366, "two"]) {
    assert.equal(setRoomState(state, "small-1", "occupied", { days }), state);
  }
  assert.equal(
    setRoomState(state, "small-1", "oos", { oosUntil: "garbage" }),
    state,
  );
});

test("stayExpiry counts nights from the previous day before 04:00", () => {
  assert.equal(
    stayExpiry(at(11, 12, 12).toISOString(), 2).toISOString(),
    at(11, 14, DAY_BOUNDARY_HOUR).toISOString(),
  );
  assert.equal(
    stayExpiry(at(11, 13, 1, 10).toISOString(), 1).toISOString(),
    at(11, 13, DAY_BOUNDARY_HOUR).toISOString(),
  );
});

test("remainingDays drops at the 10:00 boundary, not at midnight", () => {
  const startedAt = at(11, 12, 12).toISOString();
  assert.equal(remainingDays(at(11, 12, 12), startedAt, 2), 2);
  assert.equal(remainingDays(at(11, 13, 9, 59), startedAt, 2), 2);
  assert.equal(remainingDays(at(11, 13, 10), startedAt, 2), 1);
  assert.equal(remainingDays(at(11, 14, 9, 59), startedAt, 2), 1);
  assert.equal(remainingDays(at(11, 14, 10), startedAt, 2), 0);
});

test("a night-of check-in still gets its full last morning", () => {
  const startedAt = at(11, 13, 1, 10).toISOString();
  assert.equal(remainingDays(at(11, 13, 1, 20), startedAt, 1), 1);
  assert.equal(remainingDays(at(11, 13, 10, 1), startedAt, 1), 0);
});

test("cleaning counts down in ten-minute steps and stops at zero", () => {
  const startedAt = at(11, 12, 14, 37).toISOString();
  assert.equal(cleaningMinutesLeft(at(11, 12, 14, 37), startedAt), CLEANING_MINUTES);
  assert.equal(cleaningMinutesLeft(at(11, 12, 14, 38), startedAt), 60);
  assert.equal(cleaningMinutesLeft(at(11, 12, 14, 47), startedAt), 50);
  assert.equal(cleaningMinutesLeft(at(11, 12, 15, 37), startedAt), 0);

  assert.equal(
    nextCleaningStep(startedAt, at(11, 12, 14, 37)).toISOString(),
    at(11, 12, 14, 47).toISOString(),
  );
  assert.equal(
    nextCleaningStep(startedAt, at(11, 12, 14, 48)).toISOString(),
    at(11, 12, 14, 57).toISOString(),
  );
});

test("OOS durations are bounded and count days from midnight", () => {
  assert.equal(oosUntilFromDuration(0, "days", NOW), null);
  assert.equal(oosUntilFromDuration(OOS_MAX_DAYS + 1, "days", NOW), null);
  assert.equal(oosUntilFromDuration(OOS_MAX_HOURS + 1, "hours", NOW), null);
  assert.equal(oosUntilFromDuration(1.5, "hours", NOW), null);

  assert.equal(
    oosUntilFromDuration(2, "days", NOW).toISOString(),
    at(11, 14, 0).toISOString(),
  );
  assert.equal(
    oosUntilFromDuration(2, "hours", NOW).toISOString(),
    at(11, 12, 14).toISOString(),
  );
});

test("oosCoversNight respects open-ended and timed windows", () => {
  const open = { state: "oos" };
  const timed = { state: "oos", oosUntil: at(11, 14, 0).toISOString() };
  const expired = { state: "oos", oosUntil: at(11, 12, 0).toISOString() };

  assert.equal(oosCoversNight(open, at(12, 31, 0)), true);
  assert.equal(oosCoversNight(timed, at(11, 13, 0)), true);
  assert.equal(oosCoversNight(timed, at(11, 14, 0)), false);
  assert.equal(oosCoversNight(expired, at(11, 12, 12)), false);
  assert.equal(oosCoversNight({ state: "vacant" }, at(11, 12, 0)), false);
});

test("OOS labels count hours or day cells and preview the expiry", () => {
  assert.equal(oosRemainingLabel(2 * 3_600_000), "2 hours");
  assert.equal(oosRemainingLabel(90 * 60_000), "2 hours");
  assert.equal(oosRemainingLabel(30 * 60_000), "30 min");

  const hours = {
    state: "oos",
    oosUntil: at(11, 12, 14).toISOString(),
    oosUnit: "hours",
  };
  assert.equal(roomStateText(hours, at(11, 12, 12)), "Disabled - 2 hours");
  assert.equal(roomStateText(hours, at(11, 12, 14)), "Vacant");

  const days = {
    state: "oos",
    oosUntil: at(11, 14, 0).toISOString(),
    oosUnit: "days",
  };
  assert.equal(roomStateText(days, at(11, 12, 12)), "Disabled - 2 days");
  assert.equal(roomStateText(days, at(11, 13, 0, 30)), "Disabled - 1 day");
});

test("roomStateText previews every live timer", () => {
  const occupied = {
    state: "occupied",
    stayDays: 1,
    stayStartedAt: at(11, 12, 12).toISOString(),
  };
  assert.equal(roomStateText(occupied, at(11, 12, 12)), "Occupied - 1 day");
  assert.equal(roomStateText(occupied, at(11, 13, 10)), "To clean");

  const cleaning = {
    state: "cleaning",
    cleaningStartedAt: at(11, 12, 12).toISOString(),
  };
  assert.equal(roomStateText(cleaning, at(11, 12, 12)), "Cleaning - 60 min");
  assert.equal(roomStateText(cleaning, at(11, 12, 12, 30)), "Cleaning - 30 min");
  assert.equal(roomStateText(cleaning, at(11, 12, 13)), "Vacant");
});

test("nextOosStep wakes on the next hour, minute or midnight", () => {
  assert.equal(
    nextOosStep(at(11, 12, 14).toISOString(), at(11, 12, 12), "hours").toISOString(),
    at(11, 12, 13).toISOString(),
  );
  assert.equal(
    nextOosStep(at(11, 12, 12, 30).toISOString(), at(11, 12, 12), "hours").toISOString(),
    at(11, 12, 12, 1).toISOString(),
  );
  assert.equal(
    nextOosStep(at(11, 14, 0).toISOString(), at(11, 12, 12), "days").toISOString(),
    at(11, 13, 0).toISOString(),
  );
});

test("reconcileExpiries flips occupied, cleaning and timed OOS rooms", () => {
  const state = makeState({
    rooms: [
      room("Small 1", "small", "occupied", {
        stayDays: 1,
        stayStartedAt: at(11, 11, 12).toISOString(),
      }),
      room("Small 2", "small", "cleaning", {
        cleaningStartedAt: at(11, 12, 11).toISOString(),
      }),
      room("Small 3", "small", "oos", {
        oosUntil: at(11, 12, 11).toISOString(),
        oosUnit: "hours",
      }),
    ],
  });

  const next = reconcileExpiries(state, NOW);
  assert.deepEqual(next.rooms.map(({ state: value }) => value), [
    "dirty",
    "vacant",
    "vacant",
  ]);
  assert.equal(next.rooms.every((candidate) => !candidate.stayDays), true);
  assert.equal(next.rooms.every((candidate) => !candidate.cleaningStartedAt), true);
  assert.equal(next.rooms.every((candidate) => !candidate.oosUntil), true);
  assert.equal(reconcileExpiries(next, NOW), next);
});

test("sortRooms orders by state, then numeric name", () => {
  const rooms = [
    room("Room 10", "small", "occupied"),
    room("Room 2", "small", "occupied"),
    room("Room 1", "small", "vacant"),
    room("Room 3", "small", "oos"),
    room("Room 4", "small", "dirty"),
    room("Room 5", "small", "cleaning"),
    room("Room 6", "small", "mystery"),
  ];

  assert.deepEqual(sortRooms(rooms).map(({ name }) => name), [
    "Room 1",
    "Room 5",
    "Room 4",
    "Room 2",
    "Room 10",
    "Room 3",
    "Room 6",
  ]);
});

// ------------------------------------------------------------ migrations

test("v1 states get the default room state and v4 room counts", () => {
  const v1 = {
    version: 1,
    rooms: [{ id: "r1", name: "Room 1", type: "small" }],
    reservations: [
      {
        id: "a",
        hostName: "Legacy",
        roomType: "small",
        arrivalDate: iso(3),
        days: 2,
        createdAt: NOW.toISOString(),
      },
    ],
    register: [],
  };

  const next = migrate(v1, NOW);
  assert.equal(next.version, 4);
  assert.equal(next.rooms[0].state, "vacant");
  assert.deepEqual(next.reservations[0].roomCounts, {
    small: 1,
    large: 0,
    suite: 0,
  });
  assert.equal("roomType" in next.reservations[0], false);
  assert.equal(v1.version, 1);
});

test("v1 keeps a state that a hand-edited old room already carries", () => {
  const v1 = {
    version: 1,
    rooms: [{ id: "r1", name: "Room 1", type: "large", state: "dirty" }],
    reservations: [],
    register: [],
  };

  assert.equal(migrate(v1, NOW).rooms[0].state, "dirty");
});

test("v2 moves checked-in and lapsed bookings into history", () => {
  const checkedInAt = at(11, 11, 12).toISOString();
  const v2 = {
    version: 2,
    rooms: [{ id: "r1", name: "Room 1", type: "small", state: "vacant" }],
    reservations: [
      {
        id: "active",
        hostName: "Future",
        roomType: "small",
        arrivalDate: iso(3),
        days: 1,
      },
      {
        id: "checked",
        hostName: "Checked",
        roomType: "small",
        arrivalDate: iso(-1),
        days: 1,
        checkedInAt,
      },
      {
        id: "lapsed",
        hostName: "Lapsed",
        roomType: "large",
        arrivalDate: iso(-2),
        days: 1,
      },
    ],
    register: [],
  };

  const next = migrate(v2, NOW);
  assert.deepEqual(next.reservations.map(({ id }) => id), ["active"]);
  assert.deepEqual(
    next.register.map(({ status, id }) => [status, id]),
    [
      ["checked_in", "checked"],
      ["no_show", "lapsed"],
    ],
  );
  assert.equal(next.register[0].registeredAt, checkedInAt);
  assert.equal(
    next.register[1].registeredAt,
    noShowCutoff(iso(-2)).toISOString(),
  );
  assert.equal(next.reservations[0].roomCounts.small, 1);
});

test("v3 converts legacy roomType bookings and register room fields", () => {
  const v3 = {
    version: 3,
    rooms: [],
    reservations: [
      {
        id: "pending",
        hostName: "Pending",
        roomType: "suite",
        arrivalDate: iso(2),
        days: 3,
      },
    ],
    register: [
      {
        id: "history",
        hostName: "History",
        roomType: "suite",
        arrivalDate: iso(-4),
        days: 1,
        status: "checked_in",
        registeredAt: NOW.toISOString(),
        roomId: "suite-1",
        roomName: "Suite 1",
      },
    ],
  };

  const next = migrate(v3, NOW);
  assert.deepEqual(next.reservations[0].roomCounts, {
    small: 0,
    large: 0,
    suite: 1,
  });
  assert.equal("roomType" in next.reservations[0], false);
  assert.deepEqual(next.register[0].assignedRooms, [
    { id: "suite-1", name: "Suite 1", type: "suite" },
  ]);
  assert.equal("roomId" in next.register[0], false);
  assert.equal("roomName" in next.register[0], false);
});

test("v3 register entries without a room stay as empty snapshots", () => {
  const next = migrate(
    {
      version: 3,
      rooms: [],
      reservations: [],
      register: [
        {
          id: "old",
          hostName: "Old",
          roomType: "small",
          arrivalDate: iso(-4),
          days: 1,
          status: "cancelled",
          registeredAt: NOW.toISOString(),
        },
      ],
    },
    NOW,
  );

  assert.deepEqual(next.register[0].assignedRooms, []);
  assert.equal(next.register[0].roomCounts.small, 1);
});

test("v4 is idempotent and keeps valid snapshots", () => {
  const current = {
    version: 4,
    rooms: [{ id: "r1", name: "Room 1", type: "small", state: "vacant" }],
    reservations: [
      {
        id: "r",
        hostName: "Guest",
        roomType: "large",
        roomCounts: { small: 2, large: 0, suite: 1 },
        arrivalDate: iso(1),
        days: 2,
      },
    ],
    register: [
      {
        id: "h",
        hostName: "History",
        roomCounts: { small: 1, large: 0, suite: 0 },
        assignedRooms: [{ id: "s1", name: "Small 1", type: "small" }],
        arrivalDate: iso(-2),
        days: 1,
        status: "checked_in",
        registeredAt: NOW.toISOString(),
      },
    ],
  };

  const next = migrate(current, NOW);
  assert.deepEqual(next.reservations[0].roomCounts, {
    small: 2,
    large: 0,
    suite: 1,
  });
  assert.deepEqual(next.register[0].assignedRooms, [
    { id: "s1", name: "Small 1", type: "small" },
  ]);
  assert.deepEqual(migrate(next, NOW), next);
});

test("migration normalizes missing or non-array collections", () => {
  const next = migrate({ version: 4, rooms: null, reservations: "x", register: 7 }, NOW);
  assert.deepEqual(next, {
    version: 4,
    rooms: [],
    reservations: [],
    register: [],
  });
});
