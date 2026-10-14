import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Effect } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import {
  emailCampaignRecipients,
  emailCampaignSends,
  emailCampaigns,
} from "@/db/schema";
import type { AudienceFilter } from "../audience-filter";
import type {
  CampaignLocalizedContent,
  CampaignPurpose,
} from "../body/campaign-content";
import { hashCampaignContent } from "../body/campaign-content-hash";
import type {
  CampaignRecipientStatus,
  CampaignStatus,
} from "../campaign-states";

export const everyoneFilter: AudienceFilter = {
  _tag: "Group",
  operator: "and",
  filters: [],
};

/** Czech-only campaign content whose body is one paragraph of `text`. */
export const campaignContentFixture = (
  text = "Ahoj"
): CampaignLocalizedContent => ({
  "cs-CZ": {
    subject: "Novinky",
    preheader: "Co je nového",
    body: {
      formatVersion: 1,
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      },
    },
  },
});

/**
 * Inserts a campaign in `status` with its frozen send and recipients, as a
 * confirmed send leaves them, and returns their IDs.
 */
export const seedCampaignSend = async (
  db: WorkspaceDatabaseClient,
  input: {
    readonly purpose: CampaignPurpose;
    readonly status?: CampaignStatus;
    readonly deliveryAttempt?: number;
    readonly recipients: readonly {
      readonly dotyposCustomerId: DotyposCustomerId;
      readonly deliveryAttempt?: number;
      readonly status?: CampaignRecipientStatus;
      readonly providerMessageId?: string;
    }[];
  }
) => {
  const content = campaignContentFixture();
  const [campaign] = await Effect.runPromise(
    db
      .insert(emailCampaigns)
      .values({
        title: "Autumn news",
        purpose: input.purpose,
        templateKey: "workspace",
        content,
        status: input.status ?? "sending",
      })
      .returning()
  );
  const [send] = await Effect.runPromise(
    db
      .insert(emailCampaignSends)
      .values({
        campaignId: campaign!.id,
        audienceFilter: everyoneFilter,
        contentHash: hashCampaignContent({
          purpose: input.purpose,
          templateKey: "workspace",
          locales: content,
        }),
        deliveryAttempt: input.deliveryAttempt ?? 1,
      })
      .returning()
  );
  await Effect.runPromise(
    db.insert(emailCampaignRecipients).values(
      input.recipients.map((recipient) => ({
        ...recipient,
        skipReason:
          recipient.status === "skipped" ? ("missing-email" as const) : null,
        sendId: send!.id,
        locale: "cs-CZ" as const,
      }))
    )
  );
  return { campaignId: campaign!.id, sendId: send!.id };
};

/** Deletes campaigns with their sends and recipients. */
export const deleteCampaigns = async (
  pool: {
    readonly query: (sql: string, params: unknown[]) => Promise<unknown>;
  },
  campaignIds: readonly string[]
) => {
  await pool.query(
    "delete from email_campaign_sends where campaign_id = any($1)",
    [campaignIds]
  );
  await pool.query("delete from email_campaigns where id = any($1)", [
    campaignIds,
  ]);
};
