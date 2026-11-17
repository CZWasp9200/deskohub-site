import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq, inArray, ne } from "drizzle-orm";
import { Data, Duration, Effect, Option } from "effect";
import { WorkspaceTransaction } from "@/db/database.service";
import {
  referralAttributions,
  referralInvitationClaims,
  workspaceReservations,
} from "@/db/schema";
import {
  type DatabaseQueryError,
  findViolatedConstraint,
} from "@/db/sql-constraint";
import { WorkspaceLocks } from "@/db/workspace-locks";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { AppliedDiscount } from "@/features/discounts/contracts";
import { DiscountClaimError } from "@/features/discounts/errors";
import type {
  DiscountApplicationId,
  PromotionCodeId,
} from "@/features/discounts/persistence-contracts";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { evaluateReferralAttribution } from "./attribution";
import {
  isAttributedToAnotherReferral,
  type ReferralInvitationClaim,
  referralInvitationBenefitChanged,
} from "./referral-invitation-claim-benefits";

// The referral invitation claim ledger: the only production writer of
// `referral_invitation_claims` and of the attribution a claim records when
// its payment is paid. Each operation is one step of its caller's Workspace
// transaction; the advisory locks `lockFirstBooking` takes and every row lock
// here last until that transaction ends. The ledger never reads the referrals
// release flag: a claim admitted while the program was on is redeemed and
// attributed whatever the flag says now.

/**
 * Another payment of the invited customer already holds their first booking,
 * so an ordinary payment waits for it. The caller reports it in its own terms.
 */
class ReferralFirstBookingAdmittedError extends Data.TaggedError(
  "ReferralFirstBookingAdmittedError"
)<{
  readonly message: string;
}> {}

/**
 * The reservation hold the claim would expire with ended before admission.
 * The caller reports it in its own terms.
 */
class ReferralClaimHoldEndedError extends Data.TaggedError(
  "ReferralClaimHoldEndedError"
)<{
  readonly message: string;
}> {}

/**
 * The attribution a payment transaction may record, which decides whether it
 * takes the referral graph lock before the first-booking lock.
 */
type ReferralLockedAttribution =
  /** Admission, terminal release or late-recovery start: no attribution. */
  | "nothing"
  /**
   * A paid transition: the attribution the attempt's claim carries, if that
   * claim came from a checkout referral.
   */
  | { readonly claimOf: PaymentAttemptId }
  /**
   * A zero-total internal payment, which admits and redeems its claims in one
   * transaction: the attribution of the invitation it admits, if any.
   */
  | { readonly admittedInvitation: boolean };

/**
 * Takes the referral locks of a payment transition, before the caller locks
 * reservation or attempt rows: the referral graph lock when the transition may
 * record an attribution, matching `acceptReferral`'s graph-then-first-booking
 * order, then the customer's first-booking lock, which serializes an invited
 * customer's first booking with acceptance and with every other payment.
 *
 * The internal payment's graph wait is bounded at five seconds and then fails
 * with the lock timeout. A signed-in checkout completes it inside the account
 * section, whose account lock is held on another connection; `acceptReferral`
 * takes the graph lock before account locks, so an unbounded wait could hang
 * both, and the bound allows the out-of-order graph lock under that section.
 * A guest payment has no section and waits within the same bound.
 */
const lockFirstBooking = Effect.fn("ReferralInvitationLedger.lockFirstBooking")(
  function* (input: {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly records: ReferralLockedAttribution;
  }) {
    const { records } = input;
    if (records !== "nothing") {
      if ("claimOf" in records) {
        if (yield* attemptRecordsReferral(records.claimOf)) {
          yield* WorkspaceLocks.referralGraph();
        }
      } else if (records.admittedInvitation) {
        yield* WorkspaceLocks.referralGraph({
          boundedWait: Duration.seconds(5),
        });
      }
    }
    yield* WorkspaceLocks.referralFirstBooking(input.dotyposCustomerId);
  }
);

