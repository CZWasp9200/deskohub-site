import { Context, Effect, Layer, Match } from "effect";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import {
  type CheckoutSummary,
  getCheckoutSummaryChangedKeys,
} from "@/features/checkout/checkout-summary";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import { workspaceMoneyEquals } from "@/features/checkout/workspace-money";
import type { Locale } from "@/features/i18n";
import { ReferralService } from "@/features/referrals";
import type { ReferralError } from "@/features/referrals/contracts";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { buildFreshCheckoutPayPath } from "./checkout-pay-url";
import { CheckoutPricingService } from "./checkout-pricing.service";
import { isExpectedReferralQuoteAddition } from "./checkout-referral-price-change";
import {
  getSignedPayStateBookedAt,
  getSignedPayStateCheckoutSummary,
  getSignedPayStateSubmittedCode,
  openPayState,
} from "./pay-state.server";
import { PayableReservationService } from "./payable-reservation.service";

export type CheckoutReferralResult =
  | {
      readonly status: "accepted" | "already_accepted";
      readonly freshPayUrl: string;
    }
  | {
      readonly status: "unavailable" | "pricing_changed";
      readonly freshPayUrl?: string;
    }
  | {
      /** The account already has a different, permanent referrer. */
      readonly status: "already_attributed";
    }
  | {
      /** Referral codes apply only to the customer's first booking. */
      readonly status: "ineligible";
    }
  | {
      /** Only a signed-in customer account can accept a referral code. */
      readonly status: "sign_in_required";
    };

export interface ICheckoutReferralService {
  readonly acceptCode: (input: {
    readonly code: unknown;
    readonly payStateToken: string;
    readonly locale: Locale;
  }) => Effect.Effect<CheckoutReferralResult>;
}

const unavailable: CheckoutReferralResult = { status: "unavailable" };
const signInRequired: CheckoutReferralResult = { status: "sign_in_required" };

/**
 * Only a missing sign-in, an immutable existing attribution, and first-booking
 * ineligibility are explained to the customer; every other failure stays a
 * generic unavailable code so the response cannot probe codes or accounts.
 */
const getAcceptanceRejection = (
  error: ReferralError
): CheckoutReferralResult | undefined => {
  if (error.reason === "already_attributed") {
    return { status: "already_attributed" };
  }
  if (error.reason === "ineligible") return { status: "ineligible" };
  return undefined;
};

export class CheckoutReferralService extends Context.Service<
  CheckoutReferralService,
  ICheckoutReferralService
