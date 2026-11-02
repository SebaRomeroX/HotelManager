export const ROOM_TYPES = [
  { value: "small", label: "Small" },
  { value: "large", label: "Large" },
  { value: "suite", label: "Suite" },
];

export const ROOM_STATES = [
  { value: "vacant", label: "Vacant" },
  { value: "cleaning", label: "Cleaning" },
  { value: "dirty", label: "Needs cleaning" },
  { value: "occupied", label: "Occupied" },
  { value: "oos", label: "Out of order" },
];

export const ROOM_NAME_MAX = 40;
export const DEFAULT_STATE = "vacant";

// A stay runs in days that turn over at this hour, not at midnight: the
// counter drops at 10:00 and the stay expires at 10:00 on arrival + N days.
export const DAY_BOUNDARY_HOUR = 10;
export const STAY_MIN_DAYS = 1;
export const STAY_MAX_DAYS = 365;

// The list above is also the ranking: state first, then name, everywhere a
// room list is rendered.
const STATE_RANK = new Map(
  ROOM_STATES.map((state, index) => [state.value, index]),
);

const NUMBERED_NAME = /^Room (\d+)$/;

export function sortRooms(rooms) {
  return [...rooms].sort((a, b) => {
    // Unknown states rank last rather than first, which is what -1 would do.
    const rank =
      (STATE_RANK.get(a.state) ?? STATE_RANK.size) -
      (STATE_RANK.get(b.state) ?? STATE_RANK.size);

    // numeric keeps "Room 10" after "Room 9"; base ignores case so a tie
    // falls through to the stable sort instead of comparing capitalisation.
    return (
      rank ||
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
  });
}

export function typeLabel(value) {
  return ROOM_TYPES.find((type) => type.value === value)?.label ?? value;
}

export function stateLabel(value) {
  return ROOM_STATES.find((state) => state.value === value)?.label ?? value;
}

export function stayExpiry(stayStartedAt, days) {
  const expiry = new Date(stayStartedAt);
  expiry.setDate(expiry.getDate() + days);
  expiry.setHours(DAY_BOUNDARY_HOUR, 0, 0, 0);
  return expiry;
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// Whole days left before the stay expires. The arrival day's own 10:00 never
// counts, so arriving at 08:00 does not burn a day two hours later; today's
// boundary only counts once it has actually passed.
export function remainingDays(now, stayStartedAt, days) {
  const expiry = stayExpiry(stayStartedAt, days);
  if (now >= expiry) return 0;

  const arrivalDay = startOfDay(new Date(stayStartedAt));
  const dayAfterArrival = new Date(arrivalDay);
  dayAfterArrival.setDate(dayAfterArrival.getDate() + 1);

  const today = startOfDay(now);
  if (now.getHours() >= DAY_BOUNDARY_HOUR) {
    today.setDate(today.getDate() + 1);
  }

  const firstCounted = today < dayAfterArrival ? dayAfterArrival : today;
  const expiryDay = startOfDay(expiry);

  // Round, not divide: a DST day is 23 or 25 hours long.
  const gap = Math.round((expiryDay - firstCounted) / 86_400_000);
  return Math.max(0, gap + 1);
}

export function roomStateText(room, now = new Date()) {
  const label = stateLabel(room.state);

  if (room.state !== "occupied" || !room.stayDays || !room.stayStartedAt) {
    return label;
  }

  const left = remainingDays(now, room.stayStartedAt, room.stayDays);
  // Expired but not yet reconciled: preview what the flip will say.
  if (left <= 0) return stateLabel("dirty");

  return `${label} - ${left} ${left === 1 ? "day" : "days"}`;
}

// The only writer of a room's state and its stay fields.
export function setRoomState(state, id, nextState, { days, now = new Date() } = {}) {
  if (nextState === "occupied") {
    const count = Number(days);
    if (!Number.isInteger(count) || count < STAY_MIN_DAYS || count > STAY_MAX_DAYS) {
      return state;
    }

    return updateRoom(state, id, {
      state: nextState,
      stayDays: count,
      stayStartedAt: now.toISOString(),
    });
  }

  // Leaving occupancy drops the stay so a stale countdown cannot resurface.
  return updateRoom(state, id, {
    state: nextState,
    stayDays: undefined,
    stayStartedAt: undefined,
  });
}

// Expired stays become "needs cleaning". Returns the same reference when
// nothing changed, so callers can skip writing to storage.
export function reconcileOccupancies(state, now = new Date()) {
  let changed = false;

  const rooms = state.rooms.map((room) => {
    if (room.state !== "occupied" || !room.stayDays || !room.stayStartedAt) {
      return room;
    }
    if (remainingDays(now, room.stayStartedAt, room.stayDays) > 0) return room;

    changed = true;
    return {
      ...room,
      state: "dirty",
      stayDays: undefined,
      stayStartedAt: undefined,
      updatedAt: now.toISOString(),
    };
  });

  return changed ? { ...state, rooms } : state;
}

// Highest existing number plus one, so deleting Room 2 never hands out a name
// that is still in use.
export function nextRoomName(rooms) {
  const highest = rooms.reduce((max, room) => {
    const match = NUMBERED_NAME.exec(room.name);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return `Room ${highest + 1}`;
}

export function hasRoomNamed(rooms, name, exceptId = null) {
  const needle = name.trim().toLowerCase();
  return rooms.some(
    (room) =>
      room.id !== exceptId && room.name.trim().toLowerCase() === needle,
  );
}

export function updateRoom(state, id, patch) {
  return {
    ...state,
    rooms: state.rooms.map((room) =>
      room.id === id
        ? { ...room, ...patch, updatedAt: new Date().toISOString() }
        : room,
    ),
  };
}

export function removeRoom(state, id) {
  return {
    ...state,
    rooms: state.rooms.filter((room) => room.id !== id),
  };
}

export function addRoom(state, { name, type }) {
  const room = {
    id: newId(),
    name: name.trim(),
    type,
    state: DEFAULT_STATE,
    createdAt: new Date().toISOString(),
  };

  return { ...state, rooms: [...state.rooms, room] };
}

// randomUUID needs a secure context. Opening the app over plain HTTP on a LAN
// address still has to work, so fall back to a time-random id.
function newId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `room_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  );
}
