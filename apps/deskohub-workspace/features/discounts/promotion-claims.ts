import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq, inArray } from "drizzle-orm";
import { Data, Effect, Match, Option, Result } from "effect";
import { WorkspaceTransaction } from "@/db/database.service";
import {
  discountApplications,
  discountCodeRedemptions,
  discountCodes,
  discountProductTargets,
  discounts,
  promotionCodes,
  voucherRedemptions,
  vouchers,
} from "@/db/schema";
import {
  type DatabaseQueryError,
  findViolatedConstraint,
} from "@/db/sql-constraint";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { Locale } from "@/features/i18n";
import { type Money, sameMoneyUnit } from "@/shared/money/money";
import type { AppliedDiscount } from "./contracts";
import { decodeDiscountDefinition } from "./discount-definition";
import { discountLabelFor } from "./discount-label";
import { DiscountClaimError } from "./errors";
import type {
  DiscountApplicationId,
  DiscountCodeId,
  VoucherId,
} from "./persistence-contracts";
import { getWorkspaceProductTargetsCovering } from "./product-target";
import {
  evaluatePromotionAvailability,
  getAvailableVoucherCredit,
  type PromotionAvailabilityFacts,
  type PromotionAvailabilityStage,
  type PromotionUnavailable,
} from "./promotion-availability";
import {
  discountAdjustmentsEqual,
  promotionTimingChanged,
  voucherCreditChanged,
  voucherPresentationChanged,
} from "./promotion-claim-benefits";
import { getPromotionTiming } from "./promotion-code";
import {
  readDiscountCodeUses,
  readPromotionAudience,
  readVoucherUses,
} from "./promotion-code.repository-query";
import type { DiscountClaimInstruction } from "./provider";

// The discount-code and voucher claim ledger: the only writer of
// `discount_code_redemptions` and `voucher_redemptions`. Each operation is
// one step of its caller's Workspace transaction, which owns the advisory
// locks and the order of the steps around it; every row lock here lasts
// until that transaction ends. Referral invitation claims keep their own
// ledger.

/** A discount-code or voucher claim, as a payment commitment carries it. */
export type PromotionClaim = Exclude<
  DiscountClaimInstruction,
  { readonly kind: "referral_invitation" }
>;

/**
 * The reservation hold the claim would expire with ended before admission.
 * The caller reports it in its own terms.
 */
class PromotionClaimHoldEndedError extends Data.TaggedError(
  "PromotionClaimHoldEndedError"
)<{
  readonly message: string;
}> {}

/**
 * Reserves the accepted code or voucher for the payment attempt, after
 * locking it with its promotion and re-checking, against the stored rows, that
 * the promotion is still available to the customer and still grants the
 * accepted benefit. Returns when the claim was reserved.
 */
const admit = Effect.fn("PromotionClaims.admit")(function* (input: {
  readonly claim: PromotionClaim;
  readonly application: AppliedDiscount;
  readonly applicationId: DiscountApplicationId;
  readonly paymentAttemptId: PaymentAttemptId;
  readonly locale: Locale;
  readonly reservationCustomerId: DotyposCustomerId;
  readonly reservationExpiresAt: Temporal.Instant;
  readonly firstServiceDate: string;
}) {
  if (input.reservationCustomerId !== input.claim.dotyposCustomerId) {
    return yield* DiscountClaimError.forClaim(
      "reserve",
      "customer_ineligible",
      "The discount-code claim customer does not match the reservation.",
      input.claim
    );
  }

  const stored = yield* requireStoredPromotion(
    yield* lockClaimedPromotion(input.claim),
    input.claim
  );
  yield* requireClaimAvailable(input.claim, "admissionEnabled", {
    promotion: stored.promotion,
  });

  const claimedAt = Temporal.Now.instant();
  yield* requireCurrentHold(input, claimedAt);
  yield* Match.value(stored).pipe(
    Match.discriminatorsExhaustive("kind")({
      discount_code: ({ claim, code, promotion }) =>
        requireClaimAvailable(claim, "admissionDiscountCodeSchedule", {
          at: claimedAt,
          discountCode: code,
          firstServiceDate: input.firstServiceDate,
          promotion,
        }),
      voucher: ({ claim, promotion }) =>
        requireClaimAvailable(claim, "admissionVoucherSchedule", {
          at: claimedAt,
          promotion,
        }),
    })
  );

  const { db } = yield* WorkspaceTransaction;
  yield* requireClaimAvailable(input.claim, "admissionAudience", {
    audience: yield* readPromotionAudience({
      db,
      promotionCodeId: stored.promotion.id,
      dotyposCustomerId: input.claim.dotyposCustomerId,
    }),
  });

  yield* Match.value(stored).pipe(
    Match.discriminatorsExhaustive("kind")({
      discount_code: Effect.fnUntraced(function* ({ claim, code, promotion }) {
        yield* validateStoredDiscountClaim({
          ...input,
          claim,
          code,
          promotion,
        });
        const uses = yield* readDiscountCodeUses({
          db,
          codeId: code.id,
          dotyposCustomerId: claim.dotyposCustomerId,
        });
        yield* requireClaimAvailable(claim, "admissionDiscountCodeUses", {
          discountCode: code,
          uses,
        });
      }),
      voucher: Effect.fnUntraced(function* ({ claim, voucher, promotion }) {
        const voucherUses = yield* validateVoucherClaim({
          ...input,
          claim,
          voucher,
          promotion,
        });
        yield* requireClaimAvailable(claim, "admissionVoucherUses", {
          voucherUses,
        });
      }),
    })
  );

  yield* insertPromotionClaim(stored, {
    applicationId: input.applicationId,
    paymentAttemptId: input.paymentAttemptId,
    dotyposCustomerId: input.claim.dotyposCustomerId,
    state: "reserved" as const,
    reservationExpiresAt: input.reservationExpiresAt,
    reservedAt: claimedAt,
    updatedAt: claimedAt,
  });
  return claimedAt;
});

