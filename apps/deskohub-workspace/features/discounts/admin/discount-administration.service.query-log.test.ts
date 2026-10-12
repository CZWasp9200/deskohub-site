import "@/shared/polyfills/temporal";

import { describe, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { GoogleCalendarService } from "@deskohub/google-calendar";
import { Effect, Layer } from "effect";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import {
  collectDatabaseQueryLogs,
  expectQueryLogsToCensor,
} from "@/shared/testing/workspace-database-query-log.test-utils";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import { DiscountAdministration } from "./discount-administration.service";

describe("DiscountAdministration query logging", () => {
  test("censors the code of a created voucher", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    const code = "SYNTHETIC-VOUCHER-CODE";

    const logs = await collectDatabaseQueryLogs(
      Effect.gen(function* () {
        const administration = yield* DiscountAdministration;
        yield* administration.createVoucher({
          code,
          enabled: true,
          validFrom: null,
          validUntil: null,
          credit: { value: 50_000, exponent: 2, currency: "CZK" },
        } as never);
      }).pipe(
        Effect.provide(
          DiscountAdministration.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                recording.layer,
                Layer.mock(GoogleCalendarService, {}),
                Layer.mock(DotyposService, {}),
                Layer.mock(CalendarResourceConfig, {
                  salesCalendarId: "sales-calendar" as never,
                })
              )
            )
          )
        )
      )
    );

    expectQueryLogsToCensor({ recording, logs, values: [code] });
  });
});
