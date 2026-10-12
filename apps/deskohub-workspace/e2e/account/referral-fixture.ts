import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { Effect } from "effect";
import "../../shared/polyfills/temporal";
import {
  discountApplications,
  paymentAttempts,
  promotionCodes,
  referralAttributions,
  referralCodes,
  referralInvitationClaims,
  workspaceReservations,
} from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import { customerAccountLinks } from "@/db/schema/customer-account-links";
import {
  checkoutAttemptKeySchema,
  checkoutSessionKeySchema,
} from "@/features/checkout/checkout-identifiers";
import { canonicalPromotionCodeSchema } from "@/features/discounts/contracts";
import { parseReferralCode } from "@/features/referrals/client";
import { getReferralReferrerDiscountId } from "@/features/referrals/discount-identifiers";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import type { DatabaseClient } from "../../db/database-client";
import type { WorkspaceE2EError } from "../errors";
import { workspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runDatabaseOperation } from "../integrations/database-operation";

export type WorkspaceE2EReferralOwnerInput = {
  readonly accountId: string;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly email: string;
  readonly name: string;
};

type ReferralPromotionCodeId =
  (typeof referralCodes.$inferSelect)["promotionCodeId"];

export type WorkspaceE2EReferralOwner = {
  readonly code: string;
  readonly promotionCodeId: ReferralPromotionCodeId;
};

export type WorkspaceE2EReferralFixture = {
  readonly eligibleReservationId: string;
  /** The eligible invitee's own share code: a usable code from a second referrer. */
  readonly inviteeReferralCode: string;
  readonly ownPromotionCodeId: string;
};

export type WorkspaceE2EReferralFixtureInput = {
  readonly eligibleInvitee: WorkspaceE2EReferralOwnerInput;
  readonly eligibleReservationAt: Date;
  readonly eligibleReservationId: DotyposReservationId;
  readonly referrerDotyposCustomerId: DotyposCustomerId;
};

type DatabaseTransaction = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];

const generateReferralCode = () => {
  const value = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
  return `RFL${value.toUpperCase()}`;
};

const insertReferralCode = Effect.fn("seedWorkspaceE2EReferralCode")(function* (
  tx: DatabaseTransaction,
  referrerDotyposCustomerId: DotyposCustomerId
) {
  const code = parseReferralCode(generateReferralCode());
  if (code === undefined) {
    return yield* workspaceE2EError(
      "generated referral fixture code is invalid",
      {
        diagnosticCode: "postgres_account_fixture_assertion_failed",
        operation: "validate referral fixture code",
      }
    );
  }

  const [promotion] = yield* tx
    .insert(promotionCodes)
    .values({
      code: canonicalPromotionCodeSchema.make(code),
      enabled: true,
      kind: "referral",
      validFrom: null,
      validUntil: null,
    })
    .returning({ id: promotionCodes.id });
  if (!promotion) {
    return yield* workspaceE2EError(
      "referral promotion insert returned no row",
      {
        diagnosticCode: "postgres_account_fixture_assertion_failed",
        operation: "insert referral promotion",
      }
    );
  }

  const [referral] = yield* tx
    .insert(referralCodes)
    .values({
      promotionCodeId: promotion.id,
      promotionKind: "referral",
      referrerDotyposCustomerId,
    })
    .returning({ promotionCodeId: referralCodes.promotionCodeId });
  if (!referral) {
    return yield* workspaceE2EError("referral code insert returned no row", {
      diagnosticCode: "postgres_account_fixture_assertion_failed",
      operation: "insert referral code",
    });
  }

  return {
    code,
    promotionCodeId: referral.promotionCodeId,
  } satisfies WorkspaceE2EReferralOwner;
});

/**
 * A referral code is usable only while its owner's account link joins an
 * active auth user, so every seeded owner gets both rows with its code.
 */
const insertReferralOwner = Effect.fn("seedWorkspaceE2EReferralOwner")(
  function* (tx: DatabaseTransaction, owner: WorkspaceE2EReferralOwnerInput) {
    yield* tx.insert(authUser).values({
      deletionRequestedAt: null,
      email: owner.email,
      emailVerified: true,
      id: owner.accountId,
      name: owner.name,
    });
    yield* tx.insert(customerAccountLinks).values({
      customerAccountId: owner.accountId,
      dotyposCustomerId: owner.dotyposCustomerId,
    });
    return yield* insertReferralCode(tx, owner.dotyposCustomerId);
  }
);

/**
 * Local paid-booking evidence is keyed by this prefix, so cleanup removes only
 * the rows a fixture seeded for its journaled synthetic customers.
 */
const seededReservationIdPrefix = "account-referral-history-";