/**
 * Admits a new payment for the customer's reservation. A customer is invited
 * once attributed or once a checkout referral holds their invitation; an
 * invited customer's first paid booking is admitted one attempt at a time so
 * an ordinary payment cannot race past the invitation. A payment that admits
 * an invitation fails as a claim conflict once the customer has another paid
 * booking or another admitted first booking; an ordinary payment then fails
 * with `ReferralFirstBookingAdmittedError`, or passes after a paid booking.
 * Runs under `lockFirstBooking`.
 */
const admitFirstBooking = Effect.fn(
  "ReferralInvitationLedger.admitFirstBooking"
)(function* (input: {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly admitsInvitation: boolean;
}) {
  const { db } = yield* WorkspaceTransaction;
  const [attribution] = yield* db
    .select({
      invitedDotyposCustomerId: referralAttributions.invitedDotyposCustomerId,
    })
    .from(referralAttributions)
    .where(
      eq(referralAttributions.invitedDotyposCustomerId, input.dotyposCustomerId)
    )
    .limit(1);
  const activeClaim = yield* findActiveInvitationClaim(input.dotyposCustomerId);

  if (!attribution && !activeClaim && !input.admitsInvitation) return;

  const previousPayment = yield* findOtherReservationWithPayment(
    input.dotyposCustomerId,
    input.workspaceReservationId,
    "paid"
  );

  if (previousPayment) {
    if (input.admitsInvitation) {
      return yield* new DiscountClaimError({
        operation: "reserve",
        reason: "claim_conflict",
        message:
          "Referral invitation is only available for a first paid booking.",
      });
    }
    return;
  }

  if (activeClaim) {
    return yield* firstPaymentAlreadyAdmitted(input);
  }

  const pendingPayment = yield* findOtherReservationWithPayment(
    input.dotyposCustomerId,
    input.workspaceReservationId,
    "pending"
  );
  if (pendingPayment) {
    return yield* firstPaymentAlreadyAdmitted(input);
  }
});

/**
 * Reserves the accepted invitation for the payment attempt, after re-checking
 * under the first-booking lock that the customer has not meanwhile been
 * attributed to a different referral and that the application still grants
 * the invitation benefit. Returns when the claim was reserved. An active claim
 * that wins the race for the invitation fails this one as a claim conflict;
 * the violation has aborted the caller's transaction, which rolls back.
 */
const admit = Effect.fn("ReferralInvitationLedger.admit")(function* (input: {
  readonly claim: ReferralInvitationClaim;
  readonly application: AppliedDiscount;
  readonly applicationId: DiscountApplicationId;
  readonly paymentAttemptId: PaymentAttemptId;
  readonly reservationCustomerId: DotyposCustomerId;
  readonly reservationExpiresAt: Temporal.Instant;
  readonly locale: Locale;
}) {
  const { db } = yield* WorkspaceTransaction;
  if (input.reservationCustomerId !== input.claim.invitedDotyposCustomerId) {
    return yield* DiscountClaimError.forClaim(
      "reserve",
      "customer_ineligible",
      "The referral invitation customer does not match the reservation.",
      input.claim
    );
  }

  // The first-booking lock serializes this with acceptReferral, so an
  // attribution recorded since pricing is seen here.
  const [attribution] = yield* db
    .select({
      referrerDotyposCustomerId: referralAttributions.referrerDotyposCustomerId,
      promotionCodeId: referralAttributions.promotionCodeId,
    })
    .from(referralAttributions)
    .where(
      eq(
        referralAttributions.invitedDotyposCustomerId,
        input.claim.invitedDotyposCustomerId
      )
    )
    .limit(1)
    .for("update");
  if (isAttributedToAnotherReferral(attribution, input.claim)) {
    return yield* DiscountClaimError.forClaim(
      "reserve",
      "claim_conflict",
      "The customer is attributed to a different referral.",
      input.claim
    );
  }

  if (referralInvitationBenefitChanged(input)) {
    return yield* DiscountClaimError.forClaim(
      "reserve",
      "claim_conflict",
      "The accepted referral invitation benefit changed before payment.",
      input.claim
    );
  }

  const reservedAt = Temporal.Now.instant();
  if (Temporal.Instant.compare(input.reservationExpiresAt, reservedAt) <= 0) {
    return yield* new ReferralClaimHoldEndedError({
      message:
        "Referral claims can only be reserved for a current held reservation.",
    });
  }

  yield* db
    .insert(referralInvitationClaims)
    .values({
      invitedDotyposCustomerId: input.claim.invitedDotyposCustomerId,
      referrerDotyposCustomerId: input.claim.referrerDotyposCustomerId,
      promotionCodeId: input.claim.promotionCodeId,
      applicationId: input.applicationId,
      paymentAttemptId: input.paymentAttemptId,
      state: "reserved",
      reservationExpiresAt: input.reservationExpiresAt,
      reservedAt,
      updatedAt: reservedAt,
    })
    .pipe(Effect.catchTag("EffectDrizzleQueryError", failActiveClaimConflict));
  return reservedAt;
});

