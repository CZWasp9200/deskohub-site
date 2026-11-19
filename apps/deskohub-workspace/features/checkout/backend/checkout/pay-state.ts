import { randomUUID } from "node:crypto";
import { isPhoneNumber } from "@deskohub/phone-number";
import { Data, Effect, Match, Schema } from "effect";
import type { CheckoutSummary } from "@/features/checkout/checkout-summary";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import type { DiscountCodeRejection } from "@/features/checkout/discount-code-rejection";
import { payStateTokenQueryParam } from "@/features/checkout/pay-state-token-query";
import { coworkReservationQuoteSchema } from "@/features/checkout/reservation-quote-cowork";
import { meetingRoomReservationQuoteSchema } from "@/features/checkout/reservation-quote-meeting-room";
import { officeReservationQuoteSchema } from "@/features/checkout/reservation-quote-office";
import type { AppliedDiscount } from "@/features/discounts";
import type {
  CanonicalPromotionCode,
  DiscountId,
} from "@/features/discounts/contracts";
import { defaultPhoneRegion } from "@/features/i18n";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import { normalizedMeetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";
import { normalizedOfficeReservationOrderSchema } from "@/features/reservation/office-reservation";
import {
  makeLegacySealedState,
  type SealedStateIssueOptions,
  type SealedStateSealOptions,
  type SealedStateTokenError,
} from "@/shared/backend/sealed-state";
import {
  type Instant,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import {
  buildCheckoutPayPath,
  type CheckoutPayPathOptions,
} from "./checkout-pay-url";
import {
  type BuildSignedPayStateCommonInput,
  buildSignedPayStateEnvelope,
  getPayStateBindingInput,
  type PayStateSubmittedCodeMetadata,
  signedPayStateEnvelopeSchema,
} from "./pay-state-contract";
import { getPriceVerdictChangedKeys, type PriceVerdict } from "./price-verdict";

export { payStateTokenQueryParam };
export const payStateDefaultTtlMilliseconds = 10 * 60 * 1000;

/** A reservation family's Pay state: the signed envelope with its order. */
const familyPayStateSchema = <
  Reservation extends Schema.Top,
  Quote extends Schema.Top,
>(
  reservation: Reservation,
  quote: Quote
) =>
  Schema.Struct({
    ...signedPayStateEnvelopeSchema.fields,
    reservation,
    quote,
  });

export const signedPayStateSchema = Schema.Union([
  familyPayStateSchema(
    normalizedCoworkReservationOrderSchema,
    coworkReservationQuoteSchema
  ),
  familyPayStateSchema(
    normalizedMeetingRoomReservationOrderSchema,
    meetingRoomReservationQuoteSchema
  ),
  familyPayStateSchema(
    normalizedOfficeReservationOrderSchema,
    officeReservationQuoteSchema
  ),
])
  .check(
    Schema.makeFilter(
      ({ submittedCode, submittedCodeDiscountId }) =>
        (submittedCode === undefined) ===
          (submittedCodeDiscountId === undefined) || {
          path: ["submittedCodeDiscountId"],
          issue:
            "submitted code and submitted code discount id must occur together",
        }
    ),
    Schema.makeFilter(
      ({ binding, checkoutSessionId }) =>
        binding === undefined ||
        checkoutSessionId === undefined || {
          path: ["binding"],
          issue: "an order-bound Pay state carries no checkout session id",
        }
    ),
    Schema.makeFilter(
      ({ binding, retriedAttemptId }) =>
        (binding === "order") === (retriedAttemptId !== undefined) || {
          path: ["retriedAttemptId"],
          issue:
            "an order-bound Pay state, and only one, names the attempt it retries",
        }
    ),
    // The normalized reservation carries no locale; the Pay state does, so it
    // re-checks the phone in that locale's region. A token whose phone fails
    // today's rule doesn't open.
    Schema.makeFilter(
      ({ locale, reservation }) =>
        isPhoneNumber(reservation.phone, defaultPhoneRegion(locale)) || {
          path: ["reservation", "phone"],
          issue: "reservation phone must be valid in the locale's region",
        }
    )
  )
  .annotate({
    identifier: "SignedPayState",
    description: "Workspace checkout Pay state payload.",
  });

export type SignedPayState = typeof signedPayStateSchema.Type &
  PayStateSubmittedCodeMetadata;

/**
 * A Pay state whose reservation hold deadline is known. Every Pay state built
 * carries it; an opened one may predate the claim, so it gets the stored
 * deadline from `withPayStateHoldExpiry` or `loadPayStateHoldExpiry` before
 * it is reissued.
 */
export type PayStateWithHoldExpiry = SignedPayState & {
  readonly holdExpiresAt: Instant;
};

const preserveSignedPayStateMetadataInvariant = (
  state: typeof signedPayStateSchema.Type
): SignedPayState => state as SignedPayState;

/**
 * Pay-state tokens live in open Pay pages and agent links, so they keep the
 * sealed state format that predates purposes.
 */
const payStateCodec = makeLegacySealedState({
  schema: signedPayStateSchema,
  ttlMilliseconds: payStateDefaultTtlMilliseconds,
});

/** One family's reservation with its quote, as a Pay state carries them. */
export type SignedPayStatePricing = SignedPayState extends infer State
  ? State extends SignedPayState
    ? Pick<State, "reservation" | "quote">
    : never
  : never;

/** What a new Pay state signs: the order, its pricing and its carried codes. */
export type BuildSignedPayStateInput = BuildSignedPayStateCommonInput &
  SignedPayStatePricing;

const getSignedPayStateCheckoutSummary = (
  state: SignedPayStatePricing
): CheckoutSummary =>
  Match.value(state).pipe(
    Match.when({ reservation: { kind: "cowork" } }, ({ quote, reservation }) =>
      getCoworkCheckoutSummary(reservation, quote)
    ),
    Match.when(
      { reservation: { kind: "meeting-room" } },
      ({ quote, reservation }) =>
        getMeetingRoomCheckoutSummary(quote, reservation)
    ),
    Match.when({ reservation: { kind: "office" } }, ({ quote }) =>
      getOfficeCheckoutSummary(quote)
    ),
    Match.exhaustive
  );

const getSignedPayStateSubmittedCodeApplication = (
  state: SignedPayState
): AppliedDiscount | undefined => {
  if (state.submittedCodeDiscountId === undefined) return undefined;

  return state.quote.payment.discounts.find(
    ({ discount }) => discount.id === state.submittedCodeDiscountId
  );
};

/**
 * The state's submitted code, kept only while the re-priced order still
 * applies its discount.
 */
const getSubmittedCodeStillApplied = (
  state: SignedPayState,
  priced: SignedPayStatePricing
): PayStateSubmittedCodeMetadata => {
  const application = priced.quote.payment.discounts.find(
    ({ discount }) => discount.id === state.submittedCodeDiscountId
  );
  if (state.submittedCode === undefined || application === undefined) return {};

  return {
    submittedCode: state.submittedCode,
    submittedCodeDiscountId: application.discount.id,
  };
};

/**
 * Booking moment locked into the Pay state at reservation submission. Later
 * price affirmations evaluate calendar sales at this moment instead of now.
 */
const getSignedPayStateBookedAt = (state: Pick<SignedPayState, "bookedAt">) =>
  Temporal.Instant.from(state.bookedAt);

/** The instant the Pay page stops accepting a signed state. */
const getPayStateExpiresAt = (state: Pick<SignedPayState, "exp">) =>
  temporalInstantToIsoString(
    Temporal.Instant.fromEpochMilliseconds(state.exp * 1000)
  );

const payStateTokenMessages = {
  "missing-secret": "At least one Pay state encryption key is required.",
  "invalid-secret": "Pay state configuration is invalid.",
  "invalid-token": "Invalid Pay state token.",
  "unknown-kid": "Pay state token used an unknown key id.",
  expired: "Pay state token expired.",
} as const satisfies Record<SealedStateTokenError["code"], string>;

export class PayStateTokenError extends Data.TaggedError("PayStateTokenError")<{
  readonly code: SealedStateTokenError["code"];
  readonly message: string;
  readonly cause?: unknown;
}> {
  static fromSealedState = (cause: SealedStateTokenError) =>
    new PayStateTokenError({
      code: cause.code,
      message: payStateTokenMessages[cause.code],
      cause,
    });

  static invalidState = (cause: Schema.SchemaError) =>
    new PayStateTokenError({
      code: "invalid-token",
      message: "Invalid Pay state.",
      cause,
    });

  static forAnotherPage = () =>
    new PayStateTokenError({
      code: "invalid-token",
      message: "Pay state was issued for another locale or reservation kind.",
    });
}

/**
 * The server could not sign or seal a replacement Pay state. Unlike a
 * `PayStateTokenError` from opening a caller's token, it never says the
 * caller's token is unusable; a retry may succeed.
 */
export class PayStateIssueError extends Data.TaggedError("PayStateIssueError")<{
  readonly cause: PayStateTokenError;
}> {
  static fromTokenError = (cause: PayStateTokenError) =>
    new PayStateIssueError({ cause });
}

/**
 * A freshly signed Pay state: its sealed token, the Pay URL built from that
 * token, and the instant the Pay page stops accepting it. Callers that hand
 * the token to a non-browser client use the same seal as the URL, never a
 * second one.
 */
export type IssuedPayState = {
  readonly payStateToken: string;
  readonly payUrl: string;
  readonly expiresAt: string;
};

/**
 * A replacement Pay state as a checkout result carries it: the Pay URL with
 * the sealed token and expiry behind it, all from one seal.
 */
export type FreshPayState = {
  readonly freshPayUrl: string;
  readonly freshPayStateToken: string;
  readonly expiresAt: string;
};

/** A checkout result without a replacement Pay state. */
export type NoFreshPayState = {
  readonly freshPayUrl?: undefined;
  readonly freshPayStateToken?: undefined;
  readonly expiresAt?: undefined;
};

export const toFreshPayState = (issued: IssuedPayState): FreshPayState => ({
  freshPayUrl: issued.payUrl,
  freshPayStateToken: issued.payStateToken,
  expiresAt: issued.expiresAt,
});

export const buildSignedPayState = Effect.fn("payState.build")(function* (
  input: BuildSignedPayStateInput,
  options: SealedStateIssueOptions = {}
) {
  const claims = yield* payStateCodec
    .issueClaims({
      issuedAt: options.issuedAt,
      ttlMilliseconds: input.ttlMilliseconds,
    })
    .pipe(Effect.mapError(PayStateTokenError.fromSealedState));
  const state = {
    ...buildSignedPayStateEnvelope(
      {
        ...claims,
        locale: input.locale,
        orderId: input.orderId,
        bookedAt: input.bookedAt,
        holdExpiresAt: input.holdExpiresAt,
      },
      input,
      input.quote.payment.expectedPrice
    ),
    reservation: input.reservation,
    quote: input.quote,
  };

  return yield* Schema.decodeUnknownEffect(signedPayStateSchema, {
    onExcessProperty: "error",
  })(state).pipe(
    Effect.map(
      (decoded): PayStateWithHoldExpiry => ({
        ...preserveSignedPayStateMetadataInvariant(decoded),
        holdExpiresAt: input.holdExpiresAt,
      })
    ),
    Effect.mapError(PayStateTokenError.invalidState)
  );
});

export const sealPayState = Effect.fn("payState.seal")(
  (state: SignedPayState, options: SealedStateSealOptions = {}) =>
    payStateCodec
      .seal(state, options)
      .pipe(Effect.mapError(PayStateTokenError.fromSealedState))
);

/**
 * The page a Pay state continues on: the page's locale and, on a reservation
 * page, its reservation kind. The Pay page accepts every kind.
 */
export type PayStatePage = {
  readonly locale: string;
  readonly reservationKind?: SignedPayState["reservation"]["kind"];
};

/**
 * Whether an opened Pay state continues on a page: it was issued for the
 * page's locale and, on a reservation page, for that page's reservation kind.
 * The pages and the proxy share this check through `open`, so a URL keeps
 * its issued locale exactly when its page will accept it.
 */
const continuesOn = (
  state: Pick<SignedPayState, "locale" | "reservation">,
  page: PayStatePage
): boolean =>
  state.locale === page.locale &&
  (page.reservationKind === undefined ||
    state.reservation.kind === page.reservationKind);

const open = Effect.fn("payState.open")(function* (
  token: string,
  page?: PayStatePage
) {
  const state = yield* payStateCodec
    .open(token)
    .pipe(
      Effect.map(preserveSignedPayStateMetadataInvariant),
      Effect.mapError(PayStateTokenError.fromSealedState)
    );
  if (page !== undefined && !continuesOn(state, page)) {
    return yield* PayStateTokenError.forAnotherPage();
  }
  return state;
});

const getRestartKind = Effect.fn("payState.getRestartKind")((token: string) =>
  payStateCodec.inspect(token).pipe(
    Effect.map((state) => state.reservation.kind),
    Effect.mapError(PayStateTokenError.fromSealedState)
  )
);

const issueLink = Effect.fnUntraced(function* (
  fresh: BuildSignedPayStateInput,
  link: SealedStateIssueOptions & SealedStateSealOptions,
  path: CheckoutPayPathOptions
) {
  const state = yield* buildSignedPayState(fresh, link);
  const token = yield* sealPayState(state, link);
  const issued: IssuedPayState = {
    payStateToken: token,
    payUrl: buildCheckoutPayPath(fresh.locale, token, path),
    expiresAt: getPayStateExpiresAt(state),
  };
  return issued;
});

const issue = Effect.fn("payState.issue")(
  (
    fresh: BuildSignedPayStateInput,
    options: {
      /**
       * Issues the state as of this instant and seals it with a synthetic
       * IV, so issuing equal state again returns a byte-identical link.
       * Agents' holds anchor their link at the booking instant.
       */
      readonly stableAt?: Temporal.Instant;
    } = {}
  ) =>
    issueLink(
      fresh,
      options.stableAt === undefined
        ? {}
        : { issuedAt: options.stableAt, deterministic: true },
      { orderId: fresh.orderId }
    )
);

/**
 * What happened to an open Pay state that makes the checkout continue with a
 * replacement. Each outcome decides which signed fields carry forward.
 */
export type PayStateReissue =
  /** Submission found the price review still pending and re-signs it. */
  | { readonly kind: "review_pending" }
  /** The customer accepted the price change the state asked them to review. */
  | { readonly kind: "reviewed" }
  /** The payable price changed; the customer reviews the re-priced order. */
  | {
      readonly kind: "repriced";
      readonly verdict: Extract<
        PriceVerdict<SignedPayStatePricing>,
        { readonly status: "pricing_changed" }
      >;
    }
  /** An ordinary discount code was priced into the order. */
  | {
      readonly kind: "code_entered";
      readonly code: CanonicalPromotionCode;
      readonly verdict: PriceVerdict<
        SignedPayStatePricing & {
          readonly submittedCodeDiscountId: DiscountId;
        },
        SignedPayStatePricing
      >;
    }
  /** A code was refused; it stays in the box as requested intent. */
  | {
      readonly kind: "code_rejected";
      readonly code: CanonicalPromotionCode;
      readonly rejection: DiscountCodeRejection;
    }
  /** A referral was priced into the order under the referral's own rule. */
  | {
      readonly kind: "referral_applied";
      readonly referralCode: CanonicalPromotionCode | undefined;
      readonly verdict: PriceVerdict<SignedPayStatePricing>;
    }
  /**
   * The entered code was removed and the order re-priced without it; a
   * changed price asks the customer to review it.
   */
  | {
      readonly kind: "code_cleared";
      readonly verdict: PriceVerdict<SignedPayStatePricing>;
    }
  /** A requested code that was never applied was dropped without repricing. */
  | { readonly kind: "requested_code_cleared" };

/** The replacement's signed fields and Pay URL options for one outcome. */
const getContinuation = (
  state: PayStateWithHoldExpiry,
  outcome: PayStateReissue
): {
  readonly fresh: BuildSignedPayStateInput;
  readonly path: CheckoutPayPathOptions;
} => {
  const order = {
    locale: state.locale,
    orderId: state.orderId,
    bookedAt: state.bookedAt,
    holdExpiresAt: state.holdExpiresAt,
    // Its checkout session, or its order for a payment retry.
    ...getPayStateBindingInput(state),
  };
  // Code entry answers on the order's own Pay page.
  const orderPage = { orderId: state.orderId };
  return Match.value(outcome).pipe(
    Match.discriminatorsExhaustive("kind")({
      review_pending: () => ({
        fresh: {
          ...state,
          requestedDiscountCode:
            state.requestedDiscountCode ?? state.submittedCode,
        },
        path: {},
      }),
      reviewed: () => ({
        fresh: { ...state, changedKeys: undefined },
        path: {},
      }),
      repriced: ({ verdict }) => ({
        fresh: {
          ...verdict.priced,
          ...order,
          referralCode: state.referralCode,
          requestedDiscountCode:
            state.requestedDiscountCode ?? state.submittedCode,
          ...getSubmittedCodeStillApplied(state, verdict.priced),
          changedKeys: verdict.changedKeys,
        },
        path: {},
      }),
      code_entered: ({ code, verdict }) =>
        Match.value(verdict).pipe(
          Match.discriminatorsExhaustive("status")({
            affirmed: ({ priced }) => ({
              fresh: {
                ...priced,
                ...order,
                submittedCode: code,
                submittedCodeDiscountId: priced.submittedCodeDiscountId,
                requestedDiscountCode: code,
                referralCode: state.referralCode,
              },
              path: orderPage,
            }),
            pricing_changed: ({ priced, changedKeys }) => ({
              fresh: {
                ...priced,
                ...order,
                changedKeys,
                requestedDiscountCode: code,
                referralCode: state.referralCode,
              },
              path: orderPage,
            }),
          })
        ),
      code_rejected: ({ code, rejection }) => ({
        fresh: { ...state, requestedDiscountCode: code },
        path: {
          ...orderPage,
          discountCodeError: rejection,
          discountCodeErrorId: randomUUID(),
        },
      }),
      // Deliberately drops `requestedDiscountCode`, unlike the other
      // outcomes. The customer enters a referral through the same
      // discount-code field (`lookupCodeKind` routes it here), and
      // `requestedDiscountCode` only seeds that field's default and marks an
      // intended code the customer can remove. Carrying it would refill the
      // field with a code the customer has moved past and leave a stale
      // removable intended code.
      referral_applied: ({ referralCode, verdict }) => ({
        fresh: {
          ...verdict.priced,
          ...order,
          referralCode,
          ...getSubmittedCodeStillApplied(state, verdict.priced),
          changedKeys: getPriceVerdictChangedKeys(verdict),
        },
        path: orderPage,
      }),
      code_cleared: ({ verdict }) => ({
        fresh: {
          ...verdict.priced,
          ...order,
          referralCode: state.referralCode,
          changedKeys: getPriceVerdictChangedKeys(verdict),
        },
        path: orderPage,
      }),
      requested_code_cleared: () => ({
        fresh: { ...state, requestedDiscountCode: undefined },
        path: orderPage,
      }),
    })
  );
};

const reissue = Effect.fn("payState.reissue")(
  (state: PayStateWithHoldExpiry, outcome: PayStateReissue) => {
    const { fresh, path } = getContinuation(state, outcome);
    return issueLink(fresh, {}, path);
  },
  Effect.mapError(PayStateIssueError.fromTokenError)
);

/**
 * The signed checkout continuation: a sealed Pay state that carries an order,
 * its accepted price and its codes between the Pay page, code entry,
 * referrals and payment. Tokens keep the sealed state format that predates
 * purposes, so open Pay pages and agents' stable links keep working.
 */
export const PayState = {
  /**
   * Opens an authentic, unexpired token. Given a page, the state must also
   * continue on it (`continuesOn`), or it fails as an invalid token.
   */
  open,
  /**
   * The reservation kind of an authenticated Pay state, expired or not, so an
   * expired Pay page can restart its reservation. Nothing else may act on
   * state read this way.
   */
  restartKind: getRestartKind,
  /**
   * Signs and seals a new order's first Pay state; its Pay URL names the
   * order. Sealing failures stay `PayStateTokenError`s.
   */
  issue,
  /**
   * Replaces an open Pay state after an outcome, carrying forward the fields
   * that outcome keeps and always the hold deadline. Sealing failures are
   * `PayStateIssueError`s.
   */
  reissue,
  summary: getSignedPayStateCheckoutSummary,
  bookedAt: getSignedPayStateBookedAt,
  submittedCodeApplication: getSignedPayStateSubmittedCodeApplication,
  expiresAt: getPayStateExpiresAt,
};
