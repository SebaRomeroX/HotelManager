import { DEFAULT_STATE } from "./rooms.js";
import {
  isPastReservation,
  noShowCutoff,
  registerEntry,
  reservationRoomCounts,
} from "./reservations.js";

const STORAGE_KEY = "hotelmanager:state";
const SCHEMA_VERSION = 4;

const listeners = new Set();

function emptyState() {
  return {
    version: SCHEMA_VERSION,
    rooms: [],
    reservations: [],
    register: [],
  };
}

// A stamp is only useful if it parses; old or hand-edited data can carry
// anything, and the register sorts on it.
function validStamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Version 4 replaced the single roomType with whole-number counts per type.
// One-way: the old key disappears, and history keeps physical room names in
// assignedRooms instead of roomId/roomName.
function normalizeCounts(record) {
  const { roomType, ...rest } = record;
  return { ...rest, roomCounts: reservationRoomCounts(record) };
}

function normalizeRegisterEntry(entry) {
  const legacyType = entry.roomType ?? null;
  const { roomId, roomName, ...rest } = normalizeCounts(entry);

  let assignedRooms = Array.isArray(entry.assignedRooms)
    ? entry.assignedRooms.map(({ id, name, type }) => ({ id, name, type }))
    : [];

  if (roomName) {
    assignedRooms = [{ id: roomId ?? null, name: roomName, type: legacyType }];
  }

  return { ...rest, assignedRooms };
}

export function migrate(state, now = new Date()) {
  let next = state;

  // Any state written before version 2 predates room states. Spreading the room
  // after the default keeps a room that already carries a state of its own.
  if (!(next.version >= 2)) {
    next = {
      ...next,
      rooms: Array.isArray(next.rooms)
        ? next.rooms.map((room) => ({ state: DEFAULT_STATE, ...room }))
        : [],
    };
  }

  // Version 3 makes reservations pending-only: checked-in records and lapsed
  // no-shows become history in the register. The register is a log, so this
  // migration is one-way — once a record leaves the active list it never
  // comes back.
  if (!(next.version >= 3)) {
    const reservations = Array.isArray(next.reservations)
      ? next.reservations
      : [];
    const register = Array.isArray(next.register) ? [...next.register] : [];
    const active = [];

    for (const reservation of reservations) {
      if (reservation.checkedInAt) {
        register.push(
          registerEntry(reservation, "checked_in", {
            registeredAt:
              validStamp(reservation.checkedInAt) ?? now.toISOString(),
          }),
        );
        continue;
      }

      if (isPastReservation(reservation, now)) {
        register.push(
          registerEntry(reservation, "no_show", {
            registeredAt:
              noShowCutoff(reservation.arrivalDate)?.toISOString() ??
              now.toISOString(),
          }),
        );
        continue;
      }

      active.push(reservation);
    }

    next = { ...next, reservations: active, register };
  }

  // Version 4 gives a reservation many rooms: counts per type on the record,
  // and every physical room named in a checked-in register snapshot. Legacy
  // single-room records are converted in place so no reader has to special-case
  // the old shape after migration.
  if (!(next.version >= 4)) {
    next = {
      ...next,
      reservations: Array.isArray(next.reservations)
        ? next.reservations.map(normalizeCounts)
        : [],
      register: Array.isArray(next.register)
        ? next.register.map(normalizeRegisterEntry)
        : [],
    };
  }

  return {
    ...next,
    version: SCHEMA_VERSION,
    rooms: Array.isArray(next.rooms) ? next.rooms : [],
    reservations: Array.isArray(next.reservations) ? next.reservations : [],
    register: Array.isArray(next.register) ? next.register : [],
  };
}

function load() {
  let stored;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    return emptyState();
  }

  if (!stored) return emptyState();

  try {
    const parsed = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return emptyState();

    const migrated = migrate(parsed);
    // Keep the stored copy in step with the schema rather than re-running the
    // one-way register migration on every reload.
    if (JSON.stringify(parsed) !== JSON.stringify(migrated)) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      } catch {
        // Storage is unavailable; the in-memory migration still works.
      }
    }
    return migrated;
  } catch {
    return emptyState();
  }
}

let state = load();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode or a full quota. The app keeps working in memory.
  }
}

export function getState() {
  return state;
}

export function update(mutator) {
  state = mutator(state) ?? state;
  persist();
  listeners.forEach((listener) => listener(state));
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reset() {
  state = emptyState();
  persist();
  listeners.forEach((listener) => listener(state));
}