const makePaidHistoryRow = (input: {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly dotyposReservationId: DotyposReservationId;
  readonly paidAt: Date;
}): typeof workspaceReservations.$inferInsert => {
  const paidAt = Temporal.Instant.fromEpochMilliseconds(input.paidAt.getTime());
  return {
    checkoutAttemptKey: checkoutAttemptKeySchema.make(
      `account-referral-attempt-${crypto.randomUUID()}`
    ),
    checkoutSessionKey: checkoutSessionKeySchema.make(
      `account-referral-session-${crypto.randomUUID()}`
    ),
    dotyposCustomerId: input.dotyposCustomerId,
    dotyposReservationId: input.dotyposReservationId,
    fulfillmentState: "not_started",
    id: workspaceReservationIdSchema.make(
      `${seededReservationIdPrefix}${crypto.randomUUID()}`
    ),
    locale: "en-US",
    paidAt,
    paymentState: "paid",
    reservationConfirmedAt: paidAt,
    reservationCreatedAt: paidAt,
    reservationDetails: {
      coffee: false,
      entryTier: "basic",
      kind: "cowork",
    },
    reservationState: "confirmed",
  };
};

export type WorkspaceE2EReferralInviteeInput = {
  readonly invitedDotyposCustomerId: DotyposCustomerId;
  /** A finished confirmed Dotypos visit that makes the invitee eligible. */
  readonly paidVisit?: {
    readonly dotyposReservationId: DotyposReservationId;
    readonly endedAt: Date;
  };
  readonly referrerDotyposCustomerId: DotyposCustomerId;
  readonly referrerPromotionCodeId: ReferralPromotionCodeId;
};

/**
 * Attributes one synthetic invitee to a referrer and, for an eligible
 * invitee, records the local paid booking that matches its Dotypos visit.
 */
export const seedWorkspaceE2EReferralInvitee = (
  input: WorkspaceE2EReferralInviteeInput
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    yield* runDatabaseOperation(
      "seed synthetic referral invitee",
      db.transaction(
        Effect.fn(function* (tx) {
          yield* tx.insert(referralAttributions).values({
            invitedDotyposCustomerId: input.invitedDotyposCustomerId,
            promotionCodeId: input.referrerPromotionCodeId,
            referrerDotyposCustomerId: input.referrerDotyposCustomerId,
          });
          if (input.paidVisit) {
            yield* tx.insert(workspaceReservations).values(
              makePaidHistoryRow({
                dotyposCustomerId: input.invitedDotyposCustomerId,
                dotyposReservationId: input.paidVisit.dotyposReservationId,
                paidAt: input.paidVisit.endedAt,
              })
            );
          }
        })
      )
    );
  });

/**
 * Records one paid booking of the referrer that used the referrer discount,
 * so the Referrals screen has savings to show.
 */
export const seedWorkspaceE2EReferrerSavings = (input: {
  readonly dotyposReservationId: DotyposReservationId;
  readonly paidAt: Date;
  readonly referrerDotyposCustomerId: DotyposCustomerId;
  readonly saved: { readonly value: number; readonly subtotal: number };
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const reservation = makePaidHistoryRow({
      dotyposCustomerId: input.referrerDotyposCustomerId,
      dotyposReservationId: input.dotyposReservationId,
      paidAt: input.paidAt,
    });
    const paidAmount = input.saved.subtotal - input.saved.value;
    yield* runDatabaseOperation(
      "seed synthetic referrer savings",
      db.transaction(
        Effect.fn(function* (tx) {
          yield* tx.insert(workspaceReservations).values(reservation);
          const [attempt] = yield* tx
            .insert(paymentAttempts)
            .values({
              amountExponent: 2,
              amountValue: paidAmount,
              currency: "CZK",
              provider: "nexi",
              providerOrderId: NexiOrderIdSchema.make(
                `e2e-referral-savings-${crypto.randomUUID()}`
              ),
              state: "paid",
              workspaceReservationId: reservation.id!,
            })
            .returning({ id: paymentAttempts.id });
          if (!attempt) {
            return yield* workspaceE2EError(
              "referrer savings payment insert returned no row",
              {
                diagnosticCode: "postgres_account_fixture_assertion_failed",
                operation: "insert referrer savings payment",
              }
            );
          }
          yield* tx.insert(discountApplications).values({
            adjustment: { basisPoints: 500, kind: "percentage" },
            appliedAmountCurrency: "CZK",
            appliedAmountExponent: 2,
            appliedAmountValue: input.saved.value,
            label: "Referral discount",
            paymentAttemptId: attempt.id,
            productIdentity: { kind: "cowork" },
            provenance: { inviteeCount: 1, kind: "referral-referrer" },
            publicDiscountId: getReferralReferrerDiscountId(
              input.referrerDotyposCustomerId
            ),
            sequence: 0,
            subtotalAfterCurrency: "CZK",
            subtotalAfterExponent: 2,
            subtotalAfterValue: paidAmount,
            subtotalBeforeCurrency: "CZK",
            subtotalBeforeExponent: 2,
            subtotalBeforeValue: input.saved.subtotal,
            workspaceReservationId: reservation.id!,
          });
        })
      )
    );
  });

