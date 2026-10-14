import "server-only";

import type { DotyposCustomerId } from "@deskohub/dotypos";
import { EmailServiceTag } from "@deskohub/email";
import { NodeCrypto } from "@effect/platform-node";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import {
  Array as Arr,
  Context,
  Effect,
  Layer,
  Option,
  type PlatformError,
  Schema,
} from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  emailCampaignRecipients,
  emailCampaignSends,
  emailCampaigns,
} from "@/db/schema";
import { type Locale, locales } from "@/features/i18n";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import {
  getWorkspaceRuntimeCallbackOrigin,
  type WorkspaceUrlConfigError,
} from "@/shared/backend/config/workspace-url.config";
import { currentInstant } from "@/shared/utils/temporal";
import type { AudienceFilter } from "../audience-filter";
import { hashCampaignContent } from "../body/campaign-content-hash";
import {
  CampaignEmailFooter,
  renderCampaignEmail,
} from "../body/render-campaign-email";
import { campaignTestMessage } from "../campaign-email-message";
import type {
  CampaignAudienceId,
  CampaignId,
  CampaignSendId,
} from "../campaign-identifiers";
import type {
  CampaignRecipientSkipReason,
  CampaignRecipientStatus,
} from "../campaign-states";
import {
  CampaignAudienceMissing,
  type CampaignAudienceNotFound,
  type CampaignConfirmationRejected,
  CampaignContentMissing,
  CampaignDeliveryQueueFailed,
  CampaignEmailDeliveryFailed,
  CampaignNoRecipients,
  CampaignNotFound,
  CampaignNotRetryable,
  CampaignReadOnly,
  type CampaignRecipientResolutionError,
  type CampaignRecipientsOutsideTestDomain,
  CampaignTestRecipientInvalid,
} from "../errors";
import { ensureCampaignRecipientsAllowed } from "../recipient-domain-guard";
import { CampaignService } from "./campaign.service";
import { CampaignAudienceService } from "./campaign-audience.service";
import { CampaignCandidateRepository } from "./campaign-candidate.repository";
import { CampaignConfirmationCodeService } from "./campaign-confirmation-code.service";
import { CampaignEmailConfig } from "./campaign-email.config";
import { CampaignRecipientService } from "./campaign-recipient.service";
import { CampaignSendQueueService } from "./campaign-send-queue.service";

type DatabaseError = EffectDrizzleQueryError | SqlError.SqlError;

type CampaignTestSend = {
  /** The admin inbox first, then the typed addresses. */
  readonly recipients: readonly string[];
  /** The locales with content; every recipient got one email per locale. */
  readonly locales: readonly Locale[];
  readonly codeExpiresAt: Temporal.Instant;
};

type CampaignSendStarted = {
  readonly sendId: CampaignSendId;
  readonly recipientCount: number;
};

type CampaignRetryStarted = {
  readonly sendId: CampaignSendId;
  readonly retriedCount: number;
};

type CampaignRecipientDeliveryStatus = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly status: CampaignRecipientStatus;
  /** Why a `skipped` recipient wasn't mailed; null for every other status. */
  readonly skipReason: CampaignRecipientSkipReason | null;
  readonly statusUpdatedAt: Temporal.Instant;
};

type CampaignSendStatus = {
  readonly sendId: CampaignSendId;
  readonly createdAt: Temporal.Instant;
  readonly completedAt: Temporal.Instant | null;
  readonly audienceId: CampaignAudienceId | null;
  readonly audienceFilter: AudienceFilter;
  readonly counts: Readonly<Record<CampaignRecipientStatus, number>>;
  readonly recipients: readonly CampaignRecipientDeliveryStatus[];
};

