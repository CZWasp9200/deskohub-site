import { Context, Effect, Layer, Match } from "effect";
import { DiscountService } from "@/features/discounts/discount.service";
import type { DiscountReleaseGates } from "@/features/discounts/discount-release-gate.service";
import type { Locale } from "@/features/i18n";
import {
  type AdvertisedPriceMismatchError,
  requireAdvertisedPriceStateKind,
} from "./advertised-price-mismatch";
import type { AdvertisedPriceState } from "./advertised-price-state";
import {
  type CoworkAdvertisementAffirmation,
  type CoworkAdvertisementAffirmationInput,
  type CoworkAdvertisementQuote,
  type CoworkAdvertisementQuoteInput,
  type CoworkCheckoutPricingError,
  type CoworkCustomerQuote,
  type CoworkCustomerQuoteInput,
  type CoworkDiscountCodeClearInput,
  type CoworkDiscountCodeClearResult,
  type CoworkDiscountCodePriceInput,
  type CoworkDiscountCodeVerdict,
  type CoworkPaymentPriceAffirmation,
  type CoworkPaymentPriceAffirmationInput,
  type CoworkPaymentRepricingInput,
  coworkCheckoutPricing,
} from "./cowork-checkout-pricing";
import {
  type MeetingRoomAdvertisementAffirmation,
  type MeetingRoomAdvertisementAffirmationInput,
  type MeetingRoomAdvertisementQuote,
  type MeetingRoomAdvertisementQuoteInput,
  type MeetingRoomCheckoutPricingError,
  type MeetingRoomCustomerQuote,
  type MeetingRoomCustomerQuoteInput,
  type MeetingRoomDiscountCodeClearInput,
  type MeetingRoomDiscountCodeClearResult,
  type MeetingRoomDiscountCodePriceInput,
  type MeetingRoomDiscountCodeVerdict,
  type MeetingRoomPaymentPriceAffirmation,
  type MeetingRoomPaymentPriceAffirmationInput,
  type MeetingRoomPaymentRepricingInput,
  meetingRoomCheckoutPricing,
} from "./meeting-room-checkout-pricing";
import {
  type OfficeAdvertisementAffirmation,
  type OfficeAdvertisementAffirmationInput,
  type OfficeAdvertisementQuote,
  type OfficeAdvertisementQuoteInput,
  type OfficeCheckoutPricingError,
  type OfficeCustomerQuote,
  type OfficeCustomerQuoteInput,
  type OfficeDiscountCodeClearInput,
  type OfficeDiscountCodeClearResult,
  type OfficeDiscountCodePriceInput,
  type OfficeDiscountCodeVerdict,
  type OfficePaymentPriceAffirmation,
  type OfficePaymentPriceAffirmationInput,
  type OfficePaymentRepricingInput,
  officeCheckoutPricing,
} from "./office-checkout-pricing";
import type { PriceVerdict } from "./price-verdict";

type CheckoutPricingError =
  | CoworkCheckoutPricingError
  | MeetingRoomCheckoutPricingError
  | OfficeCheckoutPricingError;

type AdvertisementQuoteInput =
  | CoworkAdvertisementQuoteInput
  | MeetingRoomAdvertisementQuoteInput
  | OfficeAdvertisementQuoteInput;

type AdvertisementQuote =
  | CoworkAdvertisementQuote
  | MeetingRoomAdvertisementQuote
  | OfficeAdvertisementQuote;

export type PreparedCustomerQuote =
  | CoworkCustomerQuote
  | MeetingRoomCustomerQuote
  | OfficeCustomerQuote;

export type PaymentRepricingInput =
  | CoworkPaymentRepricingInput
  | MeetingRoomPaymentRepricingInput
  | OfficePaymentRepricingInput;

export type PaymentPriceAffirmationInput =
  | CoworkPaymentPriceAffirmationInput
  | MeetingRoomPaymentPriceAffirmationInput
  | OfficePaymentPriceAffirmationInput;

export type PaymentPriceAffirmation =
  | CoworkPaymentPriceAffirmation
  | MeetingRoomPaymentPriceAffirmation
  | OfficePaymentPriceAffirmation;

type DiscountCodePriceInput =
  | CoworkDiscountCodePriceInput
  | MeetingRoomDiscountCodePriceInput
  | OfficeDiscountCodePriceInput;

type DiscountCodeVerdict =
  | CoworkDiscountCodeVerdict
  | MeetingRoomDiscountCodeVerdict
  | OfficeDiscountCodeVerdict;

type DiscountCodeClearInput =
  | CoworkDiscountCodeClearInput
  | MeetingRoomDiscountCodeClearInput
  | OfficeDiscountCodeClearInput;

type DiscountCodeClearResult =
  | CoworkDiscountCodeClearResult
  | MeetingRoomDiscountCodeClearResult
  | OfficeDiscountCodeClearResult;

/**
 * A submitted reservation with the advertisement snapshot its page issued.
 * The snapshot may name any family; it must match the reservation's.
 */
