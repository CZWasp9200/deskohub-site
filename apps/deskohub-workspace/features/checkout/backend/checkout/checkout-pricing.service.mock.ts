import { Effect, Layer, Match } from "effect";
import type { CheckoutSummary } from "@/features/checkout/checkout-summary";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import {
  CheckoutPricingService,
  type ICheckoutPricingService,
  type PaymentPriceAffirmation,
  type PaymentRepricingInput,
} from "./checkout-pricing.service";
import { getPaymentPriceVerdict } from "./reservation-checkout-pricing";

export const CheckoutPricingServiceMock = Layer.mock(CheckoutPricingService);

/** One family's reservation with its quote. */
type PricedOrder = PaymentRepricingInput extends infer Input
  ? Input extends PaymentRepricingInput
    ? Pick<Input, "reservation" | "quote">
    : never
  : never;

const summarize = (priced: PricedOrder): CheckoutSummary =>
  Match.value(priced).pipe(
    Match.when({ reservation: { kind: "cowork" } }, ({ quote, reservation }) =>
      getCoworkCheckoutSummary(reservation, quote)
    ),
    Match.when({ reservation: { kind: "meeting-room" } }, ({ quote }) =>
      getMeetingRoomCheckoutSummary(quote)
    ),
    Match.when({ reservation: { kind: "office" } }, ({ quote }) =>
      getOfficeCheckoutSummary(quote)
    ),
    Match.exhaustive
  );

/**
 * Payment pricing for a caller's test: `reprice` stands in for the discount
 * affirmation and returns the re-priced quote and commitment, and the
 * payment verdict comes from the real payment rule.
 */
export const paymentPricingFrom = <E>(
  reprice: (
    input: PaymentRepricingInput
  ) => Effect.Effect<Pick<PaymentPriceAffirmation, "quote" | "commitment">, E>
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
            summary: summarize({
              reservation: input.reservation,
              quote,
            } as PricedOrder),
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
              summary: summarize(input),
              acceptedTotal: input.acceptedTotal,
            },
            priced,
          })
        )
      )) as ICheckoutPricingService["affirmForPayment"],
  };
};
