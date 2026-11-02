import { DEFAULT_STATE } from "./rooms.js";

const STORAGE_KEY = "hotelmanager:state";
const SCHEMA_VERSION = 2;

const listeners = new Set();

function emptyState() {
  return {
    version: SCHEMA_VERSION,
    rooms: [],
    reservations: [],
  };
}

function migrate(state) {
  // Any state written before version 2 predates room states. Spreading the room
  // after the default keeps a room that already carries a state of its own.
  if (!(state.version >= SCHEMA_VERSION)) {
    return {
      ...state,
      version: SCHEMA_VERSION,
      rooms: Array.isArray(state.rooms)
        ? state.rooms.map((room) => ({ state: DEFAULT_STATE, ...room }))
        : [],
    };
  }

  return state;
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
    return migrate(parsed);
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
