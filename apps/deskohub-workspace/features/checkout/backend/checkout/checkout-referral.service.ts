import { Context, Effect, Layer, Match } from "effect";
import {
  type CheckoutSummary,
  getCheckoutSummaryChangedKeys,
} from "@/features/checkout/checkout-summary";
import {
  type CanonicalPromotionCode,
  canonicalPromotionCodeSchema,
} from "@/features/discounts/contracts";
import type { Locale } from "@/features/i18n";
import { ReferralService } from "@/features/referrals";
import {
  type CheckoutReferralEvaluation,
  ReferralError,
  type ReferralOutage,
} from "@/features/referrals/contracts";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { moneyEquals } from "@/shared/money/money";
import {
  CheckoutPricingService,
  type ICheckoutPricingService,
  type PaymentPriceAffirmation,
} from "./checkout-pricing.service";
import { isExpectedReferralQuoteAddition } from "./checkout-referral-price-change";
import type { CheckoutUnavailableReason } from "./checkout-unavailable";
import {
  type FreshPayState,
  type NoFreshPayState,
  PayState,
  type SignedPayState,
  toFreshPayState,
} from "./pay-state";
import { PayableCheckout } from "./payable-checkout.service";
import type { PriceVerdict } from "./price-verdict";
import { hasPaymentInProgress } from "./reusable-payment-attempt";

/**
 * Why a referral code could not be accepted. The customer sees one generic
 * unavailable code either way; the cause only tells callers whether a retry
 * can help.
 */
type CheckoutReferralUnavailable =
  | {
      readonly status: "unavailable";
      /**
       * `code`: the code can't refer this customer. `provider`: pricing, the
       * referral registry or the pay-state seal failed, so a retry can work.
       */
      readonly reason: "code" | "provider";
    }
  | {
      readonly status: "unavailable";
      /** The reservation can't be paid now, or a payment already started. */
      readonly reason: "checkout";
      readonly checkoutReason:
        | "payment_in_progress"
        | CheckoutUnavailableReason;
    };

export type CheckoutReferralResult =
  | ({ readonly status: "accepted" } & FreshPayState)
  | ({ readonly status: "already_accepted" } & FreshPayState)
  | ({ readonly status: "pricing_changed" } & (FreshPayState | NoFreshPayState))
  | CheckoutReferralUnavailable
  | {
      /** The customer already has a different, permanent referrer. */
      readonly status: "already_attributed";
    }
  | {
      /** Referral codes apply only to the customer's first paid booking. */
      readonly status: "ineligible";
    };

export interface ICheckoutReferralService {
  readonly acceptCode: (input: {
    readonly code: unknown;
    readonly payStateToken: string;
    readonly locale: Locale;
  }) => Effect.Effect<CheckoutReferralResult>;
}

const codeUnavailable: CheckoutReferralUnavailable = {
  status: "unavailable",
  reason: "code",
};
const providerUnavailable: CheckoutReferralUnavailable = {
  status: "unavailable",
  reason: "provider",
};
const paymentInProgress: CheckoutReferralUnavailable = {
  status: "unavailable",
  reason: "checkout",
  checkoutReason: "payment_in_progress",
};

/**
 * Only an immutable existing attribution and first-booking ineligibility are
 * explained to the customer; every other verdict, and a withheld program,
 * stays a generic unavailable code so the response cannot probe codes or
 * accounts.
 */
const evaluationRejections = {
  already_attributed: { status: "already_attributed" },
  ineligible: { status: "ineligible" },
  unavailable: codeUnavailable,
  invalid_code: codeUnavailable,
  self_referral: codeUnavailable,
  pending_payment: codeUnavailable,
  cycle: codeUnavailable,
  disabled: codeUnavailable,
  account_unavailable: providerUnavailable,
  referrer_changed: providerUnavailable,
} satisfies Record<ReferralError["reason"], CheckoutReferralResult>;

/**
 * A verdict answers from the table above. An outage reached no verdict, so it
 * reads as a provider failure that a retry can fix, never as an unusable code.
 */
const getEvaluationRejection = (
  failure: ReferralError | ReferralOutage
): CheckoutReferralResult =>
  failure instanceof ReferralError
    ? evaluationRejections[failure.reason]
    : providerUnavailable;

/**
 * Only a not-yet-attributed customer carries the typed code; it prices the
 * invitation and is attributed when this order is paid. An already attributed
 * customer keeps whatever code the signed pay state carried.
 */
const getCarriedReferral = (input: {
  readonly evaluation: CheckoutReferralEvaluation;
  readonly opened: SignedPayState;
}): { readonly referralCode?: CanonicalPromotionCode } => {
  const referralCode =
    input.evaluation.kind === "eligible"
      ? canonicalPromotionCodeSchema.make(input.evaluation.code)
      : input.opened.referralCode;
  return referralCode === undefined ? {} : { referralCode };
};

/** Affirms the signed price for payment, carrying the referral. */
const affirmReferralPricing = (input: {
  readonly pricing: ICheckoutPricingService;
  readonly opened: SignedPayState;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly referralInput: { readonly referralCode?: CanonicalPromotionCode };
}) =>
  input.pricing.affirmForPayment({
    ...input.opened,
    bookedAt: PayState.bookedAt(input.opened),
    dotyposCustomerId: input.dotyposCustomerId,
    locale: input.locale,
    ...input.referralInput,
  });

