import { randomUUID } from "node:crypto";
import { Effect, Match, Option, Schema } from "effect";
import type { DiscountCodeRejection } from "@/features/checkout/discount-code-rejection";
import {
  type CanonicalPromotionCode,
  type DiscountId,
  DiscountProviderError,
  normalizeSubmittedPromotionCode,
} from "@/features/discounts";
import { ReferralService } from "@/features/referrals";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import {
  type DotyposCustomerId,
  dotyposCustomerIdSchema,
} from "@/features/reservation/dotypos-customer";
import { getCalendarActionDeadline } from "@/shared/backend/calendar-action-deadline";
import type { DeploymentEnvironment } from "@/shared/deployment/deployment-stage";
import {
  buildCheckoutPayPathFromToken,
  type FreshPayState,
  getPayStateExpiresAt,
  issueFreshPayState,
  type NoFreshPayState,
  toFreshPayState,
} from "./checkout-pay-url";
import { CheckoutPricingService } from "./checkout-pricing.service";
import {
  type CheckoutReferralResult,
  CheckoutReferralService,
} from "./checkout-referral.service";
import { openPayStateForLocale } from "./open-pay-state-for-locale";
import type { PayStateWithHoldExpiry, SignedPayState } from "./pay-state";
import { getSignedPayStateBookedAt } from "./pay-state.server";
import type {
  ApplyDiscountCodeInput,
  ClearDiscountCodeInput,
} from "./pay-state-discount-code-input";
import {
  getPayStateHoldExpiresAt,
  loadPayStateHoldExpiry,
  withPayStateHoldExpiry,
} from "./pay-state-hold";
import {
  type PayableReservation,
  PayableReservationService,
  type PayableReservationUnavailableError,
} from "./payable-reservation.service";

/**
 * Entering or removing a discount code affirms the displayed discounts,
 * awaiting one Google Calendar load between its live payable-reservation
 * guards.
 */
export const getDiscountCodeChangeDeadline = (
  deploymentEnvironment: DeploymentEnvironment
) => getCalendarActionDeadline(deploymentEnvironment, 1);

/**
 * Why a code change, entering or removing one, left the Pay state as it was,
 * whatever the code. `provider`: pricing, discounts or referrals were
 * unreachable, so a retry can work. `price_review_pending`: the customer must
 * first review a price change. `checkout`: the reservation can't be paid now,
 * or a payment already started.
 */
export type DiscountCodeChangeUnavailable =
  | { readonly status: "unavailable"; readonly reason: "provider" }
  | { readonly status: "unavailable"; readonly reason: "price_review_pending" }
  | {
      readonly status: "unavailable";
      readonly reason: "checkout";
      readonly checkoutReason:
        | "payment_in_progress"
        | PayableReservationUnavailableError["reason"];
    };

/**
 * Why a code was not applied. The site shows one generic unavailable field
 * error for every reason; other callers tell a retry from a correction.
 * `code`: the code is invalid, unknown or can't be used here.
 * `code_already_applied`: the order already carries a code.
 */
export type DiscountCodeUnavailable =
  | DiscountCodeChangeUnavailable
  | { readonly status: "unavailable"; readonly reason: "code" }
  | { readonly status: "unavailable"; readonly reason: "code_already_applied" };

/**
 * A rejection's replacement Pay state, when it has one, carries the attempted
 * code as signed requested intent; the correction route must use it so the
 * attempt survives the failure instead of falling back to the previous token.
 */
type RejectionReplacement = FreshPayState | NoFreshPayState;

export type ApplyDiscountCodeResult =
  | ({ readonly status: "applied" } & FreshPayState)
  | ({ readonly status: "accepted" } & FreshPayState)
  | ({ readonly status: "already_accepted" } & FreshPayState)
  | ({ readonly status: "pricing_changed" } & FreshPayState)
  | ({ readonly status: "already_attributed" } & RejectionReplacement)
  | ({ readonly status: "ineligible" } & RejectionReplacement)
  | (DiscountCodeUnavailable & RejectionReplacement);