/**
 * Redeems the payment attempt's code or voucher claim, if it has one; a
 * redeemed claim stays as it is. A released claim fails unless
 * `readmitReleased`, and then redeems again only while the code's use limits
 * or the voucher's remaining credit still allow it.
 */
const redeem = Effect.fn("PromotionClaims.redeem")(function* (input: {
  readonly paymentAttemptId: PaymentAttemptId;
  readonly redeemedAt: Temporal.Instant;
  readonly readmitReleased?: boolean;
}) {
  const allowReleased = input.readmitReleased ?? false;
  const claim = yield* lockAttemptPromotionClaim(input.paymentAttemptId);

  if (!claim) return;
  if (claim.state === "released" && !allowReleased) {
    return yield* new DiscountClaimError({
      operation: "redeem",
      reason: "claim_conflict",
      message: "A released promotion claim cannot be redeemed.",
      codeId: claim.id,
    });
  }
  if (claim.state === "redeemed") return;
  if (claim.state === "released") {
    yield* Match.value(claim).pipe(
      Match.discriminatorsExhaustive("kind")({
        discount: requireReleasedCodeRedeemable,
        voucher: requireReleasedVoucherRedeemable,
      })
    );
  }

  yield* markPromotionClaimRedeemed({
    claim,
    paymentAttemptId: input.paymentAttemptId,
    redeemedAt: input.redeemedAt,
    allowReleased,
  });
});

/**
 * Releases the payment attempt's reserved code or voucher claim, if it has
 * one, so its use or credit counts no more; a released claim stays as it is
 * and a redeemed claim fails, unless `reversesRedemption` gives a redeemed
 * claim back too, as a customer's full withdrawal from the paid contract
 * does. A reversed claim keeps its redemption time.
 */