/**
 * Checks, before a paid transition marks the attempt paid, that an invited
 * customer's payment is still their first paid booking and the only admitted
 * one, and that an older claim kept the attribution it relied on. An
 * uninvited booking, a redeemed claim, and an ordinary payment after a paid
 * booking pass. Runs under `lockFirstBooking`.
 */
const ensureFirstPaid = Effect.fn("ReferralInvitationLedger.ensureFirstPaid")(
  function* (input: {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly workspaceReservationId: WorkspaceReservationId;
    readonly paymentAttemptId: PaymentAttemptId;
  }) {
    const { db } = yield* WorkspaceTransaction;
    const [claim] = yield* db
      .select({
        state: referralInvitationClaims.state,
        referrerDotyposCustomerId:
          referralInvitationClaims.referrerDotyposCustomerId,
      })
      .from(referralInvitationClaims)
      .where(
        eq(referralInvitationClaims.paymentAttemptId, input.paymentAttemptId)
      )
      .limit(1)
      .for("update");
    if (claim?.state === "redeemed") return;

    const [attribution] = yield* db
      .select({
        invitedDotyposCustomerId: referralAttributions.invitedDotyposCustomerId,
      })
      .from(referralAttributions)
      .where(
        eq(
          referralAttributions.invitedDotyposCustomerId,
          input.dotyposCustomerId
        )
      )
      .limit(1);
    const otherActiveClaim = yield* findActiveInvitationClaim(
      input.dotyposCustomerId,
      input.paymentAttemptId
    );
    if (isUninvitedBooking({ attribution, claim, otherActiveClaim })) return;
    if (claimLostItsAttribution(attribution, claim)) {
      return yield* new DiscountClaimError({
        operation: "redeem",
        reason: "claim_conflict",
        message: "The accepted referral attribution is no longer available.",
      });
    }

    const previousPayment = yield* findOtherReservationWithPayment(
      input.dotyposCustomerId,
      input.workspaceReservationId,
      "paid"
    );
    if (previousPayment) {
      if (!claim) return;
      return yield* new DiscountClaimError({
        operation: "redeem",
        reason: "claim_conflict",
        message:
          "Referral invitation is only available for a first paid booking.",
      });
    }

    yield* requireNoOtherAdmittedFirstBooking(input, otherActiveClaim);
  }
);

/**
 * Redeems the payment attempt's invitation claim, if it has one, and records
 * the attribution a checkout referral claim carries; a redeemed claim stays
 * as it is. A released claim fails unless `readmitReleased`, and then redeems
 * again only while no other booking has been paid and no other claim holds
 * the invitation. The caller holds the locks `lockFirstBooking` took for the
 * paid attempt.
 */