const referralRejections = {
  already_attributed: "referral-already-attributed",
  ineligible: "referral-ineligible",
  unavailable: "unavailable",
} as const satisfies Record<string, DiscountCodeRejection>;

/** A canonical code entered on a pay state signed for the request's language. */
type DiscountCodeEntry = {
  readonly input: ApplyDiscountCodeInput;
  readonly state: SignedPayState;
  readonly submittedCode: CanonicalPromotionCode;
};

/**
 * A replacement Pay state that keeps a rejected code in the box as signed
 * requested intent, with the field error to show beside it. It keeps the
 * hold deadline of `state`.
 */
const issueRejectedCodePayState = (
  {
    input,
    state,
    submittedCode,
  }: DiscountCodeEntry & { readonly state: PayStateWithHoldExpiry },
  discountCodeError: DiscountCodeRejection
) =>
  issueFreshPayState(
    {
      ...state,
      locale: input.locale,
      orderId: state.orderId,
      checkoutSessionId: state.checkoutSessionId,
      requestedDiscountCode: submittedCode,
    },
    {},
    {
      discountCodeError,
      discountCodeErrorId: randomUUID(),
      orderId: state.orderId,
    }
  ).pipe(Effect.map(toFreshPayState));

/** Unavailable results without a replacement Pay state. */
const unavailableBecause = <Cause extends DiscountCodeUnavailable>(
  cause: Cause
): Cause & NoFreshPayState => ({
  ...cause,
  freshPayUrl: undefined,
});

const providerUnavailable = unavailableBecause({
  status: "unavailable",
  reason: "provider",
});

const paymentInProgress = unavailableBecause({
  status: "unavailable",
  reason: "checkout",
  checkoutReason: "payment_in_progress",
});

const priceReviewPending = unavailableBecause({
  status: "unavailable",
  reason: "price_review_pending",
});

/**
 * The order's reservation while it is payable and no payment attempt has
 * started; none once a payment is in progress. A reservation that can't be
 * paid fails.
 */
const requirePayableBeforePayment = Effect.fnUntraced(function* (
  state: SignedPayState
) {
  const payableReservations = yield* PayableReservationService;
  const reservation = yield* payableReservations.requireCurrent({
    orderId: state.orderId,
    checkoutSessionId: state.checkoutSessionId,
  });
  return reservation.activePaymentAttemptId
    ? Option.none<PayableReservation>()
    : Option.some(reservation);
});

/**
 * Prices a Pay state's order for a code change between two live guards that
 * its reservation is payable and no payment attempt has started, so a
 * payment that starts meanwhile discards the price. None when a payment is in
 * progress; the reservation is the first guard's.
 */
const priceBetweenPayableGuards = <A, E, R>(
  state: SignedPayState,
  price: (input: {
    readonly reservation: PayableReservation;
    readonly dotyposCustomerId: DotyposCustomerId;
  }) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const reservation = yield* requirePayableBeforePayment(state);
    if (Option.isNone(reservation)) return Option.none();

    const dotyposCustomerId = yield* Schema.decodeEffect(
      dotyposCustomerIdSchema
    )(reservation.value.dotyposCustomerId).pipe(
      Effect.mapError(
        DiscountProviderError.fromCause({
          reason: "provider_failure",
          message: "Stored customer identity is invalid.",
        })
      )
    );
    const priced = yield* price({
      reservation: reservation.value,
      dotyposCustomerId,
    });
    const current = yield* requirePayableBeforePayment(state);
    if (Option.isNone(current)) return Option.none();

    return Option.some({ reservation: reservation.value, priced });
  });

/**
 * A code change that could not be made leaves the existing summary payable:
 * unaffirmed discounts and unreachable providers allow a retry, and an order
 * that can't be paid says why. For `Effect.catchTags`.
 */
const codeChangeUnavailable = {
  DiscountAffirmationUnavailableError: () =>
    Effect.succeed(providerUnavailable),
  DiscountProviderError: () => Effect.succeed(providerUnavailable),
  PayableReservationUnavailableError: (
    error: PayableReservationUnavailableError
  ) =>
    Effect.succeed(
      unavailableBecause({
        status: "unavailable",
        reason: "checkout",
        checkoutReason: error.reason,
      })
    ),
};

