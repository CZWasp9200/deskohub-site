import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import {
  discountApplications,
  discountCodeRedemptions,
  discountCodes,
  discounts,
  paymentAttempts,
} from "@/db/schema";
import {
  type PaymentAttemptId,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import {
  canonicalPromotionCodeSchema,
  discountCodeIdSchema,
  promotionCodeIdSchema,
  storedDiscountIdSchema,
} from "@/features/discounts/persistence-contracts";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { AttemptPromotionCodesRepository } from "./attempt-promotion-codes.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "AttemptPromotionCodesRepository on disposable Postgres",
  () => {
    const postgres = testDatabase as WorkspacePostgresTestDatabase;
    const reservationIds: WorkspaceReservationId[] = [];
    const discountIds: string[] = [];

    afterAll(async () => {
      await postgres.pool.query(
        "delete from discount_code_redemptions where payment_attempt_id in (select id from payment_attempts where workspace_reservation_id = any($1))",
        [reservationIds]
      );
      await postgres.pool.query(
        "delete from discount_applications where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await postgres.pool.query(
        "delete from discount_codes where discount_id = any($1)",
        [discountIds]
      );
      await postgres.pool.query("delete from discounts where id = any($1)", [
        discountIds,
      ]);
      await postgres.pool.query(
        "delete from payment_attempts where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await postgres.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
    });

    const failedAttempt = async () => {
      const id = crypto.randomUUID();
      const paymentAttemptId = paymentAttemptIdSchema.make(`attempt-${id}`);
      const { id: reservationId } = await Effect.runPromise(
        workspaceFixtures(postgres.db).reservation({
          stage: { reservation: "held", payment: "failed" },
        })
      );
      reservationIds.push(reservationId);
      await Effect.runPromise(
        postgres.db.insert(paymentAttempts).values({
          id: paymentAttemptId,
          workspaceReservationId: reservationId,
          provider: "nexi",
          providerOrderId: NexiOrderIdSchema.make(`order-${id}`),
          state: "failed",
          failureCode: "nexi_payment_failed",
          amountValue: 29_000,
          amountExponent: 2,
          currency: "CZK",
        })
      );
      return { reservationId, paymentAttemptId, id };
    };

    /** A released claim of `code` by the attempt, as its failure leaves it. */
    const claimCode = async (input: {
      readonly reservationId: WorkspaceReservationId;
      readonly paymentAttemptId: PaymentAttemptId;
      readonly id: string;
      readonly code: string;
    }) => {
      const discountId = storedDiscountIdSchema.make(crypto.randomUUID());
      discountIds.push(discountId);
      await Effect.runPromise(
        postgres.db.insert(discounts).values({
          id: discountId,
          percentageBasisPoints: 1000,
          labels: {
            "cs-CZ": "Syntetická sleva",
            "en-US": "Synthetic discount",
          },
        })
      );
      const codeId = discountCodeIdSchema.make(`retry-code-${input.id}`);
      await Effect.runPromise(
        postgres.db.insert(discountCodes).values({
          id: codeId,
          code: canonicalPromotionCodeSchema.make(input.code),
          enabled: true,
          promotionCodeId: promotionCodeIdSchema.make(codeId),
          discountId,
        })
      );
      const [application] = await Effect.runPromise(
        postgres.db
          .insert(discountApplications)
          .values({
            paymentAttemptId: input.paymentAttemptId,
            workspaceReservationId: input.reservationId,
            sequence: 0,
            publicDiscountId: "synthetic-discount",
            label: "Synthetic discount",
            adjustment: { kind: "percentage", basisPoints: 1000 },
            productIdentity: { kind: "cowork", tier: "basic" },
            subtotalBeforeValue: 32_200,
            subtotalBeforeExponent: 2,
            subtotalBeforeCurrency: "CZK",
            appliedAmountValue: 3200,
            appliedAmountExponent: 2,
            appliedAmountCurrency: "CZK",
            subtotalAfterValue: 29_000,
            subtotalAfterExponent: 2,
            subtotalAfterCurrency: "CZK",
            provenance: {
              providerNamespace: "synthetic",
              providerReference: "synthetic",
            },
          })
          .returning({ id: discountApplications.id })
      );
      if (!application) throw new Error("Discount application insert failed.");
      await Effect.runPromise(
        postgres.db.insert(discountCodeRedemptions).values({
          codeId,
          applicationId: application.id,
          paymentAttemptId: input.paymentAttemptId,
          dotyposCustomerId: DotyposCustomerIdSchema.make(
            `customer-${input.id}`
          ),
          state: "released",
          reservationExpiresAt: Temporal.Now.instant().add({ hours: 1 }),
          releasedAt: Temporal.Now.instant(),
          releaseReason: "payment_failed",
        })
      );
    };

    const find = (paymentAttemptId: PaymentAttemptId) =>
      AttemptPromotionCodesRepository.pipe(
        Effect.flatMap((repository) => repository.find(paymentAttemptId)),
        Effect.provide(
          AttemptPromotionCodesRepository.Default.pipe(
            Layer.provide(postgres.layer)
          )
        ),
        Effect.runPromise
      );

    test("reads the entered code of an attempt whose claim was released", async () => {
      const attempt = await failedAttempt();
      const code = `RETRY${attempt.id.slice(0, 8).toUpperCase()}`;
      await claimCode({ ...attempt, code });

      expect(await find(attempt.paymentAttemptId)).toEqual({
        enteredCode: code,
      });
    });

    test("reads no code for an attempt priced without one", async () => {
      const attempt = await failedAttempt();

      expect(await find(attempt.paymentAttemptId)).toEqual({});
    });
  }
);
