import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Schema } from "effect";
import { getOfficeEditPriceSummary } from "@/features/checkout/checkout-summary-office";
import { makeDiscountCommitment } from "@/features/discounts/commitment";
import {
  affirmedDiscountAdvertisementQuoteCodec,
  type CanonicalPromotionCode,
  canonicalPromotionCodeSchema,
  type DiscountAdvertisementInput,
  discountAdvertisementQuoteCodec,
  discountIdSchema,
  discountQuoteCodec,
} from "@/features/discounts/contracts";
import { DiscountServiceMock } from "@/features/discounts/discount.service.mock";
import {
  DiscountAffirmationUnavailableError,
  PromotionCodeUnavailableError,
} from "@/features/discounts/errors";
import type { Locale } from "@/features/i18n";
import { getCoworkAdvertisedPriceReservation } from "@/features/reservation/cowork-reservation";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import {
  getMeetingRoomAdvertisedPriceReservation,
  normalizeMeetingRoomReservationOrder,
} from "@/features/reservation/meeting-room-reservation";
import {
  getOfficeAdvertisedPriceReservation,
  officeReservationOrderSchema,
} from "@/features/reservation/office-reservation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import type {
  CheckoutPricingService as CheckoutPricing,
  ICheckoutPricingService,
} from "./checkout-pricing.service";

mock.module("server-only", () => ({}));

const { buildAdvertisedPriceState } = await import("./advertised-price-state");
const { CheckoutPricingService } = await import("./checkout-pricing.service");

const contact = {
  name: "Ada Lovelace",
  email: testEmailAddress("ada"),
  phone: "+420 777 777 777",
};
const bookedAt = Temporal.Instant.from("2099-06-01T10:00:00Z");
const saleId = Schema.decodeUnknownSync(discountIdSchema)("autumn-sale");
const extraId = Schema.decodeUnknownSync(discountIdSchema)("extra");
const queryCode = Schema.decodeUnknownSync(canonicalPromotionCodeSchema)(
  "AUTUMN"
);
const dotyposCustomerId = Schema.decodeUnknownSync(dotyposCustomerIdSchema)(
  "customer-id"
);

type DiscountedProduct = Pick<
  DiscountAdvertisementInput,
  "product" | "discountableSubtotal"
>;

/** Half off the product, as one advertised sale. */
const halfOffSale = ({ product, discountableSubtotal }: DiscountedProduct) => {
  const amount = {
    ...discountableSubtotal,
    value: discountableSubtotal.value / 2,
  };
  const discountedSubtotal = {
    ...discountableSubtotal,
    value: discountableSubtotal.value - amount.value,
  };
  return discountAdvertisementQuoteCodec.make({
    product,
    discountableSubtotal,
    discounts: [
      {
        discount: {
          id: saleId,
          label: "Autumn sale",
          adjustment: { kind: "percentage", basisPoints: 5000 },
        },
        subtotalBefore: discountableSubtotal,
        amount,
        subtotalAfter: discountedSubtotal,
      },
    ],
    totalDiscount: amount,
    discountedSubtotal,
  });
};

const noSale = ({ product, discountableSubtotal }: DiscountedProduct) =>
  discountAdvertisementQuoteCodec.make({
    product,
    discountableSubtotal,
    discounts: [],
    totalDiscount: { ...discountableSubtotal, value: 0 },
    discountedSubtotal: discountableSubtotal,
  });

const run = <A, E>(
  effect: Effect.Effect<A, E, CheckoutPricing>,
  discounts: ReturnType<typeof DiscountServiceMock>
) =>
  effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        CheckoutPricingService.Default.pipe(Layer.provide(discounts)),
        TestSealedStateKeys
      )
    ),
    Effect.runPromise
  );

