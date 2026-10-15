import "server-only";

import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { emailCampaignRecipients } from "@/db/schema";
import { campaignSendIdSchema } from "../campaign-identifiers";
import type { CampaignRecipientStatus } from "../campaign-states";

/** A provider delivery event for one campaign email. */
type CampaignDeliveryEvent = {
  readonly type: string;
  readonly providerMessageId: string;
  /** The `campaignSendId` and `dotyposCustomerId` tags of the email. */
  readonly tags: ReadonlyMap<string, string>;
  readonly occurredAt: Temporal.Instant;
};

type CampaignDeliveryEventResult = {
  readonly status: "processed" | "ignored";
  readonly reason?: string;
};

export interface ICampaignDeliveryStatusService {
  /**
   * Records a delivered, bounced, or complained event on the frozen
   * recipient, found by provider message ID or by its tags when the event
   * beat the message ID into the database. The event is proof of delivery,
   * so it settles a recipient in any state short of it, including one whose
   * batch was refused, unconfirmed, or skipped by a later attempt. Statuses
   * only move forward, so a late `delivered` never hides a bounce or
   * complaint. Bounces and complaints change no consent: the provider
   * suppresses the address.
   */
  readonly record: (
    event: CampaignDeliveryEvent
  ) => Effect.Effect<CampaignDeliveryEventResult, EffectDrizzleQueryError>;
}

/** Every status short of a provider-confirmed delivery. */
const unconfirmedDeliveryStatuses = [
  "pending",
  "sent",
  "failed",
  "unconfirmed",
  "skipped",
] as const satisfies readonly CampaignRecipientStatus[];

/** Each provider status and the earlier statuses it may replace. */
const statusTransitions = {
  "email.delivered": {
    status: "delivered",
    from: unconfirmedDeliveryStatuses,
  },
  "email.bounced": {
    status: "bounced",
    from: [...unconfirmedDeliveryStatuses, "delivered"],
  },
  "email.complained": {
    status: "complained",
    from: [...unconfirmedDeliveryStatuses, "delivered"],
  },
} as const satisfies Record<
  string,
  {
    readonly status: CampaignRecipientStatus;
    readonly from: readonly CampaignRecipientStatus[];
  }
>;

const isStatusEvent = (type: string): type is keyof typeof statusTransitions =>
  Object.hasOwn(statusTransitions, type);

const decodeSendId = Schema.decodeUnknownOption(campaignSendIdSchema);
const decodeCustomerId = Schema.decodeUnknownOption(DotyposCustomerIdSchema);

/** Per-recipient delivery status of campaign emails, from provider webhooks. */
export class CampaignDeliveryStatusService extends Context.Service<
  CampaignDeliveryStatusService,
  ICampaignDeliveryStatusService
>()("@deskohub-workspace/email-campaigns/CampaignDeliveryStatusService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      return {
        record: Effect.fn("CampaignDeliveryStatusService.record")(
          function* (event) {
            if (!isStatusEvent(event.type)) {
              return { status: "ignored", reason: "non_status_event" } as const;
            }
            const transition = statusTransitions[event.type];
            const sendId = decodeSendId(event.tags.get("campaignSendId"));
            const customerId = decodeCustomerId(
              event.tags.get("dotyposCustomerId")
            );
            const byTags = Option.all([sendId, customerId]).pipe(
              Option.map(([send, customer]) =>
                and(
                  eq(emailCampaignRecipients.sendId, send),
                  eq(emailCampaignRecipients.dotyposCustomerId, customer),
                  or(
                    isNull(emailCampaignRecipients.providerMessageId),
                    eq(
                      emailCampaignRecipients.providerMessageId,
                      event.providerMessageId
                    )
                  )
                )
              ),
              Option.getOrUndefined
            );
            const updated = yield* db
              .update(emailCampaignRecipients)
              .set({
                status: transition.status,
                skipReason: null,
                statusUpdatedAt: event.occurredAt,
                providerMessageId: sql`coalesce(${emailCampaignRecipients.providerMessageId}, ${event.providerMessageId})`,
              })
              .where(
                and(
                  or(
                    eq(
                      emailCampaignRecipients.providerMessageId,
                      event.providerMessageId
                    ),
                    byTags
                  ),
                  inArray(emailCampaignRecipients.status, [...transition.from])
                )
              )
              .returning({ sendId: emailCampaignRecipients.sendId });
            return updated.length > 0
              ? ({ status: "processed" } as const)
              : ({
                  status: "ignored",
                  reason: "campaign_recipient_unchanged",
                } as const);
          }
        ),
      } satisfies ICampaignDeliveryStatusService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