/**
 * Accepts a referral code through the checkout referral flow, which signs its
 * own replacement pay state.
 */
const acceptReferralCode = Effect.fnUntraced(function* (
  entry: DiscountCodeEntry
) {
  const checkoutReferrals = yield* CheckoutReferralService;
  const rememberedReferral = yield* RememberedReferral;

  const result = yield* checkoutReferrals.acceptCode({
    code: entry.submittedCode,
    payStateToken: entry.input.payStateToken,
    locale: entry.input.locale,
  });
  if (result.status === "accepted" || result.status === "already_accepted") {
    // The accepted code replaces any shared-link code, so an order edit
    // keeps it. The signed pay state already carries the referral.
    yield* rememberedReferral
      .remember(entry.submittedCode)
      .pipe(
        Effect.catchTag("RememberedReferralError", () =>
          Effect.logWarning("Accepted referral code was not remembered")
        )
      );
    return result;
  }
  if (result.status === "pricing_changed" && result.freshPayUrl !== undefined) {
    return result;
  }
  // A started payment blocks the checkout, not the code: like an ordinary
  // code, it signs no replacement.
  if (
    result.status === "unavailable" &&
    result.reason === "checkout" &&
    result.checkoutReason === "payment_in_progress"
  ) {
    return paymentInProgress;
  }
  return yield* rejectReferralCode(entry, result);
});

/**
 * A rejected referral code stays in the box, like an unavailable ordinary
 * code, so the customer can see and correct it.
 */
const rejectReferralCode = Effect.fnUntraced(function* (
  entry: DiscountCodeEntry,
  rejection: Exclude<
    CheckoutReferralResult,
    { readonly status: "accepted" | "already_accepted" }
  >
) {
  const outcome = getReferralRejection(rejection);
  const freshPayState = yield* issueRejectedCodePayState(
    { ...entry, state: yield* loadPayStateHoldExpiry(entry.state) },
    referralRejections[outcome.status]
  );
  const rejected: ApplyDiscountCodeResult = { ...outcome, ...freshPayState };
  return rejected;
});

/** The apply outcome for a referral the checkout referral flow rejected. */
const getReferralRejection = (
  rejection: Exclude<
    CheckoutReferralResult,
    { readonly status: "accepted" | "already_accepted" }
  >
):
  | { readonly status: "already_attributed" | "ineligible" }
  | DiscountCodeUnavailable =>
  Match.value(rejection).pipe(
    Match.discriminatorsExhaustive("status")({
      already_attributed: () => ({ status: "already_attributed" as const }),
      ineligible: () => ({ status: "ineligible" as const }),
      unavailable: (unavailable) => unavailable,
      // A price change the referral flow could not sign is unexpected.
      pricing_changed: () => ({
        status: "unavailable" as const,
        reason: "provider" as const,
      }),
    })
  );

/**
 * Prices an ordinary promotion code against the payable reservation, between
 * two live guards that no payment attempt has started.
 */