/** The snapshot a reservation page issues while the sale runs. */
const advertise = (
  input: Parameters<ICheckoutPricingService["quoteAdvertisement"]>[0]
) =>
  CheckoutPricingService.pipe(
    Effect.flatMap((pricing) => pricing.quoteAdvertisement(input)),
    Effect.flatMap((advertised) =>
      buildAdvertisedPriceState({ ...advertised, locale: input.locale })
    ),
    Effect.provide(
      Layer.mergeAll(
        CheckoutPricingService.Default.pipe(
          Layer.provide(
            DiscountServiceMock({
              discoverAdvertisedDiscounts: (discountInput) =>
                Effect.succeed({
                  quote: halfOffSale(discountInput),
                  complete: true,
                }),
            })
          )
        ),
        TestSealedStateKeys
      )
    ),
    Effect.runPromise
  );

const coworkOrder = {
  kind: "cowork" as const,
  entryTier: "basic" as const,
  coffee: true,
  date: "2099-07-30",
  ...contact,
};

const meetingRoomOrder = await normalizeMeetingRoomReservationOrder({
  kind: "meeting-room",
  duration: { unit: "hour", amount: 4 },
  reservationDate: "2099-06-10",
  startsAt: "2099-06-10T10:00",
  endsAt: "2099-06-10T14:00",
  ...contact,
}).pipe(Effect.runPromise);

const officeStartsOn = getCurrentWorkspaceDate().add({ days: 1 });
const officeOrder = Schema.decodeUnknownSync(
  officeReservationOrderSchema("CZ")
)({
  kind: "office",
  startsOn: officeStartsOn.toString(),
  endsOn: officeStartsOn.add({ days: 1 }).toString(),
  seats: 3,
  ...contact,
});

const families = [
  {
    kind: "cowork",
    order: coworkOrder,
    /** The same family with an input that changes the price. */
    otherOrder: { ...coworkOrder, coffee: false },
    advertise: (locale: Locale) =>
      advertise({
        reservation: getCoworkAdvertisedPriceReservation(coworkOrder),
        locale,
      }),
    changedKeys: {
      sectionKeys: ["order", "total"],
      itemKeys: ["product:cowork:basic", "total:final"],
    },
  },
  {
    kind: "meeting-room",
    order: meetingRoomOrder,
    otherOrder: {
      ...meetingRoomOrder,
      duration: { unit: "hour", amount: 1 },
    },
    advertise: (locale: Locale) =>
      advertise({
        reservation: getMeetingRoomAdvertisedPriceReservation(meetingRoomOrder),
        locale,
      }),
    changedKeys: {
      sectionKeys: ["order", "total"],
      itemKeys: ["product:meeting-room:hour:4", "total:final"],
    },
  },
  {
    kind: "office",
    order: officeOrder,
    otherOrder: { ...officeOrder, seats: 4 },
    advertise: (locale: Locale) =>
      advertise({
        reservation: getOfficeAdvertisedPriceReservation(officeOrder),
        locale,
      }),
    changedKeys: {
      sectionKeys: ["order", "total"],
      itemKeys: ["product:office:3:2", "total:final"],
    },
  },
] as const;

