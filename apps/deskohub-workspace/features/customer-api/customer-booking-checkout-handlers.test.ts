import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  type CreateCustomerCheckout,
  type CustomerCheckout,
  customerReferralCodeHeader,
  type SubmitCustomerCheckout,
} from "@deskohub/workspace-customer-api";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Effect, Layer, Option, Schema } from "effect";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import {
  peeking,
  testPeekedStandings,
} from "@/features/account/backend/current-customer-account.test-utils";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import {
  CheckoutError,
  CheckoutService,
  openPayStateWithHoldExpiry,
  PayState,
  PayStateAuthorNotFoundError,
  PayStateIssueError,
  PayStateTokenError,
} from "@/features/checkout/backend/checkout";
import { CheckoutUnavailableError } from "@/features/checkout/backend/checkout/checkout-unavailable";
import {
  buildSignedPayState,
  sealPayState,
} from "@/features/checkout/backend/checkout/pay-state";
import {
  sealSyntheticPayStateToken,
  syntheticChangedKeys,
  syntheticHoldExpiresAt,
  syntheticPayStateOrderId,
} from "@/features/checkout/backend/checkout/signed-pay-state.test-utils";
import { buildReservationQuote } from "@/features/checkout/reservation-quote";
import {
  canonicalPromotionCodeSchema,
  discountIdSchema,
} from "@/features/discounts/contracts";
import {
  DiscountAffirmationUnavailableError,
  DiscountProviderError,
} from "@/features/discounts/errors";
import { getPaymentSubmitLegalDocuments } from "@/features/legal/payment-submit-evidence";
import { OfficeReleaseGate } from "@/features/office/backend/office-release-gate";
import {
  InviteeEmail,
  OfficePeopleIssue,
} from "@/features/office/office-people";
import { ReferralServiceMock } from "@/features/referrals/referral.service.mock";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { OfficePeopleRejectedError } from "@/features/reservation/backend/office-people-submission";
import { OvernightStayReleaseGate } from "@/features/reservation/backend/overnight-stay-release-gate";
import { WorkspaceTableUnavailableError } from "@/features/reservation/backend/workspace-availability.service";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { reservationOrderSchema } from "@/features/reservation/reservation-order";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { instantStringSchema } from "@/shared/utils/temporal";
import {
  type CustomerApiCall,
  customerApiRequest,
  makeCustomerApiTestServer,
  testCustomerEndpointGuards,
} from "./customer-api.test-utils";
import type { CustomerBookingCheckoutLayerSet } from "./customer-booking-checkout-layers";
import { CustomerCheckoutOperations } from "./customer-checkout-operations.service";
import { CustomerReferralUpdates } from "./customer-referral-updates";

type Operations = CustomerCheckoutOperations["Service"];
type PreparationInput = Parameters<Operations["preparePayState"]>[0];

const workspaceDateFromToday = (days: number) =>
  getCurrentWorkspaceDate().add({ days }).toString();

const readyToken = await sealSyntheticPayStateToken();
const reviewToken = await sealSyntheticPayStateToken({
  changedKeys: syntheticChangedKeys,
});

/** Sealing a fresh checkout state failed: the keys can't seal. */
const unsignablePayState = new PayStateIssueError({
  cause: new PayStateTokenError({
    code: "missing-secret",
    message: "no sealing key",
  }),
});

/** The hold deadline the checkout's reservation stores. */
const storedHoldExpiresAt = "2099-07-01T10:09:00.000Z";

/** The reservation a state signed without its hold deadline reads it from. */
const storedReservations = Layer.mock(WorkspaceReservationRepository, {
  findById: (id) =>
    Effect.succeed({
      id,
      reservationHoldExpiresAt: Temporal.Instant.from(storedHoldExpiresAt),
    } as WorkspaceReservation),
});

const openTestPayState = (token: string) =>
  PayState.open(token).pipe(Effect.provide(TestSealedStateKeys));

/**
 * Checkout operations over the test key ring: tokens open, and the session's
 * account booked every order, unless `overrides` say otherwise.
 */
const operationsWith = (overrides: Partial<Operations> = {}) =>
  Layer.mock(CustomerCheckoutOperations, {
    readPayState: (token) =>
      openPayStateWithHoldExpiry(token).pipe(
        Effect.provide(Layer.merge(TestSealedStateKeys, storedReservations))
      ),
    requireAuthor: ({ payStateToken }) => openTestPayState(payStateToken),
    findOfficePeople: () => Effect.succeed(Option.none()),
    ...overrides,
  });

const emptyInventory = Layer.succeed(AdvisoryAvailabilityInventory, {
  tables: Effect.succeed([]),
  listActiveReservationsOverlapping: () => Effect.succeed([]),
  listLimitations: () => Effect.succeed([]),
});

/** The one Dotypos table an office booking assigns. */
const officeInventory = Layer.succeed(AdvisoryAvailabilityInventory, {
  tables: Effect.succeed([
    {
      _cloudId: "cloud",
      id: "office",
      name: "Office",
      display: true,
      enabled: true,
      seats: "8",
      tags: ["reservation:office"],
    },
  ]),
  listActiveReservationsOverlapping: () => Effect.succeed([]),
  listLimitations: () => Effect.succeed([]),
});

const checkoutWith = (
  layers: Partial<CustomerBookingCheckoutLayerSet>
): Partial<CustomerBookingCheckoutLayerSet> => ({
  inventory: emptyInventory,
  ...layers,
});

const prepared = (
  result: Effect.Success<ReturnType<Operations["preparePayState"]>>
) => Effect.succeed(result);

const readyHold = {
  status: "ready" as const,
  orderId: syntheticPayStateOrderId,
  redirectUrl: "/en-US/checkout/pay?payState=ready",
  expiresAt: "2099-07-01T10:13:00.000Z",
  payStateToken: readyToken,
};

const createBody = (
  overrides: Partial<typeof CreateCustomerCheckout.Encoded> = {}
): typeof CreateCustomerCheckout.Encoded => ({
  locale: "en-US",
  checkoutSessionId: "checkout-session-id",
  checkoutAttemptId: "checkout-attempt-id",
  advertisedPriceToken: "advertised-price-token",
  selection: {
    family: "cowork",
    tier: "open-space",
    coffee: true,
    date: workspaceDateFromToday(1),
  },
  bookingFor: "self",
  contact: {
    name: "Ada Lovelace",
    email: testEmailAddress("ada"),
    phone: "+420777000111",
  },
  billing: { purpose: "personal", invoice: "none" },
  ...overrides,
});

