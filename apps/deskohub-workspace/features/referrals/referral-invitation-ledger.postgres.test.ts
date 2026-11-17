import "@/shared/polyfills/temporal";

import { afterEach, describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Layer, Logger, Predicate } from "effect";
import {
  WorkspaceDatabase,
  type WorkspaceTransaction,
} from "@/db/database.service";
import {
  discountApplications,
  paymentAttempts,
  promotionCodes,
  referralAttributions,
  referralCodes,
  referralInvitationClaims,
  workspaceReservations,
} from "@/db/schema";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { AppliedDiscount } from "@/features/discounts/contracts";
import {
  canonicalPromotionCodeSchema,
  type DiscountApplicationId,
  type PromotionCodeId,
} from "@/features/discounts/persistence-contracts";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { Money } from "@/shared/money/money";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import {
  holdPostgresTransaction,
  waitForAdvisoryLockWaiter,
} from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { makeReferralInvitationCandidate } from "./referral-benefits";
import type { ReferralInvitationClaim } from "./referral-invitation-claim-benefits";
import { ReferralInvitationLedger } from "./referral-invitation-ledger";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const product = { kind: "cowork", tier: "basic" } as const;
const locale = "en-US" as const;
const subtotal = 35_000;
const czk = (value: number): Money => ({ value, exponent: 2, currency: "CZK" });
const newCustomer = () =>
  (
    Math.floor(Math.random() * 900_000_000) + 100_000_000
  ).toString() as DotyposCustomerId;
const now = () => Temporal.Now.instant();
const inAnHour = () => now().add({ hours: 1 });

type LogRecord = { readonly message: unknown; readonly annotations: unknown };
/** The warnings the ledger logged; query logs are left out. */
const logRecords: LogRecord[] = [];
const capturingLogger = Logger.make((options) => {
  if (options.logLevel !== "Warn") return;
  logRecords.push({
    message: options.message[0],
    annotations: options.message[1],
  });
});
afterEach(() => {
  logRecords.length = 0;
});

/** Runs `effect` in its own Workspace transaction on the test database. */
const inTransaction = <A, E>(
  effect: Effect.Effect<A, E, WorkspaceTransaction>
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { transaction } = yield* WorkspaceDatabase;
      return yield* transaction(effect);
    }).pipe(
      Effect.provide(
        Layer.merge(testDatabase!.layer, Logger.layer([capturingLogger]))
      ),
      Effect.result
    )
  );

/** A referrer's referral code, which attributions and claims reference. */
const createReferralCode = async (referrer = newCustomer()) => {
  const db = testDatabase!.db;
  const [promotion] = await Effect.runPromise(
    db
      .insert(promotionCodes)
      .values({
        kind: "referral",
        code: canonicalPromotionCodeSchema.make(
          `RIL${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`
        ),
        enabled: true,
      })
      .returning({ id: promotionCodes.id })
  );
  await Effect.runPromise(
    db.insert(referralCodes).values({
      promotionCodeId: promotion!.id,
      referrerDotyposCustomerId: referrer,
    })
  );
  return { referrer, promotionCodeId: promotion!.id as PromotionCodeId };
};

type ReferralCode = Awaited<ReturnType<typeof createReferralCode>>;

const attribute = (invited: DotyposCustomerId, code: ReferralCode) =>
  Effect.runPromise(
    testDatabase!.db.insert(referralAttributions).values({
      invitedDotyposCustomerId: invited,
      referrerDotyposCustomerId: code.referrer,
      promotionCodeId: code.promotionCodeId,
    })
  );

/** The invitation `code` offers `invited`, as checkout prices and claims it. */
const invitationOffer = (
  invited: DotyposCustomerId,
  code: ReferralCode,
  offerLocale: "en-US" | "cs-CZ" = locale
) => {
  const candidate = makeReferralInvitationCandidate({
    dotyposCustomerId: invited,
    locale: offerLocale,
    referral: {
      referrerDotyposCustomerId: code.referrer,
      promotionCodeId: code.promotionCodeId,
    },
  });
  const amount = (subtotal * 15) / 100;
  return {
    claim: candidate.claim as ReferralInvitationClaim,
    application: {
      discount: candidate.discount,
      subtotalBefore: czk(subtotal),
      amount: czk(amount),
      subtotalAfter: czk(subtotal - amount),
    } satisfies AppliedDiscount,
  };
};