describe("CheckoutPricingService.affirmAdvertisement", () => {
  describe.each(families)("$kind", (family) => {
    const affirm = async (input: {
      readonly reservation?: (typeof families)[number]["order"];
      readonly advertisedIn?: Locale;
      readonly affirmAdvertisement: Parameters<
        typeof DiscountServiceMock
      >[0]["affirmAdvertisement"];
    }) => {
      const advertisement = await family.advertise(
        input.advertisedIn ?? "en-US"
      );
      const affirmAdvertisement = mock(input.affirmAdvertisement);
      const result = await run(
        CheckoutPricingService.pipe(
          Effect.flatMap((pricing) =>
            pricing.affirmAdvertisement({
              advertisement,
              reservation: input.reservation ?? family.order,
              locale: "en-US",
              bookedAt,
            })
          ),
          Effect.result
        ),
        DiscountServiceMock({ affirmAdvertisement })
      );
      return { advertisement, affirmAdvertisement, result };
    };

    test("affirms the advertised price while its discounts still apply", async () => {
      const { advertisement, affirmAdvertisement, result } = await affirm({
        affirmAdvertisement: (discountInput) =>
          Effect.succeed(
            affirmedDiscountAdvertisementQuoteCodec.make(
              halfOffSale(discountInput)
            )
          ),
      });

      expect(affirmAdvertisement).toHaveBeenCalledWith(
        expect.objectContaining({
          bookedAt,
          locale: "en-US",
          advertisedDiscountIds: [saleId],
        })
      );
      expect(result).toMatchObject({
        _tag: "Success",
        success: {
          status: "affirmed",
          priced: {
            kind: family.kind,
            reservation: family.order,
            advertisedQuote: advertisement.quote,
            discountQuote: { discounts: [{ discount: { id: saleId } }] },
          },
        },
      });
      expect(result).not.toHaveProperty("success.changedKeys");
    });

    test("names the changed summary keys when an advertised discount is gone", async () => {
      const { advertisement, result } = await affirm({
        affirmAdvertisement: (discountInput) =>
          Effect.succeed(
            affirmedDiscountAdvertisementQuoteCodec.make(noSale(discountInput))
          ),
      });

      expect(result).toMatchObject({
        _tag: "Success",
        success: {
          status: "pricing_changed",
          priced: {
            kind: family.kind,
            reservation: family.order,
            advertisedQuote: advertisement.quote,
            discountQuote: { discounts: [] },
          },
          changedKeys: family.changedKeys,
        },
      });
    });

    test("rejects a snapshot of another locale or reservation before pricing", async () => {
      for (const mismatch of [
        { advertisedIn: "cs-CZ" as const },
        { reservation: family.otherOrder },
      ]) {
        const { affirmAdvertisement, result } = await affirm({
          ...mismatch,
          affirmAdvertisement: () => Effect.die("must not affirm"),
        });

        expect(result).toMatchObject({
          _tag: "Failure",
          failure: {
            _tag: "AdvertisedPriceMismatchError",
            reason: "input_mismatch",
          },
        });
        expect(affirmAdvertisement).not.toHaveBeenCalled();
      }
    });

    test("keeps an unknown discount a retryable failure, never a changed price", async () => {
      const { result } = await affirm({
        affirmAdvertisement: () =>
          Effect.fail(
            new DiscountAffirmationUnavailableError({
              message: "The sale could not be affirmed.",
              discountIds: [saleId],
            })
          ),
      });

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "DiscountAffirmationUnavailableError",
          discountIds: [saleId],
        },
      });
    });
  });

  test("rejects a snapshot of another reservation family before pricing", async () => {
    const advertisement = await families[0].advertise("en-US");
    const affirmAdvertisement = mock(() => Effect.die("must not affirm"));

    const result = await run(
      CheckoutPricingService.pipe(
        Effect.flatMap((pricing) =>
          pricing.affirmAdvertisement({
            advertisement,
            reservation: officeOrder,
            locale: "en-US",
            bookedAt,
          })
        ),
        Effect.result
      ),
      DiscountServiceMock({ affirmAdvertisement })
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "AdvertisedPriceMismatchError",
        reason: "input_mismatch",
      },
    });
    expect(affirmAdvertisement).not.toHaveBeenCalled();
  });
});

/** The discounts payment or code entry affirms again, with an empty commitment. */
const displayed =
  (quote: typeof halfOffSale) =>
  (
    input: DiscountedProduct &
      Pick<DiscountAdvertisementInput, "firstServiceDate">
  ) =>
    Effect.succeed({
      quote: discountQuoteCodec.make(quote(input)),
      commitment: makeDiscountCommitment({
        product: input.product,
        firstServiceDate: input.firstServiceDate,
        applications: [],
      }),
    });

