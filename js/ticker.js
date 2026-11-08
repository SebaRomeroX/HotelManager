import { getState, update } from "./store.js";
import {
  DAY_BOUNDARY_HOUR,
  nextCleaningStep,
  reconcileExpiries,
} from "./rooms.js";
import {
  nextReservationBoundary,
  reconcileReservations,
} from "./reservations.js";

const listeners = new Set();

function reconcile() {
  const current = getState();
  // Both reconciles in one mutator: a state change persists and notifies once.
  const next = reconcileReservations(reconcileExpiries(current));
  if (next !== current) update(() => next);
}

function notify() {
  listeners.forEach((listener) => listener());
}

// Repaint without a store change: the day count and the cleaning minutes move
// on their own schedule even when no room flips.
export function subscribeTick(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function msToWallBoundary() {
  const next = new Date();
  next.setHours(DAY_BOUNDARY_HOUR, 0, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  return next.getTime() - Date.now();
}

// Cleaning steps are not wall-clock aligned — a room cleaned at 14:37 ticks at
// 14:47 — so sleep until the earliest interesting moment across all rooms.
function msToNextCleaningStep(now) {
  let best = Infinity;

  for (const room of getState().rooms) {
    if (room.state !== "cleaning" || !room.cleaningStartedAt) continue;
    const step = nextCleaningStep(room.cleaningStartedAt, now).getTime();
    if (step < best) best = step;
  }

  return best - now.getTime();
}

function armNext() {
  const now = new Date();
  const ms = Math.max(
    0,
    Math.min(
      msToWallBoundary(),
      msToNextCleaningStep(now),
      // Midnight rolls the sections and opens new arrival windows; a cutoff
      // logs a no-show. Both repaint exactly, not up to a minute late.
      nextReservationBoundary(getState(), now) - now.getTime(),
    ),
  );

  setTimeout(() => {
    reconcile();
    notify();
    armNext();
  }, ms);
}

// Catch up first: localStorage cannot run in the background, so anything that
// expired while the app was closed only gets fixed on the next load.
reconcile();

armNext();

// Backstop for a throttled or discarded background tab that missed its timeout.
// Reconcile only — no notify — because a stale count in an unseen tab costs
// nothing, and this avoids a pointless repaint every minute.
setInterval(reconcile, 60_000);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  reconcile();
  notify();
});