const redeem = Effect.fn("ReferralInvitationLedger.redeem")(function* (input: {
  readonly paymentAttemptId: PaymentAttemptId;
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly redeemedAt: Temporal.Instant;
  readonly readmitReleased?: boolean;
}) {
  const { paymentAttemptId, redeemedAt } = input;
  const allowReleased = input.readmitReleased ?? false;
  const { db } = yield* WorkspaceTransaction;
  const [claim] = yield* db
    .select({
      invitedDotyposCustomerId:
        referralInvitationClaims.invitedDotyposCustomerId,
      referrerDotyposCustomerId:
        referralInvitationClaims.referrerDotyposCustomerId,
      promotionCodeId: referralInvitationClaims.promotionCodeId,
      state: referralInvitationClaims.state,
    })
    .from(referralInvitationClaims)
    .where(eq(referralInvitationClaims.paymentAttemptId, paymentAttemptId))
    .limit(1)
    .for("update");

  if (!claim || claim.state === "redeemed") return;
  if (claim.state === "released" && !allowReleased) {
    return yield* new DiscountClaimError({
      operation: "redeem",
      reason: "claim_conflict",
      message: "A released referral invitation cannot be redeemed.",
    });
  }

  if (claim.state === "released") {
    yield* requireReleasedInvitationUnconsumed({
      invitedDotyposCustomerId: claim.invitedDotyposCustomerId,
      paymentAttemptId,
      workspaceReservationId: input.workspaceReservationId,
    });
  }

  yield* db
    .update(referralInvitationClaims)
    .set({
      state: "redeemed",
      redeemedAt,
      releasedAt: null,
      releaseReason: null,
      updatedAt: redeemedAt,
    })
    .where(
      and(
        eq(referralInvitationClaims.paymentAttemptId, paymentAttemptId),
        inArray(
          referralInvitationClaims.state,
          redeemableClaimStates(allowReleased)
        )
      )
    );

  if (claim.referrerDotyposCustomerId && claim.promotionCodeId) {
    yield* recordClaimAttribution({
      invitedDotyposCustomerId: claim.invitedDotyposCustomerId,
      referrerDotyposCustomerId: claim.referrerDotyposCustomerId,
      promotionCodeId: claim.promotionCodeId,
    });
  }
});

/**
 * Releases the payment attempt's reserved invitation claim, if it has one, so
 * the invitation is free for another first booking; a released claim stays as
 * it is and a redeemed claim fails. Release has no attribution to undo.
 */
const release = Effect.fn("ReferralInvitationLedger.release")(
  function* (input: {
    readonly paymentAttemptId: PaymentAttemptId;
    readonly releasedAt: Temporal.Instant;
    readonly releaseReason: string;
  }) {
    const { paymentAttemptId, releasedAt, releaseReason } = input;
    const { db } = yield* WorkspaceTransaction;
    const [claim] = yield* db
      .select({ state: referralInvitationClaims.state })
      .from(referralInvitationClaims)
      .where(eq(referralInvitationClaims.paymentAttemptId, paymentAttemptId))
      .limit(1)
      .for("update");
    if (!claim) return;
    if (claim.state === "redeemed") {
      return yield* new DiscountClaimError({
        operation: "release",
        reason: "claim_conflict",
        message: "A redeemed referral invitation cannot be released.",
      });
    }
    if (claim.state === "released") return;

    yield* db
      .update(referralInvitationClaims)
      .set({
        state: "released",
        releasedAt,
        releaseReason,
        updatedAt: releasedAt,
      })
      .where(
        and(
          eq(referralInvitationClaims.paymentAttemptId, paymentAttemptId),
          eq(referralInvitationClaims.state, "reserved")
        )
      )
      .pipe(Effect.asVoid);
  }
);

/**
 * Referral invitation claims of payment attempts and the referral locks of
 * the payment transitions that admit, redeem or release them. Each operation
 * runs inside the caller's Workspace transaction.
 */
export const ReferralInvitationLedger = {
  lockFirstBooking,
  admitFirstBooking,
  admit,
  ensureFirstPaid,
  redeem,
  release,
};

/**
 * Whether the attempt reserved an invitation from a checkout referral, whose
 * attribution its paid transition records. Claim referral columns are
 * written once at admission, so this read is stable before any lock.
 */
