import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { dotyposApiTimeoutDefaultMilliseconds } from "@deskohub/dotypos";
import { getGoogleCalendarRequestWorstCaseDuration } from "@deskohub/google-calendar";
import { Duration } from "effect";
import { actionDeadlineCeiling } from "@/shared/backend/action-deadline";
import { getGoogleCalendarRequestTimeout } from "@/shared/backend/config/google-calendar.config";
import { getPreparePayStateDeadline } from "./prepare-pay-state-deadline";

const deadlineFor = (deploymentEnvironment: "production" | "preview") =>
  getPreparePayStateDeadline({
    calendar: getGoogleCalendarRequestWorstCaseDuration(
      getGoogleCalendarRequestTimeout(deploymentEnvironment)
    ),
    dotypos: Duration.millis(dotyposApiTimeoutDefaultMilliseconds),
  });

describe("prepare pay state deadline", () => {
  test.each([
    // Calendar, seven Dotypos phases, availability, overhead.
    ["production", 10_120 + 7 * 30_000 + 30_000 + 10_000],
    ["preview", 30_120 + 7 * 30_000 + 30_120 + 10_000],
  ] as const)("covers every sequential phase in %s", (environment, total) => {
    const deadline = deadlineFor(environment);

    expect(Duration.toMillis(deadline)).toBe(total);
    expect(Duration.isLessThanOrEqualTo(deadline, actionDeadlineCeiling)).toBe(
      true
    );
  });
});
