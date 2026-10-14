import "server-only";

import type { DotyposCustomerId } from "@deskohub/dotypos";
import { asc, desc, eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import "@/shared/polyfills/temporal";
import { WorkspaceDatabase } from "@/db/database.service";
import { emailCampaignRecipients, emailCampaignSends } from "@/db/schema";
import { env } from "@/env";
import type { Locale } from "@/features/i18n";
import { locales } from "@/features/i18n";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import type { AudienceFilter } from "../audience-filter";
import { CampaignService } from "../backend/campaign.service";
import { CampaignConfirmationCodeService } from "../backend/campaign-confirmation-code.service";
import { hashCampaignContent } from "../body/campaign-content-hash";
import type {
  CampaignAudienceId,
  CampaignId,
  CampaignSendId,
} from "../campaign-identifiers";
import {
  type CampaignRecipientStatus,
  type CampaignStatus,
  campaignRecipientStatuses,
} from "../campaign-states";
import type {
  CampaignConfirmationKeyInvalid,
  CampaignConfirmationRejected,
  CampaignNotFound,
  CampaignReadOnly,
  CampaignRecipientResolutionError,
  CampaignRecipientsOutsideTestDomain,
} from "../errors";
import { ensureCampaignRecipientsAllowed } from "../recipient-domain-guard";

// Stub-local errors carry the tags `CampaignSendService` (#593) uses, so the
// admin actions' tag mapping survives the swap to the real service.

/** A typed test-send address is not a valid email. */
export class CampaignTestRecipientInvalid extends Data.TaggedError(
  "CampaignTestRecipientInvalid"
)<{ readonly email: string }> {}

/** The campaign has content in no locale, so there is nothing to send. */
class CampaignContentMissing extends Data.TaggedError(
  "CampaignContentMissing"
)<{ readonly campaignId: CampaignId }> {}

/** The email provider refused or failed the test send. */
class CampaignEmailDeliveryFailed extends Data.TaggedError(
  "CampaignEmailDeliveryFailed"
)<{ readonly cause: unknown }> {}

/** The campaign has no audience to resolve recipients from. */
class CampaignAudienceMissing extends Data.TaggedError(
  "CampaignAudienceMissing"
)<{ readonly campaignId: CampaignId }> {}

/** The audience resolved to no reachable recipients. */
export class CampaignNoRecipients extends Data.TaggedError(
  "CampaignNoRecipients"
)<{ readonly campaignId: CampaignId }> {}

/** Only a `failed` campaign can retry its undelivered recipients. */
class CampaignNotRetryable extends Data.TaggedError("CampaignNotRetryable")<{
  readonly campaignId: CampaignId;
  readonly status: CampaignStatus;
}> {}

/** The stub has no real send pipeline behind it. */
export class CampaignSendUnavailable extends Data.TaggedError(
  "CampaignSendUnavailable"
)<{ readonly campaignId: CampaignId }> {}

/** What a test send delivered: one email per recipient and content locale. */
type CampaignTestSendReceipt = {
  readonly recipients: readonly string[];
  readonly locales: readonly Locale[];
  readonly codeExpiresAt: Temporal.Instant;
};

/** The send that froze the campaign's recipients and queued delivery. */
type CampaignSendReceipt = {
  readonly sendId: CampaignSendId;
  readonly recipientCount: number;
};

type CampaignRetryReceipt = {
  readonly sendId: CampaignSendId;
  readonly retriedCount: number;
};

type CampaignSendRecipientStatus = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly status: CampaignRecipientStatus;
  readonly statusUpdatedAt: Temporal.Instant;
};

/** The campaign's send with its frozen recipients and delivery progress. */
type CampaignSendStatus = {
  readonly sendId: CampaignSendId;
  readonly createdAt: Temporal.Instant;
  readonly completedAt: Temporal.Instant | null;
  readonly audienceId: CampaignAudienceId | null;
  readonly audienceFilter: AudienceFilter;
  readonly counts: Readonly<Record<CampaignRecipientStatus, number>>;
  /** Sorted by customer ID. */
  readonly recipients: readonly CampaignSendRecipientStatus[];
};

export type CampaignTestSendError =
  | CampaignNotFound
  | CampaignReadOnly
  | CampaignRecipientsOutsideTestDomain
  | CampaignTestRecipientInvalid
  | CampaignContentMissing
  | CampaignEmailDeliveryFailed
  | CampaignConfirmationKeyInvalid
  | EffectDrizzleQueryError;

export type CampaignSendError =
  | CampaignNotFound
  | CampaignReadOnly
  | CampaignConfirmationRejected
  | CampaignAudienceMissing
  | CampaignRecipientResolutionError
  | CampaignRecipientsOutsideTestDomain
  | CampaignNoRecipients
  | CampaignSendUnavailable
  | EffectDrizzleQueryError;

export type CampaignRetryError =
  | CampaignNotFound
  | CampaignNotRetryable
  | CampaignSendUnavailable
  | EffectDrizzleQueryError;

