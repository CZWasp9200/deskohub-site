import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import type { WorkspaceReservationRow } from "@/db/schema";
import {
  type CheckoutSessionKey,
  checkoutSessionIdSchema,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import {
  type PaymentAttempt,
  PaymentAttemptRepository,
} from "../repositories/payment-attempt.repository";
import { deriveCheckoutSessionKeys } from "./checkout-lookup-keys.server";
import {
  CheckoutUnavailableError,
  type CheckoutUnavailableReason,
} from "./checkout-unavailable";
import { PayState, type SignedPayState } from "./pay-state";
import { PayableCheckout } from "./payable-checkout.service";
import {
  sealSyntheticPayStateToken,
  syntheticHoldExpiresAt,
  syntheticPayStateOrderId,
} from "./signed-pay-state.test-utils";

/** Every test runs at this instant, two minutes into a ten-minute token. */
const now = Temporal.Instant.from("2099-07-01T10:00:00Z");
const storedHoldExpiresAt = Temporal.Instant.from(syntheticHoldExpiresAt);

// New rows store one of the session's accepted derivations.
const [checkoutSessionKey] = deriveCheckoutSessionKeys(
  checkoutSessionIdSchema.make("checkout-session-id")
).pipe(Effect.provide(TestSealedStateKeys), Effect.runSync).accepted as [
  CheckoutSessionKey,
];

const retriedAttemptId = paymentAttemptIdSchema.make("retried-attempt-id");

const row = (overrides: Partial<WorkspaceReservationRow> = {}) =>
  ({
    id: syntheticPayStateOrderId,
    checkoutSessionKey,
    checkoutAttemptKey: "checkout-attempt-key",
    dotyposCustomerId: "dotypos-customer-id",
    reservationState: "held",
    paymentState: "not_started",
    fulfillmentState: "not_started",
    dotyposReservationId: "dotypos-reservation-id",
    reservationHoldExpiresAt: storedHoldExpiresAt,
    ...overrides,
  }) as WorkspaceReservationRow;

const issueToken = (input?: Parameters<typeof sealSyntheticPayStateToken>[0]) =>
  sealSyntheticPayStateToken({
    issuedAt: now.subtract({ minutes: 2 }),
    ...input,
  });

const openState = (token: string): Promise<SignedPayState> =>
  TestClock.setTime(now.epochMilliseconds).pipe(
    Effect.andThen(PayState.open(token)),
    Effect.provide(Layer.merge(TestSealedStateKeys, TestClock.layer())),
    Effect.runPromise
  );

/**
 * Runs `use` against a PayableCheckout whose repository holds `stored` as the
 * order and `current` as its session's current reservation, and whose Dotypos
 * reports `dotyposStatus`; `duringDotyposRead` runs inside the remote read.
 */
const runPayableCheckout = <A, E>(
  use: (payableCheckout: PayableCheckout["Service"]) => Effect.Effect<A, E>,
  input: {
    readonly stored?: WorkspaceReservationRow | null;
    /** What the order's row reads as after the first read, if it changes. */
    readonly storedLater?: WorkspaceReservationRow | null;
    readonly current?: WorkspaceReservationRow | null;
    readonly dotyposStatus?: "NEW" | "CANCELLED" | "CONFIRMED";
    readonly duringDotyposRead?: Effect.Effect<void>;
    /** The order's newest payment attempt; the retried one by default. */
    readonly newestAttemptId?: string;
  } = {}
) => {
  const stored = input.stored === undefined ? row() : input.stored;
  const current = input.current === undefined ? stored : input.current;
  let reads = 0;
  const findById = mock(() =>
    Effect.sync(() => {
      reads += 1;
      return reads > 1 && input.storedLater !== undefined
        ? input.storedLater
        : stored;
    })
  );
  const findCurrentByCheckoutSessionKey = mock(() => Effect.succeed(current));
  const getReservationStatus = mock(() =>
    (input.duringDotyposRead ?? Effect.void).pipe(
      Effect.as(input.dotyposStatus ?? "NEW")
    )
  );
  const layer = PayableCheckout.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(WorkspaceReservationRepository, {
          findById,
          findCurrentByCheckoutSessionKey,
        }),
        Layer.mock(DotyposService, { getReservationStatus }),
        Layer.mock(PaymentAttemptRepository, {
          findNewestForReservation: () =>
            Effect.succeed({
              id: input.newestAttemptId ?? retriedAttemptId,
            } as PaymentAttempt),
        }),
        TestSealedStateKeys
      )
    )
  );

  return {
    findById,
    getReservationStatus,
    result: Effect.gen(function* () {
      yield* TestClock.setTime(now.epochMilliseconds);
      return yield* use(yield* PayableCheckout);
    }).pipe(
      Effect.provide(Layer.merge(layer, TestClock.layer())),
      Effect.result,
      Effect.runPromise
    ),
  };
};

