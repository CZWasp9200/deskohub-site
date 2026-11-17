import { Effect, Match, Option } from "effect";
import {
  type CheckoutSummary,
  type CheckoutSummaryChangedKeys,
  getCheckoutSummaryChangedKeys,
} from "@/features/checkout/checkout-summary";
import type { ReservationQuotePayment } from "@/features/checkout/reservation-quote-schema";
import {
  type AffirmedDiscountAdvertisementQuote,
  affirmedDiscountAdvertisementQuoteCodec,
  type CanonicalPromotionCode,
  type DiscountAdvertisementInput,
  DiscountAffirmationUnavailableError,
  type DiscountCommitment,
  type DiscountId,
  type DiscountQuote,
  type DiscountResolutionError,
  DiscountService,
} from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { type Money, moneyEquals } from "@/shared/money/money";
import { currentInstant } from "@/shared/utils";
import { AdvertisedPriceMismatchError } from "./advertised-price-mismatch";
import {
  getSubmittedCodeMetadata,
  type PayStateSubmittedCodeMetadata,
} from "./pay-state-contract";
import type { PriceVerdict } from "./price-verdict";

const getReferralCode = (input: {
  readonly referralCode?: CanonicalPromotionCode;
}) =>
  input.referralCode === undefined ? {} : { referralCode: input.referralCode };

type ReservationDetails = {
  readonly kind: string;
};

type AdvertisedReservation<Details extends ReservationDetails> = {
  readonly kind: Details["kind"];
  readonly details: Details;
};

type ReservationQuote = {
  readonly fingerprint: string;
  readonly payment: ReservationQuotePayment;
};

export type ReservationAdvertisementQuoteInput<
  Reservation extends AdvertisedReservation<ReservationDetails>,
> = {
  readonly reservation: Reservation;
  readonly locale: Locale;
  readonly submittedCode?: CanonicalPromotionCode;
};

/** An opened advertisement snapshot of one reservation family. */
type ReservationAdvertisedPriceSnapshot<
  Advertisement extends AdvertisedReservation<ReservationDetails>,
  Quote extends ReservationQuote,
> = PayStateSubmittedCodeMetadata & {
  readonly locale: Locale;
  readonly reservation: Advertisement;
  readonly quote: Quote;
  readonly requestedDiscountCode?: CanonicalPromotionCode;
};

export type ReservationAdvertisementAffirmationInput<
  Advertisement extends AdvertisedReservation<ReservationDetails>,
  CustomerReservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = {
  /** The snapshot the reservation page advertised. */
  readonly advertisement: ReservationAdvertisedPriceSnapshot<
    Advertisement,
    Quote
  >;
  /** The submitted reservation the snapshot must advertise. */
  readonly reservation: CustomerReservation;
  readonly locale: Locale;
  /** Moment the reservation is submitted and its price is locked. */
  readonly bookedAt: Temporal.Instant;
};

export type ReservationCustomerQuoteInput<
  CustomerReservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = {
  /**
   * The verdict reservation submission reached on the advertised price; its
   * price names the reservation, the affirmed discounts and the query code.
   */
  readonly advertisement: PriceVerdict<
    ReservationAdvertisementAffirmation<CustomerReservation, Quote>
  >;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  /** Referral code the checkout carries for an unattributed customer. */
  readonly referralCode?: CanonicalPromotionCode;
};

/** A signed order to re-price for its payment, with the quote it signed. */
export type ReservationPaymentRepricingInput<
  Reservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = {
  readonly reservation: Reservation;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  /** The signed quote; its discounts are the ones affirmed again. */
  readonly quote: Quote;
  /** Booking moment stored when the price was locked. */
  readonly bookedAt: Temporal.Instant;
  readonly submittedCode?: CanonicalPromotionCode;
  /** Referral code the checkout carries for an unattributed customer. */
  readonly referralCode?: CanonicalPromotionCode;
};

export type ReservationPaymentPriceAffirmationInput<
  Reservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = ReservationPaymentRepricingInput<Reservation, Quote> & {
  /** The total the customer accepted with the signed quote. */
  readonly acceptedTotal: Money;
};

