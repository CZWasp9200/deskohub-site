import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { testEmailAddress } from "@deskohub/test-email";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import {
  accountingDocumentSnapshots,
  discountApplications,
  discountCodes,
  discountProductTargets,
  discounts,
  paymentAttempts,
  promotionCodes,
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
import { deriveOpaqueDiscountId } from "@/features/discounts/opaque-discount-id";
import {
  canonicalPromotionCodeSchema,
  discountCodeIdSchema,
  promotionCodeIdSchema,
  type StoredDiscountId,
  storedDiscountIdSchema,
  voucherIdSchema,
} from "@/features/discounts/persistence-contracts";
import type { WorkspaceProductTarget } from "@/features/discounts/product-target";
import { m } from "@/features/i18n";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { waitForPostgresLockWaiter } from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { PaymentLifecycleRepository } from "./payment-lifecycle.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "PaymentLifecycleRepository on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const reservationIds: WorkspaceReservationId[] = [];
    const discountIds: StoredDiscountId[] = [];

    const voucherIds: string[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from voucher_redemptions where voucher_id = any($1)",
        [voucherIds]
      );
      await testDatabase.pool.query(
        "delete from promotion_codes where id in (select promotion_code_id from vouchers where id = any($1))",
        [voucherIds]
      );
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
        "delete from discount_code_redemptions where application_id in (select id from discount_applications where workspace_reservation_id = any($1))",
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
      await testDatabase.pool.query(
        "delete from promotion_codes where id in (select promotion_code_id from discount_codes where discount_id = any($1))",
        [discountIds]
      );
      await testDatabase.pool.query(
        "delete from discounts where id = any($1)",
        [discountIds]
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
        delivery: { email: testEmailAddress("synthetic") },
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

    /** Inserts a synthetic enabled, unrestricted discount code for the products. */
    const insertDiscountCode = async (
      products: readonly [WorkspaceProductTarget, ...WorkspaceProductTarget[]]
    ) => {
      const storedDiscountId = storedDiscountIdSchema.make(crypto.randomUUID());
      const codeId = discountCodeIdSchema.make(crypto.randomUUID());
      const promotionCodeId = promotionCodeIdSchema.make(codeId);
      const code = canonicalPromotionCodeSchema.make(
        `TIER-${codeId.slice(0, 8).toUpperCase()}`
      );
      discountIds.push(storedDiscountId);
      await Effect.runPromise(
        testDatabase.db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.insert(discounts).values({
              id: storedDiscountId,
              labels: { "cs-CZ": "Tarifní sleva", "en-US": "Tier discount" },
              percentageBasisPoints: 1000,
            });
            yield* tx.insert(discountProductTargets).values(
              products.map((productTarget) => ({
                discountId: storedDiscountId,
                productTarget,
              }))
            );
            yield* tx.insert(promotionCodes).values({
              id: promotionCodeId,
              kind: "discount",
              code,
              enabled: true,
            });
            yield* tx.insert(discountCodes).values({
              id: codeId,
              code,
              enabled: true,
              promotionCodeId,
              discountId: storedDiscountId,
            });
          })
        )
      );
      return { codeId, storedDiscountId };
    };

    const claimTierDiscountCode = async (input: {
      readonly products: readonly [
        WorkspaceProductTarget,
        ...WorkspaceProductTarget[],
      ];
      readonly product: {
        readonly kind: "cowork";
        readonly tier: "open-space" | "reserved-desk";
      };
    }) => {
      const reservation = await insertHeldReservation();
      const { codeId, storedDiscountId } = await insertDiscountCode(
        input.products
      );
      const snapshot = makeSnapshot(reservation);
      const discount = {
        id: Schema.decodeUnknownSync(discountIdSchema)(`code-${codeId}`),
        label: "Tier discount",
        adjustment: { kind: "percentage" as const, basisPoints: 1000 },
      };
      const subtotalBefore = snapshot.quote.payment.expectedPrice;
      const amount = { ...subtotalBefore, value: subtotalBefore.value / 10 };

      return createPendingNexiAttempt({
        ...reservation,
        snapshot,
        commitment: makeDiscountCommitment({
          product: input.product,
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
                claim: {
                  kind: "discount_code",
                  codeId,
                  storedDiscountId,
                  dotyposCustomerId: reservation.dotyposCustomerId,
                  product: input.product,
                },
              },
            },
          ],
        }),
      });
    };

    test("claims a discount code through a broad or matching cowork tier target", async () => {
      const broad = await claimTierDiscountCode({
        products: [{ kind: "cowork" }],
        product: { kind: "cowork", tier: "open-space" },
      });
      const tier = await claimTierDiscountCode({
        products: [{ kind: "cowork", tier: "reserved-desk" }],
        product: { kind: "cowork", tier: "reserved-desk" },
      });

      expect(broad._tag).toBe("Success");
      expect(tier._tag).toBe("Success");
    });

    test("refuses a discount code claim for a cowork tier its targets omit", async () => {
      const result = await claimTierDiscountCode({
        products: [{ kind: "cowork", tier: "reserved-desk" }],
        product: { kind: "cowork", tier: "open-space" },
      });

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "DiscountClaimError", reason: "product_ineligible" },
      });
    });

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

    /**
     * Seeds a voucher whose earlier claim by the customer, on another
     * checkout, has been released.
     */
    const seedReleasedVoucherClaim = async (customerId: string) => {
      const id = crypto.randomUUID();
      const voucherId = voucherIdSchema.make(`lifecycle-voucher-${id}`);
      const reservationId = `lifecycle-released-claim-${id}`;
      voucherIds.push(voucherId);
      reservationIds.push(workspaceReservationIdSchema.make(reservationId));
      await testDatabase.pool.query(
        `insert into workspace_reservations (id, checkout_attempt_key, dotypos_customer_id, dotypos_reservation_id, reservation_state, payment_state, fulfillment_state, reservation_details, locale)
         values ($1, $1, $2, $1, 'cancelled', 'expired', 'not_started', '{"kind":"cowork","entryTier":"open-space","coffee":false}', 'en-US')`,
        [reservationId, customerId]
      );
      await testDatabase.pool.query(
        `insert into payment_attempts (id, workspace_reservation_id, provider, provider_order_id, state, failure_code, refund_state, amount_value, amount_exponent, currency)
         values ($1, $1, 'nexi', $1, 'expired', 'payment_abandoned_after_provider_cutoff', 'not_required', 29000, 2, 'CZK')`,
        [reservationId]
      );
      await testDatabase.pool.query(
        `insert into discount_applications (id, payment_attempt_id, workspace_reservation_id, sequence, public_discount_id, label, adjustment, product_identity, subtotal_before_value, subtotal_before_exponent, subtotal_before_currency, applied_amount_value, applied_amount_exponent, applied_amount_currency, subtotal_after_value, subtotal_after_exponent, subtotal_after_currency, provenance)
         values ($1, $1, $1, 0, 'synthetic-discount', 'Synthetic', '{}', '{}', 29000, 2, 'CZK', 1000, 2, 'CZK', 28000, 2, 'CZK', '{}')`,
        [reservationId]
      );
      await testDatabase.pool.query(
        `insert into promotion_codes (id, kind, code, enabled)
         values ($1, 'voucher', $2, true)`,
        [voucherId, `SYNTHETIC_${id.replaceAll("-", "_").toUpperCase()}`]
      );
      await testDatabase.pool.query(
        `insert into vouchers (id, promotion_code_id, issued_amount_value, issued_amount_exponent, issued_amount_currency)
         values ($1, $1, 1000, 2, 'CZK')`,
        [voucherId]
      );
      await testDatabase.pool.query(
        `insert into voucher_redemptions (id, voucher_id, application_id, payment_attempt_id, dotypos_customer_id, state, reservation_expires_at, released_at, release_reason)
         values ($1, $1, $2, $2, $3, 'released', now() + interval '1 hour', now(), 'expired')`,
        [voucherId, reservationId, customerId]
      );
      return voucherId;
    };

    test("reports an active voucher claim that wins the race as a claim conflict", async () => {
      const reservation = await insertHeldReservation();
      const voucherId = await seedReleasedVoucherClaim(
        reservation.dotyposCustomerId
      );
      const snapshot = makeSnapshot(reservation);
      const subtotalBefore = snapshot.quote.payment.expectedPrice;
      const voucherCredit = { ...subtotalBefore, value: 1000 };
      const provenance = {
        providerNamespace: "database-voucher",
        providerReference: voucherId,
      };
      const discount = {
        id: deriveOpaqueDiscountId(provenance),
        label: m.checkoutVoucherLabel({}, { locale: "en-US" }),
        adjustment: { kind: "fixed" as const, amount: voucherCredit },
      };

      // Another checkout re-activates the customer's claim but has not
      // committed, so this attempt's claim checks still see it released and
      // only the active-claim unique index stops the second claim.
      const competingCheckout = await testDatabase.pool.connect();
      try {
        await competingCheckout.query("begin");
        await competingCheckout.query(
          "update voucher_redemptions set state = 'reserved', released_at = null, release_reason = null where voucher_id = $1",
          [voucherId]
        );

        const attempt = createPendingNexiAttempt({
          ...reservation,
          snapshot,
          commitment: makeDiscountCommitment({
            product: { kind: "cowork", tier: "basic" },
            applications: [
              {
                application: {
                  discount,
                  subtotalBefore,
                  amount: voucherCredit,
                  subtotalAfter: {
                    ...subtotalBefore,
                    value: subtotalBefore.value - voucherCredit.value,
                  },
                },
                candidate: {
                  discount,
                  provenance,
                  claim: {
                    kind: "voucher",
                    voucherId,
                    availableAmount: voucherCredit,
                    dotyposCustomerId: reservation.dotyposCustomerId,
                  },
                },
              },
            ],
          }),
        });
        await waitForPostgresLockWaiter(testDatabase.pool, {
          condition: "locktype = 'transactionid'",
          description: "the second voucher claim waiting on the first",
        });
        await competingCheckout.query("commit");

        expect(await attempt).toMatchObject({
          _tag: "Failure",
          failure: {
            _tag: "DiscountClaimError",
            operation: "reserve",
            reason: "claim_conflict",
          },
        });
      } finally {
        await competingCheckout.query("rollback").catch(() => {});
        competingCheckout.release();
      }

      const rows = await readRows(reservation.reservationId);
      expect(rows.attempts).toEqual([]);
      expect(rows.snapshots).toEqual([]);
      expect(rows.applications).toEqual([]);
      expect(rows.reservation?.activePaymentAttemptId).toBeNull();
      expect(rows.reservation?.paymentState).toBe("not_started");
    });
  }
);