const applyPromotionCode = Effect.fnUntraced(function* (
  entry: DiscountCodeEntry
) {
  const pricing = yield* CheckoutPricingService;
  const { input, state, submittedCode } = entry;

  const guarded = yield* priceBetweenPayableGuards(
    state,
    ({ reservation, dotyposCustomerId }) =>
      pricing
        .applyDiscountCode({
          ...state,
          bookedAt: getSignedPayStateBookedAt(state),
          dotyposCustomerId,
          locale: input.locale,
          submittedCode,
        })
        .pipe(
          // A recoverable invalid-code failure keeps the attempted code as
          // signed requested intent on the correction route instead of the
          // old state.
          Effect.catchTag("PromotionCodeUnavailableError", () =>
            issueRejectedCodePayState(
              { ...entry, state: withPayStateHoldExpiry(state, reservation) },
              "unavailable"
            ).pipe(
              Effect.map(
                (freshPayState): DiscountCodeUnavailable & FreshPayState => ({
                  status: "unavailable",
                  reason: "code",
                  ...freshPayState,
                })
              )
            )
          )
        )
  );
  if (Option.isNone(guarded)) return paymentInProgress;
  const { reservation, priced: result } = guarded.value;

  if (result.status === "unavailable") {
    return result;
  }

  const priced: ApplyDiscountCodeResult = yield* Match.value(result).pipe(
    Match.discriminatorsExhaustive("status")({
      affirmed: (applied) =>
        issueFreshPayState(
          {
            ...applied.priced,
            locale: input.locale,
            orderId: state.orderId,
            bookedAt: state.bookedAt,
            holdExpiresAt: getPayStateHoldExpiresAt(state, reservation),
            checkoutSessionId: state.checkoutSessionId,
            submittedCode,
            submittedCodeDiscountId: applied.priced.submittedCodeDiscountId,
            requestedDiscountCode: submittedCode,
            referralCode: state.referralCode,
          },
          {},
          { orderId: state.orderId }
        ).pipe(
          Effect.map((freshPayState) => ({
            status: "applied" as const,
            ...toFreshPayState(freshPayState),
          }))
        ),
      pricing_changed: (changed) =>
        issueFreshPayState(
          {
            ...changed.priced,
            locale: input.locale,
            orderId: state.orderId,
            bookedAt: state.bookedAt,
            holdExpiresAt: getPayStateHoldExpiresAt(state, reservation),
            checkoutSessionId: state.checkoutSessionId,
            changedKeys: changed.changedKeys,
            requestedDiscountCode: submittedCode,
            referralCode: state.referralCode,
          },
          {},
          { orderId: state.orderId }
        ).pipe(
          Effect.map((freshPayState) => ({
            status: "pricing_changed" as const,
            ...toFreshPayState(freshPayState),
          }))
        ),
    })
  );
  return priced;
});

export const applyDiscountCodeToPayState = Effect.fn(
  "checkout.applyDiscountCodeToPayState"
)(
  function* (input: ApplyDiscountCodeInput) {
    const referrals = yield* ReferralService;

    const state = yield* openPayStateForLocale(input);

    if (state.changedKeys) return priceReviewPending;
    if (state.submittedCode) {
      return unavailableBecause({
        status: "unavailable",
        reason: "code_already_applied",
      });
    }

    // A non-canonical attempt cannot be sealed as intent, so syntax failures
    // keep the plain unavailable result.
    const submittedCode = yield* normalizeSubmittedPromotionCode({
      submittedCode: input.submittedCode,
    }).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.catchTag("PromotionCodeUnavailableError", () =>
        Effect.succeed(undefined)
      )
    );
    if (submittedCode === undefined) {
      return unavailableBecause({ status: "unavailable", reason: "code" });
    }

    // A registry that can't classify the code applies nothing; a retry can
    // still work.
    const codeKind = yield* referrals
      .lookupCodeKind({ code: submittedCode })
      .pipe(Effect.orElseSucceed(() => undefined));
    if (codeKind === undefined) return providerUnavailable;
    const entry = { input, state, submittedCode };
    return yield* codeKind.kind === "referral"
      ? acceptReferralCode(entry)
      : applyPromotionCode(entry);
  },
  (effect) => effect.pipe(Effect.catchTags(codeChangeUnavailable))
);

export type ClearDiscountCodeResult =
  /**
   * `cleared`: a replacement Pay state without the entered code or the
   * intended one. When removing the code changed the summary, it asks the
   * customer to review the new price before paying.
   */
  | ({ readonly status: "cleared" } & FreshPayState)
  /** The Pay state carried no code; its own token is returned as is. */
  | ({ readonly status: "unchanged" } & FreshPayState)
  | (DiscountCodeChangeUnavailable & NoFreshPayState);

