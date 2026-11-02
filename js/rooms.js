export const ROOM_TYPES = [
  { value: "small", label: "Small" },
  { value: "large", label: "Large" },
  { value: "suite", label: "Suite" },
];

export const ROOM_STATES = [
  { value: "vacant", label: "Vacant" },
  { value: "occupied", label: "Occupied" },
  { value: "dirty", label: "Needs cleaning" },
  { value: "cleaning", label: "Cleaning" },
  { value: "oos", label: "Out of order" },
];

export const ROOM_NAME_MAX = 40;
export const DEFAULT_STATE = "vacant";

const NUMBERED_NAME = /^Room (\d+)$/;

export function typeLabel(value) {
  return ROOM_TYPES.find((type) => type.value === value)?.label ?? value;
}

export function stateLabel(value) {
  return ROOM_STATES.find((state) => state.value === value)?.label ?? value;
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