export type ReservationDiscountCodePriceInput<
  Reservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = Omit<
  ReservationPaymentRepricingInput<Reservation, Quote>,
  "submittedCode"
> & {
  readonly submittedCode: CanonicalPromotionCode;
};

/**
 * A signed order whose entered code is removed: the signed quote and the
 * code's discount in it, which is not affirmed again.
 */
export type ReservationDiscountCodeClearInput<
  Reservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = Omit<
  ReservationPaymentRepricingInput<Reservation, Quote>,
  "submittedCode"
> & {
  readonly submittedCodeDiscountId: DiscountId;
};

type ReservationAdvertisedPrice<
  Reservation extends AdvertisedReservation<ReservationDetails>,
  Quote extends ReservationQuote,
> = PayStateSubmittedCodeMetadata & {
  readonly kind: Reservation["kind"];
  readonly reservation: Reservation;
  readonly quote: Quote;
};

export type ReservationAdvertisementQuote<
  Reservation extends AdvertisedReservation<ReservationDetails>,
  Quote extends ReservationQuote,
> = ReservationAdvertisedPrice<Reservation, Quote> & {
  /**
   * False when a discount source could not answer, so the price may miss a
   * running sale. Such a price is right for this request but not to share.
   */
  readonly discountsComplete: boolean;
};

/**
 * The advertised price affirmed for a submitted reservation: the snapshot's
 * quote, and the discounts that still apply at the booking moment.
 */
export type ReservationAdvertisementAffirmation<
  CustomerReservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = PayStateSubmittedCodeMetadata & {
  readonly kind: CustomerReservation["kind"];
  readonly reservation: CustomerReservation;
  readonly advertisedQuote: Quote;
  readonly discountQuote: AffirmedDiscountAdvertisementQuote;
  readonly requestedDiscountCode?: CanonicalPromotionCode;
};

type ReservationCustomerQuote<
  Reservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = {
  readonly kind: Reservation["kind"];
  readonly reservation: Reservation;
  readonly quote: Quote;
};

export type ReservationPreparedCustomerQuote<
  Reservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = ReservationCustomerQuote<Reservation, Quote> &
  PayStateSubmittedCodeMetadata;

/**
 * The price a signed order is paid with: the re-affirmed quote, the discount
 * commitment payment persists and admits, and the checkout summary the quote
 * shows.
 */
export type ReservationPaymentPriceAffirmation<
  Reservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = ReservationCustomerQuote<Reservation, Quote> & {
  readonly commitment: DiscountCommitment;
  readonly summary: CheckoutSummary;
};

/**
 * Code entry's verdict: affirmed with the order priced with the entered code,
 * or changed with the refreshed displayed price, which carries no code.
 */
export type ReservationDiscountCodeVerdict<
  Reservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = PriceVerdict<
  ReservationCustomerQuote<Reservation, Quote> & {
    readonly submittedCodeDiscountId: DiscountId;
  },
  ReservationCustomerQuote<Reservation, Quote>
>;

/**
 * The order re-priced without its entered code, and what changed from the
 * signed summary; nothing changed when the code was worth nothing.
 */
export type ReservationDiscountCodeClearResult<
  Reservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = ReservationCustomerQuote<Reservation, Quote> & {
  readonly changedKeys: CheckoutSummaryChangedKeys;
};

/**
 * The payment boundary's rule: the signed price holds only when the re-priced
 * quote keeps the signed fingerprint and its total is the accepted total.
 * Otherwise the changed keys run from the signed summary to the re-priced one.
 */
export const getPaymentPriceVerdict = <
  Priced extends {
    readonly quote: ReservationQuote;
    readonly summary: CheckoutSummary;
  },
>(input: {
  readonly signed: {
    readonly quote: ReservationQuote;
    readonly summary: CheckoutSummary;
    readonly acceptedTotal: Money;
  };
  readonly priced: Priced;
}): PriceVerdict<Priced> => {
  const { signed, priced } = input;
  if (
    priced.quote.fingerprint === signed.quote.fingerprint &&
    moneyEquals(priced.summary.total, signed.acceptedTotal)
  ) {
    return { status: "affirmed", priced };
  }
  return {
    status: "pricing_changed",
    priced,
    changedKeys: getCheckoutSummaryChangedKeys(signed.summary, priced.summary),
  };
};

