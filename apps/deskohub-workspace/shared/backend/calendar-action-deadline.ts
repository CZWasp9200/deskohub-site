import { getGoogleCalendarRequestWorstCaseDuration } from "@deskohub/google-calendar";
import { Duration } from "effect";
import { env } from "@/env";
import type { DeploymentEnvironment } from "./config/deployment-request-timeout";
import { getGoogleCalendarRequestTimeout } from "./config/google-calendar.config";
import { workspaceActionDeadline } from "./workspace-action";

/**
 * The ordinary action deadline plus one retried Google Calendar load, for an
 * action that awaits Calendar in sequence with its other work. The added
 * budget lets a Calendar retry succeed; like the ordinary deadline, it does
 * not cover every other provider being slow at once.
 */
export const getCalendarActionDeadline = (
  deploymentEnvironment: DeploymentEnvironment
) =>
  Duration.sum(
    workspaceActionDeadline,
    getGoogleCalendarRequestWorstCaseDuration(
      getGoogleCalendarRequestTimeout(deploymentEnvironment)
    )
  );

export const calendarActionDeadline = getCalendarActionDeadline(env.VERCEL_ENV);
