import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Predicate, Schema } from "effect";
import type { JsonObject } from "type-fest";
import {
  checkoutSessionIdSchema,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import type { CheckoutSummaryChangedKeys } from "@/features/checkout/checkout-summary";
import { buildReservationQuote } from "@/features/checkout/reservation-quote";
import {
  canonicalPromotionCodeSchema,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import { reservationOrderSchema } from "@/features/reservation/reservation-order";
import type { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import {
  runSealedState,
  syntheticSealedStateKeyRing,
} from "@/shared/testing/sealed-state-keys.test-utils";
import { instantStringSchema } from "@/shared/utils/temporal";
import type {
  BuildSignedPayStateInput,
  PayStateReissue,
  PayStateWithHoldExpiry,
  SignedPayState,
} from "./pay-state";
import { withoutPayStateHoldExpiry } from "./signed-pay-state.test-utils";

const testEmailAddressForAda = testEmailAddress("ada");

mock.module("server-only", () => ({}));

const payStateBookedAt = instantStringSchema.make("2026-06-01T09:58:00.000Z");
const payStateHoldExpiresAt = instantStringSchema.make(
  "2026-06-01T10:08:00.000Z"
);

const {
  buildSignedPayState,
  PayState,
  payStateTokenQueryParam,
  sealPayState,
  signedPayStateSchema,
} = await import("./pay-state");
const {
  buildCheckoutPayPath,
  discountCodeErrorIdQueryParam,
  discountCodeErrorQueryParam,
} = await import("./checkout-pay-url");
const { getPayStateBinding, isOrderBoundPayState } = await import(
  "./pay-state-contract"
);
const { makeLegacySealedState, sealedStateClaimsSchema } = await import(
  "@/shared/backend/sealed-state"
);

const fixedNow = new Date("2026-06-01T10:00:00.000Z");
const fixedKey = syntheticSealedStateKeyRing(["test-kid", 1]);
const wrongKey = syntheticSealedStateKeyRing(["test-kid", 2]);
const rotatedKey = syntheticSealedStateKeyRing(["rotated-kid", 3]);
const rotatedKid = "rotated-kid";

/** Runs Pay-state work under `fixedKey` at `fixedNow` unless told otherwise. */
const run = <A, E>(
  effect: Effect.Effect<A, E, SealedStateKeys>,
  options: { readonly keys?: string; readonly at?: Date } = {}
) => runSealedState(effect, { keys: fixedKey, at: fixedNow, ...options });
const canonicalCode = Schema.decodeUnknownSync(canonicalPromotionCodeSchema)(
  "SUMMER50"
);
const submittedCodeDiscountId = Schema.decodeUnknownSync(discountIdSchema)(
  "submitted-code-discount"
);
const strictParseOptions = { onExcessProperty: "error" } as const;
const decodeSignedPayState = Schema.decodeUnknownSync(
  signedPayStateSchema,
  strictParseOptions
);
const baseReservation = Schema.decodeUnknownSync(
  normalizedCoworkReservationOrderSchema
)({
  kind: "cowork",
  entryTier: "profi",
  date: "2026-06-20",
  coffee: true,
  monitorOption: "2x27-qhd",
  name: "Ada Lovelace",
  email: testEmailAddressForAda,
  phone: "+420 777 777 777",
});

const buildState = (overrides: Partial<PayStateWithHoldExpiry> = {}) => ({
  ...run(
    buildSignedPayState({
      locale: "en-US",
      reservation: baseReservation,
      quote: buildCoworkReservationQuote(baseReservation),
      orderId: "pay-state-test-order-id",
      bookedAt: payStateBookedAt,
      holdExpiresAt: payStateHoldExpiresAt,
      checkoutSessionId: "pay-state-test-checkout-session-id",
      ttlMilliseconds: 10 * 60 * 1000,
    }),
    { keys: fixedKey, at: fixedNow }
  ),
  ...overrides,
});

const buildMeetingRoomState = ({
  earlySetup,
}: {
  readonly earlySetup?: true;
} = {}) => {
  const reservation = Schema.decodeUnknownSync(reservationOrderSchema("CZ"))({
    kind: "meeting-room",
    duration: { unit: "hour", amount: 4 },
    reservationDate: "2099-06-10",
    startsAt: "2099-06-10T08:00:00Z",
    endsAt: "2099-06-10T12:00:00Z",
    ...(earlySetup && { earlySetup }),
    name: "Ada Lovelace",
    email: testEmailAddressForAda,
    phone: "+420 777 777 777",
  });
  if (reservation.kind !== "meeting-room") {
    throw new Error("Expected meeting-room reservation");
  }

  return run(
    buildSignedPayState({
      locale: "en-US",
      reservation,
      quote: Effect.runSync(buildReservationQuote(reservation)),
      orderId: "meeting-room-pay-state-test-order-id",
      bookedAt: payStateBookedAt,
      holdExpiresAt: payStateHoldExpiresAt,
    }),
    { keys: fixedKey, at: fixedNow }
  );
};

const seal = (state = buildState()) =>
  run(sealPayState(state), { keys: fixedKey });

const replaceTokenHeader = (
  token: string,
  replace: (header: JsonObject) => JsonObject
) => {
  const [encodedHeader, ...rest] = token.split(".");
  if (!encodedHeader) throw new Error("Unexpected test token shape");

  const header = parseJsonRecord(
    Buffer.from(encodedHeader, "base64url").toString("utf8")
  );

  return [
    Buffer.from(JSON.stringify(replace(header))).toString("base64url"),
    ...rest,
  ].join(".");
};

const parseJsonRecord = (json: string): JsonObject => {
  const parsed = JSON.parse(json);
  if (!Predicate.isObject(parsed) || Array.isArray(parsed)) {
    throw new Error("Expected JSON object");
  }

  return parsed as JsonObject;
};

const tamperCiphertext = (token: string) => {
  const parts = token.split(".");
  const ciphertext = parts[2] ?? "";
  parts[2] = `${ciphertext.startsWith("A") ? "B" : "A"}${ciphertext.slice(1)}`;
  return parts.join(".");
};

describe("Pay URL state", () => {
  test("round-trips signed Pay state", () => {
    const state = buildState();
    const token = seal(state);

    expect(run(PayState.open(token), { keys: fixedKey, at: fixedNow })).toEqual(
      state
    );
    expect(state.orderId).toBe("pay-state-test-order-id");
    expect(state.checkoutSessionId).toBe("pay-state-test-checkout-session-id");
    expect(state.submittedCode).toBeUndefined();
    expect(token.split(".")).toHaveLength(4);
  });

  test("signs the reservation hold deadline it is built with", () => {
    const state = buildState();

    const opened = run(PayState.open(seal(state)), { at: fixedNow });

    expect(state.holdExpiresAt).toBe(payStateHoldExpiresAt);
    expect(opened.holdExpiresAt).toBe(payStateHoldExpiresAt);
  });

  test("opens a token signed before Pay states carried the hold deadline", () => {
    const state = buildState();

    const opened = run(
      PayState.open(
        run(sealPayState(withoutPayStateHoldExpiry(state)), { keys: fixedKey })
      ),
      { at: fixedNow }
    );

    expect(opened.holdExpiresAt).toBeUndefined();
    expect(opened).toEqual(withoutPayStateHoldExpiry(state));
  });

  test("preserves discount and price-change metadata for meeting-room state", () => {
    const changedKeys = {
      sectionKeys: ["total"],
      itemKeys: ["meeting-room"],
    };

    const opened = run(
      PayState.open(
        seal({
          ...buildMeetingRoomState(),
          submittedCode: canonicalCode,
          submittedCodeDiscountId,
          changedKeys,
        })
      ),
      { keys: fixedKey, at: fixedNow }
    );

    expect(opened.reservation.kind).toBe("meeting-room");
    expect(opened.submittedCode).toBe(canonicalCode);
    expect(opened.submittedCodeDiscountId).toBe(submittedCodeDiscountId);
    expect(opened.changedKeys).toEqual(changedKeys);
  });

  test("lists a meeting room's early setup in its summary, free, from 15 minutes before the start", () => {
    const [withSetup, without] = [
      buildMeetingRoomState({ earlySetup: true }),
      buildMeetingRoomState(),
    ].map((state) => PayState.summary(state).sections[0]?.items[0]);

    expect(withSetup).toMatchObject({
      earlySetup: {
        startsAt: "2099-06-10T07:45:00Z",
        amount: { value: 0 },
      },
    });
    expect(without).not.toHaveProperty("earlySetup");
  });

  test("fails closed when no encryption key is configured", () => {
    expect(() =>
      run(
        buildSignedPayState({
          locale: "en-US",
          reservation: baseReservation,
          quote: buildCoworkReservationQuote(baseReservation),
          orderId: "missing-key-test",
          bookedAt: payStateBookedAt,
        }),
        { keys: "" }
      )
    ).toThrow("kid:base64url-32-byte-key");
  });

  test("rejects expired Pay state while retaining its restart family", () => {
    const token = seal(buildMeetingRoomState());
    const afterExpiry = new Date("2026-06-01T10:11:00.000Z");

    expect(() => run(PayState.open(token), { at: afterExpiry })).toThrow(
      "expired"
    );
    expect(run(PayState.restartKind(token), { at: afterExpiry })).toBe(
      "meeting-room"
    );
  });

  test("round-trips a requested discount code without an applied pair", () => {
    const requestedCode = Schema.decodeUnknownSync(
      canonicalPromotionCodeSchema
    )("CAMPAIGN10");
    const state = buildState({ requestedDiscountCode: requestedCode });
    const token = seal(state);
    const opened = run(PayState.open(token), { keys: fixedKey, at: fixedNow });

    expect(opened).toEqual(state);
    expect(opened.requestedDiscountCode).toBe(requestedCode);
    expect(opened.submittedCode).toBeUndefined();
    expect(opened.submittedCodeDiscountId).toBeUndefined();
    expect(token).not.toContain("CAMPAIGN10");
  });

  test("rejects tampered ciphertext", () => {
    const token = tamperCiphertext(seal());

    expect(() =>
      run(PayState.open(token), { keys: fixedKey, at: fixedNow })
    ).toThrow("Invalid Pay state token");
    expect(() => run(PayState.restartKind(token), { keys: fixedKey })).toThrow(
      "Invalid Pay state token"
    );
  });

  test("rejects wrong and unknown key ids", () => {
    const token = seal();
    const unknownKidToken = replaceTokenHeader(token, (header) => ({
      ...header,
      kid: "unknown-kid",
    }));

    expect(() =>
      run(PayState.open(token), { keys: wrongKey, at: fixedNow })
    ).toThrow("Invalid Pay state token");
    expect(() =>
      run(PayState.open(unknownKidToken), { keys: fixedKey, at: fixedNow })
    ).toThrow("unknown key id");
  });

  test("keeps existing tokens readable while rotating to a new active key", () => {
    const oldState = buildState();
    const oldToken = seal(oldState);
    const newState = run(
      buildSignedPayState({
        locale: "en-US",
        reservation: baseReservation,
        quote: buildCoworkReservationQuote(baseReservation),
        orderId: "rotated-key-order-id",
        bookedAt: payStateBookedAt,
      }),
      { keys: `${rotatedKey},${fixedKey}`, at: fixedNow }
    );

    expect(
      run(PayState.open(oldToken), {
        keys: `${rotatedKey},${fixedKey}`,
        at: fixedNow,
      })
    ).toEqual(oldState);
    expect(newState.kid).toBe(rotatedKid);
    expect(
      run(
        PayState.open(
          run(sealPayState(newState), { keys: `${rotatedKey},${fixedKey}` })
        ),
        { keys: `${rotatedKey},${fixedKey}`, at: fixedNow }
      )
    ).toEqual(newState);
  });

  test("strictly validates generic applied-discount snapshots", () => {
    const state = buildState();
    const validApplication = {
      discount: {
        id: "discount-id",
        label: "Summer sale",
        adjustment: { kind: "percentage" as const, basisPoints: 5000 },
      },
      subtotalBefore: state.quote.payment.undiscountedPrice,
      amount: {
        ...state.quote.payment.undiscountedPrice,
        value: 1,
      },
      subtotalAfter: {
        ...state.quote.payment.undiscountedPrice,
        value: state.quote.payment.undiscountedPrice.value - 1,
      },
    };
    const stateWithDiscount = {
      ...state,
      quote: {
        ...state.quote,
        payment: {
          ...state.quote.payment,
          discounts: [validApplication],
        },
      },
    };
    const invalidAmountState = {
      ...stateWithDiscount,
      quote: {
        ...stateWithDiscount.quote,
        payment: {
          ...stateWithDiscount.quote.payment,
          discounts: [
            {
              ...validApplication,
              amount: { ...validApplication.amount, value: -1 },
            },
          ],
        },
      },
    };
    const providerSpecificState = {
      ...stateWithDiscount,
      quote: {
        ...stateWithDiscount.quote,
        payment: {
          ...stateWithDiscount.quote.payment,
          discounts: [
            {
              ...validApplication,
              discount: {
                ...validApplication.discount,
                providerId: "private-provider-id",
              },
            },
          ],
        },
      },
    };

    expect(() => decodeSignedPayState(stateWithDiscount)).not.toThrow();
    expect(() => decodeSignedPayState(invalidAmountState)).toThrow();
    expect(() => decodeSignedPayState(providerSpecificState)).toThrow();
  });

  test("requires submitted code metadata to occur together", () => {
    expect(() =>
      decodeSignedPayState({
        ...buildState(),
        submittedCode: canonicalCode,
      })
    ).toThrow('at ["submittedCodeDiscountId"]');
    expect(() =>
      decodeSignedPayState({
        ...buildState(),
        submittedCodeDiscountId,
      })
    ).toThrow('at ["submittedCodeDiscountId"]');
  });

  test("does not expose plaintext PII in the encrypted URL token", () => {
    const token = seal(
      buildState({
        submittedCode: canonicalCode,
        submittedCodeDiscountId,
      })
    );

    expect(token).not.toContain(baseReservation.name);
    expect(token).not.toContain(baseReservation.email);
    expect(token).not.toContain(baseReservation.phone);
    expect(token).not.toContain("SUMMER50");
  });

  test("finds the submitted code application by its opaque id rather than position", () => {
    const state = buildState();
    const makeApplication = (id: string, value: number) => ({
      discount: {
        id: Schema.decodeUnknownSync(discountIdSchema)(id),
        label: id,
        adjustment: { kind: "percentage" as const, basisPoints: 1000 },
      },
      subtotalBefore: state.quote.payment.undiscountedPrice,
      amount: {
        ...state.quote.payment.undiscountedPrice,
        value,
      },
      subtotalAfter: {
        ...state.quote.payment.undiscountedPrice,
        value: state.quote.payment.undiscountedPrice.value - value,
      },
    });
    const codeApplication = makeApplication(submittedCodeDiscountId, 1000);
    const laterApplication = makeApplication("later-discount", 500);
    const stateWithLaterDiscount = {
      ...state,
      submittedCode: canonicalCode,
      submittedCodeDiscountId,
      quote: {
        ...state.quote,
        payment: {
          ...state.quote.payment,
          discounts: [codeApplication, laterApplication],
        },
      },
    };

    expect(PayState.submittedCodeApplication(stateWithLaterDiscount)).toEqual(
      codeApplication
    );
  });

  test("builds a clean payable continuation after price review", () => {
    const reviewState = buildState({
      changedKeys: {
        sectionKeys: ["order", "total"],
        itemKeys: ["product:cowork:profi"],
      },
    });
    const { payUrl: path } = run(
      PayState.reissue(reviewState, { kind: "reviewed" }),
      { keys: fixedKey, at: fixedNow }
    );
    const token = new URL(path, "https://deskohub.test").searchParams.get(
      payStateTokenQueryParam
    );
    const continued = run(PayState.open(token ?? ""), {
      keys: fixedKey,
      at: fixedNow,
    });

    expect(continued.changedKeys).toBeUndefined();
    expect(continued.holdExpiresAt).toBe(reviewState.holdExpiresAt);
    expect(continued.quote).toEqual(reviewState.quote);
    expect(continued.orderId).toBe(reviewState.orderId);
    expect(continued.submittedCode).toBeUndefined();
    expect(continued.submittedCodeDiscountId).toBeUndefined();
  });

  test("keeps the hold deadline while a later continuation gets a later expiry", () => {
    const reviewState = buildState({
      changedKeys: { sectionKeys: ["total"], itemKeys: [] },
    });
    const later = new Date(fixedNow.getTime() + 3 * 60 * 1000);

    const { payUrl: path } = run(
      PayState.reissue(reviewState, { kind: "reviewed" }),
      { at: later }
    );
    const continued = run(
      PayState.open(
        new URL(path, "https://deskohub.test").searchParams.get(
          payStateTokenQueryParam
        ) ?? ""
      ),
      { at: later }
    );

    expect(continued.exp).toBeGreaterThan(reviewState.exp);
    expect(continued.holdExpiresAt).toBe(payStateHoldExpiresAt);
  });
});

const referralCode = Schema.decodeUnknownSync(canonicalPromotionCodeSchema)(
  "FRIEND42"
);
const enteredCode = Schema.decodeUnknownSync(canonicalPromotionCodeSchema)(
  "WINTER20"
);
const reviewKeys: CheckoutSummaryChangedKeys = {
  sectionKeys: ["order", "total"],
  itemKeys: ["product:cowork:profi"],
};
const repricedKeys: CheckoutSummaryChangedKeys = {
  sectionKeys: ["total"],
  itemKeys: [],
};
const baseQuote = buildCoworkReservationQuote(baseReservation);
/** The base quote showing the submitted code's discount. */
const discountedQuote = {
  ...baseQuote,
  payment: {
    ...baseQuote.payment,
    discounts: [
      {
        discount: {
          id: submittedCodeDiscountId,
          label: "Submitted code",
          adjustment: { kind: "percentage" as const, basisPoints: 1000 },
        },
        subtotalBefore: baseQuote.payment.undiscountedPrice,
        amount: { ...baseQuote.payment.undiscountedPrice, value: 1000 },
        subtotalAfter: {
          ...baseQuote.payment.undiscountedPrice,
          value: baseQuote.payment.undiscountedPrice.value - 1000,
        },
      },
    ],
  },
};

/** A state carrying every optional field a continuation may keep. */
const buildCarryingState = (overrides: Partial<PayStateWithHoldExpiry> = {}) =>
  buildState({
    quote: discountedQuote,
    submittedCode: canonicalCode,
    submittedCodeDiscountId,
    requestedDiscountCode: canonicalCode,
    referralCode,
    ...overrides,
  } as Partial<PayStateWithHoldExpiry>);

/** What a Pay state signs for its order, without its claims. */
const signedOrderFields = [
  "locale",
  "orderId",
  "bookedAt",
  "holdExpiresAt",
  "checkoutSessionId",
  "submittedCode",
  "submittedCodeDiscountId",
  "requestedDiscountCode",
  "referralCode",
  "changedKeys",
  "reservation",
  "quote",
] as const;
const signedOrder = (state: SignedPayState) =>
  Object.fromEntries(
    signedOrderFields.flatMap((field) =>
      state[field] === undefined ? [] : [[field, state[field]]]
    )
  );

/**
 * One of each outcome a Pay state can be reissued after, priced on `state`;
 * a new outcome kind fails to compile here until it is listed.
 */
const everyReissueOutcome = (
  state: PayStateWithHoldExpiry
): ReadonlyArray<PayStateReissue> => {
  const priced = { reservation: state.reservation, quote: baseQuote };
  const outcomes: {
    readonly [Kind in PayStateReissue["kind"]]: Extract<
      PayStateReissue,
      { readonly kind: Kind }
    >;
  } = {
    review_pending: { kind: "review_pending" },
    reviewed: { kind: "reviewed" },
    repriced: {
      kind: "repriced",
      verdict: { status: "pricing_changed", priced, changedKeys: reviewKeys },
    },
    code_entered: {
      kind: "code_entered",
      code: enteredCode,
      verdict: { status: "pricing_changed", priced, changedKeys: reviewKeys },
    },
    code_rejected: {
      kind: "code_rejected",
      code: enteredCode,
      rejection: "unavailable",
    },
    referral_applied: {
      kind: "referral_applied",
      referralCode,
      verdict: { status: "affirmed", priced },
    },
    code_cleared: {
      kind: "code_cleared",
      verdict: { status: "affirmed", priced },
    },
    requested_code_cleared: { kind: "requested_code_cleared" },
  };
  return Object.values(outcomes);
};

const reissue = (state: PayStateWithHoldExpiry, outcome: PayStateReissue) => {
  const issued = run(PayState.reissue(state, outcome));
  const url = new URL(issued.payUrl, "https://deskohub.test");
  return {
    issued,
    url,
    continued: signedOrder(run(PayState.open(issued.payStateToken))),
  };
};

describe("PayState.reissue", () => {
  test("re-signs a pending price review, requesting the submitted code", () => {
    const state = buildCarryingState({
      requestedDiscountCode: undefined,
      changedKeys: reviewKeys,
    });
    const { url, continued } = reissue(state, { kind: "review_pending" });

    expect(continued).toEqual({
      ...signedOrder(state),
      requestedDiscountCode: canonicalCode,
    });
    expect(url.searchParams.has("orderId")).toBe(false);
  });

  test("keeps an already requested code when it re-signs a pending review", () => {
    const state = buildCarryingState({
      requestedDiscountCode: enteredCode,
      changedKeys: reviewKeys,
    });

    expect(reissue(state, { kind: "review_pending" }).continued).toEqual(
      signedOrder(state)
    );
  });

  test("drops only the changed keys once the customer reviewed them", () => {
    const state = buildCarryingState({
      requestedDiscountCode: undefined,
      changedKeys: reviewKeys,
    });
    const { url, continued } = reissue(state, { kind: "reviewed" });

    expect(continued).toEqual({
      ...signedOrder(state),
      changedKeys: undefined,
    });
    expect(url.pathname).toBe("/en-US/checkout/pay");
    expect([...url.searchParams.keys()]).toEqual([payStateTokenQueryParam]);
  });

  test("re-prices with the verdict's changed keys, keeping a still-applied code", () => {
    const state = buildCarryingState();
    const { url, continued } = reissue(state, {
      kind: "repriced",
      verdict: {
        status: "pricing_changed",
        priced: { reservation: state.reservation, quote: discountedQuote },
        changedKeys: repricedKeys,
      },
    });

    expect(continued).toEqual({
      ...signedOrder(state),
      changedKeys: repricedKeys,
    });
    expect(url.searchParams.has("orderId")).toBe(false);
  });

  test("re-prices without a submitted code the new quote no longer applies", () => {
    const state = buildCarryingState({ requestedDiscountCode: undefined });
    const { continued } = reissue(state, {
      kind: "repriced",
      verdict: {
        status: "pricing_changed",
        priced: { reservation: state.reservation, quote: baseQuote },
        changedKeys: repricedKeys,
      },
    });

    expect(continued).toEqual({
      ...signedOrder(state),
      quote: baseQuote,
      submittedCode: undefined,
      submittedCodeDiscountId: undefined,
      requestedDiscountCode: canonicalCode,
      changedKeys: repricedKeys,
    });
  });

  test("applies an entered code as submitted and requested, without changed keys", () => {
    const state = buildState({ referralCode });
    const { url, continued } = reissue(state, {
      kind: "code_entered",
      code: enteredCode,
      verdict: {
        status: "affirmed",
        priced: {
          reservation: state.reservation,
          quote: discountedQuote,
          submittedCodeDiscountId,
        },
      },
    });

    expect(continued).toEqual({
      ...signedOrder(state),
      quote: discountedQuote,
      submittedCode: enteredCode,
      submittedCodeDiscountId,
      requestedDiscountCode: enteredCode,
    });
    expect(url.searchParams.get("orderId")).toBe(state.orderId);
  });

  test("asks to review a price an entered code changed, keeping the code only as requested", () => {
    const state = buildState({ referralCode });
    const { url, continued } = reissue(state, {
      kind: "code_entered",
      code: enteredCode,
      verdict: {
        status: "pricing_changed",
        priced: { reservation: state.reservation, quote: discountedQuote },
        changedKeys: repricedKeys,
      },
    });

    expect(continued).toEqual({
      ...signedOrder(state),
      quote: discountedQuote,
      requestedDiscountCode: enteredCode,
      changedKeys: repricedKeys,
    });
    expect(url.searchParams.get("orderId")).toBe(state.orderId);
  });

  test("keeps a rejected code in the box with the rejection beside it", () => {
    const state = buildState({
      referralCode,
      requestedDiscountCode: canonicalCode,
    });
    const { url, continued } = reissue(state, {
      kind: "code_rejected",
      code: enteredCode,
      rejection: "referral-ineligible",
    });

    expect(continued).toEqual({
      ...signedOrder(state),
      requestedDiscountCode: enteredCode,
    });
    expect(url.searchParams.get("orderId")).toBe(state.orderId);
    expect(url.searchParams.get(discountCodeErrorQueryParam)).toBe(
      "referral-ineligible"
    );
    expect(url.searchParams.get(discountCodeErrorIdQueryParam)).toBeTruthy();
  });

  test("applies a referral without carrying the requested code forward", () => {
    const state = buildCarryingState({ referralCode: undefined });
    const { url, continued } = reissue(state, {
      kind: "referral_applied",
      referralCode,
      verdict: {
        status: "affirmed",
        priced: { reservation: state.reservation, quote: discountedQuote },
      },
    });

    // Open developer question: the referral outcome does not carry
    // `requestedDiscountCode` forward, unlike every other outcome.
    expect(continued).toEqual({
      ...signedOrder(state),
      referralCode,
      requestedDiscountCode: undefined,
    });
    expect(url.searchParams.get("orderId")).toBe(state.orderId);
  });

  test("asks to review a referral's price change under the referral's own verdict", () => {
    const state = buildCarryingState({ referralCode: undefined });
    const { continued } = reissue(state, {
      kind: "referral_applied",
      referralCode: undefined,
      verdict: {
        status: "pricing_changed",
        priced: { reservation: state.reservation, quote: baseQuote },
        changedKeys: repricedKeys,
      },
    });

    expect(continued).toEqual({
      ...signedOrder(state),
      quote: baseQuote,
      submittedCode: undefined,
      submittedCodeDiscountId: undefined,
      requestedDiscountCode: undefined,
      changedKeys: repricedKeys,
    });
  });

  test("re-prices without the removed code, asking to review the changed price", () => {
    const state = buildCarryingState();
    const { url, continued } = reissue(state, {
      kind: "code_cleared",
      verdict: {
        status: "pricing_changed",
        priced: { reservation: state.reservation, quote: baseQuote },
        changedKeys: repricedKeys,
      },
    });

    expect(continued).toEqual({
      ...signedOrder(state),
      quote: baseQuote,
      submittedCode: undefined,
      submittedCodeDiscountId: undefined,
      requestedDiscountCode: undefined,
      changedKeys: repricedKeys,
    });
    expect(url.searchParams.get("orderId")).toBe(state.orderId);
  });

  test("removes a code worth nothing without asking for a review", () => {
    const state = buildCarryingState({ changedKeys: reviewKeys });
    const { continued } = reissue(state, {
      kind: "code_cleared",
      verdict: {
        status: "affirmed",
        priced: { reservation: state.reservation, quote: discountedQuote },
      },
    });

    expect(continued).toEqual({
      ...signedOrder(state),
      submittedCode: undefined,
      submittedCodeDiscountId: undefined,
      requestedDiscountCode: undefined,
      changedKeys: undefined,
    });
  });

  test("drops a requested code without repricing", () => {
    const state = buildState({
      referralCode,
      requestedDiscountCode: enteredCode,
    });
    const { url, continued } = reissue(state, {
      kind: "requested_code_cleared",
    });

    expect(continued).toEqual({
      ...signedOrder(state),
      requestedDiscountCode: undefined,
    });
    expect(url.searchParams.get("orderId")).toBe(state.orderId);
  });

  test("carries the hold deadline it is given into every outcome", () => {
    const storedDeadline = instantStringSchema.make("2026-06-01T10:05:00.000Z");
    const state = buildCarryingState({
      holdExpiresAt: storedDeadline,
      changedKeys: reviewKeys,
    });
    for (const outcome of everyReissueOutcome(state)) {
      expect(reissue(state, outcome).continued.holdExpiresAt).toBe(
        storedDeadline
      );
    }
  });

  test("reports a sealing failure as a server failure, never a rejected caller token", () => {
    const state = buildState();
    const error = run(
      Effect.flip(
        PayState.reissue(
          { ...state, quote: { ...state.quote, fingerprint: 42 } } as never,
          { kind: "reviewed" }
        )
      )
    );

    expect(error).toMatchObject({
      _tag: "PayStateIssueError",
      cause: { _tag: "PayStateTokenError" },
    });
  });
});

describe("PayState.issue", () => {
  const fresh = {
    locale: "en-US",
    reservation: baseReservation,
    quote: baseQuote,
    orderId: "pay-state-test-order-id",
    bookedAt: payStateBookedAt,
    holdExpiresAt: payStateHoldExpiresAt,
    checkoutSessionId: "pay-state-test-checkout-session-id",
  } satisfies BuildSignedPayStateInput;

  test("returns the sealed token beside the order's Pay URL, with the token's expiry", () => {
    const issued = run(PayState.issue(fresh));
    const opened = run(PayState.open(issued.payStateToken));

    expect(issued.payUrl).toBe(
      buildCheckoutPayPath("en-US", issued.payStateToken, {
        orderId: fresh.orderId,
      })
    );
    expect(issued.expiresAt).toBe(new Date(opened.exp * 1000).toISOString());
    expect(signedOrder(opened)).toEqual(fresh);
  });

  test("issues a stable link as of its anchor, byte-identical when repeated", () => {
    const stableAt = Temporal.Instant.from("2026-06-01T09:58:00Z");
    const first = run(PayState.issue(fresh, { stableAt }));
    const second = run(PayState.issue(fresh, { stableAt }));
    const random = run(PayState.issue(fresh));

    expect(second).toEqual(first);
    expect(random.payStateToken).not.toBe(first.payStateToken);
    expect(first.expiresAt).toBe("2026-06-01T10:08:00.000Z");
  });

  test("reports a sealing failure as a Pay state token failure", () => {
    const error = run(
      Effect.flip(
        PayState.issue({
          ...fresh,
          quote: { ...fresh.quote, fingerprint: 42 },
        } as never)
      )
    );

    expect(error).toMatchObject({ _tag: "PayStateTokenError" });
  });
});

describe("PayState.open on a page", () => {
  const token = () => seal(buildState());

  test("opens a state issued for the page's locale and reservation kind", () => {
    expect(
      run(
        PayState.open(token(), { locale: "en-US", reservationKind: "cowork" })
      ).orderId
    ).toBe("pay-state-test-order-id");
    expect(run(PayState.open(token(), { locale: "en-US" })).orderId).toBe(
      "pay-state-test-order-id"
    );
  });

  test("refuses a state issued for another locale or reservation kind", () => {
    for (const page of [
      { locale: "cs-CZ" },
      { locale: "en-US", reservationKind: "office" as const },
    ]) {
      const error = run(Effect.flip(PayState.open(token(), page)));
      expect(error).toMatchObject({
        _tag: "PayStateTokenError",
        code: "invalid-token",
      });
    }
  });
});

// Any record with claims, in the Pay-state token format.
const payStateRecord = makeLegacySealedState({
  schema: Schema.StructWithRest(Schema.Struct(sealedStateClaimsSchema.fields), [
    Schema.Record(Schema.String, Schema.Unknown),
  ]),
  ttlMilliseconds: 10 * 60 * 1000,
});

describe("legacy signed Pay state with a retired customer message", () => {
  const openLegacyPayStateWithMessage = (state: SignedPayState) => {
    const legacyState = {
      ...state,
      reservation: {
        ...state.reservation,
        message: "Private setup note.",
      },
    };
    // Seal below the Pay-state schema so the retired key is already in the token.
    const token = run(payStateRecord.seal(legacyState));

    return {
      legacyState,
      opened: run(PayState.open(token), { keys: fixedKey, at: fixedNow }),
      restartKind: run(PayState.restartKind(token), { keys: fixedKey }),
    };
  };

  test("restores cowork Pay state from a token with retired message", () => {
    const state = buildState();
    const { legacyState, opened, restartKind } =
      openLegacyPayStateWithMessage(state);

    expect(legacyState.reservation).toHaveProperty(
      "message",
      "Private setup note."
    );
    expect(opened).toEqual(state);
    expect(opened.reservation).not.toHaveProperty("message");
    expect(opened.reservation).toMatchObject({
      kind: "cowork",
      entryTier: "profi",
      date: "2026-06-20",
      coffee: true,
      monitorOption: "2x27-qhd",
    });
    expect(restartKind).toBe("cowork");
  });
});

describe("reservation phone in signed Pay state", () => {
  test("keeps the entered reservation phone text", () => {
    const state = buildState();

    expect(
      run(PayState.open(seal(state)), { keys: fixedKey, at: fixedNow })
        .reservation.phone
    ).toBe("+420 777 777 777");
  });

  // Seal below the Pay-state schema, as a token from before a rule change would be.
  const openWithPhone = (
    phone: string,
    locale: SignedPayState["locale"] = "en-US"
  ) => {
    const state = buildState({ locale });
    const token = run(
      payStateRecord.seal({
        ...state,
        reservation: { ...state.reservation, phone },
      })
    );
    return run(PayState.open(token), { keys: fixedKey, at: fixedNow });
  };

  test("opens a token whose reservation phone is valid entered text", () => {
    expect(openWithPhone("777 123 456").reservation.phone).toBe("777 123 456");
  });

  test.each(["+420 123 456 789", "777 123 4567", "777 123 456 (mobile)"])(
    "does not open a token whose reservation phone is %p",
    (phone) => {
      expect(() => openWithPhone(phone)).toThrow("Invalid Pay state token");
    }
  );

  test("reads the phone in the region of the token's own locale", () => {
    expect(openWithPhone("0151 23456789", "de-DE").reservation.phone).toBe(
      "0151 23456789"
    );
    expect(() => openWithPhone("0151 23456789", "cs-CZ")).toThrow(
      "Invalid Pay state token"
    );
    expect(() => openWithPhone("0151 234567890123", "de-DE")).toThrow(
      "Invalid Pay state token"
    );
  });

  test("builds and opens a de-DE Pay state with a phone read in Germany", () => {
    const state = run(
      buildSignedPayState({
        locale: "de-DE",
        reservation: { ...baseReservation, phone: "0151 23456789" },
        quote: buildCoworkReservationQuote(baseReservation),
        orderId: "pay-state-test-order-id",
        bookedAt: payStateBookedAt,
        checkoutSessionId: "pay-state-test-checkout-session-id",
        ttlMilliseconds: 10 * 60 * 1000,
      }),
      { keys: fixedKey, at: fixedNow }
    );

    expect(
      run(PayState.open(seal(state)), { keys: fixedKey, at: fixedNow })
        .reservation.phone
    ).toBe("0151 23456789");
  });
});

describe("Pay state binding", () => {
  const retriedAttemptId = paymentAttemptIdSchema.make(
    "pay-state-test-retried-attempt-id"
  );
  const buildOrderBoundState = () =>
    run(
      buildSignedPayState({
        locale: "en-US",
        reservation: baseReservation,
        quote: buildCoworkReservationQuote(baseReservation),
        orderId: "pay-state-test-order-id",
        bookedAt: payStateBookedAt,
        holdExpiresAt: payStateHoldExpiresAt,
        binding: "order",
        retriedAttemptId,
      })
    );

  test("an order-bound state round-trips without a checkout session", () => {
    const state = buildOrderBoundState();
    const opened = run(PayState.open(seal(state)));

    expect(opened).toEqual(state);
    expect(opened.checkoutSessionId).toBeUndefined();
    expect(getPayStateBinding(opened)).toEqual({
      kind: "order",
      retriedAttemptId,
    });
    expect(isOrderBoundPayState(opened)).toBe(true);
  });

  test("a session state, as issued before order binding existed, stays session-bound", () => {
    const state = buildState();

    expect(state.binding).toBeUndefined();
    expect(getPayStateBinding(state)).toEqual({
      kind: "session",
      checkoutSessionId: "pay-state-test-checkout-session-id",
    });
    expect(isOrderBoundPayState(state)).toBe(false);
  });

  test("a state naming neither binding pays no order", () => {
    const state = buildMeetingRoomState();

    expect(getPayStateBinding(state)).toBeUndefined();
    expect(isOrderBoundPayState(state)).toBe(false);
  });

  test("an order-bound state must name the attempt it retries, and only it may", () => {
    const { retriedAttemptId: _retried, ...withoutRetriedAttempt } =
      buildOrderBoundState();

    expect(() => decodeSignedPayState(withoutRetriedAttempt)).toThrow();
    expect(() =>
      decodeSignedPayState({ ...buildState(), retriedAttemptId })
    ).toThrow();
    expect(getPayStateBinding({ binding: "order" })).toBeUndefined();
    expect(
      getPayStateBinding({
        checkoutSessionId: checkoutSessionIdSchema.make("session"),
        retriedAttemptId,
      })
    ).toBeUndefined();
  });

  test("an order-bound state carrying a checkout session id is refused", () => {
    expect(() =>
      decodeSignedPayState({
        ...buildOrderBoundState(),
        checkoutSessionId: "pay-state-test-checkout-session-id",
      })
    ).toThrow();
    expect(
      getPayStateBinding({
        binding: "order",
        checkoutSessionId: checkoutSessionIdSchema.make("session"),
      })
    ).toBeUndefined();
  });

  test("every reissue outcome keeps the order binding and never gains a session", () => {
    const state = buildCarryingState({
      checkoutSessionId: undefined,
      binding: "order",
      retriedAttemptId,
      changedKeys: reviewKeys,
    });
    for (const outcome of everyReissueOutcome(state)) {
      const issued = run(PayState.reissue(state, outcome));
      const continued = run(PayState.open(issued.payStateToken));

      expect(getPayStateBinding(continued)).toEqual({
        kind: "order",
        retriedAttemptId,
      });
      expect(continued.checkoutSessionId).toBeUndefined();
    }
  });

  test("the price-review continuation keeps the order binding", () => {
    const reviewed = {
      ...buildOrderBoundState(),
      changedKeys: { sectionKeys: ["total"], itemKeys: [] },
    };
    const issued = run(PayState.reissue(reviewed, { kind: "reviewed" }));
    const continued = run(PayState.open(issued.payStateToken));

    expect(continued.changedKeys).toBeUndefined();
    expect(isOrderBoundPayState(continued)).toBe(true);
    expect(continued.retriedAttemptId).toBe(retriedAttemptId);
  });
});
