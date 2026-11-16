// The register is history: every entry is a copy of the reservation at the
// moment it left the active list, plus why it left. Snapshots keep the past
// stable when a room is renamed or a booking would otherwise have been edited.
export const REGISTER_STATUS_LABELS = {
  checked_in: "Checked in",
  cancelled: "Cancelled",
  no_show: "No-show",
};

// The filter row and the status badges read the same labels, so they can never
// drift apart. "all" is not a stored status; it means no filtering.
export const REGISTER_FILTERS = [
  { value: "all", label: "All" },
  ...Object.entries(REGISTER_STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
  })),
];

export function registerStatusLabel(status) {
  return REGISTER_STATUS_LABELS[status] ?? status;
}

// The list is already sorted newest first; filtering only hides rows.
export function filterRegisterEntries(register, status = "all") {
  if (status === "all") return register;
  return register.filter((entry) => entry.status === status);
}

// Per-status totals for the filter row. Unknown statuses count only toward
// "All", which keeps the all-count equal to the list length.
export function registerCounts(register) {
  const counts = {
    all: register.length,
    checked_in: 0,
    cancelled: 0,
    no_show: 0,
  };
  for (const { status } of register) {
    if (Object.hasOwn(REGISTER_STATUS_LABELS, status)) counts[status] += 1;
  }
  return counts;
}

export function registerEntry(
  reservation,
  status,
  { registeredAt = new Date().toISOString(), assignedRooms = [] } = {},
) {
  const entry = {
    ...reservation,
    status,
    registeredAt,
    // Check-ins remember every room that took the stay; the room may be
    // renamed or deleted later, so the entry carries the names it had then.
    assignedRooms: assignedRooms.map(({ id, name, type }) => ({ id, name, type })),
  };

  return entry;
}

// Newest first. Equal stamps fall through to the host name so the order never
// jitters between renders.
export function sortRegister(register) {
  return [...register].sort((a, b) => {
    const aTime = new Date(a.registeredAt).getTime() || 0;
    const bTime = new Date(b.registeredAt).getTime() || 0;
    return (
      bTime - aTime ||
      (a.hostName ?? "").localeCompare(b.hostName ?? "", undefined, {
        sensitivity: "base",
      })
    );
  });
}

export function removeRegisterEntry(state, id) {
  const register = state.register ?? [];
  if (!register.some((entry) => entry.id === id)) return state;

  return {
    ...state,
    register: register.filter((entry) => entry.id !== id),
  };
}

export function clearRegister(state) {
  if ((state.register ?? []).length === 0) return state;
  return { ...state, register: [] };
}