/** A quote with one more 10% discount, such as a customer discount or a code. */
const withExtraDiscount = (
  quote: ReturnType<typeof halfOffSale>,
  label: string
) => {
  const amount = {
    ...quote.discountedSubtotal,
    value: quote.discountedSubtotal.value / 10,
  };
  const discountedSubtotal = {
    ...quote.discountedSubtotal,
    value: quote.discountedSubtotal.value - amount.value,
  };
  const application = {
    discount: {
      id: extraId,
      label,
      adjustment: { kind: "percentage" as const, basisPoints: 1000 },
    },
    subtotalBefore: quote.discountedSubtotal,
    amount,
    subtotalAfter: discountedSubtotal,
  };
  return {
    application,
    quote: discountQuoteCodec.make({
      ...quote,
      discounts: [...quote.discounts, application],
      totalDiscount: {
        ...quote.totalDiscount,
        value: quote.totalDiscount.value + amount.value,
      },
      discountedSubtotal,
    }),
  };
};

describe("CheckoutPricingService.quoteForCustomer", () => {
  test.each([
    ["amount", "pricing_changed", ["product:office:3:2", "total:final"]],
    ["currency", "pricing_changed", ["product:office:3:2", "total:final"]],
    ["public label", "pricing_changed", ["product:office:3:2"]],
    ["staff label", "affirmed", []],
    [
      "both boundaries",
      "pricing_changed",
      ["product:office:3:2", "total:final"],
    ],
  ] as const)(
    "reviews changes from the displayed office hold (%s)",
    async (change, status, itemKeys) => {
      const advertisement = await families[2].advertise("en-US");
      const result = await run(
        Effect.gen(function* () {
          const pricing = yield* CheckoutPricingService;
          const affirmed = yield* pricing.affirmAdvertisement({
            advertisement,
            bookedAt,
            locale: "en-US",
            reservation: officeOrder,
          });
          if (affirmed.priced.kind !== "office")
            throw new Error("Expected an office quote");
          const quote = affirmed.priced.advertisedQuote;
          const item = quote.items[0];
          const both = change === "both boundaries";
          const total = affirmed.priced.discountQuote.discountedSubtotal;
          const displayedOfficePrice = getOfficeEditPriceSummary({
            ...quote,
            items: [
              both
                ? {
                    ...item,
                    accessAmount: {
                      ...item.accessAmount,
                      value: item.accessAmount.value + 300,
                    },
                    seatAmount: {
                      ...item.seatAmount,
                      value: item.seatAmount.value - 100,
                    },
                  }
                : item,
            ],
            payment: {
              ...quote.payment,
              expectedPrice: {
                ...total,
                value: change === "amount" ? total.value - 100 : total.value,
                currency: change === "currency" ? "EUR" : total.currency,
              },
              discounts: both
                ? []
                : quote.payment.discounts.map((applied) => ({
                    ...applied,
                    discount: {
                      ...applied.discount,
                      ...(change === "public label" && {
                        label: "Earlier public label",
                      }),
                      ...(change === "staff label" && {
                        staffLabel: "Earlier staff label",
                      }),
                    },
                  })),
            },
          });
          const verdict = yield* pricing.quoteForCustomer({
            advertisement: affirmed,
            displayedOfficePrice,
            dotyposCustomerId,
            locale: "en-US",
          });
          return { verdict, total };
        }),
        DiscountServiceMock({
          affirmAdvertisement: (input) =>
            Effect.succeed(
              affirmedDiscountAdvertisementQuoteCodec.make(
                change === "both boundaries"
                  ? noSale(input)
                  : halfOffSale(input)
              )
            ),
          applyCustomerDiscount: ({ affirmedAdvertisement }) =>
            Effect.succeed({
              ...affirmedAdvertisement,
              ...(change === "staff label" && {
                discounts: affirmedAdvertisement.discounts.map((applied) => ({
                  ...applied,
                  discount: {
                    ...applied.discount,
                    staffLabel: "Current staff label",
                  },
                })),
              }),
              advertisedPriceChanged: false,
            }),
        })
      );

      expect(result.verdict.status).toBe(status);
      expect(result.verdict.priced.quote.payment.expectedPrice).toEqual(
        result.total
      );
      if (result.verdict.status === "pricing_changed") {
        expect(result.verdict.changedKeys.itemKeys).toEqual(itemKeys);
        if (change === "both boundaries") {
          expect(result.verdict.changedKeys.sectionKeys).toEqual([
            "order",
            "total",
          ]);
        }
      }
    }
  );

  describe.each(families)("$kind", (family) => {
    /**
     * Affirms the advertised sale at submission, kept or gone, then quotes
     * the reservation for its customer. With `advertisedCode`, the sale is
     * the discount of the query code the page advertised.
     */
    const quoteForCustomer = async (input: {
      readonly advertisedSaleGone?: boolean;
      readonly advertisedCode?: CanonicalPromotionCode;
      readonly applyCustomerDiscount: Parameters<
        typeof DiscountServiceMock
      >[0]["applyCustomerDiscount"];
    }) => {
      const advertisement = await family.advertise("en-US");
      const applyCustomerDiscount = mock(input.applyCustomerDiscount);
      const result = await run(
        CheckoutPricingService.pipe(
          Effect.flatMap((pricing) =>
            pricing
              .affirmAdvertisement({
                advertisement,
                reservation: family.order,
                locale: "en-US",
                bookedAt,
              })
              .pipe(
                Effect.map((advertisementVerdict) =>
                  input.advertisedCode === undefined
                    ? advertisementVerdict
                    : {
                        ...advertisementVerdict,
                        priced: {
                          ...advertisementVerdict.priced,
                          submittedCode: input.advertisedCode,
                          submittedCodeDiscountId: saleId,
                        },
                      }
                ),
                Effect.flatMap((advertisementVerdict) =>
                  pricing.quoteForCustomer({
                    advertisement: advertisementVerdict,
                    dotyposCustomerId,
                    locale: "en-US",
                  })
                )
              )
          ),
          Effect.result
        ),
        DiscountServiceMock({
          affirmAdvertisement: (discountInput) =>
            Effect.succeed(
              affirmedDiscountAdvertisementQuoteCodec.make(
                input.advertisedSaleGone
                  ? noSale(discountInput)
                  : halfOffSale(discountInput)
              )
            ),
          applyCustomerDiscount,
        })
      );
      return { advertisement, applyCustomerDiscount, result };
    };

    test("affirms the advertised price for the customer", async () => {
      const { applyCustomerDiscount, result } = await quoteForCustomer({
        applyCustomerDiscount: ({ affirmedAdvertisement }) =>
          Effect.succeed({
            ...affirmedAdvertisement,
            advertisedPriceChanged: false,
          }),
      });

      expect(applyCustomerDiscount).toHaveBeenCalledWith(
        expect.objectContaining({ dotyposCustomerId, locale: "en-US" })
      );
      expect(result).toMatchObject({
        _tag: "Success",
        success: {
          status: "affirmed",
          priced: {
            kind: family.kind,
            reservation: family.order,
            quote: { payment: { discounts: [{ discount: { id: saleId } }] } },
          },
        },
      });
      expect(result).not.toHaveProperty("success.changedKeys");
    });

    test("affirms the price when only the customer discount first appears", async () => {
      const { result } = await quoteForCustomer({
        applyCustomerDiscount: ({ affirmedAdvertisement }) =>
          Effect.succeed({
            ...withExtraDiscount(affirmedAdvertisement, "Customer discount")
              .quote,
            advertisedPriceChanged: false,
          }),
      });

      expect(result).toMatchObject({
        _tag: "Success",
        success: {
          status: "affirmed",
          priced: {
            quote: {
              payment: {
                discounts: [
                  { discount: { id: saleId } },
                  { discount: { id: extraId } },
                ],
              },
            },
          },
        },
      });
      expect(result).not.toHaveProperty("success.changedKeys");
    });

    test("keeps the advertisement's changed price, with keys from the advertised summary", async () => {
      const { result } = await quoteForCustomer({
        advertisedSaleGone: true,
        applyCustomerDiscount: ({ affirmedAdvertisement }) =>
          Effect.succeed({
            ...affirmedAdvertisement,
            advertisedPriceChanged: false,
          }),
      });

      expect(result).toMatchObject({
        _tag: "Success",
        success: {
          status: "pricing_changed",
          priced: {
            kind: family.kind,
            reservation: family.order,
            quote: { payment: { discounts: [] } },
          },
          changedKeys: family.changedKeys,
        },
      });
    });

    test("keeps an advertised query code that passes full validation", async () => {
      const { applyCustomerDiscount, result } = await quoteForCustomer({
        advertisedCode: queryCode,
        applyCustomerDiscount: ({ affirmedAdvertisement }) =>
          Effect.succeed({
            ...affirmedAdvertisement,
            advertisedPriceChanged: false,
            submittedCodeDiscountId: saleId,
          }),
      });

      expect(applyCustomerDiscount).toHaveBeenCalledWith(
        expect.objectContaining({
          submittedCode: queryCode,
          submittedCodeDiscountId: saleId,
        })
      );
      expect(result).toMatchObject({
        _tag: "Success",
        success: {
          status: "affirmed",
          priced: { submittedCode: queryCode, submittedCodeDiscountId: saleId },
        },
      });
      expect(result).not.toHaveProperty("success.changedKeys");
    });

    test("reports a changed price without the advertised query code when full validation drops it", async () => {
      const { result } = await quoteForCustomer({
        advertisedCode: queryCode,
        applyCustomerDiscount: ({ affirmedAdvertisement }) =>
          Effect.succeed({
            ...discountQuoteCodec.make(noSale(affirmedAdvertisement)),
            advertisedPriceChanged: true,
          }),
      });

      expect(result).toMatchObject({
        _tag: "Success",
        success: {
          status: "pricing_changed",
          priced: { quote: { payment: { discounts: [] } } },
          changedKeys: family.changedKeys,
        },
      });
      expect(result).not.toHaveProperty("success.priced.submittedCode");
      expect(result).not.toHaveProperty(
        "success.priced.submittedCodeDiscountId"
      );
    });

    test("keeps an unknown discount a retryable failure, never a changed price", async () => {
      const { result } = await quoteForCustomer({
        applyCustomerDiscount: () =>
          Effect.fail(
            new DiscountAffirmationUnavailableError({
              message: "The query code could not be affirmed.",
              discountIds: [saleId],
            })
          ),
      });

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "DiscountAffirmationUnavailableError",
          discountIds: [saleId],
        },
      });
    });
  });
});