export interface ICampaignSendPipeline {
  /** The env-configured admin inbox that every test send includes. */
  readonly adminInbox: string;
  /**
   * Sends the saved campaign to the admin inbox plus `extraRecipients`
   * (trimmed, lowercased, deduplicated), one `[TEST]` email per content
   * locale, each carrying a fresh confirmation code that supersedes earlier
   * ones.
   */
  readonly testSend: (input: {
    readonly campaignId: CampaignId;
    readonly extraRecipients: readonly string[];
  }) => Effect.Effect<CampaignTestSendReceipt, CampaignTestSendError>;
  /**
   * Resolves recipients, then consumes the typed confirmation code, freezes
   * the recipients, and starts delivery. A failure before the code is
   * consumed leaves the code and the Draft intact.
   */
  readonly send: (input: {
    readonly campaignId: CampaignId;
    readonly confirmationCode: string;
  }) => Effect.Effect<CampaignSendReceipt, CampaignSendError>;
  /** Retries the recipients a `failed` campaign didn't deliver to. */
  readonly retryUndelivered: (input: {
    readonly campaignId: CampaignId;
  }) => Effect.Effect<CampaignRetryReceipt, CampaignRetryError>;
  /** The campaign's send, or none while it is a Draft. */
  readonly getSendStatus: (input: {
    readonly campaignId: CampaignId;
  }) => Effect.Effect<
    Option.Option<CampaignSendStatus>,
    CampaignNotFound | EffectDrizzleQueryError
  >;
}

const normalizeTestRecipients = (
  adminInbox: string,
  extraRecipients: readonly string[]
) => [
  ...new Set(
    [adminInbox, ...extraRecipients].map((email) => email.trim().toLowerCase())
  ),
];

/**
 * The admin UI's seam to the campaign send pipeline. It mirrors
 * `CampaignSendService` from the pipeline ticket (#593), which replaces it.
 * Until then `Stub` issues real confirmation codes and logs them instead of
 * emailing, refuses real sends and retries, and reads send status from the
 * database.
 */
export class CampaignSendPipeline extends Context.Service<
  CampaignSendPipeline,
  ICampaignSendPipeline
>()("@deskohub-workspace/email-campaigns/CampaignSendPipeline") {
  static Stub = Layer.effect(
    this,
    Effect.gen(function* () {
      const campaigns = yield* CampaignService;
      const confirmationCodes = yield* CampaignConfirmationCodeService;
      const { db } = yield* WorkspaceDatabase;
      const adminInbox = "campaigns@deskohub.test";

      return CampaignSendPipeline.of({
        adminInbox,
        testSend: Effect.fn("CampaignSendPipeline.Stub.testSend")(function* ({
          campaignId,
          extraRecipients,
        }) {
          const recipients = normalizeTestRecipients(
            adminInbox,
            extraRecipients
          );
          const invalid = recipients.find(
            (email) => !Schema.is(reservationCustomerEmailSchema)(email)
          );
          if (invalid !== undefined) {
            return yield* new CampaignTestRecipientInvalid({ email: invalid });
          }
          const campaign = yield* campaigns.get(campaignId);
          const contentLocales = locales.filter(
            (locale) => campaign.content[locale] !== undefined
          );
          if (contentLocales.length === 0) {
            return yield* new CampaignContentMissing({ campaignId });
          }
          yield* ensureCampaignRecipientsAllowed({
            deploymentEnvironment: env.VERCEL_ENV,
            emails: recipients,
          });
          const issued = yield* confirmationCodes
            .issue({
              campaignId,
              contentHash: hashCampaignContent({
                purpose: campaign.purpose,
                templateKey: campaign.templateKey,
                locales: campaign.content,
              }),
            })
            .pipe(
              Effect.catchTags({
                PlatformError: Effect.die,
                SqlError: Effect.die,
              })
            );
          yield* Effect.logInfo("Campaign test send stubbed", {
            campaignId,
            recipients: recipients.length,
            confirmationCode: issued.code,
          });
          return {
            recipients,
            locales: contentLocales,
            codeExpiresAt: issued.expiresAt,
          };
        }),
        send: ({ campaignId }) =>
          Effect.fail(new CampaignSendUnavailable({ campaignId })),
        retryUndelivered: ({ campaignId }) =>
          Effect.fail(new CampaignSendUnavailable({ campaignId })),
        getSendStatus: Effect.fn("CampaignSendPipeline.Stub.getSendStatus")(
          function* ({ campaignId }) {
            yield* campaigns.get(campaignId);
            const [send] = yield* db
              .select()
              .from(emailCampaignSends)
              .where(eq(emailCampaignSends.campaignId, campaignId))
              .orderBy(desc(emailCampaignSends.createdAt))
              .limit(1);
            if (send === undefined) return Option.none();
            const recipients = yield* db
              .select({
                dotyposCustomerId: emailCampaignRecipients.dotyposCustomerId,
                locale: emailCampaignRecipients.locale,
                status: emailCampaignRecipients.status,
                statusUpdatedAt: emailCampaignRecipients.statusUpdatedAt,
              })
              .from(emailCampaignRecipients)
              .where(eq(emailCampaignRecipients.sendId, send.id))
              .orderBy(asc(emailCampaignRecipients.dotyposCustomerId));
            const counts = Object.fromEntries(
              campaignRecipientStatuses.map((status) => [
                status,
                recipients.filter((recipient) => recipient.status === status)
                  .length,
              ])
            ) as Record<CampaignRecipientStatus, number>;
            return Option.some({
              sendId: send.id,
              createdAt: send.createdAt,
              completedAt: send.completedAt,
              audienceId: send.audienceId,
              audienceFilter: send.audienceFilter,
              counts,
              recipients,
            });
          }
        ),
      });
    })
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        CampaignService.Live,
        CampaignConfirmationCodeService.Live,
        WorkspaceDatabase.Default
      )
    )
  );

  static Live = this.Stub;
}
