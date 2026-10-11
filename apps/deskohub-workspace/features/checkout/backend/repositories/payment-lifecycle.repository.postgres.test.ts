import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import {
  accountingDocumentSnapshots,
  discountApplications,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentSnapshotSchema,
} from "@/features/accounting/accounting-document-snapshot";
import { makeCoworkInvoiceDocument } from "@/features/accounting/invoice.test-utils";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import {
  type DiscountCommitment,
  makeDiscountCommitment,
} from "@/features/discounts/commitment";
import { discountIdSchema } from "@/features/discounts/contracts";
import {
  discountCodeIdSchema,
  storedDiscountIdSchema,
} from "@/features/discounts/persistence-contracts";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { PaymentLifecycleRepository } from "./payment-lifecycle.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "PaymentLifecycleRepository on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const reservationIds: WorkspaceReservationId[] = [];

    afterAll(async () => {
      // Snapshots may only be deleted once their attempt is terminal.
      await testDatabase.pool.query(
        "update payment_attempts set state = 'expired', failure_code = 'synthetic_cleanup' where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from accounting_document_snapshots where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from discount_applications where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from payment_attempts where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
    });

    const runResult = <A, E>(
      operation: (
        repository: typeof PaymentLifecycleRepository.Service
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* operation(yield* PaymentLifecycleRepository);
        }).pipe(
          Effect.provide(PaymentLifecycleRepository.Default),
          Effect.provide(testDatabase.layer),
          Effect.result
        )
      );

    /** Inserts a synthetic held reservation that has not started payment. */
    const insertHeldReservation = async () => {
      const id = crypto.randomUUID();
      const reservationId = workspaceReservationIdSchema.make(
        `lifecycle-reservation-${id}`
      );
      const dotyposCustomerId = DotyposCustomerIdSchema.make(`customer-${id}`);
      const dotyposReservationId = DotyposReservationIdSchema.make(
        `dotypos-${id}`
      );
      reservationIds.push(reservationId);
      await Effect.runPromise(
        testDatabase.db.insert(workspaceReservations).values({
          id: reservationId,
          checkoutSessionKey: `lifecycle-session-${id}`,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(`attempt-${id}`),
          dotyposCustomerId,
          dotyposReservationId,
          reservationState: "held",
          paymentState: "not_started",
          fulfillmentState: "not_started",
          reservationHoldExpiresAt: Temporal.Now.instant().add({ minutes: 15 }),
          reservationDetails: {
            kind: "cowork",
            entryTier: "open-space",
            coffee: true,
          },
          locale: "en-US",
        })
      );
      return { id, reservationId, dotyposCustomerId, dotyposReservationId };
    };

    const makeSnapshot = (reservation: {
      readonly reservationId: WorkspaceReservationId;
      readonly dotyposCustomerId: string;
      readonly dotyposReservationId: string;
    }): AccountingDocumentSnapshot => {
      const {
        fulfilledAt: _fulfilledAt,
        invoiceNumber: _invoiceNumber,
        issuedAt: _issuedAt,
        paidAt: _paidAt,
        paymentAttemptId: _paymentAttemptId,
        supplier: invoiceSupplier,
        ...identity
      } = makeCoworkInvoiceDocument("en-US");
      const { commercialRegister: _commercialRegister, ...supplier } =
        invoiceSupplier;

      return Schema.decodeUnknownSync(accountingDocumentSnapshotSchema)({
        ...identity,
        workspaceReservationId: reservation.reservationId,
        dotyposCustomerId: reservation.dotyposCustomerId,
        dotyposReservationId: reservation.dotyposReservationId,
        supplier,
        billing: { purpose: "personal", invoice: "none" },
        delivery: { email: "synthetic@example.test" },
      });
    };

    const createPendingNexiAttempt = (input: {
      readonly reservationId: WorkspaceReservationId;
      readonly id: string;
      readonly snapshot: AccountingDocumentSnapshot;
      readonly commitment: DiscountCommitment;
    }) =>
      runResult((repository) =>
        repository.createPendingNexiAttempt({
          workspaceReservationId: input.reservationId,
          providerOrderId: NexiOrderIdSchema.make(`order-${input.id}`),
          amount: input.snapshot.quote.payment.expectedPrice,
          commitment: input.commitment,
          locale: "en-US",
          accountingSnapshot: input.snapshot,
        })
      );

    const readRows = async (reservationId: WorkspaceReservationId) => {
      const [reservation] = await Effect.runPromise(
        testDatabase.db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, reservationId))
      );
      const attempts = await Effect.runPromise(
        testDatabase.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.workspaceReservationId, reservationId))
      );
      const snapshots = await Effect.runPromise(
        testDatabase.db
          .select({
            paymentAttemptId: accountingDocumentSnapshots.paymentAttemptId,
          })
          .from(accountingDocumentSnapshots)
          .where(
            eq(
              accountingDocumentSnapshots.workspaceReservationId,
              reservationId
            )
          )
      );
      const applications = await Effect.runPromise(
        testDatabase.db
          .select({ id: discountApplications.id })
          .from(discountApplications)
          .where(eq(discountApplications.workspaceReservationId, reservationId))
      );
      return { reservation, attempts, snapshots, applications };
    };

    test("admits the attempt, its accounting snapshot, and the reservation link together", async () => {
      const reservation = await insertHeldReservation();

      const result = await createPendingNexiAttempt({
        ...reservation,
        snapshot: makeSnapshot(reservation),
        commitment: makeDiscountCommitment({
          product: { kind: "cowork", tier: "basic" },
          applications: [],
        }),
      });

      expect(result._tag).toBe("Success");
      const rows = await readRows(reservation.reservationId);
      expect(rows.attempts).toHaveLength(1);
      const attemptId = rows.attempts[0]?.id;
      expect(rows.attempts[0]?.state).toBe("created");
      expect(rows.snapshots).toEqual([{ paymentAttemptId: attemptId }]);
      expect(rows.reservation?.activePaymentAttemptId).toBe(attemptId);
      expect(rows.reservation?.paymentState).toBe("pending");
    });

    test("rolls back the attempt, snapshot, and link when the discount claim is refused", async () => {
      const reservation = await insertHeldReservation();
      const snapshot = makeSnapshot(reservation);
      const discount = {
        id: Schema.decodeUnknownSync(discountIdSchema)("public-discount"),
        label: "Synthetic discount",
        adjustment: { kind: "percentage" as const, basisPoints: 1000 },
      };
      const subtotalBefore = snapshot.quote.payment.expectedPrice;
      const amount = { ...subtotalBefore, value: subtotalBefore.value / 10 };
      const product = { kind: "cowork", tier: "basic" } as const;

      const result = await createPendingNexiAttempt({
        ...reservation,
        snapshot,
        commitment: makeDiscountCommitment({
          product,
          applications: [
            {
              application: {
                discount,
                subtotalBefore,
                amount,
                subtotalAfter: {
                  ...subtotalBefore,
                  value: subtotalBefore.value - amount.value,
                },
              },
              candidate: {
                discount,
                provenance: {
                  providerNamespace: "synthetic",
                  providerReference: "synthetic",
                },
                // The claim names another customer, which the claim admission
                // refuses after the attempt rows are written.
                claim: {
                  kind: "discount_code",
                  codeId: discountCodeIdSchema.make(`code-${reservation.id}`),
                  storedDiscountId: storedDiscountIdSchema.make(
                    crypto.randomUUID()
                  ),
                  dotyposCustomerId: DotyposCustomerIdSchema.make(
                    `other-customer-${reservation.id}`
                  ),
                  product,
                },
              },
            },
          ],
        }),
      });

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "DiscountClaimError", reason: "customer_ineligible" },
      });
      const rows = await readRows(reservation.reservationId);
      expect(rows.attempts).toEqual([]);
      expect(rows.snapshots).toEqual([]);
      expect(rows.applications).toEqual([]);
      expect(rows.reservation?.activePaymentAttemptId).toBeNull();
      expect(rows.reservation?.paymentState).toBe("not_started");
    });
  }
);
