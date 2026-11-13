# Accessibility

Checked on 2026-11-13 in Chromium 151.0.7922.10 (Playwright build),
360 × 740 CSS px, dark theme, with a keyboard only unless a step says
otherwise. The browser suite (`tests/flows.mjs`) performs the same checks so
they can be repeated after any focus or DOM change.

## Checklist

| Area | Check | Result |
| --- | --- | --- |
| Keyboard | Every control is reachable with Tab / Shift+Tab; the focus ring is visible. | Pass |
| Keyboard | Next/previous month, the calendar grid, a day sheet, booking, editing, cancelling and Incoming/Register are all operable without a pointer. | Pass |
| Keyboard | The calendar is a labelled group with one tab stop; Arrow keys move day by day and week by week, Home/End go to the ends of the month. | Pass |
| Keyboard | Enter on a day opens its sheet; Enter on "New reservation" reaches the host field first and Enter on "Add reservation" saves. | Pass |
| Focus | Saving a booking returns focus to the exact day cell that opened the sheet. | Pass |
| Focus | Saving an edit returns focus to the exact Incoming row; after a cancel, focus moves to the next row, or to Close inside Incoming when the list is empty. | Pass |
| Focus | Closing a room-state or availability sheet returns focus to the room card or day cell that opened it. Escape does the same. | Pass |
| Focus | Dialogs use the native `<dialog>` element, so focus stays inside while open. | Pass |
| Live regions | The stay-filter result is a polite live region and updates as counts or days change. | Pass |
| Live regions | A save, edit, cancel, check-in, check-in confirmation and room add/edit/delete are announced through one polite status region. | Pass |
| Live regions | Refusals (invalid count, capacity conflict, guarded delete, failed restore) use `role="alert"` at the point of failure. | Pass |
| Contrast | Normal text meets WCAG AA (≥ 4.5:1) on every surface it ships on. | Pass |
| Zoom | At 200% text size the page has no horizontal scroll and no sheet has internal horizontal overflow. | Pass |

## Contrast

Ratios are computed from the shipped tokens in `css/tokens.css`;
`tests/contrast.test.mjs` fails `npm test` if a token drops below AA.

| Foreground | On `--bg` | On `--surface` | On `--surface-raised` |
| --- | --- | --- | --- |
| `--text` | 15.87 | 14.62 | 13.41 |
| `--text-muted` | 5.67 | 5.22 | 4.79 |
| `--accent` | 6.89 | 6.35 | 5.83 |
| `--danger` / `--state-oos` | 6.00 | 5.53 | 5.07 |
| `--state-vacant` | 11.14 | 10.27 | 9.42 |
| `--state-occupied` | 7.35 | 6.77 | 6.21 |
| `--state-dirty` | 11.63 | 10.72 | 9.83 |
| `--state-cleaning` | 9.06 | 8.35 | 7.66 |

Button labels are dark text on a filled colour: primary is 6.45:1 and the
armed danger button is 5.92:1. Disabled text is exempt and is not counted.

## 200% text at 360px

`document.documentElement.style.fontSize = "200%"` with the viewport at
360px, then this was checked for each open sheet:

- document `scrollWidth` equals the viewport width;
- the sheet body and header have `scrollWidth` equal to `clientWidth`;
- no descendant renders a scrollable horizontal overflow.

Checked with the desk view, availability day sheet, new and editing
reservation sheets, Incoming, Register, room state, Manage Rooms and Data.
Long titles and paired action buttons wrap or stack instead of forcing the
sheet wider; form controls may shrink below their intrinsic width.

## Repeat it

```sh
npm test             # domain, store and colour-contrast checks
npm run test:browser # Chromium: keyboard, focus return, ARIA and 200% text
```

The browser suite needs Playwright (see README). The keyboard section runs
without a pointer: Tab to a month arrow, Enter, Tab into the grid, Arrow keys,
Enter, New reservation, type a host, save, then follow the Incoming row
through edit and cancel. After any change to focus handling or dialog markup,
repeat the checklist and update the result column in this file.
