import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import {
  AlgoPinSchema,
  IgloohomeDeviceIdSchema,
  IgloohomePinIdSchema,
  IgloohomeService,
} from "@deskohub/igloohome";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { NodeCrypto } from "@effect/platform-node";
import { and, asc, eq } from "drizzle-orm";
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  customerEvents,
  paymentAttempts,
  reservationAccessGrants,
  workspaceReservations,
} from "@/db/schema";
import {
  checkoutAttemptKeySchema,
  checkoutSessionKeySchema,
  type PaymentAttemptId,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { ReservationAccessService } from "@/features/reservation-access";
import { ReservationAccessRepository } from "@/features/reservation-access/backend/reservation-access.repository";
import { recordCustomerEvent } from "@/shared/backend/customer-events/customer-event-outbox";
import { rejectCustomerEventInserts } from "@/shared/backend/customer-events/customer-event-outbox.test-utils";
import { retractCancellationEvent } from "@/shared/backend/customer-events/customer-event-retraction";
import { ReadLimitExceededError } from "@/shared/backend/read-limit";
import {
  fixtureReservationAuthorId,
  type ReservationFixtureInput,
  type ReservationFixtureStage,
  workspaceFixtures,
} from "@/shared/testing/workspace-fixtures.test-utils";
import { waitForPostgresLockWaiter } from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationSessionTakenError,
  WorkspaceReservationStateError,
} from "./workspace-reservation.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

// Fixture times sit decades in the past so the repository's table-wide
// expired-hold selects only reach rows this file inserted.
const at = (minutes: number) =>
  Temporal.Instant.from("1990-01-01T12:00:00Z").add({ minutes });

