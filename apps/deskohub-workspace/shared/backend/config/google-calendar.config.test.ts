import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { getGoogleCalendarRequestWorstCaseDuration } from "@deskohub/google-calendar";
import { Duration } from "effect";
import { getGoogleCalendarRequestTimeout } from "./google-calendar.config";

describe("Workspace Google Calendar timeouts", () => {
  test.each([
    ["production", 5_000, 10_120],
    ["preview", 15_000, 30_120],
    ["development", 15_000, 30_120],
  ] as const)(
    "gives a %s attempt %i ms and a retried load %i ms",
    (deploymentEnvironment, attempt, worstCase) => {
      const timeout = getGoogleCalendarRequestTimeout(deploymentEnvironment);

      expect(Duration.toMillis(timeout)).toBe(attempt);
      expect(
        Duration.toMillis(getGoogleCalendarRequestWorstCaseDuration(timeout))
      ).toBe(worstCase);
    }
  );
});