type Offer = ReturnType<typeof invitationOffer>;

/** A held reservation's new payment attempt with the application persisted. */
const createAttempt = async (
  customer: DotyposCustomerId,
  application: AppliedDiscount
) => {
  const db = testDatabase!.db;
  const reservation = await Effect.runPromise(
    workspaceFixtures(db).reservation({
      stage: { reservation: "held" },
      customer,
    })
  );
  const [attempt] = await Effect.runPromise(
    db
      .insert(paymentAttempts)
      .values({
        workspaceReservationId: reservation.id,
        provider: "nexi",
        providerOrderId: `order-${crypto.randomUUID()}` as never,
        state: "created",
        amountValue: application.subtotalAfter.value,
        amountExponent: 2,
        currency: "CZK",
      })
      .returning({ id: paymentAttempts.id })
  );
  const [persisted] = await Effect.runPromise(
    db
      .insert(discountApplications)
      .values({
        paymentAttemptId: attempt!.id,
        workspaceReservationId: reservation.id,
        sequence: 0,
        publicDiscountId: application.discount.id,
        label: application.discount.label,
        adjustment: application.discount.adjustment,
        productIdentity: product,
        subtotalBeforeValue: application.subtotalBefore.value,
        subtotalBeforeExponent: 2,
        subtotalBeforeCurrency: "CZK",
        appliedAmountValue: application.amount.value,
        appliedAmountExponent: 2,
        appliedAmountCurrency: "CZK",
        subtotalAfterValue: application.subtotalAfter.value,
        subtotalAfterExponent: 2,
        subtotalAfterCurrency: "CZK",
        provenance: { providerNamespace: "test", providerReference: "test" },
      })
      .returning({ id: discountApplications.id })
  );
  return {
    workspaceReservationId: reservation.id as WorkspaceReservationId,
    paymentAttemptId: attempt!.id as PaymentAttemptId,
    applicationId: persisted!.id as DiscountApplicationId,
  };
};

type Attempt = Awaited<ReturnType<typeof createAttempt>>;

/** Another of the customer's reservations, paid or with a pending payment. */
const createOtherBooking = (
  customer: DotyposCustomerId,
  payment: "paid" | "pending"
) =>
  Effect.runPromise(
    workspaceFixtures(testDatabase!.db).reservation({
      stage:
        payment === "paid"
          ? { reservation: "confirmed", payment: "paid" }
          : { reservation: "held", payment: "pending" },
      customer,
    })
  );

const admission = (
  offer: Offer,
  attempt: Attempt,
  reservationExpiresAt = inAnHour()
) => ({
  claim: offer.claim,
  application: offer.application,
  applicationId: attempt.applicationId,
  paymentAttemptId: attempt.paymentAttemptId,
  reservationCustomerId: offer.claim.invitedDotyposCustomerId,
  reservationExpiresAt,
  locale,
});

/** Creates a checkout referral attempt for a fresh invitee and admits it. */
const admitNew = async (
  input: {
    readonly invited?: DotyposCustomerId;
    readonly code?: ReferralCode;
  } = {}
) => {
  const invited = input.invited ?? newCustomer();
  const code = input.code ?? (await createReferralCode());
  const offer = invitationOffer(invited, code);
  const attempt = await createAttempt(invited, offer.application);
  const result = await inTransaction(
    ReferralInvitationLedger.admit(admission(offer, attempt))
  );
  return { invited, code, offer, attempt, result };
};

const claimRows = async (paymentAttemptId: PaymentAttemptId) =>
  (
    await testDatabase!.pool.query(
      "select state, referrer_dotypos_customer_id as referrer, promotion_code_id as code, release_reason, redeemed_at is not null as redeemed, released_at is not null as released from referral_invitation_claims where payment_attempt_id = $1",
      [paymentAttemptId]
    )
  ).rows;

const attributionRows = async (invited: DotyposCustomerId) =>
  (
    await testDatabase!.pool.query(
      "select referrer_dotypos_customer_id as referrer, promotion_code_id as code from referral_attributions where invited_dotypos_customer_id = $1",
      [invited]
    )
  ).rows;

