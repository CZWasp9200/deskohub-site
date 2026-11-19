import { Effect, Layer } from "effect";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { PaidFulfillmentQueueService } from "../fulfillment/paid-fulfillment-queue.service";
import { ReservationFulfillment } from "../fulfillment/reservation-fulfillment.service";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import { PaymentLifecycleRepository } from "../repositories/payment-lifecycle.repository";
import { LatePaymentRecoveryQueueService } from "./late-payment-recovery-queue.service";
import { OrderPaymentHandlers } from "./order-payment-handlers.service";
import { makeReservationOrderPaymentHandler } from "./reservation-order-payment-handler";

const ReservationPaymentHandlers = Layer.effect(
  OrderPaymentHandlers,
  Effect.gen(function* () {
    return OrderPaymentHandlers.make(
      { reservation: yield* makeReservationOrderPaymentHandler },
      () => Effect.succeed("reservation")
    );
  })
);

/** Reservation fixtures supply only the collaborators their entry point calls. */
export const withReservationPaymentHandlers = <Services, E, R>(
  collaborators: Layer.Layer<Services, E, R>
) =>
  ReservationPaymentHandlers.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.mock(WorkspaceReservationRepository, {}),
        Layer.mock(PaymentLifecycleRepository, {}),
        Layer.mock(ReservationFulfillment, {}),
        Layer.mock(PaidFulfillmentQueueService, {}),
        Layer.mock(LatePaymentRecoveryRepository, {}),
        Layer.mock(LatePaymentRecoveryQueueService, {}),
        collaborators
      )
    )
  );
