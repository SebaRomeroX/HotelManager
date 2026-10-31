const STORAGE_KEY = "hotelmanager:state";
const SCHEMA_VERSION = 1;

const listeners = new Set();

function emptyState() {
  return {
    version: SCHEMA_VERSION,
    rooms: [],
    reservations: [],
  };
}

function migrate(state) {
  // Each future schema bump gets a step here, transforming the previous shape
  // into the next one instead of discarding the user's data.
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
