import { DEFAULT_STATE } from "./rooms.js";
import {
  isPastReservation,
  noShowCutoff,
  registerEntry,
  reservationRoomCounts,
} from "./reservations.js";

const STORAGE_KEY = "hotelmanager:state";
const SCHEMA_VERSION = 4;
const COLLECTIONS = ["rooms", "reservations", "register"];

const listeners = new Set();
const statusListeners = new Set();

// What the rest of the app needs to know about the saved copy. `unreadable`
// carries the raw payload so the user can download it before choosing to
// replace it; every other failure only means writes are not landing.
let storageStatus = { kind: "ok", raw: null };

function emptyState() {
  return {
    version: SCHEMA_VERSION,
    rooms: [],
    reservations: [],
    register: [],
  };
}

function setStatus(kind, raw = null) {
  if (storageStatus.kind === kind && storageStatus.raw === raw) return;

  storageStatus = { kind, raw };
  statusListeners.forEach((listener) => listener(getStorageStatus()));
}

// All localStorage access stays in this file. A write reports success rather
// than throwing, so one failed save never takes the UI down with it.
function writePayload(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
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
    // Storage blocked by the browser or the privacy mode. Nothing to recover,
    // but writes are not landing either.
    setStatus("unavailable");
    return emptyState();
  }

  if (!stored) return emptyState();

  let parsed;
  try {
    parsed = JSON.parse(stored);
  } catch {
    // Keep the exact bytes: they may still be recoverable by hand, and they
    // are the only remaining copy of the user's data.
    setStatus("unreadable", stored);
    return emptyState();
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    setStatus("unreadable", stored);
    return emptyState();
  }

  let migrated;
  try {
    migrated = migrate(parsed);
  } catch {
    // Valid JSON can still hold a shape the migrations cannot read. Treat it
    // like corrupt data and keep the payload untouched.
    setStatus("unreadable", stored);
    return emptyState();
  }

  // Keep the stored copy in step with the schema rather than re-running the
  // one-way register migration on every reload. A failed write-back is safe:
  // the migrated state still works in memory.
  if (JSON.stringify(parsed) !== JSON.stringify(migrated)) {
    if (!writePayload(migrated)) setStatus("write-failed");
  }

  return migrated;
}

let state = load();

function persist() {
  // While the payload is unreadable it is the only copy of the data. Never
  // write over it until the user downloads it or chooses to start empty.
  if (storageStatus.kind === "unreadable") return false;

  if (writePayload(state)) {
    setStatus("ok");
    return true;
  }

  setStatus("write-failed");
  return false;
}

export function getState() {
  return state;
}

export function getStorageStatus() {
  return { ...storageStatus };
}

// A backup is the persisted state as a readable file. It carries no wrapper:
// the same shape migrate() already reads on load.
export function exportState() {
  return JSON.stringify(state, null, 2);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Restore validates before it can touch the live state. A missing version or
// a future one is refused outright, and malformed collections are rejected
// rather than silently normalized away.
export function parseBackup(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("That file is not valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("That file does not contain hotel data.");
  }

  if (!Number.isInteger(parsed.version) || parsed.version < 1) {
    throw new Error("That file does not name a schema version.");
  }

  if (parsed.version > SCHEMA_VERSION) {
    throw new Error("That file was saved by a newer version of the app.");
  }

  if (!COLLECTIONS.some((key) => key in parsed)) {
    throw new Error("That file does not contain hotel data.");
  }

  for (const key of COLLECTIONS) {
    if (!(key in parsed)) continue;
    if (!Array.isArray(parsed[key]) || !parsed[key].every(isRecord)) {
      throw new Error(`That file has an unreadable ${key} list.`);
    }
  }

  try {
    return migrate(parsed);
  } catch {
    throw new Error("That file contains data the app cannot read.");
  }
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

// Status changes are rare and must not repaint the view or steal focus, so
// they travel on their own channel.
export function subscribeStorage(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

// Both recovery and restore replace everything. Clearing an unreadable status
// first lets the write go through; if it fails, persist() reports that and the
// banner comes back as a saving failure.
function replace(newState) {
  state = newState;
  if (storageStatus.kind === "unreadable") setStatus("ok");
  persist();
  listeners.forEach((listener) => listener(state));
  return state;
}

export function replaceState(next) {
  return replace(next);
}

export function startEmpty() {
  // The recovery UI offered the download first; from here the caller has
  // deliberately chosen an empty desk over the unreadable payload.
  return replace(emptyState());
}

export function reset() {
  return startEmpty();
}
