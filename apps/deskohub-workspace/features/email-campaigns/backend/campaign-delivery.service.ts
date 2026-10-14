import "server-only";

import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposService,
} from "@deskohub/dotypos";
import { EmailServiceTag } from "@deskohub/email";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Duration, Effect, Layer, Option, Result } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type CampaignRow,
  customerMarketingConsents,
  emailCampaignRecipients,
  emailCampaignSends,
  emailCampaigns,
} from "@/db/schema";
import { type Locale, locales } from "@/features/i18n";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { currentInstant } from "@/shared/utils/temporal";
import type { CampaignLocaleContent } from "../body/campaign-content";
import {
  CampaignEmailFooter,
  renderCampaignEmail,
} from "../body/render-campaign-email";
import {
  campaignDeliveryBatchIdempotencyKey,
  chunkCampaignDeliveryBatches,
} from "../campaign-delivery-batches";
import { campaignDeliveryMessage } from "../campaign-email-message";
import type { CampaignSendId } from "../campaign-identifiers";
import type { CampaignRecipientStatus } from "../campaign-states";
import { campaignFallbackLocale } from "../recipient-locale";
import { CampaignEmailConfig } from "./campaign-email.config";
import { reachableCampaignEmail } from "./campaign-recipient.service";
import type { CampaignDeliveryAttempt } from "./campaign-send-queue.service";
import { CampaignUnsubscribeService } from "./campaign-unsubscribe.service";

/**
 * A new batch starts only this long into an attempt. The slowest batch (a
 * Dotypos read plus a provider request with every retry) still finishes
 * inside the queue consumer's 300-second limit.
 */
const deliveryStartBudget = Duration.seconds(120);

/**
 * The attempt ran out of time with batches still pending. Failing the queue
 * message redelivers it, and the next run resumes at the first pending
 * batch.
 */
class CampaignDeliveryIncomplete extends Data.TaggedError(
  "CampaignDeliveryIncomplete"
)<{
  readonly sendId: CampaignSendId;
  readonly deliveryAttempt: number;
}> {}

/**
 * What delivering an attempt left the campaign as. `stale` is a message for
 * an attempt that is no longer current or a campaign that is no longer
 * Sending.
 */
type CampaignDeliveryOutcome = "sent" | "failed" | "stale";

export interface ICampaignDeliveryService {
  /**
   * Delivers one attempt of a frozen send in provider batches, then marks
   * the campaign Sent, or Failed when any recipient wasn't delivered. Each
   * recipient's email (and, for marketing, consent) is re-read first; one
   * who lost it is `skipped`.
   */
  readonly deliverAttempt: (
    attempt: CampaignDeliveryAttempt
  ) => Effect.Effect<
    CampaignDeliveryOutcome,
    CampaignDeliveryIncomplete | EffectDrizzleQueryError | SqlError.SqlError
  >;
}

type FrozenRecipient = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly status: CampaignRecipientStatus;
};

type DeliveryBatch = CampaignDeliveryAttempt & {
  readonly campaign: CampaignRow;
  readonly batchIndex: number;
  readonly recipients: readonly FrozenRecipient[];
};

/** Delivers frozen campaign sends; the campaign send queue consumer runs it. */
export class CampaignDeliveryService extends Context.Service<
  CampaignDeliveryService,
  ICampaignDeliveryService
