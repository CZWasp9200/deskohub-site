import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { dotyposApiTimeoutDefaultMilliseconds } from "@deskohub/dotypos";
import { getGoogleCalendarRequestWorstCaseDuration } from "@deskohub/google-calendar";
import { Duration } from "effect";
import { actionDeadlineCeiling } from "@/shared/backend/action-deadline";
import { getGoogleCalendarRequestTimeout } from "@/shared/backend/config/google-calendar.config";
import { getApplyDiscountCodeDeadline } from "./apply-discount-code-deadline";

describe("apply discount code deadline", () => {
  test.each([
    // Guard, Calendar alongside the Dotypos customer discount, guard, overhead.
    ["production", 30_000 + 30_000 + 30_000 + 10_000],
    ["preview", 30_000 + 30_120 + 30_000 + 10_000],
  ] as const)(
    "covers both live guards around pricing in %s",
    (environment, total) => {
      const deadline = getApplyDiscountCodeDeadline({
        calendar: getGoogleCalendarRequestWorstCaseDuration(
          getGoogleCalendarRequestTimeout(environment)
        ),
        dotypos: Duration.millis(dotyposApiTimeoutDefaultMilliseconds),
      });

      expect(Duration.toMillis(deadline)).toBe(total);
      expect(
        Duration.isLessThanOrEqualTo(deadline, actionDeadlineCeiling)
      ).toBe(true);
    }
  );
});