const release = Effect.fn("PromotionClaims.release")(function* (input: {
  readonly paymentAttemptId: PaymentAttemptId;
  readonly releasedAt: Temporal.Instant;
  readonly releaseReason: string;
  readonly reversesRedemption?: boolean;
}) {
  const { db } = yield* WorkspaceTransaction;
  const [discountClaims, voucherClaims] = yield* Effect.all([
    db
      .select({
        id: discountCodeRedemptions.codeId,
        state: discountCodeRedemptions.state,
      })
      .from(discountCodeRedemptions)
      .where(
        eq(discountCodeRedemptions.paymentAttemptId, input.paymentAttemptId)
      )
      .limit(1)
      .for("update"),
    db
      .select({
        id: voucherRedemptions.voucherId,
        state: voucherRedemptions.state,
      })
      .from(voucherRedemptions)
      .where(eq(voucherRedemptions.paymentAttemptId, input.paymentAttemptId))
      .limit(1)
      .for("update"),
  ]);
  const claim = selectStoredPromotionClaim(discountClaims[0], voucherClaims[0]);

  if (!claim) return;
  if (claim.state === "redeemed" && !input.reversesRedemption) {
    return yield* new DiscountClaimError({
      operation: "release",
      reason: "claim_conflict",
      message: "A redeemed promotion claim cannot be released.",
      codeId: claim.id,
    });
  }
  if (claim.state === "released") return;
  const releasable = claim.state;

  const values = {
    state: "released" as const,
    releasedAt: input.releasedAt,
    releaseReason: input.releaseReason,
    updatedAt: input.releasedAt,
  };
  yield* Match.value(claim).pipe(
    Match.discriminatorsExhaustive("kind")({
      discount: () =>
        db
          .update(discountCodeRedemptions)
          .set(values)
          .where(
            and(
              eq(
                discountCodeRedemptions.paymentAttemptId,
                input.paymentAttemptId
              ),
              eq(discountCodeRedemptions.state, releasable)
            )
          )
          .pipe(Effect.asVoid),
      voucher: () =>
        db
          .update(voucherRedemptions)
          .set(values)
          .where(
            and(
              eq(voucherRedemptions.paymentAttemptId, input.paymentAttemptId),
              eq(voucherRedemptions.state, releasable)
            )
          )
          .pipe(Effect.asVoid),
    })
  );
});

/**
 * Discount-code and voucher claims of payment attempts. Each operation runs
 * inside the caller's Workspace transaction.
 */
export const PromotionClaims = { admit, redeem, release };

type StoredPromotion =
  | {
      readonly kind: "discount_code";
      readonly claim: Extract<
        PromotionClaim,
        { readonly kind: "discount_code" }
      >;
      readonly promotion: typeof promotionCodes.$inferSelect;
      readonly code: typeof discountCodes.$inferSelect;
    }
  | {
      readonly kind: "voucher";
      readonly claim: Extract<PromotionClaim, { readonly kind: "voucher" }>;
      readonly promotion: typeof promotionCodes.$inferSelect;
      readonly voucher: typeof vouchers.$inferSelect;
    };

/** Locks the claimed code or voucher with its promotion. */
const lockClaimedPromotion = Effect.fnUntraced(function* (
  claim: PromotionClaim
) {
  const { db } = yield* WorkspaceTransaction;
  return yield* Match.value(claim).pipe(
    Match.discriminatorsExhaustive("kind")({
      discount_code: Effect.fn(function* (claim) {
        const rows = yield* db
          .select({ promotion: promotionCodes, code: discountCodes })
          .from(discountCodes)
          .innerJoin(
            promotionCodes,
            eq(promotionCodes.id, discountCodes.promotionCodeId)
          )
          .where(eq(discountCodes.id, claim.codeId))
          .limit(1)
          .for("update");
        return rows[0]
          ? ({ kind: "discount_code", claim, ...rows[0] } as const)
          : undefined;
      }),
      voucher: Effect.fn(function* (claim) {
        const rows = yield* db
          .select({ promotion: promotionCodes, voucher: vouchers })
          .from(vouchers)
          .innerJoin(
            promotionCodes,
            eq(promotionCodes.id, vouchers.promotionCodeId)
          )
          .where(eq(vouchers.id, claim.voucherId))
          .limit(1)
          .for("update");
        return rows[0]
          ? ({ kind: "voucher", claim, ...rows[0] } as const)
          : undefined;
      }),
    })
  );
});

/** The claimed promotion still exists and grants the accepted benefit. */
const requireStoredPromotion = (
  stored: StoredPromotion | undefined,
  claim: PromotionClaim
): Effect.Effect<StoredPromotion, DiscountClaimError> =>
  !stored ||
  (stored.kind === "discount_code" &&
    stored.code.discountId !== stored.claim.storedDiscountId)
    ? Effect.fail(
        DiscountClaimError.forClaim(
          "reserve",
          "unknown_code",
          "The accepted promotion no longer exists.",
          claim
        )
      )
    : Effect.succeed(stored);

/** The hold is still current when the claim is made. */
const requireCurrentHold = (
  input: { readonly reservationExpiresAt: Temporal.Instant },
  claimedAt: Temporal.Instant
): Effect.Effect<void, PromotionClaimHoldEndedError> =>
  Temporal.Instant.compare(input.reservationExpiresAt, claimedAt) <= 0
    ? Effect.fail(
        new PromotionClaimHoldEndedError({
          message:
            "Discount claims can only be reserved for a current held reservation.",
        })
      )
    : Effect.void;

