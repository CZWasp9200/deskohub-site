import { Context, Data, Duration, Effect, Layer, Schema } from "effect";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { QueuePublisher } from "@/shared/backend/queue/queue-publisher";
import { defineQueueTopic } from "@/shared/backend/queue/queue-topic";

/**
 * The fulfillment of a paid order, or the replacement invoice a restored
 * reservation is owed. A run for an order already fulfilled issues and sends
 * its invoice alone, so a replacement reuses the order's message.
 */
type PaidFulfillmentRequest = {
  readonly orderId: WorkspaceReservationId;
  /** The cancelled invoice a restore replaces; set only for that retry. */
  readonly replacesInvoiceId?: InvoiceId;
};

/**
 * One message per order: the key is the order's fulfillment idempotency. A
 * replacement's key names the invoice it replaces, so the order's earlier
 * message, still retained, doesn't absorb it, and each replacement runs once.
 */
export const paidFulfillmentTopic = defineQueueTopic({
  topic: "workspace-paid-fulfillment",
  label: "Paid fulfillment",
  message: Schema.toStandardSchemaV1(
    Schema.Struct({ orderId: workspaceReservationIdSchema })
  ),
  publish: (input: PaidFulfillmentRequest) => ({
    message: { orderId: input.orderId },
    key: input.replacesInvoiceId
      ? `paid-fulfillment:${input.orderId}:replacing:${input.replacesInvoiceId}`
      : `paid-fulfillment:${input.orderId}`,
  }),
  retention: Duration.hours(24),
});

export class PaidFulfillmentQueueError extends Data.TaggedError(
  "PaidFulfillmentQueueError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface IPaidFulfillmentQueueService {
  readonly enqueue: (
    input: PaidFulfillmentRequest
  ) => Effect.Effect<void, PaidFulfillmentQueueError>;
}

/**
 * Defers paid-order fulfillment to a durable queue so request paths that learn
 * about a payment (the status page, hold cleanup) never run Dotypos, access
 * code, email, and invoice work inline. The consumer retries until
 * fulfillment leaves the pending states.
 */
export class PaidFulfillmentQueueService extends Context.Service<
  PaidFulfillmentQueueService,
  IPaidFulfillmentQueueService
>()("PaidFulfillmentQueueService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const publisher = yield* QueuePublisher;
      return {
        enqueue: Effect.fn("paidFulfillmentQueue.enqueue")(function* (input) {
          yield* paidFulfillmentTopic.publish(input).pipe(
            Effect.provideService(QueuePublisher, publisher),
            Effect.mapError(
              (error) =>
                new PaidFulfillmentQueueError({
                  message: "Paid fulfillment could not be enqueued.",
                  cause: error.cause,
                })
            )
          );
        }),
      };
    })
  );

  static Live = this.Default.pipe(Layer.provide(QueuePublisher.Default));
}