const createCheckout = (
  body: typeof CreateCustomerCheckout.Encoded = createBody(),
  headers?: CustomerApiCall["headers"]
): CustomerApiCall => ({
  method: "POST",
  path: "/booking/checkouts",
  body,
  ...(headers && { headers }),
});

/** Records each preparation's input, then answers `result`. */
const recordingPreparation = (
  result: Effect.Success<ReturnType<Operations["preparePayState"]>>
) => {
  const inputs: PreparationInput[] = [];
  return {
    inputs,
    preparePayState: (input: PreparationInput) =>
      Effect.sync(() => {
        inputs.push(input);
        return result;
      }),
  };
};

const expectedReadyCheckout = {
  status: "ready",
  orderId: syntheticPayStateOrderId,
  payStateToken: readyToken,
  expiresAt: expect.any(String),
  holdExpiresAt: syntheticHoldExpiresAt,
  summary: expect.objectContaining({
    sections: expect.any(Array),
    vatStatus: workspaceSiteConstants.company.vatStatus,
  }),
  earlyPerformanceConsent: {
    required: expect.any(Boolean),
    requiredFrom: expect.any(String),
  },
};

describe("createCheckout", () => {
  testCustomerEndpointGuards(createCheckout());

  test("holds the selection for the account and answers its checkout", async () => {
    const preparation = recordingPreparation(readyHold);
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({
        operations: operationsWith(preparation),
      }),
    });

    const response = await api.handle(customerApiRequest(createCheckout()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expectedReadyCheckout);
    expect(preparation.inputs).toHaveLength(1);
    expect(preparation.inputs[0]).toMatchObject({
      locale: "en-US",
      checkoutSessionId: "checkout-session-id",
      checkoutAttemptId: "checkout-attempt-id",
      advertisedPriceToken: "advertised-price-token",
      customer: "account",
      reservation: {
        kind: "cowork",
        name: "Ada Lovelace",
        email: testEmailAddress("ada"),
        phone: "+420777000111",
        billing: { purpose: "personal", invoice: "none" },
      },
    });
    expect(preparation.inputs[0]).not.toHaveProperty("marketingConsent");
  });

  test("books someone else as the submitted contact, not as the account", async () => {
    const preparation = recordingPreparation(readyHold);
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({
        operations: operationsWith(preparation),
      }),
    });

    const response = await api.handle(
      customerApiRequest(
        createCheckout(createBody({ bookingFor: "someone-else" }))
      )
    );

    expect(response.status).toBe(200);
    expect(preparation.inputs[0]).not.toHaveProperty("customer");
  });

  test("labels a marketing consent grant with the app's channel", async () => {
    const preparation = recordingPreparation(readyHold);
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({
        operations: operationsWith(preparation),
      }),
    });

    await api.handle(
      customerApiRequest(createCheckout(createBody({ marketingConsent: true })))
    );

    expect(preparation.inputs[0]).toMatchObject({
      marketingConsent: true,
      marketingConsentSource: "customer_app",
    });
  });

  test("answers a changed price as a price review to accept", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({
        operations: operationsWith({
          preparePayState: () =>
            prepared({
              ...readyHold,
              status: "pricing_changed",
              affectedProductKeys: ["product:cowork:basic"],
              payStateToken: reviewToken,
            }),
        }),
      }),
    });

    const response = await api.handle(customerApiRequest(createCheckout()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...expectedReadyCheckout,
      status: "price_review",
      payStateToken: reviewToken,
      priceReview: { changedKeys: syntheticChangedKeys },
    });
  });

  test("reports the invited customer's referral benefit", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({
        operations: operationsWith({
          preparePayState: () =>
            prepared({ ...readyHold, referralApplied: true }),
        }),
      }),
    });

    const response = await api.handle(customerApiRequest(createCheckout()));

    expect(await response.json()).toMatchObject({ referralApplied: true });
  });

  test("books the office people list and answers who is coming", async () => {
    const preparation = recordingPreparation(readyHold);
    const invitee = testEmailAddress("office-invitee");
    const people = { contactAttends: true, invitees: [invitee] };
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({
        operations: operationsWith({
          ...preparation,
          findOfficePeople: () =>
            Effect.succeed(
              Option.some({
                contactAttends: true,
                invitees: [InviteeEmail.make(invitee)],
              })
            ),
        }),
      }),
    });

    const response = await api.handle(
      customerApiRequest(createCheckout(createBody({ people })))
    );

    expect(preparation.inputs[0]?.people).toEqual(people);
    expect(await response.json()).toEqual({ ...expectedReadyCheckout, people });
  });

  test.each([
    [
      OfficePeopleIssue.InviteeRejected({ index: 1, reason: "duplicate" }),
      { _tag: "CustomerCheckoutDetailsInvalid", field: "people.invitees.1" },
    ],
    [
      OfficePeopleIssue.NoPeople(),
      { _tag: "CustomerCheckoutDetailsInvalid", field: "people" },
    ],
    [
      OfficePeopleIssue.OverCapacity({ seatCapacity: 4 }),
      { _tag: "CustomerBookingSelectionInvalid", field: "seats" },
    ],
    [
      { _tag: "SeatsMismatch" } as const,
      { _tag: "CustomerBookingSelectionInvalid", field: "seats" },
    ],
    [
      { _tag: "NotOffice" } as const,
      { _tag: "CustomerBookingSelectionInvalid", field: "people" },
    ],
  ])(
    "answers a rejected people list (%o) by its field",
    async (rejection, answer) => {
      const api = makeCustomerApiTestServer({
        bookingCheckout: checkoutWith({
          operations: operationsWith({
            preparePayState: () =>
              Effect.fail(new OfficePeopleRejectedError({ rejection })),
          }),
        }),
      });

      const response = await api.handle(customerApiRequest(createCheckout()));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(answer);
    }
  );

  test("answers a review account's hold as payment disabled, without a checkout", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({
        operations: operationsWith({
          preparePayState: () =>
            prepared({
              status: "ready",
              orderId: syntheticPayStateOrderId,
              redirectUrl: "/en-US/review/payment-disabled",
              expiresAt: "2099-07-01T10:13:00.000Z",
              reviewSandbox: true,
            }),
        }),
      }),
    });

    const response = await api.handle(customerApiRequest(createCheckout()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "payment_disabled",
      orderId: syntheticPayStateOrderId,
    });
  });

  test.each([
    ["de-DE", "0151 23456789"],
    ["uk-UA", "050 123 4567"],
    ["de-DE", "+420777000111"],
  ] as const)(
    "prepares a %s booking's contact phone %s for its own locale",
    async (locale, phone) => {
      const preparation = recordingPreparation(readyHold);
      const api = makeCustomerApiTestServer({
        bookingCheckout: checkoutWith({
          operations: operationsWith(preparation),
        }),
      });

      const response = await api.handle(
        customerApiRequest(
          createCheckout(
            createBody({
              locale,
              bookingFor: "someone-else",
              contact: {
                name: "Ada Lovelace",
                email: testEmailAddress("ada"),
                phone,
              },
            })
          )
        )
      );

      expect(response.status).toBe(200);
      expect(preparation.inputs[0]).toMatchObject({
        locale,
        reservation: { phone },
      });
    }
  );

  test("refuses a national phone of another region than the booking's locale", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({ operations: operationsWith() }),
    });

    const response = await api.handle(
      customerApiRequest(
        createCheckout(
          createBody({
            locale: "cs-CZ",
            bookingFor: "someone-else",
            contact: {
              name: "Ada Lovelace",
              email: testEmailAddress("ada"),
              phone: "0151 23456789",
            },
          })
        )
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      _tag: "CustomerCheckoutDetailsInvalid",
      field: "contact.phone",
    });
  });

  test("names the contact field the booking form refuses", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({ operations: operationsWith() }),
    });

    const response = await api.handle(
      customerApiRequest(
        createCheckout(
          createBody({
            contact: {
              name: "Ada",
              email: "not-an-email",
              phone: "+420777000111",
            },
          })
        )
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      _tag: "CustomerCheckoutDetailsInvalid",
      field: "contact.email",
    });
  });

  test.each([
    [
      "a conflicting submission",
      () => prepared({ status: "error", message: "conflict" }),
      409,
      { _tag: "CustomerSelectionUnavailable", reason: "checkout_conflict" },
    ],
    [
      "a table taken since the quote",
      () =>
        Effect.fail(
          new WorkspaceTableUnavailableError({
            date: "2099-08-04",
            requiredTags: [],
          })
        ),
      409,
      { _tag: "CustomerSelectionUnavailable", reason: "availability_changed" },
    ],
    [
      "an unknown Calendar discount",
      () =>
        Effect.fail(
          new DiscountAffirmationUnavailableError({
            message: "unknown discount",
            discountIds: [],
          })
        ),
      503,
      { _tag: "CustomerServiceUnavailable" },
    ],
    [
      "a checkout state the server can't seal",
      () =>
        Effect.fail(
          new PayStateTokenError({ code: "invalid-token", message: "invalid" })
        ),
      503,
      { _tag: "CustomerServiceUnavailable" },
    ],
    [
      "a discount provider failure",
      () =>
        Effect.fail(new DiscountProviderError({ message: "provider down" })),
      503,
      { _tag: "CustomerServiceUnavailable" },
    ],
  ] as const)(
    "answers %s with its public error",
    async (_case, preparePayState, status, body) => {
      const api = makeCustomerApiTestServer({
        bookingCheckout: checkoutWith({
          operations: operationsWith({ preparePayState }),
        }),
      });

      const response = await api.handle(customerApiRequest(createCheckout()));

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(body);
    }
  );

  test("decides each release gate once for the selection, the hold and the referral it remembers", async () => {
    const evaluations = { referral: 0, office: 0 };
    const counted = (gate: keyof typeof evaluations) =>
      Effect.sync(() => {
        evaluations[gate] += 1;
        return true;
      }).pipe(Effect.cached);
    const acceptedCode = canonicalPromotionCodeSchema.make("RFLTYPED1");
    const preparingOperations = Layer.effect(
      CustomerCheckoutOperations,
      Effect.gen(function* () {
        const referral = yield* ReferralReleaseGate;
        const office = yield* OfficeReleaseGate;
        const { remembered } = yield* CustomerReferralUpdates;
        return CustomerCheckoutOperations.of({
          ...(yield* Effect.provide(
            CustomerCheckoutOperations,
            operationsWith()
          )),
          preparePayState: () =>
            Effect.all([referral.isOpen, office.isOpen, office.isOpen]).pipe(
              Effect.andThen(
                RememberedReferral.pipe(
                  Effect.flatMap((rememberedReferral) =>
                    rememberedReferral.remember(acceptedCode)
                  ),
                  Effect.provide(
                    remembered.pipe(
                      Layer.provide(
                        Layer.mergeAll(
                          ReferralServiceMock({}),
                          Layer.mock(CurrentCustomerAccount, {}),
                          Layer.succeed(ReferralReleaseGate, referral)
                        )
                      )
                    )
                  ),
                  Effect.orDie
                )
              ),
              Effect.as(readyHold)
            ),
        });
      })
    );
    const api = makeCustomerApiTestServer({
      bookingCheckout: checkoutWith({
        inventory: officeInventory,
        operations: preparingOperations,
        releases: {
          referral: Layer.unwrap(
            counted("referral").pipe(
              Effect.map(ReferralReleaseGate.fromEvaluation)
            )
          ),
          office: Layer.unwrap(
            counted("office").pipe(Effect.map(OfficeReleaseGate.fromEvaluation))
          ),
          overnightStay: OvernightStayReleaseGate.fromDecision(false),
        },
      }),
    });

    const response = await api.handle(
      customerApiRequest(
        createCheckout(
          createBody({
            selection: {
              family: "office",
              seats: 2,
              date: workspaceDateFromToday(1),
            },
          })
        )
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rememberReferralCode: "RFLTYPED1",
    });
    expect(evaluations).toEqual({ referral: 1, office: 1 });
  });

  describe("meeting-room early setup", () => {
    /**
     * Holds each prepared reservation as a ready checkout that signs it, so
     * the answered summary lists what the request selected.
     */
    const signingPreparation = () => {
      const inputs: PreparationInput[] = [];
      return {
        inputs,
        preparePayState: (input: PreparationInput) =>
          Effect.gen(function* () {
            inputs.push(input);
            const reservation = yield* Schema.decodeUnknownEffect(
              reservationOrderSchema("CZ")
            )(input.reservation);
            const state = yield* buildSignedPayState({
              locale: input.locale,
              reservation,
              quote: yield* buildReservationQuote(reservation),
              orderId: syntheticPayStateOrderId,
              bookedAt: instantStringSchema.make("2099-07-01T09:58:00.000Z"),
              holdExpiresAt: syntheticHoldExpiresAt,
              checkoutSessionId: input.checkoutSessionId,
            });
            return { ...readyHold, payStateToken: yield* sealPayState(state) };
          }).pipe(Effect.provide(TestSealedStateKeys), Effect.orDie),
      };
    };

    const holdMeetingRoom = async (earlySetup?: boolean) => {
      const preparation = signingPreparation();
      const api = makeCustomerApiTestServer({
        bookingCheckout: checkoutWith({
          operations: operationsWith(preparation),
        }),
      });
      const response = await api.handle(
        customerApiRequest(
          createCheckout(
            createBody({
              selection: {
                family: "meeting-room",
                date: workspaceDateFromToday(2),
                startTime: "10:00",
                duration: "hour:1",
              },
              ...(earlySetup !== undefined && { earlySetup }),
            })
          )
        )
      );
      expect(response.status).toBe(200);
      const body: CustomerCheckout = await response.json();
      const [prepared] = preparation.inputs;
      if (prepared?.reservation.kind !== "meeting-room") {
        throw new Error("expected a prepared meeting-room reservation");
      }
      const [orderSection] = body.summary.sections;
      return {
        bookedStart: Temporal.Instant.from(prepared.reservation.startsAt),
        roomLine: orderSection?.items.find(({ key }) =>
          key.startsWith("product:meeting-room:")
        ),
        total: body.summary.sections.at(-1)?.items.at(-1)?.amount,
      };
    };

    test("lists the setup on the room line of a hold that asks for it, at no cost", async () => {
      const { bookedStart, roomLine, total } = await holdMeetingRoom(true);

      expect(roomLine).toHaveProperty("earlySetup");
      const earlySetup =
        roomLine && "earlySetup" in roomLine && roomLine.earlySetup;
      if (!earlySetup) throw new Error("expected the room line's early setup");
      expect(
        Temporal.Instant.from(earlySetup.startsAt).equals(
          bookedStart.subtract({ minutes: 15 })
        )
      ).toBe(true);
      expect(earlySetup.amount).toEqual({ ...total, value: 0 });
    });

    test("leaves the setup off the room line of a hold without it", async () => {
      const { roomLine } = await holdMeetingRoom();

      expect(roomLine).toBeDefined();
      expect(roomLine).not.toHaveProperty("earlySetup");
    });
  });
});

