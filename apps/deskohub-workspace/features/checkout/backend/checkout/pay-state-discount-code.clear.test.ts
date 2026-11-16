import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type { GoogleCalendarEvent } from "@deskohub/google-calendar";
import { testEmailAddress } from "@deskohub/test-email";
import { type Duration, Effect, Layer, Schema } from "effect";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { CheckoutPricingServiceMock } from "@/features/checkout/backend/checkout/checkout-pricing.service.mock";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import type { CheckoutSummaryChangedKeys } from "@/features/checkout/checkout-summary";
import {
  DiscountAffirmationUnavailableError,
  DiscountProviderError,
  discountIdSchema,
  PromotionCodeUnavailableError,
} from "@/features/discounts";
import { calendarSaleDiscountServiceLayer } from "@/features/discounts/calendar-sale.test-utils";
import {
  type CanonicalPromotionCode,
  canonicalPromotionCodeSchema,
} from "@/features/discounts/contracts";
import type { Locale } from "@/features/i18n";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { getSlowestSuccessfulCalendarLoad } from "@/shared/backend/config/google-calendar.config.test-utils";
import {
  withActionDeadline,
  workspaceActionDeadline,
} from "@/shared/backend/workspace-action";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";
import { instantStringSchema } from "@/shared/utils/temporal";
import {
  CheckoutUnavailableError,
  type CheckoutUnavailableReason,
} from "./checkout-unavailable";
import {
  buildSignedPayState,
  PayState,
  PayStateTokenError,
  type SignedPayState,
  sealPayState,
} from "./pay-state";
import {
  type ClearDiscountCodeResult,
  clearDiscountCodeFromPayState,
  getDiscountCodeChangeDeadline,
} from "./pay-state-discount-code";
import { PayableCheckoutMock } from "./payable-checkout.service.mock";
import { withoutPayStateHoldExpiry } from "./signed-pay-state.test-utils";

mock.module("server-only", () => ({}));

const payStateBookedAt = instantStringSchema.make("2026-06-01T09:58:00.000Z");
const payStateHoldExpiresAt = instantStringSchema.make(
  "2099-06-01T10:08:00.000Z"
);
/** The deadline stored with the order, for tokens signed without one. */
const storedHoldExpiresAt = Temporal.Instant.from("2099-06-01T10:09:30Z");

const reservation = {
  kind: "cowork" as const,
  entryTier: "basic" as const,
  coffee: false,
  date: "2026-08-04",
  name: "Ada Lovelace",
  email: testEmailAddress("ada"),
  phone: "+420777000111",
};
const checkoutSessionId = "checkout-session-id";
const code = (value: string) => canonicalPromotionCodeSchema.make(value);
const submittedCodeDiscountId =
  Schema.decodeUnknownSync(discountIdSchema)("code-discount");
const referralCode = code("RFL12345");

const money = (value: number) => ({
  value,
  exponent: 2,
  currency: "CZK" as const,
});

/** The order's price with the entered code: 20% off 350 CZK. */
const codeQuote = buildCoworkReservationQuote(reservation, {
  discountQuote: {
    product: { kind: "cowork", tier: "basic" },
    discountableSubtotal: money(35_000),
    discounts: [
      {
        discount: {
          id: submittedCodeDiscountId,
          label: "Member code",
          adjustment: { kind: "percentage", basisPoints: 2000 },
        },
        subtotalBefore: money(35_000),
        amount: money(7000),
        subtotalAfter: money(28_000),
      },
    ],
    totalDiscount: money(7000),
    discountedSubtotal: money(28_000),
  },
});
/** The order's price once the code is removed. */
const clearedQuote = buildCoworkReservationQuote(reservation);
const clearedKeys: CheckoutSummaryChangedKeys = {
  sectionKeys: ["order", "total"],
  itemKeys: ["product:cowork:basic", "total:final"],
};