type AdmissionStage = Extract<PromotionAvailabilityStage, `admission${string}`>;

const admissionUnavailableMessages = {
  enabled: "The accepted promotion is inactive.",
  started: "The accepted promotion is not valid yet.",
  unexpired: "The accepted promotion has expired.",
  serviceDates:
    "The accepted discount code no longer covers the reservation start date.",
  audience: "The customer is no longer eligible for the accepted promotion.",
  customerUses: "The customer has no remaining uses for this discount code.",
  totalUses: "The accepted discount code has no remaining uses.",
  voucherUnclaimed:
    "The customer already has an active claim for this voucher.",
} satisfies Record<PromotionUnavailable<AdmissionStage>["rule"], string>;

/** The claimed promotion is still available to the claim's customer. */
const requireClaimAvailable = <Stage extends AdmissionStage>(
  claim: PromotionClaim,
  stage: Stage,
  facts: PromotionAvailabilityFacts<Stage>
): Effect.Effect<void, DiscountClaimError> =>
  Result.match(evaluatePromotionAvailability(stage, facts), {
    onSuccess: () => Effect.void,
    onFailure: ({ reason, rule }) =>
      Effect.fail(
        DiscountClaimError.forClaim(
          "reserve",
          reason,
          admissionUnavailableMessages[rule],
          claim
        )
      ),
  });

const getVoucherIssuedAmount = (
  voucher: typeof vouchers.$inferSelect
): Money => ({
  value: voucher.issuedAmountValue,
  exponent: voucher.issuedAmountExponent,
  currency: voucher.issuedAmountCurrency,
});

const insertPromotionClaim = Effect.fnUntraced(function* (
  stored: StoredPromotion,
  claimValues: {
    readonly applicationId: DiscountApplicationId;
    readonly paymentAttemptId: PaymentAttemptId;
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly state: "reserved";
    readonly reservationExpiresAt: Temporal.Instant;
    readonly reservedAt: Temporal.Instant;
    readonly updatedAt: Temporal.Instant;
  }
) {
  const { db } = yield* WorkspaceTransaction;
  yield* Match.value(stored).pipe(
    Match.discriminatorsExhaustive("kind")({
      discount_code: ({ code }) =>
        db
          .insert(discountCodeRedemptions)
          .values({
            ...claimValues,
            codeId: code.id,
          })
          .pipe(Effect.asVoid),
      voucher: ({ voucher }) =>
        db
          .insert(voucherRedemptions)
          .values({
            ...claimValues,
            voucherId: voucher.id,
          })
          .pipe(Effect.asVoid),
    }),
    Effect.catchTag("EffectDrizzleQueryError", failActiveClaimConflict)
  );
});

const activeClaimConstraints = new Set([
  "discount_code_redemptions_application_unique_idx",
  "discount_code_redemptions_attempt_unique_idx",
  "voucher_redemptions_active_customer_unique_idx",
  "voucher_redemptions_application_unique_idx",
  "voucher_redemptions_attempt_unique_idx",
]);