const attemptRecordsReferral = Effect.fn(
  "ReferralInvitationLedger.attemptRecordsReferral"
)(function* (paymentAttemptId: PaymentAttemptId) {
  const { db } = yield* WorkspaceTransaction;
  const [claim] = yield* db
    .select({
      referrerDotyposCustomerId:
        referralInvitationClaims.referrerDotyposCustomerId,
    })
    .from(referralInvitationClaims)
    .where(eq(referralInvitationClaims.paymentAttemptId, paymentAttemptId))
    .limit(1);
  return claim?.referrerDotyposCustomerId != null;
});

const findActiveInvitationClaim = (
  dotyposCustomerId: DotyposCustomerId,
  exceptPaymentAttemptId?: PaymentAttemptId
) =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    db
      .select({ id: referralInvitationClaims.id })
      .from(referralInvitationClaims)
      .where(
        and(
          eq(
            referralInvitationClaims.invitedDotyposCustomerId,
            dotyposCustomerId
          ),
          inArray(referralInvitationClaims.state, ["reserved", "redeemed"]),
          exceptPaymentAttemptId === undefined
            ? undefined
            : ne(
                referralInvitationClaims.paymentAttemptId,
                exceptPaymentAttemptId
              )
        )
      )
      .limit(1)
      .pipe(Effect.map(([claim]) => claim))
  );

/**
 * Another payment of the invited customer holds their first booking: a
 * referral claim conflicts, an ordinary payment waits for that booking.
 */
const firstPaymentAlreadyAdmitted = (input: {
  readonly admitsInvitation: boolean;
}): Effect.Effect<
  never,
  DiscountClaimError | ReferralFirstBookingAdmittedError
> =>
  Effect.fail(
    input.admitsInvitation
      ? new DiscountClaimError({
          operation: "reserve",
          reason: "claim_conflict",
          message: "Another payment already holds this referral invitation.",
        })
      : new ReferralFirstBookingAdmittedError({
          message: "An invited customer's first payment is already admitted.",
        })
  );

/** Another of the customer's reservations in `paymentState`, if any. */
const findOtherReservationWithPayment = (
  dotyposCustomerId: DotyposCustomerId,
  workspaceReservationId: WorkspaceReservationId,
  paymentState: "paid" | "pending"
) =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    db
      .select({ id: workspaceReservations.id })
      .from(workspaceReservations)
      .where(
        and(
          eq(workspaceReservations.dotyposCustomerId, dotyposCustomerId),
          eq(workspaceReservations.paymentState, paymentState),
          ne(workspaceReservations.id, workspaceReservationId)
        )
      )
      .limit(1)
      .pipe(Effect.map(([reservation]) => reservation))
  );

type InviteeAttribution = Pick<
  typeof referralAttributions.$inferSelect,
  "invitedDotyposCustomerId"
>;
type AttemptInvitationClaim = Pick<
  typeof referralInvitationClaims.$inferSelect,
  "state" | "referrerDotyposCustomerId"
>;
type ActiveInvitationClaim = Pick<
  typeof referralInvitationClaims.$inferSelect,
  "id"
>;

/** Neither attributed nor holding an invitation: an ordinary booking. */
const isUninvitedBooking = (evidence: {
  readonly attribution: InviteeAttribution | undefined;
  readonly claim: AttemptInvitationClaim | undefined;
  readonly otherActiveClaim: ActiveInvitationClaim | undefined;
}) => !evidence.attribution && !evidence.claim && !evidence.otherActiveClaim;

/**
 * An older claim relied on an attribution accepted before payment; a
 * checkout referral claim records its own attribution when redeemed.
 */
const claimLostItsAttribution = (
  attribution: InviteeAttribution | undefined,
  claim: AttemptInvitationClaim | undefined
) =>
  !attribution &&
  claim !== undefined &&
  claim.referrerDotyposCustomerId === null;

const requireNoOtherAdmittedFirstBooking = Effect.fnUntraced(function* (
  input: {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly workspaceReservationId: WorkspaceReservationId;
  },
  otherActiveClaim: ActiveInvitationClaim | undefined
) {
  const otherPendingPayment = yield* findOtherReservationWithPayment(
    input.dotyposCustomerId,
    input.workspaceReservationId,
    "pending"
  );
  if (otherActiveClaim || otherPendingPayment) {
    return yield* new DiscountClaimError({
      operation: "redeem",
      reason: "claim_conflict",
      message: "Another first booking is already admitted for this invitee.",
    });
  }
});