export interface ICampaignSendService {
  /** The env-configured inbox every test send includes. */
  readonly adminInbox: string;
  /**
   * Mails every recipient (the admin inbox first) one `[TEST]` email per
   * locale with content. Each carries a new confirmation code bound to the
   * current content, which supersedes earlier codes. Test emails aren't
   * campaign deliveries.
   */
  readonly testSend: (input: {
    readonly campaignId: CampaignId;
    readonly extraRecipients: readonly string[];
  }) => Effect.Effect<
    CampaignTestSend,
    | CampaignNotFound
    | CampaignReadOnly
    | CampaignTestRecipientInvalid
    | CampaignRecipientsOutsideTestDomain
    | CampaignContentMissing
    | CampaignEmailDeliveryFailed
    | WorkspaceUrlConfigError
    | PlatformError.PlatformError
    | DatabaseError
  >;
  /**
   * Resolves the audience, then confirms the code and freezes the
   * recipients with the audience snapshot in one transaction, and queues
   * the delivery. A resolution or guard failure leaves the code and the
   * Draft untouched.
   */
  readonly send: (input: {
    readonly campaignId: CampaignId;
    readonly confirmationCode: string;
  }) => Effect.Effect<
    CampaignSendStarted,
    | CampaignNotFound
    | CampaignReadOnly
    | CampaignConfirmationRejected
    | CampaignAudienceMissing
    | CampaignAudienceNotFound
    | CampaignRecipientResolutionError
    | CampaignRecipientsOutsideTestDomain
    | CampaignNoRecipients
    | CampaignDeliveryQueueFailed
    | DatabaseError
  >;
  /**
   * Queues a new delivery attempt for a Failed campaign's recipients that
   * are still pending or failed. `unconfirmed` recipients may already have
   * the email, so they're mailed again only with `includeUnconfirmed`.
   * Sent, delivered, bounced, complained, and skipped recipients never are.
   */
  readonly retryUndelivered: (input: {
    readonly campaignId: CampaignId;
    readonly includeUnconfirmed?: boolean;
  }) => Effect.Effect<
    CampaignRetryStarted,
    | CampaignNotFound
    | CampaignNotRetryable
    | CampaignDeliveryQueueFailed
    | DatabaseError
  >;
  /** The campaign's send with per-recipient delivery status, if it was sent. */
  readonly getSendStatus: (input: {
    readonly campaignId: CampaignId;
  }) => Effect.Effect<
    Option.Option<CampaignSendStatus>,
    CampaignNotFound | DatabaseError
  >;
}

/** Test sends, the confirmed real send, and its delivery status. */
export class CampaignSendService extends Context.Service<
  CampaignSendService,
  ICampaignSendService
