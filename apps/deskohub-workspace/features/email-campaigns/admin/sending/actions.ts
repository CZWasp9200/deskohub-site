"use server";

import { Effect, Match } from "effect";
import { revalidatePath } from "next/cache";
import { requireAdministratorAuthorization } from "@/shared/administrator/administrator-authorization.server";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { CampaignService } from "../../backend/campaign.service";
import type { CampaignConfirmationRejection } from "../../errors";
import {
  type CampaignRetryError,
  CampaignSendPipeline,
  type CampaignSendError,
  type CampaignTestSendError,
} from "../campaign-send-pipeline";
import {
  campaignReferenceStandardSchema,
  campaignSendStandardSchema,
  campaignTestSendStandardSchema,
} from "./contracts";

const confirmationRejectionMessages: Record<
  CampaignConfirmationRejection,
  string
> = {
  "unknown-code":
    "That code doesn't match the latest test email. Check it for typos and try again.",
  superseded:
    "A newer test email replaced that code. Use the code from the latest test email.",
  expired:
    "That code expired. Send a new test email to get a fresh code.",
  "content-changed":
    "The campaign changed after that test email. Send a new test email and use its code.",
  "too-many-attempts":
    "Too many wrong codes, so that code no longer works. Send a new test email to get a fresh code.",
};

const unexpectedFailureMessage = "Something went wrong. Try again in a moment.";

/** Admin copy for every failure the send pipeline reports. */
const describeSendFailure = (
  cause:
    | Effect.Error<typeof requireAdministratorAuthorization>
    | CampaignTestSendError
    | CampaignSendError
    | CampaignRetryError
) =>
  Match.value(cause).pipe(
    Match.tag(
      "AdministratorUnauthorizedError",
      () => "Your admin sign-in is no longer valid. Reload the page and sign in again."
    ),
    Match.tag("CampaignNotFound", () => "This campaign no longer exists."),
    Match.tag(
      "CampaignReadOnly",
      () =>
        "This campaign already left Draft. Duplicate it to send a new copy."
    ),
    Match.tag(
      "CampaignConfirmationRejected",
      ({ reason }) => confirmationRejectionMessages[reason]
    ),
    Match.tag(
      "CampaignTestRecipientInvalid",
      ({ email }) => `${email} isn't a valid email address.`
    ),
    Match.tag(
      "CampaignContentMissing",
      () => "Add a subject and body in at least one language first."
    ),
    Match.tag(
      "CampaignEmailDeliveryFailed",
      () =>
        "The email provider didn't accept the test email. Try again in a moment."
    ),
    Match.tag(
      "CampaignConfirmationKeyInvalid",
      () =>
        "Confirmation codes can't be issued because the signing secret is misconfigured. Ask a developer to check BETTER_AUTH_SECRETS."
    ),
    Match.tag(
      "CampaignAudienceMissing",
      () => "Choose an audience for this campaign before sending it."
    ),
    Match.tag(
      "CampaignRecipientResolutionError",
      () =>
        "Recipients couldn't be resolved because Dotypos is unavailable. Nothing was sent and the code still works; try again in a moment."
    ),
    Match.tag(
      "CampaignRecipientsOutsideTestDomain",
      ({ recipientCount }) =>
        `Outside production, campaign email can only go to @deskohub.test addresses, and ${recipientCount} ${recipientCount === 1 ? "address is" : "addresses are"} outside it. Nothing was sent.`
    ),
    Match.tag(
      "CampaignNoRecipients",
      () =>
        "The audience has no reachable recipients right now, so nothing was sent."
    ),
    Match.tag(
      "CampaignNotRetryable",
      () => "Only a failed campaign can retry undelivered recipients."
    ),
    Match.tag(
      "CampaignSendUnavailable",
      () =>
        "Sending isn't available in this build yet. Nothing was sent and the code still works."
    ),
    Match.tag("EffectDrizzleQueryError", () => unexpectedFailureMessage),
    Match.exhaustive
  );

