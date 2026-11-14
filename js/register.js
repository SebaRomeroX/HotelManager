// The register is history: every entry is a copy of the reservation at the
// moment it left the active list, plus why it left. Snapshots keep the past
// stable when a room is renamed or a booking would otherwise have been edited.
export const REGISTER_STATUS_LABELS = {
  checked_in: "Checked in",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export function registerStatusLabel(status) {
  return REGISTER_STATUS_LABELS[status] ?? status;
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
