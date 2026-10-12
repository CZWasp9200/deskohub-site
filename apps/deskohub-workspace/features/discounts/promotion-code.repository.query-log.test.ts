import "@/shared/polyfills/temporal";

import { describe, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  collectDatabaseQueryLogs,
  expectQueryLogsToCensor,
} from "@/shared/testing/workspace-database-query-log.test-utils";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import { canonicalPromotionCodeSchema } from "./contracts";
import { PromotionCodeRepository } from "./promotion-code.repository";

describe("PromotionCodeRepository query logging", () => {
  test("censors the submitted code it looks up", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    const code = canonicalPromotionCodeSchema.make("SYNTHETIC-SUBMITTED-CODE");

    const logs = await collectDatabaseQueryLogs(
      Effect.gen(function* () {
        const repository = yield* PromotionCodeRepository;
        yield* repository.findByCode({ code });
      }).pipe(
        Effect.provide(
          PromotionCodeRepository.Default.pipe(Layer.provide(recording.layer))
        )
      )
    );

    expectQueryLogsToCensor({ recording, logs, values: [code] });
  });
});