/**
 * The reservation-submission rule, after the customer's identity is known:
 * the customer quote keeps the advertisement's verdict and changes it only
 * when full validation moved the advertised query code. Discounts of the
 * customer, such as a customer discount, may appear for the first time here
 * without changing the price. The changed keys run from the advertised
 * summary to the customer quote's.
 */
export const getCustomerQuotePriceVerdict = <Priced>(input: {
  readonly advertised: {
    readonly status: PriceVerdict<unknown>["status"];
    readonly summary: CheckoutSummary;
  };
  readonly customer: {
    readonly priced: Priced;
    readonly summary: CheckoutSummary;
    /** Full validation dropped or changed the advertised query code. */
    readonly advertisedCodeChanged: boolean;
  };
}): PriceVerdict<Priced> => {
  const { advertised, customer } = input;
  const changed = (): PriceVerdict<Priced> => ({
    status: "pricing_changed",
    priced: customer.priced,
    changedKeys: getCheckoutSummaryChangedKeys(
      advertised.summary,
      customer.summary
    ),
  });
  return Match.value(advertised).pipe(
    Match.discriminatorsExhaustive("status")({
      affirmed: (): PriceVerdict<Priced> =>
        customer.advertisedCodeChanged
          ? changed()
          : { status: "affirmed", priced: customer.priced },
      pricing_changed: changed,
    })
  );
};

type PricingContext = {
  readonly discountInput: Omit<
    DiscountAdvertisementInput,
    "bookedAt" | "locale"
  >;
};

type ReservationPricingDomain<
  Details extends ReservationDetails,
  Advertisement extends AdvertisedReservation<Details>,
  CustomerReservation extends Details,
  Context extends PricingContext,
  Quote extends ReservationQuote,
  ContextError,
  QuoteError,
> = {
  /** The family's advertised price inputs and when two of them match. */
  readonly advertised: {
    readonly project: (reservation: CustomerReservation) => Advertisement;
    readonly equals: (self: Advertisement, that: Advertisement) => boolean;
  };
  readonly getPricingContext: (
    reservation: Details
  ) => Effect.Effect<Context, ContextError>;
  readonly buildQuote: (input: {
    readonly pricing: Context;
    readonly discountQuote: DiscountQuote;
  }) => Effect.Effect<Quote, QuoteError>;
  readonly getCheckoutSummary: (input: {
    readonly reservation: Details;
    readonly quote: Quote;
  }) => CheckoutSummary;
};

interface ReservationCheckoutPricing<
  Details extends ReservationDetails,
  Advertisement extends AdvertisedReservation<Details>,
  CustomerReservation extends Details,
  Quote extends ReservationQuote,
  Error,
> {
  readonly quoteAdvertisement: (
    input: ReservationAdvertisementQuoteInput<Advertisement>
  ) => Effect.Effect<
    ReservationAdvertisementQuote<Advertisement, Quote>,
    Error
  >;
  readonly affirmAdvertisement: (
    input: ReservationAdvertisementAffirmationInput<
      Advertisement,
      CustomerReservation,
      Quote
    >
  ) => Effect.Effect<
    PriceVerdict<
      ReservationAdvertisementAffirmation<CustomerReservation, Quote>
    >,
    Error | AdvertisedPriceMismatchError
  >;
  readonly quoteForCustomer: (
    input: ReservationCustomerQuoteInput<CustomerReservation, Quote>
  ) => Effect.Effect<
    PriceVerdict<ReservationPreparedCustomerQuote<CustomerReservation, Quote>>,
    Error
  >;
  readonly repriceForPayment: (
    input: ReservationPaymentRepricingInput<CustomerReservation, Quote>
  ) => Effect.Effect<
    ReservationPaymentPriceAffirmation<CustomerReservation, Quote>,
    Error
  >;
  readonly affirmForPayment: (
    input: ReservationPaymentPriceAffirmationInput<CustomerReservation, Quote>
  ) => Effect.Effect<
    PriceVerdict<
      ReservationPaymentPriceAffirmation<CustomerReservation, Quote>
    >,
    Error
  >;
  readonly applyDiscountCode: (
    input: ReservationDiscountCodePriceInput<CustomerReservation, Quote>
  ) => Effect.Effect<
    ReservationDiscountCodeVerdict<CustomerReservation, Quote>,
    Error
  >;
  readonly clearDiscountCode: (
    input: ReservationDiscountCodeClearInput<CustomerReservation, Quote>
  ) => Effect.Effect<
    ReservationDiscountCodeClearResult<CustomerReservation, Quote>,
    Error
  >;
}

