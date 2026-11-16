import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import type {
  PaymentAttemptState,
  ReferralInvitationClaimState,
} from "@/db/schema";
import { admitReferralNexiPayment } from "@/features/checkout/backend/repositories/payment-lifecycle.test-utils";
import { PaymentTerminalTransitions } from "@/features/checkout/backend/repositories/payment-terminal-transitions";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { E2EDatabase } from "../integrations/database.service";
import {
  nexiSandboxRejectedFailureCode,
  retireRejectedAttempt,
} from "./lifecycle-fixtures";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const admitPayment = () =>
  Effect.runPromise(admitReferralNexiPayment(testDatabase!));

const retire = (
  orderId: WorkspaceReservationId,
  paymentAttemptId: PaymentAttemptId
) =>
  retireRejectedAttempt(orderId, paymentAttemptId).pipe(
    Effect.provideService(
      E2EDatabase,
      E2EDatabase.of({ db: testDatabase!.db })
    ),
    Effect.result,
    Effect.runPromise
  );

const readClaim = async (paymentAttemptId: PaymentAttemptId) => {
  const { rows } = await testDatabase!.pool.query<{
    state: ReferralInvitationClaimState;
    release_reason: string | null;
  }>(
    "select state, release_reason from referral_invitation_claims where payment_attempt_id = $1",
    [paymentAttemptId]
  );
  return rows[0];
};

describe.skipIf(!testDatabase)(
  "Sandbox-rejected attempt retirement on disposable Postgres",
  () => {
    test("retires an unpaid attempt through the app transition and releases its claim", async () => {
      const { attempt, reservation } = await admitPayment();

      const result = await retire(reservation.id, attempt.id);

      expect(result).toMatchObject({
        _tag: "Success",
        success: {
          payment_attempt_id: attempt.id,
          payment_attempt_state: "failed",
          payment_state: "failed",
          reservation_state: "held",
          failure_code: nexiSandboxRejectedFailureCode,
        },
      });
      expect(await readClaim(attempt.id)).toEqual({
        state: "released",
        release_reason: nexiSandboxRejectedFailureCode,
      });
    });

    test.each(["cancelled", "expired"] as const)(
      "resolves an attempt the app already %s to its restartable row",
      async (state) => {
        const { attempt, reservation } = await admitPayment();
        await PaymentTerminalTransitions.use((transitions) =>
          transitions.markTerminal({
            id: attempt.id,
            workspaceReservationId: reservation.id,
            state,
            failureCode: "synthetic_app_terminal",
          })
        ).pipe(
          Effect.provide(
            PaymentTerminalTransitions.Default.pipe(
              Layer.provide(testDatabase!.layer)
            )
          ),
          Effect.runPromise
        );

        const result = await retire(reservation.id, attempt.id);

        expect(result).toMatchObject({
          _tag: "Success",
          success: {
            payment_attempt_id: attempt.id,
            payment_attempt_state: state,
            payment_state: state,
            reservation_state: "held",
            failure_code: "synthetic_app_terminal",
          },
        });
      }
    );

    test("reports a claim the app refuses to release as an E2E error", async () => {
      const { attempt, reservation } = await admitPayment();
      await testDatabase!.pool.query(
        "update referral_invitation_claims set state = 'redeemed', redeemed_at = now() where payment_attempt_id = $1",
        [attempt.id]
      );

      const result = await retire(reservation.id, attempt.id);

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "WorkspaceE2EError",
          operation: "retire rejected payment attempt",
          cause: { _tag: "DiscountClaimError", reason: "claim_conflict" },
        },
      });
      const { rows } = await testDatabase!.pool.query<{
        state: PaymentAttemptState;
      }>("select state from payment_attempts where id = $1", [attempt.id]);
      expect(rows).toEqual([{ state: attempt.state }]);
    });
  }
);
