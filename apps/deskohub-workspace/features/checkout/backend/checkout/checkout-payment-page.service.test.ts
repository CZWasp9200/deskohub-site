import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import type { LatePaymentRecovery } from "@/db/schema";
import {
  type IReservationAuthorizationService,
  ReservationAuthorizationService,
} from "@/features/reservation/backend/reservation-authorization.service";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import {
  type PaymentAttempt,
  PaymentAttemptRepository,
} from "../repositories/payment-attempt.repository";
import {
  CheckoutPaymentPageService,
  type PaymentPageReopeningInput,
} from "./checkout-payment-page.service";

const instant = (value: string) => Temporal.Instant.from(value);

const providerOrderCreatedAt = instant("2026-06-01T10:00:00Z");
const providerRedirectUrl = "https://sandbox.example/hpp/order-page";

const input = {
  orderId: "reservation-reopen",
  locale: "cs-CZ",
  accessCookie: "access-cookie",
} as PaymentPageReopeningInput;

const makeReservation = (overrides: Partial<WorkspaceReservation> = {}) =>
  ({
    id: "reservation-reopen",
    reservationState: "held",
    // The ten-minute hold expired; the pending provider order keeps it held.
    reservationHoldExpiresAt: instant("2026-06-01T10:10:00Z"),
    paymentState: "pending",
    activePaymentAttemptId: "attempt-reopen",
    ...overrides,
  }) as WorkspaceReservation;

const makeAttempt = (overrides: Partial<PaymentAttempt> = {}) =>
  ({
    id: "attempt-reopen",
    workspaceReservationId: "reservation-reopen",
    provider: "nexi",
    providerOrderId: "provider-order-id",
    state: "pending",
    securityToken: "security-token",
    providerRedirectUrl,
    providerOrderCreatedAt,
    createdAt: instant("2026-06-01T09:59:58Z"),
    ...overrides,
  }) as PaymentAttempt;

const lateRecovery = (overrides: Partial<LatePaymentRecovery> = {}) =>
  ({
    paymentAttemptId: "attempt-older",
    state: "pending",
    ...overrides,
  }) as LatePaymentRecovery;

type Harness = {
  readonly authorized?: boolean;
  readonly reservation?: WorkspaceReservation | null;
  readonly attempt?: PaymentAttempt | null;
  readonly latePaymentRecovery?: LatePaymentRecovery | null;
  readonly now?: Temporal.Instant;
};

/**
 * The service over read-only fakes. It is given no payment lifecycle, Nexi,
 * or reservation writer, so reopening can't create an attempt or call the
 * provider; the fakes record every read.
 */
const createHarness = (harness: Harness = {}) => {
  const isAuthorized = mock<IReservationAuthorizationService["isAuthorized"]>(
    () => Effect.succeed(harness.authorized ?? true)
  );
  const findReservation = mock(() =>
    Effect.succeed(
      harness.reservation === undefined
        ? makeReservation()
        : harness.reservation
    )
  );
  const findAttempt = mock(() =>
    Effect.succeed(
      harness.attempt === undefined ? makeAttempt() : harness.attempt
    )
  );
  const findLatePaymentRecovery = mock(() =>
    Effect.succeed(harness.latePaymentRecovery ?? null)
  );
  const layer = CheckoutPaymentPageService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ReservationAuthorizationService, {
          isAuthorized,
          authorize: () => Effect.die("reopening must not use authorize"),
        }),
        Layer.mock(WorkspaceReservationRepository, {
          findById: findReservation,
        }),
        Layer.mock(PaymentAttemptRepository, { findById: findAttempt }),
        Layer.mock(LatePaymentRecoveryRepository, {
          findLatestByWorkspaceReservationId: findLatePaymentRecovery,
        })
      )
    )
  );
  const reopen = () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(
          (harness.now ?? instant("2026-06-01T10:20:00Z")).epochMilliseconds
        );
        const service = yield* CheckoutPaymentPageService;
        return yield* service.reopen(input);
      }).pipe(Effect.provide(Layer.merge(layer, TestClock.layer())))
    );

  return {
    findAttempt,
    findLatePaymentRecovery,
    findReservation,
    isAuthorized,
    reopen,
  };
};

