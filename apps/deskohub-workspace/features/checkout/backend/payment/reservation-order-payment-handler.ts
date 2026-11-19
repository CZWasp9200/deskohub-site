import "@/shared/polyfills/temporal";

import { Effect } from "effect";
import {
  reservationLogFields,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { reservationIdForOrder } from "@/features/reservation/persistence-contracts";
import { PaidFulfillmentQueueService } from "../fulfillment/paid-fulfillment-queue.service";
import { ReservationFulfillment } from "../fulfillment/reservation-fulfillment.service";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import { PaymentLifecycleRepository } from "../repositories/payment-lifecycle.repository";
import { LatePaymentRecoveryQueueService } from "./late-payment-recovery-queue.service";
import type { AdmittingOrderPaymentHandler } from "./order-payment-handler";

export type ReservationPaymentAdmissionDetails = Pick<
  Parameters<
    PaymentLifecycleRepository["Service"]["completeInternalPayment"]
  >[0],
  "commitment" | "accountingSnapshot"
>;

// A pending recovery that hasn't progressed may have lost its queue message.
const stalledRecoveryEnqueueAfter = Temporal.Duration.from({ minutes: 1 });

export const makeReservationOrderPaymentHandler = Effect.gen(function* () {
  const reservations = yield* WorkspaceReservationRepository;
  const lifecycle = yield* PaymentLifecycleRepository;
  const fulfillment = yield* ReservationFulfillment;
  const paidQueue = yield* PaidFulfillmentQueueService;
  const recoveries = yield* LatePaymentRecoveryRepository;
  const recoveryQueue = yield* LatePaymentRecoveryQueueService;

  const handler: AdmittingOrderPaymentHandler<ReservationPaymentAdmissionDetails> =
    {
      load: (orderId) =>
        reservations.findById(reservationIdForOrder(orderId)).pipe(
          Effect.map(
            (reservation) =>
              reservation && {
                id: orderId,
                correlationId: reservation.correlationId,
                activePaymentAttemptId: reservation.activePaymentAttemptId,
                paymentState: reservation.paymentState,
                fulfillmentState: reservation.fulfillmentState,
                logFields: reservationLogFields(reservation),
              }
          )
        ),
      admitNexi: ({ details: { commitment, accountingSnapshot }, ...input }) =>
        lifecycle.createPendingNexiAttempt({
          ...input,
          commitment,
          accountingSnapshot,
        }),
      admitInternal: ({
        details: { commitment, accountingSnapshot },
        ...input
      }) =>
        lifecycle.completeInternalPayment({
          ...input,
          commitment,
          accountingSnapshot,
        }),
      attachProviderSession: lifecycle.attachProviderSession,
      markPaid: lifecycle.markPaid,
      markTerminal: lifecycle.markTerminal,
      fulfill: (orderId) => fulfillment.run(reservationIdForOrder(orderId)),
      scheduleFulfillment: Effect.fn(
        "providerPaymentFinalization.enqueueFulfillment"
      )(function* (input) {
        const reservationId = reservationIdForOrder(input.orderId);
        yield* paidQueue.enqueue({ orderId: reservationId }).pipe(
          Effect.tap(() =>
            Effect.logInfo("Payment finalization fulfillment enqueued")
          ),
          Effect.catch((cause) =>
            Effect.logError(
              "Paid order fulfillment could not be enqueued; fulfilling inline",
              { ...input, cause }
            ).pipe(
              Effect.andThen(fulfillment.run(reservationId)),
              Effect.tapError((cause) =>
                Effect.logFatal(
                  "Paid order fulfillment failed during finalization",
                  {
                    ...input,
                    cause,
                  }
                )
              ),
              Effect.ignore
            )
          )
        );
      }),
      resumeRecovery: Effect.fnUntraced(function* ({ paymentAttemptId }) {
        const existing =
          yield* recoveries.findByPaymentAttemptId(paymentAttemptId);
        if (!existing) return false;
        if (
          existing.state === "pending" &&
          Temporal.Instant.compare(
            existing.createdAt,
            Temporal.Now.instant().subtract(stalledRecoveryEnqueueAfter)
          ) < 0
        ) {
          yield* recoveryQueue.enqueue({ paymentAttemptId });
        }
        return true;
      }),
      startRecovery: ({ orderId, paymentAttemptId, ...facts }) =>
        recoveries
          .start({
            paymentAttemptId,
            workspaceReservationId: reservationIdForOrder(orderId),
            ...facts,
          })
          .pipe(
            Effect.andThen(() => recoveryQueue.enqueue({ paymentAttemptId }))
          ),
    };
  return handler;
});
