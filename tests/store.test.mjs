import test from "node:test";
import assert from "node:assert/strict";

// The store keeps its state at module scope, so each case imports a fresh
// instance under a unique query string after installing a fake localStorage.
const STORE_URL = new URL("../js/store.js", import.meta.url).href;
let caseId = 0;

function loadStore(storage) {
  globalThis.localStorage = storage;
  const url = new URL(STORE_URL);
  url.search = `?case=${caseId++}`;
  return import(url.href);
}

function createStorage(options = {}) {
  let stored = options.value ?? null;
  let writeFails = Boolean(options.failWrite);
  const sets = [];

  return {
    calls: { sets },
    get value() {
      return stored;
    },
    set failWrite(next) {
      writeFails = next;
    },
    getItem() {
      if (options.failRead) throw new Error("storage blocked");
      return stored;
    },
    setItem(key, next) {
      if (writeFails) throw new DOMException("full", "QuotaExceededError");
      sets.push(next);
      stored = next;
    },
    removeItem() {
      stored = null;
    },
    clear() {
      stored = null;
    },
    key() {
      return null;
    },
    get length() {
      return stored === null ? 0 : 1;
    },
  };
}

const EMPTY = { version: 4, rooms: [], reservations: [], register: [] };
const ROOM = { id: "small-1", name: "Small 1", type: "small", state: "vacant" };

test("unreadable JSON keeps the raw payload and blocks writes", async () => {
  const storage = createStorage({ value: "{not json" });
  const store = await loadStore(storage);

  assert.deepEqual(store.getState(), EMPTY);
  assert.equal(store.getStorageStatus().kind, "unreadable");
  assert.equal(store.getStorageStatus().raw, "{not json");

  // The app still works in memory, but the only saved copy must survive.
  store.update((state) => ({ ...state, rooms: [ROOM] }));

  assert.equal(store.getState().rooms.length, 1);
  assert.equal(storage.calls.sets.length, 0);
  assert.equal(storage.value, "{not json");
  assert.equal(store.getStorageStatus().kind, "unreadable");
});

test("a top-level value that is not an object is unreadable", async () => {
  for (const raw of ["null", "[]", "42", '"text"', "true"]) {
    const storage = createStorage({ value: raw });
    const store = await loadStore(storage);

    assert.equal(store.getStorageStatus().kind, "unreadable", raw);
    assert.equal(store.getStorageStatus().raw, raw);
    assert.deepEqual(store.getState(), EMPTY);
  }
});

test("blocked storage starts empty and surfaces a write failure", async () => {
  const storage = createStorage({ failRead: true, failWrite: true });
  const store = await loadStore(storage);

  assert.equal(store.getStorageStatus().kind, "unavailable");
  assert.deepEqual(store.getState(), EMPTY);

  // A blocked read must not make updates throw.
  store.update((state) => ({ ...state, rooms: [ROOM] }));

  assert.equal(store.getState().rooms.length, 1);
  assert.equal(store.getStorageStatus().kind, "write-failed");
});

test("a quota error keeps the change in memory and clears after a good save", async () => {
  const storage = createStorage();
  const store = await loadStore(storage);
  assert.equal(store.getStorageStatus().kind, "ok");

  const seen = [];
  store.subscribeStorage((status) => seen.push(status.kind));

  storage.failWrite = true;
  store.update((state) => ({ ...state, rooms: [ROOM] }));

  assert.equal(store.getState().rooms.length, 1);
  assert.equal(store.getStorageStatus().kind, "write-failed");
  assert.deepEqual(seen, ["write-failed"]);
  assert.equal(storage.value, null);

  storage.failWrite = false;
  store.update((state) => ({
    ...state,
    rooms: [...state.rooms, { ...ROOM, id: "small-2", name: "Small 2" }],
  }));

  assert.equal(store.getStorageStatus().kind, "ok");
  assert.deepEqual(seen, ["write-failed", "ok"]);
  assert.equal(JSON.parse(storage.value).rooms.length, 2);
});

test("a readable payload loads and writes the migrated shape back", async () => {
  const legacy = JSON.stringify({
    version: 1,
    rooms: [{ id: "r1", name: "Room 1", type: "small" }],
    reservations: [],
    register: [],
  });
  const storage = createStorage({ value: legacy });
  const store = await loadStore(storage);

  assert.equal(store.getStorageStatus().kind, "ok");
  assert.equal(store.getState().version, 4);
  assert.equal(store.getState().rooms[0].state, "vacant");
  assert.equal(JSON.parse(storage.value).version, 4);
});

test("a failed migration write-back is reported but the state is usable", async () => {
  const legacy = JSON.stringify({
    version: 1,
    rooms: [{ id: "r1", name: "Room 1", type: "small" }],
    reservations: [],
    register: [],
  });
  const storage = createStorage({ value: legacy, failWrite: true });
  const store = await loadStore(storage);

  assert.equal(store.getStorageStatus().kind, "write-failed");
  assert.equal(store.getState().version, 4);
  assert.equal(store.getState().rooms[0].state, "vacant");
  assert.equal(storage.value, legacy);
});

test("start empty replaces an unreadable payload once the user confirms", async () => {
  const storage = createStorage({ value: "{not json" });
  const store = await loadStore(storage);
  assert.equal(store.getStorageStatus().kind, "unreadable");

  store.startEmpty();

  assert.equal(store.getStorageStatus().kind, "ok");
  assert.equal(store.getStorageStatus().raw, null);
  assert.deepEqual(store.getState(), EMPTY);
  assert.deepEqual(JSON.parse(storage.value), EMPTY);
});
