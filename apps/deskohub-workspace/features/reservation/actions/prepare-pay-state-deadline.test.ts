import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { dotyposApiTimeoutDefaultMilliseconds } from "@deskohub/dotypos";
import { getGoogleCalendarRequestWorstCaseDuration } from "@deskohub/google-calendar";
import { Duration } from "effect";
import { getGoogleCalendarRequestTimeout } from "@/shared/backend/config/google-calendar.config";
import { getPreparePayStateDeadline } from "./prepare-pay-state-deadline";

const deadlineFor = (deploymentEnvironment: "production" | "preview") =>
  Duration.toMillis(
    getPreparePayStateDeadline({
      calendar: getGoogleCalendarRequestWorstCaseDuration(
        getGoogleCalendarRequestTimeout(deploymentEnvironment)
      ),
      dotypos: Duration.millis(dotyposApiTimeoutDefaultMilliseconds),
    })
  );

describe("prepare pay state deadline", () => {
  test("covers a retried Calendar load and a full Dotypos request in production", () => {
    expect(deadlineFor("production")).toBe(10_120 + 30_000 + 10_000);
  });

  test("covers two retried Calendar loads in preview, where each outlasts Dotypos", () => {
    expect(deadlineFor("preview")).toBe(30_120 + 30_120 + 10_000);
  });
});
