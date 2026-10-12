import { Duration } from "effect";
import { env } from "@/env";
import { nexiRequestTimeout } from "@/shared/backend/config/nexi.config";

/** Database, pricing, and fast Dotypos work besides the slow requests. */
const checkoutSubmitOverhead = Duration.seconds(10);

/**
 * The pay submit covers one full Dotypos request (the live hold guards or the
 * reservation note), then one full Nexi hosted page request, plus the rest of
 * its work. With the default timeouts that is the ordinary 45-second action
 * deadline in production and 70 seconds against the Nexi sandbox.
 */
export const getCheckoutSubmitDeadline = (requestTimeouts: {
  readonly dotypos: Duration.Duration;
  readonly nexi: Duration.Duration;
}) =>
  Duration.sum(
    Duration.sum(requestTimeouts.dotypos, requestTimeouts.nexi),
    checkoutSubmitOverhead
  );

export const checkoutSubmitDeadline = getCheckoutSubmitDeadline({
  dotypos: Duration.millis(env.DOTYPOS_API_TIMEOUT),
  nexi: nexiRequestTimeout,
});