type AdvertisementAffirmationInput = {
  readonly advertisement: AdvertisedPriceState;
  readonly reservation:
    | CoworkAdvertisementAffirmationInput["reservation"]
    | MeetingRoomAdvertisementAffirmationInput["reservation"]
    | OfficeAdvertisementAffirmationInput["reservation"];
  readonly locale: Locale;
  /** Moment the reservation is submitted and its price is locked. */
  readonly bookedAt: Temporal.Instant;
};

export type AdvertisementAffirmation =
  | CoworkAdvertisementAffirmation
  | MeetingRoomAdvertisementAffirmation
  | OfficeAdvertisementAffirmation;

/** A submitted reservation's customer, with the advertisement's verdict. */
export type CustomerQuoteInput = Omit<
  | CoworkCustomerQuoteInput
  | MeetingRoomCustomerQuoteInput
  | OfficeCustomerQuoteInput,
  "advertisement"
> & {
  readonly advertisement: PriceVerdict<AdvertisementAffirmation>;
};

export interface ICheckoutPricingService {
  readonly quoteAdvertisement: (
    input: AdvertisementQuoteInput
  ) => Effect.Effect<AdvertisementQuote, CheckoutPricingError>;
  /**
   * Affirms the advertised price at reservation submission. The price
   * changed when the discounts re-evaluated at the booking moment give a
   * different quote than the snapshot's. A snapshot of another reservation,
   * family, or locale fails; an unanswered discount provider fails too.
   */
  readonly affirmAdvertisement: (
    input: AdvertisementAffirmationInput
  ) => Effect.Effect<
    PriceVerdict<AdvertisementAffirmation>,
    AdvertisedPriceMismatchError | CheckoutPricingError
  >;
  /**
   * Quotes a submitted reservation for its resolved customer. The price
   * changed when the advertisement's verdict says so, or when full validation
   * moved the advertised query code; discounts of the customer may appear for
   * the first time without a change. An unanswered discount provider fails.
   */
  readonly quoteForCustomer: (
    input: CustomerQuoteInput
  ) => Effect.Effect<PriceVerdict<PreparedCustomerQuote>, CheckoutPricingError>;
  /**
   * Re-prices a signed order for its payment without judging the signed
   * price, as claim-admission recovery does.
   */
  readonly repriceForPayment: (
    input: PaymentRepricingInput
  ) => Effect.Effect<PaymentPriceAffirmation, CheckoutPricingError>;
  /**
   * Affirms the signed price before payment. The price changed when the
   * re-priced quote's fingerprint differs from the signed one or its total
   * from the accepted total. An unanswered discount provider fails.
   */
  readonly affirmForPayment: (
    input: PaymentPriceAffirmationInput
  ) => Effect.Effect<
    PriceVerdict<PaymentPriceAffirmation>,
    CheckoutPricingError
  >;
  /**
   * Prices an entered code on the displayed price. The price changed when
   * the affirmed quote's fingerprint or total differs from the displayed one;
   * the verdict then carries the refreshed price without the code. An
   * unavailable code or an unanswered discount provider fails.
   */
  readonly applyDiscountCode: (
    input: DiscountCodePriceInput
  ) => Effect.Effect<DiscountCodeVerdict, CheckoutPricingError>;
  /**
   * Re-prices a signed order without its entered code, affirming the other
   * displayed discounts again. An unanswered discount provider fails.
   */
  readonly clearDiscountCode: (
    input: DiscountCodeClearInput
  ) => Effect.Effect<DiscountCodeClearResult, CheckoutPricingError>;
}

export class CheckoutPricingService extends Context.Service<
  CheckoutPricingService,
  ICheckoutPricingService
