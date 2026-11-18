import type { NexiCorrelationId } from "@deskohub/nexi";
import { Effect } from "effect";
import type { OrderId } from "@/features/order";
import type { WorkspaceReservation } from "@/features/reservation/backend/workspace-reservation.repository";
import { reservationIdForOrder } from "@/features/reservation/persistence-contracts";
import type { IReservationFulfillment } from "../fulfillment/reservation-fulfillment.service";
import type { ILatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import type { IPaymentLifecycleRepository } from "../repositories/payment-lifecycle.repository";
import type { ILatePaymentRecoveryQueueService } from "./late-payment-recovery-queue.service";

type MarkPaid = IPaymentLifecycleRepository["markPaid"];
type MarkTerminal = IPaymentLifecycleRepository["markTerminal"];
type StartRecovery = ILatePaymentRecoveryRepository["start"];

type LatePaymentRecoveryInput = Omit<
  Parameters<StartRecovery>[0],
  "workspaceReservationId"
>;

export interface OrderPaymentSettlement {
  readonly orderId: OrderId;
  readonly correlationId: NexiCorrelationId;
  readonly markPaid: (
    input: Omit<Parameters<MarkPaid>[0], "orderId">
  ) => ReturnType<MarkPaid>;
  readonly markTerminal: (
    input: Omit<Parameters<MarkTerminal>[0], "orderId">
  ) => ReturnType<MarkTerminal>;
  readonly fulfill: () => ReturnType<IReservationFulfillment["run"]>;
  readonly startRecovery: (
    input: LatePaymentRecoveryInput
  ) => Effect.Effect<
    void,
    | Effect.Error<ReturnType<StartRecovery>>
    | Effect.Error<ReturnType<ILatePaymentRecoveryQueueService["enqueue"]>>
  >;
}

export const reservationLatePaymentRecovery = (
  recovery: ILatePaymentRecoveryRepository,
  queue: ILatePaymentRecoveryQueueService,
  orderId: OrderId,
  { paymentAttemptId, ...facts }: LatePaymentRecoveryInput
) =>
  recovery
    .start({
      paymentAttemptId,
      workspaceReservationId: reservationIdForOrder(orderId),
      ...facts,
    })
    .pipe(Effect.andThen(() => queue.enqueue({ paymentAttemptId })));

export const reservationPaymentSettlement = (input: {
  readonly orderId: OrderId;
  readonly reservation: Pick<WorkspaceReservation, "id" | "correlationId">;
  readonly lifecycle: IPaymentLifecycleRepository;
  readonly fulfillment: IReservationFulfillment;
  readonly recovery: ILatePaymentRecoveryRepository;
  readonly recoveryQueue: ILatePaymentRecoveryQueueService;
}): OrderPaymentSettlement => ({
  orderId: input.orderId,
  correlationId: input.reservation.correlationId,
  markPaid: ({ id, ...facts }) =>
    input.lifecycle.markPaid({ id, orderId: input.orderId, ...facts }),
  markTerminal: ({ id, ...facts }) =>
    input.lifecycle.markTerminal({ id, orderId: input.orderId, ...facts }),
  fulfill: () => input.fulfillment.run(input.reservation.id),
  startRecovery: (facts) =>
    reservationLatePaymentRecovery(
      input.recovery,
      input.recoveryQueue,
      input.orderId,
      facts
    ),
});