/**
 * The referral's own verdict on the re-priced order: it changed when it moved
 * beyond the expected referral addition, with the summary keys the customer
 * must review. A signed total that disagrees with its own summary is always a
 * change; the payment verdict's change is not one when it is only the
 * expected addition.
 */
const getReferralPriceVerdict = (input: {
  readonly opened: SignedPayState;
  readonly verdict: PriceVerdict<PaymentPriceAffirmation>;
  readonly dotyposCustomerId: DotyposCustomerId;
}): PriceVerdict<PaymentPriceAffirmation> => {
  const { opened, verdict } = input;
  const prepared = verdict.priced;
  const oldSummary: CheckoutSummary = PayState.summary(opened);
  const signedTotalWasConsistent = moneyEquals(
    oldSummary.total,
    opened.acceptedTotal
  );
  const expectedReferralAddition = isExpectedReferralQuoteAddition({
    previous: opened.quote,
    current: prepared.quote,
    commitment: prepared.commitment,
    dotyposCustomerId: input.dotyposCustomerId,
  });
  const changed =
    !signedTotalWasConsistent ||
    Match.value(verdict).pipe(
      Match.discriminatorsExhaustive("status")({
        affirmed: () => false,
        pricing_changed: () => !expectedReferralAddition,
      })
    );
  return changed
    ? {
        status: "pricing_changed",
        priced: prepared,
        changedKeys: getCheckoutSummaryChangedKeys(
          oldSummary,
          prepared.summary
        ),
      }
    : { status: "affirmed", priced: prepared };
};

const toReferralAcceptanceResult = (input: {
  readonly verdict: PriceVerdict<PaymentPriceAffirmation>;
  readonly evaluation: CheckoutReferralEvaluation;
  readonly freshPayState: FreshPayState;
}): CheckoutReferralResult => {
  if (input.verdict.status === "pricing_changed") {
    return { status: "pricing_changed", ...input.freshPayState };
  }
  return {
    status:
      input.evaluation.kind === "eligible" ? "accepted" : "already_accepted",
    ...input.freshPayState,
  };
};

export class CheckoutReferralService extends Context.Service<
  CheckoutReferralService,
  ICheckoutReferralService
>()("@deskohub-workspace/checkout/CheckoutReferralService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const referrals = yield* ReferralService;
      const pricing = yield* CheckoutPricingService;
      const payableCheckout = yield* PayableCheckout;
      const sealedStateKeys = yield* SealedStateKeys;

      const acceptCode: ICheckoutReferralService["acceptCode"] = Effect.fn(
        "CheckoutReferralService.acceptCode"
      )(
        function* (input) {
          // Callers open the token for its locale first, so a mismatch here
          // is unexpected and reads as unavailable, like any other failure.
          const opened = yield* PayState.open(input.payStateToken, {
            locale: input.locale,
          });

          const codeKind = yield* referrals.lookupCodeKind({
            code: input.code,
          });
          if (codeKind.kind !== "referral") return codeUnavailable;

          // The referral belongs to the booked customer: the account's own
          // customer, or the person it books for.
          const checkout = yield* payableCheckout.reconfirm(opened);
          // Like an ordinary code, a referral never replaces the summary of a
          // payment already in progress; payment admission rechecks it too.
          if (hasPaymentInProgress(checkout.reservation)) {
            return paymentInProgress;
          }
          const { dotyposCustomerId } = checkout.reservation;

          const evaluation = yield* referrals
            .evaluateCheckoutReferral({ code: input.code, dotyposCustomerId })
            .pipe(Effect.result);
          if (evaluation._tag === "Failure") {
            return getEvaluationRejection(evaluation.failure);
          }
          const referralInput = getCarriedReferral({
            evaluation: evaluation.success,
            opened,
          });
          const paymentVerdict = yield* affirmReferralPricing({
            pricing,
            opened,
            dotyposCustomerId,
            locale: input.locale,
            referralInput,
          });
          const verdict = getReferralPriceVerdict({
            opened,
            verdict: paymentVerdict,
            dotyposCustomerId,
          });
          // A payment that started while the referral was priced keeps the
          // summary it was admitted with.
          const repriced = yield* payableCheckout.reconfirm(opened);
          if (hasPaymentInProgress(repriced.reservation)) {
            return paymentInProgress;
          }
          const freshPayState = yield* PayState.reissue(checkout.state, {
            kind: "referral_applied",
            referralCode: referralInput.referralCode,
            verdict,
          }).pipe(Effect.map(toFreshPayState));

          return toReferralAcceptanceResult({
            verdict,
            evaluation: evaluation.success,
            freshPayState,
          });
        },
        (effect) =>
          effect.pipe(
            Effect.catchTag(
              "CheckoutUnavailableError",
              (error): Effect.Effect<CheckoutReferralResult> =>
                Effect.succeed({
                  status: "unavailable",
                  reason: "checkout",
                  checkoutReason: error.reason,
                })
            ),
            // Every other failure is an outage, never a verdict on the code:
            // the referral registry's code-kind lookup, the stored customer
            // identity, pricing and affirmation, storage, or the seal.
            Effect.orElseSucceed(() => providerUnavailable),
            Effect.provideService(SealedStateKeys, sealedStateKeys)
          )
      );

      return { acceptCode } satisfies ICheckoutReferralService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        ReferralService.Live,
        CheckoutPricingService.Live,
        PayableCheckout.Live,
        WorkspaceDotyposLayer,
        SealedStateKeys.Default
      )
    )
  );
}
