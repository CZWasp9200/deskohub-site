import { Duration } from "effect";
import { env } from "@/env";
import { getActionDeadline } from "@/shared/backend/action-deadline";
import { googleCalendarRequestWorstCaseDuration } from "@/shared/backend/config/google-calendar.config";

/**
 * Discount-code entry runs, one after another: the live hold guard (Dotypos),
 * the displayed-discount affirmation (a retried Google Calendar load
 * alongside the Dotypos customer discount), and the live hold guard again
 * (Dotypos). With the default timeouts that is about 100 seconds.
 */
export const getApplyDiscountCodeDeadline = (requestTimeouts: {
  readonly calendar: Duration.Duration;
  readonly dotypos: Duration.Duration;
}) =>
  getActionDeadline([
    requestTimeouts.dotypos,
    Duration.max(requestTimeouts.calendar, requestTimeouts.dotypos),
    requestTimeouts.dotypos,
  ]);

export const applyDiscountCodeDeadline = getApplyDiscountCodeDeadline({
  calendar: googleCalendarRequestWorstCaseDuration,
  dotypos: Duration.millis(env.DOTYPOS_API_TIMEOUT),
});
