# App design system

The approved boards (foundation 00–00e, screens 01–38) are built from shared
pieces: base components and tokens in `src/ui/`, booking pieces in
`src/booking/ui/`, and the booking ticket in
`src/account/reservations/booking-ticket.tsx`. A development build shows them
at `/dev/design-system` and `/dev/booking-components` (`__DEV__` only, never
in a release build). Build a screen from these; add to them only when a board
shows something none of them draws.

## Tokens (`src/ui/tokens.ts`)

- `color` names roles, not hues: `paper` (the canvas), `surface`, `sunken`,
  `navy`, `ink2`, `ink3`, `line`, `divider`, `action` (burned orange) and its
  pressed and tint shades, `danger`, `positive`, `warning`, the calendar and
  arrow greys, and so on. Screens never write a hex colour: a board colour
  without a role becomes a token with a comment saying where it shows.
- `space` (with `gutter`), `radius`, `shadow`, `touchTarget` (48),
  `typeScale` with `brandText` for the brand font, and
  `tabBarRaisedOverhang`.
- Icons are lucide glyphs drawn through `Icon` (`src/ui/icon.tsx`) at an
  `IconSize`; the icon is hidden from assistive tech and its control carries
  the name.

## Shared components

- Screens: `ScrollScreen`, `Screen`, `AppBar`, the navy `Masthead`,
  `ActionFooter` (the screen's main action, above the keyboard), `TabBar`.
- Content: `ListGroup`, `ListRow`, `SectionHeader`, `Card`, `Notice`,
  `Badge`, `EmptyState`, `GateCard`, `Skeleton`, and `LoadingState`,
  `ErrorState`, `RefreshingIndicator` for a screen's async states.
- Controls: `Button` and `ButtonRow`, `IconButton` (its `label` is required:
  every icon-only control has a screen-reader name), `TextField` and the field
  pieces in `field.tsx`, `SelectField`, `SearchField` (a list's filter; its
  placeholder is its name), `CountryField` (the searchable country sheet),
  `Checkbox`, `Switch`,
  `ToggleRow`, the radio card pieces in `radio-card.tsx`, `SegmentedChoice`, `ChoiceGroup`, `ChoiceList`.
- Overlays: `Dialog`, `ConfirmDialog`, `BottomSheet` (an optional fixed
  `header`, such as a `SearchField`; it stays above the keyboard), and the
  toast. A pick list in a sheet marks the chosen `ListRow` with `selected`.
- Booking: `BookingBar` (the expandable price bar with its itemized
  breakdown), the step progress, `MonthCalendar`, the hold timer chip,
  `PriceLines`, and one money formatter (`src/i18n/money-format.ts`).
- The booking ticket: one `BookingTicket` for the Reservations list and the
  booking view, with `DateTile`, the status badge always at the top right,
  `BookingSteps` under the perforation, and `BookingTicketSkeleton` while it
  loads.

## Behaviour rules

- Toasts: `useToast().show(...)` under the root `ToastProvider`. Anything
  fixed to the bottom (tab bar with its raised circle, action footer, booking
  bar) reports what it covers with `useToastObstruction`, and toasts rise
  above it. Never offset a toast by hand.
- Loading: `LoadingIndicator` (the logo die) is the only spinner; never
  `ActivityIndicator`.
- Keyboard: `useKeyboardShown` and `keyboard-viewport.ts`; the focused field
  and the footer's action stay above the keyboard.
- Text: `Text` with a `typeScale` variant and a tone. Labels wrap or shrink;
  never truncate a label. Every screen holds at 360 dp, with text 30% longer
  and at 200% font size.
- Names and formats: product names are the catalog's (the website's) names,
  never the boards'; times follow the device's 12- or 24-hour setting; booking
  dates are Prague dates.

## What not to build

- Headlines, subtitles or helper text a board doesn't show, or text that
  restates what the screen already shows.
- A second loading indicator, toast, ticket, price bar, money formatter or
  calendar; a screen-local colour, size or font.
- Site React components inside the app.
- Tests that assert copy wording; check structure and behaviour.
