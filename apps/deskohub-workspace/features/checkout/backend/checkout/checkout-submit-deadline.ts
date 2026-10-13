import { getGoogleCalendarRequestWorstCaseDuration } from "@deskohub/google-calendar";
import { Duration } from "effect";
import { env } from "@/env";
import type { DeploymentEnvironment } from "@/shared/backend/config/deployment-request-timeout";
import { getGoogleCalendarRequestTimeout } from "@/shared/backend/config/google-calendar.config";
import { getNexiRequestTimeoutMilliseconds } from "@/shared/backend/config/nexi.config";

/** Database, pricing, and fast Dotypos work besides the slow requests. */
const checkoutSubmitOverhead = Duration.seconds(10);

/**
 * The pay submit covers one full Dotypos request (the live hold guards or the
 * reservation note) and one full Nexi hosted page request, plus the rest of
 * its work. The discount affirmation awaits Google Calendar in sequence with
 * that work, so one retried Calendar load is added on top. With the default
 * timeouts that is about 55 seconds in production and 100 seconds against
 * the Nexi sandbox.
 */
export const getCheckoutSubmitDeadline = (
  deploymentEnvironment: DeploymentEnvironment
) =>
  [
    getGoogleCalendarRequestWorstCaseDuration(
      getGoogleCalendarRequestTimeout(deploymentEnvironment)
    ),
    Duration.millis(env.DOTYPOS_API_TIMEOUT),
    Duration.millis(getNexiRequestTimeoutMilliseconds(deploymentEnvironment)),
  ].reduce(
    (deadline, requestTimeout) => Duration.sum(deadline, requestTimeout),
    checkoutSubmitOverhead
  );

export const checkoutSubmitDeadline = getCheckoutSubmitDeadline(env.VERCEL_ENV);
