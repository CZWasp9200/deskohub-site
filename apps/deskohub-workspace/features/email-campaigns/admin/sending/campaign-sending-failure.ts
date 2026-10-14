import { type Effect, type Layer, Match } from "effect";
import type { requireAdministratorAuthorization } from "@/shared/administrator/administrator-authorization.server";
import type {
  CampaignService,
  ICampaignService,
} from "../../backend/campaign.service";
import type {
  CampaignSendService,
  ICampaignSendService,
} from "../../backend/campaign-send.service";
import type { CampaignConfirmationRejection } from "../../errors";

const confirmationRejectionMessages = {
  "unknown-code":
    "That code doesn't match the latest test email. Check it for typos and try again.",
  superseded:
    "A newer test email replaced that code. Use the code from the latest test email.",
  expired: "That code expired. Send a new test email to get a fresh code.",
  "content-changed":
    "The campaign changed after that test email. Send a new test email and use its code.",
  "too-many-attempts":
    "Too many wrong codes, so that code no longer works. Send a new test email to get a fresh code.",
} as const satisfies Record<CampaignConfirmationRejection, string>;

const unexpectedFailureMessage = "Something went wrong. Try again in a moment.";

/** Every failure a sending action can report, including service setup. */
export type CampaignSendingFailure =
  | Effect.Error<typeof requireAdministratorAuthorization>
  | Effect.Error<ReturnType<ICampaignSendService["testSend"]>>
  | Effect.Error<ReturnType<ICampaignSendService["send"]>>
  | Effect.Error<ReturnType<ICampaignSendService["retryUndelivered"]>>
  | Effect.Error<ReturnType<ICampaignService["duplicate"]>>
  | Layer.Error<typeof CampaignSendService.Live>
  | Layer.Error<typeof CampaignService.Live>;

/** Admin copy for every failure a sending action reports. */
export const describeCampaignSendingFailure = (cause: CampaignSendingFailure) =>
  Match.value(cause).pipe(
    Match.tag(
      "AdministratorUnauthorizedError",
      () =>
        "Your admin sign-in is no longer valid. Reload the page and sign in again."
    ),
    Match.tag("CampaignNotFound", () => "This campaign no longer exists."),
    Match.tag(
      "CampaignReadOnly",
      () => "This campaign already left Draft. Duplicate it to send a new copy."
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
      "CampaignSigningKeyInvalid",
      () =>
        "Confirmation codes can't be issued because the signing secret is misconfigured. Ask a developer to check BETTER_AUTH_SECRETS."
    ),
    Match.tag(
      "CampaignEmailNotConfigured",
      ({ variables }) =>
        `Campaign email isn't configured for this deployment. Ask a developer to set ${variables.join(", ")}.`
    ),
    Match.tag(
      "WorkspaceUrlConfigError",
      () =>
        "The test email couldn't be built because the site URL isn't configured. Ask a developer to check the deployment's URL settings."
    ),
    Match.tag(
      "CampaignAudienceMissing",
      () => "Choose an audience for this campaign before sending it."
    ),
    Match.tag(
      "CampaignAudienceNotFound",
      () =>
        "This campaign's audience no longer exists. Choose another audience; nothing was sent and the code still works."
    ),
    Match.tag(
      "CampaignRecipientResolutionError",
      ({ source }) =>
        `Recipients couldn't be resolved because ${{ dotypos: "Dotypos", database: "the database" }[source]} is unavailable. Nothing was sent and the code still works; try again in a moment.`
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
      "CampaignDeliveryQueueFailed",
      () =>
        "Delivery couldn't be queued, so the campaign is marked Failed. Retry undelivered recipients in a moment."
    ),
    Match.tag(
      "CampaignNotRetryable",
      () => "Only a failed campaign can retry undelivered recipients."
    ),
    Match.tag(
      "ConfigError",
      () =>
        "Campaign sending isn't configured correctly for this deployment. Ask a developer to check its environment variables."
    ),
    Match.tag(
      "PlatformError",
      "SchemaError",
      "EffectDrizzleQueryError",
      "SqlError",
      () => unexpectedFailureMessage
    ),
    Match.exhaustive
  );