>()("@deskohub-workspace/email-campaigns/CampaignDeliveryService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const dotypos = yield* DotyposService;
      const email = yield* EmailServiceTag;
      const config = yield* CampaignEmailConfig;
      const unsubscribe = yield* CampaignUnsubscribeService;

      const findCurrentAttempt = (attempt: CampaignDeliveryAttempt) =>
        db
          .select({ campaign: emailCampaigns })
          .from(emailCampaignSends)
          .innerJoin(
            emailCampaigns,
            eq(emailCampaigns.id, emailCampaignSends.campaignId)
          )
          .where(
            and(
              eq(emailCampaignSends.id, attempt.sendId),
              eq(emailCampaignSends.deliveryAttempt, attempt.deliveryAttempt),
              eq(emailCampaigns.status, "sending")
            )
          )
          .pipe(
            Effect.map(([row]) =>
              Option.fromNullishOr(row).pipe(Option.map((r) => r.campaign))
            )
          );

      const listAttemptRecipients = (attempt: CampaignDeliveryAttempt) =>
        db
          .select({
            dotyposCustomerId: emailCampaignRecipients.dotyposCustomerId,
            locale: emailCampaignRecipients.locale,
            status: emailCampaignRecipients.status,
          })
          .from(emailCampaignRecipients)
          .where(
            and(
              eq(emailCampaignRecipients.sendId, attempt.sendId),
              eq(
                emailCampaignRecipients.deliveryAttempt,
                attempt.deliveryAttempt
              )
            )
          )
          .orderBy(emailCampaignRecipients.dotyposCustomerId);

      /** Moves still-pending recipients to `status`. */
      const markPending = Effect.fn("CampaignDeliveryService.markPending")(
        function* (input: {
          readonly sendId: CampaignSendId;
          readonly customerIds: readonly DotyposCustomerId[];
          readonly status: "skipped" | "failed";
        }) {
          if (input.customerIds.length === 0) return;
          yield* db
            .update(emailCampaignRecipients)
            .set({
              status: input.status,
              statusUpdatedAt: yield* currentInstant,
            })
            .where(
              and(
                eq(emailCampaignRecipients.sendId, input.sendId),
                inArray(
                  emailCampaignRecipients.dotyposCustomerId,
                  input.customerIds
                ),
                eq(emailCampaignRecipients.status, "pending")
              )
            );
        }
      );

      /**
       * Records the provider's message IDs. A webhook that arrived first may
       * already have moved a recipient past `sent`, so only `pending` moves.
       */
      const recordSent = Effect.fn("CampaignDeliveryService.recordSent")(
        function* (input: {
          readonly sendId: CampaignSendId;
          readonly sent: readonly {
            readonly dotyposCustomerId: DotyposCustomerId;
            readonly providerMessageId: string;
          }[];
        }) {
          const statusUpdatedAt = yield* currentInstant;
          yield* db.transaction((tx) =>
            Effect.forEach(input.sent, (recipient) =>
              tx
                .update(emailCampaignRecipients)
                .set({
                  providerMessageId: recipient.providerMessageId,
                  status: sql`case when ${emailCampaignRecipients.status} = 'pending' then 'sent' else ${emailCampaignRecipients.status} end`,
                  statusUpdatedAt,
                })
                .where(
                  and(
                    eq(emailCampaignRecipients.sendId, input.sendId),
                    eq(
                      emailCampaignRecipients.dotyposCustomerId,
                      recipient.dotyposCustomerId
                    )
                  )
                )
            )
          );
        }
      );

      const loadActiveConsents = (customerIds: readonly DotyposCustomerId[]) =>
        db
          .select({
            dotyposCustomerId: customerMarketingConsents.dotyposCustomerId,
          })
          .from(customerMarketingConsents)
          .where(
            and(
              inArray(customerMarketingConsents.dotyposCustomerId, [
                ...customerIds,
              ]),
              isNull(customerMarketingConsents.withdrawnAt)
            )
          )
          .pipe(
            Effect.map(
              (rows) => new Set(rows.map((row) => row.dotyposCustomerId))
            )
          );

      /**
       * Re-reads each recipient's email and, for marketing, consent. Only
       * recipients who still qualify are mailed.
       */
      const selectReachable = Effect.fn(
        "CampaignDeliveryService.selectReachable"
      )(function* (batch: DeliveryBatch) {
        const customerIds = batch.recipients.map(
          ({ dotyposCustomerId }) => dotyposCustomerId
        );
        const profiles = yield* dotypos.getCustomers({ ids: customerIds });
        const profilesById = new Map(
          profiles.flatMap((profile: DotyposCustomer) =>
            profile.id === undefined ? [] : [[profile.id, profile] as const]
          )
        );
        const consenting =
          batch.campaign.purpose === "marketing"
            ? yield* loadActiveConsents(customerIds)
            : new Set(customerIds);
        return batch.recipients.flatMap((recipient) =>
          consenting.has(recipient.dotyposCustomerId)
            ? Result.match(
                reachableCampaignEmail(
                  Option.fromNullishOr(
                    profilesById.get(recipient.dotyposCustomerId)
                  )
                ),
                {
                  onFailure: () => [],
                  onSuccess: (to) => [{ ...recipient, to }],
                }
              )
            : []
        );
      });

      const renderMessage = Effect.fn("CampaignDeliveryService.renderMessage")(
        function* (input: {
          readonly batch: DeliveryBatch;
          readonly recipient: FrozenRecipient & { readonly to: string };
        }) {
          const { campaign, sendId } = input.batch;
          const recipient = {
            sendId,
            dotyposCustomerId: input.recipient.dotyposCustomerId,
          };
          const unsubscribeUrl =
            campaign.purpose === "marketing"
              ? Option.some(yield* unsubscribe.unsubscribeUrl(recipient))
              : Option.none<string>();
          const { locale, content } = campaignContentFor(
            campaign,
            input.recipient.locale
          );
          const rendered = yield* renderCampaignEmail({
            templateKey: campaign.templateKey,
            locale,
            content,
            footer: Option.match(unsubscribeUrl, {
              onNone: () => CampaignEmailFooter.Operational(),
              onSome: (marketingPreferencesUrl) =>
                CampaignEmailFooter.Marketing({ marketingPreferencesUrl }),
            }),
          });
          return campaignDeliveryMessage({
            sender: config,
            to: input.recipient.to,
            email: rendered,
            unsubscribeUrl,
            recipient,
            deploymentEnvironment: config.deploymentEnvironment,
          });
        }
      );

      /**
       * Sends one batch under its idempotency key. A provider or Dotypos
       * failure that outlasts its retries fails the batch's recipients, so
       * the campaign ends Failed and the admin can retry them.
       */
      const deliverBatch = Effect.fn("CampaignDeliveryService.deliverBatch")(
        function* (batch: DeliveryBatch) {
          const reachable = yield* selectReachable(batch);
          const reachableIds = new Set(
            reachable.map(({ dotyposCustomerId }) => dotyposCustomerId)
          );
          yield* markPending({
            sendId: batch.sendId,
            status: "skipped",
            customerIds: batch.recipients
              .map(({ dotyposCustomerId }) => dotyposCustomerId)
              .filter((id) => !reachableIds.has(id)),
          });
          if (reachable.length === 0) return;

          const messages = yield* Effect.forEach(reachable, (recipient) =>
            renderMessage({ batch, recipient })
          );
          const results = yield* email.sendBatch(messages, {
            idempotencyKey: campaignDeliveryBatchIdempotencyKey(batch),
          });
          yield* recordSent({
            sendId: batch.sendId,
            sent: reachable.map((recipient, index) => ({
              dotyposCustomerId: recipient.dotyposCustomerId,
              providerMessageId: results[index]!.id,
            })),
          });
        },
        (effect, batch) =>
          effect.pipe(
            Effect.catchTags({
              EmailServiceError: (cause) => failBatch(batch, cause),
              NetworkError: (cause) => failBatch(batch, cause),
              ValidationError: (cause) => failBatch(batch, cause),
              ExternalAPIError: (cause) => failBatch(batch, cause),
              WorkspaceUrlConfigError: (cause) => failBatch(batch, cause),
            }),
            Effect.annotateLogs({
              sendId: batch.sendId,
              deliveryAttempt: batch.deliveryAttempt,
              batchIndex: batch.batchIndex,
            })
          )
      );

      const failBatch = (
        batch: DeliveryBatch,
        cause: { readonly _tag: string }
      ) =>
        Effect.logError("Campaign delivery batch failed", {
          errorType: cause._tag,
        }).pipe(
          Effect.andThen(
            markPending({
              sendId: batch.sendId,
              status: "failed",
              customerIds: batch.recipients.map(
                ({ dotyposCustomerId }) => dotyposCustomerId
              ),
            })
          )
        );

      /**
       * Delivers a batch's pending recipients unless the attempt is past its
       * start budget. A redelivered message skips the batches already done.
       */
      const deliverPendingBatch = Effect.fn(
        "CampaignDeliveryService.deliverPendingBatch"
      )(function* (
        input: DeliveryBatch & { readonly startedAt: Temporal.Instant }
      ) {
        const { startedAt, ...batch } = input;
        const pending = batch.recipients.filter(
          ({ status }) => status === "pending"
        );
        if (pending.length === 0) return;
        const now = yield* currentInstant;
        if (
          now.epochMilliseconds - startedAt.epochMilliseconds >
          Duration.toMillis(deliveryStartBudget)
        ) {
          return yield* new CampaignDeliveryIncomplete({
            sendId: batch.sendId,
            deliveryAttempt: batch.deliveryAttempt,
          });
        }
        yield* deliverBatch({ ...batch, recipients: pending });
      });

      /** Marks the campaign Sent, or Failed when anyone wasn't delivered. */
      const settle = Effect.fn("CampaignDeliveryService.settle")(function* (
        input: CampaignDeliveryAttempt & { readonly campaign: CampaignRow }
      ) {
        const [undelivered] = yield* db
          .select({ count: sql<number>`count(*)::int` })
          .from(emailCampaignRecipients)
          .where(
            and(
              eq(emailCampaignRecipients.sendId, input.sendId),
              inArray(emailCampaignRecipients.status, ["pending", "failed"])
            )
          );
        const status = (undelivered?.count ?? 0) > 0 ? "failed" : "sent";
        const now = yield* currentInstant;
        yield* db.transaction((tx) =>
          tx
            .update(emailCampaigns)
            .set({ status, updatedAt: now })
            .where(
              and(
                eq(emailCampaigns.id, input.campaign.id),
                eq(emailCampaigns.status, "sending")
              )
            )
            .pipe(
              Effect.andThen(
                tx
                  .update(emailCampaignSends)
                  .set({ completedAt: status === "sent" ? now : null })
                  .where(eq(emailCampaignSends.id, input.sendId))
              )
            )
        );
        return status;
      });

      return {
        deliverAttempt: Effect.fn("CampaignDeliveryService.deliverAttempt")(
          function* (attempt) {
            const startedAt = yield* currentInstant;
            const campaign = yield* findCurrentAttempt(attempt);
            if (Option.isNone(campaign)) {
              yield* Effect.logInfo(
                "Campaign delivery skipped: the attempt is no longer current"
              );
              return "stale" as const;
            }

            const batches = chunkCampaignDeliveryBatches(
              yield* listAttemptRecipients(attempt)
            );
            yield* Effect.forEach(batches, (recipients, batchIndex) =>
              deliverPendingBatch({
                ...attempt,
                campaign: campaign.value,
                batchIndex,
                recipients,
                startedAt,
              })
            );

            return yield* settle({ ...attempt, campaign: campaign.value });
          },
          (effect, attempt) =>
            effect.pipe(
              Effect.annotateLogs({
                sendId: attempt.sendId,
                deliveryAttempt: attempt.deliveryAttempt,
              })
            )
        ),
      } satisfies ICampaignDeliveryService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CampaignEmailConfig.Default,
        CampaignUnsubscribeService.Live,
        WorkspaceDotyposLayer,
        EmailServiceTag.RecipientRouted.pipe(Layer.provide(EmailConfigLayer))
      )
    ),
    Layer.provide(WorkspaceDatabase.Default)
  );
}

/**
 * The content a recipient reads: their locale's, else Czech, else the
 * campaign's only locale (an audience restricted to it).
 */
const campaignContentFor = (
  campaign: CampaignRow,
  locale: Locale
): { readonly locale: Locale; readonly content: CampaignLocaleContent } => {
  const candidates = [locale, campaignFallbackLocale, ...localesOf(campaign)];
  const chosen = candidates.find((candidate) => campaign.content[candidate]);
  return { locale: chosen!, content: campaign.content[chosen!]! };
};

const localesOf = (campaign: CampaignRow) =>
  locales.filter((locale) => campaign.content[locale] !== undefined);