describe("applyCheckoutDiscountCode", () => {
  const applyCode = (
    headers?: CustomerApiCall["headers"]
  ): CustomerApiCall => ({
    method: "POST",
    path: "/booking/checkouts/discount-code",
    body: { locale: "en-US", payStateToken: readyToken, code: "SPRING" },
    ...(headers && { headers }),
  });

  testCustomerEndpointGuards(applyCode());

  test("answers the checkout with the code applied", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          applyDiscountCode: () =>
            Effect.succeed({
              status: "applied",
              freshPayUrl: "/en-US/checkout/pay?payState=fresh",
              freshPayStateToken: readyToken,
              expiresAt: "2099-07-01T10:13:00.000Z",
            }),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(applyCode()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...expectedReadyCheckout,
      discountCode: "applied",
    });
  });

  describe("hold deadline and applied code", () => {
    const answerApplied = async (input: {
      readonly payStateToken: string;
      readonly freshPayStateToken: string;
    }) => {
      const api = makeCustomerApiTestServer({
        bookingCheckout: {
          operations: operationsWith({
            applyDiscountCode: () =>
              Effect.succeed({
                status: "applied",
                freshPayUrl: "/en-US/checkout/pay?payState=fresh",
                freshPayStateToken: input.freshPayStateToken,
                expiresAt: "2099-07-01T10:13:00.000Z",
              }),
          }),
        },
      });
      const response = await api.handle(
        customerApiRequest({
          method: "POST",
          path: "/booking/checkouts/discount-code",
          body: {
            locale: "en-US",
            payStateToken: input.payStateToken,
            code: "SPRING",
          },
        })
      );
      expect(response.status).toBe(200);
      return (await response.json()) as typeof CustomerCheckout.Encoded;
    };

    /** `token`'s state with an entered code its price includes. */
    const withAppliedCode = (token: string) =>
      Effect.runPromise(
        openTestPayState(token).pipe(
          Effect.flatMap((state) =>
            sealPayState({
              ...state,
              submittedCode: canonicalPromotionCodeSchema.make("SPRING"),
              submittedCodeDiscountId: discountIdSchema.make("spring-discount"),
            })
          ),
          Effect.provide(TestSealedStateKeys)
        )
      );

    test("keeps the hold deadline while the replacement moves the checkout's expiry", async () => {
      const signedEarlier = await sealSyntheticPayStateToken({
        issuedAt: Temporal.Now.instant().subtract({ minutes: 5 }),
      });
      const signedEarlierExpiresAt = new Date(
        (await Effect.runPromise(openTestPayState(signedEarlier))).exp * 1000
      ).toISOString();

      const body = await answerApplied({
        payStateToken: signedEarlier,
        freshPayStateToken: await sealSyntheticPayStateToken(),
      });

      expect(body.holdExpiresAt).toBe(syntheticHoldExpiresAt);
      expect(body.expiresAt).not.toBe(signedEarlierExpiresAt);
    });

    test("names the entered code the replacement's price includes", async () => {
      const body = await answerApplied({
        payStateToken: readyToken,
        freshPayStateToken: await withAppliedCode(readyToken),
      });

      expect(body.appliedDiscountCode).toEqual({
        code: "SPRING",
        discountId: "spring-discount",
      });
    });

    test("leaves the applied code out of a checkout without one", async () => {
      const body = await answerApplied({
        payStateToken: readyToken,
        freshPayStateToken: readyToken,
      });

      expect(body).not.toHaveProperty("appliedDiscountCode");
    });

    test("answers a state signed without the deadline with its reservation's stored one", async () => {
      const body = await answerApplied({
        payStateToken: readyToken,
        freshPayStateToken: await sealSyntheticPayStateToken({
          withoutHoldExpiry: true,
        }),
      });

      expect(body.holdExpiresAt).toBe(storedHoldExpiresAt);
    });
  });

  test("tells the client to remember an accepted referral code while referrals are released", async () => {
    const acceptedCode = canonicalPromotionCodeSchema.make("RFLTYPED1");
    const accepting = (released: boolean) =>
      makeCustomerApiTestServer({
        bookingCheckout: {
          releases: {
            referral: ReferralReleaseGate.fromDecision(released),
            office: OfficeReleaseGate.fromDecision(false),
            overnightStay: OvernightStayReleaseGate.fromDecision(false),
          },
          operations: Layer.effect(
            CustomerCheckoutOperations,
            Effect.gen(function* () {
              const referral = yield* ReferralReleaseGate;
              const { remembered } = yield* CustomerReferralUpdates;
              return CustomerCheckoutOperations.of({
                ...(yield* Effect.provide(
                  CustomerCheckoutOperations,
                  operationsWith()
                )),
                applyDiscountCode: () =>
                  RememberedReferral.pipe(
                    Effect.flatMap((rememberedReferral) =>
                      rememberedReferral.remember(acceptedCode)
                    ),
                    Effect.provide(
                      remembered.pipe(
                        Layer.provide(
                          Layer.mergeAll(
                            ReferralServiceMock({}),
                            Layer.mock(CurrentCustomerAccount, {}),
                            Layer.succeed(ReferralReleaseGate, referral)
                          )
                        )
                      )
                    ),
                    Effect.orDie,
                    Effect.as({
                      status: "accepted" as const,
                      freshPayUrl: "/en-US/checkout/pay?payState=fresh",
                      freshPayStateToken: readyToken,
                      expiresAt: "2099-07-01T10:13:00.000Z",
                    })
                  ),
              });
            })
          ),
        },
      });

    const released = await accepting(true).handle(
      customerApiRequest(applyCode())
    );
    const withheld = await accepting(false).handle(
      customerApiRequest(applyCode())
    );

    expect(await released.json()).toMatchObject({
      discountCode: "referral_accepted",
      rememberReferralCode: "RFLTYPED1",
    });
    expect(await withheld.json()).not.toHaveProperty("rememberReferralCode");
  });

  test("answers a changed price as a review, without applying the code", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          applyDiscountCode: () =>
            Effect.succeed({
              status: "pricing_changed",
              freshPayUrl: "/en-US/checkout/pay?payState=review",
              freshPayStateToken: reviewToken,
              expiresAt: "2099-07-01T10:13:00.000Z",
            }),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(applyCode()));
    const body = await response.json();

    expect(body).toMatchObject({ status: "price_review" });
    expect(body).not.toHaveProperty("discountCode");
  });

  test("rejects an unknown code with the replacement checkout it signed", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          applyDiscountCode: () =>
            Effect.succeed({
              status: "unavailable",
              reason: "code",
              freshPayUrl: "/en-US/checkout/pay?payState=attempted",
              freshPayStateToken: "attempted-token",
              expiresAt: "2099-07-01T10:13:00.000Z",
            }),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(applyCode()));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      _tag: "CustomerDiscountCodeRejected",
      reason: "unavailable",
      payStateToken: "attempted-token",
      expiresAt: "2099-07-01T10:13:00.000Z",
    });
  });

  test("rejects an ineligible code and keeps the client's checkout", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          applyDiscountCode: () => Effect.succeed({ status: "ineligible" }),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(applyCode()));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      _tag: "CustomerDiscountCodeRejected",
      reason: "ineligible",
    });
  });

  test.each([
    [
      "a referral check that can't answer",
      { status: "unavailable", reason: "provider" },
      503,
      { _tag: "CustomerServiceUnavailable" },
    ],
    [
      "a referral store outage, despite the replacement the referral flow signed",
      {
        status: "unavailable",
        reason: "provider",
        freshPayUrl: "/en-US/checkout/pay?payState=attempted",
        freshPayStateToken: "attempted-token",
        expiresAt: "2099-07-01T10:13:00.000Z",
      },
      503,
      { _tag: "CustomerServiceUnavailable" },
    ],
    [
      "an expired hold",
      { status: "unavailable", reason: "checkout", checkoutReason: "expired" },
      409,
      { _tag: "CustomerCheckoutUnavailable", reason: "expired" },
    ],
    [
      "a payment already started",
      {
        status: "unavailable",
        reason: "checkout",
        checkoutReason: "payment_in_progress",
      },
      409,
      { _tag: "CustomerCheckoutUnavailable", reason: "payment_in_progress" },
    ],
    [
      "a price review still pending",
      { status: "unavailable", reason: "price_review_pending" },
      409,
      { _tag: "CustomerCheckoutUnavailable", reason: "price_review_pending" },
    ],
  ] as const)(
    "answers %s with its public error",
    async (_case, result, status, body) => {
      const api = makeCustomerApiTestServer({
        bookingCheckout: {
          operations: operationsWith({
            applyDiscountCode: () => Effect.succeed(result),
          }),
        },
      });

      const response = await api.handle(customerApiRequest(applyCode()));

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(body);
    }
  );

  test("answers a replacement checkout the server can't sign as unavailable", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          applyDiscountCode: () => Effect.fail(unsignablePayState),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(applyCode()));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });

  test("answers another account's checkout as not found, before the code is checked", async () => {
    let applied = 0;
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          requireAuthor: () =>
            Effect.fail(
              new PayStateAuthorNotFoundError({
                orderId: syntheticPayStateOrderId,
              })
            ),
          applyDiscountCode: () =>
            Effect.sync(() => {
              applied += 1;
              return { status: "ineligible" as const };
            }),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(applyCode()));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ _tag: "CustomerCheckoutNotFound" });
    expect(applied).toBe(0);
  });
});

