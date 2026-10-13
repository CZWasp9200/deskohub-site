import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { dotyposApiTimeoutDefaultMilliseconds } from "@deskohub/dotypos";
import { getGoogleCalendarRequestWorstCaseDuration } from "@deskohub/google-calendar";
import { testEmailAddress } from "@deskohub/test-email";
import { Duration, Effect, Layer, Schema } from "effect";
import { CheckoutPricingServiceMock } from "@/features/checkout/backend/checkout/checkout-pricing.service.mock";
import {
  buildSignedPayState,
  openPayState,
  payStateTokenQueryParam,
  sealPayState,
} from "@/features/checkout/backend/checkout/pay-state";
import { PayableReservationUnavailableError } from "@/features/checkout/backend/checkout/payable-reservation.service";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import {
  DiscountAffirmationUnavailableError,
  discountIdSchema,
  PromotionCodeUnavailableError,
} from "@/features/discounts";
import { getGoogleCalendarRequestTimeout } from "@/shared/backend/config/google-calendar.config";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";
import { instantStringSchema } from "@/shared/utils/temporal";
import { getApplyDiscountCodeDeadline } from "./apply-discount-code-deadline";

mock.module("server-only", () => ({}));

const payStateBookedAt = instantStringSchema.make("2026-06-01T09:58:00.000Z");

const reservation = {
  kind: "cowork" as const,
  entryTier: "basic" as const,
  coffee: false,
  date: "2026-08-04",
  name: "Ada Lovelace",
  email: testEmailAddress("ada"),
  phone: "+420777000111",
};
const quote = buildCoworkReservationQuote(reservation);
const checkoutSessionId = "checkout-session-id";
const submittedCodeDiscountId =
  Schema.decodeUnknownSync(discountIdSchema)("code-discount");

const makePayStateToken = async (input?: {
  readonly requestedDiscountCode?: CanonicalPromotionCode;
}) => {
  const state = await Effect.runPromise(
    buildSignedPayState({
      locale: "en-US",
      reservation,
      quote,
      orderId: "reservation-id",
      bookedAt: payStateBookedAt,
      checkoutSessionId,
      requestedDiscountCode: input?.requestedDiscountCode,
    })
  );

  return await Effect.runPromise(sealPayState(state));
};

type SubmissionInput = {
  readonly submittedCode?: string;
  readonly applyDiscountCode?: ReturnType<typeof mock>;
  readonly activePaymentAttemptId?: string;
  readonly activePaymentAttemptIdAfterPricing?: string;
  readonly payableReservationUnavailableAt?: 1 | 2;
  readonly requestedDiscountCode?: CanonicalPromotionCode;
  /** How long each live payable-reservation guard takes. */
  readonly requireCurrentDuration?: Duration.Input;
};

const prepareSubmission = async (input?: SubmissionInput) => {
  const [
    { applyDiscountCodeToPayState },
    { PayableReservationService },
    { BotProtectionServiceMock },
  ] = await Promise.all([
    import("./apply-discount-code-to-pay-state"),
    import("@/features/checkout/backend/checkout/payable-reservation.service"),
    import("@/shared/backend/bot-protection/bot-protection.service.mock"),
  ]);
  const verifyHuman = mock(() => Effect.void);
  let payableReservationReadCount = 0;
  const getReservation = () => ({
    id: "reservation-id",
    dotyposCustomerId: "customer-id",
    activePaymentAttemptId:
      payableReservationReadCount > 1
        ? (input?.activePaymentAttemptIdAfterPricing ??
          input?.activePaymentAttemptId ??
          null)
        : (input?.activePaymentAttemptId ?? null),
  });
  const requireCurrent = mock(() =>
    Effect.sleep(input?.requireCurrentDuration ?? 0).pipe(
      Effect.andThen(() => {
        payableReservationReadCount += 1;
        return input?.payableReservationUnavailableAt ===
          payableReservationReadCount
          ? Effect.fail(
              new PayableReservationUnavailableError({
                orderId: "reservation-id",
                reason: "not_current",
              })
            )
          : Effect.succeed(getReservation() as never);
      })
    )
  );
  const applyDiscountCode =
    input?.applyDiscountCode ??
    mock(() =>
      Effect.succeed({
        kind: "cowork" as const,
        reservation,
        status: "applied" as const,
        submittedCodeDiscountId,
        quote,
      })
    );
  const payStateToken = await makePayStateToken({
    requestedDiscountCode: input?.requestedDiscountCode,
  });
  const effect = applyDiscountCodeToPayState({
    locale: "en-US",
    payStateToken,
    submittedCode: input?.submittedCode ?? " save20 ",
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        BotProtectionServiceMock({ verifyHuman }),
        CheckoutPricingServiceMock({ applyDiscountCode }),
        Layer.succeed(PayableReservationService, { requireCurrent })
      )
    )
  );

  return {
    applyDiscountCode,
    effect,
    requireCurrent,
    payStateToken,
    verifyHuman,
  };
};

