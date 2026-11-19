import { Effect, Layer } from "effect";
import {
  CheckoutPricingService,
  type CustomerQuoteInput,
  type ICheckoutPricingService,
  type PaymentPriceAffirmation,
  type PaymentRepricingInput,
  type PreparedCustomerQuote,
  reviewDisplayedOfficePrice,
} from "./checkout-pricing.service";
import { PayState, type SignedPayStatePricing } from "./pay-state";
import {
  getCustomerQuotePriceVerdict,
  getPaymentPriceVerdict,
} from "./reservation-checkout-pricing";

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
            summary: PayState.summary({
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
              summary: PayState.summary(input),
              acceptedTotal: input.acceptedTotal,
            },
            priced,
          })
        )
      )) as ICheckoutPricingService["affirmForPayment"],
  };
};

/**
 * Customer quoting for a caller's test: `quote` stands in for the customer's
 * discounts and returns the customer quote, full validation keeps the
 * advertised query code, and the verdict comes from the real submission rule.
 */
export const customerQuotePricingFrom = <E>(
  quote: (
    input: CustomerQuoteInput
  ) => Effect.Effect<PreparedCustomerQuote["quote"], E>
): Pick<ICheckoutPricingService, "quoteForCustomer"> => ({
  quoteForCustomer: ((input: CustomerQuoteInput) =>
    quote(input).pipe(
      Effect.map((customerQuote) => {
        const { reservation, advertisedQuote } = input.advertisement.priced;
        const summarize = (summarized: PreparedCustomerQuote["quote"]) =>
          PayState.summary({
            reservation,
            quote: summarized,
          } as SignedPayStatePricing);
        const verdict = getCustomerQuotePriceVerdict({
          advertised: {
            status: input.advertisement.status,
            summary: summarize(advertisedQuote),
          },
          customer: {
            priced: {
              kind: reservation.kind,
              reservation,
              quote: customerQuote,
            } as PreparedCustomerQuote,
            summary: summarize(customerQuote),
            advertisedCodeChanged: false,
          },
        });
        return reviewDisplayedOfficePrice(verdict, input.displayedOfficePrice);
      })
    )) as ICheckoutPricingService["quoteForCustomer"],
});
