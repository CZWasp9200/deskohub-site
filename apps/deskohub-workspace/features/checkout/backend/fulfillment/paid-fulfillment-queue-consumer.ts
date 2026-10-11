import { Data, Effect, Option, Schema } from "effect";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { WorkspacePaidFulfillmentService } from "./paid-fulfillment.service";

const payloadSchema = Schema.Struct({
  orderId: workspaceReservationIdSchema,
});

const decodePayload = Schema.decodeUnknownOption(payloadSchema);

/** Fails the message so the queue redelivers it after its retry delay. */
class PaidFulfillmentPendingError extends Data.TaggedError(
  "PaidFulfillmentPendingError"
)<{
  readonly orderId: WorkspaceReservationId;
  readonly fulfillmentState: string;
}> {}

export const processPaidFulfillmentMessage = Effect.fn(
  "paidFulfillmentQueue.processMessage"
)(function* (message: Parameters<typeof decodePayload>[0]) {
  const payload = Option.getOrUndefined(decodePayload(message));
  if (!payload) {
    yield* Effect.logWarning(
      "Paid fulfillment queue message ignored: invalid payload"
    );
    return "ignored" as const;
  }

  const fulfillment = yield* WorkspacePaidFulfillmentService;
  yield* fulfillment.fulfillPaidOrder({ orderId: payload.orderId }).pipe(
    Effect.tapError((cause) =>
      Effect.logError("Paid fulfillment queue attempt failed", {
        orderId: payload.orderId,
        cause,
      })
    ),
    Effect.ignore
  );

  // Fulfillment skips a fresh claim held by another worker and leaves
  // transient failures unclaimed; redeliver until it reaches a settled state.
  const reservations = yield* WorkspaceReservationRepository;
  const reservation = yield* reservations.findById(payload.orderId);
  if (
    reservation?.paymentState === "paid" &&
    (reservation.fulfillmentState === "not_started" ||
      reservation.fulfillmentState === "processing")
  ) {
    return yield* new PaidFulfillmentPendingError({
      orderId: payload.orderId,
      fulfillmentState: reservation.fulfillmentState,
    });
  }

  return "processed" as const;
});