describe.skipIf(!testDatabase)(
  "WorkspaceReservationRepository state guards on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const reservationIds: WorkspaceReservationId[] = [];

    afterAll(async () => {
      for (const table of [
        "late_payment_recoveries",
        "reservation_access_grants",
        "payment_attempts",
      ]) {
        await testDatabase.pool.query(
          `delete from ${table} where workspace_reservation_id = any($1)`,
          [reservationIds]
        );
      }
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
    });

    const run = <A, E>(
      operation: (
        repository: typeof WorkspaceReservationRepository.Service
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* operation(yield* WorkspaceReservationRepository);
        }).pipe(
          Effect.provide(WorkspaceReservationRepository.Default),
          Effect.provide(testDatabase.layer)
        )
      );

    const runFailure = <A, E>(
      operation: (
        repository: typeof WorkspaceReservationRepository.Service
      ) => Effect.Effect<A, E>
    ) => run((repository) => Effect.flip(operation(repository)));

    /**
     * Inserts a synthetic reservation, held and unpaid unless the stage says
     * otherwise, whose events happened at `at(0)`. Whatever its stage, its
     * hold expires at `at(0)` unless the overrides say otherwise.
     */
    const insertReservation = async (
      stage: Partial<ReservationFixtureStage> = {},
      overrides: ReservationFixtureInput["overrides"] = {}
    ) => {
      const { id } = await Effect.runPromise(
        workspaceFixtures(testDatabase.db).reservation({
          stage: { reservation: "held", ...stage },
          at: at(0),
          overrides: { reservationHoldExpiresAt: at(0), ...overrides },
        })
      );
      reservationIds.push(id);
      return id;
    };

    /** Inserts a payment attempt and makes it the reservation's active one. */
    const insertActivePaymentAttempt = async (
      reservationId: WorkspaceReservationId,
      values: Partial<typeof paymentAttempts.$inferInsert> = {}
    ) => {
      const key = crypto.randomUUID();
      const id = paymentAttemptIdSchema.make(`attempt-${key}`);
      await Effect.runPromise(
        testDatabase.db.insert(paymentAttempts).values({
          id,
          workspaceReservationId: reservationId,
          provider: "nexi",
          providerOrderId: NexiOrderIdSchema.make(`order-${key}`),
          state: "paid",
          amountValue: 29_000,
          amountExponent: 2,
          currency: "CZK",
          ...values,
        })
      );
      await Effect.runPromise(
        testDatabase.db
          .update(workspaceReservations)
          .set({ activePaymentAttemptId: id })
          .where(eq(workspaceReservations.id, reservationId))
      );
      return id;
    };

    const readReservation = async (id: WorkspaceReservationId) => {
      const [reservation] = await Effect.runPromise(
        testDatabase.db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, id))
      );
      return reservation;
    };

    const readPaymentAttempt = async (id: PaymentAttemptId) => {
      const [attempt] = await Effect.runPromise(
        testDatabase.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, id))
      );
      return attempt;
    };

    describe("payment return target", () => {
      test("stores the last submission's app, clears it, and leaves updatedAt alone", async () => {
        const id = await insertReservation();
        const before = await readReservation(id);

        expect(
          await run((repository) => repository.findPaymentReturnTarget(id))
        ).toBeUndefined();

        for (const paymentReturnTarget of ["native-app", "web-app"] as const) {
          await run((repository) =>
            repository.recordPaymentReturnTarget({ id, paymentReturnTarget })
          );
          expect(
            await run((repository) => repository.findPaymentReturnTarget(id))
          ).toBe(paymentReturnTarget);
        }

        await run((repository) =>
          repository.recordPaymentReturnTarget({
            id,
            paymentReturnTarget: undefined,
          })
        );
        const after = await readReservation(id);
        expect(after?.paymentReturnTarget).toBeNull();
        expect(after?.updatedAt).toEqual(before?.updatedAt);
      });

      test("finds no target for an unknown reservation", async () => {
        expect(
          await run((repository) =>
            repository.findPaymentReturnTarget(
              "missing-reservation" as WorkspaceReservationId
            )
          )
        ).toBeUndefined();
      });

      test("refuses a stored target outside the allowlist", async () => {
        const id = await insertReservation();

        await expect(
          testDatabase.pool.query(
            "update workspace_reservations set payment_return_target = $2 where id = $1",
            [id, "https://elsewhere.test"]
          )
        ).rejects.toThrow("workspace_reservations_payment_return_target_check");
      });
    });

    describe("expired holds", () => {
      test("selects unpaid expired holds and queues holds with skipped cleanup behind fresh ones", async () => {
        const skippedCleanup = await insertReservation(
          { payment: "failed" },
          { reservationHoldExpiredAt: at(120) }
        );
        const freshlyExpired = await insertReservation(
          {},
          { reservationHoldExpiresAt: at(60) }
        );
        const fixtureIds = new Set([
          skippedCleanup,
          freshlyExpired,
          await insertReservation({ payment: "paid" }),
          await insertReservation({}, { reservationHoldExpiresAt: at(240) }),
          await insertReservation({ reservation: "hold_expired" }),
        ]);

        const holds = await run((repository) =>
          repository.selectExpiredHolds({ now: at(180), limit: 1000 })
        );
        const limited = await run((repository) =>
          repository.selectExpiredHolds({ now: at(180), limit: 1 })
        );

        expect(
          holds.map(({ id }) => id).filter((id) => fixtureIds.has(id))
        ).toEqual([freshlyExpired, skippedCleanup]);
        expect(limited).toHaveLength(1);
      });

      test("lists the Dotypos holds of expired unpaid reservations without a live payment", async () => {
        const expectedIds = [];
        for (const paymentState of [
          "not_started",
          "failed",
          "cancelled",
          "expired",
        ] as const) {
          const id = await insertReservation({ payment: paymentState });
          expectedIds.push((await readReservation(id))?.dotyposReservationId);
        }
        const excludedIds = [];
        for (const [stage, overrides] of [
          [{ payment: "pending" }, {}],
          [{ payment: "paid" }, {}],
          [{}, { reservationHoldExpiresAt: at(240) }],
          [{ reservation: "confirmed" }, {}],
        ] as const) {
          const id = await insertReservation(stage, overrides);
          excludedIds.push((await readReservation(id))?.dotyposReservationId);
        }

        const ids = await run((repository) =>
          repository.selectExpiredHoldDotyposReservationIds({ now: at(180) })
        );

        expect(ids).toEqual(expect.arrayContaining(expectedIds));
        for (const excludedId of excludedIds) {
          expect(ids).not.toContain(excludedId);
        }
      });

      test("records a skipped cleanup on an unpaid expired hold without changing its state", async () => {
        const id = await insertReservation();

        await run((repository) =>
          repository.recordHoldCleanupSkipped({
            id,
            holdExpiredAt: at(30),
            failureCode: "provider_unavailable",
          })
        );

        const stored = await readReservation(id);
        expect(stored?.reservationState).toBe("held");
        expect(stored?.reservationHoldExpiredAt).toEqual(at(30));
        expect(stored?.failureCode).toBe("provider_unavailable");
      });

      test.each([
        ["a paid hold", { payment: "paid" }, {}],
        [
          "a hold that has not expired",
          {},
          { reservationHoldExpiresAt: at(60) },
        ],
        [
          "a reservation that is no longer held",
          { reservation: "confirmed" },
          {},
        ],
      ] as const)(
        "refuses to record a skipped cleanup on %s",
        async (_label, stage, overrides) => {
          const id = await insertReservation(stage, overrides);

          const error = await runFailure((repository) =>
            repository.recordHoldCleanupSkipped({
              id,
              holdExpiredAt: at(30),
              failureCode: "provider_unavailable",
            })
          );

          expect(error).toBeInstanceOf(WorkspaceReservationStateError);
          const stored = await readReservation(id);
          expect(stored?.reservationHoldExpiredAt).toBeNull();
          expect(stored?.failureCode).toBeNull();
        }
      );
    });

    describe("draft creation", () => {
      test("dies when the insert conflicts with a row neither lookup finds", async () => {
        const conflictingId = await insertReservation({
          reservation: "cancelled",
        });
        const conflicting = await readReservation(conflictingId);
        const sessionKey = checkoutSessionKeySchema.make(
          `session-${crypto.randomUUID()}`
        );

        const exit = await run((repository) =>
          repository
            .createDraft({
              checkoutSessionKey: sessionKey,
              checkoutAttemptKey: checkoutAttemptKeySchema.make(
                conflicting?.checkoutAttemptKey ?? "missing-attempt"
              ),
              checkoutSessionLockKey: 4_242_424_242n,
              acceptedCheckoutSessionKeys: [sessionKey],
              acceptedCheckoutAttemptKeys: [
                checkoutAttemptKeySchema.make(`attempt-${crypto.randomUUID()}`),
              ],
              dotyposCustomerId: DotyposCustomerIdSchema.make("customer-id"),
              authorAccountId: fixtureReservationAuthorId,
              reservationPurpose: "personal",
              reservationDetails: {
                kind: "cowork",
                entryTier: "basic",
                coffee: false,
              },
              locale: "en-US",
            })
            .pipe(Effect.exit)
        );

        expect(Exit.isFailure(exit)).toBe(true);
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(
          "Workspace reservation insert returned no row."
        );
        const [sessionRow] = await Effect.runPromise(
          testDatabase.db
            .select({ id: workspaceReservations.id })
            .from(workspaceReservations)
            .where(eq(workspaceReservations.checkoutSessionKey, sessionKey))
        );
        expect(sessionRow).toBeUndefined();
      });
    });

    describe("hold cancellation claims", () => {
      const holdExpiresAt = at(-5);

      const expiredHold = (
        stage: Partial<ReservationFixtureStage> = {},
        overrides: ReservationFixtureInput["overrides"] = {}
      ) =>
        insertReservation(stage, {
          reservationHoldExpiresAt: holdExpiresAt,
          ...overrides,
        });

      const expectedHoldOf = async (id: WorkspaceReservationId) => {
        const row = (await readReservation(id))!;
        return {
          dotyposReservationId: row.dotyposReservationId!,
          reservationHoldExpiresAt: row.reservationHoldExpiresAt!,
        };
      };

      test("claims a hold that still carries the expected hold, stamping the claim", async () => {
        const id = await expiredHold();
        const before = (await readReservation(id))!;
        const expectedHold = await expectedHoldOf(id);

        const claimed = await run((repository) =>
          repository.claimCancellation({
            id,
            expectedHold,
            cause: "hold_expired",
          })
        );

        expect(claimed?.reservationState).toBe("cancelling");
        const after = (await readReservation(id))!;
        expect(after.reservationState).toBe("cancelling");
        expect(claimed?.updatedAt.equals(after.updatedAt)).toBe(true);
        expect(after.updatedAt.equals(before.updatedAt)).toBe(false);
      });

      test.each([
        [
          "another Dotypos hold",
          { dotyposReservationId: DotyposReservationIdSchema.make("other") },
        ],
        ["another deadline", { reservationHoldExpiresAt: at(20) }],
      ] as const)(
        "does not claim a hold replaced by %s",
        async (_label, replaced) => {
          const id = await expiredHold();
          const expectedHold = await expectedHoldOf(id);
          await Effect.runPromise(
            testDatabase.db
              .update(workspaceReservations)
              .set(replaced)
              .where(eq(workspaceReservations.id, id))
          );

          expect(
            await run((repository) =>
              repository.claimCancellation({
                id,
                expectedHold,
                cause: "hold_expired",
              })
            )
          ).toBeNull();
          expect((await readReservation(id))?.reservationState).toBe("held");
        }
      );

      test("takes over only a stale claim, restamping it", async () => {
        const fresh = await expiredHold(
          { reservation: "cancelling" },
          {
            updatedAt: Temporal.Now.instant(),
          }
        );
        const stale = await expiredHold(
          { reservation: "cancelling" },
          {
            updatedAt: Temporal.Now.instant().subtract({ hours: 1 }),
          }
        );
        const staleBefore = Temporal.Now.instant().subtract({ minutes: 10 });
        const expectedHold = await expectedHoldOf(stale);

        const freshTakeover = await run((repository) =>
          repository.takeOverStaleCancellation({ id: fresh, staleBefore })
        );
        const staleTakeover = await run((repository) =>
          repository.takeOverStaleCancellation({
            id: stale,
            staleBefore,
            expectedHold,
          })
        );

        expect(freshTakeover).toBeNull();
        expect(staleTakeover?.reservationState).toBe("cancelling");
        expect(
          Temporal.Instant.compare(staleTakeover!.updatedAt, staleBefore)
        ).toBe(1);
      });

      test("does not take over a stale claim on a replaced hold", async () => {
        const id = await expiredHold(
          { reservation: "cancelling" },
          {
            updatedAt: Temporal.Now.instant().subtract({ hours: 1 }),
          }
        );
        const expectedHold = await expectedHoldOf(id);
        await Effect.runPromise(
          testDatabase.db
            .update(workspaceReservations)
            .set({ reservationHoldExpiresAt: at(20) })
            .where(eq(workspaceReservations.id, id))
        );

        expect(
          await run((repository) =>
            repository.takeOverStaleCancellation({
              id,
              staleBefore: Temporal.Now.instant().subtract({ minutes: 10 }),
              expectedHold,
            })
          )
        ).toBeNull();
      });

      test("records the cause when a claim starts the cancellation, and keeps it when a later claim retries it", async () => {
        const fresh = await expiredHold({
          reservation: "held",
          payment: "failed",
        });
        const operatorFailed = await expiredHold(
          { reservation: "cancellation_failed", payment: "failed" },
          { cancellationCause: "operator" }
        );
        const unknownFailed = await expiredHold({
          reservation: "cancellation_failed",
          payment: "failed",
        });

        const claims = await Promise.all(
          [fresh, operatorFailed, unknownFailed].map((id) =>
            run((repository) =>
              repository.claimCancellation({ id, cause: "payment_retry" })
            )
          )
        );

        expect(claims.map((claim) => claim?.cancellationCause)).toEqual([
          "payment_retry",
          "operator",
          null,
        ]);
      });

      test("a payment retry claims only the hold of a payment that ended", async () => {
        const pending = await expiredHold({
          reservation: "held",
          payment: "pending",
        });
        const ended = await expiredHold({
          reservation: "held",
          payment: "cancelled",
        });

        const claims = await Promise.all(
          [pending, ended].map((id) =>
            run((repository) =>
              repository.claimCancellation({ id, cause: "payment_retry" })
            )
          )
        );

        expect(claims.map((claim) => claim?.reservationState ?? null)).toEqual([
          null,
          "cancelling",
        ]);
        expect((await readReservation(pending))?.reservationState).toBe("held");
      });

      test("records an outcome only under the current claim's stamp", async () => {
        const cancelled = await expiredHold();
        const failed = await expiredHold();
        const claims = await Promise.all(
          [cancelled, failed].map((id) =>
            run((repository) =>
              repository.claimCancellation({ id, cause: "hold_expired" })
            )
          )
        );
        const [cancelledClaim, failedClaim] = claims.map(
          (claim) => claim!.updatedAt
        );
        const previousStamp = at(-60);

        const staleCancel = await runFailure((repository) =>
          repository.markCancelled({
            id: cancelled,
            claimedAt: previousStamp,
            cancelledAt: at(1),
          })
        );
        const staleFailure = await runFailure((repository) =>
          repository.markCancellationFailed({
            id: failed,
            claimedAt: previousStamp,
            failureCode: "dotypos_cancel_failed",
          })
        );
        expect(staleCancel).toMatchObject({
          _tag: "WorkspaceReservationStateError",
        });
        expect(staleFailure).toMatchObject({
          _tag: "WorkspaceReservationStateError",
        });
        expect((await readReservation(cancelled))?.reservationState).toBe(
          "cancelling"
        );
        expect((await readReservation(failed))?.reservationState).toBe(
          "cancelling"
        );

        await run((repository) =>
          repository.markCancelled({
            id: cancelled,
            claimedAt: cancelledClaim!,
            cancelledAt: at(1),
          })
        );
        await run((repository) =>
          repository.markCancellationFailed({
            id: failed,
            claimedAt: failedClaim!,
            failureCode: "dotypos_cancel_failed",
          })
        );
        expect((await readReservation(cancelled))?.reservationState).toBe(
          "cancelled"
        );
        expect((await readReservation(failed))?.reservationState).toBe(
          "cancellation_failed"
        );
      });
    });

    describe("administration cancellation", () => {
      const confirmedPaid = {
        reservation: "confirmed",
        payment: "paid",
        fulfillment: "fulfilled",
      } as const;

      const claimCancellation = (
        id: WorkspaceReservationId,
        input: Partial<
          Parameters<
            typeof WorkspaceReservationRepository.Service.claimRequestedCancellation
          >[0]
        > = {}
      ) =>
        run((repository) =>
          repository.claimRequestedCancellation({
            id,
            cause: "operator",
            staleCancellingBefore: at(10),
            ...input,
          })
        );

      test("records an administrator's cause on a new cancellation and keeps the cause of one it resumes", async () => {
        const booked = await insertReservation(confirmedPaid);
        const expiryFailed = await insertReservation(
          { reservation: "cancellation_failed" },
          { cancellationCause: "hold_expired" }
        );
        const unknownFailed = await insertReservation({
          reservation: "cancellation_failed",
        });

        for (const id of [booked, expiryFailed, unknownFailed]) {
          await claimCancellation(id);
        }

        const causes = await Promise.all(
          [booked, expiryFailed, unknownFailed].map(
            async (id) => (await readReservation(id))?.cancellationCause
          )
        );
        expect(causes).toEqual(["operator", "hold_expired", null]);
      });

      test("claims a confirmed paid booking for cancellation", async () => {
        const id = await insertReservation(confirmedPaid);

        expect((await claimCancellation(id))?.id).toBe(id);
        expect((await readReservation(id))?.reservationState).toBe(
          "cancelling"
        );
      });

      test.each<readonly [string, Partial<ReservationFixtureStage>]>([
        ["payment is pending", { payment: "pending" }],
        [
          "fulfillment is processing",
          { payment: "paid", fulfillment: "processing" },
        ],
        [
          "fulfillment awaits customer delivery",
          { payment: "paid", fulfillment: "awaiting_delivery" },
        ],
        ["the booking is already cancelled", { reservation: "cancelled" }],
      ])("does not claim a cancellation while %s", async (_label, stage) => {
        const id = await insertReservation(stage);

        expect(await claimCancellation(id)).toBeNull();
        expect((await readReservation(id))?.reservationState).toBe(
          stage.reservation ?? "held"
        );
      });

      test("cancels the active pending payment attempt inside a forced payment cancellation", async () => {
        const id = await insertReservation({ payment: "pending" });
        const paymentAttemptId = await insertActivePaymentAttempt(id, {
          state: "pending",
        });
        const otherAttemptReservation = await insertReservation({
          payment: "pending",
        });
        await insertActivePaymentAttempt(otherAttemptReservation, {
          state: "pending",
        });
        const pendingPaymentCancellation = {
          paymentAttemptId,
          failureCode: "provider_abandoned",
        };

        const claimed = await claimCancellation(id, {
          pendingPaymentCancellation,
        });
        const otherAttemptClaim = await claimCancellation(
          otherAttemptReservation,
          { pendingPaymentCancellation }
        );

        expect(claimed?.id).toBe(id);
        expect(await readReservation(id)).toMatchObject({
          reservationState: "cancelling",
          paymentState: "cancelled",
          failureCode: "provider_abandoned",
        });
        expect(await readPaymentAttempt(paymentAttemptId)).toMatchObject({
          state: "cancelled",
          failureCode: "provider_abandoned",
        });
        expect(otherAttemptClaim).toBeNull();
        expect(
          (await readReservation(otherAttemptReservation))?.paymentState
        ).toBe("pending");
      });

      test("fails and keeps the payment pending when its attempt can no longer be cancelled", async () => {
        const id = await insertReservation({ payment: "pending" });
        const paymentAttemptId = await insertActivePaymentAttempt(id, {
          state: "failed",
          failureCode: "provider_declined",
        });

        const error = await runFailure((repository) =>
          repository.claimRequestedCancellation({
            id,
            cause: "operator",
            staleCancellingBefore: at(10),
            pendingPaymentCancellation: {
              paymentAttemptId,
              failureCode: "provider_abandoned",
            },
          })
        );

        expect(error).toBeInstanceOf(WorkspaceReservationStateError);
        expect(error).toMatchObject({
          operation: "workspaceReservations.claimRequestedCancellation",
          reservationId: id,
        });
        expect(await readReservation(id)).toMatchObject({
          reservationState: "held",
          paymentState: "pending",
        });
        expect((await readPaymentAttempt(paymentAttemptId))?.state).toBe(
          "failed"
        );
      });

      test.each([
        {
          name: "an issued",
          grant: {
            state: "issued",
            providerCredentialId: IgloohomePinIdSchema.make(
              "synthetic-credential"
            ),
            accessCode: AlgoPinSchema.make("1234567"),
            issuedAt: at(1),
          },
        },
        {
          name: "a provisioning",
          grant: {
            state: "provisioning",
            provisioningStartedAt: Temporal.Now.instant(),
          },
        },
      ] as const)(
        "expires $name access grant whose access hasn't ended when it claims the cancellation",
        async ({ grant }) => {
          const id = await insertReservation(confirmedPaid);
          await Effect.runPromise(
            testDatabase.db.insert(reservationAccessGrants).values({
              workspaceReservationId: id,
              deviceId: IgloohomeDeviceIdSchema.make("synthetic-keypad"),
              scheduledAccessStartsAt: at(0),
              accessStartsAt: at(0),
              accessEndsAt: Temporal.Instant.from("2099-01-01T00:00:00Z"),
              updatedAt: at(2),
              ...grant,
            })
          );

          expect((await claimCancellation(id))?.id).toBe(id);
          const [stored] = await Effect.runPromise(
            testDatabase.db
              .select()
              .from(reservationAccessGrants)
              .where(eq(reservationAccessGrants.workspaceReservationId, id))
          );
          expect(stored).toMatchObject({ state: "expired", accessCode: null });
        }
      );

      test("marks the claimed revision cancelled and requires a refund of its paid Nexi attempt", async () => {
        const claimedAt = at(5);
        const id = await insertReservation(
          { ...confirmedPaid, reservation: "cancelling" },
          { updatedAt: claimedAt }
        );
        const nexiAttempt = await insertActivePaymentAttempt(id);
        const internalAttempt = await insertActivePaymentAttempt(id, {
          provider: "internal",
          providerOrderId: null,
          amountValue: 0,
        });

        await run((repository) =>
          repository.completeRequestedCancellation({
            id,
            cancelledAt: at(6),
            claimedAt,
            failureCode: "operator_cancelled",
          })
        );

        expect(await readReservation(id)).toMatchObject({
          reservationState: "cancelled",
          reservationCancelledAt: at(6),
          failureCode: "operator_cancelled",
        });
        expect((await readPaymentAttempt(nexiAttempt))?.refundState).toBe(
          "required"
        );
        expect((await readPaymentAttempt(internalAttempt))?.refundState).toBe(
          "not_required"
        );
      });

      test("records the refund a customer's withdrawal owes on its paid Nexi attempt", async () => {
        for (const refund of [
          { targetValue: 1, releasesPromotions: false },
          { targetValue: 2, releasesPromotions: true },
        ]) {
          const claimedAt = at(5);
          const id = await insertReservation(
            { ...confirmedPaid, reservation: "cancelling" },
            { updatedAt: claimedAt }
          );
          const nexiAttempt = await insertActivePaymentAttempt(id);

          await run((repository) =>
            repository.completeRequestedCancellation({
              id,
              cancelledAt: at(6),
              claimedAt,
              failureCode: null,
              refund,
            })
          );

          expect(await readReservation(id)).toMatchObject({
            reservationState: "cancelled",
          });
          expect(await readPaymentAttempt(nexiAttempt)).toMatchObject({
            refundState: "required",
            refundTargetValue: refund.targetValue,
          });
        }
      });

      test("keeps a refund learned before withdrawal and marks the remainder due", async () => {
        const claimedAt = at(5);
        const id = await insertReservation(
          { ...confirmedPaid, reservation: "cancelling" },
          { updatedAt: claimedAt, cancellationCause: "customer_withdrawal" }
        );
        const attempt = await insertActivePaymentAttempt(id, {
          refundState: "refunded",
          refundedAmountValue: 1_000,
          refundedAt: at(4),
        });

        await run((repository) =>
          repository.completeRequestedCancellation({
            id,
            cancelledAt: at(6),
            claimedAt,
            failureCode: null,
            refund: { targetValue: 2_000, releasesPromotions: false },
          })
        );

        expect(await readPaymentAttempt(attempt)).toMatchObject({
          refundState: "required",
          refundedAmountValue: 1_000,
          refundedAt: at(4),
          refundTargetValue: 2_000,
        });
      });

      test("records a cancellation failure on the claimed revision only", async () => {
        const claimedAt = at(5);
        const claimedRevision = await insertReservation(
          { ...confirmedPaid, reservation: "cancelling" },
          { updatedAt: claimedAt }
        );
        const laterRevision = await insertReservation(
          { ...confirmedPaid, reservation: "cancelling" },
          { updatedAt: at(7) }
        );
        const failure = {
          claimedAt,
          failureCode: "provider_rejected_cancellation",
        };

        await run((repository) =>
          repository.markRequestedCancellationFailed({
            id: claimedRevision,
            ...failure,
          })
        );
        const error = await runFailure((repository) =>
          repository.markRequestedCancellationFailed({
            id: laterRevision,
            ...failure,
          })
        );

        expect(await readReservation(claimedRevision)).toMatchObject({
          reservationState: "cancellation_failed",
          failureCode: "provider_rejected_cancellation",
        });
        expect(error).toBeInstanceOf(WorkspaceReservationStateError);
        expect((await readReservation(laterRevision))?.reservationState).toBe(
          "cancelling"
        );
      });

      test("refuses to mark a stale claim cancelled", async () => {
        const id = await insertReservation(
          { ...confirmedPaid, reservation: "cancelling" },
          { updatedAt: at(7) }
        );
        const attempt = await insertActivePaymentAttempt(id);

        const error = await runFailure((repository) =>
          repository.completeRequestedCancellation({
            id,
            cancelledAt: at(8),
            claimedAt: at(5),
            failureCode: "operator_cancelled",
          })
        );

        expect(error).toBeInstanceOf(WorkspaceReservationStateError);
        expect((await readReservation(id))?.reservationState).toBe(
          "cancelling"
        );
        expect((await readPaymentAttempt(attempt))?.refundState).toBe(
          "not_required"
        );
      });
    });

    describe("administration restore", () => {
      const cancelledAt = at(6);
      const restoredAt = at(30);

      /** A paid, confirmed booking an administrator cancelled cleanly. */
      const insertRestorable = (
        overrides: ReservationFixtureInput["overrides"] = {}
      ) =>
        insertReservation(
          {
            reservation: "cancelled",
            payment: "paid",
            fulfillment: "fulfilled",
          },
          {
            reservationConfirmedAt: at(1),
            reservationCancelledAt: cancelledAt,
            cancellationEmailSentAt: at(7),
            ...overrides,
          }
        );

      const restore = (
        id: WorkspaceReservationId,
        input: { readonly cancelledAt?: Temporal.Instant } = {}
      ) =>
        run((repository) =>
          Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
            transaction(
              repository.markAdministrationRestored({
                id,
                cancelledAt: input.cancelledAt ?? cancelledAt,
                restoredAt,
              })
            )
          )
        );

      /** Cancels a claimed reservation the way an administrator does. */
      const cancel = async (
        overrides: ReservationFixtureInput["overrides"] = {}
      ) => {
        const claimedAt = at(5);
        const id = await insertReservation(
          { reservation: "cancelling", payment: "paid" },
          { updatedAt: claimedAt, ...overrides }
        );
        await run((repository) =>
          repository.markAdministrationCancelled({
            id,
            cancelledAt,
            claimedAt,
            failureCode: null,
          })
        );
        return id;
      };

      test("confirms the cancellation it read again, keeping confirmation, fulfillment and recorded refunds", async () => {
        const id = await insertRestorable();
        const awaitingRefund = await insertActivePaymentAttempt(id, {
          refundState: "required",
        });
        const refunded = await insertActivePaymentAttempt(id, {
          refundState: "refunded",
          refundedAmountValue: 10_000,
          refundedAt: at(8),
        });
        const internal = await insertActivePaymentAttempt(id, {
          provider: "internal",
          providerOrderId: null,
          amountValue: 0,
        });

        const restored = await restore(id);

        const expected = {
          reservationState: "confirmed",
          reservationCancelledAt: null,
          cancellationEmailSentAt: null,
          reservationConfirmedAt: at(1),
          fulfillmentState: "fulfilled",
          fulfilledAt: at(0),
          paymentState: "paid",
          updatedAt: restoredAt,
        };
        expect(restored?.reservation).toMatchObject({ id, ...expected });
        expect(await readReservation(id)).toMatchObject(expected);
        expect(await readPaymentAttempt(awaitingRefund)).toMatchObject({
          refundState: "not_required",
          refundedAmountValue: null,
          refundedAt: null,
          updatedAt: restoredAt,
        });
        expect(await readPaymentAttempt(refunded)).toMatchObject({
          refundState: "refunded",
          refundedAmountValue: 10_000,
          refundedAt: at(8),
        });
        expect((await readPaymentAttempt(internal))?.refundState).toBe(
          "not_required"
        );
        expect(restored?.paymentAttempts).toHaveLength(3);
        expect(restored?.paymentAttempts).toContainEqual({
          amountExponent: 2,
          amountValue: 29_000,
          currency: "CZK",
          refundState: "refunded",
          refundedAmountValue: 10_000,
          state: "paid",
        });
        expect(
          restored?.paymentAttempts.filter(
            ({ refundState }) => refundState === "required"
          )
        ).toEqual([]);
      });

      test.each<{
        readonly label: string;
        readonly overrides?: ReservationFixtureInput["overrides"];
        readonly readCancelledAt?: Temporal.Instant;
      }>([
        { label: "another cancellation", readCancelledAt: at(5) },
        {
          label: "a reservation no longer cancelled",
          overrides: { reservationState: "confirmed" },
        },
        {
          label: "an unpaid reservation",
          overrides: { paymentState: "cancelled", paidAt: null },
        },
        {
          label: "a reservation never confirmed",
          overrides: { reservationConfirmedAt: null },
        },
        {
          label: "an expired hold",
          overrides: { reservationHoldExpiredAt: at(2) },
        },
        {
          label: "an unfinished cancellation",
          overrides: { failureCode: "admin_dotypos_cancel_failed" },
        },
        {
          label: "a reservation Dotypos doesn't know",
          overrides: { dotyposReservationId: "  " },
        },
      ])("leaves $label as it is", async ({ overrides, readCancelledAt }) => {
        const id = await insertRestorable(overrides);
        const attempt = await insertActivePaymentAttempt(id, {
          refundState: "required",
        });
        const before = await readReservation(id);

        expect(
          await restore(
            id,
            readCancelledAt ? { cancelledAt: readCancelledAt } : {}
          )
        ).toBeNull();
        expect(await readReservation(id)).toEqual(before);
        expect((await readPaymentAttempt(attempt))?.refundState).toBe(
          "required"
        );
      });

      test("refuses while another reservation of its checkout session is active, writing nothing", async () => {
        const id = await insertRestorable();
        const attempt = await insertActivePaymentAttempt(id, {
          refundState: "required",
        });
        const cancelled = await readReservation(id);
        await insertReservation(
          {},
          { checkoutSessionKey: cancelled?.checkoutSessionKey }
        );

        const error = await run((repository) =>
          Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
            transaction(
              repository.markAdministrationRestored({
                id,
                cancelledAt,
                restoredAt,
              })
            )
          ).pipe(Effect.flip)
        );

        expect(error).toBeInstanceOf(WorkspaceReservationSessionTakenError);
        expect(error).toMatchObject({ reservationId: id });
        expect(await readReservation(id)).toEqual(cancelled);
        expect((await readPaymentAttempt(attempt))?.refundState).toBe(
          "required"
        );
      });

      test("lets only one of two concurrent restores finalize", async () => {
        const id = await insertRestorable();
        const input = { id, cancelledAt, restoredAt };

        const [first, second] = await run((repository) =>
          Effect.gen(function* () {
            const { transaction } = yield* WorkspaceDatabase;
            const restoredFirst = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            const firstRestore = yield* Effect.forkChild(
              transaction(
                repository.markAdministrationRestored(input).pipe(
                  Effect.tap(() => Deferred.succeed(restoredFirst, undefined)),
                  Effect.tap(() => Deferred.await(release))
                )
              )
            );
            yield* Deferred.await(restoredFirst);
            const secondRestore = yield* Effect.forkChild(
              transaction(repository.markAdministrationRestored(input))
            );
            yield* Effect.promise(() =>
              waitForPostgresLockWaiter(testDatabase.pool, {
                condition: "locktype = 'transactionid'",
                description: "the second restore waiting for the first",
              })
            );
            yield* Deferred.succeed(release, undefined);
            return [
              yield* Fiber.join(firstRestore),
              yield* Fiber.join(secondRestore),
            ] as const;
          })
        );

        expect(first?.reservation.id).toBe(id);
        expect(second).toBeNull();
        expect((await readReservation(id))?.reservationState).toBe("confirmed");
      });

      describe("cancellation email record", () => {
        const recordSent = (
          id: WorkspaceReservationId,
          readCancelledAt = cancelledAt
        ) =>
          run((repository) =>
            repository.recordCancellationEmailSent({
              id,
              cancelledAt: readCancelledAt,
              sentAt: at(9),
            })
          );

        test("stamps the cancellation it was sent for", async () => {
          const id = await insertRestorable({ cancellationEmailSentAt: null });
          const before = await readReservation(id);

          expect(await recordSent(id)).toBe(true);
          expect(await readReservation(id)).toEqual({
            ...before,
            cancellationEmailSentAt: at(9),
          });
        });

        test("leaves another cancellation, and a restored reservation, unstamped", async () => {
          const later = await insertRestorable({
            cancellationEmailSentAt: null,
          });
          const restored = await insertRestorable({
            cancellationEmailSentAt: null,
          });
          await restore(restored);

          expect(await recordSent(later, at(5))).toBe(false);
          expect(await recordSent(restored)).toBe(false);
          expect(
            (await readReservation(later))?.cancellationEmailSentAt
          ).toBeNull();
          expect(
            (await readReservation(restored))?.cancellationEmailSentAt
          ).toBeNull();
        });
      });

      describe("cancellation history", () => {
        const hasRecordedCancellation = (id: WorkspaceReservationId) =>
          run((repository) => repository.hasRecordedCancellation(id));

        test("knows a booked reservation was cancelled, also once it is restored", async () => {
          const id = await cancel({ reservationConfirmedAt: at(1) });

          expect(await hasRecordedCancellation(id)).toBe(true);
          expect((await restore(id))?.reservation.reservationState).toBe(
            "confirmed"
          );
          expect(await hasRecordedCancellation(id)).toBe(true);
        });

        test("knows of no cancellation for an unbooked cancellation or a booking", async () => {
          const unbooked = await cancel();
          const booked = await insertReservation(
            { reservation: "confirmed", payment: "paid" },
            { reservationConfirmedAt: at(1) }
          );
          await run(() =>
            Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
              transaction(
                recordCustomerEvent({
                  kind: "reservation-booked",
                  occurredAt: at(1),
                  dotyposCustomerId: DotyposCustomerIdSchema.make(
                    "synthetic-history-customer"
                  ),
                  workspaceReservationId: booked,
                })
              )
            )
          );

          expect(await hasRecordedCancellation(unbooked)).toBe(false);
          expect(await hasRecordedCancellation(booked)).toBe(false);
        });
      });

      test("records a new cancellation event, open to intake, when a restored booking is cancelled again", async () => {
        const id = await cancel({ reservationConfirmedAt: at(1) });
        const upcoming = {
          reservedFrom: Temporal.Instant.from("2099-07-01T08:00:00Z"),
          reservedUntil: Temporal.Instant.from("2099-07-01T16:00:00Z"),
        };

        // The restore's finalize: access, then the row, then its event.
        const retraction = await run((repository) =>
          Effect.gen(function* () {
            const { transaction } = yield* WorkspaceDatabase;
            const access = yield* ReservationAccessService;
            return yield* transaction(
              Effect.gen(function* () {
                expect(
                  yield* access.prepareRestoredAccess({
                    reservationId: id,
                    ...upcoming,
                    now: restoredAt,
                  })
                ).toBe("issue");
                const restored = yield* repository.markAdministrationRestored({
                  id,
                  cancelledAt,
                  restoredAt,
                });
                expect(restored?.reservation.reservationState).toBe(
                  "confirmed"
                );
                return yield* retractCancellationEvent({
                  reservationId: id,
                  cancelledAt,
                  at: restoredAt,
                });
              })
            );
          }).pipe(
            Effect.provide(
              ReservationAccessService.Default.pipe(
                Layer.provide(ReservationAccessRepository.Default),
                Layer.provide(Layer.mock(IgloohomeService, {})),
                Layer.provide(NodeCrypto.layer)
              )
            )
          )
        );
        expect(retraction).toBe("retracted");

        const claimed = await run((repository) =>
          repository.claimAdministrationCancellation({
            id,
            providerCredentialRemoved: false,
            accessGrantUpdatedAt: null,
            staleCancellingBefore: at(10),
          })
        );
        expect(claimed?.reservationState).toBe("cancelling");
        const cancelledAgainAt = at(40);
        await run((repository) =>
          repository.markAdministrationCancelled({
            id,
            cancelledAt: cancelledAgainAt,
            claimedAt: claimed!.updatedAt,
            failureCode: null,
          })
        );

        expect(await readReservation(id)).toMatchObject({
          reservationState: "cancelled",
          reservationCancelledAt: cancelledAgainAt,
        });
        const events = await Effect.runPromise(
          testDatabase.db
            .select({
              occurredAt: customerEvents.occurredAt,
              automationUnitId: customerEvents.automationUnitId,
              automationProcessedAt: customerEvents.automationProcessedAt,
            })
            .from(customerEvents)
            .where(
              and(
                eq(customerEvents.workspaceReservationId, id),
                eq(customerEvents.kind, "reservation-cancelled")
              )
            )
            .orderBy(asc(customerEvents.occurredAt))
        );
        // The undone cancellation stays as processed history; the new one
        // waits for the planner like any unprocessed, unowned event.
        expect(events).toEqual([
          {
            occurredAt: cancelledAt,
            automationUnitId: null,
            automationProcessedAt: restoredAt,
          },
          {
            occurredAt: cancelledAgainAt,
            automationUnitId: null,
            automationProcessedAt: null,
          },
        ]);
        // Cancellation leaves the restore's not yet issued grant pending.
        const [grant] = await Effect.runPromise(
          testDatabase.db
            .select({ state: reservationAccessGrants.state })
            .from(reservationAccessGrants)
            .where(eq(reservationAccessGrants.workspaceReservationId, id))
        );
        expect(grant?.state).toBe("pending");
      });
    });

    describe("customer events", () => {
      const readEvents = (id: WorkspaceReservationId) =>
        Effect.runPromise(
          testDatabase.db
            .select({
              kind: customerEvents.kind,
              occurredAt: customerEvents.occurredAt,
              dotyposCustomerId: customerEvents.dotyposCustomerId,
            })
            .from(customerEvents)
            .where(eq(customerEvents.workspaceReservationId, id))
        );

      const processingPaid = {
        payment: "paid",
        fulfillment: "processing",
      } as const;

      const confirm = (id: WorkspaceReservationId) =>
        run((repository) =>
          repository.markReservationConfirmed({ id, confirmedAt: at(3) })
        );

      test("records one booked event with the confirmation, even when retried", async () => {
        const id = await insertReservation(processingPaid);
        const customerId = (await readReservation(id))?.dotyposCustomerId;

        await confirm(id);
        const retry = await runFailure((repository) =>
          repository.markReservationConfirmed({ id, confirmedAt: at(4) })
        );
        await Effect.runPromise(
          Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
            transaction(
              recordCustomerEvent({
                kind: "reservation-booked",
                occurredAt: at(4),
                dotyposCustomerId: customerId!,
                workspaceReservationId: id,
              })
            )
          ).pipe(Effect.provide(testDatabase.layer))
        );

        expect(retry).toBeInstanceOf(WorkspaceReservationStateError);
        expect(await readEvents(id)).toEqual([
          {
            kind: "reservation-booked",
            occurredAt: at(3),
            dotyposCustomerId: customerId!,
          },
        ]);
      });

      test("rolls the confirmation back with a failed event write", async () => {
        const id = await insertReservation(processingPaid);
        const cleanup = await rejectCustomerEventInserts(
          testDatabase.pool,
          `new.workspace_reservation_id = '${id}'`
        );
        const failure = await runFailure((repository) =>
          repository.markReservationConfirmed({ id, confirmedAt: at(3) })
        ).finally(cleanup);

        expect(failure).not.toBeInstanceOf(WorkspaceReservationStateError);
        expect(await readReservation(id)).toMatchObject({
          reservationState: "held",
          reservationConfirmedAt: null,
        });
        expect(await readEvents(id)).toEqual([]);
      });

      test("records a cancelled event only for an administration cancellation of a confirmed booking", async () => {
        const claimedAt = at(5);
        const cancelling = {
          reservation: "cancelling",
          payment: "paid",
          fulfillment: "fulfilled",
        } as const;
        const confirmed = await insertReservation(cancelling, {
          updatedAt: claimedAt,
          reservationConfirmedAt: at(1),
        });
        const unconfirmed = await insertReservation(cancelling, {
          updatedAt: claimedAt,
        });
        const cancel = (id: WorkspaceReservationId) =>
          run((repository) =>
            repository.completeRequestedCancellation({
              id,
              cancelledAt: at(6),
              claimedAt,
              failureCode: "operator_cancelled",
            })
          );

        await cancel(confirmed);
        await cancel(unconfirmed);

        expect(await readEvents(confirmed)).toEqual([
          {
            kind: "reservation-cancelled",
            occurredAt: at(6),
            dotyposCustomerId: (await readReservation(confirmed))!
              .dotyposCustomerId,
          },
        ]);
        expect(await readEvents(unconfirmed)).toEqual([]);
      });

      test("records a new cancelled event when a restored booking is cancelled again", async () => {
        const id = await insertReservation(
          {
            reservation: "cancelling",
            payment: "paid",
            fulfillment: "fulfilled",
          },
          { updatedAt: at(5), reservationConfirmedAt: at(1) }
        );
        const cancel = (
          cancelledAt: Temporal.Instant,
          claimedAt: Temporal.Instant
        ) =>
          run((repository) =>
            repository.markAdministrationCancelled({
              id,
              cancelledAt,
              claimedAt,
              failureCode: "operator_cancelled",
            })
          );
        await cancel(at(6), at(5));
        // A restore confirms the booking again; a second cancellation
        // claims it anew.
        await Effect.runPromise(
          testDatabase.db
            .update(workspaceReservations)
            .set({
              reservationState: "cancelling",
              reservationCancelledAt: null,
              updatedAt: at(8),
            })
            .where(eq(workspaceReservations.id, id))
        );
        await cancel(at(9), at(8));
        const customerId = (await readReservation(id))!.dotyposCustomerId;
        // A retried write of the second cancellation records nothing more.
        await Effect.runPromise(
          Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
            transaction(
              recordCustomerEvent({
                kind: "reservation-cancelled",
                occurredAt: at(9),
                dotyposCustomerId: customerId,
                workspaceReservationId: id,
              })
            )
          ).pipe(Effect.provide(testDatabase.layer))
        );

        const events = await readEvents(id);
        expect(
          events.sort((left, right) =>
            Temporal.Instant.compare(left.occurredAt, right.occurredAt)
          )
        ).toEqual([
          {
            kind: "reservation-cancelled",
            occurredAt: at(6),
            dotyposCustomerId: customerId,
          },
          {
            kind: "reservation-cancelled",
            occurredAt: at(9),
            dotyposCustomerId: customerId,
          },
        ]);
      });

      test("rolls the administration cancellation back with a failed event write", async () => {
        const claimedAt = at(5);
        const id = await insertReservation(
          {
            reservation: "cancelling",
            payment: "paid",
            fulfillment: "fulfilled",
          },
          { updatedAt: claimedAt, reservationConfirmedAt: at(1) }
        );
        const cleanup = await rejectCustomerEventInserts(
          testDatabase.pool,
          `new.workspace_reservation_id = '${id}'`
        );
        const failure = await runFailure((repository) =>
          repository.completeRequestedCancellation({
            id,
            cancelledAt: at(6),
            claimedAt,
            failureCode: "operator_cancelled",
          })
        ).finally(cleanup);

        expect(failure).not.toBeInstanceOf(WorkspaceReservationStateError);
        expect(await readReservation(id)).toMatchObject({
          reservationState: "cancelling",
          reservationCancelledAt: null,
        });
        expect(await readEvents(id)).toEqual([]);
      });

      test("records nothing for an unpaid cancellation or a supersession", async () => {
        const unpaid = await insertReservation({ reservation: "cancelling" });
        const superseded = await insertReservation({
          reservation: "cancelling",
          payment: "failed",
        });
        const replacementKey = crypto.randomUUID();

        const claimedAt = (await readReservation(unpaid))!.updatedAt;
        await run((repository) =>
          repository.markCancelled({
            id: unpaid,
            claimedAt,
            cancelledAt: at(2),
          })
        );
        const replacement = await run((repository) =>
          repository.completeSupersessionAndCreateDraft({
            cancelledReservationId: superseded,
            cancelledAt: at(2),
            replacement: {
              checkoutSessionKey: checkoutSessionKeySchema.make(
                `session-${replacementKey}`
              ),
              checkoutAttemptKey: checkoutAttemptKeySchema.make(
                `attempt-${replacementKey}`
              ),
              dotyposCustomerId: DotyposCustomerIdSchema.make(
                `customer-${replacementKey}`
              ),
              authorAccountId: fixtureReservationAuthorId,
              reservationPurpose: "personal",
              reservationDetails: {
                kind: "cowork",
                entryTier: "basic",
                coffee: false,
              },
              locale: "en-US",
            },
          })
        );
        reservationIds.push(replacement.id);

        expect((await readReservation(unpaid))?.reservationState).toBe(
          "cancelled"
        );
        expect((await readReservation(superseded))?.reservationState).toBe(
          "cancelled"
        );
        for (const id of [unpaid, superseded, replacement.id]) {
          expect(await readEvents(id)).toEqual([]);
        }
      });
    });

    describe("customer reservations", () => {
      const insertCustomerReservation = async (input: {
        readonly customer: DotyposCustomerId;
        readonly createdAt: Temporal.Instant;
      }) => {
        const { id } = await Effect.runPromise(
          workspaceFixtures(testDatabase.db).reservation({
            stage: { reservation: "confirmed", payment: "paid" },
            customer: input.customer,
            at: at(0),
            overrides: { createdAt: input.createdAt },
          })
        );
        reservationIds.push(id);
        return id;
      };

      test("lists only the customer's reservations, oldest first, with the allowlisted fields", async () => {
        const customer = DotyposCustomerIdSchema.make(crypto.randomUUID());
        const otherCustomer = DotyposCustomerIdSchema.make(crypto.randomUUID());
        const later = await insertCustomerReservation({
          customer,
          createdAt: at(2),
        });
        const earlier = await insertCustomerReservation({
          customer,
          createdAt: at(1),
        });
        // The same fixture author books for another customer.
        await insertCustomerReservation({
          customer: otherCustomer,
          createdAt: at(0),
        });

        const records = await run((repository) =>
          repository.listForCustomer({ dotyposCustomerId: customer, limit: 2 })
        );

        expect(records.map((record) => record.id)).toEqual([earlier, later]);
        expect(Object.keys(records[0] ?? {}).toSorted()).toEqual(
          [
            "dotyposReservationId",
            "fulfilledAt",
            "fulfillmentState",
            "id",
            "locale",
            "paidAt",
            "paymentState",
            "product",
            "reservationCancelledAt",
            "reservationConfirmedAt",
            "reservationCreatedAt",
            "reservationPurpose",
            "reservationState",
          ].toSorted()
        );
        expect(records[0]?.product.kind).toBe("cowork");
      });

      test("fails rather than return part of a list over its limit", async () => {
        const customer = DotyposCustomerIdSchema.make(crypto.randomUUID());
        await insertCustomerReservation({ customer, createdAt: at(1) });
        await insertCustomerReservation({ customer, createdAt: at(2) });

        const error = await runFailure((repository) =>
          repository.listForCustomer({ dotyposCustomerId: customer, limit: 1 })
        );

        expect(error).toEqual(new ReadLimitExceededError({ limit: 1 }));
      });

      test("fails on a malformed stored product document", async () => {
        const customer = DotyposCustomerIdSchema.make(crypto.randomUUID());
        const id = await insertCustomerReservation({
          customer,
          createdAt: at(1),
        });
        // Malformed documents only reach the table outside the encoder.
        await testDatabase.pool.query(
          "update workspace_reservations set reservation_details = $1::jsonb where id = $2",
          [JSON.stringify({ kind: "office", seats: 2, unknownField: true }), id]
        );

        const error = await runFailure((repository) =>
          repository.listForCustomer({ dotyposCustomerId: customer, limit: 5 })
        );

        expect(error._tag).toBe("WorkspaceReservationDetailsMalformedError");
      });
    });
  }
);