describe("clearCheckoutDiscountCode", () => {
  const clearCode = (payStateToken = readyToken): CustomerApiCall => ({
    method: "POST",
    path: "/booking/checkouts/discount-code/clear",
    body: { locale: "en-US", payStateToken },
  });
  const answerClear = (
    clearDiscountCode: Operations["clearDiscountCode"],
    overrides: Partial<Operations> = {}
  ) =>
    makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({ clearDiscountCode, ...overrides }),
      },
    });

  testCustomerEndpointGuards(clearCode());

  test("answers the checkout without the code, for review of its new price", async () => {
    const signedEarlier = await sealSyntheticPayStateToken({
      issuedAt: Temporal.Now.instant().subtract({ minutes: 5 }),
    });
    const signedEarlierExpiresAt = new Date(
      (await Effect.runPromise(openTestPayState(signedEarlier))).exp * 1000
    ).toISOString();
    const api = answerClear(() =>
      Effect.succeed({
        status: "cleared",
        freshPayUrl: "/en-US/checkout/pay?payState=review",
        freshPayStateToken: reviewToken,
        expiresAt: "2099-07-01T10:13:00.000Z",
      })
    );

    const response = await api.handle(
      customerApiRequest(clearCode(signedEarlier))
    );
    const body = (await response.json()) as typeof CustomerCheckout.Encoded;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "price_review",
      payStateToken: reviewToken,
      holdExpiresAt: syntheticHoldExpiresAt,
      priceReview: { changedKeys: expect.any(Object) },
    });
    expect(body.expiresAt).not.toBe(signedEarlierExpiresAt);
    expect(body).not.toHaveProperty("appliedDiscountCode");
  });

  test("answers a checkout that carried no code as it is", async () => {
    const api = answerClear(() =>
      Effect.succeed({
        status: "unchanged",
        freshPayUrl: "/en-US/checkout/pay?payState=ready",
        freshPayStateToken: readyToken,
        expiresAt: "2099-07-01T10:13:00.000Z",
      })
    );

    const response = await api.handle(customerApiRequest(clearCode()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expectedReadyCheckout);
  });

  test("answers a state signed without the deadline with its reservation's stored one", async () => {
    const freshPayStateToken = await sealSyntheticPayStateToken({
      withoutHoldExpiry: true,
    });
    const api = answerClear(() =>
      Effect.succeed({
        status: "cleared",
        freshPayUrl: "/en-US/checkout/pay?payState=fresh",
        freshPayStateToken,
        expiresAt: "2099-07-01T10:13:00.000Z",
      })
    );

    const response = await api.handle(customerApiRequest(clearCode()));

    expect(
      ((await response.json()) as typeof CustomerCheckout.Encoded).holdExpiresAt
    ).toBe(storedHoldExpiresAt);
  });

  test.each([
    [
      "a discount provider that can't answer",
      { status: "unavailable", reason: "provider" },
      503,
      { _tag: "CustomerServiceUnavailable" },
    ],
    [
      "an expired hold",
      { status: "unavailable", reason: "checkout", checkoutReason: "expired" },
      409,
      { _tag: "CustomerCheckoutUnavailable", reason: "expired" },
    ],
    [
      "a reservation that can't be paid",
      {
        status: "unavailable",
        reason: "checkout",
        checkoutReason: "not_current",
      },
      409,
      { _tag: "CustomerCheckoutUnavailable", reason: "not_payable" },
    ],
    [
      "a payment already started",
      {
        status: "unavailable",
        reason: "checkout",
        checkoutReason: "payment_in_progress",
      },
      409,
      { _tag: "CustomerCheckoutUnavailable", reason: "payment_in_progress" },
    ],
    [
      "a price review still pending",
      { status: "unavailable", reason: "price_review_pending" },
      409,
      { _tag: "CustomerCheckoutUnavailable", reason: "price_review_pending" },
    ],
  ] as const)(
    "answers %s with its public error",
    async (_case, result, status, body) => {
      const api = answerClear(() => Effect.succeed(result));

      const response = await api.handle(customerApiRequest(clearCode()));

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(body);
    }
  );

  test.each([
    [
      "an expired checkout state",
      new PayStateTokenError({ code: "expired", message: "expired" }),
      409,
      { _tag: "CustomerCheckoutUnavailable", reason: "expired" },
    ],
    [
      "a replacement checkout the server can't sign",
      unsignablePayState,
      503,
      { _tag: "CustomerServiceUnavailable" },
    ],
  ] as const)(
    "answers %s like entering a code does",
    async (_case, error, status, body) => {
      const api = answerClear(() => Effect.fail(error));

      const response = await api.handle(customerApiRequest(clearCode()));

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(body);
    }
  );

  test("answers another account's checkout as not found, before the code is removed", async () => {
    let cleared = 0;
    const api = answerClear(
      () =>
        Effect.sync(() => {
          cleared += 1;
          return {
            status: "unavailable" as const,
            reason: "provider" as const,
          };
        }),
      {
        requireAuthor: () =>
          Effect.fail(
            new PayStateAuthorNotFoundError({
              orderId: syntheticPayStateOrderId,
            })
          ),
      }
    );

    const response = await api.handle(customerApiRequest(clearCode()));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ _tag: "CustomerCheckoutNotFound" });
    expect(cleared).toBe(0);
  });
});