const makePayStateToken = async (input?: {
  readonly locale?: Locale;
  /** A code the signed state applied, with the code's quote. */
  readonly submittedCode?: CanonicalPromotionCode;
  readonly requestedDiscountCode?: CanonicalPromotionCode;
  readonly referralCode?: CanonicalPromotionCode;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
  readonly issuedAt?: Temporal.Instant;
  /** Seals it as a token issued before Pay states signed the hold deadline. */
  readonly withoutHoldExpiry?: true;
}) => {
  const state = await Effect.runPromise(
    buildSignedPayState(
      {
        locale: input?.locale ?? "en-US",
        reservation,
        quote: input?.submittedCode ? codeQuote : clearedQuote,
        orderId: "reservation-id",
        bookedAt: payStateBookedAt,
        holdExpiresAt: payStateHoldExpiresAt,
        checkoutSessionId,
        requestedDiscountCode: input?.requestedDiscountCode,
        referralCode: input?.referralCode,
        changedKeys: input?.changedKeys,
        ...(input?.submittedCode && {
          submittedCode: input.submittedCode,
          submittedCodeDiscountId,
        }),
      },
      { issuedAt: input?.issuedAt }
    ).pipe(Effect.provide(TestSealedStateKeys))
  );
  return await Effect.runPromise(
    sealPayState(
      input?.withoutHoldExpiry ? withoutPayStateHoldExpiry(state) : state
    ).pipe(Effect.provide(TestSealedStateKeys))
  );
};

/** A token with an applied code, as entering one signs it. */
const makeAppliedCodeToken = (
  input?: Omit<
    NonNullable<Parameters<typeof makePayStateToken>[0]>,
    "submittedCode" | "requestedDiscountCode"
  >
) =>
  makePayStateToken({
    ...input,
    submittedCode: code("SAVE20"),
    requestedDiscountCode: code("SAVE20"),
  });

type ClearInput = {
  readonly payStateToken: string;
  /** Replaces the pricing stub, for example with real pricing. */
  readonly pricing?: Layer.Layer<CheckoutPricingService>;
  /** How long each live payable-checkout guard takes. */
  readonly confirmDuration?: Duration.Input;
  readonly locale?: Locale;
  /** Replaces the pricing stub's `clearDiscountCode`. */
  readonly clearDiscountCode?: ReturnType<typeof mock>;
  readonly activePaymentAttemptId?: string;
  readonly activePaymentAttemptIdAfterPricing?: string;
  /** The live guard read that finds the reservation unpayable, and why. */
  readonly checkoutUnavailable?: {
    readonly at: 1 | 2;
    readonly reason: CheckoutUnavailableReason;
  };
};

const prepareClear = (input: ClearInput) => {
  let guardReads = 0;
  const readGuard = (state: SignedPayState) => {
    guardReads += 1;
    if (input.checkoutUnavailable?.at === guardReads) {
      return Effect.fail(
        new CheckoutUnavailableError({
          orderId: state.orderId,
          reason: input.checkoutUnavailable.reason,
          restartKind: state.reservation.kind,
        })
      );
    }
    const activePaymentAttemptId =
      guardReads > 1
        ? (input.activePaymentAttemptIdAfterPricing ??
          input.activePaymentAttemptId ??
          null)
        : (input.activePaymentAttemptId ?? null);
    return Effect.succeed({
      id: "reservation-id",
      dotyposCustomerId: "customer-id",
      reservationHoldExpiresAt: storedHoldExpiresAt,
      activePaymentAttemptId,
      // Admitting an attempt makes the order's payment pending.
      paymentState: activePaymentAttemptId === null ? "not_started" : "pending",
    } as never);
  };
  const confirm = mock((state: SignedPayState) =>
    Effect.sleep(input.confirmDuration ?? 0).pipe(
      Effect.andThen(() => readGuard(state))
    )
  );
  const clearDiscountCode =
    input.clearDiscountCode ??
    mock(() =>
      Effect.succeed({
        kind: "cowork" as const,
        reservation,
        quote: clearedQuote,
        changedKeys: clearedKeys,
      })
    );
  const findById = mock(() => Effect.die("must not read the reservation"));

  const effect = clearDiscountCodeFromPayState({
    locale: input.locale ?? "en-US",
    payStateToken: input.payStateToken,
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        input.pricing ?? CheckoutPricingServiceMock({ clearDiscountCode }),
        PayableCheckoutMock(confirm).pipe(Layer.provide(TestSealedStateKeys)),
        Layer.mock(WorkspaceReservationRepository, { findById }),
        TestSealedStateKeys
      )
    )
  );
  return { effect, confirm, clearDiscountCode, findById };
};

const runClear = async (input: ClearInput) => {
  const { effect, ...scenario } = prepareClear(input);
  return { ...scenario, exit: await Effect.runPromise(Effect.exit(effect)) };
};

/** Runs a removal under an action deadline on an instant test clock. */
const runClearWithinDeadline = (deadline: Duration.Input, input: ClearInput) =>
  prepareClear(input).effect.pipe(
    withActionDeadline(deadline),
    Effect.exit,
    withInstantSleeps,
    Effect.runPromise
  );