>()("@deskohub-workspace/checkout/CheckoutPricingService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const cowork = yield* coworkCheckoutPricing;
      const meetingRoom = yield* meetingRoomCheckoutPricing;
      const office = yield* officeCheckoutPricing;

      const quoteAdvertisement = Effect.fn(
        "CheckoutPricingService.quoteAdvertisement"
      )((input: AdvertisementQuoteInput) =>
        Match.value(input).pipe(
          Match.when({ reservation: { kind: "cowork" } }, (coworkInput) =>
            cowork.quoteAdvertisement(coworkInput)
          ),
          Match.when(
            { reservation: { kind: "meeting-room" } },
            (meetingRoomInput) =>
              meetingRoom.quoteAdvertisement(meetingRoomInput)
          ),
          Match.when({ reservation: { kind: "office" } }, (officeInput) =>
            office.quoteAdvertisement(officeInput)
          ),
          Match.exhaustive
        )
      );

      const affirmAdvertisement = Effect.fn(
        "CheckoutPricingService.affirmAdvertisement"
      )((input: AdvertisementAffirmationInput) =>
        Match.value(input.reservation).pipe(
          Match.discriminatorsExhaustive("kind")({
            cowork: (reservation) =>
              requireAdvertisedPriceStateKind(reservation.kind)(
                input.advertisement
              ).pipe(
                Effect.flatMap((advertisement) =>
                  cowork.affirmAdvertisement({
                    ...input,
                    advertisement,
                    reservation,
                  })
                )
              ),
            "meeting-room": (reservation) =>
              requireAdvertisedPriceStateKind(reservation.kind)(
                input.advertisement
              ).pipe(
                Effect.flatMap((advertisement) =>
                  meetingRoom.affirmAdvertisement({
                    ...input,
                    advertisement,
                    reservation,
                  })
                )
              ),
            office: (reservation) =>
              requireAdvertisedPriceStateKind(reservation.kind)(
                input.advertisement
              ).pipe(
                Effect.flatMap((advertisement) =>
                  office.affirmAdvertisement({
                    ...input,
                    advertisement,
                    reservation,
                  })
                )
              ),
          })
        )
      );

      const quoteForCustomer = Effect.fn(
        "CheckoutPricingService.quoteForCustomer"
      )((input: CustomerQuoteInput) => {
        const { advertisement } = input;
        return Match.value(advertisement.priced).pipe(
          Match.discriminatorsExhaustive("kind")({
            cowork: (priced) =>
              cowork.quoteForCustomer({
                ...input,
                advertisement: { ...advertisement, priced },
              }),
            "meeting-room": (priced) =>
              meetingRoom.quoteForCustomer({
                ...input,
                advertisement: { ...advertisement, priced },
              }),
            office: (priced) =>
              office.quoteForCustomer({
                ...input,
                advertisement: { ...advertisement, priced },
              }),
          })
        );
      });

      const repriceForPayment = Effect.fn(
        "CheckoutPricingService.repriceForPayment"
      )((input: PaymentRepricingInput) =>
        Match.value(input).pipe(
          Match.when({ reservation: { kind: "cowork" } }, (coworkInput) =>
            cowork.repriceForPayment(coworkInput)
          ),
          Match.when(
            { reservation: { kind: "meeting-room" } },
            (meetingRoomInput) =>
              meetingRoom.repriceForPayment(meetingRoomInput)
          ),
          Match.when({ reservation: { kind: "office" } }, (officeInput) =>
            office.repriceForPayment(officeInput)
          ),
          Match.exhaustive
        )
      );

      const affirmForPayment = Effect.fn(
        "CheckoutPricingService.affirmForPayment"
      )((input: PaymentPriceAffirmationInput) =>
        Match.value(input).pipe(
          Match.when({ reservation: { kind: "cowork" } }, (coworkInput) =>
            cowork.affirmForPayment(coworkInput)
          ),
          Match.when(
            { reservation: { kind: "meeting-room" } },
            (meetingRoomInput) => meetingRoom.affirmForPayment(meetingRoomInput)
          ),
          Match.when({ reservation: { kind: "office" } }, (officeInput) =>
            office.affirmForPayment(officeInput)
          ),
          Match.exhaustive
        )
      );

      const applyDiscountCode = Effect.fn(
        "CheckoutPricingService.applyDiscountCode"
      )((input: DiscountCodePriceInput) =>
        Match.value(input).pipe(
          Match.when({ reservation: { kind: "cowork" } }, (coworkInput) =>
            cowork.applyDiscountCode(coworkInput)
          ),
          Match.when(
            { reservation: { kind: "meeting-room" } },
            (meetingRoomInput) =>
              meetingRoom.applyDiscountCode(meetingRoomInput)
          ),
          Match.when({ reservation: { kind: "office" } }, (officeInput) =>
            office.applyDiscountCode(officeInput)
          ),
          Match.exhaustive
        )
      );

      const clearDiscountCode = Effect.fn(
        "CheckoutPricingService.clearDiscountCode"
      )((input: DiscountCodeClearInput) =>
        Match.value(input).pipe(
          Match.when({ reservation: { kind: "cowork" } }, (coworkInput) =>
            cowork.clearDiscountCode(coworkInput)
          ),
          Match.when(
            { reservation: { kind: "meeting-room" } },
            (meetingRoomInput) =>
              meetingRoom.clearDiscountCode(meetingRoomInput)
          ),
          Match.when({ reservation: { kind: "office" } }, (officeInput) =>
            office.clearDiscountCode(officeInput)
          ),
          Match.exhaustive
        )
      );

      return {
        quoteAdvertisement,
        affirmAdvertisement,
        quoteForCustomer,
        repriceForPayment,
        affirmForPayment,
        applyDiscountCode,
        clearDiscountCode,
      } satisfies ICheckoutPricingService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(DiscountService.Live));

  /**
   * Live pricing under discount release gates the caller already decided,
   * for work that must not read the request, such as a cached render.
   */
  static withDiscountReleaseGates = (gates: DiscountReleaseGates) =>
    this.Default.pipe(Layer.provide(DiscountService.withReleaseGates(gates)));
}
