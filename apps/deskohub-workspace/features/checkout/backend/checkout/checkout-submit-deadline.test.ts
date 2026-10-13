import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { dotyposApiTimeoutDefaultMilliseconds } from "@deskohub/dotypos";
import { getGoogleCalendarRequestWorstCaseDuration } from "@deskohub/google-calendar";
import { Duration } from "effect";
import { actionDeadlineCeiling } from "@/shared/backend/action-deadline";
import { getGoogleCalendarRequestTimeout } from "@/shared/backend/config/google-calendar.config";
import { getNexiRequestTimeoutMilliseconds } from "@/shared/backend/config/nexi.config";
import { getCheckoutSubmitDeadline } from "./checkout-submit-deadline";

describe("checkout submit deadline", () => {
  test.each([
    // Guard, Calendar alongside Dotypos, note, guard, Nexi, overhead.
    ["production", 30_000 + 30_000 + 30_000 + 30_000 + 5000 + 10_000],
    ["preview", 30_000 + 30_120 + 30_000 + 30_000 + 30_000 + 10_000],
  ] as const)("covers every sequential phase in %s", (environment, total) => {
    const deadline = getCheckoutSubmitDeadline({
      calendar: getGoogleCalendarRequestWorstCaseDuration(
        getGoogleCalendarRequestTimeout(environment)
      ),
      dotypos: Duration.millis(dotyposApiTimeoutDefaultMilliseconds),
      nexi: Duration.millis(getNexiRequestTimeoutMilliseconds(environment)),
    });

    expect(Duration.toMillis(deadline)).toBe(total);
    expect(Duration.isLessThanOrEqualTo(deadline, actionDeadlineCeiling)).toBe(
      true
    );
  });
});
