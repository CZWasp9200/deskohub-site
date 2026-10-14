import { Array as Arr } from "effect";
import type { CampaignSendId } from "./campaign-identifiers";

/** Recipients per email provider batch request (Resend's batch limit). */
const campaignDeliveryBatchSize = 100;

/**
 * Splits one delivery attempt's recipients, already in customer ID order,
 * into provider batches. The same recipients always give the same batches,
 * so a redelivered queue message replays each batch under its original key.
 */
export const chunkCampaignDeliveryBatches = <A>(
  recipients: readonly A[]
): readonly (readonly A[])[] =>
  Arr.chunksOf(recipients, campaignDeliveryBatchSize);

/**
 * The provider idempotency key of one batch. A retried transport failure or
 * a redelivered message reuses it, so the provider returns the accepted
 * batch instead of mailing it again; a retry of the undelivered recipients
 * starts a new attempt with new keys.
 */
export const campaignDeliveryBatchIdempotencyKey = (batch: {
  readonly sendId: CampaignSendId;
  readonly deliveryAttempt: number;
  readonly batchIndex: number;
}) =>
  `email-campaign:${batch.sendId}:attempt-${batch.deliveryAttempt}:batch-${batch.batchIndex}`;
