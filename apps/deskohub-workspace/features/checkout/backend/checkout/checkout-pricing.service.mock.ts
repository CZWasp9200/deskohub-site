import { Effect, Layer } from "effect";
import {
  CheckoutPricingService,
  type ICheckoutPricingService,
  type PaymentPriceAffirmation,
  type PaymentRepricingInput,
} from "./checkout-pricing.service";
import {
  getSignedPayStateCheckoutSummary,
  type SignedPayStatePricing,
} from "./pay-state";
import { getPaymentPriceVerdict } from "./reservation-checkout-pricing";

export const CheckoutPricingServiceMock = Layer.mock(CheckoutPricingService);

/** The re-priced quote and commitment a caller's test stub returns. */
export type RepricedPayment = Pick<
  PaymentPriceAffirmation,
  "quote" | "commitment"
>;

/**
 * Payment pricing for a caller's test: `reprice` stands in for the discount
 * affirmation and returns the re-priced quote and commitment, and the
 * payment verdict comes from the real payment rule.
 */
export const paymentPricingFrom = <E>(
  reprice: (input: PaymentRepricingInput) => Effect.Effect<RepricedPayment, E>
): Pick<ICheckoutPricingService, "repriceForPayment" | "affirmForPayment"> => {
  const repriceForPayment = (input: PaymentRepricingInput) =>
    reprice(input).pipe(
      Effect.map(
        ({ quote, commitment }) =>
          ({
            kind: input.reservation.kind,
            reservation: input.reservation,
            quote,
            commitment,
            summary: getSignedPayStateCheckoutSummary({
              reservation: input.reservation,
              quote,
            } as SignedPayStatePricing),
          }) as PaymentPriceAffirmation
      )
    );
  return {
    repriceForPayment: repriceForPayment as never,
    affirmForPayment: ((input) =>
      repriceForPayment(input).pipe(
        Effect.map((priced) =>
          getPaymentPriceVerdict({
            signed: {
              quote: input.quote,
              summary: getSignedPayStateCheckoutSummary(input),
              acceptedTotal: input.acceptedTotal,
            },
            priced,
          })
        )
      )) as ICheckoutPricingService["affirmForPayment"],
  };
};