export const reservationCheckoutPricing = <
  Details extends ReservationDetails,
  Advertisement extends AdvertisedReservation<Details>,
  CustomerReservation extends Details,
  Context extends PricingContext,
  Quote extends ReservationQuote,
  ContextError,
  QuoteError,
>(
  domain: ReservationPricingDomain<
    Details,
    Advertisement,
    CustomerReservation,
    Context,
    Quote,
    ContextError,
    QuoteError
  >
): Effect.Effect<
  ReservationCheckoutPricing<
    Details,
    Advertisement,
    CustomerReservation,
    Quote,
    | ContextError
    | QuoteError
    | DiscountResolutionError
    | DiscountAffirmationUnavailableError
  >,
  never,
  DiscountService
> =>
  Effect.gen(function* () {
    const discounts = yield* DiscountService;

    /**
     * Previews a query code on top of the anonymous discounts. Discovery omits
     * a code it cannot preview. Affirming an advertised code treats a provider
     * failure as unknown rather than gone, so it fails instead of silently
     * dropping the code; an unavailable code is still gone.
     */
    const previewSubmittedCode = Effect.fn(
      "ReservationCheckoutPricing.previewSubmittedCode"
    )(function* (input: {
      readonly discountQuote: DiscountQuote;
      readonly firstServiceDate: string;
      readonly locale: Locale;
      readonly submittedCode?: CanonicalPromotionCode;
      readonly advertisedCodeDiscountId?: DiscountId;
    }) {
      if (!input.submittedCode) return undefined;

      const preview = yield* discounts
        .previewDiscountCode({
          baseQuote: input.discountQuote,
          firstServiceDate: input.firstServiceDate,
          locale: input.locale,
          submittedCode: input.submittedCode,
        })
        .pipe(
          Effect.map(Option.some),
          Effect.catch((cause) =>
            cause._tag === "DiscountProviderError" &&
            input.advertisedCodeDiscountId !== undefined
              ? Effect.fail(
                  new DiscountAffirmationUnavailableError({
                    message:
                      "The advertised discount code could not be affirmed because its provider was unavailable.",
                    discountIds: [input.advertisedCodeDiscountId],
                  })
                )
              : Effect.succeed(Option.none())
          ),
          Effect.map(Option.getOrUndefined)
        );
      if (
        !preview ||
        input.discountQuote.discounts.some(
          ({ discount }) => discount.id === preview.application.discount.id
        )
      ) {
        return undefined;
      }

      return {
        discountQuote: preview.quote,
        submittedCode: input.submittedCode,
        submittedCodeDiscountId: preview.application.discount.id,
      };
    });

    const quoteAdvertisement = Effect.fn(
      "ReservationCheckoutPricing.quoteAdvertisement"
    )((input: ReservationAdvertisementQuoteInput<Advertisement>) =>
      domain.getPricingContext(input.reservation.details).pipe(
        Effect.bindTo("pricing"),
        // An advertised price previews a booking made right now.
        Effect.bind("bookedAt", () => currentInstant),
        Effect.bind("advertisement", ({ bookedAt, pricing }) =>
          discounts.discoverAdvertisedDiscounts({
            ...pricing.discountInput,
            bookedAt,
            locale: input.locale,
          })
        ),
        Effect.bind("preview", ({ advertisement, pricing }) =>
          previewSubmittedCode({
            discountQuote: advertisement.quote,
            firstServiceDate: pricing.discountInput.firstServiceDate,
            locale: input.locale,
            submittedCode: input.submittedCode,
          })
        ),
        Effect.bind("quote", ({ advertisement, preview, pricing }) =>
          domain.buildQuote({
            pricing,
            discountQuote: preview?.discountQuote ?? advertisement.quote,
          })
        ),
        Effect.map(({ advertisement, preview, quote }) => ({
          kind: input.reservation.kind,
          reservation: input.reservation,
          quote,
          discountsComplete: advertisement.complete,
          ...getSubmittedCodeMetadata(preview ?? {}),
        }))
      )
    );

    /**
     * Re-evaluates the advertised discounts at the booking moment: the
     * anonymous ones the snapshot showed and its query code. A discount that
     * became available after the snapshot is never added.
     */
    const reaffirmAdvertisedPrice = Effect.fn(
      "ReservationCheckoutPricing.reaffirmAdvertisedPrice"
    )(
      (
        input: Pick<
          ReservationAdvertisementAffirmationInput<
            Advertisement,
            CustomerReservation,
            Quote
          >,
          "advertisement" | "locale" | "bookedAt"
        >
      ) =>
        domain.getPricingContext(input.advertisement.reservation.details).pipe(
          Effect.bindTo("pricing"),
          Effect.bind("discountQuote", ({ pricing }) =>
            discounts.affirmAdvertisement({
              ...pricing.discountInput,
              bookedAt: input.bookedAt,
              locale: input.locale,
              advertisedDiscountIds: input.advertisement.quote.payment.discounts
                .map(({ discount }) => discount.id)
                .filter(
                  (discountId) =>
                    discountId !== input.advertisement.submittedCodeDiscountId
                ),
            })
          ),
          Effect.bind("preview", ({ discountQuote, pricing }) =>
            previewSubmittedCode({
              discountQuote,
              firstServiceDate: pricing.discountInput.firstServiceDate,
              locale: input.locale,
              submittedCode: input.advertisement.submittedCode,
              advertisedCodeDiscountId:
                input.advertisement.submittedCodeDiscountId,
            })
          ),
          Effect.bind("quote", ({ discountQuote, preview, pricing }) =>
            domain.buildQuote({
              pricing,
              discountQuote: preview?.discountQuote ?? discountQuote,
            })
          ),
          Effect.map(({ discountQuote, preview, quote }) => ({
            discountQuote: preview
              ? affirmedDiscountAdvertisementQuoteCodec.make(
                  preview.discountQuote
                )
              : discountQuote,
            quote,
            ...getSubmittedCodeMetadata(preview ?? {}),
          }))
        )
    );

    /**
     * Affirms the price a reservation page advertised for the submitted
     * reservation. The snapshot must advertise this reservation in this
     * locale. The price changed when the re-evaluated quote's fingerprint
     * differs from the snapshot's.
     */
    const affirmAdvertisement = Effect.fn(
      "ReservationCheckoutPricing.affirmAdvertisement"
    )(
      (
        input: ReservationAdvertisementAffirmationInput<
          Advertisement,
          CustomerReservation,
          Quote
        >
      ) =>
        Effect.succeed(input.advertisement).pipe(
          Effect.filterOrFail(
            (advertisement) =>
              advertisement.locale === input.locale &&
              domain.advertised.equals(
                advertisement.reservation,
                domain.advertised.project(input.reservation)
              ),
            AdvertisedPriceMismatchError.inputMismatch
          ),
          Effect.flatMap(() => reaffirmAdvertisedPrice(input)),
          Effect.map(
            (
              affirmed
            ): PriceVerdict<
              ReservationAdvertisementAffirmation<CustomerReservation, Quote>
            > => {
              const { advertisement } = input;
              const priced = {
                kind: input.reservation.kind,
                reservation: input.reservation,
                advertisedQuote: advertisement.quote,
                discountQuote: affirmed.discountQuote,
                ...getSubmittedCodeMetadata(affirmed),
                requestedDiscountCode: advertisement.requestedDiscountCode,
              };
              if (
                advertisement.quote.fingerprint === affirmed.quote.fingerprint
              ) {
                return { status: "affirmed", priced };
              }
              const summarize = (quote: Quote) =>
                domain.getCheckoutSummary({
                  reservation: advertisement.reservation.details,
                  quote,
                });
              return {
                status: "pricing_changed",
                priced,
                changedKeys: getCheckoutSummaryChangedKeys(
                  summarize(advertisement.quote),
                  summarize(affirmed.quote)
                ),
              };
            }
          )
        )
    );

    /**
     * Quotes the submitted reservation for its resolved customer on top of
     * the affirmed advertisement, and judges it by the submission rule
     * ({@link getCustomerQuotePriceVerdict}). A query code that fails full
     * validation leaves the quote.
     */
    const quoteForCustomer = Effect.fn(
      "ReservationCheckoutPricing.quoteForCustomer"
    )((input: ReservationCustomerQuoteInput<CustomerReservation, Quote>) => {
      const advertised = input.advertisement.priced;
      return domain.getPricingContext(advertised.reservation).pipe(
        Effect.bindTo("pricing"),
        Effect.bind("customerQuote", ({ pricing }) =>
          discounts.applyCustomerDiscount({
            affirmedAdvertisement: advertised.discountQuote,
            dotyposCustomerId: input.dotyposCustomerId,
            firstServiceDate: pricing.discountInput.firstServiceDate,
            locale: input.locale,
            ...getSubmittedCodeMetadata(advertised),
            ...getReferralCode(input),
          })
        ),
        Effect.bind("quote", ({ customerQuote, pricing }) =>
          domain.buildQuote({ pricing, discountQuote: customerQuote })
        ),
        Effect.map(({ customerQuote, quote }) =>
          getCustomerQuotePriceVerdict({
            advertised: {
              status: input.advertisement.status,
              summary: domain.getCheckoutSummary({
                reservation: advertised.reservation,
                quote: advertised.advertisedQuote,
              }),
            },
            customer: {
              priced: {
                kind: advertised.reservation.kind,
                reservation: advertised.reservation,
                quote,
                ...getSubmittedCodeMetadata({
                  submittedCode: advertised.submittedCode,
                  submittedCodeDiscountId:
                    customerQuote.submittedCodeDiscountId,
                }),
              },
              summary: domain.getCheckoutSummary({
                reservation: advertised.reservation,
                quote,
              }),
              advertisedCodeChanged: customerQuote.advertisedPriceChanged,
            },
          })
        )
      );
    });

    /**
     * Affirms the signed quote's discounts again, except `removedDiscountId`,
     * and builds the quote from the affirmed ones.
     */
    const affirmDisplayedPrice = Effect.fn(
      "ReservationCheckoutPricing.affirmDisplayedPrice"
    )(
      (
        input: ReservationPaymentRepricingInput<CustomerReservation, Quote> & {
          readonly removedDiscountId?: DiscountId;
        }
      ) =>
        domain.getPricingContext(input.reservation).pipe(
          Effect.bindTo("pricing"),
          Effect.bind("affirmation", ({ pricing }) =>
            discounts.affirmDisplayedDiscounts({
              ...pricing.discountInput,
              bookedAt: input.bookedAt,
              dotyposCustomerId: input.dotyposCustomerId,
              locale: input.locale,
              submittedCode: input.submittedCode,
              ...getReferralCode(input),
              displayedDiscountIds: input.quote.payment.discounts
                .map(({ discount }) => discount.id)
                .filter((discountId) => discountId !== input.removedDiscountId),
            })
          ),
          Effect.bind("quote", ({ affirmation, pricing }) =>
            domain.buildQuote({
              pricing,
              discountQuote: affirmation.quote,
            })
          )
        )
    );

    /**
     * Re-prices a signed order for its payment: the signed discounts affirmed
     * again at the booking moment. It judges nothing about the signed price.
     */
    const repriceForPayment = Effect.fn(
      "ReservationCheckoutPricing.repriceForPayment"
    )((input: ReservationPaymentRepricingInput<CustomerReservation, Quote>) =>
      affirmDisplayedPrice(input).pipe(
        Effect.map(
          ({
            affirmation,
            quote,
          }): ReservationPaymentPriceAffirmation<
            CustomerReservation,
            Quote
          > => ({
            kind: input.reservation.kind,
            reservation: input.reservation,
            quote,
            commitment: affirmation.commitment,
            summary: domain.getCheckoutSummary({
              reservation: input.reservation,
              quote,
            }),
          })
        )
      )
    );

    /** Affirms the signed price before payment by the payment rule. */
    const affirmForPayment = Effect.fn(
      "ReservationCheckoutPricing.affirmForPayment"
    )(
      (
        input: ReservationPaymentPriceAffirmationInput<
          CustomerReservation,
          Quote
        >
      ) =>
        repriceForPayment(input).pipe(
          Effect.map((priced) =>
            getPaymentPriceVerdict({
              signed: {
                quote: input.quote,
                summary: domain.getCheckoutSummary({
                  reservation: input.reservation,
                  quote: input.quote,
                }),
                acceptedTotal: input.acceptedTotal,
              },
              priced,
            })
          )
        )
    );

    /**
     * Prices an entered code on the displayed price. Code entry's rule: the
     * displayed price holds only when the affirmed quote keeps its
     * fingerprint and its total. Otherwise the verdict carries the refreshed
     * price without the code, and the code is never resolved.
     */
    const applyDiscountCode = Effect.fn(
      "ReservationCheckoutPricing.applyDiscountCode"
    )(function* (
      input: ReservationDiscountCodePriceInput<CustomerReservation, Quote>
    ) {
      const { affirmation, pricing, quote } = yield* affirmDisplayedPrice({
        reservation: input.reservation,
        dotyposCustomerId: input.dotyposCustomerId,
        locale: input.locale,
        quote: input.quote,
        bookedAt: input.bookedAt,
        ...getReferralCode(input),
      });
      const displayedSummary = domain.getCheckoutSummary({
        reservation: input.reservation,
        quote: input.quote,
      });
      const affirmedSummary = domain.getCheckoutSummary({
        reservation: input.reservation,
        quote,
      });
      const displayedPriceIsCurrent =
        quote.fingerprint === input.quote.fingerprint &&
        moneyEquals(affirmedSummary.total, displayedSummary.total);

      if (!displayedPriceIsCurrent) {
        const verdict: ReservationDiscountCodeVerdict<
          CustomerReservation,
          Quote
        > = {
          status: "pricing_changed",
          priced: {
            kind: input.reservation.kind,
            reservation: input.reservation,
            quote,
          },
          changedKeys: getCheckoutSummaryChangedKeys(
            displayedSummary,
            affirmedSummary
          ),
        };
        return verdict;
      }

      const appliedCode = yield* discounts.applyDiscountCode({
        baseQuote: affirmation.quote,
        dotyposCustomerId: input.dotyposCustomerId,
        firstServiceDate: pricing.discountInput.firstServiceDate,
        locale: input.locale,
        submittedCode: input.submittedCode,
        ...getReferralCode(input),
      });
      const appliedQuote = yield* domain.buildQuote({
        pricing,
        discountQuote: appliedCode.quote,
      });

      const verdict: ReservationDiscountCodeVerdict<
        CustomerReservation,
        Quote
      > = {
        status: "affirmed",
        priced: {
          kind: input.reservation.kind,
          reservation: input.reservation,
          quote: appliedQuote,
          submittedCodeDiscountId: appliedCode.application.discount.id,
        },
      };
      return verdict;
    });

    /**
     * Re-prices a signed order without its entered code: the other displayed
     * discounts affirmed again and stacked afresh, never the code's amount
     * taken back off. A discount a provider could not answer for fails, as
     * at payment.
     */
    const clearDiscountCode = Effect.fn(
      "ReservationCheckoutPricing.clearDiscountCode"
    )(function* (
      input: ReservationDiscountCodeClearInput<CustomerReservation, Quote>
    ) {
      const { quote } = yield* affirmDisplayedPrice({
        reservation: input.reservation,
        dotyposCustomerId: input.dotyposCustomerId,
        locale: input.locale,
        quote: input.quote,
        bookedAt: input.bookedAt,
        removedDiscountId: input.submittedCodeDiscountId,
        ...getReferralCode(input),
      });
      const summarize = (summarized: Quote) =>
        domain.getCheckoutSummary({
          reservation: input.reservation,
          quote: summarized,
        });

      return {
        kind: input.reservation.kind,
        reservation: input.reservation,
        quote,
        changedKeys: getCheckoutSummaryChangedKeys(
          summarize(input.quote),
          summarize(quote)
        ),
      };
    });

    return {
      quoteAdvertisement,
      affirmAdvertisement,
      quoteForCustomer,
      repriceForPayment,
      affirmForPayment,
      applyDiscountCode,
      clearDiscountCode,
    };
  });
