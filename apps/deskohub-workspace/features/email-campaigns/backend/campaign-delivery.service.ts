import "server-only";

import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposService,
} from "@deskohub/dotypos";
import { type EmailMessage, EmailServiceTag } from "@deskohub/email";
import { isTestEmailRecipient } from "@deskohub/email/backend/test-recipients";
import { and, asc, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Duration, Effect, Layer, Option, Result } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type CampaignRow,
  customerMarketingConsents,
  emailCampaignDeliveryBatches,
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
  campaignDeliveryBatchReplayWindow,
  campaignDeliveryBatchSize,
  campaignDeliveryPayloadHash,
} from "../campaign-delivery-batches";
import { campaignDeliveryMessage } from "../campaign-email-message";
import type { CampaignSendId } from "../campaign-identifiers";
import type { CampaignRecipientSkipReason } from "../campaign-states";
import { campaignFallbackLocale } from "../recipient-locale";
import { CampaignEmailConfig } from "./campaign-email.config";
import { reachableCampaignEmail } from "./campaign-recipient.service";
import type { CampaignDeliveryAttempt } from "./campaign-send-queue.service";
import { CampaignUnsubscribeService } from "./campaign-unsubscribe.service";

/**
 * A new batch starts only this long into a run. Every batch is persisted
 * before its provider request, so a run cut short mid-request loses nothing:
 * the redelivered message replays that batch under its key.
 */
const deliveryStartBudget = Duration.seconds(120);

/**
 * A run gives up this long after it starts, inside the queue consumer's
 * 300-second limit. Its slowest batch can outlast the remaining time: a
 * Dotypos read with every retry takes up to about 121 seconds, and a provider
 * request with every retry about 48 seconds in production or 128 seconds
 * elsewhere (where requests wait 30 seconds).
 */
const deliveryRunDeadline = Duration.seconds(270);

/**
 * The attempt has batches left or a batch whose outcome is unknown. Failing
 * the queue message redelivers it, and the next run resumes the attempt.
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
   * who lost it, or who is outside the email test domain outside
   * production, is `skipped`. A batch whose outcome is unknown is replayed
   * with its identical payload under its key while the key lasts, and its
   * recipients become `unconfirmed` once it can't be.
   */
  readonly deliverAttempt: (
    attempt: CampaignDeliveryAttempt
  ) => Effect.Effect<
    CampaignDeliveryOutcome,
    CampaignDeliveryIncomplete | EffectDrizzleQueryError | SqlError.SqlError
  >;
}

type AttemptContext = CampaignDeliveryAttempt & {
  readonly campaign: CampaignRow;
  readonly startedAt: Temporal.Instant;
};

type BatchRecipient = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
};

type ReachableRecipient = BatchRecipient & { readonly to: string };

