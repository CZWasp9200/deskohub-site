# Events

Business rules: `apps/deskohub-boardgame-bar/docs/events.md`. Code: `features/events` and `app/[locale]/events/page.tsx`.

## Calendar markers

Published events come from a dedicated Google Calendar, separate from the opening-hours calendar. Entries without a marker stay private.

- `[bar:event]` in the description publishes the entry, as a timed or an all-day event.
- `[bar:price:...]` publishes a price line, free-form text such as `150 Kč` or `vstup zdarma`.
- `[bar:link:https://...]` publishes a link to more information. Only absolute `https` values are kept.
- `[bar:image:<public id>]` publishes a poster from Cloudinary, the only remote image host the app allows. Values that are not a public id are dropped.

Markers never reach the published text, and the remaining description is converted from the calendar's HTML to plain text.

## Configuration

Share the calendar with the same service account the opening-hours calendar uses and let it see all event details. Set in Vercel Production and Preview:

- `GOOGLE_CALENDAR_EVENTS_ID`

The variable is optional. Without it the page renders its empty state, so a deployment that is not set up yet still builds and serves.

## Freshness

The page caches its list under the `events:upcoming` tag (`eventsTags.upcoming()`) with a `minutes` profile, so a calendar change appears without a deployment. There is no webhook or cron for events; if the listing has to react immediately, expire that tag the way the opening-hours webhook does.

## Failure behavior

`getUpcomingBarEvents` logs and resolves to an empty list when the calendar is missing, misconfigured, or unreachable, because an unavailable calendar must not fail the page.