const runSubmission = async (input?: SubmissionInput) => {
  const { effect, ...submission } = await prepareSubmission(input);
  return { ...submission, result: await Effect.runPromise(effect) };
};

/** Runs a submission under an action deadline on an instant test clock. */
const runSubmissionWithinDeadline = async (
  deadline: Duration.Input,
  input?: SubmissionInput
) => {
  const { withActionDeadline } = await import(
    "@/shared/backend/workspace-action"
  );
  const { effect } = await prepareSubmission(input);
  return await effect.pipe(
    withActionDeadline(deadline),
    Effect.exit,
    withInstantSleeps,
    Effect.runPromise
  );
};

describe("applyDiscountCodeToPayState", () => {
  test("seals a canonical code privately into a replacement pay state", async () => {
    const scenario = await runSubmission();

    expect(scenario.verifyHuman).toHaveBeenCalledWith({
      verificationFailurePolicy: "deny",
    });
    expect(scenario.applyDiscountCode).toHaveBeenCalledWith(
      expect.objectContaining({
        reservation: expect.objectContaining({
          entryTier: "basic",
          date: reservation.date,
        }),
        dotyposCustomerId: "customer-id",
        locale: "en-US",
        quote,
        submittedCode: "SAVE20",
      })
    );
    expect(scenario.applyDiscountCode).toHaveBeenCalledWith(
      expect.objectContaining({
        bookedAt: Temporal.Instant.from(payStateBookedAt),
      })
    );
    expect(scenario.result.status).toBe("applied");
    if (scenario.result.status !== "applied") {
      throw new Error("Expected applied result");
    }

    const freshUrl = new URL(
      scenario.result.freshPayUrl,
      "https://deskohub.test"
    );
    const freshToken = freshUrl.searchParams.get(payStateTokenQueryParam);
    expect(freshToken).toBeTruthy();
    const freshState = await Effect.runPromise(openPayState(freshToken ?? ""));
    expect(freshState.checkoutSessionId).toBe(checkoutSessionId);
    expect(freshState.submittedCode).toBe("SAVE20");
    expect(freshState.submittedCodeDiscountId).toBe(submittedCodeDiscountId);
    expect(freshState.requestedDiscountCode).toBe("SAVE20");
    expect(freshState.changedKeys).toBeUndefined();
    expect(scenario.result.freshPayUrl).not.toContain("SAVE20");
    expect(JSON.stringify(scenario.result)).not.toContain("SAVE20");
    expect(JSON.stringify(scenario.result)).not.toContain("save20");
  });

  test("returns one unavailable result for invalid syntax without loading checkout state", async () => {
    const scenario = await runSubmission({ submittedCode: "not valid!" });

    expect(scenario.result).toEqual({
      status: "unavailable",
      freshPayUrl: undefined,
    });
    expect(scenario.requireCurrent).not.toHaveBeenCalled();
    expect(scenario.applyDiscountCode).not.toHaveBeenCalled();
  });

  test.each(["", "   "])(
    "returns plain unavailable for empty or whitespace input %j without lookups or pricing",
    async (submittedCode) => {
      const scenario = await runSubmission({ submittedCode });

      expect(scenario.result).toEqual({
        status: "unavailable",
        freshPayUrl: undefined,
      });
      expect(scenario.requireCurrent).not.toHaveBeenCalled();
      expect(scenario.applyDiscountCode).not.toHaveBeenCalled();
    }
  );

  test("maps a specific backend eligibility reason to the generic field result while retaining the attempt", async () => {
    const applyDiscountCode = mock(() =>
      Effect.fail(
        new PromotionCodeUnavailableError({
          reason: "already_redeemed",
          message: "Already redeemed.",
        })
      )
    );
    const scenario = await runSubmission({ applyDiscountCode });

    expect(scenario.result.status).toBe("unavailable");
    expect(applyDiscountCode).toHaveBeenCalledTimes(1);
    if (scenario.result.status !== "unavailable") {
      throw new Error("Expected unavailable result");
    }
    expect(scenario.result.freshPayUrl).toBeTruthy();

    const freshUrl = new URL(
      scenario.result.freshPayUrl ?? "",
      "https://deskohub.test"
    );
    expect(freshUrl.searchParams.get("discountCodeError")).toBe("unavailable");
    const freshToken = freshUrl.searchParams.get(payStateTokenQueryParam);
    const freshState = await Effect.runPromise(openPayState(freshToken ?? ""));
    expect(freshState.orderId).toBe("reservation-id");
    expect(freshState.requestedDiscountCode).toBe("SAVE20");
    expect(freshState.submittedCode).toBeUndefined();
    expect(freshState.submittedCodeDiscountId).toBeUndefined();
    expect(scenario.result.freshPayUrl).not.toContain("SAVE20");
  });

  describe("under the action deadline", () => {
    // Live guards of 8 seconds before and after pricing that succeeds only
    // on its Calendar retry, 29.5 seconds in.
    const slowSuccessfulSubmission = () =>
      ({
        requireCurrentDuration: "8 seconds",
        applyDiscountCode: mock(() =>
          Effect.sleep("29500 millis").pipe(
            Effect.as({
              kind: "cowork" as const,
              reservation,
              status: "applied" as const,
              submittedCodeDiscountId,
              quote,
            })
          )
        ),
      }) satisfies SubmissionInput;

    test("completes slow live guards around a slow successful Calendar retry", async () => {
      const exit = await runSubmissionWithinDeadline(
        getApplyDiscountCodeDeadline({
          calendar: getGoogleCalendarRequestWorstCaseDuration(
            getGoogleCalendarRequestTimeout("preview")
          ),
          dotypos: Duration.millis(dotyposApiTimeoutDefaultMilliseconds),
        }),
        slowSuccessfulSubmission()
      );

      expect(exit).toMatchObject({
        _tag: "Success",
        value: { status: "applied" },
      });
    });

    test("would interrupt the same submission under the generic 45-second deadline", async () => {
      const exit = await runSubmissionWithinDeadline(
        "45 seconds",
        slowSuccessfulSubmission()
      );

      expect(exit).toMatchObject({
        _tag: "Failure",
        cause: {
          reasons: [
            { error: { message: "Request timed out. Please try again." } },
          ],
        },
      });
    });
  });

  test("keeps the existing summary payable when displayed discounts cannot be affirmed", async () => {
    const applyDiscountCode = mock(() =>
      Effect.fail(
        new DiscountAffirmationUnavailableError({
          message: "Calendar was unavailable.",
          discountIds: [submittedCodeDiscountId],
        })
      )
    );
    const scenario = await runSubmission({ applyDiscountCode });

    expect(scenario.result).toEqual({
      status: "unavailable",
      freshPayUrl: undefined,
    });
    expect(applyDiscountCode).toHaveBeenCalledTimes(1);
  });

  test("applies a new code when the signed state only carries a requested code", async () => {
    const scenario = await runSubmission({
      requestedDiscountCode: "CAMPAIGN10",
    });

    expect(scenario.applyDiscountCode).toHaveBeenCalledTimes(1);
    expect(scenario.result.status).toBe("applied");
  });

  test("returns a refreshed pricing_changed state before applying the code", async () => {
    const changedKeys = {
      sectionKeys: ["order", "total"],
      itemKeys: ["product:cowork:basic", "total:final"],
    };
    const applyDiscountCode = mock(() =>
      Effect.succeed({
        kind: "cowork" as const,
        reservation,
        status: "pricing_changed" as const,
        quote,
        changedKeys,
      })
    );
    const scenario = await runSubmission({ applyDiscountCode });

    expect(scenario.result.status).toBe("pricing_changed");
    if (scenario.result.status !== "pricing_changed") {
      throw new Error("Expected pricing_changed result");
    }

    const freshToken = new URL(
      scenario.result.freshPayUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    const freshState = await Effect.runPromise(openPayState(freshToken ?? ""));
    expect(freshState.checkoutSessionId).toBe(checkoutSessionId);
    expect(freshState.changedKeys).toEqual(changedKeys);
    expect(freshState.submittedCode).toBeUndefined();
    expect(freshState.requestedDiscountCode).toBe("SAVE20");
  });

  test("does not reprice after a payment attempt has become active", async () => {
    const scenario = await runSubmission({
      activePaymentAttemptId: "attempt-id",
    });

    expect(scenario.result).toEqual({ status: "unavailable" });
    expect(scenario.applyDiscountCode).not.toHaveBeenCalled();
  });

  test("discards a replacement summary when payment starts during repricing", async () => {
    const scenario = await runSubmission({
      activePaymentAttemptIdAfterPricing: "attempt-id",
    });

    expect(scenario.result).toEqual({ status: "unavailable" });
    expect(scenario.applyDiscountCode).toHaveBeenCalledTimes(1);
    expect(scenario.requireCurrent).toHaveBeenCalledTimes(2);
  });

  test("does not reprice a reservation that is no longer payable", async () => {
    const scenario = await runSubmission({
      payableReservationUnavailableAt: 1,
    });

    expect(scenario.result).toEqual({ status: "unavailable" });
    expect(scenario.applyDiscountCode).not.toHaveBeenCalled();
    expect(scenario.requireCurrent).toHaveBeenCalledTimes(1);
  });

  test("discards repricing when the reservation stops being payable", async () => {
    const scenario = await runSubmission({
      payableReservationUnavailableAt: 2,
    });

    expect(scenario.result).toEqual({ status: "unavailable" });
    expect(scenario.applyDiscountCode).toHaveBeenCalledTimes(1);
    expect(scenario.requireCurrent).toHaveBeenCalledTimes(2);
  });
});
