import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { LegalEvidenceEventRepository } from "@/features/checkout/backend/repositories/legal-evidence-event.repository";
import { PaymentAttemptRepository } from "@/features/checkout/backend/repositories/payment-attempt.repository";
import {
  ReservationCancellation,
  type ReservationCancellationInput,
} from "./reservation-cancellation.service";
import { ReservationWithdrawals } from "./reservation-withdrawals";
import { WorkspaceReservationRepository } from "./workspace-reservation.repository";
import { WorkspaceReservationService } from "./workspace-reservation.service";

const paid = { value: 300_000, exponent: 2, currency: "CZK" };

const cancelWith = async (
  refundAmount: typeof paid,
  refundBasis:
    | { readonly kind: "full" }
    | {
        readonly kind: "partial";
        readonly unit: "day";
        readonly unstarted: number;
        readonly total: number;
      }
) => {
  const requested: ReservationCancellationInput[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const family = yield* ReservationWithdrawals;
      yield* family.cancel({
        contractId: "reservation-1",
        refundAmount,
        refundBasis,
      });
    }).pipe(
      Effect.provide(
        ReservationWithdrawals.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ReservationCancellation, {
                cancel: (input) =>
                  Effect.sync(() => {
                    requested.push(input);
                    return { outcome: "already_cancelled" } as const;
                  }),
              }),
              Layer.mock(WorkspaceReservationRepository, {}),
              Layer.mock(WorkspaceReservationService, {}),
              Layer.mock(LegalEvidenceEventRepository, {}),
              Layer.mock(PaymentAttemptRepository, {})
            )
          )
        )
      )
    )
  );
  return requested;
};

describe("ReservationWithdrawals.cancel", () => {
  test("owes the whole payment back and gives promotions back before the service starts", async () => {
    expect(await cancelWith(paid, { kind: "full" })).toEqual([
      {
        reservationId: "reservation-1",
        cause: "customer_withdrawal",
        refund: { targetValue: 300_000, releasesPromotions: true },
      },
    ]);
  });

  test("owes only the unstarted share once the service started and keeps promotions", async () => {
    expect(
      await cancelWith(
        { ...paid, value: 200_000 },
        { kind: "partial", unit: "day", unstarted: 2, total: 3 }
      )
    ).toEqual([
      {
        reservationId: "reservation-1",
        cause: "customer_withdrawal",
        refund: { targetValue: 200_000, releasesPromotions: false },
      },
    ]);
  });

  test("marks no refund for a zero-total reservation", async () => {
    expect(await cancelWith({ ...paid, value: 0 }, { kind: "full" })).toEqual([
      {
        reservationId: "reservation-1",
        cause: "customer_withdrawal",
        refund: { releasesPromotions: true },
      },
    ]);
  });
});
