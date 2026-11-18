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
  `Checkbox`, `Switch` (optionally with a `label` before the track, grey off
  and orange on, and an `icon` its thumb always holds, as the Date heading's
  Overnight switch),
  `ToggleRow`, the radio card pieces in `radio-card.tsx`, `SegmentedChoice`, `ChoiceGroup`, `ChoiceList`.
- Overlays: `Dialog`, `ConfirmDialog`, `BottomSheet` (an optional fixed
  `header`, such as a `SearchField`; it stays above the keyboard), and the
  toast. A pick list in a sheet marks the chosen `ListRow` with `selected`.
- The update offer (`src/updates/`), in two presentations of one prompt:
  `UpdateBanner`, the prominent navy banner over the bottom of the screen,
  and `QuietUpdateOffer`, the quiet light card (`UpdateOfferCard`) a
  critical flow draws as the first item of its scrolling content.
- Booking: `BookingBar` (the expandable price bar with its itemized
  breakdown), the step progress, `BookingSectionHeading` (an aside, a text
  action, or a `control` on the right, such as the Overnight switch),
  `MonthCalendar`, `OvernightStayTimes` (the clock line under the calendar), the hold timer chip,
  `PriceLines`, and one money formatter (`src/i18n/money-format.ts`).
- The booking ticket: one `BookingTicket` for the Reservations list and the
  booking view, with `DateTile`, the status badge always at the top right,
  `BookingSteps` under the perforation, and `BookingTicketSkeleton` while it
  loads.

## Behaviour rules

- Toasts: `useToast().show(...)` under the root `ToastProvider`. Anything
  fixed to the bottom (tab bar with its raised circle, action footer, booking
  bar) reports what it covers with `useToastObstruction`, and toasts rise
  above it. Never offset a toast by hand. Another floating overlay at the
  bottom (the update banner) sits at `useFloatingBottomOffset()`.
- Update offer: `UpdateOfferProvider` at the root checks once and shares the
  one prompt, so accepting or dismissing it in either presentation does it
  in both. Critical flows (sign-in, sign-up onboarding, the booking steps
  and checkout, Profile opened from checkout) draw `QuietUpdateOffer` first
  in their scrolling content, with `backdrop="navy"` on the sign-in
  masthead and `"paper"` on the canvas; it scrolls with the screen, never
  pinned. Everywhere else (tab roots, account pages, reservations) the
  banner shows. A screen that shows the card, or a transient screen that
  should show no offer (auth callback, with `useUpdateOfferHost`), hosts
  the offer while focused and the banner stays away; never list routes.
- Loading: `LoadingIndicator` (the logo die) is the only spinner; never
  `ActivityIndicator`.
- Keyboard: `useKeyboardShown` and `keyboard-viewport.ts`; the focused field
  and the footer's action stay above the keyboard. A scroll view with text
  fields above a footer or bar takes `useFocusedFieldScroll` and provides its
  `FocusedFieldContext` (`ScrollScreen` already does): on focus, and when the
  keyboard shrinks the view, the focused `TextField` (label to messages)
  scrolls to end 16 dp above what follows. A new error alone moves nothing.
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
