import { Data } from "effect";
import type { CampaignAudienceId, CampaignId } from "./campaign-identifiers";
import type { CampaignStatus } from "./campaign-states";

export class CampaignNotFound extends Data.TaggedError("CampaignNotFound")<{
  readonly campaignId: CampaignId;
}> {}

export class CampaignAudienceNotFound extends Data.TaggedError(
  "CampaignAudienceNotFound"
)<{
  readonly audienceId: CampaignAudienceId;
}> {}

/** A campaign left Draft, so its content and audience are frozen. */
export class CampaignReadOnly extends Data.TaggedError("CampaignReadOnly")<{
  readonly campaignId: CampaignId;
  readonly status: Exclude<CampaignStatus, "draft">;
}> {}

/** Draft campaigns use the audience, so it can be archived but not deleted. */
export class CampaignAudienceInUse extends Data.TaggedError(
  "CampaignAudienceInUse"
)<{
  readonly audienceId: CampaignAudienceId;
  readonly draftCampaignIds: readonly CampaignId[];
}> {}

/** An archived audience can't be assigned to a campaign. */
export class CampaignAudienceArchived extends Data.TaggedError(
  "CampaignAudienceArchived"
)<{
  readonly audienceId: CampaignAudienceId;
}> {}

export type CampaignConfirmationRejection =
  | "unknown-code"
  | "already-confirmed"
  | "superseded"
  | "expired"
  | "content-changed";

/**
 * The typed confirmation code can't confirm the real send. Every rejection
 * needs a new test send except `unknown-code`, which may be a typo.
 */
export class CampaignConfirmationRejected extends Data.TaggedError(
  "CampaignConfirmationRejected"
)<{
  readonly campaignId: CampaignId;
  readonly reason: CampaignConfirmationRejection;
}> {}

/**
 * Recipients couldn't be resolved because a source was unavailable. The
 * resolution never returns a partial list, so the operator can retry.
 */
export class CampaignRecipientResolutionError extends Data.TaggedError(
  "CampaignRecipientResolutionError"
)<{
  readonly source: "dotypos" | "database";
  readonly cause: unknown;
}> {
  static readonly dotypos = (cause: unknown) =>
    new CampaignRecipientResolutionError({ source: "dotypos", cause });

  static readonly database = (cause: unknown) =>
    new CampaignRecipientResolutionError({ source: "database", cause });
}

/**
 * Outside production, campaign mail (test sends included) may reach only the
 * email test domain.
 */
export class CampaignRecipientsOutsideTestDomain extends Data.TaggedError(
  "CampaignRecipientsOutsideTestDomain"
)<{
  readonly recipientCount: number;
}> {}