describe("acceptCheckoutPriceChange", () => {
  const acceptPrice: CustomerApiCall = {
    method: "POST",
    path: "/booking/checkouts/price-acceptance",
    body: { locale: "en-US", payStateToken: reviewToken },
  };

  testCustomerEndpointGuards(acceptPrice);

  test("answers the checkout ready to pay at the new price", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          acceptPriceChange: () =>
            Effect.succeed({
              status: "accepted",
              payStateToken: readyToken,
              payUrl: "/en-US/checkout/pay?payState=accepted",
              expiresAt: "2099-07-01T10:13:00.000Z",
            }),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(acceptPrice));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expectedReadyCheckout);
  });

  test("builds the operations over the authentication the request is read through", async () => {
    const accepted = {
      acceptPriceChange: () =>
        Effect.succeed({
          status: "accepted" as const,
          payStateToken: readyToken,
          payUrl: "/en-US/checkout/pay?payState=accepted",
          expiresAt: "2099-07-01T10:13:00.000Z",
        }),
    };
    // Operations that read the session once more when they accept a price,
    // through the authentication they were built over.
    const sessionReading = Layer.effect(
      CustomerCheckoutOperations,
      Effect.gen(function* () {
        const authentication = yield* CustomerAuthentication;
        const operations = yield* Effect.provide(
          CustomerCheckoutOperations,
          operationsWith(accepted)
        );
        return CustomerCheckoutOperations.of({
          ...operations,
          acceptPriceChange: (input) =>
            authentication.currentUser.pipe(
              Effect.orDie,
              Effect.andThen(operations.acceptPriceChange(input))
            ),
        });
      })
    );
    const quiet = makeCustomerApiTestServer({
      bookingCheckout: { operations: operationsWith(accepted) },
    });
    const reading = makeCustomerApiTestServer({
      bookingCheckout: { operations: sessionReading },
    });

    const quietResponse = await quiet.handle(customerApiRequest(acceptPrice));
    const readingResponse = await reading.handle(
      customerApiRequest(acceptPrice)
    );

    expect(quietResponse.status).toBe(200);
    expect(readingResponse.status).toBe(200);
    expect(reading.records.sessionReads).toBe(quiet.records.sessionReads + 1);
  });

  test("answers an expired checkout state as expired", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          acceptPriceChange: () =>
            Effect.fail(
              new PayStateTokenError({ code: "expired", message: "expired" })
            ),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(acceptPrice));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerCheckoutUnavailable",
      reason: "expired",
    });
  });

  test("answers acceptance of a checkout whose reservation is gone as unavailable", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          acceptPriceChange: () =>
            Effect.fail(
              new CheckoutUnavailableError({
                orderId: syntheticPayStateOrderId,
                reason: "missing_reservation",
                restartKind: "cowork",
              })
            ),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(acceptPrice));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerCheckoutUnavailable",
      reason: "not_payable",
    });
  });

  test("answers an accepted checkout the server can't sign as unavailable", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          acceptPriceChange: () => Effect.fail(unsignablePayState),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(acceptPrice));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });

  test("answers an author check the database can't answer as unavailable", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          requireAuthor: () =>
            Effect.fail(
              new EffectDrizzleQueryError({
                query: "select 1",
                params: [],
                cause: Cause.die(new Error("database down")),
              })
            ),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(acceptPrice));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });
});

