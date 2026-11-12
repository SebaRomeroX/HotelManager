# Hotel Manager

A single-user, browser-only front desk for a small property. It replaces a
paper or whiteboard workflow with three things: rooms, their operational
state, and reservations over a month calendar.

There is no server, no account, no build step and no runtime dependency. State
lives in the browser's `localStorage` and never leaves the device.

## Run it

ES modules need an HTTP origin; opening `index.html` with `file://` will not
work. Any static file server is enough:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000>. There is nothing to install and nothing to
compile.

Data is scoped to the origin. `localhost:8000`, `127.0.0.1:8000` and another
port are different stores, so pick one URL and keep using it.

## What it does

- **Rooms** — create, rename, retype and delete rooms.
- **States** — vacant, to clean, cleaning, occupied and disabled. Occupied and
  cleaning rooms count down; timed disabled rooms come back on their own.
- **Reservations** — one booking can hold several rooms under one host name,
  including mixed types. The calendar shows free rooms per night.
- **Find a stay** — describe a request (counts per type and a duration) and the
  calendar marks every start date that fits. Tapping a fitting date opens the
  reservation sheet prefilled; tapping a non-fitting date opens its room
  breakdown.
- **Arrivals and history** — tiles mark rooms held for an arriving booking.
  Check-in takes every room in the reservation at once. Cancellations,
  no-shows and check-ins are kept in the register.

The UI is designed at 360px first, uses a dark theme only, and keeps primary
actions in the thumb zone.

## Tests

The domain suite has no dependencies:

```sh
npm test
# or
node --test
```

It covers room timers, capacity and request fitting, group check-in,
reservation editing and cancellation, and schema migrations from v1 to v4.

The browser flow suite is optional and needs Playwright:

```sh
npm run test:browser
```

`tests/flows.mjs` resolves Playwright from a local install, from
`PLAYWRIGHT_PATH=/path/to/playwright/package.json`, or from a globally
installed `@playwright/cli` bundle. If none is available it prints a skip
message and exits successfully; the app never depends on Playwright.

## Data

One key holds everything:

```text
hotelmanager:state
```

Schema version: **4**.

The persisted shape is approximately:

```js
{
  version: 4,
  rooms: [
    {
      id, name,
      type: "small" | "large" | "suite",
      state: "vacant" | "cleaning" | "dirty" | "occupied" | "oos",
      stayDays, stayStartedAt,          // occupied
      cleaningStartedAt,                // cleaning
      oosUntil, oosUnit                  // disabled; no oosUntil = open-ended
    }
  ],
  reservations: [
    {
      id, hostName,
      roomCounts: { small: 0, large: 0, suite: 0 },
      arrivalDate: "YYYY-MM-DD",
      days,
      createdAt
    }
  ],
  register: [
    {
      // the reservation snapshot plus:
      status: "checked_in" | "cancelled" | "no_show",
      registeredAt,
      assignedRooms: [{ id, name, type }]
    }
  ]
}
```

`arrivalDate` is a local calendar date and `days` means nights: a booking
covers `[arrival, arrival + days)`. Checkout is not stored; it is derived.

Schema v4 replaced the old single `roomType` with `roomCounts`, and replaced
register `roomId`/`roomName` with `assignedRooms`. Migration is one-way and
runs on load through `js/store.js`.

## Where things live

```text
index.html               shell and semantic markup
css/tokens.css           palette, spacing and type scale
css/app.css              layout and components
js/app.js                bootstrap and repaint wiring
js/store.js              state container, persistence and migrations
js/rooms.js              room types, states and timers
js/reservations.js       availability, bookings, check-in and history
js/ticker.js             scheduled reconciliation and repaints
js/views/front-desk.js   the single screen
js/components/           render helpers and dialogs
tests/domain.test.mjs    dependency-free domain checks
tests/flows.mjs          optional Playwright flow checks
package.json             dev commands; no dependencies
roadmap.txt              rules, spec, decisions, dev log and open work
```

## Known limitations

- One browser profile and one origin. There is no sync and no backup/export
  yet; clearing site data deletes the property.
- Deleting a room does not yet check whether a pending reservation still
  needs it.
- Register history has no pruning or filtering.
- No accessibility checklist or systematic responsive matrix is recorded yet.
- No payments, invoices, email, OTA integration or multi-property support.

These and the remaining work are tracked in `roadmap.txt`.

## Working on it

`roadmap.txt` is the source of truth for scope and history. Read section 1
before changing behaviour. Keep the app framework-free and dependency-free;
run the tests before committing, and add a dev-log entry when a change is
non-obvious.
