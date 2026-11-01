export const ROOM_TYPES = [
  { value: "small", label: "Small" },
  { value: "large", label: "Large" },
  { value: "suite", label: "Suite" },
];

export const ROOM_NAME_MAX = 40;

const NUMBERED_NAME = /^Room (\d+)$/;

export function typeLabel(value) {
  return ROOM_TYPES.find((type) => type.value === value)?.label ?? value;
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

export function hasRoomNamed(rooms, name) {
  const needle = name.trim().toLowerCase();
  return rooms.some((room) => room.name.trim().toLowerCase() === needle);
}

export function addRoom(state, { name, type }) {
  const room = {
    id: newId(),
    name: name.trim(),
    type,
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