describe("submitCheckout", () => {
  const currentDocuments = getPaymentSubmitLegalDocuments("en-US").map(
    ({ key, hash }) => ({ key, hash })
  );
  const submitBody = (
    overrides: Partial<typeof SubmitCustomerCheckout.Encoded> = {}
  ): typeof SubmitCustomerCheckout.Encoded => ({
    locale: "en-US",
    payStateToken: readyToken,
    legalConsent: true,
    acceptedLegalDocuments: currentDocuments,
    ...overrides,
  });
  const submit = (
    body: typeof SubmitCustomerCheckout.Encoded = submitBody(),
    headers?: CustomerApiCall["headers"]
  ): CustomerApiCall => ({
    method: "POST",
    path: "/booking/checkouts/submit",
    body,
    ...(headers && { headers }),
  });

  /** Checkout that answers `result` and records its submissions. */
  const checkoutAnswering = (
    result: () => ReturnType<
      CheckoutService["Service"]["createHostedPaymentCheckout"]
    >
  ) => {
    const submissions = {
      count: 0,
      inputs: [] as Parameters<
        CheckoutService["Service"]["createHostedPaymentCheckout"]
      >[0][],
    };
    return {
      submissions,
      layer: Layer.mock(CheckoutService, {
        createHostedPaymentCheckout: (input) =>
          Effect.suspend(() => {
            submissions.count += 1;
            submissions.inputs.push(input);
            return result();
          }),
      }),
    };
  };

  const paymentRequired = () =>
    checkoutAnswering(() =>
      Effect.succeed({
        status: "redirect",
        orderId: syntheticPayStateOrderId,
        redirectUrl: "https://payments.nexi.test/hpp/abc",
        statusUrl: `/en-US/reservation/status/${syntheticPayStateOrderId}`,
      })
    );

  testCustomerEndpointGuards(submit());

  test("answers the payment gateway to open and the status screen it returns to", async () => {
    const checkout = checkoutAnswering(() =>
      Effect.succeed({
        status: "redirect",
        orderId: syntheticPayStateOrderId,
        redirectUrl: "https://payments.nexi.test/hpp/abc",
        statusUrl: `/en-US/reservation/status/${syntheticPayStateOrderId}`,
      })
    );
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith(),
        checkout: checkout.layer,
      },
    });

    const response = await api.handle(customerApiRequest(submit()));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      status: "payment_required",
      orderId: syntheticPayStateOrderId,
      paymentUrl: "https://payments.nexi.test/hpp/abc",
      statusUrl: expect.stringMatching(
        new RegExp(
          `^https?://[^/]+/en-US/reservation/status/${syntheticPayStateOrderId}$`
        )
      ),
    });
    expect(checkout.submissions.inputs).toEqual([
      expect.not.objectContaining({ returnTarget: expect.anything() }),
    ]);
  });

  test.each([
    [
      "native-app",
      `deskohub://reservations/${syntheticPayStateOrderId}?after=payment`,
    ],
    [
      "web-app",
      expect.stringMatching(
        new RegExp(
          `^https?://[^/?]+/app/reservations/${syntheticPayStateOrderId}\\?after=payment$`
        )
      ),
    ],
  ] as const)(
    "answers the %s screen a returnTarget names as the status screen",
    async (returnTarget, statusUrl) => {
      const checkout = paymentRequired();
      const api = makeCustomerApiTestServer({
        bookingCheckout: {
          operations: operationsWith(),
          checkout: checkout.layer,
        },
      });

      const response = await api.handle(
        customerApiRequest(submit(submitBody({ returnTarget })))
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        status: "payment_required",
        orderId: syntheticPayStateOrderId,
        paymentUrl: "https://payments.nexi.test/hpp/abc",
        statusUrl,
      });
      expect(checkout.submissions.inputs).toEqual([
        expect.objectContaining({ returnTarget }),
      ]);
    }
  );

  test("answers a paid order of an app checkout with its app screen", async () => {
    const checkout = checkoutAnswering(() =>
      Effect.succeed({
        status: "redirect",
        orderId: syntheticPayStateOrderId,
        redirectUrl: `/en-US/reservation/status/${syntheticPayStateOrderId}?outcome=success`,
        paid: true,
      })
    );
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith({
          forgetReferralIfSettled: () => Effect.void,
        }),
        checkout: checkout.layer,
      },
    });

    const response = await api.handle(
      customerApiRequest(submit(submitBody({ returnTarget: "native-app" })))
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "paid",
      orderId: syntheticPayStateOrderId,
      statusUrl: `deskohub://reservations/${syntheticPayStateOrderId}?after=payment`,
    });
  });

  test("refuses a return target outside the allowlist without submitting", async () => {
    const checkout = paymentRequired();
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith(),
        checkout: checkout.layer,
      },
    });

    for (const returnTarget of ["https://elsewhere.test/return", "app", ""]) {
      const response = await api.handle(
        customerApiRequest({
          ...submit(),
          body: { ...submitBody(), returnTarget },
        })
      );
      expect(response.status).toBe(400);
    }
    expect(checkout.submissions.count).toBe(0);
  });

  test("answers a paid order with its status screen and a used-up referral code", async () => {
    const checkout = checkoutAnswering(() =>
      Effect.succeed({
        status: "redirect",
        orderId: syntheticPayStateOrderId,
        redirectUrl: `/en-US/reservation/status/${syntheticPayStateOrderId}`,
        paid: true,
      })
    );
    const forgotten: unknown[] = [];
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        checkout: checkout.layer,
        operations: Layer.effect(
          CustomerCheckoutOperations,
          Effect.gen(function* () {
            const { remembered } = yield* CustomerReferralUpdates;
            return CustomerCheckoutOperations.of({
              ...(yield* Effect.provide(
                CustomerCheckoutOperations,
                operationsWith()
              )),
              forgetReferralIfSettled: (booker) =>
                RememberedReferral.pipe(
                  Effect.tap(() => Effect.sync(() => forgotten.push(booker))),
                  Effect.flatMap((referral) =>
                    referral.forgetIfSettled(booker)
                  ),
                  Effect.provide(
                    remembered.pipe(
                      Layer.provide(
                        Layer.mergeAll(
                          ReferralServiceMock({
                            hasSettledReferral: () => Effect.succeed(true),
                          }),
                          peeking(testPeekedStandings["signed out"]),
                          ReferralReleaseGate.fromDecision(true)
                        )
                      )
                    )
                  )
                ),
            });
          })
        ),
      },
    });

    const response = await api.handle(
      customerApiRequest(
        submit(submitBody(), { [customerReferralCodeHeader]: "RFL12345" })
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "paid",
      orderId: syntheticPayStateOrderId,
      statusUrl: expect.stringMatching(
        new RegExp(`/en-US/reservation/status/${syntheticPayStateOrderId}$`)
      ),
      rememberedReferralCodeUsed: true,
    });
    expect(forgotten).toEqual([{ kind: "order", paid: true }]);
  });

  test("answers a price changed at submission as a review", async () => {
    const checkout = checkoutAnswering(() =>
      Effect.succeed({
        status: "pricing_changed",
        changedKeys: syntheticChangedKeys,
        freshSummary: {
          sections: [],
          total: { value: 0, exponent: 2, currency: "CZK" },
        },
        freshPayUrl: "/en-US/checkout/pay?payState=review",
        freshPayStateToken: reviewToken,
        expiresAt: "2099-07-01T10:13:00.000Z",
      })
    );
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith(),
        checkout: checkout.layer,
      },
    });

    const response = await api.handle(customerApiRequest(submit()));

    expect(await response.json()).toMatchObject({
      status: "price_review",
      payStateToken: reviewToken,
      holdExpiresAt: syntheticHoldExpiresAt,
      priceReview: { changedKeys: syntheticChangedKeys },
    });
  });

  test("asks for the legal consent before submitting", async () => {
    const checkout = checkoutAnswering(() => Effect.die("not submitted"));
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith(),
        checkout: checkout.layer,
      },
    });

    const response = await api.handle(
      customerApiRequest(submit(submitBody({ legalConsent: false })))
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      _tag: "CustomerConsentRequired",
      consent: "legal",
    });
    expect(checkout.submissions.count).toBe(0);
  });

  test("asks to read the legal documents again when they changed", async () => {
    const checkout = checkoutAnswering(() => Effect.die("not submitted"));
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith(),
        checkout: checkout.layer,
      },
    });

    const response = await api.handle(
      customerApiRequest(
        submit(
          submitBody({
            acceptedLegalDocuments: currentDocuments.map((document) => ({
              ...document,
              hash: "0".repeat(64),
            })),
          })
        )
      )
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerLegalDocumentsChanged",
    });
    expect(checkout.submissions.count).toBe(0);
  });

  test.each([
    [
      "a missing early-performance request",
      () =>
        Effect.fail(
          new CheckoutError({
            code: "early_performance_consent_required",
            message: "consent required",
          })
        ),
      422,
      { _tag: "CustomerConsentRequired", consent: "early_performance" },
    ],
    [
      "a booked time that has passed",
      () =>
        Effect.fail(
          new CheckoutError({
            code: "cowork_reservation_ended",
            message: "ended",
          })
        ),
      409,
      { _tag: "CustomerCheckoutUnavailable", reason: "reservation_ended" },
    ],
    [
      "a cowork offer no longer sold",
      () =>
        Effect.fail(
          new CheckoutError({ code: "cowork_offer_replaced", message: "gone" })
        ),
      409,
      { _tag: "CustomerCheckoutUnavailable", reason: "offer_replaced" },
    ],
    [
      "a table taken since the hold",
      () =>
        Effect.fail(
          new CheckoutError({
            code: "checkout_failed",
            message: "failed",
            cause: new WorkspaceTableUnavailableError({
              date: "2099-08-04",
              requiredTags: [],
            }),
          })
        ),
      409,
      { _tag: "CustomerSelectionUnavailable", reason: "availability_changed" },
    ],
    [
      "a checkout that failed otherwise",
      () =>
        Effect.fail(
          new CheckoutError({ code: "checkout_failed", message: "failed" })
        ),
      503,
      { _tag: "CustomerServiceUnavailable" },
    ],
    [
      "a payment in progress or a hold no longer payable",
      () => Effect.succeed({ status: "in_progress" as const }),
      409,
      { _tag: "CustomerCheckoutUnavailable", reason: "not_payable" },
    ],
  ] as const)(
    "answers %s with its public error",
    async (_case, result, status, body) => {
      const checkout = checkoutAnswering(result);
      const api = makeCustomerApiTestServer({
        bookingCheckout: {
          operations: operationsWith(),
          checkout: checkout.layer,
        },
      });

      const response = await api.handle(customerApiRequest(submit()));

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(body);
    }
  );

  test("answers a checkout service that can't be built as unavailable", async () => {
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        operations: operationsWith(),
        checkout: Layer.effect(CheckoutService, Effect.die("no Nexi config")),
      },
    });

    const response = await api.handle(customerApiRequest(submit()));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });

  test("answers another account's checkout as not found, without submitting", async () => {
    const checkout = checkoutAnswering(() => Effect.die("not submitted"));
    const api = makeCustomerApiTestServer({
      bookingCheckout: {
        checkout: checkout.layer,
        operations: operationsWith({
          requireAuthor: () =>
            Effect.fail(
              new PayStateAuthorNotFoundError({
                orderId: syntheticPayStateOrderId,
              })
            ),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(submit()));

    expect(response.status).toBe(404);
    expect(checkout.submissions.count).toBe(0);
  });
});