/**
 * Reports a claim that lost the race for an active discount or voucher claim
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

const validateStoredDiscountClaim = Effect.fn(
  "PromotionClaims.validateStoredDiscountClaim"
)(function* (input: {
  readonly claim: Extract<PromotionClaim, { readonly kind: "discount_code" }>;
  readonly code: typeof discountCodes.$inferSelect;
  readonly promotion: typeof promotionCodes.$inferSelect;
  readonly application: AppliedDiscount;
  readonly locale: Locale;
}) {
  const { db } = yield* WorkspaceTransaction;
  const [definition] = yield* db
    .select()
    .from(discounts)
    .where(eq(discounts.id, input.claim.storedDiscountId))
    .limit(1)
    .for("update");
  if (!definition) {
    return yield* DiscountClaimError.forClaim(
      "reserve",
      "unknown_code",
      "The accepted discount benefit no longer exists.",
      input.claim
    );
  }

  const [target] = yield* db
    .select({
      discountId: discountProductTargets.discountId,
      productTarget: discountProductTargets.productTarget,
    })
    .from(discountProductTargets)
    .where(
      and(
        eq(discountProductTargets.discountId, input.claim.storedDiscountId),
        inArray(discountProductTargets.productTarget, [
          ...getWorkspaceProductTargetsCovering(input.claim.product),
        ])
      )
    )
    .limit(1)
    .for("update");
  if (!target) {
    return yield* DiscountClaimError.forClaim(
      "reserve",
      "product_ineligible",
      "The accepted discount code no longer targets this product.",
      input.claim
    );
  }

  const currentDefinition = yield* decodeDiscountDefinition({
    row: {
      ...definition,
      productTargets: [
        {
          discountId: target.discountId,
          productTarget: target.productTarget,
        },
      ],
    },
  }).pipe(
    Effect.mapError(
      (cause) =>
        new DiscountClaimError({
          operation: "reserve",
          reason: "malformed_configuration",
          message: "The accepted discount benefit is malformed.",
          codeId: input.claim.codeId,
          cause,
        })
    )
  );
  const timing = getPromotionTiming(input.promotion.validUntil);
  if (
    !discountAdjustmentsEqual(
      currentDefinition.adjustment,
      input.application.discount.adjustment
    ) ||
    discountLabelFor(currentDefinition.labels, input.locale) !==
      input.application.discount.label ||
    promotionTimingChanged(timing, input.application.discount)
  ) {
    return yield* DiscountClaimError.forClaim(
      "reserve",
      "claim_conflict",
      "The accepted discount benefit changed before claim admission.",
      input.claim
    );
  }
});

const validateVoucherClaim = Effect.fn("PromotionClaims.validateVoucherClaim")(
  function* (input: {
    readonly claim: Extract<PromotionClaim, { readonly kind: "voucher" }>;
    readonly voucher: typeof vouchers.$inferSelect;
    readonly promotion: typeof promotionCodes.$inferSelect;
    readonly application: AppliedDiscount;
    readonly locale: Locale;
  }) {
    const { db } = yield* WorkspaceTransaction;
    const voucherUses = yield* readVoucherUses({
      db,
      voucherId: input.claim.voucherId,
      dotyposCustomerId: input.claim.dotyposCustomerId,
    });
    const availableAmount = getAvailableVoucherCredit(
      getVoucherIssuedAmount(input.voucher),
      voucherUses.usedValue
    );
    const timing = getPromotionTiming(input.promotion.validUntil);
    if (
      voucherCreditChanged({ ...input, availableAmount }) ||
      voucherPresentationChanged({ ...input, timing })
    ) {
      return yield* DiscountClaimError.forClaim(
        "reserve",
        "claim_conflict",
        "The accepted voucher credit changed before claim admission.",
        input.claim
      );
    }
    return voucherUses;
  }
);

/** Locks the attempt's discount-code or voucher claim, if it has one. */
const lockAttemptPromotionClaim = Effect.fnUntraced(function* (
  paymentAttemptId: PaymentAttemptId
) {
  const { db } = yield* WorkspaceTransaction;
  const [discountClaims, voucherClaims] = yield* Effect.all([
    db
      .select({
        dotyposCustomerId: discountCodeRedemptions.dotyposCustomerId,
        id: discountCodeRedemptions.codeId,
        state: discountCodeRedemptions.state,
      })
      .from(discountCodeRedemptions)
      .where(eq(discountCodeRedemptions.paymentAttemptId, paymentAttemptId))
      .limit(1)
      .for("update"),
    db
      .select({
        applicationId: voucherRedemptions.applicationId,
        dotyposCustomerId: voucherRedemptions.dotyposCustomerId,
        id: voucherRedemptions.voucherId,
        state: voucherRedemptions.state,
      })
      .from(voucherRedemptions)
      .where(eq(voucherRedemptions.paymentAttemptId, paymentAttemptId))
      .limit(1)
      .for("update"),
  ]);
  return selectStoredPromotionClaim(discountClaims[0], voucherClaims[0]);
});

/** A released code claim redeems again only within the code's limits. */
const requireReleasedCodeRedeemable = Effect.fnUntraced(function* (claim: {
  readonly id: DiscountCodeId;
  readonly dotyposCustomerId: DotyposCustomerId;
}) {
  const { db } = yield* WorkspaceTransaction;
  const [code] = yield* db
    .select({
      maxUses: discountCodes.maxUses,
      maxUsesPerCustomer: discountCodes.maxUsesPerCustomer,
    })
    .from(discountCodes)
    .where(eq(discountCodes.id, claim.id))
    .limit(1)
    .for("update");
  if (!code) {
    return yield* new DiscountClaimError({
      operation: "redeem",
      reason: "unknown_code",
      message: "The accepted discount code no longer exists.",
      codeId: claim.id,
    });
  }

  const uses = yield* readDiscountCodeUses({
    db,
    codeId: claim.id,
    dotyposCustomerId: claim.dotyposCustomerId,
  });
  yield* Result.match(
    evaluatePromotionAvailability("readmissionDiscountCodeUses", {
      discountCode: code,
      uses,
    }),
    {
      onSuccess: () => Effect.void,
      onFailure: ({ reason, rule }) =>
        Effect.fail(
          new DiscountClaimError({
            operation: "redeem",
            reason,
            message: readmissionUnavailableMessages[rule],
            codeId: claim.id,
          })
        ),
    }
  );
});