const unavailable = (
  reason: CheckoutUnavailableReason,
  paidOrderId?: WorkspaceReservationRow["id"]
) =>
  new CheckoutUnavailableError({
    orderId: syntheticPayStateOrderId,
    reason,
    restartKind: "cowork",
    ...(paidOrderId !== undefined && { paidOrderId }),
  });

describe("PayableCheckout.open", () => {
  test("opens a Pay state for its page while Dotypos still reports the hold NEW", async () => {
    const payStateToken = await issueToken();
    const { getReservationStatus, result } = runPayableCheckout((checkout) =>
      checkout.open({ payStateToken, page: { locale: "en-US" } })
    );

    const opened = await result;
    expect(opened._tag).toBe("Success");
    if (opened._tag !== "Success") return;
    expect(opened.success.state.orderId).toBe(syntheticPayStateOrderId);
    expect(opened.success.state.holdExpiresAt).toBe(syntheticHoldExpiresAt);
    expect(opened.success.reservation).toMatchObject({
      id: syntheticPayStateOrderId,
      dotyposCustomerId: "dotypos-customer-id",
      dotyposReservationId: "dotypos-reservation-id",
      reservationHoldExpiresAt: storedHoldExpiresAt,
    });
    expect(getReservationStatus).toHaveBeenCalledWith("dotypos-reservation-id");
  });

  test("carries the stored hold deadline for a state signed without one", async () => {
    const payStateToken = await issueToken({ withoutHoldExpiry: true });
    const { result } = runPayableCheckout((checkout) =>
      checkout.open({ payStateToken })
    );

    const opened = await result;
    expect(opened._tag).toBe("Success");
    if (opened._tag !== "Success") return;
    expect(opened.success.state.holdExpiresAt).toBe(syntheticHoldExpiresAt);
  });

  test.each([
    {
      name: "an expired Pay state",
      token: () => issueToken({ issuedAt: now.subtract({ minutes: 11 }) }),
      page: { locale: "en-US" },
    },
    {
      name: "a Pay state issued for another locale",
      token: () => issueToken({ locale: "cs-CZ" }),
      page: { locale: "en-US" },
    },
    {
      name: "a Pay state for another reservation page",
      token: () => issueToken(),
      page: { locale: "en-US", reservationKind: "office" as const },
    },
  ])(
    "reads no reservation for $name, even an already paid one",
    async ({ token, page }) => {
      const payStateToken = await token();
      const { findById, getReservationStatus, result } = runPayableCheckout(
        (checkout) => checkout.open({ payStateToken, page }),
        { stored: row({ paymentState: "paid", reservationState: "confirmed" }) }
      );

      const opened = await result;
      expect(opened._tag).toBe("Failure");
      if (opened._tag !== "Failure") return;
      expect(opened.failure._tag).toBe("PayStateTokenError");
      expect(findById).not.toHaveBeenCalled();
      expect(getReservationStatus).not.toHaveBeenCalled();
    }
  );

  test("refuses a Pay state from another checkout session without reading Dotypos", async () => {
    const payStateToken = await issueToken();
    const { getReservationStatus, result } = runPayableCheckout(
      (checkout) => checkout.open({ payStateToken }),
      { stored: row({ checkoutSessionKey: "other-session-key" as never }) }
    );

    const opened = await result;
    expect(opened._tag).toBe("Failure");
    if (opened._tag !== "Failure") return;
    expect(opened.failure).toEqual(unavailable("not_current"));
    expect(getReservationStatus).not.toHaveBeenCalled();
  });
});

