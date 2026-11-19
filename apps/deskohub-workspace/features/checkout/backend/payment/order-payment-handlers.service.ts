import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { OrderId, OrderKind } from "@/features/order";
import { findOrderKind } from "@/features/order/backend/order-kind";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { PaidFulfillmentQueueService } from "../fulfillment/paid-fulfillment-queue.service";
import { ReservationFulfillment } from "../fulfillment/reservation-fulfillment.service";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import { PaymentLifecycleRepository } from "../repositories/payment-lifecycle.repository";
import { LatePaymentRecoveryQueueService } from "./late-payment-recovery-queue.service";
import type {
  AdmittingOrderPaymentHandler,
  OrderPaymentHandler,
} from "./order-payment-handler";
import {
  makeReservationOrderPaymentHandler,
  type ReservationPaymentAdmissionDetails,
} from "./reservation-order-payment-handler";

interface PaymentAdmissionDetails {
  readonly reservation: ReservationPaymentAdmissionDetails;
}

export type PaymentAdmissionDetailsFor<Kind extends OrderKind> =
  Kind extends keyof PaymentAdmissionDetails
    ? PaymentAdmissionDetails[Kind]
    : unknown;

type HandlersByKind = {
  readonly [Kind in OrderKind]?: AdmittingOrderPaymentHandler<
    PaymentAdmissionDetailsFor<Kind>
  >;
};

interface IOrderPaymentHandlers {
  readonly byKind: HandlersByKind;
  readonly forOrder: (
    orderId: OrderId
  ) => Effect.Effect<OrderPaymentHandler | undefined, EffectDrizzleQueryError>;
}

export class OrderPaymentHandlers extends Context.Service<
  OrderPaymentHandlers,
  IOrderPaymentHandlers
>()("OrderPaymentHandlers") {
  static make(
    byKind: HandlersByKind,
    findKind: (
      orderId: OrderId
    ) => Effect.Effect<OrderKind | undefined, EffectDrizzleQueryError>
  ): IOrderPaymentHandlers {
    return {
      byKind,
      forOrder: (orderId) =>
        findKind(orderId).pipe(Effect.map((kind) => kind && byKind[kind])),
    };
  }

  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* WorkspaceDatabase;
      const reservation = yield* makeReservationOrderPaymentHandler;
      return OrderPaymentHandlers.make({ reservation }, (orderId) =>
        findOrderKind(orderId).pipe(
          Effect.provideService(WorkspaceDatabase, database)
        )
      );
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceReservationRepository.Default,
        PaymentLifecycleRepository.Live,
        ReservationFulfillment.Live,
        PaidFulfillmentQueueService.Live,
        LatePaymentRecoveryRepository.Default,
        LatePaymentRecoveryQueueService.Live
      )
    ),
    Layer.provide(WorkspaceDatabase.Default)
  );
}