/** A persisted batch: its key's identity and its recipients in order. */
type DeliveryBatch = CampaignDeliveryAttempt & {
  readonly batchIndex: number;
  readonly dotyposCustomerIds: readonly DotyposCustomerId[];
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

      const inAttempt = (attempt: CampaignDeliveryAttempt) =>
        and(
          eq(emailCampaignRecipients.sendId, attempt.sendId),
          eq(emailCampaignRecipients.deliveryAttempt, attempt.deliveryAttempt)
        );

      /** The attempt's batches with an unknown outcome, in request order. */
      const listRequestedBatches = (attempt: CampaignDeliveryAttempt) =>
        db
          .select({
            batchIndex: emailCampaignDeliveryBatches.batchIndex,
            dotyposCustomerIds: emailCampaignDeliveryBatches.dotyposCustomerIds,
            payloadHash: emailCampaignDeliveryBatches.payloadHash,
            requestedAt: emailCampaignDeliveryBatches.requestedAt,
          })
          .from(emailCampaignDeliveryBatches)
          .where(
            and(
              eq(emailCampaignDeliveryBatches.sendId, attempt.sendId),
              eq(
                emailCampaignDeliveryBatches.deliveryAttempt,
                attempt.deliveryAttempt
              ),
              eq(emailCampaignDeliveryBatches.status, "requested")
            )
          )
          .orderBy(asc(emailCampaignDeliveryBatches.batchIndex));

      /** No batch of the attempt carries the recipient yet. */
      const unbatched = notExists(
        db
          .select({ batchIndex: emailCampaignDeliveryBatches.batchIndex })
          .from(emailCampaignDeliveryBatches)
          .where(
            and(
              eq(
                emailCampaignDeliveryBatches.sendId,
                emailCampaignRecipients.sendId
              ),
              eq(
                emailCampaignDeliveryBatches.deliveryAttempt,
                emailCampaignRecipients.deliveryAttempt
              ),
              sql`${emailCampaignRecipients.dotyposCustomerId} = any(${emailCampaignDeliveryBatches.dotyposCustomerIds})`
            )
          )
      );

      /** The next pending recipients no batch carries, in customer ID order. */
      const nextUnbatchedRecipients = (attempt: CampaignDeliveryAttempt) =>
        db
          .select({
            dotyposCustomerId: emailCampaignRecipients.dotyposCustomerId,
            locale: emailCampaignRecipients.locale,
          })
          .from(emailCampaignRecipients)
          .where(
            and(
              inAttempt(attempt),
              eq(emailCampaignRecipients.status, "pending"),
              unbatched
            )
          )
          .orderBy(asc(emailCampaignRecipients.dotyposCustomerId))
          .limit(campaignDeliveryBatchSize);

      /** A persisted batch's recipients, in the batch's message order. */
      const loadBatchRecipients = Effect.fn(
        "CampaignDeliveryService.loadBatchRecipients"
      )(function* (batch: DeliveryBatch) {
        const rows = yield* db
          .select({
            dotyposCustomerId: emailCampaignRecipients.dotyposCustomerId,
            locale: emailCampaignRecipients.locale,
          })
          .from(emailCampaignRecipients)
          .where(
            and(
              eq(emailCampaignRecipients.sendId, batch.sendId),
              inArray(emailCampaignRecipients.dotyposCustomerId, [
                ...batch.dotyposCustomerIds,
              ])
            )
          );
        const byId = new Map(rows.map((row) => [row.dotyposCustomerId, row]));
        return batch.dotyposCustomerIds.flatMap((id) => {
          const row = byId.get(id);
          return row ? [row] : [];
        });
      });

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
       * Re-reads each recipient's email and, for marketing, consent, then
       * applies the test-domain guard outside production. Each recipient
       * gets the address to mail or why they're skipped; nothing reaches the
       * provider without passing here.
       */
      const hydrate = Effect.fn("CampaignDeliveryService.hydrate")(function* (
        context: AttemptContext,
        recipients: readonly BatchRecipient[]
      ) {
        const customerIds = recipients.map(
          ({ dotyposCustomerId }) => dotyposCustomerId
        );
        const profiles = yield* dotypos.getCustomers({ ids: customerIds });
        const profilesById = new Map(
          profiles.flatMap((profile: DotyposCustomer) =>
            profile.id === undefined ? [] : [[profile.id, profile] as const]
          )
        );
        const consenting =
          context.campaign.purpose === "marketing"
            ? yield* loadActiveConsents(customerIds)
            : new Set(customerIds);
        return recipients.map(
          (
            recipient
          ): Result.Result<ReachableRecipient, CampaignRecipientSkipReason> => {
            if (!consenting.has(recipient.dotyposCustomerId)) {
              return Result.fail("consent-withdrawn");
            }
            return reachableCampaignEmail(
              Option.fromNullishOr(
                profilesById.get(recipient.dotyposCustomerId)
              )
            ).pipe(
              Result.flatMap((to) =>
                config.deploymentEnvironment === "production" ||
                isTestEmailRecipient(to)
                  ? Result.succeed({ ...recipient, to })
                  : Result.fail("outside-test-domain" as const)
              )
            );
          }
        );
      });

      const renderMessage = Effect.fn("CampaignDeliveryService.renderMessage")(
        function* (context: AttemptContext, recipient: ReachableRecipient) {
          const { campaign, sendId } = context;
          const recipientTags = {
            sendId,
            dotyposCustomerId: recipient.dotyposCustomerId,
          };
          const unsubscribeUrl =
            campaign.purpose === "marketing"
              ? Option.some(yield* unsubscribe.unsubscribeUrl(recipientTags))
              : Option.none<string>();
          const { locale, content } = campaignContentFor(
            campaign,
            recipient.locale
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
            to: recipient.to,
            email: rendered,
            unsubscribeUrl,
            recipient: recipientTags,
            deploymentEnvironment: config.deploymentEnvironment,
          });
        }
      );

      const renderMessages = (
        context: AttemptContext,
        recipients: readonly ReachableRecipient[]
      ) =>
        Effect.forEach(recipients, (recipient) =>
          renderMessage(context, recipient)
        );

      /** Moves the given recipients that are still `pending` to `status`. */
      const settlePendingRecipients = (
        tx: Pick<typeof db, "update">,
        input: {
          readonly sendId: CampaignSendId;
          readonly customerIds: readonly DotyposCustomerId[];
          readonly status: "failed" | "unconfirmed";
          readonly now: Temporal.Instant;
        }
      ) =>
        tx
          .update(emailCampaignRecipients)
          .set({ status: input.status, statusUpdatedAt: input.now })
          .where(
            and(
              eq(emailCampaignRecipients.sendId, input.sendId),
              inArray(emailCampaignRecipients.dotyposCustomerId, [
                ...input.customerIds,
              ]),
              eq(emailCampaignRecipients.status, "pending")
            )
          );

      const markSkipped = (
        tx: Pick<typeof db, "update">,
        input: {
          readonly sendId: CampaignSendId;
          readonly skipped: readonly {
            readonly dotyposCustomerId: DotyposCustomerId;
            readonly reason: CampaignRecipientSkipReason;
          }[];
          readonly now: Temporal.Instant;
        }
      ) =>
        Effect.forEach(input.skipped, ({ dotyposCustomerId, reason }) =>
          tx
            .update(emailCampaignRecipients)
            .set({
              status: "skipped",
              skipReason: reason,
              statusUpdatedAt: input.now,
            })
            .where(
              and(
                eq(emailCampaignRecipients.sendId, input.sendId),
                eq(
                  emailCampaignRecipients.dotyposCustomerId,
                  dotyposCustomerId
                ),
                eq(emailCampaignRecipients.status, "pending")
              )
            )
        );

      /**
       * Settles a batch's provider answer, or gives up on it as
       * `unconfirmed`, together with its still-pending recipients.
       */
      const settleBatch = Effect.fn("CampaignDeliveryService.settleBatch")(
        function* (
          batch: DeliveryBatch,
          outcome:
            | { readonly status: "accepted"; readonly ids: readonly string[] }
            | { readonly status: "rejected" | "unconfirmed" }
        ) {
          const now = yield* currentInstant;
          yield* db.transaction(
            Effect.fn(function* (tx) {
              yield* tx
                .update(emailCampaignDeliveryBatches)
                .set({ status: outcome.status, settledAt: now })
                .where(
                  and(
                    eq(emailCampaignDeliveryBatches.sendId, batch.sendId),
                    eq(
                      emailCampaignDeliveryBatches.deliveryAttempt,
                      batch.deliveryAttempt
                    ),
                    eq(
                      emailCampaignDeliveryBatches.batchIndex,
                      batch.batchIndex
                    )
                  )
                );
              if (outcome.status !== "accepted") {
                yield* settlePendingRecipients(tx, {
                  sendId: batch.sendId,
                  customerIds: batch.dotyposCustomerIds,
                  status:
                    outcome.status === "rejected" ? "failed" : "unconfirmed",
                  now,
                });
                return;
              }
              // A webhook that arrived first may already have moved a
              // recipient past `sent`, so only `pending` moves.
              yield* Effect.forEach(
                batch.dotyposCustomerIds,
                (dotyposCustomerId, index) =>
                  tx
                    .update(emailCampaignRecipients)
                    .set({
                      providerMessageId: outcome.ids[index]!,
                      status: sql`case when ${emailCampaignRecipients.status} = 'pending' then 'sent' else ${emailCampaignRecipients.status} end`,
                      statusUpdatedAt: now,
                    })
                    .where(
                      and(
                        eq(emailCampaignRecipients.sendId, batch.sendId),
                        eq(
                          emailCampaignRecipients.dotyposCustomerId,
                          dotyposCustomerId
                        )
                      )
                    )
              );
            })
          );
        }
      );

      /**
       * Sends a persisted batch under its key. A refusal of its first
       * request fails its recipients, so a retry can't mail them twice. An
       * unknown outcome leaves the batch `requested` and ends the run, so the
       * redelivered message replays it. A replay's refusal says nothing about
       * the earlier request, so its recipients become `unconfirmed`.
       */
      const requestBatch = Effect.fn("CampaignDeliveryService.requestBatch")(
        function* (
          batch: DeliveryBatch & { readonly replay: boolean },
          messages: readonly EmailMessage[]
        ) {
          const result = yield* email
            .sendBatch(messages, {
              idempotencyKey: campaignDeliveryBatchIdempotencyKey(batch),
            })
            .pipe(Effect.result);
          if (Result.isSuccess(result)) {
            return yield* settleBatch(batch, {
              status: "accepted",
              ids: result.success.map(({ id }) => id),
            });
          }
          if (result.failure._tag === "EmailServiceError") {
            yield* Effect.logError("Campaign delivery batch refused", {
              replay: batch.replay,
            });
            return yield* settleBatch(batch, {
              status: batch.replay ? "unconfirmed" : "rejected",
            });
          }
          yield* Effect.logWarning(
            "Campaign delivery batch outcome unknown; it will be replayed"
          );
          return yield* incomplete(batch);
        },
        (effect, batch) =>
          effect.pipe(
            Effect.annotateLogs({
              batchIndex: batch.batchIndex,
              batchSize: batch.dotyposCustomerIds.length,
            })
          )
      );

      const ensureStartBudget = Effect.fn(
        "CampaignDeliveryService.ensureStartBudget"
      )(function* (context: AttemptContext) {
        const now = yield* currentInstant;
        if (
          now.epochMilliseconds - context.startedAt.epochMilliseconds >
          Duration.toMillis(deliveryStartBudget)
        ) {
          return yield* incomplete(context);
        }
      });

      /**
       * Replays each batch whose outcome is unknown with its identical
       * payload under its key. A batch past the key's replay window, or
       * whose payload can't be reproduced (a recipient's email or consent
       * changed, or the rendering did), is never resent: its recipients
       * become `unconfirmed`.
       */
      const replayRequestedBatches = Effect.fn(
        "CampaignDeliveryService.replayRequestedBatches"
      )(function* (context: AttemptContext) {
        for (const requested of yield* listRequestedBatches(context)) {
          const batch = {
            sendId: context.sendId,
            deliveryAttempt: context.deliveryAttempt,
            batchIndex: requested.batchIndex,
            dotyposCustomerIds: requested.dotyposCustomerIds,
          };
          const now = yield* currentInstant;
          if (
            now.epochMilliseconds - requested.requestedAt.epochMilliseconds >
            Duration.toMillis(campaignDeliveryBatchReplayWindow)
          ) {
            yield* Effect.logWarning(
              "Campaign delivery batch unconfirmed: its key expired",
              { batchIndex: batch.batchIndex }
            );
            yield* settleBatch(batch, { status: "unconfirmed" });
            continue;
          }
          yield* ensureStartBudget(context);

          const messages = yield* Effect.gen(function* () {
            const recipients = yield* loadBatchRecipients(batch);
            const hydrated = yield* hydrate(context, recipients);
            const reachable = hydrated.flatMap((recipient) =>
              Result.isSuccess(recipient) ? [recipient.success] : []
            );
            if (
              recipients.length !== batch.dotyposCustomerIds.length ||
              reachable.length !== recipients.length
            ) {
              return Option.none();
            }
            const rendered = yield* renderMessages(context, reachable);
            return campaignDeliveryPayloadHash(rendered) ===
              requested.payloadHash
              ? Option.some(rendered)
              : Option.none();
          }).pipe(
            // Rendering fails the same way every time, so the payload can't
            // be reproduced.
            Effect.catchTag("EmailServiceError", () =>
              Effect.succeed(Option.none())
            ),
            // The batch may have been delivered, so it waits for a replay.
            Effect.catchTags({
              NetworkError: () => incomplete(context),
              ValidationError: () => incomplete(context),
              ExternalAPIError: () => incomplete(context),
              WorkspaceUrlConfigError: () => incomplete(context),
            })
          );
          if (Option.isNone(messages)) {
            yield* Effect.logWarning(
              "Campaign delivery batch unconfirmed: its payload changed",
              { batchIndex: batch.batchIndex }
            );
            yield* settleBatch(batch, { status: "unconfirmed" });
            continue;
          }
          yield* requestBatch({ ...batch, replay: true }, messages.value);
        }
      });

      /**
       * Persists the next batch before its first request, with the
       * recipients skipped while preparing it. Under the send row lock it
       * re-checks that the attempt is current and no other run batched these
       * recipients meanwhile.
       */
      const persistBatch = Effect.fn("CampaignDeliveryService.persistBatch")(
        function* (
          context: AttemptContext,
          input: {
            readonly recipients: readonly BatchRecipient[];
            readonly reachable: readonly ReachableRecipient[];
            readonly skipped: readonly {
              readonly dotyposCustomerId: DotyposCustomerId;
              readonly reason: CampaignRecipientSkipReason;
            }[];
            readonly payloadHash: string;
          }
        ) {
          const now = yield* currentInstant;
          return yield* db.transaction(
            Effect.fn(function* (tx) {
              const [send] = yield* tx
                .select({ id: emailCampaignSends.id })
                .from(emailCampaignSends)
                .where(
                  and(
                    eq(emailCampaignSends.id, context.sendId),
                    eq(
                      emailCampaignSends.deliveryAttempt,
                      context.deliveryAttempt
                    )
                  )
                )
                .for("update");
              const customerIds = input.recipients.map(
                ({ dotyposCustomerId }) => dotyposCustomerId
              );
              const [unchanged] = yield* tx
                .select({ count: sql<number>`count(*)::int` })
                .from(emailCampaignRecipients)
                .where(
                  and(
                    inAttempt(context),
                    inArray(emailCampaignRecipients.dotyposCustomerId, [
                      ...customerIds,
                    ]),
                    eq(emailCampaignRecipients.status, "pending"),
                    unbatched
                  )
                );
              if (!send || unchanged?.count !== customerIds.length) {
                return yield* incomplete(context);
              }
              yield* markSkipped(tx, {
                sendId: context.sendId,
                skipped: input.skipped,
                now,
              });
              if (input.reachable.length === 0) return Option.none();
              const [last] = yield* tx
                .select({
                  batchIndex: sql<number>`coalesce(max(${emailCampaignDeliveryBatches.batchIndex}), -1)::int`,
                })
                .from(emailCampaignDeliveryBatches)
                .where(
                  and(
                    eq(emailCampaignDeliveryBatches.sendId, context.sendId),
                    eq(
                      emailCampaignDeliveryBatches.deliveryAttempt,
                      context.deliveryAttempt
                    )
                  )
                );
              const batch: DeliveryBatch = {
                sendId: context.sendId,
                deliveryAttempt: context.deliveryAttempt,
                batchIndex: (last?.batchIndex ?? -1) + 1,
                dotyposCustomerIds: input.reachable.map(
                  ({ dotyposCustomerId }) => dotyposCustomerId
                ),
              };
              yield* tx.insert(emailCampaignDeliveryBatches).values({
                ...batch,
                dotyposCustomerIds: [...batch.dotyposCustomerIds],
                payloadHash: input.payloadHash,
                requestedAt: now,
              });
              return Option.some(batch);
            })
          );
        }
      );

      /**
       * Fails recipients whose batch couldn't be prepared (Dotypos or the
       * unsubscribe link failed past their retries). Nothing was requested,
       * so the admin can retry them safely.
       */
      const failUnrequested = (
        context: AttemptContext,
        recipients: readonly BatchRecipient[],
        cause: { readonly _tag: string }
      ) =>
        Effect.logError("Campaign delivery batch could not be prepared", {
          errorType: cause._tag,
        }).pipe(
          Effect.andThen(currentInstant),
          Effect.flatMap((now) =>
            settlePendingRecipients(db, {
              sendId: context.sendId,
              customerIds: recipients.map(
                ({ dotyposCustomerId }) => dotyposCustomerId
              ),
              status: "failed",
              now,
            })
          ),
          Effect.as(Option.none())
        );

      /**
       * Prepares the next batch from the recipients no batch carries yet:
       * re-reads and guards them, renders their emails, and persists the
       * batch before its first request.
       */
      const prepareNextBatch = Effect.fn(
        "CampaignDeliveryService.prepareNextBatch"
      )(function* (
        context: AttemptContext,
        recipients: readonly BatchRecipient[]
      ) {
        return yield* Effect.gen(function* () {
          const hydrated = yield* hydrate(context, recipients);
          const reachable = hydrated.flatMap((recipient) =>
            Result.isSuccess(recipient) ? [recipient.success] : []
          );
          const skipped = hydrated.flatMap((recipient, index) =>
            Result.isFailure(recipient)
              ? [
                  {
                    dotyposCustomerId: recipients[index]!.dotyposCustomerId,
                    reason: recipient.failure,
                  },
                ]
              : []
          );
          const messages = yield* renderMessages(context, reachable);
          const batch = yield* persistBatch(context, {
            recipients,
            reachable,
            skipped,
            payloadHash: campaignDeliveryPayloadHash(messages),
          });
          return Option.map(batch, (persisted) => ({
            batch: persisted,
            messages,
          }));
        }).pipe(
          Effect.catchTags({
            EmailServiceError: (cause) =>
              failUnrequested(context, recipients, cause),
            NetworkError: (cause) =>
              failUnrequested(context, recipients, cause),
            ValidationError: (cause) =>
              failUnrequested(context, recipients, cause),
            ExternalAPIError: (cause) =>
              failUnrequested(context, recipients, cause),
            WorkspaceUrlConfigError: (cause) =>
              failUnrequested(context, recipients, cause),
          })
        );
      });

      /** Batches and sends the recipients no batch carries yet. */
      const deliverUnbatched = Effect.fn(
        "CampaignDeliveryService.deliverUnbatched"
      )(function* (context: AttemptContext) {
        while (true) {
          const recipients = yield* nextUnbatchedRecipients(context);
          if (recipients.length === 0) return;
          yield* ensureStartBudget(context);
          const prepared = yield* prepareNextBatch(context, recipients);
          if (Option.isSome(prepared)) {
            yield* requestBatch(
              { ...prepared.value.batch, replay: false },
              prepared.value.messages
            );
          }
        }
      });

      /** Marks the campaign Sent, or Failed when anyone wasn't delivered. */
      const settle = Effect.fn("CampaignDeliveryService.settle")(function* (
        context: AttemptContext
      ) {
        const [undelivered] = yield* db
          .select({ count: sql<number>`count(*)::int` })
          .from(emailCampaignRecipients)
          .where(
            and(
              eq(emailCampaignRecipients.sendId, context.sendId),
              inArray(emailCampaignRecipients.status, [
                "pending",
                "failed",
                "unconfirmed",
              ])
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
                eq(emailCampaigns.id, context.campaign.id),
                eq(emailCampaigns.status, "sending")
              )
            )
            .pipe(
              Effect.andThen(
                tx
                  .update(emailCampaignSends)
                  .set({ completedAt: status === "sent" ? now : null })
                  .where(eq(emailCampaignSends.id, context.sendId))
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
            const context: AttemptContext = {
              ...attempt,
              campaign: campaign.value,
              startedAt,
            };

            yield* replayRequestedBatches(context);
            yield* deliverUnbatched(context);
            return yield* settle(context);
          },
          (effect, attempt) =>
            effect.pipe(
              Effect.timeoutOrElse({
                duration: deliveryRunDeadline,
                orElse: () => incomplete(attempt),
              }),
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

const incomplete = (attempt: CampaignDeliveryAttempt) =>
  Effect.fail(
    new CampaignDeliveryIncomplete({
      sendId: attempt.sendId,
      deliveryAttempt: attempt.deliveryAttempt,
    })
  );

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
