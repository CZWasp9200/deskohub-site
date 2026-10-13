import { Duration } from "effect";
import { env } from "@/env";
import { googleCalendarRequestWorstCaseDuration } from "@/shared/backend/config/google-calendar.config";
import { nexiRequestTimeout } from "@/shared/backend/config/nexi.config";

/** Database, pricing, and fast Dotypos work besides the slow requests. */
const checkoutSubmitOverhead = Duration.seconds(10);

/**
 * The pay submit covers one fully retried Google Calendar load (the discount
 * affirmation), one full Dotypos request (the live hold guards or the
 * reservation note), then one full Nexi hosted page request, plus the rest of
 * its work. With the default timeouts that is about 55 seconds in production
 * and 100 seconds against the Nexi sandbox.
 */
export const getCheckoutSubmitDeadline = (requestTimeouts: {
  readonly calendar: Duration.Duration;
  readonly dotypos: Duration.Duration;
  readonly nexi: Duration.Duration;
}) =>
  [
    requestTimeouts.calendar,
    requestTimeouts.dotypos,
    requestTimeouts.nexi,
  ].reduce(
    (deadline, requestTimeout) => Duration.sum(deadline, requestTimeout),
    checkoutSubmitOverhead
  );

export const checkoutSubmitDeadline = getCheckoutSubmitDeadline({
  calendar: googleCalendarRequestWorstCaseDuration,
  dotypos: Duration.millis(env.DOTYPOS_API_TIMEOUT),
  nexi: nexiRequestTimeout,
});