/** Reads the active invitation claim of one invited customer, if any. */
export const findWorkspaceE2EReferralInvitationClaimState = (
  invitedDotyposCustomerId: DotyposCustomerId
): Effect.Effect<string | undefined, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const rows = yield* runDatabaseOperation(
      "read synthetic referral invitation claim",
      db
        .select({ state: referralInvitationClaims.state })
        .from(referralInvitationClaims)
        .where(
          and(
            eq(
              referralInvitationClaims.invitedDotyposCustomerId,
              invitedDotyposCustomerId
            ),
            inArray(referralInvitationClaims.state, ["reserved", "redeemed"])
          )
        )
        .limit(1)
    );
    return rows[0]?.state;
  });

const seedReferralFixtureRows = (
  db: DatabaseClient,
  input: WorkspaceE2EReferralFixtureInput
) =>
  db.transaction(
    Effect.fn(function* (tx) {
      const [existingShareCode] = yield* tx
        .select({
          code: promotionCodes.code,
          promotionCodeId: referralCodes.promotionCodeId,
        })
        .from(referralCodes)
        .innerJoin(
          promotionCodes,
          eq(promotionCodes.id, referralCodes.promotionCodeId)
        )
        .where(
          eq(
            referralCodes.referrerDotyposCustomerId,
            input.referrerDotyposCustomerId
          )
        )
        .limit(1);

      let ownPromotionCodeId = existingShareCode?.promotionCodeId;
      if (
        existingShareCode &&
        parseReferralCode(existingShareCode.code) === undefined
      ) {
        return yield* workspaceE2EError(
          "synthetic account has an invalid referral share code",
          {
            diagnosticCode: "postgres_account_fixture_assertion_failed",
            operation: "validate synthetic referral share code",
          }
        );
      }
      if (ownPromotionCodeId === undefined) {
        const generated = yield* insertReferralCode(
          tx,
          input.referrerDotyposCustomerId
        );
        ownPromotionCodeId = generated.promotionCodeId;
      }

      const inviteeReferral = yield* insertReferralOwner(
        tx,
        input.eligibleInvitee
      );
      const eligibleReservationId = workspaceReservationIdSchema.make(
        `account-referral-history-${crypto.randomUUID()}`
      );
      const localReservationAt = Temporal.Instant.fromEpochMilliseconds(
        input.eligibleReservationAt.getTime()
      );
      yield* tx.insert(referralAttributions).values({
        invitedDotyposCustomerId: input.eligibleInvitee.dotyposCustomerId,
        promotionCodeId: ownPromotionCodeId,
        referrerDotyposCustomerId: input.referrerDotyposCustomerId,
      });
      const eligibleReservationRow: typeof workspaceReservations.$inferInsert =
        {
          checkoutAttemptKey: checkoutAttemptKeySchema.make(
            `account-referral-attempt-${crypto.randomUUID()}`
          ),
          checkoutSessionKey: checkoutSessionKeySchema.make(
            `account-referral-session-${crypto.randomUUID()}`
          ),
          dotyposCustomerId: input.eligibleInvitee.dotyposCustomerId,
          dotyposReservationId: input.eligibleReservationId,
          fulfillmentState: "not_started",
          id: eligibleReservationId,
          locale: "en-US",
          paidAt: localReservationAt,
          paymentState: "paid",
          reservationConfirmedAt: localReservationAt,
          reservationCreatedAt: localReservationAt,
          reservationDetails: {
            coffee: false,
            entryTier: "basic",
            kind: "cowork",
          },
          reservationState: "confirmed",
        };
      yield* tx.insert(workspaceReservations).values(eligibleReservationRow);

      return {
        eligibleReservationId,
        inviteeReferralCode: inviteeReferral.code,
        ownPromotionCodeId,
      } satisfies WorkspaceE2EReferralFixture;
    })
  );

/**
 * Seeds the referrer whose share link the synthetic main account follows
 * before completing its profile.
 */
export const seedWorkspaceE2EReferralOwner = (
  input: WorkspaceE2EReferralOwnerInput
): Effect.Effect<WorkspaceE2EReferralOwner, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    return yield* runDatabaseOperation(
      "seed synthetic referral owner",
      db.transaction((tx) => insertReferralOwner(tx, input))
    );
  }).pipe(
    Effect.mapError((cause) =>
      workspaceE2EError("Could not seed synthetic referral owner", {
        cause,
        diagnosticCode: "postgres_account_fixture_assertion_failed",
        operation: "seed synthetic referral owner",
      })
    )
  );