>()("@deskohub-workspace/checkout/CheckoutReferralService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const accounts = yield* CustomerAccountResolver;
      const referrals = yield* ReferralService;
      const pricing = yield* CheckoutPricingService;
      const payableReservations = yield* PayableReservationService;

      const acceptCode: ICheckoutReferralService["acceptCode"] = Effect.fn(
        "CheckoutReferralService.acceptCode"
      )(
        function* (input) {
          const opened = yield* openPayState(input.payStateToken);
          if (opened.locale !== input.locale) return unavailable;

          const codeKind = yield* referrals.lookupCodeKind({
            code: input.code,
          });
          if (codeKind.kind !== "referral") return unavailable;

          const resolved = yield* accounts.resolve.pipe(Effect.result);
          if (resolved._tag === "Failure") {
            return resolved.failure.reason === "unauthenticated"
              ? signInRequired
              : unavailable;
          }
          const identity = resolved.success;
          const currentReservation = yield* payableReservations.requireCurrent({
            orderId: opened.orderId,
            checkoutSessionId: opened.checkoutSessionId,
          });
          if (
            currentReservation.dotyposCustomerId !== identity.dotyposCustomerId
          ) {
            return unavailable;
          }

          const acceptance = yield* referrals
            .acceptReferral({
              code: input.code,
              customerAccountId: identity.accountId,
              dotyposCustomerId: identity.dotyposCustomerId,
            })
            .pipe(Effect.result);
          if (acceptance._tag === "Failure") {
            return (
              getAcceptanceRejection(acceptance.failure) ??
              (yield* acceptance.failure)
            );
          }

          const prepared = yield* Match.value(opened).pipe(
            Match.when({ reservation: { kind: "cowork" } }, (state) =>
              pricing.affirmForPayment({
                reservation: state.reservation,
                dotyposCustomerId: identity.dotyposCustomerId,
                locale: input.locale,
                quote: state.quote,
                bookedAt: getSignedPayStateBookedAt(opened),
                // biome-ignore lint/plugin: Preserve exact optional-property typing for the ordinary code slot.
                ...(state.submittedCode === undefined
                  ? {}
                  : { submittedCode: state.submittedCode }),
              })
            ),
            Match.when({ reservation: { kind: "meeting-room" } }, (state) =>
              pricing.affirmForPayment({
                reservation: state.reservation,
                dotyposCustomerId: identity.dotyposCustomerId,
                locale: input.locale,
                quote: state.quote,
                bookedAt: getSignedPayStateBookedAt(opened),
                // biome-ignore lint/plugin: Preserve exact optional-property typing for the ordinary code slot.
                ...(state.submittedCode === undefined
                  ? {}
                  : { submittedCode: state.submittedCode }),
              })
            ),
            Match.when({ reservation: { kind: "office" } }, (state) =>
              pricing.affirmForPayment({
                reservation: state.reservation,
                dotyposCustomerId: identity.dotyposCustomerId,
                locale: input.locale,
                quote: state.quote,
                bookedAt: getSignedPayStateBookedAt(opened),
                // biome-ignore lint/plugin: Preserve exact optional-property typing for the ordinary code slot.
                ...(state.submittedCode === undefined
                  ? {}
                  : { submittedCode: state.submittedCode }),
              })
            ),
            Match.exhaustive
          );

          const freshSummary: CheckoutSummary = Match.value(prepared).pipe(
            Match.discriminatorsExhaustive("kind")({
              cowork: ({ quote, reservation }) =>
                getCoworkCheckoutSummary(reservation, quote),
              "meeting-room": ({ quote }) =>
                getMeetingRoomCheckoutSummary(quote),
              office: ({ quote }) => getOfficeCheckoutSummary(quote),
            })
          );
          const oldSummary: CheckoutSummary =
            getSignedPayStateCheckoutSummary(opened);
          const quoteChanged =
            prepared.quote.fingerprint !== opened.quote.fingerprint;
          const acceptedTotalChanged = !workspaceMoneyEquals(
            freshSummary.total,
            opened.acceptedTotal
          );
          const signedTotalWasConsistent = workspaceMoneyEquals(
            oldSummary.total,
            opened.acceptedTotal
          );
          const expectedReferralAddition = isExpectedReferralQuoteAddition({
            previous: opened.quote,
            current: prepared.quote,
            commitment: prepared.commitment,
            dotyposCustomerId: identity.dotyposCustomerId,
          });
          const changed =
            !signedTotalWasConsistent ||
            ((quoteChanged || acceptedTotalChanged) &&
              !expectedReferralAddition);
          const changedKeys = changed
            ? getCheckoutSummaryChangedKeys(oldSummary, freshSummary)
            : undefined;
          const freshPayPathInput = {
            ...prepared,
            locale: input.locale,
            orderId: opened.orderId,
            bookedAt: opened.bookedAt,
            checkoutSessionId: opened.checkoutSessionId,
            ...getSignedPayStateSubmittedCode(
              opened,
              prepared.quote.payment.discounts
            ),
          };
          const freshPayUrl = yield* buildFreshCheckoutPayPath(
            changedKeys === undefined
              ? freshPayPathInput
              : { ...freshPayPathInput, changedKeys },
            undefined,
            { orderId: opened.orderId }
          );

          return changed
            ? { status: "pricing_changed" as const, freshPayUrl }
            : {
                status: acceptance.success.kind,
                freshPayUrl,
              };
        },
        (effect) => effect.pipe(Effect.orElseSucceed(() => unavailable))
      );

      return { acceptCode } satisfies ICheckoutReferralService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerAccountResolver.Live,
        ReferralService.Live,
        CheckoutPricingService.Live,
        PayableReservationService.Live,
        WorkspaceDotyposLayer
      )
    )
  );
}