describe("PayableCheckout.reconfirm", () => {
  const reconfirm = async (
    input: Parameters<typeof runPayableCheckout>[1] & {
      readonly state?: (state: SignedPayState) => SignedPayState;
    }
  ) => {
    const opened = await openState(await issueToken());
    const state = input.state ? input.state(opened) : opened;
    const run = runPayableCheckout(
      (checkout) => checkout.reconfirm(state),
      input
    );
    return { ...run, result: await run.result };
  };

  /** The state as a payment retry issues it: bound to its order, not a session. */
  const orderBound = (state: SignedPayState): SignedPayState => ({
    ...state,
    checkoutSessionId: undefined,
    binding: "order",
    retriedAttemptId,
  });

  test("confirms an order-bound state's order while it awaits its retry, without a session id", async () => {
    const stored = row({ activePaymentAttemptId: null });
    const { result } = await reconfirm({ state: orderBound, stored });

    expect(result).toMatchObject({
      _tag: "Success",
      success: { reservation: { id: syntheticPayStateOrderId } },
    });
  });

  test.each([
    {
      name: "after the retry's own payment started",
      input: {
        stored: row({
          activePaymentAttemptId: paymentAttemptIdSchema.make("retry-attempt"),
        }),
      },
      reason: "retried_attempt_replaced",
    },
    {
      name: "once a newer order replaced it in its session",
      input: {
        stored: row({ activePaymentAttemptId: null }),
        current: row({
          id: workspaceReservationIdSchema.make("replacement-id"),
        }),
      },
      reason: "not_current",
    },
    {
      name: "once a later retry's attempt became the order's newest",
      input: {
        stored: row({ activePaymentAttemptId: null }),
        newestAttemptId: "later-attempt-id",
      },
      reason: "retried_attempt_replaced",
    },
  ] as const)(
    "refuses an order-bound state $name",
    async ({ input, reason }) => {
      const { result } = await reconfirm({ ...input, state: orderBound });

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: unavailable(reason),
      });
    }
  );

  test.each(["failed", "cancelled", "expired"] as const)(
    "refuses a session state once the order's payment %s, so paying again is a retry",
    async (paymentState) => {
      const { getReservationStatus, result } = await reconfirm({
        stored: row({ paymentState }),
      });

      expect(getReservationStatus).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: unavailable("payment_ended"),
      });
    }
  );

  test.each(["CANCELLED", "CONFIRMED"] as const)(
    "refuses a hold Dotypos reports %s",
    async (dotyposStatus) => {
      const { result } = await reconfirm({ dotyposStatus });

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: unavailable("dotypos_not_pending"),
      });
    }
  );

  test("refuses a hold that runs out while Dotypos is read", async () => {
    const { getReservationStatus, result } = await reconfirm({
      duringDotyposRead: TestClock.adjust("9 minutes"),
    });

    expect(getReservationStatus).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: unavailable("expired"),
    });
  });

  test.each([
    {
      name: "a missing order",
      input: { stored: null },
      reason: "missing_reservation",
    },
    {
      name: "a Pay state without a checkout session",
      input: {
        state: (state: SignedPayState) => ({
          ...state,
          checkoutSessionId: undefined,
        }),
      },
      reason: "missing_checkout_session",
    },
    {
      name: "a superseded reservation",
      input: {
        current: row({
          id: workspaceReservationIdSchema.make("replacement-id"),
        }),
      },
      reason: "not_current",
    },
    {
      name: "a session with no current reservation",
      input: { current: null },
      reason: "not_current",
    },
    {
      name: "a reservation that is no longer held",
      input: { stored: row({ reservationState: "confirming" }) },
      reason: "not_held",
    },
    {
      name: "a held reservation without a stored deadline",
      input: { stored: row({ reservationHoldExpiresAt: null }) },
      reason: "not_held",
    },
    {
      name: "a hold past its deadline",
      input: {
        stored: row({
          reservationHoldExpiresAt: now.subtract({ seconds: 1 }),
        }),
      },
      reason: "expired",
    },
    {
      name: "a hold without its Dotypos reservation",
      input: { stored: row({ dotyposReservationId: null }) },
      reason: "missing_dotypos_reservation",
    },
  ] as const)(
    "refuses $name without reading Dotypos",
    async ({ input, reason }) => {
      const { getReservationStatus, result } = await reconfirm(input);

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: unavailable(reason),
      });
      expect(getReservationStatus).not.toHaveBeenCalled();
    }
  );

  test.each([
    {
      name: "Dotypos no longer reports the hold NEW",
      input: { dotyposStatus: "CONFIRMED" as const },
      reason: "dotypos_not_pending",
    },
    {
      name: "the hold runs out during the read",
      input: { duringDotyposRead: TestClock.adjust("9 minutes") },
      reason: "expired",
    },
  ] as const)(
    "names an order paid during the Dotypos read when $name",
    async ({ input, reason }) => {
      const { result } = await reconfirm({
        ...input,
        storedLater: row({
          reservationState: "confirmed",
          paymentState: "paid",
        }),
      });

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: unavailable(reason, syntheticPayStateOrderId),
      });
    }
  );

  test("names the paid order when the order is already paid", async () => {
    const { result } = await reconfirm({
      stored: row({ reservationState: "confirmed", paymentState: "paid" }),
    });

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: unavailable("not_held", syntheticPayStateOrderId),
    });
  });
});