// Failures outside the pipeline's typed errors, such as a layer that can't
// be built, reach the action client's generic server error.
const toPublicSendError = (
  cause: Parameters<typeof describeSendFailure>[0]
) => new PublicSafeActionError({ message: describeSendFailure(cause), cause });

const campaignPath = (campaignId: string) =>
  `/admin/email-campaigns/${campaignId}`;

const testSendAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.test-send",
    schema: campaignTestSendStandardSchema,
    logInput: false,
  },
  Effect.fn(
    function* ({ campaignId, extraRecipients }) {
      yield* requireAdministratorAuthorization;
      const pipeline = yield* CampaignSendPipeline;
      const receipt = yield* pipeline.testSend({
        campaignId,
        extraRecipients,
      });
      return {
        recipients: receipt.recipients,
        locales: receipt.locales,
        codeExpiresAt: receipt.codeExpiresAt.toString(),
      };
    },
    (effect) =>
      effect.pipe(
        Effect.mapError(toPublicSendError),
        Effect.provide(CampaignSendPipeline.Live)
      )
  )
);

const sendAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.send",
    schema: campaignSendStandardSchema,
    logInput: false,
  },
  Effect.fn(
    function* ({ campaignId, confirmationCode }) {
      yield* requireAdministratorAuthorization;
      const pipeline = yield* CampaignSendPipeline;
      return yield* pipeline.send({ campaignId, confirmationCode });
    },
    (effect) =>
      effect.pipe(
        Effect.mapError(toPublicSendError),
        Effect.provide(CampaignSendPipeline.Live)
      )
  )
);

const retryUndeliveredAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.retry-undelivered",
    schema: campaignReferenceStandardSchema,
  },
  Effect.fn(
    function* ({ campaignId }) {
      yield* requireAdministratorAuthorization;
      const pipeline = yield* CampaignSendPipeline;
      return yield* pipeline.retryUndelivered({ campaignId });
    },
    (effect) =>
      effect.pipe(
        Effect.mapError(toPublicSendError),
        Effect.provide(CampaignSendPipeline.Live)
      )
  )
);

const duplicateAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.duplicate",
    schema: campaignReferenceStandardSchema,
  },
  Effect.fn(
    function* ({ campaignId }) {
      yield* requireAdministratorAuthorization;
      const campaigns = yield* CampaignService;
      const copy = yield* campaigns.duplicate(campaignId);
      return { campaignId: copy.id };
    },
    (effect) =>
      effect.pipe(
        Effect.mapError(toPublicSendError),
        Effect.provide(CampaignService.Live)
      )
  )
);

// Revalidate in the bridges rather than inside the Effect: a fiber resumed by
// a database callback can run under another request's Next.js work store.

export const sendCampaignTest: typeof testSendAction = async (
  ...args: Parameters<typeof testSendAction>
) => {
  "use server";
  return await testSendAction(...args);
};

export const sendCampaign: typeof sendAction = async (
  ...args: Parameters<typeof sendAction>
) => {
  "use server";
  const result = await sendAction(...args);
  if (result?.data) {
    revalidatePath("/admin/email-campaigns");
    revalidatePath(campaignPath(args[0].campaignId));
  }
  return result;
};

export const retryUndeliveredCampaignRecipients: typeof retryUndeliveredAction =
  async (...args: Parameters<typeof retryUndeliveredAction>) => {
    "use server";
    const result = await retryUndeliveredAction(...args);
    if (result?.data) {
      revalidatePath("/admin/email-campaigns");
      revalidatePath(campaignPath(args[0].campaignId));
    }
    return result;
  };

export const duplicateCampaign: typeof duplicateAction = async (
  ...args: Parameters<typeof duplicateAction>
) => {
  "use server";
  const result = await duplicateAction(...args);
  if (result?.data) revalidatePath("/admin/email-campaigns");
  return result;
};
