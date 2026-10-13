import { Duration } from "effect";
import { env } from "@/env";
import { getActionDeadline } from "@/shared/backend/action-deadline";
import { googleCalendarRequestWorstCaseDuration } from "@/shared/backend/config/google-calendar.config";

/**
 * Reservation submission runs, one after another: the advertised discount
 * affirmation (a retried Google Calendar load), the Dotypos customer lookup
 * and creation, the Dotypos customer discount, the superseded hold's Dotypos
 * status check and cancellation, the availability check (Calendar limitations
 * alongside Dotypos reservations), table assignment (Dotypos), and the hold
 * creation (Dotypos). With the default timeouts that is about 260 seconds in
 * production and 280 seconds elsewhere.
 */
export const getPreparePayStateDeadline = (requestTimeouts: {
  readonly calendar: Duration.Duration;
  readonly dotypos: Duration.Duration;
}) =>
  getActionDeadline([
    requestTimeouts.calendar,
    requestTimeouts.dotypos,
    requestTimeouts.dotypos,
    requestTimeouts.dotypos,
    requestTimeouts.dotypos,
    requestTimeouts.dotypos,
    Duration.max(requestTimeouts.calendar, requestTimeouts.dotypos),
    requestTimeouts.dotypos,
    requestTimeouts.dotypos,
  ]);

export const preparePayStateDeadline = getPreparePayStateDeadline({
  calendar: googleCalendarRequestWorstCaseDuration,
  dotypos: Duration.millis(env.DOTYPOS_API_TIMEOUT),
});