/**
 * Removes the entered code from a Pay state. Its other displayed discounts,
 * the referral benefit among them, are affirmed again and stacked afresh,
 * and the result is a price review the customer accepts before paying. An
 * intended code that was never applied is dropped without repricing. Neither
 * moves the hold deadline, and both wait for a pending price review.
 *
 * A state without either code is returned unchanged: it signs nothing, so it
 * reads no reservation, like accepting a price that needs no review; payment
 * checks the reservation again.
 */
export const clearDiscountCodeFromPayState = Effect.fn(
  "checkout.clearDiscountCodeFromPayState"
)(
  function* (input: ClearDiscountCodeInput) {
    const state = yield* openPayStateForLocale(input);

    const { submittedCodeDiscountId } = state;
    if (
      submittedCodeDiscountId === undefined &&
      state.requestedDiscountCode === undefined
    ) {
      const unchanged: ClearDiscountCodeResult = {
        status: "unchanged",
        freshPayUrl: buildCheckoutPayPathFromToken(
          input.locale,
          input.payStateToken
        ),
        freshPayStateToken: input.payStateToken,
        expiresAt: getPayStateExpiresAt(state),
      };
      return unchanged;
    }
    // A code change waits for the pending review, as code entry does.
    if (state.changedKeys) return priceReviewPending;
    if (submittedCodeDiscountId === undefined) {
      return yield* clearRequestedDiscountCode(input, state);
    }
    return yield* clearAppliedDiscountCode(
      input,
      state,
      submittedCodeDiscountId
    );
  },
  (effect) =>
    effect.pipe(
      Effect.catchTags({
        ...codeChangeUnavailable,
        // Removing a code resolves no entered code, so a code verdict can
        // only mean the kept discounts could not be resolved.
        PromotionCodeUnavailableError: () =>
          Effect.succeed(providerUnavailable),
      })
    )
);

/** Drops a code the customer intended but never applied, without repricing. */
const clearRequestedDiscountCode = Effect.fnUntraced(function* (
  input: ClearDiscountCodeInput,
  state: SignedPayState
) {
  const reservation = yield* requirePayableBeforePayment(state);
  if (Option.isNone(reservation)) return paymentInProgress;

  const freshPayState = yield* issueFreshPayState(
    {
      ...withPayStateHoldExpiry(state, reservation.value),
      locale: input.locale,
      requestedDiscountCode: undefined,
    },
    {},
    { orderId: state.orderId }
  );
  const cleared: ClearDiscountCodeResult = {
    status: "cleared",
    ...toFreshPayState(freshPayState),
  };
  return cleared;
});

/**
 * Re-prices the order without its entered code and signs the new price for
 * review. A code worth nothing changes no summary key, so its replacement
 * asks for no review.
 */
const clearAppliedDiscountCode = Effect.fnUntraced(function* (
  input: ClearDiscountCodeInput,
  state: SignedPayState,
  submittedCodeDiscountId: DiscountId
) {
  const pricing = yield* CheckoutPricingService;

  const guarded = yield* priceBetweenPayableGuards(
    state,
    ({ dotyposCustomerId }) =>
      pricing.clearDiscountCode({
        ...state,
        submittedCodeDiscountId,
        bookedAt: getSignedPayStateBookedAt(state),
        dotyposCustomerId,
        locale: input.locale,
      })
  );
  if (Option.isNone(guarded)) return paymentInProgress;
  const { reservation, priced } = guarded.value;
  const { changedKeys } = priced;

  const freshPayState = yield* issueFreshPayState(
    {
      ...priced,
      locale: input.locale,
      orderId: state.orderId,
      bookedAt: state.bookedAt,
      holdExpiresAt: getPayStateHoldExpiresAt(state, reservation),
      checkoutSessionId: state.checkoutSessionId,
      referralCode: state.referralCode,
      changedKeys:
        changedKeys.sectionKeys.length > 0 || changedKeys.itemKeys.length > 0
          ? changedKeys
          : undefined,
    },
    {},
    { orderId: state.orderId }
  );
  const cleared: ClearDiscountCodeResult = {
    status: "cleared",
    ...toFreshPayState(freshPayState),
  };
  return cleared;
});
