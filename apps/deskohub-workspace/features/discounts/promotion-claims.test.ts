import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  WorkspaceDatabase,
  type WorkspaceTransaction,
} from "@/db/database.service";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import { PromotionClaims } from "./promotion-claims";

/** Runs a claim redemption in a transaction on the recording database. */
const redeemOnRecording = async (
  rows: (readonly unknown[])[],
  redeem: () => Effect.Effect<void, unknown, WorkspaceTransaction>
) => {
  const recording = await makeRecordingWorkspaceDatabase();
  recording.setRows(rows);
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const { transaction } = yield* WorkspaceDatabase;
      return yield* transaction(redeem());
    }).pipe(Effect.provide(recording.layer), Effect.result)
  );
  return { result, statements: recording.statements };
};

const redeemedAt = Temporal.Instant.from("2026-01-01T00:00:00Z");

describe("PromotionClaims.redeem", () => {
  test("re-redeems a released code claim within the per-customer use limit", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([
      // Released claim of this payment attempt.
      [["customer-1", "code-1", "released"]],
      // No voucher claim.
      [],
      // Code without total or per-customer limits.
      [[null, null]],
      // The same customer redeemed the code once more since the release.
      [[1, 1]],
      [],
    ]);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { transaction } = yield* WorkspaceDatabase;
        return yield* transaction(
          PromotionClaims.redeem({
            paymentAttemptId: "attempt-1" as never,
            redeemedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
            readmitReleased: true,
          })
        );
      }).pipe(Effect.provide(recording.layer), Effect.result)
    );

    expect(result._tag).toBe("Success");
    expect(
      recording.statements.some(({ sql }) =>
        sql.startsWith('update "discount_code_redemptions"')
      )
    ).toBe(true);
  });

  test("refuses to re-redeem a released code claim beyond the per-customer use limit", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([
      [["customer-1", "code-1", "released"]],
      [],
      // One use per customer.
      [[null, 1]],
      // The customer already holds another active use.
      [[1, 1]],
      [],
    ]);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { transaction } = yield* WorkspaceDatabase;
        return yield* transaction(
          PromotionClaims.redeem({
            paymentAttemptId: "attempt-1" as never,
            redeemedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
            readmitReleased: true,
          })
        );
      }).pipe(Effect.provide(recording.layer), Effect.result)
    );

    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") throw new Error("Expected failure");
    expect(result.failure).toMatchObject({
      _tag: "DiscountClaimError",
      reason: "usage_limit_reached",
    });
    expect(
      recording.statements.some(({ sql }) =>
        sql.startsWith('update "discount_code_redemptions"')
      )
    ).toBe(false);
  });

  test("refuses to re-redeem a released claim whose code no longer exists", async () => {
    const { result, statements } = await redeemOnRecording(
      [[["customer-1", "code-1", "released"]], [], []],
      () =>
        PromotionClaims.redeem({
          paymentAttemptId: "attempt-1" as never,
          redeemedAt,
          readmitReleased: true,
        })
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        operation: "redeem",
        reason: "unknown_code",
        codeId: "code-1",
      },
    });
    expect(statements.some(({ sql }) => sql.startsWith("update"))).toBe(false);
  });

  test("refuses to re-redeem a released claim whose voucher no longer exists", async () => {
    const { result, statements } = await redeemOnRecording(
      [[], [["application-1", "customer-1", "voucher-1", "released"]], []],
      () =>
        PromotionClaims.redeem({
          paymentAttemptId: "attempt-1" as never,
          redeemedAt,
          readmitReleased: true,
        })
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        operation: "redeem",
        reason: "unknown_code",
        codeId: "voucher-1",
      },
    });
    expect(statements.some(({ sql }) => sql.startsWith("update"))).toBe(false);
  });

  test("refuses to re-redeem a released voucher claim whose application is gone", async () => {
    const { result } = await redeemOnRecording(
      [
        [],
        [["application-1", "customer-1", "voucher-1", "released"]],
        [
          [
            "voucher-1",
            "promotion-1",
            "voucher",
            1000,
            2,
            "CZK",
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:00Z",
          ],
        ],
        [],
        [[false, 0]],
      ],
      () =>
        PromotionClaims.redeem({
          paymentAttemptId: "attempt-1" as never,
          redeemedAt,
          readmitReleased: true,
        })
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: "claim_conflict", codeId: "voucher-1" },
    });
  });
});