const clearSucceeds = async (input: ClearInput) => {
  const { exit, ...scenario } = await runClear(input);
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  return { ...scenario, result: exit.value };
};

const open = (token: string) =>
  Effect.runPromise(
    PayState.open(token).pipe(Effect.provide(TestSealedStateKeys))
  );

const openFresh = (result: ClearDiscountCodeResult) => {
  if (result.freshPayStateToken === undefined) {
    throw new Error(`Expected a replacement Pay state, got ${result.status}`);
  }
  return open(result.freshPayStateToken);
};

describe("clearDiscountCodeFromPayState", () => {
  describe.each([
    // A slow successful Calendar retry between live guards that are slow but
    // well within the Dotypos timeout; together they just outlast the
    // ordinary 45-second deadline.
    ["production", "18 seconds"],
    ["preview", "8 seconds"],
  ] as const)(
    "in %s, with a Calendar load that succeeds on its retry",
    (deploymentEnvironment, liveGuardDuration) => {
      const removal = async () => {
        const listEvents = mock((saleEvents: readonly GoogleCalendarEvent[]) =>
          Effect.sleep(
            getSlowestSuccessfulCalendarLoad(deploymentEnvironment)
          ).pipe(Effect.as(saleEvents))
        );
        return {
          listEvents,
          input: {
            payStateToken: await makeAppliedCodeToken(),
            confirmDuration: liveGuardDuration,
            pricing: CheckoutPricingService.Default.pipe(
              Layer.provide(
                calendarSaleDiscountServiceLayer({
                  calendarId: `clear-code-deadline-${deploymentEnvironment}`,
                  firstDay: Temporal.PlainDate.from("2026-05-01"),
                  lastDay: Temporal.PlainDate.from("2026-09-30"),
                  labels: { "en-US": "Summer sale", "cs-CZ": "Letní sleva" },
                  products: [{ kind: "cowork" }],
                  listEvents,
                })
              )
            ),
          } satisfies ClearInput,
        };
      };

      test("completes the removal within the discount-code change deadline", async () => {
        const { input, listEvents } = await removal();

        const exit = await runClearWithinDeadline(
          getDiscountCodeChangeDeadline(deploymentEnvironment),
          input
        );

        expect(listEvents).toHaveBeenCalledTimes(1);
        expect(exit._tag).toBe("Success");
      });

      test("would be interrupted under the ordinary action deadline", async () => {
        const exit = await runClearWithinDeadline(
          workspaceActionDeadline,
          (await removal()).input
        );

        expect(exit).toMatchObject({
          _tag: "Failure",
          cause: {
            reasons: [{ error: { _tag: "WorkspaceActionTimeout" } }],
          },
        });
      });
    }
  );

  describe("an applied code", () => {
    test("signs the price without it for review, dropping the intended code too", async () => {
      const payStateToken = await makeAppliedCodeToken();

      const { result, clearDiscountCode } = await clearSucceeds({
        payStateToken,
      });
      const fresh = await openFresh(result);

      expect(result.status).toBe("cleared");
      expect(clearDiscountCode).toHaveBeenCalledTimes(1);
      expect(clearDiscountCode).toHaveBeenCalledWith(
        expect.objectContaining({
          reservation: expect.objectContaining(reservation),
          quote: codeQuote,
          locale: "en-US",
          dotyposCustomerId: "customer-id",
          submittedCodeDiscountId,
          bookedAt: Temporal.Instant.from(payStateBookedAt),
        })
      );
      expect(fresh).toMatchObject({
        orderId: "reservation-id",
        bookedAt: payStateBookedAt,
        checkoutSessionId,
        quote: clearedQuote,
        changedKeys: clearedKeys,
        acceptedTotal: clearedQuote.payment.expectedPrice,
      });
      expect(fresh.submittedCode).toBeUndefined();
      expect(fresh.submittedCodeDiscountId).toBeUndefined();
      expect(fresh.requestedDiscountCode).toBeUndefined();
    });

    test("keeps the referral benefit", async () => {
      const payStateToken = await makeAppliedCodeToken({ referralCode });

      const { result, clearDiscountCode } = await clearSucceeds({
        payStateToken,
      });

      expect(clearDiscountCode).toHaveBeenCalledWith(
        expect.objectContaining({ referralCode })
      );
      expect((await openFresh(result)).referralCode).toBe(referralCode);
    });

    test("signs no review when removing the code changes no summary key", async () => {
      const payStateToken = await makeAppliedCodeToken();

      const { result } = await clearSucceeds({
        payStateToken,
        clearDiscountCode: mock(() =>
          Effect.succeed({
            kind: "cowork" as const,
            reservation,
            quote: clearedQuote,
            changedKeys: { sectionKeys: [], itemKeys: [] },
          })
        ),
      });
      const fresh = await openFresh(result);

      expect(result.status).toBe("cleared");
      expect(result.freshPayStateToken).not.toBe(payStateToken);
      expect(fresh.changedKeys).toBeUndefined();
      expect(fresh.submittedCode).toBeUndefined();
    });

    test("is refused while a price review is pending", async () => {
      const payStateToken = await makeAppliedCodeToken({
        changedKeys: clearedKeys,
      });

      const { result, confirm, clearDiscountCode } = await clearSucceeds({
        payStateToken,
      });

      expect(result).toStrictEqual({
        status: "unavailable",
        reason: "price_review_pending",
        freshPayUrl: undefined,
      });
      expect(confirm).not.toHaveBeenCalled();
      expect(clearDiscountCode).not.toHaveBeenCalled();
    });

    test.each([
      [
        "a kept discount can't be affirmed",
        new DiscountAffirmationUnavailableError({
          message: "Calendar was unavailable.",
          discountIds: [submittedCodeDiscountId],
        }),
      ],
      [
        "the discounts answer with a code verdict",
        new PromotionCodeUnavailableError({
          reason: "unknown_code",
          message: "The submitted promotion code does not exist.",
        }),
      ],
      [
        "a discount provider is down",
        new DiscountProviderError({
          reason: "provider_failure",
          message: "Dotypos was unavailable.",
        }),
      ],
    ])("keeps the existing state for a retry when %s", async (_case, error) => {
      const payStateToken = await makeAppliedCodeToken();

      const { result } = await clearSucceeds({
        payStateToken,
        clearDiscountCode: mock(() => Effect.fail(error)),
      });

      expect(result).toStrictEqual({
        status: "unavailable",
        reason: "provider",
        freshPayUrl: undefined,
      });
    });
  });

  describe("live guards", () => {
    test.each([1, 2] as const)(
      "refuses a hold that expired by guard read %d",
      async (at) => {
        const payStateToken = await makeAppliedCodeToken();

        const { result, clearDiscountCode } = await clearSucceeds({
          payStateToken,
          checkoutUnavailable: { at, reason: "expired" },
        });

        expect(result).toStrictEqual({
          status: "unavailable",
          reason: "checkout",
          checkoutReason: "expired",
          freshPayUrl: undefined,
        });
        expect(clearDiscountCode).toHaveBeenCalledTimes(at - 1);
      }
    );

    test("does not reprice once a payment attempt is active", async () => {
      const payStateToken = await makeAppliedCodeToken();

      const { result, clearDiscountCode } = await clearSucceeds({
        payStateToken,
        activePaymentAttemptId: "attempt-id",
      });

      expect(result).toStrictEqual({
        status: "unavailable",
        reason: "checkout",
        checkoutReason: "payment_in_progress",
        freshPayUrl: undefined,
      });
      expect(clearDiscountCode).not.toHaveBeenCalled();
    });

    test("discards the new price when a payment starts during repricing", async () => {
      const payStateToken = await makeAppliedCodeToken();

      const { result, confirm, clearDiscountCode } = await clearSucceeds({
        payStateToken,
        activePaymentAttemptIdAfterPricing: "attempt-id",
      });

      expect(result).toMatchObject({
        status: "unavailable",
        reason: "checkout",
        checkoutReason: "payment_in_progress",
      });
      expect(clearDiscountCode).toHaveBeenCalledTimes(1);
      expect(confirm).toHaveBeenCalledTimes(2);
    });

    test("fails a pay state signed for another language without reading the reservation", async () => {
      const payStateToken = await makeAppliedCodeToken({ locale: "cs-CZ" });

      const { exit, confirm } = await runClear({ payStateToken });

      expect(exit).toMatchObject({
        _tag: "Failure",
        cause: { reasons: [{ error: { code: "invalid-token" } }] },
      });
      if (exit._tag === "Failure") {
        expect(
          exit.cause.reasons.some(
            (reason) =>
              reason._tag === "Fail" &&
              reason.error instanceof PayStateTokenError
          )
        ).toBe(true);
      }
      expect(confirm).not.toHaveBeenCalled();
    });
  });

  describe("hold deadline", () => {
    test("keeps it while the token expiry moves", async () => {
      const issuedAt = Temporal.Now.instant().subtract({ minutes: 3 });
      const payStateToken = await makeAppliedCodeToken({ issuedAt });
      const signed = await open(payStateToken);

      const { result } = await clearSucceeds({ payStateToken });
      const fresh = await openFresh(result);

      expect(fresh.exp).toBeGreaterThan(signed.exp);
      expect(fresh.holdExpiresAt).toBe(payStateHoldExpiresAt);
    });

    test.each([
      ["an applied code", makeAppliedCodeToken],
      [
        "an intended code",
        (input: { readonly withoutHoldExpiry: true }) =>
          makePayStateToken({
            ...input,
            requestedDiscountCode: code("SAVE20"),
          }),
      ],
    ])(
      "signs the stored deadline when clearing %s on a token issued without one",
      async (_case, makeToken) => {
        const payStateToken = await makeToken({ withoutHoldExpiry: true });

        const { result } = await clearSucceeds({ payStateToken });

        expect((await openFresh(result)).holdExpiresAt).toBe(
          "2099-06-01T10:09:30.000Z"
        );
      }
    );
  });

  describe("an intended code that was never applied", () => {
    test("is dropped without repricing", async () => {
      const issuedAt = Temporal.Now.instant().subtract({ minutes: 3 });
      const payStateToken = await makePayStateToken({
        requestedDiscountCode: code("SAVE20"),
        referralCode,
        issuedAt,
      });
      const signed = await open(payStateToken);

      const { result, confirm, clearDiscountCode } = await clearSucceeds({
        payStateToken,
      });
      const fresh = await openFresh(result);

      expect(result.status).toBe("cleared");
      expect(clearDiscountCode).not.toHaveBeenCalled();
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(fresh.requestedDiscountCode).toBeUndefined();
      expect(fresh.changedKeys).toBeUndefined();
      expect(fresh).toMatchObject({
        quote: signed.quote,
        acceptedTotal: signed.acceptedTotal,
        referralCode,
        holdExpiresAt: payStateHoldExpiresAt,
      });
      expect(fresh.exp).toBeGreaterThan(signed.exp);
    });

    test("is refused while a price review is pending", async () => {
      const payStateToken = await makePayStateToken({
        requestedDiscountCode: code("SAVE20"),
        changedKeys: clearedKeys,
      });

      const { result, confirm, clearDiscountCode } = await clearSucceeds({
        payStateToken,
      });

      expect(result).toStrictEqual({
        status: "unavailable",
        reason: "price_review_pending",
        freshPayUrl: undefined,
      });
      expect(confirm).not.toHaveBeenCalled();
      expect(clearDiscountCode).not.toHaveBeenCalled();
    });

    test("is kept while a payment is in progress", async () => {
      const payStateToken = await makePayStateToken({
        requestedDiscountCode: code("SAVE20"),
      });

      const { result } = await clearSucceeds({
        payStateToken,
        activePaymentAttemptId: "attempt-id",
      });

      expect(result).toMatchObject({
        status: "unavailable",
        reason: "checkout",
        checkoutReason: "payment_in_progress",
        freshPayUrl: undefined,
      });
    });

    test("is kept once the hold expired", async () => {
      const payStateToken = await makePayStateToken({
        requestedDiscountCode: code("SAVE20"),
      });

      const { result } = await clearSucceeds({
        payStateToken,
        checkoutUnavailable: { at: 1, reason: "expired" },
      });

      expect(result).toMatchObject({
        status: "unavailable",
        reason: "checkout",
        checkoutReason: "expired",
      });
    });
  });

  describe("a state without a code", () => {
    test.each([
      ["", {}],
      [" with a pending review", { changedKeys: clearedKeys }],
    ])(
      "returns its own token%s, signing and reading nothing",
      async (_case, payState) => {
        const payStateToken = await makePayStateToken(payState);

        const { result, confirm, clearDiscountCode, findById } =
          await clearSucceeds({ payStateToken });

        expect(result).toMatchObject({
          status: "unchanged",
          freshPayStateToken: payStateToken,
        });
        expect(result.freshPayUrl).toContain(encodeURIComponent(payStateToken));
        expect(confirm).not.toHaveBeenCalled();
        expect(clearDiscountCode).not.toHaveBeenCalled();
        expect(findById).not.toHaveBeenCalled();
      }
    );
  });
});
