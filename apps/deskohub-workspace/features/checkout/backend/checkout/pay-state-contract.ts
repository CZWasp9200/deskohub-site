import { Schema } from "effect";
import type { RequireAllOrNone } from "type-fest";
import {
  checkoutSessionIdSchema,
  type PaymentAttemptId,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import {
  type CheckoutSummaryChangedKeys,
  checkoutSummaryChangedKeysSchema,
} from "@/features/checkout/checkout-summary";
import {
  type CanonicalPromotionCode,
  canonicalPromotionCodeSchema,
  type DiscountId,
  discountIdSchema,
} from "@/features/discounts/contracts";
import type { Locale } from "@/features/i18n";
import { locales } from "@/features/i18n";
import { isEndedUnpaidPaymentState } from "@/features/order";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { sealedStateKeyIdSchema } from "@/shared/backend/sealed-state";
import { nonNegativeMoneyCodec } from "@/shared/money/money";
import {
  type Instant,
  instantStringSchema,
  unixTimestampSecondsSchema,
} from "@/shared/utils/temporal";

export const signedPayStateEnvelopeSchema = Schema.Struct({
  kid: sealedStateKeyIdSchema,
  iat: unixTimestampSecondsSchema,
  exp: unixTimestampSecondsSchema,
  locale: Schema.Literals(locales),
  orderId: workspaceReservationIdSchema,
  bookedAt: instantStringSchema,
  /**
   * When the order's reservation hold ends: its stored deadline, copied into
   * every reissue. Tokens issued before the claim existed lack it; their
   * deadline is read from the reservation.
   */
  holdExpiresAt: Schema.optional(instantStringSchema),
  checkoutSessionId: Schema.optional(checkoutSessionIdSchema),
  /**
   * `order`: issued for an existing order (a payment retry) and accepted
   * while that order is still the current one of its checkout session,
   * without the session's raw id. Absent: bound to `checkoutSessionId`.
   */
  binding: Schema.optional(Schema.Literal("order")),
  /**
   * The attempt whose ended payment an order-bound state retries; present
   * exactly when `binding` is `order`. The state pays only while the order
   * awaits that retry (no attempt active), so it can't start a second payment
   * after the retry's own.
   */
  retriedAttemptId: Schema.optional(paymentAttemptIdSchema),
  acceptedTotal: nonNegativeMoneyCodec,
  submittedCode: Schema.optional(canonicalPromotionCodeSchema),
  submittedCodeDiscountId: Schema.optional(discountIdSchema),
  requestedDiscountCode: Schema.optional(canonicalPromotionCodeSchema),
  /**
   * Referral code applied for this order. It prices the invitation while it
   * stays eligible, and its attribution is recorded only when the order is
   * paid.
   */
  referralCode: Schema.optional(canonicalPromotionCodeSchema),
  changedKeys: Schema.optional(checkoutSummaryChangedKeysSchema),
});

export type SignedPayStateEnvelope = typeof signedPayStateEnvelopeSchema.Type;

export type BuildSignedPayStateBindingInput = {
  readonly checkoutSessionId?: typeof checkoutSessionIdSchema.Type;
  /**
   * `order` binds the state to `orderId` alone, for a payment retry; it
   * excludes `checkoutSessionId` (building such a state fails).
   */
  readonly binding?: "order";
  /** The attempt an order-bound state retries; required with `binding`. */
  readonly retriedAttemptId?: PaymentAttemptId;
};

type BuildSignedPayStateBaseInput = BuildSignedPayStateBindingInput & {
  readonly locale: Locale;
  readonly orderId: typeof workspaceReservationIdSchema.Type;
  /** Moment the reservation was submitted; calendar sales are evaluated at it. */
  readonly bookedAt: Instant;
  /** The reservation's stored hold deadline; reissuing never moves it. */
  readonly holdExpiresAt: Instant;
  readonly requestedDiscountCode?: CanonicalPromotionCode;
  readonly referralCode?: CanonicalPromotionCode;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
  readonly ttlMilliseconds?: number;
};

export type PayStateSubmittedCodeMetadata = RequireAllOrNone<{
  readonly submittedCode: CanonicalPromotionCode;
  readonly submittedCodeDiscountId: DiscountId;
}>;

export const getSubmittedCodeMetadata = (input: {
  readonly submittedCode?: CanonicalPromotionCode;
  readonly submittedCodeDiscountId?: DiscountId;
}): PayStateSubmittedCodeMetadata =>
  input.submittedCode !== undefined &&
  input.submittedCodeDiscountId !== undefined
    ? {
        submittedCode: input.submittedCode,
        submittedCodeDiscountId: input.submittedCodeDiscountId,
      }
    : {};

export type BuildSignedPayStateCommonInput = BuildSignedPayStateBaseInput &
  PayStateSubmittedCodeMetadata;

export const buildSignedPayStateEnvelope = (
  envelope: Omit<
    SignedPayStateEnvelope,
    | "acceptedTotal"
    | "checkoutSessionId"
    | "binding"
    | "retriedAttemptId"
    | "submittedCode"
    | "submittedCodeDiscountId"
    | "requestedDiscountCode"
    | "referralCode"
    | "changedKeys"
  >,
  input: BuildSignedPayStateCommonInput,
  acceptedTotal: SignedPayStateEnvelope["acceptedTotal"]
): SignedPayStateEnvelope => ({
  ...envelope,
  acceptedTotal,
  ...(input.checkoutSessionId !== undefined && {
    checkoutSessionId: input.checkoutSessionId,
  }),
  ...(input.binding !== undefined && { binding: input.binding }),
  ...(input.retriedAttemptId !== undefined && {
    retriedAttemptId: input.retriedAttemptId,
  }),
  ...(input.submittedCode !== undefined && {
    submittedCode: input.submittedCode,
  }),
  ...(input.submittedCodeDiscountId !== undefined && {
    submittedCodeDiscountId: input.submittedCodeDiscountId,
  }),
  ...(input.requestedDiscountCode !== undefined && {
    requestedDiscountCode: input.requestedDiscountCode,
  }),
  ...(input.referralCode !== undefined && {
    referralCode: input.referralCode,
  }),
  ...(input.changedKeys !== undefined && {
    changedKeys: {
      sectionKeys: [...input.changedKeys.sectionKeys],
      itemKeys: [...input.changedKeys.itemKeys],
    },
  }),
});

export type PayStateBinding =
  | {
      readonly kind: "session";
      readonly checkoutSessionId: typeof checkoutSessionIdSchema.Type;
    }
  | {
      readonly kind: "order";
      readonly retriedAttemptId: PaymentAttemptId;
    };

type PayStateBindingFields = Pick<
  SignedPayStateEnvelope,
  "binding" | "checkoutSessionId" | "retriedAttemptId"
>;

/**
 * The order a Pay state may pay, or `undefined` when it names neither a
 * session nor an order binding, or a contradictory one (such a state pays
 * nothing).
 */
export const getPayStateBinding = (
  state: PayStateBindingFields
): PayStateBinding | undefined => {
  if (state.binding === "order") {
    return state.checkoutSessionId === undefined &&
      state.retriedAttemptId !== undefined
      ? { kind: "order", retriedAttemptId: state.retriedAttemptId }
      : undefined;
  }
  return state.checkoutSessionId === undefined ||
    state.retriedAttemptId !== undefined
    ? undefined
    : { kind: "session", checkoutSessionId: state.checkoutSessionId };
};

/**
 * Why the state may no longer start the order's payment, or `undefined`
 * while it may. A session state stops once the order's payment ended
 * (`payment_ended`): paying again goes through a payment retry, which first
 * asks the provider whether the ended payment can still settle. An
 * order-bound state pays only while its order awaits that retry: no attempt
 * is active and the attempt it retries is still the order's newest
 * (`retried_attempt_replaced` otherwise), so a state from an earlier retry
 * never pays after a later one.
 */
export const findPayStateAttemptRefusal = (
  binding: PayStateBinding,
  order: {
    readonly activePaymentAttemptId: string | null;
    readonly paymentState: string;
  },
  newestAttemptId: string | null
): "payment_ended" | "retried_attempt_replaced" | undefined => {
  if (binding.kind === "session") {
    return isEndedUnpaidPaymentState(order.paymentState)
      ? "payment_ended"
      : undefined;
  }
  return order.activePaymentAttemptId === null &&
    newestAttemptId === binding.retriedAttemptId
    ? undefined
    : "retried_attempt_replaced";
};

/** A Pay state issued to retry the payment of one existing order. */
export const isOrderBoundPayState = (state: PayStateBindingFields) =>
  getPayStateBinding(state)?.kind === "order";

/**
 * The binding a state issued from `state` keeps: its checkout session, or
 * its order for a payment retry. Every reissue (price review, discount code,
 * referral) spreads it instead of naming `checkoutSessionId`.
 */
export const getPayStateBindingInput = (
  state: PayStateBindingFields
): BuildSignedPayStateBindingInput => ({
  ...(state.checkoutSessionId !== undefined && {
    checkoutSessionId: state.checkoutSessionId,
  }),
  ...(state.binding !== undefined && { binding: state.binding }),
  ...(state.retriedAttemptId !== undefined && {
    retriedAttemptId: state.retriedAttemptId,
  }),
});