describe("CheckoutPricingService.applyDiscountCode", () => {
  const submittedCode = Schema.decodeUnknownSync(canonicalPromotionCodeSchema)(
    "SAVE10"
  );

  describe.each(families)("$kind", (family) => {
    /** Enters a code on the displayed advertised sale price. */
    const enterCode = async (input: {
      readonly displayedTotal?: (displayed: number) => number;
      readonly affirmDisplayedDiscounts: Parameters<
        typeof DiscountServiceMock
      >[0]["affirmDisplayedDiscounts"];
      readonly applyDiscountCode?: Parameters<
        typeof DiscountServiceMock
      >[0]["applyDiscountCode"];
    }) => {
      const advertised = (await family.advertise("en-US")).quote;
      const displayedQuote = input.displayedTotal
        ? {
            ...advertised,
            payment: {
              ...advertised.payment,
              expectedPrice: {
                ...advertised.payment.expectedPrice,
                value: input.displayedTotal(
                  advertised.payment.expectedPrice.value
                ),
              },
            },
          }
        : advertised;
      const applyDiscountCode = mock(
        input.applyDiscountCode ??
          (({ baseQuote }) =>
            Effect.succeed(withExtraDiscount(baseQuote, "Member code")))
      );
      const result = await run(
        CheckoutPricingService.pipe(
          Effect.flatMap((pricing) =>
            pricing.applyDiscountCode({
              reservation: family.order,
              dotyposCustomerId,
              locale: "en-US",
              quote: displayedQuote,
              bookedAt,
              submittedCode,
            } as Parameters<ICheckoutPricingService["applyDiscountCode"]>[0])
          ),
          Effect.result
        ),
        DiscountServiceMock({
          affirmDisplayedDiscounts: input.affirmDisplayedDiscounts,
          applyDiscountCode,
        })
      );
      return { displayedQuote, applyDiscountCode, result };
    };

    test("affirms the displayed price and applies the code", async () => {
      const { applyDiscountCode, result } = await enterCode({
        affirmDisplayedDiscounts: displayed(halfOffSale),
      });

      expect(applyDiscountCode).toHaveBeenCalledWith(
        expect.objectContaining({ dotyposCustomerId, submittedCode })
      );
      expect(result).toMatchObject({
        _tag: "Success",
        success: {
          status: "affirmed",
          priced: {
            kind: family.kind,
            reservation: family.order,
            submittedCodeDiscountId: extraId,
            quote: {
              payment: {
                discounts: [
                  { discount: { id: saleId } },
                  { discount: { id: extraId } },
                ],
              },
            },
          },
        },
      });
      expect(result).not.toHaveProperty("success.changedKeys");
    });

    test("returns the refreshed price without the code when a displayed discount is gone", async () => {
      const { applyDiscountCode, result } = await enterCode({
        affirmDisplayedDiscounts: displayed(noSale),
      });

      expect(result).toMatchObject({
        _tag: "Success",
        success: {
          status: "pricing_changed",
          priced: {
            kind: family.kind,
            reservation: family.order,
            quote: { payment: { discounts: [] } },
          },
          changedKeys: family.changedKeys,
        },
      });
      expect(result).not.toHaveProperty(
        "success.priced.submittedCodeDiscountId"
      );
      expect(applyDiscountCode).not.toHaveBeenCalled();
    });

    test("reports a changed price when the quote holds but the displayed total differs", async () => {
      const { displayedQuote, applyDiscountCode, result } = await enterCode({
        displayedTotal: (total) => total + 100,
        affirmDisplayedDiscounts: displayed(halfOffSale),
      });

      expect(result).toMatchObject({
        _tag: "Success",
        success: {
          status: "pricing_changed",
          priced: { quote: { fingerprint: displayedQuote.fingerprint } },
          changedKeys: {
            sectionKeys: expect.arrayContaining(["total"]),
            itemKeys: expect.arrayContaining(["total:final"]),
          },
        },
      });
      expect(applyDiscountCode).not.toHaveBeenCalled();
    });

    test("fails with the code's unavailability, leaving the displayed price to the caller", async () => {
      const { result } = await enterCode({
        affirmDisplayedDiscounts: displayed(halfOffSale),
        applyDiscountCode: () =>
          Effect.fail(
            new PromotionCodeUnavailableError({
              reason: "unknown_code",
              message: "The submitted promotion code does not exist.",
            })
          ),
      });

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "PromotionCodeUnavailableError" },
      });
    });

    test("keeps an unknown displayed discount a failure, never a changed price", async () => {
      const { applyDiscountCode, result } = await enterCode({
        affirmDisplayedDiscounts: () =>
          Effect.fail(
            new DiscountAffirmationUnavailableError({
              message: "The sale could not be affirmed.",
              discountIds: [saleId],
            })
          ),
      });

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "DiscountAffirmationUnavailableError",
          discountIds: [saleId],
        },
      });
      expect(applyDiscountCode).not.toHaveBeenCalled();
    });
  });
});