/** Late recovery may redeem a released claim again; a paid transition not. */
const redeemableClaimStates = (allowReleased: boolean) =>
  allowReleased ? (["reserved", "released"] as const) : (["reserved"] as const);

/** A released invitation redeems again only for the invitee's first booking. */
const requireReleasedInvitationUnconsumed = Effect.fnUntraced(
  function* (input: {
    readonly invitedDotyposCustomerId: DotyposCustomerId;
    readonly paymentAttemptId: PaymentAttemptId;
    readonly workspaceReservationId: WorkspaceReservationId;
  }) {
    const { db } = yield* WorkspaceTransaction;
    const previousPayment = yield* findOtherReservationWithPayment(
      input.invitedDotyposCustomerId,
      input.workspaceReservationId,
      "paid"
    );
    const [otherActiveClaim] = yield* db
      .select({ id: referralInvitationClaims.id })
      .from(referralInvitationClaims)
      .where(
        and(
          eq(
            referralInvitationClaims.invitedDotyposCustomerId,
            input.invitedDotyposCustomerId
          ),
          ne(referralInvitationClaims.paymentAttemptId, input.paymentAttemptId),
          inArray(referralInvitationClaims.state, ["reserved", "redeemed"])
        )
      )
      .limit(1);
    if (previousPayment || otherActiveClaim) {
      return yield* new DiscountClaimError({
        operation: "redeem",
        reason: "claim_conflict",
        message:
          "The referral invitation was consumed by another paid booking.",
      });
    }
  }
);

/**
 * Records the attribution a checkout referral claim carries, in the
 * transaction that redeems it. The caller holds the referral graph lock. A
 * different referrer or a cycle that appeared since admission keeps the
 * existing graph; the paid booking itself is never undone.
 */
const recordClaimAttribution = Effect.fn(
  "ReferralInvitationLedger.recordClaimAttribution"
)(function* (referral: {
  readonly invitedDotyposCustomerId: DotyposCustomerId;
  readonly referrerDotyposCustomerId: DotyposCustomerId;
  readonly promotionCodeId: PromotionCodeId;
}) {
  const { db } = yield* WorkspaceTransaction;
  const graph = yield* db
    .select({
      invitedDotyposCustomerId: referralAttributions.invitedDotyposCustomerId,
      referrerDotyposCustomerId: referralAttributions.referrerDotyposCustomerId,
    })
    .from(referralAttributions);
  const decision = evaluateReferralAttribution({
    invitedCustomerId: referral.invitedDotyposCustomerId,
    referrerCustomerId: referral.referrerDotyposCustomerId,
    existingReferrerByInvitee: new Map(
      graph.map((row) => [
        row.invitedDotyposCustomerId,
        row.referrerDotyposCustomerId,
      ])
    ),
  });
  if (decision.kind === "already_accepted") return;
  if (decision.kind !== "accepted") {
    yield* Effect.logWarning(
      "Paid referral invitation kept the existing referral graph",
      { reason: decision.kind }
    );
    return;
  }
  yield* db.insert(referralAttributions).values(referral);
});

const activeClaimConstraints = new Set([
  "referral_invitation_claims_active_customer_unique_idx",
  "referral_invitation_claims_application_unique_idx",
  "referral_invitation_claims_attempt_unique_idx",
]);

/**
 * Reports a claim that lost the race for an active referral invitation claim
 * as a claim conflict. The violation has aborted the caller's transaction,
 * which rolls back.
 */
const failActiveClaimConflict = <E extends DatabaseQueryError>(cause: E) =>
  Effect.fail(
    findViolatedConstraint(cause).pipe(
      Option.exists((constraint) => activeClaimConstraints.has(constraint))
    )
      ? new DiscountClaimError({
          operation: "reserve",
          reason: "claim_conflict",
          message: "The discount code was claimed by another payment attempt.",
          cause,
        })
      : cause
  );
