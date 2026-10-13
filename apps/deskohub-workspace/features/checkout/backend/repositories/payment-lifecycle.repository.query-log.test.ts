import "@/shared/polyfills/temporal";

import { describe, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  collectDatabaseQueryLogs,
  expectQueryLogsToCensor,
} from "@/shared/testing/workspace-database-query-log.test-utils";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import { PaymentLifecycleRepository } from "./payment-lifecycle.repository";

describe("PaymentLifecycleRepository query logging", () => {
  test("censors the attached Nexi security token and redirect URL", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    const securityToken = "SYNTHETIC-NEXI-SECURITY-TOKEN";
    const providerRedirectUrl =
      "https://hpp.example.test/SYNTHETIC-NEXI-REDIRECT";

    const logs = await collectDatabaseQueryLogs(
      Effect.gen(function* () {
        const repository = yield* PaymentLifecycleRepository;
        yield* repository.attachProviderSession({
          id: "attempt-1" as never,
          securityToken,
          providerRedirectUrl,
        });
      }).pipe(
        Effect.provide(
          PaymentLifecycleRepository.Default.pipe(
            Layer.provide(recording.layer)
          )
        )
      )
    );

    expectQueryLogsToCensor({
      recording,
      logs,
      values: [securityToken, providerRedirectUrl],
    });
  });
});
