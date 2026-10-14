import { DuplicateMessageError, send } from "@vercel/queue";
import { Context, Data, Effect, Layer } from "effect";
import { serializeErrorForLog } from "@/shared/utils/error-formatting";
import type { CampaignSendId } from "../campaign-identifiers";

export const campaignSendQueueTopic = "workspace-email-campaign-send";

/** The provider honours batch idempotency keys for 24 hours. */
const campaignSendMessageRetentionSeconds = 24 * 60 * 60;

export class CampaignSendQueueError extends Data.TaggedError(
  "CampaignSendQueueError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

class DuplicateCampaignSendMessageError extends Data.TaggedError(
  "DuplicateCampaignSendMessageError"
) {}

/** One delivery attempt of a frozen campaign send. */
export type CampaignDeliveryAttempt = {
  readonly sendId: CampaignSendId;
  readonly deliveryAttempt: number;
};

interface ICampaignSendQueueService {
  readonly enqueue: (
    attempt: CampaignDeliveryAttempt
  ) => Effect.Effect<void, CampaignSendQueueError>;
}

/**
 * Hands a delivery attempt to the durable queue, so an admin request never
 * waits on the email provider. One message per attempt; the consumer
 * redelivers it until every batch of the attempt went out.
 */
export const makeCampaignSendQueueService = (
  sendMessage: typeof send = send
): ICampaignSendQueueService => ({
  enqueue: Effect.fn("campaignSendQueue.enqueue")(function* (attempt) {
    yield* Effect.tryPromise({
      try: () =>
        sendMessage(
          campaignSendQueueTopic,
          {
            sendId: attempt.sendId,
            deliveryAttempt: attempt.deliveryAttempt,
          },
          {
            retentionSeconds: campaignSendMessageRetentionSeconds,
            idempotencyKey: `email-campaign-send:${attempt.sendId}:${attempt.deliveryAttempt}`,
          }
        ),
      catch: (cause) =>
        cause instanceof DuplicateMessageError
          ? new DuplicateCampaignSendMessageError()
          : new CampaignSendQueueError({
              message: "Campaign delivery could not be enqueued.",
              cause: serializeErrorForLog(cause),
            }),
    }).pipe(
      Effect.catchTag("DuplicateCampaignSendMessageError", () => Effect.void)
    );
  }),
});

export class CampaignSendQueueService extends Context.Service<
  CampaignSendQueueService,
  ICampaignSendQueueService
>()("@deskohub-workspace/email-campaigns/CampaignSendQueueService") {
  static Default = Layer.succeed(this, makeCampaignSendQueueService());
}
