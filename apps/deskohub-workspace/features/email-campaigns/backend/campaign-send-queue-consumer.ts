import { Effect, Option, Schema } from "effect";
import { campaignSendIdSchema } from "../campaign-identifiers";
import { CampaignDeliveryService } from "./campaign-delivery.service";

const payloadSchema = Schema.Struct({
  sendId: campaignSendIdSchema,
  deliveryAttempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});

const decodePayload = Schema.decodeUnknownOption(payloadSchema);

/**
 * Delivers one queued attempt. A failure (an unavailable database, or an
 * attempt that ran out of time) fails the message, so the queue redelivers
 * it and the attempt resumes with the batches still pending.
 */
export const processCampaignSendMessage = Effect.fn(
  "campaignSendQueue.processMessage"
)(function* (message: Parameters<typeof decodePayload>[0]) {
  const payload = Option.getOrUndefined(decodePayload(message));
  if (!payload) {
    yield* Effect.logWarning(
      "Campaign send queue message ignored: invalid payload"
    );
    return "ignored" as const;
  }

  const delivery = yield* CampaignDeliveryService;
  return yield* delivery.deliverAttempt(payload);
});
