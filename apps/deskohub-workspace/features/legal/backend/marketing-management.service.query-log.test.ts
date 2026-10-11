import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Effect, Layer } from "effect";
import {
  collectDatabaseQueryLogs,
  expectQueryLogsToCensor,
} from "@/shared/testing/workspace-database-query-log.test-utils";
import {
  makeRecordingWorkspaceDatabase,
  type RecordingWorkspaceDatabase,
} from "@/shared/testing/workspace-recording-database.test-utils";
import {
  type IMarketingManagementService,
  MarketingManagementService,
} from "./marketing-management.service";

const syntheticToken = Buffer.alloc(32, 7).toString("base64url");

const hashToken = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");

const collectServiceQueryLogs = <A>(
  recording: RecordingWorkspaceDatabase,
  run: (service: IMarketingManagementService) => Effect.Effect<A, unknown>
) =>
  collectDatabaseQueryLogs(
    Effect.gen(function* () {
      return yield* run(yield* MarketingManagementService);
    }).pipe(
      Effect.provide(
        MarketingManagementService.Default.pipe(Layer.provide(recording.layer))
      )
    )
  );

describe("MarketingManagementService query logging", () => {
  test("censors the hash of an issued link token", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    let issued = "";

    const logs = await collectServiceQueryLogs(recording, (service) =>
      service
        .issue("dotypos-customer-1" as never)
        .pipe(Effect.tap((token) => Effect.sync(() => (issued = token))))
    );

    expect(issued).not.toBe("");
    expectQueryLogsToCensor({ recording, logs, values: [hashToken(issued)] });
  });

  test("censors the link and session hashes of an exchange", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([
      [["dotypos-customer-1", "2099-06-10T08:00:00Z"]], // revoked link row
      [], // session insert
    ]);
    let sessionToken = "";

    const logs = await collectServiceQueryLogs(recording, (service) =>
      service
        .exchange(syntheticToken)
        .pipe(
          Effect.tap(({ token }) => Effect.sync(() => (sessionToken = token)))
        )
    );

    expect(sessionToken).not.toBe("");
    expectQueryLogsToCensor({
      recording,
      logs,
      values: [hashToken(syntheticToken), hashToken(sessionToken)],
    });
  });

  test("censors the session hash when resolving a cookie", async () => {
    const recording = await makeRecordingWorkspaceDatabase();

    const logs = await collectServiceQueryLogs(recording, (service) =>
      service.resolve(syntheticToken)
    );

    expectQueryLogsToCensor({
      recording,
      logs,
      values: [hashToken(syntheticToken)],
    });
  });

  test("censors the session hash in both revoke statements", async () => {
    const recording = await makeRecordingWorkspaceDatabase();

    const logs = await collectServiceQueryLogs(recording, (service) =>
      service.revoke(syntheticToken)
    );

    const tokenHash = hashToken(syntheticToken);
    expect(
      recording.statements.filter(({ params }) => params.includes(tokenHash))
    ).toHaveLength(2);
    expect(logs).toHaveLength(2);
    expectQueryLogsToCensor({ recording, logs, values: [tokenHash] });
  });
});