>()("@deskohub-workspace/email-campaigns/CampaignSendService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const campaigns = yield* CampaignService;
      const audiences = yield* CampaignAudienceService;
      const recipientResolution = yield* CampaignRecipientService;
      const confirmation = yield* CampaignConfirmationCodeService;
      const config = yield* CampaignEmailConfig;
      const email = yield* EmailServiceTag;
      const queue = yield* CampaignSendQueueService;

      const getDraft = Effect.fn("CampaignSendService.getDraft")(function* (
        campaignId: CampaignId
      ) {
        const campaign = yield* campaigns.get(campaignId);
        if (campaign.status !== "draft") {
          return yield* new CampaignReadOnly({
            campaignId,
            status: campaign.status,
          });
        }
        return campaign;
      });

      /** The admin inbox first, then each typed address once. */
      const testRecipients = Effect.fn("CampaignSendService.testRecipients")(
        function* (extraRecipients: readonly string[]) {
          const typed = yield* Effect.forEach(extraRecipients, (address) =>
            Schema.decodeUnknownEffect(reservationCustomerEmailSchema)(
              address
            ).pipe(
              Effect.mapError(
                () => new CampaignTestRecipientInvalid({ email: address })
              )
            )
          );
          return Arr.dedupeWith(
            [config.adminInbox, ...typed],
            (a, b) => a.toLowerCase() === b.toLowerCase()
          );
        }
      );

      /** Hands an attempt to the queue; a failure leaves the campaign Failed. */
      const enqueueOrFail = Effect.fn("CampaignSendService.enqueueOrFail")(
        function* (input: {
          readonly campaignId: CampaignId;
          readonly sendId: CampaignSendId;
          readonly deliveryAttempt: number;
        }) {
          yield* queue
            .enqueue({
              sendId: input.sendId,
              deliveryAttempt: input.deliveryAttempt,
            })
            .pipe(
              Effect.catchTag("CampaignSendQueueError", (cause) =>
                currentInstant.pipe(
                  Effect.flatMap((updatedAt) =>
                    db
                      .update(emailCampaigns)
                      .set({ status: "failed", updatedAt })
                      .where(
                        and(
                          eq(emailCampaigns.id, input.campaignId),
                          eq(emailCampaigns.status, "sending")
                        )
                      )
                  ),
                  Effect.andThen(
                    Effect.fail(
                      new CampaignDeliveryQueueFailed({
                        campaignId: input.campaignId,
                        cause,
                      })
                    )
                  )
                )
              )
            );
        }
      );

      type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

      /**
       * Under the campaign row lock, moves a Failed campaign back to Sending
       * and puts its undelivered recipients into a new delivery attempt.
       */
      const startRetry = Effect.fn("CampaignSendService.startRetry")(function* (
        tx: Transaction,
        input: {
          readonly campaignId: CampaignId;
          readonly includeUnconfirmed: boolean;
          readonly now: Temporal.Instant;
        }
      ) {
        const { campaignId, now } = input;
        const [campaign] = yield* tx
          .select({ status: emailCampaigns.status })
          .from(emailCampaigns)
          .where(eq(emailCampaigns.id, campaignId))
          .for("update");
        if (!campaign) {
          return yield* new CampaignNotFound({ campaignId });
        }
        if (campaign.status !== "failed") {
          return yield* new CampaignNotRetryable({
            campaignId,
            status: campaign.status,
          });
        }
        const [send] = yield* tx
          .update(emailCampaignSends)
          .set({
            deliveryAttempt: sql`${emailCampaignSends.deliveryAttempt} + 1`,
          })
          .where(eq(emailCampaignSends.campaignId, campaignId))
          .returning({
            sendId: emailCampaignSends.id,
            deliveryAttempt: emailCampaignSends.deliveryAttempt,
          });
        const retried = yield* tx
          .update(emailCampaignRecipients)
          .set({
            deliveryAttempt: send!.deliveryAttempt,
            status: "pending",
            statusUpdatedAt: now,
          })
          .where(
            and(
              eq(emailCampaignRecipients.sendId, send!.sendId),
              inArray(
                emailCampaignRecipients.status,
                input.includeUnconfirmed
                  ? ["pending", "failed", "unconfirmed"]
                  : ["pending", "failed"]
              )
            )
          )
          .returning({
            dotyposCustomerId: emailCampaignRecipients.dotyposCustomerId,
          });
        yield* tx
          .update(emailCampaigns)
          .set({ status: "sending", updatedAt: now })
          .where(eq(emailCampaigns.id, campaignId));
        return { ...send!, retriedCount: retried.length };
      });

      return {
        adminInbox: config.adminInbox,

        testSend: Effect.fn("CampaignSendService.testSend")(function* ({
          campaignId,
          extraRecipients,
        }) {
          const campaign = yield* getDraft(campaignId);
          const recipients = yield* testRecipients(extraRecipients);
          yield* ensureCampaignRecipientsAllowed({
            deploymentEnvironment: config.deploymentEnvironment,
            emails: recipients,
          });
          const contentLocales = locales.filter(
            (locale) => campaign.content[locale] !== undefined
          );
          if (contentLocales.length === 0) {
            return yield* new CampaignContentMissing({ campaignId });
          }

          const issued = yield* confirmation.issue({
            campaignId,
            contentHash: hashCampaignContent({
              purpose: campaign.purpose,
              templateKey: campaign.templateKey,
              locales: campaign.content,
            }),
          });
          if (config.deploymentEnvironment !== "production") {
            // Preview inboxes are Console-only, so the code is read here.
            yield* Effect.logInfo("Campaign test send confirmation code", {
              campaignId,
              confirmationCode: issued.code,
            });
          }

          const preferencesPreviewUrl = new URL(
            "/account/legal",
            yield* getWorkspaceRuntimeCallbackOrigin
          ).href;
          const emails = yield* Effect.forEach(contentLocales, (locale) =>
            renderCampaignEmail({
              templateKey: campaign.templateKey,
              locale,
              content: campaign.content[locale]!,
              footer:
                campaign.purpose === "marketing"
                  ? CampaignEmailFooter.Marketing({
                      marketingPreferencesUrl: preferencesPreviewUrl,
                    })
                  : CampaignEmailFooter.Operational(),
              confirmationCode: issued.code,
            })
          ).pipe(
            Effect.mapError(
              (cause) => new CampaignEmailDeliveryFailed({ cause })
            )
          );
          yield* Effect.forEach(recipients, (to) =>
            Effect.forEach(emails, (rendered) =>
              email.send(
                campaignTestMessage({
                  sender: config,
                  to,
                  email: rendered,
                  deploymentEnvironment: config.deploymentEnvironment,
                })
              )
            )
          ).pipe(
            Effect.mapError(
              (cause) => new CampaignEmailDeliveryFailed({ cause })
            )
          );

          return {
            recipients,
            locales: contentLocales,
            codeExpiresAt: issued.expiresAt,
          } satisfies CampaignTestSend;
        }),

        send: Effect.fn("CampaignSendService.send")(function* ({
          campaignId,
          confirmationCode,
        }) {
          const campaign = yield* getDraft(campaignId);
          if (campaign.audienceId === null) {
            return yield* new CampaignAudienceMissing({ campaignId });
          }
          const audience = yield* audiences.get(campaign.audienceId);
          const { recipients } = yield* recipientResolution.resolve({
            purpose: campaign.purpose,
            filter: audience.filter,
          });
          if (recipients.length === 0) {
            return yield* new CampaignNoRecipients({ campaignId });
          }
          yield* ensureCampaignRecipientsAllowed({
            deploymentEnvironment: config.deploymentEnvironment,
            emails: recipients.map((recipient) => recipient.email),
          });

          const { sendId } = yield* confirmation.confirm({
            campaignId,
            code: confirmationCode,
            send: {
              audienceId: audience.id,
              audienceFilter: audience.filter,
              recipients: recipients.map(({ dotyposCustomerId, locale }) => ({
                dotyposCustomerId,
                locale,
              })),
            },
          });
          yield* enqueueOrFail({ campaignId, sendId, deliveryAttempt: 1 });

          return {
            sendId,
            recipientCount: recipients.length,
          } satisfies CampaignSendStarted;
        }),

        retryUndelivered: Effect.fn("CampaignSendService.retryUndelivered")(
          function* ({ campaignId, includeUnconfirmed = false }) {
            const now = yield* currentInstant;
            const retry = yield* db.transaction((tx) =>
              startRetry(tx, { campaignId, includeUnconfirmed, now })
            );
            yield* enqueueOrFail({
              campaignId,
              sendId: retry.sendId,
              deliveryAttempt: retry.deliveryAttempt,
            });
            return {
              sendId: retry.sendId,
              retriedCount: retry.retriedCount,
            } satisfies CampaignRetryStarted;
          }
        ),

        getSendStatus: Effect.fn("CampaignSendService.getSendStatus")(
          function* ({ campaignId }) {
            yield* campaigns.get(campaignId);
            const [send] = yield* db
              .select()
              .from(emailCampaignSends)
              .where(eq(emailCampaignSends.campaignId, campaignId));
            if (!send) return Option.none();
            const recipients = yield* db
              .select({
                dotyposCustomerId: emailCampaignRecipients.dotyposCustomerId,
                locale: emailCampaignRecipients.locale,
                status: emailCampaignRecipients.status,
                skipReason: emailCampaignRecipients.skipReason,
                statusUpdatedAt: emailCampaignRecipients.statusUpdatedAt,
              })
              .from(emailCampaignRecipients)
              .where(eq(emailCampaignRecipients.sendId, send.id))
              .orderBy(asc(emailCampaignRecipients.dotyposCustomerId));
            const counts = {
              pending: 0,
              sent: 0,
              delivered: 0,
              bounced: 0,
              complained: 0,
              failed: 0,
              unconfirmed: 0,
              skipped: 0,
            } satisfies Record<CampaignRecipientStatus, number>;
            for (const recipient of recipients) counts[recipient.status] += 1;
            return Option.some({
              sendId: send.id,
              createdAt: send.createdAt,
              completedAt: send.completedAt,
              audienceId: send.audienceId,
              audienceFilter: send.audienceFilter,
              counts,
              recipients,
            } satisfies CampaignSendStatus);
          }
        ),
      } satisfies ICampaignSendService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CampaignService.Default,
        CampaignAudienceService.Default,
        CampaignRecipientService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              CampaignCandidateRepository.Default,
              WorkspaceDotyposLayer
            )
          )
        ),
        CampaignConfirmationCodeService.Default.pipe(
          Layer.provide(NodeCrypto.layer)
        ),
        CampaignEmailConfig.Default,
        CampaignSendQueueService.Default,
        EmailServiceTag.RecipientRouted.pipe(Layer.provide(EmailConfigLayer))
      )
    ),
    Layer.provide(WorkspaceDatabase.Default)
  );
}
