import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  type PayableReservation,
  PayableReservationService,
  PayableReservationUnavailableError,
} from "./payable-reservation.service";
import { ReservationSupersessionService } from "./reservation-supersession.service";

const reservation = (
  overrides: Partial<PayableReservation> = {}
): PayableReservation =>
  ({
    id: "reservation-id",
    reservationState: "held",
    paymentState: "not_started",
    dotyposReservationId: "dotypos-reservation-id",
    reservationHoldExpiresAt: Temporal.Instant.from("2099-06-01T10:10:00Z"),
    ...overrides,
  }) as PayableReservation;

const findCurrent = async (input: {
  readonly current?: PayableReservation;
  readonly unavailable?: boolean;
}) => {
  const requireCurrent = mock(() =>
    input.unavailable
      ? Effect.fail(
          new PayableReservationUnavailableError({
            orderId: "reservation-id",
            reason: "not_current",
          })
        )
      : Effect.succeed(input.current ?? reservation())
  );

  const result = await Effect.gen(function* () {
    const supersessions = yield* ReservationSupersessionService;
    return yield* supersessions.findCurrent({
      orderId: "reservation-id",
      checkoutSessionId: "checkout-session-id",
    });
  }).pipe(
    Effect.provide(
      ReservationSupersessionService.Default.pipe(
        Layer.provide(
          Layer.succeed(PayableReservationService, { requireCurrent })
        )
      )
    ),
    Effect.runPromise
  );

  return { requireCurrent, result };
};

describe("ReservationSupersessionService", () => {
  test.each(["not_started", "failed", "cancelled", "expired"] as const)(
    "accepts a current unpaid hold in %s payment state",
    async (paymentState) => {
      const { result } = await findCurrent({
        current: reservation({ paymentState }),
      });

      expect(result).toMatchObject({
        id: "reservation-id",
        dotyposReservationId: "dotypos-reservation-id",
      });
    }
  );

  test.each(["pending", "paid"] as const)(
    "does not expose a current hold in %s payment state",
    async (paymentState) => {
      const { result } = await findCurrent({
        current: reservation({ paymentState }),
      });

      expect(result).toBeUndefined();
    }
  );

  test("turns an unavailable or stale current hold into no exclusion", async () => {
    const { result } = await findCurrent({ unavailable: true });

    expect(result).toBeUndefined();
  });
});
