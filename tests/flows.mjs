import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Optional dev-time flow checks. The app never depends on Playwright; this
// file is skipped when it is not installed. Resolution order:
//   1. a local playwright / @playwright/test install
//   2. PLAYWRIGHT_PATH=/path/to/package.json
//   3. the globally installed @playwright/cli bundle
// Usage: npm run test:browser   (or node tests/flows.mjs)
function loadPlaywright() {
  const local = createRequire(import.meta.url);
  for (const name of ["playwright", "@playwright/test"]) {
    try {
      return local(name);
    } catch {
      // keep looking
    }
  }

  if (process.env.PLAYWRIGHT_PATH) {
    try {
      const fromEnv = createRequire(path.resolve(process.env.PLAYWRIGHT_PATH));
      return fromEnv("playwright");
    } catch {
      // keep looking
    }
  }

  try {
    const globalRoot = execFileSync("npm", ["root", "-g"], {
      encoding: "utf8",
    }).trim();
    const fromGlobal = createRequire(
      path.join(globalRoot, "@playwright", "cli", "package.json"),
    );
    return fromGlobal("playwright");
  } catch {
    return null;
  }
}

const playwright = loadPlaywright();
if (!playwright) {
  console.log(
    "SKIP: optional browser checks need Playwright. " +
      "Install it as a dev tool or set PLAYWRIGHT_PATH.",
  );
  process.exit(0);
}

const { chromium } = playwright;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT ?? 8973);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const server = spawn(
  "python3",
  ["-m", "http.server", String(PORT), "--directory", ROOT],
  { stdio: "ignore" },
);
process.on("exit", () => server.kill());

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
for (let attempt = 0; attempt < 50; attempt += 1) {
  try {
    const response = await fetch(APP_URL);
    if (response.ok) break;
  } catch {
    await sleep(100);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 360, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

let passed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log("ok  ", name);
  } else {
    failures.push(name);
    console.log("FAIL", name, detail);
  }
}

function iso(offset) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

const baseRooms = [
  { id: "s1", name: "Small 1", type: "small", state: "vacant" },
  { id: "s2", name: "Small 2", type: "small", state: "vacant" },
  { id: "s3", name: "Small 3", type: "small", state: "vacant" },
  { id: "s4", name: "Small 4", type: "small", state: "vacant" },
  { id: "l1", name: "Large 1", type: "large", state: "vacant" },
  { id: "l2", name: "Large 2", type: "large", state: "vacant" },
  { id: "u1", name: "Suite 1", type: "suite", state: "vacant" },
  { id: "u2", name: "Suite 2", type: "suite", state: "vacant" },
];

async function seed(state) {
  await page.evaluate((next) => {
    localStorage.setItem("hotelmanager:state", JSON.stringify(next));
  }, state);
  await page.reload();
  await page.waitForSelector(".cal-nav");
}

async function stored() {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("hotelmanager:state")),
  );
}