export const seedWorkspaceE2EReferralFixture = (
  input: WorkspaceE2EReferralFixtureInput
): Effect.Effect<WorkspaceE2EReferralFixture, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    return yield* runDatabaseOperation(
      "seed synthetic account referral fixture",
      seedReferralFixtureRows(db, input)
    );
  }).pipe(
    Effect.mapError((cause) =>
      workspaceE2EError("Could not seed synthetic account referral fixture", {
        cause,
        diagnosticCode: "postgres_account_fixture_assertion_failed",
        operation: "seed synthetic account referral fixture",
      })
    )
  );

/** Reads the referrer recorded for one invited customer, if any. */
export const findWorkspaceE2EReferralReferrer = (
  invitedDotyposCustomerId: DotyposCustomerId
): Effect.Effect<string | undefined, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const rows = yield* runDatabaseOperation(
      "read synthetic referral attribution",
      db
        .select({
          referrerDotyposCustomerId:
            referralAttributions.referrerDotyposCustomerId,
        })
        .from(referralAttributions)
        .where(
          eq(
            referralAttributions.invitedDotyposCustomerId,
            invitedDotyposCustomerId
          )
        )
        .limit(1)
    );
    return rows[0]?.referrerDotyposCustomerId;
  });

export const removeWorkspaceE2EReferralRows = (input: {
  readonly syntheticDotyposCustomerIds: readonly DotyposCustomerId[];
  readonly syntheticDotyposReservationIds: readonly DotyposReservationId[];
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    if (
      input.syntheticDotyposCustomerIds.length === 0 &&
      input.syntheticDotyposReservationIds.length === 0
    ) {
      return;
    }

    const { db } = yield* E2EDatabase;
    yield* runDatabaseOperation(
      "remove synthetic account referral rows",
      removeReferralFixtureRows(db, input)
    );
  });

const removeReferralFixtureRows = (
  db: DatabaseClient,
  input: {
    readonly syntheticDotyposCustomerIds: readonly DotyposCustomerId[];
    readonly syntheticDotyposReservationIds: readonly DotyposReservationId[];
  }
) =>
  db.transaction(
    Effect.fn(function* (tx) {
      const customerIds = input.syntheticDotyposCustomerIds;
      if (customerIds.length > 0) {
        const codes = yield* tx
          .select({ promotionCodeId: referralCodes.promotionCodeId })
          .from(referralCodes)
          .where(inArray(referralCodes.referrerDotyposCustomerId, customerIds));
        yield* tx
          .delete(referralInvitationClaims)
          .where(
            inArray(
              referralInvitationClaims.invitedDotyposCustomerId,
              customerIds
            )
          );
        yield* tx
          .delete(referralAttributions)
          .where(
            or(
              inArray(
                referralAttributions.invitedDotyposCustomerId,
                customerIds
              ),
              inArray(
                referralAttributions.referrerDotyposCustomerId,
                customerIds
              )
            )
          );
        yield* tx
          .delete(referralCodes)
          .where(inArray(referralCodes.referrerDotyposCustomerId, customerIds));
        const promotionCodeIds = codes.map(
          ({ promotionCodeId }) => promotionCodeId
        );
        if (promotionCodeIds.length > 0) {
          yield* tx
            .delete(promotionCodes)
            .where(inArray(promotionCodes.id, promotionCodeIds));
        }
        const seeded = yield* tx
          .select({ id: workspaceReservations.id })
          .from(workspaceReservations)
          .where(
            and(
              inArray(workspaceReservations.dotyposCustomerId, customerIds),
              like(workspaceReservations.id, `${seededReservationIdPrefix}%`)
            )
          );
        const seededIds = seeded.map(({ id }) => id);
        if (seededIds.length > 0) {
          yield* tx
            .delete(discountApplications)
            .where(
              inArray(discountApplications.workspaceReservationId, seededIds)
            );
          yield* tx
            .delete(workspaceReservations)
            .where(inArray(workspaceReservations.id, seededIds));
        }
      }

      if (input.syntheticDotyposReservationIds.length > 0) {
        yield* tx
          .delete(workspaceReservations)
          .where(
            inArray(
              workspaceReservations.dotyposReservationId,
              input.syntheticDotyposReservationIds
            )
          );
      }
    })
  );

/** Makes one seeded referral code unusable, as a disabled code would be. */
export const disableWorkspaceE2EReferralCode = (
  promotionCodeId: ReferralPromotionCodeId
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    yield* runDatabaseOperation(
      "disable synthetic referral code",
      db
        .update(promotionCodes)
        .set({ enabled: false })
        .where(eq(promotionCodes.id, promotionCodeId))
    );
  });