describe("CheckoutPaymentPageService.reopen", () => {
  test("opens the stored payment page again, the same page each time, past the hold's own expiry", async () => {
    const harness = createHarness();

    const first = await harness.reopen();
    const second = await harness.reopen();

    expect(first).toEqual({ state: "opened", providerRedirectUrl });
    expect(second).toEqual(first);
    expect(harness.isAuthorized).toHaveBeenCalledWith({
      accessCookie: input.accessCookie,
      locale: input.locale,
      orderId: input.orderId,
      permission: "open-payment-page",
    });
    expect(harness.findAttempt).toHaveBeenCalledWith("attempt-reopen");
  });

  test("opens a page stored on a created attempt", async () => {
    const harness = createHarness({
      attempt: makeAttempt({ state: "created" }),
    });

    expect(await harness.reopen()).toEqual({
      state: "opened",
      providerRedirectUrl,
    });
  });

  test("opens the page until just before the provider order's abandonment window ends", async () => {
    const harness = createHarness({ now: instant("2026-06-01T10:29:59Z") });

    expect((await harness.reopen()).state).toBe("opened");
  });

  test("closes the page once the provider order's abandonment window ends", async () => {
    const harness = createHarness({ now: instant("2026-06-01T10:30:00Z") });

    expect(await harness.reopen()).toEqual({
      state: "closed",
      reason: "window_elapsed",
    });
  });

  test("counts the window from the attempt's creation when the provider order's creation time was not stored", async () => {
    const harness = createHarness({
      attempt: makeAttempt({ providerOrderCreatedAt: null }),
      now: instant("2026-06-01T10:29:59Z"),
    });

    expect(await harness.reopen()).toEqual({
      state: "closed",
      reason: "window_elapsed",
    });
  });

  test("answers not found without reading the order for a visitor who may not open its payment page", async () => {
    const harness = createHarness({ authorized: false });

    expect(await harness.reopen()).toEqual({ state: "not_found" });
    expect(harness.findReservation).not.toHaveBeenCalled();
    expect(harness.findAttempt).not.toHaveBeenCalled();
  });

  test("answers not found for an order that doesn't exist", async () => {
    const harness = createHarness({ reservation: null });

    expect(await harness.reopen()).toEqual({ state: "not_found" });
  });

  test("closes the page of a paid order", async () => {
    const harness = createHarness({
      reservation: makeReservation({ paymentState: "paid" }),
      attempt: makeAttempt({ state: "paid" }),
    });

    expect(await harness.reopen()).toEqual({ state: "closed", reason: "paid" });
    expect(harness.findAttempt).not.toHaveBeenCalled();
  });

  test("closes the page while a late payment of the order is reconciled", async () => {
    const harness = createHarness({ latePaymentRecovery: lateRecovery() });

    expect(await harness.reopen()).toEqual({
      state: "closed",
      reason: "late_payment",
    });
    expect(harness.findAttempt).not.toHaveBeenCalled();
  });

  test("ignores a late payment that recovery already confirmed", async () => {
    const harness = createHarness({
      latePaymentRecovery: lateRecovery({ state: "recovered" }),
    });

    expect((await harness.reopen()).state).toBe("opened");
  });

  test.each(["cancelled", "expired", "confirmed"] as const)(
    "closes the page of an order whose hold is %s",
    async (reservationState) => {
      const harness = createHarness({
        reservation: makeReservation({ reservationState }),
      });

      expect(await harness.reopen()).toEqual({
        state: "closed",
        reason: "released",
      });
      expect(harness.findAttempt).not.toHaveBeenCalled();
    }
  );

  test.each(["failed", "cancelled", "expired"] as const)(
    "closes the page of a %s attempt",
    async (state) => {
      const harness = createHarness({
        reservation: makeReservation({ paymentState: state }),
        attempt: makeAttempt({ state, failureCode: "provider_failed" }),
      });

      expect(await harness.reopen()).toEqual({
        state: "closed",
        reason: "no_active_attempt",
      });
    }
  );

  test.each([
    ["no stored page", { providerRedirectUrl: null }],
    ["no security token", { securityToken: null }],
    ["another order", { workspaceReservationId: "reservation-other" }],
  ] as const)("closes the page of an attempt with %s", async (_, overrides) => {
    const harness = createHarness({
      attempt: makeAttempt(overrides as Partial<PaymentAttempt>),
    });

    expect(await harness.reopen()).toEqual({
      state: "closed",
      reason: "no_active_attempt",
    });
  });

  test("closes the page of an order without an active attempt", async () => {
    const harness = createHarness({
      reservation: makeReservation({
        paymentState: "not_started",
        activePaymentAttemptId: null,
      }),
    });

    expect(await harness.reopen()).toEqual({
      state: "closed",
      reason: "no_active_attempt",
    });
    expect(harness.findAttempt).not.toHaveBeenCalled();
  });

  test("closes the page when the active attempt row is missing", async () => {
    const harness = createHarness({ attempt: null });

    expect(await harness.reopen()).toEqual({
      state: "closed",
      reason: "no_active_attempt",
    });
  });
});