const redeem = (
  attempt: Attempt,
  options: { readonly readmitReleased?: boolean } = {}
) =>
  inTransaction(
    ReferralInvitationLedger.redeem({
      paymentAttemptId: attempt.paymentAttemptId,
      workspaceReservationId: attempt.workspaceReservationId,
      redeemedAt: now(),
      ...options,
    })
  );

const release = (attempt: Attempt, releaseReason = "failed") =>
  inTransaction(
    ReferralInvitationLedger.release({
      paymentAttemptId: attempt.paymentAttemptId,
      releasedAt: now(),
      releaseReason,
    })
  );

const ensureFirstPaid = (invited: DotyposCustomerId, attempt: Attempt) =>
  inTransaction(
    ReferralInvitationLedger.ensureFirstPaid({
      dotyposCustomerId: invited,
      workspaceReservationId: attempt.workspaceReservationId,
      paymentAttemptId: attempt.paymentAttemptId,
    })
  );

const admitFirstBooking = (
  customer: DotyposCustomerId,
  workspaceReservationId: WorkspaceReservationId,
  admitsInvitation: boolean
) =>
  inTransaction(
    ReferralInvitationLedger.admitFirstBooking({
      dotyposCustomerId: customer,
      workspaceReservationId,
      admitsInvitation,
    })
  );

const claimConflict = (operation: "reserve" | "redeem" | "release") => ({
  _tag: "Failure",
  failure: { _tag: "DiscountClaimError", operation, reason: "claim_conflict" },
});

/** Holds the referral graph lock on another connection until `release`. */
const holdGraphLock = () =>
  holdPostgresTransaction(
    testDatabase!.pool,
    "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
    ["referral-attribution", "graph"]
  );

const holdFirstBookingLock = (customer: DotyposCustomerId) =>
  holdPostgresTransaction(
    testDatabase!.pool,
    "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
    ["referral-first-booking", customer]
  );

/** Whether another connection could take the lock right now. */
const isLockFree = async (key: readonly [string, string]) =>
  (
    await testDatabase!.pool.query<{ readonly free: boolean }>(
      "select pg_try_advisory_xact_lock(hashtext($1), hashtext($2)) as free",
      [...key]
    )
  ).rows[0]?.free;

