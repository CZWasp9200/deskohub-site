import { Schema } from "effect";

/**
 * Draft campaigns are editable. Sending and Sent campaigns have frozen
 * recipients and are read-only; a Failed send can retry its undelivered
 * recipients.
 */
export const campaignStatuses = ["draft", "sending", "sent", "failed"] as const;
const campaignStatusSchema = Schema.Literals(campaignStatuses);
export type CampaignStatus = typeof campaignStatusSchema.Type;

/**
 * Delivery state of one frozen recipient. `pending` has no confirmed
 * provider outcome yet; a batch carrying it may be awaiting a replay.
 * `sent` was accepted by the provider, and its webhook reports `delivered`,
 * `bounced`, or `complained`. `failed` was refused by the provider, so a
 * retry can't mail it twice. `unconfirmed` may have been mailed: its batch's
 * outcome stayed unknown until the idempotency key expired, or the batch
 * could no longer be reproduced, so only an explicit admin retry mails it
 * again. `skipped` lost its eligibility before delivery (see its reason).
 */
export const campaignRecipientStatuses = [
  "pending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "unconfirmed",
  "skipped",
] as const;
const campaignRecipientStatusSchema = Schema.Literals(
  campaignRecipientStatuses
);
export type CampaignRecipientStatus = typeof campaignRecipientStatusSchema.Type;

/**
 * Why a recipient was skipped at delivery: their profile no longer gives a
 * reachable email, their marketing consent was withdrawn, or (outside
 * production) their email is outside the email test domain.
 */
export const campaignRecipientSkipReasons = [
  "missing-from-dotypos",
  "deleted-customer",
  "missing-email",
  "invalid-email",
  "consent-withdrawn",
  "outside-test-domain",
] as const;
const campaignRecipientSkipReasonSchema = Schema.Literals(
  campaignRecipientSkipReasons
);
export type CampaignRecipientSkipReason =
  typeof campaignRecipientSkipReasonSchema.Type;

/**
 * State of one provider batch. `requested` is persisted before every
 * provider request and stays until the provider's answer is recorded, so a
 * resumed delivery replays it under the same key. `accepted` and `rejected`
 * are the provider's answers; `unconfirmed` gave up on an unknown outcome.
 */
export const campaignDeliveryBatchStatuses = [
  "requested",
  "accepted",
  "rejected",
  "unconfirmed",
] as const;
const campaignDeliveryBatchStatusSchema = Schema.Literals(
  campaignDeliveryBatchStatuses
);
export type CampaignDeliveryBatchStatus =
  typeof campaignDeliveryBatchStatusSchema.Type;
