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
 * Delivery state of one frozen recipient. `pending` has not been handed to
 * the email provider yet, `skipped` lost its eligibility before delivery
 * (consent withdrawn or email no longer valid), and the provider reports
 * the rest.
 */
export const campaignRecipientStatuses = [
  "pending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "skipped",
] as const;
const campaignRecipientStatusSchema = Schema.Literals(
  campaignRecipientStatuses
);
export type CampaignRecipientStatus = typeof campaignRecipientStatusSchema.Type;