describe.skipIf(!testDatabase)(
  "ReferralInvitationLedger on disposable Postgres",
  () => {
    describe("lockFirstBooking", () => {
      test("takes the graph lock before the first-booking lock for a paid attempt that records a referral", async () => {
        const { invited, attempt } = await admitNew();

        const graph = await holdGraphLock();
        const waitingOnGraph = inTransaction(
          ReferralInvitationLedger.lockFirstBooking({
            dotyposCustomerId: invited,
            records: { claimOf: attempt.paymentAttemptId },
          })
        );
        await waitForAdvisoryLockWaiter(testDatabase!.pool, [
          "referral-attribution",
          "graph",
        ]);
        expect(await isLockFree(["referral-first-booking", invited])).toBe(
          true
        );
        await graph.commit();
        expect(await waitingOnGraph).toMatchObject({ _tag: "Success" });

        const firstBooking = await holdFirstBookingLock(invited);
        const waitingOnFirstBooking = inTransaction(
          ReferralInvitationLedger.lockFirstBooking({
            dotyposCustomerId: invited,
            records: { claimOf: attempt.paymentAttemptId },
          })
        );
        await waitForAdvisoryLockWaiter(testDatabase!.pool, [
          "referral-first-booking",
          invited,
        ]);
        expect(await isLockFree(["referral-attribution", "graph"])).toBe(false);
        await firstBooking.commit();
        expect(await waitingOnFirstBooking).toMatchObject({ _tag: "Success" });
      });

      test("takes only the first-booking lock when nothing is recorded or the attempt records no referral", async () => {
        const { invited } = await admitNew();
        const ordinary = newCustomer();
        const ordinaryAttempt = await createAttempt(
          ordinary,
          invitationOffer(ordinary, await createReferralCode()).application
        );

        const graph = await holdGraphLock();
        try {
          for (const [customer, records] of [
            [invited, "nothing"],
            [ordinary, { claimOf: ordinaryAttempt.paymentAttemptId }],
            [invited, { admittedInvitation: false }],
          ] as const) {
            expect(
              await inTransaction(
                ReferralInvitationLedger.lockFirstBooking({
                  dotyposCustomerId: customer,
                  records,
                })
              )
            ).toMatchObject({ _tag: "Success" });
          }
        } finally {
          await graph.commit();
        }
      });

      test("fails an admitted invitation's bounded graph wait with a lock timeout", async () => {
        const invited = newCustomer();
        const graph = await holdGraphLock();
        try {
          const timedOut = await Effect.runPromise(
            Effect.exit(
              Effect.gen(function* () {
                const { transaction } = yield* WorkspaceDatabase;
                return yield* transaction(
                  ReferralInvitationLedger.lockFirstBooking({
                    dotyposCustomerId: invited,
                    records: { admittedInvitation: true },
                  })
                );
              }).pipe(Effect.provide(testDatabase!.layer))
            )
          );
          const failure = Exit.isFailure(timedOut)
            ? Cause.squash(timedOut.cause)
            : undefined;
          expect(failure).toMatchObject({
            _tag: "EffectDrizzleQueryError",
            params: ["referral-attribution", "graph"],
          });
          const queryCause = Predicate.hasProperty(failure, "cause")
            ? failure.cause
            : undefined;
          expect(
            Cause.isCause(queryCause) ? Cause.squash(queryCause) : queryCause
          ).toMatchObject({
            _tag: "SqlError",
            reason: { _tag: "LockTimeoutError" },
          });
        } finally {
          await graph.commit();
        }
        expect(await isLockFree(["referral-first-booking", invited])).toBe(
          true
        );
      });

      test("restores the transaction's lock_timeout after the bounded graph wait", async () => {
        const result = await inTransaction(
          Effect.gen(function* () {
            const { db } = yield* WorkspaceDatabase;
            yield* db.execute(sql`set local lock_timeout = '7s'`);
            yield* ReferralInvitationLedger.lockFirstBooking({
              dotyposCustomerId: newCustomer(),
              records: { admittedInvitation: true },
            });
            const { rows } = yield* db.execute<{
              readonly lock_timeout: string;
            }>(sql`select current_setting('lock_timeout') as lock_timeout`);
            return rows[0]?.lock_timeout;
          })
        );
        expect(result).toMatchObject({ _tag: "Success", success: "7s" });
      });
    });

    describe("admitFirstBooking", () => {
      test("admits an uninvited customer's payment whatever their other bookings", async () => {
        const customer = newCustomer();
        await createOtherBooking(customer, "pending");
        await createOtherBooking(customer, "paid");
        const attempt = await createAttempt(
          customer,
          invitationOffer(customer, await createReferralCode()).application
        );
        expect(
          await admitFirstBooking(
            customer,
            attempt.workspaceReservationId,
            false
          )
        ).toMatchObject({ _tag: "Success" });
      });

      test("refuses an invitation after a paid booking but lets an ordinary payment through", async () => {
        const customer = newCustomer();
        await attribute(customer, await createReferralCode());
        await createOtherBooking(customer, "paid");
        const attempt = await createAttempt(
          customer,
          invitationOffer(customer, await createReferralCode()).application
        );
        expect(
          await admitFirstBooking(
            customer,
            attempt.workspaceReservationId,
            true
          )
        ).toMatchObject(claimConflict("reserve"));
        expect(
          await admitFirstBooking(
            customer,
            attempt.workspaceReservationId,
            false
          )
        ).toMatchObject({ _tag: "Success" });
      });

      test("admits one first booking of an invited customer at a time", async () => {
        const attributed = newCustomer();
        await attribute(attributed, await createReferralCode());
        await createOtherBooking(attributed, "pending");
        const attributedAttempt = await createAttempt(
          attributed,
          invitationOffer(attributed, await createReferralCode()).application
        );
        expect(
          await admitFirstBooking(
            attributed,
            attributedAttempt.workspaceReservationId,
            false
          )
        ).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "ReferralFirstBookingAdmittedError" },
        });
        expect(
          await admitFirstBooking(
            attributed,
            attributedAttempt.workspaceReservationId,
            true
          )
        ).toMatchObject(claimConflict("reserve"));

        const { invited } = await admitNew();
        const nextAttempt = await createAttempt(
          invited,
          invitationOffer(invited, await createReferralCode()).application
        );
        expect(
          await admitFirstBooking(
            invited,
            nextAttempt.workspaceReservationId,
            false
          )
        ).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "ReferralFirstBookingAdmittedError" },
        });
        expect(
          await admitFirstBooking(
            invited,
            nextAttempt.workspaceReservationId,
            true
          )
        ).toMatchObject(claimConflict("reserve"));
      });
    });

    describe("admit", () => {
      test("reserves a first booking's checkout referral with its referrer and code", async () => {
        const { code, attempt, result } = await admitNew();
        expect(result).toMatchObject({ _tag: "Success" });
        expect(await claimRows(attempt.paymentAttemptId)).toEqual([
          {
            state: "reserved",
            referrer: code.referrer,
            code: code.promotionCodeId,
            release_reason: null,
            redeemed: false,
            released: false,
          },
        ]);
      });

      test("admits a customer attributed to the same referral and refuses a different one", async () => {
        const code = await createReferralCode();
        const same = newCustomer();
        await attribute(same, code);
        expect((await admitNew({ invited: same, code })).result).toMatchObject({
          _tag: "Success",
        });

        const other = newCustomer();
        await attribute(other, await createReferralCode());
        const refused = await admitNew({ invited: other, code });
        expect(refused.result).toMatchObject(claimConflict("reserve"));
        expect(await claimRows(refused.attempt.paymentAttemptId)).toEqual([]);
      });

      test("refuses another customer, a changed benefit and an ended hold", async () => {
        const invited = newCustomer();
        const code = await createReferralCode();
        const offer = invitationOffer(invited, code);
        const attempt = await createAttempt(invited, offer.application);

        expect(
          await inTransaction(
            ReferralInvitationLedger.admit({
              ...admission(offer, attempt),
              reservationCustomerId: newCustomer(),
            })
          )
        ).toMatchObject({
          _tag: "Failure",
          failure: {
            _tag: "DiscountClaimError",
            operation: "reserve",
            reason: "customer_ineligible",
          },
        });
        const otherLocale = invitationOffer(invited, code, "cs-CZ");
        expect(
          await inTransaction(
            ReferralInvitationLedger.admit({
              ...admission(offer, attempt),
              application: otherLocale.application,
            })
          )
        ).toMatchObject(claimConflict("reserve"));
        expect(
          await inTransaction(
            ReferralInvitationLedger.admit(
              admission(offer, attempt, now().subtract({ seconds: 1 }))
            )
          )
        ).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "ReferralClaimHoldEndedError" },
        });
        expect(await claimRows(attempt.paymentAttemptId)).toEqual([]);
      });

      test("reports an active claim elsewhere as a claim conflict", async () => {
        const { invited, code } = await admitNew();
        const second = await admitNew({ invited, code });
        expect(second.result).toMatchObject(claimConflict("reserve"));
        expect(second.result).toMatchObject({
          failure: { cause: { _tag: "EffectDrizzleQueryError" } },
        });
        expect(await claimRows(second.attempt.paymentAttemptId)).toEqual([]);
      });
    });

    describe("ensureFirstPaid", () => {
      test("allows an uninvited booking and a checkout referral's first booking", async () => {
        const customer = newCustomer();
        await createOtherBooking(customer, "paid");
        const ordinary = await createAttempt(
          customer,
          invitationOffer(customer, await createReferralCode()).application
        );
        expect(await ensureFirstPaid(customer, ordinary)).toMatchObject({
          _tag: "Success",
        });

        const { invited, attempt } = await admitNew();
        expect(await ensureFirstPaid(invited, attempt)).toMatchObject({
          _tag: "Success",
        });
      });

      test("refuses an invitation after another paid booking or beside another admitted first booking", async () => {
        const paidElsewhere = await admitNew();
        await createOtherBooking(paidElsewhere.invited, "paid");
        expect(
          await ensureFirstPaid(paidElsewhere.invited, paidElsewhere.attempt)
        ).toMatchObject(claimConflict("redeem"));

        const pendingElsewhere = await admitNew();
        await createOtherBooking(pendingElsewhere.invited, "pending");
        expect(
          await ensureFirstPaid(
            pendingElsewhere.invited,
            pendingElsewhere.attempt
          )
        ).toMatchObject(claimConflict("redeem"));

        const claimedElsewhere = await admitNew();
        const ordinary = await createAttempt(
          claimedElsewhere.invited,
          claimedElsewhere.offer.application
        );
        expect(
          await ensureFirstPaid(claimedElsewhere.invited, ordinary)
        ).toMatchObject(claimConflict("redeem"));
      });

      test("allows an attributed customer's ordinary payment after a paid booking and a redeemed claim", async () => {
        const customer = newCustomer();
        await attribute(customer, await createReferralCode());
        await createOtherBooking(customer, "paid");
        const ordinary = await createAttempt(
          customer,
          invitationOffer(customer, await createReferralCode()).application
        );
        expect(await ensureFirstPaid(customer, ordinary)).toMatchObject({
          _tag: "Success",
        });

        const { invited, attempt } = await admitNew();
        expect(await redeem(attempt)).toMatchObject({ _tag: "Success" });
        await createOtherBooking(invited, "paid");
        expect(await ensureFirstPaid(invited, attempt)).toMatchObject({
          _tag: "Success",
        });
      });

      test("refuses an older claim whose attribution is gone", async () => {
        const invited = newCustomer();
        const offer = invitationOffer(invited, await createReferralCode());
        const attempt = await createAttempt(invited, offer.application);
        await Effect.runPromise(
          testDatabase!.db.insert(referralInvitationClaims).values({
            invitedDotyposCustomerId: invited,
            applicationId: attempt.applicationId,
            paymentAttemptId: attempt.paymentAttemptId,
            state: "reserved",
            reservationExpiresAt: inAnHour(),
          })
        );
        expect(await ensureFirstPaid(invited, attempt)).toMatchObject(
          claimConflict("redeem")
        );
      });
    });

    describe("redeem", () => {
      test("redeems once and records the claim's attribution", async () => {
        const { invited, code, attempt } = await admitNew();
        for (let round = 0; round < 2; round += 1) {
          expect(await redeem(attempt)).toMatchObject({ _tag: "Success" });
        }
        expect(await claimRows(attempt.paymentAttemptId)).toMatchObject([
          { state: "redeemed", redeemed: true, released: false },
        ]);
        expect(await attributionRows(invited)).toEqual([
          { referrer: code.referrer, code: code.promotionCodeId },
        ]);
        expect(logRecords).toEqual([]);
      });

      test("keeps the graph when a different referrer or a cycle appeared after admission", async () => {
        const differentReferrer = await admitNew();
        const other = await createReferralCode();
        await attribute(differentReferrer.invited, other);

        const cycle = await admitNew();
        await attribute(
          cycle.code.referrer,
          await createReferralCode(cycle.invited)
        );

        for (const [admitted, kept, reason] of [
          [differentReferrer, other, "already_attributed"],
          [cycle, undefined, "cycle"],
        ] as const) {
          logRecords.length = 0;
          expect(await redeem(admitted.attempt)).toMatchObject({
            _tag: "Success",
          });
          expect(
            await claimRows(admitted.attempt.paymentAttemptId)
          ).toMatchObject([{ state: "redeemed" }]);
          expect(await attributionRows(admitted.invited)).toEqual(
            kept === undefined
              ? []
              : [{ referrer: kept.referrer, code: kept.promotionCodeId }]
          );
          expect(logRecords).toEqual([
            {
              message:
                "Paid referral invitation kept the existing referral graph",
              annotations: { reason },
            },
          ]);
        }
      });

      test("readmits a released claim only for late recovery and only while the invitation is unconsumed", async () => {
        const { invited, code, attempt } = await admitNew();
        expect(await release(attempt, "expired")).toMatchObject({
          _tag: "Success",
        });
        expect(await redeem(attempt)).toMatchObject(claimConflict("redeem"));
        expect(await redeem(attempt, { readmitReleased: false })).toMatchObject(
          claimConflict("redeem")
        );

        const retry = await admitNew({ invited, code });
        expect(retry.result).toMatchObject({ _tag: "Success" });
        expect(await redeem(attempt, { readmitReleased: true })).toMatchObject(
          claimConflict("redeem")
        );
        expect(await release(retry.attempt)).toMatchObject({
          _tag: "Success",
        });

        await createOtherBooking(invited, "paid");
        expect(await redeem(attempt, { readmitReleased: true })).toMatchObject(
          claimConflict("redeem")
        );
        expect(await claimRows(attempt.paymentAttemptId)).toMatchObject([
          { state: "released", release_reason: "expired" },
        ]);
        expect(await attributionRows(invited)).toEqual([]);
      });

      test("readmits and attributes a released claim nothing else consumed", async () => {
        const { invited, code, attempt } = await admitNew();
        expect(await release(attempt, "cancelled")).toMatchObject({
          _tag: "Success",
        });
        expect(await redeem(attempt, { readmitReleased: true })).toMatchObject({
          _tag: "Success",
        });
        expect(await claimRows(attempt.paymentAttemptId)).toEqual([
          {
            state: "redeemed",
            referrer: code.referrer,
            code: code.promotionCodeId,
            release_reason: null,
            redeemed: true,
            released: false,
          },
        ]);
        expect(await attributionRows(invited)).toEqual([
          { referrer: code.referrer, code: code.promotionCodeId },
        ]);
      });

      test("passes an attempt without an invitation claim", async () => {
        const customer = newCustomer();
        const attempt = await createAttempt(
          customer,
          invitationOffer(customer, await createReferralCode()).application
        );
        expect(await redeem(attempt)).toMatchObject({ _tag: "Success" });
        expect(await release(attempt)).toMatchObject({ _tag: "Success" });
        expect(await claimRows(attempt.paymentAttemptId)).toEqual([]);
      });
    });

    describe("release", () => {
      test("releases a reserved claim once, keeps the first reason and records nothing", async () => {
        const { invited, attempt } = await admitNew();
        for (const reason of ["failed", "a later reason"]) {
          expect(await release(attempt, reason)).toMatchObject({
            _tag: "Success",
          });
        }
        expect(await claimRows(attempt.paymentAttemptId)).toMatchObject([
          { state: "released", release_reason: "failed", released: true },
        ]);
        expect(await attributionRows(invited)).toEqual([]);
      });

      test("refuses to release a redeemed claim", async () => {
        const { attempt } = await admitNew();
        expect(await redeem(attempt)).toMatchObject({ _tag: "Success" });
        expect(await release(attempt)).toMatchObject(claimConflict("release"));
        expect(await claimRows(attempt.paymentAttemptId)).toMatchObject([
          { state: "redeemed" },
        ]);
      });
    });

    describe("administration cancellation", () => {
      /** Makes the attempt its reservation's pending payment. */
      const startPayment = (attempt: Attempt) =>
        Effect.runPromise(
          testDatabase!.db
            .update(workspaceReservations)
            .set({
              paymentState: "pending",
              activePaymentAttemptId: attempt.paymentAttemptId,
            })
            .where(eq(workspaceReservations.id, attempt.workspaceReservationId))
        );

      const cancelPendingPayment = (attempt: Attempt) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const reservations = yield* WorkspaceReservationRepository;
            return yield* reservations.claimRequestedCancellation({
              id: attempt.workspaceReservationId,
              cause: "operator",
              staleCancellingBefore: now(),
              pendingPaymentCancellation: {
                paymentAttemptId: attempt.paymentAttemptId,
                failureCode: "operator_cancelled",
              },
            });
          }).pipe(
            Effect.provide(WorkspaceReservationRepository.Default),
            Effect.provide(testDatabase!.layer)
          )
        );

      test("releases the cancelled payment's claim so the invited customer can claim the invitation again", async () => {
        const { invited, code, offer, attempt, result } = await admitNew();
        expect(result).toMatchObject({ _tag: "Success" });
        await startPayment(attempt);
        const blocked = await createAttempt(invited, offer.application);
        expect(
          await inTransaction(
            ReferralInvitationLedger.admit(admission(offer, blocked))
          )
        ).toMatchObject(claimConflict("reserve"));

        expect((await cancelPendingPayment(attempt))?.reservationState).toBe(
          "cancelling"
        );
        expect(await claimRows(attempt.paymentAttemptId)).toMatchObject([
          {
            state: "released",
            release_reason: "operator_cancelled",
            released: true,
          },
        ]);

        const again = await admitNew({ invited, code });
        expect(again.result).toMatchObject({ _tag: "Success" });
        expect(await claimRows(again.attempt.paymentAttemptId)).toMatchObject([
          { state: "reserved", referrer: code.referrer },
        ]);
      });
    });
  }
);
