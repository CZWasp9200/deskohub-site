import { Duration } from "effect";
import { env } from "@/env";
import { googleCalendarRequestWorstCaseDuration } from "@/shared/backend/config/google-calendar.config";

/** Database, pricing, and fast Dotypos work besides the slow requests. */
const preparePayStateOverhead = Duration.seconds(10);

/**
 * Reservation submission affirms the advertised discounts with one fully
 * retried Google Calendar load, then checks availability, which loads the
 * Calendar limitations alongside one full Dotypos request, plus the rest of
 * its work. With the default timeouts that is about 50 seconds in production
 * and 70 seconds elsewhere.
 */
export const getPreparePayStateDeadline = (requestTimeouts: {
  readonly calendar: Duration.Duration;
  readonly dotypos: Duration.Duration;
}) =>
  Duration.sum(
    Duration.sum(
      requestTimeouts.calendar,
      Duration.max(requestTimeouts.calendar, requestTimeouts.dotypos)
    ),
    preparePayStateOverhead
  );

export const preparePayStateDeadline = getPreparePayStateDeadline({
  calendar: googleCalendarRequestWorstCaseDuration,
  dotypos: Duration.millis(env.DOTYPOS_API_TIMEOUT),
});