async function openFilter(counts = {}, days = "1") {
  const toggle = page.locator("[data-cal-filter-toggle]");
  if ((await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
  }
  for (const [type, count] of Object.entries(counts)) {
    await page.fill(`[data-cal-filter-count="${type}"]`, String(count));
  }
  await page.fill("[data-cal-filter-days]", String(days));
  await page.waitForTimeout(100);
}

async function closeDialog() {
  const open = page.locator("dialog[open]");
  if (await open.count()) await open.locator("[data-close]").first().click();
  await page.waitForTimeout(100);
}

try {
  // ---------- A. filter -> prefilled reservation -> save ----------
  await page.goto(APP_URL);
  await seed({ version: 4, rooms: baseRooms, reservations: [], register: [] });

  await openFilter({ small: 3 }, 4);
  check(
    "filter marks fitting start dates",
    (await page.locator(".cal-cell--fits").count()) > 0,
  );
  const chosen = page.locator(".cal-cell--fits:not(.cal-cell--past)").first();
  const chosenDate = await chosen.getAttribute("data-date");
  await chosen.click();
  await page.waitForSelector("dialog[open]");

  check(
    "a fitting date opens the reservation sheet",
    (await page.locator("dialog[open] [data-title]").textContent()) ===
      "New reservation",
  );
  check(
    "it does not open the availability sheet",
    (await page.locator("dialog[open] .avail-list").count()) === 0,
  );
  check(
    "the arrival date is prefilled",
    (await page.inputValue("#reservation-date")) === chosenDate,
  );
  check("the duration is prefilled", (await page.inputValue("#reservation-days")) === "4");
  check(
    "three small rooms are prefilled",
    (await page.inputValue('[data-room-count="small"]')) === "3",
  );
  check(
    "other types stay at zero",
    (await page.inputValue('[data-room-count="large"]')) === "0",
  );
  check(
    "the host field takes first focus",
    await page.evaluate(() => document.activeElement?.id === "reservation-name"),
  );
  check(
    "the sheet has no horizontal overflow",
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );

  await page.fill("#reservation-name", "Filter Group");
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForTimeout(200);
  check(
    "saving closes the reservation sheet",
    (await page.locator("dialog[open]").count()) === 0,
  );

  let state = await stored();
  check("one multi-room reservation is stored", state.reservations.length === 1);
  check(
    "the stored counts match the filter",
    JSON.stringify(state.reservations[0].roomCounts) ===
      JSON.stringify({ small: 3, large: 0, suite: 0 }),
  );
  check("the stored duration matches the filter", state.reservations[0].days === 4);
  check(
    "the filter is cleared after booking",
    (await page.inputValue('[data-cal-filter-count="small"]')) === "0" &&
      (await page.inputValue("[data-cal-filter-days]")) === "1",
  );
  check(
    "the filter disclosure is closed again",
    (await page.locator("[data-cal-filter-toggle]").getAttribute("aria-expanded")) ===
      "false",
  );
  check(
    "the calendar returns to free-room counts",
    (await page.locator(".cal-cell--fits").count()) === 0,
  );
  check(
    "Incoming counts the booking once",
    (await page.locator("[data-incoming]").textContent()) === "Incoming (1)",
  );
  await page.click("[data-incoming]");
  await page.waitForTimeout(100);
  check(
    "the incoming row summarises all three rooms",
    (await page.locator("dialog[open] .res-row__meta").textContent()).startsWith(
      "3 Small rooms · ",
    ),
  );
  await closeDialog();

  // ---------- B. mixed-type reservation ----------
  await openFilter({ small: 2, suite: 1 }, 2);
  const mixedDate = await page
    .locator(".cal-cell--fits:not(.cal-cell--past)")
    .first()
    .getAttribute("data-date");
  await page.locator(".cal-cell--fits:not(.cal-cell--past)").first().click();
  await page.waitForSelector("dialog[open]");
  check(
    "mixed counts prefill from the filter",
    (await page.inputValue('[data-room-count="small"]')) === "2" &&
      (await page.inputValue('[data-room-count="suite"]')) === "1",
  );
  check("mixed duration prefill", (await page.inputValue("#reservation-days")) === "2");
  await page.fill("#reservation-name", "Mixed Group");
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForTimeout(200);
  state = await stored();
  check("mixed reservation is one record", state.reservations.length === 2);
  const mixed = state.reservations.find(
    (reservation) => reservation.hostName === "Mixed Group",
  );
  check(
    "mixed reservation keeps both types",
    mixed?.roomCounts.small === 2 && mixed?.roomCounts.suite === 1,
    JSON.stringify(mixed),
  );
  check(
    "mixed incoming rows update",
    (await page.locator("[data-incoming]").textContent()) === "Incoming (2)",
  );
  check("a mixed booking was placed on its chosen date", mixed?.arrivalDate === mixedDate);

  // ---------- C. over-capacity is refused in the sheet ----------
  await openFilter({ small: 4 }, 30);
  await page.locator(".cal-cell--fits:not(.cal-cell--past)").first().click();
  await page.waitForSelector("dialog[open]");
  await page.fill("#reservation-name", "Too Many");
  // The previous bookings may already take rooms, so ask for more than
  // inventory outright: validation accepts the number, the capacity guard
  // names the day.
  await page.fill('[data-room-count="small"]', "9");
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForTimeout(150);
  check(
    "over-capacity keeps the sheet open",
    (await page.locator("dialog[open]").count()) === 1,
  );
  check(
    "over-capacity shows the room-count error",
    (await page.locator("#reservation-error").textContent()).includes("Small"),
  );
  check(
    "the count fields are marked invalid",
    (await page.locator('[data-room-count="small"]').getAttribute("aria-invalid")) ===
      "true",
  );
  await closeDialog();

  // ---------- D. group check-in ----------
  const checkinState = {
    version: 4,
    rooms: baseRooms.map((room) => ({ ...room, state: "vacant" })),
    reservations: [
      {
        id: "r1",
        hostName: "Arriving Group",
        roomCounts: { small: 3, large: 0, suite: 0 },
        arrivalDate: iso(0),
        days: 2,
        createdAt: new Date().toISOString(),
      },
    ],
    register: [],
  };
  await seed(checkinState);
  check(
    "all three held rooms are marked Arriving",
    (await page.locator(".card--arriving").count()) === 3,
  );
  await page.locator(".card--arriving").first().click();
  await page.waitForSelector("dialog[open] .arrival:not([hidden])");
  check(
    "the arrival sheet names the whole group",
    (await page.locator("[data-fact-rooms]").textContent()) === "3 Small rooms",
  );
  check(
    "the group hint lists every room",
    (await page.locator("[data-arrival-group]").textContent()).includes(
      "Small 1, Small 2, Small 3",
    ),
  );
  await page.click("[data-arrival-checkin]");
  await page.click("[data-confirm-checkin]");
  await page.waitForTimeout(200);
  state = await stored();
  check("check-in clears the reservation", state.reservations.length === 0);
  check(
    "check-in occupies all three rooms",
    state.rooms.filter((room) => room.state === "occupied").length === 3,
  );
  check(
    "check-in writes one register entry",
    state.register.length === 1 && state.register[0].status === "checked_in",
  );
  check(
    "the register snapshots all rooms",
    state.register[0].assignedRooms?.length === 3,
    JSON.stringify(state.register[0].assignedRooms),
  );
  check(
    "all three arrivals disappear together",
    (await page.locator(".card--arriving").count()) === 0,
  );

  await page.click("[data-register]");
  await page.waitForTimeout(100);
  const roomLine = await page.locator("dialog[open] .register-entry__room").textContent();
  check(
    "the register names all three rooms",
    roomLine === "Rooms: Small 1, Small 2, Small 3",
    roomLine,
  );
  await closeDialog();

  // ---------- E. legacy single-room migration ----------
  const legacy = {
    version: 3,
    rooms: baseRooms,
    reservations: [
      {
        id: "old1",
        hostName: "Old Pending",
        roomType: "large",
        arrivalDate: iso(3),
        days: 2,
        createdAt: new Date().toISOString(),
      },
    ],
    register: [
      {
        id: "old2",
        hostName: "Old History",
        roomType: "suite",
        arrivalDate: iso(-3),
        days: 1,
        status: "checked_in",
        registeredAt: new Date().toISOString(),
        roomId: "u1",
        roomName: "Suite 1",
      },
    ],
  };
  await seed(legacy);
  state = await stored();
  check("migration bumps the schema", state.version === 4);
  check(
    "legacy pending becomes one count",
    state.reservations[0].roomCounts?.large === 1 &&
      !("roomType" in state.reservations[0]),
  );
  check(
    "legacy register becomes a room snapshot",
    state.register[0].assignedRooms?.[0]?.name === "Suite 1" &&
      !("roomName" in state.register[0]),
  );
  check(
    "legacy pending still renders",
    (await page.locator("[data-incoming]").textContent()) === "Incoming (1)",
  );
  await page.click("[data-incoming]");
  await page.waitForTimeout(100);
  check(
    "legacy meta says one Large room",
    (await page.locator("dialog[open] .res-row__meta").textContent()).startsWith(
      "1 Large room · ",
    ),
  );
  await closeDialog();
  await page.click("[data-register]");
  await page.waitForTimeout(100);
  check(
    "legacy register names its room",
    (await page.locator("dialog[open] .register-entry__room").textContent()) ===
      "Room: Suite 1",
  );
  await closeDialog();

  // ---------- F. edit a mixed group ----------
  const editRooms = [
    { id: "s1", name: "Small 1", type: "small", state: "vacant" },
    { id: "s2", name: "Small 2", type: "small", state: "vacant" },
    { id: "s3", name: "Small 3", type: "small", state: "vacant" },
    { id: "s4", name: "Small 4", type: "small", state: "vacant" },
    { id: "u1", name: "Suite 1", type: "suite", state: "vacant" },
    { id: "u2", name: "Suite 2", type: "suite", state: "vacant" },
  ];
  await seed({
    version: 4,
    rooms: editRooms,
    reservations: [
      {
        id: "r1",
        hostName: "Editable",
        roomCounts: { small: 2, large: 0, suite: 1 },
        arrivalDate: iso(1),
        days: 2,
        createdAt: new Date().toISOString(),
      },
    ],
    register: [],
  });

  await page.click("[data-incoming]");
  await page.waitForTimeout(100);
  await page.locator("dialog[open] .res-row").click();
  await page.waitForSelector("dialog[open]");
  check(
    "edit opens with the right title",
    (await page.locator("dialog[open] [data-title]").textContent()) ===
      "Edit reservation",
  );
  check(
    "edit prefills the small count",
    (await page.inputValue('[data-room-count="small"]')) === "2",
  );
  check(
    "edit prefills the suite count",
    (await page.inputValue('[data-room-count="suite"]')) === "1",
  );
  check(
    "edit prefills the date and days",
    (await page.inputValue("#reservation-date")) === iso(1) &&
      (await page.inputValue("#reservation-days")) === "2",
  );
  check(
    "edit shows the host as fixed text",
    await page.locator("[data-name-field]").isHidden(),
  );
  await page.fill('[data-room-count="small"]', "3");
  await page.fill("#reservation-days", "3");
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForTimeout(200);
  state = await stored();
  check("edit keeps one record", state.reservations.length === 1);
  check(
    "edit stores the new counts",
    state.reservations[0].roomCounts.small === 3 &&
      state.reservations[0].roomCounts.suite === 1,
  );
  check("edit stores the new duration", state.reservations[0].days === 3);
  check("edit keeps the host name", state.reservations[0].hostName === "Editable");

  // ---------- G. cancel the whole group ----------
  await page.click("[data-incoming]");
  await page.waitForTimeout(100);
  await page.locator("dialog[open] .res-row").click();
  await page.waitForSelector("dialog[open]");
  await page.click("[data-cancel-res]");
  check(
    "cancel arms first",
    (await page.locator("[data-cancel-res]").textContent()) === "Confirm cancel",
  );
  await page.click("[data-cancel-res]");
  await page.waitForTimeout(200);
  state = await stored();
  check("cancel removes the whole reservation", state.reservations.length === 0);
  check(
    "cancel writes one history entry",
    state.register.length === 1 && state.register[0].status === "cancelled",
  );
  check(
    "cancel history keeps the group counts",
    state.register[0].roomCounts.small === 3 &&
      state.register[0].roomCounts.suite === 1,
  );

  // ---------- H. check in now from a filter-originated booking ----------
  await seed({
    version: 4,
    rooms: editRooms.map((room) => ({ ...room, state: "vacant" })),
    reservations: [],
    register: [],
  });
  await page.click("[data-cal-filter-toggle]");
  await page.fill('[data-cal-filter-count="small"]', "3");
  await page.fill("[data-cal-filter-days]", "2");
  await page.waitForTimeout(100);
  await page.locator(".cal-cell--fits:not(.cal-cell--past)").first().click();
  await page.waitForSelector("dialog[open]");
  await page.fill("#reservation-name", "Direct Check-in");
  await page.click("[data-checkin-btn]");
  await page.waitForTimeout(200);
  state = await stored();
  check("check-in now creates no pending booking", state.reservations.length === 0);
  check(
    "check-in now occupies all three rooms",
    state.rooms.filter((room) => room.state === "occupied").length === 3,
  );
  check(
    "check-in now writes one checked-in entry",
    state.register.length === 1 &&
      state.register[0].status === "checked_in" &&
      state.register[0].assignedRooms.length === 3,
  );
  check(
    "check-in now clears the filter",
    (await page.locator("[data-cal-filter-toggle]").getAttribute("aria-expanded")) ===
      "false" &&
      (await page.inputValue('[data-cal-filter-count="small"]')) === "0",
  );

  // ---------- I. a non-fitting date keeps the details sheet ----------
  await seed({
    version: 4,
    rooms: editRooms.map((room) => ({ ...room, state: "vacant" })),
    register: [],
    reservations: [
      {
        id: "r2",
        hostName: "Blocked",
        roomCounts: { small: 4, large: 0, suite: 0 },
        arrivalDate: iso(1),
        days: 3,
        createdAt: new Date().toISOString(),
      },
    ],
  });
  await page.click("[data-cal-filter-toggle]");
  await page.fill('[data-cal-filter-count="small"]', "4");
  await page.fill("[data-cal-filter-days]", "2");
  await page.waitForTimeout(100);
  const noFit = page.locator(".cal-cell--no-fit:not(.cal-cell--past)").first();
  check("blocked dates are visibly non-fitting", (await noFit.count()) === 1);
  await noFit.click();
  await page.waitForSelector("dialog[open]");
  check(
    "a non-fitting date keeps the details sheet",
    (await page.locator("dialog[open] [data-title]").textContent()).includes(
      "Today",
    ),
  );
  check(
    "details do not prefill a booking",
    (await page.locator("dialog[open] #reservation-date").count()) === 0,
  );
  await closeDialog();

  // ---------- J. unreadable saved data ----------
  await page.evaluate(() =>
    localStorage.setItem("hotelmanager:state", "{not json"),
  );
  await page.reload();
  await page.waitForSelector(".storage-banner__title");

  check(
    "an unreadable payload shows the recovery banner",
    (await page.locator(".storage-banner__title").textContent()) ===
      "Saved data could not be read",
  );
  check(
    "the recovery banner offers a download",
    (await page.locator("[data-download]").textContent()) ===
      "Download saved data",
  );
  check(
    "the raw payload is left untouched",
    (await page.evaluate(() => localStorage.getItem("hotelmanager:state"))) ===
      "{not json",
  );

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("[data-download]"),
  ]);
  check(
    "the saved copy downloads under a dated name",
    /^hotelmanager-saved-data-\d{4}-\d{2}-\d{2}\.json$/.test(
      download.suggestedFilename(),
    ),
    download.suggestedFilename(),
  );

  await page.click("[data-start-empty]");
  check(
    "start empty arms before discarding",
    (await page.locator("[data-start-empty]").textContent()) ===
      "Confirm start empty" &&
      (await page.evaluate(() => localStorage.getItem("hotelmanager:state"))) ===
        "{not json",
  );
  await page.click("[data-start-empty]");
  await page.waitForTimeout(100);
  check(
    "confirming start empty clears the banner",
    await page.locator(".storage-banner").isHidden(),
  );
  const fresh = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("hotelmanager:state")),
  );
  check(
    "start empty writes a clean state",
    fresh.version === 4 &&
      fresh.rooms.length === 0 &&
      fresh.reservations.length === 0 &&
      fresh.register.length === 0,
    JSON.stringify(fresh),
  );

  // ---------- K. a failed write keeps the UI working ----------
  const quotaPage = await browser.newPage({
    viewport: { width: 360, height: 1000 },
  });
  quotaPage.on("pageerror", (error) => errors.push(error.message));

  await quotaPage.addInitScript(() => {
    const original = Storage.prototype.setItem;
    window.__restoreSetItem = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "hotelmanager:state") {
        throw new DOMException("The quota is full.", "QuotaExceededError");
      }
      return original.call(this, key, value);
    };
  });

  await quotaPage.goto(APP_URL);
  await quotaPage.waitForSelector(".view__title");
  check(
    "a healthy page starts without the banner",
    await quotaPage.locator(".storage-banner").isHidden(),
  );

  await quotaPage.evaluate(async () => {
    const store = await import("/js/store.js");
    store.update((state) => ({
      ...state,
      rooms: [{ id: "r1", name: "Room 1", type: "small", state: "dirty" }],
    }));
  });
  await quotaPage.waitForTimeout(100);

  check(
    "a failed write shows the saving banner",
    (await quotaPage.locator(".storage-banner__title").textContent()) ===
      "Changes are not being saved",
  );
  check(
    "the failed change is still on screen",
    (await quotaPage.locator(".view").textContent()).includes("Room 1"),
  );

  await quotaPage.evaluate(async () => {
    window.__restoreSetItem();
    const store = await import("/js/store.js");
    store.update((state) => ({ ...state }));
  });
  await quotaPage.waitForTimeout(100);
  check(
    "a later successful write clears the banner",
    await quotaPage.locator(".storage-banner").isHidden(),
  );
  check(
    "the recovered write reaches storage",
    (
      await quotaPage.evaluate(() =>
        JSON.parse(localStorage.getItem("hotelmanager:state")),
      )
    ).rooms.length === 1,
  );
  await quotaPage.close();
} finally {
  await browser.close();
  server.kill();
}

check("no page errors", errors.length === 0, errors.join("; "));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
