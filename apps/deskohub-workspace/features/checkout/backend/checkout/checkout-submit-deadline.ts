import { Duration } from "effect";
import { env } from "@/env";
import { getActionDeadline } from "@/shared/backend/action-deadline";
import { googleCalendarRequestWorstCaseDuration } from "@/shared/backend/config/google-calendar.config";
import { nexiRequestTimeout } from "@/shared/backend/config/nexi.config";

/**
 * The pay submit runs, one after another: the live hold guard (Dotypos), the
 * discount affirmation (a retried Google Calendar load alongside the Dotypos
 * customer discount), the reservation note (Dotypos), the live hold guard
 * again before the provider session (Dotypos), and the hosted payment page
 * (Nexi). With the default timeouts that is about 135 seconds in production
 * and 160 seconds against the Nexi sandbox.
 */
export const getCheckoutSubmitDeadline = (requestTimeouts: {
  readonly calendar: Duration.Duration;
  readonly dotypos: Duration.Duration;
  readonly nexi: Duration.Duration;
}) =>
  getActionDeadline([
    requestTimeouts.dotypos,
    Duration.max(requestTimeouts.calendar, requestTimeouts.dotypos),
    requestTimeouts.dotypos,
    requestTimeouts.dotypos,
    requestTimeouts.nexi,
  ]);

export const checkoutSubmitDeadline = getCheckoutSubmitDeadline({
  calendar: googleCalendarRequestWorstCaseDuration,
  dotypos: Duration.millis(env.DOTYPOS_API_TIMEOUT),
  nexi: nexiRequestTimeout,
});
