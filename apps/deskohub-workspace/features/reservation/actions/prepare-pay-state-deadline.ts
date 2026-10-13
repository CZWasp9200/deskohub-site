import { getCalendarActionDeadline } from "@/shared/backend/calendar-action-deadline";
import type { DeploymentEnvironment } from "@/shared/backend/config/deployment-request-timeout";

/**
 * Reservation submission awaits two Google Calendar loads in sequence: the
 * sales affirmation, then the availability check's limitations, whose
 * parallel Dotypos reads are usually faster.
 */
export const getPreparePayStateDeadline = (
  deploymentEnvironment: DeploymentEnvironment
) => getCalendarActionDeadline(deploymentEnvironment, 2);