const readmissionUnavailableMessages = {
  customerUses: "The customer has no remaining uses for this code.",
  totalUses: "The accepted discount code has no remaining uses.",
} satisfies Record<
  PromotionUnavailable<"readmissionDiscountCodeUses">["rule"],
  string
>;

/** A released voucher claim redeems again only while the credit lasts. */
const requireReleasedVoucherRedeemable = Effect.fnUntraced(function* (claim: {
  readonly id: VoucherId;
  readonly applicationId: DiscountApplicationId;
  readonly dotyposCustomerId: DotyposCustomerId;
}) {
  const { db } = yield* WorkspaceTransaction;
  const [voucher] = yield* db
    .select()
    .from(vouchers)
    .where(eq(vouchers.id, claim.id))
    .limit(1)
    .for("update");
  if (!voucher) {
    return yield* new DiscountClaimError({
      operation: "redeem",
      reason: "unknown_code",
      message: "The accepted voucher no longer exists.",
      codeId: claim.id,
    });
  }

  const issuedAmount = getVoucherIssuedAmount(voucher);
  const [[application], voucherUses] = yield* Effect.all([
    db
      .select({
        currency: discountApplications.appliedAmountCurrency,
        exponent: discountApplications.appliedAmountExponent,
        value: discountApplications.appliedAmountValue,
      })
      .from(discountApplications)
      .where(eq(discountApplications.id, claim.applicationId))
      .limit(1),
    readVoucherUses({
      db,
      voucherId: claim.id,
      dotyposCustomerId: claim.dotyposCustomerId,
    }),
  ]);
  if (
    !application ||
    !sameMoneyUnit(application, issuedAmount) ||
    application.value >
      getAvailableVoucherCredit(issuedAmount, voucherUses.usedValue).value
  ) {
    return yield* new DiscountClaimError({
      operation: "redeem",
      reason: "claim_conflict",
      message: "The voucher no longer has enough available credit.",
      codeId: claim.id,
    });
  }
});

const markPromotionClaimRedeemed = Effect.fnUntraced(function* (input: {
  readonly claim: { readonly kind: "discount" | "voucher" };
  readonly paymentAttemptId: PaymentAttemptId;
  readonly redeemedAt: Temporal.Instant;
  readonly allowReleased: boolean;
}) {
  const { db } = yield* WorkspaceTransaction;
  const values = {
    state: "redeemed" as const,
    redeemedAt: input.redeemedAt,
    releasedAt: null,
    releaseReason: null,
    updatedAt: input.redeemedAt,
  };
  const claimableStates = input.allowReleased
    ? (["reserved", "released"] as const)
    : (["reserved"] as const);
  yield* Match.value(input.claim).pipe(
    Match.discriminatorsExhaustive("kind")({
      discount: () =>
        db
          .update(discountCodeRedemptions)
          .set(values)
          .where(
            and(
              eq(
                discountCodeRedemptions.paymentAttemptId,
                input.paymentAttemptId
              ),
              inArray(discountCodeRedemptions.state, claimableStates)
            )
          )
          .pipe(Effect.asVoid),
      voucher: () =>
        db
          .update(voucherRedemptions)
          .set(values)
          .where(
            and(
              eq(voucherRedemptions.paymentAttemptId, input.paymentAttemptId),
              inArray(voucherRedemptions.state, claimableStates)
            )
          )
          .pipe(Effect.asVoid),
    })
  );
});

const selectStoredPromotionClaim = <
  DiscountClaim extends { readonly id: DiscountCodeId; readonly state: string },
  VoucherClaim extends { readonly id: VoucherId; readonly state: string },
>(
  discountClaim: DiscountClaim | undefined,
  voucherClaim: VoucherClaim | undefined
) => {
  if (discountClaim) return { kind: "discount", ...discountClaim } as const;
  if (voucherClaim) return { kind: "voucher", ...voucherClaim } as const;
  return undefined;
};
