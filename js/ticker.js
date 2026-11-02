import { getState, update } from "./store.js";
import { DAY_BOUNDARY_HOUR, reconcileOccupancies } from "./rooms.js";

const listeners = new Set();

function reconcile() {
  const current = getState();
  const next = reconcileOccupancies(current);
  if (next !== current) update(() => next);
}

function notify() {
  listeners.forEach((listener) => listener());
}

// Repaint without a store change: the day count moves at the boundary even
// when no room flips.
export function subscribeTick(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function msUntilBoundary() {
  const next = new Date();
  next.setHours(DAY_BOUNDARY_HOUR, 0, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  return next.getTime() - Date.now();
}

function armBoundary() {
  setTimeout(() => {
    reconcile();
    notify();
    armBoundary();
  }, msUntilBoundary());
}

// Catch up first: localStorage cannot run in the background, so anything that
// expired while the app was closed only gets fixed on the next load.
reconcile();

armBoundary();

// Backstop for a throttled or discarded background tab that missed its timeout.
setInterval(reconcile, 60_000);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  reconcile();
  notify();
});
