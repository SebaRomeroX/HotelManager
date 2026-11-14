import { ROOM_TYPES } from "./rooms.js";
import { checkoutDate, formatDate } from "./dates.js";

// A booking holds a whole-number count of each room type. Records written
// before multi-room reservations carry one `roomType` instead; every reader
// goes through here so both shapes behave the same until migration runs.
export function reservationRoomCounts(record) {
  const counts = Object.fromEntries(ROOM_TYPES.map(({ value }) => [value, 0]));
  const source = record?.roomCounts;

  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const { value } of ROOM_TYPES) {
      const count = Number(source[value] ?? 0);
      counts[value] = Number.isInteger(count) && count > 0 ? count : 0;
    }
    return counts;
  }

  if (ROOM_TYPES.some(({ value }) => value === record?.roomType)) {
    counts[record.roomType] = 1;
  }
  return counts;
}

export function reservationRoomTotal(record) {
  const counts = reservationRoomCounts(record);
  return ROOM_TYPES.reduce((sum, { value }) => sum + counts[value], 0);
}

function joinWithAnd(parts) {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

// "3 Small rooms", "1 Suite and 2 Small rooms" — the one wording used by the
// list, register, dialogs and filter summary.
export function roomCountsLabel(counts) {
  const parts = ROOM_TYPES
    .filter(({ value }) => (counts?.[value] ?? 0) > 0)
    .map(({ value, label }) => {
      const count = counts[value];
      if (value === "suite") {
        return `${count} ${count === 1 ? "Suite" : "Suites"}`;
      }
      return `${count} ${label} ${count === 1 ? "room" : "rooms"}`;
    });

  return joinWithAnd(parts) || "No rooms";
}

// The meta line shared by the list row and the read-only sheet, so what a
// reservation looks like in both places comes from one place.
export function reservationMeta(reservation) {
  const checkout = checkoutDate(reservation.arrivalDate, reservation.days);
  const days = `${reservation.days} ${reservation.days === 1 ? "day" : "days"}`;
  return (
    `${roomCountsLabel(reservationRoomCounts(reservation))} · ` +
    `${formatDate(reservation.arrivalDate)} → ${formatDate(checkout)} · ${days}`
  );
}