describe("CheckoutPricingService.affirmForPayment", () => {
  describe.each(families)("$kind", (family) => {
    /** Signs the advertised sale price, then affirms it for payment. */
    const affirmSigned = async (input: {
      readonly acceptedTotal?: (signed: number) => number;
      readonly affirmDisplayedDiscounts: Parameters<
        typeof DiscountServiceMock
      >[0]["affirmDisplayedDiscounts"];
    }) => {
      const signed = (await family.advertise("en-US")).quote;
      const signedTotal = signed.payment.expectedPrice;
      const acceptedTotal = {
        ...signedTotal,
        value: input.acceptedTotal?.(signedTotal.value) ?? signedTotal.value,
      };
      const affirmDisplayedDiscounts = mock(input.affirmDisplayedDiscounts);
      const result = await run(
        CheckoutPricingService.pipe(
          Effect.flatMap((pricing) =>
            pricing.affirmForPayment({
              reservation: family.order,
              dotyposCustomerId,
              locale: "en-US",
              quote: signed,
              acceptedTotal,
              bookedAt,
            } as Parameters<ICheckoutPricingService["affirmForPayment"]>[0])
          ),
          Effect.result
        ),
        DiscountServiceMock({ affirmDisplayedDiscounts })
      );
      return { signed, affirmDisplayedDiscounts, result };
    };

    test("affirms the signed price while its discounts and total still hold", async () => {
      const { signed, affirmDisplayedDiscounts, result } = await affirmSigned({
        affirmDisplayedDiscounts: displayed(halfOffSale),
      });

      expect(affirmDisplayedDiscounts).toHaveBeenCalledWith(
        expect.objectContaining({
          bookedAt,
          dotyposCustomerId,
          locale: "en-US",
          displayedDiscountIds: [saleId],
        })
      );
      expect(result).toMatchObject({
        _tag: "Success",
        success: {
          status: "affirmed",
          priced: {
            kind: family.kind,
            reservation: family.order,
            quote: { fingerprint: signed.fingerprint },
            summary: { total: signed.payment.expectedPrice },
          },
        },
      });
      expect(result).not.toHaveProperty("success.changedKeys");
    });

    test("names the changed summary keys when a signed discount is gone", async () => {
      const { signed, result } = await affirmSigned({
        affirmDisplayedDiscounts: displayed(noSale),
      });

      expect(result).toMatchObject({
        _tag: "Success",
        success: {
          status: "pricing_changed",
          priced: { kind: family.kind, reservation: family.order },
          changedKeys: family.changedKeys,
        },
      });
      if (result._tag === "Success") {
        expect(result.success.priced.quote.fingerprint).not.toBe(
          signed.fingerprint
        );
      }
    });

    test("reports a changed price when the quote holds but the accepted total differs", async () => {
      const { signed, result } = await affirmSigned({
        acceptedTotal: (signedTotal) => signedTotal + 100,
        affirmDisplayedDiscounts: displayed(halfOffSale),
      });

      expect(result).toMatchObject({
        _tag: "Success",
        success: {
          status: "pricing_changed",
          priced: { quote: { fingerprint: signed.fingerprint } },
          changedKeys: { sectionKeys: [], itemKeys: [] },
        },
      });
    });

    test("keeps an unknown discount a retryable failure, never a changed price", async () => {
      const { result } = await affirmSigned({
        affirmDisplayedDiscounts: () =>
          Effect.fail(
            new DiscountAffirmationUnavailableError({
              message: "The sale could not be affirmed.",
              discountIds: [saleId],
            })
          ),
      });

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "DiscountAffirmationUnavailableError",
          discountIds: [saleId],
        },
      });
    });

    test("re-prices for payment without judging the signed price", async () => {
      const signed = (await family.advertise("en-US")).quote;
      const result = await run(
        CheckoutPricingService.pipe(
          Effect.flatMap((pricing) =>
            pricing.repriceForPayment({
              reservation: family.order,
              dotyposCustomerId,
              locale: "en-US",
              quote: signed,
              bookedAt,
            } as Parameters<ICheckoutPricingService["repriceForPayment"]>[0])
          )
        ),
        DiscountServiceMock({ affirmDisplayedDiscounts: displayed(noSale) })
      );

      expect(result).not.toHaveProperty("status");
      expect(result).toMatchObject({
        kind: family.kind,
        reservation: family.order,
        quote: { payment: { discounts: [] } },
      });
      expect(result.summary.total).toEqual(result.quote.payment.expectedPrice);
    });
  });
});
